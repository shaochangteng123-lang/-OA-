import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { User, Permission, ROLE_PERMISSIONS } from '@/types'
import { api } from '@/utils/api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const isLoggedIn = computed(() => !!user.value)

  // 检查会话
  async function checkSession() {
    try {
      const response = await api.get('/api/auth/user')
      if (response.data.success && response.data.data) {
        user.value = response.data.data
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

  // 登出
  async function logout() {
    try {
      await api.post('/api/auth/logout')
      user.value = null
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
    checkSession,
    logout,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
  }
})
