const mockGet = jest.fn();
jest.mock("@/utils/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
}));
import { nextTick } from "vue";
import Preview, {
  safeProjectReceiptPreviewUrl,
  scopedProjectReceiptEvidence,
  type ProjectReceiptScope,
} from "@/components/monthly-financial/MonthlyFinancialProjectReceiptPreview.vue";
import type { FinancialAnalysisProjectReceipt } from "@/types/monthlyFinancialAnalysis";
const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
const scope: ProjectReceiptScope = {
  rootContractId: "root-a",
  periodKey: "2026-03",
  from: "2026-03",
  to: "2026-03",
};
const version = "a".repeat(64);
const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
const originalObserver = Object.getOwnPropertyDescriptor(
  globalThis,
  "IntersectionObserver",
);
const mounted = new Set<ReturnType<typeof mount>>();
function previewPath(
  root: string,
  id: string,
  from: string,
  to: string,
  evidenceVersion = version,
) {
  return (
    "/api/monthly-financial-reports/analysis/projects/" +
    root +
    "/receipts/" +
    id +
    "/preview?from=" +
    from +
    "&to=" +
    to +
    "&evidenceVersion=" +
    evidenceVersion
  );
}
function receipt(
  id = "receipt-a",
  changes: Partial<FinancialAnalysisProjectReceipt> = {},
): FinancialAnalysisProjectReceipt {
  const result: FinancialAnalysisProjectReceipt = {
    ...scope,
    receiptId: id,
    projectNumber: "原件项目-010",
    projectNumberSource: "business_contract_no",
    receiptDate: "2026-03-12",
    amount: "0.100000000001",
    receiptNumber: "银行回单-001",
    receiptNumberSource: "electronic_receipt_no",
    transactionSerialNo: null,
    bankName: "合成测试银行",
    fileName: "回单.png",
    mimeType: "image/png",
    previewUrl: null,
    previewUnavailableReason: null,
    ...changes,
  };
  if (!Object.prototype.hasOwnProperty.call(changes, "previewUrl"))
    result.previewUrl = previewPath(
      result.rootContractId,
      id,
      result.from,
      result.to,
    );
  return result;
}
function fileResponse(mime = "image/png") {
  return {
    data: new Blob(["合成文件内容"], { type: mime }),
    headers: { "content-type": mime },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
async function render(
  receipts: FinancialAnalysisProjectReceipt[] = [receipt()],
  extra: Partial<ProjectReceiptScope> = {},
) {
  const wrapper = mount(Preview, { props: { ...scope, receipts, ...extra } });
  mounted.add(wrapper);
  await settle();
  return wrapper;
}
function restore(
  object: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(object, key, descriptor);
  else Reflect.deleteProperty(object, key);
}

describe("项目回单预览的项目期间与地址边界", () => {
  it("只保留同项目同期间且真实回款日期在期间内的证据，不改变输入", () => {
    const rows = [
      receipt(),
      receipt("other-root", { rootContractId: "root-b" }),
      receipt("other-period", {
        periodKey: "2026-02",
        from: "2026-02",
        to: "2026-02",
        receiptDate: "2026-02-10",
      }),
      receipt("wrong-date", { receiptDate: "2026-04-01" }),
      receipt("invalid-date", { receiptDate: "2026-02-31" }),
      receipt("wrong-key", { periodKey: "2026-Q1" }),
    ];
    const before = JSON.stringify(rows);
    expect(
      scopedProjectReceiptEvidence(rows, scope).map((item) => item.receiptId),
    ).toEqual(["receipt-a"]);
    expect(JSON.stringify(rows)).toBe(before);
    expect(
      scopedProjectReceiptEvidence(rows, { ...scope, rootContractId: "" }),
    ).toEqual([]);
  });
  it("季度年度及闰日使用真实范围，不把同年的其他季度回单带入", () => {
    const quarter = {
      rootContractId: "root-a",
      periodKey: "2024-Q1",
      from: "2024-01",
      to: "2024-03",
    };
    const valid = receipt("leap", { ...quarter, receiptDate: "2024-02-29" });
    expect(scopedProjectReceiptEvidence([valid], quarter)).toHaveLength(1);
    expect(
      scopedProjectReceiptEvidence(
        [receipt("not-leap", { receiptDate: "2026-02-29" })],
        scope,
      ),
    ).toHaveLength(0);
    const year = {
      ...scope,
      periodKey: "2026",
      from: "2026-07",
      to: "2026-09",
    };
    expect(
      scopedProjectReceiptEvidence(
        [receipt("year", { ...year, receiptDate: "2026-08-01" })],
        year,
      ),
    ).toHaveLength(1);
    expect(
      scopedProjectReceiptEvidence([valid], {
        ...quarter,
        periodKey: "2024-Q2",
      }),
    ).toHaveLength(0);
  });
  it.each(["previewUrl", "receiptNumber", "transactionSerialNo"] as const)(
    "同receiptId的%s冲突先封存原件和业务号，不任意取第一条",
    (field) => {
      const original = receipt();
      const changed = {
        ...original,
        [field]:
          field === "previewUrl"
            ? previewPath(
                "root-a",
                "receipt-a",
                scope.from,
                scope.to,
                "b".repeat(64),
              )
            : "冲突号码",
      };
      for (const rows of [
        [original, changed],
        [changed, original],
      ]) {
        const result = scopedProjectReceiptEvidence(rows, scope);
        expect(result).toHaveLength(1);
        expect(result[0].previewUrl).toBeNull();
        expect(result[0].receiptNumber).toBeNull();
        expect(result[0].transactionSerialNo).toBeNull();
        expect(result[0].previewUnavailableReason).toContain("冲突");
      }
      expect(
        scopedProjectReceiptEvidence([original, { ...original }], scope),
      ).toHaveLength(1);
    },
  );
  it("相对路径或同源绝对路径都规范化为含证据版本的唯一受权路径", () => {
    const path = receipt().previewUrl!;
    expect(
      safeProjectReceiptPreviewUrl(receipt(), scope, "https://finance.example"),
    ).toBe(path);
    expect(
      safeProjectReceiptPreviewUrl(
        receipt("receipt-a", { previewUrl: "https://finance.example" + path }),
        scope,
        "https://finance.example",
      ),
    ).toBe(path);
  });
  it.each([
    "https://outside.example" + receipt().previewUrl,
    "//outside.example" + receipt().previewUrl,
    "javascript:alert(1)",
    "data:application/pdf;base64,AAAA",
    "blob:https://finance.example/anything",
    "/api/contracts/files/receipt-a",
    previewPath("root-b", "receipt-a", scope.from, scope.to),
    previewPath("root-a", "receipt-b", scope.from, scope.to),
    previewPath("root-a", "receipt-a", "2026-02", "2026-02"),
    receipt().previewUrl + "&download=1",
    receipt().previewUrl + "&from=2026-03",
    receipt().previewUrl + "&evidenceVersion=" + version,
    receipt().previewUrl + "#page=2",
    receipt().previewUrl!.replace("/receipts/", "/other/../receipts/"),
    receipt().previewUrl!.replace("/receipts/", "/%2e%2e/receipts/"),
    receipt().previewUrl!.replace("/receipts/", "\\receipts\\"),
    " " + receipt().previewUrl,
    receipt().previewUrl!.replace("&evidenceVersion=" + version, ""),
    receipt().previewUrl!.replace(version, "A".repeat(64)),
    receipt().previewUrl!.replace(version, "a".repeat(63)),
  ])("拒绝越界、危险或版本不完整的预览地址 %s", (url) => {
    expect(
      safeProjectReceiptPreviewUrl(
        receipt("receipt-a", { previewUrl: url }),
        scope,
        "https://finance.example",
      ),
    ).toBeNull();
  });
});

describe("项目付款回单行内预览生命周期", () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue(fileResponse());
    let sequence = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:项目回单-" + ++sequence),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });
  afterEach(async () => {
    for (const wrapper of mounted) wrapper.unmount();
    mounted.clear();
    await settle();
    restore(URL, "createObjectURL", originalCreate);
    restore(URL, "revokeObjectURL", originalRevoke);
    restore(globalThis, "IntersectionObserver", originalObserver);
  });
  it("首张图片自动读取受权接口并只展示真实银行号，第二张PDF点击后才读取", async () => {
    const first = receipt();
    const second = receipt("receipt-b", {
      fileName: "第二张.pdf",
      mimeType: "application/pdf",
      receiptNumber: "银行回单-002",
    });
    const wrapper = await render([first, second]);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenLastCalledWith(
      first.previewUrl,
      expect.objectContaining({
        responseType: "blob",
        signal: expect.any(AbortSignal),
        headers: { "X-Silent-Error": "true" },
      }),
    );
    expect(wrapper.get(".receipt-preview-image").attributes("src")).toBe(
      "blob:项目回单-1",
    );
    const previousImage = wrapper.get(".receipt-preview-image").element;
    expect(wrapper.text()).toContain("银行回单-001");
    expect(wrapper.text()).not.toContain("receipt-a");
    mockGet.mockResolvedValueOnce(fileResponse("application/pdf"));
    await wrapper.get('[aria-label="下一张回单"]').trigger("click");
    await settle();
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet.mock.calls[1][0]).toBe(second.previewUrl);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:项目回单-1");
    expect(wrapper.find(".receipt-preview-image").exists()).toBe(false);
    expect(wrapper.get(".receipt-preview-pdf").attributes("src")).toBe(
      "blob:项目回单-2",
    );
    previousImage.dispatchEvent(new Event("error"));
    await settle();
    expect(wrapper.get(".receipt-preview-pdf").attributes("src")).toBe(
      "blob:项目回单-2",
    );
    expect(wrapper.text()).toContain("银行回单-002");
    expect(
      wrapper.find('[aria-label="下一张回单"]').attributes("disabled"),
    ).toBeDefined();
  });
  it("缺银行回单号只显示未提供，流水号单独展示且不拿内部回款id替代", async () => {
    const wrapper = await render([
      receipt("internal-record-id", {
        receiptNumber: null,
        receiptNumberSource: null,
        transactionSerialNo: "流水-100",
        previewUrl: null,
        fileName: null,
      }),
    ]);
    expect(wrapper.text()).toContain("银行回单号：未提供");
    expect(wrapper.text()).toContain("银行流水号：流水-100");
    expect(wrapper.text()).not.toContain("银行回单号：流水-100");
    expect(wrapper.text()).not.toContain("internal-record-id");
    expect(wrapper.get(".receipt-preview-state").text()).toContain("未提供");
    expect(mockGet).not.toHaveBeenCalled();
  });
  it("无匹配项目期间或重复冲突不请求任何其他文件", async () => {
    const wrong = await render([
      receipt("other", { rootContractId: "root-b" }),
    ]);
    expect(wrong.get(".receipt-preview-state").text()).toContain("未提供");
    const conflict = await render([
      receipt(),
      receipt("receipt-a", { receiptNumber: "另一银行号" }),
    ]);
    expect(conflict.get(".receipt-preview-state").text()).toContain("冲突");
    expect(conflict.text()).toContain("银行回单号：未提供");
    expect(mockGet).not.toHaveBeenCalled();
  });
  it("拒绝HTML或SVG等响应，即使文件名声称PDF也不创建预览地址", async () => {
    mockGet.mockResolvedValueOnce(fileResponse("text/html"));
    const wrapper = await render([
      receipt("receipt-a", {
        fileName: "伪装.pdf",
        mimeType: "application/pdf",
      }),
    ]);
    expect(wrapper.get(".receipt-preview-error").text()).toContain(
      "不支持安全",
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    mockGet.mockResolvedValueOnce(fileResponse("image/svg+xml"));
    await wrapper.get(".receipt-preview-retry").trigger("click");
    await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("切项目或期间立即回收旧文件，迟到响应不能覆盖新项目", async () => {
    const pending = deferred<ReturnType<typeof fileResponse>>();
    mockGet.mockReturnValueOnce(pending.promise);
    const wrapper = await render();
    const firstSignal = mockGet.mock.calls[0][1].signal as AbortSignal;
    const nextScope = {
      rootContractId: "root-b",
      periodKey: "2026-04",
      from: "2026-04",
      to: "2026-04",
    };
    const nextReceipt = receipt("receipt-b", {
      ...nextScope,
      receiptDate: "2026-04-12",
    });
    await wrapper.setProps({ ...nextScope, receipts: [nextReceipt] });
    await settle();
    expect(firstSignal.aborted).toBe(true);
    expect(wrapper.get(".receipt-preview-image").attributes("src")).toBe(
      "blob:项目回单-1",
    );
    pending.resolve(fileResponse("application/pdf"));
    await settle();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".receipt-preview-pdf").exists()).toBe(false);
    expect(mockGet.mock.calls.at(-1)[0]).toBe(nextReceipt.previewUrl);
  });
  it("同范围证据版本变化清旧Blob并重新核验，完全相同元数据重绘不重复请求", async () => {
    const wrapper = await render();
    await wrapper.setProps({ receipts: [{ ...receipt() }] });
    await settle();
    expect(mockGet).toHaveBeenCalledTimes(1);
    const changed = receipt("receipt-a", {
      previewUrl: previewPath(
        "root-a",
        "receipt-a",
        scope.from,
        scope.to,
        "b".repeat(64),
      ),
    });
    const pending = deferred<ReturnType<typeof fileResponse>>();
    mockGet.mockReturnValueOnce(pending.promise);
    await wrapper.setProps({ receipts: [changed] });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:项目回单-1");
    expect(wrapper.find(".receipt-preview-image").exists()).toBe(false);
    expect(mockGet.mock.calls.at(-1)[0]).toBe(changed.previewUrl);
    pending.resolve(fileResponse());
    await settle();
    expect(wrapper.get(".receipt-preview-image").attributes("src")).toBe(
      "blob:项目回单-2",
    );
  });
  it.each([401, 403, 409, 404])(
    "返回%s时旧预览已清理且不自动借其他回单",
    async (status) => {
      const wrapper = await render();
      mockGet.mockRejectedValueOnce({ response: { status } });
      await wrapper.get(".receipt-preview-retry").trigger("click");
      await settle();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:项目回单-1");
      expect(wrapper.find(".receipt-preview-image").exists()).toBe(false);
      expect(wrapper.find(".receipt-preview-pdf").exists()).toBe(false);
      expect(wrapper.get(".receipt-preview-error").text()).toContain(
        status === 401 || status === 403
          ? "权限已失效"
          : status === 409
            ? "刷新财务分析"
            : "未提供或已失效",
      );
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledTimes(2);
    },
  );
  it("用户取消和卸载中止在途请求，迟到文件不创建Blob", async () => {
    const canceled = deferred<ReturnType<typeof fileResponse>>();
    mockGet.mockReturnValueOnce(canceled.promise);
    const wrapper = await render();
    const signal = mockGet.mock.calls[0][1].signal as AbortSignal;
    await wrapper.get(".receipt-preview-cancel").trigger("click");
    expect(signal.aborted).toBe(true);
    canceled.resolve(fileResponse());
    await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    const unmounted = deferred<ReturnType<typeof fileResponse>>();
    mockGet.mockReturnValueOnce(unmounted.promise);
    await wrapper.get(".receipt-preview-retry").trigger("click");
    const secondSignal = mockGet.mock.calls[1][1].signal as AbortSignal;
    wrapper.unmount();
    mounted.delete(wrapper);
    expect(secondSignal.aborted).toBe(true);
    unmounted.resolve(fileResponse());
    await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("关闭、图像失败及卸载均回收当前Blob，不残留旧图", async () => {
    const wrapper = await render();
    await wrapper.get(".receipt-preview-close").trigger("click");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:项目回单-1");
    expect(wrapper.find(".receipt-preview-image").exists()).toBe(false);
    await wrapper.get(".receipt-preview-retry").trigger("click");
    await settle();
    await wrapper.get(".receipt-preview-image").trigger("error");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:项目回单-2");
    expect(wrapper.get(".receipt-preview-error").text()).toContain("无法显示");
    await wrapper.get(".receipt-preview-retry").trigger("click");
    await settle();
    wrapper.unmount();
    mounted.delete(wrapper);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:项目回单-3");
  });
  it("可见区懒加载只请求被选中的一张，未进入可见范围不拉取PDF", async () => {
    let onVisible!: IntersectionObserverCallback;
    const observe = jest.fn(),
      disconnect = jest.fn();
    class FakeObserver {
      constructor(callback: IntersectionObserverCallback) {
        onVisible = callback;
      }
      observe = observe;
      disconnect = disconnect;
    }
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: FakeObserver,
    });
    const wrapper = await render([
      receipt(),
      receipt("receipt-b", {
        mimeType: "application/pdf",
        fileName: "另一张.pdf",
      }),
    ]);
    expect(observe).toHaveBeenCalledWith(wrapper.element);
    expect(mockGet).not.toHaveBeenCalled();
    onVisible(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await settle();
    expect(mockGet).not.toHaveBeenCalled();
    onVisible(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await settle();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
    expect(wrapper.find(".receipt-preview-image").exists()).toBe(true);
    await wrapper.get(".receipt-preview-close").trigger("click");
    onVisible(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await settle();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".receipt-preview-image").exists()).toBe(false);
  });
});
