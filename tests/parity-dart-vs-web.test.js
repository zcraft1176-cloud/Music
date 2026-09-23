/**
 * Cross-check: rank the same candidate list with the WEB scorer
 * (src/js/api.js) and with the DART scorer (msicfree_app/lib/services/
 * yt_scorer.dart), and require identical order.
 *
 * If these disagree, the app plays a different upload than the site does —
 * and the user cannot tell, because the title on screen comes from Deezer.
 *
 * Run: node tests/parity-dart-vs-web.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const CASES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'parity-cases.json'), 'utf8'));

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'api.js'), 'utf8');
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  fetch: async () => { throw new Error('network disabled'); },
  URLSearchParams, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} },
  window: { location: { hostname: 'localhost' } },
  document: {}, navigator: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code + '\n;globalThis.__M = MusicAPI;', sandbox);
const MusicAPI = sandbox.__M;

const url = n => `https://www.youtube.com/watch?v=vid${String(n).padStart(8, '0')}`;

function webPick(c) {
  const items = c.items.map((item, i) => ({
    type: 'stream', title: item.title, uploaderName: item.uploaderName,
    duration: item.duration, url: url(i + 1),
  }));
  MusicAPI.piped.pipedFetch = async () => ({ items });
  return MusicAPI.piped.findVideoIds(c.query, c.duration, 'music_songs', c.wantedTitle);
}

let pass = 0, fails = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fails++; process.exitCode = 1; }
}

(async () => {
  const appDir = path.join(__dirname, '..', 'msicfree_app');
  // shell: true — on Windows `flutter` is a .bat shim, which execFile cannot
  // launch directly (ENOENT).
  const raw = execFileSync(
    'flutter test test/parity_dump_test.dart --reporter expanded',
    { cwd: appDir, encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024 });
  const line = raw.split('\n').find(l => l.includes('PARITY_JSON:'));
  if (!line) throw new Error('Dart probe produced no PARITY_JSON line');
  const dart = JSON.parse(line.slice(line.indexOf('PARITY_JSON:') + 12));

  console.log('dart vs web ranking');
  for (const c of CASES) {
    const web = (await webPick(c)).map(v => v.id);
    const app = dart[c.label];
    t(`${c.label}`, () => {
      assert.deepStrictEqual(app, web,
        `web=${JSON.stringify(web)} app=${JSON.stringify(app)}`);
    });
  }

  console.log(`\n  ${pass} parity checks passed${fails ? `, ${fails} FAILED` : ''}`);
})();
