/**
 * 发票校验相关逻辑
 */

export interface ValidationResult {
  valid: boolean
  message: string
}

/**
 * 解析发票日期字符串，支持多种格式
 * @param dateStr 日期字符串
 * @returns { year, month } 或 null
 */
export function parseInvoiceDate(dateStr: string): { year: number; month: number } | null {
  if (!dateStr) return null

  // 尝试解析中文日期格式：2024年12月15日
  const chineseMatch = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/)
  if (chineseMatch) {
    return {
      year: parseInt(chineseMatch[1], 10),
      month: parseInt(chineseMatch[2], 10),
    }
  }

  // 尝试解析 YYYYMMDD 格式：20241215
  if (/^\d{8}$/.test(dateStr)) {
    return {
      year: parseInt(dateStr.substring(0, 4), 10),
      month: parseInt(dateStr.substring(4, 6), 10),
    }
  }

  // 尝试解析 YYYY-MM-DD 或 YYYY/MM/DD 格式
  const dateMatch = dateStr.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (dateMatch) {
    return {
      year: parseInt(dateMatch[1], 10),
      month: parseInt(dateMatch[2], 10),
    }
  }

  // 尝试使用 Date 解析
  const date = new Date(dateStr)
  if (!isNaN(date.getTime())) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
    }
  }

  return null
}

/**
 * 校验发票日期是否在允许范围内
 * 规则：当前月份只能报销上个月及当月的发票
 * 例如：2026年1月可以报销2025年12月的发票，但不能报销2025年11月及以前的发票
 */
export function validateInvoiceDate(invoiceDateStr: string): ValidationResult {
  if (!invoiceDateStr) {
    return { valid: true, message: '' }
  }

  const parsed = parseInvoiceDate(invoiceDateStr)
  if (!parsed) {
    console.warn('无法解析发票日期:', invoiceDateStr)
    return { valid: true, message: '' }
  }

  const { year: invoiceYear, month: invoiceMonth } = parsed
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // 计算允许的最早发票日期（上个月1号）
  let allowedYear: number
  let allowedMonth: number

  if (currentMonth === 1) {
    // 当前是1月，允许上一年12月
    allowedYear = currentYear - 1
    allowedMonth = 12
  } else {
    // 其他月份，允许当年上个月
    allowedYear = currentYear
    allowedMonth = currentMonth - 1
  }

  // 判断发票日期是否在允许范围内
  const invoiceYearMonth = invoiceYear * 100 + invoiceMonth
  const allowedYearMonth = allowedYear * 100 + allowedMonth
  const currentYearMonth = currentYear * 100 + currentMonth

  if (invoiceYearMonth < allowedYearMonth) {
    return {
      valid: false,
      message: '不能报销跨年发票',
    }
  }

  if (invoiceYearMonth > currentYearMonth) {
    return {
      valid: false,
      message: '发票日期不能晚于当前月份',
    }
  }

  return { valid: true, message: '' }
}

/**
 * 校验发票是否重复（根据发票号码）
 */
export function validateInvoiceDuplicate(
  invoiceNumber: string,
  existingNumbers: string[]
): ValidationResult {
  if (!invoiceNumber) {
    return { valid: true, message: '' }
  }

  const isDuplicate = existingNumbers.includes(invoiceNumber)
  if (isDuplicate) {
    return {
      valid: false,
      message: `发票号码 ${invoiceNumber} 已存在，请勿重复上传`,
    }
  }

  return { valid: true, message: '' }
}

/**
 * 校验发票金额是否有效
 */
export function validateInvoiceAmount(amount: number | undefined): ValidationResult {
  if (!amount || amount <= 0) {
    return {
      valid: false,
      message: '未能识别发票信息，请确认文件是否为有效发票',
    }
  }

  return { valid: true, message: '' }
}

/**
 * 校验文件格式
 */
export function validateFileFormat(file: File): ValidationResult {
  const fileName = file.name.toLowerCase()
  const isImageFile =
    fileName.endsWith('.jpg') ||
    fileName.endsWith('.jpeg') ||
    fileName.endsWith('.png') ||
    fileName.endsWith('.gif') ||
    fileName.endsWith('.bmp')

  if (isImageFile) {
    return {
      valid: false,
      message: '请上传正确格式的发票',
    }
  }

  const isPDF = file.type === 'application/pdf'
  if (!isPDF) {
    return {
      valid: false,
      message: '仅支持PDF文件，单个文件不超过5M',
    }
  }

  return { valid: true, message: '' }
}

/**
 * 校验文件大小
 */
export function validateFileSize(file: File, maxSize: number = 5 * 1024 * 1024): ValidationResult {
  if (file.size > maxSize) {
    return {
      valid: false,
      message: '文件大小超过5M，请压缩后上传',
    }
  }

  return { valid: true, message: '' }
}

/**
 * 综合校验文件
 */
export function validateFile(file: File, maxSize?: number): ValidationResult {
  const formatResult = validateFileFormat(file)
  if (!formatResult.valid) {
    return formatResult
  }

  const sizeResult = validateFileSize(file, maxSize)
  if (!sizeResult.valid) {
    return sizeResult
  }

  return { valid: true, message: '' }
}
