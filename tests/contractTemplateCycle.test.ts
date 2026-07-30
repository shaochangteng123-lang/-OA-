import { closeContractTemplateCycle } from '../server/services/contractTemplateCycle'

describe('劳动合同模板周期', () => {
  it('正式劳动合同归档后清空模板日期并关闭本周期', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1 })

    const closed = await closeContractTemplateCycle(
      { query },
      'employee-1',
      '2026-07-23T12:00:00.000Z',
    )

    expect(closed).toBe(true)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('contract_template_start_date = NULL'),
      ['2026-07-23T12:00:00.000Z', 'employee-1'],
    )
    expect(query.mock.calls[0][0]).toContain('contract_template_end_date = NULL')
    expect(query.mock.calls[0][0]).toContain('probation_template_start_date = NULL')
    expect(query.mock.calls[0][0]).toContain('probation_template_end_date = NULL')
    expect(query.mock.calls[0][0]).toContain(
      'last_contract_template_start_date = CASE',
    )
    expect(query.mock.calls[0][0]).toContain(
      'last_contract_template_position = CASE',
    )
  })
})
