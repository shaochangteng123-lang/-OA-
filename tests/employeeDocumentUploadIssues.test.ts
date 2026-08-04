import { nextTick } from "vue";
import EmployeeDocumentUploadIssues from "../src/components/employee/EmployeeDocumentUploadIssues.vue";
import {
  resolveEmployeeDocumentRecognitionCompletion,
  resolveEmployeeDocumentUploadError,
  type EmployeeDocumentUploadIssue,
} from "../src/utils/employeeDocumentUploadIssues";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

describe("人事档案识别上传异常列表", () => {
  const issues: EmployeeDocumentUploadIssue[] = [
    {
      id: "issue-1",
      employeeId: "employee-1",
      employeeName: "员工甲",
      type: "error",
      message: "员工「员工甲」文件「档案甲.pdf」识别失败",
    },
    {
      id: "issue-2",
      employeeId: "employee-1",
      employeeName: "员工甲",
      type: "warning",
      message: "员工「员工甲」文件「档案乙.pdf」第4页分类冲突",
    },
  ];

  it("按退出键不会清除异常，点击对应叉号才单独关闭", async () => {
    const wrapper = mount(EmployeeDocumentUploadIssues, {
      props: { issues },
      attachTo: document.body,
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();

    expect(wrapper.emitted("dismiss")).toBeUndefined();
    expect(wrapper.text()).toContain("档案甲.pdf");
    expect(wrapper.text()).toContain("档案乙.pdf");

    const closeButtons = wrapper.findAll(".el-alert__close-btn");
    expect(closeButtons).toHaveLength(2);
    await closeButtons[0].trigger("click");

    expect(wrapper.emitted("dismiss")).toEqual([["issue-1"]]);
    await wrapper.setProps({ issues: [issues[1]] });
    expect(wrapper.findAll(".el-alert")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("档案甲.pdf");
    expect(wrapper.text()).toContain("档案乙.pdf");
    wrapper.unmount();
  });

  it("成功提示保留在页面中并可通过对应叉号关闭", async () => {
    const successIssue: EmployeeDocumentUploadIssue = {
      id: "issue-success",
      employeeId: "employee-1",
      employeeName: "员工甲",
      type: "success",
      message:
        "员工「员工甲」文件「整套档案.pdf」中的人事档案已全部识别并上传成功：劳动合同书、保密协议",
    };
    const wrapper = mount(EmployeeDocumentUploadIssues, {
      props: { issues: [successIssue] },
      attachTo: document.body,
    });

    expect(wrapper.find(".el-alert").classes()).toContain("el-alert--success");
    expect(wrapper.text()).toContain("人事档案已全部识别并上传成功");

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();
    expect(wrapper.emitted("dismiss")).toBeUndefined();

    await wrapper.find(".el-alert__close-btn").trigger("click");
    expect(wrapper.emitted("dismiss")).toEqual([["issue-success"]]);
    wrapper.unmount();
  });
});

describe("人事档案识别上传异常说明", () => {
  it("代理超时时明确结果未知并提示不要重复上传", () => {
    const result = resolveEmployeeDocumentUploadError({
      response: {
        status: 504,
        data: "<html>Gateway Timeout</html>",
      },
    });

    expect(result.type).toBe("warning");
    expect(result.outcomeUnknown).toBe(true);
    expect(result.message).toContain("可能仍在后台继续");
    expect(result.message).toContain("请勿重复上传");
    expect(result.message).not.toContain("html");
    expect(result.message).not.toBe("上传失败");
  });

  it.each(["ECONNABORTED", "ETIMEDOUT"])(
    "连接异常 %s 时提示稍后核对结果",
    (code) => {
      const result = resolveEmployeeDocumentUploadError({ code, request: {} });

      expect(result.type).toBe("warning");
      expect(result.outcomeUnknown).toBe(true);
      expect(result.message).toContain("请勿重复上传");
    },
  );

  it("业务校验失败时保留服务端具体原因", () => {
    const result = resolveEmployeeDocumentUploadError({
      response: {
        status: 422,
        data: { message: "第4页分类冲突，请手动归档" },
      },
    });

    expect(result).toEqual({
      type: "warning",
      message: "第4页分类冲突，请手动归档",
      outcomeUnknown: false,
    });
  });

  it("识别基础设施异常时明确未归档并提示稍后重试", () => {
    const result = resolveEmployeeDocumentUploadError({
      response: {
        status: 503,
        data: {
          message:
            "档案文字识别服务本次未能完整处理文件，为避免错误归档，本次未上传任何文件，请稍后重新上传",
        },
      },
    });

    expect(result.type).toBe("warning");
    expect(result.outcomeUnknown).toBe(false);
    expect(result.message).toContain("本次未上传任何文件");
    expect(result.message).toContain("稍后重新上传");
  });

  it("服务器连接中断并返回网页错误时提示先核对结果", () => {
    const result = resolveEmployeeDocumentUploadError({
      response: { status: 500, data: "<html>error</html>" },
    });

    expect(result).toEqual({
      type: "warning",
      message:
        "服务器连接在识别过程中中断，识别结果暂时无法确认。请勿重复上传；请先刷新该员工档案，确认未归档后再重新上传",
      outcomeUnknown: true,
    });
    expect(result.message).not.toContain("html");
  });

  it("服务器明确返回识别失败原因时直接显示原因", () => {
    const result = resolveEmployeeDocumentUploadError({
      response: {
        status: 500,
        data: { message: "自动识别员工档案文件失败" },
      },
    });

    expect(result).toEqual({
      type: "error",
      message: "自动识别员工档案文件失败",
      outcomeUnknown: false,
    });
  });
});

describe("人事档案一键归档完成状态", () => {
  it("存在缺失类型或其他材料时返回需核对并保留页码摘要", () => {
    const result = resolveEmployeeDocumentRecognitionCompletion({
      missingLabels: ["工资卡复印件（中国工商银行）"],
      unsupportedSegments: [
        { label: "员工离职证明", pageNumbers: [24] },
        { label: "职业资格材料", pageNumbers: [25, 26, 27, 28] },
      ],
    });

    expect(result.type).toBe("warning");
    expect(result.warningSummary).toContain(
      "未识别到：工资卡复印件（中国工商银行）",
    );
    expect(result.warningSummary).toContain("员工离职证明（第24页）");
    expect(result.warningSummary).toContain(
      "职业资格材料（第25、26、27、28页）",
    );
  });

  it("存在失败数量或失败子项时返回需核对", () => {
    expect(
      resolveEmployeeDocumentRecognitionCompletion({ failedCount: 2 }),
    ).toEqual({
      type: "warning",
      warningSummary: "有2个子项处理失败",
    });

    const result = resolveEmployeeDocumentRecognitionCompletion({
      failedCount: 1,
      failedSubItems: ["劳动合同期限：未能识别合同日期"],
    });
    expect(result.type).toBe("warning");
    expect(result.warningSummary).toContain("失败子项");
    expect(result.warningSummary).toContain("未能识别合同日期");
  });

  it("没有缺失、其他材料或失败子项时才返回成功", () => {
    expect(resolveEmployeeDocumentRecognitionCompletion({})).toEqual({
      type: "success",
      warningSummary: "",
    });
  });
});
