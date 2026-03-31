import { db } from './db/index.js'
import { nanoid } from 'nanoid'
import type { UserRow } from './types/database.js'

const feishuOpenId = '512390'
const userName = '用户512390'

async function main() {
  try {
    // 检查用户是否已存在
    const existingUser = await db
      .prepare('SELECT id FROM users WHERE feishu_open_id = ?')
      .get(feishuOpenId) as Pick<UserRow, 'id'> | undefined

    if (existingUser) {
      console.log(`✅ 用户 ${feishuOpenId} 已存在`)
      console.log(`   用户ID: ${existingUser.id}`)
    } else {
      // 创建新用户
      const userId = nanoid()
      const now = new Date().toISOString()

      await db.prepare(
        `
        INSERT INTO users (
          id, feishu_open_id, feishu_union_id, name, email, mobile, avatar_url,
          role, status, created_at, updated_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        userId,
        feishuOpenId,
        null,
        userName,
        null,
        null,
        null,
        'super_admin', // 直接设置为超级管理员
        'active',
        now,
        now,
        now
      )

      console.log(`✅ 成功创建用户 ${feishuOpenId}`)
      console.log(`   用户ID: ${userId}`)
      console.log(`   姓名: ${userName}`)
      console.log(`   角色: super_admin`)

      // 记录创建活动
      await db.prepare(
        `
        INSERT INTO user_activities (id, user_id, action, description, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(nanoid(), userId, 'CREATE', '创建超级管理员用户', now)
    }

    // 显示用户信息
    const user = await db
      .prepare('SELECT id, name, feishu_open_id, role FROM users WHERE feishu_open_id = ?')
      .get(feishuOpenId) as Pick<UserRow, 'id' | 'name' | 'feishu_open_id' | 'role'> | undefined

    if (user) {
      console.log('\n当前用户信息:')
      console.log(`  用户ID: ${user.id}`)
      console.log(`  飞书OpenID: ${user.feishu_open_id}`)
      console.log(`  姓名: ${user.name}`)
      console.log(`  角色: ${user.role}`)
    }
  } catch (error) {
    console.error('错误:', error)
    process.exit(1)
  }
}

main().then(() => {
  process.exit(0)
}).catch((error) => {
  console.error('错误:', error)
  process.exit(1)
})
