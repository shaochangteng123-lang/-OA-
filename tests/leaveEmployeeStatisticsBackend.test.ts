import fs from "fs";
import path from "path";
import {
  buildLeaveEmployeeStatistics,
  expandLeaveEmployeeStatisticsMonthlyRequestRows,
  expandLeaveEmployeeStatisticsRequestRows,
  type LeaveEmployeeStatisticsRequestRow,
  type LeaveEmployeeStatisticsSourceRow,
} from "../server/services/leaveEmployeeStatistics";

function createRequest(
  overrides: Partial<LeaveEmployeeStatisticsRequestRow> &
    Pick<LeaveEmployeeStatisticsRequestRow, "id" | "request_no" | "user_id">,
): LeaveEmployeeStatisticsRequestRow {
  return {
    id: overrides.id,
    request_no: overrides.request_no,
    user_id: overrides.user_id,
    applicant_name: "员工甲",
    applicant_department: "工程部",
    leave_type_code: "annual",
    leave_type_name: "年假",
    start_date: "2026-03-02",
    start_half: "morning",
    end_date: "2026-03-02",
    end_half: "afternoon",
    total_days: 1,
    target_year_days: 1,
    reason: "休假",
    status: "approved",
    submitted_at: "2026-02-20T08:00:00.000Z",
    approved_at: "2026-02-21T08:00:00.000Z",
    application_kind: "normal",
    combination_group_id: null,
    parent_request_id: null,
    ...overrides,
  };
}

function createSourceRequest(
  overrides: Partial<LeaveEmployeeStatisticsRequestRow> &
    Pick<LeaveEmployeeStatisticsRequestRow, "id" | "request_no" | "user_id">,
  balanceAllocationsJson: string | null,
): LeaveEmployeeStatisticsSourceRow {
  return {
    ...createRequest(overrides),
    balance_allocations_json: balanceAllocationsJson,
  };
}

