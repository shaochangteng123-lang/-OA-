import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { toCents } from "../services/contractAccounting.js";
import { LEGACY_REVIEWED_CNY_RECEIPT_FILE_HASHES } from "../services/monthlyFinancialAnalysisSources.js";

/**
 * 将三张已经逐张复核为人民币的旧版银行回单补齐为人民币币种。
 *
 * 该脚本不扩展推断范围，只接受下方冻结的三组合同、回单、文件和识别任务；
 * 默认执行可回滚预演，正式提交还必须携带预演返回的数据库状态摘要和确认令牌。
 */

export const REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY =
  "reviewed-legacy-receipt-currency-repair-v1";
export const REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION =
  "REPAIR_REVIEWED_LEGACY_RECEIPT_CURRENCY_IN_PRODUCTION";
export const REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_ACTION =
  "reviewed_legacy_receipt_currency_repaired";

const APPLICATION_ROOT = path.resolve("/app");
const ACTOR_ID = "tVvL0xGPggBqH7Hc1qSLZ";
const ACTOR_NAME = "吴静雯";
const ACTOR_ROLE = "admin";
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

export interface FrozenReviewedLegacyReceipt {
  readonly receiptId: string;
  readonly contractId: string;
  readonly contractNo: string;
  readonly projectName: string;
  readonly contractStatus: "completed" | "executing";
  readonly contractArea: "海淀区" | "朝阳区";
  readonly contractDate: string;
  readonly contractAmountCents: number;
  readonly receiptDate: string;
  readonly amountCents: number;
  readonly electronicReceiptNo: string;
  readonly fileId: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly fileSize: number;
  readonly fileSha256: string;
  readonly fileCreatedAt: string;
  readonly ocrJobId: string;
  readonly receiptConfirmedAt: string;
  readonly receiptCreatedAt: string;
  readonly receiptUpdatedAt: string;
}

const reviewedLegacyReceiptRows: FrozenReviewedLegacyReceipt[] = [
  {
    receiptId: "Ewue7Y7OfFgYZsuDi1-PO",
    contractId: "vtJwoAi7IB7TNC3CoDho3",
    contractNo: "HT-20260826-000047",
    projectName: "何各庄220千伏输变电工程前期手续技术咨询服务",
    contractStatus: "executing",
    contractArea: "朝阳区",
    contractDate: "2025-04-30",
    contractAmountCents: 48_450_000,
    receiptDate: "2026-09-08",
    amountCents: 7_600_000,
    electronicReceiptNo: "0920-3487-3565-1100",
    fileId: "wkVtnF-5Wah90UUL_Sdav",
    fileName: "3-回单-20260908￥76000.png",
    filePath:
      "uploads/contracts/2026/09/10/3-回单-20260908_76000-1789026757647-zNeWCEWX.png",
    fileSize: 267_309,
    fileSha256:
      "ae0c6e5862cc3b3b99953c7617bcf5c13bbd9bc143d8e354af3f39041363d9b3",
    fileCreatedAt: "2026-09-10T07:52:37.675Z",
    ocrJobId: "PrKv7bGGmpR3qqmOQ53dv",
    receiptConfirmedAt: "2026-09-10T07:52:53.156Z",
    receiptCreatedAt: "2026-09-10T07:52:53.156Z",
    receiptUpdatedAt: "2026-09-10T07:52:53.177Z",
  },
  {
    receiptId: "-cDeLzsE7VcO3CkV0epPx",
    contractId: "7rxNEY2owwoteQ04qgNPM",
    contractNo: "HT-20260826-000084",
    projectName: "温泉-稻香湖110千伏线路工程建设工程规划许可证、施工许可证",
    contractStatus: "completed",
    contractArea: "海淀区",
    contractDate: "2025-12-10",
    contractAmountCents: 8_000_000,
    receiptDate: "2026-09-10",
    amountCents: 8_000_000,
    electronicReceiptNo: "0920-3777-6739-1100",
    fileId: "nHfH5dl882z5NL0dkyF-l",
    fileName: "3-回单-20260910￥80000.png",
    filePath:
      "uploads/contracts/2026/09/11/3-回单-20260910_80000-1789091279300-S9LmSPCa.png",
    fileSize: 283_790,
    fileSha256:
      "11f5f5edd62391d7b9544e385f0d7d6830fa9e649b821148dc388e95c0b3f32e",
    fileCreatedAt: "2026-09-11T01:47:59.317Z",
    ocrJobId: "PxI8z1xCtTEYBaZFN3BKx",
    receiptConfirmedAt: "2026-09-11T01:48:11.986Z",
    receiptCreatedAt: "2026-09-11T01:48:11.986Z",
    receiptUpdatedAt: "2026-09-11T01:48:12.011Z",
  },
  {
    receiptId: "CQNDqz02zd1tLlYjYkMHF",
    contractId: "OWNZQ2Le1mhdn_PenwTIl",
    contractNo: "HT-20260826-000079",
    projectName:
      "东玉河220千伏变电站110千伏送出工程建设工程规划许可证、施工许可证",
    contractStatus: "completed",
    contractArea: "海淀区",
    contractDate: "2025-12-10",
    contractAmountCents: 8_000_000,
    receiptDate: "2026-09-10",
    amountCents: 8_000_000,
    electronicReceiptNo: "0920-3778-0115-1100",
    fileId: "j3Eru5zbWG6bSylylR1bh",
    fileName: "3-回单-20260910￥80000.png",
    filePath:
      "uploads/contracts/2026/09/11/3-回单-20260910_80000-1789091167512-5cOCzQO6.png",
    fileSize: 282_707,
    fileSha256:
      "fc4683ac497c68e6af972033a3ba22a56556109e4b8a9c0843b1ff1d4d8a0251",
    fileCreatedAt: "2026-09-11T01:46:07.543Z",
    ocrJobId: "aAv_TGwLIv-uHKwkXX-bP",
    receiptConfirmedAt: "2026-09-11T01:46:34.723Z",
    receiptCreatedAt: "2026-09-11T01:46:34.723Z",
    receiptUpdatedAt: "2026-09-11T01:46:34.748Z",
  },
];

export const REVIEWED_LEGACY_RECEIPTS: readonly Readonly<FrozenReviewedLegacyReceipt>[] =
  Object.freeze(
    reviewedLegacyReceiptRows.map((row) => Object.freeze({ ...row })),
  );

export interface ReviewedLegacyReceiptCurrencyRepairArguments {
  mode: "inspect" | "dry-run" | "commit";
  confirmationToken: string | null;
  targetDatabaseSha256: string | null;
}

interface ActorRow {
  id: string;
  username: string;
  name: string;
  role: string;
  status: string;
  snapshot: Record<string, unknown>;
}

