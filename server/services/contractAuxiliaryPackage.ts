import path from "path";
import type { PoolClient } from "pg";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import {
  normalizePaddleOcrModelVersion,
  resolvePaddleOcrModel,
  type PaddleOcrModelVersion,
} from "./ocrDaemon.js";
import {
  recognizeContractFile,
  type ContractOcrField,
  type ContractRawOcrLine,
  type ContractRecognitionResult,
} from "./contractOcr.js";
import { ContractDomainError } from "./contractService.js";
import {
  centsToAmount,
  MAX_CONTRACT_AMOUNT_CENTS,
  toCents,
} from "./contractAccounting.js";

export const CONTRACT_AUXILIARY_PARSER_VERSION =
  "contract-auxiliary-package-v1";
export const CONTRACT_AUXILIARY_MAX_FILES = 20;

const MAX_AUXILIARY_NOTE_LENGTH = 1000;
const AUXILIARY_FIELD_CODES = ["party_a", "party_b", "amount"] as const;

export type ContractAuxiliaryFileKind = "contract" | "invoice" | "receipt";
export type ContractAuxiliaryStatus =
  | "processing"
  | "succeeded"
  | "partial"
  | "failed";
export type ContractAuxiliaryFieldCode = (typeof AUXILIARY_FIELD_CODES)[number];

export interface ContractAuxiliaryStoredFile {
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  fileHash: string;
}

export interface ContractAuxiliaryFileSet {
  /** 兼容旧调用方的单文件输入，同时支持同一档案包上传多份合同。 */
  contract: ContractAuxiliaryStoredFile | ContractAuxiliaryStoredFile[];
  /** 兼容旧调用方的单文件输入，同时支持同一档案包上传多份发票。 */
  invoice?: ContractAuxiliaryStoredFile | ContractAuxiliaryStoredFile[] | null;
  /** 兼容旧调用方的单文件输入，同时支持同一档案包上传多份回单。 */
  receipt?: ContractAuxiliaryStoredFile | ContractAuxiliaryStoredFile[] | null;
}

export interface ContractAuxiliaryActor {
  id: string;
  role: string;
}

export interface ContractAuxiliaryFileView extends ContractAuxiliaryStoredFile {
  id: string;
  packageId: string;
  fileKind: ContractAuxiliaryFileKind;
  version: number;
  isCurrent: boolean;
  uploadedBy: string;
  createdAt: string;
}

export interface ContractAuxiliaryFieldEvidence {
  field: ContractAuxiliaryFieldCode;
  originalValue: string | null;
  normalizedValue: string | null;
  ocrConfidence: number | null;
  fieldScore: number;
  source: string;
  pageNumber: number | null;
  evidence: ContractOcrField["evidence"];
  candidates: ContractOcrField["candidates"];
  warnings: string[];
}

export interface ContractAuxiliaryOcrLine {
  page: number;
  text: string;
  bbox: number[][];
  confidence: number;
  modelVersion: PaddleOcrModelVersion;
}

export interface ContractAuxiliaryPackageView {
  id: string;
  parentContractId: string;
  partyA: string | null;
  partyB: string | null;
  recognizedAmount: number | null;
  note: string | null;
  status: ContractAuxiliaryStatus;
  rawText: string | null;
  ocrFields: ContractAuxiliaryFieldEvidence[];
  ocrLines: ContractAuxiliaryOcrLine[];
  warnings: string[];
  errorMessage: string | null;
  modelVersion: PaddleOcrModelVersion | null;
  parserVersion: string | null;
  retryCount: number;
  version: number;
  /** 辅助资料仅用于归档，数据库硬约束始终固定为 false。 */
  accountingIncluded: false;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  files: ContractAuxiliaryFileView[];
}

export interface CreateContractAuxiliaryPackageInput {
  parentContractId: string;
  files: ContractAuxiliaryFileSet;
  note?: string | null;
  actor: ContractAuxiliaryActor;
}

export interface AppendContractAuxiliaryFilesInput extends ContractAuxiliaryMutationIdentity {
  files: Partial<ContractAuxiliaryFileSet>;
  expectedVersion: number;
  note?: string | null;
}

export interface ContractAuxiliaryMutationIdentity {
  parentContractId: string;
  packageId: string;
  actor: ContractAuxiliaryActor;
}

export interface UpdateContractAuxiliaryNoteInput extends ContractAuxiliaryMutationIdentity {
  note?: string | null;
  expectedVersion: number;
}

export interface DeleteContractAuxiliaryPackageInput extends ContractAuxiliaryMutationIdentity {
  expectedVersion: number;
}

export interface RetryContractAuxiliaryPackageInput extends ContractAuxiliaryMutationIdentity {
  expectedVersion: number;
}

interface ContractAuxiliaryPackageRow {
  id: string;
  parent_contract_id: string;
  party_a: string | null;
  party_b: string | null;
  recognized_amount: number | string | null;
  note: string | null;
  status: ContractAuxiliaryStatus;
  raw_text: string | null;
  ocr_fields_json: unknown;
  ocr_lines_json: unknown;
  warnings_json: unknown;
  error_message: string | null;
  model_version: PaddleOcrModelVersion | null;
  parser_version: string | null;
  retry_count: number;
  version: number;
  accounting_included: boolean;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

interface ContractAuxiliaryFileRow {
  id: string;
  package_id: string;
  file_kind: ContractAuxiliaryFileKind;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  file_hash: string;
  version: number;
  is_current: boolean;
  uploaded_by: string;
  created_at: string;
}

interface RecognitionSnapshot {
  status: Exclude<ContractAuxiliaryStatus, "processing">;
  partyA: string | null;
  partyB: string | null;
  recognizedAmount: number | null;
  rawText: string | null;
  fields: ContractAuxiliaryFieldEvidence[];
  lines: ContractAuxiliaryOcrLine[];
  warnings: string[];
  errorMessage: string | null;
  modelVersion: PaddleOcrModelVersion | null;
}

type ContractRecognitionRunner = typeof recognizeContractFile;

function requiredIdentifier(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new ContractDomainError(400, `${label}不能为空`);
  }
  return normalized;
}

