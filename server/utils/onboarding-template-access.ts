export interface ContractTemplateAccessFields {
  contractTemplateStartDate: string | null
  contractTemplateEndDate: string | null
  probationTemplateStartDate: string | null
  probationTemplateEndDate: string | null
  position: string | null
}

export function validateContractTemplateDownload(
  fields: ContractTemplateAccessFields,
): string | null {
  if (!fields.contractTemplateStartDate || !fields.contractTemplateEndDate) {
    return '管理员尚未设置合同模板期限，请设置后再下载'
  }

  const hasProbationStart = Boolean(fields.probationTemplateStartDate)
  const hasProbationEnd = Boolean(fields.probationTemplateEndDate)
  if (hasProbationStart !== hasProbationEnd) {
    return '合同模板试用期日期不完整，请联系管理员重新设置'
  }

  if (!fields.position?.trim()) {
    return '当前员工尚未设置职位，请联系管理员在员工数据中选择'
  }

  return null
}

export function resolveContractTemplatePreviewFields(
  fields: ContractTemplateAccessFields,
): ContractTemplateAccessFields | null {
  if (validateContractTemplateDownload(fields) !== null) return null
  return {
    ...fields,
    position: fields.position!.trim(),
  }
}
