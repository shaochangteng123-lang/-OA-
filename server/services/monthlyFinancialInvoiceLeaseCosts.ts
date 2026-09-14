import type { AnalysisHousingCostInvoice } from "./monthlyFinancialAnalysis.js";
import type { AnalysisRentAccrualContract } from "./monthlyFinancialRentAccrual.js";
import type { FinancialAnalysisHousingCostValue } from "../types/monthly-financial-analysis.js";
import {
  addFinancialAmounts,
  isValidFinancialDate,
} from "./monthlyFinancialReport.js";
import { listMonthlyFinancialTrendMonths } from "./monthlyFinancialTrend.js";

type Component = FinancialAnalysisHousingCostValue["key"];
const names: Record<Component, string> = {
  rent: "租金",
  property_management: "物业管理费",
  electricity: "电费",
  system_maintenance: "系统维护费",
  other_cost: "其他房屋成本",
};
const components = Object.keys(names) as Component[];
const deposits = new Set(["lease_deposit", "deposit", "refundable_deposit"]);
function validAmount(value: unknown): value is string {
  return typeof value === "string" && /^\d+(?:\.\d{1,12})?$/u.test(value);
}
function day(value: string) {
  return Date.parse(value + "T00:00:00Z") / 86400000;
}
function monthEnd(month: string) {
  return `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()}`;
}
// 用累计应摊额之差得到当月金额，不逐日四舍五入；全租期总额严格等于原发票分类总额。
function portion(
  value: string,
  before: number,
  through: number,
  total: number,
): string {
  const [whole, decimal = ""] = value.split(".");
  const precision = Math.max(2, decimal.length);
  const units = BigInt(whole + decimal.padEnd(precision, "0"));
  const cumulative = (days: number) =>
    (units * BigInt(days) * 2n + BigInt(total)) / (2n * BigInt(total));
  const result = (cumulative(through) - cumulative(before))
    .toString()
    .padStart(precision + 1, "0");
  return addFinancialAmounts(
    `${result.slice(0, -precision)}.${result.slice(-precision)}`,
  );
}

