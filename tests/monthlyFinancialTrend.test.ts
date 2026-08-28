import {
  MAX_MONTHLY_FINANCIAL_TREND_MONTHS,
  buildMonthlyFinancialTrendData,
  buildMonthlyFinancialTrendGap,
  buildMonthlyFinancialTrendPoint,
  listMonthlyFinancialTrendMonths,
  type MonthlyFinancialTrendReportInput,
} from "../server/services/monthlyFinancialTrend";

function report(
  input: Partial<MonthlyFinancialTrendReportInput> = {},
): MonthlyFinancialTrendReportInput {
  return {
    month: "2026-01",
    status: "closed",
    accounts: [
      {
        code: "general",
        opening: "100",
        inflow: "70",
        outflow: "20",
        closing: "150",
      },
      {
        code: "business",
        opening: "50",
        inflow: "30",
        outflow: "10",
        closing: "70",
      },
      {
        code: "welfare_one",
        opening: "10",
        inflow: "5",
        outflow: "3",
        closing: "12",
      },
      {
        code: "welfare_two",
        opening: "0",
        inflow: "2",
        outflow: "1",
        closing: "1",
      },
    ],
    income: { mainReceipt: "200" },
    validations: { blockers: [], warnings: [] },
    ...input,
  };
}

describe("月度财务趋势范围", () => {
  it("按自然月生成含首尾的跨年范围", () => {
    expect(listMonthlyFinancialTrendMonths("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("拒绝倒序、错误格式和超过二百四十个月的范围", () => {
    expect(() => listMonthlyFinancialTrendMonths("2026-02", "2026-01")).toThrow(
      "趋势开始月份不能晚于结束月份",
    );
    expect(() => listMonthlyFinancialTrendMonths("2026-1", "2026-02")).toThrow(
      "月份格式必须为 YYYY-MM",
    );
    expect(() =>
      listMonthlyFinancialTrendMonths(
        "2000-01",
        `${2019 + Math.floor(MAX_MONTHLY_FINANCIAL_TREND_MONTHS / 12)}-01`,
      ),
    ).toThrow("趋势查询范围不能超过240个月");
  });
});

describe("月度财务趋势点", () => {
  it("区分实际回款与四账户结算流入并保持字符串金额", () => {
    expect(buildMonthlyFinancialTrendPoint(report())).toEqual({
      month: "2026-01",
      status: "closed",
      valueState: "closed",
      actualReceipt: "200",
      settlementInflow: "107",
      totalOutflow: "34",
      netChange: "73",
      closingTotal: "233",
      accountClosing: {
        general: "150",
        business: "70",
        welfare_one: "12",
        welfare_two: "1",
      },
    });
  });

  it("开放报表标记当前精确工作值，缺月保留全空断点", () => {
    const currentPoint = buildMonthlyFinancialTrendPoint(
      report({
        month: "2026-02",
        status: "reopened",
        accounts: [
          {
            code: "general",
            opening: "0.1",
            inflow: "0.2",
            outflow: "0",
            closing: "0.3",
          },
          {
            code: "business",
            opening: "0",
            inflow: "0",
            outflow: "0",
            closing: "0",
          },
          {
            code: "welfare_one",
            opening: "0",
            inflow: "0",
            outflow: "0",
            closing: "0",
          },
          {
            code: "welfare_two",
            opening: "0",
            inflow: "0",
            outflow: "0",
            closing: "0",
          },
        ],
        income: { mainReceipt: "0.123456789012" },
      }),
    );
    expect(currentPoint).toMatchObject({
      valueState: "current",
      actualReceipt: "0.123456789012",
      settlementInflow: "0.2",
      totalOutflow: "0",
      netChange: "0.2",
      closingTotal: "0.3",
    });
    expect(currentPoint).not.toHaveProperty("isEstimate");
    expect(buildMonthlyFinancialTrendGap("2026-03")).toEqual({
      month: "2026-03",
      status: null,
      valueState: null,
      actualReceipt: null,
      settlementInflow: null,
      totalOutflow: null,
      netChange: null,
      closingTotal: null,
      accountClosing: {
        general: null,
        business: null,
        welfare_one: null,
        welfare_two: null,
      },
    });
  });

  it("拒绝缺失或重复账户，避免生成错误合计", () => {
    const invalid = report();
    invalid.accounts = invalid.accounts.slice(0, 3);
    expect(() => buildMonthlyFinancialTrendPoint(invalid)).toThrow(
      "2026-01月度趋势四账户明细不完整",
    );
  });

  it("拒绝期末余额与四账户收支不一致的数据", () => {
    const invalid = report();
    invalid.accounts[0]!.closing = "149";
    expect(() => buildMonthlyFinancialTrendPoint(invalid)).toThrow(
      "2026-01月度趋势账户余额与收支变动不一致",
    );
  });
});

describe("月度财务趋势响应", () => {
  it("按完整月份轴输出断点、当前工作值提示、校验提示和可用年份", () => {
    const data = buildMonthlyFinancialTrendData({
      from: "2026-01",
      to: "2026-03",
      availableYears: [2026, 2025, 2026, Number.NaN],
      reports: [
        report(),
        report({
          month: "2026-03",
          status: "draft",
          validations: {
            blockers: [
              { code: "PREVIOUS_MONTH_NOT_CLOSED", message: "上月尚未月结" },
            ],
            warnings: [],
          },
        }),
      ],
    });

    expect(data.availableYears).toEqual([2025, 2026]);
    expect(data.points.map((point) => point.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(data.points[1]?.actualReceipt).toBeNull();
    expect(data.points[2]?.valueState).toBe("current");
    expect(data.points[2]).not.toHaveProperty("isEstimate");
    expect(data.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MONTHLY_FINANCE_TREND_MISSING_MONTHS",
          months: ["2026-02"],
        }),
        expect.objectContaining({
          code: "MONTHLY_FINANCE_TREND_CURRENT_MONTHS",
          message: "范围内有1个月尚未月结，当前显示未月结报表的当前精确工作值",
          months: ["2026-03"],
        }),
        {
          code: "PREVIOUS_MONTH_NOT_CLOSED",
          message: "上月尚未月结",
          months: ["2026-03"],
        },
      ]),
    );
  });
});
