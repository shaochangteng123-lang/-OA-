jest.mock("@/utils/api", () => ({ api: { get: jest.fn() } }));

import MonthlyFinancialProjectDrilldown from "@/components/monthly-financial/MonthlyFinancialProjectDrilldown.vue";
import MonthlyFinancialProjectReceiptDialog from "@/components/monthly-financial/MonthlyFinancialProjectReceiptDialog.vue";
import type {
  FinancialAnalysisDetail,
  FinancialAnalysisProjectReceipt,
} from "@/types/monthlyFinancialAnalysis";
import { api } from "@/utils/api";

const { mount, flushPromises } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
function row(
  id: string,
  received: string | null,
  region: string | null = "海淀区",
): FinancialAnalysisDetail {
  return {
    id,
    sourceId: id,
    project: "合成项目" + id,
    partyA: "合成甲方",
    region,
    received,
    contract: "1",
    outstanding: "0",
    sourceState: "期末累计合成数据",
  };
}
function render(rows: FinancialAnalysisDetail[], total: string | null = "0.3") {
  return mount(MonthlyFinancialProjectDrilldown, {
    props: {
      rows,
      title: "期末项目回款明细",
      scopeLabel: "2026年第1季度 · 截至2026-03",
      total,
    },
  });
}
function periodRow(
  id: string,
  amount: string | null,
  region: string | null = "海淀区",
): FinancialAnalysisDetail {
  return { ...row(id, "1000", region), periodReceived: amount };
}
function renderPeriod(
  rows: FinancialAnalysisDetail[],
  total: string | null = "0.3",
) {
  return mount(MonthlyFinancialProjectDrilldown, {
    props: {
      rows,
      title: "本月各项目回款",
      scopeLabel: "2026-03",
      total,
      mode: "period",
      periodLabel: "本月回款",
    },
  });
}
function evidence(
  id: string,
  changes: Partial<FinancialAnalysisProjectReceipt> = {},
): FinancialAnalysisProjectReceipt {
  return {
    rootContractId: "root-a",
    receiptId: id,
    periodKey: "2026-03",
    from: "2026-03",
    to: "2026-03",
    projectNumber: "原件项目编号-001",
    projectNumberSource: "business_contract_no",
    receiptDate: "2026-03-12",
    amount: "0.1",
    receiptNumber: "银行回单号-001",
    receiptNumberSource: "electronic_receipt_no",
    transactionSerialNo: null,
    bankName: "测试银行",
    fileName: null,
    mimeType: null,
    previewUrl: null,
    previewUnavailableReason: "未提供回单文件",
    ...changes,
  };
}
function identifiedRow(
  id: string,
  changes: Partial<FinancialAnalysisDetail> = {},
): FinancialAnalysisDetail {
  return {
    ...periodRow(id, "0.1"),
    periodKey: "2026-03",
    from: "2026-03",
    to: "2026-03",
    projectNumber: "原件项目编号-001",
    projectNumberSource: "business_contract_no",
    ...changes,
  };
}

