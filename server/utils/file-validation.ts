import path from 'path'

/**
 * 校验文件路径是否安全（防止目录遍历攻击）
 */
export function validateFilePath(filePath: string): boolean {
  if (!filePath) return false

  // 去掉前导斜杠（数据库中存的路径可能以 / 开头）
  const cleaned = filePath.startsWith('/') ? filePath.substring(1) : filePath
  const normalized = path.normalize(cleaned)

  // 不允许包含 ..
  if (normalized.includes('..')) {
    return false
  }

  // 必须以 uploads/ 开头
  if (!normalized.startsWith('uploads/')) {
    return false
  }

  // 验证解析后的绝对路径在 uploads 目录内
  const uploadsDir = path.join(process.cwd(), 'uploads')
  const resolved = path.resolve(process.cwd(), normalized)

  if (!resolved.startsWith(uploadsDir)) {
    return false
  }

  return true
}
