import fs from 'fs'
import path from 'path'

export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const PDF_MIME_TYPE = 'application/pdf'

export type ResignationTemplateFileKind = 'docx' | 'pdf'

function startsWithBytes(filePath: string, expected: Buffer): boolean {
  try {
    const descriptor = fs.openSync(filePath, 'r')
    try {
      const header = Buffer.alloc(expected.length)
      return fs.readSync(descriptor, header, 0, header.length, 0) === header.length
        && header.equals(expected)
    } finally {
      fs.closeSync(descriptor)
    }
  } catch {
    return false
  }
}

export function isPdfFile(filePath: string): boolean {
  return startsWithBytes(filePath, Buffer.from('%PDF-', 'ascii'))
}

export function isResignationTemplatePdfUpload(
  filePath: string,
  fileName: string,
  mimeType: string,
): boolean {
  return mimeType === PDF_MIME_TYPE
    && path.extname(fileName).toLowerCase() === '.pdf'
    && isPdfFile(filePath)
}

export function isDocxFile(filePath: string): boolean {
  return startsWithBytes(filePath, Buffer.from([0x50, 0x4b]))
}

export function detectResignationTemplateFileKind(
  filePath: string,
  fileName: string,
): ResignationTemplateFileKind | null {
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.docx' && isDocxFile(filePath)) return 'docx'
  if (extension === '.pdf' && isPdfFile(filePath)) return 'pdf'
  return null
}

export function getResignationTemplateFileKind(template: {
  file_name: string
  mime_type: string | null
}): ResignationTemplateFileKind {
  if (
    template.mime_type === PDF_MIME_TYPE
    || path.extname(template.file_name).toLowerCase() === '.pdf'
  ) {
    return 'pdf'
  }
  return 'docx'
}
