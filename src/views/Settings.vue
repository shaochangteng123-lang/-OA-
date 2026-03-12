<template>
  <div class="yl-page settings-page">
    <div class="yl-page-header">
      <h1>个人设置</h1>
    </div>

    <div class="settings-content">
      <!-- 用户信息卡片 -->
      <el-card class="settings-card">
        <template #header>
          <div class="card-header">
            <el-icon><User /></el-icon>
            <span>账号信息</span>
          </div>
        </template>

        <el-descriptions :column="1" border>
          <el-descriptions-item label="用户名">
            {{ authStore.user?.name || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="邮箱">
            {{ authStore.user?.email || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="角色">
            <el-tag :type="getRoleTagType(authStore.user?.role || '')">
              {{ getRoleLabel(authStore.user?.role || '') }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <!-- 修改密码卡片 -->
      <el-card class="settings-card">
        <template #header>
          <div class="card-header">
            <el-icon><Lock /></el-icon>
            <span>修改密码</span>
          </div>
        </template>

        <el-form
          ref="passwordFormRef"
          :model="passwordForm"
          :rules="passwordRules"
          label-width="100px"
          style="max-width: 480px"
        >
          <el-form-item label="当前密码" prop="currentPassword">
            <el-input
              v-model="passwordForm.currentPassword"
              type="password"
              placeholder="请输入当前密码"
              show-password
            />
          </el-form-item>

          <el-form-item label="新密码" prop="newPassword">
            <el-input
              v-model="passwordForm.newPassword"
              type="password"
              placeholder="请输入新密码（至少6个字符）"
              show-password
            />
          </el-form-item>

          <el-form-item label="确认密码" prop="confirmPassword">
            <el-input
              v-model="passwordForm.confirmPassword"
              type="password"
              placeholder="请再次输入新密码"
              show-password
            />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="passwordLoading" @click="handleChangePassword">
              修改密码
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { User, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/utils/api'

const authStore = useAuthStore()

const passwordFormRef = ref<FormInstance>()
const passwordLoading = ref(false)

// 密码表单
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

// 验证确认密码
const validateConfirmPassword = (_rule: any, value: string, callback: any) => {
  if (value !== passwordForm.newPassword) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

// 表单验证规则
const passwordRules: FormRules = {
  currentPassword: [
    { required: true, message: '请输入当前密码', trigger: 'blur' },
  ],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码至少需要6个字符', trigger: 'blur' },
    { max: 128, message: '密码不能超过128个字符', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' },
  ],
}

// 获取角色标签类型
function getRoleTagType(role: string): 'success' | 'warning' | 'danger' | 'info' {
  const roleMap: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    super_admin: 'danger',
    admin: 'warning',
    user: 'success',
    guest: 'info',
  }
  return roleMap[role] || 'info'
}

// 获取角色标签文字
function getRoleLabel(role: string): string {
  const roleMap: Record<string, string> = {
    super_admin: '超级管理员',
    admin: '管理员',
    user: '普通用户',
    guest: '访客',
  }
  return roleMap[role] || role
}

// 修改密码
async function handleChangePassword() {
  if (!passwordFormRef.value) return

  try {
    await passwordFormRef.value.validate()
  } catch {
    return
  }

  try {
    passwordLoading.value = true

    const response = await api.post('/api/auth/change-password', {
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    })

    if (response.data.success) {
      ElMessage.success('密码修改成功')
      // 清空表单
      passwordFormRef.value?.resetFields()
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '密码修改失败')
  } finally {
    passwordLoading.value = false
  }
}
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.settings-page {
  height: calc(100vh - 60px);
  margin: -24px -45px;
  padding: 24px;
}

.settings-content {
  max-width: 800px;
}

.settings-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

:deep(.el-descriptions__label) {
  width: 100px;
}
</style>
