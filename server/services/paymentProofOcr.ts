/**
 * 付款回单 OCR 识别服务
 * 使用 PaddleOCR 识别图片中的文字
 * 识别字段：付款人、收款人姓名、收款账号、金额
 * 支持JPG、PNG格式
 *
 * 银行回单 OCR 文本通常为表格格式，左列为付款方、右列为收款方
 * 示例：
 *   | 户名 | 北京XX公司 | 户名 | 张三
 *   | 账号 | 020030... | 账号 | 621226...
 *   金额(大写) 人民币壹仟伍佰元整
 */

import fs from 'fs'
import { callPaddleOcr } from './ocrDaemon.js'

export interface PaymentProofOcrResult {
  payer: string          // 付款人
  payee: string          // 收款人姓名
  payeeAccount: string   // 收款账号
  amount: number         // 金额
  proofNo: string        // 电子回单号码（用于查重）
  rawText?: string       // 原始识别文本
}

// ==================== 中文大写金额解析 ====================

/**
 * 将中文大写金额转换为数字
 * 例如：壹仟伍佰元整 → 1500
 */
function parseChineseAmount(text: string): number {
  const digitMap: Record<string, number> = {
    '零': 0, '壹': 1, '贰': 2, '叁': 3, '肆': 4,
    '伍': 5, '陆': 6, '柒': 7, '捌': 8, '玖': 9,
    // OCR 常见误识别
    '吉': 1, '弍': 2, '参': 3,
    '挫': 8, // "捌"的误识别
    '壶': 1, '壷': 1, // OCR 把 "壹" 识别成类似字形
    '武': 1, // OCR 把 "壹" 识别成类似字形
    '肄': 4, // OCR 把 "肆" 识别成类似字形
    '标': 7, // OCR 把 "柒" 识别成类似字形
  }
  const unitMap: Record<string, number> = {
    '拾': 10, '佰': 100, '仟': 1000, '万': 10000, '亿': 100000000,
    '百': 100, '千': 1000, '十': 10,
    // OCR 常见误识别
    '什': 1000, // "仟"的误识别
    '件': 100, // "佰"的误识别
    '河': 10, // "拾"的误识别
  }

  let result = 0
  let current = 0
  let lastUnit = 1

  for (const char of text) {
    if (digitMap[char] !== undefined) {
      current = digitMap[char]
    } else if (unitMap[char] !== undefined) {
      const unit = unitMap[char]
      if (unit >= 10000) {
        result = (result + current) * unit
        current = 0
        lastUnit = unit
      } else {
        // 处理省略"壹"的情况，如"拾贰元"应为12而非2
        if (current === 0) {
          result += unit
        } else {
          result += current * unit
        }
        current = 0
        lastUnit = unit
      }
    } else if (char === '元' || char === '圆') {
      result += current
      current = 0
    } else if (char === '角') {
      result = Math.round((result + current * 0.1) * 100) / 100
      current = 0
    } else if (char === '分') {
      result = Math.round((result + current * 0.01) * 100) / 100
      current = 0
    }
  }

  return result
}

// ==================== 文本解析 ====================

/**
 * 从文本中提取付款人信息
 * 银行回单格式：表格左列第一个户名为付款方
 */
