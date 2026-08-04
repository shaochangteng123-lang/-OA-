<template>
  <div class="contract-preview-page" @contextmenu.prevent @dragstart.prevent>
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

    <main v-loading="loading" class="preview-viewport">
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
          <canvas :ref="(element) => setPreviewCanvas(pageNumber, element)" />
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Close, Document } from "@element-plus/icons-vue";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { api } from "@/utils/api";
import {
  getPdfPreviewPlaceholderMetrics,
  getPdfPreviewRenderMetrics,
} from "@/utils/pdfPreview";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const errorMessage = ref("");
const pageNumbers = ref<number[]>([]);
const previewCanvases = new Map<number, HTMLCanvasElement>();
const pageSizes = new Map<number, { width: number; height: number }>();
const visiblePages = new Set<number>();
const renderTasks = new Map<number, RenderTask>();
const renderPromises = new Map<number, Promise<void>>();
const renderRequestVersions = new Map<number, number>();
const renderTargetWidths = new Map<number, number>();
const renderedPixelWidths = new Map<number, number>();
let pdfDocument: PDFDocumentProxy | null = null;
let visibilityAnimationFrame: number | null = null;
let previewGeneration = 0;

function setPreviewCanvas(pageNumber: number, element: unknown) {
  if (element instanceof HTMLCanvasElement) {
    previewCanvases.set(pageNumber, element);
  } else {
    previewCanvases.delete(pageNumber);
  }
}

function getTemplateId() {
  const templateId = route.params.templateId;
  return typeof templateId === "string" ? templateId.trim() : "";
}

function getPreviewErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return "劳动合同预览失败，请稍后重试";
  }
  const response = (error as { response?: { data?: { message?: unknown } } })
    .response;
  return typeof response?.data?.message === "string"
    ? response.data.message
    : "劳动合同预览失败，请稍后重试";
}

