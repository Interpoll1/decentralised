import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildProvenancePlugin } from '../tools/build-provenance.mjs';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('records final emitted bytes and detects subsequent artifact modification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-build-')); temporary.push(dir);
  writeFileSync(join(dir, 'index.html'), '<script src="entry.js"></script>');
  writeFileSync(join(dir, 'entry.js'), 'console.log("final bytes");');
  const plugin = buildProvenancePlugin();
  plugin.configResolved({ env: {} });
  plugin.writeBundle({ dir }, { a: { fileName: 'index.html' }, b: { fileName: 'entry.js' } });
  const info = JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8'));
  expect(info.source.commit).toMatch(/^[a-f0-9]{40}$/);
  expect(info.config.api).toBe('https://interpoll.endless.social');
  // Unit tests run inside unit_tests; the verifier must see the repository root.
  const verifier = resolve(__dirname, '../tools/verify-build.mjs');
  const env = { ...process.env, CI: '' };
  expect(execFileSync(process.execPath, [verifier, dir], { encoding: 'utf8', env })).toContain('Verified 2 build artifacts');
  writeFileSync(join(dir, 'entry.js'), 'tampered');
  const result = spawnSync(process.execPath, [verifier, dir], { encoding: 'utf8', env });
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('Artifact digest mismatch');
});
it('validates public build endpoints without dumping environment values', () => {
  const plugin = buildProvenancePlugin();
  expect(() => plugin.configResolved({ env: { VITE_API_BASE_URL: 'https://name:synthetic-password@host.test' } })).toThrow('Invalid public build endpoint');
});
it('fails deployment preflight with missing variable names and never logs values', () => {
  const script = resolve(__dirname, '../tools/check-deploy-env.mjs');
  const env = { ...process.env, FTP_HOST: '', REMOTE_DIR: '', FTP_USER: 'synthetic-user', FTP_PASS: 'synthetic-password' };
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
  expect(result.status).toBe(1); expect(result.stderr).toContain('FTP_HOST, REMOTE_DIR');
  expect(result.stderr).not.toContain('synthetic-user'); expect(result.stderr).not.toContain('synthetic-password');
});
