/**
 * API Integration Layer - Deezer (Metadata) + Piped (Audio)
 * 
 * Architecture:
 *   Deezer API  → Search, metadata, cover art, browse (NO auth needed)
 *   Piped API   → Audio streaming from YouTube (via PHP proxy)
 *   Jamendo     → Indie music with direct audio (optional, needs API key)
 *   Archive.org → Public domain music with direct audio
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
        this.cache.set(key, { data, timestamp: Date.now() });
    },

    // =====================
    // UNIFIED SEARCH
    // =====================
    async search(query, options = {}) {
        const { limit = 30, hdOnly = false } = options;
        const cacheKey = `search:${query}:${hdOnly}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        const promises = [
            this.deezer.search(query, limit)
        ];

        if (this.hasJamendo()) {
            promises.push(this.jamendo.search(query, 5));
        }

        const results = await Promise.allSettled(promises);
        let tracks = [];
        results.forEach(r => {
            if (r.status === 'fulfilled' && r.value) tracks = tracks.concat(r.value);
        });

        // Deduplicate by title similarity
        const seen = new Set();
        tracks = tracks.filter(t => {
            const key = `${t.title.toLowerCase().substring(0, 25)}-${t.artist.toLowerCase().substring(0, 15)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        if (hdOnly) tracks = tracks.filter(t => (t.bitrate || 0) >= 128);

        this.setCache(cacheKey, tracks.slice(0, limit));
        return tracks.slice(0, limit);
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
            { name: 'Funk', id: 169 },
            { name: 'Punk', id: 152 },
            { name: 'Ambient', id: 106 },
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
        if (track.source !== 'deezer' && track.audioUrl) {
            return track.audioUrl;
        }

        const query = `${track.artist} ${track.title}`;

        // Step 1: YouTube via Piped (filtered — music_songs)
        console.log(`[Step 1] Piped filtered search: ${query}`);
        try {
            const vid = await this.piped.findVideoId(query, track.duration, 'music_songs');
            if (vid) {
                track.videoId = vid;
                track.audioUrl = `yt:${vid}`;
                console.log(`[Step 1] ✅ Found: ${vid}`);
                return track.audioUrl;
            }
        } catch (e) { console.warn('[Step 1] Failed:', e.message); }

        // Step 2: YouTube via Piped (unfiltered — broader results)
        console.log(`[Step 2] Piped unfiltered search: ${query}`);
        try {
            const vid = await this.piped.findVideoId(query, track.duration, null);
            if (vid) {
                track.videoId = vid;
                track.audioUrl = `yt:${vid}`;
                console.log(`[Step 2] ✅ Found: ${vid}`);
                return track.audioUrl;
            }
        } catch (e) { console.warn('[Step 2] Failed:', e.message); }

        // Step 3: YouTube via Invidious (different API, different instances)
        console.log(`[Step 3] Invidious search: ${query}`);
        try {
            const vid = await this.invidious.findVideoId(query, track.duration);
            if (vid) {
                track.videoId = vid;
                track.audioUrl = `yt:${vid}`;
                console.log(`[Step 3] ✅ Found: ${vid}`);
                return track.audioUrl;
            }
        } catch (e) { console.warn('[Step 3] Failed:', e.message); }

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
        async search(query, limit = 30) {
            try {
                const url = `${MusicAPI.config.deezer.baseUrl}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
                const proxyUrl = MusicAPI.getProxyUrl(url);
                const response = await fetch(proxyUrl);
                const data = await response.json();

                if (!data.data) return [];
                return data.data.map(t => this.formatTrack(t));
            } catch (e) {
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
         * Find best matching YouTube video ID for a track
         * Uses title matching + duration proximity to avoid wrong songs
         */
        async findVideoId(query, expectedDuration = 0, filter = 'music_songs') {
            const queryLower = query.toLowerCase();
            const filterParam = filter ? `&filter=${filter}` : '';

            try {
                const data = await this.pipedFetch(
                    `/search?q=${encodeURIComponent(query)}${filterParam}`
                );
                if (!data?.items?.length) return null;

                let candidates = data.items
                    .filter(item => item.type === 'stream' && item.duration > 30 && item.duration < 600);

                if (candidates.length === 0) return null;

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

                    // Penalize if title contains words NOT in the query (likely wrong song)
                    const titleWords = title.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
                    const extraWords = titleWords.filter(w => 
                        !queryLower.includes(w) && !['official', 'video', 'audio', 'music', 'lyric', 'lyrics', 'hd', 'remix'].includes(w)
                    );
                    score -= extraWords.length * 10;

                    return { item, score };
                });

                // Sort by score descending
                scored.sort((a, b) => b.score - a.score);
                
                console.log('Video candidates:', scored.slice(0, 3).map(s => 
                    `"${s.item.title}" score=${s.score.toFixed(0)}`
                ));

                const best = scored[0];
                if (best) {
                    return this.extractVideoId(best.item.url);
                }
            } catch (e) {
                console.warn('Piped search failed:', e.message);
            }

            return null;
        },

        extractVideoId(url) {
            if (!url) return null;
            const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || url.match(/\/([a-zA-Z0-9_-]{11})/);
            return m ? m[1] : (/^[a-zA-Z0-9_-]{11}$/.test(url) ? url : null);
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
        return { deezer: 'Deezer', piped: 'YouTube', jamendo: 'Jamendo', archive: 'Archive' }[source] || source;
    }
};
