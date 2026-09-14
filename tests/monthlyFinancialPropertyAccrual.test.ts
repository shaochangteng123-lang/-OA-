/** @jest-environment node */
import {
  buildMonthlyFinancialRentAccrual,
  type AnalysisRentAccrualContract,
} from "../server/services/monthlyFinancialRentAccrual";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";
const lease: AnalysisRentAccrualContract = {
  id: "房屋",
  title: "办公房屋",
  status: "executing",
  effectiveAt: "2025-06-01",
  leaseStartDate: "2025-06-16",
  leaseEndDate: "2027-06-15",
  monthlyRent: "20378",
  monthlyPropertyFee: "6120",
};
const options = {
  from: "2026-01",
  to: "2026-09",
  asOfDate: "2026-09-07",
  currentMonthMode: "daily" as const,
};
describe("物业按同租期独立计提且不破坏租金专项", () => {
  it("八个完整月加9月截至7日物业为50388，租金专项仍为167778.87", () => {
    const before = JSON.stringify(lease);
    const property = buildMonthlyFinancialRentAccrual([lease], {
      ...options,
      component: "property_management",
    });
    expect(property.map((row) => row.amount)).toEqual([
      ...Array(8).fill("6120"),
      "1428",
    ]);
    expect(addFinancialAmounts(...property.map((row) => row.amount!))).toBe(
      "50388",
    );
    expect(property[8].lines[0]).toMatchObject({
      id: "property-accrual:房屋:2026-09",
      from: "2026-09-01",
      to: "2026-09-07",
    });
    expect(
      addFinancialAmounts(
        ...buildMonthlyFinancialRentAccrual([lease], options).map(
          (row) => row.amount!,
        ),
      ),
    ).toBe("167778.87");
    expect(JSON.stringify(lease)).toBe(before);
  });
  it("缺物业不抹去租金，undefined兼容旧输入，明确零物业合法", () => {
    for (const value of [undefined, "0"])
      expect(
        buildMonthlyFinancialRentAccrual(
          [{ ...lease, monthlyPropertyFee: value }],
          { ...options, component: "property_management" },
        ).every((row) => row.amount === "0"),
      ).toBe(true);
    expect(
      buildMonthlyFinancialRentAccrual(
        [{ ...lease, monthlyPropertyFee: null }],
        { ...options, component: "property_management" },
      ).every((row) => row.amount === null),
    ).toBe(true);
    expect(
      buildMonthlyFinancialRentAccrual(
        [{ ...lease, monthlyPropertyFee: null }],
        options,
      )[0].amount,
    ).toBe("20378");
  });
  it("物业沿用租期、退租和变更守卫，高精度按天不降级", () => {
    for (const invalid of [
      { leaseStartDate: null },
      { status: "terminated", actualEndDate: null },
      { hasUnresolvedChange: true },
    ])
      expect(
        buildMonthlyFinancialRentAccrual([{ ...lease, ...invalid }], {
          ...options,
          component: "property_management",
        })[0].amount,
      ).toBeNull();
    const rows = buildMonthlyFinancialRentAccrual(
      [{ ...lease, monthlyPropertyFee: "0.000000000012" }],
      { ...options, component: "property_management" },
    );
    expect(rows[8].amount).toBe("0.000000000003");
    expect(
      buildMonthlyFinancialRentAccrual([lease], {
        ...options,
        component: "property_management",
        currentMonthMode: "full-month",
      })[8].amount,
    ).toBe("6120");
  });
  it("同编号不同物业版本或混合未提供版本冲突，不能顺序覆盖选择金额", () => {
    for (const monthlyPropertyFee of ["6100", undefined]) {
      const conflicting = [{ ...lease }, { ...lease, monthlyPropertyFee }];
      const first = buildMonthlyFinancialRentAccrual(conflicting, {
        ...options,
        component: "property_management",
      });
      const reversed = buildMonthlyFinancialRentAccrual(
        [...conflicting].reverse(),
        { ...options, component: "property_management" },
      );
      expect(
        first.every((row) => row.amount === null && row.knownAmount === null),
      ).toBe(true);
      expect(reversed.map((row) => row.amount)).toEqual(
        first.map((row) => row.amount),
      );
    }
  });
});
