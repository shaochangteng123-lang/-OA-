import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getContractAmountAutomaticAdoptionContext,
  getContractOcrAutomaticAdoptionSafetyContext,
  getContractOcrCandidateFunnelTrace,
  parseContractText,
  type ContractOcrCandidateFunnelTrace,
  type ContractRawOcrLine,
  type ParseContractTextOptions,
} from "../services/contractOcr.js";
import {
  diagnoseContractOcrCandidateFunnel,
  type ContractOcrFieldFunnelDiagnostic,
  type ContractOcrFunnelGroundTruth,
} from "../services/contractOcrCandidateFunnel.js";
import { decideContractAutomaticOcrAdoption } from "../services/contractService.js";

const LOCKED_BASELINE_SHA256 =
  "0a1bbeda30cced90ab916634869bc4bf5b4bd4198a9ae0f5c73061b34be303b2";
const LOCKED_GROUND_TRUTH_SHA256 =
  "695e950c47a4932eb119c9d9520633d5f92930d58da156c01e4472ffa8b20451";
const LOCKED_SAMPLE_COUNT = 12;

type RelationType = "main" | "supplement" | "termination";
type DeclaredCategory = "main_business" | "non_main" | "asset";

interface GroundTruthSample {
  id: string;
  familyId: string;
  relationType: RelationType;
  declaredCategory?: DeclaredCategory;
  relativePath: string;
  sha256: string;
  expected: ContractOcrFunnelGroundTruth;
}

interface GroundTruthDocument {
  samples: GroundTruthSample[];
}

interface BaselineRecord {
  recordType: string;
  sample?: {
    id: string;
    familyId: string;
    relationType: RelationType;
    declaredCategory: DeclaredCategory;
  };
  recognition?: {
    rawText: string;
    ocrLines: ContractRawOcrLine[];
    modelVersion: string | null;
  };
  fieldDiagnostics?: ContractOcrFieldFunnelDiagnostic[];
}

type SourceInput = NonNullable<ParseContractTextOptions["sources"]>[number];

interface EvaluatedSample {
  ordinal: number;
  relationType: RelationType;
  diagnostics: ContractOcrFieldFunnelDiagnostic[];
  trace: ContractOcrCandidateFunnelTrace;
  automaticAccepted: boolean;
}