function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > MAX_AUXILIARY_NOTE_LENGTH) {
    throw new ContractDomainError(
      400,
      `辅助合同备注不能超过 ${MAX_AUXILIARY_NOTE_LENGTH} 个字符`,
      "CONTRACT_AUXILIARY_NOTE_TOO_LONG",
    );
  }
  return normalized;
}

function parseExpectedVersion(value: unknown): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new ContractDomainError(
      400,
      "辅助合同版本号不正确",
      "CONTRACT_AUXILIARY_VERSION_INVALID",
    );
  }
  return version;
}

function assertAccountingScopeCannotBeOverridden(input: unknown): void {
  if (!input || typeof input !== "object") return;
  const candidate = input as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(candidate, "accountingIncluded") ||
    Object.prototype.hasOwnProperty.call(candidate, "accounting_included")
  ) {
    throw new ContractDomainError(
      400,
      "辅助合同固定不参与合同额及实际收入核算",
      "CONTRACT_AUXILIARY_ACCOUNTING_SCOPE_IMMUTABLE",
    );
  }
}

const MIME_TYPES_BY_KIND: Record<
  ContractAuxiliaryFileKind,
  ReadonlySet<string>
> = {
  contract: new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  invoice: new Set(["application/pdf", "image/jpeg", "image/png"]),
  receipt: new Set(["application/pdf", "image/jpeg", "image/png"]),
};

function validateStoredFile(
  kind: ContractAuxiliaryFileKind,
  value: ContractAuxiliaryStoredFile,
): ContractAuxiliaryStoredFile {
  if (!value || typeof value !== "object") {
    throw new ContractDomainError(
      400,
      kind === "contract" ? "必须上传辅助合同文件" : "辅助资料文件不完整",
      "CONTRACT_AUXILIARY_FILE_REQUIRED",
    );
  }
  const fileName = requiredIdentifier(value.fileName, "文件名");
  const filePath = requiredIdentifier(value.filePath, "文件路径");
  const mimeType = requiredIdentifier(
    value.mimeType,
    "文件媒体类型",
  ).toLowerCase();
  const fileHash = requiredIdentifier(value.fileHash, "文件摘要").toLowerCase();
  const fileSize = Number(value.fileSize);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw new ContractDomainError(400, "辅助资料文件大小不正确");
  }
  if (!/^[a-f0-9]{64}$/.test(fileHash)) {
    throw new ContractDomainError(400, "辅助资料文件摘要不正确");
  }
  if (
    path.isAbsolute(filePath) ||
    filePath.split(/[\\/]+/u).some((segment) => segment === "..")
  ) {
    throw new ContractDomainError(400, "辅助资料文件路径不安全");
  }
  if (!MIME_TYPES_BY_KIND[kind].has(mimeType)) {
    throw new ContractDomainError(
      400,
      kind === "contract"
        ? "辅助合同仅支持 PDF、DOC 或 DOCX 文件"
        : "辅助发票和回单仅支持 PDF、JPEG 或 PNG 文件",
      "CONTRACT_AUXILIARY_FILE_TYPE_INVALID",
    );
  }
  return { fileName, filePath, fileSize, mimeType, fileHash };
}

function normalizeFileSet(files: ContractAuxiliaryFileSet): Array<{
  kind: ContractAuxiliaryFileKind;
  file: ContractAuxiliaryStoredFile;
}> {
  if (!files || !files.contract) {
    throw new ContractDomainError(
      400,
      "必须上传辅助合同文件",
      "CONTRACT_AUXILIARY_CONTRACT_FILE_REQUIRED",
    );
  }
  const contracts = Array.isArray(files.contract)
    ? files.contract
    : [files.contract];
  if (contracts.length === 0) {
    throw new ContractDomainError(
      400,
      "至少上传 1 份辅助合同文件",
      "CONTRACT_AUXILIARY_CONTRACT_FILE_REQUIRED",
    );
  }
  const invoices = Array.isArray(files.invoice)
    ? files.invoice
    : files.invoice
      ? [files.invoice]
      : [];
  const receipts = Array.isArray(files.receipt)
    ? files.receipt
    : files.receipt
      ? [files.receipt]
      : [];
  if (
    contracts.length + invoices.length + receipts.length >
    CONTRACT_AUXILIARY_MAX_FILES
  ) {
    throw new ContractDomainError(
      400,
      `同一辅助档案包最多上传 ${CONTRACT_AUXILIARY_MAX_FILES} 份文件`,
      "CONTRACT_AUXILIARY_FILE_COUNT_EXCEEDED",
    );
  }
  const normalized = [
    ...contracts.map((file) => ({
      kind: "contract" as const,
      file: validateStoredFile("contract", file),
    })),
    ...invoices.map((file) => ({
      kind: "invoice" as const,
      file: validateStoredFile("invoice", file),
    })),
    ...receipts.map((file) => ({
      kind: "receipt" as const,
      file: validateStoredFile("receipt", file),
    })),
  ];
  const hashes = new Set<string>();
  for (const item of normalized) {
    if (hashes.has(item.file.fileHash)) {
      throw new ContractDomainError(
        409,
        "同一辅助档案包不能重复上传相同文件",
        "CONTRACT_AUXILIARY_DUPLICATE_FILE",
      );
    }
    hashes.add(item.file.fileHash);
  }
  return normalized;
}

