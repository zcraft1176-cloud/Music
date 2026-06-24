/**
 * Vercel Serverless Function — Spotify Playlist Extractor
 * 
 * Extracts track list from a public Spotify playlist URL.
 * Uses Spotify's anonymous web API token (no API key needed).
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

    const playlistId = extractPlaylistId(url);
    if (!playlistId) {
        return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }

    try {
        const result = await getPlaylistTracks(playlistId);
        return res.status(200).json(result);
    } catch (e) {
        console.error('Spotify error:', e.message);
        return res.status(502).json({ 
            error: 'Failed to fetch Spotify playlist', 
            detail: e.message 
        });
    }
}

/**
 * Extract playlist ID from Spotify URL
 */
function extractPlaylistId(url) {
    const urlMatch = url.match(/playlist[/:]([a-zA-Z0-9]{22})/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9]{22}$/.test(url.trim())) return url.trim();
    return null;
}

/**
 * Get anonymous access token from Spotify
 * Spotify's web player uses this endpoint to get temporary tokens
 */
async function getAnonymousToken() {
    const response = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=embed', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Origin': 'https://open.spotify.com',
            'Referer': 'https://open.spotify.com/'
        },
        signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
        throw new Error(`Failed to get Spotify token: ${response.status}`);
    }

    const data = await response.json();
    if (!data.accessToken) {
        throw new Error('No access token returned');
    }
    return data.accessToken;
}

/**
 * Fetch playlist tracks using Spotify's Web API with anonymous token
 */
async function getPlaylistTracks(playlistId) {
    // Strategy 1: Anonymous token + Web API
    try {
        const token = await getAnonymousToken();
        return await fetchWithWebApi(playlistId, token);
    } catch (e) {
        console.log('Web API approach failed:', e.message);
    }

    // Strategy 2: Scrape the embed page
    try {
        return await scrapeEmbedPage(playlistId);
    } catch (e) {
        console.log('Embed scrape failed:', e.message);
    }

    throw new Error('All extraction methods failed — playlist may be private or Spotify changed their API');
}

/**
 * Strategy 1: Use Spotify Web API with anonymous token
 */
async function fetchWithWebApi(playlistId, token) {
    const apiUrl = `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.items(track(name,artists(name))),tracks.total,tracks.next`;
    
    const response = await fetch(apiUrl, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
        throw new Error(`Spotify API returned ${response.status}`);
    }

    const data = await response.json();
    const playlistName = data.name || 'Imported Playlist';

    // Extract tracks from first page
    let allTracks = extractTracksFromItems(data.tracks?.items || []);

    // Paginate if there are more tracks
    let nextUrl = data.tracks?.next;
    let pages = 0;
    while (nextUrl && pages < 10) { // max ~1000 tracks
        const nextResponse = await fetch(nextUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            signal: AbortSignal.timeout(10000)
        });
        if (!nextResponse.ok) break;
        const nextData = await nextResponse.json();
        allTracks = allTracks.concat(extractTracksFromItems(nextData.items || []));
        nextUrl = nextData.next;
        pages++;
    }

    if (allTracks.length === 0) {
        throw new Error('No tracks found in API response');
    }

    return {
        name: playlistName,
        trackCount: allTracks.length,
        tracks: allTracks
    };
}

/**
 * Extract track objects from Spotify API items
 */
function extractTracksFromItems(items) {
    return items
        .filter(item => item?.track && item.track.name)
        .map(item => ({
            title: item.track.name,
            artist: (item.track.artists || []).map(a => a.name).join(', ')
        }));
}

/**
 * Strategy 2: Scrape embed page for track data
 */
