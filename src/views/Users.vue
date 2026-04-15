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
        <el-button v-if="authStore.hasPermission('manage_users')" :icon="Setting" @click="showDepartmentDialog">
          部门职位管理
        </el-button>
        <el-button v-if="authStore.hasPermission('manage_users')" type="primary" :icon="Plus" @click="showCreateDialog">
          创建用户
        </el-button>
      </div>
    </div>

    <!-- 用户表格 -->
    <el-card class="yl-table-card">
      <el-table :data="paginatedUsers" border stripe>
        <el-table-column label="用户" min-width="200" align="center">
          <template #default="{ row }">
            <div class="yl-user-cell-wrapper">
              <div class="yl-user-cell">
                <el-avatar :src="row.avatarUrl" :size="36">
                  <el-icon><User /></el-icon>
                </el-avatar>
                <div class="yl-user-name">{{ row.name }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="140" align="center">
          <template #default="{ row }">
            <el-tag :type="getRoleTagType(row.role)" size="small">
              {{ getRoleText(row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '激活' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="员工状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="getEmploymentStatusTagType(row.employmentStatus)" size="small">
              {{ getEmploymentStatusText(row.employmentStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="员工状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="getEmploymentStatusTagType(row.employmentStatus)" size="small">
              {{ getEmploymentStatusText(row.employmentStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="department" label="部门" min-width="150" align="center" />
        <el-table-column label="最后登录" width="180" align="center">
          <template #default="{ row }">
            <div v-if="row.lastLoginAt" class="yl-date-cell">
              <el-icon><Clock /></el-icon>
              {{ formatDate(row.lastLoginAt) }}
            </div>
            <span v-else class="yl-text-placeholder">未登录</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="280" align="center">
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
            <el-option v-for="dept in departments" :key="dept" :label="dept" :value="dept" />
          </el-select>
        </el-form-item>
        <el-form-item label="职位" prop="position">
          <el-select v-model="createForm.position" placeholder="请先选择部门" :disabled="!createForm.department" style="width: 100%">
            <el-option v-for="pos in getPositions(createForm.department)" :key="pos" :label="pos" :value="pos" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="createForm.role" style="width: 100%">
            <el-option label="超级管理员" value="super_admin" />
            <el-option label="管理员" value="admin" />
            <el-option label="总经理" value="general_manager" />
            <el-option label="普通用户" value="user" />
            <el-option label="访客" value="guest" />
          </el-select>
        </el-form-item>
        <el-form-item label="员工状态" prop="employmentStatus">
          <el-select v-model="createForm.employmentStatus" style="width: 100%">
            <el-option label="实习期" value="probation" />
            <el-option label="在职" value="active" />
            <el-option label="已离职" value="resigned" />
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
            <el-option v-for="dept in departments" :key="dept" :label="dept" :value="dept" />
          </el-select>
        </el-form-item>
        <el-form-item label="职位" prop="position">
          <el-select v-model="editForm.position" placeholder="请先选择部门" :disabled="!editForm.department" clearable style="width: 100%">
            <el-option v-for="pos in getPositions(editForm.department)" :key="pos" :label="pos" :value="pos" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="editForm.role" style="width: 100%">
            <el-option label="超级管理员" value="super_admin" />
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
        <el-form-item label="员工状态" prop="employmentStatus">
          <el-select v-model="editForm.employmentStatus" style="width: 100%">
            <el-option label="实习期" value="probation" />
            <el-option label="在职" value="active" />
            <el-option label="已离职" value="resigned" />
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

    <!-- 部门职位管理对话框 -->
    <el-dialog v-model="departmentDialogVisible" title="部门职位管理" width="700px" :close-on-click-modal="false">
      <div class="dept-management">
        <div class="dept-section">
          <div class="dept-header">
            <h3>部门列表</h3>
            <el-button size="small" type="primary" :icon="Plus" @click="showAddDepartmentDialog">添加部门</el-button>
          </div>
          <el-table :data="localDepartmentList" border>
            <el-table-column label="部门名称" prop="name" align="center" />
            <el-table-column label="职位数量" prop="positionCount" width="100" align="center" />
            <el-table-column label="操作" width="220" align="center">
              <template #default="{ row }">
                <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                  <el-button size="small" :icon="Edit" @click="showEditPositionsDialog(row.name)">管理职位</el-button>
                  <el-popconfirm title="确定删除此部门？" @confirm="deleteDepartment(row.name)">
                    <template #reference>
                      <el-button size="small" type="danger" :icon="Delete">删除</el-button>
                    </template>
                  </el-popconfirm>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="departmentDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveDepartmentChanges">保存</el-button>
      </template>
    </el-dialog>

    <!-- 添加部门对话框 -->
    <el-dialog v-model="addDepartmentVisible" title="添加部门" width="400px" :close-on-click-modal="false">
      <el-form :model="addDepartmentForm" label-width="80px">
        <el-form-item label="部门名称">
          <el-input v-model="addDepartmentForm.name" placeholder="请输入部门名称" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDepartmentVisible = false">取消</el-button>
        <el-button type="primary" @click="addDepartment">确定</el-button>
      </template>
    </el-dialog>

    <!-- 管理职位对话框 -->
    <el-dialog v-model="editPositionsVisible" title="管理职位" width="500px" :close-on-click-modal="false">
      <div class="positions-management">
        <div class="positions-header">
          <h4>{{ currentDepartment }} - 职位列表</h4>
          <el-button size="small" type="primary" :icon="Plus" @click="showAddPositionInput">添加职位</el-button>
        </div>
        <div v-if="addPositionInputVisible" style="display: flex; gap: 8px; margin-bottom: 12px">
          <el-input v-model="newPositionName" placeholder="输入职位名称" size="small" @keyup.enter="addPosition" @keyup.esc="cancelAddPosition" />
          <el-button :icon="Check" size="small" type="primary" @click="addPosition" />
          <el-button :icon="Close" size="small" @click="cancelAddPosition" />
        </div>
        <el-table :data="currentPositions" border>
          <el-table-column label="职位名称" prop="name" />
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-popconfirm title="确定删除此职位？" @confirm="deletePosition(row)">
                <template #reference>
                  <el-button size="small" type="danger" :icon="Delete">删除</el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="editPositionsVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { User, Edit, Refresh, Clock, Plus, Delete, Key, Setting, Check, Close } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { api } from '@/utils/api'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { User as UserType, ElementPlusTagType } from '@/types'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

const users = ref<UserType[]>([])
const currentPage = ref(1)
const pageSize = ref(20)

// 动态部门职位配置
const deptPositionMap = ref<Record<string, string[]>>({})
const departments = computed(() => Object.keys(deptPositionMap.value))
const getPositions = (dept: string) => deptPositionMap.value[dept] || []

// 加载部门职位配置
async function loadDeptPositionConfig() {
  try {
    const res = await api.get('/api/departments/org-options')
    if (res.data.success) {
      deptPositionMap.value = res.data.data
    }
  } catch (error) {
    console.error('加载部门职位配置失败:', error)
    // 使用默认配置
    deptPositionMap.value = {
      '行政部': ['行政主管', '行政专员', '财务', '出纳'],
      '项目部': ['项目经理', '员工'],
    }
  }
}

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
  employmentStatus: 'probation',
})

// 手机号验证器
const validateMobile = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback(new Error('请输入手机号'))
  } else if (!/^1[3-9]\d{9}$/.test(value)) {
    callback(new Error('手机号格式不正确'))
  } else {
    callback()
  }
}

// 用户名验证：必须为汉字，至少2个字符
const validateChineseName = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback(new Error('请输入用户名'))
  } else if (!/^[\u4e00-\u9fa5]+$/.test(value)) {
    callback(new Error('用户名必须为汉字'))
  } else if (value.length < 2) {
    callback(new Error('用户名至少2个汉字'))
  } else {
    callback()
  }
}

const createRules: FormRules = {
  username: [
    { required: true, validator: validateChineseName, trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少6个字符', trigger: 'blur' },
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
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
  employmentStatus: [
    { required: true, message: '请选择员工状态', trigger: 'change' },
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
  employmentStatus: 'probation',
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
    { required: true, validator: validateChineseName, trigger: 'blur' },
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
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
  status: [
    { required: true, message: '请选择状态', trigger: 'change' },
  ],
  employmentStatus: [
    { required: true, message: '请选择员工状态', trigger: 'change' },
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

// 部门职位管理相关
const departmentDialogVisible = ref(false)
const localDeptPositionMap = ref<Record<string, string[]>>({})
const localDepartments = computed(() => Object.keys(localDeptPositionMap.value))
const localDepartmentList = computed(() =>
  localDepartments.value.map(name => ({
    name,
    positionCount: localDeptPositionMap.value[name]?.length || 0,
  }))
)

// 添加部门
const addDepartmentVisible = ref(false)
const addDepartmentForm = reactive({ name: '' })

// 管理职位
const editPositionsVisible = ref(false)
const currentDepartment = ref('')
const currentPositions = computed(() => {
  const positions = localDeptPositionMap.value[currentDepartment.value] || []
  return positions.map(p => ({ name: p }))
})
const addPositionInputVisible = ref(false)
const newPositionName = ref('')

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

// 员工状态标签颜色
function getEmploymentStatusTagType(status: string): ElementPlusTagType {
  const map: Record<string, ElementPlusTagType> = {
    active: 'success',
    probation: 'warning',
    resigned: 'info',
    on_leave: 'warning',
  }
  return map[status] || 'info'
}

// 员工状态文本
function getEmploymentStatusText(status: string) {
  const map: Record<string, string> = {
    active: '在职',
    probation: '试用期',
    resigned: '已离职',
    on_leave: '休假中',
  }
  return map[status] || '未设置'
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
  createForm.employmentStatus = 'probation'
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
  editForm.employmentStatus = (user as any).employmentStatus || 'probation'
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
      employmentStatus: editForm.employmentStatus,
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

// 显示部门管理对话框
async function showDepartmentDialog() {
  localDeptPositionMap.value = JSON.parse(JSON.stringify(deptPositionMap.value))
  departmentDialogVisible.value = true
}

// 显示添加部门对话框
function showAddDepartmentDialog() {
  addDepartmentForm.name = ''
  addDepartmentVisible.value = true
}

// 添加部门
function addDepartment() {
  if (!addDepartmentForm.name.trim()) {
    ElMessage.warning('请输入部门名称')
    return
  }
  if (localDeptPositionMap.value[addDepartmentForm.name]) {
    ElMessage.warning('部门已存在')
    return
  }
  localDeptPositionMap.value[addDepartmentForm.name] = []
  addDepartmentVisible.value = false
  ElMessage.success('部门添加成功')
}

// 删除部门
function deleteDepartment(dept: string) {
  delete localDeptPositionMap.value[dept]
  ElMessage.success('部门删除成功')
}

// 显示管理职位对话框
function showEditPositionsDialog(dept: string) {
  currentDepartment.value = dept
  editPositionsVisible.value = true
  addPositionInputVisible.value = false
}

// 显示添加职位输入框
function showAddPositionInput() {
  newPositionName.value = ''
  addPositionInputVisible.value = true
}

// 添加职位
function addPosition() {
  if (!newPositionName.value.trim()) {
    ElMessage.warning('请输入职位名称')
    return
  }
  const positions = localDeptPositionMap.value[currentDepartment.value] || []
  if (positions.includes(newPositionName.value)) {
    ElMessage.warning('职位已存在')
    return
  }
  positions.push(newPositionName.value)
  localDeptPositionMap.value[currentDepartment.value] = positions
  addPositionInputVisible.value = false
  ElMessage.success('职位添加成功')
}

// 取消添加职位
function cancelAddPosition() {
  addPositionInputVisible.value = false
  newPositionName.value = ''
}

// 删除职位
function deletePosition(position: { name: string }) {
  const positions = localDeptPositionMap.value[currentDepartment.value] || []
  const index = positions.indexOf(position.name)
  if (index > -1) {
    positions.splice(index, 1)
    localDeptPositionMap.value[currentDepartment.value] = positions
    ElMessage.success('职位删除成功')
  }
}

// 保存部门职位变更
async function saveDepartmentChanges() {
  try {
    const res = await api.post('/api/departments/org-options', {
      departmentPositionMap: localDeptPositionMap.value
    })
    if (res.data.success) {
      deptPositionMap.value = JSON.parse(JSON.stringify(localDeptPositionMap.value))
      ElMessage.success('保存成功')
      departmentDialogVisible.value = false
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '保存失败')
  }
}

onMounted(() => {
  loadDeptPositionConfig()
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
  justify-content: center;
}

/* 用户单元格外层容器 - 居中对齐 */
.yl-user-cell-wrapper {
  display: flex;
  justify-content: center;
  width: 100%;
}

/* 用户单元格 - 固定宽度，内容左对齐 */
.yl-user-cell {
  display: flex;
  align-items: center;
  gap: var(--yl-gap-sm);
  width: 140px;
}

.yl-user-cell .el-avatar {
  flex-shrink: 0;
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
  justify-content: center;
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

/* 部门管理样式 */
.dept-management {
  padding: 12px 0;
}

.dept-section {
  margin-bottom: 24px;
}

.dept-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.dept-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.positions-management {
  padding: 12px 0;
}

.positions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.positions-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
</style>
