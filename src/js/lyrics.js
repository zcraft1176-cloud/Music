/**
 * Lyrics Module — LRCLIB Synced Lyrics (v2 — Low Latency)
 * 
 * Performance optimizations:
 *   - Negative timing offset (-0.3s) to anticipate lyrics
 *   - requestAnimationFrame loop for 60fps sync (not relying on timeupdate)
 *   - Fast scroll interpolation instead of smooth scroll
 *   - Cached DOM references to avoid querySelectorAll per frame
 *   - Binary search for O(log n) line lookup
 */

const Lyrics = {
    // State
    _cache: new Map(),
    _currentTrackKey: null,
    _syncedLines: [],     // [{time: seconds, text: string}]
    _plainText: '',
    _activeLine: -1,
    _isOpen: false,
    _isFetching: false,

    // Performance: cached DOM refs
    _lineElements: [],
    _contentEl: null,
    _currentScrollTop: 0,
    _targetScrollTop: 0,
    _rafId: null,

    // Timing offset: show lyrics this many seconds EARLY
    // Negative = lyrics appear before the timestamp (feels more natural)
    TIMING_OFFSET: -0.3,

    // Persisted cache: a reload should not refetch every track.
    CACHE_KEY: 'msicfree.lyrics.v1',
    CACHE_MAX: 60,

    /**
     * Initialize lyrics module
     */
    init() {
        this._createPanel();
        this._setupListeners();
        this._startSyncLoop();
        console.log('Lyrics module initialized');
    },

    /**
     * Create the lyrics panel overlay
     */
    _createPanel() {
        const panel = document.createElement('div');
        panel.id = 'lyricsPanel';
        panel.className = 'lyrics-panel';
        panel.innerHTML = `
            <div class="lyrics-panel-header">
                <div class="lyrics-header-text">
                    <div class="lyrics-panel-title">
                        <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM21 16c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                        </svg>
                        <span>Lyrics</span>
                        <span class="lyrics-track-name"></span>
                    </div>
                    <div class="lyrics-meta" id="lyricsMeta"></div>
                </div>
                <button id="lyricsCloseBtn" class="lyrics-close-btn" aria-label="Close lyrics">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div id="lyricsContent" class="lyrics-content">
                <div class="lyrics-placeholder">
                    <svg class="w-12 h-12 text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                    </svg>
                    <p>Play a song to see lyrics</p>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        this._contentEl = document.getElementById('lyricsContent');
        this._metaEl = document.getElementById('lyricsMeta');
    },

    /**
     * Setup event listeners
     */
    _setupListeners() {
        document.getElementById('lyricsCloseBtn')?.addEventListener('click', () => this.toggle());
        document.getElementById('lyricsToggleBtn')?.addEventListener('click', () => this.toggle());
        document.getElementById('mobileExpLyrics')?.addEventListener('click', () => this.toggle());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._isOpen) this.toggle();
        });
    },

    /**
     * Start the high-frequency sync loop using requestAnimationFrame.
     * This runs at 60fps and reads current time directly from the audio/YT player,
     * instead of waiting for the browser's timeupdate event (~250ms interval).
     */
    _startSyncLoop() {
        // Cancel any existing loop first to prevent stacking
        this._stopSyncLoop();

        const tick = () => {
            // Keep looping for as long as the panel is open. This used to stop
            // the loop when _syncedLines was empty -- which is exactly the state
            // right after the panel opens, because the fetch is async. The loop
            // died a frame before the lyrics arrived and nothing ever restarted
            // it, so the words appeared but never followed the song.
            if (this._isOpen) {
                const currentTime = this._getCurrentTime();
                if (currentTime !== null && this._syncedLines.length > 0) {
                    this._updateHighlight(currentTime);
                }
                if (this._syncedLines.length > 0) {
                    this._interpolateScroll();
                }
                this._rafId = requestAnimationFrame(tick);
            } else {
                this._rafId = null;
            }
        };
        this._rafId = requestAnimationFrame(tick);
    },

    /**
     * Stop the sync loop to save CPU when lyrics panel is closed
     */
    _stopSyncLoop() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    },

    /**
     * Get current playback time directly from the active source.
     * Much more responsive than waiting for timeupdate callbacks.
     */
    _getCurrentTime() {
        try {
            if (Player._source === 'youtube' && Player.ytPlayer && Player.ytReady) {
                return Player.ytPlayer.getCurrentTime() || 0;
            } else if (Player.audio) {
                return Player.audio.currentTime || 0;
            }
        } catch (e) {}
        return null;
    },

    /**
     * Toggle lyrics panel
     */
    toggle() {
        this._isOpen = !this._isOpen;
        const panel = document.getElementById('lyricsPanel');
        if (panel) {
            panel.classList.toggle('open', this._isOpen);
        }

        document.getElementById('lyricsToggleBtn')?.classList.toggle('text-purple-400', this._isOpen);
        document.getElementById('lyricsToggleBtn')?.classList.toggle('text-gray-400', !this._isOpen);
        document.getElementById('mobileExpLyrics')?.classList.toggle('text-purple-400', this._isOpen);
        document.getElementById('mobileExpLyrics')?.classList.toggle('text-gray-500', !this._isOpen);

        if (this._isOpen) {
            // Restart the sync loop when panel opens
            this._startSyncLoop();
            if (Player.currentTrack) {
                this.fetchForTrack(Player.currentTrack);
            }
        } else {
            // Stop the sync loop when panel closes (saves CPU)
            this._stopSyncLoop();
        }
    },

    /**
     * Deezer keeps "(feat. X)", "[Remastered 2011]" and "- Radio Edit" in the
     * title, but LRCLIB's catalogue does not. Strip them for lookups only --
     * the UI still shows the title the user clicked.
     */
    _cleanTitle(title) {
        return String(title || '')
            .replace(/\((?:feat|ft|with)\.?[^)]*\)/gi, ' ')
            .replace(/\[(?:feat|ft|with)\.?[^\]]*\]/gi, ' ')
            .replace(/\s*[-\u2013]\s*(?:remaster(?:ed)?|radio edit|single version|album version|bonus track)\b.*$/i, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    /**
     * LRCLIB stores one artist per field. Deezer sends "A, B feat. C" for
     * collaborations, which never matches -- the first credited name does.
     */
    _cleanArtist(artist) {
        return String(artist || '')
            .split(/,| feat\.?| ft\.?| & | x /i)[0]
            .replace(/\s+/g, ' ')
            .trim();
    },

    /**
     * Duration is part of the key: "Not You" and "Not You (Chinese Version)"
     * are both 153s on Deezer, but a live or extended cut must not reuse the
     * studio recording's lyrics.
     */
    _trackKey(track) {
        return `${track.title}-${track.artist}-${Math.round(track.duration || 0)}`;
    },

    _esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    _formatDuration(sec) {
        const total = Math.round(sec);
        if (!total) return '';
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    },

    /**
     * Metadata strip under the header: artist, album, length and whether the
     * lyrics are time-synced, plain, or the track is instrumental.
     */
    _renderMeta(track, data) {
        if (!this._metaEl) return;
        const parts = [];
        if (track.artist) parts.push(track.artist);
        // LRCLIB sometimes files the artist name in the album field; showing it
        // twice reads like a bug.
        const album = (data && data.albumName) || track.album;
        if (album && album.toLowerCase() !== String(track.artist || '').toLowerCase()) {
            parts.push(album);
        }
        const dur = (data && data.duration) || track.duration;
        if (dur) parts.push(this._formatDuration(dur));
        if (data && data.__fromCache) parts.push('cached');

        let badge = '';
        if (data && data.instrumental) badge = '<span class="lyrics-badge instrumental">Instrumental</span>';
        else if (data && data.syncedLyrics) badge = '<span class="lyrics-badge synced">Synced</span>';
        else if (data && data.plainLyrics) badge = '<span class="lyrics-badge plain">Plain</span>';

        this._metaEl.innerHTML = parts.map(x => this._esc(x)).join(' \u00b7 ') +
            (badge ? (parts.length ? '  ' : '') + badge : '');
    },

    _persist(trackKey, data) {
        try {
            const store = JSON.parse(localStorage.getItem(this.CACHE_KEY) || '{}');
            store[trackKey] = {
                syncedLyrics: data.syncedLyrics || null,
                plainLyrics: data.plainLyrics || null,
                albumName: data.albumName || null,
                duration: data.duration || null,
                instrumental: !!data.instrumental,
                ts: Date.now()
            };
            const keys = Object.keys(store);
            if (keys.length > this.CACHE_MAX) {
                keys.sort((x, y) => store[x].ts - store[y].ts)
                    .slice(0, keys.length - this.CACHE_MAX)
                    .forEach(k => delete store[k]);
            }
            localStorage.setItem(this.CACHE_KEY, JSON.stringify(store));
        } catch (e) { /* private mode / quota -- cache is optional */ }
    },

    _readPersisted(trackKey) {
        try {
            const store = JSON.parse(localStorage.getItem(this.CACHE_KEY) || '{}');
            const hit = store[trackKey];
            if (hit && (hit.syncedLyrics || hit.plainLyrics || hit.instrumental)) {
                hit.__fromCache = true;
                return hit;
            }
        } catch (e) { }
        return null;
    },

    async fetchForTrack(track) {
        if (!track) return;

        const trackKey = this._trackKey(track);

        if (this._currentTrackKey === trackKey && (this._syncedLines.length > 0 || this._plainText)) {
            return;
        }

        if (this._cache.has(trackKey)) {
            this._applyLyrics(this._cache.get(trackKey), track);
            return;
        }

        const stored = this._readPersisted(trackKey);
        if (stored) {
            this._cache.set(trackKey, stored);
            this._applyLyrics(stored, track);
            return;
        }

        this._currentTrackKey = trackKey;
        this._showLoading(track);

        // Skipping tracks quickly used to let an older, slower fetch land after
        // the newer one and overwrite the panel with the wrong song's lyrics.
        const seq = this._fetchSeq = (this._fetchSeq || 0) + 1;
        this._instrumentalHit = null;

        try {
            this._isFetching = true;

            let data = await this._fetchExact(track.title, track.artist, track.album, track.duration);

            if (!data) {
                data = await this._fetchSearch(track.title, track.artist, track.duration);
            }

            // LRCLIB lists instrumental tracks with no words at all. Only fall
            // back to that once the search has failed too -- otherwise the bare
            // entry shadows the lyrics that search would have found.
            if (!data) data = this._instrumentalHit;

            if (seq !== this._fetchSeq) return;

            if (data) {
                this._cache.set(trackKey, data);
                this._persist(trackKey, data);
                this._applyLyrics(data, track);
            } else {
                this._showNotFound(track);
            }
        } catch (e) {
            console.warn('Lyrics fetch error:', e);
            if (seq === this._fetchSeq) this._showNotFound(track);
        } finally {
            this._isFetching = false;
        }
    },

    /**
     * LRCLIB exact match endpoint.
     */
    async _fetchExact(title, artist, album, duration) {
        const base = {
            track_name: this._cleanTitle(title),
            artist_name: this._cleanArtist(artist)
        };

        // LRCLIB rejects the lookup when the duration is off by more than a
        // couple of seconds, so a Deezer duration for a remaster or an extended
        // cut loses an entry that is otherwise sitting right there. Try the
        // precise query first, then the same one without duration/album.
        const withMeta = { ...base };
        if (album) withMeta.album_name = album;
        if (duration) withMeta.duration = Math.round(duration);

        for (const params of [withMeta, base]) {
            const data = await this._lrclibGet(`https://lrclib.net/api/get?${new URLSearchParams(params)}`);
            if (!data) continue;
            if (data.syncedLyrics || data.plainLyrics) return data;
            // Hold it aside. "Kiss Me More" has an exact-duration instrumental
            // entry on LRCLIB, so returning it here would hide the lyrics that
            // the search fallback goes on to find.
            if (data.instrumental && !this._instrumentalHit) this._instrumentalHit = data;
        }
        return null;
    },

    async _lrclibGet(url) {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'MusicFree/1.0' },
                signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    },

    /**
     * LRCLIB search fallback. The old version kept the first result whose title
     * merely overlapped and ignored the artist entirely, so a cover or a live
     * take could win. Score on title, artist and duration, and prefer a
     * time-synced entry over a plain one.
     */
    async _fetchSearch(title, artist, duration) {
        const wantTitle = this._cleanTitle(title).toLowerCase();
        const wantArtist = this._cleanArtist(artist).toLowerCase();
        const query = `${wantTitle} ${wantArtist}`.trim();

        const results = await this._lrclibGet(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
        if (!Array.isArray(results) || results.length === 0) return null;

        const scored = results
            .filter(r => r && (r.syncedLyrics || r.plainLyrics || r.instrumental))
            .map(r => {
                const t = String(r.trackName || '').toLowerCase();
                const a = String(r.artistName || '').toLowerCase();
                let score = 0;
                if (t === wantTitle) score += 60;
                else if (t.includes(wantTitle)) score += 40;
                else if (wantTitle.includes(t)) score += 25;
                if (wantArtist) {
                    if (a === wantArtist) score += 30;
                    else if (a.includes(wantArtist) || wantArtist.includes(a)) score += 15;
                }
                if (duration && r.duration) {
                    score += Math.max(0, 15 - Math.abs(r.duration - duration) * 3);
                }
                if (r.syncedLyrics) score += 10;
                // An instrumental-only result is worth far less than any entry
                // that actually carries words.
                if (!r.syncedLyrics && !r.plainLyrics) score -= 200;
                return { r, score };
            })
            .sort((x, y) => y.score - x.score);

        if (!scored.length) return null;
        const best = scored[0].r;
        if (!best.syncedLyrics && !best.plainLyrics) {
            if (!this._instrumentalHit) this._instrumentalHit = best;
            return null;
        }
        return best;
    },

    /**
     * Apply lyrics data to the UI
     */
    _applyLyrics(data, track) {
        this._currentTrackKey = this._trackKey(track);
        this._renderMeta(track, data);

        if (data.syncedLyrics) {
            this._syncedLines = this._parseSyncedLyrics(data.syncedLyrics);
            this._plainText = '';
            this._renderSynced(track);
        } else if (data.plainLyrics) {
            this._syncedLines = [];
            this._plainText = data.plainLyrics;
            this._renderPlain(track);
        } else {
            // LRCLIB lists instrumental tracks with no lyrics at all.
            this._syncedLines = [];
            this._plainText = '';
            this._showNotFound(track, data);
        }
    },

    /**
     * Parse LRC format synced lyrics
     * Format: [MM:SS.xx] Lyrics text
     */
    _parseSyncedLyrics(lrc) {
        const lines = [];
        const regex = /\[(\d{1,2}):(\d{2})\.(\d{2,3})\]\s*(.*)/;
        
        for (const line of lrc.split('\n')) {
            const match = line.match(regex);
            if (match) {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const ms = parseInt(match[3].padEnd(3, '0'));
                const time = minutes * 60 + seconds + ms / 1000;
                const text = match[4].trim();
                lines.push({ time, text });
            }
        }
        
        return lines.sort((a, b) => a.time - b.time);
    },

    /**
     * Render synced lyrics lines — cache element references for performance
     */
    _renderSynced(track) {
        if (!this._contentEl) return;

        const trackName = document.querySelector('.lyrics-track-name');
        if (trackName) trackName.textContent = `— ${track.title}`;

        this._contentEl.innerHTML = `
            <div class="lyrics-synced">
                ${this._syncedLines.map((line, i) => `
                    <p class="lyrics-line ${line.text === '' ? 'lyrics-gap' : ''}" data-index="${i}">
                        ${line.text || '♪'}
                    </p>
                `).join('')}
            </div>
        `;

        // Cache DOM references — avoids querySelectorAll every frame
        this._lineElements = Array.from(this._contentEl.querySelectorAll('.lyrics-line'));
        this._activeLine = -1;
        this._currentScrollTop = this._contentEl.scrollTop;
        this._targetScrollTop = this._currentScrollTop;
    },

    /**
     * Render plain (non-synced) lyrics
     */
    _renderPlain(track) {
        if (!this._contentEl) return;

        const trackName = document.querySelector('.lyrics-track-name');
        if (trackName) trackName.textContent = `— ${track.title}`;

        const lines = this._plainText.split('\n');
        this._contentEl.innerHTML = `
            <div class="lyrics-plain">
                ${lines.map(line => `
                    <p class="lyrics-line-plain ${line.trim() === '' ? 'lyrics-gap' : ''}">${line || '&nbsp;'}</p>
                `).join('')}
            </div>
        `;
        this._lineElements = [];
    },

    /**
     * Show loading state
     */
    _showLoading(track) {
        if (!this._contentEl) return;

        const trackName = document.querySelector('.lyrics-track-name');
        if (trackName) trackName.textContent = `\u2014 ${track.title}`;
        this._renderMeta(track, null);

        this._contentEl.innerHTML = `
            <div class="lyrics-placeholder">
                <div class="animate-spin w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full mb-3"></div>
                <p>Searching lyrics...</p>
            </div>
        `;
    },

    /**
     * Show not found state
     */
    _showNotFound(track, data) {
        if (!this._contentEl) return;

        const trackName = document.querySelector('.lyrics-track-name');
        if (trackName) trackName.textContent = `\u2014 ${track.title}`;
        this._renderMeta(track, data || null);

        const instrumental = !!(data && data.instrumental);
        const heading = instrumental ? 'Instrumental track' : 'No lyrics found';
        const hint = instrumental
            ? 'LRCLIB lists this one without words'
            : 'Check the spelling of the title or artist';

        this._contentEl.innerHTML = `
            <div class="lyrics-placeholder">
                <svg class="w-12 h-12 text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${instrumental
                        ? 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM21 16c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z'
                        : 'M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'}"/>
                </svg>
                <p>${heading}</p>
                <p class="text-sm text-gray-500 mt-1">"${this._esc(track.title)}" by ${this._esc(track.artist)}</p>
                <p class="text-xs text-gray-600 mt-2">${hint}</p>
            </div>
        `;
    },

    /**
     * Core highlight update — uses binary search + timing offset
     * Called at 60fps from rAF loop
     */
    _updateHighlight(currentTime) {
        if (this._lineElements.length === 0) return;

        // Apply negative offset — show lyrics BEFORE they're due
        const adjustedTime = currentTime - this.TIMING_OFFSET;

        // Binary search for the current line (O(log n) vs O(n))
        let lineIndex = this._binarySearch(adjustedTime);

        if (lineIndex === this._activeLine) return;

        const prevLine = this._activeLine;
        this._activeLine = lineIndex;

        // Efficient DOM update — only modify changed elements
        if (prevLine >= 0 && prevLine < this._lineElements.length) {
            this._lineElements[prevLine].classList.remove('active');
            this._lineElements[prevLine].classList.add('past');
        }

        // Mark all lines before current as past (batch update on big jumps like seeking)
        if (Math.abs(lineIndex - prevLine) > 2 || prevLine === -1) {
            for (let i = 0; i < this._lineElements.length; i++) {
                const el = this._lineElements[i];
                if (i < lineIndex) {
                    el.classList.add('past');
                    el.classList.remove('active');
                } else if (i === lineIndex) {
                    el.classList.add('active');
                    el.classList.remove('past');
                } else {
                    el.classList.remove('active', 'past');
                }
            }
        } else {
            if (lineIndex >= 0 && lineIndex < this._lineElements.length) {
                this._lineElements[lineIndex].classList.remove('past');
                this._lineElements[lineIndex].classList.add('active');
            }
        }

        // Set scroll target (actual scrolling happens in _interpolateScroll)
        if (lineIndex >= 0 && this._lineElements[lineIndex]) {
            const containerHeight = this._contentEl.clientHeight;
            this._targetScrollTop = Math.max(0,
                this._lineElements[lineIndex].offsetTop - this._contentEl.offsetTop - (containerHeight * 0.4)
            );
        }
    },

    /**
     * Binary search: find the last line whose time <= adjustedTime
     */
    _binarySearch(time) {
        const lines = this._syncedLines;
        let lo = 0, hi = lines.length - 1, result = -1;
        
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (lines[mid].time <= time) {
                result = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        
        return result;
    },

    /**
     * Smooth scroll interpolation — runs every rAF frame.
     * Lerp (linear interpolation) for fast but smooth scrolling.
     * Factor 0.15 = reaches target in ~150ms (much faster than CSS smooth scroll ~500ms+)
     */
    _interpolateScroll() {
        if (!this._contentEl) return;

        const diff = this._targetScrollTop - this._currentScrollTop;
        if (Math.abs(diff) < 1) {
            this._currentScrollTop = this._targetScrollTop;
        } else {
            // Lerp factor: 0.15 means 15% of remaining distance per frame
            // At 60fps this reaches target in ~10 frames = ~166ms
            this._currentScrollTop += diff * 0.15;
        }
        this._contentEl.scrollTop = this._currentScrollTop;
    },

    /**
     * Legacy method — still called from Player but now the rAF loop handles it.
     * Kept for compatibility but does nothing (rAF loop is primary).
     */
    updateSyncedHighlight(currentTime) {
        // No-op: rAF loop handles this now
    },

    /**
     * Called when track changes — auto-fetch if panel is open
     */
    onTrackChange(track) {
        this._syncedLines = [];
        this._plainText = '';
        this._activeLine = -1;
        this._currentTrackKey = null;
        this._lineElements = [];
        // Discard any in-flight fetch for the previous track.
        this._fetchSeq = (this._fetchSeq || 0) + 1;
        this._instrumentalHit = null;

        if (this._isOpen && track) {
            this.fetchForTrack(track);
        }
    },

    /**
     * Reset state
     */
    reset() {
        this._syncedLines = [];
        this._plainText = '';
        this._activeLine = -1;
        this._currentTrackKey = null;
        this._lineElements = [];
        
        if (this._contentEl) {
            this._contentEl.innerHTML = `
                <div class="lyrics-placeholder">
                    <svg class="w-12 h-12 text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                    </svg>
                    <p>Play a song to see lyrics</p>
                </div>
            `;
        }
    }
};
