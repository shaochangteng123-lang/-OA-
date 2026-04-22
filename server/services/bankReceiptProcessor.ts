/**
 * 工行付款回单 PDF 自动化处理服务
 * 流程：PDF → 图片 → 用XML分割线坐标切割单笔 → OCR识别备注+金额 → 匹配报销单
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import sharp from 'sharp'
import { callPaddleOcr } from './ocrDaemon.js'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'

export interface BankReceiptOcrResult {
  payee: string       // 收款人
  payeeAccount: string // 收款账号
  amount: number      // 金额
  remark: string      // 备注原文
  proofNo: string     // 电子回单号
  rawText: string
}

export interface ParsedRemark {
  type: 'basic' | 'large' | 'business' | null
  name: string
  month: string  // 格式 YYYY-MM
}

export interface ReceiptMatchResult {
  receiptId: string
  imagePath: string
  ocrResult: BankReceiptOcrResult
  parsed: ParsedRemark
  matchStatus: 'matched' | 'unmatched'
  matchedReimbursementId?: string      // 单笔匹配时使用（兼容旧逻辑）
  matchedReimbursementIds?: string[]   // 多笔合并匹配时使用
}

// ==================== PDF 处理 ====================

/**
 * 解析单页 XML，返回：
 *   hasContent: 该页是否有内容（有图片嵌入）
 *   splitY: 双笔分割线的 Y 坐标（null 表示单笔）
 */
function analyzePageXml(pdfPath: string, pageNo: number): { hasContent: boolean; splitY: number | null } {
  try {
    const xmlPath = `/tmp/bank_receipt_${Date.now()}_${pageNo}`
    execSync(`pdftohtml -xml -f ${pageNo} -l ${pageNo} "${pdfPath}" "${xmlPath}" 2>/dev/null`, { timeout: 10000 })
    const xmlFile = `${xmlPath}.xml`
    if (!fs.existsSync(xmlFile)) return { hasContent: false, splitY: null }

    const xml = fs.readFileSync(xmlFile, 'utf-8')
    fs.unlinkSync(xmlFile)
    const dir = path.dirname(xmlPath)
    const base = path.basename(xmlPath)
    fs.readdirSync(dir).filter(f => f.startsWith(base)).forEach(f => {
      try { fs.unlinkSync(path.join(dir, f)) } catch {}
    })

    // 简化：直接匹配所有 image 标签
    const allImages = [...xml.matchAll(/<image[^>]+>/g)]

    // 没有任何嵌入图片 → 空白页
    if (allImages.length === 0) return { hasContent: false, splitY: null }

    // 从 <page> 标签获取页面高度，避免误匹配 image 标签的 height
    const pageHeightMatch = xml.match(/<page[^>]+height="(\d+)"/)
    const pageHeight = pageHeightMatch ? parseInt(pageHeightMatch[1]) : 1262

    // 找细线（height<=3），顶部那条(top≈81)是页眉线，中间那条(top≈660-690)是双笔分割线
    const thinLineMatches = [...xml.matchAll(/<image[^>]+top="(\d+)"[^>]+height="(\d+)"/g)]
    const thinLines = thinLineMatches
      .filter(m => parseInt(m[2]) <= 3)
      .map(m => parseInt(m[1]))
      .sort((a, b) => a - b)
    // 过滤掉顶部页眉线（top < 20% pageHeight），只保留中间分割线
    const midLines = thinLines.filter(y => y > pageHeight * 0.2 && y < pageHeight * 0.8)

    return { hasContent: true, splitY: midLines.length > 0 ? midLines[0] : null }
  } catch {
    return { hasContent: false, splitY: null }
  }
}

/**
 * 按 Y 坐标切割图片为上下两张
 * splitY 是 PDF 坐标系中的值，需要按比例换算到图片像素
 */
