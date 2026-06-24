/**
 * Lyrics Module — LRCLIB Synced Lyrics
 * 
 * Features:
 *   - Fetch lyrics from LRCLIB API (free, no auth)
 *   - Synced (timestamped) lyrics with auto-scroll
 *   - Plain lyrics fallback
 *   - Lyrics panel overlay (desktop & mobile)
 *   - Cache lyrics per track
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

    /**
     * Initialize lyrics module
     */
    init() {
        this._createPanel();
        this._setupListeners();
        console.log('Lyrics module initialized');
    },

    /**
     * Create the lyrics panel overlay
     */
    _createPanel() {
        // Desktop lyrics panel (slides up above player bar)
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
    },

    /**
     * Setup event listeners
     */
    _setupListeners() {
        // Close button
        document.getElementById('lyricsCloseBtn')?.addEventListener('click', () => this.toggle());

        // Desktop lyrics button (in player bar volume section)
        document.getElementById('lyricsToggleBtn')?.addEventListener('click', () => this.toggle());

        // Mobile lyrics button (in expanded player)
        document.getElementById('mobileExpLyrics')?.addEventListener('click', () => this.toggle());

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._isOpen) this.toggle();
        });
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

        // Update button active states
        document.getElementById('lyricsToggleBtn')?.classList.toggle('text-purple-400', this._isOpen);
        document.getElementById('lyricsToggleBtn')?.classList.toggle('text-gray-400', !this._isOpen);
        document.getElementById('mobileExpLyrics')?.classList.toggle('text-purple-400', this._isOpen);
        document.getElementById('mobileExpLyrics')?.classList.toggle('text-gray-500', !this._isOpen);

        // Fetch lyrics if panel is opening and we have a track
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
        
        // Already showing this track's lyrics
        if (this._currentTrackKey === trackKey && this._syncedLines.length > 0 || this._plainText) {
            return;
        }

        // Check cache
        if (this._cache.has(trackKey)) {
            const cached = this._cache.get(trackKey);
            this._applyLyrics(cached, track);
            return;
        }

        this._currentTrackKey = trackKey;
        this._showLoading(track);

        try {
            this._isFetching = true;

            // Try exact match first (faster)
            let data = await this._fetchExact(track.title, track.artist, track.album, track.duration);
            
            // Fallback to search
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

            // Find best match by comparing title/artist
            const titleLower = title.toLowerCase();
            const artistLower = artist.toLowerCase();
            
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
     * Render synced lyrics lines
     */
    _renderSynced(track) {
        const content = document.getElementById('lyricsContent');
        if (!content) return;

        const trackName = document.querySelector('.lyrics-track-name');
        if (trackName) trackName.textContent = `— ${track.title}`;

        content.innerHTML = `
            <div class="lyrics-synced">
                ${this._syncedLines.map((line, i) => `
                    <p class="lyrics-line ${line.text === '' ? 'lyrics-gap' : ''}" data-index="${i}">
                        ${line.text || '♪'}
                    </p>
                `).join('')}
            </div>
        `;

        this._activeLine = -1;
    },

    /**
     * Render plain (non-synced) lyrics
     */
    _renderPlain(track) {
        const content = document.getElementById('lyricsContent');
        if (!content) return;

        const trackName = document.querySelector('.lyrics-track-name');
        if (trackName) trackName.textContent = `— ${track.title}`;

        const lines = this._plainText.split('\n');
        content.innerHTML = `
            <div class="lyrics-plain">
                ${lines.map(line => `
                    <p class="lyrics-line-plain ${line.trim() === '' ? 'lyrics-gap' : ''}">${line || '&nbsp;'}</p>
                `).join('')}
            </div>
        `;
    },

    /**
     * Show loading state
     */
    _showLoading(track) {
        const content = document.getElementById('lyricsContent');
        if (!content) return;

        const trackName = document.querySelector('.lyrics-track-name');
        if (trackName) trackName.textContent = `— ${track.title}`;

        content.innerHTML = `
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
        const content = document.getElementById('lyricsContent');
        if (!content) return;

        const trackName = document.querySelector('.lyrics-track-name');
        if (trackName) trackName.textContent = `— ${track.title}`;

        content.innerHTML = `
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
     * Update synced lyrics highlight — called from Player.updateProgress()
     */
    updateSyncedHighlight(currentTime) {
        if (!this._isOpen || this._syncedLines.length === 0) return;

        // Find current line
        let lineIndex = -1;
        for (let i = this._syncedLines.length - 1; i >= 0; i--) {
            if (currentTime >= this._syncedLines[i].time) {
                lineIndex = i;
                break;
            }
        }

        if (lineIndex === this._activeLine) return;
        this._activeLine = lineIndex;

        // Update CSS classes
        const lines = document.querySelectorAll('#lyricsContent .lyrics-line');
        lines.forEach((el, i) => {
            el.classList.toggle('active', i === lineIndex);
            el.classList.toggle('past', i < lineIndex);
        });

        // Auto-scroll to active line
        if (lineIndex >= 0 && lines[lineIndex]) {
            const container = document.getElementById('lyricsContent');
            const lineEl = lines[lineIndex];
            const containerRect = container.getBoundingClientRect();
            const lineRect = lineEl.getBoundingClientRect();
            
            // Scroll so active line is roughly 40% from top
            const targetScroll = lineEl.offsetTop - container.offsetTop - (containerRect.height * 0.4);
            container.scrollTo({
                top: Math.max(0, targetScroll),
                behavior: 'smooth'
            });
        }
    },

    /**
     * Called when track changes — auto-fetch if panel is open
     */
    onTrackChange(track) {
        this._syncedLines = [];
        this._plainText = '';
        this._activeLine = -1;
        this._currentTrackKey = null;

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
        
        const content = document.getElementById('lyricsContent');
        if (content) {
            content.innerHTML = `
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
