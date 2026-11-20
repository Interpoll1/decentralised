import { expect, it } from 'vitest';
import { create } from 'tar';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

it('Capacitor 6 extracts a real template with the patched tar 7 dependency', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'echo-cap-template-'));
  try {
    writeFileSync(join(folder, 'fixture.txt'), 'clean template');
    const archive = join(folder, 'template.tgz'), output = join(folder, 'output');
    await create({ cwd: folder, file: archive, gzip: true }, ['fixture.txt']);
    const templateModule = resolve(__dirname, '../node_modules/@capacitor/cli/dist/util/template.js');
    const script = `require(${JSON.stringify(templateModule)}).extractTemplate(process.argv[1], process.argv[2]).catch(e => { console.error(e.message); process.exit(1); });`;
    execFileSync(process.execPath, ['--require', resolve(__dirname, '../tools/capacitor-tar-compat.cjs'), '-e', script, archive, output]);
    expect(readFileSync(join(output, 'fixture.txt'), 'utf8')).toBe('clean template');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
