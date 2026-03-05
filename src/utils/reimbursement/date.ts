/**
 * 报销月份计算工具函数
 * 规则：仅适用于基础报销
 * - 每月4日前（含4日）上传的报销，报销月份显示为上月
 * - 5日及之后显示为当月
 * - 商务报销和大额报销不使用此规则，直接使用提交月份
 */

/**
 * 计算报销月份（仅基础报销使用）
 * @param date 提交日期（可选，默认为当前时间）
 * @param type 报销类型（basic/large/business），默认为basic
 * @returns 报销月份字符串，格式：YYYY-MM
 */
export function calculateReimbursementMonth(date?: Date | string, type: string = 'basic'): string {
  const submitDate = date ? new Date(date) : new Date()

  // 获取提交日期的年月日
  const year = submitDate.getFullYear()
  const month = submitDate.getMonth() + 1 // 0-11 转为 1-12
  const day = submitDate.getDate()

  // 只有基础报销才使用特殊规则
  if (type === 'basic') {
    // 如果是4日及之前，报销月份为上月
    if (day <= 4) {
      // 计算上月
      const prevMonth = month === 1 ? 12 : month - 1
      const prevYear = month === 1 ? year - 1 : year

      return `${prevYear}-${String(prevMonth).padStart(2, '0')}`
    }
  }

  // 5日及之后，或者非基础报销，报销月份为当月
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * 格式化报销月份为显示文本
 * @param monthStr 报销月份字符串，格式：YYYY-MM
 * @returns 格式化后的文本，如：2026年02月
 */
export function formatReimbursementMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  return `${year}年${month}月`
}
