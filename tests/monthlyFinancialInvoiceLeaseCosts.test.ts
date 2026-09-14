/** @jest-environment node */
import { buildInvoiceLeaseHousingCosts } from "../server/services/monthlyFinancialInvoiceLeaseCosts";
import {
  buildMonthlyFinancialAnalysis,
  type AnalysisHousingCostInvoice,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { loadMonthlyFinancialHousingCostInvoices } from "../server/services/monthlyFinancialHousingCostSources";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";
const lease = {
  id: "a",
  title: "旧址",
  status: "completed",
  effectiveAt: "2026-01-01",
  leaseStartDate: "2026-01-01",
  leaseEndDate: "2026-05-31",
  monthlyRent: "999999",
  monthlyPropertyFee: "888888",
};
const options = { from: "2026-01", to: "2026-12", asOfDate: "2026-12-31" };
function invoice(
  rootId = "a",
  amount = "1510",
  category = "rent",
  id = "发票1",
): AnalysisHousingCostInvoice {
  return {
    id,
    rootId,
    invoiceNumber: id,
    invoiceAmount: amount,
    invoiceDate: "2026-12-01",
    billingMonth: null,
    periodReason: "有效上传发票",
    evidenceVersion: "confirmed-invoice-lease-v1",
    updatedAt: null,
    lines: [{ id: id + "行", category, amount, verified: true }],
  };
}
const sum = (rows: { amount: string }[]) =>
  addFinancialAmounts(...rows.map((r) => r.amount));
test("旧址151天发票1510、新址214天发票4280各摊各自租期，月租和开票月份不参与", () => {
  const newer = {
    ...lease,
    id: "b",
    title: "新址",
    leaseStartDate: "2026-06-01",
    leaseEndDate: "2026-12-31",
    effectiveAt: "2026-06-01",
  };
  const result = buildInvoiceLeaseHousingCosts(
    [lease, newer],
    [invoice(), invoice("b", "4280", "rent", "发票2")],
    options,
  );
  expect(result.rows.map((r) => r.amount)).toEqual([
    "310",
    "280",
    "310",
    "300",
    "310",
    "600",
    "620",
    "620",
    "600",
    "620",
    "600",
    "620",
  ]);
  expect(sum(result.rows)).toBe("5790");
  expect(result.unknown.size).toBe(0);
  const june = buildInvoiceLeaseHousingCosts(
    [lease, newer],
    [invoice(), invoice("b", "4280", "rent", "发票2")],
    { ...options, from: "2026-06", to: "2026-06" },
  );
  expect(sum(june.rows)).toBe("600");
});
test("首尾月、闰日、高精度与累计尾差保证全租期发票总额闭合，查询不改变分母", () => {
  const c = {
    ...lease,
    leaseStartDate: "2024-02-15",
    leaseEndDate: "2024-03-14",
    effectiveAt: "2024-02-01",
  };
  for (const amount of ["0.01", "100.01", "0.000000000001"]) {
    const q = { from: "2024-02", to: "2024-03", asOfDate: "2024-03-31" };
    const full = buildInvoiceLeaseHousingCosts([c], [invoice("a", amount)], q);
    expect(sum(full.rows)).toBe(addFinancialAmounts(amount));
    expect(
      buildInvoiceLeaseHousingCosts([c], [invoice("a", amount)], {
        ...q,
        from: "2024-03",
      }).rows[0].amount,
    ).toBe(full.rows[1].amount);
  }
  expect(
    buildInvoiceLeaseHousingCosts([c], [invoice("a", "29")], {
      from: "2024-02",
      to: "2024-03",
      asOfDate: "2024-02-20",
    }).rows.map((r) => r.amount),
  ).toEqual(["6"]);
});
test("全部费用都摊租期，混合票不重复计租金物业，押金排除，相同发票只算一次", () => {
  const inv = invoice("a", "1661");
  inv.lines.push({
    id: "物业",
    category: "property_management",
    amount: "151",
    verified: true,
  });
  inv.lines[0].amount = "1510";
  const result = buildInvoiceLeaseHousingCosts(
    [lease],
    [
      inv,
      { ...inv },
      invoice("a", "151", "system_maintenance", "维护"),
      invoice("a", "500", "deposit", "押金"),
    ],
    options,
  );
  expect(sum(result.rows)).toBe("1812");
  expect(sum(result.rows.filter((r) => r.month === "2026-01"))).toBe("372");
});
test("发票冲突、缺失来源、未知租期及未确认分类不猜金额，已核验合同保留", () => {
  for (const invoices of [
    undefined,
    [invoice(), invoice("a", "1520")],
    [{ ...invoice(), lines: [] }],
    [{ ...invoice(), lines: [null as never] }],
  ]) {
    const result = buildInvoiceLeaseHousingCosts([lease], invoices, options);
    expect(result.unknown.get("rent")?.has("2026-01")).toBe(true);
  }
  expect(
    buildInvoiceLeaseHousingCosts(
      [{ ...lease, leaseEndDate: null }],
      [invoice()],
      options,
    ).unknown.get("rent")?.size,
  ).toBe(12);
  expect(sum(buildInvoiceLeaseHousingCosts([lease], [], options).rows)).toBe(
    "0",
  );
});
test("新读取模式包含纯租金物业票，不依赖收费单文字和银行回单", async () => {
  const db = {
    query: jest
      .fn()
      .mockResolvedValue({ rows: [{ ...invoice(), filePath: null }] }),
  };
  const result = await loadMonthlyFinancialHousingCostInvoices(
    db,
    "2026-09-07",
    "invoice-lease",
  );
  expect(result[0]).toMatchObject({
    invoiceAmount: "1510",
    billingMonth: null,
    evidenceVersion: "confirmed-invoice-lease-v1",
  });
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("$2::boolean OR invoice_lines.lines IS NULL"),
    ["2026-09-07", true],
  );
});
test("人力新口径忽略合同计提与付款，月季年及个人合计精确一致", () => {
  const source: MonthlyFinancialAnalysisInput = {
    query: { from: "2026-01", to: "2026-05", granularity: "month" },
    generatedAt: "2026-05-31T02:00:00Z",
    reports: [],
    contracts: [],
    receipts: [],
    reimbursements: [],
    personnelIncurredReimbursements: [],
    rentAccrualContracts: [lease],
    housingCostInvoices: [invoice()],
    housingCostBasis: "invoice-lease",
    payroll: ["01", "02", "03", "04", "05"].flatMap((month) =>
      ["p1", "p2"].map((id) => ({
        id: month + id,
        employeeId: id,
        userId: id,
        personName: id,
        month: "2026-" + month,
        salary: "100",
        housingBase: "0",
        contributionBase: "0",
        tax: "0",
        withheldActual: "0",
        netActual: "100",
        updatedAt: null,
      })),
    ),
  };
  for (const granularity of ["month", "quarter", "year"] as const) {
    const result = buildMonthlyFinancialAnalysis({
      ...source,
      query: { ...source.query, granularity },
    }).modules.find((m) => m.key === "personnel")!;
    expect(result.housingCostBasis).toBe("invoice-lease");
    expect(result.warnings.join(" ")).not.toContain("变量费用按原收费单月份核验");
    expect(
      result.housingCostBreakdown!.find((v) => v.key === "rent")!.amount,
    ).toBe("1510");
    expect(
      addFinancialAmounts(
        ...result.personnelAnnualDetails!.map((r) => r.overhead!),
      ),
    ).toBe("1510");
  }
});
