/**
 * 支付截图 OCR 识别服务
 * 使用 PaddleOCR 识别支付截图中的关键信息
 * 识别字段：支付金额、支付时间、交易单号、商品名称
 *
 * v4：切换到 PaddleOCR 引擎
 * - PaddleOCR 中文识别准确率远高于 Tesseract.js
 * - 复用 paymentProofOcr.ts 的 PaddleOCR 调用机制
 * - 单次全图 OCR 即可准确提取所有字段
 */

import { callPaddleOcr } from './ocrDaemon.js'

export interface ReceiptOcrResult {
  amount: number        // 支付金额 → 报销金额
  date: string          // 支付时间 → 开票日期
  transactionNo: string // 交易单号 → 发票号码
  itemName: string      // 商品名称 → 报销类型
  rawText?: string      // 原始识别文本（用于智能修正）
}

// ==================== OCR 串行队列 ====================

let ocrQueue: Promise<any> = Promise.resolve()

/**
 * 识别支付截图（导出入口）
 * 通过队列串行执行，避免多个 OCR 请求并发竞争资源
 */
export async function recognizeReceipt(imagePath: string): Promise<ReceiptOcrResult> {
  return new Promise((resolve, reject) => {
    ocrQueue = ocrQueue
      .then(() => recognizeReceiptInternal(imagePath))
      .then(resolve)
      .catch(reject)
  })
}

// ==================== 核心识别流程 ====================

/** 内部识别函数 */
async function recognizeReceiptInternal(imagePath: string): Promise<ReceiptOcrResult> {
  const startTime = Date.now()
  console.log('🔍 开始识别支付截图（PaddleOCR）...')
  console.log('📄 文件路径:', imagePath)

  try {
    // PaddleOCR 直接识别原图，无需预处理
    const text = await callPaddleOcr(imagePath)
    console.log('📄 PaddleOCR 识别文本:')
    console.log(text)

    // 验证：检查是否为支付/转账截图
    const textNoSpace = text.replace(/\s+/g, '')
    const successKeywords = [
      '支付成功', '转账成功', '对方已收钱',
      '收款成功', '付款成功', '交易成功',
      '转账-转给', '转账给', '已转账'
    ]

    if (!successKeywords.some(kw => textNoSpace.includes(kw))) {
      console.log('❌ 未检测到支付成功关键词')
      throw new Error('此不是支付截图，请重新上传')
    }

    console.log('✅ 验证通过，提取字段...')
    const result: ReceiptOcrResult = {
      amount: 0, date: '', transactionNo: '', itemName: '无票报销', rawText: text
    }

    parseReceiptText(text, result)

    // 如果 parseReceiptText 没提取到金额，用 extractExplicitAmounts 补充
    if (result.amount === 0) {
      const explicitAmounts = extractExplicitAmounts(text)
      if (explicitAmounts.length > 0) {
        result.amount = explicitAmounts[0]
        console.log('💰 从文本补充提取到金额:', result.amount)
      }
    }

    if (result.amount <= 0) {
      console.log('⚠️ 未识别到金额')
      throw new Error('此不是支付截图，请重新上传')
    }

    console.log(`✅ 识别完成！金额: ${result.amount}，耗时: ${Date.now() - startTime}ms`)
    return result
  } catch (error) {
    console.error('❌ 支付截图OCR识别失败:', error)
    if (error instanceof Error && (
      error.message === '此不是支付截图，请重新上传' ||
      error.message.startsWith('这不是有效的支付截图')
    )) {
      throw error
    }
    throw new Error('此不是支付截图，请重新上传')
  }
}

// ==================== 文本解析 ====================

/** 从全图文本中提取明确金额 */
function extractExplicitAmounts(rawText: string): number[] {
  const amounts: number[] = []
  const seen = new Set<number>()
  let match

  // 模式1: 负号+金额（如 -32.00）
  const negativePattern = /[-–—]\s*(\d{1,6}\.\d{2})/g
  while ((match = negativePattern.exec(rawText)) !== null) {
    const amt = parseFloat(match[1])
    if (amt > 0 && amt < 100000 && !seen.has(amt)) { amounts.push(amt); seen.add(amt) }
  }

  // 模式2: 货币符号+金额（如 ¥32.00）
  const currencyPattern = /[¥￥$]\s*(\d{1,6}\.\d{2})/g
  while ((match = currencyPattern.exec(rawText)) !== null) {
    const amt = parseFloat(match[1])
    if (amt > 0 && amt < 100000 && !seen.has(amt)) { amounts.push(amt); seen.add(amt) }
  }

  // 模式3: 独占一行的金额
  for (const line of rawText.split('\n').map(l => l.trim()).filter(l => l)) {
    const m = line.match(/^[¥￥\-–—]?\s*(\d{1,6}\.\d{2})\s*$/)
    if (m) {
      const amt = parseFloat(m[1])
      if (amt > 0 && amt < 100000 && !seen.has(amt)) { amounts.push(amt); seen.add(amt) }
    }
  }

  return amounts
}

