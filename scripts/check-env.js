#!/usr/bin/env node
/**
 * 环境变量安全检查脚本
 * 用于验证生产环境配置是否安全
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 加载环境变量
dotenv.config({ path: join(__dirname, '..', '.env') })

const errors = []
const warnings = []

console.log('🔍 检查环境变量配置...\n')

// 1. 检查 SESSION_SECRET
const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) {
  errors.push('❌ SESSION_SECRET 未设置！必须设置会话加密密钥')
} else if (sessionSecret.includes('change_me') || sessionSecret.includes('yulilog')) {
  warnings.push('⚠️  SESSION_SECRET 使用默认值，生产环境必须修改为强随机密钥')
} else if (sessionSecret.length < 32) {
  warnings.push('⚠️  SESSION_SECRET 长度过短，建议至少 32 字符')
}

// 2. 检查飞书配置
if (!process.env.FEISHU_APP_ID || process.env.FEISHU_APP_ID === 'your_feishu_app_id_here') {
  errors.push('❌ FEISHU_APP_ID 未正确设置')
}
if (
  !process.env.FEISHU_APP_SECRET ||
  process.env.FEISHU_APP_SECRET === 'your_feishu_app_secret_here'
) {
  errors.push('❌ FEISHU_APP_SECRET 未正确设置')
}
if (!process.env.FEISHU_REDIRECT_URI) {
  warnings.push('⚠️  FEISHU_REDIRECT_URI 未设置，将使用默认值')
}

// 3. 检查 NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'development'
console.log(`📌 运行环境: ${nodeEnv}`)

if (nodeEnv === 'production') {
  // 生产环境额外检查
  if (sessionSecret && sessionSecret.includes('change_me')) {
    errors.push('❌ 生产环境禁止使用默认 SESSION_SECRET')
  }

  if (!process.env.FRONTEND_URL) {
    warnings.push('⚠️  生产环境建议设置 FRONTEND_URL 明确前端地址')
  }
}

// 4. 检查数据库路径
const dbPath = process.env.DATABASE_PATH || './data/worklog.db'
console.log(`📊 数据库路径: ${dbPath}`)

// 输出结果
console.log('\n' + '='.repeat(60))
if (errors.length === 0 && warnings.length === 0) {
  console.log('✅ 环境变量配置检查通过！')
} else {
  if (errors.length > 0) {
    console.log('\n❌ 发现严重错误:')
    errors.forEach((err) => console.log(`   ${err}`))
  }

  if (warnings.length > 0) {
    console.log('\n⚠️  警告信息:')
    warnings.forEach((warn) => console.log(`   ${warn}`))
  }

  if (errors.length > 0) {
    console.log('\n💡 修复建议:')
    console.log('   1. 复制 .env.example 为 .env')
    console.log('   2. 生成强随机密钥:')
    console.log('      node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
    console.log('   3. 在 .env 中设置 SESSION_SECRET 为生成的密钥')
    console.log('   4. 配置飞书应用 ID 和 Secret')
    process.exit(1)
  }
}
console.log('='.repeat(60) + '\n')
