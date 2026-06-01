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
.ip-loader {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 2rem;
  background: radial-gradient(ellipse at top, #0a0a0f 0%, #050506 48%, #020203 100%);
}

.ip-loader::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    radial-gradient(circle at 20% 30%, rgba(94, 106, 210, 0.16), transparent 24%),
    radial-gradient(circle at 80% 20%, rgba(124, 140, 255, 0.12), transparent 28%);
  background-size: 64px 64px, 64px 64px, auto, auto;
  pointer-events: none;
  opacity: 0.55;
}

.ip-loader::after {
  content: '';
  position: absolute;
  width: 420px;
  height: 420px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(94, 106, 210, 0.2) 0%, transparent 70%);
  filter: blur(18px);
  pointer-events: none;
  z-index: 0;
}

.ip-canvas-wrap {
  position: relative;
  width: 220px;
  height: 220px;
  margin-bottom: 1.75rem;
  z-index: 1;
  display: grid;
  place-items: center;
  border-radius: 32px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.04),
    0 24px 60px rgba(0, 0, 0, 0.45),
    0 0 100px rgba(94, 106, 210, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.ip-logo {
  font-family: 'Grand Hotel', cursive;
  font-size: 54px;
  letter-spacing: 0.02em;
  margin-bottom: 0.2rem;
  z-index: 1;
  background: linear-gradient(to bottom, #ffffff, rgba(255, 255, 255, 0.72));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 40px rgba(94, 106, 210, 0.22);
}

.ip-tagline {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.56);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  margin-bottom: 2rem;
  z-index: 1;
}

.ip-bar-wrap {
  width: 168px;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 1rem;
  z-index: 1;
}

.ip-bar {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #5e6ad2, #8b5cf6, #7c8cff);
  border-radius: 99px;
  animation: barFill 2.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  box-shadow: 0 0 24px rgba(94, 106, 210, 0.45);
}

@keyframes barFill {
  0%   { width: 0% }
  80%  { width: 85% }
  95%  { width: 95% }
  100% { width: 100% }
}

.ip-status {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.52);
  letter-spacing: 0.15em;
  text-transform: uppercase;
  animation: pulse 1.8s ease-in-out infinite;
  z-index: 1;
}

@keyframes pulse { 0%, 100% { opacity: 0.4 } 50% { opacity: 1 } }

.ip-dots span { display: inline-block; animation: dotBounce 1.2s ease-in-out infinite; }
.ip-dots span:nth-child(2) { animation-delay: 0.2s; }
.ip-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotBounce { 0%, 80%, 100% { opacity: 0.3 } 40% { opacity: 1 } }
</style>