interface ReceiptRow {
  id: string;
  contract_id: string;
  file_id: string | null;
  receipt_date: string;
  payment_time: string | null;
  booking_date: string | null;
  amount: string | number;
  payer: string | null;
  payer_account: string | null;
  payee: string | null;
  payee_account: string | null;
  bank_name: string | null;
  currency: string | null;
  electronic_receipt_no: string | null;
  transaction_serial_no: string | null;
  proof_no: string | null;
  note: string | null;
  financial_ocr_job_id: string | null;
  rate_snapshot_json: Record<string, unknown> | null;
  status: string;
  created_by: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  reversed_by: string | null;
  reversed_at: string | null;
  reverse_reason: string | null;
  created_at: string;
  updated_at: string;
  snapshot: Record<string, unknown>;
}

interface FileRow {
  id: string;
  contract_id: string;
  file_type: string;
  file_name: string;
  file_path: string;
  file_size: string | number;
  mime_type: string;
  file_hash: string;
  version: string | number;
  is_current: boolean;
  uploaded_by: string;
  created_at: string;
  snapshot: Record<string, unknown>;
}

interface OcrJobRow {
  id: string;
  contract_id: string;
  file_id: string;
  file_hash: string;
  record_kind: string;
  document_kind: string;
  status: string;
  validation_status: string | null;
  failure_kind: string | null;
  retry_count: string | number;
  worker_token: string | null;
  lease_expires_at: string | null;
  recognition_method: string | null;
  engine_version: string | null;
  parser_version: string | null;
  direction: string | null;
  document_status: string | null;
  can_auto_post: boolean;
  snapshot_json: Record<string, unknown>;
  blocking_reasons_json: unknown[];
  warnings_json: unknown[];
  business_purpose: string | null;
  target_id: string | null;
  requested_by: string;
  record_id: string | null;
  snapshot: Record<string, unknown>;
}

interface ContractRow {
  id: string;
  contract_no: string;
  title: string;
  project_name: string;
  category: string;
  declared_category: string;
  relation_type: string;
  root_contract_id: string;
  is_deleted: boolean;
  status: string;
  area: string;
  party_a: string;
  party_b: string;
  contract_date: string;
  current_effective_amount: string | number;
  financial_direction: string;
  snapshot: Record<string, unknown>;
}

interface FinancialHashRow {
  file_hash: string;
  file_id: string;
  contract_id: string;
  created_at: string;
  snapshot: Record<string, unknown>;
}

interface AuditRow {
  id: string;
  contract_id: string;
  action: string;
  actor_id: string;
  actor_role: string;
  from_status: string | null;
  to_status: string | null;
  changes_json: Record<string, unknown>;
  comment: string | null;
  created_at: string;
  snapshot: Record<string, unknown>;
}

export interface ReviewedLegacyReceiptCurrencyRepairState {
  actor: ActorRow[];
  receipts: ReceiptRow[];
  files: FileRow[];
  jobs: OcrJobRow[];
  contracts: ContractRow[];
  financialHashes: FinancialHashRow[];
  audits: AuditRow[];
}

export interface DatabaseIdentityRow {
  database_name: string;
  database_oid: string | number;
  database_user: string;
  system_identifier: string | number;
}

