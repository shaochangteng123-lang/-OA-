<template>
  <section class="bank-receipt-panel" aria-labelledby="bank-receipt-title">
    <header class="bank-panel-heading">
      <div>
        <div class="bank-panel-title-row">
          <h2 id="bank-receipt-title">银行回单识别</h2>
          <el-tag effect="plain" round>{{ formatMonth(month) }}</el-tag>
        </div>
        <p>
          基本、一般、商务账户原始回单分别保存；内部划转仅展示，不计入经营收支。
        </p>
      </div>
      <el-button
        :icon="Refresh"
        :loading="stateLoading"
        :disabled="uploading"
        @click="loadBankState"
      >
        刷新回单状态
      </el-button>
    </header>

    <el-alert
      v-if="lastUploadNotice"
      class="bank-panel-alert"
      :title="lastUploadNotice"
      type="success"
      :closable="true"
      show-icon
      @close="lastUploadNotice = ''"
    />

    <el-alert
      v-if="stateError"
      class="bank-panel-alert"
      title="银行回单状态加载失败"
      :description="stateError"
      type="error"
      :closable="false"
      show-icon
    />

    <el-alert
      v-if="processingOutcomeUncertain"
      class="bank-panel-alert"
      title="上一批银行回单的处理结果仍待确认"
      :description="
        uncertainFileHashes.length
          ? '请使用“刷新回单状态”核对，系统确认文件摘要已保存后会自动解除；确认前禁止重复上传或离开当前月份。'
          : '请先刷新回单状态；当前浏览器未生成本地摘要，如仍无法确认，可重新选择原件，服务端会按摘要和月报版本防止重复入账。'
      "
      type="warning"
      :closable="false"
      show-icon
    />
    <div
      v-if="processingOutcomeUncertain && uncertainStateCheckedWithoutMatch"
      class="uncertain-retry-row"
    >
      <span>
        {{
          uncertainFileHashes.length
            ? "本次刷新尚未发现对应文件摘要。"
            : "服务端未发现本批已保存文件，可清除待确认状态后重新上传。"
        }}
      </span>
      <el-button type="warning" plain @click="allowUncertainSafeRetry">
        {{
          uncertainFileHashes.length
            ? "重新选择同一批原件安全重试"
            : "确认未保存，重新上传"
        }}
      </el-button>
    </div>

    <div v-if="stateLoading && !bankState" class="bank-state-loading">
      <el-skeleton :rows="5" animated />
    </div>

    <div v-else class="bank-account-list">
      <article
        v-for="account in bankAccounts"
        :key="account.accountCode"
        class="bank-account-card"
        :class="{
          'bank-account-card--empty': !account.file,
          'bank-account-card--warning': accountIssues(account).length > 0,
        }"
      >
        <header class="bank-account-heading">
          <span class="bank-account-mark">{{
            bankAccountShortName(account.accountCode)
          }}</span>
          <div class="bank-account-identity">
            <div>
              <h3>{{ account.accountName }}</h3>
              <el-tag
                :type="
                  account.file
                    ? fileStatusMeta(account.file.status).type
                    : 'info'
                "
                size="small"
                effect="plain"
              >
                {{
                  account.file
                    ? fileStatusMeta(account.file.status).label
                    : "未上传"
                }}
              </el-tag>
            </div>
            <code>{{ account.accountNumber }}</code>
          </div>
          <el-button
            v-if="account.file"
            link
            type="primary"
            class="bank-detail-toggle"
            @click="toggleAccount(account.accountCode)"
          >
            {{
              isAccountExpanded(account.accountCode)
                ? "收起回单"
                : `展开${account.transactions.length}笔回单`
            }}
          </el-button>
        </header>

        <template v-if="account.file">
          <div class="bank-file-meta">
            <div class="bank-file-name">
              <el-icon><Document /></el-icon>
              <span :title="account.file.originalName">
                {{ account.file.originalName }}
              </span>
            </div>
            <span>第 {{ account.file.version }} 版</span>
            <span>{{ account.file.pageCount ?? "—" }} 页</span>
            <span>识别 {{ account.file.receiptCount }} 笔</span>
            <span>
              交易月份：{{ detectedMonthText(account.file.detectedMonths) }}
            </span>
            <span>
              {{ account.file.uploaderName || "管理员" }} ·
              {{ formatDateTime(account.file.updatedAt) }}
            </span>
          </div>

          <div
            v-if="
              accountIssues(account).length || hasSafelyIncludedCharges(account)
            "
            class="bank-issue-list"
          >
            <el-alert
              v-for="issue in accountIssues(account)"
              :key="issue"
              :title="issue"
              type="warning"
              :closable="false"
              show-icon
            />
            <el-alert
              v-if="hasSafelyIncludedCharges(account)"
              title="利息及跨行手续费已安全计入月报，其余交易仍待核对"
              type="warning"
              :closable="false"
              show-icon
            />
          </div>

          <dl class="bank-total-grid">
            <div>
              <dt>回单流入</dt>
              <dd class="is-income">
                +{{ formatAmount(account.totals.inflow) }}
              </dd>
            </div>
            <div>
              <dt>回单流出</dt>
              <dd class="is-expense">
                -{{ formatAmount(account.totals.outflow) }}
              </dd>
            </div>
            <div>
              <dt>计入月报</dt>
              <dd>{{ formatAmount(account.totals.included) }}</dd>
            </div>
            <template v-if="account.accountCode !== 'basic'">
              <div>
                <dt>利息</dt>
                <dd class="is-income">
                  {{ formatAmount(account.totals.interest) }}
                </dd>
              </div>
              <div>
                <dt>跨行手续费</dt>
                <dd class="is-expense">
                  {{ formatAmount(account.totals.bankFee) }}
                </dd>
              </div>
            </template>
            <div v-else class="basic-bank-exclusion-total">
              <dt>统计口径</dt>
              <dd>基本账户利息及手续费不纳入月报</dd>
            </div>
            <div class="internal-transfer-total">
              <dt>内部划转</dt>
              <dd>{{ formatAmount(account.totals.internalTransfer) }}</dd>
              <small>仅展示，不计经营收支</small>
            </div>
          </dl>

          <div
            v-if="isAccountExpanded(account.accountCode)"
            class="bank-transaction-shell"
          >
            <el-table
              v-if="account.transactions.length"
              :data="account.transactions"
              border
              stripe
              class="bank-transaction-table"
            >
              <el-table-column label="交易日期" width="118" fixed="left">
                <template #default="{ row }">
                  {{ row.transactionDate || "—" }}
                </template>
              </el-table-column>
              <el-table-column label="方向" width="86" align="center">
                <template #default="{ row }">
                  <el-tag
                    :type="directionMeta(row.direction).type"
                    size="small"
                    effect="plain"
                  >
                    {{ directionMeta(row.direction).label }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="分类" width="146">
                <template #default="{ row }">
                  <div class="bank-category-cell">
                    <el-tag
                      :type="categoryMeta(row.category).type"
                      size="small"
                    >
                      {{ categoryMeta(row.category).label }}
                    </el-tag>
                    <small>
                      {{
                        row.recognitionStatus === "review_required"
                          ? "待复核，尚未接管"
                          : ["main_income", "asset_expense"].includes(
                                row.category,
                              ) && row.linkStatus === "matched"
                            ? "已挂载，金额取系统记录"
                            : row.includeInReport
                              ? account.file?.status === "partial"
                                ? "已安全计入月报"
                                : "计入月报"
                              : "不计经营收支"
                      }}
                    </small>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="金额" width="132" align="right">
                <template #default="{ row }">
                  <strong class="bank-transaction-amount">
                    {{ formatAmount(row.amount) }}
                  </strong>
                </template>
              </el-table-column>
              <el-table-column label="付款方／完整账号" min-width="250">
                <template #default="{ row }">
                  <div class="bank-party-cell">
                    <strong>{{ row.payer || "—" }}</strong>
                    <code>{{ row.payerAccount || "—" }}</code>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="收款方／完整账号" min-width="250">
                <template #default="{ row }">
                  <div class="bank-party-cell">
                    <strong>{{ row.payee || "—" }}</strong>
                    <code>{{ row.payeeAccount || "—" }}</code>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="回单与摘要" min-width="230">
                <template #default="{ row }">
                  <div class="bank-reference-cell">
                    <span>回单号：{{ row.electronicReceiptNo || "—" }}</span>
                    <small>{{ row.remark || "无摘要" }}</small>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="异常" min-width="210">
                <template #default="{ row }">
                  <div v-if="row.warnings?.length" class="transaction-warnings">
                    <el-tag type="warning" size="small" effect="plain">
                      {{ row.warnings.length }} 项提示
                    </el-tag>
                    <small v-for="warning in row.warnings" :key="warning">
                      {{ warning }}
                    </small>
                  </div>
                  <el-tag v-else type="success" size="small" effect="plain">
                    无异常
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="匹配状态" width="190" align="center">
                <template #default="{ row }">
                  <div class="bank-match-cell">
                    <el-tag
                      :type="transactionMatchMeta(row).type"
                      size="small"
                      effect="plain"
                    >
                      {{ transactionMatchMeta(row).label }}
                    </el-tag>
                    <small v-if="row.employeeMatch?.employeeName">
                      员工：{{ row.employeeMatch.employeeName }}
                    </small>
                    <small
                      v-if="row.reimbursementLink?.linkedReimbursements?.length"
                    >
                      已关联
                      {{ row.reimbursementLink.linkedReimbursements.length }}
                      笔报销
                    </small>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="210" fixed="right">
                <template #default="{ row }">
                  <div class="bank-row-actions">
                    <el-link
                      v-if="row.previewUrl"
                      :href="row.previewUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      type="primary"
                    >
                      在线预览
                    </el-link>
                    <el-link
                      v-for="linked in row.reimbursementLink
                        ?.linkedReimbursements || []"
                      :key="linked.id"
                      :href="linked.detailUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      type="success"
                    >
                      查看报销
                    </el-link>
                    <el-link
                      v-if="
                        row.reimbursementLink?.displayAction === 'replaced' &&
                        row.reimbursementLink.linkedReimbursements[0]
                          ?.originalProofPreviewUrl
                      "
                      :href="
                        row.reimbursementLink.linkedReimbursements[0]
                          ?.originalProofPreviewUrl || undefined
                      "
                      target="_blank"
                      rel="noopener noreferrer"
                      type="info"
                    >
                      原回单
                    </el-link>
                    <el-button
                      v-if="
                        row.recognitionStatus === 'review_required' && canUpload
                      "
                      link
                      type="warning"
                      :loading="reviewingTransactionId === row.id"
                      :disabled="disabled || uploading"
                      @click="reviewAndExcludeTransaction(row.id)"
                    >
                      复核排除
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
            <el-empty
              v-else
              description="该文件未识别到有效回单"
              :image-size="70"
            />
          </div>
        </template>

        <el-empty
          v-else
          class="bank-account-empty"
          description="本月尚未上传该账户回单"
          :image-size="64"
        />
      </article>
    </div>

    <el-dialog
      v-model="uploadDialogVisible"
      :title="`上传银行回单 · ${formatMonth(month)}`"
      width="min(760px, 94vw)"
      :close-on-click-modal="false"
      :close-on-press-escape="!uploading"
      :before-close="handleDialogBeforeClose"
      destroy-on-close
    >
      <el-alert
        title="一次可选择基本、一般、商务账户共 1 至 3 份原始 PDF（便携式文档）；单份最多120页，本次合计最多200页。"
        description="系统以回单中的完整账号为准识别账户；扫描件逐页处理，一页最多放置上下两张回单，超过两张请先拆页。"
        type="info"
        :closable="false"
        show-icon
      />

      <el-alert
        v-if="uploadErrorMessage"
        class="upload-dialog-alert"
        :title="
          mixedMonthConfirmationPending
            ? '检测到跨月回单，需要管理员确认'
            : '上传未完成'
        "
        :description="uploadErrorMessage"
        :type="mixedMonthConfirmationPending ? 'warning' : 'error'"
        :closable="false"
        show-icon
      />

      <div
        class="bank-file-drop"
        :class="{
          'is-disabled':
            uploading ||
            !canUpload ||
            disabled ||
            (processingOutcomeUncertain && !uncertainSafeRetryMode),
        }"
        :aria-disabled="
          uploading ||
          !canUpload ||
          disabled ||
          (processingOutcomeUncertain && !uncertainSafeRetryMode)
        "
        role="button"
        tabindex="0"
        @click="openFilePicker"
        @keydown.enter.prevent="openFilePicker"
        @keydown.space.prevent="openFilePicker"
        @dragover.prevent
        @drop.prevent="handleFileDrop"
      >
        <input
          ref="fileInputRef"
          class="visually-hidden"
          type="file"
          accept=".pdf,application/pdf"
          multiple
          :disabled="
            uploading ||
            !canUpload ||
            disabled ||
            (processingOutcomeUncertain && !uncertainSafeRetryMode)
          "
          @change="handleFileInput"
        />
        <el-icon class="bank-file-drop-icon"><UploadFilled /></el-icon>
        <strong>点击或拖入银行回单</strong>
        <span>仅支持 PDF（便携式文档），单个文件不超过 50MB／120页</span>
      </div>

      <div v-if="selectedFiles.length" class="selected-bank-files">
        <article
          v-for="(file, index) in selectedFiles"
          :key="`${index}-${file.name}-${file.lastModified}`"
        >
          <el-icon><Document /></el-icon>
          <div>
            <strong :title="file.name">{{ file.name }}</strong>
            <span>
              {{ formatFileSize(file.size) }} ·
              {{ filenameAccountHint(file.name) }}
            </span>
          </div>
          <el-button
            link
            type="danger"
            :icon="Delete"
            :disabled="
              uploading ||
              (processingOutcomeUncertain && !uncertainSafeRetryMode)
            "
            :aria-label="`移除${file.name}`"
            @click="removeSelectedFile(file)"
          />
        </article>
      </div>

      <div v-if="uploading" class="bank-upload-progress" aria-live="polite">
        <el-icon class="is-loading"><Loading /></el-icon>
        <div>
          <strong>正在逐页识别并核对银行回单</strong>
          <p>
            扫描件和一页多张回单耗时较长，已处理
            {{ uploadDurationText }}，请勿关闭页面或切换月份。
          </p>
        </div>
      </div>

      <template #footer>
        <el-button
          v-if="uploading && processingOutcomeUncertain"
          type="warning"
          @click="stopWaiting"
        >
          停止等待
        </el-button>
        <el-button v-else-if="!uploading" @click="cancelUpload">
          取消
        </el-button>
        <el-button
          :type="mixedMonthConfirmationPending ? 'warning' : 'primary'"
          :loading="uploading"
          :disabled="
            selectedFiles.length === 0 ||
            disabled ||
            !canUpload ||
            (processingOutcomeUncertain && !uncertainSafeRetryMode)
          "
          @click="submitSelectedFiles(mixedMonthConfirmationPending)"
        >
          {{
            mixedMonthConfirmationPending ? "确认跨月并重新提交" : "上传并识别"
          }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  Delete,
  Document,
  Loading,
  Refresh,
  UploadFilled,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { monthlyReimbursementLinkDisplay } from "@/utils/monthlyFinancialReportPresentation";
import {
  getMonthlyFinancialBankReceipts,
  getMonthlyFinancialReport,
  getMonthlyFinancialReportErrorCode,
  getMonthlyFinancialReportErrorMessage,
  isMonthlyFinancialBankMixedMonthConfirmationRequired,
  isMonthlyFinancialReportVersionConflict,
  reviewMonthlyFinancialBankTransaction,
  uploadMonthlyFinancialBankReceipts,
  type MonthlyFinancialBankReceiptUploadResult,
} from "@/utils/monthlyFinancialReportApi";
import type {
  MonthlyFinancialAmount,
  MonthlyFinancialBankAccountCode,
  MonthlyFinancialBankReceiptAccount,
  MonthlyFinancialBankReceiptTransaction,
  MonthlyFinancialBankReceiptState,
  MonthlyFinancialReport,
} from "@/types/monthlyFinancialReport";

const props = defineProps<{
  month: string;
  expectedVersion: number;
  canUpload: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  uploaded: [result: MonthlyFinancialBankReceiptUploadResult];
  "report-refreshed": [report: MonthlyFinancialReport];
  "busy-change": [busy: boolean];
  "pending-change": [pending: boolean];
  "uncertain-change": [uncertain: boolean];
}>();

const bankState = ref<MonthlyFinancialBankReceiptState | null>(null);
const stateLoading = ref(false);
const stateError = ref("");
const expandedAccounts = ref<MonthlyFinancialBankAccountCode[]>([]);
const uploadDialogVisible = ref(false);
const selectedFiles = ref<File[]>([]);
const uploading = ref(false);
const uploadErrorMessage = ref("");
const mixedMonthConfirmationPending = ref(false);
const processingOutcomeUncertain = ref(false);
const uncertainFileNames = ref<string[]>([]);
const uncertainFileHashes = ref<string[]>([]);
const uncertainMonth = ref("");
const uncertainStateCheckedWithoutMatch = ref(false);
const uncertainSafeRetryMode = ref(false);
const lastUploadNotice = ref("");
const fileInputRef = ref<HTMLInputElement | null>(null);
const uploadElapsedSeconds = ref(0);
const reviewingTransactionId = ref("");
let stateRequestSequence = 0;
let uploadTimer: number | undefined;
let uploadAbortController: AbortController | null = null;

const bankAccounts = computed(() => {
  const order: MonthlyFinancialBankAccountCode[] = [
    "basic",
    "general",
    "business",
  ];
  return [...(bankState.value?.accounts || [])].sort(
    (left, right) =>
      order.indexOf(left.accountCode) - order.indexOf(right.accountCode),
  );
});
const uploadDurationText = computed(() => {
  const minutes = Math.floor(uploadElapsedSeconds.value / 60);
  const seconds = uploadElapsedSeconds.value % 60;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
});

watch(
  () => props.month,
  () => {
    restoreUncertainOutcome(props.month);
    bankState.value = null;
    expandedAccounts.value = [];
    lastUploadNotice.value = "";
    if (!uploading.value) {
      const hadPendingSelection = selectedFiles.value.length > 0;
      resetUploadDialog();
      uploadDialogVisible.value = false;
      if (hadPendingSelection) {
        ElMessage.info("报表月份已切换，请为新月份重新选择银行回单");
      }
      void loadBankState();
    }
  },
  { immediate: true },
);

watch(
  [() => selectedFiles.value.length, processingOutcomeUncertain],
  ([count, uncertain]) => {
    emit("pending-change", Number(count) > 0 || Boolean(uncertain));
    emit("uncertain-change", Boolean(uncertain));
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  uploadAbortController?.abort();
  stopUploadTimer();
  emit("busy-change", false);
  emit("pending-change", false);
  emit("uncertain-change", false);
});

defineExpose({
  openUploadDialog,
  refreshBankState: loadBankState,
});

async function loadBankState() {
  const targetMonth = props.month;
  const sequence = ++stateRequestSequence;
  stateLoading.value = true;
  stateError.value = "";
  try {
    const state = await getMonthlyFinancialBankReceipts(targetMonth);
    if (sequence !== stateRequestSequence || props.month !== targetMonth)
      return;
    bankState.value = state;
    const uncertainHashesConfirmed =
      processingOutcomeUncertain.value &&
      uncertainMonth.value === targetMonth &&
      uncertainFileHashes.value.length > 0 &&
      uncertainFileHashes.value.every((fileHash) =>
        (state.knownFileHashes || []).includes(fileHash),
      );
    if (uncertainHashesConfirmed) {
      clearUncertainOutcome(targetMonth);
      lastUploadNotice.value = "已从服务端确认上一批银行回单保存成功";
    } else if (
      processingOutcomeUncertain.value &&
      uncertainMonth.value === targetMonth
    ) {
      uncertainStateCheckedWithoutMatch.value = true;
    }
  } catch (error) {
    if (sequence !== stateRequestSequence || props.month !== targetMonth)
      return;
    stateError.value = getMonthlyFinancialReportErrorMessage(
      error,
      "暂时无法获取银行回单状态，请稍后重试。",
    );
  } finally {
    if (sequence === stateRequestSequence) stateLoading.value = false;
  }
}

function openUploadDialog() {
  if (!props.canUpload || props.disabled || uploading.value) return;
  uploadErrorMessage.value = processingOutcomeUncertain.value
    ? "上一批上传结果仍待确认，请先使用页面上的“刷新回单状态”，不要重复提交"
    : "";
  mixedMonthConfirmationPending.value = false;
  uploadDialogVisible.value = true;
}

function openFilePicker() {
  if (
    uploading.value ||
    !props.canUpload ||
    props.disabled ||
    (processingOutcomeUncertain.value && !uncertainSafeRetryMode.value)
  )
    return;
  fileInputRef.value?.click();
}

function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement;
  addSelectedFiles(Array.from(input.files || []));
  input.value = "";
}

