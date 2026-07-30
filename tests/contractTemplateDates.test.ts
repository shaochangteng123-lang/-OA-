import { normalizeContractTemplateDates } from '../server/utils/contract-template-dates'

describe('员工合同模板日期校验', () => {
  it('接受完整合同期限及位于期限内的试用期', () => {
    expect(normalizeContractTemplateDates({
      contract_template_start_date: '2026-08-01',
      contract_template_end_date: '2027-07-31',
      probation_template_start_date: '2026-08-01',
      probation_template_end_date: '2026-10-31',
    })).toEqual({
      data: {
        contract_template_start_date: '2026-08-01',
        contract_template_end_date: '2027-07-31',
        probation_template_start_date: '2026-08-01',
        probation_template_end_date: '2026-10-31',
      },
      error: null,
    })
  })

  it('续签合同可以不设置试用期', () => {
    const result = normalizeContractTemplateDates({
      contract_template_start_date: '2027-08-01',
      contract_template_end_date: '2028-07-31',
      probation_template_start_date: null,
      probation_template_end_date: null,
    })

    expect(result.error).toBeNull()
    expect(result.data?.probation_template_start_date).toBeNull()
    expect(result.data?.probation_template_end_date).toBeNull()
  })

  it('拒绝缺少一端或起止倒置的日期', () => {
    expect(normalizeContractTemplateDates({
      contract_template_start_date: '2026-08-01',
      contract_template_end_date: null,
    }).error).toBe('请同时选择合同模板的开始日期和结束日期')

    expect(normalizeContractTemplateDates({
      contract_template_start_date: '2027-08-01',
      contract_template_end_date: '2026-07-31',
    }).error).toBe('合同模板开始日期不能晚于结束日期')
  })

  it('拒绝超出合同期限的试用期', () => {
    expect(normalizeContractTemplateDates({
      contract_template_start_date: '2026-08-01',
      contract_template_end_date: '2027-07-31',
      probation_template_start_date: '2026-07-01',
      probation_template_end_date: '2026-10-31',
    }).error).toBe('模板试用期必须位于合同模板期限内')
  })
})
