import type { PoolClient } from "pg";
import type {
  FinancialAnalysisColumn,
  FinancialAnalysisDetail,
  FinancialAnalysisModule,
  FinancialAnalysisModuleKey,
  FinancialAnalysisPeriod,
  FinancialAnalysisPersonnelUnassignedReimbursement,
  FinancialAnalysisHousingCostValue,
  FinancialAnalysisQuery,
  FinancialAnalysisProjectReceipt,
  FinancialAnalysisSeries,
  FinancialAnalysisSeriesSegment,
  FinancialAnalysisValue,
  MonthlyFinancialAnalysisData,
} from "../types/monthly-financial-analysis.js";
import {
  addFinancialAmounts,
  isValidFinancialDate,
} from "./monthlyFinancialReport.js";
import { listMonthlyFinancialTrendMonths } from "./monthlyFinancialTrend.js";
import { calculatePayrollBreakdown } from "./payrollCalculator.js";
import { loadFinancialAnalysisSources } from "./monthlyFinancialAnalysisSources.js";
import { buildMonthlyFinancialComparisonQuery } from "./monthlyFinancialAnalysisQuery.js";
import {
  buildMonthlyFinancialRentAccrual,
  type AnalysisRentAccrualContract,
} from "./monthlyFinancialRentAccrual.js";
import { allocateBalancedAnnualRent } from "./monthlyFinancialRentAllocation.js";
import { buildInvoiceLeaseHousingCosts } from "./monthlyFinancialInvoiceLeaseCosts.js";
import {
  originalProjectNumber,
  projectReceiptPreviewUnavailableReason,
  projectReceiptPreviewUrl,
  realReceiptNumber,
  type ProjectReceiptFileMetadata,
} from "./monthlyFinancialProjectReceiptPreview.js";

export interface FinancialAnalysisMetadata {
  schemaVersion: 1;
  payrollParts?: {
    salary: string;
    social: string;
    housing: string;
    adjustment: string;
  };
  canonicalPersonId?: string | null;
  reimbursementCategory?: string | null;
  reimbursementScope?: string | null;
  reimbursementScopeValue?: string | null;
  reimbursementScopePath?: string | null;
  reimbursementRegion?: string | null;
  reimbursementRegionSource?: string | null;
  reimbursementServiceTarget?: string | null;
  contractRootId?: string | null;
  partyA?: string | null;
  contractRegion?: string | null;
}

export interface FinancialAnalysisReport {
  month: string;
  status: "draft" | "closed" | "reopened" | "pending_review";
  generatedAt: string;
  savedAt: string | null;
  closedAt: string | null;
  analysisLive?: boolean;
  /** 仅用于本次只读分析的未来发生额诊断，不写入原报表或月结快照。 */
  analysisFutureSources?: string[];
  sources?: Array<{
    key: string;
    status: string;
    message?: string | null;
    lastUpdatedAt?: string | null;
    recordCount?: number;
    amount?: string;
  }>;
  validations?: {
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };
  accounts: Array<{
    code: string;
    name: string;
    opening: string;
    inflow: string;
    outflow: string;
    closing: string;
  }>;
  income: { mainReceipt: string; generalInterest: string };
  automaticDetails: Array<{
    sourceType: string;
    sourceId: string;
    occurredOn: string;
    accountCode: string;
    metric: string;
    amount: string;
    description: string;
    personId?: string | null;
    personName?: string | null;
    analysis?: FinancialAnalysisMetadata;
  }>;
  manualItems: Array<{
    id?: string;
    category: string;
    accountCode: string;
    direction: string;
    occurredOn: string;
    amount: string;
    description?: string | null;
    voucherReference?: string | null;
    sourceType?: string;
    effective?: boolean;
  }>;
}

export interface AnalysisContract {
  id: string;
  rootId: string;
  relationType: string;
  title: string;
  businessContractNo?: string | null;
  partyA: string | null;
  region: string | null;
  status: string;
  effectiveAt: string | null;
  contractDate: string | null;
  contractDateSource: string | null;
  originalAmount: string | null;
  amountDelta: string | null;
  amountBefore: string | null;
  amountAfter: string | null;
  supplementSequence: number | null;
  changeType: string | null;
  updatedAt: string | null;
}
export interface AnalysisReceipt {
  id: string;
  rootId: string;
  date: string;
  amount: string;
  currency: string | null;
  /** 来源层核对过的历史确认台账金额，兼容当时尚无币种字段的导入记录；不补写币种。 */
  historicalConfirmedAmount?: boolean;
  /**
   * 旧版人民币回单流程没有持久化币种；只有识别任务、原件摘要、业务字段与
   * 最终确认记录逐项一致时由来源层标记，分析层不会把普通空币种记录默认为人民币。
   */
  verifiedLegacyCnyAmount?: boolean;
  bankName?: string | null;
  electronicReceiptNo?: string | null;
  transactionSerialNo?: string | null;
  proofNo?: string | null;
  fileMetadata?: ProjectReceiptFileMetadata;
  status: string;
  reversedAt: string | null;
  updatedAt: string | null;
}
export interface AnalysisReimbursement {
  id: string;
  userId: string;
  employeeId: string | null;
  personName: string;
  type: "basic" | "large" | "business";
  date: string;
  amount: string;
  title: string;
  category: string | null;
  scope: string | null;
  scopePath?: string | null;
  region?: string | null;
  regionSource?: string | null;
  serviceTarget: string | null;
  updatedAt: string | null;
}
export interface AnalysisPayroll {
  id: string;
  employeeId: string;
  userId: string | null;
  personName: string;
  month: string;
  salary: string;
  housingBase: string;
  contributionBase: string;
  tax: string;
  withheldActual: string | null;
  netActual: string | null;
  updatedAt: string | null;
}
/** 已付款但业务日期缺失或无效的报销，只诊断归属，不计入任何月份。 */
export interface AnalysisUndatedReimbursement {
  id: string;
  type: AnalysisReimbursement["type"];
  amount: string;
  date: string | null;
  status: string;
  employeeId: string | null;
  userId: string | null;
  personName: string | null;
}
/** 三处报销分析共用的已确认报销月份来源，与现金付款日期来源相互独立。 */
export interface AnalysisPersonnelIncurredReimbursement {
  id: string;
  type: AnalysisReimbursement["type"];
  month: string | null;
  amount: string;
  status: string;
  employeeId: string | null;
  userId: string | null;
  personName: string | null;
  title?: string | null;
  category?: string | null;
  scope?: string | null;
  scopePath?: string | null;
  region?: string | null;
  regionSource?: string | null;
  serviceTarget?: string | null;
  updatedAt: string | null;
}
/** 已确认房屋租赁发票；收费单证据字段保留兼容旧口径，新口径按完整合同租期分摊。 */
export interface AnalysisHousingCostInvoice {
  id: string;
  rootId: string;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  invoiceAmount: string;
  billingMonth: string | null;
  periodReason: string;
  evidenceVersion: string;
  updatedAt: string | null;
  lines: Array<{
    id: string;
    category: string;
    amount: string;
    verified: boolean;
  }>;
}
export interface AnalysisOverheadAllocation {
  id: string;
  paymentId: string;
  paymentKind: string;
  currency?: string | null;
  date: string;
  paymentAmount: string;
  amount: string;
  invoiceId: string;
  invoiceAmount?: string;
  title: string;
  updatedAt: string | null;
  lines: Array<{
    id: string;
    category: string;
    amount: string;
    verified: boolean;
  }>;
}
export interface AnalysisOverheadCandidate {
  id: string;
  kind: string;
  date: string;
  amount: string;
  title: string;
  /** 已核实付款是否具有房租来源证据；仅房租待核验时未知，非租金资产排除。 */
  scopeCoverage?: "included" | "excluded" | "unknown";
  scopeReason?: string;
  /** 明确矛盾的证据不能进入已知分摊；单纯未足额匹配不等同于冲突。 */
  scopeConflict?: boolean;
}
export interface MonthlyFinancialAnalysisInput {
  query: FinancialAnalysisQuery;
  generatedAt: string;
  reports: FinancialAnalysisReport[];
  contracts?: AnalysisContract[];
  receipts?: AnalysisReceipt[];
  reimbursements?: AnalysisReimbursement[];
  /** 全历史未归期已付款报销清单；未提供表示没有按人员核验，不等于空清单。 */
  undatedReimbursements?: AnalysisUndatedReimbursement[];
  /** 完整已确认报销月份来源；提供后仅人力三类报销按发生月计算，不改变其他模块付款月口径。 */
  personnelIncurredReimbursements?: AnalysisPersonnelIncurredReimbursement[];
  /** 各类已付款报销的业务日期是否完整，用于区分真实零和未归期来源。 */
  reimbursementDatesComplete?: Partial<
    Record<"basic" | "large" | "business", boolean>
  >;
  payroll?: AnalysisPayroll[];
  /** 与月报一般账户资产支出相同的工程咨询付款来源，缺月报时仅作为已知部分。 */
  generalPayments?: Array<{
    id: string;
    date: string;
    amount: string;
    title: string;
    currency: string | null;
    updatedAt: string | null;
  }>;
  overheadAllocations?: AnalysisOverheadAllocation[];
  overheadCandidates?: AnalysisOverheadCandidate[];
  /** 已生效房屋租赁全量来源；明确提供后改按租期发生额，未提供仅兼容原票款分析。 */
  rentAccrualContracts?: AnalysisRentAccrualContract[];
  rentCurrentMonthMode?: "daily" | "full-month";
  housingCostInvoices?: AnalysisHousingCostInvoice[];
  housingCostBasis?: "invoice-lease";
  scopeNames?: Record<string, string>;
  warnings?: string[];
}
export interface MonthlyFinancialAnalysisLoadOptions {
  queryClient: Pick<PoolClient, "query">;
  loadReport: (
    month: string,
    client: Pick<PoolClient, "query">,
  ) => Promise<FinancialAnalysisReport>;
  now?: Date;
}

const ACCOUNT_NAMES: Record<string, string> = {
  general: "一般账户",
  business: "商务账户",
  welfare_one: "福利金账户一",
  welfare_two: "福利金账户二",
};
const OVERHEAD_NAMES: Record<string, string> = {
  rent: "租金",
};
const PAYROLL_LABELS: Record<string, string> = {
  salary: "应发工资",
  social: "公司社保",
  housing: "公司公积金",
  adjustment: "实际发生调整",
  basic: "基础报销",
  large: "大额报销",
  business: "商务报销",
  overhead: "房租分摊",
};
const CONFIRMED_REIMBURSEMENT_STATUSES = new Set([
  "approved",
  "paid",
  "payment_uploaded",
  "completed",
]);
function validReimbursementMonth(month: string | null): month is string {
  return (
    typeof month === "string" &&
    /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month) &&
    month >= "1900-01" &&
    month <= "2099-12"
  );
}
/** 三处报销分析先共用同一编号、金额、类型和报销月份事实，避免模块各自重复或改月。 */
function confirmedReimbursementOccurrences(
  input: MonthlyFinancialAnalysisInput,
): AnalysisPersonnelIncurredReimbursement[] {
  const byId = new Map<string, AnalysisPersonnelIncurredReimbursement>();
  for (const source of input.personnelIncurredReimbursements || []) {
    if (
      !CONFIRMED_REIMBURSEMENT_STATUSES.has(source.status) ||
      !["basic", "large", "business"].includes(source.type)
    )
      continue;
    if (!source.id?.trim())
      throw new Error("已确认报销缺少来源编号，不能跨模块去重");
    const row = { ...source, amount: amount(source.amount) };
    const previous = byId.get(row.id);
    if (!previous) {
      byId.set(row.id, row);
      continue;
    }
    if (
      previous.type !== row.type ||
      previous.amount !== row.amount ||
      previous.month !== row.month
    )
      throw new Error(
        "已确认报销同编号的类型、金额或报销月份存在矛盾，不能重复累计或猜测归期",
      );
    if (
      previous.scopePath !== row.scopePath ||
      previous.region !== row.region ||
      previous.scope !== row.scope
    )
      byId.set(row.id, {
        ...previous,
        scopePath: null,
        region: null,
        regionSource: "同一报销编号存在范围归属冲突，行政区待核对",
      });
  }
  return [...byId.values()];
}

