/**
 * 支付截图 OCR 识别服务
 * 使用 tesseract.js 识别支付截图中的关键信息
 * 识别字段：商品名称(报销类型)、支付金额(报销金额)、支付时间(开票日期)、交易单号(发票号码)
 *
 * 性能优化 v2：
 * - 使用 tesseract.js Scheduler 管理 Worker 并行
 * - 单次全图 OCR 优先策略：一次识别提取所有信息
 * - 仅在全图识别失败时才做少量补充裁剪识别
 * - 合并预验证和全图识别，减少 OCR 调用次数
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
  rawText?: string      // 原始识别文本（用于智能修正）
}

// ==================== Scheduler 管理 ====================

let scheduler: Tesseract.Scheduler | null = null
let schedulerReady: Promise<void> | null = null

/**
 * 获取或初始化全局 Scheduler
 * 使用 tesseract.js 内置 Scheduler 管理多 Worker 并行
 */
async function getScheduler(): Promise<Tesseract.Scheduler> {
  if (scheduler) return scheduler

  if (schedulerReady) {
    await schedulerReady
    return scheduler!
  }

  schedulerReady = (async () => {
    console.log('🔧 初始化 Tesseract Scheduler...')
    scheduler = Tesseract.createScheduler()

    // 创建 2 个 Worker（并行处理，但不过度占用 CPU）
    const workers = await Promise.all([
      Tesseract.createWorker('chi_sim+eng', 1, {
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        logger: () => {}
      }),
      Tesseract.createWorker('chi_sim+eng', 1, {
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        logger: () => {}
      })
    ])

    for (const w of workers) {
      scheduler!.addWorker(w)
    }

    console.log('✅ Scheduler 初始化完成（2 Workers）')
  })()

  await schedulerReady
  return scheduler!
}

// 进程退出时清理
process.on('exit', () => {
  if (scheduler) {
    scheduler.terminate().catch(console.error)
  }
})

/**
 * 通过 Scheduler 执行 OCR 识别
 */
async function ocrRecognize(
  image: string | Buffer,
  options?: Partial<Tesseract.RecognizeOptions>
): Promise<Tesseract.RecognizeResult> {
  const s = await getScheduler()
  return s.addJob('recognize', image, options)
}

// ==================== 图片预处理辅助函数 ====================

/**
 * 统一的图片预处理函数
 * 避免在多个地方重复处理
 */
async function preprocessImage(
  imagePath: string,
  options: {
    resize?: { width: number; height: number }
    grayscale?: boolean
    normalize?: boolean
    outputName?: string
  } = {}
): Promise<string> {
  const tempDir = path.join(process.cwd(), 'uploads', 'temp')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  const outputName = options.outputName || `processed-${Date.now()}.png`
  const outputPath = path.join(tempDir, outputName)

  try {
    let pipeline = sharp(imagePath)

    if (options.resize) {
      pipeline = pipeline.resize(options.resize.width, options.resize.height, { fit: 'inside' })
    }

    if (options.grayscale) {
      pipeline = pipeline.grayscale()
    }

    if (options.normalize) {
      pipeline = pipeline.normalize()
    }

    await pipeline.toFile(outputPath)
    return outputPath
  } catch (error) {
    console.error('❌ Sharp 图片处理失败:', error)
    throw new Error('图片处理失败，可能是文件损坏或格式不支持')
  }
}

/**
 * 统一的 OCR 识别辅助函数
 * 使用 Scheduler 自动分配 Worker
 */
async function recognizeWithWorkerPool(
  imagePath: string | Buffer,
  _lang: string = 'chi_sim+eng',
  options: any = {}
): Promise<Tesseract.RecognizeResult> {
  // 过滤掉函数类型的属性，避免 DataCloneError
  const cleanOptions: any = {}
  for (const [key, value] of Object.entries(options)) {
    if (typeof value !== 'function') {
      cleanOptions[key] = value
    }
  }
  // Scheduler 的 Worker 已经初始化了 chi_sim+eng，直接用
  return ocrRecognize(imagePath, cleanOptions)
}

/**
 * 合并的验证+全图识别函数
 * 一次 OCR 同时完成：验证是否为支付截图 + 提取所有字段
 * 这是最关键的优化：将原来的 2 次 OCR（预验证 + 全图）合并为 1 次
 */
async function validateAndRecognizeFull(imagePath: string, isDark: boolean): Promise<{
  isValid: boolean
  reason?: string
  result?: ReceiptOcrResult
  rawText?: string
}> {
  console.log('🔍 单次 OCR：验证 + 全图识别...')

  let preprocessedPath: string | null = null

  try {
    // 预处理：缩小图片加快识别
    preprocessedPath = await preprocessImage(imagePath, {
      resize: { width: 800, height: 1400 },
      grayscale: true,
      normalize: true,
      outputName: `fullscan-${Date.now()}.png`
    })
  } catch (error) {
    console.error('❌ 图片预处理失败:', error)
    return { isValid: false, reason: '图片格式错误或已损坏，请重新上传' }
  }

  try {
    const { data } = await ocrRecognize(preprocessedPath)

    const text = data.text
    console.log('📄 全图识别文本片段:', text.substring(0, 300))

    // 验证：检查是否为支付/转账截图
    const textNoSpace = text.replace(/\s+/g, '')
    const successKeywords = [
      '支付成功', '转账成功', '对方已收钱',
      '收款成功', '付款成功', '交易成功',
      '转账-转给', '转账给', '已转账'  // 支持转账截图
    ]
    const hasSuccessKeyword = successKeywords.some(kw => textNoSpace.includes(kw))

    if (!hasSuccessKeyword) {
      console.log('❌ 未检测到支付成功关键词')
      return { isValid: false, reason: '此不是支付截图，请重新上传' }
    }

    console.log('✅ 验证通过，开始提取字段...')

    // 从同一次 OCR 结果中提取所有字段
    const result: ReceiptOcrResult = {
      amount: 0,
      date: '',
      transactionNo: '',
      itemName: '无票报销',
      rawText: text
    }

    parseReceiptText(text, result)

    // 补充提取明确金额
    const explicitAmounts = extractExplicitAmounts(text)
    if (result.amount === 0 && explicitAmounts.length > 0) {
      result.amount = explicitAmounts[0]
      console.log('💰 从文本提取到金额:', result.amount)
    }

    return { isValid: true, result, rawText: text }
  } finally {
    try { fs.unlinkSync(preprocessedPath) } catch (_) {}
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
 * 从上下文文本中识别金额（宽裁剪 + 低缩放 + chi_sim+eng 文本模式匹配）
 * 核心思路：不单独识别数字，而是识别包含金额的整行文本（如 "-3.00"），
 * 然后用正则提取金额。这样 Tesseract 有更多上下文，不会把 3 误识别为 5。
 */
async function recognizeAmountFromContext(imagePath: string, isDark: boolean = false): Promise<number> {
  console.log('🔍 上下文文本模式识别金额...')

  const tempDir = path.join(process.cwd(), 'uploads', 'temp')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  const metadata = await sharp(imagePath).metadata()
  const width = metadata.width || 750
  const height = metadata.height || 1334

  // 多种裁剪区域：覆盖金额可能出现的不同位置
  const cropConfigs = [
    // 标准微信支付金额位置（宽裁剪，包含 "-" 和 ".00"）
    { left: 0.05, top: 0.20, w: 0.90, h: 0.12, scale: 2, label: 'wide-std' },
    { left: 0.05, top: 0.22, w: 0.90, h: 0.10, scale: 2, label: 'wide-low' },
    { left: 0.05, top: 0.18, w: 0.90, h: 0.12, scale: 2, label: 'wide-high' },
    // 不缩放，保持原始大小（金额本身已经够大）
    { left: 0.10, top: 0.20, w: 0.80, h: 0.12, scale: 1, label: 'noscale-std' },
    { left: 0.10, top: 0.22, w: 0.80, h: 0.10, scale: 1, label: 'noscale-low' },
    // 缩小（模拟交易单号中小字体的效果，Tesseract 对小字体 3 识别更准）
    { left: 0.05, top: 0.20, w: 0.90, h: 0.12, scale: 0.5, label: 'downscale' },
  ]

  const amounts: number[] = []
  const tempFiles: string[] = []

  for (const cfg of cropConfigs) {
    try {
      const cropLeft = Math.floor(width * cfg.left)
      const cropTop = Math.floor(height * cfg.top)
      const cropWidth = Math.min(Math.floor(width * cfg.w), width - cropLeft)
      const cropHeight = Math.min(Math.floor(height * cfg.h), height - cropTop)

      if (cropWidth <= 0 || cropHeight <= 0) continue

      const tempPath = path.join(tempDir, `ctx-${cfg.label}-${Date.now()}.png`)
      tempFiles.push(tempPath)

      let pipeline = sharp(imagePath)
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })

      // 缩放
      if (cfg.scale !== 1) {
        pipeline = pipeline.resize(
          Math.floor(cropWidth * cfg.scale),
          Math.floor(cropHeight * cfg.scale),
          { fit: 'fill' }
        )
      }

      pipeline = pipeline.grayscale().normalize()

      if (isDark) {
        pipeline = pipeline.negate()
      }

      await pipeline.toFile(tempPath)

      // 用 chi_sim+eng 识别整行文本（不限制白名单，让 Tesseract 有完整上下文）
      const { data } = await recognizeWithWorkerPool(tempPath, 'chi_sim+eng', {
        logger: () => {},
        tessedit_pageseg_mode: '6', // PSM_SINGLE_BLOCK - 识别一个文本块
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      } as any)

      const text = data.text.replace(/\s+/g, ' ').trim()
      console.log(`  📝 ${cfg.label}: "${text}"`)

      // 从文本中提取金额
      const extracted = extractAmountFromText(text)
      if (extracted > 0) {
        amounts.push(extracted)
        console.log(`  ✓ ${cfg.label}: 提取金额 ${extracted}`)
      }

      // 再用 eng + 数字白名单识别一次（双重验证）
      const { data: data2 } = await recognizeWithWorkerPool(tempPath, 'eng', {
        logger: () => {},
        tessedit_pageseg_mode: '7', // PSM_SINGLE_LINE
        tessedit_char_whitelist: '0123456789.-',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      } as any)

      const text2 = data2.text.trim()
      if (text2) {
        const cleaned = postProcessAmount(text2)
        if (cleaned) {
          const amt = parseFloat(cleaned)
          if (amt > 0 && amt < 100000) {
            amounts.push(amt)
            console.log(`  ✓ ${cfg.label}-eng: ${amt}`)
          }
        }
      }
    } catch (e) {
      // 忽略单个裁剪失败
    }
  }

  // 清理临时文件
  for (const f of tempFiles) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch (_) {}
  }

  if (amounts.length === 0) {
    console.log('  ✗ 上下文模式未识别到金额')
    return 0
  }

  // 投票
  const votes: Record<string, number> = {}
  amounts.forEach(a => {
    const key = a.toFixed(2)
    votes[key] = (votes[key] || 0) + 1
  })

  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1])
  console.log('  📊 上下文模式投票:', JSON.stringify(votes))

  const bestAmount = parseFloat(sorted[0][0])
  console.log(`  ✅ 上下文模式结果: ${bestAmount} (${sorted[0][1]}/${amounts.length}票)`)
  return bestAmount
}

