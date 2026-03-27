import express from 'express'
import path from 'path'
import fs from 'fs'
import { requireAuth } from '../middleware/auth.js'
import { validateFilePath } from '../utils/file-validation.js'
import { db } from '../db/index.js'

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
    const invoice = await db.get(
      `SELECT r.user_id, r.id as reimbursement_id
       FROM reimbursement_invoices ri
       JOIN reimbursements r ON ri.reimbursement_id = r.id
       WHERE ri.file_path = ? OR ri.file_path = ?`,
      filePath,
      '/' + filePath
    )

    if (!invoice) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    // 检查权限：必须是文件所有者或管理员
    const user = await db.get('SELECT role FROM users WHERE id = ?', userId)
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'

    if (invoice.user_id !== userId && !isAdmin) {
      return res.status(403).json({ success: false, message: '无权访问此文件' })
    }

    // 读取文件
    const fullPath = path.resolve(process.cwd(), filePath)
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

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

    // 查询该回单是否属于当前用户的报销单
    const proof = await db.get(
      `SELECT r.user_id
       FROM reimbursements r
       WHERE r.payment_proof_path LIKE ?`,
      `%${filename}%`
    )

    if (!proof) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    // 检查权限
    const user = await db.get('SELECT role FROM users WHERE id = ?', userId)
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'

    if (proof.user_id !== userId && !isAdmin) {
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

export default router
