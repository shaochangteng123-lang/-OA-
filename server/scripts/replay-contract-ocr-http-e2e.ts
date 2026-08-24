import crypto from "crypto";
import fs from "fs";
import path from "path";
import express from "express";
import session from "express-session";
import type { Server } from "http";
import {
  readContractOcrStage10Freeze,
  verifyContractOcrStage10Freeze,
  writePrivateImmutableJson,
  type ContractOcrStage10AmountBreakdown,
  type ContractOcrStage10AmountStatus,
  type ContractOcrStage10Freeze,
  type ContractOcrStage10RelationType,
} from "../services/contractOcrStage10Blind.js";
import type {
  ContractOcrStage10E2eReport,
  ContractOcrStage10E2eSampleEvidence,
} from "../services/contractOcrStage10Metrics.js";

interface GroundTruthSample {
  id: string;
  familyId?: string;
  relativePath: string;
  sha256: string;
  category?: string;
  relationType?: ContractOcrStage10RelationType;
  expected: {
    party_a: string | null;
    party_b: string | null;
    project_name: string | null;
    amount: string | null;
    contract_date: string | null;
    amountStatus?: ContractOcrStage10AmountStatus;
    amountBreakdown?: ContractOcrStage10AmountBreakdown;
  };
}

interface Options {
  groundTruthPath: string;
  inputRoot: string;
  outputPath: string;
  runId: string;
  confirmedDatabase: string;
  sampleIds: string[];
  timeoutMs: number;
  freezePath: string | null;
  baselinePath: string | null;
  inventoryPath: string | null;
  candidateManifestPath: string | null;
  finalManifestPath: string | null;
  mappingPath: string | null;
  familyIsolationMetadataPath: string | null;
  familyIsolationLineagePath: string | null;
  familyRegistryPath: string | null;
  exclusionManifestPaths: string[];
  consumedAuditPaths: string[];
  datasetVersion: string | null;
}

interface HttpReplayResult {
  id: string;
  relationType: "main" | "supplement" | "termination";
  status: string;
  groundTruthMatched: boolean;
  fieldCount: number;
  ocrLineCount: number;
  manuallyConfirmedCount: number;
  modelVersions: string[];
  engineVersion: string | null;
  contractVersion: number;
  auditCreateCount: number;
  sourceHashMatched: boolean;
  durationMs: number;
  errors: string[];
}

interface GroundTruthDocument {
  version?: string;
  schemaVersion?: number;
  datasetVersion?: string;
  samples: GroundTruthSample[];
}

