/**
 * 报销模块常量定义
 */

// 报销类型 - 行政办公
export const ADMIN_TYPES = [
  { label: '办公设备', value: 'office_equipment' },
  { label: '办公器具', value: 'office_tools' },
  { label: '办公耗材', value: 'office_supplies' },
  { label: '劳保用品', value: 'labor_protection' },
  { label: '水电费', value: 'utilities' },
  { label: '物业费', value: 'property_fee' },
  { label: '清洁费', value: 'cleaning_fee' },
  { label: '差旅费', value: 'travel_expense' },
  { label: '茶水费', value: 'refreshment' },
] as const

// 报销类型 - 三方服务
export const SERVICE_TYPES = [
  { label: '图文服务', value: 'graphic_service' },
  { label: '快递服务', value: 'express_service' },
  { label: '车辆服务', value: 'vehicle_service' },
  { label: '物流服务', value: 'logistics_service' },
  { label: '公证服务', value: 'notary_service' },
  { label: '咨询服务', value: 'consulting_service' },
  { label: '技术服务', value: 'technical_service' },
  { label: '制证服务', value: 'certificate_service' },
] as const

// 报销类型 - 业务提升
export const BUSINESS_TYPES = [
  { label: '培训费', value: 'training_fee' },
  { label: '知识付费', value: 'knowledge_payment' },
  { label: '专家指导', value: 'expert_guidance' },
] as const

// 所有基础报销类型
export const ALL_BASIC_TYPES = [...ADMIN_TYPES, ...SERVICE_TYPES, ...BUSINESS_TYPES]

// 商务报销类型
export const BUSINESS_REIMBURSEMENT_TYPES = [
  { label: '商务接待', value: 'reception' },
  { label: '客户拜访', value: 'visit' },
  { label: '商务差旅', value: 'travel' },
  { label: '会议活动', value: 'meeting' },
] as const

// 报销单状态
export const REIMBURSEMENT_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const

// 状态文本映射
export const STATUS_TEXT_MAP: Record<string, string> = {
  draft: '待提交',
  pending: '待审批',
  approved: '已通过',
  rejected: '已拒绝',
}

// 状态颜色映射
export const STATUS_TYPE_MAP: Record<string, string> = {
  draft: 'info',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
}

// 商务类型文本映射
export const BUSINESS_TYPE_TEXT_MAP: Record<string, string> = {
  reception: '商务接待',
  visit: '客户拜访',
  travel: '商务差旅',
  meeting: '会议活动',
}

// 商务类型颜色映射
export const BUSINESS_TYPE_COLOR_MAP: Record<string, string> = {
  reception: 'success',
  visit: 'primary',
  travel: 'warning',
  meeting: 'info',
}

// 大额报销金额阈值
export const LARGE_AMOUNT_THRESHOLD = 1000

// 文件上传限制
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  BASIC_MAX_FILES: 5,
  LARGE_MAX_FILES: 10,
  ACCEPTED_TYPES: '.pdf',
}

// 根据类型值获取标签
export function getTypeLabel(value: string): string {
  const type = ALL_BASIC_TYPES.find(t => t.value === value)
  return type?.label || value
}

// 获取状态文本
export function getStatusText(status: string): string {
  return STATUS_TEXT_MAP[status] || status
}

// 获取状态类型（用于 el-tag）
export function getStatusType(status: string): string {
  return STATUS_TYPE_MAP[status] || 'info'
}

// 获取商务类型文本
export function getBusinessTypeText(type: string): string {
  return BUSINESS_TYPE_TEXT_MAP[type] || type
}

// 获取商务类型颜色
export function getBusinessTypeColor(type: string): string {
  return BUSINESS_TYPE_COLOR_MAP[type] || ''
}
