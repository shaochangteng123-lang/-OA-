import { nextTick } from "vue";
import MonthlyFinancialBusinessDetails from "@/components/monthly-financial/MonthlyFinancialBusinessDetails.vue";
import type { FinancialAnalysisDetail } from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
const columns = [
  { key: "region", label: "行政区", format: "text" as const },
  { key: "scope", label: "报销范围／区域", format: "text" as const },
  { key: "amount", label: "金额", format: "amount" as const },
  { key: "regionSource", label: "归属说明", format: "text" as const },
];
describe("商务明细行政区分组", () => {
  it("使用来源行政区分组，不把同名末级范围合并为一个区域，金额精确且未知单列", () => {
    const rows: FinancialAnalysisDetail[] = [
      {
        id: "a",
        region: "海淀区",
        scope: "海淀区 / GJDW",
        amount: "0.1",
        regionSource: "原单范围配置",
      },
      {
        id: "b",
        region: "海淀区",
        scope: "海淀区 / GJDW",
        amount: "0.2",
        regionSource: "原单范围配置",
      },
      {
        id: "c",
        region: "朝阳区",
        scope: "朝阳区 / GJDW",
        amount: "1.123456789012",
        regionSource: "原单范围配置",
      },
      {
        id: "d",
        region: null,
        scope: "历史范围",
        amount: "2",
        regionSource: "旧快照未冻结行政区",
      },
      {
        id: "e",
        region: "公司内部",
        scope: "公司内部",
        amount: "0",
        regionSource: "配置根级范围",
      },
    ];
    const before = JSON.stringify(rows);
    const wrapper = mount(MonthlyFinancialBusinessDetails, {
      props: { rows, columns },
    });
    expect(wrapper.findAll(".business-region-group")).toHaveLength(4);
    expect(wrapper.get('[data-region="海淀区"] summary').text()).toContain(
      "¥0.30",
    );
    expect(wrapper.get('[data-region="朝阳区"]').text()).toContain(
      "¥1.123456789012",
    );
    expect(wrapper.get('[data-region="行政区未知"]').text()).toContain(
      "旧快照未冻结行政区",
    );
    expect(wrapper.get('[data-region="公司内部"]').text()).toContain("¥0.00");
    expect(JSON.stringify(rows)).toBe(before);
    wrapper.unmount();
  });
  it("含未知金额的小计保持未知，分页只改变显示不改变区域全部明细小计", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: String(index),
      region: "海淀区",
      scope: "海淀区 / 范围",
      amount: index === 0 ? null : "0.1",
    }));
    const wrapper = mount(MonthlyFinancialBusinessDetails, {
      props: { rows, columns },
    });
    expect(wrapper.get("summary").text()).toContain("未知");
    expect(wrapper.findAll("tbody tr")).toHaveLength(50);
    await wrapper.findAll(".region-pagination button")[1].trigger("click");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    await wrapper.setProps({ rows: rows.slice(1) });
    await nextTick();
    expect(wrapper.get("summary").text()).toContain("¥5.00");
    expect(wrapper.findAll("tbody tr")).toHaveLength(50);
    wrapper.unmount();
  });
});
