<template>
  <div class="leave-pending-list">
    <div class="leave-toolbar">
      <div class="toolbar-heading">
        <span class="section-title">请假审批</span>
        <span class="section-subtitle">{{ toolbarSubtitle }}</span>
      </div>
      <div class="toolbar-actions">
        <el-input
          v-if="activeTab === 'pending'"
          v-model="pendingKeyword"
          class="keyword-input"
          clearable
          :prefix-icon="Search"
          placeholder="搜索员工 / 部门 / 事由"
        />
        <el-tooltip content="刷新" placement="top">
          <el-button
            size="small"
            circle
            :loading="currentLoading"
            @click="refreshCurrent"
          >
            <el-icon><Refresh /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <div class="leave-metrics">
      <div class="metric-item">
        <span>待审批</span>
        <strong>{{ list.length }}</strong>
      </div>
      <div class="metric-item">
        <span>涉及部门</span>
        <strong>{{ pendingDepartmentCount }}</strong>
      </div>
      <div class="metric-item">
        <span>超过 1 天</span>
        <strong>{{ overduePendingCount }}</strong>
      </div>
    </div>

    <el-tabs
      v-model="activeTab"
      class="approval-tabs"
      @tab-change="handleTabChange"
    >
      <el-tab-pane name="pending">
        <template #label>
          <span class="tab-label">
            待我审批
            <em v-if="list.length > 0">{{ list.length }}</em>
          </span>
        </template>
        <el-table
          v-loading="loading"
          :data="filteredPendingList"
          stripe
          size="small"
          table-layout="fixed"
          class="approval-table"
          empty-text="暂无待审批申请"
        >
          <el-table-column
            type="index"
            label="序号"
            width="52"
            align="center"
          />
          <el-table-column label="申请人" min-width="118" align="center">
            <template #default="{ row }">
              <div class="person-cell">
                <el-avatar :size="30">
                  <el-icon><User /></el-icon>
                </el-avatar>
                <span>
                  <strong>{{ row.applicant_name }}</strong>
                  <small>{{
                    row.applicant_department || row.user_department || "-"
                  }}</small>
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            label="假期类型"
            prop="leave_type_name"
            width="82"
            align="center"
          >
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{
                row.leave_type_name
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时间段" min-width="168" align="center">
            <template #default="{ row }">
              <span class="period-cell">{{ formatLeavePeriod(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="天数"
            prop="total_days"
            width="60"
            align="center"
          >
            <template #default="{ row }">
              <span class="days-pill">{{ row.total_days }}天</span>
            </template>
          </el-table-column>
          <el-table-column label="已等候" width="68" align="center">
            <template #default="{ row }">
              <span
                :class="['waiting-days', { urgent: isOverduePending(row) }]"
              >
                {{ pendingAgeLabel(row.submitted_at) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="请假事由" prop="reason" min-width="112">
            <template #default="{ row }">
              <span class="wrapped-text">{{ row.reason || "-" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="116" align="center">
            <template #default="{ row }">{{
              formatBeijingDateTime(row.submitted_at)
            }}</template>
          </el-table-column>
          <el-table-column label="操作" width="188" align="center">
            <template #default="{ row }">
              <div class="approval-actions">
                <el-button
                  size="small"
                  type="success"
                  plain
                  :icon="Check"
                  @click="handleApprove(row)"
                >
                  通过
                </el-button>
                <el-button
                  size="small"
                  type="danger"
                  plain
                  :icon="Close"
                  @click="handleReject(row)"
                >
                  驳回
                </el-button>
                <el-button
                  link
                  size="small"
                  type="primary"
                  :icon="View"
                  @click="handleView(row)"
                  >详情</el-button
                >
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <div class="table-empty">
              <el-empty description="暂无待审批申请" :image-size="72" />
            </div>
          </template>
        </el-table>
      </el-tab-pane>

      <el-tab-pane name="history">
        <template #label>
          <span class="tab-label">审批记录</span>
        </template>
        <el-table
          v-loading="historyLoading"
          :data="historyList"
          stripe
          size="small"
          table-layout="fixed"
          class="approval-table"
          empty-text="暂无审批记录"
        >
          <el-table-column
            type="index"
            label="序号"
            width="52"
            align="center"
            :index="historyRowIndex"
          />
          <el-table-column label="申请人" min-width="110" align="center">
            <template #default="{ row }">
              <div class="person-cell">
                <el-avatar :size="30">
                  <el-icon><User /></el-icon>
                </el-avatar>
                <span>
                  <strong>{{ row.applicant_name }}</strong>
                  <small>{{
                    row.applicant_department || row.user_department || "-"
                  }}</small>
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            label="假期类型"
            prop="leave_type_name"
            width="80"
            align="center"
          >
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{
                row.leave_type_name
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时间段" min-width="160" align="center">
            <template #default="{ row }">
              <span class="period-cell">{{ formatLeavePeriod(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="天数"
            prop="total_days"
            width="58"
            align="center"
          >
            <template #default="{ row }">
              <span class="days-pill">{{ row.total_days }}天</span>
            </template>
          </el-table-column>
          <el-table-column label="剩余天数" width="72" align="center">
            <template #default="{ row }">
              <span
                :class="[
                  'remaining-days',
                  `is-${row.leave_timing_status || 'not_applicable'}`,
                ]"
              >
                {{ remainingDaysLabel(row) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="返岗时间" width="100" align="center">
            <template #default="{ row }">{{ returnToWorkLabel(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="70" align="center">
            <template #default="{ row }">
              <el-tag
                :type="row.review_action === 'approve' ? 'success' : 'danger'"
                size="small"
              >
                {{ row.review_action === "approve" ? "已通过" : "已驳回" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="审批意见" min-width="104">
            <template #default="{ row }">
              <span class="wrapped-text">{{ row.review_comment || "-" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="审批时间" width="116" align="center">
            <template #default="{ row }">{{
              formatBeijingDateTime(row.reviewed_at)
            }}</template>
          </el-table-column>
          <el-table-column label="操作" width="68" align="center">
            <template #default="{ row }">
              <el-button
                link
                size="small"
                type="primary"
                :icon="View"
                @click="handleView(row)"
                >详情</el-button
              >
            </template>
          </el-table-column>
          <template #empty>
            <div class="table-empty">
              <el-empty description="暂无审批记录" :image-size="72" />
            </div>
          </template>
        </el-table>

        <div v-if="historyTotal > historyPageSize" class="history-pagination">
          <el-pagination
            v-model:current-page="historyPage"
            :page-size="historyPageSize"
            :total="historyTotal"
            small
            layout="prev, pager, next"
            @current-change="fetchHistory"
          />
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 驳回理由对话框 -->
    <el-dialog
      v-model="rejectDialogVisible"
      title="填写驳回理由"
      width="400px"
      :close-on-click-modal="false"
    >
      <el-input
        v-model="rejectReason"
        type="textarea"
        :rows="4"
        placeholder="请填写驳回理由（必填）..."
        maxlength="500"
        show-word-limit
        autofocus
      />
      <template #footer>
        <el-button @click="rejectDialogVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="actionLoading"
          :disabled="!rejectReason.trim()"
          @click="confirmReject"
        >
          确认驳回
        </el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      :title="
        detailRequest
          ? `${detailRequest.applicant_name} 的请假申请`
          : '请假申请详情'
      "
      size="min(560px, 92vw)"
    >
      <LeaveApprovalTimeline
        v-if="detailRequest"
        :request="detailRequest"
        :is-owner="false"
      />
      <el-skeleton v-else :rows="6" animated style="padding: 16px" />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { ElMessage } from "element-plus";
import {
  Refresh,
  Check,
  Close,
  Search,
  User,
  View,
} from "@element-plus/icons-vue";
import { usePendingStore } from "@/stores/pending";
import LeaveApprovalTimeline from "./LeaveApprovalTimeline.vue";
import { formatBeijingDateTime } from "@/utils/date";
import {
  getPendingRequests,
  getReviewedRequests,
  approveRequest,
  rejectRequest,
  getRequestDetail,
  type LeaveRequest,
  type LeaveRequestDetail,
  type LeaveReviewHistoryItem,
} from "@/utils/leaveApi";

const emit = defineEmits<{
  (e: "approved"): void;
}>();

const pendingStore = usePendingStore();
const activeTab = ref("pending");
const list = ref<LeaveRequest[]>([]);
const pendingKeyword = ref("");
const loading = ref(false);
const historyList = ref<LeaveReviewHistoryItem[]>([]);
const historyLoading = ref(false);
const historyLoaded = ref(false);
const historyPage = ref(1);
const historyPageSize = 10;
const historyTotal = ref(0);
const actionLoading = ref(false);
const rejectDialogVisible = ref(false);
const rejectReason = ref("");
const currentRejectItem = ref<LeaveRequest | null>(null);
const drawerVisible = ref(false);
const detailRequest = ref<LeaveRequestDetail | null>(null);
const currentLoading = computed(() =>
  activeTab.value === "pending" ? loading.value : historyLoading.value,
);
const toolbarSubtitle = computed(() => {
  if (activeTab.value === "history") {
    return historyLoaded.value
      ? `共 ${historyTotal.value} 条记录`
      : "查看本人处理过的请假审批";
  }
  return list.value.length > 0
    ? `${list.value.length} 条待处理申请`
    : "当前没有待处理申请";
});
const filteredPendingList = computed(() => {
  const keyword = pendingKeyword.value.trim().toLowerCase();
  if (!keyword) return list.value;
  return list.value.filter((item) => {
    const fields = [
      item.request_no,
      item.applicant_name,
      item.applicant_department,
      item.leave_type_name,
      item.reason,
    ];
    return fields.some((field) =>
      (field || "").toLowerCase().includes(keyword),
    );
  });
});
const pendingDepartmentCount = computed(() => {
  const departments = list.value
    .map((item) => item.applicant_department)
    .filter((department): department is string => Boolean(department));
  return new Set(departments).size;
});
const overduePendingCount = computed(
  () => list.value.filter((item) => isOverduePending(item)).length,
);

async function fetchList() {
  loading.value = true;
  try {
    list.value = await getPendingRequests();
  } catch {
    // 静默处理
  } finally {
    loading.value = false;
  }
}

async function fetchHistory(page = historyPage.value) {
  historyPage.value = page;
  historyLoading.value = true;
  try {
    const result = await getReviewedRequests({
      page,
      pageSize: historyPageSize,
    });
    historyList.value = result.list;
    historyTotal.value = result.total;
    historyLoaded.value = true;
  } catch {
    ElMessage.error("获取审批记录失败");
  } finally {
    historyLoading.value = false;
  }
}

function handleTabChange(tabName: string | number) {
  if (tabName === "history" && !historyLoaded.value) fetchHistory(1);
}

function historyRowIndex(index: number) {
  return (historyPage.value - 1) * historyPageSize + index + 1;
}

function formatLeavePeriod(request: LeaveRequest): string {
  const startHalf = request.start_half === "morning" ? "上午" : "下午";
  const endHalf = request.end_half === "morning" ? "上午" : "下午";
  return `${request.start_date}${startHalf} ~ ${request.end_date}${endHalf}`;
}

function remainingDaysLabel(request: LeaveRequest): string {
  if (request.status !== "approved") return "-";
  if (request.leave_timing_status === "returned") return "已返岗";
  const days = Number(request.remaining_days);
  return Number.isFinite(days) ? `${days}天` : "-";
}

function returnToWorkLabel(request: LeaveRequest): string {
  if (request.status !== "approved" || !request.return_to_work_date) return "-";
  const half = request.return_to_work_half === "morning" ? "上午" : "下午";
  return `${request.return_to_work_date}${half}`;
}

function getSubmittedAgeDays(value: string | null | undefined): number {
  if (!value) return 0;
  const safeValue = value.includes("T") ? value : value.replace(" ", "T");
  const submittedAt = new Date(safeValue).getTime();
  if (Number.isNaN(submittedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - submittedAt) / 86400000));
}

function pendingAgeLabel(value: string | null | undefined): string {
  const days = getSubmittedAgeDays(value);
  if (days <= 0) return "今天";
  return `${days}天`;
}

function isOverduePending(request: LeaveRequest): boolean {
  return getSubmittedAgeDays(request.submitted_at) > 1;
}

function requestErrorMessage(error: unknown, fallback: string) {
  const requestError = error as {
    response?: { data?: { message?: string } };
  };
  return requestError.response?.data?.message || fallback;
}

async function refreshCurrent() {
  if (activeTab.value === "history") {
    await fetchHistory();
    return;
  }
  await fetchList();
}

async function handleApprove(item: LeaveRequest) {
  actionLoading.value = true;
  try {
    await approveRequest(item.id);
    ElMessage.success(`已批准 ${item.applicant_name} 的请假申请`);
    await fetchList();
    if (historyLoaded.value) await fetchHistory(1);
    await pendingStore.refreshPendingCounts();
    emit("approved");
  } catch (error: unknown) {
    ElMessage.error(requestErrorMessage(error, "操作失败"));
  } finally {
    actionLoading.value = false;
  }
}

function handleReject(item: LeaveRequest) {
  currentRejectItem.value = item;
  rejectReason.value = "";
  rejectDialogVisible.value = true;
}

async function confirmReject() {
  if (!currentRejectItem.value || !rejectReason.value.trim()) return;
  actionLoading.value = true;
  try {
    await rejectRequest(currentRejectItem.value.id, rejectReason.value.trim());
    ElMessage.success("已驳回申请");
    rejectDialogVisible.value = false;
    await fetchList();
    if (historyLoaded.value) await fetchHistory(1);
    await pendingStore.refreshPendingCounts();
    emit("approved");
  } catch (error: unknown) {
    ElMessage.error(requestErrorMessage(error, "操作失败"));
  } finally {
    actionLoading.value = false;
  }
}

async function handleView(item: LeaveRequest) {
  drawerVisible.value = true;
  detailRequest.value = null;
  try {
    detailRequest.value = await getRequestDetail(item.id);
  } catch {
    ElMessage.error("获取详情失败");
    drawerVisible.value = false;
  }
}

async function refreshAll() {
  await fetchList();
  if (historyLoaded.value) await fetchHistory();
}

onMounted(fetchList);
defineExpose({ refresh: refreshAll });
</script>

<style scoped>
.leave-pending-list {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 100px;
  overflow-x: hidden;
}

.leave-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.toolbar-heading {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.section-title {
  font-size: 16px;
  font-weight: 700;
  color: #1f2d3d;
}

.section-subtitle {
  color: #6b7785;
  font-size: 13px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.keyword-input {
  width: 260px;
}

.leave-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.metric-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 56px;
  padding: 10px 12px;
  border: 1px solid #edf0f5;
  border-radius: 8px;
  background: #fbfcfe;
}

.metric-item span {
  color: #6b7785;
  font-size: 13px;
  font-weight: 600;
}

.metric-item strong {
  color: #1f2d3d;
  font-size: 22px;
  line-height: 1;
}

.approval-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}

.approval-tabs {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.approval-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: #edf0f5;
}

.approval-tabs :deep(.el-tabs__item) {
  height: 38px;
  color: #6b7785;
  font-weight: 600;
}

.approval-tabs :deep(.el-tabs__item.is-active) {
  color: #2c5aa0;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.tab-label em {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #f56c6c;
  color: #ffffff;
  font-size: 12px;
  font-style: normal;
  line-height: 20px;
  text-align: center;
}

.approval-table {
  width: 100%;
  max-width: 100%;
  border: 1px solid #edf0f5;
  border-radius: 8px;
  overflow: hidden;
}

.approval-table :deep(.el-scrollbar__bar.is-horizontal) {
  display: none !important;
}

.approval-table :deep(.el-table__header-wrapper th.el-table__cell) {
  background: #f7f9fc;
  color: #44505f;
  font-weight: 700;
}

.approval-table :deep(.el-table__cell) {
  padding-top: 10px;
  padding-bottom: 10px;
}

.approval-table :deep(.cell) {
  padding-right: 6px;
  padding-left: 6px;
  line-height: 1.45;
}

.person-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
}

.person-cell span {
  display: grid;
  gap: 2px;
  min-width: 0;
  text-align: left;
}

.person-cell strong {
  color: #1f2d3d;
  font-size: 13px;
  font-weight: 700;
}

.person-cell small {
  color: #8a96a3;
  font-size: 12px;
}

.period-cell {
  color: #44505f;
  font-weight: 600;
  white-space: normal;
  word-break: break-word;
}

.wrapped-text {
  display: block;
  white-space: normal;
  word-break: break-word;
}

.approval-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  white-space: nowrap;
}

.approval-actions :deep(.el-button) {
  flex: none;
  margin-left: 0;
}

.approval-actions :deep(.el-button:not(.is-link)) {
  padding-right: 8px;
  padding-left: 8px;
}

.days-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 46px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: #eef5ff;
  color: #2c5aa0;
  font-size: 12px;
  font-weight: 700;
}

.waiting-days {
  color: #52a566;
  font-weight: 700;
}

.waiting-days.urgent {
  color: #d9944e;
}

.remaining-days {
  color: #409eff;
  font-weight: 600;
}
.remaining-days.is-on_leave {
  color: #e6a23c;
}
.remaining-days.is-returned {
  color: #67c23a;
}
.history-pagination {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}

.table-empty {
  padding: 22px 0;
}

@media (max-width: 760px) {
  .leave-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar-actions {
    width: 100%;
  }

  .keyword-input {
    width: 100%;
  }

  .leave-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
