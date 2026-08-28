import MonthlyFinancialTrendChart from "../src/components/monthly-financial/MonthlyFinancialTrendChart.vue";
import type { MonthlyFinancialTrendPoint } from "../src/types/monthlyFinancialReport";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const elementStubs = {
  ElSelect: {
    name: "ElSelect",
    props: ["modelValue", "disabled", "placeholder", "teleported"],
    emits: ["change"],
    template: '<div class="el-select-stub"><slot /></div>',
  },
  ElOption: {
    name: "ElOption",
    props: ["label", "value"],
    template: '<span class="el-option-stub">{{ label }}</span>',
  },
  ElSkeleton: {
    name: "ElSkeleton",
    template: '<div class="el-skeleton-stub">加载中</div>',
  },
  ElButton: {
    name: "ElButton",
    emits: ["click"],
    template:
      '<button type="button" @click="$emit(\'click\')"><slot /></button>',
  },
};

function point(
  month: string,
  values: Partial<MonthlyFinancialTrendPoint> = {},
): MonthlyFinancialTrendPoint {
  return {
    month,
    status: null,
    valueState: null,
    actualReceipt: null,
    settlementInflow: null,
    totalOutflow: null,
    netChange: null,
    closingTotal: null,
    accountClosing: {
      general: null,
      business: null,
      welfare_one: null,
      welfare_two: null,
    },
    ...values,
  };
}

