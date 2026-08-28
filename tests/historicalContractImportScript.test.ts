jest.mock("nanoid", () => ({ nanoid: () => "historical-test-id" }));

import {
  HISTORICAL_IMPORT_VIRTUAL_SEQUENCE,
  loadHistoricalImportPlan,
  parseScriptArguments,
} from "../server/scripts/import-confirmed-historical-contracts.js";

describe("确认版历史合同一次性开发导入", () => {
  const plan = loadHistoricalImportPlan();

  test("冻结确认范围只生成75个合同族并排除红色及丰台门头沟", () => {
    expect(plan.summary.familyCount).toBe(75);
    expect(plan.families).toHaveLength(75);
    expect(plan.excludedSequences).toEqual([
      18, 35, 36, 44, 45, 70, 71, 72, 73, 74, 75, 76, 77, 82, 83, 84, 85,
    ]);
    expect(
      plan.families.some((family) =>
        /国网(?:丰台|门头沟)/u.test(family.sourceFolder),
      ),
    ).toBe(false);
  });

  test("四个绿色合同族全部落入资产采购支出", () => {
    const green = plan.families.filter((family) =>
      [78, 79, 80, 81].includes(family.sequence),
    );
    expect(green).toHaveLength(4);
    for (const family of green) {
      expect(family).toMatchObject({
        category: "asset",
        declaredSubtype: "procurement",
        assetCategory: "procurement",
      });
      expect(family.area).toBe("海淀区");
    }
    expect(
      green.find((family) => family.sequence === 79)?.contractDate,
    ).toBe("2025-12-08");
  });

  test("唯一虚拟合同没有签订日期且报价单只作为普通附件", () => {
    const virtual = plan.families.find(
      (family) => family.sequence === HISTORICAL_IMPORT_VIRTUAL_SEQUENCE,
    );
    expect(virtual).toBeDefined();
    expect(virtual).toMatchObject({
      virtualContract: true,
      contractDate: null,
      originalAmount: 3500,
      currentAmountBeforeTermination: 3500,
    });
    expect(virtual!.description).toContain("无合同原件");
    expect(virtual!.description).not.toContain("需确认");
    expect(virtual!.mainFile?.ext).toBe(".jpg");
  });

  test("确认的土地框架上游协议进入辅助档案且红色成本目录不递归混入", () => {
    const sujiatuo = plan.families.find((family) => family.sequence === 46)!;
    expect(sujiatuo.auxiliaryPackages).toHaveLength(1);
    expect(sujiatuo.auxiliaryPackages[0]?.label).toBe("2023年土地手续框架协议");
    expect(sujiatuo.auxiliaryPackages[0]?.files).toHaveLength(1);
    expect(sujiatuo.auxiliaryPackages[0]?.files[0]?.kind).toBe("contract");
    expect(
      plan.referencedSourceFiles.some((file) =>
        /\/2-工程→筑联天合(?:√)?\//u.test(file.relativePath),
      ),
    ).toBe(false);
  });

  test("跃进合同的同名文档格式只形成两次补充协议事件", () => {
    const yuejin = plan.families.find((family) => family.sequence === 53)!;
    expect(yuejin.supplements).toHaveLength(2);
    expect(
      yuejin.supplements.map((agreement) => agreement.amountDelta),
    ).toEqual([20000, -60000]);
    expect(yuejin.warnings.join("；")).toContain("只建立两条协议记录");
  });

  test("命令行必须显式且只能选择预演或提交", () => {
    expect(parseScriptArguments(["--dry-run"]).mode).toBe("dry-run");
    expect(parseScriptArguments(["--commit"]).mode).toBe("commit");
    expect(() => parseScriptArguments([])).toThrow(
      "必须且只能指定 --dry-run 或 --commit",
    );
    expect(() => parseScriptArguments(["--dry-run", "--commit"])).toThrow(
      "必须且只能指定 --dry-run 或 --commit",
    );
  });
});