/**
 * 从识别的文本中提取金额数字
 */
function extractAmountFromText(text: string): number {
  // 去除空格便于匹配
  const t = text.replace(/\s+/g, '')

  // 排除零钱/余额相关的金额（交通类截图中常见）
  // 先检查是否有零钱关键词，如果有，需要更精细地提取
  const hasWalletKeyword = /零钱|余额|钱包|找零|充值/.test(t)

  // 模式1: -3.00 或 —3.00 或 –3.00（支付金额，最高优先级）
  const m1 = t.match(/[-–—]\s*(\d{1,6}\.\d{2})/)
  if (m1) {
    // 检查这个金额前面是否有零钱关键词（如"零钱-3.00"应该跳过）
    const beforeMatch = t.substring(0, m1.index || 0)
    const isWalletAmount = /零钱|余额|钱包|找零/.test(beforeMatch.slice(-10))
    if (!isWalletAmount) {
      const amt = parseFloat(m1[1])
      if (amt > 0 && amt < 100000) return amt
    }
  }

  // 模式2: ¥3.00（但排除零钱/余额关联的金额）
  if (hasWalletKeyword) {
    // 有零钱关键词时，用全局匹配找所有 ¥X.XX，跳过零钱关联的
    const allMatches = [...t.matchAll(/[¥￥]\s*(\d{1,6}\.\d{2})/g)]
    for (const m of allMatches) {
      const pos = m.index || 0
      const context = t.substring(Math.max(0, pos - 10), pos)
      if (/零钱|余额|钱包|找零/.test(context)) continue // 跳过零钱金额
      const amt = parseFloat(m[1])
      if (amt > 0 && amt < 100000) return amt
    }
  } else {
    const m2 = t.match(/[¥￥]\s*(\d{1,6}\.\d{2})/)
    if (m2) {
      const amt = parseFloat(m2[1])
      if (amt > 0 && amt < 100000) return amt
    }
  }

  // 模式3: 独立的 X.XX 格式（不是长数字串的一部分，且不关联零钱）
  if (hasWalletKeyword) {
    const allMatches = [...t.matchAll(/(?<!\d)(\d{1,4}\.\d{2})(?!\d)/g)]
    for (const m of allMatches) {
      const pos = m.index || 0
      const context = t.substring(Math.max(0, pos - 10), pos)
      if (/零钱|余额|钱包|找零/.test(context)) continue
      const amt = parseFloat(m[1])
      if (amt > 0 && amt < 100000) return amt
    }
  } else {
    const m3 = t.match(/(?<!\d)(\d{1,4}\.\d{2})(?!\d)/)
    if (m3) {
      const amt = parseFloat(m3[1])
      if (amt > 0 && amt < 100000) return amt
    }
  }

  return 0
}

/**
 * 裁剪金额区域（微信支付截图金额位置）
 * @param imagePath 图片路径
 * @param isDark 是否为深色模式
 * @param topOffset 顶部位置偏移（相对于高度的百分比，例如 0.02 表示向下偏移 2%）
 * @param scaleFactor 放大倍数，默认 4
 */