function amount(value: string): string {
  if (!/^-?\d+(?:\.\d{1,12})?$/.test(String(value)))
    throw new Error("分析金额必须为最多十二位小数的十进制字符串");
  // 汇总可超过单笔录入十八位上限，不能再次套用单笔录入限制。
  return addFinancialAmounts(value);
}
function subtract(left: string, right: string): string {
  const normalized = amount(right);
  return addFinancialAmounts(
    left,
    normalized.startsWith("-") ? normalized.slice(1) : `-${normalized}`,
  );
}
function sum(values: Array<string | null>): string | null {
  return values.some((value) => value === null)
    ? null
    : addFinancialAmounts(...(values as string[]));
}
/** 同银行的真实回单号或流水号是重复证据；不按同日同金额猜测重复。 */
function duplicateReceiptIds(rows: AnalysisReceipt[]): Set<string> {
  const duplicates = new Set<string>();
  const ids = new Set<string>();
  const evidence = new Map<string, Set<string>>();
  for (const row of rows) {
    if (ids.has(row.id)) duplicates.add(row.id);
    ids.add(row.id);
    const bank = row.bankName
      ?.normalize("NFKC")
      .replace(/\s+/gu, "")
      .toLowerCase();
    if (!bank) continue;
    for (const [kind, raw] of [
      ["electronic", row.electronicReceiptNo],
      ["transaction", row.transactionSerialNo],
      ["proof", row.proofNo],
    ] as const) {
      const reference = raw
        ?.normalize("NFKC")
        .replace(/[^\p{L}\p{N}]/gu, "")
        .toUpperCase();
      if (!reference) continue;
      if (
        kind === "proof" &&
        reference ===
          row.transactionSerialNo
            ?.normalize("NFKC")
            .replace(/[^\p{L}\p{N}]/gu, "")
            .toUpperCase()
      )
        continue;
      const key = `${bank}:${kind}:${reference}`;
      const matches = evidence.get(key) || new Set<string>();
      matches.add(row.id);
      evidence.set(key, matches);
    }
  }
  for (const matches of evidence.values())
    if (matches.size > 1) for (const id of matches) duplicates.add(id);
  return duplicates;
}
/** 三个回款指标共用证据校验，未经核实的空币种、坏日期及重复证据都不能静默当作人民币或零。 */
function receiptIntegrityIssues(
  rows: AnalysisReceipt[],
  duplicates = duplicateReceiptIds(rows),
): string[] {
  const issues: string[] = [];
  if (rows.some((row) => !row.id.trim()))
    issues.push("回款来源编号缺失，不能核对金额");
  if (rows.some((row) => !isValidFinancialDate(row.date)))
    issues.push("存在回款业务日期缺失或无效，不能可靠归期");
  if (
    rows.some(
      (row) =>
        row.currency?.trim().toUpperCase() !== "CNY" &&
        !(
          !row.currency?.trim() &&
          (row.historicalConfirmedAmount === true ||
            row.verifiedLegacyCnyAmount === true)
        ),
    )
  )
    issues.push("存在币种缺失或非人民币回款，且没有冻结汇率");
  if (rows.some((row) => duplicates.has(row.id)))
    issues.push("回款来源编号或同银行凭证证据重复，未任意选一笔或重复计入");
  return issues;
}
function unique(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
function maxDate(values: Array<string | null | undefined>): string | null {
  let latest = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const text = value.trim();
    if (
      !/^\d{4}-\d{2}-\d{2}(?:[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
        text,
      ) ||
      !isValidFinancialDate(text.slice(0, 10))
    )
      continue;
    // 无时区的业务时间按北京时间解释；时区不同的来源按实际时刻比较。
    const zoned =
      text.length === 10
        ? `${text}T00:00:00+08:00`
        : /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)
          ? text.replace(" ", "T")
          : `${text.replace(" ", "T")}+08:00`;
    const timestamp = Date.parse(zoned);
    if (Number.isFinite(timestamp)) latest = Math.max(latest, timestamp);
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}
function monthOf(date: string): string {
  return date.slice(0, 7);
}
/** 时间戳先转北京时间业务日；纯业务日期不经过时区转换。 */
export function financialAnalysisBusinessDate(
  value: string | null,
): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return isValidFinancialDate(value) ? value : null;
  const withZone =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)
      ? `${value.replace(" ", "T")}+08:00`
      : value;
  const timestamp = new Date(withZone);
  if (!Number.isFinite(timestamp.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const field = (type: string) =>
    parts.find((part) => part.type === type)!.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}
function state(report?: FinancialAnalysisReport): string {
  return report?.status === "closed"
    ? "已月结快照"
    : report?.analysisLive
      ? "最新业务只读试算（未保存）"
      : report
        ? "未月结工作值"
        : "已确认业务来源";
}
function inPeriod(month: string, from: string, to: string): boolean {
  return month >= from && month <= to;
}
function sourceMissing(
  report: FinancialAnalysisReport | undefined,
  keys?: string[],
): boolean {
  return Boolean(
    report?.analysisFutureSources?.some((key) => !keys || keys.includes(key)) ||
    report?.sources?.some(
      (source) =>
        (!keys || keys.includes(source.key)) &&
        ["missing", "error"].includes(source.status),
    ),
  );
}
function endDate(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
}
function column(
  key: string,
  label: string,
  format: FinancialAnalysisColumn["format"] = "text",
): FinancialAnalysisColumn {
  return { key, label, format };
}
function value(
  key: string,
  label: string,
  total: string | null,
  note?: string,
): FinancialAnalysisValue {
  return { key, label, amount: total, ...(note ? { note } : {}) };
}

/** 月视图按月；季度、年度仅合并当前查询范围，不暗中扩充收入统计区间。 */
export function buildFinancialAnalysisPeriods(
  query: FinancialAnalysisQuery,
): FinancialAnalysisPeriod[] {
  if (!["month", "quarter", "year"].includes(query.granularity))
    throw new Error("统计粒度必须为月度、季度或年度");
  const groups = new Map<string, FinancialAnalysisPeriod>();
  for (const month of listMonthlyFinancialTrendMonths(query.from, query.to)) {
    const year = month.slice(0, 4);
    const key =
      query.granularity === "year"
        ? year
        : query.granularity === "quarter"
          ? `${year}-Q${Math.ceil(Number(month.slice(5)) / 3)}`
          : month;
    const label =
      query.granularity === "year"
        ? `${year}年`
        : query.granularity === "quarter"
          ? `${year}年第${key.at(-1)}季度`
          : month;
    const previous = groups.get(key);
    if (previous) previous.to = month;
    else groups.set(key, { key, label, from: month, to: month });
  }
  return [...groups.values()];
}

/** 按权重分配来源金额，最小单位为来源精度（至少分），余数按稳定编号分配。 */
export function allocateFinancialAmount(
  total: string,
  weights: Array<{ id: string; amount: string }>,
): Map<string, string> {
  const normalized = amount(total);
  if (normalized.startsWith("-")) throw new Error("费用分摊金额不能为负数");
  if (new Set(weights.map((row) => row.id)).size !== weights.length)
    throw new Error("费用分摊对象编号重复");
  if (!weights.length) return new Map();
  const precision = Math.max(2, normalized.split(".")[1]?.length || 0);
  const toUnits = (text: string, digits: number) => {
    const [integer, fraction = ""] = text.split(".");
    return (
      BigInt(integer) * 10n ** BigInt(digits) +
      BigInt(fraction.padEnd(digits, "0") || "0")
    );
  };
  const weightPrecision = Math.max(
    0,
    ...weights.map((row) => amount(row.amount).split(".")[1]?.length || 0),
  );
  const ordered = [...weights].sort((a, b) => a.id.localeCompare(b.id));
  const units = toUnits(normalized, precision);
  const weightUnits = ordered.map((row) => {
    const text = amount(row.amount);
    if (text.startsWith("-")) throw new Error("费用分摊权重不能为负数");
    return toUnits(text, weightPrecision);
  });
  const denominator = weightUnits.reduce((a, b) => a + b, 0n);
  if (denominator === 0n) throw new Error("费用分摊权重合计必须大于零");
  const allocations = weightUnits.map((weight, index) => ({
    index,
    units: (units * weight) / denominator,
    remainder: (units * weight) % denominator,
  }));
  let remaining = units - allocations.reduce((a, row) => a + row.units, 0n);
  for (const row of [...allocations].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (remaining === 0n) break;
    row.units += 1n;
    remaining -= 1n;
  }
  return new Map(
    allocations.map((row) => {
      const digits = row.units.toString().padStart(precision + 1, "0");
      return [
        ordered[row.index].id,
        amount(`${digits.slice(0, -precision)}.${digits.slice(-precision)}`),
      ];
    }),
  );
}

interface LedgerRow {
  id: string;
  month: string;
  date: string;
  name: string;
  amount: string;
  account: string;
  metric: string;
  direction: "income" | "expense";
  sourceId: string;
  sourceType: string;
  sourceState: string;
  personId: string | null;
  personName: string | null;
  reimbursement?: AnalysisReimbursement;
  payroll?: AnalysisPayroll;
  receipt?: AnalysisReceipt;
  contract?: AnalysisContract;
  voucherReference?: string | null;
  taxEvidenceComplete?: boolean;
  analysis?: FinancialAnalysisMetadata;
  frozenPayrollParts?: FinancialAnalysisMetadata["payrollParts"];
}
function payrollValues(row: AnalysisPayroll) {
  const calculated = calculatePayrollBreakdown(
    row.salary,
    row.housingBase,
    row.contributionBase,
    row.tax,
  );
  const total = addFinancialAmounts(
    row.withheldActual ?? calculated.withheld_total,
    row.netActual ?? calculated.net_salary,
  );
  return {
    salary: amount(row.salary),
    social: amount(calculated.company_social_total),
    housing: amount(calculated.company_housing_fund),
    adjustment: subtract(
      total,
      addFinancialAmounts(
        row.salary,
        calculated.company_social_total,
        calculated.company_housing_fund,
      ),
    ),
    total,
  };
}
function ledgerDetails(rows: LedgerRow[]): FinancialAnalysisDetail[] {
  return rows.map((row) => ({
    id: row.id,
    month: row.month,
    date: row.date,
    name: row.name,
    amount: row.amount,
    account: ACCOUNT_NAMES[row.account] || row.account,
    person: row.personName,
    partyA: row.contract?.partyA || null,
    region: row.contract?.region || null,
    scope: row.reimbursement?.scope || null,
    sourceId: row.sourceId,
    voucherReference: row.voucherReference || null,
    sourceState: row.sourceState,
  }));
}
const LEDGER_COLUMNS = [
  column("date", "发生日期"),
  column("name", "业务事项"),
  column("amount", "金额", "amount"),
  column("person", "人员"),
  column("sourceId", "来源编号"),
  column("voucherReference", "凭证号"),
  column("sourceState", "数据状态"),
];

export function buildMonthlyFinancialAnalysis(
  input: MonthlyFinancialAnalysisInput,
): MonthlyFinancialAnalysisData {
  const comparisonQuery = buildMonthlyFinancialComparisonQuery(input.query);
  if (comparisonQuery) {
    const currentQuery = { ...input.query };
    delete currentQuery.comparisonYear;
    const current = buildMonthlyFinancialAnalysis({
      ...input,
      query: currentQuery,
    });
    const comparison = buildMonthlyFinancialAnalysis({
      ...input,
      query: comparisonQuery,
    });
    return {
      ...current,
      query: { ...input.query },
      comparison: {
        label: `${input.query.comparisonYear}年同期（${comparisonQuery.from}至${comparisonQuery.to}）`,
        query: comparisonQuery,
        modules: comparison.modules,
        warnings: comparison.warnings,
      },
    };
  }
  const asOfDate = financialAnalysisBusinessDate(input.generatedAt);
  if (!asOfDate) throw new Error("分析生成时间无效");
  const asOfMonth = monthOf(asOfDate);
  const futureReportWarnings: string[] = [];
  const isFutureDate = (date: string) => {
    const businessDate = financialAnalysisBusinessDate(date);
    return businessDate !== null && businessDate > asOfDate;
  };
  const futureSource = (metric: string, sourceType: string) => {
    if (sourceType === "contract_receipt") return "contract_receipts";
    if (sourceType === "payroll" || metric === "human_cost") return "payroll";
    if (sourceType === "asset_payment" || metric === "asset_administration")
      return "asset_payments";
    if (metric === "welfare_one_electricity") return "overhead";
    return metric || sourceType;
  };
  const reports = input.reports
    .filter((row) => row.month <= asOfMonth)
    .map((report) => {
      const futureAutomatic = report.automaticDetails.filter((detail) =>
        isFutureDate(detail.occurredOn),
      );
      const futureManual = report.manualItems.filter((detail) =>
        isFutureDate(detail.occurredOn),
      );
      if (!futureAutomatic.length && !futureManual.length) return report;
      const effectiveFutureManual = futureManual.filter(
        (detail) => detail.effective !== false,
      );
      const affectedSources = unique([
        ...(report.analysisFutureSources || []),
        ...futureAutomatic.map((detail) =>
          futureSource(detail.metric, detail.sourceType),
        ),
        ...effectiveFutureManual.map((detail) =>
          futureSource(detail.category, detail.sourceType || "manual"),
        ),
      ]);
      if (futureAutomatic.length || effectiveFutureManual.length)
        futureReportWarnings.push(
          `${report.month}报表包含晚于${asOfDate}的未来发生明细，已从本次实际发生分析中排除；受影响汇总保留未知，已发生明细仍可追溯，原报表及月结快照未修改。`,
        );
      return {
        ...report,
        automaticDetails: report.automaticDetails.filter(
          (detail) => !isFutureDate(detail.occurredOn),
        ),
        manualItems: report.manualItems.filter(
          (detail) => !isFutureDate(detail.occurredOn),
        ),
        analysisFutureSources: affectedSources,
      };
    });
  // 未来工资可以预生成，但它不是已经发生的年度成本；未来付款同样不能作为实际发生额。
  input = {
    ...input,
    reports,
    payroll: (input.payroll || []).filter((row) => row.month <= asOfMonth),
    reimbursements: input.reimbursements?.filter(
      (row) => !isValidFinancialDate(row.date) || row.date <= asOfDate,
    ),
    // 日期异常仍需参与未知诊断，不能在来源层丢弃后把期间实际回款误报为零。
    receipts: input.receipts?.filter(
      (row) => !isValidFinancialDate(row.date) || row.date <= asOfDate,
    ),
    overheadAllocations: input.overheadAllocations?.filter(
      (row) => !isValidFinancialDate(row.date) || row.date <= asOfDate,
    ),
    overheadCandidates: input.overheadCandidates?.filter(
      (row) => !isValidFinancialDate(row.date) || row.date <= asOfDate,
    ),
    warnings: [
      ...(input.warnings || []),
      ...futureReportWarnings,
      ...(input.query.to > asOfMonth
        ? [
            "查询包含未来月份，未来预生成工资及付款不计入实际发生额；未来趋势保留未知，年度已录入成本截至当前北京时间业务日。",
          ]
        : []),
    ],
  };
  const { query } = input;
  const periods = buildFinancialAnalysisPeriods(query);
  const months = listMonthlyFinancialTrendMonths(query.from, query.to);
  const reportMap = new Map(
    input.reports.map((report) => [report.month, report]),
  );
  if (reportMap.size !== input.reports.length)
    throw new Error("同一月份存在重复报表");
  const reimbursements = input.reimbursements || [];
  const reimbursementOccurrenceEnabled =
    input.personnelIncurredReimbursements !== undefined;
  const reimbursementOccurrences = reimbursementOccurrenceEnabled
    ? confirmedReimbursementOccurrences(input)
    : [];
  const payroll = input.payroll || [];
  const contracts = input.contracts || [];
  const receipts = input.receipts || [];
  const roots = new Map(
    contracts
      .filter((row) => row.relationType === "main")
      .map((row) => [row.id, row]),
  );
  const receiptMap = new Map(receipts.map((row) => [row.id, row]));
  const receiptSourceAvailable = input.receipts !== undefined;
  const currentReceipts = receipts.filter((row) => row.status === "confirmed");
  const currentDuplicateIds = duplicateReceiptIds(currentReceipts);
  const receiptIssuesByMonth = new Map<string, string[]>();
  const unreliableReceiptIdsByMonth = new Map<string, Set<string>>();
  const recordReceiptIssues = (
    month: string,
    rows: AnalysisReceipt[],
    duplicates: Set<string>,
  ) => {
    const issues = receiptIntegrityIssues(rows, duplicates);
    if (!issues.length) return;
    receiptIssuesByMonth.set(month, issues);
    unreliableReceiptIdsByMonth.set(
      month,
      new Set(
        rows
          .filter((row) => receiptIntegrityIssues([row], duplicates).length)
          .map((row) => row.id),
      ),
    );
  };
  const receiptMatchesFilters = (row: AnalysisReceipt) => {
    const root = roots.get(row.rootId);
    // 无可靠合同归属不能证明属于筛选范围外；已核实范围外的记录不污染当前筛选。
    return (
      !root ||
      ((!query.partyA || root.partyA === query.partyA) &&
        (!query.contractRegion || root.region === query.contractRegion))
    );
  };
  for (const report of input.reports) {
    const receiptDetails = report.automaticDetails.filter(
      (row) =>
        row.sourceType === "contract_receipt" && row.metric === "main_receipt",
    );
    const sourceIds = new Set(receiptDetails.map((row) => row.sourceId));
    if (report.status === "closed") {
      // 月结金额是原报表已冻结的金额事实，不给实时空币种补人民币，也不用后来改动的台账推翻旧值。
      // 只检查快照自身日期和来源编号；汇总与明细差额继续由原有核对分支提示，绝不重新叠加实时金额。
      const issues: string[] = [];
      const invalidIds = new Set<string>();
      const seen = new Set<string>();
      for (const detail of receiptDetails) {
        if (!detail.sourceId.trim()) {
          issues.push("已月结回款快照的来源编号缺失，不能核对金额");
          invalidIds.add(detail.sourceId);
        }
        if (seen.has(detail.sourceId)) {
          issues.push("已月结回款快照存在重复来源编号，不能重复计款");
          invalidIds.add(detail.sourceId);
        }
        seen.add(detail.sourceId);
        if (
          !isValidFinancialDate(detail.occurredOn) ||
          monthOf(detail.occurredOn) !== report.month
        ) {
          issues.push(
            "已月结回款快照的业务日期缺失、无效或与报表月份不符，不能可靠归期",
          );
          invalidIds.add(detail.sourceId);
        }
      }
      if (issues.length) {
        receiptIssuesByMonth.set(report.month, unique(issues));
        unreliableReceiptIdsByMonth.set(report.month, invalidIds);
      }
      continue;
    }
    // 开放月同时诊断不能进入按月查询的坏业务日期，继续严格校验当前币种及重复证据。
    const candidates = receipts.filter(
      (row) =>
        sourceIds.has(row.id) ||
        (row.status === "confirmed" &&
          receiptMatchesFilters(row) &&
          (!isValidFinancialDate(row.date) ||
            monthOf(row.date) === report.month)),
    );
    recordReceiptIssues(report.month, candidates, currentDuplicateIds);
  }
  for (const month of months) {
    if (reportMap.has(month)) continue;
    const candidates = currentReceipts.filter((row) => {
      return (
        receiptMatchesFilters(row) &&
        (!isValidFinancialDate(row.date) || monthOf(row.date) === month)
      );
    });
    recordReceiptIssues(month, candidates, currentDuplicateIds);
  }
  const reimbursementMap = new Map(reimbursements.map((row) => [row.id, row]));
  if (reimbursementMap.size !== reimbursements.length)
    throw new Error("报销分析来源出现重复编号，已阻止重复计算金额");
  const payrollMap = new Map(payroll.map((row) => [row.id, row]));
  const userEmployees = new Map<string, string>();
  for (const row of payroll)
    if (row.userId) userEmployees.set(row.userId, row.employeeId);
  for (const row of reimbursements)
    if (row.employeeId) userEmployees.set(row.userId, row.employeeId);
  const people = new Map<string, string>();
  const warnings: string[] = [...(input.warnings || [])];
  for (const report of input.reports.filter((row) =>
    inPeriod(row.month, query.from, query.to),
  )) {
    for (const issue of [
      ...(report.validations?.blockers || []),
      ...(report.validations?.warnings || []),
    ])
      warnings.push(`${report.month}：${issue.message}`);
    for (const source of report.sources || [])
      if (["missing", "error"].includes(source.status))
        warnings.push(
          `${report.month}来源${source.key}不可用：${source.message || "来源缺失，相关合计保留未知"}`,
        );
  }
  const ledger: LedgerRow[] = [];
  const missing = months.filter((month) => !reportMap.has(month));
  if (missing.length)
    warnings.push(
      `${missing.join("、")}尚无已保存月报；账户余额和结算指标保留未知，业务来源金额不冒充完整月报。`,
    );
  const module = (
    key: FinancialAnalysisModuleKey,
    title: string,
    description: string,
    sourceLabel: string,
  ): FinancialAnalysisModule => ({
    key,
    title,
    description,
    sourceLabel,
    updatedAt: maxDate(
      input.reports
        .filter((row) => inPeriod(row.month, query.from, query.to))
        .flatMap((row) => [
          row.savedAt,
          ...(row.sources || []).map((source) => source.lastUpdatedAt),
        ]),
    ),
    periods,
    series: [],
    summaries: [],
    breakdown: [],
    comparison: [],
    columns: [],
    details: [],
    warnings: [],
    appliedFilters: ["时间"],
  });
  const addLedger = (row: LedgerRow) => {
    row.amount = amount(row.amount);
    if (row.personId) people.set(row.personId, row.personName || row.personId);
    ledger.push(row);
  };
  const enrich = (row: LedgerRow) => {
    // 先统一精确十进制表达，再按同编号、同月、同金额补充维度。
    row.amount = amount(row.amount);
    const frozen = row.analysis;
    if (frozen?.schemaVersion === 1) {
      if (frozen.canonicalPersonId) row.personId = frozen.canonicalPersonId;
      if (row.sourceType === "payroll") {
        const parts = frozen.payrollParts;
        try {
          if (
            !parts ||
            Object.values(parts).some((part) => typeof part !== "string") ||
            addFinancialAmounts(
              ...[
                parts.salary,
                parts.social,
                parts.housing,
                parts.adjustment,
              ].map(amount),
            ) !== row.amount
          )
            throw new Error("工资冻结分项与快照总成本不一致");
          row.frozenPayrollParts = {
            salary: amount(parts.salary),
            social: amount(parts.social),
            housing: amount(parts.housing),
            adjustment: amount(parts.adjustment),
          };
          row.sourceState += "；工资分项取原报表冻结值";
        } catch {
          row.sourceState += "；工资冻结分项缺失或校验失败，保留原总成本";
          warnings.push(
            `${row.month}工资${row.sourceId}冻结分项缺失或与原总成本不一致，未改用当前台账覆盖历史。`,
          );
        }
      } else if (row.sourceType === "reimbursement") {
        const frozenRegion =
          frozen.reimbursementScopeValue &&
          frozen.reimbursementScopePath &&
          frozen.reimbursementRegionSource
            ? frozen.reimbursementRegion || null
            : null;
        const type = row.metric.replace(
          "_reimbursement",
          "",
        ) as AnalysisReimbursement["type"];
        row.personId =
          frozen.canonicalPersonId ||
          (row.personId ? `user:${row.personId.replace(/^user:/, "")}` : null);
        row.reimbursement = {
          id: row.sourceId,
          userId: row.personId || "",
          employeeId: row.personId?.startsWith("user:") ? null : row.personId,
          personName: row.personName || "历史人员信息缺失",
          type,
          date: row.date,
          amount: row.amount,
          title: row.name,
          category: frozen.reimbursementCategory ?? null,
          scope:
            frozen.reimbursementScopePath || frozen.reimbursementScope || null,
          scopePath: frozen.reimbursementScopePath ?? null,
          region: frozenRegion,
          regionSource: frozenRegion
            ? `原报表冻结行政区；${frozen.reimbursementRegionSource || "冻结范围层级"}`
            : "原报表未冻结可核验行政区，当前范围配置不替代历史归属",
          serviceTarget: frozen.reimbursementServiceTarget ?? null,
          updatedAt: null,
        };
        row.sourceState += "；人员、分类和报销范围取原报表冻结值";
      } else if (row.sourceType === "contract_receipt") {
        const rootId = frozen.contractRootId || `snapshot:${row.sourceId}`;
        row.contract = {
          id: rootId,
          rootId,
          relationType: "main",
          title: row.name,
          partyA: frozen.partyA ?? null,
          region: frozen.contractRegion ?? null,
          status: "effective",
          effectiveAt: null,
          contractDate: null,
          contractDateSource: null,
          originalAmount: null,
          amountDelta: null,
          amountBefore: null,
          amountAfter: null,
          supplementSequence: null,
          changeType: null,
          updatedAt: null,
        };
        row.sourceState += "；甲方和合同区域取原报表冻结值";
      }
      // 有版本化冻结数据时，缺失字段也不由可变台账补写；旧无元数据快照仍走原兼容规则。
      return row;
    }
    const reimbursement = reimbursementMap.get(row.sourceId);
    const pay = payrollMap.get(row.sourceId);
    const receipt = receiptMap.get(row.sourceId);
    // 只补充同一来源、同一发生月且金额完全一致的维度，不用当前台账覆盖历史金额。
    if (
      row.sourceType === "reimbursement" &&
      reimbursement &&
      amount(reimbursement.amount) === row.amount &&
      monthOf(reimbursement.date) === row.month
    ) {
      row.reimbursement = {
        ...reimbursement,
        scope:
          reportMap.get(row.month)?.status === "closed"
            ? reimbursement.scope
            : reimbursement.scopePath ||
              input.scopeNames?.[reimbursement.scope || ""] ||
              reimbursement.scope,
        scopePath:
          reportMap.get(row.month)?.status === "closed"
            ? null
            : (reimbursement.scopePath ?? null),
        region:
          reportMap.get(row.month)?.status === "closed"
            ? null
            : (reimbursement.region ?? null),
        regionSource:
          reportMap.get(row.month)?.status === "closed"
            ? "旧月结未冻结行政区与完整范围路径，当前台账不替代历史归属"
            : reimbursement.regionSource || "缺少可核验范围层级，行政区未知",
      };
      row.personId =
        reimbursement.employeeId ||
        userEmployees.get(reimbursement.userId) ||
        `user:${reimbursement.userId}`;
      row.personName = row.personName || reimbursement.personName;
      row.sourceState += "；范围按同编号同金额当前台账补充";
    } else if (
      row.sourceType === "payroll" &&
      pay &&
      payrollValues(pay).total === row.amount &&
      pay.month === row.month
    ) {
      if (reportMap.get(row.month)?.status !== "closed") row.payroll = pay;
      row.personId = pay.employeeId;
      row.sourceState += row.payroll
        ? "；分项按同编号同金额当前台账补充"
        : "；工资分项未冻结，不以当前组成替代历史";
    } else if (
      row.sourceType === "contract_receipt" &&
      receipt &&
      amount(receipt.amount) === row.amount &&
      monthOf(receipt.date) === row.month
    ) {
      row.receipt = receipt;
      row.contract = roots.get(receipt.rootId);
      row.sourceState += "；合同维度按同编号同金额当前台账补充";
    }
    if (
      row.sourceType === "reimbursement" &&
      !row.reimbursement &&
      row.personId
    )
      row.personId = userEmployees.get(row.personId) || `user:${row.personId}`;
    return row;
  };
  const expenseMetrics = new Set([
    "human_cost",
    "basic_reimbursement",
    "large_reimbursement",
    "business_reimbursement",
    "asset_administration",
  ]);
  for (const report of input.reports) {
    for (const detail of report.automaticDetails) {
      if (
        !expenseMetrics.has(detail.metric) &&
        ![
          "main_receipt",
          "accounting_base",
          "marketing_reserve",
          "business_cost",
        ].includes(detail.metric)
      )
        continue;
      addLedger(
        enrich({
          id: `${report.month}:${detail.sourceType}:${detail.sourceId}:${detail.metric}`,
          month: report.month,
          date: detail.occurredOn,
          name: detail.description,
          amount: amount(detail.amount),
          account: detail.accountCode,
          metric: detail.metric,
          direction: expenseMetrics.has(detail.metric) ? "expense" : "income",
          sourceId: detail.sourceId,
          sourceType: detail.sourceType,
          sourceState: state(report),
          personId: detail.personId || null,
          personName: detail.personName || null,
          analysis: detail.analysis,
        }),
      );
    }
    for (const [index, detail] of report.manualItems.entries()) {
      if (detail.effective === false) continue;
      addLedger({
        id: `${report.month}:manual:${detail.id || index}`,
        month: report.month,
        date: detail.occurredOn,
        name: detail.description || detail.category,
        amount: amount(detail.amount),
        account: detail.accountCode,
        metric: detail.category,
        direction: detail.direction === "income" ? "income" : "expense",
        sourceId: detail.id || `${report.month}:${index}`,
        sourceType: detail.sourceType || "manual",
        sourceState: state(report),
        voucherReference: detail.voucherReference || null,
        taxEvidenceComplete:
          detail.category === "general_tax_payment"
            ? Boolean(
                String(detail.description || "").trim() &&
                String(detail.voucherReference || "").trim(),
              )
            : undefined,
        personId: null,
        personName: null,
      });
    }
  }
  for (const row of reimbursements) {
    if (!isValidFinancialDate(row.date)) {
      warnings.push(
        "存在已付款报销缺少有效实际付款日期，未猜测归月或计入已归期金额。",
      );
      continue;
    }
    if (reportMap.has(monthOf(row.date))) continue;
    addLedger(
      enrich({
        id: `source:reimbursement:${row.id}`,
        month: monthOf(row.date),
        date: row.date,
        name: row.title,
        amount: row.amount,
        account: row.type === "business" ? "business" : "general",
        metric: `${row.type}_reimbursement`,
        direction: "expense",
        sourceId: row.id,
        sourceType: "reimbursement",
        sourceState: "已付款业务来源（未核算月报）",
        personId: row.userId,
        personName: row.personName,
      }),
    );
  }
  for (const row of payroll) {
    if (reportMap.has(row.month)) continue;
    addLedger(
      enrich({
        id: `source:payroll:${row.id}`,
        month: row.month,
        date: `${row.month}-01`,
        name: "人力成本",
        amount: payrollValues(row).total,
        account: "general",
        metric: "human_cost",
        direction: "expense",
        sourceId: row.id,
        sourceType: "payroll",
        sourceState: "工资业务来源（未核算月报）",
        personId: row.employeeId,
        personName: row.personName,
      }),
    );
  }
  for (const row of receipts) {
    if (!isValidFinancialDate(row.date)) {
      warnings.push(`回款${row.id}的业务日期无效，未猜测归月。`);
      continue;
    }
    if (row.status !== "confirmed" || reportMap.has(monthOf(row.date)))
      continue;
    const issues = receiptIntegrityIssues([row], currentDuplicateIds);
    if (issues.length) {
      warnings.push(
        `${row.date}回款${row.id}：${issues.join("；")}，未混入可核验人民币明细。`,
      );
      continue;
    }
    addLedger(
      enrich({
        id: `source:receipt:${row.id}`,
        month: monthOf(row.date),
        date: row.date,
        name: roots.get(row.rootId)?.title || "主营实际回款",
        amount: row.amount,
        account: "general",
        metric: "main_receipt",
        direction: "income",
        sourceId: row.id,
        sourceType: "contract_receipt",
        sourceState: "已确认回款（未核算月报）",
        personId: null,
        personName: null,
      }),
    );
  }
  for (const row of input.generalPayments || []) {
    if (
      !isValidFinancialDate(row.date) ||
      row.date > asOfDate ||
      reportMap.has(monthOf(row.date))
    )
      continue;
    if (row.currency && row.currency.trim().toUpperCase() !== "CNY") continue;
    addLedger({
      id: `source:asset:${row.id}`,
      month: monthOf(row.date),
      date: row.date,
      name: row.title,
      amount: amount(row.amount),
      account: "general",
      metric: "asset_administration",
      direction: "expense",
      sourceId: row.id,
      sourceType: "general_asset_payment",
      sourceState: "已确认资产付款（未核算月报）",
      personId: null,
      personName: null,
    });
  }
  const selectedLedger = ledger.filter((row) =>
    inPeriod(row.month, query.from, query.to),
  );
  const hasContractFilter = Boolean(query.partyA || query.contractRegion);
  const matchesContract = (contract?: AnalysisContract) =>
    (!query.partyA || contract?.partyA === query.partyA) &&
    (!query.contractRegion || contract?.region === query.contractRegion);
  const reportAggregate = (
    period: FinancialAnalysisPeriod,
    metric: "inflow" | "outflow",
    account?: string,
  ) =>
    sum(
      listMonthlyFinancialTrendMonths(period.from, period.to).map((month) => {
        const report = reportMap.get(month);
        return report && !sourceMissing(report)
          ? addFinancialAmounts(
              ...report.accounts
                .filter((row) => !account || row.code === account)
                .map((row) => row[metric]),
            )
          : null;
      }),
    );

  const balances = module(
    "balances",
    "账户余额资金台帐",
    "四账户余额取期间末月，不累计月末余额。",
    "已保存月报；已月结读取对应版本快照，未月结读取当前工作值",
  );
  const closing = (month: string, account?: string): string | null => {
    const report = reportMap.get(month);
    if (
      !report ||
      sourceMissing(report) ||
      report.accounts.length !== 4 ||
      Object.keys(ACCOUNT_NAMES).some(
        (key) => !report.accounts.some((row) => row.code === key),
      )
    )
      return null;
    return account
      ? report.accounts.find((row) => row.code === account)!.closing
      : addFinancialAmounts(...report.accounts.map((row) => row.closing));
  };
  for (const [key, label] of [
    ...Object.entries(ACCOUNT_NAMES),
    ["total", "四账户合计"],
  ]) {
    balances.series.push({
      key,
      label,
      values: periods.map((period) =>
        closing(period.to, key === "total" ? undefined : key),
      ),
    });
    balances.summaries.push(
      value(
        key,
        label,
        closing(query.to, key === "total" ? undefined : key),
        `${query.to}期末值`,
      ),
    );
  }
  balances.breakdown = balances.summaries.filter((row) => row.key !== "total");
  balances.columns = [
    column("month", "报表月份"),
    column("account", "账户"),
    column("opening", "期初余额", "amount"),
    column("inflow", "结算流入", "amount"),
    column("outflow", "结算流出", "amount"),
    column("closing", "期末余额", "amount"),
    column("sourceState", "核算状态"),
    column("updatedAt", "更新时间"),
  ];
  balances.details = months.flatMap((month) => {
    const report = reportMap.get(month);
    return Object.entries(ACCOUNT_NAMES).map(([code, account]) => {
      const row = report?.accounts.find((item) => item.code === code);
      return {
        id: `${month}:${code}`,
        month,
        account,
        opening: row?.opening ?? null,
        inflow: sourceMissing(report) ? null : (row?.inflow ?? null),
        outflow: sourceMissing(report) ? null : (row?.outflow ?? null),
        closing: sourceMissing(report) ? null : (row?.closing ?? null),
        sourceState: report ? state(report) : "尚未建立月报",
        updatedAt: maxDate([
          report?.savedAt,
          report?.closedAt,
          ...(report?.sources || []).map((source) => source.lastUpdatedAt),
        ]),
      };
    });
  });
  if (
    balances.breakdown.some((row) => row.amount?.startsWith("-")) ||
    balances.summaries.at(-1)?.amount === "0"
  )
    balances.warnings.push(
      "期末余额存在负数或合计为零，余额结构图不适用，请以真实金额为准。",
    );
  if (!reportMap.has(query.to))
    balances.warnings.push(
      `${query.to}没有已保存月报，不能用更早余额冒充本期期末余额。`,
    );

  const inflow = module(
    "inflow",
    "一般账户入账统计",
    "主营实际回款与一般账户利息分列；实际回款不是拆分后的账户核算基数。",
    "已有月报沿用原汇总、不重复叠加回款；缺月报时直接核对完整已确认主营回款来源，无发生额为零、异常保留未知；利息仍需独立来源",
  );
  if (!receiptSourceAvailable && months.some((month) => !reportMap.has(month)))
    inflow.warnings.push(
      "部分月份没有月报且未提供完整回款来源，主营回款未知，不能补零。",
    );
  for (const month of months) {
    const issues = receiptIssuesByMonth.get(month);
    if (!issues?.length) continue;
    inflow.warnings.push(
      `${month}主营回款：${issues.join("；")}，主营人民币汇总保留未知；人民币明细仅为已知部分，不作为该月完整回款额。`,
    );
  }
  const mainRows = selectedLedger.filter(
    (row) => row.metric === "main_receipt" && matchesContract(row.contract),
  );
  if (hasContractFilter)
    inflow.appliedFilters.push(
      ...[
        query.partyA ? "甲方" : "",
        query.contractRegion ? "合同区域" : "",
      ].filter(Boolean),
    );
  const monthlyReceipt = (month: string) => {
    const report = reportMap.get(month);
    if (
      sourceMissing(report, ["contract_receipts"]) ||
      receiptIssuesByMonth.has(month) ||
      month > asOfMonth ||
      (!report && !receiptSourceAvailable)
    )
      return null;
    const all = ledger.filter(
      (row) => row.month === month && row.metric === "main_receipt",
    );
    if (
      hasContractFilter &&
      (all.some((row) => !row.contract) ||
        (report &&
          addFinancialAmounts(...all.map((row) => row.amount)) !==
            amount(report.income.mainReceipt)))
    )
      return null;
    if (report && !hasContractFilter) return amount(report.income.mainReceipt);
    return addFinancialAmounts(
      ...all
        .filter((row) => matchesContract(row.contract))
        .map((row) => row.amount),
    );
  };
  inflow.series = [
    {
      key: "receipt",
      label: "主营实际回款",
      values: periods.map((period) =>
        sum(
          listMonthlyFinancialTrendMonths(period.from, period.to).map(
            monthlyReceipt,
          ),
        ),
      ),
    },
    {
      key: "interest",
      label: "一般账户利息",
      values: periods.map((period) =>
        hasContractFilter
          ? null
          : sum(
              listMonthlyFinancialTrendMonths(period.from, period.to).map(
                (month) =>
                  sourceMissing(reportMap.get(month), [
                    "monthly_bank_receipts",
                    "general_interest",
                  ])
                    ? null
                    : (reportMap.get(month)?.income.generalInterest ?? null),
              ),
            ),
      ),
    },
  ];
  inflow.summaries = inflow.series.map((row) =>
    value(row.key, row.label, sum(row.values)),
  );
  inflow.columns = [
    ...LEDGER_COLUMNS,
    column("partyA", "甲方"),
    column("region", "合同区域"),
  ];
  inflow.details = ledgerDetails([
    ...mainRows,
    ...(!hasContractFilter
      ? selectedLedger.filter((row) => row.metric === "general_interest")
      : []),
  ]);
  for (const detail of inflow.details) {
    if (
      !unreliableReceiptIdsByMonth
        .get(detail.month || "")
        ?.has(detail.sourceId || "")
    )
      continue;
    const original = receiptMap.get(detail.sourceId || "");
    const originalCurrency =
      original?.currency?.trim().toUpperCase() || "未标注";
    detail.sourceState = `${detail.sourceState || ""}；原币${originalCurrency}金额${detail.amount}；${receiptIssuesByMonth.get(detail.month || "")?.join("；")}，人民币金额未知`;
    detail.amount = null;
  }
  for (const month of months) {
    const report = reportMap.get(month);
    if (!report) continue;
    for (const [metric, expected, label] of [
      ["main_receipt", report.income.mainReceipt, "主营回款"],
      ["general_interest", report.income.generalInterest, "一般账户利息"],
    ]) {
      if (
        report.analysisFutureSources?.includes(
          metric === "main_receipt" ? "contract_receipts" : metric,
        )
      )
        continue;
      const known = addFinancialAmounts(
        ...selectedLedger
          .filter((row) => row.month === month && row.metric === metric)
          .map((row) => row.amount),
      );
      if (metric === "main_receipt" && receiptIssuesByMonth.has(month))
        continue;
      if (amount(expected) === known) continue;
      inflow.warnings.push(
        `${month}${label}汇总与可追溯明细存在差额，请核对月报；按甲方或区域筛选时不将缺失明细视为零。`,
      );
      if (!hasContractFilter)
        inflow.details.push({
          id: `${month}:${metric}:difference`,
          month,
          date: `${month}-01`,
          name: `${label}快照汇总与明细差额（待核对）`,
          amount: subtract(expected, known),
          person: null,
          partyA: null,
          region: null,
          sourceId: `月报:${month}:${metric}`,
          sourceState: "原月报汇总差额，不代表新增业务记录",
        });
    }
  }
  if (hasContractFilter)
    inflow.warnings.push(
      "甲方／区域筛选仅适用于可靠关联的主营回款；银行利息无此归属，显示为不适用。历史回款缺少可核对维度时，筛选合计保留未知。",
    );

  const outflow = module(
    "outflow",
    "一般账户出账统计",
    reimbursementOccurrenceEnabled
      ? "行政支出按系统确认报销月份统计基础及大额报销；银行实际支出仍按交易日期单独核对，税费预留不作为实际支付。"
      : "每笔一般账户支出只进入一个分类；税费预留不作为实际支付。",
    reimbursementOccurrenceEnabled
      ? "行政与人力成本共用已确认报销月份、原报销总金额和来源编号；一般账户总支出保留月报及银行实际收付款口径"
      : "月报一般账户结算支出及对应来源；报销类别按同编号同金额当前台账补充",
  );
  const expenseLabels: Record<string, string> = {
    administration: "行政支出",
    salary: "薪资支出（含公司社保公积金）",
    other: "一般账户跨行手续费",
    tax: "实际税费支出",
    asset: "资产类合同支出",
  };
  outflow.chartMetricKeys = ["categoryTotal", ...Object.keys(expenseLabels)];
  outflow.outflowReimbursementBasis = reimbursementOccurrenceEnabled
    ? "reimbursement-month"
    : "payment-month";
  const administrationOccurrenceRows = reimbursementOccurrences.filter(
    (row) =>
      ["basic", "large"].includes(row.type) &&
      validReimbursementMonth(row.month) &&
      row.month <= asOfMonth,
  );
  const administrationPartial = reimbursementOccurrenceEnabled
    ? reimbursementOccurrences.some(
        (row) =>
          ["basic", "large"].includes(row.type) &&
          !validReimbursementMonth(row.month),
      )
    : months.some((month) => reportMap.get(month)?.status !== "closed") &&
      (input.reimbursementDatesComplete?.basic === false ||
        input.reimbursementDatesComplete?.large === false);
  if (administrationPartial) {
    expenseLabels.administration = "行政支出（已归期部分）";
    outflow.warnings.push(
      reimbursementOccurrenceEnabled
        ? "基础或大额报销存在报销月份缺失或无效的记录；行政支出只显示已归期部分，不把未归期费用当零，也不使用付款或上传月份猜测。"
        : "基础或大额报销存在已付款但付款日期缺失的记录；行政支出只显示已归期部分，不把未归期费用当零，也不擅自改用报销月份或上传月份。",
    );
  }
  const generalRows = selectedLedger.filter(
    (row) => row.account === "general" && row.direction === "expense",
  );
  const expenseCategory = (row: LedgerRow) =>
    row.metric === "human_cost"
      ? "salary"
      : row.metric === "general_tax_payment"
        ? "tax"
        : row.metric === "asset_administration"
          ? "asset"
          : ["basic_reimbursement", "large_reimbursement"].includes(row.metric)
            ? "administration"
            : row.metric === "general_bank_fee"
              ? "other"
              : "unselected";
  const sourceKeys: Record<string, string[]> = {
    administration: [
      "reimbursements",
      "basic_reimbursement",
      "large_reimbursement",
    ],
    salary: ["payroll", "human_cost"],
    other: ["monthly_bank_receipts", "general_bank_fee"],
    asset: ["asset_payments", "asset_administration"],
    tax: ["general_tax_payment"],
  };
  const categoryMonthAmount = (key: string, month: string): string | null => {
    if (month > asOfMonth) return null;
    if (key === "administration" && reimbursementOccurrenceEnabled)
      return addFinancialAmounts(
        ...administrationOccurrenceRows
          .filter((row) => row.month === month)
          .map((row) => row.amount),
      );
    if (!reportMap.has(month)) {
      if (key === "salary")
        return input.payroll?.some((row) => row.month === month)
          ? addFinancialAmounts(
              ...generalRows
                .filter(
                  (row) => row.month === month && row.metric === "human_cost",
                )
                .map((row) => row.amount),
            )
          : null;
      if (key === "asset")
        return input.generalPayments !== undefined &&
          !input.generalPayments.some(
            (row) =>
              !isValidFinancialDate(row.date) ||
              (monthOf(row.date) === month &&
                !!row.currency &&
                row.currency.trim().toUpperCase() !== "CNY"),
          )
          ? addFinancialAmounts(
              ...generalRows
                .filter(
                  (row) =>
                    row.month === month &&
                    row.metric === "asset_administration",
                )
                .map((row) => row.amount),
            )
          : null;
      if (
        key === "administration" &&
        input.reimbursementDatesComplete?.basic === true &&
        input.reimbursementDatesComplete?.large === true
      )
        return addFinancialAmounts(
          ...generalRows
            .filter(
              (row) => row.month === month && expenseCategory(row) === key,
            )
            .map((row) => row.amount),
        );
      return null;
    }
    if (sourceMissing(reportMap.get(month), sourceKeys[key])) return null;
    const rows = generalRows.filter(
      (row) => row.month === month && expenseCategory(row) === key,
    );
    // 税费没有手工凭证时保持未知，不能将旧月报缺分类解释为实际零缴税。
    if (
      key === "tax" &&
      (!rows.length || rows.some((row) => row.taxEvidenceComplete !== true))
    )
      return null;
    return addFinancialAmounts(...rows.map((row) => row.amount));
  };
  const knownCategoryTotals = periods.map(() => [] as string[]);
  const partialCategoryTotals = periods.map(() => administrationPartial);
  for (const [key, label] of Object.entries(expenseLabels)) {
    const knownValues: Array<string | null> = [];
    const partial: boolean[] = [];
    const values = periods.map((period, index) => {
      const monthly = listMonthlyFinancialTrendMonths(
        period.from,
        period.to,
      ).map((month) => categoryMonthAmount(key, month));
      const known = monthly.filter((value): value is string => value !== null);
      const knownValue = known.length ? addFinancialAmounts(...known) : null;
      knownValues[index] = knownValue;
      if (knownValue !== null) knownCategoryTotals[index].push(knownValue);
      partial[index] =
        monthly.some((value) => value === null) ||
        (key === "administration" && administrationPartial);
      if (partial[index]) partialCategoryTotals[index] = true;
      return sum(monthly);
    });
    outflow.series.push({ key, label, values, knownValues, partial });
    const knownBreakdown = knownValues.filter(
      (value): value is string => value !== null,
    );
    outflow.breakdown.push(
      value(
        key,
        label,
        knownBreakdown.length ? addFinancialAmounts(...knownBreakdown) : null,
        partial.some(Boolean)
          ? "仅为已知月份或已归期来源小计，不代表该分类完整金额"
          : undefined,
      ),
    );
  }
  const generalTotal = reportAggregate(
    { key: "all", label: "本期", from: query.from, to: query.to },
    "outflow",
    "general",
  );
  outflow.summaries = [value("total", "一般账户总支出", generalTotal)];
  outflow.columns = [...LEDGER_COLUMNS, column("category", "支出分类")];
  const outflowLedgerRows = reimbursementOccurrenceEnabled
    ? generalRows.filter((row) => expenseCategory(row) !== "administration")
    : generalRows;
  outflow.details = [
    ...ledgerDetails(outflowLedgerRows).map((row, index) => ({
      ...row,
      category:
        expenseLabels[expenseCategory(outflowLedgerRows[index])] ||
        "未纳入指标的其他一般账户支出",
    })),
    ...(reimbursementOccurrenceEnabled
      ? administrationOccurrenceRows.map((row) => ({
          id: `reimbursement-month:${row.id}`,
          month: row.month,
          date: null,
          name:
            row.title ||
            `${row.personName || "人员未确认"}·${row.type === "basic" ? "基础报销" : "大额报销"}`,
          amount: row.amount,
          person: row.personName,
          partyA: null,
          region: null,
          sourceId: row.id,
          sourceState: `按系统确认报销月份${row.month}统计；银行实际付款日期及回单上传日期不改变报销归月`,
          category: expenseLabels.administration,
        }))
      : []),
  ];
  if (
    months.some((month) => {
      const taxRows = generalRows.filter(
        (row) => row.month === month && expenseCategory(row) === "tax",
      );
      return (
        !taxRows.length ||
        taxRows.some((row) => row.taxEvidenceComplete !== true)
      );
    })
  )
    outflow.warnings.push(
      "部分月份没有填写说明及凭证号的实际税费支出记录，税费分类保持未知；不以主营回款税费预留替代，也不回填历史。",
    );
  if (generalRows.some((row) => expenseCategory(row) === "unselected"))
    outflow.warnings.push(
      "其他一般账户支出保留在账户总额和来源明细中，不混入跨行手续费；行政支出仅为基础报销与大额报销。",
    );
  for (const month of months) {
    const expected = reportMap
      .get(month)
      ?.accounts.find((row) => row.code === "general")?.outflow;
    const detailed = addFinancialAmounts(
      ...generalRows
        .filter((row) => row.month === month)
        .map((row) => row.amount),
    );
    if (expected !== undefined && amount(expected) !== detailed) {
      outflow.warnings.push(
        `${month}来源明细与一般账户总支出不一致，分类合计不能代替账户权威合计，请核对原月报。`,
      );
      // 账户合计差额保持提示，不清空已核验的独立分类，也不把差额塞进手续费。
    }
  }
  outflow.series.push({
    key: "categoryTotal",
    label: "总金额",
    values: knownCategoryTotals.map((known) =>
      known.length ? addFinancialAmounts(...known) : null,
    ),
    partial: partialCategoryTotals,
  });
  outflow.warnings.push(
    "总金额为同期间五类指标的已知金额精确合计；任一分类未知时仅代表已知分类总金额，饼图明确保留未知项，不以该值替代银行实际支出。",
  );
  // 总支出单独读取月报权威金额；分类不完整不能抹去总额，也不能把总额再加入结构图。
  outflow.series.push({
    key: "total",
    label: "一般账户总支出",
    values: periods.map((period) =>
      reportAggregate(period, "outflow", "general"),
    ),
  });
  const knownOutflow = (from: string, to: string) => {
    if (to > asOfMonth) return null;
    const rows = generalRows.filter((row) => inPeriod(row.month, from, to));
    return rows.length
      ? addFinancialAmounts(...rows.map((row) => row.amount))
      : null;
  };
  outflow.series.push({
    key: "knownTotal",
    label: "一般账户支出（已录入部分）",
    values: periods.map((period) => knownOutflow(period.from, period.to)),
  });
  outflow.summaries.push(
    value(
      "knownTotal",
      "已录入支出合计",
      knownOutflow(query.from, query.to),
      "工资、已付款报销、已确认资产付款等已取得来源；缺失月份及银行费用不估算",
    ),
  );
  outflow.warnings.push(
    "结构图仅展示已核验的一般账户支出分类；实际税费仅采用一般账户手工税费付款凭证，未知值不按零绘制。",
  );
  if (reimbursementOccurrenceEnabled)
    outflow.warnings.push(
      "行政支出按基础、大额报销的系统报销月份统计；一般账户总支出仍按银行实际收付款口径核对，两者月份可能不同，不以分类合计反推银行余额。",
    );

  const settlement = module(
    "settlement",
    "收支结余汇总",
    "收入、支出均采用四账户结算范围；结余不是利润，也不是期末账户余额。",
    "四账户已核算结算流入、流出；不重复加总人员和商务分析模块",
  );
  settlement.series = [
    {
      key: "income",
      label: "四账户结算收入",
      values: periods.map((period) => reportAggregate(period, "inflow")),
    },
    {
      key: "expense",
      label: "四账户结算支出",
      values: periods.map((period) => reportAggregate(period, "outflow")),
    },
  ];
  settlement.series.push({
    key: "surplus",
    label: "当期结余",
    values: periods.map((_period, index) => {
      const incoming = settlement.series[0].values[index];
      const outgoing = settlement.series[1].values[index];
      return incoming === null || outgoing === null
        ? null
        : subtract(incoming, outgoing);
    }),
  });
  settlement.summaries = settlement.series.map((row) =>
    value(row.key, row.label, sum(row.values)),
  );
  settlement.columns = [
    column("month", "月份"),
    column("account", "账户"),
    column("income", "结算收入", "amount"),
    column("expense", "结算支出", "amount"),
    column("surplus", "当期结余", "amount"),
    column("sourceId", "来源编号"),
    column("sourceState", "核算状态"),
  ];
  settlement.details = balances.details.map((row) => ({
    id: row.id,
    month: row.month,
    account: row.account,
    income: row.inflow,
    expense: row.outflow,
    surplus:
      row.inflow === null || row.outflow === null
        ? null
        : subtract(row.inflow, row.outflow),
    sourceId: `月报:${row.month}:${row.account}`,
    sourceState: row.sourceState,
  }));
  if (hasContractFilter)
    settlement.warnings.push(
      "四账户结算包含不可归属甲方的工资、行政及银行费用，本模块不套用甲方／合同区域筛选。主营项目筛选结果见回款模块。",
    );

  const projects = buildProjects(input, periods, roots, matchesContract);
  const business = module(
    "business",
    "商务统计",
    reimbursementOccurrenceEnabled
      ? "按系统确认报销月份统计商务报销；按照报销范围的完整级联路径分类，公司内部单列。"
      : "按实际付款月统计商务报销；按照报销范围的完整级联路径分类，公司内部单列。",
    reimbursementOccurrenceEnabled
      ? "与人力成本共用已确认报销月份、原报销总金额和来源编号；银行付款及回单上传日期不改变报销归月"
      : "优先月报商务报销快照；行政区与完整路径优先冻结维度，旧月结缺字段归未知；开放月份使用唯一完整范围层级，缺月使用已付款业务事实",
  );
  business.businessReimbursementBasis = reimbursementOccurrenceEnabled
    ? "reimbursement-month"
    : "payment-month";
  const legacyBusinessRows = selectedLedger
    .filter((row) => row.metric === "business_reimbursement")
    .map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
      month: row.month as string | null,
      amount: row.amount,
      title: row.name,
      personName: row.personName,
      scope: row.reimbursement?.scope || null,
      scopePath: row.reimbursement?.scopePath || null,
      region: row.reimbursement?.region || null,
      regionSource:
        row.reimbursement?.regionSource ||
        "没有冻结或可唯一核对的范围行政区，归属未知",
      serviceTarget: row.reimbursement?.serviceTarget || null,
      sourceState: row.sourceState,
    }));
  const occurrenceBusinessRows = reimbursementOccurrences
    .filter((row) => row.type === "business")
    .map((row) => ({
      id: `reimbursement-month:${row.id}`,
      sourceId: row.id,
      month: row.month,
      amount: row.amount,
      title: row.title || `${row.personName || "人员未确认"}·商务报销`,
      personName: row.personName,
      scope: row.scope || null,
      scopePath: row.scopePath || null,
      region: row.region || null,
      regionSource:
        row.regionSource || "当前报销范围无法唯一核对行政区，归属未知",
      serviceTarget: row.serviceTarget || null,
      sourceState: validReimbursementMonth(row.month)
        ? `按系统确认报销月份${row.month}统计；银行实际付款及回单上传日期不改变报销归月`
        : "报销月份缺失或无效，未归入任何月份",
    }));
  const allBusinessRows = reimbursementOccurrenceEnabled
    ? occurrenceBusinessRows
    : legacyBusinessRows;
  const businessRows = allBusinessRows.filter(
    (row) =>
      validReimbursementMonth(row.month) &&
      row.month <= asOfMonth &&
      (!query.reimbursementScope ||
        row.scope === query.reimbursementScope ||
        row.scopePath === query.reimbursementScope ||
        row.scopePath?.startsWith(query.reimbursementScope + " / ")),
  );
  const invalidBusinessDate = (input.reimbursements || []).some(
    (row) => row.type === "business" && !isValidFinancialDate(row.date),
  );
  // 只有全历史付款日期校验成功，才能把无月报、无付款的月份确认为零。
  const businessDatesComplete =
    input.reimbursementDatesComplete?.business === true &&
    input.reimbursements !== undefined &&
    !invalidBusinessDate;
  const businessHasUndatedSources =
    input.reimbursementDatesComplete?.business === false || invalidBusinessDate;
  const businessNeedsLiveSources = listMonthlyFinancialTrendMonths(
    query.from,
    query.to,
  ).some((month) => reportMap.get(month)?.status !== "closed");
  const businessIsPartial = reimbursementOccurrenceEnabled
    ? occurrenceBusinessRows.some((row) => !validReimbursementMonth(row.month))
    : businessHasUndatedSources && businessNeedsLiveSources;
  if (query.reimbursementScope) business.appliedFilters.push("报销范围");
  const businessAmount = (from: string, to: string) => {
    const range = listMonthlyFinancialTrendMonths(from, to);
    if (range.some((month) => month > asOfMonth)) return null;
    if (reimbursementOccurrenceEnabled) {
      if (
        query.reimbursementScope &&
        allBusinessRows.some(
          (row) =>
            validReimbursementMonth(row.month) &&
            inPeriod(row.month, from, to) &&
            !row.scopePath &&
            row.scope !== query.reimbursementScope,
        )
      )
        return null;
      return addFinancialAmounts(
        ...businessRows
          .filter((row) => inPeriod(row.month!, from, to))
          .map((row) => row.amount),
      );
    }
    if (
      range.some((month) =>
        sourceMissing(reportMap.get(month), [
          "reimbursements",
          "business_reimbursement",
        ]),
      )
    )
      return null;
    if (
      range.some(
        (month) =>
          !reportMap.has(month) &&
          !allBusinessRows.some((row) => row.month === month) &&
          !businessDatesComplete,
      )
    )
      return null;
    if (
      query.reimbursementScope &&
      allBusinessRows.some(
        (row) =>
          validReimbursementMonth(row.month) &&
          inPeriod(row.month, from, to) &&
          !row.scopePath &&
          row.scope !== query.reimbursementScope,
      )
    )
      return null;
    return addFinancialAmounts(
      ...businessRows
        .filter(
          (row) =>
            validReimbursementMonth(row.month) && inPeriod(row.month, from, to),
        )
        .map((row) => row.amount),
    );
  };
  business.series = [
    {
      key: "business",
      label: businessIsPartial ? "商务报销（已归期部分）" : "商务报销",
      values: periods.map((period) => businessAmount(period.from, period.to)),
    },
  ];
  business.summaries = [
    value(
      "total",
      "期间商务报销",
      businessIsPartial ? null : businessAmount(query.from, query.to),
      businessIsPartial
        ? reimbursementOccurrenceEnabled
          ? "存在报销月份缺失或无效的记录，完整期间金额待核对"
          : "存在未归期付款，完整期间金额待核对"
        : undefined,
    ),
  ];
  if (businessIsPartial) {
    business.summaries.push(
      value(
        "knownTotal",
        "期间已归期部分合计",
        addFinancialAmounts(...businessRows.map((row) => row.amount)),
        reimbursementOccurrenceEnabled
          ? "仅含已确定报销月份且符合当前筛选的记录，不代替完整总额"
          : "仅含已确定付款月份且符合当前筛选的记录，不代替完整总额",
      ),
    );
    business.warnings.push(
      reimbursementOccurrenceEnabled
        ? "存在商务报销缺少有效报销月份，折线仅显示已归期部分；缺口不按零处理，完整期间总额与行政区占比待核对。"
        : "存在已付款商务报销缺少有效实际付款日期，折线仅显示已归期部分；缺口不按零处理，完整期间总额与行政区占比待核对。已月结快照仍按原冻结值展示。",
    );
  }
  const businessScope = (row: (typeof businessRows)[number]) =>
    row.scopePath || row.region || "行政区未知";
  const regions = unique(businessRows.map(businessScope));
  business.breakdown = regions.map((region) =>
    value(
      region,
      region,
      businessIsPartial || businessAmount(query.from, query.to) === null
        ? null
        : addFinancialAmounts(
            ...businessRows
              .filter((row) => businessScope(row) === region)
              .map((row) => row.amount),
          ),
    ),
  );
  business.comparison = business.breakdown;
  business.columns = [
    ...LEDGER_COLUMNS,
    column("scope", "报销范围（完整路径）"),
    column("region", "行政区／公司内部"),
    column("regionSource", "区域归属来源说明"),
    column("serviceTarget", "服务对象（台账文本）"),
  ];
  business.details = businessRows.map((row) => ({
    id: row.id,
    month: row.month,
    date: null,
    name: row.title,
    amount: row.amount,
    person: row.personName,
    partyA: null,
    sourceId: row.sourceId,
    sourceState: row.sourceState,
    scope: row.scopePath || row.scope,
    scopePath: row.scopePath,
    region: row.region,
    regionSource: row.regionSource,
    serviceTarget: row.serviceTarget,
  }));
  if (businessRows.some((row) => !row.region))
    business.warnings.push(
      "部分商务报销缺少冻结行政区或范围层级无法唯一核对，金额以行政区未知单列；不从合同区域、服务对象或项目名称猜测归属。",
    );
  if (
    query.reimbursementScope &&
    allBusinessRows.some(
      (row) => !row.scopePath && row.scope !== query.reimbursementScope,
    )
  )
    business.warnings.push(
      "部分历史商务报销没有完整范围路径，不能判断是否属于当前路径筛选；筛选合计保持未知，不把无法归属的历史金额解释为零。",
    );
  if (hasContractFilter)
    business.warnings.push(
      "商务报销没有可靠的合同甲方关联，本模块不使用甲方／合同区域筛选；服务对象文本不视为合同甲方。",
    );
  if (reimbursementOccurrenceEnabled)
    business.warnings.push(
      "商务统计与人力成本中的商务报销共用系统报销月份、原报销总金额及确认状态；账户资金收支仍单独按银行交易日期核对。",
    );

  const personnel = buildPersonnel(input, periods, ledger, reportMap, people);
  const modules = [
    balances,
    inflow,
    outflow,
    projects,
    settlement,
    business,
    personnel,
  ];
  for (const item of modules) item.warnings = unique(item.warnings);
  return {
    query,
    generatedAt: input.generatedAt,
    filterOptions: {
      parties: unique(
        [...roots.values()]
          .map((row) => row.partyA)
          .concat(ledger.map((row) => row.contract?.partyA || null)),
      ),
      contractRegions: unique(
        [...roots.values()]
          .map((row) => row.region)
          .concat(ledger.map((row) => row.contract?.region || null)),
      ),
      reimbursementScopes: unique(
        reimbursements
          .map(
            (row) =>
              row.scopePath || input.scopeNames?.[row.scope || ""] || row.scope,
          )
          .concat(
            reimbursementOccurrences.map(
              (row) => row.scopePath || row.scope || null,
            ),
          )
          .concat(ledger.map((row) => row.reimbursement?.scope || null)),
      ),
      people: [...people]
        .map(([id, name]) => ({ id, name }))
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id),
        ),
    },
    modules,
    warnings: unique(warnings),
  };
}