interface CoverageMetric {
  eligible: number;
  generated: number;
  retained: number;
  coverageRate: number;
  retainedCoverageRate: number;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256File(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function readJsonLines(filePath: string): BaselineRecord[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BaselineRecord);
}

function declaredCategory(sample: GroundTruthSample): DeclaredCategory {
  if (sample.declaredCategory) return sample.declaredCategory;
  const folder = sample.relativePath.split(/[\\/]/u)[0];
  if (folder === "项目合同") return "main_business";
  if (folder === "资产类合同") return "asset";
  if (
    folder === "非主营项目合同" ||
    folder === "租房合同" ||
    folder === "网费" ||
    folder === "车位费"
  ) {
    return "non_main";
  }
  throw new Error("冻结样本无法推导声明分类");
}

function confidenceQueues(
  lines: readonly ContractRawOcrLine[],
): Map<string, number[]> {
  const queues = new Map<string, number[]>();
  for (const line of lines) {
    const key = `${line.page}\u0000${line.text.normalize("NFKC").trim()}`;
    const values = queues.get(key) || [];
    values.push(line.confidence);
    queues.set(key, values);
  }
  return queues;
}

function frozenSources(
  rawText: string,
  ocrLines: readonly ContractRawOcrLine[],
): SourceInput[] {
  const queues = confidenceQueues(ocrLines);
  const sources: SourceInput[] = [];
  let current:
    | {
        pageNumber: number;
        source: SourceInput["source"];
        recognitionEngine: string;
        lines: string[];
      }
    | undefined;
  const flush = () => {
    if (!current) return;
    const lineConfidences = current.lines.map((line) => {
      const key = `${current?.pageNumber}\u0000${line.normalize("NFKC").trim()}`;
      const queue = queues.get(key);
      return queue?.shift() ?? 0.99;
    });
    const confidence =
      lineConfidences.length > 0
        ? lineConfidences.reduce((sum, value) => sum + value, 0) /
          lineConfidences.length
        : 0.99;
    sources.push({
      text: current.lines.join("\n"),
      source: current.source,
      pageNumber: current.pageNumber,
      recognitionEngine: current.recognitionEngine,
      confidence,
      lineConfidences,
    });
  };

  for (const line of rawText.split("\n")) {
    const header = line.match(/^【第(\d+)页\/([^/]+)\/([^】]+)】$/u);
    if (header) {
      flush();
      if (!/^ocr_(?:300|480)(?:_enhanced)?$/u.test(header[2])) {
        throw new Error("冻结诊断包含未批准的识别来源");
      }
      current = {
        pageNumber: Number(header[1]),
        source: header[2] as SourceInput["source"],
        recognitionEngine: header[3],
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  if (sources.length === 0) throw new Error("冻结诊断没有可复用文字来源");
  return sources;
}

function metric(
  samples: readonly EvaluatedSample[],
  field: ContractOcrFieldFunnelDiagnostic["field"],
  include: (sample: EvaluatedSample) => boolean,
): CoverageMetric {
  const diagnostics = samples
    .filter(include)
    .map((sample) =>
      sample.diagnostics.find((diagnostic) => diagnostic.field === field),
    )
    .filter((diagnostic): diagnostic is ContractOcrFieldFunnelDiagnostic =>
      Boolean(diagnostic && !diagnostic.expectedIsNull),
    );
  const generated = diagnostics.filter(
    (diagnostic) => diagnostic.matchingGeneratedCandidateIds.length > 0,
  ).length;
  const retained = diagnostics.filter(
    (diagnostic) => diagnostic.matchingRetainedCandidateIds.length > 0,
  ).length;
  return {
    eligible: diagnostics.length,
    generated,
    retained,
    coverageRate: diagnostics.length ? generated / diagnostics.length : 0,
    retainedCoverageRate: diagnostics.length
      ? retained / diagnostics.length
      : 0,
  };
}

function baselineMetric(
  records: readonly BaselineRecord[],
  field: ContractOcrFieldFunnelDiagnostic["field"],
  include: (record: BaselineRecord) => boolean,
): CoverageMetric {
  const diagnostics = records
    .filter(
      (record) => record.recordType === "sample_diagnostic" && include(record),
    )
    .map((record) =>
      record.fieldDiagnostics?.find((diagnostic) => diagnostic.field === field),
    )
    .filter((diagnostic): diagnostic is ContractOcrFieldFunnelDiagnostic =>
      Boolean(diagnostic && !diagnostic.expectedIsNull),
    );
  const generated = diagnostics.filter(
    (diagnostic) => diagnostic.matchingGeneratedCandidateIds.length > 0,
  ).length;
  const retained = diagnostics.filter(
    (diagnostic) => diagnostic.matchingRetainedCandidateIds.length > 0,
  ).length;
  return {
    eligible: diagnostics.length,
    generated,
    retained,
    coverageRate: diagnostics.length ? generated / diagnostics.length : 0,
    retainedCoverageRate: diagnostics.length
      ? retained / diagnostics.length
      : 0,
  };
}

function percentile(
  values: readonly number[],
  percentileValue: number,
): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentileValue * sorted.length) - 1];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function metricRow(
  label: string,
  before: CoverageMetric,
  after: CoverageMetric,
): string {
  const uplift = after.coverageRate - before.coverageRate;
  return `| ${label} | ${before.generated}/${before.eligible}（${percent(before.coverageRate)}） | ${after.generated}/${after.eligible}（${percent(after.coverageRate)}） | ${uplift >= 0 ? "+" : ""}${(uplift * 100).toFixed(1)} 个百分点 | ${after.retained}/${after.eligible}（${percent(after.retainedCoverageRate)}） |`;
}

async function main(): Promise<void> {
  const baselinePath = path.resolve(
    optionValue("--baseline") ||
      "debug/contract-ocr-stage11-private/company-12-stage11-a-20260810.jsonl",
  );
  const groundTruthPath = path.resolve(
    optionValue("--ground-truth") ||
      "debug/contract-ocr-stage10-private/company-preliminary-2026-08-10/qualified-ground-truth.json",
  );
  const outputPath = path.resolve(
    optionValue("--output") ||
      "debug/合同OCR第十二阶段候选覆盖率诊断报告-2026-08-10.md",
  );
  if (sha256File(baselinePath) !== LOCKED_BASELINE_SHA256) {
    throw new Error("第十一阶段A冻结诊断摘要不匹配");
  }
  if (sha256File(groundTruthPath) !== LOCKED_GROUND_TRUTH_SHA256) {
    throw new Error("冻结人工真值摘要不匹配");
  }
  if (fs.existsSync(outputPath)) throw new Error("输出报告已存在，禁止覆盖");

  const baseline = readJsonLines(baselinePath);
  const baselineSamples = baseline.filter(
    (record) => record.recordType === "sample_diagnostic",
  );
  const truth = JSON.parse(
    fs.readFileSync(groundTruthPath, "utf8"),
  ) as GroundTruthDocument;
  if (
    baselineSamples.length !== LOCKED_SAMPLE_COUNT ||
    truth.samples.length !== LOCKED_SAMPLE_COUNT ||
    new Set(truth.samples.map((sample) => sample.familyId)).size !==
      LOCKED_SAMPLE_COUNT
  ) {
    throw new Error("冻结诊断集不是12份独立合同族");
  }
  const truthById = new Map(truth.samples.map((sample) => [sample.id, sample]));
  const evaluated: EvaluatedSample[] = [];

  for (const [sampleIndex, baselineRecord] of baselineSamples.entries()) {
    if (!baselineRecord.sample || !baselineRecord.recognition) {
      throw new Error("冻结诊断样本缺少来源或识别结果");
    }
    const sample = truthById.get(baselineRecord.sample.id);
    if (
      !sample ||
      sample.familyId !== baselineRecord.sample.familyId ||
      sample.relationType !== baselineRecord.sample.relationType ||
      declaredCategory(sample) !== baselineRecord.sample.declaredCategory ||
      baselineRecord.recognition.modelVersion !== "v6_medium"
    ) {
      throw new Error("冻结诊断样本、合同族、层级、分类或模型不一致");
    }
    const result = parseContractText("", {
      sources: frozenSources(
        baselineRecord.recognition.rawText,
        baselineRecord.recognition.ocrLines,
      ),
      relationType: sample.relationType,
      expectedCategory: declaredCategory(sample),
      candidateFunnelDiagnostics: true,
    });
    result.rawText = baselineRecord.recognition.rawText;
    result.ocrLines = baselineRecord.recognition.ocrLines;
    result.modelVersion = "v6_medium";
    const trace = getContractOcrCandidateFunnelTrace(result);
    if (!trace) throw new Error("重解析没有形成候选漏斗");
    const decision = decideContractAutomaticOcrAdoption({
      resultStatus: result.status,
      failureKind: result.failureKind,
      relationType: sample.relationType,
      declaredCategory: declaredCategory(sample),
      rawText: result.rawText,
      fields: result.fields,
      amountContext: getContractAmountAutomaticAdoptionContext(result),
      safetyContext: getContractOcrAutomaticAdoptionSafetyContext(result),
    });
    evaluated.push({
      ordinal: sampleIndex + 1,
      relationType: sample.relationType,
      diagnostics: diagnoseContractOcrCandidateFunnel(
        result,
        trace,
        sample.expected,
        decision,
      ),
      trace,
      automaticAccepted: decision.accepted,
    });
  }

  const mainRelation = (relationType: RelationType) => relationType === "main";
  const relatedRelation = (relationType: RelationType) =>
    relationType === "supplement" || relationType === "termination";
  const before = {
    project: baselineMetric(baseline, "project_name", () => true),
    mainAmount: baselineMetric(baseline, "amount", (record) =>
      mainRelation(record.sample!.relationType),
    ),
    relatedAmount: baselineMetric(baseline, "amount", (record) =>
      relatedRelation(record.sample!.relationType),
    ),
    date: baselineMetric(baseline, "contract_date", () => true),
  };
  const after = {
    project: metric(evaluated, "project_name", () => true),
    mainAmount: metric(evaluated, "amount", (sample) =>
      mainRelation(sample.relationType),
    ),
    relatedAmount: metric(evaluated, "amount", (sample) =>
      relatedRelation(sample.relationType),
    ),
    date: metric(evaluated, "contract_date", () => true),
  };
  const dateNullSamples = evaluated.filter((sample) =>
    sample.diagnostics.some(
      (diagnostic) =>
        diagnostic.field === "contract_date" && diagnostic.expectedIsNull,
    ),
  );
  const dateNullContaminated = dateNullSamples.filter((sample) =>
    sample.trace.generatedCandidates.some(
      (candidate) => candidate.field === "contract_date",
    ),
  ).length;
  const incorrectAutomaticAdoption = evaluated.filter(
    (sample) =>
      sample.automaticAccepted &&
      sample.diagnostics.some(
        (diagnostic) => !diagnostic.automaticDecisionValueMatchesExpected,
      ),
  ).length;
  const candidateCounts = {
    project: evaluated.map(
      (sample) =>
        new Set(
          sample.trace.generatedCandidates
            .filter((candidate) => candidate.field === "project_name")
            .map((candidate) => candidate.normalizedValue),
        ).size,
    ),
    amount: evaluated.map(
      (sample) =>
        new Set(
          sample.trace.generatedCandidates
            .filter((candidate) => candidate.field === "amount")
            .map((candidate) => candidate.normalizedValue),
        ).size,
    ),
    date: evaluated.map(
      (sample) =>
        new Set(
          sample.trace.generatedCandidates
            .filter((candidate) => candidate.field === "contract_date")
            .map((candidate) => candidate.normalizedValue),
        ).size,
    ),
  };

  const report = [
    "# 合同 OCR 第十二阶段候选覆盖率诊断报告",
    "",
    "## 结论",
    "",
    "本报告复用第十一阶段A冻结的12份公司合同 OCR（光学字符识别）原文、页码和模型结果，只重新执行当前候选生成与既有排序／门禁。输入为12份独立合同族；该集合仅用于诊断，不作为最终盲测。",
    "",
    "## 候选覆盖率",
    "",
    "| 字段 | 修复前正确候选覆盖 | 修复后正确候选覆盖 | 提升 | 修复后过滤保留覆盖 |",
    "|---|---:|---:|---:|---:|",
    metricRow("项目名称", before.project, after.project),
    metricRow("主合同明确金额", before.mainAmount, after.mainAmount),
    metricRow("补充协议本次金额", before.relatedAmount, after.relatedAmount),
    metricRow("签署日期", before.date, after.date),
    "",
    `- 日期真值为空的合同：${dateNullSamples.length}份；生成当前合同日期候选的污染数：${dateNullContaminated}份。`,
    `- 当前第三版安全门禁下错误自动采用：${incorrectAutomaticAdoption}份。`,
    "- 付款金额、税额、服务费、周期单价和无作用域金额即使进入诊断候选，也不升级为合同金额自动采用。",
    "",
    "## 候选规模",
    "",
    `- 项目去重候选值数 P50（中位数）/P95（第95百分位）：${percentile(candidateCounts.project, 0.5)}/${percentile(candidateCounts.project, 0.95)}。`,
    `- 金额去重候选值数 P50（中位数）/P95（第95百分位）：${percentile(candidateCounts.amount, 0.5)}/${percentile(candidateCounts.amount, 0.95)}。`,
    `- 日期去重候选值数 P50（中位数）/P95（第95百分位）：${percentile(candidateCounts.date, 0.5)}/${percentile(candidateCounts.date, 0.95)}。`,
    "",
    "## 约束核验",
    "",
    "- OCR（光学字符识别）模型固定为 `PP-OCRv6_medium`（第六版中型模型），没有重新识别或改写原文。",
    "- 候选排序、`highest-qualified-candidate-v3`（最高合格候选第三版）安全门禁、数据库、API（应用程序接口）和原始 OCR（光学字符识别）保存结构均未修改。",
    "- 报告只含聚合计数，不含合同正文、单位名称、金额明细、文件路径或样本摘要。",
    "",
  ].join("\n");
  fs.writeFileSync(outputPath, report, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify({
      before,
      after,
      dateNullContaminated,
      incorrectAutomaticAdoption,
      diagnostics: {
        projectMissedOrdinals: evaluated
          .filter((sample) =>
            sample.diagnostics.some(
              (diagnostic) =>
                diagnostic.field === "project_name" &&
                !diagnostic.expectedIsNull &&
                diagnostic.matchingGeneratedCandidateIds.length === 0,
            ),
          )
          .map((sample) => sample.ordinal),
        dateMissedOrdinals: evaluated
          .filter((sample) =>
            sample.diagnostics.some(
              (diagnostic) =>
                diagnostic.field === "contract_date" &&
                !diagnostic.expectedIsNull &&
                diagnostic.matchingGeneratedCandidateIds.length === 0,
            ),
          )
          .map((sample) => sample.ordinal),
        dateNullContaminatedOrdinals: evaluated
          .filter(
            (sample) =>
              sample.diagnostics.some(
                (diagnostic) =>
                  diagnostic.field === "contract_date" &&
                  diagnostic.expectedIsNull,
              ) &&
              sample.trace.generatedCandidates.some(
                (candidate) => candidate.field === "contract_date",
              ),
          )
          .map((sample) => sample.ordinal),
      },
    })}\n`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
