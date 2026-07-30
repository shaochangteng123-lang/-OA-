import {
  CONTRACT_EXPIRY_REMINDER_DAYS,
  formatContractDate,
  getContractExpiryReminder,
} from "@/utils/contractReminder";

describe("劳动合同到期提醒", () => {
  const today = new Date(2026, 6, 17, 12);

  test("与管理员规则一致，从到期前10天开始提醒", () => {
    const beforeWindow = getContractExpiryReminder(
      "2026-07-28",
      "active",
      today,
    );
    const atWindowStart = getContractExpiryReminder(
      "2026-07-27",
      "active",
      today,
    );

    expect(CONTRACT_EXPIRY_REMINDER_DAYS).toBe(10);
    expect(beforeWindow.shouldRemind).toBe(false);
    expect(atWindowStart).toEqual({
      shouldRemind: true,
      status: "upcoming",
      daysRemaining: 10,
    });
  });

  test("到期当天和过期后持续提醒", () => {
    expect(getContractExpiryReminder("2026-07-17", "active", today)).toEqual({
      shouldRemind: true,
      status: "today",
      daysRemaining: 0,
    });
    expect(getContractExpiryReminder("2026-07-16", "active", today)).toEqual({
      shouldRemind: true,
      status: "expired",
      daysRemaining: -1,
    });
  });

  test("已离职、空日期和无效日期不提醒", () => {
    expect(
      getContractExpiryReminder("2026-07-20", "resigned", today).shouldRemind,
    ).toBe(false);
    expect(getContractExpiryReminder(null, "active", today).shouldRemind).toBe(
      false,
    );
    expect(
      getContractExpiryReminder("2026-02-30", "active", today).shouldRemind,
    ).toBe(false);
  });

  test("合同日期按中文格式展示", () => {
    expect(formatContractDate("2026-07-27")).toBe("2026年07月27日");
    expect(formatContractDate("无效日期")).toBe("");
  });
});
