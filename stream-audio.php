<?php
/**
 * Local stream proxy — plays a YouTube audio track through <audio>.
 *
 * The IFrame path in player.js pulls the whole video stream and silently drops
 * the picture: measured on "Dracula" that is ~300 kbps where the audio alone is
 * 133 kbps. This forwards only the audio track. Range requests are passed
 * through untouched, so the browser still sees a plain, seekable file and no
 * ffmpeg process is needed.
 *
 * Local installs only — it shells out to yt-dlp.exe, which Vercel cannot do.
 *
 *   ?videoId=ID[&fmt=251|140]
 *
 *   251 = webm/opus  ~136k   (default: better quality per bit)
 *   140 = m4a/aac    ~130k   (fallback when 251 will not resolve)
 */
set_time_limit(0);
while (ob_get_level()) { ob_end_clean(); }

$root    = __DIR__;
$videoId = $_GET['videoId'] ?? '';
$fmt     = $_GET['fmt'] ?? '251';

const URL_TTL      = 3600;  // resolved URLs live ~6h; refresh well before that
const FALLBACK_FMT = '140';

if (!preg_match('/^[A-Za-z0-9_-]{11}$/', $videoId)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Missing or malformed videoId']);
    exit;
}

function cache_path(string $videoId, string $fmt): string {
    return sys_get_temp_dir() . DIRECTORY_SEPARATOR . "yturl_{$videoId}_{$fmt}.txt";
}

function resolve_url(string $root, string $videoId, string $fmt): string {
    $cmd = escapeshellarg($root . DIRECTORY_SEPARATOR . 'yt-dlp.exe')
         . ' --ffmpeg-location ' . escapeshellarg($root)
         . ' -g -f ' . escapeshellarg($fmt)
         . ' ' . escapeshellarg("https://www.youtube.com/watch?v={$videoId}")
         . ' 2>&1';
    $out = [];
    exec($cmd, $out);
    foreach ($out as $line) {
        $line = trim($line);
        if (strpos($line, 'https://') === 0 && strpos($line, 'googlevideo') !== false) {
            return $line;
        }
    }
    return '';
}

/** Returns the resolved media URL, or '' if yt-dlp could not produce one. */
function get_url(string $root, string $videoId, string &$fmt, bool $fresh = false): string {
    $path = cache_path($videoId, $fmt);

    if (!$fresh && file_exists($path) && (time() - filemtime($path)) < URL_TTL) {
        $cached = trim((string) file_get_contents($path));
        if ($cached !== '') return $cached;
    }

    $url = resolve_url($root, $videoId, $fmt);
    if ($url === '' && $fmt !== FALLBACK_FMT) {
        $fmt = FALLBACK_FMT;
        $path = cache_path($videoId, $fmt);
        $url = resolve_url($root, $videoId, $fmt);
    }
    if ($url !== '') {
        file_put_contents($path, $url);
    }
    return $url;
}

$url = get_url($root, $videoId, $fmt);

if ($url === '') {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Could not resolve audio stream']);
    exit;
}

$range = $_SERVER['HTTP_RANGE'] ?? '';

/**
 * Pipes the upstream response to the client. Returns the upstream status code,
 * or 0 when nothing was received.
 */
function pipe(string $url, string $range, bool &$started): int {
    $hdrs = [];
    $status = 0;
    $started = false;

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $range !== '' ? ["Range: $range"] : []);
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $hline) use (&$hdrs) {
        $hdrs[] = trim($hline);
        return strlen($hline);
    });
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $data) use (&$hdrs, &$status, &$started) {
        if (!$started) {
            $started = true;
            $pass = [];
            foreach ($hdrs as $hline) {
                if (preg_match('#^HTTP/\S+\s+(\d+)#', $hline, $m)) { $status = (int) $m[1]; continue; }
                if (preg_match('#^(content-type|content-length|content-range|accept-ranges)\s*:#i', $hline)) {
                    $pass[] = $hline;
                }
            }
            http_response_code($status ?: 502);
            foreach ($pass as $hline) { header($hline); }
            // no-store, not no-cache: this is a live passthrough, so the browser
            // must not accumulate a disk copy. Seeking still works — every jump
            // is a fresh Range request, not a cache hit.
            header('Cache-Control: no-store');
            header('Pragma: no-cache');
        }
        echo $data;
        flush();
        return strlen($data);
    });
    curl_exec($ch);
    curl_close($ch);

    return $status;
}

$started = false;
$status  = pipe($url, $range, $started);

// A cached URL can expire mid-session. Resolve once more before giving up —
// but only if nothing has been sent yet, since headers cannot be re-issued.
if (!$started) {
    $fresh = get_url($root, $videoId, $fmt, true);
    if ($fresh !== '' && $fresh !== $url) {
        $status = pipe($fresh, $range, $started);
    }
}

if (!$started) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Upstream returned no data']);
}
