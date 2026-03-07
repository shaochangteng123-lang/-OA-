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
 * 预验证图片是否为支付截图
 * 快速检查是否包含支付相关关键词和金额特征
 */
async function validatePaymentScreenshot(imagePath: string): Promise<{ isValid: boolean; reason?: string }> {
  try {
    console.log('🔍 开始预验证支付截图...')

    // 预处理图片：缩小尺寸加快识别速度
    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const preprocessedPath = path.join(tempDir, `validate-${Date.now()}.png`)

    await sharp(imagePath)
      .resize(800, 1400, { fit: 'inside' }) // 缩小但保持可读性
      .grayscale()
      .normalize()
      .toFile(preprocessedPath)

    // 使用 Tesseract 快速识别全图文字
    const { data: { text } } = await Tesseract.recognize(preprocessedPath, 'chi_sim', {
      logger: () => {} // 禁用日志输出
    })

    // 清理临时文件
    try {
      fs.unlinkSync(preprocessedPath)
    } catch (e) {
      // 忽略删除失败
    }

    console.log('📄 识别到的文字片段:', text.substring(0, 200))

    // 去除所有空格，便于关键词匹配
    const textNoSpace = text.replace(/\s+/g, '')

    // 1. 检查关键词：必须包含支付成功相关字样
    const successKeywords = [
      '支付成功',
      '转账成功',
      '对方已收钱',
      '收款成功',
      '付款成功',
      '交易成功'
    ]

    const hasSuccessKeyword = successKeywords.some(keyword => textNoSpace.includes(keyword))

    if (!hasSuccessKeyword) {
      console.log('❌ 未检测到支付成功相关关键词')
      return {
        isValid: false,
        reason: '此不是支付截图，请重新上传'
      }
    }

    console.log('✅ 检测到支付成功关键词')

    // 2. 检查是否包含金额特征（可选，用于增强验证）
    // 匹配金额格式：¥34.50 或 34.50 或 -34.50 或 34元
    const amountPattern = /[¥￥+-]?\s*\d+\.?\d*|\d+元/
    const hasAmount = amountPattern.test(text)

    if (hasAmount) {
      console.log('✅ 检测到金额特征')
    } else {
      console.log('⚠️  未检测到金额特征，但已有支付成功关键词，继续验证')
    }

    console.log('✅ 预验证通过：这是一张支付截图')

    return { isValid: true }

  } catch (error) {
    console.error('⚠️  预验证失败:', error)
    // 验证失败时，允许继续尝试识别（容错处理）
    return { isValid: true }
  }
}

/**
 * 检测图片是否为深色模式（夜间模式）
 * 通过计算图片平均亮度判断
 */
async function isDarkMode(imagePath: string): Promise<boolean> {
  try {
    const { data, info } = await sharp(imagePath)
      .resize(100, 100, { fit: 'inside' }) // 缩小图片加快计算
      .raw()
      .toBuffer({ resolveWithObject: true })

    // 计算平均亮度
    let totalBrightness = 0
    const pixelCount = info.width * info.height

    for (let i = 0; i < data.length; i += info.channels) {
      // 使用加权平均计算亮度 (R*0.299 + G*0.587 + B*0.114)
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const brightness = r * 0.299 + g * 0.587 + b * 0.114
      totalBrightness += brightness
    }

    const avgBrightness = totalBrightness / pixelCount

    // 如果平均亮度小于 100（0-255范围），判定为深色模式
    const isDark = avgBrightness < 100
    console.log(`🌓 图片亮度检测: 平均亮度=${avgBrightness.toFixed(2)}, 深色模式=${isDark}`)

    return isDark
  } catch (error) {
    console.error('⚠️  亮度检测失败:', error)
    return false // 默认假设为浅色模式
  }
}

/**
 * 裁剪金额区域（微信支付截图金额位置）
 */
