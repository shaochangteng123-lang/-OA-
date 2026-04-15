import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/utils/api'

export type ResignationTemplateType =
  | 'application_form'
  | 'handover_form'
  | 'termination_proof'
  | 'asset_handover'
  | 'compensation_agreement'
  | 'expense_settlement_agreement'
  | 'partner_dividend_settlement'
export type ResignationType = 'voluntary' | 'contract_end' | 'dismissal'
export type ResignationStatus = 'draft' | 'submitted' | 'handover_confirmed' | 'mutual_confirmed' | 'approved' | 'rejected' | 'handover_rejected'
export type ResignationDocumentType =
  | 'application_form'
  | 'handover_form_employee'
  | 'handover_form_handover'
  | 'termination_proof'
  | 'asset_handover'
  | 'compensation_agreement'
  | 'expense_settlement_agreement'

export interface ResignationTemplate {
  id: string
  template_type: ResignationTemplateType
  name: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  uploaded_by_name: string | null
  created_at: string
}

export interface ResignationDocument {
  id: string
  request_id: string
  document_type: ResignationDocumentType
  uploader_role: 'employee' | 'handover' | 'admin'
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  uploaded_by_name: string | null
  created_at: string
}

export interface ResignationRequest {
  id: string
  employee_id: string
  employee_user_id: string
  handover_user_id: string
  handover_name: string | null
  resign_type: ResignationType
  resign_date: string
  reason: string | null
  status: ResignationStatus
  reject_target: 'employee' | 'handover' | 'both' | null
  employee_confirm_time: string | null
  handover_confirm_time: string | null
  submit_time: string | null
  approve_time: string | null
  approver_id: string | null
  approver_comment: string | null
  created_at: string
  updated_at: string
  employee_name?: string
  employee_department?: string | null
  employee_position?: string | null
  employee_mobile?: string | null
}

export interface HandoverCandidate {
  id: string
  name: string
  department: string | null
  position: string | null
}

export interface MyResignationData {
  profile: {
    id: string
    name: string
    department: string | null
    position: string | null
    mobile: string | null
    employment_status: string | null
  } | null
  request: ResignationRequest | null
  documents: ResignationDocument[]
  templates: ResignationTemplate[]
}

export interface ResignationDetailData {
  request: ResignationRequest
  documents: ResignationDocument[]
  templates: ResignationTemplate[]
  requiredDocumentTypes: ResignationDocumentType[]
  missingDocumentTypes: ResignationDocumentType[]
}

