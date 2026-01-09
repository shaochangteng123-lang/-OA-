<template>
  <div class="sidebar-group">
    <div class="group-header">
      <!-- 横线始终显示，宽度随侧边栏变化 -->
      <div class="group-divider-line" :class="{ collapsed: sidebarCollapsed }"></div>

      <!-- 标题文字叠加在横线上方 -->
      <transition name="title-fade">
        <div v-if="!titleCollapsed && title" key="title" class="group-title">{{ title }}</div>
      </transition>
    </div>
    <div class="group-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  titleCollapsed: boolean // 控制标题显示
  sidebarCollapsed: boolean // 控制横线宽度
}>()
</script>

<style scoped>
.sidebar-group {
  margin-bottom: 16px;
}

.group-header {
  position: relative;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

/* 横线 - 始终可见，宽度跟随侧边栏变化 */
.group-divider-line {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  height: 1px;
  background: #e5e7eb;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}

/* 折叠状态：32px 短横线 */
.group-divider-line.collapsed {
  width: 32px;
}

/* 展开状态：计算宽度（侧边栏220px - 左右padding 32px = 188px） */
.group-divider-line:not(.collapsed) {
  width: 188px;
}

/* 标题文字 - 叠加在横线上方 */
.group-title {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  padding: 8px 16px 6px;
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  line-height: 14px;
  background: #ffffff;
  z-index: 1;
}

/* 标题淡入：展开完成后延迟显示，带字间距动画 */
.title-fade-enter-active {
  transition: opacity 0.3s ease 0.4s,
    letter-spacing 0.3s ease 0.4s,
    transform 0.3s ease 0.4s;
}

/* 标题淡出：开始折叠时立即消失 */
.title-fade-leave-active {
  transition: opacity 0.1s ease,
    letter-spacing 0.1s ease;
}

.title-fade-enter-from {
  opacity: 0;
  letter-spacing: 1px;
  transform: translateX(-5px);
}

.title-fade-leave-to {
  opacity: 0;
  letter-spacing: 1px;
}

.group-content {
  display: flex;
  flex-direction: column;
}
</style>
