import { nextTick } from "vue";
import { ElDatePicker } from "element-plus";
import MonthlyFinancialDateRange from "@/components/monthly-financial/MonthlyFinancialDateRange.vue";

const { mount, flushPromises } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

async function settle() {
  await nextTick();
  await flushPromises();
  await nextTick();
}

describe("财务分析月份范围控件", () => {
  it("独立挂载真实月份范围选择器，中文标签、格式及禁止清空编辑明确", async () => {
    const original: [string, string] = ["2024-03", "2026-09"];
    const wrapper = mount(MonthlyFinancialDateRange, {
      props: { modelValue: original },
    });
    await settle();
    const picker = wrapper.getComponent(ElDatePicker);
    expect(picker.props()).toMatchObject({
      type: "monthrange",
      format: "YYYY年MM月",
      valueFormat: "YYYY-MM",
      clearable: false,
      editable: false,
      startPlaceholder: "开始月份",
      endPlaceholder: "结束月份",
    });
    expect(wrapper.classes()).toContain("monthly-financial-date-range");
    expect(wrapper.text()).toContain("统计期间");
    expect(wrapper.find(".range-calendar svg").exists()).toBe(true);
    const inputs = wrapper.findAll("input.el-range-input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0].attributes("placeholder")).toBe("开始月份");
    expect(inputs[1].attributes("placeholder")).toBe("结束月份");
    expect((inputs[0].element as HTMLInputElement).value).toBe("2024年03月");
    expect((inputs[1].element as HTMLInputElement).value).toBe("2026年09月");
    expect(
      wrapper
        .findAll(".range-endpoint-labels label")
        .map((label) => label.text()),
    ).toEqual(["分析开始月份", "分析结束月份"]);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(original).toEqual(["2024-03", "2026-09"]);
    wrapper.unmount();
  });

  it("选择完整合法月份元组才向父级更新，不直接修改原数组", async () => {
    const original: [string, string] = ["2026-01", "2026-09"];
    const wrapper = mount(MonthlyFinancialDateRange, {
      props: { modelValue: original },
    });
    const picker = wrapper.getComponent(ElDatePicker);
    picker.vm.$emit("update:modelValue", ["2025-04", "2026-08"]);
    await settle();
    expect(wrapper.emitted("update:modelValue")).toEqual([
      [["2025-04", "2026-08"]],
    ]);
    expect(original).toEqual(["2026-01", "2026-09"]);
    for (const invalid of [
      null,
      [],
      ["2026-01"],
      ["2026-13", "2026-09"],
      ["2026-09", "2026-08"],
      ["2026-01-01", "2026-09"],
      ["0000-01", "2026-09"],
      ["1899-12", "1900-01"],
      ["2099-12", "2100-01"],
    ])
      picker.vm.$emit("update:modelValue", invalid);
    await settle();
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    wrapper.unmount();
  });

  it("快捷按钮仅点击时以当前结束月份回看十一月，不用系统日期或自动缩短范围", async () => {
    const wrapper = mount(MonthlyFinancialDateRange, {
      props: { modelValue: ["2020-01", "2026-02"] },
    });
    await settle();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await wrapper.get(".range-shortcut").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([
      [["2025-03", "2026-02"]],
    ]);
    await wrapper.setProps({ modelValue: ["2024-05", "2024-12"] });
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    await wrapper.get(".range-shortcut").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[1]).toEqual([
      ["2024-01", "2024-12"],
    ]);
    wrapper.unmount();
  });

  it("月份面板禁止范围外年份，1900年首日和2099年末日仍可选", () => {
    const wrapper = mount(MonthlyFinancialDateRange, {
      props: { modelValue: ["2026-01", "2026-09"] },
    });
    const disabledDate = wrapper
      .getComponent(ElDatePicker)
      .props("disabledDate") as (date: Date) => boolean;
    expect(disabledDate(new Date(1899, 11, 31))).toBe(true);
    expect(disabledDate(new Date(1900, 0, 1))).toBe(false);
    expect(disabledDate(new Date(2099, 11, 31))).toBe(false);
    expect(disabledDate(new Date(2100, 0, 1))).toBe(true);
    expect(disabledDate(new Date("非法日期"))).toBe(true);
    wrapper
      .getComponent(ElDatePicker)
      .vm.$emit("update:modelValue", ["1900-01", "2099-12"]);
    expect(wrapper.emitted("update:modelValue")).toEqual([
      [["1900-01", "2099-12"]],
    ]);
    wrapper.unmount();
  });

  it.each(["1900-01", "1900-11", "1899-12", "2100-01"])(
    "结束月份%s不能形成合法近十二个月时禁用，不生成越界范围",
    async (end) => {
      const wrapper = mount(MonthlyFinancialDateRange, {
        props: { modelValue: ["1900-01", end] },
      });
      expect(
        wrapper.get(".range-shortcut").attributes("disabled"),
      ).toBeDefined();
      expect(wrapper.get(".range-shortcut").attributes("title")).toContain(
        "不能早于1900年1月",
      );
      await wrapper.get(".range-shortcut").trigger("click");
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
      wrapper.unmount();
    },
  );

  it.each(["1900-12", "2099-12"])(
    "结束月份%s可生成完整十二个月，边界年不会被错误禁用",
    async (end) => {
      const year = end.slice(0, 4);
      const wrapper = mount(MonthlyFinancialDateRange, {
        props: { modelValue: [`${year}-06`, end] },
      });
      expect(
        wrapper.get(".range-shortcut").attributes("disabled"),
      ).toBeUndefined();
      await wrapper.get(".range-shortcut").trigger("click");
      expect(wrapper.emitted("update:modelValue")).toEqual([
        [[`${year}-01`, end]],
      ]);
      wrapper.unmount();
    },
  );

  it("禁用状态透传且不能用快捷按钮或日期事件修改范围", async () => {
    const wrapper = mount(MonthlyFinancialDateRange, {
      props: { modelValue: ["2026-01", "2026-09"], disabled: true },
    });
    expect(wrapper.getComponent(ElDatePicker).props("disabled")).toBe(true);
    expect(wrapper.get(".range-shortcut").attributes("disabled")).toBeDefined();
    wrapper
      .getComponent(ElDatePicker)
      .vm.$emit("update:modelValue", ["2025-01", "2025-12"]);
    await wrapper.get(".range-shortcut").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    wrapper.unmount();
  });

  it("开始和结束标签各自绑定唯一输入，多实例互不串联", async () => {
    const first = mount(MonthlyFinancialDateRange, {
      props: { modelValue: ["2026-01", "2026-09"] },
    });
    const second = mount(MonthlyFinancialDateRange, {
      props: { modelValue: ["2025-01", "2025-12"], showShortcut: false },
    });
    await settle();
    const firstIds = first
      .findAll("input.el-range-input")
      .map((input) => input.attributes("id"));
    const secondIds = second
      .findAll("input.el-range-input")
      .map((input) => input.attributes("id"));
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
    expect(
      first
        .findAll(".range-endpoint-labels label")
        .map((label) => label.attributes("for")),
    ).toEqual(firstIds);
    expect(second.find(".range-shortcut").exists()).toBe(false);
    first.unmount();
    second.unmount();
  });

  it("真实弹层能展开并传送至文档根部，不留在可裁剪控件内部", async () => {
    const host = document.createElement("div");
    host.style.overflow = "hidden";
    host.style.width = "320px";
    document.body.appendChild(host);
    const wrapper = mount(MonthlyFinancialDateRange, {
      attachTo: host,
      props: { modelValue: ["2026-01", "2026-09"] },
    });
    await settle();
    await wrapper.get(".el-date-editor").trigger("click");
    await settle();
    const panel = document.querySelector(
      ".monthly-financial-date-range-popper",
    );
    expect(panel).not.toBeNull();
    expect(host.contains(panel)).toBe(false);
    expect(panel?.querySelectorAll(".el-month-table")).toHaveLength(2);
    expect(panel?.textContent).toContain("一月");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    wrapper.unmount();
    host.remove();
    await settle();
  });
});
