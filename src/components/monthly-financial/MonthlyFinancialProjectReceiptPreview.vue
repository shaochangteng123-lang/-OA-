<template>
  <section
    ref="previewRoot"
    class="project-receipt-preview"
    aria-label="付款回单（回款凭证）"
  >
    <header class="receipt-preview-heading">
      <strong>付款回单（回款凭证）</strong>
      <span v-if="evidence.length"
        >{{ selectedIndex + 1 }} / {{ evidence.length }}</span
      >
    </header>
    <div v-if="evidence.length > 1" class="receipt-preview-switcher">
      <button
        type="button"
        aria-label="上一张回单"
        :disabled="selectedIndex === 0"
        @click="selectReceipt(selectedIndex - 1)"
      >
        上一张
      </button>
      <select
        :value="selectedIndex"
        aria-label="选择项目回单"
        @change="handleReceiptChange"
      >
        <option
          v-for="(receipt, index) in evidence"
          :key="receipt.receiptId"
          :value="index"
        >
          {{ index + 1 }} · {{ receipt.receiptNumber || "银行回单号未提供" }} ·
          {{ receipt.fileName || "文件未提供" }}
        </option>
      </select>
      <button
        type="button"
        aria-label="下一张回单"
        :disabled="selectedIndex >= evidence.length - 1"
        @click="selectReceipt(selectedIndex + 1)"
      >
        下一张
      </button>
    </div>
    <div v-if="selectedReceipt" class="receipt-preview-description">
      <span>银行回单号：{{ selectedReceipt.receiptNumber || "未提供" }}</span>
      <span v-if="selectedReceipt.transactionSerialNo"
        >银行流水号：{{ selectedReceipt.transactionSerialNo }}</span
      >
      <span v-if="selectedReceipt.bankName"
        >银行：{{ selectedReceipt.bankName }}</span
      >
      <span v-if="selectedReceipt.fileName">{{
        selectedReceipt.fileName
      }}</span>
    </div>
    <div v-if="loading" class="receipt-preview-state" role="status">
      <span>正在加载所选期间的回单…</span>
      <button
        type="button"
        class="receipt-preview-cancel"
        @click="cancelPreview"
      >
        取消预览
      </button>
    </div>
    <p v-else-if="error" class="receipt-preview-error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="!objectUrl" class="receipt-preview-state" role="status">
      {{ idleMessage }}
    </p>
    <img
      v-if="objectUrl && fileKind === 'image'"
      :key="objectUrl"
      :src="objectUrl"
      class="receipt-preview-image"
      :alt="previewTitle"
      @error="handleFileError"
    />
    <iframe
      v-else-if="objectUrl && fileKind === 'pdf'"
      :key="objectUrl"
      :src="objectUrl"
      class="receipt-preview-pdf"
      :title="previewTitle"
      @error="handleFileError"
    />
    <div
      v-if="selectedReceipt?.previewUrl && !loading"
      class="receipt-preview-actions"
    >
      <button type="button" class="receipt-preview-retry" @click="loadPreview">
        {{ objectUrl ? "重新加载" : "预览回单" }}
      </button>
      <button
        v-if="objectUrl"
        type="button"
        class="receipt-preview-close"
        @click="closePreview"
      >
        关闭预览
      </button>
    </div>
  </section>
</template>

<script lang="ts">
import type { FinancialAnalysisProjectReceipt } from "@/types/monthlyFinancialAnalysis";

export interface ProjectReceiptScope {
  rootContractId: string;
  periodKey: string;
  from: string;
  to: string;
}
const RECEIPT_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const RECEIPT_MONTH_PATTERN = /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/u;

