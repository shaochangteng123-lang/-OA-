/**
 * 为现有发票文件回填 file_hash
 * 用于数据库迁移：为已上传的发票计算 SHA256 哈希值
 */
import { db } from '../db/index.js'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

interface Invoice {
  id: string
  file_path: string
  file_hash: string | null
}

async function backfillFileHash() {
  console.log('🔄 开始为现有发票文件回填 file_hash...\n')

  // 获取所有没有 file_hash 的发票记录
  const invoices = await db.prepare(`
    SELECT id, file_path, file_hash
    FROM reimbursement_invoices
    WHERE file_hash IS NULL OR file_hash = ''
  `).all() as Invoice[]

  console.log(`📊 找到 ${invoices.length} 条需要回填的记录\n`)

  if (invoices.length === 0) {
    console.log('✅ 所有发票已有 file_hash，无需回填')
    return
  }

  const uploadsDir = path.join(process.cwd(), 'uploads')
  let successCount = 0
  let skipCount = 0
  let errorCount = 0

  for (const invoice of invoices) {
    try {
      // 构建文件完整路径
      const filePath = invoice.file_path.startsWith('/uploads/')
        ? path.join(process.cwd(), invoice.file_path.substring(1))
        : path.join(uploadsDir, invoice.file_path)

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        console.log(`⚠️  文件不存在，跳过: ${invoice.file_path}`)
        skipCount++
        continue
      }

      // 计算文件哈希
      const fileBuffer = fs.readFileSync(filePath)
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')

      // 更新数据库
      await db.prepare(`
        UPDATE reimbursement_invoices
        SET file_hash = ?
        WHERE id = ?
      `).run(fileHash, invoice.id)

      console.log(`✅ ${invoice.file_path} → ${fileHash.substring(0, 16)}...`)
      successCount++
    } catch (error) {
      console.error(`❌ 处理失败: ${invoice.file_path}`, error)
      errorCount++
    }
  }

  console.log('\n📈 回填完成:')
  console.log(`   ✅ 成功: ${successCount}`)
  console.log(`   ⚠️  跳过: ${skipCount}`)
  console.log(`   ❌ 失败: ${errorCount}`)
}

// 执行回填
backfillFileHash().catch(error => {
  console.error('❌ 回填失败:', error)
  process.exit(1)
})
