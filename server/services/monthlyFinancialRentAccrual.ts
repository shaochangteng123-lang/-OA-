import {
  addFinancialAmounts,
  isValidFinancialDate,
} from "./monthlyFinancialReport.js";
import { listMonthlyFinancialTrendMonths } from "./monthlyFinancialTrend.js";

/** 仅使用已生效房屋租赁的明确月租，不使用合同总额或付款金额推算月租。 */
export interface AnalysisRentAccrualContract {
  id: string;
  title: string;
  status: string;
  effectiveAt: string | null;
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  monthlyRent: string | null;
  /** 明确的月物业费；未提供兼容原租金专项，空值未知，明确零允许。 */
  monthlyPropertyFee?: string | null;
  previousContractId?: string | null;
  /** 实际解除日必须有独立已确认依据，不使用最后付款日或操作时间代替。 */
  actualEndDate?: string | null;
  hasUnresolvedChange?: boolean;
  updatedAt?: string | null;
  version?: string | null;
}
export interface RentAccrualMonth {
  month: string;
  amount: string | null;
  knownAmount: string | null;
  lines: Array<{
    id: string;
    amount: string;
    from: string;
    to: string;
    description: string;
  }>;
  warnings: string[];
}
export interface RentAccrualOptions {
  from: string;
  to: string;
  asOfDate: string;
  currentMonthMode: "daily" | "full-month";
  component?: "rent" | "property_management";
}
function monthEnd(month: string): string {
  const days = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
  ).getUTCDate();
  return `${month}-${String(days).padStart(2, "0")}`;
}
function validRent(raw: string | null, allowZero = false): string | null {
  if (raw === null || !/^\d+(?:\.\d{1,12})?$/u.test(raw)) return null;
  const normalized = addFinancialAmounts(raw);
  return normalized === "0" && !allowZero ? null : normalized;
}
function prorate(
  rent: string,
  activeDays: number,
  daysInMonth: number,
): string {
  const [integer, fraction = ""] = rent.split(".");
  const precision = Math.max(2, fraction.length);
  const unit = BigInt(integer + fraction.padEnd(precision, "0"));
  const numerator = unit * BigInt(activeDays);
  const denominator = BigInt(daysInMonth);
  const rounded =
    numerator / denominator +
    ((numerator % denominator) * 2n >= denominator ? 1n : 0n);
  const text = rounded.toString().padStart(precision + 1, "0");
  return addFinancialAmounts(
    `${text.slice(0, -precision)}.${text.slice(-precision)}`,
  );
}
function validDate(raw: string | null | undefined): string | null {
  return typeof raw === "string" && isValidFinancialDate(raw) ? raw : null;
}

