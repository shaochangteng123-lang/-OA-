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
      // 数据库中没有记录，可能是草稿状态的报销单
      // 检查文件是否存在于磁盘上（允许用户预览自己刚上传的文件）
      console.log('⚠️ 数据库中未找到记录，检查文件是否存在于磁盘')
      const fullPath = path.resolve(process.cwd(), filePath)
      if (!fs.existsSync(fullPath)) {
        console.log('❌ 文件不存在 - 磁盘上也没有')
        return res.status(404).json({ success: false, message: '文件不存在' })
      }
      console.log('✅ 文件存在于磁盘，允许预览（草稿状态）')
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

    // 查询该回单是否属于当前用户的报销单
    const proof = await db.get(
      `SELECT r.user_id, r.type
       FROM reimbursements r
       WHERE r.payment_proof_path LIKE ?`,
      `%${filename}%`
    )

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

export default router
