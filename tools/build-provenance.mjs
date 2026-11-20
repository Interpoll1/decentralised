import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function sourceIdentity() {
  try {
    return {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim()),
    };
  } catch { return { commit: null, dirty: true }; }
}

export function buildProvenancePlugin() {
  const source = sourceIdentity();
  let config;
  return {
    name: 'echo-build-provenance',
    enforce: 'post',
    configResolved(resolved) {
      config = {
        websocket: resolved.env.VITE_WS_RELAY_URL || 'wss://echo.endless.social',
        gun: resolved.env.VITE_GUN_RELAY_URL || 'https://echo2.endless.social/gun',
        api: resolved.env.VITE_API_BASE_URL || 'https://echo.endless.social',
        web: resolved.env.VITE_WEB_ORIGIN || 'https://endless.social',
      };
      for (const [key, value] of Object.entries(config)) {
        const url = new URL(value);
        const protocols = key === 'websocket' ? ['ws:', 'wss:'] : ['http:', 'https:'];
        if (!protocols.includes(url.protocol) || url.username || url.password || url.search || url.hash) {
          throw new Error(`Invalid public build endpoint: ${key}`);
        }
      }
    },
    writeBundle(options, bundle) {
      const artifacts = Object.values(bundle).filter(file => !file.fileName.endsWith('.map')).map(file => {
        // Hash final on-disk bytes after Vite has replaced preload/chunk placeholders.
        const bytes = readFileSync(resolve(options.dir, file.fileName));
        return { file: file.fileName, sha256: createHash('sha256').update(bytes).digest('hex') };
      }).sort((a, b) => a.file.localeCompare(b.file));
      writeFileSync(resolve(options.dir, 'build-info.json'), JSON.stringify({
        schemaVersion: 1, source, builtAt: new Date().toISOString(),
        target: process.env.CAP_BUILD === '1' ? 'native' : 'web',
        // Explicit public endpoint allowlist. Never serialize the environment.
        config, artifacts,
      }, null, 2) + '\n');
    },
  };
}
