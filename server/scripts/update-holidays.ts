/**
 * 节假日数据更新脚本
 * 用于从政府网站获取并更新节假日数据
 * 
 * 使用方法：
 * 1. 手动更新：编辑此文件中的 holidays2026 数组，然后运行此脚本
 * 2. 自动更新：需要实现网页爬取功能（可选）
 */

import 'dotenv/config'
import { db } from '../db/index.js'
import { initDatabase } from '../db/index.js'

// 2026年节假日数据（根据国务院办公厅通知）
// 数据来源：https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html
const holidays2026 = [
  // 一、元旦：1月1日（周四）至3日（周六）放假调休，共3天。1月4日（周日）上班。
  { date: '2026-01-01', name: '元旦', type: 'holiday' as const },
  { date: '2026-01-02', name: '元旦', type: 'holiday' as const },
  { date: '2026-01-03', name: '元旦', type: 'holiday' as const },
  { date: '2026-01-04', name: '元旦补班', type: 'workday' as const },

  // 二、春节：2月15日（农历腊月二十八、周日）至23日（农历正月初七、周一）放假调休，共9天。2月14日（周六）、2月28日（周六）上班。
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

  // 三、清明节：4月4日（周六）至6日（周一）放假，共3天。
  { date: '2026-04-04', name: '清明节', type: 'holiday' as const },
  { date: '2026-04-05', name: '清明节', type: 'holiday' as const },
  { date: '2026-04-06', name: '清明节', type: 'holiday' as const },

  // 四、劳动节：5月1日（周五）至5日（周二）放假调休，共5天。5月9日（周六）上班。
  { date: '2026-05-01', name: '劳动节', type: 'holiday' as const },
  { date: '2026-05-02', name: '劳动节', type: 'holiday' as const },
  { date: '2026-05-03', name: '劳动节', type: 'holiday' as const },
  { date: '2026-05-04', name: '劳动节', type: 'holiday' as const },
  { date: '2026-05-05', name: '劳动节', type: 'holiday' as const },
  { date: '2026-05-09', name: '劳动节补班', type: 'workday' as const },

  // 五、端午节：6月19日（周五）至21日（周日）放假，共3天。
  { date: '2026-06-19', name: '端午节', type: 'holiday' as const },
  { date: '2026-06-20', name: '端午节', type: 'holiday' as const },
  { date: '2026-06-21', name: '端午节', type: 'holiday' as const },

  // 六、中秋节：9月25日（周五）至27日（周日）放假，共3天。
  { date: '2026-09-25', name: '中秋节', type: 'holiday' as const },
  { date: '2026-09-26', name: '中秋节', type: 'holiday' as const },
  { date: '2026-09-27', name: '中秋节', type: 'holiday' as const },

  // 七、国庆节：10月1日（周四）至7日（周三）放假调休，共7天。9月20日（周日）、10月10日（周六）上班。
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

async function updateHolidays() {
  try {
    console.log('🔄 开始更新节假日数据...')

    // 初始化数据库
    initDatabase()

    const now = new Date().toISOString()

    // 开始事务
    const transaction = db.transaction(() => {
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

      let count = 0
      for (const holiday of holidays2026) {
        const { date, name, type } = holiday
        const year = parseInt(date.split('-')[0])
        const id = `holiday_${date}`

        stmt.run(id, date, name, type, year, sourceUrl, now, now)
        count++
      }

      console.log(`✅ 成功更新 ${count} 条节假日数据`)
    })

    transaction()

    // 验证数据
    const count = db.prepare('SELECT COUNT(*) as count FROM holidays').get() as { count: number }
    console.log(`📊 数据库中现有 ${count.count} 条节假日记录`)

    console.log('✅ 节假日数据更新完成')
  } catch (error) {
    console.error('❌ 更新节假日数据失败:', error)
    process.exit(1)
  }
}

// 运行更新
updateHolidays().then(() => {
  process.exit(0)
})





