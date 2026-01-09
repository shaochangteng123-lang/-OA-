<template>
  <div class="login-container">
    <div class="login-box">
      <div class="login-header">
        <div class="logo">
          <div class="logo-icon">Y</div>
          <div class="logo-text">
            <h1>YuliLog</h1>
            <p>工作日志系统</p>
          </div>
        </div>
      </div>

      <div class="login-content">
        <h2 class="login-title">欢迎登录</h2>
        <p class="login-subtitle">使用飞书账号登录</p>

        <el-button
          type="primary"
          size="large"
          :loading="loading"
          class="login-button"
          @click="handleFeishuLogin"
        >
          <el-icon class="button-icon"><Connection /></el-icon>
          <span>飞书登录</span>
        </el-button>

        <div v-if="error" class="error-message">
          <el-alert :title="error" type="error" :closable="false" />
        </div>

        <div class="login-footer">
          <p>© 2024 YuliLog 工作日志系统</p>
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
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Connection } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const loading = ref(false)
const error = ref('')

// 检查是否已登录
onMounted(async () => {
  // 如果已经登录，跳转到首页
  if (authStore.isLoggedIn) {
    const redirect = (route.query.redirect as string) || '/'
    router.push(redirect)
    return
  }

  // 检查会话
  loading.value = true
  const isLoggedIn = await authStore.checkSession()
  loading.value = false

  if (isLoggedIn) {
    const redirect = (route.query.redirect as string) || '/'
    router.push(redirect)
  }
})

// 飞书登录
function handleFeishuLogin() {
  try {
    loading.value = true
    error.value = ''

    // 构建飞书OAuth登录URL
    const state = Math.random().toString(36).substring(7)

    // 保存state到sessionStorage用于验证
    sessionStorage.setItem('feishu_oauth_state', state)

    // 跳转到飞书授权页面
    const feishuAuthUrl = `/api/auth/login?redirect=${encodeURIComponent(
      (route.query.redirect as string) || '/'
    )}`

    window.location.href = feishuAuthUrl
  } catch (err) {
    loading.value = false
    error.value = '登录失败，请重试'
    console.error('飞书登录失败:', err)
    ElMessage.error('登录失败，请重试')
  }
}
</script>

<style scoped>
.login-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  overflow: hidden;
}

.login-box {
  position: relative;
  z-index: 10;
  width: 420px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.login-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 40px 30px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 16px;
  color: #fff;
}

.logo-icon {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 600;
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.logo-text h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 600;
  color: #fff;
}

.logo-text p {
  margin: 4px 0 0;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
}

.login-content {
  padding: 40px 30px;
}

.login-title {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 600;
  color: #333;
  text-align: center;
}

.login-subtitle {
  margin: 0 0 32px;
  font-size: 14px;
  color: #666;
  text-align: center;
}

.login-button {
  width: 100%;
  height: 48px;
  font-size: 16px;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}

.login-button:hover {
  background: linear-gradient(135deg, #5568d3 0%, #65408b 100%);
}

.button-icon {
  margin-right: 8px;
}

.error-message {
  margin-top: 20px;
}

.login-footer {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #e8e8e8;
  text-align: center;
}

.login-footer p {
  margin: 0;
  font-size: 12px;
  color: #999;
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

/* 响应式 */
@media (max-width: 768px) {
  .login-box {
    width: 90%;
    max-width: 400px;
  }

  .login-header {
    padding: 30px 20px;
  }

  .login-content {
    padding: 30px 20px;
  }
}
</style>
