export interface PayrollReceiptEmployeeIdentity {
  employeeId: string;
  employeeName: string;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
}

export interface PayrollReceiptEmployeeMatch {
  employeeId: string | null;
  status: "matched" | "unmatched" | "ambiguous";
}

function normalizePersonName(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s·•・]/g, "")
    .replace(/(?:先生|女士)$/u, "");
}

function normalizeBankAccount(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "");
}

function buildMatchResult(employeeIds: string[]): PayrollReceiptEmployeeMatch {
  const uniqueEmployeeIds = [...new Set(employeeIds)];
  if (uniqueEmployeeIds.length === 1) {
    return { employeeId: uniqueEmployeeIds[0], status: "matched" };
  }
  if (uniqueEmployeeIds.length > 1) {
    return { employeeId: null, status: "ambiguous" };
  }
  return { employeeId: null, status: "unmatched" };
}

export function matchPayrollReceiptEmployee(
  payeeName: string,
  payeeAccount: string,
  employees: PayrollReceiptEmployeeIdentity[],
): PayrollReceiptEmployeeMatch {
  const normalizedAccount = normalizeBankAccount(payeeAccount);
  if (normalizedAccount) {
    const accountMatches = employees
      .filter(
        (employee) =>
          normalizeBankAccount(employee.bankAccountNumber) ===
          normalizedAccount,
      )
      .map((employee) => employee.employeeId);
    if (accountMatches.length > 0) return buildMatchResult(accountMatches);
  }

  const normalizedPayeeName = normalizePersonName(payeeName);
  if (!normalizedPayeeName) return buildMatchResult([]);

  return buildMatchResult(
    employees
      .filter((employee) =>
        [employee.employeeName, employee.bankAccountName].some(
          (name) => normalizePersonName(name) === normalizedPayeeName,
        ),
      )
      .map((employee) => employee.employeeId),
  );
}