function handleFileDrop(event: DragEvent) {
  if (
    uploading.value ||
    !props.canUpload ||
    props.disabled ||
    (processingOutcomeUncertain.value && !uncertainSafeRetryMode.value)
  )
    return;
  addSelectedFiles(Array.from(event.dataTransfer?.files || []));
}

function addSelectedFiles(files: File[]) {
  uploadErrorMessage.value = "";
  mixedMonthConfirmationPending.value = false;
  for (const file of files) {
    if (!/\.pdf$/i.test(file.name)) {
      ElMessage.warning(`${file.name}不是 PDF（便携式文档），已跳过`);
      continue;
    }
    if (file.size > 50 * 1024 * 1024) {
      ElMessage.warning(`${file.name}超过 50MB，已跳过`);
      continue;
    }
    if (selectedFiles.value.length >= 3) {
      ElMessage.warning("一次最多选择三份银行回单");
      break;
    }
    selectedFiles.value.push(file);
  }
}

function removeSelectedFile(file: File) {
  selectedFiles.value = selectedFiles.value.filter((item) => item !== file);
  uploadErrorMessage.value = "";
  mixedMonthConfirmationPending.value = false;
}

async function submitSelectedFiles(mixedMonthConfirmed: boolean) {
  if (
    uploading.value ||
    props.disabled ||
    !props.canUpload ||
    (processingOutcomeUncertain.value && !uncertainSafeRetryMode.value) ||
    selectedFiles.value.length === 0
  ) {
    return;
  }
  const targetMonth = props.month;
  const targetVersion = props.expectedVersion;
  const targetFiles = [...selectedFiles.value];
  let targetFileHashes: string[] = [];
  uploadErrorMessage.value = "";
  mixedMonthConfirmationPending.value = false;
  setUploading(true);
  uploadAbortController = new AbortController();
  try {
    const calculatedFileHashes = await Promise.all(
      targetFiles.map((file) => calculateFileSha256(file)),
    );
    targetFileHashes = calculatedFileHashes.every(
      (fileHash): fileHash is string => Boolean(fileHash),
    )
      ? calculatedFileHashes
      : [];
    if (
      uncertainSafeRetryMode.value &&
      uncertainFileHashes.value.length > 0 &&
      targetFileHashes.length === targetFiles.length &&
      !sameFileHashSet(targetFileHashes, uncertainFileHashes.value)
    ) {
      uploadErrorMessage.value =
        "所选文件与上一批原件摘要不一致，请只选择完全相同的原件安全重试";
      return;
    }
    markUncertainOutcome(
      targetMonth,
      targetFiles.map((file) => file.name),
      targetFileHashes,
    );
    const result = await uploadMonthlyFinancialBankReceipts(
      targetMonth,
      targetVersion,
      targetFiles,
      mixedMonthConfirmed,
      uploadAbortController.signal,
    );
    if (props.month !== targetMonth) {
      ElMessage.info(
        "回单上传已完成，但当前页面月份已变化，未覆盖当前月份状态",
      );
      return;
    }
    bankState.value = result.bankStatements;
    stateError.value = "";
    clearUncertainOutcome(targetMonth);
    lastUploadNotice.value = uploadResultMessage(result);
    selectedFiles.value = [];
    uploadDialogVisible.value = false;
    emit("uploaded", result);
    ElMessage.success(result.message || "银行回单已识别并更新月度财务报表");
  } catch (error) {
    const errorCode = String((error as { code?: unknown })?.code || "");
    if (errorCode === "ERR_CANCELED") {
      markUncertainOutcome(
        targetMonth,
        targetFiles.map((file) => file.name),
        targetFileHashes,
      );
      uploadErrorMessage.value =
        "已停止前端等待；服务端可能仍在处理，请关闭弹窗并稍后刷新回单状态，不要立即重复提交";
      return;
    }
    const responseErrorCode = getMonthlyFinancialReportErrorCode(error);
    if (
      responseErrorCode === "MONTHLY_BANK_UPLOAD_COMMITTED_REFRESH_REQUIRED" ||
      ["ECONNABORTED", "ERR_NETWORK"].includes(errorCode)
    ) {
      markUncertainOutcome(
        targetMonth,
        targetFiles.map((file) => file.name),
        targetFileHashes,
      );
      uploadErrorMessage.value = getMonthlyFinancialReportErrorMessage(
        error,
        "本次处理结果暂时无法确认，请关闭弹窗并稍后刷新回单状态，不要立即重复提交",
      );
      return;
    }
    clearUncertainOutcome(targetMonth);
    if (isMonthlyFinancialReportVersionConflict(error)) {
      try {
        const [latestReport, latestBankState] = await Promise.all([
          getMonthlyFinancialReport(targetMonth),
          getMonthlyFinancialBankReceipts(targetMonth),
        ]);
        if (props.month === targetMonth) {
          bankState.value = latestBankState;
          stateError.value = "";
          emit("report-refreshed", latestReport);
          uploadErrorMessage.value =
            latestReport.status === "closed"
              ? "本月报表已由其他管理员完成月结，不能继续上传；已选文件尚未提交"
              : "月报已刷新到最新版本，请核对当前文件后再次点击上传";
          return;
        }
      } catch {
        // 刷新失败时继续展示原版本冲突提示，并保留已选文件。
      }
    }
    uploadErrorMessage.value = getMonthlyFinancialReportErrorMessage(
      error,
      "银行回单上传失败，请稍后重试。",
    );
    mixedMonthConfirmationPending.value =
      !mixedMonthConfirmed &&
      isMonthlyFinancialBankMixedMonthConfirmationRequired(error);
  } finally {
    uploadAbortController = null;
    setUploading(false);
  }
}

