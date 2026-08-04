import { format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";

export function formatDate(
  date: string | Date,
  formatStr: string = "yyyy-MM-dd",
): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, formatStr, { locale: zhCN });
}

export function formatDateTime(date: string | Date): string {
  return formatDate(date, "yyyy-MM-dd HH:mm:ss");
}

export function formatBeijingDateTime(
  value: string | Date | null | undefined,
): string {
  if (!value) return "";

  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    const normalized = value.trim().replace(" ", "T");
    const dateTime = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T00:00:00+08:00`
      : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
        ? normalized
        : `${normalized}+08:00`;
    date = new Date(dateTime);
  }

  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "";
  }

  const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = beijingTime.getUTCFullYear();
  const month = String(beijingTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(beijingTime.getUTCDate()).padStart(2, "0");
  const hour = String(beijingTime.getUTCHours()).padStart(2, "0");
  const minute = String(beijingTime.getUTCMinutes()).padStart(2, "0");
  const second = String(beijingTime.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function formatBeijingDateTimeMinute(
  value: string | Date | null | undefined,
): string {
  const formatted = formatBeijingDateTime(value);
  return formatted.length >= 16 ? formatted.slice(0, 16) : formatted;
}

export function formatDateChinese(date: string | Date): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "yyyy年MM月dd日 EEEE", { locale: zhCN });
}

export function getTodayString(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function getWeekday(date: string | Date): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "EEEE", { locale: zhCN });
}
