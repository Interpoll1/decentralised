// Read-only preimage/postimage validation. Does not apply or deploy anything.
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const [directory, mode = 'before'] = process.argv.slice(2);
  if (!directory || !['before', 'after'].includes(mode)) throw new Error('Usage: node verify.mjs BACKEND_DIRECTORY [before|after]');
  const root = await realpath(directory);
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
  if (hash(await readFile(new URL('./backend.patch', import.meta.url))) !== manifest.patchSHA256) throw new Error('Patch digest mismatch');
  for (const [name, pins] of Object.entries(manifest.files)) {
    const path = resolve(root, name); const rel = relative(root, path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Unsafe manifest path');
    let content = null;
    try {
      const actual = await realpath(path); const realRel = relative(root, actual);
      if (isAbsolute(realRel) || realRel === '..' || realRel.startsWith('..' + sep)) throw new Error('Path leaves backend directory');
      content = (await readFile(actual, 'utf8')).replaceAll('\r\n', '\n');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const digest = content === null ? null : hash(content);
    if (digest !== pins[mode]) throw new Error(`Unexpected ${mode} source: ${name}`);
  }
  console.log(`Verified ${mode}: ${Object.keys(manifest.files).length} pinned paths; no files changed.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
