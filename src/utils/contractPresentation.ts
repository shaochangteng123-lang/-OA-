import type {
  ContractAssetCategory,
  ContractCategory,
  ContractDeclaredSubtype,
  ContractDeclaredSubtypeOptions,
  ContractExpenseCategory,
  ContractRelationType,
  ContractStatus,
  MoneyValue,
} from "@/types/contract";

export const FALLBACK_CONTRACT_DECLARED_SUBTYPE_OPTIONS: ContractDeclaredSubtypeOptions =
  {
    main_business: [
      { value: "engineering_consulting", label: "工程咨询服务" },
      { value: "preliminary_procedures", label: "项目前期手续办理" },
      { value: "technical_consulting", label: "技术咨询服务" },
    ],
    non_main: [
      { value: "non_main_income", label: "非主营业务收入合同" },
      { value: "other_service", label: "其他服务合同" },
    ],
    asset: [
      { value: "procurement", label: "采购合同" },
      { value: "software", label: "软件合同" },
      { value: "equipment", label: "设备合同" },
      { value: "house_rental", label: "房屋租赁" },
      { value: "vehicle_rental", label: "汽车租赁" },
      { value: "parking_space", label: "车位合同" },
      { value: "office_asset", label: "办公资产合同" },
    ],
  };

export const CONTRACT_DECLARED_SUBTYPE_LABELS: Record<
  ContractDeclaredSubtype,
  string
> = {
  engineering_consulting: "工程咨询服务",
  preliminary_procedures: "项目前期手续办理",
  technical_consulting: "技术咨询服务",
  non_main_income: "非主营业务收入合同",
  other_service: "其他服务合同",
  procurement: "采购合同",
  software: "软件合同",
  equipment: "设备合同",
  house_rental: "房屋租赁",
  vehicle_rental: "汽车租赁",
  parking_space: "车位合同",
  office_asset: "办公资产合同",
};

export const CONTRACT_ASSET_CATEGORY_LABELS: Record<
  ContractAssetCategory,
  string
> = {
  procurement: "采购合同",
  software: "软件合同",
  equipment: "设备合同",
  house_rental: "房屋租赁",
  vehicle_rental: "汽车租赁",
  parking_space: "车位合同",
  office_asset: "办公资产合同",
  other: "其他",
};

export const CONTRACT_EXPENSE_CATEGORY_LABELS: Record<
  ContractExpenseCategory,
  string
> = {
  rent: "房租",
  electricity: "电费",
  parking: "车位费",
  car_rental: "租车",
  internet: "网费",
  other: "其他",
};

export const CONTRACT_CATEGORY_LABELS: Record<ContractCategory, string> = {
  main_business: "主营项目合同",
  non_main: "非主营项目合同",
  asset: "资产类合同",
};

export const CONTRACT_RELATION_LABELS: Record<ContractRelationType, string> = {
  main: "主合同",
  supplement: "补充协议",
  termination: "解除协议",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "草拟中",
  approving: "审批中",
  pending_seal: "待盖章",
  effective: "生效中",
  executing: "执行中",
  completed: "已完成",
  rejected: "已拒绝",
  terminated: "终止",
};

export const CONTRACT_STATUS_TYPES: Record<
  ContractStatus,
  "primary" | "success" | "warning" | "danger" | "info"
> = {
  draft: "info",
  approving: "warning",
  pending_seal: "warning",
  effective: "primary",
  executing: "primary",
  completed: "success",
  rejected: "danger",
  terminated: "danger",
};

export function moneyToNumber(value: MoneyValue | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const normalized =
    typeof value === "string" ? value.replace(/,/g, "") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatContractMoney(
  value: MoneyValue | null | undefined,
  emptyText = "¥0.00",
): string {
  if (value === null || value === undefined || value === "") return emptyText;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(moneyToNumber(value));
}

export function formatContractDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatContractDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function businessDateParts(value: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function getContractBusinessDate(value = new Date()): string {
  const parts = businessDateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getContractBusinessMonth(value = new Date()): string {
  const parts = businessDateParts(value);
  return `${parts.year}-${parts.month}`;
}

export function normalizeContractPercent(value?: number | null): number {
  if (value === null || value === undefined || !Number.isFinite(value))
    return 0;
  return Math.max(0, Math.round(value * 100) / 100);
}

export function clampPercent(value?: number | null): number {
  return Math.min(100, normalizeContractPercent(value));
}

export function shouldDisplayContractCurrentAmount(
  currentAmount: MoneyValue | null | undefined,
  status: ContractStatus,
  relationType?: ContractRelationType,
  pendingAction?: "seal" | "termination" | null,
): boolean {
  if (
    currentAmount === null ||
    currentAmount === undefined ||
    currentAmount === ""
  ) {
    return false;
  }
  if (moneyToNumber(currentAmount) !== 0) return true;
  return (
    ["effective", "executing", "completed", "rejected", "terminated"].includes(
      status,
    ) ||
    relationType === "supplement" ||
    relationType === "termination" ||
    (status === "approving" && pendingAction === "termination")
  );
}

export function escapeContractCsvCell(value: unknown): string {
  const text = String(value ?? "");
  const formulaCandidate = text.replace(/^[\t\r\n ]+/, "");
  const isNegativeNumber = /^-\d+(?:\.\d+)?$/.test(formulaCandidate);
  const formulaLike =
    /^[=+@]/.test(formulaCandidate) ||
    (/^-/.test(formulaCandidate) && !isNegativeNumber) ||
    /^[\t\r\n]/.test(text);
  const safeText = formulaLike ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}
