/**
 * 测试收据 OCR 性能
 * 用于对比优化前后的速度差异
 */

import { recognizeReceipt } from '../services/receiptOcr'
import path from 'path'
import fs from 'fs'

async function testPerformance() {
  console.log('🧪 开始测试收据 OCR 性能...\n')

  // 查找测试图片
  const uploadsDir = path.join(process.cwd(), 'uploads', 'invoices')

  if (!fs.existsSync(uploadsDir)) {
    console.error('❌ uploads/invoices 目录不存在')
    return
  }

  const files = fs.readdirSync(uploadsDir)
    .filter(f => f.startsWith('receipt-') && (f.endsWith('.png') || f.endsWith('.jpg')))
    .slice(0, 3) // 只测试前 3 张图片

  if (files.length === 0) {
    console.log('⚠️  没有找到测试图片（receipt-*.png/jpg）')
    console.log('请先上传一些支付截图进行测试')
    return
  }

  console.log(`📋 找到 ${files.length} 张测试图片\n`)

  const results: Array<{ file: string; time: number; success: boolean; amount?: number }> = []

  for (const file of files) {
    const filePath = path.join(uploadsDir, file)
    console.log(`\n${'='.repeat(60)}`)
    console.log(`📄 测试文件: ${file}`)
    console.log('='.repeat(60))

    const startTime = Date.now()

    try {
      const result = await recognizeReceipt(filePath)
      const endTime = Date.now()
      const duration = endTime - startTime

      console.log(`\n✅ 识别成功！`)
      console.log(`⏱️  耗时: ${duration}ms (${(duration / 1000).toFixed(2)}秒)`)
      console.log(`💰 金额: ${result.amount}`)
      console.log(`📅 日期: ${result.date}`)
      console.log(`🔢 交易单号: ${result.transactionNo}`)

      results.push({
        file,
        time: duration,
        success: true,
        amount: result.amount
      })
    } catch (error) {
      const endTime = Date.now()
      const duration = endTime - startTime

      console.log(`\n❌ 识别失败`)
      console.log(`⏱️  耗时: ${duration}ms`)
      console.log(`错误: ${error instanceof Error ? error.message : String(error)}`)

      results.push({
        file,
        time: duration,
        success: false
      })
    }
  }

  // 输出汇总统计
  console.log(`\n\n${'='.repeat(60)}`)
  console.log('📊 性能测试汇总')
  console.log('='.repeat(60))

  const successCount = results.filter(r => r.success).length
  const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length

  console.log(`\n总测试数: ${results.length}`)
  console.log(`成功数: ${successCount}`)
  console.log(`失败数: ${results.length - successCount}`)
  console.log(`平均耗时: ${avgTime.toFixed(0)}ms (${(avgTime / 1000).toFixed(2)}秒)`)

  if (successCount > 0) {
    const successTimes = results.filter(r => r.success).map(r => r.time)
    const avgSuccessTime = successTimes.reduce((a, b) => a + b, 0) / successTimes.length
    const minTime = Math.min(...successTimes)
    const maxTime = Math.max(...successTimes)

    console.log(`\n成功识别平均耗时: ${avgSuccessTime.toFixed(0)}ms`)
    console.log(`最快: ${minTime}ms`)
    console.log(`最慢: ${maxTime}ms`)
  }

  console.log('\n详细结果:')
  results.forEach((r, i) => {
    const status = r.success ? '✅' : '❌'
    const amount = r.success && r.amount ? ` (¥${r.amount})` : ''
    console.log(`  ${i + 1}. ${status} ${r.file}: ${r.time}ms${amount}`)
  })

  console.log('\n')
}

// 运行测试
testPerformance()
  .then(() => {
    console.log('✅ 测试完成')
    process.exit(0)
  })
  .catch(error => {
    console.error('❌ 测试失败:', error)
    process.exit(1)
  })