interface OcrJobApiData {
  status: string;
  engineVersion: string | null;
  contractVersion: number;
  fields: Array<{
    field: string;
    originalValue: string | null;
    normalizedValue: string | null;
    finalValue: string | null;
    confidence: number;
    source: string;
    pageNumber: number | null;
    evidence: string | null;
    manuallyConfirmed: boolean;
  }>;
  ocrLines: Array<{
    page: number;
    text: string;
    bbox: unknown;
    confidence: number;
    modelVersion: string;
  }>;
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function repeatedOptionValues(args: string[], name: string): string[] {
  return args.flatMap((value, index) =>
    value === name && args[index + 1] ? [args[index + 1]] : [],
  );
}

function parseOptions(): Options {
  const args = process.argv.slice(2);
  const groundTruthPath = optionValue(args, "--ground-truth");
  const inputRoot = optionValue(args, "--input");
  const outputPath = optionValue(args, "--output");
  const runId = optionValue(args, "--run-id");
  const confirmedDatabase = optionValue(args, "--confirm-isolated-db");
  const sampleIds = repeatedOptionValues(args, "--sample-id");
  const timeoutMs = Number(optionValue(args, "--timeout-ms") || 900_000);
  const freezePath = optionValue(args, "--freeze");
  const baselinePath = optionValue(args, "--baseline");
  const inventoryPath = optionValue(args, "--inventory-manifest");
  const candidateManifestPath = optionValue(args, "--candidate-manifest");
  const finalManifestPath = optionValue(args, "--final-manifest");
  const mappingPath = optionValue(args, "--mapping");
  const familyIsolationMetadataPath = optionValue(
    args,
    "--family-isolation-metadata",
  );
  const familyIsolationLineagePath = optionValue(args, "--family-lineage");
  const familyRegistryPath = optionValue(args, "--family-registry");
  const exclusionManifestPaths = repeatedOptionValues(args, "--exclude");
  const consumedAuditPaths = repeatedOptionValues(args, "--consumed-audit");
  const datasetVersion = optionValue(args, "--dataset-version");
  if (
    !groundTruthPath ||
    !inputRoot ||
    !outputPath ||
    !runId ||
    !confirmedDatabase ||
    sampleIds.length === 0
  ) {
    throw new Error(
      "必须提供 --ground-truth、--input、--output、--run-id、--confirm-isolated-db 和至少一个 --sample-id",
    );
  }
  const stage10Options = [
    freezePath,
    baselinePath,
    inventoryPath,
    candidateManifestPath,
    finalManifestPath,
    mappingPath,
    familyIsolationMetadataPath,
    familyIsolationLineagePath,
    familyRegistryPath,
    datasetVersion,
  ];
  if (stage10Options.some(Boolean) && stage10Options.some((value) => !value)) {
    throw new Error(
      "第十阶段回放必须同时提供 --baseline、--freeze、--inventory-manifest、--candidate-manifest、--final-manifest、--mapping、--family-isolation-metadata、--family-lineage、--family-registry 和 --dataset-version",
    );
  }
  if (
    freezePath &&
    (exclusionManifestPaths.length < 2 || consumedAuditPaths.length === 0)
  ) {
    throw new Error(
      "第十阶段回放至少需要两个 --exclude 和一个 --consumed-audit",
    );
  }
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/u.test(runId)) {
    throw new Error("--run-id 只能包含小写字母、数字和连字符");
  }
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 60_000 ||
    timeoutMs > 1_800_000
  ) {
    throw new Error("--timeout-ms 必须在 60000 到 1800000 之间");
  }
  const resolvedOutput = path.resolve(outputPath);
  if (
    !resolvedOutput.startsWith(
      `${path.resolve(process.cwd(), "debug")}${path.sep}`,
    )
  ) {
    throw new Error(
      "HTTP（超文本传输协议）回放报告只能写入当前工作目录的 debug 目录",
    );
  }
  if (
    freezePath &&
    !resolvedOutput.startsWith(
      `${path.resolve(process.cwd(), "debug/contract-ocr-stage10-private")}${path.sep}`,
    )
  ) {
    throw new Error(
      "第十阶段私有证据只能写入 debug/contract-ocr-stage10-private 目录",
    );
  }
  return {
    groundTruthPath: path.resolve(groundTruthPath),
    inputRoot: path.resolve(inputRoot),
    outputPath: resolvedOutput,
    runId,
    confirmedDatabase,
    sampleIds,
    timeoutMs,
    freezePath: freezePath ? path.resolve(freezePath) : null,
    baselinePath: baselinePath ? path.resolve(baselinePath) : null,
    inventoryPath: inventoryPath ? path.resolve(inventoryPath) : null,
    candidateManifestPath: candidateManifestPath
      ? path.resolve(candidateManifestPath)
      : null,
    finalManifestPath: finalManifestPath
      ? path.resolve(finalManifestPath)
      : null,
    mappingPath: mappingPath ? path.resolve(mappingPath) : null,
    familyIsolationMetadataPath: familyIsolationMetadataPath
      ? path.resolve(familyIsolationMetadataPath)
      : null,
    familyIsolationLineagePath: familyIsolationLineagePath
      ? path.resolve(familyIsolationLineagePath)
      : null,
    familyRegistryPath: familyRegistryPath
      ? path.resolve(familyRegistryPath)
      : null,
    exclusionManifestPaths: exclusionManifestPaths.map((value) =>
      path.resolve(value),
    ),
    consumedAuditPaths: consumedAuditPaths.map((value) => path.resolve(value)),
    datasetVersion,
  };
}

function assertIsolatedDatabase(options: Options): {
  databaseName: string;
  databaseHost: string;
} {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "HTTP（超文本传输协议）端到端回放只允许在 NODE_ENV（运行环境变量）=test 下运行",
    );
  }
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("缺少 DATABASE_URL");
  const databaseUrl = new URL(rawUrl);
  if (
    !new Set(["postgres", "127.0.0.1", "localhost"]).has(databaseUrl.hostname)
  ) {
    throw new Error(
      "HTTP（超文本传输协议）回放只允许连接本机或隔离 Docker（容器平台）数据库主机",
    );
  }
  const databaseName = decodeURIComponent(
    databaseUrl.pathname.replace(/^\//u, ""),
  );
  if (!/^yulilog_worklog_ocr_e2e(?:_[a-z0-9_]+)?$/u.test(databaseName)) {
    throw new Error("数据库名称不符合合同识别隔离回放安全规则");
  }
  if (databaseName !== options.confirmedDatabase) {
    throw new Error("--confirm-isolated-db 与实际数据库名称不一致");
  }
  return { databaseName, databaseHost: databaseUrl.hostname };
}

function normalizeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).normalize("NFKC").trim();
  return text || null;
}

function valuesEqual(
  field: string,
  actual: unknown,
  expected: unknown,
): boolean {
  const left = normalizeValue(actual);
  const right = normalizeValue(expected);
  if (left === null || right === null) return left === right;
  if (field === "amount") {
    return Number(left) === Number(right);
  }
  return left === right;
}

function isValidOcrBbox(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every(
          (coordinate) =>
            typeof coordinate === "number" && Number.isFinite(coordinate),
        ),
    )
  );
}

function relationTypeFor(
  sample: GroundTruthSample,
): HttpReplayResult["relationType"] {
  if (sample.relationType === "main") return "main";
  if (sample.relationType === "other") return "main";
  if (sample.relationType === "termination") return "termination";
  if (
    sample.relationType === "supplement" ||
    sample.relationType === "change" ||
    sample.relationType === "reduction"
  ) {
    return "supplement";
  }
  if (sample.category === "补充协议") return "supplement";
  if (sample.category === "解除或终止协议") return "termination";
  return "main";
}