export interface QueryClient {
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface ReviewedLegacyReceiptCurrencyRepairConnection extends QueryClient {
  release(destroy?: boolean | Error): void;
}

export interface ReviewedLegacyReceiptCurrencyRepairInspection {
  state: ReviewedLegacyReceiptCurrencyRepairState;
  kind: "pending" | "applied";
  currentTargetDatabaseSha256: string;
  appliedFromTargetDatabaseSha256: string | null;
}

export interface ReviewedLegacyReceiptCurrencyRepairDependencies {
  connect(): Promise<ReviewedLegacyReceiptCurrencyRepairConnection>;
  endPool(): Promise<void>;
  now(): string;
  verifyPhysicalFiles(): Promise<void>;
  readIdentity(client: QueryClient): Promise<DatabaseIdentityRow>;
  inspect(
    client: QueryClient,
    identity: DatabaseIdentityRow,
  ): Promise<ReviewedLegacyReceiptCurrencyRepairInspection>;
  apply(
    client: QueryClient,
    input: {
      stateBefore: ReviewedLegacyReceiptCurrencyRepairState;
      targetDatabaseSha256: string;
      now: string;
    },
  ): Promise<{ affectedRows: number; auditRows: number }>;
}

function canonicalize(value: unknown): unknown {
  if (value == null || ["boolean", "number", "string"].includes(typeof value)) {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new Error("数据库状态摘要包含不支持的数据类型");
}

function digest(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function repairAuditId(fileSha256: string): string {
  const suffix = crypto
    .createHash("sha256")
    .update(
      `${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY}\0audit\0${fileSha256}`,
    )
    .digest("base64url")
    .slice(0, 20);
  return `lrc_${suffix}`;
}

export function reviewedLegacyReceiptCurrencyRepairAuditId(
  fileSha256: string,
): string {
  if (!HASH_PATTERN.test(fileSha256)) throw new Error("文件摘要格式不正确");
  return repairAuditId(fileSha256);
}

function frozenHashes(): string[] {
  return REVIEWED_LEGACY_RECEIPTS.map((row) => row.fileSha256);
}

function frozenIds(
  key: "receiptId" | "contractId" | "fileId" | "ocrJobId",
): string[] {
  return REVIEWED_LEGACY_RECEIPTS.map((row) => row[key]);
}

export function parseReviewedLegacyReceiptCurrencyRepairArguments(
  argv: readonly string[],
): ReviewedLegacyReceiptCurrencyRepairArguments {
  let mode: "inspect" | "dry-run" | "commit" = "dry-run";
  let modeSpecified = false;
  const options = new Map<string, string>();
  const names = new Set(["--confirm-target", "--target-database-sha256"]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (
      value === "--print-target-database-sha256" ||
      value === "--dry-run" ||
      value === "--commit"
    ) {
      if (modeSpecified) throw new Error("只能指定一个执行模式");
      modeSpecified = true;
      mode =
        value === "--commit"
          ? "commit"
          : value === "--print-target-database-sha256"
            ? "inspect"
            : "dry-run";
      continue;
    }
    const separator = value.indexOf("=");
    const name = separator >= 0 ? value.slice(0, separator) : value;
    if (!names.has(name)) throw new Error(`不支持的命令行参数：${value}`);
    if (options.has(name)) throw new Error(`命令行参数重复：${name}`);
    const inline = separator >= 0 ? value.slice(separator + 1) : null;
    const optionValue = inline ?? argv[index + 1] ?? "";
    if (!optionValue || (inline == null && optionValue.startsWith("--"))) {
      throw new Error(`命令行参数缺少值：${name}`);
    }
    options.set(name, optionValue);
    if (inline == null) index += 1;
  }
  const confirmationToken = options.get("--confirm-target") || null;
  const targetDatabaseSha256 =
    options.get("--target-database-sha256")?.toLowerCase() || null;
  if (mode !== "commit" && confirmationToken) {
    throw new Error("只读检查或事务预演不得携带正式提交确认令牌");
  }
  if (targetDatabaseSha256 && !HASH_PATTERN.test(targetDatabaseSha256)) {
    throw new Error("生产数据库状态摘要必须是64位十六进制字符");
  }
  if (mode === "commit") {
    if (
      confirmationToken !== REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION
    ) {
      throw new Error(
        `正式提交必须显式指定 --confirm-target=${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION}`,
      );
    }
    if (!targetDatabaseSha256) {
      throw new Error("正式提交必须携带事务预演返回的生产数据库状态摘要");
    }
  }
  return { mode, confirmationToken, targetDatabaseSha256 };
}

export function assertReviewedLegacyReceiptCurrencyRepairAuthorization(
  environment: NodeJS.ProcessEnv = process.env,
  currentWorkingDirectory = process.cwd(),
): void {
  if (path.resolve(currentWorkingDirectory) !== APPLICATION_ROOT) {
    throw new Error("旧回单币种更正只能在生产容器的 /app 工作目录执行");
  }
  if (!environment.DATABASE_URL) {
    throw new Error("生产容器缺少数据库连接配置，拒绝执行");
  }
  if (
    environment.NODE_ENV !== "production" ||
    environment.VITE_ENABLE_WORKLOG === "true"
  ) {
    throw new Error("当前环境不是生产模式，拒绝执行旧回单币种更正");
  }
}

function assertFrozenHashAllowlist(): void {
  if (
    digest([...LEGACY_REVIEWED_CNY_RECEIPT_FILE_HASHES].sort()) !==
    digest(frozenHashes().sort())
  ) {
    throw new Error("财务分析白名单与币种更正冻结摘要不一致");
  }
}

export async function readReviewedLegacyReceiptCurrencyRepairState(
  client: QueryClient,
): Promise<ReviewedLegacyReceiptCurrencyRepairState> {
  const auditIds = REVIEWED_LEGACY_RECEIPTS.map((row) =>
    repairAuditId(row.fileSha256),
  );
  // 同一事务连接必须顺序读取，避免连接客户端并发排队。
  const actor = await client.query<ActorRow>(
    `SELECT id,username,name,role,status,to_jsonb(user_row.*) AS snapshot
       FROM users user_row WHERE id=$1 FOR UPDATE`,
    [ACTOR_ID],
  );
  const receipts = await client.query<ReceiptRow>(
    `SELECT receipt.*,to_jsonb(receipt.*) AS snapshot
       FROM contract_receipts receipt
      WHERE receipt.id=ANY($1::text[])
         OR receipt.file_id=ANY($2::text[])
         OR receipt.financial_ocr_job_id=ANY($3::text[])
      ORDER BY receipt.id FOR UPDATE`,
    [frozenIds("receiptId"), frozenIds("fileId"), frozenIds("ocrJobId")],
  );
  const files = await client.query<FileRow>(
    `SELECT file_row.*,to_jsonb(file_row.*) AS snapshot
       FROM contract_files file_row
      WHERE file_row.id=ANY($1::text[]) OR file_row.file_hash=ANY($2::text[])
      ORDER BY file_row.id FOR UPDATE`,
    [frozenIds("fileId"), frozenHashes()],
  );
  const jobs = await client.query<OcrJobRow>(
    `SELECT job.*,to_jsonb(job.*) AS snapshot
       FROM contract_financial_ocr_jobs job
      WHERE job.id=ANY($1::text[]) OR job.file_id=ANY($2::text[])
         OR job.file_hash=ANY($3::text[]) OR job.record_id=ANY($4::text[])
      ORDER BY job.id FOR UPDATE`,
    [
      frozenIds("ocrJobId"),
      frozenIds("fileId"),
      frozenHashes(),
      frozenIds("receiptId"),
    ],
  );
  const contracts = await client.query<ContractRow>(
    `SELECT contract.*,to_jsonb(contract.*) AS snapshot
       FROM contracts contract WHERE contract.id=ANY($1::text[])
       ORDER BY contract.id FOR UPDATE`,
    [frozenIds("contractId")],
  );
  const financialHashes = await client.query<FinancialHashRow>(
    `SELECT hash_row.*,to_jsonb(hash_row.*) AS snapshot
       FROM contract_financial_file_hashes hash_row
      WHERE hash_row.file_hash=ANY($1::text[])
         OR hash_row.file_id=ANY($2::text[])
      ORDER BY hash_row.file_hash FOR UPDATE`,
    [frozenHashes(), frozenIds("fileId")],
  );
  const audits = await client.query<AuditRow>(
    `SELECT audit.*,to_jsonb(audit.*) AS snapshot
       FROM contract_audit_logs audit
      WHERE audit.id=ANY($1::text[])
         OR (audit.action=$2 AND audit.changes_json->>'repairKey'=$3)
      ORDER BY audit.id FOR UPDATE`,
    [
      auditIds,
      REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_ACTION,
      REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY,
    ],
  );
  return {
    actor: actor.rows,
    receipts: receipts.rows,
    files: files.rows,
    jobs: jobs.rows,
    contracts: contracts.rows,
    financialHashes: financialHashes.rows,
    audits: audits.rows,
  };
}

function assertExactIds(
  rows: readonly { id: string }[],
  expected: readonly string[],
  label: string,
): void {
  if (
    rows.length !== expected.length ||
    digest(rows.map((row) => row.id).sort()) !== digest([...expected].sort())
  ) {
    throw new Error(`${label}数量或身份不等于冻结的3条记录`);
  }
}

function assertActor(rows: readonly ActorRow[]): ActorRow {
  const actor = rows[0];
  if (
    rows.length !== 1 ||
    !actor ||
    actor.id !== ACTOR_ID ||
    actor.username !== ACTOR_NAME ||
    actor.name !== ACTOR_NAME ||
    actor.role !== ACTOR_ROLE ||
    actor.status !== "active"
  ) {
    throw new Error("审计管理员身份与冻结基线不一致");
  }
  return actor;
}

function assertReceiptIdentity(
  row: ReceiptRow | undefined,
  frozen: FrozenReviewedLegacyReceipt,
  expectedCurrency: null | "CNY",
): void {
  const expectedRates = {
    tax: 0.1172,
    marketing: 0.05,
    business: 0.1,
    financial: 0.0028,
  };
  if (
    !row ||
    row.id !== frozen.receiptId ||
    row.contract_id !== frozen.contractId ||
    row.file_id !== frozen.fileId ||
    row.receipt_date !== frozen.receiptDate ||
    row.payment_time !== frozen.receiptDate ||
    row.booking_date !== null ||
    toCents(row.amount) !== frozen.amountCents ||
    row.payer !== "国网北京市电力公司" ||
    row.payer_account !== "212300490" ||
    row.payee !== "北京羽隶工程咨询有限公司" ||
    row.payee_account !== "0200303519000018418" ||
    row.bank_name !== null ||
    row.currency !== expectedCurrency ||
    row.electronic_receipt_no !== frozen.electronicReceiptNo ||
    row.transaction_serial_no !== null ||
    row.proof_no !== null ||
    row.note !== null ||
    row.financial_ocr_job_id !== frozen.ocrJobId ||
    digest(row.rate_snapshot_json) !== digest(expectedRates) ||
    row.status !== "confirmed" ||
    row.created_by !== ACTOR_ID ||
    row.confirmed_by !== ACTOR_ID ||
    row.confirmed_at !== frozen.receiptConfirmedAt ||
    row.reversed_by !== null ||
    row.reversed_at !== null ||
    row.reverse_reason !== null ||
    row.created_at !== frozen.receiptCreatedAt
  ) {
    throw new Error(`回单身份或财务字段与冻结基线不一致：${frozen.receiptId}`);
  }
  if (expectedCurrency === null && row.updated_at !== frozen.receiptUpdatedAt) {
    throw new Error(`待更正回单更新时间与冻结基线不一致：${frozen.receiptId}`);
  }
}

function assertFileIdentity(
  row: FileRow | undefined,
  frozen: FrozenReviewedLegacyReceipt,
): void {
  if (
    !row ||
    row.id !== frozen.fileId ||
    row.contract_id !== frozen.contractId ||
    row.file_type !== "receipt" ||
    row.file_name !== frozen.fileName ||
    row.file_path !== frozen.filePath ||
    Number(row.file_size) !== frozen.fileSize ||
    row.mime_type !== "image/png" ||
    row.file_hash !== frozen.fileSha256 ||
    Number(row.version) !== 1 ||
    row.is_current !== true ||
    row.uploaded_by !== ACTOR_ID ||
    row.created_at !== frozen.fileCreatedAt
  ) {
    throw new Error(`原始回单文件与冻结基线不一致：${frozen.fileSha256}`);
  }
}

function assertOcrJobIdentity(
  row: OcrJobRow | undefined,
  frozen: FrozenReviewedLegacyReceipt,
): void {
  const expectedSnapshot = {
    fields: {
      payee: "北京羽隶工程咨询有限公司",
      payer: "国网北京市电力公司",
      amount: frozen.amountCents / 100,
      paymentTime: frozen.receiptDate,
      payeeAccount: "0200303519000018418",
      payerAccount: "212300490",
      electronicReceiptNo: frozen.electronicReceiptNo,
    },
    format: "png",
  };
  if (
    !row ||
    row.id !== frozen.ocrJobId ||
    row.contract_id !== frozen.contractId ||
    row.file_id !== frozen.fileId ||
    row.file_hash !== frozen.fileSha256 ||
    row.record_kind !== "receipt" ||
    row.document_kind !== "bank_receipt" ||
    row.status !== "consumed" ||
    row.validation_status !== "verified" ||
    row.failure_kind !== null ||
    Number(row.retry_count) !== 0 ||
    row.worker_token !== null ||
    row.lease_expires_at !== null ||
    row.recognition_method !== "paddle_ocr" ||
    row.engine_version !== "v6_medium" ||
    row.parser_version !== "contract-bank-receipt-parser-v11" ||
    row.direction !== "receipt" ||
    row.document_status !== "normal" ||
    row.can_auto_post !== true ||
    digest(row.snapshot_json) !== digest(expectedSnapshot) ||
    !Array.isArray(row.blocking_reasons_json) ||
    row.blocking_reasons_json.length !== 0 ||
    !Array.isArray(row.warnings_json) ||
    row.warnings_json.length !== 0 ||
    row.business_purpose !== null ||
    row.target_id !== null ||
    row.requested_by !== ACTOR_ID ||
    row.record_id !== frozen.receiptId
  ) {
    throw new Error(`识别任务与冻结回单链路不一致：${frozen.ocrJobId}`);
  }
}

function assertContractIdentity(
  row: ContractRow | undefined,
  frozen: FrozenReviewedLegacyReceipt,
): void {
  if (
    !row ||
    row.id !== frozen.contractId ||
    row.contract_no !== frozen.contractNo ||
    row.title !== frozen.projectName ||
    row.project_name !== frozen.projectName ||
    row.category !== "main_business" ||
    row.declared_category !== "main_business" ||
    row.relation_type !== "main" ||
    row.root_contract_id !== frozen.contractId ||
    row.is_deleted !== false ||
    row.status !== frozen.contractStatus ||
    row.area !== frozen.contractArea ||
    row.party_a !== "国网北京市电力公司" ||
    row.party_b !== "北京羽隶工程咨询有限公司" ||
    row.contract_date !== frozen.contractDate ||
    toCents(row.current_effective_amount) !== frozen.contractAmountCents ||
    row.financial_direction !== "income"
  ) {
    throw new Error(`所属主合同与冻结基线不一致：${frozen.contractId}`);
  }
}

function assertFinancialHashIdentity(
  row: FinancialHashRow | undefined,
  frozen: FrozenReviewedLegacyReceipt,
): void {
  if (
    !row ||
    row.file_hash !== frozen.fileSha256 ||
    row.file_id !== frozen.fileId ||
    row.contract_id !== frozen.contractId ||
    !row.created_at
  ) {
    throw new Error(`财务文件摘要链路不一致：${frozen.fileSha256}`);
  }
}

function assertAuditIdentity(
  row: AuditRow | undefined,
  frozen: FrozenReviewedLegacyReceipt,
): void {
  const changes = row?.changes_json || {};
  const before = changes.receiptBefore;
  if (
    !row ||
    row.id !== repairAuditId(frozen.fileSha256) ||
    row.contract_id !== frozen.contractId ||
    row.action !== REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_ACTION ||
    row.actor_id !== ACTOR_ID ||
    row.actor_role !== ACTOR_ROLE ||
    row.from_status !== frozen.contractStatus ||
    row.to_status !== frozen.contractStatus ||
    row.comment !== "补齐已逐张核验的旧版人民币银行回单币种" ||
    !row.created_at ||
    changes.repairKey !== REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY ||
    changes.receiptId !== frozen.receiptId ||
    changes.contractId !== frozen.contractId ||
    changes.fileId !== frozen.fileId ||
    changes.ocrJobId !== frozen.ocrJobId ||
    changes.fileSha256 !== frozen.fileSha256 ||
    changes.filePath !== frozen.filePath ||
    Number(changes.fileBytes) !== frozen.fileSize ||
    changes.electronicReceiptNo !== frozen.electronicReceiptNo ||
    Number(changes.amountCents) !== frozen.amountCents ||
    changes.receiptDate !== frozen.receiptDate ||
    changes.currencyBefore !== null ||
    changes.currencyAfter !== "CNY" ||
    changes.physicalFileVerified !== true ||
    typeof changes.targetDatabaseSha256 !== "string" ||
    !HASH_PATTERN.test(changes.targetDatabaseSha256) ||
    !before ||
    typeof before !== "object" ||
    Array.isArray(before) ||
    (before as Record<string, unknown>).id !== frozen.receiptId ||
    (before as Record<string, unknown>).currency !== null ||
    (before as Record<string, unknown>).file_id !== frozen.fileId ||
    (before as Record<string, unknown>).financial_ocr_job_id !== frozen.ocrJobId
  ) {
    throw new Error(`币种更正审计不完整：${frozen.receiptId}`);
  }
}

function assertFrozenChains(
  state: ReviewedLegacyReceiptCurrencyRepairState,
): void {
  assertFrozenHashAllowlist();
  assertActor(state.actor);
  assertExactIds(state.receipts, frozenIds("receiptId"), "回单记录");
  assertExactIds(state.files, frozenIds("fileId"), "原始回单文件");
  assertExactIds(state.jobs, frozenIds("ocrJobId"), "回单识别任务");
  assertExactIds(state.contracts, frozenIds("contractId"), "所属主合同");
  if (
    state.financialHashes.length !== REVIEWED_LEGACY_RECEIPTS.length ||
    digest(state.financialHashes.map((row) => row.file_hash).sort()) !==
      digest(frozenHashes().sort())
  ) {
    throw new Error("财务文件摘要数量或身份不等于冻结的3条记录");
  }
  for (const frozen of REVIEWED_LEGACY_RECEIPTS) {
    assertFileIdentity(
      state.files.find((row) => row.id === frozen.fileId),
      frozen,
    );
    assertOcrJobIdentity(
      state.jobs.find((row) => row.id === frozen.ocrJobId),
      frozen,
    );
    assertContractIdentity(
      state.contracts.find((row) => row.id === frozen.contractId),
      frozen,
    );
    assertFinancialHashIdentity(
      state.financialHashes.find((row) => row.file_hash === frozen.fileSha256),
      frozen,
    );
  }
}

export function classifyReviewedLegacyReceiptCurrencyRepairState(
  state: ReviewedLegacyReceiptCurrencyRepairState,
): "pending" | "applied" {
  assertFrozenChains(state);
  const pending = state.receipts.every((row) => row.currency === null);
  const applied = state.receipts.every((row) => row.currency === "CNY");
  if (pending && state.audits.length === 0) {
    for (const frozen of REVIEWED_LEGACY_RECEIPTS) {
      assertReceiptIdentity(
        state.receipts.find((row) => row.id === frozen.receiptId),
        frozen,
        null,
      );
    }
    return "pending";
  }
  if (applied && state.audits.length === REVIEWED_LEGACY_RECEIPTS.length) {
    const auditTargetDatabaseSha256 = new Set(
      state.audits.map((row) =>
        String(row.changes_json.targetDatabaseSha256 || ""),
      ),
    );
    if (auditTargetDatabaseSha256.size !== 1) {
      throw new Error("三条币种更正审计绑定的预演数据库摘要不一致");
    }
    for (const frozen of REVIEWED_LEGACY_RECEIPTS) {
      const receipt = state.receipts.find((row) => row.id === frozen.receiptId);
      assertReceiptIdentity(receipt, frozen, "CNY");
      assertAuditIdentity(
        state.audits.find((row) => row.id === repairAuditId(frozen.fileSha256)),
        frozen,
      );
      if (
        receipt?.updated_at !==
        state.audits.find((row) => row.id === repairAuditId(frozen.fileSha256))
          ?.created_at
      ) {
        throw new Error(
          `回单更新时间与更正审计时间不一致：${frozen.receiptId}`,
        );
      }
    }
    return "applied";
  }
  throw new Error("三笔旧回单处于部分更正或异常审计状态，拒绝继续");
}

function safeAbsoluteFilePath(
  storedPath: string,
  applicationRoot: string,
): string {
  const normalized = String(storedPath || "").trim();
  if (
    !normalized.startsWith("uploads/") ||
    normalized.includes("\\") ||
    path.isAbsolute(normalized) ||
    normalized.split("/").some((part) => !part || part === "..")
  ) {
    throw new Error(`原始回单保存路径不安全：${storedPath}`);
  }
  const uploadRoot = path.resolve(applicationRoot, "uploads");
  const absolutePath = path.resolve(applicationRoot, normalized);
  const relative = path.relative(uploadRoot, absolutePath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`原始回单路径越过上传目录：${storedPath}`);
  }
  return absolutePath;
}

async function assertNoSymlinkComponents(
  uploadRoot: string,
  filePath: string,
): Promise<fs.BigIntStats> {
  let current = path.resolve(uploadRoot);
  const rootStat = await fs.promises
    .lstat(current, { bigint: true })
    .catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("上传目录不存在或为符号链接");
  }
  const relative = path.relative(current, filePath);
  let finalStat: fs.BigIntStats | null = null;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await fs.promises
      .lstat(current, { bigint: true })
      .catch(() => null);
    if (stat?.isSymbolicLink()) {
      throw new Error(`原始回单路径包含符号链接：${current}`);
    }
    if (!stat) throw new Error(`无法打开原始回单：${filePath}`);
    finalStat = stat;
  }
  if (!finalStat) throw new Error(`无法打开原始回单：${filePath}`);
  return finalStat;
}

