import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CUE, TXT } from './config.js';

await Promise.all(['800 80px Inter', '700 40px Inter', '600 30px Inter', '400 20px Inter', '500 20px "Geist Mono"', '400 20px "Geist Mono"', '400 200px "Grand Hotel"'].map(f => document.fonts.load(f)));
await document.fonts.ready;
const W = 1920, H = 1080;
const LANG = new URLSearchParams(location.search).get('lang') || 'en';
const T = TXT[LANG];
document.documentElement.style.setProperty('--hs', LANG === 'fr' ? '68px' : '80px'); document.documentElement.style.setProperty('--kb', LANG === 'fr' ? '290px' : '316px');
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
    float band=floor(uv.y*26.+floor(uT*24.)*3.1);
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

// =====================================================================
// SCENE A — the problem
// =====================================================================
CUR = 'A';
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
  // DOM
  const h1 = headline('h lower red', T.a1), h3 = headline('h lower red', T.a3);
  const chips = el('div', 'abs', T.chips.map(c => `<span class="chip"><b>×</b> ${c}</span>`).join('')); chips.style.cssText = 'left:110px;bottom:118px';
  const sw = el('div', 'abs', `<div class="lab">${T.swLab}</div><div class="row"><div class="name">${T.swName}</div><div class="tog"><div class="knob"></div></div></div>`); sw.id = 'sw';
  const tog = sw.querySelector('.tog'), knob = sw.querySelector('.knob'), swName = sw.querySelector('.name');
  const cur = el('div', 'abs', '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M4 2l15 9-7 1.5L8.5 20z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>'); cur.id = 'cur';
  return {
    g, update(t) {
      const k = CUE.kill, dt = t - k, dead = dt > 0;
      mono.material.emissive.setRGB(0, 0, 0);
      const ledOn = dead ? (dt < .12 ? 3 : Math.max(0, (dt < .5 ? (Math.sin(dt * 90) > 0 ? .7 : 0) : 0))) : 1 + .25 * Math.sin(t * 7);
      ledMat.color.setRGB(1 * ledOn, .27 * ledOn, .33 * ledOn);
      halo.material.opacity = dead ? Math.max(0, .5 - dt * 2) : .42 + .06 * Math.sin(t * 2);
      lm.opacity = dead ? Math.max(0, .5 - dt * 3) : .13 * ss(0, 1.5, t);
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
      const ang = -.5 + t * .05, dist = lerp(19, 12.5, eIO(t / CUE.B));
      cam.position.set(Math.sin(ang) * dist, 1.8 + t * .08, Math.cos(ang) * dist);
      if (dead && dt < .8) { const s = (1 - dt / .8) * .35; cam.position.x += noise1(t * 30, 1) * s; cam.position.y += noise1(t * 30, 5) * s; }
      cam.lookAt(1.2, .6, 0); cam.fov = 42;
      // DOM
      visWords(h1, t, CUE.a1, CUE.a2 - .1);
      vis(chips, t, CUE.a2, CUE.a3 - .15);
      [...chips.children].forEach((c, i) => { c.style.opacity = eOut((t - CUE.a2 - i * CUE.chipGap) / .35); });
      visWords(h3, t, CUE.a3, CUE.B - .15);
      vis(sw, t, CUE.a3 + .2, CUE.B - .2, { dy: 40 });
      const off = sat((t - k) / .14);
      knob.style.left = lerp(60, 6, eOut(off)) + 'px'; tog.style.background = off > 0 ? '#ff3b4e' : '#2bd566';
      swName.textContent = off > 0 ? T.swOff : T.swName; swName.style.color = off > 0 ? '#ff6b78' : '#fff';
      const cp = eIO((t - (k - 1.1)) / .9); cur.style.opacity = sat((t - (k - 1.2)) / .2) * (1 - ss(k + .5, k + .9, t));
      const press = t > k - .05 && t < k + .12 ? .82 : 1;
      cur.style.transform = `translate3d(${lerp(1500, 1702, cp)}px,${lerp(1010, 872, cp)}px,0) scale(${press})`;
    }
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

CUR = 'B';
// logo DOM (scene B)
const hB = headline('h center', T.b1); hB.style.top = '430px'; hB.style.fontSize = '92px';
const logoWrap = el('div', 'abs center', '<span id="logo">Interpoll</span>'); logoWrap.id = 'logoWrap';
const logoSub = el('div', 'abs center', T.b2); logoSub.id = 'logoSub';

// =====================================================================
// SCENE C — the chain
// =====================================================================
CUR = 'C';
const C = (() => {
  const g = new THREE.Group(); scene.add(g);
  const K = 9, step = 2.5, dir = V(1, 0, -.55).normalize(), BAD = 5; // index 0 = genesis (far), K-1 = newest (near origin)
  const pos = i => dir.clone().multiplyScalar((K - 1 - i) * step);
  const boxG = new THREE.BoxGeometry(1.25, 1.25, 1.25), edgeG = new THREE.EdgesGeometry(boxG), coreG = new THREE.BoxGeometry(.42, .42, .42);
  const blocks = [];
  for (let i = 0; i < K; i++) {
    const b = new THREE.Group(); b.position.copy(pos(i));
    const body = new THREE.Mesh(boxG, new THREE.MeshStandardMaterial({ color: 0x07110b, metalness: .85, roughness: .18, transparent: true, opacity: .72, emissive: 0x3dff7a, emissiveIntensity: .04 }));
    const edge = new THREE.LineSegments(edgeG, new THREE.LineBasicMaterial({ color: 0x3dff7a, transparent: true, blending: THREE.AdditiveBlending }));
    const edge2 = new THREE.LineSegments(edgeG, new THREE.LineBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: .35, blending: THREE.AdditiveBlending })); edge2.scale.setScalar(1.035);
    const core = new THREE.Mesh(coreG, new THREE.MeshBasicMaterial({ color: 0x9dffc0 }));
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0x3dff7a, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false })); gl.scale.setScalar(3.2);
    b.add(body, edge, edge2, core, gl); g.add(b); blocks.push({ b, body, edge, edge2, core, gl });
  }
  // links
  const linkG = new THREE.CylinderGeometry(.035, .035, step - 1.25, 8); linkG.rotateZ(Math.PI / 2);
  const links = [];
  for (let i = 0; i < K - 1; i++) {
    const m = new THREE.Mesh(linkG, new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true }));
    m.position.copy(pos(i)).lerp(pos(i + 1), .5); m.rotation.y = Math.atan2(-dir.z, dir.x) ; g.add(m);
    const pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xbfffd6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); pulse.scale.setScalar(.7); g.add(pulse);
    links.push({ m, pulse });
  }
  // sparks at the break
  const SP = 90, sp = new Float32Array(SP * 3), sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const sr = rng(5), sv = []; for (let i = 0; i < SP; i++) sv.push(V(sr() - .5, sr() - .2, sr() - .5).normalize().multiplyScalar(1.5 + sr() * 4));
  const sparks = new THREE.Points(sg, new THREE.PointsMaterial({ size: .16, map: GLOW, color: 0xff5566, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sparks.frustumCulled = false; g.add(sparks);
  const streak = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(streak);
  // DOM
  const poll = el('div', 'abs', `<div class="meta"><div class="av">S</div><div><b style="color:#fff">swift-bridge-vulture</b> · ${T.pollSpace}</div><span class="tag">${T.pollTag}</span></div>
    <div class="q">${T.pollQ}</div>
    <div class="opt" id="o1"><div class="bar"></div><div class="t">${T.yes}</div><div class="p"></div></div>
    <div class="opt" id="o2"><div class="bar"></div><div class="t">${T.no}</div><div class="p"></div></div>
    <div class="foot"><span id="votes"></span><span id="signed">✓ ${T.signed} · 7F3A-91C2</span></div>`); poll.id = 'poll';
  const o1 = poll.querySelector('#o1'), o2 = poll.querySelector('#o2'), signed = poll.querySelector('#signed'), votes = poll.querySelector('#votes');
  const cur = el('div', 'abs', '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M4 2l15 9-7 1.5L8.5 20z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>');
  const kick = el('div', 'abs kicker', `<i></i>${T.cK}`); kick.style.cssText = 'left:110px;bottom:var(--kb)';
  const h1 = headline('h lower', T.c1), h2 = headline('h lower red', T.c2);
  const hashes = ['genesis', '4be1…a07c', '91d3…5f20', 'c07a…e9b4', '2f6e…118d', '7a90…cc31', 'e3b8…04fa', '5d17…b6e2', '7f3a…91c2'];
  const tags = blocks.map((_, i) => el('div', 'abs tag3d', (i ? '#' + i + ' · ' : '') + hashes[i]));
  const badTag = el('div', 'abs tag3d bad', T.mismatch);
  const newP = pos(K - 1), tmp = V(0, 0, 0);
  return {
    g, update(t) {
      const tv = CUE.vote, tt = CUE.tamper, lt = t - CUE.C;
      const dv = t - tv, dtm = t - tt;
      // camera: near head -> travel along chain -> pull back
      const travel = eIO((t - (tv + 1.0)) / (tt - tv - 1.2)) * (BAD_T()) ;
      function BAD_T() { return 1; }
      const focusIdx = lerp(K - 1, BAD + .3, travel);
      const pull = eIO((t - (tt + 1.6)) / 2.6);
      const f = dir.clone().multiplyScalar((K - 1 - focusIdx) * step);
      const side = V(-dir.z, 0, dir.x); // perpendicular
      const camOff = side.clone().multiplyScalar(lerp(-7.2, -8.5, pull)).add(dir.clone().multiplyScalar(lerp(-5.5 + travel * 3.5, -1, pull))).add(V(0, lerp(1.9, 4.2, pull), 0));
      const look = f.clone().add(dir.clone().multiplyScalar(lerp(1.6 - travel * 1.6, 1.2, pull))).add(side.clone().multiplyScalar(lerp(-2.6 + travel * 1.2, 0, pull)));
      cam.position.copy(f).add(camOff).multiplyScalar(1).add(dir.clone().multiplyScalar(pull * 2));
      const dist = lerp(1, 1.55, pull); cam.position.sub(look).multiplyScalar(dist).add(look);
      cam.position.y += Math.sin(t * .7) * .12;
      if (dtm > 0 && dtm < .7) { const s = (1 - dtm / .7) * .22; cam.position.x += noise1(t * 34, 2) * s; cam.position.y += noise1(t * 34, 9) * s; }
      cam.lookAt(look); cam.fov = 40;
      // blocks
      const brk = sat(dtm / .25);
      blocks.forEach((B, i) => {
        const isNew = i === K - 1, bad = i === BAD, after = i > BAD;
        let s = isNew ? eBack((dv - .55) / .5) * (dv > .55 ? 1 : 0) : eBack((lt - .15 - (K - 2 - i) * .07) / .5);
        B.b.position.copy(pos(i)); B.b.rotation.set(0, 0, 0);
        let c = GREEN, ei = 1 + .25 * Math.sin(t * 2 + i);
        if (dtm > 0) {
          if (bad) { c = RED; ei = 1.6 + Math.sin(t * 40) * .6 * Math.max(0, 1 - dtm); B.b.position.x += noise1(t * 50, i) * .09 * Math.max(0, 1 - dtm * 1.2); B.b.rotation.z = Math.sin(dtm * 3) * .05; }
          else if (after) { const k = sat((dtm - .12 - (i - BAD) * .13) / .3); c = GREEN.clone().lerp(new THREE.Color(1, .35, .25), k); ei = lerp(ei, .55 + .35 * (Math.sin(t * 22 + i * 2) > .2 ? 1 : 0), k); B.b.position.add(dir.clone().multiplyScalar(-k * .5 * (i - BAD))).add(V(0, Math.sin(t * 1.2 + i) * .1 * k - k * .12 * (i - BAD), 0)); B.b.rotation.set(k * .1 * (i - BAD), k * .14, k * -.08 * (i - BAD)); }
        }
        if (isNew && dv > .55 && dv < 1.3) ei += (1 - (dv - .55) / .75) * 3;
        B.b.scale.setScalar(Math.max(s, .0001));
        B.edge.material.color.copy(c).multiplyScalar(ei * 1.3); B.edge2.material.color.copy(c);
        B.core.material.color.copy(c).lerp(WHITE, .5).multiplyScalar(ei); B.core.rotation.set(t * .8 + i, t * 1.1 + i, 0);
        B.gl.material.color.copy(c); B.gl.material.opacity = .32 * ei * (s > 0.01 ? 1 : 0);
        B.body.material.emissive.copy(c); B.body.material.emissiveIntensity = .05 * ei;
      });
      links.forEach((L, i) => {
        const a = blocks[i].b.position, b = blocks[i + 1].b.position;
        const isNewL = i === K - 2; let vsb = isNewL ? sat((dv - .9) / .3) : sat((lt - .6) / .4);
        let c = GREEN; if (i >= BAD && dtm > 0) { c = RED; vsb *= i === BAD ? 1 - brk : Math.max(0, 1 - sat((dtm - .1 - (i - BAD) * .13) / .25)); }
        if (i === BAD - 1 && dtm > 0) c = RED;
        L.m.position.copy(a).lerp(b, .5); L.m.material.color.copy(c).multiplyScalar(1.4); L.m.material.opacity = vsb; L.m.scale.x = vsb > 0 ? 1 : .001;
        const u = ((t * .9 + i * .37) % 1); L.pulse.position.copy(b).lerp(a, u); L.pulse.material.opacity = vsb * Math.sin(u * Math.PI); L.pulse.material.color.copy(c).lerp(WHITE, .5);
      });
      // sparks
      const bp = pos(BAD).clone().lerp(pos(BAD + 1), .5);
      for (let i = 0; i < SP; i++) { const a = Math.max(0, dtm); tmp.copy(bp).addScaledVector(sv[i], a * (1 - a * .25)); tmp.y -= 3 * a * a; sp.set([tmp.x, tmp.y, tmp.z], i * 3); }
      sg.attributes.position.needsUpdate = true; sparks.material.opacity = dtm > 0 ? Math.max(0, 1 - dtm / 1.3) : 0;
      // DOM poll + vote
      const pollOut = tv + 2.6;
      vis(poll, t, CUE.C + .25, pollOut, { dy: 40, out: .5 });
      const voted = dv > 0, bp1 = eOut(dv / .8);
      o1.classList.toggle('sel', voted); o1.querySelector('.bar').style.width = (voted ? bp1 * 64 : 0) + '%'; o2.querySelector('.bar').style.width = (voted ? bp1 * 36 : 0) + '%';
      o1.querySelector('.p').textContent = voted ? Math.round(bp1 * 64) + '%' : ''; o2.querySelector('.p').textContent = voted ? Math.round(bp1 * 36) + '%' : '';
      votes.textContent = (voted ? '1,284 ' : '1,283 ') + T.votes; signed.style.opacity = eOut((dv - .35) / .3); signed.style.transform = `scale(${lerp(1.25, 1, eOut((dv - .35) / .3))})`;
      const cp = eIO((t - (tv - 1.0)) / .85); const press = dv > -.05 && dv < .12 ? .82 : 1;
      cur.style.opacity = sat((t - (tv - 1.05)) / .2) * (1 - ss(tv + .7, tv + 1.1, t));
      cur.style.transform = `translate3d(${lerp(820, 560, cp)}px,${lerp(640, 420, cp)}px,0) scale(${press})`;
      // streak from the poll card to the new block
      if (dv > .1 && dv < .75) {
        const k = eIO((dv - .1) / .55); const from = V(0, 0, 0).copy(cam.position).add(V(-.32, .12, -1).applyQuaternion(cam.quaternion).multiplyScalar(6));
        streak.position.copy(from).lerp(newP, k); streak.position.y += Math.sin(k * Math.PI) * .8; streak.material.opacity = 1; streak.scale.setScalar(lerp(1.2, 2.6, k));
      } else streak.material.opacity = 0;
      // 3D tags
      tags.forEach((e, i) => {
        const B = blocks[i], p = place(e, B.b.position.clone().add(V(0, -1.05, 0)));
        const on = (i === K - 1 ? sat((dv - 1) / .3) : sat((t - (tv + 1.6) - (K - 2 - i) * .12) / .3)) * (p.z < 1 ? 1 : 0) * (1 - ss(CUE.D - .5, CUE.D - .2, t));
        e.style.opacity = on * (p.x > 860 || t > pollOut ? 1 : 0) * (p.y > 700 && p.x < 1500 ? 0 : 1); e.classList.toggle('warn', dtm > .2 && i >= BAD);
        if (dtm > 0 && i === BAD) e.textContent = '#' + i + ' · ' + (Math.floor(t * 14) % 2 ? '0000…dead' : 'f00d…????');
      });
      const pb = place(badTag, blocks[BAD].b.position.clone().add(V(0, 1.25, 0)));
      badTag.style.opacity = dtm > .1 ? (Math.sin(t * 16) > -.6 ? 1 : .55) * (1 - ss(CUE.D - .5, CUE.D - .2, t)) : 0;
      // text
      vis(kick, t, tv + 2.2, CUE.D - .2);
      visWords(h1, t, tv + 2.3, tt - .1);
      visWords(h2, t, tt + .15, CUE.D - .2);
    }
  };
})();

// =====================================================================
// SCENE D — network text
// =====================================================================
CUR = 'D';
const kickD = el('div', 'abs kicker', `<i></i>${T.dK}`); kickD.style.cssText = 'left:110px;bottom:var(--kb)';
const hD1 = headline('h lower', T.d1), hD2 = headline('h lower', T.d2);
const relayTag = el('div', 'abs tag3d', T.relayTag), deadTag = el('div', 'abs tag3d bad', T.relayDown), youTag = el('div', 'abs tag3d', T.youTag);

// =====================================================================
// SCENE E — encryption
// =====================================================================
CUR = 'E';
const Ecr = (() => {
  const g = new THREE.Group(); scene.add(g);
  // glyph atlas 8x8 : 0..31 plain letters, 32..47 hex
  const ac = document.createElement('canvas'); ac.width = ac.height = 512; const x = ac.getContext('2d');
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '500 50px "Geist Mono"';
  const plain = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ?!@&#+', hex = '0123456789abcdef';
  for (let i = 0; i < 48; i++) { const ch = i < 32 ? plain[i] : hex[i - 32]; x.fillText(ch, (i % 8) * 64 + 32, ((i / 8) | 0) * 64 + 34); }
  const atlas = new THREE.CanvasTexture(ac);
  const N = 420, r = rng(21), base = new THREE.PlaneGeometry(.34, .34), ig = new THREE.InstancedBufferGeometry();
  ig.index = base.index; ig.setAttribute('position', base.attributes.position); ig.setAttribute('uv', base.attributes.uv);
  const a1 = new Float32Array(N * 4); for (let i = 0; i < N; i++) { const an = r() * 6.283, rad = Math.sqrt(r()); a1.set([r(), Math.cos(an) * rad, Math.sin(an) * rad, r()], i * 4); }
  ig.setAttribute('aI', new THREE.InstancedBufferAttribute(a1, 4)); ig.instanceCount = N;
  const gm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uT: { value: 0 }, uMap: { value: atlas }, uA: { value: 1 }, uGate: { value: 3.6 } },
    vertexShader: `attribute vec4 aI;uniform float uT,uGate;varying vec2 vUv;varying float vEnc,vA;
    void main(){float u=fract(aI.x+uT*(.07+aI.w*.035));float X=mix(-9.5,9.5,u);
      float enc=step(-uGate,X)*step(X,uGate);
      float w=mix(1.25,.5,smoothstep(uGate+2.5,uGate-.4,abs(X)))+.55*smoothstep(1.8,0.,abs(X));
      vec3 p=vec3(X,aI.y*w+.25*sin(X*.7+uT+aI.w*6.),aI.z*w);
      float g=enc>.5?32.+floor(mod(aI.w*16.+floor(uT*(9.+aI.w*9.)),16.)):floor(aI.w*31.99);
      vUv=(vec2(mod(g,8.),7.-floor(g/8.))+uv)/8.;vEnc=enc;
      vA=smoothstep(0.,.06,u)*smoothstep(1.,.94,u)*(.55+.45*aI.w);
      vec4 mv=modelViewMatrix*vec4(p,1.);mv.xy+=position.xy*(enc>.5?.85:1.15);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform sampler2D uMap;uniform float uA;varying vec2 vUv;varying float vEnc,vA;
    void main(){float a=texture2D(uMap,vUv).r;vec3 c=mix(vec3(.8,.78,.72),vec3(.15,.95,.38),vEnc);gl_FragColor=vec4(c*a*vA*uA*.75,1.);}` });
  const glyphs = new THREE.Mesh(ig, gm); glyphs.frustumCulled = false; g.add(glyphs);
  // gates
  const gates = [-3.6, 3.6].map(xp => {
    const G = new THREE.Group(); G.position.x = xp; G.rotation.y = Math.PI / 2;
    const m1 = new THREE.Mesh(new THREE.TorusGeometry(1.35, .035, 12, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(.5, 2.2, 1) }));
    const m2 = new THREE.Mesh(new THREE.TorusGeometry(1.6, .012, 8, 96, Math.PI * 1.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(.3, 1.4, .6) }));
    const m3 = new THREE.Mesh(new THREE.TorusGeometry(1.82, .012, 8, 96, Math.PI * .8), new THREE.MeshBasicMaterial({ color: new THREE.Color(.3, 1.4, .6) }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.33, 64), new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: .07, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    G.add(m1, m2, m3, disc); g.add(G); return { G, m2, m3 };
  });
  // relay in the middle
  const relay = new THREE.Mesh(new THREE.OctahedronGeometry(1.05, 0), new THREE.MeshStandardMaterial({ color: 0x08130d, metalness: .9, roughness: .15, emissive: 0x3dff7a, emissiveIntensity: .12, flatShading: true, transparent: true, opacity: .8 }));
  const relayW = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(1.32, 0)), new THREE.LineBasicMaterial({ color: new THREE.Color(.4, 1.8, .8), transparent: true, blending: THREE.AdditiveBlending }));
  const relayW2 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.9, 1)), new THREE.LineBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: .22, blending: THREE.AdditiveBlending }));
  g.add(relay, relayW, relayW2);
  // DOM
  const bL = el('div', 'abs bubble', `<div class="who"><span>${T.you}</span><span>● ${T.device}</span></div><div class="msg"></div>`); bL.id = 'bubL';
  const bR = el('div', 'abs bubble rx', `<div class="who"><span>${T.friend}</span><span>● ${T.device}</span></div><div class="msg"></div>`); bR.id = 'bubR';
  const sees = el('div', 'abs center', ''); sees.id = 'sees';
  const aes = el('div', 'abs center', `<span>AES-256-GCM · ${T.keys}</span>`); aes.id = 'aes';
  const kick = el('div', 'abs kicker', `<i></i>${T.eK}`); kick.style.cssText = 'left:110px;bottom:' + (LANG === 'fr' ? 196 : 210) + 'px';
  const h1 = headline('h lower', T.e1), h2 = headline('h lower', T.e2); h1.style.bottom = h2.style.bottom = '100px';
  const hr = rng(99); const HEX = '0123456789abcdef';
  return {
    g, update(t) {
      const lt = t - CUE.E, dur = CUE.F - CUE.E;
      gm.uniforms.uT.value = t; gm.uniforms.uA.value = ss(0, .8, lt);
      gates.forEach((G, i) => { G.m2.rotation.z = t * (i ? -.9 : .9); G.m3.rotation.z = -t * (i ? -.5 : .5) + 1; G.G.scale.setScalar(eBack((lt - .1 - i * .15) / .6) * (1 + .03 * Math.sin(t * 5))); });
      relay.rotation.set(t * .3, t * .45, 0); relayW.rotation.copy(relay.rotation); relayW2.rotation.set(-t * .12, t * .1, 0);
      const s = eBack((lt - .2) / .7); relay.scale.setScalar(s); relayW.scale.setScalar(s); relayW2.scale.setScalar(s);
      const a = -.42 + .5 * eIO(lt / dur);
      cam.position.set(Math.sin(a) * 13.2, 1.2 + lt * .08, Math.cos(a) * 13.2); cam.lookAt(0, -.75, 0); cam.fov = 40;
      // DOM
      vis(bL, t, CUE.E + .3, CUE.F - .2); vis(bR, t, CUE.E + 1.5, CUE.F - .2);
      const msg = T.msg, n = Math.floor(sat((lt - .6) / 1.3) * msg.length); bL.querySelector('.msg').textContent = msg.slice(0, n) + (n < msg.length && lt > .6 ? '▍' : '');
      const dec = sat((lt - 2.3) / 1.0); let out = '';
      for (let i = 0; i < msg.length; i++) out += i < dec * msg.length ? msg[i] : (msg[i] === ' ' ? ' ' : HEX[(Math.floor(t * 20) * 7 + i * 13) % 16]);
      bR.querySelector('.msg').textContent = lt > 1.7 ? out : '';
      let hx = ''; for (let i = 0; i < 14; i++) hx += HEX[(Math.floor(t * 12 + i * 3.3) * (i + 3) * 7) % 16] + HEX[(Math.floor(t * 12 + i) * (i + 5) * 11) % 16] + ' ';
      sees.innerHTML = `${T.sees} <b>${hx}</b>`; vis(sees, t, CUE.E + 1.3, CUE.F - .2, { dy: 0 });
      vis(aes, t, CUE.E + .9, CUE.F - .2, { dy: -20 });
      vis(kick, t, CUE.E + .5, CUE.F - .2);
      visWords(h1, t, CUE.E + .6, CUE.e2 - .1); visWords(h2, t, CUE.e2 + .1, CUE.F - .2);
    }
  };
})();

