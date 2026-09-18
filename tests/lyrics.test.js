/**
 * Regression tests for the lyrics module in src/js/lyrics.js.
 *
 * Why these exist: the sync loop used to stop itself when the lyrics had not
 * arrived yet -- exactly the state right after the panel opens, because the
 * LRCLIB fetch is asynchronous. Nothing restarted it, so the words appeared but
 * never followed the song. Reported as "kadang macet".
 *
 * Run: node tests/lyrics.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'js', 'lyrics.js');
const code = fs.readFileSync(SRC, 'utf8');

const el = () => ({
  innerHTML: '', textContent: '', scrollTop: 0, clientHeight: 0,
  offsetTop: 0, offsetHeight: 0,
  classList: { add() {}, remove() {}, toggle() {} },
  querySelectorAll: () => [],
});

/**
 * Load lyrics.js in a sandbox. requestAnimationFrame is modelled with real
 * semantics -- a cancelled frame must not run again -- so the loop tests
 * actually prove something.
 */
function load(fetchImpl, sharedStorage) {
  let nextId = 1;
  const pending = new Map();
  let cancelled = 0;

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    fetch: fetchImpl || (async () => { throw new Error('network disabled'); }),
    URLSearchParams, AbortSignal, setTimeout, clearTimeout,
    localStorage: sharedStorage || {
      _d: {},
      getItem(k) { return this._d[k] ?? null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
    document: {
      createElement: el, getElementById: el, querySelector: el,
      querySelectorAll: () => [], addEventListener() {},
      body: { appendChild() {} },
    },
    navigator: {},
    performance: { now: () => Date.now() },
    requestAnimationFrame: cb => { const id = nextId++; pending.set(id, cb); return id; },
    cancelAnimationFrame: id => { if (pending.delete(id)) cancelled++; },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;globalThis.__L = Lyrics;', sandbox);

  return {
    L: sandbox.__L,
    /** Run the single scheduled frame, if any. */
    runFrame() {
      const entry = [...pending.entries()][0];
      if (!entry) return false;
      pending.delete(entry[0]);
      entry[1](performance.now());
      return true;
    },
    live: () => pending.size,
    cancelled: () => cancelled,
  };
}

let pass = 0, fails = 0;
const pendingTests = [];
const t = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pendingTests.push(r.then(() => { console.log(`  ok   ${name}`); pass++; },
        e => { console.log(`  FAIL ${name}\n       ${e.message}`); fails++; process.exitCode = 1; }));
      return;
    }
    console.log(`  ok   ${name}`); pass++;
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`); fails++; process.exitCode = 1;
  }
};

const { L } = load();
L._contentEl = el();
L._metaEl = el();

console.log('lookup cleanup');

t('_cleanTitle drops a "(feat. X)" credit', () => {
  assert.strictEqual(L._cleanTitle('Levitating (feat. DaBaby)'), 'Levitating');
});

t('_cleanTitle drops a bracketed credit', () => {
  assert.strictEqual(L._cleanTitle('Sunflower [feat. Swae Lee]'), 'Sunflower');
});

t('_cleanTitle drops a "- Radio Edit" suffix', () => {
  assert.strictEqual(L._cleanTitle('Shape of You - Radio Edit'), 'Shape of You');
});

t('_cleanTitle keeps a version the user actually clicked', () => {
  assert.strictEqual(L._cleanTitle('Not You (Chinese Version)'), 'Not You (Chinese Version)');
  assert.strictEqual(L._cleanTitle('Havana (Live)'), 'Havana (Live)');
});

t('_cleanArtist keeps only the lead credit', () => {
  assert.strictEqual(L._cleanArtist('Post Malone, Swae Lee'), 'Post Malone');
  assert.strictEqual(L._cleanArtist('Doja Cat, SZA'), 'Doja Cat');
  assert.strictEqual(L._cleanArtist('Alan Walker'), 'Alan Walker');
});

t('_trackKey separates same-title tracks by duration', () => {
  const a = L._trackKey({ title: 'Not You', artist: 'A', duration: 153 });
  const b = L._trackKey({ title: 'Not You', artist: 'A', duration: 154 });
  assert.notStrictEqual(a, b);
});

console.log('\nsync loop');

t('REGRESSION: the loop keeps running while the panel is open with no lyrics', () => {
  const s = load();
  s.L._contentEl = el();
  s.L._isOpen = true;
  s.L._syncedLines = [];
  s.L._startSyncLoop();

  assert.strictEqual(s.live(), 1, 'loop should schedule its first frame');
  s.runFrame();                                  // lyrics still absent
  assert.strictEqual(s.live(), 1, 'loop must schedule the next frame anyway');
  assert.ok(s.L._rafId, 'loop must stay alive so late lyrics still get highlighted');
});

t('the loop survives until the lyrics arrive, then highlights them', () => {
  const s = load();
  s.L._contentEl = el();
  s.L._isOpen = true;
  s.L._syncedLines = [];
  s.L._startSyncLoop();

  // three frames with no lyrics -- the old code died on the first
  for (let i = 0; i < 3; i++) s.runFrame();
  assert.strictEqual(s.live(), 1, 'loop died before the lyrics arrived');

  s.L._syncedLines = [{ time: 1, text: 'a' }, { time: 2, text: 'b' }];
  s.L._lineElements = [{ classList: { add() {}, remove() {} }, offsetTop: 0 }, { classList: { add() {}, remove() {} }, offsetTop: 0 }];
  s.L._contentEl.clientHeight = 100;
  s.L._contentEl.offsetTop = 0;
  s.L._getCurrentTime = () => 2.5;
  s.runFrame();
  assert.strictEqual(s.L._activeLine, 1, 'the arrived lyrics were never highlighted');
});

t('the loop stops once the panel closes', () => {
  const s = load();
  s.L._contentEl = el();
  s.L._isOpen = true;
  s.L._syncedLines = [];
  s.L._startSyncLoop();
  s.L._isOpen = false;
  s.runFrame();
  assert.strictEqual(s.live(), 0, 'no further frames after close');
  assert.strictEqual(s.L._rafId, null);
});

t('the loop does not double-schedule when restarted', () => {
  const s = load();
  s.L._isOpen = true;
  s.L._startSyncLoop();
  s.L._startSyncLoop();
  assert.strictEqual(s.live(), 1, '_startSyncLoop must cancel the previous loop');
  assert.ok(s.cancelled() >= 1);
});

console.log('\nfetch pipeline');

t('an instrumental entry does not shadow the lyrics found by search', async () => {
  const instrumental = { trackName: 'Kiss Me More', artistName: 'Doja Cat', duration: 208, instrumental: true, syncedLyrics: null, plainLyrics: null };
  const withWords = { trackName: 'Kiss Me More', artistName: 'Doja Cat', duration: 208, syncedLyrics: '[00:01.00]x\n[00:02.00]y', plainLyrics: null };
  const s = load(async url => {
    const body = String(url).includes('/api/search') ? [withWords] : instrumental;
    return { ok: true, json: async () => body };
  });
  s.L._contentEl = el();
  s.L._metaEl = el();
  await s.L.fetchForTrack({ title: 'Kiss Me More (feat. SZA)', artist: 'Doja Cat', album: 'Planet Her', duration: 208 });
  assert.strictEqual(s.L._syncedLines.length, 2, 'the words must win over the instrumental stub');
});

t('a genuinely instrumental track still reports instrumentally', async () => {
  const instrumental = { trackName: 'River Flows in You', artistName: 'Yiruma', duration: 190, instrumental: true, syncedLyrics: null, plainLyrics: null };
  const s = load(async () => ({ ok: true, json: async () => instrumental }));
  s.L._contentEl = el();
  s.L._metaEl = el();
  await s.L.fetchForTrack({ title: 'River Flows in You', artist: 'Yiruma', duration: 190 });
  assert.strictEqual(s.L._syncedLines.length, 0);
  assert.strictEqual(s.L._plainText, '');
  assert.ok(s.L._metaEl.innerHTML.includes('Instrumental'), 'badge should say Instrumental');
});

t('_fetchSearch prefers a synced entry over a plain one', async () => {
  const plain = { trackName: 'X', artistName: 'Y', duration: 100, syncedLyrics: null, plainLyrics: 'a\nb' };
  const synced = { trackName: 'X', artistName: 'Y', duration: 100, syncedLyrics: '[00:01.00]a', plainLyrics: null };
  const s = load(async () => ({ ok: true, json: async () => [plain, synced] }));
  const got = await s.L._fetchSearch('X', 'Y', 100);
  assert.strictEqual(got, synced);
});

t('_fetchSearch scores the artist, so a cover does not win', async () => {
  const cover = { trackName: 'X', artistName: 'Some Cover Band', duration: 100, syncedLyrics: '[00:01.00]c' };
  const real = { trackName: 'X', artistName: 'Y', duration: 100, syncedLyrics: '[00:01.00]r' };
  const s = load(async () => ({ ok: true, json: async () => [cover, real] }));
  const got = await s.L._fetchSearch('X', 'Y', 100);
  assert.strictEqual(got, real);
});

t('a stale fetch cannot overwrite a newer track', async () => {
  let release;
  const slow = new Promise(r => { release = r; });
  const s = load(async url => {
    if (String(url).includes('slow')) await slow;
    return { ok: true, json: async () => ({ trackName: 'Slow', artistName: 'A', syncedLyrics: '[00:01.00]OLD', plainLyrics: null }) };
  });
  s.L._contentEl = el();
  s.L._metaEl = el();
  const first = s.L.fetchForTrack({ title: 'slow', artist: 'A', duration: 100 });
  s.L.onTrackChange({ title: 'new', artist: 'B', duration: 100 });   // user skips
  release();
  await first;
  assert.strictEqual(s.L._syncedLines.length, 0, 'the abandoned fetch must not render');
});

console.log('\npersistent cache');

t('a fetched track survives a reload without another network call', async () => {
  let calls = 0;
  const body = {
    trackName: 'X', artistName: 'Y', duration: 100, albumName: 'Alb',
    syncedLyrics: '[00:01.00]a\n[00:02.00]b', plainLyrics: null
  };
  const res = { ok: true, json: async () => body };
  const store = {};
  const ls = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };

  const session = load(async () => { calls++; return res; }, ls);
  session.L._contentEl = el();
  session.L._metaEl = el();

  const track = { title: 'X', artist: 'Y', album: 'Alb', duration: 100 };
  await session.L.fetchForTrack(track);
  assert.strictEqual(calls, 1, 'first play should hit the network once');
  assert.strictEqual(session.L._syncedLines.length, 2);
  assert.ok(Object.keys(store).length, 'nothing was persisted');

  // Simulate a reload: same storage, in-memory cache emptied.
  session.L._cache.clear();
  session.L._syncedLines = [];
  session.L._plainText = '';
  session.L._currentTrackKey = null;
  await session.L.fetchForTrack(track);
  assert.strictEqual(calls, 1, 'the reload must be served from storage, not the network');
  assert.strictEqual(session.L._syncedLines.length, 2);
  assert.ok(session.L._metaEl.innerHTML.includes('cached'), 'badge should mark the cached read');
});

console.log('\nformatting');

t('_formatDuration prints m:ss', () => {
  assert.strictEqual(L._formatDuration(154), '2:34');
  assert.strictEqual(L._formatDuration(59), '0:59');
  assert.strictEqual(L._formatDuration(0), '');
});

t('_esc neutralises markup in a title', () => {
  assert.strictEqual(L._esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

t('_parseSyncedLyrics sorts by time', () => {
  const lines = L._parseSyncedLyrics('[00:05.00]b\n[00:01.00]a\n[00:03.00]c');
  assert.deepStrictEqual(Array.from(lines, l => String(l.text)), ['a', 'c', 'b']);
});

Promise.all(pendingTests).then(() => {
  console.log(`\n${pass} checks passed${fails ? `, ${fails} FAILED` : ''}`);
  if (fails) process.exitCode = 1;
});
