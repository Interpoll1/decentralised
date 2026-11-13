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
