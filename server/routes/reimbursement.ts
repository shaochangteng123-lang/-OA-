import { Router } from 'express'
import type { PoolClient } from 'pg'
import multer from 'multer'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { nanoid } from 'nanoid'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { recognizeInvoiceLocally } from '../services/localOcr.js'
import {
  assertReimbursementCompanyInvoice,
  isReimbursementCompanyInvoiceError,
} from '../services/reimbursementInvoiceBuyer.js'
import { recognizeReceipt } from '../services/receiptOcr.js'
import {
  recognizePaymentProof,
  resolveConsistentPaymentProofTransactionDate,
} from '../services/paymentProofOcr.js'
import {
  calculateReimbursementMonth,
  isTransportFuelCategory,
  TRANSPORT_FUEL_CATEGORY_KEYWORDS,
} from '../utils/reimbursement.js'
import { validateFilePath } from '../utils/file-validation.js'
import {
  ensureDatedUploadDirectory,
  toStoredUploadPath,
} from '../utils/upload-date.js'
import { db } from '../db/index.js'
import { isSystemAdminEquivalentRole } from '../utils/boss-role.js'
import {
  findContractFinancialInvoiceUsage,
  findReimbursementInvoiceUsage,
  lockCrossModuleInvoiceNumbers,
  normalizeCrossModuleInvoiceNumber,
} from '../services/invoiceCrossModuleDeduplication.js'
import {
  findExistingPaymentProofIdentity,
  hasDuplicatePaymentProofIdentities,
  lockPaymentProofIdentities,
  normalizePaymentProofIdentities,
  type PaymentProofIdentity,
} from '../utils/payment-proof-identity.js'

const router = Router()

function buildTransportFuelCategoryCondition(alias: string): string {
  const categoryField = `LOWER(${alias}.category)`
  return TRANSPORT_FUEL_CATEGORY_KEYWORDS.map(
    (keyword) => `${categoryField} LIKE '%${keyword.toLowerCase()}%'`,
  ).join('\n          OR ')
}

// 付款回单 OCR 验证缓存（临时文件名 -> OCR 结果）
// 绑定目标单据/批次、验证人、文件哈希、交易流水号，一次性消费，防止重放
const ocrCache = new Map<
  string,
  {
    amount: number
    timestamp: number
    targetType: 'reimbursement' | 'payment_batch'
    targetId: string
    verifierId: string
    fileHash: string
    proofNo: string
    transactionDate: string
  }
>()

// 核减发票 OCR 缓存（临时文件名 -> 识别金额），用途：防客户端篡改金额
const deductionOcrCache = new Map<
  string,
  {
    amount: number
    date: string
    invoiceNumber: string
    fileHash: string
    timestamp: number
  }
>()

// 定期清理过期缓存（30分钟）
setInterval(
  () => {
    const now = Date.now()
    for (const [key, value] of ocrCache.entries()) {
      if (now - value.timestamp > 30 * 60 * 1000) {
        ocrCache.delete(key)
      }
    }
    for (const [key, value] of deductionOcrCache.entries()) {
      if (now - value.timestamp > 30 * 60 * 1000) {
        deductionOcrCache.delete(key)
      }
    }
  },
  5 * 60 * 1000,
)

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
  const match = title.match(
    /^(\d{4}年\d{2}月).*?-(基础报销|大额报销|商务报销)$/,
  )
  if (match) {
    return `${match[1]}-${match[2]}`
  }
  return title
}

class RouteError extends Error {
  statusCode: number
  payload: { success: false; message: string; [key: string]: unknown }

  constructor(
    statusCode: number,
    message: string,
    payload: Record<string, unknown> = {},
  ) {
    super(message)
    this.statusCode = statusCode
    this.payload = { success: false, message, ...payload }
  }
}

function isRouteError(error: unknown): error is RouteError {
  return error instanceof RouteError
}

const CROSS_MODULE_INVOICE_DUPLICATE_CODE =
  'INVOICE_ALREADY_USED_IN_OTHER_MODULE'
const REIMBURSEMENT_INVOICE_DUPLICATE_CODE =
  'INVOICE_ALREADY_USED_IN_REIMBURSEMENT'

function reimbursementInvoiceDuplicateMessage(
  applicantName: unknown,
  usageKind: 'invoice' | 'deduction',
): string {
  const displayName = String(applicantName || '').trim() || '该申请人'
  const uploadArea = usageKind === 'deduction' ? '核减上传' : '发票上传'
  return `${displayName} 已在${uploadArea}中上传此发票，请勿重复上传`
}

function uploadingInvoiceDuplicateMessage(invoiceNumber: unknown): string {
  const displayNumber = String(invoiceNumber || '').trim()
  return displayNumber
    ? `发票号码 ${displayNumber}已在报销模块使用，请勿重复上传`
    : '此发票已在报销模块使用，请勿重复上传'
}

function crossUploadInvoiceDuplicateMessage(
  invoiceNumber: unknown,
  existingUsageKind: 'invoice' | 'deduction',
): string {
  const displayNumber = String(invoiceNumber || '').trim()
  const uploadArea =
    existingUsageKind === 'deduction' ? '核减发票上传' : '发票上传'
  return displayNumber
    ? `发票号码 ${displayNumber}已在${uploadArea}报销模块使用，请勿重复上传`
    : `此发票已在${uploadArea}报销模块使用，请勿重复上传`
}

function currentUploadInvoiceDuplicateMessage(
  invoiceNumber: unknown,
  existingUsageKind: 'invoice' | 'deduction',
  incomingUsageKind: 'invoice' | 'deduction',
): string {
  return existingUsageKind === incomingUsageKind
    ? uploadingInvoiceDuplicateMessage(invoiceNumber)
    : crossUploadInvoiceDuplicateMessage(invoiceNumber, existingUsageKind)
}

function findCurrentUploadDuplicate(
  invoices: readonly Record<string, unknown>[],
): {
  invoiceNumber: string
  existingUsageKind: 'invoice' | 'deduction'
  incomingUsageKind: 'invoice' | 'deduction'
} | null {
  const firstUsageByNumber = new Map<
    string,
    'invoice' | 'deduction'
  >()
  for (const invoice of invoices) {
    const normalizedNumber = normalizeCrossModuleInvoiceNumber(
      invoice.invoiceNumber,
    )
    if (!normalizedNumber) continue
    const incomingUsageKind = invoice.isDeduction ? 'deduction' : 'invoice'
    const existingUsageKind = firstUsageByNumber.get(normalizedNumber)
    if (existingUsageKind) {
      return {
        invoiceNumber:
          String(invoice.invoiceNumber || '').trim() || normalizedNumber,
        existingUsageKind,
        incomingUsageKind,
      }
    }
    firstUsageByNumber.set(normalizedNumber, incomingUsageKind)
  }
  return null
}

async function assertInvoicesNotUsedInContractFinancial(
  client: PoolClient,
  invoiceNumbers: readonly unknown[],
): Promise<void> {
  const originalByNormalized = new Map<string, string>()
  for (const invoiceNumber of invoiceNumbers) {
    const normalized = normalizeCrossModuleInvoiceNumber(invoiceNumber)
    if (normalized && !originalByNormalized.has(normalized)) {
      originalByNormalized.set(normalized, String(invoiceNumber || '').trim())
    }
  }
  const normalizedNumbers = await lockCrossModuleInvoiceNumbers(
    client,
    invoiceNumbers,
  )
  for (const normalizedInvoiceNumber of normalizedNumbers) {
    const usage = await findContractFinancialInvoiceUsage(
      client,
      normalizedInvoiceNumber,
    )
    if (usage) {
      const displayNumber =
        originalByNormalized.get(normalizedInvoiceNumber) ||
        normalizedInvoiceNumber
      throw new RouteError(
        409,
        `发票号码 ${displayNumber} 已在合同财务模块使用，不能再进入报销`,
        { code: CROSS_MODULE_INVOICE_DUPLICATE_CODE },
      )
    }
  }
}

async function contractFinancialInvoiceUsageExists(
  invoiceNumber: unknown,
): Promise<boolean> {
  const normalizedInvoiceNumber =
    normalizeCrossModuleInvoiceNumber(invoiceNumber)
  if (!normalizedInvoiceNumber) return false
  return db.transaction(async (client) =>
    Boolean(
      await findContractFinancialInvoiceUsage(client, normalizedInvoiceNumber),
    ),
  )
}

async function reimbursementInvoiceUsage(
  invoiceNumber: unknown,
  excludeReimbursementId: string | null = null,
) {
  const normalizedInvoiceNumber = normalizeCrossModuleInvoiceNumber(invoiceNumber)
  if (!normalizedInvoiceNumber) return null
  return db.transaction((client) =>
    findReimbursementInvoiceUsage(
      client,
      normalizedInvoiceNumber,
      excludeReimbursementId,
    ),
  )
}

async function assertInvoicesNotUsedInReimbursement(
  client: PoolClient,
  invoiceNumbers: readonly unknown[],
  excludeReimbursementId: string | null = null,
): Promise<void> {
  const normalizedNumbers = await lockCrossModuleInvoiceNumbers(
    client,
    invoiceNumbers,
  )
  for (const normalizedInvoiceNumber of normalizedNumbers) {
    const usage = await findReimbursementInvoiceUsage(
      client,
      normalizedInvoiceNumber,
      excludeReimbursementId,
    )
    if (usage) {
      throw new RouteError(
        409,
        reimbursementInvoiceDuplicateMessage(
          usage.applicantName,
          usage.usageKind,
        ),
        { code: REIMBURSEMENT_INVOICE_DUPLICATE_CODE },
      )
    }
  }
}

async function lockReimbursementInvoiceFileHashes(
  client: PoolClient,
  fileHashes: readonly unknown[],
): Promise<void> {
  const hashes = [
    ...new Set(
      fileHashes
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right))
  for (const fileHash of hashes) {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended('reimbursement-invoice-file:' || $1, 0)
       )`,
      [fileHash],
    )
  }
}

async function verifyDeductionInvoicePayloads(
  invoices: any[],
  userId: string,
  existingReimbursementId: string | null = null,
): Promise<any[]> {
  const verified: any[] = []
  for (const invoice of invoices) {
    const submittedFilePath = String(invoice?.filePath || '')
    const isDeductionInvoice =
      Boolean(invoice?.isDeduction) ||
      path.basename(submittedFilePath).startsWith('deduction-')
    if (!isDeductionInvoice) {
      verified.push({ ...invoice, deductedAmount: 0 })
      continue
    }
    const filePath = submittedFilePath
    if (!filePath || !validateFilePath(filePath)) {
      throw new RouteError(403, '核减发票文件路径不合法')
    }
    if (existingReimbursementId) {
      const stored = (await db
        .prepare(
          `SELECT amount, invoice_date, invoice_number, file_hash
           FROM reimbursement_invoices
           WHERE reimbursement_id = ? AND file_path = ? AND is_deduction = 1`,
        )
        .get(existingReimbursementId, filePath)) as
        | {
            amount: number
            invoice_date: string
            invoice_number: string | null
            file_hash: string | null
          }
        | undefined
      if (stored) {
        verified.push({
          ...invoice,
          amount: Number(stored.amount),
          invoiceDate: stored.invoice_date,
          invoiceNumber: stored.invoice_number || '',
          fileHash: stored.file_hash || '',
          deductedAmount: 0,
          isDeduction: true,
        })
        continue
      }
    }
    const fileName = path.basename(filePath)
    const cachedOcr = deductionOcrCache.get(fileName)
    if (!cachedOcr || Date.now() - cachedOcr.timestamp > 30 * 60 * 1000) {
      throw new RouteError(
        400,
        '核减发票识别结果已过期，请重新上传文件',
      )
    }
    const uploadedRecord = await db
      .prepare(
        `SELECT id FROM user_uploaded_files WHERE user_id = ? AND file_path = ?`,
      )
      .get(userId, filePath)
    if (!uploadedRecord) {
      throw new RouteError(403, '核减发票文件不属于当前用户')
    }
    verified.push({
      ...invoice,
      amount: cachedOcr.amount,
      invoiceDate: cachedOcr.date,
      invoiceNumber: cachedOcr.invoiceNumber,
      fileHash: cachedOcr.fileHash,
      deductedAmount: 0,
      isDeduction: true,
    })
  }
  return verified
}

function reimbursementInvoiceNumbersForCrossModule(
  invoices: readonly Record<string, unknown>[],
): unknown[] {
  return invoices
    .filter((invoice) => {
      const fileName = path.posix.basename(String(invoice.filePath || ''))
      const invoiceNumber = String(invoice.invoiceNumber || '')
      return (
        invoiceNumber &&
        !fileName.startsWith('receipt-') &&
        !invoiceNumber.toUpperCase().startsWith('RECEIPT-')
      )
    })
    .map((invoice) => invoice.invoiceNumber)
}

function convertTxPlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

async function txGet<T = any>(
  client: PoolClient,
  sql: string,
  ...params: any[]
): Promise<T | undefined> {
  const result = await client.query(convertTxPlaceholders(sql), params)
  return result.rows[0] as T | undefined
}

async function txAll<T = any>(
  client: PoolClient,
  sql: string,
  ...params: any[]
): Promise<T[]> {
  const result = await client.query(convertTxPlaceholders(sql), params)
  return result.rows as T[]
}

async function txRun(
  client: PoolClient,
  sql: string,
  ...params: any[]
): Promise<{ changes: number }> {
  const result = await client.query(convertTxPlaceholders(sql), params)
  return { changes: result.rowCount ?? 0 }
}

// 确保上传目录存在
const uploadsDir = path.join(process.cwd(), 'uploads')
const tempDir = path.join(uploadsDir, 'temp')

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

// 配置 multer 用于付款回单上传（仅支持JPG和PNG图片）
const uploadPaymentProof = multer({
  dest: tempDir,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png']
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('付款回单只支持 JPG/PNG 格式'))
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

;[uploadsDir, tempDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
})

/**
 * PDF压缩功能
 * 使用 pdf-lib 压缩PDF文件
 */
async function compressPDF(
  inputPath: string,
  outputPath: string,
): Promise<void> {
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
  sellerTaxId?: string
  buyer?: string
  buyerTaxId?: string
  taxAmount?: number
  invoiceCode?: string
  isValidInvoice: boolean
}> {
  console.log('🔍 使用本地 OCR 识别发票...')
  console.log('🔒 数据安全：所有识别在本地完成，不会上传到外部服务器')

  try {
    // 使用本地 OCR 服务
    const result = await recognizeInvoiceLocally(filePath)
    assertReimbursementCompanyInvoice(result)
    console.log('✅ 本地 OCR 识别完成')
    return result
  } catch (error) {
    console.error('❌ 本地 OCR 识别失败:', error)

    // 如果是无效发票错误，直接抛出，不返回默认值
    if (
      error instanceof Error &&
      (error.message.includes('此不是发票文件') ||
        error.message.includes('此不是有效发票') ||
        isReimbursementCompanyInvoiceError(error))
    ) {
      throw error
    }

    // OCR 识别失败，返回零值供用户手动填写，但标记为无效发票
    console.warn('⚠️  OCR 识别失败，返回空值，请手动核对发票信息')

    return {
      amount: 0,
      date: '',
      invoiceNumber: '',
      seller: '',
      isValidInvoice: false, // 识别失败时标记为无效，避免污染核减上传
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

    // 普通发票和独立核减发票使用同一套规范化号码查重；草稿也占用号码，
    // 已驳回或已删除记录不占用。
    const existingUsage = await reimbursementInvoiceUsage(invoiceNumber)

    if (existingUsage) {
      return res.json({
        success: true,
        data: {
          duplicate: true,
          code: REIMBURSEMENT_INVOICE_DUPLICATE_CODE,
          message: reimbursementInvoiceDuplicateMessage(
            existingUsage.applicantName,
            existingUsage.usageKind,
          ),
        },
      })
    }

    if (await contractFinancialInvoiceUsageExists(invoiceNumber)) {
      return res.json({
        success: true,
        data: {
          duplicate: true,
          code: CROSS_MODULE_INVOICE_DUPLICATE_CODE,
          message: `发票号码 ${invoiceNumber} 已在合同财务模块使用，不能再进入报销`,
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
 * 查询用户当月交通额度类发票已使用额度
 * GET /api/reimbursement/transport-fuel-quota?excludeId=xxx
 */
router.get('/transport-fuel-quota', requireAuth, async (req, res) => {
  try {
    const sessionUserId = req.session.user?.id
    const userRole = req.session.user?.role
    const { excludeId } = req.query // 要排除的报销单ID（编辑模式）

    if (!sessionUserId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    // 管理员查看他人报销单时，使用申请人的 user_id 计算月度额度
    // 避免用管理员自己的额度数据影响申请人的报销显示
    let userId = sessionUserId
    const isAdmin =
      userRole === 'admin' || isSystemAdminEquivalentRole(userRole)
    if (excludeId && isAdmin) {
      const record = (await db
        .prepare('SELECT user_id FROM reimbursements WHERE id = ?')
        .get(excludeId)) as { user_id: string } | undefined
      if (record?.user_id) {
        userId = record.user_id
      }
    }

    // 获取当前报销月份(使用与创建报销单相同的逻辑)
    const now = new Date()
    const currentReimbursementMonth = calculateReimbursementMonth(now, 'basic')

    // 查询当前报销月份所有已提交(非草稿、非驳回)的基础报销单中的交通额度类发票
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
          ${buildTransportFuelCategoryCondition('ri')}
        )
    `

    const result = (await db.prepare(sql).get(...params)) as {
      used_amount: number
    }

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
router.post(
  '/upload-invoice',
  requireAuth,
  upload.single('invoice'),
  async (req, res) => {
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
      let currentReimbursementId: string | null = null
      const rawRequestedReimbursementId = String(
        req.body.reimbursementId || '',
      ).trim()
      const requestedReimbursementId = /^(?:create|new|undefined|null)$/i.test(
        rawRequestedReimbursementId,
      )
        ? ''
        : rawRequestedReimbursementId
      if (requestedReimbursementId) {
        const uploadUserId = req.session.user?.id || req.session.userId
        const editableReimbursement = (await db
          .prepare(
            `SELECT id FROM reimbursements
             WHERE id = ? AND user_id = ?
               AND status IN ('draft', 'rejected')
               AND COALESCE(is_deleted, FALSE) = FALSE`,
          )
          .get(requestedReimbursementId, uploadUserId)) as
          | { id: string }
          | undefined
        if (!editableReimbursement) {
          try {
            fs.unlinkSync(tempFilePath)
          } catch {
            /* 已清理时忽略 */
          }
          return res.status(403).json({
            success: false,
            message: '当前报销单不可编辑或不属于当前用户',
          })
        }
        currentReimbursementId = editableReimbursement.id
      }

      // 先计算文件哈希，快速查重（在 OCR 之前）
      const fileBuffer = fs.readFileSync(tempFilePath)
      const fileHash = crypto
        .createHash('sha256')
        .update(fileBuffer)
        .digest('hex')
      console.log('🔑 文件哈希:', fileHash)

      // 检查普通发票表（排除核减发票记录）
      const existingInvoice = (await db
        .prepare(
          `
      SELECT ri.file_hash, ri.invoice_number, r.id AS reimbursement_id,
        r.applicant_name
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE ri.file_hash = ? AND COALESCE(ri.is_deduction, 0) = 0 AND r.status != 'rejected' AND COALESCE(r.is_deleted, FALSE) = FALSE
      LIMIT 1
    `,
        )
        .get(fileHash)) as
        | {
            file_hash: string
            invoice_number: string | null
            reimbursement_id: string
            applicant_name: string
          }
        | undefined

      if (existingInvoice) {
        // 清理临时文件
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          /* 忽略 */
        }
        return res.status(400).json({
          success: false,
          message:
            currentReimbursementId === existingInvoice.reimbursement_id
              ? currentUploadInvoiceDuplicateMessage(
                  existingInvoice.invoice_number,
                  'invoice',
                  'invoice',
                )
              : reimbursementInvoiceDuplicateMessage(
                  existingInvoice.applicant_name,
                  'invoice',
                ),
        })
      }

      // 检查普通发票表中的核减发票记录
      const existingDeductionInInvoices = (await db
        .prepare(
          `
      SELECT ri.file_hash, ri.invoice_number, r.id AS reimbursement_id,
        r.applicant_name
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE ri.file_hash = ? AND COALESCE(ri.is_deduction, 0) = 1 AND r.status != 'rejected' AND COALESCE(r.is_deleted, FALSE) = FALSE
      LIMIT 1
    `,
        )
        .get(fileHash)) as
        | {
            file_hash: string
            invoice_number: string | null
            reimbursement_id: string
            applicant_name: string
          }
        | undefined

      if (existingDeductionInInvoices) {
        // 清理临时文件
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          /* 忽略 */
        }
        return res.status(400).json({
          success: false,
          message:
            currentReimbursementId ===
            existingDeductionInInvoices.reimbursement_id
              ? currentUploadInvoiceDuplicateMessage(
                  existingDeductionInInvoices.invoice_number,
                  'deduction',
                  'invoice',
                )
              : reimbursementInvoiceDuplicateMessage(
                  existingDeductionInInvoices.applicant_name,
                  'deduction',
                ),
        })
      }

      // 检查核减发票表（交叉查重）
      const existingDeduction = (await db
        .prepare(
          `
      SELECT rdi.file_hash, rdi.invoice_number, r.id AS reimbursement_id,
        r.applicant_name
      FROM reimbursement_deduction_invoices rdi
      JOIN reimbursements r ON rdi.reimbursement_id = r.id
      WHERE rdi.file_hash = ? AND r.status <> 'rejected'
        AND COALESCE(r.is_deleted, FALSE) = FALSE
      LIMIT 1
    `,
        )
        .get(fileHash)) as
        | {
            file_hash: string
            invoice_number: string | null
            reimbursement_id: string
            applicant_name: string
          }
        | undefined

      if (existingDeduction) {
        // 清理临时文件
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          /* 忽略 */
        }
        return res.status(400).json({
          success: false,
          message:
            currentReimbursementId === existingDeduction.reimbursement_id
              ? currentUploadInvoiceDuplicateMessage(
                  existingDeduction.invoice_number,
                  'deduction',
                  'invoice',
                )
              : reimbursementInvoiceDuplicateMessage(
                  existingDeduction.applicant_name,
                  'deduction',
                ),
        })
      }

      let finalFilePath = tempFilePath
      let compressed = false

      // 如果文件超过5MB，进行压缩
      if (fileSize > maxSize) {
        console.log(
          `📦 文件大小 ${(fileSize / 1024 / 1024).toFixed(2)}MB，开始压缩...`,
        )
        const compressedPath = path.join(
          tempDir,
          `compressed-${Date.now()}.pdf`,
        )

        try {
          await compressPDF(tempFilePath, compressedPath)
          finalFilePath = compressedPath
          compressed = true

          const compressedSize = fs.statSync(compressedPath).size
          console.log(
            `✅ 压缩完成，压缩后大小: ${(compressedSize / 1024 / 1024).toFixed(2)}MB`,
          )
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
          message: '此不是有效发票，请重新上传',
          isValidInvoice: false,
        })
      }

      const existingReimbursementUsage = ocrResult.invoiceNumber
        ? await reimbursementInvoiceUsage(ocrResult.invoiceNumber)
        : null
      if (existingReimbursementUsage) {
        for (const candidatePath of new Set([tempFilePath, finalFilePath])) {
          try {
            fs.unlinkSync(candidatePath)
          } catch {
            /* 已清理时忽略 */
          }
        }
        return res.status(409).json({
          success: false,
          code: REIMBURSEMENT_INVOICE_DUPLICATE_CODE,
          message:
            currentReimbursementId === existingReimbursementUsage.ownerId
              ? currentUploadInvoiceDuplicateMessage(
                  ocrResult.invoiceNumber,
                  existingReimbursementUsage.usageKind,
                  'invoice',
                )
              : reimbursementInvoiceDuplicateMessage(
                  existingReimbursementUsage.applicantName,
                  existingReimbursementUsage.usageKind,
                ),
        })
      }

      if (
        ocrResult.invoiceNumber &&
        (await contractFinancialInvoiceUsageExists(ocrResult.invoiceNumber))
      ) {
        for (const candidatePath of new Set([tempFilePath, finalFilePath])) {
          try {
            fs.unlinkSync(candidatePath)
          } catch {
            /* 已清理时忽略 */
          }
        }
        return res.status(409).json({
          success: false,
          code: CROSS_MODULE_INVOICE_DUPLICATE_CODE,
          message: `发票号码 ${ocrResult.invoiceNumber} 已在合同财务模块使用，不能再进入报销`,
        })
      }

      // 移动文件到正式目录
      // 优先使用前端传递的原始文件名，否则尝试解码
      const rawFileName =
        req.body.originalFileName ||
        Buffer.from(req.file.originalname, 'latin1').toString('utf8')
      console.log('📝 原始文件名:', rawFileName)
      // 路径清洗：只取文件名部分，防止路径穿越攻击
      const safeFileName = path
        .basename(rawFileName)
        .replace(/[^\w\u4e00-\u9fff.\-]/g, '_')
      console.log('📝 清洗后文件名:', safeFileName)
      const finalFileName = `invoice-${Date.now()}-${safeFileName}`
      console.log('📝 最终文件名:', finalFileName)
      const invoicesDir = ensureDatedUploadDirectory('invoices')
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

      const uploadedFilePath = toStoredUploadPath(finalPath)
      const uploadUserId = req.session.userId || req.session.user?.id

      // 将上传路径记录到数据库，供草稿预览权限校验使用（替代 session，避免刷新后丢失）
      if (uploadUserId) {
        await db.run(
          `INSERT INTO user_uploaded_files (id, user_id, file_path, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT (user_id, file_path) DO NOTHING`,
          nanoid(),
          uploadUserId,
          uploadedFilePath,
          new Date().toISOString(),
        )
      }

      res.json({
        success: true,
        message: '发票上传成功',
        data: {
          fileName: finalFileName,
          filePath: uploadedFilePath,
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

      // 区分业务错误（识别失败）和服务器错误
      const isBusinessError =
        error instanceof Error &&
        (error.message.includes('此不是发票文件') ||
          error.message.includes('此不是有效发票') ||
          isReimbursementCompanyInvoiceError(error) ||
          error.message.includes('识别失败'))

      res.status(isBusinessError ? 400 : 500).json({
        success: false,
        message: error instanceof Error ? error.message : '上传失败',
      })
    }
  },
)