function normalizeAppendFileSet(
  files: Partial<ContractAuxiliaryFileSet>,
): Array<{
  kind: ContractAuxiliaryFileKind;
  file: ContractAuxiliaryStoredFile;
}> {
  const contracts = Array.isArray(files.contract)
    ? files.contract
    : files.contract
      ? [files.contract]
      : [];
  const invoices = Array.isArray(files.invoice)
    ? files.invoice
    : files.invoice
      ? [files.invoice]
      : [];
  const receipts = Array.isArray(files.receipt)
    ? files.receipt
    : files.receipt
      ? [files.receipt]
      : [];
  if (contracts.length + invoices.length + receipts.length === 0) {
    throw new ContractDomainError(
      400,
      "请至少选择一份需要追加的辅助材料",
      "CONTRACT_AUXILIARY_APPEND_FILE_REQUIRED",
    );
  }
  if (
    contracts.length + invoices.length + receipts.length >
    CONTRACT_AUXILIARY_MAX_FILES
  ) {
    throw new ContractDomainError(
      400,
      `同一辅助档案包最多上传 ${CONTRACT_AUXILIARY_MAX_FILES} 份文件`,
      "CONTRACT_AUXILIARY_FILE_COUNT_EXCEEDED",
    );
  }
  const normalized = [
    ...contracts.map((file) => ({
      kind: "contract" as const,
      file: validateStoredFile("contract", file),
    })),
    ...invoices.map((file) => ({
      kind: "invoice" as const,
      file: validateStoredFile("invoice", file),
    })),
    ...receipts.map((file) => ({
      kind: "receipt" as const,
      file: validateStoredFile("receipt", file),
    })),
  ];
  const hashes = new Set<string>();
  for (const item of normalized) {
    if (hashes.has(item.file.fileHash)) {
      throw new ContractDomainError(
        409,
        "本次追加不能包含重复文件",
        "CONTRACT_AUXILIARY_DUPLICATE_FILE",
      );
    }
    hashes.add(item.file.fileHash);
  }
  return normalized;
}

function stringOrNull(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeFieldScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.floor(parsed)));
}

function normalizeOcrConfidence(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const ratio = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return Math.max(0, Math.min(1, ratio));
}

function selectedField(
  result: ContractRecognitionResult,
  code: ContractAuxiliaryFieldCode,
): ContractOcrField | undefined {
  return result.fields.find((field) => field.field === code);
}

function normalizedAmount(value: unknown): number | null {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[¥￥,，\s元]/gu, "")
    .trim();
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  try {
    const cents = toCents(normalized);
    if (Math.abs(cents) > MAX_CONTRACT_AMOUNT_CENTS) return null;
    return centsToAmount(cents);
  } catch {
    return null;
  }
}

