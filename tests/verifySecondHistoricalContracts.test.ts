/** @jest-environment node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SECOND_HISTORICAL_AUXILIARY_CORRECTION_KEY,
  SECOND_HISTORICAL_OBSOLETE_CONTRACT_FILE_IDS,
  SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID,
  SECOND_HISTORICAL_VERIFICATION_RECEIPT_OCR_SHA256,
  assertRegularFilePathWithoutSymlinks,
  assertSecondHistoricalCorrectedBatchState,
  assertSecondHistoricalVerificationEnvironment,
  isExactDragonLegacyInvoiceOcrSnapshot,
  parseSecondHistoricalVerificationArguments,
  resolveSecondHistoricalStoredPath,
  type SecondHistoricalVerificationArguments,
} from "../server/scripts/verify-second-historical-contracts";
import {
  SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
  SECOND_HISTORICAL_SEMANTIC_SHA256,
} from "../server/scripts/second-historical-import-config";
import type { SecondHistoricalFinancialPlan } from "../server/scripts/second-historical-import-plan";

const TARGET_DATABASE_SHA256 = "a".repeat(64);

function correctedBatch(
  summaryOverrides: Record<string, unknown> = {},
  includeFinancialLinks = true,
): Record<string, unknown> {
  const importedRootIds = Array.from(
    { length: 41 },
    (_, index) => `root-${index + 1}`,
  );
  return {
    imported_contract_count: 40,
    summary_json: {
      rootContractCount: 41,
      costContractCount: 21,
      auxiliaryFileCount: 115,
      semanticSha256: SECOND_HISTORICAL_SEMANTIC_SHA256,
      importedRootIds,
      auxiliaryClassificationCorrectionV1: {
        correctionKey: SECOND_HISTORICAL_AUXILIARY_CORRECTION_KEY,
        removedRootContractId: SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID,
      },
      ...(includeFinancialLinks
        ? {
            financialLinkResults: importedRootIds.map((rootId) => ({
              rootId,
            })),
          }
        : {}),
      ...summaryOverrides,
    },
  };
}

function productionArguments(
  overrides: Partial<SecondHistoricalVerificationArguments> = {},
): SecondHistoricalVerificationArguments {
  return {
    target: "production",
    sourceRoot: "/migration/source",
    outputPath: null,
    manifestSha256: SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
    receiptOcrSha256: SECOND_HISTORICAL_VERIFICATION_RECEIPT_OCR_SHA256,
    receiptOcrPath: "/migration/receipt-ocr.json",
    semanticSha256: SECOND_HISTORICAL_SEMANTIC_SHA256,
    targetDatabaseSha256: TARGET_DATABASE_SHA256,
    ...overrides,
  };
}

describe("第二批历史合同只读验收参数", () => {
  it("未指定目标时保持开发模式兼容", () => {
    expect(
      parseSecondHistoricalVerificationArguments(
        ["--source-root", "source", "--output", "reports/result.json"],
        "/app",
      ),
    ).toEqual({
      target: "development",
      sourceRoot: "/app/source",
      outputPath: "/app/reports/result.json",
      manifestSha256: null,
      receiptOcrSha256: null,
      receiptOcrPath: null,
      semanticSha256: null,
      targetDatabaseSha256: null,
    });
  });

  it("严格解析生产模式及两项冻结摘要", () => {
    expect(
      parseSecondHistoricalVerificationArguments(
        [
          "--target=production",
          "--source-root=/migration/source",
          "--receipt-ocr=/migration/receipt-ocr.json",
          `--manifest-sha256=${SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH}`,
          `--receipt-ocr-sha256=${SECOND_HISTORICAL_VERIFICATION_RECEIPT_OCR_SHA256}`,
          `--semantic-sha256=${SECOND_HISTORICAL_SEMANTIC_SHA256}`,
          `--target-database-sha256=${TARGET_DATABASE_SHA256}`,
        ],
        "/app",
      ),
    ).toEqual(productionArguments());
  });

  it.each([
    [["--unknown=value"], "不支持的参数"],
    [["position"], "不支持的位置参数"],
    [["--target"], "参数缺少值"],
    [["--target=staging"], "--target 只能是"],
    [["--source-root=/a", "--source-root=/b"], "参数不能重复"],
    [["--manifest-sha256=ABC"], "必须是64位小写十六进制摘要"],
  ])("拒绝无效或含糊参数：%j", (argv, message) => {
    expect(() =>
      parseSecondHistoricalVerificationArguments(argv, "/app"),
    ).toThrow(message);
  });

  it("生产模式拒绝文件输出", () => {
    expect(() =>
      parseSecondHistoricalVerificationArguments(
        ["--target=production", "--output=/tmp/result.json"],
        "/app",
      ),
    ).toThrow("生产验收只允许控制台输出");
  });
});

describe("第二批历史合同验收环境门禁", () => {
  it("允许满足双摘要确认的生产容器", () => {
    expect(() =>
      assertSecondHistoricalVerificationEnvironment(
        productionArguments(),
        { NODE_ENV: "production" },
        "/app",
      ),
    ).not.toThrow();
  });

  it.each([
    [
      productionArguments(),
      { NODE_ENV: "development" },
      "/app",
      "NODE_ENV=production",
    ],
    [
      productionArguments(),
      { NODE_ENV: "production" },
      "/tmp",
      "必须在容器 /app",
    ],
    [
      productionArguments({ manifestSha256: null }),
      { NODE_ENV: "production" },
      "/app",
      "冻结源文件清单摘要不一致",
    ],
    [
      productionArguments({ receiptOcrSha256: null }),
      { NODE_ENV: "production" },
      "/app",
      "回单复核文件摘要不一致",
    ],
    [
      productionArguments({ receiptOcrPath: null }),
      { NODE_ENV: "production" },
      "/app",
      "必须显式指定 --receipt-ocr",
    ],
    [
      productionArguments({ semanticSha256: null }),
      { NODE_ENV: "production" },
      "/app",
      "业务语义摘要不一致",
    ],
    [
      productionArguments({ targetDatabaseSha256: null }),
      { NODE_ENV: "production" },
      "/app",
      "必须指定64位 --target-database-sha256",
    ],
  ])("阻断生产验收门禁不完整", (args, environment, cwd, message) => {
    expect(() =>
      assertSecondHistoricalVerificationEnvironment(args, environment, cwd),
    ).toThrow(message);
  });

  it("保留开发模式原有环境和连接保护", () => {
    const args = parseSecondHistoricalVerificationArguments([], "/app");
    expect(() =>
      assertSecondHistoricalVerificationEnvironment(
        args,
        {
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://postgres@postgres/yulilog_worklog",
        },
        "/app",
      ),
    ).not.toThrow();
    expect(() =>
      assertSecondHistoricalVerificationEnvironment(
        args,
        {
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://postgres@production/yulilog_worklog",
        },
        "/app",
      ),
    ).toThrow("疑似生产环境");
  });

  it("所有数据库核验都封装在只读事务中", () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/scripts/verify-second-historical-contracts.ts",
      ),
      "utf8",
    );
    expect(source).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(source).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/u,
    );
    expect(source).toContain("mapping.family_key !== assignment.familyId");
    expect(source).toContain("mapping.target_kind !== expectedTargetKind");
    expect(source).toContain("auxiliary_parent_contract_id");
    expect(source).toContain("expectedAgreements.length !== 6");
    expect(source).toContain("financialByHash.size !== 219");
    expect(source).toContain("financialMatches.length !== 156");
    expect(source).toContain("auxiliary: 115");
    expect(source).toContain("sealed_contract: 41");
    expect(source).toContain("expectedNoFinancialRoots.length !== 0");
    expect(source).toContain("noFinancialRegistrationCount !== 0");
    expect(source).toContain("requires_auxiliary_materials");
    expect(source).not.toContain("existing_contract_archive: 2");
    expect(source).toContain("calculateSecondHistoricalTargetDatabaseSha256");
    expect(source).toContain("assertReceiptEvidenceSnapshot");
    expect(source).toMatch(
      /SELECT manifest_hash,status,imported_contract_count,summary_json/u,
    );
    expect(source).toContain("obsolete_contract_count");
    expect(source).toContain("obsolete_file_count");
    expect(source).toContain("obsolete_mapping_count");
    expect(source).toContain("existing_archive_mapping_count");
  });
});

describe("第二批辅助材料归类更正后的摘要门禁", () => {
  it("显式接受40份新增、41个根、21份支出和115份辅助材料", () => {
    const state = assertSecondHistoricalCorrectedBatchState(
      correctedBatch(),
      "production",
    );
    expect(state.importedRootIds).toHaveLength(41);
    expect(state.financialLinkRootIds).toHaveLength(41);
    expect(state.importedRootIds).not.toContain(
      SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID,
    );
    expect(state.financialLinkRootIds).not.toContain(
      SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID,
    );
    expect(SECOND_HISTORICAL_OBSOLETE_CONTRACT_FILE_IDS).toEqual([
      "1wUDji9suakQ-rbnIf_hi",
      "fQHpEgtNaTwlvdDK70tmc",
      "h2_UYhoLA3ZIWMOwzLSUuxy",
    ]);
  });

  it("开发摘要可兼容旧批次未保存财务关系结果", () => {
    const state = assertSecondHistoricalCorrectedBatchState(
      correctedBatch({}, false),
      "development",
    );
    expect(state.financialLinkRootIds).toBeNull();
  });

  it("生产摘要必须保存41份财务关系结果", () => {
    expect(() =>
      assertSecondHistoricalCorrectedBatchState(
        correctedBatch({}, false),
        "production",
      ),
    ).toThrow("生产摘要缺少 financialLinkResults");
  });

  it.each([
    [{ imported_contract_count: 41 }, "第二批新增合同数应为40份"],
    [correctedBatch({ rootContractCount: 42 }), "不是完整的辅助材料归类更正态"],
    [correctedBatch({ costContractCount: 22 }), "不是完整的辅助材料归类更正态"],
    [
      correctedBatch({ auxiliaryFileCount: 114 }),
      "不是完整的辅助材料归类更正态",
    ],
    [
      correctedBatch({ semanticSha256: "0".repeat(64) }),
      "不是完整的辅助材料归类更正态",
    ],
    [
      correctedBatch({
        auxiliaryClassificationCorrectionV1: {
          correctionKey: "错误更正",
          removedRootContractId: SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID,
        },
      }),
      "不是完整的辅助材料归类更正态",
    ],
  ])("拒绝批次计数或语义摘要越界", (batch, message) => {
    expect(() =>
      assertSecondHistoricalCorrectedBatchState(batch, "production"),
    ).toThrow(message);
  });

  it("拒绝摘要合同集合混入废弃合同", () => {
    const importedRootIds = [
      SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID,
      ...Array.from({ length: 40 }, (_, index) => `root-${index + 2}`),
    ];
    expect(() =>
      assertSecondHistoricalCorrectedBatchState(
        correctedBatch({ importedRootIds }),
        "production",
      ),
    ).toThrow("importedRootIds 应为41个唯一有效合同");
  });

  it("拒绝财务关系集合少合同或混入废弃合同", () => {
    const importedRootIds = Array.from(
      { length: 41 },
      (_, index) => `root-${index + 1}`,
    );
    expect(() =>
      assertSecondHistoricalCorrectedBatchState(
        correctedBatch({
          financialLinkResults: importedRootIds.slice(0, 40).map((rootId) => ({
            rootId,
          })),
        }),
        "production",
      ),
    ).toThrow("financialLinkResults 应为41个有效合同");
    expect(() =>
      assertSecondHistoricalCorrectedBatchState(
        correctedBatch({
          financialLinkResults: [
            { rootId: SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID },
            ...importedRootIds.slice(1).map((rootId) => ({ rootId })),
          ],
        }),
        "production",
      ),
    ).toThrow("financialLinkResults 应为41个有效合同");
  });
});

describe("龙潭湖附件转入辅助材料的冻结门禁", () => {
  const importerSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "server/scripts/import-second-historical-contracts.ts",
    ),
    "utf8",
  );
  const verifierSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "server/scripts/verify-second-historical-contracts.ts",
    ),
    "utf8",
  );

  it("导入器只精确移除两份旧合同档案及作废票陈旧摘要", () => {
    expect(importerSource).toContain("assertDragonLegacyAuxiliaryFilesCanMove");
    expect(importerSource).toContain(
      "removeDragonLegacyAuxiliaryContractFiles",
    );
    expect(importerSource).toContain(
      "DELETE FROM contract_financial_file_hashes",
    );
    expect(importerSource).toContain("DELETE FROM contract_files");
    expect(importerSource).toContain("RETURNING file_hash");
    expect(importerSource).toContain("RETURNING id");
    expect(importerSource).toContain("requires_auxiliary_materials=TRUE");
    expect(importerSource).not.toContain(
      'targetKind: "existing_contract_archive"',
    );
  });

  it("导入器删除前阻断所有合同文件外键引用", () => {
    for (const table of [
      "contract_seal_applications",
      "contract_download_request_files",
      "contract_historical_import_files",
      "contract_ocr_jobs",
      "contract_financial_ocr_jobs",
      "contract_seal_verifications",
      "contract_invoices",
      "contract_receipts",
      "contract_payments",
      "contract_external_payments",
      "contract_deposit_settlement_receipts",
    ]) {
      expect(importerSource).toContain(`FROM ${table}`);
    }
    expect(importerSource).toContain("龙潭湖待迁辅助材料仍被其他业务记录引用");
  });

  it("只读验收拒绝旧档案、陈旧摘要和旧映射类型残留", () => {
    expect(verifierSource).toContain(
      "DRAGON_LEGACY_AUXILIARY_CONTRACT_FILE_IDS",
    );
    expect(verifierSource).toContain("DRAGON_STALE_VOID_INVOICE_HASH");
    expect(verifierSource).toContain(
      "龙潭湖辅助材料仍被错误映射为既有合同档案",
    );
    expect(verifierSource).toContain("auxiliary_file_count) !== 115");
  });
});

describe("第二批生产验收文件路径保护", () => {
  it("只接受指定应用根目录下的 uploads 相对路径", () => {
    expect(
      resolveSecondHistoricalStoredPath("uploads/contracts/file.pdf", "/app"),
    ).toBe("/app/uploads/contracts/file.pdf");
    for (const invalid of [
      "/app/uploads/contracts/file.pdf",
      "uploads/../secret.txt",
      "uploads/contracts/../../secret.txt",
      "uploads\\contracts\\file.pdf",
      "other/file.pdf",
      "uploads/",
    ]) {
      expect(() => resolveSecondHistoricalStoredPath(invalid, "/app")).toThrow(
        "越过上传目录",
      );
    }
  });

  it("逐级拒绝符号链接并接受真实普通文件", async () => {
    // macOS 的 /var 是系统级符号链接，测试临时根先规范到真实路径，
    // 避免把操作系统目录别名误判成业务文件路径中的符号链接。
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "verify-path-"),
    );
    try {
      const directory = path.join(root, "uploads", "contracts");
      fs.mkdirSync(directory, { recursive: true });
      const regular = path.join(directory, "regular.pdf");
      fs.writeFileSync(regular, "test");
      await expect(
        assertRegularFilePathWithoutSymlinks(regular, "测试文件"),
      ).resolves.toEqual(expect.objectContaining({ size: 4 }));
      const linked = path.join(directory, "linked.pdf");
      fs.symlinkSync(regular, linked);
      await expect(
        assertRegularFilePathWithoutSymlinks(linked, "测试文件"),
      ).rejects.toThrow("路径包含符号链接");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("龙潭湖既有发票旧识别快照兼容", () => {
  const fact = {
    kind: "invoice",
    invoiceNo: "03024845",
    businessDate: "2023-09-05",
    amount: 15_840,
    source: {
      hash: "538c4b38b4c5312e9cb11336bdd8a0357bacc6ba9d5958dfb9d5801ae628560f",
    },
  } as SecondHistoricalFinancialPlan;
  const actual = {
    contract_id: "sdylIKVZJDN8jYQ342rOL",
    record_id: "OIS9KCPaeWfh3VPdgWIfv",
    invoice_no: "03024845",
    file_hash:
      "538c4b38b4c5312e9cb11336bdd8a0357bacc6ba9d5958dfb9d5801ae628560f",
    ocr_job_id: "histocr_960eec5635278a16a07b5e",
    ocr_contract_id: "sdylIKVZJDN8jYQ342rOL",
    ocr_file_hash:
      "538c4b38b4c5312e9cb11336bdd8a0357bacc6ba9d5958dfb9d5801ae628560f",
    ocr_record_id: "OIS9KCPaeWfh3VPdgWIfv",
    ocr_record_kind: "invoice",
    ocr_snapshot: {
      source: "confirmed_historical_import",
      repairBatchKey: "historical-import-2026-08-26-system-boundary-repair-v1",
      recordKind: "invoice",
      recordId: "OIS9KCPaeWfh3VPdgWIfv",
      businessDate: "2023-09-05",
      amount: 15_840,
    },
  };

  it("只接受固定合同、发票、摘要、任务及六字段旧快照", () => {
    expect(
      isExactDragonLegacyInvoiceOcrSnapshot(
        actual,
        "sdylIKVZJDN8jYQ342rOL",
        fact,
      ),
    ).toBe(true);
  });

  it.each([
    [{ ...actual, record_id: "other" }],
    [{ ...actual, file_hash: "0".repeat(64) }],
    [
      {
        ...actual,
        ocr_snapshot: { ...actual.ocr_snapshot, sourcePath: "legacy.pdf" },
      },
    ],
    [
      {
        ...actual,
        ocr_snapshot: { ...actual.ocr_snapshot, amount: 15_839 },
      },
    ],
  ])("任一固定边界变化都会拒绝", (candidate) => {
    expect(
      isExactDragonLegacyInvoiceOcrSnapshot(
        candidate,
        "sdylIKVZJDN8jYQ342rOL",
        fact,
      ),
    ).toBe(false);
  });

  it("其他合同不能借用龙潭湖旧快照兼容", () => {
    expect(
      isExactDragonLegacyInvoiceOcrSnapshot(actual, "other-contract", fact),
    ).toBe(false);
  });
});
