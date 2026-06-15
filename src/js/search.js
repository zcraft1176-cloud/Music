/**
 * Search & Browse Module
 * Handles search functionality, browse by genre, and trending
 */

const Search = {
    // Debounce timer
    debounceTimer: null,
    debounceDelay: 400,

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
        UI.showLoading('search');
        UI.showView('search');

        try {
            const results = await MusicAPI.search(query, { 
                limit: 30 
            });

            this.addToHistory(query);
            UI.renderSearchResults(results, query);
        } catch (error) {
            console.error('Search error:', error);
            UI.showToast('Search failed. Please try again.', 'error');
            UI.renderSearchResults([], query);
        }
    },

    /**
     * Search by genre
     */
    async searchByGenre(genre) {
        const genreName = typeof genre === 'object' ? genre.name : genre;
        UI.showView('genre');

        // Show loading in genre content
        const genreContent = document.getElementById('genreContent');
        if (genreContent) {
            genreContent.innerHTML = '<div class="flex justify-center py-12"><div class="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full"></div></div>';
        }
        document.getElementById('genreTitle').textContent = genreName;
        document.getElementById('genreTrackCount').textContent = 'Loading...';

        try {
            const results = await MusicAPI.getByGenre(genre, { 
                limit: 50 
            });

            document.getElementById('genreTrackCount').textContent = `${results.length} tracks`;
            UI.renderGenreResults(results, genreName);
        } catch (error) {
            console.error('Genre search error:', error);
            UI.showToast('Failed to load genre. Please try again.', 'error');
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