/** 解析支付截图文本，提取关键信息 */
function parseReceiptText(text: string, result: ReceiptOcrResult): void {
  const cleanText = text.replace(/[ \t]+/g, ' ')

  // 1. 提取支付金额
  if (result.amount === 0) {
    const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l)
    // 零钱/余额关键词，这些行的金额不是支付金额
    const walletKeywords = /零\s*钱|余\s*额|钱\s*包|找\s*零|充\s*值/

    const skipLines = new Set<number>()
    for (let i = 0; i < lines.length; i++) {
      if (walletKeywords.test(lines[i])) {
        skipLines.add(i)
        if (i + 1 < lines.length) skipLines.add(i + 1)
      }
    }

    // 优先：独占一行的金额（如 "-32.00" 或 "¥32.00"）
    for (let i = 0; i < lines.length; i++) {
      if (skipLines.has(i)) continue
      const m = lines[i].match(/^[¥￥\-\—\–]?\s*(\d{1,6}\.\d{2})\s*$/)
      if (m && m[1]) {
        const amount = parseFloat(m[1])
        if (amount > 0 && amount < 100000) {
          result.amount = amount
          console.log('💰 识别到独立金额行:', result.amount)
          break
        }
      }
    }

    // 常规模式匹配
    if (result.amount === 0) {
      const filteredText = lines.filter((_, i) => !skipLines.has(i)).join('\n')
      const amountPatterns = [
        /金额[：:\s]*[¥￥]?[-\-—–]?\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
        /支付金额[：:\s]*[¥￥]?[-\-—–]?\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
        /[¥￥]\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
        /[-\-—–]\s*(\d{1,6}\.\d{2})(?!\d)/,
        /(?<!\d)(\d{1,6}\.\d{2})(?!\d)/,
        /[-\-—–]?\s*(\d{1,6})\s*元/,
      ]
      for (const pattern of amountPatterns) {
        const m = filteredText.match(pattern)
        if (m && m[1]) {
          const amount = parseFloat(m[1].replace(/[,\s]/g, ''))
          if (amount > 0 && amount < 100000) {
            result.amount = amount
            console.log('💰 识别到金额:', result.amount)
            break
          }
        }
      }
    }
  }

  // 2. 提取支付时间
  const datePatterns = [
    /支付时间[：:\s]*(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /支付时间[：:\s]*(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/,
    /转账时间[：:\s]*(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/,
    /时间[：:\s]*(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/,
  ]
  for (const pattern of datePatterns) {
    const m = cleanText.match(pattern)
    if (m) {
      const yearNum = parseInt(m[1])
      if (yearNum >= 2000 && yearNum <= 2030) {
        result.date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
        console.log('📅 识别到日期:', result.date)
        break
      }
    }
  }

  // 3. 提取交易单号
  const transactionPatterns = [
    /交\s*易\s*单\s*号\s*[：:"\s]*(\d[\d ]{14,50})/,
    /转\s*账\s*单\s*号\s*[：:"\s]*(\d[\d ]{14,50})/,
    /订\s*单\s*号\s*[：:"\s]*(\d[\d ]{14,50})/,
    /流\s*水\s*号\s*[：:"\s]*(\d[\d ]{14,50})/,
  ]
  for (const pattern of transactionPatterns) {
    const m = cleanText.match(pattern)
    if (m && m[1]) {
      const no = m[1].replace(/\s/g, '')
      if (no.length >= 15) {
        result.transactionNo = no
        console.log('🔢 识别到交易单号:', result.transactionNo)
        break
      }
    }
  }

  if (!result.transactionNo) {
    const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l)
    const merchantLinePattern = /商\s*户\s*单\s*号/
    for (const line of lines) {
      if (merchantLinePattern.test(line)) continue
      const m = line.match(/(\d[\d ]{19,50})/)
      if (m) {
        const no = m[1].replace(/\s/g, '')
        if (no.length >= 20) {
          result.transactionNo = no
          console.log('🔢 识别到交易单号(长数字):', result.transactionNo)
          break
        }
      }
    }
  }

  console.log('✅ 支付截图解析完成:', result)
}

/**
 * OCR 调试函数
 */
export async function debugOCRForThree(imagePath: string): Promise<void> {
  console.log('========== OCR 识别调试（PaddleOCR）==========')
  console.log('📄 图片路径:', imagePath)
  try {
    const text = await callPaddleOcr(imagePath)
    console.log('📄 识别结果:')
    console.log(text)
    console.log('========== 调试完成 ==========')
  } catch (error) {
    console.error('❌ 调试过程出错:', error)
  }
}
