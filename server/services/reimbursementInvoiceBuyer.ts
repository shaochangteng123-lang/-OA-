import type { InvoiceOcrResult } from './localOcr.js'

export const REIMBURSEMENT_COMPANY_NAME = '北京羽隶工程咨询有限公司'
export const REIMBURSEMENT_COMPANY_TAX_ID = '91110116MA01G3U20C'
export const REIMBURSEMENT_COMPANY_INVOICE_ERROR = '不是北京羽隶工程咨询有限公司发票，请核查'

function normalizeCompanyName(value?: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()
}

function normalizeTaxId(value?: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
}

/**
 * 报销发票必须同时满足购买方公司法定全称和纳税人识别号精确匹配。
 */
export function isReimbursementCompanyInvoice(
  result: Pick<InvoiceOcrResult, 'buyer' | 'buyerTaxId'>
): boolean {
  return normalizeCompanyName(result.buyer) === normalizeCompanyName(REIMBURSEMENT_COMPANY_NAME)
    && normalizeTaxId(result.buyerTaxId) === normalizeTaxId(REIMBURSEMENT_COMPANY_TAX_ID)
}

export function assertReimbursementCompanyInvoice(
  result: Pick<InvoiceOcrResult, 'buyer' | 'buyerTaxId' | 'invoiceNumber'>
): void {
  if (!isReimbursementCompanyInvoice(result)) {
    const invoiceNumber = String(result.invoiceNumber || '未识别').trim()
    throw new Error(`发票号码 ${invoiceNumber} ${REIMBURSEMENT_COMPANY_INVOICE_ERROR}`)
  }
}

export function isReimbursementCompanyInvoiceError(error: unknown): boolean {
  return error instanceof Error
    && error.message.startsWith('发票号码 ')
    && error.message.endsWith(` ${REIMBURSEMENT_COMPANY_INVOICE_ERROR}`)
}