async function scrapeEmbedPage(playlistId) {
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
        throw new Error(`Embed page returned ${response.status}`);
    }

    const html = await response.text();
    let tracks = [];
    let playlistName = 'Imported Playlist';

    // Extract playlist name from <title>
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
        playlistName = titleMatch[1]
            .replace(/ \| Spotify$/, '')
            .replace(/ - playlist by .+$/, '')
            .replace(/ on Spotify$/, '')
            .trim();
    }

    // Try oEmbed for better name
    try {
        const oembed = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/playlist/${playlistId}`, {
            signal: AbortSignal.timeout(5000)
        });
        if (oembed.ok) {
            const data = await oembed.json();
            if (data.title) playlistName = data.title;
        }
    } catch (e) {}

    // Find all JSON blobs in the page
    const scriptMatches = html.match(/<script[^>]*>(\{[\s\S]*?\})<\/script>/g) || [];
    
    for (const scriptTag of scriptMatches) {
        try {
            const jsonStr = scriptTag.replace(/<\/?script[^>]*>/g, '');
            const data = JSON.parse(jsonStr);
            const found = deepFindTracks(data);
            if (found.length > 0) {
                tracks = found;
                break;
            }
        } catch (e) {}
    }

    // Regex fallback: look for track name patterns that are NOT spotify URIs
    if (tracks.length === 0) {
        // Pattern: objects with "uri":"spotify:track:...", "title":"real name"
        const pattern = /"uri"\s*:\s*"spotify:track:[^"]+"\s*,\s*"title"\s*:\s*"([^"]+)"\s*,\s*"subtitle"\s*:\s*"([^"]+)"/g;
        let match;
        while ((match = pattern.exec(html)) !== null) {
            const title = match[1];
            // Skip if title is still a URI
            if (!title.startsWith('spotify:')) {
                tracks.push({ title, artist: match[2] });
            }
        }
    }

    // Another regex: find "name":"..." patterns near track context
    if (tracks.length === 0) {
        const pattern2 = /"name"\s*:\s*"([^"]{2,80})"\s*,\s*"artists"\s*:\s*\[\s*\{\s*"name"\s*:\s*"([^"]+)"/g;
        let match;
        while ((match = pattern2.exec(html)) !== null) {
            tracks.push({ title: match[1], artist: match[2] });
        }
    }

    if (tracks.length === 0) {
        throw new Error('Could not extract tracks from embed page');
    }

    // Clean up
    tracks = tracks.map(t => ({
        title: decodeEntities(t.title).trim(),
        artist: decodeEntities(t.artist).trim()
    }));

    return {
        name: decodeEntities(playlistName),
        trackCount: tracks.length,
        tracks
    };
}

/**
 * Deep search for track data in a JSON object
 * Smarter: skip spotify:track: URIs as titles
 */
function deepFindTracks(obj, depth = 0) {
    if (depth > 12 || !obj || typeof obj !== 'object') return [];

    // Look for trackList arrays
    if (Array.isArray(obj.trackList) && obj.trackList.length > 0) {
        const extracted = obj.trackList
            .map(t => resolveTrackFields(t))
            .filter(t => t !== null);
        if (extracted.length > 0) return extracted;
    }

    // Look for items arrays (Web API format)
    if (Array.isArray(obj.items) && obj.items.length > 0) {
        const items = obj.items.filter(i => i?.track?.name);
        if (items.length > 0) {
            return items.map(i => ({
                title: i.track.name,
                artist: (i.track.artists || []).map(a => a.name).join(', ')
            }));
        }
    }

    // Look for arrays of track-like objects
    if (Array.isArray(obj)) {
        const trackLike = obj
            .map(t => resolveTrackFields(t))
            .filter(t => t !== null);
        if (trackLike.length > 3) return trackLike;
    }

    // Recurse
    for (const key of Object.keys(obj)) {
        const result = deepFindTracks(obj[key], depth + 1);
        if (result.length > 0) return result;
    }

    return [];
}

/**
 * Resolve the actual title/artist from a track object,
 * handling various Spotify data shapes
 */
function resolveTrackFields(t) {
    if (!t || typeof t !== 'object') return null;

    let title = null;
    let artist = null;

    // Check various field names for the real title
    const titleCandidates = [t.name, t.title, t.track_name];
    for (const c of titleCandidates) {
        if (c && typeof c === 'string' && !c.startsWith('spotify:') && c.length > 0) {
            title = c;
            break;
        }
    }

    // If title is still a URI-like string, try subtitle
    if (!title && t.subtitle && !t.subtitle.startsWith('spotify:')) {
        title = t.subtitle;
    }

    // If nested track object
    if (!title && t.track && typeof t.track === 'object') {
        title = t.track.name || t.track.title;
        if (t.track.artists) {
            artist = t.track.artists.map(a => a.name).join(', ');
        }
    }

    if (!title) return null;

    // Resolve artist
    if (!artist) {
        if (t.artists && Array.isArray(t.artists)) {
            artist = t.artists.map(a => typeof a === 'string' ? a : a.name).join(', ');
        } else if (t.subtitle && !t.subtitle.startsWith('spotify:')) {
            artist = t.subtitle;
        } else if (t.artist) {
            artist = typeof t.artist === 'string' ? t.artist : t.artist.name || '';
        } else {
            artist = '';
        }
    }

    return { title, artist };
}

/**
 * Decode HTML/JSON entities
 */
function decodeEntities(str) {
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
