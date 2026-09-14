import {
  buildAnnualBalanceStructure,
  buildMonthlyBalanceStructure,
} from "../src/utils/monthlyFinancialBalanceStructure";
import type {
  FinancialAnalysisDetail,
  FinancialAnalysisModule,
} from "../src/types/monthlyFinancialAnalysis";

const codes = ["general", "business", "welfare_one", "welfare_two"];
const labels = ["一般账户", "商务账户", "福利金账户一", "福利金账户二"];

function moduleWithMonths(
  months: string[],
  values: Array<Array<string | null>>,
): FinancialAnalysisModule {
  return {
    key: "balances",
    title: "账户余额资金台帐",
    description: "四账户余额",
    sourceLabel: "月报",
    updatedAt: null,
    periods: months.map((month) => ({
      key: month,
      label: month,
      from: month,
      to: month,
    })),
    series: codes.map((key, index) => ({
      key,
      label: labels[index],
      values: values.map((row) => row[index]),
    })),
    summaries: [],
    breakdown: [],
    comparison: [],
    columns: [],
    details: [],
    warnings: [],
    appliedFilters: [],
  };
}

function details(
  month: string,
  values: Array<string | null>,
): FinancialAnalysisDetail[] {
  return codes.map((code, index) => ({
    id: `${month}:${code}`,
    month,
    account: labels[index],
    closing: values[index],
    sourceState: "已月结快照",
  }));
}

