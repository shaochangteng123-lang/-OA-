import fs from 'fs'
import path from 'path'

export interface UploadDateParts {
  year: string
  month: string
  day: string
}

/**
 * 按中国时区取得上传日期，避免服务器时区不同导致文件跨日归档。
 */
export function getUploadDateParts(uploadedAt: Date = new Date()): UploadDateParts {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(uploadedAt)

  const values = new Map(parts.map(part => [part.type, part.value]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')

  if (!year || !month || !day) {
    throw new Error('无法确定上传日期')
  }

  return { year, month, day }
}

/**
 * 创建“业务类别/年/月/日/附加目录”结构并返回绝对路径。
 */
export function ensureDatedUploadDirectory(
  category: string,
  uploadedAt: Date = new Date(),
  ...subdirectories: string[]
): string {
  const { year, month, day } = getUploadDateParts(uploadedAt)
  const directory = path.resolve(
    process.cwd(),
    'uploads',
    category,
    year,
    month,
    day,
    ...subdirectories,
  )

  fs.mkdirSync(directory, { recursive: true })
  return directory
}

/**
 * 将磁盘绝对路径转换为数据库使用的 uploads 相对路径。
 */
export function toStoredUploadPath(filePath: string, leadingSlash = false): string {
  const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/')
  if (!relativePath.startsWith('uploads/')) {
    throw new Error('文件不在上传目录内')
  }

  return leadingSlash ? `/${relativePath}` : relativePath
}