export const useResignationStore = defineStore('resignation', () => {
  const myData = ref<MyResignationData | null>(null)
  const myDataLoading = ref(false)
  const templates = ref<ResignationTemplate[]>([])
  const templatesLoading = ref(false)
  const handoverTasks = ref<Array<ResignationRequest & { documents?: ResignationDocument[] }>>([])
  const handoverTasksLoading = ref(false)
  const completedHandoverTasks = ref<Array<ResignationRequest & { documents?: ResignationDocument[] }>>([])
  const managementList = ref<Array<ResignationRequest & { documents?: ResignationDocument[] }>>([])
  const managementLoading = ref(false)
  const candidates = ref<HandoverCandidate[]>([])
  const detail = ref<ResignationDetailData | null>(null)
  const detailLoading = ref(false)

  const myRequest = computed(() => myData.value?.request || null)
  const myDocuments = computed(() => myData.value?.documents || [])
  const myTemplates = computed(() => myData.value?.templates || templates.value)

  async function fetchTemplates() {
    templatesLoading.value = true
    try {
      const res = await api.get('/api/resignation/templates')
      if (res.data.success) {
        templates.value = res.data.data
      }
    } finally {
      templatesLoading.value = false
    }
  }

  async function fetchMyRequest() {
    myDataLoading.value = true
    try {
      const res = await api.get('/api/resignation/my-request')
      if (res.data.success) {
        myData.value = res.data.data
      }
    } finally {
      myDataLoading.value = false
    }
  }

  async function fetchHandoverTasks() {
    handoverTasksLoading.value = true
    try {
      const [pendingRes, completedRes] = await Promise.all([
        api.get('/api/resignation/handover-task'),
        api.get('/api/resignation/handover-task/completed'),
      ])
      if (pendingRes.data.success) {
        handoverTasks.value = pendingRes.data.data
      }
      if (completedRes.data.success) {
        completedHandoverTasks.value = completedRes.data.data
      }
    } finally {
      handoverTasksLoading.value = false
    }
  }

  async function fetchCandidates() {
    const res = await api.get('/api/resignation/handover-candidates')
    if (res.data.success) {
      candidates.value = res.data.data
    }
  }

  async function saveMyRequest(payload: {
    handover_user_id: string
    resign_type: string
    resign_date: string
    reason?: string
  }) {
    const res = await api.post('/api/resignation/my-request', payload)
    if (res.data.success) {
      await fetchMyRequest()
      await fetchHandoverTasks()
    }
    return res.data
  }

  async function uploadMyApplication(requestId: string, file: File, documentType: ResignationDocumentType = 'application_form') {
    const formData = new FormData()
    formData.append('requestId', requestId)
    formData.append('document_type', documentType)
    formData.append('originalFileName', file.name)
    formData.append('file', file)
    const res = await api.post('/api/resignation/my-request/upload-application', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    if (res.data.success) await fetchMyRequest()
    return res.data
  }

  async function uploadMyHandover(requestId: string, file: File, documentType: ResignationDocumentType = 'handover_form_employee') {
    const formData = new FormData()
    formData.append('requestId', requestId)
    formData.append('document_type', documentType)
    formData.append('originalFileName', file.name)
    formData.append('file', file)
    const res = await api.post('/api/resignation/my-request/upload-handover', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    if (res.data.success) await fetchMyRequest()
    return res.data
  }

  // 通用文档上传 - 用于上传补充材料
  async function uploadMyDocument(requestId: string, file: File, documentType: ResignationDocumentType) {
    const formData = new FormData()
    formData.append('requestId', requestId)
    formData.append('document_type', documentType)
    formData.append('originalFileName', file.name)
    formData.append('file', file)
    const res = await api.post('/api/resignation/my-request/upload-document', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    if (res.data.success) await fetchMyRequest()
    return res.data
  }

  // 删除已上传的文档
  async function deleteMyDocument(docId: string) {
    const res = await api.delete(`/api/resignation/my-request/documents/${docId}`)
    if (res.data.success) await fetchMyRequest()
    return res.data
  }

  async function submitMyRequest(requestId: string) {
    const res = await api.post('/api/resignation/my-request/submit', { requestId })
    if (res.data.success) {
      await fetchMyRequest()
      await fetchHandoverTasks()
    }
    return res.data
  }

  async function withdrawMyRequest(requestId: string) {
    const res = await api.post('/api/resignation/my-request/withdraw', { requestId })
    if (res.data.success) {
      await fetchMyRequest()
      await fetchHandoverTasks()
    }
    return res.data
  }

  async function deleteMyRequest() {
    const res = await api.delete('/api/resignation/my-request')
    if (res.data.success) {
      myData.value = null
      await fetchMyRequest()
      await fetchHandoverTasks()
    }
    return res.data
  }

  async function confirmMyRequest(requestId: string) {
    const res = await api.post('/api/resignation/my-request/confirm', { requestId })
    if (res.data.success) {
      await fetchMyRequest()
      await fetchHandoverTasks()
    }
    return res.data
  }

  async function uploadHandoverTask(requestId: string, file: File) {
    const formData = new FormData()
    formData.append('document_type', 'handover_form_handover')
    formData.append('originalFileName', file.name)
    formData.append('file', file)
    const res = await api.post(`/api/resignation/${requestId}/handover-upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    if (res.data.success) {
      await fetchMyRequest()
      await fetchHandoverTasks()
    }
    return res.data
  }

  async function confirmHandoverTask(requestId: string) {
    const res = await api.post(`/api/resignation/${requestId}/handover-confirm`)
    if (res.data.success) {
      await fetchMyRequest()
      await fetchHandoverTasks()
    }
    return res.data
  }

  async function deleteHandoverDocument(requestId: string, docId: string) {
    const res = await api.delete(`/api/resignation/${requestId}/handover-documents/${docId}`)
    if (res.data.success) {
      await fetchMyRequest()
      await fetchHandoverTasks()
    }
    return res.data
  }

  async function fetchDocumentHistory(requestId: string) {
    const res = await api.get(`/api/resignation/${requestId}/document-history`)
    return res.data
  }

  async function fetchAuditLogs(requestId: string) {
    const res = await api.get(`/api/resignation/${requestId}/audit-logs`)
    return res.data
  }

  async function signHandoverTask(requestId: string, signatureDataUrl: string) {
    const res = await api.post(`/api/resignation/${requestId}/handover-sign`, { signatureDataUrl })
    if (res.data.success) {
      await fetchMyRequest()
      await fetchHandoverTasks()
    }
    return res.data
  }

  async function fetchManagementList(status?: string) {
    managementLoading.value = true
    try {
      const res = await api.get('/api/resignation/management', { params: { status } })
      if (res.data.success) {
        managementList.value = res.data.data
      }
    } finally {
      managementLoading.value = false
    }
  }

  async function fetchDetail(id: string) {
    detailLoading.value = true
    try {
      const res = await api.get(`/api/resignation/management/${id}`)
      if (res.data.success) {
        detail.value = res.data.data
      }
      return res.data
    } finally {
      detailLoading.value = false
    }
  }

  async function approve(id: string, comment?: string) {
    const res = await api.post(`/api/resignation/management/${id}/approve`, { comment })
    if (res.data.success) {
      await fetchManagementList()
    }
    return res.data
  }

  async function reject(id: string, comment?: string, rejectTarget?: 'employee' | 'handover' | 'both') {
    const res = await api.post(`/api/resignation/management/${id}/reject`, { comment, rejectTarget })
    if (res.data.success) {
      await fetchManagementList()
    }
    return res.data
  }

  async function uploadTemplate(templateType: ResignationTemplateType, name: string, file: File) {
    const formData = new FormData()
    formData.append('template_type', templateType)
    formData.append('name', name)
    formData.append('originalFileName', file.name)
    formData.append('file', file)
    const res = await api.post('/api/resignation/templates', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    if (res.data.success) {
      await fetchTemplates()
      await fetchMyRequest()
      await fetchManagementList()
    }
    return res.data
  }

  async function deleteTemplate(id: string) {
    const res = await api.delete(`/api/resignation/templates/${id}`)
    if (res.data.success) {
      await fetchTemplates()
      await fetchMyRequest()
      await fetchManagementList()
    }
    return res.data
  }

  return {
    myData,
    myDataLoading,
    templates,
    templatesLoading,
    handoverTasks,
    handoverTasksLoading,
    completedHandoverTasks,
    managementList,
    managementLoading,
    candidates,
    detail,
    detailLoading,
    myRequest,
    myDocuments,
    myTemplates,
    fetchTemplates,
    fetchMyRequest,
    fetchHandoverTasks,
    fetchCandidates,
    saveMyRequest,
    uploadMyApplication,
    uploadMyHandover,
    uploadMyDocument,
    deleteMyDocument,
    submitMyRequest,
    withdrawMyRequest,
    deleteMyRequest,
    confirmMyRequest,
    uploadHandoverTask,
    confirmHandoverTask,
    deleteHandoverDocument,
    fetchDocumentHistory,
    fetchAuditLogs,
    signHandoverTask,
    fetchManagementList,
    fetchDetail,
    approve,
    reject,
    uploadTemplate,
    deleteTemplate,
  }
})
