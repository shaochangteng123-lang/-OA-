import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import { nextTick } from "vue";
import type {
  FinancialAnalysisPeriod,
  FinancialAnalysisSeries,
  FinancialAnalysisValue,
} from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

function periods(year: number, count: number): FinancialAnalysisPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    return {
      key: year + "-" + month,
      label: year + "年" + (index + 1) + "月",
      from: year + "-" + month,
      to: year + "-" + month,
    };
  });
}
function series(
  key: string,
  values: Array<string | null>,
  label = key,
): FinancialAnalysisSeries {
  return { key, label, values };
}
type Box = { x: number; y: number; width: number; height: number };
function boxesOverlap(left: Box, right: Box) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}
function labelBoxes(wrapper: ReturnType<typeof mount>): Box[] {
  return wrapper.findAll(".amount-label-background").map((box) => ({
    x: Number(box.attributes("x")),
    y: Number(box.attributes("y")),
    width: Number(box.attributes("width")),
    height: Number(box.attributes("height")),
  }));
}
function expectNoLabelCollisions(wrapper: ReturnType<typeof mount>) {
  const boxes = labelBoxes(wrapper);
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      expect({
        left,
        right,
        overlap: boxesOverlap(boxes[left], boxes[right]),
      }).toEqual({ left, right, overlap: false });
    }
  }
  const canvas = wrapper
    .get(".line-svg")
    .attributes("viewBox")
    .split(" ")
    .map(Number);
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas[2]);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas[3]);
  }
}

