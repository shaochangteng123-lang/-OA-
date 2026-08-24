jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

import fs from "fs";
import path from "path";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { api } from "@/utils/api";
import ContractDashboard from "@/views/ContractDashboard.vue";
import {
  contractRatePercentToDecimal,
  createContractRates,
  getContractDashboard,
  getContractRates,
} from "@/utils/contractApi";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

describe("合同经营看板前端适配", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("统计范围筛选固定单行且窄屏仅横向滚动", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDashboard.vue"),
      "utf8",
    );
    expect(source).toMatch(
      /\.dashboard-filters\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/,
    );
    expect(source).toContain("flex: 0 0 300px");
    expect(source).toContain("flex: 0 0 240px");
    expect(source).not.toMatch(
      /\.dashboard-filters\s*\{\s*grid-template-columns:/,
    );
  });

  it("透传全部筛选并解析分类累计、结算状态和三期比较字段", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          generatedAt: "2026-08-04T08:00:00.000Z",
          startMonth: "2026-01",
          endMonth: "2026-08",
          summary: {
            totalCount: 2,
            contractCount: 2,
            allContractCount: 3,
            effectiveContractCount: 2,
            pendingSignatureContractCount: 1,
            contractAmount: 3000,
            allContractAmount: 3500,
            effectiveContractAmount: 3000,
            effectiveIncomeContractAmount: 2500,
            effectiveExpenseContractAmount: 500,
            pendingSignatureAmount: 500,
            effectiveIncomeContractCount: 1,
            effectiveExpenseContractCount: 1,
          },
          categories: [
            {
              category: "main_business",
              contract_count: 2,
              fixed_amount_contract_count: 1,
              no_fixed_amount_count: 1,
              total_amount: "3000.00",
              month_settled_amount: "500.00",
              cumulative_settled_amount: "2500.00",
              outstanding_amount: "500.00",
              completion_rate: 83.33,
            },
          ],
          risks: [],
          monthlyTrend: [],
          settlement_statuses: [
            {
              status: "partial",
              contract_count: 1,
              contract_amount: "3000.00",
              settled_amount: "2500.00",
              outstanding_amount: "500.00",
              contracts: [
                {
                  contract_id: "contract-1",
                  contract_name: "示例合同",
                  project_id: "project-1",
                  project_name: "示例项目",
                  category: "main_business",
                  contract_amount: "3000.00",
                  settled_amount: "2500.00",
                  outstanding_amount: "500.00",
                  completion_rate: 83.33,
                },
              ],
            },
          ],
          no_fixed_amount_contract_count: 1,
          period_comparison: {
            periods: [
              {
                key: "current",
                period: "2026-08",
                start_month: "2026-01",
                end_month: "2026-08",
                income_amount: "500.00",
                expense_amount: 300,
              },
              {
                key: "previous_period",
                period: "2025-05—2025-12",
                start_month: "2025-05",
                end_month: "2025-12",
                income_amount: 400,
                expense_amount: 0,
              },
              {
                key: "previous_year",
                period: "2025-01—2025-08",
                start_month: "2025-01",
                end_month: "2025-08",
                income_amount: 250,
                expense_amount: 200,
              },
            ],
            changes: {
              income_previous_period: {
                amount: 100,
                percentage: 25,
                comparable: true,
              },
              expense_previous_period: {
                amount: 300,
                percentage: null,
                comparable: false,
              },
              income_previous_year: {
                amount: 250,
                percentage: 100,
                comparable: true,
              },
              expense_previous_year: {
                amount: 100,
                percentage: 50,
                comparable: true,
              },
            },
          },
          mainBusiness: {
            contractAmount: 1000,
            totalContractAmount: 3000,
            monthReceiptAmount: 1000,
            cumulativeReceiptAmount: 2500,
            unreceivedAmount: 500,
            tax: 117.2,
            marketingReserve: 44.14,
            businessCost: 83.87,
            accountingBase: 754.79,
          },
          nonMain: {
            contractAmount: 2000,
            totalContractAmount: 5000,
            monthReceiptAmount: 2000,
            cumulativeReceiptAmount: 4000,
            unreceivedAmount: 1000,
            financialCost: 5.6,
            tax: 234.4,
            accountingBase: 1760,
          },
          asset: {
            paymentAmount: 300,
            totalContractAmount: 1000,
            monthPaymentAmount: 300,
            cumulativePaymentAmount: 600,
            unpaidAmount: 400,
            rent: 300,
          },
          rates: {
            tax: 0.1172,
            marketing: 0.05,
            business: 0.1,
            financial: 0.0028,
          },
          yearAccountingIncome: 2514.79,
          unreceivedAmount: 500,
          projectRanking: [
            {
              rank: 1,
              projectId: "project-1",
              projectName: "示例项目",
              contractCount: 2,
              contractAmount: 3000,
              receivedAmount: 2500,
              paidAmount: 0,
              settledAmount: 2500,
              accountingIncome: 2514.79,
              unreceivedAmount: 500,
              unpaidAmount: 0,
              completionRate: 83.33,
            },
          ],
        },
      },
    });

    const result = await getContractDashboard({
      startMonth: "2026-01",
      endMonth: "2026-08",
      category: "main_business",
      projectId: "project-1",
    });

    expect(api.get).toHaveBeenCalledWith("/api/contracts/dashboard", {
      params: {
        startMonth: "2026-01",
        endMonth: "2026-08",
        category: "main_business",
        projectId: "project-1",
      },
    });
    expect(result.mainBusiness?.accountingBase).toBe(754.79);
    expect(result.summary).toMatchObject({
      totalAmount: 3000,
      allContractAmount: 3500,
      effectiveContractAmount: 3000,
      effectiveIncomeContractAmount: 2500,
      effectiveExpenseContractAmount: 500,
      pendingSignatureAmount: 500,
      allContractCount: 3,
      effectiveContractCount: 2,
      effectiveIncomeContractCount: 1,
      effectiveExpenseContractCount: 1,
      pendingSignatureContractCount: 1,
    });
    expect(result.mainBusiness?.cumulativeReceiptAmount).toBe(2500);
    expect(result.nonMain?.financialCost).toBe(5.6);
    expect(result.nonMain?.unreceivedAmount).toBe(1000);
    expect(result.asset?.rent).toBe(300);
    expect(result.asset?.cumulativePaymentAmount).toBe(600);
    expect(result.categories[0]).toMatchObject({
      contractCount: 2,
      fixedAmountContractCount: 1,
      noFixedAmountCount: 1,
      cumulativeSettledAmount: "2500.00",
      outstandingAmount: "500.00",
      completionRate: 83.33,
    });
    expect(result.settlementStatuses[0]).toMatchObject({
      status: "partial",
      contractCount: 1,
      settledAmount: "2500.00",
    });
    expect(result.settlementStatuses[0].contracts[0].contractId).toBe(
      "contract-1",
    );
    expect(result.noFixedAmountContractCount).toBe(1);
    expect(result.periodComparison?.periods[1]).toMatchObject({
      key: "previous_period",
      period: "2025-05—2025-12",
      expenseAmount: 0,
    });
    expect(result.periodComparison?.changes.expensePreviousPeriod).toEqual({
      amount: 300,
      percentage: null,
      comparable: false,
    });
    expect(result.rates?.tax).toBe(0.1172);
    expect(result.yearAccountingIncome).toBe(2514.79);
    expect(result.unreceivedAmount).toBe(500);
    expect(result.projectRanking?.[0]).toMatchObject({
      projectId: "project-1",
      settledAmount: 2500,
      completionRate: 83.33,
    });
  });

  it("后端未提供年度、未回款和排行字段时保留明确的缺失状态", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: { summary: {}, categories: [], risks: [], monthlyTrend: [] },
      },
    });

    const result = await getContractDashboard({
      startMonth: "2026-01",
      endMonth: "2026-08",
    });

    expect(result.yearAccountingIncome).toBeNull();
    expect(result.unreceivedAmount).toBeNull();
    expect(result.projectRanking).toBeNull();
    expect(result.mainBusiness).toBeNull();
    expect(result.rates).toBeNull();
    expect(result.settlementStatuses).toEqual([]);
    expect(result.noFixedAmountContractCount).toBe(0);
    expect(result.periodComparison).toBeNull();
  });

  it("2024空期间合同额为零且全历史快照金额保持非零", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          startMonth: "2024-01",
          endMonth: "2024-12",
          summary: {
            allContractAmount: 2213860,
            effectiveContractAmount: 1983860,
            pendingSignatureAmount: 230000,
            periodContractCount: 0,
            periodContractAmount: 0,
          },
          categories: [],
          settlementStatuses: [],
          risks: [],
          monthlyTrend: [],
        },
      },
    });

    const result = await getContractDashboard({
      startMonth: "2024-01",
      endMonth: "2024-12",
    });

    expect(result.summary.periodContractCount).toBe(0);
    expect(result.summary.periodContractAmount).toBe(0);
    expect(result.summary.allContractAmount).toBe(2213860);
    expect(result.summary.effectiveContractAmount).toBe(1983860);
    expect(result.startMonth).toBe("2024-01");
    expect(result.endMonth).toBe("2024-12");
  });

  it("费率百分比只接受整数基点", async () => {
    expect(contractRatePercentToDecimal(11.72)).toBe(0.1172);
    expect(contractRatePercentToDecimal(0.28)).toBe(0.0028);
    expect(() => contractRatePercentToDecimal(11.721)).toThrow(
      "最多保留两位小数",
    );

    await expect(
      createContractRates({
        effectiveFrom: "2026-08-04",
        changeReason: "测试非法精度",
        items: [{ rateCode: "tax", rateValue: 0.11721 }],
      }),
    ).rejects.toThrow("整数基点");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("当前费率响应不完整时拒绝用默认 0% 伪装加载成功", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [],
          current: { tax: 0.1172, marketing: 0.05, business: 0.1 },
        },
      },
    });

    await expect(getContractRates()).rejects.toThrow("费率数据不完整");
  });

  it("真实挂载页面展示分类累计、结算三态、三期比较并下钻台账", async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === "/api/contracts/meta") {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              projects: [{ id: "project-1", name: "示例项目" }],
              areas: [],
              assetCategories: [],
              statuses: [],
            },
          },
        });
      }
      if (url === "/api/contracts/dashboard") {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              generatedAt: "2026-08-17T08:00:00.000Z",
              startMonth: "2026-01",
              endMonth: "2026-08",
              summary: {
                contractCount: 3,
                allContractCount: 4,
                effectiveContractCount: 3,
                pendingSignatureContractCount: 1,
                contractAmount: 6000,
                allContractAmount: 6700,
                effectiveContractAmount: 6000,
                effectiveIncomeContractAmount: 5000,
                effectiveExpenseContractAmount: 1000,
                pendingSignatureAmount: 700,
                effectiveIncomeContractCount: 2,
                effectiveExpenseContractCount: 1,
                receivedAmount: 800,
                paidAmount: 300,
                invoiceAmount: 1100,
              },
              categories: [
                {
                  category: "main_business",
                  contractCount: 1,
                  totalAmount: 3000,
                  monthSettledAmount: 500,
                  cumulativeSettledAmount: 2500,
                  outstandingAmount: 500,
                  completionRate: 83.33,
                },
                {
                  category: "non_main",
                  contractCount: 1,
                  totalAmount: 2000,
                  monthSettledAmount: 300,
                  cumulativeSettledAmount: 1000,
                  outstandingAmount: 1000,
                  completionRate: 50,
                },
                {
                  category: "asset",
                  contractCount: 1,
                  totalAmount: 1000,
                  monthSettledAmount: 300,
                  cumulativeSettledAmount: 600,
                  outstandingAmount: 400,
                  completionRate: 60,
                },
              ],
              settlementStatuses: [
                {
                  status: "unsettled",
                  contractCount: 1,
                  contractAmount: 1000,
                  settledAmount: 0,
                  outstandingAmount: 1000,
                  contracts: [],
                },
                {
                  status: "partial",
                  contractCount: 1,
                  contractAmount: 3000,
                  settledAmount: 2500,
                  outstandingAmount: 500,
                  contracts: [],
                },
                {
                  status: "settled",
                  contractCount: 1,
                  contractAmount: 2000,
                  settledAmount: 2000,
                  outstandingAmount: 0,
                  contracts: [],
                },
              ],
              noFixedAmountContractCount: 1,
              periodComparison: {
                periods: [
                  {
                    key: "current",
                    period: "2026-01—2026-08",
                    startMonth: "2026-01",
                    endMonth: "2026-08",
                    incomeAmount: 800,
                    expenseAmount: 300,
                  },
                  {
                    key: "previous_period",
                    period: "2025-05—2025-12",
                    startMonth: "2025-05",
                    endMonth: "2025-12",
                    incomeAmount: 400,
                    expenseAmount: 0,
                  },
                  {
                    key: "previous_year",
                    period: "2025-01—2025-08",
                    startMonth: "2025-01",
                    endMonth: "2025-08",
                    incomeAmount: 200,
                    expenseAmount: 100,
                  },
                ],
                changes: {
                  incomePreviousPeriod: {
                    amount: 400,
                    percentage: 100,
                    comparable: true,
                  },
                  expensePreviousPeriod: {
                    amount: 300,
                    percentage: null,
                    comparable: false,
                  },
                  incomePreviousYear: {
                    amount: 600,
                    percentage: 300,
                    comparable: true,
                  },
                  expensePreviousYear: {
                    amount: 200,
                    percentage: 200,
                    comparable: true,
                  },
                },
              },
              risks: [],
              monthlyTrend: [
                { month: "2026-08", receivedAmount: 800, paidAmount: 300 },
              ],
              mainBusiness: {
                contractAmount: 500,
                totalContractAmount: 3000,
                monthReceiptAmount: 500,
                cumulativeReceiptAmount: 2500,
                unreceivedAmount: 500,
                tax: 58.6,
                marketingReserve: 22.07,
                businessCost: 41.94,
                accountingBase: 377.39,
              },
              nonMain: {
                contractAmount: 300,
                totalContractAmount: 2000,
                monthReceiptAmount: 300,
                cumulativeReceiptAmount: 1000,
                unreceivedAmount: 1000,
                financialCost: 0.84,
                tax: 35.16,
                accountingBase: 264,
              },
              asset: {
                paymentAmount: 300,
                totalContractAmount: 1000,
                monthPaymentAmount: 300,
                cumulativePaymentAmount: 600,
                unpaidAmount: 400,
                rent: 300,
                electricity: 0,
                parking: 0,
                carRental: 0,
                internet: 0,
                other: 0,
              },
              rates: {
                tax: 0.1172,
                marketing: 0.05,
                business: 0.1,
                financial: 0.0028,
              },
              yearAccountingIncome: 641.39,
              unreceivedAmount: 1500,
              projectRanking: [],
            },
          },
        });
      }
      throw new Error(`未处理的请求：${url}`);
    });

    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/contract-dashboard", component: ContractDashboard },
        { path: "/contracts", component: { template: "<div>合同台账</div>" } },
      ],
    });
    await router.push({
      path: "/contract-dashboard",
      query: {
        startMonth: "2026-01",
        endMonth: "2026-08",
        projectId: "project-1",
      },
    });
    await router.isReady();

    const wrapper = mount(ContractDashboard, {
      global: {
        plugins: [pinia, router],
        directives: { loading: () => undefined },
        stubs: {
          ContractMetricCard: {
            props: ["label", "value", "note", "details"],
            template:
              '<article>{{ label }} {{ value }} {{ note }}<span v-for="item in details" :key="item.label">{{ item.label }} {{ item.value }}</span></article>',
          },
          ElAlert: { template: "<div><slot /></div>" },
          ElButton: { template: "<button><slot /></button>" },
          ElDatePicker: { template: "<input />" },
          ElDialog: { template: "<div><slot /><slot name='footer' /></div>" },
          ElEmpty: { template: "<div><slot /></div>" },
          ElForm: { template: "<form><slot /></form>" },
          ElFormItem: { template: "<div><slot /></div>" },
          ElIcon: { template: "<span><slot /></span>" },
          ElInput: { template: "<input />" },
          ElInputNumber: { template: "<input />" },
          ElOption: { template: "<span />" },
          ElSelect: { template: "<div><slot /></div>" },
          ElTable: { template: "<div><slot /></div>" },
          ElTableColumn: { template: "<div><slot /></div>" },
          ElTag: { template: "<span><slot /></span>" },
        },
      },
    });
    await flushPromises();
    await nextTick();

    const text = wrapper.text();
    expect(text).toContain("合同规模");
    expect(text).toContain("合同总额");
    expect(text).toContain("有效收入合同额");
    expect(text).toContain("有效支出合同额");
    expect(text).toContain("待签金额");
    expect(text).toContain("未回款余额");
    expect(text).toContain("所选期间经营数据");
    expect(text).toContain("期间签订合同额");
    expect(text).toContain("期间开票与回款");
    expect(text).toContain("开票－回款");
    expect(text).toContain("期间支出");
    expect(text).toContain("期间核算收入");
    expect(text).not.toContain("有效收入合同额（全历史快照）");
    expect(text).not.toContain("有效支出合同额（全历史快照）");
    expect(text).toContain("¥6,700.00");
    expect(text).toContain("¥5,000.00");
    expect(text).toContain("¥1,000.00");
    expect(text).toContain("¥700.00");
    expect(text).toContain("累计回款");
    expect(text).toContain("累计付款");
    expect(text).toContain("未付款");
    expect(text).toContain("已签合同未结算");
    expect(text).toContain("已签合同部分结算");
    expect(text).toContain("已签合同已结清");
    expect(text).toContain("已回款");
    expect(text).not.toContain("已回款／已付款");
    expect(text).toContain("未付款");
    expect(text).not.toContain("未回款／未付款");
    expect(text).toContain("当前所选期间");
    expect(text).toContain("上一等长期间");
    expect(text).toContain("上年同期");
    expect(text).toContain("暂无可比数据");
    expect(text).toContain("无固定金额合同 1 份");

    await wrapper.find("button.settlement-card.partial").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/contracts");
    expect(router.currentRoute.value.query).toMatchObject({
      settlementStatus: "partial",
      projectId: "project-1",
    });
    expect(router.currentRoute.value.query.contractDateFrom).toBeUndefined();
    expect(router.currentRoute.value.query.contractDateTo).toBeUndefined();
  });

  it("页面提供地址筛选持久化、费率重试空态与风险排行下钻", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDashboard.vue"),
      "utf8",
    );
    expect(source).toContain("route.query.startMonth");
    expect(source).toContain("route.query.endMonth");
    expect(source).toContain("route.query.category");
    expect(source).toContain("route.query.projectId");
    expect(source).toContain("rateErrorMessage");
    expect(source).toContain("重新加载费率");
    expect(source).toContain(':precision="2"');
    expect(source).toContain("openRisk(risk)");
    expect(source).toContain("openProjectRanking(item)");
    expect(source).toContain("后端暂未提供项目排行数据");
    expect(source).toContain(':aria-label="trendAriaLabel"');
    expect(source).toContain("所选期间合同收支明细");
    expect(source).toContain("全历史快照：按当前有效合同及合同分类汇总");
    expect(source).toContain("合同规模分组始终为全历史快照");
    expect(source).toContain("全历史快照，分类构成在下方");
    expect(source).toContain('class="metric-section-total"');
    expect(source).toContain('label="有效收入合同额"');
    expect(source).toContain('label="有效支出合同额"');
    expect(source).toContain('label="待签金额"');
    expect(source).toContain('label="未回款余额"');
    expect(source).toContain('label="期间签订合同额"');
    expect(source).toContain('label="期间开票与回款"');
    expect(source).toContain("periodInvoiceReceiptDifference");
    expect(source).toContain('label="期间支出"');
    expect(source).toContain('badge="收入"');
    expect(source).toContain('badge="支出"');
    expect(source).toContain("主合同签订月份口径");
    expect(source).toContain("合同结算状态");
    expect(source).toContain("已签合同未结算");
    expect(source).toContain("已签合同部分结算");
    expect(source).toContain("已签合同已结清");
    expect(source).toContain("openSettlementStatus(item.status)");
    expect(source).toContain("settlementStatus: status");
    expect(source).toContain("所选期间、上一等长期间与上年同期收支比较");
    expect(source).toContain("收入较上一等长期间");
    expect(source).toContain("支出较上年同期");
    expect(source).toContain("暂无可比数据");
    expect(source).toContain("浅色经营看板");
    expect(source).toContain("#f3f6f8");
    expect(source).toContain("background: rgb(255 255 255 / 96%)");
    expect(source.lastIndexOf("#f3f6f8")).toBeGreaterThan(
      source.indexOf("#0f2638"),
    );
    const assetCardSource = source.slice(
      source.indexOf('key: "asset" as const'),
      source.indexOf("].filter(", source.indexOf('key: "asset" as const')),
    );
    expect(assetCardSource).toContain('description: "按付款凭证汇总"');
    for (const label of ["房租", "电费", "车位费", "租车", "网费", "其他"]) {
      expect(assetCardSource).not.toContain(`label: "${label}"`);
    }
  });
});