function buildProjects(
  input: MonthlyFinancialAnalysisInput,
  periods: FinancialAnalysisPeriod[],
  roots: Map<string, AnalysisContract>,
  matches: (contract?: AnalysisContract) => boolean,
): FinancialAnalysisModule {
  const warnings: string[] = [];
  const contracts = input.contracts || [];
  const contractSourceAvailable = input.contracts !== undefined;
  const receipts = input.receipts || [];
  const rootRows = [...roots.values()].filter(
    (root) =>
      matches(root) &&
      !["draft", "rejected"].includes(root.status) &&
      (Boolean(root.effectiveAt) ||
        ["effective", "executing", "completed", "terminated"].includes(
          root.status,
        )),
  );
  const currentBusinessDate = financialAnalysisBusinessDate(input.generatedAt);
  if (!currentBusinessDate) throw new Error("分析生成时间无效");
  const currentMonth = monthOf(currentBusinessDate);
  const receiptSourceAvailable = input.receipts !== undefined;
  // 期间流量只用当前仍确认的回款；不能套用累计存量的历史冲正截止算法，否则月季年不可加。
  const currentReceipts = receipts.filter((row) => row.status === "confirmed");
  const currentDuplicateIds = duplicateReceiptIds(currentReceipts);
  const inReceiptPeriod = (
    row: AnalysisReceipt,
    period: FinancialAnalysisPeriod,
  ) =>
    !isValidFinancialDate(row.date) ||
    inPeriod(monthOf(row.date), period.from, period.to);
  const periodReceipt = (
    root: AnalysisContract,
    period: FinancialAnalysisPeriod,
  ) => {
    const rows = currentReceipts.filter(
      (row) => row.rootId === root.id && inReceiptPeriod(row, period),
    );
    const issues = receiptIntegrityIssues(rows, currentDuplicateIds);
    if (!receiptSourceAvailable)
      issues.push("未提供完整回款来源，不能将缺失来源视为零");
    if (period.to > currentMonth)
      issues.push("包含未来月份，期间实际回款未知，不预测未来金额");
    if (issues.length)
      warnings.push(`${period.label} ${root.title}：${issues.join("；")}`);
    return {
      amount: issues.length
        ? null
        : addFinancialAmounts(...rows.map((row) => row.amount)),
      sourceState: issues.length
        ? issues.join("；")
        : `当前已确认未冲正人民币主营回款，按业务日期直接归期${period.to === currentMonth ? `，截至${currentBusinessDate}` : ""}；不以累计差分或旧月结冻结金额替代`,
      sourceIds: unique(rows.map((row) => row.id)).join("、"),
    };
  };
  const contractBusinessDate = (row: AnalysisContract) =>
    ["ocr", "manual"].includes(row.contractDateSource || "")
      ? financialAnalysisBusinessDate(row.contractDate)
      : null;
  const canonicalRootRows = rootRows.filter((root) => root.rootId === root.id);
  if (canonicalRootRows.length !== rootRows.length)
    warnings.push(
      "部分主营合同的主合同链根关系异常，未计入签订合同数量；补充或解除子记录不会重复计数。",
    );
  const signingDimension = (root: AnalysisContract) => {
    const normalize = (text: string | null, fallback: string) =>
      String(text || "")
        .normalize("NFKC")
        .trim() || fallback;
    const region = normalize(root.region, "行政区未知");
    const serviceUnit = normalize(root.partyA, "服务单位未标注");
    return {
      region,
      serviceUnit,
      key: `${encodeURIComponent(region)}::${encodeURIComponent(serviceUnit)}`,
      label: `${region} · ${serviceUnit}`,
    };
  };
  const signingGroups = new Map<
    string,
    {
      key: string;
      label: string;
      region: string;
      serviceUnit: string;
      rows: AnalysisContract[];
    }
  >();
  for (const root of canonicalRootRows) {
    const dimension = signingDimension(root);
    const group = signingGroups.get(dimension.key) || {
      ...dimension,
      rows: [],
    };
    group.rows.push(root);
    signingGroups.set(dimension.key, group);
  }
  const signedRowsForPeriod = (
    rows: AnalysisContract[],
    period: FinancialAnalysisPeriod,
  ): AnalysisContract[] | null => {
    if (!contractSourceAvailable || period.to > currentMonth) return null;
    // 无法确定签订业务日的主合同可能属于任意期间，不能把已知片段冒充完整数量。
    if (rows.some((root) => !contractBusinessDate(root))) return null;
    return rows
      .filter((root) => {
        const date = contractBusinessDate(root)!;
        return (
          date <= currentBusinessDate &&
          inPeriod(monthOf(date), period.from, period.to)
        );
      })
      .sort(
        (left, right) =>
          contractBusinessDate(left)!.localeCompare(
            contractBusinessDate(right)!,
          ) || left.id.localeCompare(right.id),
      );
  };
  const signedCountForPeriod = (
    rows: AnalysisContract[],
    period: FinancialAnalysisPeriod,
  ): string | null => {
    const signed = signedRowsForPeriod(rows, period);
    return signed === null ? null : String(signed.length);
  };
  const signedContractSegments: FinancialAnalysisSeriesSegment[] = [
    ...signingGroups.values(),
  ]
    .sort(
      (left, right) =>
        left.region.localeCompare(right.region, "zh-CN") ||
        left.serviceUnit.localeCompare(right.serviceUnit, "zh-CN"),
    )
    .map(({ rows, ...group }) => ({
      ...group,
      values: periods.map((period) => signedCountForPeriod(rows, period)),
      projectNames: periods.map((period) => {
        const signed = signedRowsForPeriod(rows, period);
        return signed === null
          ? null
          : signed.map((root) => root.title.trim() || "未记录项目名称");
      }),
    }));
  const signedContractCountSeries: FinancialAnalysisSeries = {
    key: "signedContractCount",
    label: "主营项目签订合同数量",
    unit: "个",
    values: periods.map((period, index) => {
      if (!contractSourceAvailable || period.to > currentMonth) return null;
      const values = signedContractSegments.map(
        (segment) => segment.values[index],
      );
      return values.some((count) => count === null)
        ? null
        : addFinancialAmounts(...(values as string[]));
    }),
    segments: signedContractSegments,
  };
  const signingDateIssues = canonicalRootRows.filter(
    (root) => !contractBusinessDate(root),
  );
  if (signingDateIssues.length)
    warnings.push(
      `有${signingDateIssues.length}组主营主合同缺少人工确认或文字识别确认的有效签订日期，签订合同数量保持未知；上传日期、创建日期和生效日期均不替代签订日期。`,
    );
  if (!contractSourceAvailable)
    warnings.push(
      "未提供完整主营合同来源，签订合同数量保持未知，不能把缺失来源解释为零。",
    );
  const cutoffEvidence = new Map<
    string,
    { rows: AnalysisReceipt[]; duplicates: Set<string> }
  >();
  const calculate = (root: AnalysisContract, month: string) => {
    if (month > currentMonth) {
      warnings.push(
        `${month}尚未发生，不能把当前合同和回款余额预测为未来期末值。`,
      );
      return {
        contract: null,
        received: null,
        outstanding: null,
        reason: "未来期间尚未发生，期末值未知",
      };
    }
    const cutoff =
      month === currentMonth ? currentBusinessDate : endDate(month);
    const rootEffectiveDate = contractBusinessDate(root);
    if (!rootEffectiveDate) {
      warnings.push(
        `${root.title}：主合同缺少已核实业务签订日期，历史截止金额未知；系统归档时间不替代业务日期。`,
      );
      return {
        contract: null,
        received: null,
        outstanding: null,
        reason: "主合同缺少已核实业务签订日期，历史截止金额未知",
      };
    }
    if (rootEffectiveDate > cutoff) return null;
    let contract: string | null = root.originalAmount ?? root.amountDelta;
    let reason = "已生效合同链按已核实业务签订日期及回款业务日重建";
    const changes = contracts.filter(
      (row) =>
        row.rootId === root.id &&
        row.id !== root.id &&
        (Boolean(row.effectiveAt) ||
          ["effective", "executing", "completed", "terminated"].includes(
            row.status,
          )),
    );
    if (changes.some((row) => !contractBusinessDate(row))) {
      contract = null;
      reason =
        "合同变更缺少已核实业务日期，不能用系统归档日期或当前合同额回填历史";
    }
    for (const change of changes
      .filter((row) => {
        const date = contractBusinessDate(row);
        return date && date <= cutoff;
      })
      .sort(
        (a, b) =>
          contractBusinessDate(a)!.localeCompare(contractBusinessDate(b)!) ||
          (a.supplementSequence || 0) - (b.supplementSequence || 0) ||
          a.id.localeCompare(b.id),
      )) {
      if (contract === null) break;
      if (
        change.changeType === "legacy_unresolved" ||
        change.amountDelta === null ||
        (change.relationType === "supplement" &&
          change.amountBefore !== null &&
          amount(change.amountBefore) !== amount(contract))
      ) {
        contract = null;
        reason = "合同变更金额链不完整，历史金额未知";
        break;
      }
      contract = addFinancialAmounts(contract, change.amountDelta);
      if (
        change.relationType === "supplement" &&
        change.amountAfter !== null &&
        amount(change.amountAfter) !== contract
      ) {
        contract = null;
        reason = "合同变更前后金额不闭合";
      }
    }
    // 坏发生日或缺冲正业务日均无法确定历史截止归属，保留为待核对证据，不能先过滤后少算。
    let evidence = cutoffEvidence.get(cutoff);
    if (!evidence) {
      const rows = receipts.filter(
        (row) =>
          (!isValidFinancialDate(row.date) || row.date <= cutoff) &&
          (row.status === "confirmed" ||
            (row.status === "reversed" &&
              (!financialAnalysisBusinessDate(row.reversedAt) ||
                financialAnalysisBusinessDate(row.reversedAt)! > cutoff))),
      );
      evidence = { rows, duplicates: duplicateReceiptIds(rows) };
      cutoffEvidence.set(cutoff, evidence);
    }
    const cutoffReceipts = evidence.rows;
    const activeReceipts = cutoffReceipts.filter(
      (row) => row.rootId === root.id,
    );
    const issues = receiptIntegrityIssues(activeReceipts, evidence.duplicates);
    if (!receiptSourceAvailable)
      issues.push("未提供完整回款来源，累计回款未知");
    if (
      activeReceipts.some(
        (row) =>
          row.status === "reversed" &&
          !financialAnalysisBusinessDate(row.reversedAt),
      )
    )
      issues.push("已冲正回款缺少可靠冲正业务日期，历史累计未知");
    const received = issues.length
      ? null
      : addFinancialAmounts(...activeReceipts.map((row) => row.amount));
    const outstanding =
      contract === null || received === null
        ? null
        : subtract(contract, received);
    if (outstanding?.startsWith("-"))
      reason += "；存在超额回款，负未回款额保留原值";
    if (received === null) reason += `；${issues.join("；")}，人民币汇总未知`;
    if (contract === null || received === null || outstanding?.startsWith("-"))
      warnings.push(`${root.title}：${reason}`);
    return { contract, received, outstanding, reason };
  };
  const byPeriod = periods.map((period) =>
    rootRows.flatMap((root) => {
      const calculated = calculate(root, period.to);
      const received = periodReceipt(root, period);
      if (!calculated && received.amount === "0") return [];
      return [
        {
          root,
          ...(calculated || {
            contract: null,
            received: null,
            outstanding: null,
            reason:
              "该期尚未达到已核实合同签订日，原期末指标不适用；仅保留真实期间回款",
          }),
          detailKind: calculated ? "project_period" : "period_receipt_only",
          periodReceived: received.amount,
          periodReceivedSourceState: received.sourceState,
          periodReceivedSourceIds: received.sourceIds,
        },
      ];
    }),
  );
  const positionSeries = [
    ["contract", "合同金额"],
    ["received", "已回款"],
    ["outstanding", "未回款"],
  ].map(([key, label]) => ({
    key,
    label,
    values: byPeriod.map((rows, index) =>
      periods[index].to > currentMonth ||
      (!receiptSourceAvailable && key !== "contract")
        ? null
        : sum(
            rows
              .filter((row) => row.detailKind !== "period_receipt_only")
              .map(
                (row) => row[key as "contract" | "received" | "outstanding"],
              ),
          ),
    ),
  }));
  const periodReceivedLabel = {
    month: "本月回款",
    quarter: "本季回款",
    year: "本年回款",
  }[input.query.granularity];
  const periodReceivedSeries = {
    key: "periodReceived",
    label: periodReceivedLabel,
    values: byPeriod.map((rows, index) => {
      const orphaned = currentReceipts.filter(
        (row) => !roots.has(row.rootId) && inReceiptPeriod(row, periods[index]),
      );
      if (orphaned.length)
        warnings.push(
          `${periods[index].label}存在无法对应可读取主营合同根的当前回款，期间实际回款未知：${unique(orphaned.map((row) => row.id)).join("、")}`,
        );
      return periods[index].to > currentMonth ||
        orphaned.length ||
        !receiptSourceAvailable
        ? null
        : sum(rows.map((row) => row.periodReceived));
    }),
  };
  const series = [
    ...positionSeries,
    periodReceivedSeries,
    signedContractCountSeries,
  ];
  const projectReceipts: FinancialAnalysisProjectReceipt[] = byPeriod.flatMap(
    (rows, index) =>
      rows.flatMap((row) =>
        row.periodReceived === null
          ? []
          : currentReceipts
              .filter(
                (receipt) =>
                  receipt.rootId === row.root.id &&
                  isValidFinancialDate(receipt.date) &&
                  inPeriod(
                    monthOf(receipt.date),
                    periods[index].from,
                    periods[index].to,
                  ) &&
                  receiptIntegrityIssues([receipt], currentDuplicateIds)
                    .length === 0,
              )
              .map((receipt) => ({
                rootContractId: row.root.id,
                receiptId: receipt.id,
                periodKey: periods[index].key,
                from: periods[index].from,
                to: periods[index].to,
                projectNumber: originalProjectNumber(
                  row.root.businessContractNo,
                ),
                projectNumberSource:
                  "主营合同原件业务编号；未提供时不使用内部编号替代",
                receiptDate: receipt.date,
                amount: amount(receipt.amount),
                ...realReceiptNumber(receipt),
                bankName: receipt.bankName || null,
                fileName: receipt.fileMetadata?.fileName || null,
                mimeType: receipt.fileMetadata?.mimeType || null,
                previewUrl: projectReceiptPreviewUrl(
                  row.root.id,
                  receipt.id,
                  periods[index].from,
                  periods[index].to,
                  receipt.fileMetadata,
                ),
                previewUnavailableReason:
                  projectReceiptPreviewUnavailableReason(receipt),
              })),
      ),
  );
  return {
    key: "projects",
    title: "项目分析",
    description:
      "合同金额、累计已回款、未回款沿用期间末时点；期间实际回款独立按当前已确认未冲正凭证归期；主营项目签订合同数量按当期新签主合同链统计。",
    sourceLabel:
      "原期末指标按已核实业务签订日期重建；期间实际回款使用当前已确认未冲正人民币事实和业务日期；签订数量仅按人工确认或文字识别确认的主合同签订日期归期，并按行政区和合同甲方分段，补充及解除协议不重复计数。与原历史累计、已月结入账快照可能不同，不回写旧快照",
    updatedAt: maxDate([
      ...contracts.map((row) => row.updatedAt),
      ...receipts
        .filter((row) => rootRows.some((root) => root.id === row.rootId))
        .map((row) => row.updatedAt),
    ]),
    periods,
    series,
    projectReceipts,
    summaries: [
      ...positionSeries.map((row) =>
        value(
          row.key,
          row.label,
          row.values.at(-1) ?? null,
          input.query.to === currentMonth
            ? `截至${currentBusinessDate}的当前工作值`
            : `${input.query.to}期末值`,
        ),
      ),
      value(
        "periodReceived",
        "所选期间实际回款",
        sum(periodReceivedSeries.values),
        `${input.query.from}至${input.query.to}内当前已确认未冲正回款${input.query.from <= currentMonth && input.query.to >= currentMonth ? `；当前月份截至${currentBusinessDate}` : ""}；不取最后一期值，不改写历史累计或月结快照`,
      ),
      {
        key: "signedContractCount",
        label: "所选期间新签主营项目合同数量",
        amount: sum(signedContractCountSeries.values),
        unit: "个",
        note: `${input.query.from}至${input.query.to}按主合同签订日期归期；同一主合同链只计一组，按行政区和合同甲方分段`,
      },
    ],
    breakdown: [],
    comparison: [],
    columns: [
      column("period", "截止期间"),
      column("periodKey", "期间编号"),
      column("from", "期间开始月份"),
      column("to", "期间结束月份"),
      column("project", "主营项目"),
      column("projectNumber", "项目编号（主营合同业务编号）"),
      column("projectNumberSource", "项目编号来源"),
      column("partyA", "甲方"),
      column("region", "合同区域"),
      column("contract", "合同金额", "amount"),
      column("received", "已回款", "amount"),
      column("outstanding", "未回款", "amount"),
      column("periodReceived", periodReceivedLabel, "amount"),
      column("periodReceiptNumbers", "银行回单号"),
      column("periodReceivedSourceIds", "回款内部追溯编号"),
      column("periodReceivedSourceState", "期间回款口径说明"),
      column("sourceId", "合同内部追溯编号"),
      column("sourceState", "口径说明"),
    ],
    details: byPeriod.flatMap((rows, index) =>
      rows.map((row) => ({
        id: `${periods[index].key}:${row.root.id}`,
        period: periods[index].label,
        periodKey: periods[index].key,
        from: periods[index].from,
        to: periods[index].to,
        detailKind: row.detailKind,
        project: row.root.title,
        projectNumber: originalProjectNumber(row.root.businessContractNo),
        projectNumberSource: "主营合同原件业务编号；未提供时不使用内部编号替代",
        periodReceiptNumbers:
          unique(
            projectReceipts
              .filter(
                (receipt) =>
                  receipt.rootContractId === row.root.id &&
                  receipt.periodKey === periods[index].key,
              )
              .map((receipt) => receipt.receiptNumber),
          ).join("、") || null,
        partyA: row.root.partyA,
        region: row.root.region,
        contract: row.contract,
        received: row.received,
        outstanding: row.outstanding,
        periodReceived: row.periodReceived,
        periodReceivedSourceState: row.periodReceivedSourceState,
        periodReceivedSourceIds: row.periodReceivedSourceIds,
        sourceId: row.root.id,
        sourceState: row.reason,
      })),
    ),
    warnings: unique(warnings),
    appliedFilters: [
      "时间",
      ...[
        input.query.partyA ? "甲方" : "",
        input.query.contractRegion ? "合同区域" : "",
      ].filter(Boolean),
    ],
  };
}

