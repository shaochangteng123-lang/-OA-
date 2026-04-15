/**
 * 本地 OCR 服务
 * 使用 pdf-parse 提取 PDF 文本，然后使用正则表达式识别发票信息
 * 当 pdf-parse 提取文本不完整时，自动回退到 PDF 转图片 + PaddleOCR
 * 数据完全在本地处理，保证数据安全
 */

import fs from 'fs'
import path from 'path'
import { callPaddleOcr } from './ocrDaemon.js'

// 动态导入 pdf-parse
let PDFParseClass: any = null

async function getPdfParse() {
  if (!PDFParseClass) {
    const module = await import('pdf-parse')
    PDFParseClass = module.PDFParse
  }
  return PDFParseClass
}

// ==================== PaddleOCR（发票 OCR 专用） ====================
// PaddleOCR 通过 ocrDaemon.ts 管理，无需额外初始化

/**
 * 发票识别结果接口
 */
export interface InvoiceOcrResult {
  amount: number
  date: string
  invoiceNumber?: string
  seller?: string
  buyer?: string
  taxAmount?: number
  invoiceCode?: string
  type?: string // 报销类型（从项目名称提取）
  isValidInvoice: boolean
}

/**
 * 从 PDF 提取文本（用于电子发票）
 */
async function extractTextFromPdf(pdfPath: string): Promise<string> {
  try {
    const dataBuffer = fs.readFileSync(pdfPath)
    const PDFParseClass = await getPdfParse()
    const parser = new PDFParseClass({ data: dataBuffer })
    const result = await parser.getText()

    console.log('📄 PDF 文本提取成功')
    console.log('📝 提取的文本长度:', result.text.length)
    console.log('📝 文本预览:', result.text.substring(0, 200))

    return result.text
  } catch (error) {
    console.error('PDF 文本提取失败:', error)
    return ''
  }
}

/**
 * 预处理 OCR 文本：修复常见 OCR 错误
 * 用于提高扫描件/副本发票的识别率
 */
function preprocessOcrText(text: string): string {
  let processed = text

  // 修复 OCR 常见的数字间空格（如 "123 456 789" → 保留原文，但在金额匹配时处理）
  // 修复 OCR 将 "¥" 识别为其他字符的情况
  processed = processed.replace(/[＄﹩\$]/g, '¥')

  // 修复 OCR 将中文冒号识别为其他字符
  processed = processed.replace(/[∶︰]/g, '：')

  return processed
}

/**
 * 从文本中提取发票信息
 */
