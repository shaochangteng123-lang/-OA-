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
  filePath: string
  fileUid: string | number
}

// OCR 识别结果
export interface OcrResult {
  amount: number
  date: string
  invoiceNumber: string
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
export function useInvoice(maxFiles: number = UPLOAD_CONFIG.BASIC_MAX_FILES) {
  // 发票明细列表
  const invoiceList = ref<InvoiceItem[]>([])
  // 文件列表（用于 el-upload）
  const fileList = ref<any[]>([])
  // 发票ID计数器
  let invoiceIdCounter = 0

  // 计算总金额
  const totalAmount = computed(() => {
    return invoiceList.value.reduce((sum, item) => sum + (item.amount || 0), 0)
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
   * 处理文件超出限制
   */
  function handleExceed(): void {
    ElMessage.warning(`最多只能上传${maxFiles}个发票文件`)
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
      ElMessage.info('正在识别发票信息...')

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
        const { amount, date, invoiceNumber } = result.data.ocrResult

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
          filePath: result.data.filePath || '',
          fileUid: file.uid,
        })

        ElMessage.success('发票识别成功！已添加到发票明细')

        // 保存文件路径供后续提交使用
        file.serverPath = result.data.filePath
      } else {
        ElMessage.error(result.message || '发票识别失败')
        removeFromFileList(file.uid, fileListParam)
      }
    } catch (error) {
      console.error('发票识别失败:', error)
      ElMessage.error('发票识别失败，请重新上传')
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
  function addInvoice(invoice: Omit<InvoiceItem, 'id'>): void {
    invoiceIdCounter++
    invoiceList.value.push({
      id: invoiceIdCounter,
      ...invoice,
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
      filePath: inv.filePath,
    }))
  }

  return {
    // 状态
    invoiceList,
    fileList,
    totalAmount,
    invoiceNumbers,

    // 方法
    formatDateToChinese,
    beforeUpload,
    handleExceed,
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
