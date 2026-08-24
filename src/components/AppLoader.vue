<template>
  <div class="ip-loader">
    <canvas ref="canvasRef" class="ip-canvas" />
    <div class="ip-content">
      <div class="ip-logo">{{ APP_NAME }}</div>
      <div class="ip-tag">peer-to-peer · decentralized</div>
      <div class="ip-bar-wrap"><div class="ip-bar" /></div>
      <div class="ip-status-wrap">
        <div class="ip-dot" />
        <div class="ip-status">
          Connecting peers<span class="ip-d">.</span><span class="ip-d">.</span><span class="ip-d">.</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { APP_NAME } from '../branding';

const canvasRef = ref<HTMLCanvasElement | null>(null)

const COUNTS = [5, 7, 8, 7, 5]
const NR = 8
const WAVE_SPEED = 0.022

interface Node {
  x: number
  y: number
  act: number
  phase: number
}

let layers: Node[][] = []
let wavePos = -0.3
let t = 0
let raf: number
let removeResize: () => void

function buildLayers(W: number, H: number) {
  layers = []
  const padX = W * 0.1
  const padY = H * 0.14
  const uw = W - padX * 2
  const uh = H - padY * 2
  COUNTS.forEach((count, li) => {
    const x = padX + (li / (COUNTS.length - 1)) * uw
    const nodes: Node[] = []
    for (let ni = 0; ni < count; ni++) {
      nodes.push({ x, y: padY + ((ni + 0.5) / count) * uh, act: 0, phase: Math.random() * Math.PI * 2 })
    }
    layers.push(nodes)
  })
}

function draw(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.clearRect(0, 0, W, H)
  t += 0.016
  wavePos += WAVE_SPEED
  if (wavePos > COUNTS.length + 1) wavePos = -0.3

  layers.forEach((nodes, li) => {
    const d = wavePos - li
    const act = d >= 0 && d < 1.8 ? Math.pow(Math.sin((1 - d / 1.8) * Math.PI * 0.5), 1.5) : 0
    nodes.forEach(n => { n.act = act * (0.75 + 0.25 * Math.sin(t * 2.2 + n.phase)) })
  })

  for (let li = 0; li < layers.length - 1; li++) {
    const A = layers[li], B = layers[li + 1]
    A.forEach(na => {
      B.forEach(nb => {
        const ea = (na.act + nb.act) / 2

        ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y)
        ctx.strokeStyle = 'rgba(90,80,200,0.11)'
        ctx.lineWidth = 0.55; ctx.stroke()

        if (ea > 0.04) {
          ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y)
          const r = Math.round(120 + ea * 130)
          const g = Math.round(100 + ea * 150)
          const b = Math.round(230 + ea * 25)
          ctx.strokeStyle = `rgba(${r},${g},${b},${0.15 + ea * 0.75})`
          ctx.lineWidth = 0.7 + ea * 1.6; ctx.stroke()
        }
      })
    })
  }

  layers.forEach(nodes => {
    nodes.forEach(n => {
      const a = n.act

      if (a > 0.05) {
        const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, NR * 5)
        glow.addColorStop(0, `rgba(160,148,255,${a * 0.4})`)
        glow.addColorStop(0.5, `rgba(100,88,230,${a * 0.15})`)
        glow.addColorStop(1, 'rgba(60,50,200,0)')
        ctx.beginPath(); ctx.arc(n.x, n.y, NR * 5, 0, Math.PI * 2)
        ctx.fillStyle = glow; ctx.fill()
      }

      ctx.beginPath(); ctx.arc(n.x, n.y, NR, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(110,100,210,${0.3 + a * 0.6})`
      ctx.lineWidth = 1.2; ctx.stroke()

      ctx.beginPath(); ctx.arc(n.x, n.y, NR, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${Math.round(50 + a * 90)},${Math.round(44 + a * 80)},${Math.round(180 + a * 55)},${0.18 + a * 0.65})`
      ctx.fill()

      if (a > 0.45) {
        ctx.beginPath(); ctx.arc(n.x, n.y, NR * 0.42, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(230,222,255,${(a - 0.45) * 1.8})`
        ctx.fill()
      }
    })
  })

  raf = requestAnimationFrame(() => draw(ctx, W, H))
}

onMounted(() => {
  const canvas = canvasRef.value!
  const ctx = canvas.getContext('2d')!

  const resize = () => {
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    buildLayers(canvas.width, canvas.height)
  }

  resize()
  window.addEventListener('resize', resize)
  removeResize = () => window.removeEventListener('resize', resize)
  draw(ctx, canvas.width, canvas.height)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  removeResize?.()
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Grand+Hotel&family=Cormorant+Garamond:ital@1&display=swap');

.ip-loader {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: radial-gradient(ellipse at 50% 40%, #0c0d1a 0%, #06060e 55%, #020204 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ip-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.ip-content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.ip-logo {
  font-family: 'Grand Hotel', cursive;
  font-size: 80px;
  line-height: 1;
  margin-bottom: 6px;
  background: linear-gradient(160deg, #fff 0%, rgba(200, 195, 255, 0.85) 60%, rgba(150, 138, 255, 0.7) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ip-tag {
  font-family: 'Cormorant Garamond', serif;
  font-size: 20px;
  font-style: italic;
  color: rgba(255, 255, 255, 0.3);
  letter-spacing: 0.12em;
  margin-bottom: 28px;
}

.ip-bar-wrap {
  width: 130px;
  height: 1.5px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 99px;
  overflow: hidden;
  margin-bottom: 12px;
}

.ip-bar {
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, #6366f1, #a78bfa);
  border-radius: 99px;
  animation: barFill 1.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
}

@keyframes barFill {
  0%   { width: 0% }
  70%  { width: 80% }
  90%  { width: 93% }
  100% { width: 100% }
}

.ip-status-wrap {
  display: flex;
  align-items: center;
  gap: 7px;
}

.ip-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #8b7ff5;
  animation: ping 1.4s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes ping {
  0%, 100% { opacity: 0.25; transform: scale(0.8); }
  50%       { opacity: 1;    transform: scale(1.2); }
}

.ip-status {
  font-family: 'Cormorant Garamond', serif;
  font-size: 20px;
  font-style: italic;
  color: rgba(255, 255, 255, 0.28);
  letter-spacing: 0.1em;
}

.ip-d {
  display: inline-block;
  animation: dotBounce 1.2s ease-in-out infinite;
}
.ip-d:nth-child(2) { animation-delay: 0.2s; }
.ip-d:nth-child(3) { animation-delay: 0.4s; }

@keyframes dotBounce {
  0%, 80%, 100% { opacity: 0.15; }
  40%           { opacity: 0.8; }
}
</style>