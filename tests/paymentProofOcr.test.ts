jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcr: jest.fn(),
}));

import {
  extractPaymentProofPartyAccounts,
  parseAndValidatePaymentProofText,
  parsePaymentProofText,
  resolveConsistentPaymentProofTransactionDate,
} from "../server/services/paymentProofOcr";

describe("付款回单收款人识别", () => {
  it("唯一长账号已明确属于付款方时不复制为收款账号", () => {
    const text = `
招商银行 出账回单
回单编号：979B2U1132024
交易日期：2026年04月30日
付款账号：110933697910902
付款人：北京羽隶科技有限公司
收款人：
收款开户行：中国建设银行北京燕莎东支行
交易金额（小写）：CNY195.30
`;

    expect(extractPaymentProofPartyAccounts(text)).toEqual({
      payerAccount: "110933697910902",
      payeeAccount: "",
    });
    expect(parsePaymentProofText(text)).toMatchObject({
      payer: "北京羽隶科技有限公司",
      payee: "",
      payeeAccount: "",
      amount: 195.3,
    });
  });

  it.each([
    "收款账号：11001053000056004126",
    "收款开户行：中国建设银行北京燕莎东支行",
    "开户银行：中国建设银行北京燕莎东支行",
  ])("空收款人标签不吞下一字段：%s", (nextField) => {
    const result = parsePaymentProofText(`
招商银行 出账回单
交易日期：2026年04月30日
付款账号：110933697910902
付款人：北京羽隶科技有限公司
收款人：
${nextField}
交易金额（小写）：CNY195.30
回单编号：979B2U1132024
`);

    expect(result.payee).toBe("");
    expect(result.payee).not.toContain("账号");
    expect(result.payee).not.toContain("开户");
  });

  it("明确收款人和收款账号仍按原规则识别", () => {
    const result = parsePaymentProofText(`
招商银行 出账回单
交易日期：2026年04月30日
付款账号：110933697910902
付款人：北京羽隶科技有限公司
收款账号：11001053000056004126
收款人：国航物业酒店管理有限公司国航大厦分公司
交易金额（小写）：CNY195.30
回单编号：979B2U1132024
`);

    expect(result).toMatchObject({
      payer: "北京羽隶科技有限公司",
      payee: "国航物业酒店管理有限公司国航大厦分公司",
      payeeAccount: "11001053000056004126",
      amount: 195.3,
    });
  });

  it("工商银行双列表格按付款、收款列配对账号并保留票面分位金额", () => {
    const rawText = `
中国工商银行
网上银行电子回单
电子回单号码：0914-4933-8877-1100
户名
北京羽隶工程咨询有限公司
户名
北京羽隶科技有限公司
付款
收款
账号
0200303519000018418
账号
110933697910902
人
人
开户银行
海淀万寿支行
开户银行
招商银行股份有限公司
金额
金额（大写）
人民币柒万玖仟捌佰壹拾捌元叁角陆
¥79,818.36元
分
摘要
其他款项
业务（产品）种类 网银互联
用途
其他款项
交易流水号
58939661
时间戳
2026-05-25-12.57.05.850570
备注：其他款项
`;

    expect(extractPaymentProofPartyAccounts(rawText)).toEqual({
      payerAccount: "0200303519000018418",
      payeeAccount: "110933697910902",
    });
    const result = parseAndValidatePaymentProofText(rawText);
    expect(result.payer).toBe("北京羽隶工程咨询有限公司");
    expect(result.payee).toBe("北京羽隶科技有限公司");
    expect(result.payeeAccount).toBe("110933697910902");
    expect(result.amount).toBe(79_818.36);
    expect(result.transactionDate).toBe("2026-05-25");
  });

  it("收费回单同时含票面金额十八元和应收二十元时取票面主金额", () => {
    const result = parseAndValidatePaymentProofText(`
中国工商银行 收费回单
电子回单号码：0917-8226-7633-1800
付款人：北京羽隶工程咨询有限公司
付款账号：0200303519000018418
收款人：中国工商银行北京海淀支行
收款账号：0200000000000000001
金额 ¥18.00元
应收金额：¥20.00
实收金额：¥18.00
摘要：跨行手续费
交易日期：2026-08-20
交易流水号：92087318
`);

    expect(result.amount).toBe(18);
  });

  it("金额标签漏识别时优先采用中文大写金额而不是账户余额", () => {
    const result = parseAndValidatePaymentProofText(`
中国工商银行 网上银行电子回单
电子回单号码：0917-8226-7633-1900
付款人：北京羽隶工程咨询有限公司
付款账号：0200303519000018418
收款人：测试收款人
收款账号：6212260200012345678
账户余额：123.45
人民币壹仟元整
交易日期：2026-08-20
`);

    expect(result.amount).toBe(1000);
  });

  it("金额标签和中文大写金额都缺失时不从全文小数猜测", () => {
    expect(() =>
      parseAndValidatePaymentProofText(`
中国工商银行 网上银行电子回单
电子回单号码：0917-8226-7633-1950
付款人：北京羽隶工程咨询有限公司
付款账号：0200303519000018418
收款人：测试收款人
收款账号：6212260200012345678
账户余额：123.45
交易日期：2026-08-20
`),
    ).toThrow("无法识别回单金额");
  });

  it("缺少票面金额栏时不把唯一的带货币符号账户余额当作金额", () => {
    expect(() =>
      parseAndValidatePaymentProofText(`
中国工商银行 网上银行电子回单
电子回单号码：0917-8226-7633-1960
付款人：北京羽隶工程咨询有限公司
付款账号：0200303519000018418
收款人：测试收款人
收款账号：6212260200012345678
账户余额：¥123.45元
交易日期：2026-08-20
`),
    ).toThrow("无法识别回单金额");
  });

  it.each([
    ["壹亿贰仟万元整", 120_000_000],
    ["壹亿贰仟叁佰肆拾伍万陆仟柒佰捌拾玖元整", 123_456_789],
    ["壹佰元伍角陆分", 100.56],
    ["壹亿贰仟万元伍角陆分", 120_000_000.56],
    ["壹佰元零陆分", 100.06],
    ["零元零陆分", 0.06],
    ["伍角陆分", 0.56],
  ])("按亿、万、元分节解析中文大写金额 %s", (uppercaseAmount, expected) => {
    const result = parseAndValidatePaymentProofText(`
中国工商银行 网上银行电子回单
电子回单号码：0917-8226-7633-1990
付款人：北京羽隶工程咨询有限公司
付款账号：0200303519000018418
收款人：测试收款人
收款账号：6212260200012345678
人民币${uppercaseAmount}
交易日期：2026-08-20
`);

    expect(result.amount).toBe(expected);
  });

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
