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
 * 从文本中提取发票信息
 */
function parseInvoiceText(text: string): InvoiceOcrResult {
  console.log('🔍 开始解析发票文本...')
  console.log('📝 文本长度:', text.length)
  console.log('📝 完整文本内容:')
  console.log('=' .repeat(80))
  console.log(text)
  console.log('='.repeat(80))

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
  ]

  for (const pattern of amountPatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      const amountStr = match[1].replace(/,/g, '')
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
    /开票日期[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /开票日期[：:\s]*(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})/,
    // 匹配 "日期" 后面的日期
    /日期[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /日期[：:\s]*(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})/,
    // 匹配独立的日期格式（带年月日）
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})[日]?/,
  ]

  for (const pattern of datePatterns) {
    const match = text.match(pattern)
    if (match) {
      const year = match[1]
      const month = match[2].padStart(2, '0')
      const day = match[3].padStart(2, '0')

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
    // 匹配 "开票人:" 前面的长数字（发票号码通常在这个位置）
    /开票人[：:][^\d]*(\d{20,24})/,
    // 匹配 "No." 后面的数字
    /No\.\s*(\d{8,24})/i,
  ]

  for (const pattern of invoiceNumberPatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      result.invoiceNumber = match[1]
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
    // 格式：*保险服务*附加公共场所 -> 提取 "保险服务"
    const typePattern = /\*([^*]+)\*/
    const typeMatch = text.match(typePattern)
    if (typeMatch && typeMatch[1]) {
      result.type = typeMatch[1].trim()
      console.log('📋 提取到报销类型:', result.type)
    }
  }

  // 判断是否为有效发票（严格验证：必须同时满足所有条件）
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
 */
async function extractTextFromPdfViaImage(pdfPath: string): Promise<string> {
  console.log('🖼️ 开始 PDF 转图片 OCR 识别...')

  const { execFileSync } = await import('child_process')

  // 使用 pdftoppm 将 PDF 第一页转为 PNG（300 DPI）
  const tmpPngPath = pdfPath + '-page'
  execFileSync('pdftoppm', ['-png', '-r', '300', '-f', '1', '-l', '1', pdfPath, tmpPngPath], { timeout: 30000 })

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
 * 本地 OCR 识别发票
 * 策略：先用 pdf-parse 提取文本，如果关键字段缺失则回退到 PDF 转图片 + PaddleOCR
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

    let result: InvoiceOcrResult | null = null

    if (text && text.trim().length > 0) {
      result = parseInvoiceText(text)
    }

    // 第二步：如果 pdf-parse 未能提取完整关键字段（金额、日期、发票号 三者必须齐全），回退到图片 OCR
    // 金额是最关键字段，只要金额识别失败就必须回退
    const hasKeyFields = result && result.amount > 0 && result.date && result.invoiceNumber
    if (!hasKeyFields) {
      console.log('⚠️ pdf-parse 未提取到关键字段，回退到 PDF 转图片 + PaddleOCR...')

      try {
        const imageText = await extractTextFromPdfViaImage(filePath)

        if (imageText && imageText.trim().length > 0) {
          const imageResult = parseInvoiceText(imageText)
          // 只有图片识别结果更完整时才替换
          if (imageResult && imageResult.amount > 0 && imageResult.date && imageResult.invoiceNumber) {
            result = imageResult
          }
        }
      } catch (imageOcrError) {
        console.error('⚠️ 图片 OCR 回退也失败:', imageOcrError)
      }
    }

    // 最终判断：必须同时满足 isValidInvoice 和三个关键字段齐全
    if (!result || !result.isValidInvoice || !result.amount || !result.date || !result.invoiceNumber) {
      throw new Error('此不是有效发票，请重新上传')
    }

    return result
  } catch (error) {
    console.error('❌ 本地 OCR 识别失败:', error)
    throw error
  }
}
