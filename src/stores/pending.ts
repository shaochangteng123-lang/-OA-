import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/utils/api'

// 待办计数数据结构
export interface PendingCounts {
  // Admin: 审批中心待办
  approvalPending: number
  // GM: 审批中心待办
  gmApprovalPending: number
  // Admin: 转正待审批
  probationPending: number
  // 用户: 报销待确认收款（按类型）
  myReimbursementBasic: number
  myReimbursementLarge: number
  myReimbursementBusiness: number
  // 用户: 报销已驳回（按类型）
  myReimbursementBasicRejected: number
  myReimbursementLargeRejected: number
  myReimbursementBusinessRejected: number
  // 用户: 转正待提交
  myProbationPending: boolean
}

export const usePendingStore = defineStore('pending', () => {
  const counts = ref<PendingCounts>({
    approvalPending: 0,
    gmApprovalPending: 0,
    probationPending: 0,
    myReimbursementBasic: 0,
    myReimbursementLarge: 0,
    myReimbursementBusiness: 0,
    myReimbursementBasicRejected: 0,
    myReimbursementLargeRejected: 0,
    myReimbursementBusinessRejected: 0,
    myProbationPending: false,
  })

  const loading = ref(false)
  let pollingTimer: number | null = null
  let isRefreshing = false // 防止重复刷新

  // 获取待办计数（移除防抖，确保每次都能立即执行）
  async function fetchPendingCounts() {
    // 如果正在刷新，跳过本次请求
    if (isRefreshing) return

    try {
      isRefreshing = true
      const res = await api.get('/api/approval/pending-counts')
      if (res.data.success) {
        counts.value = { ...counts.value, ...res.data.data }
      }
    } catch {
      // 静默失败，不影响页面
    } finally {
      isRefreshing = false
    }
  }

  // 刷新（业务操作后调用，立即请求）
  async function refreshPendingCounts() {
    await fetchPendingCounts()
  }

  // 启动轮询（每10秒自动刷新，更快响应）
  function startPolling() {
    stopPolling()
    pollingTimer = window.setInterval(() => {
      fetchPendingCounts()
    }, 10000) // 10秒
  }

  // 停止轮询
  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  return {
    counts,
    loading,
    fetchPendingCounts,
    refreshPendingCounts,
    startPolling,
    stopPolling,
  }
})
