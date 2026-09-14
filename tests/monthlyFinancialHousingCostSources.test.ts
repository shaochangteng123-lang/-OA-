/** @jest-environment node */
const mockPageCount = jest.fn();
const mockExtract = jest.fn();
jest.mock("../server/services/contractFinancialEvidence", () => ({
  getContractFinancialPdfPageCount: (...args: unknown[]) =>
    mockPageCount(...args),
  extractContractFinancialPdfFirstPageTextLayer: (...args: unknown[]) =>
    mockExtract(...args),
}));
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import type { PoolClient } from "pg";
import {
  loadMonthlyFinancialHousingCostInvoices,
  parseHousingCostInvoicePeriod,
} from "../server/services/monthlyFinancialHousingCostSources";

const identity = {
  invoiceDate: "2026-02-05",
  invoiceNumber: "26112000000478407226",
  invoiceAmount: "333.84",
};
function invoiceText(
  month = "26年2月",
  number = identity.invoiceNumber,
  amount = "333.84",
) {
  return `电子发票\n发票号码： ${number}\n价税合计（大写） 合成金额 （小写） ¥ ${amount}\n（明细详见${month}收费单）`;
}
let directory = "",
  serial = 0;
const texts = new Map<string, string>();
function file(text = invoiceText()) {
  const name = `invoice-${++serial}.pdf`;
  const bytes = Buffer.from(`%PDF-1.7\n合成单页凭证${serial}`);
  const absolute = path.join(directory, "uploads", "contracts", name);
  fs.writeFileSync(absolute, bytes);
  texts.set(bytes.toString("base64"), text);
  return { absolute, relative: `uploads/contracts/${name}`, bytes };
}
function source(filePath: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice-one",
    rootId: "rental-root",
    ...identity,
    fileId: "original-one",
    filePath,
    fileRootId: "rental-root",
    fileType: "invoice",
    mimeType: "application/pdf",
    fileOwnerDeleted: false,
    updatedAt: "2026-02-05T01:00:00Z",
    lines: [
      {
        id: "electricity",
        category: "electricity",
        amount: "233.84",
        verified: true,
      },
      {
        id: "system",
        category: "system_maintenance",
        amount: "100",
        verified: true,
      },
    ],
    ...overrides,
  };
}
function client(rows: ReturnType<typeof source>[]) {
  const query = jest.fn(async () => ({ rows }));
  return { query, connection: { query } as unknown as PoolClient };
}

