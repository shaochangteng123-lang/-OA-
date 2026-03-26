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
        <el-button v-if="authStore.hasPermission('manage_users')" type="primary" :icon="Plus" @click="showCreateDialog">
          创建用户
        </el-button>
      </div>
    </div>

    <!-- 用户表格 -->
    <el-card class="yl-table-card">
      <el-table :data="paginatedUsers" border stripe>
        <el-table-column label="用户" min-width="200">
          <template #default="{ row }">
            <div class="yl-user-cell">
              <el-avatar :src="row.avatarUrl" :size="36">
                <el-icon><User /></el-icon>
              </el-avatar>
              <div class="yl-user-info">
                <div class="yl-user-name">{{ row.name }}</div>
                <div class="yl-user-email">{{ row.email || '-' }}</div>
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
        <el-table-column label="操作" width="280">
          <template #default="{ row }">
            <div class="yl-action-buttons">
              <el-button size="small" :icon="Edit" @click="editUser(row)">编辑</el-button>
              <el-button
                v-if="authStore.hasPermission('manage_users') && row.role !== 'super_admin'"
                size="small"
                :icon="Key"
                @click="resetPasswordDialog(row)"
              >
                重置密码
              </el-button>
              <el-popconfirm
                v-if="authStore.hasPermission('manage_users') && row.role !== 'super_admin' && row.id !== authStore.user?.id"
                title="确定删除此用户？此操作不可恢复。"
                confirm-button-text="确定"
                cancel-button-text="取消"
                @confirm="deleteUser(row)"
              >
                <template #reference>
                  <el-button size="small" type="danger" :icon="Delete">删除</el-button>
                </template>
              </el-popconfirm>
            </div>
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

    <!-- 创建用户对话框 -->
    <el-dialog v-model="createDialogVisible" title="创建用户" width="500px" :close-on-click-modal="false">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="100px">
        <el-form-item label="员工编号">
          <el-input :value="nextEmployeeNo" disabled placeholder="自动生成" />
        </el-form-item>
        <el-form-item label="用户名" prop="username">
          <el-input v-model="createForm.username" placeholder="使用员工姓名，即为显示名称" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="createForm.password" type="password" placeholder="至少6个字符" show-password />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="createForm.email" placeholder="输入有效邮箱" />
        </el-form-item>
        <el-form-item label="手机号" prop="mobile">
          <el-input v-model="createForm.mobile" placeholder="11位手机号" maxlength="11" />
        </el-form-item>
        <el-form-item label="部门" prop="department">
          <el-select v-model="createForm.department" placeholder="请选择部门" style="width: 100%">
            <el-option v-for="dept in DEPARTMENTS" :key="dept" :label="dept" :value="dept" />
          </el-select>
        </el-form-item>
        <el-form-item label="职位" prop="position">
          <el-select v-model="createForm.position" placeholder="请先选择部门" :disabled="!createForm.department" style="width: 100%">
            <el-option v-for="pos in getPositionsByDepartment(createForm.department)" :key="pos" :label="pos" :value="pos" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="createForm.role" style="width: 100%">
            <el-option label="管理员" value="admin" />
            <el-option label="总经理" value="general_manager" />
            <el-option label="普通用户" value="user" />
            <el-option label="访客" value="guest" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="createLoading" @click="handleCreateUser">创建</el-button>
      </template>
    </el-dialog>

    <!-- 编辑用户对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑用户" width="500px" :close-on-click-modal="false">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="100px">
        <el-form-item label="员工编号">
          <el-input :value="editEmployeeNo" disabled placeholder="-" />
        </el-form-item>
        <el-form-item label="用户名" prop="username">
          <el-input v-model="editForm.username" placeholder="仅字母、数字、下划线" />
        </el-form-item>
        <el-form-item label="显示名称" prop="name">
          <el-input v-model="editForm.name" placeholder="用户的显示名称" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="editForm.password" type="password" placeholder="不修改请留空" show-password />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="editForm.email" placeholder="输入有效邮箱" />
        </el-form-item>
        <el-form-item label="手机号" prop="mobile">
          <el-input v-model="editForm.mobile" placeholder="11位手机号" maxlength="11" />
        </el-form-item>
        <el-form-item label="部门" prop="department">
          <el-select v-model="editForm.department" placeholder="请选择部门" clearable style="width: 100%">
            <el-option v-for="dept in DEPARTMENTS" :key="dept" :label="dept" :value="dept" />
          </el-select>
        </el-form-item>
        <el-form-item label="职位" prop="position">
          <el-select v-model="editForm.position" placeholder="请先选择部门" :disabled="!editForm.department" clearable style="width: 100%">
            <el-option v-for="pos in getPositionsByDepartment(editForm.department)" :key="pos" :label="pos" :value="pos" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="editForm.role" style="width: 100%" :disabled="editForm.role === 'super_admin'">
            <el-option label="超级管理员" value="super_admin" :disabled="editForm.role !== 'super_admin'" />
            <el-option label="管理员" value="admin" />
            <el-option label="总经理" value="general_manager" />
            <el-option label="普通用户" value="user" />
            <el-option label="访客" value="guest" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="editForm.status" style="width: 100%">
            <el-option label="激活" value="active" />
            <el-option label="停用" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="editLoading" @click="handleEditUser">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码对话框 -->
    <el-dialog v-model="resetPasswordVisible" title="重置密码" width="400px" :close-on-click-modal="false">
      <el-form ref="resetPasswordFormRef" :model="resetPasswordForm" :rules="resetPasswordRules" label-width="100px">
        <el-form-item label="用户">
          <el-input :value="resetPasswordForm.userName" disabled />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="resetPasswordForm.newPassword" type="password" placeholder="至少6个字符" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetPasswordVisible = false">取消</el-button>
        <el-button type="primary" :loading="resetPasswordLoading" @click="handleResetPassword">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { User, Edit, Refresh, Clock, Plus, Delete, Key } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { api } from '@/utils/api'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { User as UserType, ElementPlusTagType } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { DEPARTMENTS, getPositionsByDepartment } from '@/constants/department'

