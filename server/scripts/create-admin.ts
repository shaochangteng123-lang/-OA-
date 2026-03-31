#!/usr/bin/env npx tsx

/**
 * 创建初始管理员账号脚本
 *
 * 使用方法：
 * npm run create:admin
 *
 * 或者直接运行：
 * npx tsx server/scripts/create-admin.ts
 */

import 'dotenv/config'
import { db, initDatabase } from '../db/index.js'
import { nanoid } from 'nanoid'
import { hashPasswordSync, validatePasswordStrength, validateUsername } from '../utils/password.js'
import * as readline from 'readline'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim())
    })
  })
}

function questionHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt)

    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    stdin.setRawMode?.(true)
    stdin.resume()

    let password = ''

    const onData = (char: Buffer) => {
      const c = char.toString()

      switch (c) {
        case '\n':
        case '\r':
        case '\u0004': // Ctrl+D
          stdin.setRawMode?.(wasRaw)
          stdin.removeListener('data', onData)
          console.log()
          resolve(password)
          break
        case '\u0003': // Ctrl+C
          console.log('\n已取消')
          process.exit(0)
          break
        case '\u007F': // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1)
            process.stdout.write('\b \b')
          }
          break
        default:
          password += c
          process.stdout.write('*')
      }
    }

    stdin.on('data', onData)
  })
}

async function main() {
  console.log('\n========================================')
  console.log('       创建初始管理员账号')
  console.log('========================================\n')

  // 初始化数据库
  await initDatabase()

  // 检查是否已有超级管理员
  const existingAdmin = await db.prepare(
    "SELECT id, name, username FROM users WHERE role = 'super_admin' AND username IS NOT NULL"
  ).get() as { id: string; name: string; username: string } | undefined

  if (existingAdmin) {
    console.log('⚠️  系统中已存在超级管理员账号：')
    console.log(`   用户名: ${existingAdmin.username}`)
    console.log(`   显示名: ${existingAdmin.name}\n`)

    const proceed = await question('是否继续创建新的超级管理员账号？(y/N): ')
    if (proceed.toLowerCase() !== 'y') {
      console.log('\n已取消创建')
      rl.close()
      process.exit(0)
    }
    console.log()
  }

  // 获取用户名
  let username = ''
  while (true) {
    username = await question('请输入用户名（至少3个字符，仅字母数字下划线）: ')
    const validation = validateUsername(username)
    if (validation.valid) {
      // 检查是否已存在
      const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username)
      if (existing) {
        console.log('❌ 该用户名已被使用，请选择其他用户名\n')
        continue
      }
      break
    } else {
      console.log(`❌ ${validation.message}\n`)
    }
  }

  // 获取密码
  let password = ''
  while (true) {
    password = await questionHidden('请输入密码（至少6个字符）: ')
    const validation = validatePasswordStrength(password)
    if (!validation.valid) {
      console.log(`❌ ${validation.message}\n`)
      continue
    }

    const confirmPassword = await questionHidden('请确认密码: ')
    if (password !== confirmPassword) {
      console.log('❌ 两次输入的密码不一致，请重新输入\n')
      continue
    }
    break
  }

  // 获取显示名称
  const name = await question('请输入显示名称（留空则使用用户名）: ') || username

  // 确认创建
  console.log('\n----------------------------------------')
  console.log('请确认以下信息：')
  console.log(`  用户名: ${username}`)
  console.log(`  显示名: ${name}`)
  console.log(`  角色: super_admin（超级管理员）`)
  console.log('----------------------------------------\n')

  const confirm = await question('确认创建？(Y/n): ')
  if (confirm.toLowerCase() === 'n') {
    console.log('\n已取消创建')
    rl.close()
    process.exit(0)
  }

  // 创建账号
  try {
    const id = nanoid()
    const passwordHash = hashPasswordSync(password)
    const now = new Date().toISOString()

    await db.prepare(`
      INSERT INTO users (id, username, password_hash, name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'super_admin', 'active', ?, ?)
    `).run(id, username, passwordHash, name, now, now)

    console.log('\n========================================')
    console.log('✅ 管理员账号创建成功！')
    console.log('========================================')
    console.log(`  用户名: ${username}`)
    console.log(`  显示名: ${name}`)
    console.log(`  角色: super_admin（超级管理员）`)
    console.log('\n现在可以使用此账号登录系统了。\n')
  } catch (error) {
    console.error('\n❌ 创建失败:', error)
    rl.close()
    process.exit(1)
  }

  rl.close()
  process.exit(0)
}

main().catch((error) => {
  console.error('\n❌ 发生错误:', error)
  rl.close()
  process.exit(1)
})
