import { Router } from 'express'
import multer from 'multer'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import { recognizeInvoiceLocally } from '../services/localOcr.js'
import { calculateReimbursementMonth } from '../utils/reimbursement.js'

const router = Router()

// 格式化时间为中国时间 YYYY-MM-DD-HH:mm:ss
function formatDateTime(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  // 使用 Intl.DateTimeFormat 确保转换为中国时区
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const parts = formatter.formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}-${get('hour')}:${get('minute')}:${get('second')}`
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

    // 如果识别失败，返回默认值供用户手动填写
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

    // 查询数据库中是否已存在该发票号码（排除已删除和已拒绝的报销单）
    const existing = db.prepare(`
      SELECT ri.invoice_number, r.id as reimbursement_id, r.title, r.status, r.applicant_name
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE ri.invoice_number = ? AND r.status NOT IN ('rejected', 'deleted')
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
 * GET /api/reimbursement/transport-fuel-quota
 */
router.get('/transport-fuel-quota', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id

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

    // 查询当前报销月份所有已提交(非草稿、非拒绝)的基础报销单中的运输/交通/汽油/柴油类发票
    const result = db.prepare(`
      SELECT COALESCE(SUM(ri.amount), 0) as used_amount
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE r.user_id = ?
        AND r.type = 'basic'
        AND r.status NOT IN ('draft', 'rejected')
        AND r.reimbursement_month = ?
        AND (
          LOWER(ri.category) LIKE '%运输%'
          OR LOWER(ri.category) LIKE '%交通%'
          OR LOWER(ri.category) LIKE '%汽油%'
          OR LOWER(ri.category) LIKE '%柴油%'
        )
    `).get(userId, currentReimbursementMonth) as { used_amount: number }

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
    const decodedFileName = req.body.originalFileName || Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const finalFileName = `invoice-${Date.now()}-${decodedFileName}`
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

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="compressed-${req.file.originalname}"`,
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

    // 已完成统计（包括 paying, payment_uploaded, completed 状态）
    const completedStats = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition} AND status IN ('paying', 'payment_uploaded', 'completed')
    `).get(...baseParams) as { count: number; amount: number }

    const totalStats = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition}
    `).get(...baseParams) as { count: number; amount: number }

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
        id, type, title, total_amount as amount, status,
        applicant_name as applicant,
        submit_time as submitTime,
        approve_time as approveTime,
        approver,
        pay_time as payTime,
        payment_upload_time as paymentUploadTime,
        completed_time as completedTime,
        payment_proof_path as paymentProofPath,
        receipt_confirmed_by as receiptConfirmedBy,
        reimbursement_month as reimbursementMonth,
        created_at as createTime
      FROM reimbursements
      ${whereClause}
      ORDER BY
        CASE WHEN status = 'completed' THEN 1 ELSE 0 END,
        CASE WHEN status = 'completed' THEN completed_time ELSE created_at END DESC
      LIMIT ? OFFSET ?
    `
    params.push(parseInt(pageSize as string), offset)
    const list = db.prepare(listQuery).all(...params)

    // 格式化时间字段
    const formattedList = list.map((item: any) => ({
      ...item,
      submitTime: formatDateTime(item.submitTime),
      approveTime: formatDateTime(item.approveTime),
      payTime: formatDateTime(item.payTime),
      paymentUploadTime: formatDateTime(item.paymentUploadTime),
      completedTime: formatDateTime(item.completedTime),
    }))

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
    const { type, category, title, description, invoices, businessType, client, status = 'pending' } = req.body
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

    // 验证状态值
    const validStatuses = ['draft', 'pending', 'pending_first', 'pending_second', 'pending_final', 'approved', 'paying', 'payment_uploaded', 'completed', 'rejected']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '无效的状态值',
      })
    }

    // 导入数据库
    const { db } = await import('../db/index.js')

    // 计算总金额（使用实际报销金额，即扣除核减后的金额）
    const totalAmount = invoices.reduce((sum: number, inv: any) => sum + (inv.actualAmount || inv.amount || 0), 0)

    // 生成报销单ID
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '')
    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase()
    const reimbursementId = `R${dateStr}${randomStr}`

    const timestamp = now.toISOString()

    // 计算报销月份（只有基础报销使用特殊规则）
    const reimbursementMonth = calculateReimbursementMonth(now, type)

    // 插入报销单主记录
    const insertReimbursement = db.prepare(`
      INSERT INTO reimbursements (
        id, type, category, title, total_amount, status, description,
        business_type, client, user_id, applicant_name,
        submit_time, reimbursement_month, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    insertReimbursement.run(
      reimbursementId,
      type,
      category || null,
      title,
      totalAmount,
      status, // 使用传入的状态值（draft 或 pending）
      description || null,
      businessType || null,
      client || null,
      userId,
      userName,
      timestamp,
      reimbursementMonth,
      timestamp,
      timestamp
    )

    // 插入发票明细
    const insertInvoice = db.prepare(`
      INSERT INTO reimbursement_invoices (
        id, reimbursement_id, amount, invoice_date, invoice_number,
        file_path, seller, buyer, tax_amount, invoice_code, category, deducted_amount, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const invoice of invoices) {
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
        timestamp
      )
    }

    // 如果状态是 pending（提交审批），创建审批实例
    if (status === 'pending') {
      const approvalInstanceId = nanoid()

      // 确定审批类型
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
    const { type, status, page = '1', pageSize = '10' } = req.query
    const userId = req.session.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 构建查询条件（排除已删除的数据）
    let whereClause = 'WHERE user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)'
    const params: any[] = [userId]

    if (type) {
      whereClause += ' AND type = ?'
      params.push(type)
    }

    if (status) {
      whereClause += ' AND status = ?'
      params.push(status)
    }

    // 添加一个月的时间限制（基础/大额/商务报销只显示一个月内的数据）
    const oneMonthAgo = new Date()
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)
    const oneMonthAgoStr = oneMonthAgo.toISOString()
    whereClause += ' AND created_at >= ?'
    params.push(oneMonthAgoStr)

    // 查询总数（包含一个月限制）
    const countQuery = `SELECT COUNT(*) as total FROM reimbursements ${whereClause}`
    const countResult = db.prepare(countQuery).get(...params) as { total: number }
    const total = countResult.total

    // 查询列表（按创建时间降序，新的在上）
    const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string)
    const listQuery = `
      SELECT
        id, type, category, title, total_amount as amount, status,
        business_type as businessType, client,
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
    const { action, reason } = req.body // action: 'approve' | 'reject', reason: 拒绝原因
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
    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE reimbursements
      SET status = ?, approve_time = ?, approver = ?, reject_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(newStatus, now, currentUserName, reason || null, now, id)

    console.log(`✅ 报销单审批成功: ${id}, 操作: ${action}, 审批人: ${currentUserName}`)

    res.json({
      success: true,
      message: action === 'approve' ? '审批通过' : '已拒绝',
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
 * 财务开始付款
 * POST /api/reimbursement/:id/start-payment
 */
router.post('/:id/start-payment', requireAuth, async (req, res) => {
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
        message: '只有已审批通过的报销单才能开始付款',
      })
    }

    const now = new Date().toISOString()

    db.prepare(`
      UPDATE reimbursements
      SET status = 'paying', pay_time = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id)

    console.log(`✅ 报销单开始付款: ${id}`)

    res.json({
      success: true,
      message: '已标记为付款中',
    })
  } catch (error) {
    console.error('标记付款失败:', error)
    res.status(500).json({
      success: false,
      message: '操作失败',
    })
  }
})

