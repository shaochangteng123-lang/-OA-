/** @jest-environment node */

jest.mock("../server/db/index", () => ({ db: {}, pool: {} }));
jest.mock("nanoid", () => ({ nanoid: () => "test-generated-id" }));

import {
  allocateInvoiceApplicationFacts,
  calculateInvoiceApplicationCapacity,
  reconcileInvoiceApplicationAllocations,
} from "../server/services/invoiceApplication";

describe("开票申请额度与正式发票覆盖", () => {
  it("只对尚未被正式发票覆盖的申请余额扣减额度", () => {
    expect(
      calculateInvoiceApplicationCapacity({
        currentEffectiveAmount: 1_000,
        invoicedAmount: 200,
        activeReservations: [
          { amount: 300, allocatedAmount: 100 },
          { amount: 100, allocatedAmount: 0 },
        ],
      }),
    ).toEqual({
      currentEffectiveAmount: 1_000,
      invoicedAmount: 200,
      pendingAmount: 300,
      remainingAmount: 500,
    });
  });

  it("金额全程按分计算，不产生浮点尾差", () => {
    expect(
      calculateInvoiceApplicationCapacity({
        currentEffectiveAmount: 0.3,
        invoicedAmount: 0.1,
        activeReservations: [{ amount: 0.2, allocatedAmount: 0.1 }],
      }),
    ).toEqual({
      currentEffectiveAmount: 0.3,
      invoicedAmount: 0.1,
      pendingAmount: 0.1,
      remainingAmount: 0.1,
    });
  });

  it("正式发票按申请提交顺序先进先出覆盖", () => {
    expect(
      allocateInvoiceApplicationFacts(
        [
          {
            id: "application-2",
            amount: 80,
            submittedAt: "2026-08-19T10:00:00.000Z",
          },
          {
            id: "application-1",
            amount: 100,
            submittedAt: "2026-08-19T09:00:00.000Z",
          },
        ],
        [
          {
            id: "invoice-1",
            amount: 130,
            createdAt: "2026-08-19T11:00:00.000Z",
          },
        ],
      ),
    ).toEqual([
      {
        applicationId: "application-1",
        invoiceId: "invoice-1",
        allocatedAmount: 100,
      },
      {
        applicationId: "application-2",
        invoiceId: "invoice-1",
        allocatedAmount: 30,
      },
    ]);
  });

  it("历史正式发票不能倒灌覆盖其建档后才提交的新申请", () => {
    expect(
      allocateInvoiceApplicationFacts(
        [
          {
            id: "new-application",
            amount: 100,
            submittedAt: "2026-08-19T12:00:00.000Z",
          },
        ],
        [
          {
            id: "historical-invoice",
            amount: 100,
            createdAt: "2026-08-19T08:00:00.000Z",
          },
        ],
      ),
    ).toEqual([]);
  });

  it("正式发票足额覆盖后在同一事务中自动完成申请", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("AS root_id"))
          return { rows: [{ root_id: "root-1" }] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (
          sql.includes("FROM invoice_applications") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                id: "application-1",
                amount: 100,
                status: "pending_invoice",
                submitted_at: "2026-08-19T09:00:00.000Z",
                issued_at: "2026-08-19T09:30:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_invoices invoice")) {
          return {
            rows: [
              {
                id: "invoice-1",
                amount: 100,
                created_at: "2026-08-19T10:00:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("SUM(allocation.allocated_amount)"))
          return { rows: [] };
        return { rows: [], rowCount: 1 };
      }),
    };

    await reconcileInvoiceApplicationAllocations(client as never, "root-1");

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "INSERT INTO invoice_application_invoice_allocations",
      ),
      expect.arrayContaining(["application-1", "invoice-1", 100]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE invoice_applications SET status = $2"),
      expect.arrayContaining(["application-1", "completed"]),
    );
    const auditActions = client.query.mock.calls
      .filter(([sql]) =>
        String(sql).includes("INSERT INTO invoice_application_audit_logs"),
      )
      .map(([, params]) => params?.[2]);
    expect(auditActions).toEqual(
      expect.arrayContaining(["invoice_allocated", "auto_complete"]),
    );
  });

  it("管理员未登记已开具时，正式发票足额也不能跳过开具节点", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("AS root_id"))
          return { rows: [{ root_id: "root-1" }] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (
          sql.includes("FROM invoice_applications") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                id: "application-1",
                amount: 100,
                status: "pending_invoice",
                submitted_at: "2026-08-19T09:00:00.000Z",
                issued_at: null,
              },
            ],
          };
        }
        if (sql.includes("FROM contract_invoices invoice")) {
          return {
            rows: [
              {
                id: "invoice-1",
                amount: 100,
                created_at: "2026-08-19T10:00:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("SUM(allocation.allocated_amount)"))
          return { rows: [] };
        return { rows: [], rowCount: 1 };
      }),
    };

    await reconcileInvoiceApplicationAllocations(client as never, "root-1");

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE invoice_applications SET status = $2"),
      expect.arrayContaining(["application-1", "pending_invoice"]),
    );
    const auditActions = client.query.mock.calls
      .filter(([sql]) =>
        String(sql).includes("INSERT INTO invoice_application_audit_logs"),
      )
      .map(([, params]) => params?.[2]);
    expect(auditActions).toContain("invoice_allocated");
    expect(auditActions).not.toContain("auto_complete");
  });

  it("正式发票冲正或删除后自动释放分配并恢复待开票", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("AS root_id"))
          return { rows: [{ root_id: "root-1" }] };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (
          sql.includes("FROM invoice_applications") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                id: "application-1",
                amount: 100,
                status: "completed",
                submitted_at: "2026-08-19T09:00:00.000Z",
                issued_at: "2026-08-19T09:30:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_invoices invoice")) return { rows: [] };
        if (sql.includes("SUM(allocation.allocated_amount)")) {
          return {
            rows: [{ application_id: "application-1", allocated_amount: 100 }],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    await reconcileInvoiceApplicationAllocations(client as never, "root-1");

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE invoice_applications SET status = $2"),
      expect.arrayContaining(["application-1", "pending_invoice"]),
    );
    const auditActions = client.query.mock.calls
      .filter(([sql]) =>
        String(sql).includes("INSERT INTO invoice_application_audit_logs"),
      )
      .map(([, params]) => params?.[2]);
    expect(auditActions).toEqual(
      expect.arrayContaining(["invoice_allocation_reversed", "auto_reopen"]),
    );
  });
});
