<template>
  <div class="ip-loader">
    <div class="ip-canvas-wrap">
      <canvas ref="canvasRef" width="200" height="200"></canvas>
    </div>
    <div class="ip-logo">Interpoll</div>
    <div class="ip-tagline">peer-to-peer · decentralized</div>
    <div class="ip-bar-wrap"><div class="ip-bar"></div></div>
    <div class="ip-status">
      Connecting peers<span class="ip-dots"><span>.</span><span>.</span><span>.</span></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const canvasRef = ref<HTMLCanvasElement | null>(null)
let rafId: number

onMounted(() => {
  const canvas = canvasRef.value!
  const ctx = canvas.getContext('2d')!
  const W = 200, H = 200, cx = W / 2, cy = H / 2

  const nodes = [
    { x: cx,      y: cy,      r: 6,   main: true },
    { x: cx - 60, y: cy - 50, r: 3.5, main: false },
    { x: cx + 65, y: cy - 40, r: 3.5, main: false },
    { x: cx - 70, y: cy + 30, r: 3.5, main: false },
    { x: cx + 55, y: cy + 55, r: 3.5, main: false },
    { x: cx - 20, y: cy - 80, r: 2.5, main: false },
    { x: cx + 30, y: cy + 80, r: 2.5, main: false },
    { x: cx + 82, y: cy + 10, r: 2.5, main: false },
    { x: cx - 80, y: cy - 10, r: 2.5, main: false },
  ]

  const edges = [[0,1],[0,2],[0,3],[0,4],[1,5],[2,7],[3,8],[4,6],[1,8],[2,5],[3,4],[4,7]]
  const pulses = edges.map(() => ({ progress: Math.random(), active: Math.random() > 0.4 }))
  let t = 0

  function draw() {
    ctx.clearRect(0, 0, W, H)
    t += 0.018

    edges.forEach(([a, b], i) => {
      const na = nodes[a], nb = nodes[b]
      ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y)
      ctx.strokeStyle = 'rgba(83,74,183,0.18)'; ctx.lineWidth = 0.8; ctx.stroke()

      if (pulses[i].active) {
        pulses[i].progress += 0.012
        if (pulses[i].progress > 1) { pulses[i].progress = 0; pulses[i].active = Math.random() > 0.3 }
        const p = pulses[i].progress
        const px = na.x + (nb.x - na.x) * p, py = na.y + (nb.y - na.y) * p
        const grad = ctx.createRadialGradient(px, py, 0, px, py, 5)
        grad.addColorStop(0, 'rgba(159,151,240,0.9)'); grad.addColorStop(1, 'rgba(83,74,183,0)')
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill()
      } else if (Math.random() < 0.003) pulses[i].active = true
    })

    nodes.forEach((n, i) => {
      const breathe = n.main ? 1 + 0.15 * Math.sin(t * 2) : 1 + 0.08 * Math.sin(t * 1.5 + i)
      const r = n.r * breathe
      const alpha = n.main ? 1 : 0.5 + 0.3 * Math.sin(t + i * 0.9)
      if (n.main) {
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(83,74,183,${0.12 + 0.06 * Math.sin(t * 2)})`; ctx.fill()
      }
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
      ctx.fillStyle = n.main ? `rgba(127,119,221,${alpha})` : `rgba(159,151,240,${alpha})`
      ctx.fill()
    })

    rafId = requestAnimationFrame(draw)
  }
  draw()
})

onUnmounted(() => cancelAnimationFrame(rafId))
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Grand+Hotel&display=swap');

.ip-loader {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: #0a0a0f; padding: 2rem;
}

/* subtle star-field texture */
.ip-loader::before {
  content: '';
  position: absolute; inset: 0; z-index: 0;
  background-image:
    radial-gradient(1px 1px at 20% 30%, rgba(159,151,240,0.25) 0%, transparent 100%),
    radial-gradient(1px 1px at 75% 15%, rgba(159,151,240,0.2) 0%, transparent 100%),
    radial-gradient(1px 1px at 55% 70%, rgba(159,151,240,0.2) 0%, transparent 100%),
    radial-gradient(1px 1px at 10% 80%, rgba(159,151,240,0.15) 0%, transparent 100%),
    radial-gradient(1px 1px at 88% 60%, rgba(159,151,240,0.2) 0%, transparent 100%),
    radial-gradient(1px 1px at 40% 90%, rgba(159,151,240,0.15) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 65% 40%, rgba(159,151,240,0.3) 0%, transparent 100%),
    radial-gradient(1px 1px at 30% 55%, rgba(159,151,240,0.15) 0%, transparent 100%);
  pointer-events: none;
}

/* soft purple ambient glow behind canvas */
.ip-loader::after {
  content: '';
  position: absolute;
  width: 320px; height: 320px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(83,74,183,0.12) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}

.ip-canvas-wrap {
  position: relative; width: 200px; height: 200px;
  margin-bottom: 1.5rem; z-index: 1;
}

.ip-logo {
  font-family: 'Grand Hotel', cursive;
  font-size: 48px;
  color: #e8e4ff;
  letter-spacing: 0.5px;
  margin-bottom: 0.3rem;
  z-index: 1;
  /* soft text glow matching the purple theme */
  text-shadow: 0 0 40px rgba(127,119,221,0.4), 0 0 80px rgba(83,74,183,0.2);
}

.ip-tagline {
  font-size: 11px;
  color: #3d3d58;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  margin-bottom: 2.5rem;
  z-index: 1;
}

.ip-bar-wrap {
  width: 140px; height: 1px;
  background: #1a1a2e;
  border-radius: 99px; overflow: hidden;
  margin-bottom: 1.2rem; z-index: 1;
}

.ip-bar {
  height: 100%; width: 0%;
  background: linear-gradient(90deg, #534ab7, #9f97f0, #c4bfff);
  border-radius: 99px;
  animation: barFill 2.4s cubic-bezier(0.4,0,0.2,1) forwards;
  box-shadow: 0 0 8px rgba(159,151,240,0.6);
}

@keyframes barFill {
  0%   { width: 0% }
  80%  { width: 85% }
  95%  { width: 95% }
  100% { width: 100% }
}

.ip-status {
  font-size: 11px; color: #4a4270;
  letter-spacing: 0.15em; text-transform: uppercase;
  animation: pulse 1.8s ease-in-out infinite;
  z-index: 1;
}

@keyframes pulse { 0%, 100% { opacity: 0.4 } 50% { opacity: 1 } }

.ip-dots span { display: inline-block; animation: dotBounce 1.2s ease-in-out infinite; }
.ip-dots span:nth-child(2) { animation-delay: 0.2s; }
.ip-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotBounce { 0%, 80%, 100% { opacity: 0.3 } 40% { opacity: 1 } }
</style>