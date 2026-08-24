import type {
  ContractCategory,
  ContractStatus,
  MoneyValue,
} from "@/types/contract";

export type InvoiceApplicationStatus =
  | "draft"
  | "pending_approval"
  | "rejected"
  | "pending_seal"
  | "pending_invoice"
  | "completed";

export type InvoiceApplicationEmployeeView = "current" | "history";

export type InvoiceApplicationManagerView = "pending" | "history";

export type InvoiceApplicationMaterialMode =
  | "material_need_seal"
  | "material_no_seal"
  | "no_material";

export interface InvoiceApplicationBillingInfo {
  name: string;
  taxNumber: string;
  address: string;
  phone: string;
  bankName: string;
  bankAccount: string;
  remark: string;
}

export interface InvoiceApplicationEligibility {
  eligible: boolean;
  reasonCode?: string | null;
  reason?: string | null;
  contract: {
    id: string;
    title: string;
    contractNo?: string | null;
    category: ContractCategory | null;
    area?: string | null;
    partyA?: string | null;
    status: ContractStatus;
  } | null;
  amounts: {
    currentEffectiveAmount: MoneyValue;
    invoicedAmount: MoneyValue;
    pendingAmount: MoneyValue;
    remainingAmount: MoneyValue;
  };
  triplicatePreviousPaymentAmount: MoneyValue;
  billingPrefill:
    | (InvoiceApplicationBillingInfo & {
        sourceApplicationId?: string | null;
      })
    | null;
}

export interface InvoiceApplicationMaterial {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  requiresSeal: boolean;
  hasOtherExpenseSheet?: boolean | null;
  isSystemGeneratedTriplicate?: boolean;
  createdAt?: string | null;
  downloadedAt?: string | null;
}

export interface MainTriplicateInspection {
  paymentAmountCents: number;
  sourceSheet: string;
  headerCell: string;
  totalCell: string;
  detailRange: string;
  fileName: string;
}

export interface InvoiceApplicationPartySnapshot {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  department?: string | null;
  position?: string | null;
  decidedAt?: string | null;
  comment?: string | null;
}

export interface InvoiceApplicationAuditLog {
  id: string;
  action: string;
  actorName?: string | null;
  actorPosition?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  comment?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface InvoiceApplication {
  id: string;
  applicationNo?: string | null;
  contractId: string;
  contractTitle: string;
  contractNo?: string | null;
  category: ContractCategory;
  area?: string | null;
  partyA?: string | null;
  contractStatus?: ContractStatus | null;
  contractAmount?: MoneyValue | null;
  amount: MoneyValue;
  triplicateProjectName?: string | null;
  triplicatePreviousPayment?: MoneyValue | null;
  triplicateCumulativePayment?: MoneyValue | null;
  invoiceContent: string;
  invoiceType: string;
  description: string;
  materialMode: InvoiceApplicationMaterialMode;
  billingInfo: InvoiceApplicationBillingInfo;
  confirmedBillingIdentity: boolean;
  status: InvoiceApplicationStatus;
  version: number;
  materials: InvoiceApplicationMaterial[];
  auditLogs?: InvoiceApplicationAuditLog[];
  applicant?: InvoiceApplicationPartySnapshot | null;
  approver?: InvoiceApplicationPartySnapshot | null;
  executor?: InvoiceApplicationPartySnapshot | null;
  deliveryNote?: string | null;
  invoiceNote?: string | null;
  issuedAt?: string | null;
  applicantSignedAt?: string | null;
  approverSignedAt?: string | null;
  deliveredAt?: string | null;
  completedAt?: string | null;
  applicantSignedFileId?: string | null;
  approvedFileId?: string | null;
  applicationFileName?: string | null;
  submittedAmounts?: InvoiceApplicationEligibility["amounts"] | null;
  currentAmounts?: InvoiceApplicationEligibility["amounts"] | null;
  allocatedInvoiceAmount?: MoneyValue | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface InvoiceApplicationListResponse {
  items: InvoiceApplication[];
  total: number;
}

export interface InvoiceApplicationDraftPayload {
  contractId: string;
  amount: string;
  invoiceType: string;
  description: string;
  materialMode: InvoiceApplicationMaterialMode;
  billingInfo: InvoiceApplicationBillingInfo;
  confirmedBillingIdentity: boolean;
}

export const INVOICE_APPLICATION_STATUS_LABELS: Record<
  InvoiceApplicationStatus,
  string
> = {
  draft: "草稿",
  pending_approval: "待总经理审批",
  rejected: "已驳回",
  pending_seal: "待管理员盖章交付",
  pending_invoice: "待开具／待财务登记",
  completed: "已完成",
};
