/**
 * 报销月份计算工具函数
 * 规则：所有报销类型统一使用提交月份作为报销月份
 */

/**
 * 计算报销月份
 * @param date 提交日期（可选，默认为当前时间）
 * @param _type 报销类型（basic/large/business），默认为basic
 * @returns 报销月份字符串，格式：YYYY-MM
 */
export function calculateReimbursementMonth(date?: Date | string, _type: string = 'basic'): string {
  const submitDate = date ? new Date(date) : new Date()

  const year = submitDate.getFullYear()
  const month = submitDate.getMonth() + 1 // 0-11 转为 1-12

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

/**
 * 标准化报销事由标题格式
 * 将各种格式统一为：YYYY年MM月-基础报销/大额报销/商务报销
 * 例如："2026年03月大额报销" → "2026年03月-大额报销"
 *       "2026年03月报销-基础报销" → "2026年03月-基础报销"
 */
export function normalizeReimbursementTitle(title: string): string {
  const match = title.match(/^(\d{4}年\d{2}月).*?(基础报销|大额报销|商务报销)$/)
  if (match) {
    return `${match[1]}-${match[2]}`
  }
  return title
}
