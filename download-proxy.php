<?php
/**
 * YouTube Audio Download Proxy
 * Uses yt-dlp to extract direct audio URL, then streams to browser
 * 
 * Usage: 
 *   download-proxy.php?videoId=VIDEO_ID&title=FILENAME  (YouTube via yt-dlp)
 *   download-proxy.php?url=DIRECT_URL&filename=FILENAME (non-YouTube direct URL)
 */

set_time_limit(300);
ini_set('memory_limit', '512M');
ob_end_clean(); // Disable output buffering

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/**
 * Stream a remote URL to the client
 */
function streamToClient($url, $filename) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => 240,
        CURLOPT_CONNECTTIMEOUT => 30,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        CURLOPT_HTTPHEADER => [
            'Accept: */*',
            'Accept-Encoding: identity',
        ],
    ]);
    
    $data = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream';
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($httpCode !== 200 || $data === false) {
        http_response_code(502);
        echo json_encode(['error' => 'Stream failed', 'status' => $httpCode, 'curl_error' => $error]);
        return false;
    }
    
    header("Content-Type: $contentType");
    header("Content-Disposition: attachment; filename=\"$filename\"");
    header('Content-Length: ' . strlen($data));
    header('Cache-Control: no-cache');
    echo $data;
    return true;
}

// ===== Direct URL streaming (non-YouTube sources) =====
if (isset($_GET['url'])) {
    $url = $_GET['url'];
    $filename = isset($_GET['filename']) ? $_GET['filename'] : 'download.mp3';
    
    $parsed = parse_url($url);
    $host = $parsed['host'] ?? '';
    $allowed = ['googlevideo.com', 'piped', 'jamendo.com', 'archive.org', 'dzcdn.net', 'deezer.com'];
    $isAllowed = false;
    foreach ($allowed as $p) {
        if (stripos($host, $p) !== false) { $isAllowed = true; break; }
    }
    
    if (!$isAllowed) {
        http_response_code(403);
        echo json_encode(['error' => "Domain not allowed: $host"]);
        exit;
    }
    
    $safeName = preg_replace('/[<>:"\/\\\\|?*]/', '', $filename) ?: 'download.mp3';
    streamToClient($url, $safeName);
    exit;
}

// ===== YouTube download via yt-dlp =====
if (isset($_GET['videoId'])) {
    $videoId = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['videoId']);
    $title = isset($_GET['title']) ? $_GET['title'] : 'download';
    $safeName = preg_replace('/[<>:"\/\\\\|?*]/', '', $title);
    $safeName = trim($safeName) ?: 'download';
    
    $ytdlp = __DIR__ . DIRECTORY_SEPARATOR . 'yt-dlp.exe';
    
    if (!file_exists($ytdlp)) {
        http_response_code(500);
        echo json_encode(['error' => 'yt-dlp.exe not found']);
        exit;
    }
    
    // Extract direct audio URL using yt-dlp
    $youtubeUrl = "https://www.youtube.com/watch?v=$videoId";
    $cmd = escapeshellarg($ytdlp) . ' --get-url -f "bestaudio" --no-warnings ' . escapeshellarg($youtubeUrl) . ' 2>&1';
    
    $output = [];
    $returnCode = 0;
    exec($cmd, $output, $returnCode);
    
    $directUrl = '';
    foreach ($output as $line) {
        $line = trim($line);
        if (strpos($line, 'http') === 0) $directUrl = $line;
    }
    
    if (empty($directUrl)) {
        http_response_code(502);
        echo json_encode(['error' => 'yt-dlp failed', 'code' => $returnCode, 'output' => $output]);
        exit;
    }
    
    // Determine file extension
    $ext = 'webm';
    if (strpos($directUrl, 'mime=audio%2Fmp4') !== false) $ext = 'm4a';
    $filename = $safeName . '.' . $ext;
    
    streamToClient($directUrl, $filename);
    exit;
}

// No valid parameters
http_response_code(400);
echo json_encode(['error' => 'Missing parameters. Use ?videoId=ID&title=NAME or ?url=URL&filename=NAME']);