function stopWaiting() {
  if (!uploading.value || !uploadAbortController) return;
  uploadAbortController.abort();
}

function setUploading(value: boolean) {
  uploading.value = value;
  emit("busy-change", value);
  if (value) {
    uploadElapsedSeconds.value = 0;
    stopUploadTimer();
    uploadTimer = window.setInterval(() => {
      uploadElapsedSeconds.value += 1;
    }, 1000);
    return;
  }
  stopUploadTimer();
}

function stopUploadTimer() {
  if (uploadTimer !== undefined) {
    window.clearInterval(uploadTimer);
    uploadTimer = undefined;
  }
}

function handleDialogBeforeClose(done: () => void) {
  if (uploading.value) {
    ElMessage.warning("银行回单仍在识别中，请等待处理完成");
    return;
  }
  resetUploadDialog();
  done();
}

function cancelUpload() {
  if (uploading.value) return;
  resetUploadDialog();
  uploadDialogVisible.value = false;
}

function resetUploadDialog() {
  uploadAbortController?.abort();
  uploadAbortController = null;
  selectedFiles.value = [];
  uploadErrorMessage.value = "";
  mixedMonthConfirmationPending.value = false;
}

function uncertainStorageKey(month: string) {
  return `monthly-bank-upload-uncertain:${month}`;
}

