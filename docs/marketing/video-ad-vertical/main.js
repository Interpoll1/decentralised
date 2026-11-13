import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CUE, TXT } from './config.js';

await Promise.all(['800 80px Inter', '700 40px Inter', '600 30px Inter', '400 20px Inter', '500 20px "Geist Mono"', '400 20px "Geist Mono"', '400 200px "Grand Hotel"', '400 100px Anton'].map(f => document.fonts.load(f)));
await document.fonts.ready;
const W = 1080, H = 1920;
const LANG = new URLSearchParams(location.search).get('lang') || 'en';
const T = TXT[LANG];
document.documentElement.style.setProperty('--hs', LANG === 'fr' ? '68px' : '80px'); document.documentElement.style.setProperty('--hs2', LANG === 'fr' ? '45px' : '56px'); document.documentElement.style.setProperty('--kb', LANG === 'fr' ? '290px' : '316px');
const CURSOR = '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M4 2l15 9-7 1.5L8.5 20z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>';
const GREEN = new THREE.Color(0x3dff7a), RED = new THREE.Color(0xff3b4e), WHITE = new THREE.Color(0xffffff);

// ---------- helpers ----------
const sat = x => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const eOut = x => 1 - Math.pow(1 - sat(x), 3);
const eIO = x => { x = sat(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const eBack = x => { x = sat(x); const c = 1.70158 * 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const noise1 = (t, s) => Math.sin(t * 1.3 + s) * .5 + Math.sin(t * 2.9 + s * 2.1) * .3 + Math.sin(t * 6.1 + s * 3.7) * .2;

// ---------- renderer ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setSize(W, H, false); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020403, 0.028);
const cam = new THREE.PerspectiveCamera(42, W / H, 0.1, 200);
scene.add(new THREE.AmbientLight(0x8fa3a0, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(5, 8, 6); scene.add(key);
const rim = new THREE.DirectionalLight(0x3dff7a, 2.0); rim.position.set(-6, 2, -6); scene.add(rim);

const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, cam));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.85, 0.75, 0.32);
composer.addPass(bloom);
const fx = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uT: { value: 0 }, uFade: { value: 1 }, uGlitch: { value: 0 }, uFlash: { value: 0 }, uCA: { value: 1 }, uDesat: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `
  uniform sampler2D tDiffuse;uniform float uT,uFade,uGlitch,uFlash,uCA,uDesat;uniform vec3 uTint;varying vec2 vUv;
  float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  void main(){
    vec2 uv=vUv;
    float band=floor(uv.y*46.+floor(uT*24.)*3.1);
    float g=step(1.-uGlitch*.55,h(vec2(band,floor(uT*24.))));
    uv.x+=g*(h(vec2(band,7.+floor(uT*24.)))-.5)*.16*uGlitch;
    vec2 d=uv-.5;float r2=dot(d,d);
    float ca=(.0035*uCA+.02*uGlitch)*(.4+r2*3.);
    vec3 c;c.r=texture2D(tDiffuse,uv+d*ca).r;c.g=texture2D(tDiffuse,uv).g;c.b=texture2D(tDiffuse,uv-d*ca).b;
    float l=dot(c,vec3(.299,.587,.114));c=mix(c,vec3(l),uDesat);c*=uTint;
    c*=1.-smoothstep(.18,.85,r2*1.9)*.85;
    c+=(h(uv*vec2(1920.,1080.)+fract(uT)*91.7)-.5)*.045;
    c+=uFlash*vec3(.75,1.,.85);
    c*=uFade;
    c*=1.-.06*step(.5,fract(uv.y*540.))*uGlitch;
    gl_FragColor=vec4(max(c,0.),1.);
  }` });
composer.addPass(fx);
composer.addPass(new OutputPass());

// ---------- textures ----------
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}
const GLOW = glowTex();
function cardTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160; const x = c.getContext('2d');
  x.fillStyle = 'rgba(255,255,255,.16)'; x.beginPath(); x.roundRect(2, 2, 252, 156, 22); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 4; x.stroke();
  x.fillStyle = '#fff'; x.beginPath(); x.arc(42, 44, 20, 0, 7); x.fill();
  x.fillRect(76, 30, 110, 10); x.globalAlpha = .7; x.fillRect(76, 50, 70, 8);
  x.globalAlpha = .85; x.fillRect(24, 84, 208, 9); x.fillRect(24, 104, 180, 9); x.fillRect(24, 124, 120, 9);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- background ----------
const bg = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uT: { value: 0 }, uA: { value: 1 }, uC: { value: new THREE.Color(0x0b3a1c) } },
  vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `varying vec3 vP;uniform float uT,uA;uniform vec3 uC;
  float h(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
  float n(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);}
  void main(){vec3 d=normalize(vP);float f=n(d*2.2+uT*.03)*.6+n(d*5.+uT*.05)*.3+n(d*11.)*.1;f=pow(f,2.6);
  vec3 c=uC*f*1.5*uA+vec3(.004,.007,.006);gl_FragColor=vec4(c,1.);}` }));
scene.add(bg);
const dust = (() => {
  const N = 1400, r = rng(11), p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { p[i * 3] = (r() - .5) * 60; p[i * 3 + 1] = (r() - .5) * 34; p[i * 3 + 2] = (r() - .5) * 60; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ size: .09, map: GLOW, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x9bffc0 });
  const o = new THREE.Points(g, m); scene.add(o); return o;
})();

