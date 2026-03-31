/**
 * 清除报销测试数据
 * 用于测试环境数据清理
 */

import { db } from '../db/index.js'
import fs from 'fs'
import path from 'path'

async function clearReimbursementData() {
  console.log('🔍 开始清除报销测试数据...\n')

  try {
    const paymentProofs = await db.prepare(`
      SELECT payment_proof_path FROM reimbursements
      WHERE payment_proof_path IS NOT NULL AND payment_proof_path != ''
    `).all() as { payment_proof_path: string }[]

    console.log(`📄 找到 ${paymentProofs.length} 个付款回单文件`)

    const invoices = await db.prepare(`
      SELECT file_path FROM reimbursement_invoices
      WHERE file_path IS NOT NULL AND file_path != ''
    `).all() as { file_path: string }[]

    console.log(`📄 找到 ${invoices.length} 个发票文件`)

    let deletedPaymentProofs = 0
    for (const proof of paymentProofs) {
      const filePath = path.join(process.cwd(), proof.payment_proof_path)
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          deletedPaymentProofs++
        }
      } catch {
        console.warn(`⚠️  删除付款回单失败: ${filePath}`)
      }
    }
    console.log(`✅ 删除了 ${deletedPaymentProofs} 个付款回单文件`)

    let deletedInvoiceFiles = 0
    for (const invoice of invoices) {
      const filePath = path.join(process.cwd(), invoice.file_path)
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          deletedInvoiceFiles++
        }
      } catch {
        console.warn(`⚠️  删除发票失败: ${filePath}`)
      }
    }
    console.log(`✅ 删除了 ${deletedInvoiceFiles} 个发票文件`)

    console.log('\n🗑️  开始清除数据库记录...')

    const deletedRecords = await db.prepare(`
      DELETE FROM approval_records
      WHERE instance_id IN (
        SELECT id FROM approval_instances WHERE target_type = 'reimbursement'
      )
    `).run()
    console.log(`✅ 删除了 ${deletedRecords.changes} 条审批记录`)

    const deletedInstances = await db.prepare(`
      DELETE FROM approval_instances WHERE target_type = 'reimbursement'
    `).run()
    console.log(`✅ 删除了 ${deletedInstances.changes} 个审批实例`)

    const deletedInvoiceRecords = await db.prepare(`
      DELETE FROM reimbursement_invoices
    `).run()
    console.log(`✅ 删除了 ${deletedInvoiceRecords.changes} 条发票记录`)

    const deletedReimbursements = await db.prepare(`
      DELETE FROM reimbursements
    `).run()
    console.log(`✅ 删除了 ${deletedReimbursements.changes} 条报销单记录`)

    console.log('\n🎉 报销测试数据清除完成！')
  } catch (error) {
    console.error('❌ 清除数据失败:', error)
    throw error
  }
}

clearReimbursementData().then(() => process.exit(0)).catch(() => process.exit(1))
