<template>
  <div class="yl-page">
    <!-- 页面头部 -->
    <div class="yl-page-header">
      <div class="yl-page-title">
        <el-icon :size="24" color="var(--yl-primary)">
          <User />
        </el-icon>
        <h1>用户设置</h1>
      </div>
    </div>

    <!-- 用户信息卡片 -->
    <el-card class="settings-section">
      <template #header>
        <div class="section-header">
          <el-icon><UserFilled /></el-icon>
          <span>个人信息</span>
        </div>
      </template>
      <div class="user-profile">
        <el-avatar :src="user?.avatarUrl || undefined" :size="80">
          <el-icon :size="40"><User /></el-icon>
        </el-avatar>
        <div class="user-info">
          <h2>{{ user?.name || '未知用户' }}</h2>
          <p class="user-email">{{ user?.email || '无邮箱' }}</p>
          <el-tag :type="getRoleTagType(user?.role)" size="small">
            {{ getRoleText(user?.role) }}
          </el-tag>
        </div>
      </div>
    </el-card>

    <!-- 日历偏好设置 -->
    <el-card class="settings-section">
      <template #header>
        <div class="section-header">
          <el-icon><Calendar /></el-icon>
          <span>日历偏好</span>
        </div>
      </template>
      <el-form label-width="120px" v-loading="loading">
        <el-form-item label="默认视图">
          <el-radio-group v-model="preferences.calendarViewMode" @change="savePreferences">
            <el-radio-button value="month">月视图</el-radio-button>
            <el-radio-button value="week">周视图</el-radio-button>
            <el-radio-button value="day">日视图</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="周视图天数">
          <el-radio-group v-model="preferences.weekDisplayDays" @change="savePreferences">
            <el-radio-button :value="5">5天（工作日）</el-radio-button>
            <el-radio-button :value="7">7天（全周）</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 颜色标签设置 -->
    <el-card class="settings-section">
      <template #header>
        <div class="section-header">
          <el-icon><PriceTag /></el-icon>
          <span>颜色标签</span>
          <el-button size="small" @click="resetLabels" class="section-action">恢复默认</el-button>
        </div>
      </template>
      <div class="color-labels" v-loading="loading">
        <div v-for="(label, index) in preferences.colorLabels" :key="label.id" class="color-label-item">
          <el-color-picker v-model="label.color" size="small" @change="savePreferences" />
          <el-input
            v-model="label.name"
            placeholder="标签名称"
            size="small"
            @blur="savePreferences"
            style="width: 120px"
          />
          <el-button
            :icon="Delete"
            size="small"
            type="danger"
            plain
            circle
            @click="removeLabel(index)"
            :disabled="preferences.colorLabels.length <= 1"
          />
        </div>
        <el-button
          :icon="Plus"
          size="small"
          @click="addLabel"
          :disabled="preferences.colorLabels.length >= 10"
        >
          添加标签
        </el-button>
      </div>
    </el-card>

    <!-- 账号操作 -->
    <el-card class="settings-section">
      <template #header>
        <div class="section-header">
          <el-icon><Setting /></el-icon>
          <span>账号操作</span>
        </div>
      </template>
      <div class="account-actions">
        <el-button type="danger" plain @click="handleLogout">
          <el-icon><SwitchButton /></el-icon>
          退出登录
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  User,
  UserFilled,
  Calendar,
  PriceTag,
  Setting,
  SwitchButton,
  Plus,
  Delete,
} from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'
import type { ElementPlusTagType } from '@/types'

interface ColorLabel {
  id: string
  name: string
  color: string
  order: number
}

const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)

const user = computed(() => authStore.user)

const preferences = reactive({
  calendarViewMode: 'week',
  weekDisplayDays: 7,
  colorLabels: [] as ColorLabel[],
})

function getRoleTagType(role?: string): ElementPlusTagType {
  const roleMap: Record<string, ElementPlusTagType> = {
    super_admin: 'danger',
    admin: 'warning',
    user: 'primary',
    guest: 'info',
  }
  return roleMap[role || ''] || 'info'
}

function getRoleText(role?: string) {
  const roleMap: Record<string, string> = {
    super_admin: '超级管理员',
    admin: '管理员',
    user: '普通用户',
    guest: '访客',
  }
  return roleMap[role || ''] || '未知'
}

async function loadPreferences() {
  loading.value = true
  try {
    const res = await api.get('/api/user-preferences')
    if (res.data.success) {
      preferences.calendarViewMode = res.data.data.calendarViewMode || 'week'
      preferences.weekDisplayDays = res.data.data.weekDisplayDays || 7
      preferences.colorLabels = res.data.data.colorLabels || []
    }
  } catch {
    ElMessage.error('加载偏好设置失败')
  } finally {
    loading.value = false
  }
}

async function savePreferences() {
  try {
    await api.put('/api/user-preferences', {
      calendarViewMode: preferences.calendarViewMode,
      weekDisplayDays: preferences.weekDisplayDays,
      colorLabels: preferences.colorLabels,
    })
    ElMessage.success('设置已保存')
  } catch {
    ElMessage.error('保存设置失败')
  }
}

async function resetLabels() {
  try {
    const res = await api.post('/api/user-preferences/reset-labels')
    if (res.data.success) {
      preferences.colorLabels = res.data.data
      ElMessage.success('已恢复默认标签')
    }
  } catch {
    ElMessage.error('重置失败')
  }
}

function addLabel() {
  const newId = `label-${Date.now()}`
  preferences.colorLabels.push({
    id: newId,
    name: '新标签',
    color: '#409eff',
    order: preferences.colorLabels.length,
  })
  savePreferences()
}

function removeLabel(index: number) {
  preferences.colorLabels.splice(index, 1)
  savePreferences()
}

async function handleLogout() {
  try {
    await authStore.logout()
    router.push('/login')
    ElMessage.success('已退出登录')
  } catch {
    ElMessage.error('退出登录失败')
  }
}

onMounted(() => {
  loadPreferences()
})
</script>

<style scoped>
.settings-section {
  margin-bottom: var(--yl-margin-lg);
}

.section-header {
  display: flex;
  align-items: center;
  gap: var(--yl-gap-sm);
  font-weight: var(--yl-font-weight-semibold);
}

.section-action {
  margin-left: auto;
}

.user-profile {
  display: flex;
  align-items: center;
  gap: var(--yl-gap-lg);
}

.user-info h2 {
  margin: 0 0 4px 0;
  font-size: var(--yl-font-size-xl);
  font-weight: var(--yl-font-weight-semibold);
}

.user-email {
  margin: 0 0 8px 0;
  color: var(--yl-text-secondary);
  font-size: var(--yl-font-size-small);
}

.color-labels {
  display: flex;
  flex-direction: column;
  gap: var(--yl-gap-sm);
}

.color-label-item {
  display: flex;
  align-items: center;
  gap: var(--yl-gap-sm);
}

.account-actions {
  display: flex;
  gap: var(--yl-gap-md);
}

@media (max-width: 768px) {
  .user-profile {
    flex-direction: column;
    text-align: center;
  }
}
</style>
