import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import { checkEntryWritePermission, checkFinalizedLock, isAdminLike } from '../utils/worklog-auth.js'

const router = Router()

const worklogUploadsDir = path.resolve(process.cwd(), 'uploads/worklog')
if (!fs.existsSync(worklogUploadsDir)) {
  fs.mkdirSync(worklogUploadsDir, { recursive: true })
}

// multer 配置：按 projectId/logDate 分子目录
const uploadWorklogAttachment = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const entryId = req.params.id
        const entry = await db.get<{ project_id: string; log_date: string }>(
          `SELECT project_id, log_date FROM worklog_entries WHERE id = ?`,
          entryId,
        )
        if (!entry) return cb(new Error('日志不存在'), '')
        const destDir = path.join(worklogUploadsDir, entry.project_id, entry.log_date)
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
        cb(null, destDir)
      } catch (err: any) {
        cb(err, '')
      }
    },
    filename: (req, file, cb) => {
      const fileKind = (req.body.file_kind || req.query.file_kind || 'photo') as string
      const ext = path.extname(file.originalname)
      // 保留原文件名（去后缀）+ 时间戳 + 短 id，避免覆盖
      const base = path.basename(file.originalname, ext).replace(/[^\w一-龥-]/g, '_').slice(0, 40)
      cb(null, `${fileKind}-${base}-${Date.now()}-${nanoid(6)}${ext}`)
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 文档 ≤5MB；图片额外限制 3MB 在下方校验
  fileFilter: (req, file, cb) => {
    const kind = (req.body.file_kind || req.query.file_kind || 'photo') as string
    if (kind === 'image' || kind === 'screenshot' || kind === 'photo') {
      const ok = ['image/jpeg', 'image/png'].includes(file.mimetype)
      if (!ok) return cb(new Error('图片仅支持 JPG/PNG'))
      return cb(null, true)
    }
    if (kind === 'document') {
      const ok = [
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/pdf',
      ].includes(file.mimetype)
      if (!ok) return cb(new Error('文档仅支持 Word / Excel / PDF'))
      return cb(null, true)
    }
    cb(new Error('未知的 file_kind'))
  },
})

interface EntryRow {
  id: string
  log_date: string
  project_id: string
  matter: string
  user_id: string
  user_name: string
  user_position: string | null
  owner_user_id: string
  owner_name: string
  contract_status: string | null
  contract_note: string | null
  work_note: string | null
  client_contact_name: string | null
  client_contact_phone: string | null
  next_follow_up_date: string | null
  is_finalized: boolean
  finalized_at: string | null
  created_at: string
  updated_at: string
}

interface AttachmentRow {
  id: string
  entry_id: string
  file_kind: 'image' | 'screenshot' | 'photo' | 'document'
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  created_at: string
  progress_note_id: string | null
}

interface ProgressNoteRow {
  id: string
  entry_id: string
  content: string
  created_by: string
  created_by_name: string
  created_at: string
}

function toEntryApi(e: EntryRow, attachments: AttachmentRow[] = [], progressNotes: ProgressNoteRow[] = []) {
  const mapAttachment = (a: AttachmentRow) => ({
    id: a.id,
    fileKind: a.file_kind,
    fileName: a.file_name,
    filePath: a.file_path,
    fileSize: a.file_size,
    mimeType: a.mime_type,
    uploadedBy: a.uploaded_by,
    createdAt: a.created_at,
  })

  // 按 progress_note_id 分组附件
  const noteAttachMap = new Map<string, AttachmentRow[]>()
  const entryLevelAttachments: AttachmentRow[] = []
  for (const a of attachments) {
    if (a.progress_note_id) {
      if (!noteAttachMap.has(a.progress_note_id)) noteAttachMap.set(a.progress_note_id, [])
      noteAttachMap.get(a.progress_note_id)!.push(a)
    } else {
      entryLevelAttachments.push(a)
    }
  }

  return {
    id: e.id,
    logDate: e.log_date,
    projectId: e.project_id,
    matter: e.matter,
    userId: e.user_id,
    userName: e.user_name,
    userPosition: e.user_position,
    ownerUserId: e.owner_user_id,
    ownerName: e.owner_name,
    contractStatus: e.contract_status,
    contractNote: e.contract_note,
    workNote: e.work_note,
    clientContactName: e.client_contact_name,
    clientContactPhone: e.client_contact_phone,
    nextFollowUpDate: e.next_follow_up_date,
    isFinalized: e.is_finalized,
    finalizedAt: e.finalized_at,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    attachments: entryLevelAttachments.map(mapAttachment),
    progressNotes: progressNotes.map(n => ({
      id: n.id,
      entryId: n.entry_id,
      content: n.content,
      createdBy: n.created_by,
      createdByName: n.created_by_name,
      createdAt: n.created_at,
      attachments: (noteAttachMap.get(n.id) || []).map(mapAttachment),
    })),
  }
}

