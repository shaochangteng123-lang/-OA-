import { getLeaveDateMarker } from '../src/utils/leaveHolidayDisplay'

describe('请假日期节假日标记', () => {
  it('法定节假日显示节日名称和休息标记', () => {
    expect(
      getLeaveDateMarker(new Date(2026, 1, 17), {
        date: '2026-02-17',
        name: '春节',
        type: 'holiday',
      })
    ).toEqual({
      name: '春节',
      tag: '休',
      type: 'holiday',
      title: '春节（休）',
    })
  })

  it('周末补班优先显示节日名称和上班标记', () => {
    expect(
      getLeaveDateMarker(new Date(2026, 1, 14), {
        date: '2026-02-14',
        name: '春节补班',
        type: 'workday',
      })
    ).toEqual({
      name: '',
      tag: '班',
      type: 'workday',
      title: '春节补班',
    })
  })

  it('普通周末显示休息标记，普通工作日不显示标记', () => {
    expect(getLeaveDateMarker(new Date(2026, 1, 15), null)).toEqual({
      name: '',
      tag: '休',
      type: 'weekend',
      title: '周末（休）',
    })
    expect(getLeaveDateMarker(new Date(2026, 1, 16), null)).toBeNull()
  })
})