/** 自然月发生额；跨月成本独立计算，查询切换不改变分摊基数或补录业务事实。 */
export function buildMonthlyFinancialRentAccrual(
  contracts: readonly AnalysisRentAccrualContract[],
  options: RentAccrualOptions,
): RentAccrualMonth[] {
  const property = options.component === "property_management";
  const label = property ? "物业管理费" : "房租";
  if (!isValidFinancialDate(options.asOfDate))
    throw new Error("房租计提截止日期无效");
  const currentMonth = options.asOfDate.slice(0, 7);
  const asOfEnd =
    options.currentMonthMode === "full-month"
      ? monthEnd(currentMonth)
      : options.asOfDate;
  const groups = new Map<string, AnalysisRentAccrualContract[]>();
  for (const contract of contracts) {
    if (
      !contract.id ||
      !["effective", "executing", "completed", "terminated"].includes(
        contract.status,
      )
    )
      continue;
    const effectiveDate = contract.effectiveAt?.slice(0, 10);
    if (
      effectiveDate &&
      isValidFinancialDate(effectiveDate) &&
      effectiveDate > options.asOfDate
    )
      continue;
    groups.set(contract.id, [...(groups.get(contract.id) || []), contract]);
  }
  const records = [...groups.values()]
    .filter(
      (rows) =>
        !property || rows.some((row) => row.monthlyPropertyFee !== undefined),
    )
    .map((rows) => ({
      contract: rows[0],
      variants: rows,
      conflict: rows.some(
        (row) => JSON.stringify(row) !== JSON.stringify(rows[0]),
      ),
    }));
  return listMonthlyFinancialTrendMonths(options.from, options.to).map(
    (month) => {
      const entry: RentAccrualMonth = {
        month,
        amount: month > currentMonth ? null : "0",
        knownAmount: month > currentMonth ? null : "0",
        lines: [],
        warnings: [],
      };
      if (month > currentMonth) return entry;
      const first = `${month}-01`,
        last = monthEnd(month);
      let incomplete = false;
      for (const { contract, variants, conflict } of records) {
        const start = validDate(contract.leaseStartDate),
          end = validDate(contract.leaseEndDate);
        const mayCoverMonth = variants.some((row) => {
          const from = validDate(row.leaseStartDate),
            to = validDate(row.leaseEndDate);
          if (from && to && from > to) return true;
          return (!from || from <= last) && (!to || to >= first);
        });
        if (!mayCoverMonth) continue;
        const rent = validRent(
          property
            ? (contract.monthlyPropertyFee ?? null)
            : contract.monthlyRent,
          property,
        );
        const actualEnd = validDate(contract.actualEndDate);
        let reason = "";
        if (conflict) reason = "存在重复且冲突的租赁记录";
        else if (!start || !end || start > end || rent === null)
          reason = property
            ? "租期或独立月物业费尚未确认"
            : "租期或独立月租尚未确认";
        else if (contract.hasUnresolvedChange)
          reason = "租赁变更未能确认适用租期或月租";
        else if (contract.status === "terminated" && !actualEnd)
          reason = "实际退租截止日尚未确认";
        else if (contract.actualEndDate && !actualEnd)
          reason = "实际退租截止日无效";
        else if (actualEnd && start && actualEnd < start)
          reason = "实际退租截止日早于起租日期";
        if (reason) {
          incomplete = true;
          entry.warnings.push(
            `${month}${label}合同${contract.id}${reason}，未按合同总额或付款猜测。`,
          );
          continue;
        }
        const overlap = records.some(({ variants: others }) =>
          others.some((other) => {
            if (
              other.id === contract.id ||
              !(
                other.previousContractId === contract.id ||
                contract.previousContractId === other.id
              )
            )
              return false;
            const otherStart = validDate(other.leaseStartDate),
              otherEnd =
                validDate(other.actualEndDate) || validDate(other.leaseEndDate);
            return (
              !!otherStart &&
              !!otherEnd &&
              otherStart <= last &&
              otherEnd >= first &&
              otherStart <= (actualEnd || end!) &&
              otherEnd >= start!
            );
          }),
        );
        if (overlap) {
          incomplete = true;
          entry.warnings.push(
            `${month}同一续租链租期重叠，未重复计提${label}。`,
          );
          continue;
        }
        const from = [first, start!].sort().at(-1)!;
        const to = [last, end!, actualEnd || end!, asOfEnd].sort()[0];
        if (from > to) continue;
        const activeDays = Number(to.slice(8)) - Number(from.slice(8)) + 1;
        const amount = prorate(rent!, activeDays, Number(last.slice(8)));
        entry.lines.push({
          id: `${property ? "property-accrual" : "rent-accrual"}:${contract.id}:${month}`,
          amount,
          from,
          to,
          description: property
            ? `${contract.title || contract.id}；月物业费${rent}元；${from}至${to}，按自然月${activeDays}/${Number(last.slice(8))}天计提，物业费用不再叠加发票固定收费，不含押金。`
            : `${contract.title || contract.id}；月租${rent}元；${from}至${to}，按自然月${activeDays}/${Number(last.slice(8))}天计提，仅房租，不含物业、押金或其他资产付款。`,
        });
      }
      const known = addFinancialAmounts(
        ...entry.lines.map((line) => line.amount),
      );
      entry.amount = incomplete ? null : known;
      entry.knownAmount = entry.lines.length || !incomplete ? known : null;
      return entry;
    },
  );
}
