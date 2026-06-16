/**
 * Download Module
 * Handles downloading tracks using multiple fallback methods:
 * 1. Cobalt API (multiple instances)
 * 2. Direct URL (for non-YouTube sources)
 * 3. Fallback: open in Piped/YouTube for manual download
 */

const Downloader = {
    activeDownloads: new Map(),

    // Cobalt API instances to try (most reliable first)
    cobaltInstances: [
        'https://api.cobalt.tools',
        'https://cobalt-api.ayo.tf',
        'https://cobalt.api.timelessnesses.me',
        'https://api.cobalt.tskau.team',
    ],

    /**
     * Initialize download listeners
     */
    init() {
        // Mobile expanded player download button
        document.getElementById('mobileExpDownload')?.addEventListener('click', () => {
            if (Player.currentTrack) {
                this.download(Player.currentTrack);
            }
        });
    },

    /**
     * Get download proxy URL (auto-detect local vs Vercel)
     */
    getDownloadProxyUrl(audioUrl, filename) {
        const proxyBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'download-proxy.php'
            : '/api/download';
        return `${proxyBase}?url=${encodeURIComponent(audioUrl)}&filename=${encodeURIComponent(filename)}`;
    },

    /**
     * Try Cobalt API to get download URL
     * Cobalt handles the YouTube extraction server-side, bypassing local Piped issues
     */
    async _tryCobaltDownload(videoId) {
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        for (const instance of this.cobaltInstances) {
            try {
                console.log(`[Download] Trying Cobalt: ${instance}`);
                const ctrl = new AbortController();
                const tm = setTimeout(() => ctrl.abort(), 15000);
                
                const res = await fetch(instance, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: youtubeUrl,
                        downloadMode: 'audio',
                        audioFormat: 'mp3',
                        audioBitrate: '128',
                        filenameStyle: 'basic',
                    }),
                    signal: ctrl.signal,
                });
                clearTimeout(tm);

                if (!res.ok) {
                    console.warn(`[Download] Cobalt ${instance} returned ${res.status}`);
                    continue;
                }

                const data = await res.json();
                console.log(`[Download] Cobalt response:`, data.status);

                if (data.status === 'tunnel' || data.status === 'redirect') {
                    return { url: data.url, filename: data.filename || null };
                }
                
                if (data.status === 'error') {
                    console.warn(`[Download] Cobalt error: ${data.error?.code}`);
                    // If auth required, try next instance
                    if (data.error?.code?.includes('auth')) continue;
                    // Other error, still try next instance
                    continue;
                }
            } catch (e) {
                console.warn(`[Download] Cobalt ${instance} failed:`, e.message);
            }
        }
        return null;
    },

    /**
     * Try Piped streams API to get direct audio URL
     */
    async _tryPipedStream(videoId) {
        const instances = MusicAPI.config.piped.instances;
        for (let i = 0; i < instances.length; i++) {
            try {
                const base = instances[(MusicAPI.config.piped.currentIndex + i) % instances.length];
                const target = `${base}/streams/${videoId}`;
                const proxyUrl = MusicAPI.getProxyUrl(target);
                
                const ctrl = new AbortController();
                const tm = setTimeout(() => ctrl.abort(), 12000);
                const res = await fetch(proxyUrl, { signal: ctrl.signal });
                clearTimeout(tm);
                
                if (!res.ok) continue;
                const data = await res.json();
                
                // Check for error message (LOGIN_REQUIRED etc.)
                if (data.error || data.message?.includes('LOGIN')) {
                    console.warn(`[Download] Piped ${base}: ${data.error || data.message}`);
                    continue;
                }
                
                if (data.audioStreams && data.audioStreams.length > 0) {
                    const audioStreams = data.audioStreams
                        .filter(s => s.mimeType && s.mimeType.includes('audio'))
                        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                    if (audioStreams.length > 0) {
                        const best = audioStreams[0];
                        const format = best.mimeType.includes('webm') ? 'webm' 
                                     : best.mimeType.includes('mp4') ? 'm4a' 
                                     : 'mp3';
                        return { url: best.url, format };
                    }
                }
            } catch (e) {
                console.warn(`[Download] Piped instance ${i} failed:`, e.message);
            }
        }
        return null;
    },

    /**
     * Download a track
     */
    async download(track) {
        if (!track || !track.id) {
            UI.showToast('No track to download', 'error');
            return;
        }

        // Check if already downloading
        if (this.activeDownloads.has(track.id)) {
            UI.showToast('Already downloading...', 'warning');
            return;
        }

        // Mark as downloading
        this.activeDownloads.set(track.id, true);
        this._updateDownloadButton(track.id, 'loading');
        UI.showToast(`Preparing download: ${track.title}...`, 'info');

        try {
            // Ensure audio URL is resolved first
            if (!track.audioUrl) {
                console.log('[Download] Resolving audio URL...');
                const resolved = await MusicAPI.resolveAudioUrl(track);
                if (!resolved) {
                    throw new Error('Could not find audio source');
                }
            }

            const isYouTube = track.audioUrl && track.audioUrl.startsWith('yt:');
            const videoId = track.videoId || (isYouTube ? track.audioUrl.substring(3) : null);
            const baseName = this._sanitizeFilename(`${track.artist} - ${track.title}`);

            // ===== NON-YOUTUBE TRACKS (direct download) =====
            if (!isYouTube && track.audioUrl) {
                const filename = baseName + '.mp3';
                const proxyUrl = this.getDownloadProxyUrl(track.audioUrl, filename);
                this._triggerDownload(proxyUrl, filename);
                UI.showToast(`Download started: ${track.title}`, 'success');
                return;
            }

            // ===== YOUTUBE TRACKS =====
            if (!videoId) {
                throw new Error('No video ID available');
            }

            // Method 1: Try Cobalt API (server-side extraction, most reliable)
            console.log('[Download] Method 1: Cobalt API...');
            const cobaltResult = await this._tryCobaltDownload(videoId);
            if (cobaltResult) {
                const filename = cobaltResult.filename || (baseName + '.mp3');
                UI.showToast(`Downloading: ${track.title}...`, 'info');
                
                // Cobalt returns a direct tunnel/redirect URL
                this._triggerDownload(cobaltResult.url, filename);
                UI.showToast(`Download started: ${track.title}`, 'success');
                return;
            }

            // Method 2: Try Piped streams (may fail due to YouTube blocking)
            console.log('[Download] Method 2: Piped streams...');
            const pipedResult = await this._tryPipedStream(videoId);
            if (pipedResult) {
                const filename = baseName + `.${pipedResult.format}`;
                const proxyUrl = this.getDownloadProxyUrl(pipedResult.url, filename);
                UI.showToast(`Downloading: ${track.title}...`, 'info');
                this._triggerDownload(proxyUrl, filename);
                UI.showToast(`Download started: ${track.title}`, 'success');
                return;
            }

            // Method 3: All methods failed — fallback
            throw new Error('All download methods failed');

        } catch (error) {
            console.error('[Download] Error:', error);
            
            const videoId = track.videoId || (track.audioUrl?.startsWith('yt:') ? track.audioUrl.substring(3) : null);
            
            if (videoId) {
                // Open cobalt web UI as last resort (user can manually download)
                UI.showToast('Opening cobalt.tools for manual download...', 'warning');
                window.open(`https://cobalt.tools/#url=https://youtube.com/watch?v=${videoId}`, '_blank');
            } else if (track.audioUrl && !track.audioUrl.startsWith('yt:')) {
                window.open(track.audioUrl, '_blank');
            } else {
                UI.showToast('Download failed — try playing the song first', 'error');
            }
        } finally {
            setTimeout(() => {
                this.activeDownloads.delete(track.id);
                this._updateDownloadButton(track.id, 'idle');
            }, 2000);
        }
    },

    /**
     * Trigger download via hidden anchor tag
     */
    _triggerDownload(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
        }, 3000);
    },

    /**
     * Update download button state
     */
    _updateDownloadButton(trackId, state) {
        // Track row buttons
        document.querySelectorAll(`.download-track-btn[data-track-id="${trackId}"]`).forEach(btn => {
            this._setButtonState(btn, state);
        });
        // Liked view buttons
        document.querySelectorAll('.download-liked-btn').forEach(btn => {
            this._setButtonState(btn, state);
        });
    },

    _setButtonState(btn, state) {
        const icon = btn.querySelector('.download-icon');
        const spinner = btn.querySelector('.download-spinner');

        if (state === 'loading') {
            if (icon) icon.classList.add('hidden');
            if (spinner) spinner.classList.remove('hidden');
            btn.disabled = true;
            btn.classList.add('opacity-50');
        } else {
            if (icon) icon.classList.remove('hidden');
            if (spinner) spinner.classList.add('hidden');
            btn.disabled = false;
            btn.classList.remove('opacity-50');
        }
    },

    /**
     * Sanitize filename
     */
    _sanitizeFilename(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 200);
    }
};
