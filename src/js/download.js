/**
 * Download Module v3 — Cobalt API Strategy
 * 
 * Downloads tracks as MP3 using Cobalt API (cobalt.tools)
 * 
 * Strategy:
 *   1. Resolve YouTube videoId for the track
 *   2. Send YouTube URL to Cobalt API (via /api/cobalt proxy)
 *   3. Cobalt returns tunnel/redirect URL → browser downloads
 * 
 * Fallbacks:
 *   - Local (XAMPP): yt-dlp + ffmpeg via download-proxy.php
 *   - If Cobalt fails: redirect to cobalt.tools web UI
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
        // Already have videoId
        if (track.videoId) return track.videoId;
        
        // audioUrl is yt:VIDEO_ID format
        if (track.audioUrl && track.audioUrl.startsWith('yt:')) {
            return track.audioUrl.substring(3);
        }

        // Need to search YouTube for this track
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
     * Download a track as MP3
     */
    async download(track) {
        if (!track || !track.id) {
            UI.showToast('No track to download', 'error');
            return;
        }

        if (this.activeDownloads.has(track.id)) {
            UI.showToast('Already downloading this track...', 'warning');
            return;
        }

        this.activeDownloads.set(track.id, true);
        this._updateDownloadButton(track.id, 'loading');

        try {
            // Step 1: Find YouTube videoId for this track
            UI.showToast(`🔍 Mencari: ${track.title}...`, 'info');
            const videoId = await this._resolveVideoId(track);

            if (!videoId) {
                throw new Error('Tidak dapat menemukan sumber YouTube untuk lagu ini');
            }

            const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

            // Step 2: Download method based on environment
            if (this.isLocal) {
                // LOCAL: yt-dlp + ffmpeg via PHP proxy → direct MP3 download
                await this._downloadLocal(track, videoId);
            } else {
                // VERCEL: Use Cobalt API → tunnel URL → browser download
                await this._downloadViaCobalt(track, ytUrl, videoId);
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
     * Download via local yt-dlp (XAMPP environment)
     */
    async _downloadLocal(track, videoId) {
        const baseName = this._sanitizeFilename(`${track.artist} - ${track.title}`);
        UI.showToast(`⬇️ Downloading MP3: ${track.title}... (tunggu 15-20 detik)`, 'info');
        
        const proxyUrl = `download-proxy.php?videoId=${encodeURIComponent(videoId)}&title=${encodeURIComponent(baseName)}`;
        window.location.href = proxyUrl;
        
        UI.showToast(`✅ Download dimulai: ${track.title}.mp3`, 'success');
    },

    /**
     * Download via Cobalt API (Vercel environment)
     */
    async _downloadViaCobalt(track, ytUrl, videoId) {
        UI.showToast(`⬇️ Memproses download: ${track.title}...`, 'info');

        try {
            const response = await fetch('/api/cobalt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: ytUrl,
                    audioFormat: 'mp3',
                    audioBitrate: '128'
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                console.warn('[Download] Cobalt API failed:', data);
                // Fallback to Cobalt web UI
                this._fallbackToCobaltWeb(ytUrl, track.title);
                return;
            }

            // Handle different response types from Cobalt
            if (data.status === 'tunnel' || data.status === 'redirect') {
                // Direct download URL — trigger browser download
                const downloadUrl = data.url;
                const filename = data.filename || this._sanitizeFilename(`${track.artist} - ${track.title}.mp3`);
                
                UI.showToast(`⬇️ Mengunduh: ${track.title}...`, 'info');
                
                // Use a hidden link to trigger download
                this._triggerDownload(downloadUrl, filename);
                
                UI.showToast(`✅ Download dimulai: ${track.title}`, 'success');

            } else if (data.status === 'picker') {
                // Multiple options — pick the first audio one
                const audioItem = data.picker?.find(p => p.type === 'video' || p.type === 'audio') || data.picker?.[0];
                if (audioItem && audioItem.url) {
                    this._triggerDownload(audioItem.url, `${track.artist} - ${track.title}.mp3`);
                    UI.showToast(`✅ Download dimulai: ${track.title}`, 'success');
                } else {
                    this._fallbackToCobaltWeb(ytUrl, track.title);
                }

            } else {
                console.warn('[Download] Unexpected Cobalt response status:', data.status);
                this._fallbackToCobaltWeb(ytUrl, track.title);
            }

        } catch (error) {
            console.error('[Download] Cobalt API error:', error);
            // Fallback to Cobalt web UI
            this._fallbackToCobaltWeb(ytUrl, track.title);
        }
    },

    /**
     * Fallback: open Cobalt web UI in new tab
     */
    _fallbackToCobaltWeb(ytUrl, title) {
        UI.showToast(`🔄 Membuka downloader eksternal untuk: ${title}...`, 'warning');
        window.open(`https://cobalt.tools/#url=${encodeURIComponent(ytUrl)}`, '_blank');
        UI.showToast('Selesaikan download di halaman yang terbuka', 'info');
    },

    /**
     * Trigger browser file download via hidden anchor
     */
    _triggerDownload(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        
        // Cleanup after short delay
        setTimeout(() => {
            document.body.removeChild(a);
        }, 1000);
    },

    /**
     * Update download button state (loading/idle)
     */
    _updateDownloadButton(trackId, state) {
        document.querySelectorAll(`.download-track-btn[data-track-id="${trackId}"]`).forEach(btn => {
            this._setButtonState(btn, state);
        });
        // Also update mobile expanded player download button
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
