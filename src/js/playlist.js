/**
 * Playlist Management Module
 * Handles creating, editing, and managing playlists
 * Supports both localStorage (offline) and Firestore (cloud sync)
 */

const PlaylistManager = {
    playlists: [],
    currentPlaylistId: null,
    _sortableInstance: null,

    /**
     * Initialize playlist manager
     */
    init() {
        this.loadPlaylists();
        this.setupListeners();
        this.renderPlaylistList();
    },

    /**
     * Setup event listeners
     */
    setupListeners() {
        const createBtn = document.getElementById('createPlaylistBtn');
        const confirmBtn = document.getElementById('confirmPlaylistBtn');
        const cancelBtn = document.getElementById('cancelPlaylistBtn');
        const modal = document.getElementById('createPlaylistModal');
        const nameInput = document.getElementById('playlistNameInput');
        const playPlaylistBtn = document.getElementById('playPlaylistBtn');
        const deletePlaylistBtn = document.getElementById('deletePlaylistBtn');
        const addToPlaylistCancel = document.getElementById('cancelAddToPlaylistBtn');

        // Create playlist button
        createBtn?.addEventListener('click', () => {
            modal?.classList.remove('hidden');
            nameInput?.focus();
        });

        // Confirm create playlist
        confirmBtn?.addEventListener('click', () => {
            const name = nameInput?.value.trim();
            if (name) {
                this.createPlaylist(name);
                nameInput.value = '';
                modal?.classList.add('hidden');
            }
        });

        // Cancel create playlist
        cancelBtn?.addEventListener('click', () => {
            nameInput.value = '';
            modal?.classList.add('hidden');
        });

        // Enter key in name input
        nameInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                confirmBtn?.click();
            }
        });

        // Close modal on backdrop click
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });

        // Play all playlist tracks
        playPlaylistBtn?.addEventListener('click', () => {
            if (this.currentPlaylistId) {
                this.playPlaylist(this.currentPlaylistId);
            }
        });

        // Delete playlist
        deletePlaylistBtn?.addEventListener('click', () => {
            if (this.currentPlaylistId) {
                this.deletePlaylist(this.currentPlaylistId);
            }
        });

        // Close add to playlist modal
        addToPlaylistCancel?.addEventListener('click', () => {
            document.getElementById('addToPlaylistModal')?.classList.add('hidden');
        });
    },

    // ==========================================
    // CRUD Operations
    // ==========================================

    /**
     * Create a new playlist
     */
    async createPlaylist(name) {
        const playlist = {
            id: `playlist_${Date.now()}`,
            name: name,
            tracks: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.playlists.push(playlist);
        this.savePlaylists();
        this.renderPlaylistList();
        UI.showToast(`Playlist "${name}" created`, 'success');

        // Sync to cloud
        if (Auth.isLoggedIn()) {
            await this._cloudSavePlaylist(playlist);
        }
        
        return playlist;
    },

    /**
     * Delete a playlist
     */
    async deletePlaylist(id) {
        const playlist = this.playlists.find(p => p.id === id);
        if (!playlist) return;

        if (confirm(`Delete playlist "${playlist.name}"?`)) {
            this.playlists = this.playlists.filter(p => p.id !== id);
            this.savePlaylists();
            this.renderPlaylistList();
            
            if (this.currentPlaylistId === id) {
                this.currentPlaylistId = null;
                UI.showView('home');
            }
            
            UI.showToast(`Playlist "${playlist.name}" deleted`, 'info');

            // Delete from cloud
            if (Auth.isLoggedIn()) {
                await this._cloudDeletePlaylist(id);
            }
        }
    },

    /**
     * Rename a playlist
     */
    async renamePlaylist(id, newName) {
        const playlist = this.playlists.find(p => p.id === id);
        if (!playlist) return;

        playlist.name = newName;
        playlist.updatedAt = new Date().toISOString();
        this.savePlaylists();
        this.renderPlaylistList();
        
        if (this.currentPlaylistId === id) {
            document.getElementById('playlistTitle').textContent = newName;
        }
        
        UI.showToast(`Playlist renamed to "${newName}"`, 'success');

        // Sync to cloud
        if (Auth.isLoggedIn()) {
            await this._cloudSavePlaylist(playlist);
        }
    },

    /**
     * Add track to playlist
     */
    async addTrackToPlaylist(playlistId, track) {
        const playlist = this.playlists.find(p => p.id === playlistId);
        if (!playlist) return;

        // Check for duplicates
        const exists = playlist.tracks.some(t => t.id === track.id);
        if (exists) {
            UI.showToast('Track already in playlist', 'warning');
            return;
        }

        playlist.tracks.push(track);
        playlist.updatedAt = new Date().toISOString();
        this.savePlaylists();
        
        UI.showToast(`Added to "${playlist.name}"`, 'success');
        
        // Update view if currently viewing this playlist
        if (this.currentPlaylistId === playlistId) {
            this.viewPlaylist(playlistId);
        }

        // Sync to cloud
        if (Auth.isLoggedIn()) {
            await this._cloudSavePlaylist(playlist);
        }
    },

    /**
     * Remove track from playlist
     */
    async removeTrackFromPlaylist(playlistId, trackIndex) {
        const playlist = this.playlists.find(p => p.id === playlistId);
        if (!playlist) return;

        playlist.tracks.splice(trackIndex, 1);
        playlist.updatedAt = new Date().toISOString();
        this.savePlaylists();
        
        if (this.currentPlaylistId === playlistId) {
            this.viewPlaylist(playlistId);
        }

        // Sync to cloud
        if (Auth.isLoggedIn()) {
            await this._cloudSavePlaylist(playlist);
        }
    },

    /**
     * Reorder tracks in playlist (after drag-and-drop)
     */
    async reorderTracks(playlistId, oldIndex, newIndex) {
        const playlist = this.playlists.find(p => p.id === playlistId);
        if (!playlist) return;

        const [moved] = playlist.tracks.splice(oldIndex, 1);
        playlist.tracks.splice(newIndex, 0, moved);
        playlist.updatedAt = new Date().toISOString();
        this.savePlaylists();

        // Sync to cloud
        if (Auth.isLoggedIn()) {
            await this._cloudSavePlaylist(playlist);
        }
    },

    // ==========================================
    // View & Playback
    // ==========================================

    /**
     * View a playlist
     */
    viewPlaylist(id) {
        const playlist = this.playlists.find(p => p.id === id);
        if (!playlist) return;

        this.currentPlaylistId = id;
        document.getElementById('playlistTitle').textContent = playlist.name;
        UI.showView('playlist');
        UI.renderPlaylistContent(playlist);

        // Initialize drag-and-drop after render
        this._initSortable();
    },

    /**
     * Play all tracks in a playlist
     */
    playPlaylist(id) {
        const playlist = this.playlists.find(p => p.id === id);
        if (!playlist || playlist.tracks.length === 0) {
            UI.showToast('Playlist is empty', 'warning');
            return;
        }

        Player.clearQueue();
        Player.addMultipleToQueue(playlist.tracks);
        Player.playFromQueue(0);
    },

    /**
     * Show add to playlist modal for a track
     */
    showAddToPlaylistModal(track) {
        const modal = document.getElementById('addToPlaylistModal');
        const options = document.getElementById('playlistOptions');
        
        if (this.playlists.length === 0) {
            UI.showToast('No playlists yet. Create one first!', 'info');
            return;
        }

        options.innerHTML = this.playlists.map(playlist => `
            <button 
                class="w-full text-left px-4 py-3 rounded-lg hover:bg-dark-100 transition-colors flex items-center gap-3"
                onclick="PlaylistManager.addTrackToPlaylist('${playlist.id}', ${JSON.stringify(track).replace(/"/g, '&quot;')}); document.getElementById('addToPlaylistModal').classList.add('hidden');"
            >
                <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                </svg>
                <div>
                    <p class="font-medium">${playlist.name}</p>
                    <p class="text-xs text-gray-400">${playlist.tracks.length} tracks</p>
                </div>
            </button>
        `).join('');

        modal?.classList.remove('hidden');
    },

    // ==========================================
    // Drag & Drop (SortableJS)
    // ==========================================

    /**
     * Initialize SortableJS on playlist content
     */
    _initSortable() {
        // Destroy previous instance
        if (this._sortableInstance) {
            this._sortableInstance.destroy();
            this._sortableInstance = null;
        }

        const container = document.getElementById('playlistContent');
        if (!container || !this.currentPlaylistId) return;

        this._sortableInstance = new Sortable(container, {
            animation: 200,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            handle: '.drag-handle',
            onEnd: (evt) => {
                if (evt.oldIndex !== evt.newIndex) {
                    this.reorderTracks(this.currentPlaylistId, evt.oldIndex, evt.newIndex);
                }
            }
        });
    },

    // ==========================================
    // Sidebar Rendering
    // ==========================================

    /**
     * Render playlist list in sidebar
     */
    renderPlaylistList() {
        const container = document.getElementById('playlistList');
        if (!container) return;

        if (this.playlists.length === 0) {
            container.innerHTML = `
                <p class="text-sm text-gray-500 text-center py-4">No playlists yet</p>
            `;
            return;
        }

        container.innerHTML = this.playlists.map(playlist => `
            <button 
                class="playlist-item w-full text-left px-3 py-2 rounded-lg hover:bg-dark-100 transition-colors text-sm truncate ${this.currentPlaylistId === playlist.id ? 'bg-dark-100 text-primary' : 'text-gray-300'}"
                data-playlist-id="${playlist.id}"
                onclick="PlaylistManager.viewPlaylist('${playlist.id}')"
            >
                <div class="flex items-center gap-2">
                    <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                    </svg>
                    <span class="truncate">${playlist.name}</span>
                    <span class="ml-auto text-xs text-gray-500">${playlist.tracks.length}</span>
                </div>
            </button>
        `).join('');
    },

    // ==========================================
    // Local Storage
    // ==========================================

    /**
     * Save playlists to localStorage
     */
    savePlaylists() {
        localStorage.setItem('playlists', JSON.stringify(this.playlists));
    },

    /**
     * Load playlists from localStorage
     */
    loadPlaylists() {
        try {
            this.playlists = JSON.parse(localStorage.getItem('playlists')) || [];
        } catch (error) {
            console.error('Error loading playlists:', error);
            this.playlists = [];
        }
    },

    // ==========================================
    // Cloud Sync (Firestore)
    // ==========================================

    /**
     * Sync playlists from Firestore (called on login)
     * Merges local playlists into cloud if they don't exist there
     */
    async syncFromCloud() {
        if (!Auth.isLoggedIn() || !Auth.db) return;

        try {
            const uid = Auth.getUid();
            const snapshot = await Auth.db
                .collection('users').doc(uid)
                .collection('playlists').get();

            const cloudPlaylists = [];
            snapshot.forEach(doc => {
                cloudPlaylists.push({ id: doc.id, ...doc.data() });
            });

            // Get local playlists
            const localPlaylists = [...this.playlists];

            // Merge: upload local playlists that don't exist in cloud
            const cloudIds = new Set(cloudPlaylists.map(p => p.id));
            const toUpload = localPlaylists.filter(p => !cloudIds.has(p.id));

            for (const playlist of toUpload) {
                await this._cloudSavePlaylist(playlist);
                console.log(`Uploaded local playlist to cloud: ${playlist.name}`);
            }

            // Use cloud as master (cloud + newly uploaded local)
            this.playlists = [...cloudPlaylists, ...toUpload];
            this.savePlaylists(); // Cache locally
            this.renderPlaylistList();

            if (toUpload.length > 0) {
                UI.showToast(`${toUpload.length} local playlist(s) synced to cloud`, 'success');
            }

            console.log(`Synced ${this.playlists.length} playlists from cloud`);
        } catch (e) {
            console.error('Cloud sync error:', e);
            UI.showToast('Failed to sync playlists', 'error');
            // Fallback to local
            this.loadPlaylists();
            this.renderPlaylistList();
        }
    },

    /**
     * Save a single playlist to Firestore
     */
    async _cloudSavePlaylist(playlist) {
        if (!Auth.isLoggedIn() || !Auth.db) return;

        try {
            const uid = Auth.getUid();
            await Auth.db
                .collection('users').doc(uid)
                .collection('playlists').doc(playlist.id)
                .set({
                    name: playlist.name,
                    tracks: playlist.tracks,
                    createdAt: playlist.createdAt,
                    updatedAt: playlist.updatedAt
                });
        } catch (e) {
            console.error('Cloud save error:', e);
        }
    },

    /**
     * Delete a playlist from Firestore
     */
    async _cloudDeletePlaylist(id) {
        if (!Auth.isLoggedIn() || !Auth.db) return;

        try {
            const uid = Auth.getUid();
            await Auth.db
                .collection('users').doc(uid)
                .collection('playlists').doc(id)
                .delete();
        } catch (e) {
            console.error('Cloud delete error:', e);
        }
    }
};