describe("点选月份四账户资金占比", () => {
  it("按同一月份精确读取四账户，不把总额序列作为第五项", () => {
    const module = moduleWithMonths(
      ["2026-07", "2026-08"],
      [
        ["1", "2", "3", "4"],
        ["2053235.4", "0", "10.000000000001", "20"],
      ],
    );
    module.series.push({
      key: "total",
      label: "已有合计",
      values: ["999999", "999999"],
    });
    const before = JSON.stringify(module);
    const result = buildMonthlyBalanceStructure(module, "2026-08");
    expect(result.items.map((item) => item.key)).toEqual(codes);
    expect(result.items.map((item) => item.amount)).toEqual([
      "2053235.4",
      "0",
      "10.000000000001",
      "20",
    ]);
    expect(result.total).toBe("2053265.400000000001");
    expect(result.note).toContain("来源合计序列金额¥999,999.00");
    expect(result.note).toContain("不反推或修改账户余额");
    expect(result.month).toBe("2026-08");
    expect(JSON.stringify(module)).toBe(before);
  });

  it("缺失任一账户保持合计未知，其他已知零值不消失", () => {
    const result = buildMonthlyBalanceStructure(
      moduleWithMonths(["2026-08"], [["0", "5", null, "7"]]),
      "2026-08",
    );
    expect(result.items.map((item) => item.amount)).toEqual([
      "0",
      "5",
      null,
      "7",
    ]);
    expect(result.total).toBeNull();
  });

  it("合计序列仅显示精度不同不误报警，年度真实合计差异也明确提示", () => {
    const module = moduleWithMonths(["2026-08"], [["1", "2", "3", "4"]]);
    module.series.push({ key: "total", label: "来源合计", values: ["10.00"] });
    expect(buildMonthlyBalanceStructure(module, "2026-08").note).not.toContain(
      "不一致",
    );
    module.series.find((series) => series.key === "total")!.values[0] = "11";
    const result = buildAnnualBalanceStructure(module, "2026-09");
    expect(result.total).toBe("10");
    expect(result.note).toContain(
      "来源合计序列金额¥11.00与四账户精确合计¥10.00不一致",
    );
    expect(result.items.map((item) => item.amount)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("全零是可核验余额，合计为零而不是未知", () => {
    const result = buildMonthlyBalanceStructure(
      moduleWithMonths(["2026-08"], [["0", "0.00", "+0", "-0.000"]]),
      "2026-08",
    );
    expect(result.total).toBe("0");
    expect(result.month).toBe("2026-08");
    expect(result.note).toContain("零金额不是缺失数据");
  });

  it("负数保留符号和精确总额，不取绝对值", () => {
    const result = buildMonthlyBalanceStructure(
      moduleWithMonths(["2026-08"], [["-10.1", "1.2", "0", "2.000000000001"]]),
      "2026-08",
    );
    expect(result.total).toBe("-6.899999999999");
    expect(result.items[0].amount).toBe("-10.1");
    expect(result.note).toContain("存在负余额");
  });

  it("超长金额相加不转换浮点数，不限制聚合后的整数位", () => {
    const result = buildMonthlyBalanceStructure(
      moduleWithMonths(
        ["2026-08"],
        [
          [
            "999999999999999999.123456789012",
            "999999999999999999.000000000001",
            "0",
            "1",
          ],
        ],
      ),
      "2026-08",
    );
    expect(result.total).toBe("1999999999999999999.123456789013");
  });

  it("拒绝异常金额而不是利用加法工具静默忽略", () => {
    const result = buildMonthlyBalanceStructure(
      moduleWithMonths(["2026-08"], [["12", "1,000", "3", "4"]]),
      "2026-08",
    );
    expect(result.total).toBeNull();
    expect(result.items[1].amount).toBeNull();
  });

  it("重复月份或重复账户序列不任意取首条", () => {
    const duplicateMonth = moduleWithMonths(
      ["2026-08", "2026-08"],
      [
        ["1", "2", "3", "4"],
        ["10", "20", "30", "40"],
      ],
    );
    expect(
      buildMonthlyBalanceStructure(duplicateMonth, "2026-08").total,
    ).toBeNull();
    const duplicateAccount = moduleWithMonths(
      ["2026-08"],
      [["1", "2", "3", "4"]],
    );
    duplicateAccount.series.push({
      key: "general",
      label: "重复一般账户",
      values: ["99"],
    });
    expect(
      buildMonthlyBalanceStructure(duplicateAccount, "2026-08").items[0].amount,
    ).toBeNull();
    expect(
      buildMonthlyBalanceStructure(duplicateAccount, "2026-08").total,
    ).toBeNull();
  });

  it("点选月不使用季度值、明细或另一个月份补齐", () => {
    const module = moduleWithMonths(["2026-07"], [["1", "2", "3", "4"]]);
    module.periods[0] = {
      key: "2026-Q3",
      label: "三季度",
      from: "2026-07",
      to: "2026-09",
    };
    module.details = details("2026-08", ["10", "20", "30", "40"]);
    const result = buildMonthlyBalanceStructure(module, "2026-08");
    expect(result.total).toBeNull();
    expect(result.month).toBeNull();
  });

  it("对比期选择使用传入的真实月份并显式标记", () => {
    const result = buildMonthlyBalanceStructure(
      moduleWithMonths(["2025-08"], [["1", "2", "3", "4"]]),
      "2025-08",
      true,
    );
    expect(result.scopeLabel).toContain("对比期");
    expect(result.scopeLabel).toContain("2025-08");
    expect(result.total).toBe("10");
  });

  it("缺模块和非法月份均保持未知", () => {
    expect(buildMonthlyBalanceStructure(undefined, "2026-08").total).toBeNull();
    expect(buildMonthlyBalanceStructure(undefined, "2026-13").month).toBeNull();
  });
});

describe("年度最近有效余额时点", () => {
  it("只取当年截止月内最新完整同月余额，不累计、不跨年或取未来", () => {
    const module = moduleWithMonths(
      ["2025-12", "2026-01", "2026-08", "2026-10"],
      [
        ["900", "900", "900", "900"],
        ["1", "2", "3", "4"],
        ["10", "20", "30", "40"],
        ["100", "200", "300", "400"],
      ],
    );
    const result = buildAnnualBalanceStructure(module, "2026-09");
    expect(result.month).toBe("2026-08");
    expect(result.total).toBe("100");
    expect(result.scopeLabel).toBe(
      "2026年度资金占比 · 截至2026-08（年度最新有效时点）",
    );
  });

  it("最新完整时点为全零时不退回更早正余额", () => {
    const result = buildAnnualBalanceStructure(
      moduleWithMonths(
        ["2026-01", "2026-08"],
        [
          ["1", "2", "3", "4"],
          ["0", "0", "0", "0"],
        ],
      ),
      "2026-09",
    );
    expect(result.month).toBe("2026-08");
    expect(result.total).toBe("0");
  });

  it("最新月不完整时可选择同年度较早完整时点并明确截止", () => {
    const result = buildAnnualBalanceStructure(
      moduleWithMonths(
        ["2026-07", "2026-08"],
        [
          ["1", "2", "3", "4"],
          ["100", null, "300", "400"],
        ],
      ),
      "2026-09",
    );
    expect(result.month).toBe("2026-07");
    expect(result.total).toBe("10");
    expect(result.scopeLabel).toContain("截至2026-07");
  });

  it("季度或年度统计使用月度余额明细找最新月，不把季度端点冒充最新月", () => {
    const module = moduleWithMonths([], []);
    module.periods = [
      { key: "2026-Q3", label: "三季度", from: "2026-07", to: "2026-09" },
    ];
    module.series = codes.map((key, index) => ({
      key,
      label: labels[index],
      values: ["999"],
    }));
    module.details = [
      ...details("2026-07", ["1", "2", "3", "4"]),
      ...details("2026-08", ["10", "20", "30", "40"]),
    ];
    const result = buildAnnualBalanceStructure(module, "2026-09");
    expect(result.month).toBe("2026-08");
    expect(result.total).toBe("100");
    expect(result.note).toContain("同月账户余额明细");
  });

  it("明确存在的月度序列null不能被同月明细覆盖", () => {
    const module = moduleWithMonths(["2026-08"], [[null, null, null, null]]);
    module.details = details("2026-08", ["10", "20", "30", "40"]);
    const result = buildAnnualBalanceStructure(module, "2026-09");
    expect(result.total).toBeNull();
    expect(result.month).toBeNull();
  });

  it("同一月份重复余额明细或重复来源编号不能相加或任意挑选", () => {
    const module = moduleWithMonths([], []);
    module.details = [
      ...details("2026-08", ["10", "20", "30", "40"]),
      {
        id: "another-general",
        month: "2026-08",
        account: "一般账户",
        closing: "11",
      },
    ];
    expect(buildAnnualBalanceStructure(module, "2026-09").total).toBeNull();
    module.details = details("2026-08", ["10", "20", "30", "40"]);
    module.details[1].id = module.details[0].id;
    expect(buildAnnualBalanceStructure(module, "2026-09").total).toBeNull();
  });

  it("不将不同月份的各账户已知值拼成完整账户构成", () => {
    const module = moduleWithMonths([], []);
    module.details = [
      ...details("2026-07", ["1", null, null, null]),
      ...details("2026-08", [null, "2", "3", "4"]),
    ];
    const result = buildAnnualBalanceStructure(module, "2026-09");
    expect(result.total).toBeNull();
    expect(result.month).toBeNull();
  });

  it("本年度没有有效时点时不借上年度余额，输入保持不变", () => {
    const module = moduleWithMonths(
      ["2025-12", "2026-10"],
      [
        ["1", "2", "3", "4"],
        ["10", "20", "30", "40"],
      ],
    );
    const before = JSON.stringify(module);
    const result = buildAnnualBalanceStructure(module, "2026-09");
    expect(result.items.every((item) => item.amount === null)).toBe(true);
    expect(result.total).toBeNull();
    expect(result.month).toBeNull();
    expect(JSON.stringify(module)).toBe(before);
  });

  it("识别明确旧福利账户名称，账户标识冲突时不拼凑", () => {
    const module = moduleWithMonths([], []);
    module.details = details("2026-08", ["1", "2", "3", "4"]);
    module.details[2].account = "福利账户一";
    module.details[3].account = "福利账户二";
    expect(buildAnnualBalanceStructure(module, "2026-09").total).toBe("10");
    module.details[0].account = "商务账户";
    expect(buildAnnualBalanceStructure(module, "2026-09").total).toBeNull();
  });
});
