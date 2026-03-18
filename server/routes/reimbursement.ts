import { Router } from 'express'
import multer from 'multer'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import { recognizeInvoiceLocally } from '../services/localOcr.js'
import { recognizeReceipt } from '../services/receiptOcr.js'
import { calculateReimbursementMonth } from '../utils/reimbursement.js'
import { db } from '../db/index.js'

const router = Router()

// 格式化时间为中国时间，格式：YYYY-MM-DD HH:mm
// 不依赖 Intl，避免 Alpine 容器 small-icu 导致乱码
function formatDateTime(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  // UTC 时间加 8 小时得到中国时间
  const cnTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const y = cnTime.getUTCFullYear()
  const m = String(cnTime.getUTCMonth() + 1).padStart(2, '0')
  const d = String(cnTime.getUTCDate()).padStart(2, '0')
  const h = String(cnTime.getUTCHours()).padStart(2, '0')
  const min = String(cnTime.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

// 标准化报销事由标题格式：统一为 YYYY年MM月-基础报销/大额报销/商务报销
function normalizeReimbursementTitle(title: string): string {
  const match = title.match(/^(\d{4}年\d{2}月).*?-(基础报销|大额报销|商务报销)$/)
  if (match) {
    return `${match[1]}-${match[2]}`
  }
  return title
}

// 确保上传目录存在
const uploadsDir = path.join(process.cwd(), 'uploads')
const tempDir = path.join(uploadsDir, 'temp')
const invoicesDir = path.join(uploadsDir, 'invoices')

// 配置 multer 用于文件上传（使用绝对路径）
const upload = multer({
  dest: tempDir,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB 临时限制
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('只支持PDF格式的文件'))
    }
  },
})

// 配置 multer 用于付款回单上传（支持图片和PDF）
const uploadPaymentProof = multer({
  dest: tempDir,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
    ]
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持 PDF、JPG、PNG 格式的文件'))
    }
  },
})

// 配置 multer 用于收据/支付截图上传（仅支持图片）
const uploadReceipt = multer({
  dest: tempDir,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/bmp',
      'image/webp',
    ]
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持 JPG、PNG、GIF、BMP、WEBP 格式的图片'))
    }
  },
})

;[uploadsDir, tempDir, invoicesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
})

/**
 * PDF压缩功能
 * 使用 pdf-lib 压缩PDF文件
 */
async function compressPDF(inputPath: string, outputPath: string): Promise<void> {
  try {
    const existingPdfBytes = fs.readFileSync(inputPath)
    const pdfDoc = await PDFDocument.load(existingPdfBytes)

    // 移除元数据以减小文件大小
    pdfDoc.setTitle('')
    pdfDoc.setAuthor('')
    pdfDoc.setSubject('')
    pdfDoc.setKeywords([])
    pdfDoc.setProducer('')
    pdfDoc.setCreator('')

    // 保存压缩后的PDF
    const pdfBytes = await pdfDoc.save({
      useObjectStreams: false, // 禁用对象流以提高兼容性
    })

    fs.writeFileSync(outputPath, pdfBytes)
  } catch (error) {
    console.error('PDF压缩失败:', error)
    throw new Error('PDF压缩失败')
  }
}

/**
 * 发票OCR识别功能
 * 使用本地 OCR 进行识别，数据不会发送到外部服务器
 * 返回结果包含 isValidInvoice 字段，用于判断是否为有效发票
 */
async function recognizeInvoice(filePath: string): Promise<{
  amount: number
  date: string
  invoiceNumber?: string
  seller?: string
  buyer?: string
  taxAmount?: number
  invoiceCode?: string
  isValidInvoice: boolean
}> {
  console.log('🔍 使用本地 OCR 识别发票...')
  console.log('🔒 数据安全：所有识别在本地完成，不会上传到外部服务器')

  try {
    // 使用本地 OCR 服务
    const result = await recognizeInvoiceLocally(filePath)
    console.log('✅ 本地 OCR 识别完成')
    return result
  } catch (error) {
    console.error('❌ 本地 OCR 识别失败:', error)

    // 如果是无效发票错误，直接抛出，不返回默认值
    if (error instanceof Error && error.message.includes('此不是发票文件')) {
      throw error
    }

    // 如果是其他识别失败（如文本提取失败），返回默认值供用户手动填写
    console.warn('⚠️  OCR 识别失败，返回默认值，请手动核对发票信息')

    const randomAmount = (Math.random() * 1000 + 100).toFixed(2)
    const daysAgo = Math.floor(Math.random() * 30)
    const invoiceDate = new Date()
    invoiceDate.setDate(invoiceDate.getDate() - daysAgo)

    return {
      amount: parseFloat(randomAmount),
      date: invoiceDate.toISOString().split('T')[0],
      invoiceNumber: 'MANUAL-' + Date.now(),
      seller: '请手动填写',
      isValidInvoice: true,
    }
  }
}

/**
 * 检查发票号码是否已存在（全局查重）
 * POST /api/reimbursement/check-invoice-duplicate
 */
router.post('/check-invoice-duplicate', requireAuth, async (req, res) => {
  try {
    const { invoiceNumber } = req.body

    if (!invoiceNumber) {
      return res.json({ success: true, data: { duplicate: false } })
    }

    const { db } = await import('../db/index.js')

    // 查询数据库中是否已存在该发票号码（排除已驳回和已软删除的报销单）
    const existing = db.prepare(`
      SELECT ri.invoice_number, r.id as reimbursement_id, r.title, r.status, r.applicant_name
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE ri.invoice_number = ? AND r.status != 'rejected' AND COALESCE(r.is_deleted, 0) = 0
      LIMIT 1
    `).get(invoiceNumber) as any

    if (existing) {
      return res.json({
        success: true,
        data: {
          duplicate: true,
          message: `${invoiceNumber}此发票${existing.applicant_name}已上传，请勿重复上传`,
        },
      })
    }

    res.json({ success: true, data: { duplicate: false } })
  } catch (error) {
    console.error('发票查重失败:', error)
    res.status(500).json({
      success: false,
      message: '发票查重失败',
    })
  }
})

/**
 * 查询用户当月运输/交通/汽油/柴油类发票已使用额度
 * GET /api/reimbursement/transport-fuel-quota?excludeId=xxx
 */
router.get('/transport-fuel-quota', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id
    const { excludeId } = req.query // 要排除的报销单ID（编辑模式）

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 获取当前报销月份(使用与创建报销单相同的逻辑)
    const now = new Date()
    const { calculateReimbursementMonth } = await import('../utils/reimbursement.js')
    const currentReimbursementMonth = calculateReimbursementMonth(now, 'basic')

    // 查询当前报销月份所有已提交(非草稿、非驳回)的基础报销单中的运输/交通/汽油/柴油类发票
    // 如果提供了 excludeId，则排除该报销单（用于编辑模式）
    let sql = `
      SELECT COALESCE(SUM(ri.amount), 0) as used_amount
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE r.user_id = ?
        AND r.type = 'basic'
        AND r.status NOT IN ('draft', 'rejected')
        AND r.reimbursement_month = ?
    `

    const params: any[] = [userId, currentReimbursementMonth]

    if (excludeId) {
      sql += ' AND r.id != ?'
      params.push(excludeId)
    }

    sql += `
        AND (
          LOWER(ri.category) LIKE '%运输%'
          OR LOWER(ri.category) LIKE '%交通%'
          OR LOWER(ri.category) LIKE '%汽油%'
          OR LOWER(ri.category) LIKE '%柴油%'
        )
    `

    const result = db.prepare(sql).get(...params) as { used_amount: number }

    const usedAmount = result?.used_amount || 0
    const remainingQuota = Math.max(0, 1500 - usedAmount)

    res.json({
      success: true,
      data: {
        usedAmount,
        remainingQuota,
        totalQuota: 1500,
        reimbursementMonth: currentReimbursementMonth,
      },
    })
  } catch (error) {
    console.error('查询运输/汽油类发票额度失败:', error)
    res.status(500).json({
      success: false,
      message: '查询额度失败',
    })
  }
})

/**
 * 上传发票并进行OCR识别
 * POST /api/reimbursement/upload-invoice
 */