type FrozenPhysicalFile = Pick<
  FrozenReviewedLegacyReceipt,
  "filePath" | "fileSize" | "fileSha256"
>;

function sameOpenedFile(
  before: fs.BigIntStats,
  after: fs.BigIntStats,
): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

/**
 * 使用禁止跟随符号链接的同一文件句柄完成状态读取和摘要计算，避免路径检查
 * 与文件读取之间被替换成另一份文件。
 */
export async function verifyReviewedLegacyReceiptPhysicalFile(
  frozen: FrozenPhysicalFile,
  applicationRoot = APPLICATION_ROOT,
): Promise<void> {
  const uploadRoot = path.resolve(applicationRoot, "uploads");
  const absolutePath = safeAbsoluteFilePath(frozen.filePath, applicationRoot);
  const pathStat = await assertNoSymlinkComponents(uploadRoot, absolutePath);
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(
      absolutePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    const code = String((error as NodeJS.ErrnoException).code || "");
    if (code === "ELOOP") {
      throw new Error(`原始回单不能是符号链接：${frozen.filePath}`);
    }
    throw new Error(`无法打开原始回单：${frozen.filePath}`);
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.dev !== pathStat.dev ||
      before.ino !== pathStat.ino
    ) {
      throw new Error(`原始回单不是普通文件：${frozen.filePath}`);
    }
    if (before.size !== BigInt(frozen.fileSize)) {
      throw new Error(`原始回单大小不一致：${frozen.filePath}`);
    }
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        position,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!sameOpenedFile(before, after)) {
      throw new Error(`摘要计算期间原始回单发生变化：${frozen.filePath}`);
    }
    if (hash.digest("hex") !== frozen.fileSha256) {
      throw new Error(`原始回单文件摘要不一致：${frozen.filePath}`);
    }
  } finally {
    await handle.close();
  }
}

