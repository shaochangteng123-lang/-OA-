import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { User, Permission, ROLE_PERMISSIONS } from '@/types'
import { api } from '@/utils/api'

// 员工信息状态类型
type ProfileStatus = 'none' | 'draft' | 'submitted'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const isLoggedIn = computed(() => !!user.value)
  // 是否需要强制修改密码
  const forceChangePassword = computed(() => !!user.value?.forceChangePassword)

  // 员工信息状态
  const profileStatus = ref<ProfileStatus>('none')
  // 是否已完成入职信息填写（已提交状态）
  const hasCompletedOnboarding = computed(
    () => user.value?.role === 'boss' || profileStatus.value === 'submitted',
  )

  // 检查会话
  async function checkSession() {
    try {
      const response = await api.get('/api/auth/user')
      if (response.data.success && response.data.data) {
        user.value = response.data.data
        // BOSS账号仅用于经营看板，不建立员工档案。
        if (user.value?.role === 'boss') {
          profileStatus.value = 'none'
        } else {
          await fetchProfileStatus()
        }
        return true
      }
      return false
    } catch (error) {
      // 401 错误是正常的未登录状态，不需要打印错误
      // 只在非 401 错误时打印
      const axiosError = error as { response?: { status?: number } }
      if (axiosError?.response?.status !== 401) {
        console.error('检查会话失败:', error)
      }
      return false
    }
  }

  // 获取员工信息状态
  async function fetchProfileStatus() {
    if (user.value?.role === 'boss') {
      profileStatus.value = 'none'
      return
    }

    try {
      const response = await api.get('/api/employees/my-profile')
      if (response.data.success && response.data.data) {
        const status = response.data.data.status
        // status 为 null / undefined / 'none' 时均视为未填写
        profileStatus.value = (status === 'submitted' || status === 'draft') ? status : 'none'
      } else {
        // 没有员工信息记录
        profileStatus.value = 'none'
      }
    } catch (error) {
      console.error('获取员工信息状态失败:', error)
      profileStatus.value = 'none'
    }
  }

  // 登出
  async function logout() {
    try {
      await api.post('/api/auth/logout')
      user.value = null
      profileStatus.value = 'none'
      window.location.href = '/login'
    } catch (error) {
      console.error('登出失败:', error)
    }
  }

  // 检查权限
  function hasPermission(permission: Permission): boolean {
    if (!user.value) return false
    const permissions = ROLE_PERMISSIONS[user.value.role] || []
    return permissions.includes(permission)
  }

  // 检查是否有任一权限
  function hasAnyPermission(permissions: Permission[]): boolean {
    return permissions.some((p) => hasPermission(p))
  }

  // 检查是否有所有权限
  function hasAllPermissions(permissions: Permission[]): boolean {
    return permissions.every((p) => hasPermission(p))
  }

  return {
    user,
    isLoggedIn,
    forceChangePassword,
    profileStatus,
    hasCompletedOnboarding,
    checkSession,
    fetchProfileStatus,
    logout,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
  }
})