const authStore = useAuthStore()

const users = ref<UserType[]>([])
const currentPage = ref(1)
const pageSize = ref(20)

// 分页后的用户列表
const paginatedUsers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return users.value.slice(start, end)
})

// 创建用户相关
const createDialogVisible = ref(false)
const createFormRef = ref<FormInstance>()
const createLoading = ref(false)
const nextEmployeeNo = ref('')
const editEmployeeNo = ref('')
const createForm = reactive({
  username: '',
  password: '',
  email: '',
  mobile: '',
  role: 'user',
  department: '',
  position: '',
})

// 手机号验证器
const validateMobile = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback(new Error('请输入手机号'))
  } else if (value.length !== 11) {
    callback(new Error('手机号格式不正确'))
  } else if (!/^1[3-9]\d{9}$/.test(value)) {
    callback(new Error('手机号格式不正确'))
  } else {
    callback()
  }
}

const createRules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, message: '用户名至少2个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少6个字符', trigger: 'blur' },
  ],
  email: [
    { type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' },
  ],
  mobile: [
    { required: true, validator: validateMobile, trigger: 'blur' },
  ],
  department: [
    { required: true, message: '请选择部门', trigger: 'change' },
  ],
  position: [
    { required: true, message: '请选择职位', trigger: 'change' },
  ],
  role: [
    { required: true, message: '请选择角色', trigger: 'change' },
  ],
}

// 编辑用户相关
const editDialogVisible = ref(false)
const editFormRef = ref<FormInstance>()
const editLoading = ref(false)
const editForm = reactive({
  id: '',
  username: '',
  name: '',
  password: '',
  email: '',
  mobile: '',
  role: 'user',
  status: 'active',
  department: '',
  position: '',
  bankAccountName: '',
  bankAccountPhone: '',
  bankName: '',
  bankAccountNumber: '',
})

// 编辑表单手机号验证器（可选）
const validateEditMobile = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback()
  } else if (!/^1[3-9]\d{9}$/.test(value)) {
    callback(new Error('手机号格式不正确'))
  } else {
    callback()
  }
}

// 编辑表单银行卡号验证器（可选）
const validateEditBankAccount = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback()
  } else if (!/^\d{16,19}$/.test(value)) {
    callback(new Error('银行卡号格式不正确（16-19位数字）'))
  } else {
    callback()
  }
}

const editRules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, message: '用户名至少2个字符', trigger: 'blur' },
  ],
  name: [
    { required: true, message: '请输入显示名称', trigger: 'blur' },
  ],
  role: [
    { required: true, message: '请选择角色', trigger: 'change' },
  ],
  status: [
    { required: true, message: '请选择状态', trigger: 'change' },
  ],
  bankAccountPhone: [
    { validator: validateEditMobile, trigger: 'blur' },
  ],
  bankAccountNumber: [
    { validator: validateEditBankAccount, trigger: 'blur' },
  ],
}

// 重置密码相关
const resetPasswordVisible = ref(false)
const resetPasswordFormRef = ref<FormInstance>()
const resetPasswordLoading = ref(false)
const resetPasswordForm = reactive({
  userId: '',
  userName: '',
  newPassword: '',
})

const resetPasswordRules: FormRules = {
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码至少6个字符', trigger: 'blur' },
  ],
}

// 角色标签颜色
function getRoleTagType(role: string): ElementPlusTagType {
  const roleMap: Record<string, ElementPlusTagType> = {
    super_admin: 'danger',
    admin: 'warning',
    general_manager: 'info',
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
    general_manager: '总经理',
    user: '普通用户',
    guest: '访客',
  }
  return roleMap[role] || '未知'
}

