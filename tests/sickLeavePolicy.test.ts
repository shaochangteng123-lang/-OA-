import fs from "fs";
import path from "path";
import { resolveLeaveTypeBalancePolicy } from "../server/utils/leave-type-policy";

describe("病假余额检查配置策略", () => {
  it("后端尊重病假开关，同时保留其他固定和自定义类型规则", () => {
    expect(resolveLeaveTypeBalancePolicy("sick", true, 30)).toEqual({
      requiresBalanceCheck: true,
      defaultDays: 30,
    });
    expect(resolveLeaveTypeBalancePolicy("sick", false, 3)).toEqual({
      requiresBalanceCheck: false,
      defaultDays: 3,
    });
    expect(resolveLeaveTypeBalancePolicy("annual", false, 5)).toEqual({
      requiresBalanceCheck: true,
      defaultDays: 5,
    });
    expect(resolveLeaveTypeBalancePolicy("custom_unpaid", false, 0)).toEqual({
      requiresBalanceCheck: false,
      defaultDays: 0,
    });
    const calculatorSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/leaveCalculator.ts"),
      "utf8",
    );
    expect(calculatorSource).toContain("sick: 30");

    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/leave.ts"),
      "utf8",
    );
    expect(routeSource).toContain("resolveLeaveTypeBalancePolicy(");
    expect(routeSource).toContain(
      "const nextRequiresBalanceCheck = balancePolicy.requiresBalanceCheck",
    );
  });

  it("数据库初始化保留病假附件要求，启动迁移不强制开关状态", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    const seedStart = source.indexOf('id: "lt_sick"');
    const seedEnd = source.indexOf("sort_order: 3", seedStart);
    const sickSeed = source.slice(seedStart, seedEnd);

    expect(seedStart).toBeGreaterThanOrEqual(0);
    expect(seedEnd).toBeGreaterThan(seedStart);
    expect(sickSeed).toContain("requires_attachment: true");
    expect(sickSeed).toContain("requires_balance_check: true");
    expect(sickSeed).toContain("default_days: 30");

    const fixedMigrationStart = source.indexOf(
      "SET requires_balance_check = true",
    );
    const fixedMigrationEnd = source.indexOf(
      "AND requires_balance_check = false",
      fixedMigrationStart,
    );
    const fixedMigration = source.slice(fixedMigrationStart, fixedMigrationEnd);
    expect(fixedMigration).not.toContain("'sick'");
    expect(source).not.toContain("const sickLeaveUnlimitedMigration");
  });

  it("前端允许修改病假开关并使用通用说明", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/leave/LeaveAdminPanel.vue"),
      "utf8",
    );
    expect(source).toContain(':disabled="isFixedBalanceType(editTypeCode)"');
    expect(source).toContain("开启后请假时检查剩余天数");
    expect(source).not.toContain("UNLIMITED_BALANCE_TYPE_CODES");
  });
});
