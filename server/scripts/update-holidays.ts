import 'dotenv/config'
import { db, initDatabase } from '../db/index.js'
import type { PoolClient } from 'pg'

const holidays2026 = [
  { date: '2026-01-01', name: '元旦', type: 'holiday' as const },
  { date: '2026-01-02', name: '元旦', type: 'holiday' as const },
  { date: '2026-01-03', name: '元旦', type: 'holiday' as const },
  { date: '2026-01-04', name: '元旦补班', type: 'workday' as const },
  { date: '2026-02-14', name: '春节补班', type: 'workday' as const },
  { date: '2026-02-15', name: '春节', type: 'holiday' as const },
  { date: '2026-02-16', name: '春节', type: 'holiday' as const },
  { date: '2026-02-17', name: '春节', type: 'holiday' as const },
  { date: '2026-02-18', name: '春节', type: 'holiday' as const },
  { date: '2026-02-19', name: '春节', type: 'holiday' as const },
  { date: '2026-02-20', name: '春节', type: 'holiday' as const },
  { date: '2026-02-21', name: '春节', type: 'holiday' as const },
  { date: '2026-02-22', name: '春节', type: 'holiday' as const },
  { date: '2026-02-23', name: '春节', type: 'holiday' as const },
  { date: '2026-02-28', name: '春节补班', type: 'workday' as const },
  { date: '2026-04-04', name: '清明节', type: 'holiday' as const },
  { date: '2026-04-05', name: '清明节', type: 'holiday' as const },
  { date: '2026-04-06', name: '清明节', type: 'holiday' as const },
  { date: '2026-05-01', name: '劳动节', type: 'holiday' as const },
  { date: '2026-05-02', name: '劳动节', type: 'holiday' as const },
  { date: '2026-05-03', name: '劳动节', type: 'holiday' as const },
  { date: '2026-05-04', name: '劳动节', type: 'holiday' as const },
  { date: '2026-05-05', name: '劳动节', type: 'holiday' as const },
  { date: '2026-05-09', name: '劳动节补班', type: 'workday' as const },
  { date: '2026-06-19', name: '端午节', type: 'holiday' as const },
  { date: '2026-06-20', name: '端午节', type: 'holiday' as const },
  { date: '2026-06-21', name: '端午节', type: 'holiday' as const },
  { date: '2026-09-25', name: '中秋节', type: 'holiday' as const },
  { date: '2026-09-26', name: '中秋节', type: 'holiday' as const },
  { date: '2026-09-27', name: '中秋节', type: 'holiday' as const },
  { date: '2026-09-20', name: '国庆节补班', type: 'workday' as const },
  { date: '2026-10-01', name: '国庆节', type: 'holiday' as const },
  { date: '2026-10-02', name: '国庆节', type: 'holiday' as const },
  { date: '2026-10-03', name: '国庆节', type: 'holiday' as const },
  { date: '2026-10-04', name: '国庆节', type: 'holiday' as const },
  { date: '2026-10-05', name: '国庆节', type: 'holiday' as const },
  { date: '2026-10-06', name: '国庆节', type: 'holiday' as const },
  { date: '2026-10-07', name: '国庆节', type: 'holiday' as const },
  { date: '2026-10-10', name: '国庆节补班', type: 'workday' as const },
]

const sourceUrl = 'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html'

function convert(sql: string) {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

async function updateHolidays() {
  try {
    console.log('🔄 开始更新节假日数据...')
    await initDatabase()
    const now = new Date().toISOString()
    let count = 0

    await db.transaction(async (client: PoolClient) => {
      for (const holiday of holidays2026) {
        const { date, name, type } = holiday
        const year = parseInt(date.split('-')[0], 10)
        const id = `holiday_${date}`
        await client.query(
          convert(`
            INSERT INTO holidays (id, date, name, type, year, source_url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
              name = excluded.name,
              type = excluded.type,
              year = excluded.year,
              source_url = excluded.source_url,
              updated_at = excluded.updated_at
          `),
          [id, date, name, type, year, sourceUrl, now, now]
        )
        count++
      }
    })

    console.log(`✅ 成功更新 ${count} 条节假日数据`)
    const countResult = await db.prepare('SELECT COUNT(*) as count FROM holidays').get() as { count: string | number }
    console.log(`📊 数据库中现有 ${countResult.count} 条节假日记录`)
    console.log('✅ 节假日数据更新完成')
  } catch (error) {
    console.error('❌ 更新节假日数据失败:', error)
    process.exit(1)
  }
}

updateHolidays().then(() => process.exit(0))
