export function getCurrentMonthStartIso(now = new Date()): string {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    0,
    0,
    0,
    0,
  ).toISOString();
}
