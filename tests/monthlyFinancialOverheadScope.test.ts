/** @jest-environment node */
import {
  financialOverheadScopeEvidence,
  type FinancialOverheadScopeSource,
} from "../server/services/monthlyFinancialOverheadScope";
import { loadFinancialAnalysisSources } from "../server/services/monthlyFinancialAnalysisSources";
import type { AnalysisOverheadAllocation } from "../server/services/monthlyFinancialAnalysis";

function candidate(
  overrides: Partial<FinancialOverheadScopeSource> = {},
): FinancialOverheadScopeSource {
  return {
    id: "payment-one",
    kind: "payment",
    date: "2026-08-01",
    amount: "100",
    title: "名称不参与范围判断",
    expenseCategory: "rent",
    rawMatchCount: "1",
    ...overrides,
  };
}
function allocation(
  overrides: Partial<AnalysisOverheadAllocation> = {},
): AnalysisOverheadAllocation {
  return {
    id: "match-one",
    paymentId: "payment-one",
    paymentKind: "payment",
    date: "2026-08-01",
    paymentAmount: "100",
    amount: "100",
    currency: "CNY",
    invoiceId: "invoice-one",
    invoiceAmount: "100",
    title: "名称不参与范围判断",
    updatedAt: "2026-08-01T01:00:00Z",
    lines: [
      { id: "line-one", category: "rent", amount: "100", verified: true },
    ],
    ...overrides,
  };
}

