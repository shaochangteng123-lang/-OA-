const mockGetReceipt = jest.fn();
jest.mock("@/utils/monthlyFinancialAnalysisApi", () => ({
  getMonthlyFinancialProjectReceiptPreview: (...args: unknown[]) =>
    mockGetReceipt(...args),
}));
import { h, nextTick, ref, vShow, withDirectives } from "vue";
import Dialog from "@/components/monthly-financial/MonthlyFinancialProjectReceiptDialog.vue";
import Preview from "@/components/monthly-financial/MonthlyFinancialProjectReceiptPreview.vue";
import type { FinancialAnalysisProjectReceipt } from "@/types/monthlyFinancialAnalysis";
const { mount, DOMWrapper } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
const mounted = new Set<ReturnType<typeof mount>>();
const originalShow = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const originalClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
const originalFullscreen = Object.getOwnPropertyDescriptor(
  document,
  "fullscreenElement",
);
const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
const originalObserver = Object.getOwnPropertyDescriptor(
  globalThis,
  "IntersectionObserver",
);
const scope = {
  rootContractId: "project-a",
  periodKey: "2026-03",
  from: "2026-03",
  to: "2026-03",
};
let fullscreenElement: Element | null = null;
function receipt(
  version = "a".repeat(64),
  extra: Partial<FinancialAnalysisProjectReceipt> = {},
): FinancialAnalysisProjectReceipt {
  const value = {
    ...scope,
    receiptId: "receipt-a",
    projectNumber: "原件项目-001",
    projectNumberSource: "business_contract_no",
    receiptDate: "2026-03-12",
    amount: "0.100000000001",
    receiptNumber: "银行回单-001",
    receiptNumberSource: "electronic_receipt_no" as const,
    transactionSerialNo: null,
    bankName: "测试银行",
    fileName: "回单.png",
    mimeType: "image/png",
    previewUrl: null,
    previewUnavailableReason: null,
    ...extra,
  };
  return {
    ...value,
    previewUrl:
      "/api/monthly-financial-reports/analysis/projects/" +
      value.rootContractId +
      "/receipts/" +
      value.receiptId +
      "/preview?from=" +
      value.from +
      "&to=" +
      value.to +
      "&evidenceVersion=" +
      version,
  };
}
function response(type = "image/png") {
  return {
    data: new Blob(["合成回单"], { type }),
    headers: { "content-type": type },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
async function settle() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
function installNative(mode: "native" | "unsupported" | "rejected" = "native") {
  const show: jest.Mock<void, []> = jest.fn(() => {
    if (mode === "rejected") throw new Error("浏览器拒绝原生弹窗");
    const element = show.mock.contexts.at(-1) as HTMLDialogElement;
    element.setAttribute("open", "");
  });
  const close: jest.Mock<void, []> = jest.fn(() => {
    const element = close.mock.contexts.at(-1) as HTMLDialogElement;
    element.removeAttribute("open");
    element.dispatchEvent(new Event("close"));
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: mode === "unsupported" ? undefined : show,
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: close,
  });
  return { show, close };
}
function restore(
  object: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(object, key, descriptor);
  else Reflect.deleteProperty(object, key);
}
function triggerButton() {
  const button = document.createElement("button");
  button.textContent = "银行回单预览";
  document.body.appendChild(button);
  button.focus();
  return button;
}
async function render(visible = false, extra: Record<string, unknown> = {}) {
  const wrapper = mount(Dialog, {
    props: {
      ...scope,
      receipts: [receipt()],
      visible,
      projectName: "合成项目",
      ...extra,
    },
    attachTo: document.body,
  });
  mounted.add(wrapper);
  await settle();
  return wrapper;
}
function dialog() {
  const element = document.querySelector<HTMLDialogElement>(
    "[data-financial-receipt-dialog]",
  );
  expect(element).not.toBeNull();
  return new DOMWrapper(element!);
}
function key(element: Element, value: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  return event;
}

describe("银行回单文字入口的独立弹窗", () => {
  beforeEach(() => {
    mockGetReceipt.mockReset().mockResolvedValue(response());
    fullscreenElement = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    let blobId = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:弹窗回单-" + ++blobId),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    document.body.style.overflow = "auto";
    installNative();
  });
  afterEach(async () => {
    for (const wrapper of mounted) wrapper.unmount();
    mounted.clear();
    await settle();
    restore(HTMLDialogElement.prototype, "showModal", originalShow);
    restore(HTMLDialogElement.prototype, "close", originalClose);
    restore(document, "fullscreenElement", originalFullscreen);
    restore(URL, "createObjectURL", originalCreate);
    restore(URL, "revokeObjectURL", originalRevoke);
    restore(globalThis, "IntersectionObserver", originalObserver);
    jest.restoreAllMocks();
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  it("未打开时不挂载原预览也不请求文件，打开后进入body原生对话框", async () => {
    const native = installNative();
    const trigger = triggerButton();
    const wrapper = await render(false, { returnFocus: trigger });
    expect(wrapper.findComponent(Preview).exists()).toBe(false);
    expect(
      document.querySelector("[data-financial-receipt-dialog]"),
    ).toBeNull();
    expect(mockGetReceipt).not.toHaveBeenCalled();
    await wrapper.setProps({ receipts: [receipt("b".repeat(64))] });
    expect(mockGetReceipt).not.toHaveBeenCalled();
    await wrapper.setProps({ visible: true });
    await settle();
    const modal = dialog();
    expect(native.show).toHaveBeenCalledTimes(1);
    expect(native.show.mock.contexts[0]).toBe(modal.element);
    expect(modal.attributes("role")).toBe("dialog");
    expect(modal.attributes("aria-modal")).toBe("true");
    expect(modal.attributes()).toHaveProperty("open");
    expect(
      document.getElementById(modal.attributes("aria-labelledby"))?.textContent,
    ).toBe("银行回单预览");
    expect(modal.text()).toContain("合成项目 · 2026-03 至 2026-03");
    expect(modal.element.parentElement?.parentElement).toBe(document.body);
    expect(wrapper.findComponent(Preview).exists()).toBe(true);
    expect(mockGetReceipt).toHaveBeenCalledTimes(1);
    expect(modal.get(".receipt-preview-image").attributes("src")).toBe(
      "blob:弹窗回单-1",
    );
    expect(document.activeElement).toBe(
      modal.get(".project-receipt-dialog-close").element,
    );
    expect(document.body.style.overflow).toBe("hidden");
    expect(wrapper.emitted("visibility-change")).toEqual([[true]]);
  });

  it("关闭按钮只关闭弹窗，父级立即卸载实例时仍返回文字入口并释放Blob", async () => {
    const trigger = triggerButton();
    const native = installNative();
    const visibility = jest.fn();
    const closed = jest.fn(() => {
      wrapper.unmount();
      mounted.delete(wrapper);
    });
    const wrapper = mount(Dialog, {
      props: {
        ...scope,
        visible: true,
        receipts: [receipt()],
        returnFocus: trigger,
        onClose: closed,
        onVisibilityChange: visibility,
      },
      attachTo: document.body,
    });
    mounted.add(wrapper);
    await settle();
    await dialog().get('[aria-label="关闭银行回单预览"]').trigger("click");
    await settle();
    expect(native.close).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(visibility.mock.calls).toEqual([[true], [false]]);
    expect(
      document.querySelector("[data-financial-receipt-dialog]"),
    ).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:弹窗回单-1");
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("auto");
  });

  it.each(["unsupported", "rejected"] as const)(
    "%s时使用后备遮罩，内侧点击不关闭、遮罩自身点击关闭并还原滚动",
    async (mode) => {
      installNative(mode);
      document.body.style.overflow = "clip";
      const trigger = triggerButton();
      const wrapper = await render(true, { returnFocus: trigger });
      const modal = dialog();
      expect(
        modal.element.parentElement?.classList.contains("is-fallback"),
      ).toBe(true);
      await modal.get(".project-receipt-dialog-header").trigger("click");
      expect(wrapper.emitted("close")).toBeUndefined();
      await new DOMWrapper(modal.element.parentElement!).trigger("click");
      await settle();
      expect(wrapper.emitted("close")).toHaveLength(1);
      expect(
        document.querySelector("[data-financial-receipt-dialog]"),
      ).toBeNull();
      expect(document.body.style.overflow).toBe("clip");
      expect(document.activeElement).toBe(trigger);
    },
  );

  it("原生遮罩外侧点击关闭，弹窗内部空白点击不误关", async () => {
    const wrapper = await render(true);
    const modal = dialog();
    jest.spyOn(modal.element, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 700,
      top: 100,
      bottom: 600,
      width: 600,
      height: 500,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });
    await modal.trigger("click", { clientX: 120, clientY: 120 });
    expect(wrapper.emitted("close")).toBeUndefined();
    await modal.trigger("click", { clientX: 50, clientY: 50 });
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("退出键由弹窗优先处理，不冒泡到财务根全屏快捷键", async () => {
    const trigger = triggerButton();
    const parentKey = jest.fn();
    document.addEventListener("keydown", parentKey);
    const wrapper = await render(true, { returnFocus: trigger });
    const event = key(
      dialog().get(".project-receipt-dialog-close").element,
      "Escape",
    );
    await settle();
    document.removeEventListener("keydown", parentKey);
    expect(event.defaultPrevented).toBe(true);
    expect(parentKey).not.toHaveBeenCalled();
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
    expect(wrapper.findComponent(Preview).exists()).toBe(false);
  });

  it("原生cancel和外部close分别能关闭并且不会重复发送关闭事件", async () => {
    const canceled = await render(true);
    const event = new Event("cancel", { cancelable: true });
    dialog().element.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(canceled.emitted("close")).toHaveLength(1);
    const closed = await render(true);
    (dialog().element as HTMLDialogElement).close();
    await settle();
    expect(closed.emitted("close")).toHaveLength(1);
    expect(closed.emitted("visibility-change")).toEqual([[true], [false]]);
  });

  it("正反向Tab都限在弹窗，外部焦点尝试被带回，内部Tab不触发父级焦点圈", async () => {
    const outside = triggerButton();
    const wrapper = await render(true);
    const modal = dialog();
    const first = modal.get(".project-receipt-dialog-close")
      .element as HTMLButtonElement;
    const last = modal.get(".receipt-preview-close")
      .element as HTMLButtonElement;
    const parentKey = jest.fn();
    document.addEventListener("keydown", parentKey);
    last.focus();
    expect(key(last, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(key(first, "Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    const middle = modal.get(".receipt-preview-retry")
      .element as HTMLButtonElement;
    middle.focus();
    expect(key(middle, "Tab").defaultPrevented).toBe(false);
    expect(parentKey).not.toHaveBeenCalled();
    outside.focus();
    expect(document.activeElement).toBe(first);
    document.removeEventListener("keydown", parentKey);
    await wrapper.setProps({ visible: false });
    await settle();
    expect(document.activeElement).toBe(outside);
  });

  it.each(["default", "outside-target", "inner-target"] as const)(
    "原生财务全屏的%s目标始终在当前全屏根内，关闭不退出根全屏",
    async (mode) => {
      const root = document.createElement("section");
      const inner = document.createElement("div");
      root.appendChild(inner);
      document.body.appendChild(root);
      fullscreenElement = root;
      const appendTo =
        mode === "outside-target"
          ? document.body
          : mode === "inner-target"
            ? inner
            : null;
      const wrapper = await render(true, { appendTo });
      const modal = dialog();
      expect(root.contains(modal.element)).toBe(true);
      expect(modal.element.parentElement?.parentElement).toBe(
        mode === "inner-target" ? inner : root,
      );
      await modal.get(".project-receipt-dialog-close").trigger("click");
      await settle();
      expect(document.fullscreenElement).toBe(root);
      expect(wrapper.findComponent(Preview).exists()).toBe(false);
    },
  );

  it("全屏状态变化关闭当前弹窗，不带旧文件迁移或自动重开", async () => {
    const wrapper = await render(true);
    const nextRoot = document.createElement("section");
    document.body.appendChild(nextRoot);
    fullscreenElement = nextRoot;
    document.dispatchEvent(new Event("fullscreenchange"));
    await settle();
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(
      document.querySelector("[data-financial-receipt-dialog]"),
    ).toBeNull();
    expect(nextRoot.querySelector(".project-receipt-preview")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:弹窗回单-1");
    expect(mockGetReceipt).toHaveBeenCalledTimes(1);
  });

  it("项目或期间改变直接关闭，旧Blob与内部组件清理而不请求另一期间原件", async () => {
    const wrapper = await render(true);
    const nextScope = {
      rootContractId: "project-b",
      periodKey: "2026-04",
      from: "2026-04",
      to: "2026-04",
    };
    await wrapper.setProps({
      ...nextScope,
      receipts: [
        receipt("b".repeat(64), { ...nextScope, receiptDate: "2026-04-12" }),
      ],
    });
    await settle();
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.findComponent(Preview).exists()).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:弹窗回单-1");
    expect(mockGetReceipt).toHaveBeenCalledTimes(1);
  });

  it("同scope证据版本变化先释放旧原件再加载新版本，相同内容刷新不多请求", async () => {
    const wrapper = await render(true);
    await wrapper.setProps({ receipts: [{ ...receipt() }] });
    await settle();
    expect(mockGetReceipt).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ receipts: [receipt("b".repeat(64))] });
    await settle();
    expect(wrapper.emitted("close")).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:弹窗回单-1");
    expect(dialog().get(".receipt-preview-image").attributes("src")).toBe(
      "blob:弹窗回单-2",
    );
    expect(mockGetReceipt.mock.calls.at(-1)[0]).toContain(
      "evidenceVersion=" + "b".repeat(64),
    );
  });

  it("visible=false会中止在途请求，迟到响应不能在关闭后创建Blob", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    mockGetReceipt.mockReturnValueOnce(pending.promise);
    const wrapper = await render(true);
    const signal = mockGetReceipt.mock.calls[0][1] as AbortSignal;
    await wrapper.setProps({ visible: false });
    await settle();
    expect(signal.aborted).toBe(true);
    expect(wrapper.findComponent(Preview).exists()).toBe(false);
    expect(wrapper.emitted("close")).toBeUndefined();
    pending.resolve(response());
    await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("空凭证仍能打开明确未提供空态，但没有文件请求", async () => {
    const wrapper = await render(true, { receipts: [] });
    expect(dialog().get(".receipt-preview-state").text()).toContain("未提供");
    expect(wrapper.findComponent(Preview).exists()).toBe(true);
    expect(mockGetReceipt).not.toHaveBeenCalled();
    await dialog().get(".project-receipt-dialog-close").trigger("click");
    expect(wrapper.findComponent(Preview).exists()).toBe(false);
  });

  it("未传returnFocus使用打开前焦点，入口已移除时不强行聚焦失效节点", async () => {
    const trigger = triggerButton();
    const wrapper = await render(true);
    const focus = jest.spyOn(trigger, "focus");
    trigger.remove();
    await dialog().get(".project-receipt-dialog-close").trigger("click");
    expect(focus).not.toHaveBeenCalled();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("真实v-show宿主强制隐藏后清除原生close退回的隐藏入口焦点，也不抢走新焦点", async () => {
    for (const keepOtherFocus of [false, true]) {
      const native = installNative();
      const moduleVisible = ref(true);
      const previewVisible = ref(false);
      let trigger: HTMLElement | null = null;
      let destination: HTMLElement | null = null;
      let displayDuringClose = "";
      const Host = {
        setup() {
          return () =>
            h("div", [
              h(
                "button",
                {
                  class: "destination",
                  ref: (element: unknown) => {
                    if (element instanceof HTMLElement) destination = element;
                  },
                },
                "当前可见模块",
              ),
              withDirectives(
                h("section", { class: "old-module" }, [
                  h(
                    "button",
                    {
                      class: "receipt-trigger",
                      ref: (element: unknown) => {
                        if (element instanceof HTMLElement) trigger = element;
                      },
                      onClick: () => {
                        previewVisible.value = true;
                      },
                    },
                    "银行回单预览",
                  ),
                  moduleVisible.value && previewVisible.value
                    ? h(Dialog, {
                        ...scope,
                        visible: true,
                        receipts: [receipt()],
                        returnFocus: trigger,
                        onClose: () => {
                          previewVisible.value = false;
                        },
                      })
                    : null,
                ]),
                [[vShow, moduleVisible.value]],
              ),
            ]);
        },
      };
      const host = mount(Host, { attachTo: document.body });
      mounted.add(host);
      native.close.mockImplementation(() => {
        const element = native.close.mock.contexts.at(-1) as HTMLDialogElement;
        element.removeAttribute("open");
        displayDuringClose = window.getComputedStyle(
          host.get(".old-module").element,
        ).display;
        trigger?.focus();
        element.dispatchEvent(new Event("close"));
        if (keepOtherFocus)
          void Promise.resolve().then(() => destination?.focus());
      });
      (host.get(".receipt-trigger").element as HTMLElement).focus();
      await host.get(".receipt-trigger").trigger("click");
      await settle();
      expect(dialog().exists()).toBe(true);
      moduleVisible.value = false;
      await settle();
      expect(displayDuringClose).not.toBe("none");
      expect(
        window.getComputedStyle(host.get(".old-module").element).display,
      ).toBe("none");
      expect(document.activeElement).not.toBe(trigger);
      if (keepOtherFocus) expect(document.activeElement).toBe(destination);
      expect(
        document.querySelector("[data-financial-receipt-dialog]"),
      ).toBeNull();
      host.unmount();
      mounted.delete(host);
    }
  });

  it("卸载清理键盘与焦点监听、滚动锁和在途预览，后续退出键不再被拦截", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    mockGetReceipt.mockReturnValueOnce(pending.promise);
    const trigger = triggerButton();
    const remove = jest.spyOn(document, "removeEventListener");
    const wrapper = await render(true, { returnFocus: trigger });
    const signal = mockGetReceipt.mock.calls[0][1] as AbortSignal;
    wrapper.unmount();
    mounted.delete(wrapper);
    await settle();
    expect(signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("focusin", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith(
      "fullscreenchange",
      expect.any(Function),
    );
    expect(document.body.style.overflow).toBe("auto");
    expect(document.activeElement).toBe(trigger);
    expect(key(trigger, "Escape").defaultPrevented).toBe(false);
    pending.resolve(response());
    await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
