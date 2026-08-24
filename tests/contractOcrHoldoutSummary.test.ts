/** @jest-environment node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  CONTRACT_OCR_HOLDOUT_AUDIT_POLICY_VERSION,
  CONTRACT_OCR_HOLDOUT_AUTOMATIC_POLICY_VERSION,
  CONTRACT_OCR_HOLDOUT_MODEL,
  summarizeContractOcrHoldoutShards,
} from "../server/services/contractOcrHoldoutSummary";

const CONFIGURATION_HASH = "a".repeat(64);
const CORE_FIELDS = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
  "category",
  "contract_date",
] as const;

function documentSha(index: number): string {
  return createHash("sha256").update(`留出合同-${index}`).digest("hex");
}

function selectedValue(field: (typeof CORE_FIELDS)[number], index: number) {
  const values = {
    party_a: `甲方秘密单位-${index}`,
    party_b: `乙方秘密单位-${index}`,
    project_name: `秘密项目名称-${index}`,
    amount: `${133000 + index}.00`,
    category: "main_business",
    contract_date: "2025-08-07",
  };
  return values[field];
}

function fixtureRecord(index: number): Record<string, unknown> {
  const sha256 = documentSha(index);
  const status =
    index === 47 ? "partial" : index === 48 ? "failed" : "succeeded";
  const isOuterError = index === 49;
  const projectConflict = index === 47;
  const blockers =
    index === 47
      ? ["项目名称没有可采用候选"]
      : index === 48
        ? ["OCR识别基础设施失败"]
        : [];
  const adoptionWarnings = [
    `自动采用策略：${CONTRACT_OCR_HOLDOUT_AUTOMATIC_POLICY_VERSION}`,
    ...(index === 48 ? ["包含秘密金额 990001.00 的未分类警告"] : []),
  ];
  const conflictWarning =
    "项目名称存在候选冲突：甲方区域秘密项目 / 乙方区域秘密项目";
  const shardLocalIndex = index % 25;
  const startedAt = new Date("2026-08-07T00:00:00.000Z");
  const finishedAt = new Date(
    startedAt.getTime() + (shardLocalIndex + 1) * 1000,
  );
  const fields = CORE_FIELDS.map((field) => ({
    field,
    normalizedValue:
      index === 47 && field === "project_name"
        ? null
        : selectedValue(field, index),
    originalValue: `原始秘密值-${field}-${index}`,
    modelVersion: CONTRACT_OCR_HOLDOUT_MODEL,
    warnings:
      projectConflict && field === "project_name" ? [conflictWarning] : [],
    candidates: [
      {
        normalizedValue: selectedValue(field, index),
        originalValue: `候选秘密值-${field}-${index}`,
      },
    ],
  }));
  return {
    schemaVersion: 4,
    auditPolicyVersion: CONTRACT_OCR_HOLDOUT_AUDIT_POLICY_VERSION,
    auditConfigurationHash: CONFIGURATION_HASH,
    ocrModel: CONTRACT_OCR_HOLDOUT_MODEL,
    declaredCategory: "main_business",
    automaticPolicyVersion: CONTRACT_OCR_HOLDOUT_AUTOMATIC_POLICY_VERSION,
    recognitionContextKey: "contract:main:pdf",
    kind: "contract",
    recordType: "recognition_result",
    sha256,
    actualSha256: sha256,
    relativePath: `/绝密合同/第-${index}-份.pdf`,
    durationMs: 1000 + index,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    result: isOuterError
      ? null
      : {
          status,
          modelVersion: CONTRACT_OCR_HOLDOUT_MODEL,
          automaticReady: status === "succeeded",
          automaticAdoption: {
            policyVersion: CONTRACT_OCR_HOLDOUT_AUTOMATIC_POLICY_VERSION,
            accepted: status === "succeeded",
            blockers,
            warnings: adoptionWarnings,
          },
          fields,
          warnings: projectConflict ? [conflictWarning] : [],
        },
  };
}

function writeShard(
  temporaryRoot: string,
  name: string,
  records: Record<string, unknown>[],
): string {
  const filePath = path.join(temporaryRoot, name);
  fs.writeFileSync(
    filePath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  return filePath;
}

describe("合同 OCR（光学字符识别）留出集脱敏汇总", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "contract-holdout-summary-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("汇总 50 个唯一合同且不输出路径、字段原值、原始原因或逐文件摘要", () => {
    const records = Array.from({ length: 50 }, (_, index) =>
      fixtureRecord(index),
    );
    const firstShard = writeShard(
      temporaryRoot,
      "shard-0.jsonl",
      records.slice(0, 25),
    );
    const secondShard = writeShard(
      temporaryRoot,
      "shard-1.jsonl",
      records.slice(25),
    );

    const summary = summarizeContractOcrHoldoutShards({
      inputPaths: [firstShard, secondShard],
    });

    expect(summary.validation.recordCount).toBe(50);
    expect(summary.validation.uniqueSha256Count).toBe(50);
    expect(summary.validation.sourceShardCount).toBe(2);
    expect(summary.validation.auditConfigurationHash).toBe(CONFIGURATION_HASH);
    expect(summary.statusCounts).toEqual({
      succeeded: 47,
      partial: 1,
      failed: 1,
      outer_error: 1,
    });
    expect(summary.automaticReadyCounts).toEqual({
      ready: 47,
      notReady: 2,
      unavailable: 1,
    });
    expect(summary.modelCounts).toEqual({ v6_medium: 50 });
    expect(summary.durationMs).toEqual({
      measurement:
        "每个并发分片内按相邻完成时间差计算单份端到端耗时；首份使用完成时间减该记录开始时间",
      total: 50000,
      average: 1000,
      minimum: 1000,
      p50: 1000,
      p95: 1000,
      maximum: 1000,
      parallelWallClock: 25000,
    });
    expect(summary.fieldMissingCounts.missingFieldRecords).toEqual({
      party_a: 1,
      party_b: 1,
      project_name: 1,
      amount: 1,
      category: 1,
      contract_date: 1,
    });
    expect(summary.fieldMissingCounts.missingSelectedValues.project_name).toBe(
      2,
    );
    expect(summary.automaticAdoption.blockerCategories).toEqual({
      项目名称候选缺失: 1,
      "OCR（光学字符识别）基础设施": 1,
    });
    expect(summary.automaticAdoption.warningCategories).toEqual({
      自动采用策略标记: 49,
      其他: 1,
    });
    expect(summary.candidateConflicts).toEqual({
      documents: 1,
      occurrences: 1,
      byField: {
        party_a: 0,
        party_b: 0,
        project_name: 1,
        amount: 0,
        category: 0,
        contract_date: 0,
        other: 0,
      },
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("绝密合同");
    expect(serialized).not.toContain("甲方秘密单位");
    expect(serialized).not.toContain("乙方秘密单位");
    expect(serialized).not.toContain("秘密项目");
    expect(serialized).not.toContain("133000");
    expect(serialized).not.toContain("2025-08-07");
    expect(serialized).not.toContain("990001");
    expect(serialized).not.toContain(documentSha(0));
    expect(summary.privacy).toEqual({
      aggregatedOnly: true,
      includesDocumentPaths: false,
      includesDocumentSha256Values: false,
      includesFieldValues: false,
      includesRawReasons: false,
    });
  });

  it.each([
    [
      "结构版本",
      (record: Record<string, unknown>) => (record.schemaVersion = 3),
    ],
    [
      "审计策略",
      (record: Record<string, unknown>) =>
        (record.auditPolicyVersion = "automatic-risk-review-old"),
    ],
    [
      "自动采用策略",
      (record: Record<string, unknown>) =>
        (record.automaticPolicyVersion = "old-policy"),
    ],
    [
      "识别模型",
      (record: Record<string, unknown>) => (record.ocrModel = "v5_server"),
    ],
    [
      "配置摘要",
      (record: Record<string, unknown>) =>
        (record.auditConfigurationHash = "b".repeat(64)),
    ],
    [
      "验源摘要",
      (record: Record<string, unknown>) =>
        (record.actualSha256 = "c".repeat(64)),
    ],
  ])("拒绝不一致的%s", (_label, mutate) => {
    const records = Array.from({ length: 50 }, (_, index) =>
      fixtureRecord(index),
    );
    mutate(records[49]);
    const shard = writeShard(temporaryRoot, "invalid.jsonl", records);
    expect(() =>
      summarizeContractOcrHoldoutShards({ inputPaths: [shard] }),
    ).toThrow();
  });

  it("拒绝不足 50 条或重复的文件摘要", () => {
    const shortRecords = Array.from({ length: 49 }, (_, index) =>
      fixtureRecord(index),
    );
    const shortShard = writeShard(temporaryRoot, "short.jsonl", shortRecords);
    expect(() =>
      summarizeContractOcrHoldoutShards({ inputPaths: [shortShard] }),
    ).toThrow("记录数必须为 50");

    const duplicateRecords = Array.from({ length: 50 }, (_, index) =>
      fixtureRecord(index),
    );
    duplicateRecords[49].sha256 = duplicateRecords[48].sha256;
    duplicateRecords[49].actualSha256 = duplicateRecords[48].actualSha256;
    const duplicateShard = writeShard(
      temporaryRoot,
      "duplicate.jsonl",
      duplicateRecords,
    );
    expect(() =>
      summarizeContractOcrHoldoutShards({ inputPaths: [duplicateShard] }),
    ).toThrow("50 个唯一 SHA-256");
  });
});
