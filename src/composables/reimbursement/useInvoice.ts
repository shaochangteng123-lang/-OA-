/**
 * 发票操作相关逻辑
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { showUploadError } from '@/utils/uploadError'
import { toFileUrl } from '@/utils/file'
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
  fileHash?: string // 文件哈希，用于查重
  deductedAmount?: number // 核减金额
  actualAmount?: number // 实际报销金额
  isDeduction?: boolean // 是否为核减发票
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
    fileHash?: string
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
  // 当月已使用的运输/交通/汽油/柴油/通行费类发票额度（从后端获取）
  const monthlyUsedQuota = ref<number>(0)
  // 正在识别中的无票上传请求：fileUid → AbortController
  const receiptAbortMap = new Map<string | number, AbortController>()
  // 正在识别中的发票上传请求：fileUid → AbortController
  const invoiceAbortMap = new Map<string | number, AbortController>()

  // 计算总金额（所有发票金额的总和，不考虑核减）
  const totalAmount = computed(() => {
    return invoiceList.value.reduce((sum, item) => sum + (item.amount || 0), 0)
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
      showUploadError(result.message)
      return false
    }
    return true
  }

  /**
   * 处理文件变化 - 上传并OCR识别
   * 策略：任何失败都移除缩略图，只有识别成功时才保留缩略图。
   * 识别过程中若用户点击删除按钮，则中断请求并移除缩略图。
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
      showUploadError('请上传正确格式的发票')
      removeFromFileList(file.uid, fileListParam)
      return
    }

    if (file.raw && file.raw.type !== 'application/pdf') {
      showUploadError('仅支持PDF文件，单个文件不超过5M')
      removeFromFileList(file.uid, fileListParam)
      return
    }

    // 创建 AbortController，用于支持识别过程中的中断
    const abortController = new AbortController()
    invoiceAbortMap.set(file.uid, abortController)

    // 调用后端API进行发票OCR识别
    const loadingMessage = ElMessage.info({
      message: `正在识别发票 ${file.name}...`,
      duration: 0, // 持续显示，直到识别完成
    })

    try {

      const uploadFormData = new FormData()
      uploadFormData.append('invoice', file.raw)
      uploadFormData.append('originalFileName', file.name)

      const response = await fetch('/api/reimbursement/upload-invoice', {
        method: 'POST',
        body: uploadFormData,
        credentials: 'include',
        signal: abortController.signal,
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
          loadingMessage.close()
          showUploadError(amountResult.message)
          removeFromFileList(file.uid, fileListParam)
          return
        }

        // 校验重复（本地）
        const duplicateResult = validateInvoiceDuplicate(invoiceNumber, invoiceNumbers.value)
        if (!duplicateResult.valid) {
          loadingMessage.close()
          showUploadError(duplicateResult.message)
          removeFromFileList(file.uid, fileListParam)
          return
        }

        // 校验重复（数据库全局查重）
        if (invoiceNumber) {
          try {
            const dupRes = await fetch('/api/reimbursement/check-invoice-duplicate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ invoiceNumber }),
              credentials: 'include',
              signal: abortController.signal,
            })
            const dupData = await dupRes.json()
            if (dupData.success && dupData.data?.duplicate) {
              loadingMessage.close()
              showUploadError(dupData.data.message || `${invoiceNumber}此发票已上传，请勿重复上传`)
              removeFromFileList(file.uid, fileListParam)
              return
            }
          } catch (e: any) {
            if (e?.name === 'AbortError') throw e // 向上传递中断异常
            console.warn('发票全局查重请求失败:', e)
          }
        }

        // 校验日期
        const dateResult = validateInvoiceDate(date)
        if (!dateResult.valid) {
          loadingMessage.close()
          showUploadError(dateResult.message)
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
          fileHash: result.data.fileHash || '',
          fileUid: file.uid,
        })

        loadingMessage.close()
        ElMessage.success(`${file.name} 识别成功！`)

        // 保存文件路径供后续提交使用
        file.serverPath = result.data.filePath
      } else {
        loadingMessage.close()
        showUploadError(`${file.name} 识别失败：${result.message || '未知错误'}`)
        removeFromFileList(file.uid, fileListParam)
      }
    } catch (error: any) {
      loadingMessage.close()
      // 用户主动中断（点击删除按钮），静默处理，不弹错误提示
      if (error?.name === 'AbortError') {
        removeFromFileList(file.uid, fileListParam)
        return
      }
      console.error('发票识别失败:', error)
      showUploadError(`${file.name} 识别失败，请重新上传`)
      removeFromFileList(file.uid, fileListParam)
    } finally {
      // 清理 AbortController
      invoiceAbortMap.delete(file.uid)
    }
  }

  /**
   * 处理收据/支付截图变化 - 上传并OCR识别
   * 策略：任何失败（格式/大小不合法、上传失败、OCR失败、校验失败、查重失败）都移除缩略图；
   * 只有识别成功时才保留缩略图。
   * 识别过程中若用户点击删除按钮，则中断请求并移除缩略图。
   */
  async function handleReceiptChange(file: any, fileListParam: any[]): Promise<void> {
    // 校验文件格式 —— 格式不合法，移除缩略图
    if (file.raw && !file.raw.type.startsWith('image/')) {
      showUploadError('仅支持图片文件')
      removeFromFileList(file.uid, fileListParam)
      return
    }

    // 拖拽上传时 file.url 可能未设置，立即补设 ObjectURL 确保缩略图始终显示
    if (file.raw && file.raw.type.startsWith('image/') && !file.url) {
      file.url = URL.createObjectURL(file.raw)
    }

    // 创建 AbortController，用于支持识别过程中的中断
    const abortController = new AbortController()
    receiptAbortMap.set(file.uid, abortController)

    // 调用后端API进行收据OCR识别
    const loadingMessage = ElMessage.info({
      message: `正在识别支付截图 ${file.name}...`,
      duration: 0, // 持续显示，不自动关闭
    })

    try {
      const uploadFormData = new FormData()
      uploadFormData.append('receipt', file.raw)
      uploadFormData.append('originalFileName', file.name)

      const response = await fetch('/api/reimbursement/upload-receipt', {
        method: 'POST',
        body: uploadFormData,
        credentials: 'include',
        signal: abortController.signal,
      })

      // 检查 HTTP 状态码
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: '上传失败' }))
        loadingMessage.close()
        showUploadError(errorData.message || `上传失败 (${response.status})`)
        // 上传失败，移除缩略图
        removeFromFileList(file.uid, fileListParam)
        return
      }

      const result: UploadResponse = await response.json()

      if (result.success && result.data?.ocrResult) {
        const { amount, date, invoiceNumber, type } = result.data.ocrResult

        // 校验金额 - 收据必须有金额，失败则移除缩略图
        if (!amount || amount <= 0) {
          loadingMessage.close()
          showUploadError(`${file.name} 未能识别到金额，请重新上传`)
          removeFromFileList(file.uid, fileListParam)
          return
        }

        const amountResult = validateInvoiceAmount(amount)
        if (!amountResult.valid) {
          loadingMessage.close()
          showUploadError(amountResult.message)
          removeFromFileList(file.uid, fileListParam)
          return
        }

        // 校验日期，失败则移除缩略图
        if (date) {
          const dateResult = validateInvoiceDate(date)
          if (!dateResult.valid) {
            loadingMessage.close()
            showUploadError(dateResult.message)
            removeFromFileList(file.uid, fileListParam)
            return
          }
        }

        // 本地查重，失败则移除缩略图
        if (invoiceNumber) {
          const duplicateInvoice = invoiceList.value.find(
            inv => inv.invoiceNumber === invoiceNumber
          )
          if (duplicateInvoice) {
            loadingMessage.close()
            showUploadError(`发票号码 ${invoiceNumber} 已存在，请勿重复上传`)
            removeFromFileList(file.uid, fileListParam)
            return
          }
        }

        // 添加收据到列表
        addInvoice({
          amount: amount,
          invoiceDate: date || '',
          invoiceNumber: invoiceNumber || `RECEIPT-${Date.now()}`,
          category: type || '无票报销', // 添加报销类型
          filePath: result.data.filePath || '',
          fileHash: result.data.fileHash || '',
          fileUid: file.uid,
        })

        loadingMessage.close()
        ElMessage.success(`${file.name} 识别成功！金额：¥${amount}`)

        // 保存文件路径供后续提交使用
        file.serverPath = result.data.filePath
      } else {
        loadingMessage.close()
        // OCR 识别失败，移除缩略图
        showUploadError(`${file.name} 识别失败：${result.message || '未知错误'}`)
        removeFromFileList(file.uid, fileListParam)
      }
    } catch (error: any) {
      loadingMessage.close()
      // 用户主动中断（点击删除按钮），静默处理，不弹错误提示
      if (error?.name === 'AbortError') {
        removeFromFileList(file.uid, fileListParam)
        return
      }
      console.error('收据识别失败:', error)
      // 其他异常，移除缩略图
      showUploadError(`${file.name} 识别失败，请重新上传`)
      removeFromFileList(file.uid, fileListParam)
    } finally {
      // 清理 AbortController
      receiptAbortMap.delete(file.uid)
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
   * 获取当月运输/交通/汽油/柴油/通行费类发票已使用额度
   * @param excludeReimbursementId 要排除的报销单ID（编辑模式下排除当前报销单）
   */
  async function fetchMonthlyUsedQuota(excludeReimbursementId?: string): Promise<void> {
    try {
      const url = excludeReimbursementId
        ? `/api/reimbursement/transport-fuel-quota?excludeId=${excludeReimbursementId}`
        : '/api/reimbursement/transport-fuel-quota'

      const response = await fetch(url, {
        credentials: 'include',
      })
      const result = await response.json()
      if (result.success) {
        monthlyUsedQuota.value = result.data.usedAmount || 0
      }
    } catch (error) {
      console.error('获取月度额度失败:', error)
      monthlyUsedQuota.value = 0
    }
    // 额度更新后重新计算核减金额
    recalculateDeductions()
  }

  /**
   * 重新计算核减金额
   * 对于基础报销，运输服务、汽油、柴油、通行费类发票合计限额1500元
   * 需要考虑当月已使用的额度（跨报销单累计）
   */
  function recalculateDeductions(): void {
    // 找出所有运输服务、汽油、柴油、通行费类发票
    const transportAndFuelInvoices = invoiceList.value.filter(inv => {
      const category = inv.category?.toLowerCase() || ''
      return (
        category.includes('运输') ||
        category.includes('交通') ||
        category.includes('汽油') ||
        category.includes('柴油') ||
        category.includes('通行费') ||
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

    // 计算剩余可用额度 = 1500 - 当月已使用额度
    const remainingQuota = Math.max(0, 1500 - monthlyUsedQuota.value)

    // 如果当月已使用额度 >= 1500，本次上传的所有运输/交通/汽油/柴油/通行费类发票全部核减
    if (monthlyUsedQuota.value >= 1500) {
      transportAndFuelInvoices.forEach(inv => {
        inv.deductedAmount = inv.amount
        inv.actualAmount = 0
      })
    } else if (totalTransportAndFuelAmount > remainingQuota) {
      // 如果本次上传的发票总额超过剩余额度，使用"先到先得"逻辑
      // 全程使用分（cents）来避免浮点数精度问题
      let accumulatedCents = 0
      const remainingQuotaCents = Math.round(remainingQuota * 100)

      transportAndFuelInvoices.forEach(inv => {
        const invAmountCents = Math.round(inv.amount * 100)
        const availableCents = remainingQuotaCents - accumulatedCents

        if (availableCents <= 0) {
          // 已经超过额度，这张发票完全不予报销
          inv.deductedAmount = inv.amount
          inv.actualAmount = 0
        } else if (invAmountCents <= availableCents) {
          // 这张发票可以全额报销
          inv.deductedAmount = 0
          inv.actualAmount = inv.amount
          accumulatedCents += invAmountCents
        } else {
          // 这张发票部分报销
          inv.actualAmount = availableCents / 100
          inv.deductedAmount = inv.amount - inv.actualAmount
          accumulatedCents += availableCents
        }
      })
    } else {
      // 如果不超过剩余额度，清除核减
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
        category.includes('交通') ||
        category.includes('汽油') ||
        category.includes('柴油') ||
        category.includes('通行费') ||
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
   * 若该文件正在识别中（发票或无票），则同时中断识别请求
   */
  function deleteInvoiceByFile(fileUid: string | number): void {
    // 若发票正在识别中，中断请求
    const invoiceAbort = invoiceAbortMap.get(fileUid)
    if (invoiceAbort) {
      invoiceAbort.abort()
      invoiceAbortMap.delete(fileUid)
    }
    // 若无票正在识别中，中断请求
    const receiptAbort = receiptAbortMap.get(fileUid)
    if (receiptAbort) {
      receiptAbort.abort()
      receiptAbortMap.delete(fileUid)
    }
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
    const path = file.serverPath || file.url
    if (path) {
      window.open(toFileUrl(path), '_blank')
    }
  }

  /**
   * 加载已有发票数据
   */
  function loadInvoices(invoices: any[]): void {
    console.log('📦 loadInvoices 被调用:', {
      invoices: invoices,
      length: invoices?.length,
      isArray: Array.isArray(invoices),
    })
    if (!invoices || invoices.length === 0) return

    // el-upload 要求 uid 为数字类型，使用时间戳 + 索引生成唯一数字 uid
    const baseUid = Date.now()

    invoiceList.value = invoices.map((inv, index) => ({
      id: index + 1,
      amount: inv.amount || 0,
      invoiceDate: inv.invoiceDate || '',
      invoiceNumber: inv.invoiceNumber || '',
      category: inv.category || '',
      filePath: inv.filePath || '',
      fileHash: inv.fileHash || '',
      fileUid: baseUid + index,
      deductedAmount: inv.deductedAmount || 0,
      actualAmount: inv.actualAmount || inv.amount || 0,
    }))

    fileList.value = invoices.map((inv, index) => ({
      uid: baseUid + index,
      name: (inv.filePath || '').split('/').pop() || '发票文件',
      url: toFileUrl(inv.filePath || ''),
      serverPath: inv.filePath || '',
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
      fileHash: inv.fileHash || '',
      // 核减金额由后端统一计算，前端仅供展示
      deductedAmount: 0,
      actualAmount: inv.amount,
    }))
  }

  return {
    // 状态
    invoiceList,
    fileList,
    totalAmount,
    totalDeductedAmount,
    invoiceNumbers,
    monthlyUsedQuota,

    // 方法
    formatDateToChinese,
    beforeUpload,
    handleFileChange,
    handleReceiptChange,
    deleteInvoiceByFile,
    deleteInvoiceById,
    handleFileRemove,
    handlePreview,
    loadInvoices,
    clearInvoices,
    getInvoicesForSubmit,
    fetchMonthlyUsedQuota,
  }
}
