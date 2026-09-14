/** @jest-environment node */

jest.mock("nanoid", () => ({ nanoid: () => "second-history-test-id" }));

import fs from "node:fs";
import path from "node:path";

import {
  SECOND_HISTORICAL_IMPORT_EXPECTED_FILE_COUNT,
  SECOND_HISTORICAL_IMPORT_EXPECTED_ASSIGNMENT_COUNTS,
  SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
  SECOND_HISTORICAL_IMPORT_FAMILIES,
  SECOND_HISTORICAL_PRODUCTION_CONFIRMATION,
  SECOND_HISTORICAL_RECEIPT_OCR_SHA256,
  SECOND_HISTORICAL_SEMANTIC_SHA256,
  secondHistoricalDeclaredMainTarget,
  secondHistoricalDirection,
} from "../server/scripts/second-historical-import-config";
import {
  assertSecondHistoricalProductionAuthorization,
  parseSecondHistoricalImportArguments,
} from "../server/scripts/import-second-historical-contracts";
import { repairSecondHistoricalFinancialRoot } from "../server/scripts/repair-second-historical-financial-links";

describe("第二批历史合同冻结导入配置", () => {
  const importerSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "server/scripts/import-second-historical-contracts.ts",
    ),
    "utf8",
  );
  const financialRepairSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "server/scripts/repair-second-historical-financial-links.ts",
    ),
    "utf8",
  );

  it("冻结39个合同族、41份主合同且只恢复一份龙潭湖合同", () => {
    expect(SECOND_HISTORICAL_IMPORT_FAMILIES).toHaveLength(39);
    const roots = SECOND_HISTORICAL_IMPORT_FAMILIES.flatMap(
      (family) =>
        family.roots?.filter(
          (root) =>
            secondHistoricalDeclaredMainTarget(root) === "sealed_contract",
        ) || [{ mainFileName: family.mainFileName }],
    );
    expect(roots).toHaveLength(41);
    expect(
      SECOND_HISTORICAL_IMPORT_FAMILIES.filter(
        (family) => family.restoreContractId,
      ),
    ).toEqual([
      expect.objectContaining({
        id: "second-022",
        restoreContractId: "sdylIKVZJDN8jYQ342rOL",
      }),
    ]);
  });

  it("2024年10月31日护套线合同仅归入11月6日合同的辅助材料", () => {
    const family = SECOND_HISTORICAL_IMPORT_FAMILIES.find(
      (item) => item.id === "second-018",
    );
    const source = family?.roots?.find(
      (root) => root.mainFileName === "1-产品购销合同-20241031￥157527.78.pdf",
    );
    const canonical = family?.roots?.find(
      (root) => root.mainFileName === family.mainFileName,
    );

    expect(secondHistoricalDeclaredMainTarget(source!)).toBe("auxiliary");
    expect(secondHistoricalDeclaredMainTarget(canonical!)).toBe(
      "sealed_contract",
    );
    expect(canonical).toEqual(
      expect.objectContaining({
        mainFileName: "1-产品购销合同-20241106￥157527.78.pdf",
        ownsSupplements: true,
      }),
    );
    expect(SECOND_HISTORICAL_IMPORT_EXPECTED_ASSIGNMENT_COUNTS).toEqual({
      sealed_contract: 41,
      agreement: 6,
      financial: 219,
      archive: 3,
      auxiliary: 115,
    });
  });

  it("辅助材料规则不借用仅归档语义", () => {
    expect(() =>
      secondHistoricalDeclaredMainTarget({
        mainFileName: "冲突.pdf",
        archiveOnly: true,
        auxiliaryOnly: true,
      }),
    ).toThrow("不能同时设为仅归档和仅辅助材料");
  });

  it("非主营支出独立建模为成本，不能沿用资产类判断", () => {
    const expenseFamilies = SECOND_HISTORICAL_IMPORT_FAMILIES.filter(
      (family) => family.declaredSubtype === "non_main_expense",
    );
    expect(expenseFamilies).toHaveLength(11);
    expect(
      expenseFamilies.every((family) => family.category === "non_main"),
    ).toBe(true);
    expect(
      expenseFamilies.every(
        (family) => secondHistoricalDirection(family) === "cost",
      ),
    ).toBe(true);
  });

  it("裕和嘉园使用996套目标和906套当前确认值", () => {
    const target = SECOND_HISTORICAL_IMPORT_FAMILIES.find(
      (family) => family.id === "second-029",
    );
    expect(target?.target).toEqual({
      amount: 996000,
      quantity: 996,
      unitPrice: 1000,
      confirmedAmount: 906000,
      confirmedQuantity: 906,
      quantityUnit: "套",
    });
  });

  it("使用合同正文核验后的完整项目名称", () => {
    expect(
      SECOND_HISTORICAL_IMPORT_FAMILIES.find(
        (family) => family.id === "second-004",
      )?.projectName,
    ).toBe("璞湾项目咨询服务");
    expect(
      SECOND_HISTORICAL_IMPORT_FAMILIES.find(
        (family) => family.id === "second-026",
      )?.projectName,
    ).toBe("国网北京海淀供电公司后屯110千伏变电站房屋检测服务");
  });

  it("冻结384份源文件摘要并建立逐文件审计表", () => {
    expect(SECOND_HISTORICAL_IMPORT_EXPECTED_FILE_COUNT).toBe(384);
    expect(SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(importerSource).toContain("contract_historical_import_files");
    expect(importerSource).toContain(
      "mappings.size !== plan.sourceFiles.length",
    );
  });

  it("开发模式保持原门禁，生产模式使用独立显式授权", () => {
    expect(importerSource).toContain('process.env.NODE_ENV !== "development"');
    expect(importerSource).toContain('path.resolve(process.cwd()) !== "/app"');
    expect(importerSource).toContain("数据库连接字符串疑似生产环境");
    expect(importerSource).toContain("开发容器专用环境标记");
    expect(importerSource).toContain('process.env.NODE_ENV !== "production"');
    expect(importerSource).toContain(
      "SECOND_HISTORICAL_PRODUCTION_CONFIRMATION",
    );
    expect(importerSource).toContain("SECOND_HISTORICAL_RECEIPT_OCR_SHA256");
    expect(importerSource).not.toContain("yulilog-postgres-prod");
    expect(importerSource).not.toContain("docker-compose.prod");
  });

  it("生产提交同时锁定清单摘要、确认令牌与回单复核摘要", () => {
    const args = parseSecondHistoricalImportArguments([
      "--commit",
      "--target=production",
      "--source-root=/tmp/source",
      "--receipt-ocr=/tmp/receipt.json",
      `--manifest-sha256=${SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH}`,
      `--semantic-sha256=${SECOND_HISTORICAL_SEMANTIC_SHA256}`,
      `--target-database-sha256=${"1".repeat(64)}`,
      `--confirm-production=${SECOND_HISTORICAL_PRODUCTION_CONFIRMATION}`,
    ]);
    expect(args).toMatchObject({
      mode: "commit",
      target: "production",
      manifestSha256: SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
      semanticSha256: SECOND_HISTORICAL_SEMANTIC_SHA256,
      targetDatabaseSha256: "1".repeat(64),
      productionConfirmation: SECOND_HISTORICAL_PRODUCTION_CONFIRMATION,
    });
    expect(() =>
      assertSecondHistoricalProductionAuthorization(
        args,
        { manifestHash: SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH },
        SECOND_HISTORICAL_RECEIPT_OCR_SHA256,
        SECOND_HISTORICAL_SEMANTIC_SHA256,
        { NODE_ENV: "production", VITE_ENABLE_WORKLOG: "" },
        "/app",
      ),
    ).not.toThrow();
    expect(() =>
      assertSecondHistoricalProductionAuthorization(
        { ...args, productionConfirmation: "错误令牌" },
        { manifestHash: SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH },
        SECOND_HISTORICAL_RECEIPT_OCR_SHA256,
        SECOND_HISTORICAL_SEMANTIC_SHA256,
        { NODE_ENV: "production", VITE_ENABLE_WORKLOG: "" },
        "/app",
      ),
    ).toThrow("生产提交必须显式指定");
    expect(() =>
      assertSecondHistoricalProductionAuthorization(
        args,
        { manifestHash: SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH },
        "0".repeat(64),
        SECOND_HISTORICAL_SEMANTIC_SHA256,
        { NODE_ENV: "production", VITE_ENABLE_WORKLOG: "" },
        "/app",
      ),
    ).toThrow("回单复核文件摘要");
  });

  it("生产预演也强制双清单摘要、目标库摘要与真实回单文件", () => {
    const args = parseSecondHistoricalImportArguments([
      "--dry-run",
      "--target",
      "production",
      "--manifest-sha256",
      SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
      "--semantic-sha256",
      SECOND_HISTORICAL_SEMANTIC_SHA256,
      "--target-database-sha256",
      "1".repeat(64),
      "--receipt-ocr",
      "/tmp/receipt.json",
    ]);
    expect(() =>
      assertSecondHistoricalProductionAuthorization(
        args,
        { manifestHash: SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH },
        SECOND_HISTORICAL_RECEIPT_OCR_SHA256,
        SECOND_HISTORICAL_SEMANTIC_SHA256,
        { NODE_ENV: "production" },
        "/app",
      ),
    ).not.toThrow();
  });

  it("生产执行具备完整回滚、序列隔离、附件清理与不确定提交保护", () => {
    expect(importerSource).toContain('await client.query("ROLLBACK")');
    expect(importerSource).toContain("sequenceAdvanced: false");
    expect(importerSource).toContain("cleanupCopiedFiles(copiedFiles)");
    expect(importerSource).toContain("commitOutcomeUncertain");
    expect(importerSource).toContain("禁止重试");
    expect(importerSource).toContain("assertProductionIncrements");
    expect(importerSource).toContain("assertDragonProductionBaseline");
    expect(importerSource).toContain("assertProductionCrossModuleConflicts");
    expect(importerSource).toContain("assertNoSymlinkComponents");
    expect(importerSource).toContain("已完成第二批156条财务匹配关系");
    expect(importerSource).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(importerSource).toContain(
      "LOCK TABLE contracts IN SHARE ROW EXCLUSIVE MODE",
    );
    expect(importerSource).toContain("assertProductionContractSequence");
    expect(importerSource).toContain("reimbursement_deduction_invoices");
    expect(importerSource).toContain("contract_external_payments");
  });

  it("同批财务关系已有完成标记时只读跳过且不重复写入", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("action='historical_contract_imported'")) {
        return { rows: [{ id: "import-audit" }] };
      }
      if (sql.includes("SELECT * FROM contracts")) {
        return {
          rows: [
            {
              id: "contract-1",
              financial_direction: "income",
            },
          ],
        };
      }
      if (sql.includes("action='historical_financial_links_rebuilt'")) {
        return {
          rows: [
            {
              changes_json: {
                registrationId: "registration-1",
                closed: true,
              },
            },
          ],
        };
      }
      throw new Error(`出现未预期查询：${sql}`);
    });

    const result = await repairSecondHistoricalFinancialRoot(
      { query } as never,
      "contract-1",
      { id: "actor-1", role: "admin" },
      "2026-09-10T00:00:00.000Z",
      { allowedFinancialFileIds: ["file-1", "file-2"] },
    );

    expect(result).toMatchObject({
      rootId: "contract-1",
      registrationId: "registration-1",
      status: "confirmed",
      skipped: true,
    });
    expect(
      query.mock.calls.some(([sql]) =>
        /^(?:INSERT|UPDATE|DELETE)\b/iu.test(sql.trim()),
      ),
    ).toBe(false);
  });

  it("主导入把财务关系重建纳入同一批事务", () => {
    expect(importerSource).toContain("repairSecondHistoricalFinancialRoot");
    expect(importerSource).toContain("financialLinkResults");
    expect(importerSource).toContain("assertCompletedImportIntegrity");
    expect(financialRepairSource).toContain("contract_historical_import_files");
    expect(financialRepairSource).toContain(
      "historical_financial_links_rebuilt",
    );
    expect(financialRepairSource).toContain(
      "second-historical-contract-import:",
    );
  });

  it("命令行必须明确且只能选择预演或提交", () => {
    expect(() => parseSecondHistoricalImportArguments([])).toThrow(
      "必须且只能指定",
    );
    expect(() =>
      parseSecondHistoricalImportArguments(["--dry-run", "--commit"]),
    ).toThrow("必须且只能指定");
    expect(
      parseSecondHistoricalImportArguments([
        "--dry-run",
        "--source-root",
        "/tmp/a",
      ]),
    ).toMatchObject({
      mode: "dry-run",
      target: "development",
      sourceRoot: "/tmp/a",
    });
    expect(() =>
      parseSecondHistoricalImportArguments(["--dry-run", "--unknown"]),
    ).toThrow("不支持的命令行参数");
    expect(() =>
      parseSecondHistoricalImportArguments([
        "--dry-run",
        "--source-root=/tmp/a",
        "--source-root=/tmp/b",
      ]),
    ).toThrow("命令行参数重复");
    expect(() =>
      parseSecondHistoricalImportArguments([
        "--dry-run",
        "--manifest-sha256",
        SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
      ]),
    ).toThrow("开发目标不得携带生产确认参数");
  });
});
