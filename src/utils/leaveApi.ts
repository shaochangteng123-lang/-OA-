import { api } from '@/utils/api'

// ==================== 类型定义 ====================

export interface LeaveTypeConfig {
  id: string
  code: string
  name: string
  requires_attachment: boolean
  requires_balance_check: boolean
  default_days: number | null
  description: string | null
  sort_order: number
  is_active: boolean
  is_available?: boolean
  unavailable_reason?: string | null
}

export interface LeaveBalance {
  leave_type_code: string
  leave_type_name: string
  requires_balance_check: boolean
  year: number
  total_days: number
  used_days: number
  pending_days: number
  available_days: number
  is_available?: boolean
  unavailable_reason?: string | null
}

export interface LeaveRequest {
  id: string
  request_no: string
  user_id: string
  applicant_name: string
  applicant_department: string | null
  leave_type_code: string
  leave_type_name: string
  start_date: string
  start_half: 'morning' | 'afternoon'
  end_date: string
  end_half: 'morning' | 'afternoon'
  total_days: number
  reason: string
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled'
  approver_id: string | null
  approver_name: string | null
  approver_real_name?: string | null
  approver_position?: string | null
  cc_recipient_role?: string | null
  cc_recipient_name?: string | null
  reject_reason: string | null
  approved_at: string | null
  approval_notice_unread?: boolean
  rejection_notice_unread?: boolean
  rejected_at: string | null
  cancelled_at: string | null
  submitted_at: string
  version: number
  original_id: string | null
  application_kind: 'normal' | 'combined' | 'extension' | 'supplement'
  combination_group_id: string | null
  parent_request_id: string | null
  parent_request_no?: string | null
  parent_leave_type_name?: string | null
  parent_start_date?: string | null
  parent_start_half?: 'morning' | 'afternoon' | null
  parent_end_date?: string | null
  parent_end_half?: 'morning' | 'afternoon' | null
  parent_total_days?: number | null
  parent_reason?: string | null
  created_at: string
  updated_at: string
  remaining_days?: number | null
  remaining_leave_days?: number | null
  return_to_work_date?: string | null
  return_to_work_half?: 'morning' | 'afternoon' | null
  leave_timing_status?: 'not_applicable' | 'upcoming' | 'on_leave' | 'returned'
}

export interface LeaveRelatedRequestSummary {
  id: string
  request_no: string
  leave_type_name: string
  start_date: string
  start_half: 'morning' | 'afternoon'
  end_date: string
  end_half: 'morning' | 'afternoon'
  total_days: number
  reason: string
  status: LeaveRequest['status']
  application_kind: LeaveRequest['application_kind']
  combination_group_id?: string | null
}

export interface LeaveApprovalLog {
  id: string
  leave_request_id: string
  operator_id: string
  operator_name: string
  operator_real_name?: string | null
  operator_position?: string | null
  action: 'submit' | 'approve' | 'reject' | 'cancel' | 'resubmit'
  comment: string | null
  created_at: string
  version?: number
  request_no?: string
}

export interface LeaveAttachment {
  id: string
  leave_request_id: string
  file_name: string
  file_size: number | null
  mime_type: string | null
  created_at: string
  version?: number
  request_no?: string
}

export interface LeaveRequestDetail extends LeaveRequest {
  root_request_no: string
  version_count: number
  attachments: LeaveAttachment[]
  logs: LeaveApprovalLog[]
  parent_request: LeaveRelatedRequestSummary | null
  related_requests: LeaveRelatedRequestSummary[]
  combination_requests: LeaveRelatedRequestSummary[]
}

export interface LeaveRequestListResponse {
  list: LeaveRequest[]
  total: number
  page: number
  pageSize: number
}

export interface LeaveReviewHistoryItem extends LeaveRequest {
  review_action: 'approve' | 'reject'
  review_comment: string | null
  reviewed_at: string
}

export interface LeaveReviewHistoryResponse {
  list: LeaveReviewHistoryItem[]
  total: number
  page: number
  pageSize: number
}

// ==================== API 函数 ====================

// 获取假期类型列表
export async function getLeaveTypes(): Promise<LeaveTypeConfig[]> {
  const res = await api.get('/api/leave/types')
  return res.data.data
}

// 预计算请假时长
export async function calculateDays(params: {
  startDate: string
  startHalf: 'morning' | 'afternoon'
  endDate: string
  endHalf: 'morning' | 'afternoon'
  allowPast?: boolean
}): Promise<{ days: number }> {
  const res = await api.post('/api/leave/calculate-days', params)
  return res.data.data
}

// 根据开始时间和组合总天数自动计算结束时间
export async function calculatePeriodByDays(params: {
  startDate: string
  startHalf: 'morning' | 'afternoon'
  days: number
  allowPast?: boolean
}): Promise<{
  startDate: string
  startHalf: 'morning' | 'afternoon'
  endDate: string
  endHalf: 'morning' | 'afternoon'
  days: number
}> {
  const res = await api.post('/api/leave/calculate-period-by-days', params)
  return res.data.data
}

// 根据可用余额计算一键请满后的时间
export async function calculateFullLeavePeriod(params: {
  leaveTypeCode: string
  startDate: string
  startHalf: 'morning' | 'afternoon'
  allowPast?: boolean
}): Promise<{
  startDate: string
  startHalf: 'morning' | 'afternoon'
  endDate: string
  endHalf: 'morning' | 'afternoon'
  days: number
  availableDays: number
}> {
  const res = await api.post('/api/leave/calculate-full-period', params)
  return res.data.data
}

// 获取本人当年假期余额
export async function getMyBalances(): Promise<LeaveBalance[]> {
  const res = await api.get('/api/leave/balances')
  return res.data.data
}

