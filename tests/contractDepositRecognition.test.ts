import {
  recognizeContractDeposit,
  type RecognizeContractDepositInput,
} from "../server/services/contractDepositRecognition";
import { parseContractText } from "../server/services/contractOcr";

function rentalInput(
  overrides: Partial<RecognizeContractDepositInput> = {},
): RecognizeContractDepositInput {
  return {
    text: "房屋租赁合同",
    declaredSubtype: "house_rental",
    assetCategory: "house_rental",
    monthlyRent: 20_378,
    monthlyPropertyManagementFee: 6_120,
    ...overrides,
  };
}

describe("租赁合同押金识别", () => {
  it.each(["house_rental", "vehicle_rental", "parking_space"] as const)(
    "%s 二级分类会启动押金识别",
    (subtype) => {
      expect(
        recognizeContractDeposit(
          rentalInput({
            declaredSubtype: subtype,
            assetCategory: subtype,
            text: "合同提及押金，具体金额另行确认。",
          }),
        ),
      ).toMatchObject({
        triggered: true,
        status: "pending",
        reasonCode: "deposit_mention_incomplete",
      });
    },
  );

  it("非租赁二级分类不会因正文金额或文件语义启动识别", () => {
    expect(
      recognizeContractDeposit({
        text: "文件标题：房屋租赁押金79494元；付款差额也是79494元。",
        declaredSubtype: "procurement",
        assetCategory: "procurement",
      }),
    ).toEqual({
      triggered: false,
      status: "none",
      amount: null,
      amountSource: null,
      formula: null,
      evidence: null,
      reasonCode: "rental_subtype_not_applicable",
    });
  });

  it("明确押金金额时确认并保留正文证据", () => {
    expect(
      recognizeContractDeposit(
        rentalInput({ text: "乙方应支付租赁保证金人民币79,494.00元。" }),
      ),
    ).toMatchObject({
      triggered: true,
      status: "confirmed",
      amount: 79_494,
      amountSource: "explicit_amount",
      reasonCode: "deposit_explicit_amount",
    });
  });

  it("中文大写押金金额可形成确认结果", () => {
    expect(
      recognizeContractDeposit(
        rentalInput({ text: "押金为人民币柒万玖仟肆佰玖拾肆元整。" }),
      ).amount,
    ).toBe(79_494);
  });

  it("明确月租金与物业费公式时闭环计算", () => {
    expect(
      recognizeContractDeposit(
        rentalInput({ text: "押金为三个月租金及物业管理费。" }),
      ),
    ).toMatchObject({
      status: "confirmed",
      amount: 79_494,
      amountSource: "formula",
      reasonCode: "deposit_formula_closed",
      formula: {
        basis: "monthly_rent_and_property_management_fee",
        months: 3,
        monthlyRent: 20_378,
        monthlyPropertyManagementFee: 6_120,
        monthlyBasisAmount: 26_498,
        calculatedAmount: 79_494,
      },
    });
  });

  it("押几付几按月租金计算", () => {
    expect(
      recognizeContractDeposit(
        rentalInput({
          text: "租金支付方式为押一付三。",
          monthlyRent: 780,
          monthlyPropertyManagementFee: null,
        }),
      ),
    ).toMatchObject({
      status: "confirmed",
      amount: 780,
      amountSource: "formula",
    });
  });

  it("明确免押时返回 none", () => {
    expect(
      recognizeContractDeposit(
        rentalInput({ text: "本次租赁无需缴纳任何保证金。" }),
      ),
    ).toMatchObject({
      triggered: true,
      status: "none",
      amount: null,
      reasonCode: "deposit_explicitly_waived",
    });
  });

  it("明确写明不包含押金条款时返回 none", () => {
    expect(
      recognizeContractDeposit(
        rentalInput({ text: "本合同不包含任何押金条款。" }),
      ),
    ).toMatchObject({
      triggered: true,
      status: "none",
      amount: null,
      reasonCode: "deposit_explicitly_waived",
    });
  });

  it("只提及押金但金额和计算基数不完整时待确认", () => {
    expect(
      recognizeContractDeposit(
        rentalInput({
          text: "承租人应按约定缴纳押金，具体数额另行确认。",
          monthlyRent: null,
          monthlyPropertyManagementFee: null,
        }),
      ),
    ).toMatchObject({
      status: "pending",
      amount: null,
      reasonCode: "deposit_mention_incomplete",
    });
  });

  it("租赁正文没有押金语义时返回 none", () => {
    expect(
      recognizeContractDeposit(
        rentalInput({ text: "租金按月支付，租赁期满后办理交接。" }),
      ),
    ).toMatchObject({
      triggered: true,
      status: "none",
      reasonCode: "deposit_not_mentioned",
    });
  });

  it("合同 OCR 结构化结果携带独立押金结论且不改变合同总金额", () => {
    const result = parseContractText(
      [
        "房屋租赁合同",
        "月含税租金为人民币20378元。",
        "月含税物业管理费为人民币6120元。",
        "押金为三个月租金及物业管理费。",
      ].join("\n"),
      {
        expectedCategory: "asset",
        expectedDeclaredSubtype: "house_rental",
        expectedAssetCategory: "house_rental",
      },
    );

    expect(result.depositRecognition).toMatchObject({
      triggered: true,
      status: "confirmed",
      amount: 79_494,
      amountSource: "formula",
    });
    expect(
      result.fields.find((field) => field.field === "amount")?.normalizedValue,
    ).not.toBe("79494.00");
  });
});