/**
 * 上传收据/支付截图并进行OCR识别
 * POST /api/reimbursement/upload-receipt
 */
router.post(
  '/upload-receipt',
  requireAuth,
  uploadReceipt.single('receipt'),
  async (req, res) => {
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
      const fileHash = crypto
        .createHash('sha256')
        .update(fileBuffer)
        .digest('hex')
      console.log('🔑 文件哈希:', fileHash)

      // 检查普通发票表
      const existingInvoice = (await db
        .prepare(
          `
      SELECT ri.file_hash, r.applicant_name
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE ri.file_hash = ? AND r.status != 'rejected' AND COALESCE(r.is_deleted, FALSE) = FALSE
      LIMIT 1
    `,
        )
        .get(fileHash)) as
        | { file_hash: string; applicant_name: string }
        | undefined

      if (existingInvoice) {
        // 清理临时文件
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          /* 忽略 */
        }
        return res.status(400).json({
          success: false,
          message: `${existingInvoice.applicant_name} 已上传此支付截图，请勿重复上传`,
        })
      }

      // 检查核减发票表（交叉查重）
      const existingDeduction = (await db
        .prepare(
          `
      SELECT rdi.file_hash, r.applicant_name
      FROM reimbursement_deduction_invoices rdi
      JOIN reimbursements r ON rdi.reimbursement_id = r.id
      WHERE rdi.file_hash = ? AND r.status <> 'rejected'
        AND COALESCE(r.is_deleted, FALSE) = FALSE
      LIMIT 1
    `,
        )
        .get(fileHash)) as
        | { file_hash: string; applicant_name: string }
        | undefined

      if (existingDeduction) {
        // 清理临时文件
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          /* 忽略 */
        }
        return res.status(400).json({
          success: false,
          message: reimbursementInvoiceDuplicateMessage(
            existingDeduction.applicant_name,
            'deduction',
          ),
        })
      }

      // 进行OCR识别
      console.log('🔍 开始OCR识别支付截图...')
      const ocrResult = await recognizeReceipt(tempFilePath)
      console.log('✅ OCR识别完成:', ocrResult)

      // 查重：检查交易单号是否已存在
      if (ocrResult.transactionNo) {
        const existingInvoice = (await db
          .prepare(
            `
        SELECT
          ri.invoice_number,
          ri.amount,
          ri.invoice_date,
          r.applicant_name,
          r.created_at
        FROM reimbursement_invoices ri
        JOIN reimbursements r ON ri.reimbursement_id = r.id
        WHERE ri.invoice_number = ? AND r.status != 'rejected' AND COALESCE(r.is_deleted, FALSE) = FALSE
        LIMIT 1
      `,
          )
          .get(ocrResult.transactionNo)) as
          | {
              invoice_number: string
              amount: number
              invoice_date: string
              applicant_name: string
              created_at: string
            }
          | undefined

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
      const rawReceiptName =
        req.body.originalFileName ||
        Buffer.from(req.file.originalname, 'latin1').toString('utf8')
      // 路径清洗：只取文件名部分，防止路径穿越攻击
      const safeReceiptName = path
        .basename(rawReceiptName)
        .replace(/[^\w\u4e00-\u9fff.\-]/g, '_')
      const finalFileName = `receipt-${Date.now()}-${safeReceiptName}`
      const invoicesDir = ensureDatedUploadDirectory('invoices')
      const finalPath = path.join(invoicesDir, finalFileName)
      fs.renameSync(tempFilePath, finalPath)

      const receiptFilePath = toStoredUploadPath(finalPath)
      const receiptUserId = req.session.userId || req.session.user?.id

      // 将上传路径记录到数据库，供草稿预览权限校验使用（替代 session，避免刷新后丢失）
      if (receiptUserId) {
        await db.run(
          `INSERT INTO user_uploaded_files (id, user_id, file_path, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT (user_id, file_path) DO NOTHING`,
          nanoid(),
          receiptUserId,
          receiptFilePath,
          new Date().toISOString(),
        )
      }

      res.json({
        success: true,
        message: '收据上传成功',
        data: {
          fileName: finalFileName,
          filePath: receiptFilePath,
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

      // 区分业务错误（识别失败）和服务器错误
      const isBusinessError =
        error instanceof Error &&
        (error.message.includes('识别失败') || error.message.includes('无效'))

      res.status(isBusinessError ? 400 : 500).json({
        success: false,
        message: error instanceof Error ? error.message : '上传失败',
      })
    }
  },
)

/**
 * 上传核减发票并进行OCR识别
 * POST /api/reimbursement/upload-deduction-invoice
 * 仅支持PDF，单文件不超过5MB
 */
const uploadDeduction = multer({
  dest: tempDir,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('核减发票仅支持PDF格式'))
    }
  },
})

router.post(
  '/upload-deduction-invoice',
  requireAuth,
  uploadDeduction.single('invoice'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: '请上传PDF文件' })
      }

      const tempFilePath = req.file.path
      console.log('📄 收到核减发票上传:', req.file.originalname)

      let duplicateExcludeId: string | null = null
      const rawRequestedReimbursementId = String(
        req.body.reimbursementId || '',
      ).trim()
      const requestedReimbursementId = /^(?:create|new|undefined|null)$/i.test(
        rawRequestedReimbursementId,
      )
        ? ''
        : rawRequestedReimbursementId
      if (requestedReimbursementId) {
        const uploadUserId = req.session.user?.id || req.session.userId
        const editableReimbursement = (await db
          .prepare(
            `SELECT id FROM reimbursements
             WHERE id = ? AND user_id = ?
               AND status IN ('draft', 'rejected')
               AND COALESCE(is_deleted, FALSE) = FALSE`,
          )
          .get(requestedReimbursementId, uploadUserId)) as
          | { id: string }
          | undefined
        if (!editableReimbursement) {
          try {
            fs.unlinkSync(tempFilePath)
          } catch {
            /* 已清理时忽略 */
          }
          return res.status(403).json({
            success: false,
            message: '当前报销单不可编辑或不属于当前用户',
          })
        }
        duplicateExcludeId = editableReimbursement.id
      }

      // 计算文件哈希查重
      const fileBuffer = fs.readFileSync(tempFilePath)
      const fileHash = crypto
        .createHash('sha256')
        .update(fileBuffer)
        .digest('hex')

      // 检查核减发票表
      const existingDeduction = (await db
        .prepare(
          `
      SELECT rdi.file_hash, r.applicant_name
      FROM reimbursement_deduction_invoices rdi
      JOIN reimbursements r ON rdi.reimbursement_id = r.id
      WHERE rdi.file_hash = ? AND (?::text IS NULL OR r.id <> ?)
        AND r.status <> 'rejected'
        AND COALESCE(r.is_deleted, FALSE) = FALSE
      LIMIT 1
    `,
        )
        .get(fileHash, duplicateExcludeId, duplicateExcludeId)) as
        | { file_hash: string; applicant_name: string }
        | undefined

      if (existingDeduction) {
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          /* 忽略 */
        }
        return res.status(400).json({
          success: false,
          message: reimbursementInvoiceDuplicateMessage(
            existingDeduction.applicant_name,
            'deduction',
          ),
        })
      }

      // 检查普通发票表（交叉查重，排除核减发票记录）
      const existingInvoice = (await db
        .prepare(
          `
      SELECT ri.file_hash, r.applicant_name
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE ri.file_hash = ?
        AND (?::text IS NULL OR r.id <> ?)
        AND COALESCE(ri.is_deduction, 0) = 0
        AND r.status != 'rejected'
        AND COALESCE(r.is_deleted, FALSE) = FALSE
      LIMIT 1
    `,
        )
        .get(fileHash, duplicateExcludeId, duplicateExcludeId)) as
        | { file_hash: string; applicant_name: string }
        | undefined

      if (existingInvoice) {
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          /* 忽略 */
        }
        return res.status(400).json({
          success: false,
          message: reimbursementInvoiceDuplicateMessage(
            existingInvoice.applicant_name,
            'invoice',
          ),
        })
      }

      // 检查普通发票表中的核减发票记录
      const existingDeductionInInvoices = (await db
        .prepare(
          `
      SELECT ri.file_hash, r.applicant_name
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE ri.file_hash = ?
        AND (?::text IS NULL OR r.id <> ?)
        AND COALESCE(ri.is_deduction, 0) = 1
        AND r.status != 'rejected'
        AND COALESCE(r.is_deleted, FALSE) = FALSE
      LIMIT 1
    `,
        )
        .get(fileHash, duplicateExcludeId, duplicateExcludeId)) as
        | { file_hash: string; applicant_name: string }
        | undefined

      if (existingDeductionInInvoices) {
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          /* 忽略 */
        }
        return res.status(400).json({
          success: false,
          message: reimbursementInvoiceDuplicateMessage(
            existingDeductionInInvoices.applicant_name,
            'deduction',
          ),
        })
      }

      // 使用本地OCR识别
      let ocrResult: {
        amount: number
        date: string
        invoiceNumber?: string
        seller?: string
        sellerTaxId?: string
        buyer?: string
        buyerTaxId?: string
        isValidInvoice: boolean
      }
      try {
        ocrResult = await recognizeInvoice(tempFilePath)
      } catch (ocrErr) {
        // OCR识别失败，清理临时文件并返回错误
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          /* 忽略 */
        }

        // 如果是"此不是有效发票"的错误，直接返回
        if (
          ocrErr instanceof Error &&
          (ocrErr.message.includes('此不是有效发票') ||
            isReimbursementCompanyInvoiceError(ocrErr))
        ) {
          return res.status(400).json({
            success: false,
            message: ocrErr.message,
          })
        }

        // 其他OCR错误
        return res.status(400).json({
          success: false,
          message: '核减发票识别失败，请重新上传',
        })
      }

      // 验证发票有效性：必须是有效发票且金额大于0
      if (
        !ocrResult.isValidInvoice ||
        !ocrResult.amount ||
        ocrResult.amount <= 0
      ) {
        try {
          fs.unlinkSync(tempFilePath)
        } catch (e) {
          /* 忽略 */
        }
        return res.status(400).json({
          success: false,
          message: '此不是有效发票或金额识别失败，请重新上传',
        })
      }

      const existingReimbursementUsage = ocrResult.invoiceNumber
        ? await reimbursementInvoiceUsage(
            ocrResult.invoiceNumber,
            duplicateExcludeId,
          )
        : null
      if (existingReimbursementUsage) {
        try {
          fs.unlinkSync(tempFilePath)
        } catch {
          /* 已清理时忽略 */
        }
        return res.status(409).json({
          success: false,
          code: REIMBURSEMENT_INVOICE_DUPLICATE_CODE,
          message: reimbursementInvoiceDuplicateMessage(
            existingReimbursementUsage.applicantName,
            existingReimbursementUsage.usageKind,
          ),
        })
      }

      // 验证发票日期：核减发票只能是当年的
      if (ocrResult.date) {
        const invoiceDate = new Date(ocrResult.date)
        const currentYear = new Date().getFullYear()
        const invoiceYear = invoiceDate.getFullYear()

        if (invoiceYear !== currentYear) {
          try {
            fs.unlinkSync(tempFilePath)
          } catch (e) {
            /* 忽略 */
          }
          return res.status(400).json({
            success: false,
            message: `核减发票只能是${currentYear}年的，当前发票日期为${invoiceYear}年`,
          })
        }
      }

      if (
        ocrResult.invoiceNumber &&
        (await contractFinancialInvoiceUsageExists(ocrResult.invoiceNumber))
      ) {
        try {
          fs.unlinkSync(tempFilePath)
        } catch {
          /* 已清理时忽略 */
        }
        return res.status(409).json({
          success: false,
          code: CROSS_MODULE_INVOICE_DUPLICATE_CODE,
          message: `发票号码 ${ocrResult.invoiceNumber} 已在合同财务模块使用，不能再进入报销`,
        })
      }

      // 保存文件
      const finalFileName = `deduction-${nanoid(8)}-${Date.now()}.pdf`
      const invoicesDir = ensureDatedUploadDirectory('invoices')
      const finalPath = path.join(invoicesDir, finalFileName)
      fs.copyFileSync(tempFilePath, finalPath)

      // 清理临时文件
      try {
        fs.unlinkSync(tempFilePath)
      } catch (e) {
        /* 忽略 */
      }

      // 缓存核减发票OCR结果（防客户端篡改金额）
      deductionOcrCache.set(finalFileName, {
        amount: ocrResult.amount,
        date: ocrResult.date || new Date().toISOString().slice(0, 10),
        invoiceNumber: ocrResult.invoiceNumber || '',
        fileHash,
        timestamp: Date.now(),
      })

      const deductionFilePath = toStoredUploadPath(finalPath)
      const deductionUserId = req.session.userId || req.session.user?.id

      // 将上传路径记录到数据库，供草稿预览权限校验使用（替代 session，避免刷新后丢失）
      if (deductionUserId) {
        await db.run(
          `INSERT INTO user_uploaded_files (id, user_id, file_path, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT (user_id, file_path) DO NOTHING`,
          nanoid(),
          deductionUserId,
          deductionFilePath,
          new Date().toISOString(),
        )
      }

      res.json({
        success: true,
        message: '核减发票上传成功',
        data: {
          fileName: finalFileName,
          filePath: deductionFilePath,
          fileHash,
          ocrResult: {
            amount: ocrResult.amount,
            date: ocrResult.date,
            invoiceNumber: ocrResult.invoiceNumber,
          },
        },
      })
    } catch (error) {
      console.error('上传核减发票失败:', error)
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path)
        } catch (e) {
          /* 忽略 */
        }
      }
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : '上传失败',
      })
    }
  },
)

