<template>
  <section
    v-if="summary && panelVisible"
    class="completed-internal-funding-panel"
    aria-labelledby="completed-internal-funding-title"
  >
    <header class="panel-heading">
      <div>
        <span>已完成合同 · 仅补内部划拨</span>
        <h2 id="completed-internal-funding-title">补齐工程咨询内部划拨</h2>
        <p>
          仅登记工程咨询向{{
            summary.contractCompanySubjectName
          }}的真实划拨回单；不开放发票、对外付款、押金或其他财务新增。
        </p>
      </div>
      <el-tag type="warning" effect="plain">专项补录</el-tag>
    </header>

    <div class="funding-summary" aria-label="内部划拨补录汇总">
      <div>
        <span>应划拨</span>
        <strong>{{ formatContractMoney(summary.requiredAmount) }}</strong>
      </div>
      <div>
        <span>已确认</span>
        <strong>{{ formatContractMoney(summary.confirmedAmount) }}</strong>
      </div>
      <div>
        <span>待确认</span>
        <strong>{{ formatContractMoney(displayPendingAmount) }}</strong>
      </div>
      <div class="remaining">
        <span>尚待划拨</span>
        <strong>{{ formatContractMoney(displayRemainingAmount) }}</strong>
      </div>
    </div>

    <section v-if="summary.receipts.length" class="confirmed-receipts">
      <h3>已确认工程划拨回单</h3>
      <el-table :data="summary.receipts" border table-layout="fixed">
        <el-table-column
          type="index"
          label="序号"
          width="72"
          align="center"
          header-align="center"
        />
        <el-table-column
          label="付款方"
          min-width="150"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">{{ row.payer || "—" }}</template>
        </el-table-column>
        <el-table-column
          label="收款方"
          min-width="150"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">{{ row.payee || "—" }}</template>
        </el-table-column>
        <el-table-column
          label="回单号"
          min-width="130"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">{{
            row.electronicReceiptNo || "—"
          }}</template>
        </el-table-column>
        <el-table-column
          label="日期"
          width="110"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">{{
            formatPaymentDate(row.paymentTime)
          }}</template>
        </el-table-column>
        <el-table-column
          label="金额"
          width="120"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">{{
            formatContractMoney(row.amount)
          }}</template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="90"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            <a
              v-if="receiptPreviewUrl(row)"
              :href="receiptPreviewUrl(row)"
              target="_blank"
              rel="noopener noreferrer"
            >
              在线预览
            </a>
            <span v-else>—</span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <div class="upload-heading">
      <div>
        <h3>工程咨询→{{ summary.contractCompanySubjectName }}划拨回单</h3>
        <p>支持多文件；选择后自动识别，全部通过后一次确认保存。</p>
      </div>
    </div>
    <el-upload
      ref="uploadRef"
      class="funding-uploader"
      drag
      multiple
      :auto-upload="false"
      :show-file-list="false"
      :disabled="confirming || displayRemainingAmount <= 0"
      :on-change="handleFileChange"
      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
    >
      <div class="funding-upload-content">
        <el-icon class="upload-icon"><Upload /></el-icon>
        <strong>{{
          credentials.length
            ? "继续添加工程划拨回单"
            : "拖拽或点击上传工程划拨回单"
        }}</strong>
        <small>
          支持一次选择多张
          PDF（便携式文档格式）、JPG（图像格式）、JPEG（联合图像专家组）或
          PNG（便携式网络图形），单个文件不超过 30MB
        </small>
      </div>
    </el-upload>

    <el-alert
      v-if="pageError"
      type="error"
      show-icon
      closable
      :title="pageError"
      @close="pageError = ''"
    />

    <div v-if="credentials.length" class="pending-receipts">
      <div class="pending-receipts-header" aria-hidden="true">
        <span>序号</span><span>付款方／账号</span><span>收款方／账号</span>
        <span>电子回单号</span><span>付款日期</span><span>金额</span>
        <span>核验状态</span><span>操作</span>
      </div>
      <article v-for="(item, index) in credentials" :key="item.key">
        <span class="sequence-cell">{{ index + 1 }}</span>
        <div class="party-cell">
          <span>{{ bankFields(item)?.payer || "识别中" }}</span>
          <small>{{ bankFields(item)?.payerAccount || "—" }}</small>
        </div>
        <div class="party-cell">
          <span>{{ bankFields(item)?.payee || "识别中" }}</span>
          <small>{{ bankFields(item)?.payeeAccount || "—" }}</small>
        </div>
        <span>{{ bankFields(item)?.electronicReceiptNo || "—" }}</span>
        <span>{{ formatPaymentDate(bankFields(item)?.paymentTime) }}</span>
        <strong>{{ formatRecognizedMoney(bankFields(item)?.amount) }}</strong>
        <el-tag :type="credentialTagType(item.status)" effect="plain">
          {{ credentialStatusLabel(item) }}
        </el-tag>
        <div class="file-actions">
          <a :href="item.previewUrl" target="_blank" rel="noopener noreferrer">
            预览
          </a>
          <el-button
            link
            type="danger"
            :loading="item.removing"
            :disabled="item.status === 'recognizing' || confirming"
            @click="removeCredential(item)"
          >
            移除
          </el-button>
        </div>
        <small v-if="item.error" class="credential-error">{{
          item.error
        }}</small>
      </article>
    </div>

    <footer class="panel-actions">
      <span>{{ confirmationHint }}</span>
      <el-button
        type="primary"
        :loading="confirming"
        :disabled="!canConfirm"
        @click="confirmFunding"
      >
        确认保存内部划拨
      </el-button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type { UploadFile, UploadInstance } from "element-plus";
