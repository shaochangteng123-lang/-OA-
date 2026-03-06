/**
 * 报销单操作相关逻辑
 */
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { InvoiceItem } from './useInvoice'

// 报销单类型
export type ReimbursementType = 'basic' | 'large' | 'business'

// 报销单状态
export type ReimbursementStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'paying' | 'payment_uploaded' | 'completed'

// 报销单数据
export interface ReimbursementData {
  id?: number
  type: ReimbursementType
  category: string
  title: string
  description: string
  status: ReimbursementStatus
  invoices: Omit<InvoiceItem, 'id' | 'fileUid'>[]
}

// API 响应
export interface ApiResponse<T = any> {
  success: boolean
  message?: string
  data?: T
}

/**
 * 报销单管理 composable
 */
export function useReimbursement(type: ReimbursementType, listRoute: string) {
  const router = useRouter()
  const route = useRoute()

  // 报销单状态
  const reimbursementStatus = ref<ReimbursementStatus | ''>('')
  // 加载状态
  const loading = ref(false)

  // 获取报销单ID
  const reimbursementId = computed(() => route.params.id as string | undefined)

  // 获取页面模式：view（查看）、edit（编辑）、create（新建）
  const pageMode = computed(() => {
    if (!reimbursementId.value) return 'create'
    // 根据URL参数决定模式，查看模式始终只读
    return route.query.mode === 'view' ? 'view' : 'edit'
  })

  // 是否为只读模式
  const isReadonly = computed(() => pageMode.value === 'view')

  // 获取来源页面（用于返回）
  const fromPage = computed(() => route.query.from as string | undefined)

  // 获取来源页面的tab参数（用于返回时定位到正确的tab）
  const fromTab = computed(() => route.query.tab as string | undefined)

  // 计算报销月份（当前月份）
  const reimbursementMonth = computed(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    return `${year}年${month}月`
  })

  /**
   * 保存报销单（草稿或提交）
   */
  async function saveReimbursement(
    data: Omit<ReimbursementData, 'id'>,
    isDraft: boolean = true
  ): Promise<boolean> {
    loading.value = true

    try {
      const isUpdate = !!reimbursementId.value
      const url = isUpdate
        ? `/api/reimbursement/${reimbursementId.value}`
        : '/api/reimbursement/create'
      const method = isUpdate ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          ...data,
          status: isDraft ? 'draft' : 'pending',
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`${isDraft ? '保存草稿' : '提交审批'}失败 - HTTP错误:`, response.status, errorText)
        ElMessage.error(`${isDraft ? '保存' : '提交'}失败: ${response.status}`)
        return false
      }

      const result: ApiResponse = await response.json()

      if (result.success) {
        ElMessage.success(isDraft ? '草稿保存成功' : '提交成功')
        // 使用 goBack 方法返回，这样可以正确返回到来源页面
        goBack()
        return true
      } else {
        ElMessage.error(result.message || `${isDraft ? '保存' : '提交'}失败`)
        return false
      }
    } catch (error) {
      console.error(`${isDraft ? '保存草稿' : '提交'}失败 - 异常:`, error)
      ElMessage.error(`${isDraft ? '保存草稿' : '提交'}失败，请重试`)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * 保存草稿
   */
  async function saveDraft(data: Omit<ReimbursementData, 'id' | 'status'>): Promise<boolean> {
    return saveReimbursement({ ...data, status: 'draft' }, true)
  }

  /**
   * 提交审批
   */
  async function submitForApproval(data: Omit<ReimbursementData, 'id' | 'status'>): Promise<boolean> {
    return saveReimbursement({ ...data, status: 'pending' }, false)
  }

  /**
   * 加载报销单详情
   */
  async function loadReimbursementDetail(): Promise<ReimbursementData | null> {
    if (!reimbursementId.value) return null

    loading.value = true

    try {
      const response = await fetch(`/api/reimbursement/${reimbursementId.value}`, {
        credentials: 'include',
      })

      const result: ApiResponse<ReimbursementData> = await response.json()

      if (result.success && result.data) {
        reimbursementStatus.value = result.data.status || ''
        return result.data
      } else {
        ElMessage.error(result.message || '获取报销单详情失败')
        router.push(listRoute)
        return null
      }
    } catch (error) {
      console.error('获取报销单详情失败:', error)
      ElMessage.error('获取报销单详情失败')
      router.push(listRoute)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 返回列表页
   */
  function goBack(): void {
    // 如果有来源页面参数，返回到来源页面
    if (fromPage.value) {
      // 如果有tab参数，拼接到返回URL中
      const returnUrl = fromTab.value ? `${fromPage.value}?tab=${fromTab.value}` : fromPage.value
      router.push(returnUrl)
    } else {
      router.push(listRoute)
    }
  }

  /**
   * 生成报销单标题
   */
  function generateTitle(categoryLabel: string, prefix: string = ''): string {
    const typePrefix = prefix || (type === 'large' ? '大额报销' : '报销')
    return `${reimbursementMonth.value}${typePrefix}${categoryLabel ? '-' + categoryLabel : ''}`
  }

  return {
    // 状态
    reimbursementStatus,
    loading,
    reimbursementId,
    pageMode,
    isReadonly,
    reimbursementMonth,

    // 方法
    saveDraft,
    submitForApproval,
    loadReimbursementDetail,
    goBack,
    generateTitle,
  }
}