function extractPayer(text: string, textNoSpace: string): string {
  // 1. 标准格式：付款人：XXX
  const standardPatterns = [
    /付款人[：:]\s*([^\n\r|]+)/,
    /付款方[：:]\s*([^\n\r|]+)/,
    /付款账户[：:]\s*([^\n\r|]+)/,
    /转出账户[：:]\s*([^\n\r|]+)/,
  ]
  for (const p of standardPatterns) {
    const m = text.match(p)
    if (m?.[1]?.trim()) return m[1].trim()
  }

  // 2. 银行回单表格格式：第一个"户名"后面的内容为付款方
  const tableMatch = text.match(/户\s*"?\s*名\s*\|?\s*([^|户\n]+)/i)
  if (tableMatch?.[1]?.trim()) {
    const name = tableMatch[1].replace(/[|"]/g, '').trim()
    if (name.length >= 2) return name
  }

  // 3. 从去空格文本中匹配
  const noSpaceMatch = textNoSpace.match(/户名[|]?([^|户账\n]{2,20})/)
  if (noSpaceMatch?.[1]) return noSpaceMatch[1]

  return ''
}

/**
 * 从文本中提取收款人姓名（对应回单中的"户名"字段）
 * 银行回单格式：表格右列第二个户名为收款方
 * 备选：从备注中提取人名
 */
function extractPayee(text: string, textNoSpace: string): string {
  // 1. 标准格式
  const standardPatterns = [
    /收款人[：:]\s*([^\n\r|]+)/,
    /收款方[：:]\s*([^\n\r|]+)/,
    /收款户名[：:]\s*([^\n\r|]+)/,
  ]
  for (const p of standardPatterns) {
    const m = text.match(p)
    if (m?.[1]?.trim()) return m[1].trim()
  }

  // 2. 银行回单表格格式：第二个"户名"后面的内容为收款方
  const allNameMatches = [...text.matchAll(/户\s*"?\s*名\s*\|?\s*([^|户\n]*)/gi)]
  if (allNameMatches.length >= 2) {
    const name = allNameMatches[1][1].replace(/[|"]/g, '').trim()
    if (name.length >= 2 && name !== '付款' && name !== '收款') return name
  }

  // 3. 工商银行双栏格式：公司名和个人名在"户名"标签之前出现
  // 格式：[公司名]\n[个人名]\n户\n名\n户\n名\n付款\n收款
  // 找到第一个"户"字之前的行，提取2-4个汉字的人名（排除公司名）
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const firstHuIdx = lines.findIndex(l => l === '户' || l === '户名' || /^户\s*名$/.test(l))
  if (firstHuIdx >= 2) {
    // 在"户名"之前的行中，找最后一个2-4个汉字的人名（排除带"公司""集团""银行"等机构词的行）
    const candidateLines = lines.slice(0, firstHuIdx)
    for (let i = candidateLines.length - 1; i >= 0; i--) {
      const line = candidateLines[i]
      if (/^[\u4e00-\u9fff]{2,4}$/.test(line) &&
          !line.includes('公司') && !line.includes('集团') &&
          !line.includes('银行') && !line.includes('回单') &&
          !line.includes('付款') && !line.includes('收款')) {
        return line
      }
    }
  }

  // 4. 从去空格文本中匹配第二个户名
  const noSpaceMatches = [...textNoSpace.matchAll(/户名[|]?([^|户账]{2,20})/g)]
  if (noSpaceMatches.length >= 2 && noSpaceMatches[1][1]) {
    const name = noSpaceMatches[1][1]
    if (name !== '付款' && name !== '收款') return name
  }

  return ''
}

/**
 * 从文本中提取收款账号
 * 银行回单中通常有两个长数字串：付款账号和收款账号
 * 收款账号通常是个人银行卡号（16-19位，以62开头）
 */
function extractPayeeAccount(text: string): string {
  // 1. 标准格式
  const standardPatterns = [
    /收款账号[：:]\s*([0-9\s]+)/,
    /收款账户[：:]\s*([0-9\s]+)/,
  ]
  for (const p of standardPatterns) {
    const m = text.match(p)
    if (m?.[1]) return m[1].replace(/\s+/g, '').trim()
  }

  // 2. 提取所有长数字串（13位以上），优先选择个人银行卡号（62开头，16-19位）
  const allNumbers = [...text.matchAll(/\b(\d[\d\s]{12,25})\b/g)]
    .map(m => m[1].replace(/\s+/g, ''))
    .filter(n => n.length >= 13 && n.length <= 25)

  // 优先选择 62 开头的个人银行卡号
  const personalCard = allNumbers.find(n => n.startsWith('62') && n.length >= 16 && n.length <= 19)
  if (personalCard) return personalCard

  // 如果有多个账号，取第二个（第一个通常是付款方公司账号）
  if (allNumbers.length >= 2) return allNumbers[1]
  if (allNumbers.length === 1) return allNumbers[0]

  return ''
}

/**
 * 从文本中提取金额
 * 支持：数字金额（¥1,500.00）和中文大写金额（人民币壹仟伍佰元整）
 */
function extractAmount(text: string, textNoSpace: string): number {
  // 1. 数字金额格式（支持中英文逗号）
  const numericPatterns = [
    /金[额颜][（(]?小写[）)]?[：:]?[¥￥YK]?([\d,，]+\.?\d*)/,
    /转账金[额颜][：:][¥￥YK]?([\d,，]+\.?\d*)/,
    /付款金[额颜][：:][¥￥YK]?([\d,，]+\.?\d*)/,
    /实付金[额颜][：:][¥￥YK]?([\d,，]+\.?\d*)/,
    /金[额颜][：:][¥￥YK]?([\d,，]+\.?\d*)/,
    /金[额颜][|｜]?[¥￥YK]?([\d,，]+\.?\d*)/,
  ]

  for (const p of numericPatterns) {
    const m = textNoSpace.match(p)
    if (m?.[1]) {
      // 同时处理英文逗号和中文逗号（，）
      const amount = parseFloat(m[1].replace(/[,，]/g, ''))
      if (!isNaN(amount) && amount > 0) {
        console.log('✅ 使用数字金额（精确匹配）:', amount)
        return amount
      }
    }
  }

  // 宽松模式匹配（支持中英文逗号）
  const loosePatterns = [
    /金\s*[额颜]\s*[（(]?\s*小\s*写\s*[）)]?\s*[：:]?\s*[¥￥YK]?\s*([\d,，]+\.?\d*)/,
    /金\s*[额颜]\s*[|｜]?\s*[¥￥YK]?\s*([\d,，]+\.?\d*)/,
  ]
  for (const p of loosePatterns) {
    const m = text.match(p)
    if (m?.[1]) {
      // 同时处理英文逗号和中文逗号（，）
      const amount = parseFloat(m[1].replace(/[,，]/g, ''))
      if (!isNaN(amount) && amount > 0) {
        console.log('✅ 使用数字金额（宽松匹配）:', amount)
        return amount
      }
    }
  }

  // 2. 兜底：从"金额"字段后面提取数字（支持中英文逗号）
  const labelAmount = textNoSpace.match(/金额[^0-9]{0,12}([0-9]{1,3}(?:[,，\uFF0C][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]{1,8}(?:\.[0-9]{1,2})?)/)
  if (labelAmount?.[1]) {
    const amount = parseFloat(labelAmount[1].replace(/[,，\uFF0C]/g, ''))
    if (!isNaN(amount) && amount > 0) {
      console.log('✅ 使用数字金额（兜底匹配）:', amount)
      return amount
    }
  }

  // 3. 独立的金额数字（带小数点，支持中英文逗号）
  const amountMatch = text.match(/\b(\d{1,3}(?:[,，]\d{3})*\.\d{2})\b/)
  if (amountMatch?.[1]) {
    const amount = parseFloat(amountMatch[1].replace(/[,，]/g, ''))
    if (!isNaN(amount) && amount > 0) {
      console.log('✅ 使用独立金额数字:', amount)
      return amount
    }
  }

  // 4. 中文大写金额格式（最后才使用，因为 OCR 容易识别错误）
  const chineseMatch = textNoSpace.match(/人民币([\u4e00-\u9fff]+?)(?:元|圆)/)
  if (chineseMatch?.[1]) {
    const amount = parseChineseAmount(chineseMatch[1] + '元')
    if (amount > 0) {
      console.log('⚠️ 使用中文大写金额（可能不准确）:', amount)
      return amount
    }
  }

  return 0
}

/**
 * 从文本中提取电子回单号码
 * 各银行格式不同，常见格式：
 * - 工商银行：电子回单号码：0909-6828-9049-1100
 * - 建设银行：电子回单号：XXXXXXXXXXXXXXXX
 * - 招商银行：凭证号码：XXXXXXXXXXXXXXXX
 */
function extractProofNo(text: string, textNoSpace: string): string {
  // 电子回单号码字符集：数字、字母、连字符（支持工商银行 XXXX-XXXX-XXXX-XXXX 格式）
  const idPattern = '[A-Za-z0-9][A-Za-z0-9\\-]{10,30}'

  const patterns = [
    new RegExp(`电子回单号码[：:\\s]*(${idPattern})`),   // 工商银行
    new RegExp(`电子回单号[：:\\s]*(${idPattern})`),     // 建设银行等
    new RegExp(`回单号码[：:\\s]*(${idPattern})`),
    new RegExp(`回单编号[：:\\s]*(${idPattern})`),
    new RegExp(`凭证号码[：:\\s]*(${idPattern})`),
    new RegExp(`凭证编号[：:\\s]*(${idPattern})`),
    new RegExp(`业务流水号[：:\\s]*(${idPattern})`),
    new RegExp(`交易流水号[：:\\s]*(${idPattern})`),
  ]

  for (const p of patterns) {
    const m = text.match(p) || textNoSpace.match(p)
    if (m?.[1]) {
      const no = m[1].trim().replace(/[-\s]+$/, '') // 去掉末尾多余的连字符或空格
      // 排除银行卡号（纯数字且长度 16-19 位）
      if (/^\d{16,19}$/.test(no)) {
        console.log('⚠️  疑似银行卡号，跳过:', no)
        continue
      }
      console.log('✅ 识别到电子回单号码:', no)
      return no
    }
  }

  console.log('⚠️  未识别到电子回单号码')
  return ''
}

/**
 * 解析付款回单文本，提取所有字段
 */
function parsePaymentProofText(text: string, result: PaymentProofOcrResult): void {
  const textNoSpace = text.replace(/\s+/g, '')

  result.payer = extractPayer(text, textNoSpace)
  result.payee = extractPayee(text, textNoSpace)
  result.payeeAccount = extractPayeeAccount(text)
  result.amount = extractAmount(text, textNoSpace)
  result.proofNo = extractProofNo(text, textNoSpace)

  console.log('📋 解析结果:', {
    payer: result.payer || '未识别',
    payee: result.payee || '未识别',
    payeeAccount: result.payeeAccount || '未识别',
    amount: result.amount || '未识别',
    proofNo: result.proofNo || '未识别',
  })
}

// ==================== 验证函数 ====================

/**
 * 验证是否为付款回单
 * 必须全部通过：
 * 1. 包含"银行"+"回单"基础关键字
 * 2. 识别到金额 > 0
 * 3. 识别到收款人和账号（两个都要有）
 * 4. 包含银行特有关键字（电子回单号码 / 交易流水号 / 交易时间，至少一个）
 * 5. 不包含系统界面特征（排除截图）
 */
function validatePaymentProof(rawText: string, result: PaymentProofOcrResult): {
  isValid: boolean
  reason?: string
} {
  const textNoSpace = rawText.replace(/\s+/g, '')

  // 1. 基础关键字：必须同时包含"银行"和"回单"
  const missingFields: string[] = []
  if (!textNoSpace.includes('银行')) missingFields.push('银行')
  if (!textNoSpace.includes('回单')) missingFields.push('回单')
  if (missingFields.length > 0) {
    return {
      isValid: false,
      reason: `此不是付款回单，缺少必要信息：${missingFields.join('、')}`
    }
  }

  // 2. 必须识别到金额
  if (!result.amount || result.amount <= 0) {
    return {
      isValid: false,
      reason: '无法识别回单金额，请确认上传的是真实的银行付款回单'
    }
  }

  // 3. 收款人和收款账号必须同时识别到
  if (!result.payee || !result.payeeAccount) {
    const missing: string[] = []
    if (!result.payee) missing.push('收款人姓名')
    if (!result.payeeAccount) missing.push('收款账号')
    return {
      isValid: false,
      reason: `无法识别${missing.join('和')}，请确认上传的是真实的银行付款回单`
    }
  }

  // 4. 必须包含银行特有关键字（至少一个）
  // 电子回单号码：工商银行等
  // 交易流水号 / 业务流水号：其他银行
  // 交易时间 / 记账时间：通用
  const bankSpecificKeywords = [
    '电子回单号码', '电子回单号',
    '交易流水号', '业务流水号',
    '交易时间', '记账时间',
  ]
  const hasSpecificKeyword = bankSpecificKeywords.some(k => textNoSpace.includes(k))
  if (!hasSpecificKeyword) {
    return {
      isValid: false,
      reason: '此不是真实的银行付款回单，请上传包含电子回单号码或交易时间的银行电子回单'
    }
  }

  // 5. 排除系统界面特征
  const systemInterfaceKeywords = [
    '上传付款回单', '将文件拖到此处', '点击上传',
    '报销单号', '报销标题', '申请人', '审批时间',
    '收款人信息', '开户行', '银行卡号',
  ]
  const hasSystemKeyword = systemInterfaceKeywords.some(k => textNoSpace.includes(k))
  if (hasSystemKeyword) {
    return {
      isValid: false,
      reason: '检测到系统界面特征，请上传真实的银行付款回单，而不是系统页面截图'
    }
  }

  return { isValid: true }
}

// ==================== 主识别函数 ====================

/**
 * 识别付款回单
 * @param filePath 文件路径（支持JPG、PNG）
 * @returns OCR识别结果
 */
export interface PaymentProofOcrOptions {
  // 用于参考的期望金额（从业务侧获得）
  expectedAmount?: number
}

export async function recognizePaymentProof(
  filePath: string,
  options: PaymentProofOcrOptions = {},
): Promise<PaymentProofOcrResult> {
  console.log('🔍 开始识别付款回单（PaddleOCR）...')

  if (!fs.existsSync(filePath)) {
    throw new Error('付款回单文件不存在: ' + filePath)
  }

  try {
    console.log('📄 图片文件路径:', filePath)

    // 调用 PaddleOCR 识别全图
    const text = await callPaddleOcr(filePath)

    console.log('📄 识别文本成功，长度:', text.length, '字符')
    console.log('📄 完整识别文本:\n---START---\n' + text + '\n---END---')

    const result: PaymentProofOcrResult = {
      payer: '',
      payee: '',
      payeeAccount: '',
      amount: 0,
      proofNo: '',
      rawText: text,
    }

    // 解析文本，提取各字段
    parsePaymentProofText(text, result)

    // 验证是否为银行回单（检查关键字和必要字段）
    const validation = validatePaymentProof(text, result)
    if (!validation.isValid) {
      throw new Error(validation.reason || '此不是付款回单')
    }

    console.log('📋 最终结果:', {
      payer: result.payer || '未识别',
      payee: result.payee || '未识别',
      payeeAccount: result.payeeAccount || '未识别',
      amount: result.amount || '未识别',
    })

    console.log('✅ 付款回单识别成功')
    return result
  } catch (error) {
    console.error('❌ 付款回单识别失败:', error)
    throw error
  }
}
