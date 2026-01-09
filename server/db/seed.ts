import { db } from './index.js'
import { nanoid } from 'nanoid'

export function seedDatabase() {
  console.log('🌱 开始插入种子数据...')

  // 检查是否已经有数据
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  if (userCount.count > 0) {
    console.log('✅ 数据库已有数据，跳过种子数据插入')
    return
  }

  const now = new Date().toISOString()

  // 1. 插入默认超级管理员���用于开发测试）
  const adminId = nanoid()
  db.prepare(`
    INSERT INTO users (id, feishu_open_id, feishu_union_id, name, email, avatar_url, role, status, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    adminId,
    'mock_test_user_fixed_id',
    'mock_union_id',
    '系统管理员',
    'admin@example.com',
    '',
    'super_admin',
    'active',
    now,
    now,
    now
  )

  console.log('👤 已创建默认超级管理员')

  // 2. 插入政府部门数据
  const departments = [
    { fullName: '北京市规划和自然资源委员会', shortNames: '市规自委,规自委', website: 'http://ghzrzyw.beijing.gov.cn/' },
    { fullName: '北京市生态环境局', shortNames: '市生态环境局,生态环境局', website: 'http://sthjj.beijing.gov.cn/' },
    { fullName: '北京市水务局', shortNames: '市水务局,水务局', website: 'http://swj.beijing.gov.cn/' },
    { fullName: '北京市园林绿化局', shortNames: '市园林局,园林局', website: 'http://yllhj.beijing.gov.cn/' },
    { fullName: '北京市住房和城乡建设委员会', shortNames: '市住建委,住建委', website: 'http://zjw.beijing.gov.cn/' },
    { fullName: '北京市交通委员会', shortNames: '市交通委,交通委', website: 'http://jtw.beijing.gov.cn/' },
    { fullName: '北京市人民防空办公室', shortNames: '市人防办,人防办', website: 'http://rfb.beijing.gov.cn/' },
    { fullName: '北京市文物局', shortNames: '市文物局,文物局', website: 'http://wwj.beijing.gov.cn/' },
    { fullName: '北京市应急管理局', shortNames: '市应急局,应急局', website: 'http://yjglj.beijing.gov.cn/' },
    { fullName: '北京市消防救援总队', shortNames: '市消防总队,消防总队', website: '' },
    // 公司内部部门
    { fullName: '行政部', shortNames: '行政', website: '' },
    { fullName: '财务部', shortNames: '财务', website: '' },
    { fullName: '项目部', shortNames: '项目', website: '' }
  ]

  departments.forEach((dept, index) => {
    db.prepare(`
      INSERT INTO government_departments (id, full_name, short_names, website_url, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nanoid(),
      dept.fullName,
      dept.shortNames,
      dept.website,
      index + 1,
      1,
      now,
      now
    )
  })

  console.log(`🏢 已插入 ${departments.length} 个政府部门`)

  // 3. 插入默认事件库数据
  const eventTypes = [
    { name: '项目建议书审批', type: '行政许可', level: 1, duration: 20 },
    { name: '可行性研究报告审批', type: '行政许可', level: 1, duration: 30 },
    { name: '初步设计审批', type: '行政许可', level: 1, duration: 30 },
    { name: '施工图审查', type: '技术服务', level: 2, duration: 15 },
    { name: '建设工程规划许可证', type: '行政许可', level: 1, duration: 20 },
    { name: '建筑工程施工许可证', type: '行政许可', level: 1, duration: 15 },
    { name: '用地预审', type: '行政许可', level: 1, duration: 20 },
    { name: '用地规划许可证', type: '行政许可', level: 1, duration: 20 },
    { name: '环境影响评价', type: '行政许可', level: 1, duration: 30 },
    { name: '水土保持方案审批', type: '行政许可', level: 2, duration: 20 },
    { name: '节能评估审查', type: '行政确认', level: 2, duration: 15 },
    { name: '地震安全性评价审查', type: '行政确认', level: 2, duration: 20 },
    { name: '防洪评价审批', type: '行政许可', level: 2, duration: 25 },
    { name: '河道管理范围内建设项目审批', type: '行政许可', level: 2, duration: 15 },
    { name: '占用林地审批', type: '行政许可', level: 2, duration: 30 },
    { name: '绿化工程设计方案审查', type: '行政确认', level: 2, duration: 15 },
    { name: '古树名木迁移审批', type: '行政许可', level: 2, duration: 20 },
    { name: '文物保护审批', type: '行政许可', level: 2, duration: 30 },
    { name: '人防工程审批', type: '行政许可', level: 2, duration: 20 },
    { name: '消防设计审查', type: '行政许可', level: 2, duration: 15 },
    { name: '消防验收', type: '行政许可', level: 2, duration: 10 },
    { name: '安全设施设计审查', type: '行政确认', level: 2, duration: 15 },
    { name: '职业病危害预评价审查', type: '行政确认', level: 2, duration: 15 },
    { name: '交通影响评价', type: '行政确认', level: 2, duration: 20 },
    { name: '压覆矿产资源审批', type: '行政许可', level: 2, duration: 30 }
  ]

  eventTypes.forEach(event => {
    db.prepare(`
      INSERT INTO event_library (id, name, event_type, level, standard_duration, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      nanoid(),
      event.name,
      event.type,
      event.level,
      event.duration,
      now,
      now
    )
  })

  console.log(`📋 已插入 ${eventTypes.length} 个默认事件`)

  // 4. 插入默认板块分类
  const categories = [
    { name: '前期立项', description: '项目前期立项相关事项', sortOrder: 1 },
    { name: '用地规划', description: '用地和规划相关审批', sortOrder: 2 },
    { name: '工程建设', description: '工程建设相关审批', sortOrder: 3 },
    { name: '环境保护', description: '环保相关审批事项', sortOrder: 4 },
    { name: '专项评估', description: '各类专项评估审查', sortOrder: 5 }
  ]

  const categoryIds: Record<string, string> = {}
  categories.forEach(cat => {
    const id = nanoid()
    categoryIds[cat.name] = id
    db.prepare(`
      INSERT INTO block_categories (id, name, description, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, cat.name, cat.description, cat.sortOrder, 1, now, now)
  })

  console.log(`📦 已插入 ${categories.length} 个板块分类`)

  // 5. 插入默认预设方案
  const presets = [
    { name: '新改扩建-场站类', implType: '新改扩建', projType: '场站', isDefault: 1 },
    { name: '新改扩建-线性类', implType: '新改扩建', projType: '线性', isDefault: 1 },
    { name: '新改扩建-工民建类', implType: '新改扩建', projType: '工民建', isDefault: 1 },
    { name: '历史遗留-场站类', implType: '历史遗留', projType: '场站', isDefault: 1 },
    { name: '历史遗留-线性类', implType: '历史遗留', projType: '线性', isDefault: 1 },
    { name: '历史遗留-工民建类', implType: '历史遗留', projType: '工民建', isDefault: 1 }
  ]

  presets.forEach(preset => {
    db.prepare(`
      INSERT INTO event_presets (id, name, implementation_type, project_type, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      nanoid(),
      preset.name,
      preset.implType,
      preset.projType,
      preset.isDefault,
      now,
      now
    )
  })

  console.log(`⚙️ 已插入 ${presets.length} 个默认预设方案`)

  console.log('✅ 种子数据插入完成')
}
