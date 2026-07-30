import { matchPayrollReceiptEmployee } from "../server/utils/payroll-receipt-match";

const employees = [
  {
    employeeId: "employee-1",
    employeeName: "邵长腾",
    bankAccountName: "邵长腾",
    bankAccountNumber: "6212 2602 0018 4017 354",
  },
  {
    employeeId: "employee-2",
    employeeName: "张三",
    bankAccountName: null,
    bankAccountNumber: "6222000000000000002",
  },
];

describe("工资回单员工匹配", () => {
  it("优先按完整收款账号精确匹配", () => {
    expect(
      matchPayrollReceiptEmployee(
        "OCR姓名可能错误",
        "6212260200184017354",
        employees,
      ),
    ).toEqual({ employeeId: "employee-1", status: "matched" });
  });

  it("没有账号时按收款户名精确匹配", () => {
    expect(matchPayrollReceiptEmployee("邵 长腾", "", employees)).toEqual({
      employeeId: "employee-1",
      status: "matched",
    });
  });

  it("同名员工不自动关联", () => {
    expect(
      matchPayrollReceiptEmployee("", "6212260200184017354", [
        employees[0],
        { ...employees[0], employeeId: "employee-3" },
      ]),
    ).toEqual({ employeeId: null, status: "ambiguous" });
  });

  it("无法精确匹配时保持未关联", () => {
    expect(matchPayrollReceiptEmployee("李四", "", employees)).toEqual({
      employeeId: null,
      status: "unmatched",
    });
  });
});
