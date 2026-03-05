/**
 * 发票操作相关逻辑
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import {
  validateFile,
  validateInvoiceDate,
  validateInvoiceDuplicate,
  validateInvoiceAmount,
} from './useInvoiceValidation'
import { UPLOAD_CONFIG } from '@/utils/reimbursement/constants'

// 发票明细类型定义
export interface InvoiceItem {
  id: number
  amount: number
  invoiceDate: string
  invoiceNumber: string
  category?: string // 报销类型
  filePath: string
  fileUid: string | number
  deductedAmount?: number // 核减金额
  actualAmount?: number // 实际报销金额
}

// OCR 识别结果
export interface OcrResult {
  amount: number
  date: string
  invoiceNumber: string
  type?: string // 报销类型
}

// 上传响应
export interface UploadResponse {
  success: boolean
  message?: string
  data?: {
    filePath: string
    ocrResult?: OcrResult
  }
}

/**
 * 发票管理 composable
 */
export function useInvoice() {
  // 发票明细列表
  const invoiceList = ref<InvoiceItem[]>([])
  // 文件列表（用于 el-upload）
  const fileList = ref<any[]>([])
  // 发票ID计数器
  let invoiceIdCounter = 0

  // 计算总金额（使用实际报销金额）
  const totalAmount = computed(() => {
    return invoiceList.value.reduce((sum, item) => sum + (item.actualAmount || item.amount || 0), 0)
  })

  // 计算总核减金额
  const totalDeductedAmount = computed(() => {
    return invoiceList.value.reduce((sum, item) => sum + (item.deductedAmount || 0), 0)
  })

  // 获取所有发票号码（用于重复校验）
  const invoiceNumbers = computed(() => {
    return invoiceList.value.map(inv => inv.invoiceNumber).filter(Boolean)
  })

  /**
   * 格式化日期为中文格式 (YYYY年M月D日)
   */
  function formatDateToChinese(dateStr: string): string {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${year}年${month}月${day}日`
  }

  /**
   * 上传前校验
   */
  function beforeUpload(file: File): boolean {
    const result = validateFile(file, UPLOAD_CONFIG.MAX_FILE_SIZE)
    if (!result.valid) {
      ElMessage.error(result.message)
      return false
    }
    return true
  }

  /**
   * 处理文件变化 - 上传并OCR识别
   */
  async function handleFileChange(file: any, fileListParam: any[]): Promise<void> {
    // 校验文件格式
    const fileName = file.name?.toLowerCase() || ''
    const isImageFile =
      fileName.endsWith('.jpg') ||
      fileName.endsWith('.jpeg') ||
      fileName.endsWith('.png') ||
      fileName.endsWith('.gif') ||
      fileName.endsWith('.bmp')

    if (isImageFile) {
      ElMessage.error('请上传正确格式的发票')
      removeFromFileList(file.uid, fileListParam)
      return
    }

    if (file.raw && file.raw.type !== 'application/pdf') {
      ElMessage.error('仅支持PDF文件，单个文件不超过5M')
      removeFromFileList(file.uid, fileListParam)
      return
    }

    // 调用后端API进行发票OCR识别
    try {
      ElMessage.info(`正在识别发票 ${file.name}...`)

      const uploadFormData = new FormData()
      uploadFormData.append('invoice', file.raw)
      uploadFormData.append('originalFileName', file.name)

      const response = await fetch('/api/reimbursement/upload-invoice', {
        method: 'POST',
        body: uploadFormData,
        credentials: 'include',
      })

      const result: UploadResponse = await response.json()

      if (result.success && result.data?.ocrResult) {
        const { amount, date, invoiceNumber, type } = result.data.ocrResult

        // 检查是否为模拟数据
        const isMockData = invoiceNumber && invoiceNumber.toString().startsWith('MOCK-')
        if (isMockData) {
          ElMessage.warning('未配置OCR服务，使用模拟数据')
        }

        // 校验金额
        const amountResult = validateInvoiceAmount(amount)
        if (!amountResult.valid) {
          ElMessage.error(amountResult.message)
          removeFromFileList(file.uid, fileListParam)
          return
        }

        // 校验重复
        const duplicateResult = validateInvoiceDuplicate(invoiceNumber, invoiceNumbers.value)
        if (!duplicateResult.valid) {
          ElMessage.warning(duplicateResult.message)
          removeFromFileList(file.uid, fileListParam)
          return
        }

        // 校验日期
        const dateResult = validateInvoiceDate(date)
        if (!dateResult.valid) {
          ElMessage.error(dateResult.message)
          removeFromFileList(file.uid, fileListParam)
          return
        }

        // 添加发票到列表
        addInvoice({
          amount: amount || 0,
          invoiceDate: date || '',
          invoiceNumber: invoiceNumber || '',
          category: type || '', // 添加报销类型
          filePath: result.data.filePath || '',
          fileUid: file.uid,
        })

        ElMessage.success(`${file.name} 识别成功！`)

        // 保存文件路径供后续提交使用
        file.serverPath = result.data.filePath
      } else {
        ElMessage.error(`${file.name} 识别失败：${result.message || '未知错误'}`)
        removeFromFileList(file.uid, fileListParam)
      }
    } catch (error) {
      console.error('发票识别失败:', error)
      ElMessage.error(`${file.name} 识别失败，请重新上传`)
      removeFromFileList(file.uid, fileListParam)
    }
  }

  /**
   * 从文件列表中移除
   */
  function removeFromFileList(uid: string | number, fileListParam: any[]): void {
    const index = fileListParam.findIndex(f => f.uid === uid)
    if (index > -1) {
      fileListParam.splice(index, 1)
    }
  }

  /**
   * 添加发票
   */
  function addInvoice(invoice: Omit<InvoiceItem, 'id' | 'deductedAmount' | 'actualAmount'>): void {
    invoiceIdCounter++

    // 先不计算核减，添加到列表后统一计算
    invoiceList.value.push({
      id: invoiceIdCounter,
      ...invoice,
      deductedAmount: 0,
      actualAmount: invoice.amount,
    })

    // 重新计算所有发票的核减金额
    recalculateDeductions()
  }

  /**
   * 重新计算核减金额
   * 对于基础报销，运输服务、汽油、柴油类发票合计限额1500元
   */
  function recalculateDeductions(): void {
    // 找出所有运输服务、汽油、柴油类发票
    const transportAndFuelInvoices = invoiceList.value.filter(inv => {
      const category = inv.category?.toLowerCase() || ''
      return (
        category.includes('运输') ||
        category.includes('运输服务') ||
        category.includes('汽油') ||
        category.includes('柴油') ||
        category.includes('transport') ||
        category.includes('gas') ||
        category.includes('diesel')
      )
    })

    // 计算这些发票的总金额
    const totalTransportAndFuelAmount = transportAndFuelInvoices.reduce(
      (sum, inv) => sum + inv.amount,
      0
    )

    // 如果总金额超过1500，需要核减
    if (totalTransportAndFuelAmount > 1500) {
      // 使用整数（分）计算，避免浮点精度问题
      const totalAmountCents = Math.round(totalTransportAndFuelAmount * 100)
      const totalDeductionCents = totalAmountCents - 150000
      let allocatedDeductionCents = 0

      transportAndFuelInvoices.forEach((inv, index) => {
        if (index === transportAndFuelInvoices.length - 1) {
          // 最后一张发票承担剩余核减，确保总核减精确
          const deductionCents = totalDeductionCents - allocatedDeductionCents
          inv.deductedAmount = deductionCents / 100
          inv.actualAmount = inv.amount - inv.deductedAmount
        } else {
          const proportion = inv.amount / totalTransportAndFuelAmount
          const deductionCents = Math.round(totalDeductionCents * proportion)
          allocatedDeductionCents += deductionCents
          inv.deductedAmount = deductionCents / 100
          inv.actualAmount = inv.amount - inv.deductedAmount
        }
      })
    } else {
      // 如果不超过1500，清除核减
      transportAndFuelInvoices.forEach(inv => {
        inv.deductedAmount = 0
        inv.actualAmount = inv.amount
      })
    }

    // 其他类型的发票不核减
    const otherInvoices = invoiceList.value.filter(inv => {
      const category = inv.category?.toLowerCase() || ''
      return !(
        category.includes('运输') ||
        category.includes('运输服务') ||
        category.includes('汽油') ||
        category.includes('柴油') ||
        category.includes('transport') ||
        category.includes('gas') ||
        category.includes('diesel')
      )
    })

    otherInvoices.forEach(inv => {
      inv.deductedAmount = 0
      inv.actualAmount = inv.amount
    })
  }

  /**
   * 删除发票（通过文件）
   */
  function deleteInvoiceByFile(fileUid: string | number): void {
    // 从文件列表中移除
    const fileIndex = fileList.value.findIndex(f => f.uid === fileUid)
    if (fileIndex > -1) {
      fileList.value.splice(fileIndex, 1)
    }
    // 从发票列表中移除
    const invoiceIndex = invoiceList.value.findIndex(inv => inv.fileUid === fileUid)
    if (invoiceIndex > -1) {
      invoiceList.value.splice(invoiceIndex, 1)
      // 重新计算核减金额
      recalculateDeductions()
    }
  }

  /**
   * 删除发票（通过发票ID）
   */
  function deleteInvoiceById(invoiceId: number): void {
    const invoice = invoiceList.value.find(inv => inv.id === invoiceId)
    if (invoice) {
      // 从文件列表中移除
      const fileIndex = fileList.value.findIndex(f => f.uid === invoice.fileUid)
      if (fileIndex > -1) {
        fileList.value.splice(fileIndex, 1)
      }
      // 从发票列表中移除
      const invoiceIndex = invoiceList.value.findIndex(inv => inv.id === invoiceId)
      if (invoiceIndex > -1) {
        invoiceList.value.splice(invoiceIndex, 1)
        // 重新计算核减金额
        recalculateDeductions()
      }
    }
  }

  /**
   * 处理文件删除（el-upload 的 on-remove 回调）
   */
  function handleFileRemove(file: any): void {
    const invoiceIndex = invoiceList.value.findIndex(inv => inv.fileUid === file.uid)
    if (invoiceIndex > -1) {
      invoiceList.value.splice(invoiceIndex, 1)
      // 重新计算核减金额
      recalculateDeductions()
    }
  }

  /**
   * 处理文件预览
   */
  function handlePreview(file: any): void {
    if (file.serverPath) {
      window.open(file.serverPath, '_blank')
    } else if (file.url) {
      window.open(file.url, '_blank')
    }
  }

  /**
   * 加载已有发票数据
   */
  function loadInvoices(invoices: any[]): void {
    invoiceList.value = invoices.map((inv, index) => ({
      id: index + 1,
      amount: inv.amount,
      invoiceDate: inv.invoiceDate,
      invoiceNumber: inv.invoiceNumber,
      filePath: inv.filePath,
      fileUid: `existing-${index}`,
    }))

    fileList.value = invoices.map((inv, index) => ({
      uid: `existing-${index}`,
      name: inv.filePath.split('/').pop() || '发票文件',
      url: inv.filePath,
      serverPath: inv.filePath,
      status: 'success',
    }))

    invoiceIdCounter = invoices.length
  }

  /**
   * 清空所有发票
   */
  function clearInvoices(): void {
    invoiceList.value = []
    fileList.value = []
    invoiceIdCounter = 0
  }

  /**
   * 获取用于提交的发票数据
   */
  function getInvoicesForSubmit(): Omit<InvoiceItem, 'id' | 'fileUid'>[] {
    return invoiceList.value.map(inv => ({
      amount: inv.amount,
      invoiceDate: inv.invoiceDate,
      invoiceNumber: inv.invoiceNumber,
      category: inv.category,
      filePath: inv.filePath,
      deductedAmount: inv.deductedAmount || 0,
      actualAmount: inv.actualAmount || inv.amount,
    }))
  }

  return {
    // 状态
    invoiceList,
    fileList,
    totalAmount,
    totalDeductedAmount,
    invoiceNumbers,

    // 方法
    formatDateToChinese,
    beforeUpload,
    handleFileChange,
    deleteInvoiceByFile,
    deleteInvoiceById,
    handleFileRemove,
    handlePreview,
    loadInvoices,
    clearInvoices,
    getInvoicesForSubmit,
  }
}
