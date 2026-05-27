import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import { isAdminLike } from '../utils/worklog-auth.js'

const router = Router()

// 合同附件上传 multer 配置
const contractUploadsDir = path.resolve(process.cwd(), 'uploads/contract')
if (!fs.existsSync(contractUploadsDir)) {
  fs.mkdirSync(contractUploadsDir, { recursive: true })
}

const uploadContractAttachment = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, contractUploadsDir)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname)
      const base = path.basename(file.originalname, ext).replace(/[^\w一-龥-]/g, '_').slice(0, 40)
      cb(null, `${base}-${Date.now()}-${nanoid(6)}${ext}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('仅支持 JPG/PNG/PDF/Word/Excel'))
    }
    cb(null, true)
  },
})

interface ProjectRow {
  id: string
  name: string
  client_name: string
  client_contact_name: string
  client_contact_phone: string
  district: string
  project_type: string
  owner_user_id: string
  owner_name: string
  owner_position: string | null
  start_date: string
  is_completed: boolean
  completed_at: string | null
  contract_status: string | null
  contract_total_amount: number | null
  agency_bureau: string | null
  agency_department: string | null
  agency_contact_name: string | null
  agency_contact_phone: string | null
  created_by: string
  created_at: string
  updated_at: string
}

function toApi(p: ProjectRow) {
  return {
    id: p.id,
    name: p.name,
    clientName: p.client_name,
    clientContactName: p.client_contact_name,
    clientContactPhone: p.client_contact_phone,
    district: p.district,
    projectType: p.project_type,
    ownerUserId: p.owner_user_id,
    ownerName: p.owner_name,
    ownerPosition: p.owner_position,
    startDate: p.start_date,
    isCompleted: p.is_completed,
    completedAt: p.completed_at,
    contractStatus: p.contract_status,
    contractTotalAmount: p.contract_total_amount,
    agencyBureau: p.agency_bureau,
    agencyDepartment: p.agency_department,
    agencyContactName: p.agency_contact_name,
    agencyContactPhone: p.agency_contact_phone,
    createdBy: p.created_by,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }
}

/**
 * 项目列表
 * 普通员工：仅看自己是负责人 OR 自己写过日志的项目
 * admin/gm/super_admin：看全部
 * 支持查询：q（模糊匹配项目名，给下拉联想用）、district、ownerUserId、isCompleted
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const admin = await isAdminLike(userId)
    const { q, district, ownerUserId, isCompleted } = req.query as Record<string, string>

    const where: string[] = []
    const params: any[] = []

    if (!admin) {
      where.push(`(p.owner_user_id = ? OR EXISTS (SELECT 1 FROM worklog_entries e WHERE e.project_id = p.id AND e.user_id = ?))`)
      params.push(userId, userId)
    }
    if (q) { where.push(`p.name ILIKE ?`); params.push(`%${q}%`) }
    if (district) { where.push(`p.district = ?`); params.push(district) }
    if (ownerUserId) { where.push(`p.owner_user_id = ?`); params.push(ownerUserId) }
    if (isCompleted === 'true') { where.push(`p.is_completed = TRUE`) }
    if (isCompleted === 'false') { where.push(`p.is_completed = FALSE`) }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const rows = await db.all<ProjectRow & { entry_count: number }>(
      `SELECT p.*, COALESCE(ec.cnt, 0) AS entry_count
       FROM worklog_projects p
       LEFT JOIN (SELECT project_id, COUNT(*) AS cnt FROM worklog_entries GROUP BY project_id) ec ON ec.project_id = p.id
       ${whereSql} ORDER BY p.created_at ASC`,
      ...params,
    )
    res.json({ success: true, data: rows.map(r => ({ ...toApi(r), entryCount: r.entry_count })) })
  } catch (err) {
    console.error('获取项目列表失败:', err)
    res.status(500).json({ success: false, message: '获取项目列表失败' })
  }
})

/**
 * 新建项目；若已有同 name + client_name 的项目，直接返回已有项目（实现"联想+新增"）
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { name, clientName, clientContactName, clientContactPhone, district, projectType, ownerUserId, startDate, agencyBureau, agencyDepartment, agencyContactName, agencyContactPhone } = req.body as {
      name?: string; clientName?: string; clientContactName?: string; clientContactPhone?: string
      district?: string; projectType?: string
      ownerUserId?: string; startDate?: string
      agencyBureau?: string; agencyDepartment?: string; agencyContactName?: string; agencyContactPhone?: string
    }

    if (
      !name?.trim() || !clientName?.trim()
      || !clientContactName?.trim() || !clientContactPhone?.trim()
      || !district || !projectType || !ownerUserId
      || !agencyBureau?.trim() || !agencyDepartment?.trim()
      || !agencyContactName?.trim() || !agencyContactPhone?.trim()
    ) {
      return res.status(400).json({ success: false, message: '项目名称、甲方单位、甲方负责人、行政区、项目类型、负责人、办理机构信息均为必填' })
    }

    // 去重：同名 + 同甲方 视为同项目
    const existing = await db.get<ProjectRow>(
      `SELECT * FROM worklog_projects WHERE name = ? AND client_name = ?`,
      name.trim(), clientName.trim(),
    )
    if (existing) return res.json({ success: true, data: toApi(existing), existed: true })

    const owner = await db.get<{ name: string; position: string | null }>(
      `SELECT name, position FROM users WHERE id = ?`, ownerUserId,
    )
    if (!owner) return res.status(400).json({ success: false, message: '负责人用户不存在' })

    const id = nanoid()
    const now = new Date().toISOString()
    const sd = startDate || now.slice(0, 10)

    await db.run(
      `INSERT INTO worklog_projects
        (id, name, client_name, client_contact_name, client_contact_phone, district, project_type, owner_user_id, owner_name, owner_position, start_date, is_completed, agency_bureau, agency_department, agency_contact_name, agency_contact_phone, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?, ?, ?, ?, ?, ?)`,
      id, name.trim(), clientName.trim(), clientContactName.trim(), clientContactPhone.trim(),
      district, projectType,
      ownerUserId, owner.name, owner.position, sd,
      agencyBureau?.trim() || null, agencyDepartment?.trim() || null,
      agencyContactName?.trim() || null, agencyContactPhone?.trim() || null,
      userId, now, now,
    )

    const row = await db.get<ProjectRow>(`SELECT * FROM worklog_projects WHERE id = ?`, id)
    res.json({ success: true, data: toApi(row!) })
  } catch (err) {
    console.error('新建项目失败:', err)
    res.status(500).json({ success: false, message: '新建项目失败' })
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const row = await db.get<ProjectRow>(`SELECT * FROM worklog_projects WHERE id = ?`, req.params.id)
    if (!row) return res.status(404).json({ success: false, message: '项目不存在' })
    res.json({ success: true, data: toApi(row) })
  } catch (err) {
    console.error('获取项目详情失败:', err)
    res.status(500).json({ success: false, message: '获取项目详情失败' })
  }
})

/**
 * 更新项目基本信息
 * 负责人 + admin 可改；否则 403
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const row = await db.get<ProjectRow>(`SELECT * FROM worklog_projects WHERE id = ?`, req.params.id)
    if (!row) return res.status(404).json({ success: false, message: '项目不存在' })
    if (row.owner_user_id !== userId && !(await isAdminLike(userId))) {
      return res.status(403).json({ success: false, message: '仅负责人或管理员可修改项目' })
    }

    const { name, clientName, clientContactName, clientContactPhone, district, projectType, ownerUserId, agencyBureau, agencyDepartment, agencyContactName, agencyContactPhone } = req.body as Record<string, string>
    const sets: string[] = []
    const params: any[] = []
    if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()) }
    if (clientName !== undefined) { sets.push('client_name = ?'); params.push(clientName.trim()) }
    if (clientContactName !== undefined) { sets.push('client_contact_name = ?'); params.push(clientContactName.trim()) }
    if (clientContactPhone !== undefined) { sets.push('client_contact_phone = ?'); params.push(clientContactPhone.trim()) }
    if (district !== undefined) { sets.push('district = ?'); params.push(district) }
    if (projectType !== undefined) { sets.push('project_type = ?'); params.push(projectType) }
    if (agencyBureau !== undefined) { sets.push('agency_bureau = ?'); params.push(agencyBureau.trim() || null) }
    if (agencyDepartment !== undefined) { sets.push('agency_department = ?'); params.push(agencyDepartment.trim() || null) }
    if (agencyContactName !== undefined) { sets.push('agency_contact_name = ?'); params.push(agencyContactName.trim() || null) }
    if (agencyContactPhone !== undefined) { sets.push('agency_contact_phone = ?'); params.push(agencyContactPhone.trim() || null) }
    if (ownerUserId !== undefined) {
      const owner = await db.get<{ name: string; position: string | null }>(
        `SELECT name, position FROM users WHERE id = ?`, ownerUserId,
      )
      if (!owner) return res.status(400).json({ success: false, message: '负责人用户不存在' })
      sets.push('owner_user_id = ?', 'owner_name = ?', 'owner_position = ?')
      params.push(ownerUserId, owner.name, owner.position)
    }
    if (sets.length === 0) return res.status(400).json({ success: false, message: '没有可更新字段' })

    sets.push('updated_at = ?'); params.push(new Date().toISOString())
    params.push(req.params.id)

    await db.run(`UPDATE worklog_projects SET ${sets.join(', ')} WHERE id = ?`, ...params)
    res.json({ success: true })
  } catch (err) {
    console.error('更新项目失败:', err)
    res.status(500).json({ success: false, message: '更新项目失败' })
  }
})

router.post('/:id/complete', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const row = await db.get<ProjectRow>(`SELECT * FROM worklog_projects WHERE id = ?`, req.params.id)
    if (!row) return res.status(404).json({ success: false, message: '项目不存在' })
    if (row.owner_user_id !== userId && !(await isAdminLike(userId))) {
      return res.status(403).json({ success: false, message: '仅负责人或管理员可办结项目' })
    }
    const now = new Date().toISOString()
    await db.run(
      `UPDATE worklog_projects SET is_completed = TRUE, completed_at = ?, updated_at = ? WHERE id = ?`,
      now, now, req.params.id,
    )
    res.json({ success: true })
  } catch (err) {
    console.error('办结项目失败:', err)
    res.status(500).json({ success: false, message: '办结项目失败' })
  }
})

/**
 * 甘特图数据：按办理事项聚合，返回每个事项的
 *   firstDate: 首次日志日期
 *   lastDate:  最新日志日期
 *   daysElapsed: 已开展天数（含今天）
 *   standardDays: 字典中该事项的标准办理天数
 *   isOverdue: 是否超期
 *   isFinalized: 是否所有日志都已办结
 */
router.get('/:id/gantt', requireAuth, async (req, res) => {
  try {
    const projectId = req.params.id
    const project = await db.get<ProjectRow>(`SELECT * FROM worklog_projects WHERE id = ?`, projectId)
    if (!project) return res.status(404).json({ success: false, message: '项目不存在' })

    const rows = await db.all<{
      matter: string
      first_date: string
      last_date: string
      total_count: number
      finalized_count: number
    }>(
      `SELECT matter,
              MIN(log_date) AS first_date,
              MAX(log_date) AS last_date,
              COUNT(*)::int AS total_count,
              SUM(CASE WHEN is_finalized THEN 1 ELSE 0 END)::int AS finalized_count
       FROM worklog_entries
       WHERE project_id = ?
       GROUP BY matter`,
      projectId,
    )

    const today = new Date().toISOString().slice(0, 10)
    const matterDict = await db.all<{ name: string; standard_days: number | null }>(
      `SELECT name, standard_days FROM worklog_matters`,
    )
    const standardMap = new Map(matterDict.map(m => [m.name, m.standard_days]))

    const data = rows.map(r => {
      const isAllFinalized = r.total_count > 0 && r.total_count === r.finalized_count
      // 已办结则截止到最后日志日期，否则到今天
      const endDate = isAllFinalized ? r.last_date : today
      const start = new Date(r.first_date)
      const end = new Date(endDate)
      const daysElapsed = Math.max(0, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))) + 1
      const standardDays = standardMap.get(r.matter) ?? null
      const isOverdue = standardDays !== null && !isAllFinalized && daysElapsed > standardDays
      return {
        matter: r.matter,
        firstDate: r.first_date,
        lastDate: r.last_date,
        daysElapsed,
        standardDays,
        isOverdue,
        isFinalized: isAllFinalized,
        totalCount: r.total_count,
      }
    })

    res.json({ success: true, data: { project: toApi(project), matters: data } })
  } catch (err) {
    console.error('获取甘特图数据失败:', err)
    res.status(500).json({ success: false, message: '获取甘特图数据失败' })
  }
})

// ==================== 合同进度跟踪 ====================

interface ContractProgressRow {
  id: string
  project_id: string
  status: string
  amount: number | null
  note: string | null
  created_by: string
  created_by_name: string
  created_at: string
}

interface ContractAttachmentRow {
  id: string
  progress_id: string
  file_kind: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  created_at: string
}

router.get('/:id/contract', requireAuth, async (req, res) => {
  try {
    const project = await db.get<ProjectRow>(`SELECT * FROM worklog_projects WHERE id = ?`, req.params.id)
    if (!project) return res.status(404).json({ success: false, message: '项目不存在' })

    const rows = await db.all<ContractProgressRow>(
      `SELECT * FROM worklog_contract_progress WHERE project_id = ? ORDER BY created_at ASC`,
      req.params.id,
    )
    const progressIds = rows.map(r => r.id)
    let attachments: ContractAttachmentRow[] = []
    if (progressIds.length > 0) {
      const placeholders = progressIds.map(() => '?').join(',')
      attachments = await db.all<ContractAttachmentRow>(
        `SELECT * FROM worklog_contract_attachments WHERE progress_id IN (${placeholders}) ORDER BY created_at ASC`,
        ...progressIds,
      )
    }
    const attMap = new Map<string, ContractAttachmentRow[]>()
    for (const a of attachments) {
      if (!attMap.has(a.progress_id)) attMap.set(a.progress_id, [])
      attMap.get(a.progress_id)!.push(a)
    }

    const data = rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      status: r.status,
      amount: r.amount,
      note: r.note,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
      attachments: (attMap.get(r.id) || []).map(a => ({
        id: a.id,
        fileKind: a.file_kind,
        fileName: a.file_name,
        fileSize: a.file_size,
        mimeType: a.mime_type,
        createdAt: a.created_at,
      })),
    }))

    res.json({
      success: true,
      data: {
        contractStatus: (project as any).contract_status || null,
        contractTotalAmount: (project as any).contract_total_amount || null,
        progress: data,
      },
    })
  } catch (err) {
    console.error('获取合同进度失败:', err)
    res.status(500).json({ success: false, message: '获取合同进度失败' })
  }
})

router.post('/:id/contract', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const project = await db.get<ProjectRow>(`SELECT * FROM worklog_projects WHERE id = ?`, req.params.id)
    if (!project) return res.status(404).json({ success: false, message: '项目不存在' })

    const { status, amount, note } = req.body as { status?: string; amount?: number; note?: string }
    if (!status?.trim()) {
      return res.status(400).json({ success: false, message: '合同状态不能为空' })
    }

    const me = await db.get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, userId)
    const id = nanoid()
    const now = new Date().toISOString()

    await db.run(
      `INSERT INTO worklog_contract_progress (id, project_id, status, amount, note, created_by, created_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, req.params.id, status.trim(), amount ?? null, note?.trim() || null, userId, me?.name || '', now,
    )

    // 同步更新项目的合同状态快照
    await db.run(
      `UPDATE worklog_projects SET contract_status = ?, updated_at = ? WHERE id = ?`,
      status.trim(), now, req.params.id,
    )

    res.json({
      success: true,
      data: {
        id,
        projectId: req.params.id,
        status: status.trim(),
        amount: amount ?? null,
        note: note?.trim() || null,
        createdBy: userId,
        createdByName: me?.name || '',
        createdAt: now,
        attachments: [],
      },
    })
  } catch (err) {
    console.error('追加合同进度失败:', err)
    res.status(500).json({ success: false, message: '追加合同进度失败' })
  }
})

