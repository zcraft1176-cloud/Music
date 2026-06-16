/**
 * Liked Songs Module
 * Spotify-style like/favorite system with localStorage + Firestore cloud sync
 */

const LikedSongs = {
    songs: [],

    /**
     * Initialize liked songs system
     */
    init() {
        this.loadFromStorage();
        this.setupListeners();
        this.updateAllUI();
    },

    // ==========================================
    // Core CRUD
    // ==========================================

    /**
     * Toggle like status for a track
     */
    toggleLike(track) {
        if (!track || !track.id) return;

        const index = this.songs.findIndex(s => s.id === track.id);
        if (index > -1) {
            // Unlike
            this.songs.splice(index, 1);
            UI.showToast('Removed from Liked Songs', 'info');
        } else {
            // Like — add to beginning (most recent first)
            this.songs.unshift({
                id: track.id,
                title: track.title,
                artist: track.artist,
                cover: track.cover,
                duration: track.duration,
                bitrate: track.bitrate,
                source: track.source,
                likedAt: new Date().toISOString()
            });
            UI.showToast('Added to Liked Songs', 'success');
        }

        this.saveToStorage();
        this.updateAllUI();
        this._cloudSync();
    },

    /**
     * Check if a track is liked
     */
    isLiked(trackId) {
        return this.songs.some(s => s.id === trackId);
    },

    /**
     * Remove a track by index from liked songs
     */
    removeByIndex(index) {
        if (index >= 0 && index < this.songs.length) {
            const removed = this.songs.splice(index, 1)[0];
            this.saveToStorage();
            this.updateAllUI();
            this.renderLikedView();
            UI.showToast(`Removed "${removed.title}"`, 'info');
            this._cloudSync();
        }
    },

    // ==========================================
    // UI Updates
    // ==========================================

    /**
     * Update all like-related UI elements
     */
    updateAllUI() {
        const count = this.songs.length;

        // Sidebar count badge
        const likedCountEl = document.getElementById('likedCount');
        if (likedCountEl) likedCountEl.textContent = count;

        // Liked songs count in view header
        const likedSongsCount = document.getElementById('likedSongsCount');
        if (likedSongsCount) likedSongsCount.textContent = `${count} song${count !== 1 ? 's' : ''}`;

        // Update player bar like buttons
        this.updatePlayerLikeButtons();

        // Update all like buttons on track cards/rows
        this.updateTrackLikeButtons();
    },

    /**
     * Update player bar like buttons (desktop + expanded mobile)
     */
    updatePlayerLikeButtons() {
        const currentTrack = Player.currentTrack;
        const isLiked = currentTrack ? this.isLiked(currentTrack.id) : false;

        // Desktop like button
        const desktopBtn = document.getElementById('desktopLikeBtn');
        if (desktopBtn) {
            const outline = desktopBtn.querySelector('.like-icon-outline');
            const filled = desktopBtn.querySelector('.like-icon-filled');
            if (isLiked) {
                outline?.classList.add('hidden');
                filled?.classList.remove('hidden');
                desktopBtn.classList.add('text-primary');
                desktopBtn.classList.remove('text-gray-500');
            } else {
                outline?.classList.remove('hidden');
                filled?.classList.add('hidden');
                desktopBtn.classList.remove('text-primary');
                desktopBtn.classList.add('text-gray-500');
            }
        }

        // Mobile expanded like button
        const mobileBtn = document.getElementById('mobileExpFavorite');
        if (mobileBtn) {
            const svg = mobileBtn.querySelector('svg');
            if (isLiked) {
                mobileBtn.classList.add('text-primary');
                mobileBtn.classList.remove('text-gray-500');
                if (svg) {
                    svg.setAttribute('fill', 'currentColor');
                    svg.innerHTML = '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>';
                }
            } else {
                mobileBtn.classList.remove('text-primary');
                mobileBtn.classList.add('text-gray-500');
                if (svg) {
                    svg.setAttribute('fill', 'none');
                    svg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>';
                }
            }
        }
    },

    /**
     * Update like buttons on visible track cards
     */
    updateTrackLikeButtons() {
        document.querySelectorAll('.like-track-btn').forEach(btn => {
            const trackId = btn.dataset.trackId;
            const isLiked = this.isLiked(trackId);
            const outline = btn.querySelector('.like-icon-outline');
            const filled = btn.querySelector('.like-icon-filled');

            if (isLiked) {
                outline?.classList.add('hidden');
                filled?.classList.remove('hidden');
                btn.classList.add('text-primary');
                btn.classList.remove('text-gray-400');
            } else {
                outline?.classList.remove('hidden');
                filled?.classList.add('hidden');
                btn.classList.remove('text-primary');
                btn.classList.add('text-gray-400');
            }
        });
    },

    // ==========================================
    // View Rendering
    // ==========================================

    /**
     * Render the liked songs view
     */
    renderLikedView() {
        const container = document.getElementById('likedSongsContent');
        if (!container) return;

        if (this.songs.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12 text-gray-400">
                    <svg class="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
                    </svg>
                    <p class="text-lg">No liked songs yet</p>
                    <p class="text-sm mt-1">Songs you like will appear here</p>
                </div>`;
            return;
        }

        container.innerHTML = this.songs.map((track, index) => {
            const quality = MusicAPI.getQualityLabel(track.bitrate);
            const isPlaying = Player.currentTrack?.id === track.id;
            const duration = Player.formatTime(track.duration);

            return `
                <div class="track-card flex items-center gap-4 p-3 rounded-lg cursor-pointer hover:bg-dark-100 transition-colors ${isPlaying ? 'playing' : ''}" data-track-index="${index}">
                    <span class="text-xs text-gray-500 w-6 text-center shrink-0">${index + 1}</span>
                    <div class="relative w-12 h-12 shrink-0">
                        <img 
                            src="${track.cover}" 
                            alt="${track.title}" 
                            class="w-full h-full object-cover rounded"
                            onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%234a5568%22><path d=%22M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z%22/></svg>'"
                        >
                        ${isPlaying ? `
                            <div class="absolute inset-0 bg-black/50 rounded flex items-center justify-center">
                                <div class="playing-indicator">
                                    <span></span><span></span><span></span><span></span>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="font-medium text-sm truncate">${UI.escapeHtml(track.title)}</p>
                        <p class="text-xs text-gray-400 truncate">${UI.escapeHtml(track.artist)}</p>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="quality-badge ${quality.class}">${quality.label}</span>
                        <span class="text-xs text-gray-400 w-12 text-right">${duration}</span>

                        <button class="unlike-btn p-2 text-primary hover:text-red-400 transition-colors" data-liked-index="${index}" title="Remove from liked">
                            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Attach listeners
        this._attachLikedViewListeners(container);
    },

    /**
     * Attach event listeners to liked view track items
     */
    _attachLikedViewListeners(container) {
        // Click to play
        container.querySelectorAll('.track-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const index = parseInt(card.dataset.trackIndex);
                if (this.songs[index]) {
                    Player.clearQueue();
                    Player.addMultipleToQueue(this.songs);
                    Player.playFromQueue(index);
                }
            });
        });

        // Unlike buttons
        container.querySelectorAll('.unlike-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.likedIndex);
                this.removeByIndex(index);
            });
        });


    },

    /**
     * Play all liked songs
     */
    playAll() {
        if (this.songs.length === 0) {
            UI.showToast('No liked songs to play', 'warning');
            return;
        }
        Player.clearQueue();
        Player.addMultipleToQueue(this.songs);
        Player.playFromQueue(0);
    },

    /**
     * Shuffle play all liked songs
     */
    shufflePlay() {
        if (this.songs.length === 0) {
            UI.showToast('No liked songs to play', 'warning');
            return;
        }
        const shuffled = [...this.songs].sort(() => Math.random() - 0.5);
        Player.clearQueue();
        Player.addMultipleToQueue(shuffled);
        Player.playFromQueue(0);
    },

    // ==========================================
    // Event Listeners
    // ==========================================

    setupListeners() {
        // Desktop player bar like button
        document.getElementById('desktopLikeBtn')?.addEventListener('click', () => {
            if (Player.currentTrack) {
                this.toggleLike(Player.currentTrack);
            }
        });

        // Mobile expanded player like button
        document.getElementById('mobileExpFavorite')?.addEventListener('click', () => {
            if (Player.currentTrack) {
                this.toggleLike(Player.currentTrack);
            }
        });

        // Play all liked
        document.getElementById('playAllLikedBtn')?.addEventListener('click', () => {
            this.playAll();
        });

        // Shuffle liked
        document.getElementById('shuffleLikedBtn')?.addEventListener('click', () => {
            this.shufflePlay();
        });
    },

    // ==========================================
    // Storage (localStorage)
    // ==========================================

    saveToStorage() {
        localStorage.setItem('likedSongs', JSON.stringify(this.songs));
    },

    loadFromStorage() {
        try {
            this.songs = JSON.parse(localStorage.getItem('likedSongs')) || [];
        } catch (e) {
            console.error('Error loading liked songs:', e);
            this.songs = [];
        }
    },

    // ==========================================
    // Cloud Sync (Firestore)
    // ==========================================

    async _cloudSync() {
        if (!Auth.isLoggedIn() || !Auth.db) return;

        try {
            const uid = Auth.getUid();
            await Auth.db
                .collection('users').doc(uid)
                .collection('settings').doc('likedSongs')
                .set({ songs: this.songs, updatedAt: new Date().toISOString() });
        } catch (e) {
            console.error('Cloud sync liked songs error:', e);
        }
    },

    async syncFromCloud() {
        if (!Auth.isLoggedIn() || !Auth.db) return;

        try {
            const uid = Auth.getUid();
            const doc = await Auth.db
                .collection('users').doc(uid)
                .collection('settings').doc('likedSongs')
                .get();

            if (doc.exists) {
                const cloudSongs = doc.data().songs || [];

                // Merge: keep cloud as master, add local songs not in cloud
                const cloudIds = new Set(cloudSongs.map(s => s.id));
                const localOnly = this.songs.filter(s => !cloudIds.has(s.id));

                if (localOnly.length > 0) {
                    // Upload local-only songs to cloud
                    this.songs = [...cloudSongs, ...localOnly];
                    this.saveToStorage();
                    this._cloudSync();
                    UI.showToast(`${localOnly.length} liked song(s) synced to cloud`, 'success');
                } else {
                    this.songs = cloudSongs;
                    this.saveToStorage();
                }
            }

            this.updateAllUI();
            console.log(`Synced ${this.songs.length} liked songs from cloud`);
        } catch (e) {
            console.error('Cloud sync liked songs error:', e);
            this.loadFromStorage();
        }
    }
};
