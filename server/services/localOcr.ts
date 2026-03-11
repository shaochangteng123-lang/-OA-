/**
 * 本地 OCR 服务
 * 使用 pdf-parse 提取 PDF 文本，然后使用正则表达式识别发票信息
 * 数据完全在本地处理，保证数据安全
 */

import fs from 'fs'

// 动态导入 pdf-parse
let PDFParseClass: any = null

async function getPdfParse() {
  if (!PDFParseClass) {
    const module = await import('pdf-parse')
    PDFParseClass = module.PDFParse
  }
  return PDFParseClass
}

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
 * 使用正则表达式从文本中提取发票信息
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

  // 1. 提取金额（价税合计）- 改进的匹配模式
  const amountPatterns = [
    // 最高优先级：匹配大写金额后面紧跟的小写金额（支持换行和制表符）
    // 例如：捌佰伍拾贰圆整 ¥852.00 或 贰佰肆拾玖圆整 \t¥249.00
    // 这个模式优先级最高，因为大写金额后面的小写金额最准确
    /[壹贰叁肆伍陆柒捌玖拾佰仟万亿圆整角分]+[\s\t\n]*[¥￥]\s*([\d,]+\.\d{2})/,

    // 匹配 "价税合计" 后面的大写金额和小写金额（但要确保匹配的是大写金额后的小写金额）
    // 例如：价税合计（大写） （小写）... ¥11.00 壹拾壹圆整
    /价\s*税\s*合\s*计[\s\S]{0,200}?[¥￥]\s*([\d,]+\.\d{2})\s*[壹贰叁肆伍陆柒捌玖拾佰仟万亿圆整角分]/,

    // 匹配 "价税合计" 区域内的金额（支持换行和空格）
    /价\s*税\s*合\s*计[\s\S]{0,150}?[（(]\s*小\s*写\s*[）)][\s：:]*[¥￥]?\s*([\d,]+\.\d{2})/,

    // 匹配 "（小写）" 后面的金额（支持中英文括号）
    /[（(]\s*小\s*写\s*[）)][\s：:]*[¥￥]?\s*([\d,]+\.\d{2})/,

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
  // 格式：*保险服务*附加公共场所 -> 提取 "保险服务"
  const typePattern = /\*([^*]+)\*/
  const typeMatch = text.match(typePattern)
  if (typeMatch && typeMatch[1]) {
    result.type = typeMatch[1].trim()
    console.log('📋 提取到报销类型:', result.type)
  }

  // 判断是否为有效发票（更严格的验证条件）
  result.isValidInvoice =
    result.amount > 0 && // 条件1：金额必须大于0
    !!result.invoiceNumber && // 条件2：必须有发票号码
    result.invoiceNumber.length >= 8 && // 条件3：发票号码至少8位
    /^\d+$/.test(result.invoiceNumber) && // 条件4：发票号码必须是纯数字（不含字母）
    !!result.date && // 条件5：必须有日期
    /^\d{4}-\d{2}-\d{2}$/.test(result.date) // 条件6：日期格式必须是 YYYY-MM-DD

  console.log('✅ 发票解析完成:', {
    amount: result.amount,
    date: result.date,
    invoiceNumber: result.invoiceNumber,
    type: result.type,
    isValid: result.isValidInvoice,
  })

  // 如果不是有效发票，抛出错误
  if (!result.isValidInvoice) {
    throw new Error('此不是发票文件，请重新上传')
  }

  return result
}

/**
 * 本地 OCR 识别发票
 * @param filePath PDF 文件路径
 * @returns 发票识别结果
 */
export async function recognizeInvoiceLocally(filePath: string): Promise<InvoiceOcrResult> {
  console.log('🔍 开始本地 OCR 识别...')
  console.log('📄 文件路径:', filePath)

  try {
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error('文件不存在')
    }

    // 从 PDF 提取文本
    console.log('📄 正在提取 PDF 文本...')
    const text = await extractTextFromPdf(filePath)

    if (!text || text.trim().length === 0) {
      console.warn('⚠️  PDF 文本提取为空，可能是扫描件或图片 PDF')
      throw new Error('无法从 PDF 提取文本，请确保上传的是电子发票')
    }

    // 解析文本提取发票信息（如果无效会自动抛出错误）
    const result = parseInvoiceText(text)

    return result
  } catch (error) {
    console.error('❌ 本地 OCR 识别失败:', error)
    throw error
  }
}