/**
 * 待跟进提醒列表：next_follow_up_date <= 今天 且未办结的日志
 */
router.get('/reminders', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const today = new Date().toISOString().slice(0, 10)
    const rows = await db.all<EntryRow & { project_name: string; district: string; client_name: string }>(
      `SELECT e.*, p.name AS project_name, p.district, p.client_name
       FROM worklog_entries e
       JOIN worklog_projects p ON p.id = e.project_id
       WHERE e.user_id = ?
         AND e.is_finalized = FALSE
         AND e.next_follow_up_date IS NOT NULL
         AND e.next_follow_up_date <= ?
       ORDER BY e.next_follow_up_date ASC`,
      userId, today,
    )
    const data = rows.map(r => ({
      id: r.id,
      logDate: r.log_date,
      projectName: r.project_name,
      matter: r.matter,
      district: r.district,
      nextFollowUpDate: r.next_follow_up_date,
      ownerName: r.owner_name,
    }))
    res.json({ success: true, data })
  } catch (err) {
    console.error('获取跟进提醒失败:', err)
    res.status(500).json({ success: false, message: '获取跟进提醒失败' })
  }
})

/**
 * 日志列表
 * 普通员工：仅自己的；admin：全部
 * 支持筛选：startDate/endDate/projectId/district/matter/ownerUserId/userId
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const admin = await isAdminLike(userId)
    const { startDate, endDate, projectId, district, matter, ownerUserId, userId: filterUserId } = req.query as Record<string, string>

    const where: string[] = []
    const params: any[] = []

    if (!admin) {
      where.push(`e.user_id = ?`)
      params.push(userId)
    } else if (filterUserId) {
      where.push(`e.user_id = ?`)
      params.push(filterUserId)
    }
    if (startDate) { where.push(`e.log_date >= ?`); params.push(startDate) }
    if (endDate) { where.push(`e.log_date <= ?`); params.push(endDate) }
    if (projectId) { where.push(`e.project_id = ?`); params.push(projectId) }
    if (matter) { where.push(`e.matter = ?`); params.push(matter) }
    if (ownerUserId) { where.push(`e.owner_user_id = ?`); params.push(ownerUserId) }
    if (district) { where.push(`p.district = ?`); params.push(district) }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const rows = await db.all<EntryRow & { district: string; project_name: string; client_name: string; client_contact_name: string; client_contact_phone: string; project_type: string; project_is_completed: boolean; agency_bureau: string; agency_department: string; agency_contact_name: string; agency_contact_phone: string }>(
      `SELECT e.*,
              p.district, p.name AS project_name,
              p.is_completed AS project_is_completed,
              COALESCE(e.client_name, p.client_name) AS client_name,
              COALESCE(e.client_contact_name, p.client_contact_name) AS client_contact_name,
              COALESCE(e.client_contact_phone, p.client_contact_phone) AS client_contact_phone,
              COALESCE(e.project_type, p.project_type) AS project_type,
              COALESCE(e.agency_bureau, p.agency_bureau) AS agency_bureau,
              COALESCE(e.agency_department, p.agency_department) AS agency_department,
              COALESCE(e.agency_contact_name, p.agency_contact_name) AS agency_contact_name,
              COALESCE(e.agency_contact_phone, p.agency_contact_phone) AS agency_contact_phone
       FROM worklog_entries e
       JOIN worklog_projects p ON p.id = e.project_id
       ${whereSql}
       ORDER BY e.created_at ASC`,
      ...params,
    )

    const ids = rows.map(r => r.id)
    let attachments: AttachmentRow[] = []
    let progressNotes: ProgressNoteRow[] = []
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',')
      attachments = await db.all<AttachmentRow>(
        `SELECT * FROM worklog_attachments WHERE entry_id IN (${placeholders}) ORDER BY created_at ASC`,
        ...ids,
      )
      progressNotes = await db.all<ProgressNoteRow>(
        `SELECT * FROM worklog_progress_notes WHERE entry_id IN (${placeholders}) ORDER BY created_at ASC`,
        ...ids,
      )
    }
    const attachMap = new Map<string, AttachmentRow[]>()
    for (const a of attachments) {
      if (!attachMap.has(a.entry_id)) attachMap.set(a.entry_id, [])
      attachMap.get(a.entry_id)!.push(a)
    }
    const progressMap = new Map<string, ProgressNoteRow[]>()
    for (const n of progressNotes) {
      if (!progressMap.has(n.entry_id)) progressMap.set(n.entry_id, [])
      progressMap.get(n.entry_id)!.push(n)
    }

    const data = rows.map(r => ({
      ...toEntryApi(r, attachMap.get(r.id) || [], progressMap.get(r.id) || []),
      projectName: r.project_name,
      clientName: r.client_name,
      district: r.district,
      clientContactName: r.client_contact_name,
      clientContactPhone: r.client_contact_phone,
      projectType: r.project_type,
      projectIsCompleted: !!r.project_is_completed,
      agencyBureau: r.agency_bureau,
      agencyDepartment: r.agency_department,
      agencyContactName: r.agency_contact_name,
      agencyContactPhone: r.agency_contact_phone,
    }))
    res.json({ success: true, data })
  } catch (err) {
    console.error('获取日志列表失败:', err)
    res.status(500).json({ success: false, message: '获取日志列表失败' })
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const row = await db.get<EntryRow & { district: string; project_name: string; client_name: string; client_contact_name: string; client_contact_phone: string; project_type: string; agency_bureau: string; agency_department: string; agency_contact_name: string; agency_contact_phone: string }>(
      `SELECT e.*,
              p.district, p.name AS project_name,
              COALESCE(e.client_name, p.client_name) AS client_name,
              COALESCE(e.client_contact_name, p.client_contact_name) AS client_contact_name,
              COALESCE(e.client_contact_phone, p.client_contact_phone) AS client_contact_phone,
              COALESCE(e.project_type, p.project_type) AS project_type,
              COALESCE(e.agency_bureau, p.agency_bureau) AS agency_bureau,
              COALESCE(e.agency_department, p.agency_department) AS agency_department,
              COALESCE(e.agency_contact_name, p.agency_contact_name) AS agency_contact_name,
              COALESCE(e.agency_contact_phone, p.agency_contact_phone) AS agency_contact_phone
       FROM worklog_entries e
       JOIN worklog_projects p ON p.id = e.project_id
       WHERE e.id = ?`, req.params.id,
    )
    if (!row) return res.status(404).json({ success: false, message: '日志不存在' })
    const attachments = await db.all<AttachmentRow>(
      `SELECT * FROM worklog_attachments WHERE entry_id = ? ORDER BY created_at ASC`, req.params.id,
    )
    const notes = await db.all<ProgressNoteRow>(
      `SELECT * FROM worklog_progress_notes WHERE entry_id = ? ORDER BY created_at ASC`, req.params.id,
    )
    res.json({
      success: true,
      data: {
        ...toEntryApi(row, attachments, notes),
        projectName: row.project_name,
        clientName: row.client_name,
        district: row.district,
        clientContactName: row.client_contact_name,
        clientContactPhone: row.client_contact_phone,
        projectType: row.project_type,
        agencyBureau: row.agency_bureau,
        agencyDepartment: row.agency_department,
        agencyContactName: row.agency_contact_name,
        agencyContactPhone: row.agency_contact_phone,
      },
    })
  } catch (err) {
    console.error('获取日志详情失败:', err)
    res.status(500).json({ success: false, message: '获取日志详情失败' })
  }
})

router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const {
      logDate, projectId, matter, ownerUserId,
      contractStatus, contractNote, workNote, nextFollowUpDate,
    } = req.body as {
      logDate?: string; projectId?: string; matter?: string; ownerUserId?: string
      contractStatus?: string; contractNote?: string; workNote?: string; nextFollowUpDate?: string
    }

    if (!logDate || !projectId || !matter || !ownerUserId) {
      return res.status(400).json({ success: false, message: '日期、项目、办理事项、负责人均为必填' })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
      return res.status(400).json({ success: false, message: '日期格式非法（YYYY-MM-DD）' })
    }
    if (nextFollowUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowUpDate)) {
      return res.status(400).json({ success: false, message: '跟进时间格式非法（YYYY-MM-DD）' })
    }

    const project = await db.get<{ id: string; is_completed: boolean; client_contact_name: string; client_contact_phone: string }>(
      `SELECT id, is_completed, client_contact_name, client_contact_phone FROM worklog_projects WHERE id = ?`, projectId,
    )
    if (!project) return res.status(400).json({ success: false, message: '项目不存在' })
    if (project.is_completed) return res.status(400).json({ success: false, message: '项目已办结，不能新增日志' })

    const [me, owner] = await Promise.all([
      db.get<{ name: string; position: string | null }>(`SELECT name, position FROM users WHERE id = ?`, userId),
      db.get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, ownerUserId),
    ])
    if (!me || !owner) return res.status(400).json({ success: false, message: '用户不存在' })

    const id = nanoid()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO worklog_entries
        (id, log_date, project_id, matter, user_id, user_name, user_position,
         owner_user_id, owner_name, contract_status, contract_note, work_note,
         client_contact_name, client_contact_phone, next_follow_up_date,
         is_finalized, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?)`,
      id, logDate, projectId, matter, userId, me.name, me.position,
      ownerUserId, owner.name, contractStatus ?? null, contractNote ?? null, workNote ?? null,
      project.client_contact_name || null, project.client_contact_phone || null,
      nextFollowUpDate ?? null,
      now, now,
    )

    const row = await db.get<EntryRow>(`SELECT * FROM worklog_entries WHERE id = ?`, id)
    res.json({ success: true, data: toEntryApi(row!) })
  } catch (err) {
    console.error('新建日志失败:', err)
    res.status(500).json({ success: false, message: '新建日志失败' })
  }
})

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const row = await db.get<EntryRow>(`SELECT * FROM worklog_entries WHERE id = ?`, req.params.id)
    if (!row) return res.status(404).json({ success: false, message: '日志不存在' })

    const lock = checkFinalizedLock(row)
    if (!lock.ok) return res.status(403).json({ success: false, message: lock.message })
    const perm = await checkEntryWritePermission(userId, row)
    if (!perm.ok) return res.status(403).json({ success: false, message: perm.message })

    const {
      logDate, matter, ownerUserId,
      contractStatus, contractNote, workNote, nextFollowUpDate,
      clientName, clientContactName, clientContactPhone,
      agencyBureau, agencyDepartment, agencyContactName, agencyContactPhone,
      projectType,
    } = req.body as Record<string, string | undefined>

    const sets: string[] = []
    const params: any[] = []
    if (logDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) return res.status(400).json({ success: false, message: '日期格式非法' })
      sets.push('log_date = ?'); params.push(logDate)
    }
    if (matter !== undefined) { sets.push('matter = ?'); params.push(matter) }
    if (ownerUserId !== undefined) {
      const owner = await db.get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, ownerUserId)
      if (!owner) return res.status(400).json({ success: false, message: '负责人不存在' })
      sets.push('owner_user_id = ?', 'owner_name = ?')
      params.push(ownerUserId, owner.name)
    }
    if (contractStatus !== undefined) { sets.push('contract_status = ?'); params.push(contractStatus || null) }
    if (contractNote !== undefined) { sets.push('contract_note = ?'); params.push(contractNote || null) }
    if (workNote !== undefined) { sets.push('work_note = ?'); params.push(workNote || null) }
    if (clientName !== undefined) { sets.push('client_name = ?'); params.push(clientName || null) }
    if (clientContactName !== undefined) { sets.push('client_contact_name = ?'); params.push(clientContactName || null) }
    if (clientContactPhone !== undefined) { sets.push('client_contact_phone = ?'); params.push(clientContactPhone || null) }
    if (agencyBureau !== undefined) { sets.push('agency_bureau = ?'); params.push(agencyBureau || null) }
    if (agencyDepartment !== undefined) { sets.push('agency_department = ?'); params.push(agencyDepartment || null) }
    if (agencyContactName !== undefined) { sets.push('agency_contact_name = ?'); params.push(agencyContactName || null) }
    if (agencyContactPhone !== undefined) { sets.push('agency_contact_phone = ?'); params.push(agencyContactPhone || null) }
    if (projectType !== undefined) { sets.push('project_type = ?'); params.push(projectType || null) }
    if (nextFollowUpDate !== undefined) {
      if (nextFollowUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowUpDate)) {
        return res.status(400).json({ success: false, message: '跟进时间格式非法（YYYY-MM-DD）' })
      }
      sets.push('next_follow_up_date = ?'); params.push(nextFollowUpDate || null)
    }
    if (sets.length === 0) return res.status(400).json({ success: false, message: '没有可更新字段' })

    sets.push('updated_at = ?'); params.push(new Date().toISOString())
    params.push(req.params.id)
    await db.run(`UPDATE worklog_entries SET ${sets.join(', ')} WHERE id = ?`, ...params)
    res.json({ success: true })
  } catch (err) {
    console.error('更新日志失败:', err)
    res.status(500).json({ success: false, message: '更新日志失败' })
  }
})

router.post('/:id/finalize', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const row = await db.get<EntryRow>(`SELECT * FROM worklog_entries WHERE id = ?`, req.params.id)
    if (!row) return res.status(404).json({ success: false, message: '日志不存在' })
    if (row.is_finalized) return res.json({ success: true }) // 幂等
    const perm = await checkEntryWritePermission(userId, row)
    if (!perm.ok) return res.status(403).json({ success: false, message: perm.message })
    const now = new Date().toISOString()
    await db.run(
      `UPDATE worklog_entries SET is_finalized = TRUE, finalized_at = ?, updated_at = ? WHERE id = ?`,
      now, now, req.params.id,
    )
    res.json({ success: true })
  } catch (err) {
    console.error('办结日志失败:', err)
    res.status(500).json({ success: false, message: '办结日志失败' })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const row = await db.get<EntryRow>(`SELECT * FROM worklog_entries WHERE id = ?`, req.params.id)
    if (!row) return res.status(404).json({ success: false, message: '日志不存在' })
    const lock = checkFinalizedLock(row)
    if (!lock.ok) return res.status(403).json({ success: false, message: lock.message })
    const perm = await checkEntryWritePermission(userId, row)
    if (!perm.ok) return res.status(403).json({ success: false, message: perm.message })

    const attachments = await db.all<AttachmentRow>(
      `SELECT * FROM worklog_attachments WHERE entry_id = ?`, req.params.id,
    )
    await db.run(`DELETE FROM worklog_entries WHERE id = ?`, req.params.id)

    // 物理删除磁盘文件（外键 ON DELETE CASCADE 已清表记录）
    for (const a of attachments) {
      try {
        const full = path.resolve(process.cwd(), a.file_path)
        if (fs.existsSync(full)) fs.unlinkSync(full)
      } catch (e) {
        console.warn('删除附件文件失败:', a.file_path, e)
      }
    }
    res.json({ success: true })
  } catch (err) {
    console.error('删除日志失败:', err)
    res.status(500).json({ success: false, message: '删除日志失败' })
  }
})

/**
 * 上传附件。file_kind 必须在 form-data 中以字段形式传
 */
