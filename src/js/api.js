/**
 * API Integration Layer - Deezer (Metadata) + Piped (Audio)
 * 
 * Architecture:
 *   Deezer API  → Search, metadata, cover art, browse (NO auth needed)
 *   Piped API   → Audio streaming from YouTube (via PHP proxy)
 *   Jamendo     → Indie music with direct audio (optional, needs API key)
 *   Archive.org → Public domain music with direct audio
 *
 * IMPORTANT (B4): When adding/removing Piped or Invidious instances below,
 * you MUST also update the whitelist in BOTH proxy files:
 *   - proxy.php          (local XAMPP proxy)
 *   - api/proxy.js       (Vercel serverless proxy)
 * All three files must stay in sync to avoid 403 errors.
 */

const MusicAPI = {
    config: {
        deezer: {
            baseUrl: 'https://api.deezer.com'
        },
        piped: {
            instances: [
                'https://api.piped.private.coffee',
                'https://pipedapi.kavin.rocks',
                'https://pipedapi.adminforge.de',
                'https://pipedapi.leptons.xyz',
                'https://pipedapi.in.projectsegfau.lt'
            ],
            currentIndex: 0
        },
        invidious: {
            instances: [
                'https://inv.thepixora.com',
                'https://invidious.f5.si',
                'https://yt.chocolatemoo53.com'
            ],
            currentIndex: 0
        },
        jamendo: {
            baseUrl: 'https://api.jamendo.com/v3.0',
            clientId: localStorage.getItem('jamendoClientId') || '',
            format: 'ogg'
        }
    },

    cache: new Map(),
    cacheTimeout: 5 * 60 * 1000,
    cacheMaxSize: 100,

    /**
     * B2: Health check — validate instances on startup.
     * Pings each Piped/Invidious instance and removes dead ones.
     * Call this during app initialization (e.g., from app.js init).
     */
    async healthCheckInstances() {
        console.log('[HealthCheck] Validating Piped/Invidious instances...');

        const checkInstance = async (url, testPath) => {
            try {
                const proxyUrl = this.getProxyUrl(`${url}${testPath}`);
                const ctrl = new AbortController();
                const tm = setTimeout(() => ctrl.abort(), 8000);
                const res = await fetch(proxyUrl, { signal: ctrl.signal });
                clearTimeout(tm);
                return res.ok;
            } catch {
                return false;
            }
        };

        // Check Piped instances
        const pipedResults = await Promise.allSettled(
            this.config.piped.instances.map(async (url) => {
                const alive = await checkInstance(url, '/healthcheck');
                return { url, alive };
            })
        );
        const alivePiped = pipedResults
            .filter(r => r.status === 'fulfilled' && r.value.alive)
            .map(r => r.value.url);
        const deadPiped = this.config.piped.instances.filter(u => !alivePiped.includes(u));
        if (deadPiped.length > 0) {
            console.warn('[HealthCheck] Dead Piped instances removed:', deadPiped);
        }
        if (alivePiped.length > 0) {
            this.config.piped.instances = alivePiped;
            this.config.piped.currentIndex = 0;
            console.log(`[HealthCheck] ✅ ${alivePiped.length} Piped instances alive`);
        } else {
            console.warn('[HealthCheck] ⚠️ All Piped instances are down! Keeping original list as fallback.');
        }

        // Check Invidious instances
        const invResults = await Promise.allSettled(
            this.config.invidious.instances.map(async (url) => {
                const alive = await checkInstance(url, '/api/v1/stats');
                return { url, alive };
            })
        );
        const aliveInv = invResults
            .filter(r => r.status === 'fulfilled' && r.value.alive)
            .map(r => r.value.url);
        const deadInv = this.config.invidious.instances.filter(u => !aliveInv.includes(u));
        if (deadInv.length > 0) {
            console.warn('[HealthCheck] Dead Invidious instances removed:', deadInv);
        }
        if (aliveInv.length > 0) {
            this.config.invidious.instances = aliveInv;
            this.config.invidious.currentIndex = 0;
            console.log(`[HealthCheck] ✅ ${aliveInv.length} Invidious instances alive`);
        } else {
            console.warn('[HealthCheck] ⚠️ All Invidious instances are down! Keeping original list as fallback.');
        }
    },

    /**
     * Get proxy URL - auto-detect local vs Vercel
     */
    getProxyUrl(url) {
        const proxyBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'proxy.php'
            : '/api/proxy';
        return `${proxyBase}?url=${encodeURIComponent(url)}`;
    },

    setJamendoClientId(id) {
        this.config.jamendo.clientId = id;
        localStorage.setItem('jamendoClientId', id);
    },

    hasJamendo() {
        return !!this.config.jamendo.clientId;
    },

    getCached(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) return cached.data;
        this.cache.delete(key);
        return null;
    },

    setCache(key, data) {
        // Evict oldest entries when cache exceeds max size
        if (this.cache.size >= this.cacheMaxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, { data, timestamp: Date.now() });
    },

    // =====================
    // UNIFIED SEARCH
    // =====================

    /**
     * Detect if a query looks like lyrics rather than a song/artist name.
     * Heuristics:
     *   - 5+ words (lyrics are usually phrases, not just "artist - title")
     *   - Contains common lyric patterns ("I ", "you ", "we ", "my ", "love", etc.)
     *   - Not a typical "artist - title" pattern
     */
    _looksLikeLyrics(query) {
        const words = query.trim().split(/\s+/);
        if (words.length >= 5) return true;

        const lyricPatterns = [
            /\bi\s+(am|was|want|just|don't|can't|feel|know|love|need|think|see|wish|remember|never|wanna|gotta)\b/i,
            /\byou\s+(are|know|make|don't|can't|said|were|got)\b/i,
            /\bwe\s+(are|were|can|don't)\b/i,
            /\b(never gonna|gotta make|wanna tell|don't stop|can't stop|let me|hold me|take me|give me|tell me)\b/i,
            /\b(my heart|my love|my soul|your eyes|your love|your heart)\b/i,
        ];
        return lyricPatterns.some(p => p.test(query));
    },

    async search(query, options = {}) {
        const { limit = 30, hdOnly = false, signal = null } = options;
        const cacheKey = `search:${query}:${hdOnly}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        const promises = [
            this.deezer.search(query, limit, signal),
            this.piped.searchTracks(query, 20)
        ];

        if (this.hasJamendo()) {
            promises.push(this.jamendo.search(query, 5));
        }

        // If query looks like lyrics, also search via LRCLIB
        const isLyrics = this._looksLikeLyrics(query);
        if (isLyrics) {
            promises.push(this.searchByLyrics(query, 10));
        }

        const results = await Promise.allSettled(promises);
        // Collect Deezer results first (index 0), then YouTube (index 1), then rest
        let deezerTracks = [];
        let ytTracks = [];
        let otherTracks = [];
        results.forEach((r, i) => {
            if (r.status !== 'fulfilled' || !r.value) return;
            if (i === 0) deezerTracks = r.value;
            else if (i === 1) ytTracks = r.value;
            else otherTracks = otherTracks.concat(r.value);
        });

        // Merge: Deezer first, then others, then YouTube at the end
        let tracks = [...deezerTracks, ...otherTracks, ...ytTracks];

        // Deduplicate by title similarity — Deezer results win over YouTube
        const seen = new Set();
        tracks = tracks.filter(t => {
            const key = `${t.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 25)}-${t.artist.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // If lyrics search found results, prioritize them at the top
        if (isLyrics) {
            const lyricsTracks = tracks.filter(t => t._foundViaLyrics);
            const rest = tracks.filter(t => !t._foundViaLyrics);
            tracks = [...lyricsTracks, ...rest];
        }

        if (hdOnly) tracks = tracks.filter(t => (t.bitrate || 0) >= 128);

        const finalLimit = Math.max(limit, 50); // Allow more results since we have 2 sources
        this.setCache(cacheKey, tracks.slice(0, finalLimit));
        return tracks.slice(0, finalLimit);
    },

    // =====================
    // LYRICS SEARCH (LRCLIB)
    // =====================
    /**
     * Search songs by lyrics using LRCLIB API (free, no auth, CORS-enabled).
     * Returns results cross-referenced with Deezer for full metadata.
     */
    async searchByLyrics(query, limit = 10) {
        try {
            const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'MusicFree/1.0 (https://github.com/zcraft1176-cloud/Music)' },
                signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) return [];
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) return [];

            // Deduplicate LRCLIB results by trackName + artistName
            const seenLrc = new Set();
            const uniqueResults = data.filter(item => {
                const key = `${(item.trackName || '').toLowerCase()}-${(item.artistName || '').toLowerCase()}`;
                if (seenLrc.has(key)) return false;
                seenLrc.add(key);
                return true;
            }).slice(0, limit);

            // Cross-search each result on Deezer for full metadata
            const deezerPromises = uniqueResults.map(async (item) => {
                const searchQuery = `${item.trackName} ${item.artistName}`;
                try {
                    const deezerResults = await this.deezer.search(searchQuery, 1);
                    if (deezerResults.length > 0) {
                        const track = deezerResults[0];
                        track._foundViaLyrics = true;
                        track._lyricsSnippet = this._extractLyricsSnippet(item.plainLyrics, query);
                        return track;
                    }
                } catch {}

                // Fallback: return a basic track object from LRCLIB data only
                return {
                    id: `lrclib_${item.id}`,
                    source: 'deezer',
                    title: item.trackName || 'Unknown',
                    artist: item.artistName || 'Unknown',
                    album: item.albumName || '',
                    cover: '',
                    duration: item.duration || 0,
                    audioUrl: null,
                    videoId: null,
                    previewUrl: null,
                    isPreview: false,
                    bitrate: 0,
                    format: '',
                    genre: [],
                    license: '',
                    releaseDate: '',
                    _foundViaLyrics: true,
                    _lyricsSnippet: this._extractLyricsSnippet(item.plainLyrics, query)
                };
            });

            const results = await Promise.allSettled(deezerPromises);
            return results
                .filter(r => r.status === 'fulfilled' && r.value)
                .map(r => r.value);
        } catch (e) {
            console.warn('LRCLIB lyrics search error:', e);
            return [];
        }
    },

    /**
     * Extract a short snippet of lyrics around the matching query
     */
    _extractLyricsSnippet(plainLyrics, query) {
        if (!plainLyrics) return '';
        const lines = plainLyrics.split('\n').filter(l => l.trim());
        const queryLower = query.toLowerCase();

        // Find the line that best matches the query
        let bestLine = -1;
        let bestScore = 0;
        for (let i = 0; i < lines.length; i++) {
            const lineLower = lines[i].toLowerCase();
            if (lineLower.includes(queryLower)) {
                bestLine = i;
                bestScore = 999;
                break;
            }
            // Partial word matching
            const queryWords = queryLower.split(/\s+/);
            const matchCount = queryWords.filter(w => lineLower.includes(w)).length;
            if (matchCount > bestScore) {
                bestScore = matchCount;
                bestLine = i;
            }
        }

        if (bestLine === -1) return lines.slice(0, 2).join(' / ');

        // Return 1-2 lines around the match
        const start = Math.max(0, bestLine);
        const end = Math.min(lines.length, bestLine + 2);
        return lines.slice(start, end).join(' / ');
    },

    async getTrending(options = {}) {
        const { limit = 20 } = options;
        const cacheKey = `trending:${limit}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const promises = [
                this.deezer.getChart(limit)
            ];
            if (this.hasJamendo()) promises.push(this.jamendo.getPopular(5));

            const results = await Promise.allSettled(promises);
            let tracks = [];
            results.forEach(r => {
                if (r.status === 'fulfilled' && r.value) tracks = tracks.concat(r.value);
            });

            this.setCache(cacheKey, tracks.slice(0, limit));
            return tracks.slice(0, limit);
        } catch (e) {
            console.error('Trending error:', e);
            return [];
        }
    },

    getGenres() {
        return [
            { name: 'Pop', id: 132 },
            { name: 'Rock', id: 152 },
            { name: 'Hip Hop', id: 116 },
            { name: 'Electronic', id: 106 },
            { name: 'Jazz', id: 129 },
            { name: 'Classical', id: 98 },
            { name: 'R&B', id: 165 },
            { name: 'Metal', id: 464 },
            { name: 'Folk', id: 466 },
            { name: 'Blues', id: 153 },
            { name: 'Reggae', id: 144 },
            { name: 'Country', id: 84 },
            { name: 'Indie', id: 85 },
            { name: 'Soul', id: 169 },
            { name: 'Funk', id: 197 },
            { name: 'Punk', id: 173 },
            { name: 'Ambient', id: 95 },
            { name: 'Latin', id: 197 }
        ];
    },

    async getByGenre(genre, options = {}) {
        const { limit = 50, offset = 0 } = options;
        const genreObj = typeof genre === 'object' ? genre : this.getGenres().find(g => g.name.toLowerCase() === genre.toLowerCase());
        const genreName = genreObj?.name || genre;
        const genreId = genreObj?.id;
        const cacheKey = `genre:${genreName}:${limit}:${offset}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        let tracks = [];
        try {
            // Method 1: Deezer genre chart endpoint (best results)
            if (genreId) {
                const chartUrl = `${this.config.deezer.baseUrl}/chart/${genreId}/tracks?limit=${limit}&index=${offset}`;
                const proxyUrl = this.getProxyUrl(chartUrl);
                const res = await fetch(proxyUrl);
                const data = await res.json();
                if (data.data && data.data.length > 0) {
                    tracks = data.data.map(t => this.deezer.formatTrack(t));
                }
            }

            // Method 2: If chart gave too few results, supplement with editorial playlist search
            if (tracks.length < 10 && genreId) {
                const artistsUrl = `${this.config.deezer.baseUrl}/genre/${genreId}/artists?limit=10`;
                const proxyUrl2 = this.getProxyUrl(artistsUrl);
                const res2 = await fetch(proxyUrl2);
                const data2 = await res2.json();
                if (data2.data) {
                    // Get top tracks from genre artists
                    const artistPromises = data2.data.slice(0, 5).map(async artist => {
                        try {
                            const topUrl = `${this.config.deezer.baseUrl}/artist/${artist.id}/top?limit=10`;
                            const proxyUrl3 = this.getProxyUrl(topUrl);
                            const res3 = await fetch(proxyUrl3);
                            const data3 = await res3.json();
                            return data3.data ? data3.data.map(t => this.deezer.formatTrack(t)) : [];
                        } catch { return []; }
                    });
                    const artistTracks = (await Promise.all(artistPromises)).flat();
                    // Merge without duplicates
                    const existingIds = new Set(tracks.map(t => t.id));
                    for (const t of artistTracks) {
                        if (!existingIds.has(t.id)) {
                            tracks.push(t);
                            existingIds.add(t.id);
                        }
                        if (tracks.length >= limit) break;
                    }
                }
            }

            // Method 3: Fallback to search with better query
            if (tracks.length < 5) {
                const fallbackTracks = await this.deezer.search(`genre:"${genreName}"`, limit);
                const existingIds = new Set(tracks.map(t => t.id));
                for (const t of fallbackTracks) {
                    if (!existingIds.has(t.id)) tracks.push(t);
                    if (tracks.length >= limit) break;
                }
            }

            this.setCache(cacheKey, tracks);
            return tracks;
        } catch (e) {
            console.error('Genre error:', e);
            return [];
        }
    },

    /**
     * Resolve audio for a track (waterfall fallback chain)
     * Step 1: Piped search with music_songs filter → YouTube IFrame
     * Step 2: Piped search without filter (broader) → YouTube IFrame
     * Step 3: Deezer 30s preview → HTML5 Audio
     */
    async resolveAudioUrl(track) {
        // YouTube tracks from search already have videoId — skip re-search
        if (track.source === 'youtube' && track.videoId) {
            track.audioUrl = `yt:${track.videoId}`;
            return track.audioUrl;
        }
        if (track.source !== 'deezer' && track.audioUrl) {
            return track.audioUrl;
        }

        const query = `${track.artist} ${track.title}`;
        // Collect all fallback video candidates across search steps
        const allVideos = []; // [{id, title}]

        // Step 1: YouTube via Piped (filtered — music_songs)
        console.log(`[Step 1] Piped filtered search: ${query}`);
        try {
            const vids = await this.piped.findVideoIds(query, track.duration, 'music_songs');
            if (vids.length > 0) {
                allVideos.push(...vids);
            }
        } catch (e) { console.warn('[Step 1] Failed:', e.message); }

        // Step 2: YouTube via Piped (unfiltered — broader results)
        if (allVideos.length < 3) {
            console.log(`[Step 2] Piped unfiltered search: ${query}`);
            try {
                const vids = await this.piped.findVideoIds(query, track.duration, null);
                for (const v of vids) {
                    if (!allVideos.some(av => av.id === v.id)) allVideos.push(v);
                }
            } catch (e) { console.warn('[Step 2] Failed:', e.message); }
        }

        // Step 3: YouTube via Invidious (different API, different instances)
        if (allVideos.length < 3) {
            console.log(`[Step 3] Invidious search: ${query}`);
            try {
                const vid = await this.invidious.findVideoId(query, track.duration);
                if (vid && !allVideos.some(av => av.id === vid)) {
                    allVideos.push({ id: vid, title: '' });
                }
            } catch (e) { console.warn('[Step 3] Failed:', e.message); }
        }

        // Use the best video ID and store fallbacks on the track
        if (allVideos.length > 0) {
            const best = allVideos[0];
            track.videoId = best.id;
            track.audioUrl = `yt:${best.id}`;
            // Store remaining as fallbacks with titles for YT embed errors (e.g. error 150)
            track.fallbackVideos = allVideos.slice(1);
            console.log(`[Resolve] ✅ Primary: ${best.id}, Fallbacks: [${track.fallbackVideos.map(v => v.id).join(', ')}]`);
            return track.audioUrl;
        }

        // Step 4: Deezer 30s preview (last resort — better than nothing)
        if (track.previewUrl) {
            console.log(`[Step 4] Falling back to Deezer 30s preview`);
            track.audioUrl = track.previewUrl;
            track.isPreview = true;
            // B5: Notify user about the 30s preview fallback
            if (typeof UI !== 'undefined') {
                UI.showToast(`⚠️ Playing 30s preview — full audio unavailable for "${track.title}"`, 'warning', { closeable: true, duration: 8000 });
            }
            return track.audioUrl;
        }

        console.warn('All resolve steps failed for:', query);
        return null;
    },

    /**
     * Get a direct audio URL suitable for downloading
     * Tries ALL Piped instances, then ALL Invidious instances
     * Returns direct googlevideo.com URL for the audio stream
     */
    async getDirectAudioUrl(track) {
        // Non-YouTube: already has direct URL
        if (track.audioUrl && !track.audioUrl.startsWith('yt:')) {
            return { url: track.audioUrl, format: 'mp3' };
        }

        if (!track.videoId) return null;

        // Try ALL Piped instances for /streams/ endpoint
        const pipedInstances = this.config.piped.instances;
        for (const instance of pipedInstances) {
            try {
                console.log(`[Download] Trying Piped streams: ${instance}`);
                const target = `${instance}/streams/${track.videoId}`;
                const proxyUrl = this.getProxyUrl(target);
                const ctrl = new AbortController();
                const tm = setTimeout(() => ctrl.abort(), 12000);
                const res = await fetch(proxyUrl, { signal: ctrl.signal });
                clearTimeout(tm);
                
                if (!res.ok) continue;
                const data = await res.json();
                
                if (data?.audioStreams?.length > 0) {
                    const audioStreams = data.audioStreams
                        .filter(s => s.mimeType && s.mimeType.includes('audio') && s.url)
                        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                    if (audioStreams.length > 0) {
                        const best = audioStreams[0];
                        const format = best.mimeType.includes('webm') ? 'webm' 
                                     : best.mimeType.includes('mp4') ? 'm4a' 
                                     : 'mp3';
                        console.log(`[Download] ✅ Got audio from Piped: ${format} ${best.bitrate}bps`);
                        return { url: best.url, format, bitrate: best.bitrate, quality: best.quality };
                    }
                }
            } catch (e) {
                console.warn(`[Download] Piped ${instance} failed:`, e.message);
            }
        }

        // Try ALL Invidious instances for audio stream
        const invInstances = this.config.invidious.instances;
        for (const instance of invInstances) {
            try {
                console.log(`[Download] Trying Invidious: ${instance}`);
                const target = `${instance}/api/v1/videos/${track.videoId}`;
                const proxyUrl = this.getProxyUrl(target);
                const ctrl = new AbortController();
                const tm = setTimeout(() => ctrl.abort(), 12000);
                const res = await fetch(proxyUrl, { signal: ctrl.signal });
                clearTimeout(tm);
                
                if (!res.ok) continue;
                const data = await res.json();
                
                if (data?.adaptiveFormats?.length > 0) {
                    const audioFormats = data.adaptiveFormats
                        .filter(f => f.type && f.type.startsWith('audio/') && f.url)
                        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                    if (audioFormats.length > 0) {
                        const best = audioFormats[0];
                        const format = best.type.includes('webm') ? 'webm'
                                     : best.type.includes('mp4') ? 'm4a'
                                     : 'mp3';
                        console.log(`[Download] ✅ Got audio from Invidious: ${format} ${best.bitrate}bps`);
                        return { url: best.url, format, bitrate: best.bitrate };
                    }
                }
            } catch (e) {
                console.warn(`[Download] Invidious ${instance} failed:`, e.message);
            }
        }

        console.error('[Download] All instances failed to get audio stream');
        return null;
    },

    // =====================
    // DEEZER API (Metadata)
    // =====================
    deezer: {
        async search(query, limit = 30, signal = null) {
            try {
                const url = `${MusicAPI.config.deezer.baseUrl}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
                const proxyUrl = MusicAPI.getProxyUrl(url);
                const fetchOptions = signal ? { signal } : {};
                const response = await fetch(proxyUrl, fetchOptions);
                const data = await response.json();

                if (!data.data) return [];
                return data.data.map(t => this.formatTrack(t));
            } catch (e) {
                if (e.name === 'AbortError') throw e; // Re-throw abort to let caller handle
                console.error('Deezer search error:', e);
                return [];
            }
        },

        async getChart(limit = 20) {
            try {
                const url = `${MusicAPI.config.deezer.baseUrl}/chart/0/tracks?limit=${limit}`;
                const proxyUrl = MusicAPI.getProxyUrl(url);
                const response = await fetch(proxyUrl);
                const data = await response.json();

                if (!data.data) return [];
                return data.data.map(t => this.formatTrack(t));
            } catch (e) {
                console.error('Deezer chart error:', e);
                return [];
            }
        },

        formatTrack(t) {
            return {
                id: `deezer_${t.id}`,
                source: 'deezer',
                title: t.title || t.title_short || 'Unknown',
                artist: t.artist?.name || 'Unknown',
                album: t.album?.title || '',
                cover: t.album?.cover_big || t.album?.cover_medium || t.album?.cover || '',
                duration: t.duration || 0,
                audioUrl: null,
                videoId: null,
                previewUrl: t.preview || null, // Deezer 30s preview MP3
                isPreview: false,
                bitrate: 160,
                format: 'opus',
                genre: [],
                license: '',
                releaseDate: ''
            };
        }
    },

    // =====================
    // YOUTUBE VIDEO FINDER (Piped search → YouTube IFrame)
    // =====================
    piped: {
        async pipedFetch(path) {
            const cfg = MusicAPI.config.piped;
            for (let i = 0; i < cfg.instances.length; i++) {
                const base = cfg.instances[(cfg.currentIndex + i) % cfg.instances.length];
                const target = `${base}${path}`;
                const proxyUrl = MusicAPI.getProxyUrl(target);
                try {
                    const ctrl = new AbortController();
                    const tm = setTimeout(() => ctrl.abort(), 15000);
                    const res = await fetch(proxyUrl, { signal: ctrl.signal });
                    clearTimeout(tm);
                    if (res.ok) return await res.json();
                } catch (e) {
                    console.warn(`Piped ${base} failed:`, e.message);
                }
            }
            cfg.currentIndex = (cfg.currentIndex + 1) % cfg.instances.length;
            return null;
        },

        /**
         * Find best matching YouTube video IDs for a track
         * Returns an array of up to 3 video IDs, ranked by match quality.
         * Uses title matching + duration proximity to avoid wrong songs.
         */
        async findVideoIds(query, expectedDuration = 0, filter = 'music_songs') {
            const queryLower = query.toLowerCase();
            const filterParam = filter ? `&filter=${filter}` : '';

            try {
                const data = await this.pipedFetch(
                    `/search?q=${encodeURIComponent(query)}${filterParam}`
                );
                if (!data?.items?.length) return [];

                let candidates = data.items
                    .filter(item => item.type === 'stream' && item.duration > 30 && item.duration < 600);

                if (candidates.length === 0) return [];

                // Score each candidate by title match + duration proximity
                const scored = candidates.map(item => {
                    const title = (item.title || '').toLowerCase();
                    const uploader = (item.uploaderName || '').toLowerCase();
                    let score = 0;

                    // Check if the result title contains key words from search query
                    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
                    const matchedWords = queryWords.filter(w => 
                        title.includes(w) || uploader.includes(w)
                    );
                    score += (matchedWords.length / queryWords.length) * 100;

                    // Duration match bonus (max 50 points)
                    if (expectedDuration > 0) {
                        const durationDiff = Math.abs(item.duration - expectedDuration);
                        score += Math.max(0, 50 - durationDiff * 2);
                    }

                    // Bonus: "official" in title suggests original version (+20)
                    if (/\bofficial\b/.test(title)) {
                        score += 20;
                    }

                    // Bonus: uploader/channel name matches the artist (+25)
                    const artistWords = queryLower.split(/\s+/).filter(w => w.length > 2);
                    const artistMatchCount = artistWords.filter(w => uploader.includes(w)).length;
                    if (artistMatchCount >= 2 || (artistWords.length <= 2 && artistMatchCount >= 1)) {
                        score += 25;
                    }

                    // Heavy penalty for alternative/modified versions (-30 each)
                    const altVersionPatterns = [
                        'acoustic', 'live', 'cover', 'remix', 'instrumental',
                        'karaoke', 'slowed', 'reverb', 'sped up', 'nightcore',
                        'mashup', 'unplugged', 'stripped', 'demo', 'radio edit',
                        'extended', 'concert', 'session', 'performance',
                        'piano version', 'guitar version', 'metal version',
                        'bass boosted', '8d audio', 'lofi', 'lo-fi'
                    ];
                    for (const pattern of altVersionPatterns) {
                        if (title.includes(pattern) && !queryLower.includes(pattern)) {
                            score -= 30;
                        }
                    }

                    // Light penalty for extra words not in query
                    const safeWords = new Set([
                        'official', 'video', 'audio', 'music', 'lyric', 'lyrics',
                        'hd', 'hq', '4k', '1080p', 'vevo', 'visualizer',
                        'with', 'feat', 'featuring', 'from', 'the'
                    ]);
                    const titleWords = title.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
                    const extraWords = titleWords.filter(w => 
                        !queryLower.includes(w) && !safeWords.has(w)
                    );
                    score -= extraWords.length * 5;

                    return { item, score };
                });

                // Sort by score descending
                scored.sort((a, b) => b.score - a.score);
                
                console.log('Video candidates:', scored.slice(0, 5).map(s => 
                    `"${s.item.title}" score=${s.score.toFixed(0)}`
                ));

                // Return top 3 as ranked alternatives with titles
                return scored
                    .slice(0, 3)
                    .map(s => ({
                        id: this.extractVideoId(s.item.url),
                        title: s.item.title || ''
                    }))
                    .filter(v => v.id);
            } catch (e) {
                console.warn('Piped search failed:', e.message);
            }

            return [];
        },

        extractVideoId(url) {
            if (!url) return null;
            const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || url.match(/\/([a-zA-Z0-9_-]{11})/);
            return m ? m[1] : (/^[a-zA-Z0-9_-]{11}$/.test(url) ? url : null);
        },

        /**
         * Search YouTube via Piped and return formatted track objects.
         * Used as a parallel search source alongside Deezer.
         */
        async searchTracks(query, limit = 20) {
            try {
                const data = await this.pipedFetch(
                    `/search?q=${encodeURIComponent(query)}&filter=music_songs`
                );
                if (!data?.items?.length) {
                    // Fallback: try without filter
                    const data2 = await this.pipedFetch(
                        `/search?q=${encodeURIComponent(query)}`
                    );
                    if (!data2?.items?.length) return [];
                    return this._formatPipedResults(data2.items, limit);
                }
                return this._formatPipedResults(data.items, limit);
            } catch (e) {
                console.warn('[YT Search] Piped searchTracks failed:', e.message);
                return [];
            }
        },

        /**
         * Format Piped search results into standard track objects
         */
        _formatPipedResults(items, limit) {
            return items
                .filter(item => item.type === 'stream' && item.duration > 30 && item.duration < 600)
                .slice(0, limit)
                .map(item => {
                    const videoId = this.extractVideoId(item.url);
                    if (!videoId) return null;

                    // Parse artist from uploaderName (remove " - Topic" suffix)
                    let artist = (item.uploaderName || 'Unknown')
                        .replace(/\s*-\s*Topic$/i, '')
                        .replace(/\s*VEVO$/i, '')
                        .trim();

                    // Use the best available thumbnail
                    const cover = item.thumbnail || '';

                    return {
                        id: `yt_${videoId}`,
                        source: 'youtube',
                        title: item.title || 'Unknown',
                        artist: artist,
                        album: '',
                        cover: cover,
                        duration: item.duration || 0,
                        audioUrl: `yt:${videoId}`,
                        videoId: videoId,
                        previewUrl: null,
                        isPreview: false,
                        bitrate: 160,
                        format: 'opus',
                        genre: [],
                        license: '',
                        releaseDate: ''
                    };
                })
                .filter(Boolean);
        }
    },

    // =====================
    // INVIDIOUS API (Fallback YouTube search)
    // =====================
    invidious: {
        async invidiousFetch(path) {
            const cfg = MusicAPI.config.invidious;
            for (let i = 0; i < cfg.instances.length; i++) {
                const base = cfg.instances[(cfg.currentIndex + i) % cfg.instances.length];
                const target = `${base}${path}`;
                const proxyUrl = MusicAPI.getProxyUrl(target);
                try {
                    const ctrl = new AbortController();
                    const tm = setTimeout(() => ctrl.abort(), 15000);
                    const res = await fetch(proxyUrl, { signal: ctrl.signal });
                    clearTimeout(tm);
                    if (res.ok) return await res.json();
                } catch (e) {
                    console.warn(`Invidious ${base} failed:`, e.message);
                }
            }
            cfg.currentIndex = (cfg.currentIndex + 1) % cfg.instances.length;
            return null;
        },

        async findVideoId(query, expectedDuration = 0) {
            try {
                const data = await this.invidiousFetch(
                    `/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`
                );
                if (!data || !Array.isArray(data) || data.length === 0) return null;

                const queryLower = query.toLowerCase();
                let candidates = data
                    .filter(item => item.type === 'video' && item.lengthSeconds > 30 && item.lengthSeconds < 600);

                if (candidates.length === 0) return null;

                // Score candidates
                const scored = candidates.map(item => {
                    const title = (item.title || '').toLowerCase();
                    const author = (item.author || '').toLowerCase();
                    let score = 0;

                    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
                    const matchedWords = queryWords.filter(w =>
                        title.includes(w) || author.includes(w)
                    );
                    score += (matchedWords.length / queryWords.length) * 100;

                    if (expectedDuration > 0) {
                        const durationDiff = Math.abs(item.lengthSeconds - expectedDuration);
                        score += Math.max(0, 50 - durationDiff * 2);
                    }

                    // Bonus: "official" in title (+20)
                    if (/\bofficial\b/.test(title)) {
                        score += 20;
                    }

                    // Bonus: channel name matches the artist (+25)
                    const artistWords = queryLower.split(/\s+/).filter(w => w.length > 2);
                    const artistMatchCount = artistWords.filter(w => author.includes(w)).length;
                    if (artistMatchCount >= 2 || (artistWords.length <= 2 && artistMatchCount >= 1)) {
                        score += 25;
                    }

                    // Heavy penalty for alternative/modified versions (-30 each)
                    const altVersionPatterns = [
                        'acoustic', 'live', 'cover', 'remix', 'instrumental',
                        'karaoke', 'slowed', 'reverb', 'sped up', 'nightcore',
                        'mashup', 'unplugged', 'stripped', 'demo', 'radio edit',
                        'extended', 'concert', 'session', 'performance',
                        'piano version', 'guitar version', 'metal version',
                        'bass boosted', '8d audio', 'lofi', 'lo-fi'
                    ];
                    for (const pattern of altVersionPatterns) {
                        if (title.includes(pattern) && !queryLower.includes(pattern)) {
                            score -= 30;
                        }
                    }

                    // Light penalty for extra words not in query
                    const safeWords = new Set([
                        'official', 'video', 'audio', 'music', 'lyric', 'lyrics',
                        'hd', 'hq', '4k', '1080p', 'vevo', 'visualizer',
                        'with', 'feat', 'featuring', 'from', 'the'
                    ]);
                    const titleWords = title.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
                    const extraWords = titleWords.filter(w => 
                        !queryLower.includes(w) && !safeWords.has(w)
                    );
                    score -= extraWords.length * 5;

                    return { item, score };
                });

                scored.sort((a, b) => b.score - a.score);

                console.log('Invidious candidates:', scored.slice(0, 3).map(s =>
                    `"${s.item.title}" score=${s.score.toFixed(0)}`
                ));

                const best = scored[0];
                if (best && best.item.videoId) {
                    return best.item.videoId;
                }
            } catch (e) {
                console.warn('Invidious search failed:', e.message);
            }
            return null;
        }
    },

    // =====================
    // JAMENDO (Indie, optional)
    // =====================
    jamendo: {
        async search(query, limit = 10) {
            if (!MusicAPI.hasJamendo()) return [];
            const params = new URLSearchParams({
                client_id: MusicAPI.config.jamendo.clientId,
                format: 'json', audioformat: MusicAPI.config.jamendo.format,
                search: query, limit, include: 'musicinfo', imagesize: 300
            });
            try {
                const res = await fetch(`${MusicAPI.config.jamendo.baseUrl}/tracks/?${params}`);
                const data = await res.json();
                if (data.headers?.status === 'success') return data.results.map(t => this.fmt(t));
                return [];
            } catch (e) { return []; }
        },

        async getPopular(limit = 10) {
            if (!MusicAPI.hasJamendo()) return [];
            const params = new URLSearchParams({
                client_id: MusicAPI.config.jamendo.clientId,
                format: 'json', audioformat: MusicAPI.config.jamendo.format,
                order: 'popularity_total', limit, include: 'musicinfo', imagesize: 300
            });
            try {
                const res = await fetch(`${MusicAPI.config.jamendo.baseUrl}/tracks/?${params}`);
                const data = await res.json();
                if (data.headers?.status === 'success') return data.results.map(t => this.fmt(t));
                return [];
            } catch (e) { return []; }
        },

        fmt(t) {
            const url = t.audio || t.audiodownload;
            return {
                id: `jamendo_${t.id}`, source: 'jamendo',
                title: t.name || 'Unknown', artist: t.artist_name || 'Unknown',
                album: t.album_name || '', cover: t.album_image || t.image || '',
                duration: parseInt(t.duration) || 0, audioUrl: url, downloadUrl: url,
                bitrate: t.audioformat === 'ogg' ? 320 : 192,
                format: t.audioformat || 'mp3', genre: t.musicinfo?.tags?.genres || [],
                license: t.license_ccurl || '', releaseDate: t.releasedate || ''
            };
        }
    },

    // =====================
    // HELPERS
    // =====================
    getQualityLabel(bitrate) {
        if (bitrate >= 320) return { label: 'HD', class: 'hd', value: `${bitrate}kbps` };
        if (bitrate >= 256) return { label: 'HQ', class: 'hq', value: '256kbps' };
        if (bitrate >= 128) return { label: 'STD', class: 'std', value: '128kbps' };
        return { label: 'LOW', class: 'std', value: `${bitrate}kbps` };
    },

    getSourceLabel(source) {
        return { deezer: 'Deezer', youtube: 'YouTube', piped: 'YouTube', jamendo: 'Jamendo', archive: 'Archive' }[source] || source;
    }
};
