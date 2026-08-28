export type ContractDepositStatus =
  | "pending_payment"
  | "active"
  | "partially_settled"
  | "settled";

export type ContractDepositSettlementType =
  | "refund"
  | "deduction"
  | "rent_offset";

export type ContractDepositFundingSource =
  | "engineering_allocation"
  | "technology_self_funded"
  | "mixed"
  | "pending_review";

export type ContractExternalPaymentPurpose =
  | "contract_payment"
  | "lease_deposit";

const RENTAL_SUBTYPES = new Set([
  "house_rental",
  "vehicle_rental",
  "parking_space",
]);

export function isContractDepositEligible(input: {
  category: string | null;
  declaredSubtype: string | null;
  relationType: string;
}): boolean {
  return (
    input.category === "asset" &&
    input.relationType === "main" &&
    Boolean(input.declaredSubtype && RENTAL_SUBTYPES.has(input.declaredSubtype))
  );
}

export function deriveContractDepositStatus(input: {
  amountCents: number;
  settledAmountCents: number;
  isPaid: boolean;
}): ContractDepositStatus {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("押金金额必须是大于 0 的整数分");
  }
  if (
    !Number.isSafeInteger(input.settledAmountCents) ||
    input.settledAmountCents < 0 ||
    input.settledAmountCents > input.amountCents
  ) {
    throw new Error("押金累计结算金额不合法");
  }
  if (input.settledAmountCents === input.amountCents) return "settled";
  if (input.settledAmountCents > 0) return "partially_settled";
  return input.isPaid ? "active" : "pending_payment";
}

export function validateContractDepositSettlement(input: {
  status: ContractDepositStatus;
  type: ContractDepositSettlementType;
  amountCents: number;
  depositAmountCents: number;
  settledAmountCents: number;
}): {
  nextSettledAmountCents: number;
  remainingAmountCents: number;
  nextStatus: ContractDepositStatus;
} {
  if (input.status === "pending_payment") {
    throw new Error("押金尚未支付，不能办理结算");
  }
  if (input.status === "settled") {
    throw new Error("押金已结清，不能重复结算");
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("结算金额必须大于 0");
  }
  const remainingAmountCents =
    input.depositAmountCents - input.settledAmountCents;
  if (input.amountCents > remainingAmountCents) {
    throw new Error("结算金额不能超过押金剩余金额");
  }
  const nextSettledAmountCents = input.settledAmountCents + input.amountCents;
  return {
    nextSettledAmountCents,
    remainingAmountCents: input.depositAmountCents - nextSettledAmountCents,
    nextStatus: deriveContractDepositStatus({
      amountCents: input.depositAmountCents,
      settledAmountCents: nextSettledAmountCents,
      isPaid: true,
    }),
  };
}

export function calculateEngineeringReturnRequired(input: {
  settlementType: ContractDepositSettlementType;
  refundAmountCents: number;
  depositAmountCents: number;
  engineeringAllocationAmountCents: number;
  previousRefundAmountCents: number;
  previousEngineeringReturnRequiredCents: number;
}): number {
  if (input.settlementType !== "refund") return 0;
  const cumulativeRefundCents =
    input.previousRefundAmountCents + input.refundAmountCents;
  const cumulativeRequiredCents = Math.round(
    (cumulativeRefundCents * input.engineeringAllocationAmountCents) /
      input.depositAmountCents,
  );
  return Math.max(
    0,
    cumulativeRequiredCents - input.previousEngineeringReturnRequiredCents,
  );
}

export function calculateCompletedInternalFundingResponsibility(
  payments: ReadonlyArray<{
    paymentAmountCents: number;
    depositFundingSource: ContractDepositFundingSource | null;
    technologySelfFundedAmountCents: number;
    confirmedDepositAmountCents: number;
  }>,
): { requiredAmountCents: number; fundingSourcePendingReview: boolean } {
  let requiredAmountCents = 0;
  let fundingSourcePendingReview = false;
  for (const payment of payments) {
    if (
      !Number.isSafeInteger(payment.paymentAmountCents) ||
      payment.paymentAmountCents <= 0 ||
      !Number.isSafeInteger(payment.technologySelfFundedAmountCents) ||
      payment.technologySelfFundedAmountCents < 0 ||
      !Number.isSafeInteger(payment.confirmedDepositAmountCents) ||
      payment.confirmedDepositAmountCents < 0
    ) {
      throw new Error("已完成合同内部划拨责任金额不合法");
    }
    if (
      payment.depositFundingSource === "pending_review" ||
      (!payment.depositFundingSource && payment.confirmedDepositAmountCents > 0)
    ) {
      fundingSourcePendingReview = true;
    }
    const technologySelfFundedAmountCents = payment.depositFundingSource
      ? payment.technologySelfFundedAmountCents
      : 0;
    requiredAmountCents += Math.max(
      0,
      payment.paymentAmountCents - technologySelfFundedAmountCents,
    );
  }
  return { requiredAmountCents, fundingSourcePendingReview };
}

export function validateExternalPaymentPurposeDetails(
  paymentAmountCents: number,
  details: ReadonlyArray<{
    purpose: ContractExternalPaymentPurpose;
    amountCents: number;
    fundingSource: ContractDepositFundingSource;
    engineeringAllocationAmountCents: number;
    technologySelfFundedAmountCents: number;
  }>,
): void {
  if (details.length === 0 || details.length > 2) {
    throw new Error("付款用途明细必须包含一至两项");
  }
  if (
    new Set(details.map((detail) => detail.purpose)).size !== details.length
  ) {
    throw new Error("同一付款用途不能重复");
  }
  let detailTotalCents = 0;
  for (const detail of details) {
    if (!Number.isSafeInteger(detail.amountCents) || detail.amountCents <= 0) {
      throw new Error("付款用途金额必须大于 0");
    }
    const engineering = detail.engineeringAllocationAmountCents;
    const technology = detail.technologySelfFundedAmountCents;
    if (
      !Number.isSafeInteger(engineering) ||
      !Number.isSafeInteger(technology) ||
      engineering < 0 ||
      technology < 0
    ) {
      throw new Error("资金来源拆分金额不合法");
    }
    if (detail.fundingSource === "pending_review") {
      if (engineering !== 0 || technology !== 0) {
        throw new Error("待确认资金来源不能提前填写拆分金额");
      }
    } else if (
      detail.fundingSource === "engineering_allocation" &&
      (engineering !== detail.amountCents || technology !== 0)
    ) {
      throw new Error("工程划拨金额必须等于用途金额");
    } else if (
      detail.fundingSource === "technology_self_funded" &&
      (technology !== detail.amountCents || engineering !== 0)
    ) {
      throw new Error("科技自有金额必须等于用途金额");
    } else if (
      detail.fundingSource === "mixed" &&
      (engineering <= 0 ||
        technology <= 0 ||
        engineering + technology !== detail.amountCents)
    ) {
      throw new Error("混合资金必须由两项正金额组成并与用途金额一致");
    }
    detailTotalCents += detail.amountCents;
  }
  if (detailTotalCents !== paymentAmountCents) {
    throw new Error("付款用途明细合计必须等于对外付款金额");
  }
}