describe("财务折线指标、往年对比与精准金额标签", () => {
  it("指定总金额即使全未知仍保持默认，已知部分点位明确标注且手选后不抢回", async () => {
    const total = {
      ...series("categoryTotal", ["10.01", null], "总金额"),
      partial: [true, true],
    };
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "一般账户出账",
        type: "line",
        periods: periods(2026, 2),
        series: [total, series("administration", ["8", "9"], "行政支出")],
        preferredMetricKeys: ["categoryTotal"],
      },
    });
    expect(
      (wrapper.get('[aria-label="选择折线指标"]').element as HTMLSelectElement)
        .value,
    ).toBe("categoryTotal");
    expect(
      wrapper.get(".chart-value-label").attributes("aria-label"),
    ).toContain("总金额（已知部分）");
    await wrapper.get('[aria-label="选择折线指标"]').setValue("administration");
    await wrapper.setProps({
      series: [
        { ...total, values: ["11.01", null] },
        series("administration", ["8", "10"], "行政支出"),
      ],
    });
    expect(
      (wrapper.get('[aria-label="选择折线指标"]').element as HTMLSelectElement)
        .value,
    ).toBe("administration");
    wrapper.unmount();
  });
  it("同期标签仅用短年份标题，普通金额按紧凑点间距展示且跨月份标签避让", () => {
    const values = Array.from({ length: 9 }, () => "2053235.4");
    const fullLabel = "2025年同期（2025-01至2025-09）";
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "完整期间对比",
        type: "line",
        periods: periods(2026, 9),
        comparisonPeriods: periods(2025, 9),
        comparisonLabel: fullLabel,
        series: [series("amount", values)],
        comparisonSeries: [series("amount", values)],
      },
    });
    expect(wrapper.get(".line-legend").text()).toContain(fullLabel);
    expect(
      wrapper
        .findAll(
          '.chart-value-label[data-series="comparison"] .amount-label-caption',
        )
        .every((caption) => caption.text() === "2025年同期"),
    ).toBe(true);
    expect(wrapper.get(".amount-label-layer").text()).not.toContain(
      "2025-01至2025-09",
    );
    const currentPoints = wrapper.findAll(
      '.analysis-line-series[data-series="current"] .analysis-line-point',
    );
    const gap =
      Number(currentPoints[1].attributes("data-point-x")) -
      Number(currentPoints[0].attributes("data-point-x"));
    expect(gap).toBeGreaterThanOrEqual(96);
    expect(gap).toBeLessThanOrEqual(120);
    expect(
      Number.parseFloat(wrapper.get(".line-svg").element.style.minWidth),
    ).toBeLessThan(1200);
    const currentEdge = wrapper.get(
      '.analysis-line-series[data-series="current"] .analysis-line-edge',
    );
    const comparisonEdge = wrapper.get(
      '.analysis-line-series[data-series="comparison"] .analysis-line-edge',
    );
    expect(currentEdge.attributes("stroke")).not.toBe(
      comparisonEdge.attributes("stroke"),
    );
    expect(Number(comparisonEdge.attributes("stroke-width"))).toBeGreaterThan(
      Number(currentEdge.attributes("stroke-width")),
    );
    expect(wrapper.findAll(".chart-value-label")).toHaveLength(18);
    expectNoLabelCollisions(wrapper);
    wrapper.unmount();
  });

  it("初次及查询期间改变时定位最近月份，同周期普通刷新保留用户滚动位置", async () => {
    const values = Array.from({ length: 12 }, (_, index) =>
      index < 8 ? null : "100",
    );
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "查看最近月份",
        type: "line",
        periods: periods(2026, 12),
        series: [series("amount", values)],
      },
    });
    const scroll = wrapper.get(".line-scroll").element as HTMLElement;
    Object.defineProperty(scroll, "scrollWidth", {
      configurable: true,
      value: 1500,
    });
    Object.defineProperty(scroll, "clientWidth", {
      configurable: true,
      value: 600,
    });
    await nextTick();
    await nextTick();
    expect(scroll.scrollLeft).toBe(900);
    scroll.scrollLeft = 180;
    await wrapper.get(".line-scroll").trigger("scroll");
    await wrapper.setProps({
      periods: periods(2026, 12),
      series: [
        series(
          "amount",
          values.map((value) => (value === null ? null : "110")),
        ),
      ],
    });
    await nextTick();
    expect(scroll.scrollLeft).toBe(180);
    await wrapper.setProps({ periods: periods(2027, 12) });
    await nextTick();
    expect(scroll.scrollLeft).toBe(900);
    wrapper.unmount();
  });
  it("初始优先展示有非零数据的合计或指标，刷新不改用户已选指标", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "支出趋势",
        type: "line",
        periods: periods(2026, 2),
        series: [
          series("administration", ["0", "0"], "行政支出"),
          series("salary", ["1000", "1200"], "薪资支出"),
          series("total", ["1100", "1300"], "总支出"),
        ],
      },
    });
    expect(wrapper.get(".analysis-line-series").attributes("data-metric")).toBe(
      "total",
    );
    await wrapper.get('[aria-label="选择折线指标"]').setValue("administration");
    await wrapper.setProps({
      series: [
        series("administration", ["0", "0"], "行政支出"),
        series("salary", ["1000", "1400"], "薪资支出"),
        series("total", ["1100", "1500"], "总支出"),
      ],
    });
    expect(wrapper.get(".analysis-line-series").attributes("data-metric")).toBe(
      "administration",
    );
    expect(
      wrapper
        .findAll(".amount-label-value")
        .every((label) => label.text() === "¥0.00"),
    ).toBe(true);
    wrapper.unmount();
    const withoutTotal = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "分类支出",
        type: "line",
        periods: periods(2026, 2),
        series: [
          series("administration", ["0", "0"], "行政支出"),
          series("salary", ["1000", "1200"], "薪资支出"),
        ],
      },
    });
    expect(
      withoutTotal.get(".analysis-line-series").attributes("data-metric"),
    ).toBe("salary");
    withoutTotal.unmount();
  });
  it("默认只绘制一个指标，可清楚切换，也可主动选择多个指标比较", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "资金趋势",
        type: "line",
        periods: periods(2026, 2),
        series: [
          series("balance", ["10", "20"], "资金余额"),
          series("income", ["30", "40"], "收入"),
          series("expense", ["5", "6"], "支出"),
        ],
      },
    });
    expect(wrapper.findAll(".analysis-line-series")).toHaveLength(1);
    expect(wrapper.get(".analysis-line-series").attributes("data-metric")).toBe(
      "balance",
    );
    await wrapper.get('[aria-label="选择折线指标"]').setValue("expense");
    expect(wrapper.get(".analysis-line-series").attributes("data-metric")).toBe(
      "expense",
    );
    expect(
      wrapper.findAll(".amount-label-value").map((item) => item.text()),
    ).toEqual(["¥5.00", "¥6.00"]);
    await wrapper.get(".metric-controls button").trigger("click");
    expect(wrapper.get(".metric-checklist").text()).toContain(
      "选择需要比较的指标",
    );
    expect(
      wrapper
        .findAll(".analysis-line-series")
        .map((item) => item.attributes("data-metric")),
    ).toEqual(["balance", "expense"]);
    const checkboxes = wrapper.findAll(
      '.metric-checklist input[type="checkbox"]',
    );
    await checkboxes[1].setValue(true);
    expect(wrapper.findAll(".analysis-line-series")).toHaveLength(3);
    await wrapper.get(".metric-controls button").trigger("click");
    expect(wrapper.findAll(".analysis-line-series")).toHaveLength(1);
    expect(wrapper.get(".analysis-line-series").attributes("data-metric")).toBe(
      "expense",
    );
    wrapper.unmount();
  });

  it("签订合同数量按行政区和服务单位拆线并以个显示同期", async () => {
    const countSeries: FinancialAnalysisSeries = {
      key: "signedContractCount",
      label: "主营项目签订合同数量",
      unit: "个",
      values: ["1", "1"],
      segments: [
        {
          key: "朝阳区:甲方",
          label: "朝阳区 · 甲方",
          region: "朝阳区",
          serviceUnit: "甲方",
          values: ["1", "0"],
          projectNames: [["当期朝阳项目"], []],
        },
        {
          key: "海淀区:甲方",
          label: "海淀区 · 甲方",
          region: "海淀区",
          serviceUnit: "甲方",
          values: ["0", "1"],
          projectNames: [[], ["当期海淀项目"]],
        },
      ],
    };
    const comparisonCountSeries: FinancialAnalysisSeries = {
      ...countSeries,
      values: ["3", "2"],
      segments: [
        {
          key: "海淀区:甲方",
          label: "海淀区 · 甲方",
          region: "海淀区",
          serviceUnit: "甲方",
          values: ["3", "0"],
          projectNames: [
            ["同期海淀重复项目", "同期海淀重复项目", "同期海淀第三项目"],
            [],
          ],
        },
        {
          key: "朝阳区:甲方",
          label: "朝阳区 · 甲方",
          region: "朝阳区",
          serviceUnit: "甲方",
          values: ["0", "2"],
          projectNames: [[], ["同期朝阳项目一", "同期朝阳项目二"]],
        },
      ],
    };
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "主营项目趋势",
        type: "line",
        periods: periods(2026, 2),
        comparisonPeriods: periods(2025, 2),
        series: [series("contract", ["100", "200"], "合同金额"), countSeries],
        comparisonSeries: [
          series("contract", ["50", "80"], "合同金额"),
          comparisonCountSeries,
        ],
      },
    });

    await wrapper
      .get('[aria-label="选择折线指标"]')
      .setValue("signedContractCount");
    expect(wrapper.emitted("metric-selected")?.at(-1)).toEqual([
      "signedContractCount",
    ]);
    expect(
      wrapper.findAll('.analysis-line-series[data-series="current"]'),
    ).toHaveLength(2);
    expect(
      wrapper.findAll('.analysis-line-series[data-series="comparison"]'),
    ).toHaveLength(2);
    expect(wrapper.get(".line-legend").text()).toContain("朝阳区 · 甲方");
    expect(wrapper.get(".line-legend").text()).toContain("海淀区 · 甲方");
    expect(
      wrapper
        .findAll(".amount-label-value")
        .every((label) => label.text().endsWith("个")),
    ).toBe(true);
    expect(wrapper.text()).not.toMatch(/¥\s*[0-9]/);
    expect(
      wrapper
        .findAll(".axis-label")
        .filter((tick) => tick.text().endsWith("个")),
    ).toHaveLength(5);
    expect(
      wrapper.get(".metric-controls button").attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper
        .get(
          '.analysis-line-series[data-series="comparison"][data-segment="朝阳区:甲方"]',
        )
        .findAll("title")
        .map((title) => title.text()),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("0个"),
        expect.stringContaining("2个"),
      ]),
    );
    expect(
      wrapper
        .findAll(
          '.chart-value-label[data-series="comparison"][data-metric="signedContractCount"] .amount-label-value',
        )
        .map((label) => label.text()),
    ).toEqual(expect.arrayContaining(["0个", "2个", "3个", "0个"]));

    await wrapper
      .get(
        '.analysis-line-series[data-series="current"][data-segment="朝阳区:甲方"] .analysis-line-point[data-source-month="2026-01"]',
      )
      .trigger("click");
    expect(wrapper.get(".chart-inspector").text()).toContain("当期朝阳项目");
    expect(wrapper.get(".chart-inspector").text()).not.toContain(
      "当期海淀项目",
    );
    expect(wrapper.get(".chart-inspector").text()).not.toContain(
      "同期海淀重复项目",
    );

    const comparisonLabel = wrapper
      .findAll(
        '.chart-value-label[data-series="comparison"][data-metric="signedContractCount"][data-month="2026-01"]',
      )
      .find((label) =>
        label.attributes("aria-label").includes("海淀区 · 甲方"),
      );
    expect(comparisonLabel).toBeDefined();
    await comparisonLabel!.trigger("click");
    expect(wrapper.get(".chart-inspector").text()).toContain("2025年1月");
    expect(
      wrapper
        .findAll(".chart-inspector-projects li")
        .map((item) => item.text()),
    ).toEqual(["同期海淀重复项目", "同期海淀重复项目", "同期海淀第三项目"]);
    expect(wrapper.get(".chart-inspector").text()).not.toContain(
      "当期朝阳项目",
    );

    await wrapper
      .get(
        '.analysis-line-series[data-series="current"][data-segment="朝阳区:甲方"] .analysis-line-point[data-source-month="2026-02"]',
      )
      .trigger("click");
    expect(wrapper.get(".chart-inspector").text()).toContain("0个");
    expect(wrapper.get(".chart-inspector").text()).toContain(
      "该期间该分组无新签项目",
    );
    expect(wrapper.findAll(".chart-inspector-projects li")).toHaveLength(0);
    expect(wrapper.get(".chart-inspector").text()).not.toContain(
      "同期海淀重复项目",
    );
    wrapper.unmount();
  });

  it.each([
    {
      view: "季度历史",
      periods: [
        {
          key: "2026-Q2",
          label: "2026年第2季度",
          from: "2026-04",
          to: "2026-06",
        },
        {
          key: "2025-Q4",
          label: "2025年第4季度",
          from: "2025-10",
          to: "2025-12",
        },
        {
          key: "2026-Q1",
          label: "2026年第1季度",
          from: "2026-01",
          to: "2026-03",
        },
      ],
      values: ["1", "1", "1"],
      projectNames: [
        ["二季度签订项目"],
        ["上年四季度签订项目"],
        ["一季度签订项目"],
      ],
      chartProps: {
        quarterHistory: true,
        windowEnd: "2026-06",
        minMonth: "2025-10",
        maxMonth: "2026-06",
      },
      targetPeriod: "2026-Q1",
      expected: "一季度签订项目",
      excluded: ["二季度签订项目", "上年四季度签订项目"],
    },
    {
      view: "年度分期",
      periods: [
        {
          key: "2025",
          label: "2025年",
          from: "2025-01",
          to: "2025-12",
        },
        {
          key: "2026",
          label: "2026年",
          from: "2026-01",
          to: "2026-09",
        },
      ],
      values: ["1", "2"],
      projectNames: [
        ["2025年签订项目"],
        ["2026年签订项目一", "2026年签订项目二"],
      ],
      chartProps: { periodView: true },
      targetPeriod: "2026",
      expected: "2026年签订项目一",
      excluded: ["2025年签订项目"],
    },
  ])(
    "$view按真实来源期间索引展示签订项目名称",
    async ({
      periods: groupedPeriods,
      values,
      projectNames,
      chartProps,
      targetPeriod,
      expected,
      excluded,
    }) => {
      const countSeries: FinancialAnalysisSeries = {
        key: "signedContractCount",
        label: "主营项目签订合同数量",
        unit: "个",
        values,
        segments: [
          {
            key: "朝阳区:甲方",
            label: "朝阳区 · 甲方",
            region: "朝阳区",
            serviceUnit: "甲方",
            values,
            projectNames,
          },
        ],
      };
      const wrapper = mount(MonthlyFinancialAnalysisChart, {
        props: {
          title: "主营项目趋势",
          type: "line",
          periods: groupedPeriods,
          series: [countSeries],
          ...chartProps,
        },
      });

      await wrapper
        .get(
          `.analysis-line-series[data-series="current"] .analysis-line-point[data-period="${targetPeriod}"]`,
        )
        .trigger("click");
      expect(wrapper.get(".chart-inspector").text()).toContain(expected);
      for (const projectName of excluded)
        expect(wrapper.get(".chart-inspector").text()).not.toContain(
          projectName,
        );
      if (targetPeriod === "2026")
        expect(
          wrapper
            .findAll(".chart-inspector-projects li")
            .map((item) => item.text()),
        ).toEqual(["2026年签订项目一", "2026年签订项目二"]);
      wrapper.unmount();
    },
  );

  it("按指标键匹配往年数据并按索引对齐，实线圆点与虚线菱形区分两期", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "回款同比",
        type: "line",
        periods: periods(2026, 2),
        comparisonPeriods: periods(2025, 2),
        comparisonLabel: "上年同期",
        series: [
          series("receipt", ["100", "200"], "实际回款"),
          series("interest", ["3", "4"], "利息"),
        ],
        comparisonSeries: [
          series("interest", ["1", "2"]),
          series("receipt", ["50", "250"]),
        ],
      },
    });
    const current = wrapper.get('.analysis-line-series[data-series="current"]');
    const comparison = wrapper.get(
      '.analysis-line-series[data-series="comparison"]',
    );
    expect(current.findAll(".current-point")).toHaveLength(2);
    expect(comparison.findAll(".comparison-point")).toHaveLength(2);
    expect(
      current.get(".analysis-line-edge").attributes("stroke-dasharray"),
    ).toBeUndefined();
    expect(
      comparison.get(".analysis-line-edge").attributes("stroke-dasharray"),
    ).toBe("7 5");
    for (let index = 0; index < 2; index += 1) {
      expect(
        current
          .findAll(".analysis-line-point")
          [index].attributes("data-point-x"),
      ).toBe(
        comparison
          .findAll(".analysis-line-point")
          [index].attributes("data-point-x"),
      );
    }
    expect(
      wrapper
        .findAll(
          '.chart-value-label[data-series="comparison"] .amount-label-value',
        )
        .map((item) => item.text()),
    ).toEqual(["¥50.00", "¥250.00"]);
    expect(wrapper.text()).toContain("2025年1月");
    await comparison.findAll(".analysis-line-point")[0].trigger("focus");
    expect(wrapper.get(".chart-inspector").text()).toContain("2025年1月");
    expect(wrapper.get(".chart-inspector").text()).toContain("上年同期");
    expect(wrapper.get(".chart-inspector").text()).toContain("¥50.00");
    wrapper.unmount();
  });

  it("两期十二个月同为零仍默认显示二十四个完整标签，标签避让且真实点不偏移", () => {
    const zeros = Array.from({ length: 12 }, () => "0");
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "零金额同期",
        type: "line",
        periods: periods(2026, 12),
        comparisonPeriods: periods(2025, 12),
        series: [series("balance", zeros, "余额")],
        comparisonSeries: [series("balance", zeros)],
      },
    });
    expect(wrapper.findAll(".chart-value-label")).toHaveLength(24);
    expect(wrapper.findAll(".amount-label-leader")).toHaveLength(24);
    expect(
      wrapper
        .findAll(".amount-label-value")
        .every((label) => label.text() === "¥0.00"),
    ).toBe(true);
    const zeroAxisY = Number(
      wrapper.get(".chart-grid.is-zero").attributes("y1"),
    );
    for (const point of wrapper.findAll(".analysis-line-point"))
      expect(Number(point.attributes("data-point-y"))).toBe(zeroAxisY);
    for (const label of wrapper.findAll(".chart-value-label")) {
      const point = wrapper.get(
        '.analysis-line-series[data-series="' +
          label.attributes("data-series") +
          '"] .analysis-line-point[data-index="' +
          label.attributes("data-index") +
          '"]',
      );
      expect(label.attributes("data-point-x")).toBe(
        point.attributes("data-point-x"),
      );
      expect(label.attributes("data-point-y")).toBe(
        point.attributes("data-point-y"),
      );
    }
    expectNoLabelCollisions(wrapper);
    const boxes = labelBoxes(wrapper);
    for (const point of wrapper.findAll(".analysis-line-point")) {
      const pointBox = {
        x: Number(point.attributes("data-point-x")) - 5,
        y: Number(point.attributes("data-point-y")) - 5,
        width: 10,
        height: 10,
      };
      expect(boxes.some((box) => boxesOverlap(box, pointBox))).toBe(false);
    }
    wrapper.unmount();
  });

  it("大金额及十二位小数不省略，自动扩展横向画布保证标签完整且不碰撞", () => {
    const amount = "999999999999999999.123456789012";
    const values = Array.from({ length: 12 }, () => amount);
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "高精度金额",
        type: "line",
        periods: periods(2026, 12),
        series: [series("amount", values)],
        comparisonSeries: [series("amount", values)],
        comparisonPeriods: periods(2025, 12),
      },
    });
    const amountText = "¥999,999,999,999,999,999.123456789012";
    expect(wrapper.findAll(".amount-label-value")).toHaveLength(24);
    expect(
      wrapper
        .findAll(".amount-label-value")
        .every((label) => label.text() === amountText),
    ).toBe(true);
    expect(
      Number.parseFloat(wrapper.get(".line-svg").element.style.minWidth),
    ).toBeGreaterThan(2000);
    expect(wrapper.get(".line-scroll").attributes("tabindex")).toBe("0");
    expectNoLabelCollisions(wrapper);
    wrapper.unmount();
  });

  it("未知值不出金额标签也不跨越断点，真实零值仍绘制并连线", () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "缺失月份",
        type: "line",
        periods: periods(2026, 4),
        series: [series("amount", ["1", "0", null, "2"])],
        comparisonSeries: [series("amount", [null, "0", null, "1"])],
      },
    });
    expect(wrapper.findAll(".chart-value-label")).toHaveLength(5);
    expect(
      wrapper
        .get('.analysis-line-series[data-series="current"]')
        .findAll(".analysis-line-edge"),
    ).toHaveLength(1);
    expect(
      wrapper
        .get('.analysis-line-series[data-series="comparison"]')
        .findAll(".analysis-line-edge"),
    ).toHaveLength(0);
    expect(
      wrapper
        .findAll(".amount-label-value")
        .filter((label) => label.text() === "¥0.00"),
    ).toHaveLength(2);
    wrapper.unmount();
  });

  it("主动展开六指标同期比较时增加标签层，不以移动原始点解决重叠", async () => {
    const metrics = Array.from({ length: 6 }, (_, index) =>
      series("metric-" + index, ["0", "0"], "费用分类" + (index + 1)),
    );
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "多项费用",
        type: "line",
        periods: periods(2026, 2),
        comparisonPeriods: periods(2025, 2),
        series: metrics,
        comparisonSeries: metrics,
      },
    });
    await wrapper.get(".metric-controls button").trigger("click");
    const inputs = wrapper.findAll('.metric-checklist input[type="checkbox"]');
    for (let index = 2; index < inputs.length; index += 1)
      await inputs[index].setValue(true);
    expect(wrapper.findAll(".analysis-line-series")).toHaveLength(12);
    expect(wrapper.findAll(".chart-value-label")).toHaveLength(24);
    const zeroAxisY = Number(
      wrapper.get(".chart-grid.is-zero").attributes("y1"),
    );
    expect(
      wrapper
        .findAll(".analysis-line-point")
        .every(
          (point) => Number(point.attributes("data-point-y")) === zeroAxisY,
        ),
    ).toBe(true);
    expect(
      Number(wrapper.get(".line-svg").attributes("viewBox").split(" ")[3]),
    ).toBeGreaterThan(394);
    expectNoLabelCollisions(wrapper);
    wrapper.unmount();
  });

  it("更换查询后的可用指标变化时恢复有效单指标，清掉旧检查值", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "变更查询",
        type: "line",
        periods: periods(2026, 1),
        series: [series("old", ["1"], "旧指标")],
      },
    });
    await wrapper.get(".chart-value-label").trigger("focus");
    expect(wrapper.find(".chart-inspector").exists()).toBe(true);
    await wrapper.setProps({ series: [series("new", ["2.123"], "新指标")] });
    expect(wrapper.get(".analysis-line-series").attributes("data-metric")).toBe(
      "new",
    );
    expect(wrapper.get(".amount-label-value").text()).toBe("¥2.123");
    expect(wrapper.find(".chart-inspector").exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("已知正金额结构与中性空环", () => {
  const items: FinancialAnalysisValue[] = [
    { key: "a", label: "已知收入一", amount: "100.000000000001" },
    { key: "b", label: "已知收入二", amount: "300" },
    { key: "negative", label: "负余额", amount: "-50.123456789012" },
    { key: "unknown", label: "未核算账户", amount: null },
    { key: "zero", label: "零余额", amount: "0" },
  ];
  it("正金额模式只按已知正数计算比例，负数、零和未知完整另列且明确告警", () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "账户结构",
        type: "donut",
        items,
        structureMode: "known-positive",
      },
    });
    expect(wrapper.get(".structure-scope-note").text()).toBe(
      "仅已知正金额，不代表净额或完整总额",
    );
    expect(wrapper.findAll(".donut-slice")).toHaveLength(2);
    expect(wrapper.get(".breakdown-legend").text()).toContain("25.00%");
    expect(wrapper.get(".breakdown-legend").text()).toContain("75.00%");
    expect(wrapper.get(".breakdown-legend").text()).toContain(
      "¥100.000000000001",
    );
    expect(wrapper.get(".breakdown-legend").text()).not.toContain("负余额");
    expect(wrapper.get(".excluded-structure").text()).toContain(
      "¥-50.123456789012",
    );
    expect(wrapper.get(".excluded-structure").text()).toContain("未知／未核算");
    expect(wrapper.get(".excluded-structure").text()).toContain("¥0.00");
    wrapper.unmount();
  });

  it.each([
    {
      values: [{ key: "zero", label: "零金额", amount: "0" }],
      reason: "金额均为零",
    },
    {
      values: [{ key: "unknown", label: "未知金额", amount: null }],
      reason: "全部金额未知",
    },
    { values: [] as FinancialAnalysisValue[], reason: "暂无金额记录" },
  ])("没有正数时显示中性空环及原因：$reason", ({ values, reason }) => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "空结构",
        type: "donut",
        items: values,
        structureMode: "known-positive",
      },
    });
    expect(wrapper.find(".empty-donut-svg").exists()).toBe(true);
    expect(wrapper.find(".donut-svg").exists()).toBe(false);
    expect(wrapper.text()).toContain(reason);
    expect(wrapper.text()).toContain("不代表净额或完整总额");
    wrapper.unmount();
  });

  it("默认严格模式仍拒绝负数和未知组成，不把部分数据当完整结构", () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: { title: "严格结构", type: "donut", items },
    });
    expect(wrapper.find(".donut-svg").exists()).toBe(false);
    expect(wrapper.find(".empty-donut-svg").exists()).toBe(true);
    expect(wrapper.text()).toContain("含未知或未核算金额");
    expect(wrapper.get(".unavailable-values").text()).toContain(
      "¥-50.123456789012",
    );
    expect(wrapper.find(".structure-scope-note").exists()).toBe(false);
    wrapper.unmount();
  });
});
