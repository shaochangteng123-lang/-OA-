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
      // 微信支付
      '支付成功', '付款成功', '对方已收钱', '已收钱',
      // 支付宝
      '转账成功', '收款成功', '交易成功', '付款金额',
      // 银行卡 / 云闪付
      '交易成功', '已转账', '转账给', '转账-转给',
      // 通用
      '扣款成功', '支出'
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
      // 注意：此处传入原始 text，extractExplicitAmounts 内部会调用 normalizeMinusSign
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

/**
 * 统一负号/破折号字符：将各种全角/半角负号统一为 ASCII 连字符
 * 微信支付截图中大金额行常出现全角负号 "－" (U+FF0D) 或破折号
 */
function normalizeMinusSign(text: string): string {
  // 全角减号 U+FF0D、连字符 U+2010、en-dash U+2013、em-dash U+2014、minus U+2212
  return text.replace(/[\uFF0D\u2010\u2013\u2014\u2212]/g, '-')
}

/** 从全图文本中提取明确金额，返回结果按金额从大到小排列 */
function extractExplicitAmounts(rawText: string): number[] {
  const text = normalizeMinusSign(rawText)
  const amounts: number[] = []
  const seen = new Set<number>()
  let match

  // 模式1: 负号+金额（如 -32.00 / -18.6 / -18）——微信支付大金额行常见格式
  const negativePattern = /[-]\s*(\d{1,6}(?:\.\d{1,2})?)/g
  while ((match = negativePattern.exec(text)) !== null) {
    const amt = parseFloat(match[1])
    if (amt > 0 && amt < 100000 && !seen.has(amt)) { amounts.push(amt); seen.add(amt) }
  }

  // 模式2: 货币符号+金额（如 ¥32.00 / ¥18.6 / ¥18）
  const currencyPattern = /[¥￥$]\s*(\d{1,6}(?:\.\d{1,2})?)/g
  while ((match = currencyPattern.exec(text)) !== null) {
    const amt = parseFloat(match[1])
    if (amt > 0 && amt < 100000 && !seen.has(amt)) { amounts.push(amt); seen.add(amt) }
  }

  // 模式3: 独占一行的金额（含整数、一位小数、两位小数）
  for (const line of text.split('\n').map(l => l.trim()).filter(l => l)) {
    const m = line.match(/^[¥￥-]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*$/)
    if (m) {
      const amt = parseFloat(m[1])
      if (amt > 0 && amt < 100000 && !seen.has(amt)) { amounts.push(amt); seen.add(amt) }
    }
  }

  // 按出现顺序返回（不排序）：支付主金额通常最先出现
  return amounts
}

