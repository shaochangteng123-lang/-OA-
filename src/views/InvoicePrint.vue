<template>
  <div class="invoice-print-page">
    <div class="toolbar no-print">
      <div class="toolbar-title">发票批量打印<span>共 {{ invoices.length }} 张</span></div>
      <div class="toolbar-actions">
        <button class="btn btn-default" @click="goBack">返回</button>
        <button class="btn btn-primary" @click="handlePrint" :disabled="rendering">
          {{ rendering ? '渲染中...' : '打印' }}
        </button>
      </div>
    </div>
    <div class="container">
      <div class="sidebar no-print">
        <div class="sidebar-title">发票列表</div>
        <div
          v-for="(inv, index) in invoices"
          :key="inv.id"
          class="preview-item"
          @click="scrollTo(index)"
        >
          <div class="preview-thumb">
            <img v-if="isImage(inv.filePath)" :src="toFileUrl(inv.filePath)" />
            <canvas v-else :ref="el => setPdfThumbRef(index, el)" class="thumb-canvas"></canvas>
          </div>
          <div class="preview-label">
            <span class="preview-index">{{ index + 1 }}</span>
            <span class="preview-name">{{ inv.userName }}</span>
            <span class="preview-amount">¥{{ inv.amount.toFixed(2) }}</span>
          </div>
        </div>
      </div>
      <div class="main">
        <div v-for="(inv, index) in invoices" :key="inv.id" :id="'inv-' + index" class="invoice-item">
          <div class="invoice-header no-print">
            <span>{{ index + 1 }}. {{ inv.userName }} - {{ inv.reimbursementTypeName }} - ¥{{ inv.amount.toFixed(2) }}</span>
            <span>{{ inv.invoiceNumber ? '发票号: ' + inv.invoiceNumber : '' }}</span>
          </div>
          <div class="invoice-content">
            <img v-if="isImage(inv.filePath)" :src="toFileUrl(inv.filePath)" />
            <!-- PDF 渲染为 canvas -->
            <canvas v-else :ref="el => setPdfMainRef(index, el)" class="pdf-canvas"></canvas>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as pdfjsLib from 'pdfjs-dist'
import { toFileUrl, isImageFile } from '@/utils/file'

// 设置 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

interface InvoiceItem {
  id: string
  filePath: string
  userName: string
  amount: number
  reimbursementTypeName: string
  invoiceNumber: string
}

const router = useRouter()
const invoices = ref<InvoiceItem[]>([])
const rendering = ref(false)

// 存储 canvas 引用
const pdfMainCanvases: Record<number, HTMLCanvasElement | null> = {}
const pdfThumbCanvases: Record<number, HTMLCanvasElement | null> = {}

function setPdfMainRef(index: number, el: any) {
  pdfMainCanvases[index] = el as HTMLCanvasElement | null
}

function setPdfThumbRef(index: number, el: any) {
  pdfThumbCanvases[index] = el as HTMLCanvasElement | null
}

function isImage(filePath: string) {
  return isImageFile(filePath)
}

function scrollTo(index: number) {
  document.getElementById('inv-' + index)?.scrollIntoView({ behavior: 'smooth' })
}

function handlePrint() {
  if (rendering.value) return

  // 创建新窗口，将发票转为 JPEG 图片打印
  const printWindow = window.open('', '_blank')
  if (!printWindow) return

  let imagesHtml = ''
  invoices.value.forEach((inv, index) => {
    let imgSrc = ''
    if (isImage(inv.filePath)) {
      imgSrc = toFileUrl(inv.filePath)
    } else {
      const canvas = pdfMainCanvases[index]
      if (canvas) {
        imgSrc = canvas.toDataURL('image/jpeg', 1.0)
      }
    }
    if (imgSrc) {
      imagesHtml += `<div class="page"><img src="${imgSrc}" /></div>`
    }
  })

  printWindow.document.write(`<!DOCTYPE html>
<html><head><title>发票打印</title>
<style>
  @page { margin: 5mm; }
  * { margin: 0; padding: 0; }
  body { background: #fff; }
  .page {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    page-break-after: always;
    padding: 5mm;
    box-sizing: border-box;
  }
  .page:last-child { page-break-after: auto; }
  .page img {
    max-width: 100%;
    max-height: 95vh;
    object-fit: contain;
  }
</style></head><body>${imagesHtml}</body></html>`)
  printWindow.document.close()

  printWindow.onload = () => {
    printWindow.focus()
    printWindow.print()
  }
}

function goBack() {
  router.back()
}

