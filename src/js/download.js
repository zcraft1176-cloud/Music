/**
 * Download Module v3.2 — Smart Multi-Strategy
 * 
 * Strategy priority:
 *   1. Direct URL (Internet Archive / Jamendo) → proxy download langsung
 *   2. YouTube → resolve direct audio URL via Piped/Invidious → proxy download
 *   3. Fallback → copy YouTube URL to clipboard + buka cobalt.tools
 * 
 * Local (XAMPP): yt-dlp + ffmpeg via download-proxy.php
 */

const Downloader = {
    activeDownloads: new Map(),
    isLocal: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',

    init() {
        document.getElementById('mobileExpDownload')?.addEventListener('click', () => {
            if (Player.currentTrack) {
                this.download(Player.currentTrack);
            } else {
                UI.showToast('No track is playing', 'warning');
            }
        });
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
            // === LOCAL (XAMPP) ===
            if (this.isLocal) {
                await this._downloadLocal(track, filename);
                return;
            }

            // === VERCEL / PRODUCTION ===
            
            // Strategy 1: Direct audio URL (Internet Archive / Jamendo)
            if (track.audioUrl && !track.audioUrl.startsWith('yt:')) {
                UI.showToast(`⬇️ Downloading: ${track.title}...`, 'info');
                const success = await this._downloadViaProxy(track.audioUrl, filename + '.mp3');
                if (success) return;
            }

            // Strategy 2: Resolve direct audio stream from YouTube
            UI.showToast(`🔍 Mencari sumber download: ${track.title}...`, 'info');
            
            // Make sure we have a videoId first
            if (!track.videoId) {
                await MusicAPI.resolveAudioUrl(track);
            }

            if (track.videoId) {
                // Try getting direct audio stream URL via Piped/Invidious
                const directAudio = await MusicAPI.getDirectAudioUrl(track);
                if (directAudio && directAudio.url) {
                    const ext = directAudio.format === 'webm' ? '.webm' 
                              : directAudio.format === 'm4a' ? '.m4a' 
                              : '.mp3';
                    UI.showToast(`⬇️ Downloading: ${track.title}...`, 'info');
                    const success = await this._downloadViaProxy(directAudio.url, filename + ext);
                    if (success) return;
                }
            }

            // Strategy 3: Fallback — copy YouTube URL to clipboard
            if (track.videoId) {
                this._fallbackClipboard(track);
            } else {
                UI.showToast('❌ Tidak dapat menemukan sumber download', 'error');
            }

        } catch (error) {
            console.error('[Download] Error:', error);
            // Last resort fallback
            if (track.videoId) {
                this._fallbackClipboard(track);
            } else {
                UI.showToast(`❌ Download gagal: ${error.message}`, 'error');
            }
        } finally {
            this.activeDownloads.delete(track.id);
            this._updateDownloadButton(track.id, 'idle');
        }
    },

    /**
     * Download via Vercel proxy (/api/download?url=...)
     * Streams the audio through our serverless function to avoid CORS
     */
    async _downloadViaProxy(audioUrl, filename) {
        try {
            const proxyUrl = `/api/download?url=${encodeURIComponent(audioUrl)}`;
            
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                console.warn('[Download] Proxy returned:', response.status);
                return false;
            }

            const blob = await response.blob();
            if (blob.size < 1000) {
                console.warn('[Download] Blob too small, likely error:', blob.size);
                return false;
            }

            // Create download link
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

            UI.showToast(`✅ Download selesai: ${filename}`, 'success');
            return true;

        } catch (error) {
            console.error('[Download] Proxy download failed:', error);
            return false;
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
            // Direct audio URL — just open it
            const a = document.createElement('a');
            a.href = track.audioUrl;
            a.download = baseName + '.mp3';
            a.click();
            UI.showToast(`✅ Download dimulai: ${baseName}.mp3`, 'success');
        } else {
            UI.showToast('❌ Tidak dapat menemukan sumber download', 'error');
        }
    },

    /**
     * Fallback: copy YouTube URL to clipboard + open cobalt.tools
     */
    _fallbackClipboard(track) {
        const ytUrl = `https://www.youtube.com/watch?v=${track.videoId}`;

        // Copy to clipboard
        navigator.clipboard.writeText(ytUrl).then(() => {
            UI.showToast('📋 Link YouTube sudah di-copy! Paste di cobalt.tools', 'success');
        }).catch(() => {
            // Fallback for older browsers
            const input = document.createElement('input');
            input.value = ytUrl;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            UI.showToast('📋 Link YouTube sudah di-copy! Paste di cobalt.tools', 'success');
        });

        // Open cobalt.tools
        window.open('https://cobalt.tools/', '_blank');
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
