import type { PoolClient } from 'pg'
import { db } from '../db/index.js'

type HolidayType = 'holiday' | 'workday'

export interface HolidayInfo {
  date: string
  name: string
  type: HolidayType
}

interface RefreshOptions {
  force?: boolean
  sourceUrl?: string
}

interface RefreshResult {
  year: number
  updated: boolean
  skipped: boolean
  count: number
  sourceUrl?: string
  message: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const GOV_SEARCH_API = 'https://sousuo.www.gov.cn/search-gov/data'
const GOV_SEARCH_PAGE = 'https://sousuo.www.gov.cn/s.htm'
const HOLIDAY_NAMES = ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节']

function convertTxPlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

async function txRun(client: PoolClient, sql: string, ...params: any[]): Promise<void> {
  await client.query(convertTxPlaceholders(sql), params)
}

function normalizeText(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, '')
}

function parseMonthDay(dateText: string, fallbackMonth?: number): { month: number; day: number } | null {
  const fullMatch = dateText.match(/(\d{1,2})月(\d{1,2})日/)
  if (fullMatch) {
    return { month: Number(fullMatch[1]), day: Number(fullMatch[2]) }
  }

  const dayMatch = dateText.match(/(\d{1,2})日/)
  if (dayMatch && fallbackMonth) {
    return { month: fallbackMonth, day: Number(dayMatch[1]) }
  }

  return null
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function eachDateInRange(year: number, start: { month: number; day: number }, end: { month: number; day: number }): string[] {
  const startDate = new Date(year, start.month - 1, start.day)
  const endYear = end.month < start.month ? year + 1 : year
  const endDate = new Date(endYear, end.month - 1, end.day)
  const dates: string[] = []

  for (let time = startDate.getTime(); time <= endDate.getTime(); time += DAY_MS) {
    const date = new Date(time)
    dates.push(formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate()))
  }

  return dates
}

function upsertParsedHoliday(
  map: Map<string, HolidayInfo>,
  date: string,
  name: string,
  type: HolidayType,
) {
  const normalizedName = type === 'workday' && !name.endsWith('补班') ? `${name}补班` : name
  map.set(date, { date, name: normalizedName, type })
}

function parseHolidayNotice(text: string, year: number): HolidayInfo[] {
  const normalized = normalizeText(text)
  const holidayMap = new Map<string, HolidayInfo>()

  for (const name of HOLIDAY_NAMES) {
    const sectionMatch = normalized.match(new RegExp(`${name}[:：]([^。]+(?:。[^一二三四五六七、]+)*)`))
    if (!sectionMatch) continue

    const section = sectionMatch[1]
    const holidayPart = section.split(/放假/)[0]
    const rangeMatches = [...holidayPart.matchAll(/((?:\d{1,2}月)?\d{1,2}日)(?:[（(][^）)]*[）)])?至((?:\d{1,2}月)?\d{1,2}日)/g)]

    if (rangeMatches.length > 0) {
      for (const match of rangeMatches) {
        const start = parseMonthDay(match[1])
        if (!start) continue
        const end = parseMonthDay(match[2], start.month)
        if (!end) continue
        for (const date of eachDateInRange(year, start, end)) {
          upsertParsedHoliday(holidayMap, date, name, 'holiday')
        }
      }
    } else {
      const singleDates = [...holidayPart.matchAll(/(\d{1,2}月\d{1,2}日)/g)]
      for (const match of singleDates) {
        const parsed = parseMonthDay(match[1])
        if (!parsed) continue
        upsertParsedHoliday(holidayMap, formatDate(year, parsed.month, parsed.day), name, 'holiday')
      }
    }

    const workdayPart = section.match(/(?:。|；|;)?([^。；;]*上班)/)?.[1] || ''
    const workdayMatches = [...workdayPart.matchAll(/(\d{1,2}月\d{1,2}日)/g)]
    for (const match of workdayMatches) {
      const parsed = parseMonthDay(match[1])
      if (!parsed) continue
      upsertParsedHoliday(holidayMap, formatDate(year, parsed.month, parsed.day), name, 'workday')
    }
  }

  return [...holidayMap.values()].sort((a, b) => a.date.localeCompare(b.date))
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'yulilog-worklog-holiday-updater/1.0',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

function collectCandidateUrls(value: unknown, keyword: string, urls: string[] = []): string[] {
  if (!value) return urls

  if (Array.isArray(value)) {
    for (const item of value) collectCandidateUrls(item, keyword, urls)
    return urls
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const joined = Object.values(record).filter((v) => typeof v === 'string').join(' ')
    const titleMatched = joined.includes(keyword) || joined.includes('部分节假日安排')
    for (const key of ['url', 'link', 'docpuburl', 'puburl', 'urlStr']) {
      const url = record[key]
      if (titleMatched && typeof url === 'string' && /^https?:\/\//.test(url)) {
        urls.push(url)
      }
    }
    for (const item of Object.values(record)) collectCandidateUrls(item, keyword, urls)
  }

  return urls
}

