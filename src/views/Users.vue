<template>
  <div class="yl-page">
    <!-- 页面头部 -->
    <div class="yl-page-header">
      <div class="yl-page-title">
        <el-icon :size="24" color="var(--yl-primary)">
          <User />
        </el-icon>
        <h1>用户管理</h1>
      </div>
      <div class="yl-page-actions">
        <el-button :icon="Refresh" @click="refreshUsers">刷新</el-button>
      </div>
    </div>

    <!-- 用户表格 -->
    <el-card class="yl-table-card">
      <el-table :data="users" border stripe>
        <el-table-column label="用户" min-width="200">
          <template #default="{ row }">
            <div class="yl-user-cell">
              <el-avatar :src="row.avatarUrl" :size="36">
                <el-icon><User /></el-icon>
              </el-avatar>
              <div class="yl-user-info">
                <div class="yl-user-name">{{ row.name }}</div>
                <div class="yl-user-email">{{ row.email }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="140">
          <template #default="{ row }">
            <el-tag :type="getRoleTagType(row.role)" size="small">
              {{ getRoleText(row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '激活' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="department" label="部门" min-width="150" />
        <el-table-column label="最后登录" width="180">
          <template #default="{ row }">
            <div v-if="row.lastLoginAt" class="yl-date-cell">
              <el-icon><Clock /></el-icon>
              {{ formatDate(row.lastLoginAt) }}
            </div>
            <span v-else class="yl-text-placeholder">未登录</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" @click="editUser(row)"> 编辑 </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="yl-pagination">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="users.length"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { User, Edit, Refresh, Clock } from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { User as UserType, ElementPlusTagType } from '@/types'

const users = ref<UserType[]>([])
const currentPage = ref(1)
const pageSize = ref(20)

// 角色标签颜色
function getRoleTagType(role: string): ElementPlusTagType {
  const roleMap: Record<string, ElementPlusTagType> = {
    super_admin: 'danger',
    admin: 'warning',
    user: 'primary',
    guest: 'info',
  }
  return roleMap[role] || 'info'
}

// 角色文本
function getRoleText(role: string) {
  const roleMap: Record<string, string> = {
    super_admin: '超级管理员',
    admin: '管理员',
    user: '普通用户',
    guest: '访客',
  }
  return roleMap[role] || '未知'
}

// 格式化日期
function formatDate(dateStr: string) {
  return format(new Date(dateStr), 'yyyy-MM-dd HH:mm', { locale: zhCN })
}

async function loadUsers() {
  try {
    const res = await api.get('/api/users')
    if (res.data.success) {
      users.value = res.data.data
    }
  } catch {
    ElMessage.error('加载用户列表失败')
  }
}

function refreshUsers() {
  loadUsers()
  ElMessage.success('已刷新')
}

function editUser(user: UserType) {
  ElMessage.info('编辑用户: ' + user.name)
}

onMounted(() => {
  loadUsers()
})
</script>

<style scoped>
/* ========== 用户管理页面 - YULI Design System ========== */

/* 表格卡片 */
.yl-table-card {
  overflow: hidden;
}

.yl-table-card :deep(.el-table) {
  font-size: var(--yl-font-size-base);
}

.yl-table-card :deep(.el-table th) {
  background-color: var(--yl-bg-hover);
  font-weight: var(--yl-font-weight-semibold);
}

.yl-table-card :deep(.el-table__row:hover) {
  background-color: var(--yl-bg-active);
}

/* 用户单元格 */
.yl-user-cell {
  display: flex;
  align-items: center;
  gap: var(--yl-gap-sm);
}

.yl-user-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.yl-user-name {
  font-weight: var(--yl-font-weight-medium);
  color: var(--yl-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yl-user-email {
  font-size: var(--yl-font-size-small);
  color: var(--yl-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 日期单元格 */
.yl-date-cell {
  display: flex;
  align-items: center;
  gap: var(--yl-gap-xs);
  color: var(--yl-text-secondary);
  font-size: var(--yl-font-size-small);
}

/* 分页 */
.yl-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--yl-margin-lg);
  padding-top: var(--yl-padding-md);
  border-top: 1px solid var(--yl-border-lighter);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .yl-pagination {
    justify-content: center;
  }
}
</style>
