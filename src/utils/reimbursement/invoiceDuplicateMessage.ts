export type ReimbursementInvoiceUsageKind = 'invoice' | 'deduction'

export function buildReimbursementInvoiceDuplicateMessage(
  applicantName: unknown,
  usageKind: ReimbursementInvoiceUsageKind,
): string {
  const displayName = String(applicantName || '').trim() || '该申请人'
  const uploadArea = usageKind === 'deduction' ? '核减上传' : '发票上传'
  return `${displayName} 已在${uploadArea}中上传此发票，请勿重复上传`
}

export function buildUploadingInvoiceDuplicateMessage(
  invoiceNumber: unknown,
): string {
  const displayNumber = String(invoiceNumber || '').trim()
  return displayNumber
    ? `发票号码 ${displayNumber}已在报销模块使用，请勿重复上传`
    : '此发票已在报销模块使用，请勿重复上传'
}

export function buildCrossUploadInvoiceDuplicateMessage(
  invoiceNumber: unknown,
  existingArea: ReimbursementInvoiceUsageKind,
): string {
  const displayNumber = String(invoiceNumber || '').trim()
  const uploadArea =
    existingArea === 'deduction' ? '核减发票上传' : '发票上传'
  return displayNumber
    ? `发票号码 ${displayNumber}已在${uploadArea}报销模块使用，请勿重复上传`
    : `此发票已在${uploadArea}报销模块使用，请勿重复上传`
}