router.post('/:id/attachments', requireAuth, (req, res, next) => {
  // 预检：日志存在 + 未办结 + 有写权限
  (async () => {
    const userId = req.session.userId!
    const row = await db.get<EntryRow>(`SELECT * FROM worklog_entries WHERE id = ?`, req.params.id)
    if (!row) return res.status(404).json({ success: false, message: '日志不存在' })
    const lock = checkFinalizedLock(row)
    if (!lock.ok) return res.status(403).json({ success: false, message: lock.message })
    const perm = await checkEntryWritePermission(userId, row)
    if (!perm.ok) return res.status(403).json({ success: false, message: perm.message })
    next()
  })().catch(next)
}, (req, res, next) => {
  uploadWorklogAttachment.single('file')(req, res, (err: any) => {
    if (err) {
      const msg = err instanceof multer.MulterError
        ? (err.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 5MB' : err.message)
        : (err.message || '上传失败')
      return res.status(400).json({ success: false, message: msg })
    }
    next()
  })
}, async (req, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ success: false, message: '未上传文件' })
    const fileKind = (req.body.file_kind || 'photo') as 'screenshot' | 'photo' | 'document'
    // 图片额外 3MB 上限
    if ((fileKind === 'screenshot' || fileKind === 'photo') && file.size > 3 * 1024 * 1024) {
      try { fs.unlinkSync(file.path) } catch {}
      return res.status(400).json({ success: false, message: '图片不能超过 3MB' })
    }

    const relPath = path.relative(process.cwd(), file.path).replace(/\\/g, '/')
    const id = nanoid()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO worklog_attachments (id, entry_id, file_kind, file_name, file_path, file_size, mime_type, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, req.params.id, fileKind,
      Buffer.from(file.originalname, 'latin1').toString('utf8'),
      relPath, file.size, file.mimetype, req.session.userId, now,
    )
    res.json({
      success: true,
      data: { id, fileKind, fileName: file.originalname, filePath: relPath, fileSize: file.size },
    })
  } catch (err) {
    console.error('上传附件失败:', err)
    res.status(500).json({ success: false, message: '上传附件失败' })
  }
})

