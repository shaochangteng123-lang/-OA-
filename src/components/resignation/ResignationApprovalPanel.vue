<template>
  <div class="resignation-approval-panel">
    <div class="toolbar">
      <el-segmented
        v-model="statusFilter"
        :options="statusOptions"
        @change="handleFilterChange"
      />
      <el-tooltip content="刷新列表" placement="top">
        <el-button
          :icon="Refresh"
          circle
          :loading="resignationStore.managementLoading"
          @click="refreshList"
        />
      </el-tooltip>
    </div>

    <el-table
      v-loading="resignationStore.managementLoading"
      :data="resignationStore.managementList"
      stripe
      empty-text="暂无离职审批记录"
    >
      <el-table-column type="index" label="序号" width="64" align="center" />
      <el-table-column
        prop="employee_name"
        label="员工姓名"
        min-width="100"
        align="center"
      />
      <el-table-column
        prop="employee_department"
        label="部门"
        min-width="120"
        align="center"
      >
        <template #default="{ row }">{{
          row.employee_department || "-"
        }}</template>
      </el-table-column>
      <el-table-column
        prop="employee_position"
        label="职位"
        min-width="120"
        align="center"
      >
        <template #default="{ row }">{{
          row.employee_position || "-"
        }}</template>
      </el-table-column>
      <el-table-column
        prop="handover_name"
        label="交接人"
        min-width="100"
        align="center"
      >
        <template #default="{ row }">{{ row.handover_name || "-" }}</template>
      </el-table-column>
      <el-table-column
        prop="resign_type"
        label="离职类型"
        min-width="100"
        align="center"
      >
        <template #default="{ row }">{{
          getResignationTypeText(row.resign_type)
        }}</template>
      </el-table-column>
      <el-table-column
        prop="resign_date"
        label="离职日期"
        min-width="110"
        align="center"
      />
      <el-table-column
        prop="status"
        label="状态"
        min-width="120"
        align="center"
      >
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)">{{
            getStatusText(row.status)
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column
        prop="submit_time"
        label="提交时间"
        min-width="160"
        align="center"
      >
        <template #default="{ row }">{{
          formatDateTime(row.submit_time)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="250" align="center" fixed="right">
        <template #default="{ row }">
          <div class="action-buttons">
            <el-button
              type="primary"
              link
              :icon="View"
              @click="openDetail(row.id)"
              >详情</el-button
            >
            <template v-if="canHandle(row)">
              <el-button
                type="success"
                link
                :icon="Check"
                @click="approveRequest(row)"
                >通过</el-button
              >
              <el-button
                type="danger"
                link
                :icon="Close"
                @click="openRejectDialog(row)"
                >驳回</el-button
              >
            </template>
            <el-tag
              v-else-if="isOwnPendingRequest(row)"
              type="info"
              size="small"
              >本人申请</el-tag
            >
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="detailVisible"
      title="离职审批详情"
      width="860px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div v-loading="resignationStore.detailLoading">
        <template v-if="detailRequest">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="员工姓名">{{
              detailRequest.employee_name || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="部门">{{
              detailRequest.employee_department || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="职位">{{
              detailRequest.employee_position || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="交接人">{{
              detailRequest.handover_name || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="离职类型">{{
              getResignationTypeText(detailRequest.resign_type)
            }}</el-descriptions-item>
            <el-descriptions-item label="离职日期">{{
              detailRequest.resign_date || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="当前状态">
              <el-tag :type="getStatusType(detailRequest.status)">{{
                getStatusText(detailRequest.status)
              }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="提交时间">{{
              formatDateTime(detailRequest.submit_time)
            }}</el-descriptions-item>
            <el-descriptions-item label="离职原因" :span="2">{{
              detailRequest.reason || "-"
            }}</el-descriptions-item>
            <el-descriptions-item
              v-if="detailRequest.approver_comment"
              label="审批意见"
              :span="2"
            >
              {{ detailRequest.approver_comment }}
            </el-descriptions-item>
          </el-descriptions>

          <section class="detail-section">
            <h3>离职材料</h3>
            <el-table
              :data="detailDocuments"
              border
              size="small"
              empty-text="暂无材料"
            >
              <el-table-column label="材料类型" min-width="180">
                <template #default="{ row }">{{
                  getDocumentLabel(row.document_type)
                }}</template>
              </el-table-column>
              <el-table-column
                prop="file_name"
                label="文件名"
                min-width="260"
                show-overflow-tooltip
              />
              <el-table-column label="上传人" min-width="120">
                <template #default="{ row }">{{
                  row.uploaded_by_name || getUploaderRoleText(row.uploader_role)
                }}</template>
              </el-table-column>
              <el-table-column label="上传时间" min-width="150" align="center">
                <template #default="{ row }">{{
                  formatDateTime(row.created_at)
                }}</template>
              </el-table-column>
              <el-table-column label="操作" width="90" align="center">
                <template #default="{ row }">
                  <el-button
                    type="primary"
                    link
                    :icon="View"
                    @click="openDocument(row.id)"
                    >查看</el-button
                  >
                </template>
              </el-table-column>
            </el-table>
          </section>

          <section class="detail-section">
            <h3>审批流程</h3>
            <el-timeline v-if="auditLogs.length > 0">
              <el-timeline-item
                v-for="log in auditLogs"
                :key="log.id"
                :timestamp="formatDateTime(log.created_at)"
                :type="getAuditType(log.action)"
                placement="top"
              >
                <div class="audit-title">{{ log.action }}</div>
                <div class="audit-meta">{{ log.operator_name || "-" }}</div>
                <div v-if="log.comment" class="audit-comment">
                  {{ log.comment }}
                </div>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else description="暂无审批记录" :image-size="64" />
          </section>
        </template>
      </div>

      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <template v-if="detailRequest && canHandle(detailRequest)">
          <el-button
            type="danger"
            :icon="Close"
            @click="openRejectDialog(detailRequest)"
            >驳回</el-button
          >
          <el-button
            type="success"
            :icon="Check"
            @click="approveRequest(detailRequest)"
            >审批通过</el-button
          >
        </template>
      </template>
    </el-dialog>

    <el-dialog
      v-model="rejectVisible"
      title="驳回离职申请"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form label-width="90px">
        <el-form-item label="驳回对象">
          <el-radio-group v-model="rejectForm.target">
            <el-radio value="employee">离职人</el-radio>
            <el-radio value="handover">交接人</el-radio>
            <el-radio value="both">双方</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="驳回原因" required>
          <el-input
            v-model="rejectForm.comment"
            type="textarea"
            :rows="4"
            maxlength="500"
            show-word-limit
            placeholder="请输入驳回原因"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="rejecting" @click="confirmReject"
          >确认驳回</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Check, Close, Refresh, View } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { usePendingStore } from "@/stores/pending";
import {
  useResignationStore,
  type ResignationDocumentType,
  type ResignationRequest,
} from "@/stores/resignation";

type ManagementRequest = ResignationRequest & {
  documents?: Array<{ id: string }>;
};
type AuditLog = {
  id: string;
  action: string;
  operator_name: string | null;
  comment: string | null;
  created_at: string;
};

const authStore = useAuthStore();
const pendingStore = usePendingStore();
const resignationStore = useResignationStore();

const statusFilter = ref("mutual_confirmed");
const statusOptions = [
  { label: "待审批", value: "mutual_confirmed" },
  { label: "已通过", value: "approved" },
  { label: "已驳回", value: "rejected" },
  { label: "全部", value: "" },
];

const detailVisible = ref(false);
const auditLogs = ref<AuditLog[]>([]);
const rejectVisible = ref(false);
const rejecting = ref(false);
const rejectRequestId = ref("");
const rejectForm = reactive({
  target: "employee" as "employee" | "handover" | "both",
  comment: "",
});

const detailRequest = computed(() => resignationStore.detail?.request || null);
const detailDocuments = computed(
  () => resignationStore.detail?.documents || [],
);
const hasFinalApprovalRole = computed(() => {
  return (
    authStore.user?.role === "general_manager" ||
    authStore.user?.role === "super_admin" ||
    authStore.user?.role === "chairman"
  );
});

function canHandle(request: ManagementRequest): boolean {
  return (
    hasFinalApprovalRole.value &&
    request.status === "mutual_confirmed" &&
    request.employee_user_id !== authStore.user?.id
  );
}

function isOwnPendingRequest(request: ManagementRequest): boolean {
  return (
    request.status === "mutual_confirmed" &&
    request.employee_user_id === authStore.user?.id
  );
}

function getResignationTypeText(type: string): string {
  const labels: Record<string, string> = {
    voluntary: "主动离职",
    contract_end: "合同到期",
    dismissal: "辞退",
  };
  return labels[type] || type;
}

function getStatusText(status: string): string {
  const labels: Record<string, string> = {
    mutual_confirmed: "待最终审批",
    approved: "已通过",
    rejected: "已驳回",
    handover_rejected: "待交接人重提",
  };
  return labels[status] || status;
}

function getStatusType(
  status: string,
): "success" | "warning" | "danger" | "info" {
  const types: Record<string, "success" | "warning" | "danger" | "info"> = {
    mutual_confirmed: "warning",
    approved: "success",
    rejected: "danger",
    handover_rejected: "danger",
  };
  return types[status] || "info";
}

function getDocumentLabel(type: ResignationDocumentType): string {
  const labels: Record<ResignationDocumentType, string> = {
    application_form: "离职申请表",
    handover_form_employee: "离职人交接单",
    handover_form_handover: "交接人交接单",
    termination_proof: "终止/解除劳动关系证明",
    asset_handover: "固定资产交接单",
    compensation_agreement: "离职经济补偿协议书",
    expense_settlement_agreement: "离职其他费用结算约定",
    termination_agreement: "终止 / 解除劳动关系协议书",
    employee_handover_form: "员工离职交接单",
    settlement_confirmation: "薪资及各类款项结算确认书",
    resignation_certificate: "离职证明",
  };
  return labels[type] || type;
}

function getUploaderRoleText(role: string): string {
  const labels: Record<string, string> = {
    employee: "离职人",
    handover: "交接人",
    admin: "管理员",
  };
  return labels[role] || role;
}

function getAuditType(
  action: string,
): "success" | "warning" | "danger" | "primary" | "info" {
  if (action.includes("通过")) return "success";
  if (action.includes("驳回")) return "danger";
  if (action.includes("确认")) return "warning";
  if (action.includes("提交")) return "primary";
  return "info";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

async function refreshList() {
  await resignationStore.fetchManagementList(statusFilter.value || undefined);
}

function handleFilterChange() {
  refreshList();
}

async function openDetail(id: string) {
  auditLogs.value = [];
  try {
    const [detailResult, auditResult] = await Promise.all([
      resignationStore.fetchDetail(id),
      resignationStore
        .fetchAuditLogs(id)
        .catch(() => ({ success: false, data: [] })),
    ]);
    if (!detailResult.success) {
      ElMessage.error(detailResult.message || "获取离职详情失败");
      return;
    }
    if (auditResult.success) auditLogs.value = auditResult.data || [];
    detailVisible.value = true;
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "获取离职详情失败");
  }
}

function openDocument(documentId: string) {
  if (!detailRequest.value) return;
  window.open(
    `/api/resignation/requests/${detailRequest.value.id}/documents/${documentId}/download`,
    "_blank",
  );
}

async function approveRequest(request: ManagementRequest) {
  if (!canHandle(request)) {
    ElMessage.error(
      isOwnPendingRequest(request)
        ? "不能审批自己的离职申请"
        : "无离职最终审批权限",
    );
    return;
  }
  try {
    const { value } = await ElMessageBox.prompt(
      `确认通过 ${request.employee_name || "该员工"} 的离职申请？`,
      "离职审批通过",
      {
        confirmButtonText: "确认通过",
        cancelButtonText: "取消",
        inputType: "textarea",
        inputPlaceholder: "审批意见（选填）",
        type: "warning",
      },
    );
    const result = await resignationStore.approve(request.id, value || "");
    if (!result.success) {
      ElMessage.error(result.message || "审批失败");
      return;
    }
    ElMessage.success("离职申请已通过");
    detailVisible.value = false;
    await Promise.all([refreshList(), pendingStore.refreshPendingCounts()]);
  } catch (error: any) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(error.response?.data?.message || "审批失败");
  }
}

function openRejectDialog(request: ManagementRequest) {
  if (!canHandle(request)) {
    ElMessage.error(
      isOwnPendingRequest(request)
        ? "不能审批自己的离职申请"
        : "无离职最终审批权限",
    );
    return;
  }
  rejectRequestId.value = request.id;
  rejectForm.target = "employee";
  rejectForm.comment = "";
  rejectVisible.value = true;
}

async function confirmReject() {
  if (!rejectForm.comment.trim()) {
    ElMessage.warning("请输入驳回原因");
    return;
  }
  rejecting.value = true;
  try {
    const result = await resignationStore.reject(
      rejectRequestId.value,
      rejectForm.comment.trim(),
      rejectForm.target,
    );
    if (!result.success) {
      ElMessage.error(result.message || "驳回失败");
      return;
    }
    ElMessage.success("离职申请已驳回");
    rejectVisible.value = false;
    detailVisible.value = false;
    await Promise.all([refreshList(), pendingStore.refreshPendingCounts()]);
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "驳回失败");
  } finally {
    rejecting.value = false;
  }
}

onMounted(() => {
  refreshList();
});
</script>

<style scoped>
.resignation-approval-panel {
  width: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.action-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 32px;
}

.detail-section {
  margin-top: 24px;
}

.detail-section h3 {
  margin: 0 0 12px;
  color: #303133;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}

.audit-title {
  color: #303133;
  font-weight: 600;
}

.audit-meta,
.audit-comment {
  margin-top: 4px;
  color: #606266;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .toolbar {
    align-items: flex-start;
  }

  .toolbar :deep(.el-segmented) {
    max-width: calc(100% - 48px);
    overflow-x: auto;
  }
}
</style>
