export type DepartmentPositionMap = Record<string, string[]>

export const DEFAULT_DEPARTMENT_POSITION_MAP: DepartmentPositionMap = {
  行政部: ['行政主管', '行政专员', '财务', '出纳'],
  项目部: ['项目经理', '员工'],
}

export function normalizeDepartmentPositionMap(input: unknown): {
  data: DepartmentPositionMap | null
  error: string | null
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { data: null, error: '无效的部门职位数据' }
  }

  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length > 100) {
    return { data: null, error: '部门数量不能超过100个' }
  }

  const normalized: DepartmentPositionMap = {}
  for (const [rawDepartment, rawPositions] of entries) {
    const department = rawDepartment.trim()
    if (!department || department.length > 50) {
      return { data: null, error: '部门名称不能为空且不能超过50个字符' }
    }
    if (!Array.isArray(rawPositions)) {
      return { data: null, error: `部门“${department}”的职位数据格式不正确` }
    }
    if (rawPositions.length > 100) {
      return { data: null, error: `部门“${department}”的职位数量不能超过100个` }
    }

    const positions: string[] = []
    for (const rawPosition of rawPositions) {
      if (typeof rawPosition !== 'string') {
        return { data: null, error: `部门“${department}”的职位名称格式不正确` }
      }
      const position = rawPosition.trim()
      if (!position || position.length > 30) {
        return { data: null, error: '职位名称不能为空且不能超过30个字符' }
      }
      if (!positions.includes(position)) positions.push(position)
    }
    normalized[department] = positions
  }

  return { data: normalized, error: null }
}

export function parseStoredDepartmentPositionMap(
  configJson: string | null | undefined,
): DepartmentPositionMap {
  if (!configJson) {
    return JSON.parse(JSON.stringify(DEFAULT_DEPARTMENT_POSITION_MAP)) as DepartmentPositionMap
  }

  const parsed = JSON.parse(configJson) as unknown
  const normalized = normalizeDepartmentPositionMap(parsed)
  if (!normalized.data) {
    throw new Error(normalized.error || '部门职位配置格式不正确')
  }
  return normalized.data
}

export function validateDepartmentPositionPair(
  config: DepartmentPositionMap,
  departmentValue: unknown,
  positionValue: unknown,
  allowEmpty = false,
): {
  department: string | null
  position: string | null
  error: string | null
} {
  const department = typeof departmentValue === 'string' ? departmentValue.trim() : ''
  const position = typeof positionValue === 'string' ? positionValue.trim() : ''

  if (!department && !position && allowEmpty) {
    return { department: null, position: null, error: null }
  }
  if (!department) {
    return { department: null, position: position || null, error: '请选择部门' }
  }
  if (!Object.prototype.hasOwnProperty.call(config, department)) {
    return { department, position: position || null, error: `部门“${department}”不在部门职位管理中` }
  }
  if (!position) {
    return { department, position: null, error: '请选择职位' }
  }
  if (!config[department].includes(position)) {
    return {
      department,
      position,
      error: `职位“${position}”不属于部门“${department}”`,
    }
  }

  return { department, position, error: null }
}
