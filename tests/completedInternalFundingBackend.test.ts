import fs from "node:fs";
import path from "node:path";

describe("已完成资产合同历史内部划拨后端", () => {
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const databaseSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/db/index.ts"),
    "utf8",
  );

  it("专用识别任务使用独立用途并与普通财务消费隔离", () => {
    expect(databaseSource).toContain("'engineering_internal_funding'");
    expect(routeSource).toContain(
      'businessPurpose: "engineering_internal_funding"',
    );
    expect(
      routeSource.match(/business_purpose IS NULL/gu)?.length,
    ).toBeGreaterThanOrEqual(6);
  });

  it("摘要返回缺口、已确认回单和可恢复的待确认任务", () => {
    const start = routeSource.indexOf(
      "async function loadCompletedInternalFundingSummary",
    );
    const end = routeSource.indexOf(
      "async function lockCompletedInternalFundingContract",
      start,
    );
    const source = routeSource.slice(start, end);

    expect(source).toContain("canAppendAfterCompletion");
    expect(source).toContain("contractCompanySubjectName");
    expect(source).toContain("requiredAmount");
    expect(source).toContain("confirmedAmount");
    expect(source).toContain("pendingAmount");
    expect(source).toContain("remainingAmount");
    expect(source).toContain("availableRecognitionAmount");
    expect(source).toContain("pendingRecognitions");
    expect(source).toContain("contract_payment_deposit_receipts");
    expect(source).toContain("receipt.status='confirmed'");
    expect(source).toContain("remainingAmount - pendingAmount");
  });

  it("提供摘要、识别、临时任务删除和批量确认四个专用接口", () => {
    expect(routeSource).toContain('"/:id/completed-internal-funding-summary"');
    expect(routeSource).toContain(
      '"/:id/completed-internal-funding/recognize"',
    );
    expect(routeSource).toContain(
      '"/:id/completed-internal-funding/recognitions/:jobId"',
    );
    expect(routeSource).toContain('"/:id/completed-internal-funding/confirm"');
    expect(routeSource).toContain(
      "COMPLETED_INTERNAL_FUNDING_BATCH_EXCEEDS_REMAINING",
    );
  });

  it("确认只生成已确认付款并保持原登记、匹配和合同生命周期不变", () => {
    const start = routeSource.indexOf(
      '"/:id/completed-internal-funding/confirm"',
    );
    const end = routeSource.indexOf('router.get("/:id/deposit"', start);
    const source = routeSource.slice(start, end);

    expect(source).toContain("INSERT INTO contract_payments");
    expect(source).toContain("'confirmed'");
    expect(source).toContain("completed_internal_funding_confirmed");
    expect(source).toContain("contractStatusPreserved: true");
    expect(source).toContain("registrationCreated: false");
    expect(source).toContain("matchesCreated: false");
    expect(source).not.toContain("contract_financial_registrations");
    expect(source).not.toContain("contract_financial_registration_matches");
    expect(source).not.toContain("recalculateContractExecutionStatus");
  });
});
