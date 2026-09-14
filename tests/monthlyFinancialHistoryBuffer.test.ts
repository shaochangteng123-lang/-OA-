import {
  financialHistoryBufferRange,
  financialHistoryRangeCovered,
} from "@/utils/monthlyFinancialHistoryBuffer";
import { financialWindowQuery } from "@/utils/monthlyFinancialAnalysisWindow";
import type { FinancialAnalysisQuery } from "@/types/monthlyFinancialAnalysis";

const monthly: FinancialAnalysisQuery = {
  from: "2025-10",
  to: "2026-09",
  granularity: "month",
  comparisonYear: 2024,
  partyA: "甲方",
  contractRegion: "海淀区",
  reimbursementScope: "报销范围",
  personId: "人员甲",
};

describe("历史窗口前后缓冲范围", () => {
  it("月度默认前后各扩十二个月，并可使用三个月边缘阈值", () => {
    expect(
      financialHistoryBufferRange(monthly, "month", "1900-01", "2099-12"),
    ).toEqual({ from: "2024-10", to: "2027-09" });
    expect(
      financialHistoryBufferRange(
        monthly,
        "month",
        "1900-01",
        "2099-12",
        undefined,
        3,
      ),
    ).toEqual({ from: "2025-07", to: "2026-12" });
    expect(
      financialHistoryBufferRange(
        monthly,
        "month",
        "1900-01",
        "2099-12",
        undefined,
        0,
      ),
    ).toEqual({ from: monthly.from, to: monthly.to });
  });
  it("季度默认前后各扩十二个自然季度，不误作十二个月", () => {
    expect(
      financialHistoryBufferRange(
        { from: "2023-10", to: "2026-09" },
        "quarter",
        "1900-01",
        "2099-12",
      ),
    ).toEqual({ from: "2020-10", to: "2029-09" });
    expect(
      financialHistoryBufferRange(
        { from: "2023-10", to: "2026-09" },
        "quarter",
        "1900-01",
        "2099-12",
        undefined,
        3,
      ),
    ).toEqual({ from: "2023-01", to: "2027-06" });
  });
  it("按最早可用月和最大截止月裁剪，绝不预取未来", () => {
    expect(
      financialHistoryBufferRange(monthly, "month", "2025-01", "2026-09"),
    ).toEqual({ from: "2025-01", to: "2026-09" });
    expect(
      financialHistoryBufferRange(
        { from: "2023-10", to: "2026-08" },
        "quarter",
        "2021-02",
        "2026-08",
      ),
    ).toEqual({ from: "2021-04", to: "2026-08" });
    expect(
      financialHistoryBufferRange(
        { from: "2023-10", to: "2026-06" },
        "quarter",
        "1900-01",
        "2026-08",
      ),
    ).toEqual({ from: "2020-10", to: "2026-08" });
  });
  it("部分首季或尾季必须保留实际月份，不能为缓冲改变可见期金额", () => {
    expect(
      financialHistoryBufferRange(
        { from: "2026-02", to: "2026-08" },
        "quarter",
        "1900-01",
        "2099-12",
      ),
    ).toEqual({ from: "2026-02", to: "2026-08" });
    expect(
      financialHistoryBufferRange(
        { from: "2026-01", to: "2026-08" },
        "quarter",
        "1900-01",
        "2099-12",
      ),
    ).toEqual({ from: "2023-01", to: "2026-08" });
    expect(
      financialHistoryBufferRange(
        { from: "2026-02", to: "2026-09" },
        "quarter",
        "1900-01",
        "2099-12",
      ),
    ).toEqual({ from: "2026-02", to: "2029-09" });
  });
  it("1900与2099边界和超大合法padding均裁在范围内", () => {
    expect(
      financialHistoryBufferRange(
        { from: "1900-01", to: "1900-01" },
        "month",
        "1900-01",
        "1900-01",
      ),
    ).toEqual({ from: "1900-01", to: "1900-01" });
    expect(
      financialHistoryBufferRange(
        { from: "2099-01", to: "2099-12" },
        "quarter",
        "1900-01",
        "2099-12",
      ),
    ).toEqual({ from: "2096-01", to: "2099-12" });
    expect(
      financialHistoryBufferRange(
        monthly,
        "month",
        "1900-01",
        "2099-12",
        undefined,
        Number.MAX_SAFE_INTEGER,
      ),
    ).toEqual({ from: "1900-01", to: "2099-12" });
  });
  it.each(["month", "quarter"] as const)(
    "同比接近1900下界时收缩%s前缓冲，保留可见查询原本有效的同比",
    (granularity) => {
      const source: FinancialAnalysisQuery = {
        from: "1903-01",
        to: "1903-12",
        granularity,
        comparisonYear: 1901,
      };
      const visible = { from: "1902-07", to: "1903-06" };
      const buffered = financialHistoryBufferRange(
        visible,
        granularity,
        "1900-01",
        "1904-12",
        source,
      );
      expect(buffered.from).toBe("1902-01");
      const target = financialWindowQuery(source, visible, granularity);
      const candidate = financialWindowQuery(source, buffered, granularity);
      expect(target.comparisonYear).toBe(1900);
      expect(candidate.comparisonYear).toBe(1900);
      expect(financialHistoryRangeCovered(candidate, target)).toBe(true);
    },
  );
  it("可见窗口本就早于合法同比范围时不抛弃可见期或伪造1899比较", () => {
    const source: FinancialAnalysisQuery = {
      from: "1903-01",
      to: "1903-12",
      granularity: "month",
      comparisonYear: 1902,
    };
    const visible = { from: "1900-01", to: "1900-12" };
    const buffered = financialHistoryBufferRange(
      visible,
      "month",
      "1900-01",
      "1904-12",
      source,
    );
    expect(buffered.from).toBe("1900-01");
    expect(financialWindowQuery(source, buffered)).not.toHaveProperty(
      "comparisonYear",
    );
  });
  it("范围和来源条件均不被修改，返回值不带金额或业务记录", () => {
    const visible = Object.freeze({ from: monthly.from, to: monthly.to });
    const source = Object.freeze({ ...monthly });
    const result = financialHistoryBufferRange(
      visible,
      "month",
      "1900-01",
      "2026-09",
      source,
    );
    expect(visible).toEqual({ from: "2025-10", to: "2026-09" });
    expect(source).toEqual(monthly);
    expect(Object.keys(result).sort()).toEqual(["from", "to"]);
    expect(result).not.toBe(visible);
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "非法缓冲期数%j明确拒绝",
    (padding) => {
      expect(() =>
        financialHistoryBufferRange(
          monthly,
          "month",
          "1900-01",
          "2099-12",
          undefined,
          padding,
        ),
      ).toThrow("非负安全整数");
    },
  );
  it("非法月份、反向边界、范围越界、年度粒度与非法同比明确拒绝", () => {
    expect(() =>
      financialHistoryBufferRange(
        { from: "1899-12", to: "1900-01" },
        "month",
        "1900-01",
        "2099-12",
      ),
    ).toThrow("1900至2099");
    expect(() =>
      financialHistoryBufferRange(monthly, "month", "2026-01", "2025-01"),
    ).toThrow("开始月份");
    expect(() =>
      financialHistoryBufferRange(monthly, "month", "2026-01", "2026-09"),
    ).toThrow("可见历史窗口");
    expect(() =>
      financialHistoryBufferRange(
        monthly,
        "year" as "month",
        "1900-01",
        "2099-12",
      ),
    ).toThrow("月度或季度");
    expect(() =>
      financialHistoryBufferRange(monthly, "month", "1900-01", "2099-12", {
        ...monthly,
        comparisonYear: 2025,
      }),
    ).toThrow("同比年份");
  });
});

describe("完整历史响应覆盖判定", () => {
  const buffered = {
    ...monthly,
    from: "2024-10",
    to: "2027-09",
    comparisonYear: 2023,
  };
  it("同筛选同年差的月度缓冲覆盖目标，不要求comparisonYear字面相同", () => {
    expect(financialHistoryRangeCovered(buffered, monthly)).toBe(true);
    expect(
      financialHistoryRangeCovered(
        Object.freeze({ ...monthly }),
        Object.freeze({ ...monthly }),
      ),
    ).toBe(true);
  });
  it("范围缺左端、缺右端、反向或非法月份不能复用", () => {
    expect(
      financialHistoryRangeCovered({ ...monthly, from: "2025-11" }, monthly),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered({ ...monthly, to: "2026-08" }, monthly),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered(
        { ...monthly, from: "2026-12", to: "2026-01" },
        monthly,
      ),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered({ ...monthly, from: "2025-13" }, monthly),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered(buffered, { ...monthly, to: "2100-01" }),
    ).toBe(false);
  });
  it.each([
    "partyA",
    "contractRegion",
    "reimbursementScope",
    "personId",
  ] as const)("筛选%s不同不能复用或串用其他业务数据", (key) => {
    expect(
      financialHistoryRangeCovered({ ...buffered, [key]: "另一条件" }, monthly),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered({ ...buffered, [key]: undefined }, monthly),
    ).toBe(false);
  });
  it("省略与空筛选视为全部，真实非空文本不擅自去空格合并", () => {
    const plain = {
      from: "2026-01",
      to: "2026-12",
      granularity: "month" as const,
    };
    expect(
      financialHistoryRangeCovered(plain, { ...plain, personId: "" }),
    ).toBe(true);
    expect(
      financialHistoryRangeCovered(
        { ...plain, partyA: "甲方 " },
        { ...plain, partyA: "甲方" },
      ),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered(
        { ...plain, personId: null as unknown as string },
        plain,
      ),
    ).toBe(false);
  });
  it("年差不同、开关不同或非法比较年份不能复用", () => {
    expect(
      financialHistoryRangeCovered(
        { ...buffered, comparisonYear: 2024 },
        monthly,
      ),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered(
        { ...buffered, comparisonYear: undefined },
        monthly,
      ),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered(buffered, {
        ...monthly,
        comparisonYear: undefined,
      }),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered(
        { ...buffered, comparisonYear: 1899 },
        monthly,
      ),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered(
        { ...buffered, comparisonYear: NaN },
        monthly,
      ),
    ).toBe(false);
  });
  it("跨年重锚保持固定两年差时可复用，同一个字面比较年却不同年差时拒绝", () => {
    const target: FinancialAnalysisQuery = {
      from: "2025-10",
      to: "2026-09",
      granularity: "quarter",
      comparisonYear: 2023,
    };
    const candidate = {
      ...target,
      from: "2022-10",
      to: "2028-09",
      comparisonYear: 2020,
    };
    expect(financialHistoryRangeCovered(candidate, target)).toBe(true);
    expect(
      financialHistoryRangeCovered(
        { ...candidate, comparisonYear: 2023 },
        target,
      ),
    ).toBe(false);
  });
  it("不同粒度和年度响应不作为连续月季窗口缓存", () => {
    expect(
      financialHistoryRangeCovered(
        { ...buffered, granularity: "quarter" },
        monthly,
      ),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered(
        { ...buffered, granularity: "year" },
        { ...monthly, granularity: "year" },
      ),
    ).toBe(false);
  });
  it("季度完整首末期可用更宽缓冲，但完整季不能替代未完尾季", () => {
    const target: FinancialAnalysisQuery = {
      from: "2025-10",
      to: "2026-08",
      granularity: "quarter",
    };
    expect(
      financialHistoryRangeCovered(
        { ...target, from: "2022-10", to: "2026-09" },
        target,
      ),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered({ ...target, from: "2022-10" }, target),
    ).toBe(true);
    expect(
      financialHistoryRangeCovered(
        { ...target, from: "2022-10", to: "2026-12" },
        { ...target, to: "2026-06" },
      ),
    ).toBe(true);
  });
  it("季度部分首期不能被从更早月份统计的完整首季替代", () => {
    const target: FinancialAnalysisQuery = {
      from: "2026-02",
      to: "2026-09",
      granularity: "quarter",
    };
    expect(
      financialHistoryRangeCovered({ ...target, from: "2026-01" }, target),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered({ ...target, from: "2025-10" }, target),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered({ ...target, to: "2026-12" }, target),
    ).toBe(true);
  });
  it("同一季度只取一个月时，首尾边界都必须精确相同", () => {
    const target: FinancialAnalysisQuery = {
      from: "2026-02",
      to: "2026-02",
      granularity: "quarter",
    };
    expect(financialHistoryRangeCovered(target, target)).toBe(true);
    expect(
      financialHistoryRangeCovered({ ...target, from: "2026-01" }, target),
    ).toBe(false);
    expect(
      financialHistoryRangeCovered({ ...target, to: "2026-03" }, target),
    ).toBe(false);
  });
  it("生成的季度缓冲可安全覆盖自身目标，截止月不被扩成不同金额期间", () => {
    const source: FinancialAnalysisQuery = {
      from: "2026-01",
      to: "2026-08",
      granularity: "quarter",
      comparisonYear: 2024,
    };
    const visible = { from: "2023-10", to: "2026-08" };
    const target = financialWindowQuery(source, visible, "quarter");
    const range = financialHistoryBufferRange(
      visible,
      "quarter",
      "1900-01",
      "2026-08",
      source,
    );
    const candidate = financialWindowQuery(source, range, "quarter");
    expect(financialHistoryRangeCovered(candidate, target)).toBe(true);
    expect(candidate.to).toBe("2026-08");
    expect(candidate.comparisonYear).toBe(2018);
  });
});
