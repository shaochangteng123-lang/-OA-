import { db } from '../db/index.js'
import { nanoid } from 'nanoid'

/**
 * 添加公司内部部门：行政部、财务部、项目部
 */
async function addInternalDepartments() {
  console.log('🔧 开始添加公司内部部门...')

  const now = new Date().toISOString()

  const departments = [
    { fullName: '行政部', shortNames: '行政', website: '' },
    { fullName: '财务部', shortNames: '财务', website: '' },
    { fullName: '项目部', shortNames: '项目', website: '' },
  ]

  let addedCount = 0
  let skippedCount = 0

  for (const dept of departments) {
    const existing = await db
      .prepare('SELECT id FROM government_departments WHERE full_name = ?')
      .get(dept.fullName)

    if (existing) {
      console.log(`⏭️  部门"${dept.fullName}"已存在，跳过`)
      skippedCount++
      continue
    }

    const maxSortOrder = await db
      .prepare('SELECT MAX(sort_order) as max_order FROM government_departments')
      .get() as { max_order: number | null }

    const sortOrder = (maxSortOrder.max_order ?? 0) + 1

    await db.prepare(
      `
      INSERT INTO government_departments (id, full_name, short_names, website_url, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      nanoid(),
      dept.fullName,
      dept.shortNames,
      dept.website || null,
      sortOrder,
      true,
      now,
      now
    )

    console.log(`✅ 已添加部门: ${dept.fullName}`)
    addedCount++
  }

  console.log(`\n📊 统计:`)
  console.log(`   - 新增部门: ${addedCount}`)
  console.log(`   - 跳过部门: ${skippedCount}`)
  console.log('✅ 部门添加完成')
}

if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '')) {
  addInternalDepartments().then(() => process.exit(0)).catch((error) => {
    console.error('❌ 失败:', error)
    process.exit(1)
  })
}

export { addInternalDepartments }
