<template>
  <div class="probation-page">
    <div v-if="loading" class="loading-panel">
      <el-skeleton :rows="7" animated />
    </div>
    <el-empty v-else-if="!myStatus" description="暂无员工档案" />

    <template v-else>
      <el-alert
        v-if="isDirectActiveEmployee"
        type="success"
        :closable="false"
        show-icon
        title="当前为正式在职状态，无需发起转正审批"
      />
      <el-alert
        v-else-if="confirmation?.status === 'approved'"
        type="success"
        :closable="false"
        show-icon
        :title="approvedAlertTitle"
      />
      <el-alert
        v-else-if="confirmation?.status === 'rejected'"
        type="error"
        :closable="false"
        show-icon
        :title="`转正申请被${reviewerText}驳回，请修改后重新签名提交`"
      >
        <template #default>
          <span v-if="confirmation.approver_comment"
            >驳回原因：{{ confirmation.approver_comment }}</span
          >
        </template>
      </el-alert>
      <el-alert
        v-else-if="confirmation?.status === 'submitted'"
        type="warning"
        :closable="false"
        show-icon
        :title="`申请已提交，当前环节：${myStatus.reviewStageLabel || '-'}`"
      />
      <el-alert
        v-else-if="!canStartApplication"
        type="info"
        :closable="false"
        show-icon
        title="劳动合同及试用期信息尚未完整，暂不能填写转正申请"
      />

      <section class="summary-band">
        <div class="employee-title">
          <div>
            <h2>{{ myStatus.profile?.name || "-" }}</h2>
            <p>
              {{ myStatus.profile?.department || "-" }} ·
              {{ myStatus.profile?.position || "-" }}
            </p>
          </div>
          <el-tag :type="statusType" size="large" effect="light">{{
            statusText
          }}</el-tag>
        </div>

        <div class="summary-grid">
          <div class="summary-item">
            <span>入职日期</span>
            <strong>{{ formatDate(myStatus.profile?.hire_date) }}</strong>
          </div>
          <div class="summary-item">
            <span>试用期截止</span>
            <strong>{{ formatDate(confirmation?.probation_end_date) }}</strong>
          </div>
          <div class="summary-item">
            <span>主管领导</span>
            <strong>{{ supervisorDisplayText }}</strong>
          </div>
          <div class="summary-item">
            <span>当前环节</span>
            <strong>{{ myStatus.reviewStageLabel || "-" }}</strong>
          </div>
        </div>

        <div class="summary-actions">
          <el-button
            v-if="canStartApplication"
            type="primary"
            :icon="EditPen"
            @click="openApplicationPage"
          >
            {{
              confirmation?.status === "rejected"
                ? "修改并重新签名"
                : "申请转正"
            }}
          </el-button>
          <el-button
            v-if="canViewCurrentApplication"
            type="primary"
            plain
            :icon="View"
            @click="openApplicationPage"
          >
            查看申请表
          </el-button>
          <el-button
            v-if="canWithdraw"
            type="warning"
            plain
            :icon="RefreshLeft"
            @click="withdrawApplication"
          >
            撤回申请
          </el-button>
          <el-button
            v-if="canDeleteRecord"
            type="danger"
            plain
            :icon="Delete"
            @click="deleteRecord"
          >
            删除记录
          </el-button>
        </div>
      </section>

      <section
        v-if="confirmation && confirmation.form_version > 0"
        class="workflow-section"
      >
        <div class="section-heading">
          <h3>当前审批流程</h3>
          <span>第 {{ confirmation.form_version }} 版</span>
        </div>

        <ProbationApprovalRecords
          :records="myStatus.signatureHistory || myStatus.signatures"
          :current-version="confirmation.form_version"
          :review-stage="confirmation.review_stage"
          :status="confirmation.status"
          :assignees="myStatus.approverNames"
          :show-history="false"
        />
      </section>

      <section v-if="myStatus.documents?.length" class="documents-section">
        <div class="section-heading">
          <h3>正式转正申请单</h3>
          <el-tag type="success" effect="light">已归档</el-tag>
        </div>
        <el-table :data="myStatus.documents" stripe>
          <el-table-column prop="file_name" label="文件名" min-width="260" />
          <el-table-column label="归档时间" width="170">
            <template #default="{ row }">{{
              formatDateTime(row.created_at)
            }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110" align="center">
            <template #default="{ row }">
              <el-button
                type="primary"
                link
                :icon="View"
                @click="previewDocument(row.id)"
              >
                预览
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section v-if="myStatus.probationHistory?.length" class="history-section">
        <div class="section-heading"><h3>历史转正记录</h3></div>
        <el-table :data="myStatus.probationHistory" stripe>
          <el-table-column label="入职日期" width="120" align="center">
            <template #default="{ row }">{{
              formatDate(row.hire_date)
            }}</template>
          </el-table-column>
          <el-table-column label="试用期截止" width="120" align="center">
            <template #default="{ row }">{{
              formatDate(row.probation_end_date)
            }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">{{
              probationStatusText(row.status)
            }}</template>
          </el-table-column>
          <el-table-column label="审批时间" width="170">
            <template #default="{ row }">{{
              formatDateTime(row.approve_time)
            }}</template>
          </el-table-column>
          <el-table-column
            prop="reset_reason"
            label="重置原因"
            min-width="180"
          />
          <el-table-column label="操作" width="100" align="center">
            <template #default="{ row }">
              <el-button type="primary" link @click="viewHistoryApproval(row)">
                审批记录
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </template>

    <el-dialog
      v-model="historyApprovalVisible"
      title="历史审批记录"
      width="min(880px, 94vw)"
      :close-on-click-modal="false"
    >
      <el-skeleton v-if="historyApprovalLoading" :rows="6" animated />
      <template v-else-if="historyApprovalRow">
        <el-descriptions :column="2" border size="small" class="history-meta">
          <el-descriptions-item label="入职日期">
            {{ formatDate(historyApprovalRow.hire_date) }}
          </el-descriptions-item>
          <el-descriptions-item label="试用期截止">
            {{ formatDate(historyApprovalRow.probation_end_date) }}
          </el-descriptions-item>
          <el-descriptions-item label="转正状态">
            {{ probationStatusText(historyApprovalRow.status) }}
          </el-descriptions-item>
          <el-descriptions-item label="审批时间">
            {{ formatDateTime(historyApprovalRow.approve_time) }}
          </el-descriptions-item>
          <el-descriptions-item label="重置时间">
            {{ formatDateTime(historyApprovalRow.reset_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="重置原因">
            {{ historyApprovalRow.reset_reason || "-" }}
          </el-descriptions-item>
        </el-descriptions>

        <ProbationApprovalRecords
          v-if="
            historyApprovalSignatures.length || historyApprovalRecords.length
          "
          :records="historyApprovalSignatures"
          :fallback-records="historyApprovalRecords"
          :current-version="historyApprovalRow.form_version"
          :review-stage="historyApprovalRow.review_stage"
          :status="historyApprovalRow.status"
        />
        <el-empty
          v-else
          description="暂无历史审批明细，该记录可能产生于审批快照启用前"
        />
      </template>
      <template #footer>
        <el-button @click="historyApprovalVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Delete, EditPen, RefreshLeft, View } from "@element-plus/icons-vue";
import dayjs from "dayjs";
import { api } from "@/utils/api";
import { formatBeijingDateTimeMinute } from "@/utils/date";
import { usePendingStore } from "@/stores/pending";
import ProbationApprovalRecords from "@/components/probation/ProbationApprovalRecords.vue";
import type {
  ProbationApprovalRecord,
  ProbationApproverNames,
} from "@/utils/probationApproval";

type ReviewStage =
  | "employee"
  | "supervisor"
  | "hr"
  | "general_manager"
  | "completed";
type ConversionType = "normal" | "early" | "extended" | "other";

interface Confirmation {
  id: string;
  employee_id: string;
  hire_date: string | null;
  probation_end_date: string | null;
  status: "pending" | "submitted" | "approved" | "rejected";
  form_version: number;
  review_stage: ReviewStage;
  conversion_type: ConversionType;
  conversion_type_other: string | null;
  self_statement: string | null;
  applicant_name_snapshot: string | null;
  department_snapshot: string | null;
  position_snapshot: string | null;
  submit_time: string | null;
  approve_time: string | null;
  approver_comment: string | null;
  formal_document_generated_at: string | null;
}

interface SignatureRecord extends ProbationApprovalRecord {
  signature_image_url?: string;
}

interface ProbationHistoryRecord {
  id: string;
  hire_date: string | null;
  probation_end_date: string | null;
  status: Confirmation["status"];
  approve_time: string | null;
  reset_reason: string | null;
  reset_at: string;
  form_version: number;
  review_stage: ReviewStage;
  has_approval_history: boolean;
}

interface ArchivedApprovalRecord {
  id: string;
  action: string;
  comment: string | null;
  action_time: string;
  approver_name: string;
}

interface MyStatus {
  profile: {
    id: string;
    name: string;
    department: string | null;
    position: string | null;
    hire_date: string | null;
    employment_status: string;
  } | null;
  confirmation: Confirmation | null;
  hasHistory: boolean;
  hasRealConfirmation: boolean;
  documents: Array<{ id: string; file_name: string; created_at: string }>;
  signatures: SignatureRecord[];
  signatureHistory: SignatureRecord[];
  reviewStageLabel: string;
  supervisorName: string | null;
  approverNames: ProbationApproverNames;
  probationHistory: ProbationHistoryRecord[];
}

const pendingStore = usePendingStore();
const router = useRouter();
const loading = ref(false);
const myStatus = ref<MyStatus | null>(null);
const historyApprovalVisible = ref(false);
const historyApprovalLoading = ref(false);
const historyApprovalRow = ref<ProbationHistoryRecord | null>(null);
const historyApprovalSignatures = ref<SignatureRecord[]>([]);
const historyApprovalRecords = ref<ArchivedApprovalRecord[]>([]);

const confirmation = computed(() => myStatus.value?.confirmation || null);
const isDirectActiveEmployee = computed(
  () =>
    myStatus.value?.profile?.employment_status === "active" &&
    confirmation.value?.status !== "approved",
);
const canStartApplication = computed(() => {
  if (myStatus.value?.profile?.employment_status !== "probation") return false;
  if (
    !myStatus.value.profile.hire_date ||
    !confirmation.value?.probation_end_date
  )
    return false;
  return (
    !confirmation.value.id ||
    confirmation.value.status === "pending" ||
    confirmation.value.status === "rejected"
  );
});
const canViewCurrentApplication = computed(
  () =>
    confirmation.value?.status === "submitted" &&
    (confirmation.value.form_version || 0) > 0,
);
const canWithdraw = computed(
  () =>
    confirmation.value?.status === "submitted" &&
    confirmation.value.review_stage === "supervisor",
);
const canDeleteRecord = computed(
  () =>
    myStatus.value?.hasRealConfirmation &&
    (confirmation.value?.status === "rejected" ||
      (confirmation.value?.status === "pending" && myStatus.value?.hasHistory)),
);
const statusType = computed<"success" | "warning" | "danger" | "info">(() => {
  const map = {
    pending: "info",
    submitted: "warning",
    approved: "success",
    rejected: "danger",
  } as const;
  return map[confirmation.value?.status || "pending"];
});
const statusText = computed(() =>
  probationStatusText(confirmation.value?.status || "pending"),
);
const approvedAlertTitle = computed(() =>
  confirmation.value?.formal_document_generated_at
    ? `转正已完成，正式申请单生成于 ${formatDateTime(confirmation.value.formal_document_generated_at)}`
    : "转正已完成，正式申请单已归档",
);
const supervisorDisplayText = computed(() => {
  if (myStatus.value?.supervisorName) return myStatus.value.supervisorName;
  if (
    !confirmation.value?.id ||
    ["pending", "rejected"].includes(confirmation.value.status)
  ) {
    return "提交后自动确定";
  }
  return "-";
});
const reviewerText = computed(() => {
  const signature = [...(myStatus.value?.signatures || [])]
    .reverse()
    .find((item) => item.decision === "reject");
  const labels: Record<string, string> = {
    supervisor: "主管领导",
    hr: "人事部",
    general_manager: "总经理",
  };
  return labels[signature?.stage || ""] || "审批人";
});

function formatDate(value: string | null | undefined) {
  return value ? dayjs(value).format("YYYY-MM-DD") : "-";
}

function formatDateTime(value: string | null | undefined) {
  return formatBeijingDateTimeMinute(value) || "-";
}

function probationStatusText(status: string) {
  const labels: Record<string, string> = {
    pending: "待填写",
    submitted: "签署中",
    approved: "已转正",
    rejected: "已驳回",
  };
  return labels[status] || status;
}

function requestErrorMessage(error: unknown, fallback: string) {
  const requestError = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return (
    requestError.response?.data?.message || requestError.message || fallback
  );
}

async function fetchMyStatus() {
  loading.value = true;
  try {
    const response = await api.get("/api/probation/my-status");
    if (response.data.success) myStatus.value = response.data.data;
  } catch (error: unknown) {
    ElMessage.error(requestErrorMessage(error, "获取转正状态失败"));
  } finally {
    loading.value = false;
  }
}

async function viewHistoryApproval(row: ProbationHistoryRecord) {
  historyApprovalRow.value = row;
  historyApprovalSignatures.value = [];
  historyApprovalRecords.value = [];
  historyApprovalVisible.value = true;
  historyApprovalLoading.value = true;
  try {
    const response = await api.get(
      `/api/probation/history/${encodeURIComponent(row.id)}/approval-flow`,
    );
    if (response.data.success) {
      historyApprovalSignatures.value = response.data.data.signatures || [];
      historyApprovalRecords.value = response.data.data.records || [];
    }
  } catch (error: unknown) {
    ElMessage.error(requestErrorMessage(error, "获取历史审批记录失败"));
  } finally {
    historyApprovalLoading.value = false;
  }
}

function openApplicationPage() {
  void router.push({ name: "ProbationApplication" });
}

async function withdrawApplication() {
  try {
    await ElMessageBox.confirm(
      "确认撤回转正申请？本次签名记录会保留，重新提交时生成新版本。",
      "撤回申请",
      {
        confirmButtonText: "确认撤回",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    const response = await api.post("/api/probation/my-record/withdraw");
    ElMessage.success(response.data.message);
    await Promise.all([fetchMyStatus(), pendingStore.refreshPendingCounts()]);
  } catch (error: unknown) {
    if (error !== "cancel") {
      ElMessage.error(requestErrorMessage(error, "撤回失败"));
    }
  }
}

async function deleteRecord() {
  try {
    await ElMessageBox.confirm(
      "确认删除该转正记录及全部版本吗？",
      "删除转正记录",
      {
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        type: "error",
      },
    );
    const response = await api.delete("/api/probation/my-record");
    ElMessage.success(response.data.message);
    await Promise.all([fetchMyStatus(), pendingStore.refreshPendingCounts()]);
  } catch (error: unknown) {
    if (error !== "cancel") {
      ElMessage.error(requestErrorMessage(error, "删除失败"));
    }
  }
}

function previewDocument(documentId: string) {
  window.open(
    `/api/probation/my-doc/${documentId}/download`,
    "_blank",
    "noopener,noreferrer",
  );
}

onMounted(fetchMyStatus);
</script>

<style scoped>
.probation-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 100%;
}

.loading-panel {
  padding: 24px;
}

.summary-band,
.workflow-section,
.documents-section,
.history-section {
  padding: 20px 24px;
  border: 1px solid #e4e7ed;
  background: #fff;
}

.employee-title,
.section-heading,
.summary-actions {
  display: flex;
  align-items: center;
}

.employee-title,
.section-heading {
  justify-content: space-between;
}

.employee-title h2,
.section-heading h3 {
  margin: 0;
  color: #303133;
}

.employee-title h2 {
  font-size: 20px;
}

.employee-title p {
  margin: 6px 0 0;
  color: #909399;
}

.section-heading {
  margin-bottom: 16px;
}

.section-heading h3 {
  font-size: 17px;
}

.section-heading span {
  color: #909399;
  font-size: 13px;
}

.history-meta {
  margin-bottom: 20px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-top: 20px;
  background: #ebeef5;
  border: 1px solid #ebeef5;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 14px 16px;
  background: #fafafa;
}

.summary-item span {
  color: #909399;
  font-size: 13px;
}

.summary-item strong {
  color: #303133;
  font-size: 15px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.summary-actions {
  gap: 10px;
  margin-top: 18px;
}

@media (max-width: 1000px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .summary-band,
  .workflow-section,
  .application-section,
  .documents-section,
  .history-section {
    padding: 16px;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .summary-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .summary-actions :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }
}
</style>