router.delete('/:id/contract/:progressId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const progress = await db.get<ContractProgressRow>(
      `SELECT * FROM worklog_contract_progress WHERE id = ? AND project_id = ?`,
      req.params.progressId, req.params.id,
    )
    if (!progress) return res.status(404).json({ success: false, message: '进度记录不存在' })

    const admin = await isAdminLike(userId)
    if (!admin && progress.created_by !== userId) {
      return res.status(403).json({ success: false, message: '只能删除自己的进度记录' })
    }

    // 删除关联附件文件
    const atts = await db.all<ContractAttachmentRow>(
      `SELECT * FROM worklog_contract_attachments WHERE progress_id = ?`, req.params.progressId,
    )
    await db.run(`DELETE FROM worklog_contract_progress WHERE id = ?`, req.params.progressId)
    for (const a of atts) {
      try {
        const full = path.resolve(process.cwd(), a.file_path)
        if (fs.existsSync(full)) fs.unlinkSync(full)
      } catch { /* ignore */ }
    }

    // 更新项目合同状态快照为最新一条
    const latest = await db.get<{ status: string }>(
      `SELECT status FROM worklog_contract_progress WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
      req.params.id,
    )
    await db.run(
      `UPDATE worklog_projects SET contract_status = ?, updated_at = ? WHERE id = ?`,
      latest?.status || null, new Date().toISOString(), req.params.id,
    )

    res.json({ success: true })
  } catch (err) {
    console.error('删除合同进度失败:', err)
    res.status(500).json({ success: false, message: '删除合同进度失败' })
  }
})

router.post('/:id/contract/:progressId/attachments', requireAuth, (req, res, next) => {
  (async () => {
    const progress = await db.get<ContractProgressRow>(
      `SELECT * FROM worklog_contract_progress WHERE id = ? AND project_id = ?`,
      req.params.progressId, req.params.id,
    )
    if (!progress) return res.status(404).json({ success: false, message: '进度记录不存在' })
    next()
  })().catch(next)
}, (req, res, next) => {
  uploadContractAttachment.single('file')(req, res, (err: any) => {
    if (err) {
      const msg = err instanceof multer.MulterError
        ? (err.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 10MB' : err.message)
        : (err.message || '上传失败')
      return res.status(400).json({ success: false, message: msg })
    }
    next()
  })
}, async (req, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ success: false, message: '未上传文件' })
    const fileKind = (req.body.file_kind || 'other') as string

    const relPath = path.relative(process.cwd(), file.path).replace(/\\/g, '/')
    const id = nanoid()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO worklog_contract_attachments (id, progress_id, file_kind, file_name, file_path, file_size, mime_type, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, req.params.progressId, fileKind,
      Buffer.from(file.originalname, 'latin1').toString('utf8'),
      relPath, file.size, file.mimetype, req.session.userId, now,
    )
    res.json({
      success: true,
      data: { id, fileKind, fileName: file.originalname, fileSize: file.size, mimeType: file.mimetype, createdAt: now },
    })
  } catch (err) {
    console.error('上传合同附件失败:', err)
    res.status(500).json({ success: false, message: '上传合同附件失败' })
  }
})

router.delete('/:id/contract/:progressId/attachments/:attId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const att = await db.get<ContractAttachmentRow>(
      `SELECT * FROM worklog_contract_attachments WHERE id = ? AND progress_id = ?`,
      req.params.attId, req.params.progressId,
    )
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' })

    const admin = await isAdminLike(userId)
    if (!admin && att.uploaded_by !== userId) {
      return res.status(403).json({ success: false, message: '只能删除自己上传的附件' })
    }

    await db.run(`DELETE FROM worklog_contract_attachments WHERE id = ?`, att.id)
    try {
      const full = path.resolve(process.cwd(), att.file_path)
      if (fs.existsSync(full)) fs.unlinkSync(full)
    } catch { /* ignore */ }

    res.json({ success: true })
  } catch (err) {
    console.error('删除合同附件失败:', err)
    res.status(500).json({ success: false, message: '删除合同附件失败' })
  }
})

// 更新项目合同总金额
router.put('/:id/contract-amount', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const project = await db.get<ProjectRow>(`SELECT * FROM worklog_projects WHERE id = ?`, req.params.id)
    if (!project) return res.status(404).json({ success: false, message: '项目不存在' })
    if (project.owner_user_id !== userId && !(await isAdminLike(userId))) {
      return res.status(403).json({ success: false, message: '仅负责人或管理员可修改' })
    }

    const { amount } = req.body as { amount?: number | null }
    await db.run(
      `UPDATE worklog_projects SET contract_total_amount = ?, updated_at = ? WHERE id = ?`,
      amount ?? null, new Date().toISOString(), req.params.id,
    )
    res.json({ success: true })
  } catch (err) {
    console.error('更新合同总金额失败:', err)
    res.status(500).json({ success: false, message: '更新合同总金额失败' })
  }
})

export default router