router.post('/upload-invoice', requireAuth, upload.single('invoice'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请上传发票文件',
      })
    }

    const tempFilePath = req.file.path
    const fileSize = req.file.size
    const maxSize = 5 * 1024 * 1024 // 5MB

    // 先计算文件哈希，快速查重（在 OCR 之前）
    const fileBuffer = fs.readFileSync(tempFilePath)
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
    console.log('🔑 文件哈希:', fileHash)

    const existingByHash = db.prepare(`
      SELECT ri.file_hash, r.applicant_name
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE ri.file_hash = ? AND r.status != 'rejected' AND COALESCE(r.is_deleted, 0) = 0
      LIMIT 1
    `).get(fileHash) as { file_hash: string; applicant_name: string } | undefined

    if (existingByHash) {
      // 清理临时文件
      try { fs.unlinkSync(tempFilePath) } catch (e) { /* 忽略 */ }
      return res.status(400).json({
        success: false,
        message: `${existingByHash.applicant_name} 已上传此发票，请勿重复上传`,
      })
    }

    let finalFilePath = tempFilePath
    let compressed = false

    // 如果文件超过5MB，进行压缩
    if (fileSize > maxSize) {
      console.log(`📦 文件大小 ${(fileSize / 1024 / 1024).toFixed(2)}MB，开始压缩...`)
      const compressedPath = path.join(tempDir, `compressed-${Date.now()}.pdf`)

      try {
        await compressPDF(tempFilePath, compressedPath)
        finalFilePath = compressedPath
        compressed = true

        const compressedSize = fs.statSync(compressedPath).size
        console.log(`✅ 压缩完成，压缩后大小: ${(compressedSize / 1024 / 1024).toFixed(2)}MB`)
      } catch (error) {
        console.error('❌ PDF压缩失败:', error)
        // 压缩失败，继续使用原文件
      }
    }

    // 进行OCR识别
    console.log('🔍 开始OCR识别...')
    const ocrResult = await recognizeInvoice(finalFilePath)
    console.log('✅ OCR识别完成:', ocrResult)

    // 检查是否为有效发票
    if (!ocrResult.isValidInvoice) {
      console.log('❌ 非有效发票文件')

      // 清理临时文件
      try {
        fs.unlinkSync(finalFilePath)
        if (compressed && tempFilePath !== finalFilePath) {
          fs.unlinkSync(tempFilePath)
        }
      } catch (e) {
        console.error('清理临时文件失败:', e)
      }

      return res.status(400).json({
        success: false,
        message: '此不是发票文件请重新上传',
        isValidInvoice: false,
      })
    }

    // 移动文件到正式目录
    // 优先使用前端传递的原始文件名，否则尝试解码
    const rawFileName = req.body.originalFileName || Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    // 路径清洗：只取文件名部分，防止路径穿越攻击
    const safeFileName = path.basename(rawFileName).replace(/[^\w\u4e00-\u9fff.\-]/g, '_')
    const finalFileName = `invoice-${Date.now()}-${safeFileName}`
    const finalPath = path.join(invoicesDir, finalFileName)
    fs.renameSync(finalFilePath, finalPath)

    // 清理临时文件
    if (compressed && tempFilePath !== finalFilePath) {
      try {
        fs.unlinkSync(tempFilePath)
      } catch (error) {
        console.error('清理临时文件失败:', error)
      }
    }

    res.json({
      success: true,
      message: '发票上传成功',
      data: {
        fileName: finalFileName,
        filePath: `/uploads/invoices/${finalFileName}`,
        fileHash,
        compressed,
        ocrResult,
      },
    })
  } catch (error) {
    console.error('上传发票失败:', error)

    // 清理临时文件
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path)
      } catch (e) {
        console.error('清理临时文件失败:', e)
      }
    }

    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '上传失败',
    })
  }
})

/**
 * 上传收据/支付截图并进行OCR识别
 * POST /api/reimbursement/upload-receipt
 */
router.post('/upload-receipt', requireAuth, uploadReceipt.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请上传收据图片',
      })
    }

    const tempFilePath = req.file.path
    console.log('📸 收到收据上传:', req.file.originalname)

    // 先计算文件哈希，快速查重（在 OCR 之前）
    const fileBuffer = fs.readFileSync(tempFilePath)
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
    console.log('🔑 文件哈希:', fileHash)

    const existingByHash = db.prepare(`
      SELECT ri.file_hash, r.applicant_name
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE ri.file_hash = ? AND r.status != 'rejected' AND COALESCE(r.is_deleted, 0) = 0
      LIMIT 1
    `).get(fileHash) as { file_hash: string; applicant_name: string } | undefined

    if (existingByHash) {
      // 清理临时文件
      try { fs.unlinkSync(tempFilePath) } catch (e) { /* 忽略 */ }
      return res.status(400).json({
        success: false,
        message: `${existingByHash.applicant_name} 已上传此支付截图，请勿重复上传`,
      })
    }

    // 进行OCR识别
    console.log('🔍 开始OCR识别支付截图...')
    const ocrResult = await recognizeReceipt(tempFilePath)
    console.log('✅ OCR识别完成:', ocrResult)

    // 查重：检查交易单号是否已存在
    if (ocrResult.transactionNo) {
      const existingInvoice = db.prepare(`
        SELECT
          ri.invoice_number,
          ri.amount,
          ri.invoice_date,
          r.applicant_name,
          r.created_at
        FROM reimbursement_invoices ri
        JOIN reimbursements r ON ri.reimbursement_id = r.id
        WHERE ri.invoice_number = ? AND r.status != 'rejected' AND COALESCE(r.is_deleted, 0) = 0
        LIMIT 1
      `).get(ocrResult.transactionNo) as {
        invoice_number: string
        amount: number
        invoice_date: string
        applicant_name: string
        created_at: string
      } | undefined

      if (existingInvoice) {
        // 清理临时文件
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          console.error('清理临时文件失败:', e)
        }

        return res.status(400).json({
          success: false,
          message: `${existingInvoice.applicant_name} 已上传此支付截图，请勿重复上传`,
        })
      }
    }

    // 移动文件到正式目录
    const rawReceiptName = req.body.originalFileName || Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    // 路径清洗：只取文件名部分，防止路径穿越攻击
    const safeReceiptName = path.basename(rawReceiptName).replace(/[^\w\u4e00-\u9fff.\-]/g, '_')
    const finalFileName = `receipt-${Date.now()}-${safeReceiptName}`
    const finalPath = path.join(invoicesDir, finalFileName)
    fs.renameSync(tempFilePath, finalPath)

    res.json({
      success: true,
      message: '收据上传成功',
      data: {
        fileName: finalFileName,
        filePath: `/uploads/invoices/${finalFileName}`,
        fileHash,
        ocrResult: {
          amount: ocrResult.amount,
          date: ocrResult.date,
          invoiceNumber: ocrResult.transactionNo,
          type: ocrResult.itemName,
        },
      },
    })
  } catch (error) {
    console.error('上传收据失败:', error)

    // 清理临时文件
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path)
      } catch (e) {
        console.error('清理临时文件失败:', e)
      }
    }

    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '上传失败',
    })
  }
})

/**
 * 单独的PDF压缩接口
 * POST /api/reimbursement/compress-pdf
 */
