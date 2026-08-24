<template>
  <Teleport to="body">
    <section
      v-if="visible"
      ref="overlayRef"
      class="contract-readonly-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="合同文件只读预览"
      @contextmenu.prevent
      @dragstart.prevent
      @scroll.passive="scheduleVisiblePageUpdate"
    >
      <span class="sr-only">{{ fileName || "合同文件" }}只读预览</span>
      <nav class="preview-actions" aria-label="预览操作">
        <button
          ref="backButtonRef"
          type="button"
          class="preview-action back"
          aria-label="返回原页面"
          title="返回原页面"
          @click="emit('close')"
        >
          <el-icon aria-hidden="true"><ArrowLeft /></el-icon>
          <span>返回</span>
        </button>
        <button
          v-if="canDownload"
          type="button"
          class="preview-action download"
          aria-label="下载当前文件"
          title="下载当前文件"
          @click="emit('download')"
        >
          <el-icon aria-hidden="true"><Download /></el-icon>
          <span>下载</span>
        </button>
      </nav>

      <div v-if="errorMessage" class="preview-state error" role="alert">
        <strong>文件预览失败</strong>
        <span>{{ errorMessage }}</span>
      </div>

      <div v-else-if="isPdf" class="pdf-pages">
        <section
          v-for="pageNumber in pageNumbers"
          :key="pageNumber"
          class="pdf-sheet"
          :aria-label="`合同文件第 ${pageNumber} 页`"
        >
          <canvas :ref="(element) => setPageCanvas(pageNumber, element)" />
        </section>
      </div>

      <img
        v-else-if="isImage && imageUrl"
        :src="imageUrl"
        class="image-preview"
        alt="合同文件只读预览"
        draggable="false"
      />

      <div v-else-if="isDocx" ref="docxContainer" class="docx-preview" />

      <div v-if="loading" class="preview-loading" aria-live="polite">
        <el-icon class="is-loading" :size="30"><Loading /></el-icon>
        <span>正在加载文件…</span>
      </div>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ArrowLeft, Download, Loading } from "@element-plus/icons-vue";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { api } from "@/utils/api";
import {
  getPdfPreviewPlaceholderMetrics,
  getPdfPreviewRenderMetrics,
} from "@/utils/pdfPreview";

type PdfJsModule = typeof import("pdfjs-dist");
let pdfJsModule: PdfJsModule | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (pdfJsModule) return pdfJsModule;
  const loaded = await import("pdfjs-dist");
  loaded.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  pdfJsModule = loaded;
  return loaded;
}

const props = withDefaults(
  defineProps<{
    visible: boolean;
    url: string;
    fileName?: string;
    mimeType?: string;
    canDownload?: boolean;
  }>(),
  { fileName: "", mimeType: "", canDownload: false },
);

const emit = defineEmits<{ close: []; download: [] }>();
const overlayRef = ref<HTMLElement | null>(null);
const backButtonRef = ref<HTMLElement | null>(null);
const docxContainer = ref<HTMLElement | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const imageUrl = ref("");
const pageNumbers = ref<number[]>([]);
const canvases = new Map<number, HTMLCanvasElement>();
const pageSizes = new Map<number, { width: number; height: number }>();
const visiblePages = new Set<number>();
const renderTasks = new Map<number, RenderTask>();
const renderPromises = new Map<number, Promise<void>>();
const requestVersions = new Map<number, number>();
const targetWidths = new Map<number, number>();
const renderedWidths = new Map<number, number>();
let documentProxy: PDFDocumentProxy | null = null;
let generation = 0;
let visibilityFrame: number | null = null;
let previousBodyOverflow = "";
let previousFocusElement: HTMLElement | null = null;

const lowerName = computed(() => props.fileName.toLowerCase());
const isPdf = computed(
  () =>
    props.mimeType === "application/pdf" || lowerName.value.endsWith(".pdf"),
);
const isImage = computed(
  () =>
    props.mimeType.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif)$/.test(lowerName.value),
);
const isDocx = computed(
  () =>
    props.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.value.endsWith(".docx"),
);

