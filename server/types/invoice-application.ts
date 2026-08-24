export const INVOICE_APPLICATION_STATUSES = [
  "draft",
  "pending_approval",
  "rejected",
  "pending_seal",
  "pending_invoice",
  "completed",
] as const;

export type InvoiceApplicationStatus =
  (typeof INVOICE_APPLICATION_STATUSES)[number];

export const INVOICE_APPLICATION_MATERIAL_MODES = [
  "material_need_seal",
  "material_no_seal",
  "no_material",
] as const;

export type InvoiceApplicationMaterialMode =
  (typeof INVOICE_APPLICATION_MATERIAL_MODES)[number];

export interface InvoiceApplicationActor {
  id: string;
  role: string;
}

export interface InvoiceApplicationBillingInfo {
  name: string;
  taxNumber: string;
  address: string;
  phone: string;
  bankName: string;
  bankAccount: string;
  remark: string;
}

export interface InvoiceApplicationAmounts {
  currentEffectiveAmount: number;
  invoicedAmount: number;
  pendingAmount: number;
  remainingAmount: number;
}

export interface InvoiceApplicationEligibility {
  eligible: boolean;
  reasonCode: string | null;
  reason: string | null;
  contract: {
    id: string;
    title: string;
    contractNo: string;
    category: "main_business" | "non_main" | "asset" | null;
    area: string;
    partyA: string;
    status: string;
  } | null;
  amounts: InvoiceApplicationAmounts;
  triplicatePreviousPaymentAmount: number;
  billingPrefill:
    | (InvoiceApplicationBillingInfo & {
        sourceApplicationId: string;
      })
    | null;
}

export interface InvoiceApplicationDraftInput {
  contractId: unknown;
  amount: unknown;
  invoiceContent?: unknown;
  invoiceType: unknown;
  description?: unknown;
  materialMode: unknown;
  billingInfo: Partial<Record<keyof InvoiceApplicationBillingInfo, unknown>>;
  confirmedBillingIdentity?: unknown;
}

export interface GenerateMainTriplicateInput {
  projectName: unknown;
  amount: unknown;
}

export interface InvoiceApplicationMaterialView {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  requiresSeal: boolean;
  hasOtherExpenseSheet: boolean;
  isSystemGeneratedTriplicate: boolean;
  createdAt: string;
}

export interface InvoiceApplicationView {
  id: string;
  applicationNo: string;
  contractId: string;
  contractTitle: string;
  contractNo: string;
  category: "main_business" | "non_main";
  area: string;
  partyA: string;
  contractAmount: number;
  amount: number;
  triplicateProjectName: string;
  triplicatePreviousPayment: number | null;
  triplicateCumulativePayment: number | null;
  invoiceContent: string;
  invoiceType: string;
  description: string;
  materialMode: InvoiceApplicationMaterialMode;
  billingInfo: InvoiceApplicationBillingInfo;
  confirmedBillingIdentity: boolean;
  status: InvoiceApplicationStatus;
  version: number;
  applicant: {
    id: string;
    name: string;
    department: string;
    position: string;
  };
  approver: { id: string; name: string; position: string } | null;
  applicantSignedAt: string | null;
  approverSignedAt: string | null;
  deliveredAt: string | null;
  deliveryNote: string;
  issuedAt: string | null;
  invoiceNote: string;
  completedAt: string | null;
  applicantSignedFileId: string | null;
  approvedFileId: string | null;
  applicationFileName: string | null;
  contractStatus: string;
  submittedAmounts: InvoiceApplicationAmounts | null;
  currentAmounts: InvoiceApplicationAmounts;
  allocatedInvoiceAmount: number;
  materials: InvoiceApplicationMaterialView[];
  auditLogs: Array<{
    id: string;
    action: string;
    actorName: string;
    actorPosition: string;
    fromStatus: string | null;
    toStatus: string;
    comment: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceApplicationListScope =
  | "mine"
  | "approval"
  | "approval_history"
  | "admin";

export type InvoiceApplicationEmployeeListView = "current" | "history";

export type InvoiceApplicationManagerListView = "pending" | "history";
