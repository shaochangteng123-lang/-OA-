import type { PoolClient } from "pg";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { validateFilePath } from "../utils/file-validation.js";
import {
  centsToAmount,
  MAX_CONTRACT_AMOUNT_CENTS,
  toCents,
} from "./contractAccounting.js";
import { contractCostSettlementAmountSql } from "./contractSettlementAccounting.js";
import {
  CONTRACT_PROJECT_AUTOMATIC_ADOPTION_MINIMUM_SCORE_GAP,
  extractContractBusinessNumber,
  extractContractLeaseTerms,
  extractReferencedParentContractBusinessNumber,
  type ContractAmountAutomaticAdoptionContext,
  type ContractOcrAutomaticAdoptionSafetyContext,
} from "./contractOcr.js";
import {
  cleanupApprovedContractSealApplicationArtifact,
  ContractSealApplicationError,
  generateApprovedContractSealApplication,
  type ContractSealApplicationApprovalArtifact,
} from "./contractSealApplication.js";
import {
  SupplementAmountCalculationError,
  calculateSupplementAmountSnapshot,
} from "./contractSupplementAmount.js";
import { collectContractAuxiliaryDraftStoredPaths } from "./contractDraftAuxiliaryCleanup.js";
import {
  lockInvoiceApplicationRootByFinancialSource,
  reconcileInvoiceApplicationAllocations,
} from "./invoiceApplication.js";
import {
  allocateAvailableContractFinancialAmounts,
  CONTRACT_COMPANY_SUBJECTS,
  resolveContractFinancialCompanySubject,
} from "./contractFinancialWorkflow.js";

export type ContractCategory = "main_business" | "non_main" | "asset";
export type ContractDeclaredSubtype =
  | "engineering_consulting"
  | "preliminary_procedures"
  | "technical_consulting"
  | "non_main_income"
  | "other_service"
  | "procurement"
  | "software"
  | "equipment"
  | "house_rental"
  | "vehicle_rental"
  | "parking_space"
  | "office_asset";
export type ContractAssetCategory =
  | "procurement"
  | "software"
  | "equipment"
  | "house_rental"
  | "vehicle_rental"
  | "parking_space"
  | "office_asset"
  | "other";
export type ContractExpenseCategory =
  | "rent"
  | "electricity"
  | "parking"
  | "car_rental"
  | "internet"
  | "other";
export type ContractAssetFundingMode =
  | "engineering_direct"
  | "engineering_to_technology"
  | "technology_direct"
  | "pending_review";

export function inferAssetFundingMode(
  category: ContractCategory | null,
  partyA: unknown,
  partyB: unknown,
  companySubjects: readonly {
    name: string;
    taxId?: string;
  }[] = CONTRACT_COMPANY_SUBJECTS,
): ContractAssetFundingMode | null {
  if (category !== "asset") return null;
  const subject = resolveContractFinancialCompanySubject(
    [partyA, partyB],
    companySubjects,
  );
  if (!subject) return "pending_review";
  return subject.name.normalize("NFKC").replace(/\s+/gu, "").trim() ===
    "北京羽隶工程咨询有限公司"
    ? "engineering_direct"
    : "engineering_to_technology";
}
export type ContractRelationType = "main" | "supplement" | "termination";
export type ContractSupplementChangeType =
  | "payment_terms_only"
  | "amount_adjustment"
  | "amount_and_payment"
  | "legacy_unresolved";
export type ContractStatus =
  | "draft"
  | "approving"
  | "pending_seal"
  | "effective"
  | "executing"
  | "completed"
  | "rejected"
  | "terminated";
export type ContractTerminationRestoreStatus = Extract<
  ContractStatus,
  "effective" | "executing" | "completed"
>;
export type ContractPendingAction = "seal" | "termination";
export type ContractApprovalKind = "seal" | "termination" | "seal_difference";
export type ContractApprovalTargetSource = "project_owner" | "general_manager";

const CONTRACT_FULL_READ_ROLES = new Set([
  "admin",
  "super_admin",
  "chairman",
  "general_manager",
]);
const CONTRACT_RESTRICTED_READ_ROLES = new Set(["user", "boss"]);

/**
 * 合同可见范围以服务端为准：管理员组与总经理可查看全部合同；普通员工和
 * BOSS 只能查看具体行政区合同，不能通过伪造查询参数读取“全部”区域合同。
 */
export function canViewContractArea(actorRole: string, area: string): boolean {
  if (CONTRACT_FULL_READ_ROLES.has(actorRole)) return true;
  return CONTRACT_RESTRICTED_READ_ROLES.has(actorRole) && area !== "全部";
}

/** 普通员工和 BOSS 即使知道文件编号，也不能直接调用合同下载接口。 */
export function canDirectDownloadContractFile(actorRole: string): boolean {
  return CONTRACT_FULL_READ_ROLES.has(actorRole);
}

export function requiresRestrictedContractArea(actorRole: string): boolean {
  return CONTRACT_RESTRICTED_READ_ROLES.has(actorRole);
}

export function isContractBusinessApproverRole(actorRole: string): boolean {
  return actorRole === "general_manager";
}

export interface ContractApprovalTarget {
  id: string;
  name: string;
  role: string;
  source: ContractApprovalTargetSource;
  projectIdSnapshot: string | null;
}

export interface ContractApprovalRound {
  id: string;
  contract_id: string;
  approval_kind: ContractApprovalKind;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  initiator_id: string;
  initiator_role: string;
  target_approver_id: string;
  target_approver_name_snapshot: string;
  target_approver_role_snapshot: string;
  target_source: ContractApprovalTargetSource;
  project_id_snapshot: string | null;
  submitted_at: string;
  completed_at: string | null;
  completed_by: string | null;
  completed_action: "approve" | "reject" | "withdraw" | null;
  created_at: string;
  updated_at: string;
}

export const BEIJING_CONTRACT_AREAS = [
  "全部",
  "东城区",
  "西城区",
  "朝阳区",
  "海淀区",
  "丰台区",
  "石景山区",
  "门头沟区",
  "房山区",
  "通州区",
  "顺义区",
  "昌平区",
  "大兴区",
  "怀柔区",
  "平谷区",
  "密云区",
  "延庆区",
] as const;

const BEIJING_CONTRACT_AREA_SET = new Set<string>(BEIJING_CONTRACT_AREAS);
const CONTRACT_CATEGORY_SET = new Set<string>([
  "main_business",
  "non_main",
  "asset",
]);
const CONTRACT_DECLARED_SUBTYPES_BY_CATEGORY: Record<
  ContractCategory,
  ReadonlySet<string>
> = {
  main_business: new Set([
    "engineering_consulting",
    "preliminary_procedures",
    "technical_consulting",
  ]),
  non_main: new Set(["non_main_income", "other_service"]),
  asset: new Set([
    "procurement",
    "software",
    "equipment",
    "house_rental",
    "vehicle_rental",
    "parking_space",
    "office_asset",
  ]),
};
const DEFAULT_DECLARED_SUBTYPE_BY_CATEGORY: Record<
  ContractCategory,
  ContractDeclaredSubtype
> = {
  main_business: "engineering_consulting",
  non_main: "non_main_income",
  asset: "procurement",
};
const NEW_CONTRACT_ASSET_CATEGORY_SET = new Set<string>([
  "procurement",
  "software",
  "equipment",
  "house_rental",
  "vehicle_rental",
  "parking_space",
  "office_asset",
]);
const STORED_CONTRACT_ASSET_CATEGORY_SET = new Set<string>([
  ...NEW_CONTRACT_ASSET_CATEGORY_SET,
  "other",
]);
const CONTRACT_FINANCE_ROLES = new Set(["admin", "super_admin", "chairman"]);

export interface ContractRow {
  id: string;
  contract_no: string | null;
  business_contract_no: string | null;
  title: string | null;
  description: string | null;
  requires_auxiliary_materials: boolean;
  declared_category: ContractCategory | null;
  declared_subtype: ContractDeclaredSubtype | null;
  category: ContractCategory | null;
  asset_category: ContractAssetCategory | null;
  relation_type: ContractRelationType;
  status: ContractStatus;
  area: string;
  project_id: string | null;
  parent_contract_id: string | null;
  root_contract_id: string | null;
  termination_target_contract_id?: string | null;
  renewed_from_contract_id: string | null;
  renewed_from_lease_end_date: string | null;
  party_a: string | null;
  party_b: string | null;
  project_name: string | null;
  amount_delta: number | null;
  original_contract_amount: number | null;
  recognized_original_amount: number | null;
  recognized_final_amount: number | null;
  amount_before_change: number | null;
  amount_after_change: number | null;
  current_effective_amount: number | null;
  supplement_change_type: ContractSupplementChangeType | null;
  supplement_sequence: number | null;
  contract_date: string | null;
  contract_date_source: "ocr" | "manual" | "upload_date" | null;
  lease_start_date: string | null;
  lease_end_date: string | null;
  lease_monthly_rent: number | null;
  lease_monthly_property_fee: number | null;
  lease_term_months: number | null;
  lease_amount_source:
    | "contract_total"
    | "monthly_rent_calculated"
    | "monthly_rent_property_fee_calculated"
    | null;
  lease_operation_type: "renewal" | null;
  lease_previous_end_date: string | null;
  financial_direction: "income" | "cost" | null;
  financial_direction_source: "contract_category" | "invoice" | null;
  financial_direction_invoice_id: string | null;
  financial_direction_confirmed_by: string | null;
  financial_direction_confirmed_at: string | null;
  financial_direction_version: number;
  asset_funding_mode: ContractAssetFundingMode | null;
  pending_action: ContractPendingAction | null;
  previous_status: ContractStatus | null;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export class ContractDomainError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ContractDomainError";
  }
}

export function isBeijingContractArea(value: unknown): value is string {
  return (
    typeof value === "string" && BEIJING_CONTRACT_AREA_SET.has(value.trim())
  );
}

/** 合同财务方向完全由锁定合同大类决定。 */
export function financialDirectionFromContractCategory(
  category: ContractCategory,
): "income" | "cost" {
  return category === "asset" ? "cost" : "income";
}

export function normalizeAutomaticContractConfidence(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed)) return 0;
  const percentage = parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;
  // 只有识别服务显式写出的整数 100 才代表自动独立验证通过；比例值 1
  // 不能在传输规范化阶段被提升为 100。
  if (parsed === 100 && percentage === 100) return 100;
  return Math.max(0, Math.min(99, Math.floor(percentage)));
}

export const CONTRACT_OCR_AUTOMATIC_ACCEPTANCE_THRESHOLD = 100;

export function isExactAutomaticContractConfidence(value: unknown): boolean {
  if (
    typeof value !== "number" &&
    !(
      typeof value === "string" &&
      /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
    )
  ) {
    return false;
  }
  const parsed = Number(value);
  return parsed === CONTRACT_OCR_AUTOMATIC_ACCEPTANCE_THRESHOLD;
}

export interface ContractUploadContext {
  area: string;
  declaredCategory: ContractCategory;
  declaredSubtype: ContractDeclaredSubtype;
  assetCategory: ContractAssetCategory | null;
}

export function validateNewContractUploadContext(input: {
  area: unknown;
  declaredCategory: unknown;
  declaredSubtype?: unknown;
  assetCategory?: unknown;
}): ContractUploadContext {
  const area = typeof input.area === "string" ? input.area.trim() : "";
  if (!area) {
    throw new ContractDomainError(
      400,
      "上传合同前必须选择所属行政区",
      "CONTRACT_AREA_REQUIRED",
    );
  }
  if (!isBeijingContractArea(area)) {
    throw new ContractDomainError(
      400,
      "合同所属区域必须是北京市行政区",
      "CONTRACT_AREA_INVALID",
    );
  }

  const declaredCategory =
    typeof input.declaredCategory === "string"
      ? input.declaredCategory.trim()
      : "";
  if (!declaredCategory) {
    throw new ContractDomainError(
      400,
      "上传合同前必须选择合同分类",
      "CONTRACT_DECLARED_CATEGORY_REQUIRED",
    );
  }
  if (!CONTRACT_CATEGORY_SET.has(declaredCategory)) {
    throw new ContractDomainError(
      400,
      "预选合同分类不正确",
      "CONTRACT_DECLARED_CATEGORY_INVALID",
    );
  }

  const rawDeclaredSubtype =
    (typeof input.declaredSubtype === "string"
      ? input.declaredSubtype.trim()
      : "") ||
    DEFAULT_DECLARED_SUBTYPE_BY_CATEGORY[declaredCategory as ContractCategory];
  const declaredSubtypeSet =
    CONTRACT_DECLARED_SUBTYPES_BY_CATEGORY[
      declaredCategory as ContractCategory
    ];
  if (!declaredSubtypeSet.has(rawDeclaredSubtype)) {
    throw new ContractDomainError(
      400,
      "合同二级分类与合同大类不一致",
      "CONTRACT_DECLARED_SUBTYPE_MISMATCH",
    );
  }

  const rawAssetCategory =
    typeof input.assetCategory === "string" ? input.assetCategory.trim() : "";
  if (declaredCategory === "asset") {
    if (!NEW_CONTRACT_ASSET_CATEGORY_SET.has(rawDeclaredSubtype)) {
      throw new ContractDomainError(
        400,
        "新上传资产类合同的资产分类不正确",
        "CONTRACT_ASSET_CATEGORY_INVALID",
      );
    }
    if (rawAssetCategory && rawAssetCategory !== rawDeclaredSubtype) {
      throw new ContractDomainError(
        400,
        "合同二级分类与资产分类不一致",
        "CONTRACT_ASSET_CATEGORY_MISMATCH",
      );
    }
  } else if (rawAssetCategory) {
    throw new ContractDomainError(
      400,
      "非资产类合同不能选择资产分类",
      "CONTRACT_ASSET_CATEGORY_NOT_ALLOWED",
    );
  }

  return {
    area,
    declaredCategory: declaredCategory as ContractCategory,
    declaredSubtype: rawDeclaredSubtype as ContractDeclaredSubtype,
    assetCategory:
      declaredCategory === "asset"
        ? (rawDeclaredSubtype as ContractAssetCategory)
        : null,
  };
}

export function assertStoredContractUploadContext(
  contract: Pick<
    ContractRow,
    "area" | "declared_category" | "declared_subtype" | "asset_category"
  >,
): void {
  if (!isBeijingContractArea(contract.area)) {
    throw new ContractDomainError(
      409,
      "该历史草稿缺少有效行政区，请重新上传合同",
      "CONTRACT_AREA_REQUIRED",
    );
  }
  if (
    !contract.declared_category ||
    !CONTRACT_CATEGORY_SET.has(contract.declared_category)
  ) {
    throw new ContractDomainError(
      409,
      "该历史草稿缺少上传时预选合同分类，请重新上传合同",
      "CONTRACT_DECLARED_CATEGORY_REQUIRED",
    );
  }
  if (
    !contract.declared_subtype ||
    !CONTRACT_DECLARED_SUBTYPES_BY_CATEGORY[contract.declared_category].has(
      contract.declared_subtype,
    )
  ) {
    throw new ContractDomainError(
      409,
      "该历史草稿缺少有效合同二级分类，请重新上传合同",
      "CONTRACT_DECLARED_SUBTYPE_REQUIRED",
    );
  }
  if (
    contract.declared_category === "asset" &&
    (!contract.asset_category ||
      !STORED_CONTRACT_ASSET_CATEGORY_SET.has(contract.asset_category) ||
      contract.asset_category !== contract.declared_subtype)
  ) {
    throw new ContractDomainError(
      409,
      "资产类合同缺少有效资产分类，请重新上传合同",
      "CONTRACT_ASSET_CATEGORY_REQUIRED",
    );
  }
  if (
    contract.declared_category !== "asset" &&
    contract.asset_category !== null
  ) {
    throw new ContractDomainError(
      409,
      "合同预选分类与资产分类不一致，请重新上传合同",
      "CONTRACT_ASSET_CATEGORY_NOT_ALLOWED",
    );
  }
}

export function isContractDomainError(
  error: unknown,
): error is ContractDomainError {
  return error instanceof ContractDomainError;
}

const NORMAL_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  draft: ["approving"],
  approving: [
    "draft",
    "pending_seal",
    "effective",
    "executing",
    "completed",
    "rejected",
    "terminated",
  ],
  pending_seal: ["effective", "approving"],
  effective: ["executing", "completed", "approving", "terminated"],
  executing: ["completed", "approving", "terminated"],
  completed: ["executing", "approving", "terminated"],
  rejected: [],
  terminated: [],
};

const TERMINATION_RESTORE_STATUSES = new Set<ContractTerminationRestoreStatus>([
  "effective",
  "executing",
  "completed",
]);

function isContractTerminationRestoreStatus(
  status: ContractStatus | null,
): status is ContractTerminationRestoreStatus {
  return (
    status !== null &&
    TERMINATION_RESTORE_STATUSES.has(status as ContractTerminationRestoreStatus)
  );
}

export function canTransitionContractStatus(
  from: ContractStatus,
  to: ContractStatus,
): boolean {
  return NORMAL_TRANSITIONS[from].includes(to);
}

export function assertContractStatusTransition(
  from: ContractStatus,
  to: ContractStatus,
): void {
  if (!canTransitionContractStatus(from, to)) {
    throw new ContractDomainError(
      409,
      `合同状态不能从 ${from} 变更为 ${to}`,
      "INVALID_CONTRACT_TRANSITION",
    );
  }
}

async function getLockedContract(
  client: PoolClient,
  contractId: string,
): Promise<ContractRow> {
  const result = await client.query<ContractRow>(
    `SELECT * FROM contracts
     WHERE id = $1 AND is_deleted = FALSE
     FOR UPDATE`,
    [contractId],
  );
  const contract = result.rows[0];
  if (!contract)
    throw new ContractDomainError(404, "合同不存在", "CONTRACT_NOT_FOUND");
  return contract;
}

const VALID_PARENT_STATUSES: readonly ContractStatus[] = [
  "effective",
  "executing",
  "completed",
];

/**
 * 补充协议和终止协议只能挂在已生效的根合同下。分类、二级分类、资产分类
 * 和项目均以根合同为准，避免同一合同组被拆入不同核算口径。
 */
export async function resolveContractParentContext(
  client: PoolClient,
  parentContractId: string,
  lockForUpdate = false,
): Promise<ContractRow> {
  const result = await client.query<ContractRow>(
    `SELECT * FROM contracts
     WHERE id = $1 AND is_deleted = FALSE
     ${lockForUpdate ? "FOR UPDATE" : "FOR SHARE"}`,
    [parentContractId],
  );
  const parent = result.rows[0];
  if (!parent) throw new ContractDomainError(400, "关联的上级合同不存在");
  if (
    parent.relation_type !== "main" ||
    (parent.root_contract_id && parent.root_contract_id !== parent.id)
  ) {
    throw new ContractDomainError(400, "补充协议或终止协议只能关联主合同");
  }
  if (!VALID_PARENT_STATUSES.includes(parent.status)) {
    throw new ContractDomainError(
      409,
      parent.status === "rejected"
        ? "已拒绝合同不能再新增补充协议或终止协议"
        : parent.status === "terminated"
          ? "已终止合同不能再新增补充协议或终止协议"
          : "上级合同盖章生效后才能新增补充协议或终止协议",
      "CONTRACT_PARENT_NOT_EFFECTIVE",
    );
  }
  if (!parent.category) {
    throw new ContractDomainError(
      409,
      "上级合同分类不完整，请先联系管理员处理",
    );
  }
  return parent;
}

export function buildSupplementSubjectName(
  parent: Pick<ContractRow, "project_name" | "title">,
  sequence?: number | null,
): string | null {
  const parentName = String(parent.project_name || parent.title || "")
    .normalize("NFKC")
    .trim()
    .replace(/补充协议书?(?:[（(]\d+[）)])?$/u, "")
    .trim();
  if (!parentName) return null;
  return Number.isInteger(sequence) && Number(sequence) > 0
    ? `${parentName}补充协议（${Number(sequence)}）`
    : `${parentName}补充协议`;
}

/**
 * 解除协议名称只继承被解除对象的业务名称，不采用文件中的自由文本标题。
 * 主合同末尾常带“合同／协议书”，生成时去掉该文种后缀；补充协议序号
 * 属于解除对象身份的一部分，必须保留。
 */
export function buildTerminationSubjectName(
  target: Pick<ContractRow, "project_name" | "title">,
): string | null {
  const targetName = String(target.project_name || target.title || "")
    .trim()
    .replace(/(?:解除|终止)协议书?$/u, "")
    .replace(/(?:合同书?|协议书)$/u, "")
    .trim();
  return targetName ? `${targetName}解除协议书` : null;
}

export interface ContractTerminationSettlementSnapshot {
  rootContractId: string;
  targetContractId: string;
  targetRelationType: Extract<ContractRelationType, "main" | "supplement">;
  currentEffectiveAmount: number;
  settledAmount: number;
  unperformedAmount: number;
  amountDelta: number;
}

/**
 * 锁定并校验解除目标。解除协议本身仍挂在根合同第二级，但可以精确指向
 * 主合同或某份已生效的补充协议。
 */
export async function resolveTerminationTargetContext(
  client: PoolClient,
  targetContractId: string,
  lockForUpdate = false,
): Promise<{ root: ContractRow; target: ContractRow }> {
  const targetResult = await client.query<ContractRow>(
    `SELECT * FROM contracts
     WHERE id = $1 AND is_deleted = FALSE
     ${lockForUpdate ? "FOR UPDATE" : "FOR SHARE"}`,
    [targetContractId],
  );
  const target = targetResult.rows[0];
  if (!target || !["main", "supplement"].includes(target.relation_type)) {
    throw new ContractDomainError(
      404,
      "被解除的主合同或补充协议不存在",
      "CONTRACT_TERMINATION_TARGET_NOT_FOUND",
    );
  }
  if (!VALID_PARENT_STATUSES.includes(target.status)) {
    throw new ContractDomainError(
      409,
      "只有已生效、执行中或已完成的合同才能上传解除协议书",
      "CONTRACT_TERMINATION_TARGET_NOT_EFFECTIVE",
    );
  }
  const rootId =
    target.relation_type === "main"
      ? target.id
      : target.root_contract_id || target.parent_contract_id;
  if (!rootId) {
    throw new ContractDomainError(
      409,
      "被解除的补充协议缺少主合同关联",
      "CONTRACT_TERMINATION_TARGET_ROOT_MISSING",
    );
  }
  const root =
    target.id === rootId
      ? target
      : (
          await client.query<ContractRow>(
            `SELECT * FROM contracts
             WHERE id = $1 AND relation_type = 'main' AND is_deleted = FALSE
             ${lockForUpdate ? "FOR UPDATE" : "FOR SHARE"}`,
            [rootId],
          )
        ).rows[0];
  if (!root || !VALID_PARENT_STATUSES.includes(root.status)) {
    throw new ContractDomainError(
      409,
      "解除目标所属主合同当前不可解除",
      "CONTRACT_TERMINATION_ROOT_NOT_EFFECTIVE",
    );
  }
  if (
    target.relation_type === "supplement" &&
    (target.amount_delta == null ||
      toCents(target.amount_delta) <= 0 ||
      target.amount_before_change == null)
  ) {
    throw new ContractDomainError(
      409,
      "仅支持解除具有完整金额链快照的正向补充协议；核减或仅变更付款方式的补充协议请先人工核对",
      "CONTRACT_TERMINATION_SUPPLEMENT_AMOUNT_UNSUPPORTED",
    );
  }
  return { root, target };
}

/**
 * 解除金额完全由已确认且未冲正的实际收付款派生，不从解除协议正文猜测。
 * 主合同按整条合同链汇总；补充协议复用既有金额链，先履行生效前金额，
 * 超出 amount_before_change（变更前金额）的部分归属本份正向补充协议。
 */
export async function calculateTerminationSettlementSnapshot(
  client: PoolClient,
  targetContractId: string,
  cutoffDate?: string | null,
  lockForUpdate = false,
): Promise<ContractTerminationSettlementSnapshot> {
  const { root, target } = await resolveTerminationTargetContext(
    client,
    targetContractId,
    lockForUpdate,
  );
  const rootCategory = root.category || root.declared_category;
  if (!rootCategory) {
    throw new ContractDomainError(
      409,
      "主合同缺少合同分类，不能计算解除结算金额",
      "CONTRACT_TERMINATION_CATEGORY_MISSING",
    );
  }
  const financialDirection =
    root.financial_direction ||
    financialDirectionFromContractCategory(rootCategory);
  const currentEffectiveAmount =
    target.relation_type === "main"
      ? Number(
          root.current_effective_amount ??
            root.original_contract_amount ??
            root.amount_delta ??
            0,
        )
      : Number(target.amount_delta || 0);
  const settlementAmountSql =
    financialDirection === "income"
      ? `COALESCE((
          SELECT SUM(settlement_receipt.amount)
          FROM contract_receipts settlement_receipt
          JOIN contracts settlement_contract
            ON settlement_contract.id = settlement_receipt.contract_id
          WHERE COALESCE(
              settlement_contract.root_contract_id,
              settlement_contract.id
            ) = settlement_root.id
            AND settlement_contract.is_deleted = FALSE
            AND settlement_contract.status <> 'rejected'
            AND settlement_receipt.status = 'confirmed'
            AND ($2::text IS NULL OR settlement_receipt.receipt_date <= $2)
        ), 0)`
      : contractCostSettlementAmountSql({
          rootAlias: "settlement_root",
          rootIdExpression: "settlement_root.id",
          paymentDatePredicate:
            "$2::text IS NULL OR settlement_payment.payment_date <= $2",
        });
  const settlementResult = await client.query<{ settled_amount: number }>(
    `SELECT ${settlementAmountSql} AS settled_amount
     FROM contracts settlement_root
     WHERE settlement_root.id = $1
       AND settlement_root.is_deleted = FALSE`,
    [root.id, cutoffDate || null],
  );
  const currentCents = Math.max(0, toCents(currentEffectiveAmount));
  const rootCurrentCents = Math.max(
    0,
    toCents(
      root.current_effective_amount ??
        root.original_contract_amount ??
        root.amount_delta ??
        0,
    ),
  );
  const rootSettledCents = Math.max(
    0,
    toCents(settlementResult.rows[0]?.settled_amount || 0),
  );
  if (rootSettledCents > rootCurrentCents) {
    throw new ContractDomainError(
      409,
      `已确认结算金额 ${centsToAmount(rootSettledCents).toFixed(2)} 元超过当前有效合同金额 ${centsToAmount(rootCurrentCents).toFixed(2)} 元，请先核对或冲正`,
      "CONTRACT_TERMINATION_SETTLEMENT_EXCEEDS_AMOUNT",
    );
  }
  // 财务登记统一落在主合同。解除正向补充协议时按金额链顺序归属：先履行
  // 该协议生效前金额，超出部分才属于本份补充协议。
  const settledCents =
    target.relation_type === "main"
      ? rootSettledCents
      : Math.min(
          currentCents,
          Math.max(
            0,
            rootSettledCents - toCents(target.amount_before_change || 0),
          ),
        );
  const unperformedCents = currentCents - settledCents;
  if (
    target.relation_type === "supplement" &&
    unperformedCents > rootCurrentCents
  ) {
    throw new ContractDomainError(
      409,
      "补充协议未履行金额超过主合同当前有效金额，不能自动解除，请先核对后续金额变更",
      "CONTRACT_TERMINATION_SUPPLEMENT_CHAIN_CONFLICT",
    );
  }
  return {
    rootContractId: root.id,
    targetContractId: target.id,
    targetRelationType: target.relation_type as "main" | "supplement",
    currentEffectiveAmount: centsToAmount(currentCents),
    settledAmount: centsToAmount(settledCents),
    unperformedAmount: centsToAmount(unperformedCents),
    amountDelta: unperformedCents === 0 ? 0 : centsToAmount(-unperformedCents),
  };
}

function terminationSnapshotMatchesContract(
  contract: ContractRow,
  snapshot: ContractTerminationSettlementSnapshot,
): boolean {
  return (
    contract.termination_target_contract_id === snapshot.targetContractId &&
    contract.amount_before_change != null &&
    contract.amount_after_change != null &&
    contract.amount_delta != null &&
    toCents(contract.amount_before_change) ===
      toCents(snapshot.currentEffectiveAmount) &&
    toCents(contract.amount_after_change) === toCents(snapshot.settledAmount) &&
    toCents(contract.amount_delta) === toCents(snapshot.amountDelta)
  );
}

/** 提交审批前确认解除结算快照没有被新增、冲正的财务凭证改变。 */
export async function freezeTerminationSettlementSnapshotForApproval(
  client: PoolClient,
  contract: ContractRow,
): Promise<ContractRow> {
  if (contract.relation_type !== "termination") return contract;
  if (!contract.termination_target_contract_id) {
    throw new ContractDomainError(
      409,
      "解除协议缺少被解除合同",
      "CONTRACT_TERMINATION_TARGET_REQUIRED",
    );
  }
  const snapshot = await calculateTerminationSettlementSnapshot(
    client,
    contract.termination_target_contract_id,
    contract.contract_date,
    true,
  );
  if (!terminationSnapshotMatchesContract(contract, snapshot)) {
    throw new ContractDomainError(
      409,
      "解除协议识别后合同结算金额已发生变化，请重新识别后再提交审批",
      "CONTRACT_TERMINATION_SETTLEMENT_CHANGED",
    );
  }
  return contract;
}

/**
 * 解除协议盖章归档时才结束目标合同。归档事务会再次计算结算金额，审批
 * 期间如出现任何收付款变化即阻断，避免审批金额与最终结果不一致。
 */