router.post('/compress-pdf', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请上传PDF文件',
      })
    }

    const inputPath = req.file.path
    const outputPath = path.join(tempDir, `compressed-${Date.now()}.pdf`)

    await compressPDF(inputPath, outputPath)

    const originalSize = fs.statSync(inputPath).size
    const compressedSize = fs.statSync(outputPath).size
    const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2)

    // 读取压缩后的文件
    const compressedBuffer = fs.readFileSync(outputPath)

    // 清理临时文件
    fs.unlinkSync(inputPath)
    fs.unlinkSync(outputPath)

    // 清洗文件名，防止特殊字符导致响应头异常
    const safeOriginalName = path.basename(req.file.originalname).replace(/[^\w\u4e00-\u9fff.\-]/g, '_')
    // 使用 RFC 5987 编码确保中文文件名兼容
    const encodedFileName = encodeURIComponent(`compressed-${safeOriginalName}`)

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="compressed-${safeOriginalName}"; filename*=UTF-8''${encodedFileName}`,
      'Content-Length': compressedBuffer.length,
    })

    res.send(compressedBuffer)
  } catch (error) {
    console.error('PDF压缩失败:', error)

    // 清理临时文件
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path)
      } catch (e) {
        console.error('清理临时文件失败:', e)
      }
    }

    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '压缩失败',
    })
  }
})

/**
 * 获取报销统计数据
 * GET /api/reimbursement/statistics
 */
router.get('/statistics', requireAuth, async (req, res) => {
  try {
    const { type, status, startDate, endDate } = req.query
    const userId = req.session.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 构建基础条件
    let baseCondition = 'user_id = ?'
    const baseParams: any[] = [userId]

    // 添加类型筛选
    if (type) {
      baseCondition += ' AND type = ?'
      baseParams.push(type)
    }

    // 添加日期范围筛选
    if (startDate) {
      baseCondition += ' AND DATE(created_at) >= ?'
      baseParams.push(startDate)
    }
    if (endDate) {
      baseCondition += ' AND DATE(created_at) <= ?'
      baseParams.push(endDate)
    }

    // 查询各状态的统计数据
    const pendingStats = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition} AND status IN ('pending', 'pending_first', 'pending_second', 'pending_final')
    `).get(...baseParams) as { count: number; amount: number }

    const approvedStats = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition} AND status = 'approved'
    `).get(...baseParams) as { count: number; amount: number }

    const rejectedStats = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition} AND status = 'rejected'
    `).get(...baseParams) as { count: number; amount: number }

    // 已完成统计（包括 payment_uploaded, completed 状态）
    const completedStats = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition} AND status IN ('payment_uploaded', 'completed')
    `).get(...baseParams) as { count: number; amount: number }

    const totalStats = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition}
    `).get(...baseParams) as { count: number; amount: number }

    // 查询核减金额统计（仅基础报销，每年1月1日清零，且只统计已审批通过的报销单）
    let deductedCondition = 'r.user_id = ? AND r.type = ? AND r.status IN (?, ?, ?)'
    const deductedParams: any[] = [userId, 'basic', 'approved', 'payment_uploaded', 'completed']

    // 添加日期范围筛选
    if (startDate) {
      deductedCondition += ' AND DATE(r.created_at) >= ?'
      deductedParams.push(startDate)
    } else {
      // 如果没有指定开始日期，默认从当前年度1月1日开始统计（年度清零规则）
      const currentYear = new Date().getFullYear()
      deductedCondition += ' AND DATE(r.created_at) >= ?'
      deductedParams.push(`${currentYear}-01-01`)
    }

    if (endDate) {
      deductedCondition += ' AND DATE(r.created_at) <= ?'
      deductedParams.push(endDate)
    }

    const deductedStats = db.prepare(`
      SELECT COALESCE(SUM(i.deducted_amount), 0) as amount
      FROM reimbursement_invoices i
      INNER JOIN reimbursements r ON i.reimbursement_id = r.id
      WHERE ${deductedCondition}
    `).get(...deductedParams) as { amount: number }

    // 查询有核减的报销单数量
    const deductedCountStats = db.prepare(`
      SELECT COUNT(DISTINCT r.id) as count
      FROM reimbursements r
      INNER JOIN reimbursement_invoices i ON r.id = i.reimbursement_id
      WHERE ${deductedCondition}
      AND i.deducted_amount > 0
    `).get(...deductedParams) as { count: number }

    const statistics = {
      pending: {
        count: pendingStats.count,
        amount: pendingStats.amount,
      },
      approved: {
        count: approvedStats.count,
        amount: approvedStats.amount,
      },
      rejected: {
        count: rejectedStats.count,
        amount: rejectedStats.amount,
      },
      completed: {
        count: completedStats.count,
        amount: completedStats.amount,
      },
      total: {
        count: totalStats.count,
        amount: totalStats.amount,
      },
      deducted: {
        count: deductedCountStats.count,
        amount: deductedStats.amount,
      },
    }

    res.json({
      success: true,
      data: statistics,
    })
  } catch (error) {
    console.error('获取统计数据失败:', error)
    res.status(500).json({
      success: false,
      message: '获取统计数据失败',
    })
  }
})

/**
 * 获取审批记录列表
 * GET /api/reimbursement/records
 */
