<?php
/**
 * Local search stand-in for the Piped/Invidious instances.
 *
 * Those public instances are down more often than not, which leaves every
 * track unresolvable and the whole library unplayable. yt-dlp.exe can search
 * by itself, so on a local install it answers instead.
 *
 * The reply deliberately mimics the Piped search shape. api.js then scores it
 * with the same code it uses for a real instance: this endpoint returns
 * CANDIDATES and never picks one, so the winning upload does not change with
 * the source.
 *
 *   ?q=Artist+Title[&n=5]
 *
 * Local installs only — it shells out to yt-dlp.exe, which Vercel cannot do.
 */
set_time_limit(0);
while (ob_get_level()) { ob_end_clean(); }

header('Content-Type: application/json; charset=utf-8');

$q = trim($_GET['q'] ?? '');
$n = min(10, max(1, (int) ($_GET['n'] ?? 5)));

if ($q === '') {
    http_response_code(400);
    echo json_encode(['items' => []]);
    exit;
}

// escapeshellarg() on Windows turns % into a space (PHP does no environment
// expansion, so it neutralises the character), and a stripped % cannot be
// recovered on yt-dlp's side. Drop it instead of searching for a mangled query.
$q = str_replace('%', '', $q);

$root = __DIR__;

// ponytail: exec() blocks this PHP worker for the length of a search (~5s) and
// there is no cross-request cache, so concurrent searches each spawn their own
// yt-dlp. Fine for a single-user local install; add a file cache keyed on $q
// before this ever serves more than one person.
//
// --dump-json, not --print: --print needs a "%(field)s" template, and the
// Windows escapeshellarg() above would eat every % in it. JSON has no such
// character, and --flat-playlist still gives id/title/uploader/duration
// without paying for a full extraction.
$args = ['--no-warnings', '--flat-playlist', '--dump-json', "ytsearch{$n}:{$q}"];
$cmd  = escapeshellarg($root . DIRECTORY_SEPARATOR . 'yt-dlp.exe');
foreach ($args as $a) {
    $cmd .= ' ' . escapeshellarg($a);
}

$out = [];
// 2>NUL, not 2>/dev/null: exec() goes through cmd.exe.
exec($cmd . ' 2>NUL', $out);

$items = [];
foreach ($out as $line) {
    $d = json_decode(trim($line), true);
    if (!is_array($d) || empty($d['id'])) continue;

    $id = (string) $d['id'];

    // Same guard api.js applies to Piped results.
    if (!preg_match('/^[A-Za-z0-9_-]{11}$/', $id)) continue;

    $items[] = [
        'type'         => 'stream',
        'title'        => (string) ($d['title'] ?? ''),
        'uploaderName' => (string) ($d['uploader'] ?? $d['channel'] ?? ''),
        'duration'     => (int) ($d['duration'] ?? 0),
        'url'          => "https://www.youtube.com/watch?v={$id}",
    ];
}

echo json_encode(['items' => $items]);
