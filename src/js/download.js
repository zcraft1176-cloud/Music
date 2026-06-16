/**
 * Download Module
 * Handles downloading tracks via server-side download proxy
 */

const Downloader = {
    activeDownloads: new Map(),

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
     * Get direct audio URL from Piped /streams/ endpoint
     * Self-contained to avoid dependency issues
     */
    async _getStreamUrl(track) {
        // Non-YouTube: already has direct URL
        if (track.audioUrl && !track.audioUrl.startsWith('yt:')) {
            return { url: track.audioUrl, format: 'mp3' };
        }

        // YouTube: get stream URL via Piped API
        const videoId = track.videoId || (track.audioUrl && track.audioUrl.startsWith('yt:') ? track.audioUrl.substring(3) : null);
        
        if (videoId) {
            // Try each Piped instance
            const instances = MusicAPI.config.piped.instances;
            for (let i = 0; i < instances.length; i++) {
                try {
                    const base = instances[(MusicAPI.config.piped.currentIndex + i) % instances.length];
                    const target = `${base}/streams/${videoId}`;
                    const proxyUrl = MusicAPI.getProxyUrl(target);
                    
                    const ctrl = new AbortController();
                    const tm = setTimeout(() => ctrl.abort(), 15000);
                    const res = await fetch(proxyUrl, { signal: ctrl.signal });
                    clearTimeout(tm);
                    
                    if (!res.ok) continue;
                    const data = await res.json();
                    
                    if (data && data.audioStreams && data.audioStreams.length > 0) {
                        // Sort by bitrate descending, pick best audio quality
                        const audioStreams = data.audioStreams
                            .filter(s => s.mimeType && s.mimeType.includes('audio'))
                            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                        if (audioStreams.length > 0) {
                            const best = audioStreams[0];
                            const format = best.mimeType.includes('webm') ? 'webm' 
                                         : best.mimeType.includes('mp4') ? 'm4a' 
                                         : 'mp3';
                            console.log(`[Download] Got audio stream: ${best.quality || 'unknown'} ${format} ${best.bitrate}bps`);
                            return { 
                                url: best.url, 
                                format,
                                bitrate: best.bitrate,
                                quality: best.quality 
                            };
                        }
                    }
                } catch (e) {
                    console.warn(`[Download] Piped instance ${i} failed:`, e.message);
                }
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
            // Step 1: Ensure audio URL is resolved (find YouTube video)
            if (!track.audioUrl) {
                console.log('[Download] Resolving audio URL...');
                const resolved = await MusicAPI.resolveAudioUrl(track);
                if (!resolved) {
                    throw new Error('Could not find audio source');
                }
            }

            // Step 2: Get direct downloadable stream URL
            console.log('[Download] Getting stream URL...');
            const audioInfo = await this._getStreamUrl(track);
            if (!audioInfo || !audioInfo.url) {
                throw new Error('Could not get download URL');
            }

            // Step 3: Build filename and download via proxy
            const filename = this._sanitizeFilename(`${track.artist} - ${track.title}`) + `.${audioInfo.format}`;
            const proxyUrl = this.getDownloadProxyUrl(audioInfo.url, filename);

            console.log('[Download] Starting download via proxy...');
            UI.showToast(`Downloading: ${track.title}...`, 'info');

            // Trigger download via hidden anchor
            const a = document.createElement('a');
            a.href = proxyUrl;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
            }, 3000);

            UI.showToast(`Download started: ${track.title}`, 'success');

        } catch (error) {
            console.error('[Download] Error:', error);

            // Fallback: open in new tab
            if (track.videoId) {
                UI.showToast('Opening alternative download...', 'warning');
                window.open(`https://piped.private.coffee/watch?v=${track.videoId}`, '_blank');
            } else if (track.audioUrl && !track.audioUrl.startsWith('yt:')) {
                const a = document.createElement('a');
                a.href = track.audioUrl;
                a.download = this._sanitizeFilename(`${track.artist} - ${track.title}`) + '.mp3';
                a.target = '_blank';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
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