function setPageCanvas(pageNumber: number, element: unknown) {
  if (element instanceof HTMLCanvasElement) canvases.set(pageNumber, element);
  else canvases.delete(pageNumber);
}

function fillWhite(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function resetCanvas(pageNumber: number) {
  const canvas = canvases.get(pageNumber);
  const size = pageSizes.get(pageNumber);
  if (!canvas || !size) return;
  const placeholder = getPdfPreviewPlaceholderMetrics(size.width, size.height);
  canvas.width = placeholder.pixelWidth;
  canvas.height = placeholder.pixelHeight;
  renderedWidths.delete(pageNumber);
  fillWhite(canvas);
}

function isCancelled(error: unknown) {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function renderPage(pageNumber: number, currentGeneration: number) {
  const pdf = documentProxy;
  const canvas = canvases.get(pageNumber);
  const size = pageSizes.get(pageNumber);
  if (!pdf || !canvas || !size || generation !== currentGeneration) {
    return Promise.resolve();
  }
  const displayWidth = canvas.parentElement?.clientWidth || size.width;
  const metrics = getPdfPreviewRenderMetrics(
    size.width,
    size.height,
    displayWidth,
    window.devicePixelRatio,
  );
  const existing = renderPromises.get(pageNumber);
  if (targetWidths.get(pageNumber) === metrics.pixelWidth) {
    return existing || Promise.resolve();
  }
  if (!existing && renderedWidths.get(pageNumber) === metrics.pixelWidth) {
    return Promise.resolve();
  }

  const requestVersion = (requestVersions.get(pageNumber) || 0) + 1;
  requestVersions.set(pageNumber, requestVersion);
  targetWidths.set(pageNumber, metrics.pixelWidth);
  renderTasks.get(pageNumber)?.cancel();
  const previous = renderPromises.get(pageNumber);

  const promise = (async () => {
    if (previous) await previous;
    if (
      generation !== currentGeneration ||
      requestVersions.get(pageNumber) !== requestVersion ||
      !visiblePages.has(pageNumber)
    ) {
      return;
    }
    let page: PDFPageProxy | null = null;
    let task: RenderTask | null = null;
    try {
      page = await pdf.getPage(pageNumber);
      if (
        generation !== currentGeneration ||
        requestVersions.get(pageNumber) !== requestVersion ||
        !visiblePages.has(pageNumber)
      ) {
        return;
      }
      const viewport = page.getViewport({ scale: metrics.renderScale });
      canvas.width = metrics.pixelWidth;
      canvas.height = metrics.pixelHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建文件预览画布");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      fillWhite(canvas);
      task = page.render({ canvasContext: context, viewport });
      renderTasks.set(pageNumber, task);
      await task.promise;
      if (
        generation === currentGeneration &&
        requestVersions.get(pageNumber) === requestVersion
      ) {
        renderedWidths.set(pageNumber, metrics.pixelWidth);
      }
    } catch (error) {
      if (!isCancelled(error) && generation === currentGeneration) {
        errorMessage.value = "文件页面渲染失败，请重新打开预览";
      }
    } finally {
      if (task && renderTasks.get(pageNumber) === task) {
        renderTasks.delete(pageNumber);
      }
      page?.cleanup();
    }
  })();
  renderPromises.set(pageNumber, promise);
  void promise.finally(() => {
    if (renderPromises.get(pageNumber) === promise) {
      renderPromises.delete(pageNumber);
    }
  });
  return promise;
}

function updateVisiblePages(renderVisible = true) {
  if (!overlayRef.value) return [];
  const bounds = overlayRef.value.getBoundingClientRect();
  const preload = Math.max(overlayRef.value.clientHeight, 1);
  const visible: number[] = [];
  for (const [pageNumber, canvas] of canvases) {
    const pageBounds = canvas.parentElement?.getBoundingClientRect();
    if (!pageBounds) continue;
    const shouldRender =
      pageBounds.bottom >= bounds.top - preload &&
      pageBounds.top <= bounds.bottom + preload;
    if (shouldRender) {
      visiblePages.add(pageNumber);
      visible.push(pageNumber);
      if (renderVisible) void renderPage(pageNumber, generation);
    } else {
      visiblePages.delete(pageNumber);
    }
  }
  return visible;
}

function scheduleVisiblePageUpdate() {
  if (visibilityFrame !== null) return;
  visibilityFrame = window.requestAnimationFrame(() => {
    visibilityFrame = null;
    updateVisiblePages();
  });
}

async function dispose() {
  if (visibilityFrame !== null) window.cancelAnimationFrame(visibilityFrame);
  visibilityFrame = null;
  for (const task of renderTasks.values()) task.cancel();
  await Promise.allSettled([...renderPromises.values()]);
  renderTasks.clear();
  renderPromises.clear();
  requestVersions.clear();
  targetWidths.clear();
  renderedWidths.clear();
  visiblePages.clear();
  pageSizes.clear();
  const currentDocument = documentProxy;
  documentProxy = null;
  await currentDocument?.destroy();
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = "";
}

async function loadPreview() {
  const currentGeneration = ++generation;
  loading.value = true;
  errorMessage.value = "";
  pageNumbers.value = [];
  canvases.clear();
  await dispose();
  try {
    if (!props.url || (!isPdf.value && !isImage.value && !isDocx.value)) {
      throw new Error("当前文件格式不支持在线预览");
    }
    const response = await api.get(props.url, { responseType: "arraybuffer" });
    if (generation !== currentGeneration) return;
    const bytes = new Uint8Array(response.data);
    if (isPdf.value) {
      const pdfjs = await loadPdfJs();
      const loadingTask = pdfjs.getDocument({
        data: bytes,
        cMapUrl: "/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/standard_fonts/",
      });
      const pdf = await loadingTask.promise;
      if (generation !== currentGeneration) {
        await pdf.destroy();
        return;
      }
      documentProxy = pdf;
      pageNumbers.value = Array.from(
        { length: pdf.numPages },
        (_, index) => index + 1,
      );
      await nextTick();
      for (const pageNumber of pageNumbers.value) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        pageSizes.set(pageNumber, {
          width: viewport.width,
          height: viewport.height,
        });
        resetCanvas(pageNumber);
        page.cleanup();
      }
      const initial = updateVisiblePages(false);
      const firstPage = initial[0] || 1;
      visiblePages.add(firstPage);
      await renderPage(firstPage, currentGeneration);
      updateVisiblePages();
    } else if (isImage.value) {
      imageUrl.value = URL.createObjectURL(
        new Blob([bytes], {
          type: props.mimeType || "application/octet-stream",
        }),
      );
    } else {
      await nextTick();
      if (!docxContainer.value) return;
      const { renderAsync } = await import("docx-preview");
      await renderAsync(bytes.buffer, docxContainer.value, undefined, {
        className: "contract-docx",
        inWrapper: true,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
      });
    }
  } catch (error) {
    if (generation === currentGeneration) {
      errorMessage.value =
        error instanceof Error ? error.message : "文件预览失败";
    }
  } finally {
    if (generation === currentGeneration) loading.value = false;
  }
}

function blockShortcut(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("close");
    return;
  }
  if (event.key === "Tab") {
    const buttons = Array.from(
      overlayRef.value?.querySelectorAll<HTMLElement>(
        ".preview-actions button:not(:disabled)",
      ) || [],
    );
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (
      !buttons.includes(document.activeElement as HTMLElement) ||
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
    return;
  }
  if (!(event.ctrlKey || event.metaKey)) return;
  if (!["s", "p"].includes(event.key.toLowerCase())) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

watch(
  () => [props.visible, props.url, props.fileName, props.mimeType],
  ([visible]) => {
    if (visible) {
      previousFocusElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", blockShortcut, true);
      window.addEventListener("resize", scheduleVisiblePageUpdate, {
        passive: true,
      });
      void nextTick(() => backButtonRef.value?.focus({ preventScroll: true }));
      void loadPreview();
    } else {
      generation += 1;
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("keydown", blockShortcut, true);
      window.removeEventListener("resize", scheduleVisiblePageUpdate);
      void dispose();
      previousFocusElement?.focus({ preventScroll: true });
      previousFocusElement = null;
    }
  },
  { immediate: true, flush: "post" },
);

onBeforeUnmount(() => {
  generation += 1;
  document.body.style.overflow = previousBodyOverflow;
  document.removeEventListener("keydown", blockShortcut, true);
  window.removeEventListener("resize", scheduleVisiblePageUpdate);
  void dispose();
  previousFocusElement?.focus({ preventScroll: true });
  previousFocusElement = null;
});
</script>

<style scoped>
.contract-readonly-overlay {
  position: fixed;
  z-index: 9999;
  inset: 0;
  overflow: auto;
  background: #d8dde2;
  user-select: none;
}
.preview-actions {
  position: fixed;
  z-index: 4;
  top: max(16px, env(safe-area-inset-top));
  left: max(16px, env(safe-area-inset-left));
  display: flex;
  gap: 6px;
  padding: 5px;
  border: 1px solid rgb(255 255 255 / 72%);
  border-radius: 14px;
  background: rgb(255 255 255 / 92%);
  box-shadow:
    0 12px 32px rgb(31 52 65 / 15%),
    0 2px 8px rgb(31 52 65 / 8%);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
}
.preview-action {
  display: inline-flex;
  min-width: 82px;
  height: 40px;
  padding: 0 15px;
  border: 0;
  border-radius: 10px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}
.preview-action .el-icon {
  font-size: 17px;
}
.preview-action.back {
  background: transparent;
  color: #29495c;
}
.preview-action.back:hover {
  background: #edf4f4;
  color: #176f68;
}
.preview-action.download {
  background: #176f70;
  box-shadow: 0 5px 14px rgb(23 111 112 / 24%);
  color: #fff;
}
.preview-action.download:hover {
  background: #0f5f60;
  box-shadow: 0 7px 18px rgb(23 111 112 / 30%);
}
.preview-action:hover {
  transform: translateY(-1px);
}
.preview-action:active {
  transform: translateY(0);
}
.preview-action:focus-visible {
  outline: 2px solid #2a8f86;
  outline-offset: 2px;
}
.pdf-pages,
.docx-preview {
  display: grid;
  justify-items: center;
  gap: 18px;
  min-height: 100vh;
  padding: 18px;
}
.pdf-sheet {
  width: min(1100px, 100%);
  overflow: hidden;
  background: #fff;
  box-shadow: 0 5px 20px rgb(24 43 58 / 20%);
}
.pdf-sheet canvas {
  display: block;
  width: 100%;
  height: auto;
}
.image-preview {
  display: block;
  max-width: 100%;
  min-height: 100vh;
  margin: 0 auto;
  object-fit: contain;
  background: #fff;
}
.docx-preview {
  align-content: start;
}
.docx-preview :deep(.contract-docx-wrapper) {
  padding: 0;
  background: transparent;
}
.docx-preview :deep(.contract-docx) {
  margin: 0 auto 18px;
  box-shadow: 0 5px 20px rgb(24 43 58 / 20%);
}
.preview-loading,
.preview-state {
  position: fixed;
  z-index: 2;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  background: rgb(216 221 226 / 88%);
  color: #5d6e7a;
}
.preview-state.error {
  color: #b42318;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

@media (max-width: 640px) {
  .preview-actions {
    top: max(10px, env(safe-area-inset-top));
    left: max(10px, env(safe-area-inset-left));
    padding: 4px;
    border-radius: 12px;
  }
  .preview-action {
    min-width: 72px;
    height: 44px;
    padding: 0 12px;
  }
  .pdf-pages,
  .docx-preview {
    padding-top: 72px;
  }
  .image-preview {
    min-height: calc(100vh - 68px);
    margin-top: 68px;
  }
}

@media print {
  .contract-readonly-overlay,
  .preview-actions {
    display: none !important;
  }
}
</style>