router.get('/records', requireAuth, async (req, res) => {
  try {
    const { page = '1', pageSize = '20', type, status, startDate, endDate } = req.query
    const userId = req.session.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 构建查询条件（报销统计显示所有历史数据，包括已删除的）
    let whereClause = 'WHERE user_id = ?'
    const params: any[] = [userId]

    if (type) {
      whereClause += ' AND type = ?'
      params.push(type)
    }

    if (status) {
      whereClause += ' AND status = ?'
      params.push(status)
    }

    if (startDate) {
      // 将日期转换为报销月份格式 YYYY-MM
      const startMonth = (startDate as string).substring(0, 7) // 取 YYYY-MM 部分
      whereClause += ' AND reimbursement_month >= ?'
      params.push(startMonth)
    }

    if (endDate) {
      // 将日期转换为报销月份格式 YYYY-MM
      const endMonth = (endDate as string).substring(0, 7) // 取 YYYY-MM 部分
      whereClause += ' AND reimbursement_month <= ?'
      params.push(endMonth)
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM reimbursements ${whereClause}`
    const countResult = db.prepare(countQuery).get(...params) as { total: number }
    const total = countResult.total

    // 查询列表（已完成的显示在最下方，已完成的按完成时间倒序，其他按创建时间降序）
    const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string)
    const listQuery = `
      SELECT
        r.id, r.type, r.title, r.total_amount as amount, r.status,
        r.applicant_name as applicant,
        r.reimbursement_scope as reimbursementScope,
        r.submit_time as submitTime,
        r.approve_time as approveTime,
        r.approver,
        r.pay_time as payTime,
        r.payment_upload_time as paymentUploadTime,
        r.completed_time as completedTime,
        r.payment_proof_path as paymentProofPath,
        r.receipt_confirmed_by as receiptConfirmedBy,
        r.reject_reason as rejectReason,
        r.reimbursement_month as reimbursementMonth,
        r.created_at as createTime,
        (SELECT GROUP_CONCAT(DISTINCT category) FROM reimbursement_invoices WHERE reimbursement_id = r.id AND category IS NOT NULL) as invoiceCategories
      FROM reimbursements r
      ${whereClause}
      ORDER BY
        CASE r.status
          WHEN 'pending' THEN 1
          WHEN 'rejected' THEN 2
          WHEN 'approved' THEN 3
          WHEN 'payment_uploaded' THEN 4
          WHEN 'completed' THEN 5
          ELSE 6
        END,
        r.submit_time ASC
      LIMIT ? OFFSET ?
    `
    params.push(parseInt(pageSize as string), offset)
    const list = db.prepare(listQuery).all(...params)

    // 格式化时间字段和发票类型
    const formattedList = list.map((item: any) => {
      // 处理发票类型：将逗号分隔的类型字符串转换为去重后的显示文本
      let invoiceCategory = ''
      if (item.invoiceCategories) {
        const categories = item.invoiceCategories.split(',')
        const uniqueCategories = [...new Set(categories)]
        invoiceCategory = uniqueCategories.join('、')
      }

      return {
        ...item,
        title: normalizeReimbursementTitle(item.title || ''),
        invoiceCategory,
        submitTime: formatDateTime(item.submitTime),
        approveTime: formatDateTime(item.approveTime),
        payTime: formatDateTime(item.payTime),
        paymentUploadTime: formatDateTime(item.paymentUploadTime),
        completedTime: formatDateTime(item.completedTime),
      }
    })

    res.json({
      success: true,
      data: {
        list: formattedList,
        total,
        page: parseInt(page as string),
        pageSize: parseInt(pageSize as string),
      },
    })
  } catch (error) {
    console.error('获取审批记录失败:', error)
    res.status(500).json({
      success: false,
      message: '获取审批记录失败',
    })
  }
})

/**
 * 创建报销单
 * POST /api/reimbursement/create
 */
router.post('/create', requireAuth, async (req, res) => {
  try {
    const { type, category, title, description, invoices, businessType, client, status = 'pending', reimbursementScope, serviceTarget } = req.body
    const userId = req.session.user?.id
    const userName = req.session.user?.name

    if (!userId || !userName) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    if (!type || !title || !invoices || invoices.length === 0) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    // 验证状态值：普通用户只能创建草稿或提交审批
    const allowedStatuses = ['draft', 'pending']
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '无效的状态值，只能创建草稿或提交审批',
      })
    }

    // 导入数据库
    const { db } = await import('../db/index.js')

    // 如果是基础报销，需要重新计算核减金额
    let processedInvoices = invoices
    if (type === 'basic') {
      // 获取当月已使用的运输/交通/汽油/柴油类发票额度
      const currentMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
      const monthlyUsedResult = db.prepare(`
        SELECT COALESCE(SUM(i.amount), 0) as used_amount
        FROM reimbursement_invoices i
        INNER JOIN reimbursements r ON i.reimbursement_id = r.id
        WHERE r.user_id = ?
        AND r.type = 'basic'
        AND r.reimbursement_month = ?
        AND r.status NOT IN ('draft', 'rejected')
        AND (
          LOWER(i.category) LIKE '%运输%'
          OR LOWER(i.category) LIKE '%交通%'
          OR LOWER(i.category) LIKE '%汽油%'
          OR LOWER(i.category) LIKE '%柴油%'
        )
      `).get(userId, currentMonth) as { used_amount: number }

      const monthlyUsedQuota = monthlyUsedResult?.used_amount || 0
      const remainingQuota = Math.max(0, 1500 - monthlyUsedQuota)

      // 计算本次提交的运输/交通/汽油/柴油类发票总额
      let transportFuelTotal = 0
      const transportFuelInvoices: any[] = []

      processedInvoices = invoices.map((inv: any) => {
        const category = (inv.category || '').toLowerCase()
        const isTransportOrFuel =
          category.includes('运输') ||
          category.includes('交通') ||
          category.includes('汽油') ||
          category.includes('柴油')

        if (isTransportOrFuel) {
          transportFuelInvoices.push(inv)
          transportFuelTotal += inv.amount || 0
        }

        return { ...inv, deductedAmount: 0 }
      })

      // 如果运输/交通/汽油/柴油类发票总额超过剩余额度，需要核减
      if (transportFuelTotal > remainingQuota) {
        const deductionAmountCents = Math.round((transportFuelTotal - remainingQuota) * 100)
        const transportFuelTotalCents = Math.round(transportFuelTotal * 100)

        // 按比例分配核减金额到每张运输/交通/汽油/柴油类发票
        // 使用分（cents）来避免精度问题
        let accumulatedDeductionCents = 0
        const transportInvoices: any[] = []

        processedInvoices.forEach((inv: any) => {
          const category = (inv.category || '').toLowerCase()
          const isTransportOrFuel =
            category.includes('运输') ||
            category.includes('交通') ||
            category.includes('汽油') ||
            category.includes('柴油')

          if (isTransportOrFuel) {
            transportInvoices.push(inv)
          }
        })

        processedInvoices = processedInvoices.map((inv: any, index: number) => {
          const category = (inv.category || '').toLowerCase()
          const isTransportOrFuel =
            category.includes('运输') ||
            category.includes('交通') ||
            category.includes('汽油') ||
            category.includes('柴油')

          if (isTransportOrFuel && transportFuelTotalCents > 0) {
            const invAmountCents = Math.round((inv.amount || 0) * 100)
            const ratio = invAmountCents / transportFuelTotalCents
            let invoiceDeductionCents = Math.round(deductionAmountCents * ratio)

            // 最后一张运输类发票，调整核减金额以确保总和精确
            const isLastTransportInvoice = transportInvoices[transportInvoices.length - 1] === inv
            if (isLastTransportInvoice) {
              invoiceDeductionCents = deductionAmountCents - accumulatedDeductionCents
            }

            accumulatedDeductionCents += invoiceDeductionCents
            return { ...inv, deductedAmount: invoiceDeductionCents / 100 }
          }

          return inv
        })
      }
    }

    // 计算总金额（使用实际报销金额，即扣除核减后的金额）
    // 使用分（cents）来避免浮点数精度问题
    const totalAmountCents = processedInvoices.reduce((sum: number, inv: any) => {
      const amountCents = Math.round((inv.amount || 0) * 100)
      const deductedCents = Math.round((inv.deductedAmount || 0) * 100)
      const actualCents = amountCents - deductedCents
      return sum + actualCents
    }, 0)
    const totalAmount = totalAmountCents / 100

    // 如果状态是 pending（提交审批），提前进行业务规则校验
    if (status === 'pending') {
      // 大额报销金额验证：总金额必须超过1000元
      if (type === 'large' && totalAmount < 1000) {
        return res.status(400).json({
          success: false,
          message: '大额报销适用于发票总金额超过 1000 元的报销申请',
        })
      }
    }

    // 生成报销单ID
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '')
    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase()
    const reimbursementId = `R${dateStr}${randomStr}`

    const timestamp = now.toISOString()

    // 计算报销月份（只有基础报销使用特殊规则）
    const reimbursementMonth = calculateReimbursementMonth(now, type)

    // === 所有校验在写库前完成 ===

    // 校验本次请求内发票号码不重复
    const invoiceNumbers = processedInvoices
      .map((inv: any) => inv.invoiceNumber)
      .filter((n: any) => n)
    const uniqueNumbers = new Set(invoiceNumbers)
    if (uniqueNumbers.size < invoiceNumbers.length) {
      return res.status(400).json({
        success: false,
        message: '提交的发票中存在重复的发票号码',
      })
    }

    // 校验发票号码在数据库中的唯一性 —— 移入事务内，利用 SQLite 写锁防并发

    // === 使用 BEGIN IMMEDIATE 立即获取写锁，防并发 ===
    try {
      db.exec('BEGIN IMMEDIATE')

      // 事务内校验发票号码唯一性（已持有写锁，并发安全）
      for (const invoiceNumber of uniqueNumbers) {
        const existing = db.prepare(`
          SELECT ri.invoice_number FROM reimbursement_invoices ri
          JOIN reimbursements r ON ri.reimbursement_id = r.id
          WHERE ri.invoice_number = ? AND r.status != 'rejected' AND COALESCE(r.is_deleted, 0) = 0
          LIMIT 1
        `).get(invoiceNumber)
        if (existing) {
          db.exec('ROLLBACK')
          return res.status(400).json({
            success: false,
            message: `发票号码 ${invoiceNumber} 已存在，请勿重复提交`,
          })
        }
      }

      // 插入报销单主记录
      db.prepare(`
        INSERT INTO reimbursements (
          id, type, category, title, total_amount, status, description,
          business_type, client, user_id, applicant_name,
          submit_time, reimbursement_month, reimbursement_scope, service_target, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reimbursementId,
        type,
        category || null,
        title,
        totalAmount,
        status,
        description || null,
        businessType || null,
        client || serviceTarget || null,
        userId,
        userName,
        timestamp,
        reimbursementMonth,
        reimbursementScope || null,
        serviceTarget || null,
        timestamp,
        timestamp
      )

      // 插入发票明细
      const insertInvoice = db.prepare(`
        INSERT INTO reimbursement_invoices (
          id, reimbursement_id, amount, invoice_date, invoice_number,
          file_path, seller, buyer, tax_amount, invoice_code, category, deducted_amount, file_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const invoice of processedInvoices) {
        const invoiceId = `INV${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`
        insertInvoice.run(
          invoiceId,
          reimbursementId,
          invoice.amount || 0,
          invoice.invoiceDate || timestamp.split('T')[0],
          invoice.invoiceNumber || null,
          invoice.filePath || '',
          invoice.seller || null,
          invoice.buyer || null,
          invoice.taxAmount || 0,
          invoice.invoiceCode || null,
          invoice.category || null,
          invoice.deductedAmount || 0,
          invoice.fileHash || null,
          timestamp
        )
      }

      // 如果状态是 pending（提交审批），创建审批实例
      if (status === 'pending') {
        const approvalInstanceId = nanoid()

        const approvalType = type === 'basic' ? 'reimbursement_basic' :
                            type === 'large' ? 'reimbursement_large' :
                            'reimbursement_business'

        db.prepare(`
          INSERT INTO approval_instances (
            id, flow_id, type, target_id, target_type, applicant_id,
            current_step, status, submit_time, created_at, updated_at
          ) VALUES (?, NULL, ?, ?, 'reimbursement', ?, 1, 'pending', ?, ?, ?)
        `).run(
          approvalInstanceId,
          approvalType,
          reimbursementId,
          userId,
          timestamp,
          timestamp,
          timestamp
        )

        console.log('✅ 创建审批实例:', { approvalInstanceId, reimbursementId, type: approvalType })
      }

      db.exec('COMMIT')
    } catch (txError: any) {
      try { db.exec('ROLLBACK') } catch { /* 已回滚则忽略 */ }
      throw txError
    }

    res.json({
      success: true,
      data: {
        id: reimbursementId,
      },
      message: status === 'draft' ? '草稿保存成功' : '报销单提交成功',
    })
  } catch (error) {
    console.error('创建报销单失败:', error)
    console.error('错误详情:', error instanceof Error ? error.message : error)
    res.status(500).json({
      success: false,
      message: '创建报销单失败: ' + (error instanceof Error ? error.message : String(error)),
    })
  }
})

/**
 * 获取报销单列表
 * GET /api/reimbursement/list
 */
router.get('/list', requireAuth, async (req, res) => {
  try {
    const { type, status, page = '1', pageSize = '10', startDate, endDate } = req.query
    const userId = req.session.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 构建查询条件
    // 默认视图排除已删除数据，指定日期范围查询时包含已删除数据
    const hasDateRange = startDate && endDate
    let whereClause = hasDateRange
      ? 'WHERE user_id = ?'
      : 'WHERE user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)'
    const params: any[] = [userId]

    if (type) {
      whereClause += ' AND type = ?'
      params.push(type)

      // 大额报销只显示金额 >= 1000 的记录
      if (type === 'large') {
        whereClause += ' AND total_amount >= 1000'
      }
    }

    if (status) {
      whereClause += ' AND status = ?'
      params.push(status)
    }

    // 处理日期范围查询（支持年份格式 YYYY、月份格式 YYYY-MM 和日期格式 YYYY-MM-DD）
    if (startDate && endDate) {
      let startDateStr = startDate as string
      let endDateStr = endDate as string

      // 如果是年份格式（YYYY），转换为该年的第一天和最后一天
      if (/^\d{4}$/.test(startDateStr)) {
        startDateStr = `${startDateStr}-01-01`
      }
      if (/^\d{4}$/.test(endDateStr)) {
        endDateStr = `${endDateStr}-12-31`
      }
      // 如果是月份格式（YYYY-MM），转换为日期范围
      else if (/^\d{4}-\d{2}$/.test(startDateStr)) {
        // 开始月份的第一天
        startDateStr = `${startDateStr}-01`
      }
      if (/^\d{4}-\d{2}$/.test(endDateStr)) {
        // 结束月份的最后一天
        const [year, month] = endDateStr.split('-').map(Number)
        const lastDay = new Date(year, month, 0).getDate()
        endDateStr = `${endDateStr}-${String(lastDay).padStart(2, '0')}`
      }

      // 转换为 ISO 字符串用于数据库查询
      const startDateTime = new Date(startDateStr).toISOString()
      const endDateTime = new Date(endDateStr + 'T23:59:59').toISOString()

      whereClause += ' AND created_at >= ? AND created_at <= ?'
      params.push(startDateTime, endDateTime)
    } else {
      // 如果没有指定日期范围，默认显示最近一个月的数据
      const oneMonthAgo = new Date()
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)
      const oneMonthAgoStr = oneMonthAgo.toISOString()
      whereClause += ' AND created_at >= ?'
      params.push(oneMonthAgoStr)
    }

    // 查询总数（包含一个月限制）
    const countQuery = `SELECT COUNT(*) as total FROM reimbursements ${whereClause}`
    const countResult = db.prepare(countQuery).get(...params) as { total: number }
    const total = countResult.total

    // 查询列表（按创建时间升序，创建时间早的在下方，时间晚的在上方）
    const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string)
    const listQuery = `
      SELECT
        r.id, r.type, r.category, r.title,
        r.total_amount as amount,
        r.total_amount as originalAmount,
        COALESCE(r.deduction_amount, 0) as deductionAmount,
        r.status,
        r.business_type as businessType, r.client,
        r.reimbursement_scope as reimbursementScope,
        r.submit_time as submitTime, r.created_at as createTime,
        COALESCE(r.is_deleted, 0) as isDeleted,
        (SELECT GROUP_CONCAT(DISTINCT category) FROM reimbursement_invoices WHERE reimbursement_id = r.id AND category IS NOT NULL) as invoiceCategories
      FROM reimbursements r
      ${whereClause}
      ORDER BY
        CASE r.status
          WHEN 'draft' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'rejected' THEN 3
          WHEN 'approved' THEN 4
          WHEN 'payment_uploaded' THEN 5
          WHEN 'completed' THEN 6
          ELSE 7
        END,
        r.created_at ASC
      LIMIT ? OFFSET ?
    `
    params.push(parseInt(pageSize as string), offset)
    const list = db.prepare(listQuery).all(...params)

    // 将 category 转换为中文显示
    const categoryMap: Record<string, string> = {
      office_equipment: '办公设备',
      office_tools: '办公器具',
      office_supplies: '办公耗材',
      labor_protection: '劳保用品',
      utilities: '水电费',
      property_fee: '物业费',
      cleaning_fee: '清洁费',
      travel_expense: '差旅费',
      refreshment: '茶水费',
      graphic_service: '图文服务',
      express_service: '快递服务',
      vehicle_service: '车辆服务',
      logistics_service: '物流服务',
      notary_service: '公证服务',
      consulting_service: '咨询服务',
      technical_service: '技术服务',
      certificate_service: '制证服务',
      training_fee: '培训费',
      knowledge_payment: '知识付费',
      expert_guidance: '专家指导',
    }

    const listWithCategoryLabel = list.map((item: any) => {
      // 处理发票类型：将逗号分隔的类型字符串转换为去重后的显示文本
      let invoiceCategory = ''
      if (item.invoiceCategories) {
        const categories = item.invoiceCategories.split(',')
        const uniqueCategories = [...new Set(categories)]
        invoiceCategory = uniqueCategories.join('、')
      }

      return {
        ...item,
        title: normalizeReimbursementTitle(item.title || ''),
        category: categoryMap[item.category] || item.category || '',
        invoiceCategory,
        submitTime: formatDateTime(item.submitTime),
      }
    })

    res.json({
      success: true,
      data: {
        list: listWithCategoryLabel,
        total,
        page: parseInt(page as string),
        pageSize: parseInt(pageSize as string),
      },
    })
  } catch (error) {
    console.error('获取报销单列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取报销单列表失败',
    })
  }
})

/**
 * 获取待审批报销单列表（管理员）
 * GET /api/reimbursement/pending-list
 */
router.get('/pending-list', requireAuth, async (req, res) => {
  try {
    const { page = '1', pageSize = '20', type } = req.query
    const currentUserId = req.session.user?.id
    const currentUserRole = req.session.user?.role

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    // 检查是否为管理员
    if (!['super_admin', 'admin'].includes(currentUserRole || '')) {
      return res.status(403).json({
        success: false,
        message: '无权限访问',
      })
    }

    const { db } = await import('../db/index.js')

    // 构建查询条件
    let whereClause = "WHERE status IN ('pending', 'pending_first', 'pending_second', 'pending_final')"
    const params: any[] = []

    if (type) {
      whereClause += ' AND type = ?'
      params.push(type)
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM reimbursements ${whereClause}`
    const countResult = db.prepare(countQuery).get(...params) as { total: number }
    const total = countResult.total

    // 查询列表（按创建时间降序，新的在上）
    const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string)
    const listQuery = `
      SELECT
        id, type, category, title, total_amount as amount, status,
        business_type as businessType, client,
        reimbursement_scope as reimbursementScope,
        applicant_name as applicant, user_id as userId,
        submit_time as submitTime, created_at as createTime
      FROM reimbursements
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `
    params.push(parseInt(pageSize as string), offset)
    const list = db.prepare(listQuery).all(...params)

    // 将 category 转换为中文显示
    const categoryMap: Record<string, string> = {
      office_equipment: '办公设备',
      office_tools: '办公器具',
      office_supplies: '办公耗材',
      labor_protection: '劳保用品',
      utilities: '水电费',
      property_fee: '物业费',
      cleaning_fee: '清洁费',
      travel_expense: '差旅费',
      refreshment: '茶水费',
      graphic_service: '图文服务',
      express_service: '快递服务',
      vehicle_service: '车辆服务',
      logistics_service: '物流服务',
      notary_service: '公证服务',
      consulting_service: '咨询服务',
      technical_service: '技术服务',
      certificate_service: '制证服务',
      training_fee: '培训费',
      knowledge_payment: '知识付费',
      expert_guidance: '专家指导',
    }

    const listWithCategoryLabel = list.map((item: any) => ({
      ...item,
      title: normalizeReimbursementTitle(item.title || ''),
      category: categoryMap[item.category] || item.category || '',
      submitTime: formatDateTime(item.submitTime),
    }))

    res.json({
      success: true,
      data: {
        list: listWithCategoryLabel,
        total,
        page: parseInt(page as string),
        pageSize: parseInt(pageSize as string),
      },
    })
  } catch (error) {
    console.error('获取待审批列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取待审批列表失败',
    })
  }
})

/**
 * 审批报销单（管理员）
 * POST /api/reimbursement/:id/approve
 */
router.post('/:id/approve', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { action, reason } = req.body // action: 'approve' | 'reject', reason: 驳回原因
    const currentUserId = req.session.user?.id
    const currentUserName = req.session.user?.name
    const currentUserRole = req.session.user?.role

    if (!currentUserId || !currentUserName) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    // 检查是否为管理员
    if (!['super_admin', 'admin'].includes(currentUserRole || '')) {
      return res.status(403).json({
        success: false,
        message: '无权限操作',
      })
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: '无效的审批操作',
      })
    }

    const { db } = await import('../db/index.js')

    // 检查报销单是否存在
    const reimbursement = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(id) as any

    if (!reimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在',
      })
    }

    // 检查报销单状态是否为待审批
    const pendingStatuses = ['pending', 'pending_first', 'pending_second', 'pending_final']
    if (!pendingStatuses.includes(reimbursement.status)) {
      return res.status(400).json({
        success: false,
        message: '该报销单不是待审批状态',
      })
    }

    // 更新报销单状态
    // 如果是审批通过且报销金额为0，直接设置为已完成状态
    let newStatus = action === 'approve' ? 'approved' : 'rejected'
    const now = new Date().toISOString()

    // 检查报销金额是否为0（实际报销金额为0时，无需付款流程）
    if (action === 'approve' && reimbursement.total_amount === 0) {
      newStatus = 'completed'
      db.prepare(`
        UPDATE reimbursements
        SET status = ?, approve_time = ?, approver = ?, reject_reason = ?, completed_time = ?, updated_at = ?
        WHERE id = ?
      `).run(newStatus, now, currentUserName, reason || null, now, now, id)

      console.log(`✅ 报销单审批成功（金额为0，直接完成）: ${id}, 审批人: ${currentUserName}`)
    } else {
      db.prepare(`
        UPDATE reimbursements
        SET status = ?, approve_time = ?, approver = ?, reject_reason = ?, updated_at = ?
        WHERE id = ?
      `).run(newStatus, now, currentUserName, reason || null, now, id)

      console.log(`✅ 报销单审批成功: ${id}, 操作: ${action}, 审批人: ${currentUserName}`)
    }

    res.json({
      success: true,
      message: action === 'approve' ? '审批通过' : '已驳回',
    })
  } catch (error) {
    console.error('审批报销单失败:', error)
    res.status(500).json({
      success: false,
      message: '审批失败',
    })
  }
})


