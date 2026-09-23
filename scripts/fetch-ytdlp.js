/**
 * Fetch the static Linux yt-dlp used by api/ytsearch.js at build time.
 *
 * Not committed: it is ~40 MB and would land in every diff. Not expected on the
 * build image either — Vercel ships no extractor and no ffmpeg, so the function
 * only has what this step puts in bin/.
 */
const fs = require('fs');
const https = require('https');

const URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const OUT = `${__dirname}/../bin/yt-dlp_linux`;

function get(url, depth = 0) {
  if (depth > 5) throw new Error('too many redirects');
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'music-v2-build' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        return resolve(get(res.headers.location, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      resolve(res);
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(`${__dirname}/../bin`, { recursive: true });
  const res = await get(URL);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(OUT, { mode: 0o755 });
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
  fs.chmodSync(OUT, 0o755);
  console.log(`bin/yt-dlp_linux ${fs.statSync(OUT).size} bytes`);
})().catch((e) => {
  // Fail the build: a deploy without the binary would serve search errors to
  // every visitor, which is worse than no deploy at all.
  console.error(`fetch-ytdlp failed: ${e.message}`);
  process.exit(1);
});
