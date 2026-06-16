<?php
/**
 * Audio Download Proxy
 * Streams audio binary data from upstream (YouTube CDN, Jamendo, etc.)
 * with proper Content-Type and Content-Disposition headers
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Content-Type: application/json');
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$url = $_GET['url'] ?? '';
$filename = $_GET['filename'] ?? 'download.mp3';

if (empty($url)) {
    header('Content-Type: application/json');
    http_response_code(400);
    echo json_encode(['error' => 'Missing url parameter']);
    exit;
}

// Whitelist allowed domains for audio download
$parsed = parse_url($url);
$host = $parsed['host'] ?? '';

$allowedPatterns = [
    // YouTube CDN (googlevideo.com subdomains like rr1---sn-xxx.googlevideo.com)
    '/\.googlevideo\.com$/',
    // Piped proxy instances
    '/^pipedproxy\./',
    '/\.piped\./',
    // Jamendo CDN
    '/\.jamendo\.com$/',
    '/jamendo/',
    // Archive.org
    '/\.archive\.org$/',
    // Deezer CDN (previews)
    '/\.dzcdn\.net$/',
    '/\.deezer\.com$/',
    // Piped API instances (for proxied streams)
    '/^api\.piped\./',
    '/^pipedapi\./',
];

$allowed = false;
foreach ($allowedPatterns as $pattern) {
    if (preg_match($pattern, $host)) {
        $allowed = true;
        break;
    }
}

if (!$allowed) {
    header('Content-Type: application/json');
    http_response_code(403);
    echo json_encode(['error' => 'Domain not allowed: ' . $host]);
    exit;
}

// Sanitize filename
$filename = preg_replace('/[<>:"\/\\\\|?*]/', '', $filename);
$filename = trim($filename);
if (empty($filename)) $filename = 'download.mp3';

// Stream the audio file
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    CURLOPT_HTTPHEADER => [
        'Accept: audio/*, video/*, */*',
        'Accept-Language: en-US,en;q=0.9',
        'Range: bytes=0-',
    ],
    // Write output directly using a callback
    CURLOPT_HEADERFUNCTION => function($ch, $headerLine) {
        $len = strlen($headerLine);
        $header = strtolower(trim($headerLine));
        
        // Forward content-type
        if (strpos($header, 'content-type:') === 0) {
            $ct = trim(substr($headerLine, 13));
            header('Content-Type: ' . $ct);
        }
        // Forward content-length
        if (strpos($header, 'content-length:') === 0) {
            $cl = trim(substr($headerLine, 15));
            header('Content-Length: ' . $cl);
        }
        
        return $len;
    },
]);

// Set download headers
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Cache-Control: no-cache');

// Buffer and output
ob_start();
curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) {
    echo $data;
    if (ob_get_level() > 0) ob_flush();
    flush();
    return strlen($data);
});

$success = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if (!$success || $error) {
    // If we haven't sent any data yet, send error
    if (ob_get_length() === 0) {
        ob_end_clean();
        header('Content-Type: application/json');
        header_remove('Content-Disposition');
        http_response_code(502);
        echo json_encode(['error' => 'Download failed', 'detail' => $error]);
    }
}

ob_end_flush();