// =====================================================================
// SCENE F — beats
// =====================================================================
CUR = 'F';
const beats = T.beats.map((b, i) => {
  const e = el('div', 'abs center beat' + (i === 3 ? ' ok' : ''), i === 3 ? b : `${b[0]} <span class="no">${b[1]}<s></s></span>.`); return e;
});

// =====================================================================
// SCENE G — end card with Bit the frog
// =====================================================================
CUR = 'G';
const G = (() => {
  const g = new THREE.Group(); scene.add(g);
  const BODY = ['..GG....GG..', '.GWWG..GWWG.', '.GKWG..GKWG.', 'GGGGGGGGGGGG', 'GGGGGGGGGGGG', 'GPPGGGGGGPPG', 'GGGKGGGGKGGG', 'GGGGKKKKGGGG', '.GGGGGGGGGG.', '.GG.GGGG.GG.', '.DD......DD.'];
  const COL = { G: 0x3dff7a, D: 0x1f9e4b, W: 0xffffff, K: 0x05080a, P: 0xff8fb3, Y: 0xffd84a };
  const cells = []; BODY.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') cells.push({ x, y, c }); }));
  cells.push({ x: 11, y: 2, c: 'G', arm: 1 }, { x: 11, y: 1, c: 'G', arm: 1 }, { x: 11, y: 0, c: 'Y', arm: 1 });
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(.94, .94, 1), new THREE.MeshStandardMaterial({ roughness: .35, metalness: .1, emissive: 0xffffff, emissiveIntensity: 0 }), cells.length);
  m.material.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = diffuseColor.rgb*.42; diffuseColor.rgb*=.3;'); };
  const frog = new THREE.Group(); frog.add(m); g.add(frog);
  const o = new THREE.Object3D(), col = new THREE.Color(), rr = rng(4); const dl = cells.map(() => rr());
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0x3dff7a, transparent: true, opacity: .0, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.setScalar(9); g.add(halo);
  const logo = el('div', 'abs center', 'Interpoll'); logo.id = 'endLogo';
  const tag = headline('center', T.g1); tag.id = 'endTag'; tag.classList.add('abs');
  const url = el('div', 'abs center', '<span>endless.social</span>'); url.id = 'endUrl';
  const note = el('div', 'abs center', T.g2); note.id = 'endNote';
  return {
    g, update(t) {
      const lt = t - CUE.G;
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
      vis(logo, t, CUE.G + .7, 999, { in: .9, scale: 1.12, dy: 20 });
      visWords(tag, t, CUE.g1, 999, .08);
      vis(url, t, CUE.g2 - .2, 999, { in: .6, scale: .85, dy: 30 });
      const pulse = 1 + .025 * Math.sin((t - CUE.g2) * 5); url.firstChild.style.transform = `scale(${pulse})`;
      vis(note, t, CUE.g2 + .5, 999);
    }
  };
})();

