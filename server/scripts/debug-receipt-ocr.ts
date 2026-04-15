#!/usr/bin/env tsx

/**
 * 调试支付截图 OCR 识别
 * 用法：npx tsx server/scripts/debug-receipt-ocr.ts [图片路径]
 */

import { recognizeReceipt } from '../services/receiptOcr.js'
import path from 'path'

const imagePath = process.argv[2] || './uploads/invoices/receipt-1776255542429-3元.png'
const absPath = path.isAbsolute(imagePath) ? imagePath : path.join(process.cwd(), imagePath)

console.log('🔍 调试 OCR 识别...')
console.log('📄 图片路径:', absPath)
console.log('')

try {
  const result = await recognizeReceipt(absPath)
  console.log('\n========== 识别结果 ==========')
  console.log('💰 金额:', result.amount)
  console.log('📅 日期:', result.date)
  console.log('🔢 交易单号:', result.transactionNo)
  console.log('📝 商品名称:', result.itemName)
  console.log('\n📄 原始文本:')
  console.log(result.rawText)
  console.log('================================')
  process.exit(0)
} catch (error: any) {
  console.error('❌ 识别失败:', error.message)
  process.exit(1)
}
