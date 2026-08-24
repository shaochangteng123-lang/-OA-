import {
  calculateContractAmountChange,
  calculateContractCompletion,
  calculateMainBusinessIncome,
  calculateNonMainIncome,
  centsToAmount,
  classifyContractSettlement,
  shiftContractNaturalMonth,
  summarizeContractMonth,
  toCents,
} from "../server/services/contractAccounting";
import {
  clampPercent,
  escapeContractCsvCell,
  normalizeContractPercent,
  shouldDisplayContractCurrentAmount,
} from "../src/utils/contractPresentation";
import fs from "fs";
import path from "path";

describe("合同财务整数分核算", () => {
  it("合同详情核算使用合同累计回款，本月和本年收入保持独立统计", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /aggregateMainBusinessIncome\(\s*receipts,\s*rateHistory,?\s*\)/,
    );
    expect(source).toMatch(
      /aggregateNonMainIncome\(\s*receipts,\s*rateHistory,?\s*\)/,
    );
    expect(source).toContain(
      "monthIncome: sumContractAmounts(monthlyReceipts)",
    );
    expect(source).toContain("yearIncome: sumContractAmounts(yearlyReceipts)");
    expect(source).toContain("合同核算按该合同全部已确认回款累计计算");
  });

  it("主营收入按税费、营销预留和 10% 商务费用顺序核算", () => {
    expect(calculateMainBusinessIncome("10000.00")).toEqual({
      contractAmountCents: 1_000_000,
      taxCents: 117_200,
      marketingReserveCents: 44_140,
      businessCostCents: 83_866,
      accountingBaseCents: 754_794,
    });
  });

  it("非主营收入按 0.28% 财务成本和 11.72% 税费核算", () => {
    expect(calculateNonMainIncome(10000)).toEqual({
      contractAmountCents: 1_000_000,
      financialCostCents: 2_800,
      taxCents: 117_200,
      accountingBaseCents: 880_000,
    });
  });

  it("金额只接受最多两位小数且完成率给出超额提醒", () => {
    expect(toCents("1,234.56")).toBe(123_456);
    expect(centsToAmount(123_456)).toBe(1234.56);
    expect(() => toCents("1,234.567")).toThrow("金额格式不正确");
    expect(calculateContractCompletion(120, 100)).toMatchObject({
      completionPercentage: 120,
      completed: true,
      excessAmountCents: 2_000,
      warning: "结算金额超过合同总额 20.00 元",
    });
    expect(toCents("999999999999.99")).toBe(99_999_999_999_999);
    expect(() => toCents("1000000000000.00")).toThrow(
      "金额超过系统可安全计算范围",
    );
  });

  it("月度统计排除冲正和其他月份记录", () => {
    expect(
      summarizeContractMonth(
        [
          { amount: 100, occurredAt: "2026-08-01", status: "confirmed" },
          { amount: 50, occurredAt: "2026-08-02", status: "reversed" },
          { amount: 80, occurredAt: "2026-07-31", status: "confirmed" },
          { amount: 30, occurredAt: "2026-08-03", status: "draft" },
        ],
        "2026-08",
      ),
    ).toEqual({ month: "2026-08", activeRecordCount: 1, amountCents: 10_000 });
  });

  it("合同结算状态严格区分未结算、部分结算和已结清", () => {
    expect(classifyContractSettlement(0, 100)).toBe("unsettled");
    expect(classifyContractSettlement(30, 100)).toBe("partial");
    expect(classifyContractSettlement(100, 100)).toBe("settled");
    expect(classifyContractSettlement(120, 100)).toBe("settled");
    expect(classifyContractSettlement(0, 0)).toBe("unsettled");
  });

  it("三期比较按分计算差额并在零分母时保留不可比状态", () => {
    expect(calculateContractAmountChange("100.01", "80.00")).toEqual({
      amountCents: 2_001,
      amount: 20.01,
      percentage: 25.01,
    });
    expect(calculateContractAmountChange("100.00", "0.00")).toEqual({
      amountCents: 10_000,
      amount: 100,
      percentage: null,
    });
    expect(calculateContractAmountChange("80.00", "100.00")).toEqual({
      amountCents: -2_000,
      amount: -20,
      percentage: -20,
    });
  });

  it("自然月比较在一月份正确回退到上一年度十二月", () => {
    expect(shiftContractNaturalMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftContractNaturalMonth("2026-01", -12)).toBe("2025-01");
    expect(shiftContractNaturalMonth("2026-12", 1)).toBe("2027-01");
  });

  it("前端完成率保留最多两位小数，展示值允许超过 100%", () => {
    expect(normalizeContractPercent(50.256)).toBe(50.26);
    expect(normalizeContractPercent(120.125)).toBe(120.13);
    expect(normalizeContractPercent(-1)).toBe(0);
    expect(clampPercent(120.125)).toBe(100);
    expect(clampPercent(50.256)).toBe(50.26);
  });

  it("当前合同总额为零时按合同阶段正确展示", () => {
    expect(
      shouldDisplayContractCurrentAmount(0, "effective", "main", null),
    ).toBe(true);
    expect(
      shouldDisplayContractCurrentAmount(0, "terminated", "main", null),
    ).toBe(true);
    expect(
      shouldDisplayContractCurrentAmount(0, "rejected", "main", null),
    ).toBe(true);
    expect(shouldDisplayContractCurrentAmount(0, "draft", "main", null)).toBe(
      false,
    );
    expect(
      shouldDisplayContractCurrentAmount(null, "effective", "main", null),
    ).toBe(false);
  });

  it("合同台账 CSV 单元格阻止公式注入并保留合法负数", () => {
    expect(escapeContractCsvCell("=1+1")).toBe('"\'=1+1"');
    expect(escapeContractCsvCell("@SUM(A1:A2)")).toBe('"\'@SUM(A1:A2)"');
    expect(escapeContractCsvCell("  =1+1")).toBe('"\'  =1+1"');
    expect(escapeContractCsvCell("-100.25")).toBe('"-100.25"');
    expect(escapeContractCsvCell('普通"合同')).toBe('"普通""合同"');
  });

  it("费率维护只新增历史版本并在事务中闭合前一区间", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(source).toContain('router.get("/rates", requireContractRead');
    expect(source).toContain('router.post("/rates", requireFinance');
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("SET effective_to = $2");
    expect(source).toContain("CONTRACT_RATE_PRECISION_INVALID");
    expect(source).not.toContain("SET rate_value =");
  });
});
