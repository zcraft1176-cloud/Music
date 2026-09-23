/**
 * Self-check for Firestore cloud-sync correctness.
 * Run: node tests/cloud-sync.test.js
 *
 * Two invariants that silently broke liked-song and playlist persistence:
 *
 *  1. Firestore does NOT inherit permissions into subcollections. The client
 *     writes users/{uid}/settings/likedSongs, so `settings` needs its own
 *     match block. Without it every liked-song write was permission-denied.
 *
 *  2. A synchronous try/catch around a NON-awaited .set()/.delete() can never
 *     catch the rejected promise. The failure surfaced only as an unhandled
 *     rejection in devtools while the user was told nothing.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failed = false;
function assert(cond, msg) {
    if (!cond) { console.error('FAIL: ' + msg); failed = true; }
    else console.log('ok - ' + msg);
}

// ---------------------------------------------------------------------------
// 1. firestore.rules must cover every collection the client touches
// ---------------------------------------------------------------------------
const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

assert(/match\s+\/users\/\{userId\}\/playlists\/\{playlistId\}/.test(rules),
       'rules must still allow users/{uid}/playlists/{playlistId}');
assert(/match\s+\/users\/\{userId\}\/settings\/\{docId\}/.test(rules),
       'rules must allow users/{uid}/settings/{docId} (liked songs) — subcollections are not inherited');

// every collection path used in client code must appear in the rules
const clientSrc = ['auth.js', 'liked.js', 'playlist.js']
    .map(f => fs.readFileSync(path.join(ROOT, 'src', 'js', f), 'utf8'))
    .join('\n');
const usedCollections = [...new Set(
    [...clientSrc.matchAll(/\.collection\('([^']+)'\)/g)].map(m => m[1])
)].sort();
assert(usedCollections.length > 0, 'found collection() calls to check');
for (const col of usedCollections) {
    assert(rules.includes(`/${col}/{`) || rules.includes(`/settings/{`),
           `rules mention collection "${col}"`);
}

// guard: uid check present on the settings rule, not a blanket allow
assert(/match\s+\/users\/\{userId\}\/settings\/\{docId\}\s*\{[^}]*request\.auth\.uid\s*==\s*userId/s.test(rules),
       'settings rule must be guarded by request.auth.uid == userId');

// ---------------------------------------------------------------------------
// 2. every Firestore read/write must be awaited
// ---------------------------------------------------------------------------
const files = ['auth.js', 'liked.js', 'playlist.js', 'player.js', 'ui.js', 'app.js', 'search.js', 'api.js'];
let writesChecked = 0, readsChecked = 0;

for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'js', f), 'utf8');
    for (const [op, isWrite] of [['set', true], ['delete', true], ['update', true], ['add', true], ['get', false]]) {
        // anchor on Auth.db so we don't match Map.set() / Set.add() / classList.add()
        const re = new RegExp(`Auth\\.db[\\s\\S]{0,300}?\\.${op}\\(`, 'g');
        let m;
        while ((m = re.exec(src)) !== null) {
            if (isWrite) writesChecked++; else readsChecked++;
            // walk back to the start of the statement and look for `await`
            const start = Math.max(src.lastIndexOf(';', m.index), src.lastIndexOf('{', m.index), 0);
            const stmt = src.slice(start, m.index + m[0].length);
            const line = src.slice(0, m.index).split('\n').length;
            assert(/\bawait\b/.test(stmt), `${f}:${line} Firestore .${op}() must be awaited`);
        }
    }
}
// known real operations: liked.js set, playlist.js set, playlist.js delete (+1 read each file)
assert(writesChecked === 3, `expected 3 Firestore writes, saw ${writesChecked}`);
assert(readsChecked === 2, `expected 2 Firestore reads, saw ${readsChecked}`);

// ---------------------------------------------------------------------------
// 3. the failure path actually reports
// ---------------------------------------------------------------------------
assert(/warnCloudFailure\s*\(/.test(clientSrc), 'a shared cloud-failure reporter exists');
const callSites = [...clientSrc.matchAll(/Auth\.warnCloudFailure\(/g)].length;
assert(callSites >= 3, `every Firestore write should report failure (found ${callSites} call sites)`);
assert(!/Silent fail/.test(clientSrc), 'no "Silent fail" catch blocks left');

if (failed) { console.error('\ncloud-sync checks FAILED'); process.exit(1); }
console.log('\nAll cloud-sync checks passed.');
