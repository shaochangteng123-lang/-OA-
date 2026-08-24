/** @jest-environment node */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONTRACT_OCR_STAGE10_REQUIRED_TAGS,
  createContractOcrStage10Baseline,
  createContractOcrStage10Freeze,
  verifyContractOcrStage10Freeze,
  type ContractOcrStage10AmountStatus,
  type ContractOcrStage10FreezeOptions,
  type ContractOcrStage10GroundTruth,
} from "../server/services/contractOcrStage10Blind";
import {
  summarizeContractOcrStage10Metrics,
  type ContractOcrStage10E2eReport,
  type ContractOcrStage10E2eSampleEvidence,
} from "../server/services/contractOcrStage10Metrics";

const INVENTORY_HEADER = "行政区\t分类\t状态\t扩展名\t字节数\tSHA256\t相对路径";
const MAPPING_HEADER = [
  "匿名样本编号",
  "合同族编号",
  "关系类型",
  "选择状态",
  "族依据",
  "行政区",
  "分类",
  "状态",
  "扩展名",
  "字节数",
  "SHA256",
  "相对路径",
].join("\t");
const IMPLEMENTATION_PATHS = [
  "server/services/contractOcr.ts",
  "server/services/contractService.ts",
  "server/routes/contracts.ts",
  "server/services/ocrDaemon.ts",
  "server/scripts/paddle_ocr_worker.py",
  "server/config/ocr-v6-medium.json",
  "server/services/contractOcrStage10Blind.ts",
  "server/services/contractOcrStage10Metrics.ts",
  "server/scripts/freeze-contract-ocr-stage10.ts",
  "server/scripts/replay-contract-ocr-http-e2e.ts",
  "server/scripts/summarize-contract-ocr-stage10.ts",
  "server/services/contractOcrFamilyIsolation.ts",
  "server/scripts/build-contract-ocr-family-holdout.ts",
  "server/services/contractOcrHoldout.ts",
  "server/scripts/prepare_ocr_v6_medium_models.py",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.prod.yml",
  "server/services/contractFileValidation.ts",
  "server/db/index.ts",
  "server/routes/auth.ts",
  "server/middleware/auth.ts",
  "server/utils/password.ts",
  "package.json",
  "package-lock.json",
];
const STATUSES: ContractOcrStage10AmountStatus[] = [
  "confirmed_amount",
  "calculated_amount",
  "payment_only",
  "missing_amount",
];

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sampleId(index: number): string {
  return `CTR-STAGE10-BLIND-${String(index + 1).padStart(3, "0")}`;
}

function familyId(index: number): string {
  return `FAM-${String(index + 1).padStart(3, "0")}`;
}

function relationType(
  index: number,
): "main" | "supplement" | "change" | "reduction" {
  return (["main", "supplement", "change", "reduction"] as const)[index % 4];
}

function inventoryLine(index: number): string {
  return [
    "测试区",
    index % 4 === 0 ? "主合同或其他合同" : "补充协议",
    "正常",
    "pdf",
    String(1000 + index),
    digest(`合同-${index}`),
    `测试区/项目-${index}/合同-${index}.pdf`,
  ].join("\t");
}

function buildGroundTruth(): ContractOcrStage10GroundTruth {
  return {
    schemaVersion: 1,
    datasetVersion: "contract-ocr-stage10-blind-v1",
    samples: Array.from({ length: 100 }, (_, index) => {
      const status = STATUSES[index % STATUSES.length];
      const confirmedAmount = 100000 + index;
      const calculated = status === "calculated_amount";
      const hasAmount = status === "confirmed_amount" || calculated;
      return {
        id: sampleId(index),
        familyId: familyId(index),
        sha256: digest(`合同-${index}`),
        relativePath: `测试区/项目-${index}/合同-${index}.pdf`,
        relationType: relationType(index),
        tags: [
          CONTRACT_OCR_STAGE10_REQUIRED_TAGS[
            index % CONTRACT_OCR_STAGE10_REQUIRED_TAGS.length
          ],
        ],
        expected: {
          party_a: `甲方-${index}`,
          party_b: `乙方-${index}`,
          project_name: `项目-${index}`,
          amount: hasAmount
            ? calculated
              ? "20000.00"
              : `${confirmedAmount}.00`
            : null,
          contract_date: "2026-08-07",
          amountStatus: status,
          amountBreakdown: calculated
            ? {
                originalAmount: 100000,
                changeAmount: 20000,
                finalAmount: 120000,
              }
            : status === "confirmed_amount"
              ? {
                  originalAmount: confirmedAmount,
                  changeAmount: 0,
                  finalAmount: confirmedAmount,
                }
              : {
                  originalAmount: null,
                  changeAmount: null,
                  finalAmount: null,
                },
        },
      };
    }),
  };
}

