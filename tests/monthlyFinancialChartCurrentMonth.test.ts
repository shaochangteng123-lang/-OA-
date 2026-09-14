import { nextTick } from "vue";
import Chart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const periods = Array.from({ length: 12 }, (_, index) => {
  const month = "2026-" + String(index + 1).padStart(2, "0");
  return { key: month, label: month, from: month, to: month };
});
const series = [
  { key: "received", label: "已回款", values: periods.map(() => "2053235.4") },
  {
    key: "periodReceived",
    label: "本月回款",
    values: periods.map(() => "0.100000000001"),
  },
];
function render(props: Record<string, unknown> = {}) {
  return mount(Chart, {
    props: {
      type: "line",
      title: "项目分析",
      periods,
      series,
      fixedMonthWindow: true,
      continuousHistory: true,
      windowEnd: "2026-12",
      minMonth: "2025-01",
      maxMonth: "2026-12",
      ...props,
    },
  });
}
async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

describe("折线图标题工具栏回到本月入口", () => {
  it("默认不显示快捷按钮，原多指标比较仍是第一个按钮", async () => {
    const wrapper = render();
    await settle();
    expect(wrapper.find(".chart-current-month").exists()).toBe(false);
    expect(wrapper.get(".metric-controls button").text()).toBe("多指标比较");
    expect(wrapper.get(".metric-controls").findAll("button")).toHaveLength(1);
    expect(wrapper.emitted("current-month")).toBeUndefined();
    wrapper.unmount();
  });

  it("启用后紧邻多指标按钮右侧，同属不可拆分按钮组", async () => {
    const wrapper = render({ showCurrentMonthShortcut: true });
    await settle();
    const group = wrapper.get(".metric-button-group");
    expect(group.findAll("button").map((button) => button.text())).toEqual([
      "多指标比较",
      "回到本月",
    ]);
    const current = wrapper.get(".chart-current-month");
    expect(group.findAll("button")[0].element.nextElementSibling).toBe(
      current.element,
    );
    expect(current.element.parentElement).toBe(group.element);
    expect(current.attributes("type")).toBe("button");
    expect(current.attributes("title")).toBe(
      "恢复截至本月的近12个月，切回月度并立即查询",
    );
    expect(current.attributes("disabled")).toBeUndefined();
    expect(wrapper.get(".metric-controls button").text()).toBe("多指标比较");
    wrapper.unmount();
  });

  it("只有一项或暂无指标仍能显示快捷入口，但不凭空出现多指标按钮", async () => {
    const wrapper = render({
      series: [series[0]],
      showCurrentMonthShortcut: true,
    });
    await settle();
    expect(wrapper.get(".metric-controls").findAll("button")).toHaveLength(1);
    expect(wrapper.get(".metric-controls button").text()).toBe("回到本月");
    expect(wrapper.find('[aria-label="选择折线指标"]').exists()).toBe(false);
    await wrapper.setProps({ series: [] });
    expect(wrapper.get(".metric-controls").findAll("button")).toHaveLength(1);
    expect(wrapper.find(".metric-checklist").exists()).toBe(false);
    wrapper.unmount();
  });

  it("柱图和结构图即使传入开关也不显示折线快捷入口", async () => {
    for (const type of ["bar", "donut"] as const) {
      const wrapper = render({ type, showCurrentMonthShortcut: true });
      await settle();
      expect(wrapper.find(".chart-current-month").exists()).toBe(false);
      expect(wrapper.find(".metric-controls").exists()).toBe(false);
      expect(wrapper.emitted("current-month")).toBeUndefined();
      wrapper.unmount();
    }
  });

  it("点击只发无参数事件，不改原指标、范围、系列引用或精确金额", async () => {
    const wrapper = render({ showCurrentMonthShortcut: true });
    await settle();
    const before = {
      period: wrapper.get(".visible-window-range").text(),
      metric: (
        wrapper.get('[aria-label="选择折线指标"]').element as HTMLSelectElement
      ).value,
      values: wrapper
        .findAll(".amount-label-value")
        .map((label) => label.text()),
      series: wrapper.props("series"),
      periods: wrapper.props("periods"),
      metricEvents: wrapper.emitted("metric-change")?.length || 0,
    };
    await wrapper.get(".chart-current-month").trigger("click");
    await settle();
    expect(wrapper.emitted("current-month")).toEqual([[]]);
    expect(wrapper.emitted("window-change")).toBeUndefined();
    expect(wrapper.emitted("metric-change")?.length || 0).toBe(
      before.metricEvents,
    );
    expect(wrapper.get(".visible-window-range").text()).toBe(before.period);
    expect(
      (wrapper.get('[aria-label="选择折线指标"]').element as HTMLSelectElement)
        .value,
    ).toBe(before.metric);
    expect(
      wrapper.findAll(".amount-label-value").map((label) => label.text()),
    ).toEqual(before.values);
    expect(wrapper.props("series")).toBe(before.series);
    expect(wrapper.props("periods")).toBe(before.periods);
    expect(before.values).toContain("¥2,053,235.40");
    wrapper.unmount();
  });

  it("禁用时不发事件，解除禁用后才能回到本月", async () => {
    const wrapper = render({
      showCurrentMonthShortcut: true,
      currentMonthDisabled: true,
    });
    expect(
      wrapper.get(".chart-current-month").attributes("disabled"),
    ).toBeDefined();
    await wrapper.get(".chart-current-month").trigger("click");
    expect(wrapper.emitted("current-month")).toBeUndefined();
    await wrapper.setProps({ currentMonthDisabled: false });
    expect(wrapper.emitted("current-month")).toBeUndefined();
    await wrapper.get(".chart-current-month").trigger("click");
    expect(wrapper.emitted("current-month")).toEqual([[]]);
    wrapper.unmount();
  });

  it("进入多指标后快捷入口仍在返回单指标右侧，点击不自行退出多指标", async () => {
    const wrapper = render({ showCurrentMonthShortcut: true });
    await settle();
    await wrapper.get(".metric-controls button").trigger("click");
    await settle();
    expect(
      wrapper
        .get(".metric-button-group")
        .findAll("button")
        .map((button) => button.text()),
    ).toEqual(["返回单指标", "回到本月"]);
    expect(wrapper.find(".metric-checklist").exists()).toBe(true);
    const count = wrapper.findAll(".analysis-line-series").length;
    await wrapper.get(".chart-current-month").trigger("click");
    expect(wrapper.emitted("current-month")).toEqual([[]]);
    expect(wrapper.get(".metric-controls button").text()).toBe("返回单指标");
    expect(wrapper.findAll(".analysis-line-series")).toHaveLength(count);
    expect(wrapper.find(".metric-checklist").exists()).toBe(true);
    wrapper.unmount();
  });
});
