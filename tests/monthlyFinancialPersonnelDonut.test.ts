import Chart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import type { FinancialAnalysisValue } from "@/types/monthlyFinancialAnalysis";
const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
const props = (items: FinancialAnalysisValue[]) => ({
  type: "donut" as const,
  title: "所选人员成本结构",
  structureMode: "known-positive" as const,
  costStructure: true,
  items,
});
describe("人力成本占比的零值与待确认费用", () => {
  test("所有已知正成本都进入扇区，真实零在同一图例展示0.00%", () => {
    const wrapper = mount(Chart, {
      props: props([
        { key: "salary", label: "薪资", amount: "90000" },
        { key: "basic", label: "基础报销", amount: "1751.14" },
        { key: "overhead", label: "房租分摊", amount: "6805.21" },
        { key: "adjustment", label: "实际调整", amount: "0" },
      ]),
    });
    expect(wrapper.findAll(".donut-slice")).toHaveLength(3);
    expect(wrapper.find(".breakdown-legend").text()).toContain(
      "实际调整¥0.000.00%",
    );
    expect(wrapper.find(".excluded-structure").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("未参与占比的金额");
    expect(wrapper.text()).toContain("¥1,751.14");
    expect(wrapper.text()).toContain("¥6,805.21");
    wrapper.unmount();
  });
  test("缺失金额仍待确认，不能为了图表完整而伪造零或隐藏", () => {
    const wrapper = mount(Chart, {
      props: props([
        { key: "salary", label: "薪资", amount: "100" },
        { key: "large", label: "大额报销", amount: null },
        { key: "adjustment", label: "调整", amount: "0" },
      ]),
    });
    expect(wrapper.find(".excluded-structure h5").text()).toBe("待确认费用");
    expect(wrapper.find(".excluded-structure").text()).toContain(
      "大额报销未知／未核算",
    );
    expect(wrapper.find(".excluded-structure").text()).not.toContain("调整");
    expect(wrapper.findAll(".donut-slice")).toHaveLength(1);
    wrapper.unmount();
  });
  test("全零保留金额与0.00%标识但不伪造圆环面积", () => {
    const wrapper = mount(Chart, {
      props: props([
        { key: "basic", label: "基础报销", amount: "0" },
        { key: "overhead", label: "房租分摊", amount: "0.00" },
      ]),
    });
    expect(wrapper.findAll(".donut-slice")).toHaveLength(0);
    expect(wrapper.find(".empty-structure").exists()).toBe(true);
    expect(wrapper.findAll(".zero-cost-legend li")).toHaveLength(2);
    expect(wrapper.find(".zero-cost-legend").text()).toContain(
      "房租分摊¥0.000.00%",
    );
    expect(wrapper.text()).not.toContain("未参与占比");
    wrapper.unmount();
  });
  test("负调整保留真实负号而不按绝对值画正成本，其他模块维持原规则", () => {
    const items = [
      { key: "salary", label: "薪资", amount: "100" },
      { key: "adjustment", label: "调整", amount: "-5" },
    ];
    const wrapper = mount(Chart, { props: props(items) });
    expect(wrapper.find(".excluded-structure h5").text()).toBe("成本冲减说明");
    expect(wrapper.find(".excluded-structure").text()).toContain("¥-5.00");
    expect(wrapper.findAll(".donut-slice")).toHaveLength(1);
    wrapper.unmount();
    const original = mount(Chart, {
      props: { ...props(items), costStructure: false },
    });
    expect(original.text()).toContain("未参与占比的金额");
    original.unmount();
  });
});