/**
 * 获取报销单核减发票列表
 * GET /api/reimbursement/:id/deduction-invoices
 */
router.get('/:id/deduction-invoices', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session.user?.id
    if (!userId)
      return res.status(401).json({ success: false, message: '未登录' })

    // 确认该报销单属于当前用户（或管理员可查看）
    const user = req.session.user!
    const isAdmin =
      user.role === 'admin' || isSystemAdminEquivalentRole(user.role)

    const reimbursement = (await db
      .prepare(
        `SELECT id, user_id, status FROM reimbursements WHERE id = ? AND COALESCE(is_deleted, FALSE) = FALSE`,
      )
      .get(id)) as { id: string; user_id: string; status: string } | undefined

    if (!reimbursement) {
      return res.status(404).json({ success: false, message: '报销单不存在' })
    }
    if (!isAdmin && reimbursement.user_id !== userId) {
      return res.status(403).json({ success: false, message: '无权查看' })
    }

    const invoices = await db.all(
      `SELECT * FROM reimbursement_deduction_invoices WHERE reimbursement_id = ? ORDER BY created_at ASC`,
      id,
    )

    res.json({ success: true, data: invoices })
  } catch (error) {
    console.error('获取核减发票失败:', error)
    res.status(500).json({ success: false, message: '获取核减发票失败' })
  }
})

/**
 * 保存核减发票到报销单
 * POST /api/reimbursement/:id/deduction-invoices
 */
router.post('/:id/deduction-invoices', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session.user?.id
    if (!userId)
      return res.status(401).json({ success: false, message: '未登录' })

    const { filePath, fileHash, amount, invoiceDate, invoiceNumber } = req.body
    if (!filePath || amount === undefined) {
      return res.status(400).json({ success: false, message: '缺少必要参数' })
    }

    // 校验文件路径：必须是合法的服务端路径且属于当前用户上传的文件
    if (!validateFilePath(filePath)) {
      return res.status(403).json({ success: false, message: '非法文件路径' })
    }
    const uploadedRecord = (await db
      .prepare(
        `SELECT id FROM user_uploaded_files WHERE user_id = ? AND file_path = ?`,
      )
      .get(userId, filePath)) as { id: string } | undefined
    if (!uploadedRecord) {
      return res
        .status(403)
        .json({ success: false, message: '文件路径无效，请重新上传' })
    }

    // 确认报销单归属
    const reimbursement = (await db
      .prepare(
        `SELECT id, user_id, status FROM reimbursements WHERE id = ? AND COALESCE(is_deleted, FALSE) = FALSE`,
      )
      .get(id)) as { id: string; user_id: string; status: string } | undefined

    if (!reimbursement) {
      return res.status(404).json({ success: false, message: '报销单不存在' })
    }
    if (reimbursement.user_id !== userId) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }
    if (!['draft', 'rejected'].includes(reimbursement.status)) {
      return res.status(409).json({
        success: false,
        message: '只有草稿或已驳回报销单可以新增核减发票',
      })
    }

    // 防篡改校验：从缓存中读取服务端识别的金额，与客户端提交的金额对比
    const fileName = filePath.split('/').pop()
    let verifiedAmount = Number(amount)
    let verifiedInvoiceDate = String(invoiceDate || '')
    let verifiedInvoiceNumber = String(invoiceNumber || '')
    let verifiedFileHash = String(fileHash || '')
    if (fileName) {
      const cachedOcr = deductionOcrCache.get(fileName)
      if (cachedOcr) {
        // 允许 0.01 元的浮点误差
        if (Math.abs(cachedOcr.amount - amount) > 0.01) {
          return res.status(400).json({
            success: false,
            message: `金额校验失败：客户端提交 ${amount} 元，服务端识别 ${cachedOcr.amount} 元，请勿篡改金额`,
          })
        }
        verifiedAmount = cachedOcr.amount
        verifiedInvoiceDate = cachedOcr.date
        verifiedInvoiceNumber = cachedOcr.invoiceNumber
        verifiedFileHash = cachedOcr.fileHash
      } else {
        // 缓存已过期或不存在，拒绝保存
        return res.status(400).json({
          success: false,
          message: '金额校验失败：识别结果已过期，请重新上传文件',
        })
      }
    }

    const invoiceId = nanoid()
    const now = new Date().toISOString()
    await db.transaction(async (client) => {
      await assertInvoicesNotUsedInContractFinancial(client, [
        verifiedInvoiceNumber,
      ])
      await assertInvoicesNotUsedInReimbursement(client, [
        verifiedInvoiceNumber,
      ])
      await lockReimbursementInvoiceFileHashes(client, [verifiedFileHash])
      if (verifiedFileHash) {
        const existingByHash = await txGet<{
          applicant_name: string
          usage_kind: 'invoice' | 'deduction'
        }>(
          client,
          `SELECT applicant_name, usage_kind FROM (
             SELECT r.applicant_name,
               CASE WHEN COALESCE(ri.is_deduction, 0) = 1
                 THEN 'deduction' ELSE 'invoice' END AS usage_kind
             FROM reimbursement_invoices ri
             JOIN reimbursements r ON r.id = ri.reimbursement_id
             WHERE ri.file_hash = ? AND r.status <> 'rejected'
               AND COALESCE(r.is_deleted, FALSE) = FALSE
             UNION ALL
             SELECT r.applicant_name, 'deduction'::text AS usage_kind
             FROM reimbursement_deduction_invoices rdi
             JOIN reimbursements r ON r.id = rdi.reimbursement_id
             WHERE rdi.file_hash = ? AND r.status <> 'rejected'
               AND COALESCE(r.is_deleted, FALSE) = FALSE
           ) duplicate_file LIMIT 1`,
          verifiedFileHash,
          verifiedFileHash,
        )
        if (existingByHash) {
          throw new RouteError(
            409,
            reimbursementInvoiceDuplicateMessage(
              existingByHash.applicant_name,
              existingByHash.usage_kind,
            ),
            { code: REIMBURSEMENT_INVOICE_DUPLICATE_CODE },
          )
        }
      }
      await txRun(
        client,
        `INSERT INTO reimbursement_deduction_invoices (id, reimbursement_id, amount, invoice_date, invoice_number, file_path, created_at, file_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        invoiceId,
        id,
        verifiedAmount,
        verifiedInvoiceDate || now.slice(0, 10),
        verifiedInvoiceNumber,
        filePath,
        now,
        verifiedFileHash,
      )
    })
    if (fileName) deductionOcrCache.delete(fileName)

    res.json({
      success: true,
      message: '核减发票保存成功',
      data: { id: invoiceId },
    })
  } catch (error) {
    if (isRouteError(error)) {
      return res.status(error.statusCode).json(error.payload)
    }
    console.error('保存核减发票失败:', error)
    res.status(500).json({ success: false, message: '保存核减发票失败' })
  }
})

/**
 * 删除核减发票
 * DELETE /api/reimbursement/deduction-invoices/:invoiceId
 */
router.delete(
  '/deduction-invoices/:invoiceId',
  requireAuth,
  async (req, res) => {
    try {
      const { invoiceId } = req.params
      const userId = req.session.user?.id
      if (!userId)
        return res.status(401).json({ success: false, message: '未登录' })

      const invoice = (await db
        .prepare(
          `SELECT rdi.*, r.user_id, r.status FROM reimbursement_deduction_invoices rdi
       JOIN reimbursements r ON rdi.reimbursement_id = r.id
       WHERE rdi.id = ?`,
        )
        .get(invoiceId)) as any

      if (!invoice)
        return res
          .status(404)
          .json({ success: false, message: '核减发票不存在' })
      if (invoice.user_id !== userId)
        return res.status(403).json({ success: false, message: '无权操作' })
      if (!['draft', 'rejected'].includes(invoice.status)) {
        return res.status(409).json({
          success: false,
          message: '只有草稿或已驳回报销单可以删除核减发票',
        })
      }

      await db.run(
        `DELETE FROM reimbursement_deduction_invoices WHERE id = ?`,
        invoiceId,
      )

      // 删除文件：先校验路径合法性，防止路径穿越攻击
      if (invoice.file_path) {
        if (!validateFilePath(invoice.file_path)) {
          console.error(
            '❌ 发现非法 file_path，跳过文件删除:',
            invoice.file_path,
          )
        } else {
          const fullPath = path.join(process.cwd(), invoice.file_path)
          try {
            fs.unlinkSync(fullPath)
          } catch (e) {
            /* 忽略 */
          }
        }
      }

      res.json({ success: true, message: '删除成功' })
    } catch (error) {
      console.error('删除核减发票失败:', error)
      res.status(500).json({ success: false, message: '删除失败' })
    }
  },
)

/**
 * 查询当年累计核减金额（每年1月1日清零）
 * GET /api/reimbursement/deduction-quota?excludeId=xxx
 */
router.get('/deduction-quota', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id
    if (!userId)
      return res.status(401).json({ success: false, message: '未登录' })

    const { excludeId } = req.query
    const now = new Date()
    const year = now.getFullYear()
    const yearStr = `${year}`

    // 查询核减发票的累计金额（is_deduction = 1）
    let deductionInvoiceSql = `
      SELECT COALESCE(SUM(ri.amount), 0) as total_amount
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE r.user_id = ?
        AND r.status IN ('approved', 'payment_uploaded', 'completed')
        AND COALESCE(r.is_deleted, FALSE) = FALSE
        AND r.reimbursement_month LIKE ?
        AND ri.is_deduction = 1
    `
    const params: any[] = [userId, `${yearStr}%`]

    if (excludeId) {
      deductionInvoiceSql += ' AND r.id != ?'
      params.push(excludeId)
    }

    // 查询普通发票的核减金额累计（deducted_amount）
    let invoiceDeductionSql = `
      SELECT COALESCE(SUM(ri.deducted_amount), 0) as total_amount
      FROM reimbursement_invoices ri
      JOIN reimbursements r ON ri.reimbursement_id = r.id
      WHERE r.user_id = ?
        AND r.status IN ('approved', 'payment_uploaded', 'completed')
        AND COALESCE(r.is_deleted, FALSE) = FALSE
        AND r.reimbursement_month LIKE ?
        AND COALESCE(ri.is_deduction, 0) = 0
    `
    const params2: any[] = [userId, `${yearStr}%`]

    if (excludeId) {
      invoiceDeductionSql += ' AND r.id != ?'
      params2.push(excludeId)
    }

    const deductionInvoiceResult = (await db
      .prepare(deductionInvoiceSql)
      .get(...params)) as { total_amount: number }
    const invoiceDeductionResult = (await db
      .prepare(invoiceDeductionSql)
      .get(...params2)) as { total_amount: number }

    const yearlyDeductionTotal =
      (deductionInvoiceResult?.total_amount || 0) +
      (invoiceDeductionResult?.total_amount || 0)
    res.json({ success: true, data: { yearlyDeductionTotal } })
  } catch (error) {
    console.error('获取核减额度失败:', error)
    res.status(500).json({ success: false, message: '获取核减额度失败' })
  }
})

/**
 * 单独的PDF压缩接口
 * POST /api/reimbursement/compress-pdf
 */
router.post(
  '/compress-pdf',
  requireAuth,
  upload.single('pdf'),
  async (req, res) => {
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
      const compressionRatio = (
        (1 - compressedSize / originalSize) *
        100
      ).toFixed(2)

      // 读取压缩后的文件
      const compressedBuffer = fs.readFileSync(outputPath)

      // 清理临时文件
      fs.unlinkSync(inputPath)
      fs.unlinkSync(outputPath)

      // 清洗文件名，防止特殊字符导致响应头异常
      const safeOriginalName = path
        .basename(req.file.originalname)
        .replace(/[^\w\u4e00-\u9fff.\-]/g, '_')
      // 使用 RFC 5987 编码确保中文文件名兼容
      const encodedFileName = encodeURIComponent(
        `compressed-${safeOriginalName}`,
      )

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
  },
)

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
    let baseCondition = 'user_id = ? AND COALESCE(is_deleted, FALSE) = FALSE'
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
    const pendingStats = (await db
      .prepare(
        `
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition} AND status IN ('pending', 'pending_first', 'pending_second', 'pending_final')
    `,
      )
      .get(...baseParams)) as { count: number; amount: number }

    const approvedStats = (await db
      .prepare(
        `
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition} AND status = 'approved'
    `,
      )
      .get(...baseParams)) as { count: number; amount: number }

    const rejectedStats = (await db
      .prepare(
        `
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition} AND status = 'rejected'
    `,
      )
      .get(...baseParams)) as { count: number; amount: number }

    // 已完成统计（包括 payment_uploaded, completed 状态）
    const completedStats = (await db
      .prepare(
        `
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition} AND status IN ('payment_uploaded', 'completed')
    `,
      )
      .get(...baseParams)) as { count: number; amount: number }

    const totalStats = (await db
      .prepare(
        `
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE ${baseCondition}
    `,
      )
      .get(...baseParams)) as { count: number; amount: number }

    // 查询核减金额统计（仅基础报销，每年1月1日清零，仅统计已完成状态的报销单）
    // 包括两部分：1. 系统自动核减金额（deducted_amount）2. 核减发票金额（is_deduction = 1）
    let deductedCondition = `r.user_id = ? AND r.type = ? AND r.status = ?`
    const deductedParams: any[] = [userId, 'basic', 'completed']

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

    // 统计系统自动核减金额（deducted_amount）
    const autoDeductedStats = (await db
      .prepare(
        `
      SELECT COALESCE(SUM(i.deducted_amount), 0) as amount
      FROM reimbursement_invoices i
      INNER JOIN reimbursements r ON i.reimbursement_id = r.id
      WHERE ${deductedCondition}
    `,
      )
      .get(...deductedParams)) as { amount: number }

    // 统计核减发票金额（is_deduction = 1）
    const deductionInvoiceStats = (await db
      .prepare(
        `
      SELECT COALESCE(SUM(i.amount), 0) as amount
      FROM reimbursement_invoices i
      INNER JOIN reimbursements r ON i.reimbursement_id = r.id
      WHERE ${deductedCondition} AND i.is_deduction = 1
    `,
      )
      .get(...deductedParams)) as { amount: number }

    // 总核减金额 = 系统自动核减 + 核减发票
    const totalDeductedAmount =
      autoDeductedStats.amount + deductionInvoiceStats.amount

    // 查询有核减的报销单数量（包括自动核减和核减发票）
    const deductedCountStats = (await db
      .prepare(
        `
      SELECT COUNT(DISTINCT r.id) as count
      FROM reimbursements r
      INNER JOIN reimbursement_invoices i ON r.id = i.reimbursement_id
      WHERE ${deductedCondition}
      AND (i.deducted_amount > 0 OR i.is_deduction = 1)
    `,
      )
      .get(...deductedParams)) as { count: number }

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
        amount: totalDeductedAmount,
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
    const {
      page = '1',
      pageSize = '20',
      type,
      status,
      startDate,
      endDate,
    } = req.query
    const userId = req.session.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 构建查询条件（报销统计，包括已删除的，默认只显示已完成）
    let whereClause = 'WHERE user_id = ? AND status = ?'
    const params: any[] = [userId, (status as string) || 'completed']

    if (type) {
      whereClause += ' AND type = ?'
      params.push(type)
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
    const countResult = (await db.prepare(countQuery).get(...params)) as {
      total: number
    }
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
        (SELECT STRING_AGG(DISTINCT category, ',') FROM reimbursement_invoices WHERE reimbursement_id = r.id AND category IS NOT NULL) as invoiceCategories
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
    const list = await db.prepare(listQuery).all(...params)

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
    const {
      type,
      category,
      title,
      description,
      invoices,
      businessType,
      client: clientName,
      status = 'pending',
      reimbursementScope,
      serviceTarget,
    } = req.body
    const userId = req.session.user?.id
    const userName = req.session.user?.name

    // 调试日志：查看提交的发票数据
    console.log('📋 创建报销单 - 发票数量:', invoices?.length)
    console.log(
      '📋 发票数据:',
      JSON.stringify(
        invoices?.map((inv: any) => ({
          category: inv.category,
          amount: inv.amount,
          isDeduction: inv.isDeduction,
        })),
        null,
        2,
      ),
    )

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

    // 服务端统一重算核减金额，不信任客户端传入的 deductedAmount
    let processedInvoices = await verifyDeductionInvoicePayloads(
      invoices,
      userId,
    )
    if (type === 'basic') {
      // 获取当月已使用的交通额度类发票额度
      // 使用 calculateReimbursementMonth 确保与入库时的 reimbursement_month 口径一致（本地时区）
      const currentMonth = calculateReimbursementMonth(new Date(), 'basic')
      const monthlyUsedResult = (await db
        .prepare(
          `
        SELECT COALESCE(SUM(i.amount), 0) as used_amount
        FROM reimbursement_invoices i
        INNER JOIN reimbursements r ON i.reimbursement_id = r.id
        WHERE r.user_id = ?
        AND r.type = 'basic'
        AND r.reimbursement_month = ?
        AND r.status NOT IN ('draft', 'rejected')
        AND (
          ${buildTransportFuelCategoryCondition('i')}
        )
      `,
        )
        .get(userId, currentMonth)) as { used_amount: number }

      const monthlyUsedQuota = monthlyUsedResult?.used_amount || 0
      const remainingQuota = Math.max(0, 1500 - monthlyUsedQuota)

      // 计算本次提交的交通额度类发票总额
      let transportFuelTotal = 0

      processedInvoices = processedInvoices.map((inv: any) => {
        const isTransportOrFuel = isTransportFuelCategory(inv.category)

        if (isTransportOrFuel) {
          transportFuelTotal += inv.amount || 0
        }

        return { ...inv, deductedAmount: 0 }
      })

      // 如果交通额度类发票总额超过剩余额度，需要核减
      if (transportFuelTotal > remainingQuota) {
        const deductionAmountCents = Math.round(
          (transportFuelTotal - remainingQuota) * 100,
        )
        const transportFuelTotalCents = Math.round(transportFuelTotal * 100)

        // 按比例分配核减金额到每张交通额度类发票
        // 使用分（cents）来避免精度问题
        let accumulatedDeductionCents = 0
        const transportInvoices: any[] = []

        processedInvoices.forEach((inv: any) => {
          const isTransportOrFuel = isTransportFuelCategory(inv.category)

          if (isTransportOrFuel) {
            transportInvoices.push(inv)
          }
        })

        processedInvoices = processedInvoices.map((inv: any) => {
          const isTransportOrFuel = isTransportFuelCategory(inv.category)

          if (isTransportOrFuel && transportFuelTotalCents > 0) {
            const invAmountCents = Math.round((inv.amount || 0) * 100)
            const ratio = invAmountCents / transportFuelTotalCents
            let invoiceDeductionCents = Math.round(deductionAmountCents * ratio)

            // 最后一张运输类发票，调整核减金额以确保总和精确
            const isLastTransportInvoice =
              transportInvoices[transportInvoices.length - 1] === inv
            if (isLastTransportInvoice) {
              invoiceDeductionCents =
                deductionAmountCents - accumulatedDeductionCents
            }

            accumulatedDeductionCents += invoiceDeductionCents
            return { ...inv, deductedAmount: invoiceDeductionCents / 100 }
          }

          return inv
        })
      }
    }

    // 计算总金额（使用实际报销金额，即扣除核减后的金额）
    // 核减发票不计入报销金额
    // 使用分（cents）来避免浮点数精度问题
    const totalAmountCents = processedInvoices.reduce(
      (sum: number, inv: any) => {
        // 核减发票不计入报销金额
        if (inv.isDeduction) {
          return sum
        }
        const amountCents = Math.round((inv.amount || 0) * 100)
        const deductedCents = Math.round((inv.deductedAmount || 0) * 100)
        const actualCents = amountCents - deductedCents
        return sum + actualCents
      },
      0,
    )
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

    // 校验发票文件路径安全性
    for (const invoice of processedInvoices) {
      if (invoice.filePath && !validateFilePath(invoice.filePath)) {
        return res.status(400).json({
          success: false,
          message: '发票文件路径不合法',
        })
      }
    }

    // 校验本次请求内发票号码不重复
    const invoiceNumbers = processedInvoices
      .map((inv: any) => inv.invoiceNumber)
      .filter((n: any) => n)
    const currentUploadDuplicate = findCurrentUploadDuplicate(processedInvoices)
    if (currentUploadDuplicate) {
      return res.status(400).json({
        success: false,
        message: currentUploadInvoiceDuplicateMessage(
          currentUploadDuplicate.invoiceNumber,
          currentUploadDuplicate.existingUsageKind,
          currentUploadDuplicate.incomingUsageKind,
        ),
      })
    }

    // 使用 PostgreSQL 事务校验唯一性并写入主表和发票明细
    await db.transaction(async (client) => {
      await assertInvoicesNotUsedInContractFinancial(
        client,
        reimbursementInvoiceNumbersForCrossModule(processedInvoices),
      )
      await assertInvoicesNotUsedInReimbursement(client, invoiceNumbers)
      await lockReimbursementInvoiceFileHashes(
        client,
        processedInvoices.map((invoice: any) => invoice.fileHash),
      )

      // 事务内校验文件哈希唯一性（防止同一文件被上传到不同报销单）
      for (const invoice of processedInvoices) {
        if (invoice.fileHash) {
          const existingByHash = await txGet<{
            file_hash: string
            applicant_name: string
            usage_kind: 'invoice' | 'deduction'
          }>(
            client,
            `
            SELECT file_hash, applicant_name, usage_kind FROM (
              SELECT ri.file_hash, r.applicant_name,
                CASE WHEN COALESCE(ri.is_deduction, 0) = 1
                  THEN 'deduction' ELSE 'invoice' END AS usage_kind
              FROM reimbursement_invoices ri
              JOIN reimbursements r ON ri.reimbursement_id = r.id
              WHERE ri.file_hash = ? AND r.status <> 'rejected'
                AND COALESCE(r.is_deleted, FALSE) = FALSE
              UNION ALL
              SELECT rdi.file_hash, r.applicant_name,
                'deduction'::text AS usage_kind
              FROM reimbursement_deduction_invoices rdi
              JOIN reimbursements r ON rdi.reimbursement_id = r.id
              WHERE rdi.file_hash = ? AND r.status <> 'rejected'
                AND COALESCE(r.is_deleted, FALSE) = FALSE
            ) duplicate_file LIMIT 1
          `,
            invoice.fileHash,
            invoice.fileHash,
          )
          if (existingByHash) {
            throw new RouteError(
              400,
              reimbursementInvoiceDuplicateMessage(
                existingByHash.applicant_name,
                existingByHash.usage_kind,
              ),
            )
          }
        }
      }

      // 插入报销单主记录
      await txRun(
        client,
        `
        INSERT INTO reimbursements (
          id, type, category, title, total_amount, status, description,
          business_type, client, user_id, applicant_name,
          submit_time, reimbursement_month, reimbursement_scope, service_target, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        reimbursementId,
        type,
        category || null,
        title,
        totalAmount,
        status,
        description || null,
        businessType || null,
        clientName || serviceTarget || null,
        userId,
        userName,
        status === 'pending' ? timestamp : null,
        reimbursementMonth,
        reimbursementScope || null,
        serviceTarget || null,
        timestamp,
        timestamp,
      )

      // 插入发票明细
      for (const invoice of processedInvoices) {
        const invoiceId = `INV${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`
        await txRun(
          client,
          `
          INSERT INTO reimbursement_invoices (
            id, reimbursement_id, amount, invoice_date, invoice_number,
            file_path, seller, buyer, tax_amount, invoice_code, category, deducted_amount, file_hash, is_deduction, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
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
          invoice.isDeduction ? 1 : 0,
          timestamp,
        )
      }

      // 如果状态是 pending（提交审批），创建审批实例
      if (status === 'pending') {
        const approvalInstanceId = nanoid()

        const approvalType =
          type === 'basic'
            ? 'reimbursement_basic'
            : type === 'large'
              ? 'reimbursement_large'
              : 'reimbursement_business'

        await txRun(
          client,
          `
          INSERT INTO approval_instances (
            id, flow_id, type, target_id, target_type, applicant_id,
            current_step, status, submit_time, created_at, updated_at
          ) VALUES (?, NULL, ?, ?, 'reimbursement', ?, 1, 'pending', ?, ?, ?)
        `,
          approvalInstanceId,
          approvalType,
          reimbursementId,
          userId,
          timestamp,
          timestamp,
          timestamp,
        )

        console.log('✅ 创建审批实例:', {
          approvalInstanceId,
          reimbursementId,
          type: approvalType,
        })
      }
    })

    for (const invoice of processedInvoices) {
      if (invoice.isDeduction && invoice.filePath) {
        deductionOcrCache.delete(path.basename(invoice.filePath))
      }
    }
    // 报销单提交成功后，清理该用户的临时上传记录（发票已关联到正式报销单）
    await db.run(`DELETE FROM user_uploaded_files WHERE user_id = ?`, userId)

    res.json({
      success: true,
      data: {
        id: reimbursementId,
      },
      message: status === 'draft' ? '草稿保存成功' : '报销单提交成功',
    })
  } catch (error) {
    if (isRouteError(error)) {
      return res.status(error.statusCode).json(error.payload)
    }
    console.error('创建报销单失败:', error)
    console.error('错误详情:', error instanceof Error ? error.message : error)
    res.status(500).json({
      success: false,
      message: '创建报销单失败',
    })
  }
})

/**
 * 获取报销单列表
 * GET /api/reimbursement/list
 */
router.get('/list', requireAuth, async (req, res) => {
  try {
    const {
      type,
      status,
      page = '1',
      pageSize = '10',
      startDate,
      endDate,
    } = req.query
    const userId = req.session.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 构建查询条件
    // 用户列表页始终排除已删除数据
    let whereClause =
      'WHERE user_id = ? AND COALESCE(is_deleted, FALSE) = FALSE'
    const params: any[] = [userId]

    if (type) {
      whereClause += ' AND type = ?'
      params.push(type)

      // 大额报销只显示金额 >= 1000 的记录，但草稿和已驳回状态除外（允许用户继续编辑）
      if (type === 'large') {
        whereClause +=
          " AND (total_amount >= 1000 OR status IN ('draft', 'rejected'))"
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
      // 默认显示当月创建的数据，以及所有历史未完成的记录（未完成的跨月数据始终可见）
      const now = new Date()
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      whereClause +=
        " AND (created_at >= ? OR status NOT IN ('completed', 'withdrawn'))"
      params.push(firstDayOfMonth.toISOString())
    }

    // 查询总数（包含一个月限制）
    const countQuery = `SELECT COUNT(*) as total FROM reimbursements ${whereClause}`
    const countResult = (await db.prepare(countQuery).get(...params)) as {
      total: number
    }
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
        COALESCE(r.is_deleted, FALSE) as isDeleted,
        (SELECT STRING_AGG(DISTINCT category, ',') FROM reimbursement_invoices WHERE reimbursement_id = r.id AND category IS NOT NULL) as invoiceCategories
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
    const list = await db.prepare(listQuery).all(...params)

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
router.get('/pending-list', requireAdmin, async (req, res) => {
  try {
    const { page = '1', pageSize = '20', type } = req.query
    const currentUserId = req.session.userId!

    const { db } = await import('../db/index.js')

    // 构建查询条件
    let whereClause =
      "WHERE status IN ('pending', 'pending_first', 'pending_second', 'pending_final') AND COALESCE(is_deleted, FALSE) = FALSE"
    const params: any[] = []

    if (type) {
      whereClause += ' AND type = ?'
      params.push(type)
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM reimbursements ${whereClause}`
    const countResult = (await db.prepare(countQuery).get(...params)) as {
      total: number
    }
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
    const list = await db.prepare(listQuery).all(...params)

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
 * 审批报销单（旧接口，已废弃）
 * POST /api/reimbursement/:id/approve
 * 此接口不再使用，所有审批操作请走 /api/approval/:id/approve 或 /api/approval/:id/reject
 */
router.post('/:id/approve', requireAuth, async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: '此接口已废弃，请使用新审批接口 /api/approval/:id/approve',
  })
})