function parseInvoiceText(text: string): InvoiceOcrResult {
  console.log('🔍 开始解析发票文本...')
  console.log('📝 文本长度:', text.length)
  console.log('📝 完整文本内容:')
  console.log('=' .repeat(80))
  console.log(text)
  console.log('='.repeat(80))

  // 预处理 OCR 文本
  text = preprocessOcrText(text)

  // 初始化结果
  const result: InvoiceOcrResult = {
    amount: 0,
    date: '',
    invoiceNumber: '',
    seller: '',
    buyer: '',
    taxAmount: 0,
    invoiceCode: '',
    type: '',
    isValidInvoice: false,
  }

  // 判断是否为铁路电子客票
  // "电子客票号"是铁路客票独有字段，普通发票不会有，单独出现即可确认
  // 另外兼容 pdf-parse 能完整提取文本的情况（同时有"铁路电子客票"标题）
  const textNoSpaceForRail = text.replace(/\s+/g, '')
  const isRailTicket =
    textNoSpaceForRail.includes('电子客票号') ||
    (textNoSpaceForRail.includes('铁路电子客票') && textNoSpaceForRail.includes('12306'))

  // 1. 提取金额（价税合计）- 改进的匹配模式
  const amountPatterns = [
    // 铁路电子客票专属：仅当确认是铁路客票时才匹配"票价"/"退票费"字段
    // 普通票用"票价"，改签差额退票用"退票费"，两者都只在铁路客票下启用
    ...(isRailTicket ? [
      /票\s*价[：:\s]*[¥￥？?]?\s*([\d,]+\.?\d{0,2})/,
      /退\s*票\s*费[：:\s]*[¥￥？?]?\s*([\d,]+\.?\d{0,2})/,
    ] : []),

    // 最高优先级：匹配大写金额后面紧跟的小写金额（支持换行和制表符）
    // 补全所有中文大写数字：零壹贰叁参肆伍陆柒捌玖拾佰仟万亿圆整角分
    /[零壹贰叁参肆伍陆柒捌玖拾佰仟万亿圆整角分]+[\s\t\n]*[¥￥?？]\s*([\d,]+\.\d{2})/,

    // 匹配 "价税合计" 后面的大写金额和小写金额
    /价\s*税\s*合\s*计[\s\S]{0,200}?[¥￥?？]\s*([\d,]+\.\d{2})\s*[零壹贰叁参肆伍陆柒捌玖拾佰仟万亿圆整角分]/,

    // 匹配 "价税合计" 区域内的金额（支持换行和空格）
    /价\s*税\s*合\s*计[\s\S]{0,150}?[（(]\s*小\s*写\s*[）)][\s：:]*[¥￥?？]?\s*([\d,]+\.\d{2})/,

    // 匹配 "（小写）" 后面的金额（¥ 和数字之间可以有空格，¥ 可能被识别为 ?）
    /[（(]\s*小\s*写\s*[）)][\s：:]*[¥￥?？]?\s*([\d,]+\.\d{2})/,

    // OCR 特殊情况："（小写)" 和金额分行，金额在下一行（无 ¥ 前缀）
    /[（(]\s*小\s*写\s*[）)]\s*\n\s*([\d,]+\.\d{2})/,

    // OCR 兼容：¥ 可能被识别为 "羊"、"¢"、"?" 等，匹配 "小写" 后面的金额
    /小\s*写\s*[）)]\s*[¥￥羊¢?？]?\s*([\d,]+\.\d{2})/,

    // OCR 兼容：匹配大写金额字符（含 OCR 误差，如 "参" 代替 "叁"）后面的数字金额
    /[零壹贰叁参肆伍陆柒捌玖拾佰仟万亿圆整角分炳歪]+[\s\t\n]*[¥￥羊¢?？]?\s*([\d,]+\.\d{2})/,

    // 匹配 "合计" 后面的金额（但排除价税合计）
    /(?<!价\s*税\s*)合\s*计[：:\s]*[¥￥]?\s*([\d,]+\.\d{2})/,

    // === 以下为副本/扫描件增强模式 ===

    // OCR 可能在数字间插入空格，如 "¥ 6 6 . 0 0" → 需先合并空格再匹配
    // 匹配 "价税合计" 或 "（小写）" 附近、¥ 后面的带空格数字
    /[（(]\s*小\s*写\s*[）)]\s*[¥￥?？]?\s*([\d][\d\s,]*\.[\d\s]{1,3})/,

    // 匹配独立的金额行：只有 ¥ 加数字的行（副本发票 OCR 经常把金额独立成一行）
    /^\s*[¥￥]\s*([\d,]+\.\d{2})\s*$/m,

    // 匹配 "金额" 后面的数字
    /金\s*额[：:\s]*[¥￥]?\s*([\d,]+\.\d{2})/,

    // 最宽松：匹配 ¥ 后面任何位置的两位小数金额（仅作为最后兜底）
    /[¥￥]\s*([\d,]+\.\d{2})/,
  ]

  for (const pattern of amountPatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      // 清理 OCR 产生的空格和逗号（如 "6 6 . 0 0" → "66.00"）
      const amountStr = match[1].replace(/[\s,]/g, '')
      const parsedAmount = parseFloat(amountStr)
      if (parsedAmount > 0) {
        result.amount = parsedAmount
        console.log('💰 提取到金额:', result.amount, '来源:', match[0].substring(0, 80))
        console.log('💰 完整匹配内容:', match[0])
        break
      }
    }
  }

  // 2. 提取日期 - 改进的匹配模式
  const datePatterns = [
    // 最高优先级：匹配 "开票日期：" 后面的日期（可能有换行）
    /开票日期[：:\s]*([\r\n\s])*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /开票日期[：:\s]*(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})/,
    // 匹配 "日期" 后面的日期
    /日期[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /日期[：:\s]*(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})/,
    // 匹配独立的日期格式（带年月日）
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})[日]?/,
    // === 副本/扫描件增强：OCR 可能在年月日数字间插入空格 ===
    // 如 "2 0 2 6 年 0 4 月 1 2 日"
    /(\d\s*\d\s*\d\s*\d)\s*年\s*(\d\s*\d?)\s*月\s*(\d\s*\d?)\s*日/,
    // 纯数字日期格式 YYYYMMDD（常见于扫描件 OCR）
    /(?:开票日期|日期)[：:\s]*(\d{4})(\d{2})(\d{2})/,
  ]

  for (const pattern of datePatterns) {
    const match = text.match(pattern)
    if (match) {
      // 找到最后三个捕获组（跳过可能存在的前置捕获组）
      const groups = match.slice(1).filter(g => g !== undefined)
      // 取最后三个有效捕获组作为 year/month/day
      let yearStr: string, monthStr: string, dayStr: string
      if (groups.length >= 3) {
        yearStr = groups[groups.length - 3]
        monthStr = groups[groups.length - 2]
        dayStr = groups[groups.length - 1]
      } else {
        continue
      }

      // 清理 OCR 空格（如 "2 0 2 6" → "2026"）
      const year = yearStr.replace(/\s/g, '')
      const month = monthStr.replace(/\s/g, '').padStart(2, '0')
      const day = dayStr.replace(/\s/g, '').padStart(2, '0')

      // 验证日期合理性
      const yearNum = parseInt(year)
      const monthNum = parseInt(month)
      const dayNum = parseInt(day)

      if (yearNum >= 2000 && yearNum <= 2030 && monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
        result.date = `${year}-${month}-${day}`
        console.log('📅 提取到日期:', result.date, '来源:', match[0])
        break
      }
    }
  }

  // 3. 提取发票号码 - 改进的匹配模式
  const invoiceNumberPatterns = [
    // 最高优先级：匹配 "发票号码：" 后面的数字（支持换行和空格，20位数字）
    /发票号码[：:\s]*[\r\n]*\s*(\d{20})/,
    // 匹配 "发票号码：" 后面的数字（支持换行和空格，8-24位数字）
    /发票号码[：:\s]*[\r\n]*\s*(\d{8,24})/,
    // === 副本/扫描件增强：OCR 可能在数字间插入空格 ===
    // 匹配 "发票号码" 后面带空格的数字序列
    /发票号码[：:\s]*[\r\n]*\s*([\d][\d\s]{17,28}\d)/,
    // 匹配 "票号码" 后面的数字（OCR 可能截断"发"字）
    /票\s*号\s*码[：:\s]*[\r\n]*\s*(\d{8,24})/,
    // 匹配 "开票人:" 前面的长数字（发票号码通常在这个位置）
    /开票人[：:][^\d]*(\d{20,24})/,
    // 匹配 "No." 后面的数字
    /No\.\s*(\d{8,24})/i,
  ]

  for (const pattern of invoiceNumberPatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      // 清理 OCR 空格（如 "2 6 1 1 7 0 ..." → "261170..."）
      result.invoiceNumber = match[1].replace(/\s/g, '')
      console.log('🔢 提取到发票号码:', result.invoiceNumber, '来源:', match[0])
      break
    }
  }

  // 如果没有找到，尝试查找独立的20位数字（发票号码通常是20位）
  if (!result.invoiceNumber) {
    const longNumbers = text.match(/\b\d{20}\b/g)
    if (longNumbers && longNumbers.length > 0) {
      result.invoiceNumber = longNumbers[0]
      console.log('🔢 提取到发票号码（20位独立数字）:', result.invoiceNumber)
    }
  }

  // 如果还没有找到，尝试查找独立的8-12位数字（但要排除日期和金额）
  if (!result.invoiceNumber) {
    const allNumbers = text.match(/\b\d{8,12}\b/g)
    if (allNumbers) {
      for (const num of allNumbers) {
        // 排除日期格式（YYYYMMDD）
        if (num.length === 8) {
          const year = parseInt(num.substring(0, 4))
          const month = parseInt(num.substring(4, 6))
          const day = parseInt(num.substring(6, 8))
          if (year >= 2000 && year <= 2030 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            continue // 这是日期，跳过
          }
        }
        // 排除金额（包含小数点的数字）
        if (text.includes(num + '.')) {
          continue
        }
        result.invoiceNumber = num
        console.log('🔢 提取到发票号码（独立数字）:', result.invoiceNumber)
        break
      }
    }
  }

  // 4. 提取发票代码
  const invoiceCodePatterns = [
    /发票代码[：:\s]*(\d{10,12})/,
    /代码[：:\s]*(\d{10,12})/,
  ]

  for (const pattern of invoiceCodePatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      result.invoiceCode = match[1]
      console.log('🔢 提取到发票代码:', result.invoiceCode)
      break
    }
  }

  // 5. 提取销售方名称
  const sellerPatterns = [
    /销售方[：:\s]*名称[：:\s]*([^\n\r]+)/,
    /销售方[：:\s]*([^\n\r]+)/,
    /卖方[：:\s]*([^\n\r]+)/,
  ]

  for (const pattern of sellerPatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      result.seller = match[1].trim()
      console.log('🏢 提取到销售方:', result.seller)
      break
    }
  }

  // 6. 提取购买方名称
  const buyerPatterns = [
    /购买方[：:\s]*名称[：:\s]*([^\n\r]+)/,
    /购买方[：:\s]*([^\n\r]+)/,
    /买方[：:\s]*([^\n\r]+)/,
  ]

  for (const pattern of buyerPatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      result.buyer = match[1].trim()
      console.log('👤 提取到购买方:', result.buyer)
      break
    }
  }

  // 7. 提取税额
  const taxPatterns = [
    /税额[：:\s]*[¥￥]?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,
    /税金[：:\s]*[¥￥]?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,
  ]

  for (const pattern of taxPatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      const taxStr = match[1].replace(/,/g, '')
      result.taxAmount = parseFloat(taxStr)
      console.log('💵 提取到税额:', result.taxAmount)
      break
    }
  }

  // 8. 提取报销类型（从项目名称中提取）
  // 铁路电子客票直接填充固定类型
  if (isRailTicket) {
    result.type = '铁路电子客票'
    console.log('📋 铁路电子客票，自动填充报销类型:', result.type)
  } else {
    // 特殊处理：*经营租赁*通行费 -> 提取 "通行费"（高速费电子发票需参与核减）
    // 精确匹配项目名称格式 *...*通行费，避免全文搜索误判
    const tollPattern = /\*([^*]+)\*\s*通行费/
    const tollMatch = text.match(tollPattern)
    if (tollMatch) {
      result.type = '通行费'
      console.log('📋 检测到通行费发票（项目名称: *' + tollMatch[1] + '*通行费），报销类型设为:', result.type)
    } else {
      // 通用格式：*保险服务*附加公共场所 -> 提取 "保险服务"
      const typePattern = /\*([^*]+)\*/
      const typeMatch = text.match(typePattern)
      if (typeMatch && typeMatch[1]) {
        result.type = typeMatch[1].trim()
        console.log('📋 提取到报销类型:', result.type)
      }
    }
  }

  // 判断是否为有效发票（标准验证：必须同时满足所有条件）
  const textNoSpace = text.replace(/\s+/g, '')
  const hasInvoiceKeyword = textNoSpace.includes('发票') || textNoSpace.includes('電子發票')
  const hasAmount = result.amount > 0
  const hasDate = !!result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date)

  // 铁路电子客票：发票号码 或 电子客票号 满足其一即可
  const hasInvoiceNumber = !!result.invoiceNumber && result.invoiceNumber.length >= 8
  const hasRailTicketNo = isRailTicket && textNoSpace.includes('电子客票号')

  console.log('🔍 有效性验证:', {
    isRailTicket,
    hasInvoiceKeyword,
    hasAmount,
    hasDate,
    hasInvoiceNumber,
    hasRailTicketNo,
  })

  result.isValidInvoice = hasInvoiceKeyword && hasAmount && hasDate && (hasInvoiceNumber || hasRailTicketNo)

  console.log('✅ 发票解析完成:', {
    amount: result.amount,
    date: result.date,
    invoiceNumber: result.invoiceNumber,
    type: result.type,
    isValid: result.isValidInvoice,
  })

  return result
}

