/** @jest-environment node */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";

let mockNanoIdCounter = 0;
jest.mock("nanoid", () => ({
  nanoid: () => `monthly-group-id-${(mockNanoIdCounter += 1)}`,
}));

jest.mock("../server/services/contractService", () => ({
  postContractFinancialSettlements: jest.fn(async () => ({
    id: "contract-1",
    status: "executing",
  })),
  confirmContractFinancialRegistrationInTransaction: jest.fn(async () => ({
    id: "contract-1",
    status: "executing",
  })),
}));

jest.mock("../server/services/invoiceApplication", () => ({
  lockInvoiceApplicationRootByFinancialSource: jest.fn(async () => undefined),
}));

import {
  confirmContractFinancialRegistrationInTransaction,
  postContractFinancialSettlements,
} from "../server/services/contractService";
import {
  bridgeMonthlyBankTransactionGroupsToContractRegistrations,
  cleanupMonthlyContractBridgeGroupFiles,
} from "../server/services/monthlyFinancialContractBridge";

const NOW = "2026-08-26T12:00:00.000Z";
const SOURCE_FILE_HASH = "a".repeat(64);
const RAW_TEXT_HASH = "b".repeat(64);
const TEST_DIRECTORY = path.resolve(
  process.cwd(),
  "uploads/monthly-financial-bank/recognized/monthly-contract-group-test",
);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]);

function jpegBytesFor(id: string): Buffer {
  return Buffer.concat([JPEG_BYTES, Buffer.from(id, "utf8")]);
}

function sourceRelativePath(id: string): string {
  return path.relative(process.cwd(), path.join(TEST_DIRECTORY, `${id}.jpg`));
}

function transactionFixture(
  id: string,
  amount: string,
  overrides: Record<string, unknown> = {},
) {
  const suffix = id.replace(/\D/gu, "").padStart(4, "0");
  return {
    id,
    report_month: "2026-06",
    account_code: "general",
    transaction_date: "2026-06-08",
    amount,
    currency: "CNY",
    direction: "inflow",
    payer_name: "国网北京市电力公司",
    payer_account: "212300490",
    payee_name: "北京羽隶工程咨询有限公司",
    payee_account: "0200303519000018418",
    electronic_receipt_no: `0915-5931-${suffix}-1100`,
    normalized_electronic_receipt_no: `09155931${suffix}1100`,
    transaction_serial_no: `SERIAL-${suffix}`,
    proof_no: null,
    summary: "CQ1M_朝阳公司付羽隶",
    remark: "姜庄湖110千伏送出工程前期手续咨询服务进度款",
    page_number: Number(suffix),
    crop_path: sourceRelativePath(id),
    category: "main_income",
    recognition_status: "review_required",
    warnings_json: [
      "MONTHLY_BANK_CONTRACT_MATCH_REQUIRED: 未找到对应的已确认合同收付款记录",
    ],
    anomalies_json: [],
    raw_ocr_json: {
      sourceFileHash: SOURCE_FILE_HASH,
      rawTextHash: RAW_TEXT_HASH,
    },
    current_file_id: `bank-file-${id}`,
    source_file_hash: SOURCE_FILE_HASH,
    source_file_active: true,
    ...overrides,
  };
}

function candidateFixture(overrides: Record<string, unknown> = {}) {
  return {
    registration_id: "registration-1",
    direction_invoice_record_id: "invoice-1",
    contract_id: "contract-1",
    contract_status: "effective",
    root_status: "effective",
    contract_category: "main_business",
    root_financial_direction: "income",
    contract_party_a: "国网北京市电力公司",
    contract_party_b: "北京羽隶工程咨询有限公司",
    contract_project_name: null,
    root_project_name: "姜庄湖220千伏变电站110千伏送出工程前期手续技术咨询服务",
    contract_title: null,
    root_title: null,
    contract_business_contract_no: null,
    root_business_contract_no: null,
    contract_worklog_project_name: null,
    root_worklog_project_name: "姜庄湖",
    contract_area: null,
    root_area: null,
    contract_worklog_project_district: null,
    root_worklog_project_district: null,
    invoice_item_id: "invoice-item-1",
    invoice_record_id: "invoice-1",
    invoice_amount: "100000.00",
    invoice_date: "2026-05-13",
    invoice_buyer: "国网北京市电力公司",
    invoice_seller: "北京羽隶工程咨询有限公司",
    invoice_status: "draft",
    invoice_job_status: "consumed",
    invoice_validation_status: "verified",
    invoice_document_status: "normal",
    invoice_direction: "output",
    invoice_can_auto_post: true,
    ...overrides,
  };
}