// 渲染 PDF 到 canvas
async function renderPdf(filePath: string, mainCanvas: HTMLCanvasElement | null, thumbCanvas: HTMLCanvasElement | null) {
  try {
    const loadingTask = pdfjsLib.getDocument(filePath)
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(1)

    // 渲染主内容区 canvas（高分辨率）
    if (mainCanvas) {
      const scale = 3.0 // 提升到 3 倍分辨率，提高打印清晰度
      const viewport = page.getViewport({ scale })
      mainCanvas.width = viewport.width
      mainCanvas.height = viewport.height
      const context = mainCanvas.getContext('2d')
      if (context) {
        // 启用图像平滑以提高质量
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        // 先画白色背景，防止透明背景导致打印发灰
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, mainCanvas.width, mainCanvas.height)
        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise
      }
    }

    // 渲染缩略图 canvas
    if (thumbCanvas) {
      const thumbScale = 0.5
      const thumbViewport = page.getViewport({ scale: thumbScale })
      thumbCanvas.width = thumbViewport.width
      thumbCanvas.height = thumbViewport.height
      const thumbContext = thumbCanvas.getContext('2d')
      if (thumbContext) {
        thumbContext.fillStyle = '#ffffff'
        thumbContext.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height)
        await page.render({
          canvasContext: thumbContext,
          viewport: thumbViewport,
        }).promise
      }
    }
  } catch (error) {
    console.error('PDF 渲染失败:', filePath, error)
  }
}

// 渲染所有 PDF 发票
async function renderAllPdfs() {
  rendering.value = true
  await nextTick()

  const pdfInvoices = invoices.value
    .map((inv, index) => ({ inv, index }))
    .filter(({ inv }) => !isImage(inv.filePath))

  // 逐个渲染，避免同时加载过多
  for (const { inv, index } of pdfInvoices) {
    await renderPdf(
      toFileUrl(inv.filePath),
      pdfMainCanvases[index] || null,
      pdfThumbCanvases[index] || null
    )
  }

  rendering.value = false
}

onMounted(() => {
  const data = sessionStorage.getItem('print-invoices')
  if (data) {
    invoices.value = JSON.parse(data)
    sessionStorage.removeItem('print-invoices')
    // 等待 DOM 更新后渲染 PDF
    nextTick(() => {
      renderAllPdfs()
    })
  } else {
    router.back()
  }
})
</script>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }

.invoice-print-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
  font-family: "Microsoft YaHei", sans-serif;
}

.toolbar {
  height: 48px;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
}
.toolbar-title { font-size: 15px; font-weight: 600; color: #333; }
.toolbar-title span { color: #909399; font-weight: 400; font-size: 13px; margin-left: 8px; }
.toolbar-actions { display: flex; gap: 8px; }
.btn {
  padding: 6px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-primary { background: #409eff; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #337ecc; }
.btn-default { background: #f0f0f0; color: #333; }
.btn-default:hover { background: #e0e0e0; }

.container { display: flex; flex: 1; overflow: hidden; }

.sidebar {
  width: 200px;
  background: #fff;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  flex-shrink: 0;
  padding: 12px 8px;
}
.sidebar-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  padding: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid #eee;
}
.preview-item {
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 8px;
  border: 2px solid transparent;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.preview-item:hover {
  border-color: #409eff;
  box-shadow: 0 2px 8px rgba(64,158,255,0.15);
}
.preview-thumb {
  width: 100%;
  height: 120px;
  border: 1px solid #eee;
  border-radius: 4px;
  overflow: hidden;
  background: #fafafa;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-thumb img { width: 100%; height: 100%; object-fit: contain; }
.thumb-canvas { max-width: 100%; max-height: 100%; object-fit: contain; }
.preview-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12px;
  color: #606266;
}
.preview-index {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #409eff;
  color: #fff;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.preview-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.preview-amount { margin-left: auto; color: #409eff; font-weight: 500; flex-shrink: 0; }

.main {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}
.invoice-item {
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}
.invoice-header {
  padding: 10px 16px;
  background: #fafafa;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #606266;
}
.invoice-content {
  padding: 12px;
  text-align: center;
  min-height: 300px;
}
.invoice-content img {
  max-width: 100%;
  max-height: 600px;
  object-fit: contain;
}
.pdf-canvas {
  max-width: 100%;
  height: auto;
}

@page {
  margin: 0;
}

@media print {
  .invoice-print-page {
    background: #fff;
    height: auto !important;
    overflow: visible !important;
    display: block !important;
  }
  .no-print { display: none !important; }
  .container {
    display: block !important;
    overflow: visible !important;
    height: auto !important;
  }
  .main {
    padding: 0;
    overflow: visible !important;
    height: auto !important;
  }
  .invoice-item {
    page-break-inside: avoid;
    break-inside: avoid;
    box-shadow: none;
    border-radius: 0;
    margin: 0;
    overflow: visible !important;
  }
  .invoice-item + .invoice-item {
    page-break-before: always;
    break-before: page;
  }
  .invoice-item:last-child {
    page-break-after: avoid;
    break-after: avoid;
  }
  .invoice-header { display: none !important; }
  .invoice-content {
    padding: 10mm;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: auto;
    overflow: visible !important;
  }
  .invoice-content img {
    max-width: 100%;
    max-height: 95vh;
  }
  .pdf-canvas {
    max-width: 100%;
    max-height: 95vh;
  }
}
</style>
