import express from 'express'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const CONVERTIBLE_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp']
const SPREADSHEET_EXT = ['xls', 'xlsx', 'ods']

const FIT_SCRIPT = path.join(process.cwd(), 'server', 'utils', 'fit-spreadsheet.py')

// LibreOffice 不支持多实例并发，用队列串行执行
let converting = Promise.resolve()

export async function sendConvertedPdf(res: express.Response, sourcePath: string, originalName: string) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-pdf-'))
  const userInstallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soffice-user-'))

  const ext = path.extname(sourcePath).toLowerCase().replace('.', '')

  const doConvert = async () => {
    try {
      let convertSource = sourcePath

      // Excel 文件：先用 Python 脚本设置"适合页面宽度"
      if (SPREADSHEET_EXT.includes(ext)) {
        const preparedPath = path.join(workDir, `prepared${path.extname(sourcePath)}`)
        try {
          await execFileAsync('python3', [FIT_SCRIPT, sourcePath, preparedPath], { timeout: 15_000 })
          if (fs.existsSync(preparedPath)) {
            convertSource = preparedPath
          }
        } catch (e) {
          // Python 处理失败，使用原文件继续
          console.warn('Excel 页面设置预处理失败，使用原文件:', e)
        }
      }

      await execFileAsync(
        'soffice',
        [
          '--headless', '--nologo', '--nofirststartwizard',
          `-env:UserInstallation=file://${userInstallDir}`,
          '--convert-to', 'pdf', '--outdir', workDir, convertSource,
        ],
        { timeout: 90_000 },
      )

      // PDF 文件名基于转换源文件名
      const base = path.basename(convertSource, path.extname(convertSource))
      const pdfPath = path.join(workDir, `${base}.pdf`)

      if (!fs.existsSync(pdfPath)) {
        throw new Error('LibreOffice 未生成 PDF')
      }
      const pdfName = originalName.replace(/\.[^.]+$/, '.pdf')
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(pdfName)}"`)
      const stream = fs.createReadStream(pdfPath)
      stream.on('close', () => {
        try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
        try { fs.rmSync(userInstallDir, { recursive: true, force: true }) } catch { /* ignore */ }
      })
      stream.pipe(res)
    } catch (err) {
      try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
      try { fs.rmSync(userInstallDir, { recursive: true, force: true }) } catch { /* ignore */ }
      console.error('文档转 PDF 失败:', err)
      if (!res.headersSent) {
        const accept = res.req?.headers?.accept || ''
        if (accept.includes('text/html') || !accept.includes('application/json')) {
          res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8').end(
            `<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#666;">
            <div style="text-align:center"><h2>文档预览生成失败</h2><p>请稍后重试或直接下载文件查看。</p></div>
            </body></html>`
          )
        } else {
          res.status(500).json({ success: false, message: '文档预览生成失败，请下载后查看' })
        }
      }
    }
  }

  // 串行执行，避免 LibreOffice 并发冲突
  converting = converting.then(doConvert, doConvert)
  await converting
}