async function cropAmountArea(imagePath: string, isDark: boolean = false): Promise<string> {
  try {
    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const croppedPath = path.join(tempDir, `amount-crop-${Date.now()}.png`)

    // 获取图片尺寸
    const metadata = await sharp(imagePath).metadata()
    const width = metadata.width || 750
    const height = metadata.height || 1334

    // 根据图片尺寸计算裁剪区域（金额通常在中上部）
    // 微信支付截图金额位置：居中，在商户名称下方，大号数字
    const cropLeft = Math.floor(width * 0.15)   // 左侧 15%
    const cropTop = Math.floor(height * 0.23)   // 顶部 23%（金额位置）
    const cropWidth = Math.floor(width * 0.7)   // 宽度 70%
    const cropHeight = Math.floor(height * 0.06) // 高度 6%（仅金额数字行）

    let pipeline = sharp(imagePath)
      .extract({
        left: cropLeft,
        top: cropTop,
        width: cropWidth,
        height: cropHeight,
      })
      .resize(cropWidth * 4, cropHeight * 4) // 放大4倍提高识别率
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1 })

    // 如果是深色模式，反转颜色（白字黑底 → 黑字白底）
    if (isDark) {
      console.log('🌙 检测到深色模式，反转颜色...')
      pipeline = pipeline.negate()
    }

    await pipeline.toFile(croppedPath)

    console.log(`✅ 金额区域裁剪完成: ${croppedPath}`)
    console.log(`   裁剪区域: left=${cropLeft}, top=${cropTop}, width=${cropWidth}, height=${cropHeight}`)
    return croppedPath
  } catch (error) {
    console.error('⚠️  金额区域裁剪失败:', error)
    return imagePath
  }
}

/**
 * 裁剪商户名称区域（金额上方）- 多种预处理策略
 * @param topRatio 顶部位置比例，默认 0.19
 * @param variant 预处理变体：'high-contrast' | 'edge-enhance' | 'binary' | 'default'
 * @param isDark 是否为深色模式
 */
async function cropMerchantNameArea(
  imagePath: string,
  topRatio: number = 0.19,
  variant: 'high-contrast' | 'edge-enhance' | 'binary' | 'default' = 'default',
  isDark: boolean = false
): Promise<string> {
  try {
    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const croppedPath = path.join(tempDir, `merchant-crop-${variant}-${Date.now()}.png`)

    // 获取图片尺寸
    const metadata = await sharp(imagePath).metadata()
    const width = metadata.width || 750
    const height = metadata.height || 1334

    // 商户名称在金额上方，需要更精确的定位
    const cropLeft = Math.floor(width * 0.15)   // 左侧 15%
    const cropTop = Math.floor(height * topRatio)   // 顶部位置可调
    const cropWidth = Math.floor(width * 0.7)   // 宽度 70%
    const cropHeight = Math.floor(height * 0.04) // 高度 4%（减小高度，只包含文字）

    let pipeline = sharp(imagePath)
      .extract({
        left: cropLeft,
        top: cropTop,
        width: cropWidth,
        height: cropHeight,
      })
      .resize(cropWidth * 5, cropHeight * 5) // 放大5倍提高识别率
      .grayscale()

    // 如果是深色模式，先反转颜色
    if (isDark) {
      pipeline = pipeline.negate()
    }

    // 根据变体应用不同的预处理策略
    switch (variant) {
      case 'high-contrast':
        // 高对比度 - 让笔画更清晰
        pipeline = pipeline
          .normalize()
          .linear(2.0, -50) // 极高对比度
          .sharpen({ sigma: 1.5 })
        break

      case 'edge-enhance':
        // 边缘增强 - 强化"辶"等复杂笔画
        pipeline = pipeline
          .normalize()
          .sharpen(2, 2, 2) // sigma, flat, jagged
        break

      case 'binary':
        // 二值化 - 黑白分明
        pipeline = pipeline
          .normalize()
          .threshold(120)
        break

      case 'default':
      default:
        // 默认策略
        pipeline = pipeline
          .normalize()
          .linear(1.3, -(128 * 0.3))
          .sharpen({ sigma: 1.5 })
        break
    }

    await pipeline.toFile(croppedPath)

    console.log(`✅ 商户名称区域裁剪完成(${variant}): ${croppedPath}`)
    console.log(`   裁剪区域: left=${cropLeft}, top=${cropTop}, width=${cropWidth}, height=${cropHeight}`)
    return croppedPath
  } catch (error) {
    console.error('⚠️  商户名称区域裁剪失败:', error)
    return imagePath
  }
}

/**
 * 识别商户名称 - 多策略优化版（使用多种预处理变体投票）
 */