// 提交请假申请（支持附件）
export async function submitLeaveRequest(formData: FormData): Promise<{ id: string; requestNo: string }> {
  const res = await api.post('/api/leave/requests', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return res.data.data
}

// 提交组合请假
export async function submitCombinedLeaveRequests(formData: FormData): Promise<{
  combinationGroupId: string
  requests: Array<{ id: string; requestNo: string }>
}> {
  const res = await api.post('/api/leave/requests/combined', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return res.data.data
}

// 获取本人申请列表
export async function getMyRequests(params?: {
  status?: string
  leaveTypeCode?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
}): Promise<LeaveRequestListResponse> {
  const res = await api.get('/api/leave/requests', { params })
  return res.data.data
}

// 获取单条申请详情
export async function getRequestDetail(id: string): Promise<LeaveRequestDetail> {
  const res = await api.get(`/api/leave/requests/${id}`)
  return res.data.data
}

// 确认已查看全部请假审批通过提醒
export async function markApprovedLeaveNoticesRead(): Promise<void> {
  await api.post('/api/leave/requests/approved/mark-read')
}

// 确认已查看指定请假驳回提醒
export async function markRejectedLeaveNoticeRead(id: string): Promise<number> {
  const res = await api.post(`/api/leave/requests/${id}/rejected/mark-read`)
  return Number(res.data.data?.remainingUnread || 0)
}

export interface RelatedLeaveContext {
  parentRequest: LeaveRequest
  suggestedExtensionStart: {
    date: string
    half: 'morning' | 'afternoon'
  } | null
}

// 获取续假、补假的主申请上下文
export async function getRelatedLeaveContext(id: string): Promise<RelatedLeaveContext> {
  const res = await api.get(`/api/leave/requests/${id}/related-context`)
  return res.data.data
}

// 提交续假或补假
export async function submitRelatedLeaveRequest(
  id: string,
  formData: FormData
): Promise<{
  id: string
  requestNo: string
  parentRequestNo: string
  combinationGroupId: string | null
  requests: Array<{ id: string; requestNo: string }>
}> {
  const res = await api.post(`/api/leave/requests/${id}/related`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return res.data.data
}

// 下载附件（返回 URL）
export function getAttachmentUrl(attachmentId: string): string {
  return `/api/leave/attachments/${attachmentId}/download`
}

// 撤回申请并转为草稿
export async function cancelRequest(id: string): Promise<void> {
  await api.post(`/api/leave/requests/${id}/cancel`)
}

// 草稿或驳回申请重新提交
export async function resubmitRequest(id: string, formData: FormData): Promise<{ id: string; requestNo: string }> {
  const res = await api.post(`/api/leave/requests/${id}/resubmit`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return res.data.data
}

// 永久删除草稿及其历史记录
export async function deleteDraftRequest(id: string): Promise<void> {
  await api.delete(`/api/leave/requests/${id}`)
}

// ==================== 审批端 ====================

// 获取待我审批列表
export async function getPendingRequests(): Promise<LeaveRequest[]> {
  const res = await api.get('/api/leave/pending')
  return res.data.data
}

// 获取当前总经理已处理的审批记录
export async function getReviewedRequests(params?: {
  page?: number
  pageSize?: number
}): Promise<LeaveReviewHistoryResponse> {
  const res = await api.get('/api/leave/reviewed', { params })
  return res.data.data
}

// 审批通过
export async function approveRequest(id: string, comment?: string): Promise<void> {
  await api.post(`/api/leave/requests/${id}/approve`, { comment })
}

// 驳回
export async function rejectRequest(id: string, rejectReason: string): Promise<void> {
  await api.post(`/api/leave/requests/${id}/reject`, { rejectReason })
}

// ==================== 管理员端 ====================

// 获取所有假期类型（管理员）
export async function adminGetTypes(): Promise<LeaveTypeConfig[]> {
  const res = await api.get('/api/leave/admin/types')
  return res.data.data
}

// 新增假期类型
export async function adminCreateType(data: {
  name: string
  default_days: number
  requires_balance_check: boolean
  requires_attachment: boolean
  description?: string
}): Promise<void> {
  await api.post('/api/leave/admin/types', data)
}

// 修改假期类型
export async function adminUpdateType(code: string, data: {
  name: string
  default_days: number
  requires_balance_check: boolean
  requires_attachment: boolean
  description?: string
}): Promise<void> {
  await api.put(`/api/leave/admin/types/${code}`, data)
}

// 删除假期类型
export async function adminDeleteType(code: string): Promise<void> {
  await api.delete(`/api/leave/admin/types/${code}`)
}

// 获取所有申请
export async function adminGetRequests(params?: {
  status?: string
  leaveTypeCode?: string
  userId?: string
  department?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
}): Promise<LeaveRequestListResponse> {
  const res = await api.get('/api/leave/admin/requests', { params })
  return res.data.data
}

// 获取所有人余额总览
export async function adminGetBalances(params?: {
  department?: string
  year?: number
}): Promise<{
  users: Array<Record<string, any>>
  types: Array<{ code: string; name: string; requires_balance_check: boolean }>
  year: number
}> {
  const res = await api.get('/api/leave/admin/balances', { params })
  return res.data.data
}

// 手动调整余额
export async function adminAdjustBalance(
  targetUserId: string,
  typeCode: string,
  year: number,
  totalDays: number
): Promise<void> {
  await api.put(`/api/leave/admin/balances/${targetUserId}/${typeCode}/${year}`, { totalDays })
}

// 导出请假记录
export function getExportUrl(params?: Record<string, string | number>): string {
  const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
  return `/api/leave/admin/export${query}`
}