describe("仅房租分摊的可核验范围证据", () => {
  it.each([
    "car_rental",
    "parking",
    "internet",
    "property_management",
    "electricity",
    "system_maintenance",
  ])(
    "已确认付款明确类别%s且无票款关联时可证明范围外，不依赖中文标题",
    (expenseCategory) => {
      const result = financialOverheadScopeEvidence(
        candidate({
          expenseCategory,
          rawMatchCount: "0",
          title: "房租物业电费系统维护",
        }),
        [],
      );
      expect(result.scopeCoverage).toBe("excluded");
      expect(result.scopeReason).toContain("结构化费用类别");
    },
  );

  it("只有标题、未分类或其他费用没有租金明细证据时均排除，不扩大房租范围", () => {
    for (const title of [
      "车辆租赁780",
      "网络服务11000",
      "停车位9600",
      "房租系统维护",
    ])
      expect(
        financialOverheadScopeEvidence(
          candidate({ title, expenseCategory: "other", rawMatchCount: "0" }),
          [],
        ).scopeCoverage,
      ).toBe("excluded");
    expect(
      financialOverheadScopeEvidence(
        candidate({
          kind: "external_payment",
          expenseCategory: null,
          rawMatchCount: "0",
        }),
        [],
      ).scopeCoverage,
    ).toBe("excluded");
    expect(
      financialOverheadScopeEvidence(
        candidate({ expenseCategory: "electricity", rawMatchCount: "0" }),
        [],
      ).scopeCoverage,
    ).toBe("excluded");
  });

  it("外部付款同样使用已确认的明确类别，停车和网络排除而租金仍待完整票款分配", () => {
    for (const expenseCategory of ["parking", "internet"])
      expect(
        financialOverheadScopeEvidence(
          candidate({
            kind: "external_payment",
            expenseCategory,
            rawMatchCount: "0",
          }),
          [],
        ).scopeCoverage,
      ).toBe("excluded");
    expect(
      financialOverheadScopeEvidence(
        candidate({
          kind: "external_payment",
          expenseCategory: "rent",
          rawMatchCount: "0",
        }),
        [],
      ).scopeCoverage,
    ).toBe("included");
    expect(
      financialOverheadScopeEvidence(
        candidate({ kind: "external_payment", expenseCategory: "parking" }),
        [
          allocation({
            paymentKind: "external_payment",
            lines: [
              {
                id: "line-one",
                category: "rent",
                amount: "100",
                verified: true,
              },
            ],
          }),
        ],
      ).scopeCoverage,
    ).toBe("unknown");
  });

  it("明确租金没有完整关联计数或存在未加载票据时不能当成没有房租", () => {
    for (const rawMatchCount of [undefined, "无效", "1"])
      expect(
        financialOverheadScopeEvidence(candidate({ rawMatchCount }), [])
          .scopeCoverage,
      ).toBe("unknown");
    expect(
      financialOverheadScopeEvidence(candidate({ rawMatchCount: "2" }), [
        allocation(),
      ]).scopeCoverage,
    ).toBe("unknown");
  });

  it("明确范围外的老付款不因未加载发票行而失效，外部付款同样保留已确认类别", () => {
    for (const kind of ["payment", "external_payment"])
      for (const rawMatchCount of [undefined, "1", "3"])
        expect(
          financialOverheadScopeEvidence(
            candidate({ kind, expenseCategory: "car_rental", rawMatchCount }),
            [],
          ).scopeCoverage,
        ).toBe("excluded");
    const unknownInvoice = allocation({
      paymentKind: "external_payment",
      lines: [
        {
          id: "uncertain",
          category: "pending_review",
          amount: "100",
          verified: false,
        },
      ],
    });
    expect(
      financialOverheadScopeEvidence(
        candidate({
          kind: "external_payment",
          expenseCategory: "internet",
          rawMatchCount: "2",
        }),
        [unknownInvoice],
      ).scopeCoverage,
    ).toBe("excluded");
    expect(
      financialOverheadScopeEvidence(
        candidate({
          kind: "external_payment",
          expenseCategory: "other",
          rawMatchCount: "2",
        }),
        [unknownInvoice],
      ).scopeCoverage,
    ).toBe("excluded");
    expect(
      financialOverheadScopeEvidence(
        candidate({
          kind: "external_payment",
          expenseCategory: "rent",
          rawMatchCount: "2",
        }),
        [unknownInvoice],
      ).scopeCoverage,
    ).toBe("unknown");
  });

  it("非房租类别遇到部分已核验租金正金额仍冲突，不能被未加载其余行掩盖", () => {
    for (const kind of ["payment", "external_payment"]) {
      const conflicting = allocation({
        paymentKind: kind,
        lines: [
          {
            id: "shared",
            category: "rent",
            amount: "0.000000000001",
            verified: true,
          },
        ],
      });
      const result = financialOverheadScopeEvidence(
        candidate({ kind, expenseCategory: "parking", rawMatchCount: "2" }),
        [conflicting],
      );
      expect(result.scopeCoverage).toBe("unknown");
      expect(result.scopeReason).toContain("冲突");
      expect(result.scopeConflict).toBe(true);
      expect(
        financialOverheadScopeEvidence(
          candidate({ kind, expenseCategory: "parking", rawMatchCount: "2" }),
          [
            {
              ...conflicting,
              lines: [{ ...conflicting.lines[0], verified: false }],
            },
          ],
        ).scopeCoverage,
      ).toBe("excluded");
    }
  });

  it("非租金记录缺日期或关联计数仍在范围外，未分类付款须有真实租金明细才进入核验", () => {
    for (const expenseCategory of [
      null,
      "other",
      "property_management",
      "electricity",
      "system_maintenance",
      "car_rental",
      "parking",
      "internet",
    ])
      expect(
        financialOverheadScopeEvidence(
          candidate({
            expenseCategory,
            date: "",
            rawMatchCount: undefined,
            title: "办公房租",
          }),
          [],
        ),
      ).toMatchObject({ scopeCoverage: "excluded" });
    for (const expenseCategory of [null, "other"])
      expect(
        financialOverheadScopeEvidence(candidate({ expenseCategory }), [
          allocation(),
        ]),
      ).toMatchObject({ scopeCoverage: "included" });
    const pendingRent = allocation({
      lines: [
        {
          id: "pending-rent",
          category: "rent",
          amount: "100",
          verified: false,
        },
      ],
    });
    expect(
      financialOverheadScopeEvidence(candidate({ expenseCategory: "other" }), [
        pendingRent,
      ]).scopeCoverage,
    ).toBe("unknown");
    expect(
      financialOverheadScopeEvidence(
        candidate({ expenseCategory: "electricity" }),
        [pendingRent],
      ).scopeCoverage,
    ).toBe("excluded");
  });

  it("网络付款与已核验租金300的矛盾明确禁止已知分配，两种付款及未全加载场景一致", () => {
    for (const kind of ["payment", "external_payment"])
      for (const rawMatchCount of ["1", "2"]) {
        const rent = allocation({
          paymentKind: kind,
          paymentAmount: "1000",
          amount: "300",
          invoiceAmount: "300",
          lines: [
            { id: "rent", category: "rent", amount: "300", verified: true },
          ],
        });
        expect(
          financialOverheadScopeEvidence(
            candidate({
              kind,
              amount: "1000",
              expenseCategory: "internet",
              rawMatchCount,
            }),
            [rent],
          ),
        ).toMatchObject({ scopeCoverage: "unknown", scopeConflict: true });
      }
  });

  it("单纯部分匹配或尚未全加载不是冲突，保留可靠租金已知部分的资格", () => {
    const rent = allocation({
      paymentAmount: "1000",
      amount: "300",
      invoiceAmount: "300",
      lines: [{ id: "rent", category: "rent", amount: "300", verified: true }],
    });
    for (const rawMatchCount of [undefined, "1", "2"]) {
      const result = financialOverheadScopeEvidence(
        candidate({ amount: "1000", rawMatchCount }),
        [rent],
      );
      expect(result.scopeCoverage).toBe("unknown");
      expect(result.scopeConflict).not.toBe(true);
    }
    const unverified = allocation({
      lines: [
        {
          id: "uncertain",
          category: "pending_review",
          amount: "100",
          verified: false,
        },
      ],
    });
    expect(
      financialOverheadScopeEvidence(candidate(), [unverified]).scopeConflict,
    ).not.toBe(true);
    expect(
      financialOverheadScopeEvidence(candidate({ rawMatchCount: "0" }), [])
        .scopeConflict,
    ).not.toBe(true);
  });

  it("付款身份、日期、金额及已加载对应矛盾在来源不全时仍标真实冲突", () => {
    for (const overrides of [
      { id: "" },
      { date: "2026-02-30" },
      { amount: "-1" },
      { kind: "未知" },
    ])
      expect(
        financialOverheadScopeEvidence(candidate(overrides), []).scopeConflict,
      ).toBe(true);
    for (const row of [
      allocation({ date: "2026-07-31" }),
      allocation({ amount: "-1" }),
      allocation({ paymentAmount: "99" }),
      allocation({ id: "" }),
    ])
      expect(
        financialOverheadScopeEvidence(candidate({ rawMatchCount: "2" }), [row])
          .scopeConflict,
      ).toBe(true);
    expect(
      financialOverheadScopeEvidence(candidate({ rawMatchCount: "2" }), [
        allocation(),
        allocation(),
      ]).scopeConflict,
    ).toBe(true);
    expect(
      financialOverheadScopeEvidence(candidate(), [
        allocation({ amount: "100.01" }),
      ]).scopeConflict,
    ).toBe(true);
    expect(
      financialOverheadScopeEvidence(candidate(), [
        allocation({
          lines: [
            {
              id: "bad-total",
              category: "other_cost",
              amount: "99",
              verified: true,
            },
          ],
        }),
      ]).scopeConflict,
    ).toBe(true);
  });

  it("来源直接传递机器可读冲突标记，不从中文原因反推", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('AS "rawMatchCount"'))
          return { rows: [candidate({ expenseCategory: "internet" })] };
        if (sql.includes('AS "paymentId"'))
          return {
            rows: [
              allocation({
                lines: [
                  {
                    id: "rent",
                    category: "rent",
                    amount: "100",
                    verified: true,
                  },
                ],
              }),
            ],
          };
        return { rows: [] };
      }),
    };
    const result = await loadFinancialAnalysisSources(
      { from: "2026-08", to: "2026-08", granularity: "month" },
      { queryClient: client as never, loadReport: jest.fn() },
    );
    expect(result.overheadCandidates?.[0]).toMatchObject({
      id: "payment-one",
      kind: "payment",
      scopeCoverage: "unknown",
      scopeConflict: true,
    });
    expect(result.overheadAllocations?.[0].amount).toBe("100");
  });

  it("其他费用没有租金证据时排除，保留原始非租金发票行及金额", () => {
    const rows = [
      allocation({
        lines: [
          {
            id: "other-line",
            category: "other_cost",
            amount: "100",
            verified: true,
          },
        ],
      }),
    ];
    const before = JSON.stringify(rows);
    const result = financialOverheadScopeEvidence(
      candidate({ expenseCategory: "other" }),
      rows,
    );
    expect(result.scopeCoverage).toBe("excluded");
    expect(result.scopeReason).toContain(
      "没有结构化租金类别或租金发票明细证据",
    );
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("混合发票保留全部行与原金额，极大额和十二位小数精确闭合", () => {
    const total = "999999999999999999.000000000003";
    const rows = [
      allocation({
        paymentAmount: total,
        amount: total,
        invoiceAmount: total,
        lines: [
          {
            id: "shared",
            category: "rent",
            amount: "0.000000000001",
            verified: true,
          },
          {
            id: "other",
            category: "other_cost",
            amount: "999999999999999999.000000000002",
            verified: true,
          },
        ],
      }),
    ];
    const before = JSON.stringify(rows);
    const result = financialOverheadScopeEvidence(
      candidate({ amount: total }),
      rows,
    );
    expect(result.scopeCoverage).toBe("included");
    expect(result.scopeReason).toContain("不先剔除范围外行");
    expect(rows[0].lines).toHaveLength(2);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("部分票款匹配和多分配一分都不能以已核验片段排除剩余范围", () => {
    expect(
      financialOverheadScopeEvidence(candidate(), [
        allocation({ amount: "99.99" }),
      ]).scopeCoverage,
    ).toBe("unknown");
    expect(
      financialOverheadScopeEvidence(candidate(), [
        allocation({ amount: "100.01" }),
      ]).scopeCoverage,
    ).toBe("unknown");
  });

  it.each([
    allocation({ lines: [] }),
    allocation({
      lines: [
        {
          id: "line-one",
          category: "other_cost",
          amount: "100",
          verified: false,
        },
      ],
    }),
    allocation({
      lines: [
        {
          id: "line-one",
          category: "pending_review",
          amount: "100",
          verified: true,
        },
      ],
    }),
    allocation({
      lines: [
        {
          id: "line-one",
          category: "other_cost",
          amount: "99.99",
          verified: true,
        },
      ],
    }),
    allocation({
      lines: [
        {
          id: "line-one",
          category: "other_cost",
          amount: "-100",
          verified: true,
        },
      ],
    }),
    allocation({ date: "2026-07-31" }),
    allocation({ paymentAmount: "200" }),
    allocation({ invoiceAmount: undefined }),
  ])("未核验、不闭合或缺失证据保持未知", (row) => {
    expect(
      financialOverheadScopeEvidence(candidate(), [row]).scopeCoverage,
    ).toBe("unknown");
  });

  it("非租金付款遇真实租金行仍冲突，租赁合同的完整非租金付款排除", () => {
    const shared = allocation({
      lines: [
        { id: "shared", category: "rent", amount: "100", verified: true },
      ],
    });
    const first = financialOverheadScopeEvidence(
      candidate({ expenseCategory: "car_rental" }),
      [shared],
    );
    const second = financialOverheadScopeEvidence(
      candidate({ expenseCategory: "rent" }),
      [
        allocation({
          lines: [
            {
              id: "other-line",
              category: "other_cost",
              amount: "100",
              verified: true,
            },
          ],
        }),
      ],
    );
    expect(first.scopeCoverage).toBe("unknown");
    expect(second.scopeCoverage).toBe("excluded");
    expect(first.scopeReason).toContain("冲突");
  });

  it.each([
    "electricity",
    "system_maintenance",
    "property_management",
    "other_cost",
  ])(
    "租金付款类别下全额票款闭合且仅有已核验%s时排除，不完整仍待核验",
    (category) => {
      const row = allocation({
        lines: [{ id: "non-rent", category, amount: "100", verified: true }],
      });
      expect(
        financialOverheadScopeEvidence(candidate(), [row]).scopeCoverage,
      ).toBe("excluded");
      expect(
        financialOverheadScopeEvidence(candidate({ rawMatchCount: "2" }), [row])
          .scopeCoverage,
      ).toBe("unknown");
      expect(
        financialOverheadScopeEvidence(candidate(), [{ ...row, amount: "99" }])
          .scopeCoverage,
      ).toBe("unknown");
      expect(
        financialOverheadScopeEvidence(candidate(), [
          { ...row, lines: [{ ...row.lines[0], verified: false }] },
        ]).scopeCoverage,
      ).toBe("unknown");
    },
  );

  it("重复匹配或跨次同发票超额、分类冲突不会证明范围外", () => {
    const first = allocation({ amount: "60", paymentAmount: "60" });
    const later = allocation({
      id: "match-two",
      paymentId: "payment-two",
      amount: "50",
      paymentAmount: "50",
    });
    expect(
      financialOverheadScopeEvidence(candidate({ amount: "60" }), [
        first,
        later,
      ]).scopeCoverage,
    ).toBe("unknown");
    expect(
      financialOverheadScopeEvidence(
        candidate({ rawMatchCount: "2", amount: "200" }),
        [
          allocation({ paymentAmount: "200" }),
          allocation({ paymentAmount: "200" }),
        ],
      ).scopeCoverage,
    ).toBe("unknown");
    const conflicting = allocation({
      id: "match-two",
      paymentId: "payment-two",
      amount: "40",
      paymentAmount: "40",
      lines: [
        {
          id: "line-one",
          category: "electricity",
          amount: "100",
          verified: true,
        },
      ],
    });
    expect(
      financialOverheadScopeEvidence(candidate({ amount: "60" }), [
        first,
        conflicting,
      ]).scopeCoverage,
    ).toBe("unknown");
  });

  it("同编号不同付款种类分别核验，不借另一种付款的票款证据", () => {
    const external = allocation({ paymentKind: "external_payment" });
    expect(
      financialOverheadScopeEvidence(candidate(), [external]).scopeCoverage,
    ).toBe("unknown");
    expect(
      financialOverheadScopeEvidence(candidate({ kind: "external_payment" }), [
        external,
      ]).scopeCoverage,
    ).toBe("included");
  });

  it("来源仅增加结构化类别及完整关联计数，不裁掉混合发票或扩宽确认边界", async () => {
    const mixed = allocation({
      lines: [
        { id: "rent", category: "rent", amount: "20", verified: true },
        { id: "other", category: "other_cost", amount: "80", verified: true },
      ],
    });
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('AS "rawMatchCount"')) return { rows: [candidate()] };
        if (sql.includes('AS "paymentId"')) return { rows: [mixed] };
        return { rows: [] };
      }),
    };
    const sources = await loadFinancialAnalysisSources(
      { from: "2026-08", to: "2026-08", granularity: "month" },
      {
        queryClient: client as never,
        loadReport: jest.fn(),
      },
    );
    const statement = client.query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes('AS "rawMatchCount"'))!;
    expect(statement).toContain(
      'payment.expense_category AS "expenseCategory"',
    );
    expect(statement).toContain("COUNT(scope_match.id)::text");
    expect(statement).toContain("scope_item.item_kind = payment.kind");
    expect(statement).toContain("scope_item.record_id = payment.id");
    expect(statement).toContain("payment.status = 'confirmed'");
    expect(statement).toContain(
      "root.is_deleted = FALSE AND contract.is_deleted = FALSE",
    );
    expect(statement).toContain(
      "COALESCE(root.category, root.declared_category) = 'asset'",
    );
    expect(statement).toContain(
      "status, expense_category, 'external_payment'::text AS kind FROM contract_external_payments",
    );
    expect(statement).not.toContain("NULL::text AS expense_category");
    expect(statement).not.toMatch(/LIKE|ILIKE|title\s*[=~]/u);
    expect(
      client.query.mock.calls.every(([sql]) => /^\s*SELECT\b/u.test(sql)),
    ).toBe(true);
    expect(sources.overheadCandidates?.[0]).toMatchObject({
      id: "payment-one",
      kind: "payment",
      amount: "100",
      scopeCoverage: "included",
    });
    expect(sources.overheadCandidates?.[0]).not.toHaveProperty(
      "expenseCategory",
    );
    expect(sources.overheadCandidates?.[0]).not.toHaveProperty("rawMatchCount");
    expect(sources.overheadAllocations).toEqual([mixed]);
    expect(sources.overheadAllocations?.[0].lines).toHaveLength(2);
  });
});
