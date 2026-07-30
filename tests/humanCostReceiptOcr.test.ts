import {
  buildHumanCostReceiptRecognition,
  isSalaryPaymentProofText,
} from "../server/utils/human-cost-receipt";

describe("人力成本回单金额汇总", () => {
  it("使用整数分汇总多笔回单，避免浮点误差", () => {
    expect(buildHumanCostReceiptRecognition([0.1, 0.2, 1234.56])).toEqual({
      recognizedAmount: "1234.86",
      recognitionStatus: "recognized",
      recognizedItemCount: 3,
      totalItemCount: 3,
      ignoredItemCount: 0,
      recognitionError: null,
    });
  });

  it("部分页面未识别时保留已识别金额并标记待核对", () => {
    expect(buildHumanCostReceiptRecognition([100, null, 200])).toEqual({
      recognizedAmount: "300.00",
      recognitionStatus: "partial",
      recognizedItemCount: 2,
      totalItemCount: 3,
      ignoredItemCount: 0,
      recognitionError: "有 1 笔未通过银行回单校验，汇总仅包含校验成功的回单",
    });
  });

  it("没有识别出金额时标记失败", () => {
    expect(buildHumanCostReceiptRecognition([null, 0])).toEqual({
      recognizedAmount: "0.00",
      recognitionStatus: "failed",
      recognizedItemCount: 0,
      totalItemCount: 2,
      ignoredItemCount: 0,
      recognitionError:
        "文件未通过银行回单校验，请上传真实、清晰的银行电子回单",
    });
  });

  it("实发工资只汇总工资回单并记录忽略数量", () => {
    expect(
      buildHumanCostReceiptRecognition([6626.69], {
        ignoredItemCount: 2,
      }),
    ).toEqual({
      recognizedAmount: "6626.69",
      recognitionStatus: "recognized",
      recognizedItemCount: 1,
      totalItemCount: 1,
      ignoredItemCount: 2,
      recognitionError: null,
    });
  });

  it("实发工资只要识别到有效工资回单就不进入待核对", () => {
    expect(
      buildHumanCostReceiptRecognition([6626.69, null], {
        validationErrors: ["另一页无法校验"],
        acceptRecognizedItemsWithoutReview: true,
      }),
    ).toEqual({
      recognizedAmount: "6626.69",
      recognitionStatus: "recognized",
      recognizedItemCount: 1,
      totalItemCount: 2,
      ignoredItemCount: 0,
      recognitionError: null,
    });
  });

  it("只在摘要、用途、备注或客户附言中识别工资语义", () => {
    expect(isSalaryPaymentProofText("摘要：工资\n用途：工资")).toBe(true);
    expect(isSalaryPaymentProofText("备注：2026年6月员工薪资发放")).toBe(true);
    expect(isSalaryPaymentProofText("客户附言：工资-邵长腾-2026年6月")).toBe(
      true,
    );
    expect(isSalaryPaymentProofText("摘要：社保\n备注：保险缴费")).toBe(false);
  });
});
