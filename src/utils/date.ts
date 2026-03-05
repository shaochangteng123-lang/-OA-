import { format, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'

export function formatDate(date: string | Date, formatStr: string = 'yyyy-MM-dd'): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, formatStr, { locale: zhCN })
}

export function formatDateTime(date: string | Date): string {
  return formatDate(date, 'yyyy-MM-dd HH:mm:ss')
}

export function formatDateChinese(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'yyyy年MM月dd日 EEEE', { locale: zhCN })
}

export function getTodayString(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function getWeekday(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'EEEE', { locale: zhCN })
}