/**
 * 上传单张付款回单并进行OCR识别验证（不提交，仅验证）
 * POST /api/reimbursement/:id/verify-proof
 */
router.post(
  '/:id/verify-proof',
  requireAdmin,
  uploadPaymentProof.single('paymentProof'),
  async (req, res) => {
    try {
      const { id } = req.params

      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: '请上传付款回单' })
      }

      const { db } = await import('../db/index.js')
      const reimbursement = (await db
        .prepare('SELECT * FROM reimbursements WHERE id = ?')
        .get(id)) as any
      if (!reimbursement) {
        try {
          fs.unlinkSync(req.file.path)
        } catch (_) {}
        return res.status(404).json({ success: false, message: '报销单不存在' })
      }

      // 获取收款信息（优先 employee_profiles）
      const profileBankInfo = (await db
        .prepare(
          `
      SELECT bank_account_name, bank_account_number
      FROM employee_profiles WHERE user_id = ?
    `,
        )
        .get(reimbursement.user_id)) as
        | {
            bank_account_name: string | null
            bank_account_number: string | null
          }
        | undefined

      const userBankInfo =
        profileBankInfo &&
        (profileBankInfo.bank_account_name ||
          profileBankInfo.bank_account_number)
          ? profileBankInfo
          : ((await db
              .prepare(
                `
          SELECT bank_account_name, bank_account_number FROM users WHERE id = ?
        `,
              )
              .get(reimbursement.user_id)) as
              | {
                  bank_account_name: string | null
                  bank_account_number: string | null
                }
              | undefined)

      // OCR 识别
      const expectedAmount = Number.parseFloat(reimbursement.total_amount)
      let ocrResult
      try {
        ocrResult = await recognizePaymentProof(req.file.path, {
          expectedAmount:
            Number.isFinite(expectedAmount) && expectedAmount > 0
              ? expectedAmount
              : undefined,
          requireTransactionDate: true,
        })
      } catch (ocrError: any) {
        try {
          fs.unlinkSync(req.file.path)
        } catch (_) {}
        return res.status(400).json({
          success: false,
          message: ocrError.message || '此不是付款回单，请重新上传',
        })
      }

      // 验证收款人和账号（任一匹配即通过）
      const ocrTextNoSpace = (ocrResult.rawText || '').replace(/\s+/g, '')

      console.log('🔍 verify-proof 验证信息:', {
        expectedName: userBankInfo?.bank_account_name,
        expectedAccount: userBankInfo?.bank_account_number,
        ocrPayee: ocrResult.payee,
        ocrAccount: ocrResult.payeeAccount,
        ocrAmount: ocrResult.amount,
      })

      // 检查账号是否匹配
      let accountMatched = false
      if (userBankInfo?.bank_account_number && ocrResult.payeeAccount) {
        const expectedAccount = userBankInfo.bank_account_number.replace(
          /\s+/g,
          '',
        )
        const ocrAccount = ocrResult.payeeAccount.replace(/\s+/g, '')
        if (expectedAccount === ocrAccount) {
          accountMatched = true
        } else if (
          expectedAccount.endsWith(ocrAccount) ||
          ocrAccount.endsWith(expectedAccount)
        ) {
          accountMatched = true
        } else if (
          expectedAccount.length === ocrAccount.length &&
          expectedAccount.slice(1) === ocrAccount.slice(1)
        ) {
          console.log('✅ 账号仅首位不同，OCR可能误识别首位数字')
          accountMatched = true
        }
      }

      // 检查收款人姓名是否匹配
      let nameFound = false
      if (userBankInfo?.bank_account_name) {
        const expectedName = userBankInfo.bank_account_name.trim()
        const ocrPayee = (ocrResult.payee || '').trim()

        // 1. 在 OCR 提取的收款人字段中精确/包含/模糊匹配
        if (ocrPayee && ocrPayee !== '付款' && ocrPayee !== '收款') {
          if (ocrPayee === expectedName || ocrPayee.includes(expectedName)) {
            nameFound = true
          }
          if (!nameFound && expectedName.length >= 2) {
            const chars = expectedName.split('')
            for (let i = 0; i < chars.length && !nameFound; i++) {
              const partial = chars.filter((_, idx) => idx !== i).join('')
              if (ocrPayee.includes(partial)) {
                console.log(
                  `✅ 姓名模糊匹配成功（payee字段）：跳过第${i + 1}个字"${chars[i]}"，在"${ocrPayee}"中匹配到"${partial}"`,
                )
                nameFound = true
              }
            }
          }
        }

        // 2. OCR 字段提取失败或无效时，在原始文本的"户名"附近行中查找（排除备注区域）
        if (!nameFound && ocrResult.rawText) {
          // 截取备注之前的文本，避免在备注中误匹配
          const rawBeforeMemo = ocrResult.rawText.split(/备注|附言|客户附言/)[0]
          const rawNoSpace = rawBeforeMemo.replace(/\s+/g, '')

          // 在去空格文本中查找姓名（精确）
          if (rawNoSpace.includes(expectedName)) {
            console.log(`✅ 姓名在回单主体中找到（精确）："${expectedName}"`)
            nameFound = true
          }
          // 模糊匹配
          if (!nameFound && expectedName.length >= 2) {
            const chars = expectedName.split('')
            for (let i = 0; i < chars.length && !nameFound; i++) {
              const partial = chars.filter((_, idx) => idx !== i).join('')
              if (rawNoSpace.includes(partial)) {
                console.log(
                  `✅ 姓名在回单主体中找到（模糊）：跳过"${chars[i]}"，匹配到"${partial}"`,
                )
                nameFound = true
              }
            }
          }
        }
      }

      console.log('🔍 verify-proof 匹配结果:', { accountMatched, nameFound })

      // 账号和姓名必须同时匹配
      if (!accountMatched || !nameFound) {
        const reasons: string[] = []

        // 检查账号匹配情况
        if (!accountMatched) {
          if (userBankInfo?.bank_account_number && ocrResult.payeeAccount) {
            reasons.push(
              `收款账号不一致：报销单为"${userBankInfo.bank_account_number}"，付款回单为"${ocrResult.payeeAccount}"`,
            )
          } else if (!ocrResult.payeeAccount) {
            reasons.push('无法识别付款回单中的收款账号')
          } else if (!userBankInfo?.bank_account_number) {
            reasons.push('报销单未设置收款账号')
          }
        }

        // 检查姓名匹配情况
        if (!nameFound) {
          if (!userBankInfo?.bank_account_name) {
            reasons.push('报销单未设置收款人姓名')
          } else {
            // 尝试从回单原始文本中提取实际收款人姓名用于提示
            const ocrPayee = (ocrResult.payee || '').trim()
            let actualPayee: string | null = null

            // 1. 如果 OCR 提取的 payee 有效，使用它
            if (ocrPayee && ocrPayee !== '付款' && ocrPayee !== '收款') {
              actualPayee = ocrPayee
            }

            // 2. 否则从原始文本中提取（备注区域之前，2-4个汉字的人名）
            if (!actualPayee && ocrResult.rawText) {
              const rawBeforeMemo =
                ocrResult.rawText.split(/备注|附言|客户附言/)[0]
              const lines = rawBeforeMemo
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
              const namePattern = /^[\u4e00-\u9fff]{2,4}$/
              const excludeWords = [
                '公司',
                '集团',
                '银行',
                '回单',
                '付款',
                '收款',
                '户名',
                '账号',
                '金额',
                '开户',
                '支行',
                '摘要',
                '用途',
                '业务',
                '产品',
                '种类',
              ]
              for (const line of lines) {
                if (
                  namePattern.test(line) &&
                  !excludeWords.some((w) => line.includes(w))
                ) {
                  if (line !== userBankInfo.bank_account_name) {
                    actualPayee = line
                    break
                  }
                }
              }
            }

            if (actualPayee) {
              reasons.push(
                `回单收款人（${actualPayee}）姓名与报销单收款人（${userBankInfo.bank_account_name}）不匹配`,
              )
            } else {
              reasons.push(
                `未在付款回单中找到收款人"${userBankInfo.bank_account_name}"`,
              )
            }
          }
        }

        console.warn('⚠️ verify-proof 验证失败:', reasons)
        try {
          fs.unlinkSync(req.file.path)
        } catch (_) {}
        return res.status(400).json({
          success: false,
          message: '付款回单验证失败：收款人姓名和收款账号必须与报销单一致',
          warnings: reasons,
        })
      }

      // 验证通过，保留临时文件，返回识别结果
      const tempFileName = path.basename(req.file.path)
      const fileBuffer = fs.readFileSync(req.file.path)
      const fileHash = crypto
        .createHash('sha256')
        .update(fileBuffer)
        .digest('hex')
      const verifierId = req.session.userId!

      // 将 OCR 结果存入缓存，绑定目标单据、验证人、文件哈希、交易流水号，防止重放
      ocrCache.set(tempFileName, {
        amount: ocrResult.amount,
        timestamp: Date.now(),
        targetType: 'reimbursement',
        targetId: id,
        verifierId,
        fileHash,
        proofNo: ocrResult.proofNo,
        transactionDate: ocrResult.transactionDate,
      })

      res.json({
        success: true,
        message: '付款回单验证通过',
        data: {
          tempFileName,
          ocrResult: {
            payer: ocrResult.payer,
            payee: ocrResult.payee,
            payeeAccount: ocrResult.payeeAccount,
            amount: ocrResult.amount,
            transactionDate: ocrResult.transactionDate,
          },
          originalFileName:
            req.body.originalFileName ||
            Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
        },
      })
    } catch (error) {
      console.error('❌ 付款回单验证失败:', error)
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path)
        } catch (_) {}
      }
      res.status(500).json({ success: false, message: '验证失败' })
    }
  },
)

