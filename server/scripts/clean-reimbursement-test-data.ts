import { db } from '../db/index.js'
import fs from 'fs'
import path from 'path'

/**
 * 清除报销测试数据脚本
 * 包括：报销单、发票明细、审批记录、核减统计、上传的发票文件
 */

console.log('🧹 开始清除报销测试数据...\n')

// 1. 获取所有发票文件路径
const invoices = db.prepare(`
  SELECT file_path FROM reimbursement_invoices
`).all() as { file_path: string }[]

console.log(`📄 找到 ${invoices.length} 个发票文件`)

// 2. 获取所有支付凭证路径
const paymentProofs = db.prepare(`
  SELECT payment_proof_path FROM reimbursements
  WHERE payment_proof_path IS NOT NULL AND payment_proof_path != ''
`).all() as { payment_proof_path: string }[]

console.log(`💳 找到 ${paymentProofs.length} 个支付凭证文件`)

// 3. 删除数据库记录（按依赖顺序）
try {
  db.exec('BEGIN TRANSACTION')

  // 删除审批记录
  const approvalRecordsResult = db.prepare(`
    DELETE FROM approval_records
    WHERE instance_id IN (
      SELECT id FROM approval_instances WHERE target_type = 'reimbursement'
    )
  `).run()
  console.log(`✅ 删除 ${approvalRecordsResult.changes} 条审批记录`)

  // 删除审批实例
  const approvalInstancesResult = db.prepare(`
    DELETE FROM approval_instances WHERE target_type = 'reimbursement'
  `).run()
  console.log(`✅ 删除 ${approvalInstancesResult.changes} 条审批实例`)

  // 删除发票明细
  const invoicesResult = db.prepare(`
    DELETE FROM reimbursement_invoices
  `).run()
  console.log(`✅ 删除 ${invoicesResult.changes} 条发票明细`)

  // 删除核减统计
  const deductionsResult = db.prepare(`
    DELETE FROM reimbursement_deductions
  `).run()
  console.log(`✅ 删除 ${deductionsResult.changes} 条核减统计`)

  // 删除报销单
  const reimbursementsResult = db.prepare(`
    DELETE FROM reimbursements
  `).run()
  console.log(`✅ 删除 ${reimbursementsResult.changes} 条报销单`)

  db.exec('COMMIT')
  console.log('✅ 数据库记录清除完成\n')
} catch (error) {
  db.exec('ROLLBACK')
  console.error('❌ 数据库清除失败:', error)
  process.exit(1)
}

// 4. 删除上传的文件
const uploadsDir = path.join(process.cwd(), 'uploads', 'invoices')
let deletedFiles = 0
let failedFiles = 0

console.log(`📂 清理目录: ${uploadsDir}\n`)

// 删除发票文件
for (const invoice of invoices) {
  const filePath = path.join(process.cwd(), invoice.file_path)
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      deletedFiles++
      console.log(`🗑️  删除: ${path.basename(filePath)}`)
    }
  } catch (error) {
    failedFiles++
    console.error(`❌ 删除失败: ${filePath}`, error)
  }
}

// 删除支付凭证文件
for (const proof of paymentProofs) {
  const filePath = path.join(process.cwd(), proof.payment_proof_path)
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      deletedFiles++
      console.log(`🗑️  删除: ${path.basename(filePath)}`)
    }
  } catch (error) {
    failedFiles++
    console.error(`❌ 删除失败: ${filePath}`, error)
  }
}

console.log(`\n📊 文件清理统计:`)
console.log(`   ✅ 成功删除: ${deletedFiles} 个文件`)
if (failedFiles > 0) {
  console.log(`   ❌ 删除失败: ${failedFiles} 个文件`)
}

console.log('\n🎉 报销测试数据清除完成！')
