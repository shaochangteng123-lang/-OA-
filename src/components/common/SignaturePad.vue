<template>
  <!-- 签名画板组件 -->
  <div class="signature-pad-wrapper">
    <div class="canvas-container" ref="containerRef">
      <canvas ref="canvasRef" class="signature-canvas" />
    </div>
    <div class="signature-actions">
      <el-button @click="clear">清除</el-button>
      <el-button type="primary" :disabled="isEmpty" @click="confirm">确认签名</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits<{
  (e: 'confirm', dataUrl: string): void
}>()

const containerRef = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()
const isEmpty = ref(true)

let ctx: CanvasRenderingContext2D | null = null
let isDrawing = false
let lastX = 0
let lastY = 0

function setupCanvas() {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container) return

  const w = container.clientWidth
  const h = container.clientHeight
  if (w === 0 || h === 0) return

  canvas.width = w
  canvas.height = h
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'

  ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

function getXY(e: MouseEvent | TouchEvent) {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  if ('touches' in e) {
    const t = e.touches[0]
    return { x: t.clientX - rect.left, y: t.clientY - rect.top }
  }
  return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top }
}

function handleStart(e: MouseEvent | TouchEvent) {
  // 每次开始时确保 canvas 已初始化
  if (!ctx) setupCanvas()
  if (!ctx) return
  e.preventDefault()
  isDrawing = true
  const { x, y } = getXY(e)
  lastX = x
  lastY = y
}

function handleMove(e: MouseEvent | TouchEvent) {
  if (!isDrawing || !ctx) return
  e.preventDefault()
  const { x, y } = getXY(e)
  ctx.beginPath()
  ctx.moveTo(lastX, lastY)
  ctx.lineTo(x, y)
  ctx.stroke()
  lastX = x
  lastY = y
  isEmpty.value = false
}

function handleEnd() {
  isDrawing = false
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return

  // 使用原生事件绑定，绕过 Vue 的事件代理
  canvas.addEventListener('mousedown', handleStart)
  canvas.addEventListener('mousemove', handleMove)
  canvas.addEventListener('mouseup', handleEnd)
  canvas.addEventListener('mouseleave', handleEnd)
  canvas.addEventListener('touchstart', handleStart, { passive: false })
  canvas.addEventListener('touchmove', handleMove, { passive: false })
  canvas.addEventListener('touchend', handleEnd)

  // 延迟初始化，等待弹窗动画完成
  setTimeout(setupCanvas, 350)
})

onBeforeUnmount(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.removeEventListener('mousedown', handleStart)
  canvas.removeEventListener('mousemove', handleMove)
  canvas.removeEventListener('mouseup', handleEnd)
  canvas.removeEventListener('mouseleave', handleEnd)
  canvas.removeEventListener('touchstart', handleStart)
  canvas.removeEventListener('touchmove', handleMove)
  canvas.removeEventListener('touchend', handleEnd)
})

function clear() {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  isEmpty.value = true
}

function confirm() {
  if (!canvasRef.value || isEmpty.value) return
  const dataUrl = canvasRef.value.toDataURL('image/png')
  emit('confirm', dataUrl)
}
</script>

<style scoped>
.signature-pad-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.canvas-container {
  width: 100%;
  height: 200px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
  position: relative;
}

.signature-canvas {
  display: block;
  cursor: crosshair;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.signature-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