function prepareFixture(root: string) {
  for (const relativePath of IMPLEMENTATION_PATHS) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `冻结实现：${relativePath}\n`, "utf8");
  }
  const candidateManifestPath = path.join(root, "candidate.tsv");
  const inventoryPath = path.join(root, "inventory.tsv");
  const finalManifestPath = path.join(root, "final.tsv");
  const mappingPath = path.join(root, "mapping.tsv");
  const groundTruthPath = path.join(root, "truth.json");
  const familyIsolationMetadataPath = path.join(root, "family-public.json");
  const familyIsolationLineagePath = path.join(root, "family-lineage.json");
  const familyRegistryPath = path.join(root, "family-registry.tsv");
  const exclusionManifestPaths = [
    path.join(root, "historical-50.tsv"),
    path.join(root, "diagnostic-7.tsv"),
  ];
  const consumedAuditPaths = [path.join(root, "consumed.jsonl")];
  const baselinePath = path.join(root, "baseline.json");
  fs.writeFileSync(
    candidateManifestPath,
    `${INVENTORY_HEADER}\n${Array.from({ length: 120 }, (_, index) => inventoryLine(index)).join("\n")}\n`,
  );
  fs.copyFileSync(candidateManifestPath, inventoryPath);
  fs.writeFileSync(
    finalManifestPath,
    `${INVENTORY_HEADER}\n${Array.from({ length: 100 }, (_, index) => inventoryLine(index)).join("\n")}\n`,
  );
  fs.writeFileSync(
    mappingPath,
    `${MAPPING_HEADER}\n${Array.from({ length: 100 }, (_, index) =>
      [
        sampleId(index),
        familyId(index),
        relationType(index),
        "已选择",
        "external_registry",
        ...inventoryLine(index).split("\t"),
      ].join("\t"),
    ).join("\n")}\n`,
  );
  const truth = buildGroundTruth();
  fs.writeFileSync(groundTruthPath, `${JSON.stringify(truth, null, 2)}\n`);
  fs.writeFileSync(familyRegistryPath, "SHA256\t外部合同族编号\t关系类型\n");
  for (const filePath of exclusionManifestPaths) {
    fs.writeFileSync(filePath, `${INVENTORY_HEADER}\n`);
  }
  fs.writeFileSync(consumedAuditPaths[0], "");
  fs.writeFileSync(
    familyIsolationMetadataPath,
    JSON.stringify({
      schemaVersion: 1,
      datasetVersion: truth.datasetVersion,
      selectionPolicyVersion:
        "deterministic-private-registry-path-filename-family-v2",
      requestedSize: 100,
      source: {
        exclusionManifestCount: 2,
        consumedAuditFileCount: 1,
        privateFamilyRegistryComplete: true,
      },
      familyIsolation: {
        privateFamilyRegistryRequired: true,
        privateFamilyRegistryUsed: true,
        wholeFamilyExclusion: true,
        maximumSelectedPerFamily: 1,
      },
      blindFreeze: {
        status: "frozen",
        exactTargetRequired: true,
        candidateDocuments: 120,
        frozenDocuments: 100,
      },
    }),
  );
  const fileDigest = (filePath: string) =>
    digest(fs.readFileSync(filePath, "utf8"));
  fs.writeFileSync(
    familyIsolationLineagePath,
    JSON.stringify({
      schemaVersion: 1,
      datasetVersion: truth.datasetVersion,
      selectionPolicyVersion:
        "deterministic-private-registry-path-filename-family-v2",
      inputs: {
        inventorySha256: fileDigest(inventoryPath),
        familyRegistrySha256: fileDigest(familyRegistryPath),
        exclusionManifestSha256: exclusionManifestPaths.map(fileDigest),
        consumedAuditSha256: consumedAuditPaths.map(fileDigest),
      },
      outputs: {
        candidateManifestSha256: fileDigest(candidateManifestPath),
        finalManifestSha256: fileDigest(finalManifestPath),
        mappingSha256: fileDigest(mappingPath),
      },
    }),
  );
  const baseline = createContractOcrStage10Baseline(
    {
      projectRoot: root,
      automaticPolicyVersion: "missing-amount-legal-empty-v2",
      configuredOcrModel: "v6_medium",
    },
    "2026-08-06T23:00:00.000Z",
  );
  fs.writeFileSync(baselinePath, JSON.stringify(baseline));
  const options: ContractOcrStage10FreezeOptions = {
    projectRoot: root,
    baselinePath,
    inventoryPath,
    candidateManifestPath,
    finalManifestPath,
    mappingPath,
    groundTruthPath,
    familyIsolationMetadataPath,
    familyIsolationLineagePath,
    familyRegistryPath,
    exclusionManifestPaths,
    consumedAuditPaths,
    datasetVersion: truth.datasetVersion,
    automaticPolicyVersion: "missing-amount-legal-empty-v2",
    configuredOcrModel: "v6_medium",
  };
  return { options, truth };
}

