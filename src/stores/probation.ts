import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/utils/api'

// 转正文件模板类型
export interface ProbationTemplate {
  id: string
  name: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  uploaded_by_name: string | null
  created_at: string
}

// 转正申请类型
export interface ProbationConfirmation {
  id: string
  employee_id: string
  hire_date: string
  probation_end_date: string
  status: 'pending' | 'submitted' | 'approved' | 'rejected'
  submit_time: string | null
  approve_time: string | null
  approver_id: string | null
  approver_comment: string | null
  application_comment: string | null
  created_at: string
  updated_at: string
}

// 转正申请（带员工信息）
export interface ProbationConfirmationWithEmployee extends ProbationConfirmation {
  employee_name: string
  employee_department: string | null
  employee_position: string | null
  employee_mobile: string | null
  employee_email?: string | null
  employee_hire_date?: string | null
  documents?: ProbationDocument[]
}

// 转正文件类型
export interface ProbationDocument {
  id: string
  confirmation_id: string
  document_type: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  uploaded_by_name: string | null
  created_at: string
}

// 转正统计数据
export interface ProbationStatistics {
  total: number
  pending: number
  submitted: number
  approved: number
  rejected: number
}

export const useProbationStore = defineStore('probation', () => {
  // 转正文件模板列表
  const templates = ref<ProbationTemplate[]>([])
  const templatesLoading = ref(false)

  // 待转正员工列表
  const confirmationList = ref<ProbationConfirmationWithEmployee[]>([])
  const confirmationListLoading = ref(false)
  const confirmationPagination = ref({
    page: 1,
    pageSize: 20,
    total: 0
  })

  // 统计数据
  const statistics = ref<ProbationStatistics>({
    total: 0,
    pending: 0,
    submitted: 0,
    approved: 0,
    rejected: 0
  })

  // 当前用户的转正状态
  const myStatus = ref<{
    profile: { id: string; hire_date: string; employment_status: string } | null
    confirmation: ProbationConfirmation | null
    hasHistory: boolean
    hasRealConfirmation: boolean
    documents: ProbationDocument[]
  } | null>(null)
  const myStatusLoading = ref(false)

  // 计算属性：是否有模板
  const hasTemplates = computed(() => templates.value.length > 0)

  // 计算属性：待审批数量
  const pendingCount = computed(() => statistics.value.submitted)

  // ==================== 模板管理 ====================

  // 获取模板列表
  async function fetchTemplates() {
    templatesLoading.value = true
    try {
      const res = await api.get('/api/probation/templates')
      if (res.data.success) {
        templates.value = res.data.data
      }
    } catch (error) {
      console.error('获取转正模板列表失败:', error)
    } finally {
      templatesLoading.value = false
    }
  }

  // 上传模板
  async function uploadTemplate(name: string, file: File) {
    const formData = new FormData()
    formData.append('name', name)
    formData.append('file', file)
    formData.append('originalFileName', file.name)

    const res = await api.post('/api/probation/templates', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    if (res.data.success) {
      await fetchTemplates()
    }
    return res.data
  }

  // 删除模板
  async function deleteTemplate(id: string) {
    const res = await api.delete(`/api/probation/templates/${id}`)
    if (res.data.success) {
      await fetchTemplates()
    }
    return res.data
  }

  // ==================== 转正申请管理 ====================

  // 获取待转正员工列表
  async function fetchConfirmationList(params?: { status?: string; page?: number; pageSize?: number }) {
    confirmationListLoading.value = true
    try {
      const res = await api.get('/api/probation/list', { params })
      if (res.data.success) {
        confirmationList.value = res.data.data.list
        confirmationPagination.value = {
          page: res.data.data.page,
          pageSize: res.data.data.pageSize,
          total: res.data.data.total
        }
      }
    } catch (error) {
      console.error('获取待转正员工列表失败:', error)
    } finally {
      confirmationListLoading.value = false
    }
  }

  // 获取统计数据
  async function fetchStatistics() {
    try {
      const res = await api.get('/api/probation/statistics')
      if (res.data.success) {
        statistics.value = res.data.data
      }
    } catch (error) {
      console.error('获取转正统计失败:', error)
    }
  }

  // 获取当前用户的转正状态
  async function fetchMyStatus() {
    myStatusLoading.value = true
    try {
      const res = await api.get('/api/probation/my-status')
      if (res.data.success) {
        myStatus.value = res.data.data
      }
    } catch (error) {
      console.error('获取转正状态失败:', error)
    } finally {
      myStatusLoading.value = false
    }
  }

  // 提交转正申请
  async function submitApplication() {
    const res = await api.post('/api/probation/apply')
    if (res.data.success) {
      await fetchMyStatus()
    }
    return res.data
  }

  // 上传转正申请书
  async function uploadDocument(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('originalFileName', file.name)

    const res = await api.post('/api/probation/upload-doc', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    if (res.data.success) {
      await fetchMyStatus()
    }
    return res.data
  }

  // 删除转正申请书
  async function deleteDocument(docId: string) {
    const res = await api.delete(`/api/probation/my-doc/${docId}`)
    if (res.data.success) {
      await fetchMyStatus()
    }
    return res.data
  }

  // 审批通过
  async function approveConfirmation(id: string, comment?: string) {
    const res = await api.post(`/api/probation/${id}/approve`, { comment })
    if (res.data.success) {
      await fetchConfirmationList()
      await fetchStatistics()
    }
    return res.data
  }

  // 拒绝申请
  async function rejectConfirmation(id: string, comment: string) {
    const res = await api.post(`/api/probation/${id}/reject`, { comment })
    if (res.data.success) {
      await fetchConfirmationList()
      await fetchStatistics()
    }
    return res.data
  }

  // 获取转正申请详情
  async function getConfirmationDetail(id: string) {
    const res = await api.get(`/api/probation/${id}`)
    return res.data
  }

  // 获取审批流程
  async function getApprovalFlow(id: string) {
    const res = await api.get(`/api/probation/${id}/approval-flow`)
    return res.data
  }

  return {
    // 状态
    templates,
    templatesLoading,
    confirmationList,
    confirmationListLoading,
    confirmationPagination,
    statistics,
    myStatus,
    myStatusLoading,

    // 计算属性
    hasTemplates,
    pendingCount,

    // 方法
    fetchTemplates,
    uploadTemplate,
    deleteTemplate,
    fetchConfirmationList,
    fetchStatistics,
    fetchMyStatus,
    submitApplication,
    uploadDocument,
    deleteDocument,
    approveConfirmation,
    rejectConfirmation,
    getConfirmationDetail,
    getApprovalFlow
  }
})