/**
 * 财务上传付款凭证
 * POST /api/reimbursement/:id/upload-payment-proof
 */
router.post('/:id/upload-payment-proof', requireAuth, upload.single('paymentProof'), async (req, res) => {
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
        message: '请上传付款凭证',
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

    // 检查报销单状态是否为付款中
    if (reimbursement.status !== 'paying') {
      return res.status(400).json({
        success: false,
        message: '只有付款中的报销单才能上传付款凭证',
      })
    }

    // 移动文件到正式目录
    const finalFileName = `payment-proof-${id}-${Date.now()}.pdf`
    const finalPath = path.join(invoicesDir, finalFileName)
    fs.renameSync(req.file.path, finalPath)

    const paymentProofPath = `/uploads/invoices/${finalFileName}`
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE reimbursements
      SET status = 'payment_uploaded', payment_proof_path = ?, payment_upload_time = ?, updated_at = ?
      WHERE id = ?
    `).run(paymentProofPath, now, now, id)

    console.log(`✅ 付款凭证上传成功: ${id}`)

    res.json({
      success: true,
      message: '付款凭证上传成功',
      data: {
        paymentProofPath,
      },
    })
  } catch (error) {
    console.error('上传付款凭证失败:', error)
    res.status(500).json({
      success: false,
      message: '上传失败',
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
    const decodedPaymentFileName = req.body.originalFileName || Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const finalFileName = `payment-proof-${id}-${Date.now()}-${decodedPaymentFileName}`
    const finalPath = path.join(invoicesDir, finalFileName)
    fs.renameSync(req.file.path, finalPath)

    const paymentProofPath = `/uploads/invoices/${finalFileName}`
    const now = new Date().toISOString()

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
 * 确认付款完成
 * POST /api/reimbursement/:id/complete-payment
 */
router.post('/:id/complete-payment', requireAuth, async (req, res) => {
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

    const { db } = await import('../db/index.js')

    // 检查报销单是否存在
    const reimbursement = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(id) as any

    if (!reimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在',
      })
    }

    // 检查报销单状态是否为已上传付款凭证
    if (reimbursement.status !== 'payment_uploaded') {
      return res.status(400).json({
        success: false,
        message: '只有已上传付款凭证的报销单才能确认完成',
      })
    }

    const now = new Date().toISOString()

    db.prepare(`
      UPDATE reimbursements
      SET status = 'completed', completed_time = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id)

    console.log(`✅ 报销单付款完成: ${id}`)

    res.json({
      success: true,
      message: '付款已完成',
    })
  } catch (error) {
    console.error('确认付款完成失败:', error)
    res.status(500).json({
      success: false,
      message: '操作失败',
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

    // 管理员可以查看所有报销单，普通用户只能查看自己的
    const isAdmin = userRole === 'super_admin' || userRole === 'admin'

    let reimbursement
    if (isAdmin) {
      // 管理员查看所有报销单
      reimbursement = db.prepare(`
        SELECT
          id, type, category, title, total_amount as amount, status,
          description, business_type as businessType, client,
          user_id as userId, applicant_name as applicant,
          submit_time as submitTime, approve_time as approveTime,
          approver, pay_time as payTime, payment_proof_path as paymentProofPath,
          payment_upload_time as paymentUploadTime, completed_time as completedTime,
          receipt_confirmed_by as receiptConfirmedBy,
          reject_reason as rejectReason,
          created_at as createTime, updated_at as updateTime
        FROM reimbursements
        WHERE id = ?
      `).get(id)
    } else {
      // 普通用户只能查看自己的报销单
      reimbursement = db.prepare(`
        SELECT
          id, type, category, title, total_amount as amount, status,
          description, business_type as businessType, client,
          user_id as userId, applicant_name as applicant,
          submit_time as submitTime, approve_time as approveTime,
          approver, pay_time as payTime, payment_proof_path as paymentProofPath,
          payment_upload_time as paymentUploadTime, completed_time as completedTime,
          receipt_confirmed_by as receiptConfirmedBy,
          reject_reason as rejectReason,
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
        invoice_code as invoiceCode
      FROM reimbursement_invoices
      WHERE reimbursement_id = ?
      ORDER BY created_at ASC
    `).all(id)

    console.log('📋 返回报销单详情:', {
      id,
      status: (reimbursement as any).status,
      rejectReason: (reimbursement as any).rejectReason
    })

    res.json({
      success: true,
      data: {
        ...reimbursement,
        invoices,
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

    // 验证状态值
    const validStatuses = ['draft', 'pending', 'pending_first', 'pending_second', 'pending_final', 'approved', 'paying', 'payment_uploaded', 'completed', 'rejected']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '无效的状态值',
      })
    }

    const { db } = await import('../db/index.js')

    // 检查报销单是否存在且属于当前用户
    const existingReimbursement = db.prepare('SELECT * FROM reimbursements WHERE id = ? AND user_id = ?').get(id, userId)

    if (!existingReimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在或无权修改',
      })
    }

    // 计算总金额（使用实际报销金额，即扣除核减后的金额）
    const totalAmount = invoices.reduce((sum: number, inv: any) => sum + (inv.actualAmount || inv.amount || 0), 0)

    const timestamp = new Date().toISOString()

    // 更新报销单主记录
    const updateReimbursement = db.prepare(`
      UPDATE reimbursements
      SET category = ?, title = ?, total_amount = ?, status = ?,
          description = ?, business_type = ?, client = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `)

    updateReimbursement.run(
      category || null,
      title,
      totalAmount,
      status,
      description || null,
      businessType || null,
      client || null,
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
        file_path, seller, buyer, tax_amount, invoice_code, category, deducted_amount, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const invoice of invoices) {
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
        timestamp
      )
    }

    // 如果是从草稿状态或被拒绝状态提交审批（status 变为 pending），创建审批实例
    const oldReimbursement = existingReimbursement as any
    if ((oldReimbursement.status === 'draft' || oldReimbursement.status === 'rejected') && status === 'pending') {
      // 更新提交时间，清除拒绝原因
      db.prepare('UPDATE reimbursements SET submit_time = ?, reject_reason = NULL WHERE id = ?').run(timestamp, id)

      // 检查是否已有pending状态的审批实例
      const existingApproval = db.prepare(`
        SELECT id FROM approval_instances
        WHERE target_id = ? AND target_type = 'reimbursement' AND status = 'pending'
      `).get(id)

      if (!existingApproval) {
        const { nanoid } = await import('nanoid')
        const approvalInstanceId = nanoid()

        // 获取报销单类型
        const reimbursement = db.prepare('SELECT type FROM reimbursements WHERE id = ?').get(id) as any

        // 确定审批类型
        const approvalType = reimbursement.type === 'basic' ? 'reimbursement_basic' :
                            reimbursement.type === 'large' ? 'reimbursement_large' :
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
      }
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

export default router
