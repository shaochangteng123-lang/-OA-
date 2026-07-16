import { parseEmploymentContractTermText } from "../server/services/employmentContractOcr";

describe("劳动合同期限识别", () => {
  it("识别固定期限劳动合同起止日期", () => {
    const result = parseEmploymentContractTermText(`
      二、劳动合同期限
      第三条 本合同为固定期限劳动合同。
      自 2025 年 6 月 16 日起至 2026 年 6 月 15 日。
    `);

    expect(result).toEqual({
      contractStartDate: "2025-06-16",
      contractEndDate: "2026-06-15",
      message: "劳动合同期限识别成功",
    });
  });

  it("同时存在试用期时选择期限更长的正式合同", () => {
    const result = parseEmploymentContractTermText(`
      劳动合同期限
      本合同为固定期限劳动合同，自2025年6月16日起至2026年6月15日。
      其中试用期自2025年6月16日起至2025年12月15日。
    `);

    expect(result.contractStartDate).toBe("2025-06-16");
    expect(result.contractEndDate).toBe("2026-06-15");
  });

  it("兼容数字零被识别为英文字母", () => {
    const result = parseEmploymentContractTermText(
      "固定期限劳动合同自2O25年O6月16日起至2O26年O6月15日",
    );

    expect(result.contractStartDate).toBe("2025-06-16");
    expect(result.contractEndDate).toBe("2026-06-15");
  });

  it("兼容扫描合同日期中的下划线和曰字误识别", () => {
    const result = parseEmploymentContractTermText(`
      二、劳动合同期限
      本合同为固定期限劳务合同。
      自2025年_6月_16日起至2026年6月_15曰。
    `);

    expect(result.contractStartDate).toBe("2025-06-16");
    expect(result.contractEndDate).toBe("2026-06-15");
  });

  it("只有签订日期时不误认为合同期限", () => {
    const result = parseEmploymentContractTermText(
      "劳动合同书 签订日期：2025年6月16日",
    );

    expect(result.contractStartDate).toBeNull();
    expect(result.contractEndDate).toBeNull();
  });
});
