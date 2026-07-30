import fs from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import { nanoid } from 'nanoid'
import {
  detectResignationDocumentPageBoundary,
  type ResignationDocumentPageBoundary,
} from './resignationDocumentClassifier.js'
import {
  RESIGNATION_ARCHIVE_LABELS,
  RESIGNATION_ARCHIVE_TYPES,
  type ResignationArchiveType,
} from './resignationArchive.js'

const MAX_RESIGNATION_BUNDLE_PAGES = 60

export interface ResignationBundleBoundary extends ResignationDocumentPageBoundary {
  pageNumber: number
}

export interface ResignationBundleSection {
  documentType: ResignationArchiveType
  label: string
  pageNumbers: number[]
}

export interface ResignationBundleAnalysis {
  status: 'success' | 'uncertain'
  pageCount: number
  sections: ResignationBundleSection[]
  unsupportedPageNumbers: number[]
  missingTypes: ResignationArchiveType[]
  message: string
}

export interface SplitResignationDocumentFile {
  documentType: ResignationArchiveType
  label: string
  pageNumbers: number[]
  filePath: string
  originalFileName: string
  fileSize: number
  mimeType: 'application/pdf'
}

function buildMissingTypes(sections: ResignationBundleSection[]): ResignationArchiveType[] {
  const detected = new Set(sections.map(section => section.documentType))
  return RESIGNATION_ARCHIVE_TYPES.filter(type => !detected.has(type))
}

export function groupResignationBundlePages(
  pageCount: number,
  boundaries: ResignationBundleBoundary[],
): { sections: ResignationBundleSection[]; unsupportedPageNumbers: number[] } {
  const sortedBoundaries = boundaries
    .filter(boundary =>
      boundary.kind === 'document'
      && boundary.documentType
      && boundary.pageNumber >= 1
      && boundary.pageNumber <= pageCount,
    )
    .sort((a, b) => a.pageNumber - b.pageNumber)

  if (sortedBoundaries.length === 0) {
    return {
      sections: [],
      unsupportedPageNumbers: Array.from({ length: pageCount }, (_, index) => index + 1),
    }
  }

  const sectionByType = new Map<ResignationArchiveType, ResignationBundleSection>()
  const unsupportedPageNumbers = Array.from(
    { length: Math.max(0, sortedBoundaries[0].pageNumber - 1) },
    (_, index) => index + 1,
  )

  for (let index = 0; index < sortedBoundaries.length; index += 1) {
    const boundary = sortedBoundaries[index]
    const type = boundary.documentType!
    const nextPage = sortedBoundaries[index + 1]?.pageNumber ?? pageCount + 1
    const pageNumbers = Array.from(
      { length: Math.max(0, nextPage - boundary.pageNumber) },
      (_, pageOffset) => boundary.pageNumber + pageOffset,
    )
    const existing = sectionByType.get(type)
    if (existing) {
      existing.pageNumbers.push(...pageNumbers)
    } else {
      sectionByType.set(type, {
        documentType: type,
        label: RESIGNATION_ARCHIVE_LABELS[type],
        pageNumbers,
      })
    }
  }

  return {
    sections: Array.from(sectionByType.values()),
    unsupportedPageNumbers,
  }
}

export async function analyzeResignationDocumentBundle(
  pdfPath: string,
): Promise<ResignationBundleAnalysis> {
  const sourceBytes = fs.readFileSync(pdfPath)
  const sourceDocument = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
  const pageCount = sourceDocument.getPageCount()

  if (pageCount === 0) {
    return {
      status: 'uncertain',
      pageCount,
      sections: [],
      unsupportedPageNumbers: [],
      missingTypes: [...RESIGNATION_ARCHIVE_TYPES],
      message: '上传文件没有可识别页面',
    }
  }
  if (pageCount > MAX_RESIGNATION_BUNDLE_PAGES) {
    return {
      status: 'uncertain',
      pageCount,
      sections: [],
      unsupportedPageNumbers: [],
      missingTypes: [...RESIGNATION_ARCHIVE_TYPES],
      message: `合并离职档案最多支持${MAX_RESIGNATION_BUNDLE_PAGES}页`,
    }
  }

  const boundaries: ResignationBundleBoundary[] = []
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const boundary = await detectResignationDocumentPageBoundary(pdfPath, pageNumber)
    if (boundary.kind === 'document') boundaries.push({ pageNumber, ...boundary })
  }

  const grouped = groupResignationBundlePages(pageCount, boundaries)
  if (grouped.sections.length === 0) {
    return {
      status: 'uncertain',
      pageCount,
      sections: [],
      unsupportedPageNumbers: grouped.unsupportedPageNumbers,
      missingTypes: [...RESIGNATION_ARCHIVE_TYPES],
      message: '未识别到五类离职档案中的任何一类，请检查文件内容',
    }
  }
  if (grouped.unsupportedPageNumbers.length > 0) {
    return {
      status: 'uncertain',
      pageCount,
      sections: grouped.sections,
      unsupportedPageNumbers: grouped.unsupportedPageNumbers,
      missingTypes: buildMissingTypes(grouped.sections),
      message: `第${grouped.unsupportedPageNumbers.join('、')}页未识别到离职材料首页标题，请确认每份材料均从标题页开始且标题清晰完整`,
    }
  }

  return {
    status: 'success',
    pageCount,
    sections: grouped.sections,
    unsupportedPageNumbers: [],
    missingTypes: buildMissingTypes(grouped.sections),
    message: `已识别${grouped.sections.length}类离职档案，共${pageCount}页`,
  }
}

function buildSplitFileName(
  originalFileName: string,
  label: string,
): string {
  const baseName = path.basename(originalFileName, path.extname(originalFileName))
  const employeePrefix = baseName.includes('-')
    ? baseName.slice(0, baseName.indexOf('-'))
    : baseName.slice(0, 60)
  const safeLabel = label.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)
  return `${employeePrefix}-${safeLabel}.pdf`
}

export async function splitResignationDocumentBundle(
  sourcePath: string,
  originalFileName: string,
  sections: ResignationBundleSection[],
): Promise<SplitResignationDocumentFile[]> {
  const sourceBytes = fs.readFileSync(sourcePath)
  const sourceDocument = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
  const outputFiles: SplitResignationDocumentFile[] = []

  try {
    for (const section of sections) {
      const outputDocument = await PDFDocument.create()
      const copiedPages = await outputDocument.copyPages(
        sourceDocument,
        section.pageNumbers.map(pageNumber => pageNumber - 1),
      )
      copiedPages.forEach(page => outputDocument.addPage(page))
      const outputBytes = await outputDocument.save()
      const outputPath = path.join(
        path.dirname(sourcePath),
        `resignation-${Date.now()}-${nanoid(6)}-${section.documentType}.pdf`,
      )
      fs.writeFileSync(outputPath, outputBytes)
      outputFiles.push({
        documentType: section.documentType,
        label: section.label,
        pageNumbers: section.pageNumbers,
        filePath: outputPath,
        originalFileName: buildSplitFileName(originalFileName, section.label),
        fileSize: outputBytes.byteLength,
        mimeType: 'application/pdf',
      })
    }
    return outputFiles
  } catch (error) {
    for (const file of outputFiles) {
      try {
        if (fs.existsSync(file.filePath)) fs.unlinkSync(file.filePath)
      } catch {
        // 忽略拆分失败后的临时文件清理错误
      }
    }
    throw error
  }
}
