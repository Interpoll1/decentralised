// Capacitor 6 default-imports tar 6. The security override installs tar 7, whose
// CommonJS namespace has __esModule but no default export. Adapt only this CLI
// process; retain the patched tar version and do not edit installed packages.
const { createRequire } = require('node:module');
const fromCapacitor = createRequire(require.resolve('@capacitor/cli/package.json'));
const tarPath = fromCapacitor.resolve('tar');
const tar = fromCapacitor('tar');
if (tar.__esModule && !tar.default && typeof tar.extract === 'function') {
  require.cache[tarPath].exports = { ...tar, __esModule: true, default: tar };
}