type HousingComponent = FinancialAnalysisHousingCostValue["key"];
const HOUSING_COST_LABELS: Record<HousingComponent, string> = {
  rent: "租金",
  property_management: "物业管理费",
  electricity: "电费",
  system_maintenance: "系统维护费",
  other_cost: "其他房屋成本",
};
interface HousingCostRow {
  month: string;
  id: string;
  amount: string;
  label: string;
  component?: HousingComponent;
}

/** 变量住房费用只认完整发票与原收费月份证据；固定两项和可退押金不再计一次。 */
function buildHousingInvoiceCosts(
  input: MonthlyFinancialAnalysisInput,
  from: string,
  to: string,
  asOfDate: string,
) {
  const rows: HousingCostRow[] = [];
  const warnings: string[] = [];
  const unknown = new Map<HousingComponent, Set<string>>();
  const variableKeys: HousingComponent[] = [
    "electricity",
    "system_maintenance",
    "other_cost",
  ];
  const fixedOrExcluded = new Set([
    "rent",
    "property_management",
    "lease_deposit",
    "deposit",
    "refundable_deposit",
  ]);
  const months = listMonthlyFinancialTrendMonths(from, to).filter(
    (month) => month <= asOfDate.slice(0, 7),
  );
  const monthValid = (month: string | null): month is string =>
    typeof month === "string" &&
    /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month) &&
    month >= "1900-01" &&
    month <= "2099-12";
  const nonnegative = (value: string): string | null =>
    typeof value === "string" && /^\d+(?:\.\d{1,12})?$/u.test(value)
      ? amount(value)
      : null;
  const markUnknown = (
    keys: readonly HousingComponent[],
    periods: readonly string[],
  ) => {
    for (const key of keys) {
      const marked = unknown.get(key) || new Set<string>();
      for (const month of periods) marked.add(month);
      unknown.set(key, marked);
    }
  };
  if (input.housingCostInvoices === undefined) {
    markUnknown(variableKeys, months);
    warnings.push(
      "房屋租赁的变量费用发票来源尚未加载，电费、系统维护及其他已确认房屋费用不能按零处理。",
    );
    return { rows, warnings, unknown };
  }
  const housingContracts = new Map(
    (input.rentAccrualContracts || [])
      .filter(
        (contract) =>
          ["effective", "executing", "completed", "terminated"].includes(
            contract.status,
          ) &&
          (!contract.effectiveAt ||
            !isValidFinancialDate(contract.effectiveAt.slice(0, 10)) ||
            contract.effectiveAt.slice(0, 10) <= asOfDate),
      )
      .map((contract) => [contract.id, contract] as const),
  );
  const pending = input.housingCostInvoices
    .filter(
      (invoice) =>
        housingContracts.has(invoice.rootId) &&
        (!invoice.invoiceDate ||
          !isValidFinancialDate(invoice.invoiceDate) ||
          invoice.invoiceDate <= asOfDate),
    )
    .map((invoice) => ({
      ...invoice,
      lines:
        Array.isArray(invoice.lines) &&
        invoice.lines.every((line) => line && typeof line === "object")
          ? invoice.lines
          : [],
    }));
  const normalizedNumber = (invoice: AnalysisHousingCostInvoice) =>
    typeof invoice.invoiceNumber === "string"
      ? invoice.invoiceNumber.trim()
      : "";
  const fingerprint = (invoice: AnalysisHousingCostInvoice) =>
    JSON.stringify({
      rootId: invoice.rootId,
      invoiceDate: invoice.invoiceDate,
      invoiceNumber: normalizedNumber(invoice),
      invoiceAmount: nonnegative(invoice.invoiceAmount),
      billingMonth: invoice.billingMonth,
      evidenceVersion: invoice.evidenceVersion,
      lines: invoice.lines
        .map((line) => [line.category, nonnegative(line.amount), line.verified])
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
    });
  while (pending.length) {
    const group = [pending.shift()!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const candidate = pending[index];
        if (
          group.some(
            (invoice) =>
              (invoice.id && invoice.id === candidate.id) ||
              (normalizedNumber(invoice) &&
                normalizedNumber(invoice) === normalizedNumber(candidate)),
          )
        ) {
          group.push(candidate);
          pending.splice(index, 1);
          grew = true;
        }
      }
    }
    const invoice = group[0];
    const affectedMonths = group.some((row) => !monthValid(row.billingMonth))
      ? months
      : unique(group.map((row) => row.billingMonth!)).filter((month) =>
          months.includes(month),
        );
    if (!affectedMonths.length) continue;
    const fullVerified = (row: AnalysisHousingCostInvoice) => {
      const invoiceAmount = nonnegative(row.invoiceAmount);
      return (
        !!row.id?.trim() &&
        invoiceAmount !== null &&
        row.lines.length > 0 &&
        new Set(row.lines.map((line) => line.id)).size === row.lines.length &&
        row.lines.every(
          (line) =>
            !!line.id?.trim() &&
            line.verified === true &&
            nonnegative(line.amount) !== null &&
            (fixedOrExcluded.has(line.category) ||
              variableKeys.includes(line.category as HousingComponent)),
        ) &&
        addFinancialAmounts(...row.lines.map((line) => line.amount)) ===
          invoiceAmount
      );
    };
    // 完整票面只含固定项目或明确押金时，无论何时开票都不重复产生变量成本。
    if (
      group.every(
        (row) =>
          fullVerified(row) &&
          row.lines.every((line) => fixedOrExcluded.has(line.category)),
      )
    )
      continue;
    const variablePresent = variableKeys.filter((key) =>
      group.some((row) => row.lines.some((line) => line.category === key)),
    );
    const invalidInvoice = group.some((row) => !fullVerified(row));
    const conflict = group.some(
      (row) => fingerprint(row) !== fingerprint(invoice),
    );
    const invalidPeriod = group.some(
      (row) =>
        !monthValid(row.billingMonth) ||
        !row.periodReason?.trim() ||
        !row.evidenceVersion?.trim(),
    );
    if (invalidInvoice || conflict || invalidPeriod) {
      markUnknown(
        invalidInvoice || !variablePresent.length
          ? variableKeys
          : variablePresent,
        affectedMonths,
      );
      warnings.push(
        `房屋费用发票${invoice.invoiceNumber || invoice.id}${conflict ? "存在同编号或同票号的证据冲突" : invalidInvoice ? "全票明细未全部核验或金额未闭合" : "原收费月份缺失或无有效证据"}，变量费用保持未知；未用开票日、付款日或合同累计额补月份，已核验的其他费用独立保留。`,
      );
      continue;
    }
    for (const line of invoice.lines)
      if (variableKeys.includes(line.category as HousingComponent))
        rows.push({
          month: invoice.billingMonth!,
          id: `housing-invoice:${invoice.id}:${line.id}`,
          amount: amount(line.amount),
          component: line.category as HousingComponent,
          label: `${housingContracts.get(invoice.rootId)?.title || invoice.rootId}；${HOUSING_COST_LABELS[line.category as HousingComponent]}；原收费月份${invoice.billingMonth}；${invoice.periodReason}；发票${invoice.invoiceNumber || invoice.id}`,
        });
  }
  return { rows, warnings, unknown };
}

