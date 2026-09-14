const mockApiGet = jest.fn();
jest.mock("@/utils/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

import {
  downloadMonthlyFinancialAnalysis,
  getMonthlyFinancialAnalysis,
  getMonthlyFinancialAnalysisWindow,
  getMonthlyFinancialProjectReceiptPreview,
} from "@/utils/monthlyFinancialAnalysisApi";
import type { FinancialAnalysisQuery } from "@/types/monthlyFinancialAnalysis";

describe("财务分析查询与导出接口", () => {
  const query: FinancialAnalysisQuery = {
    from: "2026-01",
    to: "2026-09",
    granularity: "quarter",
    partyA: "甲方甲",
    contractRegion: "朝阳区",
    reimbursementScope: "区域商务",
    personId: "person-a",
  };
  beforeEach(() => jest.clearAllMocks());

  it("查询完整透传筛选和取消信号，不转换服务端金额字符串", async () => {
    const data = {
      query,
      modules: [{ amount: "999999999999999999.123456789012" }],
    };
    mockApiGet.mockResolvedValueOnce({ data: { success: true, data } });
    const controller = new AbortController();
    expect(await getMonthlyFinancialAnalysis(query, controller.signal)).toBe(
      data,
    );
    expect(mockApiGet).toHaveBeenCalledWith(
      "/api/monthly-financial-reports/analysis",
      expect.objectContaining({
        params: query,
        signal: controller.signal,
        headers: { "X-Silent-Error": "true" },
      }),
    );
  });

  it("接口业务失败时不把错误正文作为统计数据", async () => {
    mockApiGet.mockResolvedValueOnce({
      data: { success: false, message: "统计来源无法读取" },
    });
    await expect(getMonthlyFinancialAnalysis(query)).rejects.toThrow(
      "统计来源无法读取",
    );
  });

  it.each(["month", "quarter"] as const)(
    "%s历史窗口按自身粒度复用只读接口，不修改统计查询对象",
    async (granularity) => {
      const windowQuery = { ...query, granularity };
      const original = JSON.stringify(windowQuery);
      const windowData = {
        query: windowQuery,
        modules: [],
      };
      mockApiGet.mockResolvedValueOnce({
        data: { success: true, data: windowData },
      });
      const controller = new AbortController();
      expect(
        await getMonthlyFinancialAnalysisWindow(windowQuery, controller.signal),
      ).toBe(windowData);
      expect(mockApiGet).toHaveBeenCalledWith(
        "/api/monthly-financial-reports/analysis",
        expect.objectContaining({
          params: windowQuery,
          signal: controller.signal,
        }),
      );
      expect(JSON.stringify(windowQuery)).toBe(original);
    },
  );

  it("导出携带显示版本和模块，按响应文件名保存电子表格", async () => {
    const blob = new Blob(["精确金额"]);
    mockApiGet.mockResolvedValueOnce({
      data: blob,
      headers: {
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("人员成本精确明细.xlsx")}`,
      },
    });
    expect(
      await downloadMonthlyFinancialAnalysis(query, "personnel", "version-1"),
    ).toEqual({ blob, fileName: "人员成本精确明细.xlsx" });
    expect(mockApiGet).toHaveBeenCalledWith(
      "/api/monthly-financial-reports/analysis/export",
      expect.objectContaining({
        params: { ...query, module: "personnel", dataVersion: "version-1" },
        responseType: "blob",
      }),
    );
  });

  it("旧兼容调用可不传版本，默认导出全部且有安全文件名回退", async () => {
    const blob = new Blob(["全部结果"]);
    mockApiGet.mockResolvedValueOnce({ data: blob, headers: {} });
    const result = await downloadMonthlyFinancialAnalysis(query);
    expect(result.fileName).toBe("月度财务趋势分析-2026-01至2026-09-all.xlsx");
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { ...query, module: "all" } }),
    );
  });

  it("二进制响应中的数据变化提示能读出并阻止下载", async () => {
    const blob = new Blob(['{"message":"金额已更新，请先刷新分析后再导出"}'], {
      type: "application/json",
    });
    Object.defineProperty(blob, "text", {
      value: async () => '{"message":"金额已更新，请先刷新分析后再导出"}',
    });
    mockApiGet.mockRejectedValueOnce({ response: { status: 409, data: blob } });
    await expect(
      downloadMonthlyFinancialAnalysis(query, "all", "旧版本"),
    ).rejects.toThrow("金额已更新，请先刷新分析后再导出");
  });

  it("项目回单按受权二进制请求加载，携带凭据与取消信号且保留响应类型", async () => {
    const url =
      "/api/monthly-financial-reports/analysis/projects/root-a/receipts/receipt-a/preview?from=2026-03&to=2026-03&evidenceVersion=" +
      "a".repeat(64);
    const controller = new AbortController();
    const response = {
      data: new Blob(["合成回单"], { type: "image/png" }),
      headers: { "content-type": "image/png" },
    };
    mockApiGet.mockResolvedValueOnce(response);
    expect(
      await getMonthlyFinancialProjectReceiptPreview(url, controller.signal),
    ).toBe(response);
    expect(mockApiGet).toHaveBeenCalledWith(url, {
      responseType: "blob",
      signal: controller.signal,
      withCredentials: true,
      timeout: 60_000,
      headers: { "X-Silent-Error": "true" },
    });
  });

  it.each([401, 403, 409])(
    "回单%s错误原样交给预览组件清理，不转换为成功文件",
    async (status) => {
      const error = { response: { status, data: new Blob(["回单不可用"]) } };
      mockApiGet.mockRejectedValueOnce(error);
      await expect(
        getMonthlyFinancialProjectReceiptPreview("/已校验的预览地址"),
      ).rejects.toBe(error);
    },
  );
});
