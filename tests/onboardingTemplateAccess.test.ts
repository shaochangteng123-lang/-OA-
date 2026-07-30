import {
  resolveContractTemplatePreviewFields,
  validateContractTemplateDownload,
} from '../server/utils/onboarding-template-access'

const completeFields = {
  contractTemplateStartDate: '2026-07-23',
  contractTemplateEndDate: '2027-07-22',
  probationTemplateStartDate: '2026-07-23',
  probationTemplateEndDate: '2027-01-22',
  position: '行政主管',
}

describe('劳动合同模板访问规则', () => {
  it('模板日期完整时允许下载并预览完整个性化合同', () => {
    expect(validateContractTemplateDownload(completeFields)).toBeNull()
    expect(resolveContractTemplatePreviewFields(completeFields)).toEqual(
      completeFields,
    )
  })

  it('模板日期未设置时禁止下载且预览不沿用上一期日期', () => {
    const lockedFields = {
      ...completeFields,
      contractTemplateStartDate: null,
      contractTemplateEndDate: null,
      probationTemplateStartDate: null,
      probationTemplateEndDate: null,
    }

    expect(validateContractTemplateDownload(lockedFields)).toBe(
      '管理员尚未设置合同模板期限，请设置后再下载',
    )
    expect(resolveContractTemplatePreviewFields(lockedFields)).toBeNull()
  })

  it('试用期日期不完整时下载保持锁定', () => {
    const incompleteProbation = {
      ...completeFields,
      probationTemplateEndDate: null,
    }

    expect(validateContractTemplateDownload(incompleteProbation)).toBe(
      '合同模板试用期日期不完整，请联系管理员重新设置',
    )
    expect(
      resolveContractTemplatePreviewFields(incompleteProbation),
    ).toBeNull()
  })

  it('职位缺失时下载保持锁定', () => {
    const missingPosition = {
      ...completeFields,
      position: ' ',
    }

    expect(validateContractTemplateDownload(missingPosition)).toBe(
      '当前员工尚未设置职位，请联系管理员在员工数据中选择',
    )
    expect(resolveContractTemplatePreviewFields(missingPosition)).toBeNull()
  })

  it('当前期限未设置时不使用上一期或正式合同日期', () => {
    const currentFields = {
      ...completeFields,
      contractTemplateStartDate: null,
      contractTemplateEndDate: null,
      probationTemplateStartDate: null,
      probationTemplateEndDate: null,
    }

    expect(
      resolveContractTemplatePreviewFields(currentFields),
    ).toBeNull()
  })
})
