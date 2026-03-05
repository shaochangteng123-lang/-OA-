<template>
  <router-link v-slot="{ navigate, isExactActive }" :to="path" custom>
    <div class="menu-item-wrapper" @click="navigate">
      <el-tooltip :content="label" placement="right" :disabled="!collapsed" :show-after="300">
        <div :class="['menu-item', { active: isExactActive, collapsed: collapsed }]">
          <i class="menu-icon">
            <el-icon :size="18">
              <component :is="icon" />
            </el-icon>
          </i>
          <span v-if="!collapsed" class="menu-text">{{ label }}</span>
          <el-badge v-if="badge && !collapsed" :value="badge" :type="badgeType" />
        </div>
      </el-tooltip>
    </div>
  </router-link>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  path: string
  label: string
  icon: Component
  badge?: string | number
  badgeType?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  collapsed: boolean
}>()
</script>

<style scoped>
.menu-item-wrapper {
  width: 100%;
  padding: 2px 8px;
  display: flex;
}

.menu-item {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  color: #6b7280;
  font-size: 14px;
  transition: background-color 0.15s, color 0.15s;
  white-space: nowrap;
  width: 100%;
}

.menu-item:hover {
  background: #f3f4f6;
  color: #111827;
}

.menu-item.active {
  background: #e0e7ff;
  color: #4f46e5;
  font-weight: 600;
}

.menu-item.collapsed.active {
  position: relative;
}

.menu-item.collapsed.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  width: 3px;
  height: 20px;
  background: #4f46e5;
  border-radius: 0 2px 2px 0;
}

.menu-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
}

.menu-text {
  margin-left: 12px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: opacity 0.3s ease;
}
</style>