describe("总经理年度员工请假统计", () => {
  it("按逻辑申请次数优先排名，组合申请只计一次且各段天数累加", () => {
    const requests: LeaveEmployeeStatisticsRequestRow[] = [
      createRequest({
        id: "a-combo-annual",
        request_no: "QJ-2026-00001",
        user_id: "employee-a",
        target_year_days: 1,
        application_kind: "combined",
        combination_group_id: "combo-a",
      }),
      createRequest({
        id: "a-combo-sick",
        request_no: "QJ-2026-00002",
        user_id: "employee-a",
        leave_type_code: "sick",
        leave_type_name: "病假",
        start_date: "2026-03-03",
        end_date: "2026-03-03",
        end_half: "morning",
        total_days: 0.5,
        target_year_days: 0.5,
        reason: "复诊",
        application_kind: "combined",
        combination_group_id: "combo-a",
      }),
      createRequest({
        id: "a-other",
        request_no: "QJ-2026-00003",
        user_id: "employee-a",
        leave_type_code: "other",
        leave_type_name: "其他请假",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        total_days: 2,
        target_year_days: 2,
        approved_at: "2026-03-25T08:00:00.000Z",
      }),
      ...["01", "02", "03"].map((suffix, index) =>
        createRequest({
          id: `b-${suffix}`,
          request_no: `QJ-2026-001${suffix}`,
          user_id: "employee-b",
          applicant_name: "员工乙",
          applicant_department: "市场部",
          start_date: `2026-05-0${index + 1}`,
          end_date: `2026-05-0${index + 1}`,
          end_half: "morning",
          total_days: 0.5,
          target_year_days: 0.5,
        }),
      ),
      createRequest({
        id: "ignored-pending",
        request_no: "QJ-2026-00999",
        user_id: "employee-a",
        status: "pending",
        target_year_days: 10,
      }),
    ];

    const result = buildLeaveEmployeeStatistics(
      2026,
      [
        { user_id: "employee-a", name: "员工甲", department: "工程部" },
        { user_id: "employee-b", name: "员工乙", department: "市场部" },
        { user_id: "employee-c", name: "员工丙", department: "综合部" },
      ],
      requests,
      [
        {
          user_id: "employee-a",
          leave_type_code: "annual",
          leave_type_name: "年假",
          requires_balance_check: true,
          total_days: 5,
          used_days: 1,
          pending_days: 0.5,
        },
        {
          user_id: "employee-a",
          leave_type_code: "sick",
          leave_type_name: "病假",
          requires_balance_check: true,
          total_days: 30,
          used_days: 1,
          pending_days: 0.5,
        },
        {
          user_id: "employee-a",
          leave_type_code: "other",
          leave_type_name: "其他请假",
          requires_balance_check: false,
          total_days: 999,
          used_days: 12,
          pending_days: 3,
        },
        {
          user_id: "employee-b",
          leave_type_code: "annual",
          leave_type_name: "年假",
          requires_balance_check: true,
          total_days: 5,
          used_days: 1.5,
          pending_days: 0,
        },
        {
          user_id: "employee-c",
          leave_type_code: "annual",
          leave_type_name: "年假",
          requires_balance_check: true,
          total_days: 8,
          used_days: 0,
          pending_days: 0,
        },
      ],
      {
        manager: { id: "manager-1", name: "总经理甲", roleLabel: "总经理" },
        generatedAt: "2026-09-18T00:00:00.000Z",
      },
    );

    expect(result.manager).toEqual({
      id: "manager-1",
      name: "总经理甲",
      roleLabel: "总经理",
    });
    expect(result.annualComparison).toEqual([
      {
        year: 2026,
        employeeCount: 3,
        approvedRequestCount: 5,
        approvedLeaveDays: 5,
      },
    ]);
    expect(result.summary).toEqual({
      employeeCount: 3,
      approvedRequestCount: 5,
      approvedLeaveDays: 5,
    });
    expect(
      result.employees.map((employee) => [employee.userId, employee.rank]),
    ).toEqual([
      ["employee-b", 1],
      ["employee-a", 2],
      ["employee-c", 3],
    ]);

    const employeeA = result.employees[1];
    expect(employeeA.approvedRequestCount).toBe(2);
    expect(employeeA.approvedLeaveDays).toBe(3.5);
    expect(employeeA).toMatchObject({
      paidLeaveTotalDays: 35,
      paidLeaveUsedDays: 2,
      paidLeavePendingDays: 1,
      paidLeaveRemainingDays: 32,
    });
    expect(employeeA.balanceSummaries).toEqual([
      {
        leaveTypeCode: "annual",
        leaveTypeName: "年假",
        requiresBalanceCheck: true,
        unlimited: false,
        totalDays: 5,
        usedDays: 1,
        pendingDays: 0.5,
        remainingDays: 3.5,
      },
      {
        leaveTypeCode: "sick",
        leaveTypeName: "病假",
        requiresBalanceCheck: true,
        unlimited: false,
        totalDays: 30,
        usedDays: 1,
        pendingDays: 0.5,
        remainingDays: 28.5,
      },
      {
        leaveTypeCode: "other",
        leaveTypeName: "其他请假",
        requiresBalanceCheck: false,
        unlimited: true,
        totalDays: null,
        usedDays: null,
        pendingDays: null,
        remainingDays: null,
      },
    ]);
    expect(employeeA.typeSummaries).toEqual(
      expect.arrayContaining([
        {
          leaveTypeCode: "annual",
          leaveTypeName: "年假",
          requestCount: 1,
          totalDays: 1,
        },
        {
          leaveTypeCode: "sick",
          leaveTypeName: "病假",
          requestCount: 1,
          totalDays: 0.5,
        },
        {
          leaveTypeCode: "other",
          leaveTypeName: "其他请假",
          requestCount: 1,
          totalDays: 2,
        },
      ]),
    );
    const combinedRequest = employeeA.requests.find(
      (request) => request.segments.length === 2,
    );
    expect(combinedRequest).toMatchObject({
      applicationKind: "combined",
      parentRequestId: null,
      totalDays: 1.5,
      reason: "休假；复诊",
    });
    expect(
      combinedRequest?.segments.map((segment) => segment.totalDays),
    ).toEqual([1, 0.5]);

    expect(result.employees[2]).toMatchObject({
      userId: "employee-c",
      approvedRequestCount: 0,
      approvedLeaveDays: 0,
      paidLeaveTotalDays: 8,
      paidLeaveUsedDays: 0,
      paidLeavePendingDays: 0,
      paidLeaveRemainingDays: 8,
    });
  });

  it("一次聚合最近年度对比，并为当前年度员工生成历年趋势", () => {
    const requests = [
      createRequest({
        id: "a-combo-annual-2025",
        request_no: "QJ-2025-00001",
        user_id: "employee-a",
        start_date: "2025-03-03",
        end_date: "2025-03-03",
        target_year: 2025,
        target_year_days: 1,
        application_kind: "combined",
        combination_group_id: "combo-2025-a",
      }),
      createRequest({
        id: "a-combo-sick-2025",
        request_no: "QJ-2025-00002",
        user_id: "employee-a",
        leave_type_code: "sick",
        leave_type_name: "病假",
        start_date: "2025-03-04",
        end_date: "2025-03-04",
        end_half: "morning",
        total_days: 0.5,
        target_year: 2025,
        target_year_days: 0.5,
        application_kind: "combined",
        combination_group_id: "combo-2025-a",
      }),
      createRequest({
        id: "a-2026",
        request_no: "QJ-2026-00001",
        user_id: "employee-a",
        target_year: 2026,
        target_year_days: 2,
      }),
      createRequest({
        id: "b-2026",
        request_no: "QJ-2026-00002",
        user_id: "employee-b",
        applicant_name: "员工乙",
        target_year: 2026,
        target_year_days: 0.5,
      }),
    ];

    const result = buildLeaveEmployeeStatistics(
      2026,
      [
        {
          user_id: "employee-a",
          name: "员工甲",
          department: "工程部",
          statistics_year: 2025,
        },
        {
          user_id: "employee-b",
          name: "员工乙",
          department: "市场部",
          statistics_year: 2025,
        },
        {
          user_id: "employee-a",
          name: "员工甲",
          department: "工程部",
          statistics_year: 2026,
        },
        {
          user_id: "employee-b",
          name: "员工乙",
          department: "市场部",
          statistics_year: 2026,
        },
      ],
      requests,
      [],
      {
        manager: { id: "manager-1", name: "总经理甲", roleLabel: "总经理" },
        comparisonYears: [2025, 2026],
        generatedAt: "2026-09-18T00:00:00.000Z",
      },
    );

    expect(result.annualComparison).toEqual([
      {
        year: 2025,
        employeeCount: 2,
        approvedRequestCount: 1,
        approvedLeaveDays: 1.5,
      },
      {
        year: 2026,
        employeeCount: 2,
        approvedRequestCount: 2,
        approvedLeaveDays: 2.5,
      },
    ]);
    expect(
      result.employees.find((employee) => employee.userId === "employee-a")
        ?.annualTrend,
    ).toEqual([
      { year: 2025, approvedRequestCount: 1, approvedLeaveDays: 1.5 },
      { year: 2026, approvedRequestCount: 1, approvedLeaveDays: 2 },
    ]);
    expect(
      result.employees.find((employee) => employee.userId === "employee-b")
        ?.annualTrend,
    ).toEqual([
      { year: 2025, approvedRequestCount: 0, approvedLeaveDays: 0 },
      { year: 2026, approvedRequestCount: 1, approvedLeaveDays: 0.5 },
    ]);
  });

  it("复用同一批申请和节假日数据生成固定十二个月趋势，并按月去重组合申请", () => {
    const sourceRows = [
      createSourceRequest(
        {
          id: "combo-annual",
          request_no: "QJ-2026-00001",
          user_id: "employee-a",
          start_date: "2026-01-30",
          end_date: "2026-01-31",
          total_days: 2,
          application_kind: "combined",
          combination_group_id: "combo-a",
        },
        JSON.stringify([{ year: 2026, days: 2 }]),
      ),
      createSourceRequest(
        {
          id: "combo-sick-1",
          request_no: "QJ-2026-00002",
          user_id: "employee-a",
          leave_type_code: "sick",
          leave_type_name: "病假",
          start_date: "2026-02-02",
          end_date: "2026-02-02",
          total_days: 1,
          application_kind: "combined",
          combination_group_id: "combo-a",
        },
        JSON.stringify([{ year: 2026, days: 1 }]),
      ),
      createSourceRequest(
        {
          id: "combo-sick-2",
          request_no: "QJ-2026-00003",
          user_id: "employee-a",
          leave_type_code: "sick",
          leave_type_name: "病假",
          start_date: "2026-02-03",
          end_date: "2026-02-03",
          end_half: "morning",
          total_days: 0.5,
          application_kind: "combined",
          combination_group_id: "combo-a",
        },
        JSON.stringify([{ year: 2026, days: 0.5 }]),
      ),
      createSourceRequest(
        {
          id: "cross-month",
          request_no: "QJ-2026-00004",
          user_id: "employee-a",
          start_date: "2026-02-27",
          end_date: "2026-03-02",
          total_days: 2,
        },
        JSON.stringify([{ year: 2026, days: 2 }]),
      ),
      createSourceRequest(
        {
          id: "cross-year",
          request_no: "QJ-2025-00005",
          user_id: "employee-a",
          start_date: "2025-12-31",
          end_date: "2026-01-02",
          total_days: 2,
        },
        JSON.stringify([
          { year: 2025, days: 1 },
          { year: 2026, days: 1 },
        ]),
      ),
    ];
    const leaveSchedule = [
      { date: "2026-01-01", type: "holiday" as const },
      { date: "2026-01-31", type: "workday" as const },
    ];
    const requestRows = expandLeaveEmployeeStatisticsRequestRows(
      sourceRows,
      [2025, 2026],
      leaveSchedule,
    );
    const monthlyRequestRows = expandLeaveEmployeeStatisticsMonthlyRequestRows(
      sourceRows,
      2026,
      leaveSchedule,
    );

    expect(
      monthlyRequestRows.map((row) => [
        row.id,
        row.target_month,
        row.target_month_days,
      ]),
    ).toEqual([
      ["combo-annual", "2026-01", 2],
      ["combo-sick-1", "2026-02", 1],
      ["combo-sick-2", "2026-02", 0.5],
      ["cross-month", "2026-02", 1],
      ["cross-month", "2026-03", 1],
      ["cross-year", "2026-01", 1],
    ]);

    const result = buildLeaveEmployeeStatistics(
      2026,
      [
        {
          user_id: "employee-a",
          name: "员工甲",
          department: "工程部",
          statistics_year: 2025,
        },
        {
          user_id: "employee-b",
          name: "员工乙",
          department: "市场部",
          statistics_year: 2025,
        },
        {
          user_id: "employee-a",
          name: "员工甲",
          department: "工程部",
          statistics_year: 2026,
        },
        {
          user_id: "employee-b",
          name: "员工乙",
          department: "市场部",
          statistics_year: 2026,
        },
      ],
      requestRows,
      [],
      {
        manager: { id: "manager-1", name: "总经理甲", roleLabel: "总经理" },
        comparisonYears: [2025, 2026],
        monthlyRequestRows,
        generatedAt: "2026-09-18T00:00:00.000Z",
      },
    );

    expect(result.monthlyComparison).toHaveLength(12);
    expect(result.monthlyComparison.slice(0, 3)).toEqual([
      {
        month: "2026-01",
        approvedRequestCount: 2,
        approvedLeaveDays: 3,
      },
      {
        month: "2026-02",
        approvedRequestCount: 2,
        approvedLeaveDays: 2.5,
      },
      {
        month: "2026-03",
        approvedRequestCount: 1,
        approvedLeaveDays: 1,
      },
    ]);
    expect(result.monthlyComparison[11]).toEqual({
      month: "2026-12",
      approvedRequestCount: 0,
      approvedLeaveDays: 0,
    });

    const employeeA = result.employees.find(
      (employee) => employee.userId === "employee-a",
    );
    expect(employeeA?.monthlyTrend).toHaveLength(12);
    expect(employeeA?.monthlyTrend[1]).toEqual({
      month: "2026-02",
      approvedRequestCount: 2,
      approvedLeaveDays: 2.5,
      typeSummaries: [
        {
          leaveTypeCode: "sick",
          leaveTypeName: "病假",
          requestCount: 1,
          totalDays: 1.5,
        },
        {
          leaveTypeCode: "annual",
          leaveTypeName: "年假",
          requestCount: 1,
          totalDays: 1,
        },
      ],
    });
    expect(
      result.employees
        .find((employee) => employee.userId === "employee-b")
        ?.monthlyTrend.every(
          (point) =>
            point.approvedRequestCount === 0 &&
            point.approvedLeaveDays === 0 &&
            point.typeSummaries.length === 0,
        ),
    ).toBe(true);
  });

  it("月度拆分以保存的年度分配守恒，并按时间补足或截取当前日历半天", () => {
    const snapshotMoreThanCurrent = createSourceRequest(
      {
        id: "snapshot-more-than-current",
        request_no: "QJ-2026-00010",
        user_id: "employee-a",
        start_date: "2026-01-30",
        end_date: "2026-02-02",
        total_days: 2,
      },
      JSON.stringify([{ year: 2026, days: 2 }]),
    );
    const supplementedRows = expandLeaveEmployeeStatisticsMonthlyRequestRows(
      [snapshotMoreThanCurrent],
      2026,
      [{ date: "2026-02-02", type: "holiday" }],
    );

    expect(supplementedRows).toEqual([
      expect.objectContaining({
        id: "snapshot-more-than-current",
        target_month: "2026-01",
        target_month_days: 2,
      }),
    ]);
    expect(
      supplementedRows.reduce((sum, row) => sum + row.target_month_days, 0),
    ).toBe(2);

    const snapshotLessThanCurrent = createSourceRequest(
      {
        id: "snapshot-less-than-current",
        request_no: "QJ-2026-00011",
        user_id: "employee-a",
        start_date: "2026-01-30",
        end_date: "2026-02-02",
        total_days: 1,
      },
      JSON.stringify([{ year: 2026, days: 1 }]),
    );
    const truncatedRows = expandLeaveEmployeeStatisticsMonthlyRequestRows(
      [snapshotLessThanCurrent],
      2026,
      [],
    );

    expect(truncatedRows).toEqual([
      expect.objectContaining({
        id: "snapshot-less-than-current",
        target_month: "2026-01",
        target_month_days: 1,
      }),
    ]);
    expect(
      truncatedRows.reduce((sum, row) => sum + row.target_month_days, 0),
    ).toBe(1);
  });

  it("将总经理本人纳入排名、历年趋势、类型分布、余额和逐次明细", () => {
    const result = buildLeaveEmployeeStatistics(
      2026,
      [
        {
          user_id: "manager-1",
          name: "总经理甲",
          department: "管理层",
          statistics_year: 2025,
        },
        {
          user_id: "employee-a",
          name: "员工甲",
          department: "工程部",
          statistics_year: 2025,
        },
        {
          user_id: "manager-1",
          name: "总经理甲",
          department: "管理层",
          statistics_year: 2026,
        },
        {
          user_id: "employee-a",
          name: "员工甲",
          department: "工程部",
          statistics_year: 2026,
        },
      ],
      [
        createRequest({
          id: "manager-self-2025",
          request_no: "QJ-2025-00001",
          user_id: "manager-1",
          applicant_name: "总经理甲",
          applicant_department: "管理层",
          leave_type_code: "sick",
          leave_type_name: "病假",
          start_date: "2025-11-03",
          end_date: "2025-11-03",
          end_half: "morning",
          total_days: 0.5,
          target_year: 2025,
          target_year_days: 0.5,
        }),
        createRequest({
          id: "manager-self-2026",
          request_no: "QJ-2026-00001",
          user_id: "manager-1",
          applicant_name: "总经理甲",
          applicant_department: "管理层",
          total_days: 2,
          target_year: 2026,
          target_year_days: 2,
        }),
        createRequest({
          id: "employee-2026",
          request_no: "QJ-2026-00002",
          user_id: "employee-a",
          target_year: 2026,
          target_year_days: 1,
        }),
      ],
      [
        {
          user_id: "manager-1",
          leave_type_code: "annual",
          leave_type_name: "年假",
          requires_balance_check: true,
          total_days: 10,
          used_days: 2,
          pending_days: 0,
        },
        {
          user_id: "manager-1",
          leave_type_code: "other",
          leave_type_name: "其他请假",
          requires_balance_check: false,
          total_days: null,
          used_days: null,
          pending_days: null,
        },
      ],
      {
        manager: { id: "manager-1", name: "总经理甲", roleLabel: "总经理" },
        comparisonYears: [2025, 2026],
        generatedAt: "2026-09-18T00:00:00.000Z",
      },
    );

    expect(result.annualComparison).toEqual([
      {
        year: 2025,
        employeeCount: 2,
        approvedRequestCount: 1,
        approvedLeaveDays: 0.5,
      },
      {
        year: 2026,
        employeeCount: 2,
        approvedRequestCount: 2,
        approvedLeaveDays: 3,
      },
    ]);
    expect(result.summary).toEqual({
      employeeCount: 2,
      approvedRequestCount: 2,
      approvedLeaveDays: 3,
    });

    const manager = result.employees.find(
      (employee) => employee.userId === "manager-1",
    );
    expect(manager).toMatchObject({
      rank: 1,
      name: "总经理甲",
      department: "管理层",
      approvedRequestCount: 1,
      approvedLeaveDays: 2,
      paidLeaveTotalDays: 10,
      paidLeaveUsedDays: 2,
      paidLeaveRemainingDays: 8,
    });
    expect(manager?.balanceSummaries).toEqual([
      {
        leaveTypeCode: "annual",
        leaveTypeName: "年假",
        requiresBalanceCheck: true,
        unlimited: false,
        totalDays: 10,
        usedDays: 2,
        pendingDays: 0,
        remainingDays: 8,
      },
      {
        leaveTypeCode: "other",
        leaveTypeName: "其他请假",
        requiresBalanceCheck: false,
        unlimited: true,
        totalDays: null,
        usedDays: null,
        pendingDays: null,
        remainingDays: null,
      },
    ]);
    expect(manager?.annualTrend).toEqual([
      { year: 2025, approvedRequestCount: 1, approvedLeaveDays: 0.5 },
      { year: 2026, approvedRequestCount: 1, approvedLeaveDays: 2 },
    ]);
    expect(manager?.typeSummaries).toEqual([
      {
        leaveTypeCode: "annual",
        leaveTypeName: "年假",
        requestCount: 1,
        totalDays: 2,
      },
    ]);
    expect(manager?.requests).toHaveLength(1);
    expect(manager?.requests[0]).toMatchObject({
      id: "manager-self-2026",
      requestNo: "QJ-2026-00001",
      totalDays: 2,
    });
  });

  it("跨年分配优先使用已保存数据，旧申请通过同一份节假日数据回退计算", () => {
    const expanded = expandLeaveEmployeeStatisticsRequestRows(
      [
        createSourceRequest(
          {
            id: "stored-cross-year",
            request_no: "QJ-2025-00001",
            user_id: "employee-a",
            start_date: "2025-12-31",
            end_date: "2026-01-02",
            total_days: 2,
          },
          JSON.stringify([
            { year: 2025, days: 0.5 },
            { year: 2026, days: 1.5 },
          ]),
        ),
        createSourceRequest(
          {
            id: "legacy-cross-year",
            request_no: "QJ-2025-00002",
            user_id: "employee-b",
            start_date: "2025-12-31",
            end_date: "2026-01-02",
            total_days: 2,
          },
          null,
        ),
      ],
      [2025, 2026],
      [{ date: "2026-01-01", type: "holiday" }],
    );

    expect(
      expanded.map((row) => [row.id, row.target_year, row.target_year_days]),
    ).toEqual([
      ["stored-cross-year", 2025, 0.5],
      ["stored-cross-year", 2026, 1.5],
      ["legacy-cross-year", 2025, 1],
      ["legacy-cross-year", 2026, 1],
    ]);
  });

  it("接口只纳入总经理本人及其非总经理审批对象，并保持只读统计", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/leave.ts"),
      "utf8",
    );
    const start = source.indexOf("router.get('/employee-statistics'");
    const end = source.indexOf("// 审批通过", start);
    const route = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(route).toContain(
      "router.get('/employee-statistics', requireLeaveStatisticsViewer",
    );
    expect(route).toContain("lr.user_id = ?");
    expect(route).toContain("lr.approver_id = ?");
    expect(route).toContain("lr.user_id <> ?");
    expect(route).toContain("u.role <> 'general_manager'");
    expect(route).toContain("lr.status = 'approved'");
    expect(route).toContain("next_version.original_id = lr.id");
    expect(route).toContain("comparisonYearCount = Math.min(5, year - 1999)");
    expect(route).toContain("expandLeaveEmployeeStatisticsRequestRows(");
    expect(route).toContain("expandLeaveEmployeeStatisticsMonthlyRequestRows(");
    expect(route).toContain("sourceRows,\n      year,\n      leaveSchedule");
    expect(route).toContain("monthlyRequestRows,");
    expect(route).toContain("FROM holidays");
    expect(route).toContain("role IN ('general_manager', 'super_admin')");
    expect(route).toContain("const activeManagers = await db");
    expect(route).toContain("const managerIds = statisticsViewer.role === 'super_admin'");
    expect(route).toContain("lr.user_id = ANY(?::text[])");
    expect(route).toContain("lr.approver_id = ANY(?::text[])");
    expect(route).toContain("u.role <> 'general_manager'");
    expect(route).toContain("user_id: statisticsViewer.id");
    expect(route).toContain("name: statisticsViewer.name");
    expect(route).toContain("department: statisticsViewer.department");
    expect(route).toContain("primaryManagerId === userId");
    expect(route).toContain("scopedEmployees.push(");
    expect(route).toContain("SELECT code, name, requires_balance_check");
    expect(route).toContain("WHERE is_active = true");
    expect(route).not.toContain(
      "is_active = true AND requires_balance_check = true",
    );
    expect(route).toContain("if (!type.requires_balance_check)");
    expect(route).toContain("total_days: null");
    expect(route).toContain("const calculatedAnnualTotal");
    expect(route).toContain("const totalDays = stored");
    expect(route).toContain("for (const employeeId of employeeIds)");
    expect(route).toContain("profile?.gender === 'male'");
    expect(route).toContain("new Set(['maternity'])");
    expect(route).toContain("profile?.gender === 'female'");
    expect(route).toContain("new Set(['paternity'])");
    expect(route).toContain("if (excludedCodes.has(type.code)) continue");
    expect(route).toContain("role IN ('user', 'admin')");
    expect(route).toContain("user_id = ANY(?::text[])");
    expect(route).not.toContain("getStoredBalanceAllocations(sourceRow)");
    expect(route).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/);
    expect(route).not.toContain("ensureLeaveBalance");
  });
});
