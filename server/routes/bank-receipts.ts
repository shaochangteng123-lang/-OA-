import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { nanoid } from 'nanoid'
import { PDFDocument } from 'pdf-lib'
import { requireAdmin } from '../middleware/auth.js'
import { db } from '../db/index.js'
import { processBankReceiptPdf } from '../services/bankReceiptProcessor.js'

const router = Router()

const uploadsDir = path.join(process.cwd(), 'uploads')
const bankReceiptsDir = path.join(uploadsDir, 'bank-receipts')
;[uploadsDir, bankReceiptsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
})

const uploadPdf = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, path.join(uploadsDir, 'temp')),
    filename: (_, file, cb) => cb(null, `bank-receipt-${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true)
    else cb(new Error('只支持 PDF 文件'))
  },
})

/**
 * POST /api/bank-receipts/upload
 * 上传工行回单PDF（支持多个PDF，自动合并后处理）
 */
router.post('/upload', requireAdmin, uploadPdf.array('pdfs', 20), async (req, res) => {
  const files = req.files as Express.Multer.File[]
  if (!files || files.length === 0) {
    res.status(400).json({ success: false, message: '请上传 PDF 文件' })
    return
  }

  const currentUserId = (req.session as any).userId
  const batchId = `brb_${nanoid(10)}`
  const now = new Date().toISOString()
  const pdfFileName = `batch-${batchId}.pdf`
  const pdfPath = path.join(bankReceiptsDir, pdfFileName)

  try {
    if (files.length === 1) {
      fs.renameSync(files[0].path, pdfPath)
    } else {
      // 合并多个PDF
      const merged = await PDFDocument.create()
      for (const file of files) {
        const bytes = fs.readFileSync(file.path)
        const doc = await PDFDocument.load(bytes)
        const pages = await merged.copyPages(doc, doc.getPageIndices())
        pages.forEach(p => merged.addPage(p))
        fs.unlinkSync(file.path)
      }
      fs.writeFileSync(pdfPath, await merged.save())
    }
  } catch (err) {
    files.forEach(f => { try { fs.unlinkSync(f.path) } catch {} })
    res.status(500).json({ success: false, message: 'PDF 合并失败' })
    return
  }

  await db.run(
    `INSERT INTO bank_receipt_batches (id, pdf_path, uploaded_by, status, created_at, updated_at)
     VALUES (?, ?, ?, 'processing', ?, ?)`,
    batchId, `uploads/bank-receipts/${pdfFileName}`, currentUserId, now, now,
  )

  res.json({ success: true, data: { batchId } })

  const outputDir = path.join(bankReceiptsDir, batchId)
  fs.mkdirSync(outputDir, { recursive: true })

  processBankReceiptPdf(pdfPath, batchId, currentUserId, outputDir).catch(async (err) => {
    console.error('❌ 回单PDF处理失败:', err)
    await db.run(
      `UPDATE bank_receipt_batches SET status = 'failed', updated_at = ? WHERE id = ?`,
      new Date().toISOString(), batchId,
    )
  })
})

/**
 * GET /api/bank-receipts/batch/:batchId
 * 查询批次处理状态和结果
 */
router.get('/batch/:batchId', requireAdmin, async (req, res) => {
  const { batchId } = req.params
  const batch = await db.get(`SELECT * FROM bank_receipt_batches WHERE id = ?`, batchId)
  if (!batch) {
    res.status(404).json({ success: false, message: '批次不存在' })
    return
  }
  const receipts = await db.all(`SELECT * FROM bank_receipts WHERE batch_id = ? ORDER BY page_no, position`, batchId)

  // 为每张回单展开匹配的报销单列表（支持合并打款多笔）
  const enrichedReceipts = await Promise.all(receipts.map(async (receipt: any) => {
    let matchedReimbursements: any[] = []

    // 从 ocr_raw_json.matchedIds 取所有匹配的报销单 ID
    let matchedIds: string[] = []
    try {
      const raw = typeof receipt.ocr_raw_json === 'string' ? JSON.parse(receipt.ocr_raw_json) : receipt.ocr_raw_json
      if (Array.isArray(raw?.matchedIds) && raw.matchedIds.length > 0) {
        matchedIds = raw.matchedIds
      } else if (receipt.matched_reimbursement_id) {
        matchedIds = [receipt.matched_reimbursement_id]
      }
    } catch {
      if (receipt.matched_reimbursement_id) matchedIds = [receipt.matched_reimbursement_id]
    }

    if (matchedIds.length > 0) {
      const placeholders = matchedIds.map(() => '?').join(',')
      matchedReimbursements = await db.all(
        `SELECT r.id, r.title, r.type, r.total_amount, r.approve_time,
                u.name as applicant_name
         FROM reimbursements r
         JOIN users u ON r.user_id = u.id
         WHERE r.id IN (${placeholders})`,
        ...matchedIds,
      )
    }

    // 如果有 payment_batch_id，附带批次号
    let paymentBatchNo: string | null = null
    if (receipt.payment_batch_id) {
      const pb = await db.get<{ batch_no: string }>(
        `SELECT batch_no FROM payment_batches WHERE id = ?`, receipt.payment_batch_id,
      )
      paymentBatchNo = pb?.batch_no || null
    }

    return { ...receipt, matchedReimbursements, paymentBatchNo }
  }))

  res.json({ success: true, data: { batch, receipts: enrichedReceipts } })
})

/**
 * DELETE /api/bank-receipts/unmatched/all
 * 一键删除所有待认领回单
 */
router.delete('/unmatched/all', requireAdmin, async (req, res) => {
  await db.run(`UPDATE bank_receipts SET match_status = 'matched' WHERE match_status = 'unmatched'`)
  res.json({ success: true })
})


router.get('/unmatched', requireAdmin, async (req, res) => {
  const receipts = await db.all(`
    SELECT br.*, brb.created_at as batch_created_at
    FROM bank_receipts br
    JOIN bank_receipt_batches brb ON br.batch_id = brb.id
    WHERE br.match_status = 'unmatched'
    ORDER BY br.created_at DESC
  `)
  res.json({ success: true, data: receipts })
})

/**
 * POST /api/bank-receipts/:id/match
 * 人工指定匹配报销单
 */
router.post('/:id/match', requireAdmin, async (req, res) => {
  const { id } = req.params
  const { reimbursementId } = req.body
  const currentUserId = (req.session as any).userId

  if (!reimbursementId) {
    res.status(400).json({ success: false, message: '请指定报销单ID' })
    return
  }

  const receipt = await db.get(`SELECT * FROM bank_receipts WHERE id = ?`, id)
  if (!receipt) {
    res.status(404).json({ success: false, message: '回单不存在' })
    return
  }

  const reimbursement = await db.get(
    `SELECT id, status FROM reimbursements WHERE id = ? AND status = 'approved' AND is_deleted = false`,
    reimbursementId,
  )
  if (!reimbursement) {
    res.status(400).json({ success: false, message: '报销单不存在或状态不符' })
    return
  }

  const now = new Date().toISOString()

  await db.run(
    `UPDATE bank_receipts SET match_status = 'matched', matched_reimbursement_id = ?,
     matched_by = ?, matched_at = ? WHERE id = ?`,
    reimbursementId, currentUserId, now, id,
  )

  await db.run(
    `UPDATE reimbursements SET status = 'payment_uploaded', payment_proof_path = ?,
     payment_upload_time = ?, pay_time = ?, updated_at = ? WHERE id = ?`,
    receipt.image_path, now, now, now, reimbursementId,
  )

  // 写审批记录，让审批流程和详情页显示付款凭证节点
  const approvalInstance = await db.get<{ id: string }>(
    `SELECT id FROM approval_instances WHERE target_id = ? AND target_type = 'reimbursement' ORDER BY created_at DESC LIMIT 1`,
    reimbursementId,
  )
  if (approvalInstance) {
    const { nanoid } = await import('nanoid')
    const recordId = `ar_${nanoid(10)}`
    await db.run(
      `INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      recordId, approvalInstance.id, 99, currentUserId, 'payment_uploaded', '财务手动上传付款回单', now,
    )
  }

  // 更新批次统计
  await db.run(`
    UPDATE bank_receipt_batches SET
      matched_count = (SELECT COUNT(*) FROM bank_receipts WHERE batch_id = bank_receipt_batches.id AND match_status = 'matched'),
      unmatched_count = (SELECT COUNT(*) FROM bank_receipts WHERE batch_id = bank_receipt_batches.id AND match_status = 'unmatched'),
      updated_at = ?
    WHERE id = ?
  `, now, receipt.batch_id)

  res.json({ success: true })
})

