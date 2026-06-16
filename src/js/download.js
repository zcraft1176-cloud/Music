/**
 * Download Module
 * Handles downloading tracks with progress indication
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
        UI.showToast(`Preparing download: ${track.title}`, 'info');

        try {
            // First ensure audio is resolved
            if (!track.audioUrl) {
                const resolved = await MusicAPI.resolveAudioUrl(track);
                if (!resolved) {
                    throw new Error('Could not resolve audio URL');
                }
            }

            // Get direct downloadable URL
            const audioInfo = await MusicAPI.getDirectAudioUrl(track);
            if (!audioInfo || !audioInfo.url) {
                throw new Error('Could not get download URL');
            }

            // Download via fetch + blob
            const filename = this._sanitizeFilename(`${track.artist} - ${track.title}`) + `.${audioInfo.format}`;

            UI.showToast(`Downloading: ${track.title}`, 'info');

            const response = await fetch(audioInfo.url, {
                mode: 'cors',
                headers: {
                    'Accept': 'audio/*,*/*'
                }
            });

            if (!response.ok) {
                // If CORS fails on direct URL, try via proxy
                const proxyUrl = MusicAPI.getProxyUrl(audioInfo.url);
                const proxyResponse = await fetch(proxyUrl);
                
                if (!proxyResponse.ok) {
                    throw new Error(`Download failed (${proxyResponse.status})`);
                }

                const blob = await proxyResponse.blob();
                this._triggerDownload(blob, filename);
            } else {
                const blob = await response.blob();
                this._triggerDownload(blob, filename);
            }

            UI.showToast(`Downloaded: ${track.title}`, 'success');
        } catch (error) {
            console.error('Download error:', error);

            // Fallback: open audio URL in new tab for manual download
            if (track.videoId) {
                UI.showToast('Direct download failed — opening in new tab', 'warning');
                window.open(`https://piped.private.coffee/watch?v=${track.videoId}`, '_blank');
            } else if (track.audioUrl && !track.audioUrl.startsWith('yt:')) {
                window.open(track.audioUrl, '_blank');
            } else {
                UI.showToast('Download failed — try playing the song first', 'error');
            }
        } finally {
            this.activeDownloads.delete(track.id);
            this._updateDownloadButton(track.id, 'idle');
        }
    },

    /**
     * Trigger file download from blob
     */
    _triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            URL.revokeObjectURL(url);
            document.body.removeChild(a);
        }, 1000);
    },

    /**
     * Update download button state
     */
    _updateDownloadButton(trackId, state) {
        document.querySelectorAll(`.download-track-btn[data-track-id="${trackId}"]`).forEach(btn => {
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
        });
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