async function recognizeMerchantName(imagePath: string, topRatio: number = 0.19, isDark: boolean = false): Promise<string> {
  try {
    console.log(`🔍 识别商户名称（位置: ${(topRatio * 100).toFixed(0)}%）...`)

    const variants: Array<'default' | 'high-contrast' | 'edge-enhance' | 'binary'> = [
      'default',
      'high-contrast',
      'edge-enhance',
      'binary'
    ]

    const results: string[] = []
    const processedImages: string[] = []

    // 对每种预处理变体进行识别
    for (const variant of variants) {
      const croppedPath = await cropMerchantNameArea(imagePath, topRatio, variant, isDark)
      processedImages.push(croppedPath)

      // 策略1: 使用字符白名单
      const { data: data1 } = await Tesseract.recognize(croppedPath, 'chi_sim+eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            console.log(`📊 商户名称识别进度(${variant}-策略1): ${(m.progress * 100).toFixed(0)}%`)
          }
        },
        tessedit_pageseg_mode: '7', // PSM_SINGLE_LINE
        tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ遇见小面餐饮管理有限公司北京财付通工商银行储蓄卡支付成功商品商户收单机构方式交易单号瑞幸咖啡中国星巴克麦当劳肯德基造递觅兄通儿深圳市顺易',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      } as any)

      const cleaned1 = cleanMerchantName(data1.text)
      if (cleaned1.length >= 2 && cleaned1.length < 100) {
        results.push(cleaned1)
        console.log(`  ✓ ${variant}-策略1: ${cleaned1}`)
      }

      // 策略2: 不使用白名单
      const { data: data2 } = await Tesseract.recognize(croppedPath, 'chi_sim+eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            console.log(`📊 商户名称识别进度(${variant}-策略2): ${(m.progress * 100).toFixed(0)}%`)
          }
        },
        tessedit_pageseg_mode: '7', // PSM_SINGLE_LINE
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      } as any)

      const cleaned2 = cleanMerchantName(data2.text)
      if (cleaned2.length >= 2 && cleaned2.length < 100) {
        results.push(cleaned2)
        console.log(`  ✓ ${variant}-策略2: ${cleaned2}`)
      }
    }

    // 清理临时文件
    for (const imgPath of processedImages) {
      try {
        if (imgPath !== imagePath && fs.existsSync(imgPath)) {
          fs.unlinkSync(imgPath)
        }
      } catch (e) {
        console.error('清理临时文件失败:', e)
      }
    }

    // 投票选择最可能的结果
    if (results.length === 0) {
      console.log('⚠️  所有变体均未识别到商户名称')
      return ''
    }

    const counts: Record<string, number> = {}
    results.forEach(r => {
      counts[r] = (counts[r] || 0) + 1
    })

    const sortedResults = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])

    const bestResult = sortedResults[0][0]
    const voteCount = sortedResults[0][1]

    console.log('📝 所有识别结果:', results)
    console.log(`✅ 投票结果: ${bestResult} (${voteCount}/${results.length}票)`)

    return bestResult
  } catch (error) {
    console.error('❌ 商户名称识别失败:', error)
    return ''
  }
}

/**
 * 清理商户名称文本
 */
function cleanMerchantName(text: string): string {
  let cleaned = text.trim()

  // 移除所有空格（中文商户名称通常不需要空格）
  cleaned = cleaned.replace(/\s+/g, '')

  // 移除换行符
  cleaned = cleaned.replace(/[\n\r]+/g, '')

  // 移除特殊字符，只保留中文、英文、数字
  cleaned = cleaned.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')

  // 取第一行（如果有多行）
  const lines = cleaned.split('\n').filter(l => l.trim())
  if (lines.length > 0) {
    cleaned = lines[0]
  }

  // 应用规则纠正常见误识别
  cleaned = correctMerchantName(cleaned)

  return cleaned
}

/**
 * 基于规则的商户名称纠正（针对常见OCR误识别）
 */
function correctMerchantName(rawText: string): string {
  // 常见的错误识别模式
  const corrections = [
    { wrong: /造见小面/g, correct: '遇见小面' },
    { wrong: /递见小面/g, correct: '遇见小面' },
    { wrong: /遇觅小面/g, correct: '遇见小面' },
    { wrong: /遇兄小面/g, correct: '遇见小面' },
    { wrong: /通见小面/g, correct: '遇见小面' },
    { wrong: /遇儿小面/g, correct: '遇见小面' },
    { wrong: /造小面/g, correct: '遇见小面' },
    { wrong: /递小面/g, correct: '遇见小面' },
    // 星巴克常见误识别
    { wrong: /星巴兄/g, correct: '星巴克' },
    { wrong: /星巴売/g, correct: '星巴克' },
    // 瑞幸咖啡常见误识别
    { wrong: /瑞幸咖非/g, correct: '瑞幸咖啡' },
    { wrong: /瑞辛咖啡/g, correct: '瑞幸咖啡' },
  ]

  let corrected = rawText
  for (const { wrong, correct } of corrections) {
    corrected = corrected.replace(wrong, correct)
  }

  return corrected
}

