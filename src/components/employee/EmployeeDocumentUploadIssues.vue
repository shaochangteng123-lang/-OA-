<template>
  <div
    v-if="issues.length > 0"
    class="employee-document-upload-issues"
    aria-live="assertive"
  >
    <ElAlert
      v-for="issue in issues"
      :key="issue.id"
      :title="issue.message"
      :type="issue.type"
      :closable="true"
      show-icon
      @close="emit('dismiss', issue.id)"
    />
  </div>
</template>

<script setup lang="ts">
import { ElAlert } from "element-plus";
import type { EmployeeDocumentUploadIssue } from "@/utils/employeeDocumentUploadIssues";

defineProps<{
  issues: EmployeeDocumentUploadIssue[];
}>();

const emit = defineEmits<{
  dismiss: [issueId: string];
}>();
</script>

<style scoped>
.employee-document-upload-issues {
  display: grid;
  gap: 8px;
  max-height: 240px;
  margin-bottom: 16px;
  overflow-y: auto;
}

.employee-document-upload-issues :deep(.el-alert) {
  padding-right: 48px;
}

.employee-document-upload-issues :deep(.el-alert__content) {
  flex: 1;
  min-width: 0;
}

.employee-document-upload-issues :deep(.el-alert__title) {
  overflow-wrap: anywhere;
  word-break: break-word;
}
</style>
