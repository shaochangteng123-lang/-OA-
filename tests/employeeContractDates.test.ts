import { resolveEmployeeContractDates } from '../server/utils/employee-contract-dates'

describe('员工劳动合同日期联动', () => {
  it('使用第一份合同作为入职及试用期依据，使用最新合同作为当前合同', () => {
    expect(resolveEmployeeContractDates([
      {
        contract_start_date: '2025-06-16',
        contract_end_date: '2026-06-15',
        probation_end_date: '2025-12-15',
        created_at: '2025-06-16T00:00:00.000Z',
      },
      {
        contract_start_date: '2026-06-16',
        contract_end_date: '2027-06-15',
        probation_end_date: null,
        created_at: '2026-06-16T00:00:00.000Z',
      },
    ])).toEqual({
      hireDate: '2025-06-16',
      contractEndDate: '2027-06-15',
      probationEndDate: '2025-12-15',
    })
  })

  it('忽略未识别完整起止日期的合同', () => {
    expect(resolveEmployeeContractDates([
      {
        contract_start_date: '2025-06-16',
        contract_end_date: null,
        probation_end_date: null,
        created_at: '2025-06-16T00:00:00.000Z',
      },
    ])).toEqual({
      hireDate: null,
      contractEndDate: null,
      probationEndDate: null,
    })
  })
})
