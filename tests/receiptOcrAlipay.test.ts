jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcr: jest.fn(),
}));

import { parseRecognizedReceiptText } from "../server/services/receiptOcr";

const samples = [
  {
    name: "闲鱼状态栏电量不得覆盖千位金额",
    text: `00:21
284
账单详情
闲鱼
x***9
-2,375.00
支付成功
支付时间
2026-08-25 22:20:15
付款方式
工商银行储蓄卡(4844)
商品说明
专拍`,
    amount: 2375,
    date: "2026-08-25",
  },
  {
    name: "天猫待确认收货千位金额",
    text: `账单详情
天猫
co**店
-1,107.00
等待确认收货
支付时间
2026-08-24 20:35:57
付款方式
工商银行储蓄卡(7354)`,
    amount: 1107,
    date: "2026-08-24",
  },
  {
    name: "美团春饼",
    text: `账单详情
美团
-128.00
交易成功
支付时间
2026-08-23 19:36:11
商品说明
姥姥家春饼店-美团App-2608231110030001302252743420245`,
    amount: 128,
    date: "2026-08-23",
  },
  {
    name: "美团麦当劳",
    text: `账单详情
美团
-45.90
交易成功
支付时间
2026-08-23 12:42:36
商品说明
麦当劳&麦咖啡-美团App-26082311100300001302166658663245`,
    amount: 45.9,
    date: "2026-08-23",
  },
  {
    name: "美团海底捞",
    text: `账单详情
美团
-183.88
交易成功
支付时间
2026-08-21 20:35:27
商品说明
海底捞火锅-美团App-26082111100300001301886018093245`,
    amount: 183.88,
    date: "2026-08-21",
  },
  {
    name: "哈啰自动扣款",
    text: `账单详情
哈啰出行
-1.99
自动扣款成功
支付时间
2026-08-20 20:24:43
收款方全称
上海哈啰普惠科技有限公司`,
    amount: 1.99,
    date: "2026-08-20",
  },
  {
    name: "盒马交易成功",
    text: `账单详情
盒马
-11.83
交易成功
支付时间
2026-08-16 20:45:09
收款方全称
北京盒马网络科技有限公司`,
    amount: 11.83,
    date: "2026-08-16",
  },
] as const;

describe("支付宝账单详情识别", () => {
  it.each(samples)("准确识别$name", ({ text, amount, date }) => {
    const result = parseRecognizedReceiptText(text);
    expect(result.amount).toBe(amount);
    expect(result.date).toBe(date);
    expect(result.itemName).toBe("无票报销");
    // 当前截图没有展开“更多”，不得把商品订单号猜成支付宝交易单号。
    expect(result.transactionNo).toBe("");
  });

  it("等待付款而非等待确认收货时继续拒绝", () => {
    expect(() =>
      parseRecognizedReceiptText(`账单详情
-1,107.00
等待付款
支付时间
2026-08-24 20:35:57
付款方式
工商银行储蓄卡`),
    ).toThrow("此不是支付截图，请重新上传");
  });
});
