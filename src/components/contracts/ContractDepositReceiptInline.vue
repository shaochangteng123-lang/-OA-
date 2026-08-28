<template>
  <section class="deposit-receipt-panel" aria-label="押金条登记">
    <header class="deposit-receipt-heading">
      <div>
        <span>押金条留痕</span>
        <h4>{{ currentReceipt?.fileName || "上传押金条并识别金额" }}</h4>
        <p>押金金额以押金条为证据，不根据回单与发票差额自动推断。</p>
      </div>
      <div class="deposit-receipt-heading-actions">
        <el-tag :type="statusTagType" effect="plain">
          {{ statusLabel }}
        </el-tag>
        <el-button
          v-if="canDelete"
          link
          type="danger"
          :disabled="deleting"
          @click="showDeleteConfirmation = true"
        >
          删除押金条
        </el-button>
        <el-button
          v-else-if="canVoid"
          link
          type="danger"
          :disabled="voiding"
          @click="showVoidForm = true"
        >
          撤销押金登记
        </el-button>
      </div>
    </header>

    <el-alert
      v-if="pageError"
      type="error"
      show-icon
      closable
      :title="pageError"
      @close="pageError = ''"
    />

    <div v-if="showDeleteConfirmation" class="deposit-danger-confirmation">
      <div>
        <strong>确认删除这张误上传的押金条？</strong>
        <p>仅删除尚未验证的押金条，删除后可立即重新上传正确文件。</p>
      </div>
      <div class="deposit-danger-actions">
        <el-button :disabled="deleting" @click="showDeleteConfirmation = false">
          取消
        </el-button>
        <el-button type="danger" :loading="deleting" @click="deleteReceipt">
          确认删除
        </el-button>
      </div>
    </div>

    <el-form
      v-if="showVoidForm"
      class="deposit-void-form"
      label-position="top"
      @submit.prevent
    >
      <el-form-item label="撤销原因（必填）">
        <el-input
          v-model="voidReason"
          class="void-reason-input"
          type="textarea"
          :rows="3"
          maxlength="300"
          show-word-limit
          placeholder="请填写误登记原因，撤销记录和原因将永久留痕"
          :disabled="voiding"
        />
      </el-form-item>
      <div class="deposit-danger-actions">
        <el-button :disabled="voiding" @click="cancelVoid">取消</el-button>
        <el-button
          type="danger"
          :loading="voiding"
          :disabled="!voidReasonValid"
          @click="voidReceipt"
        >
          确认撤销
        </el-button>
      </div>
    </el-form>

    <el-upload
      v-if="!currentReceipt"
      ref="uploadRef"
      class="deposit-receipt-upload"
      drag
      :auto-upload="false"
      :show-file-list="false"
      :disabled="!canManage || uploading"
      :on-change="handleFileChange"
      accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
    >
      <div class="deposit-upload-content">
        <el-icon class="deposit-upload-icon"><UploadFilled /></el-icon>
        <strong>{{
          uploading ? "正在识别押金条…" : "拖拽或点击上传押金条"
        }}</strong>
        <small>
          支持 JPEG（联合图像专家组）、JPG（图像格式）、PNG（便携式网络图形）或
          PDF（便携式文档格式），单个文件不超过 30MB
        </small>
      </div>
    </el-upload>

    <section
      v-if="visibleVoidedReceipts.length"
      class="deposit-voided-history"
      aria-label="已撤销押金登记留痕"
    >
      <div class="deposit-voided-heading">
        <strong>已撤销押金登记留痕</strong>
        <el-tag type="danger" effect="plain">已撤销</el-tag>
      </div>
      <article v-for="receipt in visibleVoidedReceipts" :key="receipt.id">
        <strong>{{ receipt.fileName }}</strong>
        <dl>
          <div>
            <dt>原验证金额</dt>
            <dd>{{ formatContractMoney(receipt.verifiedAmount, "未记录") }}</dd>
          </div>
          <div>
            <dt>撤销操作人</dt>
            <dd>{{ receipt.voidedByName || receipt.voidedBy || "未记录" }}</dd>
          </div>
          <div>
            <dt>撤销时间</dt>
            <dd>{{ formatContractDateTime(receipt.voidedAt) }}</dd>
          </div>
          <div>
            <dt>撤销原因</dt>
            <dd>{{ receipt.voidReason || "未记录" }}</dd>
          </div>
        </dl>
      </article>
    </section>

    <div v-if="previewUrl" class="deposit-original-preview">
      <div class="deposit-preview-heading">
        <strong>押金条原件</strong>
        <span>{{ previewFileName }}</span>
      </div>
      <img
        v-if="previewIsImage"
        :src="previewUrl"
        :alt="`${previewFileName}原件预览`"
      />
      <iframe v-else :src="previewUrl" :title="`${previewFileName}原件预览`" />
    </div>

    <template v-if="currentReceipt">
      <div class="deposit-amount-summary">
        <div>
          <span>回单金额</span>
          <strong>{{ formatContractMoney(receiptAmount) }}</strong>
        </div>
        <div>
          <span>{{ depositAmountLabel }}</span>
          <strong>{{
            formatContractMoney(displayDepositAmount, "待验证")
          }}</strong>
        </div>
        <div :class="{ invalid: depositExceedsReceipt }">
          <span>合同款金额（回单减押金）</span>
          <strong>{{ contractPaymentDifferenceLabel }}</strong>
        </div>
      </div>

      <el-alert
        v-if="depositExceedsReceipt"
        class="deposit-validation-alert"
        type="error"
        show-icon
        :closable="false"
        title="押金金额超过当前回单金额，不能确认验证"
      />
      <el-alert
        v-else-if="recognitionNeedsManualInput"
        class="deposit-validation-alert"
        type="warning"
        show-icon
        :closable="false"
        title="未识别出押金金额，请管理员查看原件后手工填写并确认"
        :description="currentReceipt.recognitionMessage || undefined"
      />
      <el-alert
        v-else-if="currentReceipt.status === 'recognized'"
        class="deposit-validation-alert"
        type="info"
        show-icon
        :closable="false"
        title="已识别押金金额，请管理员对照原件确认"
      />

      <el-form
        v-if="canVerify"
        class="deposit-verification-form"
        label-position="top"
        @submit.prevent
      >
        <el-form-item label="押金金额">
          <el-input
            v-model="manualAmount"
            inputmode="decimal"
            placeholder="请输入押金条载明金额"
            :disabled="verifying"
          >
            <template #prepend>¥</template>
          </el-input>
        </el-form-item>
        <el-button
          type="primary"
          :loading="verifying"
          :disabled="!manualAmountValid"
          @click="verifyAmount"
        >
          确认验证
        </el-button>
      </el-form>
      <p
        v-else-if="currentReceipt.status !== 'verified'"
        class="deposit-readonly-hint"
      >
        等待管理员填写或确认押金金额。
      </p>

      <dl class="deposit-audit-trail">
        <div>
          <dt>上传操作人</dt>
          <dd>
            {{
              currentReceipt.createdByName ||
              currentReceipt.createdBy ||
              "未记录"
            }}
          </dd>
        </div>
        <div>
          <dt>上传时间</dt>
          <dd>{{ formatContractDateTime(currentReceipt.createdAt) }}</dd>
        </div>
        <div>
          <dt>验证操作人</dt>
          <dd>
            {{
              currentReceipt.verifiedByName ||
              currentReceipt.verifiedBy ||
              "待验证"
            }}
          </dd>
        </div>
        <div>
          <dt>验证时间</dt>
          <dd>{{ formatContractDateTime(currentReceipt.verifiedAt) }}</dd>
        </div>
      </dl>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { UploadFile, UploadInstance } from "element-plus";