function createClient(input: {
  transactions: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
  refreshedCandidates?: Array<Record<string, unknown>>;
  duplicatedReceiptNos?: string[];
}) {
  const sqlHistory: Array<{ sql: string; params: unknown[] }> = [];
  let candidateQueryCount = 0;
  const candidates = input.candidates || [candidateFixture()];
  const refreshedCandidates = input.refreshedCandidates || candidates;
  const transactionMap = new Map(
    input.transactions.map((transaction) => [transaction.id, transaction]),
  );
  const duplicated = new Set(input.duplicatedReceiptNos || []);
  const query = jest.fn(async (sqlValue: string, params: unknown[] = []) => {
    const sql = String(sqlValue);
    sqlHistory.push({ sql, params });
    if (
      sql.includes("FROM monthly_financial_bank_transactions transaction") &&
      sql.includes("FOR UPDATE OF transaction, file")
    ) {
      const row = transactionMap.get(String(params[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("FROM contract_financial_registrations registration")) {
      candidateQueryCount += 1;
      const source =
        candidateQueryCount === 1 ? candidates : refreshedCandidates;
      const rows = params[0]
        ? source.filter((row) => row.registration_id === params[0])
        : source;
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("AS duplicated")) {
      return {
        rows: [{ duplicated: duplicated.has(String(params[0])) }],
        rowCount: 1,
      };
    }
    if (
      sql.includes("UPDATE contract_financial_registrations") &&
      sql.includes("RETURNING id")
    ) {
      return { rows: [{ id: "registration-1" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  return {
    client: { query } as unknown as PoolClient,
    sqlHistory,
  };
}

function insertQueries(
  sqlHistory: Array<{ sql: string; params: unknown[] }>,
  table: string,
) {
  return sqlHistory.filter(({ sql }) => sql.includes(`INSERT INTO ${table}`));
}

describe("月报同一项目多张回单组桥接", () => {
  beforeAll(async () => {
    await fs.promises.mkdir(TEST_DIRECTORY, { recursive: true });
    for (const id of ["transaction-1", "transaction-2", "transaction-3"]) {
      await fs.promises.writeFile(
        path.join(TEST_DIRECTORY, `${id}.jpg`),
        jpegBytesFor(id),
      );
    }
  });

  beforeEach(() => {
    mockNanoIdCounter = 0;
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await fs.promises.rm(TEST_DIRECTORY, { recursive: true, force: true });
  });

  it("两张五万元回单完整覆盖十万元发票时分别建档并一次确认", async () => {
    const { client, sqlHistory } = createClient({
      transactions: [
        transactionFixture("transaction-1", "50000.00"),
        transactionFixture("transaction-2", "50000.00"),
      ],
    });

    const results =
      await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2"],
        "admin-1",
        "admin",
        NOW,
      );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: "created",
      changed: true,
      transactionIds: ["transaction-1", "transaction-2"],
      contractId: "contract-1",
      registrationId: "registration-1",
      registrationConfirmed: true,
    });
    expect(results[0]!.receipts).toHaveLength(2);
    expect(insertQueries(sqlHistory, "contract_files")).toHaveLength(2);
    expect(
      insertQueries(sqlHistory, "contract_financial_ocr_jobs"),
    ).toHaveLength(2);
    expect(insertQueries(sqlHistory, "contract_receipts")).toHaveLength(2);
    expect(
      insertQueries(sqlHistory, "contract_financial_registration_items"),
    ).toHaveLength(2);
    expect(
      insertQueries(sqlHistory, "contract_financial_registration_matches"),
    ).toHaveLength(2);
    expect(insertQueries(sqlHistory, "contract_audit_logs")).toHaveLength(2);
    expect(postContractFinancialSettlements).toHaveBeenCalledTimes(1);
    expect(postContractFinancialSettlements).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        settlementRecordIds: results[0]!.receipts.map(
          ({ receiptRecordId }) => receiptRecordId,
        ),
      }),
    );
    expect(
      confirmContractFinancialRegistrationInTransaction,
    ).toHaveBeenCalledTimes(1);
    await cleanupMonthlyContractBridgeGroupFiles(results[0]!);
  });

  it("组内每张均可用完整唯一行政区候选独立归属同一项目", async () => {
    const target = candidateFixture({
      root_project_name: null,
      root_worklog_project_name: null,
      root_area: "朝阳区",
    });
    const other = candidateFixture({
      registration_id: "registration-2",
      contract_id: "contract-2",
      direction_invoice_record_id: "invoice-2",
      invoice_item_id: "invoice-item-2",
      invoice_record_id: "invoice-2",
      root_project_name: null,
      root_worklog_project_name: null,
      root_area: "海淀区",
    });
    const { client, sqlHistory } = createClient({
      transactions: [
        transactionFixture("transaction-1", "50000.00", {
          summary: "朝阳公司付羽隶",
          remark: "本期进度款",
        }),
        transactionFixture("transaction-2", "50000.00", {
          summary: "朝阳供电公司付羽隶",
          remark: "本期进度款",
        }),
      ],
      candidates: [target, other],
      refreshedCandidates: [target, other],
    });

    const results =
      await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2"],
        "admin-1",
        "admin",
        NOW,
      );

    expect(results[0]?.status).toBe("created");
    const audits = insertQueries(sqlHistory, "contract_audit_logs");
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(JSON.parse(String(audit.params[5]))).toMatchObject({
        matchMethod: "administrative_region_fallback",
        regionFilterVersion: "beijing-region-fallback-v1",
        matchedRegion: "朝阳区",
      });
    }
    await cleanupMonthlyContractBridgeGroupFiles(results[0]!);
  });

  it("三张回单支持多发票多回单金额矩阵", async () => {
    const candidates = [
      candidateFixture({
        invoice_item_id: "invoice-item-1",
        invoice_record_id: "invoice-1",
        invoice_amount: "40000.00",
      }),
      candidateFixture({
        invoice_item_id: "invoice-item-2",
        invoice_record_id: "invoice-2",
        invoice_amount: "60000.00",
      }),
    ];
    const { client, sqlHistory } = createClient({
      transactions: [
        transactionFixture("transaction-1", "30000.00"),
        transactionFixture("transaction-2", "30000.00"),
        transactionFixture("transaction-3", "40000.00"),
      ],
      candidates,
    });

    const results =
      await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2", "transaction-3"],
        "admin-1",
        "admin",
        NOW,
      );

    expect(results[0]?.status).toBe("created");
    expect(results[0]?.receipts).toHaveLength(3);
    const matches = insertQueries(
      sqlHistory,
      "contract_financial_registration_matches",
    );
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(
      matches.reduce((sum, query) => sum + Number(query.params[5]), 0),
    ).toBe(100000);
    await cleanupMonthlyContractBridgeGroupFiles(results[0]!);
  });

  it.each([
    ["合计不足", ["40000.00", "50000.00"], "不足"],
    ["合计超额", ["60000.00", "50000.00"], "超过"],
  ])("%s时整组保持待关联", async (_label, amounts, warning) => {
    const { client, sqlHistory } = createClient({
      transactions: amounts.map((amount, index) =>
        transactionFixture(`transaction-${index + 1}`, amount),
      ),
    });

    const results =
      await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2"],
        "admin-1",
        "admin",
        NOW,
      );

    expect(results[0]?.status).toBe("pending");
    expect(results[0]?.warnings.join("；")).toContain(warning);
    expect(insertQueries(sqlHistory, "contract_files")).toHaveLength(0);
  });

  it("其中一张只有通用泛词时不能由另一张项目回单带入组", async () => {
    const { client, sqlHistory } = createClient({
      transactions: [
        transactionFixture("transaction-1", "50000.00"),
        transactionFixture("transaction-2", "50000.00", {
          summary: null,
          remark: "前期手续技术咨询服务进度款",
        }),
      ],
    });

    const results =
      await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2"],
        "admin-1",
        "admin",
        NOW,
      );

    expect(results).toEqual([]);
    expect(insertQueries(sqlHistory, "contract_files")).toHaveLength(0);
  });

  it("其中一张存在识别异常时整组不自动写入", async () => {
    const { client, sqlHistory } = createClient({
      transactions: [
        transactionFixture("transaction-1", "50000.00"),
        transactionFixture("transaction-2", "50000.00", {
          anomalies_json: ["金额区域存在冲突"],
        }),
      ],
    });

    const results =
      await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2"],
        "admin-1",
        "admin",
        NOW,
      );

    expect(results).toEqual([]);
    expect(insertQueries(sqlHistory, "contract_files")).toHaveLength(0);
  });

  it("两张回单分别唯一属于不同项目时禁止跨项目合并", async () => {
    const otherCandidate = candidateFixture({
      registration_id: "registration-2",
      contract_id: "contract-2",
      direction_invoice_record_id: "invoice-2",
      invoice_item_id: "invoice-item-2",
      invoice_record_id: "invoice-2",
      root_project_name: "费家村110千伏输变电工程前期手续技术咨询服务",
      root_worklog_project_name: "费家村",
    });
    const { client, sqlHistory } = createClient({
      transactions: [
        transactionFixture("transaction-1", "50000.00"),
        transactionFixture("transaction-2", "50000.00", {
          remark: "费家村110千伏输变电工程前期手续咨询服务进度款",
        }),
      ],
      candidates: [candidateFixture(), otherCandidate],
    });

    const results =
      await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2"],
        "admin-1",
        "admin",
        NOW,
      );

    expect(results).toEqual([]);
    expect(insertQueries(sqlHistory, "contract_files")).toHaveLength(0);
  });

  it("任一回单已重复登记时整组不写业务表并清理复制文件", async () => {
    const duplicateNo = String(
      transactionFixture("transaction-2", "50000.00")
        .normalized_electronic_receipt_no,
    );
    const { client, sqlHistory } = createClient({
      transactions: [
        transactionFixture("transaction-1", "50000.00"),
        transactionFixture("transaction-2", "50000.00"),
      ],
      duplicatedReceiptNos: [duplicateNo],
    });

    const results =
      await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2"],
        "admin-1",
        "admin",
        NOW,
      );

    expect(results[0]?.status).toBe("pending");
    expect(results[0]?.warnings.join("；")).toContain("存在已登记");
    expect(insertQueries(sqlHistory, "contract_files")).toHaveLength(0);
    for (const id of ["transaction-1", "transaction-2"]) {
      const cropHash = crypto
        .createHash("sha256")
        .update(jpegBytesFor(id))
        .digest("hex");
      const copiedPath = path.resolve(
        process.cwd(),
        `uploads/contracts/2026/08/26/monthly-${id}-${cropHash.slice(0, 12)}.jpg`,
      );
      await expect(fs.promises.access(copiedPath)).rejects.toThrow();
    }
  });

  it("组内两张回单号相同则在写表前整组拒绝", async () => {
    const first = transactionFixture("transaction-1", "50000.00");
    const second = transactionFixture("transaction-2", "50000.00", {
      electronic_receipt_no: first.electronic_receipt_no,
      normalized_electronic_receipt_no: first.normalized_electronic_receipt_no,
    });
    const { client, sqlHistory } = createClient({
      transactions: [first, second],
    });

    const results =
      await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2"],
        "admin-1",
        "admin",
        NOW,
      );

    expect(results[0]?.status).toBe("pending");
    expect(results[0]?.warnings.join("；")).toContain("组内存在重复");
    expect(insertQueries(sqlHistory, "contract_files")).toHaveLength(0);
  });

  it("组内两张裁片摘要相同时在写表前整组拒绝", async () => {
    const secondPath = path.join(TEST_DIRECTORY, "transaction-2.jpg");
    await fs.promises.writeFile(secondPath, jpegBytesFor("transaction-1"));
    try {
      const { client, sqlHistory } = createClient({
        transactions: [
          transactionFixture("transaction-1", "50000.00"),
          transactionFixture("transaction-2", "50000.00"),
        ],
      });

      const results =
        await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
          client,
          ["transaction-1", "transaction-2"],
          "admin-1",
          "admin",
          NOW,
        );

      expect(results[0]?.status).toBe("pending");
      expect(results[0]?.warnings.join("；")).toContain("文件摘要");
      expect(insertQueries(sqlHistory, "contract_files")).toHaveLength(0);
    } finally {
      await fs.promises.writeFile(secondPath, jpegBytesFor("transaction-2"));
    }
  });

  it("第二张裁片不可用时清理第一张新复制文件且不写业务表", async () => {
    const secondPath = path.join(TEST_DIRECTORY, "transaction-2.jpg");
    await fs.promises.rm(secondPath, { force: true });
    const firstHash = crypto
      .createHash("sha256")
      .update(jpegBytesFor("transaction-1"))
      .digest("hex");
    const firstCopiedPath = path.resolve(
      process.cwd(),
      `uploads/contracts/2026/08/26/monthly-transaction-1-${firstHash.slice(0, 12)}.jpg`,
    );
    try {
      const { client, sqlHistory } = createClient({
        transactions: [
          transactionFixture("transaction-1", "50000.00"),
          transactionFixture("transaction-2", "50000.00"),
        ],
      });

      await expect(
        bridgeMonthlyBankTransactionGroupsToContractRegistrations(
          client,
          ["transaction-1", "transaction-2"],
          "admin-1",
          "admin",
          NOW,
        ),
      ).rejects.toThrow();
      expect(insertQueries(sqlHistory, "contract_files")).toHaveLength(0);
      await expect(fs.promises.access(firstCopiedPath)).rejects.toThrow();
    } finally {
      await fs.promises.writeFile(secondPath, jpegBytesFor("transaction-2"));
    }
  });

  it.each([
    ["合同回款批量入账", postContractFinancialSettlements],
    ["合同财务登记确认", confirmContractFinancialRegistrationInTransaction],
  ])("%s失败时拒绝组桥接并清理两张复制文件", async (_label, service) => {
    (service as jest.Mock).mockRejectedValueOnce(new Error("模拟事务失败"));
    const { client } = createClient({
      transactions: [
        transactionFixture("transaction-1", "50000.00"),
        transactionFixture("transaction-2", "50000.00"),
      ],
    });

    await expect(
      bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2"],
        "admin-1",
        "admin",
        NOW,
      ),
    ).rejects.toThrow("模拟事务失败");

    for (const id of ["transaction-1", "transaction-2"]) {
      const cropHash = crypto
        .createHash("sha256")
        .update(jpegBytesFor(id))
        .digest("hex");
      const copiedPath = path.resolve(
        process.cwd(),
        `uploads/contracts/2026/08/26/monthly-${id}-${cropHash.slice(0, 12)}.jpg`,
      );
      await expect(fs.promises.access(copiedPath)).rejects.toThrow();
    }
  });

  it("根锁后出现同项目竞争草稿时整组停止写入", async () => {
    const competitor = candidateFixture({
      registration_id: "registration-2",
      contract_id: "contract-2",
      direction_invoice_record_id: "invoice-2",
      invoice_item_id: "invoice-item-2",
      invoice_record_id: "invoice-2",
    });
    const { client, sqlHistory } = createClient({
      transactions: [
        transactionFixture("transaction-1", "50000.00"),
        transactionFixture("transaction-2", "50000.00"),
      ],
      refreshedCandidates: [candidateFixture(), competitor],
    });

    const results =
      await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
        client,
        ["transaction-1", "transaction-2"],
        "admin-1",
        "admin",
        NOW,
      );

    expect(results[0]?.status).toBe("pending");
    expect(results[0]?.warnings.join("；")).toContain("候选");
    expect(insertQueries(sqlHistory, "contract_files")).toHaveLength(0);
  });
});
