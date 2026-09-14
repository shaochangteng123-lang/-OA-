import fs from "node:fs";
import path from "node:path";

import type { PoolClient } from "pg";

import {
  SECOND_AUXILIARY_CORRECTION_DEVELOPMENT_CONFIRMATION,
  SECOND_AUXILIARY_CORRECTION_FILES,
  SECOND_AUXILIARY_CORRECTION_KEY,
  SECOND_AUXILIARY_CORRECTION_NEW_SEMANTIC_SHA256,
  SECOND_AUXILIARY_CORRECTION_PRODUCTION_CONFIRMATION,
  assertSecondAuxiliaryCorrectionAuthorization,
  assertSecondAuxiliaryCorrectionTargetDatabaseSha256,
  buildSecondAuxiliaryCorrectedBatchSummary,
  calculateSecondAuxiliaryCorrectionTargetDatabaseSha256,
  classifySecondAuxiliaryCorrectionBatch,
  parseSecondAuxiliaryCorrectionArguments,
  readCorrectionState,
  secondAuxiliaryCorrectionAmountMatches,
  secondAuxiliaryCorrectionStableId,
  secondAuxiliaryCorrectionStoredPath,
} from "../server/scripts/correct-second-historical-auxiliary-classification.js";

const oldSummary = {
  sourceFileCount: 384,
  manifestHash:
    "f7cf305f2ff3b17ddbc0837a5069f040d98ee79c3dea68ceb6e0691f5f844fc3",
  rootContractCount: 42,
  costContractCount: 22,
  auxiliaryFileCount: 114,
  importedRootIds: [
    "root-1",
    "h2_GW6LvU2BsZInN6QYJQUz",
    "h2_qHOQnKiOJUvgVW6uKoHf",
  ],
  financialLinkResults: [
    ...Array.from({ length: 41 }, (_, index) => ({ rootId: `root-${index}` })),
    { rootId: "h2_GW6LvU2BsZInN6QYJQUz" },
  ],
};