/**
 * 专门针对金额识别的预处理
 */
async function preprocessForAmount(imagePath: string, isDark: boolean = false): Promise<string> {
  try {
    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const processedPath = path.join(tempDir, `amount-processed-${Date.now()}.png`)

    let pipeline = sharp(imagePath)
      .resize(2000, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()

    // 如果是深色模式，先反转颜色
    if (isDark) {
      pipeline = pipeline.negate()
    }

    await pipeline
      .normalize()
      .linear(1.5, -(128 * 0.5)) // 适度增强对比度
      .sharpen({ sigma: 1.5 })
      .threshold(128) // 标准二值化阈值
      .toFile(processedPath)

    console.log('✅ 金额专用预处理完成:', processedPath)
    return processedPath
  } catch (error) {
    console.error('⚠️  金额预处理失败:', error)
    return imagePath
  }
}

/**
 * 使用字符白名单识别金额
 */
async function recognizeAmountWithWhitelist(imagePath: string): Promise<number> {
  try {
    console.log('🔍 使用字符白名单识别金额...')

    const { data } = await Tesseract.recognize(imagePath, 'eng', {
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          console.log(`📊 金额识别进度: ${(m.progress * 100).toFixed(0)}%`)
        }
      },
      tessedit_pageseg_mode: '7', // PSM_SINGLE_LINE
      tessedit_char_whitelist: '0123456789.-',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    } as any)

    console.log('📝 金额识别原始文本:', data.text)

    // 后处理：清理识别结果
    const cleaned = postProcessAmount(data.text)
    console.log('🧹 清理后的金额文本:', cleaned)

    if (cleaned) {
      const amount = parseFloat(cleaned)
      if (!isNaN(amount) && amount > 0 && amount < 100000) {
        console.log('✅ 识别到金额:', amount)
        return amount
      }
    }

    return 0
  } catch (error) {
    console.error('❌ 金额识别失败:', error)
    return 0
  }
}

/**
 * 后处理：清理金额文本
 */
function postProcessAmount(text: string): string {
  // 移除所有空白字符
  let cleaned = text.replace(/\s+/g, '')

  // 移除开头的负号或破折号
  cleaned = cleaned.replace(/^[-–—]+/, '')

  // 只保留第一个小数点
  const parts = cleaned.split('.')
  if (parts.length > 2) {
    cleaned = parts[0] + '.' + parts.slice(1).join('')
  }

  // 移除非数字和小数点的字符
  cleaned = cleaned.replace(/[^\d.]/g, '')

  // 确保小数点后最多2位
  const match = cleaned.match(/^(\d+)\.?(\d{0,2})/)
  if (match) {
    if (match[2]) {
      cleaned = `${match[1]}.${match[2]}`
    } else {
      cleaned = match[1]
    }
  }

  return cleaned
}

/**
 * 识别支付截图 - 优化版
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
    // 第一步：预验证是否为支付截图
    const validation = await validatePaymentScreenshot(imagePath)
    if (!validation.isValid) {
      console.log('❌ 预验证失败:', validation.reason)
      throw new Error(`这不是有效的支付截图：${validation.reason}`)
    }

    // 首先检测是否为深色模式
    const isDark = await isDarkMode(imagePath)

    // 策略1: 裁剪金额区域 + 字符白名单识别
    console.log('🖼️  策略1: 裁剪金额区域 + 字符白名单...')
    const croppedPath = await cropAmountArea(imagePath, isDark)
    processedImages.push(croppedPath)

    const processedCroppedPath = await preprocessForAmount(croppedPath, isDark)
    processedImages.push(processedCroppedPath)

    result.amount = await recognizeAmountWithWhitelist(processedCroppedPath)

    if (result.amount > 0) {
      console.log('✅ 策略1成功，金额:', result.amount)

      // 报销类型直接设置为"无票报销"
      result.itemName = '无票报销'
      console.log('📦 报销类型: 无票报销')

      // 继续识别其他字段
      await recognizeFullImage(imagePath, result)
      return result
    }

    // 策略2: 原图裁剪 + 字符白名单
    console.log('🖼️  策略2: 原图裁剪 + 字符白名单...')
    result.amount = await recognizeAmountWithWhitelist(croppedPath)

    if (result.amount > 0) {
      console.log('✅ 策略2成功，金额:', result.amount)

      // 报销类型直接设置为"无票报销"
      result.itemName = '无票报销'
      console.log('📦 报销类型: 无票报销')

      await recognizeFullImage(imagePath, result)
      return result
    }

    // 策略3: 全图识别（回退方案）
    console.log('🖼️  策略3: 全图识别（回退方案）...')
    await recognizeFullImage(imagePath, result)

    if (result.amount > 0) {
      console.log('✅ 策略3成功，金额:', result.amount)
      return result
    }

    console.log('⚠️  所有策略均未识别到金额')
    throw new Error('此不是支付截图，请重新上传')
  } catch (error) {
    console.error('❌ 支付截图OCR识别失败:', error)
    // 如果是我们主动抛出的错误，直接传递
    if (error instanceof Error && error.message === '此不是支付截图，请重新上传') {
      throw error
    }
    // 其他错误也统一提示
    throw new Error('此不是支付截图，请重新上传')
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
 * 识别全图以提取日期、交易单号、商品名称
 */
