// Append-friendly JSON ledger with atomic writes. Swap for MySQL when volume needs it.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

export function openLedger(path) {
  let state = { accounts: {}, payments: {}, allocations: [] };
  if (path && existsSync(path)) state = JSON.parse(readFileSync(path, 'utf8'));
  const save = () => {
    if (!path) return;
    writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${path}.tmp`, path);
  };
  return { state, save };
}