export async function verifyReviewedLegacyReceiptPhysicalFiles(
  applicationRoot = APPLICATION_ROOT,
): Promise<void> {
  for (const frozen of REVIEWED_LEGACY_RECEIPTS) {
    await verifyReviewedLegacyReceiptPhysicalFile(frozen, applicationRoot);
  }
}

function stableActorProjection(row: ActorRow): Record<string, unknown> {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    status: row.status,
  };
}

function stableReceiptProjection(row: ReceiptRow): Record<string, unknown> {
  return {
    id: row.id,
    contractId: row.contract_id,
    fileId: row.file_id,
    receiptDate: row.receipt_date,
    paymentTime: row.payment_time,
    bookingDate: row.booking_date,
    amountCents: toCents(row.amount),
    payer: row.payer,
    payerAccount: row.payer_account,
    payee: row.payee,
    payeeAccount: row.payee_account,
    bankName: row.bank_name,
    currency: row.currency,
    electronicReceiptNo: row.electronic_receipt_no,
    transactionSerialNo: row.transaction_serial_no,
    proofNo: row.proof_no,
    note: row.note,
    financialOcrJobId: row.financial_ocr_job_id,
    rateSnapshot: row.rate_snapshot_json,
    status: row.status,
    createdBy: row.created_by,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    reversedBy: row.reversed_by,
    reversedAt: row.reversed_at,
    reverseReason: row.reverse_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stableFileProjection(row: FileRow): Record<string, unknown> {
  return {
    id: row.id,
    contractId: row.contract_id,
    fileType: row.file_type,
    fileName: row.file_name,
    filePath: row.file_path,
    fileSize: Number(row.file_size),
    mimeType: row.mime_type,
    fileSha256: row.file_hash,
    version: Number(row.version),
    isCurrent: row.is_current,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function stableOcrJobProjection(row: OcrJobRow): Record<string, unknown> {
  return {
    id: row.id,
    contractId: row.contract_id,
    fileId: row.file_id,
    fileSha256: row.file_hash,
    recordKind: row.record_kind,
    documentKind: row.document_kind,
    status: row.status,
    validationStatus: row.validation_status,
    failureKind: row.failure_kind,
    retryCount: Number(row.retry_count),
    workerToken: row.worker_token,
    leaseExpiresAt: row.lease_expires_at,
    recognitionMethod: row.recognition_method,
    engineVersion: row.engine_version,
    parserVersion: row.parser_version,
    direction: row.direction,
    documentStatus: row.document_status,
    canAutoPost: row.can_auto_post,
    recognitionSnapshot: row.snapshot_json,
    blockingReasons: row.blocking_reasons_json,
    warnings: row.warnings_json,
    businessPurpose: row.business_purpose,
    targetId: row.target_id,
    requestedBy: row.requested_by,
    recordId: row.record_id,
  };
}

function stableContractProjection(row: ContractRow): Record<string, unknown> {
  return {
    id: row.id,
    contractNo: row.contract_no,
    title: row.title,
    projectName: row.project_name,
    category: row.category,
    declaredCategory: row.declared_category,
    relationType: row.relation_type,
    rootContractId: row.root_contract_id,
    isDeleted: row.is_deleted,
    status: row.status,
    area: row.area,
    partyA: row.party_a,
    partyB: row.party_b,
    contractDate: row.contract_date,
    currentEffectiveAmountCents: toCents(row.current_effective_amount),
    financialDirection: row.financial_direction,
  };
}

function stableFinancialHashProjection(
  row: FinancialHashRow,
): Record<string, unknown> {
  return {
    fileSha256: row.file_hash,
    fileId: row.file_id,
    contractId: row.contract_id,
    createdAt: row.created_at,
  };
}

function stableAuditProjection(row: AuditRow): Record<string, unknown> {
  return {
    id: row.id,
    contractId: row.contract_id,
    action: row.action,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    repairKey: row.changes_json.repairKey,
    receiptId: row.changes_json.receiptId,
    fileSha256: row.changes_json.fileSha256,
    currencyBefore: row.changes_json.currencyBefore,
    currencyAfter: row.changes_json.currencyAfter,
    targetDatabaseSha256: row.changes_json.targetDatabaseSha256,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export function buildReviewedLegacyReceiptTargetDatabaseSha256(
  identity: DatabaseIdentityRow,
  state: ReviewedLegacyReceiptCurrencyRepairState,
): string {
  return digest({
    repairKey: REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY,
    identity: {
      databaseName: identity.database_name,
      databaseOid: String(identity.database_oid),
      databaseUser: identity.database_user,
      systemIdentifier: String(identity.system_identifier),
    },
    actor: state.actor
      .map(stableActorProjection)
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    receipts: state.receipts
      .map(stableReceiptProjection)
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    files: state.files
      .map(stableFileProjection)
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    jobs: state.jobs
      .map(stableOcrJobProjection)
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    contracts: state.contracts
      .map(stableContractProjection)
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    financialHashes: state.financialHashes
      .map(stableFinancialHashProjection)
      .sort((left, right) =>
        String(left.fileSha256).localeCompare(String(right.fileSha256)),
      ),
    audits: state.audits
      .map(stableAuditProjection)
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  });
}

/**
 * 从三条审计保存的更正前完整回单快照重建待更正状态，再计算数据库摘要。
 * 这样幂等检查不仅确认三条审计写过，还能确认它们确实来自同一次冻结预演。
 */
export function assertReviewedLegacyReceiptAppliedTargetDatabaseSha256(
  identity: DatabaseIdentityRow,
  state: ReviewedLegacyReceiptCurrencyRepairState,
): string {
  if (classifyReviewedLegacyReceiptCurrencyRepairState(state) !== "applied") {
    throw new Error("只有完整更正态才能重建事务预演数据库摘要");
  }
  const auditSha256 = new Set(
    state.audits.map((row) =>
      String(row.changes_json.targetDatabaseSha256 || ""),
    ),
  );
  if (auditSha256.size !== 1) {
    throw new Error("三条币种更正审计绑定的预演数据库摘要不一致");
  }
  const expected = [...auditSha256][0]!;
  if (!HASH_PATTERN.test(expected)) {
    throw new Error("币种更正审计中的预演数据库摘要格式不正确");
  }
  const receipts = state.receipts.map((row) => {
    const frozen = REVIEWED_LEGACY_RECEIPTS.find(
      (item) => item.receiptId === row.id,
    );
    const audit = frozen
      ? state.audits.find(
          (item) => item.id === repairAuditId(frozen.fileSha256),
        )
      : undefined;
    const before = audit?.changes_json.receiptBefore;
    if (!before || typeof before !== "object" || Array.isArray(before)) {
      throw new Error(`币种更正审计缺少更正前回单快照：${row.id}`);
    }
    return {
      ...row,
      ...(before as Record<string, unknown>),
      snapshot: before as Record<string, unknown>,
    } as ReceiptRow;
  });
  const actual = buildReviewedLegacyReceiptTargetDatabaseSha256(identity, {
    ...state,
    receipts,
    audits: [],
  });
  if (actual !== expected) {
    throw new Error("更正审计无法重建事务预演数据库摘要");
  }
  return actual;
}

export async function readReviewedLegacyReceiptDatabaseIdentity(
  client: QueryClient,
): Promise<DatabaseIdentityRow> {
  const result = await client.query<DatabaseIdentityRow>(
    `SELECT current_database() AS database_name,
            (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
            current_user AS database_user,
            system_identifier::text AS system_identifier
       FROM pg_control_system()`,
  );
  const identity = result.rows[0];
  if (
    result.rows.length !== 1 ||
    !identity ||
    identity.database_name !== "yulilog_worklog" ||
    identity.database_user !== "postgres" ||
    !/^\d+$/u.test(String(identity.database_oid)) ||
    !/^\d+$/u.test(String(identity.system_identifier))
  ) {
    throw new Error("生产数据库系统身份不符合预期");
  }
  return identity;
}

export async function inspectReviewedLegacyReceiptCurrencyRepairState(
  client: QueryClient,
  identity: DatabaseIdentityRow,
): Promise<ReviewedLegacyReceiptCurrencyRepairInspection> {
  const state = await readReviewedLegacyReceiptCurrencyRepairState(client);
  const kind = classifyReviewedLegacyReceiptCurrencyRepairState(state);
  return {
    state,
    kind,
    currentTargetDatabaseSha256: buildReviewedLegacyReceiptTargetDatabaseSha256(
      identity,
      state,
    ),
    appliedFromTargetDatabaseSha256:
      kind === "applied"
        ? assertReviewedLegacyReceiptAppliedTargetDatabaseSha256(
            identity,
            state,
          )
        : null,
  };
}

function assertExpectedTargetDatabaseSha256(
  expected: string | null,
  actual: string,
): void {
  if (expected && expected !== actual) {
    throw new Error("生产数据库状态已变化，与事务预演摘要不一致");
  }
}

function buildAuditChanges(
  frozen: FrozenReviewedLegacyReceipt,
  receiptBefore: ReceiptRow,
  targetDatabaseSha256: string,
): Record<string, unknown> {
  return {
    repairKey: REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY,
    receiptId: frozen.receiptId,
    contractId: frozen.contractId,
    fileId: frozen.fileId,
    ocrJobId: frozen.ocrJobId,
    fileSha256: frozen.fileSha256,
    filePath: frozen.filePath,
    fileBytes: frozen.fileSize,
    electronicReceiptNo: frozen.electronicReceiptNo,
    amountCents: frozen.amountCents,
    receiptDate: frozen.receiptDate,
    currencyBefore: null,
    currencyAfter: "CNY",
    targetDatabaseSha256,
    physicalFileVerified: true,
    verificationScope: {
      reviewedFileCount: REVIEWED_LEGACY_RECEIPTS.length,
      exactFileDigestAllowlist: frozenHashes(),
      contractReceiptFileOcrAndHashLinkVerified: true,
      originalImageCurrencyReviewedAsRenminbi: true,
    },
    receiptBefore: receiptBefore.snapshot,
  };
}

export async function applyReviewedLegacyReceiptCurrencyRepair(
  client: QueryClient,
  input: {
    stateBefore: ReviewedLegacyReceiptCurrencyRepairState;
    targetDatabaseSha256: string;
    now: string;
  },
): Promise<{ affectedRows: number; auditRows: number }> {
  const updated = await client.query<{ id: string }>(
    `UPDATE contract_receipts receipt
        SET currency='CNY',updated_at=$1
      WHERE receipt.id=ANY($2::text[])
        AND receipt.contract_id=ANY($6::text[])
        AND receipt.currency IS NULL
        AND receipt.status='confirmed'
        AND EXISTS (
          SELECT 1
            FROM contract_files file_row
            JOIN contract_financial_ocr_jobs job
              ON job.file_id=file_row.id AND job.file_hash=file_row.file_hash
           WHERE file_row.id=receipt.file_id
             AND file_row.id=ANY($4::text[])
             AND file_row.contract_id=receipt.contract_id
             AND file_row.file_hash=ANY($3::text[])
             AND job.id=receipt.financial_ocr_job_id
             AND job.id=ANY($5::text[])
             AND job.contract_id=receipt.contract_id
             AND job.record_id=receipt.id
             AND job.status='consumed'
             AND job.validation_status='verified'
             AND job.document_status='normal'
             AND job.record_kind='receipt'
             AND job.document_kind='bank_receipt'
             AND job.direction='receipt'
             AND job.can_auto_post=TRUE
             AND jsonb_array_length(job.blocking_reasons_json)=0
             AND jsonb_array_length(job.warnings_json)=0
             AND job.recognition_method='paddle_ocr'
             AND job.engine_version='v6_medium'
             AND job.parser_version='contract-bank-receipt-parser-v11'
        )
      RETURNING receipt.id`,
    [
      input.now,
      frozenIds("receiptId"),
      frozenHashes(),
      frozenIds("fileId"),
      frozenIds("ocrJobId"),
      frozenIds("contractId"),
    ],
  );
  if (
    updated.rowCount !== REVIEWED_LEGACY_RECEIPTS.length ||
    digest(updated.rows.map((row) => row.id).sort()) !==
      digest(frozenIds("receiptId").sort())
  ) {
    throw new Error("旧回单币种更新影响行数不是精确的3条，必须回滚");
  }

  let auditRows = 0;
  for (const frozen of REVIEWED_LEGACY_RECEIPTS) {
    const receiptBefore = input.stateBefore.receipts.find(
      (row) => row.id === frozen.receiptId,
    );
    if (!receiptBefore)
      throw new Error(`缺少更正前回单快照：${frozen.receiptId}`);
    const inserted = await client.query(
      `INSERT INTO contract_audit_logs(
         id,contract_id,action,actor_id,actor_role,from_status,to_status,
         changes_json,comment,created_at
       ) VALUES($1,$2,$3,$4,$5,$6,$6,$7::jsonb,$8,$9)`,
      [
        repairAuditId(frozen.fileSha256),
        frozen.contractId,
        REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_ACTION,
        ACTOR_ID,
        ACTOR_ROLE,
        frozen.contractStatus,
        JSON.stringify(
          buildAuditChanges(frozen, receiptBefore, input.targetDatabaseSha256),
        ),
        "补齐已逐张核验的旧版人民币银行回单币种",
        input.now,
      ],
    );
    if (inserted.rowCount !== 1) {
      throw new Error(`币种更正审计写入失败：${frozen.receiptId}`);
    }
    auditRows += 1;
  }
  if (auditRows !== REVIEWED_LEGACY_RECEIPTS.length) {
    throw new Error("币种更正审计影响行数不是精确的3条，必须回滚");
  }
  return { affectedRows: updated.rowCount, auditRows };
}

async function lockRepairScope(client: QueryClient): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `production-correction:${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY}`,
  ]);
  await client.query(
    `LOCK TABLE users,contracts,contract_files,contract_financial_file_hashes,
       contract_financial_ocr_jobs,contract_receipts,contract_audit_logs
       IN SHARE ROW EXCLUSIVE MODE`,
  );
}

async function productionRepairDependencies(): Promise<ReviewedLegacyReceiptCurrencyRepairDependencies> {
  const { pool } = await import("../db/index.js");
  return {
    connect: async () =>
      (await pool.connect()) as ReviewedLegacyReceiptCurrencyRepairConnection,
    endPool: async () => pool.end(),
    now: () => new Date().toISOString(),
    verifyPhysicalFiles: () => verifyReviewedLegacyReceiptPhysicalFiles(),
    readIdentity: readReviewedLegacyReceiptDatabaseIdentity,
    inspect: inspectReviewedLegacyReceiptCurrencyRepairState,
    apply: applyReviewedLegacyReceiptCurrencyRepair,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runReviewedLegacyReceiptCurrencyRepair(
  args: ReviewedLegacyReceiptCurrencyRepairArguments,
  injectedDependencies?: ReviewedLegacyReceiptCurrencyRepairDependencies,
): Promise<Record<string, unknown>> {
  const dependencies =
    injectedDependencies || (await productionRepairDependencies());
  const client = await dependencies.connect();
  let transactionOpen = false;
  let commitSucceeded = false;
  let commitOutcomeUncertain = false;
  let destroyConnection = false;
  let result: Record<string, unknown> | null = null;
  let failure: unknown = null;

  const rollback = async (context: string): Promise<void> => {
    try {
      await client.query("ROLLBACK");
      transactionOpen = false;
    } catch (rollbackError) {
      transactionOpen = false;
      destroyConnection = true;
      throw new Error(
        `${context}；事务回滚失败，连接已标记销毁：${errorMessage(rollbackError)}`,
      );
    }
  };

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '8s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query(
      "SET LOCAL idle_in_transaction_session_timeout = '120s'",
    );
    await lockRepairScope(client);
    const identity = await dependencies.readIdentity(client);
    const initial = await dependencies.inspect(client, identity);
    const targetDatabaseSha256 = initial.currentTargetDatabaseSha256;
    assertExpectedTargetDatabaseSha256(
      args.targetDatabaseSha256,
      targetDatabaseSha256,
    );
    await dependencies.verifyPhysicalFiles();

    if (initial.kind === "applied") {
      if (!initial.appliedFromTargetDatabaseSha256) {
        throw new Error("完整更正态缺少可重建的事务预演数据库摘要");
      }
      await rollback("幂等只读核验结束");
      result = {
        repairKey: REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY,
        target: "production",
        targetDatabaseSha256,
        appliedFromTargetDatabaseSha256:
          initial.appliedFromTargetDatabaseSha256,
        skipped: true,
        reason: "目标库已经处于完整更正态",
        affectedRows: 0,
      };
    } else if (args.mode === "inspect") {
      await rollback("生产目标只读检查结束");
      result = {
        repairKey: REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY,
        target: "production",
        targetDatabaseSha256,
        inspectionOnly: true,
        pendingReceiptCount: REVIEWED_LEGACY_RECEIPTS.length,
        physicalFilesVerified: true,
      };
    } else {
      const counts = await dependencies.apply(client, {
        stateBefore: initial.state,
        targetDatabaseSha256,
        now: dependencies.now(),
      });
      if (
        counts.affectedRows !== REVIEWED_LEGACY_RECEIPTS.length ||
        counts.auditRows !== REVIEWED_LEGACY_RECEIPTS.length
      ) {
        throw new Error("更正编排收到的更新或审计数量不是精确的3条");
      }
      const final = await dependencies.inspect(client, identity);
      if (
        final.kind !== "applied" ||
        final.appliedFromTargetDatabaseSha256 !== targetDatabaseSha256
      ) {
        throw new Error("更正后全链路或原预演摘要复核未通过，必须回滚");
      }
      await dependencies.verifyPhysicalFiles();

      const commonResult = {
        repairKey: REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY,
        target: "production",
        targetDatabaseSha256,
        reviewedFileSha256: frozenHashes(),
        affectedRows: counts.affectedRows,
        auditRows: counts.auditRows,
        currency: "CNY",
        physicalFilesPreserved: true,
      };
      if (args.mode === "dry-run") {
        await rollback("事务预演结束");
        result = { ...commonResult, dryRunRolledBack: true };
      } else {
        try {
          await client.query("COMMIT");
          transactionOpen = false;
          commitSucceeded = true;
        } catch (commitError) {
          const code = String(
            (commitError as Error & { code?: unknown }).code || "",
          );
          if (!["40001", "40P01"].includes(code)) {
            commitOutcomeUncertain = true;
            transactionOpen = false;
            destroyConnection = true;
          }
          throw commitError;
        }
        result = { ...commonResult, dryRunRolledBack: false };
      }
    }
  } catch (error) {
    failure = error;
    if (transactionOpen && !commitOutcomeUncertain) {
      try {
        await rollback(errorMessage(error));
      } catch (rollbackFailure) {
        failure = rollbackFailure;
      }
    }
    if (commitOutcomeUncertain) {
      failure = new Error(
        `${errorMessage(error)}；提交结果无法确认，连接已销毁，禁止重试，必须先只读核验3条回单币种及3条更正审计`,
      );
    }
  }

  const cleanupFailures: string[] = [];
  try {
    client.release(destroyConnection || commitOutcomeUncertain);
  } catch (releaseError) {
    cleanupFailures.push(`释放数据库连接失败：${errorMessage(releaseError)}`);
  }
  try {
    await dependencies.endPool();
  } catch (endError) {
    cleanupFailures.push(`关闭数据库连接池失败：${errorMessage(endError)}`);
  }
  if (cleanupFailures.length > 0) {
    const cleanupMessage = cleanupFailures.join("；");
    if (commitSucceeded) {
      throw new Error(
        `数据库提交已经成功，但${cleanupMessage}；禁止盲目重试，必须先只读核验完整更正态`,
      );
    }
    failure = new Error(
      `${failure ? `${errorMessage(failure)}；` : ""}${cleanupMessage}`,
    );
  }
  if (failure) throw failure;
  if (!result) throw new Error("旧回单币种更正未产生可判定结果");
  return result;
}

function printHelp(): void {
  console.log(`已核验旧回单币种补齐

生产目标只读检查并获取数据库状态摘要：
  node dist/server/scripts/repair-reviewed-legacy-receipt-currency.js \\
    --print-target-database-sha256

生产库事务预演（默认，完整模拟后回滚）：
  node dist/server/scripts/repair-reviewed-legacy-receipt-currency.js

生产库正式提交：
  node dist/server/scripts/repair-reviewed-legacy-receipt-currency.js --commit \\
    --target-database-sha256=<事务预演返回的数据库状态摘要> \\
    --confirm-target=${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION}

安全边界：只允许生产容器执行；锁定3份原始文件摘要以及对应的合同、回单、
文件、识别任务和财务摘要；物理原件会再次计算摘要；更新或审计影响行数不是
精确3条时整笔事务回滚。`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    if (argv.length !== 1) throw new Error("帮助参数不能与其他参数同时使用");
    printHelp();
    return;
  }
  const args = parseReviewedLegacyReceiptCurrencyRepairArguments(argv);
  assertReviewedLegacyReceiptCurrencyRepairAuthorization();
  console.log(
    JSON.stringify(
      {
        mode:
          args.mode === "inspect"
            ? "只读检查"
            : args.mode === "dry-run"
              ? "事务预演"
              : "正式提交",
        ...(await runReviewedLegacyReceiptCurrencyRepair(args)),
      },
      null,
      2,
    ),
  );
}

const invokedAsScript =
  /repair-reviewed-legacy-receipt-currency\.(?:ts|js)$/u.test(
    path.basename(process.argv[1] || ""),
  );
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
