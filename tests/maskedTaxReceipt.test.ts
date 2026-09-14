/** @jest-environment node */
jest.mock("../server/services/ocrDaemon", () => ({ callPaddleOcr: jest.fn() }));
jest.mock("../server/services/bankReceiptProcessor", () => ({
  recognizeBankReceiptImage: jest.fn(),
  analyzePageXml: jest.fn(),
  splitImage: jest.fn(),
}));

import { recognizeBankReceiptImage } from "../server/services/bankReceiptProcessor";
import { recognizeHumanCostReceipt } from "../server/services/humanCostReceiptOcr";
import {
  parseAndValidatePaymentProofText,
  parsePaymentProofText,
} from "../server/services/paymentProofOcr";

// 保留原图真实识别的错行、付款账号漏识及备注干扰，替换企业和凭证编号。
const receiptText = `中国工商银行
网上银行电子回单
电子回单号码：0920-1000-1000-1100
打印日期：2026年9月8日
户名
户名
付款
北京测试工程咨询有限公司
收人
待报解预算收入
账号
账号
0200099811**
开户银行
工行北京海淀支行
开户银行
中国工商银行
金额
¥302.41元
金额（大写）
人民币叁佰零贰元肆角壹分
摘要
代理国库税收收缴
业务（产品）种类银税业务
用途
代理国库税收收缴
交易流水号
44740000
时间戳
2026-09-01-13.42.18.763569
备注：26740000
person:626090111959000000
记账日期
2026年09月01日`;

const options = { allowMaskedTaxPayeeAccount: true };

