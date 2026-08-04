import {
  accountMatches,
  nameMatches,
  recipientMatches,
} from "../server/utils/bank-receipt-match";

describe("银行回单收款人匹配", () => {
  it("两字姓名只允许完整匹配", () => {
    expect(nameMatches("刘行", "刘行")).toBe(true);
    expect(nameMatches("刘行", "行")).toBe(false);
    expect(nameMatches("刘行", "银行")).toBe(false);
    expect(nameMatches("赵双", "赵")).toBe(false);
  });

  it("三字及以上姓名允许在收款人字段中缺失一个字", () => {
    expect(nameMatches("吴静雯", "吴静")).toBe(true);
    expect(nameMatches("邵长腾", "邵腾")).toBe(true);
    expect(nameMatches("吴静雯", "静")).toBe(false);
  });

  it("收款账号忽略空格后必须完整一致", () => {
    expect(
      accountMatches("6212 2602 0012 1854 844", "6212260200121854844"),
    ).toBe(true);
    expect(
      accountMatches("6212260200121854844", "0200049609201258271"),
    ).toBe(false);
    expect(accountMatches("6212260200121854844", "1854844")).toBe(false);
  });

  it("双方账号都有值时账号不一致不能由姓名放行", () => {
    expect(
      recipientMatches(
        "刘行",
        "6212260200121854844",
        "刘行",
        "0200049609201258271",
      ),
    ).toBe(false);
  });

  it("双方账号一致时允许收款人字段缺失", () => {
    expect(
      recipientMatches(
        "刘行",
        "6212260200121854844",
        "",
        "6212260200121854844",
      ),
    ).toBe(true);
  });

  it("任一方账号缺失时仅使用收款人字段匹配", () => {
    expect(recipientMatches("刘行", "6212260200121854844", "刘行", "")).toBe(
      true,
    );
    expect(recipientMatches("刘行", "6212260200121854844", "银行", "")).toBe(
      false,
    );
  });
});