/**
 * 提交已验证的付款回单（支持多张回单）
/**
 * 管理员确认付款（待付款 → 待上传回单）
 * POST /api/reimbursement/:id/confirm-payment
 */
router.post('/:id/confirm-payment', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const currentUserId = req.session.userId!
    const currentUserName = req.session.user?.name

    const { db } = await import('../db/index.js')

    const reimbursement = (await db
      .prepare('SELECT * FROM reimbursements WHERE id = ?')
      .get(id)) as any
    if (!reimbursement) {
      return res.status(404).json({ success: false, message: '报销单不存在' })
    }

    if (reimbursement.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: '只有待付款状态的报销单才能确认付款',
      })
    }

    const now = new Date().toISOString()

    const approvalInstance = (await db
      .prepare(
        `
      SELECT id FROM approval_instances
      WHERE target_id = ? AND target_type = 'reimbursement'
      ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get(id)) as { id: string } | undefined

    await db.transaction(async (client) => {
      await txRun(
        client,
        `
        UPDATE reimbursements
        SET status = 'paid', paid_time = ?, paid_by = ?,
            payment_business_date = NULL, updated_at = ?
        WHERE id = ?
      `,
        now,
        currentUserName || currentUserId,
        now,
        id,
      )

      if (approvalInstance) {
        const { nanoid } = await import('nanoid')
        const recordId = nanoid()
        await txRun(
          client,
          `
          INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          recordId,
          approvalInstance.id,
          98,
          currentUserId,
          'payment_confirmed',
          '管理员已确认付款',
          now,
        )
      }
    })

    res.json({ success: true, message: '已确认付款，请上传银行回单' })
  } catch (error) {
    console.error('❌ 确认付款失败:', error)
    res.status(500).json({ success: false, message: '操作失败' })
  }
})

/**
 * POST /api/reimbursement/:id/complete-with-proof
 */
