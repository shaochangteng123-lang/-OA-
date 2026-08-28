import type {
  ContractFinancialBlockingReason,
  ContractFinancialOcrResult,
} from "./contractFinancialOcr.js";

export type ContractFinancialRecordKind = "invoice" | "receipt" | "payment";
export type ContractFinancialCategory = "main_business" | "non_main" | "asset";

export const CONTRACT_BANK_RECEIPT_OCR_ENGINE_VERSION = "v6_medium";
export const CONTRACT_BANK_RECEIPT_OCR_PARSER_VERSION =
  "contract-bank-receipt-parser-v11";
export const CONTRACT_INVOICE_OCR_PARSER_VERSION =
  "contract-invoice-parser-v10";

export function contractFinancialOcrEngineVersion(
  kind: ContractFinancialRecordKind,
): string {
  return kind === "invoice"
    ? process.env.CONTRACT_FINANCIAL_OCR_ENGINE_VERSION ||
        "structured-fast-or-dual-channel-runtime"
    : CONTRACT_BANK_RECEIPT_OCR_ENGINE_VERSION;
}

export function contractFinancialOcrParserVersion(
  kind: ContractFinancialRecordKind,
): string {
  return kind === "invoice"
    ? CONTRACT_INVOICE_OCR_PARSER_VERSION
    : CONTRACT_BANK_RECEIPT_OCR_PARSER_VERSION;
}

export const CONTRACT_COMPANY_LEGAL_NAMES = Object.freeze(
  (
    process.env.CONTRACT_COMPANY_LEGAL_NAMES ||
    "北京羽隶工程咨询有限公司|北京羽隶科技有限公司"
  )
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean),
);

export const CONTRACT_COMPANY_TAX_IDS = Object.freeze(
  (
    process.env.CONTRACT_COMPANY_TAX_IDS ||
    "91110116MA01G3U20C|91110116MA01BN342Y"
  )
    .split("|")
    .map((taxId) => taxId.trim())
    .filter(Boolean),
);

export const CONTRACT_COMPANY_SUBJECTS = Object.freeze(
  CONTRACT_COMPANY_LEGAL_NAMES.map((name, index) => ({
    name,
    taxId: CONTRACT_COMPANY_TAX_IDS[index] || "",
  })).filter((subject) => subject.taxId),
);

export function resolveContractFinancialCompanySubject(
  parties: readonly unknown[],
  subjects: readonly {
    name: string;
    taxId?: string;
  }[] = CONTRACT_COMPANY_SUBJECTS,
): { name: string; taxId: string } | null {
  const normalizeName = (value: unknown) =>
    String(value || "")
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("zh-CN")
      .replace(/\s+/gu, "");
  const normalizedSubjects = subjects.map((subject) => ({
    ...subject,
    normalizedName: normalizeName(subject.name),
  }));
  const matched = parties
    .map((party) => normalizeName(party))
    .filter(Boolean)
    .map((party) =>
      normalizedSubjects.find((subject) => subject.normalizedName === party),
    )
    .filter((subject): subject is (typeof normalizedSubjects)[number] =>
      Boolean(subject),
    );
  // 必须恰好一侧是内部主体；双方都为内部主体（即使名称相同）属于内部关系，
  // 不能作为对外合同自动登记财务凭证。
  if (matched.length !== 1) return null;
  return {
    name: matched[0]!.name.trim(),
    taxId: String(matched[0]!.taxId || "").trim(),
  };
}

function normalizeFinancialPartyName(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "");
}

/**
 * 营收回款只核对收款闭环：销项发票销售方必须等于银行回单收款人。
 * 购买方与实际付款人可能是同一集团内不同主体，不作为营收登记阻断条件。
 */
export function incomeReceiptPartiesMatch(
  invoice: { seller: unknown },
  receipt: { payee: unknown },
): boolean {
  const seller = normalizeFinancialPartyName(invoice.seller);
  const payee = normalizeFinancialPartyName(receipt.payee);
  return Boolean(seller && payee && seller === payee);
}

export interface ContractFinancialOcrDecision {
  expectedDirection: "input" | "output" | "receipt" | "payment" | "unknown";
  status: "verified" | "blocked" | "failed";
  canCreateDraft: boolean;
  blockingReasons: ContractFinancialBlockingReason[];
}

export interface SafeContractFinancialSnapshot {
  format: ContractFinancialOcrResult["format"];
  fields: ContractFinancialOcrResult["fields"];
}

