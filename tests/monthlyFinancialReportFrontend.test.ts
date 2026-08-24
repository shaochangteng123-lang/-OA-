import fs from "fs";
import path from "path";

jest.mock("@/utils/api", () => ({ api: {} }));

import { isMonthlyFinancialReportVersionConflict } from "../src/utils/monthlyFinancialReportApi";
import {
  aggregateAutomaticDetailsByPerson,
  isMonthlyFinancialAmountText,
  isPositiveMonthlyFinancialAmountText,
} from "../src/utils/monthlyFinancialReportPresentation";
import type { MonthlyFinancialAutomaticDetail } from "../src/types/monthlyFinancialReport";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("月度财务报表前端权限与金额口径", () => {
  const layoutSource = source("src/layouts/MainLayout.vue");
  const routerSource = source("src/router/index.ts");
  const pageSource = source("src/views/MonthlyFinancialReport.vue");
  const apiSource = source("src/utils/monthlyFinancialReportApi.ts");
  const presentationSource = source(
    "src/utils/monthlyFinancialReportPresentation.ts",
  );
  const typeSource = source("src/types/monthlyFinancialReport.ts");

  it("位于财务区审批中心下方且菜单精确限制管理员和总经理", () => {
    const financeStart = layoutSource.indexOf("<!-- 财务区 -->");
    const financeEnd = layoutSource.indexOf("<!-- 人力资源区 -->");
    const financeSection = layoutSource.slice(financeStart, financeEnd);

    expect(financeSection).toContain('path="/monthly-financial-report"');
    expect(financeSection).toContain('label="月度财务报表"');
    expect(financeSection).toContain('v-if="canViewMonthlyFinancialReport"');
    expect(
      financeSection.indexOf('path="/monthly-financial-report"'),
    ).toBeGreaterThan(financeSection.lastIndexOf('label="审批中心"'));
    expect(layoutSource).toContain('authStore.user?.role === "admin"');
    expect(layoutSource).toContain(
      'authStore.user?.role === "general_manager"',
    );
  });

  it("直接地址访问仅允许管理员和总经理", () => {
    const routeStart = routerSource.indexOf(
      'path: "/monthly-financial-report"',
    );
    const routeEnd = routerSource.indexOf("},", routeStart) + 2;
    const routeBlock = routerSource.slice(routeStart, routeEnd);

    expect(routeBlock).toContain('requiresRole: ["admin", "general_manager"]');
    expect(routeBlock).not.toContain('"boss"');
    expect(routeBlock).not.toContain('"super_admin"');
    expect(routeBlock).not.toContain('"chairman"');
  });

  it("管理员维护与月结，总经理只读且双方均可下载", () => {
    expect(pageSource).toContain(
      'const isAdminRole = computed(() => authStore.user?.role === "admin")',
    );
    expect(pageSource).toContain('authStore.user?.role === "general_manager"');
    expect(pageSource).toContain('v-if="canEdit"');
    expect(pageSource).toContain('v-if="canClose"');
    expect(pageSource).toContain('v-if="canReopen"');
    expect(pageSource).toContain('v-if="canDownload"');
    expect(pageSource).toContain("下载全部报表");
  });

  it("顶部月份与操作按钮使用三列等宽网格并适配窄屏", () => {
    expect(pageSource).toContain(".hero-actions {");
    expect(pageSource).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr))",
    );
    expect(pageSource).toContain("width: min(100%, 480px)");
    expect(pageSource).toContain(".hero-actions > *");
    expect(pageSource).toContain("min-width: 0 !important");
    expect(pageSource).toContain(
      ".hero-actions :deep(.el-date-editor.el-input)",
    );
    expect(pageSource).toContain("max-width: 100% !important");
    expect(pageSource).toContain("grid-template-columns: 1fr");
  });

  it("金额按字符串传输和展示且与后端保持18位整数和12位小数上限", () => {
    expect(typeSource).toContain("export type MonthlyFinancialAmount = string");
    expect(pageSource).not.toContain("toFixed(");
    expect(pageSource).not.toContain("minimumFractionDigits");
    expect(pageSource).not.toContain("maximumFractionDigits");
    expect(pageSource).toContain('inputmode="decimal"');
    expect(pageSource).toContain("整数最多18位、小数最多12位，不自动补零");
    expect(pageSource).toContain('maxlength="31"');
    expect(pageSource).toContain('maxlength="32"');
    expect(
      isMonthlyFinancialAmountText("999999999999999999.123456789012"),
    ).toBe(true);
    expect(isMonthlyFinancialAmountText("1000000000000000000")).toBe(false);
    expect(isMonthlyFinancialAmountText("1.1234567890123")).toBe(false);
    expect(isMonthlyFinancialAmountText("-1.2", true)).toBe(true);
    expect(isPositiveMonthlyFinancialAmountText("0.000000000001")).toBe(true);
    expect(isPositiveMonthlyFinancialAmountText("0.000000000000")).toBe(false);
  });

  it("手工项目按项目与方向合并单元格并分层显示汇总和明细", () => {
    expect(pageSource).toContain('class="manual-sheet"');
    expect(pageSource).toContain("manualSheetGroups");
    expect(pageSource).toContain('class="manual-category-row"');
    expect(pageSource).toContain("项目合计");
    expect(pageSource).toContain("<th>类型</th>");
    expect(pageSource).toContain('rowspan="2"');
    expect(pageSource).toContain("header-rowspan-cell");
    expect(pageSource).toContain(
      'v-for="(category, categoryIndex) in group.categories"',
    );
    expect(pageSource).toContain(':rowspan="category.entries.length + 1"');
    expect(pageSource).toContain("category-merged-cell");
    expect(pageSource).toContain("已添加 {{ category.entries.length }} 条明细");
    expect(pageSource).toContain('colspan="4"');
    expect(pageSource).toContain('v-if="categoryIndex > 0"');
    expect(pageSource).toContain('class="category-empty-merged-cell"');
    expect(pageSource).toContain("manual-sheet-layout-v2-");
    expect(pageSource).toContain("category.totalAmount");
    expect(pageSource).toContain("formatAmount(entry.item.amount)");
    expect(pageSource).toContain("manual-line-amount");
    expect(pageSource).toContain("font-weight: 400");
    expect(pageSource).toContain('@click="addManualItem(category)"');
    expect(pageSource).not.toContain("在此项目添加一行");
    expect(pageSource).not.toContain('class="manual-add-row"');
    expect(pageSource).toContain('@input="markManualItemsDirty"');
    expect(pageSource).not.toContain("openManualItemDialog");
    expect(pageSource).not.toContain("请选择项目分类");
  });

  it("账户与结算为四个账户分别展示流入和流出明细", () => {
    expect(pageSource).toContain('class="flow-columns account-card-flows"');
    expect(pageSource).toContain(
      'v-if="isAccountDetailsExpanded(account.code)"',
    );
    expect(pageSource).toContain("toggleAccountDetails(account.code)");
    expect(pageSource).toContain("展开明细");
    expect(pageSource).toContain("收起明细");
    expect(pageSource).toContain("accountFlowDetails");
    expect(pageSource).toContain("accountDetail(account.code)");
    expect(pageSource).toContain("流入明细");
    expect(pageSource).toContain("流出明细");
    for (const account of [
      'account("general")',
      'account("business")',
      'account("welfare_one")',
      'account("welfare_two")',
    ]) {
      expect(pageSource).toContain(account);
    }
  });

  it("顶部收入明确展示主营业务银行实际到账口径", () => {
    expect(pageSource).toContain('label: "当月实际到账合计"');
    expect(pageSource).toContain('note: "仅统计已确认主营业务银行回款"');
    expect(pageSource).toContain('label: "四账户净变化"');
    expect(pageSource).toContain("账户期末减期初，不等同于到账减支出");
    expect(pageSource).not.toContain('label: "当月流入合计"');
    expect(pageSource).not.toContain('note: "自动与手工收入"');
  });

  it("薪资按人显示到月份且三类报销按人员聚合当月类型总额", () => {
    expect(typeSource).toContain("automaticDetails");
    expect(typeSource).toContain("personId?: string | null");
    expect(typeSource).toContain("personName: string | null");
    expect(pageSource).toContain('class="person-detail-list"');
    expect(pageSource).toContain('"human_cost"');
    expect(pageSource).toContain('"basic_reimbursement"');
    expect(pageSource).toContain('"large_reimbursement"');
    expect(pageSource).toContain('"business_reimbursement"');
    expect(pageSource).toContain("person.personName");
    expect(pageSource).toContain("formatDetailMonth(person.occurredOn)");
    expect(pageSource).not.toContain("person.description");
    expect(pageSource).toContain("aggregateAutomaticDetailsByPerson");
    expect(presentationSource).toContain("addFinancialAmountTexts");
    expect(presentationSource).toContain("该类型当月总计");
  });

  it("同一人员同一报销类型只保留精确月度合计", () => {
    const detail = (
      sourceId: string,
      metric: string,
      personId: string | null,
      personName: string,
      amount: string,
    ): MonthlyFinancialAutomaticDetail => ({
      sourceType: "reimbursement",
      sourceId,
      occurredOn: "2026-08-10",
      accountCode: metric === "business_reimbursement" ? "business" : "general",
      metric,
      amount,
      description: `报销单${sourceId}`,
      personId,
      personName,
    });
    const result = aggregateAutomaticDetailsByPerson(
      [
        detail("1", "basic_reimbursement", "user-1", "张三", "40.1"),
        detail("2", "basic_reimbursement", "user-1", "张三", "59.9"),
        detail("3", "basic_reimbursement", "user-2", "李四", "30"),
        detail("4", "large_reimbursement", "user-1", "张三", "500"),
      ],
      "basic_reimbursement",
      "2026-08",
    );

    expect(result).toHaveLength(2);
    expect(result.find((item) => item.personName === "张三")?.amount).toBe(
      "100",
    );
    expect(result.find((item) => item.personName === "李四")?.amount).toBe(
      "30",
    );
    expect(result.every((item) => item.occurredOn === "2026-08-01")).toBe(true);
  });

  it("同名人员按稳定人员编号分开聚合且缺少编号时不误合并", () => {
    const details: MonthlyFinancialAutomaticDetail[] = [
      {
        sourceType: "reimbursement",
        sourceId: "source-1",
        occurredOn: "2026-08-01",
        accountCode: "general",
        metric: "basic_reimbursement",
        amount: "10",
        description: "报销一",
        personId: "user-1",
        personName: "同名人员",
      },
      {
        sourceType: "reimbursement",
        sourceId: "source-2",
        occurredOn: "2026-08-02",
        accountCode: "general",
        metric: "basic_reimbursement",
        amount: "20",
        description: "报销二",
        personId: "user-2",
        personName: "同名人员",
      },
      {
        sourceType: "reimbursement",
        sourceId: "source-3",
        occurredOn: "2026-08-03",
        accountCode: "general",
        metric: "basic_reimbursement",
        amount: "30",
        description: "报销三",
        personId: null,
        personName: "同名人员",
      },
      {
        sourceType: "reimbursement",
        sourceId: "source-4",
        occurredOn: "2026-08-04",
        accountCode: "general",
        metric: "basic_reimbursement",
        amount: "40",
        description: "报销四",
        personId: null,
        personName: "同名人员",
      },
    ];

    const result = aggregateAutomaticDetailsByPerson(
      details,
      "basic_reimbursement",
      "2026-08",
    );

    expect(result).toHaveLength(4);
    expect(result.map((item) => item.amount).sort()).toEqual([
      "10",
      "20",
      "30",
      "40",
    ]);
  });

  it("只把带精确业务码的409响应识别为版本冲突", () => {
    expect(
      isMonthlyFinancialReportVersionConflict({
        response: {
          status: 409,
          data: { code: "MONTHLY_FINANCE_VERSION_CONFLICT" },
        },
      }),
    ).toBe(true);
    expect(
      isMonthlyFinancialReportVersionConflict({
        response: { status: 409, data: { code: "MONTH_ALREADY_CLOSED" } },
      }),
    ).toBe(false);
    expect(
      isMonthlyFinancialReportVersionConflict({
        response: {
          status: 400,
          data: { code: "MONTHLY_FINANCE_VERSION_CONFLICT" },
        },
      }),
    ).toBe(false);
  });

  it("统一保护未保存草稿并拒绝跨月份写响应覆盖", () => {
    expect(pageSource).toContain('@click="handleReloadReport"');
    expect(pageSource).toContain("onBeforeRouteUpdate");
    expect(pageSource).toContain("onBeforeRouteLeave");
    expect(pageSource).toContain('window.addEventListener("beforeunload"');
    expect(pageSource).toContain("confirmDiscardUnsavedChanges");
    expect(pageSource).toContain("targetViewSequence !== monthViewSequence");
    expect(pageSource).toContain("nextReport.month !== context.month");
    expect(pageSource).toContain("本地未保存内容已保留");
    expect(pageSource).not.toContain(
      'ElMessage.warning("该月报已被其他操作更新，正在重新加载最新版本")',
    );
    const loadFailureBlock = pageSource.slice(
      pageSource.indexOf("async function loadReport"),
      pageSource.indexOf("async function handleMonthChange"),
    );
    expect(loadFailureBlock).not.toContain("manualItems.value = []");
    expect(loadFailureBlock).not.toContain("manualItemsDirty.value = false");
    expect(loadFailureBlock).not.toContain("report.value = null");
    expect(pageSource).toContain(
      ':disabled="actionLoading || hasUnsavedChanges"',
    );
  });

  it("重新开启原因前端限制为500字", () => {
    expect(pageSource).toContain("inputValidator: validateReopenReason");
    expect(pageSource).toContain("reason.length > 500");
    expect(pageSource).toContain("重新开启原因不能超过500字");
  });

  it("保存同步和重开向管理员展示受影响的后续月份", () => {
    expect(apiSource).toContain("MonthlyFinancialMutationResult");
    expect(apiSource).toContain("affectedMonths");
    expect(pageSource).toContain("mutationSuccessMessage");
    expect(pageSource).toContain("已标记为待重新核算");
  });

  it("已重新开启报表优先显示重新开启时间而不是旧月结时间", () => {
    expect(pageSource).toContain(
      'report.value.status === "reopened" && report.value.reopenedAt',
    );
    expect(pageSource).toContain("重新开启于");
  });

  it("六个接口携带月份、版本和完整下载响应", () => {
    for (const endpoint of [
      "`${monthPath(month)}/manual-items`",
      "`${monthPath(month)}/refresh`",
      "`${monthPath(month)}/close`",
      "`${monthPath(month)}/reopen`",
      "`${monthPath(month)}/export`",
    ]) {
      expect(apiSource).toContain(endpoint);
    }
    expect(apiSource).toContain("api.get<ApiEnvelope<MonthlyFinancialReport>>");
    expect(apiSource).toContain('responseType: "blob"');
    expect(apiSource).toContain("expectedVersion");
    expect(apiSource).toContain("openingBalances");
  });
});
