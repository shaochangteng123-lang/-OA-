import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import sharp from 'sharp'
import {
  RESIGNATION_ARCHIVE_LABELS,
  type ResignationArchiveType,
} from './resignationArchive.js'

const execFileAsync = promisify(execFile)

interface ResignationClassificationRule {
  type: ResignationArchiveType
  titleSignatures: string[]
  contentPatterns: Array<{ pattern: RegExp; score: number }>
}

export interface ResignationDocumentPageBoundary {
  kind: 'document' | 'none'
  documentType: ResignationArchiveType | null
  label: string | null
  source: 'text' | 'image' | null
}

const CLASSIFICATION_RULES: ResignationClassificationRule[] = [
  {
    type: 'termination_agreement',
    titleSignatures: [
      '终止解除劳动关系协议书',
      '终止劳动关系协议书',
      '解除劳动关系协议书',
    ],
    contentPatterns: [
      { pattern: /终止劳动关系协议书|解除劳动关系协议书|终止解除劳动关系协议书/, score: 70 },
      { pattern: /甲乙双方.*签订.*劳动合同/, score: 30 },
      { pattern: /解除终止劳动关系|终止解除劳动关系|双方就.*劳动关系/, score: 30 },
      { pattern: /甲方.*乙方|用人单位.*劳动者/, score: 10 },
    ],
  },
  {
    type: 'employee_handover_form',
    titleSignatures: [
      '员工离职交接单',
      '离职交接单',
      '员工离职工作交接单',
    ],
    contentPatterns: [
      { pattern: /员工离职交接单|离职工作交接单/, score: 70 },
      { pattern: /交接总体声明/, score: 30 },
      { pattern: /岗位日常工作交接|交接事项|交接内容|接收人/, score: 25 },
      { pattern: /办公资产|系统权限|涉密文件/, score: 10 },
    ],
  },
  {
    type: 'settlement_confirmation',
    titleSignatures: [
      '薪资及各类款项结算确认书',
      '工资及各类款项结算确认书',
    ],
    contentPatterns: [
      { pattern: /薪资及各类款项结算确认书|工资及各类款项结算确认书/, score: 75 },
      { pattern: /工资结算截止日期|薪资结算截止日期/, score: 30 },
      { pattern: /社会保险缴纳截止日期/, score: 30 },
      { pattern: /费用结清日期/, score: 10 },
    ],
  },
  {
    type: 'compensation_agreement',
    titleSignatures: [
      '离职经济补偿协议书',
      '经济补偿协议书',
      '离职补偿协议书',
    ],
    contentPatterns: [
      { pattern: /离职经济补偿协议书|经济补偿协议书/, score: 75 },
      { pattern: /劳动合同法.*第四十七条/, score: 35 },
      { pattern: /离职经济补偿|经济补偿金|补偿按照.*个月工资/, score: 30 },
      { pattern: /工作年限共计/, score: 15 },
    ],
  },
  {
    type: 'resignation_certificate',
    titleSignatures: [
      '离职证明',
      '解除劳动关系证明',
      '终止劳动关系证明',
    ],
    contentPatterns: [
      { pattern: /离职证明/, score: 75 },
      { pattern: /兹有我司员工|兹证明.*员工/, score: 30 },
      { pattern: /特此证明/, score: 30 },
      { pattern: /双方劳动关系已于|劳动关系已于.*解除/, score: 20 },
    ],
  },
]

function normalizeLine(value: string): string {
  return value
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[：:]/g, '')
    .trim()
}

function getLeadingLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean)
    .slice(0, 24)
}

function normalizeTitleText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^\p{Script=Han}]/gu, '')
}

function calculateEditDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }

  return previous[right.length]
}

function buildTitleCandidates(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map(normalizeTitleText)
    .filter(Boolean)
  const candidates = new Set(lines)

  for (let index = 0; index < lines.length; index += 1) {
    let combined = lines[index]
    for (let offset = 1; offset <= 2 && index + offset < lines.length; offset += 1) {
      combined += lines[index + offset]
      if (combined.length <= 18) candidates.add(combined)
    }
  }

  return Array.from(candidates)
}

function isFuzzyTitleMatch(candidate: string, signature: string): boolean {
  const allowedDistance = signature.length >= 10 ? 2 : signature.length >= 6 ? 1 : 0
  if (allowedDistance === 0 || Math.abs(candidate.length - signature.length) > allowedDistance) {
    return false
  }
  return calculateEditDistance(candidate, signature) <= allowedDistance
}

