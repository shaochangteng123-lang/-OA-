<template>
  <div class="approval-records" :class="{ compact }">
    <div class="records-heading">
      <div>
        <h3>审批流程</h3>
        <p>
          {{
            records.length
              ? "员工提交后，依次完成主管领导、人事部和最终审批"
              : "展示历史表中仍可恢复的审批节点"
          }}
        </p>
      </div>
      <el-tag
        v-if="records.length && currentVersion > 0"
        type="info"
        effect="plain"
      >
        第 {{ currentVersion }} 版
      </el-tag>
    </div>

    <div v-if="records.length" class="approval-flow">
      <div
        v-for="stage in stages"
        :key="stage.key"
        class="approval-stage"
        :class="stage.state"
      >
        <div class="stage-marker">
          <el-icon v-if="stage.state === 'completed'">
            <CircleCheckFilled />
          </el-icon>
          <el-icon v-else-if="stage.state === 'rejected'">
            <CircleCloseFilled />
          </el-icon>
          <el-icon v-else-if="stage.state === 'current'"><Clock /></el-icon>
          <span v-else>{{ stage.order }}</span>
        </div>
        <div class="stage-detail">
          <strong>{{ stage.label }}</strong>
          <span>{{ stage.handler }}</span>
          <template v-if="stage.record">
            <small>
              {{ probationApprovalActorLabel(stage.record) }} ·
              {{ formatDateTime(stage.record.signed_at) }}
            </small>
            <p v-if="stage.record.opinion">
              {{
                stage.record.decision === "reject"
                  ? `驳回理由：${stage.record.opinion}`
                  : stage.record.opinion
              }}
            </p>
          </template>
          <small v-else-if="stage.state === 'current'"
            >等待当前审批人处理</small
          >
          <small v-else>尚未开始</small>
        </div>
      </div>
    </div>

    <div v-if="records.length && showHistory" class="history-block">
      <div class="history-heading">
        <h3>历史审批记录</h3>
        <span>共 {{ historyRows.length }} 条</span>
      </div>
      <el-table
        :data="historyRows"
        size="small"
        stripe
        empty-text="暂无历史审批记录"
      >
        <el-table-column label="版本" width="72" align="center">
          <template #default="{ row }">第 {{ row.form_version }} 版</template>
        </el-table-column>
        <el-table-column label="审批环节" min-width="120">
          <template #default="{ row }">{{ stageLabel(row.stage) }}</template>
        </el-table-column>
        <el-table-column label="结果" width="88" align="center">
          <template #default="{ row }">
            <el-tag
              :type="decisionTagType(row.decision)"
              size="small"
              effect="light"
            >
              {{ probationDecisionLabel(row.decision) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作人" min-width="100">
          <template #default="{ row }">{{
            probationApprovalActorLabel(row)
          }}</template>
        </el-table-column>
        <el-table-column label="审批意见 / 驳回理由" min-width="210">
          <template #default="{ row }">
            <span :class="{ 'reject-reason': row.decision === 'reject' }">
              {{ row.opinion || "-" }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="处理时间" width="150">
          <template #default="{ row }">
            {{ formatDateTime(row.signed_at) }}
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-else-if="fallbackRecords.length" class="legacy-block">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="该记录产生于完整审批快照启用前，仅展示历史表中可恢复的节点"
      />
      <el-table
        :data="fallbackRecords"
        size="small"
        stripe
        empty-text="暂无可恢复的审批记录"
      >
        <el-table-column label="处理节点" width="110">
          <template #default="{ row }">
            {{ archivedActionLabel(row.action) }}
          </template>
        </el-table-column>
        <el-table-column label="处理人" min-width="110">
          <template #default="{ row }">
            {{ probationApprovalTimelineActorLabel(row) }}
          </template>
        </el-table-column>
        <el-table-column label="意见 / 说明" min-width="220">
          <template #default="{ row }">{{ row.comment || "-" }}</template>
        </el-table-column>
        <el-table-column label="处理时间" width="150">
          <template #default="{ row }">
            {{ formatDateTime(row.action_time) }}
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  CircleCheckFilled,
  CircleCloseFilled,
  Clock,
} from "@element-plus/icons-vue";
import dayjs from "dayjs";
import {
  buildProbationApprovalStages,
  probationApprovalStageDefinitions,
  probationApprovalActorLabel,
  probationApprovalTimelineActorLabel,
  probationDecisionLabel,
  sortProbationApprovalHistory,
  type ProbationApprovalRecord,
  type ProbationReviewStage,
} from "@/utils/probationApproval";

