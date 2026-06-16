/**
 * Download Module
 * Handles downloading tracks with yt-dlp backend (local) and cobalt.tools fallback (Vercel)
 * 
 * Local (XAMPP): Uses yt-dlp.exe via download-proxy.php for direct YouTube audio download
 * Vercel: Redirects to cobalt.tools web UI (user manually downloads)
 */

const Downloader = {
    activeDownloads: new Map(),
    isLocal: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',

    /**
     * Initialize download listeners
     */
    init() {
        document.getElementById('mobileExpDownload')?.addEventListener('click', () => {
            if (Player.currentTrack) {
                this.download(Player.currentTrack);
            }
        });
    },

    /**
     * Download a track
     */
    async download(track) {
        if (!track || !track.id) {
            UI.showToast('No track to download', 'error');
            return;
        }

        if (this.activeDownloads.has(track.id)) {
            UI.showToast('Already downloading...', 'warning');
            return;
        }

        this.activeDownloads.set(track.id, true);
        this._updateDownloadButton(track.id, 'loading');

        try {
            // Ensure audio URL is resolved
            if (!track.audioUrl) {
                UI.showToast(`Finding audio for: ${track.title}...`, 'info');
                const resolved = await MusicAPI.resolveAudioUrl(track);
                if (!resolved) {
                    throw new Error('Could not find audio source');
                }
            }

            const isYouTube = track.audioUrl && track.audioUrl.startsWith('yt:');
            const videoId = track.videoId || (isYouTube ? track.audioUrl.substring(3) : null);
            const baseName = this._sanitizeFilename(`${track.artist} - ${track.title}`);

            // ===== NON-YOUTUBE TRACKS (direct download via proxy) =====
            if (!isYouTube && track.audioUrl) {
                const filename = baseName + '.mp3';
                const proxyBase = this.isLocal ? 'download-proxy.php' : '/api/download';
                const proxyUrl = `${proxyBase}?url=${encodeURIComponent(track.audioUrl)}&filename=${encodeURIComponent(filename)}`;
                
                UI.showToast(`Downloading: ${track.title}...`, 'info');
                this._triggerDownload(proxyUrl, filename);
                UI.showToast(`Download started: ${track.title}`, 'success');
                return;
            }

            // ===== YOUTUBE TRACKS =====
            if (!videoId) throw new Error('No video ID available');

            if (this.isLocal) {
                // LOCAL: Use yt-dlp via PHP proxy (most reliable)
                UI.showToast(`Downloading: ${track.title}...`, 'info');
                const proxyUrl = `download-proxy.php?videoId=${encodeURIComponent(videoId)}&title=${encodeURIComponent(baseName)}`;
                this._triggerDownload(proxyUrl, baseName + '.webm');
                
                // Show success after a short delay
                setTimeout(() => {
                    UI.showToast(`Download started: ${track.title}`, 'success');
                }, 1500);
            } else {
                // VERCEL: Open cobalt.tools (user downloads manually)
                const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
                UI.showToast('Opening download page...', 'info');
                window.open(`https://cobalt.tools/#url=${encodeURIComponent(ytUrl)}`, '_blank');
                UI.showToast('Complete the download on the opened page', 'success');
            }

        } catch (error) {
            console.error('[Download] Error:', error);
            
            const videoId = track.videoId || (track.audioUrl?.startsWith('yt:') ? track.audioUrl.substring(3) : null);
            if (videoId) {
                UI.showToast('Opening alternative download...', 'warning');
                window.open(`https://cobalt.tools/#url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`, '_blank');
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
        setTimeout(() => document.body.removeChild(a), 5000);
    },

    /**
     * Update download button state (loading/idle)
     */
    _updateDownloadButton(trackId, state) {
        document.querySelectorAll(`.download-track-btn[data-track-id="${trackId}"]`).forEach(btn => {
            this._setButtonState(btn, state);
        });
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