/**
 * 将 PDF 转为图片并用 PaddleOCR 识别文本
 * @param pdfPath PDF 文件路径
 * @param dpi 转换 DPI，默认 300，扫描件/副本可用 600
 */
async function extractTextFromPdfViaImage(pdfPath: string, dpi: number = 300): Promise<string> {
  console.log(`🖼️ 开始 PDF 转图片 OCR 识别... (DPI: ${dpi})`)

  const { execFileSync } = await import('child_process')

  // 使用 pdftoppm 将 PDF 第一页转为 PNG
  const tmpPngPath = pdfPath + `-page-${dpi}`
  execFileSync('pdftoppm', ['-png', '-r', String(dpi), '-f', '1', '-l', '1', pdfPath, tmpPngPath], { timeout: 30000 })

  // pdftoppm 输出文件名格式为 xxx-page-1.png 或 xxx-page-01.png
  const possibleFiles = [`${tmpPngPath}-1.png`, `${tmpPngPath}-01.png`, `${tmpPngPath}-001.png`]
  let pngFilePath = ''
  for (const f of possibleFiles) {
    if (fs.existsSync(f)) {
      pngFilePath = f
      break
    }
  }

  if (!pngFilePath) {
    throw new Error('PDF 转图片失败：未找到输出文件')
  }

  console.log('🖼️ PDF 转图片完成，路径:', pngFilePath)

  try {
    // 用 PaddleOCR 识别
    const text = await callPaddleOcr(pngFilePath)

    console.log('🖼️ PaddleOCR 识别完成，文本长度:', text.length)
    console.log('🖼️ 文本预览:', text.substring(0, 200))

    return text
  } finally {
    // 清理临时图片文件
    try { fs.unlinkSync(pngFilePath) } catch { /* 忽略 */ }
  }
}

