/**
 * Vercel Serverless Audio Download Proxy
 * Streams audio binary data from upstream with proper headers
 */

const allowedPatterns = [
    /\.googlevideo\.com$/,
    /^pipedproxy\./,
    /\.piped\./,
    /\.jamendo\.com$/,
    /jamendo/,
    /\.archive\.org$/,
    /\.dzcdn\.net$/,
    /\.deezer\.com$/,
    /^api\.piped\./,
    /^pipedapi\./,
];

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url, filename = 'download.mp3' } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    // Domain whitelist check
    try {
        const parsed = new URL(url);
        const allowed = allowedPatterns.some(pattern => pattern.test(parsed.hostname));
        if (!allowed) {
            return res.status(403).json({ error: `Domain not allowed: ${parsed.hostname}` });
        }
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    // Sanitize filename
    const safeName = filename.replace(/[<>:"/\\|?*]/g, '').trim() || 'download.mp3';

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'audio/*, video/*, */*',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: AbortSignal.timeout(120000),
        });

        if (!response.ok) {
            return res.status(response.status).json({ 
                error: 'Upstream download failed', 
                status: response.status 
            });
        }

        // Forward content headers
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const contentLength = response.headers.get('content-length');

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        res.setHeader('Cache-Control', 'no-cache');
        
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        // Stream the response
        const arrayBuffer = await response.arrayBuffer();
        return res.status(200).send(Buffer.from(arrayBuffer));
    } catch (e) {
        return res.status(502).json({ 
            error: 'Download failed', 
            detail: e.message 
        });
    }
}
