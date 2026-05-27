import express from 'express'
import path from 'path'
import fs from 'fs'
import os from 'os'
import multer from 'multer'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import { validateFilePath } from '../utils/file-validation.js'
import { db } from '../db/index.js'
import { isAdminLike } from '../utils/worklog-auth.js'
import { sendConvertedPdf, CONVERTIBLE_EXT } from '../utils/doc-preview.js'

const router = express.Router()

// 下载发票文件
router.get('/invoices/:filename', requireAuth, async (req, res) => {
  try {
    const { filename } = req.params
    const userId = req.session.userId!

    // 构造文件路径
    const filePath = `uploads/invoices/${filename}`

    // 安全校验
    if (!validateFilePath(filePath)) {
      return res.status(403).json({ success: false, message: '非法文件路径' })
    }

    // 查询该文件是否属于当前用户的报销单
    console.log('🔍 查询文件权限 - 文件路径:', filePath)
    console.log('🔍 查询文件权限 - 用户ID:', userId)
    const invoice = await db.get(
      `SELECT r.user_id, r.id as reimbursement_id, r.type
       FROM reimbursement_invoices ri
       JOIN reimbursements r ON ri.reimbursement_id = r.id
       WHERE ri.file_path = ? OR ri.file_path = ?`,
      filePath,
      '/' + filePath
    )

    console.log('🔍 查询结果:', invoice)

    // 如果数据库中找到记录，检查权限
    if (invoice) {
      const user = await db.get('SELECT role FROM users WHERE id = ?', userId)
      const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'
      const isGMForBusiness = user?.role === 'general_manager' && invoice.type === 'business'

      if (invoice.user_id !== userId && !isAdmin && !isGMForBusiness) {
        console.log('❌ 无权访问 - 不是文件所有者')
        return res.status(403).json({ success: false, message: '无权访问此文件' })
      }
    } else {
      // 数据库中没有正式记录，检查是否为当前用户上传的草稿文件（查数据库，不依赖 session）
      const uploadedRecord = await db.get(
        `SELECT id FROM user_uploaded_files WHERE user_id = ? AND file_path = ?`,
        userId, filePath
      )
      if (!uploadedRecord) {
        console.log('❌ 数据库未找到记录且非当前用户上传文件，拒绝访问')
        return res.status(403).json({ success: false, message: '无权访问此文件' })
      }
      console.log('✅ 匹配用户上传记录，允许草稿预览')
    }

    // 读取并返回文件
    const fullPath = path.resolve(process.cwd(), filePath)
    if (!fs.existsSync(fullPath)) {
      console.log('❌ 文件不存在 - 磁盘上没有文件')
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    console.log('✅ 文件访问成功，返回文件')
    res.sendFile(fullPath)
  } catch (error) {
    console.error('下载发票文件失败:', error)
    res.status(500).json({ success: false, message: '下载失败' })
  }
})

// 下载付款回单
router.get('/payment-proofs/:filename', requireAuth, async (req, res) => {
  try {
    const { filename } = req.params
    const userId = req.session.userId!

    const filePath = `uploads/invoices/${filename}`

    if (!validateFilePath(filePath)) {
      return res.status(403).json({ success: false, message: '非法文件路径' })
    }

    // 查询该回单是否属于当前用户的报销单或批量付款
    let proof = await db.get(
      `SELECT r.user_id, r.type
       FROM reimbursements r
       WHERE r.payment_proof_path LIKE ?`,
      `%${filename}%`
    )

    // 如果在 reimbursements 中没找到，查询 payment_batches 表
    if (!proof) {
      const batch = await db.get(
        `SELECT pb.payer_id as user_id
         FROM payment_batches pb
         WHERE pb.payment_proof_path LIKE ?`,
        `%${filename}%`
      )
      if (batch) {
        proof = { user_id: batch.user_id, type: 'batch' }
      }
    }

    if (!proof) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    // 检查权限：必须是文件所有者、管理员，或总经理（仅限商务报销）
    const user = await db.get('SELECT role FROM users WHERE id = ?', userId)
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'
    const isGMForBusiness = user?.role === 'general_manager' && proof.type === 'business'

    if (proof.user_id !== userId && !isAdmin && !isGMForBusiness) {
      return res.status(403).json({ success: false, message: '无权访问此文件' })
    }

    const fullPath = path.resolve(process.cwd(), filePath)
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    res.sendFile(fullPath)
  } catch (error) {
    console.error('下载付款回单失败:', error)
    res.status(500).json({ success: false, message: '下载失败' })
  }
})

// 下载银行回单图片
router.get('/bank-receipts/*', requireAuth, async (req, res) => {
  try {
    const subPath = (req.params as any)[0]
    const filePath = `uploads/bank-receipts/${subPath}`

    if (!validateFilePath(filePath)) {
      return res.status(403).json({ success: false, message: '非法文件路径' })
    }

    const userId = req.session.userId!
    const user = await db.get('SELECT role FROM users WHERE id = ?', userId)
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'general_manager'

    // 非管理员/总经理：检查该回单是否属于自己的报销单
    if (!isAdmin) {
      const ownedReimbursement = await db.get(
        `SELECT id FROM reimbursements WHERE payment_proof_path LIKE ? AND user_id = ? AND is_deleted = false`,
        `%${subPath}%`, userId,
      )
      if (!ownedReimbursement) {
        return res.status(403).json({ success: false, message: '无权访问' })
      }
    }

    const fullPath = path.resolve(process.cwd(), filePath)
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    res.sendFile(fullPath)
  } catch (error) {
    res.status(500).json({ success: false, message: '下载失败' })
  }
})

// 下载项目日志附件：按附件 id 查权限后返回文件
router.get('/worklog/:attachmentId', requireAuth, async (req, res) => {
  try {
    const { attachmentId } = req.params
    const userId = req.session.userId!

    const att = await db.get<{
      file_path: string
      mime_type: string | null
      file_name: string
      entry_user_id: string
    }>(
      `SELECT a.file_path, a.mime_type, a.file_name, e.user_id AS entry_user_id
       FROM worklog_attachments a
       JOIN worklog_entries e ON e.id = a.entry_id
       WHERE a.id = ?`,
      attachmentId,
    )
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' })

    if (!validateFilePath(att.file_path)) {
      return res.status(403).json({ success: false, message: '非法文件路径' })
    }

    if (att.entry_user_id !== userId && !(await isAdminLike(userId))) {
      return res.status(403).json({ success: false, message: '无权访问此附件' })
    }

    const fullPath = path.resolve(process.cwd(), att.file_path)
    if (!fs.existsSync(fullPath)) return res.status(404).json({ success: false, message: '文件不存在' })

    if (att.mime_type) res.setHeader('Content-Type', att.mime_type)
    res.sendFile(fullPath)
  } catch (err) {
    console.error('下载日志附件失败:', err)
    res.status(500).json({ success: false, message: '下载失败' })
  }
})

/**
 * 将 Office 文档转换为 PDF 并作为响应内联返回。失败时通过 res.status(500) 返回 JSON。
 */

/**
 * 项目日志附件在线预览：PDF 原样返回；Word/Excel/PPT 通过 libreoffice 转换为 PDF 后返回。
 * 其他类型回退为直接下载。
 */
router.get('/worklog/:attachmentId/preview', requireAuth, async (req, res) => {
  try {
    const { attachmentId } = req.params
    const userId = req.session.userId!

    const att = await db.get<{
      file_path: string
      mime_type: string | null
      file_name: string
      entry_user_id: string
    }>(
      `SELECT a.file_path, a.mime_type, a.file_name, e.user_id AS entry_user_id
       FROM worklog_attachments a
       JOIN worklog_entries e ON e.id = a.entry_id
       WHERE a.id = ?`,
      attachmentId,
    )
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' })
    if (!validateFilePath(att.file_path)) {
      return res.status(403).json({ success: false, message: '非法文件路径' })
    }
    if (att.entry_user_id !== userId && !(await isAdminLike(userId))) {
      return res.status(403).json({ success: false, message: '无权访问此附件' })
    }
    const fullPath = path.resolve(process.cwd(), att.file_path)
    if (!fs.existsSync(fullPath)) return res.status(404).json({ success: false, message: '文件不存在' })

    const ext = path.extname(att.file_name).toLowerCase().replace('.', '')

    if (ext === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.file_name)}"`)
      return res.sendFile(fullPath)
    }

    if (!CONVERTIBLE_EXT.includes(ext)) {
      if (att.mime_type) res.setHeader('Content-Type', att.mime_type)
      return res.sendFile(fullPath)
    }

    await sendConvertedPdf(res, fullPath, att.file_name)
  } catch (err) {
    console.error('预览日志附件失败:', err)
    res.status(500).json({ success: false, message: '预览失败' })
  }
})

