import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { ContractRecognitionResult } from "../services/contractOcr.js";

interface GroundTruthSample {
  id: string;
  relativePath: string;
  sha256: string;
  category: string;
  expected: {
    party_a: string | null;
    party_b: string | null;
    project_name: string | null;
    amount: string | null;
    contract_date: string | null;
  };
}

interface GroundTruthDocument {
  version: string;
  samples: GroundTruthSample[];
}

interface FrozenField {
  field: string;
  originalValue: string | null;
  normalizedValue: string | null;
  confidence: number;
  ocrConfidence: number | null;
  fieldScore: number;
  source: string;
  pageNumber: number | null;
  modelVersion: string;
  warnings?: string[];
  candidates?: unknown[];
}

interface FrozenRecord {
  schemaVersion: number;
  auditPolicyVersion: string;
  auditConfigurationHash: string;
  ocrModel: string;
  automaticPolicyVersion: string;
  sha256: string;
  result: {
    status: "succeeded" | "partial" | "failed";
    method: string;
    automaticAdoption?: {
      policyVersion?: string;
      legalEmptyFields?: string[];
    };
    fields: FrozenField[];
    warnings: string[];
    modelVersion: string;
  };
}

interface ReplayOptions {
  groundTruthPath: string;
  shardPaths: string[];
  inputRoot: string;
  outputPath: string;
  runId: string;
  confirmedDatabase: string;
  mode: "cached" | "live";
  sampleIds: Set<string>;
}

interface PreparedJob {
  contractId: string;
  fileId: string;
  jobId: string;
  storedPath: string;
  relationType: "main" | "supplement" | "termination";
}

interface ReplaySampleResult {
  id: string;
  sha256: string;
  relationType: PreparedJob["relationType"];
  jobStatus: string;
  engineVersion: string | null;
  fieldCount: number;
  ocrLineCount: number;
  contractVersion: number;
  manuallyConfirmedCount: number;
  modelVersions: string[];
  groundTruthMatched: boolean;
  readbackMatched: boolean;
  idempotent: boolean;
  durationMs: number;
  errors: string[];
}

interface ReplayProbeResult {
  passed: boolean;
  details: Record<string, unknown>;
  errors: string[];
}

const CORE_FIELDS = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
  "category",
  "contract_date",
] as const;

const EXPECTED_GROUND_TRUTH_VERSION = "contract-ocr-v6-regression-50-v2";
const EXPECTED_AUDIT_CONFIGURATION_HASH =
  "c67cb544e8fe56ca43352577e8b0cba5b044c6cbc0d31bd49234b11a64141afa";
const EXPECTED_AUTOMATIC_POLICY_VERSION = "highest-qualified-candidate-v1";

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function repeatedOptionValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function parseOptions(): ReplayOptions {
  const args = process.argv.slice(2);
  const groundTruthPath = optionValue(args, "--ground-truth");
  const shardPaths = repeatedOptionValues(args, "--shard");
  const inputRoot = optionValue(args, "--input");
  const outputPath = optionValue(args, "--output");
  const runId = optionValue(args, "--run-id");
  const confirmedDatabase = optionValue(args, "--confirm-isolated-db");
  const modeValue = optionValue(args, "--mode") || "cached";
  const sampleIds = new Set(
    repeatedOptionValues(args, "--sample-id").map((value) => value.trim()),
  );
  if (
    !groundTruthPath ||
    shardPaths.length === 0 ||
    !inputRoot ||
    !outputPath ||
    !runId ||
    !confirmedDatabase
  ) {
    throw new Error(
      "必须提供 --ground-truth、至少一个 --shard、--input、--output、--run-id 和 --confirm-isolated-db",
    );
  }
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/u.test(runId)) {
    throw new Error("--run-id 只能包含小写字母、数字和连字符");
  }
  if (modeValue !== "cached" && modeValue !== "live") {
    throw new Error("--mode 只能是 cached 或 live");
  }
  const resolvedOutput = path.resolve(outputPath);
  const debugRoot = `${path.resolve(process.cwd(), "debug")}${path.sep}`;
  if (!resolvedOutput.startsWith(debugRoot)) {
    throw new Error("回放报告只能写入 debug 目录");
  }
  return {
    groundTruthPath: path.resolve(groundTruthPath),
    shardPaths: shardPaths.map((item) => path.resolve(item)),
    inputRoot: path.resolve(inputRoot),
    outputPath: resolvedOutput,
    runId,
    confirmedDatabase,
    mode: modeValue,
    sampleIds,
  };
}

