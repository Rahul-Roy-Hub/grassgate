// Builds app/ into dist/ for deploying. No bundler: the app is already plain HTML/CSS/JS.
// What it adds over a plain copy:
//   1. Stamps the service worker cache name with a content hash, so every deploy
//      refreshes phones' offline caches instead of serving stale files.
//   2. Fails the build if the service worker lists a file that doesn't exist,
//      or a page references a local file that doesn't exist.

import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'app');
const out = join(root, 'dist');

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });

const files = walk(out);
const errors = [];

// 1. Content hash → service worker cache version.
const hash = createHash('sha256');
for (const f of files.filter((f) => !f.endsWith('sw.js')).sort()) hash.update(readFileSync(f));
const version = `gg-${hash.digest('hex').slice(0, 10)}`;
const swPath = join(out, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
if (!/const VERSION = '[^']*';/.test(sw)) errors.push('sw.js: could not find the VERSION constant to stamp');
writeFileSync(swPath, sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));

// 2a. Every file the service worker precaches must exist.
const shell = [...sw.matchAll(/^\s*'([^']+)',$/gm)].map((m) => m[1]).filter((p) => p !== './');
for (const p of shell) if (!existsSync(join(out, p))) errors.push(`sw.js precaches missing file: ${p}`);

// 2b. Every local file referenced from HTML, CSS imports and JS imports must exist.
for (const f of files.filter((f) => /\.(html|js)$/.test(f))) {
  const text = readFileSync(f, 'utf8');
  const refs = [
    ...[...text.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]),
    ...[...text.matchAll(/^\s*import[^'"]*['"](\.[^'"]+)['"]/gm)].map((m) => m[1]),
  ].filter((r) => !/^(https?:|data:|mailto:)/.test(r));
  for (const r of refs) {
    if (!existsSync(join(dirname(f), r))) errors.push(`${relative(out, f)} references missing file: ${r}`);
  }
}

if (errors.length) {
  console.error(`\n✖ Build failed:\n  ${errors.join('\n  ')}\n`);
  process.exit(1);
}

const kb = files.reduce((n, f) => n + statSync(f).size, 0) / 1024;
console.log(`✔ Built dist/ — ${files.length} files, ${kb.toFixed(0)} KB, cache ${version}`);
console.log('  Check it locally with: npm run preview');
