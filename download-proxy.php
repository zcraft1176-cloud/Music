<?php
/**
 * YouTube Audio Download Proxy (MP3)
 * Uses yt-dlp + ffmpeg to download and convert YouTube audio to MP3
 * 
 * Usage: 
 *   download-proxy.php?videoId=VIDEO_ID&title=FILENAME  (YouTube → MP3)
 *   download-proxy.php?url=DIRECT_URL&filename=FILENAME (non-YouTube direct)
 */

set_time_limit(300);
ini_set('memory_limit', '512M');
if (ob_get_level()) ob_end_clean();

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
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
    
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => 240,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ]);
    $data = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream';
    curl_close($ch);
    
    if ($httpCode !== 200 || $data === false) {
        http_response_code(502);
        echo json_encode(['error' => 'Failed to fetch', 'status' => $httpCode]);
        exit;
    }
    
    header("Content-Type: $contentType");
    header("Content-Disposition: attachment; filename=\"$safeName\"");
    header('Content-Length: ' . strlen($data));
    echo $data;
    exit;
}

// ===== YouTube download via yt-dlp → MP3 =====
if (isset($_GET['videoId'])) {
    $videoId = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['videoId']);
    $title = isset($_GET['title']) ? $_GET['title'] : 'download';
    $safeName = preg_replace('/[<>:"\/\\\\|?*]/', '', $title);
    $safeName = trim($safeName) ?: 'download';
    
    $projectDir = __DIR__;
    $ytdlp = $projectDir . DIRECTORY_SEPARATOR . 'yt-dlp.exe';
    
    if (!file_exists($ytdlp)) {
        http_response_code(500);
        echo json_encode(['error' => 'yt-dlp.exe not found']);
        exit;
    }
    
    // Create temp directory for download
    $tempDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'msicfree_' . $videoId . '_' . time();
    if (!is_dir($tempDir)) mkdir($tempDir, 0755, true);
    
    // Use a fixed output name (no template variables to avoid escapeshellarg issues)
    $outputFile = $tempDir . DIRECTORY_SEPARATOR . 'audio';
    $youtubeUrl = "https://www.youtube.com/watch?v=$videoId";
    
    // Download + convert to MP3 using yt-dlp with ffmpeg
    // Note: use -o with fixed filename, yt-dlp will add extension automatically
    $cmd = escapeshellarg($ytdlp)
        . ' --ffmpeg-location ' . escapeshellarg($projectDir)
        . ' -x --audio-format mp3 --audio-quality 128K'
        . ' --no-warnings --no-playlist --no-check-certificates'
        . ' -o "' . str_replace('"', '', $outputFile) . '.%(ext)s"'
        . ' ' . escapeshellarg($youtubeUrl)
        . ' 2>&1';
    
    $output = [];
    $returnCode = 0;
    exec($cmd, $output, $returnCode);
    
    // Find the MP3 file
    $mp3File = $outputFile . '.mp3';
    
    if (!file_exists($mp3File)) {
        // Try to find any mp3 in the temp dir
        $mp3Files = glob($tempDir . DIRECTORY_SEPARATOR . '*.mp3');
        if (!empty($mp3Files)) {
            $mp3File = $mp3Files[0];
        }
    }
    
    if (!file_exists($mp3File)) {
        // Cleanup
        array_map('unlink', glob($tempDir . DIRECTORY_SEPARATOR . '*'));
        @rmdir($tempDir);
        
        http_response_code(502);
        echo json_encode([
            'error' => 'MP3 conversion failed',
            'code' => $returnCode,
            'output' => $output,
        ]);
        exit;
    }
    
    // Serve the MP3 file
    $fileSize = filesize($mp3File);
    $filename = $safeName . '.mp3';
    
    header('Content-Type: audio/mpeg');
    header("Content-Disposition: attachment; filename=\"$filename\"");
    header('Content-Length: ' . $fileSize);
    header('Cache-Control: no-cache');
    
    readfile($mp3File);
    
    // Cleanup temp files
    array_map('unlink', glob($tempDir . DIRECTORY_SEPARATOR . '*'));
    @rmdir($tempDir);
    exit;
}

// No valid parameters
http_response_code(400);
echo json_encode(['error' => 'Missing parameters. Use ?videoId=ID&title=NAME or ?url=URL&filename=NAME']);
