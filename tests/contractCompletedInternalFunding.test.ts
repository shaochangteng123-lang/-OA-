import { calculateCompletedInternalFundingResponsibility } from "../server/services/contractDeposit";

describe("已完成合同工程内部划拨责任金额", () => {
  it("工程全额出资押金不从工程应承担金额扣除", () => {
    expect(
      calculateCompletedInternalFundingResponsibility([
        {
          paymentAmountCents: 100_000_00,
          depositFundingSource: "engineering_allocation",
          technologySelfFundedAmountCents: 0,
          confirmedDepositAmountCents: 50_000_00,
        },
      ]),
    ).toEqual({
      requiredAmountCents: 100_000_00,
      fundingSourcePendingReview: false,
    });
  });

  it("混合出资只扣除科技自有押金部分", () => {
    expect(
      calculateCompletedInternalFundingResponsibility([
        {
          paymentAmountCents: 100_000_00,
          depositFundingSource: "mixed",
          technologySelfFundedAmountCents: 20_000_00,
          confirmedDepositAmountCents: 50_000_00,
        },
      ]),
    ).toEqual({
      requiredAmountCents: 80_000_00,
      fundingSourcePendingReview: false,
    });
  });

  it("只有已确认押金条但没有资金来源时要求先复核", () => {
    expect(
      calculateCompletedInternalFundingResponsibility([
        {
          paymentAmountCents: 100_000_00,
          depositFundingSource: null,
          technologySelfFundedAmountCents: 0,
          confirmedDepositAmountCents: 50_000_00,
        },
      ]),
    ).toEqual({
      requiredAmountCents: 100_000_00,
      fundingSourcePendingReview: true,
    });
  });
});
