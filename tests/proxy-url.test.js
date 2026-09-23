/**
 * Tests for the proxy-URL switch and whitelist consistency.
 *
 * Why this matters: XAMPP runs proxy.php, but Vercel runs NO PHP — it serves
 * proxy.php as source text. If getProxyUrl() returns proxy.php on a deployed
 * host, every search silently dies. Conversely the serverless /api/proxy has a
 * domain whitelist that must match api.js's instance lists, or requests 403.
 *
 * Run: node tests/proxy-url.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const API_SRC = path.join(ROOT, 'src', 'js', 'api.js');
const code = fs.readFileSync(API_SRC, 'utf8');

let pass = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

/** Load api.js with a chosen hostname and return getProxyUrl's output. */
function proxyBaseFor(hostname) {
  return loadApi(hostname).getProxyUrl('https://api.deezer.com/search?q=x');
}

/** Load api.js with a chosen hostname and return the MusicAPI object. */
function loadApi(hostname) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => { throw new Error('no network in tests'); },
    AbortController, setTimeout, clearTimeout, URLSearchParams,
    encodeURIComponent, Promise, Math, Date, JSON,
    window: { location: { hostname } },
    location: { hostname },
  };
  vm.createContext(sandbox);
  return vm.runInContext(`${code}\n;({ MusicAPI })`, sandbox, { filename: API_SRC }).MusicAPI;
}

/** Does this host count as a local install? */
function localFor(hostname) {
  return loadApi(hostname).isLocalHost();
}

console.log('proxy base by host');

t('localhost uses the PHP proxy', () => {
  assert.ok(proxyBaseFor('localhost').startsWith('proxy.php?url='),
    'localhost must use proxy.php (XAMPP serves PHP)');
});

t('127.0.0.1 uses the PHP proxy', () => {
  assert.ok(proxyBaseFor('127.0.0.1').startsWith('proxy.php?url='));
});

t('a deployed host uses the serverless /api/proxy', () => {
  const got = proxyBaseFor('msicfree.vercel.app');
  assert.ok(got.startsWith('/api/proxy?url='),
    `deployed host must not use proxy.php (Vercel cannot run PHP), got: ${got}`);
});

t('the url parameter is encoded', () => {
  const got = proxyBaseFor('localhost');
  assert.ok(!got.includes('api.deezer.com/'), 'upstream URL must be encoded');
  assert.ok(got.includes(encodeURIComponent('https://api.deezer.com')));
});

console.log('\ncan this host shell out to yt-dlp?');

t('localhost, 127.0.0.1, private LAN ranges and the machine name are local', () => {
  for (const h of ['localhost', '127.0.0.1', '10.41.0.220', '192.168.1.5', '172.16.0.9',
                   '172.31.255.1', 'DESKTOP-DFKNNKG', 'my-pc']) {
    assert.ok(localFor(h), `${h} must count as local (the phone reaches the install there)`);
  }
});

t('public hosts and bare numbers are not local', () => {
  for (const h of ['msicfree.vercel.app', 'music-v2-mu.vercel.app', 'example.com',
                   '172.15.0.1', '172.32.0.1', '11.0.0.1', 'localhost.com', '']) {
    assert.ok(!localFor(h), `${h} must NOT count as local (no yt-dlp there)`);
  }
});

t('a local host asks Apache for proxy.php, not the serverless function', () => {
  for (const h of ['localhost', '10.41.0.220', 'DESKTOP-DFKNNKG']) {
    const got = proxyBaseFor(h);
    assert.ok(got.startsWith('proxy.php?url='),
      `${h} must use proxy.php (Apache serves PHP there), got: ${got}`);
  }
});

t('player.js and api.js agree on what "local" means', () => {
  const player = fs.readFileSync(path.join(ROOT, 'src', 'js', 'player.js'), 'utf8');
  assert.ok(/MusicAPI\.isLocalHost\(\)/.test(player),
    'player.js must ask MusicAPI.isLocalHost() rather than repeat the host test');
  assert.ok(!/hostname === 'localhost'/.test(player),
    'player.js has its own copy of the host test again — two copies will drift');
});