async function cropAmountArea(
  imagePath: string,
  isDark: boolean = false,
  topOffset: number = 0,
  scaleFactor: number = 4
): Promise<string> {
  try {
    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const croppedPath = path.join(tempDir, `amount-crop-${Date.now()}-${Math.random().toString(36).substring(7)}.png`)

    // 获取图片尺寸
    const metadata = await sharp(imagePath).metadata()
    const width = metadata.width || 750
    const height = metadata.height || 1334

    // 根据图片尺寸计算裁剪区域（金额通常在中上部）
    // 微信支付截图金额位置：居中，在商户名称下方，大号数字
    const cropLeft = Math.floor(width * 0.15)   // 左侧 15%
    const baseTopRatio = 0.23 + topOffset       // 顶部 23% + 偏移量
    const cropTop = Math.floor(height * baseTopRatio)
    const cropWidth = Math.floor(width * 0.7)   // 宽度 70%
    const cropHeight = Math.floor(height * 0.06) // 高度 6%（仅金额数字行）

    let pipeline = sharp(imagePath)
      .extract({
        left: cropLeft,
        top: cropTop,
        width: cropWidth,
        height: cropHeight,
      })
      .resize(cropWidth * scaleFactor, cropHeight * scaleFactor) // 放大提高识别率
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
    console.log(`   裁剪区域: left=${cropLeft}, top=${cropTop}, width=${cropWidth}, height=${cropHeight}, scale=${scaleFactor}x, offset=${topOffset}`)
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
      const { data: data1 } = await recognizeWithWorkerPool(croppedPath, 'chi_sim+eng', {
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
      const { data: data2 } = await recognizeWithWorkerPool(croppedPath, 'chi_sim+eng', {
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

interface AmountCharacterSegment {
  left: number
  top: number
  width: number
  height: number
  kind: 'digit' | 'dot' | 'minus'
}

interface AmountSegmentationResult {
  segments: AmountCharacterSegment[]
  imageWidth: number
  imageHeight: number
}

/**
 * 金额识别结果（带策略和置信度）
 */
interface AmountRecognitionResult {
  amount: number
  confidence: number
  strategy: string
}

/**
 * 专门针对金额识别的预处理 - 多策略版本
 * @param variant 预处理变体：'default' | 'high-threshold' | 'low-threshold' | 'adaptive' | 'ultra-sharp' | 'gentle'
 */
async function preprocessForAmount(
  imagePath: string,
  variant: 'default' | 'high-threshold' | 'low-threshold' | 'adaptive' | 'ultra-sharp' | 'gentle' = 'default',
  isDark: boolean = false
): Promise<string> {
  try {
    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const processedPath = path.join(tempDir, `amount-${variant}-${Date.now()}.png`)

    let pipeline = sharp(imagePath)
      .resize(2000, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()

    // 如果是深色模式，先反转颜色
    if (isDark) {
      pipeline = pipeline.negate()
    }

    // 根据变体应用不同的预处理策略
    switch (variant) {
      case 'high-threshold':
        // 高阈值 - 适合深色数字
        pipeline = pipeline
          .normalize()
          .linear(1.5, -(128 * 0.5))
          .sharpen({ sigma: 1.5 })
          .threshold(150)
        break

      case 'low-threshold':
        // 低阈值 - 适合浅色数字和细线条（如细体的3）
        pipeline = pipeline
          .normalize()
          .linear(1.5, -(128 * 0.5))
          .sharpen({ sigma: 1.5 })
          .threshold(100)
        break

      case 'adaptive':
        // 自适应 - 不使用固定阈值，只增强对比度
        pipeline = pipeline
          .normalize()
          .linear(2.0, -(128 * 0.6))
          .sharpen({ sigma: 2 })
        break

      case 'ultra-sharp':
        // 超锐化 - 针对细线条数字（如细体的3）
        pipeline = pipeline
          .normalize()
          .linear(2.5, -(128 * 0.7))  // 更强的对比度
          .sharpen({ sigma: 3 })       // 更强的锐化
          .threshold(110)              // 中等阈值
        break

      case 'gentle':
        // 温和处理 - 保留更多细节，避免过度处理导致数字变形
        pipeline = pipeline
          .normalize()
          .linear(1.2, -(128 * 0.3))  // 轻微对比度增强
          .sharpen({ sigma: 1 })       // 轻微锐化
          .threshold(120)              // 中等偏低阈值
        break

      case 'default':
      default:
        // 默认策略
        pipeline = pipeline
          .normalize()
          .linear(1.5, -(128 * 0.5))
          .sharpen({ sigma: 1.5 })
          .threshold(128)
        break
    }

    await pipeline.toFile(processedPath)

    console.log(`✅ 金额预处理完成(${variant}):`, processedPath)
    return processedPath
  } catch (error) {
    console.error('⚠️  金额预处理失败:', error)
    return imagePath
  }
}

/**
 * 对金额行做字符分割，便于单字符 OCR 避免 3/5 这类形状相近数字被整体误识别
 */
async function detectAmountCharacterSegments(imagePath: string): Promise<AmountSegmentationResult | null> {
  try {
    const { data, info } = await sharp(imagePath)
      .grayscale()
      .normalize()
      .threshold(180)
      .raw()
      .toBuffer({ resolveWithObject: true })

    const imageWidth = info.width
    const imageHeight = info.height
    const channels = info.channels || 1
    const columnHasInk: boolean[] = []

    for (let x = 0; x < imageWidth; x++) {
      let hasInk = false
      for (let y = 0; y < imageHeight; y++) {
        if (data[(y * imageWidth + x) * channels] < 128) {
          hasInk = true
          break
        }
      }
      columnHasInk.push(hasInk)
    }

    const rawSegments: Array<{ left: number; top: number; width: number; height: number }> = []
    let start = -1

    for (let x = 0; x < imageWidth; x++) {
      if (columnHasInk[x] && start === -1) {
        start = x
      }

      if ((!columnHasInk[x] || x === imageWidth - 1) && start !== -1) {
        const end = columnHasInk[x] ? x : x - 1
        let top = imageHeight
        let bottom = -1

        for (let sx = start; sx <= end; sx++) {
          for (let y = 0; y < imageHeight; y++) {
            if (data[(y * imageWidth + sx) * channels] < 128) {
              if (y < top) top = y
              if (y > bottom) bottom = y
            }
          }
        }

        if (bottom >= top) {
          rawSegments.push({
            left: start,
            top,
            width: end - start + 1,
            height: bottom - top + 1,
          })
        }

        start = -1
      }
    }

    if (rawSegments.length < 4 || rawSegments.length > 10) {
      console.log(`  ✗ 字符分割失败: 分段数量异常(${rawSegments.length})`)
      return null
    }

    const maxHeight = Math.max(...rawSegments.map(segment => segment.height))
    const segments: AmountCharacterSegment[] = []

    for (const segment of rawSegments) {
      const heightRatio = segment.height / maxHeight
      const widthRatio = segment.width / maxHeight

      if (heightRatio <= 0.26) {
        segments.push({
          ...segment,
          kind: widthRatio >= 0.35 ? 'minus' : 'dot',
        })
        continue
      }

      if (heightRatio >= 0.45) {
        segments.push({
          ...segment,
          kind: 'digit',
        })
      }
    }

    if (segments.filter(segment => segment.kind === 'digit').length < 3) {
      console.log('  ✗ 字符分割失败: 数字段数量不足')
      return null
    }

    return {
      segments,
      imageWidth,
      imageHeight,
    }
  } catch (error) {
    console.error('⚠️  金额字符分割失败:', error)
    return null
  }
}

/**
 * 对单个数字字符执行 OCR - 多策略投票版
 * 使用多种阈值、缩放、反色等预处理策略识别单个数字，投票选出最佳结果
 */
async function recognizeAmountDigitSegment(
  imagePath: string,
  segment: AmountCharacterSegment,
  imageWidth: number,
  imageHeight: number
): Promise<string> {
  const padding = Math.max(12, Math.floor(Math.max(segment.width, segment.height) * 0.15))
  const extractLeft = Math.max(0, segment.left - padding)
  const extractTop = Math.max(0, segment.top - padding)
  const extractWidth = Math.min(imageWidth - extractLeft, segment.width + padding * 2)
  const extractHeight = Math.min(imageHeight - extractTop, segment.height + padding * 2)

  const votes: Record<string, number> = {}

  // 基础提取
  const baseBuffer = await sharp(imagePath)
    .extract({
      left: extractLeft,
      top: extractTop,
      width: extractWidth,
      height: extractHeight,
    })
    .png()
    .toBuffer()

  // 策略组：不同缩放 + 不同阈值 + 反色 + 不同 PSM + 模糊
  const strategies: Array<{
    label: string
    resize?: number       // 缩放目标高度
    threshold: number
    sharpen: boolean
    negate: boolean       // 是否反色
    psm: string           // 页面分割模式
    erode?: boolean       // 是否腐蚀（细化笔画）
    blur?: number         // 模糊半径（改变笔画形状）
    medianFilter?: number // 中值滤波（去噪同时改变形状）
  }> = [
    // 组1: 不同阈值（标准大小）
    { label: 'std-170', threshold: 170, sharpen: false, negate: false, psm: '10' },
    { label: 'std-140', threshold: 140, sharpen: false, negate: false, psm: '10' },
    { label: 'std-100', threshold: 100, sharpen: false, negate: false, psm: '10' },
    // 组2: 反色识别
    { label: 'neg-140', threshold: 140, sharpen: false, negate: true, psm: '10' },
    { label: 'neg-170', threshold: 170, sharpen: false, negate: true, psm: '10' },
    // 组3: 不同缩放大小
    { label: 'big-140', resize: 120, threshold: 140, sharpen: false, negate: false, psm: '10' },
    { label: 'small-140', resize: 40, threshold: 140, sharpen: false, negate: false, psm: '10' },
    // 组4: 锐化 + 不同阈值
    { label: 'sharp-120', threshold: 120, sharpen: true, negate: false, psm: '10' },
    { label: 'sharp-160', threshold: 160, sharpen: true, negate: false, psm: '10' },
    // 组5: 不同 PSM 模式
    { label: 'psm8-140', threshold: 140, sharpen: false, negate: false, psm: '8' },
    { label: 'psm13-140', threshold: 140, sharpen: false, negate: false, psm: '13' },
    // 组6: 模糊预处理（改变笔画形状，可能产生不同识别结果）
    { label: 'blur1-140', threshold: 140, sharpen: false, negate: false, psm: '10', blur: 1 },
    { label: 'blur2-140', threshold: 140, sharpen: false, negate: false, psm: '10', blur: 2 },
    { label: 'blur3-170', threshold: 170, sharpen: false, negate: false, psm: '10', blur: 3 },
    // 组7: 中值滤波（去噪 + 改变形状）
    { label: 'med3-140', threshold: 140, sharpen: false, negate: false, psm: '10', medianFilter: 3 },
    { label: 'med5-140', threshold: 140, sharpen: false, negate: false, psm: '10', medianFilter: 5 },
    // 组8: 模糊 + 反色组合
    { label: 'blur2-neg-140', threshold: 140, sharpen: false, negate: true, psm: '10', blur: 2 },
    // 组9: 极端缩小（模拟交易单号中小字体的大小，Tesseract 对小字体 3 识别更准）
    { label: 'tiny10-140', resize: 10, threshold: 140, sharpen: false, negate: false, psm: '10' },
    { label: 'tiny12-140', resize: 12, threshold: 140, sharpen: false, negate: false, psm: '10' },
    { label: 'tiny14-140', resize: 14, threshold: 140, sharpen: false, negate: false, psm: '10' },
    { label: 'tiny16-140', resize: 16, threshold: 140, sharpen: false, negate: false, psm: '10' },
    { label: 'tiny18-140', resize: 18, threshold: 140, sharpen: false, negate: false, psm: '10' },
    { label: 'tiny20-140', resize: 20, threshold: 140, sharpen: false, negate: false, psm: '10' },
    { label: 'tiny24-140', resize: 24, threshold: 140, sharpen: false, negate: false, psm: '10' },
    { label: 'tiny10-170', resize: 10, threshold: 170, sharpen: false, negate: false, psm: '10' },
    { label: 'tiny14-170', resize: 14, threshold: 170, sharpen: false, negate: false, psm: '10' },
    { label: 'tiny20-170', resize: 20, threshold: 170, sharpen: false, negate: false, psm: '10' },
    { label: 'huge-140', resize: 200, threshold: 140, sharpen: false, negate: false, psm: '10' },
    { label: 'psm13-140', threshold: 140, sharpen: false, negate: false, psm: '13' },
  ]

  for (const strategy of strategies) {
    try {
      let pipeline = sharp(baseBuffer)
        .grayscale()
        .normalize()

      // 缩放
      if (strategy.resize) {
        pipeline = pipeline.resize(null, strategy.resize, { fit: 'inside' })
      }

      // 模糊（在二值化之前，改变笔画形状）
      if (strategy.blur) {
        pipeline = pipeline.blur(strategy.blur)
      }

      // 中值滤波（在二值化之前，去噪 + 改变形状）
      if (strategy.medianFilter) {
        pipeline = pipeline.median(strategy.medianFilter)
      }

      // 锐化
      if (strategy.sharpen) {
        pipeline = pipeline.sharpen({ sigma: 2 })
      }

      // 阈值二值化
      pipeline = pipeline.threshold(strategy.threshold)

      // 反色
      if (strategy.negate) {
        pipeline = pipeline.negate()
      }

      // 添加白色边距
      const buffer = await pipeline
        .extend({
          top: 20,
          bottom: 20,
          left: 20,
          right: 20,
          background: strategy.negate ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 },
        })
        .png()
        .toBuffer()

      const { data } = await recognizeWithWorkerPool(buffer, 'eng', {
        logger: () => {},
        tessedit_pageseg_mode: strategy.psm,
        tessedit_char_whitelist: '0123456789',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      } as any)

      const digit = data.text.replace(/\D/g, '').slice(0, 1)
      if (digit) {
        votes[digit] = (votes[digit] || 0) + 1
      }
    } catch {
      // 忽略单个策略的失败
    }
  }

  if (Object.keys(votes).length === 0) {
    return ''
  }

  // 投票选出最佳结果
  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1])
  const bestDigit = sorted[0][0]
  const bestVotes = sorted[0][1]

  console.log(`    字符投票: ${JSON.stringify(votes)} → ${bestDigit} (${bestVotes}/${strategies.length}票)`)

  // 🔬 自定义分类器：当识别结果是 3 或 5 时，用特征分析进行二次验证
  if (bestDigit === '3' || bestDigit === '5') {
    const corrected = await customDigitClassifier(baseBuffer, bestDigit)
    if (corrected !== null && corrected !== bestDigit) {
      console.log(`    🔬 自定义分类器修正: ${bestDigit} → ${corrected}`)
      return corrected
    }
  }

  return bestDigit
}

/**
 * 自定义数字分类器：专门区分 3 和 5
 * 使用硬编码规则，基于实际观察的特征
 */
async function customDigitClassifier(digitBuffer: Buffer, ocrResult: string): Promise<string | null> {
  try {
    // 标准化为固定大小的二值图
    const { data, info } = await sharp(digitBuffer)
      .resize(60, 90, { fit: 'fill' })
      .grayscale()
      .normalize()
      .threshold(128)
      .raw()
      .toBuffer({ resolveWithObject: true })

    const width = info.width
    const height = info.height
    const channels = info.channels || 1

    const isInk = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false
      return data[(y * width + x) * channels] < 128
    }

    // 特征1: 中间横线强度（5 的关键特征）
    const middleLineStrength = calcMiddleLineStrength(isInk, width, height)

    // 特征2: 顶部闭合度（3 的关键特征）
    const topClosure = calcTopClosureSimple(isInk, width, height)

    // 特征3: 左侧开口数量（3 有两个，5 有一个）
    const leftOpenings = calcLeftOpeningsSimple(isInk, width, height)

    // 特征4: 整体像素密度（3 通常比 5 瘦）
    const pixelDensity = calcPixelDensity(isInk, width, height)

    console.log(`    🔬 特征: 中间线=${middleLineStrength.toFixed(2)}, 顶闭=${topClosure.toFixed(2)}, 左开=${leftOpenings}, 密度=${pixelDensity.toFixed(2)}`)

    // 硬编码规则（基于实际观察）
    // 规则1: 如果有明显的中间横线 → 5
    if (middleLineStrength > 0.45) {
      console.log(`    🔬 规则1: 中间横线强(${middleLineStrength.toFixed(2)}) → 5`)
      return '5'
    }

    // 规则2: 如果顶部明显闭合且无中间横线 → 3
    if (topClosure > 0.55 && middleLineStrength < 0.35) {
      console.log(`    🔬 规则2: 顶部闭合(${topClosure.toFixed(2)})且无横线 → 3`)
      return '3'
    }

    // 规则3: 如果左侧有两个开口且无中间横线 → 3
    if (leftOpenings >= 2 && middleLineStrength < 0.35) {
      console.log(`    🔬 规则3: 左侧${leftOpenings}个开口且无横线 → 3`)
      return '3'
    }

    // 规则4: 如果像素密度低（瘦）且无中间横线 → 3
    if (pixelDensity < 0.35 && middleLineStrength < 0.35) {
      console.log(`    🔬 规则4: 密度低(${pixelDensity.toFixed(2)})且无横线 → 3`)
      return '3'
    }

    // 特征不明显，保持 OCR 结果
    console.log(`    🔬 特征不明显，保持 OCR 结果: ${ocrResult}`)
    return null
  } catch (error) {
    console.error('    🔬 自定义分类器失败:', error)
    return null
  }
}

/** 计算中间横线强度 */
function calcMiddleLineStrength(
  isInk: (x: number, y: number) => boolean,
  width: number,
  height: number
): number {
  const midY = Math.floor(height * 0.5)
  const range = Math.floor(height * 0.15)
  let maxLine = 0

  for (let y = midY - range; y <= midY + range; y++) {
    let lineLen = 0
    for (let x = 0; x < width; x++) {
      if (isInk(x, y)) {
        lineLen++
        maxLine = Math.max(maxLine, lineLen)
      } else {
        lineLen = 0
      }
    }
  }

  return width > 0 ? maxLine / width : 0
}

/** 计算顶部闭合度（简化版） */
function calcTopClosureSimple(
  isInk: (x: number, y: number) => boolean,
  width: number,
  height: number
): number {
  const topH = Math.floor(height * 0.35)
  let closedRows = 0

  for (let y = 0; y < topH; y++) {
    let leftmost = -1
    let rightmost = -1

    for (let x = 0; x < width; x++) {
      if (isInk(x, y)) {
        if (leftmost === -1) leftmost = x
        rightmost = x
      }
    }

    if (leftmost !== -1 && rightmost !== -1 && rightmost - leftmost > width * 0.4) {
      // 检查中间是否有墨水
      let midInk = 0
      const midStart = leftmost + Math.floor((rightmost - leftmost) * 0.3)
      const midEnd = leftmost + Math.floor((rightmost - leftmost) * 0.7)
      for (let x = midStart; x < midEnd; x++) {
        if (isInk(x, y)) midInk++
      }
      if (midInk > (midEnd - midStart) * 0.2) {
        closedRows++
      }
    }
  }

  return topH > 0 ? closedRows / topH : 0
}

/** 计算左侧开口数量（简化版） */
function calcLeftOpeningsSimple(
  isInk: (x: number, y: number) => boolean,
  width: number,
  height: number
): number {
  const leftBound = Math.floor(width * 0.25)
  let openings = 0
  let wasOpen = true

  for (let y = 0; y < height; y++) {
    let hasInk = false
    for (let x = 0; x < leftBound; x++) {
      if (isInk(x, y)) {
        hasInk = true
        break
      }
    }

    if (wasOpen && hasInk) {
      wasOpen = false
    } else if (!wasOpen && !hasInk) {
      wasOpen = true
      openings++
    }
  }

  if (wasOpen) openings++
  return openings
}

/** 计算整体像素密度 */
function calcPixelDensity(
  isInk: (x: number, y: number) => boolean,
  width: number,
  height: number
): number {
  let inkPixels = 0
  let totalPixels = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isInk(x, y)) inkPixels++
      totalPixels++
    }
  }

  return totalPixels > 0 ? inkPixels / totalPixels : 0
}

