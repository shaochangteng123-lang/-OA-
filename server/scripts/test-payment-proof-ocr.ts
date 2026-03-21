/**
 * 测试付款回单OCR识别
 */

import { recognizePaymentProof } from '../services/paymentProofOcr.js'
import path from 'path'

async function testPaymentProofOcr() {
  console.log('🔍 开始测试付款回单OCR识别...\n')

  // 使用已存在的PDF文件
  const pdfPath = path.join(process.cwd(), 'uploads/invoices/invoice-1773804690157-26117000000202648656.pdf')

  try {
    const result = await recognizePaymentProof(pdfPath)

    console.log('\n✅ 识别成功！')
    console.log('=====================================')
    console.log('付款人:', result.payer)
    console.log('收款人:', result.payee)
    console.log('收款账号:', result.payeeAccount)
    console.log('金额:', result.amount)
    console.log('=====================================')
  } catch (error) {
    console.error('\n❌ 识别失败:', error)
    if (error instanceof Error) {
      console.error('错误信息:', error.message)
    }
  }
}

testPaymentProofOcr()