router.post('/:id/complete-with-proof', requireAdmin, async (req, res) => {
  console.log('🔵 收到付款回单提交请求')
  const movedPaymentProofPaths: string[] = []
  let paymentProofCommitted = false

  try {
    const { id } = req.params
    const currentUserId = req.session.userId!

    // 接收已验证的文件列表：[{ tempFileName, originalFileName, amount }]
    const { verifiedFiles } = req.body
    if (
      !verifiedFiles ||
      !Array.isArray(verifiedFiles) ||
      verifiedFiles.length === 0
    ) {
      return res.status(400).json({ success: false, message: '请上传付款回单' })
    }

    const { db } = await import('../db/index.js')

    const reimbursement = (await db
      .prepare('SELECT * FROM reimbursements WHERE id = ?')
      .get(id)) as any
    if (!reimbursement) {
      return res.status(404).json({ success: false, message: '报销单不存在' })
    }

    if (reimbursement.status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: '只有已确认付款的报销单才能上传回单',
      })
    }

    // 使用服务端缓存的金额，防止客户端篡改，严格校验目标和验证人
    let totalOcrAmount = 0
    for (const file of verifiedFiles) {
      const cached = ocrCache.get(file.tempFileName)
      if (!cached) {
        return res.status(400).json({
          success: false,
          message: `文件 ${file.originalFileName} 验证已过期，请重新验证`,
        })
      }
      // 严格校验：必须是当前报销单、当前管理员验证的回单
      if (
        cached.targetType !== 'reimbursement' ||
        cached.targetId !== id ||
        cached.verifierId !== currentUserId
      ) {
        return res.status(403).json({
          success: false,
          message: `文件 ${file.originalFileName} 验证记录与当前单据不匹配，请重新验证`,
        })
      }
      totalOcrAmount += cached.amount
    }

    const expectedAmount = parseFloat(reimbursement.total_amount)
    if (Math.abs(expectedAmount - totalOcrAmount) > 0.01) {
      return res.status(400).json({
        success: false,
        message: `回单金额总和 ¥${totalOcrAmount.toFixed(2)} 与报销金额 ¥${expectedAmount.toFixed(2)} 不一致`,
      })
    }

    let paymentBusinessDate: string
    try {
      paymentBusinessDate = resolveConsistentPaymentProofTransactionDate(
        verifiedFiles.map(
          (file: any) => ocrCache.get(file.tempFileName)?.transactionDate,
        ),
      )
    } catch (dateError) {
      return res.status(400).json({
        success: false,
        message:
          dateError instanceof Error
            ? dateError.message
            : '无法确定回单实际交易日期',
      })
    }

    // 收集并规范化摘要和回单号；数据库权威去重在落盘后的事务锁内执行，失败时清理本批新文件。
    const proofIdentities: PaymentProofIdentity[] = verifiedFiles
      .map((f: any) => {
        const cached = ocrCache.get(f.tempFileName)
        return {
          fileHash: cached?.fileHash || '',
          proofNo: cached?.proofNo || '',
        }
      })
      .filter((item) => item.fileHash) // 只过滤有 fileHash 的项
    if (
      proofIdentities.length !== verifiedFiles.length ||
      hasDuplicatePaymentProofIdentities(proofIdentities)
    ) {
      return res.status(400).json({
        success: false,
        message: '本次提交包含重复或无效的付款回单标识',
      })
    }
    const normalizedProofIdentities =
      normalizePaymentProofIdentities(proofIdentities)
    const proofFileHashes = normalizedProofIdentities.map(
      (identity) => identity.fileHash,
    )
    const proofNos = normalizedProofIdentities.map(
      (identity) => identity.proofNo,
    )

    const paymentProofPaths: string[] = []
    const invoicesDir = ensureDatedUploadDirectory('invoices')
    for (const file of verifiedFiles) {
      const tempPath = path.join(tempDir, path.basename(file.tempFileName))
      if (!fs.existsSync(tempPath)) {
        return res.status(400).json({
          success: false,
          message: `文件 ${file.originalFileName} 已过期，请重新上传`,
        })
      }
      const safeFileName = path
        .basename(file.originalFileName || 'proof')
        .replace(/[^\w\u4e00-\u9fff.-]/g, '_')
      const finalFileName = `payment-proof-${id}-${Date.now()}-${safeFileName}`
      const finalPath = path.join(invoicesDir, finalFileName)
      fs.renameSync(tempPath, finalPath)
      movedPaymentProofPaths.push(finalPath)
      paymentProofPaths.push(toStoredUploadPath(finalPath))
    }

    const paymentProofPath = paymentProofPaths.join(',')
    const now = new Date().toISOString()

    // 查询审批实例
    const approvalInstance = (await db
      .prepare(
        `
      SELECT id FROM approval_instances
      WHERE target_id = ? AND target_type = 'reimbursement'
      ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get(id)) as { id: string } | undefined

    // 使用事务确保原子性
    await db.transaction(async (client) => {
      await lockPaymentProofIdentities(client, normalizedProofIdentities)
      if (
        await findExistingPaymentProofIdentity(
          client,
          normalizedProofIdentities,
        )
      ) {
        throw new RouteError(
          409,
          '付款回单文件或电子回单号码已被使用，请勿重复提交',
          { code: 'PAYMENT_PROOF_ALREADY_USED' },
        )
      }

      const lockedReimbursement = await txGet<{
        id: string
        status: string
        total_amount: string
        payment_batch_id: string | null
      }>(
        client,
        `SELECT id, status, total_amount::text AS total_amount,
                payment_batch_id
           FROM reimbursements
          WHERE id = ? AND COALESCE(is_deleted, FALSE) = FALSE
          FOR UPDATE`,
        id,
      )
      if (!lockedReimbursement) {
        throw new RouteError(404, '报销单不存在')
      }
      if (
        lockedReimbursement.status !== 'paid' ||
        lockedReimbursement.payment_batch_id
      ) {
        throw new RouteError(409, '报销单状态或付款批次已变化，请刷新后重试', {
          code: 'REIMBURSEMENT_PAYMENT_STATE_CHANGED',
        })
      }
      if (
        Math.abs(
          Number.parseFloat(lockedReimbursement.total_amount) - totalOcrAmount,
        ) > 0.01
      ) {
        throw new RouteError(409, '报销金额已变化，请重新验证付款回单', {
          code: 'REIMBURSEMENT_PAYMENT_AMOUNT_CHANGED',
        })
      }

      // 自动创建单笔付款批次（统一批次机制）
      const batchId = nanoid()
      const batchNo = generateBatchNo()

      await txRun(
        client,
        `
        INSERT INTO payment_batches (
          id, batch_no, total_amount, payer_id, payment_proof_path, pay_time,
          payment_business_date, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)
      `,
        batchId,
        batchNo,
        expectedAmount,
        currentUserId,
        paymentProofPath,
        now,
        paymentBusinessDate,
        now,
        now,
      )

      // 写入每张回单哈希和电子回单号码，防止后续重放
      for (let i = 0; i < proofFileHashes.length; i++) {
        const fileHash = proofFileHashes[i]
        const proofNo = proofNos[i] || null
        await txRun(
          client,
          `
          INSERT INTO payment_proof_hashes (id, file_hash, proof_no, batch_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
          nanoid(),
          fileHash,
          proofNo,
          batchId,
          now,
        )
      }

      // 创建批次快照记录（单笔付款也需要快照，确保确认收款时能查询到）
      const itemId = nanoid()
      await txRun(
        client,
        `
        INSERT INTO payment_batch_items (id, batch_id, reimbursement_id, amount, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
        itemId,
        batchId,
        id,
        expectedAmount,
        now,
      )

      // 仅允许仍处于已付款且未挂批次的报销单接管本次付款事实。
      const reimbursementUpdate = await txRun(
        client,
        `
        UPDATE reimbursements
        SET status = 'payment_uploaded',
            payment_proof_path = ?,
            payment_batch_id = ?,
            pay_time = ?,
            payment_business_date = ?,
            payment_upload_time = ?,
            updated_at = ?
        WHERE id = ?
          AND status = 'paid'
          AND payment_batch_id IS NULL
          AND COALESCE(is_deleted, FALSE) = FALSE
      `,
        paymentProofPath,
        batchId,
        now,
        paymentBusinessDate,
        now,
        now,
        id,
      )
      if (reimbursementUpdate.changes !== 1) {
        throw new RouteError(409, '报销单状态或付款批次已变化，请刷新后重试', {
          code: 'REIMBURSEMENT_PAYMENT_STATE_CHANGED',
        })
      }

      // 创建审批记录
      if (approvalInstance) {
        const { nanoid } = await import('nanoid')
        const recordId = nanoid()
        await txRun(
          client,
          `
          INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          recordId,
          approvalInstance.id,
          99,
          currentUserId,
          'payment_uploaded',
          '管理员已上传付款回单',
          now,
        )
      }
    })
    paymentProofCommitted = true

    // 一次性消费：事务完成后从缓存中删除已使用的回单验证记录
    for (const file of verifiedFiles) {
      ocrCache.delete(file.tempFileName)
    }

    console.log(
      `✅ 付款回单提交成功: ${id}, 共 ${paymentProofPaths.length} 张回单`,
    )

    res.json({
      success: true,
      message: '付款回单上传成功，等待用户确认收款',
      data: { paymentProofPath },
    })
  } catch (error) {
    const commitOutcomeUncertain = Boolean(
      error &&
      typeof error === 'object' &&
      'commitOutcomeUncertain' in error &&
      (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
    )
    if (!paymentProofCommitted && !commitOutcomeUncertain) {
      for (const movedPath of movedPaymentProofPaths) {
        fs.rmSync(movedPath, { force: true })
      }
    }
    if (commitOutcomeUncertain) {
      return res.status(500).json({
        success: false,
        code: 'PAYMENT_PROOF_COMMIT_OUTCOME_UNCERTAIN',
        message: '付款结果暂时无法确认，请刷新状态后再操作，勿重复上传',
      })
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      String((error as { code?: unknown }).code) === '23505'
    ) {
      return res.status(409).json({
        success: false,
        code: 'PAYMENT_PROOF_ALREADY_USED',
        message: '付款回单文件或电子回单号码已被使用，请勿重复提交',
      })
    }
    if (isRouteError(error)) {
      return res.status(error.statusCode).json(error.payload)
    }
    console.error('❌ 提交付款回单失败:', error)
    res.status(500).json({ success: false, message: '提交失败' })
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
    const reimbursement = (await db
      .prepare('SELECT * FROM reimbursements WHERE id = ?')
      .get(id)) as any

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

    await db
      .prepare(
        `
      UPDATE reimbursements
      SET status = 'completed', completed_time = ?, receipt_confirmed_by = ?, updated_at = ?
      WHERE id = ?
    `,
      )
      .run(now, currentUserName || '用户', now, id)

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
    const userId = req.session.user?.id || req.session.userId
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const { db } = await import('../db/index.js')

    // 获取用户角色（优先从 session.user 取，否则从数据库查）
    let userRole = req.session.user?.role
    if (!userRole) {
      const userRecord = (await db
        .prepare('SELECT role FROM users WHERE id = ?')
        .get(userId)) as { role: string } | undefined
      userRole = userRecord?.role
    }

    // 管理员可以查看所有报销单，总经理只能查看商务报销，普通用户只能查看自己的
    const isAdmin =
      userRole === 'admin' || isSystemAdminEquivalentRole(userRole)
    const isGM = userRole === 'general_manager'

    let reimbursement
    if (isAdmin) {
      // 管理员查看所有报销单
      reimbursement = await db
        .prepare(
          `
        SELECT
          id, type, category, title,
          total_amount as amount,
          total_amount as totalAmount,
          COALESCE(deduction_amount, 0) as deductionAmount,
          status,
          description, business_type as businessType, client,
          user_id as userId, applicant_name as applicant,
          submit_time as submitTime, approve_time as approveTime,
          approver, pay_time as payTime, paid_time as paidTime, paid_by as paidBy,
          payment_proof_path as paymentProofPath,
          payment_upload_time as paymentUploadTime, completed_time as completedTime,
          receipt_confirmed_by as receiptConfirmedBy,
          reject_reason as rejectReason,
          reimbursement_scope as reimbursementScope,
          reimbursement_month as reimbursementMonth,
          service_target as serviceTarget,
          created_at as createTime, updated_at as updateTime,
          payment_batch_id as paymentBatchId
        FROM reimbursements
        WHERE id = ? AND COALESCE(is_deleted, FALSE) = FALSE
      `,
        )
        .get(id)
    } else if (isGM) {
      // 总经理只能查看商务报销
      reimbursement = await db
        .prepare(
          `
        SELECT
          id, type, category, title,
          total_amount as amount,
          total_amount as totalAmount,
          COALESCE(deduction_amount, 0) as deductionAmount,
          status,
          description, business_type as businessType, client,
          user_id as userId, applicant_name as applicant,
          submit_time as submitTime, approve_time as approveTime,
          approver, pay_time as payTime, paid_time as paidTime, paid_by as paidBy,
          payment_proof_path as paymentProofPath,
          payment_upload_time as paymentUploadTime, completed_time as completedTime,
          receipt_confirmed_by as receiptConfirmedBy,
          reject_reason as rejectReason,
          reimbursement_scope as reimbursementScope,
          reimbursement_month as reimbursementMonth,
          service_target as serviceTarget,
          created_at as createTime, updated_at as updateTime,
          payment_batch_id as paymentBatchId
        FROM reimbursements
        WHERE id = ? AND (type = 'business' OR user_id = ?) AND COALESCE(is_deleted, FALSE) = FALSE
      `,
        )
        .get(id, userId)
    } else {
      // 普通用户只能查看自己的报销单
      reimbursement = await db
        .prepare(
          `
        SELECT
          id, type, category, title,
          total_amount as amount,
          total_amount as totalAmount,
          COALESCE(deduction_amount, 0) as deductionAmount,
          status,
          description, business_type as businessType, client,
          user_id as userId, applicant_name as applicant,
          submit_time as submitTime, approve_time as approveTime,
          approver, pay_time as payTime, paid_time as paidTime, paid_by as paidBy,
          payment_proof_path as paymentProofPath,
          payment_upload_time as paymentUploadTime, completed_time as completedTime,
          receipt_confirmed_by as receiptConfirmedBy,
          reject_reason as rejectReason,
          reimbursement_scope as reimbursementScope,
          reimbursement_month as reimbursementMonth,
          service_target as serviceTarget,
          created_at as createTime, updated_at as updateTime,
          payment_batch_id as paymentBatchId
        FROM reimbursements
        WHERE id = ? AND user_id = ? AND COALESCE(is_deleted, FALSE) = FALSE
      `,
        )
        .get(id, userId)
    }

    if (!reimbursement) {
      return res.status(404).json({
        success: false,
        message: '报销单不存在或无权查看',
      })
    }

    // 查询发票明细
    const invoices = await db
      .prepare(
        `
      SELECT
        id, amount, invoice_date as invoiceDate, invoice_number as invoiceNumber,
        file_path as filePath, file_hash as fileHash, seller, buyer, tax_amount as taxAmount,
        invoice_code as invoiceCode, category, deducted_amount as deductedAmount,
        COALESCE(is_deduction, 0) as isDeduction
      FROM reimbursement_invoices
      WHERE reimbursement_id = ?
      ORDER BY created_at ASC
    `,
      )
      .all(id)

    console.log('📋 查询报销单详情 - ID:', id, '发票数量:', invoices.length)
    if (invoices.length > 0) {
      console.log('📋 第一个发票的文件路径:', invoices[0].filePath)
      console.log('📋 文件路径长度:', invoices[0].filePath?.length)
    }

    // 查询审批历史记录（包括所有历史审批实例的记录，不仅限于当前实例）
    const approvalHistory = await db
      .prepare(
        `
      SELECT
        ar.id, ar.action, ar.comment, ar.action_time as actionTime,
        u.name as approverName, u.username as approverUsername,
        ai.status as instanceStatus
      FROM approval_records ar
      LEFT JOIN approval_instances ai ON ar.instance_id = ai.id
      LEFT JOIN users u ON ar.approver_id = u.id
      WHERE ai.target_id = ? AND ai.target_type = 'reimbursement'
      ORDER BY ar.action_time ASC
    `,
      )
      .all(id)

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
      approvalHistoryCount: formattedApprovalHistory.length,
    })

    // 格式化时间字段
    const formattedReimbursement = {
      ...reimbursement,
      submitTime: formatDateTime((reimbursement as any).submitTime),
      approveTime: formatDateTime((reimbursement as any).approveTime),
      paidTime: formatDateTime((reimbursement as any).paidTime),
      payTime: formatDateTime((reimbursement as any).payTime),
      paymentUploadTime: formatDateTime(
        (reimbursement as any).paymentUploadTime,
      ),
      completedTime: formatDateTime((reimbursement as any).completedTime),
      createTime: formatDateTime((reimbursement as any).createTime),
      updateTime: formatDateTime((reimbursement as any).updateTime),
    }

    // 查询当前有效的审批实例ID（用于前端调用新审批接口）
    const currentApprovalInstance = (await db
      .prepare(
        `
      SELECT id FROM approval_instances
      WHERE target_id = ? AND target_type = 'reimbursement' AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get(id)) as { id: string } | undefined

    // 查询管理员和总经理的名字（用于审批流程显示）
    const adminUser = (await db
      .prepare(
        `
      SELECT name FROM users WHERE role IN ('admin', 'super_admin') AND status = 'active' ORDER BY role ASC LIMIT 1
    `,
      )
      .get()) as { name: string } | undefined
    const gmUser = (await db
      .prepare(
        `
      SELECT name FROM users WHERE role = 'general_manager' AND status = 'active' LIMIT 1
    `,
      )
      .get()) as { name: string } | undefined

    res.json({
      success: true,
      data: {
        ...formattedReimbursement,
        approvalInstanceId: currentApprovalInstance?.id || null,
        invoices,
        approvalHistory: formattedApprovalHistory,
        adminApproverName: adminUser?.name || null,
        gmApproverName: gmUser?.name || null,
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
    const {
      category,
      title,
      description,
      invoices,
      businessType,
      client: clientName,
      serviceTarget,
      status = 'pending',
    } = req.body
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
    const existingReimbursement = (await db
      .prepare('SELECT * FROM reimbursements WHERE id = ? AND user_id = ?')
      .get(id, userId)) as any

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

    // 服务端统一重算核减金额，不信任客户端传入的 deductedAmount
    let processedInvoices = await verifyDeductionInvoicePayloads(
      invoices,
      userId,
      id,
    )
    // 计算报销月份（跨月编辑时需要同步更新）
    const reimbursementMonth = calculateReimbursementMonth(
      new Date(),
      existingReimbursement.type,
    )

    if (existingReimbursement.type === 'basic') {
      // 获取当月已使用的交通额度类发票额度（排除当前报销单自身）
      // 口径与前端 transport-fuel-quota 一致：排除草稿和已驳回
      const monthlyUsedResult = (await db
        .prepare(
          `
        SELECT COALESCE(SUM(i.amount), 0) as used_amount
        FROM reimbursement_invoices i
        INNER JOIN reimbursements r ON i.reimbursement_id = r.id
        WHERE r.user_id = ?
        AND r.type = 'basic'
        AND r.reimbursement_month = ?
        AND r.status NOT IN ('draft', 'rejected')
        AND r.id != ?
        AND (
          ${buildTransportFuelCategoryCondition('i')}
        )
      `,
        )
        .get(userId, reimbursementMonth, id)) as { used_amount: number }

      const monthlyUsedQuota = monthlyUsedResult?.used_amount || 0
      const remainingQuota = Math.max(0, 1500 - monthlyUsedQuota)

      // 计算本次提交的交通额度类发票总额
      let transportFuelTotal = 0

      processedInvoices = processedInvoices.map((inv: any) => {
        const isTransportOrFuel = isTransportFuelCategory(inv.category)

        if (isTransportOrFuel) {
          transportFuelTotal += inv.amount || 0
        }

        return { ...inv, deductedAmount: 0 }
      })

      // 如果交通额度类发票总额超过剩余额度，需要核减
      if (transportFuelTotal > remainingQuota) {
        const deductionAmountCents = Math.round(
          (transportFuelTotal - remainingQuota) * 100,
        )
        const transportFuelTotalCents = Math.round(transportFuelTotal * 100)

        let accumulatedDeductionCents = 0
        const transportInvoices: any[] = []

        processedInvoices.forEach((inv: any) => {
          const isTransportOrFuel = isTransportFuelCategory(inv.category)

          if (isTransportOrFuel) {
            transportInvoices.push(inv)
          }
        })

        processedInvoices = processedInvoices.map((inv: any) => {
          const isTransportOrFuel = isTransportFuelCategory(inv.category)

          if (isTransportOrFuel && transportFuelTotalCents > 0) {
            const invAmountCents = Math.round((inv.amount || 0) * 100)
            const ratio = invAmountCents / transportFuelTotalCents
            let invoiceDeductionCents = Math.round(deductionAmountCents * ratio)

            const isLastTransportInvoice =
              transportInvoices[transportInvoices.length - 1] === inv
            if (isLastTransportInvoice) {
              invoiceDeductionCents =
                deductionAmountCents - accumulatedDeductionCents
            }

            accumulatedDeductionCents += invoiceDeductionCents
            return { ...inv, deductedAmount: invoiceDeductionCents / 100 }
          }

          return inv
        })
      }
    }

    // 计算总金额（使用实际报销金额，即扣除核减后的金额）
    // 核减发票不计入报销金额
    // 使用分（cents）来避免浮点数精度问题
    const totalAmountCents = processedInvoices.reduce(
      (sum: number, inv: any) => {
        // 核减发票不计入报销金额
        if (inv.isDeduction) {
          return sum
        }
        const amountCents = Math.round((inv.amount || 0) * 100)
        const deductedCents = Math.round((inv.deductedAmount || 0) * 100)
        const actualCents = amountCents - deductedCents
        return sum + actualCents
      },
      0,
    )
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

    // 校验文件路径安全性
    for (const invoice of processedInvoices) {
      if (invoice.filePath && !validateFilePath(invoice.filePath)) {
        return res.status(403).json({
          success: false,
          message: '非法文件路径',
        })
      }
    }

    // 校验本次请求内发票号码不重复
    const invoiceNumbers = processedInvoices
      .map((inv: any) => inv.invoiceNumber)
      .filter((n: any) => n)
    const currentUploadDuplicate = findCurrentUploadDuplicate(processedInvoices)
    if (currentUploadDuplicate) {
      return res.status(400).json({
        success: false,
        message: currentUploadInvoiceDuplicateMessage(
          currentUploadDuplicate.invoiceNumber,
          currentUploadDuplicate.existingUsageKind,
          currentUploadDuplicate.incomingUsageKind,
        ),
      })
    }

    // 使用 PostgreSQL 事务校验唯一性并更新主表和发票明细
    await db.transaction(async (client) => {
      await assertInvoicesNotUsedInContractFinancial(
        client,
        reimbursementInvoiceNumbersForCrossModule(processedInvoices),
      )
      await assertInvoicesNotUsedInReimbursement(client, invoiceNumbers, id)
      await lockReimbursementInvoiceFileHashes(
        client,
        processedInvoices.map((invoice: any) => invoice.fileHash),
      )

      // 事务内校验文件哈希唯一性（排除当前报销单自身）
      for (const invoice of processedInvoices) {
        if (invoice.fileHash) {
          const existingByHash = await txGet<{
            file_hash: string
            applicant_name: string
            usage_kind: 'invoice' | 'deduction'
          }>(
            client,
            `
            SELECT file_hash, applicant_name, usage_kind FROM (
              SELECT ri.file_hash, r.applicant_name,
                CASE WHEN COALESCE(ri.is_deduction, 0) = 1
                  THEN 'deduction' ELSE 'invoice' END AS usage_kind
              FROM reimbursement_invoices ri
              JOIN reimbursements r ON ri.reimbursement_id = r.id
              WHERE ri.file_hash = ? AND r.id <> ? AND r.status <> 'rejected'
                AND COALESCE(r.is_deleted, FALSE) = FALSE
              UNION ALL
              SELECT rdi.file_hash, r.applicant_name,
                'deduction'::text AS usage_kind
              FROM reimbursement_deduction_invoices rdi
              JOIN reimbursements r ON rdi.reimbursement_id = r.id
              WHERE rdi.file_hash = ? AND r.id <> ? AND r.status <> 'rejected'
                AND COALESCE(r.is_deleted, FALSE) = FALSE
            ) duplicate_file LIMIT 1
          `,
            invoice.fileHash,
            id,
            invoice.fileHash,
            id,
          )
          if (existingByHash) {
            throw new RouteError(
              400,
              reimbursementInvoiceDuplicateMessage(
                existingByHash.applicant_name,
                existingByHash.usage_kind,
              ),
            )
          }
        }
      }

      // 更新报销单主记录（包括 reimbursement_month，跨月编辑时同步更新）
      await txRun(
        client,
        `
        UPDATE reimbursements
        SET category = ?, title = ?, total_amount = ?, status = ?,
            description = ?, business_type = ?, client = ?, service_target = ?, reimbursement_month = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `,
        category || null,
        title,
        totalAmount,
        status,
        description || null,
        businessType || null,
        clientName || null,
        serviceTarget || clientName || null,
        reimbursementMonth,
        timestamp,
        id,
        userId,
      )

      // 删除旧的发票明细
      await txRun(
        client,
        'DELETE FROM reimbursement_invoices WHERE reimbursement_id = ?',
        id,
      )

      // 插入新的发票明细
      for (const invoice of processedInvoices) {
        const invoiceId = `INV${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`
        await txRun(
          client,
          `
          INSERT INTO reimbursement_invoices (
            id, reimbursement_id, amount, invoice_date, invoice_number,
            file_path, seller, buyer, tax_amount, invoice_code, category, deducted_amount, file_hash, is_deduction, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
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
          invoice.isDeduction ? 1 : 0,
          timestamp,
        )
      }

      // 如果是从草稿状态或被驳回状态提交审批（status 变为 pending），创建审批实例
      const oldReimbursement = existingReimbursement as any
      if (
        (oldReimbursement.status === 'draft' ||
          oldReimbursement.status === 'rejected') &&
        status === 'pending'
      ) {
        // 更新提交时间，清除驳回原因
        await txRun(
          client,
          'UPDATE reimbursements SET submit_time = ?, reject_reason = NULL WHERE id = ?',
          timestamp,
          id,
        )

        // 检查是否已有 pending 状态的审批实例
        const existingApproval = await txGet<{ id: string }>(
          client,
          `
          SELECT id FROM approval_instances
          WHERE target_id = ? AND target_type = 'reimbursement' AND status = 'pending'
        `,
          id,
        )

        if (!existingApproval) {
          const approvalInstanceId = nanoid()

          // 确定审批类型
          const approvalType =
            existingReimbursement.type === 'basic'
              ? 'reimbursement_basic'
              : existingReimbursement.type === 'large'
                ? 'reimbursement_large'
                : 'reimbursement_business'

          await txRun(
            client,
            `
            INSERT INTO approval_instances (
              id, flow_id, type, target_id, target_type, applicant_id,
              current_step, status, submit_time, created_at, updated_at
            ) VALUES (?, NULL, ?, ?, 'reimbursement', ?, 1, 'pending', ?, ?, ?)
          `,
            approvalInstanceId,
            approvalType,
            id,
            userId,
            timestamp,
            timestamp,
            timestamp,
          )

          console.log('✅ 草稿提交审批，创建审批实例:', {
            approvalInstanceId,
            reimbursementId: id,
            type: approvalType,
          })

          // 判断是否为再次提交：只有从驳回状态重新提交才算再次提交
          const isResubmit = oldReimbursement.status === 'rejected'

          if (isResubmit) {
            const recordId = nanoid()
            await txRun(
              client,
              `
              INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
              recordId,
              approvalInstanceId,
              1,
              userId,
              'resubmit',
              '申请人修改后再次提交审批',
              timestamp,
            )
            console.log('✅ 添加再次提交记录:', {
              recordId,
              approvalInstanceId,
            })
          }
        }
      }
    })

    for (const invoice of processedInvoices) {
      if (invoice.isDeduction && invoice.filePath) {
        deductionOcrCache.delete(path.basename(invoice.filePath))
      }
    }
    // 报销单更新成功后，清理该用户的临时上传记录
    await db.run(`DELETE FROM user_uploaded_files WHERE user_id = ?`, userId)

    res.json({
      success: true,
      data: {
        id,
      },
      message: status === 'draft' ? '草稿保存成功' : '报销单更新成功',
    })
  } catch (error) {
    if (isRouteError(error)) {
      return res.status(error.statusCode).json(error.payload)
    }
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
    const reimbursement = (await db
      .prepare('SELECT * FROM reimbursements WHERE id = ? AND user_id = ?')
      .get(id, userId)) as any

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

    // 使用事务确保报销单和审批实例状态一致
    await db.transaction(async (client) => {
      await txRun(
        client,
        'UPDATE reimbursements SET status = ?, updated_at = ? WHERE id = ?',
        'draft',
        now,
        id,
      )
      await txRun(
        client,
        `
        UPDATE approval_instances SET status = 'withdrawn', updated_at = ?
        WHERE target_id = ? AND target_type = 'reimbursement' AND status = 'pending'
      `,
        now,
        id,
      )
    })

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
 * 删除报销单
 * DELETE /api/reimbursement/:id
 * 只有本人名下的草稿或已驳回报销可以删除；其他状态属于审批或付款事实，
 * 必须由对应的撤回、驳回或财务冲正流程处理。
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

    await db.transaction(async (client) => {
      // 锁定单据后再判断状态，避免校验通过后恰好被提交或审批的竞态。
      const reimbursement = (await txGet(
        client,
        `
        SELECT id, status
        FROM reimbursements
        WHERE id = ? AND user_id = ? AND COALESCE(is_deleted, FALSE) = FALSE
        FOR UPDATE
      `,
        id,
        userId,
      )) as { id: string; status: string } | undefined

      if (!reimbursement) {
        throw new RouteError(404, '报销单不存在或无权删除')
      }
      if (!['draft', 'rejected'].includes(reimbursement.status)) {
        throw new RouteError(
          409,
          '当前状态不允许删除，仅草稿或已驳回的报销单可以删除',
          {
            code: 'REIMBURSEMENT_STATUS_NOT_DELETABLE',
            status: reimbursement.status,
          },
        )
      }

      // 删除关联的审批记录
      await txRun(
        client,
        `
        DELETE FROM approval_records
        WHERE instance_id IN (
          SELECT id FROM approval_instances
          WHERE target_id = ? AND target_type = 'reimbursement'
        )
      `,
        id,
      )
      // 删除关联的审批实例
      await txRun(
        client,
        `
        DELETE FROM approval_instances
        WHERE target_id = ? AND target_type = 'reimbursement'
      `,
        id,
      )
      // reimbursement_invoices 使用 ON DELETE CASCADE 自动级联删除。
      await txRun(
        client,
        `
        DELETE FROM reimbursements
        WHERE id = ? AND user_id = ? AND status IN ('draft', 'rejected')
      `,
        id,
        userId,
      )
    })

    res.json({
      success: true,
      message: '删除成功',
    })
  } catch (error) {
    if (isRouteError(error)) {
      return res.status(error.statusCode).json(error.payload)
    }
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
    const reimbursement = (await db
      .prepare('SELECT * FROM reimbursements WHERE id = ? AND user_id = ?')
      .get(id, userId)) as any

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

    await db.transaction(async (client) => {
      // 事务内校验：检查该报销单的发票号是否已被其他有效报销单占用
      const invoices = await txAll<{ invoice_number: string | null }>(
        client,
        `
        SELECT invoice_number FROM reimbursement_invoices
        WHERE reimbursement_id = ?
          AND SPLIT_PART(file_path, '/', -1) NOT LIKE 'receipt-%'
          AND UPPER(COALESCE(invoice_number, '')) NOT LIKE 'RECEIPT-%'
        UNION ALL
        SELECT invoice_number FROM reimbursement_deduction_invoices WHERE reimbursement_id = ?
      `,
        id,
        id,
      )
      await assertInvoicesNotUsedInContractFinancial(
        client,
        invoices.map((invoice) => invoice.invoice_number),
      )
      await assertInvoicesNotUsedInReimbursement(
        client,
        invoices.map((invoice) => invoice.invoice_number),
        id,
      )

      const now = new Date().toISOString()
      await txRun(
        client,
        'UPDATE reimbursements SET is_deleted = FALSE, deleted_at = NULL, updated_at = ? WHERE id = ?',
        now,
        id,
      )
    })

    res.json({
      success: true,
      message: '恢复成功',
    })
  } catch (error) {
    if (isRouteError(error)) {
      return res.status(error.statusCode).json(error.payload)
    }
    console.error('恢复报销单失败:', error)
    res.status(500).json({
      success: false,
      message: '恢复报销单失败',
    })
  }
})

// ==================== 批量付款相关接口 ====================

/**
 * 生成付款批次号
 */
function generateBatchNo(): string {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const random = nanoid(6).toUpperCase()
  return `PAY${dateStr}${random}`
}

/**
 * 创建批量付款批次
 * POST /api/reimbursement/payment-batch/create
 */
router.post('/payment-batch/create', requireAdmin, async (req, res) => {
  try {
    const currentUserId = req.session.userId!

    const { reimbursementIds: submittedReimbursementIds } = req.body
    if (
      !submittedReimbursementIds ||
      !Array.isArray(submittedReimbursementIds) ||
      submittedReimbursementIds.length === 0
    ) {
      return res.status(400).json({ success: false, message: '请选择报销单' })
    }
    const reimbursementIds = submittedReimbursementIds
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .sort()
    if (
      reimbursementIds.length !== submittedReimbursementIds.length ||
      new Set(reimbursementIds).size !== reimbursementIds.length
    ) {
      return res
        .status(400)
        .json({ success: false, message: '报销单编号重复或无效' })
    }

    // 查询所有选中的报销单（包含 payment_batch_id 用于校验重复挂载）
    const placeholders = reimbursementIds.map(() => '?').join(',')
    const reimbursements = (await db
      .prepare(
        `
      SELECT id, user_id, total_amount, status, applicant_name, type, title, payment_batch_id
      FROM reimbursements
      WHERE id IN (${placeholders}) AND COALESCE(is_deleted, FALSE) = FALSE
    `,
      )
      .all(...reimbursementIds)) as any[]

    if (reimbursements.length !== reimbursementIds.length) {
      return res
        .status(400)
        .json({ success: false, message: '部分报销单不存在' })
    }

    // 校验：所有报销单必须是 approved 状态
    const notApproved = reimbursements.filter((r) => r.status !== 'approved')
    if (notApproved.length > 0) {
      return res.status(400).json({
        success: false,
        message: `以下报销单未审批通过：${notApproved.map((r) => r.id).join(', ')}`,
      })
    }

    // 校验：报销单不能已挂载到其他正在付款的批次（已上传回单待确认）
    const withBatchId = reimbursements.filter((r) => r.payment_batch_id)
    if (withBatchId.length > 0) {
      const batchIds = [...new Set(withBatchId.map((r) => r.payment_batch_id))]
      const batchPlaceholders = batchIds.map(() => '?').join(',')
      // 只有 uploaded 或 pending 状态才视为活跃批次（防止并发创建批次）
      const activeBatches = (await db
        .prepare(
          `
        SELECT id FROM payment_batches WHERE id IN (${batchPlaceholders}) AND status IN ('uploaded', 'pending')
      `,
        )
        .all(...batchIds)) as any[]
      const activeBatchIds = new Set(activeBatches.map((b) => b.id))

      const alreadyInBatch = withBatchId.filter((r) =>
        activeBatchIds.has(r.payment_batch_id),
      )
      if (alreadyInBatch.length > 0) {
        return res.status(400).json({
          success: false,
          message: `以下报销单已在付款批次中，不能重复付款：${alreadyInBatch.map((r) => r.id).join(', ')}`,
        })
      }
    }

    // 校验：所有报销单必须属于同一收款人
    const userIds = [...new Set(reimbursements.map((r) => r.user_id))]
    if (userIds.length > 1) {
      return res.status(400).json({
        success: false,
        message: '批量付款只能选择同一收款人的报销单',
      })
    }

    // 校验：所有报销单必须属于同一报销类型
    const types = [...new Set(reimbursements.map((r) => r.type))]
    if (types.length > 1) {
      return res
        .status(400)
        .json({ success: false, message: '请选择同一报销类型进行付款' })
    }

    const totalAmount = reimbursements.reduce(
      (sum, r) => sum + parseFloat(r.total_amount),
      0,
    )
    const batchId = nanoid()
    const batchNo = generateBatchNo()
    const now = new Date().toISOString()

    // 使用事务确保原子性
    await db.transaction(async (client) => {
      const lockedReimbursements = await txAll<{
        id: string
        user_id: string
        total_amount: string
        status: string
        applicant_name: string
        type: string
        title: string
        payment_batch_id: string | null
      }>(
        client,
        `SELECT id, user_id, total_amount::text AS total_amount, status,
                applicant_name, type, title, payment_batch_id
           FROM reimbursements
          WHERE id = ANY(?::text[])
            AND COALESCE(is_deleted, FALSE) = FALSE
          ORDER BY id
          FOR UPDATE`,
        reimbursementIds,
      )
      if (
        lockedReimbursements.length !== reimbursementIds.length ||
        lockedReimbursements.some((item) => item.status !== 'approved') ||
        new Set(lockedReimbursements.map((item) => item.user_id)).size !== 1 ||
        new Set(lockedReimbursements.map((item) => item.type)).size !== 1
      ) {
        throw new RouteError(
          409,
          '报销单成员、状态或收款信息已变化，请刷新后重试',
          { code: 'PAYMENT_BATCH_REIMBURSEMENT_CHANGED' },
        )
      }
      const lockedTotalAmount = lockedReimbursements.reduce(
        (sum, item) => sum + Number.parseFloat(item.total_amount),
        0,
      )
      if (Math.abs(lockedTotalAmount - totalAmount) > 0.01) {
        throw new RouteError(409, '报销金额已变化，请刷新后重试', {
          code: 'PAYMENT_BATCH_AMOUNT_CHANGED',
        })
      }

      const referencedBatchIds = [
        ...new Set(
          lockedReimbursements
            .map((item) => item.payment_batch_id)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort()
      const lockedReferencedBatches = referencedBatchIds.length
        ? await txAll<{ id: string; status: string }>(
            client,
            `SELECT id, status
               FROM payment_batches
              WHERE id = ANY(?::text[])
              ORDER BY id
              FOR UPDATE`,
            referencedBatchIds,
          )
        : []
      if (referencedBatchIds.length) {
        await txAll(
          client,
          `SELECT id, batch_id, reimbursement_id
             FROM payment_batch_items
            WHERE batch_id = ANY(?::text[])
            ORDER BY batch_id, reimbursement_id
            FOR UPDATE`,
          referencedBatchIds,
        )
      }
      const activeBatchIds = new Set(
        lockedReferencedBatches
          .filter((item) => ['pending', 'uploaded'].includes(item.status))
          .map((item) => item.id),
      )
      if (
        lockedReimbursements.some(
          (item) =>
            item.payment_batch_id && activeBatchIds.has(item.payment_batch_id),
        )
      ) {
        throw new RouteError(
          409,
          '报销单已在有效付款批次中，不能重复创建批次',
          { code: 'REIMBURSEMENT_ALREADY_IN_PAYMENT_BATCH' },
        )
      }

      // 创建新批次
      await txRun(
        client,
        `
        INSERT INTO payment_batches (id, batch_no, total_amount, payer_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `,
        batchId,
        batchNo,
        totalAmount,
        currentUserId,
        now,
        now,
      )

      // 写入批次明细快照和关联报销单
      for (const r of lockedReimbursements) {
        const itemId = nanoid()
        await txRun(
          client,
          `
          INSERT INTO payment_batch_items (id, batch_id, reimbursement_id, amount, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
          itemId,
          batchId,
          r.id,
          parseFloat(r.total_amount),
          now,
        )

        const reimbursementUpdate = await txRun(
          client,
          `
          UPDATE reimbursements
             SET payment_batch_id = ?, updated_at = ?
           WHERE id = ?
             AND status = 'approved'
             AND payment_batch_id IS NOT DISTINCT FROM ?
             AND COALESCE(is_deleted, FALSE) = FALSE
        `,
          batchId,
          now,
          r.id,
          r.payment_batch_id,
        )
        if (reimbursementUpdate.changes !== 1) {
          throw new RouteError(409, '报销单付款批次已变化，请刷新后重试', {
            code: 'REIMBURSEMENT_PAYMENT_BATCH_CHANGED',
          })
        }
      }
    })

    console.log(
      `✅ 创建付款批次: ${batchNo}, 包含 ${reimbursements.length} 笔, 合计 ¥${totalAmount.toFixed(2)}`,
    )

    res.json({
      success: true,
      message: '付款批次创建成功',
      data: {
        batchId,
        batchNo,
        totalAmount,
        reimbursements: reimbursements.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          amount: r.total_amount,
          applicant: r.applicant_name,
        })),
      },
    })
  } catch (error) {
    if (isRouteError(error)) {
      return res.status(error.statusCode).json(error.payload)
    }
    console.error('创建付款批次失败:', error)
    res.status(500).json({ success: false, message: '创建失败' })
  }
})

