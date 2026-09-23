/**
 * Self-check for UI.getCurrentTracks() per-view isolation.
 * Run: node tests/ui-view-tracks.test.js
 *
 * Guards the bug where all views shared one _renderedTracks variable,
 * so clicking a track in view A after rendering view B played a track from B.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal stubs so ui.js can be evaluated in a sandbox.
const sandbox = {
    console,
    Player: { queue: [], currentTrack: null, formatTime: () => '0:00' },
    PlaylistManager: { playlists: [], currentPlaylistId: null },
    Search: { _genreState: { allTracks: [] } },
    MusicAPI: { getQualityLabel: () => ({ label: 'STD', class: 'std' }), getSourceLabel: s => s },
    LikedSongs: { isLiked: () => false },
    document: {
        getElementById: () => null,
        querySelectorAll: () => [],
        querySelector: () => null,
        // escapeHtml() does div.textContent = t; return div.innerHTML — emulate it
        createElement: () => {
            let t = '';
            return {
                set textContent(v) { t = String(v); },
                get innerHTML() {
                    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                },
            };
        },
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
sandbox.window = sandbox;

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ui.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(src + '\n;this.UI = UI;', sandbox);
const UI = sandbox.UI;

// Music calls this map `_tracksByView`, Music2 calls it `_viewTracks` — the two
// folders diverged on the name. Resolve whichever exists so this file checks
// the invariant (per-view isolation) rather than a spelling.
const VIEWS = UI._viewTracks || UI._tracksByView;
assert(VIEWS, 'UI must keep one track map per view (_tracksByView / _viewTracks)');

// --- assertions -------------------------------------------------------------
const A = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
const B = [{ id: 'b1' }, { id: 'b2' }];

UI.currentView = 'search';
VIEWS.search = A;
UI.currentView = 'trending';
VIEWS.trending = B;

UI.currentView = 'search';
assert(UI.getCurrentTracks()[0].id === 'a1', 'search view must return its own tracks');

UI.currentView = 'trending';
assert(UI.getCurrentTracks()[0].id === 'b1', 'trending view must return its own tracks');

UI.currentView = 'home';
assert(UI.getCurrentTracks().length === 0, 'unrendered view must be empty, not another view\'s data');

UI.currentView = 'queue';
// Music has no 'queue' case: its queue UI was dropped and the array is not a
// browse target there, so this only holds on Music2. Skip it rather than report
// a failure for a view the app does not expose.
if (VIEWS.queue) {
    sandbox.Player.queue = B;
    assert(UI.getCurrentTracks() === B, 'queue view must read Player.queue');
}

// liked view reads LikedSongs, never the home list.
// Regression: this arm was missing on Music2, so the Liked page silently
// returned the home list and played whatever was on the home page.
const LIKED = [{ id: 'liked1' }, { id: 'liked2' }];
sandbox.LikedSongs.songs = LIKED;
VIEWS.home = A;
UI.currentView = 'liked';
assert(UI.getCurrentTracks() === LIKED, 'liked view must read LikedSongs.songs, not the home list');

// playlist view reads the live playlist, not a copy
sandbox.PlaylistManager.playlists = [{ id: 'p1', tracks: A }];
sandbox.PlaylistManager.currentPlaylistId = 'p1';
UI.currentView = 'playlist';
assert(UI.getCurrentTracks() === A, 'playlist view must read the live playlist array');

// genre prefers the paginated state
sandbox.Search._genreState.allTracks = B;
UI.currentView = 'genre';
assert(UI.getCurrentTracks() === B, 'genre view must prefer Search._genreState.allTracks');

// --- renderPlaylistsPage: array-of-objects, click passes the real playlist id ---
// Regression: it used Object.keys(playlists), so card.dataset.playlist was the
// array INDEX and viewPlaylist("0") matched no playlist -> cards were dead.
function fakeEl() {
    return { innerHTML: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
             addEventListener() {}, querySelectorAll: () => [], querySelector: () => null };
}
const grid = fakeEl();
const cards = [];
sandbox.document.getElementById = id => (id === 'playlistsGrid' ? grid : null);
sandbox.document.querySelectorAll = () => [];
// capture the cards the renderer emits by intercepting the grid's innerHTML
let lastHTML = '';
Object.defineProperty(grid, 'innerHTML', { set(v) { lastHTML = v; }, get() { return lastHTML; } });

sandbox.PlaylistManager.playlists = [{ id: 'playlist_111', name: 'Chill', tracks: A }];
UI.renderPlaylistsPage();
assert(lastHTML.includes('data-playlist-id="playlist_111"'),
       'playlist card must carry the playlist id, not an array index');
assert(!lastHTML.includes('data-playlist="0"'), 'must not emit a bare numeric index');
assert(lastHTML.includes('Chill'), 'playlist name must render');

function assert(cond, msg) {
    if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
    else console.log('ok - ' + msg);
}

if (!process.exitCode) console.log('\nAll view-isolation checks passed.');
