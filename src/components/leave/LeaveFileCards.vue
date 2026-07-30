<template>
  <div v-if="items.length > 0" class="leave-file-cards">
    <div v-for="item in items" :key="item.key" class="file-card">
      <span class="file-icon" aria-hidden="true">
        <el-icon><Document /></el-icon>
      </span>

      <div class="file-info">
        <div class="file-name" :title="item.name">{{ item.name }}</div>
        <div
          v-if="item.size !== null && item.size !== undefined"
          class="file-size"
        >
          {{ formatFileSize(item.size) }}
        </div>
      </div>

      <div class="file-actions">
        <a
          v-if="item.previewUrl"
          :href="item.previewUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="file-action"
        >
          <el-icon><View /></el-icon>
          <span>预览</span>
        </a>
        <el-button
          v-else-if="item.previewFile"
          link
          type="primary"
          :icon="View"
          @click="previewLocalFile(item.previewFile)"
        >
          预览
        </el-button>

        <a
          v-if="item.downloadUrl"
          :href="item.downloadUrl"
          :download="item.name"
          class="file-action"
        >
          <el-icon><Download /></el-icon>
          <span>下载</span>
        </a>

        <el-tooltip v-if="item.removable" content="移除文件" placement="top">
          <el-button
            link
            type="danger"
            :icon="Delete"
            :aria-label="`移除文件：${item.name}`"
            @click="emit('remove', item.key)"
          />
        </el-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { Delete, Document, Download, View } from "@element-plus/icons-vue";

interface FileCardItem {
  key: string | number;
  name: string;
  size?: number | null;
  previewFile?: Blob;
  previewUrl?: string;
  downloadUrl?: string;
  removable?: boolean;
}

defineProps<{
  items: FileCardItem[];
}>();

const emit = defineEmits<{
  (e: "remove", key: string | number): void;
}>();

function previewLocalFile(file: Blob) {
  const url = URL.createObjectURL(file);
  const previewWindow = window.open(url, "_blank");
  if (!previewWindow) {
    URL.revokeObjectURL(url);
    ElMessage.warning("浏览器阻止了预览窗口，请允许此页面打开新窗口");
    return;
  }
  previewWindow.opener = null;
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<style scoped>
.leave-file-cards {
  display: grid;
  gap: 8px;
  width: 100%;
  margin-top: 8px;
}
.file-card {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  padding: 10px;
  box-sizing: border-box;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
}
.file-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 4px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 18px;
}
.file-info {
  min-width: 0;
}
.file-name {
  color: #303133;
  font-size: 13px;
  line-height: 20px;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.file-size {
  margin-top: 2px;
  color: #909399;
  font-size: 11px;
  line-height: 16px;
}
.file-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.file-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #409eff;
  font-size: 13px;
  line-height: 24px;
  text-decoration: none;
}
.file-action:hover {
  color: #79bbff;
}

@media (max-width: 520px) {
  .file-card {
    grid-template-columns: 34px minmax(0, 1fr);
  }
  .file-actions {
    grid-column: 2;
    justify-content: flex-start;
  }
}
</style>