function buildPersonnel(
  input: MonthlyFinancialAnalysisInput,
  periods: FinancialAnalysisPeriod[],
  ledger: LedgerRow[],
  reportMap: Map<string, FinancialAnalysisReport>,
  people: Map<string, string>,
): FinancialAnalysisModule {
  const warnings: string[] = [];
  const incurredReimbursementEnabled =
    input.personnelIncurredReimbursements !== undefined;
  const incurredRows = confirmedReimbursementOccurrences(input);
  const employeesByUser = new Map<string, Set<string>>();
  for (const row of [
    ...(input.payroll || []),
    ...(input.reimbursements || []),
    ...(input.undatedReimbursements || []),
    ...incurredRows,
  ]) {
    if (!row.userId || !row.employeeId) continue;
    const ids = employeesByUser.get(row.userId) || new Set<string>();
    ids.add(row.employeeId);
    employeesByUser.set(row.userId, ids);
  }
  const personForSource = (row: {
    employeeId: string | null;
    userId: string | null;
  }): string | null => {
    const employeeIds = row.userId
      ? employeesByUser.get(row.userId)
      : undefined;
    return employeeIds && employeeIds.size > 1
      ? null
      : row.employeeId ||
          (row.userId
            ? employeeIds?.values().next().value || `user:${row.userId}`
            : null);
  };
  const incurredById = new Map<
    string,
    AnalysisPersonnelIncurredReimbursement & {
      canonicalPersonId: string | null;
    }
  >();
  for (const row of incurredRows) {
    const normalized = {
      ...row,
      amount: amount(row.amount),
      canonicalPersonId: personForSource(row),
    };
    const previous = incurredById.get(row.id);
    if (previous) {
      if (
        previous.type !== normalized.type ||
        previous.amount !== normalized.amount ||
        previous.month !== normalized.month
      )
        throw new Error(
          "人员报销同编号的类型、金额或报销月份存在矛盾，不能重复累计或猜测归期",
        );
      if (previous.canonicalPersonId !== normalized.canonicalPersonId)
        incurredById.set(row.id, { ...previous, canonicalPersonId: null });
      continue;
    }
    incurredById.set(row.id, normalized);
  }
  const incurredReimbursements = [...incurredById.values()];
  const unassignedById = new Map<
    string,
    FinancialAnalysisPersonnelUnassignedReimbursement
  >();
  const unassignedSources: Array<
    AnalysisUndatedReimbursement & {
      month?: string | null;
      reason?: string;
      canonicalPersonId?: string | null;
    }
  > = incurredReimbursementEnabled
    ? incurredReimbursements
        .filter((row) => !validReimbursementMonth(row.month))
        .map((row) => ({ ...row, date: null, reason: "报销月份缺失或无效" }))
    : [
        ...(input.undatedReimbursements || []),
        ...(input.reimbursements || [])
          .filter((row) => !isValidFinancialDate(row.date))
          .map((row) => ({ ...row, status: "paid" })),
      ];
  for (const row of unassignedSources) {
    if (
      !(incurredReimbursementEnabled
        ? CONFIRMED_REIMBURSEMENT_STATUSES.has(row.status)
        : ["paid", "payment_uploaded", "completed"].includes(row.status)) ||
      (row.date !== null && isValidFinancialDate(row.date))
    )
      continue;
    const personId =
      row.canonicalPersonId !== undefined
        ? row.canonicalPersonId
        : personForSource(row);
    const detail: FinancialAnalysisPersonnelUnassignedReimbursement = {
      sourceId: row.id,
      type: row.type,
      amount: amount(row.amount),
      date: row.date,
      status: row.status,
      personId,
      personName:
        row.personName || (personId && people.get(personId)) || "人员未确认",
      ...(incurredReimbursementEnabled
        ? { month: row.month ?? null, reason: row.reason }
        : {}),
    };
    const previous = unassignedById.get(row.id);
    if (previous) {
      if (
        previous.type !== detail.type ||
        previous.amount !== detail.amount ||
        previous.date !== detail.date
      )
        throw new Error(
          "未归期报销同编号的类型、金额或日期存在矛盾，不能重复计入或猜测归属",
        );
      if (previous.personId !== detail.personId)
        unassignedById.set(row.id, {
          ...previous,
          personId: null,
          personName: "人员关联待核对",
        });
      continue;
    }
    unassignedById.set(row.id, detail);
  }
  const unassignedReimbursements = [...unassignedById.values()];
  for (const row of unassignedReimbursements)
    if (row.personId && !people.has(row.personId))
      people.set(row.personId, row.personName);
  const costYearFrom = `${input.query.from.slice(0, 4)}-01`;
  const costYearTo = `${input.query.to.slice(0, 4)}-12`;
  const inCostYears = (month: string) =>
    inPeriod(month, costYearFrom, costYearTo);
  const warnForCostMonth = (month: string, message: string) => {
    if (inCostYears(month)) warnings.push(message);
  };
  const costs: Array<{
    month: string;
    personId: string;
    parts: Record<string, string | null>;
    total: string;
    sourceId: string;
    sourceState: string;
  }> = [];
  for (const row of ledger.filter(
    (item) =>
      inCostYears(item.month) &&
      (item.sourceType === "payroll" ||
        (!incurredReimbursementEnabled && item.sourceType === "reimbursement")),
  )) {
    const personId =
      row.personId || `unknown:${row.sourceType}:${row.sourceId}`;
    people.set(personId, row.personName || "历史人员信息缺失");
    if (row.sourceType === "payroll") {
      const parts =
        row.frozenPayrollParts ||
        (row.payroll
          ? payrollValues(row.payroll)
          : { salary: null, social: null, housing: null, adjustment: null });
      if (!row.payroll && !row.frozenPayrollParts)
        warnings.push(
          `${row.month}部分工资快照没有可核对的分项，保留原工资总成本，工资及公司缴费分项显示未知。`,
        );
      costs.push({
        month: row.month,
        personId,
        parts: { ...parts, payrollCost: row.amount },
        total: row.amount,
        sourceId: row.sourceId,
        sourceState: row.sourceState,
      });
    } else {
      const key = row.metric.replace("_reimbursement", "");
      costs.push({
        month: row.month,
        personId,
        parts: { [key]: row.amount },
        total: row.amount,
        sourceId: row.sourceId,
        sourceState: row.sourceState,
      });
    }
  }
  if (incurredReimbursementEnabled) {
    const currentMonth = financialAnalysisBusinessDate(
      input.generatedAt,
    )!.slice(0, 7);
    for (const row of incurredReimbursements) {
      if (
        !validReimbursementMonth(row.month) ||
        !inCostYears(row.month) ||
        row.month > currentMonth
      )
        continue;
      const personId =
        row.canonicalPersonId || `unknown:reimbursement:${row.id}`;
      people.set(
        personId,
        row.personName || people.get(personId) || "人员未确认",
      );
      costs.push({
        month: row.month,
        personId,
        parts: { [row.type]: row.amount },
        total: row.amount,
        sourceId: row.id,
        sourceState: `按已确认报销月份${row.month}计入人员费用；未重复计入现金月报付款明细`,
      });
      if (row.canonicalPersonId === null)
        warnings.push(
          `${row.month}报销${row.id}人员关联待核对，保留该月总费用与无主明细，不按姓名分配到员工。`,
        );
    }
  }
  const allocations = [...(input.overheadAllocations || [])].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.paymentKind.localeCompare(b.paymentKind) ||
      a.paymentId.localeCompare(b.paymentId) ||
      a.id.localeCompare(b.id),
  );
  const overheadRows: HousingCostRow[] = [];
  const unknownOverheadMonths = new Set<string>();
  const rentAccrualEnabled = input.rentAccrualContracts !== undefined;
  const housingCostEnabled =
    rentAccrualEnabled &&
    (input.housingCostInvoices !== undefined ||
      input.rentAccrualContracts!.some(
        (row) => row.monthlyPropertyFee !== undefined,
      ));
  const housingUnknown = new Map<HousingComponent, Set<string>>();
  if (rentAccrualEnabled && input.housingCostBasis === "invoice-lease") {
    const invoiceCosts = buildInvoiceLeaseHousingCosts(
      input.rentAccrualContracts!,
      input.housingCostInvoices,
      {
        from: costYearFrom,
        to: costYearTo,
        asOfDate: financialAnalysisBusinessDate(input.generatedAt)!,
      },
    );
    overheadRows.push(...invoiceCosts.rows);
    warnings.push(...invoiceCosts.warnings);
    for (const [component, months] of invoiceCosts.unknown) {
      housingUnknown.set(component, months);
      for (const month of months) unknownOverheadMonths.add(month);
    }
  } else if (rentAccrualEnabled) {
    for (const component of (housingCostEnabled
      ? ["rent", "property_management"]
      : ["rent"]) as Array<"rent" | "property_management">) {
      const accrued = buildMonthlyFinancialRentAccrual(
        input.rentAccrualContracts!,
        {
          from: costYearFrom,
          to: costYearTo,
          asOfDate: financialAnalysisBusinessDate(input.generatedAt)!,
          currentMonthMode: input.rentCurrentMonthMode || "daily",
          component,
        },
      );
      for (const entry of accrued) {
        if (entry.amount === null) {
          unknownOverheadMonths.add(entry.month);
          const unknown = housingUnknown.get(component) || new Set<string>();
          unknown.add(entry.month);
          housingUnknown.set(component, unknown);
        }
        warnings.push(...entry.warnings);
        for (const line of entry.lines)
          overheadRows.push({
            month: entry.month,
            id: line.id,
            amount: line.amount,
            label: line.description,
            component,
          });
      }
    }
    if (housingCostEnabled) {
      const variable = buildHousingInvoiceCosts(
        input,
        costYearFrom,
        costYearTo,
        financialAnalysisBusinessDate(input.generatedAt)!,
      );
      overheadRows.push(...variable.rows);
      warnings.push(...variable.warnings);
      for (const [component, months] of variable.unknown) {
        housingUnknown.set(component, months);
        for (const month of months) unknownOverheadMonths.add(month);
      }
    }
  } else {
    const rentPaymentKeys = new Set([
      ...(input.overheadCandidates || [])
        .filter(
          (row) =>
            row.scopeCoverage === "included" || row.scopeCoverage === "unknown",
        )
        .map((row) => `${row.kind}:${row.id}`),
      ...allocations
        .filter(
          (row) =>
            row.lines.some((line) => line.category === "rent") &&
            !(input.overheadCandidates || []).some(
              (candidate) =>
                candidate.id === row.paymentId &&
                candidate.kind === row.paymentKind &&
                candidate.scopeCoverage === "excluded",
            ),
        )
        .map((row) => `${row.paymentKind}:${row.paymentId}`),
    ]);
    const rentInvoiceIds = new Set(
      allocations
        .filter((row) =>
          rentPaymentKeys.has(`${row.paymentKind}:${row.paymentId}`),
        )
        .map((row) => row.invoiceId),
    );
    if (
      (input.overheadCandidates || []).some(
        (row) =>
          row.scopeCoverage !== "excluded" &&
          rentPaymentKeys.has(`${row.kind}:${row.id}`) &&
          !isValidFinancialDate(row.date),
      )
    ) {
      for (const month of listMonthlyFinancialTrendMonths(
        costYearFrom,
        costYearTo,
      ))
        unknownOverheadMonths.add(month);
      warnings.push(
        "房租候选存在缺失或无效实际付款日期，无法可靠归期，未把未归期付款当作不存在。",
      );
    }
    const conflictingPaymentKeys = new Set(
      (input.overheadCandidates || [])
        .filter((row) => row.scopeConflict === true)
        .map((row) => `${row.kind}:${row.id}`),
    );
    const excludedPaymentKeys = new Set(
      (input.overheadCandidates || [])
        .filter((row) => row.scopeCoverage === "excluded")
        .map((row) => `${row.kind}:${row.id}`),
    );
    const positiveSourceAmount = (value: string) =>
      typeof value === "string" &&
      /^\d+(?:\.\d{1,12})?$/u.test(value) &&
      amount(value) !== "0";
    const conflictedInvoiceIds = new Set(
      allocations
        .filter((row) =>
          conflictingPaymentKeys.has(`${row.paymentKind}:${row.paymentId}`),
        )
        .map((row) => row.invoiceId),
    );
    const usableAllocations = allocations.filter((allocation) => {
      // 同一租金发票保留全量分配以核对剩余容量；完全无租金证据的其他资产不进入人力分摊。
      if (
        !rentInvoiceIds.has(allocation.invoiceId) &&
        !rentPaymentKeys.has(
          `${allocation.paymentKind}:${allocation.paymentId}`,
        )
      )
        return false;
      if (
        excludedPaymentKeys.has(
          `${allocation.paymentKind}:${allocation.paymentId}`,
        )
      )
        return false;
      if (!isValidFinancialDate(allocation.date)) {
        // 没有可靠发生日不能猜测哪月，更不能先按字符串月份分摊到已知成本。
        for (const month of listMonthlyFinancialTrendMonths(
          costYearFrom,
          costYearTo,
        ))
          unknownOverheadMonths.add(month);
        warnings.push(
          "房租存在缺失或无效实际付款日期，已从已知分摊排除，相关期间房租保持未知。",
        );
        return false;
      }
      const month = monthOf(allocation.date);
      if (
        !positiveSourceAmount(allocation.amount) ||
        !positiveSourceAmount(allocation.paymentAmount) ||
        (allocation.invoiceAmount !== undefined &&
          !positiveSourceAmount(allocation.invoiceAmount))
      ) {
        unknownOverheadMonths.add(month);
        warnForCostMonth(
          month,
          `${month}房租分配金额或原付款、发票金额无效，未计入已知成本。`,
        );
        return false;
      }
      // 同票据后续分配依赖此前容量；冲突款项不能消费容量，也不能把释放的尾差误配给其他款项。
      if (
        conflictingPaymentKeys.has(
          `${allocation.paymentKind}:${allocation.paymentId}`,
        ) ||
        conflictedInvoiceIds.has(allocation.invoiceId)
      ) {
        unknownOverheadMonths.add(month);
        warnForCostMonth(
          month,
          `${month}房租付款范围或票款证据存在明确冲突，相关发票分配未计入已知成本。`,
        );
        return false;
      }
      return true;
    });
    const matchedByPayment = new Map<string, string>();
    const matchedByInvoice = new Map<string, string>();
    const consumedByInvoice = new Map<string, Map<string, string>>();
    for (const allocation of usableAllocations) {
      const paymentKey = `${allocation.paymentKind}:${allocation.paymentId}`;
      matchedByPayment.set(
        paymentKey,
        addFinancialAmounts(
          matchedByPayment.get(paymentKey) || "0",
          allocation.amount,
        ),
      );
      matchedByInvoice.set(
        allocation.invoiceId,
        addFinancialAmounts(
          matchedByInvoice.get(allocation.invoiceId) || "0",
          allocation.amount,
        ),
      );
    }
    for (const allocation of usableAllocations) {
      const month = monthOf(allocation.date);
      // 只有来源层已证明不属于房租时才排除；混合票据仍保留全量行参与精确分配。
      if (
        excludedPaymentKeys.has(
          `${allocation.paymentKind}:${allocation.paymentId}`,
        )
      )
        continue;
      if (
        allocation.currency &&
        allocation.currency.trim().toUpperCase() !== "CNY"
      ) {
        unknownOverheadMonths.add(month);
        warnForCostMonth(
          month,
          `${month}房租付款${allocation.paymentId}非人民币且没有冻结汇率，未混入人民币分摊。`,
        );
        continue;
      }
      if (
        allocation.invoiceAmount &&
        subtract(
          allocation.invoiceAmount,
          matchedByInvoice.get(allocation.invoiceId) || "0",
        ).startsWith("-")
      ) {
        unknownOverheadMonths.add(month);
        warnForCostMonth(
          month,
          `${month}发票${allocation.invoiceId}累计分配超过原发票金额，未进行房租分摊。`,
        );
        continue;
      }
      if (
        subtract(
          allocation.paymentAmount,
          matchedByPayment.get(
            `${allocation.paymentKind}:${allocation.paymentId}`,
          ) || "0",
        ).startsWith("-")
      ) {
        warnForCostMonth(
          month,
          `${month}付款${allocation.paymentId}票款分配超过原付款，未进行房租分摊。`,
        );
        unknownOverheadMonths.add(month);
        continue;
      }
      if (
        !allocation.lines.length ||
        allocation.lines.some((line) => !line.verified) ||
        (allocation.invoiceAmount &&
          addFinancialAmounts(
            ...allocation.lines.map((line) => line.amount),
          ) !== amount(allocation.invoiceAmount))
      ) {
        unknownOverheadMonths.add(month);
        warnForCostMonth(
          month,
          `${month}发票${allocation.invoiceId}明细未全部核验或合计与票面不一致，房租未知。`,
        );
        continue;
      }
      const consumed =
        consumedByInvoice.get(allocation.invoiceId) ||
        new Map<string, string>();
      const remaining = allocation.lines.map((line) => ({
        id: line.id,
        amount: subtract(line.amount, consumed.get(line.id) || "0"),
      }));
      if (
        subtract(
          addFinancialAmounts(...remaining.map((row) => row.amount)),
          allocation.amount,
        ).startsWith("-")
      ) {
        unknownOverheadMonths.add(month);
        warnForCostMonth(
          month,
          `${month}发票${allocation.invoiceId}剩余可分配金额不足，房租未知。`,
        );
        continue;
      }
      // 每笔只分配发票各行的剩余容量；跨年仍先消费之前付款，不能逐笔重复吃同一尾差。
      const allocated = allocateFinancialAmount(allocation.amount, remaining);
      for (const line of allocation.lines)
        consumed.set(
          line.id,
          addFinancialAmounts(
            consumed.get(line.id) || "0",
            allocated.get(line.id)!,
          ),
        );
      consumedByInvoice.set(allocation.invoiceId, consumed);
      if (!inPeriod(month, costYearFrom, costYearTo)) continue;
      const report = reportMap.get(month);
      const paymentKinds = unique([
        ...(input.overheadCandidates || [])
          .filter((row) => row.id === allocation.paymentId)
          .map((row) => row.kind),
        ...allocations
          .filter((row) => row.paymentId === allocation.paymentId)
          .map((row) => row.paymentKind),
      ]);
      if (report && paymentKinds.length > 1) {
        unknownOverheadMonths.add(month);
        warnings.push(
          `${month}月报资产支出对应同编号的多种真实付款类型，无法证明原冻结归属，未将多种付款重复计入已知成本。`,
        );
        continue;
      }
      // 月报有此笔支出且金额相符时才补充费用类别，月结缺少来源时不能追加一笔历史费用。
      if (
        report &&
        !ledger.some(
          (row) =>
            row.month === month &&
            row.sourceType === "asset_payment" &&
            row.sourceId === allocation.paymentId &&
            row.amount === amount(allocation.paymentAmount),
        )
      ) {
        warnings.push(
          `${month}房租付款未能与月报同编号同金额来源核对，未补入历史分摊。`,
        );
        unknownOverheadMonths.add(month);
        continue;
      }
      if (
        !allocation.lines.length ||
        allocation.lines.some((line) => !line.verified)
      ) {
        warnings.push(
          `${month}发票${allocation.invoiceId}费用分类尚未全部核验，未进行房租分摊。`,
        );
        unknownOverheadMonths.add(month);
        continue;
      }
      for (const line of allocation.lines)
        if (OVERHEAD_NAMES[line.category])
          overheadRows.push({
            month,
            id: `${allocation.id}:${line.id}`,
            amount: allocated.get(line.id)!,
            label: `${allocation.title}／${OVERHEAD_NAMES[line.category]}`,
          });
    }
    const candidates: AnalysisOverheadCandidate[] = [
      ...(input.overheadCandidates || []).filter(
        (row) =>
          row.scopeCoverage !== "excluded" &&
          rentPaymentKeys.has(`${row.kind}:${row.id}`) &&
          inCostYears(monthOf(row.date)),
      ),
    ];
    for (const row of ledger.filter(
      (item) => item.sourceType === "asset_payment" && inCostYears(item.month),
    )) {
      if (
        !allocations.some(
          (allocation) =>
            allocation.paymentId === row.sourceId &&
            rentPaymentKeys.has(
              `${allocation.paymentKind}:${allocation.paymentId}`,
            ),
        ) &&
        !candidates.some((candidate) => candidate.id === row.sourceId)
      )
        continue;
      const sameId = candidates.filter(
        (candidate) => candidate.id === row.sourceId,
      );
      const matching = sameId.filter(
        (candidate) =>
          monthOf(candidate.date) === row.month &&
          amount(candidate.amount) === row.amount,
      );
      // 来源中的真实付款类型不能仅按编号混并；同编号不同类型仍需核对原月报归属。
      if (
        matching.length === 1 &&
        new Set(sameId.map((candidate) => candidate.kind)).size === 1
      )
        continue;
      const allocationEvidence = allocations.filter(
        (allocation) =>
          allocation.paymentId === row.sourceId &&
          monthOf(allocation.date) === row.month &&
          amount(allocation.paymentAmount) === row.amount,
      );
      const kinds = unique(
        allocationEvidence.map((allocation) => allocation.paymentKind),
      );
      if (!sameId.length && kinds.length === 1) {
        candidates.push({
          id: row.sourceId,
          kind: kinds[0],
          date: row.date,
          amount: row.amount,
          title: row.name,
        });
        continue;
      }
      unknownOverheadMonths.add(row.month);
      warnings.push(
        `${row.month}月报资产支出未能唯一核对实际付款类型、发生月和金额，房租归属待核对；未另造普通付款候选。`,
      );
    }
    for (const candidate of candidates) {
      if (candidate.scopeConflict === true) {
        unknownOverheadMonths.add(monthOf(candidate.date));
        warnings.push(
          `${monthOf(candidate.date)}房租候选存在明确来源冲突，未计入已知分摊或把缺口当作零。`,
        );
        continue;
      }
      if (candidate.scopeCoverage === "excluded") continue;
      if (candidate.scopeCoverage === "unknown") {
        unknownOverheadMonths.add(monthOf(candidate.date));
        warnings.push(
          `${monthOf(candidate.date)}存在付款尚不能确定房租范围，房租归属待核对。`,
        );
      }
      const matched =
        matchedByPayment.get(`${candidate.kind}:${candidate.id}`) || "0";
      if (amount(candidate.amount) !== matched) {
        unknownOverheadMonths.add(monthOf(candidate.date));
        warnings.push(
          `${monthOf(candidate.date)}资产付款${candidate.id}未具备全额票款匹配及分类，房租不能按零处理。`,
        );
      }
    }
  }
  const overheadMonths = unique(overheadRows.map((row) => row.month)).sort();
  const rentAllocationInputs = overheadMonths.map((month) => ({
    month,
    members: unique(
      costs
        .filter(
          (row) => row.month === month && row.parts.payrollCost !== undefined,
        )
        .map((row) => row.personId),
    ),
    amount: addFinancialAmounts(
      ...overheadRows
        .filter((row) => row.month === month)
        .map((row) => row.amount),
    ),
  }));
  // 租期发生额使用自然年累计精确应摊额平衡尾差；其他票款分配仍用原算法。
  const balancedRent = rentAccrualEnabled
    ? allocateBalancedAnnualRent(rentAllocationInputs)
    : null;
  const unallocated: FinancialAnalysisDetail[] = [];
  for (const month of overheadMonths) {
    const members = unique(
      costs
        .filter(
          (row) => row.month === month && row.parts.payrollCost !== undefined,
        )
        .map((row) => row.personId),
    );
    const total = addFinancialAmounts(
      ...overheadRows
        .filter((row) => row.month === month)
        .map((row) => row.amount),
    );
    if (!members.length) {
      warnings.push(
        `${month}${housingCostEnabled ? "房屋租赁成本" : "房租"}${total}元没有当月有效工资名单，无法分摊，未使用当前在职人数代替。`,
      );
      unknownOverheadMonths.add(month);
      unallocated.push({
        id: `${month}:unallocated`,
        month,
        from: month,
        to: month,
        year: month.slice(0, 4),
        person: "无法分摊（无工资名单）",
        overhead: total,
        known_overhead: total,
        total: null,
        sourceId: overheadRows
          .filter((row) => row.month === month)
          .map((row) => row.id)
          .join("、"),
        sourceState: "未分摊费用",
      });
      continue;
    }
    const distributed =
      balancedRent?.get(month) ||
      allocateFinancialAmount(
        total,
        members.map((id) => ({ id, amount: "1" })),
      );
    for (const personId of members)
      costs.push({
        month,
        personId,
        parts: { overhead: distributed.get(personId)! },
        total: distributed.get(personId)!,
        sourceId: overheadRows
          .filter((row) => row.month === month)
          .map((row) => row.id)
          .join("、"),
        sourceState: `按${month}有效工资名单${members.length}人平均分摊；${rentAccrualEnabled ? "按自然年累计精确应摊额平衡分币尾差，各月合计不变" : "最小单位尾差按稳定编号分配"}${rentAccrualEnabled ? `；${unique(overheadRows.filter((row) => row.month === month).map((row) => row.label)).join("；")}` : ""}`,
      });
  }
  const query = input.query;
  const periodCosts = costs.filter(
    (row) =>
      inPeriod(row.month, query.from, query.to) &&
      (!query.personId || query.personId === row.personId),
  );
  const personIds = unique(periodCosts.map((row) => row.personId));
  const currentMonth = monthOf(
    financialAnalysisBusinessDate(input.generatedAt)!,
  );
  const payrollKeys = new Set([
    "payrollCost",
    "salary",
    "social",
    "housing",
    "adjustment",
  ]);
  const componentLabels: Record<string, string> = {
    payrollCost: "工资总成本（含公司缴费）",
    ...PAYROLL_LABELS,
    ...(housingCostEnabled
      ? { overhead: "房屋租赁成本分摊" }
      : rentAccrualEnabled
        ? { overhead: "房租分摊（按发生期间）" }
        : {}),
  };
  const totalComponents = [
    "payrollCost",
    "basic",
    "large",
    "business",
    "overhead",
  ];
  const invalidReimbursementTypes = new Set(
    (input.reimbursements || [])
      .filter((row) => !isValidFinancialDate(row.date))
      .map((row) => row.type),
  );
  const wageRowsForMonth = (month: string) =>
    costs.filter(
      (row) => row.month === month && row.parts.payrollCost !== undefined,
    );
  // 完整性按来源独立判断：房租未核验不能抹去工资，缺报销日期也不能被工资记录掩盖。
  const componentMonthComplete = (
    month: string,
    key: string,
    personId?: string,
  ): boolean => {
    if (month > currentMonth) return false;
    const report = reportMap.get(month);
    if (payrollKeys.has(key)) {
      if (sourceMissing(report, ["payroll"])) return false;
      const wageRows = wageRowsForMonth(month);
      if (report) {
        const sourceAmount = report.sources?.find(
          (source) => source.key === "payroll",
        )?.amount;
        // 原快照有可核对汇总时必须闭合；不从当前工资表补入旧月结缺失人员。
        return (
          typeof sourceAmount !== "string" ||
          addFinancialAmounts(...wageRows.map((row) => row.total)) ===
            amount(sourceAmount)
        );
      }
      // 工资表按月完整读取且该月有工资名单，才能确认某位未领工资人员的零成本。
      return input.payroll !== undefined && wageRows.length > 0;
    }
    if (key === "overhead") {
      if (rentAccrualEnabled) return !unknownOverheadMonths.has(month);
      return (
        !unknownOverheadMonths.has(month) &&
        ((input.overheadCandidates !== undefined &&
          input.overheadAllocations !== undefined) ||
          (Boolean(report) && !sourceMissing(report, ["asset_payments"])))
      );
    }
    if (["basic", "large", "business"].includes(key)) {
      if (incurredReimbursementEnabled)
        return !unassignedReimbursements.some(
          (row) =>
            row.type === key &&
            (!personId || row.personId === null || row.personId === personId),
        );
      if (sourceMissing(report, ["reimbursements", `${key}_reimbursement`]))
        return false;
      if (report?.status === "closed") return true;
      const type = key as AnalysisReimbursement["type"];
      if (
        input.reimbursements !== undefined &&
        input.undatedReimbursements !== undefined
      ) {
        const pending = unassignedReimbursements.filter(
          (row) => row.type === type,
        );
        // 全类型诊断明确有缺口、人员清单却没有记录时不能凭不一致响应确认零。
        if (
          input.reimbursementDatesComplete?.[type] === false &&
          !pending.length
        )
          return false;
        return !pending.some(
          (row) =>
            !personId || row.personId === null || row.personId === personId,
        );
      }
      return (
        input.reimbursements !== undefined &&
        input.reimbursementDatesComplete?.[type] === true &&
        !invalidReimbursementTypes.has(type)
      );
    }
    return false;
  };
  const partAmount = (
    key: string,
    from: string,
    to: string,
    personId?: string,
  ): string | null => {
    const months = listMonthlyFinancialTrendMonths(from, to);
    if (months.some((month) => !componentMonthComplete(month, key, personId)))
      return null;
    const rows = costs.filter((row) => inPeriod(row.month, from, to));
    if (
      personId &&
      rows.some(
        (row) =>
          row.personId.startsWith("unknown:") && row.parts[key] !== undefined,
      )
    )
      return null;
    return sum(
      rows
        .filter((row) => !personId || row.personId === personId)
        .map((row) => (row.parts[key] === undefined ? "0" : row.parts[key])),
    );
  };
  const totalAmount = (from: string, to: string, personId?: string) =>
    sum(totalComponents.map((key) => partAmount(key, from, to, personId)));
  const knownPartAmount = (
    key: string,
    from: string,
    to: string,
    personId: string,
  ): string | null => {
    if (to > currentMonth) return null;
    const values = costs
      .filter(
        (row) => row.personId === personId && inPeriod(row.month, from, to),
      )
      .map((row) => row.parts[key])
      .filter((value): value is string => typeof value === "string");
    // 已核验分项独立保留；无已知记录时只允许完整来源确认的零，不把缺口转为零。
    return values.length
      ? addFinancialAmounts(...values)
      : partAmount(key, from, to, personId);
  };
  const knownAmount = (
    from: string,
    to: string,
    personId?: string,
  ): string | null => {
    if (to > currentMonth) return null;
    const rows = costs.filter(
      (row) =>
        inPeriod(row.month, from, to) &&
        (!personId || row.personId === personId),
    );
    // 没有任何可核验成本记录、完整总额也未知时，不能用空集合合计画出一条伪零线。
    return rows.length || totalAmount(from, to, personId) !== null
      ? addFinancialAmounts(...rows.map((row) => row.total))
      : null;
  };
  for (const month of listMonthlyFinancialTrendMonths(query.from, query.to)) {
    const incomplete = totalComponents.filter(
      (key) => !componentMonthComplete(month, key, query.personId),
    );
    if (incomplete.length)
      warnings.push(
        `${month}${incomplete.map((key) => componentLabels[key]).join("、")}来源尚不完整，相关分项和完整总成本保持未知；其他已核验分项独立展示，已知部分不替代完整成本。`,
      );
  }
  const years = unique(
    listMonthlyFinancialTrendMonths(query.from, query.to).map((month) =>
      month.slice(0, 4),
    ),
  );
  // 年度清单从全年实际成本记录取并集，年中离职且所选月份没有工资的人仍保留。
  for (const row of costs)
    if (
      years.includes(row.month.slice(0, 4)) &&
      (!query.personId || query.personId === row.personId) &&
      !personIds.includes(row.personId)
    )
      personIds.push(row.personId);
  for (const row of unassignedReimbursements)
    if (
      row.personId &&
      (!query.personId || query.personId === row.personId) &&
      !personIds.includes(row.personId)
    )
      personIds.push(row.personId);
  const annualPeriod = (year: string): FinancialAnalysisPeriod => ({
    key: year,
    label: `${year}年`,
    from: `${year}-01`,
    to: year === currentMonth.slice(0, 4) ? currentMonth : `${year}-12`,
  });
  const personnelDetail = (
    personId: string,
    period: FinancialAnalysisPeriod,
  ): FinancialAnalysisDetail => {
    const rows = costs.filter(
      (row) =>
        row.personId === personId &&
        inPeriod(row.month, period.from, period.to),
    );
    const parts = Object.fromEntries(
      Object.keys(componentLabels).flatMap((key) => [
        [key, partAmount(key, period.from, period.to, personId)],
        [
          `known_${key}`,
          knownPartAmount(key, period.from, period.to, personId),
        ],
      ]),
    );
    const year = period.from.slice(0, 4);
    const annual = annualPeriod(year);
    return {
      id: `${period.key}:${personId}`,
      period: period.label,
      month: period.from,
      from: period.from,
      to: period.to,
      year,
      person: people.get(personId) || personId,
      personId,
      ...parts,
      total: totalAmount(period.from, period.to, personId),
      knownTotal: knownAmount(period.from, period.to, personId),
      annualTotal: knownAmount(annual.from, annual.to, personId),
      sourceId: rows.map((row) => row.sourceId).join("、"),
      sourceState:
        unique(rows.map((row) => row.sourceState)).join("；") ||
        "该期间无已录入费用记录；非完整性保证",
    };
  };
  const details = personIds.flatMap((personId) =>
    periods.map((period) => personnelDetail(personId, period)),
  );
  // 年度金额仅从实际成本源计算一次，不相加月度／季度清单中的重复年度列。
  const personnelAnnualDetails = years
    .filter((year) => year <= currentMonth.slice(0, 4))
    .flatMap((year) =>
      personIds.map((personId) =>
        personnelDetail(personId, annualPeriod(year)),
      ),
    );
  const total = addFinancialAmounts(...periodCosts.map((row) => row.total));
  return {
    key: "personnel",
    title: "人力成本分析",
    description: `工资按所属月、报销按${incurredReimbursementEnabled ? "系统已确认报销月份" : "实际付款月"}；薪资与公司社保公积金拆分，实际调整单列；${input.housingCostBasis === "invoice-lease" ? "住房有效发票总额按各合同实际租期摊入月份后" : housingCostEnabled ? "房屋租赁的租金、物业及已确认变量费用按各发生月合并后" : "仅房租"}按当月有效工资名单分摊，不重复增加公司支出。`,
    sourceLabel:
      (incurredReimbursementEnabled
        ? "工资优先已冻结月报；人力三类报销按系统已审批确认、已付款或已完成记录的报销月份独立累计，不重复叠加现金月报报销。付款日期缺失不阻断已确认的报销月份，报销月份缺失或人员归属不明仍待核对。其他六模块继续按原现金口径统计。"
        : "工资及报销优先月报来源，各来源独立判断完整性；可靠工资不被报销或房租缺口抹去，已知部分不代替完整总额。") +
      "已月结未冻结的工资分项保留未知，不以当前组成替代。年度总额为截至当前北京时间业务日的当年已录入成本，未来预生成工资排除，离职人员保留。" +
      (input.housingCostBasis === "invoice-lease"
        ? "每份房屋合同全部已上传并确认的有效发票按其实际租赁天数分摊，首尾月按有效天数，当前月截至当天；新发票会更新全租期基数，未到期份额留在后续期间。各合同分别计算后合并，不重复加合同月租计提或银行回单金额，不按上传月、开票月或收费单月份集中计入；可退押金及其他资产排除。每月合计再按当月有效人员名单一次精确分摊。"
        : housingCostEnabled
          ? `房屋租赁成本仅限已确认成本方向的房屋合同：固定租金与明确物业费按有效租期逐月计算，本月${input.rentCurrentMonthMode === "full-month" ? "按整月" : "截至当天按日"}计提；电费、系统维护及已确认其他房屋费用仅按原收费单的可核验月份归期。发票中的租金、物业不重复累加；可退押金及非房屋资产不计费用。月度各项先合并，再统一按年度累计精确欠额平衡分摊。`
          : rentAccrualEnabled
            ? `房租按已生效房屋租赁的明确租期和独立月租逐月计算发生额，本月${input.rentCurrentMonthMode === "full-month" ? "按整月" : "按截至业务日已发生天数"}计算；不由付款月份、付款金额或合同总额倒算，物业、押金、电费及其他资产支出不计入。`
            : "分摊仅采用已付款且已核验的租金，物业、电费、系统维护费及其他资产支出不计入房租。"),
    updatedAt: maxDate([
      ...(input.payroll || [])
        .filter((row) => inCostYears(row.month))
        .map((row) => row.updatedAt),
      ...incurredReimbursements
        .filter(
          (row) => validReimbursementMonth(row.month) && inCostYears(row.month),
        )
        .map((row) => row.updatedAt),
      ...(housingCostEnabled
        ? (input.housingCostInvoices || []).map((row) => row.updatedAt)
        : []),
      ...(rentAccrualEnabled
        ? input.rentAccrualContracts!.map((row) => row.updatedAt || null)
        : allocations
            .filter((row) => inCostYears(monthOf(row.date)))
            .map((row) => row.updatedAt)),
    ]),
    periods,
    series: [
      ...Object.entries(componentLabels).map(([key, label]) => ({
        key,
        label,
        values: periods.map((period) =>
          partAmount(key, period.from, period.to, query.personId),
        ),
      })),
      {
        key: "knownTotal",
        label: "已录入成本（已知部分）",
        values: periods.map((period) =>
          knownAmount(period.from, period.to, query.personId),
        ),
      },
      {
        key: "total",
        label: "已录入人员总成本",
        values: periods.map((period) =>
          totalAmount(period.from, period.to, query.personId),
        ),
      },
    ],
    summaries: [
      value(
        "total",
        "期间已录入总成本",
        totalAmount(query.from, query.to, query.personId),
        "按实际来源累计，不代表尚未录入月份的完整成本",
      ),
      value(
        "knownTotal",
        "期间已录入部分合计",
        periodCosts.length ||
          totalAmount(query.from, query.to, query.personId) !== null
          ? total
          : null,
        periodCosts.length
          ? "完整性不足时仅作为已知金额，不代替完整成本"
          : "当前期间没有已录入人员成本记录；仅完整来源确认时显示零，来源不完整时不能解释为真实零",
      ),
      value(
        "payrollCost",
        componentLabels.payrollCost,
        partAmount("payrollCost", query.from, query.to, query.personId),
      ),
    ],
    breakdown: Object.entries(componentLabels)
      .filter(([key]) => key !== "payrollCost")
      .map(([key, label]) =>
        value(
          key,
          label,
          partAmount(key, query.from, query.to, query.personId),
        ),
      ),
    comparison: personIds.map((personId) =>
      value(
        personId,
        people.get(personId) || personId,
        personIds.some((id) => totalAmount(query.from, query.to, id) === null)
          ? knownAmount(query.from, query.to, personId)
          : totalAmount(query.from, query.to, personId),
        personIds.some((id) => totalAmount(query.from, query.to, id) === null)
          ? "已知部分成本；尚未归期报销和未核验房租不计入"
          : undefined,
      ),
    ),
    columns: [
      column("period", "期间"),
      column("from", "开始月份"),
      column("to", "结束月份"),
      column("year", "自然年"),
      column("person", "人员"),
      column("personId", "人员编号"),
      column("payrollCost", componentLabels.payrollCost, "amount"),
      ...Object.entries(componentLabels)
        .filter(([key]) => key !== "payrollCost")
        .map(([key, label]) => column(key, label, "amount")),
      column("total", "期间总成本", "amount"),
      column("knownTotal", "期间已知来源合计", "amount"),
      column("annualTotal", "当年已录入总成本", "amount"),
      ...Object.entries(componentLabels).map(([key, label]) =>
        column(`known_${key}`, `${label}（已知部分）`, "amount"),
      ),
      column("sourceId", "来源编号"),
      column("sourceState", "来源及分摊说明"),
    ],
    details: [
      ...details,
      ...unallocated.filter((row) =>
        inPeriod(row.month!, query.from, query.to),
      ),
    ],
    personnelAnnualDetails,
    ...(input.housingCostBasis
      ? { housingCostBasis: input.housingCostBasis }
      : {}),
    ...(housingCostEnabled
      ? {
          housingCostBreakdown: (
            Object.entries(HOUSING_COST_LABELS) as Array<
              [HousingComponent, string]
            >
          ).map(([key, label]) => {
            const sourceRows = overheadRows.filter(
              (row) =>
                row.component === key &&
                inPeriod(row.month, query.from, query.to),
            );
            const complete = listMonthlyFinancialTrendMonths(
              query.from,
              query.to,
            ).every(
              (month) =>
                month <= currentMonth && !housingUnknown.get(key)?.has(month),
            );
            const known = addFinancialAmounts(
              ...sourceRows.map((row) => row.amount),
            );
            return {
              key,
              label,
              amount: complete ? known : null,
              knownAmount: sourceRows.length || complete ? known : null,
              note: `${query.from}至${query.to}公司住房费用${complete ? "" : "（来源有待核对，已知部分独立保留）"}，不能与个人分摊重复相加。`,
            };
          }),
        }
      : {}),
    personnelReimbursementBasis: incurredReimbursementEnabled
      ? "reimbursement-month"
      : "payment-month",
    ...(incurredReimbursementEnabled ||
    input.undatedReimbursements !== undefined
      ? {
          personnelUnassignedReimbursements: unassignedReimbursements.filter(
            (row) =>
              !query.personId ||
              row.personId === null ||
              row.personId === query.personId,
          ),
        }
      : {}),
    warnings: unique([
      ...warnings,
      input.housingCostBasis === "invoice-lease"
        ? "房屋合同全部有效费用发票按完整实际租赁天数分摊，不叠加合同计提或银行付款。新发票更新全租期分析基数，当前月截至当天，未来份额后续计入；各月合计再按当月人员名单精确分摊，可退押金和其他资产排除。"
        : housingCostEnabled
          ? "房屋租赁固定租金及物业按租期发生，变量费用按原收费单月份核验；只计算房屋合同，不包含可退押金或其他资产合同。每月各费用先精确汇总，再按当月有效工资名单统一分摊，年度内平衡最小单位尾差；公司住房成本不再与人员分摊重复增加支出。"
          : rentAccrualEnabled
            ? "房租按有效租期和独立月租的实际发生期间计算，不含物业、押金及其他资产付款；起止月按有效天数处理，本月按当前约定截断，未来不预估。各月按当月有效工资名单精确等份，以自然年累计应摊与已摊差额平衡尾差，完全同差额才按稳定编号排序；每月分摊合计严格等于当月发生额，保留来源精度（至少分）。不覆盖已保存月报或改变公司现金支出。"
            : "房租仅按已核验租金票款分配计算，不包含手工电费或其他资产费用；没有租金证据不按名称猜测。混合发票先按全部明细精确分配付款，仅取租金份额，按当月有效工资名单均摊；尾差保持来源精度（至少分），合计严格等于租金份额。",
      "年度总额按自然年已录入费用汇总；来源缺失或未建立月报的月份不表示费用真实为零。",
      ...(unassignedReimbursements.some(
        (row) =>
          !query.personId ||
          row.personId === null ||
          row.personId === query.personId,
      )
        ? [
            `存在${incurredReimbursementEnabled ? "报销月份缺失或无效的已确认报销" : "未归期已付款报销"}，按真实人员独立列示，不分配到任何月、季或年度合计；本人同类费用及全员完整合计保留未知，其他已核验人员不受牵连。人员无法关联的记录仍影响所有人员，未按姓名猜测。`,
          ]
        : []),
    ]),
    appliedFilters: ["时间", ...(query.personId ? ["人员"] : [])],
  };
}