function fillCanvasWhite(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function resetPageCanvas(pageNumber: number) {
  const canvas = previewCanvases.get(pageNumber);
  const pageSize = pageSizes.get(pageNumber);
  if (!canvas || !pageSize) return;

  const placeholder = getPdfPreviewPlaceholderMetrics(
    pageSize.width,
    pageSize.height,
  );
  canvas.width = placeholder.pixelWidth;
  canvas.height = placeholder.pixelHeight;
  renderedPixelWidths.delete(pageNumber);
  fillCanvasWhite(canvas);
}

function isRenderCancelled(error: unknown) {
  return error instanceof pdfjsLib.RenderingCancelledException;
}

function renderPage(pageNumber: number, generation: number) {
  const document = pdfDocument;
  const canvas = previewCanvases.get(pageNumber);
  const pageSize = pageSizes.get(pageNumber);
  if (!document || !canvas || !pageSize || generation !== previewGeneration) {
    return Promise.resolve();
  }

  const displayWidth = canvas.parentElement?.clientWidth || pageSize.width;
  const renderMetrics = getPdfPreviewRenderMetrics(
    pageSize.width,
    pageSize.height,
    displayWidth,
    window.devicePixelRatio,
  );
  const existingPromise = renderPromises.get(pageNumber);
  if (renderTargetWidths.get(pageNumber) === renderMetrics.pixelWidth) {
    return existingPromise || Promise.resolve();
  }
  if (
    !existingPromise &&
    renderedPixelWidths.get(pageNumber) === renderMetrics.pixelWidth
  ) {
    return Promise.resolve();
  }

  const requestVersion = (renderRequestVersions.get(pageNumber) || 0) + 1;
  renderRequestVersions.set(pageNumber, requestVersion);
  renderTargetWidths.set(pageNumber, renderMetrics.pixelWidth);

  const previousTask = renderTasks.get(pageNumber);
  const previousPromise = renderPromises.get(pageNumber);
  previousTask?.cancel();

  const renderPromise = (async () => {
    if (previousPromise) {
      await previousPromise;
    }
    if (
      generation !== previewGeneration ||
      renderRequestVersions.get(pageNumber) !== requestVersion ||
      !visiblePages.has(pageNumber)
    ) {
      return;
    }

    let page: PDFPageProxy | null = null;
    let task: RenderTask | null = null;
    try {
      page = await document.getPage(pageNumber);
      if (
        generation !== previewGeneration ||
        renderRequestVersions.get(pageNumber) !== requestVersion ||
        !visiblePages.has(pageNumber)
      ) {
        return;
      }

      const viewport = page.getViewport({
        scale: renderMetrics.renderScale,
      });
      canvas.width = renderMetrics.pixelWidth;
      canvas.height = renderMetrics.pixelHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        renderTargetWidths.delete(pageNumber);
        return;
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      fillCanvasWhite(canvas);
      task = page.render({
        canvasContext: context,
        viewport,
      });
      renderTasks.set(pageNumber, task);
      await task.promise;

      if (
        generation === previewGeneration &&
        renderRequestVersions.get(pageNumber) === requestVersion
      ) {
        renderedPixelWidths.set(pageNumber, renderMetrics.pixelWidth);
      }
    } catch (error: unknown) {
      if (
        !isRenderCancelled(error) &&
        generation === previewGeneration &&
        renderRequestVersions.get(pageNumber) === requestVersion
      ) {
        console.error(`劳动合同第 ${pageNumber} 页预览失败:`, error);
        errorMessage.value = "劳动合同预览失败，请稍后重试";
        renderTargetWidths.delete(pageNumber);
      }
    } finally {
      if (task && renderTasks.get(pageNumber) === task) {
        renderTasks.delete(pageNumber);
      }
      page?.cleanup();
    }
  })();

  renderPromises.set(pageNumber, renderPromise);
  void renderPromise.then(() => {
    if (renderPromises.get(pageNumber) === renderPromise) {
      renderPromises.delete(pageNumber);
    }
  });
  return renderPromise;
}

async function releasePageCanvas(pageNumber: number) {
  const requestVersion = (renderRequestVersions.get(pageNumber) || 0) + 1;
  renderRequestVersions.set(pageNumber, requestVersion);
  renderTargetWidths.delete(pageNumber);
  renderTasks.get(pageNumber)?.cancel();
  await renderPromises.get(pageNumber);

  if (
    !visiblePages.has(pageNumber) &&
    renderRequestVersions.get(pageNumber) === requestVersion
  ) {
    resetPageCanvas(pageNumber);
  }
}

function updateVisiblePages(generation: number, renderVisiblePages = true) {
  const viewportHeight = Math.max(window.innerHeight, 1);
  const preloadDistance = viewportHeight;
  const initiallyVisible: number[] = [];

  for (const [pageNumber, canvas] of previewCanvases) {
    const bounds = canvas.parentElement?.getBoundingClientRect();
    if (!bounds) continue;

    const shouldRender =
      bounds.bottom >= -preloadDistance &&
      bounds.top <= viewportHeight + preloadDistance;
    if (shouldRender) {
      visiblePages.add(pageNumber);
      initiallyVisible.push(pageNumber);
      if (renderVisiblePages) {
        void renderPage(pageNumber, generation);
      }
    } else if (visiblePages.delete(pageNumber)) {
      void releasePageCanvas(pageNumber);
    }
  }

  return initiallyVisible;
}

function scheduleVisiblePageUpdate() {
  if (visibilityAnimationFrame !== null) return;
  visibilityAnimationFrame = window.requestAnimationFrame(() => {
    visibilityAnimationFrame = null;
    updateVisiblePages(previewGeneration);
  });
}

async function disposePreviewDocument() {
  if (visibilityAnimationFrame !== null) {
    window.cancelAnimationFrame(visibilityAnimationFrame);
    visibilityAnimationFrame = null;
  }

  for (const pageNumber of renderRequestVersions.keys()) {
    renderRequestVersions.set(
      pageNumber,
      (renderRequestVersions.get(pageNumber) || 0) + 1,
    );
  }
  for (const task of renderTasks.values()) {
    task.cancel();
  }

  const pendingRenders = [...renderPromises.values()];
  const document = pdfDocument;
  pdfDocument = null;
  visiblePages.clear();
  renderTasks.clear();
  renderPromises.clear();
  renderRequestVersions.clear();
  renderTargetWidths.clear();
  renderedPixelWidths.clear();
  pageSizes.clear();

  await Promise.allSettled(pendingRenders);
  await document?.destroy();
}

async function loadPreview() {
  const templateId = getTemplateId();
  if (!templateId) {
    errorMessage.value = "劳动合同模板编号无效";
    return;
  }

  const generation = ++previewGeneration;
  loading.value = true;
  errorMessage.value = "";
  pageNumbers.value = [];
  previewCanvases.clear();
  await disposePreviewDocument();

  try {
    const response = await api.get(
      `/api/employees/onboarding/templates/${encodeURIComponent(templateId)}/preview`,
      { responseType: "arraybuffer" },
    );
    if (generation !== previewGeneration) return;

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(response.data),
      cMapUrl: "/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/standard_fonts/",
    });
    const pdf = await loadingTask.promise;
    if (generation !== previewGeneration) {
      await pdf.destroy();
      return;
    }
    pdfDocument = pdf;

    pageNumbers.value = Array.from(
      { length: pdf.numPages },
      (_, index) => index + 1,
    );
    await nextTick();

    for (const pageNumber of pageNumbers.value) {
      if (generation !== previewGeneration) return;
      const canvas = previewCanvases.get(pageNumber);
      if (!canvas) continue;

      const page = await pdf.getPage(pageNumber);
      const sourceViewport = page.getViewport({ scale: 1 });
      pageSizes.set(pageNumber, {
        width: sourceViewport.width,
        height: sourceViewport.height,
      });
      resetPageCanvas(pageNumber);
      page.cleanup();
    }

    const initiallyVisible = updateVisiblePages(generation, false);
    const firstVisiblePage = initiallyVisible[0] || 1;
    visiblePages.add(firstVisiblePage);
    await renderPage(firstVisiblePage, generation);
    updateVisiblePages(generation);
  } catch (error: unknown) {
    if (generation !== previewGeneration) return;
    console.error("劳动合同预览失败:", error);
    errorMessage.value = getPreviewErrorMessage(error);
    await disposePreviewDocument();
  } finally {
    if (generation === previewGeneration) {
      loading.value = false;
    }
  }
}

function closePreview() {
  window.close();
  window.setTimeout(() => {
    if (!window.closed) {
      window.location.assign(router.resolve({ name: "Onboarding" }).href);
    }
  }, 100);
}

function blockProtectedShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (!["s", "p"].includes(event.key.toLowerCase())) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

onMounted(() => {
  document.title = "劳动合同预览";
  document.addEventListener("keydown", blockProtectedShortcut, true);
  window.addEventListener("scroll", scheduleVisiblePageUpdate, {
    passive: true,
  });
  window.addEventListener("resize", scheduleVisiblePageUpdate, {
    passive: true,
  });
  void loadPreview();
});

onBeforeUnmount(() => {
  previewGeneration += 1;
  document.removeEventListener("keydown", blockProtectedShortcut, true);
  window.removeEventListener("scroll", scheduleVisiblePageUpdate);
  window.removeEventListener("resize", scheduleVisiblePageUpdate);
  void disposePreviewDocument();
  previewCanvases.clear();
});
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