export interface ContractFinancialAmountAllocation {
  invoiceIndex: number;
  settlementIndex: number;
  allocatedAmount: number;
}

function allocateContractFinancialAmountsByCents(
  invoiceCents: readonly number[],
  settlementCents: readonly number[],
): ContractFinancialAmountAllocation[] {
  const allocations: ContractFinancialAmountAllocation[] = [];
  const invoiceRemaining = [...invoiceCents];
  const settlementRemaining = [...settlementCents];
  // 先匹配金额完全相同的单据，避免 4 万、6 万与 6 万、4 万因上传顺序被拆错。
  for (
    let invoiceIndex = 0;
    invoiceIndex < invoiceRemaining.length;
    invoiceIndex += 1
  ) {
    const settlementIndex = settlementRemaining.findIndex(
      (amount) => amount > 0 && amount === invoiceRemaining[invoiceIndex],
    );
    if (settlementIndex < 0) continue;
    allocations.push({
      invoiceIndex,
      settlementIndex,
      allocatedAmount: invoiceRemaining[invoiceIndex]! / 100,
    });
    invoiceRemaining[invoiceIndex] = 0;
    settlementRemaining[settlementIndex] = 0;
  }
  let invoiceIndex = invoiceRemaining.findIndex((amount) => amount > 0);
  let settlementIndex = settlementRemaining.findIndex((amount) => amount > 0);
  while (invoiceIndex >= 0 && settlementIndex >= 0) {
    const allocatedCents = Math.min(
      invoiceRemaining[invoiceIndex]!,
      settlementRemaining[settlementIndex]!,
    );
    allocations.push({
      invoiceIndex,
      settlementIndex,
      allocatedAmount: allocatedCents / 100,
    });
    invoiceRemaining[invoiceIndex] =
      invoiceRemaining[invoiceIndex]! - allocatedCents;
    settlementRemaining[settlementIndex] =
      settlementRemaining[settlementIndex]! - allocatedCents;
    invoiceIndex = invoiceRemaining.findIndex((amount) => amount > 0);
    settlementIndex = settlementRemaining.findIndex((amount) => amount > 0);
  }
  return allocations.sort(
    (left, right) =>
      left.invoiceIndex - right.invoiceIndex ||
      left.settlementIndex - right.settlementIndex,
  );
}

/**
 * 按上传顺序把发票金额与回单金额逐笔分配，支持一对多、多对一和多对多。
 * 输入金额必须为正数且两侧合计一致；返回金额精确到分。
 */
export function allocateContractFinancialAmounts(
  invoiceAmounts: readonly number[],
  settlementAmounts: readonly number[],
): ContractFinancialAmountAllocation[] {
  const invoiceCents = invoiceAmounts.map((amount) => Math.round(amount * 100));
  const settlementCents = settlementAmounts.map((amount) =>
    Math.round(amount * 100),
  );
  if (
    !invoiceCents.length ||
    !settlementCents.length ||
    invoiceCents.some(
      (amount) => !Number.isSafeInteger(amount) || amount <= 0,
    ) ||
    settlementCents.some(
      (amount) => !Number.isSafeInteger(amount) || amount <= 0,
    )
  ) {
    throw new Error("发票和回单金额必须为大于零的有效金额");
  }
  if (
    invoiceCents.reduce((sum, amount) => sum + amount, 0) !==
    settlementCents.reduce((sum, amount) => sum + amount, 0)
  ) {
    throw new Error("发票合计金额与回单合计金额必须一致");
  }
  return allocateContractFinancialAmountsByCents(invoiceCents, settlementCents);
}

/**
 * 将已到账／已付款的结算金额分配到发票可分配余额。
 * 结算合计可以小于发票合计，但不能超过发票合计；返回结果必须完整覆盖
 * 每一分钱的结算金额，尚未结算的发票余额不生成分配记录。
 */
