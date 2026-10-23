/**
 * Vercel Serverless Audio Download Proxy
 * Supports:
 * 1. GET: Stream audio binary from upstream (YouTube CDN, Jamendo, etc.)
 * 2. POST: Proxy requests to Cobalt API
 */

// Setiap pola WAJIB berjangkar dan memakai titik literal. Bentuk lama
// (/jamendo/, /cobalt/, /^pipedapi\./) menerima jamendo.evil.tld dan
// cobalt.attacker.tld — terbukti 502 vs 403 di host live.
const allowedPatterns = [
    /(^|\.)googlevideo\.com$/,
    /(^|\.)jamendo\.com$/,
    /(^|\.)archive\.org$/,
    /(^|\.)dzcdn\.net$/,
    /(^|\.)deezer\.com$/,
];

// Instance Piped/Invidious yang memang dipakai src/js/api.js. Dicocokkan PERSIS:
// pola apa pun yang menerima akhiran bebas (mis. /(^|\.)piped\./) ikut menerima
// piped.localtest.me -> 127.0.0.1, yaitu SSRF yang sama dengan download-proxy.php.
const allowedHosts = new Set([
    'api.piped.private.coffee',
    'pipedapi.kavin.rocks',
    'pipedapi.adminforge.de',
    'pipedapi.leptons.xyz',
    'pipedapi.in.projectsegfau.lt',
    'inv.thepixora.com',
    'invidious.f5.si',
    'yt.chocolatemoo53.com',
]);

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // ===== GET: Stream audio file =====
    if (req.method === 'GET') {
        const { url, filename = 'download.mp3' } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'Missing url parameter' });
        }

        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return res.status(400).json({ error: 'Only http/https allowed' });
            }
            const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
            const allowed = allowedHosts.has(host) || allowedPatterns.some(pattern => pattern.test(host));
            if (!allowed) {
                return res.status(403).json({ error: `Domain not allowed: ${parsed.hostname}` });
            }
        } catch (e) {
            return res.status(400).json({ error: 'Invalid URL' });
        }

        const safeName = filename.replace(/[<>:"/\\|?*\r\n\x00]/g, '').trim() || 'download.mp3';

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'audio/*, video/*, */*',
                },
                signal: AbortSignal.timeout(120000),
            });

            if (!response.ok) {
                return res.status(response.status).json({ error: 'Upstream failed', status: response.status });
            }

            const contentType = response.headers.get('content-type') || 'application/octet-stream';
            const contentLength = response.headers.get('content-length');

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
            if (contentLength) res.setHeader('Content-Length', contentLength);

            const arrayBuffer = await response.arrayBuffer();
            return res.status(200).send(Buffer.from(arrayBuffer));
        } catch (e) {
            return res.status(502).json({ error: 'Download failed', detail: e.message });
        }
    }

    // ===== POST: Not supported =====
    return res.status(405).json({ error: 'Method not allowed' });
}
