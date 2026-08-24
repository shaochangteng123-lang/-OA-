jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcr: jest.fn(),
}));

import {
  parseAndValidatePaymentProofText,
  resolveConsistentPaymentProofTransactionDate,
} from "../server/services/paymentProofOcr";

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
    expect(result.electronicReceiptNo).toBe("0917-8226-7633-1100");
    expect(result.transactionSerialNo).toBe("92087313");
    expect(result.transactionDate).toBe("2026-07-21");
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
    expect(result.electronicReceiptNo).toBe("0914-4918-5273-1100");
    expect(result.transactionSerialNo).toBe("4985273");
    expect(result.transactionDate).toBe("2026-06-30");
  });

  it("报销回单可识别中文记账日期并归一化", () => {
    const result = parseAndValidatePaymentProofText(
      `
中国工商银行 网上银行电子回单
电子回单号码：0914-4918-5273-2200
付款人：北京羽隶工程咨询有限公司
收款人：赵双
收款账号：6212260200012345678
金额 ¥1,000.00元
记账日期：2026年8月3日
交易流水号：52732200
`,
      { requireTransactionDate: true },
    );

    expect(result.transactionDate).toBe("2026-08-03");
    expect(result.transactionDateCandidates).toEqual(["2026-08-03"]);
  });

  it("可识别银行常见的交易日期和时间组合标签", () => {
    const result = parseAndValidatePaymentProofText(
      `
中国工商银行 网上银行电子回单
电子回单号码：0914-4918-5273-2250
付款人：北京羽隶工程咨询有限公司
收款人：赵双
收款账号：6212260200012345678
金额 ¥1,000.00元
交易日期和时间：2026/08/05 09:30:12
交易流水号：52732250
`,
      { requireTransactionDate: true },
    );

    expect(result.transactionDate).toBe("2026-08-05");
  });

  it("报销回单缺少明确交易日期时不允许提交", () => {
    expect(() =>
      parseAndValidatePaymentProofText(
        `
中国工商银行 网上银行电子回单
电子回单号码：0914-4918-5273-3300
付款人：北京羽隶工程咨询有限公司
收款人：赵双
收款账号：6212260200012345678
金额 ¥1,000.00元
打印日期：2026-08-04
`,
        { requireTransactionDate: true },
      ),
    ).toThrow("无法识别回单实际交易日期");
  });

  it("同一回单出现不一致的交易日期时阻断", () => {
    expect(() =>
      parseAndValidatePaymentProofText(
        `
中国工商银行 网上银行电子回单
电子回单号码：0914-4918-5273-4400
付款人：北京羽隶工程咨询有限公司
收款人：赵双
收款账号：6212260200012345678
金额 ¥1,000.00元
交易时间：2026-08-03 10:20:30
记账日期：2026-08-04
`,
        { requireTransactionDate: true },
      ),
    ).toThrow("多个不一致的交易日期");
  });

  it("多张回单只有交易日期一致时才能归属同一月份", () => {
    expect(
      resolveConsistentPaymentProofTransactionDate([
        "2026-08-03",
        "2026-08-03",
      ]),
    ).toBe("2026-08-03");
    expect(() =>
      resolveConsistentPaymentProofTransactionDate([
        "2026-08-03",
        "2026-09-01",
      ]),
    ).toThrow("不能确定唯一归属月份");
  });
});