function assertIsolatedDatabase(options: ReplayOptions): {
  databaseName: string;
  databaseHost: string;
} {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("端到端回放只允许在 NODE_ENV=test 下运行");
  }
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("缺少 DATABASE_URL");
  const databaseUrl = new URL(rawUrl);
  if (
    !new Set(["postgres", "127.0.0.1", "localhost"]).has(databaseUrl.hostname)
  ) {
    throw new Error(
      "端到端回放只允许连接本机或隔离 Docker（容器平台）数据库主机",
    );
  }
  const databaseName = decodeURIComponent(
    databaseUrl.pathname.replace(/^\//u, ""),
  );
  if (!/^yulilog_worklog_ocr_e2e(?:_[a-z0-9_]+)?$/u.test(databaseName)) {
    throw new Error("数据库名称不符合合同识别隔离回放安全规则");
  }
  if (options.confirmedDatabase !== databaseName) {
    throw new Error("--confirm-isolated-db 与实际数据库名称不一致");
  }
  return { databaseName, databaseHost: databaseUrl.hostname };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readFrozenRecords(shardPaths: string[]): Map<string, FrozenRecord> {
  const records = new Map<string, FrozenRecord>();
  for (const shardPath of shardPaths) {
    const lines = fs
      .readFileSync(shardPath, "utf8")
      .split(/\r?\n/u)
      .filter(Boolean);
    for (const line of lines) {
      const record = JSON.parse(line) as FrozenRecord;
      if (
        record.schemaVersion !== 4 ||
        record.auditPolicyVersion !== "automatic-risk-review-2026-08-07-v12" ||
        record.auditConfigurationHash !== EXPECTED_AUDIT_CONFIGURATION_HASH ||
        record.ocrModel !== "v6_medium" ||
        record.automaticPolicyVersion !== EXPECTED_AUTOMATIC_POLICY_VERSION ||
        record.result.automaticAdoption?.policyVersion !==
          EXPECTED_AUTOMATIC_POLICY_VERSION ||
        record.result.modelVersion !== "v6_medium"
      ) {
        throw new Error(`冻结结果版本或模型不符合回放门禁：${shardPath}`);
      }
      if (records.has(record.sha256)) {
        throw new Error(`冻结结果出现重复摘要：${record.sha256}`);
      }
      records.set(record.sha256, record);
    }
  }
  return records;
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function relationTypeFor(
  sample: GroundTruthSample,
): PreparedJob["relationType"] {
  if (sample.category === "补充协议") return "supplement";
  if (sample.category === "解除或终止协议") return "termination";
  return "main";
}

function safeIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, "-")
    .slice(0, 80);
}

function replayUploadDirectory(options: ReplayOptions): string {
  const uploadsRoot = path.resolve(process.cwd(), "uploads", "ocr-e2e");
  const directory = path.resolve(uploadsRoot, options.runId);
  if (!directory.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new Error("隔离回放上传目录越界");
  }
  return directory;
}

function asNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).normalize("NFKC").trim();
  return text || null;
}

function valuesEqual(
  field: string,
  actual: unknown,
  expected: unknown,
): boolean {
  const left = asNullableText(actual);
  const right = asNullableText(expected);
  if (left === null || right === null) return left === right;
  if (field === "amount") return Number(left) === Number(right);
  return left === right;
}

