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
                <div class="lyrics-panel-title">
                    <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM21 16c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                    </svg>
                    <span>Lyrics</span>
                    <span class="lyrics-track-name"></span>
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
        const tick = () => {
            if (this._isOpen && this._syncedLines.length > 0) {
                const currentTime = this._getCurrentTime();
                if (currentTime !== null) {
                    this._updateHighlight(currentTime);
                }
                this._interpolateScroll();
            }
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
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

        if (this._isOpen && Player.currentTrack) {
            this.fetchForTrack(Player.currentTrack);
        }
    },

    /**
     * Fetch lyrics for a track
     */
    async fetchForTrack(track) {
        if (!track) return;

        const trackKey = `${track.title}-${track.artist}`;
        
        if (this._currentTrackKey === trackKey && (this._syncedLines.length > 0 || this._plainText)) {
            return;
        }

        if (this._cache.has(trackKey)) {
            const cached = this._cache.get(trackKey);
            this._applyLyrics(cached, track);
            return;
        }

        this._currentTrackKey = trackKey;
        this._showLoading(track);

        try {
            this._isFetching = true;

            let data = await this._fetchExact(track.title, track.artist, track.album, track.duration);
            
            if (!data) {
                data = await this._fetchSearch(track.title, track.artist);
            }

            if (data) {
                this._cache.set(trackKey, data);
                this._applyLyrics(data, track);
            } else {
                this._showNotFound(track);
            }
        } catch (e) {
            console.warn('Lyrics fetch error:', e);
            this._showNotFound(track);
        } finally {
            this._isFetching = false;
        }
    },

    /**
     * LRCLIB exact match endpoint
     */
    async _fetchExact(title, artist, album, duration) {
        try {
            const params = new URLSearchParams({
                track_name: title,
                artist_name: artist,
            });
            if (album) params.set('album_name', album);
            if (duration) params.set('duration', Math.round(duration));

            const res = await fetch(`https://lrclib.net/api/get?${params}`, {
                headers: { 'User-Agent': 'MusicFree/1.0' },
                signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (data.syncedLyrics || data.plainLyrics) return data;
            return null;
        } catch {
            return null;
        }
    },

    /**
     * LRCLIB search fallback
     */
    async _fetchSearch(title, artist) {
        try {
            const query = `${title} ${artist}`;
            const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {
                headers: { 'User-Agent': 'MusicFree/1.0' },
                signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) return null;
            const results = await res.json();
            if (!Array.isArray(results) || results.length === 0) return null;

            const titleLower = title.toLowerCase();
            
            const best = results.find(r => 
                r.trackName?.toLowerCase().includes(titleLower) ||
                titleLower.includes(r.trackName?.toLowerCase())
            ) || results[0];

            if (best.syncedLyrics || best.plainLyrics) return best;
            return null;
        } catch {
            return null;
        }
    },

    /**
     * Apply lyrics data to the UI
     */
    _applyLyrics(data, track) {
        this._currentTrackKey = `${track.title}-${track.artist}`;
        
        if (data.syncedLyrics) {
            this._syncedLines = this._parseSyncedLyrics(data.syncedLyrics);
            this._plainText = '';
            this._renderSynced(track);
        } else if (data.plainLyrics) {
            this._syncedLines = [];
            this._plainText = data.plainLyrics;
            this._renderPlain(track);
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
        if (trackName) trackName.textContent = `— ${track.title}`;

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
    _showNotFound(track) {
        if (!this._contentEl) return;

        const trackName = document.querySelector('.lyrics-track-name');
        if (trackName) trackName.textContent = `— ${track.title}`;

        this._contentEl.innerHTML = `
            <div class="lyrics-placeholder">
                <svg class="w-12 h-12 text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <p>No lyrics found</p>
                <p class="text-sm text-gray-500 mt-1">"${track.title}" by ${track.artist}</p>
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
