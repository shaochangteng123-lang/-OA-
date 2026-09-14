import Details from "@/components/monthly-financial/MonthlyFinancialPersonnelDetails.vue";
import { buildFinancialAnalysisStructure } from "@/utils/monthlyFinancialAnalysisStructure";
import type {
  FinancialAnalysisModule,
  FinancialAnalysisQuery,
  FinancialAnalysisDetail,
} from "@/types/monthlyFinancialAnalysis";
const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const query: FinancialAnalysisQuery = {
  from: "2026-01",
  to: "2026-03",
  granularity: "month",
};
const keys = [
  "salary",
  "social",
  "housing",
  "adjustment",
  "payrollCost",
  "basic",
  "large",
  "business",
  "overhead",
  "total",
];
function row(id: string, period = "2026-01"): FinancialAnalysisDetail {
  return {
    id,
    personId: "p1",
    person: "测试人员",
    year: "2026",
    from: period,
    to: period,
    month: period,
    period,
    sourceId: "source-" + id,
    salary: "1000",
    social: "100",
    housing: "50",
    adjustment: "0",
    payrollCost: "1150",
    basic: null,
    known_basic: "20.4",
    large: "0",
    business: "10",
    overhead: "60",
    total: null,
    knownTotal: "1240.4",
    known_payrollCost: "1150",
    known_salary: "1000",
    known_social: "100",
    known_housing: "50",
    known_adjustment: "0",
  };
}
function fixture(): FinancialAnalysisModule {
  return {
    key: "personnel",
    title: "人力成本分析",
    description: "测试",
    sourceLabel: "测试",
    updatedAt: null,
    periods: ["2026-01", "2026-02", "2026-03"].map((month) => ({
      key: month,
      label: month,
      from: month,
      to: month,
    })),
    series: [],
    summaries: [],
    breakdown: [],
    comparison: [],
    warnings: [],
    appliedFilters: [],
    columns: keys.map((key) => ({
      key,
      label: key,
      format: "amount" as const,
    })),
    details: [row("jan"), row("feb", "2026-02"), row("mar", "2026-03")],
    personnelAnnualDetails: [
      {
        ...row("annual"),
        period: "2026",
        from: "2026-01",
        to: "2026-09",
        salary: "3000",
        knownTotal: "3721.2",
      },
    ],
  };
}