console.log('\nwhich search backend does this host reach?');

t('a local host asks Apache for search-audio.php', () => {
  for (const h of ['localhost', '10.41.0.220', 'DESKTOP-DFKNNKG']) {
    const got = loadApi(h).searchAudioUrl();
    assert.strictEqual(got, 'search-audio.php',
      `${h} must use the PHP search (Apache runs yt-dlp there), got: ${got}`);
  }
});

t('a deployed host asks for the /api/ytsearch function, NOT nothing', () => {
  for (const h of ['music-v2-mu.vercel.app', 'msicfree.vercel.app']) {
    const got = loadApi(h).searchAudioUrl();
    assert.strictEqual(got, '/api/ytsearch',
      `${h} must use the bundled extractor — search works there even though resolve does not, got: ${got}`);
  }
});

t('extractor search is not gated on isLocalHost()', () => {
  const src = code.slice(code.indexOf('extractorSearch'), code.indexOf('setJamendoClientId'));
  assert.ok(!/isLocalHost\(\)/.test(src),
    'search must run on BOTH hosts; only the URL switches (resolve is what the IP blocks)');
});

t('the fallback calls MusicAPI.extractorSearch, not this.', () => {
  // `this` inside the `piped` object is the object itself, so this.extractorSearch
  // is undefined and the whole fallback throws "not a function" — silent, because
  // findVideoId catches it and only console.warns. Grep the call site, not the name.
  const at = code.indexOf('extractorSearch(query)');
  assert.ok(at > -1, 'findVideoId must fall back to the extractor');
  const before = code.slice(Math.max(0, at - 20), at);
  assert.ok(/MusicAPI\.$/.test(before),
    `fallback must be MusicAPI.extractorSearch(...), got: ...${before}extractorSearch(query)`);
});

console.log('\nthe extractor reply is Piped-shaped (one scorer for both sources)');

t('api/ytsearch.js turns yt-dlp JSON lines into Piped items', () => {
  const { parseItems } = require(path.join(ROOT, 'api', 'ytsearch.js'));
  const items = parseItems([
    JSON.stringify({ id: 'dQw4w9WgXcQ', title: 'A Song', uploader: 'Some Channel', duration: 213 }),
    JSON.stringify({ id: 'short', title: 'dropped — not id-shaped' }),
    'not json at all',
    '',
  ].join('\n'));

  assert.strictEqual(items.length, 1, 'malformed lines must be skipped, not thrown');
  assert.deepStrictEqual(items[0], {
    type: 'stream',
    title: 'A Song',
    uploaderName: 'Some Channel',
    duration: 213,
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  }, 'shape must match what findVideoId() reads off a real instance');
});

console.log('\nwhitelist consistency (3 files must agree)');

const domainsIn = (text) => new Set([...text.matchAll(/'([a-z0-9.-]+\.[a-z]{2,})'/g)].map(m => m[1]));

const proxyPhp = fs.readFileSync(path.join(ROOT, 'proxy.php'), 'utf8');
const proxyJs = fs.readFileSync(path.join(ROOT, 'api', 'proxy.js'), 'utf8');

// api.js instances: pull hostnames out of the piped/invidious instance arrays
const apiHosts = domainsIn(code);
const phpHosts = domainsIn(proxyPhp);
const jsHosts = domainsIn(proxyJs);

t('api/proxy.js and proxy.php whitelist the same domains', () => {
  const a = [...phpHosts].sort(), b = [...jsHosts].sort();
  assert.deepStrictEqual(b, a,
    `proxy.php has ${a.join(', ')}\n       api/proxy.js has ${b.join(', ')}`);
});

t('every Piped/Invidious instance in api.js is whitelisted', () => {
  const instances = [...code.matchAll(/'https:\/\/([a-z0-9.-]+)'/g)].map(m => m[1]);
  assert.ok(instances.length >= 8, `expected >=8 instances, found ${instances.length}`);
  for (const host of instances) {
    assert.ok(phpHosts.has(host), `instance "${host}" is missing from the proxy whitelist`);
  }
});

console.log(`\n${pass} checks passed`);
