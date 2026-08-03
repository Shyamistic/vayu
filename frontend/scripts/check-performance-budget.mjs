import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = resolve('dist');
const MANIFEST = resolve(DIST, '.vite/manifest.json');
const MAX_INITIAL_GZIP_BYTES = 500 * 1024;
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const entry = Object.entries(manifest).find(([, chunk]) => chunk.isEntry);

if (!entry) throw new Error('No Vite entry chunk found in the build manifest.');

const files = new Set();
function collect(key) {
  const chunk = manifest[key];
  if (!chunk || files.has(chunk.file)) return;
  if (chunk.file.endsWith('.js')) files.add(chunk.file);
  for (const dependency of chunk.imports ?? []) collect(dependency);
}
collect(entry[0]);

const sizes = [...files].map((file) => ({
  file,
  bytes: gzipSync(readFileSync(resolve(DIST, file))).byteLength,
}));
const total = sizes.reduce((sum, item) => sum + item.bytes, 0);
console.log(`Initial JavaScript: ${(total / 1024).toFixed(1)} KB gzip`);
for (const item of sizes) console.log(`  ${(item.bytes / 1024).toFixed(1)} KB  ${item.file}`);

if (total > MAX_INITIAL_GZIP_BYTES) {
  throw new Error(`Initial JavaScript exceeds the 500 KB gzip budget by ${((total - MAX_INITIAL_GZIP_BYTES) / 1024).toFixed(1)} KB.`);
}
