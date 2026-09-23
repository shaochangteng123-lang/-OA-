import {
  canAccessGeneralManagerLeaveWorkspace,
  canOperateLeaveRequest,
  getLeaveApproverUnavailableMessage,
  getRequiredLeaveApproverRole,
  isLeaveApproverRole,
} from '../server/utils/leave-approval'

describe('请假审批角色分配', () => {
  it('总经理请假分配给董事长', () => {
    expect(getRequiredLeaveApproverRole('general_manager')).toBe('chairman')
    expect(getLeaveApproverUnavailableMessage('general_manager')).toBe(
      '未找到可用的董事长审批人，请联系管理员配置董事长账号'
    )
  })

  it.each(['user', 'admin', 'super_admin', 'chairman'])(
    '%s 请假分配给总经理',
    (role) => {
      expect(getRequiredLeaveApproverRole(role)).toBe('general_manager')
    }
  )

  it('仅总经理和董事长可以处理分配给本人的请假', () => {
    expect(isLeaveApproverRole('general_manager')).toBe(true)
    expect(isLeaveApproverRole('chairman')).toBe(true)
    expect(isLeaveApproverRole('admin')).toBe(false)
    expect(isLeaveApproverRole('super_admin')).toBe(false)
  })

  it('仅总经理和超级管理员进入总经理请假工作区', () => {
    expect(canAccessGeneralManagerLeaveWorkspace('general_manager')).toBe(true)
    expect(canAccessGeneralManagerLeaveWorkspace('super_admin')).toBe(true)
    expect(canAccessGeneralManagerLeaveWorkspace('chairman')).toBe(false)
    expect(canAccessGeneralManagerLeaveWorkspace('admin')).toBe(false)
  })

  it('超级管理员可代活动总经理处理普通员工申请，但不能自审或审批总经理申请', () => {
    const baseScope = {
      operatorId: 'super-admin-1',
      operatorRole: 'super_admin',
      applicantId: 'employee-1',
      applicantRole: 'user',
      assignedApproverId: 'manager-1',
      assignedApproverRole: 'general_manager',
      assignedApproverStatus: 'active',
    }

    expect(canOperateLeaveRequest(baseScope)).toBe(true)
    expect(
      canOperateLeaveRequest({
        ...baseScope,
        applicantId: 'super-admin-1',
        applicantRole: 'super_admin',
      }),
    ).toBe(false)
    expect(
      canOperateLeaveRequest({
        ...baseScope,
        applicantRole: 'general_manager',
      }),
    ).toBe(false)
    expect(
      canOperateLeaveRequest({
        ...baseScope,
        applicantRole: 'chairman',
      }),
    ).toBe(true)
    expect(
      canOperateLeaveRequest({
        ...baseScope,
        assignedApproverRole: 'chairman',
      }),
    ).toBe(false)
    expect(
      canOperateLeaveRequest({
        ...baseScope,
        assignedApproverStatus: 'inactive',
      }),
    ).toBe(false)
  })

  it('总经理与董事长仍只能处理分配给本人的原审批范围', () => {
    expect(
      canOperateLeaveRequest({
        operatorId: 'manager-1',
        operatorRole: 'general_manager',
        applicantId: 'employee-1',
        applicantRole: 'user',
        assignedApproverId: 'manager-1',
        assignedApproverRole: 'general_manager',
        assignedApproverStatus: 'active',
      }),
    ).toBe(true)
    expect(
      canOperateLeaveRequest({
        operatorId: 'chairman-1',
        operatorRole: 'chairman',
        applicantId: 'manager-1',
        applicantRole: 'general_manager',
        assignedApproverId: 'chairman-1',
        assignedApproverRole: 'chairman',
        assignedApproverStatus: 'active',
      }),
    ).toBe(true)
    expect(
      canOperateLeaveRequest({
        operatorId: 'manager-2',
        operatorRole: 'general_manager',
        applicantId: 'employee-1',
        applicantRole: 'user',
        assignedApproverId: 'manager-1',
        assignedApproverRole: 'general_manager',
        assignedApproverStatus: 'active',
      }),
    ).toBe(false)
  })
})
