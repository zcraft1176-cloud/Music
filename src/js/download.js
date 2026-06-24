/**
 * Download Module v3.1 — Cobalt Web Redirect
 * 
 * Strategy:
 *   1. Resolve YouTube videoId for the track
 *   2. Open cobalt.tools with the YouTube URL pre-filled
 *   3. User clicks download on cobalt.tools (1 klik doang)
 * 
 * Local (XAMPP): yt-dlp + ffmpeg via download-proxy.php (tetap sama)
 */

const Downloader = {
    activeDownloads: new Map(),
    isLocal: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',

    /**
     * Initialize download listeners
     */
    init() {
        // Mobile expanded player download button
        document.getElementById('mobileExpDownload')?.addEventListener('click', () => {
            if (Player.currentTrack) {
                this.download(Player.currentTrack);
            } else {
                UI.showToast('No track is playing', 'warning');
            }
        });
    },

    /**
     * Resolve YouTube videoId for a track
     */
    async _resolveVideoId(track) {
        if (track.videoId) return track.videoId;
        
        if (track.audioUrl && track.audioUrl.startsWith('yt:')) {
            return track.audioUrl.substring(3);
        }

        console.log('[Download] Resolving YouTube videoId via search...');
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
     * Download a track
     */
    async download(track) {
        if (!track || !track.id) {
            UI.showToast('No track to download', 'error');
            return;
        }

        if (this.activeDownloads.has(track.id)) {
            UI.showToast('Already processing this track...', 'warning');
            return;
        }

        this.activeDownloads.set(track.id, true);
        this._updateDownloadButton(track.id, 'loading');

        try {
            UI.showToast(`🔍 Mencari sumber: ${track.title}...`, 'info');
            const videoId = await this._resolveVideoId(track);

            if (!videoId) {
                throw new Error('Tidak dapat menemukan sumber YouTube untuk lagu ini');
            }

            if (this.isLocal) {
                await this._downloadLocal(track, videoId);
            } else {
                this._openCobalt(track, videoId);
            }

        } catch (error) {
            console.error('[Download] Error:', error);
            UI.showToast(`❌ Download gagal: ${error.message}`, 'error');
        } finally {
            this.activeDownloads.delete(track.id);
            this._updateDownloadButton(track.id, 'idle');
        }
    },

    /**
     * Local download via yt-dlp (XAMPP)
     */
    async _downloadLocal(track, videoId) {
        const baseName = this._sanitizeFilename(`${track.artist} - ${track.title}`);
        UI.showToast(`⬇️ Downloading: ${track.title}...`, 'info');
        
        const proxyUrl = `download-proxy.php?videoId=${encodeURIComponent(videoId)}&title=${encodeURIComponent(baseName)}`;
        window.location.href = proxyUrl;
        
        UI.showToast(`✅ Download dimulai: ${track.title}.mp3`, 'success');
    },

    /**
     * Open cobalt.tools with YouTube URL pre-filled
     */
    _openCobalt(track, videoId) {
        const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        UI.showToast(`🔗 Membuka downloader untuk: ${track.title}`, 'info');
        
        // cobalt.tools supports URL hash to pre-fill the input
        window.open(`https://cobalt.tools/#url=${encodeURIComponent(ytUrl)}`, '_blank');
        
        UI.showToast('Klik tombol "paste" lalu download di halaman cobalt', 'success');
    },

    /**
     * Update download button state
     */
    _updateDownloadButton(trackId, state) {
        document.querySelectorAll(`.download-track-btn[data-track-id="${trackId}"]`).forEach(btn => {
            this._setButtonState(btn, state);
        });
        const mobileBtn = document.getElementById('mobileExpDownload');
        if (mobileBtn && Player.currentTrack?.id === trackId) {
            if (state === 'loading') {
                mobileBtn.classList.add('opacity-50', 'pointer-events-none');
            } else {
                mobileBtn.classList.remove('opacity-50', 'pointer-events-none');
            }
        }
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

    _sanitizeFilename(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 200);
    }
};