function markUncertainOutcome(
  month: string,
  fileNames: string[],
  fileHashes: string[],
) {
  processingOutcomeUncertain.value = true;
  uncertainFileNames.value = [...fileNames];
  uncertainFileHashes.value = [...fileHashes];
  uncertainMonth.value = month;
  uncertainStateCheckedWithoutMatch.value = false;
  uncertainSafeRetryMode.value = false;
  try {
    window.sessionStorage.setItem(
      uncertainStorageKey(month),
      JSON.stringify({ month, fileNames, fileHashes }),
    );
  } catch {
    // 浏览器禁用会话存储时仍保留当前页面内保护。
  }
}

function clearUncertainOutcome(month: string) {
  try {
    window.sessionStorage.removeItem(uncertainStorageKey(month));
  } catch {
    // 浏览器禁用会话存储不影响当前页面状态清理。
  }
  if (uncertainMonth.value && uncertainMonth.value !== month) return;
  processingOutcomeUncertain.value = false;
  uncertainFileNames.value = [];
  uncertainFileHashes.value = [];
  uncertainMonth.value = "";
  uncertainStateCheckedWithoutMatch.value = false;
  uncertainSafeRetryMode.value = false;
}

function restoreUncertainOutcome(month: string) {
  processingOutcomeUncertain.value = false;
  uncertainFileNames.value = [];
  uncertainFileHashes.value = [];
  uncertainMonth.value = "";
  uncertainStateCheckedWithoutMatch.value = false;
  uncertainSafeRetryMode.value = false;
  try {
    const raw = window.sessionStorage.getItem(uncertainStorageKey(month));
    if (!raw) return;
    const stored = JSON.parse(raw) as {
      month?: unknown;
      fileNames?: unknown;
      fileHashes?: unknown;
    };
    const hashes = Array.isArray(stored.fileHashes)
      ? stored.fileHashes
          .map((value) => String(value || "").toLowerCase())
          .filter((value) => /^[0-9a-f]{64}$/u.test(value))
      : [];
    const fileNames = Array.isArray(stored.fileNames)
      ? stored.fileNames.map((value) => String(value || "")).filter(Boolean)
      : [];
    if (
      stored.month !== month ||
      (hashes.length === 0 && fileNames.length === 0)
    ) {
      window.sessionStorage.removeItem(uncertainStorageKey(month));
      return;
    }
    processingOutcomeUncertain.value = true;
    uncertainMonth.value = month;
    uncertainFileHashes.value = hashes;
    uncertainFileNames.value = fileNames;
  } catch {
    try {
      window.sessionStorage.removeItem(uncertainStorageKey(month));
    } catch {
      // 忽略存储清理失败。
    }
  }
}

