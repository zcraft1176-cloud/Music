/**
 * Vercel Serverless Function — Spotify Playlist Scraper
 * 
 * Extracts track list from a public Spotify playlist URL
 * by fetching the embed page and parsing the track data.
 * No Spotify API key required.
 */

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    // Extract playlist ID from various Spotify URL formats
    const playlistId = extractPlaylistId(url);
    if (!playlistId) {
        return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }

    try {
        const result = await scrapeSpotifyPlaylist(playlistId);
        return res.status(200).json(result);
    } catch (e) {
        console.error('Spotify scrape error:', e.message);
        return res.status(502).json({ 
            error: 'Failed to fetch Spotify playlist', 
            detail: e.message 
        });
    }
}

/**
 * Extract playlist ID from Spotify URL
 * Supports:
 *   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
 *   spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
 */
function extractPlaylistId(url) {
    // Standard URL format
    const urlMatch = url.match(/playlist[/:]([a-zA-Z0-9]{22})/);
    if (urlMatch) return urlMatch[1];

    // Try as plain ID
    if (/^[a-zA-Z0-9]{22}$/.test(url.trim())) return url.trim();

    return null;
}

/**
 * Scrape playlist data from Spotify's embed page
 */
async function scrapeSpotifyPlaylist(playlistId) {
    // Fetch the embed page — contains track data in JSON
    const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
    
    const response = await fetch(embedUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
        throw new Error(`Spotify returned ${response.status} — playlist may be private or not exist`);
    }

    const html = await response.text();

    // Try to extract from <script id="__NEXT_DATA__"> or resource JSON
    let tracks = [];
    let playlistName = 'Imported Playlist';

    // Method 1: Extract from __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
        try {
            const data = JSON.parse(nextDataMatch[1]);
            const entity = data?.props?.pageProps?.state?.data?.entity;
            if (entity) {
                playlistName = entity.name || playlistName;
                const items = entity.trackList || [];
                tracks = items.map(item => ({
                    title: item.title || '',
                    artist: item.subtitle || ''
                })).filter(t => t.title);
            }
        } catch (e) {
            console.log('__NEXT_DATA__ parse failed, trying alternatives');
        }
    }

    // Method 2: Extract from embedded JSON resource link
    if (tracks.length === 0) {
        const resourceMatch = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g);
        if (resourceMatch) {
            for (const scriptTag of resourceMatch) {
                try {
                    const jsonStr = scriptTag.replace(/<\/?script[^>]*>/g, '');
                    const data = JSON.parse(jsonStr);
                    // Deep search for track data
                    const found = findTracksInObject(data);
                    if (found.tracks.length > 0) {
                        tracks = found.tracks;
                        playlistName = found.name || playlistName;
                        break;
                    }
                } catch (e) {}
            }
        }
    }

    // Method 3: Regex fallback — find track/artist patterns in raw HTML
    if (tracks.length === 0) {
        // Look for patterns like "title":"...", common in Spotify's React hydration data
        const titleArtistPairs = [];
        const trackRegex = /"title"\s*:\s*"([^"]+)"[^}]*?"subtitle"\s*:\s*"([^"]+)"/g;
        let match;
        while ((match = trackRegex.exec(html)) !== null) {
            titleArtistPairs.push({ title: match[1], artist: match[2] });
        }
        if (titleArtistPairs.length > 0) {
            tracks = titleArtistPairs;
        }

        // Try playlist name
        const nameMatch = html.match(/<title>([^<]+)<\/title>/);
        if (nameMatch) {
            playlistName = nameMatch[1].replace(/ \| Spotify$/, '').replace(/ - playlist by .+$/, '').trim();
        }
    }

    // Method 4: Use Spotify's oEmbed for name at least
    if (playlistName === 'Imported Playlist') {
        try {
            const oembed = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/playlist/${playlistId}`, {
                signal: AbortSignal.timeout(5000)
            });
            if (oembed.ok) {
                const data = await oembed.json();
                playlistName = data.title || playlistName;
            }
        } catch (e) {}
    }

    if (tracks.length === 0) {
        throw new Error('Could not extract tracks — playlist may be private, empty, or Spotify changed their page structure');
    }

    // Clean up track data
    tracks = tracks.map(t => ({
        title: decodeHtmlEntities(t.title).trim(),
        artist: decodeHtmlEntities(t.artist).trim()
    }));

    return {
        name: decodeHtmlEntities(playlistName),
        trackCount: tracks.length,
        tracks
    };
}

/**
 * Recursively search an object for track-like data
 */
function findTracksInObject(obj, depth = 0) {
    if (depth > 10 || !obj || typeof obj !== 'object') return { tracks: [], name: null };

    // Check if this object has trackList
    if (Array.isArray(obj.trackList) && obj.trackList.length > 0) {
        return {
            name: obj.name || null,
            tracks: obj.trackList.map(t => ({
                title: t.title || t.name || '',
                artist: t.subtitle || t.artist || t.artists?.map(a => a.name).join(', ') || ''
            })).filter(t => t.title)
        };
    }

    // Check if this is an array of track-like objects
    if (Array.isArray(obj)) {
        const trackLike = obj.filter(item => item && (item.title || item.name) && (item.subtitle || item.artist || item.artists));
        if (trackLike.length > 3) {
            return {
                name: null,
                tracks: trackLike.map(t => ({
                    title: t.title || t.name || '',
                    artist: t.subtitle || t.artist || t.artists?.map?.(a => a.name)?.join(', ') || ''
                }))
            };
        }
    }

    // Recurse into children
    for (const key of Object.keys(obj)) {
        const result = findTracksInObject(obj[key], depth + 1);
        if (result.tracks.length > 0) return result;
    }

    return { tracks: [], name: null };
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/\\u0026/g, '&')
        .replace(/\\u003c/g, '<')
        .replace(/\\u003e/g, '>');
}