async function recognizeFullImage(
  imagePath: string,
  result: ReceiptOcrResult
): Promise<void> {
  try {
    console.log('🔍 识别全图以提取其他字段...')

    const { data } = await Tesseract.recognize(imagePath, 'chi_sim+eng', {
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          console.log(`📊 全图识别进度: ${(m.progress * 100).toFixed(0)}%`)
        }
      },
      tessedit_pageseg_mode: '3', // PSM_AUTO
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    } as any)

    console.log('📝 全图识别文本:')
    console.log('='.repeat(60))
    console.log(data.text)
    console.log('='.repeat(60))

    parseReceiptText(data.text, result)
  } catch (error) {
    console.error('❌ 全图识别失败:', error)
  }
}

/**
 * 解析支付截图文本，提取关键信息
 */
function parseReceiptText(text: string, result: ReceiptOcrResult): void {
  // 预处理：移除多余空格，但保留换行
  const cleanText = text.replace(/[ \t]+/g, ' ')

  // 1. 提取支付金额（仅在金额为0时才尝试）
  if (result.amount === 0) {
    const amountPatterns = [
      // 微信/支付宝支付金额格式：-34.50 或 ¥34.50
      /[-\-—–]\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
      /[¥￥]\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
      // "金额" 后面的数字
      /金额[：:\s]*[¥￥]?[-\-—–]?\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
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
          console.log('💰 识别到金额:', result.amount, '原始:', match[0])
          break
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

  // 4. 提取商品名称（报销类型）
  // 如果已经通过裁剪区域识别到商户名称，优先使用
  if (!result.itemName) {
    const itemPatterns = [
      // 商品：招牌小面三件套
      /商品[：:\s]*([^\n]+)/,
      // 商品名称
      /商品名称[：:\s]*([^\n]+)/,
    ]

    for (const pattern of itemPatterns) {
      const match = cleanText.match(pattern)
      if (match && match[1]) {
        let itemName = match[1].trim()
        itemName = itemName.replace(/[\s\n\r]+$/, '')
        itemName = itemName.replace(/\s+/g, '')

        if (itemName.length > 0 && itemName.length < 50) {
          result.itemName = itemName
          console.log('📦 识别到商品名称:', result.itemName, '原始:', match[1])
          break
        }
      }
    }
  }

  // 如果还没有商户名称，尝试从全图文本中提取
  if (!result.itemName) {
    result.itemName = extractMerchantFromFullText(cleanText)
    if (result.itemName) {
      console.log('📦 从全图提取商户名称:', result.itemName)
    }
  }

  console.log('✅ 支付截图解析完成:', result)
}

/**
 * 从全图文本中提取商户名称
 */
function extractMerchantFromFullText(text: string): string {
  // 常见商户名模式
  const patterns = [
    // 匹配"遇见小面"、"瑞幸咖啡"等
    /([\u4e00-\u9fa5]{2,6}(?:小面|咖啡|餐厅|饭店|商店))/,
    // 匹配 luckin coffee 等英文商户名
    /([a-zA-Z]{3,15}\s+[a-zA-Z]{3,15})/,
    // 匹配纯中文商户名（2-8个字）
    /^([\u4e00-\u9fa5]{2,8})$/m,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      const name = match[1].trim().replace(/\s+/g, '')
      if (name.length >= 2 && name.length <= 20) {
        return name
      }
    }
  }

  return ''
}