function frozenRecognitionResult(
  record: FrozenRecord,
): ContractRecognitionResult {
  const fields = record.result.fields.map((field) => ({
    ...field,
    warnings: [...(field.warnings || [])],
    candidates: [...(field.candidates || [])],
  }));
  const ocrLines = fields
    .filter((field) => Boolean(field.originalValue || field.normalizedValue))
    .map((field, index) => ({
      page: Math.max(1, Number(field.pageNumber) || 1),
      text: String(field.originalValue || field.normalizedValue || ""),
      bbox: [
        [0, index * 2],
        [1, index * 2],
        [1, index * 2 + 1],
        [0, index * 2 + 1],
      ],
      confidence: Math.max(0, Math.min(1, Number(field.ocrConfidence) || 0)),
      modelVersion: field.modelVersion || record.result.modelVersion,
    }));
  const legalEmptyFields = new Set(
    record.result.automaticAdoption?.legalEmptyFields || [],
  );
  const frameworkMarker =
    legalEmptyFields.has("project_name") && legalEmptyFields.has("amount")
      ? "框架协议\n"
      : "";
  return {
    status: record.result.status,
    method: record.result.method as ContractRecognitionResult["method"],
    rawText: `${frameworkMarker}${fields
      .map((field) => field.originalValue || field.normalizedValue || "")
      .filter(Boolean)
      .join("\n")}`,
    fields: fields as ContractRecognitionResult["fields"],
    warnings: [...(record.result.warnings || [])],
    ocrLines: ocrLines as ContractRecognitionResult["ocrLines"],
    modelVersion: record.result
      .modelVersion as ContractRecognitionResult["modelVersion"],
  };
}

