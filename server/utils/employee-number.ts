import { db } from '../db/index.js'

/**
 * 生成员工编号
 * 格式：YULI-CS001, YULI-CS002, ...
 * 根据用户注册的先后顺序递增
 */
export async function generateEmployeeNumber(): Promise<string> {
  // 查询当前最大的员工编号
  const result = await db.prepare(`
    SELECT employee_no FROM users
    WHERE employee_no IS NOT NULL AND employee_no LIKE 'YULI-CS%'
    ORDER BY employee_no DESC
    LIMIT 1
  `).get() as { employee_no: string } | undefined

  if (!result || !result.employee_no) {
    // 如果没有员工编号，从 YULI-CS001 开始
    return 'YULI-CS001'
  }

  // 提取编号中的数字部分
  const match = result.employee_no.match(/YULI-CS(\d+)/)
  if (!match) {
    return 'YULI-CS001'
  }

  const currentNumber = parseInt(match[1], 10)
  const nextNumber = currentNumber + 1

  // 格式化为三位数字，不足补零
  const formattedNumber = nextNumber.toString().padStart(3, '0')
  return `YULI-CS${formattedNumber}`
}
