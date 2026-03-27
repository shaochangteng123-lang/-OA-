/**
 * 添加 payment_batch_id 外键约束
 *
 * 运行方式：
 * npx tsx server/scripts/add-payment-batch-fk.ts
 */

import { pool } from '../db/index.js'

async function addPaymentBatchFK() {
  const client = await pool.connect()

  try {
    console.log('开始添加 payment_batch_id 外键约束...')

    // 检查是否有孤儿引用
    const orphans = await client.query(`
      SELECT id, payment_batch_id
      FROM reimbursements
      WHERE payment_batch_id IS NOT NULL
      AND payment_batch_id NOT IN (SELECT id FROM payment_batches)
    `)

    if (orphans.rows.length > 0) {
      console.log(`⚠️  发现 ${orphans.rows.length} 条孤儿引用，正在清理...`)
      await client.query(`
        UPDATE reimbursements
        SET payment_batch_id = NULL
        WHERE payment_batch_id IS NOT NULL
        AND payment_batch_id NOT IN (SELECT id FROM payment_batches)
      `)
      console.log('✅ 孤儿引用已清理')
    }

    // 添加外键约束
    await client.query(`
      ALTER TABLE reimbursements
      ADD CONSTRAINT reimbursements_payment_batch_id_fkey
      FOREIGN KEY (payment_batch_id) REFERENCES payment_batches(id)
    `)

    console.log('✅ 成功添加 payment_batch_id 外键约束')

  } catch (error: any) {
    if (error.code === '42710') {
      console.log('⚠️  外键约束已存在，跳过')
    } else {
      console.error('❌ 添加外键约束失败:', error)
      throw error
    }
  } finally {
    client.release()
    await pool.end()
  }
}

void addPaymentBatchFK()
