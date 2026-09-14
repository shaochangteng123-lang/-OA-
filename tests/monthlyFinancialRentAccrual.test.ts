import {
  buildMonthlyFinancialRentAccrual,
  type AnalysisRentAccrualContract,
} from "../server/services/monthlyFinancialRentAccrual";
const contract: AnalysisRentAccrualContract = {
  id: "rent1",
  title: "房屋租赁",
  status: "executing",
  effectiveAt: "2025-06-06",
  leaseStartDate: "2025-06-16",
  leaseEndDate: "2027-06-15",
  monthlyRent: "20378.00",
};
const options = {
  from: "2026-01",
  to: "2026-09",
  asOfDate: "2026-09-07",
  currentMonthMode: "daily" as const,
};
describe("按实际租赁期间发生的月度房租", () => {
  test("完整月份每月独立月租，本月截至当天而非集中在付款月", () => {
    const rows = buildMonthlyFinancialRentAccrual([contract], options);
    expect(rows.slice(0, 8).map((row) => row.amount)).toEqual(
      Array(8).fill("20378"),
    );
    expect(rows[8].amount).toBe("4754.87");
    expect(rows[8].lines[0].to).toBe("2026-09-07");
  });
  test("明确整月策略可计整月但未来月份永远不计发生额", () => {
    const rows = buildMonthlyFinancialRentAccrual([contract], {
      ...options,
      to: "2026-12",
      currentMonthMode: "full-month",
    });
    expect(rows[8].amount).toBe("20378");
    expect(
      rows
        .slice(9)
        .every((row) => row.amount === null && row.knownAmount === null),
    ).toBe(true);
  });
  test("本合同六月中起止的不满月按自然日计提，24个月租期总额闭合", () => {
    const rows = buildMonthlyFinancialRentAccrual([contract], {
      from: "2025-06",
      to: "2027-06",
      asOfDate: "2027-06-30",
      currentMonthMode: "daily",
    });
    expect(rows[0].amount).toBe("10189");
    expect(rows.at(-1)!.amount).toBe("10189");
    expect(rows.reduce((total, row) => total + BigInt(row.amount!), 0n)).toBe(
      20378n * 24n,
    );
  });
  test("缺月租、日期冲突或退租日不明不伪造发生额", () => {
    for (const patch of [
      { monthlyRent: null },
      { leaseStartDate: "不明" },
      { status: "terminated" },
      { hasUnresolvedChange: true },
    ]) {
      const rows = buildMonthlyFinancialRentAccrual(
        [{ ...contract, ...patch }],
        options,
      );
      expect(rows[0].amount).toBeNull();
      expect(rows[0].knownAmount).toBeNull();
    }
  });
  test("只按独立月租，多个房屋租赁可加且同编号重复不重复计", () => {
    const rows = buildMonthlyFinancialRentAccrual(
      [
        contract,
        { ...contract },
        { ...contract, id: "rent2", monthlyRent: "100.01" },
      ],
      options,
    );
    expect(rows[0].amount).toBe("20478.01");
    const conflict = buildMonthlyFinancialRentAccrual(
      [contract, { ...contract, monthlyRent: "30000" }],
      options,
    );
    expect(conflict[0].amount).toBeNull();
  });
  test("续租链重叠不双算，明确退租日期按实际日期停止", () => {
    const rows = buildMonthlyFinancialRentAccrual(
      [contract, { ...contract, id: "renew", previousContractId: "rent1" }],
      options,
    );
    expect(rows[0].amount).toBeNull();
    const end = buildMonthlyFinancialRentAccrual(
      [{ ...contract, status: "terminated", actualEndDate: "2026-01-15" }],
      options,
    );
    expect(end[0].amount).toBe("9860.32");
    expect(end[1].amount).toBe("0");
  });
  test("冲突记录的输入顺序不能把未知租金变成零", () => {
    const future = { ...contract, leaseStartDate: "2027-01-01" };
    for (const records of [
      [future, contract],
      [contract, future],
    ]) {
      expect(
        buildMonthlyFinancialRentAccrual(records, options)[0].amount,
      ).toBeNull();
    }
  });
  test("已明确退租后次日续租不误判重叠，矛盾退租日保持未知", () => {
    const old = {
      ...contract,
      status: "terminated",
      actualEndDate: "2026-01-15",
    };
    const renewed = {
      ...contract,
      id: "renew",
      previousContractId: contract.id,
      leaseStartDate: "2026-01-16",
    };
    const rows = buildMonthlyFinancialRentAccrual([old, renewed], options);
    expect(rows[0].amount).toBe("20378");
    expect(rows[0].warnings).toEqual([]);
    const bad = {
      ...contract,
      leaseStartDate: "2026-01-20",
      actualEndDate: "2026-01-15",
      status: "terminated",
    };
    expect(
      buildMonthlyFinancialRentAccrual([bad], options)[0].amount,
    ).toBeNull();
  });
  test("闰年及高精度租金保持精确小数，未生效合同不计", () => {
    const rows = buildMonthlyFinancialRentAccrual(
      [
        {
          ...contract,
          leaseStartDate: "2024-02-01",
          effectiveAt: "2024-01-01",
          monthlyRent: "0.123456789012",
        },
      ],
      {
        from: "2024-02",
        to: "2024-02",
        asOfDate: "2024-02-29",
        currentMonthMode: "daily",
      },
    );
    expect(rows[0].amount).toBe("0.123456789012");
    expect(
      buildMonthlyFinancialRentAccrual(
        [{ ...contract, status: "draft" }],
        options,
      )[0].amount,
    ).toBe("0");
  });
});