async function prepareJob(
  db: {
    run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
    get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  },
  options: ReplayOptions,
  sample: GroundTruthSample,
  suffix = "",
): Promise<PreparedJob> {
  const relationType = relationTypeFor(sample);
  const baseId = `${options.runId}-${safeIdentifier(sample.id)}${suffix}`;
  const contractId = `ocr-e2e-contract-${baseId}`;
  const fileId = `ocr-e2e-file-${baseId}`;
  const jobId = `ocr-e2e-job-${baseId}`;
  const actorId = `ocr-e2e-user-${options.runId}`;
  const existing = await db.get<{ id: string }>(
    "SELECT id FROM contracts WHERE id = ?",
    contractId,
  );
  if (existing) {
    throw new Error(`隔离回放标识已存在，请更换 --run-id：${contractId}`);
  }
  const sourcePath = path.resolve(options.inputRoot, sample.relativePath);
  if (!sourcePath.startsWith(`${options.inputRoot}${path.sep}`)) {
    throw new Error(`样本路径越界：${sample.id}`);
  }
  const sourceStat = await fs.promises.stat(sourcePath);
  const actualSha256 = await sha256File(sourcePath);
  if (actualSha256 !== sample.sha256) {
    throw new Error(`样本摘要不一致：${sample.id}`);
  }
  const uploadDirectory = replayUploadDirectory(options);
  await fs.promises.mkdir(uploadDirectory, { recursive: true });
  const destinationPath = path.join(uploadDirectory, `${baseId}.pdf`);
  await fs.promises.copyFile(
    sourcePath,
    destinationPath,
    fs.constants.COPYFILE_EXCL,
  );
  const storedPath = path
    .relative(process.cwd(), destinationPath)
    .split(path.sep)
    .join("/");
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO users (
       id, username, name, role, status, created_at, updated_at
     ) VALUES (?, NULL, ?, 'admin', 'active', ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    actorId,
    "合同识别隔离回放账号",
    now,
    now,
  );
  let parentContractId: string | null = null;
  if (relationType !== "main") {
    parentContractId = `ocr-e2e-parent-${baseId}`;
    await db.run(
      `INSERT INTO contracts (
         id, contract_no, title, declared_category, declared_subtype, category,
         relation_type, status, area, parent_contract_id, root_contract_id,
         amount_delta, financial_direction, financial_direction_source,
         financial_direction_version, version, created_by, updated_by,
         created_at, updated_at
       ) VALUES (
         ?, ?, ?, 'main_business', 'engineering_consulting', 'main_business',
         'main', 'effective', '海淀区', NULL, ?, 100000,
         'income', 'contract_category', 1, 1, ?, ?, ?, ?
       )`,
      parentContractId,
      `E2E-P-${baseId}`,
      `第七阶段隔离上级合同 ${sample.id}`,
      parentContractId,
      actorId,
      actorId,
      now,
      now,
    );
  }
  await db.run(
    `INSERT INTO contracts (
       id, contract_no, title, declared_category, declared_subtype, category,
       relation_type, status, area, parent_contract_id, root_contract_id,
       financial_direction, financial_direction_source,
       financial_direction_version, version, created_by, updated_by,
       created_at, updated_at
     ) VALUES (
       ?, ?, ?, 'main_business', 'engineering_consulting', 'main_business',
       ?, 'draft', '海淀区', ?, ?, 'income', 'contract_category', 1,
       1, ?, ?, ?, ?
     )`,
    contractId,
    `E2E-${baseId}`,
    `第七阶段隔离回放 ${sample.id}`,
    relationType,
    parentContractId,
    parentContractId || contractId,
    actorId,
    actorId,
    now,
    now,
  );
  await db.run(
    `INSERT INTO contract_files (
       id, contract_id, file_type, file_name, file_path, file_size,
       mime_type, file_hash, version, is_current, uploaded_by, created_at
     ) VALUES (?, ?, 'draft_contract', ?, ?, ?, 'application/pdf', ?, 1, TRUE, ?, ?)`,
    fileId,
    contractId,
    `${sample.id}.pdf`,
    storedPath,
    sourceStat.size,
    sample.sha256,
    actorId,
    now,
  );
  await db.run(
    `INSERT INTO contract_ocr_jobs (
       id, contract_id, file_id, status, retry_count, warnings_json,
       requested_by, created_at, updated_at
     ) VALUES (?, ?, ?, 'queued', 0, '[]'::jsonb, ?, ?, ?)`,
    jobId,
    contractId,
    fileId,
    actorId,
    now,
    now,
  );
  return { contractId, fileId, jobId, storedPath, relationType };
}

async function inspectResult(
  db: {
    all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
    get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  },
  prepared: PreparedJob,
  record: FrozenRecord,
  sample: GroundTruthSample,
): Promise<
  Omit<ReplaySampleResult, "id" | "sha256" | "relationType" | "durationMs">
