import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const resourcesDir = path.join(rootDir, 'resources');

function createIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  let imageOffset = headerSize + entrySize * images.length;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(imageOffset, 12);
    imageOffset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

async function renderPng(svg, size, outputPath) {
  const png = await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  await writeFile(outputPath, png);
}

await mkdir(publicDir, { recursive: true });
await mkdir(resourcesDir, { recursive: true });

const iconSvg = await readFile(path.join(publicDir, 'pwa-icon.svg'));
const maskableSvg = await readFile(path.join(publicDir, 'pwa-maskable-icon.svg'));

for (const [svg, size, outputPath] of [
  [iconSvg, 16, path.join(publicDir, 'favicon-16x16.png')],
  [iconSvg, 32, path.join(publicDir, 'favicon-32x32.png')],
  [iconSvg, 180, path.join(publicDir, 'apple-touch-icon.png')],
  [iconSvg, 192, path.join(publicDir, 'pwa-192.png')],
  [iconSvg, 512, path.join(publicDir, 'pwa-512.png')],
  [iconSvg, 1024, path.join(resourcesDir, 'icon.png')],
  [maskableSvg, 512, path.join(publicDir, 'pwa-maskable-512.png')],
]) {
  await renderPng(svg, size, outputPath);
}

const socialPreview = await sharp(path.join(publicDir, 'og-preview.svg'))
  .webp({ quality: 90 })
  .toBuffer();
await writeFile(path.join(publicDir, 'og-preview.webp'), socialPreview);

const icoImages = await Promise.all([16, 32, 48].map(async (size) => ({
  size,
  data: await sharp(iconSvg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer(),
})));

await writeFile(path.join(publicDir, 'favicon.ico'), createIco(icoImages));

console.log('Generated InterPoll web icons and social preview.');