/**
 * 优先使用字符分割重建金额字符串 - 增强版
 * 尝试多种预处理组合，提高识别准确率
 */
async function recognizeAmountByCharacters(imagePath: string, label: string = ''): Promise<number> {
  console.log('  🔍 尝试多种预处理组合进行字符分割识别...')

  const results: Array<{ amount: number; method: string }> = []

  // 预处理组合1: 原始方法（阈值 180）
  try {
    const amount1 = await recognizeWithPreprocessing(imagePath, 'threshold-180', (img) =>
      img.grayscale().normalize().threshold(180)
    )
    if (amount1 > 0) {
      results.push({ amount: amount1, method: 'threshold-180' })
      console.log(`    ✓ 阈值180: ${amount1}`)
    }
  } catch (e) {
    console.log(`    ✗ 阈值180: 失败`)
  }

  // 预处理组合2: 更高阈值（让笔画变细，3和5的区别更明显）
  try {
    const amount2 = await recognizeWithPreprocessing(imagePath, 'threshold-200', (img) =>
      img.grayscale().normalize().threshold(200)
    )
    if (amount2 > 0) {
      results.push({ amount: amount2, method: 'threshold-200' })
      console.log(`    ✓ 阈值200: ${amount2}`)
    }
  } catch (e) {
    console.log(`    ✗ 阈值200: 失败`)
  }

  // 预处理组合3: 较低阈值（保留更多细节）
  try {
    const amount3 = await recognizeWithPreprocessing(imagePath, 'threshold-150', (img) =>
      img.grayscale().normalize().threshold(150)
    )
    if (amount3 > 0) {
      results.push({ amount: amount3, method: 'threshold-150' })
      console.log(`    ✓ 阈值150: ${amount3}`)
    }
  } catch (e) {
    console.log(`    ✗ 阈值150: 失败`)
  }

  // 预处理组合4: 锐化后二值化
  try {
    const amount4 = await recognizeWithPreprocessing(imagePath, 'sharpen-180', (img) =>
      img.grayscale().normalize().sharpen({ sigma: 2 }).threshold(180)
    )
    if (amount4 > 0) {
      results.push({ amount: amount4, method: 'sharpen-180' })
      console.log(`    ✓ 锐化+阈值180: ${amount4}`)
    }
  } catch (e) {
    console.log(`    ✗ 锐化+阈值180: 失败`)
  }

  // 预处理组合5: 模糊后二值化（改变笔画形状）
  try {
    const amount5 = await recognizeWithPreprocessing(imagePath, 'blur-180', (img) =>
      img.grayscale().normalize().blur(1.5).threshold(180)
    )
    if (amount5 > 0) {
      results.push({ amount: amount5, method: 'blur-180' })
      console.log(`    ✓ 模糊+阈值180: ${amount5}`)
    }
  } catch (e) {
    console.log(`    ✗ 模糊+阈值180: 失败`)
  }

  if (results.length === 0) {
    console.log(`  ✗ ${label}-char: 所有预处理组合均失败`)
    return 0
  }

  // 投票决定最终结果
  const votes: Record<number, number> = {}
  results.forEach(r => {
    votes[r.amount] = (votes[r.amount] || 0) + 1
  })

  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1])
  const finalAmount = parseFloat(sorted[0][0])
  const voteCount = sorted[0][1]

  console.log(`  ✅ ${label}-char: ${finalAmount} (${voteCount}/${results.length}票)`)
  return finalAmount
}

