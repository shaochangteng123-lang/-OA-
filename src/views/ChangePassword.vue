<template>
  <div class="change-password-container">
    <div class="change-password-box">
      <div class="change-password-header">
        <div class="logo">
          <div class="logo-icon">Y</div>
          <div class="logo-text">
            <h1>YuliLog</h1>
            <p>工作日志系统</p>
          </div>
        </div>
      </div>

      <div class="change-password-content">
        <div class="notice-banner">
          <el-icon class="notice-icon"><Warning /></el-icon>
          <div class="notice-text">
            <p class="notice-title">首次登录需修改密码</p>
            <p class="notice-desc">为保障账号安全，请立即修改初始密码</p>
          </div>
        </div>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-width="0"
          @submit.prevent="handleSubmit"
        >
          <el-form-item prop="currentPassword">
            <el-input
              v-model="form.currentPassword"
              type="password"
              placeholder="当前密码（初始密码）"
              size="large"
              :prefix-icon="Lock"
              show-password
              autocomplete="current-password"
            />
          </el-form-item>

          <el-form-item prop="newPassword">
            <el-input
              v-model="form.newPassword"
              type="password"
              placeholder="新密码（至少8位，包含字母和数字）"
              size="large"
              :prefix-icon="Lock"
              show-password
              autocomplete="new-password"
            />
          </el-form-item>

          <el-form-item prop="confirmPassword">
            <el-input
              v-model="form.confirmPassword"
              type="password"
              placeholder="确认新密码"
              size="large"
              :prefix-icon="Lock"
              show-password
              autocomplete="new-password"
              @keyup.enter="handleSubmit"
            />
          </el-form-item>

          <el-button
            type="primary"
            size="large"
            :loading="loading"
            class="submit-button"
            @click="handleSubmit"
          >
            修改密码并重新登录
          </el-button>
        </el-form>

        <div v-if="error" class="error-message">
          <el-alert :title="error" type="error" :closable="false" />
        </div>
      </div>
    </div>

    <div class="login-bg">
      <div class="bg-circle circle-1"></div>
      <div class="bg-circle circle-2"></div>
      <div class="bg-circle circle-3"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { Lock, Warning } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/utils/api'

const authStore = useAuthStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const error = ref('')

const form = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

// 确认密码验证器
const validateConfirmPassword = (_rule: any, value: string, callback: any) => {
  if (!value) {
    callback(new Error('请确认新密码'))
  } else if (value !== form.newPassword) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const rules: FormRules = {
  currentPassword: [
    { required: true, message: '请输入当前密码', trigger: 'blur' },
  ],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码至少8位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, validator: validateConfirmPassword, trigger: 'blur' },
  ],
}

async function handleSubmit() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch {
    return
  }

  try {
    loading.value = true
    error.value = ''

    await api.post('/api/auth/change-password', {
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    })

    ElMessage.success('密码修改成功，请用新密码重新登录')

    // 退出登录并跳转到登录页，携带 changed=1 参数
    await api.post('/api/auth/logout')
    authStore.user = null
    window.location.href = '/login?changed=1'
  } catch (err: any) {
    const serverMsg = err.response?.data?.message
    if (serverMsg) {
      error.value = serverMsg
    } else {
      error.value = '密码修改失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.change-password-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  overflow: hidden;
}

.change-password-box {
  position: relative;
  z-index: 10;
  width: min(460px, 90%);
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.change-password-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 32px 30px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 16px;
  color: #fff;
}

.logo-icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 600;
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.logo-text h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: #fff;
}

.logo-text p {
  margin: 4px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
}

.change-password-content {
  padding: 32px 30px;
}

.notice-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: #fff7e6;
  border: 1px solid #ffd591;
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 28px;
}

.notice-icon {
  font-size: 22px;
  color: #fa8c16;
  flex-shrink: 0;
  margin-top: 1px;
}

.notice-text {
  flex: 1;
}

.notice-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: #d46b08;
}

.notice-desc {
  margin: 0;
  font-size: 13px;
  color: #ad6800;
}

.submit-button {
  width: 100%;
  height: 48px;
  font-size: 16px;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  margin-top: 8px;
}

.submit-button:hover {
  background: linear-gradient(135deg, #5568d3 0%, #65408b 100%);
}

.error-message {
  margin-top: 20px;
}

/* 背景动画 */
.login-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  overflow: hidden;
}

.bg-circle {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(20px);
  animation: float 20s infinite ease-in-out;
}

.circle-1 {
  width: 300px;
  height: 300px;
  top: -100px;
  left: -100px;
  animation-delay: 0s;
}

.circle-2 {
  width: 400px;
  height: 400px;
  bottom: -150px;
  right: -150px;
  animation-delay: -7s;
}

.circle-3 {
  width: 250px;
  height: 250px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation-delay: -14s;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  25% {
    transform: translateY(-30px) rotate(90deg);
  }
  50% {
    transform: translateY(0) rotate(180deg);
  }
  75% {
    transform: translateY(30px) rotate(270deg);
  }
}

:deep(.el-input__wrapper) {
  border-radius: 8px;
  height: 48px;
}

:deep(.el-form-item) {
  margin-bottom: 20px;
}
</style>