function validReceiptScope(scope: ProjectReceiptScope) {
  if (
    !RECEIPT_ID_PATTERN.test(scope.rootContractId) ||
    !RECEIPT_MONTH_PATTERN.test(scope.from) ||
    !RECEIPT_MONTH_PATTERN.test(scope.to) ||
    scope.from > scope.to
  )
    return false;
  if (RECEIPT_MONTH_PATTERN.test(scope.periodKey))
    return scope.from === scope.periodKey && scope.to === scope.periodKey;
  if (/^(?:19|20)\d{2}$/u.test(scope.periodKey))
    return (
      scope.from.slice(0, 4) === scope.periodKey &&
      scope.to.slice(0, 4) === scope.periodKey
    );
  if (/^(?:19|20)\d{2}-Q[1-4]$/u.test(scope.periodKey)) {
    const quarterKey = (month: string) =>
      month.slice(0, 4) + "-Q" + Math.ceil(Number(month.slice(5)) / 3);
    return (
      quarterKey(scope.from) === scope.periodKey &&
      quarterKey(scope.to) === scope.periodKey
    );
  }
  return false;
}
function receiptDateMonth(date: string) {
  const match =
    typeof date === "string"
      ? date.match(/^((\d{4})-(0[1-9]|1[0-2]))-(0[1-9]|[12]\d|3[01])$/u)
      : null;
  if (!match) return null;
  const year = Number(match[2]),
    month = Number(match[3]),
    day = Number(match[4]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <=
    [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    ? match[1]
    : null;
}
function receiptSignature(receipt: FinancialAnalysisProjectReceipt) {
  return JSON.stringify([
    receipt.rootContractId,
    receipt.receiptId,
    receipt.periodKey,
    receipt.from,
    receipt.to,
    receipt.projectNumber,
    receipt.projectNumberSource,
    receipt.receiptDate,
    receipt.amount,
    receipt.receiptNumber,
    receipt.receiptNumberSource,
    receipt.transactionSerialNo,
    receipt.bankName,
    receipt.fileName,
    receipt.mimeType,
    receipt.previewUrl,
    receipt.previewUnavailableReason,
  ]);
}
/** 先核对项目、期间与真实回款日，再合并同一回单；冲突项不能任取一张原件。 */
export function scopedProjectReceiptEvidence(
  receipts: readonly FinancialAnalysisProjectReceipt[],
  scope: ProjectReceiptScope,
): FinancialAnalysisProjectReceipt[] {
  if (!validReceiptScope(scope)) return [];
  const byId = new Map<
    string,
    {
      receipt: FinancialAnalysisProjectReceipt;
      signature: string;
      conflicted: boolean;
    }
  >();
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (!receipt || typeof receipt !== "object") continue;
    const month = receiptDateMonth(receipt.receiptDate);
    if (
      receipt.rootContractId !== scope.rootContractId ||
      receipt.periodKey !== scope.periodKey ||
      receipt.from !== scope.from ||
      receipt.to !== scope.to ||
      !RECEIPT_ID_PATTERN.test(receipt.receiptId) ||
      !month ||
      month < scope.from ||
      month > scope.to
    )
      continue;
    const signature = receiptSignature(receipt);
    const existing = byId.get(receipt.receiptId);
    if (!existing) {
      byId.set(receipt.receiptId, {
        receipt: { ...receipt },
        signature,
        conflicted: false,
      });
      continue;
    }
    if (existing.conflicted || existing.signature === signature) continue;
    existing.conflicted = true;
    existing.receipt = {
      ...existing.receipt,
      projectNumber: null,
      projectNumberSource: "回单信息冲突",
      receiptNumber: null,
      receiptNumberSource: null,
      transactionSerialNo: null,
      bankName: null,
      fileName: null,
      mimeType: null,
      previewUrl: null,
      previewUnavailableReason:
        "同一回单信息存在冲突，编号和原件暂不展示，请核对。",
    };
  }
  return Array.from(byId.values()).map((entry) => entry.receipt);
}
/** 只接受匹配该项目、该回单和该期间的同源专用预览接口，返回规范化路径。 */
export function safeProjectReceiptPreviewUrl(
  receipt: FinancialAnalysisProjectReceipt,
  scope: ProjectReceiptScope,
  origin: string,
): string | null {
  if (
    !validReceiptScope(scope) ||
    receipt.rootContractId !== scope.rootContractId ||
    receipt.periodKey !== scope.periodKey ||
    receipt.from !== scope.from ||
    receipt.to !== scope.to ||
    !RECEIPT_ID_PATTERN.test(receipt.receiptId)
  )
    return null;
  const raw = receipt.previewUrl;
  if (
    typeof raw !== "string" ||
    !raw ||
    raw.trim() !== raw ||
    Array.from(raw).some(
      (character) =>
        character.charCodeAt(0) <= 32 ||
        character.charCodeAt(0) === 127 ||
        character === "\\",
    ) ||
    raw.startsWith("//") ||
    raw.includes("#") ||
    (!raw.startsWith("/") && !/^https?:\/\//u.test(raw)) ||
    /(?:%2e|%2f|%5c)/iu.test(raw)
  )
    return null;
  const expectedPath =
    "/api/monthly-financial-reports/analysis/projects/" +
    encodeURIComponent(scope.rootContractId) +
    "/receipts/" +
    encodeURIComponent(receipt.receiptId) +
    "/preview";
  try {
    const parsed = new URL(raw, origin);
    if (
      !/^https?:$/u.test(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.pathname !== expectedPath ||
      raw.includes("/../") ||
      raw.includes("/./")
    )
      return null;
    const parameters = Array.from(parsed.searchParams.entries());
    if (
      parameters.length !== 3 ||
      parsed.searchParams.getAll("from").length !== 1 ||
      parsed.searchParams.getAll("to").length !== 1 ||
      parsed.searchParams.getAll("evidenceVersion").length !== 1 ||
      parsed.searchParams.get("from") !== scope.from ||
      parsed.searchParams.get("to") !== scope.to ||
      !/^[a-f0-9]{64}$/u.test(parsed.searchParams.get("evidenceVersion") || "")
    )
      return null;
    return (
      expectedPath +
      "?from=" +
      encodeURIComponent(scope.from) +
      "&to=" +
      encodeURIComponent(scope.to) +
      "&evidenceVersion=" +
      parsed.searchParams.get("evidenceVersion")
    );
  } catch {
    return null;
  }
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getMonthlyFinancialProjectReceiptPreview } from "@/utils/monthlyFinancialAnalysisApi";

const props = withDefaults(
  defineProps<
    ProjectReceiptScope & { receipts?: FinancialAnalysisProjectReceipt[] }
  >(),
  { receipts: () => [] },
);
const evidence = computed(() =>
  scopedProjectReceiptEvidence(props.receipts, props),
);
const selectedIndex = ref(0);
const selectedReceipt = computed(() => evidence.value[selectedIndex.value]);
const previewRoot = ref<HTMLElement | null>(null);
const objectUrl = ref("");
const fileKind = ref<"pdf" | "image" | "">("");
const loading = ref(false);
const error = ref("");
const closed = ref(false);
const visible = ref(typeof globalThis.IntersectionObserver !== "function");
let observer: globalThis.IntersectionObserver | null = null;
let controller: AbortController | null = null;
let generation = 0;
let disposed = false;
const scopeKey = computed(() =>
  JSON.stringify([props.rootContractId, props.periodKey, props.from, props.to]),
);
const evidenceKey = computed(() => JSON.stringify(evidence.value));
const previewTitle = computed(
  () =>
    (selectedReceipt.value?.fileName || "付款回单") +
    " · " +
    props.from +
    " 至 " +
    props.to,
);
const idleMessage = computed(() => {
  if (!selectedReceipt.value) return "未提供该项目所选期间的付款回单。";
  if (!selectedReceipt.value.previewUrl)
    return selectedReceipt.value.previewUnavailableReason || "未提供回单文件。";
  return closed.value
    ? "预览已关闭；可重新预览当前回单。"
    : "回单将在当前区域可见时加载。";
});
function clearPreview() {
  generation += 1;
  controller?.abort();
  controller = null;
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = "";
  fileKind.value = "";
  loading.value = false;
}
async function loadPreview() {
  clearPreview();
  error.value = "";
  closed.value = false;
  if (disposed) return;
  visible.value = true;
  observer?.disconnect();
  observer = null;
  const receipt = selectedReceipt.value;
  if (!receipt?.previewUrl) return;
  const url = safeProjectReceiptPreviewUrl(
    receipt,
    props,
    window.location.origin,
  );
  if (!url) {
    error.value =
      "回单预览地址无效，已停止加载；不会使用其他项目或期间的文件。";
    return;
  }
  const sequence = generation;
  const request = new AbortController();
  controller = request;
  loading.value = true;
  try {
    const response = await getMonthlyFinancialProjectReceiptPreview(
      url,
      request.signal,
    );
    if (disposed || request.signal.aborted || sequence !== generation) return;
    const blob = response.data;
    if (!(blob instanceof Blob) || blob.size === 0)
      throw new Error("回单文件为空或无法读取。");
    const mime = String(response.headers?.["content-type"] || blob.type || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const kind =
      mime === "application/pdf"
        ? "pdf"
        : [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/bmp",
            ].includes(mime)
          ? "image"
          : "";
    if (!kind)
      throw new Error("该回单格式不支持安全的行内预览，请核对原件格式。");
    fileKind.value = kind;
    objectUrl.value = URL.createObjectURL(
      blob.type === mime ? blob : new Blob([blob], { type: mime }),
    );
  } catch (caught) {
    if (disposed || request.signal.aborted || sequence !== generation) return;
    const status = (caught as { response?: { status?: number } })?.response
      ?.status;
    error.value =
      status === 401 || status === 403
        ? "登录或查看回单权限已失效，已清除预览。"
        : status === 409
          ? "回单资料已变化，请刷新财务分析后再预览。"
          : status === 404
            ? "回单文件未提供或已失效，请核对原件。"
            : caught instanceof Error && /[\u3400-\u9fff]/u.test(caught.message)
              ? caught.message
              : "回单预览失败，请稍后重试；不会替换成其他回单。";
  } finally {
    if (!disposed && sequence === generation) {
      loading.value = false;
      controller = null;
    }
  }
}
function selectReceipt(index: number) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= evidence.value.length ||
    index === selectedIndex.value
  )
    return;
  selectedIndex.value = index;
  void loadPreview();
}
function handleReceiptChange(event: Event) {
  selectReceipt(Number((event.target as globalThis.HTMLSelectElement).value));
}
function closePreview() {
  clearPreview();
  error.value = "";
  closed.value = true;
}
function cancelPreview() {
  closePreview();
}
function handleFileError(event: Event) {
  const target = event.target as
    | globalThis.HTMLImageElement
    | globalThis.HTMLIFrameElement
    | null;
  if (!objectUrl.value || target?.getAttribute("src") !== objectUrl.value)
    return;
  clearPreview();
  error.value = "回单无法显示，请重新加载或核对原件。";
}
watch(
  [scopeKey, evidenceKey],
  () => {
    clearPreview();
    error.value = "";
    closed.value = false;
    selectedIndex.value = 0;
    if (visible.value) void loadPreview();
  },
  { immediate: true },
);
onMounted(() => {
  if (visible.value || typeof globalThis.IntersectionObserver !== "function")
    return;
  observer = new globalThis.IntersectionObserver(
    (entries) => {
      if (
        disposed ||
        visible.value ||
        !entries.some((entry) => entry.isIntersecting)
      )
        return;
      visible.value = true;
      observer?.disconnect();
      observer = null;
      void loadPreview();
    },
    { rootMargin: "160px 0px", threshold: 0.01 },
  );
  if (previewRoot.value) observer.observe(previewRoot.value);
});
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  observer = null;
  clearPreview();
});
</script>