describe("人员分项明细与独立自然年汇总", () => {
  test("发票总额租期口径不再显示合同月费计提或按收费月归集说明", () => {
    const module = fixture();
    module.housingCostBasis = "invoice-lease";
    module.housingCostBreakdown = [
      { key: "rent", label: "租金", amount: "10", knownAmount: "10" },
    ];
    const wrapper = mount(Details, { props: { module, query } });
    expect(wrapper.text()).toContain("全部已上传并确认的有效发票");
    expect(wrapper.text()).toContain("实际租赁天数");
    expect(wrapper.text()).toContain("新上传发票会更新");
    expect(wrapper.text()).not.toContain("租金和固定物业按租期计提");
    wrapper.unmount();
  });
  test("住房全成本显示公司分摊基数，个人筛选不重复叠加或增加人员行", async () => {
    const module = fixture();
    module.housingCostBreakdown = [
      {
        key: "rent",
        label: "租金",
        amount: "167778.87",
        knownAmount: "167778.87",
      },
      {
        key: "property_management",
        label: "物业管理费",
        amount: "50388",
        knownAmount: "50388",
      },
      {
        key: "electricity",
        label: "电费",
        amount: "2714.98",
        knownAmount: "2714.98",
      },
      {
        key: "system_maintenance",
        label: "系统维护费",
        amount: "592.8",
        knownAmount: "592.8",
      },
      {
        key: "other_cost",
        label: "其他住房费用",
        amount: "0",
        knownAmount: "0",
      },
    ];
    const wrapper = mount(Details, {
      props: { module, query: { ...query, personId: "p1" } },
    });
    const summary = wrapper.find(".housing-cost-summary");
    expect(summary.text()).toContain("公司费用");
    expect(summary.text()).toContain("不与个人合计重复相加");
    expect(wrapper.text()).toContain("跨合同汇总保留旧址历史费用");
    expect(wrapper.text()).toContain("不沿用旧址收费");
    expect(summary.find(".housing-cost-total").text()).toBe(
      "费用合计：¥221,474.65",
    );
    expect(summary.findAll("dt").map((item) => item.text())).toEqual([
      "租金",
      "物业管理费",
      "电费",
      "系统维护费",
      "其他住房费用",
    ]);
    expect(wrapper.find(".personnel-cost-table thead").text()).toContain(
      "房屋租赁成本分摊",
    );
    expect(wrapper.findAll(".personnel-cost-table tbody tr")).toHaveLength(1);
    expect(wrapper.find('td[data-cost-key="total"]').text()).toContain(
      "¥3,721.20",
    );
    await wrapper.findAll(".personnel-view-tabs button")[1].trigger("click");
    expect(wrapper.findAll(".personnel-cost-table tbody tr")).toHaveLength(3);
    expect(summary.find(".housing-cost-total").text()).toContain("¥221,474.65");
    wrapper.unmount();
  });
  test("住房缺证费用保留未知并标明已知部分，不冒充完整合计", async () => {
    const module = fixture();
    module.housingCostBreakdown = [
      { key: "rent", label: "租金", amount: "10.01", knownAmount: "10.01" },
      { key: "electricity", label: "电费", amount: null, knownAmount: "0.02" },
      {
        key: "other_cost",
        label: "其他住房费用",
        amount: null,
        knownAmount: null,
      },
    ];
    const wrapper = mount(Details, { props: { module, query } });
    expect(wrapper.find(".housing-cost-total").text()).toBe(
      "已知费用合计：¥10.03",
    );
    expect(
      wrapper.findAll(".housing-cost-summary dd").map((item) => item.text()),
    ).toEqual(["¥10.01", "¥0.02已知部分", "未知／未核算"]);
    await wrapper.setProps({
      module: {
        ...module,
        housingCostBreakdown: [
          { key: "rent", label: "租金", amount: null, knownAmount: null },
        ],
      },
    });
    expect(wrapper.find(".housing-cost-total").text()).toContain(
      "未知／未核算",
    );
    expect(wrapper.find(".housing-cost-total").text()).not.toContain("¥0.00");
    wrapper.unmount();
  });
  test("报销月份口径明确展示，不把归期问题说成付款日期问题", () => {
    const module = fixture();
    module.personnelReimbursementBasis = "reimbursement-month";
    module.personnelUnassignedReimbursements = [
      {
        sourceId: "month-missing",
        type: "large",
        amount: "100",
        date: null,
        status: "approved",
        personId: "p1",
        personName: "测试人员",
        reason: "报销月份缺失或无效",
      },
    ];
    const wrapper = mount(Details, { props: { module, query } });
    expect(wrapper.text()).toContain("人力报销按系统已确认的报销月份统计");
    expect(wrapper.find(".personnel-unassigned").text()).toContain(
      "已确认但缺少有效报销月份",
    );
    expect(wrapper.find(".personnel-unassigned tbody").text()).toContain(
      "报销月份缺失或无效",
    );
    expect(wrapper.find(".personnel-unassigned").text()).not.toContain(
      "缺少有效付款日期",
    );
    wrapper.unmount();
  });
  test("未归期报销独立列出本人及无法归属记录，不混入年度金额", () => {
    const module = fixture();
    module.personnelUnassignedReimbursements = [
      {
        sourceId: "pending-1",
        type: "large",
        amount: "10800",
        date: null,
        status: "completed",
        personId: "p1",
        personName: "测试人员",
      },
      {
        sourceId: "pending-2",
        type: "basic",
        amount: "0.25",
        date: null,
        status: "paid",
        personId: null,
        personName: "人员待确认",
      },
      {
        sourceId: "pending-other",
        type: "large",
        amount: "999",
        date: null,
        status: "paid",
        personId: "p2",
        personName: "其他人员",
      },
    ];
    const wrapper = mount(Details, {
      props: { module, query: { ...query, personId: "p1" } },
    });
    expect(wrapper.findAll(".personnel-unassigned tbody tr")).toHaveLength(2);
    expect(wrapper.find(".personnel-unassigned").text()).toContain(
      "¥10,800.25",
    );
    expect(wrapper.find(".personnel-unassigned").text()).toContain(
      "没有计入月度、年度合计或饼图",
    );
    expect(wrapper.find(".personnel-unassigned tbody").text()).not.toContain(
      "其他人员",
    );
    expect(wrapper.find(".personnel-cost-table").text()).toContain("¥3,721.20");
    wrapper.unmount();
  });
  test("默认年度一人一行，不按三个期间重复累加；切换到月度显示三行", async () => {
    const wrapper = mount(Details, { props: { module: fixture(), query } });
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("¥3,721.20");
    expect(wrapper.text()).not.toContain("¥¥");
    expect(wrapper.text()).toContain("2026-01 至 2026-09");
    await wrapper.findAll(".personnel-view-tabs button")[1].trigger("click");
    expect(wrapper.findAll("tbody tr")).toHaveLength(3);
    expect(wrapper.find('td[data-cost-key="basic"]').text()).toBe(
      "¥20.40已知部分",
    );
    expect(wrapper.find('td[data-cost-key="large"]').text()).toBe("¥0.00");
    wrapper.unmount();
  });
  test("缺少年度响应不以月度行冒充年度；负数与高精度完整保留", async () => {
    const module = fixture();
    delete module.personnelAnnualDetails;
    module.details[0].salary = "123456789012345678.123456789012";
    module.details[0].adjustment = "-1.01";
    module.details[0].overhead = null;
    const wrapper = mount(Details, { props: { module, query } });
    expect(wrapper.find("table").exists()).toBe(false);
    expect(wrapper.text()).toContain("不以月度金额拼出未经核验的全年总额");
    await wrapper.findAll(".personnel-view-tabs button")[1].trigger("click");
    expect(wrapper.text()).toContain("¥123,456,789,012,345,678.123456789012");
    expect(wrapper.text()).toContain("¥-1.01");
    expect(wrapper.find('td[data-cost-key="overhead"]').text()).toBe(
      "未知／未核算",
    );
    wrapper.unmount();
  });
  test("未授权账号不能从年度行或已知字段泄漏工资分项", () => {
    const module = fixture();
    module.payrollDetailsVisible = false;
    const wrapper = mount(Details, { props: { module, query } });
    for (const key of ["salary", "social", "housing", "adjustment"])
      expect(wrapper.find(`[data-cost-key="${key}"]`).exists()).toBe(false);
    expect(wrapper.find('[data-cost-key="payrollCost"]').text()).toContain(
      "¥1,150.00",
    );
    expect(wrapper.text()).not.toContain("¥3,000.00");
    wrapper.unmount();
  });
  test("点击姓名发出真实人员编号，失活时不可选，不展示其他筛选人员", async () => {
    const module = fixture();
    module.personnelAnnualDetails!.push({
      ...row("p2"),
      personId: "p2",
      person: "其他人员",
    });
    const wrapper = mount(Details, {
      props: { module, query: { ...query, personId: "p1" } },
    });
    expect(wrapper.text()).not.toContain("其他人员");
    await wrapper.find(".personnel-name-cell button").trigger("click");
    expect(wrapper.emitted("select-person")).toEqual([["p1"]]);
    await wrapper.setProps({ active: false });
    expect(
      wrapper.find(".personnel-name-cell button").attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });
});

describe("人员饼图与明细使用同一已知分项", () => {
  test("季度混合旧冻结工资时部分拆分不得漏计工资汇总", () => {
    const module = fixture();
    module.periods = [
      {
        key: "2026-Q1",
        label: "2026年第1季度",
        from: "2026-01",
        to: "2026-03",
      },
    ];
    module.details = [
      {
        ...row("quarter"),
        period: "2026年第1季度",
        from: "2026-01",
        to: "2026-03",
        salary: null,
        social: null,
        housing: null,
        adjustment: null,
        known_salary: "2000",
        known_social: "0",
        known_housing: "0",
        known_adjustment: "0",
        payrollCost: "3200",
        known_payrollCost: "3200",
      },
    ];
    const result = buildFinancialAnalysisStructure(module, {
      ...query,
      granularity: "quarter",
      personId: "p1",
    });
    expect(
      result.items.find((item) => item.key === "payrollUnsplit")?.amount,
    ).toBe("3200");
    expect(result.items.find((item) => item.key === "salary")).toBeUndefined();
  });
  test("基础费用虽不完整仍展示有凭据部分，全部组成与已知总额精确一致", () => {
    const result = buildFinancialAnalysisStructure(fixture(), {
      ...query,
      personId: "p1",
    });
    expect(result.items.find((i) => i.key === "basic")?.amount).toBe("61.2");
    expect(result.items.find((i) => i.key === "salary")?.amount).toBe("3000");
    expect(result.items.find((i) => i.key === "payrollCost")).toBeUndefined();
    expect(result.isPartial).toBe(true);
  });
  test("工资分项未冻结时只显示整笔工资，不能与已知拆分重复相加", () => {
    const module = fixture();
    module.details = [row("jan")];
    module.details[0].social = null;
    module.details[0].known_social = null;
    const result = buildFinancialAnalysisStructure(module, {
      ...query,
      personId: "p1",
    });
    expect(result.items.find((i) => i.key === "payrollUnsplit")?.amount).toBe(
      "1150",
    );
    expect(result.items.find((i) => i.key === "salary")).toBeUndefined();
    expect(result.note).toContain("不反推社保或公积金");
  });
  test("无人员、无工资分项权限或范围外明细不能生成个人构成", () => {
    const module = fixture();
    expect(buildFinancialAnalysisStructure(module, query).items).toEqual([]);
    module.payrollDetailsVisible = false;
    expect(
      buildFinancialAnalysisStructure(module, { ...query, personId: "p1" })
        .items,
    ).toEqual([]);
    module.payrollDetailsVisible = true;
    module.details = [row("other", "2025-12")];
    expect(
      buildFinancialAnalysisStructure(module, { ...query, personId: "p1" })
        .items,
    ).toEqual([]);
  });
});
