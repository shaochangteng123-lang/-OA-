<template>
  <div class="sidebar-header">
    <!-- Logo区域 -->
    <div class="logo-wrapper">
      <div class="logo-container">
        <!-- Logo文本 -->
        <div class="logo-text-container">
          <transition name="logo-text-slide" mode="out-in">
            <!-- 展开状态：YuliLog -->
            <span v-if="!collapsed" key="expanded" class="logo-text-expanded">YuliLog</span>
            <!-- 折叠状态：Yuli -->
            <span v-else key="collapsed" class="logo-text-collapsed">Yuli</span>
          </transition>
        </div>
      </div>
    </div>

    <!-- 固定/取消固定按钮 - 淡入淡出 + 缩放 -->
    <transition name="pin-scale">
      <button
        v-if="!collapsed"
        class="pin-btn"
        :class="{ 'is-pinned': isPinned }"
        :title="isPinned ? '取消固定' : '固定侧边栏'"
        @click="$emit('toggle-collapse')"
      >
        <el-icon :size="16">
          <component :is="isPinned ? Lock : Unlock" />
        </el-icon>
      </button>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { Lock, Unlock } from '@element-plus/icons-vue'

defineProps<{
  collapsed: boolean
  isPinned?: boolean
}>()

defineEmits<{
  'toggle-collapse': []
}>()
</script>

<style scoped>
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 8px;
  height: 56px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
}

.logo-wrapper {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  overflow: hidden;
  perspective: 1000px;
}

.logo-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
}

/* Logo文本容器 */
.logo-text-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  min-width: 0;
  perspective: 600px;
}

/* 展开状态文本 - YuliLog */
.logo-text-expanded {
  font-size: 18px;
  font-weight: 700;
  color: #4f46e5;
  letter-spacing: -0.5px;
  white-space: nowrap;
  display: inline-block;
}

/* 折叠状态文本 - Yuli 居中 */
.logo-text-collapsed {
  font-size: 15px;
  font-weight: 700;
  color: #4f46e5;
  letter-spacing: -0.3px;
  white-space: nowrap;
  display: inline-block;
}

/* 文本优雅展开动画 */
.logo-text-slide-enter-active {
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.logo-text-slide-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 1, 1);
}

.logo-text-slide-enter-from {
  opacity: 0;
  transform: rotateX(-90deg) scale(0.9);
  transform-origin: center bottom;
  letter-spacing: 2px;
}

.logo-text-slide-leave-to {
  opacity: 0;
  transform: rotateX(90deg) scale(0.9);
  transform-origin: center top;
  letter-spacing: 2px;
}

/* Pin按钮动画 - 淡入淡出 + 上下翻转 */
.pin-scale-enter-active {
  transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.1s;
}

.pin-scale-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 1, 1);
}

.pin-scale-enter-from {
  opacity: 0;
  transform: rotateX(-60deg) scale(0.9);
}

.pin-scale-leave-to {
  opacity: 0;
  transform: rotateX(60deg) scale(0.9);
}

.pin-btn {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.pin-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

.pin-btn.is-pinned {
  background: #e0e7ff;
  color: #4f46e5;
}
</style>