describe("国库税款遮挡账号回单", () => {
  it.each([
    {
      name: "补打回单大小写金额错行",
      receiptNo: "0920-5000-9000-1100",
      amount: "19,834.44",
      capital: "人民币壹万玖仟捌佰叁拾肆元肆角肆\n¥19,834.44元\n金额（大写）\n分",
      accountLayout:
        "付款\n账号\n0200049609201000000\n账号\n0200099811**\n人",
      date: "2026-09-11",
    },
    {
      name: "补打回单双账号先后错行",
      receiptNo: "0920-2000-5000-1100",
      amount: "40.17",
      capital: "¥40.17元\n金额（大写）\n人民币肆拾元壹角柒分",
      accountLayout:
        "付款\n收款\n账号\n账号\n0200049609201000000\n人\n0200099811***\n人",
      date: "2026-09-03",
    },
  ])("兼容工行第1次补打的真实错行：$name", async (sample) => {
    const text = `中国工商银行
网上银行电子回单（补打）
电子回单号码：${sample.receiptNo}
第1次补打
户名
北京测试工程咨询有限公司
户名
待报解预算收入
${sample.accountLayout}
开户银行
工行北京海淀支行
开户银行
中国工商银行
金额
${sample.capital}
摘要
代理国库税收收缴
业务（产品）种类银税业务
用途
代理国库税收收缴
交易流水号
34570000
时间戳
${sample.date}-15.44.22.406316
记账日期
${sample.date}`;
    jest.mocked(recognizeBankReceiptImage).mockResolvedValue({
      rawText: text,
    } as Awaited<ReturnType<typeof recognizeBankReceiptImage>>);

    const result = await recognizeHumanCostReceipt(
      "/tmp/社保补打回单.jpg",
      "image/jpeg",
      sample.name,
      "social_security",
    );

    expect(result).toMatchObject({
      recognitionStatus: "recognized",
      recognizedAmount: sample.amount.replace(",", ""),
      recognitionError: null,
    });
    expect(result.items[0]).toMatchObject({
      payeeName: "待报解预算收入",
      payeeAccount: "",
      electronicReceiptNo: sample.receiptNo,
    });
  });

  it.each([
    "金额\n人民币壹万玖仟肆佰贰拾贰元贰角柒\n￥19,422.27元\n金额（大写）\n分",
    "人民币壹万玖仟肆佰贰拾贰元贰角柒\n金额\n￥19,422.27元\n金额（大写）\n分",
  ])("账号数字分行、大小写金额交错时不得丢失分位：%s", (amountBlock) => {
    const text = receiptText
      .replace(
        "账号\n账号\n0200099811**",
        "0200049609201000000\n0200099811********\n账号\n账号",
      )
      .replace(
        "金额\n¥302.41元\n金额（大写）\n人民币叁佰零贰元肆角壹分",
        amountBlock,
      );
    expect(parseAndValidatePaymentProofText(text, options).amount).toBe(
      19422.27,
    );
    expect(parseAndValidatePaymentProofText(text, options).payeeAccount).toBe(
      "",
    );
  });
  it("历史回单大写金额被标签插入换行时仍精确核对分位", () => {
    const text = receiptText.replace(
      "¥302.41元\n金额（大写）\n人民币叁佰零贰元肆角壹分",
      "￥19,794.27元\n人民币壹万玖仟柒佰玖拾肆元贰角柒\n金额（大写）\n分",
    );
    expect(parseAndValidatePaymentProofText(text, options).amount).toBe(
      19794.27,
    );
    expect(() =>
      parseAndValidatePaymentProofText(
        text.replace("19,794.27", "19,794.20"),
        options,
      ),
    ).toThrow("大小写金额");
    expect(() =>
      parseAndValidatePaymentProofText(
        text.replace("\n分\n摘要", "\n摘要\n分"),
        options,
      ),
    ).toThrow("大小写金额");
    expect(() =>
      parseAndValidatePaymentProofText(
        text.replace("\n摘要", "\n人民币壹元整\n摘要"),
        options,
      ),
    ).toThrow("大小写金额");
  });
  it("社保原图双栏错行、遮挡账号及备注编号不影响40.17元识别和电子回单号查重字段", async () => {
    const text = receiptText
      .replace("0920-1000-1000-1100", "0920-2021-0505-1100")
      .replace(
        "户名\n户名\n付款\n北京测试工程咨询有限公司\n收人\n待报解预算收入\n账号\n账号\n0200099811**",
        "户名\n北京测试工程咨询有限公司\n户名\n待报解预算收入\n付款\n收款\n账号\n0200049609201000000\n账号\n人\n人\n0200099811***",
      )
      .replace("¥302.41元", "¥40.17元")
      .replace("叁佰零贰元肆角壹分", "肆拾元壹角柒分")
      .replace("2026-09-01", "2026-09-03")
      .replace("2026年09月01日", "2026年09月03日");
    jest
      .mocked(recognizeBankReceiptImage)
      .mockResolvedValue({ rawText: text } as Awaited<
        ReturnType<typeof recognizeBankReceiptImage>
      >);
    const result = await recognizeHumanCostReceipt(
      "/tmp/社保回单.jpg",
      "image/jpeg",
      "测试社保",
      "social_security",
    );
    expect(result.recognitionStatus).toBe("recognized");
    expect(result.recognizedAmount).toBe("40.17");
    expect(result.items[0]).toMatchObject({
      payeeName: "待报解预算收入",
      payeeAccount: "",
      electronicReceiptNo: "0920-2021-0505-1100",
    });
    jest.mocked(recognizeBankReceiptImage).mockResolvedValue({
      rawText: text.replace("¥40.17", "¥40.11"),
    } as Awaited<ReturnType<typeof recognizeBankReceiptImage>>);
    const invalid = await recognizeHumanCostReceipt(
      "/tmp/社保回单.jpg",
      "image/jpeg",
      "测试社保",
      "social_security",
    );
    expect(invalid.recognizedAmount).toBe("0.00");
    expect(invalid.recognitionError).toContain("大小写金额");
  });
  it.each(["social_security", "housing_fund"] as const)(
    "%s 缺电子回单号时不借用交易流水号入账",
    async (category) => {
      const text = `中国工商银行 网上银行电子回单
付款人：北京测试工程咨询有限公司
付款账号：0200049609201000000
收款人：待报解预算收入
收款账号：0200099811000000000
金额：¥302.41元
交易流水号：44740000
交易日期：2026-09-01`;
      jest.mocked(recognizeBankReceiptImage).mockResolvedValue({
        rawText: text,
      } as Awaited<ReturnType<typeof recognizeBankReceiptImage>>);
      const result = await recognizeHumanCostReceipt(
        "/tmp/缺回单号.jpg",
        "image/jpeg",
        "测试回单",
        category,
      );
      expect(result.recognitionStatus).toBe("failed");
      expect(result.recognizedAmount).toBe("0.00");
      expect(result.recognitionError).toContain("未识别到电子回单号");
    },
  );
  it("原图版式按实际金额通过个税校验，备注长编号不得成为收款账号", () => {
    expect(
      parseAndValidatePaymentProofText(receiptText, options),
    ).toMatchObject({
      payee: "待报解预算收入",
      payeeAccount: "",
      amount: 302.41,
      transactionDate: "2026-09-01",
      electronicReceiptNo: "0920-1000-1000-1100",
    });
    expect(parsePaymentProofText(receiptText).payeeAccount).toBe("");
  });

  it("普通付款回单入口继续拒绝遮挡账号", () => {
    expect(() => parseAndValidatePaymentProofText(receiptText)).toThrow(
      "收款账号",
    );
  });

  it.each([
    [
      "全角星号",
      receiptText.replace("0200099811**", "０２０００９９８１１＊＊＊＊"),
    ],
    [
      "付款完整账号同时存在",
      receiptText.replace("账号\n账号", "账号\n0200049609201000000\n账号"),
    ],
  ])("兼容%s但不猜测完整收款账号", (_name, text) => {
    expect(parseAndValidatePaymentProofText(text, options).payeeAccount).toBe(
      "",
    );
  });

  it.each([
    ["金额不一致", receiptText.replace("¥302.41", "¥298.80")],
    ["大写金额缺失", receiptText.replace("人民币叁佰零贰元肆角壹分", "")],
    ["无国库用途", receiptText.replaceAll("代理国库税收收缴", "其他款项")],
    ["无银税业务", receiptText.replace("银税业务", "网银互联")],
    [
      "收款人不同",
      receiptText.replace("待报解预算收入", "北京测试科技有限公司"),
    ],
    [
      "无电子回单号",
      receiptText.replace("电子回单号码：0920-1000-1000-1100", ""),
    ],
    ["无交易流水", receiptText.replace("交易流水号\n44740000", "")],
    ["交易日期冲突", receiptText.replace("2026年09月01日", "2026年09月02日")],
    [
      "遮挡账号属于付款方",
      receiptText.replace(
        "0200099811**",
        "0200099811**\n账号\n0200099811000000000",
      ),
    ],
    [
      "多个遮挡账号",
      receiptText.replace("0200099811**", "0200099811**\n账号\n0200088811**"),
    ],
    [
      "遮挡数字位于备注",
      receiptText.replace("0200099811**", "").concat("\n备注：0200099811**"),
    ],
    ["界面截图", receiptText.concat("\n点击上传")],
  ])("拒绝%s，不能为通过识别而放宽证据", (_name, text) => {
    expect(() => parseAndValidatePaymentProofText(text, options)).toThrow();
  });

  it.each(["income_tax", "social_security", "housing_fund"] as const)(
    "从实际人力成本服务验证分类隔离：%s",
    async (category) => {
      jest
        .mocked(recognizeBankReceiptImage)
        .mockResolvedValue({ rawText: receiptText } as Awaited<
          ReturnType<typeof recognizeBankReceiptImage>
        >);
      const result = await recognizeHumanCostReceipt(
        "/tmp/税款回单.jpg",
        "image/jpeg",
        "测试回单",
        category,
      );
      expect(result.recognitionStatus).toBe(
        category !== "housing_fund" ? "recognized" : "failed",
      );
      expect(result.recognizedAmount).toBe(
        category !== "housing_fund" ? "302.41" : "0.00",
      );
      if (category !== "housing_fund")
        expect(result.items[0]?.payeeAccount).toBe("");
    },
  );
});
