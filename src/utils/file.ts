/**
 * 将服务端存储的文件路径转换为可访问的 API URL
 * 支持以下格式：
 *   uploads/invoices/payment-proof-xxx.png   -> /api/files/payment-proofs/payment-proof-xxx.png
 *   uploads/invoices/xxx.pdf                 -> /api/files/invoices/xxx.pdf
 *   /uploads/invoices/xxx.pdf                -> /api/files/invoices/xxx.pdf
 *   /api/files/invoices/xxx                  -> 原样返回
 *   http(s)://...                            -> 原样返回
 */
export function toFileUrl(filePath: string): string {
  if (!filePath) return ''
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath
  if (filePath.startsWith('/api/files/')) return filePath

  // 银行回单图片
  const bankMatch = filePath.match(/(?:\/?)uploads\/bank-receipts\/(.+)/)
  if (bankMatch) return `/api/files/bank-receipts/${bankMatch[1]}`

  const match = filePath.match(/(?:\/?)uploads\/invoices\/(.+)/)
  if (match) {
    const filename = match[1]
    if (filename.startsWith('payment-proof-') || filename.startsWith('payment-proof-batch-')) {
      return `/api/files/payment-proofs/${filename}`
    }
    return `/api/files/invoices/${filename}`
  }

  if (filePath.startsWith('/')) return filePath
  return `/api/${filePath}`
}

/**
 * 判断文件路径是否为图片文件
 */
export function isImageFile(filePath: string): boolean {
  if (!filePath) return false
  const lower = filePath.toLowerCase()
  return (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.bmp') ||
    lower.endsWith('.webp') ||
    lower.includes('receipt-')
  )
}