describe("住房变量费用收费月份原票证据", () => {
  beforeEach(() => {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "housing-cost-source-test-"),
    );
    fs.mkdirSync(path.join(directory, "uploads", "contracts"), {
      recursive: true,
    });
    jest.spyOn(process, "cwd").mockReturnValue(directory);
    mockPageCount.mockReset().mockResolvedValue(1);
    mockExtract
      .mockReset()
      .mockImplementation(
        async (snapshot: string) =>
          texts.get(fs.readFileSync(snapshot).toString("base64")) || "",
      );
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each(["26年2月", "2026年02月"])(
    "仅从明确%s收费单及一致号码总额归期",
    (month) => {
      expect(
        parseHousingCostInvoicePeriod(invoiceText(month), identity)
          .billingMonth,
      ).toBe("2026-02");
      expect(
        parseHousingCostInvoicePeriod(
          invoiceText(month).replace("333.84", "333.8400"),
          identity,
        ).billingMonth,
      ).toBe("2026-02");
    },
  );

  it("去年开票的本年收费月份保留，世纪按发票日消歧且两位年份只允许同邻年", () => {
    expect(
      parseHousingCostInvoicePeriod(invoiceText("26年1月"), {
        ...identity,
        invoiceDate: "2025-12-15",
      }).billingMonth,
    ).toBe("2026-01");
    expect(
      parseHousingCostInvoicePeriod(invoiceText("00年1月"), {
        ...identity,
        invoiceDate: "1999-12-15",
      }).billingMonth,
    ).toBe("2000-01");
    expect(
      parseHousingCostInvoicePeriod(invoiceText("24年1月"), identity)
        .billingMonth,
    ).toBeNull();
  });

  it.each([
    invoiceText().replace("明细详见26年2月收费单", "付款日期2026年2月5日"),
    invoiceText() + "明细详见26年3月收费单",
    invoiceText() + "另附26年3月收费单",
    invoiceText("26年13月"),
    invoiceText("26年0月"),
    invoiceText("26年1至2月"),
    "扫描凭证没有文本层",
  ])("没有唯一明确月份时保留未知，不猜月份", (text) => {
    expect(
      parseHousingCostInvoicePeriod(text, identity).billingMonth,
    ).toBeNull();
  });

  it("号码、精确总额、原字段日期与格式必须一致，重复冲突身份不能复用", () => {
    for (const item of [
      {
        text: invoiceText(),
        record: { ...identity, invoiceNumber: "26112000000478407227" },
      },
      { text: invoiceText(), record: { ...identity, invoiceAmount: "333.85" } },
      {
        text: invoiceText(),
        record: { ...identity, invoiceDate: "2026-02-30" },
      },
      { text: invoiceText(), record: { ...identity, invoiceNumber: null } },
      {
        text: invoiceText(),
        record: { ...identity, invoiceAmount: "3.3384e2" },
      },
      {
        text: invoiceText() + "发票号码：26112000000478407227",
        record: identity,
      },
      { text: invoiceText() + "（小写）¥333.85", record: identity },
      { text: invoiceText().replace("333.84", "3,33.84"), record: identity },
    ])
      expect(
        parseHousingCostInvoicePeriod(item.text, item.record).billingMonth,
      ).toBeNull();
    expect(
      parseHousingCostInvoicePeriod(
        invoiceText(
          "26年2月",
          identity.invoiceNumber,
          "999,999,999,999.000000000001",
        ),
        { ...identity, invoiceAmount: "999999999999.000000000001" },
      ).billingMonth,
    ).toBe("2026-02");
  });

  it("全历史查询限住房租赁成本方向确认未冲正发票，不连付款或截掉去年开本年票", async () => {
    const original = file(invoiceText("26年1月"));
    const db = client([
      source(original.relative, { invoiceDate: "2025-12-15" }),
    ]);
    const result = await loadMonthlyFinancialHousingCostInvoices(
      db.connection,
      "2026-09-08",
    );
    expect(result[0]).toMatchObject({
      billingMonth: "2026-01",
      invoiceAmount: "333.84",
      invoiceDate: "2025-12-15",
    });
    expect(result[0].lines).toEqual(source(original.relative).lines);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).toContain(
      "COALESCE(root.asset_category, root.declared_subtype) = 'house_rental'",
    );
    expect(sql).toContain("root.financial_direction = 'cost'");
    expect(sql).toContain("root.is_deleted = FALSE");
    expect(sql).toContain(
      "invoice.status = 'confirmed' AND invoice.reversed_at IS NULL",
    );
    expect(sql).toContain("invoice.invoice_no");
    expect(sql).toContain("invoice.amount::text");
    expect(sql).toContain("line.gross_amount::text");
    expect(sql).toContain("line.line_index");
    expect(sql).toContain(
      "variable.expense_category NOT IN ('rent', 'property_management')",
    );
    expect(sql).not.toMatch(
      /BETWEEN|EXTRACT\s*\(\s*YEAR|contract_payments|financial_registration_matches|payment_date/iu,
    );
    expect(db.query).toHaveBeenCalledWith(expect.any(String), [
      "2026-09-08",
      false,
    ]);
  });

  it("用同一字节快照提取及计算证据版本，原件在提取中改变不串换文本", async () => {
    const original = file();
    mockPageCount.mockImplementationOnce(async (snapshot: string) => {
      expect(snapshot).not.toBe(original.absolute);
      expect(fs.readFileSync(snapshot)).toEqual(original.bytes);
      fs.writeFileSync(
        original.absolute,
        Buffer.from("%PDF-1.7\n替换后的原件"),
      );
      return 1;
    });
    const db = client([source(original.relative)]);
    const result = await loadMonthlyFinancialHousingCostInvoices(
      db.connection,
      "2026-09-08",
    );
    expect(result[0].billingMonth).toBe("2026-02");
    expect(result[0].evidenceVersion).toContain(
      createHash("sha256").update(original.bytes).digest("hex"),
    );
    expect(fs.existsSync(mockExtract.mock.calls[0][0])).toBe(false);
  });

  it("已确认住房发票缺少全部结构化明细时仍返回空行证据，不把潜在变量费用吞成零", async () => {
    const original = file();
    const db = client([source(original.relative, { lines: [] })]);
    const result = await loadMonthlyFinancialHousingCostInvoices(
      db.connection,
      "2026-09-08",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      invoiceAmount: "333.84",
      billingMonth: "2026-02",
      lines: [],
    });
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain(
      "COALESCE(invoice_lines.lines, '[]'::jsonb) AS lines",
    );
    expect(sql).toContain("invoice_lines ON TRUE");
    expect(sql).toContain("invoice_lines.lines IS NULL OR EXISTS");
    expect(sql).not.toContain(
      "invoice_lines ON invoice_lines.lines IS NOT NULL",
    );
    expect(sql).toContain(
      "variable.expense_category NOT IN ('rent', 'property_management')",
    );
  });

  it("同哈希缓存只复用文本，换发票身份仍重新校验；原件字节变化自动失效", async () => {
    const original = file(),
      db = client([source(original.relative)]);
    const first = await loadMonthlyFinancialHousingCostInvoices(
      db.connection,
      "2026-09-08",
    );
    await loadMonthlyFinancialHousingCostInvoices(db.connection, "2026-09-08");
    expect(mockExtract).toHaveBeenCalledTimes(1);
    const other = client([
      source(original.relative, {
        id: "invoice-two",
        invoiceNumber: "26112000000478407227",
      }),
    ]);
    expect(
      (
        await loadMonthlyFinancialHousingCostInvoices(
          other.connection,
          "2026-09-08",
        )
      )[0].billingMonth,
    ).toBeNull();
    expect(mockExtract).toHaveBeenCalledTimes(1);
    const replacement = Buffer.from(`%PDF-1.7\n更新票件${++serial}`);
    fs.writeFileSync(original.absolute, replacement);
    texts.set(replacement.toString("base64"), invoiceText("26年3月"));
    const changed = await loadMonthlyFinancialHousingCostInvoices(
      db.connection,
      "2026-09-08",
    );
    expect(changed[0].billingMonth).toBe("2026-03");
    expect(changed[0].evidenceVersion).not.toBe(first[0].evidenceVersion);
    expect(mockExtract).toHaveBeenCalledTimes(2);
  });

  it("越界及软链路径、错根、删合同、缺原件和不支持格式均保留待核验费用", async () => {
    const original = file();
    const outside = path.join(directory, "outside.pdf");
    fs.writeFileSync(outside, original.bytes);
    const link = path.join(directory, "uploads", "contracts", "escape.pdf");
    fs.symlinkSync(outside, link);
    const cases = [
      source(outside),
      source("uploads/contracts/escape.pdf"),
      source(original.relative, { fileRootId: "other-root" }),
      source(original.relative, { fileOwnerDeleted: true }),
      source(original.relative, { fileId: null }),
      source(original.relative, { mimeType: "image/png" }),
      source(original.relative, { fileType: "receipt" }),
    ];
    const result = await loadMonthlyFinancialHousingCostInvoices(
      client(cases).connection,
      "2026-09-08",
    );
    expect(result).toHaveLength(cases.length);
    expect(
      result.every(
        (row) =>
          row.billingMonth === null &&
          row.invoiceAmount === "333.84" &&
          row.periodReason,
      ),
    ).toBe(true);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("提取失败不会把同一原件永久缓存为未知，恢复后可重新核验", async () => {
    const original = file(),
      db = client([source(original.relative)]);
    mockExtract.mockRejectedValueOnce(new Error("暂时不可用"));
    expect(
      (
        await loadMonthlyFinancialHousingCostInvoices(
          db.connection,
          "2026-09-08",
        )
      )[0].billingMonth,
    ).toBeNull();
    expect(
      (
        await loadMonthlyFinancialHousingCostInvoices(
          db.connection,
          "2026-09-08",
        )
      )[0].billingMonth,
    ).toBe("2026-02");
    expect(mockExtract).toHaveBeenCalledTimes(2);
  });

  it("文本缓存最多保留128份哈希，淘汰后重新读取仍核对同一登记字段", async () => {
    const original = file(),
      first = client([source(original.relative)]);
    await loadMonthlyFinancialHousingCostInvoices(
      first.connection,
      "2026-09-08",
    );
    const others = Array.from({ length: 128 }, (_, index) =>
      source(file().relative, { id: `cached-${index}` }),
    );
    await loadMonthlyFinancialHousingCostInvoices(
      client(others).connection,
      "2026-09-08",
    );
    const count = mockExtract.mock.calls.length;
    expect(
      (
        await loadMonthlyFinancialHousingCostInvoices(
          first.connection,
          "2026-09-08",
        )
      )[0].billingMonth,
    ).toBe("2026-02");
    expect(mockExtract).toHaveBeenCalledTimes(count + 1);
  });

  it("超限、多页、读取或提取失败和非法日期不得伪造零费用，未来开票不提前计入", async () => {
    const large = file(),
      many = file(),
      failed = file(),
      invalid = file(),
      future = file();
    fs.truncateSync(large.absolute, 8 * 1024 * 1024 + 1);
    mockPageCount.mockImplementation(async (snapshot: string) =>
      fs.readFileSync(snapshot).equals(many.bytes) ? 2 : 1,
    );
    mockExtract.mockRejectedValueOnce(new Error("内部错误不可透出原文"));
    const result = await loadMonthlyFinancialHousingCostInvoices(
      client([
        source(large.relative),
        source(many.relative),
        source(failed.relative),
        source(invalid.relative, { invoiceDate: "2026-02-30" }),
        source(future.relative, { invoiceDate: "2026-10-01" }),
        source("uploads/contracts/missing.pdf"),
      ]).connection,
      "2026-09-08",
    );
    expect(result).toHaveLength(5);
    expect(
      result.every(
        (row) => row.billingMonth === null && row.invoiceAmount === "333.84",
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("内部错误");
    expect(result.some((row) => row.periodReason.includes("单页"))).toBe(true);
  });

  it("数据库查询失败向上传递，截止日期无效不执行查询", async () => {
    const db = client([]);
    db.query.mockRejectedValueOnce(new Error("只读查询失败"));
    await expect(
      loadMonthlyFinancialHousingCostInvoices(db.connection, "2026-09-08"),
    ).rejects.toThrow("只读查询失败");
    await expect(
      loadMonthlyFinancialHousingCostInvoices(db.connection, "2026-13-01"),
    ).rejects.toThrow("截止日期无效");
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("并行滚动查询最多同时执行两份PDF提取", async () => {
    let active = 0,
      peak = 0;
    const releases: Array<() => void> = [];
    mockExtract.mockImplementation(async (snapshot: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return texts.get(fs.readFileSync(snapshot).toString("base64")) || "";
    });
    const rows = Array.from({ length: 5 }, (_, index) =>
      source(file().relative, { id: `invoice-${index}` }),
    );
    const pending = loadMonthlyFinancialHousingCostInvoices(
      client(rows).connection,
      "2026-09-08",
    );
    let released = 0;
    while (released < rows.length) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      while (releases.length) {
        releases.shift()!();
        released += 1;
      }
    }
    expect((await pending).every((row) => row.billingMonth === "2026-02")).toBe(
      true,
    );
    expect(peak).toBe(2);
  });
});