function evidenceFor(
  truth: ContractOcrStage10GroundTruth["samples"][number],
): ContractOcrStage10E2eSampleEvidence {
  const finalValues = {
    party_a: truth.expected.party_a,
    party_b: truth.expected.party_b,
    project_name: truth.expected.project_name,
    amount: truth.expected.amount,
    contract_date: truth.expected.contract_date,
  };
  return {
    sampleId: truth.id,
    familyId: truth.familyId,
    sha256: truth.sha256,
    modelVersion: "v6_medium",
    automaticPolicyVersion: "missing-amount-legal-empty-v2",
    durationMs: 1000,
    peakMemoryBytes: 512 * 1024 * 1024,
    retryCount: 0,
    ocrLineCount: 10,
    averageOcrConfidence: 0.98,
    amountStatus: truth.expected.amountStatus,
    amountBreakdown: truth.expected.amountBreakdown,
    finalValues,
    databaseValues: { ...finalValues },
    steps: {
      uploaded: true,
      ocrCompleted: true,
      ocrResultSaved: true,
      parsed: true,
      riskValidated: true,
      automaticallyAdopted: true,
      databaseWritten: true,
      databaseReadBack: true,
    },
    oomDetected: false,
    transactionFailure: false,
    dataPollutionDetected: false,
    anomalyTypes: [],
  };
}