async function splitImage(
  imagePath: string,
  splitY: number,
  pdfPageHeight: number,
  outputDir: string,
  baseName: string,
): Promise<{ top: string; bottom: string }> {
  const meta = await sharp(imagePath).metadata()
  const imgHeight = meta.height || 1754
  const imgWidth = meta.width || 1240

  // PDF坐标 → 图片像素
  const splitPixel = Math.round((splitY / pdfPageHeight) * imgHeight)

  const topPath = path.join(outputDir, `${baseName}_top.jpg`)
  const bottomPath = path.join(outputDir, `${baseName}_bottom.jpg`)

  await sharp(imagePath)
    .extract({ left: 0, top: 0, width: imgWidth, height: splitPixel })
    .toFile(topPath)

  await sharp(imagePath)
    .extract({ left: 0, top: splitPixel, width: imgWidth, height: imgHeight - splitPixel })
    .toFile(bottomPath)

  return { top: topPath, bottom: bottomPath }
}

// ==================== OCR 解析 ====================

function extractRemark(text: string): string {
  const noSpace = text.replace(/\s+/g, '')
  // 备注字段
  const patterns = [
    /备注[：:]\s*([^\n]{2,80})/,
    /用途[：:]\s*([^\n]{2,80})/,
    /摘要[：:]\s*([^\n]{2,80})/,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m?.[1]?.trim()) return m[1].trim()
  }
  // 去空格版本
  const noSpacePatterns = [
    /备注[：:](.{2,80}?)(?:用途|摘要|交易|记账|$)/,
    /用途[：:](.{2,80}?)(?:备注|摘要|交易|记账|$)/,
  ]
  for (const p of noSpacePatterns) {
    const m = noSpace.match(p)
    if (m?.[1]) return m[1]
  }
  return ''
}

function extractAmount(text: string): number {
  const noSpace = text.replace(/\s+/g, '')
  // 小写金额
  const patterns = [
    /金额[（(]?小写[）)]?[：:]?[¥￥]?([\d,，]+\.?\d*)/,
    /金额[：:][¥￥]?([\d,，]+\.?\d*)/,
    /金额[|｜]?[¥￥]?([\d,，]+\.?\d*)/,
  ]
  for (const p of patterns) {
    const m = noSpace.match(p)
    if (m?.[1]) {
      const v = parseFloat(m[1].replace(/[,，]/g, ''))
      if (!isNaN(v) && v > 0) return v
    }
  }
  // 独立金额数字
  const m = text.match(/\b(\d{1,3}(?:[,，]\d{3})*\.\d{2})\b/)
  if (m?.[1]) {
    const v = parseFloat(m[1].replace(/[,，]/g, ''))
    if (!isNaN(v) && v > 0) return v
  }
  return 0
}

function extractPayeeAccount(text: string): string {
  const patterns = [
    /收款账号[：:]\s*([0-9\s]+)/,
    /收款账户[：:]\s*([0-9\s]+)/,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m?.[1]) return m[1].replace(/\s+/g, '').trim()
  }
  // 提取所有长数字串，优先62开头的个人银行卡号
  const allNumbers = [...text.matchAll(/\b(\d[\d\s]{12,25})\b/g)]
    .map(m => m[1].replace(/\s+/g, ''))
    .filter(n => n.length >= 13 && n.length <= 25)
  const personalCard = allNumbers.find(n => n.startsWith('62') && n.length >= 16 && n.length <= 19)
  if (personalCard) return personalCard
  if (allNumbers.length >= 2) return allNumbers[1]
  if (allNumbers.length === 1) return allNumbers[0]
  return ''
}