/**
 * 合并两次 OCR 识别结果，取各字段的最佳值
 * 用于将 pdf-parse 结果与 PaddleOCR 结果合并，提高识别完整度
 */
function mergeOcrResults(primary: InvoiceOcrResult | null, secondary: InvoiceOcrResult | null): InvoiceOcrResult | null {
  if (!primary && !secondary) return null
  if (!primary) return secondary
  if (!secondary) return primary

  const merged: InvoiceOcrResult = {
    // 金额：取较大的有效值（避免取到 0）
    amount: primary.amount > 0 ? primary.amount : secondary.amount,
    // 日期：优先取有效的
    date: (primary.date && /^\d{4}-\d{2}-\d{2}$/.test(primary.date)) ? primary.date : secondary.date,
    // 发票号码：优先取较长的（更完整）
    invoiceNumber: (primary.invoiceNumber && primary.invoiceNumber.length >= (secondary.invoiceNumber?.length || 0))
      ? primary.invoiceNumber : (secondary.invoiceNumber || primary.invoiceNumber),
    // 其他字段：取非空的
    seller: primary.seller || secondary.seller,
    buyer: primary.buyer || secondary.buyer,
    taxAmount: primary.taxAmount || secondary.taxAmount,
    invoiceCode: primary.invoiceCode || secondary.invoiceCode,
    type: primary.type || secondary.type,
    // 有效性：任一通过即可
    isValidInvoice: primary.isValidInvoice || secondary.isValidInvoice,
  }

  console.log('🔀 合并 OCR 结果:', {
    primaryAmount: primary.amount, secondaryAmount: secondary.amount, mergedAmount: merged.amount,
    primaryDate: primary.date, secondaryDate: secondary.date, mergedDate: merged.date,
    primaryInvNo: primary.invoiceNumber, secondaryInvNo: secondary.invoiceNumber, mergedInvNo: merged.invoiceNumber,
    primaryValid: primary.isValidInvoice, secondaryValid: secondary.isValidInvoice, mergedValid: merged.isValidInvoice,
  })

  return merged
}

