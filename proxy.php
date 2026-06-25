<?php
/**
 * Lightweight CORS Proxy for Piped/Invidious API
 * Routes requests through server-side to bypass browser CORS restrictions
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Only allow GET
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$url = $_GET['url'] ?? '';

if (empty($url)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing url parameter']);
    exit;
}

// Whitelist allowed domains
// B4: Keep this list in sync with:
//   - api/proxy.js       (Vercel serverless proxy)
//   - src/js/api.js      (MusicAPI.config.piped.instances & invidious.instances)
// All three files must have matching domains to avoid 403 errors.
$allowedDomains = [
    'api.deezer.com',
    'api.piped.private.coffee',
    'pipedapi.kavin.rocks',
    'pipedapi.adminforge.de',
    'pipedapi.leptons.xyz',
    'pipedapi.in.projectsegfau.lt',
    'inv.thepixora.com',
    'invidious.f5.si',
    'yt.chocolatemoo53.com'
];

$parsed = parse_url($url);
$host = $parsed['host'] ?? '';

if (!in_array($host, $allowedDomains)) {
    http_response_code(403);
    echo json_encode(['error' => 'Domain not allowed']);
    exit;
}

// Fetch from API
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    CURLOPT_HTTPHEADER => ['Accept: application/json']
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    http_response_code(502);
    echo json_encode(['error' => 'Upstream request failed', 'detail' => $error]);
    exit;
}

http_response_code($httpCode);
echo $response;
