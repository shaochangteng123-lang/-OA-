<template>
  <aside class="side-panel" :class="{ 'is-collapsed': collapsed }">
    <!-- 面板头部 -->
    <div class="panel-header">
      <el-button
        link
        :icon="collapsed ? Expand : Fold"
        class="collapse-btn"
        @click="$emit('toggle')"
      />
      <div v-if="!collapsed" class="panel-title">
        <el-icon><DocumentCopy /></el-icon>
        <span>快速工具</span>
      </div>
    </div>

    <!-- 面板内容 -->
    <div v-if="!collapsed" class="panel-content">
      <!-- 剪切板 -->
      <div class="tool-section">
        <div class="section-title">
          <el-icon><DocumentCopy /></el-icon>
          <span>剪切板</span>
        </div>
        <div class="clipboard-area">
          <el-input
            :model-value="clipboardText"
            type="textarea"
            :rows="4"
            placeholder="从系统剪切板粘贴内容..."
            readonly
          />
          <el-button
            type="primary"
            size="small"
            :icon="DocumentCopy"
            class="paste-btn"
            @click="handlePaste"
          >
            粘贴到当前段落
          </el-button>
        </div>
      </div>

      <el-divider />

      <!-- 最近日志 -->
      <div class="tool-section">
        <div class="section-title">
          <el-icon><Clock /></el-icon>
          <span>最近日志</span>
        </div>
        <el-scrollbar class="recent-logs">
          <div
            v-for="log in recentLogs"
            :key="log.id"
            class="log-item"
            @click="$emit('logClick', log)"
          >
            <div class="log-date">{{ formatDate(log.date) }}</div>
            <div class="log-title">{{ log.title }}</div>
          </div>

          <el-empty v-if="recentLogs.length === 0" description="暂无历史日志" :image-size="60" />
        </el-scrollbar>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Expand, Fold, DocumentCopy, Clock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { WorkLog } from '@/types'

interface Props {
  collapsed: boolean
  clipboardText: string
  recentLogs: WorkLog[]
}

defineProps<Props>()

const emit = defineEmits<{
  toggle: []
  paste: []
  logClick: [log: WorkLog]
}>()

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const weekday = weekdays[date.getDay()]
  return `${month}月${day}日 周${weekday}`
}

async function handlePaste() {
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      emit('paste')
    } else {
      ElMessage.warning('剪切板为空')
    }
  } catch {
    ElMessage.error('无法读取剪切板，请确保使用 HTTPS 或 localhost')
  }
}
</script>

<style scoped>
.side-panel {
  width: 280px;
  background: white;
  border-left: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.side-panel.is-collapsed {
  width: 60px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #e4e7ed;
  background: linear-gradient(135deg, #f5f7fa 0%, #fafcff 100%);
}

.side-panel.is-collapsed .panel-header {
  justify-content: center;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
}

.panel-title .el-icon {
  font-size: 18px;
  color: #409eff;
}

.collapse-btn {
  padding: 8px;
  color: #909399;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.tool-section {
  margin-bottom: 16px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 12px;
}

.section-title .el-icon {
  font-size: 16px;
  color: #409eff;
}

.clipboard-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.paste-btn {
  width: 100%;
}

.recent-logs {
  max-height: 400px;
}

.log-item {
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
  cursor: pointer;
  transition: all 0.3s ease;
  background: white;
}

.log-item:hover {
  border-color: #409eff;
  background: #ecf5ff;
  transform: translateX(-4px);
}

.log-date {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}

.log-title {
  font-size: 14px;
  color: #303133;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1024px) {
  .side-panel {
    width: 240px;
  }

  .side-panel.is-collapsed {
    width: 0;
    border-left: none;
  }
}
</style>
