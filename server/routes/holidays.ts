import { Router } from 'express'
import type { PoolClient } from 'pg'
import { db } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

function convertTxPlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

async function txRun(client: PoolClient, sql: string, ...params: any[]): Promise<{ changes: number }> {
  const result = await client.query(convertTxPlaceholders(sql), params)
  return { changes: result.rowCount ?? 0 }
}

router.get('/', async (req, res) => {
  try {
    const { year } = req.query
    let query = 'SELECT date, name, type FROM holidays WHERE 1=1'
    const params: any[] = []

    if (year) {
      query += ' AND year = ?'
      params.push(parseInt(year as string, 10))
    }

    query += ' ORDER BY date ASC'
    const holidays = await db.prepare(query).all(...params)

    res.json({ success: true, data: holidays })
  } catch (error) {
    console.error('获取节假日数据失败:', error)
    res.status(500).json({ success: false, message: '获取节假日数据失败' })
  }
})

router.get('/date/:date', async (req, res) => {
  try {
    const { date } = req.params
    const holiday = await db.prepare('SELECT date, name, type FROM holidays WHERE date = ?').get(date)

    res.json({ success: true, data: holiday || null })
  } catch (error) {
    console.error('获取节假日信息失败:', error)
    res.status(500).json({ success: false, message: '获取节假日信息失败' })
  }
})

router.post('/update', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session?.userId
    const currentUser = await db.prepare('SELECT role FROM users WHERE id = ?').get(currentUserId) as { role: string } | undefined

    if (!currentUser || !['super_admin', 'admin'].includes(currentUser.role)) {
      return res.status(403).json({ success: false, message: '无权更新节假日数据' })
    }

    const { holidays, sourceUrl } = req.body
    if (!Array.isArray(holidays)) {
      return res.status(400).json({ success: false, message: '节假日数据格式错误' })
    }

    const now = new Date().toISOString()

    await db.transaction(async (client) => {
      for (const holiday of holidays) {
        const { date, name, type } = holiday
        const year = parseInt(date.split('-')[0], 10)
        const id = `holiday_${date}`
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
          id,
          date,
          name,
          type,
          year,
          sourceUrl || null,
          now,
          now
        )
      }
    })

    res.json({ success: true, message: '节假日数据更新成功', count: holidays.length })
  } catch (error) {
    console.error('更新节假日数据失败:', error)
    res.status(500).json({ success: false, message: '更新节假日数据失败' })
  }
})

router.get('/year/:year', async (req, res) => {
  try {
    const yearNum = parseInt(req.params.year, 10)
    const holidays = await db.prepare('SELECT date, name, type FROM holidays WHERE year = ? ORDER BY date ASC').all(yearNum)
    res.json({ success: true, data: holidays })
  } catch (error) {
    console.error('获取年份节假日数据失败:', error)
    res.status(500).json({ success: false, message: '获取年份节假日数据失败' })
  }
})

export default router