function normalizeBbox(value: unknown): number[][] {
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

function serializeField(
  result: ContractRecognitionResult,
  code: ContractAuxiliaryFieldCode,
): ContractAuxiliaryFieldEvidence {
  const field = selectedField(result, code);
  return {
    field: code,
    originalValue: stringOrNull(field?.originalValue),
    normalizedValue: stringOrNull(field?.normalizedValue),
    ocrConfidence: normalizeOcrConfidence(field?.ocrConfidence),
    fieldScore: normalizeFieldScore(field?.fieldScore ?? field?.confidence),
    source: stringOrNull(field?.source) || "none",
    pageNumber:
      field?.pageNumber && Number.isFinite(Number(field.pageNumber))
        ? Math.max(1, Math.floor(Number(field.pageNumber)))
        : null,
    evidence: Array.isArray(field?.evidence) ? field.evidence : [],
    candidates: Array.isArray(field?.candidates) ? field.candidates : [],
    warnings: Array.isArray(field?.warnings) ? field.warnings.map(String) : [],
  };
}

function serializeLine(
  line: ContractRawOcrLine,
  fallbackModel: PaddleOcrModelVersion,
): ContractAuxiliaryOcrLine {
  return {
    page: Math.max(1, Math.floor(Number(line.page) || 1)),
    text: String(line.text ?? ""),
    bbox: normalizeBbox(line.bbox),
    confidence: normalizeOcrConfidence(line.confidence) ?? 0,
    modelVersion: normalizePaddleOcrModelVersion(
      line.modelVersion,
      fallbackModel,
    ),
  };
}

function buildRecognitionSnapshot(
  result: ContractRecognitionResult,
): RecognitionSnapshot {
  const fallbackModel = resolvePaddleOcrModel();
  const modelVersion = result.modelVersion
    ? normalizePaddleOcrModelVersion(result.modelVersion, fallbackModel)
    : result.ocrLines[0]?.modelVersion
      ? normalizePaddleOcrModelVersion(
          result.ocrLines[0].modelVersion,
          fallbackModel,
        )
      : null;
  const fields = AUXILIARY_FIELD_CODES.map((code) =>
    serializeField(result, code),
  );
  const infrastructureOrDocumentFailure =
    result.status === "failed" || Boolean(result.failureKind);
  const partyA = infrastructureOrDocumentFailure
    ? null
    : fields.find((field) => field.field === "party_a")?.normalizedValue ||
      null;
  const partyB = infrastructureOrDocumentFailure
    ? null
    : fields.find((field) => field.field === "party_b")?.normalizedValue ||
      null;
  const recognizedAmount = infrastructureOrDocumentFailure
    ? null
    : normalizedAmount(
        fields.find((field) => field.field === "amount")?.normalizedValue,
      );
  const missingFields = [
    ...(partyA ? [] : ["甲方单位"]),
    ...(partyB ? [] : ["乙方单位"]),
    ...(recognizedAmount === null ? ["合同金额"] : []),
  ];
  const status: RecognitionSnapshot["status"] =
    infrastructureOrDocumentFailure || missingFields.length === 3
      ? "failed"
      : missingFields.length > 0
        ? "partial"
        : "succeeded";
  const derivedWarning =
    status === "partial"
      ? `辅助合同识别不完整：未形成${missingFields.join("、")}候选`
      : null;
  const warnings = [
    ...(Array.isArray(result.warnings) ? result.warnings.map(String) : []),
    ...(derivedWarning ? [derivedWarning] : []),
  ];
  const errorMessage =
    status === "failed"
      ? result.failureKind === "infrastructure"
        ? "辅助合同识别基础设施暂时不可用"
        : result.failureKind === "document"
          ? "辅助合同文件无法安全识别"
          : missingFields.length > 0
            ? `辅助合同未识别出${missingFields.join("、")}`
            : "辅助合同识别失败"
      : null;
  return {
    status,
    partyA,
    partyB,
    recognizedAmount,
    rawText: stringOrNull(result.rawText),
    fields,
    lines: result.ocrLines.map((line) => serializeLine(line, fallbackModel)),
    warnings: [...new Set(warnings)],
    errorMessage,
    modelVersion,
  };
}

async function assertParentContractExists(
  client: PoolClient,
  parentContractId: string,
): Promise<void> {
  const parent = await client.query<{
    id: string;
    status: string;
    requires_auxiliary_materials: boolean;
  }>(
    `SELECT id, status, requires_auxiliary_materials FROM contracts
     WHERE id = $1 AND is_deleted = FALSE
     FOR SHARE`,
    [parentContractId],
  );
  const contract = parent.rows[0];
  if (!contract) {
    throw new ContractDomainError(404, "合同不存在");
  }
  if (!contract.requires_auxiliary_materials) {
    throw new ContractDomainError(
      409,
      "请先将合同设置为需要添加辅助材料",
      "CONTRACT_AUXILIARY_NOT_REQUIRED",
    );
  }
  if (["rejected", "terminated"].includes(contract.status)) {
    throw new ContractDomainError(
      409,
      "已拒绝或已终止合同不能添加辅助材料",
      "CONTRACT_AUXILIARY_STATUS_FORBIDDEN",
    );
  }
}

async function insertAuxiliaryAudit(
  client: PoolClient,
  input: {
    parentContractId: string;
    packageId: string;
    action: string;
    actor: ContractAuxiliaryActor;
    changes?: Record<string, unknown>;
    now: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO contract_audit_logs (
       id, contract_id, action, actor_id, actor_role, from_status,
       to_status, changes_json, created_at
     ) SELECT $1, c.id, $2, $3, $4, c.status, c.status, $5::jsonb, $6
       FROM contracts c WHERE c.id = $7 AND c.is_deleted = FALSE`,
    [
      nanoid(),
      input.action,
      input.actor.id,
      input.actor.role,
      JSON.stringify({ packageId: input.packageId, ...input.changes }),
      input.now,
      input.parentContractId,
    ],
  );
}

function mapFileRow(row: ContractAuxiliaryFileRow): ContractAuxiliaryFileView {
  return {
    id: row.id,
    packageId: row.package_id,
    fileKind: row.file_kind,
    fileName: row.file_name,
    filePath: row.file_path,
    fileSize: Number(row.file_size),
    mimeType: row.mime_type,
    fileHash: row.file_hash,
    version: Number(row.version),
    isCurrent: Boolean(row.is_current),
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function mapPackageRow(
  row: ContractAuxiliaryPackageRow,
  files: ContractAuxiliaryFileRow[],
): ContractAuxiliaryPackageView {
  if (row.accounting_included !== false) {
    throw new ContractDomainError(
      500,
      "辅助合同核算隔离状态异常，已阻止读取",
      "CONTRACT_AUXILIARY_ACCOUNTING_SCOPE_CORRUPTED",
    );
  }
  return {
    id: row.id,
    parentContractId: row.parent_contract_id,
    partyA: row.party_a,
    partyB: row.party_b,
    recognizedAmount:
      row.recognized_amount === null ? null : Number(row.recognized_amount),
    note: row.note,
    status: row.status,
    rawText: row.raw_text,
    ocrFields: safeArray<ContractAuxiliaryFieldEvidence>(row.ocr_fields_json),
    ocrLines: safeArray<ContractAuxiliaryOcrLine>(row.ocr_lines_json),
    warnings: safeArray<string>(row.warnings_json).map(String),
    errorMessage: row.error_message,
    modelVersion: row.model_version,
    parserVersion: row.parser_version,
    retryCount: Number(row.retry_count),
    version: Number(row.version),
    accountingIncluded: false,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files: files.filter((file) => file.package_id === row.id).map(mapFileRow),
  };
}

export async function createContractAuxiliaryPackage(
  input: CreateContractAuxiliaryPackageInput,
): Promise<{
  packageId: string;
  parentContractId: string;
  status: "succeeded";
  version: 1;
  accountingIncluded: false;
  files: ContractAuxiliaryFileView[];
}> {
  assertAccountingScopeCannotBeOverridden(input);
  const parentContractId = requiredIdentifier(
    input.parentContractId,
    "关联主合同",
  );
  const actorId = requiredIdentifier(input.actor?.id, "操作人");
  const actorRole = requiredIdentifier(input.actor?.role, "操作角色");
  const actor = { id: actorId, role: actorRole };
  const note = normalizeNote(input.note);
  const files = normalizeFileSet(input.files);

  return db.transaction(async (client) => {
    await assertParentContractExists(client, parentContractId);
    const packageId = nanoid();
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO contract_auxiliary_packages (
         id, parent_contract_id, party_a, party_b, recognized_amount,
         note, status, raw_text, ocr_fields_json, ocr_lines_json,
         warnings_json, error_message, model_version, parser_version,
         retry_count, version, accounting_included, created_by, updated_by,
         created_at, updated_at
       ) VALUES (
         $1,$2,NULL,NULL,NULL,$3,'succeeded',NULL,'[]'::jsonb,'[]'::jsonb,
         '[]'::jsonb,NULL,NULL,NULL,0,1,FALSE,$4,$4,$5,$5
       )`,
      [packageId, parentContractId, note, actor.id, now],
    );
    const createdFiles: ContractAuxiliaryFileView[] = [];
    for (const { kind, file } of files) {
      const fileId = nanoid();
      await client.query(
        `INSERT INTO contract_auxiliary_files (
           id, package_id, file_kind, file_name, file_path, file_size,
           mime_type, file_hash, version, is_current, uploaded_by, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,TRUE,$9,$10)`,
        [
          fileId,
          packageId,
          kind,
          file.fileName,
          file.filePath,
          file.fileSize,
          file.mimeType,
          file.fileHash,
          actor.id,
          now,
        ],
      );
      createdFiles.push({
        id: fileId,
        packageId,
        fileKind: kind,
        ...file,
        version: 1,
        isCurrent: true,
        uploadedBy: actor.id,
        createdAt: now,
      });
    }
    await insertAuxiliaryAudit(client, {
      parentContractId,
      packageId,
      action: "auxiliary_package_created",
      actor,
      changes: {
        accountingIncluded: false,
        fileKinds: files.map((file) => file.kind),
      },
      now,
    });
    return {
      packageId,
      parentContractId,
      status: "succeeded" as const,
      version: 1 as const,
      accountingIncluded: false as const,
      files: createdFiles,
    };
  });
}

