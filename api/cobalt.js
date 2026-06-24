/**
 * Vercel Serverless: Cobalt API Proxy
 * 
 * Proxies requests to Cobalt API instances for YouTube audio download.
 * Tries multiple public instances with fallback.
 * 
 * Usage: POST /api/cobalt
 * Body: { url: "https://youtube.com/watch?v=...", audioFormat: "mp3", audioBitrate: "128" }
 */

const COBALT_INSTANCES = [
    'https://api.cobalt.tools',
    'https://cobalt-api.kwiatekmiki.com',
    'https://cobalt.api.timelessnesses.me',
    'https://api.cobalt.lol',
];

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url, audioFormat = 'mp3', audioBitrate = '128' } = req.body || {};

    if (!url) {
        return res.status(400).json({ error: 'Missing "url" in request body' });
    }

    const requestBody = JSON.stringify({
        url,
        downloadMode: 'audio',
        audioFormat,
        audioBitrate,
        filenameStyle: 'basic',
        disableMetadata: false
    });

    let lastError = null;

    for (const instance of COBALT_INSTANCES) {
        try {
            console.log(`[Cobalt] Trying instance: ${instance}`);

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

            const response = await fetch(instance, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: requestBody,
                signal: controller.signal
            });

            clearTimeout(timeout);

            const data = await response.json();

            if (data.status === 'error') {
                console.log(`[Cobalt] Instance ${instance} returned error:`, data.error);
                lastError = data;
                continue; // Try next instance
            }

            // Success — return the cobalt response
            console.log(`[Cobalt] Success from ${instance}, status: ${data.status}`);
            return res.status(200).json({
                success: true,
                instance,
                ...data
            });

        } catch (err) {
            console.log(`[Cobalt] Instance ${instance} failed:`, err.message);
            lastError = { error: { code: err.message } };
            continue; // Try next instance
        }
    }

    // All instances failed
    return res.status(502).json({
        success: false,
        error: 'All Cobalt instances failed',
        lastError,
        tried: COBALT_INSTANCES.length
    });
}