router.delete('/:id/attachments/:attachmentId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const entry = await db.get<EntryRow>(`SELECT * FROM worklog_entries WHERE id = ?`, req.params.id)
    if (!entry) return res.status(404).json({ success: false, message: '日志不存在' })
    const lock = checkFinalizedLock(entry)
    if (!lock.ok) return res.status(403).json({ success: false, message: lock.message })
    const perm = await checkEntryWritePermission(userId, entry)
    if (!perm.ok) return res.status(403).json({ success: false, message: perm.message })

    const att = await db.get<AttachmentRow>(
      `SELECT * FROM worklog_attachments WHERE id = ? AND entry_id = ?`,
      req.params.attachmentId, req.params.id,
    )
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' })

    await db.run(`DELETE FROM worklog_attachments WHERE id = ?`, att.id)
    try {
      const full = path.resolve(process.cwd(), att.file_path)
      if (fs.existsSync(full)) fs.unlinkSync(full)
    } catch (e) {
      console.warn('删除附件磁盘文件失败:', att.file_path, e)
    }
    res.json({ success: true })
  } catch (err) {
    console.error('删除附件失败:', err)
    res.status(500).json({ success: false, message: '删除附件失败' })
  }
})

// ==================== 进展记录（时间线） ====================

router.get('/:id/progress', requireAuth, async (req, res) => {
  try {
    const rows = await db.all<ProgressNoteRow>(
      `SELECT * FROM worklog_progress_notes WHERE entry_id = ? ORDER BY created_at ASC`,
      req.params.id,
    )
    res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id,
        entryId: r.entry_id,
        content: r.content,
        createdBy: r.created_by,
        createdByName: r.created_by_name,
        createdAt: r.created_at,
      })),
    })
  } catch (err) {
    console.error('获取进展记录失败:', err)
    res.status(500).json({ success: false, message: '获取进展记录失败' })
  }
})

