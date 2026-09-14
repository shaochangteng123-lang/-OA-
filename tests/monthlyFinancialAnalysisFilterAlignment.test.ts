import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "src/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue",
  ),
  "utf8",
);

describe("财务分析商务筛选框对齐", () => {
  it("商务报销范围级联框与同排筛选控件统一为56像素高度", () => {
    expect(source).toContain("--financial-filter-control-height: 56px");
    expect(source).toContain(
      ".analysis-filters > .business-filter :deep(.el-cascader)",
    );
    expect(source).toContain(
      "--el-input-height: var(--financial-filter-control-height)",
    );
    expect(source).toContain(
      ".analysis-filters > .business-filter :deep(.el-cascader .el-input__wrapper)",
    );
    expect(source).toContain(
      "min-height: var(--financial-filter-control-height)",
    );
    expect(source).toContain("height: var(--financial-filter-control-height)");
  });
});
