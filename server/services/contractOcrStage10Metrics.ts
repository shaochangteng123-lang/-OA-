import fs from "node:fs";
import {
  CONTRACT_OCR_STAGE10_EXPECTED_COUNT,
  CONTRACT_OCR_STAGE10_MODEL,
  readContractOcrStage10GroundTruth,
  type ContractOcrStage10AmountBreakdown,
  type ContractOcrStage10AmountStatus,
  type ContractOcrStage10Freeze,
  type ContractOcrStage10GroundTruthSample,
} from "./contractOcrStage10Blind.js";

const FIELD_CODES = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
  "contract_date",
] as const;

type FieldCode = (typeof FIELD_CODES)[number];

export interface ContractOcrStage10E2eSampleEvidence {
  sampleId: string;
  familyId: string;
  sha256: string;
  modelVersion: string;
  automaticPolicyVersion: string;
  durationMs: number;
  peakMemoryBytes: number;
  retryCount: number;
  ocrLineCount: number;
  averageOcrConfidence: number | null;
  amountStatus: ContractOcrStage10AmountStatus | null;
  amountBreakdown: ContractOcrStage10AmountBreakdown | null;
  finalValues: Record<FieldCode, string | number | null>;
  databaseValues: Record<FieldCode, string | number | null>;
  steps: {
    uploaded: boolean;
    ocrCompleted: boolean;
    ocrResultSaved: boolean;
    parsed: boolean;
    riskValidated: boolean;
    automaticallyAdopted: boolean;
    databaseWritten: boolean;
    databaseReadBack: boolean;
  };
  oomDetected: boolean;
  transactionFailure: boolean;
  dataPollutionDetected: boolean;
  anomalyTypes: string[];
}

export interface ContractOcrStage10E2eReport {
  schemaVersion: 2;
  freezeId: string;
  datasetVersion: string;
  ocrModel: string;
  automaticPolicyVersion: string;
  /**
   * 金额状态未进入 API（应用程序编程接口）和数据库；该证据必须由同一原文件
   * 使用冻结模型、冻结规则另行实时复跑取得，不能伪装成 HTTP（超文本传输协议）事务回读字段。
   */
  amountStatusEvidence: "independent_live_replay";
  /** 只接受 Docker（容器平台）控制组整体内存，不接受 Node.js（运行时）单进程内存。 */
  memoryMeasurement: "docker_cgroup_total";
  samples: ContractOcrStage10E2eSampleEvidence[];
}

interface AccuracyMetric {
  correct: number;
  total: number;
  accuracy: number | null;
}

export interface ContractOcrStage10MetricsSummary {
  schemaVersion: 1;
  generatedAt: string;
  freeze: {
    freezeId: string;
    datasetVersion: string;
    ocrModel: string;
    paddleOcrVersion: string;
    rulesVersion: string;
    automaticPolicyVersion: string;
    implementationDigest: string;
    evaluationDigest: string;
  };
  validation: {
    expectedSamples: 100;
    actualSamples: number;
    uniqueSamples: number;
    uniqueFamilies: number;
    fullFlowEvidenceComplete: boolean;
    memoryEvidenceComplete: boolean;
  };
  fieldAccuracy: Record<FieldCode, AccuracyMetric>;
  amountStatusAccuracy: Record<ContractOcrStage10AmountStatus, AccuracyMetric>;
  amountBreakdownAccuracy: {
    calculatedAmount: AccuracyMetric;
  };
  system: {
    automaticAdoption: AccuracyMetric;
    automaticDatabaseWrite: AccuracyMetric;
    databaseReadbackConsistency: AccuracyMetric;
    failureRate: number;
    failedDocuments: number;
    oomCount: number;
    transactionFailureCount: number;
    dataPollutionCount: number;
    anomalyTypes: Record<string, number>;
  };
  performance: {
    durationMs: {
      average: number;
      p95: number;
      maximum: number;
    };
    peakMemoryBytes: {
      measurement: string[];
      maximum: number;
    };
    ocrRetryCount: {
      total: number;
      maximumPerDocument: number;
      documentsRetried: number;
    };
  };
  productionGate: {
    confirmedAmountAccuracyAtLeast99: boolean;
    calculatedAmountAccuracyAtLeast95: boolean;
    projectNameCompletenessAtLeast95: boolean;
    automaticDatabaseWriteAtLeast98: boolean;
    noOom: boolean;
    noTransactionFailure: boolean;
    noDataPollution: boolean;
    evidenceComplete: boolean;
    ready: boolean;
    blockers: string[];
  };
  privacy: {
    aggregatedOnly: true;
    includesDocumentPaths: false;
    includesDocumentDigests: false;
    includesFieldValues: false;
  };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  return value as Record<string, unknown>;
}