router.post('/:id/progress', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const row = await db.get<EntryRow>(`SELECT * FROM worklog_entries WHERE id = ?`, req.params.id)
    if (!row) return res.status(404).json({ success: false, message: '日志不存在' })
    const lock = checkFinalizedLock(row)
    if (!lock.ok) return res.status(403).json({ success: false, message: lock.message })
    const perm = await checkEntryWritePermission(userId, row)
    if (!perm.ok) return res.status(403).json({ success: false, message: perm.message })

    const { content, nextFollowUpDate } = req.body as { content?: string; nextFollowUpDate?: string }
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: '进展内容不能为空' })
    }
    if (!nextFollowUpDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowUpDate)) {
      return res.status(400).json({ success: false, message: '预计下次跟进时间为必填项（格式 YYYY-MM-DD）' })
    }

    const me = await db.get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, userId)
    const id = nanoid()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO worklog_progress_notes (id, entry_id, content, created_by, created_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, req.params.id, content.trim(), userId, me?.name || '', now,
    )
    await db.run(`UPDATE worklog_entries SET updated_at = ?, next_follow_up_date = ? WHERE id = ?`, now, nextFollowUpDate, req.params.id)
    res.json({
      success: true,
      data: { id, entryId: req.params.id, content: content.trim(), createdBy: userId, createdByName: me?.name || '', createdAt: now },
    })
  } catch (err) {
    console.error('追加进展失败:', err)
    res.status(500).json({ success: false, message: '追加进展失败' })
  }
})