/**
 * 上传付款回单并完成付款（合并接口）
 * POST /api/reimbursement/:id/complete-with-proof
 */
router.post('/:id/complete-with-proof', requireAuth, uploadPaymentProof.single('paymentProof'), async (req, res) => {
  try {
    const { id } = req.params
    const currentUserId = req.session.user?.id
    const currentUserRole = req.session.user?.role

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    // 检查是否为管理员
    if (!['super_admin', 'admin'].includes(currentUserRole || '')) {
      return res.status(403).json({
        success: false,
        message: '无权限操作',
      })
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请上传付款回单',
      })
    }

    const { db } = await import('../db/index.js')

    // 检查报销单是否存在
    const reimbursement = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(id) as any

    if (!reimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在',
      })
    }

    // 检查报销单状态是否为已审批通过
    if (reimbursement.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: '只有已审批通过的报销单才能付款',
      })
    }

    // 移动文件到正式目录
    // 优先使用前端传递的原始文件名，否则尝试解码
    const rawPaymentFileName = req.body.originalFileName || Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    // 路径清洗：只取文件名部分，防止路径穿越攻击
    const safePaymentFileName = path.basename(rawPaymentFileName).replace(/[^\w\u4e00-\u9fff.\-]/g, '_')
    const finalFileName = `payment-proof-${id}-${Date.now()}-${safePaymentFileName}`
    const finalPath = path.join(invoicesDir, finalFileName)
    fs.renameSync(req.file.path, finalPath)

    const paymentProofPath = `/uploads/invoices/${finalFileName}`
    const now = new Date().toISOString()

    // 查询该报销单对应的审批实例
    const approvalInstance = db.prepare(`
      SELECT id FROM approval_instances
      WHERE target_id = ? AND target_type = 'reimbursement'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(id) as { id: string } | undefined

    // 更新为已上传付款凭证状态，等待用户确认收款
    db.prepare(`
      UPDATE reimbursements
      SET status = 'payment_uploaded',
          payment_proof_path = ?,
          pay_time = ?,
          payment_upload_time = ?,
          updated_at = ?
      WHERE id = ?
    `).run(paymentProofPath, now, now, now, id)

    // 创建审批记录，记录付款回单上传动作
    if (approvalInstance) {
      const { nanoid } = await import('nanoid')
      const recordId = nanoid()
      db.prepare(`
        INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        recordId,
        approvalInstance.id,
        99,
        currentUserId,
        'payment_uploaded',
        '管理员已上传付款回单',
        now
      )
      console.log(`✅ 创建付款回单审批记录: ${recordId}`)
    }

    console.log(`✅ 付款回单上传成功，等待用户确认收款: ${id}`)

    res.json({
      success: true,
      message: '付款回单上传成功，等待用户确认收款',
      data: {
        paymentProofPath,
      },
    })
  } catch (error) {
    console.error('上传付款回单失败:', error)

    // 清理临时文件
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path)
      } catch (e) {
        console.error('清理临时文件失败:', e)
      }
    }

    res.status(500).json({
      success: false,
      message: '上传失败',
    })
  }
})

