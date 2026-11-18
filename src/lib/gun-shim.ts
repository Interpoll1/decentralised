// Bundle the installed, lockfile-pinned Gun instead of loading executable CDN scripts.
// This entry works in the browser and in Node-based tests without requiring a DOM.
import Gun from 'gun/gun.js';
import 'gun/sea.js';

export default Gun;
export const SEALib = Gun.SEA;
