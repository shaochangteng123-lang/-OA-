import {
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
})
