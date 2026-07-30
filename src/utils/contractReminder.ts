export const CONTRACT_EXPIRY_REMINDER_DAYS = 10;

export type ContractExpiryStatus = "none" | "upcoming" | "today" | "expired";

export interface ContractExpiryReminder {
  shouldRemind: boolean;
  status: ContractExpiryStatus;
  daysRemaining: number | null;
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

export function getContractExpiryReminder(
  contractEndDate: string | null | undefined,
  employmentStatus?: string | null,
  today = new Date(),
): ContractExpiryReminder {
  const endTimestamp = parseDateOnly(contractEndDate);
  if (endTimestamp === null || employmentStatus === "resigned") {
    return { shouldRemind: false, status: "none", daysRemaining: null };
  }

  const todayTimestamp = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const daysRemaining = (endTimestamp - todayTimestamp) / DAY_IN_MILLISECONDS;

  if (daysRemaining > CONTRACT_EXPIRY_REMINDER_DAYS) {
    return { shouldRemind: false, status: "none", daysRemaining };
  }

  const status: ContractExpiryStatus =
    daysRemaining < 0 ? "expired" : daysRemaining === 0 ? "today" : "upcoming";

  return { shouldRemind: true, status, daysRemaining };
}

export function formatContractDate(value: string | null | undefined): string {
  if (parseDateOnly(value) === null || !value) return "";
  const [year, month, day] = value.split("-");
  return `${year}年${month}月${day}日`;
}
