import {
  MAX_CONTRACT_AMOUNT_CENTS,
  centsToAmount,
  toCents,
  type MoneyValue,
} from "./contractAccounting.js";

export type SupplementChangeType =
  | "payment_terms_only"
  | "amount_adjustment"
  | "amount_and_payment"
  | "legacy_unresolved";

export type SupplementAmountStatus =
  | "confirmed_amount"
  | "calculated_amount"
  | "payment_only"
  | "missing_amount";

export interface SupplementAmountInput {
  beforeAmount: MoneyValue;
  recognizedChangeAmount?: MoneyValue | null;
  recognizedFinalAmount?: MoneyValue | null;
  amountStatus: SupplementAmountStatus;
  paymentTermsDetected?: boolean;
}

export interface SupplementAmountSnapshot {
  before: number;
  delta: number;
  after: number;
  changeType: SupplementChangeType;
}

export type SupplementChainNode = Omit<SupplementAmountInput, "beforeAmount">;

export interface SupplementChainResult {
  originalAmount: number;
  snapshots: SupplementAmountSnapshot[];
  currentAmount: number;
}

export class SupplementAmountCalculationError extends Error {
  readonly changeType: SupplementChangeType = "legacy_unresolved";

  constructor(
    message: string,
    readonly code:
      | "SUPPLEMENT_AMOUNT_LEGACY_UNRESOLVED"
      | "SUPPLEMENT_AMOUNT_INVALID"
      | "SUPPLEMENT_AMOUNT_OUT_OF_RANGE",
  ) {
    super(message);
    this.name = "SupplementAmountCalculationError";
  }
}

const TRUSTED_CHANGE_STATUSES = new Set<SupplementAmountStatus>([
  "confirmed_amount",
  "calculated_amount",
]);

function amountToCents(value: MoneyValue, label: string): number {
  try {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("金额格式不正确");
      const scaled = value * 100;
      const rounded = Math.round(scaled);
      if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) {
        throw new Error("金额格式不正确");
      }
      if (Math.abs(rounded) > MAX_CONTRACT_AMOUNT_CENTS) {
        throw new Error("金额超过系统可安全计算范围");
      }
      return rounded;
    }
    return toCents(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "金额格式不正确";
    throw new SupplementAmountCalculationError(
      `${label}${message}`,
      /安全计算范围/u.test(message)
        ? "SUPPLEMENT_AMOUNT_OUT_OF_RANGE"
        : "SUPPLEMENT_AMOUNT_INVALID",
    );
  }
}

function assertNonNegative(cents: number, label: string): void {
  if (cents < 0) {
    throw new SupplementAmountCalculationError(
      `${label}不能小于 0`,
      "SUPPLEMENT_AMOUNT_INVALID",
    );
  }
}

function assertSafeAfterAmount(cents: number): void {
  if (
    !Number.isSafeInteger(cents) ||
    cents < 0 ||
    cents > MAX_CONTRACT_AMOUNT_CENTS
  ) {
    throw new SupplementAmountCalculationError(
      cents < 0
        ? "补充协议生效后金额不能小于 0"
        : "补充协议生效后金额超过系统可安全计算范围",
      cents < 0
        ? "SUPPLEMENT_AMOUNT_INVALID"
        : "SUPPLEMENT_AMOUNT_OUT_OF_RANGE",
    );
  }
}

function snapshotFromCents(
  before: number,
  delta: number,
  after: number,
  changeType: SupplementChangeType,
): SupplementAmountSnapshot {
  return {
    before: centsToAmount(before),
    delta: centsToAmount(delta),
    after: centsToAmount(after),
    changeType,
  };
}

/**
 * 计算单份补充协议的金额快照。付款方式变更不改变合同总额；正文明确给出
 * 调整后总额时，以该总额为最高金额依据；否则只接受已确认或计算闭环的
 * 本次增减额。所有运算均在整数分上完成。
 */
export function calculateSupplementAmountSnapshot(
  input: SupplementAmountInput,
): SupplementAmountSnapshot {
  const before = amountToCents(input.beforeAmount, "补充协议生效前金额");
  assertNonNegative(before, "补充协议生效前金额");

  if (input.amountStatus === "payment_only") {
    return snapshotFromCents(before, 0, before, "payment_terms_only");
  }

  if (
    input.recognizedFinalAmount !== null &&
    input.recognizedFinalAmount !== undefined
  ) {
    const after = amountToCents(
      input.recognizedFinalAmount,
      "补充协议明确调整后总额",
    );
    assertNonNegative(after, "补充协议明确调整后总额");
    const delta = after - before;
    return snapshotFromCents(
      before,
      delta,
      after,
      input.paymentTermsDetected ? "amount_and_payment" : "amount_adjustment",
    );
  }

  if (
    input.recognizedChangeAmount !== null &&
    input.recognizedChangeAmount !== undefined &&
    TRUSTED_CHANGE_STATUSES.has(input.amountStatus)
  ) {
    const delta = amountToCents(
      input.recognizedChangeAmount,
      "补充协议本次增减金额",
    );
    const after = before + delta;
    assertSafeAfterAmount(after);
    return snapshotFromCents(
      before,
      delta,
      after,
      input.paymentTermsDetected ? "amount_and_payment" : "amount_adjustment",
    );
  }

  throw new SupplementAmountCalculationError(
    "补充协议金额缺少可信的最终总额、本次增减额或仅付款依据，属于待核查历史数据",
    "SUPPLEMENT_AMOUNT_LEGACY_UNRESOLVED",
  );
}

/** 按给定节点顺序逐份计算补充协议金额链，不合并或去重同额节点。 */
export function calculateSupplementChain(
  originalAmount: MoneyValue,
  nodes: readonly SupplementChainNode[],
): SupplementChainResult {
  const originalAmountCents = amountToCents(originalAmount, "主合同原始金额");
  assertNonNegative(originalAmountCents, "主合同原始金额");

  const snapshots: SupplementAmountSnapshot[] = [];
  let currentAmount = centsToAmount(originalAmountCents);
  for (const node of nodes) {
    const snapshot = calculateSupplementAmountSnapshot({
      ...node,
      beforeAmount: currentAmount,
    });
    snapshots.push(snapshot);
    currentAmount = snapshot.after;
  }

  return {
    originalAmount: centsToAmount(originalAmountCents),
    snapshots,
    currentAmount,
  };
}
