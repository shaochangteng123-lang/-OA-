/**
 * 添加发票文件哈希唯一约束
 *
 * 运行方式：
 * npx tsx server/scripts/add-invoice-hash-unique.ts
 */

import { pool } from '../db/index.js'

async function addInvoiceHashUnique() {
  const client = await pool.connect()

  try {
    console.log('开始添加发票文件哈希唯一约束...')

    // 检查是否有重复的文件哈希
    const duplicates = await client.query(`
      SELECT file_hash, COUNT(*) as count
      FROM reimbursement_invoices
      WHERE file_hash IS NOT NULL
      GROUP BY file_hash
      HAVING COUNT(*) > 1
    `)

    if (duplicates.rows.length > 0) {
      console.log(`⚠️  发现 ${duplicates.rows.length} 个重复的文件哈希`)
      console.log('请先清理重复数据后再运行此脚本')
      return
    }

    // 添加唯一约束
    await client.query(`
      CREATE UNIQUE INDEX reimbursement_invoices_file_hash_unique
      ON reimbursement_invoices(file_hash)
      WHERE file_hash IS NOT NULL
    `)

    console.log('✅ 成功添加发票文件哈希唯一约束')

  } catch (error: any) {
    if (error.code === '42P07') {
      console.log('⚠️  唯一约束已存在，跳过')
    } else {
      console.error('❌ 添加唯一约束失败:', error)
      throw error
    }
  } finally {
    client.release()
    await pool.end()
  }
}

void addInvoiceHashUnique()