export async function loadMonthlyFinancialAnalysis(
  query: FinancialAnalysisQuery,
  options: MonthlyFinancialAnalysisLoadOptions,
): Promise<MonthlyFinancialAnalysisData> {
  buildFinancialAnalysisPeriods(query);
  const comparisonQuery = buildMonthlyFinancialComparisonQuery(query);
  const generatedAt = (options.now || new Date()).toISOString();
  const reports = new Map<string, Promise<FinancialAnalysisReport>>();
  const sharedOptions: MonthlyFinancialAnalysisLoadOptions = {
    ...options,
    now: new Date(generatedAt),
    loadReport: (month, client) => {
      let report = reports.get(month);
      if (!report) {
        report = options.loadReport(month, client);
        reports.set(month, report);
      }
      return report;
    },
  };
  let sources = await loadFinancialAnalysisSources(query, sharedOptions);
  if (comparisonQuery) {
    // 两期各自按原范围取数，避免为相隔几十年的对比加载中间无关年份；复用同一事务和月报缓存。
    const earlier = await loadFinancialAnalysisSources(
      comparisonQuery,
      sharedOptions,
    );
    const earlierReceiptFiles = new Map(
      (earlier.receipts || [])
        .filter((row) => row.fileMetadata)
        .map((row) => [row.id, row.fileMetadata]),
    );
    const merge = <T>(
      previous: T[] | undefined,
      current: T[] | undefined,
      key: (row: T) => string,
    ): T[] => [
      ...new Map(
        [...(previous || []), ...(current || [])].map((row) => [key(row), row]),
      ).values(),
    ];
    sources = {
      housingCostBasis: sources.housingCostBasis || earlier.housingCostBasis,
      reports: merge(earlier.reports, sources.reports, (row) => row.month),
      contracts: merge(earlier.contracts, sources.contracts, (row) => row.id),
      receipts: merge(earlier.receipts, sources.receipts, (row) => row.id).map(
        (row) => ({
          ...row,
          fileMetadata: row.fileMetadata || earlierReceiptFiles.get(row.id),
        }),
      ),
      reimbursements: merge(
        earlier.reimbursements,
        sources.reimbursements,
        (row) => row.id,
      ),
      ...(earlier.undatedReimbursements !== undefined &&
      sources.undatedReimbursements !== undefined
        ? {
            undatedReimbursements: merge(
              earlier.undatedReimbursements,
              sources.undatedReimbursements,
              (row) =>
                JSON.stringify([
                  row.id,
                  row.type,
                  row.amount,
                  row.date,
                  row.status,
                  row.employeeId,
                  row.userId,
                ]),
            ),
          }
        : {}),
      reimbursementDatesComplete: Object.fromEntries(
        (["basic", "large", "business"] as const).map((type) => [
          type,
          earlier.reimbursementDatesComplete?.[type] === true &&
            sources.reimbursementDatesComplete?.[type] === true,
        ]),
      ),
      ...(earlier.personnelIncurredReimbursements !== undefined &&
      sources.personnelIncurredReimbursements !== undefined
        ? {
            personnelIncurredReimbursements: merge(
              earlier.personnelIncurredReimbursements,
              sources.personnelIncurredReimbursements,
              (row) =>
                JSON.stringify([
                  row.id,
                  row.type,
                  row.month,
                  row.amount,
                  row.status,
                  row.employeeId,
                  row.userId,
                  row.updatedAt,
                ]),
            ),
          }
        : {}),
      payroll: merge(earlier.payroll, sources.payroll, (row) => row.id),
      generalPayments: merge(
        earlier.generalPayments,
        sources.generalPayments,
        (row) => row.id,
      ),
      overheadAllocations: merge(
        earlier.overheadAllocations,
        sources.overheadAllocations,
        (row) => row.id,
      ),
      overheadCandidates: merge(
        earlier.overheadCandidates,
        sources.overheadCandidates,
        (row) => `${row.kind}:${row.id}`,
      ),
      ...(earlier.rentAccrualContracts !== undefined &&
      sources.rentAccrualContracts !== undefined
        ? {
            rentAccrualContracts: merge(
              earlier.rentAccrualContracts,
              sources.rentAccrualContracts,
              (row) => JSON.stringify(row),
            ),
            rentCurrentMonthMode:
              sources.rentCurrentMonthMode ||
              earlier.rentCurrentMonthMode ||
              "daily",
          }
        : {}),
      scopeNames: { ...earlier.scopeNames, ...sources.scopeNames },
      ...(earlier.housingCostInvoices !== undefined &&
      sources.housingCostInvoices !== undefined
        ? {
            housingCostInvoices: merge(
              earlier.housingCostInvoices,
              sources.housingCostInvoices,
              (row) => JSON.stringify(row),
            ),
          }
        : {}),
      warnings: unique([
        ...(earlier.warnings || []),
        ...(sources.warnings || []),
      ]),
    };
  }
  return buildMonthlyFinancialAnalysis({
    query,
    generatedAt,
    ...sources,
  });
}
