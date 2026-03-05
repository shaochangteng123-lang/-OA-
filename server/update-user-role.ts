import { db } from './db/index.js'
import type { UserRow } from './types/database.js'

// 从命令行参数获取用户ID，如果没有提供则使用默认值
const userId = process.argv[2] || '512390'
const newRole = process.argv[3] || 'super_admin'

type UserListItem = Pick<
  UserRow,
  'id' | 'feishu_open_id' | 'name' | 'email' | 'role' | 'last_login_at'
>
type UserDetailItem = Pick<UserRow, 'id' | 'name' | 'email' | 'role'>

try {
  // 首先列出所有用户
  console.log('数据库中所有用户:')
  const allUsers = db
    .prepare(
      'SELECT id, feishu_open_id, name, email, role, last_login_at FROM users ORDER BY last_login_at DESC'
    )
    .all() as UserListItem[]
  if (allUsers.length === 0) {
    console.log('  数据库中没有用户')
  } else {
    allUsers.forEach((u) => {
      console.log(`  ID: ${u.id}`)
      console.log(`  飞书OpenID: ${u.feishu_open_id}`)
      console.log(`  姓名: ${u.name}`)
      console.log(`  邮箱: ${u.email || '无'}`)
      console.log(`  角色: ${u.role}`)
      console.log(`  最后登录: ${u.last_login_at || '从未登录'}`)
      console.log('  ---')
    })
  }

  // 检查用户活动日志
  console.log('\n最近的登录活动:')
  interface LoginActivity {
    user_id: string
    name: string | null
    action: string
    timestamp: string
  }
  const recentLogins = db
    .prepare(
      `
    SELECT ua.user_id, u.name, ua.action, ua.timestamp
    FROM user_activities ua
    LEFT JOIN users u ON ua.user_id = u.id
    WHERE ua.action = 'LOGIN'
    ORDER BY ua.timestamp DESC
    LIMIT 10
  `
    )
    .all() as LoginActivity[]

  if (recentLogins.length === 0) {
    console.log('  无登录记录')
  } else {
    recentLogins.forEach((log) => {
      console.log(`  用户ID: ${log.user_id}, 姓名: ${log.name || '未知'}, 时间: ${log.timestamp}`)
    })
  }
  console.log('')

  // 尝试通过ID或飞书OpenID查找用户
  let user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId) as
    | UserDetailItem
    | undefined

  if (!user) {
    // 尝试通过飞书OpenID查找
    user = db
      .prepare('SELECT id, name, email, role FROM users WHERE feishu_open_id = ?')
      .get(userId) as UserDetailItem | undefined
  }

  if (!user) {
    console.log(`❌ 用户 ${userId} 不存在`)
    console.log(`提示: 请使用上面列出的用户ID或飞书OpenID`)
    process.exit(1)
  }

  console.log('当前用户信息:')
  console.log(`  ID: ${user.id}`)
  console.log(`  姓名: ${user.name}`)
  console.log(`  邮箱: ${user.email}`)
  console.log(`  当前角色: ${user.role}`)
  console.log('')

  // 更新角色
  const now = new Date().toISOString()
  const result = db
    .prepare(
      `
    UPDATE users
    SET role = ?, updated_at = ?
    WHERE id = ?
  `
    )
    .run(newRole, now, userId)

  if (result.changes > 0) {
    console.log(`✅ 成功将用户 ${userId} 的角色更新为: ${newRole}`)

    // 验证更新
    const updatedUser = db
      .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
      .get(userId) as UserDetailItem | undefined

    if (updatedUser) {
      console.log('')
      console.log('更新后的用户信息:')
      console.log(`  ID: ${updatedUser.id}`)
      console.log(`  姓名: ${updatedUser.name}`)
      console.log(`  邮箱: ${updatedUser.email}`)
      console.log(`  新角色: ${updatedUser.role}`)
    }
  } else {
    console.log(`❌ 更新失败`)
  }
} catch (error) {
  console.error('错误:', error)
  process.exit(1)
} finally {
  db.close()
}
