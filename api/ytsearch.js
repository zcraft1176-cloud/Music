/**
 * yt-dlp-backed YouTube search for the deployed build.
 *
 * Every public Piped/Invidious instance is down more often than not, which
 * leaves every track unresolvable and the whole library unplayable. A local
 * install answers with search-audio.php; Vercel runs no PHP, so this function
 * runs the same extractor — a static Linux build bundled in bin/.
 *
 * SEARCH ONLY. Listing needs no player API, so it survives the datacenter-IP
 * bot check that blocks URL resolution up here (measured: every player client
 * answers "Sign in to confirm you're not a bot"). Do not grow a resolve or
 * download branch in this file — it would fail for everyone.
 *
 * The reply mimics the Piped search shape. api.js then scores it with the same
 * code it uses for a real instance: this returns CANDIDATES and never picks
 * one, so the winning upload does not change with the source.
 *
 *   ?q=Artist+Title[&n=5]
 */
const { spawnSync } = require('child_process');

const BIN = `${process.cwd()}/bin/yt-dlp_linux`;

/**
 * Piped-shaped items from yt-dlp's JSON lines. Exported so a test can pin the
 * shape without a Linux binary on the machine runnning the test.
 */
function parseItems(stdout) {
    const items = [];
    for (const line of String(stdout || '').split('\n')) {
        let d;
        try {
            d = JSON.parse(line);
        } catch (e) {
            continue;
        }
        if (!d || !d.id) continue;

        // Same guard api.js applies to Piped results.
        const id = String(d.id);
        if (!/^[A-Za-z0-9_-]{11}$/.test(id)) continue;

        items.push({
            type: 'stream',
            title: String(d.title || ''),
            uploaderName: String(d.uploader || d.channel || ''),
            duration: parseInt(d.duration, 10) || 0,
            url: `https://www.youtube.com/watch?v=${id}`,
        });
    }
    return items;
}

function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const q = String(req.query.q || '').trim();
    const n = Math.min(10, Math.max(1, parseInt(req.query.n, 10) || 5));
    if (q === '') return res.status(400).json({ items: [] });

    // --dump-json, not --print: --print needs a "%(field)s" template, which the
    // PHP twin cannot survive on Windows (escapeshellarg() eats every %). Same
    // flag both sides so the two backends cannot drift apart.
    const r = spawnSync(
        BIN,
        ['--no-warnings', '--flat-playlist', '--dump-json', `ytsearch${n}:${q}`],
        { encoding: 'utf8', timeout: 25000, maxBuffer: 8 * 1024 * 1024 }
    );

    if (r.error) {
        return res.status(502).json({ items: [], error: `spawn failed: ${r.error.message}` });
    }

    return res.status(200).json({ items: parseItems(r.stdout) });
}

module.exports = handler;
module.exports.parseItems = parseItems;
