/** @jest-environment node */

import path from "node:path";

import {
  CONTRACT_LEDGER_EXCLUDED_TABLES,
  CONTRACT_LEDGER_SNAPSHOT_FORMAT_VERSION,
  CONTRACT_LEDGER_SNAPSHOT_TABLES,
  calculateManifestSha256,
  calculateSchemaFingerprint,
  calculateSnapshotContentSha256,
  canonicalJsonStringify,
  normalizeIndexDefinition,
  type ContractLedgerSnapshotManifest,
} from "../server/scripts/contract-ledger-snapshot-format.js";
import {
  assertDevelopmentExportEnvironment,
  normalizeSnapshotRow,
  normalizeStoredUploadPath,
  parseExportArguments,
  summarizeAmountRows,
} from "../server/scripts/export-contract-ledger-snapshot.js";

describe("开发最终合同台账迁移包导出", () => {
  it("迁移表覆盖财务、押金和用途记录，同时明确排除月报及费率配置", () => {
    const tables = new Set(
      CONTRACT_LEDGER_SNAPSHOT_TABLES.map((table) => table.tableName),
    );
    expect(tables.has("contracts")).toBe(true);
    expect(tables.has("contract_financial_registration_items")).toBe(true);
    expect(tables.has("contract_financial_registration_matches")).toBe(true);
    expect(tables.has("contract_payment_purpose_details")).toBe(true);
    expect(tables.has("contract_deposits")).toBe(true);
    expect(tables.has("contract_payment_deposit_receipts")).toBe(true);
    expect(tables.has("contract_rate_configs")).toBe(false);
    expect(tables.has("monthly_financial_bank_transaction_links")).toBe(false);
    expect(CONTRACT_LEDGER_EXCLUDED_TABLES).toContain("contract_rate_configs");
    expect(CONTRACT_LEDGER_EXCLUDED_TABLES).toContain(
      "monthly_financial_bank_transaction_links",
    );
  });

  it("命令行必须显式给出全新输出目录", () => {
    expect(() => parseExportArguments([], "/app")).toThrow("必须通过 --output");
    expect(
      parseExportArguments(
        [
          "--output",
          "debug/final-ledger",
          "--source-files-root=/app",
          "--snapshot-key=contract-ledger-test-v1",
        ],
        "/app",
      ),
    ).toEqual({
      outputDirectory: path.resolve("/app/debug/final-ledger"),
      sourceFilesRoot: "/app",
      snapshotKey: "contract-ledger-test-v1",
    });
    expect(() =>
      parseExportArguments(["--output", "result", "--unknown", "x"], "/app"),
    ).toThrow("不支持的参数");
  });

  it("默认只允许开发环境导出", () => {
    expect(() =>
      assertDevelopmentExportEnvironment({ NODE_ENV: "production" }),
    ).toThrow("只允许");
    expect(() =>
      assertDevelopmentExportEnvironment({ NODE_ENV: "development" }),
    ).not.toThrow();
  });

  it("附件只接受 uploads 内的相对路径并统一分隔符", () => {
    expect(
      normalizeStoredUploadPath(
        "uploads\\contracts\\2026\\08\\27\\receipt.png",
      ),
    ).toBe("uploads/contracts/2026/08/27/receipt.png");
    expect(() => normalizeStoredUploadPath("/app/uploads/a.pdf")).toThrow(
      "安全",
    );
    expect(() => normalizeStoredUploadPath("uploads/../secret")).toThrow(
      "越界",
    );
    expect(() => normalizeStoredUploadPath("tmp/a.pdf")).toThrow("越界");
  });

  it("金额摘要按整数分精确累计，不经过浮点四舍五入", () => {
    const summary = summarizeAmountRows(
      [
        { id: "1", amount: "0.10", status: "confirmed" },
        { id: "2", amount: "0.20", status: "confirmed" },
        { id: "3", amount: "9.99", status: "draft" },
      ],
      "amount",
      (row) => row.status === "confirmed",
    );
    expect(summary).toEqual({ rowCount: 2, amount: "0.30", cents: "30" });
  });

  it("数据库行转换保留十进制字符串并拒绝二进制字段", () => {
    expect(
      normalizeSnapshotRow(
        { id: "row-1", amount: "123.40", data: { b: 2, a: 1 } },
        "contract_payments",
      ),
    ).toEqual({ id: "row-1", amount: "123.40", data: { b: 2, a: 1 } });
    expect(() =>
      normalizeSnapshotRow({ id: "row-1", raw: Buffer.from("x") }, "test"),
    ).toThrow("二进制");
  });

  it("清单规范化、结构指纹、内容摘要和最终摘要均可重复计算", () => {
    expect(canonicalJsonStringify({ z: 1, a: { y: 2, x: 3 } })).toBe(
      '{"a":{"x":3,"y":2},"z":1}',
    );
    const schemaTables = [
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
            constraintType: "p" as const,
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
    ];
    const schemaFingerprint = calculateSchemaFingerprint(schemaTables);
    expect(schemaFingerprint).toHaveLength(64);
    const equivalentSchema = [
      {
        ...schemaTables[0]!,
        constraints: schemaTables[0]!.constraints.map((constraint) => ({
          ...constraint,
          constraintName: "历史环境生成的其他约束名",
        })),
        indexes: [
          {
            indexName: "历史环境生成的其他索引名",
            definition:
              "CREATE UNIQUE INDEX other_name ON contracts USING btree (id)",
          },
          {
            indexName: "重复但语义相同的索引",
            definition:
              "CREATE UNIQUE INDEX duplicate_name ON public.contracts USING btree (id)",
          },
        ],
      },
    ];
    expect(calculateSchemaFingerprint(equivalentSchema)).toBe(
      schemaFingerprint,
    );
    const incompatibleSchema = [
      {
        ...equivalentSchema[0]!,
        indexes: [
          {
            indexName: "same_name",
            definition:
              "CREATE UNIQUE INDEX same_name ON public.contracts USING btree (id) WHERE (id IS NOT NULL)",
          },
        ],
      },
    ];
    expect(calculateSchemaFingerprint(incompatibleSchema)).not.toBe(
      schemaFingerprint,
    );
    expect(
      normalizeIndexDefinition(
        "CREATE UNIQUE INDEX any_name ON public.contracts USING btree (id) WHERE (id IS NOT NULL)",
      ),
    ).toBe("CREATE UNIQUE INDEX USING btree (id) WHERE (id IS NOT NULL)");

    const base = {
      formatVersion: CONTRACT_LEDGER_SNAPSHOT_FORMAT_VERSION,
      kind: "contract-ledger-snapshot" as const,
      snapshotKey: "contract-ledger-test-v1",
      exportedAt: "2026-08-28T00:00:00.000Z",
      source: {
        environment: "development" as const,
        historicalImportBatchKey: "historical-batch",
        contractCount: 1,
        rootContractCount: 1,
      },
      schema: { fingerprint: schemaFingerprint, tables: schemaTables },
      accounts: [],
      sequences: [],
      tables: [],
      files: [],
      summary: {
        tableRowCounts: {},
        contractCounts: {
          total: 1,
          roots: 1,
          supplements: 0,
          terminations: 0,
          active: 1,
          softDeleted: 0,
        },
        financialAmounts: {
          confirmedInvoices: { rowCount: 0, amount: "0.00", cents: "0" },
          confirmedReceipts: { rowCount: 0, amount: "0.00", cents: "0" },
          confirmedPayments: { rowCount: 0, amount: "0.00", cents: "0" },
          confirmedExternalPayments: {
            rowCount: 0,
            amount: "0.00",
            cents: "0",
          },
          deposits: { rowCount: 0, amount: "0.00", cents: "0" },
          settledDeposits: { rowCount: 0, amount: "0.00", cents: "0" },
        },
        financialCounts: {
          registrations: 0,
          registrationItems: 0,
          registrationMatches: 0,
          purposeDetails: 0,
          depositReceipts: 0,
        },
        accountCount: 0,
        accountReferenceCount: 0,
        storedFileCount: 0,
        uniqueBlobCount: 0,
        storedFileBytes: 0,
        uniqueBlobBytes: 0,
      },
      exclusions: [],
    };
    const contentSha256 = calculateSnapshotContentSha256(base);
    const withoutManifestHash = { ...base, contentSha256 };
    const manifest: ContractLedgerSnapshotManifest = {
      ...withoutManifestHash,
      manifestSha256: calculateManifestSha256(withoutManifestHash),
    };
    expect(manifest.contentSha256).toHaveLength(64);
    expect(manifest.manifestSha256).toHaveLength(64);
    const laterBase = {
      ...base,
      exportedAt: "2026-08-28T01:00:00.000Z",
    };
    expect(calculateSnapshotContentSha256(laterBase)).toBe(contentSha256);
    expect(
      calculateManifestSha256({
        ...laterBase,
        contentSha256,
      }),
    ).not.toBe(manifest.manifestSha256);
  });
});
