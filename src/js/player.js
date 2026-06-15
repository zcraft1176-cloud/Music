/**
 * Audio Player Engine
 * Handles audio playback, queue management, and audio visualization
 */

const Player = {
    // Audio element
    audio: null,
    
    // Web Audio API for visualizer
    audioContext: null,
    analyser: null,
    source: null,
    visualizerAnimationId: null,

    // State
    currentTrack: null,
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    isShuffle: false,
    repeatMode: 'none', // 'none', 'one', 'all'
    volume: 0.8,
    isMuted: false,

    // DOM Elements (cached after init)
    elements: {},

    /**
     * Initialize the player
     */
    init() {
        // Create audio element (for non-YouTube sources)
        this.audio = new Audio();
        this.audio.crossOrigin = 'anonymous';
        this.audio.preload = 'auto';
        this.audio.volume = this.volume;

        // YouTube IFrame Player state
        this.ytPlayer = null;
        this.ytReady = false;
        this._ytInterval = null;
        this._source = 'html5'; // 'html5' or 'youtube'

        // Cache DOM elements
        this.elements = {
            playPauseBtn: document.getElementById('playPauseBtn'),
            playIcon: document.getElementById('playIcon'),
            pauseIcon: document.getElementById('pauseIcon'),
            prevBtn: document.getElementById('prevBtn'),
            nextBtn: document.getElementById('nextBtn'),
            shuffleBtn: document.getElementById('shuffleBtn'),
            repeatBtn: document.getElementById('repeatBtn'),
            repeatIconNone: document.getElementById('repeatIconNone'),
            repeatIconAll: document.getElementById('repeatIconAll'),
            repeatIconOne: document.getElementById('repeatIconOne'),
            progressBar: document.getElementById('progressBar'),
            progressFill: document.getElementById('progressFill'),
            currentTime: document.getElementById('currentTime'),
            duration: document.getElementById('duration'),
            volumeBar: document.getElementById('volumeBar'),
            volumeFill: document.getElementById('volumeFill'),
            volumeBtn: document.getElementById('volumeBtn'),
            volumeIconHigh: document.getElementById('volumeIconHigh'),
            volumeIconLow: document.getElementById('volumeIconLow'),
            volumeIconMute: document.getElementById('volumeIconMute'),
            volumePercent: document.getElementById('volumePercent'),
            playerTitle: document.getElementById('playerTitle'),
            playerArtist: document.getElementById('playerArtist'),
            playerCover: document.getElementById('playerCover'),
            playerBar: document.getElementById('playerBar'),
            qualityBadge: document.getElementById('qualityBadge'),
            queueCount: document.getElementById('queueCount'),
            visualizerCanvas: document.getElementById('visualizerCanvas'),
            // Mobile mini-bar elements
            mobilePlayPauseBtn: document.getElementById('mobilePlayPauseBtn'),
            mobilePlayIcon: document.getElementById('mobilePlayIcon'),
            mobilePauseIcon: document.getElementById('mobilePauseIcon'),
            mobilePrevBtn: document.getElementById('mobilePrevBtn'),
            mobileNextBtn: document.getElementById('mobileNextBtn'),
            mobileCurrentTime: document.getElementById('mobileCurrentTime'),
            mobileDuration: document.getElementById('mobileDuration'),
            // Mobile expanded player elements
            mobilePlayerExpanded: document.getElementById('mobilePlayerExpanded'),
            mobilePlayerCollapse: document.getElementById('mobilePlayerCollapse'),
            mobilePlayerCoverLarge: document.getElementById('mobilePlayerCoverLarge'),
            mobileExpTitle: document.getElementById('mobileExpTitle'),
            mobileExpArtist: document.getElementById('mobileExpArtist'),
            mobileExpProgressBar: document.getElementById('mobileExpProgressBar'),
            mobileExpProgressFill: document.getElementById('mobileExpProgressFill'),
            mobileExpCurrentTime: document.getElementById('mobileExpCurrentTime'),
            mobileExpDuration: document.getElementById('mobileExpDuration'),
            mobileExpPlayPause: document.getElementById('mobileExpPlayPause'),
            mobileExpPlayIcon: document.getElementById('mobileExpPlayIcon'),
            mobileExpPauseIcon: document.getElementById('mobileExpPauseIcon'),
            mobileExpPrev: document.getElementById('mobileExpPrev'),
            mobileExpNext: document.getElementById('mobileExpNext'),
            mobileExpShuffle: document.getElementById('mobileExpShuffle'),
            mobileExpRepeat: document.getElementById('mobileExpRepeat'),
            mobileExpRepeatNone: document.getElementById('mobileExpRepeatNone'),
            mobileExpRepeatAll: document.getElementById('mobileExpRepeatAll'),
            mobileExpRepeatOne: document.getElementById('mobileExpRepeatOne'),
            mobileExpQualityBadge: document.getElementById('mobileExpQualityBadge')
        };

        // Setup event listeners
        this.setupEventListeners();
        this.setupKeyboardShortcuts();
        this.setupAudioEvents();

        // Initialize visualizer
        this.initVisualizer();

        // Initialize YouTube IFrame API
        this._initYouTube();

        // Load saved state
        this.loadState();

        console.log('Player initialized');
    },

    /** Create hidden YouTube IFrame player */
    _initYouTube() {
        // Hidden container
        const c = document.createElement('div');
        c.id = 'yt-player-host';
        c.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
        c.innerHTML = '<div id="yt-iframe"></div>';
        document.body.appendChild(c);

        // Load API script
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);

        window.onYouTubeIframeAPIReady = () => {
            this.ytPlayer = new YT.Player('yt-iframe', {
                width: '1', height: '1',
                playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0 },
                events: {
                    onReady: () => {
                        this.ytReady = true;
                        this.ytPlayer.setVolume(this.volume * 100);
                        console.log('YouTube IFrame ready');
                    },
                    onStateChange: (e) => this._onYTState(e),
                    onError: (e) => {
                        console.error('YT error:', e.data);
                        if (this._source === 'youtube') {
                            UI.showToast('YouTube error — skipping', 'error');
                            setTimeout(() => this.next(), 800);
                        }
                    }
                }
            });
        };
    },

    /** Handle YouTube player state changes */
    _onYTState(event) {
        if (this._source !== 'youtube') return;
        const s = event.data;
        if (s === YT.PlayerState.PLAYING) {
            this.isPlaying = true;
            this.updateUI();
            this._startYTSync();
        } else if (s === YT.PlayerState.PAUSED) {
            this.isPlaying = false;
            this.updateUI();
        } else if (s === YT.PlayerState.ENDED) {
            this._stopYTSync();
            this.onTrackEnded();
        }
    },

    /** Sync YouTube playback time to our progress bar */
    _startYTSync() {
        this._stopYTSync();
        this._ytInterval = setInterval(() => {
            if (!this.ytPlayer || this._source !== 'youtube') return;
            try {
                const cur = this.ytPlayer.getCurrentTime() || 0;
                const dur = this.ytPlayer.getDuration() || 0;
                if (dur > 0) {
                    const pct = (cur / dur) * 100;
                    const timeStr = this.formatTime(cur);
                    const durStr = this.formatTime(dur);
                    // Desktop
                    if (this.elements.progressFill) this.elements.progressFill.style.width = `${pct}%`;
                    if (this.elements.currentTime) this.elements.currentTime.textContent = timeStr;
                    if (this.elements.duration) this.elements.duration.textContent = durStr;
                    // Mobile mini-bar
                    if (this.elements.mobileCurrentTime) this.elements.mobileCurrentTime.textContent = timeStr;
                    if (this.elements.mobileDuration) this.elements.mobileDuration.textContent = durStr;
                    // Mobile expanded player
                    if (this.elements.mobileExpProgressFill) this.elements.mobileExpProgressFill.style.width = `${pct}%`;
                    if (this.elements.mobileExpCurrentTime) this.elements.mobileExpCurrentTime.textContent = timeStr;
                    if (this.elements.mobileExpDuration) this.elements.mobileExpDuration.textContent = durStr;
                }
            } catch(e) {}
        }, 500);
    },

    _stopYTSync() {
        if (this._ytInterval) { clearInterval(this._ytInterval); this._ytInterval = null; }
    },

    /**
     * Setup UI event listeners
     */
    setupEventListeners() {
        // Play/Pause
        this.elements.playPauseBtn?.addEventListener('click', () => this.togglePlayPause());

        // Previous/Next
        this.elements.prevBtn?.addEventListener('click', () => this.prev());
        this.elements.nextBtn?.addEventListener('click', () => this.next());

        // Shuffle
        this.elements.shuffleBtn?.addEventListener('click', () => this.toggleShuffle());

        // Repeat
        this.elements.repeatBtn?.addEventListener('click', () => this.toggleRepeat());

        // Progress bar click
        this.elements.progressBar?.addEventListener('click', (e) => this.seek(e));

        // Volume bar drag & click
        this.elements.volumeBar?.addEventListener('mousedown', (e) => {
            this.setVolume(e);
            this._volumeDragging = true;
            const onMove = (ev) => { if (this._volumeDragging) this.setVolume(ev); };
            const onUp = () => { this._volumeDragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        // Touch support for mobile
        this.elements.volumeBar?.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.setVolume(touch);
            const onTouchMove = (ev) => { ev.preventDefault(); this.setVolume(ev.touches[0]); };
            const onTouchEnd = () => { this.elements.volumeBar.removeEventListener('touchmove', onTouchMove); this.elements.volumeBar.removeEventListener('touchend', onTouchEnd); };
            this.elements.volumeBar.addEventListener('touchmove', onTouchMove, { passive: false });
            this.elements.volumeBar.addEventListener('touchend', onTouchEnd);
        }, { passive: false });

        // Volume button (mute toggle)
        this.elements.volumeBtn?.addEventListener('click', () => this.toggleMute());

        // Mobile inline controls (mini-bar)
        this.elements.mobilePlayPauseBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.togglePlayPause(); });
        this.elements.mobilePrevBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.prev(); });
        this.elements.mobileNextBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.next(); });

        // Mini-bar: tap track info area to expand player
        const trackInfoArea = this.elements.playerBar?.querySelector('.w-56');
        trackInfoArea?.addEventListener('click', (e) => {
            if (window.innerWidth < 768 && !e.target.closest('button')) {
                this.expandMobilePlayer();
            }
        });

        // Expanded mobile player controls
        this.elements.mobilePlayerCollapse?.addEventListener('click', () => this.collapseMobilePlayer());
        this.elements.mobileExpPlayPause?.addEventListener('click', () => this.togglePlayPause());
        this.elements.mobileExpPrev?.addEventListener('click', () => this.prev());
        this.elements.mobileExpNext?.addEventListener('click', () => this.next());
        this.elements.mobileExpShuffle?.addEventListener('click', () => this.toggleShuffle());
        this.elements.mobileExpRepeat?.addEventListener('click', () => this.toggleRepeat());

        // Expanded progress bar seek
        this.elements.mobileExpProgressBar?.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this._seekFromMobileExp(e.touches[0]);
            const onMove = (ev) => { ev.preventDefault(); this._seekFromMobileExp(ev.touches[0]); };
            const onEnd = () => { this.elements.mobileExpProgressBar.removeEventListener('touchmove', onMove); this.elements.mobileExpProgressBar.removeEventListener('touchend', onEnd); };
            this.elements.mobileExpProgressBar.addEventListener('touchmove', onMove, { passive: false });
            this.elements.mobileExpProgressBar.addEventListener('touchend', onEnd);
        }, { passive: false });
        this.elements.mobileExpProgressBar?.addEventListener('click', (e) => this._seekFromMobileExp(e));
    },

    /**
     * Expand mobile full-screen player
     */
    expandMobilePlayer() {
        this.elements.mobilePlayerExpanded?.classList.add('open');
        this.syncExpandedPlayer();
    },

    /**
     * Collapse mobile full-screen player
     */
    collapseMobilePlayer() {
        this.elements.mobilePlayerExpanded?.classList.remove('open');
    },

    /**
     * Sync expanded player UI with current state
     */
    syncExpandedPlayer() {
        if (!this.elements.mobileExpTitle) return;

        // Track info
        if (this.currentTrack) {
            this.elements.mobileExpTitle.textContent = this.currentTrack.title;
            this.elements.mobileExpArtist.textContent = this.currentTrack.artist;
            if (this.currentTrack.cover) {
                this.elements.mobilePlayerCoverLarge.innerHTML = `<img src="${this.currentTrack.cover}" alt="Cover" onerror="this.parentElement.innerHTML='<svg class=\\'w-16 h-16 text-gray-600\\' fill=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path d=\\'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z\\'/></svg>'">`;
            }
        }

        // Quality badge
        if (this.elements.mobileExpQualityBadge && this.elements.qualityBadge) {
            this.elements.mobileExpQualityBadge.textContent = this.elements.qualityBadge.textContent;
        }

        // Shuffle state
        this.elements.mobileExpShuffle?.classList.toggle('text-primary', this.isShuffle);
        this.elements.mobileExpShuffle?.classList.toggle('text-gray-400', !this.isShuffle);

        // Repeat state
        this._syncExpandedRepeatIcons();
    },

    /**
     * Seek from expanded mobile progress bar
     */
    _seekFromMobileExp(e) {
        const bar = this.elements.mobileExpProgressBar;
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (this._source === 'youtube' && this.ytPlayer && this.ytReady) {
            const dur = this.ytPlayer.getDuration();
            if (dur > 0) this.ytPlayer.seekTo(pct * dur, true);
        } else if (this.audio.duration) {
            this.audio.currentTime = pct * this.audio.duration;
        }
    },

    /**
     * Sync repeat icons on the expanded player
     */
    _syncExpandedRepeatIcons() {
        const none = this.elements.mobileExpRepeatNone;
        const all = this.elements.mobileExpRepeatAll;
        const one = this.elements.mobileExpRepeatOne;
        if (none && all && one) {
            none.classList.add('hidden');
            all.classList.add('hidden');
            one.classList.add('hidden');
            if (this.repeatMode === 'none') none.classList.remove('hidden');
            else if (this.repeatMode === 'all') all.classList.remove('hidden');
            else one.classList.remove('hidden');
        }
        this.elements.mobileExpRepeat?.classList.toggle('text-primary', this.repeatMode !== 'none');
        this.elements.mobileExpRepeat?.classList.toggle('text-gray-400', this.repeatMode === 'none');
    },

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch(e.code) {
                case 'Space':
                    e.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.seekBy(-5);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.seekBy(5);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.adjustVolume(0.05);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.adjustVolume(-0.05);
                    break;
                case 'KeyN':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.next();
                    }
                    break;
                case 'KeyP':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.prev();
                    }
                    break;
            }
        });
    },

    /**
     * Setup audio element events
     */
    setupAudioEvents() {
        this.audio.addEventListener('timeupdate', () => this.updateProgress());
        this.audio.addEventListener('loadedmetadata', () => this.updateDuration());
        this.audio.addEventListener('ended', () => this.onTrackEnded());
        this.audio.addEventListener('error', (e) => this.onError(e));
        this.audio.addEventListener('playing', () => this.onPlaying());
        this.audio.addEventListener('pause', () => this.onPaused());
    },

    /**
     * Initialize audio visualizer
     */
    initVisualizer() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            
            this.source = this.audioContext.createMediaElementSource(this.audio);
            this.source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            
            this.drawVisualizer();
        } catch (error) {
            console.warn('Visualizer initialization failed:', error);
        }
    },

    /**
     * Draw audio visualizer
     */
    drawVisualizer() {
        const canvas = this.elements.visualizerCanvas;
        if (!canvas || !this.analyser) return;

        const ctx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            this.visualizerAnimationId = requestAnimationFrame(draw);

            // Set canvas size
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;

            this.analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 2.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height;

                // Gradient color based on frequency
                const hue = (i / bufferLength) * 60 + 260; // Purple to cyan
                ctx.fillStyle = `hsla(${hue}, 70%, 60%, 0.8)`;

                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        };

        draw();
    },

    // Track retry state
    _retrying: false,

    /** Stop all audio sources */
    _stopAll() {
        this.audio.pause();
        this.audio.src = '';
        this._stopYTSync();
        try { if (this.ytPlayer && this.ytReady) this.ytPlayer.stopVideo(); } catch(e) {}
    },

    /**
     * Play a track
     */
    async play(track) {
        if (!track) {
            UI.showToast('No track to play', 'error');
            return;
        }

        // Resume audio context if suspended
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.currentTrack = track;
        this._retrying = false;
        this.updateUI();

        // Save to play history
        UI.addToHistory(track);

        // For Deezer tracks, pre-set source to youtube to prevent HTML5 error handler
        // from firing during the async resolve phase (unless it resolves to preview)
        if (track.source === 'deezer') {
            this._source = 'youtube';
        }

        // Resolve audio URL if needed
        if (!track.audioUrl) {
            UI.showToast(`Finding audio for: ${track.title}...`, 'info');
            try {
                const url = await MusicAPI.resolveAudioUrl(track);
                if (!url) {
                    UI.showToast('Audio not found - try another track', 'error');
                    return;
                }
            } catch (e) {
                console.error('Audio resolve failed:', e);
                UI.showToast('Failed to find audio', 'error');
                return;
            }
        }

        // Stop any currently playing source
        this._stopAll();

        // Update quality badge for preview
        if (track.isPreview && this.elements.qualityBadge) {
            this.elements.qualityBadge.textContent = '30s';
            this.elements.qualityBadge.title = 'Deezer 30s Preview — full version not available';
        }

        // Route: YouTube IFrame or HTML5 Audio
        if (track.audioUrl.startsWith('yt:') && track.videoId) {
            this._source = 'youtube';

            // Wait for YT API if not ready (max 5s)
            if (!this.ytReady) {
                for (let w = 0; w < 25 && !this.ytReady; w++) {
                    await new Promise(r => setTimeout(r, 200));
                }
            }

            if (this.ytReady && this.ytPlayer) {
                this.ytPlayer.setVolume((this.isMuted ? 0 : this.volume) * 100);
                this.ytPlayer.loadVideoById(track.videoId);
                console.log(`YouTube playing: ${track.title} [${track.videoId}]`);
                UI.showToast(`Now playing: ${track.title}`, 'success');
            } else {
                UI.showToast('YouTube player not ready — try again', 'error');
            }
        } else {
            // Direct URL (Jamendo, Archive, Deezer preview)
            this._source = 'html5';
            this.audio.src = track.audioUrl;
            this.audio.play().then(() => {
                this.isPlaying = true;
                this.updateUI();
                const label = track.isPreview ? `Preview: ${track.title} (30s)` : `Now playing: ${track.title}`;
                UI.showToast(label, 'success');
            }).catch(error => {
                console.error('Playback error:', error);
                UI.showToast('Playback failed', 'error');
            });
        }

        this.preloadNext();
    },

    /**
     * Pause playback
     */
    pause() {
        if (this._source === 'youtube' && this.ytPlayer && this.ytReady) {
            this.ytPlayer.pauseVideo();
        } else {
            this.audio.pause();
        }
        this.isPlaying = false;
        this.updateUI();
    },

    /**
     * Resume playback
     */
    resume() {
        if (this._source === 'youtube' && this.ytPlayer && this.ytReady) {
            this.ytPlayer.playVideo();
        } else {
            this.audio.play().then(() => {
                this.isPlaying = true;
                this.updateUI();
            }).catch(error => {
                console.error('Resume error:', error);
            });
        }
    },

    /**
     * Toggle play/pause
     */
    togglePlayPause() {
        if (!this.currentTrack) {
            // If no track, play first in queue
            if (this.queue.length > 0) {
                this.currentIndex = 0;
                this.play(this.queue[0]);
            }
            return;
        }

        if (this.isPlaying) {
            this.pause();
        } else {
            this.resume();
        }
    },

    /**
     * Play next track
     */
    next() {
        if (this.queue.length === 0) return;

        if (this.isShuffle) {
            this.currentIndex = Math.floor(Math.random() * this.queue.length);
        } else {
            this.currentIndex = (this.currentIndex + 1) % this.queue.length;
        }

        this.play(this.queue[this.currentIndex]);
        UI.updateQueueUI();
    },

    /**
     * Play previous track
     */
    prev() {
        if (this.queue.length === 0) return;

        // If more than 3 seconds in, restart current track
        const ct = this._source === 'youtube' && this.ytPlayer
            ? (this.ytPlayer.getCurrentTime?.() || 0) : this.audio.currentTime;
        if (ct > 3) {
            if (this._source === 'youtube' && this.ytPlayer) {
                this.ytPlayer.seekTo(0, true);
            } else {
                this.audio.currentTime = 0;
            }
            return;
        }

        if (this.isShuffle) {
            this.currentIndex = Math.floor(Math.random() * this.queue.length);
        } else {
            this.currentIndex = (this.currentIndex - 1 + this.queue.length) % this.queue.length;
        }

        this.play(this.queue[this.currentIndex]);
        UI.updateQueueUI();
    },

    /**
     * Add track to queue
     */
    addToQueue(track) {
        this.queue.push(track);
        this.updateQueueCount();
        UI.showToast(`Added to queue: ${track.title}`, 'success');
        UI.updateQueueUI();
        this.saveState();
    },

    /**
     * Add multiple tracks to queue
     */
    addMultipleToQueue(tracks) {
        this.queue = this.queue.concat(tracks);
        this.updateQueueCount();
        UI.showToast(`Added ${tracks.length} tracks to queue`, 'success');
        UI.updateQueueUI();
        this.saveState();
    },

    /**
     * Remove track from queue by index
     */
    removeFromQueue(index) {
        this.queue.splice(index, 1);
        if (index < this.currentIndex) {
            this.currentIndex--;
        } else if (index === this.currentIndex) {
            // If removing current track, skip to next
            if (this.queue.length > 0) {
                this.currentIndex = Math.min(this.currentIndex, this.queue.length - 1);
                this.play(this.queue[this.currentIndex]);
            } else {
                this.stop();
            }
        }
        this.updateQueueCount();
        UI.updateQueueUI();
        this.saveState();
    },

    /**
     * Clear queue
     */
    clearQueue() {
        this.queue = [];
        this.currentIndex = -1;
        this.stop();
        this.updateQueueCount();
        UI.updateQueueUI();
        this.saveState();
    },

    /**
     * Play queue from specific index
     */
    playFromQueue(index) {
        if (index >= 0 && index < this.queue.length) {
            this.currentIndex = index;
            this.play(this.queue[index]);
            UI.updateQueueUI();
        }
    },

    /**
     * Stop playback
     */
    stop() {
        this._stopAll();
        this.currentTrack = null;
        this.isPlaying = false;
        this._source = 'html5';
        this.updateUI();
    },

    /**
     * Seek to position
     */
    seek(e) {
        if (!this.currentTrack) return;
        const rect = this.elements.progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        if (this._source === 'youtube' && this.ytPlayer && this.ytReady) {
            this.ytPlayer.seekTo(percent * (this.ytPlayer.getDuration() || 0), true);
        } else {
            this.audio.currentTime = percent * this.audio.duration;
        }
    },

    /**
     * Seek by seconds
     */
    seekBy(seconds) {
        if (!this.currentTrack) return;
        if (this._source === 'youtube' && this.ytPlayer && this.ytReady) {
            const cur = this.ytPlayer.getCurrentTime() || 0;
            const dur = this.ytPlayer.getDuration() || 0;
            this.ytPlayer.seekTo(Math.max(0, Math.min(dur, cur + seconds)), true);
        } else {
            this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + seconds));
        }
    },

    /**
     * Set volume from click
     */
    setVolume(e) {
        const rect = this.elements.volumeBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.volume = percent;
        this.audio.volume = percent;
        if (this.ytPlayer && this.ytReady) this.ytPlayer.setVolume(percent * 100);
        this.isMuted = false;
        this.updateVolumeUI();
        this.saveState();
    },

    /**
     * Adjust volume by amount
     */
    adjustVolume(amount) {
        this.volume = Math.max(0, Math.min(1, this.volume + amount));
        this.audio.volume = this.volume;
        if (this.ytPlayer && this.ytReady) this.ytPlayer.setVolume(this.volume * 100);
        this.isMuted = false;
        this.updateVolumeUI();
        this.saveState();
    },

    /**
     * Toggle mute
     */
    toggleMute() {
        this.isMuted = !this.isMuted;
        this.audio.volume = this.isMuted ? 0 : this.volume;
        if (this.ytPlayer && this.ytReady) {
            this.isMuted ? this.ytPlayer.mute() : this.ytPlayer.unMute();
            this.ytPlayer.setVolume(this.isMuted ? 0 : this.volume * 100);
        }
        this.updateVolumeUI();
    },

    /**
     * Toggle shuffle mode
     */
    toggleShuffle() {
        this.isShuffle = !this.isShuffle;
        this.elements.shuffleBtn?.classList.toggle('text-primary', this.isShuffle);
        this.elements.shuffleBtn?.classList.toggle('text-gray-400', !this.isShuffle);
        // Sync expanded player
        this.elements.mobileExpShuffle?.classList.toggle('text-primary', this.isShuffle);
        this.elements.mobileExpShuffle?.classList.toggle('text-gray-400', !this.isShuffle);
        this.saveState();
        UI.showToast(`Shuffle ${this.isShuffle ? 'on' : 'off'}`, 'info');
    },

    /**
     * Toggle repeat mode
     */
    toggleRepeat() {
        const modes = ['none', 'all', 'one'];
        const currentIndex = modes.indexOf(this.repeatMode);
        this.repeatMode = modes[(currentIndex + 1) % modes.length];

        // Update UI - switch icons
        this.updateRepeatIcons();
        
        this.saveState();
        const labels = { none: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
        UI.showToast(labels[this.repeatMode], 'info');
    },

    /**
     * Handle track ended
     */
    onTrackEnded() {
        if (this.repeatMode === 'one') {
            if (this._source === 'youtube' && this.ytPlayer && this.ytReady) {
                this.ytPlayer.seekTo(0, true);
                this.ytPlayer.playVideo();
            } else {
                this.audio.currentTime = 0;
                this.resume();
            }
        } else if (this.repeatMode === 'all' || this.currentIndex < this.queue.length - 1) {
            this.next();
        } else {
            this.isPlaying = false;
            this.updateUI();
        }
    },

    /**
     * Handle playback started
     */
    onPlaying() {
        this.elements.playerBar?.classList.add('playing');
    },

    /**
     * Handle playback paused
     */
    onPaused() {
        this.elements.playerBar?.classList.remove('playing');
    },

    /**
     * Handle error
     */
    onError(e) {
        // Ignore HTML5 audio errors when YouTube is the active source
        if (this._source === 'youtube') return;
        console.error('Audio error:', e);
        UI.showToast('Playback error - skipping track', 'error');
        setTimeout(() => this.next(), 1000);
    },

    /**
     * Update progress bar and time display
     */
    updateProgress() {
        if (!this.audio.duration) return;

        const percent = (this.audio.currentTime / this.audio.duration) * 100;
        const timeStr = this.formatTime(this.audio.currentTime);
        if (this.elements.progressFill) {
            this.elements.progressFill.style.width = `${percent}%`;
        }
        if (this.elements.currentTime) {
            this.elements.currentTime.textContent = timeStr;
        }
        // Mobile mini-bar time
        if (this.elements.mobileCurrentTime) {
            this.elements.mobileCurrentTime.textContent = timeStr;
        }
        // Mobile expanded player
        if (this.elements.mobileExpProgressFill) {
            this.elements.mobileExpProgressFill.style.width = `${percent}%`;
        }
        if (this.elements.mobileExpCurrentTime) {
            this.elements.mobileExpCurrentTime.textContent = timeStr;
        }
    },

    /**
     * Update duration display
     */
    updateDuration() {
        const durStr = this.formatTime(this.audio.duration);
        if (this.elements.duration) {
            this.elements.duration.textContent = durStr;
        }
        // Mobile mini-bar
        if (this.elements.mobileDuration) {
            this.elements.mobileDuration.textContent = durStr;
        }
        // Mobile expanded player
        if (this.elements.mobileExpDuration) {
            this.elements.mobileExpDuration.textContent = durStr;
        }
    },

    /**
     * Update all UI elements
     */
    updateUI() {
        // Play/Pause button (desktop + mobile mini-bar + expanded)
        if (this.isPlaying) {
            this.elements.playIcon?.classList.add('hidden');
            this.elements.pauseIcon?.classList.remove('hidden');
            this.elements.mobilePlayIcon?.classList.add('hidden');
            this.elements.mobilePauseIcon?.classList.remove('hidden');
            this.elements.mobileExpPlayIcon?.classList.add('hidden');
            this.elements.mobileExpPauseIcon?.classList.remove('hidden');
        } else {
            this.elements.playIcon?.classList.remove('hidden');
            this.elements.pauseIcon?.classList.add('hidden');
            this.elements.mobilePlayIcon?.classList.remove('hidden');
            this.elements.mobilePauseIcon?.classList.add('hidden');
            this.elements.mobileExpPlayIcon?.classList.remove('hidden');
            this.elements.mobileExpPauseIcon?.classList.add('hidden');
        }

        // Track info
        if (this.currentTrack) {
            if (this.elements.playerTitle) {
                this.elements.playerTitle.textContent = this.currentTrack.title;
            }
            if (this.elements.playerArtist) {
                this.elements.playerArtist.textContent = this.currentTrack.artist;
            }
            // Sync expanded player track info
            if (this.elements.mobileExpTitle) {
                this.elements.mobileExpTitle.textContent = this.currentTrack.title;
            }
            if (this.elements.mobileExpArtist) {
                this.elements.mobileExpArtist.textContent = this.currentTrack.artist;
            }
            if (this.elements.playerCover) {
                this.elements.playerCover.innerHTML = `
                    <img src="${this.currentTrack.cover}" alt="${this.currentTrack.title}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<svg class=\\'w-6 h-6 text-gray-600\\' fill=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path d=\\'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z\\'/></svg>'">
                `;
            }
            // Sync expanded player cover
            if (this.elements.mobilePlayerCoverLarge) {
                this.elements.mobilePlayerCoverLarge.innerHTML = `<img src="${this.currentTrack.cover}" alt="${this.currentTrack.title}" onerror="this.parentElement.innerHTML='<svg class=\\'w-16 h-16 text-gray-600\\' fill=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path d=\\'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z\\'/></svg>'">`;
            }
            if (this.elements.qualityBadge) {
                const quality = MusicAPI.getQualityLabel(this.currentTrack.bitrate);
                this.elements.qualityBadge.textContent = quality.label;
                this.elements.qualityBadge.className = `text-xs px-2 py-0.5 rounded quality-badge ${quality.class}`;
                // Sync expanded quality
                if (this.elements.mobileExpQualityBadge) {
                    this.elements.mobileExpQualityBadge.textContent = quality.label;
                }
            }
        }

        // Update document title
        if (this.currentTrack && this.isPlaying) {
            document.title = `${this.currentTrack.title} - ${this.currentTrack.artist} | Music Stream`;
        } else {
            document.title = 'Music Stream - Free High Quality Music';
        }

        // Update queue count
        this.updateQueueCount();
    },

    /**
     * Update volume UI
     */
    updateVolumeUI() {
        const displayVolume = this.isMuted ? 0 : this.volume;
        const pct = Math.round(displayVolume * 100);
        if (this.elements.volumeFill) {
            this.elements.volumeFill.style.width = `${pct}%`;
        }
        // Update percentage label
        if (this.elements.volumePercent) {
            this.elements.volumePercent.textContent = `${pct}%`;
        }
        // Update volume icon based on level
        const high = this.elements.volumeIconHigh;
        const low = this.elements.volumeIconLow;
        const mute = this.elements.volumeIconMute;
        if (high && low && mute) {
            high.classList.add('hidden');
            low.classList.add('hidden');
            mute.classList.add('hidden');
            if (this.isMuted || displayVolume === 0) {
                mute.classList.remove('hidden');
            } else if (displayVolume < 0.5) {
                low.classList.remove('hidden');
            } else {
                high.classList.remove('hidden');
            }
        }
    },

    /**
     * Update repeat button icons
     */
    updateRepeatIcons() {
        const none = this.elements.repeatIconNone;
        const all = this.elements.repeatIconAll;
        const one = this.elements.repeatIconOne;
        if (none && all && one) {
            none.classList.add('hidden');
            all.classList.add('hidden');
            one.classList.add('hidden');
            if (this.repeatMode === 'none') {
                none.classList.remove('hidden');
            } else if (this.repeatMode === 'all') {
                all.classList.remove('hidden');
            } else {
                one.classList.remove('hidden');
            }
        }
        this.elements.repeatBtn?.classList.toggle('text-primary', this.repeatMode !== 'none');
        this.elements.repeatBtn?.classList.toggle('text-gray-400', this.repeatMode === 'none');
        // Update title
        const titles = { none: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
        if (this.elements.repeatBtn) this.elements.repeatBtn.title = titles[this.repeatMode] || 'Repeat off';
        // Sync expanded player
        this._syncExpandedRepeatIcons();
    },

    /**
     * Update queue count badge
     */
    updateQueueCount() {
        if (this.elements.queueCount) {
            this.elements.queueCount.textContent = this.queue.length;
        }
    },

    /**
     * Preload next track for seamless playback
     */
    preloadNext() {
        if (this.queue.length > 0) {
            const nextIndex = this.isShuffle 
                ? Math.floor(Math.random() * this.queue.length)
                : (this.currentIndex + 1) % this.queue.length;
            
            if (nextIndex !== this.currentIndex && this.queue[nextIndex]) {
                const preloadAudio = new Audio();
                preloadAudio.preload = 'auto';
                preloadAudio.src = this.queue[nextIndex].audioUrl;
            }
        }
    },

    /**
     * Format seconds to mm:ss
     */
    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    /**
     * Save state to localStorage
     */
    saveState() {
        const state = {
            queue: this.queue,
            currentIndex: this.currentIndex,
            volume: this.volume,
            isShuffle: this.isShuffle,
            repeatMode: this.repeatMode
        };
        localStorage.setItem('playerState', JSON.stringify(state));
    },

    /**
     * Load state from localStorage
     */
    loadState() {
        try {
            const state = JSON.parse(localStorage.getItem('playerState'));
            if (state) {
                this.queue = state.queue || [];
                this.currentIndex = state.currentIndex || -1;
                this.volume = state.volume ?? 0.8;
                this.isShuffle = state.isShuffle || false;
                this.repeatMode = state.repeatMode || 'none';
                
                this.audio.volume = this.volume;
                this.updateQueueCount();
                this.updateVolumeUI();

                // Restore shuffle/repeat UI
                this.elements.shuffleBtn?.classList.toggle('text-primary', this.isShuffle);
                this.elements.shuffleBtn?.classList.toggle('text-gray-400', !this.isShuffle);
                this.updateRepeatIcons();

                // Restore current track if exists
                if (this.currentIndex >= 0 && this.queue[this.currentIndex]) {
                    this.currentTrack = this.queue[this.currentIndex];
                    this.updateUI();
                }
            }
        } catch (error) {
            console.error('Error loading player state:', error);
        }
    }
};
