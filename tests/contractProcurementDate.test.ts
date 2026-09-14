import {
  parseContractText,
  type ContractTextSource,
} from "../server/services/contractOcr";

const signatureBlock = [
  "甲方：甲方采购有限公司",
  "乙方：乙方设备有限公司",
  "（公章）",
  "（公章）",
  "税号：123456789012345678",
  "地址：测试地址",
  "开户行：测试银行",
  "账号：1234567890123456",
];

function parseDate(text: string) {
  const sources: ContractTextSource[] = ["pdf_text", "ocr_300", "ocr_480"].map(
    (source) => ({
      text,
      source: source as ContractTextSource["source"],
      pageNumber: 3,
      confidence: 0.99,
      recognitionEngine: source === "pdf_text" ? "pdf_text" : "paddleocr",
    }),
  );
  return parseContractText("", { sources }).fields.find(
    (field) => field.field === "contract_date",
  )!;
}

describe("采购合同独立公章占位落款日期", () => {
  it("同页双主体和双公章占位下方的唯一日期可由文字层和图像共同验证", () => {
    const field = parseDate([...signatureBlock, "2026年9月10日"].join("\n"));
    expect(field.normalizedValue).toBe("2026-09-10");
    expect(field.confidence).toBe(100);
    expect(field.evidence?.some((item) => item.source === "pdf_text")).toBe(
      true,
    );
    expect(field.evidence?.some((item) => item.source === "ocr_300")).toBe(
      true,
    );
    expect(field.evidence?.[0].text).toContain("公章");
  });

  it("文字层将甲乙方排在同一行时仍能验证落款区域", () => {
    expect(
      parseDate(
        [
          signatureBlock.slice(0, 2).join("    "),
          ...signatureBlock.slice(2),
          "2026年9月10日",
        ].join("\n"),
      ).normalizedValue,
    ).toBe("2026-09-10");
  });

  it.each([
    ["仅一个公章占位", signatureBlock.filter((_, index) => index !== 3)],
    ["只有一方主体", signatureBlock.filter((_, index) => index !== 1)],
    ["正文提到公章", ["甲方与乙方应各自加盖公章", "公章具有法律效力"]],
    ["营业执照附件", ["营业执照", ...signatureBlock]],
  ])("%s 不将裸日期升级为签订日期", (_, lines) => {
    expect(
      parseDate([...lines, "2026年9月10日"].join("\n")).normalizedValue,
    ).toBe("");
  });

  it("拒绝签章区域附近明确属于付款的日期", () => {
    expect(
      parseDate([...signatureBlock, "付款日期：", "2026年9月10日"].join("\n"))
        .normalizedValue,
    ).toBe("");
  });

  it("不读取双公章落款区之前的裸日期", () => {
    expect(
      parseDate(["2026年9月10日", ...signatureBlock].join("\n"))
        .normalizedValue,
    ).toBe("");
  });

  it("同一落款区出现不同日期时不猜测", () => {
    expect(
      parseDate(
        [...signatureBlock, "2026年9月10日", "2026年9月11日"].join("\n"),
      ).normalizedValue,
    ).toBe("");
  });

  it("下一页只有裸日期时不单独生成签订日期", () => {
    expect(parseDate("2026年9月10日").normalizedValue).toBe("");
  });

  it.each([
    "附件：交货清单",
    "附表一",
    "交货时间",
    "收货时间",
    "出库时间",
    "生产时间",
  ])("双公章落款区在 %s 前结束，不借后续日期", (boundary) => {
    expect(
      parseDate(
        [...signatureBlock, boundary, "产品：定制设备", "2026年9月12日"].join(
          "\n",
        ),
      ).normalizedValue,
    ).toBe("");
  });

  it("落款已明确时，后续附件日期不污染已有落款日期", () => {
    expect(
      parseDate(
        [
          ...signatureBlock,
          "2026年9月10日",
          "附件：交货清单",
          "2026年9月12日",
        ].join("\n"),
      ).normalizedValue,
    ).toBe("2026-09-10");
  });
});
