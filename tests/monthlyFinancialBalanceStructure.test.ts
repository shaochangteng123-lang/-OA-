import MonthlyFinancialBalanceStructure from "@/components/monthly-financial/MonthlyFinancialBalanceStructure.vue";
import type { FinancialAnalysisValue } from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

function accounts(amounts: Array<string | null>): FinancialAnalysisValue[] {
  return [
    { key: "general", label: "一般账户" },
    { key: "business", label: "商务账户" },
    { key: "welfare_one", label: "福利金账户一" },
    { key: "welfare_two", label: "福利金账户二" },
  ].map((account, index) => ({ ...account, amount: amounts[index] ?? null }));
}
function percentages(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll(".balance-account-percentage")
    .map((cell) => cell.text());
}

describe("余额专用结构图与精确中心总金额", () => {
  it("中心展示传入总金额，四账户依次显示金额及基于四账户合计的两位占比", () => {
    const wrapper = mount(MonthlyFinancialBalanceStructure, {
      props: {
        title: "四账户余额结构",
        scopeLabel: "2026-09期末",
        items: accounts(["100", "200", "0", "100"]),
        total: "400",
      },
    });
    expect(wrapper.get(".balance-total-label").text()).toBe("总金额");
    expect(wrapper.get(".balance-total-amount").text()).toBe("¥400.00");
    expect(wrapper.get(".balance-structure-scope").text()).toBe("2026-09期末");
    expect(
      wrapper.findAll(".balance-account-name").map((cell) => cell.text()),
    ).toEqual(["一般账户", "商务账户", "福利金账户一", "福利金账户二"]);
    expect(
      wrapper.findAll(".balance-account-amount").map((cell) => cell.text()),
    ).toEqual(["¥100.00", "¥200.00", "¥0.00", "¥100.00"]);
    expect(percentages(wrapper)).toEqual([
      "25.00%",
      "50.00%",
      "0.00%",
      "25.00%",
    ]);
    expect(wrapper.findAll(".balance-ring-slice")).toHaveLength(3);
    expect(wrapper.find(".balance-structure-warning").exists()).toBe(false);
    expect(wrapper.get(".balance-ring").attributes("aria-label")).toContain(
      "四账户完整金额占比",
    );
    wrapper.unmount();
  });

  it("十进制精确合计不会因零点一加零点二误报不一致，十二位小数原样显示", () => {
    const wrapper = mount(MonthlyFinancialBalanceStructure, {
      props: {
        title: "精准占比",
        scopeLabel: "所选期末",
        items: accounts(["0.1", "0.2", "0.000000000001", "0"]),
        total: "0.300000000001",
      },
    });
    expect(wrapper.get(".balance-total-amount").text()).toBe("¥0.300000000001");
    expect(
      wrapper
        .get(
          '.balance-account-list [data-account="welfare_one"] .balance-account-amount',
        )
        .text(),
    ).toBe("¥0.000000000001");
    expect(percentages(wrapper)).toEqual([
      "33.33%",
      "66.67%",
      "0.00%",
      "0.00%",
    ]);
    expect(wrapper.find(".balance-structure-warning").exists()).toBe(false);
    wrapper.unmount();
  });

  it("超长中心金额与账户金额完整保留，不缩略为万或省略号", () => {
    const amount = "999999999999999999.123456789012";
    const wrapper = mount(MonthlyFinancialBalanceStructure, {
      props: {
        title: "大额余额",
        scopeLabel: "历史截止时点",
        items: accounts([amount, "0", "0", "0"]),
        total: amount,
        totalLabel: "四账户总金额",
        note: "金额均为原始精确值。",
      },
    });
    const text = "¥999,999,999,999,999,999.123456789012";
    expect(wrapper.get(".balance-total-amount").text()).toBe(text);
    expect(
      wrapper
        .get(
          '.balance-account-list [data-account="general"] .balance-account-amount',
        )
        .text(),
    ).toBe(text);
    expect(wrapper.get(".balance-ring-center").attributes("aria-label")).toBe(
      "四账户总金额：" + text,
    );
    expect(wrapper.get(".balance-total-amount").text()).not.toMatch(/[万亿…]/u);
    expect(wrapper.get(".balance-total-label").text()).toBe("四账户总金额");
    expect(wrapper.get(".balance-structure-note").text()).toBe(
      "金额均为原始精确值。",
    );
    expect(percentages(wrapper)).toEqual([
      "100.00%",
      "0.00%",
      "0.00%",
      "0.00%",
    ]);
    wrapper.unmount();
  });

  it("负数与未知不伪造完整占比，仅已知正金额绘图且未知中心不由局部金额替代", () => {
    const wrapper = mount(MonthlyFinancialBalanceStructure, {
      props: {
        title: "部分已知余额",
        scopeLabel: "待核算月份",
        items: accounts(["100.4", "-50.123456789012", null, "0"]),
        total: null,
      },
    });
    expect(wrapper.get(".balance-total-amount").text()).toBe("未知");
    expect(wrapper.get(".balance-structure-warning").text()).toContain(
      "仅已知正金额占比",
    );
    expect(wrapper.get(".balance-structure-warning").text()).toContain(
      "不代表净额或完整总额",
    );
    expect(wrapper.findAll(".balance-ring-slice")).toHaveLength(1);
    expect(percentages(wrapper)).toEqual(["100.00%", "—", "—", "0.00%"]);
    expect(
      wrapper
        .get(
          '.balance-account-list [data-account="business"] .balance-account-amount',
        )
        .text(),
    ).toBe("¥-50.123456789012");
    expect(
      wrapper
        .get(
          '.balance-account-list [data-account="welfare_one"] .balance-account-amount',
        )
        .text(),
    ).toBe("未知");
    expect(
      wrapper
        .get('.balance-ring-slice[data-account="general"]')
        .attributes("aria-label"),
    ).toContain("¥100.40");
    wrapper.unmount();
  });

  it("存在负余额时正金额比例不以净额为分母，中心仍显示原始净总额", () => {
    const wrapper = mount(MonthlyFinancialBalanceStructure, {
      props: {
        title: "含负余额结构",
        scopeLabel: "2026-09期末",
        items: accounts(["100", "300", "-50", "0"]),
        total: "350",
      },
    });
    expect(wrapper.get(".balance-total-amount").text()).toBe("¥350.00");
    expect(percentages(wrapper)).toEqual(["25.00%", "75.00%", "—", "0.00%"]);
    expect(wrapper.get(".balance-structure-warning").text()).toContain(
      "不代表净额",
    );
    wrapper.unmount();
  });

  it("四账户全零时显示中性环与零总额，每个账户明确展示零和零占比", () => {
    const wrapper = mount(MonthlyFinancialBalanceStructure, {
      props: {
        title: "零余额",
        scopeLabel: "零金额期末",
        items: accounts(["0", "0.0", "0.000", "-0.00"]),
        total: "0.000",
      },
    });
    expect(wrapper.get(".balance-ring").classes()).toContain("is-neutral");
    expect(wrapper.findAll(".balance-ring-slice")).toHaveLength(0);
    expect(wrapper.get(".balance-total-amount").text()).toBe("¥0.00");
    expect(
      wrapper
        .findAll(".balance-account-amount")
        .every((cell) => cell.text() === "¥0.00"),
    ).toBe(true);
    expect(percentages(wrapper)).toEqual(["0.00%", "0.00%", "0.00%", "0.00%"]);
    expect(wrapper.get(".balance-structure-empty").text()).toContain(
      "四个账户金额均为零",
    );
    wrapper.unmount();
  });

  it("所有账户未知时显示中性环及未知，不变成四个零", () => {
    const wrapper = mount(MonthlyFinancialBalanceStructure, {
      props: {
        title: "未核算余额",
        scopeLabel: "来源未取得",
        items: accounts([null, null, null, null]),
        total: null,
      },
    });
    expect(wrapper.get(".balance-ring").classes()).toContain("is-neutral");
    expect(wrapper.findAll(".balance-ring-slice")).toHaveLength(0);
    expect(wrapper.get(".balance-total-amount").text()).toBe("未知");
    expect(
      wrapper
        .findAll(".balance-account-amount")
        .every((cell) => cell.text() === "未知"),
    ).toBe(true);
    expect(percentages(wrapper)).toEqual(["—", "—", "—", "—"]);
    expect(wrapper.get(".balance-structure-empty").text()).toContain(
      "四个账户金额均未知",
    );
    wrapper.unmount();
  });

  it("总金额未取得时不从已知账户金额自行回填中心，也不声称完整结构", () => {
    const wrapper = mount(MonthlyFinancialBalanceStructure, {
      props: {
        title: "仅明细已知",
        scopeLabel: "待核算",
        items: accounts(["100", "200", "0", "0"]),
        total: null,
      },
    });
    expect(wrapper.get(".balance-total-amount").text()).toBe("未知");
    expect(wrapper.get(".balance-structure-warning").text()).toContain(
      "仅已知正金额占比",
    );
    expect(percentages(wrapper)).toEqual([
      "33.33%",
      "66.67%",
      "0.00%",
      "0.00%",
    ]);
    wrapper.unmount();
  });

  it("传入总额不闭合时保留原值并提示核对，不用浮点重新算一个总金额", () => {
    const items = accounts(["100", "200", "0", "0"]);
    const before = JSON.stringify(items);
    const wrapper = mount(MonthlyFinancialBalanceStructure, {
      props: {
        title: "待核对结构",
        scopeLabel: "明细与汇总待核对",
        items,
        total: "999",
      },
    });
    expect(wrapper.get(".balance-total-amount").text()).toBe("¥999.00");
    expect(wrapper.get(".balance-structure-warning").text()).toContain(
      "传入总金额与四账户明细合计不一致",
    );
    expect(wrapper.get(".balance-ring").attributes("aria-label")).not.toContain(
      "完整金额占比",
    );
    expect(JSON.stringify(items)).toBe(before);
    wrapper.unmount();
  });

  it("缺少账户条目时保留四个位置，缺项保持未知且不伪造占比", () => {
    const wrapper = mount(MonthlyFinancialBalanceStructure, {
      props: {
        title: "缺少账户",
        scopeLabel: "资料不完整",
        items: accounts(["10"]).slice(0, 1),
        total: null,
      },
    });
    expect(wrapper.findAll(".balance-account-list li")).toHaveLength(4);
    expect(
      wrapper.findAll(".balance-account-amount").map((cell) => cell.text()),
    ).toEqual(["¥10.00", "未知", "未知", "未知"]);
    expect(percentages(wrapper)).toEqual(["100.00%", "—", "—", "—"]);
    expect(wrapper.get(".balance-total-amount").text()).toBe("未知");
    wrapper.unmount();
  });
});