> {
  const job = await db.get<{
    status: string;
    engine_version: string | null;
  }>(
    "SELECT status, engine_version FROM contract_ocr_jobs WHERE id = ?",
    prepared.jobId,
  );
  const contract = await db.get<{
    party_a: string | null;
    party_b: string | null;
    project_name: string | null;
    amount_delta: number | null;
    category: string | null;
    contract_date: string | null;
    version: number;
  }>(
    `SELECT party_a, party_b, project_name, amount_delta, category,
       contract_date, version FROM contracts WHERE id = ?`,
    prepared.contractId,
  );
  const fields = await db.all<{
    field_code: string;
    normalized_value: string | null;
    final_value: string | null;
    manually_confirmed: boolean;
  }>(
    `SELECT field_code, normalized_value, final_value, manually_confirmed
     FROM contract_ocr_fields WHERE job_id = ? ORDER BY field_code`,
    prepared.jobId,
  );
  const lineSummary = await db.get<{
    line_count: number;
    model_versions: string[] | null;
  }>(
    `SELECT COUNT(*)::int AS line_count,
       ARRAY_AGG(DISTINCT model_version ORDER BY model_version) AS model_versions
     FROM contract_ocr_lines WHERE job_id = ?`,
    prepared.jobId,
  );
  const errors: string[] = [];
  if (!job) errors.push("识别任务回读缺失");
  if (!contract) errors.push("合同主表回读缺失");
  if (job?.status !== "succeeded") errors.push(`识别任务状态为 ${job?.status}`);
  if (fields.length !== CORE_FIELDS.length) {
    errors.push(`字段行数为 ${fields.length}`);
  }
  if (fields.some((field) => field.manually_confirmed)) {
    errors.push("存在被标记为人工确认的字段");
  }
  const frozenByField = new Map(
    record.result.fields.map((field) => [
      field.field,
      field.field === "category"
        ? "main_business"
        : asNullableText(field.normalizedValue),
    ]),
  );
  const persistedByField = new Map(
    fields.map((field) => [field.field_code, field.final_value]),
  );
  for (const fieldCode of CORE_FIELDS) {
    if (
      !valuesEqual(
        fieldCode,
        persistedByField.get(fieldCode),
        frozenByField.get(fieldCode),
      )
    ) {
      errors.push(`${fieldCode} 最终字段与冻结识别结果不一致`);
    }
  }
  const groundTruthErrors: string[] = [];
  const expectedGroundTruth: Record<string, string | null> = {
    party_a: asNullableText(sample.expected.party_a),
    party_b: asNullableText(sample.expected.party_b),
    project_name: asNullableText(sample.expected.project_name),
    amount: asNullableText(sample.expected.amount),
    contract_date: asNullableText(sample.expected.contract_date),
  };
  for (const fieldCode of [
    "party_a",
    "party_b",
    "project_name",
    "amount",
    "contract_date",
  ]) {
    if (
      !valuesEqual(
        fieldCode,
        persistedByField.get(fieldCode),
        expectedGroundTruth[fieldCode],
      )
    ) {
      groundTruthErrors.push(`${fieldCode} 最终字段与人工真值不一致`);
    }
  }
  errors.push(...groundTruthErrors);
  if (contract) {
    const contractValues: Record<string, unknown> = {
      party_a: contract.party_a,
      party_b: contract.party_b,
      project_name: contract.project_name,
      amount: contract.amount_delta,
      category: contract.category,
      contract_date: contract.contract_date,
    };
    for (const fieldCode of CORE_FIELDS) {
      if (
        !valuesEqual(
          fieldCode,
          contractValues[fieldCode],
          frozenByField.get(fieldCode),
        )
      ) {
        errors.push(`${fieldCode} 合同主表与冻结识别结果不一致`);
      }
    }
  }
  return {
    jobStatus: job?.status || "missing",
    engineVersion: job?.engine_version || null,
    fieldCount: fields.length,
    ocrLineCount: Number(lineSummary?.line_count || 0),
    contractVersion: Number(contract?.version || 0),
    manuallyConfirmedCount: fields.filter((field) => field.manually_confirmed)
      .length,
    modelVersions: lineSummary?.model_versions || [],
    groundTruthMatched: groundTruthErrors.length === 0,
    readbackMatched: errors.length === 0,
    idempotent: false,
    errors,
  };
}

