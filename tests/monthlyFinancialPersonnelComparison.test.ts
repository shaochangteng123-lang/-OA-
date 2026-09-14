import { sortPersonnelComparisonDescending } from "@/utils/monthlyFinancialPersonnelComparison";
import type { FinancialAnalysisValue } from "@/types/monthlyFinancialAnalysis";
const item = (key: string, amount: string | null): FinancialAnalysisValue => ({
  key,
  label: key,
  amount,
});
describe("人员成本比较按金额从高到低", () => {
  test("按实际费用降序而不改变原数组或金额", () => {
    const items = [
      item("吴", "206208.93"),
      item("曹", "155693.31"),
      item("刘", "200434.60"),
      item("邵", "140668.29"),
      item("丁", "121893.42"),
      item("赵", "142300.76"),
    ];
    const before = JSON.stringify(items);
    expect(
      sortPersonnelComparisonDescending(items).map((row) => row.key),
    ).toEqual(["吴", "刘", "曹", "赵", "邵", "丁"]);
    expect(JSON.stringify(items)).toBe(before);
  });
  test("超出浮点精度的微小差别仍精确排序", () => {
    const items = [
      item("少", "123456789012345678.123456789011"),
      item("多", "123456789012345678.123456789012"),
    ];
    expect(
      sortPersonnelComparisonDescending(items).map((row) => row.key),
    ).toEqual(["多", "少"]);
  });
  test("负数按真实数值，未知最后；同值含正负零保持稳定", () => {
    const items = [
      item("未知", null),
      item("负二", "-2"),
      item("零", "0"),
      item("正", "+1.0"),
      item("负一", "-1"),
      item("无效", "不是金额"),
      item("负零", "-0.00"),
      item("同正", "1.00"),
    ];
    expect(
      sortPersonnelComparisonDescending(items).map((row) => row.key),
    ).toEqual(["正", "同正", "零", "负零", "负一", "负二", "未知", "无效"]);
  });
});