/**
 * 本地 OCR 识别发票
 * 策略：
 *   1. 先用 pdf-parse 提取文本
 *   2. 如果关键字段缺失，回退到 PDF 转图片 + PaddleOCR (300 DPI)
 *   3. 合并两次 OCR 结果，取最佳字段
 *   4. 如果合并后仍不完整，用更高 DPI (600) 再试一次
 *   5. 最终采用分层验证：标准验证 + 宽松验证（副本/扫描件模式）
 * @param filePath PDF 文件路径
 * @returns 发票识别结果
 */
export async function recognizeInvoiceLocally(filePath: string): Promise<InvoiceOcrResult> {
  console.log('🔍 开始本地 OCR 识别...')
  console.log('📄 文件路径:', filePath)

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error('文件不存在')
    }

    // 验证文件格式：通过文件头魔术字节判断是否为 PDF（临时文件可能没有扩展名）
    const headerBuf = Buffer.alloc(5)
    const fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, headerBuf, 0, 5, 0)
    fs.closeSync(fd)
    const isPdf = headerBuf.toString('ascii') === '%PDF-'
    if (!isPdf) {
      throw new Error('此不是PDF文件，请重新上传')
    }

    // 第一步：尝试 pdf-parse 提取文本
    console.log('📄 正在提取 PDF 文本...')
    const text = await extractTextFromPdf(filePath)

    let pdfParseResult: InvoiceOcrResult | null = null

    if (text && text.trim().length > 0) {
      pdfParseResult = parseInvoiceText(text)
    }

    // 第二步：如果 pdf-parse 未能提取完整关键字段，回退到图片 OCR (300 DPI)
    // 金额是最关键字段，只要金额识别失败就必须回退
    let imageOcrResult: InvoiceOcrResult | null = null
    const hasKeyFields = pdfParseResult && pdfParseResult.amount > 0 && pdfParseResult.date && pdfParseResult.invoiceNumber
    if (!hasKeyFields) {
      console.log('⚠️ pdf-parse 未提取到完整关键字段，回退到 PDF 转图片 + PaddleOCR (300 DPI)...')

      try {
        const imageText = await extractTextFromPdfViaImage(filePath, 300)

        if (imageText && imageText.trim().length > 0) {
          imageOcrResult = parseInvoiceText(imageText)
        }
      } catch (imageOcrError) {
        console.error('⚠️ 图片 OCR 回退失败 (300 DPI):', imageOcrError)
      }
    }

    // 第三步：合并 pdf-parse 和 PaddleOCR 的结果，取各字段最佳值
    let result = mergeOcrResults(pdfParseResult, imageOcrResult)

    // 第四步：如果合并后仍未通过验证，尝试更高 DPI (600) 再识别一次
    if (!result || !result.isValidInvoice) {
      console.log('⚠️ 300 DPI 识别不完整，尝试 600 DPI 高清识别...')

      try {
        const hdImageText = await extractTextFromPdfViaImage(filePath, 600)

        if (hdImageText && hdImageText.trim().length > 0) {
          const hdResult = parseInvoiceText(hdImageText)

          // 合并高清 OCR 结果
          result = mergeOcrResults(result, hdResult)
        }
      } catch (hdOcrError) {
        console.error('⚠️ 高清图片 OCR 也失败 (600 DPI):', hdOcrError)
      }
    }

    // 最终判断：必须同时满足 isValidInvoice 和三个关键字段齐全
    if (!result || !result.isValidInvoice || !result.amount || !result.date || !result.invoiceNumber) {
      console.log('❌ 最终验证失败:', {
        hasResult: !!result,
        isValid: result?.isValidInvoice,
        amount: result?.amount,
        date: result?.date,
        invoiceNumber: result?.invoiceNumber,
      })
      throw new Error('此不是有效发票，请重新上传')
    }

    return result
  } catch (error) {
    console.error('❌ 本地 OCR 识别失败:', error)
    throw error
  }
}