/**
 * 使用指定预处理方法进行字符分割识别
 */
async function recognizeWithPreprocessing(
  imagePath: string,
  method: string,
  preprocessor: (img: sharp.Sharp) => sharp.Sharp
): Promise<number> {
  // 创建临时预处理图像
  const tempPath = path.join(process.cwd(), 'uploads', 'temp', `preprocess-${method}-${Date.now()}.png`)
  await preprocessor(sharp(imagePath)).toFile(tempPath)

  try {
    // 使用预处理后的图像进行字符分割
    const segmentation = await detectAmountCharacterSegments(tempPath)
    if (!segmentation) {
      return 0
    }

    const parts: string[] = []

    for (const segment of segmentation.segments) {
      if (segment.kind === 'minus') {
        continue
      }

      if (segment.kind === 'dot') {
        if (!parts.includes('.') && parts.some(part => /\d/.test(part))) {
          parts.push('.')
        }
        continue
      }

      const digit = await recognizeAmountDigitSegment(
        tempPath,
        segment,
        segmentation.imageWidth,
        segmentation.imageHeight
      )

      if (!digit) {
        return 0
      }

      parts.push(digit)
    }

    if (parts.length === 0) {
      return 0
    }

    let amountText = parts.join('').replace(/^\.+/, '')

    if (!amountText.includes('.')) {
      const digitsOnly = amountText.replace(/\D/g, '')
      if (digitsOnly.length >= 3) {
        amountText = `${digitsOnly.slice(0, -2)}.${digitsOnly.slice(-2)}`
      } else {
        amountText = digitsOnly
      }
    }

    const cleaned = postProcessAmount(amountText)
    if (!cleaned) {
      return 0
    }

    const amount = parseFloat(cleaned)
    if (!isNaN(amount) && amount > 0 && amount < 100000) {
      return amount
    }

    return 0
  } finally {
    // 清理临时文件
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }
    } catch (e) {
      // 忽略清理错误
    }
  }
}

/**
 * 原始的字符分割识别函数（已弃用，保留作为备用）
 */
async function recognizeAmountByCharactersLegacy(imagePath: string, label: string = ''): Promise<number> {
  try {
    const segmentation = await detectAmountCharacterSegments(imagePath)
    if (!segmentation) {
      return 0
    }

    const parts: string[] = []

    for (const segment of segmentation.segments) {
      if (segment.kind === 'minus') {
        continue
      }

      if (segment.kind === 'dot') {
        if (!parts.includes('.') && parts.some(part => /\d/.test(part))) {
          parts.push('.')
        }
        continue
      }

      const digit = await recognizeAmountDigitSegment(
        imagePath,
        segment,
        segmentation.imageWidth,
        segmentation.imageHeight
      )

      if (!digit) {
        console.log(`  ✗ ${label}-char: 数字段识别失败`)
        return 0
      }

      parts.push(digit)
    }

    if (parts.length === 0) {
      return 0
    }

    let amountText = parts.join('').replace(/^\.+/, '')

    if (!amountText.includes('.')) {
      const digitsOnly = amountText.replace(/\D/g, '')
      if (digitsOnly.length >= 3) {
        amountText = `${digitsOnly.slice(0, -2)}.${digitsOnly.slice(-2)}`
      } else {
        amountText = digitsOnly
      }
    }

    const cleaned = postProcessAmount(amountText)
    if (!cleaned) {
      return 0
    }

    const amount = parseFloat(cleaned)
    if (!isNaN(amount) && amount > 0 && amount < 100000) {
      console.log(`  ✓ ${label}-char: ${amount} (重建: ${amountText})`)
      return amount
    }

    return 0
  } catch (error) {
    console.error(`  ✗ ${label}-char:`, error)
    return 0
  }
}

/**
 * 使用字符白名单识别金额（单次，作为字符分割失败时的兜底）
 * 返回金额和置信度
 */
async function recognizeAmountSingle(imagePath: string, label: string = ''): Promise<{ amount: number; confidence: number }> {
  try {
    const { data } = await recognizeWithWorkerPool(imagePath, 'eng', {
      logger: () => {},
      tessedit_pageseg_mode: '7', // PSM_SINGLE_LINE
      tessedit_char_whitelist: '0123456789.-',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    } as any)

    const cleaned = postProcessAmount(data.text)
    if (cleaned) {
      const amount = parseFloat(cleaned)
      if (!isNaN(amount) && amount > 0 && amount < 100000) {
        const confidence = data.confidence / 100 // Tesseract 返回 0-100，转换为 0-1
        console.log(`  ✓ ${label}: ${amount} (置信度: ${confidence.toFixed(2)}, 原始: ${data.text.trim()})`)
        return { amount, confidence }
      }
    }
    console.log(`  ✗ ${label}: 无效 (原始: ${data.text.trim()})`)
    return { amount: 0, confidence: 0 }
  } catch (error) {
    return { amount: 0, confidence: 0 }
  }
}

/**
 * 改进的投票策略：根据策略权重和置信度选择最佳结果
 */