function readE2eReport(filePath: string): ContractOcrStage10E2eReport {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("第十阶段端到端证据不是合法 JSON（JavaScript 对象表示法）");
  }
  const report = asObject(value, "第十阶段端到端证据");
  if (report.schemaVersion !== 2 || !Array.isArray(report.samples)) {
    throw new Error("第十阶段端到端证据结构版本必须为 2 且包含样本数组");
  }
  return report as unknown as ContractOcrStage10E2eReport;
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).normalize("NFKC").trim();
  return normalized || null;
}

function equalField(
  field: FieldCode,
  actual: unknown,
  expected: unknown,
): boolean {
  const left = normalizeText(actual);
  const right = normalizeText(expected);
  if (left === null || right === null) return left === right;
  if (field === "amount") {
    const leftNumber = Number(left.replace(/,/gu, ""));
    const rightNumber = Number(right.replace(/,/gu, ""));
    return (
      Number.isFinite(leftNumber) &&
      Number.isFinite(rightNumber) &&
      Math.round(leftNumber * 100) === Math.round(rightNumber * 100)
    );
  }
  if (["party_a", "party_b", "project_name"].includes(field)) {
    return left.replace(/\s+/gu, "") === right.replace(/\s+/gu, "");
  }
  return left === right;
}

function equalNullableAmount(
  left: number | null,
  right: number | null,
): boolean {
  if (left === null || right === null) return left === right;
  return Math.round(left * 100) === Math.round(right * 100);
}

function equalBreakdown(
  actual: ContractOcrStage10AmountBreakdown | null,
  expected: ContractOcrStage10AmountBreakdown,
): boolean {
  return Boolean(
    actual &&
    equalNullableAmount(actual.originalAmount, expected.originalAmount) &&
    equalNullableAmount(actual.changeAmount, expected.changeAmount) &&
    equalNullableAmount(actual.finalAmount, expected.finalAmount),
  );
}