// ---------- DOM ----------
const ui = document.getElementById('ui');
let CUR = 'A'; const REG = [];
function el(tag, cls, html, parent = ui) { const e = document.createElement(tag); if (parent === ui) { e._sc = CUR; REG.push(e); } if (cls) e.className = cls; if (html != null) e.innerHTML = html; parent.appendChild(e); return e; }
function words(e) { // split text nodes into word spans, keep <em>
  const out = [];
  const walk = n => {
    for (const ch of [...n.childNodes]) {
      if (ch.nodeType === 3) { const fr = document.createDocumentFragment(); ch.textContent.split(/(\s+)/).forEach(w => { if (!w) return; if (/^\s+$/.test(w)) fr.appendChild(document.createTextNode(' ')); else { const s = document.createElement('span'); s.className = 'w'; s.textContent = w; fr.appendChild(s); out.push(s); } }); n.replaceChild(fr, ch); }
      else walk(ch);
    }
  }; walk(e); return out;
}
// show element between t0..t1 with fade/slide
function vis(e, t, t0, t1, o = {}) {
  const i = eOut((t - t0) / (o.in ?? .5)), u = 1 - ss(t1 - (o.out ?? .35), t1, t);
  const a = t < t0 ? 0 : i * u; e.style.opacity = a;
  if (a > 0 && o.dy !== 0) e.style.transform = `translate3d(0,${(1 - i) * (o.dy ?? 30) - (1 - u) * 14}px,0) scale(${o.scale ? lerp(o.scale, 1, i) : 1})`;
  return a;
}
function headline(cls, html) { const e = el('div', 'abs ' + cls, html); e._w = words(e); return e; }
function visWords(e, t, t0, t1, stag = .07) {
  const u = 1 - ss(t1 - .35, t1, t); e.style.opacity = t < t0 ? 0 : u; if (t < t0 || u <= 0) return;
  e._w.forEach((w, i) => { const k = eOut((t - t0 - i * stag) / .45); w.style.opacity = k; w.style.transform = `translate3d(0,${(1 - k) * 34}px,0)`; w.style.filter = k < 1 ? `blur(${(1 - k) * 8}px)` : 'none'; });
}
function project(v) { cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); const p = v.clone().project(cam); return { x: (p.x * .5 + .5) * W, y: (-p.y * .5 + .5) * H, z: p.z }; }
function place(e, v, dx = 0, dy = 0) { const p = project(v); e.style.left = '0'; e.style.top = '0'; e.style.transform = `translate3d(${p.x + dx}px,${p.y + dy}px,0) translate(-50%,-50%)`; return p; }

CUR = 'X';
const scrimC = el('div', 'scrim', ''); scrimC.id = 'scrimC';
const scrimL = el('div', 'scrim', ''); scrimL.id = 'scrimL';
const scrimB = el('div', 'scrim', ''); scrimB.id = 'scrimB';