export function allocatePartialContractFinancialAmounts(
  invoiceAmounts: readonly number[],
  settlementAmounts: readonly number[],
): ContractFinancialAmountAllocation[] {
  const invoiceCents = invoiceAmounts.map((amount) => Math.round(amount * 100));
  const settlementCents = settlementAmounts.map((amount) =>
    Math.round(amount * 100),
  );
  if (
    !invoiceCents.length ||
    !settlementCents.length ||
    invoiceCents.some(
      (amount) => !Number.isSafeInteger(amount) || amount <= 0,
    ) ||
    settlementCents.some(
      (amount) => !Number.isSafeInteger(amount) || amount <= 0,
    )
  ) {
    throw new Error("发票和结算金额必须为大于零的有效金额");
  }
  const invoiceTotalCents = invoiceCents.reduce(
    (sum, amount) => sum + amount,
    0,
  );
  const settlementTotalCents = settlementCents.reduce(
    (sum, amount) => sum + amount,
    0,
  );
  if (settlementTotalCents > invoiceTotalCents) {
    throw new Error("结算合计金额不能超过发票可分配余额");
  }
  const allocations = allocateContractFinancialAmountsByCents(
    invoiceCents,
    settlementCents,
  );
  const allocatedCents = allocations.reduce(
    (sum, allocation) => sum + Math.round(allocation.allocatedAmount * 100),
    0,
  );
  if (allocatedCents !== settlementTotalCents) {
    throw new Error("结算金额未能完整分配到发票可分配余额");
  }
  return allocations;
}

/**
 * 将当前已经存在的发票与银行结算凭证按可覆盖金额建立对应关系。
 *
 * 与“部分结算”不同，这里允许任意一侧金额暂时更大：回款先到、发票后补时，
 * 先分配两侧能够覆盖的部分，未覆盖金额继续留在同一财务登记中等待后续凭证。
 * 任意一侧尚无凭证时返回空数组。
 */
export function allocateAvailableContractFinancialAmounts(
  invoiceAmounts: readonly number[],
  settlementAmounts: readonly number[],
): ContractFinancialAmountAllocation[] {
  if (!invoiceAmounts.length || !settlementAmounts.length) return [];
  const invoiceCents = invoiceAmounts.map((amount) => Math.round(amount * 100));
  const settlementCents = settlementAmounts.map((amount) =>
    Math.round(amount * 100),
  );
  if (
    invoiceCents.some(
      (amount) => !Number.isSafeInteger(amount) || amount <= 0,
    ) ||
    settlementCents.some(
      (amount) => !Number.isSafeInteger(amount) || amount <= 0,
    )
  ) {
    throw new Error("发票和结算金额必须为大于零的有效金额");
  }
  return allocateContractFinancialAmountsByCents(invoiceCents, settlementCents);
}

/**
 * 在同一财务登记分批补充银行凭证时，只使用每张发票尚未分配的余额。
 * `allocatedAmounts`（已分配金额）必须与发票逐项对应，返回的发票索引仍指向
 * 原始发票数组，便于调用方直接持久化新增对应关系。
 */
export function allocateAdditionalContractFinancialAmounts(
  invoiceAmounts: readonly number[],
  allocatedAmounts: readonly number[],
  settlementAmounts: readonly number[],
): ContractFinancialAmountAllocation[] {
  if (
    !invoiceAmounts.length ||
    invoiceAmounts.length !== allocatedAmounts.length
  ) {
    throw new Error("发票金额与已分配金额必须逐项对应");
  }
  const invoiceCents = invoiceAmounts.map((amount) => Math.round(amount * 100));
  const allocatedCents = allocatedAmounts.map((amount) =>
    Math.round(amount * 100),
  );
  if (
    invoiceCents.some(
      (amount) => !Number.isSafeInteger(amount) || amount <= 0,
    ) ||
    allocatedCents.some(
      (amount, index) =>
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        amount > invoiceCents[index]!,
    )
  ) {
    throw new Error("发票金额或既有分配金额无效");
  }
  const remainingInvoices = invoiceCents
    .map((amount, sourceIndex) => ({
      sourceIndex,
      amount: (amount - allocatedCents[sourceIndex]!) / 100,
    }))
    .filter((item) => item.amount > 0);
  if (!remainingInvoices.length) {
    throw new Error("发票已无可分配余额");
  }
  return allocatePartialContractFinancialAmounts(
    remainingInvoices.map((item) => item.amount),
    settlementAmounts,
  ).map((allocation) => ({
    ...allocation,
    invoiceIndex: remainingInvoices[allocation.invoiceIndex]!.sourceIndex,
  }));
}

export type ContractFinancialOcrReuseDecision =
  | "retry_infrastructure"
  | "retry_expired_processing"
  | "retry_strategy_upgrade"
  | "in_progress"
  | "reuse_terminal";