function allowUncertainSafeRetry() {
  if (uncertainFileHashes.value.length === 0) {
    clearUncertainOutcome(props.month);
    uploadErrorMessage.value = "";
    uploadDialogVisible.value = true;
    return;
  }
  uncertainSafeRetryMode.value = true;
  uploadErrorMessage.value =
    "请重新选择完全相同的一批原件；页面会先核对摘要，服务端仍会按摘要和月报版本防止重复入账";
  uploadDialogVisible.value = true;
}

function sameFileHashSet(left: string[], right: string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

async function calculateFileSha256(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) {
    return null;
  }
  try {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      await readFileArrayBuffer(file),
    );
    return Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return null;
  }
}

async function readFileArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("读取文件失败"));
    };
    reader.readAsArrayBuffer(file);
  });
}

function uploadResultMessage(result: MonthlyFinancialBankReceiptUploadResult) {
  const parts = [result.message || "银行回单已更新"];
  if (result.duplicateFiles.length) {
    parts.push(
      `重复文件已跳过：${result.duplicateFiles
        .map((item) => item.originalName)
        .join("、")}`,
    );
  }
  if (result.affectedMonths.length) {
    parts.push(`受影响月份：${result.affectedMonths.join("、")}`);
  }
  return parts.join("；");
}

async function reviewAndExcludeTransaction(transactionId: string) {
  if (
    reviewingTransactionId.value ||
    uploading.value ||
    props.disabled ||
    !props.canUpload
  ) {
    return;
  }
  const targetMonth = props.month;
  const targetVersion = props.expectedVersion;
  reviewingTransactionId.value = transactionId;
  emit("busy-change", true);
  try {
    const prompt = await ElMessageBox.prompt(
      "排除后该笔交易不会计入本月经营收支，原始回单和审计记录仍会保留。请填写复核原因。",
      "复核排除银行交易",
      {
        confirmButtonText: "确认排除",
        cancelButtonText: "取消",
        inputType: "textarea",
        inputPlaceholder: "请输入复核原因",
        inputValidator: (value) => {
          const text = String(value || "").trim();
          if (!text) return "复核原因不能为空";
          if (text.length > 500) return "复核原因不能超过500字";
          return true;
        },
      },
    );
    if (
      props.month !== targetMonth ||
      props.expectedVersion !== targetVersion
    ) {
      ElMessage.warning("月报上下文已变化，请刷新后重新复核");
      return;
    }
    const result = await reviewMonthlyFinancialBankTransaction(
      targetMonth,
      transactionId,
      targetVersion,
      String(prompt.value || "").trim(),
    );
    bankState.value = result.bankStatements;
    stateError.value = "";
    lastUploadNotice.value = result.message || "待复核交易已排除";
    emit("uploaded", result);
    ElMessage.success(result.message || "待复核交易已排除");
  } catch (error) {
    if (
      error === "cancel" ||
      error === "close" ||
      ["cancel", "close"].includes(
        String((error as { action?: unknown })?.action || ""),
      )
    ) {
      return;
    }
    ElMessage.error(
      getMonthlyFinancialReportErrorMessage(
        error,
        "复核排除失败，请刷新后重试",
      ),
    );
  } finally {
    reviewingTransactionId.value = "";
    emit("busy-change", false);
  }
}