// =====================================================================
// master timeline
// =====================================================================
const groups = { A: A.g, NET: NET.g, C: C.g, E: Ecr.g, G: G.g };
const camT = V(0, 0, 0);
function frame(t) {
  const u = fx.uniforms;
  u.uT.value = t; bg.material.uniforms.uT.value = t; dust.rotation.y = t * .012; dust.position.y = Math.sin(t * .1) * .5;
  const sc = t < CUE.B ? 'A' : t < CUE.C ? 'B' : t < CUE.D ? 'C' : t < CUE.E ? 'D' : t < CUE.F ? 'E' : t < CUE.G ? 'F' : 'G';
  groups.A.visible = sc === 'A'; groups.C.visible = sc === 'C'; groups.E.visible = sc === 'E'; groups.G.visible = sc === 'G';
  groups.NET.visible = sc === 'B' || sc === 'D' || sc === 'F' || sc === 'G';
  NET.rings.forEach(r => r.material.opacity = 0); NET.core.material.opacity = 0;
  let fade = 1, glitch = 0, flash = 0, desat = 0, bgA = 1, tint = [1, 1, 1], bloomS = .85;
  const cut = (tc, w = .22) => { fade *= ss(0, w, Math.abs(t - tc)); };
  for (const e of REG) if (e._sc !== sc && e._sc !== 'X') e.style.opacity = 0;
  scrimC.style.opacity = 0; scrimL.style.opacity = 0; scrimB.style.opacity = 0;
  NET.g.position.set(0, 0, 0); NET.g.scale.setScalar(1);

  if (sc === 'A') {
    A.update(t); fade *= ss(0, .9, t); desat = .25; tint = [1.04, .97, 1.0]; bgA = .25;
    const dk = t - CUE.kill; if (dk > 0) { glitch = Math.max(0, 1 - dk / .55); fade *= lerp(1, .0, ss(.9, CUE.B - CUE.kill - .1, dk)); desat = lerp(.25, .9, sat(dk * 3)); }
    scrimB.style.opacity = .9;
  }
  if (sc === 'B') {
    const lt = t - CUE.B, tl = CUE.logo;
    NET.g.rotation.set(.15, t * .07, 0); NET.g.updateMatrixWorld(true);
    const grow = eIO((t - (tl - .9)) / 3.4) * .95;
    NET.update(t, Math.max(grow, lt > .5 ? .012 : 0), 0, lerp(1, .5, ss(tl, tl + 1.2, t)));
    const sp = NET.world(NET.seed), n = sp.clone().normalize();
    const pull = eIO((t - (tl - .9)) / 3.0);
    cam.position.copy(sp).add(n.clone().multiplyScalar(lerp(3.2, 12.5, pull))); camT.copy(sp).lerp(V(0, 0, 0), pull); cam.lookAt(camT); cam.fov = 42;
    NET.core.position.copy(NET.pts[NET.seed]); NET.core.material.color.copy(GREEN); NET.core.material.opacity = ss(.4, 1.2, lt) * (.7 + .3 * Math.sin(t * 5)) * (1 - pull * .7); NET.core.scale.setScalar(1.6 + Math.sin(t * 5) * .2);
    for (let i = 0; i < 3; i++) NET.ring(i, sp, (lt - .6 - i * 1.25) % 3.75, 2.4, GREEN, 2.2);
    NET.ring(3, sp, t - (tl - .9), 16, GREEN, 1.6);
    fade *= ss(0, .5, lt); bgA = lerp(.2, 1, pull);
    flash = Math.max(0, 1 - Math.abs(t - tl) / .12) * .35;
    visWords(hB, t, CUE.b1, tl - .7);
    vis(logoWrap, t, tl, CUE.C - .2, { in: .9, scale: 1.25, dy: 0 }); vis(logoSub, t, tl + .7, CUE.C - .2);
    scrimC.style.opacity = ss(tl - .3, tl + .5, t) * (1 - ss(CUE.C - .4, CUE.C, t));
    cut(CUE.C);
  } else { hB.style.opacity = 0; logoWrap.style.opacity = 0; logoSub.style.opacity = 0; }
  if (sc === 'C') { C.update(t); cut(CUE.C); cut(CUE.D); scrimB.style.opacity = ss(CUE.vote + 2, CUE.vote + 2.6, t); const dtm = t - CUE.tamper; if (dtm > 0) { glitch = Math.max(0, 1 - dtm / .4) * .8; } }
  if (sc === 'D') {
    const lt = t - CUE.D, dk = t - CUE.relayKill;
    NET.g.rotation.set(.15, t * .07, 0); NET.g.updateMatrixWorld(true);
    NET.update(t, 1, dk > 0 ? sat(dk / 1.6) : 0, 1);
    const kp = NET.world(NET.KILL), n = kp.clone().normalize();
    const zoom = eIO((t - (CUE.relayKill - 2.2)) / 2.2) * (1 - eIO((t - (CUE.relayKill + 1.5)) / 2.2) * .55);
    const right = V(0, 1, 0).cross(n).normalize();
    const far = n.clone().applyAxisAngle(V(0, 1, 0), -.9 + lt * .03).multiplyScalar(17).add(V(0, 2.5, 0));
    const near = kp.clone().add(n.clone().multiplyScalar(6.2)).add(right.clone().multiplyScalar(-2.2)).add(V(0, 1.2, 0));
    cam.position.copy(far).lerp(near, zoom);
    camT.copy(V(0, 0, 0)).addScaledVector(right, -4.2).lerp(kp.clone().addScaledVector(right, -1.9), zoom); cam.lookAt(camT); cam.fov = 42;
    if (dk > 0 && dk < .6) { const s = (1 - dk / .6) * .2; cam.position.x += noise1(t * 30, 1) * s; cam.position.y += noise1(t * 30, 4) * s; glitch = (1 - dk / .6) * .5; }
    NET.core.position.copy(NET.pts[NET.KILL]); NET.core.material.color.copy(RED); NET.core.material.opacity = dk > 0 ? Math.max(0, 1 - dk / 1.8) : 0; NET.core.scale.setScalar(3.5);
    NET.ring(0, kp, dk, 5, RED, 1.2); NET.ring(1, kp, dk - .25, 8, RED, 1.4);
    scrimL.style.opacity = 1; cut(CUE.D); cut(CUE.E);
    vis(kickD, t, CUE.D + .4, CUE.E - .2);
    visWords(hD1, t, CUE.D + .5, CUE.relayKill - .2, .06); visWords(hD2, t, CUE.relayKill + .2, CUE.E - .2);
    // tags
    const rp = place(relayTag, NET.world(NET.relayIdx[4]), 0, -44); relayTag.style.opacity = ss(1.2, 1.6, lt) * (1 - ss(CUE.relayKill - 2.4, CUE.relayKill - 2, t)) * (rp.x > 800 && rp.z < 1 ? 1 : 0);
    const yp = place(youTag, NET.world(20), 0, -36); youTag.style.opacity = ss(.8, 1.2, lt) * (1 - ss(CUE.relayKill - 2.4, CUE.relayKill - 2, t)) * (yp.x > 800 && yp.z < 1 ? 1 : 0);
    place(deadTag, kp, 0, -70); deadTag.style.opacity = dk > .1 ? (1 - ss(CUE.E - .5, CUE.E - .2, t)) : 0;
  } else { kickD.style.opacity = hD1.style.opacity = hD2.style.opacity = relayTag.style.opacity = deadTag.style.opacity = youTag.style.opacity = 0; }
  if (sc === 'E') { Ecr.update(t); cut(CUE.E); cut(CUE.F, .15); scrimB.style.opacity = .85; bgA = .6; }
  if (sc === 'F') {
    const bt = CUE.beats; let bi = 0; for (let i = 0; i < 4; i++) if (t >= bt[i]) bi = i;
    const lb = t - bt[bi];
    NET.g.rotation.set(.3 + bi * .5, t * .35 + bi * 1.7, bi * .4); NET.g.updateMatrixWorld(true);
    NET.update(t, 1, 0, bi === 3 ? .8 : .4);
    const d = [9, 7.5, 6.5, 13][bi] - lb * 1.2; const an = bi * 2.1;
    cam.position.set(Math.sin(an) * d, [1, -2, 2.5, 0][bi], Math.cos(an) * d); cam.lookAt(0, 0, 0); cam.fov = 42;
    flash = Math.max(0, 1 - lb / .14) * (bi === 3 ? .5 : .22);
    beats.forEach((e, i) => {
      const end = i < 3 ? bt[i + 1] : CUE.G; const on = t >= bt[i] && t < end;
      e.style.opacity = on ? 1 : 0; if (!on) return; const l = t - bt[i];
      e.style.transform = `scale(${lerp(1.35, 1, eOut(l / .3)) + l * .012})`;
      const s = e.querySelector('s'); if (s) s.style.width = eOut((l - .4) / .2) * 104 + '%';
    });
    scrimC.style.opacity = .9; cut(CUE.G, .18);
    
  } else beats.forEach(e => e.style.opacity = 0);
  if (sc === 'G') {
    const lt = t - CUE.G;
    NET.g.rotation.set(.2, t * .05, 0); NET.g.scale.setScalar(2.1); NET.g.position.set(0, 0, -12); NET.g.updateMatrixWorld(true);
    NET.update(t, 1, 0, .5);
    G.update(t);
    cam.position.set(Math.sin(lt * .12) * .6, .3, lerp(17, 14.5, eOut(lt / 6))); cam.lookAt(0, .2, 0); cam.fov = 40;
    cut(CUE.G, .18); scrimC.style.opacity = .75; bloomS = .55; fade *= 1 - ss(CUE.END - .7, CUE.END - .05, t);
    flash = Math.max(0, 1 - lt / .18) * .3;
  }
  u.uFade.value = fade; u.uGlitch.value = glitch; u.uFlash.value = flash; u.uDesat.value = desat; u.uTint.value.setRGB(...tint);
  bg.material.uniforms.uA.value = bgA; bloom.strength = bloomS;
  ui.style.opacity = sc === 'A' ? Math.min(1, fade * 1.5 + .0) : 1;
  cam.updateProjectionMatrix();
  composer.render();
}


// atlas was drawn before fonts were guaranteed: nothing to redo if loaded synchronously, but force a first frame
window.renderFrame = t => { frame(t); renderer.getContext().finish(); };
window.CUE = CUE; window.ready = true;
