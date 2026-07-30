import type { HolidayInfo } from './holidays'

export type LeaveDateMarkerType = HolidayInfo['type'] | 'weekend'

export interface LeaveDateMarker {
  name: string
  tag: '休' | '班'
  type: LeaveDateMarkerType
  title: string
}

export function getLeaveDateMarker(
  date: Date,
  holidayInfo: HolidayInfo | null
): LeaveDateMarker | null {
  if (holidayInfo) {
    const tag = holidayInfo.type === 'holiday' ? '休' : '班'
    return {
      name: holidayInfo.type === 'holiday' ? holidayInfo.name : '',
      tag,
      type: holidayInfo.type,
      title: holidayInfo.type === 'holiday' ? `${holidayInfo.name}（休）` : holidayInfo.name,
    }
  }

  if (date.getDay() === 0 || date.getDay() === 6) {
    return {
      name: '',
      tag: '休',
      type: 'weekend',
      title: '周末（休）',
    }
  }

  return null
}