function mimeTypeFor(filePath: string): string {
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = mimeTypes[extension];
  if (!mimeType)
    throw new Error(`不支持的合同文件格式：${extension || "无扩展名"}`);
  return mimeType;
}

function readDockerCgroupMemoryBytes(): number {
  const candidates = [
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  ];
  for (const candidate of candidates) {
    try {
      const value = Number(fs.readFileSync(candidate, "utf8").trim());
      if (Number.isSafeInteger(value) && value > 0) return value;
    } catch {
      // 继续尝试 Docker（容器平台）的另一种控制组布局。
    }
  }
  throw new Error(
    "第十阶段必须在可读取 Docker（容器平台）控制组整体内存的环境中运行",
  );
}

function startDockerMemoryMonitor(): {
  stop: () => number;
} {
  let peakMemoryBytes = readDockerCgroupMemoryBytes();
  let stopped = false;
  const timer = setInterval(() => {
    peakMemoryBytes = Math.max(peakMemoryBytes, readDockerCgroupMemoryBytes());
  }, 100);
  timer.unref();
  return {
    stop: () => {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        peakMemoryBytes = Math.max(
          peakMemoryBytes,
          readDockerCgroupMemoryBytes(),
        );
      }
      return peakMemoryBytes;
    },
  };
}

function stableDatabaseFingerprint(
  rows: Array<{ id: string; version: number; updated_at: string }>,
): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        [...rows].sort((left, right) => left.id.localeCompare(right.id)),
      ),
    )
    .digest("hex");
}