interface ArchivedApprovalRecord {
  id: string;
  step?: number | null;
  action: string;
  comment: string | null;
  action_time: string;
  approver_name: string;
}

const props = withDefaults(
  defineProps<{
    records?: ProbationApprovalRecord[];
    fallbackRecords?: ArchivedApprovalRecord[];
    currentVersion: number;
    reviewStage: ProbationReviewStage;
    status: string;
    compact?: boolean;
    showHistory?: boolean;
  }>(),
  {
    records: () => [],
    fallbackRecords: () => [],
    compact: false,
    showHistory: true,
  },
);

const stages = computed(() =>
  buildProbationApprovalStages(
    props.records,
    props.currentVersion,
    props.reviewStage,
    props.status,
  ),
);
const historyRows = computed(() => sortProbationApprovalHistory(props.records));

function formatDateTime(value: string | null | undefined) {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-";
}

function stageLabel(stage: ProbationApprovalRecord["stage"]) {
  return (
    probationApprovalStageDefinitions.find((item) => item.key === stage)
      ?.label || stage
  );
}

function decisionTagType(decision: ProbationApprovalRecord["decision"]) {
  if (decision === "reject") return "danger";
  if (decision === "approve") return "success";
  return "primary";
}

function archivedActionLabel(action: string) {
  const labels: Record<string, string> = {
    submit: "提交申请",
    resubmit: "重新提交",
    approve: "审批通过",
    reject: "审批驳回",
    withdraw: "撤回申请",
  };
  return labels[action] || action;
}
</script>

<style scoped>
.approval-records {
  width: 100%;
}

.records-heading,
.history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.records-heading {
  margin-bottom: 14px;
}

.records-heading h3,
.history-heading h3 {
  margin: 0;
  color: #303133;
  font-size: 16px;
}

.records-heading p {
  margin: 4px 0 0;
  color: #909399;
  font-size: 12px;
}

.approval-flow {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid #dcdfe6;
  border-bottom: 1px solid #dcdfe6;
}

.approval-stage {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 9px;
  min-width: 0;
  padding: 14px 12px;
}

.approval-stage + .approval-stage {
  border-left: 1px solid #ebeef5;
}

.stage-marker {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 1px solid #c0c4cc;
  border-radius: 50%;
  color: #909399;
  font-size: 12px;
}

.completed .stage-marker {
  border-color: #67c23a;
  color: #67c23a;
}

.current .stage-marker {
  border-color: #409eff;
  color: #409eff;
}

.rejected .stage-marker {
  border-color: #f56c6c;
  color: #f56c6c;
}

.stage-detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.stage-detail strong {
  color: #303133;
  font-size: 13px;
}

.stage-detail > span {
  margin-top: 2px;
  color: #606266;
  font-size: 12px;
}

.stage-detail small {
  overflow: hidden;
  margin-top: 6px;
  color: #909399;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-detail p {
  display: -webkit-box;
  overflow: hidden;
  margin: 6px 0 0;
  color: #606266;
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.rejected .stage-detail p {
  color: #f56c6c;
}

.history-block {
  margin-top: 22px;
}

.legacy-block {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.history-heading {
  margin-bottom: 10px;
}

.history-heading span {
  color: #909399;
  font-size: 12px;
}

.reject-reason {
  color: #f56c6c;
}

.compact .records-heading {
  margin-bottom: 8px;
}

.compact .records-heading p {
  display: none;
}

.compact .approval-stage {
  padding: 9px 8px;
}

.compact .stage-detail p {
  display: none;
}

@media (max-width: 760px) {
  .approval-flow {
    grid-template-columns: 1fr 1fr;
  }

  .approval-stage:nth-child(3) {
    border-left: 0;
  }

  .approval-stage:nth-child(n + 3) {
    border-top: 1px solid #ebeef5;
  }
}
</style>
