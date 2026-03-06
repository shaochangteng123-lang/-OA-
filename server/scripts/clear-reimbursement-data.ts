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
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('🧹 开始清除报销测试数据...\n')

try {
  // 1. 获取所有发票文件路径
  console.log('📋 查询发票文件...')
  const invoices = db.prepare(`
    SELECT file_path FROM reimbursement_invoices
  `).all() as Array<{ file_path: string }>

  const paymentProofs = db.prepare(`
    SELECT payment_proof_path FROM reimbursements
    WHERE payment_proof_path IS NOT NULL
  `).all() as Array<{ payment_proof_path: string }>

  // 2. 删除发票文件
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

  // 3. 删除付款凭证文件
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

  // 4. 删除数据库记录（按依赖顺序）
  console.log('🗑️  清除数据库记录...')

  // 4.1 删除审批记录（依赖审批实例）
  const deletedApprovalRecords = db.prepare(`
    DELETE FROM approval_records
    WHERE instance_id IN (
      SELECT id FROM approval_instances
      WHERE target_type = 'reimbursement'
    )
  `).run()
  console.log(`  ✓ 删除 ${deletedApprovalRecords.changes} 条审批记录`)

  // 4.2 删除审批实例
  const deletedApprovalInstances = db.prepare(`
    DELETE FROM approval_instances
    WHERE target_type = 'reimbursement'
  `).run()
  console.log(`  ✓ 删除 ${deletedApprovalInstances.changes} 条审批实例`)

  // 4.3 删除发票明细（依赖报销单）
  const deletedInvoices = db.prepare(`
    DELETE FROM reimbursement_invoices
  `).run()
  console.log(`  ✓ 删除 ${deletedInvoices.changes} 条发票明细`)

  // 4.4 删除核减金额统计
  const deletedDeductions = db.prepare(`
    DELETE FROM reimbursement_deductions
  `).run()
  console.log(`  ✓ 删除 ${deletedDeductions.changes} 条核减金额统计`)

  // 4.5 删除报销单
  const deletedReimbursements = db.prepare(`
    DELETE FROM reimbursements
  `).run()
  console.log(`  ✓ 删除 ${deletedReimbursements.changes} 条报销单`)

  console.log('\n✅ 报销测试数据清除完成！')
  console.log('\n📊 清除统计：')
  console.log(`  - 报销单: ${deletedReimbursements.changes} 条`)
  console.log(`  - 发票明细: ${deletedInvoices.changes} 条`)
  console.log(`  - 核减统计: ${deletedDeductions.changes} 条`)
  console.log(`  - 审批实例: ${deletedApprovalInstances.changes} 条`)
  console.log(`  - 审批记录: ${deletedApprovalRecords.changes} 条`)
  console.log(`  - 文件: ${deletedFiles} 个`)

} catch (error) {
  console.error('❌ 清除数据失败:', error)
  process.exit(1)
}

process.exit(0)
