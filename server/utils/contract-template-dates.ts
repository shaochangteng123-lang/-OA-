export interface ContractTemplateDateFields {
  contract_template_start_date: string | null
  contract_template_end_date: string | null
  probation_template_start_date: string | null
  probation_template_end_date: string | null
}

const DATE_FIELD_LABELS: Record<keyof ContractTemplateDateFields, string> = {
  contract_template_start_date: '合同模板开始日期',
  contract_template_end_date: '合同模板结束日期',
  probation_template_start_date: '模板试用期开始日期',
  probation_template_end_date: '模板试用期结束日期',
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function normalizeContractTemplateDates(input: unknown): {
  data: ContractTemplateDateFields | null
  error: string | null
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { data: null, error: '合同模板日期格式不正确' }
  }

  const source = input as Record<string, unknown>
  const data = {} as ContractTemplateDateFields
  for (const field of Object.keys(DATE_FIELD_LABELS) as Array<keyof ContractTemplateDateFields>) {
    const value = source[field]
    if (value === undefined || value === null || value === '') {
      data[field] = null
      continue
    }
    if (typeof value !== 'string') {
      return { data: null, error: `${DATE_FIELD_LABELS[field]}格式不正确` }
    }
    const normalized = value.trim()
    if (!normalized) {
      data[field] = null
      continue
    }
    if (!isValidDate(normalized)) {
      return { data: null, error: `${DATE_FIELD_LABELS[field]}无效` }
    }
    data[field] = normalized
  }

  const hasContractStart = Boolean(data.contract_template_start_date)
  const hasContractEnd = Boolean(data.contract_template_end_date)
  if (hasContractStart !== hasContractEnd) {
    return { data: null, error: '请同时选择合同模板的开始日期和结束日期' }
  }
  if (
    data.contract_template_start_date
    && data.contract_template_end_date
    && data.contract_template_start_date > data.contract_template_end_date
  ) {
    return { data: null, error: '合同模板开始日期不能晚于结束日期' }
  }

  const hasProbationStart = Boolean(data.probation_template_start_date)
  const hasProbationEnd = Boolean(data.probation_template_end_date)
  if (hasProbationStart !== hasProbationEnd) {
    return { data: null, error: '请同时选择模板试用期的开始日期和结束日期' }
  }
  if (
    data.probation_template_start_date
    && data.probation_template_end_date
    && data.probation_template_start_date > data.probation_template_end_date
  ) {
    return { data: null, error: '模板试用期开始日期不能晚于结束日期' }
  }

  if (hasProbationStart && (!hasContractStart || !hasContractEnd)) {
    return { data: null, error: '请先设置合同模板期限，再设置模板试用期' }
  }
  if (
    data.contract_template_start_date
    && data.contract_template_end_date
    && data.probation_template_start_date
    && data.probation_template_end_date
    && (
      data.probation_template_start_date < data.contract_template_start_date
      || data.probation_template_end_date > data.contract_template_end_date
    )
  ) {
    return { data: null, error: '模板试用期必须位于合同模板期限内' }
  }

  return { data, error: null }
}
