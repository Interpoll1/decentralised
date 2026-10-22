import { rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';

process.env.CAP_BUILD = '1';
await build();
await rm(path.resolve('dist/downloads'), { recursive: true, force: true });
