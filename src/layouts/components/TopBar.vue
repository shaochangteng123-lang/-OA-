<template>
  <div class="top-bar" :class="{ 'sidebar-pinned': sidebarPinned }">
    <!-- 页面标题 -->
    <div class="page-title" v-if="title">
      <slot name="title">{{ title }}</slot>
    </div>

    <!-- 右侧用户信息 -->
    <div class="top-bar-right">
      <!-- 用户下拉菜单 -->
      <el-dropdown trigger="click" placement="bottom-end" @command="handleCommand">
        <div class="user-trigger">
          <el-avatar :src="user?.avatarUrl || undefined" :size="32">
            {{ user?.name?.charAt(0) }}
          </el-avatar>
          <div class="user-info">
            <div class="user-name">{{ user?.name }}</div>
            <div class="user-role">{{ getRoleLabel(user?.role) }}</div>
          </div>
          <el-icon class="chevron-icon" :size="14">
            <ArrowDown />
          </el-icon>
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
  </div>
</template>

<script setup lang="ts">
import { ArrowDown, Setting, Sunny, SwitchButton } from '@element-plus/icons-vue'
import type { User } from '@/types'

defineProps<{
  user: User | null
  sidebarCollapsed: boolean
  sidebarPinned?: boolean
  title?: string
}>()

const emit = defineEmits<{
  logout: []
  settings: []
  'toggle-theme': []
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
.top-bar {
  position: fixed;
  top: 0;
  right: 0;
  left: 64px;
  height: 60px;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  padding: 0 24px;
  z-index: 99;
  transition: left 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 锁定状态下顶部栏调整 */
.top-bar.sidebar-pinned {
  left: 220px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-left: auto;
}

/* 用户触发器 */
.user-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 6px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background: transparent;
}

.user-trigger:hover {
  background: #f3f4f6;
}

.user-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  font-size: 11px;
  font-weight: 500;
  color: #6b7280;
}

.chevron-icon {
  color: #9ca3af;
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
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

:deep(.el-dropdown-menu__item:hover) {
  background: #f3f4f6;
}
</style>
