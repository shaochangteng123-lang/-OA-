/** @jest-environment node */

import {
  getContractAmountAutomaticAdoptionContext,
  getContractAmountBreakdown,
  getContractAmountStatus,
  parseContractText,
  type ContractRecognitionResult,
} from "../server/services/contractOcr";

function amountField(result: ContractRecognitionResult) {
  return result.fields.find((field) => field.field === "amount")!;
}

describe("合同金额内部状态分类", () => {
  it("明确合同金额分类为 confirmed_amount（已确认金额）", () => {
    const result = parseContractText(
      ["技术服务合同", "合同价款：人民币壹拾叁万叁仟元整（￥133000元）。"].join(
        "\n",
      ),
      { relationType: "main" },
    );

    expect(getContractAmountStatus(result)).toBe("confirmed_amount");
    expect(amountField(result).normalizedValue).toBe("133000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 133000,
      changeAmount: 0,
      finalAmount: 133000,
    });
  });

  it("原合同金额加本次增加额分类为 calculated_amount（计算金额）", () => {
    const result = parseContractText(
      [
        "补充协议",
        "原合同金额为230000元。",
        "本次补充协议增加合同费用60000元。",
        "调整后合同总金额为290000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(getContractAmountStatus(result)).toBe("calculated_amount");
    expect(amountField(result).normalizedValue).toBe("60000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 230000,
      changeAmount: 60000,
      finalAmount: 290000,
    });
  });

  it.each([
    "付款金额：人民币3000元。",
    "本期进度款：人民币3000元。",
    "甲方应向乙方支付报酬人民币3000元。",
    "甲方按照约定一次性支付乙方信息咨询费人民币3000元。",
    "甲方支付230000元。",
    "本次补充协议技术服务报酬由甲方分期支付乙方。第一期甲方支付230000元，第二期甲方支付60000元。",
    [
      "本次补充协议技术服务报酬由甲方分期支付乙方。具体支付方式和时",
      "间如下：",
      "（1）经甲方确认的工程规划许可证移交后30日内，",
      "甲方支付230000元；",
      "（2）施工暂设规划许可证移交后30日内，",
      "甲方支付60000元。",
    ].join("\n"),
  ])(
    "只有付款事实时分类为 payment_only（仅付款），且合同金额保持为空：%s",
    (text) => {
      const result = parseContractText(text, { relationType: "main" });

      expect(getContractAmountStatus(result)).toBe("payment_only");
      expect(getContractAmountAutomaticAdoptionContext(result)).toEqual({
        status: "payment_only",
        missingAmountEligible: false,
      });
      expect(amountField(result).normalizedValue).toBe("");
      expect(amountField(result).normalizedValue).not.toBe("0");
      expect(amountField(result).normalizedValue).not.toBe("0.00");
      expect(getContractAmountBreakdown(result)).toEqual({
        originalAmount: null,
        changeAmount: null,
        finalAmount: null,
      });
    },
  );

  it("没有任何金额事实时分类为 missing_amount（金额缺失），且不自动填0", () => {
    const result = parseContractText(
      "本合同服务内容为现场资料整理，付款方式另行约定。",
      { relationType: "main" },
    );

    expect(getContractAmountStatus(result)).toBe("missing_amount");
    expect(getContractAmountAutomaticAdoptionContext(result)).toEqual({
      status: "missing_amount",
      missingAmountEligible: true,
    });
    expect(amountField(result).normalizedValue).toBe("");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: null,
      changeAmount: null,
      finalAmount: null,
    });
  });

  it.each(["税额：人民币3000元。", "设备单价：人民币5000元。"])(
    "只有非付款低优先金额事实时仍分类为 missing_amount（金额缺失）：%s",
    (text) => {
      const result = parseContractText(text, { relationType: "main" });

      expect(getContractAmountStatus(result)).toBe("missing_amount");
      expect(
        getContractAmountAutomaticAdoptionContext(result)
          ?.missingAmountEligible,
      ).toBe(true);
      expect(amountField(result).normalizedValue).toBe("");
    },
  );

  it.each([
    ["服务费：人民币9000元。", true],
    ["含税金额：人民币120000元。", false],
  ])(
    "没有合同级强锚点的模糊金额不标记为明确金额：%s",
    (text, missingAmountEligible) => {
      const result = parseContractText(text, { relationType: "main" });

      expect(getContractAmountStatus(result)).toBe("missing_amount");
      expect(
        getContractAmountAutomaticAdoptionContext(result)
          ?.missingAmountEligible,
      ).toBe(missingAmountEligible);
    },
  );

  it("补充协议只明确本次增减额但无法计算最终金额时分类为已确认金额", () => {
    const result = parseContractText(
      "补充协议\n本次补充协议增加合同金额20000元。",
      { relationType: "supplement" },
    );

    expect(getContractAmountStatus(result)).toBe("confirmed_amount");
    expect(amountField(result).normalizedValue).toBe("20000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: null,
      changeAmount: 20000,
      finalAmount: null,
    });
  });

  it("内部金额状态不会进入现有识别结果结构", () => {
    const result = parseContractText("合同金额：100000元", {
      relationType: "main",
    });

    expect(getContractAmountStatus(result)).toBe("confirmed_amount");
    expect(Object.keys(result)).not.toEqual(
      expect.arrayContaining(["amountStatus", "contractAmountStatus"]),
    );
  });

  it("补充协议动作金额与正文最终金额冲突时以明确最终金额形成闭环", () => {
    const result = parseContractText(
      [
        "补充协议",
        "原合同金额为230000元。",
        "本次补充协议增加合同金额60000元。",
        "调整后合同总金额为300000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(getContractAmountStatus(result)).toBe("calculated_amount");
    expect(amountField(result).normalizedValue).toBe("70000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 230000,
      changeAmount: 70000,
      finalAmount: 300000,
    });
  });

  it("合同总额冲突同时出现付款金额时不能误标为仅付款", () => {
    const result = parseContractText(
      [
        "合同总金额：人民币100000元。",
        "合同总价：人民币120000元。",
        "付款金额：人民币3000元。",
      ].join("\n"),
      { relationType: "main" },
    );

    expect(getContractAmountStatus(result)).toBe("missing_amount");
    expect(getContractAmountAutomaticAdoptionContext(result)).toEqual({
      status: "missing_amount",
      missingAmountEligible: false,
    });
  });

  it("补充协议只有原合同金额和付款金额时不能误标为仅付款或计算金额", () => {
    const result = parseContractText(
      ["补充协议", "原合同金额为230000元。", "付款金额为3000元。"].join("\n"),
      { relationType: "supplement" },
    );

    expect(getContractAmountStatus(result)).toBe("missing_amount");
    expect(getContractAmountAutomaticAdoptionContext(result)).toEqual({
      status: "missing_amount",
      missingAmountEligible: false,
    });
    expect(amountField(result).normalizedValue).toBe("");
  });
});
