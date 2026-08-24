<template>
  <section
    class="contract-file-preview"
    :class="{ compact }"
    aria-label="合同文件预览"
  >
    <div v-if="loading" class="preview-state" aria-live="polite">
      <el-icon class="is-loading" :size="28"><Loading /></el-icon>
      <span>正在准备文件预览…</span>
    </div>

    <template v-else-if="url">
      <iframe
        v-if="isPdf"
        :src="url"
        class="preview-frame"
        title="合同文件预览"
      />
      <img
        v-else-if="isImage"
        :src="url"
        class="preview-image"
        alt="合同文件预览"
      />
      <div v-else-if="isDocx && !documentError" class="docx-preview-shell">
        <div ref="docxContainer" class="docx-preview-scroll" />
        <div v-if="documentLoading" class="docx-loading" aria-live="polite">
          <el-icon class="is-loading" :size="28"><Loading /></el-icon>
          <span>正在解析 Word（文字处理）合同…</span>
        </div>
      </div>
      <div v-else class="preview-state document-state">
        <span class="document-icon"
          ><el-icon :size="42"><Document /></el-icon
        ></span>
        <strong>{{ fileName || "合同文档" }}</strong>
        <span>{{
          documentError || "当前格式请在新窗口中查看，识别过程不受影响。"
        }}</span>
        <el-button
          v-if="allowOpenExternal"
          type="primary"
          plain
          :icon="View"
          @click="openFile"
          >打开文件</el-button
        >
      </div>
    </template>

    <div v-else class="preview-state empty-state">
      <span class="document-icon"
        ><el-icon :size="42"><DocumentAdd /></el-icon
      ></span>
      <strong>等待上传合同文件</strong>
      <span>上传后可在此处查看合同原文，并逐项核对 OCR 转写（可能有误）。</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Document, DocumentAdd, Loading, View } from "@element-plus/icons-vue";

const props = withDefaults(
  defineProps<{
    url?: string;
    fileName?: string;
    mimeType?: string;
    loading?: boolean;
    compact?: boolean;
    allowOpenExternal?: boolean;
  }>(),
  {
    url: "",
    fileName: "",
    mimeType: "",
    loading: false,
    compact: false,
    allowOpenExternal: true,
  },
);

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
const docxContainer = ref<HTMLElement | null>(null);
const documentLoading = ref(false);
const documentError = ref("");
let documentRenderSequence = 0;

async function renderDocx() {
  const sequence = ++documentRenderSequence;
  documentError.value = "";
  if (!props.url || !isDocx.value || props.loading) {
    documentLoading.value = false;
    return;
  }
  documentLoading.value = true;
  try {
    const response = await fetch(props.url, { credentials: "include" });
    if (!response.ok) throw new Error("合同文件读取失败");
    const blob = await response.blob();
    await nextTick();
    if (sequence !== documentRenderSequence || !docxContainer.value) return;
    docxContainer.value.replaceChildren();
    const { renderAsync } = await import("docx-preview");
    await renderAsync(blob, docxContainer.value, undefined, {
      className: "contract-docx",
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
    });
  } catch (error) {
    if (sequence === documentRenderSequence) {
      documentError.value =
        error instanceof Error ? error.message : "合同文件预览失败";
    }
  } finally {
    if (sequence === documentRenderSequence) documentLoading.value = false;
  }
}

watch(
  () => [props.url, props.fileName, props.mimeType, props.loading],
  () => void renderDocx(),
  { immediate: true },
);

function openFile() {
  if (props.url) window.open(props.url, "_blank", "noopener,noreferrer");
}
</script>

<style scoped>
.contract-file-preview {
  position: relative;
  min-height: 620px;
  overflow: hidden;
  border: 1px solid #dfe7ee;
  border-radius: 12px;
  background: #eef2f5;
  box-shadow: inset 0 1px 0 #fff;
}

.contract-file-preview.compact {
  min-height: 420px;
}
.preview-frame {
  width: 100%;
  height: 100%;
  min-height: 620px;
  border: 0;
  background: #fff;
}
.compact .preview-frame {
  min-height: 420px;
}
.preview-image {
  width: 100%;
  height: 100%;
  min-height: 620px;
  object-fit: contain;
  background: #fff;
}
.compact .preview-image {
  min-height: 420px;
}
.docx-preview-shell {
  position: relative;
  min-height: 620px;
}
.docx-preview-scroll {
  height: 620px;
  min-height: 620px;
  overflow: auto;
  padding: 22px 12px;
  background: #dfe4e8;
}
.compact .docx-preview-scroll {
  height: 420px;
  min-height: 420px;
}
.docx-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgb(238 242 245 / 90%);
  color: #667b89;
}
.docx-preview-scroll :deep(.contract-docx-wrapper) {
  padding: 0;
  background: transparent;
}
.docx-preview-scroll :deep(.contract-docx) {
  margin: 0 auto 16px;
  box-shadow: 0 5px 18px rgb(25 45 60 / 16%);
}

.preview-state {
  min-height: 620px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  color: #708090;
  text-align: center;
}

.compact .preview-state {
  min-height: 420px;
}
.preview-state strong {
  color: #253e55;
  font-size: 16px;
}
.preview-state > span:not(.document-icon) {
  max-width: 360px;
  font-size: 13px;
  line-height: 1.7;
}
.document-icon {
  display: inline-flex;
  width: 76px;
  height: 76px;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: linear-gradient(145deg, #e0f1ef, #e8eff7);
  color: #247f83;
}

@media (max-width: 900px) {
  .contract-file-preview,
  .preview-frame,
  .preview-image,
  .preview-state,
  .docx-preview-scroll {
    min-height: 420px;
  }
}
</style>
