/**
 * Download Module v3.3 — Local installs only
 *
 * The download path shells out to yt-dlp.exe + ffmpeg.exe through
 * download-proxy.php, so it only works where those binaries exist: a local
 * XAMPP install. Vercel is static + serverless -- no process spawning, no
 * filesystem, and the binaries are 220 MB. On a deployed host the buttons are
 * removed rather than left to fail.
 *
 * Local strategy:
 *   YouTube  → resolve videoId → download-proxy.php (yt-dlp → MP3)
 *   Direct   → download-proxy.php?url= (curl passthrough)
 */

const Downloader = {
    activeDownloads: new Map(),
    isLocal: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',

    init() {
        // Nothing to wire up on a deployed host -- _hideButtons has removed them.
        if (!this.isLocal) {
            this._hideButtons();
            return;
        }

        document.getElementById('mobileExpDownload')?.addEventListener('click', () => {
            if (Player.currentTrack) {
                this.download(Player.currentTrack);
            } else {
                UI.showToast('No track is playing', 'warning');
            }
        });

        document.getElementById('desktopDownloadBtn')?.addEventListener('click', () => {
            if (Player.currentTrack) {
                this.download(Player.currentTrack);
            } else {
                UI.showToast('No track is playing', 'warning');
            }
        });
    },

    /**
     * Strip every download affordance. Called on deployed hosts, where the
     * yt-dlp/ffmpeg toolchain the proxy needs does not exist.
     */
    _hideButtons() {
        document.getElementById('desktopDownloadBtn')?.remove();
        document.getElementById('mobileExpDownload')?.remove();
        document.querySelectorAll('.download-track-btn').forEach(btn => btn.remove());
    },

    /**
     * Main download entry point
     */
    async download(track) {
        if (!track || !track.id) {
            UI.showToast('No track to download', 'error');
            return;
        }

        if (this.activeDownloads.has(track.id)) {
            UI.showToast('Sedang mendownload lagu ini...', 'warning');
            return;
        }

        this.activeDownloads.set(track.id, true);
        this._updateDownloadButton(track.id, 'loading');
        const filename = this._sanitizeFilename(`${track.artist} - ${track.title}`);

        try {
            await this._downloadLocal(track, filename);
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
    async _downloadLocal(track, baseName) {
        if (!track.videoId) {
            await MusicAPI.resolveAudioUrl(track);
        }

        if (track.videoId) {
            UI.showToast(`⬇️ Downloading: ${track.title}... (tunggu 15-20 detik)`, 'info');
            window.location.href = `download-proxy.php?videoId=${encodeURIComponent(track.videoId)}&title=${encodeURIComponent(baseName)}`;
            UI.showToast(`✅ Download dimulai: ${baseName}.mp3`, 'success');
        } else if (track.audioUrl && !track.audioUrl.startsWith('yt:')) {
            // Direct audio URL — hand it to the proxy so it lands as a file.
            const a = document.createElement('a');
            a.href = `download-proxy.php?url=${encodeURIComponent(track.audioUrl)}&filename=${encodeURIComponent(baseName + '.mp3')}`;
            a.download = baseName + '.mp3';
            a.click();
            UI.showToast(`✅ Download dimulai: ${baseName}.mp3`, 'success');
        } else {
            UI.showToast('❌ Tidak dapat menemukan sumber download', 'error');
        }
    },

    /**
     * Update download button visual state
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
        return name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().substring(0, 200);
    }
};
