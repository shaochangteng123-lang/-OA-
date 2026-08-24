import type { PoolClient } from "pg";
import { nanoid } from "nanoid";
import path from "path";
import { db } from "../db/index.js";
import {
  calculateContractLeaseMonthCount,
  extractContractLeaseTerms,
  extractContractBusinessNumber,
  extractReferencedParentContractBusinessNumber,
  recognizeContractFile,
  type ContractRecognitionOptions,
  type ContractRecognitionResult,
} from "./contractOcr.js";
import {
  applyTerminationAgreementAtEffective,
  advanceSupplementAmountChainAtEffective,
  approvalTargetSnapshot,
  assertContractStatusTransition,
  assertRootAmountAfterAdjustment,
  ContractDomainError,
  createContractApprovalRound,
  recalculateContractExecutionStatus,
  resolveContractParentContext,
  resolveTerminationTargetContext,
  syncProjectContractTotal,
  type ContractRow,
} from "./contractService.js";
import {
  compareSealedContract,
  sealedCoreFieldRequiresRecognitionRetry,
  sealedRecognitionWarningsForField,
  type ApprovedContractSnapshot,
  type SealedContractMismatch,
  type SealedVerificationField,
} from "./contractSealVerification.js";

export type SealVerificationStatus =
  | "infrastructure_failed"
  | "review_required"
  | "difference_explanation_required"
  | "difference_approving"
  | "difference_approved"
  | "difference_rejected"
  | "ready_to_archive"
  | "archived"
  | "superseded";

export interface SealedFileInput {
  id?: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  fileHash: string;
}

export type SealedContractRecognitionContext = Required<
  Pick<ContractRecognitionOptions, "expectedCategory" | "relationType">
> &
  Pick<ContractRecognitionOptions, "leaseOperationType" | "renewalMain">;

interface SealVerificationRow {
  id: string;
  contract_id: string;
  file_id: string;
  status: SealVerificationStatus;
  upload_date: string;
  approved_snapshot_json: unknown;
  recognition_status: ContractRecognitionResult["status"];
  recognition_method: string | null;
  recognition_warnings_json: unknown;
  raw_text: string | null;
  mismatches_json: unknown;
  infrastructure_failure: boolean;
  difference_explanation: string | null;
  approval_submitted_at: string | null;
  approval_completed_at: string | null;
  created_by: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  archived_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  file_name?: string;
  mime_type?: string;
  file_path?: string;
  file_is_current?: boolean;
}