import { Upload } from "@element-plus/icons-vue";
import type {
  ContractCompletedInternalFundingReceipt,
  ContractCompletedInternalFundingRecognition,
  ContractCompletedInternalFundingSummary,
  ContractFinancialBankFields,
} from "@/types/contract";
import {
  confirmCompletedInternalFunding,
  deleteCompletedInternalFundingRecognition,
  getCompletedInternalFundingSummary,
  getContractErrorMessage,
  getContractFileUrl,
  recognizeCompletedInternalFundingFile,
} from "@/utils/contractApi";
import { formatContractMoney } from "@/utils/contractPresentation";

type CredentialStatus = "recognizing" | "verified" | "blocked" | "error";
interface InternalFundingCredential {
  key: string;
  file: File | null;
  previewUrl: string;
  status: CredentialStatus;
  result: ContractCompletedInternalFundingRecognition | null;
  error: string;
  removing: boolean;
  restored: boolean;
}

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];
const props = defineProps<{ contractId: string }>();
const emit = defineEmits<{
  saved: [summary: ContractCompletedInternalFundingSummary];
}>();
const uploadRef = ref<UploadInstance>();
const summary = ref<ContractCompletedInternalFundingSummary | null>(null);
const credentials = ref<InternalFundingCredential[]>([]);
const pageError = ref("");
const confirming = ref(false);
let credentialSequence = 0;
let recognitionQueue = Promise.resolve();

const credentialTotal = computed(() =>
  credentials.value
    .filter((item) => item.status === "verified")
    .reduce((sum, item) => sum + Number(bankFields(item)?.amount || 0), 0),
);
const newSelectedTotal = computed(() =>
  credentials.value
    .filter((item) => !item.restored && item.status === "verified")
    .reduce((sum, item) => sum + Number(bankFields(item)?.amount || 0), 0),
);
const uploadAllowance = computed(() =>
  summary.value?.availableRecognitionAmount !== undefined
    ? Math.max(0, Number(summary.value.availableRecognitionAmount || 0))
    : Math.max(
        0,
        Number(summary.value?.remainingAmount || 0) -
          Number(summary.value?.pendingAmount || 0),
      ),
);
const panelVisible = computed(
  () =>
    Boolean(summary.value?.canAppendAfterCompletion) ||
    Boolean(summary.value?.pendingRecognitions.length),
);
const displayPendingAmount = computed(
  () => Number(summary.value?.pendingAmount || 0) + newSelectedTotal.value,
);
const displayRemainingAmount = computed(() =>
  Math.max(0, uploadAllowance.value - newSelectedTotal.value),
);
const anyRecognizing = computed(() =>
  credentials.value.some((item) => item.status === "recognizing"),
);
const canConfirm = computed(
  () =>
    credentials.value.length > 0 &&
    !anyRecognizing.value &&
    !confirming.value &&
    credentialTotal.value > 0 &&
    credentialTotal.value <= Number(summary.value?.remainingAmount || 0) &&
    credentials.value.every((item) => item.status === "verified"),
);
const confirmationHint = computed(() => {
  if (anyRecognizing.value) return "正在识别划拨回单，请等待全部完成";
  if (!credentials.value.length) {
    return uploadAllowance.value > 0
      ? "请选择至少一张工程划拨回单"
      : "待确认识别任务已占满尚待划拨金额，请先确认或移除";
  }
  const blocked = credentials.value.find((item) => item.status !== "verified");
  if (blocked) return blocked.error || "存在未通过校验的回单，请移除后重试";
  if (uploadAllowance.value <= 0 && summary.value?.pendingRecognitions.length) {
    return "待确认识别任务已占满尚待划拨金额，请先确认或移除";
  }
  if (newSelectedTotal.value > uploadAllowance.value) {
    return "本次识别金额超过尚待划拨金额，请移除或核对回单";
  }
  return `待确认共 ${credentials.value.length} 张，合计 ${formatContractMoney(credentialTotal.value)}`;
});

