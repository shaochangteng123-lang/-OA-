import { Router } from 'express'
import { db } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// 获取所有节假日数据（公开接口，无需认证）
router.get('/', (req, res) => {
  try {
    const { year } = req.query

    let query = 'SELECT date, name, type FROM holidays WHERE 1=1'
    const params: any[] = []

    if (year) {
      query += ' AND year = ?'
      params.push(parseInt(year as string))
    }

    query += ' ORDER BY date ASC'

    const holidays = db.prepare(query).all(...params)

    res.json({
      success: true,
      data: holidays,
    })
  } catch (error) {
    console.error('获取节假日数据失败:', error)
    res.status(500).json({
      success: false,
      message: '获取节假日数据失败',
    })
  }
})

// 获取指定日期的节假日信息
router.get('/date/:date', (req, res) => {
  try {
    const { date } = req.params

    const holiday = db.prepare('SELECT date, name, type FROM holidays WHERE date = ?').get(date)

    if (!holiday) {
      return res.json({
        success: true,
        data: null,
      })
    }

    res.json({
      success: true,
      data: holiday,
    })
  } catch (error) {
    console.error('获取节假日信息失败:', error)
    res.status(500).json({
      success: false,
      message: '获取节假日信息失败',
    })
  }
})

// 批量更新节假日数据（需要管理员权限）
router.post('/update', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session?.userId
    const currentUser = db
      .prepare('SELECT role FROM users WHERE id = ?')
      .get(currentUserId) as { role: string } | undefined

    if (!currentUser || !['super_admin', 'admin'].includes(currentUser.role)) {
      return res.status(403).json({
        success: false,
        message: '无权更新节假日数据',
      })
    }

    const { holidays, sourceUrl } = req.body

    if (!Array.isArray(holidays)) {
      return res.status(400).json({
        success: false,
        message: '节假日数据格式错误',
      })
    }

    const now = new Date().toISOString()

    // 开始事务
    const transaction = db.transaction(() => {
      // 先删除所有现有数据（可选：可以只更新特定年份）
      // db.prepare('DELETE FROM holidays').run()

      // 插入或更新节假日数据
      const stmt = db.prepare(`
        INSERT INTO holidays (id, date, name, type, year, source_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          year = excluded.year,
          source_url = excluded.source_url,
          updated_at = excluded.updated_at
      `)

      for (const holiday of holidays) {
        const { date, name, type } = holiday
        const year = parseInt(date.split('-')[0])
        const id = `holiday_${date}`

        stmt.run(id, date, name, type, year, sourceUrl || null, now, now)
      }
    })

    transaction()

    res.json({
      success: true,
      message: '节假日数据更新成功',
      count: holidays.length,
    })
  } catch (error) {
    console.error('更新节假日数据失败:', error)
    res.status(500).json({
      success: false,
      message: '更新节假日数据失败',
    })
  }
})

// 获取指定年份的节假日数据
router.get('/year/:year', (req, res) => {
  try {
    const { year } = req.params
    const yearNum = parseInt(year)

    const holidays = db
      .prepare('SELECT date, name, type FROM holidays WHERE year = ? ORDER BY date ASC')
      .all(yearNum)

    res.json({
      success: true,
      data: holidays,
    })
  } catch (error) {
    console.error('获取年份节假日数据失败:', error)
    res.status(500).json({
      success: false,
      message: '获取年份节假日数据失败',
    })
  }
})

export default router