function metric(correct: number, total: number): AccuracyMetric {
  return {
    correct,
    total,
    accuracy: total === 0 ? null : Math.round((correct / total) * 10000) / 100,
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function validateEvidence(
  evidence: ContractOcrStage10E2eSampleEvidence,
  truth: ContractOcrStage10GroundTruthSample,
  freeze: ContractOcrStage10Freeze,
): void {
  if (
    evidence.sampleId !== truth.id ||
    evidence.familyId !== truth.familyId ||
    evidence.sha256 !== truth.sha256
  ) {
    throw new Error("端到端证据样本身份与冻结真值不一致");
  }
  if (
    evidence.modelVersion !== CONTRACT_OCR_STAGE10_MODEL ||
    evidence.modelVersion !== freeze.versions.ocrModel
  ) {
    throw new Error(`${truth.id} 的端到端识别模型不是冻结模型`);
  }
  if (
    evidence.automaticPolicyVersion !== freeze.versions.automaticPolicyVersion
  ) {
    throw new Error(`${truth.id} 的自动采用策略不是冻结版本`);
  }
  for (const [label, value] of [
    ["耗时", evidence.durationMs],
    ["峰值内存", evidence.peakMemoryBytes],
    ["重试次数", evidence.retryCount],
    ["识别行数", evidence.ocrLineCount],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${truth.id} 的${label}不是有效非负数`);
    }
  }
  if (evidence.peakMemoryBytes <= 0) {
    throw new Error(`${truth.id} 缺少 Docker（容器平台）控制组整体峰值内存`);
  }
  if (
    !Number.isInteger(evidence.retryCount) ||
    !Number.isInteger(evidence.ocrLineCount)
  ) {
    throw new Error(`${truth.id} 的重试次数或识别行数必须是整数`);
  }
  if (
    evidence.averageOcrConfidence !== null &&
    (!Number.isFinite(evidence.averageOcrConfidence) ||
      evidence.averageOcrConfidence < 0 ||
      evidence.averageOcrConfidence > 1)
  ) {
    throw new Error(`${truth.id} 的平均 OCR（光学字符识别）置信度无效`);
  }
  const steps = asObject(evidence.steps, `${truth.id} 的端到端步骤`);
  for (const step of [
    "uploaded",
    "ocrCompleted",
    "ocrResultSaved",
    "parsed",
    "riskValidated",
    "automaticallyAdopted",
    "databaseWritten",
    "databaseReadBack",
  ]) {
    if (typeof steps[step] !== "boolean") {
      throw new Error(`${truth.id} 的端到端步骤 ${step} 缺少布尔证据`);
    }
  }
  asObject(evidence.finalValues, `${truth.id} 的最终字段`);
  asObject(evidence.databaseValues, `${truth.id} 的数据库回读字段`);
  if (!Array.isArray(evidence.anomalyTypes)) {
    throw new Error(`${truth.id} 的异常类型必须是数组`);
  }
  for (const [label, value] of [
    ["OOM（内存耗尽）标记", evidence.oomDetected],
    ["数据库事务失败标记", evidence.transactionFailure],
    ["数据污染标记", evidence.dataPollutionDetected],
  ] as const) {
    if (typeof value !== "boolean") {
      throw new Error(`${truth.id} 的${label}必须是布尔值`);
    }
  }
}

function allFlowStepsPassed(
  sample: ContractOcrStage10E2eSampleEvidence,
): boolean {
  return Object.values(sample.steps).every(Boolean);
}

export function summarizeContractOcrStage10Metrics(options: {
  freeze: ContractOcrStage10Freeze;
  groundTruthPath: string;
  e2eReportPaths: string[];
  generatedAt?: string;
}): ContractOcrStage10MetricsSummary {
  if (options.e2eReportPaths.length === 0) {
    throw new Error("至少需要一个第十阶段端到端证据分片");
  }
  const groundTruth = readContractOcrStage10GroundTruth(
    options.groundTruthPath,
  );
  if (groundTruth.datasetVersion !== options.freeze.datasetVersion) {
    throw new Error("端到端指标真值版本与冻结版本不一致");
  }
  const reports = options.e2eReportPaths.map(readE2eReport);
  for (const report of reports) {
    if (
      report.freezeId !== options.freeze.freezeId ||
      report.datasetVersion !== options.freeze.datasetVersion ||
      report.ocrModel !== options.freeze.versions.ocrModel ||
      report.automaticPolicyVersion !==
        options.freeze.versions.automaticPolicyVersion ||
      report.amountStatusEvidence !== "independent_live_replay" ||
      report.memoryMeasurement !== "docker_cgroup_total"
    ) {
      throw new Error(
        "端到端证据分片与冻结版本、独立金额状态复跑或容器整体内存口径不一致",
      );
    }
  }
  const evidenceSamples = reports.flatMap((report) => report.samples);
  if (evidenceSamples.length !== CONTRACT_OCR_STAGE10_EXPECTED_COUNT) {
    throw new Error(
      `第十阶段端到端证据必须恰好包含 100 份，实际为 ${evidenceSamples.length} 份`,
    );
  }
  const evidenceById = new Map(
    evidenceSamples.map((sample) => [sample.sampleId, sample]),
  );
  if (evidenceById.size !== evidenceSamples.length) {
    throw new Error("第十阶段端到端证据包含重复样本");
  }
  const truthById = new Map(
    groundTruth.samples.map((sample) => [sample.id, sample]),
  );
  if (truthById.size !== CONTRACT_OCR_STAGE10_EXPECTED_COUNT) {
    throw new Error("第十阶段真值不是 100 个唯一样本");
  }

  const fieldCorrect = Object.fromEntries(
    FIELD_CODES.map((field) => [field, 0]),
  ) as Record<FieldCode, number>;
  const statusCorrect = {
    confirmed_amount: 0,
    calculated_amount: 0,
    payment_only: 0,
    missing_amount: 0,
  } satisfies Record<ContractOcrStage10AmountStatus, number>;
  const statusTotal = { ...statusCorrect };
  let calculatedBreakdownCorrect = 0;
  let calculatedBreakdownTotal = 0;
  let automaticAdopted = 0;
  let automaticDatabaseWrite = 0;
  let databaseReadbackConsistency = 0;
  let failedDocuments = 0;
  let oomCount = 0;
  let transactionFailureCount = 0;
  let dataPollutionCount = 0;
  let nonEmptyProjectCorrect = 0;
  let nonEmptyProjectTotal = 0;
  const anomalyTypes: Record<string, number> = {};

  for (const truth of groundTruth.samples) {
    const evidence = evidenceById.get(truth.id);
    if (!evidence) throw new Error(`缺少 ${truth.id} 的端到端证据`);
    validateEvidence(evidence, truth, options.freeze);
    for (const field of FIELD_CODES) {
      if (
        equalField(field, evidence.finalValues[field], truth.expected[field])
      ) {
        fieldCorrect[field] += 1;
      }
    }
    if (truth.expected.project_name !== null) {
      nonEmptyProjectTotal += 1;
      if (
        equalField(
          "project_name",
          evidence.finalValues.project_name,
          truth.expected.project_name,
        )
      ) {
        nonEmptyProjectCorrect += 1;
      }
    }
    const expectedStatus = truth.expected.amountStatus;
    statusTotal[expectedStatus] += 1;
    const finalAmountMatched = equalField(
      "amount",
      evidence.finalValues.amount,
      truth.expected.amount,
    );
    const databaseAmountMatched = equalField(
      "amount",
      evidence.databaseValues.amount,
      truth.expected.amount,
    );
    const amountBreakdownMatched = equalBreakdown(
      evidence.amountBreakdown,
      truth.expected.amountBreakdown,
    );
    const statusSemanticsMatched =
      evidence.amountStatus === expectedStatus &&
      finalAmountMatched &&
      databaseAmountMatched &&
      (expectedStatus !== "calculated_amount" || amountBreakdownMatched);
    if (statusSemanticsMatched) {
      statusCorrect[expectedStatus] += 1;
    }
    if (expectedStatus === "calculated_amount") {
      calculatedBreakdownTotal += 1;
      if (
        amountBreakdownMatched &&
        finalAmountMatched &&
        databaseAmountMatched
      ) {
        calculatedBreakdownCorrect += 1;
      }
    }
    if (evidence.steps.automaticallyAdopted) automaticAdopted += 1;
    const readbackMatches = FIELD_CODES.every((field) =>
      equalField(field, evidence.databaseValues[field], truth.expected[field]),
    );
    if (
      evidence.steps.databaseWritten &&
      evidence.steps.databaseReadBack &&
      readbackMatches
    ) {
      automaticDatabaseWrite += 1;
    }
    if (evidence.steps.databaseReadBack && readbackMatches) {
      databaseReadbackConsistency += 1;
    }
    if (
      !allFlowStepsPassed(evidence) ||
      evidence.anomalyTypes.length > 0 ||
      evidence.oomDetected ||
      evidence.transactionFailure ||
      evidence.dataPollutionDetected
    ) {
      failedDocuments += 1;
    }
    if (evidence.oomDetected) oomCount += 1;
    if (evidence.transactionFailure) transactionFailureCount += 1;
    if (evidence.dataPollutionDetected) dataPollutionCount += 1;
    for (const anomaly of new Set(evidence.anomalyTypes)) {
      anomalyTypes[anomaly] = (anomalyTypes[anomaly] || 0) + 1;
    }
  }

  const total = evidenceSamples.length;
  const durationValues = evidenceSamples.map((sample) => sample.durationMs);
  const memoryValues = evidenceSamples.map((sample) => sample.peakMemoryBytes);
  const retryValues = evidenceSamples.map((sample) => sample.retryCount);
  const fullFlowEvidenceComplete = evidenceSamples.every((sample) =>
    [
      "uploaded",
      "ocrCompleted",
      "ocrResultSaved",
      "parsed",
      "riskValidated",
      "databaseReadBack",
    ].every((step) => sample.steps[step as keyof typeof sample.steps] === true),
  );
  const memoryEvidenceComplete = memoryValues.every((value) => value > 0);
  const confirmedAccuracy = metric(
    statusCorrect.confirmed_amount,
    statusTotal.confirmed_amount,
  );
  const calculatedAccuracy = metric(
    statusCorrect.calculated_amount,
    statusTotal.calculated_amount,
  );
  const projectAccuracy = metric(nonEmptyProjectCorrect, nonEmptyProjectTotal);
  const writeAccuracy = metric(automaticDatabaseWrite, total);
  const evidenceComplete =
    fullFlowEvidenceComplete &&
    memoryEvidenceComplete &&
    evidenceSamples.length === CONTRACT_OCR_STAGE10_EXPECTED_COUNT;
  const gates = {
    confirmedAmountAccuracyAtLeast99:
      confirmedAccuracy.accuracy !== null && confirmedAccuracy.accuracy >= 99,
    calculatedAmountAccuracyAtLeast95:
      calculatedAccuracy.accuracy !== null && calculatedAccuracy.accuracy >= 95,
    projectNameCompletenessAtLeast95:
      projectAccuracy.accuracy !== null && projectAccuracy.accuracy >= 95,
    automaticDatabaseWriteAtLeast98:
      writeAccuracy.accuracy !== null && writeAccuracy.accuracy >= 98,
    noOom: oomCount === 0,
    noTransactionFailure: transactionFailureCount === 0,
    noDataPollution: dataPollutionCount === 0,
    evidenceComplete,
  };
  const blockers: string[] = [];
  if (!gates.confirmedAmountAccuracyAtLeast99)
    blockers.push("confirmed_amount（已确认金额）准确率低于 99%");
  if (!gates.calculatedAmountAccuracyAtLeast95)
    blockers.push("calculated_amount（计算金额）准确率低于 95%");
  if (!gates.projectNameCompletenessAtLeast95)
    blockers.push("项目名称完整率低于 95%");
  if (!gates.automaticDatabaseWriteAtLeast98)
    blockers.push("自动落库成功率低于 98%");
  if (!gates.noOom) blockers.push("测试期间发生 OOM（内存耗尽）");
  if (!gates.noTransactionFailure) blockers.push("测试期间发生数据库事务失败");
  if (!gates.noDataPollution) blockers.push("测试期间检测到数据污染");
  if (!gates.evidenceComplete)
    blockers.push("100 份完整流程或峰值内存证据不完整");

  const memoryMeasurements = [
    ...new Set(reports.map((report) => report.memoryMeasurement)),
  ].sort();
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    freeze: {
      freezeId: options.freeze.freezeId,
      datasetVersion: options.freeze.datasetVersion,
      ocrModel: options.freeze.versions.ocrModel,
      paddleOcrVersion: options.freeze.versions.paddleOcrVersion,
      rulesVersion: options.freeze.versions.rulesVersion,
      automaticPolicyVersion: options.freeze.versions.automaticPolicyVersion,
      implementationDigest: options.freeze.versions.implementationDigest,
      evaluationDigest: options.freeze.versions.evaluationDigest,
    },
    validation: {
      expectedSamples: CONTRACT_OCR_STAGE10_EXPECTED_COUNT,
      actualSamples: total,
      uniqueSamples: evidenceById.size,
      uniqueFamilies: new Set(evidenceSamples.map((sample) => sample.familyId))
        .size,
      fullFlowEvidenceComplete,
      memoryEvidenceComplete,
    },
    fieldAccuracy: Object.fromEntries(
      FIELD_CODES.map((field) => [field, metric(fieldCorrect[field], total)]),
    ) as Record<FieldCode, AccuracyMetric>,
    amountStatusAccuracy: {
      confirmed_amount: confirmedAccuracy,
      calculated_amount: calculatedAccuracy,
      payment_only: metric(
        statusCorrect.payment_only,
        statusTotal.payment_only,
      ),
      missing_amount: metric(
        statusCorrect.missing_amount,
        statusTotal.missing_amount,
      ),
    },
    amountBreakdownAccuracy: {
      calculatedAmount: metric(
        calculatedBreakdownCorrect,
        calculatedBreakdownTotal,
      ),
    },
    system: {
      automaticAdoption: metric(automaticAdopted, total),
      automaticDatabaseWrite: writeAccuracy,
      databaseReadbackConsistency: metric(databaseReadbackConsistency, total),
      failureRate: Math.round((failedDocuments / total) * 10000) / 100,
      failedDocuments,
      oomCount,
      transactionFailureCount,
      dataPollutionCount,
      anomalyTypes: Object.fromEntries(
        Object.entries(anomalyTypes).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    },
    performance: {
      durationMs: {
        average:
          Math.round(
            (durationValues.reduce((sum, value) => sum + value, 0) / total) *
              100,
          ) / 100,
        p95: percentile(durationValues, 0.95),
        maximum: Math.max(...durationValues),
      },
      peakMemoryBytes: {
        measurement: memoryMeasurements,
        maximum: Math.max(...memoryValues),
      },
      ocrRetryCount: {
        total: retryValues.reduce((sum, value) => sum + value, 0),
        maximumPerDocument: Math.max(...retryValues),
        documentsRetried: retryValues.filter((value) => value > 0).length,
      },
    },
    productionGate: {
      ...gates,
      ready: Object.values(gates).every(Boolean),
      blockers,
    },
    privacy: {
      aggregatedOnly: true,
      includesDocumentPaths: false,
      includesDocumentDigests: false,
      includesFieldValues: false,
    },
  };
}
