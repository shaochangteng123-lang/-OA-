export const REIMBURSEMENT_TYPE_CODES = [
  "basic",
  "large",
  "business",
  "welfare_one",
  "welfare_two",
] as const;

export type ReimbursementType = (typeof REIMBURSEMENT_TYPE_CODES)[number];

export interface ReimbursementTypeConfig {
  type: ReimbursementType;
  approvalType: string;
  label: string;
  shortLabel: string;
  listRoute: string;
  createRoute: string;
  accentColor: string;
  accentHoverColor: string;
  accentActiveColor: string;
  tagType: "primary" | "success" | "warning" | "danger" | "info";
  scopeListEndpoint?: string;
  scopeManagementBase?: string;
  description: string;
}

export const REIMBURSEMENT_TYPE_CONFIG: Record<
  ReimbursementType,
  ReimbursementTypeConfig
> = {
  basic: {
    type: "basic",
    approvalType: "reimbursement_basic",
    label: "基础报销",
    shortLabel: "基础",
    listRoute: "/basic-reimbursement",
    createRoute: "/basic-reimbursement/create",
    accentColor: "#409eff",
    accentHoverColor: "#66b1ff",
    accentActiveColor: "#3a8ee6",
    tagType: "success",
    description: "默认显示当月报销数据，可通过日期范围查询历史记录。",
  },
  large: {
    type: "large",
    approvalType: "reimbursement_large",
    label: "大额报销",
    shortLabel: "大额",
    listRoute: "/large-reimbursement",
    createRoute: "/large-reimbursement/create",
    accentColor: "#e6a23c",
    accentHoverColor: "#ebb563",
    accentActiveColor: "#cf9236",
    tagType: "warning",
    scopeListEndpoint: "/api/reimbursement-scope/list",
    scopeManagementBase: "/api/reimbursement-scope",
    description: "大额报销不设最低金额门槛，可按实际费用正常提交。",
  },
  business: {
    type: "business",
    approvalType: "reimbursement_business",
    label: "商务报销",
    shortLabel: "商务",
    listRoute: "/business-reimbursement",
    createRoute: "/business-reimbursement/create",
    accentColor: "#13c2c2",
    accentHoverColor: "#33d1d1",
    accentActiveColor: "#0fa8a8",
    tagType: "danger",
    scopeListEndpoint: "/api/reimbursement-scope/list",
    scopeManagementBase: "/api/reimbursement-scope",
    description:
      "商务报销适用于商务接待、客户拜访、商务差旅等业务活动产生的费用。",
  },
  welfare_one: {
    type: "welfare_one",
    approvalType: "reimbursement_welfare_one",
    label: "福利1报销",
    shortLabel: "福利1",
    listRoute: "/welfare-one-reimbursement",
    createRoute: "/welfare-one-reimbursement/create",
    accentColor: "#8b5cf6",
    accentHoverColor: "#a78bfa",
    accentActiveColor: "#7c3aed",
    tagType: "primary",
    scopeListEndpoint: "/api/reimbursement-scope/welfare-one/list",
    scopeManagementBase: "/api/reimbursement-scope/welfare-one",
    description: "福利1报销使用独立的福利分类，提交后直接进入待付款。",
  },
  welfare_two: {
    type: "welfare_two",
    approvalType: "reimbursement_welfare_two",
    label: "福利2报销",
    shortLabel: "福利2",
    listRoute: "/welfare-two-reimbursement",
    createRoute: "/welfare-two-reimbursement/create",
    accentColor: "#c77d9a",
    accentHoverColor: "#d69ab1",
    accentActiveColor: "#ad5f7d",
    tagType: "danger",
    scopeListEndpoint: "/api/reimbursement-scope/welfare-two/list",
    scopeManagementBase: "/api/reimbursement-scope/welfare-two",
    description: "福利2报销使用独立的福利分类，提交后直接进入待付款。",
  },
};

export const REIMBURSEMENT_FILTER_OPTIONS = REIMBURSEMENT_TYPE_CODES.map(
  (type) => REIMBURSEMENT_TYPE_CONFIG[type],
);

export function normalizeReimbursementType(type?: string | null): string {
  if (!type) return "";
  return type.startsWith("reimbursement_")
    ? type.slice("reimbursement_".length)
    : type;
}

export function getReimbursementTypeConfig(
  type?: string | null,
): ReimbursementTypeConfig | undefined {
  const normalized = normalizeReimbursementType(type) as ReimbursementType;
  return REIMBURSEMENT_TYPE_CONFIG[normalized];
}

export function getReimbursementTypeLabel(type?: string | null): string {
  return getReimbursementTypeConfig(type)?.label || type || "-";
}

export function getReimbursementTypeRoute(type?: string | null): string {
  return getReimbursementTypeConfig(type)?.listRoute || "";
}

export function getReimbursementTypeTagType(
  type?: string | null,
): ReimbursementTypeConfig["tagType"] {
  return getReimbursementTypeConfig(type)?.tagType || "info";
}

export function getReimbursementTypeAccentColor(type?: string | null): string {
  return getReimbursementTypeConfig(type)?.accentColor || "";
}

export function isApprovalSkipped(record: Record<string, unknown> | null): boolean {
  if (!record) return false;
  if (record.approvalSkipped === true || record.approvalMode === "exempt") {
    return true;
  }

  const history = Array.isArray(record.approvalHistory)
    ? record.approvalHistory
    : [];
  return history.some((item) => {
    if (!item || typeof item !== "object") return false;
    const action = String((item as Record<string, unknown>).action || "");
    return ["auto_approved", "auto_approve", "approval_skipped"].includes(
      action,
    );
  });
}