/** 每份合同全量有效发票分别摊入自己的实际租期，查询窗口、开票月和付款月不改变分母。 */
export function buildInvoiceLeaseHousingCosts(
  contracts: readonly AnalysisRentAccrualContract[],
  invoices: readonly AnalysisHousingCostInvoice[] | undefined,
  options: { from: string; to: string; asOfDate: string },
) {
  if (!isValidFinancialDate(options.asOfDate))
    throw new Error("住房发票分摊截止日无效");
  const months = listMonthlyFinancialTrendMonths(
    options.from,
    options.to,
  ).filter((m) => m <= options.asOfDate.slice(0, 7));
  const rows: Array<{
    month: string;
    id: string;
    amount: string;
    label: string;
    component: Component;
  }> = [];
  const warnings: string[] = [];
  const unknown = new Map<Component, Set<string>>();
  const mark = (periods: string[]) => {
    for (const key of components) {
      const values = unknown.get(key) || new Set<string>();
      periods.forEach((m) => values.add(m));
      unknown.set(key, values);
    }
  };
  const groups = new Map<string, AnalysisRentAccrualContract[]>();
  for (const contract of contracts) {
    if (
      !["effective", "executing", "completed", "terminated"].includes(
        contract.status,
      )
    )
      continue;
    const effective = contract.effectiveAt?.slice(0, 10);
    if (
      effective &&
      isValidFinancialDate(effective) &&
      effective > options.asOfDate
    )
      continue;
    groups.set(contract.id, [...(groups.get(contract.id) || []), contract]);
  }
  const byRoot = new Map<string, AnalysisHousingCostInvoice[]>();
  const conflicted = new Set<string>();
  const pending = [...(invoices || [])].filter((i) => groups.has(i.rootId));
  const signature = (i: AnalysisHousingCostInvoice) =>
    JSON.stringify({
      rootId: i.rootId,
      amount: validAmount(i.invoiceAmount)
        ? addFinancialAmounts(i.invoiceAmount)
        : null,
      lines: Array.isArray(i.lines)
        ? i.lines
            .map((l) => [
              l?.category,
              validAmount(l?.amount) ? addFinancialAmounts(l.amount) : null,
              l?.verified,
            ])
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : null,
    });
  while (pending.length) {
    const duplicate = [pending.shift()!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let index = pending.length - 1; index >= 0; index--) {
        const candidate = pending[index];
        if (
          duplicate.some(
            (i) =>
              (i.id && i.id === candidate.id) ||
              (i.invoiceNumber?.trim() &&
                i.invoiceNumber.trim() === candidate.invoiceNumber?.trim()),
          )
        ) {
          duplicate.push(candidate);
          pending.splice(index, 1);
          grew = true;
        }
      }
    }
    if (duplicate.some((i) => signature(i) !== signature(duplicate[0]))) {
      duplicate.forEach((i) => conflicted.add(i.rootId));
      continue;
    }
    const i = duplicate[0];
    byRoot.set(i.rootId, [...(byRoot.get(i.rootId) || []), i]);
  }
  for (const [id, variants] of groups) {
    const contract = variants[0];
    const start = contract.leaseStartDate;
    const end = contract.actualEndDate || contract.leaseEndDate;
    const validPeriod =
      !!start &&
      !!end &&
      isValidFinancialDate(start) &&
      isValidFinancialDate(end) &&
      start <= end;
    const covered = validPeriod
      ? months.filter((m) => m <= end!.slice(0, 7) && m >= start!.slice(0, 7))
      : months;
    if (!covered.length) continue;
    const invalid =
      !validPeriod ||
      variants.some((c) => JSON.stringify(c) !== JSON.stringify(contract)) ||
      contract.hasUnresolvedChange ||
      (contract.status === "terminated" && !contract.actualEndDate) ||
      (contract.actualEndDate &&
        (!contract.leaseEndDate ||
          contract.actualEndDate > contract.leaseEndDate));
    if (invalid || invoices === undefined || conflicted.has(id)) {
      mark(covered);
      warnings.push(
        `${contract.title || id}租期、发票来源或重复证据尚未核验，不能按合同月租或付款金额替代。`,
      );
      continue;
    }
    const totals = new Map<Component, string>();
    let incomplete = false;
    for (const invoice of byRoot.get(id) || []) {
      const lines = invoice.lines;
      if (
        !invoice.id ||
        !validAmount(invoice.invoiceAmount) ||
        !Array.isArray(lines) ||
        !lines.length ||
        new Set(lines.map((l) => l?.id)).size !== lines.length ||
        lines.some(
          (l) =>
            !l?.id ||
            !l.verified ||
            !validAmount(l.amount) ||
            (!components.includes(l.category as Component) &&
              !deposits.has(l.category)),
        ) ||
        addFinancialAmounts(...lines.map((l) => l.amount)) !==
          addFinancialAmounts(invoice.invoiceAmount)
      ) {
        incomplete = true;
        continue;
      }
      for (const line of lines) {
        if (deposits.has(line.category)) continue;
        const key = line.category as Component;
        totals.set(
          key,
          addFinancialAmounts(totals.get(key) || "0", line.amount),
        );
      }
    }
    if (incomplete) {
      mark(covered);
      warnings.push(
        `${contract.title || id}存在发票金额或分类明细未闭合，已核验发票独立保留，未猜测缺失金额。`,
      );
    }
    const totalDays = day(end!) - day(start!) + 1;
    for (const month of covered) {
      const first = [start!, month + "-01"].sort().at(-1)!;
      const last = [end!, monthEnd(month), options.asOfDate].sort()[0];
      if (first > last) continue;
      for (const [component, value] of totals)
        rows.push({
          month,
          component,
          id: `invoice-lease:${id}:${component}:${month}`,
          amount: portion(
            value,
            day(first) - day(start!),
            day(last) - day(start!) + 1,
            totalDays,
          ),
          label: `${contract.title || id}；${names[component]}有效发票总额${value}元；实际租期${start}至${end}共${totalDays}天；本期${first}至${last}按累计精确应摊额计算，不叠加合同计提或付款金额`,
        });
    }
  }
  return { rows, warnings, unknown };
}
