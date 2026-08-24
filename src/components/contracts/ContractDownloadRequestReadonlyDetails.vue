<template>
  <div class="download-request-readonly-details">
    <el-descriptions :column="2" border size="small">
      <el-descriptions-item label="申请人">
        {{ item.applicant.label }}
      </el-descriptions-item>
      <el-descriptions-item label="申请时间">
        {{ formatDateTime(item.createdAt) }}
      </el-descriptions-item>
      <el-descriptions-item label="下载用途" :span="2">
        {{ item.purpose }}
      </el-descriptions-item>
      <el-descriptions-item
        v-if="item.approver.comment"
        label="总经理审批意见"
        :span="2"
      >
        {{ item.approver.comment }}
      </el-descriptions-item>
      <el-descriptions-item
        v-if="showManagerDecisionTime && item.approver.decidedAt"
        label="总经理签字时间"
        :span="2"
      >
        {{ formatDateTime(item.approver.decidedAt) }}
      </el-descriptions-item>
      <el-descriptions-item
        v-if="item.executor.note"
        label="管理员处理说明"
        :span="2"
      >
        {{ item.executor.note }}
      </el-descriptions-item>
    </el-descriptions>

    <section class="requested-files">
      <div class="requested-files-heading">
        <strong>申请下载的附件（{{ item.files.length }}）</strong>
        <el-button
          type="primary"
          link
          @click="emit('previewApplication', item)"
        >
          查看签名申请单
        </el-button>
      </div>
      <div class="file-list">
        <div v-for="file in item.files" :key="file.id" class="file-row">
          <span>
            <b>{{ file.fileName }}</b>
            <small>{{ fileTypeLabel(file.fileType) }}</small>
          </span>
          <span class="file-actions">
            <el-button
              type="primary"
              link
              @click="emit('previewFile', item, file)"
            >
              在线预览
            </el-button>
            <el-button
              v-if="canDownloadFiles"
              type="primary"
              link
              @click="emit('downloadFile', item, file.id)"
            >
              {{ downloadLabel(file) }}
            </el-button>
          </span>
        </div>
      </div>
    </section>

    <section class="flow-section">
      <strong class="flow-title">当前审批状态</strong>
      <div class="flow-line">
        <template v-for="(node, index) in item.workflow" :key="node.key">
          <span
            :class="{
              completed: node.status === 'completed',
              current: node.status === 'current',
              rejected: node.status === 'rejected',
              withdrawn: node.status === 'withdrawn',
            }"
          >
            {{ node.label }}
          </span>
          <i v-if="index < item.workflow.length">→</i>
        </template>
        <span :class="{ completed: item.status === 'completed' }">
          申请完成
        </span>
      </div>
      <small>{{ nextStepText(item) }}</small>

      <div v-if="approvalHistory.length" class="approval-history">
        <strong>完整审批记录</strong>
        <div class="history-line">
          <template v-for="(entry, index) in approvalHistory" :key="entry.id">
            <article
              class="history-node"
              :class="historyActionClass(entry.action)"
            >
              <div class="history-node-title">
                <b>{{ historyActionLabel(entry) }}</b>
                <em>第 {{ entry.attemptNo }} 次</em>
              </div>
              <span>{{ entry.actorLabel }}</span>
              <time>{{ formatDateTime(entry.createdAt) }}</time>
              <small v-if="historyComment(entry)">
                {{ historyComment(entry) }}
              </small>
            </article>
            <i v-if="index < approvalHistory.length - 1">→</i>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  ContractDownloadHistoryAction,
  ContractDownloadHistoryEntry,
  ContractDownloadRequest,
  ContractDownloadRequestFile,
} from "@/types/contractDownload";

const props = withDefaults(
  defineProps<{
    item: ContractDownloadRequest;
    canDownloadFiles?: boolean;
    showManagerDecisionTime?: boolean;
    optimisticDownloadedKeys?: Set<string>;
  }>(),
  {
    canDownloadFiles: false,
    showManagerDecisionTime: false,
    optimisticDownloadedKeys: () => new Set<string>(),
  },
);

const emit = defineEmits<{
  previewApplication: [item: ContractDownloadRequest];
  previewFile: [
    item: ContractDownloadRequest,
    file: ContractDownloadRequestFile,
  ];
  downloadFile: [item: ContractDownloadRequest, fileId: string];
}>();

const approvalHistory = computed(() =>
  (props.item.chainHistory || []).filter(
    (entry) => entry.action !== "download_file",
  ),
);

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function fileTypeLabel(type: string) {
  return (
    {
      draft_contract: "草拟合同",
      sealed_contract: "盖章合同",
      seal_application: "用印申请单",
      triplicate: "三联单",
      payment_request: "请款单",
      termination: "终止协议",
      invoice: "发票",
      receipt: "回款回单",
      payment: "付款回单",
      other: "其他附件",
    }[type] || "合同附件"
  );
}

