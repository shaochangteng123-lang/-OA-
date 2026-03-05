<template>
  <div class="sidebar-footer">
    <!-- 搜索按钮 - 仅展开时显示 -->
    <button v-if="!collapsed" class="search-trigger" @click="$emit('open-search')">
      <el-icon :size="16"><Search /></el-icon>
      <span>搜索</span>
      <kbd class="kbd">⌘K</kbd>
    </button>

    <!-- 用户信息 -->
    <el-dropdown
      trigger="click"
      placement="top-start"
      :teleported="false"
      @command="handleCommand"
    >
      <div :class="['user-trigger', { 'is-collapsed': collapsed }]">
        <!-- 折叠状态：仅头像 -->
        <el-tooltip
          v-if="collapsed"
          :content="user?.name || '用户'"
          placement="right"
          :show-after="200"
          :offset="12"
        >
          <el-avatar :src="user?.avatarUrl || undefined" :size="40">
            {{ user?.name?.charAt(0) }}
          </el-avatar>
        </el-tooltip>

        <!-- 展开状态：完整信息 -->
        <template v-else>
          <el-avatar :src="user?.avatarUrl || undefined" :size="36">
            {{ user?.name?.charAt(0) }}
          </el-avatar>

          <div class="user-info">
            <div class="user-name">{{ user?.name }}</div>
            <div class="user-role">{{ getRoleLabel(user?.role) }}</div>
          </div>

          <el-icon class="chevron-icon" :size="16">
            <ArrowUp />
          </el-icon>
        </template>
      </div>

      <template #dropdown>
        <el-dropdown-menu class="user-menu">
          <!-- 用户信息 -->
          <div class="user-menu-header">
            <el-avatar :src="user?.avatarUrl || undefined" :size="40">
              {{ user?.name?.charAt(0) }}
            </el-avatar>
            <div class="user-menu-info">
              <div class="user-menu-name">{{ user?.name }}</div>
              <div class="user-menu-email">{{ user?.email }}</div>
            </div>
          </div>

          <el-divider style="margin: 8px 0" />

          <!-- 菜单项 -->
          <el-dropdown-item command="settings">
            <el-icon><Setting /></el-icon>
            <span>设置</span>
          </el-dropdown-item>

          <el-dropdown-item command="theme">
            <el-icon><Sunny /></el-icon>
            <span>外观</span>
          </el-dropdown-item>

          <el-divider style="margin: 8px 0" />

          <el-dropdown-item command="logout">
            <el-icon><SwitchButton /></el-icon>
            <span>退出登录</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
import { ArrowUp, Setting, Sunny, SwitchButton, Search } from '@element-plus/icons-vue'
import type { User } from '@/types'

defineProps<{
  user: User | null
  collapsed: boolean
}>()

const emit = defineEmits<{
  logout: []
  settings: []
  'toggle-theme': []
  'open-search': []
}>()

function getRoleLabel(role?: string): string {
  const labels: Record<string, string> = {
    super_admin: '超级管理员',
    admin: '管理员',
    user: '成员',
    guest: '访客',
  }
  return labels[role || 'guest'] || '未知'
}

function handleCommand(command: string) {
  switch (command) {
    case 'logout':
      emit('logout')
      break
    case 'settings':
      emit('settings')
      break
    case 'theme':
      emit('toggle-theme')
      break
  }
}
</script>

<style scoped>
.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--sidebar-border);
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 搜索按钮 */
.search-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--sidebar-border);
  background: transparent;
  color: var(--sidebar-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.23, 1, 0.32, 1);
  width: 100%;
}

.search-trigger:hover {
  background: var(--sidebar-item-hover);
  border-color: var(--sidebar-text-tertiary);
  color: var(--sidebar-text);
}

.search-trigger span {
  flex: 1;
  text-align: left;
}

.kbd {
  font-size: 10px;
  font-weight: 600;
  color: var(--sidebar-text-tertiary);
  background: var(--sidebar-bg-hover);
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  font-family: ui-monospace, 'SF Mono', Monaco, monospace;
  border: 1px solid var(--sidebar-border);
}

/* 用户触发器 */
.user-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.23, 1, 0.32, 1);
  background: transparent;
}

.user-trigger:hover {
  background: var(--sidebar-item-hover);
}

.user-trigger.is-collapsed {
  justify-content: center;
  padding: 6px;
}

.user-trigger.is-collapsed:hover {
  transform: scale(1.05);
}

.user-info {
  flex: 1;
  min-width: 0;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--sidebar-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 2px;
}

.user-role {
  font-size: 11px;
  font-weight: 500;
  color: var(--sidebar-text-tertiary);
}

.chevron-icon {
  color: var(--sidebar-text-tertiary);
  flex-shrink: 0;
}

/* 下拉菜单 */
.user-menu {
  min-width: 240px;
  padding: 8px;
}

.user-menu-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
}

.user-menu-info {
  flex: 1;
  min-width: 0;
}

.user-menu-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 2px;
}

.user-menu-email {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.el-dropdown-menu__item) {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
}

:deep(.el-dropdown-menu__item:hover) {
  background: var(--sidebar-item-hover);
}
</style>