describe("项目按行政区下钻展示", () => {
  beforeEach(() => jest.mocked(api.get).mockReset());

  it("区域默认展开并精确显示项目及地区小计，已回款优先突出", () => {
    const wrapper = render([row("a", "0.1"), row("b", "0.2")]);
    expect(wrapper.get(".project-region").attributes()).toHaveProperty("open");
    expect(wrapper.get(".project-region-name").text()).toContain("海淀区");
    expect(wrapper.get(".project-region-received strong").text()).toBe("¥0.30");
    expect(wrapper.get('[data-subtotal="contract"]').text()).toBe("¥2.00");
    expect(wrapper.findAll(".project-detail")).toHaveLength(2);
    expect(
      wrapper.findAll(".project-received dd").map((cell) => cell.text()),
    ).toEqual(["¥0.10", "¥0.20"]);
    expect(wrapper.get(".project-amounts > div").classes()).toContain(
      "is-highlight",
    );
    expect(
      wrapper
        .get(".project-amounts")
        .findAll("[data-metric]")
        .map((card) => card.attributes("data-metric")),
    ).toEqual(["received", "contract", "outstanding"]);
    expect(wrapper.find(".project-bank-receipt-link").exists()).toBe(false);
    expect(wrapper.get(".project-contract-number").text()).toBe(
      "合同编号：未提供",
    );
    expect(wrapper.get(".project-source-state").text()).toBe(
      "期末累计合成数据",
    );
    wrapper.unmount();
  });

  it("累计已回款显示原件合同编号，不把内部来源编号改名展示", () => {
    const detail = identifiedRow("-huPddaHj0wsHC7oUByYO", {
      project: "合成合同编号核对项目",
      projectNumber: "  合同原件-2026-001  ",
    });
    const before = JSON.stringify(detail);
    const wrapper = render([detail]);
    expect(wrapper.get(".project-contract-number").text()).toBe(
      "合同编号：合同原件-2026-001",
    );
    expect(wrapper.find(".project-source-id").exists()).toBe(false);
    expect(wrapper.find(".project-number").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("来源编号：");
    expect(wrapper.text()).not.toContain("-huPddaHj0wsHC7oUByYO");
    expect(wrapper.find(".project-bank-receipt-link").exists()).toBe(false);
    expect(JSON.stringify(detail)).toBe(before);
    wrapper.unmount();
  });

  it.each([null, undefined, "   "])(
    "累计合同编号缺失或空白时保留未提供，不借内部来源补号：%s",
    (projectNumber) => {
      const wrapper = render([
        identifiedRow("internal-contract-id", {
          project: "合成无编号项目",
          projectNumber,
          contractNo: "HT-2026-009",
        }),
      ]);
      expect(wrapper.get(".project-contract-number").text()).toBe(
        "合同编号：未提供",
      );
      expect(wrapper.text()).not.toContain("internal-contract-id");
      expect(wrapper.text()).not.toContain("HT-2026-009");
      wrapper.unmount();
    },
  );

  it("累计重复来源的合同编号冲突时不任意选择其中一个", () => {
    const detail = identifiedRow("same-contract", {
      project: "合成编号冲突项目",
      projectNumber: "合同原件-001",
    });
    const wrapper = render([
      detail,
      { ...detail, id: "copy", projectNumber: "合同原件-002" },
    ]);
    expect(wrapper.findAll(".project-detail")).toHaveLength(1);
    expect(wrapper.get(".project-contract-number").text()).toBe(
      "合同编号：未提供",
    );
    expect(wrapper.text()).not.toContain("合同原件-001");
    expect(wrapper.text()).not.toContain("合同原件-002");
    wrapper.unmount();
  });

  it("未知行政区单独归组、未知金额不变零且影响完整小计", () => {
    const wrapper = render([
      row("a", null),
      row("b", "0.2"),
      row("c", "0", null),
    ]);
    expect(wrapper.findAll(".project-region")).toHaveLength(2);
    expect(
      wrapper
        .get(
          '.project-region[data-region="海淀区"] .project-region-received strong',
        )
        .text(),
    ).toBe("未知");
    expect(
      wrapper
        .get('.project-region[data-region="未标注行政区"] .project-received dd')
        .text(),
    ).toBe("¥0.00");
    expect(
      wrapper
        .get('.project-detail[data-source-id="a"] .project-received dd')
        .text(),
    ).toBe("未知");
    wrapper.unmount();
  });

  it("同来源重复不双算且不修改传入记录，权威总额不会被局部小计替换", () => {
    const original = row("same", "0.1");
    const rows = [original, { ...original, id: "repeat" }, row("b", "0.2")];
    const before = JSON.stringify(rows);
    const wrapper = render(rows, "999");
    expect(wrapper.findAll(".project-detail")).toHaveLength(2);
    expect(wrapper.get(".project-region-received strong").text()).toBe("¥0.30");
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe(
      "¥999.00",
    );
    expect(wrapper.get(".project-drilldown-warning").text()).toContain(
      "重复项目已去重",
    );
    expect(JSON.stringify(rows)).toBe(before);
    wrapper.unmount();
  });

  it("累计模式的全零项目仍展示，不受期间正回款筛选影响", () => {
    const wrapper = render([row("zero", "0")], "0");
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe("¥0.00");
    expect(wrapper.findAll(".project-detail")).toHaveLength(1);
    expect(wrapper.get(".project-received dd").text()).toBe("¥0.00");
    expect(wrapper.find(".project-drilldown-empty").exists()).toBe(false);
    wrapper.unmount();
  });

  it("无期间明细显示明确空态与未知总额，不暗示实际零项目", () => {
    const wrapper = render([], null);
    expect(wrapper.findAll(".project-region")).toHaveLength(0);
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe("未知");
    expect(wrapper.get(".project-drilldown-empty").text()).toContain(
      "不使用其他期间记录代替",
    );
    wrapper.unmount();
  });

  it("大额和长中文项目、负未回款完整显示，切期间重新展开新的区域", async () => {
    const amount = "123456789012345678.123456789012";
    const detail = {
      ...row("long", amount),
      project: "合成超长中文项目名称用于验证窄屏仍然完整可读",
      outstanding: "-2053235.4",
    };
    const wrapper = render([detail], amount);
    expect(wrapper.get(".project-received dd").text()).toBe(
      "¥123,456,789,012,345,678.123456789012",
    );
    expect(wrapper.get(".project-outstanding dd").text()).toBe(
      "¥-2,053,235.40",
    );
    expect(wrapper.get(".project-name").text()).toBe(detail.project);
    (wrapper.get(".project-region").element as HTMLDetailsElement).open = false;
    await wrapper.setProps({
      scopeLabel: "2026年第2季度",
      rows: [row("new", "0")],
    });
    expect(
      (wrapper.get(".project-region").element as HTMLDetailsElement).open,
    ).toBe(true);
    expect(wrapper.get(".project-drilldown-scope").text()).toBe(
      "2026年第2季度",
    );
    wrapper.unmount();
  });

  it("本月模式按期间回款、合同金额、累计已回款、未回款顺序展示四卡，仅期间回款高亮", () => {
    const rows = [
      { ...row("a", "999"), periodReceived: "0.1" },
      { ...row("b", "888"), periodReceived: "0.2" },
    ];
    const wrapper = mount(MonthlyFinancialProjectDrilldown, {
      props: {
        rows,
        title: "本月各项目回款",
        scopeLabel: "2026年02月",
        total: "0.3",
        mode: "period",
        periodLabel: "本月回款",
      },
    });
    expect(wrapper.attributes("data-mode")).toBe("period");
    expect(wrapper.attributes("data-metric")).toBe("periodReceived");
    expect(wrapper.get(".project-drilldown-total-label").text()).toBe(
      "本月回款",
    );
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe("¥0.30");
    expect(wrapper.get(".project-region-period-received").text()).toContain(
      "本月回款小计",
    );
    expect(wrapper.get(".project-region-period-received strong").text()).toBe(
      "¥0.30",
    );
    expect(
      wrapper.findAll(".project-period-received dd").map((cell) => cell.text()),
    ).toEqual(["¥0.10", "¥0.20"]);
    const firstCards = wrapper.get(".project-amounts").findAll("[data-metric]");
    expect(firstCards.map((card) => card.attributes("data-metric"))).toEqual([
      "periodReceived",
      "contract",
      "received",
      "outstanding",
    ]);
    expect(firstCards.map((card) => card.get("dd").text())).toEqual([
      "¥0.10",
      "¥1.00",
      "¥999.00",
      "¥0.00",
    ]);
    expect(
      firstCards.filter((card) => card.classes().includes("is-highlight")),
    ).toHaveLength(1);
    expect(firstCards[0].classes()).toContain("project-period-received");
    expect(wrapper.get(".project-received").classes()).not.toContain(
      "is-highlight",
    );
    expect(wrapper.get('[data-subtotal="contract"]').text()).toBe("¥2.00");
    expect(wrapper.get('[data-subtotal="received"]').text()).toBe("¥1,887.00");
    expect(wrapper.get('[data-subtotal="outstanding"]').text()).toBe("¥0.00");
    expect(wrapper.get(".project-amounts").classes()).toContain(
      "is-period-mode",
    );
    expect(
      wrapper.findAll(".project-received dd").map((card) => card.text()),
    ).toEqual(["¥999.00", "¥888.00"]);
    wrapper.unmount();
  });

  it("本期四卡各自保留高精度、真实零及未知，不用期间金额补齐存量", () => {
    const wrapper = renderPeriod([
      {
        ...periodRow("precise", "123456789012345678.123456789012"),
        contract: "223456789012345678.123456789012",
        received: "2053235.4",
        outstanding: "-0.000000000001",
      },
      {
        ...periodRow("zero-stock", "0.1"),
        contract: "0",
        received: "0",
        outstanding: null,
      },
    ]);
    expect(
      wrapper
        .get('[data-source-id="precise"] .project-amounts')
        .findAll("dd")
        .map((card) => card.text()),
    ).toEqual([
      "¥123,456,789,012,345,678.123456789012",
      "¥223,456,789,012,345,678.123456789012",
      "¥2,053,235.40",
      "¥-0.000000000001",
    ]);
    expect(
      wrapper
        .get('[data-source-id="zero-stock"] .project-amounts')
        .findAll("dd")
        .map((card) => card.text()),
    ).toEqual(["¥0.10", "¥0.00", "¥0.00", "未知"]);
    wrapper.unmount();
  });

  it("本期模式缺字段和零值不显示，累计已知不补期间金额，权威总额保留", () => {
    const wrapper = mount(MonthlyFinancialProjectDrilldown, {
      props: {
        rows: [
          row("missing", "1000"),
          { ...row("zero", "2000"), periodReceived: "0" },
        ],
        title: "本期回款",
        scopeLabel: "2026年第1季度",
        total: "9",
        mode: "period",
      },
    });
    expect(wrapper.get(".project-drilldown-total-label").text()).toBe(
      "本期回款",
    );
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe("¥9.00");
    expect(wrapper.findAll(".project-detail")).toHaveLength(0);
    expect(wrapper.findAll(".project-region")).toHaveLength(0);
    expect(wrapper.find(".project-drilldown-empty").exists()).toBe(true);
    expect(wrapper.text()).toContain("未知");
    expect(wrapper.get(".project-drilldown-empty").text()).not.toContain(
      "没有回款",
    );
    wrapper.unmount();
  });

  it("本期同名跨区保持独立，来源去重且精确金额不被累计大额影响", () => {
    const amount = "123456789012345678.123456789012";
    const first = {
      ...row("a", "99999"),
      project: "同名项目",
      periodReceived: amount,
    };
    const second = {
      ...row("b", "88888", "朝阳区"),
      project: "同名项目",
      periodReceived: "0.000000000001",
    };
    const wrapper = mount(MonthlyFinancialProjectDrilldown, {
      props: {
        rows: [first, { ...first, id: "duplicate" }, second],
        title: "本年回款",
        scopeLabel: "2026年",
        total: amount,
        mode: "period",
        periodLabel: "本年回款",
      },
    });
    expect(wrapper.findAll(".project-region")).toHaveLength(2);
    expect(wrapper.findAll(".project-detail")).toHaveLength(2);
    expect(
      wrapper
        .get(
          '.project-region[data-region="海淀区"] .project-period-received dd',
        )
        .text(),
    ).toBe("¥123,456,789,012,345,678.123456789012");
    expect(
      wrapper
        .get(
          '.project-region[data-region="朝阳区"] .project-period-received dd',
        )
        .text(),
    ).toBe("¥0.000000000001");
    expect(wrapper.get(".project-drilldown-warning").text()).toContain(
      "重复项目已去重",
    );
    expect(wrapper.get(".project-drilldown-total-label").text()).toBe(
      "本年回款",
    );
    wrapper.unmount();
  });

  it("本期重复来源金额冲突保持未知，而不影响独立累计口径", async () => {
    const rows = [
      { ...row("same", "100"), periodReceived: "0.1" },
      { ...row("same", "100"), id: "duplicate", periodReceived: "0.2" },
    ];
    const wrapper = mount(MonthlyFinancialProjectDrilldown, {
      props: {
        rows,
        title: "两种口径",
        scopeLabel: "所选期间",
        total: null,
        mode: "period",
      },
    });
    expect(wrapper.findAll(".project-detail")).toHaveLength(0);
    expect(wrapper.findAll(".project-region")).toHaveLength(0);
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe("未知");
    expect(wrapper.text()).toContain("冲突");
    expect(wrapper.get(".project-drilldown-empty").text()).not.toContain(
      "没有回款",
    );
    await wrapper.setProps({ mode: "cumulative", total: "100" });
    expect(wrapper.get(".project-drilldown-total-label").text()).toBe(
      "期末累计已回款",
    );
    expect(wrapper.get(".project-received dd").text()).toBe("¥100.00");
    expect(wrapper.find(".project-contract").exists()).toBe(true);
    expect(wrapper.find(".project-outstanding").exists()).toBe(true);
    expect(wrapper.find(".project-period-received").exists()).toBe(false);
    wrapper.unmount();
  });

  it("期间流量行保留独立来源说明，内部回款记录编号不冒充银行回单号", async () => {
    const rows = [
      {
        ...row("stock", "100"),
        detailKind: "project_period",
        periodReceived: "0.2",
        periodReceivedSourceState: "本月已确认且未冲正回款",
        periodReceivedSourceIds: "receipt-stock",
      },
      {
        ...row("flow", null),
        detailKind: "period_receipt_only",
        contract: null,
        outstanding: null,
        periodReceived: "0.3",
        sourceState: "不得显示的期末重建措辞",
        periodReceivedSourceState: "签约前预收按回款业务日期归期",
        periodReceivedSourceIds: "receipt-a、receipt-b",
      },
    ];
    const wrapper = mount(MonthlyFinancialProjectDrilldown, {
      props: {
        rows,
        title: "本月项目回款",
        scopeLabel: "2026年02月",
        total: "0.5",
        mode: "period",
        periodLabel: "本月回款",
      },
    });
    expect(wrapper.findAll(".project-detail")).toHaveLength(2);
    expect(
      wrapper
        .get('.project-detail[data-source-id="flow"] .project-source-state')
        .text(),
    ).toBe("签约前预收按回款业务日期归期");
    expect(
      wrapper
        .get(
          '.project-detail[data-source-id="flow"] .project-bank-receipt-numbers',
        )
        .text(),
    ).toBe("银行回单号：未提供");
    expect(wrapper.text()).not.toContain("receipt-a");
    expect(wrapper.text()).not.toContain("receipt-stock");
    expect(wrapper.text()).not.toContain("不得显示的期末重建措辞");
    expect(
      wrapper
        .get('[data-source-id="flow"] .project-amounts')
        .findAll("dd")
        .map((card) => card.text()),
    ).toEqual(["¥0.30", "未知", "未知", "未知"]);
    expect(wrapper.get('[data-subtotal="contract"]').text()).toBe("未知");
    expect(wrapper.get('[data-subtotal="received"]').text()).toBe("未知");
    expect(wrapper.get('[data-subtotal="outstanding"]').text()).toBe("未知");
    expect(wrapper.get(".project-region-received strong").text()).toBe("¥0.50");
    await wrapper.setProps({ mode: "cumulative", total: "100" });
    expect(wrapper.findAll(".project-detail")).toHaveLength(1);
    expect(wrapper.get(".project-region-received strong").text()).toBe(
      "¥100.00",
    );
    expect(wrapper.find(".project-drilldown-warning").exists()).toBe(false);
    expect(wrapper.find(".project-period-source-ids").exists()).toBe(false);
    expect(wrapper.find(".project-receipt-preview").exists()).toBe(false);
    wrapper.unmount();
  });

  it("本期只展示精确正金额项目和非空行政区，极小值大额及显式正号不被过滤", async () => {
    const tiny = "0.000000000000000000000001";
    const large = "123456789012345678901234567890.123456789012345678";
    const rows = [
      periodRow("positive", "0.1", "海淀区"),
      periodRow("tiny", tiny, "朝阳区"),
      periodRow("large", large, "丰台区"),
      periodRow("plus", "+000.010", "海淀区"),
      ...["0", "-0", "+0", "0.00", "-0.000", "00.00", "+000.000"].map(
        (amount, index) => ({
          ...periodRow("zero-" + index, amount, "仅零区"),
          received: "0",
        }),
      ),
      { ...periodRow("unknown", null, "未知区"), received: null },
      { ...periodRow("negative", "-0.25", "负向区"), received: "-20" },
    ];
    const before = JSON.stringify(rows);
    const wrapper = renderPeriod(rows, "9.500000000001");
    expect(
      wrapper
        .findAll(".project-detail")
        .map((detail) => detail.attributes("data-source-id"))
        .sort(),
    ).toEqual(["large", "plus", "positive", "tiny"]);
    expect(
      wrapper
        .findAll(".project-region")
        .map((region) => region.attributes("data-region")),
    ).toEqual(["海淀区", "朝阳区", "丰台区"]);
    expect(
      wrapper.get('[data-source-id="tiny"] .project-period-received dd').text(),
    ).toBe("¥" + tiny);
    expect(
      wrapper
        .get('[data-source-id="large"] .project-period-received dd')
        .text(),
    ).toBe("¥123,456,789,012,345,678,901,234,567,890.123456789012345678");
    expect(
      wrapper.get('[data-source-id="plus"] .project-period-received dd').text(),
    ).toBe("¥+000.010");
    expect(
      wrapper
        .get('[data-region="海淀区"] .project-region-received strong')
        .text(),
    ).toBe("¥0.11");
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe(
      "¥9.500000000001",
    );
    expect(wrapper.get(".project-period-exclusions").text()).toContain("未知");
    expect(wrapper.get(".project-period-exclusions").text()).toContain("负");
    expect(wrapper.text()).not.toContain("重复项目已去重");
    expect(JSON.stringify(rows)).toBe(before);
    await wrapper.setProps({ mode: "cumulative" });
    expect(wrapper.findAll(".project-detail")).toHaveLength(rows.length);
    expect(
      wrapper.get('[data-source-id="zero-0"] .project-received dd').text(),
    ).toBe("¥0.00");
    expect(
      wrapper.get('[data-source-id="unknown"] .project-received dd').text(),
    ).toBe("未知");
    expect(
      wrapper.get('[data-source-id="negative"] .project-received dd').text(),
    ).toBe("¥-20.00");
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe(
      "¥9.500000000001",
    );
    expect(wrapper.find(".project-period-exclusions").exists()).toBe(false);
    expect(JSON.stringify(rows)).toBe(before);
    wrapper.unmount();
  });

  it("本期全零点保留权威零总额，但项目和行政区都为空且不误报重复去重", () => {
    const rows = ["0", "-0", "+0", "0.00", "-0.0000", "+000.000", "00.00"].map(
      (amount, index) => periodRow("zero-" + index, amount, "区域" + index),
    );
    const wrapper = renderPeriod(rows, "0");
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe("¥0.00");
    expect(wrapper.findAll(".project-detail")).toHaveLength(0);
    expect(wrapper.findAll(".project-region")).toHaveLength(0);
    expect(wrapper.get(".project-drilldown-empty").text()).toContain(
      "暂无可展示的正向回款项目",
    );
    expect(wrapper.text()).not.toContain("重复项目已去重");
    wrapper.unmount();
  });

  it("小于浮点最小正数的精确回款仍保留，不因数值转换下溢被当零隐藏", () => {
    const tiny = "0." + "0".repeat(399) + "1";
    const wrapper = renderPeriod([periodRow("underflow", tiny)], tiny);
    expect(wrapper.findAll(".project-detail")).toHaveLength(1);
    expect(wrapper.get(".project-detail").attributes("data-source-id")).toBe(
      "underflow",
    );
    expect(wrapper.get(".project-period-received dd").text()).toBe("¥" + tiny);
    expect(wrapper.get(".project-region-received strong").text()).toBe(
      "¥" + tiny,
    );
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe(
      "¥" + tiny,
    );
    expect(wrapper.find(".project-drilldown-empty").exists()).toBe(false);
    wrapper.unmount();
  });

  it("全部未知或缺失本期字段只显示待核对提示，不把空明细解释成整期无回款", () => {
    const wrapper = renderPeriod(
      [
        periodRow("unknown", null),
        row("missing", "1000"),
        periodRow("invalid", "待核算"),
      ],
      null,
    );
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe("未知");
    expect(wrapper.findAll(".project-detail")).toHaveLength(0);
    expect(wrapper.findAll(".project-region")).toHaveLength(0);
    expect(wrapper.get(".project-period-exclusions").text()).toContain("未知");
    expect(wrapper.get(".project-drilldown-empty").text()).toContain(
      "暂无可展示的正向回款项目",
    );
    expect(wrapper.get(".project-drilldown-empty").text()).not.toContain(
      "没有回款",
    );
    expect(wrapper.get(".project-drilldown-empty").text()).not.toContain(
      "无回款",
    );
    wrapper.unmount();
  });

  it("负向记录不冒充正向回款项目，权威负总额仍完整保留", () => {
    const wrapper = renderPeriod(
      [
        periodRow("negative-a", "-0.1"),
        periodRow("negative-b", "-0.3", "朝阳区"),
      ],
      "-0.4",
    );
    expect(wrapper.findAll(".project-detail")).toHaveLength(0);
    expect(wrapper.findAll(".project-region")).toHaveLength(0);
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe(
      "¥-0.40",
    );
    expect(wrapper.get(".project-period-exclusions").text()).toContain("负");
    expect(wrapper.get(".project-drilldown-empty").text()).toContain(
      "正向回款",
    );
    wrapper.unmount();
  });

  it.each(
    (
      [
        ["0", "0.1"],
        ["-0", "0.1"],
        ["0.00", "0.1"],
        [null, "0.1"],
        ["-0.1", "0.1"],
        ["0.1", "0.2"],
      ] as Array<[string | null, string | null]>
    ).flatMap(([first, second]) => [
      { first, second, order: "正序" },
      { first: second, second: first, order: "反序" },
    ]),
  )(
    "同来源$first与$second冲突（$order）先去重再过滤，不能留下正值洗白冲突",
    ({ first, second }) => {
      const rows = [
        periodRow("conflict", first, "冲突区"),
        { ...periodRow("conflict", second, "冲突区"), id: "duplicate" },
        periodRow("independent", "1.25", "独立区"),
      ];
      const before = JSON.stringify(rows);
      const wrapper = renderPeriod(rows, null);
      expect(wrapper.findAll(".project-detail")).toHaveLength(1);
      expect(wrapper.get(".project-detail").attributes("data-source-id")).toBe(
        "independent",
      );
      expect(wrapper.find('[data-region="冲突区"]').exists()).toBe(false);
      expect(wrapper.get(".project-region-received strong").text()).toBe(
        "¥1.25",
      );
      expect(wrapper.get(".project-drilldown-total-amount").text()).toBe(
        "未知",
      );
      expect(wrapper.get(".project-drilldown-warning").text()).toContain(
        "冲突",
      );
      expect(wrapper.get(".project-period-exclusions").text()).toContain(
        "未知",
      );
      expect(JSON.stringify(rows)).toBe(before);
      wrapper.unmount();
    },
  );

  it("同来源等值的正金额仅合并一次，不因表示精度或正号不同误判冲突", () => {
    const first = periodRow("same", "0.100");
    const wrapper = renderPeriod(
      [first, { ...first, id: "copy", periodReceived: "+000.1000" }],
      "0.1",
    );
    expect(wrapper.findAll(".project-detail")).toHaveLength(1);
    expect(wrapper.get(".project-period-received dd").text()).toBe("¥0.100");
    expect(wrapper.get(".project-region-received strong").text()).toBe("¥0.10");
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe("¥0.10");
    expect(wrapper.get(".project-drilldown-warning").text()).toContain(
      "重复项目已去重",
    );
    expect(wrapper.find(".project-period-exclusions").exists()).toBe(false);
    wrapper.unmount();
  });

  it("期间项目行只展示真实项目编号和银行回单号，默认仅文字入口而无常驻预览或文件请求", () => {
    const rows = [
      identifiedRow("root-a", {
        periodReceivedSourceIds: "内部回款记录UUID-a",
      }),
      identifiedRow("root-b", { projectNumber: "原件项目编号-002" }),
    ];
    const receipts = [
      evidence("internal-receipt-a"),
      evidence("internal-receipt-b", {
        rootContractId: "root-b",
        projectNumber: "原件项目编号-002",
        receiptNumber: "银行回单号-002",
      }),
      evidence("other-month", {
        periodKey: "2026-02",
        from: "2026-02",
        to: "2026-02",
        receiptDate: "2026-02-12",
        receiptNumber: "其他月份银行号",
      }),
      evidence("other-project", {
        rootContractId: "root-c",
        receiptNumber: "其他项目银行号",
      }),
    ];
    const wrapper = mount(MonthlyFinancialProjectDrilldown, {
      props: {
        rows,
        receipts,
        title: "本月回款",
        scopeLabel: "2026-03",
        total: "0.2",
        mode: "period",
      },
    });
    const first = wrapper.get('[data-source-id="root-a"]');
    const second = wrapper.get('[data-source-id="root-b"]');
    expect(first.get(".project-number").text()).toBe(
      "项目编号：原件项目编号-001",
    );
    expect(first.get(".project-bank-receipt-numbers").text()).toBe(
      "银行回单号：银行回单号-001",
    );
    expect(second.get(".project-number").text()).toBe(
      "项目编号：原件项目编号-002",
    );
    expect(second.get(".project-bank-receipt-numbers").text()).toBe(
      "银行回单号：银行回单号-002",
    );
    expect(first.get(".project-detail-layout").classes()).not.toContain(
      "is-period-mode",
    );
    expect(wrapper.find(".project-receipt-preview").exists()).toBe(false);
    expect(
      wrapper.findComponent(MonthlyFinancialProjectReceiptDialog).exists(),
    ).toBe(false);
    expect(
      wrapper
        .findAll(".project-bank-receipt-link")
        .map((button) => button.text()),
    ).toEqual(["银行回单预览", "银行回单预览"]);
    expect(wrapper.text()).not.toContain("其他月份银行号");
    expect(wrapper.text()).not.toContain("其他项目银行号");
    expect(wrapper.text()).not.toContain("内部回款记录UUID-a");
    expect(wrapper.text()).not.toContain("internal-receipt-a");
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe("¥0.20");
    expect(api.get).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("原件项目号与银行票面号缺失时显示未提供，不用内部号、HT号或银行流水补名", async () => {
    const detail = identifiedRow("uuid-project-internal", {
      project: "合成编号核对项目",
      projectNumber: null,
      projectNumberSource: "未提供",
      contractNo: "HT-2026-009",
      periodReceivedSourceIds: "receipt-internal-id",
    });
    const wrapper = mount(MonthlyFinancialProjectDrilldown, {
      props: {
        rows: [detail],
        receipts: [
          evidence("receipt-internal-id", {
            rootContractId: detail.sourceId!,
            receiptNumber: null,
            receiptNumberSource: null,
            transactionSerialNo: "真实流水-007",
          }),
        ],
        title: "本月回款",
        scopeLabel: "2026-03",
        total: "0.1",
        mode: "period",
      },
    });
    expect(wrapper.get(".project-number").text()).toBe("项目编号：未提供");
    expect(wrapper.get(".project-bank-receipt-numbers").text()).toBe(
      "银行回单号：未提供",
    );
    expect(wrapper.get(".project-bank-transaction-serials").text()).toBe(
      "银行流水号：真实流水-007",
    );
    expect(wrapper.text()).not.toContain("银行回单号：真实流水-007");
    expect(wrapper.text()).not.toContain("uuid-project-internal");
    expect(wrapper.text()).not.toContain("receipt-internal-id");
    expect(wrapper.text()).not.toContain("HT-2026-009");
    await wrapper.setProps({ mode: "cumulative" });
    expect(wrapper.get(".project-contract-number").text()).toBe(
      "合同编号：未提供",
    );
    expect(wrapper.text()).not.toContain("uuid-project-internal");
    expect(wrapper.text()).not.toContain("HT-2026-009");
    expect(wrapper.find(".project-receipt-preview").exists()).toBe(false);
    expect(wrapper.find(".project-bank-receipt-numbers").exists()).toBe(false);
    expect(wrapper.find(".project-bank-receipt-link").exists()).toBe(false);
    wrapper.unmount();
  });

  it("同项目重复业务号或同回单号证据冲突时不任意展示第一份编号", async () => {
    const first = identifiedRow("root-a");
    const wrapper = mount(MonthlyFinancialProjectDrilldown, {
      props: {
        rows: [
          first,
          { ...first, id: "row-copy", projectNumber: "冲突项目编号" },
        ],
        receipts: [
          evidence("same"),
          evidence("same", { receiptNumber: "冲突银行号" }),
        ],
        title: "本月回款",
        scopeLabel: "2026-03",
        total: "0.1",
        mode: "period",
      },
    });
    expect(wrapper.findAll(".project-detail")).toHaveLength(1);
    expect(wrapper.get(".project-number").text()).toBe("项目编号：未提供");
    expect(wrapper.get(".project-bank-receipt-numbers").text()).toBe(
      "银行回单号：未提供",
    );
    expect(wrapper.find(".project-receipt-preview").exists()).toBe(false);
    await wrapper.get(".project-bank-receipt-link").trigger("click");
    await flushPromises();
    expect(
      document.querySelector(
        "[data-financial-receipt-dialog] .receipt-preview-state",
      )?.textContent,
    ).toContain("冲突");
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe("¥0.10");
    expect(api.get).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("项目文字入口按需打开银行回单弹窗", () => {
  const mounted: Array<{ unmount: () => void }> = [];
  const hosts: HTMLElement[] = [];
  const originalCreate = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  const originalRevoke = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL",
  );
  const originalObserver = Object.getOwnPropertyDescriptor(
    globalThis,
    "IntersectionObserver",
  );
  let previousOverflow = "";
  beforeEach(() => {
    jest.mocked(api.get).mockReset();
    previousOverflow = document.body.style.overflow;
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:合成回单"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    jest.mocked(api.get).mockResolvedValue({
      data: new Blob(["合成回单"], { type: "image/png" }),
      headers: { "content-type": "image/png" },
    });
  });
  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    hosts.splice(0).forEach((host) => host.remove());
    document.body.style.overflow = previousOverflow;
    for (const [owner, key, descriptor] of [
      [URL, "createObjectURL", originalCreate],
      [URL, "revokeObjectURL", originalRevoke],
      [globalThis, "IntersectionObserver", originalObserver],
    ] as const) {
      if (descriptor) Object.defineProperty(owner, key, descriptor);
      else Reflect.deleteProperty(owner, key);
    }
  });
  function dialogFixture(options: { month?: string; noFile?: boolean } = {}) {
    const month = options.month || "2026-03";
    const detail = identifiedRow("root-a", {
      project: "合成回单项目",
      periodKey: month,
      from: month,
      to: month,
    });
    const file = evidence("receipt-a", {
      periodKey: month,
      from: month,
      to: month,
      receiptDate: month + "-12",
      ...(options.noFile
        ? {}
        : {
            fileName: "合成回单.png",
            mimeType: "image/png",
            previewUnavailableReason: null,
            previewUrl:
              "/api/monthly-financial-reports/analysis/projects/root-a/receipts/receipt-a/preview?from=" +
              month +
              "&to=" +
              month +
              "&evidenceVersion=" +
              "a".repeat(64),
          }),
    });
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const wrapper = mount(MonthlyFinancialProjectDrilldown, {
      attachTo: host,
      props: {
        rows: [detail],
        receipts: [file],
        title: "本月各项目回款",
        scopeLabel: month,
        total: "0.1",
        mode: "period",
        periodLabel: "本月回款",
        dialogAppendTo: host,
      },
    });
    mounted.push(wrapper);
    return { wrapper, host, file, detail };
  }

  it("未打开不挂载不请求，点击唯一文字入口传递精确期间，关闭后卸载并清理文件", async () => {
    const { wrapper, host, file } = dialogFixture();
    const trigger = wrapper.get(
      ".project-bank-receipt-link.project-receipt-trigger",
    );
    expect(trigger.text()).toBe("银行回单预览");
    expect(
      wrapper.findComponent(MonthlyFinancialProjectReceiptDialog).exists(),
    ).toBe(false);
    expect(document.querySelector(".project-receipt-preview")).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
    await trigger.trigger("click");
    await flushPromises();
    const dialog = wrapper.getComponent(MonthlyFinancialProjectReceiptDialog);
    expect(dialog.props()).toMatchObject({
      visible: true,
      rootContractId: "root-a",
      periodKey: "2026-03",
      from: "2026-03",
      to: "2026-03",
      projectName: "合成回单项目",
      receipts: [file],
    });
    expect(dialog.props("appendTo")).toBe(host);
    expect(dialog.props("returnFocus")).toBe(trigger.element);
    expect(
      host
        .querySelector("[data-financial-receipt-dialog] .receipt-preview-image")
        ?.getAttribute("src"),
    ).toBe("blob:合成回单");
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("receipt-dialog-change")).toContainEqual([true]);
    host
      .querySelector<HTMLButtonElement>('[aria-label="关闭银行回单预览"]')!
      .click();
    await flushPromises();
    expect(
      wrapper.findComponent(MonthlyFinancialProjectReceiptDialog).exists(),
    ).toBe(false);
    expect(host.querySelector(".project-receipt-preview")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:合成回单");
    expect(wrapper.emitted("receipt-dialog-change")).toContainEqual([false]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("未提供文件仍允许文字打开明确空态，不产生请求", async () => {
    const { wrapper, host } = dialogFixture({ noFile: true });
    await wrapper.get(".project-bank-receipt-link").trigger("click");
    await flushPromises();
    expect(
      host.querySelector("[data-financial-receipt-dialog]"),
    ).not.toBeNull();
    expect(host.querySelector(".receipt-preview-state")?.textContent).toContain(
      "未提供回单文件",
    );
    expect(host.querySelector("img, iframe")).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("同期期间回款同样允许预览，使用真实历史月份而非当前月份", async () => {
    const { wrapper, file } = dialogFixture({ month: "2025-03" });
    await wrapper.get(".project-bank-receipt-link").trigger("click");
    await flushPromises();
    expect(
      wrapper.getComponent(MonthlyFinancialProjectReceiptDialog).props(),
    ).toMatchObject({
      periodKey: "2025-03",
      from: "2025-03",
      to: "2025-03",
      receipts: [file],
    });
    expect(api.get).toHaveBeenCalledWith(
      file.previewUrl,
      expect.objectContaining({ responseType: "blob" }),
    );
  });

  it.each(["失活", "切累计", "切期间", "正项目消失"])(
    "%s后关闭弹窗，恢复数据不会自动重开",
    async (reason) => {
      const { wrapper, host, detail } = dialogFixture();
      await wrapper.get(".project-bank-receipt-link").trigger("click");
      await flushPromises();
      expect(
        host.querySelector("[data-financial-receipt-dialog]"),
      ).not.toBeNull();
      if (reason === "失活") await wrapper.setProps({ active: false });
      else if (reason === "切累计")
        await wrapper.setProps({ mode: "cumulative" });
      else if (reason === "切期间")
        await wrapper.setProps({ scopeLabel: "2026-04" });
      else
        await wrapper.setProps({ rows: [{ ...detail, periodReceived: "0" }] });
      await flushPromises();
      expect(
        wrapper.findComponent(MonthlyFinancialProjectReceiptDialog).exists(),
      ).toBe(false);
      expect(host.querySelector("[data-financial-receipt-dialog]")).toBeNull();
      if (reason === "切累计")
        expect(wrapper.find(".project-bank-receipt-link").exists()).toBe(false);
      await wrapper.setProps({
        active: true,
        mode: "period",
        scopeLabel: "2026-03",
        rows: [detail],
      });
      await flushPromises();
      expect(
        wrapper.findComponent(MonthlyFinancialProjectReceiptDialog).exists(),
      ).toBe(false);
      expect(api.get).toHaveBeenCalledTimes(1);
    },
  );
});