describe("第二批历史合同辅助材料归类更正", () => {
  it("默认使用开发库事务预演，提交必须显式选择令牌", () => {
    expect(parseSecondAuxiliaryCorrectionArguments([])).toEqual({
      mode: "dry-run",
      target: "development",
      confirmationToken: null,
      targetDatabaseSha256: null,
    });
    const databaseSha256 = "1".repeat(64);
    expect(
      parseSecondAuxiliaryCorrectionArguments([
        "--commit",
        "--target=production",
        `--target-database-sha256=${databaseSha256}`,
        `--confirm-target=${SECOND_AUXILIARY_CORRECTION_PRODUCTION_CONFIRMATION}`,
      ]),
    ).toEqual({
      mode: "commit",
      target: "production",
      confirmationToken: SECOND_AUXILIARY_CORRECTION_PRODUCTION_CONFIRMATION,
      targetDatabaseSha256: databaseSha256,
    });
    expect(() =>
      parseSecondAuxiliaryCorrectionArguments([
        "--dry-run",
        "--confirm-target=unexpected",
      ]),
    ).toThrow("事务预演不得携带提交确认令牌");
    expect(() =>
      parseSecondAuxiliaryCorrectionArguments(["--dry-run", "--commit"]),
    ).toThrow("只能指定一个执行模式");
    expect(() =>
      parseSecondAuxiliaryCorrectionArguments(["--unknown"]),
    ).toThrow("不支持的命令行参数");
    expect(() =>
      parseSecondAuxiliaryCorrectionArguments([
        "--dry-run",
        "--target=production",
      ]),
    ).toThrow("64位 --target-database-sha256");
    expect(() =>
      parseSecondAuxiliaryCorrectionArguments([
        "--dry-run",
        `--target-database-sha256=${databaseSha256}`,
      ]),
    ).toThrow("开发目标不得携带");
  });

  it("开发与生产提交分别校验环境和不可互换的显式令牌", () => {
    const development = {
      mode: "commit" as const,
      target: "development" as const,
      confirmationToken: SECOND_AUXILIARY_CORRECTION_DEVELOPMENT_CONFIRMATION,
      targetDatabaseSha256: null,
    };
    expect(() =>
      assertSecondAuxiliaryCorrectionAuthorization(
        development,
        {
          NODE_ENV: "development",
          VITE_ENABLE_WORKLOG: "true",
          DATABASE_URL: "postgresql://postgres@postgres/yulilog_worklog",
        },
        "/app",
      ),
    ).not.toThrow();
    expect(() =>
      assertSecondAuxiliaryCorrectionAuthorization(
        { ...development, confirmationToken: "wrong" },
        {
          NODE_ENV: "development",
          VITE_ENABLE_WORKLOG: "true",
          DATABASE_URL: "postgresql://postgres@postgres/yulilog_worklog",
        },
        "/app",
      ),
    ).toThrow(SECOND_AUXILIARY_CORRECTION_DEVELOPMENT_CONFIRMATION);
    expect(() =>
      assertSecondAuxiliaryCorrectionAuthorization(
        {
          mode: "commit",
          target: "production",
          confirmationToken:
            SECOND_AUXILIARY_CORRECTION_PRODUCTION_CONFIRMATION,
          targetDatabaseSha256: "1".repeat(64),
        },
        {
          NODE_ENV: "production",
          VITE_ENABLE_WORKLOG: "",
          DATABASE_URL: "postgresql://postgres@postgres/yulilog_worklog",
        },
        "/app",
      ),
    ).not.toThrow();
  });

  it("生产数据库摘要绑定系统身份、数据库用户、冻结合同与批次状态", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("pg_control_system")) {
        return {
          rows: [
            {
              database_name: "yulilog_worklog",
              database_oid: "16384",
              database_user: "postgres",
              system_identifier: "7654321",
            },
          ],
        };
      }
      if (sql.includes("FROM contracts")) {
        return {
          rows: [{ id: "frozen-contract", snapshot: { status: "effective" } }],
        };
      }
      return {
        rows: [
          {
            batch_key: "historical-import-2026-09-10-second-batch-v1",
            snapshot: { status: "completed", imported_contract_count: 41 },
          },
        ],
      };
    });
    const actual = await calculateSecondAuxiliaryCorrectionTargetDatabaseSha256(
      { query } as unknown as PoolClient,
    );
    expect(actual).toMatch(/^[0-9a-f]{64}$/u);
    expect(query).toHaveBeenCalledTimes(3);
    const production = {
      mode: "dry-run" as const,
      target: "production" as const,
      confirmationToken: null,
      targetDatabaseSha256: actual,
    };
    expect(() =>
      assertSecondAuxiliaryCorrectionTargetDatabaseSha256(production, actual),
    ).not.toThrow();
    expect(() =>
      assertSecondAuxiliaryCorrectionTargetDatabaseSha256(
        production,
        "2".repeat(64),
      ),
    ).toThrow("冻结合同或批次状态摘要不一致");
  });

  it("只冻结龙潭湖两份附件和一份护套线合同原件", () => {
    expect(SECOND_AUXILIARY_CORRECTION_FILES).toHaveLength(3);
    expect(
      SECOND_AUXILIARY_CORRECTION_FILES.filter(
        (file) => file.bucket === "dragon",
      ),
    ).toHaveLength(2);
    expect(
      SECOND_AUXILIARY_CORRECTION_FILES.filter(
        (file) => file.bucket === "wire",
      ),
    ).toHaveLength(1);
    expect(
      SECOND_AUXILIARY_CORRECTION_FILES.map((file) => file.sha256),
    ).toEqual([
      "c91afa2d6234b82fc765677fd8096404bd4461d1cae60790e24c52265c940ce6",
      "7c7b7614da23f8ff5c9cef0b9ac25d691167793f06d4658e33cb454d60155f28",
      "b4023cce6f10201c76a102b8d62cb8f0115d354589d13df87585d547dd4b266a",
    ]);
    const ids = SECOND_AUXILIARY_CORRECTION_FILES.map((file) =>
      secondAuxiliaryCorrectionStableId("file", file.sha256),
    );
    expect(new Set(ids).size).toBe(3);
    for (const file of SECOND_AUXILIARY_CORRECTION_FILES) {
      expect(secondAuxiliaryCorrectionStoredPath(file)).toMatch(
        /^uploads\/contract-auxiliary\/historical\/2026\/09\/13\//u,
      );
      expect(secondAuxiliaryCorrectionStoredPath(file)).toContain(
        file.sha256.slice(0, 12),
      );
    }
  });

  it("金额身份按整数分比较，不依赖数据库数值的小数位字符串格式", () => {
    expect(secondAuxiliaryCorrectionAmountMatches("15840", 1_584_000)).toBe(
      true,
    );
    expect(secondAuxiliaryCorrectionAmountMatches("15840.0", 1_584_000)).toBe(
      true,
    );
    expect(secondAuxiliaryCorrectionAmountMatches(157_527.78, 15_752_778)).toBe(
      true,
    );
    expect(
      secondAuxiliaryCorrectionAmountMatches("236092.00", 23_609_200),
    ).toBe(true);
    expect(
      secondAuxiliaryCorrectionAmountMatches("236092.01", 23_609_200),
    ).toBe(false);
    expect(() =>
      secondAuxiliaryCorrectionAmountMatches("15840.001", 1_584_000),
    ).toThrow("金额格式不正确");
  });

  it("使用同一事务连接时按固定顺序读取更正状态", async () => {
    let activeQueries = 0;
    let maximumActiveQueries = 0;
    const statements: string[] = [];
    const query = jest.fn(async (statement: string) => {
      activeQueries += 1;
      maximumActiveQueries = Math.max(maximumActiveQueries, activeQueries);
      statements.push(statement);
      await Promise.resolve();
      activeQueries -= 1;
      return {
        rows: statement.includes("contract_historical_import_batches")
          ? [{ batch_key: "historical-import-2026-09-10-second-batch-v1" }]
          : [],
      };
    });

    await readCorrectionState({ query } as unknown as PoolClient);

    expect(query).toHaveBeenCalledTimes(9);
    expect(maximumActiveQueries).toBe(1);
    expect(
      statements.map((statement) => statement.match(/FROM\s+(\w+)/u)?.[1]),
    ).toEqual([
      "contracts",
      "contract_files",
      "contract_historical_import_files",
      "contract_auxiliary_packages",
      "contract_auxiliary_files",
      "contract_financial_file_hashes",
      "contract_audit_logs",
      "contract_audit_logs",
      "contract_historical_import_batches",
    ]);
  });

  it("把批次旧摘要精确更新为41个根合同、40个新增合同和115份辅助文件", () => {
    expect(classifySecondAuxiliaryCorrectionBatch(41, oldSummary)).toBe("old");
    const corrected = buildSecondAuxiliaryCorrectedBatchSummary(oldSummary, {
      now: "2026-09-13T12:00:00.000Z",
      actorId: "admin-id",
      actorName: "吴静雯",
      target: "development",
    });
    expect(corrected).toMatchObject({
      semanticSha256: SECOND_AUXILIARY_CORRECTION_NEW_SEMANTIC_SHA256,
      rootContractCount: 41,
      costContractCount: 21,
      auxiliaryFileCount: 115,
      auxiliaryClassificationCorrectionV1: {
        correctionKey: SECOND_AUXILIARY_CORRECTION_KEY,
        removedRootContractId: "h2_GW6LvU2BsZInN6QYJQUz",
        wireTargetContractId: "h2_qHOQnKiOJUvgVW6uKoHf",
        physicalSourceFilesPreserved: true,
      },
    });
    expect(corrected.importedRootIds).toEqual([
      "root-1",
      "h2_qHOQnKiOJUvgVW6uKoHf",
    ]);
    expect(corrected.financialLinkResults).toHaveLength(41);
    expect(corrected.financialLinkResults).not.toContainEqual({
      rootId: "h2_GW6LvU2BsZInN6QYJQUz",
    });
    expect(classifySecondAuxiliaryCorrectionBatch(40, corrected)).toBe("post");
    expect(() =>
      buildSecondAuxiliaryCorrectedBatchSummary(corrected, {
        now: "2026-09-13T12:00:00.000Z",
        actorId: "admin-id",
        actorName: "吴静雯",
        target: "development",
      }),
    ).toThrow("既不是冻结旧态");
  });

  it("脚本具有可串行化、复制核验、精确删除和提交不确定保护", () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/scripts/correct-second-historical-auxiliary-classification.ts",
      ),
      "utf8",
    );
    expect(source).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(source).toContain("COPYFILE_EXCL");
    expect(source).toContain("contract_financial_file_hashes");
    expect(source).toContain("DELETE FROM contract_files");
    expect(source).toContain("DELETE FROM contracts");
    expect(source).toContain("DELETE FROM contract_audit_logs");
    expect(source).toContain("removedContractSnapshot");
    expect(source).toContain("deletedAuditId");
    expect(source).toContain("commitOutcomeUncertain");
    expect(source).toContain("physicalSourceFilesPreserved: true");
    expect(source).toContain("completeContractRow");
    expect(source).toContain("completeImportAuditRow");
    expect(source).toContain("databaseRowsBeforeCorrection");
    expect(source).toContain("historicalImportMappings");
    expect(source).toContain("fileRelocations");
    expect(source).toContain(
      "calculateSecondAuxiliaryCorrectionTargetDatabaseSha256",
    );
    expect(source).toContain("pg_control_system");
    expect(source).not.toContain("rm(sourceAbsolutePath");
    expect(source).not.toContain("current_effective_amount.toString()");
  });
});
