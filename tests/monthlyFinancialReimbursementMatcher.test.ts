/** @jest-environment node */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PoolClient } from "pg";

let mockIdCounter = 0;
jest.mock("nanoid", () => ({
  nanoid: () => `matcher-test-${++mockIdCounter}`,
}));

import { reconcileMonthlyReimbursementTransactions } from "../server/services/monthlyFinancialReimbursementMatcher";

interface QueryCall {
  sql: string;
  params: unknown[];
}

interface MatcherFixture {
  transactions?: Array<Record<string, unknown>>;
  paidReimbursements?: Array<Record<string, unknown>>;
  pendingItems?: Array<Record<string, unknown>>;
  proofOwners?: Array<Record<string, unknown>>;
  replacementContexts?: Record<string, Array<Record<string, unknown>>>;
  proofSets?: Record<string, string[]>;
  hashOwners?: Record<string, string>;
  approvalIds?: Record<string, string>;
  duplicateBatchId?: string | null;
  pendingBatchUpdateCount?: number;
  reimbursementUpdateCount?: number;
  failOnSql?: string;
}

interface RecordedLink {
  transactionId: string;
  businessObjectType: string;
  businessObjectId: string;
  matchKey: Record<string, unknown>;
  allocatedAmount: string | null;
}

function compactSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function createProgrammableClient(fixture: MatcherFixture = {}) {
  const calls: QueryCall[] = [];
  const insertedProofs: unknown[][] = [];
  const insertedBatchItems: unknown[][] = [];
  const insertedBatches: unknown[][] = [];
  const insertedApprovalRecords: unknown[][] = [];
  const insertedLinks: RecordedLink[] = [];

  const query = jest.fn(async (sqlValue: string, params: unknown[] = []) => {
    const sql = compactSql(String(sqlValue));
    calls.push({ sql, params });
    if (fixture.failOnSql && sql.includes(fixture.failOnSql)) {
      throw new Error(`模拟数据库失败：${fixture.failOnSql}`);
    }

    if (
      sql.includes("FROM monthly_financial_bank_transactions bank_transaction")
    ) {
      const rows = fixture.transactions || [];
      return { rows, rowCount: rows.length };
    }
    if (
      sql.includes("AS normalized_proof_no") &&
      sql.includes("FROM payment_proof_hashes")
    ) {
      const rows = fixture.proofOwners || [];
      return { rows, rowCount: rows.length };
    }
    if (
      sql.includes("FROM payment_batches batch") &&
      sql.includes("WHERE batch.id = $1")
    ) {
      const batchId = String(params[0] || "");
      const rows = fixture.replacementContexts?.[batchId] || [];
      return { rows, rowCount: rows.length };
    }
    if (
      sql.startsWith("SELECT proof_no FROM payment_proof_hashes") &&
      sql.includes("WHERE batch_id = $1")
    ) {
      const batchId = String(params[0] || "");
      const rows = (fixture.proofSets?.[batchId] || []).map((proofNo) => ({
        proof_no: proofNo,
      }));
      return { rows, rowCount: rows.length };
    }
    if (
      sql.startsWith("SELECT batch_id FROM payment_proof_hashes") &&
      sql.includes("WHERE file_hash = $1")
    ) {
      const owner = fixture.hashOwners?.[String(params[0] || "")];
      return {
        rows: owner ? [{ batch_id: owner }] : [],
        rowCount: owner ? 1 : 0,
      };
    }
    if (sql.includes("pg_advisory_xact_lock")) {
      return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
    }
    if (
      sql.includes("FROM payment_batches batch") &&
      sql.includes("WHERE batch.status = 'pending'")
    ) {
      const rows = fixture.pendingItems || [];
      return { rows, rowCount: rows.length };
    }
    if (
      sql.includes("FROM reimbursements reimbursement") &&
      sql.includes("reimbursement.status = 'paid'")
    ) {
      const rows = fixture.paidReimbursements || [];
      return { rows, rowCount: rows.length };
    }
    if (
      sql.startsWith("SELECT batch_id FROM payment_proof_hashes") &&
      sql.includes("file_hash = ANY")
    ) {
      const batchId = fixture.duplicateBatchId;
      return {
        rows: batchId ? [{ batch_id: batchId }] : [],
        rowCount: batchId ? 1 : 0,
      };
    }
    if (sql.startsWith("INSERT INTO payment_batches")) {
      insertedBatches.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO payment_batch_items")) {
      insertedBatchItems.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO payment_proof_hashes")) {
      insertedProofs.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (
      sql.startsWith("UPDATE payment_batches") &&
      sql.includes("status = 'uploaded'")
    ) {
      return {
        rows: [],
        rowCount: fixture.pendingBatchUpdateCount ?? 1,
      };
    }
    if (sql.startsWith("UPDATE payment_batches")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE reimbursements")) {
      const requestedIds = Array.isArray(params[0]) ? params[0] : [];
      return {
        rows: [],
        rowCount: fixture.reimbursementUpdateCount ?? requestedIds.length,
      };
    }
    if (
      sql.startsWith("SELECT id FROM approval_instances") &&
      sql.includes("target_type = 'reimbursement'")
    ) {
      const approvalId = fixture.approvalIds?.[String(params[0] || "")];
      return {
        rows: approvalId ? [{ id: approvalId }] : [],
        rowCount: approvalId ? 1 : 0,
      };
    }
    if (sql.startsWith("INSERT INTO approval_records")) {
      insertedApprovalRecords.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE monthly_financial_bank_transaction_links")) {
      return { rows: [], rowCount: 0 };
    }
    if (
      sql.startsWith("INSERT INTO monthly_financial_bank_transaction_links")
    ) {
      insertedLinks.push({
        transactionId: String(params[1]),
        businessObjectType: String(params[2]),
        businessObjectId: String(params[3]),
        matchKey: JSON.parse(String(params[4] || "{}")) as Record<
          string,
          unknown
        >,
        allocatedAmount:
          params[5] === null || params[5] === undefined
            ? null
            : String(params[5]),
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`测试未处理的数据库语句：${sql}`);
  });

  return {
    client: { query } as unknown as PoolClient,
    calls,
    insertedProofs,
    insertedBatchItems,
    insertedBatches,
    insertedApprovalRecords,
    insertedLinks,
  };
}

let temporaryDirectory = "";

function cropFile(name: string): string {
  const filePath = path.join(temporaryDirectory, `${name}.jpg`);
  fs.writeFileSync(filePath, `月报回单裁片-${name}`, "utf8");
  return filePath;
}

function cropFileHash(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function monthlyTransaction(input: {
  id: string;
  amount: string;
  employeeId: string;
  employeeUserId: string;
  category:
    | "basic_reimbursement"
    | "large_reimbursement"
    | "business_reimbursement";
  proofNo?: string;
  transactionDate?: string;
  cropPath?: string;
}): Record<string, unknown> {
  const proofNo = input.proofNo || `NO-${input.id}`;
  return {
    id: input.id,
    crop_path: input.cropPath || cropFile(input.id),
    electronic_receipt_no: proofNo,
    normalized_electronic_receipt_no: proofNo.replace(/[^A-Za-z0-9]/gu, ""),
    transaction_date: input.transactionDate || "2026-06-18",
    amount: input.amount,
    category: input.category,
    employee_id: input.employeeId,
    employee_user_id: input.employeeUserId,
  };
}

function paidReimbursement(input: {
  id: string;
  amount: string;
  employeeId: string;
  userId: string;
  type: "basic" | "large" | "business";
}): Record<string, unknown> {
  return {
    id: input.id,
    type: input.type,
    title: `报销-${input.id}`,
    status: "paid",
    total_amount: input.amount,
    user_id: input.userId,
    employee_id: input.employeeId,
    payment_batch_id: null,
    payment_proof_path: null,
    payment_business_date: null,
    payment_upload_time: null,
    completed_time: null,
    receipt_confirmed_by: null,
  };
}

function pendingBatchItem(input: {
  batchId: string;
  reimbursementId: string;
  amount: string;
  employeeId: string;
  userId: string;
  type: "basic" | "large" | "business";
  status?: "approved" | "paid";
}): Record<string, unknown> {
  return {
    batch_id: input.batchId,
    batch_status: "pending",
    batch_amount: input.amount,
    batch_proof_path: null,
    batch_business_date: null,
    item_amount: input.amount,
    id: input.reimbursementId,
    type: input.type,
    title: `报销-${input.reimbursementId}`,
    status: input.status || "paid",
    total_amount: input.amount,
    user_id: input.userId,
    employee_id: input.employeeId,
    payment_batch_id: input.batchId,
    payment_proof_path: null,
    payment_business_date: null,
    payment_upload_time: null,
    completed_time: null,
    receipt_confirmed_by: null,
  };
}

const reconcileInput = {
  reportMonth: "2026-06",
  actorId: "admin-1",
  now: "2026-08-25T10:00:00.000Z",
};

beforeAll(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "monthly-reimbursement-matcher-"),
  );
});

beforeEach(() => {
  mockIdCounter = 0;
});

afterAll(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("月底银行回单与报销两阶段匹配", () => {
  it("没有可处理交易时返回空结果且不产生写入", async () => {
    const context = createProgrammableClient();

    await expect(
      reconcileMonthlyReimbursementTransactions(context.client, reconcileInput),
    ).resolves.toEqual({
      links: [],
      matchedGroups: [],
      pendingTransactions: [],
      replacedEvidence: [],
    });
    expect(
      context.calls.filter((call) =>
        /^(?:INSERT|UPDATE|DELETE)\b/u.test(call.sql),
      ),
    ).toEqual([]);
  });

  it("刘行基础报销1945.25单笔精确挂载并原子写入付款事实", async () => {
    const transaction = monthlyTransaction({
      id: "tx-liu-basic",
      amount: "1945.25",
      employeeId: "employee-liu",
      employeeUserId: "user-liu",
      category: "basic_reimbursement",
      proofNo: "LIU-194525",
    });
    const context = createProgrammableClient({
      transactions: [transaction],
      paidReimbursements: [
        paidReimbursement({
          id: "reimbursement-liu-basic",
          amount: "1945.25",
          employeeId: "employee-liu",
          userId: "user-liu",
          type: "basic",
        }),
      ],
      approvalIds: {
        "reimbursement-liu-basic": "approval-liu-basic",
      },
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups).toEqual([
      expect.objectContaining({
        transactionIds: ["tx-liu-basic"],
        reimbursementIds: ["reimbursement-liu-basic"],
        displayAction: "attached",
      }),
    ]);
    expect(result.pendingTransactions).toEqual([]);
    expect(context.insertedBatches).toHaveLength(1);
    expect(context.insertedBatchItems).toHaveLength(1);
    expect(context.insertedProofs).toHaveLength(1);
    expect(context.insertedApprovalRecords).toHaveLength(1);
    expect(context.insertedLinks).toHaveLength(2);
    expect(context.insertedLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transactionId: "tx-liu-basic",
          businessObjectType: "reimbursement",
          businessObjectId: "reimbursement-liu-basic",
          allocatedAmount: "1945.25",
        }),
        expect.objectContaining({
          transactionId: "tx-liu-basic",
          businessObjectType: "payment_batch",
          allocatedAmount: "1945.25",
        }),
      ]),
    );
    const statusUpdate = context.calls.find(
      (call) =>
        call.sql.startsWith("UPDATE reimbursements") &&
        call.sql.includes("SET status = 'payment_uploaded'"),
    );
    expect(statusUpdate?.params[0]).toEqual(["reimbursement-liu-basic"]);
  });

  it("吴静雯同日两张商务回单20600与9425唯一合计到一笔30025报销", async () => {
    const context = createProgrammableClient({
      transactions: [
        monthlyTransaction({
          id: "tx-wu-20600",
          amount: "20600.00",
          employeeId: "employee-wu",
          employeeUserId: "user-wu",
          category: "business_reimbursement",
          proofNo: "WU-20600",
        }),
        monthlyTransaction({
          id: "tx-wu-9425",
          amount: "9425.00",
          employeeId: "employee-wu",
          employeeUserId: "user-wu",
          category: "business_reimbursement",
          proofNo: "WU-9425",
        }),
      ],
      paidReimbursements: [
        paidReimbursement({
          id: "reimbursement-wu-30025",
          amount: "30025.00",
          employeeId: "employee-wu",
          userId: "user-wu",
          type: "business",
        }),
      ],
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups).toEqual([
      expect.objectContaining({
        transactionIds: ["tx-wu-20600", "tx-wu-9425"],
        reimbursementIds: ["reimbursement-wu-30025"],
      }),
    ]);
    expect(context.insertedBatches).toHaveLength(1);
    expect(context.insertedBatchItems).toHaveLength(1);
    expect(context.insertedProofs).toHaveLength(2);
    expect(context.insertedLinks).toHaveLength(4);
    const reimbursementLinks = context.insertedLinks.filter(
      (link) => link.businessObjectType === "reimbursement",
    );
    expect(
      reimbursementLinks.map((link) => link.allocatedAmount).sort(),
    ).toEqual(["20600.00", "9425.00"]);
    expect(context.insertedBatches[0]?.[2]).toBe("30025");
  });

  it("刘行跨3个交易日的4张商务回单唯一合计到一笔15729.20报销", async () => {
    const context = createProgrammableClient({
      transactions: [
        monthlyTransaction({
          id: "tx-liu-business-467660",
          amount: "4676.60",
          employeeId: "employee-liu",
          employeeUserId: "user-liu",
          category: "business_reimbursement",
          proofNo: "0913-5437-5209-1100",
          transactionDate: "2026-05-11",
        }),
        monthlyTransaction({
          id: "tx-liu-business-325870",
          amount: "3258.70",
          employeeId: "employee-liu",
          employeeUserId: "user-liu",
          category: "business_reimbursement",
          proofNo: "0914-0441-8435-1100",
          transactionDate: "2026-05-22",
        }),
        monthlyTransaction({
          id: "tx-liu-business-186300",
          amount: "1863.00",
          employeeId: "employee-liu",
          employeeUserId: "user-liu",
          category: "business_reimbursement",
          proofNo: "0914-4918-5601-1100",
          transactionDate: "2026-05-31",
        }),
        monthlyTransaction({
          id: "tx-liu-business-593090",
          amount: "5930.90",
          employeeId: "employee-liu",
          employeeUserId: "user-liu",
          category: "business_reimbursement",
          proofNo: "0914-4918-6359-1100",
          transactionDate: "2026-05-31",
        }),
      ],
      paidReimbursements: [
        paidReimbursement({
          id: "reimbursement-liu-business-1572920",
          amount: "15729.20",
          employeeId: "employee-liu",
          userId: "user-liu",
          type: "business",
        }),
      ],
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      { ...reconcileInput, reportMonth: "2026-05" },
    );

    expect(result.matchedGroups).toEqual([
      expect.objectContaining({
        transactionIds: [
          "tx-liu-business-186300",
          "tx-liu-business-325870",
          "tx-liu-business-467660",
          "tx-liu-business-593090",
        ],
        reimbursementIds: ["reimbursement-liu-business-1572920"],
        displayAction: "attached",
      }),
    ]);
    expect(result.pendingTransactions).toEqual([]);
    expect(context.insertedProofs).toHaveLength(4);
    expect(context.insertedLinks).toHaveLength(8);
    expect(context.insertedBatches[0]?.[2]).toBe("15729.20");
    expect(context.insertedBatches[0]?.[6]).toBe("2026-05-31");
    const reimbursementUpdate = context.calls.find(
      (call) =>
        call.sql.startsWith("UPDATE reimbursements") &&
        call.sql.includes("SET status = 'payment_uploaded'"),
    );
    expect(reimbursementUpdate?.params[2]).toBe("2026-05-31");
  });

  it("跨日期存在两组相同合计时保持待关联且不创建付款批次", async () => {
    const context = createProgrammableClient({
      transactions: [
        monthlyTransaction({
          id: "tx-cross-date-40",
          amount: "40.00",
          employeeId: "employee-cross-date-ambiguous",
          employeeUserId: "user-cross-date-ambiguous",
          category: "business_reimbursement",
          transactionDate: "2026-06-03",
        }),
        monthlyTransaction({
          id: "tx-cross-date-60",
          amount: "60.00",
          employeeId: "employee-cross-date-ambiguous",
          employeeUserId: "user-cross-date-ambiguous",
          category: "business_reimbursement",
          transactionDate: "2026-06-08",
        }),
        monthlyTransaction({
          id: "tx-cross-date-30",
          amount: "30.00",
          employeeId: "employee-cross-date-ambiguous",
          employeeUserId: "user-cross-date-ambiguous",
          category: "business_reimbursement",
          transactionDate: "2026-06-15",
        }),
        monthlyTransaction({
          id: "tx-cross-date-70",
          amount: "70.00",
          employeeId: "employee-cross-date-ambiguous",
          employeeUserId: "user-cross-date-ambiguous",
          category: "business_reimbursement",
          transactionDate: "2026-06-22",
        }),
      ],
      paidReimbursements: [
        paidReimbursement({
          id: "reimbursement-cross-date-100",
          amount: "100.00",
          employeeId: "employee-cross-date-ambiguous",
          userId: "user-cross-date-ambiguous",
          type: "business",
        }),
      ],
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups).toEqual([]);
    expect(result.pendingTransactions).toHaveLength(4);
    expect(context.insertedBatches).toEqual([]);
    expect(context.insertedBatchItems).toEqual([]);
    expect(context.insertedProofs).toEqual([]);
    expect(context.insertedLinks).toEqual([]);
  });

  it("单张回单可唯一分配给同员工同类型的多笔已付款报销", async () => {
    const context = createProgrammableClient({
      transactions: [
        monthlyTransaction({
          id: "tx-combined-basic",
          amount: "300.00",
          employeeId: "employee-combined",
          employeeUserId: "user-combined",
          category: "basic_reimbursement",
        }),
      ],
      paidReimbursements: [
        paidReimbursement({
          id: "reimbursement-combined-100",
          amount: "100.00",
          employeeId: "employee-combined",
          userId: "user-combined",
          type: "basic",
        }),
        paidReimbursement({
          id: "reimbursement-combined-200",
          amount: "200.00",
          employeeId: "employee-combined",
          userId: "user-combined",
          type: "basic",
        }),
      ],
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups[0]).toEqual(
      expect.objectContaining({
        transactionIds: ["tx-combined-basic"],
        reimbursementIds: [
          "reimbursement-combined-100",
          "reimbursement-combined-200",
        ],
      }),
    );
    expect(context.insertedBatchItems).toHaveLength(2);
    expect(context.insertedProofs).toHaveLength(1);
    expect(
      context.insertedLinks
        .filter((link) => link.businessObjectType === "reimbursement")
        .map((link) => link.allocatedAmount)
        .sort(),
    ).toEqual(["100.00", "200.00"]);
  });

  it("邵长腾基础1500与商务591.30按类型隔离成两个付款批次", async () => {
    const context = createProgrammableClient({
      transactions: [
        monthlyTransaction({
          id: "tx-shao-basic",
          amount: "1500.00",
          employeeId: "employee-shao",
          employeeUserId: "user-shao",
          category: "basic_reimbursement",
        }),
        monthlyTransaction({
          id: "tx-shao-business",
          amount: "591.30",
          employeeId: "employee-shao",
          employeeUserId: "user-shao",
          category: "business_reimbursement",
        }),
      ],
      paidReimbursements: [
        paidReimbursement({
          id: "reimbursement-shao-basic",
          amount: "1500.00",
          employeeId: "employee-shao",
          userId: "user-shao",
          type: "basic",
        }),
        paidReimbursement({
          id: "reimbursement-shao-business",
          amount: "591.30",
          employeeId: "employee-shao",
          userId: "user-shao",
          type: "business",
        }),
      ],
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups).toHaveLength(2);
    expect(
      new Set(result.matchedGroups.map((group) => group.paymentBatchId)).size,
    ).toBe(2);
    expect(context.insertedBatches).toHaveLength(2);
    expect(context.insertedBatchItems).toHaveLength(2);
    expect(context.insertedProofs).toHaveLength(2);
    expect(result.pendingTransactions).toEqual([]);
  });

  it("金额候选歧义时保持待关联且完全不消费付款凭证身份", async () => {
    const context = createProgrammableClient({
      transactions: [
        monthlyTransaction({
          id: "tx-ambiguous",
          amount: "100.00",
          employeeId: "employee-ambiguous",
          employeeUserId: "user-ambiguous",
          category: "basic_reimbursement",
        }),
      ],
      paidReimbursements: [
        paidReimbursement({
          id: "reimbursement-ambiguous-a",
          amount: "100.00",
          employeeId: "employee-ambiguous",
          userId: "user-ambiguous",
          type: "basic",
        }),
        paidReimbursement({
          id: "reimbursement-ambiguous-b",
          amount: "100.00",
          employeeId: "employee-ambiguous",
          userId: "user-ambiguous",
          type: "basic",
        }),
      ],
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups).toEqual([]);
    expect(result.pendingTransactions).toEqual([
      {
        transactionIds: ["tx-ambiguous"],
        reason: "已匹配员工，暂未找到可唯一关联的报销单",
      },
    ]);
    expect(context.insertedProofs).toEqual([]);
    expect(context.insertedBatches).toEqual([]);
    expect(context.insertedBatchItems).toEqual([]);
    expect(context.insertedLinks).toEqual([]);
    expect(
      context.calls.some((call) =>
        call.sql.startsWith("UPDATE reimbursements"),
      ),
    ).toBe(false);
  });

  it("唯一待处理批次复用原付款时间并只在为空时补充pay_time", async () => {
    const context = createProgrammableClient({
      transactions: [
        monthlyTransaction({
          id: "tx-pending-batch",
          amount: "888.00",
          employeeId: "employee-pending",
          employeeUserId: "user-pending",
          category: "large_reimbursement",
        }),
      ],
      pendingItems: [
        pendingBatchItem({
          batchId: "batch-pending-1",
          reimbursementId: "reimbursement-pending-1",
          amount: "888.00",
          employeeId: "employee-pending",
          userId: "user-pending",
          type: "large",
          status: "approved",
        }),
      ],
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups[0]).toEqual(
      expect.objectContaining({
        paymentBatchId: "batch-pending-1",
        displayAction: "attached",
      }),
    );
    expect(context.insertedBatches).toEqual([]);
    expect(context.insertedBatchItems).toEqual([]);
    expect(context.insertedProofs).toHaveLength(1);
    const batchUpdate = context.calls.find(
      (call) =>
        call.sql.startsWith("UPDATE payment_batches") &&
        call.sql.includes("status = 'uploaded'"),
    );
    expect(batchUpdate?.sql).toContain("pay_time = COALESCE(pay_time, $4)");
    expect(batchUpdate?.params[0]).toBe("batch-pending-1");
  });

  it("已完成报销以强回单号和同批次替换证据且保留确认状态字段", async () => {
    const cropPath = cropFile("tx-completed-replacement");
    const newHash = cropFileHash(cropPath);
    const transaction = monthlyTransaction({
      id: "tx-completed-replacement",
      amount: "500.00",
      employeeId: "employee-completed",
      employeeUserId: "user-completed",
      category: "business_reimbursement",
      proofNo: "REPLACE-500",
      transactionDate: "2026-06-20",
      cropPath,
    });
    const context = createProgrammableClient({
      transactions: [transaction],
      proofOwners: [
        {
          normalized_proof_no: "REPLACE500",
          batch_id: "batch-completed",
        },
      ],
      proofSets: { "batch-completed": ["REPLACE-500"] },
      replacementContexts: {
        "batch-completed": [
          {
            batch_status: "confirmed",
            batch_amount: "500.00",
            batch_proof_path: "uploads/invoices/old-batch-proof.jpg",
            batch_business_date: "2026-06-19",
            item_amount: "500.00",
            id: "reimbursement-completed",
            type: "business",
            title: "已完成商务报销",
            status: "completed",
            total_amount: "500.00",
            user_id: "user-completed",
            employee_id: "employee-completed",
            payment_batch_id: "batch-completed",
            payment_proof_path: "uploads/invoices/old-reimbursement-proof.jpg",
            payment_business_date: "2026-06-19",
            payment_upload_time: "2026-06-19T09:00:00.000Z",
            completed_time: "2026-06-20T09:00:00.000Z",
            receipt_confirmed_by: "吴静雯",
          },
        ],
      },
      approvalIds: {
        "reimbursement-completed": "approval-completed",
      },
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups).toEqual([
      expect.objectContaining({
        transactionIds: ["tx-completed-replacement"],
        reimbursementIds: ["reimbursement-completed"],
        paymentBatchId: "batch-completed",
        displayAction: "replaced",
      }),
    ]);
    expect(result.replacedEvidence).toEqual([
      expect.objectContaining({
        previousBatchProofPath: "uploads/invoices/old-batch-proof.jpg",
        previousBatchBusinessDate: "2026-06-19",
        previousReimbursements: [
          expect.objectContaining({
            id: "reimbursement-completed",
            status: "completed",
            paymentProofPath: "uploads/invoices/old-reimbursement-proof.jpg",
            completedTime: "2026-06-20T09:00:00.000Z",
            receiptConfirmedBy: "吴静雯",
          }),
        ],
      }),
    ]);
    expect(context.insertedProofs).toHaveLength(1);
    expect(context.insertedProofs[0]).toEqual([
      expect.any(String),
      newHash,
      "batch-completed",
      reconcileInput.now,
    ]);
    const reimbursementUpdate = context.calls.find(
      (call) =>
        call.sql.startsWith("UPDATE reimbursements") &&
        call.sql.includes("payment_proof_path = $2") &&
        !call.sql.includes("SET status = 'payment_uploaded'"),
    );
    expect(reimbursementUpdate?.sql).toContain(
      "SET payment_proof_path = $2, payment_business_date = $3::date",
    );
    expect(reimbursementUpdate?.sql).not.toContain("completed_time =");
    expect(reimbursementUpdate?.sql).not.toContain("receipt_confirmed_by =");
    expect(reimbursementUpdate?.params[4]).toEqual([
      "payment_uploaded",
      "completed",
    ]);
    const reimbursementLink = context.insertedLinks.find(
      (link) => link.businessObjectType === "reimbursement",
    );
    expect(reimbursementLink?.matchKey).toEqual(
      expect.objectContaining({
        displayAction: "replaced",
        previousPaymentProofPath:
          "uploads/invoices/old-reimbursement-proof.jpg",
        evidencePath: cropPath,
      }),
    );
  });

  it("旧付款业务日期不属于报表月时不替换当前凭证", async () => {
    const transaction = monthlyTransaction({
      id: "tx-cross-month",
      amount: "500.00",
      employeeId: "employee-cross-month",
      employeeUserId: "user-cross-month",
      category: "business_reimbursement",
      proofNo: "CROSS-MONTH-500",
      transactionDate: "2026-06-20",
    });
    const context = createProgrammableClient({
      transactions: [transaction],
      proofOwners: [{
        normalized_proof_no: "CROSSMONTH500",
        batch_id: "batch-cross-month",
      }],
      proofSets: { "batch-cross-month": ["CROSS-MONTH-500"] },
      replacementContexts: {
        "batch-cross-month": [{
          batch_status: "confirmed",
          batch_amount: "500.00",
          batch_proof_path: "uploads/invoices/old.jpg",
          batch_business_date: "2026-05-31",
          item_amount: "500.00",
          id: "reimbursement-cross-month",
          type: "business",
          title: "跨月报销",
          status: "completed",
          total_amount: "500.00",
          user_id: "user-cross-month",
          employee_id: "employee-cross-month",
          payment_batch_id: "batch-cross-month",
          payment_proof_path: "uploads/invoices/old.jpg",
          payment_business_date: "2026-05-31",
          payment_upload_time: "2026-05-31T09:00:00.000Z",
          completed_time: "2026-06-01T09:00:00.000Z",
          receipt_confirmed_by: "测试员工",
        }],
      },
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups).toEqual([]);
    expect(result.pendingTransactions).toEqual([
      expect.objectContaining({ transactionIds: ["tx-cross-month"] }),
    ]);
    expect(
      context.calls.some((call) => call.sql.startsWith("UPDATE reimbursements")),
    ).toBe(false);
  });

  it("同一规范回单号历史指向多个批次时不选择任一批次", async () => {
    const context = createProgrammableClient({
      transactions: [monthlyTransaction({
        id: "tx-multi-owner",
        amount: "300.00",
        employeeId: "employee-owner",
        employeeUserId: "user-owner",
        category: "basic_reimbursement",
        proofNo: "DUP-OWNER-300",
      })],
      proofOwners: [
        { normalized_proof_no: "DUPOWNER300", batch_id: "batch-a" },
        { normalized_proof_no: "DUPOWNER300", batch_id: "batch-b" },
      ],
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups).toEqual([]);
    expect(result.pendingTransactions).toHaveLength(1);
    expect(
      context.calls.some((call) =>
        call.sql.includes("WHERE batch.id = $1")),
    ).toBe(false);
  });

  it("既有多回单多报销批次仅按唯一整笔分配替换链接", async () => {
    const transactions = [
      monthlyTransaction({
        id: "tx-multi-a",
        amount: "100.00",
        employeeId: "employee-multi",
        employeeUserId: "user-multi",
        category: "business_reimbursement",
        proofNo: "MULTI-A",
      }),
      monthlyTransaction({
        id: "tx-multi-b",
        amount: "200.00",
        employeeId: "employee-multi",
        employeeUserId: "user-multi",
        category: "business_reimbursement",
        proofNo: "MULTI-B",
      }),
    ];
    const context = createProgrammableClient({
      transactions,
      proofOwners: [
        { normalized_proof_no: "MULTIA", batch_id: "batch-multi" },
        { normalized_proof_no: "MULTIB", batch_id: "batch-multi" },
      ],
      proofSets: { "batch-multi": ["MULTI-A", "MULTI-B"] },
      replacementContexts: {
        "batch-multi": [
          {
            batch_status: "confirmed",
            batch_amount: "300.00",
            batch_proof_path: "uploads/invoices/old-a.jpg,uploads/invoices/old-b.jpg",
            batch_business_date: "2026-06-18",
            item_amount: "100.00",
            id: "reimbursement-multi-a",
            type: "business",
            title: "多笔报销A",
            status: "completed",
            total_amount: "100.00",
            user_id: "user-multi",
            employee_id: "employee-multi",
            payment_batch_id: "batch-multi",
            payment_proof_path: "uploads/invoices/old-a.jpg,uploads/invoices/old-b.jpg",
            payment_business_date: "2026-06-18",
            payment_upload_time: "2026-06-18T09:00:00.000Z",
            completed_time: "2026-06-19T09:00:00.000Z",
            receipt_confirmed_by: "测试员工",
          },
          {
            batch_status: "confirmed",
            batch_amount: "300.00",
            batch_proof_path: "uploads/invoices/old-a.jpg,uploads/invoices/old-b.jpg",
            batch_business_date: "2026-06-18",
            item_amount: "200.00",
            id: "reimbursement-multi-b",
            type: "business",
            title: "多笔报销B",
            status: "completed",
            total_amount: "200.00",
            user_id: "user-multi",
            employee_id: "employee-multi",
            payment_batch_id: "batch-multi",
            payment_proof_path: "uploads/invoices/old-a.jpg,uploads/invoices/old-b.jpg",
            payment_business_date: "2026-06-18",
            payment_upload_time: "2026-06-18T09:00:00.000Z",
            completed_time: "2026-06-19T09:00:00.000Z",
            receipt_confirmed_by: "测试员工",
          },
        ],
      },
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups).toEqual([
      expect.objectContaining({
        transactionIds: ["tx-multi-a", "tx-multi-b"],
        reimbursementIds: ["reimbursement-multi-a", "reimbursement-multi-b"],
        displayAction: "replaced",
      }),
    ]);
    const reimbursementLinks = context.insertedLinks.filter(
      (link) => link.businessObjectType === "reimbursement",
    );
    expect(reimbursementLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transactionId: "tx-multi-a",
          businessObjectId: "reimbursement-multi-a",
          allocatedAmount: "100.00",
        }),
        expect.objectContaining({
          transactionId: "tx-multi-b",
          businessObjectId: "reimbursement-multi-b",
          allocatedAmount: "200.00",
        }),
      ]),
    );
    expect(reimbursementLinks).toHaveLength(2);
  });

  it("既有批次存在拆分付款时按批次范围关联且不伪造分配金额", async () => {
    const transactions = [
      monthlyTransaction({
        id: "tx-scope-a",
        amount: "150.00",
        employeeId: "employee-scope",
        employeeUserId: "user-scope",
        category: "business_reimbursement",
        proofNo: "SCOPE-A",
      }),
      monthlyTransaction({
        id: "tx-scope-b",
        amount: "150.00",
        employeeId: "employee-scope",
        employeeUserId: "user-scope",
        category: "business_reimbursement",
        proofNo: "SCOPE-B",
      }),
    ];
    const baseContext = {
      batch_status: "confirmed",
      batch_amount: "300.00",
      batch_proof_path: "uploads/invoices/scope-old.jpg",
      batch_business_date: "2026-06-18",
      type: "business",
      status: "completed",
      user_id: "user-scope",
      employee_id: "employee-scope",
      payment_batch_id: "batch-scope",
      payment_proof_path: "uploads/invoices/scope-old.jpg",
      payment_business_date: "2026-06-18",
      payment_upload_time: "2026-06-18T09:00:00.000Z",
      completed_time: "2026-06-19T09:00:00.000Z",
      receipt_confirmed_by: "测试员工",
    };
    const context = createProgrammableClient({
      transactions,
      proofOwners: [
        { normalized_proof_no: "SCOPEA", batch_id: "batch-scope" },
        { normalized_proof_no: "SCOPEB", batch_id: "batch-scope" },
      ],
      proofSets: { "batch-scope": ["SCOPE-A", "SCOPE-B"] },
      replacementContexts: {
        "batch-scope": [
          {
            ...baseContext,
            item_amount: "100.00",
            id: "reimbursement-scope-a",
            title: "拆分报销A",
            total_amount: "100.00",
          },
          {
            ...baseContext,
            item_amount: "200.00",
            id: "reimbursement-scope-b",
            title: "拆分报销B",
            total_amount: "200.00",
          },
        ],
      },
    });

    const result = await reconcileMonthlyReimbursementTransactions(
      context.client,
      reconcileInput,
    );

    expect(result.matchedGroups).toHaveLength(1);
    const reimbursementLinks = context.insertedLinks.filter(
      (link) => link.businessObjectType === "reimbursement",
    );
    expect(reimbursementLinks).toHaveLength(4);
    expect(reimbursementLinks.every((link) => link.allocatedAmount === null)).toBe(
      true,
    );
    expect(
      reimbursementLinks.every(
        (link) =>
          link.matchKey.batchScope === true &&
          link.matchKey.allocationStatus === "batch_total_only",
      ),
    ).toBe(true);
  });

  it("任一数据库写入失败时原错误向调用者事务传播且不继续写链接", async () => {
    const context = createProgrammableClient({
      transactions: [
        monthlyTransaction({
          id: "tx-write-failure",
          amount: "321.00",
          employeeId: "employee-failure",
          employeeUserId: "user-failure",
          category: "basic_reimbursement",
        }),
      ],
      paidReimbursements: [
        paidReimbursement({
          id: "reimbursement-write-failure",
          amount: "321.00",
          employeeId: "employee-failure",
          userId: "user-failure",
          type: "basic",
        }),
      ],
      failOnSql: "INSERT INTO payment_proof_hashes",
    });

    await expect(
      reconcileMonthlyReimbursementTransactions(context.client, reconcileInput),
    ).rejects.toThrow("模拟数据库失败：INSERT INTO payment_proof_hashes");
    expect(context.insertedLinks).toEqual([]);
    expect(
      context.calls.some((call) =>
        call.sql.startsWith(
          "INSERT INTO monthly_financial_bank_transaction_links",
        ),
      ),
    ).toBe(false);
  });
});
