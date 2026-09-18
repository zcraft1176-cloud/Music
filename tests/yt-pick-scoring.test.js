/**
 * Regression tests for the YouTube upload picker in src/js/api.js.
 *
 * Why these exist: Deezer supplies the track title the user sees, so a wrong
 * upload pick is silent — the UI reads "Not You" while the instrumental plays.
 * Nothing downstream can detect it. Observed live on the Vercel deployment:
 * "Not You" (Alan Walker feat. Emma Steinbakken) resolved to the YouTube upload
 * "Not You (Instrumental)".
 *
 * Run: node tests/yt-pick-scoring.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'js', 'api.js');
const code = fs.readFileSync(SRC, 'utf8');

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  fetch: async () => { throw new Error('network disabled in tests'); },
  URLSearchParams, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} },
  window: { location: { hostname: 'localhost' } },
  document: {}, navigator: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code + '\n;globalThis.__M = MusicAPI;globalThis.__vp = versionPenalty;' +
  'globalThis.__off = isOfficialChannel;', sandbox);

const MusicAPI = sandbox.__M;
const versionPenalty = sandbox.__vp;
const isOfficialChannel = sandbox.__off;

let pass = 0;
let fails = 0;
const pending = [];
const t = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(r.then(() => { console.log(`  ok   ${name}`); pass++; },
        e => { console.log(`  FAIL ${name}\n       ${e.message}`); fails++; process.exitCode = 1; }));
      return;
    }
    console.log(`  ok   ${name}`); pass++;
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`); fails++; process.exitCode = 1;
  }
};

const url = n => `https://www.youtube.com/watch?v=vid${String(n).padStart(8, '0')}`;
const stream = (title, uploaderName, duration, n) =>
  ({ type: 'stream', title, uploaderName, duration, url: url(n) });

/** Stub the Piped search, then run the real findVideoIds. */
function pick(items, query, duration, wantedTitle) {
  MusicAPI.piped.pipedFetch = async () => ({ items });
  return MusicAPI.piped.findVideoIds(query, duration, 'music_songs', wantedTitle);
}

console.log('helpers');

t('versionPenalty: penalises an unrequested instrumental', () => {
  assert.ok(versionPenalty('not you (instrumental)', 'alan walker not you') >= 40);
});

t('versionPenalty: penalises an unrequested language dub', () => {
  assert.ok(versionPenalty('not you (chinese version)', 'alan walker not you') >= 80);
});

t('versionPenalty: no penalty when the user asked for it', () => {
  assert.strictEqual(versionPenalty('not you (instrumental)', 'not you instrumental'), 0);
});

t('isOfficialChannel: "- Topic" and VEVO count as official', () => {
  assert.strictEqual(isOfficialChannel('adele - topic', 'adele hello'), true);
  assert.strictEqual(isOfficialChannel('coldplay vevo', 'coldplay yellow'), true);
});

t('isOfficialChannel: a featured artist named in the query counts', () => {
  assert.strictEqual(isOfficialChannel('Emma Steinbakken', 'alan walker emma steinbakken not you'), true);
  assert.strictEqual(isOfficialChannel('Vera Dosal', 'alan walker not you'), false);
  // partial-word hits must not count
  assert.strictEqual(isOfficialChannel('Ala', 'alan walker not you'), false);
});

console.log('\nfindVideoIds selection');

t('REGRESSION: the real track beats the instrumental for a collaboration', async () => {
  const items = [
    stream('Not You (Instrumental)', 'Alan Walker', 154, 1),
    stream('Not You', 'Emma Steinbakken', 154, 2),
  ];
  const r = await pick(items, 'Alan Walker Not You', 153, 'Not You');
  assert.strictEqual(r[0].id, 'vid00000002');
});

t('REGRESSION: an upload titled with only the artist name does not win', async () => {
  const items = [
    stream('Imagine Dragons', 'Believer - Topic', 306, 1),
    stream('Believer', 'Imagine Dragons', 205, 2),
  ];
  const r = await pick(items, 'Imagine Dragons Believer', 205, 'Believer');
  assert.strictEqual(r[0].id, 'vid00000002');
});

t('REGRESSION: a 1-second duration match cannot outrank the exact title', async () => {
  const items = [
    stream('Not You (Chinese Version)', 'Alan Walker', 153, 1),
    stream('Not You', 'Emma Steinbakken', 158, 2),
  ];
  const r = await pick(items, 'Alan Walker Not You', 153, 'Not You');
  assert.strictEqual(r[0].id, 'vid00000002');
});

t('REGRESSION: the EDM remix does not beat "Dynamite"', async () => {
  const items = [
    stream('Dynamite (EDM Remix)', 'BTS - Topic', 199, 1),
    stream('Dynamite', 'BTS - Topic', 199, 2),
  ];
  const r = await pick(items, 'BTS Dynamite', 199, 'Dynamite');
  assert.strictEqual(r[0].id, 'vid00000002');
});

t('an unrelated album track on the artist channel loses', async () => {
  const items = [
    stream('Faded', 'Alan Walker', 213, 1),
    stream('Not You', 'Emma Steinbakken', 154, 2),
  ];
  const r = await pick(items, 'Alan Walker Not You', 153, 'Not You');
  assert.strictEqual(r[0].id, 'vid00000002');
});

t('the requested version still wins when the user asks for it', async () => {
  const items = [
    stream('Not You (Instrumental)', 'Alan Walker', 154, 1),
    stream('Not You', 'Emma Steinbakken', 154, 2),
  ];
  MusicAPI.piped.pipedFetch = async () => ({ items });
  const r = await MusicAPI.piped.findVideoIds(
    'Alan Walker Not You Instrumental', 153, 'music_songs', 'Not You Instrumental');
  assert.strictEqual(r[0].id, 'vid00000001');
});

t('up to 3 ranked fallbacks are returned for YT error handling', async () => {
  const items = [
    stream('Not You', 'Emma Steinbakken', 154, 1),
    stream('Not You (Restrung Performance)', 'Alan Walker', 180, 2),
    stream('Not You (Instrumental)', 'Alan Walker', 154, 3),
    stream('Faded', 'Alan Walker', 213, 4),
  ];
  const r = await pick(items, 'Alan Walker Not You', 153, 'Not You');
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[0].id, 'vid00000001');
});

t('an all-short title does not produce NaN scores', async () => {
  const items = [stream('BB', 'IU', 200, 1)];
  const r = await pick(items, 'iu bb', 200, 'iu bb');
  assert.strictEqual(r[0].id, 'vid00000001');
});

t('candidates outside 30-600s are ignored', async () => {
  const items = [
    stream('Long Symphony', 'Orchestra', 900, 1),
    stream('Short Clip', 'Someone', 12, 2),
  ];
  const r = await pick(items, 'Artist Long Symphony', 900, 'Long Symphony');
  assert.strictEqual(r.length, 0);
});

Promise.all(pending).then(() => {
  console.log(`\n${pass} checks passed${fails ? `, ${fails} FAILED` : ''}`);
  if (fails) process.exitCode = 1;
});
