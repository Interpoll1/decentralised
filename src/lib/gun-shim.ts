// src/lib/gun-shim.ts
// Loads Gun from CDN via a dynamic script tag, then re-exports it
// as a proper ESM default so `import Gun from 'gun'` works everywhere.

const CDN = 'https://cdn.jsdelivr.net/npm/gun@0.2020.1240/gun.js';
const SEA = 'https://cdn.jsdelivr.net/npm/gun@0.2020.1240/sea.js';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// Load Gun + SEA sequentially (SEA must come after Gun)
await loadScript(CDN);
await loadScript(SEA);

// Gun writes itself to window.Gun via CJS module.exports
const Gun = (window as any).Gun;
export default Gun;
export const SEALib = (window as any).SEA;