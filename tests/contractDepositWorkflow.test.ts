import fs from "node:fs";
import path from "node:path";

import {
  calculateEngineeringReturnRequired,
  deriveContractDepositStatus,
  isContractDepositEligible,
  validateContractDepositSettlement,
  validateExternalPaymentPurposeDetails,
} from "../server/services/contractDeposit";

describe("租赁合同押金闭环", () => {
  it("房屋、车辆和车位租赁触发押金管理，普通采购不触发", () => {
    for (const subtype of ["house_rental", "vehicle_rental", "parking_space"]) {
      expect(
        isContractDepositEligible({
          category: "asset",
          declaredSubtype: subtype,
          relationType: "main",
        }),
      ).toBe(true);
    }
    expect(
      isContractDepositEligible({
        category: "asset",
        declaredSubtype: "procurement",
        relationType: "main",
      }),
    ).toBe(false);
  });

  it("158988元付款可拆为79494元合同款和79494元押金", () => {
    expect(() =>
      validateExternalPaymentPurposeDetails(15_898_800, [
        {
          purpose: "contract_payment",
          amountCents: 7_949_400,
          fundingSource: "pending_review",
          engineeringAllocationAmountCents: 0,
          technologySelfFundedAmountCents: 0,
        },
        {
          purpose: "lease_deposit",
          amountCents: 7_949_400,
          fundingSource: "engineering_allocation",
          engineeringAllocationAmountCents: 7_949_400,
          technologySelfFundedAmountCents: 0,
        },
      ]),
    ).not.toThrow();
  });

  it("支持部分退回后再登记损失扣款", () => {
    const refund = validateContractDepositSettlement({
      status: "active",
      type: "refund",
      amountCents: 7_000_000,
      depositAmountCents: 7_949_400,
      settledAmountCents: 0,
    });
    expect(refund).toEqual({
      nextSettledAmountCents: 7_000_000,
      remainingAmountCents: 949_400,
      nextStatus: "partially_settled",
    });
    expect(
      validateContractDepositSettlement({
        status: refund.nextStatus,
        type: "deduction",
        amountCents: 949_400,
        depositAmountCents: 7_949_400,
        settledAmountCents: refund.nextSettledAmountCents,
      }).nextStatus,
    ).toBe("settled");
  });

  it("工程划拨来源只要求把实际退款部分退回工程", () => {
    expect(
      calculateEngineeringReturnRequired({
        settlementType: "refund",
        refundAmountCents: 7_000_000,
        depositAmountCents: 7_949_400,
        engineeringAllocationAmountCents: 7_949_400,
        previousRefundAmountCents: 0,
        previousEngineeringReturnRequiredCents: 0,
      }),
    ).toBe(7_000_000);
    expect(
      calculateEngineeringReturnRequired({
        settlementType: "deduction",
        refundAmountCents: 949_400,
        depositAmountCents: 7_949_400,
        engineeringAllocationAmountCents: 7_949_400,
        previousRefundAmountCents: 7_000_000,
        previousEngineeringReturnRequiredCents: 7_000_000,
      }),
    ).toBe(0);
  });

  it("押金状态按支付和累计结算金额推进", () => {
    expect(
      deriveContractDepositStatus({
        amountCents: 100,
        settledAmountCents: 0,
        isPaid: false,
      }),
    ).toBe("pending_payment");
    expect(
      deriveContractDepositStatus({
        amountCents: 100,
        settledAmountCents: 100,
        isPaid: true,
      }),
    ).toBe("settled");
  });

  it("路由、数据表和内联页面形成完整闭环", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const dbSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    const serviceSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    const componentSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractDepositManagementInline.vue",
      ),
      "utf8",
    );
    expect(dbSource).toContain("CREATE TABLE IF NOT EXISTS contract_deposits");
    expect(dbSource).toContain(
      "CREATE TABLE IF NOT EXISTS contract_deposit_settlements",
    );
    expect(dbSource).toContain(
      "CREATE TABLE IF NOT EXISTS contract_payment_purpose_details",
    );
    expect(routeSource).toContain('router.get("/:id/deposit"');
    expect(routeSource).toContain('router.put("/:id/deposit"');
    expect(routeSource).toContain('"/:id/deposit/settlements"');
    expect(routeSource).toContain("registerPurposeDetailRoutes");
    expect(routeSource).toContain("purposeDetailsRecordColumn");
    expect(routeSource).not.toMatch(
      /DELETE FROM contract_payment_purpose_details\s+WHERE[^;]{0,180}detail\./u,
    );
    expect(routeSource).toContain("rebuildDepositAffectedFinancialMatches");
    expect(routeSource).toContain("confirmedReceiptCandidates");
    expect(routeSource).toContain("CONTRACT_DEPOSIT_PAYMENT_LINK_AMBIGUOUS");
    expect(routeSource).toContain("applyDepositRentOffsetPurpose");
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_RENT_OFFSET_PAYMENT_REQUIRED",
    );
    expect(routeSource).toContain("isValidBankBusinessDate(date)");
    expect(routeSource).toMatch(
      /router\.get\("\/:id\/deposit"[\s\S]{0,220}assertContractReadScope/u,
    );
    expect(serviceSource).toContain("invoiceRequiredSettlementAmountCents");
    expect(serviceSource).toContain("contract_payment_purpose_details");
    expect(serviceSource).toContain(
      "CONTRACT_DEPOSIT_PAYMENT_REVERSAL_BLOCKED",
    );
    expect(routeSource).toContain("contract_payment_purpose_details");
    expect(detailSource).toContain("<ContractDepositManagementInline");
    expect(detailSource).toContain("银行付款合计");
    expect(detailSource).toContain("其中押金");
    expect(detailSource).toContain("需发票覆盖付款");
    expect(componentSource).toContain("支持部分退回、扣款和抵租金组合");
    expect(componentSource).toContain('value: "engineering_allocation"');
    expect(componentSource).toContain('value: "technology_self_funded"');
    expect(componentSource).not.toContain("工程直接支付");
  });
});
