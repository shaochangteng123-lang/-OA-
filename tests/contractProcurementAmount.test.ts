/** @jest-environment node */

import {
  getContractAmountStatus,
  getContractOcrAutomaticAdoptionSafetyContext,
  parseContractText,
  type ContractRecognitionResult,
  type ContractTextSource,
} from "../server/services/contractOcr";

function amountField(result: ContractRecognitionResult) {
  return result.fields.find((field) => field.field === "amount")!;
}

function procurementText(amountClause: string) {
  return [
    "定制设备采购合同",
    "甲方：北京建设有限公司",
    "乙方：郑州设备有限公司",
    "项目名称：办公设备定制采购项目",
    amountClause,
  ].join("\n");
}

function independentSources(text: string): ContractTextSource[] {
  return [
    {
      text,
      source: "pdf_text",
      pageNumber: 1,
      confidence: 99,
      recognitionEngine: "pdf_text",
    },
    {
      text,
      source: "ocr_300",
      pageNumber: 1,
      confidence: 99,
      recognitionEngine: "paddleocr",
    },
  ];
}

function parseProcurement(amountClause: string) {
  return parseContractText("", {
    relationType: "main",
    expectedCategory: "non_main",
    sources: independentSources(procurementText(amountClause)),
  });
}

describe("采购合同整合同总金额识别", () => {
  it("识别正文所列产品总金额，定金和尾款不形成竞争总额", () => {
    const result = parseProcurement(
      [
        "总计：人民币：13600元，大写：壹万叁仟陆佰元整",
        "二、合同总金额",
        "1、本合同所列产品的产品总金额为：人民币（小写）13600元整；",
        "大写：壹万叁仟陆佰元整",
        "2.合同总金额包含材料费、制作费，含13个点增值税专用发票，含",
        "运费，不含卸车费。",
        "签订合同后甲方支付定金额6000元，尾款7600元。",
      ].join("\n"),
    );

    expect(amountField(result).normalizedValue).toBe("13600.00");
    expect(amountField(result).confidence).toBe(100);
    expect(getContractAmountStatus(result)).toBe("confirmed_amount");
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.amount,
    ).toEqual(
      expect.objectContaining({
        role: "contract_total",
        scope: "current_contract",
        strongEvidence: true,
        explicitContractTotal: true,
        samePageVisibleOcrEvidence: true,
        riskCodes: [],
      }),
    );
    expect(
      amountField(result).candidates?.map((item) => item.normalizedValue),
    ).toEqual(["13600.00"]);
  });

  it.each([
    ["本合同所列货物的总金额为人民币24800元。", "24800.00"],
    ["本协议约定的全部设备总价款为人民币87000元。", "87000.00"],
    ["本合同所列所有商品的总价为人民币6200元。", "6200.00"],
  ])("同类完整采购范围声明可独立验证：%s", (clause, value) => {
    const result = parseProcurement(clause);

    expect(amountField(result).normalizedValue).toBe(value);
    expect(amountField(result).confidence).toBe(100);
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.amount.scope,
    ).toBe("current_contract");
  });

  it("仅有文件文字层时不会跳过独立可见证据要求", () => {
    const text = procurementText("本合同所列产品总金额为人民币13600元。");
    const result = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: independentSources(text).slice(0, 1),
    });

    expect(amountField(result).normalizedValue).toBe("13600.00");
    expect(amountField(result).confidence).toBeLessThan(100);
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.amount.riskCodes,
    ).toContain("AMOUNT_PDF_VISIBLE_EVIDENCE_MISSING");
  });

  it("同一识别引擎的两种清晰度结果不冒充独立验证", () => {
    const text = procurementText("本合同所列产品总金额为人民币13600元。");
    const visibleSource = independentSources(text)[1];
    const result = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: [visibleSource, { ...visibleSource, source: "ocr_480" }],
    });

    expect(amountField(result).normalizedValue).toBe("13600.00");
    expect(amountField(result).confidence).toBeLessThan(100);
  });

  it.each([
    "本合同所列部分产品的总金额为人民币5000元。",
    "本合同所列产品中的首批产品总金额为人民币5000元。",
    "原合同所列产品的产品总金额为人民币5000元。",
    "产品总金额为人民币5000元。",
    "按本合同所列产品总金额计算本期金额为人民币5000元。",
    "根据本合同所列产品总金额计算本期金额5000元。",
    "本合同所列产品总金额中部分金额为人民币5000元。",
  ])("部分、历史或无整合同范围的合计不能升级为总额：%s", (clause) => {
    const result = parseProcurement(clause);

    expect(getContractAmountStatus(result)).not.toBe("confirmed_amount");
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.amount
        .explicitContractTotal,
    ).toBe(false);
    expect(amountField(result).confidence).toBeLessThan(100);
  });

  it.each([
    "首期支付本合同所列产品总金额的50%，即人民币6800元。",
    "甲方支付本合同所列设备总金额的百分之五十，即人民币6800元。",
    "预付款按本合同所列产品总金额支付人民币6000元。",
    "本合同所列设备总金额为人民币13600元/套。",
    "本合同所列产品总金额\n的50%，即人民币6800元。",
    "本合同所列产品总金额\n的百分之五十，即人民币6800元。",
    "本合同所列设备总金额为\n人民币13600元/套。",
  ])("分期比例、预付款和单价不得作为合同总额：%s", (clause) => {
    const result = parseProcurement(clause);

    expect(amountField(result).normalizedValue).toBe("");
    expect(getContractAmountStatus(result)).not.toBe("confirmed_amount");
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.amount
        .explicitContractTotal,
    ).toBe(false);
  });

  it("两个明确采购总额冲突时保持阻断，不取较大值", () => {
    const result = parseProcurement(
      [
        "本合同所列产品的产品总金额为人民币13600元。",
        "合同总金额为人民币15600元。",
      ].join("\n"),
    );

    expect(amountField(result).confidence).toBeLessThan(100);
    expect(amountField(result).warnings?.join(" ")).toMatch(/冲突/u);
    expect(getContractAmountStatus(result)).not.toBe("confirmed_amount");
  });
});