export function classifyResignationDocumentTitle(
  text: string,
): { documentType: ResignationArchiveType; label: string } | null {
  const candidates = buildTitleCandidates(text)
  const normalizedPageText = normalizeTitleText(text)

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.titleSignatures.some(signature =>
      candidates.includes(signature)
      || (signature.length >= 6 && normalizedPageText.includes(signature)),
    )) {
      return {
        documentType: rule.type,
        label: RESIGNATION_ARCHIVE_LABELS[rule.type],
      }
    }
  }

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.titleSignatures.some(signature =>
      candidates.some(candidate => isFuzzyTitleMatch(candidate, signature)),
    )) {
      return {
        documentType: rule.type,
        label: RESIGNATION_ARCHIVE_LABELS[rule.type],
      }
    }
  }

  return null
}

export function classifyResignationDocumentText(
  text: string,
): { documentType: ResignationArchiveType; label: string } | null {
  const titleClassification = classifyResignationDocumentTitle(text)
  if (titleClassification) return titleClassification

  const leadingLines = getLeadingLines(text)
  const normalizedContent = normalizeTitleText(leadingLines.join(''))
  const scored = CLASSIFICATION_RULES
    .map(rule => ({
      type: rule.type,
      score: rule.contentPatterns.reduce(
        (total, item) => total + (item.pattern.test(normalizedContent) ? item.score : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score)

  if (!scored[0] || scored[0].score < 45) return null
  if (scored[1] && scored[0].score - scored[1].score < 15) return null

  return {
    documentType: scored[0].type,
    label: RESIGNATION_ARCHIVE_LABELS[scored[0].type],
  }
}

async function extractPdfPageText(pdfPath: string, pageNumber: number): Promise<string> {
  const result = await execFileAsync(
    'pdftotext',
    [
      '-f',
      String(pageNumber),
      '-l',
      String(pageNumber),
      '-layout',
      pdfPath,
      '-',
    ],
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' },
  ) as { stdout: string }
  return result.stdout || ''
}

async function recognizePdfPageImage(
  pdfPath: string,
  pageNumber: number,
  dpi: number,
  titleRegionOnly: boolean,
): Promise<string> {
  const outputPrefix = `${pdfPath}-resignation-classify-${process.pid}-${Date.now()}-${pageNumber}-${dpi}`
  const imagePath = `${outputPrefix}.png`
  const titleImagePath = `${outputPrefix}-title.png`

  try {
    await execFileAsync(
      'pdftoppm',
      [
        '-png',
        '-singlefile',
        '-r',
        String(dpi),
        '-f',
        String(pageNumber),
        '-l',
        String(pageNumber),
        pdfPath,
        outputPrefix,
      ],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    )
    if (!fs.existsSync(imagePath)) throw new Error('离职档案页面转图片失败')
    let recognitionPath = imagePath
    if (titleRegionOnly) {
      const metadata = await sharp(imagePath).metadata()
      const width = metadata.width || 0
      const height = metadata.height || 0
      if (width > 0 && height > 0) {
        await sharp(imagePath)
          .extract({
            left: 0,
            top: 0,
            width,
            height: Math.max(1, Math.floor(height * 0.55)),
          })
          .grayscale()
          .normalize()
          .sharpen()
          .png()
          .toFile(titleImagePath)
        recognitionPath = titleImagePath
      }
    }
    const { callPaddleOcr } = await import('./ocrDaemon.js')
    return await callPaddleOcr(recognitionPath)
  } finally {
    try {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
      if (fs.existsSync(titleImagePath)) fs.unlinkSync(titleImagePath)
    } catch {
      // 忽略临时图片清理失败
    }
  }
}

export async function detectResignationDocumentPageBoundary(
  pdfPath: string,
  pageNumber: number,
): Promise<ResignationDocumentPageBoundary> {
  const allowFirstPageContentFallback = pageNumber === 1

  try {
    const text = await extractPdfPageText(pdfPath, pageNumber)
    const classification = classifyResignationDocumentTitle(text)
      || (allowFirstPageContentFallback ? classifyResignationDocumentText(text) : null)
    if (classification) {
      return {
        kind: 'document',
        ...classification,
        source: 'text',
      }
    }
  } catch {
    console.warn(`离职档案第${pageNumber}页文字层提取失败，改用图片识别`)
  }

  try {
    const recognizedText = await recognizePdfPageImage(
      pdfPath,
      pageNumber,
      320,
      !allowFirstPageContentFallback,
    )
    const classification = classifyResignationDocumentTitle(recognizedText)
      || (allowFirstPageContentFallback
        ? classifyResignationDocumentText(recognizedText)
        : null)
    if (classification) {
      return {
        kind: 'document',
        ...classification,
        source: 'image',
      }
    }
  } catch {
    console.warn(`离职档案第${pageNumber}页图片识别失败`)
  }

  return {
    kind: 'none',
    documentType: null,
    label: null,
    source: null,
  }
}
