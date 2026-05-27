<template>
  <div
    v-if="aiCompletionState.visible"
    class="ai-completion-popup"
    :style="popupStyle"
    @mousedown.prevent
  >
    <div v-if="aiCompletionState.loading" class="ai-completion-loading">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>AI 生成中...</span>
    </div>
    <template v-else>
      <div class="ai-completion-header">
        <span class="ai-completion-label">AI 建议</span>
        <span class="ai-completion-hint">↑↓ 选择 · Enter 插入 · Esc 关闭</span>
      </div>
      <div class="ai-completion-list">
        <div
          v-for="(item, index) in aiCompletionState.suggestions"
          :key="index"
          class="ai-completion-item"
          :class="{ active: index === aiCompletionState.selectedIndex }"
          @click="handleSelect(index)"
          @mouseenter="aiCompletionState.selectedIndex = index"
        >
          {{ item }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { aiCompletionState, insertCompletion } from '@/extensions/AiCompletion'

const popupStyle = computed(() => {
  const { position } = aiCompletionState
  return {
    position: 'absolute' as const,
    top: `${position.top}px`,
    left: `${position.left}px`,
    zIndex: 9999,
  }
})

function handleSelect(index: number) {
  const suggestion = aiCompletionState.suggestions[index]
  if (suggestion) insertCompletion(suggestion)
}
</script>

<style scoped>
.ai-completion-popup {
  min-width: 320px;
  max-width: 560px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  font-size: 13px;
}

.ai-completion-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  color: #909399;
}

.ai-completion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
}

.ai-completion-label {
  font-weight: 500;
  color: #409eff;
  font-size: 12px;
}

.ai-completion-hint {
  font-size: 11px;
  color: #c0c4cc;
}

.ai-completion-list {
  max-height: 240px;
  overflow-y: auto;
}

.ai-completion-item {
  padding: 10px 14px;
  cursor: pointer;
  line-height: 1.5;
  color: #303133;
  border-bottom: 1px solid #f8f8f8;
  transition: background 0.1s;
}

.ai-completion-item:last-child {
  border-bottom: none;
}

.ai-completion-item:hover,
.ai-completion-item.active {
  background: #ecf5ff;
}
</style>