/**
 * 用户确认收款
 * POST /api/reimbursement/:id/confirm-receipt
 */
router.post('/:id/confirm-receipt', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const currentUserId = req.session.user?.id
    const currentUserName = req.session.user?.name

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 检查报销单是否存在且属于当前用户
    const reimbursement = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(id) as any

    if (!reimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在',
      })
    }

    // 检查是否是自己的报销单
    if (reimbursement.user_id !== currentUserId) {
      return res.status(403).json({
        success: false,
        message: '无权操作此报销单',
      })
    }

    // 检查报销单状态是否为已上传付款凭证
    if (reimbursement.status !== 'payment_uploaded') {
      return res.status(400).json({
        success: false,
        message: '只有已上传付款凭证的报销单才能确认收款',
      })
    }

    const now = new Date().toISOString()

    db.prepare(`
      UPDATE reimbursements
      SET status = 'completed', completed_time = ?, receipt_confirmed_by = ?, updated_at = ?
      WHERE id = ?
    `).run(now, currentUserName || '用户', now, id)

    console.log(`✅ 用户确认收款完成: ${id}, 确认人: ${currentUserName}`)

    res.json({
      success: true,
      message: '已确认收款',
    })
  } catch (error) {
    console.error('确认收款失败:', error)
    res.status(500).json({
      success: false,
      message: '操作失败',
    })
  }
})