function toggleAccount(code: MonthlyFinancialBankAccountCode) {
  expandedAccounts.value = isAccountExpanded(code)
    ? expandedAccounts.value.filter((item) => item !== code)
    : [...expandedAccounts.value, code];
}

function isAccountExpanded(code: MonthlyFinancialBankAccountCode) {
  return expandedAccounts.value.includes(code);
}

function accountIssues(account: MonthlyFinancialBankReceiptAccount): string[] {
  return Array.from(
    new Set([
      ...(account.file?.warnings || []),
      ...(account.file?.anomalies || []),
    ]),
  ).filter(Boolean);
}

function hasSafelyIncludedCharges(
  account: MonthlyFinancialBankReceiptAccount,
): boolean {
  return (
    account.file?.status === "partial" &&
    account.transactions.some(
      (row) =>
        row.includeInReport &&
        (row.category === "interest" || row.category === "bank_fee"),
    )
  );
}

function bankAccountShortName(code: MonthlyFinancialBankAccountCode) {
  return { basic: "基", general: "般", business: "商" }[code];
}

function fileStatusMeta(status: string) {
  return (
    {
      recognized: { label: "识别完成", type: "success" as const },
      partial: { label: "部分需复核", type: "warning" as const },
      review_required: { label: "需要复核", type: "warning" as const },
      awaiting_month_confirmation: {
        label: "待确认月份",
        type: "warning" as const,
      },
      failed: { label: "识别失败", type: "danger" as const },
      processing: { label: "识别中", type: "primary" as const },
    }[status] || { label: status || "已上传", type: "info" as const }
  );
}