function bankFields(
  item: InternalFundingCredential,
): ContractFinancialBankFields | null {
  return item.result?.fields || null;
}

function credentialTagType(status: CredentialStatus) {
  return status === "verified"
    ? "success"
    : status === "recognizing"
      ? "warning"
      : "danger";
}

function credentialStatusLabel(item: InternalFundingCredential) {
  return {
    recognizing: "识别中",
    verified: "校验通过",
    blocked: "校验未通过",
    error: "识别失败",
  }[item.status];
}

function validateFile(file: File): string {
  const lowerName = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return "工程划拨回单只支持 PDF（便携式文档格式）、JPG（图像格式）、JPEG（联合图像专家组）或 PNG（便携式网络图形）";
  }
  if (file.size > MAX_FILE_SIZE) return "单个工程划拨回单不能超过 30MB";
  return "";
}

function handleFileChange(uploadFile: UploadFile) {
  uploadRef.value?.clearFiles();
  const file = uploadFile.raw;
  if (!file || confirming.value || displayRemainingAmount.value <= 0) return;
  recognitionQueue = recognitionQueue.then(() => recognizeFile(file));
}

async function recognizeFile(file: File) {
  const validationMessage = validateFile(file);
  if (validationMessage) {
    pageError.value = validationMessage;
    return;
  }
  if (
    credentials.value.some(
      (item) => item.file?.name === file.name && item.file?.size === file.size,
    )
  ) {
    pageError.value = `${file.name} 已选择，请勿重复添加`;
    return;
  }
  const item = reactive<InternalFundingCredential>({
    key: `internal-funding-${++credentialSequence}`,
    file,
    previewUrl: URL.createObjectURL(file),
    status: "recognizing",
    result: null,
    error: "",
    removing: false,
    restored: false,
  });
  credentials.value = [...credentials.value, item];
  pageError.value = "";
  try {
    const result = await recognizeCompletedInternalFundingFile(
      props.contractId,
      file,
    );
    item.result = result;
    item.status = result.canConfirm ? "verified" : "blocked";
    item.error = result.canConfirm
      ? ""
      : result.blockingReasons.map((reason) => reason.message).join("；") ||
        "回单未通过内部划拨校验";
  } catch (error) {
    item.status = "error";
    item.error = getContractErrorMessage(error, "工程划拨回单识别失败");
  }
}

async function removeCredential(item: InternalFundingCredential) {
  if (item.removing || confirming.value || item.status === "recognizing")
    return;
  item.removing = true;
  try {
    if (item.result?.jobId) {
      await deleteCompletedInternalFundingRecognition(
        props.contractId,
        item.result.jobId,
      );
    }
    if (item.restored && summary.value) {
      summary.value.pendingAmount = Math.max(
        0,
        Number(summary.value.pendingAmount || 0) -
          (item.status === "verified"
            ? Number(bankFields(item)?.amount || 0)
            : 0),
      );
      summary.value.pendingRecognitions =
        summary.value.pendingRecognitions.filter(
          (recognition) => recognition.jobId !== item.result?.jobId,
        );
    }
    releasePreview(item);
    credentials.value = credentials.value.filter(
      (credential) => credential.key !== item.key,
    );
    pageError.value = "";
  } catch (error) {
    item.error = getContractErrorMessage(error, "移除工程划拨回单失败");
  } finally {
    item.removing = false;
  }
}

function releasePreview(item: InternalFundingCredential) {
  if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
  item.previewUrl = "";
}

async function confirmFunding() {
  if (!canConfirm.value) return;
  confirming.value = true;
  pageError.value = "";
  try {
    const next = await confirmCompletedInternalFunding(
      props.contractId,
      credentials.value.map((item) => item.result!.jobId),
    );
    credentials.value.forEach(releasePreview);
    summary.value = next;
    restorePendingRecognitions(next.pendingRecognitions);
    emit("saved", next);
  } catch (error) {
    pageError.value = getContractErrorMessage(
      error,
      "工程划拨回单确认保存失败，请稍后重试",
    );
  } finally {
    confirming.value = false;
  }
}

function receiptPreviewUrl(receipt: ContractCompletedInternalFundingReceipt) {
  return (
    receipt.previewUrl ||
    (receipt.fileId ? getContractFileUrl(receipt.fileId) : "")
  );
}

function formatPaymentDate(value?: string | null) {
  return String(value || "").match(/^\d{4}-\d{2}-\d{2}/u)?.[0] || "—";
}

function formatRecognizedMoney(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? formatContractMoney(amount)
    : "—";
}

