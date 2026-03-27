/**
 * 添加审批实例状态枚举约束
 *
 * 运行方式：
 * npx tsx server/scripts/add-approval-status-constraint.ts
 */

import { pool } from '../db/index.js'

async function addApprovalStatusConstraint() {
  const client = await pool.connect()

  try {
    console.log('开始添加审批实例状态枚举约束...')

    // 检查当前数据库中使用的所有状态值
    const statusCheck = await client.query(`
      SELECT DISTINCT status FROM approval_instances
    `)
    console.log('当前数据库中的状态值:', statusCheck.rows.map(r => r.status))

    // 添加 CHECK 约束
    await client.query(`
      ALTER TABLE approval_instances
      ADD CONSTRAINT approval_instances_status_check
      CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled'))
    `)

    console.log('✅ 成功添加审批实例状态枚举约束')
    console.log('允许的状态值: pending, approved, rejected, withdrawn, cancelled')

  } catch (error: any) {
    if (error.code === '23514') {
      console.error('❌ 数据库中存在不符合约束的状态值')
      console.error('请先清理数据后再运行此脚本')
    } else if (error.code === '42710') {
      console.log('⚠️  约束已存在，跳过')
    } else {
      console.error('❌ 添加约束失败:', error)
      throw error
    }
  } finally {
    client.release()
    await pool.end()
  }
}

void addApprovalStatusConstraint()