async function runRollbackProbe(
  db: {
    run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
    all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
    get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  },
  runRecognitionJob: (
    jobId: string,
    runner?: () => Promise<ContractRecognitionResult>,
  ) => Promise<void>,
  options: ReplayOptions,
  sample: GroundTruthSample,
  record: FrozenRecord,
): Promise<ReplayProbeResult> {
  const prepared = await prepareJob(db, options, sample, "-rollback-probe");
  const result = frozenRecognitionResult(record);
  const duplicate = result.fields.find((field) => field.field === "party_a");
  if (!duplicate) throw new Error("回滚探针缺少甲方字段");
  const malformedResult: ContractRecognitionResult = {
    ...result,
    fields: [...result.fields, { ...duplicate }],
  };
  await runRecognitionJob(prepared.jobId, async () => malformedResult);
  const job = await db.get<{
    status: string;
    worker_token: string | null;
    lease_expires_at: string | null;
    error_message: string | null;
  }>(
    `SELECT status, worker_token, lease_expires_at, error_message
     FROM contract_ocr_jobs WHERE id = ?`,
    prepared.jobId,
  );
  const fieldCount = await db.get<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM contract_ocr_fields WHERE job_id = ?",
    prepared.jobId,
  );
  const lineCount = await db.get<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM contract_ocr_lines WHERE job_id = ?",
    prepared.jobId,
  );
  const contract = await db.get<{
    party_a: string | null;
    party_b: string | null;
    project_name: string | null;
    amount_delta: number | null;
    category: string | null;
    contract_date: string | null;
  }>(
    `SELECT party_a, party_b, project_name, amount_delta, category, contract_date
     FROM contracts WHERE id = ?`,
    prepared.contractId,
  );
  const errors: string[] = [];
  if (job?.status !== "failed") errors.push("故障注入后任务没有进入失败状态");
  if (job?.worker_token || job?.lease_expires_at) {
    errors.push("故障注入后工作进程令牌或租约没有清空");
  }
  if (Number(fieldCount?.count || 0) !== 0) errors.push("回滚后残留字段行");
  if (Number(lineCount?.count || 0) !== 0) errors.push("回滚后残留识别行");
  if (
    contract &&
    [
      contract.party_a,
      contract.party_b,
      contract.project_name,
      contract.amount_delta,
      contract.category,
      contract.contract_date,
    ].some((value) => value !== null)
  ) {
    errors.push("回滚后合同主表残留自动字段");
  }
  return {
    passed: errors.length === 0,
    details: {
      jobStatus: job?.status || "missing",
      workerTokenCleared: !job?.worker_token,
      leaseCleared: !job?.lease_expires_at,
      fieldCount: Number(fieldCount?.count || 0),
      ocrLineCount: Number(lineCount?.count || 0),
      errorRecorded: Boolean(job?.error_message),
    },
    errors,
  };
}

async function runDirectJobRecreationProbe(
  db: {
    run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
    all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
    get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  },
  runRecognitionJob: (
    jobId: string,
    runner?: () => Promise<ContractRecognitionResult>,
  ) => Promise<void>,
  options: ReplayOptions,
  sample: GroundTruthSample,
  record: FrozenRecord,
): Promise<ReplayProbeResult> {
  const prepared = await prepareJob(
    db,
    options,
    sample,
    "-direct-recreation-probe",
  );
  await runRecognitionJob(prepared.jobId, async () => {
    throw new Error("第七阶段隔离故障注入");
  });
  const failedJob = await db.get<{
    status: string;
    retry_count: number;
    worker_token: string | null;
    lease_expires_at: string | null;
  }>(
    `SELECT status, retry_count, worker_token, lease_expires_at
     FROM contract_ocr_jobs WHERE id = ?`,
    prepared.jobId,
  );
  const recreatedJobId = `${prepared.jobId}-recreated-1`;
  const now = new Date().toISOString();
  const inserted = await db.run(
    `INSERT INTO contract_ocr_jobs (
       id, contract_id, file_id, status, retry_count, warnings_json,
       requested_by, created_at, updated_at
     )
     SELECT ?, contract_id, file_id, 'queued', retry_count + 1,
       '[]'::jsonb, requested_by, ?, ?
     FROM contract_ocr_jobs WHERE id = ? AND status = 'failed'`,
    recreatedJobId,
    now,
    now,
    prepared.jobId,
  );
  const result = frozenRecognitionResult(record);
  await runRecognitionJob(recreatedJobId, async () => result);
  const recreatedPrepared = { ...prepared, jobId: recreatedJobId };
  const readback = await inspectResult(db, recreatedPrepared, record, sample);
  const recreatedJob = await db.get<{
    status: string;
    retry_count: number;
  }>(
    "SELECT status, retry_count FROM contract_ocr_jobs WHERE id = ?",
    recreatedJobId,
  );
  const errors = [...readback.errors];
  if (failedJob?.status !== "failed") errors.push("首次故障任务状态不正确");
  if (failedJob?.worker_token || failedJob?.lease_expires_at) {
    errors.push("首次故障任务没有清空令牌或租约");
  }
  if (inserted.changes !== 1) errors.push("直接重建任务没有唯一创建");
  if (recreatedJob?.status !== "succeeded") {
    errors.push("直接重建任务没有成功");
  }
  if (
    Number(recreatedJob?.retry_count) !==
    Number(failedJob?.retry_count || 0) + 1
  ) {
    errors.push("直接重建任务的次数没有递增");
  }
  return {
    passed: errors.length === 0,
    details: {
      initialStatus: failedJob?.status || "missing",
      recreatedStatus: recreatedJob?.status || "missing",
      initialRetryCount: Number(failedJob?.retry_count || 0),
      recreatedCount: Number(recreatedJob?.retry_count || 0),
      insertedRecreatedJobs: inserted.changes,
      fieldCount: readback.fieldCount,
      ocrLineCount: readback.ocrLineCount,
      manuallyConfirmedCount: readback.manuallyConfirmedCount,
    },
    errors,
  };
}