export async function applyTerminationAgreementAtEffective(
  client: PoolClient,
  contract: ContractRow,
  effectiveDate: string,
  effectiveAt: string,
  actorId: string,
  actorRole: string,
): Promise<ContractTerminationSettlementSnapshot | null> {
  if (contract.relation_type !== "termination") return null;
  if (!contract.termination_target_contract_id) {
    throw new ContractDomainError(
      409,
      "解除协议缺少被解除合同",
      "CONTRACT_TERMINATION_TARGET_REQUIRED",
    );
  }
  const snapshot = await calculateTerminationSettlementSnapshot(
    client,
    contract.termination_target_contract_id,
    effectiveDate,
    true,
  );
  if (!terminationSnapshotMatchesContract(contract, snapshot)) {
    throw new ContractDomainError(
      409,
      "解除协议审批后合同结算金额发生变化，不能直接归档，请退回草稿重新识别并审批",
      "CONTRACT_TERMINATION_SETTLEMENT_CHANGED",
    );
  }
  const target = await getLockedContract(client, snapshot.targetContractId);
  assertContractStatusTransition(target.status, "terminated");
  if (snapshot.targetRelationType === "main") {
    const unfinishedChild = await client.query<{ id: string }>(
      `SELECT id FROM contracts
       WHERE root_contract_id = $1 AND id <> $2 AND is_deleted = FALSE
         AND relation_type IN ('supplement', 'termination')
         AND status IN ('draft', 'approving', 'pending_seal')
       ORDER BY created_at, id LIMIT 1`,
      [snapshot.rootContractId, contract.id],
    );
    if (unfinishedChild.rows[0]) {
      throw new ContractDomainError(
        409,
        "主合同仍有未完成的子协议，请先完成、驳回或删除后再归档解除协议",
        "CONTRACT_TERMINATION_PENDING_CHILD",
      );
    }
  }
  await client.query(
    `UPDATE contracts SET status = 'terminated', terminated_at = $2,
       current_effective_amount = CASE WHEN relation_type = 'main' THEN $3
         ELSE current_effective_amount END,
       pending_action = NULL, previous_status = NULL,
       updated_by = $4, updated_at = $2, version = version + 1
     WHERE id = $1`,
    [target.id, effectiveAt, snapshot.settledAmount, actorId],
  );
  if (snapshot.targetRelationType === "supplement") {
    await client.query(
      `UPDATE contracts SET
         current_effective_amount = COALESCE(
           current_effective_amount, original_contract_amount, amount_delta, 0
         ) + $2,
         updated_by = $3, updated_at = $4, version = version + 1
       WHERE id = $1 AND relation_type = 'main' AND is_deleted = FALSE`,
      [snapshot.rootContractId, snapshot.amountDelta, actorId, effectiveAt],
    );
  }
  await insertAudit(client, {
    contractId: target.id,
    action: "termination_agreement_effective",
    actorId,
    actorRole,
    fromStatus: target.status,
    toStatus: "terminated",
    changes: {
      terminationContractId: contract.id,
      effectiveDate,
      currentEffectiveAmount: snapshot.currentEffectiveAmount,
      settledAmount: snapshot.settledAmount,
      unperformedAmount: snapshot.unperformedAmount,
      amountDelta: snapshot.amountDelta,
    },
    now: effectiveAt,
  });
  return snapshot;
}

/**
 * 在已锁定根合同的事务中分配补充协议序号。正式协议及非草稿撤销记录的
 * 序号不回收；永久删除草稿后，其余草稿按创建顺序紧凑重排。
 * 根合同行锁负责串行化同一合同链的并发上传，唯一索引负责最终兜底。
 */
