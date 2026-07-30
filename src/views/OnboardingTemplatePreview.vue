<template>
  <div
    class="contract-preview-page"
    @contextmenu.prevent
    @dragstart.prevent
  >
    <header class="preview-toolbar">
      <div class="preview-heading">
        <el-icon class="preview-document-icon"><Document /></el-icon>
        <div>
          <h1>劳动合同预览</h1>
          <span v-if="pageNumbers.length">{{ pageNumbers.length }} 页</span>
        </div>
      </div>

      <el-tooltip content="关闭预览" placement="bottom">
        <el-button
          :icon="Close"
          circle
          aria-label="关闭预览"
          @click="closePreview"
        />
      </el-tooltip>
    </header>

    <main
      v-loading="loading"
      class="preview-viewport"
    >
      <el-result
        v-if="errorMessage"
        icon="error"
        title="预览加载失败"
        :sub-title="errorMessage"
      >
        <template #extra>
          <el-button type="primary" @click="loadPreview">重新加载</el-button>
        </template>
      </el-result>

      <div v-else class="preview-pages">
        <section
          v-for="pageNumber in pageNumbers"
          :key="pageNumber"
          class="preview-sheet"
          :aria-label="`劳动合同第 ${pageNumber} 页`"
        >
          <canvas
            :ref="element => setPreviewCanvas(pageNumber, element)"
          />
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Close, Document } from '@element-plus/icons-vue'
import * as pdfjsLib from 'pdfjs-dist'
import { api } from '@/utils/api'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString()

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const errorMessage = ref('')
const pageNumbers = ref<number[]>([])
const previewCanvases = new Map<number, HTMLCanvasElement>()
let previewGeneration = 0

function setPreviewCanvas(pageNumber: number, element: unknown) {
  if (element instanceof HTMLCanvasElement) {
    previewCanvases.set(pageNumber, element)
  } else {
    previewCanvases.delete(pageNumber)
  }
}

function getTemplateId() {
  const templateId = route.params.templateId
  return typeof templateId === 'string' ? templateId.trim() : ''
}

async function loadPreview() {
  const templateId = getTemplateId()
  if (!templateId) {
    errorMessage.value = '劳动合同模板编号无效'
    return
  }

  const generation = ++previewGeneration
  loading.value = true
  errorMessage.value = ''
  pageNumbers.value = []
  previewCanvases.clear()

  try {
    const response = await api.get(
      `/api/employees/onboarding/templates/${encodeURIComponent(templateId)}/preview`,
      { responseType: 'arraybuffer' },
    )
    if (generation !== previewGeneration) return

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(response.data),
      cMapUrl: '/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/standard_fonts/',
    })
    const pdf = await loadingTask.promise
    if (generation !== previewGeneration) {
      await pdf.destroy()
      return
    }

    pageNumbers.value = Array.from(
      { length: pdf.numPages },
      (_, index) => index + 1,
    )
    await nextTick()

    for (const pageNumber of pageNumbers.value) {
      if (generation !== previewGeneration) break
      const canvas = previewCanvases.get(pageNumber)
      if (!canvas) continue

      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1.8 })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) continue

      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({
        canvasContext: context,
        viewport,
      }).promise
    }

    await pdf.destroy()
  } catch (error: any) {
    if (generation !== previewGeneration) return
    console.error('劳动合同预览失败:', error)
    errorMessage.value = error.response?.data?.message || '劳动合同预览失败，请稍后重试'
  } finally {
    if (generation === previewGeneration) {
      loading.value = false
    }
  }
}

function closePreview() {
  window.close()
  window.setTimeout(() => {
    if (!window.closed) {
      window.location.assign(router.resolve({ name: 'Onboarding' }).href)
    }
  }, 100)
}

function blockProtectedShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return
  if (!['s', 'p'].includes(event.key.toLowerCase())) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

onMounted(() => {
  document.title = '劳动合同预览'
  document.addEventListener('keydown', blockProtectedShortcut, true)
  void loadPreview()
})

onBeforeUnmount(() => {
  previewGeneration += 1
  document.removeEventListener('keydown', blockProtectedShortcut, true)
  previewCanvases.clear()
})
</script>

<style scoped>
.contract-preview-page {
  min-height: 100vh;
  color: #303133;
  background: #e7e9ed;
  user-select: none;
}

.preview-toolbar {
  position: sticky;
  top: 0;
  z-index: 10;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 64px;
  padding: 0 24px;
  background: #ffffff;
  border-bottom: 1px solid #dcdfe6;
  box-shadow: 0 1px 4px rgb(0 0 0 / 8%);
}

.preview-heading {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 12px;
}

.preview-document-icon {
  flex: 0 0 auto;
  font-size: 22px;
  color: #409eff;
}

.preview-heading h1 {
  margin: 0;
  overflow: hidden;
  color: #303133;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-heading span {
  display: block;
  color: #909399;
  font-size: 12px;
  line-height: 18px;
}

.preview-viewport {
  box-sizing: border-box;
  min-height: calc(100vh - 64px);
  padding: 24px;
}

.preview-pages {
  display: grid;
  justify-items: center;
  gap: 20px;
}

.preview-sheet {
  position: relative;
  width: min(100%, 920px);
  line-height: 0;
  background: #ffffff;
  box-shadow: 0 2px 10px rgb(0 0 0 / 14%);
}

.preview-sheet canvas {
  display: block;
  width: 100%;
  height: auto;
}

@media (max-width: 640px) {
  .preview-toolbar {
    height: 56px;
    padding: 0 14px;
  }

  .preview-viewport {
    min-height: calc(100vh - 56px);
    padding: 12px 8px;
  }

  .preview-pages {
    gap: 12px;
  }
}
</style>