/**
 * 获取报销单详情
 * GET /api/reimbursement/:id
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session.user?.id
    const userRole = req.session.user?.role

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 管理员可以查看所有报销单，总经理只能查看商务报销，普通用户只能查看自己的
    const isAdmin = userRole === 'super_admin' || userRole === 'admin'
    const isGM = userRole === 'general_manager'

    let reimbursement
    if (isAdmin) {
      // 管理员查看所有报销单
      reimbursement = db.prepare(`
        SELECT
          id, type, category, title,
          total_amount as amount,
          total_amount as totalAmount,
          COALESCE(deduction_amount, 0) as deductionAmount,
          status,
          description, business_type as businessType, client,
          user_id as userId, applicant_name as applicant,
          submit_time as submitTime, approve_time as approveTime,
          approver, pay_time as payTime, payment_proof_path as paymentProofPath,
          payment_upload_time as paymentUploadTime, completed_time as completedTime,
          receipt_confirmed_by as receiptConfirmedBy,
          reject_reason as rejectReason,
          reimbursement_scope as reimbursementScope,
          reimbursement_month as reimbursementMonth,
          service_target as serviceTarget,
          created_at as createTime, updated_at as updateTime
        FROM reimbursements
        WHERE id = ?
      `).get(id)
    } else if (isGM) {
      // 总经理只能查看商务报销
      reimbursement = db.prepare(`
        SELECT
          id, type, category, title,
          total_amount as amount,
          total_amount as totalAmount,
          COALESCE(deduction_amount, 0) as deductionAmount,
          status,
          description, business_type as businessType, client,
          user_id as userId, applicant_name as applicant,
          submit_time as submitTime, approve_time as approveTime,
          approver, pay_time as payTime, payment_proof_path as paymentProofPath,
          payment_upload_time as paymentUploadTime, completed_time as completedTime,
          receipt_confirmed_by as receiptConfirmedBy,
          reject_reason as rejectReason,
          reimbursement_scope as reimbursementScope,
          reimbursement_month as reimbursementMonth,
          service_target as serviceTarget,
          created_at as createTime, updated_at as updateTime
        FROM reimbursements
        WHERE id = ? AND (type = 'business' OR user_id = ?)
      `).get(id, userId)
    } else {
      // 普通用户只能查看自己的报销单
      reimbursement = db.prepare(`
        SELECT
          id, type, category, title,
          total_amount as amount,
          total_amount as totalAmount,
          COALESCE(deduction_amount, 0) as deductionAmount,
          status,
          description, business_type as businessType, client,
          user_id as userId, applicant_name as applicant,
          submit_time as submitTime, approve_time as approveTime,
          approver, pay_time as payTime, payment_proof_path as paymentProofPath,
          payment_upload_time as paymentUploadTime, completed_time as completedTime,
          receipt_confirmed_by as receiptConfirmedBy,
          reject_reason as rejectReason,
          reimbursement_scope as reimbursementScope,
          reimbursement_month as reimbursementMonth,
          service_target as serviceTarget,
          created_at as createTime, updated_at as updateTime
        FROM reimbursements
        WHERE id = ? AND user_id = ?
      `).get(id, userId)
    }

    if (!reimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在或无权查看',
      })
    }

    // 查询发票明细
    const invoices = db.prepare(`
      SELECT
        id, amount, invoice_date as invoiceDate, invoice_number as invoiceNumber,
        file_path as filePath, seller, buyer, tax_amount as taxAmount,
        invoice_code as invoiceCode, category, deducted_amount as deductedAmount
      FROM reimbursement_invoices
      WHERE reimbursement_id = ?
      ORDER BY created_at ASC
    `).all(id)

    console.log('📋 查询报销单详情 - ID:', id, '发票数量:', invoices.length)

    // 查询审批历史记录（包括所有历史审批实例的记录，不仅限于当前实例）
    const approvalHistory = db.prepare(`
      SELECT
        ar.id, ar.action, ar.comment, ar.action_time as actionTime,
        u.name as approverName, u.username as approverUsername,
        ai.status as instanceStatus
      FROM approval_records ar
      LEFT JOIN approval_instances ai ON ar.instance_id = ai.id
      LEFT JOIN users u ON ar.approver_id = u.id
      WHERE ai.target_id = ? AND ai.target_type = 'reimbursement'
      ORDER BY ar.action_time ASC
    `).all(id)

    // 格式化审批历史记录的时间
    const formattedApprovalHistory = approvalHistory.map((record: any) => ({
      ...record,
      actionTime: formatDateTime(record.actionTime),
    }))

    console.log('📋 返回报销单详情:', {
      id,
      status: (reimbursement as any).status,
      rejectReason: (reimbursement as any).rejectReason,
      invoicesCount: invoices.length,
      reimbursementScope: (reimbursement as any).reimbursementScope,
      approvalHistoryCount: formattedApprovalHistory.length
    })

    // 格式化时间字段
    const formattedReimbursement = {
      ...reimbursement,
      submitTime: formatDateTime((reimbursement as any).submitTime),
      approveTime: formatDateTime((reimbursement as any).approveTime),
      payTime: formatDateTime((reimbursement as any).payTime),
      paymentUploadTime: formatDateTime((reimbursement as any).paymentUploadTime),
      completedTime: formatDateTime((reimbursement as any).completedTime),
      createTime: formatDateTime((reimbursement as any).createTime),
      updateTime: formatDateTime((reimbursement as any).updateTime),
    }

    res.json({
      success: true,
      data: {
        ...formattedReimbursement,
        invoices,
        approvalHistory: formattedApprovalHistory,
      },
    })
  } catch (error) {
    console.error('获取报销单详情失败:', error)
    res.status(500).json({
      success: false,
      message: '获取报销单详情失败',
    })
  }
})

/**
 * 更新报销单
 * PUT /api/reimbursement/:id
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { category, title, description, invoices, businessType, client, status = 'pending' } = req.body
    const userId = req.session.user?.id
    const userName = req.session.user?.name

    if (!userId || !userName) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    if (!title || !invoices || invoices.length === 0) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    const { db } = await import('../db/index.js')

    // 检查报销单是否存在且属于当前用户
    const existingReimbursement = db.prepare('SELECT * FROM reimbursements WHERE id = ? AND user_id = ?').get(id, userId) as any

    if (!existingReimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在或无权修改',
      })
    }

    // 验证状态值：只能修改草稿或已驳回的单据
    const allowedStatuses = ['draft', 'rejected']
    if (!allowedStatuses.includes(existingReimbursement.status)) {
      return res.status(403).json({
        success: false,
        message: '只能修改草稿或已驳回的报销单',
      })
    }

    // 用户只能将状态改为 draft 或 pending
    const allowedNewStatuses = ['draft', 'pending']
    if (!allowedNewStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '无效的状态值，只能保存草稿或提交审批',
      })
    }

    // 如果是基础报销，需要重新计算核减金额（与创建逻辑一致，不信任客户端传入的核减值）
    let processedInvoices = invoices
    // 计算报销月份（跨月编辑时需要同步更新）
    const reimbursementMonth = calculateReimbursementMonth(new Date(), existingReimbursement.type)

    if (existingReimbursement.type === 'basic') {
      // 获取当月已使用的运输/交通/汽油/柴油类发票额度（排除当前报销单自身）
      // 口径与前端 transport-fuel-quota 一致：排除草稿和已驳回
      const monthlyUsedResult = db.prepare(`
        SELECT COALESCE(SUM(i.amount), 0) as used_amount
        FROM reimbursement_invoices i
        INNER JOIN reimbursements r ON i.reimbursement_id = r.id
        WHERE r.user_id = ?
        AND r.type = 'basic'
        AND r.reimbursement_month = ?
        AND r.status NOT IN ('draft', 'rejected')
        AND r.id != ?
        AND (
          LOWER(i.category) LIKE '%运输%'
          OR LOWER(i.category) LIKE '%交通%'
          OR LOWER(i.category) LIKE '%汽油%'
          OR LOWER(i.category) LIKE '%柴油%'
        )
      `).get(userId, reimbursementMonth, id) as { used_amount: number }

      const monthlyUsedQuota = monthlyUsedResult?.used_amount || 0
      const remainingQuota = Math.max(0, 1500 - monthlyUsedQuota)

      // 计算本次提交的运输/交通/汽油/柴油类发票总额
      let transportFuelTotal = 0
      const transportFuelInvoices: any[] = []

      processedInvoices = invoices.map((inv: any) => {
        const category = (inv.category || '').toLowerCase()
        const isTransportOrFuel =
          category.includes('运输') ||
          category.includes('交通') ||
          category.includes('汽油') ||
          category.includes('柴油')

        if (isTransportOrFuel) {
          transportFuelInvoices.push(inv)
          transportFuelTotal += inv.amount || 0
        }

        return { ...inv, deductedAmount: 0 }
      })

      // 如果运输/交通/汽油/柴油类发票总额超过剩余额度，需要核减
      if (transportFuelTotal > remainingQuota) {
        const deductionAmountCents = Math.round((transportFuelTotal - remainingQuota) * 100)
        const transportFuelTotalCents = Math.round(transportFuelTotal * 100)

        let accumulatedDeductionCents = 0
        const transportInvoices: any[] = []

        processedInvoices.forEach((inv: any) => {
          const category = (inv.category || '').toLowerCase()
          const isTransportOrFuel =
            category.includes('运输') ||
            category.includes('交通') ||
            category.includes('汽油') ||
            category.includes('柴油')

          if (isTransportOrFuel) {
            transportInvoices.push(inv)
          }
        })

        processedInvoices = processedInvoices.map((inv: any) => {
          const category = (inv.category || '').toLowerCase()
          const isTransportOrFuel =
            category.includes('运输') ||
            category.includes('交通') ||
            category.includes('汽油') ||
            category.includes('柴油')

          if (isTransportOrFuel && transportFuelTotalCents > 0) {
            const invAmountCents = Math.round((inv.amount || 0) * 100)
            const ratio = invAmountCents / transportFuelTotalCents
            let invoiceDeductionCents = Math.round(deductionAmountCents * ratio)

            const isLastTransportInvoice = transportInvoices[transportInvoices.length - 1] === inv
            if (isLastTransportInvoice) {
              invoiceDeductionCents = deductionAmountCents - accumulatedDeductionCents
            }

            accumulatedDeductionCents += invoiceDeductionCents
            return { ...inv, deductedAmount: invoiceDeductionCents / 100 }
          }

          return inv
        })
      }
    }

    // 计算总金额（使用实际报销金额，即扣除核减后的金额）
    // 使用分（cents）来避免浮点数精度问题
    const totalAmountCents = processedInvoices.reduce((sum: number, inv: any) => {
      const amountCents = Math.round((inv.amount || 0) * 100)
      const deductedCents = Math.round((inv.deductedAmount || 0) * 100)
      const actualCents = amountCents - deductedCents
      return sum + actualCents
    }, 0)
    const totalAmount = totalAmountCents / 100

    // 如果是提交审批（status 变为 pending），提前进行业务规则校验
    if (status === 'pending') {
      // 大额报销金额验证：总金额必须超过1000元
      if (existingReimbursement.type === 'large' && totalAmount < 1000) {
        return res.status(400).json({
          success: false,
          message: '大额报销适用于发票总金额超过 1000 元的报销申请',
        })
      }
    }

    const timestamp = new Date().toISOString()

    // === 所有校验在写库前完成 ===

    // 校验本次请求内发票号码不重复
    const invoiceNumbers = processedInvoices
      .map((inv: any) => inv.invoiceNumber)
      .filter((n: any) => n)
    const uniqueNumbers = new Set(invoiceNumbers)
    if (uniqueNumbers.size < invoiceNumbers.length) {
      return res.status(400).json({
        success: false,
        message: '提交的发票中存在重复的发票号码',
      })
    }

    // 发票号码数据库唯一性校验移入事务内，利用 SQLite 写锁防并发

    // === 使用 BEGIN IMMEDIATE 立即获取写锁，防并发 ===
    try {
      db.exec('BEGIN IMMEDIATE')

      // 事务内校验发票号码唯一性（已持有写锁，排除当前报销单自身）
      for (const invoiceNumber of uniqueNumbers) {
        const existing = db.prepare(`
          SELECT ri.invoice_number FROM reimbursement_invoices ri
          JOIN reimbursements r ON ri.reimbursement_id = r.id
          WHERE ri.invoice_number = ? AND r.id != ? AND r.status != 'rejected' AND COALESCE(r.is_deleted, 0) = 0
          LIMIT 1
        `).get(invoiceNumber, id)
        if (existing) {
          db.exec('ROLLBACK')
          return res.status(400).json({
            success: false,
            message: `发票号码 ${invoiceNumber} 已存在，请勿重复提交`,
          })
        }
      }

      // 更新报销单主记录（包括 reimbursement_month，跨月编辑时同步更新）
      db.prepare(`
        UPDATE reimbursements
        SET category = ?, title = ?, total_amount = ?, status = ?,
            description = ?, business_type = ?, client = ?, reimbursement_month = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(
        category || null,
        title,
        totalAmount,
        status,
        description || null,
        businessType || null,
        client || null,
        reimbursementMonth,
        timestamp,
        id,
        userId
      )

      // 删除旧的发票明细
      db.prepare('DELETE FROM reimbursement_invoices WHERE reimbursement_id = ?').run(id)

      // 插入新的发票明细
      const insertInvoice = db.prepare(`
        INSERT INTO reimbursement_invoices (
          id, reimbursement_id, amount, invoice_date, invoice_number,
          file_path, seller, buyer, tax_amount, invoice_code, category, deducted_amount, file_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const invoice of processedInvoices) {
        const invoiceId = `INV${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`
        insertInvoice.run(
          invoiceId,
          id,
          invoice.amount || 0,
          invoice.invoiceDate || timestamp.split('T')[0],
          invoice.invoiceNumber || null,
          invoice.filePath || '',
          invoice.seller || null,
          invoice.buyer || null,
          invoice.taxAmount || 0,
          invoice.invoiceCode || null,
          invoice.category || null,
          invoice.deductedAmount || 0,
          invoice.fileHash || null,
          timestamp
        )
      }

      // 如果是从草稿状态或被驳回状态提交审批（status 变为 pending），创建审批实例
      const oldReimbursement = existingReimbursement as any
      if ((oldReimbursement.status === 'draft' || oldReimbursement.status === 'rejected') && status === 'pending') {
        // 更新提交时间，清除驳回原因
        db.prepare('UPDATE reimbursements SET submit_time = ?, reject_reason = NULL WHERE id = ?').run(timestamp, id)

        // 检查是否已有pending状态的审批实例
        const existingApproval = db.prepare(`
          SELECT id FROM approval_instances
          WHERE target_id = ? AND target_type = 'reimbursement' AND status = 'pending'
        `).get(id)

        if (!existingApproval) {
          const approvalInstanceId = nanoid()

          // 确定审批类型
          const approvalType = existingReimbursement.type === 'basic' ? 'reimbursement_basic' :
                              existingReimbursement.type === 'large' ? 'reimbursement_large' :
                              'reimbursement_business'

          db.prepare(`
            INSERT INTO approval_instances (
              id, flow_id, type, target_id, target_type, applicant_id,
              current_step, status, submit_time, created_at, updated_at
            ) VALUES (?, NULL, ?, ?, 'reimbursement', ?, 1, 'pending', ?, ?, ?)
          `).run(
            approvalInstanceId,
            approvalType,
            id,
            userId,
            timestamp,
            timestamp,
            timestamp
          )

          console.log('✅ 草稿提交审批，创建审批实例:', { approvalInstanceId, reimbursementId: id, type: approvalType })

          // 如果是从驳回状态重新提交，添加一条"再次提交"的审批记录
          if (oldReimbursement.status === 'rejected') {
            const recordId = nanoid()
            db.prepare(`
              INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              recordId,
              approvalInstanceId,
              1,
              userId,
              'resubmit',
              '申请人修改后再次提交审批',
              timestamp
            )
          console.log('✅ 添加再次提交记录:', { recordId, approvalInstanceId })
        }
      }
    }

      db.exec('COMMIT')
    } catch (txError: any) {
      try { db.exec('ROLLBACK') } catch { /* 已回滚则忽略 */ }
      throw txError
    }

    res.json({
      success: true,
      data: {
        id,
      },
      message: status === 'draft' ? '草稿保存成功' : '报销单更新成功',
    })
  } catch (error) {
    console.error('更新报销单失败:', error)
    res.status(500).json({
      success: false,
      message: '更新报销单失败',
    })
  }
})