export async function allocateSupplementSequence(
  client: PoolClient,
  rootContractId: string,
): Promise<number> {
  await client.query(
    `SELECT id FROM contracts WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
    [rootContractId],
  );
  const result = await client.query<{ next_sequence: number }>(
    `SELECT COALESCE(MAX(supplement_sequence), 0) + 1 AS next_sequence
     FROM contracts
     WHERE root_contract_id = $1 AND relation_type = 'supplement'`,
    [rootContractId],
  );
  return Number(result.rows[0]?.next_sequence || 1);
}

async function lockedRootCurrentAmount(
  client: PoolClient,
  rootContractId: string,
): Promise<{ root: ContractRow; amount: number }> {
  const rootResult = await client.query<ContractRow>(
    `SELECT * FROM contracts
     WHERE id = $1 AND relation_type = 'main' AND is_deleted = FALSE
     FOR UPDATE`,
    [rootContractId],
  );
  const root = rootResult.rows[0];
  if (!root) {
    throw new ContractDomainError(409, "补充协议关联的主合同不存在");
  }
  if (root.current_effective_amount != null) {
    return { root, amount: Number(root.current_effective_amount) };
  }
  return {
    root,
    amount: Number(root.original_contract_amount ?? root.amount_delta ?? 0),
  };
}

function calculateStoredSupplementSnapshot(
  contract: ContractRow,
  amountBefore: number,
) {
  if (!contract.supplement_change_type) {
    throw new ContractDomainError(
      409,
      "补充协议尚未形成可采用的金额或付款方式识别结果，请重新识别",
      "SUPPLEMENT_AMOUNT_UNRESOLVED",
    );
  }
  try {
    return calculateSupplementAmountSnapshot({
      beforeAmount: amountBefore,
      recognizedChangeAmount: contract.amount_delta,
      recognizedFinalAmount: contract.recognized_final_amount,
      amountStatus:
        contract.supplement_change_type === "payment_terms_only"
          ? "payment_only"
          : "calculated_amount",
      paymentTermsDetected: [
        "payment_terms_only",
        "amount_and_payment",
      ].includes(contract.supplement_change_type),
    });
  } catch (error) {
    if (error instanceof SupplementAmountCalculationError) {
      throw new ContractDomainError(409, error.message, error.code);
    }
    throw error;
  }
}

/** 提交审批时按主合同当前有效金额冻结本份补充协议的金额链快照。 */
export async function freezeSupplementAmountSnapshotForApproval(
  client: PoolClient,
  contract: ContractRow,
): Promise<ContractRow> {
  if (contract.relation_type !== "supplement") return contract;
  const rootId = contract.root_contract_id || contract.parent_contract_id;
  if (!rootId) {
    throw new ContractDomainError(409, "补充协议缺少主合同关联");
  }
  const { amount: amountBefore } = await lockedRootCurrentAmount(
    client,
    rootId,
  );
  if (
    contract.recognized_original_amount != null &&
    toCents(contract.recognized_original_amount) !== toCents(amountBefore)
  ) {
    throw new ContractDomainError(
      409,
      `补充协议原文生效前金额 ${Number(contract.recognized_original_amount).toFixed(2)} 元与主合同当前有效金额 ${amountBefore.toFixed(2)} 元不一致，请核对前序协议后重新识别`,
      "SUPPLEMENT_AMOUNT_BEFORE_MISMATCH",
    );
  }
  const snapshot = calculateStoredSupplementSnapshot(contract, amountBefore);
  const storedSnapshotMatches =
    contract.amount_before_change != null &&
    contract.amount_after_change != null &&
    contract.amount_delta != null &&
    toCents(contract.amount_before_change) === toCents(snapshot.before) &&
    toCents(contract.amount_after_change) === toCents(snapshot.after) &&
    toCents(contract.amount_delta) === toCents(snapshot.delta) &&
    contract.supplement_change_type === snapshot.changeType;
  if (!storedSnapshotMatches) {
    throw new ContractDomainError(
      409,
      "主合同当前有效金额或补充协议金额依据已发生变化，请重新识别后再提交审批",
      "SUPPLEMENT_AMOUNT_SNAPSHOT_STALE",
    );
  }
  return contract;
}

/**
 * 盖章归档时校验审批冻结基准未过期，并在同一事务中推进根合同当前有效总额。
 */
export async function advanceSupplementAmountChainAtEffective(
  client: PoolClient,
  contract: ContractRow,
  effectiveAt: string,
): Promise<void> {
  if (contract.relation_type !== "supplement") return;
  const rootId = contract.root_contract_id || contract.parent_contract_id;
  if (!rootId) {
    throw new ContractDomainError(409, "补充协议缺少主合同关联");
  }
  const { amount: currentAmount } = await lockedRootCurrentAmount(
    client,
    rootId,
  );
  const earlierUnfinished = await client.query<{
    id: string;
    sequence: number;
  }>(
    `SELECT id, supplement_sequence AS sequence
     FROM contracts
     WHERE root_contract_id = $1 AND relation_type = 'supplement'
       AND is_deleted = FALSE AND supplement_sequence < $2
       AND status NOT IN ('effective', 'executing', 'completed', 'rejected')
     ORDER BY supplement_sequence ASC LIMIT 1`,
    [rootId, contract.supplement_sequence || Number.MAX_SAFE_INTEGER],
  );
  if (earlierUnfinished.rows[0]) {
    throw new ContractDomainError(
      409,
      `补充协议（${earlierUnfinished.rows[0].sequence}）尚未完成，必须按序生效`,
      "SUPPLEMENT_EFFECTIVE_SEQUENCE_BLOCKED",
    );
  }
  if (
    contract.amount_before_change == null ||
    toCents(contract.amount_before_change) !== toCents(currentAmount)
  ) {
    throw new ContractDomainError(
      409,
      "主合同当前有效金额已因前序补充协议发生变化，本协议须退回草稿并按最新金额重新审批",
      "SUPPLEMENT_AMOUNT_SNAPSHOT_STALE",
    );
  }
  const snapshot = calculateStoredSupplementSnapshot(contract, currentAmount);
  if (
    contract.amount_after_change == null ||
    toCents(contract.amount_after_change) !== toCents(snapshot.after) ||
    contract.amount_delta == null ||
    toCents(contract.amount_delta) !== toCents(snapshot.delta)
  ) {
    throw new ContractDomainError(
      409,
      "补充协议审批金额快照不完整或已变化，不能直接生效",
      "SUPPLEMENT_AMOUNT_SNAPSHOT_INVALID",
    );
  }
  await client.query(
    `UPDATE contracts SET current_effective_amount = $2,
       updated_at = $3, version = version + 1
     WHERE id = $1`,
    [rootId, snapshot.after, effectiveAt],
  );
}

export function supplementSubjectMatchesParent(
  recognizedValue: unknown,
  parent: Pick<ContractRow, "project_name" | "title">,
): boolean | null {
  const normalize = (value: unknown) =>
    String(value || "")
      .normalize("NFKC")
      .replace(/[\s，,。；;：:（）()《》【】[\]]+/gu, "")
      .replace(
        /(?:补充协议书?|变更协议书?|追加协议书?|续签协议书?|续租协议书?|解除协议书?|终止协议书?|合同书?)$/u,
        "",
      )
      .trim();
  const recognized = normalize(recognizedValue);
  const parentName = normalize(parent.project_name || parent.title);
  if (
    !recognized ||
    /^(?:补充|变更|追加|续签|续租)?协议书?$/u.test(recognized)
  ) {
    return null;
  }
  if (!parentName) return false;
  if (recognized === parentName) return true;
  const shorterLength = Math.min(recognized.length, parentName.length);
  const longerLength = Math.max(recognized.length, parentName.length);
  const hasSufficientCoverage = shorterLength / longerLength >= 0.65;
  return (
    shorterLength >= 8 &&
    hasSufficientCoverage &&
    (recognized.startsWith(parentName) ||
      parentName.startsWith(recognized) ||
      recognized.endsWith(parentName) ||
      parentName.endsWith(recognized)) &&
    /(?:千伏|工程|项目|不动产|手续|采购|服务|合同)/u.test(
      recognized.length >= parentName.length ? recognized : parentName,
    )
  );
}

export async function assertRootAmountAfterAdjustment(
  client: PoolClient,
  contract: ContractRow,
  _includeApprovedReservations = false,
): Promise<void> {
  if (!["supplement", "termination"].includes(contract.relation_type)) return;
  const rootId = contract.root_contract_id || contract.parent_contract_id;
  if (!rootId) {
    throw new ContractDomainError(400, "子协议缺少根合同关联");
  }
  let nextTotal: number;
  if (contract.relation_type === "supplement") {
    if (contract.amount_after_change == null) {
      throw new ContractDomainError(
        409,
        "补充协议尚未形成生效前、增减额和生效后金额快照，请重新识别",
        "SUPPLEMENT_AMOUNT_SNAPSHOT_INVALID",
      );
    }
    nextTotal = Number(contract.amount_after_change);
  } else {
    const result = await client.query<{ next_total: number }>(
      `SELECT COALESCE(
         current_effective_amount,
         original_contract_amount,
         amount_delta,
         0
       ) + $2 AS next_total
       FROM contracts
       WHERE id = $1 AND relation_type = 'main' AND is_deleted = FALSE`,
      [rootId, Number(contract.amount_delta || 0)],
    );
    nextTotal = Number(result.rows[0]?.next_total || 0);
  }
  if (Math.abs(nextTotal) > MAX_CONTRACT_AMOUNT_CENTS / 100) {
    throw new ContractDomainError(
      400,
      "合同组总额不能达到或超过一万亿元",
      "CONTRACT_TOTAL_SAFE_RANGE_EXCEEDED",
    );
  }
  if (nextTotal < 0) {
    throw new ContractDomainError(
      400,
      "协议核减金额不能使当前合同总额小于 0",
      "CONTRACT_TOTAL_NEGATIVE",
    );
  }
  if (contract.relation_type === "termination") {
    // 解除协议使用独立的结算快照校验，且需区分主合同与补充协议目标；这里
    // 不再用子协议自身的资金承担方式重复推断结算口径。
    return;
  }
  const settlement = await client.query<{
    received_amount: number;
    cost_settled_amount: number;
  }>(
    `SELECT
       COALESCE((SELECT SUM(r.amount)
         FROM contract_receipts r
         JOIN contracts c ON c.id = r.contract_id
         WHERE COALESCE(c.root_contract_id, c.id) = settlement_root.id
           AND c.status <> 'rejected'
           AND r.status = 'confirmed'), 0) AS received_amount,
       ${contractCostSettlementAmountSql({
         rootAlias: "settlement_root",
         rootIdExpression: "settlement_root.id",
       })} AS cost_settled_amount
     FROM contracts settlement_root
     WHERE settlement_root.id = $1
       AND settlement_root.is_deleted = FALSE`,
    [rootId],
  );
  const settledAmount =
    contract.category === "asset"
      ? Number(settlement.rows[0]?.cost_settled_amount || 0)
      : Number(settlement.rows[0]?.received_amount || 0);
  if (nextTotal < settledAmount) {
    throw new ContractDomainError(
      409,
      `协议生效后的合同总额 ${nextTotal.toFixed(2)} 元低于已确认结算金额 ${settledAmount.toFixed(2)} 元，请先处理退款或冲正`,
      "CONTRACT_TOTAL_BELOW_SETTLED",
    );
  }
}

async function insertAudit(
  client: PoolClient,
  input: {
    contractId: string;
    action: string;
    actorId: string;
    actorRole: string;
    fromStatus?: ContractStatus | null;
    toStatus?: ContractStatus | null;
    changes?: Record<string, unknown>;
    comment?: string | null;
    now?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO contract_audit_logs (
       id, contract_id, action, actor_id, actor_role, from_status, to_status,
       changes_json, comment, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
    [
      nanoid(),
      input.contractId,
      input.action,
      input.actorId,
      input.actorRole,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      JSON.stringify(input.changes ?? {}),
      input.comment?.trim() || null,
      input.now ?? new Date().toISOString(),
    ],
  );
}

/**
 * 正式合同模块是项目合同金额唯一真值。草稿和普通用印审批不计入；终止
 * 审批期间仍按申请前状态计入，避免审批尚未完成时经营数据突然归零。
 */
export async function syncProjectContractTotal(
  client: PoolClient,
  projectId: string | null,
): Promise<void> {
  if (!projectId) return;
  const project = await client.query<{ id: string }>(
    `SELECT id FROM worklog_projects WHERE id = $1 FOR UPDATE`,
    [projectId],
  );
  if (!project.rows[0]) return;
  await client.query(
    `WITH root_groups AS (
       SELECT root_contract.id AS root_id,
         CASE
           WHEN root_contract.status = 'approving'
             AND root_contract.pending_action = 'termination'
             AND root_contract.previous_status IN ('effective', 'executing', 'completed')
           THEN root_contract.previous_status
           ELSE root_contract.status
         END AS effective_root_status,
         COALESCE(
           root_contract.current_effective_amount,
           root_contract.original_contract_amount,
           root_contract.amount_delta,
           0
         ) AS current_amount
       FROM contracts root_contract
       WHERE root_contract.relation_type = 'main'
         AND root_contract.project_id = $1
         AND root_contract.is_deleted = FALSE
     )
     UPDATE worklog_projects p
     SET contract_total_amount = COALESCE((
       SELECT SUM(current_amount)
       FROM root_groups
       WHERE effective_root_status IN ('effective', 'executing', 'completed')
         ), 0),
         contract_status = CASE
           WHEN EXISTS (SELECT 1 FROM root_groups WHERE effective_root_status = 'executing') THEN '执行中'
           WHEN EXISTS (SELECT 1 FROM root_groups WHERE effective_root_status = 'effective') THEN '生效中'
           WHEN EXISTS (SELECT 1 FROM root_groups WHERE effective_root_status = 'pending_seal') THEN '待盖章'
           WHEN EXISTS (SELECT 1 FROM root_groups WHERE effective_root_status = 'approving') THEN '审批中'
           WHEN EXISTS (SELECT 1 FROM root_groups WHERE effective_root_status = 'draft') THEN '草拟中'
           WHEN EXISTS (SELECT 1 FROM root_groups WHERE effective_root_status = 'completed') THEN '已完成'
           WHEN EXISTS (SELECT 1 FROM root_groups WHERE effective_root_status = 'rejected') THEN '已拒绝'
           WHEN EXISTS (SELECT 1 FROM root_groups WHERE effective_root_status = 'terminated') THEN '终止'
           ELSE NULL
         END,
         updated_at = $2
     WHERE p.id = $1`,
    [projectId, new Date().toISOString()],
  );
}

export interface ContractDraftUpdate {
  title?: string | null;
  description?: string | null;
  category?: ContractCategory | null;
  assetCategory?: ContractAssetCategory | null;
  declaredSubtype?: ContractDeclaredSubtype | null;
  area?: string;
  projectId?: string | null;
  parentContractId?: string | null;
  partyA?: string | null;
  partyB?: string | null;
  projectName?: string | null;
  amountDelta?: number | null;
  expectedVersion: number;
}

function validateAmountForRelation(
  relationType: ContractRelationType,
  amount: number | null,
): void {
  if (amount === null || !Number.isFinite(amount)) return;
  if (relationType === "main" && amount <= 0) {
    throw new ContractDomainError(400, "主合同金额必须大于 0");
  }
  // 仅变更付款方式的补充协议必须显式保存 0，不能再用 NULL 与识别失败混淆。
  if (relationType === "termination" && amount > 0) {
    throw new ContractDomainError(400, "解除协议调整金额不能大于 0");
  }
}

export async function updateContractDraft(
  contractId: string,
  update: ContractDraftUpdate,
  actorId: string,
  actorRole: string,
  transactionClient?: PoolClient,
): Promise<ContractRow> {
  const execute = async (client: PoolClient): Promise<ContractRow> => {
    const current = await getLockedContract(client, contractId);
    if (current.status !== "draft") {
      throw new ContractDomainError(409, "只有草拟中的合同可以修改");
    }
    if (
      !Number.isInteger(update.expectedVersion) ||
      update.expectedVersion < 1
    ) {
      throw new ContractDomainError(400, "必须提供有效的合同版本号");
    }
    if (update.expectedVersion !== current.version) {
      throw new ContractDomainError(
        409,
        "合同已被其他用户修改，请刷新后重试",
        "VERSION_CONFLICT",
      );
    }
    assertStoredContractUploadContext(current);

    const attemptedRelationType = (
      update as ContractDraftUpdate & { relationType?: unknown }
    ).relationType;
    if (attemptedRelationType !== undefined) {
      throw new ContractDomainError(
        409,
        "合同层级关系已在上传时锁定；如选错，请删除草稿后按正确层级重新上传",
        "CONTRACT_RELATION_TYPE_IMMUTABLE",
      );
    }

    if (update.area !== undefined && update.area.trim() !== current.area) {
      throw new ContractDomainError(
        409,
        "合同所属行政区已在上传时锁定，不能修改",
        "CONTRACT_AREA_IMMUTABLE",
      );
    }
    if (
      update.declaredSubtype !== undefined &&
      update.declaredSubtype !== current.declared_subtype
    ) {
      throw new ContractDomainError(
        409,
        "合同二级分类已在上传时锁定，不能修改",
        "CONTRACT_DECLARED_SUBTYPE_IMMUTABLE",
      );
    }
    if (
      update.assetCategory !== undefined &&
      update.assetCategory !== current.asset_category
    ) {
      throw new ContractDomainError(
        409,
        "资产分类已在上传时锁定，不能修改",
        "CONTRACT_ASSET_CATEGORY_IMMUTABLE",
      );
    }
    if (update.category !== undefined && update.category !== current.category) {
      throw new ContractDomainError(
        409,
        "合同识别分类只能由OCR任务写入，不能修改",
        "OCR_FIELDS_READ_ONLY",
      );
    }

    const relationType = current.relation_type;
    const amountDelta =
      update.amountDelta !== undefined
        ? update.amountDelta
        : current.amount_delta;
    validateAmountForRelation(relationType, amountDelta);

    if (
      update.parentContractId !== undefined &&
      update.parentContractId !== current.parent_contract_id
    ) {
      throw new ContractDomainError(
        409,
        "上级合同已在上传时锁定；如选错，请删除草稿后重新上传",
        "CONTRACT_PARENT_IMMUTABLE",
      );
    }

    let parentContractId = current.parent_contract_id;
    let rootContractId = current.root_contract_id || current.id;
    let projectId =
      update.projectId !== undefined ? update.projectId : current.project_id;
    let title =
      update.title !== undefined ? update.title?.trim() || null : current.title;
    let projectName =
      update.projectName !== undefined
        ? update.projectName?.trim() || null
        : current.project_name;
    const area = current.area;
    let category =
      update.category !== undefined ? update.category : current.category;
    const assetCategory = current.asset_category;
    const effectiveCategory = current.declared_category || current.category;
    if (effectiveCategory === "asset") {
      if (update.projectId) {
        throw new ContractDomainError(
          409,
          "资产类合同不能关联项目",
          "CONTRACT_ASSET_PROJECT_NOT_ALLOWED",
        );
      }
      projectId = null;
    }

    if (relationType === "main") {
      parentContractId = null;
      rootContractId = current.id;
    } else {
      if (!parentContractId) {
        throw new ContractDomainError(
          400,
          "补充协议或终止协议必须关联上级合同",
        );
      }
      const parent = await resolveContractParentContext(
        client,
        parentContractId,
      );
      if (!isBeijingContractArea(parent.area)) {
        throw new ContractDomainError(
          409,
          "上级合同缺少有效行政区，暂不能新增子协议",
          "CONTRACT_PARENT_AREA_INVALID",
        );
      }
      if (parent.area !== area) {
        throw new ContractDomainError(
          409,
          "补充协议或终止协议必须与上级合同属于同一行政区",
          "CONTRACT_PARENT_AREA_MISMATCH",
        );
      }
      if (
        current.declared_category !== parent.category ||
        (current.category !== null && current.category !== parent.category)
      ) {
        throw new ContractDomainError(
          409,
          "补充协议或终止协议的预选分类、识别分类必须与上级合同一致",
          "CONTRACT_PARENT_CATEGORY_MISMATCH",
        );
      }
      if (assetCategory !== parent.asset_category) {
        throw new ContractDomainError(
          409,
          "补充协议或终止协议的资产分类必须与上级合同一致",
          "CONTRACT_PARENT_ASSET_CATEGORY_MISMATCH",
        );
      }
      if (current.declared_subtype !== parent.declared_subtype) {
        throw new ContractDomainError(
          409,
          "补充协议或终止协议的合同二级分类必须与上级合同一致",
          "CONTRACT_PARENT_SUBTYPE_MISMATCH",
        );
      }
      if (effectiveCategory === "asset") {
        if (parent.project_id) {
          throw new ContractDomainError(
            409,
            "资产类上级合同存在无效项目关系，请联系管理员核查",
            "CONTRACT_ASSET_PARENT_PROJECT_INVALID",
          );
        }
      } else {
        if (
          update.projectId !== undefined &&
          update.projectId !== parent.project_id
        ) {
          throw new ContractDomainError(
            409,
            "补充协议或终止协议的关联项目必须与上级合同一致",
            "CONTRACT_PARENT_PROJECT_MISMATCH",
          );
        }
        projectId = parent.project_id;
      }
      rootContractId = parent.id;
      category = current.category;
      if (relationType === "supplement") {
        const supplementSubjectName = buildSupplementSubjectName(
          parent,
          current.supplement_sequence,
        );
        if (!supplementSubjectName) {
          throw new ContractDomainError(
            409,
            effectiveCategory === "asset"
              ? "主合同缺少合同名称，不能生成补充协议名称"
              : "主合同缺少项目名称，不能生成补充协议名称",
            "CONTRACT_PARENT_SUBJECT_NAME_MISSING",
          );
        }
        title = supplementSubjectName;
        projectName = supplementSubjectName;
      } else {
        if (!current.termination_target_contract_id) {
          throw new ContractDomainError(
            409,
            "解除协议缺少被解除合同",
            "CONTRACT_TERMINATION_TARGET_REQUIRED",
          );
        }
        const terminationContext = await resolveTerminationTargetContext(
          client,
          current.termination_target_contract_id,
        );
        if (terminationContext.root.id !== parent.id) {
          throw new ContractDomainError(
            409,
            "被解除合同不属于当前主合同链",
            "CONTRACT_TERMINATION_TARGET_ROOT_MISMATCH",
          );
        }
        const terminationSubjectName = buildTerminationSubjectName(
          terminationContext.target,
        );
        if (!terminationSubjectName) {
          throw new ContractDomainError(
            409,
            "解除目标缺少合同名称，不能生成解除协议名称",
            "CONTRACT_TERMINATION_SUBJECT_MISSING",
          );
        }
        if (
          update.amountDelta !== undefined &&
          (update.amountDelta == null ||
            current.amount_delta == null ||
            toCents(update.amountDelta) !== toCents(current.amount_delta))
        ) {
          throw new ContractDomainError(
            409,
            "解除协议金额由有效结算记录自动生成，不能手工修改",
            "CONTRACT_TERMINATION_AMOUNT_READ_ONLY",
          );
        }
        title = terminationSubjectName;
        projectName = terminationSubjectName;
      }
    }

    if (projectId) {
      const project = await client.query<{ id: string; district: string }>(
        `SELECT id, district FROM worklog_projects WHERE id = $1`,
        [projectId],
      );
      if (!project.rows[0])
        throw new ContractDomainError(400, "关联项目不存在");
      if (!isBeijingContractArea(project.rows[0].district)) {
        throw new ContractDomainError(
          409,
          "关联项目缺少有效的北京市行政区",
          "CONTRACT_PROJECT_AREA_INVALID",
        );
      }
      if (area !== "全部" && project.rows[0].district !== area) {
        throw new ContractDomainError(
          409,
          "只能关联与合同所属行政区一致的项目",
          "CONTRACT_PROJECT_AREA_MISMATCH",
        );
      }
    }

    const now = new Date().toISOString();
    const result = await client.query<ContractRow>(
      `UPDATE contracts SET
         title = $2, description = $3,
         category = $4, asset_category = $5,
         relation_type = $6, area = $7, project_id = $8, parent_contract_id = $9,
         root_contract_id = $10, party_a = $11, party_b = $12,
         project_name = $13, amount_delta = $14,
         updated_by = $15, updated_at = $16, version = version + 1
       WHERE id = $1
       RETURNING *`,
      [
        contractId,
        title,
        update.description !== undefined
          ? update.description?.trim() || null
          : current.description,
        category,
        assetCategory,
        relationType,
        area,
        projectId,
        parentContractId,
        rootContractId,
        update.partyA !== undefined
          ? update.partyA?.trim() || null
          : current.party_a,
        update.partyB !== undefined
          ? update.partyB?.trim() || null
          : current.party_b,
        projectName,
        amountDelta,
        actorId,
        now,
      ],
    );

    await insertAudit(client, {
      contractId,
      action: "update",
      actorId,
      actorRole,
      fromStatus: current.status,
      toStatus: current.status,
      changes: { ...update },
      now,
    });
    const affectedProjectIds = [current.project_id, projectId]
      .filter((id): id is string => Boolean(id))
      .filter((id, index, values) => values.indexOf(id) === index)
      .sort();
    for (const affectedProjectId of affectedProjectIds) {
      await syncProjectContractTotal(client, affectedProjectId);
    }
    return result.rows[0];
  };
  return transactionClient
    ? execute(transactionClient)
    : db.transaction(execute);
}

function assertContractVersion(
  contract: ContractRow,
  expectedVersion: number,
): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ContractDomainError(
      400,
      "合同版本号不正确",
      "CONTRACT_VERSION_INVALID",
    );
  }
  if (contract.version !== expectedVersion) {
    throw new ContractDomainError(
      409,
      "合同已被其他用户修改，请刷新后重试",
      "VERSION_CONFLICT",
    );
  }
}

export interface ContractDraftDeleteResult {
  deletedFileCount: number;
  failedFilePaths: string[];
}

export interface LegacyContractDraftCleanupResult extends ContractDraftDeleteResult {
  deletedDraftCount: number;
  renumberedSupplementCount: number;
  blockedDraftCount: number;
  blockedContractIds: string[];
}

async function collectContractStoredPaths(
  client: PoolClient,
  contractId: string,
): Promise<string[]> {
  const result = await client.query<{ stored_path: string | null }>(
    `SELECT file_path AS stored_path
       FROM contract_files WHERE contract_id = $1
     UNION ALL
     SELECT signature_snapshot_path AS stored_path
       FROM contract_seal_applications WHERE contract_id = $1
     UNION ALL
     SELECT approver_signature_snapshot_path AS stored_path
       FROM contract_seal_applications WHERE contract_id = $1`,
    [contractId],
  );
  const auxiliaryPaths = await collectContractAuxiliaryDraftStoredPaths(
    client,
    contractId,
  );
  return Array.from(
    new Set(
      [...result.rows.map((row) => row.stored_path), ...auxiliaryPaths]
        .map((storedPath) => String(storedPath || "").trim())
        .filter(Boolean),
    ),
  );
}

async function removeContractStoredPaths(
  storedPaths: string[],
): Promise<string[]> {
  const failedFilePaths: string[] = [];
  for (const storedPath of storedPaths) {
    if (!validateFilePath(storedPath)) {
      failedFilePaths.push(storedPath);
      continue;
    }
    try {
      const normalizedStoredPath = storedPath.replace(/^[/\\]+/u, "");
      await fs.promises.unlink(
        path.resolve(process.cwd(), normalizedStoredPath),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        failedFilePaths.push(storedPath);
      }
    }
  }
  return failedFilePaths;
}

/**
 * 删除单份合同草稿的完整数据库图。调用前必须锁定并校验合同状态；所有
 * `RESTRICT`（限制删除）依赖均显式清除，其余子表由外键级联兜底。
 */
async function hardDeleteContractDraftGraph(
  client: PoolClient,
  contractId: string,
): Promise<void> {
  const child = await client.query<{ id: string }>(
    `SELECT id FROM contracts
     WHERE (parent_contract_id = $1 OR root_contract_id = $1) AND id <> $1
     LIMIT 1 FOR UPDATE`,
    [contractId],
  );
  if (child.rows[0]) {
    throw new ContractDomainError(
      409,
      "合同草稿仍有关联合同，不能永久删除",
      "CONTRACT_DRAFT_HAS_CHILDREN",
    );
  }

  const financialDependency = await client.query<{ exists: boolean }>(
    `SELECT (
       EXISTS (SELECT 1 FROM contract_invoices WHERE contract_id = $1) OR
       EXISTS (SELECT 1 FROM contract_receipts WHERE contract_id = $1) OR
       EXISTS (SELECT 1 FROM contract_payments WHERE contract_id = $1) OR
       EXISTS (SELECT 1 FROM contract_external_payments WHERE contract_id = $1) OR
       EXISTS (SELECT 1 FROM contract_financial_ocr_jobs WHERE contract_id = $1) OR
       EXISTS (SELECT 1 FROM contract_financial_file_hashes WHERE contract_id = $1) OR
       EXISTS (SELECT 1 FROM contract_financial_registrations WHERE contract_id = $1) OR
       EXISTS (SELECT 1 FROM contract_financial_registration_items WHERE contract_id = $1) OR
       EXISTS (SELECT 1 FROM contract_financial_registration_matches WHERE contract_id = $1)
     ) AS exists`,
    [contractId],
  );
  if (financialDependency.rows[0]?.exists) {
    throw new ContractDomainError(
      409,
      "合同草稿存在财务凭证或登记数据，不能永久删除，请先核查财务数据",
      "CONTRACT_DRAFT_HAS_FINANCIAL_DATA",
    );
  }
  await client.query(
    `DELETE FROM contract_seal_applications WHERE contract_id = $1`,
    [contractId],
  );
  await client.query(
    `DELETE FROM contract_approval_records WHERE contract_id = $1`,
    [contractId],
  );
  await client.query(
    `DELETE FROM contract_approval_rounds WHERE contract_id = $1`,
    [contractId],
  );
  await client.query(`DELETE FROM contract_audit_logs WHERE contract_id = $1`, [
    contractId,
  ]);
  const deleted = await client.query(`DELETE FROM contracts WHERE id = $1`, [
    contractId,
  ]);
  if (deleted.rowCount !== 1) {
    throw new ContractDomainError(
      409,
      "合同草稿已发生变化，请刷新后重试",
      "CONTRACT_DRAFT_DELETE_CONFLICT",
    );
  }
}

async function synchronizeSupplementProjectName(
  client: PoolClient,
  contractId: string,
  projectName: string,
  now: string,
): Promise<void> {
  await client.query(
    `UPDATE contract_ocr_fields
     SET final_value = $2, confidence = $4, source = 'system_inherited',
       manually_confirmed = FALSE, confirmed_by = NULL, confirmed_at = NULL,
       updated_at = $3
     WHERE contract_id = $1 AND field_code = 'project_name'`,
    [contractId, projectName, now, 100],
  );
  const latest = await client.query<{
    job_id: string;
    field_id: string | null;
  }>(
    `SELECT job.id AS job_id, field.id AS field_id
     FROM contract_ocr_jobs job
     LEFT JOIN contract_ocr_fields field
       ON field.job_id = job.id AND field.field_code = 'project_name'
     WHERE job.contract_id = $1
     ORDER BY job.created_at DESC, job.id DESC LIMIT 1`,
    [contractId],
  );
  if (!latest.rows[0] || latest.rows[0].field_id) return;
  await client.query(
    `INSERT INTO contract_ocr_fields (
       id, job_id, contract_id, field_code, original_value,
       normalized_value, final_value, confidence, source, page_number,
       evidence, manually_confirmed, created_at, updated_at
     )
     VALUES ($1,$2,$3,'project_name',NULL,NULL,$4,100,
       'system_inherited',NULL,
       '系统按主合同项目名称与补充协议序号生成',FALSE,$5,$5)`,
    [nanoid(), latest.rows[0].job_id, contractId, projectName, now],
  );
}

interface DraftSupplementCompactionRow {
  id: string;
  root_contract_id: string;
  supplement_sequence: number;
  created_at: string;
  title: string | null;
  project_name: string | null;
  root_project_name: string | null;
  root_title: string | null;
}

interface DraftSupplementCompactionPlanItem {
  draft: DraftSupplementCompactionRow;
  nextSequence: number;
  nextName: string | null;
  sequenceChanged: boolean;
  nameChanged: boolean;
}

interface DraftSupplementCompactionPlan {
  items: DraftSupplementCompactionPlanItem[];
  maximumExistingSequence: number;
  sequenceChanged: boolean;
}

async function buildDraftSupplementCompactionPlan(
  client: PoolClient,
  rootContractId: string,
  excludedContractIds: string[] = [],
): Promise<DraftSupplementCompactionPlan> {
  const drafts = await client.query<DraftSupplementCompactionRow>(
    `SELECT draft.id, draft.root_contract_id, draft.supplement_sequence,
       draft.created_at, draft.title, draft.project_name,
       root.project_name AS root_project_name, root.title AS root_title
     FROM contracts draft
     JOIN contracts root ON root.id = draft.root_contract_id
     WHERE draft.relation_type = 'supplement'
       AND draft.status = 'draft' AND draft.is_deleted = FALSE
       AND root.is_deleted = FALSE
       AND draft.root_contract_id = $1
       AND NOT (draft.id = ANY($2::text[]))
     ORDER BY draft.root_contract_id, draft.created_at, draft.id
     FOR UPDATE OF draft, root`,
    [rootContractId, excludedContractIds],
  );
  if (drafts.rows.length === 0) {
    return {
      items: [],
      maximumExistingSequence: 0,
      sequenceChanged: false,
    };
  }

  const retained = await client.query<{ max_sequence: number }>(
    `SELECT COALESCE(MAX(supplement_sequence), 0) AS max_sequence
     FROM contracts
     WHERE root_contract_id = $1 AND relation_type = 'supplement'
       AND (status <> 'draft' OR is_deleted = TRUE)
       AND NOT (id = ANY($2::text[]))`,
    [rootContractId, excludedContractIds],
  );
  const baseSequence = Number(retained.rows[0]?.max_sequence || 0);
  const items = drafts.rows.map((draft, index) => {
    const nextSequence = baseSequence + index + 1;
    const nextName = buildSupplementSubjectName(
      {
        project_name: draft.root_project_name,
        title: draft.root_title,
      },
      nextSequence,
    );
    return {
      draft,
      nextSequence,
      nextName,
      sequenceChanged: Number(draft.supplement_sequence) !== nextSequence,
      nameChanged: Boolean(
        nextName &&
        (draft.title !== nextName || draft.project_name !== nextName),
      ),
    };
  });
  return {
    items,
    maximumExistingSequence: Math.max(
      baseSequence,
      ...drafts.rows.map((draft) => Number(draft.supplement_sequence || 0)),
    ),
    sequenceChanged: items.some((item) => item.sequenceChanged),
  };
}

async function assertDraftSupplementCompactionSafe(
  client: PoolClient,
  rootContractId: string,
  excludedContractIds: string[] = [],
): Promise<void> {
  const plan = await buildDraftSupplementCompactionPlan(
    client,
    rootContractId,
    excludedContractIds,
  );
  const changedContractIds = plan.items
    .filter((item) => item.sequenceChanged || item.nameChanged)
    .map((item) => item.draft.id);
  if (changedContractIds.length === 0) return;
  const workflowDependency = await client.query<{ contract_id: string }>(
    `SELECT changed.contract_id
     FROM unnest($1::text[]) AS changed(contract_id)
     WHERE EXISTS (
       SELECT 1 FROM contract_seal_applications seal
       WHERE seal.contract_id = changed.contract_id
     ) OR EXISTS (
       SELECT 1 FROM contract_approval_rounds approval
       WHERE approval.contract_id = changed.contract_id
     )
     ORDER BY changed.contract_id
     LIMIT 1`,
    [changedContractIds],
  );
  if (workflowDependency.rows[0]) {
    throw new ContractDomainError(
      409,
      "后续补充协议草稿已有审批或用印资料，无法自动调整序号，请先处理或删除该草稿",
      "CONTRACT_DRAFT_COMPACTION_HAS_WORKFLOW_DATA",
    );
  }
}

async function compactDraftSupplementSequences(
  client: PoolClient,
  rootContractId: string,
): Promise<number> {
  const plan = await buildDraftSupplementCompactionPlan(client, rootContractId);
  if (plan.sequenceChanged) {
    for (let index = 0; index < plan.items.length; index += 1) {
      await client.query(
        `UPDATE contracts SET supplement_sequence = $2 WHERE id = $1`,
        [
          plan.items[index].draft.id,
          plan.maximumExistingSequence + 1_000_000 + index,
        ],
      );
    }
  }
  let renumberedSupplementCount = 0;
  for (const item of plan.items) {
    if (!plan.sequenceChanged && !item.nameChanged) continue;
    const now = new Date().toISOString();
    await client.query(
      `UPDATE contracts
       SET supplement_sequence = $2,
         title = CASE WHEN $3::text IS NULL THEN title ELSE $3 END,
         project_name = CASE WHEN $3::text IS NULL THEN project_name ELSE $3 END,
         updated_at = $4,
         version = version + CASE WHEN $5::boolean THEN 1 ELSE 0 END
       WHERE id = $1`,
      [
        item.draft.id,
        item.nextSequence,
        item.nextName,
        now,
        item.sequenceChanged || item.nameChanged,
      ],
    );
    if (item.nextName && (item.sequenceChanged || item.nameChanged)) {
      await synchronizeSupplementProjectName(
        client,
        item.draft.id,
        item.nextName,
        now,
      );
    }
    if (item.sequenceChanged) {
      renumberedSupplementCount += 1;
    }
  }
  return renumberedSupplementCount;
}

export async function deleteContractDraft(
  contractId: string,
  actorId: string,
  actorRole: string,
  expectedVersion: number,
): Promise<ContractDraftDeleteResult> {
  const result = await db.transaction(async (client) => {
    const contract = await getLockedContract(client, contractId);
    assertContractVersion(contract, expectedVersion);
    if (contract.status !== "draft") {
      throw new ContractDomainError(409, "只有草拟中的合同可以删除");
    }
    const supplementRootContractId =
      contract.root_contract_id || contract.parent_contract_id;
    if (contract.relation_type === "supplement") {
      if (!supplementRootContractId) {
        throw new ContractDomainError(
          409,
          "补充协议草稿缺少主合同关联，不能永久删除",
          "CONTRACT_SUPPLEMENT_ROOT_REQUIRED",
        );
      }
      await assertDraftSupplementCompactionSafe(
        client,
        supplementRootContractId,
        [contractId],
      );
    }
    const storedPaths = await collectContractStoredPaths(client, contractId);
    await hardDeleteContractDraftGraph(client, contractId);
    if (contract.relation_type === "supplement" && supplementRootContractId) {
      await compactDraftSupplementSequences(client, supplementRootContractId);
    }
    await syncProjectContractTotal(client, contract.project_id);
    return { storedPaths };
  });
  const failedFilePaths = await removeContractStoredPaths(result.storedPaths);
  if (failedFilePaths.length > 0) {
    console.error("合同草稿附件物理删除失败:", {
      contractId,
      actorId,
      actorRole,
      failedFilePaths,
    });
  }
  return {
    deletedFileCount: result.storedPaths.length - failedFilePaths.length,
    failedFilePaths,
  };
}

/**
 * 升级兼容：旧版本曾把“删除草稿”实现为软删除。启动时将这些已明确删除
 * 的草稿及其证据永久清除，并把仍存在的草稿补充协议排到正式协议之后。
 */
export async function cleanupLegacyDeletedContractDrafts(): Promise<LegacyContractDraftCleanupResult> {
  const discoveredDrafts = await db.all<{
    id: string;
    cleanup_root_id: string;
  }>(
    `SELECT contract.id,
       COALESCE(contract.root_contract_id, contract.id) AS cleanup_root_id
     FROM contracts contract
     WHERE contract.is_deleted = TRUE AND contract.status = 'draft'
       AND EXISTS (
         SELECT 1 FROM contract_audit_logs deleted_audit
         WHERE deleted_audit.contract_id = contract.id
           AND deleted_audit.action = 'draft_deleted'
       )
       AND NOT EXISTS (
         SELECT 1 FROM contract_audit_logs cancellation_audit
         WHERE cancellation_audit.contract_id = contract.id
           AND cancellation_audit.action = 'contract_cancelled_before_seal'
       )
     ORDER BY cleanup_root_id, contract.created_at, contract.id`,
  );
  const groupedDraftIds = new Map<string, string[]>();
  for (const draft of discoveredDrafts) {
    const ids = groupedDraftIds.get(draft.cleanup_root_id) || [];
    ids.push(draft.id);
    groupedDraftIds.set(draft.cleanup_root_id, ids);
  }

  let deletedDraftCount = 0;
  let renumberedSupplementCount = 0;
  let deletedFileCount = 0;
  const failedFilePaths: string[] = [];
  const blockedContractIds = new Set<string>();
  for (const [cleanupRootId, discoveredIds] of Array.from(
    groupedDraftIds.entries(),
  ).sort(([left], [right]) => left.localeCompare(right))) {
    let selectedIds = discoveredIds;
    try {
      const groupResult = await db.transaction(async (client) => {
        const legacyDrafts = await client.query<{
          id: string;
          project_id: string | null;
          relation_type: ContractRelationType;
          root_contract_id: string | null;
        }>(
          `SELECT contract.id, contract.project_id, contract.relation_type,
             contract.root_contract_id
           FROM contracts contract
           WHERE contract.id = ANY($1::text[])
             AND contract.is_deleted = TRUE AND contract.status = 'draft'
             AND EXISTS (
               SELECT 1 FROM contract_audit_logs deleted_audit
               WHERE deleted_audit.contract_id = contract.id
                 AND deleted_audit.action = 'draft_deleted'
             )
             AND NOT EXISTS (
               SELECT 1 FROM contract_audit_logs cancellation_audit
               WHERE cancellation_audit.contract_id = contract.id
                 AND cancellation_audit.action = 'contract_cancelled_before_seal'
             )
           ORDER BY contract.created_at, contract.id FOR UPDATE OF contract`,
          [discoveredIds],
        );
        selectedIds = legacyDrafts.rows.map((draft) => draft.id);
        const affectedRootContractIds = new Set(
          legacyDrafts.rows
            .filter(
              (draft) =>
                draft.relation_type === "supplement" &&
                Boolean(draft.root_contract_id),
            )
            .map((draft) => String(draft.root_contract_id)),
        );
        for (const rootContractId of Array.from(
          affectedRootContractIds,
        ).sort()) {
          await assertDraftSupplementCompactionSafe(
            client,
            rootContractId,
            legacyDrafts.rows
              .filter(
                (draft) =>
                  draft.relation_type === "supplement" &&
                  draft.root_contract_id === rootContractId,
              )
              .map((draft) => draft.id),
          );
        }

        const storedPaths: string[] = [];
        const affectedProjectIds = new Set<string>();
        for (const draft of legacyDrafts.rows) {
          storedPaths.push(
            ...(await collectContractStoredPaths(client, draft.id)),
          );
          if (draft.project_id) affectedProjectIds.add(draft.project_id);
          await hardDeleteContractDraftGraph(client, draft.id);
        }
        let groupRenumberedSupplementCount = 0;
        for (const rootContractId of Array.from(
          affectedRootContractIds,
        ).sort()) {
          groupRenumberedSupplementCount +=
            await compactDraftSupplementSequences(client, rootContractId);
        }
        for (const projectId of Array.from(affectedProjectIds).sort()) {
          await syncProjectContractTotal(client, projectId);
        }
        return {
          deletedDraftCount: legacyDrafts.rowCount || 0,
          renumberedSupplementCount: groupRenumberedSupplementCount,
          storedPaths: Array.from(new Set(storedPaths)),
        };
      });
      deletedDraftCount += groupResult.deletedDraftCount;
      renumberedSupplementCount += groupResult.renumberedSupplementCount;
      const groupFailedFilePaths = await removeContractStoredPaths(
        groupResult.storedPaths,
      );
      deletedFileCount +=
        groupResult.storedPaths.length - groupFailedFilePaths.length;
      failedFilePaths.push(...groupFailedFilePaths);
    } catch (error) {
      if (!(error instanceof ContractDomainError)) throw error;
      for (const contractId of selectedIds) {
        blockedContractIds.add(contractId);
      }
      console.warn("历史合同草稿组因安全依赖跳过永久清理:", {
        cleanupRootId,
        contractIds: selectedIds,
        code: error.code || "CONTRACT_DRAFT_CLEANUP_BLOCKED",
      });
    }
  }
  if (failedFilePaths.length > 0) {
    console.error("历史合同草稿附件物理删除失败:", failedFilePaths);
  }
  return {
    deletedDraftCount,
    renumberedSupplementCount,
    blockedDraftCount: blockedContractIds.size,
    blockedContractIds: Array.from(blockedContractIds).sort(),
    deletedFileCount,
    failedFilePaths,
  };
}

const PRE_SEAL_CANCELLABLE_STATUSES = new Set<ContractStatus>([
  "draft",
  "approving",
  "pending_seal",
]);

/**
 * 撤销尚未实际盖章的合同。合同采用软删除保留文件、审批与审计证据；
 * 待盖章阶段一旦已经上传盖章版或创建核验记录，就不再允许撤销。
 */
export async function cancelContractBeforeSeal(
  contractId: string,
  actorId: string,
  actorRole: string,
  expectedVersion: number,
  cancellationReason: string,
): Promise<void> {
  const normalizedCancellationReason = String(cancellationReason || "").trim();
  if (!normalizedCancellationReason) {
    throw new ContractDomainError(
      400,
      "请填写撤销原因",
      "CONTRACT_CANCELLATION_REASON_REQUIRED",
    );
  }
  if (normalizedCancellationReason.length > 300) {
    throw new ContractDomainError(
      400,
      "撤销原因不能超过300个字符",
      "CONTRACT_CANCELLATION_REASON_TOO_LONG",
    );
  }
  await db.transaction(async (client) => {
    const contract = await getLockedContract(client, contractId);
    assertContractVersion(contract, expectedVersion);
    if (!PRE_SEAL_CANCELLABLE_STATUSES.has(contract.status)) {
      throw new ContractDomainError(
        409,
        "只有尚未盖章的合同可以撤销",
        "CONTRACT_ALREADY_SEALED_OR_EFFECTIVE",
      );
    }
    if (
      contract.status === "approving" &&
      (contract.pending_action !== "seal" ||
        !["draft", "pending_seal"].includes(contract.previous_status || ""))
    ) {
      throw new ContractDomainError(
        409,
        "当前审批不属于盖章前审批，不能撤销合同",
        "CONTRACT_CANCELLATION_NOT_ALLOWED",
      );
    }

    const sealedEvidence = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM contract_files
         WHERE contract_id = $1 AND file_type = 'sealed_contract'
       ) OR EXISTS (
         SELECT 1 FROM contract_seal_verifications WHERE contract_id = $1
       ) AS exists`,
      [contractId],
    );
    if (sealedEvidence.rows[0]?.exists) {
      throw new ContractDomainError(
        409,
        "该合同已上传盖章版或进入盖章核验，不能撤销",
        "CONTRACT_SEALED_EVIDENCE_EXISTS",
      );
    }

    const now = new Date().toISOString();
    let approvalRoundId: string | null = null;
    if (contract.status === "approving") {
      const round = await getLockedPendingApprovalRound(client, contract);
      approvalRoundId = round.id;
      await client.query(
        `UPDATE contract_approval_rounds SET status = 'withdrawn',
           completed_at = $2, completed_by = $3, completed_action = 'withdraw',
           updated_at = $2
         WHERE id = $1 AND status = 'pending'`,
        [round.id, now, actorId],
      );
      await client.query(
        `INSERT INTO contract_approval_records (
           id, contract_id, approval_round_id, action, approver_id,
           approver_role, comment, from_status, to_status, created_at
         ) VALUES ($1,$2,$3,'withdraw',$4,$5,$6,$7,$7,$8)`,
        [
          nanoid(),
          contractId,
          round.id,
          actorId,
          actorRole,
          `合同在盖章前被撤销：${normalizedCancellationReason}`,
          contract.status,
          now,
        ],
      );
    }

    await client.query(
      `UPDATE contracts SET is_deleted = TRUE, deleted_at = $2,
         updated_by = $3, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [contractId, now, actorId],
    );
    await client.query(
      `UPDATE contract_ocr_jobs SET status = 'failed',
         error_message = '合同已撤销，识别任务已取消',
         finished_at = $2, updated_at = $2,
         worker_token = NULL, lease_expires_at = NULL
       WHERE contract_id = $1 AND status IN ('queued', 'processing')`,
      [contractId, now],
    );
    await insertAudit(client, {
      contractId,
      action: "contract_cancelled_before_seal",
      actorId,
      actorRole,
      fromStatus: contract.status,
      toStatus: contract.status,
      changes: {
        isDeleted: true,
        expectedVersion,
        approvalRoundId,
        cancellationStage: contract.status,
        cancellationReason: normalizedCancellationReason,
      },
      comment: normalizedCancellationReason,
      now,
    });
    await syncProjectContractTotal(client, contract.project_id);
  });
}

const REQUIRED_OCR_FIELDS = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
  "category",
  "contract_date",
] as const;

const REQUIRED_DRAFT_OCR_VALUE_FIELDS = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
] as const satisfies readonly (typeof REQUIRED_OCR_FIELDS)[number][];

export type ContractOcrCoreField = (typeof REQUIRED_OCR_FIELDS)[number];

export const CONTRACT_OCR_AUTOMATIC_POLICY_VERSION =
  "highest-qualified-candidate-v3";
export const CONTRACT_OCR_AUTOMATIC_ACCEPTED_MARKER = `自动采用结果：${CONTRACT_OCR_AUTOMATIC_POLICY_VERSION}：通过`;

export interface ContractAutomaticOcrFieldInput {
  field: string;
  normalizedValue: unknown;
}

export interface ContractAutomaticOcrPolicyInput {
  resultStatus: "succeeded" | "partial" | "failed";
  failureKind?: string | null;
  relationType: ContractRelationType;
  declaredCategory: ContractCategory | null;
  rawText?: string | null;
  fields: readonly ContractAutomaticOcrFieldInput[];
  /**
   * 识别结果对象携带的内部金额状态；不进入数据库或现有 API（应用程序编程接口）。
   * 普通主合同只有明确且安全的 missing_amount（金额缺失）可以采用空金额。
   */
  amountContext?: ContractAmountAutomaticAdoptionContext | null;
  /**
   * 识别器基于实际有效候选及实际排序生成的进程内安全证据。该上下文不进入
   * 数据库或现有 API（应用程序编程接口），缺失时采用失败关闭策略。
   */
  safetyContext?: ContractOcrAutomaticAdoptionSafetyContext | null;
  /** 补充协议从已锁定主合同继承的项目名称或资产合同名称。 */
  inheritedSubjectName?: string | null;
  /** 仅当正文形成可信项目候选时校验其是否与主合同一致。 */
  recognizedSubjectMatchesParent?: boolean | null;
}

export interface ContractAutomaticOcrPolicyDecision {
  accepted: boolean;
  status: "succeeded" | "partial" | "failed";
  values: Record<ContractOcrCoreField, string | null>;
  legalEmptyFields: ContractOcrCoreField[];
  blockers: string[];
  warnings: string[];
}

function normalizeAutomaticOcrFieldValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.normalize("NFKC").trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function isValidAutomaticContractDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalizeAutomaticContractCategory(
  value: string | null,
): ContractCategory | null {
  if (!value) return null;
  const aliases: Record<string, ContractCategory> = {
    main_business: "main_business",
    主营项目合同: "main_business",
    主营: "main_business",
    non_main: "non_main",
    非主营项目合同: "non_main",
    非主营: "non_main",
    asset: "asset",
    资产类合同: "asset",
    资产: "asset",
  };
  return aliases[value] || null;
}

function isAutomaticProjectContractType(value: string): boolean {
  const compacted = value.normalize("NFKC").replace(/\s+/g, "");
  if (
    /^(?:技术服务|技术咨询服务|工程咨询服务|咨询服务|服务|采购|租赁|房屋租赁|停车服务|网络服务)?(?:合同|协议|协议书|补充协议|补充协议书|变更协议|变更协议书|追加协议|追加协议书|终止协议|终止协议书)$/u.test(
      compacted,
    )
  ) {
    return true;
  }
  return (
    /(?:合同|协议|协议书)$/u.test(compacted) &&
    !/(?:项目|工程|千伏|变电站|线路|不动产|许可证|检测|鉴定|手续|采购|购置|平台|系统|建设|改造|产品|云)/u.test(
      compacted,
    )
  );
}

function isAutomaticProjectPaymentClause(value: string): boolean {
  const compacted = value.normalize("NFKC").replace(/\s+/g, "");
  return /(?:付款(?:方式|条款|安排|金额|节点)|支付(?:方式|条款|安排|金额|节点)|预付款|进度款|结算方式|收款账户|开户银行|税额|税费|单价)/u.test(
    compacted,
  );
}

function isAutomaticProjectOrganizationName(
  value: string,
  partyA: string | null,
  partyB: string | null,
): boolean {
  const compacted = value.normalize("NFKC").replace(/\s+/g, "");
  const partyValues = [partyA, partyB]
    .map((party) =>
      String(party || "")
        .normalize("NFKC")
        .replace(/\s+/g, ""),
    )
    .filter(Boolean);
  if (
    partyValues.some((party) => {
      if (compacted === party) return true;
      if (!compacted.startsWith(party)) return false;
      return /^(?:技术服务|咨询服务|工程咨询服务|合同|协议|协议书)?$/u.test(
        compacted.slice(party.length),
      );
    })
  ) {
    return true;
  }
  return (
    !/(?:项目|工程|千伏|变电站|线路|不动产|许可证|检测|鉴定|手续|采购|购置|平台|系统|建设|改造)/u.test(
      compacted,
    ) &&
    /(?:有限责任公司|股份有限公司|集团有限公司|有限公司|公司|研究院|设计院|事务所|委员会|管理局|中心|政府|大学|学院|医院|协会|研究所)$/u.test(
      compacted,
    )
  );
}

function automaticOcrFieldAllowsEmpty(
  fieldCode: ContractOcrCoreField,
  relationType: ContractRelationType,
  isFrameworkAgreement: boolean,
  amountContext: ContractAmountAutomaticAdoptionContext | null | undefined,
): boolean {
  if (fieldCode === "contract_date") return true;
  if (fieldCode === "project_name") {
    return relationType === "termination" || isFrameworkAgreement;
  }
  if (fieldCode === "amount") {
    if (amountContext?.status === "missing_amount") {
      return amountContext.missingAmountEligible;
    }
    if (
      amountContext?.status === "confirmed_amount" ||
      amountContext?.status === "calculated_amount"
    ) {
      // 状态确认有金额但字段值为空属于上下文不一致，任何合同层级都不能放行。
      return false;
    }
    return (
      relationType === "supplement" ||
      relationType === "termination" ||
      isFrameworkAgreement
    );
  }
  return false;
}

/**
 * 自动采用策略只决定 OCR（光学字符识别）最高合格候选能否进入最终值。
 * fieldScore（字段规则评分）继续作为诊断信息保存，不再被当作唯一采用凭据。
 * 识别服务完成字段专属二次排序后，本策略仍会对候选来源、语义、实际分差、
 * 金额角色及作用域执行失败关闭；证据不足时保持部分结果，不进入人工兜底。
 */
export function decideContractAutomaticOcrAdoption(
  input: ContractAutomaticOcrPolicyInput,
): ContractAutomaticOcrPolicyDecision {
  const blockers: string[] = [];
  const warnings: string[] = [
    `自动采用策略：${CONTRACT_OCR_AUTOMATIC_POLICY_VERSION}`,
  ];
  const legalEmptyFields: ContractOcrCoreField[] = [];
  const values = Object.fromEntries(
    REQUIRED_OCR_FIELDS.map((fieldCode) => [fieldCode, null]),
  ) as Record<ContractOcrCoreField, string | null>;
  const fieldsByCode = new Map<string, string | null>();
  for (const field of input.fields) {
    fieldsByCode.set(
      String(field.field || "").trim(),
      normalizeAutomaticOcrFieldValue(field.normalizedValue),
    );
  }
  // 继承名称来自系统按主合同与补充协议序号生成的确定值，必须保留其原始
  // 展示格式（尤其是全角序号括号），不能再经过 NFKC 转为半角。
  const inheritedSubjectName = input.inheritedSubjectName?.trim() || null;

  const infrastructureFailure = input.failureKind === "infrastructure";
  const documentFailure =
    input.failureKind === "document" ||
    (input.resultStatus === "failed" && !infrastructureFailure);
  if (infrastructureFailure) {
    blockers.push("OCR识别基础设施失败");
  } else if (documentFailure) {
    blockers.push("合同文件或声明的合同层级未通过识别校验");
  }

  const missingFieldRecords = REQUIRED_OCR_FIELDS.filter(
    (fieldCode) =>
      !fieldsByCode.has(fieldCode) &&
      !(
        fieldCode === "project_name" &&
        ["supplement", "termination"].includes(input.relationType) &&
        inheritedSubjectName
      ) &&
      !(fieldCode === "amount" && input.relationType === "termination"),
  );
  if (missingFieldRecords.length > 0) {
    blockers.push(
      `识别结果缺少核心字段记录：${missingFieldRecords.join("、")}`,
    );
  }

  const compactRawText = String(input.rawText || "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
  const isFrameworkAgreement = /框架(?:采购)?协议/u.test(compactRawText);

  for (const fieldCode of REQUIRED_OCR_FIELDS) {
    if (!fieldsByCode.has(fieldCode)) continue;
    values[fieldCode] = fieldsByCode.get(fieldCode) || null;
  }

  if (
    ["supplement", "termination"].includes(input.relationType) &&
    inheritedSubjectName
  ) {
    values.project_name = inheritedSubjectName;
    if (input.recognizedSubjectMatchesParent === false) {
      blockers.push(
        input.relationType === "termination"
          ? "解除协议正文合同名称与所选解除目标不一致"
          : "补充协议正文项目名称与所选主合同不一致",
      );
    }
  }

  const subjectNameLabel =
    input.declaredCategory === "asset" ? "合同名称" : "项目名称";
  if (values.project_name && !inheritedSubjectName) {
    const projectSafety = input.safetyContext?.project;
    if (!projectSafety) {
      blockers.push(`${subjectNameLabel}缺少候选安全证据`);
    } else {
      if (
        normalizeAutomaticOcrFieldValue(projectSafety.selectedValue) !==
        values.project_name
      ) {
        blockers.push(`${subjectNameLabel}与候选安全证据不一致`);
      }
      if (!projectSafety.candidateExists) {
        blockers.push(`${subjectNameLabel}没有可验证候选`);
      }
      if (!projectSafety.trustedSource || !projectSafety.strongEvidence) {
        blockers.push(`${subjectNameLabel}候选来源不满足自动采用条件`);
      }
      if (
        projectSafety.pdfTextEvidencePresent &&
        !projectSafety.samePageVisibleOcrEvidence
      ) {
        blockers.push(
          `${subjectNameLabel}PDF文字层候选缺少同页可见OCR同值佐证`,
        );
      }
      const calculatedGap =
        projectSafety.leadingScore != null &&
        projectSafety.runnerUpScore != null
          ? projectSafety.leadingScore - projectSafety.runnerUpScore
          : null;
      const hasUniqueOrSufficientGap =
        projectSafety.distinctCandidateCount === 1 ||
        (projectSafety.distinctCandidateCount > 1 &&
          calculatedGap != null &&
          calculatedGap >=
            CONTRACT_PROJECT_AUTOMATIC_ADOPTION_MINIMUM_SCORE_GAP);
      if (!projectSafety.uniqueOrSufficientGap || !hasUniqueOrSufficientGap) {
        blockers.push(`${subjectNameLabel}候选不唯一且排序差距不足`);
      }
      if (
        projectSafety.genericContractType ||
        isAutomaticProjectContractType(values.project_name)
      ) {
        blockers.push(`${subjectNameLabel}候选属于合同或协议类型`);
      }
      if (
        projectSafety.organizationName ||
        isAutomaticProjectOrganizationName(
          values.project_name,
          values.party_a,
          values.party_b,
        )
      ) {
        blockers.push(`${subjectNameLabel}候选属于单位名称`);
      }
      if (
        projectSafety.paymentClause ||
        isAutomaticProjectPaymentClause(values.project_name)
      ) {
        blockers.push(`${subjectNameLabel}候选属于付款或费用条款`);
      }
    }
  }

  const amountSafety = input.safetyContext?.amount;
  const systemDerivedTerminationAmount = input.relationType === "termination";
  if (systemDerivedTerminationAmount) {
    values.amount = "0.00";
    warnings.push(
      "解除协议自身合同金额固定为0；解除结算调整额采用有效结算记录生成，不采用正文金额候选",
    );
  }
  if (!systemDerivedTerminationAmount && !input.amountContext) {
    blockers.push("合同金额缺少内部状态证据");
  }
  if (!systemDerivedTerminationAmount && !amountSafety) {
    blockers.push("合同金额缺少候选安全证据");
  } else if (
    !systemDerivedTerminationAmount &&
    amountSafety &&
    normalizeAutomaticOcrFieldValue(amountSafety.selectedValue) !==
      values.amount
  ) {
    blockers.push("合同金额与候选安全证据不一致");
  }

  if (!systemDerivedTerminationAmount && values.amount) {
    if (
      input.amountContext &&
      input.amountContext.status !== "confirmed_amount" &&
      input.amountContext.status !== "calculated_amount"
    ) {
      blockers.push("合同金额状态未形成可采用的明确或计算金额");
    }
    if (amountSafety) {
      if (!amountSafety.candidateExists) {
        blockers.push("合同金额没有可验证候选");
      }
      if (!amountSafety.strongEvidence) {
        blockers.push("合同金额候选缺少明确金额证据");
      }
      if (amountSafety.amountEventConflict) {
        blockers.push("合同金额候选存在金额事件冲突");
      }
      if (
        amountSafety.pdfTextEvidencePresent &&
        !amountSafety.samePageVisibleOcrEvidence &&
        !(
          input.amountContext?.status === "calculated_amount" &&
          amountSafety.calculatedRelationVisibleClosure
        )
      ) {
        blockers.push("合同金额PDF文字层候选缺少同页可见OCR同值同角色佐证");
      }
      const isRelationAgreement =
        input.relationType === "supplement" ||
        input.relationType === "termination";
      if (isRelationAgreement) {
        if (amountSafety.role !== "relation_adjustment") {
          blockers.push("补充或终止协议金额未绑定本次变更角色");
        }
        if (amountSafety.scope !== "relation_total") {
          blockers.push("补充或终止协议金额缺少本次变更总额作用域");
        }
      } else {
        if (
          amountSafety.role !== "contract_total" &&
          amountSafety.role !== "contract_amount"
        ) {
          blockers.push("合同金额候选没有明确合同金额角色");
        }
        if (
          amountSafety.scope !== "current_contract" ||
          !amountSafety.explicitContractTotal
        ) {
          blockers.push("合同金额候选缺少整份合同作用域");
        }
      }
      if (
        amountSafety.role === "payment_amount" ||
        amountSafety.role === "tax_amount" ||
        amountSafety.role === "service_fee" ||
        amountSafety.role === "unit_price"
      ) {
        blockers.push("付款金额、税额、服务费或单价不能作为合同金额自动采用");
      }
    }
  } else if (
    (!systemDerivedTerminationAmount &&
      amountSafety?.unresolvedContractAmountFact) ||
    (!systemDerivedTerminationAmount &&
      amountSafety?.riskCodes.includes("AMOUNT_UNRESOLVED_RAW_FACT"))
  ) {
    blockers.push("原文存在尚未形成候选的明确合同金额事实");
  }

  if (!input.declaredCategory) {
    blockers.push("合同缺少上传时锁定的声明分类");
  } else {
    values.category = input.declaredCategory;
    warnings.push("合同类型采用上传前选择值，不参与OCR识别和安全门禁");
  }

  for (const fieldCode of REQUIRED_OCR_FIELDS) {
    if (values[fieldCode]) continue;
    if (
      automaticOcrFieldAllowsEmpty(
        fieldCode,
        input.relationType,
        isFrameworkAgreement,
        input.amountContext,
      )
    ) {
      legalEmptyFields.push(fieldCode);
      warnings.push(`${CONTRACT_OCR_FIELD_LABELS[fieldCode]}自动采用合法空值`);
      continue;
    }
    const fieldLabel =
      fieldCode === "project_name" && input.declaredCategory === "asset"
        ? "合同名称"
        : CONTRACT_OCR_FIELD_LABELS[fieldCode];
    blockers.push(`${fieldLabel}没有可采用候选`);
  }

  if (
    values.party_a &&
    values.party_b &&
    normalizeContractPartyIdentity(values.party_a) ===
      normalizeContractPartyIdentity(values.party_b)
  ) {
    blockers.push("甲方单位与乙方单位不能完全相同");
  }

  if (values.amount) {
    try {
      const amount = centsToAmount(toCents(values.amount));
      validateAmountForRelation(input.relationType, amount);
    } catch (error) {
      blockers.push(
        error instanceof ContractDomainError
          ? error.message
          : "合同金额格式不正确或超过安全范围",
      );
    }
  }

  if (
    values.contract_date &&
    !isValidAutomaticContractDate(values.contract_date)
  ) {
    blockers.push("合同签订日期不是真实有效日期");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const status =
    infrastructureFailure || documentFailure
      ? "failed"
      : uniqueBlockers.length > 0
        ? "partial"
        : "succeeded";
  return {
    accepted: status === "succeeded",
    status,
    values,
    legalEmptyFields,
    blockers: uniqueBlockers,
    warnings: [...new Set(warnings)],
  };
}

const CONTRACT_OCR_FIELD_LABELS: Record<ContractOcrCoreField, string> = {
  party_a: "甲方单位",
  party_b: "乙方单位",
  project_name: "项目名称",
  amount: "合同金额",
  category: "合同类型",
  contract_date: "合同签订日期",
};

export interface ConfirmContractOcrFieldsInput {
  contractId: string;
  jobId: string;
  expectedVersion: number;
  actorId: string;
  actorRole: string;
  fields: Record<ContractOcrCoreField, unknown>;
  reviewedFields: unknown;
}

export interface ConfirmedContractOcrField {
  field_code: ContractOcrCoreField;
  original_value: string | null;
  normalized_value: string | null;
  final_value: string | null;
  confidence: number;
  source: string;
  page_number: number | null;
  evidence: string | null;
  manually_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export interface ConfirmContractOcrFieldsResult {
  contract: ContractRow;
  jobId: string;
  fields: ConfirmedContractOcrField[];
}

function normalizeContractPartyIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function normalizeManualContractText(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") {
    throw new ContractDomainError(400, `${label}必须是文本`);
  }
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) {
    throw new ContractDomainError(400, `${label}不能为空`);
  }
  if (normalized.length > maximumLength) {
    throw new ContractDomainError(
      400,
      `${label}不能超过${maximumLength}个字符`,
    );
  }
  return normalized;
}

function normalizeManualContractDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ContractDomainError(400, "合同签订日期必须是文本");
  }
  const date = value.normalize("NFKC").trim();
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ContractDomainError(
      400,
      "合同签订日期格式必须为 YYYY-MM-DD",
      "CONTRACT_DATE_INVALID",
    );
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new ContractDomainError(
      400,
      "合同签订日期不是真实有效日期",
      "CONTRACT_DATE_INVALID",
    );
  }
  return date;
}

function normalizeManualContractAmount(value: unknown): {
  amount: number;
  finalValue: string;
} {
  try {
    const cents = toCents(String(value ?? "").trim());
    return {
      amount: centsToAmount(cents),
      finalValue: `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`,
    };
  } catch {
    throw new ContractDomainError(
      400,
      "合同金额格式不正确，且最多保留两位小数",
      "CONTRACT_AMOUNT_INVALID",
    );
  }
}

function normalizedOcrValueMatches(
  fieldCode: ContractOcrCoreField,
  normalizedValue: string | null,
  finalValue: string | null,
): boolean {
  const normalized = normalizedValue?.trim() || null;
  const final = finalValue?.trim() || null;
  if (!normalized || !final) return normalized === final;
  if (fieldCode === "amount") {
    try {
      return toCents(normalized) === toCents(final);
    } catch {
      return false;
    }
  }
  // 自动采用值和系统派生值可能分别保留全角／半角兼容字符，例如补充
  // 协议序号的“（1）”与“(1)”。两侧必须使用同一规范化口径，否则只
  // 规范化候选侧会把内容相同的系统继承名称误判为识别值被改写。
  return normalized.normalize("NFKC").trim() === final.normalize("NFKC").trim();
}

function normalizeReviewedContractOcrFields(
  value: unknown,
): Partial<Record<ContractOcrCoreField, boolean>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractDomainError(
      400,
      "必须提交逐字段核对凭据",
      "OCR_FIELD_REVIEW_REQUIRED",
    );
  }
  const reviewedFields = value as Record<string, unknown>;
  const invalidKeys = Object.keys(reviewedFields).filter(
    (fieldCode) =>
      !(REQUIRED_OCR_FIELDS as readonly string[]).includes(fieldCode) ||
      typeof reviewedFields[fieldCode] !== "boolean",
  );
  if (invalidKeys.length > 0) {
    throw new ContractDomainError(
      400,
      "逐字段核对凭据格式不正确",
      "OCR_FIELD_REVIEW_INVALID",
    );
  }
  return reviewedFields as Partial<Record<ContractOcrCoreField, boolean>>;
}

/**
 * 财务对最新未自动采用结果进行整组确认。只要任务处于 partial（部分
 * 结果），五个草拟必需字段都必须对照原合同显式确认；选填签订日期只有
 * 提交非空值时才需要确认，不能让高分错误候选绕过安全门禁。
 */
export async function confirmContractOcrFields(
  input: ConfirmContractOcrFieldsInput,
): Promise<ConfirmContractOcrFieldsResult> {
  if (!CONTRACT_FINANCE_ROLES.has(input.actorRole)) {
    throw new ContractDomainError(
      403,
      "只有财务人员可以确认合同识别字段",
      "CONTRACT_FINANCE_ONLY",
    );
  }
  const reviewedFields = normalizeReviewedContractOcrFields(
    input.reviewedFields,
  );
  const submittedKeys = Object.keys(input.fields || {});
  const missingKeys = REQUIRED_OCR_FIELDS.filter(
    (fieldCode) => !submittedKeys.includes(fieldCode),
  );
  const unexpectedKeys = submittedKeys.filter(
    (fieldCode) =>
      !(REQUIRED_OCR_FIELDS as readonly string[]).includes(fieldCode),
  );
  if (missingKeys.length > 0 || unexpectedKeys.length > 0) {
    throw new ContractDomainError(
      400,
      "必须一次提交且仅提交甲方、乙方、项目名称、金额、合同类型占位和签订日期六个字段；合同类型以上传前选择值为准",
      "OCR_CONFIRMATION_FIELDS_INVALID",
    );
  }

  const partyA = normalizeManualContractText(
    input.fields.party_a,
    "甲方单位",
    200,
  );
  const partyB = normalizeManualContractText(
    input.fields.party_b,
    "乙方单位",
    200,
  );
  if (
    normalizeContractPartyIdentity(partyA) ===
    normalizeContractPartyIdentity(partyB)
  ) {
    throw new ContractDomainError(
      400,
      "甲方单位与乙方单位不能完全相同",
      "CONTRACT_PARTIES_IDENTICAL",
    );
  }
  const projectName = normalizeManualContractText(
    input.fields.project_name,
    "项目名称",
    500,
  );
  const amountResult = normalizeManualContractAmount(input.fields.amount);
  const contractDate = normalizeManualContractDate(input.fields.contract_date);

  return db.transaction(async (client) => {
    const contract = await getLockedContract(client, input.contractId);
    assertContractVersion(contract, input.expectedVersion);
    if (contract.status !== "draft") {
      throw new ContractDomainError(409, "只有草拟中的合同可以确认识别字段");
    }
    assertStoredContractUploadContext(contract);
    const category = contract.declared_category;
    if (!category || !CONTRACT_CATEGORY_SET.has(category)) {
      throw new ContractDomainError(
        409,
        "合同缺少上传前选择的合同类型",
        "CONTRACT_DECLARED_CATEGORY_MISSING",
      );
    }
    const finalValues: Record<ContractOcrCoreField, string | null> = {
      party_a: partyA,
      party_b: partyB,
      project_name: projectName,
      amount: amountResult.finalValue,
      category,
      contract_date: contractDate,
    };
    // 合同关系在新增向导下一步才最终确认；此处只校验金额本身为精确到分的
    // 非零安全值，关系对应的正负方向仍由保存草稿和提交审批两道门禁校验。
    if (amountResult.amount === 0) {
      throw new ContractDomainError(
        400,
        "合同金额不能为 0",
        "CONTRACT_AMOUNT_INVALID",
      );
    }

    let relationParent: ContractRow | null = null;
    if (["supplement", "termination"].includes(contract.relation_type)) {
      if (!contract.parent_contract_id) {
        throw new ContractDomainError(
          400,
          "补充协议或终止协议必须关联上级合同",
        );
      }
      const parent = await resolveContractParentContext(
        client,
        contract.parent_contract_id,
        true,
      );
      relationParent = parent;
      if (
        parent.category !== category ||
        parent.area !== contract.area ||
        parent.declared_subtype !== contract.declared_subtype ||
        parent.asset_category !== contract.asset_category ||
        parent.project_id !== contract.project_id
      ) {
        throw new ContractDomainError(
          409,
          "人工确认字段与上级合同的行政区、分类、二级分类、资产分类或项目不一致",
          "CONTRACT_PARENT_MISMATCH",
        );
      }
    }

    const jobResult = await client.query<{
      id: string;
      status: string;
      file_type: string;
      is_current: boolean;
      raw_text: string | null;
    }>(
      `SELECT job.id, job.status, job.raw_text, file.file_type, file.is_current
       FROM contract_ocr_jobs job
       JOIN contract_files file ON file.id = job.file_id
       WHERE job.id = $1 AND job.contract_id = $2
       FOR UPDATE OF job, file`,
      [input.jobId, input.contractId],
    );
    const job = jobResult.rows[0];
    if (!job) {
      throw new ContractDomainError(404, "合同识别任务不存在");
    }
    const leaseTerms = extractContractLeaseTerms(job.raw_text || "", category);
    if (leaseTerms.isRentalLease) {
      throw new ContractDomainError(
        409,
        "房屋租赁合同的租赁期限、月租金、月物业管理费和合同总金额必须由系统自动识别，不允许人工确认或修改，请重新自动识别",
        "RENTAL_CONTRACT_MANUAL_OCR_FORBIDDEN",
      );
    }
    if (job.status !== "partial") {
      throw new ContractDomainError(
        409,
        "只有当前未达到自动采用标准的识别任务可以人工确认",
        "OCR_JOB_NOT_CONFIRMABLE",
      );
    }
    if (job.file_type !== "draft_contract" || !job.is_current) {
      throw new ContractDomainError(
        409,
        "识别任务对应的草拟合同已不是当前版本，请刷新后重试",
        "OCR_FILE_VERSION_MISMATCH",
      );
    }
    let ownBusinessNumber: ReturnType<typeof extractContractBusinessNumber> =
      null;
    let storedOcrLines: Array<{
      page: number;
      text: string;
      bbox: number[][];
      confidence: number;
      modelVersion: "v6_medium";
    }> = [];
    if (category === "main_business") {
      const lines = await client.query<{
        page_number: number;
        text: string;
        bbox_json: unknown;
        confidence: number;
        model_version: string;
      }>(
        `SELECT page_number, text, bbox_json, confidence, model_version
         FROM contract_ocr_lines WHERE job_id = $1
         ORDER BY page_number, line_index`,
        [input.jobId],
      );
      storedOcrLines = lines.rows.map((line) => ({
        page: line.page_number,
        text: line.text,
        bbox: Array.isArray(line.bbox_json)
          ? (line.bbox_json as number[][])
          : [],
        confidence: Number(line.confidence),
        modelVersion: line.model_version as "v6_medium",
      }));
      ownBusinessNumber = extractContractBusinessNumber(storedOcrLines);
      if (ownBusinessNumber) {
        const duplicateBusinessNumber = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE business_contract_no = $1 AND id <> $2 AND is_deleted = FALSE
           LIMIT 1`,
          [ownBusinessNumber.value, input.contractId],
        );
        if (duplicateBusinessNumber.rows[0]) {
          throw new ContractDomainError(
            409,
            `合同文件编号 ${ownBusinessNumber.value} 已被其他有效合同使用`,
            "BUSINESS_CONTRACT_NUMBER_DUPLICATE",
          );
        }
      }
    }
    if (
      category === "main_business" &&
      relationParent &&
      ["supplement", "termination"].includes(contract.relation_type)
    ) {
      const referencedBusinessNumber =
        extractReferencedParentContractBusinessNumber(
          storedOcrLines,
          ownBusinessNumber,
        );
      if (
        referencedBusinessNumber &&
        relationParent.business_contract_no !== referencedBusinessNumber
      ) {
        throw new ContractDomainError(
          409,
          `本文件关联原合同编号 ${referencedBusinessNumber}，但所选上级合同编号为 ${relationParent.business_contract_no || "未识别"}，请删除当前草稿并重新选择正确的上级合同`,
          "CONTRACT_PARENT_BUSINESS_NUMBER_MISMATCH",
        );
      }
    }
    const latestJob = await client.query<{ id: string }>(
      `SELECT id FROM contract_ocr_jobs
       WHERE contract_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [input.contractId],
    );
    if (latestJob.rows[0]?.id !== input.jobId) {
      throw new ContractDomainError(
        409,
        "该识别任务已被更新任务替代，请刷新后重试",
        "OCR_JOB_SUPERSEDED",
      );
    }

    const fieldResult = await client.query<{
      field_code: string;
      normalized_value: string | null;
      confidence: number;
    }>(
      `SELECT field_code, normalized_value, confidence
       FROM contract_ocr_fields
       WHERE job_id = $1 AND field_code = ANY($2::text[])
       FOR UPDATE`,
      [input.jobId, [...REQUIRED_OCR_FIELDS]],
    );
    const fieldsByCode = new Map(
      fieldResult.rows.map((field) => [field.field_code, field]),
    );
    const missingStoredFields = REQUIRED_OCR_FIELDS.filter(
      (fieldCode) => !fieldsByCode.has(fieldCode),
    );
    if (missingStoredFields.length > 0) {
      throw new ContractDomainError(
        409,
        `识别任务缺少核心字段记录，请重新识别：${missingStoredFields.join("、")}`,
        "OCR_FIELDS_INCOMPLETE",
      );
    }

    // 候选安全门禁的来源、角色、作用域和排序差距不等价于诊断分。部分任务
    // 若仍按“100 分免确认”，高分错误候选即可借人工接口升级为成功任务。
    // 因此兼容人工路径必须对草拟必需字段全部显式核对；签订日期只有实际
    // 填写时才进入人工证明，空日期保留为可追溯但不阻塞的字段记录。
    const reviewRequiredFields: ContractOcrCoreField[] = [
      ...REQUIRED_DRAFT_OCR_VALUE_FIELDS,
      ...(contractDate ? (["contract_date"] as const) : []),
    ];
    const missingReviewedFields = reviewRequiredFields.filter(
      (fieldCode) => reviewedFields[fieldCode] !== true,
    );
    if (missingReviewedFields.length > 0) {
      throw new ContractDomainError(
        400,
        `请逐字段对照合同原文并确认：${missingReviewedFields
          .map((fieldCode) => CONTRACT_OCR_FIELD_LABELS[fieldCode])
          .join("、")}`,
        "OCR_FIELD_REVIEW_REQUIRED",
      );
    }

    const now = new Date().toISOString();
    const reviewRequiredFieldSet = new Set(reviewRequiredFields);
    const manuallyConfirmedFields: ContractOcrCoreField[] = [];
    const modifiedFields: ContractOcrCoreField[] = [];
    for (const fieldCode of REQUIRED_OCR_FIELDS) {
      const storedField = fieldsByCode.get(fieldCode)!;
      const modified = !normalizedOcrValueMatches(
        fieldCode,
        storedField.normalized_value,
        finalValues[fieldCode],
      );
      const manuallyConfirmed = reviewRequiredFieldSet.has(fieldCode);
      if (modified) modifiedFields.push(fieldCode);
      if (manuallyConfirmed) manuallyConfirmedFields.push(fieldCode);
      const updatedField = await client.query(
        `UPDATE contract_ocr_fields SET
           final_value = $3,
           manually_confirmed = $4,
           confirmed_by = CASE WHEN $4 THEN $5 ELSE NULL END,
           confirmed_at = CASE WHEN $4 THEN $6 ELSE NULL END,
           updated_at = $6
         WHERE job_id = $1 AND field_code = $2`,
        [
          input.jobId,
          fieldCode,
          finalValues[fieldCode],
          manuallyConfirmed,
          input.actorId,
          now,
        ],
      );
      if (updatedField.rowCount !== 1) {
        throw new ContractDomainError(
          409,
          "识别字段已发生变化，请刷新后重试",
          "OCR_FIELD_CONFLICT",
        );
      }
    }

    const contractDateSource = contractDate ? "manual" : null;
    const contractResult = await client.query<ContractRow>(
      `UPDATE contracts SET
         party_a = $2,
         party_b = $3,
         project_name = $4,
         amount_delta = $5,
         category = $6,
         contract_date = $7,
         contract_date_source = $8,
         business_contract_no = COALESCE($9, business_contract_no),
         lease_start_date = $10,
         lease_end_date = $11,
         lease_monthly_rent = $12,
         lease_monthly_property_fee = $13,
         lease_term_months = $14,
         lease_amount_source = $15,
         updated_by = $16,
         updated_at = $17,
         version = version + 1
       WHERE id = $1 AND status = 'draft' AND version = $18
       RETURNING *`,
      [
        input.contractId,
        partyA,
        partyB,
        projectName,
        amountResult.amount,
        category,
        contractDate,
        contractDateSource,
        category === "main_business" ? ownBusinessNumber?.value || null : null,
        leaseTerms.isRentalLease ? leaseTerms.leaseStartDate : null,
        leaseTerms.isRentalLease ? leaseTerms.leaseEndDate : null,
        leaseTerms.isRentalLease ? leaseTerms.monthlyRent : null,
        leaseTerms.isRentalLease
          ? leaseTerms.monthlyPropertyManagementFee
          : null,
        leaseTerms.isRentalLease ? leaseTerms.termMonths : null,
        leaseTerms.isRentalLease ? leaseTerms.amountSource : null,
        input.actorId,
        now,
        input.expectedVersion,
      ],
    );
    if (!contractResult.rows[0]) {
      throw new ContractDomainError(
        409,
        "合同已被其他用户修改，请刷新后重试",
        "VERSION_CONFLICT",
      );
    }
    const inferredFundingMode = inferAssetFundingMode(category, partyA, partyB);
    if (contract.relation_type === "main" && inferredFundingMode) {
      await client.query(
        `UPDATE contracts SET asset_funding_mode = $2 WHERE id = $1`,
        [input.contractId, inferredFundingMode],
      );
      contractResult.rows[0].asset_funding_mode = inferredFundingMode;
    }
    const confirmedJob = await client.query(
      `UPDATE contract_ocr_jobs SET
         status = 'succeeded', error_message = NULL, updated_at = $2,
         finished_at = COALESCE(finished_at, $2)
       WHERE id = $1 AND status = 'partial'`,
      [input.jobId, now],
    );
    if (confirmedJob.rowCount !== 1) {
      throw new ContractDomainError(
        409,
        "识别任务状态已变化，请刷新后重试",
        "OCR_JOB_CONFLICT",
      );
    }

    await insertAudit(client, {
      contractId: input.contractId,
      action: "ocr_fields_manually_confirmed",
      actorId: input.actorId,
      actorRole: input.actorRole,
      fromStatus: contract.status,
      toStatus: contract.status,
      changes: {
        jobId: input.jobId,
        expectedVersion: input.expectedVersion,
        reviewRequiredFields,
        reviewedFields: reviewRequiredFields,
        manuallyConfirmedFields,
        modifiedFields,
        preservedAutomaticFields: REQUIRED_OCR_FIELDS.filter(
          (fieldCode) =>
            !manuallyConfirmedFields.includes(fieldCode) &&
            Boolean(finalValues[fieldCode]),
        ),
        optionalEmptyFields: contractDate ? [] : ["contract_date"],
        contractDateSource,
      },
      now,
    });

    const confirmedFields = await client.query<ConfirmedContractOcrField>(
      `SELECT field_code, original_value, normalized_value, final_value,
         confidence, source, page_number, evidence, manually_confirmed,
         confirmed_by, confirmed_at
       FROM contract_ocr_fields
       WHERE job_id = $1 AND field_code = ANY($2::text[])
       ORDER BY field_code`,
      [input.jobId, [...REQUIRED_OCR_FIELDS]],
    );
    return {
      contract: contractResult.rows[0],
      jobId: input.jobId,
      fields: confirmedFields.rows,
    };
  });
}

export async function resolveContractApprovalTarget(
  client: PoolClient,
  contract: ContractRow,
): Promise<ContractApprovalTarget> {
  if (
    contract.category !== "main_business" &&
    contract.category !== "non_main" &&
    contract.category !== "asset"
  ) {
    throw new ContractDomainError(
      409,
      "合同分类尚未确定，无法锁定审批人",
      "CONTRACT_CATEGORY_REQUIRED_FOR_APPROVAL",
    );
  }
  const managers = await client.query<{
    id: string;
    name: string;
    role: string;
  }>(
    `SELECT id, name, role FROM users
     WHERE role = 'general_manager' AND status = 'active'
     ORDER BY id ASC LIMIT 2`,
  );
  if (managers.rows.length === 0) {
    throw new ContractDomainError(
      409,
      "未配置可用的总经理账号，无法提交审批",
      "GENERAL_MANAGER_UNAVAILABLE",
    );
  }
  if (managers.rows.length > 1) {
    throw new ContractDomainError(
      409,
      "存在多个活动总经理账号，无法唯一锁定审批人，请先完成账号配置",
      "GENERAL_MANAGER_NOT_UNIQUE",
    );
  }
  return {
    ...managers.rows[0],
    source: "general_manager",
    projectIdSnapshot: contract.project_id,
  };
}

/**
 * 将历史遗留的项目负责人待审批轮次一次性重指向唯一活动总经理。只更新尚未
 * 处理的轮次目标快照，不改写任何历史审批记录；无法唯一解析总经理时阻断启动，
 * 避免旧轮次在取消员工审批权限后静默卡死。
 */
export async function reassignLegacyPendingContractApprovalRounds(): Promise<{
  reassignedCount: number;
}> {
  return db.transaction(async (client) => {
    const legacyRounds = await client.query<
      ContractApprovalRound & { contract_project_id: string | null }
    >(
      `SELECT approval_round.*, c.project_id AS contract_project_id
       FROM contract_approval_rounds approval_round
       JOIN contracts c ON c.id = approval_round.contract_id
       WHERE approval_round.status = 'pending'
         AND c.status = 'approving'
         AND c.is_deleted = FALSE
         AND (
           approval_round.target_source IS DISTINCT FROM 'general_manager'
           OR approval_round.target_approver_role_snapshot
             IS DISTINCT FROM 'general_manager'
           OR NOT EXISTS (
             SELECT 1 FROM users target
             WHERE target.id = approval_round.target_approver_id
               AND target.role = 'general_manager'
               AND target.status = 'active'
           )
         )
       ORDER BY approval_round.submitted_at ASC, approval_round.id ASC
       FOR UPDATE OF approval_round`,
    );
    if (legacyRounds.rows.length === 0) return { reassignedCount: 0 };

    const managers = await client.query<{
      id: string;
      name: string;
      role: string;
    }>(
      `SELECT id, name, role FROM users
       WHERE role = 'general_manager' AND status = 'active'
       ORDER BY id ASC LIMIT 2`,
    );
    if (managers.rows.length === 0) {
      throw new ContractDomainError(
        500,
        "存在历史待审批合同，但未配置可用的总经理账号，服务不能启动",
        "LEGACY_CONTRACT_APPROVAL_GENERAL_MANAGER_UNAVAILABLE",
      );
    }
    if (managers.rows.length > 1) {
      throw new ContractDomainError(
        500,
        "存在历史待审批合同且有多个活动总经理账号，无法安全迁移审批人",
        "LEGACY_CONTRACT_APPROVAL_GENERAL_MANAGER_NOT_UNIQUE",
      );
    }

    const manager = managers.rows[0];
    const now = new Date().toISOString();
    for (const round of legacyRounds.rows) {
      await client.query(
        `UPDATE contract_approval_rounds
         SET target_approver_id = $2,
             target_approver_name_snapshot = $3,
             target_approver_role_snapshot = 'general_manager',
             target_source = 'general_manager',
             project_id_snapshot = $4,
             updated_at = $5
         WHERE id = $1 AND status = 'pending'`,
        [round.id, manager.id, manager.name, round.contract_project_id, now],
      );
      await insertAudit(client, {
        contractId: round.contract_id,
        action: "approval_target_reassigned_to_general_manager",
        actorId: manager.id,
        actorRole: manager.role,
        fromStatus: "approving",
        toStatus: "approving",
        changes: {
          approvalRoundId: round.id,
          previousTargetApproverId: round.target_approver_id,
          previousTargetApproverName: round.target_approver_name_snapshot,
          previousTargetApproverRole: round.target_approver_role_snapshot,
          previousTargetSource: round.target_source,
          targetApproverId: manager.id,
          targetApproverName: manager.name,
          targetApproverRole: manager.role,
          targetSource: "general_manager",
        },
        now,
      });
    }
    return { reassignedCount: legacyRounds.rows.length };
  });
}

export async function createContractApprovalRound(
  client: PoolClient,
  input: {
    contract: ContractRow;
    kind: ContractApprovalKind;
    initiatorId: string;
    initiatorRole: string;
    now: string;
  },
): Promise<{ round: ContractApprovalRound; target: ContractApprovalTarget }> {
  const target = await resolveContractApprovalTarget(client, input.contract);
  const round: ContractApprovalRound = {
    id: nanoid(),
    contract_id: input.contract.id,
    approval_kind: input.kind,
    status: "pending",
    initiator_id: input.initiatorId,
    initiator_role: input.initiatorRole,
    target_approver_id: target.id,
    target_approver_name_snapshot: target.name,
    target_approver_role_snapshot: target.role,
    target_source: target.source,
    project_id_snapshot: target.projectIdSnapshot,
    submitted_at: input.now,
    completed_at: null,
    completed_by: null,
    completed_action: null,
    created_at: input.now,
    updated_at: input.now,
  };
  await client.query(
    `INSERT INTO contract_approval_rounds (
       id, contract_id, approval_kind, status, initiator_id, initiator_role,
       target_approver_id, target_approver_name_snapshot,
       target_approver_role_snapshot, target_source, project_id_snapshot,
       submitted_at, created_at, updated_at
     ) VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11,$11,$11)
     RETURNING *`,
    [
      round.id,
      input.contract.id,
      input.kind,
      input.initiatorId,
      input.initiatorRole,
      target.id,
      target.name,
      target.role,
      target.source,
      target.projectIdSnapshot,
      input.now,
    ],
  );
  return { round, target };
}

function expectedApprovalKind(contract: ContractRow): ContractApprovalKind {
  if (contract.pending_action === "termination") return "termination";
  if (
    contract.pending_action === "seal" &&
    contract.previous_status === "pending_seal"
  ) {
    return "seal_difference";
  }
  return "seal";
}

async function getLockedPendingApprovalRound(
  client: PoolClient,
  contract: ContractRow,
): Promise<ContractApprovalRound> {
  const result = await client.query<ContractApprovalRound>(
    `SELECT * FROM contract_approval_rounds
     WHERE contract_id = $1 AND status = 'pending'
     ORDER BY submitted_at DESC, id DESC LIMIT 1 FOR UPDATE`,
    [contract.id],
  );
  const round = result.rows[0];
  if (!round) {
    throw new ContractDomainError(
      409,
      "未找到本轮审批人快照，请由财务撤回后重新提交",
      "CONTRACT_APPROVAL_ROUND_NOT_FOUND",
    );
  }
  if (round.approval_kind !== expectedApprovalKind(contract)) {
    throw new ContractDomainError(
      409,
      "本轮审批类型与合同状态不一致，请联系管理员核查",
      "CONTRACT_APPROVAL_ROUND_MISMATCH",
    );
  }
  return round;
}

export function approvalTargetSnapshot(round: ContractApprovalRound) {
  return {
    approvalRoundId: round.id,
    approvalKind: round.approval_kind,
    targetApproverId: round.target_approver_id,
    targetApproverName: round.target_approver_name_snapshot,
    targetApproverRole: round.target_approver_role_snapshot,
    targetSource: round.target_source,
    projectIdSnapshot: round.project_id_snapshot,
  };
}

async function validateSubmission(
  client: PoolClient,
  contract: ContractRow,
): Promise<{ approvalFileIds: string[]; ocrJobId: string }> {
  assertStoredContractUploadContext(contract);
  const missing: string[] = [];
  if (!contract.party_a?.trim()) missing.push("甲方单位");
  if (!contract.party_b?.trim()) missing.push("乙方单位");
  if (!contract.category) missing.push("合同类型");
  if (!contract.declared_subtype) missing.push("合同二级分类");
  if (contract.category === "asset" && !contract.asset_category) {
    missing.push("资产合同分类");
  }
  if (missing.length > 0) {
    throw new ContractDomainError(
      400,
      `请完善合同必填字段：${missing.join("、")}`,
    );
  }
  if (contract.category !== contract.declared_category) {
    throw new ContractDomainError(
      409,
      "OCR识别合同分类与上传时预选分类不一致，请重新上传正确合同",
      "OCR_DECLARED_CATEGORY_MISMATCH",
    );
  }
  if (
    normalizeContractPartyIdentity(contract.party_a || "") ===
    normalizeContractPartyIdentity(contract.party_b || "")
  ) {
    throw new ContractDomainError(
      400,
      "甲方单位与乙方单位不能完全相同",
      "CONTRACT_PARTIES_IDENTICAL",
    );
  }
  validateAmountForRelation(contract.relation_type, contract.amount_delta);
  let inheritedRelationSubjectName: string | null = null;
  // 保留该显式变量名用于既有补充协议审批门禁审计测试。
  let inheritedSupplementSubjectName: string | null = null;
  if (["supplement", "termination"].includes(contract.relation_type)) {
    if (!contract.parent_contract_id) {
      throw new ContractDomainError(400, "补充协议或终止协议必须关联上级合同");
    }
    const parent = await resolveContractParentContext(
      client,
      contract.parent_contract_id,
    );
    if (contract.relation_type === "supplement") {
      inheritedSupplementSubjectName = buildSupplementSubjectName(
        parent,
        contract.supplement_sequence,
      );
      inheritedRelationSubjectName = inheritedSupplementSubjectName;
    } else {
      if (!contract.termination_target_contract_id) {
        throw new ContractDomainError(
          409,
          "解除协议缺少被解除合同",
          "CONTRACT_TERMINATION_TARGET_REQUIRED",
        );
      }
      const terminationContext = await resolveTerminationTargetContext(
        client,
        contract.termination_target_contract_id,
      );
      if (terminationContext.root.id !== parent.id) {
        throw new ContractDomainError(
          409,
          "被解除合同不属于当前主合同链",
          "CONTRACT_TERMINATION_TARGET_ROOT_MISMATCH",
        );
      }
      inheritedRelationSubjectName = buildTerminationSubjectName(
        terminationContext.target,
      );
      if (
        !inheritedRelationSubjectName ||
        contract.project_name !== inheritedRelationSubjectName ||
        contract.title !== inheritedRelationSubjectName
      ) {
        throw new ContractDomainError(
          409,
          "解除协议名称与被解除合同不一致，请重新上传",
          "CONTRACT_TERMINATION_SUBJECT_MISMATCH",
        );
      }
    }
    if (
      contract.root_contract_id !== parent.id ||
      contract.project_id !== parent.project_id ||
      contract.area !== parent.area ||
      contract.declared_category !== parent.category ||
      contract.category !== parent.category ||
      contract.declared_subtype !== parent.declared_subtype ||
      contract.asset_category !== parent.asset_category
    ) {
      throw new ContractDomainError(
        409,
        "子协议与上级合同的行政区、分类、二级分类、资产分类或项目不一致，请重新上传合同",
        "CONTRACT_PARENT_MISMATCH",
      );
    }
    if (contract.lease_operation_type === "renewal") {
      if (
        contract.relation_type !== "supplement" ||
        parent.category !== "asset" ||
        !parent.declared_subtype ||
        !["house_rental", "vehicle_rental", "parking_space"].includes(
          parent.declared_subtype,
        )
      ) {
        throw new ContractDomainError(
          409,
          "续签协议关联的原合同不是有效租赁主合同",
          "CONTRACT_RENTAL_RENEWAL_TARGET_REQUIRED",
        );
      }
      if (
        !contract.lease_previous_end_date ||
        parent.lease_end_date !== contract.lease_previous_end_date
      ) {
        throw new ContractDomainError(
          409,
          "原合同当前到期日已变化，续签协议须按最新租期重新识别",
          "CONTRACT_RENTAL_RENEWAL_STALE",
        );
      }
      if (
        !contract.lease_start_date ||
        !contract.lease_end_date ||
        contract.lease_end_date <= contract.lease_previous_end_date ||
        contract.amount_delta == null ||
        Number(contract.amount_delta) <= 0
      ) {
        throw new ContractDomainError(
          409,
          "续签协议的新租期或新增金额不完整，不能提交审批",
          "CONTRACT_RENTAL_RENEWAL_INCOMPLETE",
        );
      }
    }
    await assertRootAmountAfterAdjustment(client, contract);
  }
  if (contract.renewed_from_contract_id) {
    if (
      contract.relation_type !== "main" ||
      contract.root_contract_id !== contract.id ||
      contract.parent_contract_id !== null ||
      contract.category !== "asset" ||
      !contract.declared_subtype ||
      !["house_rental", "vehicle_rental", "parking_space"].includes(
        contract.declared_subtype,
      )
    ) {
      throw new ContractDomainError(
        409,
        "续签合同必须是独立的资产租赁主合同",
        "CONTRACT_RENEWAL_MAIN_REQUIRED",
      );
    }
    const sourceResult = await client.query<ContractRow>(
      `SELECT * FROM contracts
       WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
      [contract.renewed_from_contract_id],
    );
    const source = sourceResult.rows[0];
    if (
      !source ||
      source.relation_type !== "main" ||
      source.root_contract_id !== source.id ||
      !["effective", "executing", "completed"].includes(source.status)
    ) {
      throw new ContractDomainError(
        409,
        "前序租赁主合同不存在或当前不可续签",
        "CONTRACT_RENEWAL_SOURCE_INVALID",
      );
    }
    if (
      !contract.renewed_from_lease_end_date ||
      source.lease_end_date !== contract.renewed_from_lease_end_date
    ) {
      throw new ContractDomainError(
        409,
        "前序租赁合同当前到期日已变化，请删除草稿后重新续签",
        "CONTRACT_RENEWAL_SOURCE_STALE",
      );
    }
    if (
      source.area !== contract.area ||
      source.declared_subtype !== contract.declared_subtype ||
      source.asset_category !== contract.asset_category ||
      normalizeContractPartyIdentity(source.party_a || "") !==
        normalizeContractPartyIdentity(contract.party_a || "") ||
      normalizeContractPartyIdentity(source.party_b || "") !==
        normalizeContractPartyIdentity(contract.party_b || "")
    ) {
      throw new ContractDomainError(
        409,
        "续签合同与前序租赁合同的主体、行政区或租赁分类不一致",
        "CONTRACT_RENEWAL_SOURCE_MISMATCH",
      );
    }
    if (
      !contract.lease_start_date ||
      !contract.lease_end_date ||
      contract.lease_start_date <= contract.renewed_from_lease_end_date ||
      contract.lease_end_date < contract.lease_start_date ||
      contract.amount_delta == null ||
      Number(contract.amount_delta) <= 0
    ) {
      throw new ContractDomainError(
        409,
        "续签新合同的租期或合同总金额不完整",
        "CONTRACT_RENEWAL_TERMS_INCOMPLETE",
      );
    }
    const conflictingSuccessor = await client.query<{ id: string }>(
      `SELECT id FROM contracts
       WHERE renewed_from_contract_id = $1 AND id <> $2
         AND is_deleted = FALSE AND status <> 'rejected'
       ORDER BY created_at, id LIMIT 1 FOR UPDATE`,
      [source.id, contract.id],
    );
    if (conflictingSuccessor.rows[0]) {
      throw new ContractDomainError(
        409,
        "前序合同已有其他续签合同",
        "CONTRACT_RENEWAL_ALREADY_EXISTS",
      );
    }
  }
  if (contract.project_id) {
    const project = await client.query<{ district: string }>(
      `SELECT district FROM worklog_projects WHERE id = $1`,
      [contract.project_id],
    );
    if (!project.rows[0]) {
      throw new ContractDomainError(400, "关联项目不存在");
    }
    if (
      !isBeijingContractArea(project.rows[0].district) ||
      (contract.area !== "全部" && project.rows[0].district !== contract.area)
    ) {
      throw new ContractDomainError(
        409,
        "关联项目与合同所属行政区不一致",
        "CONTRACT_PROJECT_AREA_MISMATCH",
      );
    }
  }

  const latestJob = await client.query<{
    id: string;
    status: string;
    file_id: string;
    raw_text: string | null;
    warnings_json: unknown;
  }>(
    `SELECT id, status, file_id, raw_text, warnings_json FROM contract_ocr_jobs
     WHERE contract_id = $1
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [contract.id],
  );
  const job = latestJob.rows[0];
  if (!job) {
    throw new ContractDomainError(400, "请先上传合同并完成智能识别");
  }
  if (["queued", "processing"].includes(job.status)) {
    throw new ContractDomainError(
      409,
      "合同识别任务仍在执行，请完成后再提交审批",
      "OCR_JOB_IN_PROGRESS",
    );
  }
  if (job.status !== "succeeded") {
    throw new ContractDomainError(
      409,
      "合同自动识别尚未形成可采用结果，请重新识别或重新上传清晰完整的合同文件",
      "OCR_AUTOMATIC_RECOGNITION_REQUIRED",
    );
  }
  const persistedPolicyMarker = `自动采用策略：${CONTRACT_OCR_AUTOMATIC_POLICY_VERSION}`;
  const persistedWarnings = Array.isArray(job.warnings_json)
    ? job.warnings_json.filter(
        (warning): warning is string => typeof warning === "string",
      )
    : [];
  const hasCurrentAutomaticAttestation =
    persistedWarnings.includes(persistedPolicyMarker) &&
    persistedWarnings.includes(CONTRACT_OCR_AUTOMATIC_ACCEPTED_MARKER);
  const documents = await client.query<{ id: string; file_type: string }>(
    `SELECT id, file_type FROM contract_files
     WHERE contract_id = $1 AND is_current = TRUE
       AND file_type = ANY($2::text[])
     ORDER BY file_type, created_at DESC, id DESC`,
    [contract.id, ["draft_contract", "seal_application"]],
  );
  const currentDrafts = documents.rows.filter(
    (document) => document.file_type === "draft_contract",
  );
  if (currentDrafts.length !== 1) {
    throw new ContractDomainError(
      409,
      "草拟合同当前版本异常，请重新上传草拟合同",
      "CURRENT_DRAFT_VERSION_INVALID",
    );
  }
  if (job.file_id !== currentDrafts[0].id) {
    throw new ContractDomainError(
      409,
      "最新识别结果与当前草拟合同版本不一致，请等待新版本识别完成",
      "OCR_FILE_VERSION_MISMATCH",
    );
  }
  const recognizedFields = await client.query<{
    field_code: string;
    normalized_value: string | null;
    final_value: string | null;
    manually_confirmed: boolean;
    confirmed_by: string | null;
    confirmed_at: string | null;
  }>(
    `SELECT field_code, normalized_value, final_value, manually_confirmed,
            confirmed_by, confirmed_at
     FROM contract_ocr_fields
     WHERE job_id = $1 AND field_code = ANY($2::text[])`,
    [job.id, [...REQUIRED_OCR_FIELDS]],
  );
  const fieldsByCode = new Map(
    recognizedFields.rows.map((field) => [field.field_code, field]),
  );
  const missingOcrFields = REQUIRED_OCR_FIELDS.filter(
    (fieldCode) => !fieldsByCode.has(fieldCode),
  );
  if (missingOcrFields.length > 0) {
    throw new ContractDomainError(
      400,
      `自动识别结果缺少核心字段，请重新识别：${missingOcrFields.join("、")}`,
      "OCR_FIELDS_INCOMPLETE",
    );
  }
  const fieldHasCompleteManualProof = (fieldCode: ContractOcrCoreField) => {
    const field = fieldsByCode.get(fieldCode);
    return Boolean(
      field?.manually_confirmed && field.confirmed_by && field.confirmed_at,
    );
  };
  const allRequiredFieldsManuallyConfirmed =
    REQUIRED_DRAFT_OCR_VALUE_FIELDS.every(fieldHasCompleteManualProof);
  const contractDateField = fieldsByCode.get("contract_date")!;
  const contractDateHasFinalValue = Boolean(
    contractDateField.final_value?.trim(),
  );
  const contractDateHasAnyManualProof = Boolean(
    contractDateField.manually_confirmed ||
    contractDateField.confirmed_by ||
    contractDateField.confirmed_at,
  );
  const optionalContractDateProofValid = contractDateHasFinalValue
    ? fieldHasCompleteManualProof("contract_date")
    : !contractDateHasAnyManualProof;
  const completeManualAttestation =
    allRequiredFieldsManuallyConfirmed && optionalContractDateProofValid;
  const anyFieldManuallyConfirmed = recognizedFields.rows.some(
    (field) =>
      field.manually_confirmed ||
      Boolean(field.confirmed_by) ||
      Boolean(field.confirmed_at),
  );
  if (!hasCurrentAutomaticAttestation && !completeManualAttestation) {
    throw new ContractDomainError(
      409,
      "最新识别结果没有当前自动采用通过证明，且五个必需字段或已填写日期未完成确认",
      anyFieldManuallyConfirmed
        ? "OCR_MANUAL_CONFIRMATION_INCOMPLETE"
        : "OCR_AUTOMATIC_POLICY_STALE",
    );
  }
  if (hasCurrentAutomaticAttestation && anyFieldManuallyConfirmed) {
    throw new ContractDomainError(
      409,
      "识别字段处于自动采用与人工确认混合状态，请重新识别或整组确认",
      "OCR_MANUAL_CONFIRMATION_INCOMPLETE",
    );
  }
  const emptyFinalFields = (["party_a", "party_b", "category"] as const).filter(
    (fieldCode) => !fieldsByCode.get(fieldCode)?.final_value?.trim(),
  );
  if (emptyFinalFields.length > 0) {
    throw new ContractDomainError(
      400,
      `识别字段尚未形成可用最终值，请重新识别：${emptyFinalFields.join("、")}`,
      "OCR_FIELDS_INCOMPLETE",
    );
  }
  // 候选来源、角色和实际排序只存在识别进程内，不能从丢失行置信度及局部
  // 作用域的 raw_text（原始文本）伪造重建。审批改为验证当前策略标记以及
  // 自动字段未被改写；人工确认字段继续走既有独立审计链路。
  const changedAutomaticFields = recognizedFields.rows
    .filter(
      (field) => !field.manually_confirmed && field.field_code !== "category",
    )
    .filter((field) => {
      // 补充协议名称由已锁定的主合同名称派生，并非直接采用正文候选。
      // 因此应核对最终值是否仍等于继承名称，而不是要求它与原始识别片段相等。
      const normalizedValue =
        ["supplement", "termination"].includes(contract.relation_type) &&
        field.field_code === "project_name"
          ? inheritedRelationSubjectName
          : contract.relation_type === "termination" &&
              field.field_code === "amount"
            ? "0.00"
            : field.normalized_value?.trim() || null;
      const finalValue = field.final_value?.trim() || null;
      if (normalizedValue === null || finalValue === null) {
        return normalizedValue !== finalValue;
      }
      return !normalizedOcrValueMatches(
        field.field_code as ContractOcrCoreField,
        normalizedValue,
        finalValue,
      );
    })
    .map((field) => field.field_code);
  const categoryField = fieldsByCode.get("category")!;
  const recognizedAutomaticCategory = normalizeAutomaticContractCategory(
    categoryField.normalized_value?.trim() || null,
  );
  const categoryAttestationInvalid = categoryField.manually_confirmed
    ? categoryField.final_value !== contract.declared_category
    : categoryField.final_value !== contract.declared_category ||
      (recognizedAutomaticCategory != null &&
        recognizedAutomaticCategory !== contract.declared_category);
  if (changedAutomaticFields.length > 0 || categoryAttestationInvalid) {
    throw new ContractDomainError(
      409,
      `已通过候选安全门禁的识别值发生变化，请重新识别：${[
        ...changedAutomaticFields,
        ...(categoryAttestationInvalid ? ["category"] : []),
      ].join("、")}`,
      "OCR_AUTOMATIC_RECOGNITION_REQUIRED",
    );
  }

  const recognizedValue = (fieldCode: (typeof REQUIRED_OCR_FIELDS)[number]) =>
    fieldsByCode.get(fieldCode)?.final_value?.trim() || null;
  const mismatchedFields: string[] = [];
  if (
    normalizeContractPartyIdentity(contract.party_a || "") !==
    normalizeContractPartyIdentity(recognizedValue("party_a") || "")
  ) {
    mismatchedFields.push("甲方单位");
  }
  if (
    normalizeContractPartyIdentity(contract.party_b || "") !==
    normalizeContractPartyIdentity(recognizedValue("party_b") || "")
  ) {
    mismatchedFields.push("乙方单位");
  }
  if (
    normalizeContractPartyIdentity(contract.project_name || "") !==
    normalizeContractPartyIdentity(recognizedValue("project_name") || "")
  ) {
    mismatchedFields.push("项目名称");
  }
  const recognizedAmount = recognizedValue("amount");
  const paymentOnlySupplement =
    contract.relation_type === "supplement" &&
    contract.supplement_change_type === "payment_terms_only";
  if (contract.relation_type === "termination") {
    if (
      contract.amount_delta == null ||
      recognizedAmount == null ||
      toCents(recognizedAmount) !== 0
    ) {
      mismatchedFields.push("合同金额");
    }
  } else if (paymentOnlySupplement) {
    if (
      contract.amount_delta == null ||
      toCents(contract.amount_delta) !== 0 ||
      recognizedAmount !== null
    ) {
      mismatchedFields.push("合同金额");
    }
  } else {
    if (contract.amount_delta === null || recognizedAmount === null) {
      if (contract.amount_delta !== null || recognizedAmount !== null) {
        mismatchedFields.push("合同金额");
      }
    } else if (toCents(contract.amount_delta) !== toCents(recognizedAmount)) {
      mismatchedFields.push("合同金额");
    }
  }
  if (contract.category !== recognizedValue("category")) {
    mismatchedFields.push("合同类型");
  }
  const recognizedContractDate = recognizedValue("contract_date");
  const expectedContractDateSource = recognizedContractDate
    ? fieldsByCode.get("contract_date")?.manually_confirmed
      ? "manual"
      : "ocr"
    : null;
  if (
    contract.contract_date !== recognizedContractDate ||
    contract.contract_date_source !== expectedContractDateSource
  ) {
    mismatchedFields.push("合同签订日期");
  }
  if (mismatchedFields.length > 0) {
    throw new ContractDomainError(
      409,
      `合同主数据与最新识别最终值不一致，请重新识别或重新确认：${mismatchedFields.join("、")}`,
      "OCR_CONTRACT_VALUE_MISMATCH",
    );
  }

  const currentSealApplication = await client.query<{
    signed_file_id: string | null;
    contract_version: number;
    signer_id: string | null;
  }>(
    `SELECT signed_file_id, contract_version, signer_id
     FROM contract_seal_applications
     WHERE contract_id = $1 AND is_current = TRUE AND status = 'signed'
     ORDER BY form_version DESC, created_at DESC, id DESC
     LIMIT 1`,
    [contract.id],
  );
  const signedApplication = currentSealApplication.rows[0];
  const documentTypes = new Map(
    documents.rows.map((row) => [row.id, row.file_type]),
  );
  if (
    !signedApplication?.signed_file_id ||
    documentTypes.get(signedApplication.signed_file_id) !== "seal_application"
  ) {
    throw new ContractDomainError(
      400,
      "请先在线填写用印申请单并完成本人电子签名",
      "SEAL_APPLICATION_SIGNATURE_REQUIRED",
    );
  }
  if (signedApplication.contract_version !== contract.version) {
    throw new ContractDomainError(
      409,
      "合同内容在用印申请单签名后发生变化，请重新确认并签名",
      "SEAL_APPLICATION_CONTRACT_VERSION_MISMATCH",
    );
  }
  if (signedApplication.signer_id !== contract.created_by) {
    throw new ContractDomainError(
      409,
      "用印申请单必须由合同创建人本人完成电子签名",
      "SEAL_APPLICATION_CREATOR_SIGNATURE_REQUIRED",
    );
  }

  return {
    approvalFileIds: documents.rows.map((document) => document.id),
    ocrJobId: job.id,
  };
}

export async function submitContractForApproval(
  contractId: string,
  actorId: string,
  actorRole: string,
  comment?: string,
): Promise<ContractRow> {
  return db.transaction(async (client) => {
    let contract = await getLockedContract(client, contractId);
    if (contract.status !== "draft") {
      throw new ContractDomainError(409, "只有草拟中的合同可以提交审批");
    }
    contract = await freezeSupplementAmountSnapshotForApproval(
      client,
      contract,
    );
    contract = await freezeTerminationSettlementSnapshotForApproval(
      client,
      contract,
    );
    const submissionSnapshot = await validateSubmission(client, contract);
    assertContractStatusTransition(contract.status, "approving");
    const now = new Date().toISOString();
    const { round } = await createContractApprovalRound(client, {
      contract,
      kind: "seal",
      initiatorId: actorId,
      initiatorRole: actorRole,
      now,
    });
    const result = await client.query<ContractRow>(
      `UPDATE contracts SET status = 'approving', pending_action = 'seal',
         previous_status = 'draft', submitted_at = $2, rejected_at = NULL,
         updated_by = $3, updated_at = $2, version = version + 1
       WHERE id = $1 RETURNING *`,
      [contractId, now, actorId],
    );
    await client.query(
      `INSERT INTO contract_approval_records (
         id, contract_id, approval_round_id, action, approver_id,
         approver_role, comment, from_status, to_status, created_at
       ) VALUES ($1,$2,$3,'submit',$4,$5,$6,$7,'approving',$8)`,
      [
        nanoid(),
        contractId,
        round.id,
        actorId,
        actorRole,
        comment?.trim() || null,
        contract.status,
        now,
      ],
    );
    await insertAudit(client, {
      contractId,
      action: "submit",
      actorId,
      actorRole,
      fromStatus: contract.status,
      toStatus: "approving",
      changes: {
        ...submissionSnapshot,
        ...approvalTargetSnapshot(round),
      },
      comment,
      now,
    });
    await syncProjectContractTotal(client, contract.project_id);
    return result.rows[0];
  });
}

export async function withdrawContractApproval(
  contractId: string,
  actorId: string,
  actorRole: string,
  expectedVersion: number,
): Promise<ContractRow> {
  return db.transaction(async (client) => {
    const contract = await getLockedContract(client, contractId);
    assertContractVersion(contract, expectedVersion);
    if (
      contract.status !== "approving" ||
      contract.pending_action !== "seal" ||
      contract.previous_status !== "draft"
    ) {
      throw new ContractDomainError(409, "当前合同不允许撤回用印审批");
    }

    const round = await getLockedPendingApprovalRound(client, contract);
    if (
      round.initiator_id !== actorId &&
      !CONTRACT_FINANCE_ROLES.has(actorRole)
    ) {
      throw new ContractDomainError(
        403,
        "只有本轮发起人或财务管理员可以撤回审批",
      );
    }

    const managerAction = await client.query<{ id: string }>(
      `SELECT id FROM contract_approval_records
       WHERE contract_id = $1
         AND action IN ('approve', 'reject', 'comment')
         AND approval_round_id = $2
       ORDER BY created_at ASC, id ASC LIMIT 1`,
      [contractId, round.id],
    );
    if (managerAction.rows[0]) {
      throw new ContractDomainError(
        409,
        "目标审批人已处理本轮审批，不能撤回",
        "CONTRACT_APPROVAL_ALREADY_HANDLED",
      );
    }

    assertContractStatusTransition(contract.status, "draft");
    const now = new Date().toISOString();
    const result = await client.query<ContractRow>(
      `UPDATE contracts SET status = 'draft', pending_action = NULL,
         previous_status = NULL, submitted_at = NULL,
         updated_by = $2, updated_at = $3, version = version + 1
       WHERE id = $1 RETURNING *`,
      [contractId, actorId, now],
    );
    await client.query(
      `UPDATE contract_approval_rounds SET status = 'withdrawn',
         completed_at = $2, completed_by = $3, completed_action = 'withdraw',
         updated_at = $2
       WHERE id = $1 AND status = 'pending'`,
      [round.id, now, actorId],
    );
    await client.query(
      `INSERT INTO contract_approval_records (
         id, contract_id, approval_round_id, action, approver_id,
         approver_role, comment, from_status, to_status, created_at
       ) VALUES ($1,$2,$3,'withdraw',$4,$5,NULL,'approving','draft',$6)`,
      [nanoid(), contractId, round.id, actorId, actorRole, now],
    );
    await insertAudit(client, {
      contractId,
      action: "approval_withdrawn",
      actorId,
      actorRole,
      fromStatus: contract.status,
      toStatus: "draft",
      changes: {
        expectedVersion,
        submittedAt: round.submitted_at,
        ...approvalTargetSnapshot(round),
      },
      now,
    });
    await syncProjectContractTotal(client, contract.project_id);
    return result.rows[0];
  });
}

export type ContractApprovalAction = "approve" | "reject" | "comment";

interface GeneralManagerSealSignatureResult {
  artifact: ContractSealApplicationApprovalArtifact;
  auditChanges: Record<string, unknown>;
  obsoleteApplicantFilePath: string;
}

async function deleteObsoleteSealApplicationFile(
  storedFilePath: string | null,
): Promise<void> {
  if (!storedFilePath || !validateFilePath(storedFilePath)) return;
  const absolutePath = path.resolve(process.cwd(), storedFilePath);
  try {
    await fs.promises.unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("删除申请人单独签字用印申请单失败:", {
        storedFilePath,
        error,
      });
    }
  }
}

async function signSealApplicationApprovalByGeneralManager(
  client: PoolClient,
  input: {
    contract: ContractRow;
    round: ContractApprovalRound;
    actorId: string;
    actorRole: string;
    now: string;
  },
): Promise<GeneralManagerSealSignatureResult> {
  if (
    input.actorRole !== "general_manager" ||
    input.round.target_approver_role_snapshot !== "general_manager"
  ) {
    throw new ContractDomainError(
      403,
      "当前审批轮次必须由总经理本人使用电子签名完成",
      "CONTRACT_SEAL_GENERAL_MANAGER_SIGNATURE_REQUIRED",
    );
  }
  const applicationResult = await client.query<{
    id: string;
    form_version: number;
    signed_file_id: string;
    signer_id: string;
    signer_name: string;
    signer_role: string;
    signature_snapshot_path: string;
    signed_at: string;
    approval_round_id: string | null;
    approved_file_id: string | null;
    file_name: string;
    file_path: string;
    file_hash: string;
    file_version: number;
  }>(
    `SELECT application.id, application.form_version,
            application.signed_file_id, application.signer_id,
            application.signer_name, application.signer_role,
            application.signature_snapshot_path, application.signed_at,
            application.approval_round_id, application.approved_file_id,
            file.file_name, file.file_path, file.file_hash,
            file.version AS file_version
       FROM contract_seal_applications application
       JOIN contract_files file ON file.id = application.signed_file_id
      WHERE application.contract_id = $1
        AND application.is_current = TRUE
        AND application.status = 'signed'
        AND file.contract_id = application.contract_id
        AND file.file_type = 'seal_application'
        AND file.is_current = TRUE
      ORDER BY application.form_version DESC, application.created_at DESC
      LIMIT 1
      FOR UPDATE OF application, file`,
    [input.contract.id],
  );
  const application = applicationResult.rows[0];
  if (!application) {
    throw new ContractDomainError(
      409,
      "当前已签用印申请单不存在，请退回后重新生成并签署",
      "SEAL_APPLICATION_SIGNATURE_REQUIRED",
    );
  }
  if (application.approval_round_id || application.approved_file_id) {
    throw new ContractDomainError(
      409,
      "本用印申请单已完成审批签署，请刷新审批记录",
      "SEAL_APPLICATION_ALREADY_APPROVED",
    );
  }
  if (application.signer_id !== input.contract.created_by) {
    throw new ContractDomainError(
      409,
      "用印申请单的申请人签名与合同创建人不一致",
      "SEAL_APPLICATION_CREATOR_SIGNATURE_REQUIRED",
    );
  }
  if (
    !application.signature_snapshot_path ||
    !application.signed_at ||
    Date.parse(application.signed_at) > Date.parse(input.round.submitted_at)
  ) {
    throw new ContractDomainError(
      409,
      "用印申请单签署时间晚于本轮提交时间，请退回后重新提交",
      "SEAL_APPLICATION_SIGNATURE_TIME_INVALID",
    );
  }

  let artifact: ContractSealApplicationApprovalArtifact;
  try {
    artifact = await generateApprovedContractSealApplication(client, {
      contractId: input.contract.id,
      applicationId: application.id,
      formVersion: application.form_version,
      approvalRoundId: input.round.id,
      actorId: input.actorId,
      contractNo:
        input.contract.business_contract_no ||
        input.contract.contract_no ||
        "草拟合同-" + input.contract.id,
      originalFile: {
        filePath: application.file_path,
        fileHash: application.file_hash,
        fileName: application.file_name,
      },
      applicant: {
        name: application.signer_name,
        role: application.signer_role,
        signaturePath: application.signature_snapshot_path,
        signedAt: application.signed_at,
      },
      approvedAt: new Date(input.now),
    });
  } catch (error) {
    if (error instanceof ContractSealApplicationError) {
      throw new ContractDomainError(
        error.statusCode,
        error.message,
        error.code,
      );
    }
    throw error;
  }

  try {
    const sourceDeactivated = await client.query<{ id: string }>(
      `UPDATE contract_files
        SET is_current = FALSE
      WHERE id = $1 AND contract_id = $2
        AND file_type = 'seal_application' AND is_current = TRUE
      RETURNING id`,
      [application.signed_file_id, input.contract.id],
    );
    if (!sourceDeactivated.rows[0]) {
      throw new ContractDomainError(
        409,
        "用印申请单文件版本已变化，请刷新后重试",
        "SEAL_APPLICATION_FILE_VERSION_CONFLICT",
      );
    }

    const approvedFileId = nanoid();
    await client.query(
      `INSERT INTO contract_files (
       id, contract_id, file_type, file_name, file_path, file_size,
       mime_type, file_hash, version, is_current, uploaded_by, created_at
     ) VALUES ($1,$2,'seal_application',$3,$4,$5,$6,$7,$8,TRUE,$9,$10)`,
      [
        approvedFileId,
        input.contract.id,
        artifact.file.fileName,
        artifact.file.filePath,
        artifact.file.fileSize,
        artifact.file.mimeType,
        artifact.file.fileHash,
        application.file_version + 1,
        input.actorId,
        input.now,
      ],
    );
    const applicationUpdated = await client.query<{ id: string }>(
      `UPDATE contract_seal_applications
        SET approval_round_id = $2, signed_file_id = $3, approved_file_id = $3,
            approver_id = $4, approver_name = $5, approver_role = $6,
            approver_signature_snapshot_path = $7,
            approver_signature_snapshot_hash = $8,
            approver_signed_at = $9, updated_by = $4, updated_at = $9
      WHERE id = $1 AND is_current = TRUE AND status = 'signed'
        AND approval_round_id IS NULL AND approved_file_id IS NULL
      RETURNING id`,
      [
        application.id,
        input.round.id,
        approvedFileId,
        artifact.approver.id,
        artifact.approver.name,
        artifact.approver.role,
        artifact.approver.signaturePath,
        artifact.approver.signatureHash,
        artifact.approver.signedAt,
      ],
    );
    if (!applicationUpdated.rows[0]) {
      throw new ContractDomainError(
        409,
        "用印申请单已被其他审批操作更新，请刷新后重试",
        "SEAL_APPLICATION_APPROVAL_CONFLICT",
      );
    }
    const deletedApplicantFile = await client.query<{ file_path: string }>(
      `DELETE FROM contract_files
       WHERE id = $1 AND contract_id = $2
         AND file_type = 'seal_application' AND is_current = FALSE
       RETURNING file_path`,
      [application.signed_file_id, input.contract.id],
    );
    if (!deletedApplicantFile.rows[0]) {
      throw new ContractDomainError(
        409,
        "申请人单独签字用印申请单版本已变化，请刷新后重试",
        "SEAL_APPLICATION_SOURCE_DELETE_CONFLICT",
      );
    }

    return {
      artifact,
      obsoleteApplicantFilePath: deletedApplicantFile.rows[0].file_path,
      auditChanges: {
        sealApplicationId: application.id,
        sealApplicationApprovalRoundId: input.round.id,
        approvedSignedFileId: approvedFileId,
        approvedSignedFileHash: artifact.file.fileHash,
        approverSignedAt: artifact.approver.signedAt,
      },
    };
  } catch (error) {
    cleanupApprovedContractSealApplicationArtifact(artifact);
    throw error;
  }
}

export async function decideContractApproval(
  contractId: string,
  action: ContractApprovalAction,
  actorId: string,
  actorRole: string,
  comment?: string,
): Promise<ContractRow> {
  if (!isContractBusinessApproverRole(actorRole)) {
    throw new ContractDomainError(
      403,
      "合同业务审批仅允许总经理处理",
      "CONTRACT_APPROVAL_GENERAL_MANAGER_ONLY",
    );
  }
  if (action === "reject" && !comment?.trim()) {
    throw new ContractDomainError(400, "驳回时必须填写原因");
  }

  let approvalArtifact: ContractSealApplicationApprovalArtifact | null = null;
  let obsoleteApplicantFilePath: string | null = null;
  try {
    const result = await db.transaction(async (client) => {
      const contractReference = await client.query<{
        id: string;
        root_contract_id: string | null;
      }>(
        `SELECT id, root_contract_id FROM contracts
       WHERE id = $1 AND is_deleted = FALSE`,
        [contractId],
      );
      const reference = contractReference.rows[0];
      if (!reference) {
        throw new ContractDomainError(404, "合同不存在", "CONTRACT_NOT_FOUND");
      }
      // 同一根合同的协议审批必须串行，避免两个核减协议分别校验后同时通过。
      await client.query(
        `SELECT pg_advisory_xact_lock(
         hashtextextended('contract-root-approval:' || $1, 0)
       )`,
        [reference.root_contract_id || reference.id],
      );
      const contract = await getLockedContract(client, contractId);
      if (contract.status !== "approving") {
        throw new ContractDomainError(409, "该合同当前不在审批中");
      }
      const round = await getLockedPendingApprovalRound(client, contract);
      if (
        round.target_source !== "general_manager" ||
        round.target_approver_role_snapshot !== "general_manager"
      ) {
        throw new ContractDomainError(
          409,
          "本轮审批人仍为历史项目负责人，请先完成总经理审批人迁移",
          "CONTRACT_APPROVAL_LEGACY_TARGET_NOT_MIGRATED",
        );
      }
      if (round.target_approver_id !== actorId) {
        throw new ContractDomainError(
          403,
          "只有本轮快照锁定的目标审批人可以处理该合同",
          "CONTRACT_APPROVAL_TARGET_ONLY",
        );
      }
      const isSealDifferenceReview =
        contract.pending_action === "seal" &&
        contract.previous_status === "pending_seal";
      const now = new Date().toISOString();
      if (action === "comment") {
        await client.query(
          `INSERT INTO contract_approval_records (
           id, contract_id, approval_round_id, action, approver_id,
           approver_role, comment, from_status, to_status, created_at
         ) VALUES ($1,$2,$3,'comment',$4,$5,$6,$7,$7,$8)`,
          [
            nanoid(),
            contractId,
            round.id,
            actorId,
            actorRole,
            comment?.trim() || null,
            contract.status,
            now,
          ],
        );
        await insertAudit(client, {
          contractId,
          action: "approval_comment",
          actorId,
          actorRole,
          fromStatus: contract.status,
          toStatus: contract.status,
          changes: approvalTargetSnapshot(round),
          comment,
          now,
        });
        return contract;
      }

      if (action === "approve" && contract.pending_action === "seal") {
        if (["supplement", "termination"].includes(contract.relation_type)) {
          if (!contract.parent_contract_id) {
            throw new ContractDomainError(409, "子协议缺少上级合同关联");
          }
          await resolveContractParentContext(
            client,
            contract.parent_contract_id,
            true,
          );
          await assertRootAmountAfterAdjustment(client, contract, true);
        }
      }
      if (
        action === "approve" &&
        contract.pending_action === "termination" &&
        (contract.root_contract_id || contract.id) === contract.id
      ) {
        const pendingChild = await client.query<{ id: string }>(
          `SELECT id FROM contracts
         WHERE root_contract_id = $1 AND id <> $1 AND is_deleted = FALSE
           AND (
             status = 'pending_seal'
             OR (
               status = 'approving'
               AND pending_action = 'seal'
               AND previous_status = 'pending_seal'
             )
           )
         ORDER BY id ASC LIMIT 1`,
          [contract.id],
        );
        if (pendingChild.rows[0]) {
          throw new ContractDomainError(
            409,
            "该合同仍有待盖章子协议，请先完成或退回子协议后再终止",
            "CONTRACT_PENDING_CHILD_SEAL",
          );
        }
      }

      let terminationRestoreStatus: ContractTerminationRestoreStatus | null =
        null;
      if (action === "reject" && contract.pending_action === "termination") {
        if (!isContractTerminationRestoreStatus(contract.previous_status)) {
          throw new ContractDomainError(
            409,
            "终止申请缺少合法的申请前状态，请联系管理员核查",
            "CONTRACT_TERMINATION_PREVIOUS_STATUS_INVALID",
          );
        }
        terminationRestoreStatus = contract.previous_status;
      }

      let sealApplicationApprovalChanges: Record<string, unknown> = {};
      if (
        action === "approve" &&
        round.approval_kind === "seal" &&
        round.target_source === "general_manager" &&
        contract.pending_action === "seal" &&
        contract.previous_status === "draft"
      ) {
        const signatureResult =
          await signSealApplicationApprovalByGeneralManager(client, {
            contract,
            round,
            actorId,
            actorRole,
            now,
          });
        approvalArtifact = signatureResult.artifact;
        obsoleteApplicantFilePath = signatureResult.obsoleteApplicantFilePath;
        sealApplicationApprovalChanges = signatureResult.auditChanges;
      }

      const nextStatus: ContractStatus =
        action === "reject"
          ? terminationRestoreStatus || "rejected"
          : contract.pending_action === "termination"
            ? "terminated"
            : "pending_seal";
      assertContractStatusTransition(contract.status, nextStatus);

      const result = await client.query<ContractRow>(
        `UPDATE contracts SET status = $2,
         pending_action = NULL,
         previous_status = NULL,
         approved_at = CASE WHEN $3 = 'approve' THEN $4 ELSE approved_at END,
         rejected_at = CASE
           WHEN $2 = 'rejected' THEN $4
           WHEN $3 = 'approve' THEN NULL
           ELSE rejected_at
         END,
         terminated_at = CASE WHEN $2 = 'terminated' THEN $4 ELSE terminated_at END,
         updated_by = $5, updated_at = $4, version = version + 1
       WHERE id = $1 RETURNING *`,
        [contractId, nextStatus, action, now, actorId],
      );
      await client.query(
        `UPDATE contract_approval_rounds SET status = $2,
         completed_at = $3, completed_by = $4, completed_action = $5,
         updated_at = $3
       WHERE id = $1 AND status = 'pending'`,
        [
          round.id,
          action === "approve" ? "approved" : "rejected",
          now,
          actorId,
          action,
        ],
      );
      await client.query(
        `INSERT INTO contract_approval_records (
         id, contract_id, approval_round_id, action, approver_id,
         approver_role, comment, from_status, to_status, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          nanoid(),
          contractId,
          round.id,
          action,
          actorId,
          actorRole,
          comment?.trim() || null,
          contract.status,
          nextStatus,
          now,
        ],
      );
      let sealVerificationId: string | null = null;
      if (isSealDifferenceReview) {
        const verificationResult = await client.query<{ id: string }>(
          `UPDATE contract_seal_verifications SET
           status = $2, approval_completed_at = $3, updated_at = $3
         WHERE id = (
           SELECT id FROM contract_seal_verifications
           WHERE contract_id = $1 AND status = 'difference_approving'
           ORDER BY approval_submitted_at DESC, id DESC LIMIT 1
           FOR UPDATE
         )
         RETURNING id`,
          [
            contractId,
            action === "approve"
              ? "difference_approved"
              : "difference_rejected",
            now,
          ],
        );
        sealVerificationId = verificationResult.rows[0]?.id || null;
        if (!sealVerificationId) {
          throw new ContractDomainError(
            409,
            "盖章差异复审批次不存在或已被处理",
            "SEALED_DIFFERENCE_APPROVAL_NOT_FOUND",
          );
        }
      }
      await insertAudit(client, {
        contractId,
        action: `approval_${action}`,
        actorId,
        actorRole,
        fromStatus: contract.status,
        toStatus: nextStatus,
        changes: {
          ...approvalTargetSnapshot(round),
          ...sealApplicationApprovalChanges,
          ...(terminationRestoreStatus
            ? {
                terminationRequestRejected: true,
                restoredStatus: terminationRestoreStatus,
              }
            : {}),
          ...(sealVerificationId
            ? {
                sealVerificationId,
                sealedDifferenceDecision: action,
              }
            : {}),
        },
        comment,
        now,
      });
      let rootProjectId: string | null = contract.project_id;
      if (["rejected", "terminated"].includes(nextStatus)) {
        const recalculatedRoot = await recalculateContractExecutionStatus(
          client,
          contractId,
          actorId,
          actorRole,
        );
        rootProjectId = recalculatedRoot.project_id;
      }
      const affectedProjectIds = [contract.project_id, rootProjectId]
        .filter((id): id is string => Boolean(id))
        .filter((id, index, values) => values.indexOf(id) === index)
        .sort();
      for (const affectedProjectId of affectedProjectIds) {
        await syncProjectContractTotal(client, affectedProjectId);
      }
      return result.rows[0];
    });
    await deleteObsoleteSealApplicationFile(obsoleteApplicantFilePath);
    return result;
  } catch (error) {
    cleanupApprovedContractSealApplicationArtifact(approvalArtifact);
    throw error;
  }
}

