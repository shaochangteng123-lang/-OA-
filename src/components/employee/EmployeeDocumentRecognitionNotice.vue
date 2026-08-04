<template>
  <div
    v-if="notice"
    class="employee-document-recognition-notice"
    aria-live="polite"
  >
    <ElAlert
      :type="notice.type"
      :closable="notice.closable"
      show-icon
      @close="dismissNotice"
    >
      <template #title>
        <span class="notice-text" :title="notice.message">
          {{ notice.message }}
        </span>
      </template>
    </ElAlert>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElAlert } from "element-plus";
import {
  useEmployeeDocumentRecognitionStore,
  type EmployeeDocumentRecognitionOutcomeType,
} from "@/stores/employeeDocumentRecognition";

const recognitionStore = useEmployeeDocumentRecognitionStore();

const notice = computed(() => {
  const currentTask = recognitionStore.currentTask;
  if (currentTask) {
    const waitingCount = Math.max(0, recognitionStore.pendingCount - 1);
    const queueText =
      waitingCount > 0 ? `，另有 ${waitingCount} 个文件等待` : "";
    const statusText =
      currentTask.status === "processing" ? "正在识别" : "等待识别";
    return {
      taskId: currentTask.id,
      type: "info" as const,
      closable: false,
      message: `${statusText}员工「${currentTask.employeeName}」的人事档案文件「${currentTask.fileName}」${queueText}；可关闭员工窗口并继续使用其他页面`,
    };
  }

  const result = recognitionStore.latestUndismissedResult;
  if (!result) return null;
  return {
    taskId: result.id,
    type: result.status as EmployeeDocumentRecognitionOutcomeType,
    closable: true,
    message: result.message,
  };
});

const dismissNotice = () => {
  const taskId = notice.value?.taskId;
  if (taskId) recognitionStore.dismissTaskResult(taskId);
};
</script>

<style scoped>
/* 页面上方正中悬浮，避免受左右两侧内容挤压 */
.employee-document-recognition-notice {
  position: absolute;
  top: 70px;
  left: 50%;
  z-index: 3000;
  width: min(760px, calc(100vw - 48px));
  transform: translateX(-50%);
}

.employee-document-recognition-notice :deep(.el-alert) {
  min-height: 44px;
  padding: 9px 44px 9px 14px;
  border: 1px solid transparent;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgb(15 23 42 / 18%);
}

.employee-document-recognition-notice :deep(.el-alert--info) {
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #60a5fa;
}

.employee-document-recognition-notice :deep(.el-alert--success) {
  color: #047857;
  background: #d1fae5;
  border-color: #34d399;
}

.employee-document-recognition-notice :deep(.el-alert--warning) {
  color: #a16207;
  background: #fef3c7;
  border-color: #fbbf24;
}

.employee-document-recognition-notice :deep(.el-alert--error) {
  color: #b91c1c;
  background: #fee2e2;
  border-color: #f87171;
}

.employee-document-recognition-notice :deep(.el-alert__content),
.employee-document-recognition-notice :deep(.el-alert__title) {
  min-width: 0;
  width: 100%;
}

.employee-document-recognition-notice :deep(.el-alert__title) {
  color: inherit;
  font-weight: 600;
}

.notice-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .employee-document-recognition-notice {
    top: 66px;
    width: calc(100vw - 32px);
  }
}
</style>
