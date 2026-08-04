jest.mock('../server/db/index', () => ({
  db: {
    prepare: jest.fn(),
  },
}))

import { db } from '../server/db/index'
import { enrichLeaveRequestsWithSchedule } from '../server/services/leaveSchedule'
import type { LeaveScheduleRequest } from '../server/utils/leave-schedule'

describe('请假返岗信息服务', () => {
  const mockedPrepare = jest.mocked(db.prepare)

  beforeEach(() => {
    mockedPrepare.mockReset()
  })

  it('列表分页只包含一个组合分段时仍读取整组并统一返岗时间', async () => {
    const first: LeaveScheduleRequest = {
      status: 'approved',
      start_date: '2026-07-31',
      start_half: 'morning',
      end_date: '2026-08-03',
      end_half: 'morning',
      total_days: 1.5,
      combination_group_id: 'group-1',
    }
    const second: LeaveScheduleRequest = {
      status: 'approved',
      start_date: '2026-08-03',
      start_half: 'afternoon',
      end_date: '2026-08-04',
      end_half: 'afternoon',
      total_days: 1.5,
      combination_group_id: 'group-1',
    }

    mockedPrepare
      .mockReturnValueOnce({
        all: jest.fn().mockResolvedValue([first, second]),
      } as unknown as ReturnType<typeof db.prepare>)
      .mockReturnValueOnce({
        all: jest.fn().mockResolvedValue([]),
      } as unknown as ReturnType<typeof db.prepare>)

    const [result] = await enrichLeaveRequestsWithSchedule(
      [first],
      new Date('2026-07-31T00:00:00Z'),
    )

    expect(result.return_to_work_date).toBe('2026-08-05')
    expect(result.return_to_work_half).toBe('morning')
    expect(result.remaining_leave_days).toBe(3)
    expect(mockedPrepare).toHaveBeenCalledTimes(2)
  })
})
