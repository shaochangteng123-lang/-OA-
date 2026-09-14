import fs from "node:fs";
import path from "node:path";

import {
  CONTRACT_LEDGER_PRODUCTION_CONFIRMATION,
  assertProductionCommitAuthorization,
  captureTargetSchema,
  parseContractLedgerImportArguments,
  resolveStoredFilePath,
} from "../server/scripts/import-contract-ledger-snapshot.js";

describe("合同台账最终快照生产导入器", () => {
  test("命令行必须显式且只能选择预演或提交", () => {
    expect(
      parseContractLedgerImportArguments([
        "--dry-run",
        "--bundle",
        "./snapshot",
      ]).mode,
    ).toBe("dry-run");
    expect(
      parseContractLedgerImportArguments(["--commit", "--bundle=./snapshot"])
        .mode,
    ).toBe("commit");
    expect(() =>
      parseContractLedgerImportArguments(["--bundle=./snapshot"]),
    ).toThrow("必须且只能指定");
    expect(() =>
      parseContractLedgerImportArguments([
        "--dry-run",
        "--commit",
        "--bundle=./snapshot",
      ]),
    ).toThrow("必须且只能指定");
    expect(() =>
      parseContractLedgerImportArguments([
        "--dry-run",
        "--bundle=./snapshot",
        "--未知参数",
      ]),
    ).toThrow("不支持的命令行参数");
  });

  test("生产提交同时要求生产环境、确认令牌和外部清单摘要", () => {
    const digest = "a".repeat(64);
    const base = parseContractLedgerImportArguments([
      "--commit",
      "--bundle=./snapshot",
      `--confirm-production=${CONTRACT_LEDGER_PRODUCTION_CONFIRMATION}`,
      `--manifest-sha256=${digest}`,
    ]);
    expect(() =>
      assertProductionCommitAuthorization(
        base,
        { manifestSha256: digest },
        {
          NODE_ENV: "development",
        },
      ),
    ).toThrow("NODE_ENV=production");
    expect(() =>
      assertProductionCommitAuthorization(
        { ...base, confirmation: "错误令牌" },
        { manifestSha256: digest },
        { NODE_ENV: "production" },
      ),
    ).toThrow("必须显式指定");
    expect(() =>
      assertProductionCommitAuthorization(
        { ...base, manifestSha256: "b".repeat(64) },
        { manifestSha256: digest },
        { NODE_ENV: "production" },
      ),
    ).toThrow("清单摘要与迁移包清单摘要不一致");
    expect(() =>
      assertProductionCommitAuthorization(
        base,
        { manifestSha256: digest },
        { NODE_ENV: "production" },
      ),
    ).not.toThrow();
  });

  test("附件目标只能位于两类授权上传目录且不能越界", () => {
    const root = path.resolve("/tmp/contract-ledger-import-test");
    expect(
      resolveStoredFilePath(root, "uploads/contracts/2026/08/28/contract.pdf"),
    ).toBe(path.join(root, "uploads/contracts/2026/08/28/contract.pdf"));
    expect(
      resolveStoredFilePath(
        root,
        "uploads/contract-auxiliary/2026/08/28/material.pdf",
      ),
    ).toBe(
      path.join(root, "uploads/contract-auxiliary/2026/08/28/material.pdf"),
    );
    expect(() =>
      resolveStoredFilePath(root, "uploads/contracts/../../secret"),
    ).toThrow("不安全");
    expect(() =>
      resolveStoredFilePath(root, "uploads/reimbursements/invoice.pdf"),
    ).toThrow("不安全");
    expect(() =>
      resolveStoredFilePath(root, "/app/uploads/contracts/file.pdf"),
    ).toThrow("不安全");
  });

  test("生产结构捕获同时覆盖列、约束和索引", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            table_name: "contracts",
            column_name: "id",
            ordinal_position: 1,
            data_type: "text",
            udt_name: "text",
            is_nullable: "NO",
            column_default: null,
            is_identity: "NO",
            identity_generation: null,
            is_generated: "NEVER",
            generation_expression: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            table_name: "contracts",
            constraint_name: "contracts_pkey",
            constraint_type: "p",
            definition: "PRIMARY KEY (id)",
            referenced_table_name: null,
            local_columns: ["id"],
            referenced_columns: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            table_name: "contracts",
            index_name: "contracts_pkey",
            definition:
              "CREATE UNIQUE INDEX contracts_pkey ON public.contracts USING btree (id)",
          },
        ],
      });
    await expect(
      captureTargetSchema({ query } as never, ["contracts"]),
    ).resolves.toEqual([
      {
        tableName: "contracts",
        columns: [
          {
            columnName: "id",
            ordinalPosition: 1,
            dataType: "text",
            udtName: "text",
            nullable: false,
            defaultExpression: null,
            identity: null,
            generated: null,
          },
        ],
        constraints: [
          {
            constraintName: "contracts_pkey",
            constraintType: "p",
            definition: "PRIMARY KEY (id)",
            referencedTableName: null,
            localColumns: ["id"],
            referencedColumns: [],
          },
        ],
        indexes: [
          {
            indexName: "contracts_pkey",
            definition:
              "CREATE UNIQUE INDEX contracts_pkey ON public.contracts USING btree (id)",
          },
        ],
      },
    ]);
  });

  test("源码保留单事务、排他文件落位和提交结果不确定保护", () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/scripts/import-contract-ledger-snapshot.ts",
      ),
      "utf8",
    );
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("COPYFILE_EXCL");
    expect(source).toContain("SAVEPOINT contract_ledger_snapshot_dry_run");
    expect(source).toContain(
      "ROLLBACK TO SAVEPOINT contract_ledger_snapshot_dry_run",
    );
    expect(source).toContain("await insertSnapshotRows");
    expect(source).toContain("await assertPostImportState");
    expect(source).toContain("commitOutcomeUncertain");
    expect(source).toContain("已保留生产附件；禁止重试");
    expect(source).toContain("contract_rate_configs");
    expect(source).not.toContain("INSERT INTO contract_rate_configs");
    expect(source).not.toContain("monthly_financial_bank_transaction_links (");

    const dryRunStart = source.indexOf(
      "export async function verifyContractLedgerSnapshotImportWithRollback",
    );
    const dryRunEnd = source.indexOf(
      "async function assertNoSymlinkComponents",
      dryRunStart,
    );
    const dryRunSource = source.slice(dryRunStart, dryRunEnd);
    expect(dryRunSource).toContain("insertSnapshotRows");
    expect(dryRunSource).not.toContain("advanceSequences");

    const applyStart = source.indexOf(
      "export async function applyContractLedgerSnapshotImport",
    );
    const applyEnd = source.indexOf("function helpText", applyStart);
    const applySource = source.slice(applyStart, applyEnd);
    expect(applySource.indexOf("assertPostImportState")).toBeLessThan(
      applySource.indexOf("advanceSequences"),
    );
    expect(source).toContain("status='active'");
    expect(source).toContain("不能按幂等导入跳过");
  });
});
