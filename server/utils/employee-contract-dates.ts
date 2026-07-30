export interface EmployeeContractDateRecord {
  contract_start_date: string | null
  contract_end_date: string | null
  probation_end_date: string | null
  created_at: string
}

export interface ResolvedEmployeeContractDates {
  hireDate: string | null
  contractEndDate: string | null
  probationEndDate: string | null
}

export function resolveEmployeeContractDates(
  records: EmployeeContractDateRecord[],
): ResolvedEmployeeContractDates {
  const recognized = records.filter(
    (record) => record.contract_start_date && record.contract_end_date,
  )
  if (recognized.length === 0) {
    return {
      hireDate: null,
      contractEndDate: null,
      probationEndDate: null,
    }
  }

  const firstContract = [...recognized].sort((left, right) => {
    const startDateCompare = left.contract_start_date!.localeCompare(right.contract_start_date!)
    return startDateCompare || left.created_at.localeCompare(right.created_at)
  })[0]

  const currentContract = [...recognized].sort((left, right) => {
    const endDateCompare = right.contract_end_date!.localeCompare(left.contract_end_date!)
    return endDateCompare || right.created_at.localeCompare(left.created_at)
  })[0]

  return {
    hireDate: firstContract.contract_start_date,
    contractEndDate: currentContract.contract_end_date,
    probationEndDate: firstContract.probation_end_date,
  }
}