export async function appendContractAuxiliaryFiles(
  input: AppendContractAuxiliaryFilesInput,
): Promise<{
  packageId: string;
  version: number;
  accountingIncluded: false;
  files: ContractAuxiliaryFileView[];
}> {
  assertAccountingScopeCannotBeOverridden(input);
  const parentContractId = requiredIdentifier(
    input.parentContractId,
    "关联主合同",
  );
  const packageId = requiredIdentifier(input.packageId, "辅助档案包");
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  const note = input.note === undefined ? undefined : normalizeNote(input.note);
  const actor = {
    id: requiredIdentifier(input.actor?.id, "操作人"),
    role: requiredIdentifier(input.actor?.role, "操作角色"),
  };
  const files = normalizeAppendFileSet(input.files);

  return db.transaction(async (client) => {
    await assertParentContractExists(client, parentContractId);
    const current = await client.query<{
      version: number;
      status: ContractAuxiliaryStatus;
      note: string | null;
    }>(
      `SELECT version, status, note FROM contract_auxiliary_packages
        WHERE id = $1 AND parent_contract_id = $2 FOR UPDATE`,
      [packageId, parentContractId],
    );
    const packageRow = current.rows[0];
    if (!packageRow) {
      throw new ContractDomainError(
        404,
        "辅助合同档案不存在",
        "CONTRACT_AUXILIARY_PACKAGE_NOT_FOUND",
      );
    }
    if (Number(packageRow.version) !== expectedVersion) {
      throw new ContractDomainError(
        409,
        "辅助合同已被其他人修改，请刷新后重试",
        "CONTRACT_AUXILIARY_VERSION_CONFLICT",
      );
    }
    if (packageRow.status === "processing") {
      throw new ContractDomainError(
        409,
        "辅助合同正在归档，请稍后再追加材料",
        "CONTRACT_AUXILIARY_PROCESSING",
      );
    }
    const existing = await client.query<{
      file_hash: string;
      file_kind: ContractAuxiliaryFileKind;
    }>(
      `SELECT file_hash, file_kind FROM contract_auxiliary_files
        WHERE package_id = $1 AND is_current = TRUE FOR UPDATE`,
      [packageId],
    );
    if (existing.rows.length + files.length > CONTRACT_AUXILIARY_MAX_FILES) {
      throw new ContractDomainError(
        409,
        `同一辅助档案包最多上传 ${CONTRACT_AUXILIARY_MAX_FILES} 份文件`,
        "CONTRACT_AUXILIARY_FILE_COUNT_EXCEEDED",
      );
    }
    if (
      !existing.rows.some((file) => file.file_kind === "contract") &&
      !files.some((file) => file.kind === "contract")
    ) {
      throw new ContractDomainError(
        409,
        "辅助档案缺少辅助合同，请先追加辅助合同",
        "CONTRACT_AUXILIARY_CONTRACT_FILE_REQUIRED",
      );
    }
    const existingHashes = new Set(existing.rows.map((file) => file.file_hash));
    if (files.some((file) => existingHashes.has(file.file.fileHash))) {
      throw new ContractDomainError(
        409,
        "该辅助材料已经归档，请勿重复上传",
        "CONTRACT_AUXILIARY_DUPLICATE_FILE",
      );
    }
    const now = new Date().toISOString();
    const createdFiles: ContractAuxiliaryFileView[] = [];
    for (const { kind, file } of files) {
      const fileId = nanoid();
      await client.query(
        `INSERT INTO contract_auxiliary_files (
           id, package_id, file_kind, file_name, file_path, file_size,
           mime_type, file_hash, version, is_current, uploaded_by, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,TRUE,$9,$10)`,
        [
          fileId,
          packageId,
          kind,
          file.fileName,
          file.filePath,
          file.fileSize,
          file.mimeType,
          file.fileHash,
          actor.id,
          now,
        ],
      );
      createdFiles.push({
        id: fileId,
        packageId,
        fileKind: kind,
        ...file,
        version: 1,
        isCurrent: true,
        uploadedBy: actor.id,
        createdAt: now,
      });
    }
    const updated = await client.query(
      `UPDATE contract_auxiliary_packages
          SET updated_by = $3, updated_at = $4,
              note = COALESCE($6, note), version = version + 1
        WHERE id = $1 AND parent_contract_id = $2 AND version = $5`,
      [
        packageId,
        parentContractId,
        actor.id,
        now,
        expectedVersion,
        note ?? null,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new ContractDomainError(
        409,
        "辅助合同已被其他人修改，请刷新后重试",
        "CONTRACT_AUXILIARY_VERSION_CONFLICT",
      );
    }
    await insertAuxiliaryAudit(client, {
      parentContractId,
      packageId,
      action: "auxiliary_package_files_appended",
      actor,
      changes: {
        fileCount: files.length,
        fileKinds: files.map((file) => file.kind),
        noteChanged: note !== undefined && note !== packageRow.note,
        accountingIncluded: false,
      },
      now,
    });
    return {
      packageId,
      version: expectedVersion + 1,
      accountingIncluded: false as const,
      files: createdFiles,
    };
  });
}

export async function getContractAuxiliaryPackage(
  parentContractIdInput: string,
  packageIdInput: string,
): Promise<ContractAuxiliaryPackageView> {
  const parentContractId = requiredIdentifier(
    parentContractIdInput,
    "关联主合同",
  );
  const packageId = requiredIdentifier(packageIdInput, "辅助档案包");
  const row = await db.get<ContractAuxiliaryPackageRow>(
    `SELECT package.*
       FROM contract_auxiliary_packages package
       JOIN contracts parent ON parent.id = package.parent_contract_id
      WHERE package.id = ? AND package.parent_contract_id = ?
        AND parent.is_deleted = FALSE`,
    packageId,
    parentContractId,
  );
  if (!row) {
    throw new ContractDomainError(
      404,
      "辅助合同档案不存在",
      "CONTRACT_AUXILIARY_PACKAGE_NOT_FOUND",
    );
  }
  const files = await db.all<ContractAuxiliaryFileRow>(
    `SELECT * FROM contract_auxiliary_files
      WHERE package_id = ? AND is_current = TRUE
      ORDER BY CASE file_kind
        WHEN 'contract' THEN 0 WHEN 'invoice' THEN 1 ELSE 2 END,
        file_kind ASC, created_at ASC, id ASC`,
    packageId,
  );
  return mapPackageRow(row, files);
}

export async function listContractAuxiliaryPackages(
  parentContractIdInput: string,
): Promise<ContractAuxiliaryPackageView[]> {
  const parentContractId = requiredIdentifier(
    parentContractIdInput,
    "关联主合同",
  );
  const rows = await db.all<ContractAuxiliaryPackageRow>(
    `SELECT package.*
       FROM contract_auxiliary_packages package
       JOIN contracts parent ON parent.id = package.parent_contract_id
      WHERE package.parent_contract_id = ? AND parent.is_deleted = FALSE
      ORDER BY package.created_at DESC, package.id DESC`,
    parentContractId,
  );
  if (rows.length === 0) return [];
  const files = await db.all<ContractAuxiliaryFileRow>(
    `SELECT file.* FROM contract_auxiliary_files file
      JOIN contract_auxiliary_packages package ON package.id = file.package_id
      WHERE package.parent_contract_id = ? AND file.is_current = TRUE
      ORDER BY CASE file.file_kind
        WHEN 'contract' THEN 0 WHEN 'invoice' THEN 1 ELSE 2 END,
        file.file_kind ASC, file.created_at ASC, file.id ASC`,
    parentContractId,
  );
  return rows.map((row) => mapPackageRow(row, files));
}

async function loadProcessingContractFile(input: {
  parentContractId: string;
  packageId: string;
}): Promise<{
  packageId: string;
  parentContractId: string;
  version: number;
  filePath: string;
  mimeType: string;
}> {
  const row = await db.get<{
    id: string;
    parent_contract_id: string;
    status: ContractAuxiliaryStatus;
    version: number;
    file_path: string;
    mime_type: string;
  }>(
    `SELECT package.id, package.parent_contract_id, package.status,
         package.version, file.file_path, file.mime_type
       FROM contract_auxiliary_packages package
       JOIN contracts parent ON parent.id = package.parent_contract_id
       JOIN contract_auxiliary_files file
         ON file.package_id = package.id
        AND file.file_kind = 'contract' AND file.is_current = TRUE
      WHERE package.id = ? AND package.parent_contract_id = ?
        AND parent.is_deleted = FALSE`,
    input.packageId,
    input.parentContractId,
  );
  if (!row) {
    throw new ContractDomainError(
      404,
      "辅助合同档案或合同文件不存在",
      "CONTRACT_AUXILIARY_PACKAGE_NOT_FOUND",
    );
  }
  if (row.status !== "processing") {
    throw new ContractDomainError(
      409,
      "辅助合同当前不处于待识别状态",
      "CONTRACT_AUXILIARY_RECOGNITION_STATE_INVALID",
    );
  }
  return {
    packageId: row.id,
    parentContractId: row.parent_contract_id,
    version: Number(row.version),
    filePath: row.file_path,
    mimeType: row.mime_type,
  };
}

export async function runContractAuxiliaryPackageRecognition(
  identity: ContractAuxiliaryMutationIdentity,
  recognitionRunner: ContractRecognitionRunner = recognizeContractFile,
): Promise<{
  packageId: string;
  status: RecognitionSnapshot["status"];
  partyA: string | null;
  partyB: string | null;
  recognizedAmount: number | null;
  modelVersion: PaddleOcrModelVersion | null;
  version: number;
  accountingIncluded: false;
}> {
  const parentContractId = requiredIdentifier(
    identity.parentContractId,
    "关联主合同",
  );
  const packageId = requiredIdentifier(identity.packageId, "辅助档案包");
  const actor = {
    id: requiredIdentifier(identity.actor?.id, "操作人"),
    role: requiredIdentifier(identity.actor?.role, "操作角色"),
  };
  const target = await loadProcessingContractFile({
    parentContractId,
    packageId,
  });
  let result: ContractRecognitionResult;
  try {
    result = await recognitionRunner(target.filePath, target.mimeType);
  } catch {
    result = {
      status: "failed",
      failureKind: "infrastructure",
      fields: [],
      rawText: "",
      method: "none",
      warnings: ["辅助合同识别执行失败，请稍后重试"],
      ocrLines: [],
    };
  }
  const snapshot = buildRecognitionSnapshot(result);
  const now = new Date().toISOString();
  const updatedVersion = target.version + 1;
  await db.transaction(async (client) => {
    const updated = await client.query(
      `UPDATE contract_auxiliary_packages SET
         party_a = $4, party_b = $5, recognized_amount = $6,
         status = $7, raw_text = $8, ocr_fields_json = $9::jsonb,
         ocr_lines_json = $10::jsonb, warnings_json = $11::jsonb,
         error_message = $12, model_version = $13, parser_version = $14,
         updated_by = $15, updated_at = $16, version = version + 1
       WHERE id = $1 AND parent_contract_id = $2
         AND status = 'processing' AND version = $3`,
      [
        packageId,
        parentContractId,
        target.version,
        snapshot.partyA,
        snapshot.partyB,
        snapshot.recognizedAmount,
        snapshot.status,
        snapshot.rawText,
        JSON.stringify(snapshot.fields),
        JSON.stringify(snapshot.lines),
        JSON.stringify(snapshot.warnings),
        snapshot.errorMessage,
        snapshot.modelVersion,
        CONTRACT_AUXILIARY_PARSER_VERSION,
        actor.id,
        now,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new ContractDomainError(
        409,
        "辅助合同识别状态已变化，请刷新后重试",
        "CONTRACT_AUXILIARY_RECOGNITION_STATE_CHANGED",
      );
    }
    await insertAuxiliaryAudit(client, {
      parentContractId,
      packageId,
      action: "auxiliary_package_recognized",
      actor,
      changes: {
        status: snapshot.status,
        modelVersion: snapshot.modelVersion,
        parserVersion: CONTRACT_AUXILIARY_PARSER_VERSION,
        accountingIncluded: false,
      },
      now,
    });
  });
  return {
    packageId,
    status: snapshot.status,
    partyA: snapshot.partyA,
    partyB: snapshot.partyB,
    recognizedAmount: snapshot.recognizedAmount,
    modelVersion: snapshot.modelVersion,
    version: updatedVersion,
    accountingIncluded: false,
  };
}

export async function updateContractAuxiliaryPackageNote(
  input: UpdateContractAuxiliaryNoteInput,
): Promise<{ packageId: string; note: string | null; version: number }> {
  assertAccountingScopeCannotBeOverridden(input);
  const parentContractId = requiredIdentifier(
    input.parentContractId,
    "关联主合同",
  );
  const packageId = requiredIdentifier(input.packageId, "辅助档案包");
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  const note = normalizeNote(input.note);
  const actor = {
    id: requiredIdentifier(input.actor?.id, "操作人"),
    role: requiredIdentifier(input.actor?.role, "操作角色"),
  };
  const version = expectedVersion + 1;
  await db.transaction(async (client) => {
    const current = await client.query<{
      status: ContractAuxiliaryStatus;
      note: string | null;
    }>(
      `SELECT status, note FROM contract_auxiliary_packages
        WHERE id = $1 AND parent_contract_id = $2 FOR UPDATE`,
      [packageId, parentContractId],
    );
    if (!current.rows[0]) {
      throw new ContractDomainError(
        404,
        "辅助合同档案不存在",
        "CONTRACT_AUXILIARY_PACKAGE_NOT_FOUND",
      );
    }
    if (current.rows[0].status === "processing") {
      throw new ContractDomainError(
        409,
        "辅助合同正在识别，请识别完成后再修改备注",
        "CONTRACT_AUXILIARY_PROCESSING",
      );
    }
    const now = new Date().toISOString();
    const updated = await client.query(
      `UPDATE contract_auxiliary_packages SET note = $3, updated_by = $4,
         updated_at = $5, version = version + 1
       WHERE id = $1 AND parent_contract_id = $2 AND version = $6`,
      [packageId, parentContractId, note, actor.id, now, expectedVersion],
    );
    if (updated.rowCount !== 1) {
      throw new ContractDomainError(
        409,
        "辅助合同已被其他人修改，请刷新后重试",
        "CONTRACT_AUXILIARY_VERSION_CONFLICT",
      );
    }
    await insertAuxiliaryAudit(client, {
      parentContractId,
      packageId,
      action: "auxiliary_package_note_updated",
      actor,
      changes: { noteChanged: current.rows[0].note !== note },
      now,
    });
  });
  return { packageId, note, version };
}

export async function deleteContractAuxiliaryPackage(
  input: DeleteContractAuxiliaryPackageInput,
): Promise<{
  packageId: string;
  deleted: true;
  storedFilePaths: string[];
}> {
  assertAccountingScopeCannotBeOverridden(input);
  const parentContractId = requiredIdentifier(
    input.parentContractId,
    "关联主合同",
  );
  const packageId = requiredIdentifier(input.packageId, "辅助档案包");
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  const actor = {
    id: requiredIdentifier(input.actor?.id, "操作人"),
    role: requiredIdentifier(input.actor?.role, "操作角色"),
  };
  return db.transaction(async (client) => {
    const current = await client.query<{ version: number }>(
      `SELECT version FROM contract_auxiliary_packages
        WHERE id = $1 AND parent_contract_id = $2 FOR UPDATE`,
      [packageId, parentContractId],
    );
    if (!current.rows[0]) {
      throw new ContractDomainError(
        404,
        "辅助合同档案不存在",
        "CONTRACT_AUXILIARY_PACKAGE_NOT_FOUND",
      );
    }
    if (Number(current.rows[0].version) !== expectedVersion) {
      throw new ContractDomainError(
        409,
        "辅助合同已被其他人修改，请刷新后重试",
        "CONTRACT_AUXILIARY_VERSION_CONFLICT",
      );
    }
    const files = await client.query<{ file_path: string }>(
      `SELECT file_path FROM contract_auxiliary_files
        WHERE package_id = $1 ORDER BY created_at ASC`,
      [packageId],
    );
    const now = new Date().toISOString();
    await insertAuxiliaryAudit(client, {
      parentContractId,
      packageId,
      action: "auxiliary_package_deleted",
      actor,
      changes: { fileCount: files.rows.length, accountingIncluded: false },
      now,
    });
    const deleted = await client.query(
      `DELETE FROM contract_auxiliary_packages
        WHERE id = $1 AND parent_contract_id = $2 AND version = $3`,
      [packageId, parentContractId, expectedVersion],
    );
    if (deleted.rowCount !== 1) {
      throw new ContractDomainError(
        409,
        "辅助合同删除状态已变化，请刷新后重试",
        "CONTRACT_AUXILIARY_VERSION_CONFLICT",
      );
    }
    return {
      packageId,
      deleted: true as const,
      storedFilePaths: files.rows.map((file) => file.file_path),
    };
  });
}

export async function retryContractAuxiliaryPackageRecognition(
  input: RetryContractAuxiliaryPackageInput,
  recognitionRunner: ContractRecognitionRunner = recognizeContractFile,
): Promise<Awaited<ReturnType<typeof runContractAuxiliaryPackageRecognition>>> {
  assertAccountingScopeCannotBeOverridden(input);
  const parentContractId = requiredIdentifier(
    input.parentContractId,
    "关联主合同",
  );
  const packageId = requiredIdentifier(input.packageId, "辅助档案包");
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  const actor = {
    id: requiredIdentifier(input.actor?.id, "操作人"),
    role: requiredIdentifier(input.actor?.role, "操作角色"),
  };
  await db.transaction(async (client) => {
    const current = await client.query<{ status: ContractAuxiliaryStatus }>(
      `SELECT status FROM contract_auxiliary_packages
        WHERE id = $1 AND parent_contract_id = $2 FOR UPDATE`,
      [packageId, parentContractId],
    );
    if (!current.rows[0]) {
      throw new ContractDomainError(
        404,
        "辅助合同档案不存在",
        "CONTRACT_AUXILIARY_PACKAGE_NOT_FOUND",
      );
    }
    if (current.rows[0].status === "processing") {
      throw new ContractDomainError(
        409,
        "辅助合同正在识别，不能重复发起任务",
        "CONTRACT_AUXILIARY_PROCESSING",
      );
    }
    const now = new Date().toISOString();
    const updated = await client.query(
      `UPDATE contract_auxiliary_packages SET
         party_a = NULL, party_b = NULL, recognized_amount = NULL,
         status = 'processing', raw_text = NULL,
         ocr_fields_json = '[]'::jsonb, ocr_lines_json = '[]'::jsonb,
         warnings_json = '[]'::jsonb, error_message = NULL,
         model_version = NULL, parser_version = $3,
         retry_count = retry_count + 1, version = version + 1,
         updated_by = $4, updated_at = $5
       WHERE id = $1 AND parent_contract_id = $2 AND version = $6`,
      [
        packageId,
        parentContractId,
        CONTRACT_AUXILIARY_PARSER_VERSION,
        actor.id,
        now,
        expectedVersion,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new ContractDomainError(
        409,
        "辅助合同已被其他人修改，请刷新后重试",
        "CONTRACT_AUXILIARY_VERSION_CONFLICT",
      );
    }
    await insertAuxiliaryAudit(client, {
      parentContractId,
      packageId,
      action: "auxiliary_package_recognition_retried",
      actor,
      changes: { previousStatus: current.rows[0].status },
      now,
    });
  });
  return runContractAuxiliaryPackageRecognition(
    { parentContractId, packageId, actor },
    recognitionRunner,
  );
}
