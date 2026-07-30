import { getCurrentMonthStartIso } from "../server/utils/leaveDraft";

describe("请假草稿月底清理边界", () => {
  it("返回当前自然月第一天的本地零点", () => {
    const result = new Date(
      getCurrentMonthStartIso(new Date(2026, 6, 17, 15, 30, 0)),
    );

    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(6);
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });

  it("跨年时返回一月第一天", () => {
    const result = new Date(
      getCurrentMonthStartIso(new Date(2027, 0, 8, 9, 0, 0)),
    );

    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(1);
  });
});
