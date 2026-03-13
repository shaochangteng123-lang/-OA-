<template>
  <div class="sidebar-group">
    <div class="group-header" @click="handleHeaderClick">
      <!-- 横线始终显示，宽度随侧边栏变化 -->
      <div class="group-divider-line" :class="{ collapsed: sidebarCollapsed }"></div>

      <!-- 侧边栏折叠时：横线右侧显示小红点 -->
      <span v-if="sidebarCollapsed && hasBadge" class="group-badge-dot"></span>

      <!-- 标题文字叠加在横线上方 -->
      <transition name="title-fade">
        <div v-if="!titleCollapsed && title" key="title" class="group-title">
          <span class="title-text">{{ title }}</span>
          <div class="title-actions">
            <!-- 分组收起时：标题旁显示小红点 -->
            <span v-if="hasBadge && !isExpanded" class="group-title-badge-dot"></span>
            <!-- 折叠/展开图标 -->
            <el-icon class="collapse-icon" :class="{ rotated: !isExpanded }">
              <ArrowDown />
            </el-icon>
          </div>
        </div>
      </transition>
    </div>
    <transition name="expand">
      <div v-show="isExpanded" class="group-content">
        <slot />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ArrowDown } from '@element-plus/icons-vue'

const props = defineProps<{
  title?: string
  titleCollapsed: boolean // 控制标题显示
  sidebarCollapsed: boolean // 控制横线宽度
  groupKey: string // 用于标识不同的分组
  hasBadge?: boolean // 分组内是否有待办提示
}>()

defineEmits<{
  'update:expanded': [value: boolean]
  'update:locked': [value: boolean]
}>()

// 从父组件接收展开和锁定状态
const isExpanded = defineModel<boolean>('expanded', { default: false })
defineModel<boolean>('locked', { default: false })

// 点击标题切换展开/折叠
const handleHeaderClick = () => {
  // 只有在侧边栏展开且标题可见时才响应点击
  if (!props.titleCollapsed) {
    isExpanded.value = !isExpanded.value
  }
}
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
  cursor: pointer;
  user-select: none;
}

.group-header:hover .group-title {
  color: #374151;
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

/* 折叠状态下分组横线右侧的小红点 */
.group-badge-dot {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  background: #f56c6c;
  border-radius: 50%;
  z-index: 2;
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
  font-size: 14px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  line-height: 17px;
  background: #ffffff;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: color 0.2s ease;
}

.title-text {
  flex: 1;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
}

/* 折叠图标 */
.collapse-icon {
  font-size: 14px;
  transition: transform 0.3s ease;
  color: #6b7280;
}

.collapse-icon.rotated {
  transform: rotate(-90deg);
}

/* 分组标题旁的小红点（侧边栏展开、分组收起时） */
.group-title-badge-dot {
  width: 8px;
  height: 8px;
  background: #f56c6c;
  border-radius: 50%;
  flex-shrink: 0;
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

/* 内容区域 */
.group-content {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 展开/折叠动画 */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
  max-height: 1000px;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