/**
 * 验证批量付款回单（OCR + 收款人匹配）
 * POST /api/reimbursement/payment-batch/:batchId/verify-proof
 */
router.post(
  '/payment-batch/:batchId/verify-proof',
  requireAdmin,
  uploadPaymentProof.single('paymentProof'),
  async (req, res) => {
    try {
      const { batchId } = req.params

      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: '请上传付款回单' })
      }

      // 查询批次信息
      const batch = (await db
        .prepare('SELECT * FROM payment_batches WHERE id = ?')
        .get(batchId)) as any
      if (!batch) {
        try {
          fs.unlinkSync(req.file.path)
        } catch (_) {}
        return res
          .status(404)
          .json({ success: false, message: '付款批次不存在' })
      }

      // 从快照表获取批次关联的报销单，取收款人信息
      const firstReimbursement = (await db
        .prepare(
          `
      SELECT r.user_id
      FROM payment_batch_items pbi
      INNER JOIN reimbursements r ON pbi.reimbursement_id = r.id
      WHERE pbi.batch_id = ?
      LIMIT 1
    `,
        )
        .get(batchId)) as any

      if (!firstReimbursement) {
        try {
          fs.unlinkSync(req.file.path)
        } catch (_) {}
        return res
          .status(400)
          .json({ success: false, message: '批次未关联报销单' })
      }

      // 获取收款信息（复用现有逻辑）
      const profileBankInfo = (await db
        .prepare(
          `
      SELECT bank_account_name, bank_account_number
      FROM employee_profiles WHERE user_id = ?
    `,
        )
        .get(firstReimbursement.user_id)) as
        | {
            bank_account_name: string | null
            bank_account_number: string | null
          }
        | undefined

      const userBankInfo =
        profileBankInfo &&
        (profileBankInfo.bank_account_name ||
          profileBankInfo.bank_account_number)
          ? profileBankInfo
          : ((await db
              .prepare(
                `
          SELECT bank_account_name, bank_account_number FROM users WHERE id = ?
        `,
              )
              .get(firstReimbursement.user_id)) as
              | {
                  bank_account_name: string | null
                  bank_account_number: string | null
                }
              | undefined)

      // OCR 识别
      const expectedAmount = Number.parseFloat(batch.total_amount)
      let ocrResult
      try {
        ocrResult = await recognizePaymentProof(req.file.path, {
          expectedAmount:
            Number.isFinite(expectedAmount) && expectedAmount > 0
              ? expectedAmount
              : undefined,
          requireTransactionDate: true,
        })
      } catch (ocrError: any) {
        try {
          fs.unlinkSync(req.file.path)
        } catch (_) {}
        return res.status(400).json({
          success: false,
          message: ocrError.message || '此不是付款回单，请重新上传',
        })
      }

      // 验证收款人和账号（复用现有逻辑）
      const ocrTextNoSpace = (ocrResult.rawText || '').replace(/\s+/g, '')

      let accountMatched = false
      if (userBankInfo?.bank_account_number && ocrResult.payeeAccount) {
        const expectedAccount = userBankInfo.bank_account_number.replace(
          /\s+/g,
          '',
        )
        const ocrAccount = ocrResult.payeeAccount.replace(/\s+/g, '')
        if (expectedAccount === ocrAccount) {
          accountMatched = true
        } else if (
          expectedAccount.endsWith(ocrAccount) ||
          ocrAccount.endsWith(expectedAccount)
        ) {
          accountMatched = true
        } else if (
          expectedAccount.length === ocrAccount.length &&
          expectedAccount.slice(1) === ocrAccount.slice(1)
        ) {
          accountMatched = true
        }
      }

      // 检查收款人姓名是否匹配
      let nameFound = false
      if (userBankInfo?.bank_account_name) {
        const expectedName = userBankInfo.bank_account_name.trim()
        const ocrPayee = (ocrResult.payee || '').trim()

        // 1. 在 OCR 提取的收款人字段中精确/包含/模糊匹配
        if (ocrPayee && ocrPayee !== '付款' && ocrPayee !== '收款') {
          if (ocrPayee === expectedName || ocrPayee.includes(expectedName)) {
            nameFound = true
          }
          if (!nameFound && expectedName.length >= 2) {
            const chars = expectedName.split('')
            for (let i = 0; i < chars.length && !nameFound; i++) {
              const partial = chars.filter((_, idx) => idx !== i).join('')
              if (ocrPayee.includes(partial)) {
                console.log(
                  `✅ 姓名模糊匹配成功（payee字段）：跳过第${i + 1}个字"${chars[i]}"，在"${ocrPayee}"中匹配到"${partial}"`,
                )
                nameFound = true
              }
            }
          }
        }

        // 2. OCR 字段提取失败或无效时，在原始文本的"户名"附近行中查找（排除备注区域）
        if (!nameFound && ocrResult.rawText) {
          const rawBeforeMemo = ocrResult.rawText.split(/备注|附言|客户附言/)[0]
          const rawNoSpace = rawBeforeMemo.replace(/\s+/g, '')

          if (rawNoSpace.includes(expectedName)) {
            console.log(`✅ 姓名在回单主体中找到（精确）："${expectedName}"`)
            nameFound = true
          }
          if (!nameFound && expectedName.length >= 2) {
            const chars = expectedName.split('')
            for (let i = 0; i < chars.length && !nameFound; i++) {
              const partial = chars.filter((_, idx) => idx !== i).join('')
              if (rawNoSpace.includes(partial)) {
                console.log(
                  `✅ 姓名在回单主体中找到（模糊）：跳过"${chars[i]}"，匹配到"${partial}"`,
                )
                nameFound = true
              }
            }
          }
        }
      }

      // 账号和姓名必须同时匹配
      if (!accountMatched || !nameFound) {
        const reasons: string[] = []

        // 检查账号匹配情况
        if (!accountMatched) {
          if (userBankInfo?.bank_account_number && ocrResult.payeeAccount) {
            reasons.push(
              `收款账号不一致：期望"${userBankInfo.bank_account_number}"，回单为"${ocrResult.payeeAccount}"`,
            )
          } else if (!ocrResult.payeeAccount) {
            reasons.push('无法识别付款回单中的收款账号')
          } else if (!userBankInfo?.bank_account_number) {
            reasons.push('报销单未设置收款账号')
          }
        }

        // 检查姓名匹配情况
        if (!nameFound) {
          if (!userBankInfo?.bank_account_name) {
            reasons.push('报销单未设置收款人姓名')
          } else {
            const ocrPayee = (ocrResult.payee || '').trim()
            let actualPayee: string | null = null

            if (ocrPayee && ocrPayee !== '付款' && ocrPayee !== '收款') {
              actualPayee = ocrPayee
            }

            if (!actualPayee && ocrResult.rawText) {
              const rawBeforeMemo =
                ocrResult.rawText.split(/备注|附言|客户附言/)[0]
              const lines = rawBeforeMemo
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
              const namePattern = /^[\u4e00-\u9fff]{2,4}$/
              const excludeWords = [
                '公司',
                '集团',
                '银行',
                '回单',
                '付款',
                '收款',
                '户名',
                '账号',
                '金额',
                '开户',
                '支行',
                '摘要',
                '用途',
                '业务',
                '产品',
                '种类',
              ]
              for (const line of lines) {
                if (
                  namePattern.test(line) &&
                  !excludeWords.some((w) => line.includes(w))
                ) {
                  if (line !== userBankInfo.bank_account_name) {
                    actualPayee = line
                    break
                  }
                }
              }
            }

            if (actualPayee) {
              reasons.push(
                `回单收款人（${actualPayee}）姓名与报销单收款人（${userBankInfo.bank_account_name}）不匹配`,
              )
            } else {
              reasons.push(
                `未在付款回单中找到收款人"${userBankInfo.bank_account_name}"`,
              )
            }
          }
        }

        try {
          fs.unlinkSync(req.file.path)
        } catch (_) {}
        return res.status(400).json({
          success: false,
          message: '付款回单验证失败：收款人姓名和收款账号必须与报销单一致',
          warnings: reasons,
        })
      }

      const tempFileName = path.basename(req.file.path)
      const batchFileBuffer = fs.readFileSync(req.file.path)
      const batchFileHash = crypto
        .createHash('sha256')
        .update(batchFileBuffer)
        .digest('hex')
      const batchVerifierId = req.session.userId!

      // 将 OCR 结果存入缓存，绑定目标批次、验证人、文件哈希、交易流水号，防止重放
      ocrCache.set(tempFileName, {
        amount: ocrResult.amount,
        timestamp: Date.now(),
        targetType: 'payment_batch',
        targetId: batchId,
        verifierId: batchVerifierId,
        fileHash: batchFileHash,
        proofNo: ocrResult.proofNo,
        transactionDate: ocrResult.transactionDate,
      })

      res.json({
        success: true,
        message: '付款回单验证通过',
        data: {
          tempFileName,
          ocrResult: {
            payer: ocrResult.payer,
            payee: ocrResult.payee,
            payeeAccount: ocrResult.payeeAccount,
            amount: ocrResult.amount,
            transactionDate: ocrResult.transactionDate,
          },
          originalFileName:
            req.body.originalFileName ||
            Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
        },
      })
    } catch (error) {
      console.error('❌ 批量付款回单验证失败:', error)
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path)
        } catch (_) {}
      }
      res.status(500).json({ success: false, message: '验证失败' })
    }
  },
)

