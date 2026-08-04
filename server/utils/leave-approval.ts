export const LEAVE_APPROVER_ROLES = ['general_manager', 'chairman'] as const

export type LeaveApproverRole = (typeof LEAVE_APPROVER_ROLES)[number]

export function getRequiredLeaveApproverRole(applicantRole: unknown): LeaveApproverRole {
  return applicantRole === 'general_manager' ? 'chairman' : 'general_manager'
}

export function isLeaveApproverRole(role: unknown): role is LeaveApproverRole {
  return LEAVE_APPROVER_ROLES.includes(role as LeaveApproverRole)
}

export function getLeaveApproverRoleName(role: LeaveApproverRole): string {
  return role === 'chairman' ? '董事长' : '总经理'
}

export function getLeaveApproverUnavailableMessage(applicantRole: unknown): string {
  const roleName = getLeaveApproverRoleName(getRequiredLeaveApproverRole(applicantRole))
  return `未找到可用的${roleName}审批人，请联系管理员配置${roleName}账号`
}
