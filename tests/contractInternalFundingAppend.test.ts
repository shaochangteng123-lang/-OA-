import fs from "node:fs";
import path from "node:path";

describe("工程咨询向签约公司的内部划拨补充", () => {
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const serviceSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/contractService.ts"),
    "utf8",
  );

  it("内部划拨绕开发票匹配余额并按独立资金链累计", () => {
    const start = routeSource.indexOf(
      "async function appendFinancialRegistrationSettlementJobs",
    );
    const end = routeSource.indexOf(
      "async function appendExternalPaymentJobs",
      start,
    );
    const source = routeSource.slice(start, end);

    expect(source).toContain("isEngineeringInternalFundingAppend");
    expect(source).toContain(
      "existingInternalFundingTotalCents = existingBankRows.rows.reduce",
    );
    expect(source).toContain(
      "existingInternalFundingTotalCents + bankTotalCents",
    );
    expect(source).toMatch(/\}\s*else if \(\s*!allowsPendingInvoiceReceipt/u);
    expect(source).not.toContain("INTERNAL_FUNDING_EXCEEDS_EXTERNAL_PAYMENT");
    expect(source).not.toContain("INTERNAL_FUNDING_INVOICE_MIXED_SUBMISSION");
  });

  it("本批内部划拨不生成发票匹配但允许同批发票重建外付匹配", () => {
    const branchStart = routeSource.indexOf(
      "} else if (isEngineeringInternalFundingAppend)",
    );
    const branchEnd = routeSource.indexOf("} else {", branchStart + 8);
    const branch = routeSource.slice(branchStart, branchEnd);

    expect(branch).toContain("rebuildDepositAffectedFinancialMatches");
    expect(branch).toContain("item_kind='external_payment'");
    expect(branch).toContain("allowUnallocatedSettlement: true");
    expect(branch).not.toContain(
      "INSERT INTO contract_financial_registration_matches",
    );
  });

  it("服务层只允许工程咨询向动态签约公司主体的资产内部划拨未分配入账", () => {
    const start = serviceSource.indexOf(
      "export async function postContractFinancialSettlements",
    );
    const end = serviceSource.indexOf(
      "export interface LegacyFinancialSettlementBackfillResult",
      start,
    );
    const source = serviceSource.slice(start, end);

    expect(source).toContain("allowsEngineeringInternalFunding");
    expect(source).toContain("resolveContractFinancialCompanySubject");
    expect(source).toContain(
      'root.asset_funding_mode === "engineering_to_technology"',
    );
    expect(source).toContain('"北京羽隶工程咨询有限公司"');
    expect(source).toContain("internalFundingContractSubject?.name");
    expect(source).toContain("registeredItems.rows.every");
  });
});
