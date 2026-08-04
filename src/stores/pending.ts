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
  // 当前用户：轮到本人签署的转正申请
  probationSignaturePending: number
  // Admin: 实习期到期前 30 天提醒
  probationDueSoon: number
  // Admin: 转正审批完成但尚未上传正式盖章档案
  probationArchivePending: number
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
  // 用户: 离职待办
  myResignationPending: number
  myHandoverPending: number
  // 用户: 当前劳动合同信息（用于资料同步与到期提醒）
  myHireDate: string | null
  myContractEndDate: string | null
  myEmploymentStatus: string | null
  // 管理员/超级管理员：离职档案待完善或待确认
  resignationPending: number
  // 总经理或董事长：分配给本人的请假待审批
  leaveApprovalPending: number
  // 用户: 请假被驳回后待修改重提
  myLeaveRejected: number
  // 用户: 尚未查看的请假审批通过结果
  myLeaveApproved: number
  // 用户: 未读日志评论
  unreadLogComments: number
  // GM/Admin: 未读团队日志回复
  unreadTeamLogReplies: number
}

export const usePendingStore = defineStore('pending', () => {
  const counts = ref<PendingCounts>({
    approvalPending: 0,
    gmApprovalPending: 0,
    probationPending: 0,
    probationSignaturePending: 0,
    probationDueSoon: 0,
    probationArchivePending: 0,
    myReimbursementBasic: 0,
    myReimbursementLarge: 0,
    myReimbursementBusiness: 0,
    myReimbursementBasicRejected: 0,
    myReimbursementLargeRejected: 0,
    myReimbursementBusinessRejected: 0,
    myProbationPending: false,
    myResignationPending: 0,
    myHandoverPending: 0,
    myHireDate: null,
    myContractEndDate: null,
    myEmploymentStatus: null,
    resignationPending: 0,
    leaveApprovalPending: 0,
    myLeaveRejected: 0,
    myLeaveApproved: 0,
    unreadLogComments: 0,
    unreadTeamLogReplies: 0
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

  // 启动轮询（每3秒自动刷新）
  function startPolling() {
    stopPolling()
    pollingTimer = window.setInterval(() => {
      fetchPendingCounts()
    }, 3000) // 3秒
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
    stopPolling
  }
})
