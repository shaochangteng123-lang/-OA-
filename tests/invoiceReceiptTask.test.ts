/** @jest-environment node */

jest.mock("../server/db/index", () => ({
  pool: { query: jest.fn() },
}));

import { pool } from "../server/db/index.js";
import {
  countInvoiceReceiptTasks,
  findInvoiceReceiptTask,
  findInvoiceReceiptTaskByRegistration,
  listInvoiceReceiptTasks,
  listInvoiceReceiptTasksForApplication,
} from "../server/services/invoiceReceiptTask.js";

describe("管理员待上传回单任务", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(["user", "general_manager", "boss"])(
    "拒绝非管理员角色读取：%s",
    async (role) => {
      await expect(countInvoiceReceiptTasks(role)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  it("数量和列表共用逐发票逐申请的回款分配口径", async () => {
    const query = pool.query as jest.Mock;
    query
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            registration_id: "registration-1",
            contract_id: "contract-1",
            contract_no: "HT-001",
            business_contract_no: "YW-001",
            contract_title: "测试合同",
            project_name: "测试项目",
            party_a: "测试甲方",
            area: "海淀区",
            application_count: 1,
            application_numbers: ["KP-001"],
            invoice_count: 2,
            invoice_amount: 100,
            matched_receipt_amount: 30,
            pending_receipt_amount: 70,
            earliest_invoice_date: "2026-09-01",
            waiting_days: 14,
            invoices: [
              {
                id: "invoice-1",
                invoiceNo: "FP-001",
                invoiceDate: "2026-09-01",
                amount: 100,
                applicationAmount: 100,
                matchedReceiptAmount: 30,
                pendingReceiptAmount: 70,
                itemName: "咨询服务",
              },
            ],
            total_count: 1,
          },
        ],
      });

    await expect(countInvoiceReceiptTasks("admin")).resolves.toBe(2);
    await expect(
      listInvoiceReceiptTasks("super_admin", 1, 10, "FP-001"),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          registrationId: "registration-1",
          invoiceAmount: 100,
          matchedReceiptAmount: 30,
          pendingReceiptAmount: 70,
          receiptStatus: "partial",
          invoices: [
            expect.objectContaining({
              invoiceNo: "FP-001",
              applicationAmount: 100,
              matchedReceiptAmount: 30,
              pendingReceiptAmount: 70,
            }),
          ],
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    });

    const countSql = String(query.mock.calls[0][0]);
    const listSql = String(query.mock.calls[1][0]);
    for (const sql of [countSql, listSql]) {
      expect(sql).toContain("pending_receipt_tasks AS");
      expect(sql).toContain("PARTITION BY application_allocation.invoice_id");
      expect(sql).toContain("ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING");
      expect(sql).toContain("ordered.application_status = 'completed'");
      expect(sql).toContain("receipt.status = 'confirmed'");
      expect(sql).toContain("invoice.status IN ('draft', 'confirmed')");
      expect(sql).toContain("HAVING SUM(completed.pending_receipt_amount) > 0");
    }
    expect(query.mock.calls[1][1]).toEqual(["%FP-001%", 10, 0]);
    expect(String(query.mock.calls[1][0])).toContain(
      "pending_receipt_tasks.pending_receipt_amount::text ILIKE $1",
    );
    expect(String(query.mock.calls[1][0])).toContain(
      "invoice->>'applicationAmount' ILIKE $1",
    );
  });

  it("请求超出末页时保留真实总数并返回空列表", async () => {
    const query = pool.query as jest.Mock;
    query.mockResolvedValueOnce({
      rows: [{ registration_id: null, total_count: 21 }],
    });

    await expect(listInvoiceReceiptTasks("admin", 3, 10, "")).resolves.toEqual({
      items: [],
      total: 21,
      page: 3,
      pageSize: 10,
    });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("filtered_receipt_tasks AS");
    expect(sql).toContain("paged_receipt_tasks AS");
    expect(sql).toContain("receipt_task_total AS");
    expect(sql).toContain("LEFT JOIN paged_receipt_tasks ON TRUE");
    expect(query.mock.calls[0][1]).toEqual([null, 10, 20]);
  });

  it("按合同精确读取待回单任务并保留无回款状态", async () => {
    const query = pool.query as jest.Mock;
    query.mockResolvedValueOnce({
      rows: [
        {
          registration_id: "registration-2",
          contract_id: "contract-2",
          contract_title: "另一合同",
          project_name: "另一项目",
          application_count: 1,
          application_numbers: ["KP-002"],
          invoice_count: 1,
          invoice_amount: 50,
          matched_receipt_amount: 0,
          pending_receipt_amount: 50,
          earliest_invoice_date: "2026-09-10",
          waiting_days: 5,
          invoices: [],
          total_count: 1,
        },
      ],
    });

    await expect(
      findInvoiceReceiptTask("chairman", "contract-2"),
    ).resolves.toMatchObject({
      contractId: "contract-2",
      pendingReceiptAmount: 50,
      receiptStatus: "awaiting",
    });
    expect(String(query.mock.calls[0][0])).toContain(
      "pending_receipt_tasks.contract_id = $1",
    );
    expect(query.mock.calls[0][1]).toEqual(["contract-2"]);
  });

  it("按申请汇总全部待回单登记并可复核指定登记是否仍待处理", async () => {
    const query = pool.query as jest.Mock;
    const rows = [
      {
        registration_id: "registration-1",
        contract_id: "contract-1",
        contract_title: "测试合同",
        project_name: "测试项目",
        application_count: 1,
        application_numbers: ["KP-001"],
        invoice_count: 1,
        invoice_amount: 60,
        matched_receipt_amount: 10,
        pending_receipt_amount: 50,
        earliest_invoice_date: "2026-09-01",
        waiting_days: 14,
        invoices: [],
        total_count: 1,
      },
      {
        registration_id: "registration-2",
        contract_id: "contract-1",
        contract_title: "测试合同",
        project_name: "测试项目",
        application_count: 1,
        application_numbers: ["KP-001"],
        invoice_count: 1,
        invoice_amount: 40,
        matched_receipt_amount: 20,
        pending_receipt_amount: 20,
        earliest_invoice_date: "2026-09-02",
        waiting_days: 13,
        invoices: [],
        total_count: 1,
      },
    ];
    query
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: [rows[1]] });

    await expect(
      listInvoiceReceiptTasksForApplication("admin", "application-1"),
    ).resolves.toMatchObject([
      { registrationId: "registration-1", pendingReceiptAmount: 50 },
      { registrationId: "registration-2", pendingReceiptAmount: 20 },
    ]);
    await expect(
      findInvoiceReceiptTaskByRegistration("admin", "registration-2"),
    ).resolves.toMatchObject({
      registrationId: "registration-2",
      pendingReceiptAmount: 20,
    });
    expect(String(query.mock.calls[0][0])).toContain(
      "pending_application.application_id = $1",
    );
    expect(String(query.mock.calls[0][0])).not.toContain("LIMIT 1");
    expect(String(query.mock.calls[1][0])).toContain(
      "pending_receipt_tasks.registration_id = $1",
    );
  });
});