export async function requestContractTermination(
  _contractId: string,
  _actorId: string,
  _actorRole: string,
  _comment: string,
): Promise<ContractRow> {
  // 旧流程曾直接创建 `{ kind: "termination" }` 审批轮次；现已由带文件的
  // 解除协议统一走用印审批，禁止再从该入口改变原合同状态。
  throw new ContractDomainError(
    410,
    "原因式申请终止已停用，请上传解除协议书并完成审批、盖章核验和归档",
    "CONTRACT_TERMINATION_FILE_REQUIRED",
  );
}

const RENTAL_DIRECT_EXIT_SUBTYPES = new Set<ContractDeclaredSubtype>([
  "house_rental",
  "vehicle_rental",
  "parking_space",
]);

export interface ConfirmCompletedRentalExitInput {
  contractId: string;
  actorId: string;
  actorRole: string;
  expectedVersion: number;
  comment?: string | null;
}

/**
 * 已全部履约的租赁主合同可以由管理员直接确认退租或还车。该路径不生成
 * 没有文件证据的解除协议，只把根合同生命周期推进为已终止并保留独立审计。
 */
export async function confirmCompletedRentalExit(
  input: ConfirmCompletedRentalExitInput,
): Promise<ContractRow> {
  if (!CONTRACT_FINANCE_ROLES.has(input.actorRole)) {
    throw new ContractDomainError(
      403,
      "只有合同管理员可以确认退租或还车",
      "CONTRACT_RENTAL_EXIT_ADMIN_ONLY",
    );
  }
  const comment = input.comment?.normalize("NFKC").trim() || null;
  if (comment && comment.length > 500) {
    throw new ContractDomainError(
      400,
      "退租或还车备注不能超过500个字符",
      "CONTRACT_RENTAL_EXIT_COMMENT_TOO_LONG",
    );
  }

  return db.transaction(async (client) => {
    const reference = await client.query<{
      id: string;
      root_contract_id: string | null;
    }>(
      `SELECT id, root_contract_id FROM contracts
       WHERE id = $1 AND is_deleted = FALSE`,
      [input.contractId],
    );
    const referenced = reference.rows[0];
    if (!referenced) {
      throw new ContractDomainError(404, "合同不存在", "CONTRACT_NOT_FOUND");
    }
    const rootId = referenced.root_contract_id || referenced.id;
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended('contract-root-approval:' || $1, 0)
       )`,
      [rootId],
    );
    const contract = await getLockedContract(client, input.contractId);
    assertContractVersion(contract, input.expectedVersion);
    if (
      contract.id !== rootId ||
      contract.relation_type !== "main" ||
      contract.root_contract_id !== contract.id
    ) {
      throw new ContractDomainError(
        409,
        "只能从租赁主合同确认退租或还车",
        "CONTRACT_RENTAL_EXIT_MAIN_REQUIRED",
      );
    }
    if (
      contract.category !== "asset" ||
      !contract.declared_subtype ||
      !RENTAL_DIRECT_EXIT_SUBTYPES.has(contract.declared_subtype) ||
      !contract.lease_end_date
    ) {
      throw new ContractDomainError(
        409,
        "当前合同不是具有可信到期日的房屋、汽车或车位租赁合同",
        "CONTRACT_RENTAL_EXIT_TARGET_REQUIRED",
      );
    }
    if (!["effective", "executing", "completed"].includes(contract.status)) {
      throw new ContractDomainError(
        409,
        contract.status === "terminated"
          ? "当前租赁合同已经退租或还车"
          : "只有已生效、执行中或已完成的租赁合同可以办理退租或还车",
        "CONTRACT_RENTAL_EXIT_STATUS_FORBIDDEN",
      );
    }

    const unfinishedChild = await client.query<{ id: string }>(
      `SELECT id FROM contracts
       WHERE root_contract_id = $1 AND id <> $1 AND is_deleted = FALSE
         AND relation_type IN ('supplement', 'termination')
         AND status IN ('draft', 'approving', 'pending_seal')
       ORDER BY created_at, id LIMIT 1`,
      [rootId],
    );
    if (unfinishedChild.rows[0]) {
      throw new ContractDomainError(
        409,
        "当前合同已有补充、续签或退租／还车协议正在办理，请先处理完成",
        "CONTRACT_RENTAL_EXIT_PENDING_CHILD",
      );
    }

    const renewalSuccessor = await client.query<{ id: string }>(
      `SELECT id FROM contracts
       WHERE renewed_from_contract_id = $1 AND is_deleted = FALSE
         AND status <> 'rejected'
       ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [rootId],
    );
    if (renewalSuccessor.rows[0]) {
      throw new ContractDomainError(
        409,
        "当前合同已有续签合同，不能再从原合同退租或还车",
        "CONTRACT_RENEWAL_SUCCESSOR_EXISTS",
      );
    }

    const pendingFinancial = await client.query<{ source: string }>(
      `SELECT pending.source FROM (
         SELECT 'registration'::text AS source
         FROM contract_financial_registrations registration
         JOIN contracts linked ON linked.id = registration.contract_id
         WHERE COALESCE(linked.root_contract_id, linked.id) = $1
           AND registration.status = 'draft'
         UNION ALL
         SELECT 'invoice'::text AS source
         FROM contract_invoices record
         JOIN contracts linked ON linked.id = record.contract_id
         WHERE COALESCE(linked.root_contract_id, linked.id) = $1
           AND record.status = 'draft'
         UNION ALL
         SELECT 'receipt'::text AS source
         FROM contract_receipts record
         JOIN contracts linked ON linked.id = record.contract_id
         WHERE COALESCE(linked.root_contract_id, linked.id) = $1
           AND record.status = 'draft'
         UNION ALL
         SELECT 'payment'::text AS source
         FROM contract_payments record
         JOIN contracts linked ON linked.id = record.contract_id
         WHERE COALESCE(linked.root_contract_id, linked.id) = $1
           AND record.status = 'draft'
         UNION ALL
         SELECT 'external_payment'::text AS source
         FROM contract_external_payments record
         JOIN contracts linked ON linked.id = record.contract_id
         WHERE COALESCE(linked.root_contract_id, linked.id) = $1
           AND record.status = 'draft'
       ) AS pending
       LIMIT 1`,
      [rootId],
    );
    if (pendingFinancial.rows[0]) {
      throw new ContractDomainError(
        409,
        "当前合同仍有未完成的财务草稿，请先处理后再确认退租或还车",
        "CONTRACT_RENTAL_EXIT_PENDING_FINANCIAL",
      );
    }

    const snapshot = await calculateTerminationSettlementSnapshot(
      client,
      contract.id,
      null,
      true,
    );
    const currentAmountCents = toCents(snapshot.currentEffectiveAmount);
    const settledAmountCents = toCents(snapshot.settledAmount);
    if (currentAmountCents <= 0) {
      throw new ContractDomainError(
        409,
        "租赁合同当前有效金额无效，不能直接退租或还车",
        "CONTRACT_RENTAL_EXIT_AMOUNT_INVALID",
      );
    }
    if (settledAmountCents < currentAmountCents) {
      throw new ContractDomainError(
        409,
        "租赁合同尚未全部履约，请上传解除协议办理退租或还车",
        "CONTRACT_RENTAL_EXIT_AGREEMENT_REQUIRED",
      );
    }
    // 超额结算会在 calculateTerminationSettlementSnapshot 中以独立错误阻断；
    // 这里仍坚持整数分严格相等，不允许用大于等于100%代替已全部履约。
    if (settledAmountCents !== currentAmountCents) {
      throw new ContractDomainError(
        409,
        "已确认履约金额超过当前有效合同金额，请先处理超额结算",
        "CONTRACT_RENTAL_EXIT_SETTLEMENT_EXCEEDS_AMOUNT",
      );
    }

    assertContractStatusTransition(contract.status, "terminated");
    const now = new Date().toISOString();
    const operation =
      contract.declared_subtype === "vehicle_rental"
        ? "vehicle_return"
        : "lease_vacate";
    const updated = await client.query<ContractRow>(
      `UPDATE contracts SET status = 'terminated', terminated_at = $2,
         current_effective_amount = $3, pending_action = NULL,
         previous_status = NULL, updated_by = $4, updated_at = $2,
         version = version + 1
       WHERE id = $1 AND version = $5 RETURNING *`,
      [
        contract.id,
        now,
        snapshot.settledAmount,
        input.actorId,
        input.expectedVersion,
      ],
    );
    if (!updated.rows[0]) {
      throw new ContractDomainError(
        409,
        "合同已被其他用户修改，请刷新后重试",
        "VERSION_CONFLICT",
      );
    }
    await insertAudit(client, {
      contractId: contract.id,
      action: "rental_direct_exit_confirmed",
      actorId: input.actorId,
      actorRole: input.actorRole,
      fromStatus: contract.status,
      toStatus: "terminated",
      changes: {
        operation,
        withoutTerminationAgreement: true,
        leaseEndDate: contract.lease_end_date,
        currentEffectiveAmount: snapshot.currentEffectiveAmount,
        settledAmount: snapshot.settledAmount,
        unperformedAmount: snapshot.unperformedAmount,
        completionRate: 100,
      },
      comment,
      now,
    });
    await syncProjectContractTotal(client, contract.project_id);
    return updated.rows[0];
  });
}

