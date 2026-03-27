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

  const match = filePath.match(/(?:\/?)uploads\/invoices\/(.+)/)
  if (match) {
    const filename = match[1]
    // 付款回单文件（包含 payment-proof- 或 payment-proof-batch- 前缀）映射到专用端点
    if (filename.startsWith('payment-proof-') || filename.startsWith('payment-proof-batch-')) {
      return `/api/files/payment-proofs/${filename}`
    }
    // 普通发票文件映射到发票端点
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