describe("月度财务趋势折线图", () => {
  it("加载完成后重新绑定画布尺寸并让宽屏折线铺满大图区域", async () => {
    const originalResizeObserver = window.ResizeObserver;
    const observe = jest.fn();
    const unobserve = jest.fn();
    const disconnect = jest.fn();
    let resizeCallback: ResizeObserverCallback | null = null;

    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    }

    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    });

    const wrapper = mount(MonthlyFinancialTrendChart, {
      props: {
        selectedYear: 2026,
        selectedMonth: "2026-08",
        comparisonYear: null,
        availableYears: [2026],
        points: [
          point("2026-08", {
            status: "draft",
            valueState: "current",
            closingTotal: "843515.4",
          }),
        ],
        loading: true,
      },
      global: { stubs: elementStubs },
    });

    try {
      expect(wrapper.find(".trend-canvas").exists()).toBe(false);

      await wrapper.setProps({ loading: false });
      await wrapper.vm.$nextTick();

      const canvas = wrapper.find(".trend-canvas");
      expect(canvas.exists()).toBe(true);
      expect(observe).toHaveBeenCalledWith(canvas.element);

      resizeCallback?.(
        [
          {
            contentRect: { width: 1600 },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
      await wrapper.vm.$nextTick();

      const chart = wrapper.find(".trend-svg");
      expect(chart.attributes("viewBox")).toBe("0 0 1600 500");
      expect(chart.attributes("style")).toContain("height: 500px");
      expect(wrapper.find(".grid-lines line").attributes("x2")).toBe("1576");
    } finally {
      wrapper.unmount();
      Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      });
    }

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("按服务端精确字符串展示月结值和未月结当前值，并让缺月形成断点", async () => {
    const wrapper = mount(MonthlyFinancialTrendChart, {
      props: {
        selectedYear: 2026,
        selectedMonth: "2026-02",
        comparisonYear: 2025,
        availableYears: [2024, 2025, 2026],
        points: [
          point("2026-01", {
            status: "closed",
            valueState: "closed",
            closingTotal: "123456789012345678.123456789012",
            actualReceipt: "9000.000000000001",
          }),
          point("2026-02"),
          point("2026-03", {
            status: "reopened",
            valueState: "current",
            closingTotal: "8888.8",
            actualReceipt: "7000.7",
          }),
          point("2025-01", {
            status: "closed",
            valueState: "closed",
            closingTotal: "5000",
            actualReceipt: "3000",
          }),
        ],
      },
      global: { stubs: elementStubs },
    });

    const monthSelect = wrapper
      .find(".view-month-select")
      .findComponent(elementStubs.ElSelect);
    expect(monthSelect.props("modelValue")).toBe(2);
    expect(wrapper.findAll(".view-month-select .el-option-stub")).toHaveLength(
      12,
    );
    expect(wrapper.find(".month-inspector").text()).toContain("2026年2月");
    expect(wrapper.find(".month-inspector").text()).toContain("无数据");
    expect(wrapper.find(".month-inspector").text()).not.toContain("¥0");
    expect(
      wrapper
        .findAll(".point-value-label")
        .map((label) => label.text())
        .join(" "),
    ).toContain("¥123,456,789,012,345,678.123456789012");
    expect(
      wrapper
        .find(".trend-svg")
        .element.lastElementChild?.classList.contains(
          "point-value-label-layer",
        ),
    ).toBe(true);
    expect(wrapper.findAll(".point-value-label-bg")).toHaveLength(
      wrapper.findAll(".point-value-label").length,
    );

    monthSelect.vm.$emit("change", 3);
    await wrapper.vm.$nextTick();
    expect(monthSelect.props("modelValue")).toBe(3);
    expect(wrapper.find(".month-inspector").text()).toContain("¥8,888.8");
    expect(wrapper.find(".month-inspector").text()).toContain(
      "当前值（未月结）",
    );

    const januaryPoint = wrapper.findAll(".series-point-group")[0];
    await januaryPoint.trigger("click");

    expect(monthSelect.props("modelValue")).toBe(1);
    expect(wrapper.find(".month-inspector").text()).toContain(
      "¥123,456,789,012,345,678.123456789012",
    );
    expect(wrapper.find(".month-inspector").text()).toContain("月结值");
    expect(wrapper.findAll(".series-edge")).toHaveLength(0);

    const receiptButton = wrapper
      .findAll(".metric-switch button")
      .find((button) => button.text() === "主营实际到账");
    expect(receiptButton).toBeDefined();
    await receiptButton!.trigger("click");
    expect(wrapper.find(".month-inspector").text()).toContain(
      "¥9,000.000000000001",
    );

    await wrapper.setProps({ selectedMonth: "2026-12" });
    expect(monthSelect.props("modelValue")).toBe(12);
    expect(wrapper.find(".month-inspector").text()).toContain("2026年12月");
    expect(wrapper.find(".month-inspector").text()).toContain("无数据");

    wrapper.unmount();
  });

  it("支持从趋势卡片进入和退出全屏查看", async () => {
    const fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "fullscreenElement",
    );
    const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "exitFullscreen",
    );
    const requestFullscreen = jest.fn().mockResolvedValue(undefined);
    const exitFullscreen = jest.fn().mockResolvedValue(undefined);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });

    const wrapper = mount(MonthlyFinancialTrendChart, {
      props: {
        selectedYear: 2026,
        selectedMonth: "2026-08",
        comparisonYear: null,
        availableYears: [2026],
        points: [
          point("2026-08", {
            status: "draft",
            valueState: "current",
            closingTotal: "843515.4",
          }),
        ],
      },
      global: { stubs: elementStubs },
    });

    try {
      const card = wrapper.find(".financial-trend-card");
      Object.defineProperty(card.element, "requestFullscreen", {
        configurable: true,
        value: requestFullscreen,
      });

      await wrapper.find(".fullscreen-toggle").trigger("click");
      expect(requestFullscreen).toHaveBeenCalledTimes(1);

      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        value: card.element,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
      await wrapper.vm.$nextTick();

      expect(card.classes()).toContain("is-fullscreen");
      expect(wrapper.find(".fullscreen-toggle").text()).toContain("退出全屏");
      expect(
        wrapper
          .find(".view-month-select")
          .findComponent(elementStubs.ElSelect)
          .props("teleported"),
      ).toBe(false);

      await wrapper.find(".fullscreen-toggle").trigger("click");
      expect(exitFullscreen).toHaveBeenCalledTimes(1);
    } finally {
      wrapper.unmount();
      if (fullscreenElementDescriptor) {
        Object.defineProperty(
          document,
          "fullscreenElement",
          fullscreenElementDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "fullscreenElement");
      }
      if (exitFullscreenDescriptor) {
        Object.defineProperty(
          document,
          "exitFullscreen",
          exitFullscreenDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "exitFullscreen");
      }
    }
  });

  it("双年度同月零值标签远离横轴圆点并上下错位展示", () => {
    const wrapper = mount(MonthlyFinancialTrendChart, {
      props: {
        selectedYear: 2026,
        selectedMonth: "2026-06",
        comparisonYear: 2025,
        availableYears: [2025, 2026],
        points: [
          point("2026-06", {
            status: "closed",
            valueState: "closed",
            closingTotal: "0.00",
          }),
          point("2025-06", {
            status: "closed",
            valueState: "closed",
            closingTotal: "0.00",
          }),
        ],
      },
      global: { stubs: elementStubs },
    });

    const labels = wrapper.findAll(".point-value-label");
    expect(labels).toHaveLength(2);
    expect(labels.map((label) => label.text())).toEqual(["¥0.00", "¥0.00"]);
    expect(
      Math.abs(
        Number(labels[0].attributes("y")) - Number(labels[1].attributes("y")),
      ),
    ).toBeGreaterThanOrEqual(16);
    const pointY = Number(wrapper.find(".series-point").attributes("cy"));
    for (const background of wrapper.findAll(".point-value-label-bg")) {
      const top = Number(background.attributes("y"));
      const bottom = top + Number(background.attributes("height"));
      const distance =
        pointY < top ? top - pointY : pointY > bottom ? pointY - bottom : 0;
      expect(distance).toBeGreaterThanOrEqual(12);
    }

    wrapper.unmount();
  });

  it("连续月份同金额标签保持完整且背景两两不重叠", () => {
    const months = [5, 6, 7, 8];
    const wrapper = mount(MonthlyFinancialTrendChart, {
      props: {
        selectedYear: 2026,
        selectedMonth: "2026-06",
        comparisonYear: 2025,
        availableYears: [2025, 2026],
        points: [
          ...months.map((month) =>
            point(`2026-${String(month).padStart(2, "0")}`, {
              status: "closed",
              valueState: "closed",
              closingTotal: "50000.00",
            }),
          ),
          ...months.map((month) =>
            point(`2025-${String(month).padStart(2, "0")}`, {
              status: "closed",
              valueState: "closed",
              closingTotal: "50000.00",
            }),
          ),
        ],
      },
      global: { stubs: elementStubs },
    });

    const backgrounds = wrapper.findAll(".point-value-label-bg").map((item) => {
      const x = Number(item.attributes("x"));
      const y = Number(item.attributes("y"));
      const width = Number(item.attributes("width"));
      const height = Number(item.attributes("height"));
      return { left: x, right: x + width, top: y, bottom: y + height };
    });
    expect(backgrounds).toHaveLength(8);
    for (let leftIndex = 0; leftIndex < backgrounds.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < backgrounds.length;
        rightIndex += 1
      ) {
        const left = backgrounds[leftIndex];
        const right = backgrounds[rightIndex];
        const safeGap = 4;
        const overlaps =
          left.left < right.right + safeGap &&
          left.right + safeGap > right.left &&
          left.top < right.bottom + safeGap &&
          left.bottom + safeGap > right.top;
        expect(overlaps).toBe(false);
      }
    }

    wrapper.unmount();
  });

  it("历史年度选择向页面发出明确年度且错误态可重试", async () => {
    const wrapper = mount(MonthlyFinancialTrendChart, {
      props: {
        selectedYear: 2026,
        comparisonYear: 2025,
        availableYears: [2024, 2025, 2026],
        points: [],
        error: "服务暂时不可用",
      },
      global: { stubs: elementStubs },
    });

    wrapper
      .find(".history-year-select")
      .findComponent(elementStubs.ElSelect)
      .vm.$emit("change", 2024);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("comparison-year-change")).toEqual([[2024]]);

    await wrapper.find(".trend-state--error button").trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);

    wrapper.unmount();
  });
});