export type FinancialRecordKind = "invoice" | "receipt" | "payment";
type FinancialStoredRecordKind = FinancialRecordKind | "external_payment";
export type FinancialRecordStatus = "draft" | "confirmed" | "reversed";

function financialTable(kind: FinancialStoredRecordKind): string {
  return {
    invoice: "contract_invoices",
    receipt: "contract_receipts",
    payment: "contract_payments",
    external_payment: "contract_external_payments",
  }[kind];
}

interface LockedFinancialRecord {
  contract_id: string;
  file_id: string | null;
  file_path: string | null;
  amount: string | number;
  status: FinancialRecordStatus;
  financial_ocr_job_id: string | null;
  financial_ocr_status: string | null;
  financial_validation_status: string | null;
  financial_document_status: string | null;
  financial_direction: string | null;
  financial_can_auto_post: boolean | null;
  invoice_seller: string | null;
  settlement_payee: string | null;
}

interface FinancialArtifactToDelete {
  fileId: string | null;
  ocrJobId: string | null;
  filePath: string | null;
}

interface LockedFinancialOcrUpload {
  id: string;
  contract_id: string;
  file_id: string;
  file_path: string | null;
  file_hash: string;
  record_kind: FinancialRecordKind;
  status: string;
  record_id: string | null;
  business_purpose: string | null;
}

