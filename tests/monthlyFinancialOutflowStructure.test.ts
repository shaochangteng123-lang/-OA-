import MonthlyFinancialOutflowStructure from "@/components/monthly-financial/MonthlyFinancialOutflowStructure.vue";
import type { FinancialAnalysisValue } from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
function items(amounts: Array<string | null>): FinancialAnalysisValue[] {
  return [
    "行政支出",
    "薪资支出",
    "其他支出",
    "实际税费支出",
    "业务支出",
    "资产类合同支出",
  ].map((label, index) => ({
    key: ["administration", "salary", "other", "tax", "business", "asset"][
      index
    ],
    label,
    amount: amounts[index] ?? null,
  }));
}
function render(
  amounts: Array<string | null>,
  total: string | null,
  extraProps: Partial<{
    totalLabel: string;
  }> = {},
) {
  return mount(MonthlyFinancialOutflowStructure, {
    props: {
      title: "本月支出构成",
      scopeLabel: "2026年09月",
      items: items(amounts),
      total,
      ...extraProps,
    },
  });
}

describe("支出分类结构及权威中心总额", () => {
  it("六分类真实金额与两位占比，零分类保留零而不画扇形", () => {
    const wrapper = render(["100", "200", "0", "50", "25", "25"], "400");
    expect(wrapper.get(".outflow-total-label").text()).toBe("总支出");
    expect(wrapper.get(".outflow-total-amount").text()).toBe("¥400.00");
    expect(wrapper.findAll(".outflow-category-list li")).toHaveLength(6);
    expect(
      wrapper
        .findAll(".outflow-category-percentage")
        .map((item) => item.text()),
    ).toEqual(["25.00%", "50.00%", "0.00%", "12.50%", "6.25%", "6.25%"]);
    expect(wrapper.findAll(".outflow-ring-slice")).toHaveLength(5);
    expect(wrapper.find(".outflow-structure-warning").exists()).toBe(false);
    wrapper.unmount();
  });

  it("权威总额已知但分类未知时不改中心，只说明已知正分类比例", () => {
    const wrapper = render(["100", "300", "0", null, "-50", "0"], "2053235.4");
    expect(wrapper.get(".outflow-total-amount").text()).toBe("¥2,053,235.40");
    expect(wrapper.get(".outflow-structure-warning").text()).toContain(
      "占比仅使用已知正分类",
    );
    expect(
      wrapper
        .findAll(".outflow-category-percentage")
        .map((item) => item.text()),
    ).toEqual(["25.00%", "75.00%", "0.00%", "—", "—", "0.00%"]);
    expect(
      wrapper.get('[data-category="business"] .outflow-category-amount').text(),
    ).toBe("¥-50.00");
    expect(wrapper.findAll(".outflow-ring-slice")).toHaveLength(2);
    wrapper.unmount();
  });

  it("圆心为已知分类总金额时不误称完整分类占比", () => {
    const wrapper = render(["100", "200", "0", "0", "0", "0"], "300", {
      totalLabel: "已知分类总金额",
    });
    expect(wrapper.get(".outflow-structure-warning").text()).toContain(
      "占比仅使用已知正分类",
    );
    expect(wrapper.get(".outflow-ring").attributes("aria-label")).toContain(
      "仅已知正分类占比",
    );
    expect(wrapper.get(".outflow-ring").attributes("aria-label")).toContain(
      "已知分类总金额：¥300.00",
    );
    wrapper.unmount();
  });

  it("中心未知不能由完整分类猜测代替，分类不一致明确提示", async () => {
    const wrapper = render(["1", "2", "0", "0", "0", "0"], null);
    expect(wrapper.get(".outflow-total-amount").text()).toBe("未知");
    await wrapper.setProps({ total: "9" });
    expect(wrapper.get(".outflow-total-amount").text()).toBe("¥9.00");
    expect(wrapper.get(".outflow-structure-warning").text()).toContain(
      "分类已知金额与圆心金额不一致",
    );
    wrapper.unmount();
  });

  it("全零分类显示中性环、真实零金额及0.00百分比", () => {
    const wrapper = render(["0", "0.0", "-0.00", "0", "0", "0"], "0");
    expect(wrapper.get(".outflow-ring").classes()).toContain("is-neutral");
    expect(wrapper.findAll(".outflow-ring-slice")).toHaveLength(0);
    expect(
      wrapper
        .findAll(".outflow-category-amount")
        .every((item) => item.text() === "¥0.00"),
    ).toBe(true);
    expect(
      wrapper
        .findAll(".outflow-category-percentage")
        .every((item) => item.text() === "0.00%"),
    ).toBe(true);
    expect(wrapper.get(".outflow-structure-empty").text()).toContain("均为零");
    wrapper.unmount();
  });

  it("全未知分类显示中性环，不伪造六个零或覆盖已知总额", () => {
    const wrapper = render([null, null, null, null, null, null], "10");
    expect(wrapper.get(".outflow-ring").classes()).toContain("is-neutral");
    expect(
      wrapper
        .findAll(".outflow-category-amount")
        .every((item) => item.text() === "未知"),
    ).toBe(true);
    expect(
      wrapper
        .findAll(".outflow-category-percentage")
        .every((item) => item.text() === "—"),
    ).toBe(true);
    expect(wrapper.get(".outflow-total-amount").text()).toBe("¥10.00");
    wrapper.unmount();
  });

  it("十八位整数与十二位小数完整保留，精确小数合计不误报", async () => {
    const amount = "123456789012345678.123456789012";
    const wrapper = render([amount, "0", "0", "0", "0", "0"], amount);
    expect(wrapper.get(".outflow-total-amount").text()).toBe(
      "¥123,456,789,012,345,678.123456789012",
    );
    expect(
      wrapper
        .get(
          '.outflow-category-list [data-category="administration"] .outflow-category-amount',
        )
        .text(),
    ).toBe("¥123,456,789,012,345,678.123456789012");
    await wrapper.setProps({
      items: items(["0.1", "0.2", "0", "0", "0", "0"]),
      total: "0.3",
    });
    expect(wrapper.find(".outflow-structure-warning").exists()).toBe(false);
    expect(wrapper.get(".outflow-total-amount").text()).toBe("¥0.30");
    wrapper.unmount();
  });

  it("不把总额当额外分类，长中文分类与说明完整保留", () => {
    const categories = items(["1", "0", "0", "0", "0", "0"]);
    categories[0].label = "合成特别长的行政支出分类名称用于窄屏换行验证";
    categories.push({ key: "total", label: "不应重复的总额", amount: "1" });
    const wrapper = mount(MonthlyFinancialOutflowStructure, {
      props: {
        title: "季度构成",
        scopeLabel: "2026年第1季度",
        items: categories,
        total: "1",
        note: "合成测试数据，不是真实财务数据",
      },
    });
    expect(wrapper.findAll(".outflow-category-list li")).toHaveLength(6);
    expect(wrapper.get(".outflow-category-name").text()).toBe(
      categories[0].label,
    );
    expect(wrapper.get(".outflow-structure-note").text()).toContain(
      "合成测试数据",
    );
    wrapper.unmount();
  });
});