function improvedVotingStrategy(recognizedAmounts: AmountRecognitionResult[]): number {
  if (recognizedAmounts.length === 0) {
    return 0
  }

  // 记录每个识别结果的加权票数和最高置信度
  const votes: Record<string, number> = {}
  const confidenceScores: Record<string, number> = {}

  recognizedAmounts.forEach(result => {
    const amountKey = result.amount.toFixed(2)
    const confidence = result.confidence

    // 根据不同预处理策略赋予不同权重
    let weight = 1.0
    if (result.strategy === 'adaptive') weight = 1.2      // 自适应对比度效果更好
    if (result.strategy === 'ultra-sharp') weight = 1.15  // 超锐化对细线条数字有优势
    if (result.strategy === 'gentle') weight = 1.1        // 温和处理避免变形
    if (result.strategy === 'low-threshold') weight = 1.05 // 低阈值对浅色数字有优势

    // 加权投票
    votes[amountKey] = (votes[amountKey] || 0) + weight
    // 记录该金额的最高置信度
    confidenceScores[amountKey] = Math.max(confidenceScores[amountKey] || 0, confidence)
  })

  // 找出最高票数
  const maxVotes = Math.max(...Object.values(votes))
  const candidates = Object.entries(votes)
    .filter(([_, count]) => count >= maxVotes * 0.9) // 允许10%的误差范围
    .map(([amount]) => amount)

  // 如果有多个候选，选择置信度最高的
  if (candidates.length > 1) {
    const best = candidates.reduce((best, current) =>
      confidenceScores[current] > confidenceScores[best] ? current : best
    )
    console.log(`📊 多个候选金额，选择置信度最高的: ${best} (置信度: ${confidenceScores[best].toFixed(2)})`)
    return parseFloat(best)
  }

  const finalAmount = parseFloat(candidates[0])
  const finalVotes = votes[candidates[0]]
  const finalConfidence = confidenceScores[candidates[0]]

  console.log(`✅ 最终金额: ${finalAmount} (加权票数: ${finalVotes.toFixed(2)}, 置信度: ${finalConfidence.toFixed(2)})`)
  return finalAmount
}

/**
 * 多策略投票识别金额
 * 使用不同预处理参数分别识别，取出现次数最多的结果
 */
async function recognizeAmountWithVoting(croppedPath: string, isDark: boolean = false): Promise<number> {
  console.log('🔍 多策略投票识别金额...')

  const segmentedAmount = await recognizeAmountByCharacters(croppedPath, 'raw')
  if (segmentedAmount > 0) {
    console.log('✅ 字符分割识别成功，优先使用该结果')
    return segmentedAmount
  }

  const variants: Array<'default' | 'high-threshold' | 'low-threshold' | 'adaptive' | 'ultra-sharp' | 'gentle'> = [
    'default',
    'high-threshold',
    'low-threshold',
    'adaptive',
    'ultra-sharp',  // 新增：针对细线条数字
    'gentle',       // 新增：温和处理避免变形
  ]

  const results: AmountRecognitionResult[] = []
  const processedImages: string[] = []

  for (const variant of variants) {
    const processedPath = await preprocessForAmount(croppedPath, variant, isDark)
    processedImages.push(processedPath)

    const { amount, confidence } = await recognizeAmountSingle(processedPath, variant)
    if (amount > 0) {
      results.push({ amount, confidence, strategy: variant })
    }
  }

  // 也对原始裁剪图直接识别一次（不做额外预处理）
  const { amount: rawAmount, confidence: rawConfidence } = await recognizeAmountSingle(croppedPath, 'raw')
  if (rawAmount > 0) {
    results.push({ amount: rawAmount, confidence: rawConfidence, strategy: 'raw' })
  }

  // 清理临时文件
  for (const imgPath of processedImages) {
    try {
      if (imgPath !== croppedPath && fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath)
      }
    } catch (e) {
      // 忽略
    }
  }

  if (results.length === 0) {
    console.log('⚠️  所有策略均未识别到金额')
    return 0
  }

  console.log('📊 各策略识别结果:', results.map(r => `${r.amount}(${r.strategy},${r.confidence.toFixed(2)})`).join(', '))

  // 使用改进的投票策略
  const votedAmount = improvedVotingStrategy(results)

  // 🔬 自定义分类器已禁用
  // 原因：这个字体的 3 和 5 特征太相似，无法可靠区分
  // 建议：让用户在前端手动修改金额

  return votedAmount
}

/**
 * 从裁剪的金额图中提取第一个数字区域
 */
async function extractFirstDigitFromCrop(croppedPath: string): Promise<Buffer | null> {
  try {
    const { data, info } = await sharp(croppedPath)
      .grayscale()
      .normalize()
      .threshold(180)
      .raw()
      .toBuffer({ resolveWithObject: true })

    const w = info.width
    const h = info.height
    const ch = info.channels || 1

    // 找到第一个有墨水的列（跳过负号和空白）
    let firstInkCol = -1
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if (data[(y * w + x) * ch] < 128) {
          firstInkCol = x
          break
        }
      }
      if (firstInkCol !== -1) break
    }

    if (firstInkCol === -1) return null

    // 跳过负号：找到第一个空白间隔后的墨水区域
    let gapFound = false
    let digitStart = firstInkCol

    for (let x = firstInkCol; x < w; x++) {
      let hasInk = false
      for (let y = 0; y < h; y++) {
        if (data[(y * w + x) * ch] < 128) {
          hasInk = true
          break
        }
      }

      if (!hasInk && !gapFound) {
        gapFound = true
      } else if (hasInk && gapFound) {
        digitStart = x
        break
      }
    }

    // 找到数字的结束位置
    let digitEnd = digitStart
    let gapCount = 0
    for (let x = digitStart; x < w; x++) {
      let hasInk = false
      for (let y = 0; y < h; y++) {
        if (data[(y * w + x) * ch] < 128) {
          hasInk = true
          break
        }
      }

      if (hasInk) {
        digitEnd = x
        gapCount = 0
      } else {
        gapCount++
        if (gapCount > w * 0.05) break // 超过 5% 宽度的空白，认为数字结束
      }
    }

    if (digitEnd <= digitStart) return null

    // 提取数字区域
    const padding = 5
    const extractLeft = Math.max(0, digitStart - padding)
    const extractWidth = Math.min(w - extractLeft, digitEnd - digitStart + padding * 2)

    return await sharp(croppedPath)
      .extract({
        left: extractLeft,
        top: 0,
        width: extractWidth,
        height: h,
      })
      .png()
      .toBuffer()
  } catch (e) {
    return null
  }
}

/**
 * 多位置 + 多尺度 + 多策略综合识别金额
 * 通过不同裁剪位置和放大倍数获取更多独立样本，提高投票准确性
 */
async function recognizeAmountMultiCrop(imagePath: string, isDark: boolean = false): Promise<number> {
  console.log('🔍 多位置多尺度综合识别金额...')

  // 不同的裁剪位置偏移（相对于高度的百分比）
  const topOffsets = [0, -0.02, 0.02, -0.01, 0.01]
  // 不同的放大倍数
  const scaleFactors = [4, 3, 5, 6]

  const allResults: number[] = []
  const allCroppedImages: string[] = []

  // 对每个位置偏移 + 每个放大倍数组合进行识别
  for (const offset of topOffsets) {
    for (const scale of scaleFactors) {
      const croppedPath = await cropAmountArea(imagePath, isDark, offset, scale)
      allCroppedImages.push(croppedPath)

      // 对每个裁剪图使用多种预处理策略
      const amount = await recognizeAmountWithVoting(croppedPath, isDark)
      if (amount > 0) {
        allResults.push(amount)
      }
    }
  }

  // 清理所有裁剪的临时文件
  for (const imgPath of allCroppedImages) {
    try {
      if (imgPath !== imagePath && fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath)
      }
    } catch (e) {
      // 忽略
    }
  }

  if (allResults.length === 0) {
    console.log('⚠️  多位置多尺度识别均未识别到金额')
    return 0
  }

  // 综合投票
  const counts: Record<string, number> = {}
  allResults.forEach(r => {
    const key = r.toFixed(2)
    counts[key] = (counts[key] || 0) + 1
  })

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const bestAmount = parseFloat(sorted[0][0])
  const voteCount = sorted[0][1]

  console.log('📊 多位置多尺度综合投票结果:', allResults.map(r => r.toFixed(2)))
  console.log(`✅ 综合最终金额: ${bestAmount} (${voteCount}/${allResults.length}票)`)

  return bestAmount
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
 * 从全图识别文本中提取明确的金额
 * 只提取有明确上下文的金额（如 "-3.00"、"¥3.00"），不提取孤立数字
 */
function extractExplicitAmounts(rawText: string): number[] {
  const amounts: number[] = []
  const seen = new Set<number>()

  // 模式1: 负号+金额（支付截图中最常见的格式，如 "-3.00"）
  const negativePattern = /[-–—]\s*(\d{1,6}\.\d{2})/g
  let match
  while ((match = negativePattern.exec(rawText)) !== null) {
    const amt = parseFloat(match[1])
    if (amt > 0 && amt < 100000 && !seen.has(amt)) {
      amounts.push(amt)
      seen.add(amt)
    }
  }

  // 模式2: 货币符号+金额（如 "¥3.00"、"￥3.00"）
  const currencyPattern = /[¥￥$]\s*(\d{1,6}\.\d{2})/g
  while ((match = currencyPattern.exec(rawText)) !== null) {
    const amt = parseFloat(match[1])
    if (amt > 0 && amt < 100000 && !seen.has(amt)) {
      amounts.push(amt)
      seen.add(amt)
    }
  }

  // 模式3: 独占一行的金额（支付截图中大字体金额通常独占一行）
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l)
  for (const line of lines) {
    const standaloneMatch = line.match(/^[¥￥\-–—]?\s*(\d{1,6}\.\d{2})\s*$/)
    if (standaloneMatch) {
      const amt = parseFloat(standaloneMatch[1])
      if (amt > 0 && amt < 100000 && !seen.has(amt)) {
        amounts.push(amt)
        seen.add(amt)
      }
    }
  }

  return amounts
}