/**
 * 同摘要凭证只在可恢复的技术故障或显式允许的识别策略升级时接管原任务。
 * 业务阻断、文件问题和普通识别失败保持原结果，防止反复自动识别绕过门禁；
 * 已消费或已生成正式记录的历史事实永不因策略版本变化而自动重算；
 * 未消费的旧策略已验证结果由调用方在显式重新上传时决定是否升级重算。
 */
export function decideStoredContractFinancialOcrReuse(input: {
  status: "processing" | "verified" | "blocked" | "failed" | "consumed";
  failureKind: "infrastructure" | "document" | "recognition" | null;
  leaseExpiresAt: string | null;
  currentEngineVersion?: string | null;
  currentParserVersion?: string | null;
  expectedEngineVersion?: string;
  expectedParserVersion?: string;
  allowStrategyUpgrade?: boolean;
  now?: number;
}): ContractFinancialOcrReuseDecision {
  if (input.status === "consumed") return "reuse_terminal";
  if (input.status === "failed" && input.failureKind === "infrastructure") {
    return "retry_infrastructure";
  }
  if (input.status !== "processing") {
    const strategyChanged =
      input.allowStrategyUpgrade === true &&
      !!input.expectedEngineVersion &&
      !!input.expectedParserVersion &&
      (input.currentEngineVersion !== input.expectedEngineVersion ||
        input.currentParserVersion !== input.expectedParserVersion);
    // 仅让尚未消费的旧策略结果进入新策略。调用方还必须确认 record_id（记录编号）
    // 为空；已消费或已生成记录的历史结果不得静默重算。旧版 verified（已验证）
    // 也必须重算，避免把双通道结论冒充为第六版单模型结论。
    if (
      (input.status === "blocked" || input.status === "verified") &&
      strategyChanged
    ) {
      return "retry_strategy_upgrade";
    }
    return "reuse_terminal";
  }
  const expiresAt = input.leaseExpiresAt
    ? Date.parse(input.leaseExpiresAt)
    : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= (input.now ?? Date.now())) {
    return "retry_expired_processing";
  }
  return "in_progress";
}

function uniqueReasons(
  reasons: readonly ContractFinancialBlockingReason[],
): ContractFinancialBlockingReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.code}:${reason.field || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function expectedContractFinancialDirection(
  kind: ContractFinancialRecordKind,
  recognizedDirection?: ContractFinancialOcrResult["direction"],
): ContractFinancialOcrDecision["expectedDirection"] {
  if (kind === "invoice") {
    return recognizedDirection === "input" || recognizedDirection === "output"
      ? recognizedDirection
      : "unknown";
  }
  return kind === "receipt" ? "receipt" : "payment";
}

/**
 * 通用识别服务只判断凭证本身是否可信；这里再叠加合同业务方向门禁。
 * 两层条件必须同时通过，才能生成可确认的财务草稿。
 */
export function decideContractFinancialOcr(
  result: ContractFinancialOcrResult,
  kind: ContractFinancialRecordKind,
): ContractFinancialOcrDecision {
  const expectedDirection = expectedContractFinancialDirection(
    kind,
    result.direction,
  );
  const expectedDocumentKind = kind === "invoice" ? "invoice" : "bank_receipt";
  const reasons = [...result.blockingReasons];
  const directionLabels = {
    input: "进项发票",
    output: "销项发票",
    third_party: "第三方交易",
    receipt: "回款",
    payment: "付款",
    unknown: "未知",
  } as const;

  if (result.kind !== expectedDocumentKind) {
    reasons.push({
      code: "FINANCIAL_DOCUMENT_KIND_MISMATCH",
      message: "凭证类型与当前业务类型不一致",
      field: "kind",
    });
  }
  if (
    kind === "invoice" &&
    result.direction !== "input" &&
    result.direction !== "output"
  ) {
    reasons.push({
      code: "FINANCIAL_INVOICE_DIRECTION_UNRESOLVED",
      message: "发票购销双方未能唯一确认本公司身份，不能确定合同收支方向",
      field: "direction",
    });
  } else if (kind !== "invoice" && result.direction !== expectedDirection) {
    reasons.push({
      code: "FINANCIAL_DIRECTION_MISMATCH",
      message: `识别方向为“${directionLabels[result.direction]}”，当前业务要求“${directionLabels[expectedDirection]}”`,
      field: "direction",
    });
  }
  if (result.documentStatus !== "normal") {
    reasons.push({
      code: "FINANCIAL_DOCUMENT_NOT_NORMAL",
      message: "只有状态明确为正常的凭证才能生成财务草稿",
      field: "documentStatus",
    });
  }

  const blockingReasons = uniqueReasons(reasons);
  const canCreateDraft =
    result.validationStatus === "verified" &&
    result.canAutoPost === true &&
    result.documentStatus === "normal" &&
    (kind === "invoice"
      ? result.direction === "input" || result.direction === "output"
      : result.direction === expectedDirection) &&
    blockingReasons.length === 0;

  return {
    expectedDirection,
    status:
      result.validationStatus === "failed"
        ? "failed"
        : canCreateDraft
          ? "verified"
          : "blocked",
    canCreateDraft,
    blockingReasons,
  };
}

/** 只保留结构化字段和真实格式，不保存或返回完整识别原文。 */
export function buildSafeContractFinancialSnapshot(
  result: ContractFinancialOcrResult,
): SafeContractFinancialSnapshot {
  if (result.kind === "invoice") {
    return {
      format: result.format,
      fields: {
        buyer: result.fields.buyer,
        seller: result.fields.seller,
        itemName: result.fields.itemName,
        invoiceNumber: result.fields.invoiceNumber,
        invoiceDate: result.fields.invoiceDate,
        taxAmount: result.fields.taxAmount,
        amount: result.fields.amount,
        lineItems: result.fields.lineItems,
      },
    };
  }
  return {
    format: result.format,
    fields: { ...result.fields },
  };
}

function normalizedIdentity(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "");
}

