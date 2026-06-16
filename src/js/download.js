/**
 * Download Module
 * Downloads tracks as MP3 using yt-dlp + ffmpeg backend
 * 
 * Strategy:
 * - ALL tracks (Deezer/YouTube): resolve to YouTube videoId → yt-dlp → MP3
 * - Local (XAMPP): download-proxy.php handles yt-dlp + ffmpeg conversion
 * - Vercel: redirects to cobalt.tools (no yt-dlp available)
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
     * Resolve YouTube videoId for a track (search via Piped/Invidious)
     */
    async _resolveVideoId(track) {
        // Already have videoId
        if (track.videoId) return track.videoId;
        
        // audioUrl is yt:VIDEO_ID format
        if (track.audioUrl && track.audioUrl.startsWith('yt:')) {
            return track.audioUrl.substring(3);
        }

        // Need to search YouTube for this track
        console.log('[Download] Resolving YouTube videoId...');
        const resolved = await MusicAPI.resolveAudioUrl(track);
        if (resolved && track.videoId) {
            return track.videoId;
        }
        if (resolved && track.audioUrl && track.audioUrl.startsWith('yt:')) {
            return track.audioUrl.substring(3);
        }
        return null;
    },

    /**
     * Download a track as MP3
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

        const baseName = this._sanitizeFilename(`${track.artist} - ${track.title}`);

        try {
            // Step 1: Find YouTube videoId for this track
            UI.showToast(`Finding: ${track.title}...`, 'info');
            const videoId = await this._resolveVideoId(track);

            if (!videoId) {
                throw new Error('Could not find YouTube source for this track');
            }

            // Step 2: Download as MP3
            if (this.isLocal) {
                // LOCAL: yt-dlp + ffmpeg via PHP proxy → direct MP3 download
                UI.showToast(`Downloading MP3: ${track.title}... (tunggu 15-20 detik)`, 'info');
                const proxyUrl = `download-proxy.php?videoId=${encodeURIComponent(videoId)}&title=${encodeURIComponent(baseName)}`;
                
                // Direct navigation — browser handles Content-Disposition: attachment
                window.location.href = proxyUrl;

                UI.showToast(`✅ Download started: ${track.title}.mp3`, 'success');
            } else {
                // VERCEL: No yt-dlp, redirect to external downloader
                const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
                UI.showToast('Opening download page...', 'info');
                window.open(`https://cobalt.tools/#url=${encodeURIComponent(ytUrl)}`, '_blank');
                UI.showToast('Complete the download on the opened page', 'success');
            }

        } catch (error) {
            console.error('[Download] Error:', error);
            UI.showToast(`Download failed: ${error.message}`, 'error');
        } finally {
            this.activeDownloads.delete(track.id);
            this._updateDownloadButton(track.id, 'idle');
        }
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
