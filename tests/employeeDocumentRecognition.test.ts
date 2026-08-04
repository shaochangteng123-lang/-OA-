import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import EmployeeDocumentRecognitionNotice from "../src/components/employee/EmployeeDocumentRecognitionNotice.vue";
import {
  useEmployeeDocumentRecognitionStore,
  type EmployeeDocumentRecognitionOutcome,
} from "../src/stores/employeeDocumentRecognition";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createTaskInput = (fileName: string) => ({
  employeeId: "employee-1",
  employeeName: "员工甲",
  fileName,
});

describe("人事档案全局识别任务", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("跨页面共享的任务队列保持串行并保留每个完成结果", async () => {
    const store = useEmployeeDocumentRecognitionStore();
    const firstResult = createDeferred<EmployeeDocumentRecognitionOutcome>();
    const startedFiles: string[] = [];

    store.enqueueTask(createTaskInput("档案甲.pdf"), async () => {
      startedFiles.push("档案甲.pdf");
      return firstResult.promise;
    });
    store.enqueueTask(createTaskInput("档案乙.pdf"), async () => {
      startedFiles.push("档案乙.pdf");
      return { type: "success", message: "档案乙识别完成" };
    });

    await flushPromises();
    expect(startedFiles).toEqual(["档案甲.pdf"]);
    expect(store.pendingCount).toBe(2);
    expect(store.currentTask?.fileName).toBe("档案甲.pdf");
    expect(store.currentTask?.status).toBe("processing");

    firstResult.resolve({ type: "success", message: "档案甲识别完成" });
    await flushPromises();
    await nextTick();

    expect(startedFiles).toEqual(["档案甲.pdf", "档案乙.pdf"]);
    expect(store.pendingCount).toBe(0);
    expect(store.latestUndismissedResult?.message).toBe("档案乙识别完成");

    store.dismissTaskResult(store.latestUndismissedResult!.id);
    expect(store.latestUndismissedResult?.message).toBe("档案甲识别完成");
  });

  it("执行函数异常时会结束任务，不会永久停留在识别中", async () => {
    const store = useEmployeeDocumentRecognitionStore();
    store.enqueueTask(createTaskInput("异常档案.pdf"), async () => {
      throw new Error("识别进程异常");
    });

    await flushPromises();
    await nextTick();

    expect(store.pendingCount).toBe(0);
    expect(store.latestUndismissedResult?.status).toBe("error");
    expect(store.latestUndismissedResult?.message).toContain("异常结束");
  });

  it("退出登录清理后不再写入已失效任务的详细提示", () => {
    const store = useEmployeeDocumentRecognitionStore();
    const taskId = store.enqueueTask(
      createTaskInput("待清理档案.pdf"),
      async () => ({ type: "success", message: "已完成" }),
    );

    store.clearAll();
    const issue = store.addIssue(
      {
        employeeId: "employee-1",
        employeeName: "员工甲",
        type: "success",
        message: "不应重新出现",
      },
      taskId,
    );

    expect(issue).toBeNull();
    expect(store.issues).toEqual([]);
  });
});

describe("人事档案全局识别提示", () => {
  it("识别中不可关闭，完成后切换为可手动关闭的成功提示", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useEmployeeDocumentRecognitionStore();
    const result = createDeferred<EmployeeDocumentRecognitionOutcome>();
    const wrapper = mount(EmployeeDocumentRecognitionNotice, {
      global: { plugins: [pinia] },
      attachTo: document.body,
    });

    store.enqueueTask(createTaskInput("整套档案.pdf"), () => result.promise);
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain("正在识别员工「员工甲」");
    expect(wrapper.text()).toContain("可关闭员工窗口并继续使用其他页面");
    expect(wrapper.find(".el-alert__close-btn").exists()).toBe(false);

    result.resolve({
      type: "success",
      message: "员工「员工甲」人事档案识别完成，请核对自动归位结果",
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain("识别完成，请核对自动归位结果");
    expect(wrapper.find(".el-alert").classes()).toContain("el-alert--success");
    expect(wrapper.find(".el-alert__close-btn").exists()).toBe(true);

    await wrapper.find(".el-alert__close-btn").trigger("click");
    await nextTick();
    expect(wrapper.text()).toBe("");
    wrapper.unmount();
  });

  it("存在需核对项时显示黄色提示和可读摘要", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useEmployeeDocumentRecognitionStore();
    const wrapper = mount(EmployeeDocumentRecognitionNotice, {
      global: { plugins: [pinia] },
      attachTo: document.body,
    });

    store.enqueueTask(createTaskInput("整套档案.pdf"), async () => ({
      type: "warning",
      message:
        "员工「员工甲」文件「整套档案.pdf」归档完成，但需要核对：未识别到工资卡复印件（中国工商银行）",
    }));
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".el-alert").classes()).toContain("el-alert--warning");
    expect(wrapper.text()).toContain("归档完成，但需要核对");
    expect(wrapper.text()).toContain("工资卡复印件（中国工商银行）");
    wrapper.unmount();
  });
});
