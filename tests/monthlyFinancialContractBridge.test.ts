/** @jest-environment node */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";

jest.mock("nanoid", () => ({
  nanoid: () => "monthly-contract-bridge-test-id",
}));

jest.mock("../server/services/contractService", () => ({
  isContractDomainError: jest.fn(() => false),
  postContractFinancialSettlements: jest.fn(async () => ({
    id: "contract-1",
    status: "executing",
  })),
  confirmContractFinancialRegistrationInTransaction: jest.fn(async () => ({
    id: "contract-1",
    status: "executing",
  })),
  rebuildContractFinancialRegistrationMatches: jest.fn(async () => ({
    invoiceRecordIds: ["invoice-1"],
    settlementRecordIds: ["monthly-contract-bridge-test-id"],
    invoiceTotalCents: 5000000,
    settlementTotalCents: 5000000,
    allocatedTotalCents: 5000000,
    directionInvoiceRecordId: "invoice-1",
    matches: [],
  })),
}));

jest.mock("../server/services/invoiceApplication", () => ({
  lockInvoiceApplicationRoot: jest.fn(async () => "contract-1"),
  lockInvoiceApplicationRootByFinancialSource: jest.fn(async () => undefined),
}));

import {
  confirmContractFinancialRegistrationInTransaction,
  postContractFinancialSettlements,
  rebuildContractFinancialRegistrationMatches,
} from "../server/services/contractService";
import { lockInvoiceApplicationRoot } from "../server/services/invoiceApplication";
import { bridgeMonthlyBankTransactionToContractRegistration } from "../server/services/monthlyFinancialContractBridge";

const NOW = "2026-08-25T12:00:00.000Z";
const SOURCE_FILE_HASH = "a".repeat(64);
const RAW_TEXT_HASH = "b".repeat(64);
const TEST_DIRECTORY = path.resolve(
  process.cwd(),
  "uploads/monthly-financial-bank/recognized/monthly-contract-bridge-test",
);
const SOURCE_PATH = path.join(TEST_DIRECTORY, "receipt.jpg");
const SOURCE_RELATIVE_PATH = path.relative(process.cwd(), SOURCE_PATH);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]);

function transactionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "bank-transaction-1",
    report_month: "2026-06",
    account_code: "general",
    transaction_date: "2026-06-08",
    amount: "50000.00",
    currency: "CNY",
    direction: "inflow",
    payer_name: "国网北京市电力公司",
    payer_account: "212300490",
    payee_name: "北京羽隶工程咨询有限公司",
    payee_account: "0200303519000018418",
    electronic_receipt_no: "0915-5931-1503-1100",
    normalized_electronic_receipt_no: "0915593115031100",
    transaction_serial_no: null,
    proof_no: null,
    summary: null,
    remark: "本期技术咨询服务尾款",
    page_number: 17,
    crop_path: SOURCE_RELATIVE_PATH,
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
    current_file_id: "bank-file-1",
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
    root_project_name: null,
    contract_title: null,
    root_title: null,
    contract_business_contract_no: null,
    root_business_contract_no: null,
    contract_worklog_project_name: null,
    root_worklog_project_name: null,
    contract_area: null,
    root_area: null,
    contract_worklog_project_district: null,
    root_worklog_project_district: null,
    invoice_item_id: "invoice-item-1",
    invoice_record_id: "invoice-1",
    invoice_amount: "50000.00",
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