router.delete('/:id/progress/:noteId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const note = await db.get<ProgressNoteRow>(
      `SELECT * FROM worklog_progress_notes WHERE id = ? AND entry_id = ?`,
      req.params.noteId, req.params.id,
    )
    if (!note) return res.status(404).json({ success: false, message: '进展记录不存在' })

    const admin = await isAdminLike(userId)
    if (!admin && note.created_by !== userId) {
      return res.status(403).json({ success: false, message: '只能删除自己的进展记录' })
    }

    await db.run(`DELETE FROM worklog_progress_notes WHERE id = ?`, note.id)
    res.json({ success: true })
  } catch (err) {
    console.error('删除进展记录失败:', err)
    res.status(500).json({ success: false, message: '删除进展记录失败' })
  }
})

router.post('/:id/progress/:noteId/attachments', requireAuth, (req, res, next) => {
  (async () => {
    const userId = req.session.userId!
    const row = await db.get<EntryRow>(`SELECT * FROM worklog_entries WHERE id = ?`, req.params.id)
    if (!row) return res.status(404).json({ success: false, message: '日志不存在' })
    const lock = checkFinalizedLock(row)
    if (!lock.ok) return res.status(403).json({ success: false, message: lock.message })
    const perm = await checkEntryWritePermission(userId, row)
    if (!perm.ok) return res.status(403).json({ success: false, message: perm.message })
    const note = await db.get<ProgressNoteRow>(
      `SELECT * FROM worklog_progress_notes WHERE id = ? AND entry_id = ?`,
      req.params.noteId, req.params.id,
    )
    if (!note) return res.status(404).json({ success: false, message: '进展记录不存在' })
    next()
  })().catch(next)
}, (req, res, next) => {
  uploadWorklogAttachment.single('file')(req, res, (err: any) => {
    if (err) {
      const msg = err instanceof multer.MulterError
        ? (err.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 5MB' : err.message)
        : (err.message || '上传失败')
      return res.status(400).json({ success: false, message: msg })
    }
    next()
  })
}, async (req, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ success: false, message: '未上传文件' })
    const fileKind = (req.body.file_kind || 'photo') as 'screenshot' | 'photo' | 'document'
    if ((fileKind === 'screenshot' || fileKind === 'photo') && file.size > 3 * 1024 * 1024) {
      try { fs.unlinkSync(file.path) } catch {}
      return res.status(400).json({ success: false, message: '图片不能超过 3MB' })
    }

    const relPath = path.relative(process.cwd(), file.path).replace(/\\/g, '/')
    const id = nanoid()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO worklog_attachments (id, entry_id, file_kind, file_name, file_path, file_size, mime_type, uploaded_by, created_at, progress_note_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, req.params.id, fileKind,
      Buffer.from(file.originalname, 'latin1').toString('utf8'),
      relPath, file.size, file.mimetype, req.session.userId, now, req.params.noteId,
    )
    res.json({
      success: true,
      data: { id, fileKind, fileName: file.originalname, filePath: relPath, fileSize: file.size, mimeType: file.mimetype },
    })
  } catch (err) {
    console.error('上传进展附件失败:', err)
    res.status(500).json({ success: false, message: '上传进展附件失败' })
  }
})

export default router