/**
 * POST /api/bank-receipts/:id/skip
 * 跳过/忽略该回单（非报销类付款，不需要匹配）
 */
router.post('/:id/skip', requireAdmin, async (req, res) => {
  const { id } = req.params
  const receipt = await db.get(`SELECT * FROM bank_receipts WHERE id = ?`, id)
  if (!receipt) {
    res.status(404).json({ success: false, message: '回单不存在' })
    return
  }
  await db.run(`UPDATE bank_receipts SET match_status = 'matched' WHERE id = ?`, id)
  res.json({ success: true })
})

/**
 * GET /api/bank-receipts/by-reimbursement/:reimbursementId
 * 通过报销单ID查找对应的银行回单，并返回同一张回单关联的所有报销单信息
 * 用于前端展示"合并打款"场景下的关联报销单列表
 */
router.get('/by-reimbursement/:reimbursementId', async (req, res) => {
  try {
    const { reimbursementId } = req.params

    // 查找该报销单对应的银行回单（通过 payment_proof_path 匹配）
    const reimbursement = await db.get<{ payment_proof_path: string | null }>(
      `SELECT payment_proof_path FROM reimbursements WHERE id = ? AND is_deleted = false`,
      reimbursementId,
    )
    if (!reimbursement?.payment_proof_path) {
      res.json({ success: true, data: null })
      return
    }

    // 只处理银行回单图片（bank-receipts 路径），旧流程的 invoices 路径不需要处理
    if (!reimbursement.payment_proof_path.includes('bank-receipts')) {
      res.json({ success: true, data: null })
      return
    }

    // 在 bank_receipts 表中找到对应回单
    const bankReceipt = await db.get<{ id: string; ocr_amount: number; ocr_raw_json: string; image_path: string }>(
      `SELECT id, ocr_amount, ocr_raw_json, image_path FROM bank_receipts WHERE image_path = ? AND match_status = 'matched'`,
      reimbursement.payment_proof_path,
    )
    if (!bankReceipt) {
      res.json({ success: true, data: null })
      return
    }

    // 解析 matchedIds（所有关联的报销单 ID）
    let matchedIds: string[] = []
    try {
      const raw = typeof bankReceipt.ocr_raw_json === 'string'
        ? JSON.parse(bankReceipt.ocr_raw_json)
        : bankReceipt.ocr_raw_json
      if (Array.isArray(raw?.matchedIds) && raw.matchedIds.length > 1) {
        matchedIds = raw.matchedIds
      }
    } catch {}

    // 只有多笔合并时才返回（单笔不需要展示）
    if (matchedIds.length <= 1) {
      res.json({ success: true, data: null })
      return
    }

    // 查出所有关联报销单的详细信息
    const placeholders = matchedIds.map(() => '?').join(',')
    const reimbursements = await db.all<{ id: string; title: string; total_amount: number; type: string; applicant_name: string }>(
      `SELECT r.id, r.title, r.total_amount, r.type,
              COALESCE(r.applicant_name, u.name) as applicant_name
       FROM reimbursements r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.id IN (${placeholders})`,
      ...matchedIds,
    )

    res.json({
      success: true,
      data: {
        bankReceiptId: bankReceipt.id,
        totalAmount: Number(bankReceipt.ocr_amount),
        imagePath: bankReceipt.image_path,
        reimbursements: reimbursements.map(r => ({
          id: r.id,
          title: r.title,
          amount: Number(r.total_amount),
          type: r.type,
          applicantName: r.applicant_name,
        })),
      },
    })
  } catch (error) {
    console.error('查询银行回单关联报销单失败:', error)
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

export default router
