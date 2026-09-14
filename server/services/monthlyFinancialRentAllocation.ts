/** 单月可核验房租及当月有效人员；不含现金付款、租期推断或人员名单补造。 */
export interface BalancedAnnualRentMonth {
  month: string;
  amount: string;
  members: readonly string[];
}

interface ExactDebt {
  numerator: bigint;
  denominator: bigint;
}
interface PreparedRentMonth {
  month: string;
  units: bigint;
  scale: bigint;
  precision: number;
  members: string[];
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function fraction(numerator: bigint, denominator: bigint): ExactDebt {
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

function addDebt(left: ExactDebt, right: ExactDebt): ExactDebt {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function compareDebt(left: ExactDebt, right: ExactDebt): -1 | 0 | 1 {
  const leftValue = left.numerator * right.denominator;
  const rightValue = right.numerator * left.denominator;
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function compareId(left: string, right: string): number {
  // 默认排序等价的不同编码仍按原编号稳定排序，不让输入顺序成为分钱依据。
  return (
    left.localeCompare(right) || (left < right ? -1 : left > right ? 1 : 0)
  );
}

function prepareMonth(row: BalancedAnnualRentMonth): PreparedRentMonth {
  if (
    !row ||
    typeof row.month !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(row.month) ||
    row.month.startsWith("0000-")
  )
    throw new Error("房租分摊月份必须为有效的四位年份及两位月份");
  if (typeof row.amount !== "string")
    throw new Error("房租分摊金额必须为十进制文本，不能使用浮点数字");
  const matched = row.amount.match(/^(\d+)(?:\.(\d{1,12}))?$/u);
  if (!matched)
    throw new Error("房租分摊金额必须为非负十进制文本，小数最多十二位");
  if (!Array.isArray(row.members))
    throw new Error("房租分摊人员必须为当月已确认的编号数组");
  if (
    row.members.some((id) => typeof id !== "string" || !id || id.trim() !== id)
  )
    throw new Error("房租分摊人员编号不能为空或含首尾空格");
  if (new Set(row.members).size !== row.members.length)
    throw new Error("同月房租分摊人员编号重复，不能重复分摊");
  const decimal = matched[2] || "";
  // 位数仅用于文本格式和整数尺度；金额、份额及欠额计算全部使用大整数。
  const precision = decimal.length < 2 ? 2 : decimal.length;
  return {
    month: row.month,
    units: BigInt(matched[1] + decimal.padEnd(precision, "0")),
    scale: 10n ** BigInt(precision),
    precision,
    members: [...row.members].sort(compareId),
  };
}

function amountText(units: bigint, precision: number): string {
  const text = units.toString().padStart(precision + 1, "0");
  return `${text.slice(0, -precision)}.${text.slice(-precision)}`;
}

/**
 * 以自然年累计的精确元欠额平衡各月尾差，不改变任何已处理月份。
 * 同样参与月份的人员累计差距不超过该年已使用的最大舍入单位；
 * 全部分位来源即不超过一分。混合精度不会倒改前月，也不声称按未来更小单位追平。
 * 缺人员名单的月份返回空表、不产生人员欠额，由调用方保留未分摊提示。
 */
export function allocateBalancedAnnualRent(
  months: readonly BalancedAnnualRentMonth[],
): Map<string, Map<string, string>> {
  if (!Array.isArray(months)) throw new Error("房租分摊输入必须为月份数组");
  const prepared = months.map(prepareMonth);
  if (new Set(prepared.map((row) => row.month)).size !== prepared.length)
    throw new Error("房租分摊月份重复，请先核验当月原始金额");
  prepared.sort((left, right) => left.month.localeCompare(right.month));
  const result = new Map<string, Map<string, string>>();
  let currentYear = "";
  let debts = new Map<string, ExactDebt>();
  for (const row of prepared) {
    const year = row.month.slice(0, 4);
    if (year !== currentYear) {
      currentYear = year;
      debts = new Map();
    }
    if (!row.members.length) {
      result.set(row.month, new Map());
      continue;
    }
    const count = BigInt(row.members.length);
    const base = row.units / count;
    let remainder = row.units % count;
    const earnedRemainder = fraction(remainder, row.scale * count);
    const oneUnit = fraction(-1n, row.scale);
    const allocated = new Map<string, bigint>();
    for (const id of row.members) {
      allocated.set(id, base);
      debts.set(
        id,
        addDebt(
          debts.get(id) || { numerator: 0n, denominator: 1n },
          earnedRemainder,
        ),
      );
    }
    const recipients = [...row.members].sort(
      (left, right) =>
        -compareDebt(debts.get(left)!, debts.get(right)!) ||
        compareId(left, right),
    );
    for (const recipient of recipients) {
      if (remainder === 0n) break;
      // 每人每月最多承接一个剩余单位，始终维持当月均分的向下／向上取整两档。
      allocated.set(recipient, allocated.get(recipient)! + 1n);
      debts.set(recipient, addDebt(debts.get(recipient)!, oneUnit));
      remainder -= 1n;
    }
    result.set(
      row.month,
      new Map(
        row.members.map((id) => [
          id,
          amountText(allocated.get(id)!, row.precision),
        ]),
      ),
    );
  }
  return result;
}