CUR='X';
const A = (() => {
  const g = new THREE.Group(); scene.add(g);
  const r = rng(3);
  const mono = new THREE.Mesh(new THREE.BoxGeometry(1.7, 7.5, 1.7), new THREE.MeshStandardMaterial({ color: 0x0c0e12, metalness: .95, roughness: .28 }));
  mono.position.y = .4; g.add(mono);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xff4455 });
  const leds = new THREE.Group(); g.add(leds);
  for (let i = 0; i < 26; i++) for (let s = 0; s < 4; s++) {
    if (r() < .25) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(.9 + r() * .5, .05, .02), ledMat);
    m.position.set(0, -3 + i * .28, .86); const p = new THREE.Group(); p.rotation.y = s * Math.PI / 2; p.add(m); leds.add(p);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xff3344, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(11, 14, 1); halo.position.y = .5; g.add(halo);
  const N = 520, geo = new THREE.PlaneGeometry(.62, .39);
  const mat = new THREE.MeshBasicMaterial({ map: cardTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const cards = new THREE.InstancedMesh(geo, mat, N); g.add(cards);
  const pal = [0xffd27a, 0x7ab8ff, 0xff9ac0, 0xffffff, 0xb4a0ff, 0x8affd0, 0xffb07a].map(c => new THREE.Color(c));
  const d = [];
  for (let i = 0; i < N; i++) d.push({ R: 2.6 + Math.pow(r(), .7) * 8.5, a: r() * 6.283, y: (r() - .5) * 7 + .4, sp: (.05 + r() * .09) * (r() < .5 ? 1 : .8), c: pal[(r() * pal.length) | 0], ph: r() * 6.283, tum: V(r() - .5, r() - .5, r() - .5).multiplyScalar(5), del: r() });
  const lp = new Float32Array(N * 6), lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const lm = new THREE.LineBasicMaterial({ color: 0xff8090, transparent: true, opacity: .14, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(lg, lm); lines.frustumCulled = false; g.add(lines);
  const o = new THREE.Object3D(), col = new THREE.Color();
  const AP = { kill: 1e9, a2: -9, B: 1e9 };
  return {
    g, update(t) {
      const k = AP.kill, dt = t - k, dead = dt > 0;
      mono.material.emissive.setRGB(0, 0, 0);
      const sour = ss(AP.a2 - .3, AP.a2 + 1.2, t);
      const ledOn = (dead ? 1 : sour) * (dead ? (dt < .12 ? 3 : Math.max(0, (dt < .5 ? (Math.sin(dt * 90) > 0 ? .7 : 0) : 0))) : 1 + .25 * Math.sin(t * 7));
      ledMat.color.setRGB(1 * ledOn, .27 * ledOn, .33 * ledOn);
      halo.material.opacity = dead ? Math.max(0, .5 - dt * 2) : (.42 + .06 * Math.sin(t * 2)) * sour;
      lm.opacity = dead ? Math.max(0, .5 - dt * 3) : .13 * sour;
      for (let i = 0; i < N; i++) {
        const c = d[i], a = c.a + (dead ? k : t) * c.sp + (dead ? Math.min(dt, .6) * c.sp : 0);
        let x = Math.cos(a) * c.R, z = Math.sin(a) * c.R, y = c.y + Math.sin(t * .8 + c.ph) * .12;
        let bright = .85 + .3 * Math.sin(t * 2.2 + c.ph * 3), sc = 1;
        o.rotation.set(0, -a + Math.PI / 2 + .3, 0);
        if (dead) {
          const f = Math.max(0, dt - c.del * .9 - c.R * .03);
          y -= 5.5 * f * f; x *= 1 + f * .08; z *= 1 + f * .08;
          o.rotation.x += c.tum.x * f; o.rotation.z += c.tum.z * f; o.rotation.y += c.tum.y * f;
          bright *= Math.max(0, 1 - f * 1.5) * (dt < .1 ? 2.5 : 1); sc = Math.max(0, 1 - f * .35);
        }
        o.position.set(x, y, z); o.scale.setScalar(sc * ss(0, 1.2, t - c.del * .8)); o.updateMatrix(); cards.setMatrixAt(i, o.matrix);
        col.copy(c.c).multiplyScalar(bright * .34); if (dead) col.lerp(new THREE.Color(.5, .5, .55).multiplyScalar(bright * .3), sat(dt * 4)); cards.setColorAt(i, col);
        lp.set([x, y, z, 0, c.y * .45 + .4, 0], i * 6);
      }
      cards.instanceMatrix.needsUpdate = true; cards.instanceColor.needsUpdate = true; lg.attributes.position.needsUpdate = true;
      // camera
      const ang = -.5 + t * .05, dist = lerp(19, 12.5, eIO(t / AP.B));
      cam.position.set(Math.sin(ang) * dist, 1.8 + t * .08, Math.cos(ang) * dist);
      if (dead && dt < .8) { const s = (1 - dt / .8) * .35; cam.position.x += noise1(t * 30, 1) * s; cam.position.y += noise1(t * 30, 5) * s; }
      cam.lookAt(1.2, .6, 0); cam.fov = 42;
    }, AP
  };
})();

// =====================================================================
// NETWORK (scenes B, D, F, G)
// =====================================================================
const NET = (() => {
  const g = new THREE.Group(); scene.add(g);
  const r = rng(7), N = 170, R = 5, pts = [];
  for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2, rad = Math.sqrt(1 - y * y), th = i * 2.39996323; const rr = R * (.86 + r() * .28); pts.push(V(Math.cos(th) * rad * rr, y * rr, Math.sin(th) * rad * rr)); }
  const relayIdx = []; for (let i = 6; i < N; i += 13) relayIdx.push(i);
  const isRelay = new Set(relayIdx);
  const edges = [], eset = new Set();
  const addE = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (a !== b && !eset.has(k)) { eset.add(k); edges.push([a, b]); } };
  for (let i = 0; i < N; i++) { const ds = pts.map((p, j) => [p.distanceTo(pts[i]), j]).sort((a, b) => a[0] - b[0]); for (let k = 1; k <= 3; k++) addE(i, ds[k][1]); if (isRelay.has(i)) for (let k = 4; k <= 7; k++) addE(i, ds[k][1]); }
  // relay backbone
  relayIdx.forEach((a, i) => { const ds = relayIdx.map(b => [pts[a].distanceTo(pts[b]), b]).sort((x, y) => x[0] - y[0]); addE(a, ds[1][1]); addE(a, ds[2][1]); });
  // BFS order from seed
  const seed = relayIdx[6], KILL = relayIdx[5];
  const adj = pts.map(() => []); edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
  const depth = new Array(N).fill(99); depth[seed] = 0; let q = [seed];
  while (q.length) { const n = []; for (const a of q) for (const b of adj[a]) if (depth[b] > depth[a] + 1) { depth[b] = depth[a] + 1; n.push(b); } q = n; }
  const maxD = Math.max(...depth.filter(x => x < 99));
  const ord = depth.map((x, i) => Math.min(1, x / maxD) * .9 + r() * .08);
  // edges
  const E = edges.length, ep = new Float32Array(E * 6), eo = new Float32Array(E * 2), ed = new Float32Array(E * 2), eu = new Float32Array(E * 2), es = new Float32Array(E * 2);
  edges.forEach(([a, b], i) => { ep.set([...pts[a].toArray(), ...pts[b].toArray()], i * 6); const o = Math.max(ord[a], ord[b]); eo[i * 2] = eo[i * 2 + 1] = o; const dd = (a === KILL || b === KILL) ? 1 : 0; ed[i * 2] = ed[i * 2 + 1] = dd; eu[i * 2] = 0; eu[i * 2 + 1] = 1; es[i * 2] = es[i * 2 + 1] = r(); });
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3)); eg.setAttribute('aO', new THREE.BufferAttribute(eo, 1)); eg.setAttribute('aD', new THREE.BufferAttribute(ed, 1)); eg.setAttribute('aU', new THREE.BufferAttribute(eu, 1)); eg.setAttribute('aS', new THREE.BufferAttribute(es, 1));
  const em = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uGrow: { value: 0 }, uDead: { value: 0 }, uT: { value: 0 }, uA: { value: 1 } },
    vertexShader: 'attribute float aO,aD,aU,aS;varying float vO,vD,vU,vS;void main(){vO=aO;vD=aD;vU=aU;vS=aS;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float uGrow,uDead,uT,uA;varying float vO,vD,vU,vS;void main(){
      float a=smoothstep(vO,vO+.05,uGrow);float p=pow(.5+.5*sin((vU*2.+vS*9.-uT*(1.2+vS))*6.283),8.);
      vec3 c=mix(vec3(.24,1.,.48),vec3(1.,.2,.3),vD*step(.001,uDead));
      float k=1.-vD*smoothstep(.25,1.,uDead);
      gl_FragColor=vec4(c*(.3+p*1.1)*a*k*uA*(1.+vD*uDead*2.*step(uDead,.3)),1.);}` });
  const lines = new THREE.LineSegments(eg, em); g.add(lines);
  // nodes
  const nodeM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.07, 2), new THREE.MeshBasicMaterial(), N); g.add(nodeM);
  const relM = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.3, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .3, roughness: .35, flatShading: true }), relayIdx.length); g.add(relM);
  relM.material.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = diffuseColor.rgb*.5; diffuseColor.rgb*=.25;'); };
  const relW = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.46, 0), new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthWrite: false }), relayIdx.length); g.add(relW);
  // packets
  const P = 420, pp = new Float32Array(P * 3), pc = new Float32Array(P * 3), pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3)); pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
  const pk = []; for (let i = 0; i < P; i++) pk.push({ e: (r() * E) | 0, ph: r(), sp: .25 + r() * .5, dir: r() < .5 });
  const packets = new THREE.Points(pg, new THREE.PointsMaterial({ size: .2, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); packets.frustumCulled = false; g.add(packets);
  // rings
  const ringG = new THREE.RingGeometry(.975, 1, 128);
  const rings = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); scene.add(m); return m; });
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0x3dff7a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(core); core.position.copy(pts[seed]);
  const o = new THREE.Object3D(), col = new THREE.Color();
  return {
    g, pts, seed, KILL, relayIdx, rings, core,
    // grow 0..1, dead 0..1 (kill progress), alpha
    update(t, grow, dead, alpha = 1) {
      em.uniforms.uGrow.value = grow * 1.06; em.uniforms.uDead.value = dead; em.uniforms.uT.value = t; em.uniforms.uA.value = alpha;
      let ri = 0;
      for (let i = 0; i < N; i++) {
        const k = eBack((grow * 1.06 - ord[i]) / .06) * (grow > ord[i] ? 1 : 0);
        const kd = i === KILL ? dead : 0;
        o.position.copy(pts[i]); o.rotation.set(0, 0, 0);
        if (isRelay.has(i)) {
          o.scale.setScalar(.001); o.updateMatrix(); nodeM.setMatrixAt(i, o.matrix);
          const s = k * (1 + .08 * Math.sin(t * 3 + i)) * (1 - ss(.3, 1, kd)) * (kd > 0 && kd < .3 ? 1.5 : 1);
          o.scale.setScalar(Math.max(s, .0001)); o.rotation.set(t * .6 + i, t * .9 + i * 2, 0); o.updateMatrix(); relM.setMatrixAt(ri, o.matrix);
          o.rotation.set(-t * .4 + i, t * .5, i); o.updateMatrix(); relW.setMatrixAt(ri, o.matrix);
          col.copy(kd > 0 ? RED : GREEN).multiplyScalar(alpha); relW.setColorAt(ri, col);
          col.copy(kd > 0 ? new THREE.Color(1, .1, .18) : GREEN).multiplyScalar(alpha * (kd > 0 ? 1.6 : 1)); relM.setColorAt(ri, col); ri++;
        } else {
          o.scale.setScalar(Math.max(k * (1 + .25 * Math.sin(t * 2.4 + i * 1.7)), .0001)); o.updateMatrix(); nodeM.setMatrixAt(i, o.matrix);
          col.setRGB(.3, 1, .5).multiplyScalar(.95 * alpha); nodeM.setColorAt(i, col);
        }
      }
      nodeM.instanceMatrix.needsUpdate = relM.instanceMatrix.needsUpdate = relW.instanceMatrix.needsUpdate = true;
      nodeM.instanceColor.needsUpdate = relM.instanceColor.needsUpdate = relW.instanceColor.needsUpdate = true;
      for (let i = 0; i < P; i++) {
        const p = pk[i], [a, b] = edges[p.e]; let u = (p.ph + t * p.sp) % 1; if (p.dir) u = 1 - u;
        const on = (grow * 1.06 > Math.max(ord[a], ord[b]) + .05) && !((a === KILL || b === KILL) && dead > 0);
        pp[i * 3] = lerp(pts[a].x, pts[b].x, u); pp[i * 3 + 1] = lerp(pts[a].y, pts[b].y, u); pp[i * 3 + 2] = lerp(pts[a].z, pts[b].z, u);
        const br = on ? Math.sin(u * Math.PI) * alpha : 0; pc[i * 3] = .45 * br; pc[i * 3 + 1] = .9 * br; pc[i * 3 + 2] = .6 * br;
      }
      pg.attributes.position.needsUpdate = pg.attributes.color.needsUpdate = true;
    },
    ring(i, worldPos, age, maxR = 6, color = GREEN, dur = 1.6) {
      const m = rings[i]; if (age < 0 || age > dur) { m.material.opacity = 0; return; }
      const k = age / dur; m.position.copy(worldPos); m.quaternion.copy(cam.quaternion); m.scale.setScalar(.2 + eOut(k) * maxR); m.material.opacity = (1 - k) * .9; m.material.color.copy(color);
    },
    world(i) { return pts[i].clone().applyMatrix4(g.matrixWorld); }
  };
})();


const FROG = (() => {
  const g = new THREE.Group(); scene.add(g);
  const BODY = ['..GG....GG..', '.GWWG..GWWG.', '.GKWG..GKWG.', 'GGGGGGGGGGGG', 'GGGGGGGGGGGG', 'GPPGGGGGGPPG', 'GGGKGGGGKGGG', 'GGGGKKKKGGGG', '.GGGGGGGGGG.', '.GG.GGGG.GG.', '.DD......DD.'];
  const COL = { G: 0x3dff7a, D: 0x1f9e4b, W: 0xffffff, K: 0x05080a, P: 0xff8fb3, Y: 0xffd84a };
  const cells = []; BODY.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') cells.push({ x, y, c }); }));
  cells.push({ x: 11, y: 2, c: 'G', arm: 1 }, { x: 11, y: 1, c: 'G', arm: 1 }, { x: 11, y: 0, c: 'Y', arm: 1 });
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(.94, .94, 1), new THREE.MeshStandardMaterial({ roughness: .35, metalness: .1, emissive: 0xffffff, emissiveIntensity: 0 }), cells.length);
  m.material.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = diffuseColor.rgb*.16; diffuseColor.rgb*=.22;'); };
  const frog = new THREE.Group(); frog.add(m); g.add(frog);
  const o = new THREE.Object3D(), col = new THREE.Color(), rr = rng(4); const dl = cells.map(() => rr());
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0x3dff7a, transparent: true, opacity: .0, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.setScalar(9); g.add(halo);
  return {
    g, frog, halo, update(lt) {
      const blink = (lt % 2.6) > 2.45;
      cells.forEach((c, i) => {
        const k = eBack((lt - .15 - dl[i] * .55) / .6) * (lt > .15 + dl[i] * .55 ? 1 : 0);
        let y = 5 - c.y, x = c.x - 5.5, z = 0;
        if (c.arm) { const w = Math.sin(lt * 7) * .5; x += (c.y < 2 ? w * (2 - c.y) * .45 : 0); }
        const sc = lerp(14, 1, eOut((lt - dl[i] * .55) / .75));
        o.position.set(x * sc, y * sc, z + (1 - k) * 6 * (dl[i] - .5)); o.rotation.set((1 - k) * 3 * dl[i], (1 - k) * 4, 0); o.scale.setScalar(Math.max(k, .0001)); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
        let cc = COL[c.c]; if (blink && (c.c === 'W' || c.c === 'K') && c.y < 3) cc = COL.G;
        col.setHex(cc); m.setColorAt(i, col);
      });
      m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
      const hop = Math.abs(Math.sin(Math.max(0, lt - 1.0) * 2.4)) * Math.exp(-Math.max(0, lt - 1.0) * .5) * .5;
      frog.scale.setScalar(.2); frog.position.set(0, 2.5 + hop + Math.sin(lt * 1.6) * .05, 0); frog.rotation.set(Math.sin(lt * .9) * .08, Math.sin(lt * .7) * .38 - .1, Math.sin(lt * 1.3) * .04);
      halo.position.set(0, 2.6, -1); halo.material.opacity = .12 * ss(.4, 1.4, lt);
    }
  };
})();

// =====================================================================
// vertical cuts: ?v=short | ?v=phonk
// =====================================================================
const MODE = new URLSearchParams(location.search).get('v') || 'short';
document.getElementById('stage').classList.add(MODE);
const camT = V(0, 0, 0);
const grp = { A: A.g, NET: NET.g, F: FROG.g };
function base(t) {
  const u = fx.uniforms; u.uT.value = t; bg.material.uniforms.uT.value = t; dust.rotation.y = t * .012;
  for (const e of REG) e.style.opacity = 0;
  NET.rings.forEach(r => r.material.opacity = 0); NET.core.material.opacity = 0;
  NET.g.position.set(0, 0, 0); NET.g.scale.setScalar(1);
  grp.A.visible = grp.NET.visible = grp.F.visible = false; cam.fov = 42;
}
function finish(o) {
  const u = fx.uniforms; u.uFade.value = o.fade ?? 1; u.uGlitch.value = o.glitch ?? 0; u.uFlash.value = o.flash ?? 0; u.uDesat.value = o.desat ?? 0; u.uCA.value = o.ca ?? 1;
  u.uTint.value.setRGB(...(o.tint ?? [1, 1, 1])); bg.material.uniforms.uA.value = o.bgA ?? 1; bloom.strength = o.bloom ?? .85;
  cam.updateProjectionMatrix(); composer.render();
}
function netCam(dist, ang, y = 0, look = V(0, 0, 0)) { cam.position.set(Math.sin(ang) * dist, y, Math.cos(ang) * dist); cam.lookAt(look); }
function endCard(lt, logo, tag, url, note, t, tEnd) {
  grp.F.visible = grp.NET.visible = true;
  NET.g.rotation.set(.2, t * .05, 0); NET.g.scale.setScalar(2.1); NET.g.position.set(0, 0, -12); NET.g.updateMatrixWorld(true); NET.update(t, 1, 0, .5);
  scrimC.style.opacity = .7;
  FROG.update(lt); FROG.frog.position.y += .9; FROG.halo.position.y += .9; FROG.halo.material.opacity *= .5;
  cam.position.set(Math.sin(lt * .12) * .4, .3, lerp(17.5, 15.5, eOut(lt / 5))); cam.lookAt(0, .2, 0); cam.fov = 40;
  vis(logo, t, t - lt + .35, 999, { in: .7, scale: 1.15, dy: 20 });
  if (tag._w) visWords(tag, t, t - lt + .8, 999, .07); else vis(tag, t, t - lt + .8, 999);
  vis(url, t, t - lt + 1.2, 999, { in: .5, scale: .8, dy: 30 }); url.firstChild.style.transform = `scale(${1 + .03 * Math.sin(lt * 6)})`;
  vis(note, t, t - lt + 1.6, 999);
}
const postHTML = p => `<div class="pm"><span class="av" style="background:${p.c}">${p.n[0]}</span><div><b>${p.n}</b><i>${p.g}</i></div></div><div class="pt">${p.t}</div><div class="ph" style="background:${p.bg}">${p.e}</div><div class="pf"><span>♥ ${p.l}</span><span>💬 ${p.r}</span></div>`;
const swHTML = (lab, name) => `<div class="lab">${lab}</div><div class="row"><div class="name">${name}</div><div class="tog"><div class="knob"></div></div></div>`;
let frame;

if (MODE === 'short') {
  // ------------------------------------------------------------------ SHORT
  const HP = [[60, 150, -4, 1.18], [560, 520, 4, 1.12], [90, 800, -3, 1.05]];
  const heroes = T.posts.slice(0, 3).map((p, i) => { const e = el('div', 'abs post', postHTML(p)); e.style.left = HP[i][0] + 'px'; e.style.top = HP[i][1] + 'px'; return e; });
  const AD = [[540, 170, 6], [560, 930, 5]];
  const ads = AD.map((p, i) => { const e = el('div', 'abs adc', `<small>${T.sponsored}</small><b>${T.ads[i]}</b><u>${T.adBtn}</u>`); e.style.left = p[0] + 'px'; e.style.top = p[1] + 'px'; return e; });
  const owner = el('div', 'abs', `<span>${T.owner}</span>`); owner.id = 'owner';
  const frameEl = el('div', 'abs', ''); frameEl.id = 'ownFrame';
  const h1 = headline('h vh red', T.s1), h1b = headline('h vh red', T.s1b);
  const sw = el('div', 'abs sw', swHTML(T.swLab, T.swName)); const tog = sw.querySelector('.tog'), knob = sw.querySelector('.knob'), swName = sw.querySelector('.name');
  const cur = el('div', 'abs', CURSOR);
  const logoWrap = el('div', 'abs center', '<span id="logo">Interpoll</span>'); logoWrap.id = 'logoWrap';
  const logoSub = el('div', 'abs center', T.s2); logoSub.id = 'logoSub';
  const P = T.feed;
  const feed = el('div', 'abs', `
    <div class="fh"><span class="fav">🏡</span><div><b>${P.space}</b><i>${P.members}</i></div><span class="joined">✓ ${P.joined}</span></div>
    <div class="comp"><span class="av" style="background:#3dff7a;color:#04130a">${P.you[0]}</span><div class="ctext"></div><div class="pub">➤ ${P.publish}</div></div>
    <div class="flist">
      <div class="fpost new"><div class="pm"><span class="av" style="background:#3dff7a;color:#04130a">${P.you[0]}</span><div><b>${P.you}</b><i>${P.now}</i></div></div><div class="pt big">${P.text}</div><div class="ph" style="background:linear-gradient(135deg,#ff9a5a,#ff5a8a)">🎉</div><div class="pf"><span class="lk">♥ 0</span><span class="cm">💬 0</span></div></div>
      <div class="fpost"><div class="pm"><span class="av" style="background:${T.posts[0].c}">${T.posts[0].n[0]}</span><div><b>${T.posts[0].n}</b><i>2 h</i></div></div><div class="pt">${T.posts[0].t}</div><div class="ph" style="background:${T.posts[0].bg}">${T.posts[0].e}</div><div class="pf"><span>♥ ${T.posts[0].l}</span><span>💬 ${T.posts[0].r}</span></div></div>
      <div class="fpost"><div class="pm"><span class="av" style="background:${T.posts[1].c}">${T.posts[1].n[0]}</span><div><b>${T.posts[1].n}</b><i>5 h</i></div></div><div class="pt">${T.posts[1].t}</div><div class="ph" style="background:${T.posts[1].bg}">${T.posts[1].e}</div></div>
    </div>`); feed.id = 'feed';
  const ctext = feed.querySelector('.ctext'), pub = feed.querySelector('.pub'), np = feed.querySelector('.fpost.new'), lk = feed.querySelector('.lk'), cm = feed.querySelector('.cm');
  const replies = P.replies.slice(0, 2).map(r => el('div', 'abs reply', `<span class="av" style="background:${r.c}">${r.n[0]}</span><div><b>${r.n}</b><p>${r.t}</p></div>`));
  const RP = [[150, 1000, -2], [330, 1120, 2]];
  const cur2 = el('div', 'abs', CURSOR);
  const h3 = headline('h vh', T.s3); const chips = el('div', 'abs center chips', T.s3chips.map(c => `<span><b>✕</b> ${c}</span>`).join(''));
  const h4 = headline('h vh', T.s4);
  const swD = el('div', 'abs sw', swHTML(T.swLab2, T.swName2)); const dTog = swD.querySelector('.tog'), dKnob = swD.querySelector('.knob');
  const curD = el('div', 'abs', CURSOR); const nope = el('div', 'abs stamp ok', T.nope);
  const eLogo = el('div', 'abs center', 'Interpoll'); eLogo.id = 'endLogo';
  const eTag = headline('center', T.g1); eTag.id = 'endTag'; eTag.classList.add('abs');
  const eUrl = el('div', 'abs center', '<span>endless.social</span>'); eUrl.id = 'endUrl';
  const eNote = el('div', 'abs center', T.g2); eNote.id = 'endNote';
  const hr = rng(41), hd = HP.map(() => [hr(), hr()]);
  frame = t => {
    base(t); const o = {}; const K = CUE;
    const sc = t < K.B ? 'A' : t < K.C ? 'B' : t < K.D ? 'C' : t < K.G ? 'D' : 'G';
    const cut = (tc, w = .16) => { o.fade = (o.fade ?? 1) * ss(0, w, Math.abs(t - tc)); };
    if (sc === 'A') {
      grp.A.visible = true; A.AP.kill = K.kill; A.AP.a2 = -1; A.AP.B = K.B; A.update(t + 3);
      cam.position.multiplyScalar(1.25); cam.lookAt(0, 1.2, 0);
      const dt = t - K.kill, dead = dt > 0;
      heroes.forEach((e, i) => {
        const k = eBack((t - .05 - i * .12) / .45) * (t > .05 + i * .12 ? 1 : 0), f = Math.max(0, dt - hd[i][0] * .25);
        e.style.opacity = k > 0 ? (dead ? Math.max(0, 1 - f * 1.5) : 1) : 0; e.style.filter = `grayscale(${dead ? 1 : 0}) brightness(${dead ? .55 : 1})`;
        e.style.transform = `translate3d(${Math.cos(t + i) * 6}px,${Math.sin(t * 1.1 + i * 1.7) * 8 + (dead ? 1400 * f * f : 0)}px,0) rotate(${HP[i][2] + (dead ? f * 40 * (hd[i][1] - .5) : 0)}deg) scale(${HP[i][3] * Math.max(k, .001)})`;
      });
      ads.forEach((e, i) => {
        const t0 = K.ad + i * .22, k = eBack((t - t0) / .32) * (t > t0 ? 1 : 0), f = Math.max(0, dt - .08 * i);
        e.style.opacity = k > 0 ? (dead ? Math.max(0, 1 - f * 1.5) : 1) : 0;
        e.style.transform = `translate3d(0,${dead ? 1400 * f * f : 0}px,0) rotate(${AD[i][2] + (dead ? f * 30 : 0)}deg) scale(${1.25 * Math.max(k, .001)})`;
      });
      vis(owner, t, K.ad - .25, K.kill + .3, { dy: -30, in: .3 }); frameEl.style.opacity = ss(K.ad - .25, K.ad + .2, t) * (1 - ss(K.kill, K.kill + .4, t));
      visWords(h1, t, .15, K.s1b - .05, .045); visWords(h1b, t, K.s1b, K.B - .1, .05);
      vis(sw, t, K.s1b - .1, K.B - .12, { dy: 40, in: .3 });
      const off = sat(dt / .12); knob.style.left = lerp(60, 6, eOut(off)) + 'px'; tog.style.background = off > 0 ? '#ff3b4e' : '#2bd566';
      swName.textContent = off > 0 ? T.swOff : T.swName; swName.style.color = off > 0 ? '#ff6b78' : '#fff';
      const cp = eIO((t - (K.kill - .7)) / .6); cur.style.opacity = sat((t - (K.kill - .75)) / .15) * (1 - ss(K.kill + .4, K.kill + .7, t));
      cur.style.transform = `translate3d(${lerp(620, 800, cp)}px,${lerp(1880, 1688, cp)}px,0) scale(${dt > -.05 && dt < .12 ? .82 : 1})`;
      o.fade = ss(0, .3, t); o.desat = dead ? lerp(.25, .9, sat(dt * 3)) : .2 * ss(K.ad - .3, K.ad + .3, t); o.bgA = .25;
      if (dead) { o.glitch = Math.max(0, 1 - dt / .5); o.fade *= lerp(1, 0, ss(.55, K.B - K.kill - .05, dt)); }
    }
    if (sc === 'B') {
      grp.NET.visible = true; const lt = t - K.B, tl = K.logo;
      NET.g.rotation.set(.15, t * .1, 0); NET.g.updateMatrixWorld(true);
      const grow = eIO((t - (tl - .45)) / 1.6) * .95; NET.update(t, Math.max(grow, .012), 0, lerp(1, .55, ss(tl, tl + .6, t)));
      const sp = NET.world(NET.seed), n = sp.clone().normalize(), pull = eIO((t - (tl - .45)) / 1.5);
      cam.position.copy(sp).add(n.clone().multiplyScalar(lerp(3.2, 21, pull))); camT.copy(sp).lerp(V(0, 0, 0), pull); cam.lookAt(camT);
      NET.core.position.copy(NET.pts[NET.seed]); NET.core.material.color.copy(GREEN); NET.core.material.opacity = (1 - pull * .7) * (.7 + .3 * Math.sin(t * 9)); NET.core.scale.setScalar(1.6);
      NET.ring(0, sp, lt, 2.4, GREEN, .9); NET.ring(3, sp, t - (tl - .45), 16, GREEN, 1.3);
      o.fade = ss(0, .25, lt); o.flash = Math.max(0, 1 - Math.abs(t - tl) / .1) * .35; o.bgA = lerp(.2, 1, pull);
      vis(logoWrap, t, tl, K.C - .12, { in: .5, scale: 1.3, dy: 0 }); vis(logoSub, t, tl + .3, K.C - .12, { in: .3 });
      cut(K.C);
    }
    if (sc === 'C') {
      grp.NET.visible = true; NET.g.rotation.set(.2, t * .06, 0); NET.g.position.set(3, -6, -10); NET.g.scale.setScalar(1.5); NET.g.updateMatrixWorld(true); NET.update(t, 1, 0, .3);
      cam.position.set(0, 0, 16); cam.lookAt(0, 0, 0);
      const tp = K.post, dp = t - tp, lt = t - K.C, end = K.D - .12;
      vis(feed, t, K.C + .05, end, { dy: 0, in: .35 }); const inn = eOut((lt - .05) / .7);
      feed.style.transform = `perspective(2600px) translate3d(0,${(1 - inn) * 120 + Math.sin(t * .8) * 5}px,0) rotateX(${lerp(22, 5, inn)}deg) rotateY(${Math.sin(t * .5) * 2.5 - 3}deg)`;
      const n = Math.floor(sat((lt - .2) / Math.max(.3, tp - K.C - .5)) * P.text.length);
      ctext.textContent = dp > 0 ? P.placeholder : P.text.slice(0, n) + (Math.floor(t * 4) % 2 ? '▍' : ''); ctext.style.color = dp > 0 ? '#6a6b6c' : '#fff';
      pub.style.transform = `scale(${dp > -.05 && dp < .12 ? .9 : 1})`; pub.style.filter = dp > 0 && dp < .3 ? 'brightness(1.6)' : 'none';
      const grow = eOut(dp / .4); np.style.maxHeight = (dp > 0 ? grow * 560 : 0) + 'px'; np.style.opacity = dp > 0 ? grow : 0; np.style.marginBottom = (dp > 0 ? grow * 18 : 0) + 'px';
      np.style.boxShadow = `0 0 ${60 * Math.max(0, 1 - dp)}px rgba(61,255,122,${.6 * Math.max(0, 1 - dp)})`;
      const likes = Math.floor(31 * eOut((dp - .4) / 3)); lk.textContent = '♥ ' + Math.max(0, likes); lk.style.color = likes > 0 ? '#ff5a7a' : '';
      cm.textContent = '💬 ' + replies.filter((_, i) => dp > .6 + i * .55).length;
      replies.forEach((e, i) => { const t0 = tp + .6 + i * .55, k = eBack((t - t0) / .35) * (t > t0 ? 1 : 0); e.style.opacity = k > 0 ? (1 - ss(end - .2, end, t)) : 0; e.style.transform = `translate3d(${RP[i][0]}px,${RP[i][1] + Math.sin(t * 1.3 + i * 2) * 6}px,0) rotate(${RP[i][2]}deg) scale(${1.25 * Math.max(k, .001)})`; });
      const cp = eIO((t - (tp - .6)) / .5); cur2.style.opacity = sat((t - (tp - .65)) / .15) * (1 - ss(tp + .35, tp + .6, t));
      cur2.style.transform = `translate3d(${lerp(700, 880, cp)}px,${lerp(520, 300, cp)}px,0) scale(${dp > -.05 && dp < .12 ? .82 : 1})`;
      visWords(h3, t, K.C + .25, end, .05);
      chips.style.opacity = t > K.chips ? (1 - ss(end - .2, end, t)) : 0; [...chips.children].forEach((c, i) => { const k = eBack((t - K.chips - i * .45) / .3) * (t > K.chips + i * .45 ? 1 : 0); c.style.transform = `scale(${Math.max(k, .001)})`; });
      o.flash = Math.max(0, 1 - Math.abs(dp - .05) / .1) * .16; cut(K.C); cut(K.D);
    }
    if (sc === 'D') {
      grp.NET.visible = true; const lt = t - K.D, to = K.offTry, dk = t - to;
      NET.g.rotation.set(.15, t * .12, 0); NET.g.updateMatrixWorld(true);
      const dip = dk > 0 ? Math.max(0, 1 - dk / .4) : 0; NET.update(t, 1, 0, 1 - dip * .55);
      netCam(lerp(24, 20, eOut(lt / 3)), lt * .08, 1.5, V(0, -2.6, 0));
      if (dk > .4) { NET.ring(0, V(0, 0, 0), dk - .4, 11, GREEN, 1.3); NET.ring(1, V(0, 0, 0), dk - .7, 14, GREEN, 1.4); o.flash = Math.max(0, 1 - Math.abs(dk - .45) / .12) * .3; }
      visWords(h4, t, K.D + .2, K.G - .12, .05);
      vis(swD, t, K.D + .15, K.G - .12, { dy: 40, in: .3 });
      const o1 = eOut(sat(dk / .12)), back = eBack(sat((dk - .38) / .28)), pos = dk < .38 ? o1 : 1 - back;
      dKnob.style.left = lerp(60, 6, pos) + 'px'; dTog.style.background = pos > .5 ? '#ff3b4e' : '#2bd566';
      swD.style.transform += ` translateX(${dk > .38 && dk < .9 ? Math.sin(dk * 60) * 10 * (1 - (dk - .38) / .52) : 0}px)`;
      const cp = eIO((t - (to - .65)) / .55); curD.style.opacity = sat((t - (to - .7)) / .15) * (1 - ss(to + .9, to + 1.2, t));
      curD.style.transform = `translate3d(${lerp(620, 800, cp)}px,${lerp(1880, 1688, cp)}px,0) scale(${dk > -.05 && dk < .12 ? .82 : 1})`;
      const st = eBack((dk - .45) / .28) * (dk > .45 ? 1 : 0); nope.style.opacity = st > 0 ? (1 - ss(K.G - .3, K.G - .12, t)) : 0;
      nope.style.transform = `translate3d(400px,1420px,0) rotate(-7deg) scale(${lerp(2.4, 1.3, Math.min(st, 1))})`;
      cut(K.D); cut(K.G);
    }
    if (sc === 'G') { const lt = t - K.G; endCard(lt, eLogo, eTag, eUrl, eNote, t); cut(K.G); o.bloom = .55; o.flash = Math.max(0, 1 - lt / .16) * .3; o.fade = (o.fade ?? 1) * (1 - ss(K.END - .5, K.END - .05, t)); }
    finish(o);
  };
} else {
  // ------------------------------------------------------------------ PHONK
  const BT = 60 / CUE.bpm, BAR = BT * 4, PH = T.phonk;
  const chipT = el('div', 'abs center pchip them', PH.them), chipU = el('div', 'abs center pchip us', 'INTERPOLL');
  const intro1 = el('div', 'abs center ptext them', PH.them), intro2 = el('div', 'abs center pvs', 'VS');
  const dropLogo = el('div', 'abs center', '<span id="logo">Interpoll</span>'); dropLogo.id = 'logoWrap';
  const pairs = PH.pairs.map(p => ({
    te: el('div', 'abs center pemoji', p.e), tt: el('div', 'abs center ptext them', p.them), ts: el('div', 'abs center psub them', p.themSub || ''),
    ut: el('div', 'abs center ptext us', p.us), us: el('div', 'abs center psub us', p.usSub || ''), uc: el('div', 'abs center pcheck', '✓')
  }));
  const sw = el('div', 'abs sw', swHTML(T.swLab, T.swName)); const tog = sw.querySelector('.tog'), knob = sw.querySelector('.knob'), swName = sw.querySelector('.name');
  const swD = el('div', 'abs sw', swHTML(T.swLab2, T.swName2)); const dTog = swD.querySelector('.tog'), dKnob = swD.querySelector('.knob');
  const out1 = el('div', 'abs center ptext us', PH.out), out1s = el('div', 'abs center psub us', PH.outSub);
  const eLogo = el('div', 'abs center', 'Interpoll'); eLogo.id = 'endLogo';
  const eTag = el('div', 'abs center', PH.tag); eTag.id = 'endTag';
  const eUrl = el('div', 'abs center', '<span>endless.social</span>'); eUrl.id = 'endUrl';
  const eNote = el('div', 'abs center', T.g2); eNote.id = 'endNote';
  const slam = (e, l, y, o = {}) => { // l = seconds since slam
    if (l < 0) { e.style.opacity = 0; return; }
    const k = eOut(l / .13), sh = Math.max(0, 1 - l / .25) * (o.shake ?? 14);
    e.style.opacity = 1; e.style.top = y + 'px';
    e.style.transform = `translate3d(${Math.sin(l * 90) * sh}px,${Math.cos(l * 70) * sh}px,0) scale(${lerp(o.from ?? 2.4, 1, k) + (o.drift ?? .02) * l}) rotate(${o.rot ?? 0}deg)`;
  };
  frame = t => {
    base(t); const o = {};
    const b = Math.floor(t / BAR), lb = t - b * BAR, beat = Math.floor(lb / BT), lbt = lb - beat * BT, pulse = Math.exp(-lbt * 9);
    const themLook = () => {
      grp.A.visible = true; A.AP.kill = 1e9; A.AP.a2 = -1; A.AP.B = 1e9; A.update(4 + t * .35);
      cam.position.multiplyScalar(1.2 - lb * .03); cam.lookAt(0, 1.5, 0);
      o.desat = .96; o.tint = [.82, .8, .86]; o.bgA = .1; o.glitch = .12 + (lbt < .05 ? .25 : 0); o.bloom = .5; o.fade = .8;
    };
    const usLook = (rot = 0) => {
      grp.NET.visible = true; NET.g.rotation.set(.3 + rot * .7, t * .5 + rot * 1.9, rot * .4); NET.g.updateMatrixWorld(true); NET.update(t * 1.6, 1, 0, .75);
      netCam(15 - lb * 1.4 - pulse * 1.6, rot * 2.1 + lb * .15, [0, 2, -2, 1][rot % 4], V(0, 0, 0)); cam.fov = 42 - pulse * 5;
      o.flash = (beat === 0 ? Math.max(0, 1 - lbt / .12) * .55 : pulse * .1); o.ca = 1 + pulse * 7; o.bloom = 1 + pulse * .5;
      NET.ring(0, V(0, 0, 0), lb, 14, GREEN, .9);
    };
    if (b < 2) {
      themLook(); o.fade = .8 * ss(0, .5, t);
      intro1.style.opacity = 1; intro1.style.top = '760px'; intro1.style.fontSize = LANG === 'fr' ? '84px' : '104px'; intro1.style.letterSpacing = lerp(.3, .02, eOut(t / 1.2)) + 'em'; intro1.style.transform = `scale(${1 + t * .015})`;
      if (b === 1) { slam(intro2, lb, 1010, { from: 1.8, shake: 6 }); o.glitch = .15 + ss(BAR * .5, BAR, lb) * .8; if (lb > BAR - BT * .5) { o.fade = 0; intro1.style.opacity = intro2.style.opacity = 0; } }
    } else if (b === 2) {
      usLook(0); slam(dropLogo, lb, 700, { from: 3, shake: 22 }); dropLogo.style.transform += ` scale(${1 + pulse * .06})`;
      slam(chipU, lb - BT * 2, 1090, { from: 2, shake: 8 }); chipU.textContent = PH.ours;
    } else if (b < 3 + PH.pairs.length * 2) {
      const pi = (b - 3) >> 1, side = (b - 3) & 1, p = pairs[pi];
      if (!side) {
        themLook(); chipT.style.opacity = 1; chipT.style.top = '170px'; chipT.style.transform = 'none';
        slam(p.te, lb, 430, { from: 1.4, shake: 3, drift: .03 }); slam(p.tt, lb - .08, 760, { from: 1.25, shake: 3, drift: .025 }); slam(p.ts, lb - BT * 2, 1240, { from: 1.2, shake: 2 });
        if (PH.pairs[pi].sw) { sw.style.opacity = 1; sw.style.transform = 'scale(1.35)'; const off = sat((lb - BT * 2) / .12); knob.style.left = lerp(60, 6, eOut(off)) + 'px'; tog.style.background = off > 0 ? '#ff3b4e' : '#2bd566'; swName.textContent = off > 0 ? T.swOff : T.swName; swName.style.color = off > 0 ? '#ff6b78' : '#fff'; if (off > 0) { o.glitch = Math.max(.12, 1 - (lb - BT * 2) / .4); o.fade = .8 * lerp(1, .45, sat((lb - BT * 2) / .6)); } }
      } else {
        usLook(pi + 1); chipU.textContent = 'INTERPOLL'; chipU.style.opacity = 1; chipU.style.top = '170px'; chipU.style.transform = `scale(${1 + pulse * .05})`;
        slam(p.uc, lb, 400, { from: 3, shake: 10 }); slam(p.ut, lb, 740, { from: 2.6, shake: 20 }); p.ut.style.transform += ` scale(${1 + pulse * .035})`;
        slam(p.us, lb - BT * 2, 1250, { from: 2, shake: 8 });
        if (PH.pairs[pi].sw) { swD.style.opacity = 1; const dk = lb - BT * 2, o1 = eOut(sat(dk / .1)), back = eBack(sat((dk - .25) / .22)), pos = dk < 0 ? 0 : dk < .25 ? o1 : 1 - back; dKnob.style.left = lerp(60, 6, pos) + 'px'; dTog.style.background = pos > .5 ? '#ff3b4e' : '#2bd566'; swD.style.transform = `scale(1.35) translateX(${dk > .25 && dk < .7 ? Math.sin(dk * 60) * 9 : 0}px)`; }
      }
    } else if (b === 3 + PH.pairs.length * 2) {
      usLook(5); slam(out1, lb, 700, { from: 2.6, shake: 20 }); out1.style.transform += ` scale(${1 + pulse * .035})`; slam(out1s, lb - BT * 2, 1180, { from: 2, shake: 8 });
    } else {
      const lt = t - (4 + PH.pairs.length * 2) * BAR; endCard(lt, eLogo, eTag, eUrl, eNote, t);
      FROG.frog.rotation.z += Math.sin(t / BT * Math.PI) * .06; FROG.frog.position.y += pulse * .12;
      o.bloom = .55 + pulse * .2; o.flash = Math.max(0, 1 - lt / .14) * .5 + pulse * .04; o.ca = 1 + pulse * 3; cam.fov = 40 - pulse * 1.5;
      o.fade = 1 - ss(CUE.END - .6, CUE.END - .05, t);
    }
    finish(o);
  };
}
window.renderFrame = t => { frame(t); renderer.getContext().finish(); };
window.CUE = CUE; window.ready = true;
