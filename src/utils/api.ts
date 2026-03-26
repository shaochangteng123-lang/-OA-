import axios from 'axios'
import { ElMessage } from 'element-plus'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    if (error.response) {
      // 对于检查会话的 401 错误，静默处理
      const isCheckSessionRequest =
        error.config?.url === '/api/auth/user' && error.config?.method === 'get'

      switch (error.response.status) {
        case 401:
          // 如果是检查会话请求，不显示错误提示和重定向
          if (!isCheckSessionRequest) {
            ElMessage.error('未登录或登录已过期，请重新登录')
            // 避免在已经在登录页时重复重定向
            if (window.location.pathname !== '/login') {
              window.location.href = '/login'
            }
          }
          break
        case 403:
          ElMessage.error('没有权限访问该资源')
          break
        case 404:
          ElMessage.error('请求的资源不存在')
          break
        case 500:
          ElMessage.error('服务器错误，请稍后重试')
          break
        default:
          // 400 错误由业务代码自行处理，不在拦截器中重复提示
          if (error.response.status !== 400) {
            ElMessage.error(error.response.data?.message || '请求失败')
          }
      }
    } else if (error.request) {
      // 后台轮询请求网络错误时静默处理，避免干扰用户操作
      const silentUrls = ['/api/approval/pending-counts', '/api/auth/user']
      const requestUrl = error.config?.url || ''
      if (!silentUrls.some(url => requestUrl.includes(url))) {
        ElMessage.error('网络错误，请检查网络连接')
      }
    } else {
      ElMessage.error('请求配置错误')
    }
    return Promise.reject(error)
  }
)