import { ElMessage } from "element-plus";
import { UploadFilled } from "@element-plus/icons-vue";
import type { ContractDepositReceipt, MoneyValue } from "@/types/contract";
import {
  deleteContractDepositReceipt,
  getContractDepositReceiptFileUrl,
  getContractErrorMessage,
  uploadContractDepositReceipt,
  verifyContractDepositReceipt,
  voidContractDepositReceipt,
} from "@/utils/contractApi";
import {
  formatContractDateTime,
  formatContractMoney,
} from "@/utils/contractPresentation";

const MAX_DEPOSIT_RECEIPT_SIZE = 30 * 1024 * 1024;
const ALLOWED_DEPOSIT_RECEIPT_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf"];

const props = defineProps<{
  contractId: string;
  financialRecordId: string;
  receiptAmount: MoneyValue;
  confirmedDepositAmount?: MoneyValue | null;
  invoiceRequiredAmount?: MoneyValue | null;
  depositReceipt?: ContractDepositReceipt | null;
  voidedReceipts?: ContractDepositReceipt[];
  canManage?: boolean;
}>();

const emit = defineEmits<{
  updated: [receipt: ContractDepositReceipt];
  removed: [depositReceiptId: string];
}>();

const uploadRef = ref<UploadInstance>();
const currentReceipt = ref<ContractDepositReceipt | null>(
  props.depositReceipt || null,
);
const selectedFile = ref<File | null>(null);
const localPreviewUrl = ref("");
const manualAmount = ref("");
const pageError = ref("");
const uploading = ref(false);
const verifying = ref(false);
const deleting = ref(false);
const voiding = ref(false);
const showDeleteConfirmation = ref(false);
const showVoidForm = ref(false);
const voidReason = ref("");
const recentlyVoidedReceipts = ref<ContractDepositReceipt[]>([]);

