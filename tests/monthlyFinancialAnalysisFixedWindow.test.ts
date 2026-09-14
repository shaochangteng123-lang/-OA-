import { nextTick } from "vue";
import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisPeriod,
  FinancialAnalysisSeries,
} from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

function months(from: string, count = 12): FinancialAnalysisPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const month = financialMonthOffset(from, index);
    return { key: month, label: month, from: month, to: month };
  });
}
function series(
  key: string,
  values: Array<string | null>,
  label = "金额",
): FinancialAnalysisSeries {
  return { key, label, values };
}
const fixedProps = {
  title: "连续月度趋势",
  type: "line" as const,
  fixedMonthWindow: true,
  windowEnd: "2026-09",
  minMonth: "2024-01",
  maxMonth: "2026-09",
  periods: months("2025-10"),
};
async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
async function measure(wrapper: ReturnType<typeof mount>, width: number) {
  Object.defineProperty(wrapper.get(".line-scroll").element, "clientWidth", {
    configurable: true,
    value: width,
  });
  await settle();
}
function pointer(type: string, x: number, id = 7) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: 100, button: 0 });
  return event;
}
function amounts(wrapper: ReturnType<typeof mount>, source = "current") {
  return wrapper
    .findAll(
      '.chart-value-label[data-series="' + source + '"] .amount-label-value',
    )
    .map((label) =>
      label
        .findAll("tspan")
        .map((line) => line.text())
        .join(""),
    );
}
function expectLabelsFit(wrapper: ReturnType<typeof mount>) {
  const canvas = wrapper
    .get(".line-svg")
    .attributes("viewBox")
    .split(" ")
    .map(Number);
  const boxes = wrapper.findAll(".amount-label-background").map((box) => ({
    x: Number(box.attributes("x")),
    y: Number(box.attributes("y")),
    width: Number(box.attributes("width")),
    height: Number(box.attributes("height")),
  }));
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas[2]);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas[3]);
    for (let other = index + 1; other < boxes.length; other += 1) {
      const next = boxes[other];
      const overlap =
        box.x < next.x + next.width &&
        box.x + box.width > next.x &&
        box.y < next.y + next.height &&
        box.y + box.height > next.y;
      expect({ index, other, overlap }).toEqual({
        index,
        other,
        overlap: false,
      });
    }
  }
}