function restorePendingRecognitions(
  pendingRecognitions: ContractCompletedInternalFundingRecognition[],
) {
  credentials.value = pendingRecognitions.map((result) => ({
    key: `restored-${result.jobId}`,
    file: null,
    previewUrl: result.fileUrl || getContractFileUrl(result.fileId),
    status: result.canConfirm ? "verified" : "blocked",
    result,
    error: result.canConfirm
      ? ""
      : result.blockingReasons.map((reason) => reason.message).join("；") ||
        "回单未通过内部划拨校验",
    removing: false,
    restored: true,
  }));
}

onMounted(async () => {
  try {
    summary.value = await getCompletedInternalFundingSummary(props.contractId);
    restorePendingRecognitions(summary.value.pendingRecognitions);
  } catch {
    summary.value = null;
  }
});

onBeforeUnmount(() => {
  credentials.value.forEach(releasePreview);
});
</script>

<style scoped>
.completed-internal-funding-panel {
  margin-bottom: 14px;
  padding: 18px;
  border: 1px solid #d7e6d9;
  border-radius: 14px;
  background: linear-gradient(135deg, #f8fcf8, #fff);
}
.panel-heading,
.upload-heading,
.panel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.panel-heading span,
.panel-heading p,
.upload-heading p,
.panel-actions span {
  color: #788d85;
  font-size: 12px;
}
.panel-heading h2,
.panel-heading p,
.upload-heading h3,
.upload-heading p {
  margin: 0;
}
.panel-heading h2 {
  margin: 3px 0;
  color: #31594c;
  font-size: 18px;
}
.funding-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 15px 0;
}
.funding-summary > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px;
  border: 1px solid #e0e9e2;
  border-radius: 9px;
  background: #fff;
}
.funding-summary span {
  color: #819087;
  font-size: 11px;
}
.funding-summary strong {
  color: #326453;
}
.funding-summary .remaining strong {
  color: #b16a22;
}
.confirmed-receipts,
.pending-receipts {
  margin-top: 14px;
}
.confirmed-receipts h3,
.upload-heading h3 {
  color: #3f6558;
  font-size: 14px;
  text-align: center;
}
.upload-heading {
  justify-content: center;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed #d9e4dc;
  text-align: center;
}
.upload-heading > div {
  width: 100%;
}
.funding-uploader {
  width: 100%;
  margin-top: 10px;
}
.funding-uploader :deep(.el-upload),
.funding-uploader :deep(.el-upload-dragger) {
  width: 100%;
}
.funding-uploader :deep(.el-upload-dragger) {
  min-height: 150px;
  padding: 20px;
  border-color: #b8d6c5;
  background: #f8fcf9;
}
.funding-uploader :deep(.el-upload-dragger:hover) {
  border-color: #4b9981;
  background: #f1faf5;
}
.funding-upload-content {
  display: flex;
  min-height: 105px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
}
.funding-upload-content .upload-icon {
  color: #62a58e;
  font-size: 38px;
}
.funding-upload-content strong {
  color: #3c6355;
}
.funding-upload-content small {
  max-width: 620px;
  color: #86968d;
  font-size: 11px;
  line-height: 1.6;
}
.pending-receipts-header,
.pending-receipts article {
  display: grid;
  grid-template-columns:
    64px repeat(2, minmax(180px, 1fr)) minmax(140px, 0.85fr)
    120px 110px 110px 100px;
  align-items: center;
  justify-items: center;
  gap: 8px;
  text-align: center;
}
.pending-receipts-header {
  padding: 8px 0;
  border-bottom: 1px solid #d9e4dc;
  color: #829188;
  font-size: 10px;
  text-align: center;
}
.pending-receipts article {
  padding: 10px 0;
  border-bottom: 1px dashed #e0e7e2;
  color: #60776e;
  font-size: 11px;
}
.file-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.sequence-cell {
  color: #3c5e53;
  font-weight: 700;
}
.party-cell {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-direction: column;
  gap: 3px;
  overflow-wrap: anywhere;
  text-align: center;
}
.party-cell small {
  color: #8b9991;
}
.credential-error {
  grid-column: 1 / -1;
  color: #bd5147;
  text-align: center;
}
.panel-actions {
  margin-top: 15px;
}
a {
  color: #248276;
  text-decoration: none;
}
@media (max-width: 980px) {
  .funding-summary {
    grid-template-columns: 1fr 1fr;
  }
  .pending-receipts article {
    grid-template-columns: 1fr 1fr;
  }
  .pending-receipts-header {
    display: none;
  }
  .credential-error {
    grid-column: 1 / -1;
  }
}
@media (max-width: 768px) {
  .panel-heading,
  .upload-heading,
  .panel-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .funding-summary,
  .pending-receipts article {
    grid-template-columns: 1fr;
  }
}
</style>