function createClient(
  input: {
    transaction?: Record<string, unknown>;
    candidates?: Array<Record<string, unknown>>;
    lockedCandidates?: Array<Record<string, unknown>>;
    duplicated?: boolean;
    openRegistration?: Record<string, unknown> | null;
    rebuilt?: Record<string, unknown>;
  } = {},
) {
  const sqlHistory: Array<{ sql: string; params: unknown[] }> = [];
  let candidateQueryCount = 0;
  const candidates = input.candidates || [candidateFixture()];
  const lockedCandidates = input.lockedCandidates || candidates;
  const transaction = transactionFixture(input.transaction);
  const defaultCandidate = candidates[0] || candidateFixture();
  const invoiceTotalCents = candidates
    .filter(
      (candidate) =>
        candidate.contract_id === defaultCandidate.contract_id &&
        candidate.invoice_amount != null,
    )
    .reduce(
      (sum, candidate) =>
        sum + Math.round(Number(candidate.invoice_amount) * 100),
      0,
    );
  const settlementTotalCents = Math.round(Number(transaction.amount) * 100);
  (rebuildContractFinancialRegistrationMatches as jest.Mock).mockResolvedValue(
    input.rebuilt || {
      invoiceRecordIds: invoiceTotalCents ? ["invoice-1"] : [],
      settlementRecordIds: ["monthly-contract-bridge-test-id"],
      invoiceTotalCents,
      settlementTotalCents,
      allocatedTotalCents: Math.min(invoiceTotalCents, settlementTotalCents),
      directionInvoiceRecordId: invoiceTotalCents ? "invoice-1" : null,
      matches: [],
    },
  );
  const query = jest.fn(async (sqlValue: string, params: unknown[] = []) => {
    const sql = String(sqlValue);
    sqlHistory.push({ sql, params });
    if (
      sql.includes("FROM monthly_financial_bank_transactions transaction") &&
      sql.includes("FOR UPDATE OF transaction, file")
    ) {
      return { rows: [transaction], rowCount: 1 };
    }
    if (
      sql.includes("FROM contracts contract") &&
      sql.includes("contract.relation_type = 'main'")
    ) {
      candidateQueryCount += 1;
      const source = candidateQueryCount === 1 ? candidates : lockedCandidates;
      const rows = source.map((row) => ({
        contract_id: row.contract_id,
        contract_category: row.contract_category,
        party_a: row.contract_party_a,
        party_b: row.contract_party_b,
        project_name: row.root_project_name || row.contract_project_name,
        business_contract_no:
          row.root_business_contract_no || row.contract_business_contract_no,
        worklog_project_name:
          row.root_worklog_project_name || row.contract_worklog_project_name,
        area:
          row.root_area &&
          row.contract_area &&
          row.root_area !== row.contract_area
            ? null
            : row.root_area || row.contract_area,
      }));
      return { rows, rowCount: rows.length };
    }
    if (
      sql.includes("SELECT id, status FROM contracts") &&
      sql.includes("FOR UPDATE")
    ) {
      return {
        rows: [{ id: defaultCandidate.contract_id, status: "effective" }],
        rowCount: 1,
      };
    }
    if (
      sql.includes("FROM contract_financial_registrations") &&
      sql.includes("status = 'draft'") &&
      sql.includes("FOR UPDATE")
    ) {
      const registrationCandidate = lockedCandidates.find(
        (candidate) => candidate.contract_id === params[0],
      );
      const openRegistration =
        input.openRegistration === undefined
          ? {
              id: registrationCandidate?.registration_id,
              settlement_kind: "receipt",
              financial_direction: "income",
              direction_invoice_record_id:
                registrationCandidate?.direction_invoice_record_id,
            }
          : input.openRegistration;
      return {
        rows: openRegistration?.id ? [openRegistration] : [],
        rowCount: openRegistration?.id ? 1 : 0,
      };
    }
    if (sql.includes("AS duplicated")) {
      return {
        rows: [{ duplicated: input.duplicated === true }],
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

async function cleanupCreatedContractEvidence(
  sqlHistory: Array<{ sql: string; params: unknown[] }>,
): Promise<void> {
  const contractFileInserts = sqlHistory.filter(({ sql }) =>
    sql.includes("INSERT INTO contract_files"),
  );
  for (const contractFileInsert of contractFileInserts) {
    const relativePath = contractFileInsert.params[3];
    if (typeof relativePath === "string") {
      await fs.promises
        .rm(path.resolve(process.cwd(), relativePath), { force: true })
        .catch(() => undefined);
    }
  }
}

describe("月报银行回单自动补合同财务草稿", () => {
  beforeAll(async () => {
    await fs.promises.mkdir(TEST_DIRECTORY, { recursive: true });
    await fs.promises.writeFile(SOURCE_PATH, JPEG_BYTES);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await fs.promises.rm(TEST_DIRECTORY, { recursive: true, force: true });
  });

  it("唯一全额闭合时复制独立证据、写入回款并复用事务内确认", async () => {
    const { client, sqlHistory } = createClient();

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result).toMatchObject({
      status: "created",
      changed: true,
      contractId: "contract-1",
      registrationId: "registration-1",
      registrationConfirmed: true,
    });
    expect(lockInvoiceApplicationRoot).toHaveBeenCalledWith(
      client,
      "contract-1",
    );
    expect(postContractFinancialSettlements).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        contractId: "contract-1",
        registrationId: "registration-1",
        settlementKind: "receipt",
        financialDirection: "income",
      }),
    );
    expect(
      confirmContractFinancialRegistrationInTransaction,
    ).toHaveBeenCalledWith(
      client,
      "registration-1",
      "admin-1",
      "admin",
      "contract-1",
    );
    expect(
      sqlHistory.some(({ sql }) =>
        sql.includes("INSERT INTO contract_financial_ocr_jobs"),
      ),
    ).toBe(true);
    expect(
      sqlHistory.some(({ sql }) =>
        sql.includes("INSERT INTO contract_receipts"),
      ),
    ).toBe(true);
    expect(
      sqlHistory.some(({ sql }) =>
        sql.includes("monthly_bank_receipt_attached"),
      ),
    ).toBe(true);
    const candidateQueries = sqlHistory.filter(
      ({ sql }) =>
        sql.includes("FROM contracts contract") &&
        sql.includes("contract.relation_type = 'main'"),
    );
    expect(candidateQueries).toHaveLength(2);
    await cleanupCreatedContractEvidence(sqlHistory);
  });

  it("命中多笔合同草稿时保持待关联且不写业务表", async () => {
    const { client, sqlHistory } = createClient({
      candidates: [
        candidateFixture(),
        candidateFixture({
          registration_id: "registration-2",
          contract_id: "contract-2",
          invoice_item_id: "invoice-item-2",
          invoice_record_id: "invoice-2",
          direction_invoice_record_id: "invoice-2",
        }),
      ],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(result.warnings.join("；")).toContain("命中多笔");
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it("同金额同主体多笔主营草稿时按回单备注中的项目名称唯一挂载", async () => {
    const target = candidateFixture({
      root_project_name:
        "姜庄湖220千伏变电站110千伏送出工程前期手续技术咨询服务",
    });
    const other = candidateFixture({
      registration_id: "registration-2",
      contract_id: "contract-2",
      invoice_item_id: "invoice-item-2",
      invoice_record_id: "invoice-2",
      direction_invoice_record_id: "invoice-2",
      root_project_name:
        "费家村220千伏变电站110千伏送出工程前期手续技术咨询服务",
    });
    const { client, sqlHistory } = createClient({
      transaction: {
        summary: "CQ1M_朝阳公司付羽隶",
        remark: "CQ1M_朝阳公司付羽隶姜庄湖110送出前期手续咨询服务尾款",
      },
      candidates: [target, other],
      lockedCandidates: [target, other],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result).toMatchObject({
      status: "created",
      changed: true,
      contractId: "contract-1",
      registrationId: "registration-1",
    });
    expect(lockInvoiceApplicationRoot).toHaveBeenCalledWith(
      client,
      "contract-1",
    );
    await cleanupCreatedContractEvidence(sqlHistory);
  });

  it("费家村类回单可通过备注简称与完整项目名称唯一对应", async () => {
    const target = candidateFixture({
      root_project_name: "费家村110千伏输变电工程前期手续技术咨询服务",
    });
    const other = candidateFixture({
      registration_id: "registration-2",
      contract_id: "contract-2",
      invoice_item_id: "invoice-item-2",
      invoice_record_id: "invoice-2",
      direction_invoice_record_id: "invoice-2",
      root_project_name: "姜庄湖110千伏输变电工程前期手续技术咨询服务",
    });
    const { client, sqlHistory } = createClient({
      transaction: {
        summary: "2Y32_朝阳公司付羽隶",
        remark: "2Y32_朝阳公司付羽隶费家村110前期手续服务首款",
      },
      candidates: [other, target],
      lockedCandidates: [other, target],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result).toMatchObject({
      status: "created",
      contractId: "contract-1",
      registrationId: "registration-1",
    });
    await cleanupCreatedContractEvidence(sqlHistory);
  });

  it("没有项目证据时可用唯一明确行政区安全缩小候选", async () => {
    const target = candidateFixture({
      root_area: "朝阳区",
    });
    const other = candidateFixture({
      registration_id: "registration-2",
      contract_id: "contract-2",
      invoice_item_id: "invoice-item-2",
      invoice_record_id: "invoice-2",
      direction_invoice_record_id: "invoice-2",
      root_area: "海淀区",
    });
    const { client, sqlHistory } = createClient({
      transaction: {
        summary: "2Y32_朝阳公司付羽隶",
        remark: "本期进度款",
      },
      candidates: [target, other],
      lockedCandidates: [target, other],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result).toMatchObject({
      status: "created",
      contractId: "contract-1",
      registrationId: "registration-1",
    });
    const audit = sqlHistory.find(({ sql }) =>
      sql.includes("monthly_bank_receipt_attached"),
    );
    expect(JSON.parse(String(audit?.params[5]))).toMatchObject({
      matchMethod: "administrative_region_fallback",
      regionFilterVersion: "beijing-region-fallback-v1",
      matchedRegion: "朝阳区",
    });
    await cleanupCreatedContractEvidence(sqlHistory);
  });

  it.each([
    [
      "两个候选同属一个行政区",
      { summary: "朝阳公司付羽隶", remark: "本期进度款" },
      { root_area: "朝阳区" },
      { root_area: "朝阳区" },
    ],
    [
      "存在行政区字段缺失候选",
      { summary: "朝阳公司付羽隶", remark: "本期进度款" },
      { root_area: "朝阳区" },
      { root_area: null },
    ],
    [
      "回单没有行政区证据",
      { summary: "国网公司付羽隶", remark: "本期进度款" },
      { root_area: "朝阳区" },
      { root_area: "海淀区" },
    ],
    [
      "只有裸行政区公司名称但没有近邻付款动词",
      { summary: "朝阳公司", remark: "本期进度款" },
      { root_area: "朝阳区" },
      { root_area: "海淀区" },
    ],
    [
      "相似地名朝阳门不能冒充朝阳区",
      { summary: "朝阳门项目", remark: "本期进度款" },
      { root_area: "朝阳区" },
      { root_area: "海淀区" },
    ],
    [
      "朝阳市公司不能冒充北京市朝阳区",
      { summary: "朝阳市公司付款", remark: "本期进度款" },
      { root_area: "朝阳区" },
      { root_area: "海淀区" },
    ],
    [
      "回单同时出现多个行政区",
      {
        summary: "朝阳公司付；海淀公司转款",
        remark: "本期进度款",
      },
      { root_area: "朝阳区" },
      { root_area: "海淀区" },
    ],
    [
      "候选合同与关联项目行政区冲突",
      { summary: "朝阳公司付羽隶", remark: "本期进度款" },
      {
        root_area: "朝阳区",
        contract_area: "海淀区",
      },
      { root_area: "海淀区" },
    ],
    [
      "备注存在未识别项目专名",
      {
        summary: "朝阳公司付羽隶",
        remark: "未知村项目五万元进度款",
      },
      { root_area: "朝阳区" },
      { root_area: "海淀区" },
    ],
  ])("%s时行政区不得强行选择", async (_label, transaction, first, second) => {
    const { client, sqlHistory } = createClient({
      transaction,
      candidates: [
        candidateFixture(first),
        candidateFixture({
          registration_id: "registration-2",
          contract_id: "contract-2",
          invoice_item_id: "invoice-item-2",
          invoice_record_id: "invoice-2",
          direction_invoice_record_id: "invoice-2",
          ...second,
        }),
      ],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it("项目名称唯一时忽略回单中的多行政区信息", async () => {
    const target = candidateFixture({
      root_area: "海淀区",
      root_project_name: "姜庄湖110千伏送出工程前期手续技术咨询服务",
    });
    const other = candidateFixture({
      registration_id: "registration-2",
      contract_id: "contract-2",
      invoice_item_id: "invoice-item-2",
      invoice_record_id: "invoice-2",
      direction_invoice_record_id: "invoice-2",
      root_area: "朝阳区",
      root_project_name: "费家村110千伏输变电工程前期手续技术咨询服务",
    });
    const { client, sqlHistory } = createClient({
      transaction: {
        summary: "朝阳公司付；海淀公司转款",
        remark: "姜庄湖110千伏送出工程前期手续服务尾款",
      },
      candidates: [target, other],
      lockedCandidates: [target, other],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("created");
    const audit = sqlHistory.find(({ sql }) =>
      sql.includes("monthly_bank_receipt_attached"),
    );
    expect(JSON.parse(String(audit?.params[5]))).toMatchObject({
      matchMethod: "project_name_anchor",
      matchedProjectName: "姜庄湖110千伏送出工程前期手续技术咨询服务",
      matchedRegion: null,
    });
    await cleanupCreatedContractEvidence(sqlHistory);
  });

  it("项目证据同时指向两个候选时不能降级使用行政区", async () => {
    const { client, sqlHistory } = createClient({
      transaction: {
        summary: "朝阳公司付羽隶",
        remark: "姜庄湖110与费家村110前期手续服务回款",
      },
      candidates: [
        candidateFixture({
          root_area: "朝阳区",
          root_project_name: "姜庄湖110千伏前期手续技术咨询服务",
        }),
        candidateFixture({
          registration_id: "registration-2",
          contract_id: "contract-2",
          invoice_item_id: "invoice-item-2",
          invoice_record_id: "invoice-2",
          direction_invoice_record_id: "invoice-2",
          root_area: "海淀区",
          root_project_name: "费家村110千伏前期手续技术咨询服务",
        }),
      ],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it("已命中项目同时夹带未知项目专名时仍保持待关联", async () => {
    const { client, sqlHistory } = createClient({
      transaction: {
        summary: "朝阳公司付羽隶",
        remark: "姜庄湖110送出前期手续服务与未知村110项目回款",
      },
      candidates: [
        candidateFixture({
          root_area: "朝阳区",
          root_project_name: "姜庄湖110千伏送出工程前期手续技术咨询服务",
        }),
        candidateFixture({
          registration_id: "registration-2",
          contract_id: "contract-2",
          invoice_item_id: "invoice-item-2",
          invoice_record_id: "invoice-2",
          direction_invoice_record_id: "invoice-2",
          root_area: "海淀区",
          root_project_name: "费家村110千伏前期手续技术咨询服务",
        }),
      ],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it("备注只有共同业务泛词时不在同金额项目间强行选择", async () => {
    const { client, sqlHistory } = createClient({
      transaction: {
        summary: null,
        remark: "110千伏送出工程前期手续技术咨询服务进度款",
      },
      candidates: [
        candidateFixture({
          root_project_name:
            "姜庄湖220千伏变电站110千伏送出工程前期手续技术咨询服务",
        }),
        candidateFixture({
          registration_id: "registration-2",
          contract_id: "contract-2",
          invoice_item_id: "invoice-item-2",
          invoice_record_id: "invoice-2",
          direction_invoice_record_id: "invoice-2",
          root_project_name:
            "费家村220千伏变电站110千伏送出工程前期手续技术咨询服务",
        }),
      ],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(result.warnings.join("；")).toContain("未形成唯一强匹配");
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it("多笔草稿均无项目名称时保持待关联", async () => {
    const { client, sqlHistory } = createClient({
      candidates: [
        candidateFixture(),
        candidateFixture({
          registration_id: "registration-2",
          contract_id: "contract-2",
          invoice_item_id: "invoice-item-2",
          invoice_record_id: "invoice-2",
          direction_invoice_record_id: "invoice-2",
        }),
      ],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it.each([
    [
      "同名两笔草稿",
      { summary: null, remark: "姜庄湖110前期手续服务尾款" },
      { root_project_name: "姜庄湖110千伏前期手续技术咨询服务" },
      { root_project_name: "姜庄湖110千伏前期手续技术咨询服务" },
    ],
    [
      "只有共同项目名称且缺少期次",
      { summary: null, remark: "姜庄湖前期手续服务进度款" },
      { root_project_name: "姜庄湖一期前期手续技术咨询服务" },
      { root_project_name: "姜庄湖二期前期手续技术咨询服务" },
    ],
    [
      "摘要和备注分别命中不同项目",
      { summary: "姜庄湖项目回款", remark: "费家村项目回款" },
      { root_project_name: "姜庄湖110千伏前期手续技术咨询服务" },
      { root_project_name: "费家村110千伏前期手续技术咨询服务" },
    ],
    [
      "只有通用合同标题",
      { summary: null, remark: "技术咨询服务进度款" },
      { root_title: "技术咨询服务合同" },
      { root_title: "工程咨询服务合同" },
    ],
    [
      "纯数字业务合同号可能出现在回单文本中",
      { summary: "2026年度回款", remark: "本期咨询服务费" },
      { root_business_contract_no: "2026" },
      { root_business_contract_no: "2025" },
    ],
  ])("%s时不自动选择", async (_label, transaction, first, second) => {
    const { client, sqlHistory } = createClient({
      transaction,
      candidates: [
        candidateFixture(first),
        candidateFixture({
          registration_id: "registration-2",
          contract_id: "contract-2",
          invoice_item_id: "invoice-item-2",
          invoice_record_id: "invoice-2",
          direction_invoice_record_id: "invoice-2",
          ...second,
        }),
      ],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it.each([
    [
      "回单电压数字与唯一专名候选冲突",
      "姜庄湖35千伏送出工程前期手续服务尾款",
      "姜庄湖220千伏变电站110千伏送出工程前期手续技术咨询服务",
    ],
    [
      "回单期次与唯一专名候选冲突",
      "姜庄湖二期110千伏送出工程前期手续服务尾款",
      "姜庄湖一期110千伏送出工程前期手续技术咨询服务",
    ],
    [
      "回单同时出现合同电压和额外冲突电压",
      "姜庄湖110和35千伏送出工程前期手续服务尾款",
      "姜庄湖220千伏变电站110千伏送出工程前期手续技术咨询服务",
    ],
    [
      "回单同时出现合同期次和额外冲突期次",
      "姜庄湖一期和二期110千伏送出工程前期手续服务尾款",
      "姜庄湖一期110千伏送出工程前期手续技术咨询服务",
    ],
  ])("%s时保持待关联", async (_label, remark, projectName) => {
    const { client, sqlHistory } = createClient({
      transaction: { summary: null, remark },
      candidates: [
        candidateFixture({ root_project_name: projectName }),
        candidateFixture({
          registration_id: "registration-2",
          contract_id: "contract-2",
          invoice_item_id: "invoice-item-2",
          invoice_record_id: "invoice-2",
          direction_invoice_record_id: "invoice-2",
          root_project_name: "费家村110千伏输变电工程前期手续技术咨询服务",
        }),
      ],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it("没有发票或财务草稿时创建待补发票登记并立即确认实际回款", async () => {
    const { client, sqlHistory } = createClient({
      openRegistration: null,
      rebuilt: {
        invoiceRecordIds: [],
        settlementRecordIds: ["monthly-contract-bridge-test-id"],
        invoiceTotalCents: 0,
        settlementTotalCents: 5000000,
        allocatedTotalCents: 0,
        directionInvoiceRecordId: null,
        matches: [],
      },
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result).toMatchObject({
      status: "created",
      changed: true,
      contractId: "contract-1",
      registrationId: "monthly-contract-bridge-test-id",
      registrationConfirmed: false,
    });
    expect(postContractFinancialSettlements).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        directionInvoiceRecordId: null,
        allowUnallocatedSettlement: true,
      }),
    );
    expect(
      confirmContractFinancialRegistrationInTransaction,
    ).not.toHaveBeenCalled();
    expect(
      sqlHistory.some(({ sql }) =>
        sql.includes("INSERT INTO contract_financial_registrations"),
      ),
    ).toBe(true);
    await cleanupCreatedContractEvidence(sqlHistory);
  });

  it("跨月两笔回款持续补入同一登记并在累计覆盖发票后关闭", async () => {
    const sqlHistory: Array<{ sql: string; params: unknown[] }> = [];
    let openRegistrationCreated = false;
    const transactions = new Map([
      [
        "bank-transaction-june",
        transactionFixture({
          id: "bank-transaction-june",
          report_month: "2026-06",
          transaction_date: "2026-06-30",
          amount: "40000.00",
          electronic_receipt_no: "JUNE-RECEIPT-001",
          normalized_electronic_receipt_no: "JUNERECEIPT001",
        }),
      ],
      [
        "bank-transaction-july",
        transactionFixture({
          id: "bank-transaction-july",
          report_month: "2026-07",
          transaction_date: "2026-07-01",
          amount: "60000.00",
          electronic_receipt_no: "JULY-RECEIPT-002",
          normalized_electronic_receipt_no: "JULYRECEIPT002",
        }),
      ],
    ]);
    (
      rebuildContractFinancialRegistrationMatches as jest.Mock
    ).mockResolvedValueOnce({
      invoiceRecordIds: [],
      settlementRecordIds: ["receipt-june"],
      invoiceTotalCents: 0,
      settlementTotalCents: 4000000,
      allocatedTotalCents: 0,
      directionInvoiceRecordId: null,
      matches: [],
    });
    (
      rebuildContractFinancialRegistrationMatches as jest.Mock
    ).mockResolvedValueOnce({
      invoiceRecordIds: ["invoice-1"],
      settlementRecordIds: ["receipt-june", "receipt-july"],
      invoiceTotalCents: 10000000,
      settlementTotalCents: 10000000,
      allocatedTotalCents: 10000000,
      directionInvoiceRecordId: "invoice-1",
      matches: [],
    });
    const query = jest.fn(async (sqlValue: string, params: unknown[] = []) => {
      const sql = String(sqlValue);
      sqlHistory.push({ sql, params });
      if (
        sql.includes("FROM monthly_financial_bank_transactions transaction")
      ) {
        const transaction = transactions.get(String(params[0]));
        return { rows: transaction ? [transaction] : [], rowCount: 1 };
      }
      if (
        sql.includes("FROM contracts contract") &&
        sql.includes("contract.relation_type = 'main'")
      ) {
        return {
          rows: [
            {
              contract_id: "contract-1",
              contract_category: "main_business",
              party_a: "国网北京市电力公司",
              party_b: "北京羽隶工程咨询有限公司",
              project_name: null,
              business_contract_no: null,
              worklog_project_name: null,
              area: null,
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.includes("SELECT id, status FROM contracts") &&
        sql.includes("FOR UPDATE")
      ) {
        return {
          rows: [{ id: "contract-1", status: "executing" }],
          rowCount: 1,
        };
      }
      if (
        sql.includes("FROM contract_financial_registrations") &&
        sql.includes("status = 'draft'") &&
        sql.includes("FOR UPDATE")
      ) {
        return {
          rows: openRegistrationCreated
            ? [
                {
                  id: "monthly-contract-bridge-test-id",
                  settlement_kind: "receipt",
                  financial_direction: "income",
                  direction_invoice_record_id: "invoice-1",
                },
              ]
            : [],
          rowCount: openRegistrationCreated ? 1 : 0,
        };
      }
      if (sql.includes("INSERT INTO contract_financial_registrations")) {
        openRegistrationCreated = true;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("AS duplicated")) {
        return { rows: [{ duplicated: false }], rowCount: 1 };
      }
      if (
        sql.includes("UPDATE contract_financial_registrations") &&
        sql.includes("RETURNING id")
      ) {
        return {
          rows: [{ id: "monthly-contract-bridge-test-id" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const client = { query } as unknown as PoolClient;

    const first = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-june",
      "admin-1",
      "admin",
      NOW,
    );
    const second = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-july",
      "admin-1",
      "admin",
      NOW,
    );

    expect(first).toMatchObject({
      status: "created",
      registrationId: "monthly-contract-bridge-test-id",
      registrationConfirmed: false,
    });
    expect(second).toMatchObject({
      status: "created",
      registrationId: "monthly-contract-bridge-test-id",
      registrationConfirmed: true,
    });
    expect(postContractFinancialSettlements).toHaveBeenCalledTimes(2);
    expect(
      confirmContractFinancialRegistrationInTransaction,
    ).toHaveBeenCalledTimes(1);
    expect(
      sqlHistory.filter(({ sql }) =>
        sql.includes("INSERT INTO contract_receipts"),
      ),
    ).toHaveLength(2);
    await cleanupCreatedContractEvidence(sqlHistory);
  });

  it("合同因首笔回款达到合同额而完成时仍保留开放登记的跨月补入资格", () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/services/monthlyFinancialContractBridge.ts",
      ),
      "utf8",
    );
    expect(source).toContain("contract.status = 'completed'");
    expect(source).toContain("open_registration.status = 'draft'");
    expect(source).toContain(
      "open_registration.financial_direction = 'income'",
    );
  });

  it("月报原文件摘要证据不一致时停止桥接", async () => {
    const { client, sqlHistory } = createClient({
      transaction: {
        raw_ocr_json: {
          sourceFileHash: "c".repeat(64),
          rawTextHash: RAW_TEXT_HASH,
        },
      },
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it.each([
    ["回款金额与当前发票不一致", { invoice_amount: "49999.99" }],
    ["当前发票双方字段不一致", { invoice_buyer: "其他单位" }],
    ["当前发票验证状态失效", { invoice_validation_status: "blocked" }],
  ])("%s时仍先挂载并确认银行实际回款", async (_label, overrides) => {
    const { client, sqlHistory } = createClient({
      candidates: [candidateFixture(overrides)],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("created");
    expect(postContractFinancialSettlements).toHaveBeenCalled();
    expect(
      sqlHistory.some(({ sql }) =>
        sql.includes("INSERT INTO contract_receipts"),
      ),
    ).toBe(true);
    await cleanupCreatedContractEvidence(sqlHistory);
  });

  it("非主营合同不属于月报主营回款口径时保持待关联", async () => {
    const { client, sqlHistory } = createClient({
      candidates: [candidateFixture({ contract_category: "non_main" })],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(postContractFinancialSettlements).not.toHaveBeenCalled();
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it("锁定后主营合同候选消失时重新验证并停止写入", async () => {
    const { client, sqlHistory } = createClient({
      lockedCandidates: [],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(result.warnings.join("；")).toContain("同步期间发生变化");
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it("根锁取得后新增同金额同主体竞争草稿时停止自动挂载", async () => {
    const target = candidateFixture({
      root_project_name: "姜庄湖110千伏送出工程前期手续技术咨询服务",
    });
    const competitor = candidateFixture({
      registration_id: "registration-2",
      contract_id: "contract-2",
      invoice_item_id: "invoice-item-2",
      invoice_record_id: "invoice-2",
      direction_invoice_record_id: "invoice-2",
      root_project_name: "姜庄湖110千伏送出工程前期手续技术咨询服务",
    });
    const { client, sqlHistory } = createClient({
      candidates: [target],
      lockedCandidates: [target, competitor],
    });

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("pending");
    expect(result.warnings.join("；")).toContain("同步期间发生变化");
    const candidateQueries = sqlHistory.filter(
      ({ sql }) =>
        sql.includes("FROM contracts contract") &&
        sql.includes("contract.relation_type = 'main'"),
    );
    expect(candidateQueries).toHaveLength(2);
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });

  it("重复电子回单或文件摘要已存在时幂等跳过并清理本次复制文件", async () => {
    const { client, sqlHistory } = createClient({ duplicated: true });
    const cropHash = crypto
      .createHash("sha256")
      .update(JPEG_BYTES)
      .digest("hex");
    const expectedCopiedPath = path.resolve(
      process.cwd(),
      "uploads/contracts/2026/08/25",
      `monthly-bank-bank-transaction-1-${cropHash.slice(0, 12)}.jpg`,
    );

    const result = await bridgeMonthlyBankTransactionToContractRegistration(
      client,
      "bank-transaction-1",
      "admin-1",
      "admin",
      NOW,
    );

    expect(result.status).toBe("already_exists");
    await expect(fs.promises.access(expectedCopiedPath)).rejects.toThrow();
    expect(
      sqlHistory.some(({ sql }) => /^\s*INSERT INTO contract_/u.test(sql)),
    ).toBe(false);
  });
});