function directionMeta(direction: string | null) {
  return (
    {
      inflow: { label: "流入", type: "success" as const },
      outflow: { label: "流出", type: "warning" as const },
      unknown: { label: "待确认", type: "info" as const },
    }[direction || "unknown"] || { label: "待确认", type: "info" as const }
  );
}

function categoryMeta(category: string) {
  return (
    {
      interest: { label: "账户利息", type: "success" as const },
      bank_fee: { label: "银行手续费", type: "warning" as const },
      basic_reimbursement: { label: "基础报销", type: "primary" as const },
      large_reimbursement: { label: "大额报销", type: "primary" as const },
      business_reimbursement: { label: "商务报销", type: "primary" as const },
      salary: { label: "人员薪资", type: "primary" as const },
      main_income: { label: "主营收入", type: "success" as const },
      asset_expense: { label: "资产支出", type: "warning" as const },
      internal_transfer: { label: "内部划转", type: "info" as const },
      ignored: { label: "已忽略", type: "info" as const },
      unclassified: { label: "待分类", type: "warning" as const },
    }[category] || { label: category || "待分类", type: "info" as const }
  );
}

function linkStatusMeta(status: string) {
  return (
    {
      matched: { label: "已匹配", type: "success" as const },
      conflict: { label: "匹配冲突", type: "danger" as const },
      unmatched: { label: "未匹配", type: "info" as const },
    }[status] || { label: status || "未匹配", type: "info" as const }
  );
}

function transactionMatchMeta(
  transaction: MonthlyFinancialBankReceiptTransaction,
) {
  if (
    [
      "basic_reimbursement",
      "large_reimbursement",
      "business_reimbursement",
    ].includes(transaction.category)
  ) {
    return monthlyReimbursementLinkDisplay(transaction);
  }
  return linkStatusMeta(transaction.linkStatus);
}

function filenameAccountHint(fileName: string): string {
  const normalized = fileName.normalize("NFKC");
  if (normalized.includes("基本")) return "文件名提示：基本账户";
  if (normalized.includes("一般")) return "文件名提示：一般账户";
  if (normalized.includes("商务")) return "文件名提示：商务账户";
  return "账户以回单完整账号识别";
}

