#!/usr/bin/env tsx

/**
 * 清除离职测试数据脚本
 * 用于清空所有离职相关的数据，包括：
 * - 离职申请（resignation_requests）
 * - 离职文档附件（resignation_documents）
 * - 离职审计日志（resignation_audit_logs）
 * - 离职模板（resignation_templates）
 * - 上传的离职相关文件
 *
 * 注意：不会删除员工档案（employee_profiles）和用户（users）数据
 */

import { db } from '../db/index.js'
import fs from 'fs'
import path from 'path'

console.log('🧹 开始清除离职测试数据...\n')

async function main() {
  try {
    // 1. 先查询所有需要删除的文件路径
    console.log('📋 查询离职文档文件...')
    const documents = await db.prepare(`SELECT file_path FROM resignation_documents`).all() as Array<{ file_path: string }>
    const templates = await db.prepare(`SELECT file_path FROM resignation_templates`).all() as Array<{ file_path: string }>

    console.log(`  找到 ${documents.length} 个离职文档文件`)
    console.log(`  找到 ${templates.length} 个离职模板文件\n`)

    // 2. 删除磁盘文件
    console.log('📁 删除磁盘文件...')
    let deletedFiles = 0
    let failedFiles = 0

    for (const doc of documents) {
      const filePath = path.join(process.cwd(), doc.file_path)
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          deletedFiles++
        }
      } catch (error) {
        console.warn(`⚠️  删除文件失败: ${filePath}`, error)
        failedFiles++
      }
    }

    for (const tpl of templates) {
      const filePath = path.join(process.cwd(), tpl.file_path)
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          deletedFiles++
        }
      } catch (error) {
        console.warn(`⚠️  删除模板文件失败: ${filePath}`, error)
        failedFiles++
      }
    }

    console.log(`  ✅ 成功删除 ${deletedFiles} 个文件`)
    if (failedFiles > 0) {
      console.log(`  ⚠️  ${failedFiles} 个文件删除失败\n`)
    } else {
      console.log()
    }

    // 3. 清除数据库记录（按外键依赖顺序）
    console.log('🗑️  清除数据库记录...')

    let deletedAuditLogs = 0
    let deletedDocuments = 0
    let deletedRequests = 0
    let deletedTemplates = 0
    let resetEmployees = 0

    await db.transaction(async (client) => {
      // 第1步：删除审计日志（ON DELETE CASCADE，但显式删除更安全）
      const r1 = await client.query(`DELETE FROM resignation_audit_logs`)
      deletedAuditLogs = r1.rowCount ?? 0

      // 第2步：删除离职文档（ON DELETE CASCADE，显式删除）
      const r2 = await client.query(`DELETE FROM resignation_documents`)
      deletedDocuments = r2.rowCount ?? 0

      // 第3步：删除离职申请主表
      const r3 = await client.query(`DELETE FROM resignation_requests`)
      deletedRequests = r3.rowCount ?? 0

      // 第4步：删除离职模板（独立表，无外键依赖）
      const r4 = await client.query(`DELETE FROM resignation_templates`)
      deletedTemplates = r4.rowCount ?? 0

      // 第5步：将所有 resigned 状态的员工档案重置为 active
      const r5 = await client.query(`
        UPDATE employee_profiles SET employment_status = 'active', updated_at = NOW()::TEXT
        WHERE employment_status = 'resigned'
      `)
      resetEmployees = r5.rowCount ?? 0
    })

    console.log(`  ✓ 删除 ${deletedAuditLogs} 条审计日志`)
    console.log(`  ✓ 删除 ${deletedDocuments} 条离职文档记录`)
    console.log(`  ✓ 删除 ${deletedRequests} 条离职申请`)
    console.log(`  ✓ 删除 ${deletedTemplates} 条离职模板`)
    console.log(`  ✓ 重置 ${resetEmployees} 名员工状态为在职（active）`)

    console.log('\n✅ 离职测试数据清除完成！')
    console.log('\n📊 清除统计：')
    console.log(`  - 离职申请: ${deletedRequests} 条`)
    console.log(`  - 离职文档: ${deletedDocuments} 条`)
    console.log(`  - 审计日志: ${deletedAuditLogs} 条`)
    console.log(`  - 离职模板: ${deletedTemplates} 条`)
    console.log(`  - 磁盘文件: ${deletedFiles} 个`)
    console.log(`  - 员工状态重置为在职: ${resetEmployees} 名`)
  } catch (error) {
    console.error('❌ 清除数据失败:', error)
    process.exit(1)
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('❌ 发生错误:', error)
  process.exit(1)
})
