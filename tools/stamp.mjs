// Browsers and GitHub Pages cache the game's files for a while. After changing anything under js/, run
//   node tools/stamp.mjs 3        (any number higher than the last one)
// so every player gets the whole new set of files at once instead of a mix of old and new.
// It writes the number into the import lines of js/*.js and the script tag in index.html.
import fs from 'fs';

const v = process.argv[2];
if (!/^\d+$/.test(v || '')) { console.error('Give a version number, for example: node tools/stamp.mjs 3'); process.exit(1); }
const root = new URL('../', import.meta.url);
let changed = 0;
for (const name of fs.readdirSync(new URL('js/', root)).filter(f => f.endsWith('.js'))) {
  const url = new URL('js/' + name, root), src = fs.readFileSync(url, 'utf8');
  const out = src.replace(/(from\s+')(\.\/[\w-]+\.js)(\?v=\d+)?(')/g, (m, a, file, old, z) => a + file + '?v=' + v + z);
  if (out !== src) { fs.writeFileSync(url, out); changed++; }
}
const page = new URL('index.html', root), html = fs.readFileSync(page, 'utf8');
const html2 = html.replace(/(src="js\/game\.js)(\?v=\d+)?(")/, (m, a, old, z) => a + '?v=' + v + z);
if (html2 !== html) { fs.writeFileSync(page, html2); changed++; }
console.log(`Stamped version ${v} into ${changed} file(s).`);