function extractPayee(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  // 找第二个"户名"后面的内容
  const allMatches = [...text.matchAll(/户\s*名\s*[|｜]?\s*([^\n|]{2,20})/g)]
  if (allMatches.length >= 2) {
    const name = allMatches[1][1].replace(/[|"]/g, '').trim()
    if (name.length >= 2) return name
  }
  // 找2-4个汉字的人名行
  const firstHuIdx = lines.findIndex(l => /^户\s*名$/.test(l) || l === '户名')
  if (firstHuIdx >= 2) {
    for (let i = firstHuIdx - 1; i >= 0; i--) {
      const line = lines[i]
      if (/^[\u4e00-\u9fff]{2,4}$/.test(line) && !line.match(/公司|集团|银行|回单|付款|收款/)) {
        return line
      }
    }
  }
  return ''
}

function extractProofNo(text: string): string {
  const patterns = [
    /电子回单号码[：:\s]*([A-Za-z0-9][A-Za-z0-9\-]{10,30})/,
    /电子回单号[：:\s]*([A-Za-z0-9][A-Za-z0-9\-]{10,30})/,
    /交易流水号[：:\s]*([A-Za-z0-9][A-Za-z0-9\-]{10,30})/,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m?.[1]) return m[1].trim()
  }
  return ''
}

async function ocrReceipt(imagePath: string): Promise<BankReceiptOcrResult> {
  const text = await callPaddleOcr(imagePath)
  return {
    payee: extractPayee(text),
    payeeAccount: extractPayeeAccount(text),
    amount: extractAmount(text),
    remark: extractRemark(text),
    proofNo: extractProofNo(text),
    rawText: text,
  }
}

// ==================== 备注解析 ====================

/**
 * 解析备注字段，提取报销类型、姓名、月份
 * 格式：基础报销-丁禹滨-2026年1月
 */
export function parseRemark(remark: string): ParsedRemark {
  const result: ParsedRemark = { type: null, name: '', month: '' }
  if (!remark) return result

  const typeMap: Record<string, ParsedRemark['type']> = {
    '基础报销': 'basic',
    '大额报销': 'large',
    '商务报销': 'business',
  }

  for (const [key, val] of Object.entries(typeMap)) {
    if (remark.includes(key)) {
      result.type = val
      break
    }
  }

  // 提取姓名（2-4个汉字）
  const nameMatch = remark.match(/[\-\s]+([\u4e00-\u9fff]{2,4})[\-\s]/)
  if (nameMatch) result.name = nameMatch[1]

  // 提取月份，支持：2026年1月 / 2026-01 / 202601
  const monthPatterns = [
    /(\d{4})年(\d{1,2})月/,
    /(\d{4})[.\-](\d{1,2})/,
  ]
  for (const p of monthPatterns) {
    const m = remark.match(p)
    if (m) {
      result.month = `${m[1]}-${m[2].padStart(2, '0')}`
      break
    }
  }

  return result
}

// ==================== 匹配逻辑 ====================

/**
 * 检查收款账号是否匹配（和 verify-proof 逻辑一致）
 */
function accountMatches(expected: string, ocr: string): boolean {
  const e = expected.replace(/\s+/g, '')
  const o = ocr.replace(/\s+/g, '')
  if (!e || !o) return false
  if (e === o) return true
  if (e.endsWith(o) || o.endsWith(e)) return true
  // 首位OCR误识别容错
  if (e.length === o.length && e.slice(1) === o.slice(1)) return true
  return false
}

/**
 * 检查收款人姓名是否匹配（和 verify-proof 逻辑一致）
 */
function nameMatches(expected: string, ocrPayee: string, rawText: string): boolean {
  if (!expected) return false
  const name = expected.trim()

  // 在OCR提取的收款人字段中匹配
  if (ocrPayee && ocrPayee !== '付款' && ocrPayee !== '收款') {
    if (ocrPayee === name || ocrPayee.includes(name)) return true
    // 模糊匹配（容一个字OCR误识别）
    if (name.length >= 2) {
      for (let i = 0; i < name.length; i++) {
        const partial = name.split('').filter((_, idx) => idx !== i).join('')
        if (ocrPayee.includes(partial)) return true
      }
    }
  }

  // 在原始文本备注之前的区域查找
  if (rawText) {
    const rawBeforeMemo = rawText.split(/备注|附言|客户附言/)[0]
    const rawNoSpace = rawBeforeMemo.replace(/\s+/g, '')
    if (rawNoSpace.includes(name)) return true
    if (name.length >= 2) {
      for (let i = 0; i < name.length; i++) {
        const partial = name.split('').filter((_, idx) => idx !== i).join('')
        if (rawNoSpace.includes(partial)) return true
      }
    }
  }

  return false
}

/**
 * 回溯算法：从候选列表中找出金额之和等于 target 的子集（转为整数分避免浮点误差）
 * 约束：子集内所有报销单必须是同一报销类型（基础/大额/商务）
 * 返回匹配的 ID 列表，找不到返回 null
 */
function findSubsetByAmount(
  candidates: Array<{ id: string; total_amount: number; type: string }>,
  target: number,
): string[] | null {
  const targetCents = Math.round(target * 100)
  const items = candidates.map(c => ({
    id: c.id,
    cents: Math.round(Number(c.total_amount) * 100),
    type: c.type,
  }))

  // 先尝试单笔精确匹配（最优先，不限类型约束）
  const single = items.find(item => item.cents === targetCents)
  if (single) return [single.id]

  // 再尝试多笔组合（回溯，限制最多5笔，避免组合爆炸）
  // 约束：同一子集内所有报销单必须是同一类型
  const reimbursementTypes = ['basic', 'large', 'business']
  for (const type of reimbursementTypes) {
    const sameTypeItems = items.filter(item => item.type === type)
    if (sameTypeItems.length < 2) continue

    const result: string[] = []
    function backtrack(startIdx: number, remaining: number, chosen: string[]): boolean {
      if (remaining === 0) {
        result.push(...chosen)
        return true
      }
      if (remaining < 0 || startIdx >= sameTypeItems.length || chosen.length >= 5) return false
      for (let i = startIdx; i < sameTypeItems.length; i++) {
        chosen.push(sameTypeItems[i].id)
        if (backtrack(i + 1, remaining - sameTypeItems[i].cents, chosen)) return true
        chosen.pop()
      }
      return false
    }

    if (backtrack(0, targetCents, [])) return result
  }

  return null
}

async function matchReimbursement(
  ocr: BankReceiptOcrResult,
  parsed: ParsedRemark,
): Promise<string[] | null> {
  const typeMap: Record<string, string> = { basic: 'basic', large: 'large', business: 'business' }

  // ==================== 第1级：优先查 payment_batches 联动匹配 ====================
  // 财务在系统里"批量付款"时，已明确记录了哪几笔报销被合并付款
  // 回单金额 = payment_batches.total_amount，且批次内某笔报销的收款人匹配
  if (ocr.amount > 0) {
    const batches = await db.all<{ id: string; total_amount: number }>(`
      SELECT DISTINCT pb.id, pb.total_amount
      FROM payment_batches pb
      JOIN payment_batch_items pbi ON pbi.batch_id = pb.id
      JOIN reimbursements r ON r.id = pbi.reimbursement_id
      JOIN users u ON r.user_id = u.id
      LEFT JOIN employee_profiles ep ON ep.user_id = r.user_id
      WHERE pb.status = 'pending'
        AND ABS(pb.total_amount - ?) < 0.01
    `, ocr.amount)

    for (const batch of batches) {
      // 查出该批次内所有报销单及其收款人信息
      const batchItems = await db.all<{
        reimbursement_id: string
        bank_account_name: string | null
        bank_account_number: string | null
      }>(`
        SELECT pbi.reimbursement_id,
               COALESCE(ep.bank_account_name, u.bank_account_name) as bank_account_name,
               COALESCE(ep.bank_account_number, u.bank_account_number) as bank_account_number
        FROM payment_batch_items pbi
        JOIN reimbursements r ON r.id = pbi.reimbursement_id
        JOIN users u ON r.user_id = u.id
        LEFT JOIN employee_profiles ep ON ep.user_id = r.user_id
        WHERE pbi.batch_id = ?
      `, batch.id)

      // 只要批次内有一笔报销的收款人匹配，就认为整个批次都是这个人的
      const personMatched = batchItems.some(item => {
        const acctOk = item.bank_account_number
          ? accountMatches(item.bank_account_number, ocr.payeeAccount || '')
          : false
        const nameOk = item.bank_account_name
          ? nameMatches(item.bank_account_name, ocr.payee || '', ocr.rawText || '')
          : false
        return acctOk || nameOk
      })

      if (personMatched) {
        const ids = batchItems.map(item => item.reimbursement_id)
        console.log(`✅ payment_batches 联动匹配成功：批次 ${batch.id}，共 ${ids.length} 笔，合计 ¥${batch.total_amount}`)
        return ids
      }
    }
  }

  // ==================== 第2/3级：单笔 + 回溯组合匹配（兜底） ====================
  // 构建候选报销单查询
  let sql = `
    SELECT r.id, r.total_amount, r.approve_time, r.user_id, r.type,
           COALESCE(ep.bank_account_name, u.bank_account_name) as bank_account_name,
           COALESCE(ep.bank_account_number, u.bank_account_number) as bank_account_number
    FROM reimbursements r
    JOIN users u ON r.user_id = u.id
    LEFT JOIN employee_profiles ep ON ep.user_id = r.user_id
    WHERE r.status = 'approved' AND r.is_deleted = false
  `
  const params: any[] = []

  if (parsed.type) {
    sql += ` AND r.type = ?`
    params.push(typeMap[parsed.type])
  }

  sql += ` ORDER BY r.approve_time ASC`

  const candidates = await db.all<{
    id: string; total_amount: number; approve_time: string; type: string
    user_id: string; bank_account_name: string | null; bank_account_number: string | null
  }>(sql, ...params)

  if (candidates.length === 0) return null

  // 过滤：收款账号或姓名匹配（确认是同一个人）
  const matched = candidates.filter(c => {
    const acctOk = c.bank_account_number
      ? accountMatches(c.bank_account_number, ocr.payeeAccount || '')
      : false
    const nameOk = c.bank_account_name
      ? nameMatches(c.bank_account_name, ocr.payee || '', ocr.rawText || '')
      : false
    return acctOk || nameOk
  })

  if (matched.length === 0) return null

  // 在同一个人的报销单中，找出金额之和等于回单金额的子集（支持合并打款）
  if (ocr.amount > 0) {
    const ids = findSubsetByAmount(matched, ocr.amount)
    if (ids && ids.length > 0) {
      console.log(`✅ 金额匹配成功：共 ${ids.length} 笔，合计 ¥${ocr.amount}`)
      return ids
    }
  }

  // 金额匹配不上 → 人工认领
  return null
}

// ==================== 主流程 ====================

/**
 * 一次性将整份 PDF 转为图片，返回 pageNo → 图片路径 的映射
 */
function convertAllPagesToImages(pdfPath: string, outputDir: string, totalPages: number): Map<number, string> {
  const prefix = path.join(outputDir, 'page')
  try {
    execSync(`pdftoppm -r 120 -jpeg "${pdfPath}" "${prefix}"`, { timeout: 120000 })
  } catch (e) {
    console.error('❌ pdftoppm 批量转换失败:', e)
    return new Map()
  }

  const map = new Map<number, string>()
  const files = fs.readdirSync(outputDir).filter(f => f.startsWith('page-') && f.endsWith('.jpg'))
  for (const file of files) {
    // 文件名格式：page-01.jpg / page-001.jpg
    const m = file.match(/^page-(\d+)\.jpg$/)
    if (m) {
      const pageNo = parseInt(m[1])
      map.set(pageNo, path.join(outputDir, file))
    }
  }
  console.log(`🖼️ 批量转图片完成，共 ${map.size} 页`)
  return map
}

export async function processBankReceiptPdf(
  pdfPath: string,
  batchId: string,
  uploadedBy: string,
  outputDir: string,
): Promise<ReceiptMatchResult[]> {
  const results: ReceiptMatchResult[] = []
  const now = new Date().toISOString()

  // 获取总页数
  let totalPages = 1
  try {
    const info = execSync(`pdfinfo "${pdfPath}"`, { encoding: 'utf-8', timeout: 10000 })
    const match = info.match(/Pages:\s*(\d+)/)
    if (match) totalPages = parseInt(match[1])
  } catch (e) {
    console.error('❌ pdfinfo 失败:', e)
  }
  console.log(`📄 回单PDF共 ${totalPages} 页，开始处理...`)

  // 一次性转所有页为图片
  const pageImageMap = convertAllPagesToImages(pdfPath, outputDir, totalPages)

  // 并行分析所有页面 XML（过滤空白页，获取分割线坐标）
  console.log(`🔍 并行分析页面结构，跳过空白页...`)
  const pageAnalysis = new Map<number, { splitY: number | null }>()
  const CONCURRENCY = 4  // XML 分析并发数（CPU密集，不宜过高）
  const pageNos = Array.from({ length: totalPages }, (_, i) => i + 1)
  for (let i = 0; i < pageNos.length; i += CONCURRENCY) {
    const batch = pageNos.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(async (pageNo) => {
        const r = analyzePageXml(pdfPath, pageNo)
        return { pageNo, ...r }
      })
    )
    for (const { pageNo, hasContent, splitY } of batchResults) {
      if (hasContent) pageAnalysis.set(pageNo, { splitY })
      else console.log(`⏭️ 第${pageNo}页为空白页，跳过`)
    }
  }
  console.log(`📋 有内容的页面：${pageAnalysis.size} 页，空白页：${totalPages - pageAnalysis.size} 页`)

  // 准备所有待 OCR 的图片任务
  const ocrTasks: Array<{ imagePath: string; position: 'full' | 'top' | 'bottom'; pageNo: number }> = []
  for (const [pageNo, { splitY }] of pageAnalysis) {
    const pageImagePath = pageImageMap.get(pageNo)
    if (!pageImagePath || !fs.existsSync(pageImagePath)) {
      console.warn(`⚠️ 第${pageNo}页无图片，跳过`)
      continue
    }
    if (splitY) {
      try {
        const { top, bottom } = await splitImage(pageImagePath, splitY, 1262, outputDir, `page${pageNo}`)
        ocrTasks.push({ imagePath: top, position: 'top', pageNo })
        ocrTasks.push({ imagePath: bottom, position: 'bottom', pageNo })
      } catch {
        ocrTasks.push({ imagePath: pageImagePath, position: 'full', pageNo })
      }
    } else {
      ocrTasks.push({ imagePath: pageImagePath, position: 'full', pageNo })
    }
  }

  // 并行 OCR（常驻进程支持队列，最多同时发 3 个请求）
  const OCR_CONCURRENCY = 3
  console.log(`🔍 开始并行 OCR，共 ${ocrTasks.length} 张图片（并发数: ${OCR_CONCURRENCY}）...`)
  for (let i = 0; i < ocrTasks.length; i += OCR_CONCURRENCY) {
    const batch = ocrTasks.slice(i, i + OCR_CONCURRENCY)
    await Promise.all(batch.map(async ({ imagePath, position, pageNo }) => {
      try {
        const ocr = await ocrReceipt(imagePath)

        // 跳过空页（OCR识别不到任何内容）
        if (!ocr.rawText || ocr.rawText.trim().length < 10) return

        const parsed = parseRemark(ocr.remark)
        const matchedIds = await matchReimbursement(ocr, parsed)

        const receiptId = `br_${nanoid(10)}`
        const matchStatus = matchedIds && matchedIds.length > 0 ? 'matched' : 'unmatched'
        // 兼容旧字段：单笔时存第一个ID，多笔时也存第一个（matched_reimbursement_ids JSON存全部）
        const primaryMatchedId = matchedIds?.[0] || null

        // 转为相对路径存储（供前端通过 /api/files/ 访问）
        const relativeImagePath = imagePath.replace(process.cwd() + '/', '')

        // 查出 payment_batch_id（如果是通过批量付款匹配的）
        let paymentBatchId: string | null = null
        if (matchedIds && matchedIds.length > 0) {
          const r = await db.get<{ payment_batch_id: string | null }>(
            `SELECT payment_batch_id FROM reimbursements WHERE id = ?`, matchedIds[0],
          )
          paymentBatchId = r?.payment_batch_id || null
        }

        // 保存到数据库
        await db.run(
          `INSERT INTO bank_receipts
            (id, batch_id, image_path, page_no, position, ocr_payee, ocr_amount, ocr_remark,
             ocr_raw_json, parsed_type, parsed_name, parsed_month,
             match_status, matched_reimbursement_id, payment_batch_id, matched_by, matched_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          receiptId, batchId, relativeImagePath, pageNo, position,
          ocr.payee, ocr.amount || null, ocr.remark,
          JSON.stringify({
            proofNo: ocr.proofNo,
            rawText: ocr.rawText.slice(0, 500),
            matchedIds: matchedIds || [],
          }),
          parsed.type, parsed.name || null, parsed.month || null,
          matchStatus, primaryMatchedId, paymentBatchId,
          primaryMatchedId ? uploadedBy : null,
          primaryMatchedId ? now : null,
          now,
        )

        // 匹配成功：为每笔匹配的报销单更新状态 + 写审批记录
        if (matchedIds && matchedIds.length > 0) {
          for (const rid of matchedIds) {
            await db.run(
              `UPDATE reimbursements
               SET status = 'payment_uploaded',
                   payment_proof_path = ?,
                   payment_upload_time = ?,
                   pay_time = ?,
                   updated_at = ?
               WHERE id = ?`,
              relativeImagePath, now, now, now, rid,
            )

            // 查询审批实例，写入审批记录
            const approvalInstance = await db.get<{ id: string }>(
              `SELECT id FROM approval_instances WHERE target_id = ? AND target_type = 'reimbursement' ORDER BY created_at DESC LIMIT 1`,
              rid,
            )
            if (approvalInstance) {
              const recordId = `ar_${nanoid(10)}`
              const comment = matchedIds.length > 1
                ? `系统自动上传付款回单（合并打款，共${matchedIds.length}笔）`
                : '系统自动上传付款回单'
              await db.run(
                `INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                recordId, approvalInstance.id, 99, uploadedBy, 'payment_uploaded', comment, now,
              )
            }
          }

          // 同步更新 payment_batches 状态：pending → uploaded
          // 查出这批报销单所属的 payment_batch（批量付款批次）
          const batchIds = new Set<string>()
          for (const rid of matchedIds) {
            const r = await db.get<{ payment_batch_id: string | null }>(
              `SELECT payment_batch_id FROM reimbursements WHERE id = ?`, rid,
            )
            if (r?.payment_batch_id) batchIds.add(r.payment_batch_id)
          }

          for (const pbId of batchIds) {
            // 检查该 payment_batch 内所有报销单是否全部已上传回单
            const batchReimbursements = await db.all<{ status: string }>(
              `SELECT r.status FROM reimbursements r
               JOIN payment_batch_items pbi ON pbi.reimbursement_id = r.id
               WHERE pbi.batch_id = ?`,
              pbId,
            )
            const allUploaded = batchReimbursements.length > 0
              && batchReimbursements.every(r => r.status === 'payment_uploaded')

            await db.run(
              `UPDATE payment_batches
               SET status = ?, payment_proof_path = ?, pay_time = ?, updated_at = ?
               WHERE id = ? AND status = 'pending'`,
              allUploaded ? 'uploaded' : 'pending',
              relativeImagePath, now, now, pbId,
            )
            if (allUploaded) {
              console.log(`✅ payment_batches ${pbId} 全部回单已上传，状态更新为 uploaded`)
            }
          }
        }

        results.push({
          receiptId,
          imagePath: relativeImagePath,
          ocrResult: ocr,
          parsed,
          matchStatus,
          matchedReimbursementId: primaryMatchedId || undefined,
          matchedReimbursementIds: matchedIds || undefined,
        })
      } catch (err) {
        console.error(`❌ 处理第${pageNo}页回单失败:`, err)
      }
    }))
  }

  // 更新批次统计
  const matched = results.filter(r => r.matchStatus === 'matched').length
  const unmatched = results.filter(r => r.matchStatus === 'unmatched').length
  await db.run(
    `UPDATE bank_receipt_batches
     SET total_pages = ?, total_receipts = ?, matched_count = ?, unmatched_count = ?,
         status = 'done', updated_at = ?
     WHERE id = ?`,
    totalPages, results.length, matched, unmatched, now, batchId,
  )

  return results
}
