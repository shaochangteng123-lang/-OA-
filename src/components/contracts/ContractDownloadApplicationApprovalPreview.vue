<template>
  <section
    class="download-application-approval-preview"
    :aria-busy="loading || documentLoading"
    aria-label="合同附件下载申请单"
  >
    <div v-if="documentError" class="preview-error" role="alert">
      <strong>合同附件下载申请单加载失败</strong>
      <span>{{ documentError }}</span>
    </div>

    <div v-else class="document-page">
      <canvas ref="pageCanvas" aria-label="合同附件下载申请单首页预览" />

      <button
        v-if="signable && !documentLoading"
        type="button"
        class="manager-paper-signature-slot"
        :class="{ 'is-signed': Boolean(signatureDataUrl) }"
        :disabled="disabled || signatureLoading || Boolean(signatureDataUrl)"
        :aria-label="
          signatureDataUrl
            ? '总经理审批签署，本人签名已确认，等待提交'
            : '总经理审批签署，点击进行签名'
        "
        @click="emit('sign')"
      >
        <template v-if="signatureDataUrl">
          <img :src="signatureDataUrl" alt="总经理本人电子签名" />
          <span>本人签名已确认 · 待提交</span>
        </template>
        <template v-else>
          <strong>总经理审批签署</strong>
          <span>{{ signatureLoading ? "正在准备签名…" : "点击此处签名" }}</span>
        </template>
      </button>

      <div v-if="loading || documentLoading" class="preview-loading">
        <el-icon class="is-loading" :size="28"><Loading /></el-icon>
        <span>正在加载合同附件下载申请单…</span>
      </div>
    </div>

    <p v-if="signatureError" class="signature-error" role="alert">
      {{ signatureError }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { Loading } from "@element-plus/icons-vue";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { api } from "@/utils/api";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

const props = withDefaults(
  defineProps<{
    url?: string;
    loading?: boolean;
    signable?: boolean;
    disabled?: boolean;
    signatureLoading?: boolean;
    signatureDataUrl?: string;
    signatureError?: string;
  }>(),
  {
    url: "",
    loading: false,
    signable: false,
    disabled: false,
    signatureLoading: false,
    signatureDataUrl: "",
    signatureError: "",
  },
);

const emit = defineEmits<{
  sign: [];
}>();

const pageCanvas = ref<HTMLCanvasElement | null>(null);
const documentLoading = ref(false);
const documentError = ref("");
let activeDocument: PDFDocumentProxy | null = null;
let activeRenderTask: RenderTask | null = null;
let renderSequence = 0;

async function releaseDocument() {
  activeRenderTask?.cancel();
  activeRenderTask = null;
  if (activeDocument) {
    await activeDocument.destroy();
    activeDocument = null;
  }
}

async function renderDocument() {
  const sequence = ++renderSequence;
  documentError.value = "";
  await releaseDocument();
  if (!props.url) {
    documentLoading.value = false;
    return;
  }
  documentLoading.value = true;
  try {
    const response = await api.get(props.url.split("#")[0], {
      responseType: "arraybuffer",
    });
    if (sequence !== renderSequence) return;
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(response.data),
      cMapUrl: "/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/standard_fonts/",
    });
    const document = await loadingTask.promise;
    if (sequence !== renderSequence) {
      await document.destroy();
      return;
    }
    activeDocument = document;
    const page = await document.getPage(1);
    if (sequence !== renderSequence || !pageCanvas.value) return;
    const viewport = page.getViewport({ scale: 2 });
    const canvas = pageCanvas.value;
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法显示合同附件下载申请单");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    activeRenderTask = page.render({ canvasContext: context, viewport });
    await activeRenderTask.promise;
  } catch (error) {
    if (
      sequence === renderSequence &&
      !(error instanceof pdfjsLib.RenderingCancelledException)
    ) {
      documentError.value =
        error instanceof Error ? error.message : "合同附件下载申请单加载失败";
    }
  } finally {
    if (sequence === renderSequence) {
      activeRenderTask = null;
      documentLoading.value = false;
    }
  }
}

watch(
  () => props.url,
  () => void renderDocument(),
  { immediate: true, flush: "post" },
);

onBeforeUnmount(() => {
  renderSequence += 1;
  void releaseDocument();
});
</script>

<style scoped>
.download-application-approval-preview {
  width: min(820px, 100%);
  margin: 16px auto 0;
}
.document-page {
  position: relative;
  overflow: hidden;
  border: 1px solid #d7e1e5;
  border-radius: 12px;
  background: #dfe4e8;
  box-shadow: 0 12px 30px rgb(27 54 75 / 12%);
}
.document-page canvas {
  display: block;
  width: 100%;
  height: auto;
  background: #fff;
}
.manager-paper-signature-slot {
  position: absolute;
  z-index: 2;
  top: 79.34%;
  left: 51.91%;
  display: flex;
  width: 40.99%;
  height: 15.68%;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 5px;
  overflow: hidden;
  border: 2px solid rgb(28 141 126 / 72%);
  border-radius: 10px;
  background: rgb(239 250 247 / 88%);
  color: #116d63;
  cursor: pointer;
  font: inherit;
  text-align: center;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}
.manager-paper-signature-slot:hover:not(:disabled),
.manager-paper-signature-slot:focus-visible {
  border-color: #0f8275;
  background: rgb(232 248 244 / 95%);
  box-shadow: 0 0 0 4px rgb(15 130 117 / 15%);
  outline: none;
}
.manager-paper-signature-slot:disabled {
  cursor: not-allowed;
}
.manager-paper-signature-slot.is-signed {
  border-style: solid;
  background: rgb(232 248 244 / 92%);
  opacity: 1;
}
.manager-paper-signature-slot strong {
  font-size: clamp(11px, 1.45vw, 16px);
}
.manager-paper-signature-slot span {
  font-size: clamp(9px, 1.05vw, 12px);
}
.manager-paper-signature-slot img {
  width: 58%;
  max-height: 54%;
  object-fit: contain;
}
.preview-loading {
  position: absolute;
  z-index: 3;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  background: rgb(239 243 246 / 88%);
  color: #657987;
}
.preview-error {
  display: flex;
  min-height: 260px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  padding: 24px;
  border: 1px solid #f2c7c7;
  border-radius: 12px;
  background: #fff6f6;
  color: #b42318;
  text-align: center;
}
.signature-error {
  margin: 10px 0 0;
  color: #b42318;
  font-size: 13px;
  text-align: center;
}

@media (max-width: 640px) {
  .document-page {
    border-radius: 8px;
  }
  .manager-paper-signature-slot {
    border-width: 1px;
    border-radius: 6px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .manager-paper-signature-slot {
    transition: none;
  }
}
</style>
