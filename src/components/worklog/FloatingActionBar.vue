<template>
  <div class="floating-action-bar">
    <div class="action-bar-content">
      <!-- 保存状态 -->
      <div class="save-status">
        <span v-if="isSaving" class="status-text saving">
          <el-icon class="is-loading"><Loading /></el-icon>
          保存中...
        </span>
        <span v-else-if="hasUnsavedChanges" class="status-text unsaved"> 未保存 </span>
        <span v-else-if="lastSaved" class="status-text saved">
          <el-icon><CircleCheck /></el-icon>
          已保存 {{ formatLastSaved(lastSaved) }}
        </span>
      </div>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <el-button @click="handleClearClick">清空</el-button>
        <el-button type="primary" :loading="isSaving" @click="$emit('save')"> 保存 </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ElMessageBox } from 'element-plus'
import { Loading, CircleCheck } from '@element-plus/icons-vue'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

interface Props {
  hasUnsavedChanges: boolean
  lastSaved: string | null
  isSaving: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  clear: []
  save: []
}>()

// 格式化最后保存时间
function formatLastSaved(timestamp: string): string {
  try {
    return formatDistanceToNow(new Date(timestamp), {
      addSuffix: true,
      locale: zhCN,
    })
  } catch {
    return ''
  }
}

// 处理清空点击
async function handleClearClick() {
  try {
    await ElMessageBox.confirm('确定要清空当前内容吗？此操作不可恢复。', '确认清空', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
      lockScroll: true,
    })
    emit('clear')
  } catch {
    // 用户取消
  }
}
</script>

<style scoped>
.floating-action-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  animation: slideUp 0.3s ease;
  will-change: opacity;
}

@keyframes slideUp {
  from {
    bottom: -100px;
    opacity: 0;
  }
  to {
    bottom: 24px;
    opacity: 1;
  }
}

.action-bar-content {
  background: var(--yl-bg-container);
  border: 1px solid var(--yl-border-light);
  border-radius: var(--yl-radius-lg);
  box-shadow: var(--yl-shadow-heavy);
  padding: var(--yl-padding-md) var(--yl-padding-lg);
  display: flex;
  align-items: center;
  gap: var(--yl-gap-lg);
}

.save-status {
  font-size: var(--yl-font-size-small);
}

.status-text {
  display: inline-flex;
  align-items: center;
  gap: var(--yl-gap-xs);
}

.status-text.saving {
  color: var(--yl-primary);
}

.status-text.unsaved {
  color: var(--yl-warning);
}

.status-text.saved {
  color: var(--yl-success);
}

.action-buttons {
  display: flex;
  gap: var(--yl-gap-sm);
}
</style>
