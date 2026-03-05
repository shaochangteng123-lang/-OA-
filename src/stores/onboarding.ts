import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/utils/api'

// 入职文件模板（从后端获取）
export interface OnboardingTemplate {
  id: string
  file_type: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  uploaded_by_name: string | null
  created_at: string
}

// 入职文件类型（前端展示用）
export interface OnboardingFile {
  id: string
  name: string
  children?: string[]
  files: { id: string; name: string; url: string; uploadTime: string }[]
}

// 入职文件类型配置
const FILE_TYPE_CONFIG = [
  { id: 'invitation', name: '邀请函' },
  { id: 'application', name: '入职申请表' },
  { id: 'contract', name: '劳动合同' },
  { id: 'nda', name: '保密协议' },
  { id: 'declaration', name: '个人声明' },
  { id: 'asset', name: '固定资产交接单' },
  {
    id: 'personal',
    name: '个人入职材料',
    children: [
      '身份证复印件',
      '入职体检报告',
      '学历证书复印件',
      '工资卡复印件（中国工商银行）',
    ],
  },
]

export const useOnboardingStore = defineStore('onboarding', () => {
  // 从后端获取的模板列表
  const templates = ref<OnboardingTemplate[]>([])
  const loading = ref(false)

  // 入职文件列表（合并配置和后端数据）
  const onboardingFiles = computed<OnboardingFile[]>(() => {
    return FILE_TYPE_CONFIG.map(config => {
      // 找到该类型的所有模板文件
      const typeTemplates = templates.value.filter(t => t.file_type === config.id)
      return {
        id: config.id,
        name: config.name,
        children: config.children,
        files: typeTemplates.map(t => ({
          id: t.id,
          name: t.file_name,
          url: `/api/employees/onboarding/templates/${t.id}/download`,
          uploadTime: t.created_at,
        })),
      }
    })
  })

  // 已完成文件数量
  const completedFileCount = computed(() => {
    return onboardingFiles.value.filter(f => f.files.length > 0).length
  })

  // 文件完成进度
  const fileCompletionProgress = computed(() => {
    if (onboardingFiles.value.length === 0) return 0
    return Math.round((completedFileCount.value / onboardingFiles.value.length) * 100)
  })

  // 从后端获取模板列表
  async function fetchTemplates() {
    loading.value = true
    try {
      const res = await api.get('/api/employees/onboarding/templates')
      if (res.data.success) {
        templates.value = res.data.data
      }
    } catch (error) {
      console.error('获取入职文件模板失败:', error)
    } finally {
      loading.value = false
    }
  }

  // 上传文件
  async function uploadFile(fileTypeId: string, file: File) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('file_type', fileTypeId)
    formData.append('originalFileName', file.name)

    try {
      const res = await api.post('/api/employees/onboarding/templates', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      if (res.data.success) {
        // 重新获取模板列表
        await fetchTemplates()
        return { success: true, data: res.data.data }
      }
      return { success: false, message: res.data.message }
    } catch (error: any) {
      console.error('上传入职文件模板失败:', error)
      return { success: false, message: error.response?.data?.message || '上传失败' }
    }
  }

  // 删除文件
  async function removeFile(templateId: string) {
    try {
      const res = await api.delete(`/api/employees/onboarding/templates/${templateId}`)
      if (res.data.success) {
        // 重新获取模板列表
        await fetchTemplates()
        return { success: true }
      }
      return { success: false, message: res.data.message }
    } catch (error: any) {
      console.error('删除入职文件模板失败:', error)
      return { success: false, message: error.response?.data?.message || '删除失败' }
    }
  }

  return {
    templates,
    loading,
    onboardingFiles,
    completedFileCount,
    fileCompletionProgress,
    fetchTemplates,
    uploadFile,
    removeFile,
  }
})