// ==================== OCR 串行队列 ====================
// 防止多个 OCR 请求同时竞争 Scheduler Worker，导致部分请求失败
let ocrQueue: Promise<any> = Promise.resolve()

/**
 * 识别支付截图 - 性能优化 v2
 *
 * 策略：单次 OCR 优先
 * 1. 快速路径：一次全图 OCR 同时完成验证 + 字段提取（目标 3-5 秒）
 * 2. 补充路径：仅在金额提取失败时，做 1-2 次针对性裁剪 OCR（+2-3 秒）
 *
 * 原来的流程：预验证(1次) + 上下文(12次) + 字符分割(20+次) + 全图(1次) = 30+ 次 OCR
 * 优化后：全图(1次) + 可选补充(1-2次) = 1-3 次 OCR
 */
export async function recognizeReceipt(imagePath: string): Promise<ReceiptOcrResult> {
  // 通过队列串行执行，避免多个请求同时竞争 Scheduler Worker
  return new Promise((resolve, reject) => {
    ocrQueue = ocrQueue
      .then(() => recognizeReceiptInternal(imagePath))
      .then(resolve)
      .catch(reject)
  })
}

/**
 * 内部识别函数（由队列调度）
 */
async function recognizeReceiptInternal(imagePath: string): Promise<ReceiptOcrResult> {
  const startTime = Date.now()
  console.log('🔍 开始识别支付截图...')
  console.log('📄 文件路径:', imagePath)

  try {
    // 检测深色模式（纯图片计算，不涉及 OCR，很快）
    const isDark = await isDarkMode(imagePath)

    // 🐛 调试模式
    if (process.env.DEBUG_OCR === 'true') {
      await debugOCRForThree(imagePath)
    }

    // ==================== 快速路径：单次全图 OCR ====================
    // 一次 OCR 同时完成验证 + 提取所有字段
    console.log('🚀 快速路径：单次全图 OCR...')
    const fullScan = await validateAndRecognizeFull(imagePath, isDark)

    if (!fullScan.isValid) {
      throw new Error(fullScan.reason || '此不是支付截图，请重新上传')
    }

    // 如果全图 OCR 已经成功提取到金额，直接返回
    if (fullScan.result && fullScan.result.amount > 0) {
      const elapsed = Date.now() - startTime
      console.log(`✅ 快速路径成功！金额: ${fullScan.result.amount}，耗时: ${elapsed}ms`)
      return fullScan.result
    }

    // ==================== 补充路径：针对性裁剪 OCR ====================
    // 全图 OCR 未提取到金额，做少量补充识别
    console.log('⚠️  全图未提取到金额，启动补充识别...')

    // 只用裁剪 OCR（不用字符分割，字符分割太慢）
    const contextAmount = await recognizeAmountFromContextFast(imagePath, isDark).catch(() => 0)

    // 收集结果
    const allAmounts: Array<{ amount: number; source: string; weight: number }> = []
    if (contextAmount > 0) allAmounts.push({ amount: contextAmount, source: '上下文', weight: 3 })

    // 也从全图文本中再次尝试提取
    if (fullScan.rawText) {
      const explicitAmounts = extractExplicitAmounts(fullScan.rawText)
      for (const ea of explicitAmounts) {
        allAmounts.push({ amount: ea, source: '文本提取', weight: 3 })
      }
    }

    if (allAmounts.length > 0) {
      // 加权投票
      const weightedVotes: Record<string, { weight: number; sources: string[] }> = {}
      for (const item of allAmounts) {
        const key = item.amount.toFixed(2)
        if (!weightedVotes[key]) {
          weightedVotes[key] = { weight: 0, sources: [] }
        }
        weightedVotes[key].weight += item.weight
        weightedVotes[key].sources.push(item.source)
      }

      const sorted = Object.entries(weightedVotes).sort((a, b) => b[1].weight - a[1].weight)
      const bestAmount = parseFloat(sorted[0][0])

      if (bestAmount > 0) {
        const elapsed = Date.now() - startTime
        console.log(`✅ 补充路径成功！金额: ${bestAmount}，耗时: ${elapsed}ms`)

        return {
          amount: bestAmount,
          date: fullScan.result?.date || '',
          transactionNo: fullScan.result?.transactionNo || '',
          itemName: '无票报销',
          rawText: fullScan.rawText
        }
      }
    }

    console.log('⚠️  所有策略均未识别到金额')
    throw new Error('此不是支付截图，请重新上传')
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

/**
 * 快速版上下文裁剪识别
 * 用 3 个裁剪位置覆盖不同截图类型，并行执行
 * 每个位置只做 1 次 OCR（chi_sim+eng），从文本中提取金额
 */
async function recognizeAmountFromContextFast(imagePath: string, isDark: boolean): Promise<number> {
  console.log('🔍 快速上下文裁剪识别...')

  const tempDir = path.join(process.cwd(), 'uploads', 'temp')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  const metadata = await sharp(imagePath).metadata()
  const width = metadata.width || 750
  const height = metadata.height || 1334

  // 3 个裁剪位置覆盖不同截图布局
  // 微信/支付宝金额通常在 15%-30% 高度区间
  const cropConfigs = [
    { left: 0.05, top: 0.15, w: 0.90, h: 0.15, scale: 2, label: 'high' },   // 偏上（部分截图金额靠上）
    { left: 0.05, top: 0.20, w: 0.90, h: 0.12, scale: 2, label: 'mid' },    // 标准位置
    { left: 0.05, top: 0.25, w: 0.90, h: 0.12, scale: 2, label: 'low' },    // 偏下（有状态栏的截图）
  ]

  const amounts: number[] = []
  const tempFiles: string[] = []

  // 并行处理所有裁剪区域
  const promises = cropConfigs.map(async (cfg) => {
    try {
      const cropLeft = Math.floor(width * cfg.left)
      const cropTop = Math.floor(height * cfg.top)
      const cropWidth = Math.min(Math.floor(width * cfg.w), width - cropLeft)
      const cropHeight = Math.min(Math.floor(height * cfg.h), height - cropTop)
      if (cropWidth <= 0 || cropHeight <= 0) return

      const tempPath = path.join(tempDir, `ctx-fast-${cfg.label}-${Date.now()}.png`)
      tempFiles.push(tempPath)

      let pipeline = sharp(imagePath)
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
        .resize(Math.floor(cropWidth * cfg.scale), Math.floor(cropHeight * cfg.scale), { fit: 'fill' })
        .grayscale()
        .normalize()

      if (isDark) {
        pipeline = pipeline.negate()
      }

      await pipeline.toFile(tempPath)

      const { data } = await ocrRecognize(tempPath)
      const text = data.text.replace(/\s+/g, ' ').trim()
      console.log(`  📝 ${cfg.label}: "${text}"`)

      const extracted = extractAmountFromText(text)
      if (extracted > 0) {
        amounts.push(extracted)
        console.log(`  ✓ ${cfg.label}: ${extracted}`)
      }
    } catch (_) {
      // 忽略单个裁剪失败
    }
  })

  await Promise.all(promises)

  // 清理
  for (const f of tempFiles) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch (_) {}
  }

  if (amounts.length === 0) return 0

  // 投票
  const votes: Record<string, number> = {}
  amounts.forEach(a => {
    const key = a.toFixed(2)
    votes[key] = (votes[key] || 0) + 1
  })
  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1])
  return parseFloat(sorted[0][0])
}

/**
 * 快速版字符分割识别
 * 只用 1 种预处理（阈值 180），而非原来的 5 种
 */
