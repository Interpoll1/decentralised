import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { sourceIdentity } from './build-provenance.mjs';

const root = resolve(process.argv[2] || 'dist');
const info = JSON.parse(readFileSync(resolve(root, 'build-info.json'), 'utf8'));
if (info.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(info.source?.commit || '')) throw new Error('Missing source identity');
const current = sourceIdentity();
if (info.source.commit !== current.commit) throw new Error('Build source does not match checkout');
if (process.env.CI && (info.source.dirty || current.dirty)) throw new Error('CI build must use a clean tracked source tree');
if (!info.artifacts?.some(item => item.file === 'index.html') || !info.artifacts.some(item => /\.js$/.test(item.file))) {
  throw new Error('Incomplete build manifest');
}
for (const item of info.artifacts) {
  const path = resolve(root, item.file);
  if (relative(root, path).startsWith('..')) throw new Error('Invalid artifact path');
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== item.sha256) throw new Error(`Artifact digest mismatch: ${item.file}`);
}
console.log(`Verified ${info.artifacts.length} build artifacts; commit=${info.source.commit}; dirty=${info.source.dirty}`);
