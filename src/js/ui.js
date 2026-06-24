/**
 * UI Rendering Module
 * Handles all UI updates, rendering, and interactions
 */

const UI = {
    // Current view
    currentView: 'home',

    /**
     * Initialize UI
     */
    init() {
        this.setupNavigation();
        this.setupClearQueue();
    },

    /**
     * Setup navigation buttons
     */
    setupNavigation() {
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                if (view) {
                    this.setActiveNav(btn);
                    
                    if (view === 'trending') {
                        Search.loadAllTrending();
                    } else if (view === 'home') {
                        this.showView('home');
                    } else if (view === 'search') {
                        this.showView('search');
                        document.getElementById('searchInput')?.focus();
                    } else if (view === 'history') {
                        this.showView('history');
                        this.renderHistoryView();
                    } else if (view === 'liked') {
                        this.showView('liked');
                        LikedSongs.renderLikedView();
                    } else if (view === 'playlists') {
                        this.showView('playlists');
                        this.renderPlaylistsPage();
                    } else if (view === 'settings') {
                        this.showView('settings');
                        App.loadSettings();
                    }
                }

                // Close mobile menu
                document.getElementById('sidebar')?.classList.remove('open');
            });
        });

        // Set home as active by default
        const homeBtn = document.querySelector('[data-view="home"]');
        if (homeBtn) this.setActiveNav(homeBtn);
    },

    /**
     * Setup clear queue button
     */
    setupClearQueue() {
        const clearBtn = document.getElementById('clearQueueBtn');
        clearBtn?.addEventListener('click', () => {
            Player.clearQueue();
        });
    },

    /**
     * Set active navigation item
     */
    setActiveNav(activeBtn) {
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        activeBtn?.classList.add('active');
    },

    /**
     * Show a specific view
     */
    showView(viewName) {
        // Hide all views
        document.querySelectorAll('.view-content').forEach(v => v.classList.add('hidden'));
        
        // Show selected view
        const view = document.getElementById(`${viewName}View`);
        if (view) {
            view.classList.remove('hidden');
            this.currentView = viewName;
        }

        // Update navigation
        const navBtn = document.querySelector(`[data-view="${viewName}"]`);
        if (navBtn) this.setActiveNav(navBtn);
    },

    /**
     * Render playlists page (full view with cards)
     */
    renderPlaylistsPage() {
        const grid = document.getElementById('playlistsGrid');
        if (!grid) return;

        const playlists = PlaylistManager.playlists || {};
        const keys = Object.keys(playlists);

        if (keys.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full text-center py-12 text-gray-400">
                    <svg class="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                    </svg>
                    <p class="text-lg">No playlists yet</p>
                    <p class="text-sm mt-1">Create one to get started!</p>
                </div>`;
            return;
        }

        grid.innerHTML = keys.map(name => {
            const tracks = playlists[name] || [];
            const count = tracks.length;
            const coverImg = count > 0 && tracks[0].cover
                ? `<img src="${tracks[0].cover}" alt="" class="w-full h-full object-cover">`
                : `<div class="w-full h-full flex items-center justify-center bg-dark-100">
                       <svg class="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                       </svg>
                   </div>`;

            return `
                <div class="bg-dark-200 rounded-xl overflow-hidden cursor-pointer hover:bg-dark-100 transition-colors playlist-card" data-playlist="${name}">
                    <div class="aspect-square relative">
                        ${coverImg}
                        <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                        <span class="absolute bottom-2 left-3 text-xs text-gray-300">${count} track${count !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="p-3">
                        <h4 class="font-semibold truncate">${name}</h4>
                    </div>
                </div>`;
        }).join('');

        // Click handler for cards
        grid.querySelectorAll('.playlist-card').forEach(card => {
            card.addEventListener('click', () => {
                const name = card.dataset.playlist;
                PlaylistManager.viewPlaylist(name);
            });
        });

        // Wire up create button on playlists page
        const createBtn2 = document.getElementById('createPlaylistBtn2');
        createBtn2?.addEventListener('click', () => {
            document.getElementById('createPlaylistModal')?.classList.remove('hidden');
        });
    },

    /**
     * Show loading state for a view
     */
    showLoading(viewName) {
        const container = document.getElementById(`${viewName === 'home' ? 'trending' : viewName}Tracks`) ||
                         document.getElementById(`${viewName}Content`) ||
                         document.getElementById(`${viewName}Results`);
        
        if (container) {
            container.innerHTML = Array(4).fill('').map(() => `
                <div class="skeleton-card animate-pulse bg-dark-100 rounded-xl h-20"></div>
            `).join('');
        }
    },


    /**
     * Render genre detail results into genreView
     */
    renderGenreResults(tracks, genreName, hasMore = false) {
        this._tracksByView.genre = tracks;
        const container = document.getElementById('genreContent');
        if (!container) return;

        if (tracks.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12 text-gray-400">
                    <p class="text-lg">No tracks found for ${genreName}</p>
                </div>`;
            return;
        }

        const trackRows = tracks.map((track, index) => this.renderTrackRow(track, index)).join('');
        const loadMoreBtn = hasMore ? `
            <div id="loadMoreContainer" class="text-center py-6">
                <button id="loadMoreGenreBtn" class="px-6 py-3 bg-dark-100 hover:bg-primary/20 text-gray-300 hover:text-white rounded-full transition-all duration-200 font-medium border border-dark-100 hover:border-primary/40">
                    <span id="loadMoreText">Load More</span>
                    <span id="loadMoreSpinner" class="hidden">
                        <svg class="animate-spin inline w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                    </span>
                </button>
            </div>` : '';

        container.innerHTML = `<div id="genreTracksList">${trackRows}</div>${loadMoreBtn}`;
        this.attachTrackListeners(container);

        // Load More button handler
        document.getElementById('loadMoreGenreBtn')?.addEventListener('click', () => {
            Search.loadMoreGenre();
        });

        // Back button handler
        const backBtn = document.getElementById('genreBackBtn');
        backBtn?.addEventListener('click', () => {
            this.showView('home');
        });
    },

    /**
     * Append more tracks to genre view (for Load More)
     */
    appendGenreTracks(newTracks, startIndex, hasMore) {
        // Update rendered tracks to include all loaded tracks
        this._tracksByView.genre = Search._genreState.allTracks;
        const tracksList = document.getElementById('genreTracksList');
        if (!tracksList || newTracks.length === 0) return;

        const newRows = newTracks.map((track, i) => this.renderTrackRow(track, startIndex + i)).join('');
        tracksList.insertAdjacentHTML('beforeend', newRows);
        this.attachTrackListeners(tracksList);

        // Update or hide Load More button
        if (!hasMore) {
            this.hideLoadMoreButton();
        }
    },

    /**
     * Show/hide loading state on Load More button
     */
    showLoadMoreLoading(loading) {
        const text = document.getElementById('loadMoreText');
        const spinner = document.getElementById('loadMoreSpinner');
        const btn = document.getElementById('loadMoreGenreBtn');
        if (text) text.textContent = loading ? 'Loading...' : 'Load More';
        if (spinner) spinner.classList.toggle('hidden', !loading);
        if (btn) btn.disabled = loading;
    },

    /**
     * Hide Load More button (no more tracks)
     */
    hideLoadMoreButton() {
        const container = document.getElementById('loadMoreContainer');
        if (container) {
            container.innerHTML = '<p class="text-gray-500 text-sm py-4">All tracks loaded</p>';
        }
    },

    /**
     * Render genres grid
     */
    renderGenres(genres) {
        const container = document.getElementById('genreList');
        if (!container) return;

        const genreColors = [
            'from-purple-600 to-pink-600',
            'from-blue-600 to-cyan-600',
            'from-green-600 to-teal-600',
            'from-orange-600 to-red-600',
            'from-indigo-600 to-purple-600',
            'from-yellow-600 to-orange-600',
            'from-pink-600 to-rose-600',
            'from-cyan-600 to-blue-600'
        ];

        container.innerHTML = genres.map((genre, index) => {
            const color = genreColors[index % genreColors.length];
            const name = typeof genre === 'object' ? genre.name : genre;
            const data = typeof genre === 'object' ? JSON.stringify(genre).replace(/"/g, '&quot;') : genre;
            return `
                <div 
                    class="genre-card bg-gradient-to-br ${color} cursor-pointer"
                    data-genre='${JSON.stringify(genre)}'
                    onclick="Search.searchByGenre(JSON.parse(this.dataset.genre))"
                >
                    <span class="font-semibold text-white">${name}</span>
                </div>
            `;
        }).join('');
    },



    /**
     * Render track card (grid style)
     */
    renderTrackCard(track, index) {
        const quality = MusicAPI.getQualityLabel(track.bitrate);
        const isPlaying = Player.currentTrack?.id === track.id;

        return `
            <div class="track-card bg-dark-200 rounded-xl p-4 cursor-pointer ${isPlaying ? 'playing' : ''}" data-track-index="${index}">
                <div class="relative mb-3">
                    <img 
                        src="${track.cover}" 
                        alt="${track.title}" 
                        class="w-full aspect-square object-cover rounded-lg"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%234a5568%22><path d=%22M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z%22/></svg>'"
                    >
                    <div class="absolute inset-0 bg-black/40 rounded-lg opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button class="play-btn w-12 h-12 bg-primary rounded-full flex items-center justify-center hover:scale-110 transition-transform">
                            <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                        </button>
                    </div>
                    ${isPlaying ? `
                        <div class="absolute bottom-2 right-2 playing-indicator">
                            <span></span><span></span><span></span><span></span>
                        </div>
                    ` : ''}
                </div>
                <h4 class="font-medium text-sm truncate">${this.escapeHtml(track.title)}</h4>
                <p class="text-xs text-gray-400 truncate">${this.escapeHtml(track.artist)}</p>
                <div class="flex items-center gap-2 mt-2">
                    <span class="quality-badge ${quality.class}">${quality.label}</span>
                    <span class="source-badge ${track.source}">${MusicAPI.getSourceLabel(track.source)}</span>
                </div>
            </div>
        `;
    },

    /**
     * Render track row (list style)
     */
    renderTrackRow(track, index, showRemove = false, playlistId = null) {
        const quality = MusicAPI.getQualityLabel(track.bitrate);
        const isPlaying = Player.currentTrack?.id === track.id;
        const duration = Player.formatTime(track.duration);

        return `
            <div class="track-card flex items-center gap-4 p-3 rounded-lg cursor-pointer ${isPlaying ? 'playing' : ''}" data-track-index="${index}">
                ${showRemove ? `
                    <div class="drag-handle shrink-0 p-1" title="Drag to reorder">
                        <svg class="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
                            <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                            <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
                        </svg>
                    </div>
                ` : ''}
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
                    <p class="font-medium text-sm truncate">${this.escapeHtml(track.title)}</p>
                    <p class="text-xs text-gray-400 truncate">${this.escapeHtml(track.artist)}</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="quality-badge ${quality.class}">${quality.label}</span>
                    <span class="source-badge ${track.source} text-xs">${MusicAPI.getSourceLabel(track.source)}</span>
                    <span class="text-xs text-gray-400 w-12 text-right">${duration}</span>
                    <div class="flex items-center gap-1">
                        <button class="like-track-btn p-2 ${typeof LikedSongs !== 'undefined' && LikedSongs.isLiked(track.id) ? 'text-primary' : 'text-gray-400'} hover:text-primary transition-colors" data-track-id="${track.id}" title="Like">
                            <svg class="w-4 h-4 like-icon-outline ${typeof LikedSongs !== 'undefined' && LikedSongs.isLiked(track.id) ? 'hidden' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
                            </svg>
                            <svg class="w-4 h-4 like-icon-filled ${typeof LikedSongs !== 'undefined' && LikedSongs.isLiked(track.id) ? '' : 'hidden'}" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                            </svg>
                        </button>
                        <button class="add-queue-btn p-2 text-gray-400 hover:text-white transition-colors" title="Add to queue">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                            </svg>
                        </button>

                        <button class="add-playlist-btn p-2 text-gray-400 hover:text-white transition-colors" title="Add to playlist">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                            </svg>
                        </button>

                        ${showRemove ? `
                            <button class="remove-btn p-2 text-gray-400 hover:text-red-400 transition-colors" data-playlist-id="${playlistId}" data-track-index="${index}" title="Remove from playlist">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                </svg>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Attach event listeners to track elements
     */
    attachTrackListeners(container) {
        const tracks = this.getCurrentTracks();

        // Play buttons (on cards)
        container.querySelectorAll('.play-btn').forEach((btn, index) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = btn.closest('.track-card');
                const trackIndex = parseInt(card.dataset.trackIndex);
                if (tracks[trackIndex]) {
                    Player.addMultipleToQueue(tracks.slice(trackIndex));
                    Player.playFromQueue(0);
                }
            });
        });

        // Track click (play on row click)
        container.querySelectorAll('.track-card').forEach((card) => {
            card.addEventListener('click', (e) => {
                // Don't play if clicking on buttons
                if (e.target.closest('button')) return;
                
                const trackIndex = parseInt(card.dataset.trackIndex);
                if (tracks[trackIndex]) {
                    // Add all tracks from current view to queue and play selected
                    Player.clearQueue();
                    Player.addMultipleToQueue(tracks);
                    Player.playFromQueue(trackIndex);
                }
            });
        });

        // Add to queue buttons
        container.querySelectorAll('.add-queue-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = btn.closest('.track-card');
                const trackIndex = parseInt(card.dataset.trackIndex);
                if (tracks[trackIndex]) {
                    Player.addToQueue(tracks[trackIndex]);
                }
            });
        });

        // Add to playlist buttons
        container.querySelectorAll('.add-playlist-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = btn.closest('.track-card');
                const trackIndex = parseInt(card.dataset.trackIndex);
                if (tracks[trackIndex]) {
                    PlaylistManager.showAddToPlaylistModal(tracks[trackIndex]);
                }
            });
        });

        // Remove buttons
        container.querySelectorAll('.remove-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const playlistId = btn.dataset.playlistId;
                const trackIndex = parseInt(btn.dataset.trackIndex);
                if (playlistId) {
                    PlaylistManager.removeTrackFromPlaylist(playlistId, trackIndex);
                }
            });
        });

        // Like buttons
        container.querySelectorAll('.like-track-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = btn.closest('.track-card');
                const trackIndex = parseInt(card.dataset.trackIndex);
                if (tracks[trackIndex]) {
                    LikedSongs.toggleLike(tracks[trackIndex]);
                }
            });
        });



    },

    /**
     * Get current tracks based on view
     */
    getCurrentTracks() {
        switch (this.currentView) {
            case 'search':
                return this._tracksByView.search || [];
            case 'trending':
                return this._tracksByView.trending || [];
            case 'genre':
                return Search._genreState?.allTracks || this._tracksByView.genre || [];
            case 'history':
                return this._history || [];
            case 'browse':
                return this._tracksByView.browse || [];
            case 'queue':
                return Player.queue;
            case 'playlist':
                const playlist = PlaylistManager.playlists.find(p => p.id === PlaylistManager.currentPlaylistId);
                return playlist?.tracks || [];
            case 'liked':
                return typeof LikedSongs !== 'undefined' ? LikedSongs.songs : [];
            case 'home':
            default:
                return this._tracksByView.home || [];
        }
    },

    // Per-view track storage (prevents cross-view contamination)
    _tracksByView: {},

    /**
     * Override render methods to store tracks
     */
    renderSearchResults(tracks, query) {
        this._tracksByView.search = tracks;
        const container = document.getElementById('searchResults');
        if (!container) return;

        if (tracks.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12">
                    <svg class="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <p class="text-gray-400">No results found for "${query}"</p>
                    <p class="text-gray-500 text-sm mt-2">Try different keywords or uncheck HD filter</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <p class="text-sm text-gray-400 mb-4">Found ${tracks.length} results for "${query}"</p>
            ${tracks.map((track, index) => this.renderTrackRow(track, index)).join('')}
        `;
        this.attachTrackListeners(container);
    },

    renderTrending(tracks) {
        this._tracksByView.home = tracks;
        const container = document.getElementById('trendingTracks');
        if (!container) return;

        if (tracks.length === 0) {
            container.innerHTML = '<p class="text-gray-400 col-span-full">Loading trending tracks...</p>';
            return;
        }

        container.innerHTML = tracks.map((track, index) => this.renderTrackCard(track, index)).join('');
        this.attachTrackListeners(container);
    },

    renderTrendingFull(tracks) {
        this._tracksByView.trending = tracks;
        const container = document.getElementById('trendingContent');
        if (!container) return;

        if (tracks.length === 0) {
            container.innerHTML = '<p class="text-gray-400">No trending tracks available</p>';
            return;
        }

        container.innerHTML = tracks.map((track, index) => this.renderTrackRow(track, index)).join('');
        this.attachTrackListeners(container);
    },

    renderBrowseResults(tracks, genre) {
        this._tracksByView.browse = tracks;
        const container = document.getElementById('browseContent');
        if (!container) return;

        container.innerHTML = `
            <section>
                <h3 class="text-lg font-bold mb-3 capitalize">${genre} Tracks</h3>
                ${tracks.length === 0 
                    ? '<p class="text-gray-400">No tracks found for this genre</p>'
                    : tracks.map((track, index) => this.renderTrackRow(track, index)).join('')
                }
            </section>
        `;
        this.attachTrackListeners(container);
    },

    renderPlaylistContent(playlist) {
        this._tracksByView.playlist = playlist.tracks;
        const container = document.getElementById('playlistContent');
        if (!container) return;

        if (playlist.tracks.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12">
                    <svg class="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                    </svg>
                    <p class="text-gray-400">This playlist is empty</p>
                    <p class="text-gray-500 text-sm mt-2">Search for songs and add them to this playlist</p>
                </div>
            `;
            return;
        }

        container.innerHTML = playlist.tracks.map((track, index) => 
            this.renderTrackRow(track, index, true, playlist.id)
        ).join('');
        this.attachTrackListeners(container);
    },

    /**
     * Update queue UI
     */
    updateQueueUI() {
        const container = document.getElementById('queueContent');
        if (!container) return;

        this._tracksByView.queue = Player.queue;

        if (Player.queue.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12">
                    <svg class="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
                    </svg>
                    <p class="text-gray-400">Queue is empty</p>
                    <p class="text-gray-500 text-sm mt-2">Add tracks from search or playlists</p>
                </div>
            `;
            return;
        }

        container.innerHTML = Player.queue.map((track, index) => `
            <div class="flex items-center gap-4 p-3 rounded-lg ${index === Player.currentIndex ? 'bg-dark-100 border border-primary/30' : 'hover:bg-dark-100'} transition-colors">
                <div class="w-8 text-center text-sm text-gray-400">
                    ${index === Player.currentIndex && Player.isPlaying ? `
                        <div class="playing-indicator mx-auto">
                            <span></span><span></span><span></span>
                        </div>
                    ` : index + 1}
                </div>
                <img src="${track.cover}" alt="" class="w-10 h-10 rounded object-cover" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%234a5568%22><path d=%22M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z%22/></svg>'">
                <div class="flex-1 min-w-0 cursor-pointer" onclick="Player.playFromQueue(${index})">
                    <p class="text-sm truncate">${this.escapeHtml(track.title)}</p>
                    <p class="text-xs text-gray-400 truncate">${this.escapeHtml(track.artist)}</p>
                </div>
                <span class="text-xs text-gray-400">${Player.formatTime(track.duration)}</span>
                <button class="p-2 text-gray-400 hover:text-red-400 transition-colors" onclick="Player.removeFromQueue(${index})">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `).join('');
    },

    // ========================================
    // HISTORY MANAGEMENT
    // ========================================

    _history: [],
    _maxHistory: 100,

    /**
     * Load history from localStorage
     */
    loadHistory() {
        try {
            this._history = JSON.parse(localStorage.getItem('playHistory')) || [];
        } catch {
            this._history = [];
        }
    },

    /**
     * Add a track to play history
     */
    addToHistory(track) {
        if (!track || !track.title) return;

        // Remove duplicate if exists
        this._history = this._history.filter(t => 
            !(t.title === track.title && t.artist === track.artist)
        );

        // Add to beginning with timestamp
        this._history.unshift({
            ...track,
            playedAt: Date.now()
        });

        // Limit size
        this._history = this._history.slice(0, this._maxHistory);

        // Save
        localStorage.setItem('playHistory', JSON.stringify(this._history));
    },

    /**
     * Clear play history
     */
    clearHistory() {
        this._history = [];
        localStorage.removeItem('playHistory');
        this.renderHistoryView();
        this.showToast('History cleared', 'success');
    },

    /**
     * Render history view
     */
    renderHistoryView() {
        const container = document.getElementById('historyContent');
        if (!container) return;

        this.loadHistory();
        this._tracksByView.history = this._history;

        if (this._history.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12 text-gray-400">
                    <svg class="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <p class="text-lg">No listening history yet</p>
                    <p class="text-sm mt-1">Play some music to see your history here</p>
                </div>`;
            return;
        }

        container.innerHTML = this._history.map((track, index) => {
            const timeAgo = this._getTimeAgo(track.playedAt);
            return `
                <div class="track-card flex items-center gap-4 p-3 rounded-lg hover:bg-dark-100 transition-colors cursor-pointer" data-track-index="${index}">
                    <div class="w-8 text-center text-sm text-gray-500">${index + 1}</div>
                    <img src="${track.cover || ''}" alt="" class="w-10 h-10 rounded object-cover" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%234a5568%22><path d=%22M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z%22/></svg>'">
                    <div class="flex-1 min-w-0">
                        <p class="text-sm truncate">${this.escapeHtml(track.title)}</p>
                        <p class="text-xs text-gray-400 truncate">${this.escapeHtml(track.artist)}</p>
                    </div>
                    <span class="text-xs text-gray-500 hidden sm:inline">${timeAgo}</span>
                    <span class="text-xs text-gray-400">${Player.formatTime(track.duration)}</span>
                </div>
            `;
        }).join('');

        this.attachTrackListeners(container);

        // Clear history button
        document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
            this.clearHistory();
        });
    },

    /**
     * Format time ago string
     */
    _getTimeAgo(timestamp) {
        if (!timestamp) return '';
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
        return new Date(timestamp).toLocaleDateString();
    },

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const colors = {
            success: 'bg-green-600',
            error: 'bg-red-600',
            warning: 'bg-yellow-600',
            info: 'bg-blue-600'
        };

        const icons = {
            success: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>',
            error: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>',
            warning: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>',
            info: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${colors[type]} px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-sm`;
        toast.innerHTML = `
            <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                ${icons[type]}
            </svg>
            <p class="text-sm">${this.escapeHtml(message)}</p>
        `;

        container.appendChild(toast);

        // Auto remove after 3 seconds
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
