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
    // 1. 查询所有报销单的付款回单文件路径
    const paymentProofs = db.prepare(`
      SELECT payment_proof_path FROM reimbursements
      WHERE payment_proof_path IS NOT NULL AND payment_proof_path != ''
    `).all() as { payment_proof_path: string }[]

    console.log(`📄 找到 ${paymentProofs.length} 个付款回单文件`)

    // 2. 查询所有发票文件路径
    const invoices = db.prepare(`
      SELECT file_path FROM reimbursement_invoices
      WHERE file_path IS NOT NULL AND file_path != ''
    `).all() as { file_path: string }[]

    console.log(`📄 找到 ${invoices.length} 个发票文件`)

    // 3. 删除付款回单文件
    let deletedPaymentProofs = 0
    for (const proof of paymentProofs) {
      const filePath = path.join(process.cwd(), proof.payment_proof_path)
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          deletedPaymentProofs++
        }
      } catch (error) {
        console.warn(`⚠️  删除付款回单失败: ${filePath}`)
      }
    }
    console.log(`✅ 删除了 ${deletedPaymentProofs} 个付款回单文件`)

    // 4. 删除发票文件
    let deletedInvoices = 0
    for (const invoice of invoices) {
      const filePath = path.join(process.cwd(), invoice.file_path)
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          deletedInvoices++
        }
      } catch (error) {
        console.warn(`⚠️  删除发票失败: ${filePath}`)
      }
    }
    console.log(`✅ 删除了 ${deletedInvoices} 个发票文件`)

    // 5. 删除数据库记录（按照外键依赖顺序）
    console.log('\n🗑️  开始清除数据库记录...')

    // 删除审批记录
    const deletedRecords = db.prepare(`
      DELETE FROM approval_records
      WHERE instance_id IN (
        SELECT id FROM approval_instances WHERE target_type = 'reimbursement'
      )
    `).run()
    console.log(`✅ 删除了 ${deletedRecords.changes} 条审批记录`)

    // 删除审批实例
    const deletedInstances = db.prepare(`
      DELETE FROM approval_instances WHERE target_type = 'reimbursement'
    `).run()
    console.log(`✅ 删除了 ${deletedInstances.changes} 个审批实例`)

    // 删除发票记录
    const deletedInvoiceRecords = db.prepare(`
      DELETE FROM reimbursement_invoices
    `).run()
    console.log(`✅ 删除了 ${deletedInvoiceRecords.changes} 条发票记录`)

    // 删除报销单
    const deletedReimbursements = db.prepare(`
      DELETE FROM reimbursements
    `).run()
    console.log(`✅ 删除了 ${deletedReimbursements.changes} 条报销单记录`)

    console.log('\n🎉 报销测试数据清除完成！')
    console.log('=====================================')
    console.log('现在可以重新进行测试了')
    console.log('=====================================')

  } catch (error) {
    console.error('❌ 清除数据失败:', error)
    throw error
  }
}

clearReimbursementData()
