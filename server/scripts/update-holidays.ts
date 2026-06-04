import 'dotenv/config'
import { initDatabase, pool } from '../db/index.js'
import { refreshHolidaysForYear } from '../services/holidayUpdater.js'

async function updateHolidays() {
  try {
    const year = Number(process.argv[2] || new Date().getFullYear() + 1)
    const force = process.env.HOLIDAY_UPDATE_FORCE !== 'false'

    console.log(`🔄 开始自动获取 ${year} 年节假日数据...`)
    await initDatabase()
    const result = await refreshHolidaysForYear(year, { force })

    if (result.updated) {
      console.log(`✅ ${result.message}`)
      console.log(`🔗 数据来源：${result.sourceUrl}`)
    } else {
      console.log(`ℹ️ ${result.message}`)
    }
  } catch (error) {
    console.error('❌ 更新节假日数据失败:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

updateHolidays().then(() => process.exit(0))
