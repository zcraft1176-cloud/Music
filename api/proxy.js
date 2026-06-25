/**
 * Vercel Serverless CORS Proxy
 * Replaces proxy.php for Vercel deployment
 */

// B4: Keep this list in sync with:
//   - proxy.php          (local XAMPP proxy)
//   - src/js/api.js      (MusicAPI.config.piped.instances & invidious.instances)
// All three files must have matching domains to avoid 403 errors.
const allowedDomains = [
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

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // Only allow GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    // Whitelist check
    try {
        const parsed = new URL(url);
        if (!allowedDomains.includes(parsed.hostname)) {
            return res.status(403).json({ error: 'Domain not allowed' });
        }
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    // Fetch from upstream API
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            },
            signal: AbortSignal.timeout(25000)
        });

        const data = await response.text();
        
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(response.status).send(data);
    } catch (e) {
        return res.status(502).json({ 
            error: 'Upstream request failed', 
            detail: e.message 
        });
    }
}