/**
 * 提交批量付款回单
 * POST /api/reimbursement/payment-batch/:batchId/complete
 */
router.post(
  '/payment-batch/:batchId/complete',
  requireAdmin,
  async (req, res) => {
    const movedPaymentProofPaths: string[] = []
    let paymentProofCommitted = false
    try {
      const { batchId } = req.params
      const currentUserId = req.session.userId!

      const { verifiedFiles } = req.body
      if (
        !verifiedFiles ||
        !Array.isArray(verifiedFiles) ||
        verifiedFiles.length === 0
      ) {
        return res
          .status(400)
          .json({ success: false, message: '请上传付款回单' })
      }

      // 查询批次
      const batch = (await db
        .prepare('SELECT * FROM payment_batches WHERE id = ?')
        .get(batchId)) as any
      if (!batch) {
        return res
          .status(404)
          .json({ success: false, message: '付款批次不存在' })
      }

      if (batch.status !== 'pending') {
        return res
          .status(400)
          .json({ success: false, message: '该批次已完成付款' })
      }

      // 从快照表查询批次关联的报销单
      const reimbursements = (await db
        .prepare(
          `
      SELECT r.id, r.status, r.total_amount
      FROM payment_batch_items pbi
      INNER JOIN reimbursements r ON pbi.reimbursement_id = r.id
      WHERE pbi.batch_id = ? AND COALESCE(r.is_deleted, FALSE) = FALSE
    `,
        )
        .all(batchId)) as any[]

      // 校验所有报销单状态
      const notApproved = reimbursements.filter((r) => r.status !== 'approved')
      if (notApproved.length > 0) {
        return res
          .status(400)
          .json({ success: false, message: '部分报销单状态异常' })
      }

      // 使用服务端缓存的金额，防止客户端篡改，严格校验目标批次和验证人
      let totalOcrAmount = 0
      for (const file of verifiedFiles) {
        const cached = ocrCache.get(file.tempFileName)
        if (!cached) {
          return res.status(400).json({
            success: false,
            message: `文件 ${file.originalFileName} 验证已过期，请重新验证`,
          })
        }
        // 严格校验：必须是当前批次、当前管理员验证的回单
        if (
          cached.targetType !== 'payment_batch' ||
          cached.targetId !== batchId ||
          cached.verifierId !== currentUserId
        ) {
          return res.status(403).json({
            success: false,
            message: `文件 ${file.originalFileName} 验证记录与当前批次不匹配，请重新验证`,
          })
        }
        totalOcrAmount += cached.amount
      }

      const expectedAmount = parseFloat(batch.total_amount)
      if (Math.abs(expectedAmount - totalOcrAmount) > 0.01) {
        return res.status(400).json({
          success: false,
          message: `回单金额总和 ¥${totalOcrAmount.toFixed(2)} 与批次金额 ¥${expectedAmount.toFixed(2)} 不一致`,
        })
      }

      let paymentBusinessDate: string
      try {
        paymentBusinessDate = resolveConsistentPaymentProofTransactionDate(
          verifiedFiles.map(
            (file: any) => ocrCache.get(file.tempFileName)?.transactionDate,
          ),
        )
      } catch (dateError) {
        return res.status(400).json({
          success: false,
          message:
            dateError instanceof Error
              ? dateError.message
              : '无法确定回单实际交易日期',
        })
      }

      // 收集并规范化摘要和回单号；数据库权威去重在落盘后的事务锁内执行，失败时清理本批新文件。
      const batchProofIdentities: PaymentProofIdentity[] = verifiedFiles
        .map((f: any) => {
          const cached = ocrCache.get(f.tempFileName)
          return {
            fileHash: cached?.fileHash || '',
            proofNo: cached?.proofNo || '',
          }
        })
        .filter((item) => item.fileHash) // 只过滤有 fileHash 的项
      if (
        batchProofIdentities.length !== verifiedFiles.length ||
        hasDuplicatePaymentProofIdentities(batchProofIdentities)
      ) {
        return res.status(400).json({
          success: false,
          message: '本次提交包含重复或无效的付款回单标识',
        })
      }
      const normalizedBatchProofIdentities =
        normalizePaymentProofIdentities(batchProofIdentities)
      const batchProofFileHashes = normalizedBatchProofIdentities.map(
        (identity) => identity.fileHash,
      )
      const batchProofNos = normalizedBatchProofIdentities.map(
        (identity) => identity.proofNo,
      )

      const paymentProofPaths: string[] = []
      const invoicesDir = ensureDatedUploadDirectory('invoices')
      for (const file of verifiedFiles) {
        const tempPath = path.join(tempDir, path.basename(file.tempFileName))
        if (!fs.existsSync(tempPath)) {
          return res.status(400).json({
            success: false,
            message: `文件 ${file.originalFileName} 已过期，请重新上传`,
          })
        }
        const safeFileName = path
          .basename(file.originalFileName || 'proof')
          .replace(/[^\w\u4e00-\u9fff.-]/g, '_')
        const finalFileName = `payment-proof-batch-${batch.batch_no}-${Date.now()}-${safeFileName}`
        const finalPath = path.join(invoicesDir, finalFileName)
        fs.renameSync(tempPath, finalPath)
        movedPaymentProofPaths.push(finalPath)
        paymentProofPaths.push(toStoredUploadPath(finalPath))
      }

      const paymentProofPath = paymentProofPaths.join(',')
      const now = new Date().toISOString()

      // 使用事务确保原子性
      await db.transaction(async (client) => {
        await lockPaymentProofIdentities(client, normalizedBatchProofIdentities)
        if (
          await findExistingPaymentProofIdentity(
            client,
            normalizedBatchProofIdentities,
          )
        ) {
          throw new RouteError(
            409,
            '付款回单文件或电子回单号码已被使用，请勿重复提交',
            { code: 'PAYMENT_PROOF_ALREADY_USED' },
          )
        }

        const expectedReimbursementIds = reimbursements
          .map((item) => String(item.id))
          .sort()
        const lockedReimbursements = await txAll<{
          id: string
          status: string
          total_amount: string
          payment_batch_id: string | null
        }>(
          client,
          `SELECT id, status, total_amount::text AS total_amount,
                  payment_batch_id
             FROM reimbursements
            WHERE id = ANY(?::text[])
              AND COALESCE(is_deleted, FALSE) = FALSE
            ORDER BY id
            FOR UPDATE`,
          expectedReimbursementIds,
        )
        const lockedBatch = await txGet<{
          id: string
          batch_no: string
          status: string
          total_amount: string
        }>(
          client,
          `SELECT id, batch_no, status, total_amount::text AS total_amount
             FROM payment_batches
            WHERE id = ?
            FOR UPDATE`,
          batchId,
        )
        const lockedItems = await txAll<{
          reimbursement_id: string
          amount: string
        }>(
          client,
          `SELECT reimbursement_id, amount::text AS amount
             FROM payment_batch_items
            WHERE batch_id = ?
            ORDER BY reimbursement_id
            FOR UPDATE`,
          batchId,
        )
        const lockedIds = lockedReimbursements.map((item) => item.id)
        const lockedItemIds = lockedItems.map((item) => item.reimbursement_id)
        const lockedItemAmount = lockedItems.reduce(
          (sum, item) => sum + Number.parseFloat(item.amount),
          0,
        )
        if (
          !lockedBatch ||
          lockedBatch.status !== 'pending' ||
          JSON.stringify(lockedIds) !==
            JSON.stringify(expectedReimbursementIds) ||
          JSON.stringify(lockedItemIds) !==
            JSON.stringify(expectedReimbursementIds) ||
          lockedReimbursements.some(
            (item) =>
              item.status !== 'approved' || item.payment_batch_id !== batchId,
          ) ||
          Math.abs(
            Number.parseFloat(lockedBatch.total_amount) - totalOcrAmount,
          ) > 0.01 ||
          Math.abs(lockedItemAmount - totalOcrAmount) > 0.01
        ) {
          throw new RouteError(
            409,
            '付款批次成员、金额或状态已变化，请刷新后重试',
            { code: 'PAYMENT_BATCH_STATE_CHANGED' },
          )
        }

        // 仅允许待付款批次接管本次付款事实。
        const batchUpdate = await txRun(
          client,
          `
        UPDATE payment_batches
        SET status = 'uploaded', payment_proof_path = ?, pay_time = ?,
            payment_business_date = ?,
            updated_at = ?
        WHERE id = ? AND status = 'pending'
      `,
          paymentProofPath,
          now,
          paymentBusinessDate,
          now,
          batchId,
        )
        if (batchUpdate.changes !== 1) {
          throw new RouteError(409, '付款批次状态已变化，请刷新后重试', {
            code: 'PAYMENT_BATCH_STATE_CHANGED',
          })
        }

        // 写入每张回单哈希和电子回单号码，防止后续重放
        for (let i = 0; i < batchProofFileHashes.length; i++) {
          const fileHash = batchProofFileHashes[i]
          const proofNo = batchProofNos[i] || null
          await txRun(
            client,
            `
          INSERT INTO payment_proof_hashes (id, file_hash, proof_no, batch_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
            nanoid(),
            fileHash,
            proofNo,
            batchId,
            now,
          )
        }

        // 更新所有关联报销单状态
        for (const r of lockedReimbursements) {
          const reimbursementUpdate = await txRun(
            client,
            `
          UPDATE reimbursements
          SET status = 'payment_uploaded', payment_proof_path = ?, pay_time = ?,
              payment_business_date = ?,
              payment_upload_time = ?, updated_at = ?
          WHERE id = ?
            AND status = 'approved'
            AND payment_batch_id = ?
            AND COALESCE(is_deleted, FALSE) = FALSE
        `,
            paymentProofPath,
            now,
            paymentBusinessDate,
            now,
            now,
            r.id,
            batchId,
          )
          if (reimbursementUpdate.changes !== 1) {
            throw new RouteError(409, '报销单付款状态已变化，请刷新后重试', {
              code: 'REIMBURSEMENT_PAYMENT_STATE_CHANGED',
            })
          }

          // 为每个报销单创建审批记录
          const approvalInstance = (await txGet(
            client,
            `
          SELECT id FROM approval_instances
          WHERE target_id = ? AND target_type = 'reimbursement'
          ORDER BY created_at DESC LIMIT 1
        `,
            r.id,
          )) as { id: string } | undefined

          if (approvalInstance) {
            const recordId = nanoid()
            const comment =
              reimbursements.length > 1
                ? `管理员已批量付款（批次 ${batch.batch_no}，共 ${reimbursements.length} 笔，合计 ¥${expectedAmount.toFixed(2)}）`
                : '管理员已上传付款回单'
            await txRun(
              client,
              `
            INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
              recordId,
              approvalInstance.id,
              99,
              currentUserId,
              'payment_uploaded',
              comment,
              now,
            )
          }
        }
      })
      paymentProofCommitted = true

      // 一次性消费：事务完成后从缓存中删除已使用的回单验证记录
      for (const file of verifiedFiles) {
        ocrCache.delete(file.tempFileName)
      }

      console.log(
        `✅ 批量付款完成: ${batch.batch_no}, 共 ${reimbursements.length} 笔, 合计 ¥${expectedAmount.toFixed(2)}`,
      )

      res.json({
        success: true,
        message: `付款成功，共 ${reimbursements.length} 笔报销单`,
        data: { batchNo: batch.batch_no, paymentProofPath },
      })
    } catch (error) {
      const commitOutcomeUncertain = Boolean(
        error &&
        typeof error === 'object' &&
        'commitOutcomeUncertain' in error &&
        (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
      )
      if (!paymentProofCommitted && !commitOutcomeUncertain) {
        for (const movedPath of movedPaymentProofPaths) {
          fs.rmSync(movedPath, { force: true })
        }
      }
      if (commitOutcomeUncertain) {
        return res.status(500).json({
          success: false,
          code: 'PAYMENT_PROOF_COMMIT_OUTCOME_UNCERTAIN',
          message: '付款结果暂时无法确认，请刷新状态后再操作，勿重复上传',
        })
      }
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        String((error as { code?: unknown }).code) === '23505'
      ) {
        return res.status(409).json({
          success: false,
          code: 'PAYMENT_PROOF_ALREADY_USED',
          message: '付款回单文件或电子回单号码已被使用，请勿重复提交',
        })
      }
      if (isRouteError(error)) {
        return res.status(error.statusCode).json(error.payload)
      }
      console.error('❌ 批量付款提交失败:', error)
      res.status(500).json({ success: false, message: '提交失败' })
    }
  },
)

/**
 * 批量确认收款（按批次）
 * POST /api/reimbursement/payment-batch/:batchId/confirm-receipt
 */
router.post(
  '/payment-batch/:batchId/confirm-receipt',
  requireAuth,
  async (req, res) => {
    try {
      const { batchId } = req.params
      const currentUserId = req.session.user?.id
      const currentUserName = req.session.user?.name

      if (!currentUserId) {
        return res.status(401).json({ success: false, message: '未登录' })
      }

      // 查询批次
      const batch = (await db
        .prepare('SELECT * FROM payment_batches WHERE id = ?')
        .get(batchId)) as any
      if (!batch) {
        return res
          .status(404)
          .json({ success: false, message: '付款批次不存在' })
      }

      if (batch.status !== 'uploaded') {
        return res
          .status(400)
          .json({ success: false, message: '该批次尚未完成付款' })
      }

      // 从快照表查询批次关联的报销单
      let reimbursements = (await db
        .prepare(
          `
      SELECT r.id, r.user_id, r.status
      FROM payment_batch_items pbi
      INNER JOIN reimbursements r ON pbi.reimbursement_id = r.id
      WHERE pbi.batch_id = ? AND COALESCE(r.is_deleted, FALSE) = FALSE
    `,
        )
        .all(batchId)) as any[]

      // 如果快照表中没有记录，直接通过 payment_batch_id 查询报销单（兼容数据不一致的情况）
      if (reimbursements.length === 0) {
        reimbursements = (await db
          .prepare(
            `
        SELECT id, user_id, status
        FROM reimbursements
        WHERE payment_batch_id = ? AND COALESCE(is_deleted, FALSE) = FALSE
      `,
          )
          .all(batchId)) as any[]
      }

      if (reimbursements.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: '该批次下没有关联的报销单' })
      }

      // 校验：当前用户必须是报销单的申请人
      const notOwned = reimbursements.filter((r) => r.user_id !== currentUserId)
      if (notOwned.length > 0) {
        return res
          .status(403)
          .json({ success: false, message: '只有报销单申请人才能确认收款' })
      }

      // 只更新 payment_uploaded 状态的报销单
      const toConfirm = reimbursements.filter(
        (r) => r.status === 'payment_uploaded',
      )
      if (toConfirm.length === 0) {
        const statuses = reimbursements.map((r) => r.status)
        if (statuses.every((s) => s === 'completed')) {
          return res
            .status(400)
            .json({ success: false, message: '该批次报销单已全部确认收款' })
        }
        return res
          .status(400)
          .json({ success: false, message: '没有需要确认的报销单' })
      }

      const now = new Date().toISOString()

      // 使用事务确保原子性
      await db.transaction(async (client) => {
        // 更新所有关联报销单状态
        for (const r of toConfirm) {
          await txRun(
            client,
            `
          UPDATE reimbursements
          SET status = 'completed', completed_time = ?, receipt_confirmed_by = ?, updated_at = ?
          WHERE id = ?
        `,
            now,
            currentUserName || '用户',
            now,
            r.id,
          )
        }

        // 更新批次状态
        await txRun(
          client,
          `
        UPDATE payment_batches SET status = 'confirmed', updated_at = ? WHERE id = ?
      `,
          now,
          batchId,
        )
      })

      console.log(
        `✅ 批量确认收款: ${batch.batch_no}, 共 ${toConfirm.length} 笔`,
      )

      res.json({
        success: true,
        message: `已确认收款，共 ${toConfirm.length} 笔报销单`,
      })
    } catch (error) {
      console.error('❌ 批量确认收款失败:', error)
      res.status(500).json({ success: false, message: '操作失败' })
    }
  },
)

/**
 * 获取付款批次详情
 * GET /api/reimbursement/payment-batch/:batchId
 */
router.get('/payment-batch/:batchId', requireAuth, async (req, res) => {
  try {
    const { batchId } = req.params
    const currentUserId = req.session.userId!

    // 查询当前用户角色
    const user = await db.get(
      'SELECT role FROM users WHERE id = ?',
      currentUserId,
    )
    const isAdmin =
      user?.role === 'admin' || isSystemAdminEquivalentRole(user?.role)

    const batch = (await db
      .prepare(
        `
      SELECT pb.*, u.name as payerName
      FROM payment_batches pb
      LEFT JOIN users u ON pb.payer_id = u.id
      WHERE pb.id = ?
    `,
      )
      .get(batchId)) as any

    if (!batch) {
      return res.status(404).json({ success: false, message: '付款批次不存在' })
    }

    // 从快照表查询关联的报销单
    const reimbursements = (await db
      .prepare(
        `
      SELECT r.id, r.type, r.title, r.total_amount as amount, r.status, r.applicant_name as applicant
      FROM payment_batch_items pbi
      INNER JOIN reimbursements r ON pbi.reimbursement_id = r.id
      WHERE pbi.batch_id = ? AND COALESCE(r.is_deleted, FALSE) = FALSE
    `,
      )
      .all(batchId)) as any[]

    // 权限：管理员和总经理可查看所有，普通用户只能查看自己的
    const isGM = user?.role === 'general_manager'
    if (!isAdmin && !isGM) {
      const ownedReimbursement = (await db
        .prepare(
          `
        SELECT r.id
        FROM payment_batch_items pbi
        INNER JOIN reimbursements r ON pbi.reimbursement_id = r.id
        WHERE pbi.batch_id = ? AND r.user_id = ?
        LIMIT 1
      `,
        )
        .get(batchId, currentUserId)) as any
      if (!ownedReimbursement) {
        return res
          .status(403)
          .json({ success: false, message: '无权查看此批次' })
      }
    }

    res.json({
      success: true,
      data: {
        id: batch.id,
        batchNo: batch.batch_no,
        totalAmount: batch.total_amount,
        paymentProofPath: batch.payment_proof_path,
        payerName: batch.payerName,
        payTime: batch.pay_time,
        status: batch.status,
        createdAt: batch.created_at,
        remark: batch.remark,
        reimbursements,
      },
    })
  } catch (error) {
    console.error('❌ 获取付款批次详情失败:', error)
    res.status(500).json({ success: false, message: '获取失败' })
  }
})

export default router
