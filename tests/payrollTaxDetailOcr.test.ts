jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcrDetailed: jest.fn(),
}));

import { extractPayrollTaxItems } from "../server/services/payrollTaxDetailOcr";
import type { PaddleOcrLine } from "../server/services/ocrDaemon";

function line(
  text: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
): PaddleOcrLine {
  return {
    text,
    confidence: 0.99,
    box: [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ],
  };
}

const employees = [
  { employeeId: "employee-1", employeeName: "邵长腾" },
  { employeeId: "employee-2", employeeName: "吴静雯" },
  { employeeId: "employee-3", employeeName: "刘行" },
];

describe("工资表应纳个税识别", () => {
  it("根据合并表头中的应纳个税位置按姓名逐行提取，空白单元格填0", () => {
    const result = extractPayrollTaxItems(
      [
        line("住房公积金 应纳个税", 868, 117, 1048, 142),
        line("邵长腾", 65, 200, 127, 227),
        line("480.00", 892, 204, 956, 224),
        line("50.31", 978, 202, 1033, 225),
        line("6,626.69", 1056, 201, 1144, 226),
        line("吴静雯", 65, 330, 127, 356),
        line("540.00", 890, 332, 957, 354),
        line("7,512.00", 1056, 331, 1144, 356),
        line("刘行", 74, 397, 117, 422),
        line("600.00", 890, 397, 957, 422),
        line("100.41", 969, 398, 1034, 421),
        line("8,246.59", 1057, 400, 1143, 420),
      ],
      employees,
    );

    expect(result).toEqual({
      hasTaxHeader: true,
      items: [
        {
          employeeId: "employee-1",
          employeeName: "邵长腾",
          amount: "50.31",
          pageNo: 1,
        },
        {
          employeeId: "employee-2",
          employeeName: "吴静雯",
          amount: "0.00",
          pageNo: 1,
        },
        {
          employeeId: "employee-3",
          employeeName: "刘行",
          amount: "100.41",
          pageNo: 1,
        },
      ],
      unreadableEmployeeNames: [],
    });
  });

  it("没有应纳个税表头时拒绝把其他金额列当作个税", () => {
    expect(
      extractPayrollTaxItems(
        [
          line("住房公积金", 868, 117, 956, 142),
          line("邵长腾", 65, 200, 127, 227),
          line("480.00", 892, 204, 956, 224),
        ],
        employees,
      ),
    ).toEqual({
      hasTaxHeader: false,
      items: [],
      unreadableEmployeeNames: [],
    });
  });
});