async function recognizeAmountByCharactersFast(imagePath: string): Promise<number> {
  console.log('🔍 快速字符分割识别...')

  const tempDir = path.join(process.cwd(), 'uploads', 'temp')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  const tempPath = path.join(tempDir, `preprocess-fast-${Date.now()}.png`)
  await sharp(imagePath).grayscale().normalize().threshold(180).toFile(tempPath)

  try {
    const segmentation = await detectAmountCharacterSegments(tempPath)
    if (!segmentation) return 0

    const parts: string[] = []
    for (const segment of segmentation.segments) {
      if (segment.kind === 'minus') continue
      if (segment.kind === 'dot') {
        if (!parts.includes('.') && parts.some(p => /\d/.test(p))) parts.push('.')
        continue
      }

      const digit = await recognizeAmountDigitSegment(
        tempPath, segment, segmentation.imageWidth, segmentation.imageHeight
      )
      if (!digit) return 0
      parts.push(digit)
    }

    if (parts.length === 0) return 0

    let amountText = parts.join('').replace(/^\.+/, '')
    if (!amountText.includes('.')) {
      const digitsOnly = amountText.replace(/\D/g, '')
      if (digitsOnly.length >= 3) {
        amountText = `${digitsOnly.slice(0, -2)}.${digitsOnly.slice(-2)}`
      } else {
        amountText = digitsOnly
      }
    }

    const cleaned = postProcessAmount(amountText)
    if (!cleaned) return 0

    const amount = parseFloat(cleaned)
    if (!isNaN(amount) && amount > 0 && amount < 100000) {
      console.log(`  ✅ 快速字符分割: ${amount}`)
      return amount
    }
    return 0
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch (_) {}
  }
}

/**
 * 识别全图以提取日期、交易单号、商品名称
 * 优化：使用 Worker 池
 */
async function recognizeFullImage(
  imagePath: string,
  result: ReceiptOcrResult
): Promise<void> {
  try {
    console.log('🔍 识别全图以提取其他字段...')

    const { data } = await recognizeWithWorkerPool(imagePath, 'chi_sim+eng', {
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          console.log(`📊 全图识别进度: ${(m.progress * 100).toFixed(0)}%`)
        }
      },
      tessedit_pageseg_mode: '3', // PSM_AUTO
    } as any)

    console.log('📝 全图识别文本:')
    console.log('='.repeat(60))
    console.log(data.text)
    console.log('='.repeat(60))

    // 保存原始文本用于智能修正
    result.rawText = data.text

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
    // 按行分割文本，寻找独立的金额行（微信/支付宝截图中金额通常独占一行）
    const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l)

    // 零钱/余额关键词，这些行的金额不是支付金额
    // OCR 文本中中文字符间常有空格（如"零 钱"），正则需兼容
    const walletKeywords = /零\s*钱|余\s*额|钱\s*包|找\s*零|充\s*值/

    // 标记需要跳过的行索引（零钱行及其下一行，因为金额可能在下一行）
    const skipLines = new Set<number>()
    for (let i = 0; i < lines.length; i++) {
      if (walletKeywords.test(lines[i])) {
        skipLines.add(i)
        if (i + 1 < lines.length) skipLines.add(i + 1) // 下一行可能是零钱金额
      }
    }

    // 优先策略：查找独占一行的金额（如 "-3.00"、"¥3.00"）
    // 这种格式是支付截图中最显著的大字体金额
    for (let i = 0; i < lines.length; i++) {
      if (skipLines.has(i)) continue
      const line = lines[i]

      const standaloneMatch = line.match(/^[¥￥\-\—\–]?\s*(\d{1,6}\.\d{2})\s*$/)
      if (standaloneMatch && standaloneMatch[1]) {
        const amount = parseFloat(standaloneMatch[1])
        if (amount > 0 && amount < 100000) {
          result.amount = amount
          console.log('💰 识别到独立金额行:', result.amount, '原始行:', line)
          break
        }
      }
    }

    // 如果独立行没找到，使用常规模式匹配（也排除零钱行）
    if (result.amount === 0) {
      // 移除零钱相关行（包括零钱行的下一行）
      const filteredText = lines
        .filter((_, i) => !skipLines.has(i))
        .join('\n')

      const amountPatterns = [
        // "金额" 后面的数字（最可靠，有明确标签）
        /金额[：:\s]*[¥￥]?[-\-—–]?\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
        // "支付金额" 后面的数字
        /支付金额[：:\s]*[¥￥]?[-\-—–]?\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
        // ¥ 符号后的金额
        /[¥￥]\s*(\d+(?:[,\s]*\d+)*\.?\d{0,2})/,
        // 负号开头的金额（排除长数字串如手机号、交易单号）
        /[-\-—–]\s*(\d{1,6}\.\d{2})(?!\d)/,
        // 匹配独立的金额数字（带小数点，非长数字串的一部分）
        /(?<!\d)(\d{1,6}\.\d{2})(?!\d)/,
        // 匹配整数金额
        /[-\-—–]?\s*(\d{1,6})\s*元/,
      ]

      for (const pattern of amountPatterns) {
        const match = filteredText.match(pattern)
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
    // 交易单号：4500000143202602247407359650（可能有空格，不跨行）
    /交易单号[：:\s]*(\d[\d ]{14,50})/,
    // 单号：xxx（排除商户单号，不跨行）
    /(?<!商户)单号[：:\s]*(\d[\d ]{14,50})/,
    // 订单号：xxx
    /订单号[：:\s]*(\d[\d ]{14,50})/,
    // 流水号
    /流水号[：:\s]*(\d[\d ]{14,50})/,
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

  // 如果没找到，尝试查找长数字串（只匹配空格，不跨行）
  if (!result.transactionNo) {
    const longNumberMatch = cleanText.match(/(\d[\d ]{19,50})/)
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

/**
 * OCR 调试函数：详细分析为什么 "3" 被识别成 "5"
 */
export async function debugOCRForThree(imagePath: string): Promise<void> {
  console.log('========== 3元识别调试 ==========')
  console.log('📄 图片路径:', imagePath)

  // 创建调试目录
  const debugDir = path.join(process.cwd(), 'debug')
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true })
  }

  try {
    // 1. 测试不同的页面分割模式
    console.log('\n--- 测试不同 PSM 模式 ---')
    const modes = [6, 7, 8, 10, 13]
    for (const mode of modes) {
      const { data } = await recognizeWithWorkerPool(imagePath, 'eng', {
        tessedit_pageseg_mode: mode.toString(),
        tessedit_char_whitelist: '0123456789.',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      } as any)
      console.log(`PSM ${mode}: "${data.text.trim()}" (置信度: ${data.confidence.toFixed(1)}%)`)
    }

    // 2. 测试不同的预处理
    console.log('\n--- 测试不同预处理 ---')

    // 原图灰度
    const grayBuffer = await sharp(imagePath).grayscale().toBuffer()
    const grayResult = await recognizeWithWorkerPool(grayBuffer, 'eng', {
      tessedit_char_whitelist: '0123456789.',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    } as any)
    console.log(`灰度图: "${grayResult.data.text.trim()}"`)

    // 不同阈值二值化
    const thresholds = [80, 100, 128, 150, 170, 200]
    for (const th of thresholds) {
      const binaryBuffer = await sharp(imagePath)
        .grayscale()
        .threshold(th)
        .toBuffer()
      const result = await recognizeWithWorkerPool(binaryBuffer, 'eng', {
        tessedit_char_whitelist: '0123456789.',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      } as any)
      console.log(`阈值 ${th}: "${result.data.text.trim()}"`)
    }

    // 模糊处理
    console.log('\n--- 测试模糊处理 ---')
    const blurLevels = [1, 2, 3, 5]
    for (const blur of blurLevels) {
      const blurBuffer = await sharp(imagePath)
        .grayscale()
        .blur(blur)
        .threshold(128)
        .toBuffer()
      const result = await recognizeWithWorkerPool(blurBuffer, 'eng', {
        tessedit_char_whitelist: '0123456789.',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      } as any)
      console.log(`模糊 ${blur}: "${result.data.text.trim()}"`)
    }

    // 3. 保存预处理图像用于人工查看
    console.log('\n--- 保存调试图像 ---')
    const timestamp = Date.now()

    await sharp(imagePath).toFile(path.join(debugDir, `${timestamp}-1-原始.png`))
    console.log(`✓ 保存: ${timestamp}-1-原始.png`)

    await sharp(imagePath)
      .grayscale()
      .toFile(path.join(debugDir, `${timestamp}-2-灰度.png`))
    console.log(`✓ 保存: ${timestamp}-2-灰度.png`)

    await sharp(imagePath)
      .grayscale()
      .threshold(128)
      .toFile(path.join(debugDir, `${timestamp}-3-二值128.png`))
    console.log(`✓ 保存: ${timestamp}-3-二值128.png`)

    await sharp(imagePath)
      .grayscale()
      .blur(2)
      .threshold(128)
      .toFile(path.join(debugDir, `${timestamp}-4-模糊2.png`))
    console.log(`✓ 保存: ${timestamp}-4-模糊2.png`)

    await sharp(imagePath)
      .grayscale()
      .normalize()
      .sharpen()
      .threshold(140)
      .toFile(path.join(debugDir, `${timestamp}-5-锐化.png`))
    console.log(`✓ 保存: ${timestamp}-5-锐化.png`)

    console.log(`\n✅ 调试图像已保存到: ${debugDir}`)
    console.log('========== 调试完成 ==========\n')
  } catch (error) {
    console.error('❌ 调试过程出错:', error)
  }
}
