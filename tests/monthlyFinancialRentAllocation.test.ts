/** @jest-environment node */
import {
  allocateBalancedAnnualRent,
  type BalancedAnnualRentMonth,
} from "../server/services/monthlyFinancialRentAllocation";

const members = ["a", "b", "c", "d", "e", "f"];
function month(
  month: string,
  amount = "20378",
  people: readonly string[] = members,
): BalancedAnnualRentMonth {
  return { month, amount, members: people };
}
function units(text: string, precision = 12): bigint {
  const [integer, decimal = ""] = text.split(".");
  return BigInt(integer + decimal.padEnd(precision, "0"));
}
function total(rows: Iterable<string>, precision = 12): bigint {
  return [...rows].reduce((sum, text) => sum + units(text, precision), 0n);
}
function assertMonthlyClosure(
  input: readonly BalancedAnnualRentMonth[],
  actual: Map<string, Map<string, string>>,
) {
  expect(actual.size).toBe(input.length);
  for (const row of input) {
    const payments = actual.get(row.month)!;
    expect([...payments.keys()].sort()).toEqual([...row.members].sort());
    if (!row.members.length) continue;
    expect(total(payments.values())).toBe(units(row.amount));
    expect(
      [...payments.values()].every((value) => /^\d+\.\d{2,12}$/u.test(value)),
    ).toBe(true);
    expect(
      [...payments.values()].every(
        (value) => units(value) >= 0n && units(value) <= units(row.amount),
      ),
    ).toBe(true);
    const decimals = row.amount.split(".")[1]?.length || 0;
    const precision = decimals < 2 ? 2 : decimals;
    const base = units(row.amount, precision) / BigInt(row.members.length);
    expect(
      [...payments.values()].every((value) => {
        const allocated = units(value, precision);
        return allocated === base || allocated === base + 1n;
      }),
    ).toBe(true);
  }
}
function individualTotals(
  result: Map<string, Map<string, string>>,
  people = members,
): bigint[] {
  return people.map((id) =>
    total([...result.values()].map((row) => row.get(id) || "0")),
  );
}
function maximumSpread(values: bigint[]): bigint {
  const sorted = [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return sorted[sorted.length - 1] - sorted[0];
}

describe("自然年累计精确欠额平衡房租尾差", () => {
  it("20378元八个月加4754.87元，六人累计为三人27963.15与三人27963.14", () => {
    const input = ["01", "02", "03", "04", "05", "06", "07", "08"].map((m) =>
      month(`2026-${m}`),
    );
    input.push(month("2026-09", "4754.87"));
    const result = allocateBalancedAnnualRent(input);
    assertMonthlyClosure(input, result);
    expect(individualTotals(result)).toEqual(
      [
        "27963.15",
        "27963.15",
        "27963.15",
        "27963.14",
        "27963.14",
        "27963.14",
      ].map((value) => units(value)),
    );
    expect([...result.get("2026-01")!.values()]).toEqual([
      "3396.34",
      "3396.34",
      "3396.33",
      "3396.33",
      "3396.33",
      "3396.33",
    ]);
    expect([...result.get("2026-02")!.values()]).toEqual([
      "3396.33",
      "3396.33",
      "3396.34",
      "3396.34",
      "3396.33",
      "3396.33",
    ]);
    expect([...result.get("2026-03")!.values()]).toEqual([
      "3396.33",
      "3396.33",
      "3396.33",
      "3396.33",
      "3396.34",
      "3396.34",
    ]);
  });

  it("输入月份与成员逆序不影响结果，冻结输入完全不改变", () => {
    const input = Object.freeze(
      [
        month("2026-03", "0.01"),
        month("2026-01", "0.01"),
        month("2026-02", "0.01"),
      ].map((row) =>
        Object.freeze({ ...row, members: Object.freeze([...row.members]) }),
      ),
    );
    const before = JSON.stringify(input);
    const normal = allocateBalancedAnnualRent(input);
    const reversed = allocateBalancedAnnualRent(
      [...input]
        .reverse()
        .map((row) => ({ ...row, members: [...row.members].reverse() })),
    );
    expect(reversed).toEqual(normal);
    expect([...normal.keys()]).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("同参人员每个前缀累计差距最多一分，尾差不长期固定给同一人", () => {
    const input = [
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
    ].map((m) =>
      month(
        `2026-${m}`,
        m === "04" ? "0.02" : m === "09" ? "4754.87" : "20378",
      ),
    );
    for (let length = 1; length <= input.length; length += 1) {
      const result = allocateBalancedAnnualRent(input.slice(0, length));
      assertMonthlyClosure(input.slice(0, length), result);
      expect(maximumSpread(individualTotals(result))).toBeLessThanOrEqual(
        units("0.01"),
      );
    }
  });

  it("自然年重新计算欠额，不将上一年尾差带入次年", () => {
    const input = [
      month("2025-12", "0.01", ["b", "a"]),
      month("2026-01", "0.01", ["b", "a"]),
      month("2026-02", "0.01", ["a", "b"]),
    ];
    const result = allocateBalancedAnnualRent(input);
    expect([...result.get("2025-12")!.values()]).toEqual(["0.01", "0.00"]);
    expect([...result.get("2026-01")!.values()]).toEqual(["0.01", "0.00"]);
    expect([...result.get("2026-02")!.values()]).toEqual(["0.00", "0.01"]);
    assertMonthlyClosure(input, result);
  });

  it("入职离职返场只分给当月在场者，保留同年已有欠额而不替无名单月份猜人员", () => {
    const input = [
      month("2026-01", "0.01", ["a", "b"]),
      month("2026-02", "0.01", ["a", "c"]),
      month("2026-03", "100", []),
      month("2026-04", "0.01", ["a", "b"]),
      month("2026-05", "0.01", ["b", "c"]),
    ];
    const result = allocateBalancedAnnualRent(input);
    expect(result.get("2026-02")!.has("b")).toBe(false);
    expect(result.get("2026-02")!.get("c")).toBe("0.01");
    expect(result.get("2026-03")!.size).toBe(0);
    expect(result.get("2026-04")!.get("b")).toBe("0.01");
    expect(result.get("2026-05")!.has("a")).toBe(false);
    assertMonthlyClosure(input, result);
    expect(
      allocateBalancedAnnualRent(
        input.filter((row) => row.month !== "2026-03"),
      ),
    ).toEqual(new Map([...result].filter(([m]) => m !== "2026-03")));
  });

  it("零值、单人和极小金额保持精确，空输入和无名单不产生分摊", () => {
    const input = [
      month("2026-01", "0"),
      month("2026-02", "0.00"),
      month("2026-03", "0.01"),
      month("2026-04", "0.000000000001"),
      month("2026-05", "999999999999999999.123456789012", ["a"]),
    ];
    const result = allocateBalancedAnnualRent(input);
    expect([...result.get("2026-01")!.values()]).toEqual(Array(6).fill("0.00"));
    expect(result.get("2026-05")!.get("a")).toBe(
      "999999999999999999.123456789012",
    );
    assertMonthlyClosure(input, result);
    expect(allocateBalancedAnnualRent([])).toEqual(new Map());
    expect(
      allocateBalancedAnnualRent([month("2026-01", "0.000000000001", [])]),
    ).toEqual(new Map([["2026-01", new Map()]]));
  });

  it("极大额及十二位小数全程不经浮点，每月和累计分位精确闭合", () => {
    const input = [
      month("2026-01", "999999999999999999.123456789012"),
      month("2026-02", "0.000000000001"),
      month("2026-03", "999999999999999999.999999999999"),
    ];
    const result = allocateBalancedAnnualRent(input);
    assertMonthlyClosure(input, result);
    expect(maximumSpread(individualTotals(result))).toBeLessThanOrEqual(1n);
    expect(
      individualTotals(result).reduce((sum, value) => sum + value, 0n),
    ).toBe(total(input.map((row) => row.amount)));
  });

  it("混合精度保存精确元欠额，未来高精度不改变前月，公平界使用当年最大舍入单位", () => {
    const input = [
      month("2026-01", "0.01", ["a", "b"]),
      month("2026-02", "0.000000000001", ["a", "b"]),
      month("2026-03", "100.0000", ["a", "b"]),
      month("2026-04", "0.01", ["a", "b"]),
    ];
    const result = allocateBalancedAnnualRent(input);
    assertMonthlyClosure(input, result);
    expect(result.get("2026-01")!.get("a")).toBe("0.01");
    expect(result.get("2026-02")!.get("b")).toBe("0.000000000001");
    for (let length = 1; length <= input.length; length += 1) {
      const partial = allocateBalancedAnnualRent(input.slice(0, length));
      for (const [m, shares] of partial) expect(shares).toEqual(result.get(m));
      expect(
        maximumSpread(individualTotals(partial, ["a", "b"])),
      ).toBeLessThanOrEqual(units("0.01"));
    }
    expect(
      maximumSpread(
        individualTotals(allocateBalancedAnnualRent(input.slice(0, 2)), [
          "a",
          "b",
        ]),
      ),
    ).toBeGreaterThan(1n);
  });

  it("其他成员变化时，同参两人的累计误差仍不超过年内最大舍入单位", () => {
    const rosters = [
      ["a", "b", "c"],
      ["a", "b"],
      ["a", "b", "d", "e"],
      ["a", "b", "e"],
      ["a", "b", "c", "d", "e", "f"],
      ["a", "b", "f"],
    ];
    const input = ["01", "02", "03", "04", "05", "06"].map((m, index) =>
      month(`2026-${m}`, "0.05", rosters[index]),
    );
    for (let length = 1; length <= input.length; length += 1) {
      const result = allocateBalancedAnnualRent(input.slice(0, length));
      assertMonthlyClosure(input.slice(0, length), result);
      expect(
        maximumSpread(individualTotals(result, ["a", "b"])),
      ).toBeLessThanOrEqual(units("0.01"));
    }
  });

  it("即使历史欠额相差较大，当月同一人员也不能拿两个剩余单位", () => {
    const input = [
      month("2026-01", "0.02", ["a", "b", "c"]),
      month("2026-02", "0.000000000002", ["a", "b", "c"]),
    ];
    const result = allocateBalancedAnnualRent(input);
    assertMonthlyClosure(input, result);
    expect([...result.get("2026-02")!.values()]).toEqual([
      "0.000000000001",
      "0.000000000000",
      "0.000000000001",
    ]);
  });

  it.each([
    "",
    "2026-00",
    "2026-13",
    "2026-1",
    "26-01",
    "0000-01",
    "2026-01-01",
  ])("无效月份%s拒绝", (value) => {
    expect(() => allocateBalancedAnnualRent([month(value)])).toThrow("月份");
  });
  it.each([
    "",
    "-1",
    "-0",
    "+1",
    "1e3",
    "NaN",
    "Infinity",
    "1.",
    ".1",
    " 1 ",
    "0.0000000000001",
  ])("无效金额%s拒绝", (value) => {
    expect(() => allocateBalancedAnnualRent([month("2026-01", value)])).toThrow(
      "金额",
    );
  });
  it("重复月份、重复成员、空编号和非文本金额拒绝，不接受浮点金额", () => {
    expect(() =>
      allocateBalancedAnnualRent([month("2026-01"), month("2026-01")]),
    ).toThrow("月份重复");
    expect(() =>
      allocateBalancedAnnualRent([month("2026-01", "1", ["a", "a"])]),
    ).toThrow("编号重复");
    for (const invalid of ["", " a", "a "])
      expect(() =>
        allocateBalancedAnnualRent([month("2026-01", "1", [invalid])]),
      ).toThrow("编号");
    expect(() =>
      allocateBalancedAnnualRent([
        { month: "2026-01", amount: 0.1, members },
      ] as unknown as BalancedAnnualRentMonth[]),
    ).toThrow("浮点数字");
    expect(() =>
      allocateBalancedAnnualRent(null as unknown as BalancedAnnualRentMonth[]),
    ).toThrow("月份数组");
  });
});