describe("固定连续十二个月财务图表", () => {
  it("月度占位变为真实数据时自动选择非零合计，人工选择零指标后保持不变", async () => {
    const empty = Array.from({ length: 12 }, () => null);
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...fixedProps,
        series: [
          series("administration", empty, "行政支出"),
          series("salary", empty, "薪资支出"),
          series("total", empty, "总支出"),
        ],
      },
    });
    await measure(wrapper, 1000);
    expect(wrapper.get(".analysis-line-series").attributes("data-metric")).toBe(
      "administration",
    );
    const filled = [
      series(
        "administration",
        Array.from({ length: 12 }, () => "0"),
        "行政支出",
      ),
      series(
        "salary",
        Array.from({ length: 12 }, () => "1000"),
        "薪资支出",
      ),
      series(
        "total",
        Array.from({ length: 12 }, () => "1200"),
        "总支出",
      ),
    ];
    await wrapper.setProps({ series: filled });
    expect(wrapper.get(".analysis-line-series").attributes("data-metric")).toBe(
      "total",
    );
    await wrapper.get('[aria-label="选择折线指标"]').setValue("administration");
    await wrapper.setProps({
      series: filled.map((metric) => ({
        ...metric,
        values: [...metric.values],
      })),
    });
    expect(wrapper.get(".analysis-line-series").attributes("data-metric")).toBe(
      "administration",
    );
    expect(amounts(wrapper).every((amount) => amount === "¥0.00")).toBe(true);
    wrapper.unmount();
  });

  it("固定窗口两期全部为零时保留二十四个金额标签和两套真实连续线段", async () => {
    const zeros = Array.from({ length: 12 }, () => "0");
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...fixedProps,
        series: [series("amount", zeros)],
        comparisonSeries: [series("amount", zeros)],
        comparisonPeriods: months("2024-10"),
      },
    });
    await measure(wrapper, 1100);
    expect(wrapper.findAll(".chart-month-slot")).toHaveLength(12);
    expect(wrapper.findAll(".analysis-line-point")).toHaveLength(24);
    expect(wrapper.findAll(".analysis-line-edge")).toHaveLength(22);
    expect(amounts(wrapper)).toHaveLength(12);
    expect(amounts(wrapper, "comparison")).toHaveLength(12);
    expect(
      [...amounts(wrapper), ...amounts(wrapper, "comparison")].every(
        (amount) => amount === "¥0.00",
      ),
    ).toBe(true);
    const zeroY = Number(wrapper.get(".chart-grid.is-zero").attributes("y1"));
    expect(
      wrapper
        .findAll(".analysis-line-point")
        .every((point) => Number(point.attributes("data-point-y")) === zeroY),
    ).toBe(true);
    expectLabelsFit(wrapper);
    wrapper.unmount();
  });

  it("项目已回款、未回款和本月回款的已知零月份均连续绘制，不产生视觉断链", async () => {
    const zeros = Array.from({ length: 12 }, () => "0");
    const monthlyReceipts = [...zeros];
    monthlyReceipts[10] = "236000";
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...fixedProps,
        series: [
          series(
            "contract",
            Array.from({ length: 12 }, () => "1000000"),
            "合同金额",
          ),
          series("received", zeros, "已回款"),
          series("outstanding", zeros, "未回款"),
          series("periodReceived", monthlyReceipts, "本月回款"),
        ],
      },
    });
    await measure(wrapper, 1180);

    for (const metric of ["received", "outstanding", "periodReceived"]) {
      await wrapper.get('[aria-label="选择折线指标"]').setValue(metric);
      await settle();
      const line = wrapper.get(
        `.analysis-line-series[data-series="current"][data-metric="${metric}"]`,
      );
      expect(line.findAll(".analysis-line-point")).toHaveLength(12);
      expect(line.findAll(".analysis-line-edge")).toHaveLength(11);
    }
    expect(amounts(wrapper)).toContain("¥236,000.00");
    expect(amounts(wrapper)).toContain("¥0.00");
    wrapper.unmount();
  });

  it("测量真实可用宽度并铺满，始终提供十二个月槽位，零值连线且未知断开", async () => {
    const values: Array<string | null> = Array.from(
      { length: 12 },
      () => "100",
    );
    values[3] = "0";
    values[4] = null;
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: { ...fixedProps, series: [series("amount", values)] },
    });
    await measure(wrapper, 1180);
    const canvas = wrapper
      .get(".line-svg")
      .attributes("viewBox")
      .split(" ")
      .map(Number);
    expect(canvas[2]).toBe(1180);
    expect(canvas[3]).toBeGreaterThanOrEqual(460);
    expect(
      Number.parseFloat(wrapper.get(".line-svg").element.style.minWidth),
    ).toBe(0);
    const slots = wrapper.findAll(".chart-month-slot");
    expect(slots).toHaveLength(12);
    expect(slots.map((slot) => slot.attributes("data-month"))).toEqual(
      months("2025-10").map((month) => month.from),
    );
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2025-10 至 2026-09",
    );
    expect(wrapper.findAll(".analysis-line-point")).toHaveLength(11);
    expect(wrapper.findAll(".analysis-line-edge")).toHaveLength(9);
    expect(
      wrapper
        .find(
          '.analysis-line-edge[data-from-month="2025-12"][data-to-month="2026-01"]',
        )
        .exists(),
    ).toBe(true);
    expect(
      wrapper
        .find(
          '.analysis-line-edge[data-from-month="2026-01"][data-to-month="2026-02"]',
        )
        .exists(),
    ).toBe(false);
    expect(amounts(wrapper)).toContain("¥0.00");
    const zero = wrapper.get('.analysis-line-point[data-month="2026-01"]');
    expect(Number(zero.attributes("data-point-y"))).toBe(
      Number(wrapper.get(".chart-grid.is-zero").attributes("y1")),
    );
    expect(
      wrapper.get('.chart-month-slot[data-month="2026-02"]').text(),
    ).toContain("未知");
    expect(
      Number(
        wrapper
          .get('.analysis-line-point[data-month="2026-09"]')
          .attributes("data-point-x"),
      ),
    ).toBeGreaterThan(1080);
    expectLabelsFit(wrapper);
    wrapper.unmount();
  });

  it("滚轮和左右键逐月滑动，首尾边界固定且不会越过最早起始月或最晚结束月", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...fixedProps,
        minMonth: "2024-10",
        series: [
          series(
            "amount",
            Array.from({ length: 12 }, () => "100"),
          ),
        ],
      },
    });
    await measure(wrapper, 1000);
    const scroll = wrapper.get(".line-scroll");
    await scroll.trigger("wheel", { deltaY: -100, deltaX: 0, deltaMode: 0 });
    expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
      { from: "2025-09", to: "2026-08" },
    ]);
    expect(wrapper.findAll(".chart-month-slot")).toHaveLength(12);
    await scroll.trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
      { from: "2025-08", to: "2026-07" },
    ]);
    await scroll.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
      { from: "2025-09", to: "2026-08" },
    ]);
    await scroll.trigger("keydown", { key: "Home" });
    expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
      { from: "2024-10", to: "2025-09" },
    ]);
    const count = wrapper.emitted("window-change")!.length;
    await scroll.trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.emitted("window-change")).toHaveLength(count);
    expect(
      wrapper.get('[aria-label="查看更早一个月"]').attributes("disabled"),
    ).toBeDefined();
    await scroll.trigger("keydown", { key: "End" });
    expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
      { from: "2025-10", to: "2026-09" },
    ]);
    const maxCount = wrapper.emitted("window-change")!.length;
    await scroll.trigger("wheel", { deltaY: 100, deltaX: 0, deltaMode: 0 });
    scroll.element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: true,
      }),
    );
    await settle();
    expect(wrapper.emitted("window-change")).toHaveLength(maxCount);
    expect(
      wrapper.get('[aria-label="查看更晚一个月"]').attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });

  it("鼠标拖动按真实月份槽位滑动，不以横向超宽画布代替窗口", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...fixedProps,
        series: [
          series(
            "amount",
            Array.from({ length: 12 }, () => "100"),
          ),
        ],
      },
    });
    await measure(wrapper, 1280);
    const scroll = wrapper.get(".line-scroll");
    scroll.element.dispatchEvent(pointer("pointerdown", 600));
    scroll.element.dispatchEvent(pointer("pointermove", 800));
    await settle();
    expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
      { from: "2025-08", to: "2026-07" },
    ]);
    expect(scroll.classes()).toContain("is-window-dragging");
    scroll.element.dispatchEvent(pointer("pointerup", 800));
    await settle();
    expect(scroll.classes()).not.toContain("is-window-dragging");
    expect(wrapper.findAll(".chart-month-slot")).toHaveLength(12);
    expect((scroll.element as HTMLElement).scrollLeft).toBe(0);
    wrapper.unmount();
  });

  it("当前及往年值按具体月份读取，跨年滑动和旧响应等待期间不把其他月份金额挪到新槽位", async () => {
    const current = [
      months("2026-01", 1)[0],
      months("2025-12", 1)[0],
      months("2026-02", 1)[0],
    ];
    const comparison = [
      months("2024-12", 1)[0],
      months("2025-02", 1)[0],
      months("2025-01", 1)[0],
    ];
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...fixedProps,
        windowEnd: "2026-02",
        periods: current,
        comparisonPeriods: comparison,
        series: [series("amount", ["11", "12", "22"])],
        comparisonSeries: [series("amount", ["120", "220", "110"])],
        comparisonLabel: "2025年同期",
      },
    });
    await measure(wrapper, 1000);
    const january = wrapper.get(
      '.analysis-line-series[data-series="current"] .analysis-line-point[data-month="2026-01"]',
    );
    const previousJanuary = wrapper.get(
      '.analysis-line-series[data-series="comparison"] .analysis-line-point[data-month="2026-01"]',
    );
    expect(previousJanuary.attributes("data-source-month")).toBe("2025-01");
    expect(january.attributes("data-point-x")).toBe(
      previousJanuary.attributes("data-point-x"),
    );
    expect(
      wrapper
        .get(
          '.chart-value-label[data-series="current"][data-index="10"] .amount-label-value',
        )
        .text(),
    ).toBe("¥11.00");
    expect(
      wrapper
        .get(
          '.chart-value-label[data-series="comparison"][data-index="10"] .amount-label-value',
        )
        .text(),
    ).toBe("¥110.00");
    await wrapper.get(".line-scroll").trigger("keydown", { key: "ArrowLeft" });
    await wrapper.setProps({ historyLoading: true });
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2025-02 至 2026-01",
    );
    expect(
      wrapper
        .get(
          '.chart-value-label[data-series="current"][data-index="11"] .amount-label-value',
        )
        .text(),
    ).toBe("¥11.00");
    expect(
      wrapper
        .get(
          '.chart-value-label[data-series="comparison"][data-index="11"] .amount-label-value',
        )
        .text(),
    ).toBe("¥110.00");
    expect(
      wrapper.find('.analysis-line-point[data-month="2025-02"]').exists(),
    ).toBe(false);
    expect(
      wrapper.get('.chart-month-slot[data-month="2025-02"]').text(),
    ).toContain("未知");
    expect(amounts(wrapper)).not.toContain("¥22.00");
    expect(wrapper.get(".window-loading").text()).toContain(
      "2025-02 至 2026-01",
    );
    wrapper.unmount();
  });

  it("完全缺数据或加载失败时仍显示十二槽位和明确状态，并允许重试当前范围", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: { ...fixedProps, periods: [], series: [], historyLoading: true },
    });
    await measure(wrapper, 950);
    expect(wrapper.find(".line-svg").exists()).toBe(true);
    expect(wrapper.findAll(".chart-month-slot")).toHaveLength(12);
    expect(wrapper.findAll(".unknown-month-marker")).toHaveLength(12);
    expect(wrapper.findAll(".analysis-line-point")).toHaveLength(0);
    expect(wrapper.text()).toContain("未知数据不会按零连线");
    await wrapper.setProps({
      historyLoading: false,
      historyError: "历史月份读取失败，请重试",
    });
    expect(wrapper.get(".window-error").text()).toContain("历史月份读取失败");
    await wrapper.get(".window-error button").trigger("click");
    expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
      { from: "2025-10", to: "2026-09" },
    ]);
    wrapper.unmount();
  });

  it("普通刷新保留当前窗口和用户指标，受控月份变化才调整窗口", async () => {
    const initial = [
      series(
        "income",
        Array.from({ length: 12 }, () => "100"),
        "收入",
      ),
      series(
        "expense",
        Array.from({ length: 12 }, () => "0"),
        "支出",
      ),
    ];
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: { ...fixedProps, series: initial },
    });
    await measure(wrapper, 1100);
    await wrapper.get('[aria-label="选择折线指标"]').setValue("expense");
    await wrapper.get(".line-scroll").trigger("keydown", { key: "ArrowLeft" });
    await wrapper.setProps({
      windowEnd: "2026-08",
      periods: months("2025-09"),
      series: initial.map((metric) => ({
        ...metric,
        values: [...metric.values],
      })),
    });
    await wrapper.setProps({
      periods: months("2025-09"),
      series: initial.map((metric) => ({
        ...metric,
        values: [...metric.values],
      })),
    });
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2025-09 至 2026-08",
    );
    expect(wrapper.get(".analysis-line-series").attributes("data-metric")).toBe(
      "expense",
    );
    expect(amounts(wrapper).every((amount) => amount === "¥0.00")).toBe(true);
    expect(wrapper.emitted("window-change")).toHaveLength(1);
    await wrapper.setProps({ windowEnd: "2026-06" });
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2025-07 至 2026-06",
    );
    expect(wrapper.emitted("window-change")).toHaveLength(1);
    wrapper.unmount();
  });

  it("窄屏保留十二个月，超长精准金额可换行分层但无截断、无标签重叠", async () => {
    const raw = "999999999999999999.123456789012";
    const values = Array.from({ length: 12 }, () => raw);
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...fixedProps,
        series: [series("amount", values)],
        comparisonSeries: [series("amount", values)],
        comparisonPeriods: months("2024-10"),
      },
    });
    await measure(wrapper, 280);
    expect(wrapper.get(".line-svg").attributes("viewBox").split(" ")[2]).toBe(
      "280",
    );
    expect(wrapper.findAll(".chart-month-slot")).toHaveLength(12);
    expect(wrapper.findAll(".chart-value-label")).toHaveLength(24);
    const formatted = "¥999,999,999,999,999,999.123456789012";
    expect(amounts(wrapper).every((amount) => amount === formatted)).toBe(true);
    expect(
      amounts(wrapper, "comparison").every((amount) => amount === formatted),
    ).toBe(true);
    expect(
      wrapper
        .findAll(".amount-label-value")
        .every((label) => label.findAll("tspan").length > 1),
    ).toBe(true);
    expectLabelsFit(wrapper);
    for (const label of wrapper.findAll(".chart-value-label")) {
      const point = wrapper.get(
        '.analysis-line-series[data-series="' +
          label.attributes("data-series") +
          '"] .analysis-line-point[data-index="' +
          label.attributes("data-index") +
          '"]',
      );
      expect(label.attributes("data-point-y")).toBe(
        point.attributes("data-point-y"),
      );
      expect(label.attributes("data-point-x")).toBe(
        point.attributes("data-point-x"),
      );
    }
    wrapper.unmount();
  });
});
