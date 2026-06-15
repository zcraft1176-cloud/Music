/**
 * Main App Controller
 * Initializes all modules and wires them together
 */

const App = {
    /**
     * Initialize the application
     */
    async init() {
        console.log('Music Stream App initializing...');

        try {
            // Initialize modules in order
            await Auth.init();
            UI.init();
            Player.init();
            PlaylistManager.init();
            Search.init();

            // Load initial content
            await this.loadInitialContent();

            // Setup global event listeners
            this.setupGlobalListeners();

            console.log('Music Stream App ready!');
            UI.showToast('Welcome to Music Stream!', 'success');
        } catch (error) {
            console.error('App initialization error:', error);
            UI.showToast('Failed to initialize app. Please refresh.', 'error');
        }
    },

    /**
     * Load initial content (trending tracks, genres)
     */
    async loadInitialContent() {
        // Load trending tracks
        Search.loadTrending();
        
        // Load genres
        Search.loadGenres();
    },

    /**
     * Setup global event listeners
     */
    setupGlobalListeners() {
        // Mobile: sidebar toggle + overlay
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        const mobileMenuBtnBottom = document.getElementById('mobileMenuBtnBottom');
        const sidebar = document.getElementById('sidebar');
        const sidebarOverlay = document.getElementById('sidebarOverlay');

        const openSidebar = () => {
            sidebar?.classList.add('open');
            sidebarOverlay?.classList.add('active');
        };
        const closeSidebar = () => {
            sidebar?.classList.remove('open');
            sidebarOverlay?.classList.remove('active');
        };

        mobileMenuBtn?.addEventListener('click', openSidebar);
        mobileMenuBtnBottom?.addEventListener('click', openSidebar);
        sidebarOverlay?.addEventListener('click', closeSidebar);

        // Close sidebar when a nav button inside sidebar is clicked (mobile)
        sidebar?.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.innerWidth < 768) closeSidebar();
            });
        });

        // Mobile bottom nav: view switching
        document.querySelectorAll('.mobile-nav-btn[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                if (view) {
                    // Full view switching logic (mirrors sidebar nav handler in ui.js)
                    if (view === 'trending') {
                        Search.loadAllTrending();
                    } else if (view === 'home') {
                        UI.showView('home');
                    } else if (view === 'search') {
                        UI.showView('search');
                        document.getElementById('searchInput')?.focus();
                    } else if (view === 'queue') {
                        UI.showView('queue');
                        UI.updateQueueUI();
                    } else if (view === 'browse') {
                        UI.showView('home');
                    } else if (view === 'playlists') {
                        UI.showView('playlists');
                        UI.renderPlaylistsPage();
                    } else if (view === 'settings') {
                        UI.showView('settings');
                        App.loadSettings();
                    }
                    // Update active state on bottom nav
                    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    // Also sync sidebar nav
                    document.querySelectorAll('#sidebar .nav-btn').forEach(b => {
                        b.classList.toggle('active', b.dataset.view === view);
                    });
                }
            });
        });

        // Sync bottom nav when sidebar nav is clicked
        sidebar?.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                document.querySelectorAll('.mobile-nav-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.view === view);
                });
            });
        });

        // Close modals on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.getElementById('createPlaylistModal')?.classList.add('hidden');
                document.getElementById('addToPlaylistModal')?.classList.add('hidden');
            }
        });

        // Close modals on backdrop click
        document.getElementById('createPlaylistModal')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                e.currentTarget.classList.add('hidden');
            }
        });

        document.getElementById('addToPlaylistModal')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                e.currentTarget.classList.add('hidden');
            }
        });

        // Settings: Save Jamendo API key
        const saveJamendoKeyBtn = document.getElementById('saveJamendoKeyBtn');
        saveJamendoKeyBtn?.addEventListener('click', () => {
            const input = document.getElementById('jamendoKeyInput');
            const status = document.getElementById('jamendoStatus');
            const key = input?.value.trim();
            
            if (key) {
                MusicAPI.setJamendoClientId(key);
                if (status) {
                    status.textContent = '✓ Jamendo API key saved. Higher quality tracks will now appear in search results.';
                    status.className = 'text-sm mt-2 text-green-400';
                }
                UI.showToast('Jamendo API key saved!', 'success');
            } else {
                MusicAPI.setJamendoClientId('');
                if (status) {
                    status.textContent = 'Jamendo API key removed. Using Internet Archive only.';
                    status.className = 'text-sm mt-2 text-gray-500';
                }
                UI.showToast('Jamendo API key removed', 'info');
            }
        });

        // Handle visibility change (pause visualizer when tab is hidden)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (Player.visualizerAnimationId) {
                    cancelAnimationFrame(Player.visualizerAnimationId);
                }
            } else {
                if (Player.analyser) {
                    Player.drawVisualizer();
                }
            }
        });

        // Media session API for OS-level media controls
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => Player.togglePlayPause());
            navigator.mediaSession.setActionHandler('pause', () => Player.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => Player.prev());
            navigator.mediaSession.setActionHandler('nexttrack', () => Player.next());
        }

        // Update media session when track changes
        Player.audio.addEventListener('play', () => {
            if (Player.currentTrack && 'mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: Player.currentTrack.title,
                    artist: Player.currentTrack.artist,
                    album: Player.currentTrack.album,
                    artwork: [
                        { src: Player.currentTrack.cover, sizes: '96x96', type: 'image/jpeg' },
                        { src: Player.currentTrack.cover, sizes: '128x128', type: 'image/jpeg' },
                        { src: Player.currentTrack.cover, sizes: '192x192', type: 'image/jpeg' },
                        { src: Player.currentTrack.cover, sizes: '256x256', type: 'image/jpeg' },
                        { src: Player.currentTrack.cover, sizes: '384x384', type: 'image/jpeg' },
                        { src: Player.currentTrack.cover, sizes: '512x512', type: 'image/jpeg' }
                    ]
                });
            }
        });
    },

    /**
     * Load settings UI
     */
    loadSettings() {
        const input = document.getElementById('jamendoKeyInput');
        const status = document.getElementById('jamendoStatus');
        
        if (input) {
            input.value = MusicAPI.config.jamendo.clientId || '';
        }
        if (status) {
            if (MusicAPI.hasJamendo()) {
                status.textContent = '✓ Jamendo API key is configured.';
                status.className = 'text-sm mt-2 text-green-400';
            } else {
                status.textContent = 'No Jamendo API key set. Using Internet Archive only.';
                status.className = 'text-sm mt-2 text-gray-500';
            }
        }
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
