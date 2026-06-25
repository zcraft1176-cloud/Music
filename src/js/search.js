/**
 * Search & Browse Module
 * Handles search functionality, browse by genre, and trending
 */

const Search = {
    // Debounce timer
    debounceTimer: null,
    debounceDelay: 400,

    // AbortController for cancelling in-flight searches
    _searchAbortController: null,

    // Search history
    history: [],
    maxHistory: 20,

    /**
     * Initialize search module
     */
    init() {
        this.loadHistory();
        this.setupListeners();
    },

    /**
     * Setup event listeners
     */
    setupListeners() {
        const searchInput = document.getElementById('searchInput');

        // Search input with debounce
        searchInput?.addEventListener('input', (e) => {
            clearTimeout(this.debounceTimer);
            const query = e.target.value.trim();
            
            if (query.length >= 2) {
                this.debounceTimer = setTimeout(() => {
                    this.performSearch(query);
                }, this.debounceDelay);
            } else if (query.length === 0) {
                // Cancel any in-flight search
                if (this._searchAbortController) {
                    this._searchAbortController.abort();
                    this._searchAbortController = null;
                }
                UI.showView('home');
            }
        });

        // Enter key search
        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(this.debounceTimer);
                const query = e.target.value.trim();
                if (query.length >= 2) {
                    this.performSearch(query);
                }
            }
        });


    },

    /**
     * Perform search across all APIs
     */
    async performSearch(query) {
        // Cancel previous in-flight search
        if (this._searchAbortController) {
            this._searchAbortController.abort();
        }
        this._searchAbortController = new AbortController();
        const currentController = this._searchAbortController;

        UI.showLoading('search');
        UI.showView('search');

        try {
            const results = await MusicAPI.search(query, { 
                limit: 30,
                signal: currentController.signal
            });

            // If this search was cancelled by a newer one, don't update UI
            if (currentController.signal.aborted) return;

            this.addToHistory(query);
            UI.renderSearchResults(results, query);
        } catch (error) {
            if (currentController.signal.aborted) return;
            console.error('Search error:', error);
            UI.showToast('Search failed. Please try again.', 'error');
            UI.renderSearchResults([], query);
        }
    },

    /**
     * Search by genre
     */
    // Genre pagination state
    _genreState: {
        genre: null,
        offset: 0,
        batchSize: 30,
        allTracks: [],
        hasMore: true,
        loading: false
    },

    async searchByGenre(genre) {
        const genreName = typeof genre === 'object' ? genre.name : genre;
        UI.showView('genre');

        // Reset pagination state
        this._genreState = {
            genre: genre,
            offset: 0,
            batchSize: 30,
            allTracks: [],
            hasMore: true,
            loading: false
        };

        // Show loading in genre content
        const genreContent = document.getElementById('genreContent');
        if (genreContent) {
            genreContent.innerHTML = '<div class="flex justify-center py-12"><div class="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full"></div></div>';
        }
        document.getElementById('genreTitle').textContent = genreName;
        document.getElementById('genreTrackCount').textContent = 'Loading...';

        try {
            const results = await MusicAPI.getByGenre(genre, { 
                limit: this._genreState.batchSize,
                offset: 0
            });

            this._genreState.allTracks = results;
            this._genreState.offset = results.length;
            this._genreState.hasMore = results.length >= this._genreState.batchSize;

            document.getElementById('genreTrackCount').textContent = `${results.length} tracks`;
            UI.renderGenreResults(results, genreName, this._genreState.hasMore);
        } catch (error) {
            console.error('Genre search error:', error);
            UI.showToast('Failed to load genre. Please try again.', 'error');
        }
    },

    /**
     * Load more tracks for current genre
     */
    async loadMoreGenre() {
        const state = this._genreState;
        if (state.loading || !state.hasMore || !state.genre) return;

        state.loading = true;
        UI.showLoadMoreLoading(true);

        try {
            const moreTracks = await MusicAPI.getByGenre(state.genre, {
                limit: state.batchSize,
                offset: state.offset
            });

            if (moreTracks.length === 0) {
                state.hasMore = false;
                UI.showLoadMoreLoading(false);
                UI.hideLoadMoreButton();
                return;
            }

            // Filter out duplicates
            const existingIds = new Set(state.allTracks.map(t => t.id));
            const newTracks = moreTracks.filter(t => !existingIds.has(t.id));

            state.allTracks.push(...newTracks);
            state.offset += moreTracks.length;
            state.hasMore = moreTracks.length >= state.batchSize;

            document.getElementById('genreTrackCount').textContent = `${state.allTracks.length} tracks`;
            UI.appendGenreTracks(newTracks, state.allTracks.length - newTracks.length, state.hasMore);
        } catch (error) {
            console.error('Load more genre error:', error);
            UI.showToast('Failed to load more tracks', 'error');
        } finally {
            state.loading = false;
            UI.showLoadMoreLoading(false);
        }
    },

    /**
     * Load trending tracks
     */
    async loadTrending() {
        UI.showLoading('home');

        try {
            const tracks = await MusicAPI.getTrending({ 
                limit: 8 
            });

            UI.renderTrending(tracks);
        } catch (error) {
            console.error('Trending load error:', error);
        }
    },

    /**
     * Load all trending for trending view
     */
    async loadAllTrending() {
        UI.showLoading('trending');
        UI.showView('trending');

        try {
            const tracks = await MusicAPI.getTrending({ 
                limit: 50 
            });

            UI.renderTrendingFull(tracks);
        } catch (error) {
            console.error('Trending load error:', error);
            UI.showToast('Failed to load trending tracks', 'error');
        }
    },

    /**
     * Load genres
     */
    async loadGenres() {
        try {
            const genres = await MusicAPI.getGenres();
            UI.renderGenres(genres);
        } catch (error) {
            console.error('Genres load error:', error);
        }
    },

    /**
     * Add query to search history
     */
    addToHistory(query) {
        // Remove if already exists
        this.history = this.history.filter(q => q.toLowerCase() !== query.toLowerCase());
        
        // Add to beginning
        this.history.unshift(query);
        
        // Limit history size
        this.history = this.history.slice(0, this.maxHistory);
        
        this.saveHistory();
    },

    /**
     * Clear search history
     */
    clearHistory() {
        this.history = [];
        this.saveHistory();
    },

    /**
     * Save history to localStorage
     */
    saveHistory() {
        localStorage.setItem('searchHistory', JSON.stringify(this.history));
    },

    /**
     * Load history from localStorage
     */
    loadHistory() {
        try {
            this.history = JSON.parse(localStorage.getItem('searchHistory')) || [];
        } catch (error) {
            this.history = [];
        }
    }
};