function detectedMonthText(months: string[]) {
  return months?.length ? months.map(formatMonth).join("、") : "未识别";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatMonth(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[1]}年${Number(match[2])}月` : value;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatAmount(
  value: MonthlyFinancialAmount | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value).trim();
  const match = text.match(/^([+-]?)(\d+)(\.\d+)?$/);
  if (!match) return text;
  const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `¥${match[1]}${integer}${match[3] || ""}`;
}
</script>

<style scoped>
.bank-receipt-panel {
  margin-top: 18px;
  padding: 20px;
  border: 1px solid #dfe7ef;
  border-radius: 15px;
  background: #fff;
}

.bank-panel-heading,
.bank-account-heading,
.bank-panel-title-row {
  display: flex;
  align-items: center;
}

.bank-panel-heading {
  justify-content: space-between;
  gap: 18px;
}

.bank-panel-title-row {
  gap: 10px;
}

.bank-panel-heading h2,
.bank-panel-heading p,
.bank-account-heading h3 {
  margin: 0;
}

.bank-panel-heading h2 {
  font-size: 18px;
}

.bank-panel-heading p {
  margin-top: 5px;
  color: #64748b;
  font-size: 13px;
}

.bank-panel-alert,
.upload-dialog-alert {
  margin-top: 14px;
}

.uncertain-retry-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid #f5d7a1;
  border-radius: 8px;
  color: #8a5a13;
  background: #fffaf0;
}

.bank-state-loading {
  margin-top: 16px;
  padding: 18px;
  border: 1px solid #e5ebf2;
  border-radius: 12px;
}

.bank-account-list {
  display: grid;
  gap: 14px;
  margin-top: 16px;
}

.bank-account-card {
  overflow: hidden;
  border: 1px solid #dfe7ef;
  border-radius: 13px;
  background: #fbfdff;
}

.bank-account-card--warning {
  border-color: #e9bf73;
}

.bank-account-card--empty {
  background: #fafbfc;
}

.bank-account-heading {
  gap: 12px;
  padding: 15px 16px;
  border-bottom: 1px solid #e7edf4;
  background: #f5f9fd;
}

.bank-account-mark {
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: #e7f1fb;
  color: #2563a8;
  font-size: 13px;
  font-weight: 800;
}

.bank-account-identity {
  min-width: 0;
}

.bank-account-identity > div {
  display: flex;
  align-items: center;
  gap: 9px;
}

.bank-account-identity h3 {
  font-size: 16px;
}

.bank-account-identity code,
.bank-party-cell code {
  display: block;
  color: #52637a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bank-account-identity code {
  margin-top: 4px;
}

.bank-detail-toggle {
  flex: none;
  margin-left: auto;
}

.bank-file-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  align-items: center;
  padding: 12px 16px;
  color: #64748b;
  font-size: 12px;
}

.bank-file-name {
  display: flex;
  min-width: 180px;
  max-width: 420px;
  align-items: center;
  gap: 7px;
  color: #26364d;
  font-weight: 600;
}

.bank-file-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bank-issue-list {
  display: grid;
  gap: 8px;
  padding: 0 16px 12px;
}

.bank-total-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0 16px 15px;
}

.bank-total-grid > div {
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid #e5ebf2;
  border-radius: 10px;
  background: #fff;
}

.bank-total-grid dt,
.bank-total-grid small {
  color: #64748b;
  font-size: 12px;
}

.bank-total-grid dd {
  margin: 6px 0 0;
  overflow: hidden;
  color: #172033;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bank-total-grid dd.is-income {
  color: #087a55;
}

.bank-total-grid dd.is-expense {
  color: #b45309;
}

.bank-total-grid .internal-transfer-total {
  background: #f1f6fb;
}

.bank-total-grid .basic-bank-exclusion-total {
  grid-column: span 2;
  background: #f8fafc;
}

.bank-total-grid .basic-bank-exclusion-total dd {
  color: #64748b;
  font-size: 12px;
  white-space: normal;
}

.bank-total-grid small {
  display: block;
  margin-top: 4px;
}

.bank-transaction-shell {
  padding: 0 16px 16px;
}

.bank-transaction-table {
  width: 100%;
}

.bank-category-cell,
.bank-match-cell,
.bank-party-cell,
.bank-reference-cell,
.transaction-warnings {
  display: grid;
  gap: 4px;
  align-items: start;
}

.bank-category-cell {
  justify-items: start;
}

.bank-match-cell {
  justify-items: center;
}

.bank-category-cell small,
.bank-match-cell small,
.bank-reference-cell small,
.transaction-warnings small {
  color: #64748b;
  font-size: 11px;
  line-height: 1.45;
}

.bank-party-cell strong {
  overflow-wrap: anywhere;
  font-size: 12px;
}

.bank-reference-cell span {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.bank-transaction-amount {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bank-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  justify-content: center;
}

.bank-account-empty {
  padding: 18px 0 22px;
}

.bank-file-drop {
  display: grid;
  justify-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 28px 18px;
  border: 1px dashed #91b5d8;
  border-radius: 12px;
  color: #315f89;
  background: #f5faff;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.bank-file-drop:hover,
.bank-file-drop:focus-visible {
  border-color: #409eff;
  background: #eef7ff;
  outline: none;
}

.bank-file-drop.is-disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.bank-file-drop-icon {
  color: #4f92cb;
  font-size: 34px;
}

.bank-file-drop span {
  color: #76879b;
  font-size: 12px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  clip-path: inset(50%);
}

.selected-bank-files {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.selected-bank-files article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 11px 12px;
  border: 1px solid #e0e8f0;
  border-radius: 10px;
  background: #fafcff;
}

.selected-bank-files strong,
.selected-bank-files span {
  display: block;
}

.selected-bank-files strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-bank-files span {
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
}

.bank-upload-progress {
  display: flex;
  gap: 13px;
  align-items: flex-start;
  margin-top: 16px;
  padding: 14px;
  border: 1px solid #b9d7ef;
  border-radius: 11px;
  color: #24587e;
  background: #edf7ff;
}

.bank-upload-progress > .el-icon {
  flex: none;
  margin-top: 2px;
  font-size: 21px;
}

.bank-upload-progress p {
  margin: 4px 0 0;
  color: #5d7288;
  line-height: 1.55;
}

@media (max-width: 900px) {
  .bank-panel-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .bank-total-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .bank-receipt-panel {
    padding: 14px;
  }

  .bank-account-heading {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .bank-detail-toggle {
    width: 100%;
    margin-left: 52px;
    justify-content: flex-start;
  }

  .bank-total-grid {
    grid-template-columns: 1fr;
  }

  .bank-total-grid .basic-bank-exclusion-total {
    grid-column: span 1;
  }
}
</style>