function normalizedNumber(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9-]/gu, "")
    .toUpperCase();
}

function normalizedMoney(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return Number.NaN;
  return Math.round(Number(text) * 100);
}

function provided(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

/**
 * 兼容旧客户端提交字段，但这些字段只能作为一致性断言，绝不能覆盖识别值。
 */
export function findContractFinancialClientMismatches(
  kind: ContractFinancialRecordKind,
  clientValues: Record<string, unknown>,
  snapshot: SafeContractFinancialSnapshot,
): string[] {
  const fields = snapshot.fields as unknown as Record<string, unknown>;
  const mismatches: string[] = [];
  const compareIdentity = (
    clientKey: string,
    recognizedKey: string,
    label: string,
  ) => {
    if (
      provided(clientValues[clientKey]) &&
      normalizedIdentity(clientValues[clientKey]) !==
        normalizedIdentity(fields[recognizedKey])
    ) {
      mismatches.push(label);
    }
  };
  const compareNumber = (
    clientKey: string,
    recognizedKey: string,
    label: string,
  ) => {
    if (
      provided(clientValues[clientKey]) &&
      normalizedNumber(clientValues[clientKey]) !==
        normalizedNumber(fields[recognizedKey])
    ) {
      mismatches.push(label);
    }
  };
  const compareMoney = (
    clientKey: string,
    recognizedKey: string,
    label: string,
  ) => {
    if (!provided(clientValues[clientKey])) return;
    const clientMoney = normalizedMoney(clientValues[clientKey]);
    const recognizedMoney = Math.round(
      Number(fields[recognizedKey] || 0) * 100,
    );
    if (!Number.isFinite(clientMoney) || clientMoney !== recognizedMoney) {
      mismatches.push(label);
    }
  };

  compareMoney("amount", "amount", "金额");
  if (kind === "invoice") {
    compareIdentity("invoiceDate", "invoiceDate", "开票日期");
    compareIdentity("recordDate", "invoiceDate", "日期");
    compareNumber("invoiceNo", "invoiceNumber", "发票号码");
    compareIdentity("itemName", "itemName", "开票名称");
    compareMoney("taxAmount", "taxAmount", "税额");
    compareIdentity("seller", "seller", "销方名称");
    compareIdentity("buyer", "buyer", "购方名称");
  } else {
    const dateKey = kind === "receipt" ? "receiptDate" : "paymentDate";
    compareIdentity(dateKey, "paymentTime", "付款时间");
    compareIdentity("recordDate", "paymentTime", "付款时间");
    compareIdentity("paymentTime", "paymentTime", "付款时间");
    compareNumber("electronicReceiptNo", "electronicReceiptNo", "电子回单号");
    compareIdentity("payer", "payer", "付款方");
    compareNumber("payerAccount", "payerAccount", "付款账号");
    compareIdentity("payee", "payee", "收款方");
    compareNumber("payeeAccount", "payeeAccount", "收款账号");
  }
  return [...new Set(mismatches)];
}
