export const LEAVE_APPROVER_ROLES = ['general_manager', 'chairman'] as const

export const LEAVE_GENERAL_MANAGER_WORKSPACE_ROLES = [
  'general_manager',
  'super_admin',
] as const

export const LEAVE_OPERATION_ROLES = [
  ...LEAVE_APPROVER_ROLES,
  'super_admin',
] as const

export type LeaveApproverRole = (typeof LEAVE_APPROVER_ROLES)[number]

export type LeaveGeneralManagerWorkspaceRole =
  (typeof LEAVE_GENERAL_MANAGER_WORKSPACE_ROLES)[number]

interface LeaveOperationScope {
  operatorId: string
  operatorRole: unknown
  applicantId: string
  applicantRole: unknown
  assignedApproverId: string | null
  assignedApproverRole: unknown
  assignedApproverStatus: unknown
}

export function getRequiredLeaveApproverRole(applicantRole: unknown): LeaveApproverRole {
  return applicantRole === 'general_manager' ? 'chairman' : 'general_manager'
}

export function isLeaveApproverRole(role: unknown): role is LeaveApproverRole {
  return LEAVE_APPROVER_ROLES.includes(role as LeaveApproverRole)
}

export function canAccessGeneralManagerLeaveWorkspace(
  role: unknown,
): role is LeaveGeneralManagerWorkspaceRole {
  return LEAVE_GENERAL_MANAGER_WORKSPACE_ROLES.includes(
    role as LeaveGeneralManagerWorkspaceRole,
  )
}

/**
 * 超级管理员仅代处理已分配给活动总经理的非总经理申请；原总经理、董事长审批链保持不变。
 */
export function canOperateLeaveRequest(scope: LeaveOperationScope): boolean {
  if (scope.operatorId === scope.applicantId) return false

  if (scope.operatorRole === 'super_admin') {
    return (
      scope.assignedApproverRole === 'general_manager' &&
      scope.assignedApproverStatus === 'active' &&
      getRequiredLeaveApproverRole(scope.applicantRole) === 'general_manager'
    )
  }

  return (
    isLeaveApproverRole(scope.operatorRole) &&
    scope.assignedApproverId === scope.operatorId &&
    scope.operatorRole === getRequiredLeaveApproverRole(scope.applicantRole)
  )
}

export function getLeaveApproverRoleName(role: LeaveApproverRole): string {
  return role === 'chairman' ? '董事长' : '总经理'
}

export function getLeaveApproverUnavailableMessage(applicantRole: unknown): string {
  const roleName = getLeaveApproverRoleName(getRequiredLeaveApproverRole(applicantRole))
  return `未找到可用的${roleName}审批人，请联系管理员配置${roleName}账号`
}
