import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = [
  { from: 'node_modules/@vercel/analytics/dist/index.mjs', to: 'app/vendor/vercel-analytics.mjs', pkg: '@vercel/analytics' },
];

mkdirSync(join(root, 'app/vendor'), { recursive: true });
for (const { from, to, pkg } of VENDOR) {
  const { version } = JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8'));
  const code = readFileSync(join(root, from), 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
  writeFileSync(join(root, to), `// Vendored from ${pkg}@${version} by scripts/vendor.mjs. Do not edit.\n${code}`);
  console.log(`vendored ${pkg}@${version} → ${to}`);
}