/** 解析支付截图文本，提取关键信息 */
function parseReceiptText(text: string, result: ReceiptOcrResult): void {
  // 统一全角负号，避免正则遗漏
  const cleanText = normalizeMinusSign(text).replace(/[ \t]+/g, ' ')

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

    // 找到"支付成功"/"当前状态"等关键词所在行，只在其之后的行里找金额
    // 微信支付截图结构：顶部是状态栏(时间/电量) → logo/商户名 → 大金额 → 详情表格
    // 大金额行在商户名后、"当前状态"前，同时带有负号是最强信号
    const anchorKeywords = ['支付成功', '当前状态', '支付时间', '转账成功', '收款成功', '交易成功']
    let anchorLineIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (anchorKeywords.some(kw => lines[i].includes(kw))) {
        anchorLineIdx = i
        break
      }
    }

    // 候选金额列表：(金额值, 行索引, 是否带负号/货币符号)
    const candidates: Array<{ amount: number; lineIdx: number; hasSign: boolean }> = []

    // 时间格式：如 "14:52"、"12:20:01"
    const timeLinePattern = /^\d{1,2}:\d{2}(:\d{2})?$/

    for (let i = 0; i < lines.length; i++) {
      if (skipLines.has(i)) continue
      if (timeLinePattern.test(lines[i])) continue

      const m = lines[i].match(/^([¥￥-])?\s*(\d{1,6}(?:\.\d{1,2})?)\s*$/)
      if (!m) continue

      const hasSign = !!m[1]  // 是否有负号或货币符号
      const amount = parseFloat(m[2])
      if (amount <= 0 || amount >= 100000) continue

      // 排除"时间值"：整数部分 ≤ 23 且小数两位且 ≤ 59
      // 注意：带负号或货币符号的数字一定不是时间，不做此排除
      if (!hasSign) {
        const intPart = Math.floor(amount)
        const decStr = m[2].includes('.') ? m[2].split('.')[1] : ''
        if (intPart <= 23 && decStr.length === 2 && parseInt(decStr) <= 59) {
          console.log(`⏭️ 跳过疑似时间的数值: ${m[2]} (行 ${i})`)
          continue
        }
      }

      candidates.push({ amount, lineIdx: i, hasSign })
    }

    if (candidates.length > 0) {
      // 策略1：优先取带负号/货币符号的候选（这是微信支付大金额行的强特征）
      const signedCandidates = candidates.filter(c => c.hasSign)
      if (signedCandidates.length > 0) {
        // 带符号的候选中取最先出现的
        result.amount = signedCandidates[0].amount
        console.log('💰 识别到带符号的独立金额行:', result.amount, '(行', signedCandidates[0].lineIdx, ')')
      } else if (anchorLineIdx > 0) {
        // 策略2：没有带符号的，在关键词行之前的范围内找最靠近关键词的那个
        // （大金额行紧靠在"支付成功"/"当前状态"之前）
        const beforeAnchor = candidates.filter(c => c.lineIdx < anchorLineIdx)
        if (beforeAnchor.length > 0) {
          const closest = beforeAnchor[beforeAnchor.length - 1] // 最靠近锚点的
          result.amount = closest.amount
          console.log('💰 识别到锚点前的独立金额行:', result.amount, '(行', closest.lineIdx, ')')
        } else {
          // 策略3：兜底，取第一个
          result.amount = candidates[0].amount
          console.log('💰 识别到独立金额行（兜底）:', result.amount, '(行', candidates[0].lineIdx, ')')
        }
      } else {
        // 策略3：兜底，取第一个
        result.amount = candidates[0].amount
        console.log('💰 识别到独立金额行（兜底）:', result.amount, '(行', candidates[0].lineIdx, ')')
      }
    }

    // 常规模式匹配（独占行未能命中时的兜底）
    if (result.amount === 0) {
      const filteredText = lines.filter((_, i) => !skipLines.has(i)).join('\n')
      const amountPatterns = [
        /支付金额[：:\s]*[¥￥]?-?\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
        /金额[：:\s]*[¥￥]?-?\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
        /[¥￥]\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
        /-\s*(\d{1,6}\.\d{2})(?!\d)/,
        /(?<!\d)(\d{1,6}\.\d{2})(?!\d)/,
        /-?\s*(\d{1,6})\s*元/,
      ]
      for (const pattern of amountPatterns) {
        const m = filteredText.match(pattern)
        if (m && m[1]) {
          const amount = parseFloat(m[1].replace(/[,\s]/g, ''))
          if (amount > 0 && amount < 100000) {
            result.amount = amount
            console.log('💰 识别到金额（模式匹配）:', result.amount)
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
  // 策略：逐行扫描，优先找"交易单号"/"转账单号"/"流水号"标签，严格排除"商户单号"
  // 注意：必须先排除商户单号，避免将商户单号误识别为交易单号
  {
    const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l)
    const txnLabelPattern = /交\s*易\s*单\s*号|转\s*账\s*单\s*号|流\s*水\s*号/
    const merchantLabelPattern = /商\s*户\s*单\s*号/

    // 先记录所有"商户单号"标签行及其后一行的行号，这些行要完全排除
    const merchantSkipLines = new Set<number>()
    for (let i = 0; i < lines.length; i++) {
      if (merchantLabelPattern.test(lines[i])) {
        merchantSkipLines.add(i)
        if (i + 1 < lines.length) merchantSkipLines.add(i + 1)
      }
    }

    // 方式一：标签和数字在同一行（如"交易单号 4200012345..."）
    const inlineTxnPatterns = [
      /交\s*易\s*单\s*号\s*[：:"\s]*(\d[\d ]{14,50})/,
      /转\s*账\s*单\s*号\s*[：:"\s]*(\d[\d ]{14,50})/,
      /流\s*水\s*号\s*[：:"\s]*(\d[\d ]{14,50})/,
    ]
    for (let i = 0; i < lines.length; i++) {
      if (merchantSkipLines.has(i)) continue
      for (const pattern of inlineTxnPatterns) {
        const m = lines[i].match(pattern)
        if (m && m[1]) {
          const no = m[1].replace(/\s/g, '')
          if (no.length >= 15) {
            result.transactionNo = no
            console.log('🔢 识别到交易单号（同行）:', result.transactionNo)
            break
          }
        }
      }
      if (result.transactionNo) break
    }

    // 方式二：值在标签上方（标签在下，值在上）
    // 微信支付截图常见格式：数字在上一行，标签在下一行
    if (!result.transactionNo) {
      for (let i = 0; i < lines.length; i++) {
        if (merchantSkipLines.has(i)) continue
        if (txnLabelPattern.test(lines[i])) {
          // 向上找最近一行纯数字
          for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
            if (merchantSkipLines.has(j)) continue
            const no = lines[j].replace(/\s/g, '')
            if (/^\d{15,}$/.test(no)) {
              result.transactionNo = no
              console.log('🔢 识别到交易单号（值在上）:', result.transactionNo)
              break
            }
          }
          if (result.transactionNo) break
        }
      }
    }

    // 方式三：标签和数字分两行（找到标签行后，取紧接的下一行纯数字）
    if (!result.transactionNo) {
      for (let i = 0; i < lines.length; i++) {
        if (merchantSkipLines.has(i)) continue
        if (txnLabelPattern.test(lines[i])) {
          for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
            if (merchantSkipLines.has(j)) continue
            const no = lines[j].replace(/\s/g, '')
            if (/^\d{15,}$/.test(no)) {
              result.transactionNo = no
              console.log('🔢 识别到交易单号（值在下）:', result.transactionNo)
              break
            }
          }
          if (result.transactionNo) break
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