interface SealVerificationFieldRow {
  id: string;
  verification_id: string;
  contract_id: string;
  field_code: SealedVerificationField;
  approved_value: string | null;
  recognized_value: string | null;
  final_value: string | null;
  confidence: number;
  source: string;
  requires_manual_confirmation: boolean;
  manually_confirmed: boolean;
  is_mismatch: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SealVerificationView {
  id: string;
  contractId: string;
  fileId: string;
  fileName: string | null;
  mimeType: string | null;
  status: SealVerificationStatus;
  uploadDate: string;
  approvedSnapshot: ApprovedContractSnapshot;
  recognitionStatus: ContractRecognitionResult["status"];
  recognitionMethod: string | null;
  recognitionWarnings: string[];
  rawText: string | null;
  mismatches: SealedContractMismatch[];
  infrastructureFailure: boolean;
  differenceExplanation: string | null;
  approvalSubmittedAt: string | null;
  approvalCompletedAt: string | null;
  createdBy: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  archivedBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requiresRecognitionRetry: boolean;
  fields: Array<{
    field: SealedVerificationField;
    approvedValue: string | null;
    recognizedValue: string | null;
    finalValue: string | null;
    confidence: number;
    source: string;
    requiresRecognitionRetry: boolean;
    isMismatch: boolean;
  }>;
}

interface SealedBusinessNumberResolution {
  value: string | null;
  source: "qr" | "label" | null;
  changed: boolean;
}

async function resolveSealedBusinessContractNumber(
  client: PoolClient,
  contract: ContractRow,
  recognition: ContractRecognitionResult,
): Promise<SealedBusinessNumberResolution> {
  if (
    contract.category !== "main_business" &&
    contract.declared_category !== "main_business"
  ) {
    return {
      value: contract.business_contract_no,
      source: null,
      changed: false,
    };
  }

  const evidence = extractContractBusinessNumber(recognition.ocrLines || []);
  if (!evidence) {
    return {
      value: contract.business_contract_no,
      source: null,
      changed: false,
    };
  }

  const duplicate = await client.query<{ id: string }>(
    `SELECT id FROM contracts
     WHERE business_contract_no = $1 AND id <> $2 AND is_deleted = FALSE
     LIMIT 1`,
    [evidence.value, contract.id],
  );
  if (duplicate.rows[0]) {
    throw new ContractDomainError(
      409,
      `盖章合同编号 ${evidence.value} 已被其他有效合同使用`,
      "BUSINESS_CONTRACT_NUMBER_DUPLICATE",
    );
  }

  if (
    contract.parent_contract_id &&
    ["supplement", "termination"].includes(contract.relation_type)
  ) {
    const parent = await resolveContractParentContext(
      client,
      contract.parent_contract_id,
      true,
    );
    const referencedParentNumber =
      extractReferencedParentContractBusinessNumber(
        recognition.ocrLines || [],
        evidence,
      );
    let expectedReferenceNumbers = [parent.business_contract_no].filter(
      (value): value is string => Boolean(value),
    );
    if (
      contract.relation_type === "termination" &&
      contract.termination_target_contract_id
    ) {
      const terminationContext = await resolveTerminationTargetContext(
        client,
        contract.termination_target_contract_id,
        true,
      );
      if (terminationContext.root.id !== parent.id) {
        throw new ContractDomainError(
          409,
          "被解除合同不属于当前主合同链",
          "CONTRACT_TERMINATION_TARGET_ROOT_MISMATCH",
        );
      }
      expectedReferenceNumbers = [
        ...expectedReferenceNumbers,
        terminationContext.target.business_contract_no,
      ].filter((value): value is string => Boolean(value));
    }
    if (
      referencedParentNumber &&
      expectedReferenceNumbers.length > 0 &&
      !expectedReferenceNumbers.includes(referencedParentNumber)
    ) {
      throw new ContractDomainError(
        409,
        `盖章文件关联原合同编号 ${referencedParentNumber}，但被解除合同编号为 ${expectedReferenceNumbers.join("／")}`,
        "CONTRACT_PARENT_BUSINESS_NUMBER_MISMATCH",
      );
    }
  }

  return {
    value: evidence.value,
    source: evidence.source,
    changed: evidence.value !== contract.business_contract_no,
  };
}

export interface SealWorkflowResult {
  contract: ContractRow;
  verification: SealVerificationView;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const AUTOMATIC_CORE_FIELDS = new Set<SealedVerificationField>([
  "party_a",
  "party_b",
  "amount",
]);

function fieldRequiresRecognitionRetry(
  field: SealVerificationFieldRow,
  recognitionWarnings: readonly string[],
  amountVerificationRequired = true,
): boolean {
  if (field.field_code === "amount" && !amountVerificationRequired) {
    return false;
  }
  if (field.field_code === "contract_date") {
    return !field.final_value?.trim() || field.source === "manual";
  }
  const recognizedValue = field.recognized_value?.trim();
  const finalValue = field.final_value?.trim();
  const approvedValue = field.approved_value?.trim();
  if (!recognizedValue || !finalValue || !approvedValue) {
    return true;
  }
  return sealedCoreFieldRequiresRecognitionRetry({
    field: field.field_code,
    approvedValue,
    recognizedValue: finalValue,
    fieldScore: field.confidence,
    source: field.source,
    warnings: sealedRecognitionWarningsForField(
      field.field_code,
      undefined,
      recognitionWarnings,
    ),
  });
}

function hasUnqualifiedAutomaticRecognition(
  fields: readonly SealVerificationFieldRow[],
  recognitionWarnings: readonly string[],
  approvedSnapshot: ApprovedContractSnapshot,
): boolean {
  const byCode = new Map(fields.map((field) => [field.field_code, field]));
  const requiredFields = [
    ...[...AUTOMATIC_CORE_FIELDS].filter(
      (fieldCode) =>
        fieldCode !== "amount" ||
        approvedSnapshot.amountVerificationRequired !== false,
    ),
    "contract_date" as const,
  ];
  return requiredFields.some((fieldCode) => {
    const field = byCode.get(fieldCode);
    return !field || fieldRequiresRecognitionRetry(field, recognitionWarnings);
  });
}

function toVerificationView(
  row: SealVerificationRow,
  fields: SealVerificationFieldRow[],
): SealVerificationView {
  const recognitionWarnings = parseJson<string[]>(
    row.recognition_warnings_json,
    [],
  );
  const approvedSnapshot = parseJson<ApprovedContractSnapshot>(
    row.approved_snapshot_json,
    { partyA: "", partyB: "", amount: "0", contractDate: null },
  );
  return {
    id: row.id,
    contractId: row.contract_id,
    fileId: row.file_id,
    fileName: row.file_name || null,
    mimeType: row.mime_type || null,
    status: row.status,
    uploadDate: row.upload_date,
    approvedSnapshot,
    recognitionStatus: row.recognition_status,
    recognitionMethod: row.recognition_method,
    recognitionWarnings,
    rawText: row.raw_text,
    mismatches: parseJson<SealedContractMismatch[]>(row.mismatches_json, []),
    infrastructureFailure: Boolean(row.infrastructure_failure),
    differenceExplanation: row.difference_explanation,
    approvalSubmittedAt: row.approval_submitted_at,
    approvalCompletedAt: row.approval_completed_at,
    createdBy: row.created_by,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    archivedBy: row.archived_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requiresRecognitionRetry:
      Boolean(row.infrastructure_failure) ||
      row.recognition_status === "failed" ||
      hasUnqualifiedAutomaticRecognition(
        fields,
        recognitionWarnings,
        approvedSnapshot,
      ),
    fields: fields.map((field) => ({
      field: field.field_code,
      approvedValue: field.approved_value,
      recognizedValue: field.recognized_value,
      finalValue: field.final_value,
      confidence: Number(field.confidence || 0),
      source: field.source,
      requiresRecognitionRetry: fieldRequiresRecognitionRetry(
        field,
        recognitionWarnings,
        approvedSnapshot.amountVerificationRequired !== false,
      ),
      isMismatch: Boolean(field.is_mismatch),
    })),
  };
}

async function loadVerificationWithClient(
  client: PoolClient,
  contractId: string,
  verificationId: string,
): Promise<SealVerificationView> {
  const verificationResult = await client.query<SealVerificationRow>(
    `SELECT v.*, f.file_name, f.mime_type, f.file_path,
       f.is_current AS file_is_current
     FROM contract_seal_verifications v
     JOIN contract_files f ON f.id = v.file_id
     WHERE v.id = $1 AND v.contract_id = $2`,
    [verificationId, contractId],
  );
  const verification = verificationResult.rows[0];
  if (!verification) {
    throw new ContractDomainError(404, "盖章合同核验记录不存在");
  }
  const fieldResult = await client.query<SealVerificationFieldRow>(
    `SELECT * FROM contract_seal_verification_fields
     WHERE verification_id = $1
     ORDER BY CASE field_code
       WHEN 'party_a' THEN 1 WHEN 'party_b' THEN 2
       WHEN 'amount' THEN 3 ELSE 4 END`,
    [verificationId],
  );
  return toVerificationView(verification, fieldResult.rows);
}

export async function getSealedContractVerification(
  contractId: string,
  verificationId?: string,
): Promise<SealVerificationView> {
  const verification = await db.get<SealVerificationRow>(
    `SELECT v.*, f.file_name, f.mime_type, f.file_path,
       f.is_current AS file_is_current
     FROM contract_seal_verifications v
     JOIN contract_files f ON f.id = v.file_id
     WHERE v.contract_id = ?
       AND (?::text IS NULL OR v.id = ?)
     ORDER BY v.created_at DESC, v.id DESC
     LIMIT 1`,
    contractId,
    verificationId || null,
    verificationId || null,
  );
  if (!verification) {
    throw new ContractDomainError(404, "盖章合同核验记录不存在");
  }
  const fields = await db.all<SealVerificationFieldRow>(
    `SELECT * FROM contract_seal_verification_fields
     WHERE verification_id = ?
     ORDER BY CASE field_code
       WHEN 'party_a' THEN 1 WHEN 'party_b' THEN 2
       WHEN 'amount' THEN 3 ELSE 4 END`,
    verification.id,
  );
  return toVerificationView(verification, fields);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error || "未知错误").slice(0, 300);
}

const configuredSealedRecognitionConcurrency = Number.parseInt(
  process.env.CONTRACT_SEAL_OCR_CONCURRENCY || "1",
  10,
);
const sealedRecognitionConcurrency = Number.isFinite(
  configuredSealedRecognitionConcurrency,
)
  ? Math.min(2, Math.max(1, configuredSealedRecognitionConcurrency))
  : 1;
const configuredSealedRecognitionQueueLimit = Number.parseInt(
  process.env.CONTRACT_SEAL_OCR_QUEUE_LIMIT || "8",
  10,
);
const sealedRecognitionQueueLimit = Number.isFinite(
  configuredSealedRecognitionQueueLimit,
)
  ? Math.min(32, Math.max(1, configuredSealedRecognitionQueueLimit))
  : 8;
let activeSealedRecognitions = 0;
const pendingSealedRecognitionSlots: Array<() => void> = [];

async function acquireSealedRecognitionSlot(): Promise<void> {
  if (activeSealedRecognitions < sealedRecognitionConcurrency) {
    activeSealedRecognitions += 1;
    return;
  }
  if (pendingSealedRecognitionSlots.length >= sealedRecognitionQueueLimit) {
    throw new ContractDomainError(
      429,
      "盖章合同识别任务繁忙，请稍后重试",
      "SEALED_RECOGNITION_BUSY",
    );
  }
  await new Promise<void>((resolve) =>
    pendingSealedRecognitionSlots.push(resolve),
  );
}

function releaseSealedRecognitionSlot(): void {
  const next = pendingSealedRecognitionSlots.shift();
  if (next) {
    // 当前占用名额直接移交给队首请求，活动计数保持不变。
    next();
    return;
  }
  activeSealedRecognitions = Math.max(0, activeSealedRecognitions - 1);
}

/** OCR 进程、渲染器或文件读取异常一律显式标记为基础设施失败。 */
export async function recognizeSealedContractFile(
  absoluteFilePath: string,
  mimeType: string,
  context: SealedContractRecognitionContext,
): Promise<ContractRecognitionResult> {
  await acquireSealedRecognitionSlot();
  try {
    try {
      return await recognizeContractFile(absoluteFilePath, mimeType, context);
    } catch (error) {
      return {
        status: "failed",
        failureKind: "infrastructure",
        rawText: "",
        method: "none",
        fields: [],
        ocrLines: [],
        warnings: [
          `OCR 识别基础设施暂时不可用，可稍后重试：${errorMessage(error)}`,
        ],
      };
    }
  } finally {
    releaseSealedRecognitionSlot();
  }
}

function approvedSnapshotFromContract(
  contract: ContractRow,
): ApprovedContractSnapshot {
  if (
    !contract.party_a ||
    !contract.party_b ||
    contract.amount_delta === null
  ) {
    throw new ContractDomainError(
      409,
      "审批通过版本的甲方、乙方或合同金额不完整，不能核验盖章合同",
      "SEALED_APPROVED_SNAPSHOT_INCOMPLETE",
    );
  }
  return {
    partyA: contract.party_a,
    partyB: contract.party_b,
    amount: contract.amount_delta,
    amountVerificationRequired: !(
      contract.relation_type === "termination" ||
      (contract.relation_type === "supplement" &&
        contract.supplement_change_type === "payment_terms_only")
    ),
    contractDate: contract.contract_date,
  };
}

function approvedFieldValue(
  snapshot: ApprovedContractSnapshot,
  field: SealedVerificationField,
): string | null {
  if (field === "party_a") return snapshot.partyA;
  if (field === "party_b") return snapshot.partyB;
  if (field === "amount") return String(snapshot.amount);
  return snapshot.contractDate || null;
}

function initialStatus(
  infrastructureFailure: boolean,
  requiresRecognitionRetry: boolean,
  mismatches: readonly SealedContractMismatch[],
): SealVerificationStatus {
  if (infrastructureFailure) return "infrastructure_failed";
  if (requiresRecognitionRetry) return "review_required";
  if (mismatches.length > 0) return "difference_explanation_required";
  return "ready_to_archive";
}

function assertExpectedVersion(
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

export async function assertSealedContractRecognitionAllowed(
  contractId: string,
  expectedVersion: number,
): Promise<SealedContractRecognitionContext> {
  const contract = await db.get<ContractRow>(
    `SELECT * FROM contracts WHERE id = ? AND is_deleted = FALSE`,
    contractId,
  );
  if (!contract) throw new ContractDomainError(404, "合同不存在");
  assertExpectedVersion(contract, expectedVersion);
  if (contract.status !== "pending_seal") {
    throw new ContractDomainError(409, "只有待盖章合同可以进行盖章版识别");
  }
  approvedSnapshotFromContract(contract);
  const expectedCategory = contract.declared_category || contract.category;
  if (!expectedCategory) {
    throw new ContractDomainError(409, "审批通过合同缺少分类，不能识别盖章版");
  }
  return {
    expectedCategory,
    relationType: contract.relation_type,
    ...(contract.lease_operation_type
      ? { leaseOperationType: contract.lease_operation_type }
      : {}),
    ...(contract.renewed_from_contract_id ? { renewalMain: true } : {}),
  };
}

async function insertAudit(
  client: PoolClient,
  input: {
    contractId: string;
    action: string;
    actorId: string;
    actorRole: string;
    fromStatus?: ContractRow["status"] | null;
    toStatus?: ContractRow["status"] | null;
    changes?: Record<string, unknown>;
    comment?: string | null;
    now: string;
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
      input.fromStatus || null,
      input.toStatus || null,
      JSON.stringify(input.changes || {}),
      input.comment?.trim() || null,
      input.now,
    ],
  );
}

export async function createSealedContractVerification(input: {
  contractId: string;
  file: SealedFileInput;
  recognition: ContractRecognitionResult;
  uploadDate: string;
  actorId: string;
  actorRole: string;
  expectedVersion: number;
}): Promise<SealWorkflowResult> {
  return db.transaction(async (client) => {
    const contractResult = await client.query<ContractRow>(
      `SELECT * FROM contracts
       WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
      [input.contractId],
    );
    const contract = contractResult.rows[0];
    if (!contract) throw new ContractDomainError(404, "合同不存在");
    assertExpectedVersion(contract, input.expectedVersion);
    if (contract.status !== "pending_seal") {
      throw new ContractDomainError(409, "只有待盖章合同可以上传盖章版");
    }
    const approvedSnapshot = approvedSnapshotFromContract(contract);
    const assessment = compareSealedContract(
      approvedSnapshot,
      input.recognition,
      input.uploadDate,
    );
    const businessNumber = await resolveSealedBusinessContractNumber(
      client,
      contract,
      input.recognition,
    );
    const status = initialStatus(
      assessment.infrastructureFailure,
      assessment.requiresRecognitionRetry,
      assessment.mismatches,
    );
    const duplicate = await client.query<{ id: string; file_type: string }>(
      `SELECT id, file_type FROM contract_files
       WHERE contract_id = $1 AND file_hash = $2 LIMIT 1`,
      [input.contractId, input.file.fileHash],
    );
    const duplicateFile = duplicate.rows[0];
    if (duplicateFile?.file_type === "draft_contract") {
      throw new ContractDomainError(
        409,
        "所选盖章合同与当前合同的草拟文件完全一致，请上传实际签字盖章后的合同",
        "SEALED_FILE_MATCHES_DRAFT",
      );
    }
    if (duplicateFile?.file_type === "sealed_contract") {
      throw new ContractDomainError(
        409,
        "该盖章合同已经上传，请勿重复提交",
        "SEALED_FILE_ALREADY_UPLOADED",
      );
    }
    if (duplicateFile) {
      throw new ContractDomainError(
        409,
        "所选盖章合同与当前合同的已有附件完全一致，请选择实际签字盖章后的合同",
        "SEALED_FILE_MATCHES_EXISTING_ATTACHMENT",
      );
    }
    const versionResult = await client.query<{ next_version: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM contract_files
       WHERE contract_id = $1 AND file_type = 'sealed_contract'`,
      [input.contractId],
    );
    await client.query(
      `UPDATE contract_files SET is_current = FALSE
       WHERE contract_id = $1 AND file_type = 'sealed_contract'
         AND is_current = TRUE`,
      [input.contractId],
    );
    await client.query(
      `UPDATE contract_seal_verifications
       SET status = 'superseded', updated_at = $2
       WHERE contract_id = $1
         AND status NOT IN ('archived', 'superseded')`,
      [input.contractId, new Date().toISOString()],
    );
    const now = new Date().toISOString();
    const fileId = input.file.id || nanoid();
    await client.query(
      `INSERT INTO contract_files (
         id, contract_id, file_type, file_name, file_path, file_size,
         mime_type, file_hash, version, is_current, uploaded_by, created_at
       ) VALUES ($1,$2,'sealed_contract',$3,$4,$5,$6,$7,$8,TRUE,$9,$10)`,
      [
        fileId,
        input.contractId,
        input.file.fileName,
        input.file.filePath,
        input.file.fileSize,
        input.file.mimeType,
        input.file.fileHash,
        Number(versionResult.rows[0]?.next_version || 1),
        input.actorId,
        now,
      ],
    );
    const verificationId = nanoid();
    const effectiveMismatches = assessment.infrastructureFailure
      ? []
      : assessment.mismatches;
    await client.query(
      `INSERT INTO contract_seal_verifications (
         id, contract_id, file_id, status, upload_date,
         approved_snapshot_json, recognition_status, recognition_method,
         recognition_warnings_json, raw_text, mismatches_json,
         infrastructure_failure, created_by, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11::jsonb,
         $12,$13,$14,$14)`,
      [
        verificationId,
        input.contractId,
        fileId,
        status,
        input.uploadDate,
        JSON.stringify(approvedSnapshot),
        input.recognition.status,
        input.recognition.method || null,
        JSON.stringify(input.recognition.warnings || []),
        input.recognition.rawText || null,
        JSON.stringify(effectiveMismatches),
        assessment.infrastructureFailure,
        input.actorId,
        now,
      ],
    );
    for (const value of assessment.values) {
      const mismatch = effectiveMismatches.some(
        (item) => item.field === value.field,
      );
      const recognizedValue =
        value.source === "upload_date" ? null : value.value;
      const finalValue = assessment.infrastructureFailure ? null : value.value;
      await client.query(
        `INSERT INTO contract_seal_verification_fields (
           id, verification_id, contract_id, field_code, approved_value,
           recognized_value, final_value, confidence, source,
           requires_manual_confirmation, manually_confirmed, is_mismatch,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11,$12,$12)`,
        [
          nanoid(),
          verificationId,
          input.contractId,
          value.field,
          approvedFieldValue(approvedSnapshot, value.field),
          recognizedValue,
          finalValue,
          value.confidence,
          value.source,
          value.requiresRecognitionRetry,
          mismatch,
          now,
        ],
      );
    }
    const updatedContractResult = await client.query<ContractRow>(
      `UPDATE contracts SET business_contract_no = $2, updated_by = $3,
         updated_at = $4,
         version = version + 1
       WHERE id = $1 RETURNING *`,
      [input.contractId, businessNumber.value, input.actorId, now],
    );
    await insertAudit(client, {
      contractId: input.contractId,
      action: assessment.infrastructureFailure
        ? "sealed_verification_infrastructure_failed"
        : "sealed_verification_created",
      actorId: input.actorId,
      actorRole: input.actorRole,
      fromStatus: contract.status,
      toStatus: contract.status,
      changes: {
        verificationId,
        fileId,
        status,
        recognitionStatus: input.recognition.status,
        recognitionRetryFields: assessment.values
          .filter((value) => value.requiresRecognitionRetry)
          .map((value) => value.field),
        mismatches: effectiveMismatches,
        businessContractNumber: businessNumber.value,
        businessContractNumberSource: businessNumber.source,
        businessContractNumberUpdated: businessNumber.changed,
      },
      now,
    });
    return {
      contract: updatedContractResult.rows[0],
      verification: await loadVerificationWithClient(
        client,
        input.contractId,
        verificationId,
      ),
    };
  });
}

async function replaceVerificationAssessment(
  client: PoolClient,
  input: {
    verification: SealVerificationRow;
    approvedSnapshot: ApprovedContractSnapshot;
    recognition: ContractRecognitionResult;
    actorId: string;
    now: string;
  },
): Promise<SealVerificationStatus> {
  const assessment = compareSealedContract(
    input.approvedSnapshot,
    input.recognition,
    input.verification.upload_date,
  );
  const status = initialStatus(
    assessment.infrastructureFailure,
    assessment.requiresRecognitionRetry,
    assessment.mismatches,
  );
  const effectiveMismatches = assessment.infrastructureFailure
    ? []
    : assessment.mismatches;
  await client.query(
    `DELETE FROM contract_seal_verification_fields
     WHERE verification_id = $1`,
    [input.verification.id],
  );
  for (const value of assessment.values) {
    const recognizedValue = value.source === "upload_date" ? null : value.value;
    await client.query(
      `INSERT INTO contract_seal_verification_fields (
         id, verification_id, contract_id, field_code, approved_value,
         recognized_value, final_value, confidence, source,
         requires_manual_confirmation, manually_confirmed, is_mismatch,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11,$12,$12)`,
      [
        nanoid(),
        input.verification.id,
        input.verification.contract_id,
        value.field,
        approvedFieldValue(input.approvedSnapshot, value.field),
        recognizedValue,
        assessment.infrastructureFailure ? null : value.value,
        value.confidence,
        value.source,
        value.requiresRecognitionRetry,
        effectiveMismatches.some((item) => item.field === value.field),
        input.now,
      ],
    );
  }
  await client.query(
    `UPDATE contract_seal_verifications SET
       status = $2, recognition_status = $3, recognition_method = $4,
       recognition_warnings_json = $5::jsonb, raw_text = $6,
       mismatches_json = $7::jsonb, infrastructure_failure = $8,
       difference_explanation = NULL, approval_submitted_at = NULL,
       approval_completed_at = NULL, confirmed_by = NULL,
       confirmed_at = NULL, updated_at = $9
     WHERE id = $1`,
    [
      input.verification.id,
      status,
      input.recognition.status,
      input.recognition.method || null,
      JSON.stringify(input.recognition.warnings || []),
      input.recognition.rawText || null,
      JSON.stringify(effectiveMismatches),
      assessment.infrastructureFailure,
      input.now,
    ],
  );
  return status;
}

export async function retrySealedContractVerification(input: {
  contractId: string;
  verificationId: string;
  actorId: string;
  actorRole: string;
  expectedVersion: number;
}): Promise<SealWorkflowResult> {
  const recognitionContext = await assertSealedContractRecognitionAllowed(
    input.contractId,
    input.expectedVersion,
  );
  const candidate = await db.get<SealVerificationRow>(
    `SELECT v.*, f.file_name, f.mime_type, f.file_path,
       f.is_current AS file_is_current
     FROM contract_seal_verifications v
     JOIN contract_files f ON f.id = v.file_id
     WHERE v.id = ? AND v.contract_id = ?`,
    input.verificationId,
    input.contractId,
  );
  if (!candidate) {
    throw new ContractDomainError(404, "盖章合同核验记录不存在");
  }
  if (
    ![
      "infrastructure_failed",
      "review_required",
      "difference_explanation_required",
      "ready_to_archive",
    ].includes(candidate.status)
  ) {
    throw new ContractDomainError(409, "当前核验状态不能重新识别");
  }
  if (
    !candidate.file_is_current ||
    !candidate.file_path ||
    !candidate.mime_type
  ) {
    throw new ContractDomainError(409, "该盖章文件已不是当前版本");
  }
  const recognition = await recognizeSealedContractFile(
    path.resolve(process.cwd(), candidate.file_path),
    candidate.mime_type,
    recognitionContext,
  );
  return db.transaction(async (client) => {
    const contractResult = await client.query<ContractRow>(
      `SELECT * FROM contracts
       WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
      [input.contractId],
    );
    const contract = contractResult.rows[0];
    if (!contract) throw new ContractDomainError(404, "合同不存在");
    assertExpectedVersion(contract, input.expectedVersion);
    if (contract.status !== "pending_seal") {
      throw new ContractDomainError(409, "只有待盖章合同可以重新识别");
    }
    const verificationResult = await client.query<SealVerificationRow>(
      `SELECT v.*, f.is_current AS file_is_current
       FROM contract_seal_verifications v
       JOIN contract_files f ON f.id = v.file_id
       WHERE v.id = $1 AND v.contract_id = $2 FOR UPDATE OF v, f`,
      [input.verificationId, input.contractId],
    );
    const verification = verificationResult.rows[0];
    if (!verification) {
      throw new ContractDomainError(404, "盖章合同核验记录不存在");
    }
    if (!verification.file_is_current) {
      throw new ContractDomainError(409, "该盖章文件已不是当前版本");
    }
    if (
      ![
        "infrastructure_failed",
        "review_required",
        "difference_explanation_required",
        "ready_to_archive",
      ].includes(verification.status)
    ) {
      throw new ContractDomainError(409, "当前核验状态不能重新识别");
    }
    const approvedSnapshot = parseJson<ApprovedContractSnapshot>(
      verification.approved_snapshot_json,
      approvedSnapshotFromContract(contract),
    );
    const now = new Date().toISOString();
    const businessNumber = await resolveSealedBusinessContractNumber(
      client,
      contract,
      recognition,
    );
    const status = await replaceVerificationAssessment(client, {
      verification,
      approvedSnapshot,
      recognition,
      actorId: input.actorId,
      now,
    });
    const updatedContractResult = await client.query<ContractRow>(
      `UPDATE contracts SET business_contract_no = $2, updated_by = $3,
         updated_at = $4,
         version = version + 1
       WHERE id = $1 RETURNING *`,
      [input.contractId, businessNumber.value, input.actorId, now],
    );
    await insertAudit(client, {
      contractId: input.contractId,
      action:
        status === "infrastructure_failed"
          ? "sealed_verification_retry_failed"
          : "sealed_verification_retried",
      actorId: input.actorId,
      actorRole: input.actorRole,
      fromStatus: contract.status,
      toStatus: contract.status,
      changes: {
        verificationId: verification.id,
        fileId: verification.file_id,
        previousVerificationStatus: verification.status,
        verificationStatus: status,
        recognitionStatus: recognition.status,
        businessContractNumber: businessNumber.value,
        businessContractNumberSource: businessNumber.source,
        businessContractNumberUpdated: businessNumber.changed,
      },
      now,
    });
    return {
      contract: updatedContractResult.rows[0],
      verification: await loadVerificationWithClient(
        client,
        input.contractId,
        input.verificationId,
      ),
    };
  });
}

export async function submitSealedDifferenceForApproval(input: {
  contractId: string;
  verificationId: string;
  explanation: string;
  actorId: string;
  actorRole: string;
  expectedVersion: number;
}): Promise<SealWorkflowResult> {
  const explanation = String(input.explanation || "").trim();
  if (!explanation) {
    throw new ContractDomainError(400, "盖章版存在关键差异，必须填写差异说明");
  }
  return db.transaction(async (client) => {
    const contractResult = await client.query<ContractRow>(
      `SELECT * FROM contracts
       WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
      [input.contractId],
    );
    const contract = contractResult.rows[0];
    if (!contract) throw new ContractDomainError(404, "合同不存在");
    assertExpectedVersion(contract, input.expectedVersion);
    if (contract.status !== "pending_seal") {
      throw new ContractDomainError(409, "只有待盖章合同可以发起差异复审");
    }
    const verificationResult = await client.query<SealVerificationRow>(
      `SELECT v.*, f.is_current AS file_is_current
       FROM contract_seal_verifications v
       JOIN contract_files f ON f.id = v.file_id
       WHERE v.id = $1 AND v.contract_id = $2 FOR UPDATE OF v, f`,
      [input.verificationId, input.contractId],
    );
    const verification = verificationResult.rows[0];
    if (!verification) {
      throw new ContractDomainError(404, "盖章合同核验记录不存在");
    }
    if (!verification.file_is_current) {
      throw new ContractDomainError(409, "该盖章文件已不是当前版本");
    }
    if (verification.infrastructure_failure) {
      throw new ContractDomainError(
        409,
        "识别基础设施失败，不能发起差异复审",
        "SEALED_OCR_INFRASTRUCTURE_FAILED",
      );
    }
    if (verification.status !== "difference_explanation_required") {
      throw new ContractDomainError(409, "当前核验状态不需要差异复审");
    }
    const fieldsResult = await client.query<SealVerificationFieldRow>(
      `SELECT * FROM contract_seal_verification_fields
       WHERE verification_id = $1 FOR UPDATE`,
      [input.verificationId],
    );
    const approvedSnapshot = parseJson<ApprovedContractSnapshot>(
      verification.approved_snapshot_json,
      approvedSnapshotFromContract(contract),
    );
    if (
      hasUnqualifiedAutomaticRecognition(
        fieldsResult.rows,
        parseJson<string[]>(verification.recognition_warnings_json, []),
        approvedSnapshot,
      )
    ) {
      throw new ContractDomainError(
        409,
        "甲方、乙方或合同金额缺失、识别证据不足或来源不合格，请重新识别或重新上传盖章合同",
        "SEALED_RECOGNITION_QUALITY_REQUIRED",
      );
    }
    const mismatches = parseJson<SealedContractMismatch[]>(
      verification.mismatches_json,
      [],
    );
    if (mismatches.length === 0) {
      throw new ContractDomainError(409, "当前盖章版不存在需要复审的关键差异");
    }
    assertContractStatusTransition(contract.status, "approving");
    const now = new Date().toISOString();
    const { round } = await createContractApprovalRound(client, {
      contract,
      kind: "seal_difference",
      initiatorId: input.actorId,
      initiatorRole: input.actorRole,
      now,
    });
    const updatedContractResult = await client.query<ContractRow>(
      `UPDATE contracts SET status = 'approving', pending_action = 'seal',
         previous_status = 'pending_seal', submitted_at = $2,
         rejected_at = NULL, updated_by = $3, updated_at = $2,
         version = version + 1
       WHERE id = $1 RETURNING *`,
      [input.contractId, now, input.actorId],
    );
    await client.query(
      `UPDATE contract_seal_verifications SET
         status = 'difference_approving', difference_explanation = $2,
         approval_submitted_at = $3, approval_completed_at = NULL,
         updated_at = $3
       WHERE id = $1`,
      [input.verificationId, explanation, now],
    );
    await client.query(
      `INSERT INTO contract_approval_records (
         id, contract_id, approval_round_id, action, approver_id,
         approver_role, comment, from_status, to_status, created_at
       ) VALUES ($1,$2,$3,'seal_difference_submit',$4,$5,$6,
         'pending_seal','approving',$7)`,
      [
        nanoid(),
        input.contractId,
        round.id,
        input.actorId,
        input.actorRole,
        explanation,
        now,
      ],
    );
    await insertAudit(client, {
      contractId: input.contractId,
      action: "sealed_difference_reapproval_submitted",
      actorId: input.actorId,
      actorRole: input.actorRole,
      fromStatus: contract.status,
      toStatus: "approving",
      changes: {
        verificationId: input.verificationId,
        fileId: verification.file_id,
        approvedSnapshot: parseJson(verification.approved_snapshot_json, {}),
        mismatches,
        ...approvalTargetSnapshot(round),
      },
      comment: explanation,
      now,
    });
    await syncProjectContractTotal(client, contract.project_id);
    return {
      contract: updatedContractResult.rows[0],
      verification: await loadVerificationWithClient(
        client,
        input.contractId,
        input.verificationId,
      ),
    };
  });
}

export async function archiveVerifiedSealedContract(input: {
  contractId: string;
  verificationId: string;
  actorId: string;
  actorRole: string;
  expectedVersion: number;
}): Promise<SealWorkflowResult> {
  return db.transaction(async (client) => {
    const referenceResult = await client.query<{
      id: string;
      root_contract_id: string | null;
      renewed_from_contract_id: string | null;
    }>(
      `SELECT id, root_contract_id, renewed_from_contract_id FROM contracts
       WHERE id = $1 AND is_deleted = FALSE`,
      [input.contractId],
    );
    const reference = referenceResult.rows[0];
    if (!reference) throw new ContractDomainError(404, "合同不存在");
    const approvalLockIds = [
      reference.root_contract_id || reference.id,
      reference.renewed_from_contract_id,
    ]
      .filter((id): id is string => Boolean(id))
      .filter((id, index, values) => values.indexOf(id) === index)
      .sort();
    for (const approvalLockId of approvalLockIds) {
      await client.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended('contract-root-approval:' || $1, 0)
         )`,
        [approvalLockId],
      );
    }
    const contractResult = await client.query<ContractRow>(
      `SELECT * FROM contracts
       WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
      [input.contractId],
    );
    const contract = contractResult.rows[0];
    if (!contract) throw new ContractDomainError(404, "合同不存在");
    assertExpectedVersion(contract, input.expectedVersion);
    if (contract.status !== "pending_seal") {
      throw new ContractDomainError(409, "只有待盖章合同可以完成归档");
    }
    const verificationResult = await client.query<SealVerificationRow>(
      `SELECT v.*, f.is_current AS file_is_current
       FROM contract_seal_verifications v
       JOIN contract_files f ON f.id = v.file_id
       WHERE v.id = $1 AND v.contract_id = $2 FOR UPDATE OF v, f`,
      [input.verificationId, input.contractId],
    );
    const verification = verificationResult.rows[0];
    if (!verification) {
      throw new ContractDomainError(404, "盖章合同核验记录不存在");
    }
    if (!verification.file_is_current) {
      throw new ContractDomainError(409, "该盖章文件已不是当前版本");
    }
    if (verification.infrastructure_failure) {
      throw new ContractDomainError(
        409,
        "识别基础设施失败，不能归档生效",
        "SEALED_OCR_INFRASTRUCTURE_FAILED",
      );
    }
    const mismatches = parseJson<SealedContractMismatch[]>(
      verification.mismatches_json,
      [],
    );
    const allowedStatus =
      (mismatches.length === 0 && verification.status === "ready_to_archive") ||
      (mismatches.length > 0 && verification.status === "difference_approved");
    if (!allowedStatus) {
      throw new ContractDomainError(
        409,
        mismatches.length > 0
          ? "盖章版关键差异必须重新审批通过后才能生效"
          : "盖章版自动识别尚未达到归档条件",
        "SEALED_VERIFICATION_NOT_READY",
      );
    }
    const fieldsResult = await client.query<SealVerificationFieldRow>(
      `SELECT * FROM contract_seal_verification_fields
       WHERE verification_id = $1 FOR UPDATE`,
      [input.verificationId],
    );
    const approvedSnapshot = parseJson<ApprovedContractSnapshot>(
      verification.approved_snapshot_json,
      approvedSnapshotFromContract(contract),
    );
    if (
      hasUnqualifiedAutomaticRecognition(
        fieldsResult.rows,
        parseJson<string[]>(verification.recognition_warnings_json, []),
        approvedSnapshot,
      )
    ) {
      throw new ContractDomainError(
        409,
        "甲方、乙方或合同金额缺失、识别证据不足或来源不合格，请重新识别或重新上传盖章合同",
        "SEALED_RECOGNITION_QUALITY_REQUIRED",
      );
    }
    const dateField = fieldsResult.rows.find(
      (field) => field.field_code === "contract_date",
    );
    const contractDate = dateField?.final_value?.trim();
    if (!contractDate) {
      throw new ContractDomainError(409, "盖章合同签订日期尚未自动确定");
    }
    const contractDateSource: "ocr" | "upload_date" =
      dateField?.source === "upload_date" ? "upload_date" : "ocr";
    let rentalRenewalParent: ContractRow | null = null;
    let independentRenewalSource: ContractRow | null = null;
    if (["supplement", "termination"].includes(contract.relation_type)) {
      if (!contract.parent_contract_id) {
        throw new ContractDomainError(409, "子协议缺少上级合同关联");
      }
      const parent = await resolveContractParentContext(
        client,
        contract.parent_contract_id,
        true,
      );
      if (contract.lease_operation_type === "renewal") {
        const sealedLeaseTerms = extractContractLeaseTerms(
          verification.raw_text || "",
          "asset",
        );
        if (
          contract.relation_type !== "supplement" ||
          !contract.lease_previous_end_date ||
          parent.lease_end_date !== contract.lease_previous_end_date ||
          !contract.lease_start_date ||
          !contract.lease_end_date ||
          contract.lease_end_date <= contract.lease_previous_end_date
        ) {
          throw new ContractDomainError(
            409,
            "原合同租期已变化或续签租期不完整，不能归档",
            "CONTRACT_RENTAL_RENEWAL_STALE",
          );
        }
        if (
          sealedLeaseTerms.leaseStartDate !== contract.lease_start_date ||
          sealedLeaseTerms.leaseEndDate !== contract.lease_end_date
        ) {
          throw new ContractDomainError(
            409,
            "盖章续签协议的新租期与审批租期不一致，不能归档",
            "CONTRACT_RENTAL_RENEWAL_SEALED_PERIOD_MISMATCH",
          );
        }
        rentalRenewalParent = parent;
      }
      await assertRootAmountAfterAdjustment(client, contract, true);
    }
    if (contract.renewed_from_contract_id) {
      const sourceResult = await client.query<ContractRow>(
        `SELECT * FROM contracts
         WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
        [contract.renewed_from_contract_id],
      );
      const source = sourceResult.rows[0];
      const sealedLeaseTerms = extractContractLeaseTerms(
        verification.raw_text || "",
        "asset",
      );
      if (
        !source ||
        contract.relation_type !== "main" ||
        contract.root_contract_id !== contract.id ||
        contract.parent_contract_id !== null ||
        source.relation_type !== "main" ||
        source.root_contract_id !== source.id ||
        !["effective", "executing", "completed"].includes(source.status)
      ) {
        throw new ContractDomainError(
          409,
          "续签合同或前序租赁主合同的生命周期关系不正确",
          "CONTRACT_RENEWAL_SOURCE_INVALID",
        );
      }
      if (
        !contract.renewed_from_lease_end_date ||
        source.lease_end_date !== contract.renewed_from_lease_end_date ||
        !contract.lease_start_date ||
        !contract.lease_end_date ||
        contract.lease_start_date <= contract.renewed_from_lease_end_date ||
        contract.lease_end_date < contract.lease_start_date
      ) {
        throw new ContractDomainError(
          409,
          "前序合同到期日已变化或续签新租期不完整，不能归档",
          "CONTRACT_RENEWAL_SOURCE_STALE",
        );
      }
      if (
        sealedLeaseTerms.leaseStartDate !== contract.lease_start_date ||
        sealedLeaseTerms.leaseEndDate !== contract.lease_end_date
      ) {
        throw new ContractDomainError(
          409,
          "盖章续签合同的租期与审批版本不一致，不能归档",
          "CONTRACT_RENEWAL_SEALED_PERIOD_MISMATCH",
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
          "前序合同已有其他续签合同，不能归档",
          "CONTRACT_RENEWAL_ALREADY_EXISTS",
        );
      }
      independentRenewalSource = source;
    }
    assertContractStatusTransition(contract.status, "effective");
    const now = new Date().toISOString();
    await advanceSupplementAmountChainAtEffective(client, contract, now);
    if (rentalRenewalParent) {
      const previousEndDate = rentalRenewalParent.lease_end_date;
      const currentTermMonths = rentalRenewalParent.lease_start_date
        ? calculateContractLeaseMonthCount(
            rentalRenewalParent.lease_start_date,
            contract.lease_end_date!,
          )
        : rentalRenewalParent.lease_term_months;
      const renewedRoot = await client.query(
        `UPDATE contracts SET lease_end_date = $2,
           lease_term_months = $3, updated_by = $4, updated_at = $5,
           version = version + 1
         WHERE id = $1 AND lease_end_date IS NOT DISTINCT FROM $6`,
        [
          rentalRenewalParent.id,
          contract.lease_end_date,
          currentTermMonths,
          input.actorId,
          now,
          contract.lease_previous_end_date,
        ],
      );
      if (renewedRoot.rowCount !== 1) {
        throw new ContractDomainError(
          409,
          "原合同当前到期日已变化，续签归档已停止",
          "CONTRACT_RENTAL_RENEWAL_STALE",
        );
      }
      await insertAudit(client, {
        contractId: rentalRenewalParent.id,
        action: "rental_renewal_effective",
        actorId: input.actorId,
        actorRole: input.actorRole,
        fromStatus: rentalRenewalParent.status,
        toStatus: rentalRenewalParent.status,
        changes: {
          renewalContractId: contract.id,
          previousLeaseEndDate: previousEndDate,
          currentLeaseEndDate: contract.lease_end_date,
          renewalAmount: contract.amount_delta,
        },
        now,
      });
    }
    const terminationSnapshot = await applyTerminationAgreementAtEffective(
      client,
      contract,
      contractDate,
      now,
      input.actorId,
      input.actorRole,
    );
    const updatedContractResult = await client.query<ContractRow>(
      `UPDATE contracts SET status = 'effective', contract_date = $2,
         contract_date_source = $3, sealed_at = $4, effective_at = $4,
         pending_action = NULL, previous_status = NULL,
         updated_by = $5, updated_at = $4, version = version + 1
       WHERE id = $1 RETURNING *`,
      [input.contractId, contractDate, contractDateSource, now, input.actorId],
    );
    if (independentRenewalSource) {
      await insertAudit(client, {
        contractId: independentRenewalSource.id,
        action: "rental_renewal_successor_effective",
        actorId: input.actorId,
        actorRole: input.actorRole,
        fromStatus: independentRenewalSource.status,
        toStatus: independentRenewalSource.status,
        changes: {
          renewalContractId: contract.id,
          sourceLeaseEndDate: independentRenewalSource.lease_end_date,
          renewalLeaseStartDate: contract.lease_start_date,
          renewalLeaseEndDate: contract.lease_end_date,
          renewalContractAmount: contract.amount_delta,
          sourceLifecyclePreserved: true,
        },
        now,
      });
    }
    await client.query(
      `UPDATE contract_seal_verifications SET status = 'archived',
         archived_by = $2, archived_at = $3, updated_at = $3
       WHERE id = $1`,
      [input.verificationId, input.actorId, now],
    );
    await insertAudit(client, {
      contractId: input.contractId,
      action: "sealed_archive",
      actorId: input.actorId,
      actorRole: input.actorRole,
      fromStatus: contract.status,
      toStatus: "effective",
      changes: {
        verificationId: input.verificationId,
        fileId: verification.file_id,
        contractDate,
        dateSource: contractDateSource,
        recognitionSources: Object.fromEntries(
          fieldsResult.rows.map((field) => [field.field_code, field.source]),
        ),
        mismatches,
        differenceExplanation: verification.difference_explanation,
        differenceApprovalCompletedAt: verification.approval_completed_at,
        ...(terminationSnapshot
          ? { terminationSettlementSnapshot: terminationSnapshot }
          : {}),
      },
      now,
    });
    const recalculatedRoot = await recalculateContractExecutionStatus(
      client,
      input.contractId,
      input.actorId,
      input.actorRole,
    );
    const affectedProjectIds = [
      contract.project_id,
      recalculatedRoot.project_id,
    ]
      .filter((id): id is string => Boolean(id))
      .filter((id, index, values) => values.indexOf(id) === index)
      .sort();
    for (const projectId of affectedProjectIds) {
      await syncProjectContractTotal(client, projectId);
    }
    return {
      contract: updatedContractResult.rows[0],
      verification: await loadVerificationWithClient(
        client,
        input.contractId,
        input.verificationId,
      ),
    };
  });
}