watch(
  () => props.depositReceipt,
  (receipt) => {
    if (!receipt || receipt.status === "voided") {
      currentReceipt.value = null;
      manualAmount.value = "";
      return;
    }
    currentReceipt.value = receipt;
    manualAmount.value = String(
      receipt.verifiedAmount ?? receipt.ocrAmount ?? "",
    );
  },
  { immediate: true },
);

const previewUrl = computed(() => {
  if (localPreviewUrl.value) return localPreviewUrl.value;
  const receipt = currentReceipt.value;
  if (!receipt) return "";
  return (
    receipt.previewUrl ||
    getContractDepositReceiptFileUrl(
      props.contractId,
      props.financialRecordId,
      receipt.id,
    )
  );
});
const previewFileName = computed(
  () => currentReceipt.value?.fileName || selectedFile.value?.name || "押金条",
);
const previewIsImage = computed(() => {
  const mimeType =
    currentReceipt.value?.mimeType || selectedFile.value?.type || "";
  if (mimeType.startsWith("image/")) return true;
  return /\.(?:jpe?g|png)$/iu.test(previewFileName.value);
});
const numericReceiptAmount = computed(() => Number(props.receiptAmount || 0));
const parsedManualAmount = computed(() => {
  const source = manualAmount.value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(source)) return null;
  const value = Number(source);
  return Number.isFinite(value) ? value : null;
});
const displayDepositAmount = computed<MoneyValue | null>(() => {
  const receipt = currentReceipt.value;
  if (!receipt) return null;
  if (receipt.status === "verified") {
    const confirmedTotal = Number(props.confirmedDepositAmount);
    return Number.isFinite(confirmedTotal) && confirmedTotal > 0
      ? confirmedTotal
      : (receipt.verifiedAmount ?? null);
  }
  return parsedManualAmount.value ?? receipt.ocrAmount ?? null;
});
const numericDisplayDepositAmount = computed(() => {
  const amount = Number(displayDepositAmount.value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
});
const depositAmountLabel = computed(() =>
  currentReceipt.value?.status === "verified"
    ? "已验证押金金额"
    : ["manual_review", "failed"].includes(currentReceipt.value?.status || "")
      ? "待验证押金金额"
      : "OCR（光学字符识别）金额",
);
const contractPaymentDifference = computed(() => {
  if (
    currentReceipt.value?.status === "verified" &&
    Number(props.confirmedDepositAmount) > 0 &&
    props.invoiceRequiredAmount !== null &&
    props.invoiceRequiredAmount !== undefined
  ) {
    return Number(props.invoiceRequiredAmount);
  }
  if (numericDisplayDepositAmount.value === null) return null;
  return numericReceiptAmount.value - numericDisplayDepositAmount.value;
});
const contractPaymentDifferenceLabel = computed(() =>
  contractPaymentDifference.value === null
    ? "待验证后计算"
    : formatContractMoney(contractPaymentDifference.value),
);
const depositExceedsReceipt = computed(
  () =>
    numericDisplayDepositAmount.value !== null &&
    numericDisplayDepositAmount.value > numericReceiptAmount.value,
);
const recognitionNeedsManualInput = computed(() => {
  const receipt = currentReceipt.value;
  const ocrAmount = Number(receipt?.ocrAmount);
  return Boolean(
    receipt &&
    ["manual_review", "failed"].includes(receipt.status) &&
    (receipt.ocrAmount === null ||
      receipt.ocrAmount === undefined ||
      !Number.isFinite(ocrAmount)),
  );
});
const canVerify = computed(
  () =>
    Boolean(props.canManage) &&
    Boolean(currentReceipt.value) &&
    currentReceipt.value?.status !== "verified" &&
    currentReceipt.value?.status !== "recognizing",
);
const canDelete = computed(
  () =>
    Boolean(props.canManage) &&
    Boolean(currentReceipt.value) &&
    !["verified", "voided"].includes(currentReceipt.value?.status || "") &&
    !deleting.value,
);
const canVoid = computed(
  () =>
    Boolean(props.canManage) &&
    currentReceipt.value?.status === "verified" &&
    !voiding.value,
);
const trimmedVoidReason = computed(() => voidReason.value.trim());
const voidReasonValid = computed(
  () =>
    trimmedVoidReason.value.length > 0 &&
    trimmedVoidReason.value.length <= 300 &&
    !voiding.value,
);
const visibleVoidedReceipts = computed(() => {
  const receipts = [
    ...recentlyVoidedReceipts.value,
    ...(props.voidedReceipts || []),
  ];
  return receipts.filter(
    (receipt, index) =>
      receipt.status === "voided" &&
      receipts.findIndex((item) => item.id === receipt.id) === index,
  );
});
const manualAmountValid = computed(
  () =>
    parsedManualAmount.value !== null &&
    parsedManualAmount.value > 0 &&
    parsedManualAmount.value <= numericReceiptAmount.value &&
    !verifying.value,
);
const statusLabel = computed(() => {
  const status = currentReceipt.value?.status;
  if (!status) return uploading.value ? "识别中" : "待上传";
  return {
    recognizing: "识别中",
    recognized: "已识别·待确认",
    manual_review: "待手工验证",
    verified: "已验证",
    failed: "识别失败·待手工验证",
    voided: "已撤销",
  }[status];
});
const statusTagType = computed<"info" | "warning" | "success" | "danger">(
  () => {
    const status = currentReceipt.value?.status;
    if (status === "verified") return "success";
    if (status === "failed" || status === "voided") return "danger";
    if (status === "recognized" || status === "manual_review") return "warning";
    return "info";
  },
);

function releaseLocalPreview() {
  if (localPreviewUrl.value.startsWith("blob:")) {
    URL.revokeObjectURL(localPreviewUrl.value);
  }
  localPreviewUrl.value = "";
}

function validateFile(file: File): string {
  const lowerName = file.name.toLowerCase();
  if (
    !ALLOWED_DEPOSIT_RECEIPT_EXTENSIONS.some((extension) =>
      lowerName.endsWith(extension),
    )
  ) {
    return "押金条只支持 JPEG（联合图像专家组）、JPG（图像格式）、PNG（便携式网络图形）或 PDF（便携式文档格式）";
  }
  if (file.size > MAX_DEPOSIT_RECEIPT_SIZE) {
    return "押金条文件不能超过 30MB";
  }
  return "";
}

async function handleFileChange(uploadFile: UploadFile) {
  const file = uploadFile.raw;
  if (!file || uploading.value || !props.canManage) return;
  pageError.value = validateFile(file);
  if (pageError.value) {
    uploadRef.value?.clearFiles();
    return;
  }
  releaseLocalPreview();
  selectedFile.value = file;
  localPreviewUrl.value = URL.createObjectURL(file);
  uploading.value = true;
  try {
    const receipt = await uploadContractDepositReceipt(
      props.contractId,
      props.financialRecordId,
      file,
    );
    currentReceipt.value = receipt;
    manualAmount.value = String(
      receipt.verifiedAmount ?? receipt.ocrAmount ?? "",
    );
    ElMessage.success(
      receipt.ocrAmount === null || receipt.ocrAmount === undefined
        ? "押金条已留痕，请手工填写金额并确认"
        : "押金条金额已识别，请对照原件确认",
    );
    emit("updated", receipt);
  } catch (error) {
    pageError.value = getContractErrorMessage(error, "押金条上传或识别失败");
  } finally {
    uploading.value = false;
    uploadRef.value?.clearFiles();
  }
}

async function verifyAmount() {
  const receipt = currentReceipt.value;
  if (!receipt || !manualAmountValid.value || parsedManualAmount.value === null)
    return;
  pageError.value = "";
  verifying.value = true;
  try {
    const verified = await verifyContractDepositReceipt(
      props.contractId,
      props.financialRecordId,
      receipt.id,
      parsedManualAmount.value.toFixed(2),
    );
    currentReceipt.value = verified;
    manualAmount.value = String(
      verified.verifiedAmount ?? parsedManualAmount.value.toFixed(2),
    );
    ElMessage.success("押金金额已确认并留痕");
    emit("updated", verified);
  } catch (error) {
    pageError.value = getContractErrorMessage(error, "押金金额验证失败");
  } finally {
    verifying.value = false;
  }
}

function clearCurrentReceipt() {
  releaseLocalPreview();
  currentReceipt.value = null;
  selectedFile.value = null;
  manualAmount.value = "";
  showDeleteConfirmation.value = false;
  showVoidForm.value = false;
  voidReason.value = "";
  uploadRef.value?.clearFiles();
}

async function deleteReceipt() {
  const receipt = currentReceipt.value;
  if (!receipt || !canDelete.value) return;
  pageError.value = "";
  deleting.value = true;
  try {
    await deleteContractDepositReceipt(
      props.contractId,
      props.financialRecordId,
      receipt.id,
    );
    clearCurrentReceipt();
    ElMessage.success("误上传的押金条已删除，可重新上传");
    emit("removed", receipt.id);
  } catch (error) {
    pageError.value = getContractErrorMessage(error, "删除押金条失败");
  } finally {
    deleting.value = false;
  }
}

function cancelVoid() {
  showVoidForm.value = false;
  voidReason.value = "";
}

async function voidReceipt() {
  const receipt = currentReceipt.value;
  if (!receipt || receipt.status !== "verified" || !voidReasonValid.value)
    return;
  pageError.value = "";
  voiding.value = true;
  try {
    const voided = await voidContractDepositReceipt(
      props.contractId,
      props.financialRecordId,
      receipt.id,
      trimmedVoidReason.value,
    );
    recentlyVoidedReceipts.value = [
      voided,
      ...recentlyVoidedReceipts.value.filter((item) => item.id !== voided.id),
    ];
    clearCurrentReceipt();
    ElMessage.success("押金登记已撤销并留痕，可重新上传正确押金条");
    emit("updated", voided);
  } catch (error) {
    pageError.value = getContractErrorMessage(error, "撤销押金登记失败");
  } finally {
    voiding.value = false;
  }
}

onBeforeUnmount(releaseLocalPreview);
</script>

<style scoped>
.deposit-receipt-panel {
  display: grid;
  gap: 14px;
  padding: 15px;
  border: 1px solid #cfe4df;
  border-radius: 10px;
  background: #fff;
  box-shadow: inset 3px 0 0 #45a49a;
}
.deposit-receipt-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.deposit-receipt-heading span {
  color: #21877f;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.deposit-receipt-heading h4 {
  margin: 3px 0;
  color: #2d5064;
  font-size: 15px;
}
.deposit-receipt-heading p {
  margin: 0;
  color: #7e909b;
  font-size: 12px;
}
.deposit-receipt-heading-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}
.deposit-danger-confirmation,
.deposit-void-form {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  padding: 12px;
  border: 1px solid #f3c6c6;
  border-radius: 9px;
  background: #fff5f5;
}
.deposit-danger-confirmation p {
  margin: 4px 0 0;
  color: #8f6666;
  font-size: 12px;
}
.deposit-danger-actions {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 8px;
}
.deposit-void-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}
.deposit-void-form :deep(.el-form-item) {
  margin-bottom: 0;
}
.deposit-voided-history {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px dashed #e2b8b8;
  border-radius: 9px;
  background: #fffafa;
}
.deposit-voided-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #9e4f4f;
}
.deposit-voided-history article {
  display: grid;
  gap: 7px;
  padding-top: 8px;
  border-top: 1px dashed #ead2d2;
}
.deposit-voided-history article > strong {
  color: #67595d;
  font-size: 12px;
}
.deposit-voided-history dl {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.deposit-voided-history dt {
  color: #9a8589;
  font-size: 11px;
}
.deposit-voided-history dd {
  overflow-wrap: anywhere;
  margin: 3px 0 0;
  color: #5e4e53;
  font-size: 12px;
}
.deposit-receipt-upload {
  width: 100%;
}
.deposit-receipt-upload :deep(.el-upload),
.deposit-receipt-upload :deep(.el-upload-dragger) {
  width: 100%;
}
.deposit-receipt-upload :deep(.el-upload-dragger) {
  padding: 18px;
  border-color: #bcd8d4;
  background: #f7fbfa;
}
.deposit-upload-content {
  display: flex;
  min-height: 100px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: #78909a;
}
.deposit-upload-content strong {
  color: #365b6c;
}
.deposit-upload-content small {
  max-width: 680px;
  text-align: center;
}
.deposit-upload-icon {
  color: #299088;
  font-size: 28px;
}
.deposit-original-preview {
  overflow: hidden;
  border: 1px solid #dde8e7;
  border-radius: 9px;
  background: #f5f8f8;
}
.deposit-preview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  color: #6f838e;
  font-size: 12px;
}
.deposit-preview-heading strong {
  color: #34566a;
}
.deposit-preview-heading span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.deposit-original-preview img,
.deposit-original-preview iframe {
  display: block;
  width: 100%;
  height: min(520px, 55vh);
  border: 0;
  object-fit: contain;
  background: #fff;
}
.deposit-amount-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}
.deposit-amount-summary > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding: 11px 12px;
  border-radius: 9px;
  background: #edf7f5;
}
.deposit-amount-summary span {
  color: #71868f;
  font-size: 11px;
}
.deposit-amount-summary strong {
  color: #167a75;
  font-size: 15px;
}
.deposit-amount-summary .invalid {
  background: #fff0f0;
}
.deposit-amount-summary .invalid strong {
  color: #c94f4f;
}
.deposit-validation-alert {
  margin: 0;
}
.deposit-verification-form {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  align-items: end;
  gap: 10px;
}
.deposit-verification-form :deep(.el-form-item) {
  margin-bottom: 0;
}
.deposit-readonly-hint {
  margin: 0;
  color: #99712f;
  font-size: 12px;
}
.deposit-audit-trail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding-top: 12px;
  border-top: 1px dashed #dbe5e4;
}
.deposit-audit-trail > div {
  min-width: 0;
}
.deposit-audit-trail dt {
  color: #8a99a2;
  font-size: 11px;
}
.deposit-audit-trail dd {
  overflow-wrap: anywhere;
  margin: 3px 0 0;
  color: #415f70;
  font-size: 12px;
}
@media (max-width: 768px) {
  .deposit-receipt-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .deposit-amount-summary,
  .deposit-audit-trail,
  .deposit-verification-form,
  .deposit-void-form,
  .deposit-voided-history dl {
    grid-template-columns: 1fr;
  }
  .deposit-danger-confirmation {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
