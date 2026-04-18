#!/usr/bin/env tsx

/**
 * 清除报销测试数据脚本
 * 用于清空所有报销相关的数据，包括：
 * - 报销单
 * - 发票明细
 * - 核减金额统计
 * - 报销相关的审批实例和记录
 * - 上传的发票文件
 */

import { db } from '../db/index.js'
import fs from 'fs'
import path from 'path'

console.log('🧹 开始清除报销测试数据...\n')

async function main() {
  try {
    console.log('📋 查询发票文件...')
    const invoices = await db.prepare(`SELECT file_path FROM reimbursement_invoices`).all() as Array<{ file_path: string }>
    const paymentProofs = await db.prepare(`
      SELECT payment_proof_path FROM reimbursements
      WHERE payment_proof_path IS NOT NULL
    `).all() as Array<{ payment_proof_path: string }>

    console.log(`📁 删除 ${invoices.length} 个发票文件...`)
    let deletedFiles = 0
    for (const invoice of invoices) {
      const filePath = path.join(process.cwd(), invoice.file_path)
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          deletedFiles++
        }
      } catch (error) {
        console.warn(`⚠️  删除文件失败: ${filePath}`, error)
      }
    }

    console.log(`📁 删除 ${paymentProofs.length} 个付款凭证文件...`)
    for (const proof of paymentProofs) {
      const filePath = path.join(process.cwd(), proof.payment_proof_path)
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          deletedFiles++
        }
      } catch (error) {
        console.warn(`⚠️  删除文件失败: ${filePath}`, error)
      }
    }

    console.log(`✅ 成功删除 ${deletedFiles} 个文件\n`)
    console.log('🗑️  清除数据库记录...')

    let deletedApprovalRecords = 0
    let deletedApprovalInstances = 0
    let deletedInvoices = 0
    let deletedDeductions = 0
    let deletedReimbursements = 0

    let deletedBatchItems = 0
    let deletedBatches = 0
    let deletedBankReceipts = 0

    await db.transaction(async (client) => {
      // 先删除审批记录
      const r1 = await client.query(`
        DELETE FROM approval_records
        WHERE instance_id IN (
          SELECT id FROM approval_instances
          WHERE target_type = 'reimbursement'
        )
      `)
      deletedApprovalRecords = r1.rowCount ?? 0

      // 删除审批实例
      const r2 = await client.query(`
        DELETE FROM approval_instances
        WHERE target_type = 'reimbursement'
      `)
      deletedApprovalInstances = r2.rowCount ?? 0

      // 删除发票明细
      const r3 = await client.query(`DELETE FROM reimbursement_invoices`)
      deletedInvoices = r3.rowCount ?? 0

      // 删除核减统计
      const r4 = await client.query(`DELETE FROM reimbursement_deductions`)
      deletedDeductions = r4.rowCount ?? 0

      // 删除批量付款项目（引用 reimbursements）
      const r5 = await client.query(`DELETE FROM payment_batch_items`)
      deletedBatchItems = r5.rowCount ?? 0

      // 删除所有银行回单
      const r8 = await client.query(`DELETE FROM bank_receipts`)
      deletedBankReceipts = r8.rowCount ?? 0

      // 删除报销单（引用 payment_batches）
      const r6 = await client.query(`DELETE FROM reimbursements`)
      deletedReimbursements = r6.rowCount ?? 0

      // 最后删除批量付款
      const r7 = await client.query(`DELETE FROM payment_batches`)
      deletedBatches = r7.rowCount ?? 0
    })

    console.log(`  ✓ 删除 ${deletedApprovalRecords} 条审批记录`)
    console.log(`  ✓ 删除 ${deletedApprovalInstances} 条审批实例`)
    console.log(`  ✓ 删除 ${deletedInvoices} 条发票明细`)
    console.log(`  ✓ 删除 ${deletedDeductions} 条核减金额统计`)
    console.log(`  ✓ 删除 ${deletedBatchItems} 条批量付款项目`)
    console.log(`  ✓ 删除 ${deletedBankReceipts} 条银行回单`)
    console.log(`  ✓ 删除 ${deletedBatches} 条批量付款`)
    console.log(`  ✓ 删除 ${deletedReimbursements} 条报销单`)

    console.log('\n✅ 报销测试数据清除完成！')
    console.log('\n📊 清除统计：')
    console.log(`  - 报销单: ${deletedReimbursements} 条`)
    console.log(`  - 发票明细: ${deletedInvoices} 条`)
    console.log(`  - 核减统计: ${deletedDeductions} 条`)
    console.log(`  - 批量付款项目: ${deletedBatchItems} 条`)
    console.log(`  - 批量付款: ${deletedBatches} 条`)
    console.log(`  - 审批实例: ${deletedApprovalInstances} 条`)
    console.log(`  - 审批记录: ${deletedApprovalRecords} 条`)
    console.log(`  - 文件: ${deletedFiles} 个`)
  } catch (error) {
    console.error('❌ 清除数据失败:', error)
    process.exit(1)
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('❌ 发生错误:', error)
  process.exit(1)
})
