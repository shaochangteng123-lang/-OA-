import type { PoolClient } from 'pg'
import { nanoid } from 'nanoid'
import type {
  ResignationDocument,
  ResignationDocumentType,
  ResignationRequest,
  ResignationTemplateType,
} from '../types/database.js'

export const RESIGNATION_ARCHIVE_TYPES = [
  'termination_agreement',
  'employee_handover_form',
  'settlement_confirmation',
  'compensation_agreement',
  'resignation_certificate',
] as const satisfies readonly ResignationDocumentType[]

export type ResignationArchiveType = (typeof RESIGNATION_ARCHIVE_TYPES)[number]

export const RESIGNATION_ARCHIVE_LABELS: Record<ResignationArchiveType, string> = {
  termination_agreement: '终止 / 解除劳动关系协议书',
  employee_handover_form: '员工离职交接单',
  settlement_confirmation: '薪资及各类款项结算确认书',
  compensation_agreement: '离职经济补偿协议书',
  resignation_certificate: '离职证明',
}

export const RESIGNATION_TEMPLATE_TYPES = [
  ...RESIGNATION_ARCHIVE_TYPES,
] as const satisfies readonly ResignationTemplateType[]

export function isResignationArchiveType(value: unknown): value is ResignationArchiveType {
  return typeof value === 'string'
    && (RESIGNATION_ARCHIVE_TYPES as readonly string[]).includes(value)
}

export function getMissingResignationArchiveTypes(
  documents: Pick<ResignationDocument, 'document_type' | 'is_current'>[],
): ResignationArchiveType[] {
  const uploadedTypes = new Set(
    documents
      .filter(document => document.is_current !== 0)
      .map(document => document.document_type),
  )
  return RESIGNATION_ARCHIVE_TYPES.filter(type => !uploadedTypes.has(type))
}

export interface ResignationArchiveCompletionResult {
  completed: boolean
  newlyCompleted: boolean
  missingTypes: ResignationArchiveType[]
  status: ResignationRequest['status']
  accountDisabled: boolean
}

interface LockedResignationArchiveState {
  request: {
    id: string
    employee_id: string
    employee_user_id: string | null
    status: ResignationRequest['status']
  }
  missingTypes: ResignationArchiveType[]
}

async function getLockedResignationArchiveState(
  client: PoolClient,
  requestId: string,
): Promise<LockedResignationArchiveState> {
  const requestResult = await client.query<LockedResignationArchiveState['request']>(
    `SELECT id, employee_id, employee_user_id, status
     FROM resignation_requests
     WHERE id = $1
     FOR UPDATE`,
    [requestId],
  )
  const request = requestResult.rows[0]
  if (!request) throw new Error('离职记录不存在')

  const documentResult = await client.query<Pick<ResignationDocument, 'document_type' | 'is_current'>>(
    `SELECT document_type, is_current
     FROM resignation_documents
     WHERE request_id = $1
       AND is_current = 1`,
    [requestId],
  )

  return {
    request,
    missingTypes: getMissingResignationArchiveTypes(documentResult.rows),
  }
}

export async function refreshResignationArchiveCompletionWithClient(
  client: PoolClient,
  requestId: string,
): Promise<ResignationArchiveCompletionResult> {
  const { request, missingTypes } = await getLockedResignationArchiveState(client, requestId)
  let status = request.status

  if (request.status === 'draft' && missingTypes.length === 0) {
    await client.query(
      `UPDATE resignation_requests
       SET status = 'pending_confirmation'
       WHERE id = $1
         AND status = 'draft'`,
      [requestId],
    )
    status = 'pending_confirmation'
  } else if (request.status === 'pending_confirmation' && missingTypes.length > 0) {
    await client.query(
      `UPDATE resignation_requests
       SET status = 'draft'
       WHERE id = $1
         AND status = 'pending_confirmation'`,
      [requestId],
    )
    status = 'draft'
  }

  return {
    completed: missingTypes.length === 0,
    newlyCompleted: false,
    missingTypes,
    status,
    accountDisabled: false,
  }
}

export async function finalizeResignationArchiveWithClient(
  client: PoolClient,
  requestId: string,
  operatorId: string,
  now: string,
): Promise<ResignationArchiveCompletionResult> {
  const { request, missingTypes } = await getLockedResignationArchiveState(client, requestId)
  if (missingTypes.length > 0) {
    return {
      completed: false,
      newlyCompleted: false,
      missingTypes,
      status: request.status,
      accountDisabled: false,
    }
  }
  if (request.status === 'approved') {
    return {
      completed: true,
      newlyCompleted: false,
      missingTypes: [],
      status: 'approved',
      accountDisabled: false,
    }
  }
  if (!['draft', 'pending_confirmation'].includes(request.status)) {
    return {
      completed: true,
      newlyCompleted: false,
      missingTypes: [],
      status: request.status,
      accountDisabled: false,
    }
  }

  const operatorResult = await client.query<{ name: string }>(
    `SELECT name FROM users WHERE id = $1`,
    [operatorId],
  )
  const operatorName = operatorResult.rows[0]?.name || null

  await client.query(
    `UPDATE resignation_requests
     SET status = 'approved',
         submit_time = COALESCE(submit_time, $1),
         approve_time = $1,
         approver_id = $2,
         approver_comment = '离职档案已全部归档，管理员确认完成离职',
         updated_at = $1
     WHERE id = $3`,
    [now, operatorId, requestId],
  )
  await client.query(
    `INSERT INTO resignation_audit_logs (
       id, request_id, action, operator_id, operator_name, comment, created_at
     ) VALUES ($1,$2,'离职档案归档完成',$3,$4,$5,$6)`,
    [
      nanoid(),
      requestId,
      operatorId,
      operatorName,
      '管理员已核对五类离职档案，员工状态已改为已离职，原账号已停用',
      now,
    ],
  )

  await client.query(
    `UPDATE employee_profiles
     SET employment_status = 'resigned', updated_at = $1
     WHERE id = $2`,
    [now, request.employee_id],
  )

  let accountDisabled = false
  if (request.employee_user_id) {
    const disabledResult = await client.query(
      `UPDATE users
       SET status = 'inactive', updated_at = $1
       WHERE id = $2
         AND status <> 'inactive'`,
      [now, request.employee_user_id],
    )
    accountDisabled = (disabledResult.rowCount ?? 0) > 0
  }

  return {
    completed: true,
    newlyCompleted: true,
    missingTypes: [],
    status: 'approved',
    accountDisabled,
  }
}
