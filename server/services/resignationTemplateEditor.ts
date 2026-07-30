import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
let conversionQueue: Promise<unknown> = Promise.resolve()

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function sanitizeResignationTemplateHtml(value: string): string {
  const bodyMatch = value.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const body = bodyMatch?.[1] ?? value
  return body
    .replace(/<(script|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '')
    .trim()
}

async function runSerializedConversion<T>(task: () => Promise<T>): Promise<T> {
  const result = conversionQueue.then(task, task)
  conversionQueue = result.then(() => undefined, () => undefined)
  return await result
}

async function convertWithLibreOffice(
  sourcePath: string,
  outputFormat: 'html' | 'docx',
): Promise<{ outputPath: string; cleanup: () => void }> {
  return await runSerializedConversion(async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resignation-template-'))
    const userInstallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soffice-resignation-'))
    const sourceName = `source${path.extname(sourcePath).toLowerCase() || '.docx'}`
    const copiedSource = path.join(workDir, sourceName)
    fs.copyFileSync(sourcePath, copiedSource)

    const cleanup = () => {
      try {
        fs.rmSync(workDir, { recursive: true, force: true })
      } catch {
        // 忽略临时文件清理失败
      }
      try {
        fs.rmSync(userInstallDir, { recursive: true, force: true })
      } catch {
        // 忽略临时文件清理失败
      }
    }

    try {
      const convertTo = outputFormat === 'docx'
        ? 'docx:Office Open XML Text'
        : 'html:HTML'
      await execFileAsync(
        'soffice',
        [
          '--headless',
          '--nologo',
          '--nofirststartwizard',
          `-env:UserInstallation=file://${userInstallDir}`,
          '--convert-to',
          convertTo,
          '--outdir',
          workDir,
          copiedSource,
        ],
        { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 },
      )
      const outputPath = path.join(
        workDir,
        `${path.basename(copiedSource, path.extname(copiedSource))}.${outputFormat}`,
      )
      if (!fs.existsSync(outputPath)) {
        throw new Error(`未生成${outputFormat === 'docx' ? 'Word' : 'HTML'}文件`)
      }
      return { outputPath, cleanup }
    } catch (error) {
      cleanup()
      throw error
    }
  })
}

export function fillResignationTemplatePlaceholders(
  html: string,
  values: Record<string, string | null | undefined>,
): string {
  let result = html
  for (const [key, rawValue] of Object.entries(values)) {
    const value = escapeHtml(String(rawValue ?? ''))
    const markupGap = '(?:\\s|<[^>]+>)*'
    const escapedKey = Array.from(key)
      .map(character => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join(markupGap)
    const patterns = [
      new RegExp(`\\{${markupGap}\\{${markupGap}${escapedKey}${markupGap}\\}${markupGap}\\}`, 'g'),
      new RegExp(`【${markupGap}${escapedKey}${markupGap}】`, 'g'),
      new RegExp(`\\[${markupGap}\\[${markupGap}${escapedKey}${markupGap}\\]${markupGap}\\]`, 'g'),
    ]
    for (const pattern of patterns) result = result.replace(pattern, value)
  }
  return result
}

export async function loadResignationTemplateHtml(
  sourcePath: string,
  values: Record<string, string | null | undefined>,
): Promise<string> {
  const ext = path.extname(sourcePath).toLowerCase()
  if (ext !== '.docx') throw new Error('在线编辑仅支持 DOCX 格式的 Word 模板')

  const converted = await convertWithLibreOffice(sourcePath, 'html')
  try {
    const html = fs.readFileSync(converted.outputPath, 'utf8')
    return fillResignationTemplatePlaceholders(sanitizeResignationTemplateHtml(html), values)
  } finally {
    converted.cleanup()
  }
}

export async function renderResignationTemplateDocx(editableHtml: string): Promise<Buffer> {
  const sanitized = sanitizeResignationTemplateHtml(editableHtml)
  if (!sanitized) throw new Error('模板内容不能为空')

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resignation-template-html-'))
  const htmlPath = path.join(workDir, 'source.html')
  const fullHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 2.4cm 2.2cm; }
    body { font-family: "Microsoft YaHei", "SimSun", sans-serif; font-size: 14pt; line-height: 1.65; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #333; padding: 6px 8px; }
  </style>
</head>
<body>${sanitized}</body>
</html>`
  fs.writeFileSync(htmlPath, fullHtml, 'utf8')

  try {
    const converted = await convertWithLibreOffice(htmlPath, 'docx')
    try {
      return fs.readFileSync(converted.outputPath)
    } finally {
      converted.cleanup()
    }
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true })
    } catch {
      // 忽略临时文件清理失败
    }
  }
}