describe("合同 OCR（光学字符识别）第十阶段盲测冻结与指标", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "contract-ocr-stage10-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("冻结120份候选、100个独立合同族、四类金额状态和全部覆盖标签", () => {
    const { options } = prepareFixture(temporaryRoot);
    const freeze = createContractOcrStage10Freeze(
      options,
      "2026-08-07T00:00:00.000Z",
    );

    expect(freeze.candidateSet.count).toBe(120);
    expect(freeze.blindSet.count).toBe(100);
    expect(freeze.blindSet.uniqueFamilyCount).toBe(100);
    expect(freeze.versions.ocrModel).toBe("v6_medium");
    expect(freeze.versions.paddleOcrVersion).toBe("3.5.0");
    expect(freeze.versions.automaticPolicyVersion).toBe(
      "missing-amount-legal-empty-v2",
    );
    expect(freeze.implementation.files).toHaveLength(25);
    expect(freeze.coverage.byAmountStatus).toEqual({
      confirmed_amount: 25,
      calculated_amount: 25,
      payment_only: 25,
      missing_amount: 25,
    });
    expect(
      Object.values(freeze.coverage.byTag).every((count) => count > 0),
    ).toBe(true);
    expect(() => verifyContractOcrStage10Freeze(freeze, options)).not.toThrow();
  });

  it("冻结后关键实现发生任何变化都会拒绝汇总", () => {
    const { options } = prepareFixture(temporaryRoot);
    const freeze = createContractOcrStage10Freeze(options);
    fs.appendFileSync(
      path.join(temporaryRoot, "server/services/contractOcr.ts"),
      "规则发生变化\n",
    );

    expect(() => verifyContractOcrStage10Freeze(freeze, options)).toThrow(
      "版本基线校验失败",
    );
  });

  it("拒绝混搭同计数的合同族排除文件与既有私有谱系", () => {
    const { options } = prepareFixture(temporaryRoot);
    const freeze = createContractOcrStage10Freeze(options);
    fs.appendFileSync(options.exclusionManifestPaths[0], "\n");

    expect(() => verifyContractOcrStage10Freeze(freeze, options)).toThrow(
      "合同族隔离元数据未证明",
    );
  });

  it("汇总四类金额状态并将金额为空与零严格区分", () => {
    const { options, truth } = prepareFixture(temporaryRoot);
    const freeze = createContractOcrStage10Freeze(options);
    const reportPath = path.join(temporaryRoot, "e2e.json");
    const report: ContractOcrStage10E2eReport = {
      schemaVersion: 2,
      freezeId: freeze.freezeId,
      datasetVersion: freeze.datasetVersion,
      ocrModel: "v6_medium",
      automaticPolicyVersion: "missing-amount-legal-empty-v2",
      amountStatusEvidence: "independent_live_replay",
      memoryMeasurement: "docker_cgroup_total",
      samples: truth.samples.map(evidenceFor),
    };
    fs.writeFileSync(reportPath, JSON.stringify(report));

    const summary = summarizeContractOcrStage10Metrics({
      freeze,
      groundTruthPath: options.groundTruthPath,
      e2eReportPaths: [reportPath],
      generatedAt: "2026-08-07T01:00:00.000Z",
    });

    expect(summary.amountStatusAccuracy).toEqual({
      confirmed_amount: { correct: 25, total: 25, accuracy: 100 },
      calculated_amount: { correct: 25, total: 25, accuracy: 100 },
      payment_only: { correct: 25, total: 25, accuracy: 100 },
      missing_amount: { correct: 25, total: 25, accuracy: 100 },
    });
    expect(summary.system.automaticDatabaseWrite.accuracy).toBe(100);
    expect(summary.productionGate.ready).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("甲方-0");
    expect(JSON.stringify(summary)).not.toContain(digest("合同-0"));
  });

  it("missing_amount（金额缺失）被写成0时金额状态与落库门禁都失败", () => {
    const { options, truth } = prepareFixture(temporaryRoot);
    const freeze = createContractOcrStage10Freeze(options);
    const samples = truth.samples.map(evidenceFor);
    const target = samples.find(
      (sample) => sample.amountStatus === "missing_amount",
    )!;
    target.finalValues.amount = 0;
    target.databaseValues.amount = 0;
    target.steps.automaticallyAdopted = false;
    target.steps.databaseWritten = false;
    target.amountStatus = "confirmed_amount";
    target.anomalyTypes = ["amount_status_mismatch"];
    const reportPath = path.join(temporaryRoot, "e2e-failed.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 2,
        freezeId: freeze.freezeId,
        datasetVersion: freeze.datasetVersion,
        ocrModel: "v6_medium",
        automaticPolicyVersion: "missing-amount-legal-empty-v2",
        amountStatusEvidence: "independent_live_replay",
        memoryMeasurement: "docker_cgroup_total",
        samples,
      } satisfies ContractOcrStage10E2eReport),
    );

    const summary = summarizeContractOcrStage10Metrics({
      freeze,
      groundTruthPath: options.groundTruthPath,
      e2eReportPaths: [reportPath],
    });

    expect(summary.amountStatusAccuracy.missing_amount).toEqual({
      correct: 24,
      total: 25,
      accuracy: 96,
    });
    expect(summary.system.automaticDatabaseWrite.correct).toBe(99);
    expect(summary.system.failedDocuments).toBe(1);
    expect(summary.productionGate.ready).toBe(true);
  });

  it("数据库回读错误不能计入自动落库成功，任一异常都计入失败率", () => {
    const { options, truth } = prepareFixture(temporaryRoot);
    const freeze = createContractOcrStage10Freeze(options);
    const samples = truth.samples.map(evidenceFor);
    samples[0].databaseValues.party_a = "错误甲方";
    samples[0].anomalyTypes = ["database_readback_mismatch"];
    const reportPath = path.join(temporaryRoot, "e2e-readback-failed.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 2,
        freezeId: freeze.freezeId,
        datasetVersion: freeze.datasetVersion,
        ocrModel: "v6_medium",
        automaticPolicyVersion: "missing-amount-legal-empty-v2",
        amountStatusEvidence: "independent_live_replay",
        memoryMeasurement: "docker_cgroup_total",
        samples,
      } satisfies ContractOcrStage10E2eReport),
    );

    const summary = summarizeContractOcrStage10Metrics({
      freeze,
      groundTruthPath: options.groundTruthPath,
      e2eReportPaths: [reportPath],
    });

    expect(summary.system.automaticDatabaseWrite.correct).toBe(99);
    expect(summary.system.databaseReadbackConsistency.correct).toBe(99);
    expect(summary.system.failedDocuments).toBe(1);
  });

  it("明确金额必须数值正确，计算金额必须同时匹配变化量和完整拆分", () => {
    const { options, truth } = prepareFixture(temporaryRoot);
    const freeze = createContractOcrStage10Freeze(options);
    const samples = truth.samples.map(evidenceFor);
    const confirmed = samples.find(
      (sample) => sample.amountStatus === "confirmed_amount",
    )!;
    confirmed.finalValues.amount = "999.00";
    confirmed.databaseValues.amount = "999.00";
    confirmed.anomalyTypes = ["field_mismatch:amount"];
    const calculated = samples.filter(
      (sample) => sample.amountStatus === "calculated_amount",
    );
    for (const sample of calculated.slice(0, 2)) {
      sample.amountBreakdown = {
        originalAmount: 100000,
        changeAmount: 20000,
        finalAmount: 130000,
      };
      sample.anomalyTypes = ["amount_status_mismatch"];
    }
    const reportPath = path.join(temporaryRoot, "e2e-amount-semantic.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 2,
        freezeId: freeze.freezeId,
        datasetVersion: freeze.datasetVersion,
        ocrModel: "v6_medium",
        automaticPolicyVersion: "missing-amount-legal-empty-v2",
        amountStatusEvidence: "independent_live_replay",
        memoryMeasurement: "docker_cgroup_total",
        samples,
      } satisfies ContractOcrStage10E2eReport),
    );

    const summary = summarizeContractOcrStage10Metrics({
      freeze,
      groundTruthPath: options.groundTruthPath,
      e2eReportPaths: [reportPath],
    });

    expect(summary.amountStatusAccuracy.confirmed_amount.correct).toBe(24);
    expect(summary.amountStatusAccuracy.calculated_amount.correct).toBe(23);
    expect(summary.productionGate.confirmedAmountAccuracyAtLeast99).toBe(false);
    expect(summary.productionGate.calculatedAmountAccuracyAtLeast95).toBe(
      false,
    );
    expect(summary.productionGate.ready).toBe(false);
  });

  it("拒绝缺失异常布尔标记或伪造的单进程内存口径", () => {
    const { options, truth } = prepareFixture(temporaryRoot);
    const freeze = createContractOcrStage10Freeze(options);
    const samples = truth.samples.map(evidenceFor);
    (samples[0] as unknown as Record<string, unknown>).oomDetected = undefined;
    const reportPath = path.join(temporaryRoot, "e2e-invalid-evidence.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 2,
        freezeId: freeze.freezeId,
        datasetVersion: freeze.datasetVersion,
        ocrModel: "v6_medium",
        automaticPolicyVersion: "missing-amount-legal-empty-v2",
        amountStatusEvidence: "independent_live_replay",
        memoryMeasurement: "node_process_rss",
        samples,
      }),
    );

    expect(() =>
      summarizeContractOcrStage10Metrics({
        freeze,
        groundTruthPath: options.groundTruthPath,
        e2eReportPaths: [reportPath],
      }),
    ).toThrow("容器整体内存口径不一致");
  });
});