function areaFor(sample: GroundTruthSample): string {
  if (sample.relativePath.includes("国网朝阳")) return "朝阳区";
  if (sample.relativePath.includes("国网丰台")) return "丰台区";
  if (sample.relativePath.includes("国网门头沟")) return "门头沟区";
  return "海淀区";
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const options = parseOptions();
  const databaseIdentity = assertIsolatedDatabase(options);
  const document = JSON.parse(
    fs.readFileSync(options.groundTruthPath, "utf8"),
  ) as GroundTruthDocument;
  if (!Array.isArray(document.samples)) {
    throw new Error("人工真值缺少样本数组");
  }
  let stage10Freeze: ContractOcrStage10Freeze | null = null;
  let automaticPolicyVersion: string | null = null;
  const stage10Enabled = options.freezePath !== null;
  if (stage10Enabled) {
    const { CONTRACT_OCR_AUTOMATIC_POLICY_VERSION } =
      await import("../services/contractService.js");
    const { resolvePaddleOcrModel } = await import("../services/ocrDaemon.js");
    automaticPolicyVersion = CONTRACT_OCR_AUTOMATIC_POLICY_VERSION;
    stage10Freeze = readContractOcrStage10Freeze(options.freezePath!);
    verifyContractOcrStage10Freeze(stage10Freeze, {
      projectRoot: process.cwd(),
      baselinePath: options.baselinePath!,
      inventoryPath: options.inventoryPath!,
      candidateManifestPath: options.candidateManifestPath!,
      finalManifestPath: options.finalManifestPath!,
      mappingPath: options.mappingPath!,
      groundTruthPath: options.groundTruthPath,
      familyIsolationMetadataPath: options.familyIsolationMetadataPath!,
      familyIsolationLineagePath: options.familyIsolationLineagePath!,
      familyRegistryPath: options.familyRegistryPath!,
      exclusionManifestPaths: options.exclusionManifestPaths,
      consumedAuditPaths: options.consumedAuditPaths,
      datasetVersion: options.datasetVersion!,
      automaticPolicyVersion,
      configuredOcrModel: resolvePaddleOcrModel(),
    });
    if (
      document.schemaVersion !== 1 ||
      document.datasetVersion !== stage10Freeze.datasetVersion
    ) {
      throw new Error("第十阶段人工真值结构或数据集版本与冻结文件不一致");
    }
    const frozenSamples = new Map(
      stage10Freeze.blindSet.samples.map((sample) => [sample.sampleId, sample]),
    );
    for (const sample of document.samples) {
      const frozen = frozenSamples.get(sample.id);
      if (
        !frozen ||
        frozen.sha256 !== sample.sha256 ||
        frozen.familyId !== sample.familyId ||
        !sample.expected.amountStatus ||
        !sample.expected.amountBreakdown
      ) {
        throw new Error(`第十阶段样本 ${sample.id} 与冻结身份或金额真值不一致`);
      }
    }
    readDockerCgroupMemoryBytes();
  }
  const samples = options.sampleIds.map((id) => {
    const sample = document.samples.find((item) => item.id === id);
    if (!sample) throw new Error(`真值中不存在样本：${id}`);
    return sample;
  });
  const { db, pool } = await import("../db/index.js");
  const { hashPassword } = await import("../utils/password.js");
  const authRoutes = (await import("../routes/auth.js")).default;
  const contractsRoutes = (await import("../routes/contracts.js")).default;
  const { shutdownOcrDaemon } = await import("../services/ocrDaemon.js");
  const { shutdownTesseractOcrDaemon } =
    await import("../services/tesseractOcrDaemon.js");
  const {
    getContractAmountBreakdown,
    getContractAmountStatus,
    recognizeContractFile,
  } = await import("../services/contractOcr.js");
  const contractGraphFingerprint = async (contractId: string) => {
    const [contracts, files, jobs, fields, lines, audits] = await Promise.all([
      db.all<Record<string, unknown>>(
        "SELECT * FROM contracts WHERE id = ? ORDER BY id",
        contractId,
      ),
      db.all<Record<string, unknown>>(
        "SELECT * FROM contract_files WHERE contract_id = ? ORDER BY id",
        contractId,
      ),
      db.all<Record<string, unknown>>(
        "SELECT * FROM contract_ocr_jobs WHERE contract_id = ? ORDER BY id",
        contractId,
      ),
      db.all<Record<string, unknown>>(
        "SELECT * FROM contract_ocr_fields WHERE contract_id = ? ORDER BY job_id, field_code",
        contractId,
      ),
      db.all<Record<string, unknown>>(
        "SELECT * FROM contract_ocr_lines WHERE contract_id = ? ORDER BY job_id, line_index",
        contractId,
      ),
      db.all<Record<string, unknown>>(
        "SELECT * FROM contract_audit_logs WHERE contract_id = ? ORDER BY created_at, id",
        contractId,
      ),
    ]);
    return crypto
      .createHash("sha256")
      .update(JSON.stringify({ contracts, files, jobs, fields, lines, audits }))
      .digest("hex");
  };
  if (stage10Enabled) {
    const initialDomainCounts = await db.get<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*)::int FROM contracts) AS contracts,
         (SELECT COUNT(*)::int FROM contract_files) AS files,
         (SELECT COUNT(*)::int FROM contract_ocr_jobs) AS jobs,
         (SELECT COUNT(*)::int FROM contract_ocr_fields) AS fields,
         (SELECT COUNT(*)::int FROM contract_ocr_lines) AS lines,
         (SELECT COUNT(*)::int FROM contract_audit_logs) AS audits`,
    );
    if (
      !initialDomainCounts ||
      Object.values(initialDomainCounts).some((count) => Number(count) !== 0)
    ) {
      throw new Error(
        "第十阶段只允许在合同域六张表均为空的全新隔离数据库运行，防止数据污染",
      );
    }
  }
  const actorId = `ocr-http-e2e-user-${options.runId}`;
  const username = `ocr_http_${options.runId.replace(/-/gu, "_")}`.slice(0, 50);
  const password = `OcrE2e-${crypto.randomBytes(24).toString("base64url")}-9!`;
  const existing = await db.get<{ id: string }>(
    "SELECT id FROM users WHERE id = ? OR username = ?",
    actorId,
    username,
  );
  if (existing) {
    throw new Error("HTTP（超文本传输协议）回放标识已存在，请更换 --run-id");
  }
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO users (
       id, username, password_hash, name, role, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)`,
    actorId,
    username,
    await hashPassword(password),
    "合同识别 HTTP（超文本传输协议）隔离回放账号",
    now,
    now,
  );
  const untouchedContractsBefore = await db.all<{
    id: string;
    version: number;
    updated_at: string;
  }>(
    `SELECT id, version, updated_at FROM contracts
     WHERE created_by <> ? ORDER BY id`,
    actorId,
  );
  const untouchedContractsFingerprint = stableDatabaseFingerprint(
    untouchedContractsBefore,
  );

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(
    session({
      secret: `stage7-http-e2e-${options.runId}`,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax" },
    }),
  );
  app.use("/api/auth", authRoutes);
  app.use("/api/contracts", contractsRoutes);

  let server: Server | null = null;
  const results: HttpReplayResult[] = [];
  const stage10Results: ContractOcrStage10E2eSampleEvidence[] = [];
  const expectedContractIds = new Set<string>();
  const stage10ContractIds = new Map<string, string>();
  const stage10ContractGraphFingerprints = new Map<string, string>();
  const startedAt = new Date().toISOString();
  try {
    server = await new Promise<Server>((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.on("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("无法取得 HTTP（超文本传输协议）回放监听地址");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!loginResponse.ok) {
      throw new Error(`隔离测试账号登录失败：${loginResponse.status}`);
    }
    const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("登录响应没有会话 Cookie");

    for (const sample of samples) {
      const sampleStartedAt = Date.now();
      const errors: string[] = [];
      const memoryMonitor = stage10Enabled ? startDockerMemoryMonitor() : null;
      try {
        const relationType = relationTypeFor(sample);
        const area = areaFor(sample);
        let parentContractId: string | null = null;
        if (["supplement", "termination"].includes(relationType)) {
          parentContractId = `ocr-http-e2e-parent-${options.runId}-${sample.id.toLowerCase()}`;
          const parentNow = new Date().toISOString();
          await db.run(
            `INSERT INTO contracts (
             id, contract_no, title, declared_category, declared_subtype,
             category, relation_type, status, area, root_contract_id,
             amount_delta, financial_direction, financial_direction_source,
             financial_direction_version, version, created_by, updated_by,
             created_at, updated_at
           ) VALUES (
             ?, ?, ?, 'main_business', 'engineering_consulting',
             'main_business', 'main', 'effective', ?, ?, 100000,
             'income', 'contract_category', 1, 1, ?, ?, ?, ?
           )`,
            parentContractId,
            `HTTP-P-${options.runId}-${sample.id}`,
            `HTTP 隔离上级合同 ${sample.id}`,
            area,
            parentContractId,
            actorId,
            actorId,
            parentNow,
            parentNow,
          );
          expectedContractIds.add(parentContractId);
        }
        const sourcePath = path.resolve(options.inputRoot, sample.relativePath);
        if (!sourcePath.startsWith(`${options.inputRoot}${path.sep}`)) {
          throw new Error(`样本路径越界：${sample.id}`);
        }
        const mimeType = mimeTypeFor(sourcePath);
        const bytes = await fs.promises.readFile(sourcePath);
        const form = new FormData();
        form.append(
          "file",
          new Blob([bytes], { type: mimeType }),
          `${sample.id}${path.extname(sourcePath).toLowerCase()}`,
        );
        form.append("area", area);
        form.append("declaredCategory", "main_business");
        form.append("declaredSubtype", "engineering_consulting");
        form.append("relationType", relationType);
        form.append("title", `HTTP 隔离回放 ${sample.id}`);
        if (parentContractId) form.append("parentContractId", parentContractId);
        const uploadResponse = await fetch(
          `${baseUrl}/api/contracts/recognize`,
          {
            method: "POST",
            headers: { Cookie: cookie },
            body: form,
          },
        );
        const uploadBody = (await uploadResponse.json()) as {
          success?: boolean;
          message?: string;
          data?: { contractId?: string; fileId?: string; jobId?: string };
        };
        if (uploadResponse.status !== 202 || !uploadBody.data?.jobId) {
          throw new Error(
            `HTTP 上传失败：${uploadResponse.status} ${uploadBody.message || ""}`,
          );
        }
        const contractId = String(uploadBody.data.contractId);
        const fileId = String(uploadBody.data.fileId);
        const jobId = String(uploadBody.data.jobId);
        expectedContractIds.add(contractId);
        stage10ContractIds.set(sample.id, contractId);
        const deadline = Date.now() + options.timeoutMs;
        let jobBody: OcrJobApiData | null = null;
        while (Date.now() < deadline) {
          const response = await fetch(
            `${baseUrl}/api/contracts/ocr-jobs/${jobId}`,
            {
              headers: { Cookie: cookie },
            },
          );
          const body = (await response.json()) as {
            data?: OcrJobApiData;
          };
          if (!response.ok || !body.data) {
            throw new Error(`识别任务回读失败：${response.status}`);
          }
          jobBody = body.data;
          if (["succeeded", "partial", "failed"].includes(jobBody.status))
            break;
          await delay(2000);
        }
        if (
          !jobBody ||
          !["succeeded", "partial", "failed"].includes(jobBody.status)
        ) {
          throw new Error(`识别任务等待超时：${sample.id}`);
        }
        const fieldsByCode = new Map(
          jobBody.fields.map((field) => [field.field, field.finalValue]),
        );
        for (const field of [
          "party_a",
          "party_b",
          "project_name",
          "amount",
          "contract_date",
        ] as const) {
          if (
            !valuesEqual(field, fieldsByCode.get(field), sample.expected[field])
          ) {
            errors.push(`${field} 与人工真值不一致`);
          }
        }
        if (jobBody.status !== "succeeded")
          errors.push(`任务状态为 ${jobBody.status}`);
        if (jobBody.fields.length !== 6)
          errors.push(`字段数量为 ${jobBody.fields.length}`);
        if (
          jobBody.fields.some(
            (field) =>
              !Number.isFinite(field.confidence) ||
              field.confidence < 0 ||
              field.confidence > 100 ||
              typeof field.source !== "string" ||
              field.source.length === 0 ||
              (field.pageNumber !== null &&
                (!Number.isInteger(field.pageNumber) || field.pageNumber < 1)),
          )
        ) {
          errors.push("字段评分、来源或页码结构不完整");
        }
        const manuallyConfirmedCount = jobBody.fields.filter(
          (field) => field.manuallyConfirmed,
        ).length;
        if (manuallyConfirmedCount !== 0) errors.push("存在人工确认字段");
        if (jobBody.contractVersion !== 2) {
          errors.push(`合同版本为 ${jobBody.contractVersion}`);
        }
        if (jobBody.ocrLines.length === 0) errors.push("没有保存逐行识别结果");
        if (
          jobBody.ocrLines.some(
            (line) =>
              !Number.isInteger(line.page) ||
              line.page < 1 ||
              typeof line.text !== "string" ||
              !isValidOcrBbox(line.bbox) ||
              !Number.isFinite(line.confidence) ||
              line.confidence < 0 ||
              line.confidence > 1 ||
              line.modelVersion !== "v6_medium",
          )
        ) {
          errors.push("逐行识别的文本、页码、坐标、置信度或模型版本不完整");
        }
        if (jobBody.engineVersion !== "v6_medium") {
          errors.push(`任务模型版本为 ${jobBody.engineVersion || "空"}`);
        }
        const databaseEvidence = await db.get<{
          file_hash: string;
          audit_count: number;
          party_a: string | null;
          party_b: string | null;
          project_name: string | null;
          amount_delta: number | null;
          contract_date: string | null;
          retry_count: number;
          error_message: string | null;
          file_count: number;
          job_count: number;
          field_count: number;
          line_count: number;
        }>(
          `SELECT file.file_hash,
           (SELECT COUNT(*)::int FROM contract_audit_logs audit
            WHERE audit.contract_id = contract.id AND audit.action = 'create') AS audit_count,
           (SELECT COUNT(*)::int FROM contract_files all_file
            WHERE all_file.contract_id = contract.id) AS file_count,
           (SELECT COUNT(*)::int FROM contract_ocr_jobs all_job
            WHERE all_job.contract_id = contract.id) AS job_count,
           (SELECT COUNT(*)::int FROM contract_ocr_fields all_field
            WHERE all_field.contract_id = contract.id) AS field_count,
           (SELECT COUNT(*)::int FROM contract_ocr_lines all_line
            WHERE all_line.contract_id = contract.id) AS line_count,
           contract.party_a, contract.party_b, contract.project_name,
           contract.amount_delta, contract.contract_date,
           job.retry_count, job.error_message
         FROM contracts contract
         JOIN contract_files file ON file.contract_id = contract.id
         JOIN contract_ocr_jobs job ON job.contract_id = contract.id
           AND job.file_id = file.id
         WHERE contract.id = ? AND file.id = ? AND job.id = ?`,
          contractId,
          fileId,
          jobId,
        );
        const sourceHashMatched = databaseEvidence?.file_hash === sample.sha256;
        if (!sourceHashMatched) errors.push("上传文件摘要与冻结样本不一致");
        const auditCreateCount = Number(databaseEvidence?.audit_count || 0);
        if (auditCreateCount !== 1)
          errors.push(`创建审计数量为 ${auditCreateCount}`);
        const mainTableValues: Record<string, unknown> = {
          party_a: databaseEvidence?.party_a,
          party_b: databaseEvidence?.party_b,
          project_name: databaseEvidence?.project_name,
          amount: databaseEvidence?.amount_delta,
          contract_date: databaseEvidence?.contract_date,
        };
        for (const field of [
          "party_a",
          "party_b",
          "project_name",
          "amount",
          "contract_date",
        ] as const) {
          if (
            !valuesEqual(field, mainTableValues[field], sample.expected[field])
          ) {
            errors.push(`${field} 合同主表与人工真值不一致`);
          }
        }

        const httpFlowDurationMs = Date.now() - sampleStartedAt;
        const httpFlowPeakMemoryBytes = memoryMonitor?.stop() || 0;
        if (stage10Enabled) {
          stage10ContractGraphFingerprints.set(
            sample.id,
            await contractGraphFingerprint(contractId),
          );
        }

        if (stage10Enabled) {
          const independentResult = await recognizeContractFile(
            sourcePath,
            mimeType,
            {
              expectedCategory: "main_business",
              relationType,
              ocrModel: "v6_medium",
            },
          );
          const amountStatus = getContractAmountStatus(independentResult);
          const amountBreakdown = getContractAmountBreakdown(independentResult);
          if (independentResult.modelVersion !== "v6_medium") {
            errors.push("独立金额状态复跑未使用冻结模型");
          }
          if (!amountStatus || !amountBreakdown) {
            errors.push("独立金额状态复跑没有形成状态或金额拆分");
          }
          const untouchedContractsAfter = await db.all<{
            id: string;
            version: number;
            updated_at: string;
          }>(
            `SELECT id, version, updated_at FROM contracts
           WHERE created_by <> ? ORDER BY id`,
            actorId,
          );
          const allContractIds = await db.all<{ id: string }>(
            "SELECT id FROM contracts ORDER BY id",
          );
          const actualContractIds = new Set(
            allContractIds.map((row) => row.id),
          );
          const contractSetMismatch =
            actualContractIds.size !== expectedContractIds.size ||
            [...actualContractIds].some((id) => !expectedContractIds.has(id));
          const contractGraphStructurallyValid = Boolean(
            databaseEvidence &&
            Number(databaseEvidence.file_count) === 1 &&
            Number(databaseEvidence.job_count) === 1 &&
            Number(databaseEvidence.field_count) === 6 &&
            Number(databaseEvidence.line_count) === jobBody.ocrLines.length &&
            Number(databaseEvidence.audit_count) === 1,
          );
          const dataPollutionDetected =
            stableDatabaseFingerprint(untouchedContractsAfter) !==
              untouchedContractsFingerprint ||
            contractSetMismatch ||
            !contractGraphStructurallyValid;
          if (dataPollutionDetected)
            errors.push("检测到隔离任务之外的合同数据变化");
          const ocrLinesValid =
            jobBody.ocrLines.length > 0 &&
            jobBody.ocrLines.every(
              (line) =>
                Number.isInteger(line.page) &&
                line.page >= 1 &&
                typeof line.text === "string" &&
                isValidOcrBbox(line.bbox) &&
                Number.isFinite(line.confidence) &&
                line.confidence >= 0 &&
                line.confidence <= 1 &&
                line.modelVersion === "v6_medium",
            );
          const finalValues = {
            party_a: fieldsByCode.get("party_a") ?? null,
            party_b: fieldsByCode.get("party_b") ?? null,
            project_name: fieldsByCode.get("project_name") ?? null,
            amount: fieldsByCode.get("amount") ?? null,
            contract_date: fieldsByCode.get("contract_date") ?? null,
          };
          const databaseValues = {
            party_a: databaseEvidence?.party_a ?? null,
            party_b: databaseEvidence?.party_b ?? null,
            project_name: databaseEvidence?.project_name ?? null,
            amount: databaseEvidence?.amount_delta ?? null,
            contract_date: databaseEvidence?.contract_date ?? null,
          };
          const databaseMatchesFinalValues = (
            [
              "party_a",
              "party_b",
              "project_name",
              "amount",
              "contract_date",
            ] as const
          ).every((field) =>
            valuesEqual(field, databaseValues[field], finalValues[field]),
          );
          const errorText = [
            databaseEvidence?.error_message || "",
            ...errors,
          ].join("\n");
          const oomDetected =
            /OOM|out of memory|memory exhausted|SIGKILL/iu.test(errorText);
          const transactionFailure =
            /事务失败|transaction.*(?:failed|aborted)|deadlock|serialization failure/iu.test(
              errorText,
            );
          const anomalyTypes = new Set<string>();
          if (!sourceHashMatched) anomalyTypes.add("source_hash_mismatch");
          if (!ocrLinesValid) anomalyTypes.add("ocr_result_not_persisted");
          if (jobBody.status !== "succeeded")
            anomalyTypes.add("automatic_adoption_failed");
          if (!databaseMatchesFinalValues)
            anomalyTypes.add("database_readback_mismatch");
          if (
            amountStatus !== sample.expected.amountStatus ||
            JSON.stringify(amountBreakdown) !==
              JSON.stringify(sample.expected.amountBreakdown)
          ) {
            anomalyTypes.add("amount_status_mismatch");
          }
          if (oomDetected) anomalyTypes.add("oom");
          if (transactionFailure)
            anomalyTypes.add("database_transaction_failure");
          if (dataPollutionDetected) anomalyTypes.add("data_pollution");
          for (const field of [
            "party_a",
            "party_b",
            "project_name",
            "amount",
            "contract_date",
          ] as const) {
            if (
              !valuesEqual(field, finalValues[field], sample.expected[field])
            ) {
              anomalyTypes.add(`field_mismatch:${field}`);
            }
          }
          const automaticallyAdopted = jobBody.status === "succeeded";
          stage10Results.push({
            sampleId: sample.id,
            familyId: sample.familyId!,
            sha256: sample.sha256,
            modelVersion: jobBody.engineVersion || "",
            automaticPolicyVersion: automaticPolicyVersion!,
            durationMs: httpFlowDurationMs,
            peakMemoryBytes: httpFlowPeakMemoryBytes,
            retryCount: Number(databaseEvidence?.retry_count || 0),
            ocrLineCount: jobBody.ocrLines.length,
            averageOcrConfidence:
              jobBody.ocrLines.length === 0
                ? null
                : jobBody.ocrLines.reduce(
                    (sum, line) => sum + line.confidence,
                    0,
                  ) / jobBody.ocrLines.length,
            amountStatus,
            amountBreakdown,
            finalValues,
            databaseValues,
            steps: {
              uploaded: sourceHashMatched,
              ocrCompleted:
                ["succeeded", "partial", "failed"].includes(jobBody.status) &&
                jobBody.engineVersion === "v6_medium",
              ocrResultSaved: ocrLinesValid,
              parsed: jobBody.fields.length === 6,
              riskValidated: ["succeeded", "partial", "failed"].includes(
                jobBody.status,
              ),
              automaticallyAdopted,
              databaseWritten:
                automaticallyAdopted &&
                jobBody.contractVersion === 2 &&
                databaseMatchesFinalValues,
              databaseReadBack:
                Boolean(databaseEvidence) && databaseMatchesFinalValues,
            },
            oomDetected,
            transactionFailure,
            dataPollutionDetected,
            anomalyTypes: [...anomalyTypes].sort(),
          });
        }
        results.push({
          id: sample.id,
          relationType,
          status: jobBody.status,
          groundTruthMatched: errors.every(
            (error) => !error.includes("人工真值"),
          ),
          fieldCount: jobBody.fields.length,
          ocrLineCount: jobBody.ocrLines.length,
          manuallyConfirmedCount,
          modelVersions: [
            ...new Set(jobBody.ocrLines.map((line) => line.modelVersion)),
          ],
          engineVersion: jobBody.engineVersion,
          contractVersion: jobBody.contractVersion,
          auditCreateCount,
          sourceHashMatched,
          durationMs: Date.now() - sampleStartedAt,
          errors,
        });
      } finally {
        memoryMonitor?.stop();
      }
    }
    if (stage10Enabled) {
      for (const evidence of stage10Results) {
        const contractId = stage10ContractIds.get(evidence.sampleId);
        const finalReadback = contractId
          ? await db.get<{
              party_a: string | null;
              party_b: string | null;
              project_name: string | null;
              amount_delta: number | null;
              contract_date: string | null;
            }>(
              `SELECT party_a, party_b, project_name, amount_delta, contract_date
               FROM contracts WHERE id = ?`,
              contractId,
            )
          : null;
        const stillMatches = Boolean(
          finalReadback &&
          valuesEqual(
            "party_a",
            finalReadback.party_a,
            evidence.databaseValues.party_a,
          ) &&
          valuesEqual(
            "party_b",
            finalReadback.party_b,
            evidence.databaseValues.party_b,
          ) &&
          valuesEqual(
            "project_name",
            finalReadback.project_name,
            evidence.databaseValues.project_name,
          ) &&
          valuesEqual(
            "amount",
            finalReadback.amount_delta,
            evidence.databaseValues.amount,
          ) &&
          valuesEqual(
            "contract_date",
            finalReadback.contract_date,
            evidence.databaseValues.contract_date,
          ),
        );
        const graphStillMatches = Boolean(
          contractId &&
          stage10ContractGraphFingerprints.get(evidence.sampleId) ===
            (await contractGraphFingerprint(contractId)),
        );
        if (!stillMatches || !graphStillMatches) {
          evidence.steps.databaseReadBack = false;
          evidence.dataPollutionDetected = true;
          evidence.anomalyTypes = [
            ...new Set([
              ...evidence.anomalyTypes,
              "cross_sample_database_pollution",
            ]),
          ].sort();
        }
      }
      const relatedContractRows = await db.all<{ contract_id: string }>(
        `SELECT contract_id FROM contract_files
         UNION ALL SELECT contract_id FROM contract_ocr_jobs
         UNION ALL SELECT contract_id FROM contract_ocr_fields
         UNION ALL SELECT contract_id FROM contract_ocr_lines
         UNION ALL SELECT contract_id FROM contract_audit_logs`,
      );
      const sampleContractIds = new Set(stage10ContractIds.values());
      if (
        relatedContractRows.some(
          (row) => !sampleContractIds.has(row.contract_id),
        )
      ) {
        for (const evidence of stage10Results) {
          evidence.dataPollutionDetected = true;
          evidence.anomalyTypes = [
            ...new Set([
              ...evidence.anomalyTypes,
              "contract_child_graph_pollution",
            ]),
          ].sort();
        }
      }
    }
    const failed = results.filter((result) => result.errors.length > 0);
    if (stage10Enabled) {
      if (stage10Results.length !== samples.length) {
        throw new Error("第十阶段端到端证据数量与请求样本数量不一致");
      }
      const stage10Report: ContractOcrStage10E2eReport = {
        schemaVersion: 2,
        freezeId: stage10Freeze!.freezeId,
        datasetVersion: stage10Freeze!.datasetVersion,
        ocrModel: "v6_medium",
        automaticPolicyVersion: automaticPolicyVersion!,
        amountStatusEvidence: "independent_live_replay",
        memoryMeasurement: "docker_cgroup_total",
        samples: stage10Results,
      };
      writePrivateImmutableJson(options.outputPath, stage10Report);
      console.log(
        JSON.stringify({
          total: stage10Results.length,
          fullFlowSucceeded: stage10Results.filter((sample) =>
            Object.values(sample.steps).every(Boolean),
          ).length,
          anomalies: stage10Results.filter(
            (sample) => sample.anomalyTypes.length > 0,
          ).length,
        }),
      );
      if (
        stage10Results.some(
          (sample) =>
            !Object.values(sample.steps).every(Boolean) ||
            sample.anomalyTypes.length > 0,
        )
      ) {
        process.exitCode = 1;
      }
      return;
    }
    const report = {
      schemaVersion: 1,
      runId: options.runId,
      databaseName: databaseIdentity.databaseName,
      databaseHost: databaseIdentity.databaseHost,
      groundTruthVersion: document.version,
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: {
        total: results.length,
        succeeded: results.length - failed.length,
        failed: failed.length,
        groundTruthMatched: results.filter(
          (result) => result.groundTruthMatched,
        ).length,
        manuallyConfirmedCount: results.reduce(
          (sum, result) => sum + result.manuallyConfirmedCount,
          0,
        ),
        ocrLineCount: results.reduce(
          (sum, result) => sum + result.ocrLineCount,
          0,
        ),
      },
      samples: results,
    };
    await fs.promises.mkdir(path.dirname(options.outputPath), {
      recursive: true,
    });
    await fs.promises.writeFile(
      options.outputPath,
      `${JSON.stringify(report, null, 2)}\n`,
      { flag: "wx" },
    );
    console.log(JSON.stringify(report.summary));
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
    shutdownOcrDaemon();
    await shutdownTesseractOcrDaemon();
    try {
      const uploadRows = await db.all<{ file_path: string }>(
        `SELECT file.file_path
         FROM contract_files file
         JOIN contracts contract ON contract.id = file.contract_id
         WHERE contract.created_by = ?`,
        actorId,
      );
      const uploadsRoot = `${path.resolve(process.cwd(), "uploads")}${path.sep}`;
      for (const row of uploadRows) {
        const absolutePath = path.resolve(process.cwd(), row.file_path);
        if (!absolutePath.startsWith(uploadsRoot)) {
          console.error("HTTP（超文本传输协议）回放上传文件路径越界，拒绝清理");
          process.exitCode = 1;
          continue;
        }
        await fs.promises.rm(absolutePath, { force: true });
      }
    } finally {
      await pool.end();
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