<style scoped>
.project-receipt-preview {
  min-width: 0;
  overflow: hidden;
  border: 1px solid #dce8eb;
  border-radius: 8px;
  background: #f7fafb;
}
.receipt-preview-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  color: #3a6575;
  font-size: 12px;
}
.receipt-preview-heading span {
  color: #8497a2;
  font-size: 11px;
}
.receipt-preview-switcher {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 6px;
  padding: 0 10px 10px;
}
.receipt-preview-switcher select,
button {
  min-width: 0;
  border: 1px solid #cbdde3;
  border-radius: 5px;
  background: #fff;
  color: #476d7d;
  padding: 6px 8px;
  font: inherit;
  font-size: 11px;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.receipt-preview-description {
  display: grid;
  gap: 3px;
  padding: 0 12px 10px;
  color: #738a98;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.receipt-preview-state,
.receipt-preview-error {
  display: grid;
  justify-items: start;
  gap: 10px;
  margin: 0;
  padding: 24px 12px;
  color: #8197a2;
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.receipt-preview-error {
  color: #a05d48;
  background: #fff5f0;
}
.receipt-preview-image,
.receipt-preview-pdf {
  display: block;
  width: 100%;
  height: 350px;
  border: 0;
  object-fit: contain;
  background: #fff;
}
.receipt-preview-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
}
button:focus-visible,
select:focus-visible {
  outline: 2px solid #398e99;
  outline-offset: 2px;
}
@media (max-width: 600px) {
  .receipt-preview-image,
  .receipt-preview-pdf {
    height: 300px;
  }
  .receipt-preview-switcher {
    grid-template-columns: 1fr 1fr;
  }
  .receipt-preview-switcher select {
    grid-column: 1 / -1;
    grid-row: 1;
    width: 100%;
  }
}
</style>
