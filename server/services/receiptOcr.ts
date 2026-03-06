/**
 * 支付截图 OCR 识别服务
 * 使用 tesseract.js 识别支付截图中的关键信息
 * 识别字段：商品名称(报销类型)、支付金额(报销金额)、支付时间(开票日期)、交易单号(发票号码)
 */

import Tesseract from 'tesseract.js'
import sharp from 'sharp'
import path from 'path'
import fs from 'fs'

export interface ReceiptOcrResult {
  amount: number        // 支付金额 → 报销金额
  date: string          // 支付时间 → 开票日期
  transactionNo: string // 交易单号 → 发票号码
  itemName: string      // 商品名称 → 报销类型
}

/**
 * 图像预处理：提高 OCR 识别准确度
 * 策略1: 高对比度 + 锐化（适合识别大号数字）
 */
async function preprocessImageHighContrast(imagePath: string): Promise<string> {
  try {
    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const processedPath = path.join(tempDir, `high-contrast-${Date.now()}.png`)

    await sharp(imagePath)
      .resize(4000, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .normalize()
      .linear(1.5, -(128 * 0.5)) // 增强对比度
      .sharpen({ sigma: 2 })
      .toFile(processedPath)

    console.log('✅ 高对比度预处理完成:', processedPath)
    return processedPath
  } catch (error) {
    console.error('⚠️  高对比度预处理失败:', error)
    return imagePath
  }
}

/**
 * 图像预处理：提高 OCR 识别准确度
 * 策略2: 二值化处理（黑白分明）
 */
async function preprocessImageBinary(imagePath: string): Promise<string> {
  try {
    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const processedPath = path.join(tempDir, `binary-${Date.now()}.png`)

    await sharp(imagePath)
      .resize(4000, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .normalize()
      .threshold(128) // 二值化
      .toFile(processedPath)

    console.log('✅ 二值化预处理完成:', processedPath)
    return processedPath
  } catch (error) {
    console.error('⚠️  二值化预处理失败:', error)
    return imagePath
  }
}

/**
 * 图像预处理：提高 OCR 识别准确度
 * 策略3: 反色 + 二值化（白底黑字）
 */
async function preprocessImageInverted(imagePath: string): Promise<string> {
  try {
    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const processedPath = path.join(tempDir, `inverted-${Date.now()}.png`)

    await sharp(imagePath)
      .resize(4000, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .normalize()
      .negate() // 反色
      .threshold(128)
      .toFile(processedPath)

    console.log('✅ 反色预处理完成:', processedPath)
    return processedPath
  } catch (error) {
    console.error('⚠️  反色预处理失败:', error)
    return imagePath
  }
}

/**
 * 识别支付截图 - 使用多策略识别
 */
export async function recognizeReceipt(imagePath: string): Promise<ReceiptOcrResult> {
  console.log('🔍 开始识别支付截图...')
  console.log('📄 文件路径:', imagePath)

  const result: ReceiptOcrResult = {
    amount: 0,
    date: '',
    transactionNo: '',
    itemName: '',
  }

  const processedImages: string[] = []

  try {
    // 策略1: 原图识别
    console.log('🖼️  策略1: 使用原图识别...')
    await recognizeWithConfig(imagePath, result, 'PSM_AUTO')

    if (result.amount > 0) {
      console.log('✅ 原图识别成功，金额:', result.amount)
      return result
    }

    // 策略2: 高对比度图像 + PSM_SINGLE_BLOCK
    console.log('🖼️  策略2: 高对比度 + PSM_SINGLE_BLOCK...')
    const highContrastPath = await preprocessImageHighContrast(imagePath)
    processedImages.push(highContrastPath)
    await recognizeWithConfig(highContrastPath, result, 'PSM_SINGLE_BLOCK')

    if (result.amount > 0) {
      console.log('✅ 高对比度识别成功，金额:', result.amount)
      return result
    }

    // 策略3: 二值化图像 + PSM_AUTO
    console.log('🖼️  策略3: 二值化 + PSM_AUTO...')
    const binaryPath = await preprocessImageBinary(imagePath)
    processedImages.push(binaryPath)
    await recognizeWithConfig(binaryPath, result, 'PSM_AUTO')

    if (result.amount > 0) {
      console.log('✅ 二值化识别成功，金额:', result.amount)
      return result
    }

    // 策略4: 反色图像 + PSM_SINGLE_BLOCK
    console.log('🖼️  策略4: 反色 + PSM_SINGLE_BLOCK...')
    const invertedPath = await preprocessImageInverted(imagePath)
    processedImages.push(invertedPath)
    await recognizeWithConfig(invertedPath, result, 'PSM_SINGLE_BLOCK')

    if (result.amount > 0) {
      console.log('✅ 反色识别成功，金额:', result.amount)
      return result
    }

    // 策略5: 原图 + PSM_SINGLE_LINE（针对大号数字）
    console.log('🖼️  策略5: 原图 + PSM_SINGLE_LINE...')
    await recognizeWithConfig(imagePath, result, 'PSM_SINGLE_LINE')

    if (result.amount > 0) {
      console.log('✅ PSM_SINGLE_LINE识别成功，金额:', result.amount)
      return result
    }

    console.log('⚠️  所有策略均未识别到金额')
    return result
  } catch (error) {
    console.error('❌ 支付截图OCR识别失败:', error)
    return result
  } finally {
    // 清理所有预处理文件
    for (const imgPath of processedImages) {
      try {
        if (imgPath !== imagePath && fs.existsSync(imgPath)) {
          fs.unlinkSync(imgPath)
        }
      } catch (e) {
        console.error('清理临时文件失败:', e)
      }
    }
  }
}

/**
 * 使用指定配置进行 OCR 识别
 */
async function recognizeWithConfig(
  imagePath: string,
  result: ReceiptOcrResult,
  psmMode: 'PSM_AUTO' | 'PSM_SINGLE_BLOCK' | 'PSM_SINGLE_LINE'
): Promise<void> {
  try {
    // PSM 模式映射
    const psmValues = {
      PSM_AUTO: '3',           // 自动分页
      PSM_SINGLE_BLOCK: '6',   // 单个文本块
      PSM_SINGLE_LINE: '7',    // 单行文本（适合大号数字）
    }

    const { data } = await Tesseract.recognize(imagePath, 'chi_sim+eng', {
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          console.log(`📊 OCR进度(${psmMode}): ${(m.progress * 100).toFixed(0)}%`)
        }
      },
      tessedit_pageseg_mode: psmValues[psmMode],
    })

    console.log(`📝 OCR识别文本(${psmMode}):`)
    console.log('='.repeat(60))
    console.log(data.text)
    console.log('='.repeat(60))

    // 只在金额为0时才更新结果
    const currentAmount = result.amount
    parseReceiptText(data.text, result)

    // 如果这次没识别到金额，恢复之前的金额
    if (result.amount === 0 && currentAmount > 0) {
      result.amount = currentAmount
    }
  } catch (error) {
    console.error(`${psmMode} 识别失败:`, error)
  }
}
/**
 * 解析支付截图文本，提取关键信息
 */
function parseReceiptText(text: string, result: ReceiptOcrResult): void {
  // 预处理：移除多余空格，但保留换行
  const cleanText = text.replace(/[ \t]+/g, ' ')

  // 1. 提取支付金额 - 增强版
  // 先尝试精确匹配
  const amountPatterns = [
    // 微信/支付宝支付金额格式：-34.50 或 ¥34.50
    /[-\-—–]\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
    /[¥￥]\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
    // "金额" 后面的数字
    /金额[：:\s]*[¥￥]?[-\-—–]?\s*(\d+(?:[,\s]*\d+)*\.?\\d{0,2})/,
    // "支付金额" 后面的数字
    /支付金额[：:\s]*[¥￥]?[-\-—–]?\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
    // 匹配独立的金额数字（带小数点）
    /[-\-—–]?\s*(\d{1,6}\.\d{2})/,
    // 匹配整数金额
    /[-\-—–]?\s*(\d{1,6})\s*元/,
  ]

  for (const pattern of amountPatterns) {
    const match = cleanText.match(pattern)
    if (match && match[1]) {
      const amountStr = match[1].replace(/[,\s]/g, '')
      const amount = parseFloat(amountStr)
      if (amount > 0 && amount < 100000) {
        result.amount = amount
        console.log('💰 识别到金额(精确):', result.amount, '原始:', match[0])
        break
      }
    }
  }

  // 如果精确匹配失败，尝试宽松匹配
  if (result.amount === 0) {
    console.log('⚠️  精确匹配失败，尝试宽松匹配...')

    // 查找所有可能的数字组合
    const loosePatterns = [
      // 匹配 "34.50"、"34 . 50"、"34 50"
      /(\d{1,4})\s*[.,。·]\s*(\d{1,2})/g,
      // 匹配纯数字后跟"元"
      /(\d{1,6})\s*[元圆]/g,
      // 匹配被识别为其他字符的金额（如 "3 4 . 5 0"）
      /(\d)\s+(\d)\s*[.,。·]\s*(\d)\s*(\d)/g,
    ]

    const candidates: Array<{ amount: number; source: string }> = []

    for (const pattern of loosePatterns) {
      let match
      while ((match = pattern.exec(cleanText)) !== null) {
        let amount = 0
        let source = match[0]

        if (match.length === 3) {
          // 有小数部分
          amount = parseFloat(`${match[1]}.${match[2]}`)
        } else if (match.length === 5) {
          // 被分隔的数字 "3 4 . 5 0"
          amount = parseFloat(`${match[1]}${match[2]}.${match[3]}${match[4]}`)
        } else {
          // 只有整数部分
          amount = parseFloat(match[1])
        }

        if (amount > 0 && amount < 100000) {
          candidates.push({ amount, source })
        }
      }
    }

    // 如果找到候选金额，选择最合理的一个
    if (candidates.length > 0) {
      // 优先选择带小数点的金额（更可能是支付金额）
      const withDecimal = candidates.filter(c => c.amount % 1 !== 0)
      if (withDecimal.length > 0) {
        result.amount = withDecimal[0].amount
        console.log('💰 识别到金额(宽松-小数):', result.amount, '原始:', withDecimal[0].source)
      } else {
        result.amount = candidates[0].amount
        console.log('💰 识别到金额(宽松-整数):', result.amount, '原始:', candidates[0].source)
      }
    }
  }

  // 如果还是没找到，尝试逐行分析
  if (result.amount === 0) {
    console.log('⚠️  宽松匹配失败，尝试逐行分析...')
    const lines = cleanText.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      // 查找包含数字和小数点的行
      const numberMatch = line.match(/(\d+)\s*[.,。·]\s*(\d+)/)
      if (numberMatch) {
        const amount = parseFloat(`${numberMatch[1]}.${numberMatch[2]}`)
        if (amount > 0 && amount < 100000) {
          // 检查上下文，确认这可能是金额
          const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(' ')
          if (
            context.includes('支付') ||
            context.includes('金额') ||
            context.includes('¥') ||
            context.includes('￥') ||
            context.includes('-')
          ) {
            result.amount = amount
            console.log('💰 识别到金额(逐行):', result.amount, '行:', line)
            break
          }
        }
      }
    }
  }

  // 2. 提取支付时间
  const datePatterns = [
    // 支付时间：2026年2月24日 19:29:46
    /支付时间[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    // 时间：2026年2月24日
    /时间[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    // 2026年2月24日（独立格式）
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    // 2026-02-24 或 2026/02/24
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/,
  ]

  for (const pattern of datePatterns) {
    const match = cleanText.match(pattern)
    if (match) {
      const year = match[1]
      const month = match[2].padStart(2, '0')
      const day = match[3].padStart(2, '0')
      const yearNum = parseInt(year)
      if (yearNum >= 2000 && yearNum <= 2030) {
        result.date = `${year}-${month}-${day}`
        console.log('📅 识别到日期:', result.date)
        break
      }
    }
  }

  // 3. 提取交易单号（支持空格分隔的数字）
  const transactionPatterns = [
    // 交易单号：4500000143202602247407359650（可能有空格）
    /交易单号[：:\s]*(\d[\d\s]{14,50})/,
    // 单号：xxx
    /单号[：:\s]*(\d[\d\s]{14,50})/,
    // 订单号：xxx
    /订单号[：:\s]*(\d[\d\s]{14,50})/,
    // 流水号
    /流水号[：:\s]*(\d[\d\s]{14,50})/,
  ]

  for (const pattern of transactionPatterns) {
    const match = cleanText.match(pattern)
    if (match && match[1]) {
      // 移除所有空格
      const transactionNo = match[1].replace(/\s/g, '')
      if (transactionNo.length >= 15) {
        result.transactionNo = transactionNo
        console.log('🔢 识别到交易单号:', result.transactionNo, '原始:', match[1])
        break
      }
    }
  }

  // 如果没找到，尝试查找长数字串（可能有空格）
  if (!result.transactionNo) {
    const longNumberMatch = cleanText.match(/(\d[\d\s]{19,50})/)
    if (longNumberMatch) {
      const transactionNo = longNumberMatch[1].replace(/\s/g, '')
      if (transactionNo.length >= 20) {
        result.transactionNo = transactionNo
        console.log('🔢 识别到交易单号(长数字):', result.transactionNo)
      }
    }
  }

  // 4. 提取商品名称（报销类型）- 金额上方的名称
  const itemPatterns = [
    // 商品：招牌小面三件套
    /商品[：:\s]*([^\n]+)/,
    // 商品名称
    /商品名称[：:\s]*([^\n]+)/,
  ]

  for (const pattern of itemPatterns) {
    const match = cleanText.match(pattern)
    if (match && match[1]) {
      // 清理商品名称：移除多余空格，保留中文字符间的空格
      let itemName = match[1].trim()
      // 移除行尾的空格和特殊字符
      itemName = itemName.replace(/[\s\n\r]+$/, '')
      // 将多个连续空格替换为单个空格
      itemName = itemName.replace(/\s+/g, '')

      if (itemName.length > 0 && itemName.length < 50) {
        result.itemName = itemName
        console.log('📦 识别到商品名称:', result.itemName, '原始:', match[1])
        break
      }
    }
  }

  // 如果没有通过"商品"关键字找到，尝试从商户名称上方提取
  if (!result.itemName) {
    // 尝试匹配商户全称上方的文字作为商品名
    const merchantMatch = cleanText.match(/商户全称/)
    if (merchantMatch && merchantMatch.index) {
      // 取商户全称之前的文本，找最近的一行非空文本
      const beforeText = cleanText.substring(0, merchantMatch.index)
      const lines = beforeText.split('\n').filter(l => l.trim())
      // 从后往前找，跳过金额行和状态行
      for (let i = lines.length - 1; i >= 0; i--) {
        let line = lines[i].trim()
        // 移除所有空格
        line = line.replace(/\s+/g, '')

        if (
          line &&
          !line.match(/^[-¥￥\d.,]+$/) &&
          !line.includes('支付成功') &&
          !line.includes('当前状态') &&
          line.length > 1 &&
          line.length < 50
        ) {
          result.itemName = line
          console.log('📦 识别到商品名称(推断):', result.itemName)
          break
        }
      }
    }
  }

  console.log('✅ 支付截图解析完成:', result)
}