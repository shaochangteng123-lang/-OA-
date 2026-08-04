import {
  calculateLeaveReturnInfo,
  getBeijingLeaveClock,
  isApprovedLeaveActive,
  resolveApprovedCombinationSchedule,
  type LeaveScheduleRequest,
  type LeaveWorkdayCalendar,
} from '../server/utils/leave-schedule'

const emptyCalendar: LeaveWorkdayCalendar = {
  holidayDates: new Set(),
  workdayDates: new Set(),
}

function approvedRequest(
  overrides: Partial<LeaveScheduleRequest> = {},
): LeaveScheduleRequest {
  return {
    status: 'approved',
    start_date: '2026-07-17',
    start_half: 'morning',
    end_date: '2026-07-17',
    end_half: 'afternoon',
    total_days: 1,
    ...overrides,
  }
}

describe('请假生效时段和返岗计算', () => {
  it('按照北京时间中午十二点切换上午和下午', () => {
    expect(getBeijingLeaveClock(new Date('2026-07-17T03:59:59Z'))).toEqual({
      date: '2026-07-17',
      half: 'morning',
      halfIndex: 0,
    })
    expect(getBeijingLeaveClock(new Date('2026-07-17T04:00:00Z'))).toEqual({
      date: '2026-07-17',
      half: 'afternoon',
      halfIndex: 1,
    })
  })

  it('下午开始和上午结束时按半天边界切换休假状态', () => {
    const request = approvedRequest({
      start_half: 'afternoon',
      end_date: '2026-07-20',
      end_half: 'morning',
      total_days: 1,
    })

    expect(
      isApprovedLeaveActive(request, new Date('2026-07-17T03:59:59Z')),
    ).toBe(false)
    expect(
      isApprovedLeaveActive(request, new Date('2026-07-17T04:00:00Z')),
    ).toBe(true)
    expect(
      isApprovedLeaveActive(request, new Date('2026-07-20T03:59:59Z')),
    ).toBe(true)
    expect(
      isApprovedLeaveActive(request, new Date('2026-07-20T04:00:00Z')),
    ).toBe(false)
  })

  it('剩余天数排除周末并返回下一个工作日上午', () => {
    const request = approvedRequest({
      end_date: '2026-07-19',
      end_half: 'afternoon',
      total_days: 1,
    })
    const result = calculateLeaveReturnInfo(
      request,
      emptyCalendar,
      new Date('2026-07-17T04:00:00Z'),
    )

    expect(result).toEqual({
      remaining_days: 2.5,
      remaining_leave_days: 0.5,
      return_to_work_date: '2026-07-20',
      return_to_work_half: 'morning',
      leave_timing_status: 'on_leave',
    })
  })

  it('工作日上午结束请假时当日下午返岗', () => {
    const request = approvedRequest({
      end_half: 'morning',
      total_days: 0.5,
    })
    const result = calculateLeaveReturnInfo(
      request,
      emptyCalendar,
      new Date('2026-07-17T01:00:00Z'),
    )

    expect(result.remaining_days).toBe(0.5)
    expect(result.remaining_leave_days).toBe(0.5)
    expect(result.return_to_work_date).toBe('2026-07-17')
    expect(result.return_to_work_half).toBe('afternoon')
  })

  it('法定假日不计入剩余天数，调班周末按工作日计算', () => {
    const calendar: LeaveWorkdayCalendar = {
      holidayDates: new Set(['2026-07-17']),
      workdayDates: new Set(['2026-07-18']),
    }
    const request = approvedRequest({
      end_date: '2026-07-18',
      end_half: 'afternoon',
      total_days: 1,
    })
    const result = calculateLeaveReturnInfo(
      request,
      calendar,
      new Date('2026-07-17T00:00:00Z'),
    )

    expect(result.remaining_days).toBe(3)
    expect(result.remaining_leave_days).toBe(1)
    expect(result.return_to_work_date).toBe('2026-07-20')
    expect(result.return_to_work_half).toBe('morning')
  })

  it('尚未开始显示全部请假天数，结束后显示已返岗', () => {
    const request = approvedRequest()
    const upcoming = calculateLeaveReturnInfo(
      request,
      emptyCalendar,
      new Date('2026-07-16T00:00:00Z'),
    )
    const betweenLeaveAndReturn = calculateLeaveReturnInfo(
      request,
      emptyCalendar,
      new Date('2026-07-17T16:00:00Z'),
    )
    const returned = calculateLeaveReturnInfo(
      request,
      emptyCalendar,
      new Date('2026-07-20T00:00:00Z'),
    )

    expect(upcoming.remaining_days).toBe(4)
    expect(upcoming.remaining_leave_days).toBe(1)
    expect(upcoming.leave_timing_status).toBe('upcoming')
    expect(betweenLeaveAndReturn.remaining_days).toBe(2)
    expect(betweenLeaveAndReturn.remaining_leave_days).toBe(0)
    expect(betweenLeaveAndReturn.leave_timing_status).toBe('on_leave')
    expect(returned.remaining_days).toBe(0)
    expect(returned.leave_timing_status).toBe('returned')
  })

  it('非已批准申请不计算剩余天数，也不会触发休假状态', () => {
    const request = approvedRequest({ status: 'pending' })
    expect(
      isApprovedLeaveActive(request, new Date('2026-07-17T01:00:00Z')),
    ).toBe(false)
    expect(calculateLeaveReturnInfo(request, emptyCalendar)).toEqual({
      remaining_days: null,
      remaining_leave_days: null,
      return_to_work_date: null,
      return_to_work_half: null,
      leave_timing_status: 'not_applicable',
    })
  })

  it('组合请假全部通过后按整组最后一段计算统一返岗时间', () => {
    const first = approvedRequest({
      start_date: '2026-07-31',
      start_half: 'morning',
      end_date: '2026-08-03',
      end_half: 'morning',
      total_days: 1.5,
      combination_group_id: 'group-1',
    })
    const second = approvedRequest({
      start_date: '2026-08-03',
      start_half: 'afternoon',
      end_date: '2026-08-04',
      end_half: 'afternoon',
      total_days: 1.5,
      combination_group_id: 'group-1',
    })

    const combined = resolveApprovedCombinationSchedule(first, [first, second])
    const result = calculateLeaveReturnInfo(
      combined,
      emptyCalendar,
      new Date('2026-07-31T00:00:00Z'),
    )

    expect(combined).toMatchObject({
      start_date: '2026-07-31',
      start_half: 'morning',
      end_date: '2026-08-04',
      end_half: 'afternoon',
      total_days: 3,
    })
    expect(result.return_to_work_date).toBe('2026-08-05')
    expect(result.return_to_work_half).toBe('morning')
    expect(result.remaining_leave_days).toBe(3)
  })

  it('组合请假仍有未通过分段时不提前延后返岗时间', () => {
    const first = approvedRequest({
      start_date: '2026-07-31',
      start_half: 'morning',
      end_date: '2026-08-03',
      end_half: 'morning',
      total_days: 1.5,
      combination_group_id: 'group-2',
    })
    const pending = approvedRequest({
      status: 'pending',
      start_date: '2026-08-03',
      start_half: 'afternoon',
      end_date: '2026-08-04',
      end_half: 'afternoon',
      total_days: 1.5,
      combination_group_id: 'group-2',
    })

    expect(resolveApprovedCombinationSchedule(first, [first, pending])).toBe(
      first,
    )
  })
})
