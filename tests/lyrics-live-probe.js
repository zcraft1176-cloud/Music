/**
 * The web half of the same claim, against the LIVE LRCLIB — no mocks.
 *
 *   node tests/lyrics-live-probe.js
 *
 * Loads src/js/lyrics.js in a sandbox with real `fetch`, and asks it for the two
 * songs in the user's queue that the panel used to render without timings. Both
 * must come back with `_syncedLines`, because the timed copy of each recording
 * is sitting in the search response and used to lose the pick.
 *
 * The third case is the control: "Fallen Kingdom" by Gustixa has no timed copy
 * on LRCLIB at all, so it must still come back plain. A fix that adopted the
 * CaptainSparklez timings (251s vs 185s) would scroll the words out of step.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'lyrics.js'), 'utf8');

const el = () => ({
  innerHTML: '', textContent: '', scrollTop: 0, clientHeight: 0,
  offsetTop: 0, offsetHeight: 0,
  classList: { add() {}, remove() {}, toggle() {} },
  querySelectorAll: () => [],
});

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  fetch, // the real one
  URLSearchParams, AbortSignal, setTimeout, clearTimeout,
  localStorage: {
    _d: {}, getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
  },
  document: {
    createElement: el, getElementById: el, querySelector: el,
    querySelectorAll: () => [], addEventListener() {},
    body: { appendChild() {} },
  },
  navigator: {}, performance: { now: () => Date.now() },
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code + '\n;globalThis.__L = Lyrics;', sandbox);
const L = sandbox.__L;
L._contentEl = el();
L._metaEl = el();

const cases = [
  { title: 'Dragonhearted', artist: 'TryHardNinja', duration: 296, wantSynced: true },
  { title: 'Cloud Bread', artist: 'Gustixa', duration: 102, wantSynced: true },
  { title: 'Fallen Kingdom', artist: 'Gustixa', duration: 185, wantSynced: false },
];

(async () => {
  let fails = 0;
  for (const c of cases) {
    L._syncedLines = [];
    L._plainText = '';
    L._currentTrackKey = null;
    await L.fetchForTrack({ title: c.title, artist: c.artist, duration: c.duration });

    const lines = L._syncedLines.length;
    const ok = c.wantSynced ? lines > 0 : lines === 0;
    if (!ok) fails++;
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${c.title} — lines=${lines} ` +
      `plain=${L._plainText ? L._plainText.length + ' chars' : 'none'} ` +
      `(wantSynced=${c.wantSynced})`);
    if (lines) console.log(`       first line: "${String(L._syncedLines[0].text).slice(0, 60)}"`);
  }
  console.log(`\n${cases.length - fails} live checks passed${fails ? `, ${fails} FAILED` : ''}`);
  if (fails) process.exitCode = 1;
})();
