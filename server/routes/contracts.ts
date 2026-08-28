import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type { PoolClient } from "pg";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import JSZip from "jszip";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  ensureDatedUploadDirectory,
  toStoredUploadPath,
} from "../utils/upload-date.js";
import { normalizeUploadFileName } from "../utils/upload-file-name.js";
import { validateFilePath } from "../utils/file-validation.js";
import { isValidBankBusinessDate } from "../utils/bank-business-date.js";
import {
  calculateContractAmountChange,
  calculateMainBusinessIncome,
  calculateNonMainIncome,
  centsToAmount,
  classifyContractSettlement,
  MAX_CONTRACT_AMOUNT_CENTS,
  shiftContractNaturalMonth,
  toCents,
  type ContractRateBasisPoints,
} from "../services/contractAccounting.js";
import {
  contractCostSettlementAmountSql,
  contractCostSettlementLastDateSql,
  prorateContractSettlementCents,
} from "../services/contractSettlementAccounting.js";
import { assertContractFileStructure } from "../services/contractFileValidation.js";
import {
  SupplementAmountCalculationError,
  calculateSupplementAmountSnapshot,
} from "../services/contractSupplementAmount.js";
import {
  getContractAmountAutomaticAdoptionContext,
  getContractAmountBreakdown,
  getContractAmountStatus,
  getContractOcrAutomaticAdoptionSafetyContext,
  extractContractLeaseTerms,
  extractContractBusinessNumber,
  extractReferencedParentContractBusinessNumber,
  recognizeContractFile,
  CONTRACT_OCR_PARSER_VERSION,
  type ContractRawOcrLine,
} from "../services/contractOcr.js";
import { extractContractSealCopyCount } from "../services/contractSealCopyCount.js";
import { compareContractOcrModels } from "../services/contractOcrComparison.js";
import {
  normalizePaddleOcrModelVersion,
  resolvePaddleOcrModel,
  type PaddleOcrModelVersion,
} from "../services/ocrDaemon.js";
import {
  recognizeContractFinancialDocument,
  type ContractFinancialOcrResult,
} from "../services/contractFinancialOcr.js";
import {
  calculatePaymentInvoiceRequiredAmount,
  canConfirmContractDepositAmount,
  recognizeContractDepositReceipt,
} from "../services/contractDepositReceipt.js";
import {
  calculateEngineeringReturnRequired,
  calculateCompletedInternalFundingResponsibility,
  deriveContractDepositStatus,
  isContractDepositEligible,
  validateContractDepositSettlement,
  validateExternalPaymentPurposeDetails,
  type ContractDepositFundingSource,
  type ContractDepositSettlementType,
  type ContractDepositStatus,
  type ContractExternalPaymentPurpose,
} from "../services/contractDeposit.js";
import {
  findReimbursementInvoiceUsage,
  lockCrossModuleInvoiceNumbers,
} from "../services/invoiceCrossModuleDeduplication.js";
import {
  buildSafeContractFinancialSnapshot,
  allocateAdditionalContractFinancialAmounts,
  allocateAvailableContractFinancialAmounts,
  allocateContractFinancialAmounts,
  allocatePartialContractFinancialAmounts,
  contractFinancialOcrEngineVersion,
  contractFinancialOcrParserVersion,
  CONTRACT_COMPANY_LEGAL_NAMES,
  CONTRACT_COMPANY_SUBJECTS,
  resolveContractFinancialCompanySubject,
  CONTRACT_COMPANY_TAX_IDS,
  decideStoredContractFinancialOcrReuse,
  decideContractFinancialOcr,
  findContractFinancialClientMismatches,
  incomeReceiptPartiesMatch,
  type SafeContractFinancialSnapshot,
} from "../services/contractFinancialWorkflow.js";
import {
  assertStoredContractUploadContext,
  BEIJING_CONTRACT_AREAS,
  allocateSupplementSequence,
  buildSupplementSubjectName,
  buildTerminationSubjectName,
  calculateTerminationSettlementSnapshot,
  canDirectDownloadContractFile,
  canViewContractArea,
  CONTRACT_OCR_AUTOMATIC_ACCEPTED_MARKER,
  confirmContractFinancialRecord,
  confirmContractFinancialRegistration,
  confirmContractFinancialRegistrationInTransaction,
  confirmCompletedRentalExit,
  cancelContractBeforeSeal,
  ContractDomainError,
  decideContractAutomaticOcrAdoption,
  deleteContractFinancialDraft,
  deleteContractFinancialOcrUpload,
  deleteContractFinancialRegistrationDraft,
  deleteContractDraft,
  decideContractApproval,
  isContractDomainError,
  isBeijingContractArea,
  inferAssetFundingMode,
  normalizeAutomaticContractConfidence,
  postContractFinancialSettlements,
  recalculateContractExecutionStatus,
  rebuildContractFinancialRegistrationMatches,
  requestContractTermination,
  requiresRestrictedContractArea,
  resolveContractParentContext,
  resolveTerminationTargetContext,
  reverseContractFinancialRecord,
  reverseContractFinancialRegistration,
  submitContractForApproval,
  supplementSubjectMatchesParent,
  syncProjectContractTotal,
  updateContractDraft,
  validateNewContractUploadContext,
  withdrawContractApproval,
  type ContractAssetCategory,
  type ContractCategory,
  type ContractDeclaredSubtype,
  type ContractExpenseCategory,
  type ContractRelationType,
  type ContractRow,
  type FinancialRecordKind,
} from "../services/contractService.js";
import {
  archiveVerifiedSealedContract,
  assertSealedContractRecognitionAllowed,
  createSealedContractVerification,
  getSealedContractVerification,
  recognizeSealedContractFile,
  retrySealedContractVerification,
  submitSealedDifferenceForApproval,
} from "../services/contractSealWorkflow.js";
import {
  getInvoiceApplicationEligibilityBatch,
  lockInvoiceApplicationRoot,
  lockInvoiceApplicationRootByFinancialSource,
  reconcileInvoiceApplicationAllocations,
} from "../services/invoiceApplication.js";

const router = Router();

const FINANCE_ROLES = ["admin", "super_admin", "chairman"] as const;
const CONTRACT_APPROVER_ROLES = ["general_manager"] as const;
const READ_ROLES = [
  "admin",
  "super_admin",
  "chairman",
  "general_manager",
  "boss",
] as const;
const CONTRACT_LEDGER_READ_ROLES = [...READ_ROLES, "user"] as const;
const requireFinance = requireRole([...FINANCE_ROLES]);
const requireContractApprover = requireRole([...CONTRACT_APPROVER_ROLES]);
const requireContractRead = requireRole([...READ_ROLES]);
const requireContractLedgerRead = requireRole([...CONTRACT_LEDGER_READ_ROLES]);

function contractListDisplayName(row: Record<string, unknown>): string {
  const projectName = String(row.project_name || "").trim();
  if (projectName) return projectName;
  return row.status === "draft" ? "项目名称待识别" : "—";
}

const RELATION_TYPES = ["main", "supplement", "termination"] as const;
const ASSET_CATEGORIES = [
  "procurement",
  "software",
  "equipment",
  "house_rental",
  "vehicle_rental",
  "parking_space",
  "office_asset",
  "other",
] as const;
const DECLARED_SUBTYPE_OPTIONS = {
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
    { value: "parking_space", label: "车位租赁" },
    { value: "office_asset", label: "办公资产合同" },
  ],
} as const;
const EXPENSE_CATEGORIES = [
  "rent",
  "electricity",
  "parking",
  "car_rental",
  "internet",
  "other",
] as const;
const RATE_CODES = ["tax", "marketing", "business", "financial"] as const;
const RATE_CODE_LABELS: Record<(typeof RATE_CODES)[number], string> = {
  tax: "税费",
  marketing: "预扣营销",
  business: "商务费用",
  financial: "财务成本",
};
const CORE_OCR_FIELD_CODES = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
  "category",
  "contract_date",
] as const;
const BEIJING_ADMINISTRATIVE_AREAS = BEIJING_CONTRACT_AREAS;
const CONTRACT_AREA_SET = new Set<string>(BEIJING_ADMINISTRATIVE_AREAS);
const FILE_TYPES = [
  "draft_contract",
  "seal_application",
  "triplicate",
  "payment_request",
  "sealed_contract",
  "invoice",
  "receipt",
  "payment",
  "termination",
  "other",
] as const;
const APPROVAL_MATERIAL_FILE_TYPES = [
  "draft_contract",
  "seal_application",
] as const;
const approvalMaterialFileTypes = new Set<string>(APPROVAL_MATERIAL_FILE_TYPES);
const versionedSingleCurrentFileTypes = new Set<string>([
  ...APPROVAL_MATERIAL_FILE_TYPES,
  "payment_request",
]);
const CONTRACT_CATEGORIES = ["main_business", "non_main", "asset"] as const;
const CONTRACT_SETTLEMENT_STATUSES = [
  "unsettled",
  "partial",
  "settled",
] as const;
const CONTRACT_STATUSES = [
  "draft",
  "approving",
  "pending_seal",
  "effective",
  "executing",
  "completed",
  "rejected",
  "terminated",
] as const;

/** 只有财务已确认记录进入合同额、完成率和经营核算。 */
const CONFIRMED_FINANCIAL_STATUSES = ["confirmed"] as const;
const CONTRACT_FINANCIAL_OCR_LEASE_MS = 15 * 60 * 1000;

function confirmedFinancialPredicate(alias: string): string {
  const statuses = CONFIRMED_FINANCIAL_STATUSES.map(
    (status) => `'${status}'`,
  ).join(", ");
  return `${alias}.status IN (${statuses})`;
}

/** 盖章版一经上传即完成台账子项与主合同附件之间的展示切换。 */
function currentSealedContractFileExists(contractAlias: string): string {
  return `EXISTS (
    SELECT 1 FROM contract_files sealed_file
    WHERE sealed_file.contract_id = ${contractAlias}.id
      AND sealed_file.file_type = 'sealed_contract'
      AND sealed_file.is_current = TRUE
  )`;
}

/** 合同链的统计日期固定取主合同日期，子协议日期只作协议自身展示。 */
function rootContractDateExpression(alias: string): string {
  return `(SELECT root_date.contract_date
    FROM contracts root_date
    WHERE root_date.id = COALESCE(${alias}.root_contract_id, ${alias}.id)
      AND root_date.is_deleted = FALSE)`;
}

function contributesToCurrentAmount(alias: string): string {
  return `(
    ${alias}.status IN ('effective', 'executing', 'completed')
    OR (
      ${alias}.status = 'approving'
      AND ${alias}.pending_action = 'termination'
      AND ${alias}.previous_status IN ('effective', 'executing', 'completed')
    )
  )`;
}

/** 尚未首次生效的主合同属于待签；已生效后的终止审批仍属于有效合同。 */
function pendingSignatureContractPredicate(alias: string): string {
  return `(
    ${alias}.status IN ('draft', 'pending_seal')
    OR (
      ${alias}.status = 'approving'
      AND NOT COALESCE((
        ${alias}.pending_action = 'termination'
        AND ${alias}.previous_status IN ('effective', 'executing', 'completed')
      ), FALSE)
    )
  )`;
}

/** 无固定金额合同在历史迁移后可能保存为当前金额 0，不能当作零元合同。 */
function currentFixedContractAmountExpression(alias: string): string {
  return `CASE
    WHEN ${alias}.original_contract_amount IS NULL
      AND ${alias}.amount_delta IS NULL
      AND COALESCE(${alias}.current_effective_amount, 0) = 0
    THEN NULL
    ELSE COALESCE(
      ${alias}.current_effective_amount,
      ${alias}.original_contract_amount,
      ${alias}.amount_delta
    )
  END`;
}

function contractCategoryDirectionExpression(alias: string): string {
  return `CASE
    WHEN ${alias}.category = 'asset' THEN 'cost'
    WHEN ${alias}.category IN ('main_business', 'non_main') THEN 'income'
    ELSE NULL
  END`;
}

const contractUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, ensureDatedUploadDirectory("contracts"));
    },
    filename: (_req, file, callback) => {
      const originalName = normalizeUploadFileName(file.originalname);
      const extension = path.extname(originalName).toLowerCase();
      const baseName = path
        .basename(originalName, extension)
        .replace(/[^\w\u3400-\u9fff-]/g, "_")
        .slice(0, 80);
      callback(
        null,
        `${baseName || "合同文件"}-${Date.now()}-${nanoid(8)}${extension}`,
      );
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
});

const contractRecognitionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
});

function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  contractUpload.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    const message =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "文件不能超过 30MB"
        : error instanceof Error
          ? error.message
          : "文件上传失败";
    res.status(400).json({ success: false, message });
  });
}

function uploadRecognitionSingle(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  contractRecognitionUpload.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    const message =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "文件不能超过 30MB"
        : error instanceof Error
          ? error.message
          : "文件上传失败";
    res.status(400).json({ success: false, message });
  });
}

function cleanupUploadedFile(file?: Express.Multer.File): void {
  if (!file?.path) return;
  try {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  } catch {
    // 清理失败不覆盖原业务错误。
  }
}

async function cleanupStoredFinancialFiles(
  storedPaths: readonly (string | null | undefined)[],
  context: Record<string, unknown>,
): Promise<void> {
  for (const storedPath of [...new Set(storedPaths.filter(Boolean))]) {
    if (!storedPath || !validateFilePath(storedPath)) continue;
    const absolutePath = path.resolve(process.cwd(), storedPath);
    await fs.promises
      .unlink(absolutePath)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") {
          console.error("删除财务凭证物理文件失败:", {
            ...context,
            storedPath,
            error,
          });
        }
      });
  }
}

interface ValidatedUpload {
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  fileHash: string;
}

async function validateUploadedFile(
  file: Express.Multer.File | undefined,
  allowedKinds: readonly ("pdf" | "doc" | "docx" | "jpeg" | "png")[],
): Promise<ValidatedUpload> {
  if (!file) throw new ContractDomainError(400, "必须上传文件");
  const buffer = Buffer.isBuffer(file.buffer)
    ? file.buffer
    : await fs.promises.readFile(file.path);
  const signature = buffer.subarray(0, 8).toString("hex").toLowerCase();
  let kind: "pdf" | "doc" | "docx" | "jpeg" | "png" | null = null;
  let mimeType = file.mimetype;

  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    kind = "pdf";
    mimeType = "application/pdf";
  } else if (signature.startsWith("ffd8ff")) {
    kind = "jpeg";
    mimeType = "image/jpeg";
  } else if (signature === "89504e470d0a1a0a") {
    kind = "png";
    mimeType = "image/png";
  } else if (signature === "d0cf11e0a1b11ae1") {
    kind = "doc";
    mimeType = "application/msword";
  } else if (signature.startsWith("504b0304")) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      if (zip.file("[Content_Types].xml") && zip.file("word/document.xml")) {
        kind = "docx";
        mimeType =
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      }
    } catch {
      kind = null;
    }
  }

  if (!kind || !allowedKinds.includes(kind)) {
    throw new ContractDomainError(400, "文件真实格式不受支持或文件已损坏");
  }
  try {
    await assertContractFileStructure(buffer, kind);
  } catch (error) {
    throw new ContractDomainError(
      400,
      error instanceof Error ? error.message : "文件结构校验失败",
      "CONTRACT_FILE_INVALID",
    );
  }
  const originalName = normalizeUploadFileName(file.originalname);
  const extension = path.extname(originalName).toLowerCase();
  const expectedExtensions: Record<
    NonNullable<typeof kind>,
    readonly string[]
  > = {
    pdf: [".pdf"],
    doc: [".doc"],
    docx: [".docx"],
    jpeg: [".jpg", ".jpeg"],
    png: [".png"],
  };
  if (!expectedExtensions[kind].includes(extension)) {
    throw new ContractDomainError(
      400,
      `文件扩展名与真实格式不一致，应使用 ${expectedExtensions[kind].join(" 或 ")}`,
    );
  }
  if (!file.path) {
    const destination = ensureDatedUploadDirectory("contracts");
    const baseName = path
      .basename(originalName, extension)
      .replace(/[^\w\u3400-\u9fff-]/g, "_")
      .slice(0, 80);
    const generatedName = `${baseName || "合同文件"}-${Date.now()}-${nanoid(8)}${extension}`;
    file.path = path.join(destination, generatedName);
    file.filename = generatedName;
    file.destination = destination;
    await fs.promises.writeFile(file.path, buffer, { flag: "wx" });
  }
  const storedPath = toStoredUploadPath(file.path);
  if (!validateFilePath(storedPath)) {
    throw new ContractDomainError(400, "文件保存路径不安全");
  }
  return {
    fileName: originalName,
    filePath: storedPath,
    fileSize: file.size,
    mimeType,
    fileHash: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function actor(req: Request): { id: string; role: string; name: string } {
  const id = req.session.userId || req.session.user?.id;
  const role = req.session.user?.role;
  if (!id || !role) throw new ContractDomainError(401, "登录状态已失效");
  return { id, role, name: req.session.user?.name || "" };
}

async function assertContractReadScope(
  req: Request,
  contractId: string,
): Promise<void> {
  const currentActor = actor(req);
  if (!requiresRestrictedContractArea(currentActor.role)) {
    if ((READ_ROLES as readonly string[]).includes(currentActor.role)) return;
    throw new ContractDomainError(
      403,
      "无权查看合同",
      "CONTRACT_READ_FORBIDDEN",
    );
  }
  const contract = await db.get<{ area: string; root_area: string }>(
    `SELECT c.area, root.area AS root_area
     FROM contracts c
     JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
     WHERE c.id = ? AND c.is_deleted = FALSE AND root.is_deleted = FALSE`,
    contractId,
  );
  if (!contract) {
    throw new ContractDomainError(404, "合同不存在", "CONTRACT_NOT_FOUND");
  }
  if (
    !canViewContractArea(currentActor.role, contract.area) ||
    !canViewContractArea(currentActor.role, contract.root_area)
  ) {
    throw new ContractDomainError(
      403,
      "行政区域为“全部”的合同仅限总经理和管理员查看",
      "CONTRACT_ALL_AREA_READ_FORBIDDEN",
    );
  }
}

function normalizeNullableText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function normalizeOptionalBoolean(
  value: unknown,
  label: string,
  fallback = false,
): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new ContractDomainError(400, `${label}必须为是或否`);
}

function normalizeFinancialIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "");
}

function normalizeFinancialBankIdentifier(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toUpperCase();
}

async function findContractBankReceiptNumberDuplicate(
  client: PoolClient,
  electronicReceiptNo: string,
  excludedOcrJobId?: string,
): Promise<boolean> {
  const receiptNumberKey =
    normalizeFinancialBankIdentifier(electronicReceiptNo);
  if (!receiptNumberKey) return false;
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('contract-bank-receipt-no:' || $1, 0)
     )`,
    [receiptNumberKey],
  );
  const duplicate = await client.query<{ id: string }>(
    `SELECT id FROM (
       SELECT id, electronic_receipt_no FROM contract_receipts
       UNION ALL
       SELECT id, electronic_receipt_no FROM contract_payments
       UNION ALL
       SELECT id, electronic_receipt_no FROM contract_external_payments
       UNION ALL
       SELECT id, electronic_receipt_no
       FROM contract_deposit_settlement_receipts
     ) AS bank_record
     WHERE UPPER(REGEXP_REPLACE(
       NORMALIZE(BTRIM(bank_record.electronic_receipt_no), NFKC),
       '[^[:alnum:]]+', '', 'g'
     )) = $1
     UNION ALL
     SELECT id FROM contract_financial_ocr_jobs
     WHERE ($2::text IS NULL OR id <> $2)
       AND record_kind IN ('receipt', 'payment')
       AND status IN ('verified', 'consumed', 'blocked')
       AND validation_status IN ('verified', 'blocked')
       AND document_status = 'normal'
       AND UPPER(REGEXP_REPLACE(
         NORMALIZE(BTRIM(snapshot_json #>> '{fields,electronicReceiptNo}'), NFKC),
         '[^[:alnum:]]+', '', 'g'
       )) = $1
     LIMIT 1`,
    [receiptNumberKey, excludedOcrJobId || null],
  );
  return Boolean(duplicate.rows[0]);
}

async function assertContractInvoiceBusinessKeysAvailable(
  client: PoolClient,
  invoices: readonly { seller: string; invoiceNumber: string }[],
  duplicateInBatchMessage: string,
): Promise<void> {
  const identities = new Map<
    string,
    { sellerKey: string; invoiceNumberKey: string }
  >();
  for (const invoice of invoices) {
    const sellerKey = normalizeFinancialIdentity(invoice.seller);
    const invoiceNumberKey = normalizeFinancialIdentity(invoice.invoiceNumber);
    const key = `${sellerKey}:${invoiceNumberKey}`;
    if (identities.has(key)) {
      throw new ContractDomainError(
        409,
        duplicateInBatchMessage,
        "DUPLICATE_CONTRACT_INVOICE",
      );
    }
    identities.set(key, { sellerKey, invoiceNumberKey });
  }
  // 多发票并发登记必须按固定业务键顺序取锁，避免两个批次反序上传时死锁。
  const orderedIdentities = [...identities.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, identity]) => identity);
  for (const identity of orderedIdentities) {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended('contract-invoice:' || $1 || ':' || $2, 0)
       )`,
      [identity.sellerKey, identity.invoiceNumberKey],
    );
    const duplicate = await client.query<{ id: string }>(
      `SELECT id FROM contract_invoices
       WHERE status IN ('draft', 'confirmed', 'reversed')
         AND LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(seller), NFKC), '[[:space:]]+', '', 'g')) = $1
         AND LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(invoice_no), NFKC), '[[:space:]]+', '', 'g')) = $2
       LIMIT 1`,
      [identity.sellerKey, identity.invoiceNumberKey],
    );
    if (duplicate.rows[0]) {
      throw new ContractDomainError(
        409,
        "相同销售方和发票号码已存在",
        "DUPLICATE_CONTRACT_INVOICE",
      );
    }
  }
}

function normalizeFinancialDisplayValue(value: unknown): string | null {
  const text = normalizeNullableText(value);
  return text ? text.normalize("NFKC") : null;
}

function isVehicleRentalContract(
  contract: Pick<
    ContractRow,
    "declared_subtype" | "lease_start_date" | "lease_end_date"
  >,
): boolean {
  if (!contract.lease_start_date && !contract.lease_end_date) return false;
  return contract.declared_subtype === "vehicle_rental";
}

const RENTAL_CONTRACT_SUBTYPES = new Set<ContractDeclaredSubtype>([
  "house_rental",
  "vehicle_rental",
  "parking_space",
]);

function isRentalContract(
  contract: Pick<
    ContractRow,
    "category" | "declared_subtype" | "lease_end_date"
  >,
): boolean {
  return (
    contract.category === "asset" &&
    Boolean(contract.lease_end_date) &&
    Boolean(
      contract.declared_subtype &&
      RENTAL_CONTRACT_SUBTYPES.has(contract.declared_subtype),
    )
  );
}

interface StoredProjectRefreshOcrLine {
  line_index: number;
  page_number: number;
  text: string;
  confidence: number;
}

function normalizeProjectRefreshText(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .trim();
}

/**
 * 旧成功任务只在已存逐行证据明确闭合时复跑。续行必须是同页下一条非空
 * 高置信行，且当前最终值必须恰好停在标签行，不能按普通“工程”尾词猜测。
 */
function storedProjectContinuationNeedsRefresh(
  lines: readonly StoredProjectRefreshOcrLine[],
  currentProjectValue: string,
): boolean {
  const current = normalizeProjectRefreshText(currentProjectValue);
  if (!current) return false;
  const ordered = [...lines]
    .filter((line) => normalizeProjectRefreshText(line.text))
    .sort((left, right) => left.line_index - right.line_index);
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const anchor = ordered[index];
    const anchorMatch = normalizeProjectRefreshText(anchor.text).match(
      /^(?:项目名称|项目全称)[:：](.{4,120})$/u,
    );
    if (
      !anchorMatch ||
      normalizeProjectRefreshText(anchorMatch[1]) !== current
    ) {
      continue;
    }
    const continuation = ordered[index + 1];
    if (
      continuation.page_number !== anchor.page_number ||
      continuation.line_index - anchor.line_index > 3 ||
      Number(continuation.confidence) < 0.9
    ) {
      continue;
    }
    const continuationText = normalizeProjectRefreshText(continuation.text);
    if (
      !/^前期手续(?:技术咨询服务|工程咨询服务|咨询服务|技术服务)$/u.test(
        continuationText,
      ) ||
      current.includes(continuationText)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function requiresHouseRentalInvoiceLines(contract: ContractRow): boolean {
  return (
    contract.category === "asset" &&
    Boolean(contract.lease_start_date || contract.lease_end_date) &&
    contract.declared_subtype === "house_rental"
  );
}

function assertAssetPaymentParties(
  fundingMode: ContractRow["asset_funding_mode"],
  invoice: { buyer: string; seller: string },
  bank: { payer: string; payee: string },
  role: "expense" | "external_settlement" = "expense",
  contractCompanySubjectName?: string,
): void {
  if (!fundingMode || fundingMode === "pending_review") {
    throw new ContractDomainError(
      409,
      "请先确认资产合同资金承担方式",
      "ASSET_FUNDING_MODE_REQUIRED",
    );
  }
  const actualPayer = normalizeFinancialIdentity(bank.payer);
  const actualPayee = normalizeFinancialIdentity(bank.payee);
  const expectedPayer =
    fundingMode === "engineering_to_technology" && role === "expense"
      ? normalizeFinancialIdentity("北京羽隶工程咨询有限公司")
      : normalizeFinancialIdentity(invoice.buyer);
  const expectedPayee =
    fundingMode === "engineering_to_technology" && role === "expense"
      ? normalizeFinancialIdentity(contractCompanySubjectName || invoice.buyer)
      : normalizeFinancialIdentity(invoice.seller);
  if (actualPayer !== expectedPayer || actualPayee !== expectedPayee) {
    throw new ContractDomainError(
      422,
      fundingMode === "engineering_to_technology" && role === "expense"
        ? `工程咨询划拨回单必须由北京羽隶工程咨询有限公司付款、${contractCompanySubjectName || invoice.buyer}收款`
        : "最终付款的付款人、收款人必须与发票购销双方一致",
      "FINANCIAL_REGISTRATION_PARTY_MISMATCH",
    );
  }
}

function parsePositiveAmount(value: unknown, label = "金额"): number {
  try {
    const cents = toCents(String(value ?? ""));
    if (cents <= 0) {
      throw new ContractDomainError(400, `${label}必须大于 0`);
    }
    return centsToAmount(cents);
  } catch (error) {
    if (isContractDomainError(error)) throw error;
    throw new ContractDomainError(
      400,
      `${label}格式不正确，且最多保留两位小数`,
      "CONTRACT_AMOUNT_INVALID",
    );
  }
}

type StoredInvoiceLineItem = {
  itemName: string;
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
  expenseCategory:
    | "rent"
    | "property_management"
    | "electricity"
    | "system_maintenance"
    | "other_cost";
  includeInContractAccounting: boolean;
  recognitionStatus: "verified";
};

function parseContractInvoiceLineItems(
  value: unknown,
  invoiceAmount: number,
  required: boolean,
): StoredInvoiceLineItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    if (!required) return [];
    throw new ContractDomainError(
      422,
      "房屋租赁发票未能可靠拆分明细，禁止自动入账",
      "INVOICE_LINE_ITEMS_MISSING",
    );
  }
  const allowedCategories = new Set([
    "rent",
    "property_management",
    "electricity",
    "system_maintenance",
    "other_cost",
  ]);
  const lineItems = value.map((raw) => {
    const item = raw as Record<string, unknown>;
    const itemName = normalizeFinancialDisplayValue(item.itemName);
    const netAmount = parseNonNegativeAmount(item.netAmount, "明细不含税金额");
    const taxAmount = parseNonNegativeAmount(item.taxAmount, "明细税额");
    const grossAmount = parsePositiveAmount(item.grossAmount, "明细含税金额");
    const expenseCategory = String(item.expenseCategory || "");
    if (
      !itemName ||
      item.recognitionStatus !== "verified" ||
      !allowedCategories.has(expenseCategory) ||
      toCents(String(netAmount)) + toCents(String(taxAmount)) !==
        toCents(String(grossAmount))
    ) {
      throw new ContractDomainError(
        422,
        "发票明细名称、金额、税额或自动分类待核对，禁止自动入账",
        "INVOICE_LINE_ITEM_REVIEW_REQUIRED",
      );
    }
    return {
      itemName,
      netAmount,
      taxAmount,
      grossAmount,
      expenseCategory:
        expenseCategory as StoredInvoiceLineItem["expenseCategory"],
      includeInContractAccounting:
        expenseCategory === "rent" || expenseCategory === "property_management",
      recognitionStatus: "verified" as const,
    };
  });
  if (
    lineItems.reduce(
      (sum, item) => sum + toCents(String(item.grossAmount)),
      0,
    ) !== toCents(String(invoiceAmount))
  ) {
    throw new ContractDomainError(
      422,
      "发票明细含税金额合计与价税合计不一致，禁止自动入账",
      "INVOICE_LINE_TOTAL_MISMATCH",
    );
  }
  return lineItems;
}

async function insertContractInvoiceLineItems(
  client: PoolClient,
  contractId: string,
  invoiceId: string,
  lineItems: readonly StoredInvoiceLineItem[],
  now: string,
): Promise<void> {
  for (const [lineIndex, item] of lineItems.entries()) {
    await client.query(
      `INSERT INTO contract_invoice_line_items (
         id, invoice_id, contract_id, line_index, item_name,
         net_amount, tax_amount, gross_amount, expense_category,
         include_in_contract_accounting, recognition_status,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified',$11,$11)`,
      [
        nanoid(),
        invoiceId,
        contractId,
        lineIndex,
        item.itemName,
        item.netAmount,
        item.taxAmount,
        item.grossAmount,
        item.expenseCategory,
        item.includeInContractAccounting,
        now,
      ],
    );
  }
}

function parseNonNegativeAmount(value: unknown, label = "金额"): number {
  try {
    const cents = toCents(String(value ?? ""));
    if (cents < 0) {
      throw new ContractDomainError(400, `${label}不能小于 0`);
    }
    return centsToAmount(cents);
  } catch (error) {
    if (isContractDomainError(error)) throw error;
    throw new ContractDomainError(
      400,
      `${label}格式不正确，且最多保留两位小数`,
      "CONTRACT_AMOUNT_INVALID",
    );
  }
}

function parseVerifiedInvoiceTaxAmount(
  value: unknown,
  allowEmptyTaxAmount: boolean,
): number | null {
  if (value === undefined || value === null || value === "") {
    if (allowEmptyTaxAmount) return null;
  }
  return parseNonNegativeAmount(value, "发票税额");
}

function parseOptionalAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  try {
    return centsToAmount(toCents(String(value)));
  } catch {
    throw new ContractDomainError(
      400,
      "合同金额格式不正确，且最多保留两位小数",
      "CONTRACT_AMOUNT_INVALID",
    );
  }
}

function safeContractOutputAmount(value: unknown, label: string): number {
  try {
    return centsToAmount(toCents(String(value ?? 0)));
  } catch {
    throw new ContractDomainError(
      500,
      `${label}超过系统安全展示范围`,
      "CONTRACT_AGGREGATE_SAFE_RANGE_EXCEEDED",
    );
  }
}

function sumSafeContractOutputAmounts(
  values: readonly unknown[],
  label: string,
): number {
  let totalCents = 0;
  for (const value of values) {
    const nextCents = totalCents + toCents(String(value ?? 0));
    if (
      !Number.isSafeInteger(nextCents) ||
      Math.abs(nextCents) > MAX_CONTRACT_AMOUNT_CENTS
    ) {
      throw new ContractDomainError(
        500,
        `${label}超过系统安全展示范围`,
        "CONTRACT_AGGREGATE_SAFE_RANGE_EXCEEDED",
      );
    }
    totalCents = nextCents;
  }
  return centsToAmount(totalCents);
}

function normalizeDate(value: unknown, label: string): string {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ContractDomainError(400, `${label}格式必须为 YYYY-MM-DD`);
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new ContractDomainError(400, `${label}不是有效日期`);
  }
  return date;
}

function normalizeFinancialPaymentTime(value: unknown): string {
  const paymentTime = String(value || "")
    .normalize("NFKC")
    .trim();
  const match = paymentTime.match(
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/,
  );
  if (!match) {
    throw new ContractDomainError(
      422,
      "付款时间格式不正确",
      "FINANCIAL_OCR_SNAPSHOT_INVALID",
    );
  }
  normalizeDate(match[1], "付款日期");
  if (match[2] === undefined) return match[1];
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = match[4] === undefined ? null : Number(match[4]);
  if (hour > 23 || minute > 59 || (second !== null && second > 59)) {
    throw new ContractDomainError(
      422,
      "付款时间不是有效时间",
      "FINANCIAL_OCR_SNAPSHOT_INVALID",
    );
  }
  return match[1];
}

function parseExpectedVersion(value: unknown): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new ContractDomainError(
      400,
      "请刷新合同详情后重试",
      "CONTRACT_VERSION_REQUIRED",
    );
  }
  return version;
}

async function generateContractNumber(client: PoolClient): Promise<string> {
  const result = await client.query<{ contract_no: string }>(
    `SELECT 'HT-' ||
       TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD') ||
       '-' || LPAD(nextval('contract_no_sequence')::text, 6, '0') AS contract_no`,
  );
  const contractNo = result.rows[0]?.contract_no;
  if (!contractNo) {
    throw new ContractDomainError(500, "生成合同编号失败");
  }
  return contractNo;
}

function optionalQueryScalar(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ContractDomainError(400, `${label}只能传入一个值`);
  }
  const normalized = value.trim();
  return normalized || null;
}

function positiveIntegerQuery(
  value: unknown,
  label: string,
  fallback: number,
  maximum?: number,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const scalar = optionalQueryScalar(value, label);
  if (!scalar || !/^\d+$/.test(scalar)) {
    throw new ContractDomainError(400, `${label}必须为正整数`);
  }
  const parsed = Number(scalar);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ContractDomainError(400, `${label}必须为正整数`);
  }
  return maximum ? Math.min(maximum, parsed) : parsed;
}

function queryValueList(value: unknown, label: string): string[] {
  if (value === undefined || value === null || value === "") return [];
  const rawValues = Array.isArray(value) ? value : [value];
  const values: string[] = [];
  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") {
      throw new ContractDomainError(400, `${label}格式不正确`);
    }
    for (const item of rawValue.split(",")) {
      const normalized = item.trim();
      if (!normalized) {
        throw new ContractDomainError(400, `${label}不能包含空值`);
      }
      values.push(normalized);
    }
  }
  return [...new Set(values)];
}

function validateQueryEnumList(
  value: unknown,
  allowedValues: readonly string[],
  label: string,
): string[] {
  const values = queryValueList(value, label);
  const invalid = values.find((item) => !allowedValues.includes(item));
  if (invalid) {
    throw new ContractDomainError(400, `${label}包含不支持的值：${invalid}`);
  }
  return values;
}

function validateDashboardFilters(query: Request["query"]): {
  startMonth: string;
  endMonth: string;
  category: ContractCategory | null;
  projectId: string | null;
} {
  const businessDate = currentShanghaiDate();
  const currentMonth = businessDate.slice(0, 7);
  const rawStartMonth = optionalQueryScalar(query.startMonth, "开始月份");
  const rawEndMonth = optionalQueryScalar(query.endMonth, "结束月份");
  if (rawStartMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(rawStartMonth)) {
    throw new ContractDomainError(400, "开始月份格式必须为 YYYY-MM");
  }
  if (rawEndMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(rawEndMonth)) {
    throw new ContractDomainError(400, "结束月份格式必须为 YYYY-MM");
  }
  const endMonth = rawEndMonth || currentMonth;
  const startMonth = rawStartMonth || `${endMonth.slice(0, 4)}-01`;
  if (startMonth > endMonth) {
    throw new ContractDomainError(400, "开始月份不能晚于结束月份");
  }
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  const monthCount =
    (endYear - startYear) * 12 + endMonthNumber - startMonthNumber + 1;
  if (monthCount > 36) {
    throw new ContractDomainError(400, "统计范围最多支持连续 36 个月");
  }
  const categoryValue = optionalQueryScalar(query.category, "合同分类");
  if (
    categoryValue &&
    !(CONTRACT_CATEGORIES as readonly string[]).includes(categoryValue)
  ) {
    throw new ContractDomainError(400, "合同分类不正确");
  }
  const projectId = optionalQueryScalar(query.projectId, "项目编号");
  if (projectId && projectId.length > 128) {
    throw new ContractDomainError(400, "项目编号长度不能超过 128 个字符");
  }
  return {
    startMonth,
    endMonth,
    category: categoryValue as ContractCategory | null,
    projectId,
  };
}

function sendError(res: Response, error: unknown, fallback: string): Response {
  if (isContractDomainError(error)) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }
  const databaseError = error as { code?: string; constraint?: string };
  if (databaseError?.code === "23505") {
    const isBusinessNumberConflict = databaseError.constraint?.includes(
      "business_contract_no",
    );
    const isDuplicateInvoice = databaseError.constraint?.includes(
      "idx_contract_invoice_seller_number_unique",
    );
    return res.status(409).json({
      success: false,
      message: isDuplicateInvoice
        ? "相同销售方和发票号码已存在，请勿重复上传"
        : isBusinessNumberConflict
          ? "该文件自身合同编号已被其他有效合同使用，请核对是否重复建档"
          : databaseError.constraint?.includes("file")
            ? "该文件已上传，请勿重复提交"
            : "业务编号已存在，请勿重复提交",
      ...(isDuplicateInvoice ? { code: "DUPLICATE_CONTRACT_INVOICE" } : {}),
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
}

function toContractApi(row: Record<string, any>) {
  const businessContractNo = row.business_contract_no || null;
  const contractCompanySubject = resolveContractFinancialCompanySubject([
    row.party_a,
    row.party_b,
  ]);
  return {
    id: row.id,
    contractNo: businessContractNo || row.contract_no,
    systemContractNo: row.contract_no,
    businessContractNo,
    title: row.title,
    description: row.description,
    requiresAuxiliaryMaterials: Boolean(row.requires_auxiliary_materials),
    declaredCategory: row.declared_category,
    declaredSubtype: row.declared_subtype,
    category: row.category,
    assetCategory: row.asset_category,
    relationType: row.relation_type,
    status: row.status,
    area: row.area,
    projectId: row.project_id,
    projectName: row.project_name,
    linkedProjectName: row.linked_project_name,
    parentContractId: row.parent_contract_id,
    rootContractId: row.root_contract_id,
    terminationTargetContractId: row.termination_target_contract_id || null,
    previousLeaseContractId: row.renewed_from_contract_id || null,
    renewalContractId: row.renewal_contract_id || null,
    renewalContractStatus: row.renewal_contract_status || null,
    renewalContractName: row.renewal_contract_name || null,
    partyA: row.party_a,
    partyB: row.party_b,
    contractCompanySubjectName: contractCompanySubject?.name || null,
    amountDelta: row.amount_delta,
    originalContractAmount: row.original_contract_amount,
    recognizedOriginalAmount: row.recognized_original_amount,
    recognizedFinalAmount: row.recognized_final_amount,
    amountBeforeChange: row.amount_before_change,
    amountAfterChange: row.amount_after_change,
    fulfilledAmount:
      row.relation_type === "termination" && row.amount_after_change != null
        ? Number(row.amount_after_change)
        : null,
    unperformedAmount:
      row.relation_type === "termination" && row.amount_delta != null
        ? Math.max(0, -Number(row.amount_delta))
        : null,
    terminationFinalAmount:
      row.relation_type === "termination" && row.amount_after_change != null
        ? Number(row.amount_after_change)
        : null,
    currentEffectiveAmount: row.current_effective_amount,
    supplementChangeType: row.supplement_change_type,
    supplementSequence:
      row.supplement_sequence == null ? null : Number(row.supplement_sequence),
    contractDate: row.contract_date,
    contractDateSource: row.contract_date_source,
    leaseStartDate: row.lease_start_date,
    leaseEndDate: row.lease_end_date,
    contractCutoffDate: row.contract_cutoff_date || null,
    leaseMonthlyRent: row.lease_monthly_rent,
    leaseMonthlyPropertyManagementFee: row.lease_monthly_property_fee,
    leaseTermMonths: row.lease_term_months,
    leaseAmountSource: row.lease_amount_source,
    leaseOperationType: row.lease_operation_type || null,
    leasePreviousEndDate: row.lease_previous_end_date || null,
    hasSealedContractFile: Boolean(row.has_sealed_contract_file),
    leaseExpiringSoon: Boolean(row.lease_expiring_soon),
    financialDirection: row.financial_direction,
    financialDirectionSource: row.financial_direction_source,
    financialDirectionInvoiceId: row.financial_direction_invoice_id,
    financialDirectionConfirmedBy: row.financial_direction_confirmed_by,
    financialDirectionConfirmedAt: row.financial_direction_confirmed_at,
    financialDirectionVersion: Number(row.financial_direction_version || 0),
    assetFundingMode: row.asset_funding_mode || null,
    pendingAction: row.pending_action,
    previousStatus: row.previous_status,
    approvalRoundId: row.approval_round_id,
    approvalKind: row.approval_kind,
    approvalTargetId: row.approval_target_id,
    approvalTargetName: row.approval_target_name,
    approvalTargetRole: row.approval_target_role,
    approvalTargetPosition:
      row.approval_target_role === "general_manager"
        ? "总经理"
        : row.approval_target_position,
    approvalTargetSource: row.approval_target_source,
    approvalRoundSubmittedAt: row.approval_round_submitted_at,
    version: row.version,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    sealedAt: row.sealed_at,
    effectiveAt: row.effective_at,
    executingAt: row.executing_at,
    completedAt: row.completed_at,
    terminatedAt: row.terminated_at,
    createdBy: row.created_by,
    ownerName: row.owner_name,
    createdByName: row.owner_name,
    historicalImported: Boolean(row.historical_imported),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    invoiceAmount: row.invoice_amount,
    receiptAmount: row.receipt_amount,
    paymentAmount: row.payment_amount,
  };
}

async function assertUniqueFileHash(
  client: PoolClient,
  contractId: string,
  fileHash: string,
): Promise<void> {
  const duplicate = await client.query(
    `SELECT id FROM contract_files
     WHERE contract_id = $1 AND file_hash = $2
     LIMIT 1`,
    [contractId, fileHash],
  );
  if (duplicate.rows[0]) {
    throw new ContractDomainError(409, "该文件已上传，请勿重复提交");
  }
}

async function insertContractFile(
  client: PoolClient,
  contractId: string,
  fileType: (typeof FILE_TYPES)[number],
  file: ValidatedUpload,
  uploadedBy: string,
  fileId = nanoid(),
): Promise<string> {
  await assertUniqueFileHash(client, contractId, file.fileHash);
  let version = 1;
  if (versionedSingleCurrentFileTypes.has(fileType)) {
    const versionResult = await client.query<{ next_version: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM contract_files
       WHERE contract_id = $1 AND file_type = $2`,
      [contractId, fileType],
    );
    version = Number(versionResult.rows[0]?.next_version || 1);
    await client.query(
      `UPDATE contract_files SET is_current = FALSE
       WHERE contract_id = $1 AND file_type = $2 AND is_current = TRUE`,
      [contractId, fileType],
    );
  }
  await client.query(
    `INSERT INTO contract_files (
       id, contract_id, file_type, file_name, file_path, file_size,
       mime_type, file_hash, version, is_current, uploaded_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$11)`,
    [
      fileId,
      contractId,
      fileType,
      file.fileName,
      file.filePath,
      file.fileSize,
      file.mimeType,
      file.fileHash,
      version,
      uploadedBy,
      new Date().toISOString(),
    ],
  );
  return fileId;
}

function canonicalOcrField(field: string): string {
  const key = String(field || "")
    .trim()
    .toLowerCase()
    .replace(/[\s.-]/g, "_");
  const aliases: Record<string, string> = {
    partya: "party_a",
    party_a_name: "party_a",
    甲方: "party_a",
    partyb: "party_b",
    party_b_name: "party_b",
    乙方: "party_b",
    project: "project_name",
    projectname: "project_name",
    项目名称: "project_name",
    amount: "amount",
    amount_delta: "amount",
    contract_amount: "amount",
    contractamount: "amount",
    合同金额: "amount",
    contract_type: "category",
    contracttype: "category",
    type: "category",
    合同类型: "category",
    asset_type: "asset_category",
    contractdate: "contract_date",
    date: "contract_date",
    contractnumber: "contract_no",
    contract_number: "contract_no",
  };
  return aliases[key] || key;
}

function normalizedOcrValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

/**
 * 补充协议项目名称由主合同派生，接口展示时以合同主表中的系统值为准。
 * 这样旧任务或未达到整体采用标准的任务也不会把截断 OCR 候选重新展示
 * 成项目名称；normalized_value 仍原样返回，保留识别审计证据。
 */
export function contractOcrFinalValueForResponse(
  fieldCode: unknown,
  persistedFinalValue: unknown,
  relationType: unknown,
  persistedProjectName: unknown,
): string | null {
  if (
    fieldCode === "project_name" &&
    ["supplement", "termination"].includes(String(relationType))
  ) {
    const inheritedName = normalizedOcrValue(persistedProjectName);
    if (inheritedName) return inheritedName;
  }
  return normalizedOcrValue(persistedFinalValue);
}

function normalizeOcrConfidence(value: unknown): number {
  return normalizeAutomaticContractConfidence(value);
}

function normalizeAssetCategory(
  value: string | null,
): ContractAssetCategory | null {
  if (!value) return null;
  const aliases: Record<string, ContractAssetCategory> = {
    procurement: "procurement",
    采购合同: "procurement",
    software: "software",
    软件合同: "software",
    equipment: "equipment",
    设备合同: "equipment",
    house_rental: "house_rental",
    房屋租赁: "house_rental",
    vehicle_rental: "vehicle_rental",
    汽车租赁: "vehicle_rental",
    parking_space: "parking_space",
    车位合同: "parking_space",
    车位租赁: "parking_space",
    office_asset: "office_asset",
    办公资产合同: "office_asset",
    other: "other",
    其他: "other",
  };
  return aliases[value.trim()] || null;
}

async function clearDraftAutomaticRecognitionValues(
  client: PoolClient,
  contractId: string,
  updatedAt: string,
): Promise<void> {
  await client.query(
    `UPDATE contracts SET
       party_a = CASE
         WHEN relation_type IN ('supplement', 'termination') THEN party_a
         ELSE NULL
       END,
       party_b = CASE
         WHEN relation_type IN ('supplement', 'termination') THEN party_b
         ELSE NULL
       END,
       project_name = CASE
         WHEN relation_type IN ('supplement', 'termination') THEN project_name
         ELSE NULL
       END,
       amount_delta = CASE WHEN relation_type = 'termination'
         THEN amount_delta ELSE NULL END,
       original_contract_amount = CASE
         WHEN relation_type = 'main' THEN NULL
         ELSE original_contract_amount
       END,
       recognized_original_amount = NULL,
       recognized_final_amount = NULL,
       amount_before_change = CASE WHEN relation_type = 'termination'
         THEN amount_before_change ELSE NULL END,
       amount_after_change = CASE WHEN relation_type = 'termination'
         THEN amount_after_change ELSE NULL END,
       current_effective_amount = CASE
         WHEN relation_type = 'main' THEN NULL
         ELSE current_effective_amount
       END,
       supplement_change_type = CASE
         WHEN relation_type = 'supplement' THEN NULL
         ELSE supplement_change_type
       END,
       category = NULL,
       contract_date = NULL,
       contract_date_source = NULL,
       lease_start_date = NULL,
       lease_end_date = NULL,
       lease_monthly_rent = NULL,
       lease_monthly_property_fee = NULL,
       lease_term_months = NULL,
       lease_amount_source = NULL,
       updated_at = $2,
       version = version + 1
     WHERE id = $1 AND status = 'draft'`,
    [contractId, updatedAt],
  );
}

function normalizeRawOcrConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const ratio = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return Math.max(0, Math.min(1, ratio));
}

function supplementPaymentTermsDetected(rawText: string): boolean {
  const text = String(rawText || "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
  return /付款方式|支付方式|分期(?:付款|支付)|第[一二三四五六七八九十\d]+(?:笔|期).{0,24}(?:支付|付款)|(?:支付|付款).{0,12}(?:期限|时间|节点)/u.test(
    text,
  );
}

async function loadRootCurrentEffectiveAmount(
  client: PoolClient,
  rootContractId: string,
): Promise<number> {
  const result = await client.query<{ current_amount: number }>(
    `SELECT COALESCE(
       root.current_effective_amount,
       root.original_contract_amount,
       root.amount_delta,
       0
     ) AS current_amount
     FROM contracts root
     WHERE root.id = $1 AND root.relation_type = 'main'
       AND root.is_deleted = FALSE`,
    [rootContractId],
  );
  if (!result.rows[0]) {
    throw new ContractDomainError(409, "补充协议关联的主合同不存在");
  }
  return Number(result.rows[0].current_amount || 0);
}

function normalizeRawOcrBbox(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (point) =>
        Array.isArray(point) &&
        Number.isFinite(Number(point[0])) &&
        Number.isFinite(Number(point[1])),
    )
    .map((point) => [Number(point[0]), Number(point[1])]);
}

async function persistContractOcrLines(
  client: PoolClient,
  jobId: string,
  contractId: string,
  lines: readonly ContractRawOcrLine[],
  fallbackModelVersion: PaddleOcrModelVersion,
  createdAt: string,
): Promise<void> {
  await client.query(`DELETE FROM contract_ocr_lines WHERE job_id = $1`, [
    jobId,
  ]);
  const chunkSize = 500;
  for (let offset = 0; offset < lines.length; offset += chunkSize) {
    const chunk = lines.slice(offset, offset + chunkSize);
    const parameters: unknown[] = [];
    const values = chunk.map((line, index) => {
      const base = parameters.length;
      parameters.push(
        nanoid(),
        jobId,
        contractId,
        offset + index,
        Math.max(1, Math.floor(Number(line.page) || 1)),
        String(line.text ?? ""),
        JSON.stringify(normalizeRawOcrBbox(line.bbox)),
        normalizeRawOcrConfidence(line.confidence),
        normalizePaddleOcrModelVersion(line.modelVersion, fallbackModelVersion),
        createdAt,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7}::jsonb,$${base + 8},$${base + 9},$${base + 10})`;
    });
    await client.query(
      `INSERT INTO contract_ocr_lines (
         id, job_id, contract_id, line_index, page_number, text, bbox,
         confidence, model_version, created_at
       ) VALUES ${values.join(",")}`,
      parameters,
    );
  }
}

/**
 * 执行单个合同识别任务。
 *
 * 第二个参数仅用于隔离数据库回放测试注入已冻结的识别结果；生产调度始终
 * 使用默认的 recognizeContractFile，接口、业务流程和持久化事务均不变。
 */
export async function runRecognitionJob(
  jobId: string,
  recognitionRunner: typeof recognizeContractFile = recognizeContractFile,
): Promise<void> {
  if (
    recognitionRunner !== recognizeContractFile &&
    process.env.NODE_ENV !== "test"
  ) {
    throw new Error("自定义合同识别执行器只允许用于隔离测试");
  }
  const job = await db.get<{
    id: string;
    contract_id: string;
    file_id: string;
    file_path: string;
    mime_type: string;
    declared_category: ContractCategory | null;
    declared_subtype: ContractDeclaredSubtype | null;
    asset_category: ContractAssetCategory | null;
    relation_type: ContractRelationType;
    lease_operation_type: "renewal" | null;
    renewed_from_contract_id: string | null;
  }>(
    `SELECT j.id, j.contract_id, j.file_id, f.file_path, f.mime_type,
       c.declared_category, c.declared_subtype, c.asset_category,
       c.relation_type, c.lease_operation_type,
       c.renewed_from_contract_id
     FROM contract_ocr_jobs j
     JOIN contract_files f ON f.id = j.file_id
     JOIN contracts c ON c.id = j.contract_id AND c.is_deleted = FALSE
     WHERE j.id = ?`,
    jobId,
  );
  if (!job) return;
  const now = new Date().toISOString();
  const workerToken = nanoid();
  const leaseDurationMs = 5 * 60 * 1000;
  const leaseUntil = new Date(Date.now() + leaseDurationMs).toISOString();
  const claimed = await db.run(
    `UPDATE contract_ocr_jobs SET status = 'processing', started_at = ?,
     updated_at = ?, error_message = NULL, worker_token = ?, lease_expires_at = ?
     WHERE id = ? AND status = 'queued'`,
    now,
    now,
    workerToken,
    leaseUntil,
    jobId,
  );
  if (claimed.changes === 0) return;

  // 识别可能包含多页高分辨率扫描。持续续租，避免多实例误把仍在执行的
  // 任务当作僵尸任务重新认领。
  const heartbeat = setInterval(() => {
    const nextLeaseUntil = new Date(Date.now() + leaseDurationMs).toISOString();
    void db
      .run(
        `UPDATE contract_ocr_jobs SET lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND status = 'processing' AND worker_token = ?`,
        nextLeaseUntil,
        new Date().toISOString(),
        jobId,
        workerToken,
      )
      .catch((error) => {
        console.error("合同识别任务续租失败:", { jobId, error });
      });
  }, 60 * 1000);
  heartbeat.unref();

  try {
    if (!validateFilePath(job.file_path)) throw new Error("合同文件路径不安全");
    const absolutePath = path.resolve(process.cwd(), job.file_path);
    const result = await recognitionRunner(absolutePath, job.mime_type, {
      expectedCategory: job.declared_category || undefined,
      expectedDeclaredSubtype: job.declared_subtype || undefined,
      expectedAssetCategory: job.asset_category || undefined,
      relationType: job.relation_type,
      leaseOperationType: job.lease_operation_type || undefined,
      renewalMain: Boolean(job.renewed_from_contract_id),
    });
    const recognizedAmountBreakdown = getContractAmountBreakdown(result);
    const recognizedAmountStatus = getContractAmountStatus(result);
    const paymentTermsDetected = supplementPaymentTermsDetected(result.rawText);
    const leaseTerms = extractContractLeaseTerms(
      result.rawText,
      job.declared_category || undefined,
    );
    const finishedAt = new Date().toISOString();
    await db.transaction(async (client) => {
      const contractLock = await client.query<{
        id: string;
        relation_type: ContractRelationType;
        parent_contract_id: string | null;
        termination_target_contract_id: string | null;
        declared_category: ContractCategory | null;
        declared_subtype: ContractDeclaredSubtype | null;
        asset_category: ContractAssetCategory | null;
        area: string;
        project_id: string | null;
        supplement_sequence: number | null;
        lease_operation_type: "renewal" | null;
        lease_previous_end_date: string | null;
        renewed_from_contract_id: string | null;
        renewed_from_lease_end_date: string | null;
        status: string;
        contract_no: string;
        created_by: string;
        created_by_role: string;
      }>(
        `SELECT contract.id, contract.relation_type,
           contract.parent_contract_id,contract.termination_target_contract_id,
           contract.declared_category,contract.declared_subtype,
           contract.asset_category,contract.area,contract.project_id,
           contract.status,contract.contract_no,contract.supplement_sequence,
           contract.lease_operation_type,contract.lease_previous_end_date,
           contract.renewed_from_contract_id,
           contract.renewed_from_lease_end_date,contract.created_by,
           creator.role AS created_by_role
         FROM contracts contract
         JOIN users creator ON creator.id=contract.created_by
         WHERE contract.id = $1 AND contract.is_deleted = FALSE
         FOR UPDATE`,
        [job.contract_id],
      );
      if (!contractLock.rows[0]) {
        throw new ContractDomainError(
          404,
          "合同不存在或已删除，不能写入识别结果",
          "CONTRACT_OCR_TARGET_NOT_FOUND",
        );
      }
      if (contractLock.rows[0].status !== "draft") {
        throw new ContractDomainError(
          409,
          "合同已离开草拟状态，不能写入识别结果",
          "CONTRACT_OCR_TARGET_NOT_DRAFT",
        );
      }
      const currentJob = await client.query<{
        status: string;
        file_type: string;
        is_current: boolean;
        worker_token: string | null;
      }>(
        `SELECT j.status, j.worker_token, f.file_type, f.is_current
         FROM contract_ocr_jobs j
         JOIN contract_files f ON f.id = j.file_id
         WHERE j.id = $1
         FOR UPDATE OF j, f`,
        [jobId],
      );
      const lockedJob = currentJob.rows[0];
      if (
        !lockedJob ||
        lockedJob.status !== "processing" ||
        lockedJob.worker_token !== workerToken
      ) {
        return;
      }
      if (lockedJob.file_type !== "draft_contract" || !lockedJob.is_current) {
        throw new ContractDomainError(
          409,
          "识别任务已不再绑定当前草拟合同文件",
          "CONTRACT_OCR_FILE_NOT_CURRENT",
        );
      }
      let relationParent: ContractRow | null = null;
      let terminationTarget: ContractRow | null = null;
      let renewalSource: ContractRow | null = null;
      if (
        ["supplement", "termination"].includes(
          contractLock.rows[0].relation_type,
        ) &&
        contractLock.rows[0].parent_contract_id
      ) {
        relationParent = await resolveContractParentContext(
          client,
          contractLock.rows[0].parent_contract_id,
          true,
        );
        if (contractLock.rows[0].relation_type === "termination") {
          const targetId = contractLock.rows[0].termination_target_contract_id;
          if (!targetId) {
            throw new ContractDomainError(
              409,
              "解除协议缺少被解除合同",
              "CONTRACT_TERMINATION_TARGET_REQUIRED",
            );
          }
          const context = await resolveTerminationTargetContext(
            client,
            targetId,
            true,
          );
          if (context.root.id !== relationParent.id) {
            throw new ContractDomainError(
              409,
              "被解除合同不属于当前主合同链",
              "CONTRACT_TERMINATION_TARGET_ROOT_MISMATCH",
            );
          }
          terminationTarget = context.target;
        }
      }
      if (contractLock.rows[0].renewed_from_contract_id) {
        const sourceResult = await client.query<ContractRow>(
          `SELECT * FROM contracts
           WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
          [contractLock.rows[0].renewed_from_contract_id],
        );
        renewalSource = sourceResult.rows[0] || null;
      }
      const safetyContext =
        getContractOcrAutomaticAdoptionSafetyContext(result);
      const recognizedSubjectName = (result.fields || []).find(
        (field) => canonicalOcrField(field.field) === "project_name",
      )?.normalizedValue;
      const inheritedSubjectName =
        contractLock.rows[0].relation_type === "supplement" && relationParent
          ? buildSupplementSubjectName(
              relationParent,
              contractLock.rows[0].supplement_sequence,
            )
          : contractLock.rows[0].relation_type === "termination" &&
              terminationTarget
            ? buildTerminationSubjectName(terminationTarget)
            : null;
      const recognizedSubjectMatchesParent =
        relationParent &&
        safetyContext?.project?.candidateExists &&
        safetyContext.project.trustedSource &&
        safetyContext.project.strongEvidence
          ? supplementSubjectMatchesParent(
              recognizedSubjectName,
              terminationTarget || relationParent,
            )
          : null;
      const automaticDecision = decideContractAutomaticOcrAdoption({
        resultStatus: result.status,
        failureKind: result.failureKind,
        relationType: contractLock.rows[0].relation_type,
        declaredCategory: contractLock.rows[0].declared_category,
        rawText: result.rawText,
        fields: (result.fields || []).map((field) => ({
          field: canonicalOcrField(field.field),
          normalizedValue: field.normalizedValue,
        })),
        amountContext: getContractAmountAutomaticAdoptionContext(result),
        safetyContext,
        inheritedSubjectName,
        recognizedSubjectMatchesParent,
      });
      const unrecognizedPageNumbers = [
        ...new Set(result.unrecognizedPageNumbers || []),
      ].sort((a, b) => a - b);
      const pageCompletenessBlocker =
        unrecognizedPageNumbers.length > 0
          ? `合同第 ${unrecognizedPageNumbers.join("、")} 页经同任务自动补扫后仍未识别`
          : null;
      const recognizedSealCopyCount = extractContractSealCopyCount(
        result.rawText,
      );
      const sealCopyCountBlocker = recognizedSealCopyCount
        ? null
        : "合同正文未形成唯一可信的“一式几份”用印总份数";
      const ownsBusinessContractNumber =
        contractLock.rows[0].declared_category === "main_business";
      const referencesParentBusinessNumber =
        contractLock.rows[0].declared_category === "main_business" &&
        ["supplement", "termination"].includes(
          contractLock.rows[0].relation_type,
        );
      const businessNumberEvidence =
        ownsBusinessContractNumber || referencesParentBusinessNumber
          ? extractContractBusinessNumber(result.ocrLines || [])
          : null;
      const referencedParentBusinessNumber = referencesParentBusinessNumber
        ? extractReferencedParentContractBusinessNumber(
            result.ocrLines || [],
            businessNumberEvidence,
          )
        : null;
      let businessNumberBlocker: string | null = null;
      if (ownsBusinessContractNumber && businessNumberEvidence) {
        const duplicate = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE business_contract_no = $1 AND id <> $2 AND is_deleted = FALSE
           LIMIT 1`,
          [businessNumberEvidence.value, job.contract_id],
        );
        if (duplicate.rows[0]) {
          businessNumberBlocker = `合同原件编号 ${businessNumberEvidence.value} 已被其他有效合同使用`;
        }
      }
      const category = automaticDecision.values
        .category as ContractCategory | null;
      let parentContextAccepted = true;
      let parentContextBlocker: string | null = null;
      let supplementAmountSnapshot: ReturnType<
        typeof calculateSupplementAmountSnapshot
      > | null = null;
      let supplementAmountBlocker: string | null = null;
      let rentalRenewalBlocker: string | null = null;
      let independentRenewalBlocker: string | null = null;
      let terminationAmountSnapshot: Awaited<
        ReturnType<typeof calculateTerminationSettlementSnapshot>
      > | null = null;
      let terminationAmountBlocker: string | null = null;
      if (
        automaticDecision.accepted &&
        ["supplement", "termination"].includes(
          contractLock.rows[0].relation_type,
        )
      ) {
        const parentContractId = contractLock.rows[0].parent_contract_id;
        if (!parentContractId) {
          parentContextAccepted = false;
        } else {
          const parent =
            relationParent ||
            (await resolveContractParentContext(
              client,
              parentContractId,
              true,
            ));
          parentContextAccepted =
            parent.category === category &&
            parent.area === contractLock.rows[0].area &&
            parent.declared_subtype === contractLock.rows[0].declared_subtype &&
            parent.asset_category === contractLock.rows[0].asset_category &&
            parent.project_id === contractLock.rows[0].project_id;
          if (referencesParentBusinessNumber) {
            const expectedReferenceNumbers = new Set(
              [
                parent.business_contract_no,
                terminationTarget?.business_contract_no,
              ].filter((value): value is string => Boolean(value)),
            );
            if (
              referencedParentBusinessNumber &&
              expectedReferenceNumbers.size > 0 &&
              !expectedReferenceNumbers.has(referencedParentBusinessNumber)
            ) {
              businessNumberBlocker =
                `本文件关联原合同编号 ${referencedParentBusinessNumber}，` +
                `但被解除合同编号为 ${
                  terminationTarget?.business_contract_no ||
                  parent.business_contract_no
                }，请重新选择正确的解除目标`;
            } else if (
              referencedParentBusinessNumber &&
              expectedReferenceNumbers.size === 0
            ) {
              const referencedContract = await client.query<{
                id: string;
                contract_no: string;
                project_name: string | null;
                is_deleted: boolean;
              }>(
                `SELECT id, contract_no, project_name, is_deleted FROM contracts
                 WHERE business_contract_no = $1
                   AND relation_type = ANY($2::text[])
                 ORDER BY is_deleted ASC, created_at DESC
                 LIMIT 1`,
                [referencedParentBusinessNumber, ["main"]],
              );
              if (
                referencedContract.rows[0] &&
                ![parent.id, terminationTarget?.id].includes(
                  referencedContract.rows[0].id,
                )
              ) {
                const referenced = referencedContract.rows[0];
                businessNumberBlocker =
                  `本文件关联原合同编号 ${referencedParentBusinessNumber}，` +
                  `该编号属于 ${referenced.project_name || referenced.contract_no}` +
                  (referenced.is_deleted
                    ? "，但该原合同当前已撤销或删除，请先重新建立正确原合同后再关联"
                    : "，请重新选择正确的上级合同");
              }
            }
          }
        }
        if (!parentContextAccepted) {
          parentContextBlocker =
            "补充协议或终止协议与上级合同的行政区、分类、资产分类或项目不一致";
        }
      }
      if (
        automaticDecision.accepted &&
        contractLock.rows[0].renewed_from_contract_id
      ) {
        const previousEndDate =
          contractLock.rows[0].renewed_from_lease_end_date;
        const recognizedAmount = parseOptionalAmount(
          automaticDecision.values.amount,
        );
        if (
          !renewalSource ||
          renewalSource.relation_type !== "main" ||
          renewalSource.root_contract_id !== renewalSource.id ||
          !isRentalContract(renewalSource)
        ) {
          independentRenewalBlocker = "前序租赁主合同不存在或当前不可续签";
        } else if (
          !previousEndDate ||
          renewalSource.lease_end_date !== previousEndDate
        ) {
          independentRenewalBlocker =
            "前序租赁合同当前到期日已变化，请删除草稿后重新续签";
        } else if (
          renewalSource.area !== contractLock.rows[0].area ||
          renewalSource.declared_subtype !==
            contractLock.rows[0].declared_subtype ||
          renewalSource.asset_category !== contractLock.rows[0].asset_category
        ) {
          independentRenewalBlocker =
            "续签新合同与前序合同的行政区或租赁分类不一致";
        } else if (
          !leaseTerms.isRentalLease ||
          !leaseTerms.leaseStartDate ||
          !leaseTerms.leaseEndDate ||
          !leaseTerms.termMonths ||
          leaseTerms.totalAmount == null ||
          recognizedAmount == null
        ) {
          independentRenewalBlocker =
            "续签新合同必须明确租期起止日期、租期月数和合同总金额";
        } else if (
          leaseTerms.leaseStartDate <= previousEndDate ||
          leaseTerms.leaseEndDate < leaseTerms.leaseStartDate
        ) {
          independentRenewalBlocker =
            "续签新合同的租期必须晚于前序合同当前到期日";
        } else if (
          toCents(recognizedAmount) !== toCents(leaseTerms.totalAmount)
        ) {
          independentRenewalBlocker =
            "续签新合同金额与新租期租金计算结果不一致";
        } else if (
          normalizeFinancialIdentity(automaticDecision.values.party_a || "") !==
            normalizeFinancialIdentity(renewalSource.party_a || "") ||
          normalizeFinancialIdentity(automaticDecision.values.party_b || "") !==
            normalizeFinancialIdentity(renewalSource.party_b || "")
        ) {
          independentRenewalBlocker = "续签新合同甲乙方与前序租赁合同不一致";
        }
      }
      if (
        automaticDecision.accepted &&
        contractLock.rows[0].relation_type === "supplement" &&
        relationParent
      ) {
        const amountBefore = await loadRootCurrentEffectiveAmount(
          client,
          relationParent.id,
        );
        if (contractLock.rows[0].lease_operation_type === "renewal") {
          const previousEndDate = contractLock.rows[0].lease_previous_end_date;
          if (!isRentalContract(relationParent)) {
            rentalRenewalBlocker = "续签目标不是有效租赁主合同";
          } else if (
            !previousEndDate ||
            relationParent.lease_end_date !== previousEndDate
          ) {
            rentalRenewalBlocker =
              "原合同当前到期日已变化，本次续签须按最新租期重新上传";
          } else if (
            !leaseTerms.leaseStartDate ||
            !leaseTerms.leaseEndDate ||
            !leaseTerms.termMonths ||
            leaseTerms.totalAmount == null
          ) {
            rentalRenewalBlocker =
              "续签协议必须明确新租期起止日期、租期月数和新租期总金额";
          } else if (leaseTerms.leaseEndDate <= previousEndDate) {
            rentalRenewalBlocker = "续签协议的新到期日必须晚于原合同当前到期日";
          } else {
            try {
              supplementAmountSnapshot = calculateSupplementAmountSnapshot({
                beforeAmount: amountBefore,
                recognizedChangeAmount: leaseTerms.totalAmount,
                recognizedFinalAmount: null,
                amountStatus:
                  leaseTerms.amountSource === "contract_total"
                    ? "confirmed_amount"
                    : "calculated_amount",
                paymentTermsDetected,
              });
            } catch (error) {
              supplementAmountBlocker =
                error instanceof SupplementAmountCalculationError
                  ? error.message
                  : "续签协议金额链计算失败";
            }
          }
        } else if (
          recognizedAmountBreakdown?.originalAmount != null &&
          toCents(recognizedAmountBreakdown.originalAmount) !==
            toCents(amountBefore)
        ) {
          supplementAmountBlocker =
            `补充协议原文写明的生效前金额 ${recognizedAmountBreakdown.originalAmount.toFixed(2)} 元` +
            `与主合同当前有效金额 ${amountBefore.toFixed(2)} 元不一致，请核对关联主合同及前序补充协议`;
        } else {
          try {
            supplementAmountSnapshot = calculateSupplementAmountSnapshot({
              beforeAmount: amountBefore,
              recognizedChangeAmount:
                recognizedAmountBreakdown?.changeAmount ??
                parseOptionalAmount(automaticDecision.values.amount),
              recognizedFinalAmount:
                recognizedAmountBreakdown?.finalAmount ?? null,
              amountStatus: recognizedAmountStatus || "missing_amount",
              paymentTermsDetected,
            });
          } catch (error) {
            supplementAmountBlocker =
              error instanceof SupplementAmountCalculationError
                ? error.message
                : "补充协议金额链计算失败";
          }
        }
      }
      if (
        automaticDecision.accepted &&
        contractLock.rows[0].relation_type === "termination" &&
        terminationTarget
      ) {
        try {
          terminationAmountSnapshot =
            await calculateTerminationSettlementSnapshot(
              client,
              terminationTarget.id,
              automaticDecision.values.contract_date,
              true,
            );
        } catch (error) {
          terminationAmountBlocker =
            error instanceof ContractDomainError
              ? error.message
              : "解除协议结算金额计算失败";
        }
      }
      const automaticAdoptionAccepted =
        automaticDecision.accepted &&
        parentContextAccepted &&
        !businessNumberBlocker &&
        !supplementAmountBlocker &&
        !rentalRenewalBlocker &&
        !independentRenewalBlocker &&
        !terminationAmountBlocker &&
        !pageCompletenessBlocker &&
        !sealCopyCountBlocker;
      // 补充协议名称是系统派生字段，识别值只能用于核对主合同。持久化时
      // 始终采用同一份系统名称，避免 NFKC 等识别规范化把全角序号括号改写。
      const adoptedProjectName = ["supplement", "termination"].includes(
        contractLock.rows[0].relation_type,
      )
        ? inheritedSubjectName
        : automaticDecision.values.project_name;
      const persistedStatus = automaticAdoptionAccepted
        ? "succeeded"
        : automaticDecision.status === "failed"
          ? "failed"
          : "partial";
      const normalizedModelVersion = result.modelVersion
        ? normalizePaddleOcrModelVersion(
            result.modelVersion,
            resolvePaddleOcrModel(),
          )
        : null;
      const recognitionError =
        persistedStatus === "succeeded"
          ? null
          : result.failureKind === "infrastructure"
            ? "自动识别基础设施暂时不可用，系统未写入任何合同字段"
            : [
                ...automaticDecision.blockers,
                ...(parentContextBlocker ? [parentContextBlocker] : []),
                ...(businessNumberBlocker ? [businessNumberBlocker] : []),
                ...(supplementAmountBlocker ? [supplementAmountBlocker] : []),
                ...(rentalRenewalBlocker ? [rentalRenewalBlocker] : []),
                ...(independentRenewalBlocker
                  ? [independentRenewalBlocker]
                  : []),
                ...(terminationAmountBlocker ? [terminationAmountBlocker] : []),
                ...(pageCompletenessBlocker ? [pageCompletenessBlocker] : []),
                ...(sealCopyCountBlocker ? [sealCopyCountBlocker] : []),
              ].join("；") ||
              "自动识别未形成可采用结果，系统未写入任何合同字段";
      const persistedWarnings = [
        ...(result.warnings || []),
        ...automaticDecision.warnings,
        ...(automaticAdoptionAccepted
          ? [CONTRACT_OCR_AUTOMATIC_ACCEPTED_MARKER]
          : []),
        ...(parentContextBlocker ? [parentContextBlocker] : []),
        ...(businessNumberBlocker ? [businessNumberBlocker] : []),
        ...(supplementAmountBlocker ? [supplementAmountBlocker] : []),
        ...(rentalRenewalBlocker ? [rentalRenewalBlocker] : []),
        ...(independentRenewalBlocker ? [independentRenewalBlocker] : []),
        ...(terminationAmountBlocker ? [terminationAmountBlocker] : []),
        ...(pageCompletenessBlocker ? [pageCompletenessBlocker] : []),
        ...(sealCopyCountBlocker ? [sealCopyCountBlocker] : []),
      ];
      const persistedJob = await client.query(
        `UPDATE contract_ocr_jobs SET status = $2, method = $3,
         raw_text = $4, warnings_json = $5::jsonb, finished_at = $6,
         updated_at = $6, engine_version = $8, error_message = $9,
         parser_version = $10,
         worker_token = NULL,
         lease_expires_at = NULL WHERE id = $1 AND worker_token = $7`,
        [
          jobId,
          persistedStatus,
          result.method || null,
          result.rawText || null,
          JSON.stringify([...new Set(persistedWarnings)]),
          finishedAt,
          workerToken,
          normalizedModelVersion,
          recognitionError,
          CONTRACT_OCR_PARSER_VERSION,
        ],
      );
      if (persistedJob.rowCount !== 1) {
        throw new Error("合同识别任务状态写入失败");
      }
      await client.query(`DELETE FROM contract_ocr_fields WHERE job_id = $1`, [
        jobId,
      ]);
      await persistContractOcrLines(
        client,
        jobId,
        job.contract_id,
        result.ocrLines || [],
        normalizedModelVersion || resolvePaddleOcrModel(),
        finishedAt,
      );

      for (const field of result.fields || []) {
        const fieldCode = canonicalOcrField(field.field);
        const normalizedValue = normalizedOcrValue(field.normalizedValue);
        await client.query(
          `INSERT INTO contract_ocr_fields (
             id, job_id, contract_id, field_code, original_value,
             normalized_value, final_value, confidence, source, page_number,
             evidence, manually_confirmed, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,FALSE,$11,$11)`,
          [
            nanoid(),
            jobId,
            job.contract_id,
            fieldCode,
            normalizedOcrValue(field.originalValue),
            normalizedValue,
            normalizeOcrConfidence(field.fieldScore),
            field.source || "unknown",
            field.pageNumber || null,
            normalizedOcrValue(field.evidence),
            finishedAt,
          ],
        );
      }

      // 补充协议项目名称由已锁定主合同名称和当前有效序号生成；删除草稿
      // 后仍存在的草稿会紧凑重排，正式协议及非草稿撤销记录不回收序号。
      // 派生字段，不依赖整份 OCR（光学字符识别）任务是否通过。即使其他
      // 字段导致任务为 partial（未达到采用标准），创建页也必须显示这一
      // 确定值；识别候选继续保留在 normalized_value 中供审计核对。
      if (
        ["supplement", "termination"].includes(
          contractLock.rows[0].relation_type,
        ) &&
        inheritedSubjectName
      ) {
        const inheritedProjectField = await client.query(
          `UPDATE contract_ocr_fields SET
             final_value = $2,
             confidence = 100,
             source = 'system_inherited',
             manually_confirmed = FALSE,
             confirmed_by = NULL,
             confirmed_at = NULL,
             updated_at = $3
           WHERE job_id = $1 AND field_code = 'project_name'`,
          [jobId, inheritedSubjectName, finishedAt],
        );
        if (inheritedProjectField.rowCount === 0) {
          const insertedInheritedProjectField = await client.query(
            `INSERT INTO contract_ocr_fields (
               id, job_id, contract_id, field_code, original_value,
               normalized_value, final_value, confidence, source, page_number,
               evidence, manually_confirmed, created_at, updated_at
             ) VALUES (
               $1,$2,$3,'project_name',NULL,NULL,$4,100,'system_inherited',NULL,
               '系统按被关联合同名称生成子协议名称',FALSE,$5,$5
             )`,
            [
              nanoid(),
              jobId,
              job.contract_id,
              inheritedSubjectName,
              finishedAt,
            ],
          );
          if (insertedInheritedProjectField.rowCount !== 1) {
            throw new Error("补充协议系统继承项目名称写入失败");
          }
        } else if (inheritedProjectField.rowCount !== 1) {
          throw new Error("补充协议系统继承项目名称写入失败");
        }
      }

      if (contractLock.rows[0].relation_type === "termination") {
        await client.query(
          `INSERT INTO contract_ocr_fields (
             id, job_id, contract_id, field_code, original_value,
             normalized_value, final_value, confidence, source, page_number,
             evidence, manually_confirmed, created_at, updated_at
           ) SELECT $1,$2,$3,'amount',NULL,NULL,NULL,100,
             'system_settlement',NULL,
             '解除金额由有效结算记录生成，不采用协议正文金额',FALSE,$4,$4
           WHERE NOT EXISTS (
             SELECT 1 FROM contract_ocr_fields
             WHERE job_id = $2 AND field_code = 'amount'
           )`,
          [nanoid(), jobId, job.contract_id, finishedAt],
        );
      }

      if (automaticAdoptionAccepted) {
        for (const fieldCode of CORE_OCR_FIELD_CODES) {
          const adoptedFieldValue =
            fieldCode === "project_name"
              ? adoptedProjectName
              : automaticDecision.values[fieldCode];
          const adoptedField = await client.query(
            `UPDATE contract_ocr_fields SET
               final_value = $3,
               manually_confirmed = FALSE,
               confirmed_by = NULL,
               confirmed_at = NULL,
               updated_at = $4
             WHERE job_id = $1 AND field_code = $2`,
            [jobId, fieldCode, adoptedFieldValue, finishedAt],
          );
          if (adoptedField.rowCount !== 1) {
            throw new Error(`合同识别字段最终值写入失败：${fieldCode}`);
          }
        }
        const recognizedAmount = parseOptionalAmount(
          automaticDecision.values.amount,
        );
        const amount = terminationAmountSnapshot
          ? terminationAmountSnapshot.amountDelta
          : supplementAmountSnapshot
            ? supplementAmountSnapshot.delta
            : recognizedAmount;
        const contractDateSource = automaticDecision.values.contract_date
          ? "ocr"
          : null;
        const updatedContract = await client.query(
          `UPDATE contracts SET
             title = CASE
               WHEN $17::text IS NULL THEN title
               ELSE $17::text
             END,
             party_a = CASE WHEN $18::text IN ('supplement', 'termination')
               THEN NULLIF($19, '') ELSE NULLIF($2, '') END,
             party_b = CASE WHEN $18::text IN ('supplement', 'termination')
               THEN NULLIF($20, '') ELSE NULLIF($3, '') END,
             project_name = NULLIF($4, ''),
             amount_delta = $5,
             original_contract_amount = CASE WHEN $18::text = 'main'
               THEN $5 ELSE original_contract_amount END,
             recognized_original_amount = $21,
             recognized_final_amount = $22,
             amount_before_change = COALESCE($26::numeric, $23::numeric),
             amount_after_change = COALESCE($27::numeric, $24::numeric),
             current_effective_amount = CASE WHEN $18::text = 'main'
               THEN $5 ELSE current_effective_amount END,
             supplement_change_type = $25,
             category = $6,
             contract_date = NULLIF($7, ''),
             contract_date_source = $8,
             business_contract_no = COALESCE($9, business_contract_no),
             lease_start_date = $10,
             lease_end_date = $11,
             lease_monthly_rent = $12,
             lease_monthly_property_fee = $13,
             lease_term_months = $14,
             lease_amount_source = $15,
             updated_at = $16, version = version + 1
           WHERE id = $1 AND status = 'draft'`,
          [
            job.contract_id,
            automaticDecision.values.party_a,
            automaticDecision.values.party_b,
            adoptedProjectName,
            amount,
            category,
            automaticDecision.values.contract_date,
            contractDateSource,
            ownsBusinessContractNumber
              ? businessNumberEvidence?.value || null
              : null,
            leaseTerms.isRentalLease ? leaseTerms.leaseStartDate : null,
            leaseTerms.isRentalLease ? leaseTerms.leaseEndDate : null,
            leaseTerms.isRentalLease ? leaseTerms.monthlyRent : null,
            leaseTerms.isRentalLease
              ? leaseTerms.monthlyPropertyManagementFee
              : null,
            leaseTerms.isRentalLease ? leaseTerms.termMonths : null,
            leaseTerms.isRentalLease ? leaseTerms.amountSource : null,
            finishedAt,
            inheritedSubjectName,
            contractLock.rows[0].relation_type,
            relationParent?.party_a || "",
            relationParent?.party_b || "",
            recognizedAmountBreakdown?.originalAmount ?? null,
            recognizedAmountBreakdown?.finalAmount ?? null,
            supplementAmountSnapshot?.before ?? null,
            supplementAmountSnapshot?.after ?? null,
            supplementAmountSnapshot?.changeType ?? null,
            terminationAmountSnapshot?.currentEffectiveAmount ?? null,
            terminationAmountSnapshot?.settledAmount ?? null,
          ],
        );
        if (updatedContract.rowCount !== 1) {
          throw new Error("合同识别最终值写入主表失败");
        }
        if (contractLock.rows[0].relation_type === "main") {
          const inferredFundingMode = inferAssetFundingMode(
            category,
            automaticDecision.values.party_a,
            automaticDecision.values.party_b,
          );
          if (inferredFundingMode) {
            await client.query(
              `UPDATE contracts SET asset_funding_mode = $2 WHERE id = $1`,
              [job.contract_id, inferredFundingMode],
            );
          }
          const depositRecognition = result.depositRecognition;
          if (
            category === "asset" &&
            depositRecognition?.triggered &&
            depositRecognition.status === "confirmed" &&
            depositRecognition.amount &&
            depositRecognition.amount > 0
          ) {
            const depositId = nanoid();
            const insertedDeposit = await client.query<{ id: string }>(
              `INSERT INTO contract_deposits(
                 id,contract_id,amount,clause_text,basis,payment_purpose,
                 funding_source,engineering_allocation_amount,
                 technology_self_funded_amount,status,settled_amount,
                 created_by,updated_by,created_at,updated_at
               ) VALUES($1,$2,$3,$4,$5,'lease_deposit','pending_review',
                 0,0,'pending_payment',0,$6,$6,$7,$7)
               ON CONFLICT(contract_id) DO NOTHING
               RETURNING id`,
              [
                depositId,
                job.contract_id,
                depositRecognition.amount,
                depositRecognition.evidence,
                depositRecognition.formula
                  ? `${depositRecognition.formula.months}个月 × 每月${depositRecognition.formula.monthlyBasisAmount.toFixed(2)}元`
                  : depositRecognition.evidence,
                contractLock.rows[0].created_by,
                finishedAt,
              ],
            );
            if (insertedDeposit.rows[0]) {
              await client.query(
                `INSERT INTO contract_audit_logs(
                   id,contract_id,action,actor_id,actor_role,from_status,
                   to_status,changes_json,comment,created_at
                 ) SELECT $1,contract.id,'contract_deposit_recognized',$2,
                   $3,status,status,$4::jsonb,$5,$6
                   FROM contracts contract WHERE contract.id=$7`,
                [
                  nanoid(),
                  contractLock.rows[0].created_by,
                  contractLock.rows[0].created_by_role,
                  JSON.stringify({
                    depositId: insertedDeposit.rows[0].id,
                    amount: depositRecognition.amount,
                    amountSource: depositRecognition.amountSource,
                    reasonCode: depositRecognition.reasonCode,
                  }),
                  "依据租赁合同原文自动建立待支付押金记录",
                  finishedAt,
                  job.contract_id,
                ],
              );
            }
          }
        }
      } else {
        await clearDraftAutomaticRecognitionValues(
          client,
          job.contract_id,
          finishedAt,
        );
        if (
          ownsBusinessContractNumber &&
          businessNumberEvidence &&
          !businessNumberBlocker
        ) {
          await client.query(
            `UPDATE contracts SET business_contract_no = $2, updated_at = $3
             WHERE id = $1 AND status = 'draft'`,
            [job.contract_id, businessNumberEvidence.value, finishedAt],
          );
        }
      }
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    await db.transaction(async (client) => {
      const failedJob = await client.query(
        `UPDATE contract_ocr_jobs SET status = 'failed', error_message = $2,
           finished_at = $3, updated_at = $3, worker_token = NULL,
           lease_expires_at = NULL
         WHERE id = $1 AND status = 'processing' AND worker_token = $4`,
        [
          jobId,
          error instanceof Error ? error.message : "合同识别失败",
          failedAt,
          workerToken,
        ],
      );
      if (failedJob.rowCount === 1) {
        await clearDraftAutomaticRecognitionValues(
          client,
          job.contract_id,
          failedAt,
        );
      }
    });
    console.error("合同识别任务失败:", { jobId, error });
  } finally {
    clearInterval(heartbeat);
  }
}

const configuredRecognitionConcurrency = Number.parseInt(
  process.env.CONTRACT_OCR_CONCURRENCY || "2",
  10,
);
const recognitionConcurrency = Number.isFinite(configuredRecognitionConcurrency)
  ? Math.min(4, Math.max(1, configuredRecognitionConcurrency))
  : 2;
const pendingRecognitionJobs: string[] = [];
const pendingRecognitionJobIds = new Set<string>();
let activeRecognitionJobs = 0;
let recognitionRecoveryTimer: NodeJS.Timeout | null = null;

function drainRecognitionQueue(): void {
  while (
    activeRecognitionJobs < recognitionConcurrency &&
    pendingRecognitionJobs.length > 0
  ) {
    const jobId = pendingRecognitionJobs.shift();
    if (!jobId) continue;
    pendingRecognitionJobIds.delete(jobId);
    activeRecognitionJobs += 1;
    void runRecognitionJob(jobId)
      .catch((error) => {
        console.error("合同识别后台任务调度失败:", { jobId, error });
      })
      .finally(() => {
        activeRecognitionJobs -= 1;
        drainRecognitionQueue();
      });
  }
}

function scheduleRecognitionJob(jobId: string): void {
  if (pendingRecognitionJobIds.has(jobId)) return;
  pendingRecognitionJobIds.add(jobId);
  pendingRecognitionJobs.push(jobId);
  drainRecognitionQueue();
}

/** 服务重启后恢复未完成任务，避免合同永久停留在排队或识别中。 */
export async function resumePendingContractRecognitionJobs(): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE contract_ocr_jobs AS job
     SET status = 'failed', finished_at = ?, updated_at = ?,
       worker_token = NULL, lease_expires_at = NULL,
       error_message = '合同草稿已删除，识别任务已取消'
     FROM contracts AS contract
     WHERE contract.id = job.contract_id AND contract.is_deleted = TRUE
       AND job.status IN ('queued', 'processing')`,
    now,
    now,
  );
  await db.run(
    `UPDATE contract_ocr_jobs
     SET status = 'queued', started_at = NULL, updated_at = ?,
       worker_token = NULL, lease_expires_at = NULL,
       error_message = '识别任务租约已过期，系统已自动恢复'
     WHERE status = 'processing'
       AND EXISTS (
         SELECT 1 FROM contracts AS contract
         WHERE contract.id = contract_ocr_jobs.contract_id
           AND contract.is_deleted = FALSE
       )
       AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
    now,
    now,
  );
  const pendingJobs = await db.all<{ id: string; status: string }>(
    `SELECT job.id, job.status FROM contract_ocr_jobs AS job
     JOIN contracts AS contract
       ON contract.id = job.contract_id AND contract.is_deleted = FALSE
     WHERE job.status = 'queued'
     ORDER BY job.created_at ASC`,
  );
  for (const job of pendingJobs) scheduleRecognitionJob(job.id);
  if (pendingJobs.length > 0) {
    console.log(`合同识别恢复任务已调度：${pendingJobs.length} 项`);
  }
  // 同一轮询也负责接管“写入队列后进程立即退出”的极小时间窗，并在
  // 其他实例宕机后于租约到期自动恢复任务。
  if (!recognitionRecoveryTimer) {
    recognitionRecoveryTimer = setTimeout(() => {
      recognitionRecoveryTimer = null;
      void resumePendingContractRecognitionJobs().catch((error) => {
        console.error("合同识别任务恢复检查失败:", error);
      });
    }, 60 * 1000);
    recognitionRecoveryTimer.unref();
  }
}

async function loadCurrentRates(at = new Date().toISOString()) {
  const rows = await db.all<{ rate_code: string; rate_value: number }>(
    `SELECT DISTINCT ON (rate_code) rate_code, rate_value
     FROM contract_rate_configs
     WHERE is_active = TRUE
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to > ?)
     ORDER BY rate_code, effective_from DESC`,
    at,
    at,
  );
  const values = Object.fromEntries(
    rows.map((row) => [row.rate_code, Number(row.rate_value)]),
  );
  return {
    decimal: {
      tax: values.tax ?? 0.1172,
      marketing: values.marketing ?? 0.05,
      business: values.business ?? 0.1,
      financial: values.financial ?? 0.0028,
    },
    basisPoints: {
      tax: Math.round((values.tax ?? 0.1172) * 10000),
      marketing: Math.round((values.marketing ?? 0.05) * 10000),
      business: Math.round((values.business ?? 0.1) * 10000),
      financial: Math.round((values.financial ?? 0.0028) * 10000),
    } satisfies ContractRateBasisPoints,
  };
}

type ContractRateCode = keyof ContractRateBasisPoints;

interface ContractRateConfigRow {
  rate_code: ContractRateCode;
  rate_value: number | string;
  effective_from: string;
  effective_to: string | null;
}

interface DatedContractAmountRow {
  amount: number | string;
  occurredAt: string;
  rateSnapshot?: Partial<Record<ContractRateCode, number | string>> | null;
}

interface DatedContractPaymentRow extends DatedContractAmountRow {
  expenseCategory: ContractExpenseCategory;
}

interface CategorizedContractReceiptRow extends DatedContractAmountRow {
  category: ContractCategory;
}

const DEFAULT_RATE_BASIS_POINTS: ContractRateBasisPoints = {
  tax: 1172,
  marketing: 500,
  business: 1000,
  financial: 28,
};

async function loadRateHistory(): Promise<ContractRateConfigRow[]> {
  return db.all<ContractRateConfigRow>(
    `SELECT rate_code, rate_value, effective_from, effective_to
     FROM contract_rate_configs
     WHERE is_active = TRUE
     ORDER BY rate_code, effective_from DESC`,
  );
}

function resolveRatesAt(
  rateHistory: ContractRateConfigRow[],
  businessDate: string,
): ContractRateBasisPoints {
  const date = businessDate.slice(0, 10);
  const resolved = { ...DEFAULT_RATE_BASIS_POINTS };
  for (const rateCode of Object.keys(resolved) as ContractRateCode[]) {
    const matched = rateHistory.find(
      (row) =>
        row.rate_code === rateCode &&
        row.effective_from.slice(0, 10) <= date &&
        (!row.effective_to || row.effective_to.slice(0, 10) > date),
    );
    if (matched) {
      resolved[rateCode] = Math.round(Number(matched.rate_value) * 10000);
    }
  }
  return resolved;
}

function resolveRecordRates(
  record: DatedContractAmountRow,
  rateHistory: ContractRateConfigRow[],
): ContractRateBasisPoints {
  const resolved = resolveRatesAt(rateHistory, record.occurredAt);
  if (!record.rateSnapshot || typeof record.rateSnapshot !== "object") {
    return resolved;
  }
  for (const rateCode of RATE_CODES) {
    const value = Number(record.rateSnapshot[rateCode]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      resolved[rateCode] = Math.round(value * 10000);
    }
  }
  return resolved;
}

function currentShanghaiDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function monthEndTimestamp(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`;
}

function uniformRate(
  usedRates: Set<number>,
  fallbackRate: number,
): number | null {
  if (usedRates.size === 0) return fallbackRate / 100;
  if (usedRates.size === 1) return [...usedRates][0] / 100;
  return null;
}

function aggregateMainBusinessIncome(
  records: DatedContractAmountRow[],
  rateHistory: ContractRateConfigRow[],
) {
  const total = {
    contractAmountCents: 0,
    taxCents: 0,
    marketingReserveCents: 0,
    businessCostCents: 0,
    accountingBaseCents: 0,
  };
  const addCents = (current: number, increment: number): number => {
    const result = current + increment;
    if (
      !Number.isSafeInteger(result) ||
      Math.abs(result) > MAX_CONTRACT_AMOUNT_CENTS
    ) {
      throw new ContractDomainError(500, "合同核算金额超过安全范围");
    }
    return result;
  };
  const usedRates = {
    tax: new Set<number>(),
    marketing: new Set<number>(),
    business: new Set<number>(),
  };
  for (const record of records) {
    const rates = resolveRecordRates(record, rateHistory);
    const calculation = calculateMainBusinessIncome(record.amount, rates);
    total.contractAmountCents = addCents(
      total.contractAmountCents,
      calculation.contractAmountCents,
    );
    total.taxCents = addCents(total.taxCents, calculation.taxCents);
    total.marketingReserveCents = addCents(
      total.marketingReserveCents,
      calculation.marketingReserveCents,
    );
    total.businessCostCents = addCents(
      total.businessCostCents,
      calculation.businessCostCents,
    );
    total.accountingBaseCents = addCents(
      total.accountingBaseCents,
      calculation.accountingBaseCents,
    );
    usedRates.tax.add(rates.tax);
    usedRates.marketing.add(rates.marketing);
    usedRates.business.add(rates.business);
  }
  return { total, usedRates };
}

function aggregateNonMainIncome(
  records: DatedContractAmountRow[],
  rateHistory: ContractRateConfigRow[],
) {
  const total = {
    contractAmountCents: 0,
    financialCostCents: 0,
    taxCents: 0,
    accountingBaseCents: 0,
  };
  const addCents = (current: number, increment: number): number => {
    const result = current + increment;
    if (
      !Number.isSafeInteger(result) ||
      Math.abs(result) > MAX_CONTRACT_AMOUNT_CENTS
    ) {
      throw new ContractDomainError(500, "合同核算金额超过安全范围");
    }
    return result;
  };
  const usedRates = {
    financial: new Set<number>(),
    tax: new Set<number>(),
  };
  for (const record of records) {
    const rates = resolveRecordRates(record, rateHistory);
    const calculation = calculateNonMainIncome(record.amount, rates);
    total.contractAmountCents = addCents(
      total.contractAmountCents,
      calculation.contractAmountCents,
    );
    total.financialCostCents = addCents(
      total.financialCostCents,
      calculation.financialCostCents,
    );
    total.taxCents = addCents(total.taxCents, calculation.taxCents);
    total.accountingBaseCents = addCents(
      total.accountingBaseCents,
      calculation.accountingBaseCents,
    );
    usedRates.financial.add(rates.financial);
    usedRates.tax.add(rates.tax);
  }
  return { total, usedRates };
}

function sumContractAmounts(records: DatedContractAmountRow[]): number {
  let cents = 0;
  for (const record of records) {
    const nextCents = cents + toCents(record.amount);
    if (
      !Number.isSafeInteger(nextCents) ||
      Math.abs(nextCents) > MAX_CONTRACT_AMOUNT_CENTS
    ) {
      throw new ContractDomainError(500, "合同核算金额超过安全范围");
    }
    cents = nextCents;
  }
  return centsToAmount(cents);
}

function remainingContractAmount(
  contractAmount: number | string,
  settledAmount: number | string,
): number {
  return centsToAmount(
    Math.max(0, toCents(contractAmount) - toCents(settledAmount)),
  );
}

function excessContractAmount(
  contractAmount: number | string,
  settledAmount: number | string,
): number {
  return centsToAmount(
    Math.max(0, toCents(settledAmount) - toCents(contractAmount)),
  );
}

function buildContractAccounting(
  category: ContractCategory,
  financialDirection: "income" | "cost",
  currentAmount: number,
  receipts: DatedContractAmountRow[],
  payments: DatedContractPaymentRow[],
  rateHistory: ContractRateConfigRow[],
) {
  const businessDate = currentShanghaiDate();
  const currentMonth = businessDate.slice(0, 7);
  const currentYear = businessDate.slice(0, 4);
  const fallbackRates = resolveRatesAt(rateHistory, businessDate);

  if (financialDirection === "cost") {
    const monthlyPayments = payments.filter((record) =>
      record.occurredAt.startsWith(currentMonth),
    );
    const monthExpense = sumContractAmounts(monthlyPayments);
    const paidAmount = sumContractAmounts(payments);
    const categoryLabels: Record<ContractExpenseCategory, string> = {
      rent: "房租",
      electricity: "电费",
      parking: "车位费",
      car_rental: "租车",
      internet: "网费",
      other: "其他",
    };
    return {
      basis: monthExpense,
      monthExpense,
      unpaidAmount: remainingContractAmount(currentAmount, paidAmount),
      lines: EXPENSE_CATEGORIES.map((expenseCategory) => ({
        key: expenseCategory,
        label: categoryLabels[expenseCategory],
        amount: sumContractAmounts(
          monthlyPayments.filter(
            (record) => record.expenseCategory === expenseCategory,
          ),
        ),
      })),
      note: "本月支出按有效付款凭证的付款日期和支出分类汇总。",
    };
  }

  const monthlyReceipts = receipts.filter((record) =>
    record.occurredAt.startsWith(currentMonth),
  );
  const yearlyReceipts = receipts.filter((record) =>
    record.occurredAt.startsWith(currentYear),
  );
  const receivedAmount = sumContractAmounts(receipts);
  const common = {
    monthIncome: sumContractAmounts(monthlyReceipts),
    yearIncome: sumContractAmounts(yearlyReceipts),
    unreceivedAmount: remainingContractAmount(currentAmount, receivedAmount),
  };

  if (category === "main_business") {
    const { total, usedRates } = aggregateMainBusinessIncome(
      receipts,
      rateHistory,
    );
    const hasMixedRates = Object.values(usedRates).some(
      (rates) => rates.size > 1,
    );
    return {
      ...common,
      basis: centsToAmount(total.accountingBaseCents),
      lines: [
        {
          key: "contractAmount",
          label: "合同回款",
          amount: centsToAmount(total.contractAmountCents),
        },
        {
          key: "tax",
          label: "税费",
          amount: centsToAmount(total.taxCents),
          rate: uniformRate(usedRates.tax, fallbackRates.tax),
        },
        {
          key: "marketingReserve",
          label: "预扣营销",
          amount: centsToAmount(total.marketingReserveCents),
          rate: uniformRate(usedRates.marketing, fallbackRates.marketing),
        },
        {
          key: "businessCost",
          label: "商务费用",
          amount: centsToAmount(total.businessCostCents),
          rate: uniformRate(usedRates.business, fallbackRates.business),
        },
        {
          key: "accountingBase",
          label: "核算基数",
          amount: centsToAmount(total.accountingBaseCents),
          emphasized: true,
        },
      ],
      note: hasMixedRates
        ? "该合同累计回款存在多套历史费率，系统已按每笔有效回单的回款日期分别核算后汇总。"
        : "合同核算按该合同全部已确认回款累计计算，并按每笔回款日期匹配当时生效费率。",
    };
  }

  const { total, usedRates } = aggregateNonMainIncome(receipts, rateHistory);
  const hasMixedRates = Object.values(usedRates).some(
    (rates) => rates.size > 1,
  );
  return {
    ...common,
    basis: centsToAmount(total.accountingBaseCents),
    lines: [
      {
        key: "contractAmount",
        label: "合同回款",
        amount: centsToAmount(total.contractAmountCents),
      },
      {
        key: "financialCost",
        label: "财务成本",
        amount: centsToAmount(total.financialCostCents),
        rate: uniformRate(usedRates.financial, fallbackRates.financial),
      },
      {
        key: "tax",
        label: "税费",
        amount: centsToAmount(total.taxCents),
        rate: uniformRate(usedRates.tax, fallbackRates.tax),
      },
      {
        key: "accountingBase",
        label: "核算基数",
        amount: centsToAmount(total.accountingBaseCents),
        emphasized: true,
      },
    ],
    note: hasMixedRates
      ? "该合同累计回款存在多套历史费率，系统已按每笔有效回单的回款日期分别核算后汇总。"
      : "合同核算按该合同全部已确认回款累计计算，并按每笔回款日期匹配当时生效费率。",
  };
}

interface ContractRateMutationItem {
  rateCode: ContractRateCode;
  rateValue: number;
}

function parseContractRateMutation(body: Record<string, unknown>): {
  effectiveFrom: string;
  changeReason: string | null;
  items: ContractRateMutationItem[];
} {
  const effectiveFrom = normalizeDate(
    body.effectiveFrom ?? body.effectiveDate,
    "费率生效日期",
  );
  const rawItems: Array<{ rateCode: unknown; rateValue: unknown }> = [];
  if (Array.isArray(body.items)) {
    for (const item of body.items) {
      if (!item || typeof item !== "object") {
        throw new ContractDomainError(400, "费率明细格式不正确");
      }
      const record = item as Record<string, unknown>;
      rawItems.push({
        rateCode: record.rateCode ?? record.rate_code,
        rateValue: record.rateValue ?? record.rate_value,
      });
    }
  } else if (body.rates && typeof body.rates === "object") {
    for (const [rateCode, rateValue] of Object.entries(
      body.rates as Record<string, unknown>,
    )) {
      rawItems.push({ rateCode, rateValue });
    }
  } else {
    rawItems.push({
      rateCode: body.rateCode ?? body.rate_code,
      rateValue: body.rateValue ?? body.rate_value,
    });
  }
  if (rawItems.length === 0) {
    throw new ContractDomainError(400, "至少提交一项费率");
  }
  const items = rawItems.map((item) => {
    const rateCode = String(item.rateCode || "") as ContractRateCode;
    if (!(RATE_CODES as readonly string[]).includes(rateCode)) {
      throw new ContractDomainError(400, "费率代码不正确");
    }
    const rateValue = Number(item.rateValue);
    if (!Number.isFinite(rateValue) || rateValue < 0 || rateValue > 1) {
      throw new ContractDomainError(400, "费率值必须是 0 至 1 之间的小数");
    }
    const basisPoints = rateValue * 10_000;
    if (Math.abs(basisPoints - Math.round(basisPoints)) > 1e-8) {
      throw new ContractDomainError(
        400,
        "费率最多精确到 1 个基点（百分比两位小数）",
        "CONTRACT_RATE_PRECISION_INVALID",
      );
    }
    return { rateCode, rateValue: Math.round(basisPoints) / 10_000 };
  });
  if (new Set(items.map((item) => item.rateCode)).size !== items.length) {
    throw new ContractDomainError(400, "同一费率代码不能重复提交");
  }
  return {
    effectiveFrom,
    changeReason: normalizeNullableText(body.changeReason ?? body.reason),
    items,
  };
}

function toRateApi(row: Record<string, unknown>) {
  return {
    id: row.id,
    rateCode: row.rate_code,
    rateValue: Number(row.rate_value),
    effectiveFrom: String(row.effective_from || "").slice(0, 10),
    effectiveTo: row.effective_to
      ? String(row.effective_to).slice(0, 10)
      : null,
    isActive: Boolean(row.is_active),
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    changeReason: row.change_reason,
    createdAt: row.created_at,
  };
}

router.get("/meta", requireContractLedgerRead, async (_req, res) => {
  try {
    const [rates, projects] = await Promise.all([
      loadCurrentRates(),
      db.all<{
        id: string;
        name: string;
        client_name: string;
        district: string;
      }>(
        `SELECT id, name, client_name, district FROM worklog_projects
         WHERE is_completed = FALSE ORDER BY name ASC`,
      ),
    ]);
    res.json({
      success: true,
      data: {
        categories: [
          { value: "main_business", label: "主营项目合同" },
          { value: "non_main", label: "非主营项目合同" },
          { value: "asset", label: "资产类合同" },
        ],
        assetCategories: [...ASSET_CATEGORIES],
        declaredSubtypeOptions: DECLARED_SUBTYPE_OPTIONS,
        assetCategoryOptions: [
          { value: "procurement", label: "采购合同" },
          { value: "software", label: "软件合同" },
          { value: "equipment", label: "设备合同" },
          { value: "house_rental", label: "房屋租赁" },
          { value: "vehicle_rental", label: "汽车租赁" },
          { value: "parking_space", label: "车位租赁" },
          { value: "office_asset", label: "办公资产合同" },
          { value: "other", label: "其他" },
        ],
        expenseCategories: [...EXPENSE_CATEGORIES],
        expenseCategoryOptions: [
          { value: "rent", label: "房租" },
          { value: "electricity", label: "电费" },
          { value: "parking", label: "车位费" },
          { value: "car_rental", label: "租车" },
          { value: "internet", label: "网费" },
          { value: "other", label: "其他" },
        ],
        relationTypes: [
          { value: "main", label: "主合同" },
          { value: "supplement", label: "补充协议" },
          { value: "termination", label: "解除协议书" },
        ],
        statuses: [
          { value: "draft", label: "草拟中" },
          { value: "approving", label: "审批中" },
          { value: "pending_seal", label: "待盖章" },
          { value: "effective", label: "生效中" },
          { value: "executing", label: "执行中" },
          { value: "completed", label: "已完成" },
          { value: "rejected", label: "已拒绝" },
          { value: "terminated", label: "终止" },
        ],
        fileTypes: [...FILE_TYPES],
        rates: rates.decimal,
        areas: [...BEIJING_ADMINISTRATIVE_AREAS],
        defaultArea: "",
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          clientName: project.client_name,
          area: project.district,
        })),
      },
    });
  } catch (error) {
    sendError(res, error, "获取合同基础配置失败");
  }
});

router.get("/rates", requireContractRead, async (_req, res) => {
  try {
    const [rows, current] = await Promise.all([
      db.all<Record<string, unknown>>(
        `SELECT rate.*, creator.name AS created_by_name
         FROM contract_rate_configs rate
         LEFT JOIN users creator ON creator.id = rate.created_by
         ORDER BY rate.rate_code ASC, rate.effective_from DESC, rate.created_at DESC`,
      ),
      loadCurrentRates(),
    ]);
    res.json({
      success: true,
      data: {
        items: rows.map(toRateApi),
        current: current.decimal,
      },
    });
  } catch (error) {
    sendError(res, error, "获取合同费率历史失败");
  }
});

router.post("/rates", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const mutation = parseContractRateMutation(
      (req.body || {}) as Record<string, unknown>,
    );
    const created = await db.transaction(async (client) => {
      const sortedItems = [...mutation.items].sort((left, right) =>
        left.rateCode.localeCompare(right.rateCode),
      );
      const inserted: Record<string, unknown>[] = [];
      for (const item of sortedItems) {
        await client.query(
          `SELECT pg_advisory_xact_lock(
             hashtextextended('contract-rate:' || $1, 0)
           )`,
          [item.rateCode],
        );
        const duplicated = await client.query<{ id: string }>(
          `SELECT id FROM contract_rate_configs
           WHERE rate_code = $1 AND LEFT(effective_from, 10) = $2
           LIMIT 1 FOR UPDATE`,
          [item.rateCode, mutation.effectiveFrom],
        );
        if (duplicated.rows[0]) {
          throw new ContractDomainError(
            409,
            `${RATE_CODE_LABELS[item.rateCode]}在该生效日期已存在费率配置`,
            "RATE_EFFECTIVE_DATE_CONFLICT",
          );
        }
        const previous = await client.query<{
          id: string;
          effective_to: string | null;
        }>(
          `SELECT id, effective_to FROM contract_rate_configs
           WHERE rate_code = $1 AND is_active = TRUE
             AND LEFT(effective_from, 10) < $2
           ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
          [item.rateCode, mutation.effectiveFrom],
        );
        const next = await client.query<{ effective_from: string }>(
          `SELECT effective_from FROM contract_rate_configs
           WHERE rate_code = $1 AND is_active = TRUE
             AND LEFT(effective_from, 10) > $2
           ORDER BY effective_from ASC LIMIT 1 FOR UPDATE`,
          [item.rateCode, mutation.effectiveFrom],
        );
        const now = new Date().toISOString();
        const previousEnd = previous.rows[0]?.effective_to?.slice(0, 10);
        if (
          previous.rows[0] &&
          (!previousEnd || previousEnd > mutation.effectiveFrom)
        ) {
          await client.query(
            `UPDATE contract_rate_configs
             SET effective_to = $2, updated_at = $3 WHERE id = $1`,
            [previous.rows[0].id, mutation.effectiveFrom, now],
          );
        }
        const id = nanoid();
        const result = await client.query<Record<string, unknown>>(
          `INSERT INTO contract_rate_configs (
             id, rate_code, rate_value, effective_from, effective_to,
             is_active, created_by, change_reason, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,$8,$8)
           RETURNING *`,
          [
            id,
            item.rateCode,
            item.rateValue,
            mutation.effectiveFrom,
            next.rows[0]?.effective_from || null,
            currentActor.id,
            mutation.changeReason,
            now,
          ],
        );
        inserted.push({
          ...result.rows[0],
          created_by_name: currentActor.name,
        });
      }
      return inserted;
    });
    const current = await loadCurrentRates();
    res.status(201).json({
      success: true,
      data: {
        items: created.map(toRateApi),
        current: current.decimal,
      },
    });
  } catch (error) {
    sendError(res, error, "新增合同费率失败");
  }
});

router.get("/cancelled", requireFinance, async (req, res) => {
  try {
    const page = positiveIntegerQuery(req.query.page, "页码", 1, 10_000_000);
    const pageSize = positiveIntegerQuery(
      req.query.pageSize,
      "每页条数",
      20,
      100,
    );
    const count = await db.get<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM contracts c
       WHERE c.is_deleted = TRUE
         AND EXISTS (
           SELECT 1 FROM contract_audit_logs audit
           WHERE audit.contract_id = c.id
             AND audit.action = 'contract_cancelled_before_seal'
         )`,
    );
    const rows = await db.all<Record<string, unknown>>(
      `SELECT c.*, cancellation.actor_id AS cancelled_by,
         cancellation.actor_name AS cancelled_by_name,
         cancellation.actor_role AS cancelled_by_role,
         cancellation.from_status AS cancelled_from_status,
         cancellation.cancellation_reason,
         cancellation.created_at AS cancelled_at
       FROM contracts c
       JOIN LATERAL (
         SELECT audit.actor_id, actor.name AS actor_name, audit.actor_role,
           audit.from_status,
           CASE
             WHEN audit.comment IN ('合同在盖章前撤销', '合同在盖章前被撤销')
               THEN NULL
             ELSE audit.comment
           END AS cancellation_reason,
           audit.created_at
         FROM contract_audit_logs audit
         LEFT JOIN users actor ON actor.id = audit.actor_id
         WHERE audit.contract_id = c.id
           AND audit.action = 'contract_cancelled_before_seal'
         ORDER BY audit.created_at DESC, audit.id DESC LIMIT 1
       ) cancellation ON TRUE
       WHERE c.is_deleted = TRUE
       ORDER BY cancellation.created_at DESC, c.id DESC
       LIMIT ? OFFSET ?`,
      pageSize,
      (page - 1) * pageSize,
    );
    const items = await Promise.all(
      rows.map(async (row) => {
        const files = await db.all<Record<string, unknown>>(
          `SELECT id, file_type, file_name, file_size, mime_type,
             version, created_at
           FROM contract_files
           WHERE contract_id = ?
           ORDER BY created_at ASC, id ASC`,
          String(row.id),
        );
        return {
          ...toContractApi(row),
          name:
            row.title || row.project_name || row.contract_no || "未命名合同",
          amount: Number(row.amount_delta || 0),
          cancelledBy: row.cancelled_by,
          cancelledByName: row.cancelled_by_name,
          cancelledByRole: row.cancelled_by_role,
          cancelledFromStatus: row.cancelled_from_status,
          cancellationReason: row.cancellation_reason,
          cancelledAt: row.cancelled_at,
          files: files.map((file) => ({
            id: file.id,
            fileType: file.file_type,
            fileName: file.file_name,
            fileSize: Number(file.file_size || 0),
            mimeType: file.mime_type,
            version: Number(file.version || 1),
            createdAt: file.created_at,
          })),
        };
      }),
    );
    res.json({
      success: true,
      data: { items, total: Number(count?.count || 0), page, pageSize },
    });
  } catch (error) {
    sendError(res, error, "获取已撤销合同失败");
  }
});

router.get("/", requireContractLedgerRead, async (req, res) => {
  try {
    const currentActor = actor(req);
    const page = positiveIntegerQuery(req.query.page, "页码", 1, 10_000_000);
    const pageSize = positiveIntegerQuery(
      req.query.pageSize,
      "每页条数",
      20,
      100,
    );
    const where = [
      "c.is_deleted = FALSE",
      `(c.relation_type = 'main' OR NOT ${currentSealedContractFileExists("c")})`,
    ];
    const params: unknown[] = [];
    const restrictedAreaViewer = requiresRestrictedContractArea(
      currentActor.role,
    );
    if (restrictedAreaViewer) {
      where.push("c.area <> '全部'");
      where.push(
        `EXISTS (
          SELECT 1 FROM contracts visibility_root
          WHERE visibility_root.id = COALESCE(c.root_contract_id, c.id)
            AND visibility_root.is_deleted = FALSE
            AND visibility_root.area <> '全部'
        )`,
      );
    }
    const addFilter = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql);
    };
    const categories = validateQueryEnumList(
      req.query.category,
      CONTRACT_CATEGORIES,
      "合同分类",
    );
    const statuses = validateQueryEnumList(
      req.query.status,
      CONTRACT_STATUSES,
      "合同状态",
    );
    if (categories.length > 0) {
      addFilter(
        "COALESCE(c.category, c.declared_category) = ANY(?::text[])",
        categories,
      );
    }
    if (statuses.length > 0) {
      addFilter("c.status = ANY(?::text[])", statuses);
    }
    const settlementStatus = optionalQueryScalar(
      req.query.settlementStatus,
      "合同结算状态",
    );
    if (settlementStatus) {
      if (
        !(CONTRACT_SETTLEMENT_STATUSES as readonly string[]).includes(
          settlementStatus,
        )
      ) {
        throw new ContractDomainError(400, "合同结算状态不正确");
      }
      const settlementCondition =
        settlementStatus === "unsettled"
          ? "settlement.settled_amount = 0"
          : settlementStatus === "partial"
            ? "settlement.settled_amount > 0 AND settlement.settled_amount < settlement.current_amount"
            : "settlement.settled_amount >= settlement.current_amount";
      where.push(
        `EXISTS (
          SELECT 1
          FROM contracts settlement_root
          CROSS JOIN LATERAL (
            SELECT
              ${currentFixedContractAmountExpression("settlement_root")} AS current_amount,
              CASE WHEN settlement_root.category = 'asset'
                AND settlement_root.asset_funding_mode = 'engineering_to_technology'
              THEN COALESCE((
                SELECT SUM(settlement_payment.amount)
                FROM contract_external_payments settlement_payment
                JOIN contracts settlement_payment_contract
                  ON settlement_payment_contract.id = settlement_payment.contract_id
                WHERE COALESCE(
                    settlement_payment_contract.root_contract_id,
                    settlement_payment_contract.id
                  ) = settlement_root.id
                  AND settlement_payment_contract.is_deleted = FALSE
                  AND settlement_payment_contract.status <> 'rejected'
                  AND ${confirmedFinancialPredicate("settlement_payment")}
              ), 0) WHEN settlement_root.category = 'asset' THEN COALESCE((
                SELECT SUM(settlement_payment.amount)
                FROM contract_payments settlement_payment
                JOIN contracts settlement_payment_contract
                  ON settlement_payment_contract.id = settlement_payment.contract_id
                WHERE COALESCE(
                    settlement_payment_contract.root_contract_id,
                    settlement_payment_contract.id
                  ) = settlement_root.id
                  AND settlement_payment_contract.is_deleted = FALSE
                  AND settlement_payment_contract.status <> 'rejected'
                  AND ${confirmedFinancialPredicate("settlement_payment")}
              ), 0) ELSE COALESCE((
                SELECT SUM(settlement_receipt.amount)
                FROM contract_receipts settlement_receipt
                JOIN contracts settlement_receipt_contract
                  ON settlement_receipt_contract.id = settlement_receipt.contract_id
                WHERE COALESCE(
                    settlement_receipt_contract.root_contract_id,
                    settlement_receipt_contract.id
                  ) = settlement_root.id
                  AND settlement_receipt_contract.is_deleted = FALSE
                  AND settlement_receipt_contract.status <> 'rejected'
                  AND ${confirmedFinancialPredicate("settlement_receipt")}
              ), 0) END AS settled_amount
          ) settlement
          WHERE settlement_root.id = COALESCE(c.root_contract_id, c.id)
            AND settlement_root.is_deleted = FALSE
            AND settlement_root.status IN ('effective', 'executing', 'completed')
            AND settlement_root.category IN ('main_business', 'non_main', 'asset')
            AND settlement.current_amount IS NOT NULL
            AND ${settlementCondition}
        )`,
      );
    }
    const projectId = optionalQueryScalar(req.query.projectId, "项目编号");
    if (projectId) addFilter("c.project_id = ?", projectId);
    const area = optionalQueryScalar(req.query.area, "所属区域");
    if (area) addFilter("c.area = ?", area);
    const relationType = optionalQueryScalar(
      req.query.relationType,
      "合同关系",
    );
    if (relationType) {
      if (!(RELATION_TYPES as readonly string[]).includes(relationType)) {
        throw new ContractDomainError(400, "合同关系类型不正确");
      }
      addFilter("c.relation_type = ?", relationType);
    }
    const counterparty = optionalQueryScalar(
      req.query.counterparty,
      "合同相对方",
    );
    if (counterparty) {
      const value = `%${counterparty}%`;
      params.push(value, value, value, value);
      where.push(
        `EXISTS (
          SELECT 1 FROM contracts counterparty_contract
          WHERE COALESCE(
              counterparty_contract.root_contract_id,
              counterparty_contract.id
            ) = COALESCE(c.root_contract_id, c.id)
            AND counterparty_contract.is_deleted = FALSE
            AND (
              counterparty_contract.party_a ILIKE ?
              OR counterparty_contract.party_b ILIKE ?
              OR counterparty_contract.title ILIKE ?
              OR counterparty_contract.project_name ILIKE ?
            )
        )`,
      );
    }
    const contractDateFromValue = optionalQueryScalar(
      req.query.contractDateFrom,
      "合同日期起始值",
    );
    const contractDateToValue = optionalQueryScalar(
      req.query.contractDateTo,
      "合同日期结束值",
    );
    const contractDateFrom = contractDateFromValue
      ? normalizeDate(contractDateFromValue, "合同日期起始值")
      : null;
    const contractDateTo = contractDateToValue
      ? normalizeDate(contractDateToValue, "合同日期结束值")
      : null;
    if (
      contractDateFrom &&
      contractDateTo &&
      contractDateFrom > contractDateTo
    ) {
      throw new ContractDomainError(400, "合同日期起始值不能晚于结束值");
    }
    if (contractDateFrom) {
      addFilter(`${rootContractDateExpression("c")} >= ?`, contractDateFrom);
    }
    if (contractDateTo) {
      addFilter(`${rootContractDateExpression("c")} <= ?`, contractDateTo);
    }
    const keyword = optionalQueryScalar(
      req.query.keyword ?? req.query.q,
      "搜索关键词",
    );
    if (keyword) {
      params.push(`%${keyword}%`);
      where.push(
        `(c.project_name ILIKE ? OR c.party_a ILIKE ? OR c.party_b ILIKE ? OR c.contract_no ILIKE ? OR c.business_contract_no ILIKE ? OR c.title ILIKE ?)`,
      );
      const value = params[params.length - 1];
      params.push(value, value, value, value, value);
    }
    const count = await db.get<{ count: number }>(
      `SELECT COUNT(DISTINCT COALESCE(c.root_contract_id, c.id))::int AS count
       FROM contracts c WHERE ${where.join(" AND ")}`,
      ...params,
    );
    const currentMonth = currentShanghaiDate().slice(0, 7);
    const summaryRow = await db.get<{
      total_amount: number;
      all_contract_amount: number;
      pending_signature_amount: number;
      effective_income_contract_amount: number;
      effective_expense_contract_amount: number;
      effective_contract_count: number;
      effective_income_contract_count: number;
      effective_expense_contract_count: number;
      pending_signature_contract_count: number;
      received_amount: number;
      paid_amount: number;
      month_income: number;
      unreceived_amount: number;
      pending_approval_count: number;
      pending_seal_count: number;
      lease_expiring_count: number;
    }>(
      `WITH filtered AS (
         SELECT c.* FROM contracts c WHERE ${where.join(" AND ")}
       ), selected_roots AS (
         SELECT DISTINCT COALESCE(root_contract_id, id) AS root_id
         FROM filtered
         WHERE status <> 'rejected'
       ), root_metrics AS (
         SELECT root.id AS root_id,
           COALESCE(root.category, root.declared_category) AS category,
           root.status AS root_status,
           root.financial_direction,
           ${contributesToCurrentAmount("root")} AS is_effective,
           ${pendingSignatureContractPredicate("root")} AS is_pending_signature,
           CASE WHEN ${contributesToCurrentAmount("root")}
             THEN ${currentFixedContractAmountExpression("root")}
             ELSE 0 END AS current_amount,
           CASE WHEN ${pendingSignatureContractPredicate("root")}
             THEN ${currentFixedContractAmountExpression("root")}
             ELSE 0 END AS pending_signature_amount
         FROM selected_roots selected
         JOIN contracts root ON root.id = selected.root_id AND root.is_deleted = FALSE
       ), financial_metrics AS (
         SELECT roots.root_id,
           CASE WHEN roots.root_status = 'rejected'
             OR roots.financial_direction <> 'income' THEN 0 ELSE COALESCE((
             SELECT SUM(receipt.amount)
             FROM contract_receipts receipt
             JOIN contracts c ON c.id = receipt.contract_id
               WHERE COALESCE(c.root_contract_id, c.id) = roots.root_id
                 AND c.is_deleted = FALSE
                 AND c.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("receipt")}
           ), 0) END AS received_amount,
           CASE WHEN roots.root_status = 'rejected'
             OR roots.financial_direction <> 'cost' THEN 0 ELSE COALESCE((
             SELECT SUM(payment.amount)
             FROM contract_payments payment
             JOIN contracts c ON c.id = payment.contract_id
               WHERE COALESCE(c.root_contract_id, c.id) = roots.root_id
                 AND c.is_deleted = FALSE
                 AND c.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("payment")}
           ), 0) END AS paid_amount,
           CASE WHEN roots.root_status = 'rejected'
             OR roots.financial_direction <> 'income' THEN 0 ELSE COALESCE((
               SELECT SUM(receipt.amount)
               FROM contract_receipts receipt
             JOIN contracts c ON c.id = receipt.contract_id
             WHERE COALESCE(c.root_contract_id, c.id) = roots.root_id
                 AND c.is_deleted = FALSE
                 AND c.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("receipt")}
                 AND LEFT(receipt.receipt_date, 7) = ?
             ), 0) END AS month_income
         FROM root_metrics roots
       )
       SELECT
         COALESCE(SUM(root_metrics.current_amount), 0) AS total_amount,
         COALESCE(SUM(
           root_metrics.current_amount + root_metrics.pending_signature_amount
         ), 0) AS all_contract_amount,
         COALESCE(SUM(root_metrics.pending_signature_amount), 0)
           AS pending_signature_amount,
         COALESCE(SUM(root_metrics.current_amount) FILTER (
           WHERE root_metrics.category IN ('main_business', 'non_main')
         ), 0) AS effective_income_contract_amount,
         COALESCE(SUM(root_metrics.current_amount) FILTER (
           WHERE root_metrics.category = 'asset'
         ), 0) AS effective_expense_contract_amount,
         COUNT(*) FILTER (WHERE root_metrics.is_effective)::int
           AS effective_contract_count,
         COUNT(*) FILTER (
           WHERE root_metrics.is_effective
             AND root_metrics.category IN ('main_business', 'non_main')
         )::int AS effective_income_contract_count,
         COUNT(*) FILTER (
           WHERE root_metrics.is_effective
             AND root_metrics.category = 'asset'
         )::int AS effective_expense_contract_count,
         COUNT(*) FILTER (WHERE root_metrics.is_pending_signature)::int
           AS pending_signature_contract_count,
         COALESCE(SUM(financial_metrics.received_amount), 0) AS received_amount,
         COALESCE(SUM(financial_metrics.paid_amount), 0) AS paid_amount,
         COALESCE(SUM(financial_metrics.month_income), 0) AS month_income,
         COALESCE(SUM(CASE WHEN root_metrics.financial_direction = 'income'
           THEN GREATEST(root_metrics.current_amount - financial_metrics.received_amount, 0)
           ELSE 0 END), 0) AS unreceived_amount,
         (SELECT COUNT(*)::int FROM filtered WHERE status = 'approving')
           AS pending_approval_count,
         (SELECT COUNT(*)::int FROM filtered WHERE status = 'pending_seal')
           AS pending_seal_count,
         (SELECT COUNT(*)::int FROM filtered lease_source
          WHERE lease_source.lease_end_date IS NOT NULL
            AND lease_source.relation_type = 'main'
            AND lease_source.status IN ('effective', 'executing', 'completed')
            AND (
              lease_source.status <> 'completed'
              OR lease_source.lease_end_date >= TO_CHAR(
                CURRENT_DATE, 'YYYY-MM-DD'
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM contracts renewal
              WHERE renewal.renewed_from_contract_id = lease_source.id
                AND renewal.is_deleted = FALSE
                AND renewal.status IN (
                  'effective', 'executing', 'completed', 'terminated'
                )
            )
            AND lease_source.lease_end_date <= TO_CHAR(
              (CURRENT_DATE + INTERVAL '1 month'), 'YYYY-MM-DD'
            )) AS lease_expiring_count
       FROM root_metrics
       LEFT JOIN financial_metrics
         ON financial_metrics.root_id = root_metrics.root_id`,
      ...params,
      currentMonth,
    );
    const rootOrder =
      statuses.length === 1 && statuses[0] === "approving"
        ? "list_page.sort_submitted ASC NULLS LAST, list_page.sort_updated ASC, list_page.root_id ASC"
        : (FINANCE_ROLES as readonly string[]).includes(currentActor.role)
          ? "CASE WHEN list_page.has_expiring_lease THEN 0 ELSE 1 END, list_page.sort_contract_date DESC NULLS LAST, list_page.sort_updated DESC, list_page.root_id DESC"
          : "list_page.sort_contract_date DESC NULLS LAST, list_page.sort_updated DESC, list_page.root_id DESC";
    const rows = await db.all<Record<string, any>>(
      `WITH root_metrics AS (
         SELECT root.id AS root_id,
           root.status AS root_status,
           root.financial_direction,
           root.asset_funding_mode,
           root.declared_subtype,
           CASE WHEN root.status IN ('rejected', 'terminated') THEN 0
             ELSE COALESCE(
               root.current_effective_amount,
               root.original_contract_amount,
               root.amount_delta,
               0
             ) END AS current_amount,
           CASE WHEN root.status IN ('rejected', 'terminated') THEN 0
             ELSE COALESCE((
               SELECT pending.amount_after_change
               FROM contracts pending
               WHERE pending.root_contract_id = root.id
                 AND pending.relation_type = 'supplement'
                 AND pending.is_deleted = FALSE
                 AND pending.status IN ('approving', 'pending_seal')
                 AND pending.amount_after_change IS NOT NULL
               ORDER BY pending.supplement_sequence DESC NULLS LAST,
                 pending.created_at DESC, pending.id DESC
               LIMIT 1
             ), root.current_effective_amount, root.original_contract_amount,
               root.amount_delta, 0) END AS projected_amount,
           COUNT(*) FILTER (
             WHERE child.relation_type = 'supplement'
               AND child.status IN ('approving', 'pending_seal')
           )::int AS pending_supplement_count,
           COUNT(*) FILTER (
             WHERE child.relation_type = 'supplement'
               AND child.status <> 'rejected'
           )::int AS supplement_agreement_count,
           COUNT(*) FILTER (
             WHERE child.relation_type = 'termination'
               AND child.status <> 'rejected'
           )::int AS termination_agreement_count,
           COUNT(*) FILTER (
             WHERE child.relation_type IN ('supplement', 'termination')
               AND child.status <> 'rejected'
           )::int AS related_agreement_count
         FROM contracts root
         LEFT JOIN contracts child
           ON COALESCE(child.root_contract_id, child.id) = root.id
          AND child.is_deleted = FALSE
         WHERE COALESCE(root.root_contract_id, root.id) = root.id
           AND root.is_deleted = FALSE
         GROUP BY root.id, root.status, root.financial_direction,
           root.asset_funding_mode, root.declared_subtype,
           root.current_effective_amount
       ), financial_metrics AS (
         SELECT roots.root_id,
           CASE WHEN roots.root_status = 'rejected'
             OR roots.financial_direction IS NULL THEN 0 ELSE COALESCE((SELECT SUM(i.amount) FROM contract_invoices i
             JOIN contracts ci ON ci.id = i.contract_id
             WHERE COALESCE(ci.root_contract_id, ci.id) = roots.root_id
               AND ci.status <> 'rejected'
               AND ${confirmedFinancialPredicate("i")}), 0) END AS invoice_amount,
           CASE WHEN roots.root_status = 'rejected'
             OR roots.financial_direction <> 'income' THEN 0 ELSE COALESCE((SELECT SUM(r.amount) FROM contract_receipts r
             JOIN contracts cr ON cr.id = r.contract_id
             WHERE COALESCE(cr.root_contract_id, cr.id) = roots.root_id
               AND cr.status <> 'rejected'
               AND ${confirmedFinancialPredicate("r")}), 0) END AS received_amount,
           CASE WHEN roots.root_status = 'rejected'
             OR roots.financial_direction <> 'cost' THEN 0 ELSE COALESCE((SELECT SUM(pay.amount) FROM contract_payments pay
             JOIN contracts cp ON cp.id = pay.contract_id
             WHERE COALESCE(cp.root_contract_id, cp.id) = roots.root_id
               AND cp.status <> 'rejected'
               AND ${confirmedFinancialPredicate("pay")}), 0) END AS paid_amount,
           CASE WHEN roots.root_status = 'rejected'
             OR roots.financial_direction <> 'cost' THEN 0 ELSE COALESCE((SELECT SUM(pay.amount) FROM contract_external_payments pay
             JOIN contracts cp ON cp.id = pay.contract_id
             WHERE COALESCE(cp.root_contract_id, cp.id) = roots.root_id
               AND cp.status <> 'rejected'
               AND ${confirmedFinancialPredicate("pay")}), 0) END AS external_paid_amount,
           CASE WHEN roots.root_status = 'rejected'
             OR roots.financial_direction <> 'cost' THEN 0
             ELSE ${contractCostSettlementAmountSql({
               rootAlias: "roots",
               rootIdExpression: "roots.root_id",
             })} END AS cost_settled_amount,
           CASE
             WHEN roots.root_status NOT IN ('completed', 'terminated') THEN NULL
             WHEN roots.financial_direction = 'income' THEN (
               SELECT MAX(receipt.receipt_date)
               FROM contract_receipts receipt
               JOIN contracts receipt_contract ON receipt_contract.id = receipt.contract_id
               WHERE COALESCE(receipt_contract.root_contract_id, receipt_contract.id) = roots.root_id
                 AND receipt_contract.is_deleted = FALSE
                 AND receipt_contract.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("receipt")}
             )
             WHEN roots.financial_direction = 'cost' THEN
               ${contractCostSettlementLastDateSql({
                 rootAlias: "roots",
                 rootIdExpression: "roots.root_id",
               })}
             ELSE NULL
           END AS contract_cutoff_date
         FROM root_metrics roots
       ), matching_roots AS (
         SELECT COALESCE(c.root_contract_id, c.id) AS root_id,
           MAX(c.updated_at) AS sort_updated,
           MAX(c.contract_date) FILTER (WHERE c.relation_type = 'main')
             AS sort_contract_date,
           MIN(c.submitted_at) FILTER (WHERE c.status = 'approving')
             AS sort_submitted,
           BOOL_OR(c.relation_type = 'main'
             AND c.lease_end_date IS NOT NULL
             AND c.status IN ('effective', 'executing', 'completed')
             AND (
               c.status <> 'completed'
               OR c.lease_end_date >= TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
             )
             AND NOT EXISTS (
               SELECT 1 FROM contracts renewal
               WHERE renewal.renewed_from_contract_id = c.id
                 AND renewal.is_deleted = FALSE
                 AND renewal.status IN (
                   'effective', 'executing', 'completed', 'terminated'
                 )
             )
             AND c.lease_end_date <= TO_CHAR(
               (CURRENT_DATE + INTERVAL '1 month'), 'YYYY-MM-DD'
             )) AS has_expiring_lease,
           MIN(c.lease_end_date) FILTER (
             WHERE c.relation_type = 'main'
               AND c.lease_end_date IS NOT NULL
               AND c.status IN ('effective', 'executing', 'completed')
               AND (
                 c.status <> 'completed'
                 OR c.lease_end_date >= TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
               )
               AND NOT EXISTS (
                 SELECT 1 FROM contracts renewal
                 WHERE renewal.renewed_from_contract_id = c.id
                   AND renewal.is_deleted = FALSE
                   AND renewal.status IN (
                   'effective', 'executing', 'completed', 'terminated'
                 )
               )
               AND c.lease_end_date <= TO_CHAR(
                 (CURRENT_DATE + INTERVAL '1 month'), 'YYYY-MM-DD'
               )
           ) AS earliest_lease_end
         FROM contracts c
         WHERE ${where.join(" AND ")}
         GROUP BY COALESCE(c.root_contract_id, c.id)
       ), paged_roots AS (
         SELECT list_page.*
         FROM matching_roots AS list_page
         ORDER BY ${rootOrder}
         LIMIT ? OFFSET ?
       )
       SELECT c.*, p.name AS linked_project_name,
         creator.name AS owner_name,
         EXISTS(
           SELECT 1 FROM contract_audit_logs historical_audit
           WHERE historical_audit.contract_id=COALESCE(c.root_contract_id,c.id)
             AND historical_audit.action='historical_contract_imported'
         ) AS historical_imported,
         draft_file.file_name AS source_file_name,
         approval_round.id AS approval_round_id,
         approval_round.approval_kind AS approval_kind,
         approval_round.target_approver_id AS approval_target_id,
         approval_round.target_approver_name_snapshot AS approval_target_name,
         approval_round.target_approver_role_snapshot AS approval_target_role,
         approval_round.target_source AS approval_target_source,
         approval_round.submitted_at AS approval_round_submitted_at,
         renewal_successor.id AS renewal_contract_id,
         renewal_successor.status AS renewal_contract_status,
         renewal_successor.name AS renewal_contract_name,
         rm.financial_direction AS group_financial_direction,
         CASE WHEN c.status = 'rejected' THEN 0
           ELSE COALESCE(rm.current_amount, 0) END AS current_amount,
         CASE WHEN c.status = 'rejected' THEN 0
           ELSE COALESCE(rm.projected_amount, rm.current_amount, 0)
         END AS projected_amount,
         COALESCE(rm.pending_supplement_count, 0)
           AS pending_supplement_count,
         COALESCE(rm.supplement_agreement_count, 0)
           AS supplement_agreement_count,
         COALESCE(rm.termination_agreement_count, 0)
           AS termination_agreement_count,
         COALESCE(rm.related_agreement_count, 0)
           AS related_agreement_count,
         CASE WHEN c.status = 'rejected' THEN 0
           ELSE COALESCE(fm.invoice_amount, 0) END AS invoice_amount,
         CASE WHEN c.status = 'rejected' THEN 0
           ELSE COALESCE(fm.received_amount, 0) END AS received_amount,
         CASE WHEN c.status = 'rejected' THEN 0
           ELSE COALESCE(fm.paid_amount, 0) END AS paid_amount,
         CASE WHEN c.status = 'rejected' THEN 0
           ELSE COALESCE(fm.external_paid_amount, 0) END AS external_paid_amount
         ,CASE WHEN c.status = 'rejected' THEN 0
           ELSE COALESCE(fm.cost_settled_amount, 0) END AS cost_settled_amount
         ,fm.contract_cutoff_date AS contract_cutoff_date
         ,${currentSealedContractFileExists("c")}
           AS has_sealed_contract_file
         ,CASE WHEN c.relation_type = 'main'
             AND c.lease_end_date IS NOT NULL
             AND c.status IN ('effective', 'executing', 'completed')
             AND (
               c.status <> 'completed'
               OR c.lease_end_date >= TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
             )
             AND NOT EXISTS (
               SELECT 1 FROM contracts renewal
               WHERE renewal.renewed_from_contract_id = c.id
                 AND renewal.is_deleted = FALSE
                 AND renewal.status IN (
                   'effective', 'executing', 'completed', 'terminated'
                 )
             )
             AND c.lease_end_date <= TO_CHAR(
               (CURRENT_DATE + INTERVAL '1 month'), 'YYYY-MM-DD'
             )
           THEN TRUE ELSE FALSE END AS lease_expiring_soon
       FROM paged_roots AS list_page
       JOIN contracts c
         ON COALESCE(c.root_contract_id, c.id) = list_page.root_id
        AND c.is_deleted = FALSE
        AND (
          c.relation_type = 'main'
          OR NOT ${currentSealedContractFileExists("c")}
        )
        ${restrictedAreaViewer ? "AND c.area <> '全部'" : ""}
       LEFT JOIN worklog_projects p ON p.id = c.project_id
       LEFT JOIN users creator ON creator.id = c.created_by
       LEFT JOIN LATERAL (
         SELECT file.file_name
         FROM contract_files file
         WHERE file.contract_id = c.id
           AND file.file_type = 'draft_contract'
           AND file.is_current = TRUE
         ORDER BY file.version DESC, file.created_at DESC, file.id DESC
         LIMIT 1
       ) draft_file ON TRUE
       LEFT JOIN LATERAL (
         SELECT approval_round.* FROM contract_approval_rounds approval_round
         WHERE approval_round.contract_id = c.id
           AND approval_round.status = 'pending'
         ORDER BY approval_round.submitted_at DESC, approval_round.id DESC
         LIMIT 1
       ) approval_round ON TRUE
       LEFT JOIN LATERAL (
         SELECT renewal.id, renewal.status,
           COALESCE(
             NULLIF(renewal.title, ''), NULLIF(renewal.project_name, ''),
             renewal.contract_no
           ) AS name
         FROM contracts renewal
         WHERE renewal.renewed_from_contract_id = c.id
           AND renewal.is_deleted = FALSE
           AND renewal.status <> 'rejected'
         ORDER BY renewal.created_at DESC, renewal.id DESC
         LIMIT 1
       ) renewal_successor ON TRUE
       LEFT JOIN root_metrics rm ON rm.root_id = COALESCE(c.root_contract_id, c.id)
       LEFT JOIN financial_metrics fm ON fm.root_id = COALESCE(c.root_contract_id, c.id)
       ORDER BY ${rootOrder},
         CASE c.relation_type
           WHEN 'main' THEN 0
           WHEN 'supplement' THEN 1
           WHEN 'termination' THEN 2
           ELSE 3
         END,
         c.supplement_sequence ASC NULLS LAST,
         c.effective_at ASC NULLS LAST,
         c.created_at ASC,
         c.id ASC`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    let items = rows.map((row) => {
      const currentAmount = safeContractOutputAmount(
        row.current_amount,
        "合同当前金额",
      );
      const receivedAmount = safeContractOutputAmount(
        row.received_amount,
        "合同回款金额",
      );
      const projectedAmount = safeContractOutputAmount(
        row.projected_amount,
        "补充协议变更后合同金额",
      );
      const paidAmount = safeContractOutputAmount(
        row.paid_amount,
        "合同付款金额",
      );
      const externalPaidAmount = safeContractOutputAmount(
        row.external_paid_amount,
        "合同履约付款金额",
      );
      const costSettledAmount = safeContractOutputAmount(
        row.cost_settled_amount,
        "合同履约结算金额",
      );
      const financialDirection = row.group_financial_direction as
        | "income"
        | "cost"
        | null;
      const settledAmount =
        financialDirection === "cost"
          ? costSettledAmount
          : financialDirection === "income"
            ? receivedAmount
            : 0;
      return {
        ...toContractApi({
          ...row,
          financial_direction: financialDirection,
        }),
        name: contractListDisplayName(row),
        amount: Number(row.amount_delta || 0),
        currentAmount,
        projectedAmount,
        pendingSupplementCount: Number(row.pending_supplement_count || 0),
        supplementAgreementCount: Number(row.supplement_agreement_count || 0),
        terminationAgreementCount: Number(row.termination_agreement_count || 0),
        relatedAgreementCount: Number(row.related_agreement_count || 0),
        hasSealedContractFile: Boolean(row.has_sealed_contract_file),
        receivedAmount,
        paidAmount,
        externalPaidAmount,
        costSettledAmount,
        completionRate:
          financialDirection && currentAmount > 0
            ? Math.round((settledAmount / currentAmount) * 10000) / 100
            : null,
      };
    });
    if (currentActor.role === "user") {
      const rootIds = items
        .filter((item) => item.relationType === "main")
        .map((item) => item.id);
      const eligibility = await getInvoiceApplicationEligibilityBatch(
        currentActor,
        rootIds,
      );
      items = items.map((item) => {
        const result = eligibility[item.id];
        return {
          ...item,
          invoiceApplicationEligibility:
            item.relationType === "main" && result
              ? {
                  eligible: result.eligible,
                  reasonCode: result.reasonCode,
                  reason: result.reason,
                  remainingAmount: result.amounts.remainingAmount,
                  pendingAmount: result.amounts.pendingAmount,
                  invoicedAmount: result.amounts.invoicedAmount,
                }
              : null,
        };
      });
    } else {
      items = items.map((item) => ({
        ...item,
        invoiceApplicationEligibility: null,
      }));
    }
    const totalAmount = safeContractOutputAmount(
      summaryRow?.total_amount,
      "有效合同总额",
    );
    const allContractAmount = safeContractOutputAmount(
      summaryRow?.all_contract_amount,
      "全部合同总额",
    );
    const pendingSignatureAmount = safeContractOutputAmount(
      summaryRow?.pending_signature_amount,
      "待签合同金额",
    );
    const effectiveIncomeContractAmount = safeContractOutputAmount(
      summaryRow?.effective_income_contract_amount,
      "有效收入合同额",
    );
    const effectiveExpenseContractAmount = safeContractOutputAmount(
      summaryRow?.effective_expense_contract_amount,
      "有效支出合同额",
    );
    const categorizedEffectiveAmount = sumSafeContractOutputAmounts(
      [effectiveIncomeContractAmount, effectiveExpenseContractAmount],
      "有效收入与支出合同总额",
    );
    if (toCents(categorizedEffectiveAmount) !== toCents(totalAmount)) {
      throw new ContractDomainError(500, "有效收入与支出合同额汇总不一致");
    }
    const receivedAmount = safeContractOutputAmount(
      summaryRow?.received_amount,
      "回款总额",
    );
    const paidAmount = safeContractOutputAmount(
      summaryRow?.paid_amount,
      "付款总额",
    );
    const pendingApprovalCount = Number(
      summaryRow?.pending_approval_count || 0,
    );
    res.json({
      success: true,
      data: {
        items,
        total: Number(count?.count || 0),
        summary: {
          totalAmount,
          currentAmount: totalAmount,
          allContractAmount,
          effectiveContractAmount: totalAmount,
          effectiveIncomeContractAmount,
          effectiveExpenseContractAmount,
          pendingSignatureAmount,
          effectiveContractCount: Number(
            summaryRow?.effective_contract_count || 0,
          ),
          effectiveIncomeContractCount: Number(
            summaryRow?.effective_income_contract_count || 0,
          ),
          effectiveExpenseContractCount: Number(
            summaryRow?.effective_expense_contract_count || 0,
          ),
          pendingSignatureContractCount: Number(
            summaryRow?.pending_signature_contract_count || 0,
          ),
          receivedAmount,
          paidAmount,
          monthIncome: safeContractOutputAmount(
            summaryRow?.month_income,
            "本月收入",
          ),
          unreceivedAmount: safeContractOutputAmount(
            summaryRow?.unreceived_amount,
            "未回款金额",
          ),
          pendingApprovalCount,
          pendingSealCount: Number(summaryRow?.pending_seal_count || 0),
          leaseExpiringCount: Number(summaryRow?.lease_expiring_count || 0),
          pendingCount: pendingApprovalCount,
        },
        page,
        pageSize,
        totalPages: Math.ceil(Number(count?.count || 0) / pageSize),
      },
    });
  } catch (error) {
    sendError(res, error, "获取合同列表失败");
  }
});

router.get("/dashboard", requireContractRead, async (req, res) => {
  try {
    const dashboardActor = actor(req);
    const dashboardAreaVisibility = requiresRestrictedContractArea(
      dashboardActor.role,
    )
      ? "AND root.area <> '全部'"
      : "";
    const { startMonth, endMonth, category, projectId } =
      validateDashboardFilters(req.query);
    const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
    const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
    const periodMonthCount =
      (endYear - startYear) * 12 + endMonthNumber - startMonthNumber + 1;
    const previousPeriodEnd = shiftContractNaturalMonth(startMonth, -1);
    const previousPeriodStart = shiftContractNaturalMonth(
      previousPeriodEnd,
      -(periodMonthCount - 1),
    );
    const previousYearStart = shiftContractNaturalMonth(startMonth, -12);
    const previousYearEnd = shiftContractNaturalMonth(endMonth, -12);
    const [
      contractAmountOverview,
      contractSummary,
      financialSummary,
      rates,
      periodReceiptRows,
      rateHistory,
      projectMetricRows,
      settlementRows,
      comparisonRows,
    ] = await Promise.all([
      db.get<{
        all_contract_count: number;
        effective_contract_count: number;
        effective_income_contract_count: number;
        effective_expense_contract_count: number;
        pending_signature_contract_count: number;
        period_contract_count: number;
        all_contract_amount: number;
        effective_contract_amount: number;
        effective_income_contract_amount: number;
        effective_expense_contract_amount: number;
        pending_signature_amount: number;
        period_contract_amount: number;
      }>(
        `WITH filter_parameters AS (
           SELECT ?::text AS category, ?::text AS project_id,
             ?::text AS start_month, ?::text AS end_month
         ), root_groups AS (
           SELECT root.id,
             COALESCE(root.category, root.declared_category) AS category,
             LEFT(root.contract_date, 7) AS contract_month,
             ${currentFixedContractAmountExpression("root")} AS current_amount,
             ${contributesToCurrentAmount("root")} AS is_effective,
             ${pendingSignatureContractPredicate("root")}
               AS is_pending_signature
           FROM contracts root
           CROSS JOIN filter_parameters filters
           WHERE root.is_deleted = FALSE
             ${dashboardAreaVisibility}
             AND COALESCE(root.root_contract_id, root.id) = root.id
             AND COALESCE(root.category, root.declared_category)
               IN ('main_business', 'non_main', 'asset')
             AND (
               ${contributesToCurrentAmount("root")}
               OR ${pendingSignatureContractPredicate("root")}
             )
             AND (
               filters.category IS NULL
               OR COALESCE(root.category, root.declared_category) = filters.category
             )
             AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
         )
         SELECT COUNT(*)::int AS all_contract_count,
           COUNT(*) FILTER (WHERE roots.is_effective)::int
             AS effective_contract_count,
           COUNT(*) FILTER (
             WHERE roots.is_effective
               AND roots.category IN ('main_business', 'non_main')
           )::int AS effective_income_contract_count,
           COUNT(*) FILTER (
             WHERE roots.is_effective AND roots.category = 'asset'
           )::int AS effective_expense_contract_count,
           COUNT(*) FILTER (WHERE roots.is_pending_signature)::int
             AS pending_signature_contract_count,
           COUNT(*) FILTER (
             WHERE roots.is_effective
               AND roots.contract_month BETWEEN filters.start_month AND filters.end_month
           )::int AS period_contract_count,
           COALESCE(SUM(roots.current_amount), 0) AS all_contract_amount,
           COALESCE(SUM(roots.current_amount) FILTER (WHERE roots.is_effective), 0)
             AS effective_contract_amount,
           COALESCE(SUM(roots.current_amount) FILTER (
             WHERE roots.is_effective
               AND roots.category IN ('main_business', 'non_main')
           ), 0) AS effective_income_contract_amount,
           COALESCE(SUM(roots.current_amount) FILTER (
             WHERE roots.is_effective AND roots.category = 'asset'
           ), 0) AS effective_expense_contract_amount,
           COALESCE(SUM(roots.current_amount) FILTER (WHERE roots.is_pending_signature), 0)
             AS pending_signature_amount,
           COALESCE(SUM(roots.current_amount) FILTER (
             WHERE roots.is_effective
               AND roots.contract_month BETWEEN filters.start_month AND filters.end_month
           ), 0) AS period_contract_amount
         FROM root_groups roots CROSS JOIN filter_parameters filters`,
        category,
        projectId,
        startMonth,
        endMonth,
      ),
      db.all<{
        category: ContractCategory;
        contract_count: number;
        fixed_amount_contract_count: number;
        unfixed_amount_contract_count: number;
        total_amount: number;
        period_settled_amount: number;
        cumulative_settled_amount: number;
        fixed_settled_amount: number;
        outstanding_amount: number;
      }>(
        `WITH filter_parameters AS (
           SELECT ?::text AS category, ?::text AS project_id,
             ?::text AS start_month, ?::text AS end_month
         ), root_groups AS (
           SELECT root.id, root.category, root.asset_funding_mode,
             root.declared_subtype,
             ${currentFixedContractAmountExpression("root")} AS current_amount
           FROM contracts root
           CROSS JOIN filter_parameters filters
           WHERE root.is_deleted = FALSE
             ${dashboardAreaVisibility}
             AND COALESCE(root.root_contract_id, root.id) = root.id
             AND ${contributesToCurrentAmount("root")}
             AND root.category IN ('main_business', 'non_main', 'asset')
             AND (filters.category IS NULL OR root.category = filters.category)
             AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
         ), financial_metrics AS (
           SELECT roots.id,
             COALESCE((SELECT SUM(receipt.amount)
               FROM contract_receipts receipt
               JOIN contracts receipt_contract
                 ON receipt_contract.id = receipt.contract_id
               WHERE COALESCE(
                   receipt_contract.root_contract_id,
                   receipt_contract.id
                 ) = roots.id
                 AND receipt_contract.is_deleted = FALSE
                 AND receipt_contract.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("receipt")}), 0)
               AS received_amount,
             COALESCE((SELECT SUM(receipt.amount)
               FROM contract_receipts receipt
               JOIN contracts receipt_contract
                 ON receipt_contract.id = receipt.contract_id
               CROSS JOIN filter_parameters filters
               WHERE COALESCE(
                   receipt_contract.root_contract_id,
                   receipt_contract.id
                 ) = roots.id
                 AND receipt_contract.is_deleted = FALSE
                 AND receipt_contract.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("receipt")}
                 AND LEFT(receipt.receipt_date, 7)
                   BETWEEN filters.start_month AND filters.end_month), 0)
               AS period_received_amount,
             COALESCE((SELECT SUM(payment.amount)
               FROM contract_payments payment
               JOIN contracts payment_contract
                 ON payment_contract.id = payment.contract_id
               WHERE COALESCE(
                   payment_contract.root_contract_id,
                   payment_contract.id
                 ) = roots.id
                 AND payment_contract.is_deleted = FALSE
                 AND payment_contract.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("payment")}), 0)
               AS paid_amount,
             COALESCE((SELECT SUM(payment.amount)
               FROM contract_payments payment
               JOIN contracts payment_contract
                 ON payment_contract.id = payment.contract_id
               CROSS JOIN filter_parameters filters
               WHERE COALESCE(
                   payment_contract.root_contract_id,
                   payment_contract.id
                 ) = roots.id
                 AND payment_contract.is_deleted = FALSE
                 AND payment_contract.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("payment")}
                 AND LEFT(payment.payment_date, 7)
                   BETWEEN filters.start_month AND filters.end_month), 0)
               AS period_paid_amount,
             ${contractCostSettlementAmountSql({
               rootAlias: "roots",
               rootIdExpression: "roots.id",
             })} AS cost_settled_amount,
             ${contractCostSettlementAmountSql({
               rootAlias: "roots",
               rootIdExpression: "roots.id",
               paymentDatePredicate:
                 "LEFT(settlement_payment.payment_date, 7) BETWEEN (SELECT start_month FROM filter_parameters) AND (SELECT end_month FROM filter_parameters)",
             })} AS period_cost_settled_amount
           FROM root_groups roots
         )
         SELECT roots.category,
           COUNT(*)::int AS contract_count,
           COUNT(*) FILTER (WHERE roots.current_amount IS NOT NULL)::int
             AS fixed_amount_contract_count,
           COUNT(*) FILTER (WHERE roots.current_amount IS NULL)::int
             AS unfixed_amount_contract_count,
           COALESCE(SUM(roots.current_amount), 0) AS total_amount,
           COALESCE(SUM(CASE WHEN roots.category = 'asset'
             THEN financial.period_cost_settled_amount
             ELSE financial.period_received_amount END), 0)
             AS period_settled_amount,
           COALESCE(SUM(CASE WHEN roots.category = 'asset'
             THEN financial.cost_settled_amount ELSE financial.received_amount END), 0)
             AS cumulative_settled_amount,
           COALESCE(SUM(CASE WHEN roots.current_amount IS NULL THEN 0
             WHEN roots.category = 'asset' THEN financial.cost_settled_amount
             ELSE financial.received_amount END), 0) AS fixed_settled_amount,
           COALESCE(SUM(CASE WHEN roots.current_amount IS NULL THEN 0
             WHEN roots.category = 'asset'
               THEN GREATEST(roots.current_amount - financial.cost_settled_amount, 0)
             ELSE GREATEST(
               roots.current_amount - financial.received_amount,
               0
             ) END), 0) AS outstanding_amount
         FROM root_groups roots
         LEFT JOIN financial_metrics financial ON financial.id = roots.id
         GROUP BY roots.category`,
        category,
        projectId,
        startMonth,
        endMonth,
      ),
      db.get<{
        main_receipts: number;
        non_main_receipts: number;
        asset_payments: number;
        invoices: number;
        rent: number;
        electricity: number;
        parking: number;
        car_rental: number;
        internet: number;
        other: number;
      }>(
        `WITH filter_parameters AS (
           SELECT ?::text AS category, ?::text AS project_id,
             ?::text AS start_month, ?::text AS end_month
         )
         SELECT
           COALESCE((SELECT SUM(r.amount) FROM contract_receipts r
             JOIN contracts c ON c.id = r.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             CROSS JOIN filter_parameters filters
             WHERE ${confirmedFinancialPredicate("r")}
               AND root.category = 'main_business'
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(r.receipt_date, 7)
                 BETWEEN filters.start_month AND filters.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)), 0) AS main_receipts,
           COALESCE((SELECT SUM(r.amount) FROM contract_receipts r
             JOIN contracts c ON c.id = r.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             CROSS JOIN filter_parameters filters
             WHERE ${confirmedFinancialPredicate("r")}
               AND root.category = 'non_main'
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(r.receipt_date, 7)
                 BETWEEN filters.start_month AND filters.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)), 0) AS non_main_receipts,
           COALESCE((SELECT SUM(p.amount) FROM contract_payments p
             JOIN contracts c ON c.id = p.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             CROSS JOIN filter_parameters filters
             WHERE ${confirmedFinancialPredicate("p")}
               AND root.category = 'asset'
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(p.payment_date, 7)
                 BETWEEN filters.start_month AND filters.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)), 0) AS asset_payments,
           COALESCE((SELECT SUM(i.amount) FROM contract_invoices i
             JOIN contracts c ON c.id = i.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             CROSS JOIN filter_parameters filters
             WHERE ${confirmedFinancialPredicate("i")}
               AND root.category IN ('main_business', 'non_main', 'asset')
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(i.invoice_date, 7)
                 BETWEEN filters.start_month AND filters.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)), 0) AS invoices,
           COALESCE((SELECT SUM(p.amount) FROM contract_payments p
             JOIN contracts c ON c.id = p.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             CROSS JOIN filter_parameters filters
             WHERE ${confirmedFinancialPredicate("p")}
               AND root.category = 'asset'
               AND p.expense_category = 'rent'
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(p.payment_date, 7)
                 BETWEEN filters.start_month AND filters.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)), 0) AS rent,
           COALESCE((SELECT SUM(p.amount) FROM contract_payments p
             JOIN contracts c ON c.id = p.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             CROSS JOIN filter_parameters filters
             WHERE ${confirmedFinancialPredicate("p")}
               AND root.category = 'asset'
               AND p.expense_category = 'electricity'
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(p.payment_date, 7)
                 BETWEEN filters.start_month AND filters.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)), 0) AS electricity,
           COALESCE((SELECT SUM(p.amount) FROM contract_payments p
             JOIN contracts c ON c.id = p.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             CROSS JOIN filter_parameters filters
             WHERE ${confirmedFinancialPredicate("p")}
               AND root.category = 'asset'
               AND p.expense_category = 'parking'
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(p.payment_date, 7)
                 BETWEEN filters.start_month AND filters.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)), 0) AS parking,
           COALESCE((SELECT SUM(p.amount) FROM contract_payments p
             JOIN contracts c ON c.id = p.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             CROSS JOIN filter_parameters filters
             WHERE ${confirmedFinancialPredicate("p")}
               AND root.category = 'asset'
               AND p.expense_category = 'car_rental'
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(p.payment_date, 7)
                 BETWEEN filters.start_month AND filters.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)), 0) AS car_rental,
           COALESCE((SELECT SUM(p.amount) FROM contract_payments p
             JOIN contracts c ON c.id = p.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             CROSS JOIN filter_parameters filters
             WHERE ${confirmedFinancialPredicate("p")}
               AND root.category = 'asset'
               AND p.expense_category = 'internet'
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(p.payment_date, 7)
                 BETWEEN filters.start_month AND filters.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)), 0) AS internet,
           COALESCE((SELECT SUM(p.amount) FROM contract_payments p
             JOIN contracts c ON c.id = p.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             CROSS JOIN filter_parameters filters
             WHERE ${confirmedFinancialPredicate("p")}
               AND root.category = 'asset'
               AND p.expense_category = 'other'
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(p.payment_date, 7)
                 BETWEEN filters.start_month AND filters.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)), 0) AS other`,
        category,
        projectId,
        startMonth,
        endMonth,
      ),
      loadCurrentRates(monthEndTimestamp(endMonth)),
      db.all<
        CategorizedContractReceiptRow & {
          root_id: string;
          project_id: string | null;
        }
      >(
        `WITH filter_parameters AS (
           SELECT ?::text AS category, ?::text AS project_id
         )
         SELECT root.id AS root_id, root.project_id, root.category,
           r.amount, r.receipt_date AS "occurredAt",
           r.rate_snapshot_json AS "rateSnapshot"
         FROM contract_receipts r
         JOIN contracts c ON c.id = r.contract_id
         JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
         CROSS JOIN filter_parameters filters
         WHERE ${confirmedFinancialPredicate("r")}
           AND LEFT(r.receipt_date, 7) BETWEEN ? AND ?
           AND c.is_deleted = FALSE AND c.status <> 'rejected'
           AND root.is_deleted = FALSE
           ${dashboardAreaVisibility}
           AND root.status <> 'rejected'
           AND root.category IN ('main_business', 'non_main')
           AND (filters.category IS NULL OR root.category = filters.category)
           AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
         ORDER BY r.receipt_date ASC, r.created_at ASC`,
        category,
        projectId,
        startMonth,
        endMonth,
      ),
      loadRateHistory(),
      db.all<{
        project_id: string | null;
        project_name: string;
        contract_id: string | null;
        category: ContractCategory | null;
        contract_count: number;
        contract_amount: number;
        received_amount: number;
        paid_amount: number;
        external_paid_amount: number;
        cost_settled_amount: number;
        settled_amount: number;
        unreceived_amount: number;
        unpaid_amount: number;
      }>(
        `WITH filter_parameters AS (
           SELECT ?::text AS category, ?::text AS project_id,
             ?::text AS start_month, ?::text AS end_month
         ), root_metrics AS (
           SELECT root.id AS root_id, root.project_id, root.category,
             root.asset_funding_mode, root.declared_subtype,
             filters.start_month, filters.end_month,
             ${contractCategoryDirectionExpression("root")} AS financial_direction,
             ${currentFixedContractAmountExpression("root")} AS current_amount
           FROM contracts root
           CROSS JOIN filter_parameters filters
           WHERE root.is_deleted = FALSE
             ${dashboardAreaVisibility}
             AND COALESCE(root.root_contract_id, root.id) = root.id
             AND ${contributesToCurrentAmount("root")}
             AND root.category IN ('main_business', 'non_main', 'asset')
             AND LEFT(root.contract_date, 7)
               BETWEEN filters.start_month AND filters.end_month
             AND (filters.category IS NULL OR root.category = filters.category)
             AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
         ), financial_metrics AS (
           SELECT roots.root_id,
             COALESCE((SELECT SUM(receipt.amount)
               FROM contract_receipts receipt
               JOIN contracts c ON c.id = receipt.contract_id
               WHERE COALESCE(c.root_contract_id, c.id) = roots.root_id
                 AND c.is_deleted = FALSE
                 AND c.status <> 'rejected'
                 AND LEFT(receipt.receipt_date, 7)
                   BETWEEN roots.start_month AND roots.end_month
                 AND ${confirmedFinancialPredicate("receipt")}), 0) AS received_amount,
             COALESCE((SELECT SUM(payment.amount)
               FROM contract_payments payment
               JOIN contracts c ON c.id = payment.contract_id
               WHERE COALESCE(c.root_contract_id, c.id) = roots.root_id
                 AND c.is_deleted = FALSE
                 AND c.status <> 'rejected'
                 AND LEFT(payment.payment_date, 7)
                   BETWEEN roots.start_month AND roots.end_month
                 AND ${confirmedFinancialPredicate("payment")}), 0) AS paid_amount,
             ${contractCostSettlementAmountSql({
               rootAlias: "roots",
               rootIdExpression: "roots.root_id",
               paymentDatePredicate:
                 "LEFT(settlement_payment.payment_date, 7) BETWEEN roots.start_month AND roots.end_month",
             })} AS cost_settled_amount
           FROM root_metrics roots
         )
         SELECT roots.project_id,
           COALESCE(project.name, '未关联项目') AS project_name,
           CASE WHEN COUNT(*) = 1 THEN MIN(roots.root_id) ELSE NULL END AS contract_id,
           CASE WHEN COUNT(DISTINCT roots.category) = 1
             THEN MIN(roots.category) ELSE NULL END AS category,
           COUNT(*)::int AS contract_count,
           COALESCE(SUM(roots.current_amount), 0) AS contract_amount,
           COALESCE(SUM(financial.received_amount), 0) AS received_amount,
           COALESCE(SUM(financial.paid_amount), 0) AS paid_amount,
           COALESCE(SUM(CASE WHEN roots.financial_direction = 'cost'
             THEN financial.cost_settled_amount ELSE financial.received_amount END), 0)
             AS settled_amount,
           COALESCE(SUM(CASE WHEN roots.financial_direction = 'income'
             AND roots.current_amount IS NOT NULL
             THEN GREATEST(roots.current_amount - financial.received_amount, 0)
             ELSE 0 END), 0) AS unreceived_amount,
           COALESCE(SUM(CASE WHEN roots.financial_direction = 'cost'
             AND roots.current_amount IS NOT NULL
             THEN GREATEST(roots.current_amount - financial.cost_settled_amount, 0)
             ELSE 0 END), 0) AS unpaid_amount
         FROM root_metrics roots
         LEFT JOIN financial_metrics financial ON financial.root_id = roots.root_id
         LEFT JOIN worklog_projects project ON project.id = roots.project_id
         WHERE roots.financial_direction IS NOT NULL
         GROUP BY roots.project_id, project.name
         ORDER BY contract_amount DESC, project_name ASC`,
        category,
        projectId,
        startMonth,
        endMonth,
      ),
      db.all<{
        root_id: string;
        title: string | null;
        project_id: string | null;
        project_name: string;
        category: ContractCategory;
        current_amount: number | null;
        settled_amount: number;
      }>(
        `WITH filter_parameters AS (
           SELECT ?::text AS category, ?::text AS project_id
         ), root_groups AS (
           SELECT root.id AS root_id, root.title, root.project_id,
             COALESCE(project.name, root.project_name, '未关联项目')
               AS project_name,
             root.category,
             root.asset_funding_mode,
             root.declared_subtype,
             ${currentFixedContractAmountExpression("root")} AS current_amount
           FROM contracts root
           CROSS JOIN filter_parameters filters
           LEFT JOIN worklog_projects project ON project.id = root.project_id
           WHERE root.is_deleted = FALSE
             ${dashboardAreaVisibility}
             AND COALESCE(root.root_contract_id, root.id) = root.id
             AND root.status IN ('effective', 'executing', 'completed')
             AND root.category IN ('main_business', 'non_main', 'asset')
             AND (filters.category IS NULL OR root.category = filters.category)
             AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
         )
         SELECT roots.*,
           CASE WHEN roots.category = 'asset' THEN
             ${contractCostSettlementAmountSql({
               rootAlias: "roots",
               rootIdExpression: "roots.root_id",
             })}
           ELSE COALESCE((
             SELECT SUM(receipt.amount)
             FROM contract_receipts receipt
             JOIN contracts receipt_contract
               ON receipt_contract.id = receipt.contract_id
             WHERE COALESCE(
                 receipt_contract.root_contract_id,
                 receipt_contract.id
               ) = roots.root_id
               AND receipt_contract.is_deleted = FALSE
               AND receipt_contract.status <> 'rejected'
               AND ${confirmedFinancialPredicate("receipt")}
           ), 0) END AS settled_amount
         FROM root_groups roots
         ORDER BY roots.project_name ASC, roots.title ASC, roots.root_id ASC`,
        category,
        projectId,
      ),
      db.all<{
        start_month: string;
        end_month: string;
        sort_order: number;
        income_amount: number;
        expense_amount: number;
      }>(
        `WITH filter_parameters AS (
           SELECT ?::text AS category, ?::text AS project_id
         ), comparison_periods(start_month, end_month, sort_order) AS (
           VALUES
             (?::text, ?::text, 1),
             (?::text, ?::text, 2),
             (?::text, ?::text, 3)
         )
         SELECT periods.start_month, periods.end_month, periods.sort_order,
           COALESCE((SELECT SUM(receipt.amount)
             FROM contract_receipts receipt
             JOIN contracts receipt_contract
               ON receipt_contract.id = receipt.contract_id
             JOIN contracts root
               ON root.id = COALESCE(
                 receipt_contract.root_contract_id,
                 receipt_contract.id
               )
             WHERE ${confirmedFinancialPredicate("receipt")}
               AND root.category IN ('main_business', 'non_main')
               AND receipt_contract.is_deleted = FALSE
               AND receipt_contract.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(receipt.receipt_date, 7)
                 BETWEEN periods.start_month AND periods.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
           ), 0) AS income_amount,
           COALESCE((SELECT SUM(payment.amount)
             FROM contract_payments payment
             JOIN contracts payment_contract
               ON payment_contract.id = payment.contract_id
             JOIN contracts root
               ON root.id = COALESCE(
                 payment_contract.root_contract_id,
                 payment_contract.id
               )
             WHERE ${confirmedFinancialPredicate("payment")}
               AND root.category = 'asset'
               AND payment_contract.is_deleted = FALSE
               AND payment_contract.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND LEFT(payment.payment_date, 7)
                 BETWEEN periods.start_month AND periods.end_month
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
           ), 0) AS expense_amount
         FROM comparison_periods periods
         CROSS JOIN filter_parameters filters
         ORDER BY periods.sort_order`,
        category,
        projectId,
        startMonth,
        endMonth,
        previousPeriodStart,
        previousPeriodEnd,
        previousYearStart,
        previousYearEnd,
      ),
    ]);
    const main = aggregateMainBusinessIncome(
      periodReceiptRows.filter((row) => row.category === "main_business"),
      rateHistory,
    ).total;
    const nonMain = aggregateNonMainIncome(
      periodReceiptRows.filter((row) => row.category === "non_main"),
      rateHistory,
    ).total;
    const periodMain = aggregateMainBusinessIncome(
      periodReceiptRows.filter((row) => row.category === "main_business"),
      rateHistory,
    ).total;
    const periodNonMain = aggregateNonMainIncome(
      periodReceiptRows.filter((row) => row.category === "non_main"),
      rateHistory,
    ).total;
    const periodAccountingIncomeCents =
      periodMain.accountingBaseCents + periodNonMain.accountingBaseCents;
    if (!Number.isSafeInteger(periodAccountingIncomeCents)) {
      throw new ContractDomainError(500, "期间核算收入超过安全计算范围");
    }
    const accountingIncomeByProject = new Map<string, number>();
    for (const row of periodReceiptRows) {
      const resolvedRates = resolveRecordRates(row, rateHistory);
      const accountingIncomeCents =
        row.category === "main_business"
          ? calculateMainBusinessIncome(row.amount, resolvedRates)
              .accountingBaseCents
          : calculateNonMainIncome(row.amount, resolvedRates)
              .accountingBaseCents;
      const key = row.project_id || "__unassigned__";
      const nextValue =
        (accountingIncomeByProject.get(key) || 0) + accountingIncomeCents;
      if (!Number.isSafeInteger(nextValue)) {
        throw new ContractDomainError(500, "项目核算收入超过安全计算范围");
      }
      accountingIncomeByProject.set(key, nextValue);
    }
    const [monthlyTrend, riskRows] = await Promise.all([
      db.all<{ month: string; received_amount: number; paid_amount: number }>(
        `WITH filter_parameters AS (
           SELECT ?::text AS category, ?::text AS project_id
         ), months AS (
           SELECT TO_CHAR(value, 'YYYY-MM') AS month
           FROM generate_series(
             (? || '-01')::date,
             (? || '-01')::date,
             INTERVAL '1 month'
           ) value
         )
         SELECT m.month,
           COALESCE((SELECT SUM(receipt.amount) FROM contract_receipts receipt
             JOIN contracts c ON c.id = receipt.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             WHERE ${confirmedFinancialPredicate("receipt")}
               AND root.category IN ('main_business', 'non_main')
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
               AND LEFT(receipt.receipt_date, 7) = m.month), 0) AS received_amount,
           COALESCE((SELECT SUM(payment.amount) FROM contract_payments payment
             JOIN contracts c ON c.id = payment.contract_id
             JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
             WHERE ${confirmedFinancialPredicate("payment")}
               AND root.category = 'asset'
               AND c.is_deleted = FALSE AND c.status <> 'rejected'
               AND root.is_deleted = FALSE
               ${dashboardAreaVisibility}
               AND root.status <> 'rejected'
               AND (filters.category IS NULL OR root.category = filters.category)
               AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
               AND LEFT(payment.payment_date, 7) = m.month), 0) AS paid_amount
         FROM months m CROSS JOIN filter_parameters filters
         ORDER BY m.month`,
        category,
        projectId,
        startMonth,
        endMonth,
      ),
      db.all<Record<string, any>>(
        `WITH filter_parameters AS (
           SELECT ?::text AS category, ?::text AS project_id
         ), root_groups AS (
           SELECT root.id, root.title, root.project_name, root.project_id,
             root.category, root.status, root.updated_at,
             root.financial_direction,
             root.asset_funding_mode, root.declared_subtype,
             ${currentFixedContractAmountExpression("root")} AS current_amount
           FROM contracts root
           CROSS JOIN filter_parameters filters
           LEFT JOIN contracts child
             ON COALESCE(child.root_contract_id, child.id) = root.id
            AND child.is_deleted = FALSE
           WHERE root.is_deleted = FALSE
             ${dashboardAreaVisibility}
             AND COALESCE(root.root_contract_id, root.id) = root.id
             AND ${contributesToCurrentAmount("root")}
             AND (filters.category IS NULL OR root.category = filters.category)
             AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
           GROUP BY root.id, root.title, root.project_name, root.project_id,
             root.category, root.status, root.updated_at,
             root.financial_direction, root.asset_funding_mode,
             root.declared_subtype, root.current_effective_amount
         ), settlement_risks AS (
           SELECT root.*, COALESCE((
               SELECT SUM(receipt.amount)
               FROM contract_receipts receipt
               JOIN contracts c ON c.id = receipt.contract_id
               WHERE COALESCE(c.root_contract_id, c.id) = root.id
                 AND c.is_deleted = FALSE
                 AND c.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("receipt")}
             ), 0) AS received_amount,
             COALESCE((
               SELECT SUM(payment.amount)
               FROM contract_payments payment
               JOIN contracts c ON c.id = payment.contract_id
               WHERE COALESCE(c.root_contract_id, c.id) = root.id
                 AND c.is_deleted = FALSE
                 AND c.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("payment")}
             ), 0) AS paid_amount,
             ${contractCostSettlementAmountSql({
               rootAlias: "root",
               rootIdExpression: "root.id",
             })} AS cost_settled_amount
           FROM root_groups root
         ), risks AS (
           SELECT c.id, c.title, c.project_name, c.project_id, c.category,
             c.status, c.updated_at, root.financial_direction
           FROM contracts c
           JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
           CROSS JOIN filter_parameters filters
           WHERE c.is_deleted = FALSE AND root.is_deleted = FALSE
             ${dashboardAreaVisibility}
             AND c.status = 'approving'
             AND (filters.category IS NULL OR root.category = filters.category)
             AND (filters.project_id IS NULL OR root.project_id = filters.project_id)
           UNION
           SELECT root.id, root.title, root.project_name, root.project_id,
             root.category, root.status, root.updated_at,
             root.financial_direction
           FROM settlement_risks root
           WHERE (root.financial_direction = 'income'
                 AND root.received_amount > root.current_amount)
              OR (root.financial_direction = 'cost'
                 AND root.cost_settled_amount > root.current_amount)
           UNION
           SELECT root.id, root.title, root.project_name, root.project_id,
             root.category, root.status, root.updated_at,
             root.financial_direction
           FROM root_groups root
           WHERE root.financial_direction IS NULL
         )
         SELECT * FROM risks ORDER BY updated_at DESC LIMIT 20`,
        category,
        projectId,
      ),
    ]);
    const safeCategorySummary = contractSummary.map((row) => {
      const totalAmount = safeContractOutputAmount(
        row.total_amount,
        "分类合同金额",
      );
      const periodSettledAmount = safeContractOutputAmount(
        row.period_settled_amount,
        "分类期间结算金额",
      );
      const cumulativeSettledAmount = safeContractOutputAmount(
        row.cumulative_settled_amount,
        "分类累计结算金额",
      );
      const fixedSettledAmount = safeContractOutputAmount(
        row.fixed_settled_amount,
        "固定金额合同累计结算金额",
      );
      const outstandingAmount = safeContractOutputAmount(
        row.outstanding_amount,
        "分类未结算金额",
      );
      const fixedAmountContractCount = Number(
        row.fixed_amount_contract_count || 0,
      );
      const completionRate =
        fixedAmountContractCount > 0 && toCents(totalAmount) > 0
          ? Math.round(
              (toCents(fixedSettledAmount) / toCents(totalAmount)) * 10000,
            ) / 100
          : null;
      const isAsset = row.category === "asset";
      return {
        category: row.category,
        count: Number(row.contract_count || 0),
        amount: totalAmount,
        contractCount: Number(row.contract_count || 0),
        fixedAmountContractCount,
        noFixedAmountCount: Number(row.unfixed_amount_contract_count || 0),
        totalAmount,
        periodAmount: periodSettledAmount,
        periodSettledAmount,
        monthAmount: periodSettledAmount,
        monthSettledAmount: periodSettledAmount,
        cumulativeAmount: cumulativeSettledAmount,
        cumulativeSettledAmount,
        settledAmount: cumulativeSettledAmount,
        outstandingAmount,
        completionRate,
        progress: completionRate,
        periodReceiptAmount: isAsset ? null : periodSettledAmount,
        monthReceiptAmount: isAsset ? null : periodSettledAmount,
        cumulativeReceiptAmount: isAsset ? null : cumulativeSettledAmount,
        unreceivedAmount: isAsset ? null : outstandingAmount,
        periodPaymentAmount: isAsset ? periodSettledAmount : null,
        monthPaymentAmount: isAsset ? periodSettledAmount : null,
        cumulativePaymentAmount: isAsset ? cumulativeSettledAmount : null,
        unpaidAmount: isAsset ? outstandingAmount : null,
      };
    });
    const categorizedEffectiveContractAmount = sumSafeContractOutputAmounts(
      safeCategorySummary.map((row) => row.totalAmount),
      "有效合同总额",
    );
    const allContractAmount = safeContractOutputAmount(
      contractAmountOverview?.all_contract_amount,
      "全部合同总额",
    );
    const effectiveContractAmount = safeContractOutputAmount(
      contractAmountOverview?.effective_contract_amount,
      "有效合同总额",
    );
    const effectiveIncomeContractAmount = safeContractOutputAmount(
      contractAmountOverview?.effective_income_contract_amount,
      "有效收入合同额",
    );
    const effectiveExpenseContractAmount = safeContractOutputAmount(
      contractAmountOverview?.effective_expense_contract_amount,
      "有效支出合同额",
    );
    const pendingSignatureAmount = safeContractOutputAmount(
      contractAmountOverview?.pending_signature_amount,
      "待签合同金额",
    );
    const periodContractAmount = safeContractOutputAmount(
      contractAmountOverview?.period_contract_amount,
      "期间生效合同额",
    );
    const periodContractCount = Number(
      contractAmountOverview?.period_contract_count || 0,
    );
    if (
      toCents(categorizedEffectiveContractAmount) !==
      toCents(effectiveContractAmount)
    ) {
      throw new ContractDomainError(500, "有效合同总额分类汇总不一致");
    }
    if (
      toCents(effectiveContractAmount) !==
      toCents(
        sumSafeContractOutputAmounts(
          [effectiveIncomeContractAmount, effectiveExpenseContractAmount],
          "有效收入与支出合同总额",
        ),
      )
    ) {
      throw new ContractDomainError(500, "有效收入与支出合同额汇总不一致");
    }
    const unreceivedAmount = sumSafeContractOutputAmounts(
      safeCategorySummary
        .filter((row) => row.category !== "asset")
        .map((row) => row.outstandingAmount),
      "未回款金额",
    );
    const periodAccountingIncome = centsToAmount(periodAccountingIncomeCents);
    const projectRanking = projectMetricRows
      .map((row) => {
        const contractAmount = safeContractOutputAmount(
          row.contract_amount,
          "项目合同金额",
        );
        const receivedAmount = safeContractOutputAmount(
          row.received_amount,
          "项目回款金额",
        );
        const paidAmount = safeContractOutputAmount(
          row.paid_amount,
          "项目付款金额",
        );
        const settledAmount = safeContractOutputAmount(
          row.settled_amount,
          "项目结算金额",
        );
        const accountingIncome = centsToAmount(
          accountingIncomeByProject.get(row.project_id || "__unassigned__") ||
            0,
        );
        return {
          projectId: row.project_id,
          projectName: row.project_name,
          contractId: row.contract_id,
          category: row.category,
          contractCount: Number(row.contract_count || 0),
          contractAmount,
          receivedAmount,
          paidAmount,
          settledAmount,
          accountingIncome,
          unreceivedAmount: safeContractOutputAmount(
            row.unreceived_amount,
            "项目未回款金额",
          ),
          unpaidAmount: safeContractOutputAmount(
            row.unpaid_amount,
            "项目未付款金额",
          ),
          completionRate:
            contractAmount > 0
              ? Math.round((settledAmount / contractAmount) * 10000) / 100
              : 0,
        };
      })
      .sort(
        (left, right) =>
          right.accountingIncome - left.accountingIncome ||
          right.contractAmount - left.contractAmount ||
          left.projectName.localeCompare(right.projectName, "zh-CN"),
      )
      .map((row, index) => ({ ...row, rank: index + 1 }));
    const mainReceipts = safeContractOutputAmount(
      financialSummary?.main_receipts,
      "主营期间回款",
    );
    const nonMainReceipts = safeContractOutputAmount(
      financialSummary?.non_main_receipts,
      "非主营期间回款",
    );
    const assetPayments = safeContractOutputAmount(
      financialSummary?.asset_payments,
      "资产期间付款",
    );
    const invoiceAmount = safeContractOutputAmount(
      financialSummary?.invoices,
      "期间开票金额",
    );
    const periodIncome = sumSafeContractOutputAmounts(
      [mainReceipts, nonMainReceipts],
      "期间收入",
    );
    const settlementItems = settlementRows.flatMap((row) => {
      if (row.current_amount === null || row.current_amount === undefined) {
        return [];
      }
      const contractAmount = safeContractOutputAmount(
        row.current_amount,
        "结算状态合同金额",
      );
      const settledAmount = safeContractOutputAmount(
        row.settled_amount,
        "结算状态已结算金额",
      );
      const outstandingAmount = remainingContractAmount(
        contractAmount,
        settledAmount,
      );
      return [
        {
          status: classifyContractSettlement(settledAmount, contractAmount),
          contractId: row.root_id,
          contractName: row.title || row.project_name || row.root_id,
          projectId: row.project_id,
          projectName: row.project_name,
          category: row.category,
          contractAmount,
          settledAmount,
          outstandingAmount,
          completionRate:
            toCents(contractAmount) > 0
              ? Math.round(
                  (toCents(settledAmount) / toCents(contractAmount)) * 10000,
                ) / 100
              : 0,
        },
      ];
    });
    const settlementStatuses = (
      ["unsettled", "partial", "settled"] as const
    ).map((status) => {
      const contracts = settlementItems.filter(
        (item) => item.status === status,
      );
      return {
        status,
        contractCount: contracts.length,
        contractAmount: sumSafeContractOutputAmounts(
          contracts.map((item) => item.contractAmount),
          "结算状态合同总额",
        ),
        settledAmount: sumSafeContractOutputAmounts(
          contracts.map((item) => item.settledAmount),
          "结算状态已结算总额",
        ),
        outstandingAmount: sumSafeContractOutputAmounts(
          contracts.map((item) => item.outstandingAmount),
          "结算状态未结算总额",
        ),
        contracts,
      };
    });
    const noFixedAmountContractCount = settlementRows.filter(
      (row) => row.current_amount === null || row.current_amount === undefined,
    ).length;
    const comparisonPeriodMap = new Map(
      comparisonRows.map((row) => [
        `${row.start_month}|${row.end_month}`,
        {
          incomeAmount: safeContractOutputAmount(
            row.income_amount,
            "对比收入金额",
          ),
          expenseAmount: safeContractOutputAmount(
            row.expense_amount,
            "对比支出金额",
          ),
        },
      ]),
    );
    const comparisonPeriods = [
      { key: "current" as const, startMonth, endMonth },
      {
        key: "previous_period" as const,
        startMonth: previousPeriodStart,
        endMonth: previousPeriodEnd,
      },
      {
        key: "previous_year" as const,
        startMonth: previousYearStart,
        endMonth: previousYearEnd,
      },
    ].map((period) => ({
      ...period,
      period:
        period.startMonth === period.endMonth
          ? period.startMonth
          : `${period.startMonth}—${period.endMonth}`,
      incomeAmount:
        comparisonPeriodMap.get(`${period.startMonth}|${period.endMonth}`)
          ?.incomeAmount || 0,
      expenseAmount:
        comparisonPeriodMap.get(`${period.startMonth}|${period.endMonth}`)
          ?.expenseAmount || 0,
    }));
    const currentComparison = comparisonPeriods[0];
    const previousPeriodComparison = comparisonPeriods[1];
    const previousYearComparison = comparisonPeriods[2];
    const buildComparisonChange = (
      currentAmount: number,
      comparisonAmount: number,
    ) => {
      const change = calculateContractAmountChange(
        currentAmount,
        comparisonAmount,
      );
      return {
        amount: change.amount,
        percentage: change.percentage,
        comparable: change.percentage !== null,
      };
    };
    const periodComparison = {
      periods: comparisonPeriods,
      changes: {
        incomePreviousPeriod: buildComparisonChange(
          currentComparison.incomeAmount,
          previousPeriodComparison.incomeAmount,
        ),
        expensePreviousPeriod: buildComparisonChange(
          currentComparison.expenseAmount,
          previousPeriodComparison.expenseAmount,
        ),
        incomePreviousYear: buildComparisonChange(
          currentComparison.incomeAmount,
          previousYearComparison.incomeAmount,
        ),
        expensePreviousYear: buildComparisonChange(
          currentComparison.expenseAmount,
          previousYearComparison.expenseAmount,
        ),
      },
    };
    const categorySummaryByCategory = new Map(
      safeCategorySummary.map((item) => [item.category, item]),
    );
    const mainCategorySummary = categorySummaryByCategory.get("main_business");
    const nonMainCategorySummary = categorySummaryByCategory.get("non_main");
    const assetCategorySummary = categorySummaryByCategory.get("asset");
    const mainBusinessAccounting = Object.fromEntries(
      Object.entries(main).map(([key, value]) => [
        key.replace(/Cents$/, ""),
        centsToAmount(value),
      ]),
    );
    const nonMainAccounting = Object.fromEntries(
      Object.entries(nonMain).map(([key, value]) => [
        key.replace(/Cents$/, ""),
        centsToAmount(value),
      ]),
    );
    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        startMonth,
        endMonth,
        summary: {
          totalCount: Number(
            contractAmountOverview?.effective_contract_count || 0,
          ),
          contractCount: Number(
            contractAmountOverview?.effective_contract_count || 0,
          ),
          allContractCount: Number(
            contractAmountOverview?.all_contract_count || 0,
          ),
          effectiveContractCount: Number(
            contractAmountOverview?.effective_contract_count || 0,
          ),
          effectiveIncomeContractCount: Number(
            contractAmountOverview?.effective_income_contract_count || 0,
          ),
          effectiveExpenseContractCount: Number(
            contractAmountOverview?.effective_expense_contract_count || 0,
          ),
          pendingSignatureContractCount: Number(
            contractAmountOverview?.pending_signature_contract_count || 0,
          ),
          periodContractCount,
          contractAmount: effectiveContractAmount,
          totalAmount: effectiveContractAmount,
          allContractAmount,
          effectiveContractAmount,
          effectiveIncomeContractAmount,
          effectiveExpenseContractAmount,
          pendingSignatureAmount,
          periodContractAmount,
          receivedAmount: periodIncome,
          paidAmount: assetPayments,
          invoiceAmount,
          periodIncome,
          periodExpense: assetPayments,
          periodInvoiceAmount: invoiceAmount,
          monthIncome: periodIncome,
          monthExpense: assetPayments,
          periodAccountingIncome,
          yearIncome: periodAccountingIncome,
          yearAccountingIncome: periodAccountingIncome,
          unreceivedAmount,
          unpaidAmount: assetCategorySummary?.outstandingAmount || 0,
        },
        categories: safeCategorySummary,
        settlementStatuses,
        noFixedAmountContractCount,
        periodComparison,
        risks: riskRows.map((row) => ({
          contractId: row.id,
          projectId: row.project_id,
          category: row.category,
          name: row.title || row.project_name || row.id,
          type:
            row.status === "approving"
              ? "pending_approval"
              : row.financial_direction == null
                ? "financial_direction_pending"
                : "settlement_exceeded",
          status: row.status,
        })),
        monthlyTrend: monthlyTrend.map((row) => ({
          month: row.month,
          receivedAmount: safeContractOutputAmount(
            row.received_amount,
            "月度回款金额",
          ),
          paidAmount: safeContractOutputAmount(row.paid_amount, "月度付款金额"),
        })),
        contracts: safeCategorySummary,
        monthlyInvoices: invoiceAmount,
        mainBusiness: {
          ...mainBusinessAccounting,
          totalContractAmount: mainCategorySummary?.totalAmount || 0,
          periodReceiptAmount: mainReceipts,
          monthReceiptAmount: mainReceipts,
          cumulativeReceiptAmount:
            mainCategorySummary?.cumulativeSettledAmount || 0,
          unreceivedAmount: mainCategorySummary?.outstandingAmount || 0,
        },
        nonMain: {
          ...nonMainAccounting,
          totalContractAmount: nonMainCategorySummary?.totalAmount || 0,
          periodReceiptAmount: nonMainReceipts,
          monthReceiptAmount: nonMainReceipts,
          cumulativeReceiptAmount:
            nonMainCategorySummary?.cumulativeSettledAmount || 0,
          unreceivedAmount: nonMainCategorySummary?.outstandingAmount || 0,
        },
        asset: {
          paymentAmount: assetPayments,
          totalContractAmount: assetCategorySummary?.totalAmount || 0,
          periodPaymentAmount: assetPayments,
          monthPaymentAmount: assetPayments,
          cumulativePaymentAmount:
            assetCategorySummary?.cumulativeSettledAmount || 0,
          unpaidAmount: assetCategorySummary?.outstandingAmount || 0,
          rent: safeContractOutputAmount(financialSummary?.rent, "期间房租"),
          electricity: safeContractOutputAmount(
            financialSummary?.electricity,
            "期间电费",
          ),
          parking: safeContractOutputAmount(
            financialSummary?.parking,
            "期间车位费",
          ),
          carRental: safeContractOutputAmount(
            financialSummary?.car_rental,
            "期间租车费",
          ),
          internet: safeContractOutputAmount(
            financialSummary?.internet,
            "期间网费",
          ),
          other: safeContractOutputAmount(financialSummary?.other, "期间其他"),
        },
        rates: rates.decimal,
        periodAccountingIncome,
        yearAccountingIncome: periodAccountingIncome,
        unreceivedAmount,
        projectRanking,
      },
    });
  } catch (error) {
    sendError(res, error, "获取合同经营看板失败");
  }
});

router.get("/pending-count", requireContractApprover, async (req, res) => {
  try {
    const currentActor = actor(req);
    const row = await db.get<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM contract_approval_rounds approval_round
       JOIN contracts c ON c.id = approval_round.contract_id
       WHERE approval_round.status = 'pending'
         AND approval_round.target_approver_id = ?
         AND c.status = 'approving' AND c.is_deleted = FALSE`,
      currentActor.id,
    );
    res.json({ success: true, data: { count: Number(row?.count || 0) } });
  } catch (error) {
    sendError(res, error, "获取合同待审批数量失败");
  }
});

router.get("/pending-seal-count", requireFinance, async (_req, res) => {
  try {
    const row = await db.get<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM contracts c
       WHERE c.status = 'pending_seal'
         AND c.is_deleted = FALSE`,
    );
    res.json({ success: true, data: { count: Number(row?.count || 0) } });
  } catch (error) {
    sendError(res, error, "获取待盖章合同数量失败");
  }
});

router.get("/approvals/pending", requireContractApprover, async (req, res) => {
  try {
    const currentActor = actor(req);
    const page = positiveIntegerQuery(req.query.page, "页码", 1, 10_000_000);
    const pageSize = positiveIntegerQuery(
      req.query.pageSize,
      "每页条数",
      20,
      100,
    );
    const where = [
      "approval_round.target_approver_id = ?",
      "approval_round.status = 'pending'",
      "c.status = 'approving'",
      "c.is_deleted = FALSE",
    ];
    const params: unknown[] = [currentActor.id];
    const keyword = optionalQueryScalar(
      req.query.keyword ?? req.query.q,
      "搜索关键词",
    );
    if (keyword) {
      const keywordValue = `%${keyword}%`;
      where.push(
        "(c.project_name ILIKE ? OR c.party_a ILIKE ? OR c.party_b ILIKE ? OR c.contract_no ILIKE ? OR c.business_contract_no ILIKE ? OR c.title ILIKE ?)",
      );
      params.push(
        keywordValue,
        keywordValue,
        keywordValue,
        keywordValue,
        keywordValue,
        keywordValue,
      );
    }
    const count = await db.get<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM contract_approval_rounds approval_round
       JOIN contracts c ON c.id = approval_round.contract_id
       WHERE ${where.join(" AND ")}`,
      ...params,
    );
    const rows = await db.all<Record<string, any>>(
      `SELECT c.*, p.name AS linked_project_name, creator.name AS owner_name,
         COALESCE(parent.project_name, parent.title, parent.contract_no)
           AS parent_contract_name,
         approval_round.id AS approval_round_id,
         approval_round.approval_kind AS approval_kind,
         approval_round.target_approver_id AS approval_target_id,
         approval_round.target_approver_name_snapshot AS approval_target_name,
         approval_round.target_approver_role_snapshot AS approval_target_role,
         approval_round.target_source AS approval_target_source,
         approval_round.submitted_at AS approval_round_submitted_at,
         COALESCE(
           root.current_effective_amount,
           root.original_contract_amount,
           root.amount_delta,
           0
         ) AS current_amount
       FROM contract_approval_rounds approval_round
       JOIN contracts c ON c.id = approval_round.contract_id
       LEFT JOIN worklog_projects p ON p.id = c.project_id
       LEFT JOIN users creator ON creator.id = c.created_by
       LEFT JOIN contracts parent ON parent.id = c.parent_contract_id
       LEFT JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
       WHERE ${where.join(" AND ")}
       ORDER BY approval_round.submitted_at ASC, approval_round.id ASC
       LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    res.json({
      success: true,
      data: {
        items: rows.map((row) => {
          const amount = safeContractOutputAmount(
            row.amount_delta,
            "本次审批金额",
          );
          const currentAmount = safeContractOutputAmount(
            row.current_amount,
            "合同当前金额",
          );
          return {
            ...toContractApi(row),
            name:
              row.title || row.project_name || row.contract_no || "未命名合同",
            amount,
            currentAmount,
            parentContractName: row.parent_contract_name || null,
            amountBeforeChange:
              row.relation_type === "supplement"
                ? safeContractOutputAmount(
                    row.amount_before_change,
                    "补充协议变更前金额",
                  )
                : null,
            amountAfterChange:
              row.relation_type === "supplement"
                ? safeContractOutputAmount(
                    row.amount_after_change,
                    "补充协议变更后金额",
                  )
                : null,
          };
        }),
        total: Number(count?.count || 0),
        page,
        pageSize,
        totalPages: Math.ceil(Number(count?.count || 0) / pageSize),
      },
    });
  } catch (error) {
    sendError(res, error, "获取待处理合同审批失败");
  }
});

router.get(
  "/approvals/processed",
  requireContractApprover,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const page = positiveIntegerQuery(req.query.page, "页码", 1, 10_000_000);
      const pageSize = positiveIntegerQuery(
        req.query.pageSize,
        "每页条数",
        20,
        100,
      );
      const where = [
        "approval_round.target_approver_id = ?",
        "ar.approval_round_id = approval_round.id",
        "ar.action IN ('approve', 'reject')",
        "c.is_deleted = FALSE",
      ];
      const params: unknown[] = [currentActor.id];
      const keyword = optionalQueryScalar(
        req.query.keyword ?? req.query.q,
        "搜索关键词",
      );
      if (keyword) {
        const keywordValue = `%${keyword}%`;
        where.push(
          "(c.project_name ILIKE ? OR c.party_a ILIKE ? OR c.party_b ILIKE ? OR c.contract_no ILIKE ? OR c.business_contract_no ILIKE ? OR c.title ILIKE ?)",
        );
        params.push(
          keywordValue,
          keywordValue,
          keywordValue,
          keywordValue,
          keywordValue,
          keywordValue,
        );
      }
      const count = await db.get<{ count: number }>(
        `SELECT COUNT(*)::int AS count
       FROM contract_approval_records ar
       JOIN contract_approval_rounds approval_round
         ON approval_round.id = ar.approval_round_id
       JOIN contracts c ON c.id = ar.contract_id
       WHERE ${where.join(" AND ")}`,
        ...params,
      );
      const rows = await db.all<Record<string, any>>(
        `SELECT c.*, p.name AS linked_project_name, creator.name AS owner_name,
         COALESCE(parent.project_name, parent.title, parent.contract_no)
           AS parent_contract_name,
         COALESCE(
           root.current_effective_amount,
           root.original_contract_amount,
           root.amount_delta,
           0
         ) AS current_amount,
         ar.id AS approval_record_id, ar.action AS approval_action,
         ar.comment AS approval_comment, ar.from_status AS approval_from_status,
         ar.to_status AS approval_to_status, ar.created_at AS processed_at,
         approval_round.id AS approval_round_id,
         approval_round.approval_kind AS approval_kind,
         approval_round.target_approver_id AS approval_target_id,
         approval_round.target_approver_name_snapshot AS approval_target_name,
         approval_round.target_approver_role_snapshot AS approval_target_role,
         approval_round.target_source AS approval_target_source
       FROM contract_approval_records ar
       JOIN contract_approval_rounds approval_round
         ON approval_round.id = ar.approval_round_id
       JOIN contracts c ON c.id = ar.contract_id
       LEFT JOIN worklog_projects p ON p.id = c.project_id
       LEFT JOIN users creator ON creator.id = c.created_by
       LEFT JOIN contracts parent ON parent.id = c.parent_contract_id
       LEFT JOIN contracts root ON root.id = COALESCE(c.root_contract_id, c.id)
       WHERE ${where.join(" AND ")}
       ORDER BY ar.created_at DESC, ar.id DESC
       LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        (page - 1) * pageSize,
      );
      res.json({
        success: true,
        data: {
          items: rows.map((row) => {
            const amount = safeContractOutputAmount(
              row.amount_delta,
              "协议调整金额",
            );
            const currentAmount = safeContractOutputAmount(
              row.current_amount,
              "合同当前金额",
            );
            const amountBeforeChange =
              row.relation_type === "supplement"
                ? safeContractOutputAmount(
                    row.amount_before_change,
                    "补充协议变更前金额",
                  )
                : null;
            return {
              ...toContractApi(row),
              name:
                row.title ||
                row.project_name ||
                row.contract_no ||
                "未命名合同",
              amount,
              currentAmount,
              parentContractName: row.parent_contract_name || null,
              amountBeforeChange,
              amountAfterChange:
                row.relation_type === "supplement"
                  ? safeContractOutputAmount(
                      row.amount_after_change,
                      "补充协议变更后金额",
                    )
                  : null,
              approvalRecordId: row.approval_record_id,
              approvalAction: row.approval_action,
              approvalComment: row.approval_comment,
              approvalFromStatus: row.approval_from_status,
              approvalToStatus: row.approval_to_status,
              processedAt: row.processed_at,
            };
          }),
          total: Number(count?.count || 0),
          page,
          pageSize,
          totalPages: Math.ceil(Number(count?.count || 0) / pageSize),
        },
      });
    } catch (error) {
      sendError(res, error, "获取已处理合同审批失败");
    }
  },
);

router.get("/:id/audit-logs", requireAuth, async (req, res) => {
  try {
    await assertContractReadScope(req, req.params.id);
    const page = positiveIntegerQuery(req.query.page, "页码", 1, 10_000_000);
    const pageSize = positiveIntegerQuery(
      req.query.pageSize,
      "每页条数",
      20,
      100,
    );
    const contract = await db.get<{ id: string }>(
      `SELECT id FROM contracts WHERE id = ? AND is_deleted = FALSE`,
      req.params.id,
    );
    if (!contract) throw new ContractDomainError(404, "合同不存在");
    const count = await db.get<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM contract_audit_logs WHERE contract_id = ?`,
      req.params.id,
    );
    const rows = await db.all<Record<string, any>>(
      `SELECT audit.*, users.name AS actor_name
       FROM contract_audit_logs audit
       LEFT JOIN users ON users.id = audit.actor_id
       WHERE audit.contract_id = ?
       ORDER BY audit.created_at DESC, audit.id DESC
       LIMIT ? OFFSET ?`,
      req.params.id,
      pageSize,
      (page - 1) * pageSize,
    );
    res.json({
      success: true,
      data: {
        items: rows.map((row) => {
          const changes =
            row.changes_json && typeof row.changes_json === "object"
              ? row.changes_json
              : {};
          return {
            id: row.id,
            contractId: row.contract_id,
            action: row.action,
            actorId: row.actor_id,
            actorName: row.actor_name,
            actorRole: row.actor_role,
            fromStatus: row.from_status,
            toStatus: row.to_status,
            changes,
            result: changes.result || "success",
            comment: row.comment,
            createdAt: row.created_at,
          };
        }),
        total: Number(count?.count || 0),
        page,
        pageSize,
        totalPages: Math.ceil(Number(count?.count || 0) / pageSize),
      },
    });
  } catch (error) {
    sendError(res, error, "获取合同操作审计记录失败");
  }
});

router.get("/ocr-jobs/:jobId", requireContractRead, async (req, res) => {
  try {
    const job = await db.get<Record<string, any>>(
      `SELECT j.*, f.file_name, c.version AS contract_version,
         c.relation_type AS contract_relation_type,
         c.project_name AS contract_project_name
       FROM contract_ocr_jobs j
       JOIN contract_files f ON f.id = j.file_id
       JOIN contracts c ON c.id = j.contract_id
       WHERE j.id = ? AND c.is_deleted = FALSE`,
      req.params.jobId,
    );
    if (!job) throw new ContractDomainError(404, "识别任务不存在");
    const fields = await db.all<Record<string, any>>(
      `SELECT field_code, original_value, normalized_value, final_value,
         confidence, source, page_number, evidence, manually_confirmed,
         confirmed_by, confirmed_at
       FROM contract_ocr_fields WHERE job_id = ? ORDER BY field_code`,
      req.params.jobId,
    );
    const ocrLines = await db.all<Record<string, any>>(
      `SELECT line_index, page_number, text, bbox, confidence, model_version
       FROM contract_ocr_lines
       WHERE job_id = ?
       ORDER BY line_index ASC`,
      req.params.jobId,
    );
    res.json({
      success: true,
      data: {
        id: job.id,
        contractId: job.contract_id,
        fileId: job.file_id,
        fileName: job.file_name,
        status: job.status,
        method: job.method,
        engineVersion: job.engine_version,
        parserVersion: job.parser_version,
        retryCount: job.retry_count,
        warnings: job.warnings_json || [],
        errorMessage: job.error_message,
        startedAt: job.started_at,
        finishedAt: job.finished_at,
        contractVersion: Number(job.contract_version || 1),
        createdAt: job.created_at,
        fields: fields.map((field) => ({
          field: field.field_code,
          originalValue: field.original_value,
          normalizedValue: field.normalized_value,
          finalValue: contractOcrFinalValueForResponse(
            field.field_code,
            field.final_value,
            job.contract_relation_type,
            job.contract_project_name,
          ),
          confidence: Number(field.confidence),
          source: field.source,
          pageNumber: field.page_number,
          evidence: field.evidence,
          manuallyConfirmed: field.manually_confirmed,
          confirmedBy: field.confirmed_by,
          confirmedAt: field.confirmed_at,
        })),
        ocrLines: ocrLines.map((line) => ({
          page: Number(line.page_number),
          text: line.text,
          bbox: Array.isArray(line.bbox) ? line.bbox : [],
          confidence: Number(line.confidence),
          modelVersion: line.model_version,
        })),
      },
    });
  } catch (error) {
    sendError(res, error, "获取合同识别任务失败");
  }
});

router.post(
  "/:id/ocr-jobs/:jobId/confirm",
  requireFinance,
  (_req, _res, next) => {
    next(
      new ContractDomainError(
        409,
        "合同字段只允许系统自动识别；未通过时请重新识别",
        "OCR_MANUAL_CONFIRMATION_DISABLED",
      ),
    );
  },
);

router.get("/files/:fileId", requireAuth, async (req, res) => {
  try {
    const currentActor = actor(req);
    const forceDownload = req.query.download === "1";
    if (forceDownload && !canDirectDownloadContractFile(currentActor.role)) {
      throw new ContractDomainError(
        403,
        "普通员工和BOSS不能直接下载合同文件，请通过合同下载申请流程办理",
        "CONTRACT_DIRECT_DOWNLOAD_FORBIDDEN",
      );
    }
    const file = await db.get<{
      contract_id: string;
      file_path: string;
      file_name: string;
      mime_type: string;
      is_deleted: boolean;
    }>(
      `SELECT f.contract_id, f.file_path, f.file_name, f.mime_type,
         c.is_deleted
       FROM contract_files f
       JOIN contracts c ON c.id = f.contract_id
       WHERE f.id = ?`,
      req.params.fileId,
    );
    if (!file) throw new ContractDomainError(404, "合同文件不存在");
    if (file.is_deleted) {
      if (
        !FINANCE_ROLES.includes(
          currentActor.role as (typeof FINANCE_ROLES)[number],
        )
      ) {
        throw new ContractDomainError(403, "无权查看已撤销合同文件");
      }
    } else {
      await assertContractReadScope(req, file.contract_id);
    }
    if (!validateFilePath(file.file_path)) {
      throw new ContractDomainError(403, "合同文件路径不安全");
    }
    const absolutePath = path.resolve(process.cwd(), file.file_path);
    if (!fs.existsSync(absolutePath)) {
      throw new ContractDomainError(404, "合同文件已丢失");
    }
    await db.run(
      `INSERT INTO contract_audit_logs (
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) SELECT ?, c.id,
           CASE WHEN ?::boolean THEN 'file_downloaded' ELSE 'file_previewed' END,
           ?, ?, c.status, c.status, ?::jsonb, ?
         FROM contracts c WHERE c.id = ?`,
      nanoid(),
      forceDownload,
      currentActor.id,
      currentActor.role,
      JSON.stringify({
        fileId: req.params.fileId,
        fileName: file.file_name,
        contractDeleted: file.is_deleted,
        result: "success",
      }),
      new Date().toISOString(),
      file.contract_id,
    );
    res.setHeader("Content-Type", file.mime_type);
    res.setHeader(
      "Content-Disposition",
      `${forceDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
    );
    res.sendFile(absolutePath);
  } catch (error) {
    if (!res.headersSent) sendError(res, error, "读取合同文件失败");
  }
});

router.get(
  "/:id/supplement-upload-context",
  requireFinance,
  async (req, res) => {
    try {
      const data = await db.transaction(async (client) => {
        const parent = await client.query<ContractRow>(
          `SELECT * FROM contracts
           WHERE id = $1 AND is_deleted = FALSE FOR SHARE`,
          [req.params.id],
        );
        const root = parent.rows[0];
        if (!root || root.relation_type !== "main") {
          throw new ContractDomainError(404, "主合同不存在");
        }
        const sequenceResult = await client.query<{ next_sequence: number }>(
          `SELECT COALESCE(MAX(supplement_sequence), 0) + 1 AS next_sequence
           FROM contracts
           WHERE root_contract_id = $1 AND relation_type = 'supplement'`,
          [root.id],
        );
        const supplementSequence = Number(
          sequenceResult.rows[0]?.next_sequence || 1,
        );
        const generatedContractName = buildSupplementSubjectName(
          root,
          supplementSequence,
        );
        const currentEffectiveAmount = await loadRootCurrentEffectiveAmount(
          client,
          root.id,
        );
        const renewalSuccessor = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE renewed_from_contract_id = $1 AND is_deleted = FALSE
             AND status <> 'rejected'
           ORDER BY created_at DESC, id DESC LIMIT 1`,
          [root.id],
        );
        const blockingReasons = [
          !["effective", "executing", "completed"].includes(root.status)
            ? "主合同盖章生效后才能上传补充协议"
            : null,
          !root.category ? "主合同分类不完整" : null,
          !root.declared_subtype ? "主合同二级分类不完整" : null,
          !generatedContractName ? "主合同缺少可继承的合同名称" : null,
          !root.party_a || !root.party_b ? "主合同甲乙方信息不完整" : null,
          renewalSuccessor.rows[0]
            ? "当前合同已有续签合同，不能再新增补充协议"
            : null,
        ].filter((reason): reason is string => Boolean(reason));
        return {
          parentContractId: root.id,
          rootContractId: root.id,
          area: root.area,
          declaredCategory: root.declared_category || root.category,
          declaredSubtype: root.declared_subtype,
          assetCategory: root.asset_category,
          projectId: root.category === "asset" ? null : root.project_id,
          projectName: root.project_name,
          partyA: root.party_a,
          partyB: root.party_b,
          parentContractName:
            root.project_name || root.title || root.contract_no,
          supplementSequence,
          generatedContractName,
          originalContractAmount:
            root.original_contract_amount ?? root.amount_delta,
          currentEffectiveAmount,
          canUpload: blockingReasons.length === 0,
          blockingReason: blockingReasons.join("；") || null,
        };
      });
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error, "获取补充协议上传上下文失败");
    }
  },
);

router.get("/:id/renewal-upload-context", requireFinance, async (req, res) => {
  try {
    const data = await db.transaction(async (client) => {
      const sourceResult = await client.query<ContractRow>(
        `SELECT * FROM contracts
         WHERE id = $1 AND is_deleted = FALSE FOR SHARE`,
        [req.params.id],
      );
      const source = sourceResult.rows[0];
      if (!source) throw new ContractDomainError(404, "原租赁合同不存在");
      const successor = await client.query<{
        id: string;
        status: ContractRow["status"];
      }>(
        `SELECT id, status FROM contracts
         WHERE renewed_from_contract_id = $1 AND is_deleted = FALSE
           AND status <> 'rejected'
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [source.id],
      );
      const activeChild = await client.query<{ id: string }>(
        `SELECT id FROM contracts
         WHERE root_contract_id = $1 AND id <> $1 AND is_deleted = FALSE
           AND relation_type IN ('supplement', 'termination')
           AND status IN ('draft', 'approving', 'pending_seal')
         ORDER BY created_at, id LIMIT 1`,
        [source.id],
      );
      const blockingReasons = [
        source.relation_type !== "main" || source.root_contract_id !== source.id
          ? "只能从租赁主合同发起续签"
          : null,
        !isRentalContract(source)
          ? "当前合同不是具有可信到期日的房屋、汽车或车位租赁合同"
          : null,
        !["effective", "executing", "completed"].includes(source.status)
          ? "原租赁合同盖章生效后才能续签"
          : null,
        !source.declared_category || !source.declared_subtype
          ? "原租赁合同分类信息不完整"
          : null,
        !source.party_a || !source.party_b
          ? "原租赁合同甲乙方信息不完整"
          : null,
        successor.rows[0] ? "当前合同已有续签合同，不能重复续签" : null,
        activeChild.rows[0]
          ? "当前合同已有补充、续签或退租／还车协议正在办理"
          : null,
      ].filter((reason): reason is string => Boolean(reason));
      return {
        sourceContractId: source.id,
        sourceContractName:
          source.title || source.project_name || source.contract_no,
        area: source.area,
        declaredCategory: source.declared_category || source.category,
        declaredSubtype: source.declared_subtype,
        assetCategory: source.asset_category,
        projectId: source.category === "asset" ? null : source.project_id,
        projectName: source.project_name,
        partyA: source.party_a,
        partyB: source.party_b,
        currentLeaseEndDate: source.lease_end_date,
        canUpload: blockingReasons.length === 0,
        blockingReason: blockingReasons.join("；") || null,
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "获取续签合同上传上下文失败");
  }
});

async function handleSupplementRecognition(
  req: Request,
  res: Response,
): Promise<void> {
  let validatedFile: ValidatedUpload | null = null;
  try {
    if (Object.keys(req.body || {}).length > 0) {
      throw new ContractDomainError(
        400,
        "从主合同上传补充协议时只需提交协议文件，继承信息由系统生成",
        "SUPPLEMENT_UPLOAD_FILE_ONLY",
      );
    }
    validatedFile = await validateUploadedFile(req.file, [
      "pdf",
      "doc",
      "docx",
    ]);
    const currentActor = actor(req);
    const result = await db.transaction(async (client) => {
      const parent = await resolveContractParentContext(
        client,
        req.params.id,
        true,
      );
      if (!parent.declared_subtype || !parent.declared_category) {
        throw new ContractDomainError(
          409,
          "主合同上传分类信息不完整，不能自动继承补充协议",
          "CONTRACT_PARENT_UPLOAD_CONTEXT_MISSING",
        );
      }
      if (!parent.party_a || !parent.party_b) {
        throw new ContractDomainError(
          409,
          "主合同甲乙方信息不完整，不能自动继承补充协议",
          "CONTRACT_PARENT_PARTIES_MISSING",
        );
      }
      const renewalSuccessor = await client.query<{ id: string }>(
        `SELECT id FROM contracts
         WHERE renewed_from_contract_id = $1 AND is_deleted = FALSE
           AND status <> 'rejected'
         ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [parent.id],
      );
      if (renewalSuccessor.rows[0]) {
        throw new ContractDomainError(
          409,
          "当前合同已有续签合同，不能再新增补充协议",
          "CONTRACT_RENEWAL_SUCCESSOR_EXISTS",
        );
      }
      const supplementSequence = await allocateSupplementSequence(
        client,
        parent.id,
      );
      const supplementSubjectName = buildSupplementSubjectName(
        parent,
        supplementSequence,
      );
      if (!supplementSubjectName) {
        throw new ContractDomainError(
          409,
          parent.category === "asset"
            ? "主合同缺少合同名称，不能生成补充协议名称"
            : "主合同缺少项目名称，不能生成补充协议名称",
          "CONTRACT_PARENT_SUBJECT_NAME_MISSING",
        );
      }
      const contractId = nanoid();
      const contractNo = await generateContractNumber(client);
      const fileId = nanoid();
      const jobId = nanoid();
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO contracts (
             id, contract_no, title, declared_category, declared_subtype,
             category, asset_category, relation_type, status, area,
             project_id, parent_contract_id, root_contract_id, party_a,
             party_b, project_name, amount_delta, supplement_sequence,
             financial_direction, financial_direction_source,
             financial_direction_version, version, created_by, updated_by,
             created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,NULL,$6,'supplement','draft',$7,$8,$9,$9,
             $10,$11,$3,NULL,$12,
             CASE WHEN $4 = 'asset' THEN 'cost' ELSE 'income' END,
             'contract_category',1,1,$13,$13,$14,$14
           )`,
        [
          contractId,
          contractNo,
          supplementSubjectName,
          parent.declared_category,
          parent.declared_subtype,
          parent.asset_category,
          parent.area,
          parent.category === "asset" ? null : parent.project_id,
          parent.id,
          parent.party_a,
          parent.party_b,
          supplementSequence,
          currentActor.id,
          now,
        ],
      );
      await insertContractFile(
        client,
        contractId,
        "draft_contract",
        validatedFile!,
        currentActor.id,
        fileId,
      );
      await client.query(
        `INSERT INTO contract_ocr_jobs (
             id, contract_id, file_id, status, retry_count, warnings_json,
             requested_by, created_at, updated_at
           ) VALUES ($1,$2,$3,'queued',0,'[]'::jsonb,$4,$5,$5)`,
        [jobId, contractId, fileId, currentActor.id, now],
      );
      await client.query(
        `INSERT INTO contract_audit_logs (
             id, contract_id, action, actor_id, actor_role, from_status,
             to_status, changes_json, created_at
           ) VALUES ($1,$2,'create',$3,$4,NULL,'draft',$5::jsonb,$6)`,
        [
          nanoid(),
          contractId,
          currentActor.id,
          currentActor.role,
          JSON.stringify({
            fileId,
            jobId,
            relationType: "supplement",
            parentContractId: parent.id,
            supplementSequence,
            inherited: {
              area: parent.area,
              declaredCategory: parent.declared_category,
              declaredSubtype: parent.declared_subtype,
              assetCategory: parent.asset_category,
              projectId: parent.project_id,
              partyA: parent.party_a,
              partyB: parent.party_b,
              contractName: supplementSubjectName,
            },
          }),
          now,
        ],
      );
      return { contractId, fileId, jobId };
    });
    res.status(202).json({
      success: true,
      message: "补充协议已上传，正在自动识别",
      data: result,
    });
    scheduleRecognitionJob(result.jobId);
  } catch (error) {
    cleanupUploadedFile(req.file);
    sendError(res, error, "上传补充协议并创建识别任务失败");
  }
}

router.post(
  "/:id/supplements/recognize",
  requireFinance,
  uploadRecognitionSingle,
  (req, res) => handleSupplementRecognition(req, res),
);

router.post(
  "/:id/renewals/recognize",
  requireFinance,
  uploadRecognitionSingle,
  async (req, res) => {
    let validatedFile: ValidatedUpload | null = null;
    try {
      if (Object.keys(req.body || {}).length > 0) {
        throw new ContractDomainError(
          400,
          "从原租赁合同续签时只需提交新合同文件",
          "CONTRACT_RENEWAL_UPLOAD_FILE_ONLY",
        );
      }
      validatedFile = await validateUploadedFile(req.file, [
        "pdf",
        "doc",
        "docx",
      ]);
      const currentActor = actor(req);
      const result = await db.transaction(async (client) => {
        const sourceResult = await client.query<ContractRow>(
          `SELECT * FROM contracts
           WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
          [req.params.id],
        );
        const source = sourceResult.rows[0];
        if (!source) throw new ContractDomainError(404, "原租赁合同不存在");
        if (
          source.relation_type !== "main" ||
          source.root_contract_id !== source.id ||
          !isRentalContract(source)
        ) {
          throw new ContractDomainError(
            409,
            "只有具有可信到期日的房屋、汽车或车位租赁主合同可以续签",
            "CONTRACT_RENEWAL_SOURCE_REQUIRED",
          );
        }
        if (!["effective", "executing", "completed"].includes(source.status)) {
          throw new ContractDomainError(
            409,
            "原租赁合同盖章生效后才能续签",
            "CONTRACT_RENEWAL_SOURCE_STATUS_FORBIDDEN",
          );
        }
        if (
          !source.declared_category ||
          !source.declared_subtype ||
          !source.asset_category ||
          !source.party_a ||
          !source.party_b ||
          !source.lease_end_date
        ) {
          throw new ContractDomainError(
            409,
            "原租赁合同分类、主体或到期日不完整，不能续签",
            "CONTRACT_RENEWAL_SOURCE_INCOMPLETE",
          );
        }
        const existingSuccessor = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE renewed_from_contract_id = $1 AND is_deleted = FALSE
             AND status <> 'rejected'
           ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
          [source.id],
        );
        if (existingSuccessor.rows[0]) {
          throw new ContractDomainError(
            409,
            "当前合同已有续签合同，不能重复续签",
            "CONTRACT_RENEWAL_ALREADY_EXISTS",
          );
        }
        const activeChild = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE root_contract_id = $1 AND id <> $1 AND is_deleted = FALSE
             AND relation_type IN ('supplement', 'termination')
             AND status IN ('draft', 'approving', 'pending_seal')
           ORDER BY created_at, id LIMIT 1 FOR UPDATE`,
          [source.id],
        );
        if (activeChild.rows[0]) {
          throw new ContractDomainError(
            409,
            "当前合同已有补充、续签或退租／还车协议正在办理，请先处理完成",
            "CONTRACT_RENTAL_OPERATION_IN_PROGRESS",
          );
        }

        const contractId = nanoid();
        const contractNo = await generateContractNumber(client);
        const fileId = nanoid();
        const jobId = nanoid();
        const now = new Date().toISOString();
        await client.query(
          `INSERT INTO contracts (
             id, contract_no, title, declared_category, declared_subtype,
             category, asset_category, relation_type, status, area,
             project_id, parent_contract_id, root_contract_id,
             renewed_from_contract_id, renewed_from_lease_end_date,
             party_a, party_b, project_name, amount_delta,
             financial_direction, financial_direction_source,
             financial_direction_version, version, created_by, updated_by,
             created_at, updated_at
           ) VALUES (
             $1,$2,NULL,$3,$4,NULL,$5,'main','draft',$6,
             NULL,NULL,$1,$7,$8,NULL,NULL,NULL,NULL,
             'cost','contract_category',1,1,$9,$9,$10,$10
           )`,
          [
            contractId,
            contractNo,
            source.declared_category,
            source.declared_subtype,
            source.asset_category,
            source.area,
            source.id,
            source.lease_end_date,
            currentActor.id,
            now,
          ],
        );
        await insertContractFile(
          client,
          contractId,
          "draft_contract",
          validatedFile!,
          currentActor.id,
          fileId,
        );
        await client.query(
          `INSERT INTO contract_ocr_jobs (
             id, contract_id, file_id, status, retry_count, warnings_json,
             requested_by, created_at, updated_at
           ) VALUES ($1,$2,$3,'queued',0,'[]'::jsonb,$4,$5,$5)`,
          [jobId, contractId, fileId, currentActor.id, now],
        );
        await client.query(
          `INSERT INTO contract_audit_logs (
             id, contract_id, action, actor_id, actor_role, from_status,
             to_status, changes_json, created_at
           ) VALUES ($1,$2,'create',$3,$4,NULL,'draft',$5::jsonb,$6)`,
          [
            nanoid(),
            contractId,
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              fileId,
              jobId,
              relationType: "main",
              renewedFromContractId: source.id,
              renewedFromLeaseEndDate: source.lease_end_date,
              independentLifecycle: true,
            }),
            now,
          ],
        );
        return { contractId, fileId, jobId };
      });
      res.status(202).json({
        success: true,
        message: "续签新合同已上传，正在自动识别",
        data: result,
      });
      scheduleRecognitionJob(result.jobId);
    } catch (error) {
      cleanupUploadedFile(req.file);
      sendError(res, error, "上传续签新合同并创建识别任务失败");
    }
  },
);

router.get(
  "/:id/termination-upload-context",
  requireFinance,
  async (req, res) => {
    try {
      const data = await db.transaction(async (client) => {
        const current = await client.query<ContractRow>(
          `SELECT * FROM contracts
           WHERE id = $1 AND is_deleted = FALSE FOR SHARE`,
          [req.params.id],
        );
        const currentContract = current.rows[0];
        if (!currentContract) throw new ContractDomainError(404, "合同不存在");
        const targetContractId =
          normalizeNullableText(req.query.targetContractId) ||
          currentContract.id;
        const { root, target } = await resolveTerminationTargetContext(
          client,
          targetContractId,
        );
        const currentRootId =
          currentContract.root_contract_id || currentContract.id;
        if (currentRootId !== root.id) {
          throw new ContractDomainError(
            409,
            "解除目标不属于当前合同链",
            "CONTRACT_TERMINATION_TARGET_ROOT_MISMATCH",
          );
        }
        const snapshot = await calculateTerminationSettlementSnapshot(
          client,
          target.id,
        );
        const generatedContractName = buildTerminationSubjectName(target);
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE termination_target_contract_id = $1
             AND relation_type = 'termination' AND is_deleted = FALSE
             AND status NOT IN ('rejected', 'terminated')
           ORDER BY created_at, id LIMIT 1`,
          [target.id],
        );
        const activeSupplement = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE root_contract_id = $1 AND is_deleted = FALSE
             AND relation_type = 'supplement'
             AND status IN ('draft', 'approving', 'pending_seal')
           ORDER BY created_at, id LIMIT 1`,
          [root.id],
        );
        const renewalSuccessor = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE renewed_from_contract_id = $1 AND is_deleted = FALSE
             AND status <> 'rejected'
           ORDER BY created_at DESC, id DESC LIMIT 1`,
          [root.id],
        );
        const blockingReasons = [
          !root.declared_category || !root.declared_subtype
            ? "主合同上传分类信息不完整"
            : null,
          !root.party_a || !root.party_b ? "主合同甲乙方信息不完整" : null,
          !generatedContractName ? "解除目标缺少可继承的合同名称" : null,
          existing.rows[0] ? "该合同已有正在办理或已生效的解除协议" : null,
          activeSupplement.rows[0]
            ? "当前合同已有补充或续签协议正在办理，请先处理完成"
            : null,
          renewalSuccessor.rows[0]
            ? "当前合同已有续签合同，不能再办理原合同解除"
            : null,
        ].filter((reason): reason is string => Boolean(reason));
        return {
          rootContractId: root.id,
          parentContractId: root.id,
          targetContractId: target.id,
          targetRelationType: target.relation_type,
          targetName: target.project_name || target.title || target.contract_no,
          targetBusinessContractNo: target.business_contract_no,
          generatedContractName,
          area: root.area,
          declaredCategory: root.declared_category || root.category,
          declaredSubtype: root.declared_subtype,
          assetCategory: root.asset_category,
          projectId: root.category === "asset" ? null : root.project_id,
          partyA: root.party_a,
          partyB: root.party_b,
          currentEffectiveAmount: snapshot.currentEffectiveAmount,
          settledAmount: snapshot.settledAmount,
          fulfilledAmount: snapshot.settledAmount,
          unperformedAmount: snapshot.unperformedAmount,
          terminationFinalAmount: snapshot.settledAmount,
          canUpload: blockingReasons.length === 0,
          blockingReason: blockingReasons.join("；") || null,
        };
      });
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error, "获取解除协议上传上下文失败");
    }
  },
);

router.post(
  "/:id/terminations/recognize",
  requireFinance,
  uploadRecognitionSingle,
  async (req, res) => {
    let validatedFile: ValidatedUpload | null = null;
    try {
      const allowedFields = new Set(["targetContractId"]);
      const forbiddenFields = Object.keys(req.body || {}).filter(
        (field) => !allowedFields.has(field),
      );
      if (forbiddenFields.length > 0) {
        throw new ContractDomainError(
          400,
          "上传解除协议时只需选择解除目标并提交协议文件",
          "CONTRACT_TERMINATION_UPLOAD_FIELDS_FORBIDDEN",
        );
      }
      validatedFile = await validateUploadedFile(req.file, [
        "pdf",
        "doc",
        "docx",
      ]);
      const currentActor = actor(req);
      const result = await db.transaction(async (client) => {
        const current = await client.query<ContractRow>(
          `SELECT * FROM contracts
           WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
          [req.params.id],
        );
        const currentContract = current.rows[0];
        if (!currentContract) throw new ContractDomainError(404, "合同不存在");
        const targetContractId =
          normalizeNullableText(req.body.targetContractId) ||
          currentContract.id;
        const { root, target } = await resolveTerminationTargetContext(
          client,
          targetContractId,
          true,
        );
        const currentRootId =
          currentContract.root_contract_id || currentContract.id;
        if (currentRootId !== root.id) {
          throw new ContractDomainError(
            409,
            "解除目标不属于当前合同链",
            "CONTRACT_TERMINATION_TARGET_ROOT_MISMATCH",
          );
        }
        if (!root.declared_category || !root.declared_subtype) {
          throw new ContractDomainError(
            409,
            "主合同上传分类信息不完整，不能自动继承解除协议",
            "CONTRACT_PARENT_UPLOAD_CONTEXT_MISSING",
          );
        }
        if (!root.party_a || !root.party_b) {
          throw new ContractDomainError(
            409,
            "主合同甲乙方信息不完整，不能自动继承解除协议",
            "CONTRACT_PARENT_PARTIES_MISSING",
          );
        }
        const generatedContractName = buildTerminationSubjectName(target);
        if (!generatedContractName) {
          throw new ContractDomainError(
            409,
            "解除目标缺少合同名称，不能生成解除协议名称",
            "CONTRACT_TERMINATION_SUBJECT_MISSING",
          );
        }
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE termination_target_contract_id = $1
             AND relation_type = 'termination' AND is_deleted = FALSE
             AND status NOT IN ('rejected', 'terminated')
           ORDER BY created_at, id LIMIT 1 FOR UPDATE`,
          [target.id],
        );
        if (existing.rows[0]) {
          throw new ContractDomainError(
            409,
            "该合同已有正在办理或已生效的解除协议",
            "CONTRACT_TERMINATION_ALREADY_EXISTS",
          );
        }
        const activeSupplement = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE root_contract_id = $1 AND is_deleted = FALSE
             AND relation_type = 'supplement'
             AND status IN ('draft', 'approving', 'pending_seal')
           ORDER BY created_at, id LIMIT 1 FOR UPDATE`,
          [root.id],
        );
        if (activeSupplement.rows[0]) {
          throw new ContractDomainError(
            409,
            "当前合同已有补充或续签协议正在办理，请先处理完成",
            "CONTRACT_RENTAL_OPERATION_IN_PROGRESS",
          );
        }
        const renewalSuccessor = await client.query<{ id: string }>(
          `SELECT id FROM contracts
           WHERE renewed_from_contract_id = $1 AND is_deleted = FALSE
             AND status <> 'rejected'
           ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
          [root.id],
        );
        if (renewalSuccessor.rows[0]) {
          throw new ContractDomainError(
            409,
            "当前合同已有续签合同，不能再办理原合同解除",
            "CONTRACT_RENEWAL_SUCCESSOR_EXISTS",
          );
        }
        const snapshot = await calculateTerminationSettlementSnapshot(
          client,
          target.id,
          null,
          true,
        );
        const contractId = nanoid();
        const contractNo = await generateContractNumber(client);
        const fileId = nanoid();
        const jobId = nanoid();
        const now = new Date().toISOString();
        await client.query(
          `INSERT INTO contracts (
             id, contract_no, title, declared_category, declared_subtype,
             category, asset_category, relation_type, status, area,
             project_id, parent_contract_id, root_contract_id,
             termination_target_contract_id, party_a, party_b, project_name,
             amount_delta, amount_before_change, amount_after_change,
             financial_direction, financial_direction_source,
             financial_direction_version, version, created_by, updated_by,
             created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,NULL,$6,'termination','draft',$7,$8,$9,$9,$10,
             $11,$12,$3,$13,$14,$15,
             CASE WHEN $4 = 'asset' THEN 'cost' ELSE 'income' END,
             'contract_category',1,1,$16,$16,$17,$17
           )`,
          [
            contractId,
            contractNo,
            generatedContractName,
            root.declared_category,
            root.declared_subtype,
            root.asset_category,
            root.area,
            root.category === "asset" ? null : root.project_id,
            root.id,
            target.id,
            root.party_a,
            root.party_b,
            snapshot.amountDelta,
            snapshot.currentEffectiveAmount,
            snapshot.settledAmount,
            currentActor.id,
            now,
          ],
        );
        await insertContractFile(
          client,
          contractId,
          "draft_contract",
          validatedFile!,
          currentActor.id,
          fileId,
        );
        await client.query(
          `INSERT INTO contract_ocr_jobs (
             id, contract_id, file_id, status, retry_count, warnings_json,
             requested_by, created_at, updated_at
           ) VALUES ($1,$2,$3,'queued',0,'[]'::jsonb,$4,$5,$5)`,
          [jobId, contractId, fileId, currentActor.id, now],
        );
        await client.query(
          `INSERT INTO contract_audit_logs (
             id, contract_id, action, actor_id, actor_role, from_status,
             to_status, changes_json, created_at
           ) VALUES ($1,$2,'create',$3,$4,NULL,'draft',$5::jsonb,$6)`,
          [
            nanoid(),
            contractId,
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              fileId,
              jobId,
              relationType: "termination",
              parentContractId: root.id,
              terminationTargetContractId: target.id,
              generatedContractName,
              settlementSnapshot: snapshot,
            }),
            now,
          ],
        );
        await syncProjectContractTotal(client, root.project_id);
        return { contractId, fileId, jobId };
      });
      res.status(202).json({
        success: true,
        message: "解除协议已上传，正在自动识别",
        data: result,
      });
      scheduleRecognitionJob(result.jobId);
    } catch (error) {
      cleanupUploadedFile(req.file);
      sendError(res, error, "上传解除协议并创建识别任务失败");
    }
  },
);

router.post(
  "/recognize",
  requireFinance,
  uploadRecognitionSingle,
  async (req, res) => {
    let validatedFile: ValidatedUpload | null = null;
    try {
      const uploadContext = validateNewContractUploadContext({
        area: req.body.area,
        declaredCategory: req.body.declaredCategory,
        declaredSubtype: req.body.declaredSubtype,
        assetCategory: req.body.assetCategory,
      });
      const relationType = String(
        req.body.relationType || "",
      ).trim() as ContractRelationType;
      if (!relationType) {
        throw new ContractDomainError(
          400,
          "上传合同前必须选择合同层级关系",
          "CONTRACT_RELATION_TYPE_REQUIRED",
        );
      }
      if (!(RELATION_TYPES as readonly string[]).includes(relationType)) {
        throw new ContractDomainError(400, "合同关系类型不正确");
      }
      if (relationType === "termination") {
        throw new ContractDomainError(
          410,
          "解除协议必须从被解除合同详情上传，不能使用普通合同上传入口",
          "CONTRACT_TERMINATION_TARGET_UPLOAD_REQUIRED",
        );
      }
      const forbiddenRecognitionFields = [
        "contractNo",
        "contract_no",
        "businessContractNo",
        "business_contract_no",
        "partyA",
        "partyB",
        "projectName",
        "amount",
        "amountDelta",
        "category",
        "contractDate",
        "contract_date",
        "declared_category",
        "declared_subtype",
      ].filter((key) => req.body[key] !== undefined);
      if (forbiddenRecognitionFields.length > 0) {
        throw new ContractDomainError(
          400,
          "新增合同的甲乙方、项目名称、金额、合同类型和合同日期仅允许由自动识别任务写入",
          "OCR_FIELDS_READ_ONLY",
        );
      }
      validatedFile = await validateUploadedFile(req.file, [
        "pdf",
        "doc",
        "docx",
      ]);
      const currentActor = actor(req);
      const category: ContractCategory | null = null;
      const { area, declaredCategory, declaredSubtype, assetCategory } =
        uploadContext;
      const requiresAuxiliaryMaterials = normalizeOptionalBoolean(
        req.body.requiresAuxiliaryMaterials,
        "是否需要辅助材料",
      );
      const requestedProjectId = normalizeNullableText(req.body.projectId);
      if (declaredCategory === "asset" && requestedProjectId) {
        throw new ContractDomainError(
          409,
          "资产类合同不能关联项目",
          "CONTRACT_ASSET_PROJECT_NOT_ALLOWED",
        );
      }

      const result = await db.transaction(async (client) => {
        const contractId = nanoid();
        const contractNo = await generateContractNumber(client);
        const fileId = nanoid();
        const jobId = nanoid();
        const now = new Date().toISOString();
        let parentContractId = normalizeNullableText(req.body.parentContractId);
        let rootContractId = contractId;
        let projectId = requestedProjectId;
        let supplementSubjectName: string | null = null;
        let supplementSequence: number | null = null;
        let inheritedPartyA: string | null = null;
        let inheritedPartyB: string | null = null;
        if (relationType === "supplement") {
          if (!parentContractId) {
            throw new ContractDomainError(
              400,
              "补充协议或终止协议必须关联上级合同",
            );
          }
          const parent = await resolveContractParentContext(
            client,
            parentContractId,
            true,
          );
          if (parent.area !== area) {
            throw new ContractDomainError(
              409,
              "补充协议或终止协议必须与上级合同属于同一行政区",
              "CONTRACT_PARENT_AREA_MISMATCH",
            );
          }
          if (parent.category !== declaredCategory) {
            throw new ContractDomainError(
              409,
              "补充协议或终止协议的预选分类必须与上级合同一致",
              "CONTRACT_PARENT_CATEGORY_MISMATCH",
            );
          }
          if (parent.declared_subtype !== declaredSubtype) {
            throw new ContractDomainError(
              409,
              "补充协议或终止协议的合同二级分类必须与上级合同一致",
              "CONTRACT_PARENT_SUBTYPE_MISMATCH",
            );
          }
          if (parent.asset_category !== assetCategory) {
            throw new ContractDomainError(
              409,
              "补充协议或终止协议的资产分类必须与上级合同一致",
              "CONTRACT_PARENT_ASSET_CATEGORY_MISMATCH",
            );
          }
          if (declaredCategory === "asset") {
            if (parent.project_id) {
              throw new ContractDomainError(
                409,
                "资产类上级合同存在无效项目关系，请联系管理员核查",
                "CONTRACT_ASSET_PARENT_PROJECT_INVALID",
              );
            }
          } else if (projectId && projectId !== parent.project_id) {
            throw new ContractDomainError(
              409,
              "补充协议或终止协议的关联项目必须与上级合同一致",
              "CONTRACT_PARENT_PROJECT_MISMATCH",
            );
          }
          rootContractId = parent.id;
          projectId = declaredCategory === "asset" ? null : parent.project_id;
          inheritedPartyA = parent.party_a;
          inheritedPartyB = parent.party_b;
          if (relationType === "supplement") {
            supplementSequence = await allocateSupplementSequence(
              client,
              parent.id,
            );
            supplementSubjectName = buildSupplementSubjectName(
              parent,
              supplementSequence,
            );
            if (!supplementSubjectName) {
              throw new ContractDomainError(
                409,
                declaredCategory === "asset"
                  ? "主合同缺少合同名称，不能生成补充协议名称"
                  : "主合同缺少项目名称，不能生成补充协议名称",
                "CONTRACT_PARENT_SUBJECT_NAME_MISSING",
              );
            }
          }
        } else {
          parentContractId = null;
        }
        if (projectId) {
          const project = await client.query<{ id: string; district: string }>(
            `SELECT id, district FROM worklog_projects WHERE id = $1`,
            [projectId],
          );
          if (!project.rows[0])
            throw new ContractDomainError(400, "关联项目不存在");
          if (
            !isBeijingContractArea(project.rows[0].district) ||
            (area !== "全部" && project.rows[0].district !== area)
          ) {
            throw new ContractDomainError(
              409,
              "只能关联与合同所属行政区一致的项目",
              "CONTRACT_PROJECT_AREA_MISMATCH",
            );
          }
        }
        await client.query(
          `INSERT INTO contracts (
           id, contract_no, title, description, declared_category,
           declared_subtype, category, asset_category, relation_type,
           status, area, project_id, parent_contract_id, root_contract_id,
           party_a, party_b, project_name, amount_delta, supplement_sequence,
           requires_auxiliary_materials,
           financial_direction, financial_direction_source,
           financial_direction_version, contract_date,
           contract_date_source, version, created_by, updated_by,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12,$13,
           $17,$18,$16,NULL,$19,$20,
           CASE WHEN $5 = 'asset' THEN 'cost' ELSE 'income' END,
           'contract_category',1,NULL,NULL,1,$14,$14,$15,$15
         )`,
          [
            contractId,
            contractNo,
            supplementSubjectName || normalizeNullableText(req.body.title),
            normalizeNullableText(req.body.description),
            declaredCategory,
            declaredSubtype,
            category,
            assetCategory,
            relationType,
            area,
            projectId,
            parentContractId,
            rootContractId,
            currentActor.id,
            now,
            supplementSubjectName,
            inheritedPartyA,
            inheritedPartyB,
            supplementSequence,
            requiresAuxiliaryMaterials,
          ],
        );
        await insertContractFile(
          client,
          contractId,
          "draft_contract",
          validatedFile!,
          currentActor.id,
          fileId,
        );
        await client.query(
          `INSERT INTO contract_ocr_jobs (
           id, contract_id, file_id, status, retry_count, warnings_json,
           requested_by, created_at, updated_at
         ) VALUES ($1,$2,$3,'queued',0,'[]'::jsonb,$4,$5,$5)`,
          [jobId, contractId, fileId, currentActor.id, now],
        );
        await client.query(
          `INSERT INTO contract_audit_logs (
           id, contract_id, action, actor_id, actor_role, from_status,
           to_status, changes_json, created_at
         ) VALUES ($1,$2,'create',$3,$4,NULL,'draft',$5::jsonb,$6)`,
          [
            nanoid(),
            contractId,
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              fileId,
              jobId,
              area,
              declaredCategory,
              declaredSubtype,
              assetCategory,
              relationType,
              parentContractId,
              requiresAuxiliaryMaterials,
            }),
            now,
          ],
        );
        await syncProjectContractTotal(client, projectId);
        return { contractId, fileId, jobId };
      });
      res.status(202).json({
        success: true,
        message: "合同已上传，正在智能识别",
        data: result,
      });
      scheduleRecognitionJob(result.jobId);
    } catch (error) {
      cleanupUploadedFile(req.file);
      sendError(res, error, "上传合同并创建识别任务失败");
    }
  },
);

router.post("/:id/recognize/retry", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const result = await db.transaction(async (client) => {
      const contract = await client.query<ContractRow>(
        `SELECT * FROM contracts WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
        [req.params.id],
      );
      if (!contract.rows[0]) throw new ContractDomainError(404, "合同不存在");
      if (contract.rows[0].status !== "draft") {
        throw new ContractDomainError(409, "只有草拟中的合同可以重新识别");
      }
      assertStoredContractUploadContext(contract.rows[0]);
      const file = await client.query<{ id: string }>(
        `SELECT id FROM contract_files
         WHERE contract_id = $1 AND file_type = 'draft_contract' AND is_current = TRUE
         ORDER BY created_at DESC LIMIT 1`,
        [req.params.id],
      );
      if (!file.rows[0])
        throw new ContractDomainError(400, "未找到草拟合同文件");
      const latest = await client.query<{
        retry_count: number;
        status: string;
      }>(
        `SELECT retry_count, status FROM contract_ocr_jobs
         WHERE contract_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [req.params.id],
      );
      if (
        latest.rows[0] &&
        ["queued", "processing"].includes(latest.rows[0].status)
      ) {
        throw new ContractDomainError(409, "识别任务仍在执行");
      }
      const jobId = nanoid();
      const now = new Date().toISOString();
      await clearDraftAutomaticRecognitionValues(client, req.params.id, now);
      await client.query(
        `INSERT INTO contract_ocr_jobs (
           id, contract_id, file_id, status, retry_count, warnings_json,
           requested_by, created_at, updated_at
         ) VALUES ($1,$2,$3,'queued',$4,'[]'::jsonb,$5,$6,$6)`,
        [
          jobId,
          req.params.id,
          file.rows[0].id,
          Number(latest.rows[0]?.retry_count || 0) + 1,
          currentActor.id,
          now,
        ],
      );
      return {
        id: jobId,
        contractId: req.params.id,
        status: "queued" as const,
        fields: [],
        warnings: [],
      };
    });
    res.status(202).json({ success: true, data: result });
    scheduleRecognitionJob(result.id);
  } catch (error) {
    sendError(res, error, "重新创建合同识别任务失败");
  }
});

router.post("/:id/ocr-model-comparison", requireFinance, async (req, res) => {
  try {
    const context = await db.get<{
      contract_id: string;
      declared_category: ContractCategory | null;
      declared_subtype: ContractDeclaredSubtype | null;
      asset_category: ContractAssetCategory | null;
      relation_type: ContractRelationType;
      renewed_from_contract_id: string | null;
      file_id: string;
      file_name: string;
      file_path: string;
      mime_type: string;
    }>(
      `SELECT contract.id AS contract_id, contract.declared_category,
           contract.declared_subtype, contract.asset_category,
           contract.relation_type, contract.renewed_from_contract_id,
           file.id AS file_id, file.file_name,
           file.file_path, file.mime_type
         FROM contracts contract
         JOIN contract_files file ON file.contract_id = contract.id
         WHERE contract.id = ? AND contract.is_deleted = FALSE
           AND file.file_type = 'draft_contract' AND file.is_current = TRUE
         ORDER BY file.created_at DESC
         LIMIT 1`,
      req.params.id,
    );
    if (!context) {
      throw new ContractDomainError(404, "合同或当前草拟合同文件不存在");
    }
    if (!validateFilePath(context.file_path)) {
      throw new ContractDomainError(400, "合同文件路径不安全");
    }
    if (path.extname(context.file_path).toLowerCase() !== ".pdf") {
      throw new ContractDomainError(
        400,
        "双模型识别对比当前仅支持 PDF（便携式文档格式）合同",
      );
    }
    const absolutePath = path.resolve(process.cwd(), context.file_path);
    if (!fs.existsSync(absolutePath)) {
      throw new ContractDomainError(404, "当前草拟合同原件已丢失");
    }
    const results = await compareContractOcrModels(
      absolutePath,
      context.mime_type,
      {
        expectedCategory: context.declared_category || undefined,
        expectedDeclaredSubtype: context.declared_subtype || undefined,
        expectedAssetCategory: context.asset_category || undefined,
        relationType: context.relation_type,
        renewalMain: Boolean(context.renewed_from_contract_id),
      },
    );
    res.json({
      success: true,
      data: {
        contractId: context.contract_id,
        fileId: context.file_id,
        fileName: context.file_name,
        results,
      },
    });
  } catch (error) {
    sendError(res, error, "合同双模型识别对比失败");
  }
});

router.patch("/:id/asset-funding-mode", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const contract = await db.transaction(async (client) => {
      const current = await client.query<ContractRow>(
        `SELECT * FROM contracts
         WHERE id = $1 AND is_deleted = FALSE
         FOR UPDATE`,
        [req.params.id],
      );
      const row = current.rows[0];
      if (!row) throw new ContractDomainError(404, "合同不存在");
      if (row.relation_type !== "main" || row.category !== "asset") {
        throw new ContractDomainError(
          409,
          "只有资产类主合同可以设置资金承担方式",
          "ASSET_FUNDING_MODE_CONTRACT_REQUIRED",
        );
      }
      const fundingMode = inferAssetFundingMode(
        "asset",
        row.party_a,
        row.party_b,
      )!;
      const now = new Date().toISOString();
      const updated = await client.query<ContractRow>(
        `UPDATE contracts
         SET asset_funding_mode = $2, updated_by = $3, updated_at = $4,
           version = version + 1
         WHERE id = $1
         RETURNING *`,
        [row.id, fundingMode, currentActor.id, now],
      );
      await client.query(
        `INSERT INTO contract_audit_logs (
           id, contract_id, action, actor_id, actor_role, from_status,
           to_status, changes_json, created_at
         ) VALUES ($1,$2,'asset_funding_mode_inferred',$3,$4,$5,$5,$6::jsonb,$7)`,
        [
          nanoid(),
          row.id,
          currentActor.id,
          currentActor.role,
          row.status,
          JSON.stringify({
            previousFundingMode: row.asset_funding_mode,
            fundingMode,
          }),
          now,
        ],
      );
      return updated.rows[0]!;
    });
    res.json({ success: true, data: toContractApi(contract as any) });
  } catch (error) {
    sendError(res, error, "刷新资产合同资金方式失败");
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    await assertContractReadScope(req, req.params.id);
    const currentActor = actor(req);
    const contract = await db.get<Record<string, any>>(
      `SELECT c.*, p.name AS linked_project_name,
         root_contract.financial_direction AS group_financial_direction,
         root_contract.financial_direction_source AS group_financial_direction_source,
         root_contract.financial_direction_invoice_id AS group_financial_direction_invoice_id,
         root_contract.financial_direction_confirmed_by AS group_financial_direction_confirmed_by,
         root_contract.financial_direction_confirmed_at AS group_financial_direction_confirmed_at,
         root_contract.financial_direction_version AS group_financial_direction_version,
         root_contract.asset_funding_mode AS group_asset_funding_mode,
         approval_round.id AS approval_round_id,
         approval_round.approval_kind AS approval_kind,
         approval_round.target_approver_id AS approval_target_id,
         approval_round.target_approver_name_snapshot AS approval_target_name,
         approval_round.target_approver_role_snapshot AS approval_target_role,
         approval_target_user.position AS approval_target_position,
         approval_round.target_source AS approval_target_source,
         approval_round.submitted_at AS approval_round_submitted_at,
         renewal_successor.id AS renewal_contract_id,
         renewal_successor.status AS renewal_contract_status,
         renewal_successor.name AS renewal_contract_name,
         ${currentSealedContractFileExists("c")} AS has_sealed_contract_file
       FROM contracts c
       JOIN contracts root_contract
         ON root_contract.id = COALESCE(c.root_contract_id, c.id)
       LEFT JOIN worklog_projects p ON p.id = c.project_id
       LEFT JOIN LATERAL (
         SELECT approval_round.* FROM contract_approval_rounds approval_round
         WHERE approval_round.contract_id = c.id
           AND approval_round.status = 'pending'
         ORDER BY approval_round.submitted_at DESC, approval_round.id DESC
         LIMIT 1
       ) approval_round ON TRUE
       LEFT JOIN LATERAL (
         SELECT renewal.id, renewal.status,
           COALESCE(
             NULLIF(renewal.title, ''), NULLIF(renewal.project_name, ''),
             renewal.contract_no
           ) AS name
         FROM contracts renewal
         WHERE renewal.renewed_from_contract_id = c.id
           AND renewal.is_deleted = FALSE
           AND renewal.status <> 'rejected'
         ORDER BY renewal.created_at DESC, renewal.id DESC
         LIMIT 1
       ) renewal_successor ON TRUE
       LEFT JOIN users approval_target_user
         ON approval_target_user.id = approval_round.target_approver_id
       WHERE c.id = ? AND c.is_deleted = FALSE`,
      req.params.id,
    );
    if (!contract) throw new ContractDomainError(404, "合同不存在");
    contract.financial_direction = contract.group_financial_direction;
    contract.financial_direction_source =
      contract.group_financial_direction_source;
    contract.financial_direction_invoice_id =
      contract.group_financial_direction_invoice_id;
    contract.financial_direction_confirmed_by =
      contract.group_financial_direction_confirmed_by;
    contract.financial_direction_confirmed_at =
      contract.group_financial_direction_confirmed_at;
    contract.financial_direction_version =
      contract.group_financial_direction_version;
    contract.asset_funding_mode = contract.group_asset_funding_mode;
    const rootId = contract.root_contract_id || contract.id;
    const canReadRootFinancials = (READ_ROLES as readonly string[]).includes(
      currentActor.role,
    );
    const relationAreaVisibility = requiresRestrictedContractArea(
      currentActor.role,
    )
      ? "AND area <> '全部'"
      : "";
    const financialRootId = canReadRootFinancials
      ? rootId
      : "__financial_detail_forbidden__";
    const filesPromise =
      contract.relation_type === "main"
        ? db.all<Record<string, any>>(
            `SELECT file.id, file.file_type, file.file_name, file.file_size,
                 file.mime_type, file.file_hash, file.version,
                 file.is_current, file.uploaded_by, file.created_at,
                 source.id AS source_contract_id,
                 source.relation_type AS source_relation_type,
                 source.supplement_sequence AS source_supplement_sequence,
                 COALESCE(
                   NULLIF(source.title, ''),
                   NULLIF(source.project_name, ''),
                   source.contract_no
                 ) AS source_contract_name
               FROM contract_files file
               JOIN contracts source ON source.id = file.contract_id
              WHERE source.is_deleted = FALSE
                AND COALESCE(source.root_contract_id, source.id) = ?
                AND (
                  source.relation_type = 'main'
                  OR ${currentSealedContractFileExists("source")}
                )
              ORDER BY CASE source.relation_type
                   WHEN 'main' THEN 0
                   WHEN 'supplement' THEN 1
                   WHEN 'termination' THEN 2
                   ELSE 3
                 END,
                 source.supplement_sequence ASC NULLS LAST,
                 file.created_at DESC, file.id DESC`,
            rootId,
          )
        : Promise.resolve<Record<string, any>[]>([]);
    const [
      files,
      jobs,
      approvals,
      invoices,
      receipts,
      invoiceLineRows,
      payments,
      externalPayments,
      depositReceipts,
      financialRegistrationMatches,
      relations,
      accountingRow,
    ] = await Promise.all([
      filesPromise,
      db.all<Record<string, any>>(
        `SELECT id, file_id, status, method, retry_count, warnings_json,
             error_message, engine_version, parser_version,
             started_at, finished_at, created_at
           FROM contract_ocr_jobs WHERE contract_id = ? ORDER BY created_at DESC`,
        req.params.id,
      ),
      db.all<Record<string, any>>(
        `SELECT ar.*, u.name AS approver_name,
             CASE WHEN ar.approver_role = 'general_manager'
               THEN '总经理' ELSE u.position END AS approver_position,
             approval_round.target_approver_id,
             approval_round.target_approver_name_snapshot,
             approval_round.target_approver_role_snapshot,
             approval_round.target_source
           FROM contract_approval_records ar
           LEFT JOIN users u ON u.id = ar.approver_id
           LEFT JOIN contract_approval_rounds approval_round
             ON approval_round.id = ar.approval_round_id
           WHERE ar.contract_id = ? ORDER BY ar.created_at ASC`,
        req.params.id,
      ),
      db.all<Record<string, any>>(
        `SELECT i.*, f.file_name,
             financial_ocr.status AS financial_ocr_status,
             financial_ocr.recognition_method AS financial_recognition_method,
             financial_ocr.engine_version AS financial_engine_version,
             financial_ocr.validation_status AS financial_validation_status,
             financial_ocr.direction AS financial_direction,
             financial_ocr.document_status AS financial_document_status,
             financial_ocr.can_auto_post AS financial_can_auto_post,
             financial_ocr.blocking_reasons_json AS financial_blocking_reasons,
             financial_registration.id AS financial_registration_id,
             financial_registration.status AS financial_registration_status
           FROM contract_invoices i
           JOIN contracts c ON c.id = i.contract_id
           LEFT JOIN contract_files f ON f.id = i.file_id
           LEFT JOIN contract_financial_ocr_jobs financial_ocr
             ON financial_ocr.id = i.financial_ocr_job_id
           LEFT JOIN contract_financial_registration_items registration_item
             ON registration_item.record_id = i.id AND registration_item.item_kind = 'invoice'
           LEFT JOIN contract_financial_registrations financial_registration
             ON financial_registration.id = registration_item.registration_id
             OR (registration_item.id IS NULL AND financial_registration.invoice_record_id = i.id)
           WHERE COALESCE(c.root_contract_id, c.id) = ?
             AND c.is_deleted = FALSE
           ORDER BY i.invoice_date DESC, i.created_at DESC`,
        financialRootId,
      ),
      db.all<Record<string, any>>(
        `SELECT r.*, f.file_name,
             (SELECT link.transaction_id
                FROM monthly_financial_bank_transaction_links link
                JOIN monthly_financial_bank_transactions bank_transaction
                  ON bank_transaction.id = link.transaction_id
                JOIN monthly_financial_bank_files bank_file
                  ON bank_file.id = bank_transaction.current_file_id
                 AND bank_file.is_active = TRUE
               WHERE link.business_object_type = 'contract_receipt'
                 AND link.business_object_id = r.id
                 AND link.link_kind = 'display_replacement'
                 AND link.match_status = 'active'
                 AND link.is_active = TRUE
                 AND bank_transaction.is_current = TRUE
                 AND r.status = 'confirmed'
               ORDER BY link.updated_at DESC, link.id DESC LIMIT 1)
               AS canonical_bank_transaction_id,
             financial_ocr.status AS financial_ocr_status,
             financial_ocr.recognition_method AS financial_recognition_method,
             financial_ocr.engine_version AS financial_engine_version,
             financial_ocr.validation_status AS financial_validation_status,
             financial_ocr.direction AS financial_direction,
             financial_ocr.document_status AS financial_document_status,
             financial_ocr.can_auto_post AS financial_can_auto_post,
             financial_ocr.blocking_reasons_json AS financial_blocking_reasons,
             financial_registration.id AS financial_registration_id,
             financial_registration.status AS financial_registration_status
           FROM contract_receipts r
           JOIN contracts c ON c.id = r.contract_id
           LEFT JOIN contract_files f ON f.id = r.file_id
           LEFT JOIN contract_financial_ocr_jobs financial_ocr
             ON financial_ocr.id = r.financial_ocr_job_id
           LEFT JOIN contract_financial_registration_items registration_item
             ON registration_item.record_id = r.id AND registration_item.item_kind = 'receipt'
           LEFT JOIN contract_financial_registrations financial_registration
             ON financial_registration.id = registration_item.registration_id
             OR (registration_item.id IS NULL AND financial_registration.receipt_record_id = r.id)
           WHERE COALESCE(c.root_contract_id, c.id) = ?
             AND c.is_deleted = FALSE
           ORDER BY r.receipt_date DESC, r.created_at DESC`,
        financialRootId,
      ),
      db.all<Record<string, any>>(
        `SELECT line.*, invoice.amount AS invoice_amount,
           COALESCE((
             SELECT SUM(match.allocated_amount)
             FROM contract_financial_registration_items invoice_item
             JOIN contract_financial_registration_matches match
               ON match.invoice_item_id = invoice_item.id
             JOIN contract_financial_registration_items settlement_item
               ON settlement_item.id = match.settlement_item_id
              AND settlement_item.item_kind IN ('payment', 'external_payment')
             LEFT JOIN contract_payments payment
               ON payment.id = settlement_item.record_id
              AND settlement_item.item_kind = 'payment'
             LEFT JOIN contract_external_payments external_payment
               ON external_payment.id = settlement_item.record_id
              AND settlement_item.item_kind = 'external_payment'
             WHERE invoice_item.record_id = invoice.id
               AND invoice_item.item_kind = 'invoice'
               AND COALESCE(payment.status, external_payment.status) = 'confirmed'
           ), 0) AS allocated_payment_amount
         FROM contract_invoice_line_items line
         JOIN contract_invoices invoice ON invoice.id = line.invoice_id
         JOIN contracts c ON c.id = invoice.contract_id
         WHERE COALESCE(c.root_contract_id, c.id) = ?
           AND c.is_deleted = FALSE
           AND invoice.status <> 'reversed'
         ORDER BY invoice.created_at, line.line_index`,
        financialRootId,
      ),
      db.all<Record<string, any>>(
        `SELECT p.*, f.file_name,
             COALESCE((
               SELECT SUM(detail.amount)
               FROM contract_payment_purpose_details detail
               WHERE detail.payment_record_id = p.id
                 AND detail.purpose = 'lease_deposit'
             ), CASE WHEN EXISTS(
               SELECT 1 FROM contract_payment_purpose_details purpose
               WHERE purpose.payment_record_id = p.id
             ) THEN 0 ELSE (
               SELECT SUM(deposit.confirmed_amount)
               FROM contract_payment_deposit_receipts deposit
               WHERE deposit.payment_record_id = p.id
                 AND deposit.status = 'confirmed'
             ) END, 0) AS confirmed_deposit_amount,
             (SELECT link.transaction_id
                FROM monthly_financial_bank_transaction_links link
                JOIN monthly_financial_bank_transactions bank_transaction
                  ON bank_transaction.id = link.transaction_id
                JOIN monthly_financial_bank_files bank_file
                  ON bank_file.id = bank_transaction.current_file_id
                 AND bank_file.is_active = TRUE
               WHERE link.business_object_type = 'contract_payment'
                 AND link.business_object_id = p.id
                 AND link.link_kind = 'display_replacement'
                 AND link.match_status = 'active'
                 AND link.is_active = TRUE
                 AND bank_transaction.is_current = TRUE
                 AND p.status = 'confirmed'
               ORDER BY link.updated_at DESC, link.id DESC LIMIT 1)
               AS canonical_bank_transaction_id,
             financial_ocr.status AS financial_ocr_status,
             financial_ocr.recognition_method AS financial_recognition_method,
             financial_ocr.engine_version AS financial_engine_version,
             financial_ocr.validation_status AS financial_validation_status,
             financial_ocr.direction AS financial_direction,
             financial_ocr.document_status AS financial_document_status,
             financial_ocr.can_auto_post AS financial_can_auto_post,
             financial_ocr.blocking_reasons_json AS financial_blocking_reasons,
             financial_registration.id AS financial_registration_id,
             financial_registration.status AS financial_registration_status
           FROM contract_payments p
           JOIN contracts c ON c.id = p.contract_id
           LEFT JOIN contract_files f ON f.id = p.file_id
           LEFT JOIN contract_financial_ocr_jobs financial_ocr
             ON financial_ocr.id = p.financial_ocr_job_id
           LEFT JOIN contract_financial_registration_items registration_item
             ON registration_item.record_id = p.id AND registration_item.item_kind = 'payment'
           LEFT JOIN contract_financial_registrations financial_registration
             ON financial_registration.id = registration_item.registration_id
             OR (registration_item.id IS NULL AND financial_registration.payment_record_id = p.id)
           WHERE COALESCE(c.root_contract_id, c.id) = ?
             AND c.is_deleted = FALSE
           ORDER BY p.payment_date DESC, p.created_at DESC`,
        financialRootId,
      ),
      db.all<Record<string, any>>(
        `SELECT p.*, f.file_name,
             COALESCE((
               SELECT SUM(detail.amount)
               FROM contract_payment_purpose_details detail
               WHERE detail.external_payment_record_id = p.id
                 AND detail.purpose = 'lease_deposit'
             ), CASE WHEN EXISTS(
               SELECT 1 FROM contract_payment_purpose_details purpose
               WHERE purpose.external_payment_record_id = p.id
             ) THEN 0 ELSE (
               SELECT SUM(deposit.confirmed_amount)
               FROM contract_payment_deposit_receipts deposit
               WHERE deposit.external_payment_record_id = p.id
                 AND deposit.status = 'confirmed'
             ) END, 0) AS confirmed_deposit_amount,
             (SELECT link.transaction_id
                FROM monthly_financial_bank_transaction_links link
                JOIN monthly_financial_bank_transactions bank_transaction
                  ON bank_transaction.id = link.transaction_id
                JOIN monthly_financial_bank_files bank_file
                  ON bank_file.id = bank_transaction.current_file_id
                 AND bank_file.is_active = TRUE
               WHERE link.business_object_type = 'contract_external_payment'
                 AND link.business_object_id = p.id
                 AND link.link_kind = 'display_replacement'
                 AND link.match_status = 'active'
                 AND link.is_active = TRUE
                 AND bank_transaction.is_current = TRUE
                 AND p.status = 'confirmed'
               ORDER BY link.updated_at DESC, link.id DESC LIMIT 1)
               AS canonical_bank_transaction_id,
             financial_ocr.status AS financial_ocr_status,
             financial_ocr.recognition_method AS financial_recognition_method,
             financial_ocr.engine_version AS financial_engine_version,
             financial_ocr.validation_status AS financial_validation_status,
             financial_ocr.direction AS financial_direction,
             financial_ocr.document_status AS financial_document_status,
             financial_ocr.can_auto_post AS financial_can_auto_post,
             financial_ocr.blocking_reasons_json AS financial_blocking_reasons,
             financial_registration.id AS financial_registration_id,
             financial_registration.status AS financial_registration_status
           FROM contract_external_payments p
           JOIN contracts c ON c.id = p.contract_id
           LEFT JOIN contract_files f ON f.id = p.file_id
           LEFT JOIN contract_financial_ocr_jobs financial_ocr
             ON financial_ocr.id = p.financial_ocr_job_id
           LEFT JOIN contract_financial_registration_items registration_item
             ON registration_item.record_id = p.id
            AND registration_item.item_kind = 'external_payment'
           LEFT JOIN contract_financial_registrations financial_registration
             ON financial_registration.id = registration_item.registration_id
           WHERE COALESCE(c.root_contract_id, c.id) = ?
             AND c.is_deleted = FALSE
           ORDER BY p.payment_date DESC, p.created_at DESC`,
        financialRootId,
      ),
      db.all<DepositReceiptRow>(
        `SELECT deposit.*, uploader.name AS uploaded_by_name,
             confirmer.name AS confirmed_by_name,
             voider.name AS voided_by_name
         FROM contract_payment_deposit_receipts deposit
         LEFT JOIN users uploader ON uploader.id = deposit.uploaded_by
         LEFT JOIN users confirmer ON confirmer.id = deposit.confirmed_by
         LEFT JOIN users voider ON voider.id = deposit.voided_by
         WHERE deposit.contract_id = ?
         ORDER BY deposit.created_at ASC, deposit.id ASC`,
        financialRootId,
      ),
      db.all<Record<string, any>>(
        `SELECT match.registration_id,
             invoice_item.record_id AS invoice_record_id,
             settlement_item.record_id AS settlement_record_id,
             settlement_item.item_kind AS settlement_kind,
             match.allocated_amount, match.created_at
           FROM contract_financial_registration_matches match
           JOIN contract_financial_registration_items invoice_item
             ON invoice_item.id = match.invoice_item_id
            AND invoice_item.item_kind = 'invoice'
           JOIN contract_financial_registration_items settlement_item
             ON settlement_item.id = match.settlement_item_id
            AND settlement_item.item_kind IN ('receipt', 'payment', 'external_payment')
           JOIN contracts c ON c.id = match.contract_id
           WHERE COALESCE(c.root_contract_id, c.id) = ?
             AND c.is_deleted = FALSE
           ORDER BY match.created_at ASC, match.id ASC`,
        financialRootId,
      ),
      db.all<Record<string, any>>(
        `SELECT id, contract_no, business_contract_no, title, project_name,
             declared_category, category, relation_type, status,
             amount_delta, original_contract_amount, recognized_original_amount,
             recognized_final_amount, amount_before_change, amount_after_change,
             current_effective_amount, supplement_change_type,
             supplement_sequence, effective_at,
             parent_contract_id, root_contract_id,
             termination_target_contract_id
           FROM contracts
           WHERE is_deleted = FALSE
             ${relationAreaVisibility}
             AND (id = ? OR parent_contract_id = ? OR root_contract_id = ?)
           ORDER BY CASE relation_type WHEN 'main' THEN 0 WHEN 'supplement' THEN 1 ELSE 2 END,
             supplement_sequence ASC NULLS LAST,
             effective_at ASC NULLS LAST, created_at ASC, id ASC`,
        rootId,
        req.params.id,
        rootId,
      ),
      db.get<{
        current_amount: number;
        projected_amount: number;
        pending_supplement_count: number;
        invoice_amount: number;
        received_amount: number;
        paid_amount: number;
        external_paid_amount: number;
        cost_settled_amount: number;
        root_terminated: boolean;
        root_rejected: boolean;
      }>(
        `SELECT
             EXISTS (
               SELECT 1 FROM contracts root WHERE root.id = ? AND root.status = 'terminated'
             ) AS root_terminated,
             EXISTS (
               SELECT 1 FROM contracts root WHERE root.id = ? AND root.status = 'rejected'
             ) AS root_rejected,
             CASE WHEN EXISTS (
               SELECT 1 FROM contracts root
             WHERE root.id = ? AND root.status IN ('rejected', 'terminated')
             ) THEN 0 ELSE COALESCE((
               SELECT COALESCE(
                 root.current_effective_amount,
                 root.original_contract_amount,
                 root.amount_delta,
                 0
               ) FROM contracts root WHERE root.id = ?
             ), 0) END AS current_amount,
             CASE WHEN EXISTS (
               SELECT 1 FROM contracts root
               WHERE root.id = ? AND root.status IN ('rejected', 'terminated')
             ) THEN 0 ELSE COALESCE((
               SELECT COALESCE((
                 SELECT pending.amount_after_change
                 FROM contracts pending
                 WHERE pending.root_contract_id = root.id
                   AND pending.relation_type = 'supplement'
                   AND pending.is_deleted = FALSE
                   AND pending.status IN ('approving', 'pending_seal')
                   AND pending.amount_after_change IS NOT NULL
                 ORDER BY pending.supplement_sequence DESC NULLS LAST,
                   pending.created_at DESC, pending.id DESC
                 LIMIT 1
               ), root.current_effective_amount,
                 root.original_contract_amount, root.amount_delta, 0
               ) FROM contracts root WHERE root.id = ?
             ), 0) END AS projected_amount,
             (SELECT COUNT(*)::int FROM contracts
               WHERE COALESCE(root_contract_id, id) = ?
                 AND is_deleted = FALSE
                 AND relation_type = 'supplement'
                 AND status IN ('approving', 'pending_seal')) AS pending_supplement_count,
             CASE WHEN EXISTS (
               SELECT 1 FROM contracts root WHERE root.id = ? AND root.status = 'rejected'
             ) THEN 0 ELSE COALESCE((SELECT SUM(i.amount) FROM contract_invoices i
               JOIN contracts c ON c.id = i.contract_id
               WHERE COALESCE(c.root_contract_id, c.id) = ?
                 AND c.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("i")}), 0) END AS invoice_amount,
             CASE WHEN EXISTS (
               SELECT 1 FROM contracts root WHERE root.id = ? AND root.status = 'rejected'
             ) THEN 0 ELSE COALESCE((SELECT SUM(r.amount) FROM contract_receipts r
               JOIN contracts c ON c.id = r.contract_id
               WHERE COALESCE(c.root_contract_id, c.id) = ?
                 AND c.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("r")}), 0) END AS received_amount,
             CASE WHEN EXISTS (
               SELECT 1 FROM contracts root WHERE root.id = ? AND root.status = 'rejected'
             ) THEN 0 ELSE COALESCE((SELECT SUM(p.amount) FROM contract_payments p
               JOIN contracts c ON c.id = p.contract_id
               WHERE COALESCE(c.root_contract_id, c.id) = ?
                 AND c.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("p")}), 0) END AS paid_amount,
             CASE WHEN EXISTS (
               SELECT 1 FROM contracts root WHERE root.id = ? AND root.status = 'rejected'
             ) THEN 0 ELSE COALESCE((SELECT SUM(p.amount) FROM contract_external_payments p
               JOIN contracts c ON c.id = p.contract_id
               WHERE COALESCE(c.root_contract_id, c.id) = ?
                 AND c.status <> 'rejected'
                 AND ${confirmedFinancialPredicate("p")}), 0) END AS external_paid_amount,
             COALESCE((
               SELECT ${contractCostSettlementAmountSql({
                 rootAlias: "accounting_root",
                 rootIdExpression: "accounting_root.id",
               })}
               FROM contracts accounting_root
               WHERE accounting_root.id = ?
                 AND accounting_root.is_deleted = FALSE
             ), 0) AS cost_settled_amount`,
        rootId,
        rootId,
        rootId,
        rootId,
        rootId,
        rootId,
        rootId,
        rootId,
        financialRootId,
        rootId,
        financialRootId,
        rootId,
        financialRootId,
        rootId,
        financialRootId,
        financialRootId,
      ),
    ]);
    const latestJob = jobs[0] || null;
    const ocrFields = latestJob
      ? await db.all<Record<string, any>>(
          `SELECT field_code, original_value, normalized_value, final_value,
             confidence, source, page_number, evidence, manually_confirmed,
             confirmed_by, confirmed_at
           FROM contract_ocr_fields WHERE job_id = ? ORDER BY field_code`,
          latestJob.id,
        )
      : [];
    const latestProjectField = ocrFields.find(
      (field) => field.field_code === "project_name",
    );
    const latestProjectValue = String(
      latestProjectField?.final_value ||
        latestProjectField?.normalized_value ||
        "",
    )
      .replace(/\s+/g, "")
      .trim();
    const storedProjectRefreshLines =
      contract.status === "draft" &&
      contract.relation_type === "main" &&
      latestJob?.status === "succeeded" &&
      latestJob.parser_version !== CONTRACT_OCR_PARSER_VERSION &&
      latestProjectValue
        ? await db.all<StoredProjectRefreshOcrLine>(
            `SELECT line_index, page_number, text, confidence
             FROM contract_ocr_lines
             WHERE job_id = ? AND BTRIM(text) <> ''
             ORDER BY line_index`,
            latestJob.id,
          )
        : [];
    const staleSucceededProjectNeedsRefresh =
      latestJob?.status === "succeeded" &&
      /(?:技术|咨询服|规划许可|施工许可|许可证|输变电|变电)$/u.test(
        latestProjectValue,
      );
    const staleSucceededProjectContinuationNeedsRefresh =
      contract.status === "draft" &&
      contract.relation_type === "main" &&
      latestJob?.status === "succeeded" &&
      storedProjectContinuationNeedsRefresh(
        storedProjectRefreshLines,
        latestProjectValue,
      );
    const staleSucceededPageFailureNeedsRefresh =
      latestJob?.status === "succeeded" &&
      Array.isArray(latestJob.warnings_json) &&
      latestJob.warnings_json.some((warning: unknown) =>
        /第\s*\d+\s*页(?:扫描|高清|超清)识别失败/u.test(String(warning)),
      );
    const [accountingReceipts, accountingPayments, rateHistory, rates] =
      await Promise.all([
        db.all<DatedContractAmountRow>(
          `SELECT r.amount, r.receipt_date AS "occurredAt",
             r.rate_snapshot_json AS "rateSnapshot"
           FROM contract_receipts r
           JOIN contracts c ON c.id = r.contract_id
           WHERE COALESCE(c.root_contract_id, c.id) = ?
             AND c.is_deleted = FALSE
             AND c.status <> 'rejected'
             AND ${confirmedFinancialPredicate("r")}
           ORDER BY r.receipt_date ASC, r.created_at ASC`,
          financialRootId,
        ),
        db.all<DatedContractPaymentRow>(
          `SELECT p.amount, p.payment_date AS "occurredAt",
             p.expense_category AS "expenseCategory"
           FROM contract_payments p
           JOIN contracts c ON c.id = p.contract_id
           WHERE COALESCE(c.root_contract_id, c.id) = ?
             AND c.is_deleted = FALSE
             AND c.status <> 'rejected'
             AND ${confirmedFinancialPredicate("p")}
           ORDER BY p.payment_date ASC, p.created_at ASC`,
          financialRootId,
        ),
        loadRateHistory(),
        loadCurrentRates(),
      ]);
    const excludedFromPerformance =
      contract.status === "rejected" || Boolean(accountingRow?.root_rejected);
    const currentAmount = Number(accountingRow?.current_amount || 0);
    const projectedAmount = Number(
      accountingRow?.projected_amount ?? currentAmount,
    );
    const pendingSupplementCount = Number(
      accountingRow?.pending_supplement_count || 0,
    );
    const isPendingSupplement =
      contract.relation_type === "supplement" &&
      ["approving", "pending_seal"].includes(contract.status);
    const supplementAmountBeforeChange = ["supplement", "termination"].includes(
      contract.relation_type,
    )
      ? contract.amount_before_change == null
        ? null
        : Number(contract.amount_before_change)
      : null;
    const supplementAmountAfterChange =
      !["supplement", "termination"].includes(contract.relation_type) ||
      contract.amount_after_change == null
        ? null
        : Number(contract.amount_after_change);
    const hasPendingMainSupplementChange =
      contract.relation_type === "main" &&
      pendingSupplementCount > 0 &&
      projectedAmount !== currentAmount;
    const accountingBasisAmount =
      isPendingSupplement && supplementAmountAfterChange !== null
        ? supplementAmountAfterChange
        : hasPendingMainSupplementChange
          ? projectedAmount
          : currentAmount;
    const receivedAmount = excludedFromPerformance
      ? 0
      : Number(accountingRow?.received_amount || 0);
    const paidAmount = excludedFromPerformance
      ? 0
      : Number(accountingRow?.paid_amount || 0);
    const externalPaidAmount = excludedFromPerformance
      ? 0
      : Number(accountingRow?.external_paid_amount || 0);
    const costSettledAmount = excludedFromPerformance
      ? 0
      : Number(accountingRow?.cost_settled_amount || 0);
    const settledAmount =
      contract.financial_direction === "cost"
        ? costSettledAmount
        : contract.financial_direction === "income"
          ? receivedAmount
          : 0;
    const completionRate =
      contract.financial_direction && accountingBasisAmount > 0
        ? Math.round((settledAmount / accountingBasisAmount) * 10000) / 100
        : null;
    const accounting =
      canReadRootFinancials && contract.category && contract.financial_direction
        ? buildContractAccounting(
            contract.category as ContractCategory,
            contract.financial_direction,
            accountingBasisAmount,
            excludedFromPerformance ? [] : accountingReceipts,
            excludedFromPerformance ? [] : accountingPayments,
            rateHistory,
          )
        : null;
    const invoiceLineItemsByInvoice = new Map<string, Record<string, any>[]>();
    for (const row of invoiceLineRows) {
      const rows = invoiceLineItemsByInvoice.get(row.invoice_id) || [];
      rows.push(row);
      invoiceLineItemsByInvoice.set(row.invoice_id, rows);
    }
    const rentalInvoiceSummaryCents = {
      rent: 0,
      propertyManagement: 0,
      contractAccountingExpense: 0,
      outsideContractCost: 0,
      electricity: 0,
      systemMaintenance: 0,
    };
    for (const rows of invoiceLineItemsByInvoice.values()) {
      const invoiceTotalCents = toCents(String(rows[0]?.invoice_amount || 0));
      const allocatedCents = Math.min(
        invoiceTotalCents,
        toCents(String(rows[0]?.allocated_payment_amount || 0)),
      );
      const accountingGrossCents = rows.reduce(
        (sum, row) =>
          row.include_in_contract_accounting &&
          row.recognition_status === "verified"
            ? sum + toCents(String(row.gross_amount))
            : sum,
        0,
      );
      const accountingAllocatedCents =
        invoiceTotalCents > 0
          ? prorateContractSettlementCents(
              allocatedCents,
              accountingGrossCents,
              invoiceTotalCents,
            )
          : 0;
      rentalInvoiceSummaryCents.contractAccountingExpense +=
        accountingAllocatedCents;
      rentalInvoiceSummaryCents.outsideContractCost +=
        allocatedCents - accountingAllocatedCents;
      let allocatedSoFar = 0;
      rows.forEach((row, index) => {
        const grossCents = toCents(String(row.gross_amount));
        const actualPaidCents =
          index === rows.length - 1
            ? allocatedCents - allocatedSoFar
            : invoiceTotalCents > 0
              ? Math.floor((allocatedCents * grossCents) / invoiceTotalCents)
              : 0;
        allocatedSoFar += actualPaidCents;
        row.actual_paid_amount = centsToAmount(actualPaidCents);
        if (row.expense_category === "rent") {
          rentalInvoiceSummaryCents.rent += actualPaidCents;
        } else if (row.expense_category === "property_management") {
          rentalInvoiceSummaryCents.propertyManagement += actualPaidCents;
        } else if (row.expense_category === "electricity") {
          rentalInvoiceSummaryCents.electricity += actualPaidCents;
        } else if (row.expense_category === "system_maintenance") {
          rentalInvoiceSummaryCents.systemMaintenance += actualPaidCents;
        }
      });
    }
    const rentalInvoiceSummary = Object.fromEntries(
      Object.entries(rentalInvoiceSummaryCents).map(([key, cents]) => [
        key,
        centsToAmount(cents),
      ]),
    );
    const mapFinancialRecord = (
      row: Record<string, any>,
      kind: FinancialRecordKind | "external_payment",
    ) => ({
      id: row.id,
      contractId: row.contract_id,
      amount: Number(row.amount),
      recordDate:
        kind === "invoice"
          ? row.invoice_date
          : kind === "receipt"
            ? row.receipt_date
            : row.payment_date,
      fileId: row.file_id,
      fileName: row.file_name,
      canonicalReceiptPreviewUrl:
        ["admin", "general_manager"].includes(
          String(req.session.user?.role || ""),
        ) && row.canonical_bank_transaction_id
          ? `/api/monthly-financial-reports/bank-transactions/${row.canonical_bank_transaction_id}/preview`
          : null,
      status: row.status,
      reversed: row.status === "reversed",
      reversedBy: row.reversed_by,
      reversedAt: row.reversed_at,
      reverseReason: row.reverse_reason,
      note: row.note,
      invoiceCode: row.invoice_code,
      invoiceNo: row.invoice_no,
      itemName: row.item_name,
      taxAmount:
        row.tax_amount === undefined
          ? undefined
          : row.tax_amount === null
            ? null
            : Number(row.tax_amount),
      seller: row.seller,
      buyer: row.buyer,
      lineItems:
        kind === "invoice"
          ? (invoiceLineItemsByInvoice.get(row.id) || []).map((line) => ({
              id: line.id,
              itemName: line.item_name,
              netAmount: Number(line.net_amount),
              taxAmount: Number(line.tax_amount),
              grossAmount: Number(line.gross_amount),
              expenseCategory: line.expense_category,
              includeInContractAccounting: Boolean(
                line.include_in_contract_accounting,
              ),
              recognitionStatus: line.recognition_status,
              actualPaidAmount: Number(line.actual_paid_amount || 0),
            }))
          : undefined,
      payer: row.payer,
      payerAccount: row.payer_account,
      payee: row.payee,
      payeeAccount: row.payee_account,
      bankName: row.bank_name,
      currency: row.currency,
      bookingDate: row.booking_date,
      paymentTime: row.payment_time,
      electronicReceiptNo: row.electronic_receipt_no,
      transactionSerialNo: row.transaction_serial_no,
      proofNo: row.proof_no,
      expenseCategory: row.expense_category,
      confirmedDepositAmount: Number(row.confirmed_deposit_amount || 0),
      invoiceRequiredAmount:
        kind === "payment" || kind === "external_payment"
          ? calculatePaymentInvoiceRequiredAmount(
              Number(row.amount || 0),
              Number(row.confirmed_deposit_amount || 0),
            )
          : undefined,
      financialOcrJobId: row.financial_ocr_job_id,
      financialRegistrationId: row.financial_registration_id,
      financialRegistrationStatus: row.financial_registration_status,
      financialOcrStatus: row.financial_ocr_status,
      financialRecognitionMethod: row.financial_recognition_method,
      financialEngineVersion: row.financial_engine_version,
      historicalConfirmedImport:
        row.financial_recognition_method === "historical_confirmed_import",
      financialValidationStatus: row.financial_validation_status,
      financialDirection: row.financial_direction,
      financialDocumentStatus: row.financial_document_status,
      financialCanAutoPost: row.financial_can_auto_post,
      financialBlockingReasons: row.financial_blocking_reasons || [],
      createdBy: row.created_by,
      createdAt: row.created_at,
    });
    res.json({
      success: true,
      data: {
        contract: {
          ...toContractApi(contract),
          name: contract.title || contract.project_name || contract.contract_no,
          amount: Number(contract.amount_delta || 0),
          currentAmount,
          projectedAmount,
          pendingSupplementCount,
          amountBeforeChange: supplementAmountBeforeChange,
          amountAfterChange: supplementAmountAfterChange,
          receivedAmount,
          paidAmount,
          externalPaidAmount,
          costSettledAmount,
          completionRate,
        },
        files: files.map((file) => ({
          id: file.id,
          fileType: file.file_type,
          fileName: file.file_name,
          fileSize: file.file_size,
          mimeType: file.mime_type,
          version: file.version,
          isCurrent: file.is_current,
          uploadedBy: file.uploaded_by,
          createdAt: file.created_at,
          sourceContractId: file.source_contract_id,
          sourceRelationType: file.source_relation_type,
          sourceSupplementSequence: file.source_supplement_sequence,
          sourceContractName: file.source_contract_name,
        })),
        ocrJob: latestJob
          ? {
              ...latestJob,
              requires_refresh:
                latestJob.parser_version !== CONTRACT_OCR_PARSER_VERSION &&
                (latestJob.status === "partial" ||
                  staleSucceededProjectNeedsRefresh ||
                  staleSucceededProjectContinuationNeedsRefresh ||
                  staleSucceededPageFailureNeedsRefresh),
            }
          : null,
        ocrFields: ocrFields.map((field) => ({
          field: field.field_code,
          originalValue: field.original_value,
          normalizedValue: field.normalized_value,
          finalValue: contractOcrFinalValueForResponse(
            field.field_code,
            field.final_value,
            contract.relation_type,
            contract.project_name,
          ),
          confidence: Number(field.confidence),
          source: field.source,
          pageNumber: field.page_number,
          evidence: field.evidence,
          manuallyConfirmed: field.manually_confirmed,
          confirmedBy: field.confirmed_by,
          confirmedAt: field.confirmed_at,
        })),
        approvals,
        invoices: invoices.map((row) => mapFinancialRecord(row, "invoice")),
        receipts: receipts.map((row) => mapFinancialRecord(row, "receipt")),
        payments: payments.map((row) => mapFinancialRecord(row, "payment")),
        externalPayments: externalPayments.map((row) =>
          mapFinancialRecord(row, "external_payment"),
        ),
        depositReceipts: depositReceipts.map(toDepositReceiptApi),
        financialRegistrationMatches: financialRegistrationMatches.map(
          (match) => ({
            registrationId: match.registration_id,
            invoiceRecordId: match.invoice_record_id,
            settlementRecordId: match.settlement_record_id,
            settlementKind: match.settlement_kind,
            allocatedAmount: Number(match.allocated_amount),
          }),
        ),
        relations: relations.map((relation) => ({
          id: relation.id,
          contractId: relation.id,
          contractName:
            relation.title ||
            relation.project_name ||
            relation.business_contract_no ||
            relation.contract_no ||
            "未命名合同",
          contractNo:
            (relation.category || relation.declared_category) ===
            "main_business"
              ? relation.business_contract_no || relation.contract_no
              : relation.contract_no,
          relationType: relation.relation_type,
          terminationTargetContractId:
            relation.termination_target_contract_id || null,
          amount: Number(relation.amount_delta || 0),
          supplementSequence: relation.supplement_sequence,
          supplementChangeType: relation.supplement_change_type,
          originalContractAmount:
            relation.original_contract_amount == null
              ? null
              : Number(relation.original_contract_amount),
          recognizedOriginalAmount:
            relation.recognized_original_amount == null
              ? null
              : Number(relation.recognized_original_amount),
          recognizedFinalAmount:
            relation.recognized_final_amount == null
              ? null
              : Number(relation.recognized_final_amount),
          amountBeforeChange:
            relation.amount_before_change == null
              ? null
              : Number(relation.amount_before_change),
          amountAfterChange:
            relation.amount_after_change == null
              ? null
              : Number(relation.amount_after_change),
          fulfilledAmount:
            relation.relation_type === "termination" &&
            relation.amount_after_change != null
              ? Number(relation.amount_after_change)
              : null,
          unperformedAmount:
            relation.relation_type === "termination" &&
            relation.amount_delta != null
              ? Math.max(0, -Number(relation.amount_delta))
              : null,
          terminationFinalAmount:
            relation.relation_type === "termination" &&
            relation.amount_after_change != null
              ? Number(relation.amount_after_change)
              : null,
          currentEffectiveAmount:
            relation.current_effective_amount == null
              ? null
              : Number(relation.current_effective_amount),
          effectiveAt: relation.effective_at,
          status: relation.status,
        })),
        accounting: accounting
          ? {
              ...accounting,
              currentAmount: accountingBasisAmount,
              invoiceAmount: excludedFromPerformance
                ? 0
                : Number(accountingRow?.invoice_amount || 0),
              receivedAmount,
              paidAmount,
              costSettledAmount,
              settledAmount,
              completionRate,
              overAmount:
                accountingRow?.root_terminated || excludedFromPerformance
                  ? 0
                  : excessContractAmount(accountingBasisAmount, settledAmount),
              rates: rates.decimal,
            }
          : null,
        rentalInvoiceSummary,
      },
    });
  } catch (error) {
    sendError(res, error, "获取合同详情失败");
  }
});

router.put("/:id", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    if (Object.prototype.hasOwnProperty.call(req.body, "parentContractId")) {
      throw new ContractDomainError(
        409,
        "上级合同已在上传时锁定；如选错，请删除草稿后重新上传",
        "CONTRACT_PARENT_IMMUTABLE",
      );
    }
    const recognitionFieldPayloadKeys = [
      "partyA",
      "partyB",
      "projectName",
      "amount",
      "amountDelta",
      "category",
      "contractDate",
      "contract_date",
      "confirmedFields",
      "ocrFields",
    ];
    const attemptedRecognitionFields = recognitionFieldPayloadKeys.filter(
      (key) => req.body[key] !== undefined,
    );
    if (attemptedRecognitionFields.length > 0) {
      throw new ContractDomainError(
        400,
        "甲乙方、项目名称、金额、合同类型和合同日期仅允许由自动识别或财务确认接口写入",
        "OCR_FIELDS_READ_ONLY",
      );
    }
    if (
      req.body.declaredCategory !== undefined ||
      req.body.declared_category !== undefined
    ) {
      throw new ContractDomainError(
        409,
        "合同预选分类已在上传时锁定，不能修改",
        "CONTRACT_DECLARED_CATEGORY_IMMUTABLE",
      );
    }
    if (
      req.body.declaredSubtype !== undefined ||
      req.body.declared_subtype !== undefined
    ) {
      throw new ContractDomainError(
        409,
        "合同二级分类已在上传时锁定，不能修改",
        "CONTRACT_DECLARED_SUBTYPE_IMMUTABLE",
      );
    }
    if (req.body.relationType !== undefined) {
      throw new ContractDomainError(
        409,
        "合同层级关系已在上传时锁定；如选错，请删除草稿后按正确层级重新上传",
        "CONTRACT_RELATION_TYPE_IMMUTABLE",
      );
    }
    const assetCategory =
      req.body.assetCategory === undefined
        ? undefined
        : normalizeAssetCategory(normalizeNullableText(req.body.assetCategory));
    if (
      req.body.assetCategory !== undefined &&
      req.body.assetCategory !== null &&
      String(req.body.assetCategory).trim() !== "" &&
      !assetCategory
    ) {
      throw new ContractDomainError(400, "资产合同分类不正确");
    }
    const area =
      req.body.area === undefined
        ? undefined
        : normalizeNullableText(req.body.area) || undefined;
    if (area !== undefined && !CONTRACT_AREA_SET.has(area)) {
      throw new ContractDomainError(400, "合同所属区域必须是北京市行政区");
    }

    const contract = await db.transaction(async (client) =>
      updateContractDraft(
        req.params.id,
        {
          title:
            req.body.title === undefined
              ? undefined
              : normalizeNullableText(req.body.title),
          description:
            req.body.description === undefined
              ? undefined
              : normalizeNullableText(req.body.description),
          assetCategory,
          area,
          projectId:
            req.body.projectId === undefined
              ? undefined
              : normalizeNullableText(req.body.projectId),
          expectedVersion: parseExpectedVersion(
            req.body.expectedVersion ?? req.body.version,
          ),
        },
        currentActor.id,
        currentActor.role,
        client,
      ),
    );
    res.json({ success: true, data: toContractApi(contract as any) });
  } catch (error) {
    sendError(res, error, "更新合同失败");
  }
});

router.patch(
  "/:id/auxiliary-material-setting",
  requireFinance,
  async (req, res) => {
    try {
      if (typeof req.body?.requiresAuxiliaryMaterials !== "boolean") {
        throw new ContractDomainError(400, "是否需要辅助材料必须选择是或否");
      }
      const expectedVersion = parseExpectedVersion(
        req.body.expectedVersion ?? req.body.version,
      );
      const currentActor = actor(req);
      const contract = await db.transaction(async (client) => {
        const locked = await client.query<ContractRow>(
          `SELECT * FROM contracts
           WHERE id = $1 AND is_deleted = FALSE
           FOR UPDATE`,
          [req.params.id],
        );
        const current = locked.rows[0];
        if (!current) throw new ContractDomainError(404, "合同不存在");
        if (current.version !== expectedVersion) {
          throw new ContractDomainError(
            409,
            "合同已被其他操作更新，请刷新后重试",
            "CONTRACT_VERSION_CONFLICT",
          );
        }
        if (["rejected", "terminated"].includes(current.status)) {
          throw new ContractDomainError(
            409,
            "已拒绝或已终止合同不能修改辅助材料设置",
            "CONTRACT_AUXILIARY_SETTING_FORBIDDEN",
          );
        }
        if (req.body.requiresAuxiliaryMaterials === false) {
          const auxiliary = await client.query<{ has_content: boolean }>(
            `SELECT EXISTS(
               SELECT 1 FROM contract_auxiliary_packages
               WHERE parent_contract_id = $1
             ) AS has_content`,
            [current.id],
          );
          if (auxiliary.rows[0]?.has_content) {
            throw new ContractDomainError(
              409,
              "请先删除全部辅助材料后再关闭辅助材料开关",
              "CONTRACT_AUXILIARY_SETTING_HAS_CONTENT",
            );
          }
        }
        const now = new Date().toISOString();
        const updated = await client.query<ContractRow>(
          `UPDATE contracts
           SET requires_auxiliary_materials = $2,
             updated_by = $3, updated_at = $4, version = version + 1
           WHERE id = $1 RETURNING *`,
          [
            current.id,
            req.body.requiresAuxiliaryMaterials,
            currentActor.id,
            now,
          ],
        );
        await client.query(
          `INSERT INTO contract_audit_logs (
             id, contract_id, action, actor_id, actor_role, from_status,
             to_status, changes_json, created_at
           ) VALUES ($1,$2,'auxiliary_material_requirement_updated',$3,$4,$5,$5,$6::jsonb,$7)`,
          [
            nanoid(),
            current.id,
            currentActor.id,
            currentActor.role,
            current.status,
            JSON.stringify({
              from: Boolean(current.requires_auxiliary_materials),
              to: req.body.requiresAuxiliaryMaterials,
            }),
            now,
          ],
        );
        return updated.rows[0]!;
      });
      res.json({ success: true, data: toContractApi(contract as any) });
    } catch (error) {
      sendError(res, error, "更新辅助材料设置失败");
    }
  },
);

router.delete("/:id", requireFinance, async (req, res) => {
  try {
    if (req.body?.confirmed !== true) {
      throw new ContractDomainError(400, "删除合同前必须进行二次确认");
    }
    const currentActor = actor(req);
    const deleted = await deleteContractDraft(
      req.params.id,
      currentActor.id,
      currentActor.role,
      parseExpectedVersion(req.body?.expectedVersion ?? req.body?.version),
    );
    res.json({
      success: true,
      data: {
        id: req.params.id,
        deleted: true,
        permanent: true,
        deletedFileCount: deleted.deletedFileCount,
        failedFileCount: deleted.failedFilePaths.length,
      },
    });
  } catch (error) {
    sendError(res, error, "删除合同草稿失败");
  }
});

router.post("/:id/cancel", requireFinance, async (req, res) => {
  try {
    if (req.body?.confirmed !== true) {
      throw new ContractDomainError(400, "撤销合同前必须进行二次确认");
    }
    const currentActor = actor(req);
    await cancelContractBeforeSeal(
      req.params.id,
      currentActor.id,
      currentActor.role,
      parseExpectedVersion(req.body?.expectedVersion ?? req.body?.version),
      String(req.body?.cancellationReason || ""),
    );
    res.json({ success: true, data: { id: req.params.id, cancelled: true } });
  } catch (error) {
    sendError(res, error, "撤销合同失败");
  }
});

router.post("/:id/withdraw", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const contract = await withdrawContractApproval(
      req.params.id,
      currentActor.id,
      currentActor.role,
      parseExpectedVersion(req.body?.expectedVersion ?? req.body?.version),
    );
    res.json({ success: true, data: toContractApi(contract as any) });
  } catch (error) {
    sendError(res, error, "撤回合同审批失败");
  }
});

router.post("/:id/submit", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const contract = await submitContractForApproval(
      req.params.id,
      currentActor.id,
      currentActor.role,
      normalizeNullableText(req.body.comment) || undefined,
    );
    res.json({ success: true, data: toContractApi(contract as any) });
  } catch (error) {
    sendError(res, error, "提交合同审批失败");
  }
});

router.post("/:id/approve", requireContractApprover, async (req, res) => {
  try {
    const currentActor = actor(req);
    const action = String(req.body.action || "") as
      | "approve"
      | "reject"
      | "comment";
    if (!(["approve", "reject", "comment"] as const).includes(action)) {
      throw new ContractDomainError(400, "审批动作不正确");
    }
    const contract = await decideContractApproval(
      req.params.id,
      action,
      currentActor.id,
      currentActor.role,
      normalizeNullableText(req.body.comment) || undefined,
    );
    res.json({ success: true, data: toContractApi(contract as any) });
  } catch (error) {
    sendError(res, error, "处理合同审批失败");
  }
});

router.post("/:id/sealed", requireFinance, uploadSingle, async (req, res) => {
  let stored = false;
  try {
    const file = await validateUploadedFile(req.file, ["pdf", "jpeg", "png"]);
    const currentActor = actor(req);
    const expectedVersion = parseExpectedVersion(
      req.body?.expectedVersion ?? req.body?.version,
    );
    const recognitionContext = await assertSealedContractRecognitionAllowed(
      req.params.id,
      expectedVersion,
    );
    // 识别可能跨越自然日，上传日期必须在开始耗时识别前固定。
    const uploadDate = currentShanghaiDate();
    const recognition = await recognizeSealedContractFile(
      path.resolve(process.cwd(), file.filePath),
      file.mimeType,
      recognitionContext,
    );
    const result = await createSealedContractVerification({
      contractId: req.params.id,
      file,
      recognition,
      uploadDate,
      actorId: currentActor.id,
      actorRole: currentActor.role,
      expectedVersion,
    });
    stored = true;
    res.status(201).json({
      success: true,
      data: {
        contract: {
          ...toContractApi(result.contract as any),
          hasSealedContractFile: true,
        },
        verification: result.verification,
      },
    });
  } catch (error) {
    if (!stored) cleanupUploadedFile(req.file);
    sendError(res, error, "上传盖章合同并发起核验失败");
  }
});

router.get(
  "/:id/sealed-verifications/latest",
  requireAuth,
  async (req, res) => {
    try {
      await assertContractReadScope(req, req.params.id);
      const verification = await getSealedContractVerification(req.params.id);
      res.json({ success: true, data: verification });
    } catch (error) {
      sendError(res, error, "读取盖章合同核验记录失败");
    }
  },
);

router.get(
  "/:id/sealed-verifications/:verificationId",
  requireAuth,
  async (req, res) => {
    try {
      await assertContractReadScope(req, req.params.id);
      const verification = await getSealedContractVerification(
        req.params.id,
        req.params.verificationId,
      );
      res.json({ success: true, data: verification });
    } catch (error) {
      sendError(res, error, "读取盖章合同核验记录失败");
    }
  },
);

router.post(
  "/:id/sealed-verifications/:verificationId/retry",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const result = await retrySealedContractVerification({
        contractId: req.params.id,
        verificationId: req.params.verificationId,
        actorId: currentActor.id,
        actorRole: currentActor.role,
        expectedVersion: parseExpectedVersion(
          req.body?.expectedVersion ?? req.body?.version,
        ),
      });
      res.json({
        success: true,
        data: {
          contract: {
            ...toContractApi(result.contract as any),
            hasSealedContractFile: true,
          },
          verification: result.verification,
        },
      });
    } catch (error) {
      sendError(res, error, "重新识别盖章合同失败");
    }
  },
);

router.post(
  "/:id/sealed-verifications/:verificationId/reapprove",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const result = await submitSealedDifferenceForApproval({
        contractId: req.params.id,
        verificationId: req.params.verificationId,
        explanation: String(req.body?.explanation || ""),
        actorId: currentActor.id,
        actorRole: currentActor.role,
        expectedVersion: parseExpectedVersion(
          req.body?.expectedVersion ?? req.body?.version,
        ),
      });
      res.json({
        success: true,
        data: {
          contract: {
            ...toContractApi(result.contract as any),
            hasSealedContractFile: true,
          },
          verification: result.verification,
        },
      });
    } catch (error) {
      sendError(res, error, "发起盖章合同差异复审失败");
    }
  },
);

router.post(
  "/:id/sealed-verifications/:verificationId/archive",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const result = await archiveVerifiedSealedContract({
        contractId: req.params.id,
        verificationId: req.params.verificationId,
        actorId: currentActor.id,
        actorRole: currentActor.role,
        expectedVersion: parseExpectedVersion(
          req.body?.expectedVersion ?? req.body?.version,
        ),
      });
      res.json({
        success: true,
        data: {
          contract: {
            ...toContractApi(result.contract as any),
            hasSealedContractFile: true,
          },
          verification: result.verification,
        },
      });
    } catch (error) {
      sendError(res, error, "完成盖章合同归档失败");
    }
  },
);

router.post("/:id/termination-request", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const contract = await requestContractTermination(
      req.params.id,
      currentActor.id,
      currentActor.role,
      String(req.body.comment || ""),
    );
    res.json({ success: true, data: toContractApi(contract as any) });
  } catch (error) {
    sendError(res, error, "申请终止合同失败");
  }
});

router.post("/:id/rental-exit/confirm", requireFinance, async (req, res) => {
  try {
    const allowedFields = new Set(["expectedVersion", "comment"]);
    const forbiddenFields = Object.keys(req.body || {}).filter(
      (field) => !allowedFields.has(field),
    );
    if (forbiddenFields.length > 0) {
      throw new ContractDomainError(
        400,
        "确认退租或还车时只能提交合同版本和备注",
        "CONTRACT_RENTAL_EXIT_FIELDS_FORBIDDEN",
      );
    }
    const currentActor = actor(req);
    const contract = await confirmCompletedRentalExit({
      contractId: req.params.id,
      actorId: currentActor.id,
      actorRole: currentActor.role,
      expectedVersion: parseExpectedVersion(req.body?.expectedVersion),
      comment: normalizeNullableText(req.body?.comment),
    });
    res.json({
      success: true,
      message:
        contract.declared_subtype === "vehicle_rental"
          ? "还车已确认，合同已终止"
          : "退租已确认，合同已终止",
      data: toContractApi(contract as any),
    });
  } catch (error) {
    sendError(res, error, "确认退租或还车失败");
  }
});

router.post("/:id/files", requireFinance, uploadSingle, async (req, res) => {
  try {
    const currentActor = actor(req);
    const fileType = String(
      req.body.fileType || "other",
    ) as (typeof FILE_TYPES)[number];
    if (!(FILE_TYPES as readonly string[]).includes(fileType)) {
      throw new ContractDomainError(400, "合同文件类型不正确");
    }
    if (fileType === "seal_application") {
      throw new ContractDomainError(
        400,
        "用印申请单必须在线填写并使用本人电子签名生成",
        "SEAL_APPLICATION_ONLINE_SIGNATURE_REQUIRED",
      );
    }
    if (
      ["invoice", "receipt", "payment", "sealed_contract"].includes(fileType)
    ) {
      throw new ContractDomainError(400, "该文件类型必须通过对应业务接口上传");
    }
    const allowedKinds: readonly ("pdf" | "doc" | "docx" | "jpeg" | "png")[] =
      fileType === "draft_contract"
        ? ["pdf", "doc", "docx"]
        : ["pdf", "doc", "docx", "jpeg", "png"];
    const file = await validateUploadedFile(req.file, allowedKinds);
    const result = await db.transaction(async (client) => {
      const contract = await client.query<ContractRow>(
        `SELECT * FROM contracts WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
        [req.params.id],
      );
      const currentContract = contract.rows[0];
      if (!currentContract) throw new ContractDomainError(404, "合同不存在");
      if (["rejected", "terminated"].includes(currentContract.status)) {
        throw new ContractDomainError(409, "已结束合同不能继续上传业务文件");
      }
      if (fileType === "draft_contract") {
        assertStoredContractUploadContext(currentContract);
      }
      if (
        approvalMaterialFileTypes.has(fileType) &&
        currentContract.status !== "draft"
      ) {
        throw new ContractDomainError(
          409,
          "合同已提交审批，送审文件已冻结，不能替换或补充审批材料",
          "APPROVAL_MATERIALS_FROZEN",
        );
      }
      const id = await insertContractFile(
        client,
        req.params.id,
        fileType,
        file,
        currentActor.id,
      );
      const now = new Date().toISOString();
      let jobId: string | null = null;
      if (fileType === "draft_contract") {
        jobId = nanoid();
        await clearDraftAutomaticRecognitionValues(client, req.params.id, now);
        await client.query(
          `UPDATE contract_ocr_jobs
           SET status = 'failed',
             error_message = '草拟合同已替换，识别任务已失效',
             finished_at = $2, updated_at = $2,
             worker_token = NULL, lease_expires_at = NULL
           WHERE contract_id = $1 AND status IN ('queued', 'processing')`,
          [req.params.id, now],
        );
        await client.query(
          `INSERT INTO contract_ocr_jobs (
             id, contract_id, file_id, status, retry_count, warnings_json,
             requested_by, created_at, updated_at
           ) VALUES ($1,$2,$3,'queued',0,'[]'::jsonb,$4,$5,$5)`,
          [jobId, req.params.id, id, currentActor.id, now],
        );
      }
      await client.query(
        `INSERT INTO contract_audit_logs (
           id, contract_id, action, actor_id, actor_role, from_status,
           to_status, changes_json, created_at
         ) VALUES ($1,$2,'file_uploaded',$3,$4,$5,$5,$6::jsonb,$7)`,
        [
          nanoid(),
          req.params.id,
          currentActor.id,
          currentActor.role,
          currentContract.status,
          JSON.stringify({ fileId: id, fileType, jobId }),
          now,
        ],
      );
      return { fileId: id, jobId };
    });
    res.status(result.jobId ? 202 : 200).json({ success: true, data: result });
    if (result.jobId) scheduleRecognitionJob(result.jobId);
  } catch (error) {
    cleanupUploadedFile(req.file);
    sendError(res, error, "上传合同文件失败");
  }
});

router.delete("/:id/files/:fileId", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const removed = await db.transaction(async (client) => {
      const fileResult = await client.query<{
        id: string;
        contract_id: string;
        file_type: string;
        file_name: string;
        file_path: string;
        status: ContractRow["status"];
      }>(
        `SELECT f.id, f.contract_id, f.file_type, f.file_name, f.file_path,
           c.status
         FROM contract_files f
         JOIN contracts c ON c.id = f.contract_id
         WHERE f.id = $1 AND f.contract_id = $2
           AND c.is_deleted = FALSE
         FOR UPDATE OF f, c`,
        [req.params.fileId, req.params.id],
      );
      const file = fileResult.rows[0];
      if (!file) throw new ContractDomainError(404, "合同附件不存在");
      if (file.status !== "draft") {
        throw new ContractDomainError(
          409,
          "合同已提交审批，送审文件已冻结，不能移除",
          "APPROVAL_MATERIALS_FROZEN",
        );
      }
      if (
        ![
          "seal_application",
          "triplicate",
          "payment_request",
          "other",
        ].includes(file.file_type)
      ) {
        throw new ContractDomainError(400, "该类型附件不能从新增合同向导移除");
      }
      await client.query(`DELETE FROM contract_files WHERE id = $1`, [file.id]);
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO contract_audit_logs (
           id, contract_id, action, actor_id, actor_role, from_status,
           to_status, changes_json, created_at
         ) VALUES ($1,$2,'file_removed',$3,$4,$5,$5,$6::jsonb,$7)`,
        [
          nanoid(),
          file.contract_id,
          currentActor.id,
          currentActor.role,
          file.status,
          JSON.stringify({
            fileId: file.id,
            fileType: file.file_type,
            fileName: file.file_name,
          }),
          now,
        ],
      );
      return file;
    });
    if (validateFilePath(removed.file_path)) {
      const absolutePath = path.resolve(process.cwd(), removed.file_path);
      await fs.promises
        .unlink(absolutePath)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            console.error("移除合同草稿附件的物理文件失败:", {
              fileId: removed.id,
              error,
            });
          }
        });
    }
    res.json({ success: true, data: { fileId: removed.id, removed: true } });
  } catch (error) {
    sendError(res, error, "移除合同草稿附件失败");
  }
});

function financialRecordLabel(kind: FinancialRecordKind): string {
  return {
    invoice: "发票",
    receipt: "银行回单",
    payment: "付款凭证",
    external_payment: "最终对外付款",
  }[kind];
}

interface FinancialOcrJobView {
  id: string;
  contractId: string;
  fileId: string;
  recordKind: FinancialRecordKind;
  status: "processing" | "verified" | "blocked" | "failed" | "consumed";
  validationStatus: "verified" | "blocked" | "failed" | null;
  failureKind: "infrastructure" | "document" | "recognition" | null;
  retryCount: number;
  recognitionMethod: string | null;
  evidenceTextHash: string | null;
  direction: string | null;
  expectedDirection: string;
  documentStatus: string | null;
  canCreateDraft: boolean;
  diagnosticScore: number | null;
  snapshot: SafeContractFinancialSnapshot;
  blockingReasons: Array<{ code: string; message: string; field?: string }>;
  warnings: string[];
  engineVersion?: string | null;
  parserVersion?: string | null;
  requiresRefresh?: boolean;
}

interface ExistingFinancialHashJob {
  contract_id: string;
  job_id: string | null;
  record_kind: FinancialRecordKind | null;
  job_status: FinancialOcrJobView["status"] | null;
  validation_status: FinancialOcrJobView["validationStatus"];
  failure_kind: FinancialOcrJobView["failureKind"];
  retry_count: number;
  lease_expires_at: string | null;
  engine_version: string | null;
  parser_version: string | null;
  recognition_method: string | null;
  evidence_text_hash: string | null;
  direction: string | null;
  document_status: string | null;
  can_auto_post: boolean | null;
  snapshot_json: SafeContractFinancialSnapshot | null;
  blocking_reasons_json: FinancialOcrJobView["blockingReasons"] | null;
  warnings_json: string[] | null;
  record_id: string | null;
  business_purpose: ContractFinancialOcrBusinessPurpose | null;
  target_id: string | null;
  file_id: string;
  file_path: string;
}

type ContractDepositReturnReceiptPurpose =
  | "deposit_refund"
  | "engineering_return";

type ContractFinancialOcrBusinessPurpose =
  | ContractDepositReturnReceiptPurpose
  | "engineering_internal_funding";

interface DepositReturnFinancialOcrContext {
  businessPurpose: ContractDepositReturnReceiptPurpose;
  targetId: string;
  expectedPayer: string;
  expectedPayee: string;
  expectedPayerAccount?: string | null;
  expectedPayeeAccount?: string | null;
  minimumTransactionDate: string;
  maximumAmount: number;
  expectedDirection: "receipt" | "payment";
  requiredAmount?: number;
  requiredTransactionDate?: string;
}

interface CompletedInternalFundingOcrContext extends Omit<
  DepositReturnFinancialOcrContext,
  "businessPurpose"
> {
  businessPurpose: "engineering_internal_funding";
}

type SpecializedFinancialOcrContext =
  | DepositReturnFinancialOcrContext
  | CompletedInternalFundingOcrContext;

async function lockDepositReturnOcrContract(
  client: PoolClient,
  contractId: string,
): Promise<ContractRow & { category: ContractCategory }> {
  const result = await client.query<ContractRow>(
    `SELECT * FROM contracts
     WHERE id=$1 AND is_deleted=FALSE FOR UPDATE`,
    [contractId],
  );
  const contract = result.rows[0];
  if (!contract) throw new ContractDomainError(404, "合同不存在");
  if (
    !isContractDepositEligible({
      category: contract.category,
      declaredSubtype: contract.declared_subtype,
      relationType: contract.relation_type,
    })
  ) {
    throw new ContractDomainError(
      409,
      "只有租赁类资产主合同可以识别押金结算回单",
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_CONTRACT_INELIGIBLE",
    );
  }
  return contract as ContractRow & { category: ContractCategory };
}

interface CompletedInternalFundingReceiptView {
  id: string;
  amount: number;
  paymentDate: string;
  payer: string;
  payerAccount: string;
  payee: string;
  payeeAccount: string;
  electronicReceiptNo: string;
  fileId: string | null;
  fileName: string | null;
  fileUrl: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

interface CompletedInternalFundingRecognitionView {
  jobId: string;
  fileId: string;
  fileName: string;
  fileUrl: string;
  status: FinancialOcrJobView["status"];
  validationStatus: FinancialOcrJobView["validationStatus"];
  canConfirm: boolean;
  fields: SafeContractFinancialSnapshot["fields"];
  blockingReasons: FinancialOcrJobView["blockingReasons"];
  warnings: string[];
  recognitionMethod: string | null;
  evidenceTextHash: string | null;
  engineVersion: string | null;
  parserVersion: string | null;
}

interface CompletedInternalFundingSummary {
  canAppendAfterCompletion: boolean;
  contractCompanySubjectName: string;
  requiredAmount: number;
  confirmedAmount: number;
  pendingAmount: number;
  remainingAmount: number;
  availableRecognitionAmount: number;
  status: "pending_review" | "pending" | "partial" | "completed";
  receipts: CompletedInternalFundingReceiptView[];
  pendingRecognitions: CompletedInternalFundingRecognitionView[];
}

async function loadCompletedInternalFundingSummary(
  client: PoolClient,
  contractId: string,
  forUpdate: boolean,
): Promise<{
  contract: ContractRow & { category: ContractCategory };
  summary: CompletedInternalFundingSummary;
  context: CompletedInternalFundingOcrContext;
}> {
  const contractResult = await client.query<ContractRow>(
    `SELECT * FROM contracts
     WHERE id=$1 AND is_deleted=FALSE
       ${forUpdate ? "FOR UPDATE" : ""}`,
    [contractId],
  );
  const contract = contractResult.rows[0];
  if (!contract) throw new ContractDomainError(404, "合同不存在");
  if (
    contract.relation_type !== "main" ||
    contract.category !== "asset" ||
    contract.status !== "completed" ||
    contract.asset_funding_mode !== "engineering_to_technology" ||
    contract.financial_direction !== "cost" ||
    (contract.root_contract_id && contract.root_contract_id !== contract.id)
  ) {
    throw new ContractDomainError(
      409,
      "只有已完成的工程划拨科技资产主合同可以补录历史内部划拨",
      "COMPLETED_INTERNAL_FUNDING_CONTRACT_INELIGIBLE",
    );
  }
  const pendingTermination = await client.query<{ id: string }>(
    `SELECT id FROM contracts
     WHERE root_contract_id=$1 AND relation_type='termination'
       AND is_deleted=FALSE AND status IN ('approving','pending_seal')
     ORDER BY created_at,id LIMIT 1`,
    [contract.id],
  );
  if (pendingTermination.rows[0]) {
    throw new ContractDomainError(
      409,
      "解除协议办理期间不能补录历史内部划拨",
      "FINANCIAL_RECORD_TERMINATION_PENDING",
    );
  }
  const contractCompanySubject = resolveContractCompanySubject(contract);
  const responsibilityRows = await client.query<{
    amount: string | number;
    purpose_funding_source: ContractDepositFundingSource | null;
    purpose_technology_amount: string | number | null;
    deposit_funding_source: ContractDepositFundingSource | null;
    deposit_technology_amount: string | number | null;
    confirmed_deposit_amount: string | number;
  }>(
    `SELECT payment.amount,
       (SELECT detail.funding_source
        FROM contract_payment_purpose_details detail
        WHERE detail.external_payment_record_id=payment.id
          AND detail.purpose='lease_deposit' LIMIT 1)
          AS purpose_funding_source,
       (SELECT detail.technology_self_funded_amount
        FROM contract_payment_purpose_details detail
        WHERE detail.external_payment_record_id=payment.id
          AND detail.purpose='lease_deposit' LIMIT 1)
          AS purpose_technology_amount,
       (SELECT deposit.funding_source FROM contract_deposits deposit
        WHERE deposit.external_payment_record_id=payment.id LIMIT 1)
          AS deposit_funding_source,
       (SELECT deposit.technology_self_funded_amount
        FROM contract_deposits deposit
        WHERE deposit.external_payment_record_id=payment.id LIMIT 1)
          AS deposit_technology_amount,
       COALESCE((SELECT SUM(receipt.confirmed_amount)
        FROM contract_payment_deposit_receipts receipt
        WHERE receipt.external_payment_record_id=payment.id
          AND receipt.status='confirmed'),0) AS confirmed_deposit_amount
     FROM contract_external_payments payment
     WHERE payment.contract_id=$1 AND payment.status='confirmed'
     ORDER BY payment.payment_date,payment.created_at,payment.id`,
    [contract.id],
  );
  const responsibility = calculateCompletedInternalFundingResponsibility(
    responsibilityRows.rows.map((payment) => {
      const depositFundingSource =
        payment.purpose_funding_source || payment.deposit_funding_source;
      const technologyAmount = payment.purpose_funding_source
        ? payment.purpose_technology_amount
        : payment.deposit_technology_amount;
      return {
        paymentAmountCents: toCents(String(payment.amount)),
        depositFundingSource,
        technologySelfFundedAmountCents: toCents(String(technologyAmount || 0)),
        confirmedDepositAmountCents: toCents(
          String(payment.confirmed_deposit_amount || 0),
        ),
      };
    }),
  );
  const paymentRows = await client.query<{
    id: string;
    amount: string | number;
    payment_date: string;
    payer: string | null;
    payer_account: string | null;
    payee: string | null;
    payee_account: string | null;
    electronic_receipt_no: string | null;
    file_id: string | null;
    file_name: string | null;
    created_at: string;
    confirmed_at: string | null;
  }>(
    `SELECT payment.id,payment.amount,payment.payment_date,payment.payer,
       payment.payer_account,payment.payee,payment.payee_account,
       payment.electronic_receipt_no,payment.file_id,file.file_name,
       payment.created_at,payment.confirmed_at
     FROM contract_payments payment
     LEFT JOIN contract_files file ON file.id=payment.file_id
     WHERE payment.contract_id=$1 AND payment.status='confirmed'
     ORDER BY payment.payment_date,payment.created_at,payment.id
     ${forUpdate ? "FOR UPDATE OF payment" : ""}`,
    [contract.id],
  );
  const internalRows = paymentRows.rows.filter(
    (payment) =>
      normalizeFinancialIdentity(payment.payer || "") ===
        normalizeFinancialIdentity("北京羽隶工程咨询有限公司") &&
      normalizeFinancialIdentity(payment.payee || "") ===
        normalizeFinancialIdentity(contractCompanySubject.name),
  );
  const pendingRows = await client.query<{
    id: string;
    file_id: string;
    file_name: string;
    status: FinancialOcrJobView["status"];
    validation_status: FinancialOcrJobView["validationStatus"];
    can_auto_post: boolean;
    document_status: string | null;
    snapshot_json: SafeContractFinancialSnapshot;
    blocking_reasons_json: FinancialOcrJobView["blockingReasons"] | null;
    warnings_json: string[] | null;
    recognition_method: string | null;
    evidence_text_hash: string | null;
    engine_version: string | null;
    parser_version: string | null;
  }>(
    `SELECT job.id,job.file_id,file.file_name,job.status,
       job.validation_status,job.can_auto_post,job.document_status,
       job.snapshot_json,job.blocking_reasons_json,
       job.warnings_json,job.recognition_method,job.evidence_text_hash,
       job.engine_version,job.parser_version
     FROM contract_financial_ocr_jobs job
     JOIN contract_files file ON file.id=job.file_id
     WHERE job.contract_id=$1
       AND job.business_purpose='engineering_internal_funding'
       AND job.target_id=$1 AND job.record_id IS NULL
       AND job.status IN ('processing','verified','blocked','failed')
     ORDER BY job.created_at,job.id`,
    [contract.id],
  );
  const requiredAmount = centsToAmount(responsibility.requiredAmountCents);
  const confirmedAmount = internalRows.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0,
  );
  const remainingAmount = Math.max(0, requiredAmount - confirmedAmount);
  const pendingRecognitions = pendingRows.rows.map((job) => {
    const fields = job.snapshot_json?.fields as unknown as Record<
      string,
      unknown
    >;
    const amount = Number(fields?.amount || 0);
    const canConfirm =
      !responsibility.fundingSourcePendingReview &&
      job.status === "verified" &&
      job.validation_status === "verified" &&
      job.can_auto_post === true &&
      job.document_status === "normal" &&
      Number.isFinite(amount) &&
      amount > 0 &&
      amount <= remainingAmount;
    return {
      jobId: job.id,
      fileId: job.file_id,
      fileName: job.file_name,
      fileUrl: `/api/contracts/files/${job.file_id}`,
      status: job.status,
      validationStatus: job.validation_status,
      canConfirm,
      fields: job.snapshot_json?.fields,
      blockingReasons: job.blocking_reasons_json || [],
      warnings: job.warnings_json || [],
      recognitionMethod: job.recognition_method,
      evidenceTextHash: job.evidence_text_hash,
      engineVersion: job.engine_version,
      parserVersion: job.parser_version,
      amount: canConfirm ? amount : 0,
    };
  });
  const pendingAmount = pendingRecognitions.reduce(
    (sum, job) => sum + job.amount,
    0,
  );
  const hasProcessingRecognition = pendingRows.rows.some(
    (job) => job.status === "processing",
  );
  const availableRecognitionAmount = hasProcessingRecognition
    ? 0
    : Math.max(0, remainingAmount - pendingAmount);
  const status: CompletedInternalFundingSummary["status"] =
    responsibility.fundingSourcePendingReview
      ? "pending_review"
      : remainingAmount <= 0
        ? "completed"
        : confirmedAmount > 0
          ? "partial"
          : "pending";
  const summary: CompletedInternalFundingSummary = {
    canAppendAfterCompletion:
      !responsibility.fundingSourcePendingReview && remainingAmount > 0,
    contractCompanySubjectName: contractCompanySubject.name,
    requiredAmount,
    confirmedAmount,
    pendingAmount,
    remainingAmount,
    availableRecognitionAmount: responsibility.fundingSourcePendingReview
      ? 0
      : availableRecognitionAmount,
    status,
    receipts: internalRows.map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount),
      paymentDate: payment.payment_date,
      payer: payment.payer || "",
      payerAccount: payment.payer_account || "",
      payee: payment.payee || "",
      payeeAccount: payment.payee_account || "",
      electronicReceiptNo: payment.electronic_receipt_no || "",
      fileId: payment.file_id,
      fileName: payment.file_name,
      fileUrl: payment.file_id
        ? `/api/contracts/files/${payment.file_id}`
        : null,
      createdAt: payment.created_at,
      confirmedAt: payment.confirmed_at,
    })),
    pendingRecognitions: pendingRecognitions.map(
      ({ amount: _amount, ...job }) => job,
    ),
  };
  return {
    contract: contract as ContractRow & { category: ContractCategory },
    summary,
    context: {
      businessPurpose: "engineering_internal_funding",
      targetId: contract.id,
      expectedPayer: "北京羽隶工程咨询有限公司",
      expectedPayee: contractCompanySubject.name,
      minimumTransactionDate: "2000-01-01",
      maximumAmount: remainingAmount,
      expectedDirection: "payment",
    },
  };
}

async function lockCompletedInternalFundingContract(
  client: PoolClient,
  contractId: string,
): Promise<ContractRow & { category: ContractCategory }> {
  const result = await loadCompletedInternalFundingSummary(
    client,
    contractId,
    true,
  );
  if (result.summary.status === "pending_review") {
    throw new ContractDomainError(
      409,
      "押金资金来源尚未确认，不能计算工程应承担的历史内部划拨",
      "COMPLETED_INTERNAL_FUNDING_SOURCE_PENDING_REVIEW",
    );
  }
  if (!result.summary.canAppendAfterCompletion) {
    throw new ContractDomainError(
      409,
      "该已完成合同没有待补内部划拨金额",
      "COMPLETED_INTERNAL_FUNDING_ALREADY_CLOSED",
    );
  }
  if (result.summary.availableRecognitionAmount <= 0) {
    throw new ContractDomainError(
      409,
      "现有识别任务已占用内部划拨缺口，请先等待、确认或删除现有任务",
      "COMPLETED_INTERNAL_FUNDING_PENDING_COVERS_REMAINING",
    );
  }
  return result.contract;
}

function addDepositReturnOcrBusinessGuards(
  result: ContractFinancialOcrResult,
  context: SpecializedFinancialOcrContext,
): ContractFinancialOcrResult {
  if (result.kind !== "bank_receipt") return result;
  const reasons = [...result.blockingReasons];
  const addReason = (code: string, message: string, field?: string) => {
    if (!reasons.some((reason) => reason.code === code)) {
      reasons.push({ code, message, ...(field ? { field } : {}) });
    }
  };
  if (result.direction !== context.expectedDirection) {
    addReason(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_DIRECTION_MISMATCH",
      context.businessPurpose === "deposit_refund"
        ? "押金退款回单必须识别为资金收回方向"
        : context.businessPurpose === "engineering_return"
          ? `退工程回单必须识别为${context.expectedPayer}向${context.expectedPayee}付款方向`
          : `历史内部划拨回单必须识别为${context.expectedPayer}向${context.expectedPayee}付款方向`,
      "direction",
    );
  }
  if (Number(result.fields.amount || 0) > Number(context.maximumAmount || 0)) {
    addReason(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_AMOUNT_EXCEEDS_REMAINING",
      context.businessPurpose === "deposit_refund"
        ? "回单退款金额不能超过押金待结算金额"
        : context.businessPurpose === "engineering_return"
          ? "回单退工程金额不能超过该笔待退工程金额"
          : "内部划拨回单金额不能超过已完成合同的待划拨缺口",
      "amount",
    );
  }
  if (
    context.requiredAmount !== undefined &&
    toCents(String(result.fields.amount || 0)) !==
      toCents(String(context.requiredAmount))
  ) {
    addReason(
      "CONTRACT_DEPOSIT_REFUND_RECEIPT_HISTORY_AMOUNT_MISMATCH",
      "回单识别金额必须与历史押金退款金额完全一致",
      "amount",
    );
  }
  if (
    context.requiredTransactionDate &&
    result.fields.paymentTime !== context.requiredTransactionDate
  ) {
    addReason(
      "CONTRACT_DEPOSIT_REFUND_RECEIPT_HISTORY_DATE_MISMATCH",
      "回单识别日期必须与历史押金退款日期完全一致",
      "paymentTime",
    );
  }
  if (
    normalizeFinancialIdentity(result.fields.payer) !==
      normalizeFinancialIdentity(context.expectedPayer) ||
    normalizeFinancialIdentity(result.fields.payee) !==
      normalizeFinancialIdentity(context.expectedPayee)
  ) {
    addReason(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_PARTY_MISMATCH",
      context.businessPurpose === "deposit_refund"
        ? "押金退款回单必须由原付款收款方退回至原付款付款方"
        : context.businessPurpose === "engineering_return"
          ? `退工程回单必须由${context.expectedPayer}付款、${context.expectedPayee}收款`
          : `内部划拨回单必须由${context.expectedPayer}付款、${context.expectedPayee}收款`,
      "direction",
    );
  }
  if (
    context.expectedPayerAccount &&
    normalizeFinancialBankIdentifier(result.fields.payerAccount) !==
      normalizeFinancialBankIdentifier(context.expectedPayerAccount)
  ) {
    addReason(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_PAYER_ACCOUNT_MISMATCH",
      "回单付款账号与要求的资金退回账号不一致",
      "payerAccount",
    );
  }
  if (
    context.expectedPayeeAccount &&
    normalizeFinancialBankIdentifier(result.fields.payeeAccount) !==
      normalizeFinancialBankIdentifier(context.expectedPayeeAccount)
  ) {
    addReason(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_PAYEE_ACCOUNT_MISMATCH",
      "回单收款账号与要求的资金接收账号不一致",
      "payeeAccount",
    );
  }
  if (
    result.fields.paymentTime &&
    result.fields.paymentTime < context.minimumTransactionDate
  ) {
    addReason(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_DATE_BEFORE_SOURCE",
      "资金退回日期不能早于原付款或押金退款日期",
      "paymentTime",
    );
  }
  if (reasons.length === result.blockingReasons.length) return result;
  return {
    ...result,
    validationStatus: "blocked",
    canAutoPost: false,
    blockingReasons: reasons,
  };
}

function assertFinancialKindAllowed(
  contract: ContractRow,
  kind: FinancialRecordKind,
): asserts contract is ContractRow & { category: ContractCategory } {
  if (!contract.category) {
    throw new ContractDomainError(
      409,
      "合同分类尚未完成识别，不能上传财务凭证",
      "FINANCIAL_CONTRACT_CATEGORY_REQUIRED",
    );
  }
  if (kind === "invoice") return;
  if (kind === "payment" && contract.category !== "asset") {
    throw new ContractDomainError(
      409,
      "主营和非主营合同属于收入，只能登记回款回单",
      "FINANCIAL_DIRECTION_CONFLICT",
    );
  }
  if (kind === "receipt" && contract.category === "asset") {
    throw new ContractDomainError(
      409,
      "资产类合同属于支出，只能登记付款凭证",
      "FINANCIAL_DIRECTION_CONFLICT",
    );
  }
}

async function lockFinancialContract(
  client: PoolClient,
  contractId: string,
  kind: FinancialRecordKind,
  allowCompletedOpenIncomeRegistration = false,
): Promise<ContractRow & { category: ContractCategory }> {
  const locked = await client.query<ContractRow>(
    `SELECT * FROM contracts
     WHERE id = $1 AND is_deleted = FALSE
     FOR UPDATE`,
    [contractId],
  );
  const target = locked.rows[0];
  if (!target) throw new ContractDomainError(404, "合同不存在");
  const rootId = target.root_contract_id || target.id;
  let rootStatus = target.status;
  let rootFinancialDirection = target.financial_direction;
  let rootPartyA = target.party_a;
  let rootPartyB = target.party_b;
  let rootFundingMode = target.asset_funding_mode;
  if (rootId !== target.id) {
    const root = await client.query<{
      status: ContractRow["status"];
      financial_direction: ContractRow["financial_direction"];
      party_a: string | null;
      party_b: string | null;
      asset_funding_mode: ContractRow["asset_funding_mode"];
    }>(
      `SELECT status, financial_direction, party_a, party_b,
         asset_funding_mode FROM contracts
       WHERE id = $1 AND is_deleted = FALSE
       FOR UPDATE`,
      [rootId],
    );
    if (!root.rows[0]) throw new ContractDomainError(404, "根合同不存在");
    rootStatus = root.rows[0].status;
    rootFinancialDirection = root.rows[0].financial_direction;
    rootPartyA = root.rows[0].party_a;
    rootPartyB = root.rows[0].party_b;
    rootFundingMode = root.rows[0].asset_funding_mode;
  }
  const allowsCompletedIncomeContinuation =
    allowCompletedOpenIncomeRegistration &&
    kind !== "payment" &&
    target.category === "main_business" &&
    rootFinancialDirection === "income" &&
    target.status === "completed" &&
    rootStatus === "completed";
  if (
    (!["effective", "executing"].includes(target.status) ||
      !["effective", "executing"].includes(rootStatus)) &&
    !allowsCompletedIncomeContinuation
  ) {
    throw new ContractDomainError(
      409,
      "仅生效中或执行中的合同可以新增财务记录",
      "FINANCIAL_RECORD_CONTRACT_STATUS_FORBIDDEN",
    );
  }
  const pendingTermination = await client.query<{ id: string }>(
    `SELECT termination.id FROM contracts termination
     WHERE termination.root_contract_id = $1
       AND termination.relation_type = 'termination'
       AND termination.is_deleted = FALSE
       AND termination.status IN ('approving', 'pending_seal')
     ORDER BY termination.created_at, termination.id LIMIT 1`,
    [rootId],
  );
  if (pendingTermination.rows[0]) {
    throw new ContractDomainError(
      409,
      "解除协议已进入审批或盖章流程，期间不能新增财务记录",
      "FINANCIAL_RECORD_TERMINATION_PENDING",
    );
  }
  const scopedTarget = {
    ...target,
    financial_direction: rootFinancialDirection,
    party_a: rootPartyA,
    party_b: rootPartyB,
    asset_funding_mode: rootFundingMode,
  };
  if (
    kind === "payment" &&
    scopedTarget.category === "asset" &&
    (!scopedTarget.asset_funding_mode ||
      scopedTarget.asset_funding_mode === "pending_review")
  ) {
    throw new ContractDomainError(
      409,
      "请先在合同详情确认资产合同资金承担方式",
      "ASSET_FUNDING_MODE_REQUIRED",
    );
  }
  assertFinancialKindAllowed(scopedTarget, kind);
  resolveContractCompanySubject(scopedTarget);
  return scopedTarget;
}

function resolveContractCompanySubject(contract: ContractRow): {
  name: string;
  taxId: string;
} {
  const matched = resolveContractFinancialCompanySubject(
    [contract.party_a, contract.party_b],
    CONTRACT_COMPANY_SUBJECTS,
  );
  if (!matched) {
    throw new ContractDomainError(
      409,
      "合同双方未能唯一确认已配置公司主体，不能登记财务凭证",
      "FINANCIAL_CONTRACT_SUBJECT_NOT_UNIQUE",
    );
  }
  return matched;
}

function financialJobResponse(input: FinancialOcrJobView): FinancialOcrJobView {
  return input;
}

function financialOcrLeaseExpiresAt(now = Date.now()): string {
  return new Date(now + CONTRACT_FINANCIAL_OCR_LEASE_MS).toISOString();
}

async function markFinancialOcrJobFailed(input: {
  contractId: string;
  contractStatus: ContractRow["status"];
  fileId: string;
  fileHash: string;
  format: SafeContractFinancialSnapshot["format"];
  jobId: string;
  workerToken: string;
  kind: FinancialRecordKind;
  actor: { id: string; role: string };
}): Promise<void> {
  const finishedAt = new Date().toISOString();
  const failureReason = {
    code: "FINANCIAL_OCR_INFRASTRUCTURE_FAILED",
    message: "财务凭证识别执行失败，请稍后重试",
  };
  await db.transaction(async (client) => {
    const current = await client.query<{
      status: string;
      worker_token: string | null;
      retry_count: number;
    }>(
      `SELECT status, worker_token, retry_count FROM contract_financial_ocr_jobs
       WHERE id = $1 AND contract_id = $2
       FOR UPDATE`,
      [input.jobId, input.contractId],
    );
    if (!current.rows[0]) {
      throw new ContractDomainError(
        404,
        "财务凭证识别任务不存在",
        "FINANCIAL_OCR_JOB_NOT_FOUND",
      );
    }
    if (
      current.rows[0].status !== "processing" ||
      current.rows[0].worker_token !== input.workerToken
    ) {
      return;
    }

    await client.query(
      `UPDATE contract_financial_ocr_jobs
       SET status = 'failed', validation_status = 'failed',
         recognition_method = NULL, engine_version = $3, parser_version = $4,
         evidence_text_hash = NULL, direction = NULL, document_status = NULL,
         can_auto_post = FALSE, snapshot_json = $5::jsonb,
         blocking_reasons_json = $6::jsonb, warnings_json = '[]'::jsonb,
         failure_kind = 'infrastructure', finished_at = $7, updated_at = $7,
         worker_token = NULL, lease_expires_at = NULL
       WHERE id = $1 AND contract_id = $2 AND worker_token = $8`,
      [
        input.jobId,
        input.contractId,
        contractFinancialOcrEngineVersion(input.kind),
        contractFinancialOcrParserVersion(input.kind),
        JSON.stringify({ format: input.format, fields: {} }),
        JSON.stringify([failureReason]),
        finishedAt,
        input.workerToken,
      ],
    );
    await client.query(
      `INSERT INTO contract_audit_logs (
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) VALUES ($1,$2,'financial_ocr_finished',$3,$4,$5,$5,$6::jsonb,$7)`,
      [
        nanoid(),
        input.contractId,
        input.actor.id,
        input.actor.role,
        input.contractStatus,
        JSON.stringify({
          jobId: input.jobId,
          fileId: input.fileId,
          fileHash: input.fileHash,
          kind: input.kind,
          status: "failed",
          validationStatus: "failed",
          failureKind: "infrastructure",
          retryCount: current.rows[0].retry_count || 0,
          engineVersion: contractFinancialOcrEngineVersion(input.kind),
          parserVersion: contractFinancialOcrParserVersion(input.kind),
          canCreateDraft: false,
          blockingReasonCodes: [failureReason.code],
        }),
        finishedAt,
      ],
    );
  });
}

async function recognizeAndStoreFinancialFile(
  contractId: string,
  kind: FinancialRecordKind,
  uploadedFile: Express.Multer.File | undefined,
  currentActor: { id: string; role: string },
  onStored?: () => void,
  allowCompletedOpenIncomeRegistration = false,
  preserveStoredFileOnReuse = false,
  depositReturnContext?: SpecializedFinancialOcrContext,
): Promise<FinancialOcrJobView> {
  const file = await validateUploadedFile(uploadedFile, ["pdf", "jpeg", "png"]);
  const fileId = nanoid();
  const jobId = nanoid();
  const workerToken = nanoid();
  const startedAt = new Date().toISOString();
  const leaseExpiresAt = financialOcrLeaseExpiresAt();
  const registration = await db.transaction(async (client) => {
    const target = depositReturnContext
      ? depositReturnContext.businessPurpose === "engineering_internal_funding"
        ? await lockCompletedInternalFundingContract(client, contractId)
        : await lockDepositReturnOcrContract(client, contractId)
      : await lockFinancialContract(
          client,
          contractId,
          kind,
          allowCompletedOpenIncomeRegistration,
        );
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended('contract-financial-file:' || $1, 0)
       )`,
      [file.fileHash],
    );
    const existingHash = await client.query<ExistingFinancialHashJob>(
      `SELECT registry.contract_id, registry.file_id,
         financial_ocr.id AS job_id,
         financial_ocr.record_kind,
         financial_ocr.status AS job_status,
         financial_ocr.validation_status,
         financial_ocr.failure_kind,
         financial_ocr.retry_count,
         financial_ocr.lease_expires_at,
         financial_ocr.engine_version,
         financial_ocr.parser_version,
         financial_ocr.recognition_method,
         financial_ocr.evidence_text_hash,
         financial_ocr.direction,
         financial_ocr.document_status,
         financial_ocr.can_auto_post,
         financial_ocr.snapshot_json,
         financial_ocr.blocking_reasons_json,
         financial_ocr.warnings_json,
         financial_ocr.record_id,
         financial_ocr.business_purpose,
         financial_ocr.target_id,
         stored_file.file_path
       FROM contract_financial_file_hashes AS registry
       JOIN contract_files AS stored_file ON stored_file.id = registry.file_id
       LEFT JOIN contract_financial_ocr_jobs AS financial_ocr
         ON financial_ocr.file_id = registry.file_id
       WHERE registry.file_hash = $1
       LIMIT 1`,
      [file.fileHash],
    );
    const existing = existingHash.rows[0];
    if (
      existing?.contract_id === contractId &&
      existing.job_id &&
      existing.record_kind === kind &&
      (depositReturnContext
        ? existing.business_purpose === depositReturnContext.businessPurpose &&
          existing.target_id === depositReturnContext.targetId
        : existing.business_purpose === null && existing.target_id === null) &&
      existing.record_id === null &&
      existing.job_status
    ) {
      const reuseDecision = decideStoredContractFinancialOcrReuse({
        status: existing.job_status,
        failureKind: existing.failure_kind,
        leaseExpiresAt: existing.lease_expires_at,
        currentEngineVersion: existing.engine_version,
        currentParserVersion: existing.parser_version,
        expectedEngineVersion: contractFinancialOcrEngineVersion(kind),
        expectedParserVersion: contractFinancialOcrParserVersion(kind),
        // 发票解析器升级也允许显式重新上传触发重算；已消费任务在复用决策中
        // 永远保持终态，不会改写历史记录。
        allowStrategyUpgrade: true,
      });
      if (
        reuseDecision === "retry_infrastructure" ||
        reuseDecision === "retry_expired_processing" ||
        reuseDecision === "retry_strategy_upgrade"
      ) {
        const retryStartedAt = new Date().toISOString();
        const retryLeaseExpiresAt = financialOcrLeaseExpiresAt();
        const retryWorkerToken = nanoid();
        const retryCount = (existing.retry_count || 0) + 1;
        await client.query(
          `UPDATE contract_financial_ocr_jobs
           SET status = 'processing', validation_status = NULL,
             failure_kind = NULL, retry_count = $3, worker_token = $4,
             lease_expires_at = $5, recognition_method = NULL,
             evidence_text_hash = NULL, direction = NULL,
             document_status = NULL, can_auto_post = FALSE,
             snapshot_json = '{}'::jsonb,
             blocking_reasons_json = '[]'::jsonb,
             warnings_json = '[]'::jsonb, requested_by = $6,
             started_at = $7, finished_at = NULL, updated_at = $7
           WHERE id = $1 AND contract_id = $2`,
          [
            existing.job_id,
            contractId,
            retryCount,
            retryWorkerToken,
            retryLeaseExpiresAt,
            currentActor.id,
            retryStartedAt,
          ],
        );
        await client.query(
          `INSERT INTO contract_audit_logs (
             id, contract_id, action, actor_id, actor_role, from_status,
             to_status, changes_json, created_at
           ) VALUES ($1,$2,'financial_ocr_started',$3,$4,$5,$5,$6::jsonb,$7)`,
          [
            nanoid(),
            contractId,
            currentActor.id,
            currentActor.role,
            target.status,
            JSON.stringify({
              jobId: existing.job_id,
              fileId: existing.file_id,
              fileHash: file.fileHash,
              kind,
              retryCount,
              retryReason:
                reuseDecision === "retry_infrastructure"
                  ? "infrastructure_failure"
                  : reuseDecision === "retry_expired_processing"
                    ? "lease_expired"
                    : "recognition_strategy_upgrade",
              ...(reuseDecision === "retry_strategy_upgrade"
                ? {
                    previousStatus: existing.job_status,
                    previousRecognitionMethod: existing.recognition_method,
                    previousEngineVersion: existing.engine_version,
                    previousParserVersion: existing.parser_version,
                    previousEvidenceTextHash: existing.evidence_text_hash,
                    previousBlockingReasonCodes: (
                      existing.blocking_reasons_json || []
                    ).map((reason) => reason.code),
                  }
                : {}),
            }),
            retryStartedAt,
          ],
        );
        return {
          contract: target,
          existing: null,
          execution: {
            fileId: existing.file_id,
            filePath: existing.file_path,
            jobId: existing.job_id,
            workerToken: retryWorkerToken,
            retryCount,
            reusedStoredFile: true,
          },
        };
      }
      if (reuseDecision === "in_progress") {
        throw new ContractDomainError(
          409,
          "该财务凭证正在识别中，请勿重复提交",
          "FINANCIAL_OCR_IN_PROGRESS",
        );
      }
      if (existing.snapshot_json) {
        return { contract: target, existing, execution: null };
      }
    }
    if (existing) {
      if (depositReturnContext && existing.contract_id === contractId) {
        const postedFinancialRecord = await client.query<{
          id: string;
          record_kind: "invoice" | "receipt" | "payment" | "external_payment";
        }>(
          `SELECT invoice.id,'invoice'::text AS record_kind
           FROM contract_invoices invoice
           JOIN contracts source ON source.id=invoice.contract_id
           WHERE invoice.file_id=$1 AND invoice.status='confirmed'
             AND COALESCE(source.root_contract_id,source.id)=$2
           UNION ALL
           SELECT receipt.id,'receipt'::text AS record_kind
           FROM contract_receipts receipt
           JOIN contracts source ON source.id=receipt.contract_id
           WHERE receipt.file_id=$1 AND receipt.status='confirmed'
             AND COALESCE(source.root_contract_id,source.id)=$2
           UNION ALL
           SELECT payment.id,'payment'::text AS record_kind
           FROM contract_payments payment
           JOIN contracts source ON source.id=payment.contract_id
           WHERE payment.file_id=$1 AND payment.status='confirmed'
             AND COALESCE(source.root_contract_id,source.id)=$2
           UNION ALL
           SELECT payment.id,'external_payment'::text AS record_kind
           FROM contract_external_payments payment
           JOIN contracts source ON source.id=payment.contract_id
           WHERE payment.file_id=$1 AND payment.status='confirmed'
             AND COALESCE(source.root_contract_id,source.id)=$2
           LIMIT 1`,
          [existing.file_id, contractId],
        );
        const posted = postedFinancialRecord.rows[0];
        if (posted) {
          const recordLabel = {
            invoice: "发票",
            receipt: "回款回单",
            payment: "付款回单",
            external_payment: "对外付款回单",
          }[posted.record_kind];
          const purposeLabel =
            depositReturnContext.businessPurpose === "deposit_refund"
              ? "押金退款"
              : depositReturnContext.businessPurpose === "engineering_return"
                ? "退工程"
                : "历史内部划拨";
          throw new ContractDomainError(
            409,
            `该文件已作为本合同${recordLabel}入账，不能重复用于${purposeLabel}；请上传“${depositReturnContext.expectedPayer}→${depositReturnContext.expectedPayee}”方向的真实银行回单`,
            "CONTRACT_DEPOSIT_RETURN_FILE_ALREADY_POSTED",
          );
        }
      }
      throw new ContractDomainError(
        409,
        "该财务凭证原件已在其他合同或记录中上传，禁止重复使用",
        "FINANCIAL_FILE_HASH_DUPLICATE",
      );
    }
    await insertContractFile(
      client,
      contractId,
      kind,
      file,
      currentActor.id,
      fileId,
    );
    await client.query(
      `INSERT INTO contract_financial_file_hashes (
         file_hash, file_id, contract_id, created_at
       ) VALUES ($1,$2,$3,$4)`,
      [file.fileHash, fileId, contractId, startedAt],
    );
    await client.query(
      `INSERT INTO contract_financial_ocr_jobs (
         id, contract_id, file_id, file_hash, record_kind, document_kind,
         status, failure_kind, retry_count, worker_token, lease_expires_at,
         can_auto_post, snapshot_json, blocking_reasons_json,
         warnings_json, business_purpose, target_id, requested_by,
         started_at, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'processing',NULL,0,$7,$8,
         FALSE,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,$9,$10,$11,$12,$12,$12
       )`,
      [
        jobId,
        contractId,
        fileId,
        file.fileHash,
        kind,
        kind === "invoice" ? "invoice" : "bank_receipt",
        workerToken,
        leaseExpiresAt,
        depositReturnContext?.businessPurpose || null,
        depositReturnContext?.targetId || null,
        currentActor.id,
        startedAt,
      ],
    );
    await client.query(
      `INSERT INTO contract_audit_logs (
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) VALUES ($1,$2,'financial_ocr_started',$3,$4,$5,$5,$6::jsonb,$7)`,
      [
        nanoid(),
        contractId,
        currentActor.id,
        currentActor.role,
        target.status,
        JSON.stringify({
          jobId,
          fileId,
          fileHash: file.fileHash,
          kind,
          businessPurpose: depositReturnContext?.businessPurpose || null,
          targetId: depositReturnContext?.targetId || null,
        }),
        startedAt,
      ],
    );
    return {
      contract: target,
      existing: null,
      execution: {
        fileId,
        filePath: file.filePath,
        jobId,
        workerToken,
        retryCount: 0,
        reusedStoredFile: false,
      },
    };
  });
  if (registration.existing) {
    if (!preserveStoredFileOnReuse) cleanupUploadedFile(uploadedFile);
    const existing = registration.existing;
    const expectedDirection = depositReturnContext
      ? depositReturnContext.businessPurpose === "deposit_refund"
        ? "receipt"
        : "payment"
      : kind === "invoice"
        ? existing.direction === "input" || existing.direction === "output"
          ? existing.direction
          : "unknown"
        : kind === "receipt"
          ? "receipt"
          : "payment";
    return financialJobResponse({
      id: existing.job_id as string,
      contractId,
      fileId: existing.file_id,
      recordKind: kind,
      status: existing.job_status as FinancialOcrJobView["status"],
      validationStatus: existing.validation_status,
      failureKind: existing.failure_kind,
      retryCount: existing.retry_count || 0,
      recognitionMethod: existing.recognition_method,
      evidenceTextHash: existing.evidence_text_hash,
      direction: existing.direction,
      expectedDirection,
      documentStatus: existing.document_status,
      canCreateDraft:
        existing.job_status === "verified" &&
        existing.validation_status === "verified" &&
        existing.can_auto_post === true &&
        existing.document_status === "normal" &&
        existing.direction === expectedDirection,
      diagnosticScore: null,
      snapshot: existing.snapshot_json as SafeContractFinancialSnapshot,
      blockingReasons: existing.blocking_reasons_json || [],
      warnings: existing.warnings_json || [],
      engineVersion: existing.engine_version,
      parserVersion: existing.parser_version,
    });
  }
  const execution = registration.execution;
  if (!execution) {
    throw new ContractDomainError(
      409,
      "财务凭证识别任务状态异常，请刷新后重试",
      "FINANCIAL_OCR_JOB_STATE_CHANGED",
    );
  }
  if (execution.reusedStoredFile && !preserveStoredFileOnReuse) {
    cleanupUploadedFile(uploadedFile);
  } else onStored?.();
  const contract = registration.contract;
  const contractCompanySubject = depositReturnContext
    ? undefined
    : resolveContractCompanySubject(contract);
  let result: Awaited<ReturnType<typeof recognizeContractFinancialDocument>>;
  let decision: ReturnType<typeof decideContractFinancialOcr>;
  let snapshot: SafeContractFinancialSnapshot;
  try {
    result = await recognizeContractFinancialDocument({
      filePath: path.resolve(process.cwd(), execution.filePath),
      kind: kind === "invoice" ? "invoice" : "bank_receipt",
      context: {
        companyNames: CONTRACT_COMPANY_LEGAL_NAMES,
        companyTaxIds: CONTRACT_COMPANY_TAX_IDS,
        companySubjects: CONTRACT_COMPANY_SUBJECTS,
        ...(contractCompanySubject ? { contractCompanySubject } : {}),
        requireInvoiceLineItems:
          kind === "invoice" && requiresHouseRentalInvoiceLines(contract),
        allowTaxExemptInvoice:
          kind === "invoice" && isVehicleRentalContract(contract),
        ...(depositReturnContext?.businessPurpose === "engineering_return"
          ? {
              internalFundingPair: {
                payerName: depositReturnContext.expectedPayer,
                payeeName: depositReturnContext.expectedPayee,
              },
            }
          : depositReturnContext?.businessPurpose ===
              "engineering_internal_funding"
            ? {
                internalFundingPair: {
                  payerName: depositReturnContext.expectedPayer,
                  payeeName: depositReturnContext.expectedPayee,
                },
              }
            : contract.asset_funding_mode === "engineering_to_technology"
              ? {
                  internalFundingPair: {
                    payerName: "北京羽隶工程咨询有限公司",
                    payeeName: contractCompanySubject!.name,
                  },
                }
              : {}),
      },
    });
    if (depositReturnContext) {
      result = addDepositReturnOcrBusinessGuards(result, depositReturnContext);
    }
    decision = decideContractFinancialOcr(result, kind);
    snapshot = buildSafeContractFinancialSnapshot(result);
  } catch (error) {
    await markFinancialOcrJobFailed({
      contractId,
      contractStatus: contract.status,
      fileId: execution.fileId,
      fileHash: file.fileHash,
      format:
        file.mimeType === "application/pdf"
          ? "pdf"
          : file.mimeType === "image/jpeg"
            ? "jpeg"
            : "png",
      jobId: execution.jobId,
      workerToken: execution.workerToken,
      kind,
      actor: currentActor,
    });
    throw error;
  }
  const finishedAt = new Date().toISOString();
  await db.transaction(async (client) => {
    const current = await client.query<{
      status: string;
      worker_token: string | null;
    }>(
      `SELECT status, worker_token FROM contract_financial_ocr_jobs
       WHERE id = $1 AND contract_id = $2
       FOR UPDATE`,
      [execution.jobId, contractId],
    );
    if (
      current.rows[0]?.status !== "processing" ||
      current.rows[0]?.worker_token !== execution.workerToken
    ) {
      throw new ContractDomainError(
        409,
        "财务凭证识别任务状态已变化，请刷新后重试",
        "FINANCIAL_OCR_JOB_STATE_CHANGED",
      );
    }
    if (
      kind === "invoice" &&
      result.kind === "invoice" &&
      result.validationStatus === "verified" &&
      result.documentStatus === "normal"
    ) {
      const sellerKey = normalizeFinancialIdentity(result.fields.seller);
      const invoiceNumberKey = normalizeFinancialIdentity(
        result.fields.invoiceNumber,
      );
      if (sellerKey && invoiceNumberKey) {
        const [globalInvoiceNumberKey] = await lockCrossModuleInvoiceNumbers(
          client,
          [result.fields.invoiceNumber],
        );
        const reimbursementUsage = globalInvoiceNumberKey
          ? await findReimbursementInvoiceUsage(client, globalInvoiceNumberKey)
          : null;
        // 上传识别完成后立即按业务键加锁查重；登记保存时仍会在同一把锁下
        // 二次检查并由条件唯一索引兜底，避免并发上传绕过。
        await client.query(
          `SELECT pg_advisory_xact_lock(
             hashtextextended('contract-invoice:' || $1 || ':' || $2, 0)
           )`,
          [sellerKey, invoiceNumberKey],
        );
        const duplicate = await client.query<{ id: string }>(
          `SELECT id FROM contract_invoices
           WHERE status IN ('draft', 'confirmed', 'reversed')
             AND LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(seller), NFKC), '[[:space:]]+', '', 'g')) = $1
             AND LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(invoice_no), NFKC), '[[:space:]]+', '', 'g')) = $2
           UNION ALL
           SELECT id FROM contract_financial_ocr_jobs
           WHERE id <> $3 AND record_kind = 'invoice'
             AND status IN ('verified', 'consumed')
             AND validation_status = 'verified'
             AND document_status = 'normal'
             AND LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(snapshot_json #>> '{fields,seller}'), NFKC), '[[:space:]]+', '', 'g')) = $1
             AND LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(snapshot_json #>> '{fields,invoiceNumber}'), NFKC), '[[:space:]]+', '', 'g')) = $2
           LIMIT 1`,
          [sellerKey, invoiceNumberKey, execution.jobId],
        );
        if (reimbursementUsage || duplicate.rows[0]) {
          const reasonCode = reimbursementUsage
            ? "INVOICE_ALREADY_USED_IN_OTHER_MODULE"
            : "DUPLICATE_CONTRACT_INVOICE";
          result = {
            ...result,
            validationStatus: "blocked",
            canAutoPost: false,
            blockingReasons: [
              ...result.blockingReasons.filter(
                (reason) =>
                  ![
                    "DUPLICATE_CONTRACT_INVOICE",
                    "INVOICE_ALREADY_USED_IN_OTHER_MODULE",
                  ].includes(reason.code),
              ),
              {
                code: reasonCode,
                field: "invoiceNumber",
                message: reimbursementUsage
                  ? `发票号码 ${result.fields.invoiceNumber} 已在报销模块使用，不能再进入合同财务`
                  : `发票号码 ${result.fields.invoiceNumber} 已在合同财务登记中上传或登记，请勿重复上传`,
              },
            ],
          };
          decision = decideContractFinancialOcr(result, kind);
          snapshot = buildSafeContractFinancialSnapshot(result);
        }
      }
    }
    if (
      kind !== "invoice" &&
      result.kind === "bank_receipt" &&
      result.documentStatus === "normal" &&
      result.fields.electronicReceiptNo &&
      (await findContractBankReceiptNumberDuplicate(
        client,
        result.fields.electronicReceiptNo,
        execution.jobId,
      ))
    ) {
      result = {
        ...result,
        validationStatus: "blocked",
        canAutoPost: false,
        blockingReasons: [
          ...result.blockingReasons.filter(
            (reason) => reason.code !== "DUPLICATE_CONTRACT_BANK_DOCUMENT",
          ),
          {
            code: "DUPLICATE_CONTRACT_BANK_DOCUMENT",
            field: "electronicReceiptNo",
            message: `电子回单号码 ${result.fields.electronicReceiptNo} 已上传或登记，请勿重复上传`,
          },
        ],
      };
      decision = decideContractFinancialOcr(result, kind);
      snapshot = buildSafeContractFinancialSnapshot(result);
    }
    await client.query(
      `UPDATE contract_financial_ocr_jobs
       SET status = $3, validation_status = $4, recognition_method = $5,
         engine_version = $6, parser_version = $7, evidence_text_hash = $8,
         direction = $9, document_status = $10, can_auto_post = $11,
         snapshot_json = $12::jsonb, blocking_reasons_json = $13::jsonb,
         warnings_json = $14::jsonb, failure_kind = $15,
         finished_at = $16, updated_at = $16,
         worker_token = NULL, lease_expires_at = NULL
       WHERE id = $1 AND contract_id = $2 AND worker_token = $17`,
      [
        execution.jobId,
        contractId,
        decision.status,
        result.validationStatus,
        result.recognition?.method || null,
        contractFinancialOcrEngineVersion(kind),
        contractFinancialOcrParserVersion(kind),
        result.recognition?.textSha256 || null,
        result.direction,
        result.documentStatus,
        decision.canCreateDraft,
        JSON.stringify(snapshot),
        JSON.stringify(decision.blockingReasons),
        JSON.stringify(result.warnings),
        result.failureKind || null,
        finishedAt,
        execution.workerToken,
      ],
    );
    await client.query(
      `INSERT INTO contract_audit_logs (
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) VALUES ($1,$2,'financial_ocr_finished',$3,$4,$5,$5,$6::jsonb,$7)`,
      [
        nanoid(),
        contractId,
        currentActor.id,
        currentActor.role,
        contract.status,
        JSON.stringify({
          jobId: execution.jobId,
          fileId: execution.fileId,
          fileHash: file.fileHash,
          status: decision.status,
          validationStatus: result.validationStatus,
          failureKind: result.failureKind || null,
          retryCount: execution.retryCount,
          recognitionMethod: result.recognition?.method || null,
          engineVersion: contractFinancialOcrEngineVersion(kind),
          parserVersion: contractFinancialOcrParserVersion(kind),
          evidenceTextHash: result.recognition?.textSha256 || null,
          direction: result.direction,
          expectedDirection: decision.expectedDirection,
          documentStatus: result.documentStatus,
          canCreateDraft: decision.canCreateDraft,
          blockingReasonCodes: decision.blockingReasons.map(
            (reason) => reason.code,
          ),
        }),
        finishedAt,
      ],
    );
  });

  return financialJobResponse({
    id: execution.jobId,
    contractId,
    fileId: execution.fileId,
    recordKind: kind,
    status: decision.status,
    validationStatus: result.validationStatus,
    failureKind: result.failureKind || null,
    retryCount: execution.retryCount,
    recognitionMethod: result.recognition?.method || null,
    evidenceTextHash: result.recognition?.textSha256 || null,
    direction: result.direction,
    expectedDirection: decision.expectedDirection,
    documentStatus: result.documentStatus,
    canCreateDraft: decision.canCreateDraft,
    diagnosticScore: result.recognition?.averageConfidence ?? null,
    snapshot,
    blockingReasons: decision.blockingReasons,
    warnings: result.warnings,
    engineVersion: contractFinancialOcrEngineVersion(kind),
    parserVersion: contractFinancialOcrParserVersion(kind),
  });
}

interface StoredFinancialOcrJob {
  id: string;
  contract_id: string;
  file_id: string;
  file_hash: string;
  record_kind: FinancialRecordKind;
  status: string;
  validation_status: string | null;
  direction: string | null;
  document_status: string | null;
  can_auto_post: boolean;
  record_id: string | null;
  parser_version: string | null;
  snapshot_json: SafeContractFinancialSnapshot;
}

async function createFinancialDraftFromJob(
  contractId: string,
  kind: FinancialRecordKind,
  jobId: string,
  clientValues: Record<string, unknown>,
  currentActor: { id: string; role: string },
): Promise<{ contract: ContractRow; recordId: string; fileId: string }> {
  return db.transaction(async (client) => {
    const target = await lockFinancialContract(client, contractId, kind);
    const jobs = await client.query<StoredFinancialOcrJob>(
      `SELECT * FROM contract_financial_ocr_jobs
       WHERE id = $1 AND contract_id = $2 AND record_kind = $3
         AND business_purpose IS NULL
       FOR UPDATE`,
      [jobId, contractId, kind],
    );
    const job = jobs.rows[0];
    if (!job) {
      throw new ContractDomainError(
        404,
        "财务凭证识别任务不存在",
        "FINANCIAL_OCR_JOB_NOT_FOUND",
      );
    }
    const decisionDirection =
      kind === "invoice"
        ? job.direction === "input" || job.direction === "output"
          ? job.direction
          : "unknown"
        : kind === "receipt"
          ? "receipt"
          : "payment";
    if (
      job.status !== "verified" ||
      job.validation_status !== "verified" ||
      job.can_auto_post !== true ||
      job.document_status !== "normal" ||
      job.direction !== decisionDirection
    ) {
      throw new ContractDomainError(
        422,
        "该凭证未通过服务端独立验证，已安全隔离，不能生成财务草稿",
        "FINANCIAL_OCR_NOT_VERIFIED",
      );
    }
    const snapshot = job.snapshot_json;
    const mismatches = findContractFinancialClientMismatches(
      kind,
      clientValues,
      snapshot,
    );
    if (mismatches.length > 0) {
      throw new ContractDomainError(
        409,
        `客户端字段与凭证识别原文不一致：${mismatches.join("、")}`,
        "FINANCIAL_CLIENT_VALUE_MISMATCH",
      );
    }

    const fields = snapshot.fields as unknown as Record<string, unknown>;
    const amount = parsePositiveAmount(
      fields.amount,
      financialRecordLabel(kind),
    );
    const occurredAt = normalizeDate(
      kind === "invoice" ? fields.invoiceDate : fields.transactionDate,
      `${financialRecordLabel(kind)}日期`,
    );
    const recordId = nanoid();
    const now = new Date().toISOString();

    if (kind === "invoice") {
      await lockInvoiceApplicationRoot(client, contractId);
      const invoiceNo = normalizeFinancialDisplayValue(fields.invoiceNumber);
      const seller = normalizeFinancialDisplayValue(fields.seller);
      const itemName = normalizeFinancialDisplayValue(fields.itemName);
      if (!invoiceNo || !seller || !itemName) {
        throw new ContractDomainError(
          422,
          "发票识别快照缺少发票号码、开票名称或销售方名称，不能生成草稿",
          "FINANCIAL_OCR_SNAPSHOT_INVALID",
        );
      }
      await assertContractInvoiceBusinessKeysAvailable(
        client,
        [{ seller, invoiceNumber: invoiceNo }],
        "本次登记包含重复发票",
      );
      const taxAmount = parseVerifiedInvoiceTaxAmount(
        fields.taxAmount,
        isVehicleRentalContract(target),
      );
      if (taxAmount !== null && taxAmount > amount) {
        throw new ContractDomainError(422, "识别税额不能大于发票金额");
      }
      await client.query(
        `INSERT INTO contract_invoices (
           id, contract_id, file_id, invoice_code, invoice_no, item_name,
           invoice_date, amount, tax_amount, seller, buyer, note,
           financial_ocr_job_id, status, created_by, created_at, updated_at
         ) VALUES (
           $1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$14,$14
         )`,
        [
          recordId,
          contractId,
          job.file_id,
          invoiceNo,
          itemName,
          occurredAt,
          amount,
          taxAmount,
          seller,
          normalizeFinancialDisplayValue(fields.buyer),
          normalizeNullableText(clientValues.note),
          job.id,
          currentActor.id,
          now,
        ],
      );
      await reconcileInvoiceApplicationAllocations(client, contractId);
    } else {
      const electronicReceiptNo = normalizeFinancialDisplayValue(
        fields.electronicReceiptNo,
      );
      const transactionSerialNo = normalizeFinancialDisplayValue(
        fields.transactionSerialNo,
      );
      const proofNo = normalizeFinancialDisplayValue(fields.proofNo);
      if (!electronicReceiptNo && !transactionSerialNo) {
        throw new ContractDomainError(
          422,
          "银行回单识别快照缺少电子回单号和交易流水号，不能生成草稿",
          "FINANCIAL_OCR_SNAPSHOT_INVALID",
        );
      }
      const bankName = normalizeFinancialDisplayValue(fields.bankName);
      const currency = normalizeFinancialDisplayValue(fields.currency);
      const payerAccount = normalizeFinancialDisplayValue(fields.payerAccount);
      const payeeAccount = normalizeFinancialDisplayValue(fields.payeeAccount);
      const rawBookingDate = normalizeFinancialDisplayValue(fields.bookingDate);
      const bookingDate = rawBookingDate
        ? normalizeDate(rawBookingDate, "记账日期")
        : null;
      if (!bankName || !currency || !payerAccount || !payeeAccount) {
        throw new ContractDomainError(
          422,
          "银行回单识别快照缺少银行、币种或双方账号，不能生成草稿",
          "FINANCIAL_OCR_SNAPSHOT_INVALID",
        );
      }
      const normalizedBankName = normalizeFinancialIdentity(bankName);
      const normalizedTransactionSerialNo = normalizeFinancialBankIdentifier(
        transactionSerialNo || "",
      );
      const normalizedElectronicReceiptNo = normalizeFinancialBankIdentifier(
        electronicReceiptNo || "",
      );
      const lockKeys = [
        normalizedTransactionSerialNo
          ? `transaction:${normalizedTransactionSerialNo}`
          : "",
        normalizedElectronicReceiptNo
          ? `receipt:${normalizedElectronicReceiptNo}`
          : "",
      ]
        .filter(Boolean)
        .sort();
      for (const lockKey of lockKeys) {
        await client.query(
          `SELECT pg_advisory_xact_lock(
             hashtextextended('contract-bank-document:' || $1 || ':' || $2, 0)
           )`,
          [normalizedBankName, lockKey],
        );
      }
      const duplicated = await client.query<{ id: string }>(
        `SELECT id FROM (
           SELECT receipt.id, receipt.bank_name, receipt.electronic_receipt_no,
             receipt.transaction_serial_no, receipt.proof_no,
             receipt.receipt_date AS record_date, receipt.amount, receipt.status
           FROM contract_receipts AS receipt
           UNION ALL
           SELECT payment.id, payment.bank_name, payment.electronic_receipt_no,
             payment.transaction_serial_no, payment.proof_no,
             payment.payment_date AS record_date, payment.amount, payment.status
           FROM contract_payments AS payment
         ) AS financial_bank_document
         WHERE financial_bank_document.status IN ('draft', 'confirmed')
           AND (
             (
               LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(financial_bank_document.bank_name), NFKC), '[[:space:]]+', '', 'g')) = $1
               AND $2 <> ''
               AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(financial_bank_document.transaction_serial_no), NFKC), '[^[:alnum:]]+', '', 'g')) = $2
             ) OR (
               LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(financial_bank_document.bank_name), NFKC), '[[:space:]]+', '', 'g')) = $1
               AND $3 <> ''
               AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(financial_bank_document.electronic_receipt_no), NFKC), '[^[:alnum:]]+', '', 'g')) = $3
             ) OR (
               financial_bank_document.transaction_serial_no IS NULL
               AND financial_bank_document.electronic_receipt_no IS NULL
               AND financial_bank_document.record_date = $4
               AND financial_bank_document.amount = $5::numeric
               AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(financial_bank_document.proof_no), NFKC), '[^[:alnum:]]+', '', 'g')) IN ($2, $3)
             )
           )
         LIMIT 1`,
        [
          normalizedBankName,
          normalizedTransactionSerialNo,
          normalizedElectronicReceiptNo,
          occurredAt,
          amount,
        ],
      );
      if (duplicated.rows[0]) {
        throw new ContractDomainError(
          409,
          "同一银行的电子回单号或交易流水号已存在，禁止重复录入",
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      }
      if (kind === "receipt") {
        await client.query(
          `INSERT INTO contract_receipts (
             id, contract_id, file_id, receipt_date, booking_date, amount,
             payer, payer_account, payee, payee_account, bank_name, currency,
             electronic_receipt_no, transaction_serial_no, proof_no,
             note, financial_ocr_job_id, status, created_by,
             created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'draft',$18,$19,$19
           )`,
          [
            recordId,
            contractId,
            job.file_id,
            occurredAt,
            bookingDate,
            amount,
            normalizeFinancialDisplayValue(fields.payer),
            payerAccount,
            normalizeFinancialDisplayValue(fields.payee),
            payeeAccount,
            bankName,
            currency,
            electronicReceiptNo,
            transactionSerialNo,
            proofNo || electronicReceiptNo || transactionSerialNo,
            normalizeNullableText(clientValues.note),
            job.id,
            currentActor.id,
            now,
          ],
        );
      } else {
        const expenseCategory = "other";
        await client.query(
          `INSERT INTO contract_payments (
             id, contract_id, file_id, payment_date, booking_date, amount,
             expense_category, payer, payer_account, payee, payee_account,
             bank_name, currency, electronic_receipt_no, transaction_serial_no,
             proof_no, note,
             financial_ocr_job_id, status, created_by, created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'draft',$19,$20,$20
           )`,
          [
            recordId,
            contractId,
            job.file_id,
            occurredAt,
            bookingDate,
            amount,
            expenseCategory,
            normalizeFinancialDisplayValue(fields.payer),
            payerAccount,
            normalizeFinancialDisplayValue(fields.payee),
            payeeAccount,
            bankName,
            currency,
            electronicReceiptNo,
            transactionSerialNo,
            proofNo || electronicReceiptNo || transactionSerialNo,
            normalizeNullableText(clientValues.note),
            job.id,
            currentActor.id,
            now,
          ],
        );
      }
    }

    await client.query(
      `UPDATE contract_financial_ocr_jobs
       SET status = 'consumed', record_id = $2, consumed_at = $3, updated_at = $3
       WHERE id = $1`,
      [job.id, recordId, now],
    );
    await client.query(
      `INSERT INTO contract_audit_logs (
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$6,$7::jsonb,$8)`,
      [
        nanoid(),
        contractId,
        `${kind}_created`,
        currentActor.id,
        currentActor.role,
        target.status,
        JSON.stringify({
          recordId,
          fileId: job.file_id,
          financialOcrJobId: job.id,
          fileHash: job.file_hash,
          amount,
          occurredAt,
          recordStatus: "draft",
          source: "server_verified_financial_ocr",
        }),
        now,
      ],
    );
    return { contract: target, recordId, fileId: job.file_id };
  });
}

interface CreatedFinancialRegistration {
  registrationId: string;
  invoiceRecordIds: string[];
  settlementRecordIds: string[];
  invoiceRecordId: string | null;
  settlementRecordId: string | null;
  matches: Array<{
    registrationId: string;
    invoiceRecordId: string;
    settlementRecordId: string;
    allocatedAmount: number;
  }>;
  status: "draft" | "confirmed";
}

function financialRegistrationAmountsAreClosed(input: {
  invoiceRecordIds: readonly string[];
  settlementRecordIds: readonly string[];
  invoiceTotalCents: number;
  settlementTotalCents: number;
  allocatedTotalCents: number;
}): boolean {
  return (
    input.invoiceRecordIds.length > 0 &&
    input.settlementRecordIds.length > 0 &&
    input.invoiceTotalCents === input.settlementTotalCents &&
    input.allocatedTotalCents === input.invoiceTotalCents
  );
}

async function createExternalPaymentRegistrationShell(
  contractId: string,
  currentActor: { id: string; role: string },
): Promise<string> {
  return db.transaction(async (client) => {
    const target = await lockFinancialContract(client, contractId, "payment");
    if (
      target.category !== "asset" ||
      target.asset_funding_mode !== "engineering_to_technology"
    ) {
      throw new ContractDomainError(
        409,
        "只有工程咨询向实际签约公司内部划拨的模式允许先保存签约公司对外付款",
        "EXTERNAL_PAYMENT_NOT_REQUIRED",
      );
    }
    const registrationId = nanoid();
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO contract_financial_registrations (
         id, contract_id, settlement_kind, financial_direction,
         direction_invoice_record_id, invoice_ocr_job_id,
         bank_ocr_job_id, invoice_record_id, receipt_record_id,
         payment_record_id, bank_business_key_hash, status, created_by,
         created_at, updated_at
       ) VALUES (
         $1,$2,'payment','cost',NULL,NULL,NULL,NULL,NULL,NULL,NULL,
         'draft',$3,$4,$4
       )`,
      [registrationId, contractId, currentActor.id, now],
    );
    await client.query(
      `INSERT INTO contract_audit_logs (
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) VALUES ($1,$2,'external_payment_registration_created',$3,$4,$5,$5,$6::jsonb,$7)`,
      [
        nanoid(),
        contractId,
        currentActor.id,
        currentActor.role,
        target.status,
        JSON.stringify({ registrationId, awaitingInvoice: true }),
        now,
      ],
    );
    return registrationId;
  });
}

function assertVerifiedFinancialRegistrationJob(
  job: StoredFinancialOcrJob | undefined,
  kind: FinancialRecordKind,
  expectedDirection: "input" | "output" | "receipt" | "payment",
): asserts job is StoredFinancialOcrJob {
  if (!job || job.record_kind !== kind) {
    throw new ContractDomainError(
      422,
      `${financialRecordLabel(kind)}识别任务与本次登记不匹配`,
      "FINANCIAL_REGISTRATION_JOB_MISMATCH",
    );
  }
  if (job.record_id || job.status === "consumed") {
    throw new ContractDomainError(
      409,
      `${financialRecordLabel(kind)}识别任务已被使用`,
      "FINANCIAL_REGISTRATION_JOB_CONSUMED",
    );
  }
  if (job.parser_version !== contractFinancialOcrParserVersion(kind)) {
    throw new ContractDomainError(
      422,
      `${financialRecordLabel(kind)}识别任务版本已更新，请重新上传后识别`,
      "FINANCIAL_OCR_STRATEGY_OUTDATED",
    );
  }
  if (
    job.status !== "verified" ||
    job.validation_status !== "verified" ||
    job.can_auto_post !== true ||
    job.document_status !== "normal" ||
    job.direction !== expectedDirection
  ) {
    throw new ContractDomainError(
      422,
      `${financialRecordLabel(kind)}未通过服务端独立验证，不能登记`,
      "FINANCIAL_OCR_NOT_VERIFIED",
    );
  }
}

async function createFinancialRegistrationFromJobs(
  contractId: string,
  invoiceJobIds: string[],
  bankJobIds: string[],
  clientValues: Record<string, unknown>,
  currentActor: { id: string; role: string },
): Promise<CreatedFinancialRegistration> {
  const submittedInvoiceJobIds = invoiceJobIds.filter(Boolean);
  const uniqueInvoiceJobIds = [...new Set(submittedInvoiceJobIds)];
  const uniqueBankJobIds = [...new Set(bankJobIds.filter(Boolean))];
  if (uniqueInvoiceJobIds.length !== submittedInvoiceJobIds.length) {
    throw new ContractDomainError(
      409,
      "本次登记重复提交了同一发票识别任务",
      "DUPLICATE_CONTRACT_INVOICE",
    );
  }
  if (!uniqueInvoiceJobIds.length && !uniqueBankJobIds.length) {
    throw new ContractDomainError(
      400,
      "必须至少提交一张发票或银行回单",
      "FINANCIAL_REGISTRATION_DOCUMENT_REQUIRED",
    );
  }
  if (uniqueInvoiceJobIds.some((id) => uniqueBankJobIds.includes(id))) {
    throw new ContractDomainError(
      400,
      "发票和银行回单不能使用同一个识别任务",
      "FINANCIAL_REGISTRATION_JOB_MISMATCH",
    );
  }

  return db.transaction(async (client) => {
    const target = await lockFinancialContract(client, contractId, "invoice");
    const allJobIds = [...uniqueInvoiceJobIds, ...uniqueBankJobIds].sort();
    const jobs = await client.query<StoredFinancialOcrJob>(
      `SELECT * FROM contract_financial_ocr_jobs
       WHERE id = ANY($1::text[]) AND contract_id = $2
         AND business_purpose IS NULL
       ORDER BY id ASC
       FOR UPDATE`,
      [allJobIds, contractId],
    );
    const jobsById = new Map(jobs.rows.map((job) => [job.id, job]));
    let expectedInvoiceDirection: "input" | "output";
    let financialDirection: "income" | "cost";
    if (uniqueInvoiceJobIds.length) {
      const invoiceDirections = new Set(
        uniqueInvoiceJobIds.map((id) => jobsById.get(id)?.direction),
      );
      if (
        invoiceDirections.size !== 1 ||
        !["input", "output"].includes(String([...invoiceDirections][0] || ""))
      ) {
        throw new ContractDomainError(
          422,
          "本次发票的购销方向不一致或无法确定，不能生成同一笔财务登记",
          "FINANCIAL_INVOICE_DIRECTIONS_MIXED",
        );
      }
      expectedInvoiceDirection = [...invoiceDirections][0] as
        | "input"
        | "output";
      financialDirection =
        expectedInvoiceDirection === "output" ? "income" : "cost";
    } else {
      if (target.category !== "main_business") {
        throw new ContractDomainError(
          400,
          "只有主营合同允许先保存回款、后补发票",
          "FINANCIAL_REGISTRATION_INVOICE_REQUIRED",
        );
      }
      expectedInvoiceDirection = "output";
      financialDirection = "income";
    }
    const settlementKind: "receipt" | "payment" =
      financialDirection === "income" ? "receipt" : "payment";
    const expectedBankDirection = settlementKind;
    assertFinancialKindAllowed(target, settlementKind);
    if (
      target.financial_direction &&
      target.financial_direction !== financialDirection
    ) {
      throw new ContractDomainError(
        409,
        "发票购销方向与合同类型规定的收支方向不一致",
        "FINANCIAL_DIRECTION_CONFLICT",
      );
    }
    const invoiceJobs = uniqueInvoiceJobIds.map((id) => {
      const job = jobsById.get(id);
      assertVerifiedFinancialRegistrationJob(
        job,
        "invoice",
        expectedInvoiceDirection,
      );
      return job;
    });
    const bankJobs = uniqueBankJobIds.map((id) => {
      const job = jobsById.get(id);
      assertVerifiedFinancialRegistrationJob(
        job,
        settlementKind,
        expectedBankDirection,
      );
      return job;
    });

    const invoiceDocuments = invoiceJobs.map((job) => {
      const values = job.snapshot_json?.fields as unknown as Record<
        string,
        unknown
      >;
      const document = {
        job,
        invoiceNumber: normalizeFinancialDisplayValue(values?.invoiceNumber),
        itemName: normalizeFinancialDisplayValue(values?.itemName),
        seller: normalizeFinancialDisplayValue(values?.seller),
        buyer: normalizeFinancialDisplayValue(values?.buyer),
        date: normalizeDate(values?.invoiceDate, "开票日期"),
        amount: parsePositiveAmount(values?.amount, "发票金额"),
        taxAmount: parseVerifiedInvoiceTaxAmount(
          values?.taxAmount,
          isVehicleRentalContract(target),
        ),
        lineItems: parseContractInvoiceLineItems(
          values?.lineItems,
          parsePositiveAmount(values?.amount, "发票金额"),
          requiresHouseRentalInvoiceLines(target),
        ),
      };
      if (
        !document.invoiceNumber ||
        !document.itemName ||
        !document.seller ||
        !document.buyer
      ) {
        throw new ContractDomainError(
          422,
          "发票识别快照缺少本次登记必需字段",
          "FINANCIAL_OCR_SNAPSHOT_INVALID",
        );
      }
      if (document.taxAmount !== null && document.taxAmount > document.amount) {
        throw new ContractDomainError(422, "识别税额不能大于发票金额");
      }
      return document as typeof document & {
        invoiceNumber: string;
        itemName: string;
        seller: string;
        buyer: string;
      };
    });
    const bankDocuments = bankJobs.map((job) => {
      const values = job.snapshot_json?.fields as unknown as Record<
        string,
        unknown
      >;
      const paymentTime = normalizeFinancialPaymentTime(values?.paymentTime);
      const document = {
        job,
        payer: normalizeFinancialDisplayValue(values?.payer),
        payerAccount: normalizeFinancialDisplayValue(values?.payerAccount),
        payee: normalizeFinancialDisplayValue(values?.payee),
        payeeAccount: normalizeFinancialDisplayValue(values?.payeeAccount),
        electronicReceiptNo: normalizeFinancialDisplayValue(
          values?.electronicReceiptNo,
        ),
        paymentTime,
        date: paymentTime.slice(0, 10),
        amount: parsePositiveAmount(values?.amount, "回单金额"),
      };
      if (
        !document.payer ||
        !document.payerAccount ||
        !document.payee ||
        !document.payeeAccount ||
        !document.electronicReceiptNo
      ) {
        throw new ContractDomainError(
          422,
          "银行回单识别快照缺少本次登记必需字段",
          "FINANCIAL_OCR_SNAPSHOT_INVALID",
        );
      }
      return document as typeof document & {
        payer: string;
        payerAccount: string;
        payee: string;
        payeeAccount: string;
        electronicReceiptNo: string;
      };
    });

    const partyValidationInvoices =
      financialDirection === "income" && !invoiceDocuments.length
        ? [{ buyer: "", seller: resolveContractCompanySubject(target).name }]
        : invoiceDocuments;
    for (const invoice of partyValidationInvoices) {
      for (const bank of bankDocuments) {
        if (financialDirection === "cost") {
          assertAssetPaymentParties(target.asset_funding_mode, invoice, bank);
        } else if (!incomeReceiptPartiesMatch(invoice, bank)) {
          throw new ContractDomainError(
            422,
            "营收登记要求发票销售方与回款回单收款人一致",
            "FINANCIAL_REGISTRATION_PARTY_MISMATCH",
          );
        }
      }
    }
    const invoiceTotalCents = invoiceDocuments.reduce(
      (sum, item) => sum + toCents(String(item.amount)),
      0,
    );
    const bankTotalCents = bankDocuments.reduce(
      (sum, item) => sum + toCents(String(item.amount)),
      0,
    );
    const allowsPendingInvoiceReceipt =
      target.category === "main_business" && financialDirection === "income";
    if (!allowsPendingInvoiceReceipt && bankTotalCents > invoiceTotalCents) {
      throw new ContractDomainError(
        422,
        `${settlementKind === "receipt" ? "回单" : "付款凭证"}合计${centsToAmount(bankTotalCents).toFixed(2)}元不能超过发票合计${centsToAmount(invoiceTotalCents).toFixed(2)}元`,
        "FINANCIAL_REGISTRATION_AMOUNT_MISMATCH",
      );
    }

    await assertContractInvoiceBusinessKeysAvailable(
      client,
      invoiceDocuments,
      "本次登记包含重复发票",
    );
    const bankKeys = new Set<string>();
    const bankReceiptNumberKeys = new Set<string>();
    const bankBusinessHashes: string[] = [];
    for (const bank of bankDocuments) {
      const receiptNumberKey = normalizeFinancialBankIdentifier(
        bank.electronicReceiptNo,
      );
      if (bankReceiptNumberKeys.has(receiptNumberKey)) {
        throw new ContractDomainError(
          409,
          `本次登记包含重复电子回单号码 ${bank.electronicReceiptNo}`,
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      }
      bankReceiptNumberKeys.add(receiptNumberKey);
      if (
        await findContractBankReceiptNumberDuplicate(
          client,
          bank.electronicReceiptNo,
          bank.job.id,
        )
      ) {
        throw new ContractDomainError(
          409,
          `电子回单号码 ${bank.electronicReceiptNo} 已上传或登记，禁止重复录入`,
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      }
      const businessHash = crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            normalizeFinancialBankIdentifier(bank.electronicReceiptNo),
            bank.paymentTime,
            toCents(String(bank.amount)),
            normalizeFinancialIdentity(bank.payer),
            normalizeFinancialBankIdentifier(bank.payerAccount),
            normalizeFinancialIdentity(bank.payee),
            normalizeFinancialBankIdentifier(bank.payeeAccount),
          ]),
        )
        .digest("hex");
      if (bankKeys.has(businessHash))
        throw new ContractDomainError(
          409,
          "本次登记包含重复银行回单",
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      bankKeys.add(businessHash);
      bankBusinessHashes.push(businessHash);
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('contract-bank-business:' || $1, 0))`,
        [businessHash],
      );
      const duplicate = await client.query<{ id: string }>(
        `SELECT id FROM contract_financial_registration_items WHERE business_key_hash = $1 LIMIT 1`,
        [businessHash],
      );
      if (duplicate.rows[0])
        throw new ContractDomainError(
          409,
          "该银行回单业务已登记，禁止重复录入",
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      const legacy = await client.query<{ id: string }>(
        `SELECT id FROM (SELECT id, receipt_date AS record_date, amount, payer_account, payee_account, electronic_receipt_no FROM contract_receipts
         UNION ALL SELECT id, payment_date, amount, payer_account, payee_account, electronic_receipt_no FROM contract_payments
         UNION ALL SELECT id, payment_date, amount, payer_account, payee_account, electronic_receipt_no FROM contract_external_payments) AS bank_record
         WHERE UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(bank_record.electronic_receipt_no), NFKC), '[^[:alnum:]]+', '', 'g')) = $1
         AND bank_record.record_date = $2 AND bank_record.amount = $3::numeric
         AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(bank_record.payer_account), NFKC), '[^[:alnum:]]+', '', 'g')) = $4
         AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(bank_record.payee_account), NFKC), '[^[:alnum:]]+', '', 'g')) = $5 LIMIT 1`,
        [
          normalizeFinancialBankIdentifier(bank.electronicReceiptNo),
          bank.date,
          bank.amount,
          normalizeFinancialBankIdentifier(bank.payerAccount),
          normalizeFinancialBankIdentifier(bank.payeeAccount),
        ],
      );
      if (legacy.rows[0])
        throw new ContractDomainError(
          409,
          "该银行回单业务已存在历史记录，禁止重复录入",
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
    }

    const registrationId = nanoid();
    const invoiceRecordIds = invoiceDocuments.map(() => nanoid());
    const settlementRecordIds = bankDocuments.map(() => nanoid());
    const now = new Date().toISOString();
    const note = normalizeNullableText(clientValues.note);
    await lockInvoiceApplicationRoot(client, contractId);
    for (const [index, invoice] of invoiceDocuments.entries()) {
      await client.query(
        `INSERT INTO contract_invoices (
         id, contract_id, file_id, invoice_code, invoice_no, item_name,
         invoice_date, amount, tax_amount, seller, buyer, note,
         financial_ocr_job_id, status, created_by, created_at, updated_at
       ) VALUES (
         $1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$14,$14
       )`,
        [
          invoiceRecordIds[index],
          contractId,
          invoice.job.file_id,
          invoice.invoiceNumber,
          invoice.itemName,
          invoice.date,
          invoice.amount,
          invoice.taxAmount,
          invoice.seller,
          invoice.buyer,
          note,
          invoice.job.id,
          currentActor.id,
          now,
        ],
      );
      await insertContractInvoiceLineItems(
        client,
        contractId,
        invoiceRecordIds[index]!,
        invoice.lineItems,
        now,
      );
    }
    await reconcileInvoiceApplicationAllocations(client, contractId);
    for (const [index, bank] of bankDocuments.entries()) {
      if (settlementKind === "receipt")
        await client.query(
          `INSERT INTO contract_receipts (
           id, contract_id, file_id, receipt_date, payment_time, amount,
           payer, payer_account, payee, payee_account, electronic_receipt_no,
           note, financial_ocr_job_id, status, created_by, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$15,$15
         )`,
          [
            settlementRecordIds[index],
            contractId,
            bank.job.file_id,
            bank.date,
            bank.paymentTime,
            bank.amount,
            bank.payer,
            bank.payerAccount,
            bank.payee,
            bank.payeeAccount,
            bank.electronicReceiptNo,
            note,
            bank.job.id,
            currentActor.id,
            now,
          ],
        );
      else {
        const expenseCategory = "other";
        await client.query(
          `INSERT INTO contract_payments (
           id, contract_id, file_id, payment_date, payment_time, amount,
           expense_category, payer, payer_account, payee, payee_account,
           electronic_receipt_no, note, financial_ocr_job_id, status,
           created_by, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,$16,$16
         )`,
          [
            settlementRecordIds[index],
            contractId,
            bank.job.file_id,
            bank.date,
            bank.paymentTime,
            bank.amount,
            expenseCategory,
            bank.payer,
            bank.payerAccount,
            bank.payee,
            bank.payeeAccount,
            bank.electronicReceiptNo,
            note,
            bank.job.id,
            currentActor.id,
            now,
          ],
        );
      }
    }
    await client.query(
      `INSERT INTO contract_financial_registrations (
         id, contract_id, settlement_kind, financial_direction,
         direction_invoice_record_id, invoice_ocr_job_id,
         bank_ocr_job_id, invoice_record_id, receipt_record_id,
         payment_record_id, bank_business_key_hash, status, created_by,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13,$13
       )`,
      [
        registrationId,
        contractId,
        settlementKind,
        financialDirection,
        invoiceRecordIds[0] || null,
        invoiceDocuments[0]?.job.id || null,
        bankDocuments[0]?.job.id || null,
        invoiceRecordIds[0] || null,
        settlementKind === "receipt" ? settlementRecordIds[0] || null : null,
        settlementKind === "payment" ? settlementRecordIds[0] || null : null,
        bankBusinessHashes[0] || null,
        currentActor.id,
        now,
      ],
    );
    const registrationItems = [
      ...invoiceDocuments.map((document, index) => ({
        id: nanoid(),
        job: document.job,
        recordId: invoiceRecordIds[index],
        kind: "invoice" as const,
        hash: null,
      })),
      ...bankDocuments.map((document, index) => ({
        id: nanoid(),
        job: document.job,
        recordId: settlementRecordIds[index],
        kind: settlementKind,
        hash: bankBusinessHashes[index],
      })),
    ];
    for (const item of registrationItems) {
      await client.query(
        `INSERT INTO contract_financial_registration_items (
           id, registration_id, contract_id, item_kind, ocr_job_id,
           record_id, business_key_hash, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          item.id,
          registrationId,
          contractId,
          item.kind,
          item.job.id,
          item.recordId,
          item.hash,
          now,
        ],
      );
      await client.query(
        `UPDATE contract_financial_ocr_jobs
         SET status = 'consumed', record_id = $2, consumed_at = $3,
           updated_at = $3
         WHERE id = $1 AND status = 'verified' AND record_id IS NULL`,
        [item.job.id, item.recordId, now],
      );
    }
    const invoiceItems = registrationItems.filter(
      (item) => item.kind === "invoice",
    );
    const settlementItems = registrationItems.filter(
      (item) => item.kind === settlementKind,
    );
    let matches: CreatedFinancialRegistration["matches"] = [];
    let registrationStatus: CreatedFinancialRegistration["status"] = "draft";
    let contractAfterSettlementPosting: ContractRow = target;
    if (allowsPendingInvoiceReceipt) {
      const rebuilt = await rebuildContractFinancialRegistrationMatches(
        client,
        {
          registrationId,
          contractId,
          settlementKind,
          now,
        },
      );
      await client.query(
        `UPDATE contract_financial_registrations
         SET direction_invoice_record_id = $2, updated_at = $3
         WHERE id = $1 AND contract_id = $4 AND status = 'draft'`,
        [registrationId, rebuilt.directionInvoiceRecordId, now, contractId],
      );
      matches = rebuilt.matches.map((match) => ({
        registrationId,
        ...match,
      }));
      if (bankDocuments.length) {
        contractAfterSettlementPosting = await postContractFinancialSettlements(
          client,
          {
            contractId,
            registrationId,
            settlementKind,
            settlementRecordIds,
            financialDirection,
            directionInvoiceRecordId: rebuilt.directionInvoiceRecordId,
            allowUnallocatedSettlement: true,
            actorId: currentActor.id,
            actorRole: currentActor.role,
            now,
          },
        );
      }
      if (financialRegistrationAmountsAreClosed(rebuilt)) {
        contractAfterSettlementPosting =
          await confirmContractFinancialRegistrationInTransaction(
            client,
            registrationId,
            currentActor.id,
            currentActor.role,
            contractId,
          );
        registrationStatus = "confirmed";
      }
    } else {
      const amountAllocations = bankDocuments.length
        ? bankTotalCents === invoiceTotalCents
          ? allocateContractFinancialAmounts(
              invoiceDocuments.map((item) => item.amount),
              bankDocuments.map((item) => item.amount),
            )
          : allocatePartialContractFinancialAmounts(
              invoiceDocuments.map((item) => item.amount),
              bankDocuments.map((item) => item.amount),
            )
        : [];
      matches = amountAllocations.map((allocation) => ({
        registrationId,
        invoiceRecordId: invoiceRecordIds[allocation.invoiceIndex]!,
        settlementRecordId: settlementRecordIds[allocation.settlementIndex]!,
        allocatedAmount: allocation.allocatedAmount,
      }));
      for (const allocation of amountAllocations) {
        await client.query(
          `INSERT INTO contract_financial_registration_matches (
             id, registration_id, contract_id, invoice_item_id,
             settlement_item_id, allocated_amount, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            nanoid(),
            registrationId,
            contractId,
            invoiceItems[allocation.invoiceIndex]!.id,
            settlementItems[allocation.settlementIndex]!.id,
            allocation.allocatedAmount,
            now,
          ],
        );
      }
      if (bankDocuments.length) {
        contractAfterSettlementPosting = await postContractFinancialSettlements(
          client,
          {
            contractId,
            registrationId,
            settlementKind,
            settlementRecordIds,
            financialDirection,
            directionInvoiceRecordId: invoiceRecordIds[0]!,
            actorId: currentActor.id,
            actorRole: currentActor.role,
            now,
          },
        );
      }
    }
    await client.query(
      `INSERT INTO contract_audit_logs (
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) VALUES ($1,$2,'financial_registration_created',$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        nanoid(),
        contractId,
        currentActor.id,
        currentActor.role,
        target.status,
        contractAfterSettlementPosting.status,
        JSON.stringify({
          registrationId,
          settlementKind,
          financialDirection,
          invoiceRecordIds,
          settlementRecordIds,
          invoiceOcrJobIds: invoiceDocuments.map((item) => item.job.id),
          bankOcrJobIds: bankDocuments.map((item) => item.job.id),
          invoiceTotalAmount: centsToAmount(invoiceTotalCents),
          bankTotalAmount: centsToAmount(bankTotalCents),
          currentInvoiceAmount: centsToAmount(invoiceTotalCents),
          currentSettlementAmount: centsToAmount(bankTotalCents),
          cumulativeInvoiceAmount: centsToAmount(invoiceTotalCents),
          cumulativeSettlementAmount: centsToAmount(bankTotalCents),
          remainingSettlementAmount: centsToAmount(
            Math.max(0, invoiceTotalCents - bankTotalCents),
          ),
          remainingInvoiceAmount: centsToAmount(
            Math.max(0, bankTotalCents - invoiceTotalCents),
          ),
          immediateSettlementPosted: bankDocuments.length > 0,
          registrationConfirmed: registrationStatus === "confirmed",
          contractStatusAfterSettlementPosting:
            contractAfterSettlementPosting.status,
          matches,
          source: "server_verified_financial_registration",
        }),
        now,
      ],
    );
    return {
      registrationId,
      invoiceRecordIds,
      settlementRecordIds,
      invoiceRecordId: invoiceRecordIds[0] || null,
      settlementRecordId: settlementRecordIds[0] || null,
      matches,
      status: registrationStatus,
    };
  });
}

async function appendFinancialRegistrationSettlementJobs(
  contractId: string,
  registrationId: string,
  invoiceJobIds: string[],
  bankJobIds: string[],
  clientValues: Record<string, unknown>,
  currentActor: { id: string; role: string },
): Promise<CreatedFinancialRegistration> {
  const submittedInvoiceJobIds = invoiceJobIds.filter(Boolean);
  const uniqueInvoiceJobIds = [...new Set(submittedInvoiceJobIds)];
  const uniqueBankJobIds = [...new Set(bankJobIds.filter(Boolean))];
  if (uniqueInvoiceJobIds.length !== submittedInvoiceJobIds.length) {
    throw new ContractDomainError(
      409,
      "本次补充重复提交了同一发票识别任务",
      "DUPLICATE_CONTRACT_INVOICE",
    );
  }
  if (!uniqueInvoiceJobIds.length && !uniqueBankJobIds.length) {
    throw new ContractDomainError(400, "必须至少提交一张发票或银行回单");
  }
  if (uniqueInvoiceJobIds.some((id) => uniqueBankJobIds.includes(id))) {
    throw new ContractDomainError(
      400,
      "发票和银行回单不能使用同一个识别任务",
      "FINANCIAL_REGISTRATION_JOB_MISMATCH",
    );
  }
  return db.transaction(async (client) => {
    await lockInvoiceApplicationRootByFinancialSource(
      client,
      "registration",
      registrationId,
    );
    const registrationResult = await client.query<{
      id: string;
      contract_id: string;
      status: string;
      bank_ocr_job_id: string | null;
      settlement_kind: "receipt" | "payment";
      financial_direction: "income" | "cost" | null;
      direction_invoice_record_id: string | null;
    }>(
      `SELECT id, contract_id, status, bank_ocr_job_id, settlement_kind,
          financial_direction, direction_invoice_record_id
       FROM contract_financial_registrations WHERE id = $1 FOR UPDATE`,
      [registrationId],
    );
    const registration = registrationResult.rows[0];
    if (!registration || registration.contract_id !== contractId) {
      throw new ContractDomainError(404, "待回款财务登记不存在");
    }
    if (registration.status !== "draft") {
      throw new ContractDomainError(
        409,
        "该财务登记不再是草稿，不能补充回单",
        "FINANCIAL_REGISTRATION_SETTLEMENT_EXISTS",
      );
    }
    // 根合同事务锁已先取得；随后统一按登记行、合同／凭证行顺序加锁。
    const target = await lockFinancialContract(
      client,
      contractId,
      "invoice",
      registration.financial_direction === "income" &&
        registration.settlement_kind === "receipt",
    );
    const allowsAssetInvoiceBackfill =
      target.category === "asset" &&
      target.asset_funding_mode === "engineering_to_technology" &&
      registration.financial_direction === "cost" &&
      uniqueInvoiceJobIds.length > 0;
    const allowsPendingInvoiceReceipt =
      target.category === "main_business" &&
      registration.financial_direction === "income" &&
      registration.settlement_kind === "receipt";
    const allowsEngineeringInternalFundingAppend =
      target.category === "asset" &&
      target.asset_funding_mode === "engineering_to_technology" &&
      registration.financial_direction === "cost" &&
      registration.settlement_kind === "payment" &&
      uniqueBankJobIds.length > 0;
    if (
      !registration.financial_direction ||
      (!registration.direction_invoice_record_id &&
        !allowsAssetInvoiceBackfill &&
        !allowsPendingInvoiceReceipt &&
        !allowsEngineeringInternalFundingAppend)
    ) {
      throw new ContractDomainError(
        409,
        "该历史财务登记缺少发票方向，请重新核对后登记",
        "FINANCIAL_DIRECTION_UNCONFIRMED",
      );
    }
    const settlementKind = registration.settlement_kind;
    const expectedInvoiceDirection: "input" | "output" =
      registration.financial_direction === "income" ? "output" : "input";
    assertFinancialKindAllowed(target, settlementKind);
    if (
      target.financial_direction &&
      target.financial_direction !== registration.financial_direction
    ) {
      throw new ContractDomainError(
        409,
        "待补充登记方向与合同类型规定的收支方向不一致",
        "FINANCIAL_DIRECTION_CONFLICT",
      );
    }
    const invoiceRows = await client.query<{
      item_id: string;
      record_id: string;
      amount: number;
      buyer: string;
      seller: string;
    }>(
      `SELECT item.id AS item_id, invoice.id AS record_id,
          invoice.amount, invoice.buyer, invoice.seller
       FROM contract_financial_registration_items item
       JOIN contract_invoices invoice ON invoice.id = item.record_id
       WHERE item.registration_id = $1 AND item.item_kind = 'invoice'
       ORDER BY item.created_at, item.id FOR UPDATE OF invoice`,
      [registrationId],
    );
    if (
      !invoiceRows.rows.length &&
      !allowsAssetInvoiceBackfill &&
      !allowsPendingInvoiceReceipt &&
      !allowsEngineeringInternalFundingAppend
    ) {
      throw new ContractDomainError(500, "待回款登记缺少发票明细");
    }
    const existingAllocationResult = await client.query<{
      invoice_item_id: string;
      allocated_amount: string | number;
    }>(
      `SELECT invoice_item_id,
          COALESCE(SUM(allocated_amount), 0)::text AS allocated_amount
       FROM contract_financial_registration_matches
       WHERE registration_id = $1
       GROUP BY invoice_item_id`,
      [registrationId],
    );
    const existingAllocatedByInvoiceItemId = new Map(
      existingAllocationResult.rows.map((row) => [
        row.invoice_item_id,
        toCents(String(row.allocated_amount)),
      ]),
    );
    const existingInvoiceItemIds = new Set(
      invoiceRows.rows.map((invoice) => invoice.item_id),
    );
    if (
      existingAllocationResult.rows.some(
        (row) => !existingInvoiceItemIds.has(row.invoice_item_id),
      )
    ) {
      throw new ContractDomainError(
        500,
        "待回款登记存在不属于当前登记发票的对应金额，请先核查登记数据",
        "FINANCIAL_REGISTRATION_INTEGRITY_ERROR",
      );
    }
    let existingAllocatedTotalCents = 0;
    for (const invoice of invoiceRows.rows) {
      const invoiceAmountCents = toCents(String(invoice.amount));
      const allocatedCents =
        existingAllocatedByInvoiceItemId.get(invoice.item_id) || 0;
      if (allocatedCents < 0 || allocatedCents > invoiceAmountCents) {
        throw new ContractDomainError(
          500,
          "待回款登记已有对应金额超过发票金额，请先核查登记数据",
          "FINANCIAL_REGISTRATION_INTEGRITY_ERROR",
        );
      }
      existingAllocatedTotalCents += allocatedCents;
    }
    const allJobIds = [...uniqueInvoiceJobIds, ...uniqueBankJobIds].sort();
    const jobs = await client.query<StoredFinancialOcrJob>(
      `SELECT * FROM contract_financial_ocr_jobs
       WHERE id = ANY($1::text[]) AND contract_id = $2
         AND business_purpose IS NULL
       ORDER BY id ASC FOR UPDATE`,
      [allJobIds, contractId],
    );
    const jobsById = new Map(jobs.rows.map((job) => [job.id, job]));
    const invoiceJobs = uniqueInvoiceJobIds.map((id) => {
      const job = jobsById.get(id);
      assertVerifiedFinancialRegistrationJob(
        job,
        "invoice",
        expectedInvoiceDirection,
      );
      return job;
    });
    const bankJobs = uniqueBankJobIds.map((id) => {
      const job = jobsById.get(id);
      assertVerifiedFinancialRegistrationJob(
        job,
        settlementKind,
        settlementKind,
      );
      return job;
    });
    const invoiceDocuments = invoiceJobs.map((job) => {
      const values = job.snapshot_json?.fields as unknown as Record<
        string,
        unknown
      >;
      const document = {
        job,
        invoiceNumber: normalizeFinancialDisplayValue(values?.invoiceNumber),
        itemName: normalizeFinancialDisplayValue(values?.itemName),
        seller: normalizeFinancialDisplayValue(values?.seller),
        buyer: normalizeFinancialDisplayValue(values?.buyer),
        date: normalizeDate(values?.invoiceDate, "开票日期"),
        amount: parsePositiveAmount(values?.amount, "发票金额"),
        taxAmount: parseVerifiedInvoiceTaxAmount(
          values?.taxAmount,
          isVehicleRentalContract(target),
        ),
        lineItems: parseContractInvoiceLineItems(
          values?.lineItems,
          parsePositiveAmount(values?.amount, "发票金额"),
          requiresHouseRentalInvoiceLines(target),
        ),
      };
      if (
        !document.invoiceNumber ||
        !document.itemName ||
        !document.seller ||
        !document.buyer
      ) {
        throw new ContractDomainError(
          422,
          "发票识别快照缺少本次登记必需字段",
          "FINANCIAL_OCR_SNAPSHOT_INVALID",
        );
      }
      if (document.taxAmount !== null && document.taxAmount > document.amount) {
        throw new ContractDomainError(422, "识别税额不能大于发票金额");
      }
      return document as typeof document & {
        invoiceNumber: string;
        itemName: string;
        seller: string;
        buyer: string;
      };
    });
    const bankDocuments = bankJobs.map((job) => {
      const values = job.snapshot_json?.fields as unknown as Record<
        string,
        unknown
      >;
      const paymentTime = normalizeFinancialPaymentTime(values?.paymentTime);
      const document = {
        job,
        payer: normalizeFinancialDisplayValue(values?.payer),
        payerAccount: normalizeFinancialDisplayValue(values?.payerAccount),
        payee: normalizeFinancialDisplayValue(values?.payee),
        payeeAccount: normalizeFinancialDisplayValue(values?.payeeAccount),
        electronicReceiptNo: normalizeFinancialDisplayValue(
          values?.electronicReceiptNo,
        ),
        paymentTime,
        date: paymentTime.slice(0, 10),
        amount: parsePositiveAmount(values?.amount, "回单金额"),
      };
      if (
        !document.payer ||
        !document.payerAccount ||
        !document.payee ||
        !document.payeeAccount ||
        !document.electronicReceiptNo
      ) {
        throw new ContractDomainError(
          422,
          "银行回单识别快照缺少本次登记必需字段",
        );
      }
      return document as typeof document & {
        payer: string;
        payerAccount: string;
        payee: string;
        payeeAccount: string;
        electronicReceiptNo: string;
      };
    });
    const allInvoiceRows = [
      ...invoiceRows.rows,
      ...invoiceDocuments.map((invoice) => ({
        item_id: "",
        record_id: "",
        amount: invoice.amount,
        buyer: invoice.buyer,
        seller: invoice.seller,
      })),
    ];
    const existingSettlementTable =
      settlementKind === "receipt" ? "contract_receipts" : "contract_payments";
    const existingBankRows = await client.query<{
      payer: string | null;
      payer_account: string | null;
      payee: string | null;
      payee_account: string | null;
      amount: string | number;
    }>(
      `SELECT record.payer, record.payer_account, record.payee,
          record.payee_account, record.amount
       FROM contract_financial_registration_items item
       JOIN ${existingSettlementTable} record ON record.id = item.record_id
       WHERE item.registration_id = $1 AND item.item_kind = $2
         AND record.status <> 'reversed'
       ORDER BY item.created_at, item.id
       FOR UPDATE OF item, record`,
      [registrationId, settlementKind],
    );
    const allBankPartyRows = [
      ...existingBankRows.rows.map((bank) => ({
        payer: bank.payer || "",
        payerAccount: bank.payer_account || "",
        payee: bank.payee || "",
        payeeAccount: bank.payee_account || "",
        amount: Number(bank.amount),
      })),
      ...bankDocuments,
    ];
    const contractCompanySubjectName =
      resolveContractCompanySubject(target).name;
    const allInvoicePartyRows = !allInvoiceRows.length
      ? allowsEngineeringInternalFundingAppend
        ? [{ buyer: contractCompanySubjectName, seller: "" }]
        : registration.financial_direction === "income"
          ? [{ buyer: "", seller: contractCompanySubjectName }]
          : []
      : allInvoiceRows;
    for (const invoice of allInvoicePartyRows) {
      for (const bank of allBankPartyRows) {
        if (registration.financial_direction === "cost") {
          assertAssetPaymentParties(
            target.asset_funding_mode,
            invoice,
            bank,
            "expense",
            contractCompanySubjectName,
          );
        } else if (!incomeReceiptPartiesMatch(invoice, bank)) {
          throw new ContractDomainError(
            422,
            "营收登记要求发票销售方与回款回单收款人一致",
            "FINANCIAL_REGISTRATION_PARTY_MISMATCH",
          );
        }
      }
    }
    const isEngineeringInternalFundingAppend =
      allowsEngineeringInternalFundingAppend && bankDocuments.length > 0;
    const invoiceTotalCents = allInvoiceRows.reduce(
      (sum, item) => sum + toCents(String(item.amount)),
      0,
    );
    const bankTotalCents = bankDocuments.reduce(
      (sum, item) => sum + toCents(String(item.amount)),
      0,
    );
    let existingInternalFundingTotalCents = 0;
    if (isEngineeringInternalFundingAppend) {
      existingInternalFundingTotalCents = existingBankRows.rows.reduce(
        (sum, item) => sum + toCents(String(item.amount)),
        0,
      );
    } else if (
      !allowsPendingInvoiceReceipt &&
      existingAllocatedTotalCents + bankTotalCents > invoiceTotalCents
    ) {
      throw new ContractDomainError(
        422,
        `累计${settlementKind === "receipt" ? "回单" : "付款凭证"}合计${centsToAmount(existingAllocatedTotalCents + bankTotalCents).toFixed(2)}元不能超过累计发票合计${centsToAmount(invoiceTotalCents).toFixed(2)}元`,
        "FINANCIAL_REGISTRATION_AMOUNT_MISMATCH",
      );
    }
    await assertContractInvoiceBusinessKeysAvailable(
      client,
      invoiceDocuments,
      "本次补充包含重复发票",
    );
    const bankKeys = new Set<string>();
    const bankReceiptNumberKeys = new Set<string>();
    const bankBusinessHashes: string[] = [];
    for (const bank of bankDocuments) {
      const receiptNumberKey = normalizeFinancialBankIdentifier(
        bank.electronicReceiptNo,
      );
      if (bankReceiptNumberKeys.has(receiptNumberKey)) {
        throw new ContractDomainError(
          409,
          `本次补充包含重复电子回单号码 ${bank.electronicReceiptNo}`,
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      }
      bankReceiptNumberKeys.add(receiptNumberKey);
      if (
        await findContractBankReceiptNumberDuplicate(
          client,
          bank.electronicReceiptNo,
          bank.job.id,
        )
      ) {
        throw new ContractDomainError(
          409,
          `电子回单号码 ${bank.electronicReceiptNo} 已上传或登记，禁止重复录入`,
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      }
      const businessHash = crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            normalizeFinancialBankIdentifier(bank.electronicReceiptNo),
            bank.paymentTime,
            toCents(String(bank.amount)),
            normalizeFinancialIdentity(bank.payer),
            normalizeFinancialBankIdentifier(bank.payerAccount),
            normalizeFinancialIdentity(bank.payee),
            normalizeFinancialBankIdentifier(bank.payeeAccount),
          ]),
        )
        .digest("hex");
      if (bankKeys.has(businessHash)) {
        throw new ContractDomainError(
          409,
          "本次补充包含重复银行回单",
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      }
      bankKeys.add(businessHash);
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('contract-bank-business:' || $1, 0))`,
        [businessHash],
      );
      const duplicate = await client.query<{ id: string }>(
        `SELECT id FROM contract_financial_registration_items
         WHERE business_key_hash = $1 LIMIT 1`,
        [businessHash],
      );
      if (duplicate.rows[0]) {
        throw new ContractDomainError(
          409,
          "该银行回单业务已登记，禁止重复录入",
        );
      }
      const legacy = await client.query<{ id: string }>(
        `SELECT id FROM (
           SELECT id, receipt_date AS record_date, amount, payer_account,
             payee_account, electronic_receipt_no FROM contract_receipts
           UNION ALL
           SELECT id, payment_date, amount, payer_account, payee_account,
             electronic_receipt_no FROM contract_payments
           UNION ALL
           SELECT id, payment_date, amount, payer_account, payee_account,
             electronic_receipt_no FROM contract_external_payments
         ) AS bank_record
         WHERE UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(bank_record.electronic_receipt_no), NFKC), '[^[:alnum:]]+', '', 'g')) = $1
         AND bank_record.record_date = $2 AND bank_record.amount = $3::numeric
         AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(bank_record.payer_account), NFKC), '[^[:alnum:]]+', '', 'g')) = $4
         AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(bank_record.payee_account), NFKC), '[^[:alnum:]]+', '', 'g')) = $5
         LIMIT 1`,
        [
          normalizeFinancialBankIdentifier(bank.electronicReceiptNo),
          bank.date,
          bank.amount,
          normalizeFinancialBankIdentifier(bank.payerAccount),
          normalizeFinancialBankIdentifier(bank.payeeAccount),
        ],
      );
      if (legacy.rows[0]) {
        throw new ContractDomainError(
          409,
          "该银行回单业务已登记，禁止重复录入",
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      }
      bankBusinessHashes.push(businessHash);
    }
    const now = new Date().toISOString();
    const note = normalizeNullableText(clientValues.note);
    const newInvoiceRecordIds = invoiceDocuments.map(() => nanoid());
    const newInvoiceItemIds = invoiceDocuments.map(() => nanoid());
    const settlementRecordIds = bankDocuments.map(() => nanoid());
    const settlementItemIds = bankDocuments.map(() => nanoid());
    for (const [index, invoice] of invoiceDocuments.entries()) {
      await client.query(
        `INSERT INTO contract_invoices (
           id, contract_id, file_id, invoice_code, invoice_no, item_name,
           invoice_date, amount, tax_amount, seller, buyer, note,
           financial_ocr_job_id, status, created_by, created_at, updated_at
         ) VALUES (
           $1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$14,$14
         )`,
        [
          newInvoiceRecordIds[index],
          contractId,
          invoice.job.file_id,
          invoice.invoiceNumber,
          invoice.itemName,
          invoice.date,
          invoice.amount,
          invoice.taxAmount,
          invoice.seller,
          invoice.buyer,
          note,
          invoice.job.id,
          currentActor.id,
          now,
        ],
      );
      await insertContractInvoiceLineItems(
        client,
        contractId,
        newInvoiceRecordIds[index]!,
        invoice.lineItems,
        now,
      );
      await client.query(
        `INSERT INTO contract_financial_registration_items (
           id, registration_id, contract_id, item_kind, ocr_job_id,
           record_id, business_key_hash, created_at
         ) VALUES ($1,$2,$3,'invoice',$4,$5,NULL,$6)`,
        [
          newInvoiceItemIds[index],
          registrationId,
          contractId,
          invoice.job.id,
          newInvoiceRecordIds[index],
          now,
        ],
      );
      await client.query(
        `UPDATE contract_financial_ocr_jobs SET status = 'consumed', record_id = $2,
           consumed_at = $3, updated_at = $3
         WHERE id = $1 AND status = 'verified' AND record_id IS NULL`,
        [invoice.job.id, newInvoiceRecordIds[index], now],
      );
    }
    if (invoiceDocuments.length) {
      await client.query(
        `UPDATE contract_financial_registrations
         SET direction_invoice_record_id = COALESCE(direction_invoice_record_id, $2),
           invoice_ocr_job_id = COALESCE(invoice_ocr_job_id, $3),
           invoice_record_id = COALESCE(invoice_record_id, $2),
           updated_at = $4
         WHERE id = $1`,
        [
          registrationId,
          newInvoiceRecordIds[0],
          invoiceDocuments[0]!.job.id,
          now,
        ],
      );
    }
    await reconcileInvoiceApplicationAllocations(client, contractId);
    for (const [index, bank] of bankDocuments.entries()) {
      if (settlementKind === "receipt") {
        await client.query(
          `INSERT INTO contract_receipts (
             id, contract_id, file_id, receipt_date, payment_time, amount,
             payer, payer_account, payee, payee_account, electronic_receipt_no,
             note, financial_ocr_job_id, status, created_by, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$15,$15)`,
          [
            settlementRecordIds[index],
            contractId,
            bank.job.file_id,
            bank.date,
            bank.paymentTime,
            bank.amount,
            bank.payer,
            bank.payerAccount,
            bank.payee,
            bank.payeeAccount,
            bank.electronicReceiptNo,
            note,
            bank.job.id,
            currentActor.id,
            now,
          ],
        );
      } else {
        const expenseCategory = "other";
        await client.query(
          `INSERT INTO contract_payments (
             id, contract_id, file_id, payment_date, payment_time, amount,
             expense_category, payer, payer_account, payee, payee_account,
             electronic_receipt_no, note, financial_ocr_job_id, status,
             created_by, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,$16,$16)`,
          [
            settlementRecordIds[index],
            contractId,
            bank.job.file_id,
            bank.date,
            bank.paymentTime,
            bank.amount,
            expenseCategory,
            bank.payer,
            bank.payerAccount,
            bank.payee,
            bank.payeeAccount,
            bank.electronicReceiptNo,
            note,
            bank.job.id,
            currentActor.id,
            now,
          ],
        );
      }
      await client.query(
        `INSERT INTO contract_financial_registration_items (
           id, registration_id, contract_id, item_kind, ocr_job_id,
           record_id, business_key_hash, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          settlementItemIds[index],
          registrationId,
          contractId,
          settlementKind,
          bank.job.id,
          settlementRecordIds[index],
          bankBusinessHashes[index],
          now,
        ],
      );
      await client.query(
        `UPDATE contract_financial_ocr_jobs SET status = 'consumed', record_id = $2,
           consumed_at = $3, updated_at = $3
         WHERE id = $1 AND status = 'verified' AND record_id IS NULL`,
        [bank.job.id, settlementRecordIds[index], now],
      );
    }
    const allocationInvoiceRows = [
      ...invoiceRows.rows,
      ...invoiceDocuments.map((invoice, index) => ({
        item_id: newInvoiceItemIds[index]!,
        record_id: newInvoiceRecordIds[index]!,
        amount: invoice.amount,
        buyer: invoice.buyer,
        seller: invoice.seller,
      })),
    ];
    let matches: CreatedFinancialRegistration["matches"] = [];
    let registrationStatus: CreatedFinancialRegistration["status"] = "draft";
    let contractAfterSettlementPosting: ContractRow = target;
    let cumulativeInvoiceCents = invoiceTotalCents;
    let cumulativeSettlementCents =
      existingAllocatedTotalCents + bankTotalCents;
    if (allowsPendingInvoiceReceipt) {
      if (bankDocuments.length) {
        await client.query(
          `UPDATE contract_financial_registrations
           SET bank_ocr_job_id = COALESCE(bank_ocr_job_id, $2),
             receipt_record_id = COALESCE(receipt_record_id, $3),
             bank_business_key_hash = COALESCE(bank_business_key_hash, $4),
             updated_at = $5 WHERE id = $1`,
          [
            registrationId,
            bankDocuments[0]!.job.id,
            settlementRecordIds[0] || null,
            bankBusinessHashes[0],
            now,
          ],
        );
      }
      const rebuilt = await rebuildContractFinancialRegistrationMatches(
        client,
        {
          registrationId,
          contractId,
          settlementKind,
          now,
        },
      );
      await client.query(
        `UPDATE contract_financial_registrations
         SET direction_invoice_record_id = $2, updated_at = $3
         WHERE id = $1 AND contract_id = $4 AND status = 'draft'`,
        [registrationId, rebuilt.directionInvoiceRecordId, now, contractId],
      );
      cumulativeInvoiceCents = rebuilt.invoiceTotalCents;
      cumulativeSettlementCents = rebuilt.settlementTotalCents;
      matches = rebuilt.matches.map((match) => ({
        registrationId,
        ...match,
      }));
      if (bankDocuments.length) {
        contractAfterSettlementPosting = await postContractFinancialSettlements(
          client,
          {
            contractId,
            registrationId,
            settlementKind,
            settlementRecordIds,
            financialDirection: registration.financial_direction,
            directionInvoiceRecordId: rebuilt.directionInvoiceRecordId,
            allowUnallocatedSettlement: true,
            actorId: currentActor.id,
            actorRole: currentActor.role,
            now,
          },
        );
      } else if (invoiceDocuments.length) {
        contractAfterSettlementPosting =
          await recalculateContractExecutionStatus(
            client,
            contractId,
            currentActor.id,
            currentActor.role,
          );
      }
      if (financialRegistrationAmountsAreClosed(rebuilt)) {
        contractAfterSettlementPosting =
          await confirmContractFinancialRegistrationInTransaction(
            client,
            registrationId,
            currentActor.id,
            currentActor.role,
            contractId,
          );
        registrationStatus = "confirmed";
      }
    } else if (isEngineeringInternalFundingAppend) {
      cumulativeSettlementCents =
        existingInternalFundingTotalCents + bankTotalCents;
      const internalDirectionInvoiceRecordId =
        registration.direction_invoice_record_id ||
        newInvoiceRecordIds[0] ||
        null;
      if (
        internalDirectionInvoiceRecordId !==
        registration.direction_invoice_record_id
      ) {
        await client.query(
          `UPDATE contract_financial_registrations
           SET direction_invoice_record_id=$2,updated_at=$3
           WHERE id=$1 AND contract_id=$4 AND status='draft'`,
          [registrationId, internalDirectionInvoiceRecordId, now, contractId],
        );
      }
      await client.query(
        `UPDATE contract_financial_registrations
         SET bank_ocr_job_id=COALESCE(bank_ocr_job_id,$2),
           payment_record_id=COALESCE(payment_record_id,$3),
           bank_business_key_hash=COALESCE(bank_business_key_hash,$4),
           updated_at=$5
         WHERE id=$1 AND contract_id=$6 AND status='draft'`,
        [
          registrationId,
          bankDocuments[0]!.job.id,
          settlementRecordIds[0]!,
          bankBusinessHashes[0],
          now,
          contractId,
        ],
      );
      if (invoiceDocuments.length) {
        const externalItem = await client.query<{ record_id: string }>(
          `SELECT record_id FROM contract_financial_registration_items
           WHERE registration_id=$1 AND contract_id=$2
             AND item_kind='external_payment'
           ORDER BY created_at,id LIMIT 1`,
          [registrationId, contractId],
        );
        if (externalItem.rows[0]) {
          const externalTarget = await lockDepositPaymentTarget(
            client,
            contractId,
            externalItem.rows[0].record_id,
          );
          await rebuildDepositAffectedFinancialMatches(
            client,
            contractId,
            externalTarget,
            now,
          );
          const externalMatches = await client.query<{
            invoice_record_id: string;
            settlement_record_id: string;
            allocated_amount: string | number;
          }>(
            `SELECT invoice_item.record_id AS invoice_record_id,
               settlement_item.record_id AS settlement_record_id,
               match.allocated_amount
             FROM contract_financial_registration_matches match
             JOIN contract_financial_registration_items invoice_item
               ON invoice_item.id=match.invoice_item_id
              AND invoice_item.item_kind='invoice'
             JOIN contract_financial_registration_items settlement_item
               ON settlement_item.id=match.settlement_item_id
              AND settlement_item.item_kind='external_payment'
             WHERE match.registration_id=$1
               AND invoice_item.record_id=ANY($2::text[])
             ORDER BY match.created_at,match.id`,
            [registrationId, newInvoiceRecordIds],
          );
          matches = externalMatches.rows.map((match) => ({
            registrationId,
            invoiceRecordId: match.invoice_record_id,
            settlementRecordId: match.settlement_record_id,
            allocatedAmount: Number(match.allocated_amount),
          }));
        }
      }
      contractAfterSettlementPosting = await postContractFinancialSettlements(
        client,
        {
          contractId,
          registrationId,
          settlementKind: "payment",
          settlementRecordIds,
          financialDirection: "cost",
          directionInvoiceRecordId: internalDirectionInvoiceRecordId,
          allowUnallocatedSettlement: true,
          actorId: currentActor.id,
          actorRole: currentActor.role,
          now,
        },
      );
    } else {
      if (invoiceDocuments.length) {
        const externalItems = await client.query<{
          item_id: string;
          amount: string | number;
        }>(
          `SELECT item.id AS item_id, payment.amount
           FROM contract_financial_registration_items item
           JOIN contract_external_payments payment ON payment.id = item.record_id
           WHERE item.registration_id = $1
             AND item.item_kind = 'external_payment'
             AND payment.status <> 'reversed'
           ORDER BY item.created_at, item.id
           FOR UPDATE OF item, payment`,
          [registrationId],
        );
        if (externalItems.rows.length) {
          await client.query(
            `UPDATE contract_invoices
             SET status = 'confirmed', confirmed_by = COALESCE(confirmed_by, $2),
               confirmed_at = COALESCE(confirmed_at, $3), updated_at = $3
             WHERE id = ANY($1::text[]) AND status = 'draft'`,
            [newInvoiceRecordIds, currentActor.id, now],
          );
          await client.query(
            `DELETE FROM contract_financial_registration_matches match
             USING contract_financial_registration_items settlement
             WHERE match.registration_id = $1
               AND settlement.id = match.settlement_item_id
               AND settlement.item_kind = 'external_payment'`,
            [registrationId],
          );
          const externalAllocations =
            allocateAdditionalContractFinancialAmounts(
              allocationInvoiceRows.map((item) => Number(item.amount)),
              allocationInvoiceRows.map(() => 0),
              externalItems.rows.map((item) => Number(item.amount)),
            );
          for (const allocation of externalAllocations) {
            await client.query(
              `INSERT INTO contract_financial_registration_matches (
                 id, registration_id, contract_id, invoice_item_id,
                 settlement_item_id, allocated_amount, created_at
               ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [
                nanoid(),
                registrationId,
                contractId,
                allocationInvoiceRows[allocation.invoiceIndex]!.item_id,
                externalItems.rows[allocation.settlementIndex]!.item_id,
                allocation.allocatedAmount,
                now,
              ],
            );
          }
        }
      }
      const allocations = allocateAdditionalContractFinancialAmounts(
        allocationInvoiceRows.map((item) => Number(item.amount)),
        allocationInvoiceRows.map((item) =>
          item.item_id
            ? centsToAmount(
                existingAllocatedByInvoiceItemId.get(item.item_id) || 0,
              )
            : 0,
        ),
        bankDocuments.map((item) => item.amount),
      );
      matches = allocations.map((allocation) => ({
        registrationId,
        invoiceRecordId:
          allocationInvoiceRows[allocation.invoiceIndex]!.record_id,
        settlementRecordId: settlementRecordIds[allocation.settlementIndex]!,
        allocatedAmount: allocation.allocatedAmount,
      }));
      for (const allocation of allocations) {
        await client.query(
          `INSERT INTO contract_financial_registration_matches (
             id, registration_id, contract_id, invoice_item_id,
             settlement_item_id, allocated_amount, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            nanoid(),
            registrationId,
            contractId,
            allocationInvoiceRows[allocation.invoiceIndex]!.item_id,
            settlementItemIds[allocation.settlementIndex],
            allocation.allocatedAmount,
            now,
          ],
        );
      }
      if (bankDocuments.length) {
        await client.query(
          `UPDATE contract_financial_registrations
           SET bank_ocr_job_id = COALESCE(bank_ocr_job_id, $2),
             receipt_record_id = COALESCE(receipt_record_id, $3),
             payment_record_id = COALESCE(payment_record_id, $4),
             bank_business_key_hash = COALESCE(bank_business_key_hash, $5),
             updated_at = $6 WHERE id = $1`,
          [
            registrationId,
            bankDocuments[0]!.job.id,
            settlementKind === "receipt" ? settlementRecordIds[0] : null,
            settlementKind === "payment" ? settlementRecordIds[0] : null,
            bankBusinessHashes[0],
            now,
          ],
        );
        contractAfterSettlementPosting = await postContractFinancialSettlements(
          client,
          {
            contractId,
            registrationId,
            settlementKind,
            settlementRecordIds,
            financialDirection: registration.financial_direction,
            directionInvoiceRecordId:
              registration.direction_invoice_record_id ||
              newInvoiceRecordIds[0]!,
            actorId: currentActor.id,
            actorRole: currentActor.role,
            now,
          },
        );
      } else if (invoiceDocuments.length) {
        contractAfterSettlementPosting =
          await recalculateContractExecutionStatus(
            client,
            contractId,
            currentActor.id,
            currentActor.role,
          );
      }
    }
    await client.query(
      `INSERT INTO contract_audit_logs (
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) VALUES ($1,$2,'financial_registration_settlements_added',$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        nanoid(),
        contractId,
        currentActor.id,
        currentActor.role,
        target.status,
        contractAfterSettlementPosting.status,
        JSON.stringify({
          registrationId,
          invoiceOcrJobIds: invoiceDocuments.map((item) => item.job.id),
          newInvoiceRecordIds,
          settlementRecordIds,
          currentInvoiceAmount: centsToAmount(
            invoiceDocuments.reduce(
              (sum, item) => sum + toCents(String(item.amount)),
              0,
            ),
          ),
          currentSettlementAmount: centsToAmount(bankTotalCents),
          cumulativeInvoiceAmount: centsToAmount(cumulativeInvoiceCents),
          cumulativeSettlementAmount: centsToAmount(cumulativeSettlementCents),
          internalFundingChainSeparated: isEngineeringInternalFundingAppend,
          existingInternalFundingAmount: isEngineeringInternalFundingAppend
            ? centsToAmount(existingInternalFundingTotalCents)
            : null,
          internalFundingMatchesCreated: isEngineeringInternalFundingAppend
            ? false
            : null,
          remainingSettlementAmount: centsToAmount(
            Math.max(0, cumulativeInvoiceCents - cumulativeSettlementCents),
          ),
          remainingInvoiceAmount: centsToAmount(
            Math.max(0, cumulativeSettlementCents - cumulativeInvoiceCents),
          ),
          immediateSettlementPosted: bankDocuments.length > 0,
          registrationConfirmed: registrationStatus === "confirmed",
          contractStatusAfterSettlementPosting:
            contractAfterSettlementPosting.status,
          matches,
        }),
        now,
      ],
    );
    return {
      registrationId,
      invoiceRecordIds: allocationInvoiceRows.map((item) => item.record_id),
      settlementRecordIds,
      invoiceRecordId: allocationInvoiceRows[0]?.record_id || null,
      settlementRecordId: settlementRecordIds[0] || null,
      matches,
      status: registrationStatus,
    };
  });
}

async function appendExternalPaymentJobs(
  contractId: string,
  registrationId: string,
  bankJobIds: string[],
  clientValues: Record<string, unknown>,
  currentActor: { id: string; role: string },
): Promise<CreatedFinancialRegistration> {
  const uniqueBankJobIds = [...new Set(bankJobIds.filter(Boolean))];
  if (!uniqueBankJobIds.length) {
    throw new ContractDomainError(400, "必须至少提交一张签约公司对外付款回单");
  }
  return db.transaction(async (client) => {
    const registrationResult = await client.query<{
      id: string;
      contract_id: string;
      status: string;
      financial_direction: "income" | "cost" | null;
    }>(
      `SELECT id, contract_id, status, financial_direction
       FROM contract_financial_registrations WHERE id = $1 FOR UPDATE`,
      [registrationId],
    );
    const registration = registrationResult.rows[0];
    if (!registration || registration.contract_id !== contractId) {
      throw new ContractDomainError(404, "财务登记不存在");
    }
    if (registration.status !== "draft") {
      throw new ContractDomainError(409, "只能向未闭环的财务登记补充对外付款");
    }
    const target = await lockFinancialContract(client, contractId, "payment");
    if (
      target.category !== "asset" ||
      target.asset_funding_mode !== "engineering_to_technology"
    ) {
      throw new ContractDomainError(
        409,
        "只有工程咨询向实际签约公司内部划拨的模式需要单独补充最终对外付款",
        "EXTERNAL_PAYMENT_NOT_REQUIRED",
      );
    }
    const invoiceRows = await client.query<{
      item_id: string;
      record_id: string;
      amount: string | number;
      buyer: string;
      seller: string;
    }>(
      `SELECT item.id AS item_id, invoice.id AS record_id,
         invoice.amount, invoice.buyer, invoice.seller
       FROM contract_financial_registration_items item
       JOIN contract_invoices invoice ON invoice.id = item.record_id
       WHERE item.registration_id = $1 AND item.item_kind = 'invoice'
       ORDER BY item.created_at, item.id
       FOR UPDATE OF item, invoice`,
      [registration.id],
    );
    const jobs = await client.query<StoredFinancialOcrJob>(
      `SELECT * FROM contract_financial_ocr_jobs
       WHERE id = ANY($1::text[]) AND contract_id = $2
         AND business_purpose IS NULL
       ORDER BY id FOR UPDATE`,
      [uniqueBankJobIds, contractId],
    );
    const jobsById = new Map(jobs.rows.map((job) => [job.id, job]));
    const bankJobs = uniqueBankJobIds.map((id) => {
      const job = jobsById.get(id);
      assertVerifiedFinancialRegistrationJob(job, "payment", "payment");
      return job;
    });
    const bankDocuments = bankJobs.map((job) => {
      const values = job.snapshot_json?.fields as unknown as Record<
        string,
        unknown
      >;
      const paymentTime = normalizeFinancialPaymentTime(values?.paymentTime);
      const document = {
        job,
        payer: normalizeFinancialDisplayValue(values?.payer),
        payerAccount: normalizeFinancialDisplayValue(values?.payerAccount),
        payee: normalizeFinancialDisplayValue(values?.payee),
        payeeAccount: normalizeFinancialDisplayValue(values?.payeeAccount),
        electronicReceiptNo: normalizeFinancialDisplayValue(
          values?.electronicReceiptNo,
        ),
        paymentTime,
        date: paymentTime.slice(0, 10),
        amount: parsePositiveAmount(values?.amount, "对外付款金额"),
      };
      if (
        !document.payer ||
        !document.payerAccount ||
        !document.payee ||
        !document.payeeAccount ||
        !document.electronicReceiptNo
      ) {
        throw new ContractDomainError(422, "对外付款回单识别快照缺少必需字段");
      }
      return document as typeof document & {
        payer: string;
        payerAccount: string;
        payee: string;
        payeeAccount: string;
        electronicReceiptNo: string;
      };
    });
    const contractSubject = resolveContractCompanySubject(target);
    const normalizedSubject = normalizeFinancialIdentity(contractSubject.name);
    const contractCounterparty = [target.party_a, target.party_b]
      .map((party) => normalizeFinancialDisplayValue(party))
      .find(
        (party) =>
          party && normalizeFinancialIdentity(party) !== normalizedSubject,
      );
    if (!contractCounterparty) {
      throw new ContractDomainError(
        409,
        "合同对方主体不明确，不能保存签约公司对外付款",
        "FINANCIAL_CONTRACT_SUBJECT_NOT_UNIQUE",
      );
    }
    const partyValidationInvoices = invoiceRows.rows.length
      ? invoiceRows.rows
      : [{ buyer: contractSubject.name, seller: contractCounterparty }];
    for (const invoice of partyValidationInvoices) {
      for (const bank of bankDocuments) {
        assertAssetPaymentParties(
          target.asset_funding_mode,
          invoice,
          bank,
          "external_settlement",
        );
      }
    }
    const newExternalCents = bankDocuments.reduce(
      (sum, bank) => sum + toCents(String(bank.amount)),
      0,
    );
    const expenseCategory = "other";
    const bankBusinessHashes: string[] = [];
    const bankReceiptNumberKeys = new Set<string>();
    for (const bank of bankDocuments) {
      const receiptNumberKey = normalizeFinancialBankIdentifier(
        bank.electronicReceiptNo,
      );
      if (bankReceiptNumberKeys.has(receiptNumberKey)) {
        throw new ContractDomainError(
          409,
          `本次补充包含重复电子回单号码 ${bank.electronicReceiptNo}`,
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      }
      bankReceiptNumberKeys.add(receiptNumberKey);
      if (
        await findContractBankReceiptNumberDuplicate(
          client,
          bank.electronicReceiptNo,
          bank.job.id,
        )
      ) {
        throw new ContractDomainError(
          409,
          `电子回单号码 ${bank.electronicReceiptNo} 已上传或登记，禁止重复录入`,
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      }
      const businessHash = crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            normalizeFinancialBankIdentifier(bank.electronicReceiptNo),
            bank.paymentTime,
            toCents(String(bank.amount)),
            normalizeFinancialIdentity(bank.payer),
            normalizeFinancialBankIdentifier(bank.payerAccount),
            normalizeFinancialIdentity(bank.payee),
            normalizeFinancialBankIdentifier(bank.payeeAccount),
          ]),
        )
        .digest("hex");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('contract-bank-business:' || $1, 0))`,
        [businessHash],
      );
      const duplicate = await client.query<{ id: string }>(
        `SELECT id FROM contract_financial_registration_items
         WHERE business_key_hash = $1 LIMIT 1`,
        [businessHash],
      );
      if (duplicate.rows[0]) {
        throw new ContractDomainError(
          409,
          "该对外付款回单已登记",
          "DUPLICATE_CONTRACT_BANK_DOCUMENT",
        );
      }
      bankBusinessHashes.push(businessHash);
    }
    const existingAllocated = new Map<string, number>();
    const existingMatches = await client.query<{
      invoice_item_id: string;
      allocated_amount: string | number;
    }>(
      `SELECT match.invoice_item_id, match.allocated_amount
       FROM contract_financial_registration_matches match
       JOIN contract_financial_registration_items settlement
         ON settlement.id = match.settlement_item_id
        AND settlement.item_kind = 'external_payment'
       WHERE match.registration_id = $1`,
      [registration.id],
    );
    for (const match of existingMatches.rows) {
      existingAllocated.set(
        match.invoice_item_id,
        (existingAllocated.get(match.invoice_item_id) || 0) +
          toCents(match.allocated_amount),
      );
    }
    let remainingInvoiceCents = invoiceRows.rows.reduce(
      (sum, invoice) =>
        sum +
        Math.max(
          0,
          toCents(String(invoice.amount)) -
            (existingAllocated.get(invoice.item_id) || 0),
        ),
      0,
    );
    const allocatableBankDocuments = bankDocuments
      .map((bank, originalIndex) => {
        const allocatableCents = Math.min(
          remainingInvoiceCents,
          toCents(String(bank.amount)),
        );
        remainingInvoiceCents -= allocatableCents;
        return {
          originalIndex,
          amount: centsToAmount(allocatableCents),
        };
      })
      .filter((bank) => bank.amount > 0);
    const allocations =
      invoiceRows.rows.length && allocatableBankDocuments.length
        ? allocateAdditionalContractFinancialAmounts(
            invoiceRows.rows.map((invoice) => Number(invoice.amount)),
            invoiceRows.rows.map((invoice) =>
              centsToAmount(existingAllocated.get(invoice.item_id) || 0),
            ),
            allocatableBankDocuments.map((bank) => bank.amount),
          ).map((allocation) => ({
            ...allocation,
            settlementIndex:
              allocatableBankDocuments[allocation.settlementIndex]!
                .originalIndex,
          }))
        : [];
    const recordIds = bankDocuments.map(() => nanoid());
    const itemIds = bankDocuments.map(() => nanoid());
    const now = new Date().toISOString();
    const note = normalizeNullableText(clientValues.note);
    for (const [index, bank] of bankDocuments.entries()) {
      await client.query(
        `INSERT INTO contract_external_payments (
           id, contract_id, file_id, payment_date, payment_time, amount,
           expense_category, payer, payer_account, payee, payee_account,
           electronic_receipt_no, note, financial_ocr_job_id, status,
           created_by, confirmed_by, confirmed_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'confirmed',
           $15,$15,$16,$16,$16
         )`,
        [
          recordIds[index],
          contractId,
          bank.job.file_id,
          bank.date,
          bank.paymentTime,
          bank.amount,
          expenseCategory,
          bank.payer,
          bank.payerAccount,
          bank.payee,
          bank.payeeAccount,
          bank.electronicReceiptNo,
          note,
          bank.job.id,
          currentActor.id,
          now,
        ],
      );
      await client.query(
        `INSERT INTO contract_financial_registration_items (
           id, registration_id, contract_id, item_kind, ocr_job_id,
           record_id, business_key_hash, created_at
         ) VALUES ($1,$2,$3,'external_payment',$4,$5,$6,$7)`,
        [
          itemIds[index],
          registration.id,
          contractId,
          bank.job.id,
          recordIds[index],
          bankBusinessHashes[index],
          now,
        ],
      );
      await client.query(
        `UPDATE contract_financial_ocr_jobs
         SET status = 'consumed', record_id = $2, consumed_at = $3,
           updated_at = $3
         WHERE id = $1 AND status = 'verified' AND record_id IS NULL`,
        [bank.job.id, recordIds[index], now],
      );
    }
    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO contract_financial_registration_matches (
           id, registration_id, contract_id, invoice_item_id,
           settlement_item_id, allocated_amount, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          nanoid(),
          registration.id,
          contractId,
          invoiceRows.rows[allocation.invoiceIndex]!.item_id,
          itemIds[allocation.settlementIndex],
          allocation.allocatedAmount,
          now,
        ],
      );
    }
    if (invoiceRows.rows.length) {
      await client.query(
        `UPDATE contract_invoices
         SET status = 'confirmed', confirmed_by = COALESCE(confirmed_by, $2),
           confirmed_at = COALESCE(confirmed_at, $3), updated_at = $3
         WHERE id = ANY($1::text[]) AND status = 'draft'`,
        [
          invoiceRows.rows.map((invoice) => invoice.record_id),
          currentActor.id,
          now,
        ],
      );
    }
    await client.query(
      `INSERT INTO contract_audit_logs (
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) VALUES ($1,$2,'external_payments_added',$3,$4,$5,$5,$6::jsonb,$7)`,
      [
        nanoid(),
        contractId,
        currentActor.id,
        currentActor.role,
        target.status,
        JSON.stringify({
          registrationId: registration.id,
          externalPaymentRecordIds: recordIds,
          externalPaymentOcrJobIds: bankJobs.map((job) => job.id),
          amount: centsToAmount(newExternalCents),
        }),
        now,
      ],
    );
    const updated = await recalculateContractExecutionStatus(
      client,
      contractId,
      currentActor.id,
      currentActor.role,
    );
    await syncProjectContractTotal(client, updated.project_id);
    return {
      registrationId: registration.id,
      invoiceRecordIds: invoiceRows.rows.map((invoice) => invoice.record_id),
      settlementRecordIds: recordIds,
      invoiceRecordId: invoiceRows.rows[0]?.record_id || null,
      settlementRecordId: recordIds[0]!,
      matches: allocations.map((allocation) => ({
        registrationId: registration.id,
        invoiceRecordId: invoiceRows.rows[allocation.invoiceIndex]!.record_id,
        settlementRecordId: recordIds[allocation.settlementIndex]!,
        allocatedAmount: allocation.allocatedAmount,
      })),
      status: "draft",
    };
  });
}

function parseFinancialRecordKind(value: unknown): FinancialRecordKind {
  const normalized = String(value || "").trim();
  if (
    normalized !== "invoice" &&
    normalized !== "receipt" &&
    normalized !== "payment"
  ) {
    throw new ContractDomainError(400, "财务凭证业务类型不正确");
  }
  return normalized;
}

async function assertMainContractFinancialTarget(
  contractId: string,
): Promise<void> {
  const contract = await db.get<{
    relation_type: ContractRelationType;
    is_deleted: boolean;
  }>(
    `SELECT relation_type, is_deleted
       FROM contracts
       WHERE id = ?`,
    contractId,
  );
  if (!contract || contract.is_deleted) {
    throw new ContractDomainError(404, "合同不存在");
  }
  if (contract.relation_type !== "main") {
    throw new ContractDomainError(
      409,
      "财务登记统一归集至主合同，请在所属主合同中操作",
      "FINANCIAL_REGISTRATION_MAIN_CONTRACT_ONLY",
    );
  }
}

async function findOpenFinancialRegistrationId(
  contractId: string,
): Promise<string | null> {
  const registration = await db.get<{ id: string }>(
    `SELECT id FROM contract_financial_registrations
     WHERE contract_id = ? AND status = 'draft'
     ORDER BY created_at ASC, id ASC LIMIT 1`,
    contractId,
  );
  return registration?.id || null;
}

router.post(
  "/:id/financial-ocr",
  requireFinance,
  uploadSingle,
  async (req, res) => {
    let stored = false;
    try {
      await assertMainContractFinancialTarget(req.params.id);
      const currentActor = actor(req);
      const kind = parseFinancialRecordKind(req.body.kind);
      const openRegistrationId = await findOpenFinancialRegistrationId(
        req.params.id,
      );
      const result = await recognizeAndStoreFinancialFile(
        req.params.id,
        kind,
        req.file,
        currentActor,
        () => {
          stored = true;
        },
        Boolean(openRegistrationId),
      );
      res.status(result.canCreateDraft ? 200 : 202).json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (!stored) cleanupUploadedFile(req.file);
      sendError(res, error, "财务凭证识别失败");
    }
  },
);

router.post(
  "/:id/financial-registrations",
  requireFinance,
  async (req, res) => {
    try {
      await assertMainContractFinancialTarget(req.params.id);
      const currentActor = actor(req);
      const invoiceOcrJobIds = Array.isArray(req.body.invoiceOcrJobIds)
        ? req.body.invoiceOcrJobIds.map(normalizeNullableText).filter(Boolean)
        : [normalizeNullableText(req.body.invoiceOcrJobId)].filter(Boolean);
      const bankOcrJobIds = Array.isArray(req.body.bankOcrJobIds)
        ? req.body.bankOcrJobIds.map(normalizeNullableText).filter(Boolean)
        : [normalizeNullableText(req.body.bankOcrJobId)].filter(Boolean);
      const openRegistrationId = await findOpenFinancialRegistrationId(
        req.params.id,
      );
      const result = openRegistrationId
        ? await appendFinancialRegistrationSettlementJobs(
            req.params.id,
            openRegistrationId,
            invoiceOcrJobIds as string[],
            bankOcrJobIds as string[],
            req.body as Record<string, unknown>,
            currentActor,
          )
        : await createFinancialRegistrationFromJobs(
            req.params.id,
            invoiceOcrJobIds as string[],
            bankOcrJobIds as string[],
            req.body as Record<string, unknown>,
            currentActor,
          );
      res.json({ success: true, data: result });
    } catch (error) {
      sendError(res, error, "财务登记失败");
    }
  },
);

router.post(
  "/:id/financial-registrations/:registrationId/settlements",
  requireFinance,
  async (req, res) => {
    try {
      await assertMainContractFinancialTarget(req.params.id);
      const currentActor = actor(req);
      const invoiceOcrJobIds = Array.isArray(req.body.invoiceOcrJobIds)
        ? req.body.invoiceOcrJobIds.map(normalizeNullableText).filter(Boolean)
        : [normalizeNullableText(req.body.invoiceOcrJobId)].filter(Boolean);
      const bankOcrJobIds = Array.isArray(req.body.bankOcrJobIds)
        ? req.body.bankOcrJobIds.map(normalizeNullableText).filter(Boolean)
        : [normalizeNullableText(req.body.bankOcrJobId)].filter(Boolean);
      const result = await appendFinancialRegistrationSettlementJobs(
        req.params.id,
        req.params.registrationId,
        invoiceOcrJobIds as string[],
        bankOcrJobIds as string[],
        req.body as Record<string, unknown>,
        currentActor,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      sendError(res, error, "补充银行回单失败");
    }
  },
);

router.post(
  "/:id/financial-registrations/external-payments",
  requireFinance,
  async (req, res) => {
    let registrationId = "";
    try {
      await assertMainContractFinancialTarget(req.params.id);
      const currentActor = actor(req);
      const bankOcrJobIds = Array.isArray(req.body.bankOcrJobIds)
        ? req.body.bankOcrJobIds.map(normalizeNullableText).filter(Boolean)
        : [normalizeNullableText(req.body.bankOcrJobId)].filter(Boolean);
      registrationId =
        (await findOpenFinancialRegistrationId(req.params.id)) ||
        (await createExternalPaymentRegistrationShell(
          req.params.id,
          currentActor,
        ));
      const result = await appendExternalPaymentJobs(
        req.params.id,
        registrationId,
        bankOcrJobIds as string[],
        req.body as Record<string, unknown>,
        currentActor,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      if (registrationId) {
        await db.run(
          `DELETE FROM contract_financial_registrations registration
           WHERE registration.id = ? AND NOT EXISTS (
             SELECT 1 FROM contract_financial_registration_items item
             WHERE item.registration_id = registration.id
           )`,
          registrationId,
        );
      }
      sendError(res, error, "签约公司对外付款保存失败");
    }
  },
);

router.post(
  "/:id/financial-registrations/:registrationId/external-payments",
  requireFinance,
  async (req, res) => {
    try {
      await assertMainContractFinancialTarget(req.params.id);
      const currentActor = actor(req);
      const bankOcrJobIds = Array.isArray(req.body.bankOcrJobIds)
        ? req.body.bankOcrJobIds.map(normalizeNullableText).filter(Boolean)
        : [normalizeNullableText(req.body.bankOcrJobId)].filter(Boolean);
      const result = await appendExternalPaymentJobs(
        req.params.id,
        req.params.registrationId,
        bankOcrJobIds as string[],
        req.body as Record<string, unknown>,
        currentActor,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      sendError(res, error, "补充签约公司最终对外付款失败");
    }
  },
);

type DepositPaymentKind = "payment" | "external_payment";

interface DepositPaymentTarget {
  id: string;
  contractId: string;
  kind: DepositPaymentKind;
  amount: number;
  paymentDate: string;
  payer: string | null;
  payerAccount: string | null;
  payee: string | null;
  payeeAccount: string | null;
}

interface DepositReceiptRow {
  id: string;
  contract_id: string;
  payment_record_id: string | null;
  external_payment_record_id: string | null;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  file_hash: string;
  ocr_status: "recognized" | "unrecognized" | "failed";
  recognized_amount: number | null;
  ocr_engine_version: string | null;
  ocr_text_sha256: string | null;
  ocr_evidence_json: string[] | null;
  ocr_failure_message: string | null;
  status: "pending" | "confirmed" | "voided";
  confirmed_amount: number | null;
  confirmation_source: "ocr" | "manual" | null;
  uploaded_by: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  uploaded_by_name?: string | null;
  confirmed_by_name?: string | null;
  voided_by_name?: string | null;
}

function toDepositReceiptApi(row: DepositReceiptRow) {
  const paymentKind: DepositPaymentKind = row.payment_record_id
    ? "payment"
    : "external_payment";
  return {
    id: row.id,
    contractId: row.contract_id,
    paymentRecordId:
      row.payment_record_id || row.external_payment_record_id || "",
    paymentKind,
    fileName: row.file_name,
    fileSize: Number(row.file_size),
    mimeType: row.mime_type,
    fileUrl: `/api/contracts/${row.contract_id}/financial-records/${
      row.payment_record_id || row.external_payment_record_id
    }/deposit-receipts/${row.id}/file`,
    ocrStatus: row.ocr_status,
    recognizedAmount:
      row.recognized_amount == null ? null : Number(row.recognized_amount),
    ocrEngineVersion: row.ocr_engine_version,
    ocrEvidence: row.ocr_evidence_json || [],
    ocrFailureMessage: row.ocr_failure_message,
    status: row.status,
    confirmedAmount:
      row.confirmed_amount == null ? null : Number(row.confirmed_amount),
    confirmationSource: row.confirmation_source,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name || null,
    confirmedBy: row.confirmed_by,
    confirmedByName: row.confirmed_by_name || null,
    confirmedAt: row.confirmed_at,
    voidedBy: row.voided_by,
    voidedByName: row.voided_by_name || null,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function lockDepositPaymentTarget(
  client: PoolClient,
  contractId: string,
  recordId: string,
): Promise<DepositPaymentTarget> {
  const contractResult = await client.query<{
    id: string;
    relation_type: ContractRelationType;
    category: ContractCategory | null;
  }>(
    `SELECT id, relation_type, category FROM contracts
     WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
    [contractId],
  );
  const contract = contractResult.rows[0];
  if (!contract || contract.relation_type !== "main") {
    throw new ContractDomainError(404, "资产类主合同不存在");
  }
  if (contract.category !== "asset") {
    throw new ContractDomainError(
      409,
      "押金条只允许关联资产类合同付款",
      "DEPOSIT_RECEIPT_ASSET_CONTRACT_ONLY",
    );
  }

  const payments = await client.query<{
    id: string;
    contract_id: string;
    amount: number;
    payment_date: string;
    payer: string | null;
    payer_account: string | null;
    payee: string | null;
    payee_account: string | null;
  }>(
    `SELECT payment.id, payment.contract_id, payment.amount,
         payment.payment_date,payment.payer,payment.payer_account,
         payment.payee,payment.payee_account
       FROM contract_payments payment
       JOIN contracts source ON source.id = payment.contract_id
       WHERE payment.id = $1
         AND COALESCE(source.root_contract_id, source.id) = $2
         AND source.is_deleted = FALSE
         AND payment.status = 'confirmed'
       FOR UPDATE OF payment`,
    [recordId, contractId],
  );
  const externalPayments = await client.query<{
    id: string;
    contract_id: string;
    amount: number;
    payment_date: string;
    payer: string | null;
    payer_account: string | null;
    payee: string | null;
    payee_account: string | null;
  }>(
    `SELECT payment.id, payment.contract_id, payment.amount,
         payment.payment_date,payment.payer,payment.payer_account,
         payment.payee,payment.payee_account
       FROM contract_external_payments payment
       JOIN contracts source ON source.id = payment.contract_id
       WHERE payment.id = $1
         AND COALESCE(source.root_contract_id, source.id) = $2
         AND source.is_deleted = FALSE
         AND payment.status = 'confirmed'
       FOR UPDATE OF payment`,
    [recordId, contractId],
  );
  if (payments.rows[0] && externalPayments.rows[0]) {
    throw new ContractDomainError(
      409,
      "付款记录编号存在冲突，无法安全关联押金条",
      "DEPOSIT_RECEIPT_PAYMENT_ID_CONFLICT",
    );
  }
  const payment = payments.rows[0];
  if (payment) {
    return {
      id: payment.id,
      contractId: payment.contract_id,
      kind: "payment",
      amount: Number(payment.amount),
      paymentDate: payment.payment_date,
      payer: payment.payer,
      payerAccount: payment.payer_account,
      payee: payment.payee,
      payeeAccount: payment.payee_account,
    };
  }
  const externalPayment = externalPayments.rows[0];
  if (externalPayment) {
    return {
      id: externalPayment.id,
      contractId: externalPayment.contract_id,
      kind: "external_payment",
      amount: Number(externalPayment.amount),
      paymentDate: externalPayment.payment_date,
      payer: externalPayment.payer,
      payerAccount: externalPayment.payer_account,
      payee: externalPayment.payee,
      payeeAccount: externalPayment.payee_account,
    };
  }
  throw new ContractDomainError(
    404,
    "已确认的合同付款记录不存在",
    "DEPOSIT_RECEIPT_PAYMENT_NOT_FOUND",
  );
}

interface ContractDepositRow {
  id: string;
  contract_id: string;
  amount: number;
  clause_text: string | null;
  basis: string | null;
  payment_purpose: "lease_deposit";
  funding_source: ContractDepositFundingSource;
  engineering_allocation_amount: number;
  technology_self_funded_amount: number;
  payment_record_id: string | null;
  external_payment_record_id: string | null;
  paid_at: string | null;
  note: string | null;
  status: ContractDepositStatus;
  settled_amount: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
  updated_by_name?: string | null;
}

interface ContractDepositSettlementRow {
  id: string;
  deposit_id: string;
  contract_id: string;
  settlement_type: ContractDepositSettlementType;
  amount: number;
  settlement_date: string;
  note: string | null;
  engineering_return_required_amount: number;
  engineering_returned_amount: number;
  engineering_returned_at: string | null;
  engineering_return_note: string | null;
  created_by: string;
  created_at: string;
  created_by_name?: string | null;
}

type ContractDepositSettlementReceiptKind =
  | "deposit_refund"
  | "engineering_return";

interface ContractDepositSettlementReceiptRow {
  id: string;
  settlement_id: string;
  contract_id: string;
  receipt_kind: ContractDepositSettlementReceiptKind;
  amount: number;
  transaction_date: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  file_hash: string;
  file_id: string | null;
  financial_ocr_job_id: string | null;
  electronic_receipt_no: string | null;
  payer: string | null;
  payer_account: string | null;
  payee: string | null;
  payee_account: string | null;
  recognition_method: string | null;
  ocr_engine_version: string | null;
  ocr_parser_version: string | null;
  evidence_text_hash: string | null;
  uploaded_by: string;
  created_at: string;
  uploaded_by_name?: string | null;
}

const DEPOSIT_FUNDING_SOURCES = new Set<ContractDepositFundingSource>([
  "engineering_allocation",
  "technology_self_funded",
  "mixed",
  "pending_review",
]);
const DEPOSIT_SETTLEMENT_TYPES = new Set<ContractDepositSettlementType>([
  "refund",
  "deduction",
  "rent_offset",
]);

function normalizeDepositFundingSource(
  value: unknown,
): ContractDepositFundingSource {
  const source = String(
    value || "pending_review",
  ) as ContractDepositFundingSource;
  if (!DEPOSIT_FUNDING_SOURCES.has(source)) {
    throw new ContractDomainError(400, "押金资金来源不正确");
  }
  return source;
}

function normalizeDepositDate(value: unknown, label: string): string {
  const date = String(value || "").trim();
  if (!isValidBankBusinessDate(date)) {
    throw new ContractDomainError(400, `${label}格式不正确`);
  }
  return date;
}

async function insertContractDepositSettlementReceipt(
  client: PoolClient,
  input: {
    settlementId: string;
    contractId: string;
    kind: ContractDepositSettlementReceiptKind;
    amount: number;
    transactionDate: string;
    file: ValidatedUpload;
    uploadedBy: string;
    createdAt: string;
    fileId?: string;
    financialOcrJobId?: string;
    electronicReceiptNo?: string;
    payer?: string;
    payerAccount?: string;
    payee?: string;
    payeeAccount?: string;
    recognitionMethod?: string;
    ocrEngineVersion?: string;
    ocrParserVersion?: string;
    evidenceTextHash?: string;
  },
): Promise<ContractDepositSettlementReceiptRow> {
  const inserted = await client.query<ContractDepositSettlementReceiptRow>(
    `INSERT INTO contract_deposit_settlement_receipts(
       id,settlement_id,contract_id,receipt_kind,amount,transaction_date,
       file_name,file_path,file_size,mime_type,file_hash,file_id,
       financial_ocr_job_id,electronic_receipt_no,payer,payer_account,
       payee,payee_account,recognition_method,ocr_engine_version,
       ocr_parser_version,evidence_text_hash,uploaded_by,created_at
     ) VALUES(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
       $17,$18,$19,$20,$21,$22,$23,$24
     )
     ON CONFLICT(file_hash) DO NOTHING
     RETURNING *`,
    [
      nanoid(),
      input.settlementId,
      input.contractId,
      input.kind,
      input.amount,
      input.transactionDate,
      input.file.fileName,
      input.file.filePath,
      input.file.fileSize,
      input.file.mimeType,
      input.file.fileHash,
      input.fileId || null,
      input.financialOcrJobId || null,
      input.electronicReceiptNo || null,
      input.payer || null,
      input.payerAccount || null,
      input.payee || null,
      input.payeeAccount || null,
      input.recognitionMethod || null,
      input.ocrEngineVersion || null,
      input.ocrParserVersion || null,
      input.evidenceTextHash || null,
      input.uploadedBy,
      input.createdAt,
    ],
  );
  const receipt = inserted.rows[0];
  if (!receipt) {
    throw new ContractDomainError(
      409,
      "该回单已经用于本合同的押金资金登记，请勿重复上传",
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_DUPLICATE",
    );
  }
  return receipt;
}

async function lockDepositContract(client: PoolClient, contractId: string) {
  const result = await client.query<ContractRow>(
    `SELECT * FROM contracts
     WHERE id=$1 AND is_deleted=FALSE FOR UPDATE`,
    [contractId],
  );
  const contract = result.rows[0];
  if (!contract) throw new ContractDomainError(404, "合同不存在");
  if (
    !isContractDepositEligible({
      category: contract.category,
      declaredSubtype: contract.declared_subtype,
      relationType: contract.relation_type,
    })
  ) {
    throw new ContractDomainError(409, "只有租赁类资产主合同可以登记押金");
  }
  return contract;
}

async function resolveDepositReturnRecognitionContext(
  client: PoolClient,
  input: {
    contractId: string;
    businessPurpose: ContractDepositReturnReceiptPurpose;
    settlementId?: string | null;
    targetId?: string | null;
  },
): Promise<DepositReturnFinancialOcrContext> {
  const contract = await lockDepositContract(client, input.contractId);
  const depositResult = await client.query<ContractDepositRow>(
    `SELECT * FROM contract_deposits WHERE contract_id=$1 FOR UPDATE`,
    [input.contractId],
  );
  const deposit = depositResult.rows[0];
  if (!deposit) throw new ContractDomainError(404, "押金记录不存在");
  const selectedSettlementId =
    input.settlementId ||
    (input.targetId && input.targetId !== deposit.id ? input.targetId : null);

  if (input.businessPurpose === "deposit_refund") {
    const linkedPaymentRecordId =
      deposit.payment_record_id || deposit.external_payment_record_id;
    if (!linkedPaymentRecordId) {
      throw new ContractDomainError(
        409,
        "押金尚未关联实际付款回单，不能识别退款回单",
        "CONTRACT_DEPOSIT_REFUND_SOURCE_PAYMENT_REQUIRED",
      );
    }
    const sourcePayment = await lockDepositPaymentTarget(
      client,
      input.contractId,
      linkedPaymentRecordId,
    );
    if (!sourcePayment.payer || !sourcePayment.payee) {
      throw new ContractDomainError(
        409,
        "原押金付款回单缺少完整收付款主体，不能自动核验退款方向",
        "CONTRACT_DEPOSIT_REFUND_SOURCE_PARTIES_MISSING",
      );
    }
    let targetId = deposit.id;
    let maximumAmount =
      Number(deposit.amount) - Number(deposit.settled_amount || 0);
    let requiredAmount: number | undefined;
    let requiredTransactionDate: string | undefined;
    if (selectedSettlementId) {
      const settlementResult = await client.query<ContractDepositSettlementRow>(
        `SELECT * FROM contract_deposit_settlements
           WHERE id=$1 AND contract_id=$2 AND deposit_id=$3 FOR UPDATE`,
        [selectedSettlementId, input.contractId, deposit.id],
      );
      const settlement = settlementResult.rows[0];
      if (!settlement) {
        throw new ContractDomainError(404, "押金退款记录不存在");
      }
      if (settlement.settlement_type !== "refund") {
        throw new ContractDomainError(
          409,
          "只有押金退款记录可以补充退款回单",
          "CONTRACT_DEPOSIT_REFUND_TARGET_TYPE_INVALID",
        );
      }
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM contract_deposit_settlement_receipts
         WHERE settlement_id=$1 AND receipt_kind='deposit_refund'
         FOR UPDATE`,
        [settlement.id],
      );
      if (existing.rows[0]) {
        throw new ContractDomainError(
          409,
          "该笔押金退款已经存在退回回单",
          "CONTRACT_DEPOSIT_REFUND_RECEIPT_ALREADY_EXISTS",
        );
      }
      targetId = settlement.id;
      maximumAmount = Number(settlement.amount);
      requiredAmount = Number(settlement.amount);
      requiredTransactionDate = settlement.settlement_date;
    } else {
      if (deposit.status === "pending_payment") {
        throw new ContractDomainError(409, "押金尚未支付，不能办理退款");
      }
      if (deposit.status === "settled" || maximumAmount <= 0) {
        throw new ContractDomainError(409, "押金已结清，不能重复退款");
      }
    }
    if (input.targetId && input.targetId !== targetId) {
      throw new ContractDomainError(
        409,
        "押金退款识别任务目标已经变化，请重新识别",
        "CONTRACT_DEPOSIT_RETURN_OCR_TARGET_CHANGED",
      );
    }
    return {
      businessPurpose: "deposit_refund",
      targetId,
      expectedPayer: sourcePayment.payee,
      expectedPayee: sourcePayment.payer,
      expectedPayerAccount: sourcePayment.payeeAccount,
      expectedPayeeAccount: sourcePayment.payerAccount,
      minimumTransactionDate: sourcePayment.paymentDate,
      maximumAmount,
      expectedDirection: "receipt",
      requiredAmount,
      requiredTransactionDate,
    };
  }

  const engineeringSettlementId = selectedSettlementId || input.targetId;
  if (!engineeringSettlementId) {
    throw new ContractDomainError(
      400,
      "识别退工程回单必须指定押金退款记录",
      "CONTRACT_DEPOSIT_ENGINEERING_RETURN_TARGET_REQUIRED",
    );
  }
  const settlementResult = await client.query<ContractDepositSettlementRow>(
    `SELECT * FROM contract_deposit_settlements
     WHERE id=$1 AND contract_id=$2 AND deposit_id=$3 FOR UPDATE`,
    [engineeringSettlementId, input.contractId, deposit.id],
  );
  const settlement = settlementResult.rows[0];
  if (!settlement) throw new ContractDomainError(404, "押金退款记录不存在");
  if (settlement.settlement_type !== "refund") {
    throw new ContractDomainError(409, "只有押金退款可以退回工程资金");
  }
  const maximumAmount =
    Number(settlement.engineering_return_required_amount || 0) -
    Number(settlement.engineering_returned_amount || 0);
  if (maximumAmount <= 0) {
    throw new ContractDomainError(409, "该笔工程划拨资金已经全部退回");
  }
  if (input.targetId && input.targetId !== settlement.id) {
    throw new ContractDomainError(
      409,
      "退工程识别任务目标已经变化，请重新识别",
      "CONTRACT_DEPOSIT_RETURN_OCR_TARGET_CHANGED",
    );
  }
  return {
    businessPurpose: "engineering_return",
    targetId: settlement.id,
    expectedPayer: resolveContractCompanySubject(contract).name,
    expectedPayee: "北京羽隶工程咨询有限公司",
    minimumTransactionDate: settlement.settlement_date,
    maximumAmount,
    expectedDirection: "payment",
  };
}

interface DepositReturnOcrFields {
  paymentTime: string;
  amount: number;
  electronicReceiptNo: string;
  payer: string;
  payerAccount: string;
  payee: string;
  payeeAccount: string;
}

interface LockedDepositReturnOcrJob {
  id: string;
  contract_id: string;
  file_id: string;
  file_hash: string;
  record_kind: "receipt" | "payment";
  status: FinancialOcrJobView["status"];
  validation_status: FinancialOcrJobView["validationStatus"];
  recognition_method: string | null;
  engine_version: string | null;
  parser_version: string | null;
  evidence_text_hash: string | null;
  direction: string | null;
  document_status: string | null;
  can_auto_post: boolean;
  snapshot_json: SafeContractFinancialSnapshot;
  business_purpose: ContractFinancialOcrBusinessPurpose;
  target_id: string;
  requested_by: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
}

function assertDepositReturnOcrFieldsMatch(
  job: LockedDepositReturnOcrJob,
  context: SpecializedFinancialOcrContext,
): DepositReturnOcrFields {
  const fields = job.snapshot_json?.fields as Partial<DepositReturnOcrFields>;
  if (
    !fields ||
    !fields.paymentTime ||
    !isValidBankBusinessDate(String(fields.paymentTime)) ||
    !fields.electronicReceiptNo ||
    !fields.payer ||
    !fields.payerAccount ||
    !fields.payee ||
    !fields.payeeAccount
  ) {
    throw new ContractDomainError(
      409,
      "押金结算回单识别字段不完整，请重新识别",
      "CONTRACT_DEPOSIT_RETURN_OCR_FIELDS_INCOMPLETE",
    );
  }
  const amount = parsePositiveAmount(fields.amount, "回单金额");
  if (job.direction !== context.expectedDirection) {
    throw new ContractDomainError(
      422,
      "押金结算回单资金方向不符合当前操作",
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_DIRECTION_MISMATCH",
    );
  }
  if (
    normalizeFinancialIdentity(fields.payer) !==
      normalizeFinancialIdentity(context.expectedPayer) ||
    normalizeFinancialIdentity(fields.payee) !==
      normalizeFinancialIdentity(context.expectedPayee)
  ) {
    throw new ContractDomainError(
      422,
      context.businessPurpose === "deposit_refund"
        ? "押金退款回单必须由原付款收款方退回至原付款付款方"
        : context.businessPurpose === "engineering_return"
          ? `退工程回单必须由${context.expectedPayer}付款、${context.expectedPayee}收款`
          : `内部划拨回单必须由${context.expectedPayer}付款、${context.expectedPayee}收款`,
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_PARTY_MISMATCH",
    );
  }
  if (
    context.expectedPayerAccount &&
    normalizeFinancialBankIdentifier(fields.payerAccount) !==
      normalizeFinancialBankIdentifier(context.expectedPayerAccount)
  ) {
    throw new ContractDomainError(
      422,
      "回单付款账号与要求的资金退回账号不一致",
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_PAYER_ACCOUNT_MISMATCH",
    );
  }
  if (
    context.expectedPayeeAccount &&
    normalizeFinancialBankIdentifier(fields.payeeAccount) !==
      normalizeFinancialBankIdentifier(context.expectedPayeeAccount)
  ) {
    throw new ContractDomainError(
      422,
      "回单收款账号与要求的资金接收账号不一致",
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_PAYEE_ACCOUNT_MISMATCH",
    );
  }
  if (String(fields.paymentTime) < context.minimumTransactionDate) {
    throw new ContractDomainError(
      422,
      "资金退回日期不能早于原付款或押金退款日期",
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_DATE_BEFORE_SOURCE",
    );
  }
  if (toCents(String(amount)) > toCents(String(context.maximumAmount))) {
    throw new ContractDomainError(
      409,
      context.businessPurpose === "deposit_refund"
        ? "回单退款金额不能超过押金待结算金额"
        : context.businessPurpose === "engineering_return"
          ? "回单退工程金额不能超过该笔待退工程金额"
          : "内部划拨回单金额不能超过已完成合同的待划拨缺口",
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_AMOUNT_EXCEEDS_REMAINING",
    );
  }
  return {
    paymentTime: String(fields.paymentTime),
    amount,
    electronicReceiptNo: String(fields.electronicReceiptNo),
    payer: String(fields.payer),
    payerAccount: String(fields.payerAccount),
    payee: String(fields.payee),
    payeeAccount: String(fields.payeeAccount),
  };
}

async function lockVerifiedDepositReturnOcrJob(
  client: PoolClient,
  input: {
    contractId: string;
    jobId: string;
    context: SpecializedFinancialOcrContext;
  },
): Promise<{ job: LockedDepositReturnOcrJob; fields: DepositReturnOcrFields }> {
  const result = await client.query<LockedDepositReturnOcrJob>(
    `SELECT job.*,file.file_name,file.file_path,file.file_size,file.mime_type
     FROM contract_financial_ocr_jobs job
     JOIN contract_files file ON file.id=job.file_id
     WHERE job.id=$1 AND job.contract_id=$2
       AND job.business_purpose=$3 AND job.target_id=$4
     FOR UPDATE OF job,file`,
    [
      input.jobId,
      input.contractId,
      input.context.businessPurpose,
      input.context.targetId,
    ],
  );
  const job = result.rows[0];
  if (!job) {
    throw new ContractDomainError(
      404,
      "押金结算回单识别任务不存在或目标不一致",
      "CONTRACT_DEPOSIT_RETURN_OCR_JOB_NOT_FOUND",
    );
  }
  const expectedRecordKind =
    input.context.businessPurpose === "deposit_refund" ? "receipt" : "payment";
  if (
    job.record_kind !== expectedRecordKind ||
    job.status !== "verified" ||
    job.validation_status !== "verified" ||
    job.document_status !== "normal" ||
    job.can_auto_post !== true ||
    job.engine_version !==
      contractFinancialOcrEngineVersion(expectedRecordKind) ||
    job.parser_version !== contractFinancialOcrParserVersion(expectedRecordKind)
  ) {
    throw new ContractDomainError(
      409,
      "押金结算回单未通过当前安全识别，不能确认",
      "CONTRACT_DEPOSIT_RETURN_OCR_JOB_NOT_CONFIRMABLE",
    );
  }
  const fields = assertDepositReturnOcrFieldsMatch(job, input.context);
  if (
    await findContractBankReceiptNumberDuplicate(
      client,
      fields.electronicReceiptNo,
      job.id,
    )
  ) {
    throw new ContractDomainError(
      409,
      `电子回单号码 ${fields.electronicReceiptNo} 已上传或登记，禁止重复使用`,
      "DUPLICATE_CONTRACT_BANK_DOCUMENT",
    );
  }
  return { job, fields };
}

function storedUploadFromDepositReturnJob(
  job: LockedDepositReturnOcrJob,
): ValidatedUpload {
  return {
    fileName: job.file_name,
    filePath: job.file_path,
    fileSize: Number(job.file_size),
    mimeType: job.mime_type,
    fileHash: job.file_hash,
  };
}

async function loadContractDepositSnapshot(
  client: PoolClient,
  contractId: string,
) {
  const contractResult = await client.query<{
    id: string;
    category: string | null;
    declared_subtype: string | null;
    relation_type: string;
  }>(
    `SELECT id,category,declared_subtype,relation_type FROM contracts
     WHERE id=$1 AND is_deleted=FALSE`,
    [contractId],
  );
  const contract = contractResult.rows[0];
  if (!contract) throw new ContractDomainError(404, "合同不存在");
  const eligible = isContractDepositEligible({
    category: contract.category,
    declaredSubtype: contract.declared_subtype,
    relationType: contract.relation_type,
  });
  const depositResult = await client.query<ContractDepositRow>(
    `SELECT deposit.*,creator.name AS created_by_name,
       updater.name AS updated_by_name
     FROM contract_deposits deposit
     LEFT JOIN users creator ON creator.id=deposit.created_by
     LEFT JOIN users updater ON updater.id=deposit.updated_by
     WHERE deposit.contract_id=$1`,
    [contractId],
  );
  const deposit = depositResult.rows[0] || null;
  const settlements = deposit
    ? (
        await client.query<ContractDepositSettlementRow>(
          `SELECT settlement.*,creator.name AS created_by_name
           FROM contract_deposit_settlements settlement
           LEFT JOIN users creator ON creator.id=settlement.created_by
           WHERE settlement.deposit_id=$1
           ORDER BY settlement.settlement_date,settlement.created_at,settlement.id`,
          [deposit.id],
        )
      ).rows
    : [];
  const settlementReceipts = deposit
    ? (
        await client.query<ContractDepositSettlementReceiptRow>(
          `SELECT receipt.*,uploader.name AS uploaded_by_name
           FROM contract_deposit_settlement_receipts receipt
           JOIN contract_deposit_settlements settlement
             ON settlement.id=receipt.settlement_id
             AND settlement.contract_id=receipt.contract_id
           LEFT JOIN users uploader ON uploader.id=receipt.uploaded_by
           WHERE receipt.contract_id=$1 AND settlement.deposit_id=$2
           ORDER BY receipt.created_at,receipt.id`,
          [contractId, deposit.id],
        )
      ).rows
    : [];
  const receiptApiBySettlement = new Map<
    string,
    Array<{
      kind: ContractDepositSettlementReceiptKind;
      value: {
        id: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        amount: number;
        transactionDate: string;
        fileUrl: string;
        uploadedBy: string;
        uploadedByName: string | null;
        createdAt: string;
        electronicReceiptNo: string | null;
        payer: string | null;
        payerAccount: string | null;
        payee: string | null;
        payeeAccount: string | null;
        recognitionMethod: string | null;
        ocrEngineVersion: string | null;
        ocrParserVersion: string | null;
      };
    }>
  >();
  for (const receipt of settlementReceipts) {
    const values = receiptApiBySettlement.get(receipt.settlement_id) || [];
    values.push({
      kind: receipt.receipt_kind,
      value: {
        id: receipt.id,
        fileName: receipt.file_name,
        fileSize: Number(receipt.file_size),
        mimeType: receipt.mime_type,
        amount: Number(receipt.amount),
        transactionDate: receipt.transaction_date,
        fileUrl: `/api/contracts/${contractId}/deposit/settlements/${receipt.settlement_id}/receipts/${receipt.id}/file`,
        uploadedBy: receipt.uploaded_by,
        uploadedByName: receipt.uploaded_by_name || null,
        createdAt: receipt.created_at,
        electronicReceiptNo: receipt.electronic_receipt_no,
        payer: receipt.payer,
        payerAccount: receipt.payer_account,
        payee: receipt.payee,
        payeeAccount: receipt.payee_account,
        recognitionMethod: receipt.recognition_method,
        ocrEngineVersion: receipt.ocr_engine_version,
        ocrParserVersion: receipt.ocr_parser_version,
      },
    });
    receiptApiBySettlement.set(receipt.settlement_id, values);
  }
  const mappedSettlements = settlements.map((row) => ({
    id: row.id,
    type: row.settlement_type,
    amount: Number(row.amount),
    settlementDate: row.settlement_date,
    note: row.note,
    engineeringReturnRequiredAmount: Number(
      row.engineering_return_required_amount || 0,
    ),
    engineeringReturnedAmount: Number(row.engineering_returned_amount || 0),
    engineeringReturnStatus:
      Number(row.engineering_return_required_amount || 0) === 0
        ? "not_required"
        : Number(row.engineering_returned_amount || 0) >=
            Number(row.engineering_return_required_amount || 0)
          ? "returned"
          : Number(row.engineering_returned_amount || 0) > 0
            ? "partial"
            : "pending",
    refundReceipt:
      receiptApiBySettlement
        .get(row.id)
        ?.find((receipt) => receipt.kind === "deposit_refund")?.value || null,
    engineeringReturnReceipts: (receiptApiBySettlement.get(row.id) || [])
      .filter((receipt) => receipt.kind === "engineering_return")
      .map((receipt) => receipt.value),
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
  }));
  const pendingEngineeringReturn = mappedSettlements.reduce(
    (sum, row) =>
      sum +
      Math.max(
        0,
        Number(row.engineeringReturnRequiredAmount || 0) -
          Number(row.engineeringReturnedAmount || 0),
      ),
    0,
  );
  return {
    eligibility: {
      likely: eligible,
      reason: eligible ? "rental_subtype" : "non_rental_subtype",
      subtype: contract.declared_subtype,
    },
    deposit: deposit
      ? {
          id: deposit.id,
          contractId: deposit.contract_id,
          amount: Number(deposit.amount),
          clauseText: deposit.clause_text,
          basis: deposit.basis,
          paymentPurpose: deposit.payment_purpose,
          fundingSource: deposit.funding_source,
          engineeringAllocationAmount: Number(
            deposit.engineering_allocation_amount || 0,
          ),
          technologySelfFundedAmount: Number(
            deposit.technology_self_funded_amount || 0,
          ),
          paymentRecordId:
            deposit.payment_record_id || deposit.external_payment_record_id,
          paymentRecordKind: deposit.external_payment_record_id
            ? "external_payment"
            : deposit.payment_record_id
              ? "payment"
              : null,
          paidAt: deposit.paid_at,
          note: deposit.note,
          status: deposit.status,
          settledAmount: Number(deposit.settled_amount || 0),
          remainingAmount:
            Number(deposit.amount) - Number(deposit.settled_amount || 0),
          pendingEngineeringReturn,
          settlements: mappedSettlements,
          createdBy: deposit.created_by,
          createdByName: deposit.created_by_name || null,
          createdAt: deposit.created_at,
          updatedBy: deposit.updated_by,
          updatedByName: deposit.updated_by_name || null,
          updatedAt: deposit.updated_at,
        }
      : null,
  };
}

router.get(
  "/:id/completed-internal-funding-summary",
  requireFinance,
  async (req, res) => {
    try {
      const result = await db.transaction((client) =>
        loadCompletedInternalFundingSummary(client, req.params.id, false),
      );
      res.json({ success: true, data: result.summary });
    } catch (error) {
      sendError(res, error, "获取已完成合同内部划拨摘要失败");
    }
  },
);

router.post(
  "/:id/completed-internal-funding/recognize",
  requireFinance,
  uploadSingle,
  async (req, res) => {
    let stored = false;
    try {
      if (Object.keys(req.body || {}).length > 0) {
        throw new ContractDomainError(
          400,
          "识别历史内部划拨回单时只需上传文件",
          "COMPLETED_INTERNAL_FUNDING_OCR_FIELDS_FORBIDDEN",
        );
      }
      const currentActor = actor(req);
      const contextResult = await db.transaction((client) =>
        loadCompletedInternalFundingSummary(client, req.params.id, true),
      );
      if (contextResult.summary.status === "pending_review") {
        throw new ContractDomainError(
          409,
          "押金资金来源尚未确认，不能补录历史内部划拨",
          "COMPLETED_INTERNAL_FUNDING_SOURCE_PENDING_REVIEW",
        );
      }
      if (!contextResult.summary.canAppendAfterCompletion) {
        throw new ContractDomainError(
          409,
          "该已完成合同没有待补内部划拨金额",
          "COMPLETED_INTERNAL_FUNDING_ALREADY_CLOSED",
        );
      }
      const availableRecognitionAmount =
        contextResult.summary.availableRecognitionAmount;
      if (availableRecognitionAmount <= 0) {
        throw new ContractDomainError(
          409,
          "待确认识别任务已经覆盖全部内部划拨缺口，请先确认或删除现有任务",
          "COMPLETED_INTERNAL_FUNDING_PENDING_COVERS_REMAINING",
        );
      }
      const result = await recognizeAndStoreFinancialFile(
        req.params.id,
        "payment",
        req.file,
        currentActor,
        () => {
          stored = true;
        },
        false,
        false,
        {
          ...contextResult.context,
          maximumAmount: availableRecognitionAmount,
        },
      );
      const refreshed = await db.transaction((client) =>
        loadCompletedInternalFundingSummary(client, req.params.id, false),
      );
      const recognition = refreshed.summary.pendingRecognitions.find(
        (job) => job.jobId === result.id,
      );
      if (!recognition) {
        throw new ContractDomainError(
          409,
          "识别任务状态已经变化，请刷新内部划拨摘要",
          "COMPLETED_INTERNAL_FUNDING_OCR_STATE_CHANGED",
        );
      }
      res.status(recognition.canConfirm ? 200 : 202).json({
        success: true,
        data: recognition,
      });
    } catch (error) {
      const commitOutcomeUncertain = Boolean(
        error &&
        typeof error === "object" &&
        "commitOutcomeUncertain" in error &&
        (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
      );
      if (!stored && !commitOutcomeUncertain) cleanupUploadedFile(req.file);
      if (commitOutcomeUncertain) {
        res.status(500).json({
          success: false,
          code: "COMPLETED_INTERNAL_FUNDING_OCR_COMMIT_OUTCOME_UNCERTAIN",
          message:
            "内部划拨识别任务提交结果暂时无法确认；已保留原件，请刷新后再操作",
        });
        return;
      }
      sendError(res, error, "识别已完成合同内部划拨回单失败");
    }
  },
);

router.delete(
  "/:id/completed-internal-funding/recognitions/:jobId",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const removed = await db.transaction(async (client) => {
        await loadCompletedInternalFundingSummary(client, req.params.id, true);
        const result = await client.query<{
          id: string;
          file_id: string;
          file_hash: string;
          file_path: string;
          file_name: string;
          status: string;
          record_id: string | null;
        }>(
          `SELECT job.id,job.file_id,job.file_hash,job.status,job.record_id,
             file.file_path,file.file_name
           FROM contract_financial_ocr_jobs job
           JOIN contract_files file ON file.id=job.file_id
           WHERE job.id=$1 AND job.contract_id=$2
             AND job.business_purpose='engineering_internal_funding'
             AND job.target_id=$2
           FOR UPDATE OF job,file`,
          [req.params.jobId, req.params.id],
        );
        const job = result.rows[0];
        if (!job) {
          throw new ContractDomainError(
            404,
            "历史内部划拨识别任务不存在",
            "COMPLETED_INTERNAL_FUNDING_OCR_JOB_NOT_FOUND",
          );
        }
        if (job.status === "processing") {
          throw new ContractDomainError(409, "回单正在识别，请稍后再移除");
        }
        if (job.record_id || job.status === "consumed") {
          throw new ContractDomainError(
            409,
            "该内部划拨回单已经确认，不能按临时任务删除",
            "COMPLETED_INTERNAL_FUNDING_OCR_ALREADY_CONSUMED",
          );
        }
        const now = new Date().toISOString();
        await client.query(
          `INSERT INTO contract_audit_logs(
             id,contract_id,action,actor_id,actor_role,from_status,to_status,
             changes_json,comment,created_at
           ) SELECT $1,contract.id,'completed_internal_funding_ocr_deleted',
             $2,$3,status,status,$4::jsonb,$5,$6
             FROM contracts contract WHERE contract.id=$7`,
          [
            nanoid(),
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              ocrJobId: job.id,
              fileId: job.file_id,
              fileHash: job.file_hash,
              fileName: job.file_name,
              previousStatus: job.status,
              hardDeleted: true,
            }),
            "移除未确认的已完成合同内部划拨识别任务",
            now,
            req.params.id,
          ],
        );
        await client.query(
          `DELETE FROM contract_financial_file_hashes WHERE file_id=$1`,
          [job.file_id],
        );
        await client.query(
          `DELETE FROM contract_financial_ocr_jobs WHERE id=$1`,
          [job.id],
        );
        await client.query(`DELETE FROM contract_files WHERE id=$1`, [
          job.file_id,
        ]);
        return job;
      });
      await cleanupStoredFinancialFiles([removed.file_path], {
        contractId: req.params.id,
        ocrJobId: removed.id,
        businessPurpose: "engineering_internal_funding",
      });
      res.json({ success: true, data: { jobId: removed.id, deleted: true } });
    } catch (error) {
      const commitOutcomeUncertain = Boolean(
        error &&
        typeof error === "object" &&
        "commitOutcomeUncertain" in error &&
        (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
      );
      if (commitOutcomeUncertain) {
        res.status(500).json({
          success: false,
          code: "COMPLETED_INTERNAL_FUNDING_DELETE_COMMIT_OUTCOME_UNCERTAIN",
          message:
            "识别任务移除结果暂时无法确认；已保留物理文件，请刷新后再操作",
        });
        return;
      }
      sendError(res, error, "移除已完成合同内部划拨识别任务失败");
    }
  },
);

router.post(
  "/:id/completed-internal-funding/confirm",
  requireFinance,
  async (req, res) => {
    try {
      if (
        Object.keys(req.body || {}).some((key) => key !== "ocrJobIds") ||
        !Array.isArray(req.body?.ocrJobIds)
      ) {
        throw new ContractDomainError(
          400,
          "确认历史内部划拨时只能提交识别任务编号数组",
          "COMPLETED_INTERNAL_FUNDING_CONFIRM_FIELDS_INVALID",
        );
      }
      const jobIds = [
        ...new Set(
          (req.body.ocrJobIds as unknown[])
            .map(normalizeNullableText)
            .filter((id): id is string => Boolean(id)),
        ),
      ].sort();
      if (!jobIds.length || jobIds.length > 20) {
        throw new ContractDomainError(
          400,
          "每次必须确认一至二十张内部划拨回单",
        );
      }
      const currentActor = actor(req);
      const summary = await db.transaction(async (client) => {
        const contextResult = await loadCompletedInternalFundingSummary(
          client,
          req.params.id,
          true,
        );
        if (contextResult.summary.status === "pending_review") {
          throw new ContractDomainError(
            409,
            "押金资金来源尚未确认，不能确认历史内部划拨",
            "COMPLETED_INTERNAL_FUNDING_SOURCE_PENDING_REVIEW",
          );
        }
        if (!contextResult.summary.canAppendAfterCompletion) {
          throw new ContractDomainError(
            409,
            "该已完成合同没有待补内部划拨金额",
            "COMPLETED_INTERNAL_FUNDING_ALREADY_CLOSED",
          );
        }
        const recognized = [];
        for (const jobId of jobIds) {
          recognized.push(
            await lockVerifiedDepositReturnOcrJob(client, {
              contractId: req.params.id,
              jobId,
              context: contextResult.context,
            }),
          );
        }
        const batchAmountCents = recognized.reduce(
          (sum, item) => sum + toCents(String(item.fields.amount)),
          0,
        );
        if (
          batchAmountCents >
          toCents(String(contextResult.summary.remainingAmount))
        ) {
          throw new ContractDomainError(
            422,
            `本批内部划拨合计${centsToAmount(batchAmountCents).toFixed(2)}元不能超过待划拨缺口${contextResult.summary.remainingAmount.toFixed(2)}元`,
            "COMPLETED_INTERNAL_FUNDING_BATCH_EXCEEDS_REMAINING",
          );
        }
        const now = new Date().toISOString();
        const paymentIds: string[] = [];
        for (const item of recognized) {
          const paymentId = nanoid();
          paymentIds.push(paymentId);
          await client.query(
            `INSERT INTO contract_payments(
               id,contract_id,file_id,payment_date,payment_time,amount,
               expense_category,payer,payer_account,payee,payee_account,
               electronic_receipt_no,note,financial_ocr_job_id,status,
               created_by,confirmed_by,confirmed_at,created_at,updated_at
             ) VALUES(
               $1,$2,$3,$4,$4,$5,'other',$6,$7,$8,$9,$10,NULL,$11,
               'confirmed',$12,$13,$14,$14,$14
             )`,
            [
              paymentId,
              req.params.id,
              item.job.file_id,
              item.fields.paymentTime,
              item.fields.amount,
              item.fields.payer,
              item.fields.payerAccount,
              item.fields.payee,
              item.fields.payeeAccount,
              item.fields.electronicReceiptNo,
              item.job.id,
              item.job.requested_by,
              currentActor.id,
              now,
            ],
          );
          await client.query(
            `UPDATE contract_financial_ocr_jobs SET
               status='consumed',record_id=$2,consumed_at=$3,updated_at=$3
             WHERE id=$1 AND status='verified' AND record_id IS NULL`,
            [item.job.id, paymentId, now],
          );
        }
        const contractStatus = await client.query<{ status: string }>(
          `SELECT status FROM contracts WHERE id=$1 FOR UPDATE`,
          [req.params.id],
        );
        if (contractStatus.rows[0]?.status !== "completed") {
          throw new ContractDomainError(
            409,
            "合同状态已变化，历史内部划拨确认已回滚",
            "COMPLETED_INTERNAL_FUNDING_STATUS_CHANGED",
          );
        }
        await client.query(
          `INSERT INTO contract_audit_logs(
             id,contract_id,action,actor_id,actor_role,from_status,to_status,
             changes_json,comment,created_at
           ) VALUES($1,$2,'completed_internal_funding_confirmed',$3,$4,
             'completed','completed',$5::jsonb,$6,$7)`,
          [
            nanoid(),
            req.params.id,
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              ocrJobIds: recognized.map((item) => item.job.id),
              paymentIds,
              batchAmount: centsToAmount(batchAmountCents),
              contractStatusPreserved: true,
              registrationCreated: false,
              matchesCreated: false,
            }),
            "补录已完成合同工程咨询内部划拨",
            now,
          ],
        );
        return (
          await loadCompletedInternalFundingSummary(
            client,
            req.params.id,
            false,
          )
        ).summary;
      });
      res.json({ success: true, data: summary });
    } catch (error) {
      const commitOutcomeUncertain = Boolean(
        error &&
        typeof error === "object" &&
        "commitOutcomeUncertain" in error &&
        (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
      );
      if (commitOutcomeUncertain) {
        res.status(500).json({
          success: false,
          code: "COMPLETED_INTERNAL_FUNDING_COMMIT_OUTCOME_UNCERTAIN",
          message:
            "内部划拨确认结果暂时无法确认；请刷新摘要后再操作，勿重复确认",
        });
        return;
      }
      sendError(res, error, "确认已完成合同内部划拨失败");
    }
  },
);

router.get("/:id/deposit", requireContractRead, async (req, res) => {
  try {
    await assertContractReadScope(req, req.params.id);
    const snapshot = await db.transaction((client) =>
      loadContractDepositSnapshot(client, req.params.id),
    );
    res.json({ success: true, data: snapshot });
  } catch (error) {
    sendError(res, error, "获取押金记录失败");
  }
});

router.post(
  "/:id/deposit/return-receipts/recognize",
  requireFinance,
  uploadSingle,
  async (req, res) => {
    let stored = false;
    try {
      const allowedFields = new Set(["receiptKind", "settlementId"]);
      if (
        Object.keys(req.body || {}).some((field) => !allowedFields.has(field))
      ) {
        throw new ContractDomainError(
          400,
          "识别押金结算回单时只能提交回单类型和目标退款记录",
          "CONTRACT_DEPOSIT_RETURN_OCR_FIELDS_FORBIDDEN",
        );
      }
      const receiptKind = String(
        req.body.receiptKind || "",
      ) as ContractDepositReturnReceiptPurpose;
      if (!new Set(["deposit_refund", "engineering_return"]).has(receiptKind)) {
        throw new ContractDomainError(400, "押金结算回单类型不正确");
      }
      const settlementId = normalizeNullableText(req.body.settlementId);
      if (receiptKind === "engineering_return" && !settlementId) {
        throw new ContractDomainError(
          400,
          "识别退工程回单必须指定押金退款记录",
          "CONTRACT_DEPOSIT_ENGINEERING_RETURN_TARGET_REQUIRED",
        );
      }
      const currentActor = actor(req);
      const recognitionContext = await db.transaction((client) =>
        resolveDepositReturnRecognitionContext(client, {
          contractId: req.params.id,
          businessPurpose: receiptKind,
          settlementId,
        }),
      );
      const result = await recognizeAndStoreFinancialFile(
        req.params.id,
        receiptKind === "deposit_refund" ? "receipt" : "payment",
        req.file,
        currentActor,
        () => {
          stored = true;
        },
        false,
        false,
        recognitionContext,
      );
      const data = {
        jobId: result.id,
        fileId: result.fileId,
        receiptKind,
        targetId: recognitionContext.targetId,
        status: result.status,
        validationStatus: result.validationStatus,
        canConfirm: result.canCreateDraft,
        fields: result.snapshot.fields,
        blockingReasons: result.blockingReasons,
        warnings: result.warnings,
        recognitionMethod: result.recognitionMethod,
        evidenceTextHash: result.evidenceTextHash,
        engineVersion: result.engineVersion,
        parserVersion: result.parserVersion,
        fileUrl: `/api/contracts/files/${result.fileId}`,
      };
      res.status(result.canCreateDraft ? 200 : 202).json({
        success: true,
        data,
      });
    } catch (error) {
      const commitOutcomeUncertain = Boolean(
        error &&
        typeof error === "object" &&
        "commitOutcomeUncertain" in error &&
        (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
      );
      if (!stored && !commitOutcomeUncertain) cleanupUploadedFile(req.file);
      if (commitOutcomeUncertain) {
        res.status(500).json({
          success: false,
          code: "CONTRACT_DEPOSIT_RETURN_OCR_COMMIT_OUTCOME_UNCERTAIN",
          message:
            "回单识别任务提交结果暂时无法确认；已保留原件，请刷新后再操作，勿重复上传",
        });
        return;
      }
      sendError(res, error, "识别押金结算回单失败");
    }
  },
);

router.delete(
  "/:id/deposit/return-receipts/:jobId",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const removed = await db.transaction(async (client) => {
        await lockDepositContract(client, req.params.id);
        const result = await client.query<{
          id: string;
          file_id: string;
          file_hash: string;
          file_path: string;
          file_name: string;
          status: string;
          record_id: string | null;
          business_purpose: ContractDepositReturnReceiptPurpose;
          target_id: string;
        }>(
          `SELECT job.id,job.file_id,job.file_hash,job.status,job.record_id,
             job.business_purpose,job.target_id,file.file_path,file.file_name
           FROM contract_financial_ocr_jobs job
           JOIN contract_files file ON file.id=job.file_id
           WHERE job.id=$1 AND job.contract_id=$2
             AND job.business_purpose IN (
               'deposit_refund','engineering_return'
             )
           FOR UPDATE OF job,file`,
          [req.params.jobId, req.params.id],
        );
        const job = result.rows[0];
        if (!job) {
          throw new ContractDomainError(
            404,
            "押金结算回单识别任务不存在",
            "CONTRACT_DEPOSIT_RETURN_OCR_JOB_NOT_FOUND",
          );
        }
        if (job.status === "processing") {
          throw new ContractDomainError(
            409,
            "回单正在识别，请稍后再移除",
            "CONTRACT_DEPOSIT_RETURN_OCR_PROCESSING",
          );
        }
        if (job.record_id || job.status === "consumed") {
          throw new ContractDomainError(
            409,
            "回单已经确认，请通过结算回单删除入口处理",
            "CONTRACT_DEPOSIT_RETURN_OCR_ALREADY_CONSUMED",
          );
        }
        const now = new Date().toISOString();
        await client.query(
          `INSERT INTO contract_audit_logs(
             id,contract_id,action,actor_id,actor_role,from_status,to_status,
             changes_json,comment,created_at
           ) SELECT $1,contract.id,'contract_deposit_return_ocr_deleted',
             $2,$3,status,status,$4::jsonb,$5,$6
             FROM contracts contract WHERE contract.id=$7`,
          [
            nanoid(),
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              ocrJobId: job.id,
              fileId: job.file_id,
              fileHash: job.file_hash,
              fileName: job.file_name,
              businessPurpose: job.business_purpose,
              targetId: job.target_id,
              previousStatus: job.status,
              hardDeleted: true,
            }),
            "移除未确认的押金结算回单识别任务",
            now,
            req.params.id,
          ],
        );
        await client.query(
          `DELETE FROM contract_financial_file_hashes WHERE file_id=$1`,
          [job.file_id],
        );
        await client.query(
          `DELETE FROM contract_financial_ocr_jobs WHERE id=$1`,
          [job.id],
        );
        await client.query(`DELETE FROM contract_files WHERE id=$1`, [
          job.file_id,
        ]);
        return job;
      });
      await cleanupStoredFinancialFiles([removed.file_path], {
        contractId: req.params.id,
        ocrJobId: removed.id,
        businessPurpose: removed.business_purpose,
      });
      res.json({
        success: true,
        data: { jobId: removed.id, deleted: true },
      });
    } catch (error) {
      const commitOutcomeUncertain = Boolean(
        error &&
        typeof error === "object" &&
        "commitOutcomeUncertain" in error &&
        (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
      );
      if (commitOutcomeUncertain) {
        res.status(500).json({
          success: false,
          code: "CONTRACT_DEPOSIT_RETURN_OCR_DELETE_COMMIT_OUTCOME_UNCERTAIN",
          message:
            "识别任务移除结果暂时无法确认；已保留物理文件，请刷新后再操作",
        });
        return;
      }
      sendError(res, error, "移除押金结算回单识别任务失败");
    }
  },
);

router.put("/:id/deposit", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const amount = parsePositiveAmount(req.body.amount, "押金金额");
    const amountCents = toCents(String(amount));
    const fundingSource = normalizeDepositFundingSource(req.body.fundingSource);
    const engineeringAllocationAmount =
      fundingSource === "engineering_allocation"
        ? amount
        : Number(req.body.engineeringAllocationAmount || 0);
    const technologySelfFundedAmount =
      fundingSource === "technology_self_funded"
        ? amount
        : Number(req.body.technologySelfFundedAmount || 0);
    validateExternalPaymentPurposeDetails(amountCents, [
      {
        purpose: "lease_deposit",
        amountCents,
        fundingSource,
        engineeringAllocationAmountCents: toCents(
          String(engineeringAllocationAmount),
        ),
        technologySelfFundedAmountCents: toCents(
          String(technologySelfFundedAmount),
        ),
      },
    ]);
    const clauseText = normalizeNullableText(req.body.clauseText);
    const basis = normalizeNullableText(req.body.basis);
    if (!clauseText && !basis) {
      throw new ContractDomainError(400, "必须填写合同押金条款或计算依据");
    }
    const note = normalizeNullableText(req.body.note);
    if ((clauseText?.length || 0) > 4000 || (basis?.length || 0) > 1000) {
      throw new ContractDomainError(400, "押金条款或计算依据内容过长");
    }
    if ((note?.length || 0) > 1000) {
      throw new ContractDomainError(400, "押金备注不能超过1000字");
    }
    const requestedPaymentRecordId = normalizeNullableText(
      req.body.paymentRecordId,
    );
    const now = new Date().toISOString();
    const snapshot = await db.transaction(async (client) => {
      await lockDepositContract(client, req.params.id);
      const existing = await client.query<ContractDepositRow>(
        `SELECT * FROM contract_deposits WHERE contract_id=$1 FOR UPDATE`,
        [req.params.id],
      );
      const existingDeposit = existing.rows[0];
      const settledCents = toCents(
        String(existingDeposit?.settled_amount || 0),
      );
      if (amountCents < settledCents) {
        throw new ContractDomainError(409, "押金金额不能低于已结算金额");
      }
      if (
        existingDeposit &&
        settledCents > 0 &&
        (amountCents !== toCents(String(existingDeposit.amount)) ||
          fundingSource !== existingDeposit.funding_source ||
          toCents(String(engineeringAllocationAmount)) !==
            toCents(String(existingDeposit.engineering_allocation_amount)) ||
          toCents(String(technologySelfFundedAmount)) !==
            toCents(String(existingDeposit.technology_self_funded_amount)))
      ) {
        throw new ContractDomainError(
          409,
          "押金已发生结算，不能再修改金额或资金来源",
        );
      }
      let paymentTarget: DepositPaymentTarget | null = null;
      let linkedPaymentRecordId =
        requestedPaymentRecordId ||
        existingDeposit?.payment_record_id ||
        existingDeposit?.external_payment_record_id ||
        null;
      if (!linkedPaymentRecordId) {
        const confirmedReceiptCandidates = await client.query<{
          record_id: string;
        }>(
          `SELECT COALESCE(
             receipt.payment_record_id,receipt.external_payment_record_id
           ) AS record_id
           FROM contract_payment_deposit_receipts receipt
           WHERE receipt.contract_id=$1 AND receipt.status='confirmed'
             AND receipt.confirmed_amount=$2
             AND (
               (receipt.payment_record_id IS NOT NULL AND EXISTS(
                 SELECT 1 FROM contract_payments payment
                 WHERE payment.id=receipt.payment_record_id
                   AND payment.status='confirmed'
               ))
               OR
               (receipt.external_payment_record_id IS NOT NULL AND EXISTS(
                 SELECT 1 FROM contract_external_payments payment
                 WHERE payment.id=receipt.external_payment_record_id
                   AND payment.status='confirmed'
               ))
             )
           ORDER BY receipt.confirmed_at DESC,receipt.id
           FOR UPDATE`,
          [req.params.id, amount],
        );
        if (confirmedReceiptCandidates.rows.length > 1) {
          throw new ContractDomainError(
            409,
            "存在多张同金额已验证押金条，无法唯一关联付款回单",
            "CONTRACT_DEPOSIT_PAYMENT_LINK_AMBIGUOUS",
          );
        }
        linkedPaymentRecordId =
          confirmedReceiptCandidates.rows[0]?.record_id || null;
      }
      if (linkedPaymentRecordId) {
        paymentTarget = await lockDepositPaymentTarget(
          client,
          req.params.id,
          linkedPaymentRecordId,
        );
        if (amountCents > toCents(String(paymentTarget.amount))) {
          throw new ContractDomainError(409, "押金金额不能超过关联付款金额");
        }
      }
      const paidAt = paymentTarget?.paymentDate || null;
      const status = deriveContractDepositStatus({
        amountCents,
        settledAmountCents: settledCents,
        isPaid: Boolean(paidAt),
      });
      const id = existingDeposit?.id || nanoid();
      await client.query(
        `INSERT INTO contract_deposits(
           id,contract_id,amount,clause_text,basis,payment_purpose,
           funding_source,engineering_allocation_amount,
           technology_self_funded_amount,payment_record_id,
           external_payment_record_id,paid_at,note,status,settled_amount,
           created_by,updated_by,created_at,updated_at
         ) VALUES($1,$2,$3,$4,$5,'lease_deposit',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$16)
         ON CONFLICT(contract_id) DO UPDATE SET
           amount=EXCLUDED.amount,clause_text=EXCLUDED.clause_text,
           basis=EXCLUDED.basis,funding_source=EXCLUDED.funding_source,
           engineering_allocation_amount=EXCLUDED.engineering_allocation_amount,
           technology_self_funded_amount=EXCLUDED.technology_self_funded_amount,
           payment_record_id=EXCLUDED.payment_record_id,
           external_payment_record_id=EXCLUDED.external_payment_record_id,
           paid_at=EXCLUDED.paid_at,note=EXCLUDED.note,status=EXCLUDED.status,
           updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,
        [
          id,
          req.params.id,
          amount,
          clauseText,
          basis,
          fundingSource,
          engineeringAllocationAmount,
          technologySelfFundedAmount,
          paymentTarget?.kind === "payment" ? paymentTarget.id : null,
          paymentTarget?.kind === "external_payment" ? paymentTarget.id : null,
          paidAt,
          note,
          status,
          centsToAmount(settledCents),
          currentActor.id,
          now,
        ],
      );
      if (paymentTarget) {
        await client.query(
          `DELETE FROM contract_payment_purpose_details
           WHERE contract_id=$1 AND ${purposeDetailsRecordColumn(paymentTarget.kind)}=$2`,
          [req.params.id, paymentTarget.id],
        );
        const contractPaymentAmount = Number(paymentTarget.amount) - amount;
        if (contractPaymentAmount > 0) {
          await client.query(
            `INSERT INTO contract_payment_purpose_details(
               id,contract_id,payment_record_id,external_payment_record_id,
               purpose,amount,funding_source,engineering_allocation_amount,
               technology_self_funded_amount,created_by,updated_by,
               created_at,updated_at
             ) VALUES($1,$2,$3,$4,'contract_payment',$5,'pending_review',
               0,0,$6,$6,$7,$7)`,
            [
              nanoid(),
              req.params.id,
              paymentTarget.kind === "payment" ? paymentTarget.id : null,
              paymentTarget.kind === "external_payment"
                ? paymentTarget.id
                : null,
              contractPaymentAmount,
              currentActor.id,
              now,
            ],
          );
        }
        await client.query(
          `INSERT INTO contract_payment_purpose_details(
             id,contract_id,payment_record_id,external_payment_record_id,
             purpose,amount,funding_source,engineering_allocation_amount,
             technology_self_funded_amount,created_by,updated_by,
             created_at,updated_at
           ) VALUES($1,$2,$3,$4,'lease_deposit',$5,$6,$7,$8,$9,$9,$10,$10)`,
          [
            nanoid(),
            req.params.id,
            paymentTarget.kind === "payment" ? paymentTarget.id : null,
            paymentTarget.kind === "external_payment" ? paymentTarget.id : null,
            amount,
            fundingSource,
            engineeringAllocationAmount,
            technologySelfFundedAmount,
            currentActor.id,
            now,
          ],
        );
        await rebuildDepositAffectedFinancialMatches(
          client,
          req.params.id,
          paymentTarget,
          now,
        );
      }
      await client.query(
        `INSERT INTO contract_audit_logs(
           id,contract_id,action,actor_id,actor_role,from_status,to_status,
           changes_json,comment,created_at
         ) SELECT $1,contract.id,'contract_deposit_saved',$2,$3,status,status,
           $4::jsonb,$5,$6 FROM contracts contract WHERE contract.id=$7`,
        [
          nanoid(),
          currentActor.id,
          currentActor.role,
          JSON.stringify({
            depositId: id,
            amount,
            fundingSource,
            paymentRecordId: paymentTarget?.id || null,
          }),
          "保存租赁合同押金记录",
          now,
          req.params.id,
        ],
      );
      return loadContractDepositSnapshot(client, req.params.id);
    });
    res.json({ success: true, data: snapshot });
  } catch (error) {
    sendError(res, error, "保存押金记录失败");
  }
});

router.post("/:id/deposit/settlements", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const type = String(req.body.type || "") as ContractDepositSettlementType;
    if (!DEPOSIT_SETTLEMENT_TYPES.has(type)) {
      throw new ContractDomainError(400, "押金结算方式不正确");
    }
    const allowedFields = new Set(
      type === "refund"
        ? ["type", "ocrJobId", "note"]
        : ["type", "amount", "settlementDate", "note"],
    );
    if (Object.keys(req.body || {}).some((key) => !allowedFields.has(key))) {
      throw new ContractDomainError(
        400,
        type === "refund"
          ? "押金退款确认只能提交类型、识别任务和说明"
          : "押金扣款或抵租金只能提交类型、金额、日期和说明",
        "CONTRACT_DEPOSIT_SETTLEMENT_FIELDS_FORBIDDEN",
      );
    }
    const ocrJobId = normalizeNullableText(req.body.ocrJobId);
    if (type === "refund" && !ocrJobId) {
      throw new ContractDomainError(
        400,
        "押金退款必须先上传回单并通过自动识别",
        "CONTRACT_DEPOSIT_REFUND_OCR_JOB_REQUIRED",
      );
    }
    const manualAmount =
      type === "refund"
        ? null
        : parsePositiveAmount(req.body.amount, "押金结算金额");
    const manualSettlementDate =
      type === "refund"
        ? null
        : normalizeDepositDate(req.body.settlementDate, "押金结算日期");
    const note = normalizeNullableText(req.body.note);
    if (type !== "refund" && !note) {
      throw new ContractDomainError(
        400,
        "登记押金扣款或抵租金时必须填写说明",
        "CONTRACT_DEPOSIT_NON_REFUND_NOTE_REQUIRED",
      );
    }
    if ((note?.length || 0) > 1000) {
      throw new ContractDomainError(400, "押金结算说明不能超过1000字");
    }
    const now = new Date().toISOString();
    const snapshot = await db.transaction(async (client) => {
      await lockDepositContract(client, req.params.id);
      const locked = await client.query<ContractDepositRow>(
        `SELECT * FROM contract_deposits WHERE contract_id=$1 FOR UPDATE`,
        [req.params.id],
      );
      const deposit = locked.rows[0];
      if (!deposit) throw new ContractDomainError(404, "押金记录不存在");
      if (deposit.funding_source === "pending_review") {
        throw new ContractDomainError(409, "请先确认押金资金来源");
      }
      let depositReturnOcr: {
        job: LockedDepositReturnOcrJob;
        fields: DepositReturnOcrFields;
      } | null = null;
      if (type === "refund") {
        const context = await resolveDepositReturnRecognitionContext(client, {
          contractId: req.params.id,
          businessPurpose: "deposit_refund",
          targetId: deposit.id,
        });
        depositReturnOcr = await lockVerifiedDepositReturnOcrJob(client, {
          contractId: req.params.id,
          jobId: ocrJobId!,
          context,
        });
      }
      const amount = depositReturnOcr?.fields.amount ?? manualAmount!;
      const amountCents = toCents(String(amount));
      const settlementDate =
        depositReturnOcr?.fields.paymentTime ?? manualSettlementDate!;
      const depositAmountCents = toCents(String(deposit.amount));
      const settledAmountCents = toCents(String(deposit.settled_amount));
      const result = validateContractDepositSettlement({
        status: deposit.status,
        type,
        amountCents,
        depositAmountCents,
        settledAmountCents,
      });
      const previous = await client.query<{
        refund_amount: number;
        required_amount: number;
      }>(
        `SELECT COALESCE(SUM(amount) FILTER(WHERE settlement_type='refund'),0)
           AS refund_amount,
           COALESCE(SUM(engineering_return_required_amount),0) AS required_amount
         FROM contract_deposit_settlements WHERE deposit_id=$1`,
        [deposit.id],
      );
      const engineeringReturnRequiredCents = calculateEngineeringReturnRequired(
        {
          settlementType: type,
          refundAmountCents: amountCents,
          depositAmountCents,
          engineeringAllocationAmountCents:
            type === "refund" && deposit.external_payment_record_id
              ? toCents(String(deposit.engineering_allocation_amount || 0))
              : 0,
          previousRefundAmountCents: toCents(
            String(previous.rows[0]?.refund_amount || 0),
          ),
          previousEngineeringReturnRequiredCents: toCents(
            String(previous.rows[0]?.required_amount || 0),
          ),
        },
      );
      const settlementId = nanoid();
      await client.query(
        `INSERT INTO contract_deposit_settlements(
           id,deposit_id,contract_id,settlement_type,amount,settlement_date,
           note,engineering_return_required_amount,created_by,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          settlementId,
          deposit.id,
          req.params.id,
          type,
          amount,
          settlementDate,
          note,
          centsToAmount(engineeringReturnRequiredCents),
          currentActor.id,
          now,
        ],
      );
      const refundReceipt = depositReturnOcr
        ? await insertContractDepositSettlementReceipt(client, {
            settlementId,
            contractId: req.params.id,
            kind: "deposit_refund",
            amount,
            transactionDate: settlementDate,
            file: storedUploadFromDepositReturnJob(depositReturnOcr.job),
            fileId: depositReturnOcr.job.file_id,
            financialOcrJobId: depositReturnOcr.job.id,
            electronicReceiptNo: depositReturnOcr.fields.electronicReceiptNo,
            payer: depositReturnOcr.fields.payer,
            payerAccount: depositReturnOcr.fields.payerAccount,
            payee: depositReturnOcr.fields.payee,
            payeeAccount: depositReturnOcr.fields.payeeAccount,
            recognitionMethod:
              depositReturnOcr.job.recognition_method || undefined,
            ocrEngineVersion: depositReturnOcr.job.engine_version || undefined,
            ocrParserVersion: depositReturnOcr.job.parser_version || undefined,
            evidenceTextHash:
              depositReturnOcr.job.evidence_text_hash || undefined,
            uploadedBy: depositReturnOcr.job.requested_by,
            createdAt: now,
          })
        : null;
      if (depositReturnOcr && refundReceipt) {
        await client.query(
          `UPDATE contract_financial_ocr_jobs SET
               status='consumed',record_id=$2,consumed_at=$3,updated_at=$3
             WHERE id=$1 AND status='verified'`,
          [depositReturnOcr.job.id, refundReceipt.id, now],
        );
      }
      const rentOffsetPurpose =
        type === "rent_offset"
          ? await applyDepositRentOffsetPurpose(client, {
              contractId: req.params.id,
              deposit,
              offsetAmountCents: amountCents,
              actorId: currentActor.id,
              now,
            })
          : null;
      await client.query(
        `UPDATE contract_deposits SET settled_amount=$2,status=$3,
           updated_by=$4,updated_at=$5 WHERE id=$1`,
        [
          deposit.id,
          centsToAmount(result.nextSettledAmountCents),
          result.nextStatus,
          currentActor.id,
          now,
        ],
      );
      await client.query(
        `INSERT INTO contract_audit_logs(
           id,contract_id,action,actor_id,actor_role,from_status,to_status,
           changes_json,comment,created_at
         ) SELECT $1,contract.id,'contract_deposit_settled',$2,$3,status,status,
           $4::jsonb,$5,$6 FROM contracts contract WHERE contract.id=$7`,
        [
          nanoid(),
          currentActor.id,
          currentActor.role,
          JSON.stringify({
            depositId: deposit.id,
            settlementId,
            type,
            amount,
            engineeringReturnRequired: centsToAmount(
              engineeringReturnRequiredCents,
            ),
            refundReceiptId: refundReceipt?.id || null,
            refundReceiptFileName: refundReceipt?.file_name || null,
            refundReceiptFileHash: refundReceipt?.file_hash || null,
            electronicReceiptNo: refundReceipt?.electronic_receipt_no || null,
            ocrJobId: depositReturnOcr?.job.id || null,
            recognitionMethod: depositReturnOcr?.job.recognition_method || null,
            engineVersion: depositReturnOcr?.job.engine_version || null,
            parserVersion: depositReturnOcr?.job.parser_version || null,
            rentOffsetPurpose,
          }),
          "登记押金退回、扣款或抵租金",
          now,
          req.params.id,
        ],
      );
      return loadContractDepositSnapshot(client, req.params.id);
    });
    res.json({ success: true, data: snapshot });
  } catch (error) {
    const commitOutcomeUncertain = Boolean(
      error &&
      typeof error === "object" &&
      "commitOutcomeUncertain" in error &&
      (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
    );
    if (commitOutcomeUncertain) {
      res.status(500).json({
        success: false,
        code: "CONTRACT_DEPOSIT_SETTLEMENT_COMMIT_OUTCOME_UNCERTAIN",
        message: "押金结算结果暂时无法确认；请刷新押金状态后再操作，勿重复确认",
      });
      return;
    }
    sendError(res, error, "登记押金结算失败");
  }
});

router.post(
  "/:id/deposit/settlements/:settlementId/engineering-return",
  requireFinance,
  async (req, res) => {
    try {
      if (
        Object.keys(req.body || {}).some(
          (key) => !new Set(["ocrJobId", "note"]).has(key),
        )
      ) {
        throw new ContractDomainError(
          400,
          "退工程确认只能提交识别任务和说明",
          "CONTRACT_DEPOSIT_ENGINEERING_RETURN_FIELDS_FORBIDDEN",
        );
      }
      const ocrJobId = normalizeNullableText(req.body.ocrJobId);
      if (!ocrJobId) {
        throw new ContractDomainError(
          400,
          "退工程登记必须先上传回单并通过自动识别",
          "CONTRACT_DEPOSIT_ENGINEERING_RETURN_OCR_JOB_REQUIRED",
        );
      }
      const currentActor = actor(req);
      const note = normalizeNullableText(req.body.note);
      if ((note?.length || 0) > 1000) {
        throw new ContractDomainError(400, "退回工程说明不能超过1000字");
      }
      const now = new Date().toISOString();
      const snapshot = await db.transaction(async (client) => {
        const context = await resolveDepositReturnRecognitionContext(client, {
          contractId: req.params.id,
          businessPurpose: "engineering_return",
          targetId: req.params.settlementId,
        });
        const recognized = await lockVerifiedDepositReturnOcrJob(client, {
          contractId: req.params.id,
          jobId: ocrJobId,
          context,
        });
        const settlementResult =
          await client.query<ContractDepositSettlementRow>(
            `SELECT * FROM contract_deposit_settlements
             WHERE id=$1 AND contract_id=$2 FOR UPDATE`,
            [req.params.settlementId, req.params.id],
          );
        const settlement = settlementResult.rows[0]!;
        const amount = recognized.fields.amount;
        const returnDate = recognized.fields.paymentTime;
        const nextReturned =
          Number(settlement.engineering_returned_amount || 0) + amount;
        if (
          nextReturned > Number(settlement.engineering_return_required_amount)
        ) {
          throw new ContractDomainError(409, "退回工程金额不能超过应退金额");
        }
        await client.query(
          `UPDATE contract_deposit_settlements SET
             engineering_returned_amount=$2,engineering_returned_at=$3,
             engineering_return_note=$4,engineering_returned_by=$5
           WHERE id=$1`,
          [settlement.id, nextReturned, returnDate, note, currentActor.id],
        );
        const engineeringReturnReceipt =
          await insertContractDepositSettlementReceipt(client, {
            settlementId: settlement.id,
            contractId: req.params.id,
            kind: "engineering_return",
            amount,
            transactionDate: returnDate,
            file: storedUploadFromDepositReturnJob(recognized.job),
            fileId: recognized.job.file_id,
            financialOcrJobId: recognized.job.id,
            electronicReceiptNo: recognized.fields.electronicReceiptNo,
            payer: recognized.fields.payer,
            payerAccount: recognized.fields.payerAccount,
            payee: recognized.fields.payee,
            payeeAccount: recognized.fields.payeeAccount,
            recognitionMethod: recognized.job.recognition_method || undefined,
            ocrEngineVersion: recognized.job.engine_version || undefined,
            ocrParserVersion: recognized.job.parser_version || undefined,
            evidenceTextHash: recognized.job.evidence_text_hash || undefined,
            uploadedBy: recognized.job.requested_by,
            createdAt: now,
          });
        await client.query(
          `UPDATE contract_financial_ocr_jobs SET
             status='consumed',record_id=$2,consumed_at=$3,updated_at=$3
           WHERE id=$1 AND status='verified'`,
          [recognized.job.id, engineeringReturnReceipt.id, now],
        );
        await client.query(
          `INSERT INTO contract_audit_logs(
             id,contract_id,action,actor_id,actor_role,from_status,to_status,
             changes_json,comment,created_at
           ) SELECT $1,contract.id,'contract_deposit_engineering_returned',
             $2,$3,status,status,$4::jsonb,$5,$6
             FROM contracts contract WHERE contract.id=$7`,
          [
            nanoid(),
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              settlementId: settlement.id,
              amount,
              returnDate,
              engineeringReturnedAmount: nextReturned,
              engineeringReturnReceiptId: engineeringReturnReceipt.id,
              engineeringReturnReceiptFileName:
                engineeringReturnReceipt.file_name,
              engineeringReturnReceiptFileHash:
                engineeringReturnReceipt.file_hash,
              electronicReceiptNo: recognized.fields.electronicReceiptNo,
              ocrJobId: recognized.job.id,
              recognitionMethod: recognized.job.recognition_method,
              engineVersion: recognized.job.engine_version,
              parserVersion: recognized.job.parser_version,
            }),
            "登记科技退回工程咨询公司的押金划拨资金",
            now,
            req.params.id,
          ],
        );
        return loadContractDepositSnapshot(client, req.params.id);
      });
      res.json({ success: true, data: snapshot });
    } catch (error) {
      const commitOutcomeUncertain = Boolean(
        error &&
        typeof error === "object" &&
        "commitOutcomeUncertain" in error &&
        (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
      );
      if (commitOutcomeUncertain) {
        res.status(500).json({
          success: false,
          code: "CONTRACT_DEPOSIT_ENGINEERING_RETURN_COMMIT_OUTCOME_UNCERTAIN",
          message:
            "退工程登记结果暂时无法确认；请刷新押金状态后再操作，勿重复确认",
        });
        return;
      }
      sendError(res, error, "登记退回工程资金失败");
    }
  },
);

router.post(
  "/:id/deposit/settlements/:settlementId/refund-receipt",
  requireFinance,
  async (req, res) => {
    try {
      if (Object.keys(req.body || {}).some((key) => key !== "ocrJobId")) {
        throw new ContractDomainError(
          400,
          "补传押金退回回单时只能提交识别任务",
          "CONTRACT_DEPOSIT_REFUND_RECEIPT_FIELDS_FORBIDDEN",
        );
      }
      const ocrJobId = normalizeNullableText(req.body.ocrJobId);
      if (!ocrJobId) {
        throw new ContractDomainError(
          400,
          "补传押金退回回单必须先完成自动识别",
          "CONTRACT_DEPOSIT_REFUND_OCR_JOB_REQUIRED",
        );
      }
      const currentActor = actor(req);
      const now = new Date().toISOString();
      const snapshot = await db.transaction(async (client) => {
        const context = await resolveDepositReturnRecognitionContext(client, {
          contractId: req.params.id,
          businessPurpose: "deposit_refund",
          targetId: req.params.settlementId,
        });
        const recognized = await lockVerifiedDepositReturnOcrJob(client, {
          contractId: req.params.id,
          jobId: ocrJobId,
          context,
        });
        const settlementResult =
          await client.query<ContractDepositSettlementRow>(
            `SELECT * FROM contract_deposit_settlements
             WHERE id=$1 AND contract_id=$2 FOR UPDATE`,
            [req.params.settlementId, req.params.id],
          );
        const settlement = settlementResult.rows[0]!;
        if (
          toCents(String(recognized.fields.amount)) !==
            toCents(String(settlement.amount)) ||
          recognized.fields.paymentTime !== settlement.settlement_date
        ) {
          throw new ContractDomainError(
            422,
            "回单识别金额和日期必须与历史押金退款记录完全一致",
            "CONTRACT_DEPOSIT_REFUND_RECEIPT_HISTORY_MISMATCH",
          );
        }
        const refundReceipt = await insertContractDepositSettlementReceipt(
          client,
          {
            settlementId: settlement.id,
            contractId: req.params.id,
            kind: "deposit_refund",
            amount: Number(settlement.amount),
            transactionDate: settlement.settlement_date,
            file: storedUploadFromDepositReturnJob(recognized.job),
            fileId: recognized.job.file_id,
            financialOcrJobId: recognized.job.id,
            electronicReceiptNo: recognized.fields.electronicReceiptNo,
            payer: recognized.fields.payer,
            payerAccount: recognized.fields.payerAccount,
            payee: recognized.fields.payee,
            payeeAccount: recognized.fields.payeeAccount,
            recognitionMethod: recognized.job.recognition_method || undefined,
            ocrEngineVersion: recognized.job.engine_version || undefined,
            ocrParserVersion: recognized.job.parser_version || undefined,
            evidenceTextHash: recognized.job.evidence_text_hash || undefined,
            uploadedBy: recognized.job.requested_by,
            createdAt: now,
          },
        );
        await client.query(
          `UPDATE contract_financial_ocr_jobs SET
             status='consumed',record_id=$2,consumed_at=$3,updated_at=$3
           WHERE id=$1 AND status='verified'`,
          [recognized.job.id, refundReceipt.id, now],
        );
        await client.query(
          `INSERT INTO contract_audit_logs(
             id,contract_id,action,actor_id,actor_role,from_status,to_status,
             changes_json,comment,created_at
           ) SELECT $1,contract.id,
             'contract_deposit_refund_receipt_attached',$2,$3,status,status,
             $4::jsonb,$5,$6 FROM contracts contract WHERE contract.id=$7`,
          [
            nanoid(),
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              settlementId: settlement.id,
              settlementAmount: Number(settlement.amount),
              settlementDate: settlement.settlement_date,
              refundReceiptId: refundReceipt.id,
              refundReceiptFileName: refundReceipt.file_name,
              refundReceiptFileHash: refundReceipt.file_hash,
              electronicReceiptNo: recognized.fields.electronicReceiptNo,
              ocrJobId: recognized.job.id,
              recognitionMethod: recognized.job.recognition_method,
              engineVersion: recognized.job.engine_version,
              parserVersion: recognized.job.parser_version,
              existingSettlementUnchanged: true,
            }),
            "为历史押金退款记录补传押金退回回单",
            now,
            req.params.id,
          ],
        );
        return loadContractDepositSnapshot(client, req.params.id);
      });
      res.json({ success: true, data: snapshot });
    } catch (error) {
      const commitOutcomeUncertain = Boolean(
        error &&
        typeof error === "object" &&
        "commitOutcomeUncertain" in error &&
        (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
      );
      if (commitOutcomeUncertain) {
        res.status(500).json({
          success: false,
          code: "CONTRACT_DEPOSIT_REFUND_RECEIPT_COMMIT_OUTCOME_UNCERTAIN",
          message:
            "押金退回回单补传结果暂时无法确认；请刷新押金状态后再操作，勿重复确认",
        });
        return;
      }
      sendError(res, error, "补传押金退回回单失败");
    }
  },
);

router.delete(
  "/:id/deposit/settlements/:settlementId/receipts/:receiptId",
  requireFinance,
  async (req, res) => {
    let committed = false;
    try {
      const currentActor = actor(req);
      const now = new Date().toISOString();
      const result = await db.transaction(async (client) => {
        await lockDepositContract(client, req.params.id);
        const settlementResult =
          await client.query<ContractDepositSettlementRow>(
            `SELECT * FROM contract_deposit_settlements
             WHERE id=$1 AND contract_id=$2 FOR UPDATE`,
            [req.params.settlementId, req.params.id],
          );
        const settlement = settlementResult.rows[0];
        if (!settlement) {
          throw new ContractDomainError(404, "押金结算记录不存在");
        }
        const receiptResult =
          await client.query<ContractDepositSettlementReceiptRow>(
            `SELECT * FROM contract_deposit_settlement_receipts
             WHERE id=$1 AND settlement_id=$2 AND contract_id=$3
             FOR UPDATE`,
            [req.params.receiptId, settlement.id, req.params.id],
          );
        const receipt = receiptResult.rows[0];
        if (!receipt) {
          throw new ContractDomainError(404, "押金结算回单不存在");
        }
        let linkedArtifact: {
          job_id: string;
          file_id: string;
          file_path: string;
        } | null = null;
        if (receipt.financial_ocr_job_id || receipt.file_id) {
          if (!receipt.financial_ocr_job_id || !receipt.file_id) {
            throw new ContractDomainError(
              409,
              "回单识别证据链不完整，禁止删除",
              "CONTRACT_DEPOSIT_RECEIPT_OCR_LINK_INCOMPLETE",
            );
          }
          const artifactResult = await client.query<{
            job_id: string;
            file_id: string;
            file_path: string;
          }>(
            `SELECT job.id AS job_id,file.id AS file_id,file.file_path
             FROM contract_financial_ocr_jobs job
             JOIN contract_files file ON file.id=job.file_id
             WHERE job.id=$1 AND file.id=$2 AND job.contract_id=$3
               AND job.record_id=$4 AND job.status='consumed'
               AND job.business_purpose=$5
               AND (
                 ($5='engineering_return' AND job.target_id=$6)
                 OR ($5='deposit_refund'
                   AND job.target_id IN ($6,$7))
               )
             FOR UPDATE OF job,file`,
            [
              receipt.financial_ocr_job_id,
              receipt.file_id,
              req.params.id,
              receipt.id,
              receipt.receipt_kind,
              settlement.id,
              settlement.deposit_id,
            ],
          );
          linkedArtifact = artifactResult.rows[0] || null;
          if (!linkedArtifact) {
            throw new ContractDomainError(
              409,
              "回单识别任务与合同、结算或文件不一致，禁止删除",
              "CONTRACT_DEPOSIT_RECEIPT_OCR_LINK_MISMATCH",
            );
          }
        }
        if (receipt.receipt_kind === "deposit_refund") {
          const downstream = await client.query<{ id: string }>(
            `SELECT id FROM contract_deposit_settlement_receipts
             WHERE settlement_id=$1 AND contract_id=$2
               AND receipt_kind='engineering_return'
             ORDER BY created_at,id LIMIT 1 FOR UPDATE`,
            [settlement.id, req.params.id],
          );
          if (downstream.rows[0]) {
            throw new ContractDomainError(
              409,
              "该押金退款已有退工程回单，请先删除全部退工程回单",
              "CONTRACT_DEPOSIT_REFUND_RECEIPT_HAS_ENGINEERING_RETURN",
            );
          }
        }
        const engineeringReturnedAmountBefore = Number(
          settlement.engineering_returned_amount || 0,
        );
        await client.query(
          `DELETE FROM contract_deposit_settlement_receipts
           WHERE id=$1 AND settlement_id=$2 AND contract_id=$3`,
          [receipt.id, settlement.id, req.params.id],
        );
        let engineeringReturnedAmountAfter = engineeringReturnedAmountBefore;
        if (receipt.receipt_kind === "engineering_return") {
          const remaining = await client.query<{
            returned_amount: number;
            returned_at: string | null;
            returned_by: string | null;
          }>(
            `SELECT COALESCE(SUM(amount),0) AS returned_amount,
               (ARRAY_AGG(transaction_date ORDER BY
                 transaction_date DESC,created_at DESC,id DESC))[1]
                 AS returned_at,
               (ARRAY_AGG(uploaded_by ORDER BY
                 transaction_date DESC,created_at DESC,id DESC))[1]
                 AS returned_by
             FROM contract_deposit_settlement_receipts
             WHERE settlement_id=$1 AND contract_id=$2
               AND receipt_kind='engineering_return'`,
            [settlement.id, req.params.id],
          );
          engineeringReturnedAmountAfter = Number(
            remaining.rows[0]?.returned_amount || 0,
          );
          await client.query(
            `UPDATE contract_deposit_settlements SET
               engineering_returned_amount=$2,
               engineering_returned_at=$3,
               engineering_returned_by=$4,
               engineering_return_note=NULL
             WHERE id=$1 AND contract_id=$5`,
            [
              settlement.id,
              engineeringReturnedAmountAfter,
              remaining.rows[0]?.returned_at || null,
              remaining.rows[0]?.returned_by || null,
              req.params.id,
            ],
          );
        }
        await client.query(
          `INSERT INTO contract_audit_logs(
             id,contract_id,action,actor_id,actor_role,from_status,to_status,
             changes_json,comment,created_at
           ) SELECT $1,contract.id,
             'contract_deposit_settlement_receipt_deleted',$2,$3,
             status,status,$4::jsonb,$5,$6
             FROM contracts contract WHERE contract.id=$7`,
          [
            nanoid(),
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              settlementId: settlement.id,
              receiptId: receipt.id,
              receiptKind: receipt.receipt_kind,
              fileName: receipt.file_name,
              fileHash: receipt.file_hash,
              amount: Number(receipt.amount),
              transactionDate: receipt.transaction_date,
              electronicReceiptNo: receipt.electronic_receipt_no,
              ocrJobId: receipt.financial_ocr_job_id,
              fileId: receipt.file_id,
              engineeringReturnedAmountBefore,
              engineeringReturnedAmountAfter,
              hardDeleted: true,
            }),
            receipt.receipt_kind === "deposit_refund"
              ? "删除押金退回回单"
              : "删除退工程回单并重算累计退回金额",
            now,
            req.params.id,
          ],
        );
        if (linkedArtifact) {
          await client.query(
            `DELETE FROM contract_financial_file_hashes WHERE file_id=$1`,
            [linkedArtifact.file_id],
          );
          await client.query(
            `DELETE FROM contract_financial_ocr_jobs WHERE id=$1`,
            [linkedArtifact.job_id],
          );
          await client.query(`DELETE FROM contract_files WHERE id=$1`, [
            linkedArtifact.file_id,
          ]);
        }
        return {
          removed: receipt,
          snapshot: await loadContractDepositSnapshot(client, req.params.id),
        };
      });
      committed = true;
      await cleanupStoredFinancialFiles([result.removed.file_path], {
        contractId: req.params.id,
        settlementId: req.params.settlementId,
        settlementReceiptId: req.params.receiptId,
      });
      res.json({ success: true, data: result.snapshot });
    } catch (error) {
      const commitOutcomeUncertain = Boolean(
        error &&
        typeof error === "object" &&
        "commitOutcomeUncertain" in error &&
        (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
      );
      if (commitOutcomeUncertain) {
        res.status(500).json({
          success: false,
          code: "CONTRACT_DEPOSIT_RECEIPT_DELETE_COMMIT_OUTCOME_UNCERTAIN",
          message:
            "回单删除结果暂时无法确认；已保留物理文件，请刷新押金状态后再操作",
        });
        return;
      }
      if (committed) {
        res.status(500).json({
          success: false,
          code: "CONTRACT_DEPOSIT_RECEIPT_DELETED_REFRESH_REQUIRED",
          message: "回单已删除，请刷新押金状态",
        });
        return;
      }
      sendError(res, error, "删除押金结算回单失败");
    }
  },
);

router.get(
  "/:id/deposit/settlements/:settlementId/receipts/:receiptId/file",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const receipt = await db.get<ContractDepositSettlementReceiptRow>(
        `SELECT receipt.*
         FROM contract_deposit_settlement_receipts receipt
         JOIN contract_deposit_settlements settlement
           ON settlement.id=receipt.settlement_id
           AND settlement.contract_id=receipt.contract_id
         JOIN contracts contract ON contract.id=receipt.contract_id
         WHERE receipt.id=? AND receipt.settlement_id=?
           AND receipt.contract_id=? AND contract.is_deleted=FALSE`,
        req.params.receiptId,
        req.params.settlementId,
        req.params.id,
      );
      if (!receipt) {
        throw new ContractDomainError(404, "押金退回回单不存在");
      }
      if (!validateFilePath(receipt.file_path)) {
        throw new ContractDomainError(403, "押金退回回单文件路径不安全");
      }
      const storedPath = receipt.file_path.startsWith("/")
        ? receipt.file_path.slice(1)
        : receipt.file_path;
      const absolutePath = path.resolve(process.cwd(), storedPath);
      let fileStats: fs.Stats;
      try {
        fileStats = await fs.promises.stat(absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new ContractDomainError(404, "押金退回回单文件已丢失");
        }
        throw error;
      }
      if (!fileStats.isFile()) {
        throw new ContractDomainError(404, "押金退回回单文件已丢失");
      }
      await db.run(
        `INSERT INTO contract_audit_logs(
           id,contract_id,action,actor_id,actor_role,from_status,to_status,
           changes_json,created_at
         ) SELECT ?,contract.id,
           'contract_deposit_settlement_receipt_previewed',?,?,status,status,
           ?::jsonb,? FROM contracts contract WHERE contract.id=?`,
        nanoid(),
        currentActor.id,
        currentActor.role,
        JSON.stringify({
          settlementId: receipt.settlement_id,
          receiptId: receipt.id,
          receiptKind: receipt.receipt_kind,
          amount: Number(receipt.amount),
          transactionDate: receipt.transaction_date,
          fileName: receipt.file_name,
        }),
        new Date().toISOString(),
        receipt.contract_id,
      );
      res.setHeader("Content-Type", receipt.mime_type);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(receipt.file_name)}`,
      );
      res.sendFile(absolutePath);
    } catch (error) {
      if (!res.headersSent) sendError(res, error, "读取押金退回回单失败");
    }
  },
);

function purposeDetailsRecordColumn(kind: DepositPaymentKind): string {
  return kind === "payment"
    ? "payment_record_id"
    : "external_payment_record_id";
}

async function applyDepositRentOffsetPurpose(
  client: PoolClient,
  input: {
    contractId: string;
    deposit: ContractDepositRow;
    offsetAmountCents: number;
    actorId: string;
    now: string;
  },
): Promise<{
  paymentRecordId: string;
  paymentKind: DepositPaymentKind;
  contractPaymentAmount: number;
  remainingDepositPurposeAmount: number;
}> {
  const linkedPaymentRecordId =
    input.deposit.payment_record_id || input.deposit.external_payment_record_id;
  if (!linkedPaymentRecordId) {
    throw new ContractDomainError(
      409,
      "押金尚未关联实际付款回单，不能办理抵租金",
      "CONTRACT_DEPOSIT_RENT_OFFSET_PAYMENT_REQUIRED",
    );
  }
  const target = await lockDepositPaymentTarget(
    client,
    input.contractId,
    linkedPaymentRecordId,
  );
  const recordColumn = purposeDetailsRecordColumn(target.kind);
  const existingPurposeRows = await client.query<{
    purpose: ContractExternalPaymentPurpose;
    amount: number;
  }>(
    `SELECT purpose,amount FROM contract_payment_purpose_details
     WHERE contract_id=$1 AND ${recordColumn}=$2
     ORDER BY CASE purpose WHEN 'contract_payment' THEN 0 ELSE 1 END
     FOR UPDATE`,
    [input.contractId, target.id],
  );
  const storedDepositPurpose = existingPurposeRows.rows.find(
    (row) => row.purpose === "lease_deposit",
  );
  const currentDepositPurposeCents = storedDepositPurpose
    ? toCents(String(storedDepositPurpose.amount))
    : existingPurposeRows.rows.length
      ? 0
      : toCents(String(input.deposit.amount));
  if (input.offsetAmountCents > currentDepositPurposeCents) {
    throw new ContractDomainError(
      409,
      "抵租金金额不能超过付款中尚未转换的押金金额",
      "CONTRACT_DEPOSIT_RENT_OFFSET_EXCEEDS_PURPOSE",
    );
  }
  const remainingDepositPurposeCents =
    currentDepositPurposeCents - input.offsetAmountCents;
  const paymentAmountCents = toCents(String(target.amount));
  const contractPaymentCents =
    paymentAmountCents - remainingDepositPurposeCents;
  await client.query(
    `DELETE FROM contract_payment_purpose_details
     WHERE contract_id=$1 AND ${recordColumn}=$2`,
    [input.contractId, target.id],
  );
  await client.query(
    `INSERT INTO contract_payment_purpose_details(
       id,contract_id,payment_record_id,external_payment_record_id,
       purpose,amount,funding_source,engineering_allocation_amount,
       technology_self_funded_amount,created_by,updated_by,
       created_at,updated_at
     ) VALUES($1,$2,$3,$4,'contract_payment',$5,'pending_review',
       0,0,$6,$6,$7,$7)`,
    [
      nanoid(),
      input.contractId,
      target.kind === "payment" ? target.id : null,
      target.kind === "external_payment" ? target.id : null,
      centsToAmount(contractPaymentCents),
      input.actorId,
      input.now,
    ],
  );
  if (remainingDepositPurposeCents > 0) {
    const depositAmountCents = toCents(String(input.deposit.amount));
    const originalEngineeringCents = toCents(
      String(input.deposit.engineering_allocation_amount || 0),
    );
    const remainingEngineeringCents = Math.round(
      (remainingDepositPurposeCents * originalEngineeringCents) /
        depositAmountCents,
    );
    const remainingTechnologyCents =
      remainingDepositPurposeCents - remainingEngineeringCents;
    const remainingFundingSource: ContractDepositFundingSource =
      remainingEngineeringCents <= 0
        ? "technology_self_funded"
        : remainingTechnologyCents <= 0
          ? "engineering_allocation"
          : "mixed";
    await client.query(
      `INSERT INTO contract_payment_purpose_details(
         id,contract_id,payment_record_id,external_payment_record_id,
         purpose,amount,funding_source,engineering_allocation_amount,
         technology_self_funded_amount,created_by,updated_by,
         created_at,updated_at
       ) VALUES($1,$2,$3,$4,'lease_deposit',$5,$6,$7,$8,$9,$9,$10,$10)`,
      [
        nanoid(),
        input.contractId,
        target.kind === "payment" ? target.id : null,
        target.kind === "external_payment" ? target.id : null,
        centsToAmount(remainingDepositPurposeCents),
        remainingFundingSource,
        centsToAmount(remainingEngineeringCents),
        centsToAmount(remainingTechnologyCents),
        input.actorId,
        input.now,
      ],
    );
  }
  await rebuildDepositAffectedFinancialMatches(
    client,
    input.contractId,
    target,
    input.now,
  );
  return {
    paymentRecordId: target.id,
    paymentKind: target.kind,
    contractPaymentAmount: centsToAmount(contractPaymentCents),
    remainingDepositPurposeAmount: centsToAmount(remainingDepositPurposeCents),
  };
}

async function rebuildDepositAffectedFinancialMatches(
  client: PoolClient,
  contractId: string,
  target: DepositPaymentTarget,
  now: string,
): Promise<void> {
  const itemKind =
    target.kind === "external_payment" ? "external_payment" : "payment";
  const paymentTable =
    target.kind === "external_payment"
      ? "contract_external_payments"
      : "contract_payments";
  const purposeRecordColumn =
    target.kind === "external_payment"
      ? "external_payment_record_id"
      : "payment_record_id";
  const registrations = await client.query<{ registration_id: string }>(
    `SELECT item.registration_id
     FROM contract_financial_registration_items item
     WHERE item.contract_id=$1 AND item.item_kind=$2 AND item.record_id=$3`,
    [contractId, itemKind, target.id],
  );
  for (const registration of registrations.rows) {
    await client.query(
      `DELETE FROM contract_financial_registration_matches match
       USING contract_financial_registration_items settlement
       WHERE match.registration_id=$1
         AND settlement.id=match.settlement_item_id
         AND settlement.item_kind=$2`,
      [registration.registration_id, itemKind],
    );
    const invoiceItems = await client.query<{
      item_id: string;
      amount: string | number;
      allocated_amount: string | number;
    }>(
      `SELECT item.id AS item_id,invoice.amount,
         COALESCE((
           SELECT SUM(match.allocated_amount)
           FROM contract_financial_registration_matches match
           WHERE match.invoice_item_id=item.id
         ),0) AS allocated_amount
       FROM contract_financial_registration_items item
       JOIN contract_invoices invoice ON invoice.id=item.record_id
       WHERE item.registration_id=$1 AND item.contract_id=$2
         AND item.item_kind='invoice' AND invoice.status <> 'reversed'
       ORDER BY item.created_at,item.id
       FOR UPDATE OF item,invoice`,
      [registration.registration_id, contractId],
    );
    const settlementItems = await client.query<{
      item_id: string;
      amount: string | number;
      deposit_amount: string | number;
    }>(
      `SELECT item.id AS item_id,payment.amount,
         COALESCE((
           SELECT SUM(detail.amount)
           FROM contract_payment_purpose_details detail
           WHERE detail.${purposeRecordColumn}=payment.id
             AND detail.purpose='lease_deposit'
         ),CASE WHEN EXISTS(
           SELECT 1 FROM contract_payment_purpose_details purpose
           WHERE purpose.${purposeRecordColumn}=payment.id
         ) THEN 0 ELSE (
           SELECT SUM(receipt.confirmed_amount)
           FROM contract_payment_deposit_receipts receipt
           WHERE receipt.${purposeRecordColumn}=payment.id
             AND receipt.status='confirmed'
         ) END,0) AS deposit_amount
       FROM contract_financial_registration_items item
       JOIN ${paymentTable} payment ON payment.id=item.record_id
       WHERE item.registration_id=$1 AND item.contract_id=$2
         AND item.item_kind=$3 AND payment.status <> 'reversed'
       ORDER BY item.created_at,item.id
       FOR UPDATE OF item,payment`,
      [registration.registration_id, contractId, itemKind],
    );
    const availableInvoices = invoiceItems.rows
      .map((item) => ({
        itemId: item.item_id,
        amount: centsToAmount(
          Math.max(
            0,
            toCents(String(item.amount)) -
              toCents(String(item.allocated_amount || 0)),
          ),
        ),
      }))
      .filter((item) => item.amount > 0);
    const availableSettlements = settlementItems.rows
      .map((item) => ({
        itemId: item.item_id,
        amount: centsToAmount(
          Math.max(
            0,
            toCents(String(item.amount)) -
              toCents(String(item.deposit_amount || 0)),
          ),
        ),
      }))
      .filter((item) => item.amount > 0);
    const allocations = allocateAvailableContractFinancialAmounts(
      availableInvoices.map((item) => item.amount),
      availableSettlements.map((item) => item.amount),
    );
    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO contract_financial_registration_matches(
           id,registration_id,contract_id,invoice_item_id,
           settlement_item_id,allocated_amount,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          nanoid(),
          registration.registration_id,
          contractId,
          availableInvoices[allocation.invoiceIndex]!.itemId,
          availableSettlements[allocation.settlementIndex]!.itemId,
          allocation.allocatedAmount,
          now,
        ],
      );
    }
  }
}

async function loadPaymentPurposeDetails(
  contractId: string,
  recordId: string,
  kind: DepositPaymentKind,
) {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT detail.* FROM contract_payment_purpose_details detail
     WHERE detail.contract_id=? AND detail.${purposeDetailsRecordColumn(kind)}=?
     ORDER BY CASE detail.purpose WHEN 'contract_payment' THEN 0 ELSE 1 END`,
    contractId,
    recordId,
  );
  return {
    contractId,
    recordId,
    details: rows.map((row) => ({
      purpose: row.purpose,
      amount: Number(row.amount),
      fundingSource: row.funding_source,
      engineeringAllocationAmount: Number(
        row.engineering_allocation_amount || 0,
      ),
      technologySelfFundedAmount: Number(
        row.technology_self_funded_amount || 0,
      ),
    })),
  };
}

function registerPurposeDetailRoutes(
  kind: DepositPaymentKind,
  resource: "payments" | "external-payments",
) {
  router.get(
    `/:id/${resource}/:recordId/purpose-details`,
    requireContractRead,
    async (req, res) => {
      try {
        await assertContractReadScope(req, req.params.id);
        await db.transaction((client) =>
          lockDepositPaymentTarget(client, req.params.id, req.params.recordId),
        );
        res.json({
          success: true,
          data: await loadPaymentPurposeDetails(
            req.params.id,
            req.params.recordId,
            kind,
          ),
        });
      } catch (error) {
        sendError(res, error, "获取付款用途明细失败");
      }
    },
  );
  router.put(
    `/:id/${resource}/:recordId/purpose-details`,
    requireFinance,
    async (req, res) => {
      try {
        const currentActor = actor(req);
        if (!Array.isArray(req.body.details)) {
          throw new ContractDomainError(400, "付款用途明细格式不正确");
        }
        const details: Array<{
          purpose: ContractExternalPaymentPurpose;
          amount: number;
          amountCents: number;
          fundingSource: ContractDepositFundingSource;
          engineeringAllocationAmount: number;
          technologySelfFundedAmount: number;
        }> = (req.body.details as Record<string, unknown>[]).map((raw) => {
          const purpose = String(
            raw.purpose || "",
          ) as ContractExternalPaymentPurpose;
          if (!new Set(["contract_payment", "lease_deposit"]).has(purpose)) {
            throw new ContractDomainError(400, "付款用途不正确");
          }
          const amount = parsePositiveAmount(raw.amount, "付款用途金额");
          const fundingSource = normalizeDepositFundingSource(
            raw.fundingSource,
          );
          return {
            purpose,
            amount,
            amountCents: toCents(String(amount)),
            fundingSource,
            engineeringAllocationAmount: Number(
              raw.engineeringAllocationAmount || 0,
            ),
            technologySelfFundedAmount: Number(
              raw.technologySelfFundedAmount || 0,
            ),
          };
        });
        const now = new Date().toISOString();
        await db.transaction(async (client) => {
          await lockDepositContract(client, req.params.id);
          const target = await lockDepositPaymentTarget(
            client,
            req.params.id,
            req.params.recordId,
          );
          if (target.kind !== kind) {
            throw new ContractDomainError(409, "付款记录类型与接口不一致");
          }
          validateExternalPaymentPurposeDetails(
            toCents(String(target.amount)),
            details.map((detail) => ({
              purpose: detail.purpose,
              amountCents: detail.amountCents,
              fundingSource: detail.fundingSource,
              engineeringAllocationAmountCents: toCents(
                String(detail.engineeringAllocationAmount),
              ),
              technologySelfFundedAmountCents: toCents(
                String(detail.technologySelfFundedAmount),
              ),
            })),
          );
          await client.query(
            `DELETE FROM contract_payment_purpose_details
             WHERE contract_id=$1 AND ${purposeDetailsRecordColumn(kind)}=$2`,
            [req.params.id, req.params.recordId],
          );
          for (const detail of details) {
            await client.query(
              `INSERT INTO contract_payment_purpose_details(
                 id,contract_id,payment_record_id,external_payment_record_id,
                 purpose,amount,funding_source,engineering_allocation_amount,
                 technology_self_funded_amount,created_by,updated_by,
                 created_at,updated_at
               ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$11)`,
              [
                nanoid(),
                req.params.id,
                kind === "payment" ? target.id : null,
                kind === "external_payment" ? target.id : null,
                detail.purpose,
                detail.amount,
                detail.fundingSource,
                detail.engineeringAllocationAmount,
                detail.technologySelfFundedAmount,
                currentActor.id,
                now,
              ],
            );
          }
          const depositDetail = details.find(
            (detail) => detail.purpose === "lease_deposit",
          );
          const depositResult = await client.query<ContractDepositRow>(
            `SELECT * FROM contract_deposits WHERE contract_id=$1 FOR UPDATE`,
            [req.params.id],
          );
          const deposit = depositResult.rows[0];
          if (depositDetail) {
            if (!deposit) {
              throw new ContractDomainError(
                409,
                "请先依据合同原文建立押金记录，再设置付款用途",
              );
            }
            if (toCents(String(deposit.amount)) !== depositDetail.amountCents) {
              throw new ContractDomainError(
                409,
                "付款中的押金金额必须与合同押金记录一致",
              );
            }
            const nextStatus = deriveContractDepositStatus({
              amountCents: depositDetail.amountCents,
              settledAmountCents: toCents(String(deposit.settled_amount || 0)),
              isPaid: true,
            });
            await client.query(
              `UPDATE contract_deposits SET funding_source=$2,
                 engineering_allocation_amount=$3,
                 technology_self_funded_amount=$4,payment_record_id=$5,
                 external_payment_record_id=$6,paid_at=$7,status=$8,
                 updated_by=$9,updated_at=$10 WHERE id=$1`,
              [
                deposit.id,
                depositDetail.fundingSource,
                depositDetail.engineeringAllocationAmount,
                depositDetail.technologySelfFundedAmount,
                kind === "payment" ? target.id : null,
                kind === "external_payment" ? target.id : null,
                target.paymentDate,
                nextStatus,
                currentActor.id,
                now,
              ],
            );
          } else if (
            deposit &&
            (deposit.payment_record_id === target.id ||
              deposit.external_payment_record_id === target.id)
          ) {
            if (toCents(String(deposit.settled_amount || 0)) > 0) {
              throw new ContractDomainError(
                409,
                "押金已发生结算，不能移除付款中的押金用途",
              );
            }
            await client.query(
              `UPDATE contract_deposits SET payment_record_id=NULL,
                 external_payment_record_id=NULL,paid_at=NULL,
                 status='pending_payment',updated_by=$2,updated_at=$3
               WHERE id=$1`,
              [deposit.id, currentActor.id, now],
            );
          }
          await rebuildDepositAffectedFinancialMatches(
            client,
            req.params.id,
            target,
            now,
          );
          await client.query(
            `INSERT INTO contract_audit_logs(
               id,contract_id,action,actor_id,actor_role,from_status,to_status,
               changes_json,comment,created_at
             ) SELECT $1,contract.id,'contract_payment_purpose_updated',
               $2,$3,status,status,$4::jsonb,$5,$6
               FROM contracts contract WHERE contract.id=$7`,
            [
              nanoid(),
              currentActor.id,
              currentActor.role,
              JSON.stringify({ recordId: target.id, kind, details }),
              "设置合同付款中的合同款、押金及资金来源",
              now,
              req.params.id,
            ],
          );
        });
        res.json({
          success: true,
          data: await loadPaymentPurposeDetails(
            req.params.id,
            req.params.recordId,
            kind,
          ),
        });
      } catch (error) {
        sendError(res, error, "保存付款用途明细失败");
      }
    },
  );
}

registerPurposeDetailRoutes("payment", "payments");
registerPurposeDetailRoutes("external_payment", "external-payments");

router.post(
  "/:id/financial-records/:recordId/deposit-receipts",
  requireFinance,
  uploadSingle,
  async (req, res) => {
    let stored = false;
    try {
      const currentActor = actor(req);
      const file = await validateUploadedFile(req.file, ["pdf", "jpeg", "png"]);
      await db.transaction((client) =>
        lockDepositPaymentTarget(client, req.params.id, req.params.recordId),
      );
      const recognition = await recognizeContractDepositReceipt(
        path.resolve(process.cwd(), file.filePath),
        file.mimeType,
      );
      const receipt = await db.transaction(async (client) => {
        const target = await lockDepositPaymentTarget(
          client,
          req.params.id,
          req.params.recordId,
        );
        const duplicate = await client.query<{ id: string }>(
          `SELECT id FROM contract_payment_deposit_receipts
           WHERE contract_id = $1 AND file_hash = $2 LIMIT 1`,
          [req.params.id, file.fileHash],
        );
        if (duplicate.rows[0]) {
          throw new ContractDomainError(
            409,
            "该押金条已经上传，请勿重复提交",
            "DEPOSIT_RECEIPT_DUPLICATE",
          );
        }
        const id = nanoid();
        const now = new Date().toISOString();
        const inserted = await client.query<DepositReceiptRow>(
          `INSERT INTO contract_payment_deposit_receipts (
             id, contract_id, payment_record_id, external_payment_record_id,
             file_name, file_path, file_size, mime_type, file_hash,
             ocr_status, recognized_amount, ocr_engine_version,
             ocr_text_sha256, ocr_evidence_json, ocr_failure_message,
             status, uploaded_by, created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,
             'pending',$16,$17,$17
           ) RETURNING *`,
          [
            id,
            req.params.id,
            target.kind === "payment" ? target.id : null,
            target.kind === "external_payment" ? target.id : null,
            file.fileName,
            file.filePath,
            file.fileSize,
            file.mimeType,
            file.fileHash,
            recognition.status,
            recognition.amount,
            recognition.engineVersion,
            recognition.textSha256,
            JSON.stringify(recognition.evidence),
            recognition.failureMessage,
            currentActor.id,
            now,
          ],
        );
        await client.query(
          `INSERT INTO contract_audit_logs (
             id, contract_id, action, actor_id, actor_role, from_status,
             to_status, changes_json, created_at
           ) SELECT $1, contract.id, 'deposit_receipt_uploaded', $2, $3,
               contract.status, contract.status, $4::jsonb, $5
             FROM contracts contract WHERE contract.id = $6`,
          [
            nanoid(),
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              depositReceiptId: id,
              paymentRecordId: target.id,
              paymentKind: target.kind,
              originalPaymentAmount: target.amount,
              fileName: file.fileName,
              ocrStatus: recognition.status,
              recognizedAmount: recognition.amount,
            }),
            now,
            req.params.id,
          ],
        );
        return inserted.rows[0]!;
      });
      stored = true;
      receipt.uploaded_by_name = currentActor.name;
      res.status(recognition.status === "recognized" ? 200 : 202).json({
        success: true,
        data: toDepositReceiptApi(receipt),
      });
    } catch (error) {
      if (!stored) cleanupUploadedFile(req.file);
      sendError(res, error, "上传押金条失败");
    }
  },
);

router.post(
  "/:id/financial-records/:recordId/deposit-receipts/:depositReceiptId/verify",
  requireFinance,
  async (req, res) => {
    try {
      if (
        Object.keys(req.body || {}).some((key) => key !== "amount") ||
        req.body?.amount === undefined
      ) {
        throw new ContractDomainError(400, "确认押金条时只能提交押金金额");
      }
      const confirmedAmount = parsePositiveAmount(req.body.amount, "押金金额");
      const currentActor = actor(req);
      const receipt = await db.transaction(async (client) => {
        const locked = await client.query<DepositReceiptRow>(
          `SELECT * FROM contract_payment_deposit_receipts
           WHERE id = $1 AND contract_id = $2
             AND COALESCE(payment_record_id, external_payment_record_id) = $3
           FOR UPDATE`,
          [req.params.depositReceiptId, req.params.id, req.params.recordId],
        );
        const depositReceipt = locked.rows[0];
        if (!depositReceipt) {
          throw new ContractDomainError(404, "押金条不存在");
        }
        if (depositReceipt.status !== "pending") {
          throw new ContractDomainError(
            409,
            depositReceipt.status === "voided"
              ? "押金条已经撤销，不能重新确认"
              : "押金条已经确认，不能重复修改",
            depositReceipt.status === "voided"
              ? "DEPOSIT_RECEIPT_ALREADY_VOIDED"
              : "DEPOSIT_RECEIPT_ALREADY_CONFIRMED",
          );
        }
        const target = await lockDepositPaymentTarget(
          client,
          req.params.id,
          req.params.recordId,
        );
        const totals = await client.query<{ confirmed_amount: number }>(
          `SELECT COALESCE(SUM(confirmed_amount), 0) AS confirmed_amount
           FROM contract_payment_deposit_receipts
           WHERE status = 'confirmed' AND id <> $1
             AND COALESCE(payment_record_id, external_payment_record_id) = $2`,
          [depositReceipt.id, target.id],
        );
        const otherConfirmed = Number(totals.rows[0]?.confirmed_amount || 0);
        if (
          !canConfirmContractDepositAmount(
            target.amount,
            otherConfirmed,
            confirmedAmount,
          )
        ) {
          throw new ContractDomainError(
            422,
            "该付款已确认的押金合计不能超过银行原始付款金额",
            "DEPOSIT_RECEIPT_AMOUNT_EXCEEDS_PAYMENT",
          );
        }
        const confirmationSource =
          depositReceipt.recognized_amount !== null &&
          toCents(String(depositReceipt.recognized_amount)) ===
            toCents(String(confirmedAmount))
            ? "ocr"
            : "manual";
        const now = new Date().toISOString();
        const updated = await client.query<DepositReceiptRow>(
          `UPDATE contract_payment_deposit_receipts
           SET status = 'confirmed', confirmed_amount = $1,
             confirmation_source = $2, confirmed_by = $3,
             confirmed_at = $4, updated_at = $4
           WHERE id = $5 RETURNING *`,
          [
            confirmedAmount,
            confirmationSource,
            currentActor.id,
            now,
            depositReceipt.id,
          ],
        );
        const depositResult = await client.query<ContractDepositRow>(
          `SELECT * FROM contract_deposits WHERE contract_id=$1 FOR UPDATE`,
          [req.params.id],
        );
        const contractDeposit = depositResult.rows[0];
        if (contractDeposit) {
          if (
            toCents(String(contractDeposit.amount)) !==
            toCents(String(confirmedAmount))
          ) {
            throw new ContractDomainError(
              409,
              "押金条确认金额必须与合同押金记录一致",
            );
          }
          await client.query(
            `DELETE FROM contract_payment_purpose_details
             WHERE contract_id=$1 AND ${purposeDetailsRecordColumn(target.kind)}=$2`,
            [req.params.id, target.id],
          );
          const contractPaymentAmount =
            Number(target.amount) - Number(confirmedAmount);
          if (contractPaymentAmount > 0) {
            await client.query(
              `INSERT INTO contract_payment_purpose_details(
                 id,contract_id,payment_record_id,external_payment_record_id,
                 purpose,amount,funding_source,engineering_allocation_amount,
                 technology_self_funded_amount,created_by,updated_by,
                 created_at,updated_at
               ) VALUES($1,$2,$3,$4,'contract_payment',$5,'pending_review',
                 0,0,$6,$6,$7,$7)`,
              [
                nanoid(),
                req.params.id,
                target.kind === "payment" ? target.id : null,
                target.kind === "external_payment" ? target.id : null,
                contractPaymentAmount,
                currentActor.id,
                now,
              ],
            );
          }
          await client.query(
            `INSERT INTO contract_payment_purpose_details(
               id,contract_id,payment_record_id,external_payment_record_id,
               purpose,amount,funding_source,engineering_allocation_amount,
               technology_self_funded_amount,created_by,updated_by,
               created_at,updated_at
             ) VALUES($1,$2,$3,$4,'lease_deposit',$5,$6,$7,$8,$9,$9,$10,$10)`,
            [
              nanoid(),
              req.params.id,
              target.kind === "payment" ? target.id : null,
              target.kind === "external_payment" ? target.id : null,
              confirmedAmount,
              contractDeposit.funding_source,
              contractDeposit.engineering_allocation_amount,
              contractDeposit.technology_self_funded_amount,
              currentActor.id,
              now,
            ],
          );
          await client.query(
            `UPDATE contract_deposits SET payment_record_id=$2,
               external_payment_record_id=$3,paid_at=$4,status=$5,
               updated_by=$6,updated_at=$7 WHERE id=$1`,
            [
              contractDeposit.id,
              target.kind === "payment" ? target.id : null,
              target.kind === "external_payment" ? target.id : null,
              target.paymentDate,
              deriveContractDepositStatus({
                amountCents: toCents(String(contractDeposit.amount)),
                settledAmountCents: toCents(
                  String(contractDeposit.settled_amount || 0),
                ),
                isPaid: true,
              }),
              currentActor.id,
              now,
            ],
          );
        }
        await rebuildDepositAffectedFinancialMatches(
          client,
          req.params.id,
          target,
          now,
        );
        await client.query(
          `INSERT INTO contract_audit_logs (
             id, contract_id, action, actor_id, actor_role, from_status,
             to_status, changes_json, created_at
           ) SELECT $1, contract.id, 'deposit_receipt_confirmed', $2, $3,
               contract.status, contract.status, $4::jsonb, $5
             FROM contracts contract WHERE contract.id = $6`,
          [
            nanoid(),
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              depositReceiptId: depositReceipt.id,
              paymentRecordId: target.id,
              paymentKind: target.kind,
              originalPaymentAmount: target.amount,
              recognizedAmount: depositReceipt.recognized_amount,
              confirmedAmount,
              confirmationSource,
              invoiceRequiredAmount: calculatePaymentInvoiceRequiredAmount(
                target.amount,
                otherConfirmed + confirmedAmount,
              ),
            }),
            now,
            req.params.id,
          ],
        );
        const result = updated.rows[0]!;
        result.confirmed_by_name = currentActor.name;
        const uploader = await client.query<{ name: string }>(
          `SELECT name FROM users WHERE id = $1`,
          [result.uploaded_by],
        );
        result.uploaded_by_name = uploader.rows[0]?.name || null;
        return result;
      });
      res.json({ success: true, data: toDepositReceiptApi(receipt) });
    } catch (error) {
      sendError(res, error, "确认押金条失败");
    }
  },
);

router.delete(
  "/:id/financial-records/:recordId/deposit-receipts/:depositReceiptId",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const removed = await db.transaction(async (client) => {
        const locked = await client.query<DepositReceiptRow>(
          `SELECT * FROM contract_payment_deposit_receipts
           WHERE id = $1 AND contract_id = $2
             AND COALESCE(payment_record_id, external_payment_record_id) = $3
           FOR UPDATE`,
          [req.params.depositReceiptId, req.params.id, req.params.recordId],
        );
        const depositReceipt = locked.rows[0];
        if (!depositReceipt) {
          throw new ContractDomainError(404, "押金条不存在");
        }
        if (depositReceipt.status !== "pending") {
          throw new ContractDomainError(
            409,
            depositReceipt.status === "confirmed"
              ? "已确认押金条不能删除，请先提交撤销原因"
              : "已撤销押金条必须保留审计证据，不能删除",
            depositReceipt.status === "confirmed"
              ? "DEPOSIT_RECEIPT_CONFIRMED_DELETE_FORBIDDEN"
              : "DEPOSIT_RECEIPT_VOIDED_DELETE_FORBIDDEN",
          );
        }
        const target = await lockDepositPaymentTarget(
          client,
          req.params.id,
          req.params.recordId,
        );
        const now = new Date().toISOString();
        await client.query(
          `INSERT INTO contract_audit_logs (
             id, contract_id, action, actor_id, actor_role, from_status,
             to_status, changes_json, created_at
           ) SELECT $1, contract.id, 'deposit_receipt_deleted', $2, $3,
               contract.status, contract.status, $4::jsonb, $5
             FROM contracts contract WHERE contract.id = $6`,
          [
            nanoid(),
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              depositReceiptId: depositReceipt.id,
              paymentRecordId: target.id,
              paymentKind: target.kind,
              fileName: depositReceipt.file_name,
              fileHash: depositReceipt.file_hash,
              previousStatus: depositReceipt.status,
              hardDeleted: true,
            }),
            now,
            req.params.id,
          ],
        );
        await client.query(
          `DELETE FROM contract_payment_deposit_receipts
           WHERE id = $1 AND status = 'pending'`,
          [depositReceipt.id],
        );
        return depositReceipt;
      });
      await cleanupStoredFinancialFiles([removed.file_path], {
        contractId: req.params.id,
        paymentRecordId: req.params.recordId,
        depositReceiptId: removed.id,
      });
      res.json({
        success: true,
        data: { depositReceiptId: removed.id, deleted: true },
      });
    } catch (error) {
      sendError(res, error, "删除待确认押金条失败");
    }
  },
);

router.post(
  "/:id/financial-records/:recordId/deposit-receipts/:depositReceiptId/void",
  requireFinance,
  async (req, res) => {
    try {
      if (Object.keys(req.body || {}).some((key) => key !== "reason")) {
        throw new ContractDomainError(400, "撤销押金条时只能提交撤销原因");
      }
      const reason = normalizeNullableText(req.body?.reason);
      if (!reason) {
        throw new ContractDomainError(
          400,
          "撤销押金条必须填写原因",
          "DEPOSIT_RECEIPT_VOID_REASON_REQUIRED",
        );
      }
      if (reason.length > 300) {
        throw new ContractDomainError(400, "押金条撤销原因不能超过300字");
      }
      const currentActor = actor(req);
      const receipt = await db.transaction(async (client) => {
        const locked = await client.query<DepositReceiptRow>(
          `SELECT * FROM contract_payment_deposit_receipts
           WHERE id = $1 AND contract_id = $2
             AND COALESCE(payment_record_id, external_payment_record_id) = $3
           FOR UPDATE`,
          [req.params.depositReceiptId, req.params.id, req.params.recordId],
        );
        const depositReceipt = locked.rows[0];
        if (!depositReceipt) {
          throw new ContractDomainError(404, "押金条不存在");
        }
        if (depositReceipt.status !== "confirmed") {
          throw new ContractDomainError(
            409,
            depositReceipt.status === "pending"
              ? "待确认押金条请直接删除，无需撤销"
              : "押金条已经撤销，不能重复撤销",
            depositReceipt.status === "pending"
              ? "DEPOSIT_RECEIPT_PENDING_NOT_VOIDABLE"
              : "DEPOSIT_RECEIPT_ALREADY_VOIDED",
          );
        }
        const target = await lockDepositPaymentTarget(
          client,
          req.params.id,
          req.params.recordId,
        );
        const totals = await client.query<{ confirmed_amount: number }>(
          `SELECT COALESCE(SUM(confirmed_amount), 0) AS confirmed_amount
           FROM contract_payment_deposit_receipts
           WHERE status = 'confirmed' AND id <> $1
             AND COALESCE(payment_record_id, external_payment_record_id) = $2`,
          [depositReceipt.id, target.id],
        );
        const remainingConfirmed = Number(
          totals.rows[0]?.confirmed_amount || 0,
        );
        const previousConfirmed =
          remainingConfirmed + Number(depositReceipt.confirmed_amount || 0);
        const structuredDeposit = await client.query<ContractDepositRow>(
          `SELECT * FROM contract_deposits WHERE contract_id=$1 FOR UPDATE`,
          [req.params.id],
        );
        const linkedDeposit = structuredDeposit.rows[0];
        if (
          remainingConfirmed === 0 &&
          linkedDeposit &&
          (linkedDeposit.payment_record_id === target.id ||
            linkedDeposit.external_payment_record_id === target.id) &&
          toCents(String(linkedDeposit.settled_amount || 0)) > 0
        ) {
          throw new ContractDomainError(
            409,
            "押金已发生退回、扣款或抵租金，不能撤销付款凭证",
          );
        }
        const now = new Date().toISOString();
        const updated = await client.query<DepositReceiptRow>(
          `UPDATE contract_payment_deposit_receipts
           SET status = 'voided', voided_by = $1, voided_at = $2,
             void_reason = $3, updated_at = $2
           WHERE id = $4 AND status = 'confirmed'
           RETURNING *`,
          [currentActor.id, now, reason, depositReceipt.id],
        );
        if (
          remainingConfirmed === 0 &&
          linkedDeposit &&
          (linkedDeposit.payment_record_id === target.id ||
            linkedDeposit.external_payment_record_id === target.id)
        ) {
          await client.query(
            `DELETE FROM contract_payment_purpose_details
             WHERE contract_id=$1 AND ${purposeDetailsRecordColumn(target.kind)}=$2`,
            [req.params.id, target.id],
          );
          await client.query(
            `UPDATE contract_deposits SET payment_record_id=NULL,
               external_payment_record_id=NULL,paid_at=NULL,
               status='pending_payment',updated_by=$2,updated_at=$3
             WHERE id=$1`,
            [linkedDeposit.id, currentActor.id, now],
          );
        }
        await rebuildDepositAffectedFinancialMatches(
          client,
          req.params.id,
          target,
          now,
        );
        await client.query(
          `INSERT INTO contract_audit_logs (
             id, contract_id, action, actor_id, actor_role, from_status,
             to_status, changes_json, comment, created_at
           ) SELECT $1, contract.id, 'deposit_receipt_voided', $2, $3,
               contract.status, contract.status, $4::jsonb, $5, $6
             FROM contracts contract WHERE contract.id = $7`,
          [
            nanoid(),
            currentActor.id,
            currentActor.role,
            JSON.stringify({
              depositReceiptId: depositReceipt.id,
              paymentRecordId: target.id,
              paymentKind: target.kind,
              originalPaymentAmount: target.amount,
              confirmedAmount: depositReceipt.confirmed_amount,
              previousInvoiceRequiredAmount:
                calculatePaymentInvoiceRequiredAmount(
                  target.amount,
                  previousConfirmed,
                ),
              invoiceRequiredAmount: calculatePaymentInvoiceRequiredAmount(
                target.amount,
                remainingConfirmed,
              ),
              evidencePreserved: true,
            }),
            reason,
            now,
            req.params.id,
          ],
        );
        const result = updated.rows[0]!;
        const names = await client.query<{ id: string; name: string }>(
          `SELECT id, name FROM users WHERE id = ANY($1::text[])`,
          [
            [result.uploaded_by, result.confirmed_by, result.voided_by].filter(
              Boolean,
            ),
          ],
        );
        const nameById = new Map(
          names.rows.map((user) => [user.id, user.name]),
        );
        result.uploaded_by_name = nameById.get(result.uploaded_by) || null;
        result.confirmed_by_name = result.confirmed_by
          ? nameById.get(result.confirmed_by) || null
          : null;
        result.voided_by_name = currentActor.name;
        return result;
      });
      res.json({ success: true, data: toDepositReceiptApi(receipt) });
    } catch (error) {
      sendError(res, error, "撤销已确认押金条失败");
    }
  },
);

router.get(
  "/:id/financial-records/:recordId/deposit-receipts/:depositReceiptId/file",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const receipt = await db.get<DepositReceiptRow>(
        `SELECT * FROM contract_payment_deposit_receipts
         WHERE id = ? AND contract_id = ?
           AND COALESCE(payment_record_id, external_payment_record_id) = ?`,
        req.params.depositReceiptId,
        req.params.id,
        req.params.recordId,
      );
      if (!receipt) throw new ContractDomainError(404, "押金条不存在");
      if (!validateFilePath(receipt.file_path)) {
        throw new ContractDomainError(403, "押金条文件路径不安全");
      }
      const absolutePath = path.resolve(process.cwd(), receipt.file_path);
      if (!fs.existsSync(absolutePath)) {
        throw new ContractDomainError(404, "押金条文件已丢失");
      }
      await db.run(
        `INSERT INTO contract_audit_logs (
           id, contract_id, action, actor_id, actor_role, from_status,
           to_status, changes_json, created_at
         ) SELECT ?, contract.id, 'deposit_receipt_previewed', ?, ?,
             contract.status, contract.status, ?::jsonb, ?
           FROM contracts contract WHERE contract.id = ?`,
        nanoid(),
        currentActor.id,
        currentActor.role,
        JSON.stringify({
          depositReceiptId: receipt.id,
          paymentRecordId: req.params.recordId,
          fileName: receipt.file_name,
        }),
        new Date().toISOString(),
        req.params.id,
      );
      res.setHeader("Content-Type", receipt.mime_type);
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(receipt.file_name)}`,
      );
      res.sendFile(absolutePath);
    } catch (error) {
      if (!res.headersSent) sendError(res, error, "读取押金条失败");
    }
  },
);

// 旧单凭证建草稿逻辑仅保留给历史数据迁移代码；公开路由已强制成对登记。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function addFinancialRecord(kind: FinancialRecordKind) {
  return async (req: Request, res: Response) => {
    let recognitionStored = false;
    try {
      const currentActor = actor(req);
      const suppliedJobId = normalizeNullableText(req.body.ocrJobId);
      if (suppliedJobId && req.file) {
        throw new ContractDomainError(
          400,
          "识别任务编号与新文件不能同时提交",
          "FINANCIAL_OCR_INPUT_CONFLICT",
        );
      }
      let jobId = suppliedJobId;
      if (!jobId) {
        const recognition = await recognizeAndStoreFinancialFile(
          req.params.id,
          kind,
          req.file,
          currentActor,
          () => {
            recognitionStored = true;
          },
        );
        jobId = recognition.id;
        if (!recognition.canCreateDraft) {
          throw new ContractDomainError(
            422,
            "该凭证未通过服务端独立验证，已安全隔离，不能生成财务草稿",
            "FINANCIAL_OCR_NOT_VERIFIED",
          );
        }
      }
      const result = await createFinancialDraftFromJob(
        req.params.id,
        kind,
        jobId,
        req.body as Record<string, unknown>,
        currentActor,
      );
      res.json({
        success: true,
        data: {
          recordId: result.recordId,
          fileId: result.fileId,
          status: "draft",
          contract: toContractApi(result.contract as any),
        },
      });
    } catch (error) {
      if (!recognitionStored) cleanupUploadedFile(req.file);
      sendError(res, error, `新增${financialRecordLabel(kind)}失败`);
    }
  };
}

function rejectUnpairedFinancialRecord(
  label: string,
): (req: Request, res: Response) => void {
  return (req, res) => {
    cleanupUploadedFile(req.file);
    sendError(
      res,
      new ContractDomainError(
        409,
        `${label}必须与另一类财务凭证在同一次财务登记中提交`,
        "FINANCIAL_REGISTRATION_PAIR_REQUIRED",
      ),
      `新增${label}失败`,
    );
  };
}

router.post(
  "/:id/invoices",
  requireFinance,
  uploadSingle,
  rejectUnpairedFinancialRecord("发票"),
);
router.post(
  "/:id/receipts",
  requireFinance,
  uploadSingle,
  rejectUnpairedFinancialRecord("银行回单"),
);
router.post(
  "/:id/payments",
  requireFinance,
  uploadSingle,
  rejectUnpairedFinancialRecord("付款凭证"),
);

export async function retryStoredContractFinancialOcr(
  contractId: string,
  jobId: string,
  currentActor: { id: string; role: string },
): Promise<FinancialOcrJobView> {
  if (
    !FINANCE_ROLES.includes(currentActor.role as (typeof FINANCE_ROLES)[number])
  ) {
    throw new ContractDomainError(
      403,
      "只有合同管理员可以重新识别旧版银行回单",
      "CONTRACT_FINANCIAL_OCR_ADMIN_ONLY",
    );
  }
  const stored = await db.get<{
    id: string;
    contract_id: string;
    record_kind: "receipt" | "payment";
    status: string;
    validation_status: string | null;
    parser_version: string | null;
    record_id: string | null;
    file_id: string;
    file_name: string;
    file_path: string;
    file_size: number;
    mime_type: string;
    is_current: boolean;
  }>(
    `SELECT job.id, job.contract_id, job.record_kind, job.status,
       job.validation_status, job.parser_version, job.record_id,
       file.id AS file_id, file.file_name, file.file_path,
       file.file_size, file.mime_type, file.is_current
     FROM contract_financial_ocr_jobs job
     JOIN contract_files file ON file.id = job.file_id
     WHERE job.id = ? AND job.contract_id = ?
       AND job.record_kind IN ('receipt', 'payment')
       AND job.business_purpose IS NULL`,
    jobId,
    contractId,
  );
  if (!stored) {
    throw new ContractDomainError(
      404,
      "待重识别的银行回单任务不存在",
      "FINANCIAL_OCR_JOB_NOT_FOUND",
    );
  }
  if (
    stored.status !== "blocked" ||
    stored.validation_status !== "blocked" ||
    stored.record_id !== null ||
    !stored.is_current
  ) {
    throw new ContractDomainError(
      409,
      "只有未消费且仍为当前文件的旧版阻断任务可以重新识别",
      "FINANCIAL_OCR_RETRY_NOT_ALLOWED",
    );
  }
  if (
    stored.parser_version ===
    contractFinancialOcrParserVersion(stored.record_kind)
  ) {
    throw new ContractDomainError(
      409,
      "该银行回单已经使用最新解析版本",
      "FINANCIAL_OCR_RETRY_NOT_REQUIRED",
    );
  }
  const registered = await db.get<{ id: string }>(
    `SELECT id FROM contract_financial_registration_items
     WHERE ocr_job_id = ? LIMIT 1`,
    stored.id,
  );
  if (registered) {
    throw new ContractDomainError(
      409,
      "该银行回单已进入财务登记，不能重新识别",
      "FINANCIAL_OCR_ALREADY_REGISTERED",
    );
  }
  if (!validateFilePath(stored.file_path)) {
    throw new ContractDomainError(403, "财务凭证文件路径不安全");
  }
  const absolutePath = path.resolve(process.cwd(), stored.file_path);
  if (!fs.existsSync(absolutePath)) {
    throw new ContractDomainError(404, "财务凭证原文件已丢失");
  }
  const storedFile = {
    fieldname: "file",
    originalname: stored.file_name,
    encoding: "7bit",
    mimetype: stored.mime_type,
    size: Number(stored.file_size),
    destination: path.dirname(absolutePath),
    filename: path.basename(absolutePath),
    path: absolutePath,
    buffer: undefined as unknown as Buffer,
  } as unknown as Express.Multer.File;
  return recognizeAndStoreFinancialFile(
    stored.contract_id,
    stored.record_kind,
    storedFile,
    currentActor,
    undefined,
    false,
    true,
  );
}

router.get("/:id/financial-ocr/pending", requireFinance, async (req, res) => {
  try {
    await assertMainContractFinancialTarget(req.params.id);
    const jobs = await db.all<{
      id: string;
      contract_id: string;
      file_id: string;
      record_kind: "invoice" | "receipt" | "payment";
      status: FinancialOcrJobView["status"];
      validation_status: FinancialOcrJobView["validationStatus"];
      failure_kind: FinancialOcrJobView["failureKind"];
      retry_count: number;
      engine_version: string | null;
      parser_version: string | null;
      recognition_method: string | null;
      evidence_text_hash: string | null;
      direction: string | null;
      document_status: string | null;
      can_auto_post: boolean;
      snapshot_json: SafeContractFinancialSnapshot;
      blocking_reasons_json: FinancialOcrJobView["blockingReasons"] | null;
      warnings_json: string[] | null;
    }>(
      `SELECT job.id, job.contract_id, job.file_id, job.record_kind,
         job.status, job.validation_status, job.failure_kind,
         job.retry_count, job.engine_version, job.parser_version,
         job.recognition_method, job.evidence_text_hash,
         job.direction, job.document_status, job.can_auto_post,
         job.snapshot_json, job.blocking_reasons_json, job.warnings_json
       FROM contract_financial_ocr_jobs AS job
       JOIN contract_files AS file ON file.id = job.file_id
       WHERE job.contract_id = $1
         AND job.business_purpose IS NULL
         AND job.record_id IS NULL
         AND job.status IN ('verified', 'blocked')
         AND job.validation_status IN ('verified', 'blocked')
         AND job.record_kind IN ('invoice', 'receipt', 'payment')
         AND NOT EXISTS (
           SELECT 1
           FROM contract_financial_registration_items AS item
           WHERE item.ocr_job_id = job.id
         )
       ORDER BY job.created_at ASC, job.id ASC`,
      req.params.id,
    );
    const responseJobs = jobs.map((job) => {
      const expectedDirection =
        job.record_kind === "invoice"
          ? job.direction === "input" || job.direction === "output"
            ? job.direction
            : "unknown"
          : job.record_kind === "receipt"
            ? "receipt"
            : "payment";
      return financialJobResponse({
        id: job.id,
        contractId: job.contract_id,
        fileId: job.file_id,
        recordKind: job.record_kind,
        status: job.status,
        validationStatus: job.validation_status,
        failureKind: job.failure_kind,
        retryCount: job.retry_count || 0,
        recognitionMethod: job.recognition_method,
        evidenceTextHash: job.evidence_text_hash,
        direction: job.direction,
        expectedDirection,
        documentStatus: job.document_status,
        canCreateDraft:
          job.status === "verified" &&
          job.validation_status === "verified" &&
          job.document_status === "normal" &&
          job.can_auto_post === true,
        diagnosticScore: null,
        snapshot: job.snapshot_json,
        blockingReasons: job.blocking_reasons_json || [],
        warnings: job.warnings_json || [],
        engineVersion: job.engine_version,
        parserVersion: job.parser_version,
        requiresRefresh:
          job.status === "blocked" &&
          job.validation_status === "blocked" &&
          job.parser_version !==
            contractFinancialOcrParserVersion(job.record_kind),
      });
    });
    res.json({ success: true, data: responseJobs });
  } catch (error) {
    sendError(res, error, "恢复待登记财务凭证失败");
  }
});

router.post(
  "/:id/financial-ocr/:jobId/retry",
  requireFinance,
  async (req, res) => {
    try {
      if (Object.keys(req.body || {}).length > 0) {
        throw new ContractDomainError(
          400,
          "重新识别旧版财务凭证无需提交字段",
          "FINANCIAL_OCR_RETRY_FIELDS_FORBIDDEN",
        );
      }
      const currentActor = actor(req);
      const result = await retryStoredContractFinancialOcr(
        req.params.id,
        req.params.jobId,
        currentActor,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      sendError(res, error, "重新识别旧版银行回单失败");
    }
  },
);

router.delete("/:id/financial-ocr/:jobId", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const result = await deleteContractFinancialOcrUpload(
      req.params.id,
      req.params.jobId,
      currentActor.id,
      currentActor.role,
    );
    await cleanupStoredFinancialFiles([result.removedFilePath], {
      contractId: req.params.id,
      ocrJobId: req.params.jobId,
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    sendError(res, error, "移除财务识别上传失败");
  }
});

router.post(
  "/:id/financial-registrations/:registrationId/confirm",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const contract = await confirmContractFinancialRegistration(
        req.params.registrationId,
        currentActor.id,
        currentActor.role,
        req.params.id,
      );
      res.json({ success: true, data: toContractApi(contract as any) });
    } catch (error) {
      sendError(res, error, "财务登记确认失败");
    }
  },
);

router.delete(
  "/:id/financial-registrations/:registrationId",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const result = await deleteContractFinancialRegistrationDraft(
        req.params.registrationId,
        currentActor.id,
        currentActor.role,
        req.params.id,
      );
      await cleanupStoredFinancialFiles(result.removedFilePaths, {
        contractId: req.params.id,
        registrationId: req.params.registrationId,
      });
      res.json({
        success: true,
        data: {
          deleted: true,
          contract: toContractApi(result.contract as any),
        },
      });
    } catch (error) {
      sendError(res, error, "财务登记草稿删除失败");
    }
  },
);

router.post(
  "/:id/financial-registrations/:registrationId/reverse",
  requireFinance,
  async (req, res) => {
    try {
      const currentActor = actor(req);
      const contract = await reverseContractFinancialRegistration(
        req.params.registrationId,
        currentActor.id,
        currentActor.role,
        String(req.body.reason || ""),
        req.params.id,
      );
      res.json({ success: true, data: toContractApi(contract as any) });
    } catch (error) {
      sendError(res, error, "财务登记冲正失败");
    }
  },
);

function confirmFinancialRecord(kind: FinancialRecordKind) {
  return async (req: Request, res: Response) => {
    try {
      const currentActor = actor(req);
      const contract = await confirmContractFinancialRecord(
        kind,
        req.params.recordId,
        currentActor.id,
        currentActor.role,
        req.params.id,
      );
      res.json({ success: true, data: toContractApi(contract as any) });
    } catch (error) {
      sendError(res, error, `${financialRecordLabel(kind)}确认失败`);
    }
  };
}

function deleteFinancialDraft(kind: FinancialRecordKind) {
  return async (req: Request, res: Response) => {
    try {
      const currentActor = actor(req);
      const result = await deleteContractFinancialDraft(
        kind,
        req.params.recordId,
        currentActor.id,
        currentActor.role,
        req.params.id,
      );
      await cleanupStoredFinancialFiles([result.removedFilePath], {
        kind,
        recordId: req.params.recordId,
      });
      res.json({
        success: true,
        data: {
          deleted: true,
          contract: toContractApi(result.contract as any),
        },
      });
    } catch (error) {
      sendError(res, error, `${financialRecordLabel(kind)}草稿删除失败`);
    }
  };
}

for (const [resource, kind] of [
  ["invoices", "invoice"],
  ["receipts", "receipt"],
  ["payments", "payment"],
] as const) {
  router.post(
    `/:id/${resource}/:recordId/confirm`,
    requireFinance,
    confirmFinancialRecord(kind),
  );
  router.delete(
    `/:id/${resource}/:recordId`,
    requireFinance,
    deleteFinancialDraft(kind),
  );
}

function reverseFinancialRecord(kind: FinancialRecordKind) {
  return async (req: Request, res: Response) => {
    try {
      const currentActor = actor(req);
      const contract = await reverseContractFinancialRecord(
        kind,
        req.params.recordId,
        currentActor.id,
        currentActor.role,
        String(req.body.reason || ""),
        req.params.id,
      );
      res.json({ success: true, data: toContractApi(contract as any) });
    } catch (error) {
      sendError(res, error, `${financialRecordLabel(kind)}冲正失败`);
    }
  };
}

router.post(
  "/:id/invoices/:recordId/reverse",
  requireFinance,
  reverseFinancialRecord("invoice"),
);
router.post(
  "/:id/receipts/:recordId/reverse",
  requireFinance,
  reverseFinancialRecord("receipt"),
);
router.post(
  "/:id/payments/:recordId/reverse",
  requireFinance,
  reverseFinancialRecord("payment"),
);

export default router;
