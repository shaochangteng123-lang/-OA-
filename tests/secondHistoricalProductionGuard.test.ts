/** @jest-environment node */

import type { SecondHistoricalImportPlan } from "../server/scripts/second-historical-import-plan";
import {
  calculateSecondHistoricalSemanticSha256,
  calculateSecondHistoricalTargetDatabaseSha256,
  secondHistoricalStableId,
} from "../server/scripts/second-historical-production-guard";

function source() {
  return {
    absolutePath: "/source/a.pdf",
    relativePath: "主营项目合同/a.pdf",
    directory: "主营项目合同",
    name: "a.pdf",
    extension: ".pdf",
    bytes: 10,
    hash: "a".repeat(64),
    auxiliary: false,
    kind: "main" as const,
    amount: 100,
    businessDate: "2026-01-01",
    familyId: "family-1",
  };
}

function plan(projectName = "项目甲"): SecondHistoricalImportPlan {
  const file = source();
  const family = {
    id: "family-1",
    directory: "主营项目合同",
    projectName,
    category: "main_business" as const,
    declaredSubtype: "engineering_consulting" as const,
    area: "全部",
    partyA: "甲方",
    partyB: "北京羽隶工程咨询有限公司",
    mainFileName: file.name,
    expectedInvoiceAmount: 100,
    expectedSettlementAmount: 100,
  };
  const root = {
    key: "family-1:a.pdf",
    family,
    rootSpec: { mainFileName: file.name },
    source: file,
    projectName,
    businessContractNo: "YW-001",
    contractDate: "2026-01-01",
    originalAmount: 100,
    currentAmount: 100,
    financialDirection: "income" as const,
    agreements: [],
    financialFacts: [],
    archiveFiles: [],
    auxiliaryFiles: [],
    restoreContractId: null,
  };
  return {
    sourceRoot: "/source",
    manifestHash: "b".repeat(64),
    totalBytes: 10,
    sourceFiles: [file],
    roots: [root],
    assignments: [
      {
        relativePath: file.relativePath,
        hash: file.hash,
        familyId: family.id,
        rootKey: root.key,
        target: "sealed_contract",
        accountingIncluded: false,
      },
    ],
    summary: {
      sourceFileCount: 1,
      rootContractCount: 1,
      restoredContractCount: 0,
      supplementCount: 0,
      terminationCount: 0,
      invoiceCount: 0,
      receiptCount: 0,
      paymentCount: 0,
      auxiliaryFileCount: 0,
      archiveFileCount: 0,
      incomeContractCount: 1,
      costContractCount: 0,
      invoiceAmount: 0,
      incomeSettlementAmount: 0,
      costSettlementAmount: 0,
    },
  };
}

describe("第二批生产语义与目标库摘要", () => {
  it("业务语义变化独立改变语义摘要", () => {
    expect(calculateSecondHistoricalSemanticSha256(plan("项目甲"))).not.toBe(
      calculateSecondHistoricalSemanticSha256(plan("项目乙")),
    );
  });

  it("合同原件改为辅助材料会改变业务语义摘要", () => {
    const standalone = plan();
    const auxiliary = plan();
    const extraSource = {
      ...source(),
      absolutePath: "/source/旧合同.pdf",
      relativePath: "主营项目合同/旧合同.pdf",
      name: "旧合同.pdf",
      hash: "c".repeat(64),
    };
    standalone.sourceFiles.push(extraSource);
    standalone.roots.push({
      ...standalone.roots[0]!,
      key: "family-1:旧合同.pdf",
      rootSpec: { mainFileName: extraSource.name },
      source: extraSource,
      agreements: [],
      financialFacts: [],
      archiveFiles: [],
      auxiliaryFiles: [],
    });
    standalone.assignments.push({
      relativePath: extraSource.relativePath,
      hash: extraSource.hash,
      familyId: "family-1",
      rootKey: "family-1:旧合同.pdf",
      target: "sealed_contract",
      accountingIncluded: false,
    });

    auxiliary.sourceFiles.push(extraSource);
    auxiliary.roots[0]!.auxiliaryFiles.push(extraSource);
    auxiliary.assignments.push({
      relativePath: extraSource.relativePath,
      hash: extraSource.hash,
      familyId: "family-1",
      rootKey: auxiliary.roots[0]!.key,
      target: "auxiliary",
      accountingIncluded: false,
    });

    expect(calculateSecondHistoricalSemanticSha256(standalone)).not.toBe(
      calculateSecondHistoricalSemanticSha256(auxiliary),
    );
  });

  it("目标库摘要排除计划新合同并掩码龙潭湖允许变化字段", async () => {
    const targetPlan = plan();
    const queriedIds: string[][] = [];
    const calculate = (
      dragonStatus: string,
      ordinaryStatus: string,
      dragonRequiresAuxiliary = false,
    ) =>
      calculateSecondHistoricalTargetDatabaseSha256(
        {
          query: jest.fn(async (sql: string, values?: readonly unknown[]) => {
            if (sql.includes("pg_control_system")) {
              return {
                rows: [
                  {
                    database_name: "yulilog_worklog",
                    database_oid: "16384",
                    database_user: "postgres",
                    system_identifier: "7654321",
                  },
                ],
              };
            }
            queriedIds.push((values?.[0] || []) as string[]);
            return {
              rows: [
                {
                  id: "ordinary",
                  snapshot: {
                    id: "ordinary",
                    status: ordinaryStatus,
                    project_name: "既有合同",
                    updated_at: "任意更新时间",
                  },
                },
                {
                  id: "sdylIKVZJDN8jYQ342rOL",
                  snapshot: {
                    id: "sdylIKVZJDN8jYQ342rOL",
                    status: dragonStatus,
                    version: dragonStatus === "completed" ? 8 : 7,
                    is_deleted: dragonStatus !== "completed",
                    updated_by: dragonStatus,
                    requires_auxiliary_materials: dragonRequiresAuxiliary,
                    project_name: "龙潭湖-弘善110kv线路工程建设项目",
                  },
                },
              ],
            };
          }),
        },
        targetPlan,
      );

    const before = await calculate("executing", "effective");
    const afterDragonRestore = await calculate("completed", "effective", true);
    const changedOtherContract = await calculate("completed", "completed");
    expect(before).toBe(afterDragonRestore);
    expect(before).not.toBe(changedOtherContract);
    expect(queriedIds[0]).toContain(
      secondHistoricalStableId("contract", targetPlan.roots[0]!.key),
    );
  });
});