async function main(): Promise<void> {
  const options = parseOptions();
  const databaseIdentity = assertIsolatedDatabase(options);
  const groundTruth = readJson<GroundTruthDocument>(options.groundTruthPath);
  if (groundTruth.version !== EXPECTED_GROUND_TRUTH_VERSION) {
    throw new Error("人工真值版本不符合第七阶段冻结回放门禁");
  }
  const records = readFrozenRecords(options.shardPaths);
  const selectedSamples = groundTruth.samples.filter(
    (sample) =>
      options.sampleIds.size === 0 || options.sampleIds.has(sample.id),
  );
  if (selectedSamples.length === 0) throw new Error("没有选中任何回放样本");
  for (const sample of selectedSamples) {
    if (!records.has(sample.sha256)) {
      throw new Error(`缺少冻结识别结果：${sample.id}`);
    }
  }
  const { db, pool } = await import("../db/index.js");
  const { runRecognitionJob } = await import("../routes/contracts.js");
  const { shutdownOcrDaemon } = await import("../services/ocrDaemon.js");
  const startedAt = new Date().toISOString();
  const sampleResults: ReplaySampleResult[] = [];
  let concurrencyClaimedOnce: boolean | null =
    options.mode === "cached" ? false : null;
  let rollbackProbe: ReplayProbeResult | null = null;
  let directJobRecreationProbe: ReplayProbeResult | null = null;
  try {
    for (const sample of selectedSamples) {
      const record = records.get(sample.sha256)!;
      const prepared = await prepareJob(db, options, sample);
      const recognitionResult = frozenRecognitionResult(record);
      let recognitionCalls = 0;
      const runner = async (): Promise<ContractRecognitionResult> => {
        recognitionCalls += 1;
        return recognitionResult;
      };
      const sampleStartedAt = Date.now();
      if (sampleResults.length === 0 && options.mode === "cached") {
        await Promise.all([
          runRecognitionJob(prepared.jobId, runner),
          runRecognitionJob(prepared.jobId, runner),
        ]);
        concurrencyClaimedOnce = recognitionCalls === 1;
      } else if (options.mode === "cached") {
        await runRecognitionJob(prepared.jobId, runner);
      } else {
        await runRecognitionJob(prepared.jobId);
      }
      const beforeIdempotent = await inspectResult(
        db,
        prepared,
        record,
        sample,
      );
      if (options.mode === "cached") {
        await runRecognitionJob(prepared.jobId, runner);
      } else {
        await runRecognitionJob(prepared.jobId);
      }
      const afterIdempotent = await inspectResult(db, prepared, record, sample);
      const idempotent =
        beforeIdempotent.contractVersion === afterIdempotent.contractVersion &&
        beforeIdempotent.fieldCount === afterIdempotent.fieldCount &&
        beforeIdempotent.ocrLineCount === afterIdempotent.ocrLineCount &&
        (options.mode === "live" || recognitionCalls === 1);
      const errors = [...afterIdempotent.errors];
      if (!idempotent) errors.push("重复执行未保持幂等");
      sampleResults.push({
        id: sample.id,
        sha256: sample.sha256,
        relationType: prepared.relationType,
        ...afterIdempotent,
        idempotent,
        readbackMatched: afterIdempotent.readbackMatched && idempotent,
        durationMs: Date.now() - sampleStartedAt,
        errors,
      });
    }
    if (options.mode === "cached") {
      const probeSample = selectedSamples[0];
      const probeRecord = records.get(probeSample.sha256)!;
      rollbackProbe = await runRollbackProbe(
        db,
        runRecognitionJob,
        options,
        probeSample,
        probeRecord,
      );
      directJobRecreationProbe = await runDirectJobRecreationProbe(
        db,
        runRecognitionJob,
        options,
        probeSample,
        probeRecord,
      );
    }
    const failedSamples = sampleResults.filter(
      (sample) => !sample.readbackMatched,
    );
    const report = {
      schemaVersion: 2,
      runId: options.runId,
      databaseName: databaseIdentity.databaseName,
      databaseHost: databaseIdentity.databaseHost,
      mode: options.mode,
      evidenceScope:
        options.mode === "cached"
          ? "冻结识别结果数据库持久化回放"
          : "原文件实时识别数据库持久化回放（绕过上传接口）",
      evidenceBoundaries: {
        realOcrExecuted: options.mode === "live",
        httpUploadRouteExecuted: false,
        syntheticOcrLines: options.mode === "cached",
        provesFieldAccuracy: options.mode === "live",
      },
      groundTruthVersion: groundTruth.version,
      startedAt,
      finishedAt: new Date().toISOString(),
      safety: {
        nodeEnv: process.env.NODE_ENV,
        isolatedDatabaseNamingRulePassed: true,
        explicitDatabaseConfirmationMatched: true,
      },
      summary: {
        total: sampleResults.length,
        succeeded: sampleResults.length - failedSamples.length,
        failed: failedSamples.length,
        automaticWriteRate:
          sampleResults.length === 0
            ? 0
            : (sampleResults.length - failedSamples.length) /
              sampleResults.length,
        idempotent: sampleResults.every((sample) => sample.idempotent),
        concurrencyClaimedOnce,
        manuallyConfirmedCount: sampleResults.reduce(
          (sum, sample) => sum + sample.manuallyConfirmedCount,
          0,
        ),
        groundTruthMatched: sampleResults.filter(
          (sample) => sample.groundTruthMatched,
        ).length,
        rollbackProbePassed: rollbackProbe?.passed ?? null,
        directJobRecreationProbePassed:
          directJobRecreationProbe?.passed ?? null,
      },
      probes: {
        rollback: rollbackProbe,
        directJobRecreation: directJobRecreationProbe,
      },
      samples: sampleResults,
    };
    await fs.promises.writeFile(
      options.outputPath,
      `${JSON.stringify(report, null, 2)}\n`,
      { flag: "wx" },
    );
    console.log(JSON.stringify(report.summary));
    if (
      failedSamples.length > 0 ||
      concurrencyClaimedOnce === false ||
      rollbackProbe?.passed === false ||
      directJobRecreationProbe?.passed === false
    ) {
      process.exitCode = 1;
    }
  } finally {
    shutdownOcrDaemon();
    try {
      await fs.promises.rm(replayUploadDirectory(options), {
        recursive: true,
        force: true,
      });
    } finally {
      await pool.end();
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
