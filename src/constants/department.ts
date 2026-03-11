// 部门-职位映射关系
export const DEPARTMENT_POSITION_MAP: Record<string, string[]> = {
  '行政部': ['行政主管', '行政专员', '财务', '出纳'],
  '项目部': ['项目经理', '员工'],
}

// 部门列表
export const DEPARTMENTS = Object.keys(DEPARTMENT_POSITION_MAP)

// 根据部门获取职位列表
export function getPositionsByDepartment(department: string): string[] {
  return DEPARTMENT_POSITION_MAP[department] || []
}
