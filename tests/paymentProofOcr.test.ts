jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcr: jest.fn(),
}));

import { parseAndValidatePaymentProofText } from "../server/services/paymentProofOcr";

describe("付款回单收款人识别", () => {
  it("第二个户名标签缺失时仍能识别住房公积金管理中心", () => {
    const result = parseAndValidatePaymentProofText(`
中国工商银行 网上银行电子回单（补打）
电子回单号码：0917-8226-7633-1100
付款人 户名 北京羽隶工程咨询有限公司
账号 0200049609201258271
北京住房公积金管理中心
账号 0200066019025904086
金额 ¥6,360.00元
摘要 委托收款
交易流水号 92087313
时间戳 2026-07-21-12.28.05.532979
`);

    expect(result.payee).toBe("北京住房公积金管理中心");
    expect(result.payeeAccount).toBe("0200066019025904086");
    expect(result.amount).toBe(6360);
  });

  it("明确的实发工资回单允许账号漏识别并保留姓名关联", () => {
    const text = `
中国工商银行 网上银行电子回单
电子回单号码：0914-4918-5273-1100
付款人 户名 北京羽隶工程咨询有限公司
收款人：赵双
金额 ¥7,596.69元
摘要 工资
备注：2026年5月员工薪资发放
交易流水号 4985273
交易时间 2026-06-30 12:20:12
`;

    expect(() => parseAndValidatePaymentProofText(text)).toThrow(
      "无法识别收款账号",
    );

    const result = parseAndValidatePaymentProofText(text, {
      allowMissingPayeeAccount: true,
    });
    expect(result.payee).toBe("赵双");
    expect(result.payeeAccount).toBe("");
    expect(result.amount).toBe(7596.69);
  });
});
