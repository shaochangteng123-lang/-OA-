<template>
  <section
    v-if="!hideWhenEmpty || loading || tasks.length > 0"
    class="signature-tasks"
  >
    <div v-if="showTitle" class="section-header">
      <div>
        <h3>待我签署</h3>
        <p>当前轮到您填写意见并签名的转正申请</p>
      </div>
      <el-tag v-if="tasks.length > 0" type="danger" effect="light">{{
        tasks.length
      }}</el-tag>
    </div>

    <el-table
      v-loading="loading"
      :data="tasks"
      stripe
      class="signature-table"
      empty-text="暂无待签署的转正申请"
    >
      <el-table-column
        prop="employee_name"
        label="申请人"
        min-width="90"
        align="center"
      />
      <el-table-column
        prop="employee_department"
        label="所属部门"
        min-width="96"
        align="center"
      >
        <template #default="{ row }">{{
          row.employee_department || "-"
        }}</template>
      </el-table-column>
      <el-table-column
        prop="employee_position"
        label="岗位职务"
        min-width="100"
        align="center"
      >
        <template #default="{ row }">{{
          row.employee_position || "-"
        }}</template>
      </el-table-column>
      <el-table-column label="入职日期" min-width="92" align="center">
        <template #default="{ row }">{{ formatDate(row.hire_date) }}</template>
      </el-table-column>
      <el-table-column label="当前环节" min-width="104" align="center">
        <template #default="{ row }">
          <el-tag type="warning" effect="light">{{
            row.review_stage_label
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" min-width="124" align="center">
        <template #default="{ row }">{{
          formatDateTime(row.submit_time)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="206" align="center">
        <template #default="{ row }">
          <el-button
            size="small"
            plain
            :icon="List"
            @click="openFlowDialog(row)"
          >
            审批流程
          </el-button>
          <el-button
            type="primary"
            size="small"
            :icon="EditPen"
            @click="openSignDialog(row)"
          >
            填写并签名
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="920px"
      top="8px"
      class="probation-sign-dialog"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div v-if="currentTask" class="dialog-content">
        <div class="approval-summary">
          <ProbationApprovalRecords
            compact
            :show-history="false"
            :records="currentTask.signatureHistory || currentTask.signatures"
            :current-version="currentTask.form_version"
            :review-stage="currentTask.review_stage"
            :status="currentTask.status"
          />
          <el-button
            type="primary"
            link
            :icon="List"
            @click="openFlowDialog(currentTask)"
          >
            查看历史审批记录
          </el-button>
        </div>

        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="同意时请填写审批意见；驳回时必须在当前意见栏写明驳回理由"
        />

        <el-alert
          v-if="currentTask.is_legacy_application"
          type="warning"
          :closable="false"
          show-icon
          title="该记录来自旧上传流程，需要先驳回，再由员工在线填写并签名"
        />

        <ProbationTemplateEditor
          :key="`${currentTask.id}-${currentTask.review_stage}-${currentTask.form_version}`"
          v-model:opinion="opinion"
          v-model:signature-data-url="signatureDataUrl"
          v-model:signature-type="signatureType"
          :mode="currentTask.review_stage"
          :applicant-name="currentTask.employee_name"
          :department="currentTask.employee_department || ''"
          :position="currentTask.employee_position || ''"
          :hire-date="currentTask.hire_date || ''"
          :conversion-type="currentTask.conversion_type"
          :conversion-type-other="currentTask.conversion_type_other || ''"
          :self-statement="currentTask.self_statement || ''"
          :signatures="currentTask.signatures"
          @ready="templateReady = $event"
        />
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button
          type="danger"
          :icon="Close"
          :loading="submitting"
          :disabled="!templateReady"
          @click="submitReview('reject')"
        >
          驳回并签名
        </el-button>
        <el-button
          type="success"
          :icon="Check"
          :loading="submitting"
          :disabled="!canSubmit || currentTask?.is_legacy_application"
          @click="submitReview('approve')"
        >
          同意并签名
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="flowVisible"
      title="转正审批流程与历史记录"
      width="1080px"
      top="5vh"
      class="probation-flow-dialog"
      destroy-on-close
    >
      <ProbationApprovalRecords
        v-if="flowTask"
        :records="flowTask.signatureHistory || flowTask.signatures"
        :current-version="flowTask.form_version"
        :review-stage="flowTask.review_stage"
        :status="flowTask.status"
      />
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Check, Close, EditPen, List } from "@element-plus/icons-vue";
import dayjs from "dayjs";
import { api } from "@/utils/api";
import { usePendingStore } from "@/stores/pending";
import ProbationApprovalRecords from "@/components/probation/ProbationApprovalRecords.vue";
import ProbationTemplateEditor from "@/components/probation/ProbationTemplateEditor.vue";
import type { PersonalSignatureType } from "@/utils/personalSignature";
import {
  findGeneralManagerApprovalTask,
  type ProbationApprovalRecord,
  type ProbationReviewStage,
} from "@/utils/probationApproval";

interface SignatureRecord extends ProbationApprovalRecord {
  signature_type?: "personal" | "general_manager";
  signature_image_url?: string;
}

interface SignatureTask {
  id: string;
  form_version: number;
  status: "submitted";
  employee_name: string;
  employee_department: string | null;
  employee_position: string | null;
  hire_date: string | null;
  submit_time: string | null;
  review_stage: Exclude<ProbationReviewStage, "employee" | "completed">;
  review_stage_label: string;
  conversion_type: "normal" | "early" | "extended" | "other";
  conversion_type_other: string | null;
  self_statement: string | null;
  is_legacy_application: boolean;
  signatures: SignatureRecord[];
  signatureHistory: SignatureRecord[];
}

withDefaults(
  defineProps<{
    showTitle?: boolean;
    hideWhenEmpty?: boolean;
  }>(),
  {
    showTitle: true,
    hideWhenEmpty: false,
  },
);

const emit = defineEmits<{
  (event: "updated"): void;
}>();

const pendingStore = usePendingStore();
const loading = ref(false);
const submitting = ref(false);
const tasks = ref<SignatureTask[]>([]);
const dialogVisible = ref(false);
const currentTask = ref<SignatureTask | null>(null);
const flowVisible = ref(false);
const flowTask = ref<SignatureTask | null>(null);
const opinion = ref("");
const signatureDataUrl = ref("");
const signatureType = ref<PersonalSignatureType>("personal");
const templateReady = ref(false);

const dialogTitle = computed(() => {
  if (!currentTask.value) return "转正申请签署";
  return `${currentTask.value.review_stage_label}：${currentTask.value.employee_name}`;
});

const canSubmit = computed(() =>
  Boolean(
    templateReady.value && opinion.value.trim() && signatureDataUrl.value,
  ),
);

function formatDate(value: string | null | undefined) {
  return value ? dayjs(value).format("YYYY-MM-DD") : "-";
}

function formatDateTime(value: string | null | undefined) {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-";
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

async function fetchTasks() {
  loading.value = true;
  try {
    const response = await api.get("/api/probation/signature-tasks");
    if (response.data.success) tasks.value = response.data.data || [];
  } catch (error: unknown) {
    ElMessage.error(requestErrorMessage(error, "获取转正签署待办失败"));
  } finally {
    loading.value = false;
  }
}

function openSignDialog(task: SignatureTask) {
  currentTask.value = task;
  opinion.value = "";
  signatureDataUrl.value = "";
  signatureType.value = "personal";
  templateReady.value = false;
  dialogVisible.value = true;
}

function openFlowDialog(task: SignatureTask) {
  flowTask.value = task;
  flowVisible.value = true;
}

async function submitReview(decision: "approve" | "reject") {
  if (!currentTask.value || !templateReady.value) return;
  const task = currentTask.value;
  const trimmedOpinion = opinion.value.trim();
  if (!trimmedOpinion) {
    ElMessage.warning(
      decision === "reject"
        ? "请先在申请单当前意见栏填写驳回理由"
        : "请先填写本环节审批意见",
    );
    return;
  }
  if (!signatureDataUrl.value) {
    ElMessage.warning("请先点击申请单当前环节的签名按钮");
    return;
  }
  const actionText = decision === "approve" ? "同意" : "驳回";
  const confirmationMessage =
    decision === "reject"
      ? `确认驳回${currentTask.value.employee_name}的转正申请？驳回理由：${trimmedOpinion}`
      : `确认同意${currentTask.value.employee_name}的转正申请并提交本次签名？`;
  try {
    await ElMessageBox.confirm(confirmationMessage, `${actionText}转正申请`, {
      confirmButtonText: `确认${actionText}`,
      cancelButtonText: "取消",
      type: decision === "approve" ? "success" : "warning",
    });
    submitting.value = true;
    const response = await api.post(`/api/probation/${task.id}/sign-review`, {
      decision,
      opinion: trimmedOpinion,
      signatureType: signatureType.value,
    });
    if (!response.data.success) {
      ElMessage.error(response.data.message || "签署失败");
      return;
    }
    await Promise.all([fetchTasks(), pendingStore.refreshPendingCounts()]);
    emit("updated");

    if (decision === "approve" && task.review_stage === "hr") {
      const finalApprovalTask = findGeneralManagerApprovalTask(
        tasks.value,
        task.id,
      );
      if (finalApprovalTask) {
        currentTask.value = finalApprovalTask;
        opinion.value = "";
        signatureDataUrl.value = "";
        signatureType.value = "general_manager";
        templateReady.value = false;
        ElMessage.success("人事部意见已签署，请继续完成总经理审批");
        return;
      }
    }

    ElMessage.success(response.data.message);
    dialogVisible.value = false;
  } catch (error: unknown) {
    if (error !== "cancel" && error !== "close") {
      ElMessage.error(requestErrorMessage(error, "签署失败"));
    }
  } finally {
    submitting.value = false;
  }
}

defineExpose({ refresh: fetchTasks });
onMounted(fetchTasks);
</script>

<style scoped>
.signature-tasks {
  width: 100%;
}

.signature-table {
  width: 100%;
  border: 1px solid #edf0f5;
  border-radius: 8px;
  overflow: hidden;
}

.signature-table :deep(.el-table__header-wrapper th.el-table__cell) {
  background: #f7f9fc;
  color: #44505f;
  font-weight: 700;
}

.signature-table :deep(.el-table__cell) {
  padding-top: 10px;
  padding-bottom: 10px;
}

.signature-table :deep(.cell) {
  padding-right: 6px;
  padding-left: 6px;
  line-height: 1.45;
  white-space: normal;
  word-break: break-word;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.section-header h3 {
  margin: 0;
  color: #303133;
  font-size: 17px;
  font-weight: 600;
}

.section-header p {
  margin: 5px 0 0;
  color: #909399;
  font-size: 13px;
}

.dialog-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.approval-summary {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

:deep(.probation-sign-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 16px);
  margin-top: 8px !important;
  margin-bottom: 8px;
}

:deep(.probation-sign-dialog .el-dialog__header) {
  flex: none;
  padding-bottom: 12px;
}

:deep(.probation-sign-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: 8px;
}

:deep(.probation-sign-dialog .el-dialog__footer) {
  flex: none;
  border-top: 1px solid #ebeef5;
  padding-top: 14px;
}

:deep(.probation-flow-dialog .el-dialog__body) {
  max-height: calc(90vh - 130px);
  overflow-y: auto;
}

@media (max-width: 760px) {
  :deep(.probation-sign-dialog),
  :deep(.probation-flow-dialog) {
    width: calc(100vw - 24px) !important;
  }
}
</style>