async function discoverNoticeUrl(year: number): Promise<string | null> {
  const keyword = `国务院办公厅关于${year}年部分节假日安排的通知`
  const query = new URLSearchParams({
    t: 'zhengcelibrary',
    q: keyword,
    sort: 'score',
    searchfield: 'title',
  })

  try {
    const apiText = await fetchText(`${GOV_SEARCH_API}?${query.toString()}`)
    const data = JSON.parse(apiText)
    const urls = collectCandidateUrls(data, keyword)
    const matchedUrl = urls.find((url) => url.includes('gov.cn')) || urls[0]
    if (matchedUrl) return matchedUrl
  } catch (error) {
    console.warn(`⚠️ 中国政府网搜索接口未返回 ${year} 年节假日通知:`, error instanceof Error ? error.message : error)
  }

  try {
    const pageText = await fetchText(`${GOV_SEARCH_PAGE}?${query.toString()}`)
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const linkMatch = pageText.match(new RegExp(`href=["']([^"']*gov\\.cn[^"']*)["'][^>]*>[\\s\\S]{0,200}${escapedKeyword}`))
    if (linkMatch) return linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.gov.cn${linkMatch[1]}`
  } catch (error) {
    console.warn(`⚠️ 中国政府网页面搜索未返回 ${year} 年节假日通知:`, error instanceof Error ? error.message : error)
  }

  return null
}

async function getExistingCount(year: number): Promise<number> {
  const result = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM holidays WHERE year = ?', year)
  return Number(result?.count || 0)
}

async function upsertHolidays(holidays: HolidayInfo[], sourceUrl: string): Promise<number> {
  const now = new Date().toISOString()
  let count = 0

  await db.transaction(async (client) => {
    for (const holiday of holidays) {
      const year = Number(holiday.date.slice(0, 4))
      await txRun(
        client,
        `INSERT INTO holidays (id, date, name, type, year, source_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
           name = excluded.name,
           type = excluded.type,
           year = excluded.year,
           source_url = excluded.source_url,
           updated_at = excluded.updated_at`,
        `holiday_${holiday.date}`,
        holiday.date,
        holiday.name,
        holiday.type,
        year,
        sourceUrl,
        now,
        now,
      )
      count++
    }
  })

  return count
}

export async function refreshHolidaysForYear(year: number, options: RefreshOptions = {}): Promise<RefreshResult> {
  const existingCount = await getExistingCount(year)
  if (!options.force && existingCount > 0) {
    return {
      year,
      updated: false,
      skipped: true,
      count: existingCount,
      message: `${year} 年节假日数据已存在，跳过自动更新`,
    }
  }

  const sourceUrl = options.sourceUrl || process.env.HOLIDAY_SOURCE_URL || await discoverNoticeUrl(year)
  if (!sourceUrl) {
    return {
      year,
      updated: false,
      skipped: false,
      count: 0,
      message: `未发现 ${year} 年国务院节假日通知`,
    }
  }

  const noticeText = await fetchText(sourceUrl)
  const holidays = parseHolidayNotice(noticeText, year)

  if (holidays.length === 0) {
    throw new Error(`未能从 ${sourceUrl} 解析到 ${year} 年节假日数据`)
  }

  const count = await upsertHolidays(holidays, sourceUrl)
  return {
    year,
    updated: true,
    skipped: false,
    count,
    sourceUrl,
    message: `已更新 ${year} 年节假日数据 ${count} 条`,
  }
}

export async function refreshCurrentAndNextYearHolidays(options: RefreshOptions = {}): Promise<RefreshResult[]> {
  const year = new Date().getFullYear()
  const years = [year, year + 1]
  const results: RefreshResult[] = []

  for (const targetYear of years) {
    try {
      const result = await refreshHolidaysForYear(targetYear, options)
      results.push(result)
      console.log(result.updated ? `✅ ${result.message}` : `ℹ️ ${result.message}`)
    } catch (error) {
      console.error(`❌ ${targetYear} 年节假日自动更新失败:`, error)
      results.push({
        year: targetYear,
        updated: false,
        skipped: false,
        count: 0,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}

export function setupHolidayAutoUpdater() {
  const run = () => {
    void refreshCurrentAndNextYearHolidays()
  }

  const scheduleNext = () => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 10, 0)
    let delay = target.getTime() - now.getTime()
    if (delay < 0) delay += DAY_MS

    setTimeout(() => {
      run()
      setInterval(run, DAY_MS)
    }, delay)
  }

  setTimeout(run, 30_000)
  scheduleNext()
  console.log('✅ 节假日自动更新任务已启动（启动后检查一次，并每日 03:10 检查今年和明年数据）')
}