/**
 * 尚未保存的日志附件临时预览：接收单个文件，转换为 PDF 流返回。
 * 仅在内存/临时目录中处理，不写入数据库。
 */
const tempPreviewUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-preview-in-'))
      cb(null, dir)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ''
      cb(null, `${nanoid(8)}${ext}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
})

router.post('/worklog-preview-temp', requireAuth, tempPreviewUpload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ success: false, message: '未上传文件' })
  const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
  const ext = path.extname(originalName).toLowerCase().replace('.', '')

  const cleanup = () => {
    try { fs.rmSync(path.dirname(file.path), { recursive: true, force: true }) } catch { /* ignore */ }
  }

  try {
    if (ext === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`)
      const stream = fs.createReadStream(file.path)
      stream.on('close', cleanup)
      return stream.pipe(res)
    }

    if (!CONVERTIBLE_EXT.includes(ext)) {
      cleanup()
      return res.status(400).json({ success: false, message: '不支持在线预览的文件格式' })
    }

    res.on('close', cleanup)
    await sendConvertedPdf(res, file.path, originalName)
  } catch (err) {
    cleanup()
    console.error('临时预览失败:', err)
    res.status(500).json({ success: false, message: '预览失败' })
  }
})

router.get('/worklog-contract/:attachmentId', requireAuth, async (req, res) => {
  try {
    const { attachmentId } = req.params
    const att = await db.get<{
      file_path: string
      mime_type: string | null
      file_name: string
    }>(
      `SELECT file_path, mime_type, file_name FROM worklog_contract_attachments WHERE id = ?`,
      attachmentId,
    )
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' })

    if (!validateFilePath(att.file_path)) {
      return res.status(403).json({ success: false, message: '非法文件路径' })
    }

    const fullPath = path.resolve(process.cwd(), att.file_path)
    if (!fs.existsSync(fullPath)) return res.status(404).json({ success: false, message: '文件不存在' })

    if (att.mime_type) res.setHeader('Content-Type', att.mime_type)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.file_name)}"`)
    res.sendFile(fullPath)
  } catch (err) {
    console.error('下载合同附件失败:', err)
    res.status(500).json({ success: false, message: '下载失败' })
  }
})

router.get('/worklog-contract/:attachmentId/preview', requireAuth, async (req, res) => {
  try {
    const { attachmentId } = req.params
    const att = await db.get<{
      file_path: string
      mime_type: string | null
      file_name: string
    }>(
      `SELECT file_path, mime_type, file_name FROM worklog_contract_attachments WHERE id = ?`,
      attachmentId,
    )
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' })
    if (!validateFilePath(att.file_path)) {
      return res.status(403).json({ success: false, message: '非法文件路径' })
    }
    const fullPath = path.resolve(process.cwd(), att.file_path)
    if (!fs.existsSync(fullPath)) return res.status(404).json({ success: false, message: '文件不存在' })

    const ext = path.extname(att.file_name).toLowerCase().replace('.', '')

    if (ext === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.file_name)}"`)
      return res.sendFile(fullPath)
    }

    if (!CONVERTIBLE_EXT.includes(ext)) {
      if (att.mime_type) res.setHeader('Content-Type', att.mime_type)
      return res.sendFile(fullPath)
    }

    await sendConvertedPdf(res, fullPath, att.file_name)
  } catch (err) {
    console.error('预览合同附件失败:', err)
    res.status(500).json({ success: false, message: '预览失败' })
  }
})

export default router