async function hardDeleteFinancialArtifacts(
  client: PoolClient,
  artifacts: readonly FinancialArtifactToDelete[],
): Promise<void> {
  const fileIds = [
    ...new Set(
      artifacts
        .map((artifact) => artifact.fileId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const ocrJobIds = [
    ...new Set(
      artifacts
        .map((artifact) => artifact.ocrJobId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (fileIds.length) {
    await client.query(
      `DELETE FROM contract_financial_file_hashes WHERE file_id = ANY($1::text[])`,
      [fileIds],
    );
  }
  if (ocrJobIds.length) {
    await client.query(
      `DELETE FROM contract_financial_ocr_jobs WHERE id = ANY($1::text[])`,
      [ocrJobIds],
    );
  }
  if (fileIds.length) {
    await client.query(
      `DELETE FROM contract_files WHERE id = ANY($1::text[])`,
      [fileIds],
    );
  }
}

interface LockedFinancialRegistration {
  id: string;
  contract_id: string;
  settlement_kind: "receipt" | "payment";
  financial_direction: "income" | "cost" | null;
  direction_invoice_record_id: string | null;
  invoice_ocr_job_id: string | null;
  bank_ocr_job_id: string | null;
  invoice_record_id: string | null;
  receipt_record_id: string | null;
  payment_record_id: string | null;
  status: FinancialRecordStatus;
}

interface LockedFinancialRegistrationItem {
  item_kind: FinancialStoredRecordKind;
  ocr_job_id: string;
  record_id: string;
}

async function getLockedFinancialRegistration(
  client: PoolClient,
  registrationId: string,
): Promise<LockedFinancialRegistration> {
  const result = await client.query<LockedFinancialRegistration>(
    `SELECT * FROM contract_financial_registrations
     WHERE id = $1 FOR UPDATE`,
    [registrationId],
  );
  const registration = result.rows[0];
  if (!registration) {
    throw new ContractDomainError(404, "财务登记不存在");
  }
  return registration;
}

async function getLockedFinancialRegistrationItems(
  client: PoolClient,
  registration: LockedFinancialRegistration,
): Promise<LockedFinancialRegistrationItem[]> {
  const result = await client.query<LockedFinancialRegistrationItem>(
    `SELECT item_kind, ocr_job_id, record_id
     FROM contract_financial_registration_items
     WHERE registration_id = $1
     ORDER BY item_kind, created_at, id
     FOR UPDATE`,
    [registration.id],
  );
  if (result.rows.length) return result.rows;
  const settlementRecordId =
    registration.settlement_kind === "receipt"
      ? registration.receipt_record_id
      : registration.payment_record_id;
  if (!settlementRecordId || !registration.bank_ocr_job_id) {
    throw new ContractDomainError(
      500,
      "财务登记结算记录缺失",
      "FINANCIAL_REGISTRATION_INTEGRITY_ERROR",
    );
  }
  if (!registration.invoice_ocr_job_id || !registration.invoice_record_id) {
    throw new ContractDomainError(
      500,
      "财务登记发票记录缺失",
      "FINANCIAL_REGISTRATION_INTEGRITY_ERROR",
    );
  }
  return [
    {
      item_kind: "invoice",
      ocr_job_id: registration.invoice_ocr_job_id,
      record_id: registration.invoice_record_id,
    },
    {
      item_kind: registration.settlement_kind,
      ocr_job_id: registration.bank_ocr_job_id,
      record_id: settlementRecordId,
    },
  ];
}

async function assertFinancialRecordNotPaired(
  client: PoolClient,
  kind: FinancialStoredRecordKind,
  recordId: string,
): Promise<void> {
  const column =
    kind === "invoice"
      ? "invoice_record_id"
      : kind === "receipt"
        ? "receipt_record_id"
        : "payment_record_id";
  const paired = await client.query<{ id: string }>(
    `SELECT registration.id
     FROM contract_financial_registrations registration
     LEFT JOIN contract_financial_registration_items item
       ON item.registration_id = registration.id
     WHERE registration.${column} = $1 OR item.record_id = $1
     LIMIT 1`,
    [recordId],
  );
  if (paired.rows[0]) {
    throw new ContractDomainError(
      409,
      "该记录属于发票与回单成对登记，请按整组操作",
      "FINANCIAL_REGISTRATION_GROUP_REQUIRED",
    );
  }
}

async function getLockedFinancialRecord(
  client: PoolClient,
  kind: FinancialStoredRecordKind,
  recordId: string,
): Promise<LockedFinancialRecord> {
  const result = await client.query<LockedFinancialRecord>(
    `SELECT record.contract_id, record.file_id, record.amount, record.status,
       file.file_path,
       ${kind === "invoice" ? "record.seller" : "NULL::text"} AS invoice_seller,
       ${kind === "receipt" ? "record.payee" : "NULL::text"} AS settlement_payee,
       record.financial_ocr_job_id,
       financial_ocr.status AS financial_ocr_status,
       financial_ocr.validation_status AS financial_validation_status,
       financial_ocr.document_status AS financial_document_status,
       financial_ocr.direction AS financial_direction,
       financial_ocr.can_auto_post AS financial_can_auto_post
     FROM ${financialTable(kind)} AS record
     LEFT JOIN contract_files AS file ON file.id = record.file_id
     LEFT JOIN contract_financial_ocr_jobs AS financial_ocr
       ON financial_ocr.id = record.financial_ocr_job_id
     WHERE record.id = $1
     FOR UPDATE OF record`,
    [recordId],
  );
  const record = result.rows[0];
  if (!record) throw new ContractDomainError(404, "财务记录不存在");
  return record;
}

async function assertFinancialRecordContractGroup(
  client: PoolClient,
  recordContractId: string,
  expectedContractId?: string,
): Promise<void> {
  if (!expectedContractId) return;
  const contractGroups = await client.query<{
    id: string;
    root_id: string;
  }>(
    `SELECT id, COALESCE(root_contract_id, id) AS root_id
     FROM contracts
     WHERE id = ANY($1::text[]) AND is_deleted = FALSE`,
    [[recordContractId, expectedContractId]],
  );
  const roots = new Map(
    contractGroups.rows.map((contract) => [contract.id, contract.root_id]),
  );
  if (
    !roots.get(recordContractId) ||
    roots.get(recordContractId) !== roots.get(expectedContractId)
  ) {
    throw new ContractDomainError(404, "财务记录不属于当前合同组");
  }
}

/** 在财务记录新增或冲正后重算合同执行状态。调用方必须处于事务中。 */
export async function recalculateContractExecutionStatus(
  client: PoolClient,
  contractId: string,
  actorId: string,
  actorRole: string,
  forceExecutingAfterReverse = false,
): Promise<ContractRow> {
  const targetContract = await getLockedContract(client, contractId);
  const rootId = targetContract.root_contract_id || targetContract.id;
  const contract =
    rootId === targetContract.id
      ? targetContract
      : await getLockedContract(client, rootId);
  const pendingTermination = await client.query<{ id: string }>(
    `SELECT id FROM contracts
     WHERE root_contract_id = $1 AND relation_type = 'termination'
       AND is_deleted = FALSE AND status IN ('approving', 'pending_seal')
     ORDER BY created_at, id LIMIT 1`,
    [rootId],
  );
  if (pendingTermination.rows[0]) {
    throw new ContractDomainError(
      409,
      "解除协议已进入审批或盖章流程，期间不能确认、冲正或新增财务记录",
      "FINANCIAL_RECORD_TERMINATION_PENDING",
    );
  }
  if (!["effective", "executing", "completed"].includes(contract.status)) {
    return contract;
  }
  const totals = await client.query<{
    contract_total: string | number;
    invoice_count: number;
    invoice_total: string | number;
    receipt_total: string | number;
    payment_total: string | number;
    external_payment_total: string | number;
    cost_settlement_total: string | number;
  }>(
    `SELECT
       COALESCE(
         root.current_effective_amount,
         root.original_contract_amount,
         root.amount_delta,
         0
       )::text AS contract_total,
       COALESCE((SELECT COUNT(*) FROM contract_invoices i
         JOIN contracts c ON c.id = i.contract_id
         WHERE COALESCE(c.root_contract_id, c.id) = $1
           AND c.status <> 'rejected' AND i.status = 'confirmed'), 0) AS invoice_count,
       COALESCE((SELECT SUM(i.amount) FROM contract_invoices i
         JOIN contracts c ON c.id = i.contract_id
         WHERE COALESCE(c.root_contract_id, c.id) = $1
           AND c.status <> 'rejected' AND i.status = 'confirmed'), 0)::text AS invoice_total,
       COALESCE((SELECT SUM(r.amount) FROM contract_receipts r
         JOIN contracts c ON c.id = r.contract_id
         WHERE COALESCE(c.root_contract_id, c.id) = $1
           AND c.status <> 'rejected' AND r.status = 'confirmed'), 0)::text AS receipt_total,
       COALESCE((SELECT SUM(p.amount) FROM contract_payments p
         JOIN contracts c ON c.id = p.contract_id
         WHERE COALESCE(c.root_contract_id, c.id) = $1
           AND c.status <> 'rejected' AND p.status = 'confirmed'), 0)::text AS payment_total,
       COALESCE((SELECT SUM(p.amount) FROM contract_external_payments p
         JOIN contracts c ON c.id = p.contract_id
         WHERE COALESCE(c.root_contract_id, c.id) = $1
           AND c.status <> 'rejected' AND p.status = 'confirmed'), 0)::text AS external_payment_total,
       ${contractCostSettlementAmountSql({
         rootAlias: "root",
         rootIdExpression: "root.id",
       })}::text AS cost_settlement_total
     FROM contracts root
     WHERE root.id = $1 AND root.is_deleted = FALSE`,
    [rootId],
  );
  const summary = totals.rows[0];
  const contractTotalCents = toCents(String(summary?.contract_total || 0));
  const invoiceTotalCents = toCents(String(summary?.invoice_total || 0));
  const receiptTotalCents = toCents(String(summary?.receipt_total || 0));
  const paymentTotalCents = toCents(String(summary?.payment_total || 0));
  const externalPaymentTotalCents = toCents(
    String(summary?.external_payment_total || 0),
  );
  const costSettlementTotalCents = toCents(
    String(
      summary?.cost_settlement_total ??
        (contract.asset_funding_mode === "engineering_to_technology"
          ? summary?.external_payment_total
          : summary?.payment_total) ??
        0,
    ),
  );
  if (!contract.financial_direction) return contract;
  const settlementTotalCents =
    contract.financial_direction === "cost"
      ? costSettlementTotalCents
      : receiptTotalCents;
  const hasActivity =
    Number(summary?.invoice_count || 0) > 0 ||
    invoiceTotalCents > 0 ||
    receiptTotalCents > 0 ||
    paymentTotalCents > 0 ||
    externalPaymentTotalCents > 0;
  const nextStatus: ContractStatus =
    contractTotalCents > 0 && settlementTotalCents >= contractTotalCents
      ? "completed"
      : hasActivity ||
          (forceExecutingAfterReverse &&
            ["executing", "completed"].includes(contract.status))
        ? "executing"
        : "effective";
  if (nextStatus === contract.status) return contract;
  assertContractStatusTransition(contract.status, nextStatus);
  const now = new Date().toISOString();
  const result = await client.query<ContractRow>(
    `UPDATE contracts SET status = $2,
       executing_at = CASE WHEN $2 = 'executing' AND executing_at IS NULL THEN $3 ELSE executing_at END,
       completed_at = CASE WHEN $2 = 'completed' THEN $3 ELSE NULL END,
       updated_by = $4, updated_at = $3, version = version + 1
     WHERE id = $1 RETURNING *`,
    [contract.id, nextStatus, now, actorId],
  );
  await insertAudit(client, {
    contractId: contract.id,
    action: "financial_status_recalculated",
    actorId,
    actorRole,
    fromStatus: contract.status,
    toStatus: nextStatus,
    changes: {
      contractTotal: centsToAmount(contractTotalCents),
      settlementTotal: centsToAmount(settlementTotalCents),
    },
    now,
  });
  return result.rows[0];
}

export interface RebuiltContractFinancialMatches {
  invoiceRecordIds: string[];
  settlementRecordIds: string[];
  invoiceTotalCents: number;
  settlementTotalCents: number;
  allocatedTotalCents: number;
  directionInvoiceRecordId: string | null;
  matches: Array<{
    invoiceRecordId: string;
    settlementRecordId: string;
    allocatedAmount: number;
  }>;
}

/**
 * 重新按当前全部发票和银行凭证计算可覆盖金额。
 *
 * 该函数允许“先回款、后补发票”及“先开票、后分期回款”，因此只为两侧
 * 已经实际存在的重叠金额生成对应关系，剩余差额继续保留在原财务登记中。
 */
export async function rebuildContractFinancialRegistrationMatches(
  client: PoolClient,
  input: {
    registrationId: string;
    contractId: string;
    settlementKind: "receipt" | "payment";
    now: string;
  },
): Promise<RebuiltContractFinancialMatches> {
  const settlementTable = financialTable(input.settlementKind);
  const settlementAmountSql =
    input.settlementKind === "payment"
      ? `(record.amount - COALESCE((
           SELECT SUM(detail.amount)
           FROM contract_payment_purpose_details detail
           WHERE detail.payment_record_id=record.id
             AND detail.purpose='lease_deposit'
         ),CASE WHEN EXISTS(
           SELECT 1 FROM contract_payment_purpose_details purpose
           WHERE purpose.payment_record_id=record.id
         ) THEN 0 ELSE (
           SELECT SUM(receipt.confirmed_amount)
           FROM contract_payment_deposit_receipts receipt
           WHERE receipt.payment_record_id=record.id
             AND receipt.status='confirmed'
         ) END,0))`
      : "record.amount";
  const settlementItems = await client.query<{
    item_id: string;
    record_id: string;
    amount: string | number;
  }>(
    `SELECT item.id AS item_id,item.record_id,
         ${settlementAmountSql} AS amount
       FROM contract_financial_registration_items item
       JOIN ${settlementTable} record ON record.id = item.record_id
      WHERE item.registration_id = $1 AND item.contract_id = $2
        AND item.item_kind = $3 AND record.status <> 'reversed'
      ORDER BY item.created_at, item.id
      FOR UPDATE OF item, record`,
    [input.registrationId, input.contractId, input.settlementKind],
  );
  const invoiceItems = await client.query<{
    item_id: string;
    record_id: string;
    amount: string | number;
  }>(
    `SELECT item.id AS item_id, item.record_id, invoice.amount
       FROM contract_financial_registration_items item
       JOIN contract_invoices invoice ON invoice.id = item.record_id
      WHERE item.registration_id = $1 AND item.contract_id = $2
        AND item.item_kind = 'invoice' AND invoice.status <> 'reversed'
      ORDER BY item.created_at, item.id
      FOR UPDATE OF item, invoice`,
    [input.registrationId, input.contractId],
  );
  await client.query(
    `DELETE FROM contract_financial_registration_matches match
      USING contract_financial_registration_items settlement
      WHERE match.registration_id = $1
        AND settlement.id = match.settlement_item_id
        AND settlement.item_kind = $2`,
    [input.registrationId, input.settlementKind],
  );
  const allocatableSettlementItems = settlementItems.rows.filter(
    (item) => toCents(item.amount) > 0,
  );
  const allocations = allocateAvailableContractFinancialAmounts(
    invoiceItems.rows.map((item) => Number(item.amount)),
    allocatableSettlementItems.map((item) => Number(item.amount)),
  );
  const matches = allocations.map((allocation) => ({
    invoiceRecordId: invoiceItems.rows[allocation.invoiceIndex]!.record_id,
    settlementRecordId:
      allocatableSettlementItems[allocation.settlementIndex]!.record_id,
    allocatedAmount: allocation.allocatedAmount,
  }));
  for (const allocation of allocations) {
    await client.query(
      `INSERT INTO contract_financial_registration_matches(
         id, registration_id, contract_id, invoice_item_id,
         settlement_item_id, allocated_amount, created_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        nanoid(),
        input.registrationId,
        input.contractId,
        invoiceItems.rows[allocation.invoiceIndex]!.item_id,
        allocatableSettlementItems[allocation.settlementIndex]!.item_id,
        allocation.allocatedAmount,
        input.now,
      ],
    );
  }
  const invoiceTotalCents = invoiceItems.rows.reduce(
    (sum, item) => sum + toCents(item.amount),
    0,
  );
  const settlementTotalCents = settlementItems.rows.reduce(
    (sum, item) => sum + toCents(item.amount),
    0,
  );
  const allocatedTotalCents = allocations.reduce(
    (sum, allocation) => sum + toCents(allocation.allocatedAmount),
    0,
  );
  return {
    invoiceRecordIds: invoiceItems.rows.map((item) => item.record_id),
    settlementRecordIds: settlementItems.rows.map((item) => item.record_id),
    invoiceTotalCents,
    settlementTotalCents,
    allocatedTotalCents,
    directionInvoiceRecordId: invoiceItems.rows[0]?.record_id || null,
    matches,
  };
}

async function invoiceRequiredSettlementAmountCents(
  client: PoolClient,
  input: {
    itemKind: FinancialStoredRecordKind;
    recordId: string;
    amount: string | number;
  },
): Promise<number> {
  const grossCents = toCents(input.amount);
  if (input.itemKind !== "payment" && input.itemKind !== "external_payment") {
    return grossCents;
  }
  const recordColumn =
    input.itemKind === "external_payment"
      ? "external_payment_record_id"
      : "payment_record_id";
  const result = await client.query<{ deposit_amount: string | number }>(
    `SELECT COALESCE((
       SELECT SUM(detail.amount)
       FROM contract_payment_purpose_details detail
       WHERE detail.${recordColumn}=$1 AND detail.purpose='lease_deposit'
     ),CASE WHEN EXISTS(
       SELECT 1 FROM contract_payment_purpose_details purpose
       WHERE purpose.${recordColumn}=$1
     ) THEN 0 ELSE (
       SELECT SUM(receipt.confirmed_amount)
       FROM contract_payment_deposit_receipts receipt
       WHERE receipt.${recordColumn}=$1 AND receipt.status='confirmed'
     ) END,0) AS deposit_amount`,
    [input.recordId],
  );
  return Math.max(0, grossCents - toCents(result.rows[0]?.deposit_amount || 0));
}

export interface PostContractFinancialSettlementsInput {
  contractId: string;
  registrationId: string;
  settlementKind: "receipt" | "payment";
  settlementRecordIds: readonly string[];
  financialDirection: "income" | "cost";
  directionInvoiceRecordId: string | null;
  allowUnallocatedSettlement?: boolean;
  actorId: string;
  actorRole: string;
  now: string;
}

/**
 * 银行结算凭证一经服务端验证并保存，即作为真实收付款事实入账。登记批次仍
 * 保持草稿，直到发票、结算凭证及对应金额完全闭合后再确认整笔登记。
 */
export async function postContractFinancialSettlements(
  client: PoolClient,
  input: PostContractFinancialSettlementsInput,
): Promise<ContractRow> {
  if (
    (input.financialDirection === "income" &&
      input.settlementKind !== "receipt") ||
    (input.financialDirection === "cost" && input.settlementKind !== "payment")
  ) {
    throw new ContractDomainError(
      409,
      "财务登记方向与银行结算凭证类型不一致",
      "FINANCIAL_DIRECTION_CONFLICT",
    );
  }
  const settlementRecordIds = [
    ...new Set(input.settlementRecordIds.filter(Boolean)),
  ];
  if (!settlementRecordIds.length) {
    throw new ContractDomainError(400, "必须至少提供一张银行结算凭证");
  }
  const registration = await getLockedFinancialRegistration(
    client,
    input.registrationId,
  );
  if (
    registration.contract_id !== input.contractId ||
    registration.status !== "draft" ||
    registration.settlement_kind !== input.settlementKind ||
    registration.financial_direction !== input.financialDirection ||
    (registration.direction_invoice_record_id || null) !==
      (input.directionInvoiceRecordId || null)
  ) {
    throw new ContractDomainError(
      409,
      "财务登记上下文已变化，不能入账本批银行凭证",
      "FINANCIAL_REGISTRATION_CONTEXT_CHANGED",
    );
  }
  const settlementTable = financialTable(input.settlementKind);
  const registeredItems = await client.query<{
    record_id: string;
    amount: string | number;
    allocated_amount: string | number;
    payer: string | null;
    payee: string | null;
  }>(
    `SELECT item.record_id,record.amount,record.payer,record.payee,
       COALESCE((
         SELECT SUM(match.allocated_amount)
         FROM contract_financial_registration_matches match
         WHERE match.registration_id = item.registration_id
           AND match.settlement_item_id = item.id
       ), 0)::text AS allocated_amount
     FROM contract_financial_registration_items item
     JOIN ${settlementTable} record ON record.id = item.record_id
     WHERE item.registration_id = $1 AND item.item_kind = $2
       AND item.record_id = ANY($3::text[])
     ORDER BY item.record_id
     FOR UPDATE OF item, record`,
    [input.registrationId, input.settlementKind, settlementRecordIds],
  );
  if (
    new Set(registeredItems.rows.map((item) => item.record_id)).size !==
    settlementRecordIds.length
  ) {
    throw new ContractDomainError(
      409,
      "银行结算凭证不完整或不属于当前财务登记",
      "FINANCIAL_REGISTRATION_INTEGRITY_ERROR",
    );
  }
  if (
    !input.allowUnallocatedSettlement &&
    registeredItems.rows.some(
      (item) => toCents(item.amount) !== toCents(item.allocated_amount),
    )
  ) {
    throw new ContractDomainError(
      409,
      "银行结算凭证尚未完整分配到发票，不能入账",
      "FINANCIAL_REGISTRATION_MATCH_AMOUNT_MISMATCH",
    );
  }
  const target = await getLockedContract(client, input.contractId);
  const rootId = target.root_contract_id || target.id;
  const root =
    rootId === target.id ? target : await getLockedContract(client, rootId);
  const rootCategory = root.declared_category || root.category;
  if (!rootCategory) {
    throw new ContractDomainError(
      409,
      "合同分类尚未完成，不能确定收入或支出方向",
      "FINANCIAL_CONTRACT_CATEGORY_REQUIRED",
    );
  }
  const internalFundingContractSubject = resolveContractFinancialCompanySubject(
    [root.party_a, root.party_b],
    CONTRACT_COMPANY_SUBJECTS,
  );
  const allowsEngineeringInternalFunding =
    rootCategory === "asset" &&
    root.asset_funding_mode === "engineering_to_technology" &&
    input.financialDirection === "cost" &&
    input.settlementKind === "payment" &&
    Boolean(internalFundingContractSubject) &&
    registeredItems.rows.every(
      (item) =>
        normalizeContractPartyIdentity(item.payer || "") ===
          normalizeContractPartyIdentity("北京羽隶工程咨询有限公司") &&
        normalizeContractPartyIdentity(item.payee || "") ===
          normalizeContractPartyIdentity(
            internalFundingContractSubject?.name || "",
          ),
    );
  if (
    input.allowUnallocatedSettlement &&
    !(
      (rootCategory === "main_business" &&
        input.financialDirection === "income" &&
        input.settlementKind === "receipt") ||
      allowsEngineeringInternalFunding
    )
  ) {
    throw new ContractDomainError(
      409,
      "只有主营实际回款或工程咨询向签约公司的内部划拨可以未分配发票先行入账",
      "FINANCIAL_REGISTRATION_MATCH_AMOUNT_MISMATCH",
    );
  }
  const categoryDirection =
    financialDirectionFromContractCategory(rootCategory);
  if (input.financialDirection !== categoryDirection) {
    throw new ContractDomainError(
      409,
      rootCategory === "asset"
        ? "资产类合同只能登记支出凭证"
        : "主营和非主营合同只能登记收入凭证",
      "FINANCIAL_DIRECTION_CONFLICT",
    );
  }
  if (
    root.financial_direction &&
    root.financial_direction !== categoryDirection
  ) {
    throw new ContractDomainError(
      409,
      "本次发票方向与合同类型规定的收支方向不一致",
      "FINANCIAL_DIRECTION_CONFLICT",
    );
  }
  if (!root.financial_direction) {
    await client.query(
      `UPDATE contracts SET financial_direction = $2,
         financial_direction_source = 'contract_category',
         financial_direction_invoice_id = NULL,
         financial_direction_confirmed_by = NULL,
         financial_direction_confirmed_at = NULL,
         financial_direction_version = financial_direction_version + 1,
         updated_by = $3, updated_at = $4, version = version + 1
       WHERE id = $1`,
      [rootId, categoryDirection, input.actorId, input.now],
    );
  }
  let postedResult: { rows: Array<{ id: string }> };
  if (input.settlementKind === "receipt") {
    postedResult = await client.query<{ id: string }>(
      `UPDATE contract_receipts AS receipt
       SET status = 'confirmed',
         confirmed_by = COALESCE(receipt.confirmed_by, $3),
         confirmed_at = COALESCE(receipt.confirmed_at, $4),
         updated_at = $4,
         rate_snapshot_json = COALESCE(receipt.rate_snapshot_json, (
           SELECT JSONB_OBJECT_AGG(latest.rate_code, latest.rate_value)
           FROM (
             SELECT DISTINCT ON (rate.rate_code)
               rate.rate_code, rate.rate_value
             FROM contract_rate_configs AS rate
             WHERE rate.is_active = TRUE
               AND LEFT(rate.effective_from, 10) <= receipt.receipt_date
               AND (
                 rate.effective_to IS NULL
                 OR LEFT(rate.effective_to, 10) > receipt.receipt_date
               )
             ORDER BY rate.rate_code, rate.effective_from DESC
           ) AS latest
         ))
       WHERE receipt.id = ANY($1::text[]) AND receipt.contract_id = $2
         AND receipt.status IN ('draft', 'confirmed')
       RETURNING receipt.id`,
      [settlementRecordIds, input.contractId, input.actorId, input.now],
    );
  } else {
    postedResult = await client.query<{ id: string }>(
      `UPDATE contract_payments AS payment
       SET status = 'confirmed',
         confirmed_by = COALESCE(payment.confirmed_by, $3),
         confirmed_at = COALESCE(payment.confirmed_at, $4),
         updated_at = $4
       WHERE payment.id = ANY($1::text[]) AND payment.contract_id = $2
         AND payment.status IN ('draft', 'confirmed')
       RETURNING payment.id`,
      [settlementRecordIds, input.contractId, input.actorId, input.now],
    );
  }
  if (
    new Set(postedResult.rows.map((record) => record.id)).size !==
    settlementRecordIds.length
  ) {
    throw new ContractDomainError(
      409,
      "银行结算凭证状态已变化，不能完成入账",
      "FINANCIAL_REGISTRATION_STATUS_MISMATCH",
    );
  }
  await insertAudit(client, {
    contractId: input.contractId,
    action: "financial_settlements_posted",
    actorId: input.actorId,
    actorRole: input.actorRole,
    changes: {
      registrationId: input.registrationId,
      settlementKind: input.settlementKind,
      settlementRecordIds,
      financialDirection: input.financialDirection,
      directionInvoiceRecordId: input.directionInvoiceRecordId,
    },
    now: input.now,
  });
  const updated = await recalculateContractExecutionStatus(
    client,
    input.contractId,
    input.actorId,
    input.actorRole,
  );
  await syncProjectContractTotal(client, updated.project_id);
  return updated;
}

export interface LegacyFinancialSettlementBackfillResult {
  postedRegistrationCount: number;
  postedSettlementCount: number;
  skippedRegistrationIds: string[];
}

/**
 * 兼容即时入账规则上线前已经保存的部分回款／付款登记。只处理仍为草稿、
 * 识别验证链完整、银行凭证仍为草稿且对应金额完整覆盖的登记；不可靠记录
 * 保持原状并交由财务核查。函数幂等，已入账凭证不会再次命中。
 */
export async function backfillLegacyPostedContractFinancialSettlements(): Promise<LegacyFinancialSettlementBackfillResult> {
  const candidates = await db.all<{
    registration_id: string;
    contract_id: string;
    settlement_kind: "receipt" | "payment";
    financial_direction: "income" | "cost";
    direction_invoice_record_id: string;
    actor_id: string;
    actor_role: string;
  }>(
    `SELECT registration.id AS registration_id,
       registration.contract_id, registration.settlement_kind,
       registration.financial_direction,
       registration.direction_invoice_record_id,
       registration.created_by AS actor_id,
       COALESCE(creator.role, 'admin') AS actor_role
     FROM contract_financial_registrations registration
     LEFT JOIN users creator ON creator.id = registration.created_by
     WHERE registration.status = 'draft'
       AND registration.financial_direction IN ('income', 'cost')
       AND registration.direction_invoice_record_id IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM contract_financial_registration_items item
         LEFT JOIN contract_receipts receipt
           ON item.item_kind = 'receipt' AND receipt.id = item.record_id
         LEFT JOIN contract_payments payment
           ON item.item_kind = 'payment' AND payment.id = item.record_id
         WHERE item.registration_id = registration.id
           AND item.item_kind = registration.settlement_kind
           AND COALESCE(receipt.status, payment.status) = 'draft'
       )
     ORDER BY registration.created_at, registration.id`,
  );
  const result: LegacyFinancialSettlementBackfillResult = {
    postedRegistrationCount: 0,
    postedSettlementCount: 0,
    skippedRegistrationIds: [],
  };
  for (const candidate of candidates) {
    try {
      const postedCount = await db.transaction(async (client) => {
        const evidence = await client.query<{
          record_id: string;
          record_status: string;
          job_status: string;
          validation_status: string | null;
          document_status: string | null;
          direction: string | null;
          can_auto_post: boolean | null;
        }>(
          `SELECT item.record_id,
             COALESCE(receipt.status, payment.status) AS record_status,
             job.status AS job_status,
             job.validation_status, job.document_status,
             job.direction, job.can_auto_post
           FROM contract_financial_registration_items item
           JOIN contract_financial_ocr_jobs job ON job.id = item.ocr_job_id
           LEFT JOIN contract_receipts receipt
             ON item.item_kind = 'receipt' AND receipt.id = item.record_id
           LEFT JOIN contract_payments payment
             ON item.item_kind = 'payment' AND payment.id = item.record_id
           WHERE item.registration_id = $1 AND item.item_kind = $2
           ORDER BY item.created_at, item.id`,
          [candidate.registration_id, candidate.settlement_kind],
        );
        const eligible = evidence.rows.filter(
          (item) => item.record_status === "draft",
        );
        if (!eligible.length) return 0;
        if (
          eligible.some(
            (item) =>
              item.job_status !== "consumed" ||
              item.validation_status !== "verified" ||
              item.document_status !== "normal" ||
              item.direction !== candidate.settlement_kind ||
              item.can_auto_post !== true,
          )
        ) {
          throw new ContractDomainError(
            409,
            "历史银行凭证验证链不完整，跳过即时入账",
            "FINANCIAL_DRAFT_OCR_NOT_VERIFIED",
          );
        }
        const settlementRecordIds = eligible.map((item) => item.record_id);
        await postContractFinancialSettlements(client, {
          contractId: candidate.contract_id,
          registrationId: candidate.registration_id,
          settlementKind: candidate.settlement_kind,
          settlementRecordIds,
          financialDirection: candidate.financial_direction,
          directionInvoiceRecordId: candidate.direction_invoice_record_id,
          actorId: candidate.actor_id,
          actorRole: candidate.actor_role,
          now: new Date().toISOString(),
        });
        return settlementRecordIds.length;
      });
      if (postedCount > 0) {
        result.postedRegistrationCount += 1;
        result.postedSettlementCount += postedCount;
      }
    } catch (error) {
      result.skippedRegistrationIds.push(candidate.registration_id);
      console.warn("历史部分结算登记未满足即时入账条件，已跳过:", {
        registrationId: candidate.registration_id,
        code: isContractDomainError(error)
          ? error.code || "CONTRACT_DOMAIN_ERROR"
          : "UNEXPECTED_ERROR",
      });
    }
  }
  return result;
}

export async function confirmContractFinancialRecord(
  kind: FinancialRecordKind,
  recordId: string,
  actorId: string,
  actorRole: string,
  expectedContractId?: string,
): Promise<ContractRow> {
  return db.transaction(async (client) => {
    if (kind === "invoice") {
      await lockInvoiceApplicationRootByFinancialSource(
        client,
        "invoice",
        recordId,
      );
    }
    await assertFinancialRecordNotPaired(client, kind, recordId);
    const record = await getLockedFinancialRecord(client, kind, recordId);
    await assertFinancialRecordContractGroup(
      client,
      record.contract_id,
      expectedContractId,
    );
    if (record.status !== "draft") {
      throw new ContractDomainError(
        409,
        record.status === "confirmed"
          ? "该财务记录已经确认"
          : "已冲正的财务记录不能确认",
        "FINANCIAL_RECORD_NOT_DRAFT",
      );
    }
    if (
      !record.financial_ocr_job_id ||
      record.financial_ocr_status !== "consumed" ||
      record.financial_validation_status !== "verified" ||
      record.financial_document_status !== "normal" ||
      record.financial_can_auto_post !== true
    ) {
      throw new ContractDomainError(
        422,
        "财务草稿缺少完整的服务端凭证验证链，不能确认或计入核算",
        "FINANCIAL_DRAFT_OCR_NOT_VERIFIED",
      );
    }
    const recordContract = await getLockedContract(client, record.contract_id);
    const rootId = recordContract.root_contract_id || recordContract.id;
    const rootContract =
      rootId === recordContract.id
        ? recordContract
        : await getLockedContract(client, rootId);
    if (!rootContract.financial_direction) {
      throw new ContractDomainError(
        409,
        "历史单条财务记录缺少由合同类型确定的收支方向，请改用配对登记",
        "FINANCIAL_DIRECTION_UNCONFIRMED",
      );
    }
    const expectedDirection =
      kind === "invoice"
        ? rootContract.financial_direction === "income"
          ? "output"
          : "input"
        : kind === "receipt"
          ? "receipt"
          : "payment";
    if (
      (rootContract.financial_direction === "income" && kind === "payment") ||
      (rootContract.financial_direction === "cost" && kind === "receipt")
    ) {
      throw new ContractDomainError(
        409,
        "财务记录类型与合同已确认方向不一致",
        "FINANCIAL_DIRECTION_CONFLICT",
      );
    }
    if (record.financial_direction !== expectedDirection) {
      throw new ContractDomainError(
        422,
        "财务草稿的凭证方向与合同业务不一致，不能确认",
        "FINANCIAL_DRAFT_DIRECTION_MISMATCH",
      );
    }
    const now = new Date().toISOString();
    if (kind === "receipt") {
      await client.query(
        `UPDATE contract_receipts AS receipt
         SET status = 'confirmed', confirmed_by = $2, confirmed_at = $3,
           updated_at = $3,
           rate_snapshot_json = COALESCE(receipt.rate_snapshot_json, (
             SELECT JSONB_OBJECT_AGG(latest.rate_code, latest.rate_value)
             FROM (
               SELECT DISTINCT ON (rate.rate_code)
                 rate.rate_code, rate.rate_value
               FROM contract_rate_configs AS rate
               WHERE rate.is_active = TRUE
                 AND LEFT(rate.effective_from, 10) <= receipt.receipt_date
                 AND (
                   rate.effective_to IS NULL
                   OR LEFT(rate.effective_to, 10) > receipt.receipt_date
                 )
               ORDER BY rate.rate_code, rate.effective_from DESC
             ) AS latest
           ))
         WHERE receipt.id = $1`,
        [recordId, actorId, now],
      );
    } else {
      await client.query(
        `UPDATE ${financialTable(kind)}
         SET status = 'confirmed', confirmed_by = $2, confirmed_at = $3,
           updated_at = $3
         WHERE id = $1`,
        [recordId, actorId, now],
      );
    }
    if (kind === "invoice")
      await reconcileInvoiceApplicationAllocations(client, record.contract_id);
    await insertAudit(client, {
      contractId: record.contract_id,
      action: `${kind}_confirmed`,
      actorId,
      actorRole,
      changes: { recordId, fromStatus: "draft", toStatus: "confirmed" },
      now,
    });
    const contract = await recalculateContractExecutionStatus(
      client,
      record.contract_id,
      actorId,
      actorRole,
    );
    await syncProjectContractTotal(client, contract.project_id);
    return contract;
  });
}

export async function deleteContractFinancialDraft(
  kind: FinancialRecordKind,
  recordId: string,
  actorId: string,
  actorRole: string,
  expectedContractId?: string,
): Promise<{ contract: ContractRow; removedFilePath: string | null }> {
  return db.transaction(async (client) => {
    if (kind === "invoice") {
      await lockInvoiceApplicationRootByFinancialSource(
        client,
        "invoice",
        recordId,
      );
    }
    await assertFinancialRecordNotPaired(client, kind, recordId);
    const record = await getLockedFinancialRecord(client, kind, recordId);
    await assertFinancialRecordContractGroup(
      client,
      record.contract_id,
      expectedContractId,
    );
    if (record.status !== "draft") {
      throw new ContractDomainError(
        409,
        "只有草稿财务记录可以删除",
        "FINANCIAL_RECORD_NOT_DRAFT",
      );
    }
    const contract = await getLockedContract(client, record.contract_id);
    await client.query(`DELETE FROM ${financialTable(kind)} WHERE id = $1`, [
      recordId,
    ]);
    if (kind === "invoice")
      await reconcileInvoiceApplicationAllocations(client, record.contract_id);
    await hardDeleteFinancialArtifacts(client, [
      {
        fileId: record.file_id,
        ocrJobId: record.financial_ocr_job_id,
        filePath: record.file_path,
      },
    ]);
    const now = new Date().toISOString();
    await insertAudit(client, {
      contractId: record.contract_id,
      action: `${kind}_draft_deleted`,
      actorId,
      actorRole,
      changes: {
        recordId,
        fileId: record.file_id,
        status: "draft",
        attachmentIndexRemoved: Boolean(record.file_id),
        financialEvidenceHardDeleted: Boolean(record.financial_ocr_job_id),
      },
      now,
    });
    return {
      contract,
      removedFilePath: record.file_path,
    };
  });
}

export async function deleteContractFinancialOcrUpload(
  contractId: string,
  ocrJobId: string,
  actorId: string,
  actorRole: string,
): Promise<{ removedFilePath: string | null }> {
  return db.transaction(async (client) => {
    const result = await client.query<LockedFinancialOcrUpload>(
      `SELECT job.id, job.contract_id, job.file_id, file.file_path,
         job.file_hash, job.record_kind, job.status, job.record_id,
         job.business_purpose
       FROM contract_financial_ocr_jobs AS job
       JOIN contract_files AS file ON file.id = job.file_id
       WHERE job.id = $1
       FOR UPDATE OF job, file`,
      [ocrJobId],
    );
    const upload = result.rows[0];
    if (!upload || upload.contract_id !== contractId) {
      throw new ContractDomainError(404, "财务识别上传记录不存在");
    }
    if (upload.business_purpose) {
      throw new ContractDomainError(
        409,
        "押金结算回单识别任务必须通过押金专用入口移除",
        "CONTRACT_DEPOSIT_RETURN_OCR_SPECIAL_ROUTE_REQUIRED",
      );
    }
    if (upload.record_id) {
      throw new ContractDomainError(
        409,
        "该凭证已经生成财务记录，不能按临时上传删除",
        "FINANCIAL_OCR_ALREADY_CONSUMED",
      );
    }
    if (upload.status === "processing") {
      throw new ContractDomainError(
        409,
        "凭证正在识别，请稍后再移除",
        "FINANCIAL_OCR_PROCESSING",
      );
    }
    const usage = await client.query<{ used: boolean }>(
      `SELECT (
         EXISTS (
           SELECT 1 FROM contract_financial_registration_items
           WHERE ocr_job_id = $1
         ) OR EXISTS (
           SELECT 1 FROM contract_financial_registrations
           WHERE invoice_ocr_job_id = $1 OR bank_ocr_job_id = $1
         )
       ) AS used`,
      [ocrJobId],
    );
    if (usage.rows[0]?.used) {
      throw new ContractDomainError(
        409,
        "该凭证已经进入财务登记，不能按临时上传删除",
        "FINANCIAL_OCR_REGISTRATION_IN_USE",
      );
    }
    await hardDeleteFinancialArtifacts(client, [
      {
        fileId: upload.file_id,
        ocrJobId: upload.id,
        filePath: upload.file_path,
      },
    ]);
    const now = new Date().toISOString();
    await insertAudit(client, {
      contractId: upload.contract_id,
      action: "financial_ocr_upload_deleted",
      actorId,
      actorRole,
      changes: {
        ocrJobId: upload.id,
        fileId: upload.file_id,
        fileHash: upload.file_hash,
        recordKind: upload.record_kind,
        previousStatus: upload.status,
        hardDeleted: true,
      },
      now,
    });
    return { removedFilePath: upload.file_path };
  });
}

async function assertFinancialRecordsNotLinkedToDeposit(
  client: PoolClient,
  paymentRecordIds: readonly string[],
  externalPaymentRecordIds: readonly string[],
): Promise<void> {
  if (!paymentRecordIds.length && !externalPaymentRecordIds.length) return;
  const linked = await client.query<{ id: string }>(
    `SELECT id FROM contract_deposits
     WHERE payment_record_id=ANY($1::text[])
        OR external_payment_record_id=ANY($2::text[])
     LIMIT 1
     FOR UPDATE`,
    [paymentRecordIds, externalPaymentRecordIds],
  );
  if (linked.rows[0]) {
    throw new ContractDomainError(
      409,
      "付款已关联租赁押金，请先处理押金登记后再冲销财务记录",
      "CONTRACT_DEPOSIT_PAYMENT_REVERSAL_BLOCKED",
    );
  }
}

export async function reverseContractFinancialRecord(
  kind: FinancialRecordKind,
  recordId: string,
  actorId: string,
  actorRole: string,
  reason: string,
  expectedContractId?: string,
): Promise<ContractRow> {
  if (!reason?.trim()) throw new ContractDomainError(400, "冲正原因不能为空");
  const table = financialTable(kind);
  return db.transaction(async (client) => {
    if (kind === "invoice") {
      await lockInvoiceApplicationRootByFinancialSource(
        client,
        "invoice",
        recordId,
      );
    }
    await assertFinancialRecordNotPaired(client, kind, recordId);
    const record = await getLockedFinancialRecord(client, kind, recordId);
    await assertFinancialRecordContractGroup(
      client,
      record.contract_id,
      expectedContractId,
    );
    if (kind === "payment") {
      await assertFinancialRecordsNotLinkedToDeposit(client, [recordId], []);
    }
    if (record.status !== "confirmed") {
      throw new ContractDomainError(
        409,
        record.status === "reversed"
          ? "该财务记录已经冲正"
          : "财务记录确认后才能冲正",
        "FINANCIAL_RECORD_NOT_CONFIRMED",
      );
    }
    const now = new Date().toISOString();
    await client.query(
      `UPDATE ${table} SET status = 'reversed', reversed_by = $2,
       reversed_at = $3, reverse_reason = $4, updated_at = $3 WHERE id = $1`,
      [recordId, actorId, now, reason.trim()],
    );
    if (kind === "invoice")
      await reconcileInvoiceApplicationAllocations(client, record.contract_id);
    await insertAudit(client, {
      contractId: record.contract_id,
      action: `${kind}_reversed`,
      actorId,
      actorRole,
      changes: { recordId },
      comment: reason,
      now,
    });
    const contract = await recalculateContractExecutionStatus(
      client,
      record.contract_id,
      actorId,
      actorRole,
      true,
    );
    await syncProjectContractTotal(client, contract.project_id);
    return contract;
  });
}

function assertRegistrationEvidence(
  record: LockedFinancialRecord,
  expectedDirection: "input" | "output" | "receipt" | "payment",
): void {
  if (
    !record.financial_ocr_job_id ||
    record.financial_ocr_status !== "consumed" ||
    record.financial_validation_status !== "verified" ||
    record.financial_document_status !== "normal" ||
    record.financial_can_auto_post !== true
  ) {
    throw new ContractDomainError(
      422,
      "财务登记缺少完整的服务端凭证验证链，不能处理",
      "FINANCIAL_DRAFT_OCR_NOT_VERIFIED",
    );
  }
  if (record.financial_direction !== expectedDirection) {
    throw new ContractDomainError(
      422,
      "财务登记凭证方向与合同业务不一致",
      "FINANCIAL_DRAFT_DIRECTION_MISMATCH",
    );
  }
}

export async function confirmContractFinancialRegistrationInTransaction(
  client: PoolClient,
  registrationId: string,
  actorId: string,
  actorRole: string,
  expectedContractId?: string,
): Promise<ContractRow> {
  await lockInvoiceApplicationRootByFinancialSource(
    client,
    "registration",
    registrationId,
  );
  const registration = await getLockedFinancialRegistration(
    client,
    registrationId,
  );
  await assertFinancialRecordContractGroup(
    client,
    registration.contract_id,
    expectedContractId,
  );
  if (registration.status !== "draft") {
    throw new ContractDomainError(
      409,
      registration.status === "confirmed"
        ? "该财务登记已经确认"
        : "已冲正的财务登记不能确认",
      "FINANCIAL_REGISTRATION_NOT_DRAFT",
    );
  }
  const items = await getLockedFinancialRegistrationItems(client, registration);
  const contract = await getLockedContract(client, registration.contract_id);
  const rootId = contract.root_contract_id || contract.id;
  const rootContract =
    rootId === contract.id ? contract : await getLockedContract(client, rootId);
  const usesExternalSettlement =
    (rootContract.declared_category || rootContract.category) === "asset" &&
    rootContract.asset_funding_mode === "engineering_to_technology";
  const accountingSettlementKind: FinancialStoredRecordKind =
    usesExternalSettlement ? "external_payment" : registration.settlement_kind;
  if (!items.some((item) => item.item_kind === accountingSettlementKind)) {
    throw new ContractDomainError(
      409,
      usesExternalSettlement
        ? "该财务登记尚未收到科技向合同对方付款回单，不能确认"
        : "该财务登记尚未收到银行回单，不能确认",
      "FINANCIAL_REGISTRATION_SETTLEMENT_REQUIRED",
    );
  }
  const records: Array<{
    item: LockedFinancialRegistrationItem;
    record: LockedFinancialRecord;
  }> = [];
  for (const item of items) {
    records.push({
      item,
      record: await getLockedFinancialRecord(
        client,
        item.item_kind,
        item.record_id,
      ),
    });
  }
  const registrationStatusesValid = records.every(({ item, record }) =>
    item.item_kind === "invoice"
      ? ["draft", "confirmed"].includes(record.status)
      : (item.item_kind === registration.settlement_kind ||
          item.item_kind === "external_payment") &&
        ["draft", "confirmed"].includes(record.status),
  );
  if (!registrationStatusesValid) {
    throw new ContractDomainError(
      409,
      "财务登记中的发票和回单状态不一致，不能确认",
      "FINANCIAL_REGISTRATION_STATUS_MISMATCH",
    );
  }
  if (registration.financial_direction === "income") {
    const invoiceSellers = records
      .filter(({ item }) => item.item_kind === "invoice")
      .map(({ record }) =>
        normalizeContractPartyIdentity(String(record.invoice_seller || "")),
      );
    const receiptPayees = records
      .filter(({ item }) => item.item_kind === "receipt")
      .map(({ record }) =>
        normalizeContractPartyIdentity(String(record.settlement_payee || "")),
      );
    if (
      !invoiceSellers.length ||
      !receiptPayees.length ||
      invoiceSellers.some((value) => !value) ||
      receiptPayees.some((value) => !value) ||
      new Set(invoiceSellers).size !== 1 ||
      new Set(receiptPayees).size !== 1 ||
      invoiceSellers[0] !== receiptPayees[0]
    ) {
      throw new ContractDomainError(
        422,
        "营收登记要求全部销项发票销售方与全部回款回单收款人一致",
        "FINANCIAL_REGISTRATION_PARTY_MISMATCH",
      );
    }
  }
  const matches = await client.query<{
    allocated_amount: string | number;
    settlement_kind: FinancialStoredRecordKind;
  }>(
    `SELECT match.allocated_amount::text AS allocated_amount,
         settlement.item_kind AS settlement_kind
       FROM contract_financial_registration_matches match
       JOIN contract_financial_registration_items settlement
         ON settlement.id = match.settlement_item_id
       WHERE match.registration_id = $1
       ORDER BY match.id
       FOR UPDATE OF match`,
    [registration.id],
  );
  if (!matches.rows.length) {
    throw new ContractDomainError(
      409,
      "发票与银行回单尚未建立金额对应关系，不能确认",
      "FINANCIAL_REGISTRATION_MATCH_REQUIRED",
    );
  }
  const invoiceTotalCents = records
    .filter(({ item }) => item.item_kind === "invoice")
    .reduce((sum, { record }) => sum + toCents(record.amount), 0);
  const invoiceRequiredSettlementCents = new Map<string, number>();
  for (const { item, record } of records) {
    if (item.item_kind !== "payment" && item.item_kind !== "external_payment") {
      continue;
    }
    invoiceRequiredSettlementCents.set(
      `${item.item_kind}:${item.record_id}`,
      await invoiceRequiredSettlementAmountCents(client, {
        itemKind: item.item_kind,
        recordId: item.record_id,
        amount: record.amount,
      }),
    );
  }
  const settlementAmountCents = (
    item: LockedFinancialRegistrationItem,
    record: LockedFinancialRecord,
  ) =>
    invoiceRequiredSettlementCents.get(`${item.item_kind}:${item.record_id}`) ??
    toCents(record.amount);
  const accountingSettlementTotalCents = records
    .filter(({ item }) => item.item_kind === accountingSettlementKind)
    .reduce(
      (sum, { item, record }) => sum + settlementAmountCents(item, record),
      0,
    );
  const externalTotalCents = records
    .filter(({ item }) => item.item_kind === "external_payment")
    .reduce(
      (sum, { item, record }) => sum + settlementAmountCents(item, record),
      0,
    );
  const accountingAllocatedTotalCents = matches.rows
    .filter((match) => match.settlement_kind === accountingSettlementKind)
    .reduce((sum, match) => sum + toCents(match.allocated_amount), 0);
  const externalAllocatedTotalCents = matches.rows
    .filter((match) => match.settlement_kind === "external_payment")
    .reduce((sum, match) => sum + toCents(match.allocated_amount), 0);
  if (invoiceTotalCents !== accountingSettlementTotalCents) {
    const settlementLabel = usesExternalSettlement
      ? "科技向合同对方付款回单"
      : registration.settlement_kind === "receipt"
        ? "回单"
        : "付款凭证";
    throw new ContractDomainError(
      409,
      `发票合计${centsToAmount(invoiceTotalCents).toFixed(2)}元与${settlementLabel}合计${centsToAmount(accountingSettlementTotalCents).toFixed(2)}元不一致，不能确认`,
      "FINANCIAL_REGISTRATION_AMOUNT_MISMATCH",
    );
  }
  if (accountingAllocatedTotalCents !== invoiceTotalCents) {
    throw new ContractDomainError(
      409,
      `发票与核算凭证对应金额合计${centsToAmount(accountingAllocatedTotalCents).toFixed(2)}元未完整覆盖发票合计${centsToAmount(invoiceTotalCents).toFixed(2)}元，不能确认`,
      "FINANCIAL_REGISTRATION_MATCH_AMOUNT_MISMATCH",
    );
  }
  if (
    !registration.financial_direction ||
    !registration.direction_invoice_record_id
  ) {
    throw new ContractDomainError(
      409,
      "财务登记缺少合同类型收支方向快照，不能确认",
      "FINANCIAL_DIRECTION_UNCONFIRMED",
    );
  }
  const expectedInvoiceDirection =
    registration.financial_direction === "income" ? "output" : "input";
  if (
    (registration.financial_direction === "income" &&
      registration.settlement_kind !== "receipt") ||
    (registration.financial_direction === "cost" &&
      registration.settlement_kind !== "payment")
  ) {
    throw new ContractDomainError(
      409,
      "财务登记的发票方向与银行回单类型不一致",
      "FINANCIAL_DIRECTION_CONFLICT",
    );
  }
  for (const { item, record } of records) {
    assertRegistrationEvidence(
      record,
      item.item_kind === "invoice"
        ? expectedInvoiceDirection
        : registration.settlement_kind,
    );
  }
  const now = new Date().toISOString();
  const rootCategory = rootContract.declared_category || rootContract.category;
  if (!rootCategory) {
    throw new ContractDomainError(
      409,
      "合同分类尚未完成，不能确定收入或支出方向",
      "FINANCIAL_CONTRACT_CATEGORY_REQUIRED",
    );
  }
  const categoryDirection =
    financialDirectionFromContractCategory(rootCategory);
  if (registration.financial_direction !== categoryDirection) {
    throw new ContractDomainError(
      409,
      rootCategory === "asset"
        ? "资产类合同只能确认支出登记"
        : "主营和非主营合同只能确认收入登记",
      "FINANCIAL_DIRECTION_CONFLICT",
    );
  }
  if (
    rootContract.financial_direction &&
    rootContract.financial_direction !== categoryDirection
  ) {
    throw new ContractDomainError(
      409,
      "本次发票方向与合同类型规定的收支方向不一致",
      "FINANCIAL_DIRECTION_CONFLICT",
    );
  }
  if (!rootContract.financial_direction) {
    await client.query(
      `UPDATE contracts SET financial_direction = $2,
           financial_direction_source = 'contract_category',
           financial_direction_invoice_id = NULL,
           financial_direction_confirmed_by = NULL,
           financial_direction_confirmed_at = NULL,
           financial_direction_version = financial_direction_version + 1,
           updated_by = $3, updated_at = $4, version = version + 1
         WHERE id = $1`,
      [rootId, categoryDirection, actorId, now],
    );
  }
  if (
    rootCategory === "asset" &&
    rootContract.asset_funding_mode === "engineering_to_technology" &&
    (externalTotalCents !== invoiceTotalCents ||
      externalAllocatedTotalCents !== invoiceTotalCents)
  ) {
    throw new ContractDomainError(
      409,
      `签约公司最终对外付款${centsToAmount(externalTotalCents).toFixed(2)}元尚未完整覆盖发票合计${centsToAmount(invoiceTotalCents).toFixed(2)}元，不能关闭资金链`,
      "EXTERNAL_PAYMENT_NOT_CLOSED",
    );
  }
  const invoiceRecordIds = items
    .filter((item) => item.item_kind === "invoice")
    .map((item) => item.record_id);
  const settlementRecordIds = items
    .filter((item) => item.item_kind === registration.settlement_kind)
    .map((item) => item.record_id);
  const externalPaymentRecordIds = items
    .filter((item) => item.item_kind === "external_payment")
    .map((item) => item.record_id);
  await client.query(
    `UPDATE contract_invoices
       SET status = 'confirmed', confirmed_by = $2, confirmed_at = $3,
         updated_at = $3
       WHERE id = ANY($1::text[])`,
    [invoiceRecordIds, actorId, now],
  );
  await reconcileInvoiceApplicationAllocations(
    client,
    registration.contract_id,
  );
  if (registration.settlement_kind === "receipt") {
    await client.query(
      `UPDATE contract_receipts AS receipt
         SET status = 'confirmed',
           confirmed_by = COALESCE(receipt.confirmed_by, $2),
           confirmed_at = COALESCE(receipt.confirmed_at, $3),
           updated_at = $3,
           rate_snapshot_json = COALESCE(receipt.rate_snapshot_json, (
             SELECT JSONB_OBJECT_AGG(latest.rate_code, latest.rate_value)
             FROM (
               SELECT DISTINCT ON (rate.rate_code)
                 rate.rate_code, rate.rate_value
               FROM contract_rate_configs AS rate
               WHERE rate.is_active = TRUE
                 AND LEFT(rate.effective_from, 10) <= receipt.receipt_date
                 AND (
                   rate.effective_to IS NULL
                   OR LEFT(rate.effective_to, 10) > receipt.receipt_date
                 )
               ORDER BY rate.rate_code, rate.effective_from DESC
             ) AS latest
           ))
         WHERE receipt.id = ANY($1::text[])`,
      [settlementRecordIds, actorId, now],
    );
  } else {
    await client.query(
      `UPDATE contract_payments AS payment
         SET status = 'confirmed',
           confirmed_by = COALESCE(payment.confirmed_by, $2),
           confirmed_at = COALESCE(payment.confirmed_at, $3),
           updated_at = $3
         WHERE payment.id = ANY($1::text[])`,
      [settlementRecordIds, actorId, now],
    );
  }
  if (externalPaymentRecordIds.length) {
    await client.query(
      `UPDATE contract_external_payments AS payment
         SET status = 'confirmed',
           confirmed_by = COALESCE(payment.confirmed_by, $2),
           confirmed_at = COALESCE(payment.confirmed_at, $3),
           updated_at = $3
         WHERE payment.id = ANY($1::text[])`,
      [externalPaymentRecordIds, actorId, now],
    );
  }
  await client.query(
    `UPDATE contract_financial_registrations
       SET status = 'confirmed', confirmed_by = $2, confirmed_at = $3,
         updated_at = $3
       WHERE id = $1`,
    [registration.id, actorId, now],
  );
  await insertAudit(client, {
    contractId: registration.contract_id,
    action: "financial_registration_confirmed",
    actorId,
    actorRole,
    changes: {
      registrationId: registration.id,
      financialDirection: registration.financial_direction,
      directionInvoiceRecordId: registration.direction_invoice_record_id,
      invoiceRecordIds,
      settlementRecordIds,
      externalPaymentRecordIds,
      fromStatus: "draft",
      toStatus: "confirmed",
    },
    now,
  });
  const updated = await recalculateContractExecutionStatus(
    client,
    registration.contract_id,
    actorId,
    actorRole,
  );
  await syncProjectContractTotal(client, updated.project_id);
  return updated;
}

export async function confirmContractFinancialRegistration(
  registrationId: string,
  actorId: string,
  actorRole: string,
  expectedContractId?: string,
): Promise<ContractRow> {
  return db.transaction((client) =>
    confirmContractFinancialRegistrationInTransaction(
      client,
      registrationId,
      actorId,
      actorRole,
      expectedContractId,
    ),
  );
}

export async function deleteContractFinancialRegistrationDraft(
  registrationId: string,
  actorId: string,
  actorRole: string,
  expectedContractId?: string,
): Promise<{ contract: ContractRow; removedFilePaths: string[] }> {
  return db.transaction(async (client) => {
    await lockInvoiceApplicationRootByFinancialSource(
      client,
      "registration",
      registrationId,
    );
    const registration = await getLockedFinancialRegistration(
      client,
      registrationId,
    );
    await assertFinancialRecordContractGroup(
      client,
      registration.contract_id,
      expectedContractId,
    );
    if (registration.status !== "draft") {
      throw new ContractDomainError(
        409,
        "只有草稿财务登记可以删除",
        "FINANCIAL_REGISTRATION_NOT_DRAFT",
      );
    }
    const items = await getLockedFinancialRegistrationItems(
      client,
      registration,
    );
    const records: Array<{
      item: (typeof items)[number];
      record: LockedFinancialRecord;
    }> = [];
    for (const item of items) {
      records.push({
        item,
        record: await getLockedFinancialRecord(
          client,
          item.item_kind,
          item.record_id,
        ),
      });
    }
    if (
      records.some(
        ({ item, record }) =>
          (item.item_kind === registration.settlement_kind ||
            item.item_kind === "external_payment") &&
          record.status === "confirmed",
      )
    ) {
      throw new ContractDomainError(
        409,
        "该财务登记已有实际回款或付款入账，请通过冲销处理，不能直接删除",
        "FINANCIAL_REGISTRATION_POSTED_SETTLEMENT_DELETE_FORBIDDEN",
      );
    }
    if (records.some(({ record }) => record.status !== "draft")) {
      throw new ContractDomainError(
        409,
        "财务登记中的发票和回单状态不一致，不能删除",
        "FINANCIAL_REGISTRATION_STATUS_MISMATCH",
      );
    }
    const contract = await getLockedContract(client, registration.contract_id);
    const now = new Date().toISOString();
    const invoiceRecordIds = items
      .filter((item) => item.item_kind === "invoice")
      .map((item) => item.record_id);
    const settlementRecordIds = items
      .filter((item) => item.item_kind === registration.settlement_kind)
      .map((item) => item.record_id);
    const externalPaymentRecordIds = items
      .filter((item) => item.item_kind === "external_payment")
      .map((item) => item.record_id);
    const ocrJobIds = items.map((item) => item.ocr_job_id);
    const artifacts = records.map(({ record }) => ({
      fileId: record.file_id,
      ocrJobId: record.financial_ocr_job_id,
      filePath: record.file_path,
    }));
    await client.query(
      `DELETE FROM contract_financial_registration_matches WHERE registration_id = $1`,
      [registration.id],
    );
    await client.query(
      `DELETE FROM contract_financial_registration_items WHERE registration_id = $1`,
      [registration.id],
    );
    await client.query(
      `DELETE FROM contract_financial_registrations WHERE id = $1`,
      [registration.id],
    );
    await client.query(
      `DELETE FROM contract_invoices WHERE id = ANY($1::text[])`,
      [invoiceRecordIds],
    );
    await reconcileInvoiceApplicationAllocations(
      client,
      registration.contract_id,
    );
    await client.query(
      `DELETE FROM ${financialTable(registration.settlement_kind)} WHERE id = ANY($1::text[])`,
      [settlementRecordIds],
    );
    if (externalPaymentRecordIds.length) {
      await client.query(
        `DELETE FROM contract_external_payments WHERE id = ANY($1::text[])`,
        [externalPaymentRecordIds],
      );
    }
    await hardDeleteFinancialArtifacts(client, artifacts);
    await insertAudit(client, {
      contractId: registration.contract_id,
      action: "financial_registration_draft_deleted",
      actorId,
      actorRole,
      changes: {
        registrationId: registration.id,
        invoiceRecordIds,
        settlementRecordIds,
        externalPaymentRecordIds,
        fileIds: artifacts.map((artifact) => artifact.fileId).filter(Boolean),
        ocrJobIds,
        financialEvidenceHardDeleted: true,
      },
      now,
    });
    return {
      contract,
      removedFilePaths: artifacts
        .map((artifact) => artifact.filePath)
        .filter((value): value is string => Boolean(value)),
    };
  });
}

export async function reverseContractFinancialRegistration(
  registrationId: string,
  actorId: string,
  actorRole: string,
  reason: string,
  expectedContractId?: string,
): Promise<ContractRow> {
  if (!reason?.trim()) throw new ContractDomainError(400, "冲正原因不能为空");
  return db.transaction(async (client) => {
    await lockInvoiceApplicationRootByFinancialSource(
      client,
      "registration",
      registrationId,
    );
    const registration = await getLockedFinancialRegistration(
      client,
      registrationId,
    );
    await assertFinancialRecordContractGroup(
      client,
      registration.contract_id,
      expectedContractId,
    );
    if (!["draft", "confirmed"].includes(registration.status)) {
      throw new ContractDomainError(
        409,
        registration.status === "reversed"
          ? "该财务登记已经冲正"
          : "当前财务登记不能冲正",
        "FINANCIAL_REGISTRATION_NOT_CONFIRMED",
      );
    }
    const items = await getLockedFinancialRegistrationItems(
      client,
      registration,
    );
    const records = await Promise.all(
      items.map(async (item) => ({
        item,
        record: await getLockedFinancialRecord(
          client,
          item.item_kind,
          item.record_id,
        ),
      })),
    );
    const confirmedSettlementExists = records.some(
      ({ item, record }) =>
        (item.item_kind === registration.settlement_kind ||
          item.item_kind === "external_payment") &&
        record.status === "confirmed",
    );
    const recordsCanReverse = records.every(({ item, record }) =>
      registration.status === "confirmed"
        ? record.status === "confirmed"
        : item.item_kind === "invoice"
          ? ["draft", "confirmed"].includes(record.status)
          : (item.item_kind === registration.settlement_kind ||
              item.item_kind === "external_payment") &&
            record.status === "confirmed",
    );
    if (!confirmedSettlementExists || !recordsCanReverse) {
      throw new ContractDomainError(
        409,
        "财务登记中的发票和回单状态不一致，不能冲正",
        "FINANCIAL_REGISTRATION_STATUS_MISMATCH",
      );
    }
    const now = new Date().toISOString();
    const invoiceRecordIds = items
      .filter((item) => item.item_kind === "invoice")
      .map((item) => item.record_id);
    const settlementRecordIds = items
      .filter((item) => item.item_kind === registration.settlement_kind)
      .map((item) => item.record_id);
    const externalPaymentRecordIds = items
      .filter((item) => item.item_kind === "external_payment")
      .map((item) => item.record_id);
    await assertFinancialRecordsNotLinkedToDeposit(
      client,
      registration.settlement_kind === "payment" ? settlementRecordIds : [],
      externalPaymentRecordIds,
    );
    await client.query(
      `UPDATE contract_invoices SET status = 'reversed', reversed_by = $2,
       reversed_at = $3, reverse_reason = $4, updated_at = $3 WHERE id = ANY($1::text[])`,
      [invoiceRecordIds, actorId, now, reason.trim()],
    );
    await reconcileInvoiceApplicationAllocations(
      client,
      registration.contract_id,
    );
    await client.query(
      `UPDATE ${financialTable(registration.settlement_kind)}
       SET status = 'reversed', reversed_by = $2, reversed_at = $3,
         reverse_reason = $4, updated_at = $3 WHERE id = ANY($1::text[])`,
      [settlementRecordIds, actorId, now, reason.trim()],
    );
    if (externalPaymentRecordIds.length) {
      await client.query(
        `UPDATE contract_external_payments
         SET status = 'reversed', reversed_by = $2, reversed_at = $3,
           reverse_reason = $4, updated_at = $3
         WHERE id = ANY($1::text[])`,
        [externalPaymentRecordIds, actorId, now, reason.trim()],
      );
    }
    await client.query(
      `UPDATE contract_financial_registrations
       SET status = 'reversed', reversed_by = $2, reversed_at = $3,
         reverse_reason = $4, updated_at = $3 WHERE id = $1`,
      [registration.id, actorId, now, reason.trim()],
    );
    await insertAudit(client, {
      contractId: registration.contract_id,
      action: "financial_registration_reversed",
      actorId,
      actorRole,
      changes: {
        registrationId: registration.id,
        invoiceRecordIds,
        settlementRecordIds,
        externalPaymentRecordIds,
      },
      comment: reason.trim(),
      now,
    });
    const contract = await recalculateContractExecutionStatus(
      client,
      registration.contract_id,
      actorId,
      actorRole,
      true,
    );
    await syncProjectContractTotal(client, contract.project_id);
    return contract;
  });
}