// 格式化日期
function formatDate(dateStr: string) {
  return format(new Date(dateStr), 'yyyy-MM-dd HH:mm', { locale: zhCN })
}

// 加载用户列表
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

// 部门变化时清空职位（创建表单）
watch(() => createForm.department, () => {
  createForm.position = ''
})

// 编辑表单填充时跳过 watcher
const isEditFormPopulating = ref(false)

// 部门变化时清空职位（编辑表单）
watch(() => editForm.department, () => {
  if (isEditFormPopulating.value) return
  editForm.position = ''
})

// 显示创建对话框
async function showCreateDialog() {
  createForm.username = ''
  createForm.password = ''
  createForm.email = ''
  createForm.mobile = ''
  createForm.role = 'user'
  createForm.department = ''
  createForm.position = ''
  createDialogVisible.value = true
  // 获取下一个员工编号
  try {
    const res = await api.get('/api/users/next-employee-no')
    if (res.data.success) {
      nextEmployeeNo.value = res.data.data.employeeNo
    }
  } catch {
    nextEmployeeNo.value = ''
  }
}

// 创建用户
async function handleCreateUser() {
  if (!createFormRef.value) return

  try {
    await createFormRef.value.validate()
  } catch {
    return
  }

  try {
    createLoading.value = true
    const res = await api.post('/api/users/create', createForm)
    if (res.data.success) {
      ElMessage.success('用户创建成功')
      createDialogVisible.value = false
      loadUsers()
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '创建失败')
  } finally {
    createLoading.value = false
  }
}

// 编辑用户
function editUser(user: UserType) {
  isEditFormPopulating.value = true
  editForm.id = user.id
  editForm.username = user.username || ''
  editForm.name = user.name
  editForm.password = ''
  editForm.email = user.email || ''
  editForm.mobile = (user as any).mobile || ''
  editForm.role = user.role
  editForm.status = user.status
  editForm.department = user.department || ''
  editForm.position = user.position || ''
  editForm.bankAccountName = (user as any).bankAccountName || ''
  editForm.bankAccountPhone = (user as any).bankAccountPhone || ''
  editForm.bankName = (user as any).bankName || ''
  editForm.bankAccountNumber = (user as any).bankAccountNumber || ''
  editEmployeeNo.value = (user as any).employeeNo || '-'
  editDialogVisible.value = true
  nextTick(() => {
    isEditFormPopulating.value = false
  })
}

// 保存编辑
async function handleEditUser() {
  if (!editFormRef.value) return

  try {
    await editFormRef.value.validate()
  } catch {
    return
  }

  try {
    editLoading.value = true
    const res = await api.post('/api/users', {
      id: editForm.id,
      username: editForm.username,
      name: editForm.name,
      password: editForm.password || undefined,
      email: editForm.email || null,
      mobile: editForm.mobile || null,
      role: editForm.role,
      status: editForm.status,
      department: editForm.department || null,
      position: editForm.position || null,
      bankAccountName: editForm.bankAccountName || null,
      bankAccountPhone: editForm.bankAccountPhone || null,
      bankName: editForm.bankName || null,
      bankAccountNumber: editForm.bankAccountNumber || null,
    })
    if (res.data.success) {
      ElMessage.success('保存成功')
      editDialogVisible.value = false
      loadUsers()
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '保存失败')
  } finally {
    editLoading.value = false
  }
}

// 删除用户
async function deleteUser(user: UserType) {
  try {
    const res = await api.delete(`/api/users/${user.id}`)
    if (res.data.success) {
      ElMessage.success('用户已删除')
      loadUsers()
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '删除失败')
  }
}

// 显示重置密码对话框
function resetPasswordDialog(user: UserType) {
  resetPasswordForm.userId = user.id
  resetPasswordForm.userName = user.name
  resetPasswordForm.newPassword = ''
  resetPasswordVisible.value = true
}

// 重置密码
async function handleResetPassword() {
  if (!resetPasswordFormRef.value) return

  try {
    await resetPasswordFormRef.value.validate()
  } catch {
    return
  }

  try {
    resetPasswordLoading.value = true
    const res = await api.post(`/api/users/${resetPasswordForm.userId}/reset-password`, {
      newPassword: resetPasswordForm.newPassword,
    })
    if (res.data.success) {
      ElMessage.success('密码重置成功')
      resetPasswordVisible.value = false
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '重置密码失败')
  } finally {
    resetPasswordLoading.value = false
  }
}

onMounted(() => {
  loadUsers()
})
</script>

<style scoped>
/* ========== 用户管理页面 - YULI Design System ========== */

/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.yl-page {
  height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  margin: calc(-1 * var(--yl-main-padding-y, 24px)) calc(-1 * var(--yl-main-padding-x, 45px));
  padding: 24px;
}

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

/* 操作按钮容器 - 一排展示 */
.yl-action-buttons {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  align-items: center;
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
