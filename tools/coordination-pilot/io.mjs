import { open, lstat, mkdir, opendir, rmdir, unlink, link } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function readBounded(path, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_097_152) throw new Error('FILE_BOUND');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('FILE_BOUND');
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(limit + 1); let n = 0;
    while (n < buffer.length) {
      const part = await file.read(buffer, n, buffer.length - n, null);
      if (!part.bytesRead) break;
      n += part.bytesRead;
    }
    if (n > limit) throw new Error('FILE_BOUND');
    return buffer.subarray(0, n);
  } finally { await file.close(); }
}

// A dedicated directory, no traversal or overwrite. Stale evidence requires operator cleanup.
// The lock also prevents multiple exporter/runner processes from racing this directory's cap.
export async function saveArtifact(directory, kind, value, { now = Date.now() } = {}) {
  if (!['bundle','report'].includes(kind)) throw new Error('ARTIFACT_KIND');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('CLOCK');
  // Reports include fractional performance timings. Canonical cryptographic
  // serialization is applied by the verifier to signed objects, not file formatting.
  const json = JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('ARTIFACT_VALUE');
    return item;
  });
  if (json === undefined) throw new Error('ARTIFACT_VALUE');
  const bytes = Buffer.from(json + '\n');
  if (bytes.length > 2_097_152) throw new Error('ARTIFACT_BOUND');
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('OUTPUT_DIRECTORY');
  const lock = join(root, '.pilot-lock');
  try { await mkdir(lock, { mode: 0o700 }); } catch { throw new Error('OUTPUT_BUSY'); }
  let temporary;
  try {
    const counts = { bundle:0, report:0 }; let entries = 0;
    for await (const entry of await opendir(root)) {
      if (++entries > 41) throw new Error('RETENTION_LIMIT');
      if (entry.name === '.pilot-lock') continue;
      const match = /^pilot-([0-9]+)-[a-f0-9]{16}\.(bundle|report)\.json$/.exec(entry.name);
      if (!match || !entry.isFile() || entry.isSymbolicLink()) throw new Error('OUTPUT_NOT_MANAGED');
      const info = await lstat(join(root, entry.name));
      const createdAt = Number(match[1]);
      if (!Number.isSafeInteger(createdAt) || now - createdAt > 86_400_000 || createdAt > now + 30_000
        || info.size > 2_097_152 || now - info.mtimeMs > 86_400_000 || info.mtimeMs > now + 30_000) throw new Error('RETENTION_EXPIRED');
      counts[match[2]]++;
    }
    if (counts[kind] >= 20) throw new Error('RETENTION_LIMIT');
    const name = `pilot-${now}-${randomBytes(8).toString('hex')}.${kind}.json`;
    const target = join(root, name);
    temporary = join(root, '.pilot-writing');
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    // link is an atomic exclusive publication of the completed file; rename could replace.
    await link(temporary, target);
    await unlink(temporary); temporary = undefined;
    return target;
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    await rmdir(lock);
  }
}