/**
 * 撤回报销单
 * POST /api/reimbursement/:id/withdraw
 * 仅待审批状态可撤回，撤回后状态回到草稿
 */
router.post('/:id/withdraw', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 检查报销单是否存在且属于当前用户
    const reimbursement = db.prepare('SELECT * FROM reimbursements WHERE id = ? AND user_id = ?').get(id, userId) as any

    if (!reimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在或无权操作',
      })
    }

    // 仅待审批状态可撤回
    if (reimbursement.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: '只有待审批状态的报销单可以撤回',
      })
    }

    const now = new Date().toISOString()

    // 将报销单状态改回草稿
    db.prepare('UPDATE reimbursements SET status = ?, updated_at = ? WHERE id = ?').run('draft', now, id)

    // 将对应的审批实例状态改为 withdrawn
    db.prepare(`
      UPDATE approval_instances SET status = 'withdrawn', updated_at = ?
      WHERE target_id = ? AND target_type = 'reimbursement' AND status = 'pending'
    `).run(now, id)

    res.json({
      success: true,
      message: '撤回成功',
    })
  } catch (error) {
    console.error('撤回报销单失败:', error)
    res.status(500).json({
      success: false,
      message: '撤回报销单失败',
    })
  }
})

/**
 * 删除报销单（软删除）
 * DELETE /api/reimbursement/:id
 * 用户删除只是标记删除，管理员在审批中心仍可查看
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 检查报销单是否存在且属于当前用户
    const reimbursement = db.prepare('SELECT * FROM reimbursements WHERE id = ? AND user_id = ?').get(id, userId)

    if (!reimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在或无权删除',
      })
    }

    // 软删除：标记为已删除，而不是真正删除
    const now = new Date().toISOString()
    db.prepare('UPDATE reimbursements SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)

    res.json({
      success: true,
      message: '删除成功',
    })
  } catch (error) {
    console.error('删除报销单失败:', error)
    res.status(500).json({
      success: false,
      message: '删除报销单失败',
    })
  }
})

/**
 * 恢复已删除的报销单
 * POST /api/reimbursement/:id/restore
 */
router.post('/:id/restore', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 检查报销单是否存在且属于当前用户
    const reimbursement = db.prepare('SELECT * FROM reimbursements WHERE id = ? AND user_id = ?').get(id, userId) as any

    if (!reimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在或无权操作',
      })
    }

    if (!reimbursement.is_deleted) {
      return res.status(400).json({
        success: false,
        message: '该报销单未被删除',
      })
    }

    // === 使用 BEGIN IMMEDIATE 立即获取写锁，防并发 ===
    try {
      db.exec('BEGIN IMMEDIATE')

      // 事务内校验：检查该报销单的发票号是否已被其他有效报销单占用
      const invoices = db.prepare('SELECT invoice_number FROM reimbursement_invoices WHERE reimbursement_id = ?').all(id) as any[]
      const conflictInvoices: string[] = []
      for (const inv of invoices) {
        if (!inv.invoice_number) continue
        const conflict = db.prepare(`
          SELECT ri.invoice_number, r.title, r.applicant_name
          FROM reimbursement_invoices ri
          JOIN reimbursements r ON ri.reimbursement_id = r.id
          WHERE ri.invoice_number = ? AND r.id != ? AND r.status != 'rejected' AND COALESCE(r.is_deleted, 0) = 0
          LIMIT 1
        `).get(inv.invoice_number, id) as any
        if (conflict) {
          conflictInvoices.push(`${inv.invoice_number}（已被「${conflict.applicant_name}」的报销单「${conflict.title}」使用）`)
        }
      }

      if (conflictInvoices.length > 0) {
        db.exec('ROLLBACK')
        return res.status(409).json({
          success: false,
          message: `无法恢复，以下发票号已被其他有效报销单占用：${conflictInvoices.join('、')}`,
        })
      }

      const now = new Date().toISOString()
      db.prepare('UPDATE reimbursements SET is_deleted = 0, deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, id)

      db.exec('COMMIT')
    } catch (txError) {
      try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
      throw txError
    }

    res.json({
      success: true,
      message: '恢复成功',
    })
  } catch (error) {
    console.error('恢复报销单失败:', error)
    res.status(500).json({
      success: false,
      message: '恢复报销单失败',
    })
  }
})

export default router