function downloadLabel(file: ContractDownloadRequestFile) {
  if (file.downloadedAt) return "重新下载";
  return props.optimisticDownloadedKeys.has(`${props.item.id}:${file.id}`)
    ? "等待服务端确认"
    : "下载指定文件";
}

function nextStepText(item: ContractDownloadRequest) {
  if (item.status === "rejected") return "总经理已驳回，可修改后重新提交";
  if (item.status === "withdrawn") return "申请已撤回，可修改后重新提交";
  if (item.status === "completed") return "流程已完成：管理员已执行下载任务";
  return item.nextStep ? `下一步：${item.nextStep}` : "等待下一环节处理";
}

function historyActionLabel(entry: ContractDownloadHistoryEntry) {
  if (entry.action === "resubmit" && entry.fromStatus === "withdrawn") {
    return "员工申请";
  }
  return {
    submit: "员工申请",
    reject: "总经理驳回",
    withdraw: "员工撤回",
    resubmit: "员工重新提交",
    approve: "总经理批准",
    complete: "管理员处理完成",
    download_file: "管理员下载附件",
  }[entry.action];
}

function historyActionClass(action: ContractDownloadHistoryAction) {
  if (action === "reject") return "rejected";
  if (action === "withdraw") return "withdrawn";
  if (action === "approve" || action === "complete") return "completed";
  return "submitted";
}

function historyComment(entry: ContractDownloadHistoryEntry) {
  if (!entry.comment) return "";
  if (entry.action === "submit" || entry.action === "resubmit") {
    return `下载用途：${entry.comment}`;
  }
  if (entry.action === "reject") return `驳回原因：${entry.comment}`;
  if (entry.action === "withdraw") return `撤回原因：${entry.comment}`;
  if (entry.action === "approve") return `审批意见：${entry.comment}`;
  if (entry.action === "complete") return `处理说明：${entry.comment}`;
  return entry.comment;
}
</script>

<style scoped>
.download-request-readonly-details {
  display: grid;
  gap: 16px;
  min-width: 0;
  padding: 16px;
  background: #fff;
}
.requested-files,
.flow-section {
  padding: 15px;
  border-radius: 10px;
  background: #f8fafb;
}
.requested-files-heading,
.file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.file-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.file-row {
  padding: 9px 0;
  border-top: 1px solid #e6ecef;
}
.file-row > span:first-child {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.file-row b {
  overflow-wrap: anywhere;
}
.file-row small,
.flow-section > small {
  color: #71808b;
  font-size: 13px;
}
.file-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
}
.flow-title {
  display: block;
  margin-bottom: 12px;
  color: #17364b;
}
.flow-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  overflow-x: auto;
  white-space: nowrap;
}
.flow-line span {
  padding: 7px 11px;
  border-radius: 16px;
  background: #e9eef1;
}
.flow-line span.completed {
  color: #087b72;
  background: #e2f5f2;
}
.flow-line span.current {
  color: #8a5b12;
  background: #fff3d8;
}
.flow-line span.rejected {
  color: #b42318;
  background: #fee9e7;
}
.flow-line span.withdrawn {
  color: #667680;
  background: #e9eef1;
}
.approval-history {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid #dfe8ed;
}
.approval-history > strong {
  color: #17364b;
}
.history-line {
  display: flex;
  align-items: stretch;
  gap: 10px;
  margin-top: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.history-line > i {
  align-self: center;
  color: #9aa8b1;
  font-style: normal;
}
.history-node {
  display: grid;
  flex: 0 0 190px;
  gap: 4px;
  padding: 11px 13px;
  border: 1px solid #dce7eb;
  border-radius: 10px;
  background: #fff;
}
.history-node b {
  color: #285366;
}
.history-node-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.history-node-title em {
  color: #87949c;
  font-size: 11px;
  font-style: normal;
}
.history-node span,
.history-node time,
.history-node small {
  color: #71808b;
  font-size: 12px;
  font-style: normal;
}
.history-node small {
  margin-top: 3px;
  padding-top: 6px;
  border-top: 1px dashed #dce5e9;
  color: #485b67;
  white-space: normal;
}
.history-node.submitted {
  border-color: #b9dcda;
  background: #f2faf9;
}
.history-node.submitted b {
  color: #087b72;
}
.history-node.rejected {
  border-color: #efc0bb;
  background: #fff5f4;
}
.history-node.rejected b {
  color: #b42318;
}
.history-node.withdrawn {
  border-color: #d6dde1;
  background: #f4f6f7;
}
.history-node.completed {
  border-color: #b9dfcc;
  background: #f1faf5;
}
.history-node.completed b {
  color: #237a4b;
}

@media (max-width: 760px) {
  .download-request-readonly-details {
    padding: 10px;
  }
  .file-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
