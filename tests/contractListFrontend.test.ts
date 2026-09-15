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
import { ElTable, ElTableColumn } from "element-plus";
import { api } from "@/utils/api";
import { getContracts } from "@/utils/contractApi";
import ContractList from "@/views/ContractList.vue";

const { flushPromises, mount, shallowMount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const elementStubs = {
  ContractMetricCard: true,
  ContractStatusTag: true,
  ElAlert: { template: "<div><slot /></div>" },
  ElButton: { template: "<button><slot /></button>" },
  ElDatePicker: { template: "<input />" },
  ElDialog: { template: "<div><slot /><slot name='footer' /></div>" },
  ElEmpty: { template: "<div><slot /></div>" },
  ElInput: { template: "<input />" },
  ElOption: { template: "<span />" },
  ElPagination: { template: "<div />" },
  ElProgress: { template: "<span />" },
  ElSelect: { template: "<div><slot /></div>" },
};

const interactiveMetricCardStub = {
  name: "InteractiveMetricCardStub",
  inheritAttrs: false,
  props: {
    label: { type: String, default: "" },
    value: { type: [String, Number], default: "" },
    note: { type: String, default: "" },
    badge: { type: String, default: "" },
    clickable: Boolean,
    ariaPressed: { type: Boolean, default: false },
  },
  emits: ["activate"],
  template: `
    <button
      class="interactive-metric-card"
      :data-label="label"
      :data-value="String(value)"
      :data-badge="badge"
      :disabled="!clickable"
      :aria-pressed="ariaPressed"
      @click="$emit('activate')"
    >{{ label }} {{ value }}</button>
  `,
};

function mockMetricContractListApi() {
  (api.get as jest.Mock).mockImplementation((url: string) => {
    if (url === "/api/contracts/meta") {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            projects: [],
            areas: ["海淀区"],
            assetCategories: [],
          },
        },
      });
    }
    if (url !== "/api/contracts") {
      throw new Error(`测试未声明接口：${url}`);
    }
    return Promise.resolve({
      data: {
        success: true,
        data: {
          items: [],
          total: 30,
          summary: {
            pendingApprovalCount: 2,
            pendingSealCount: 3,
          },
        },
      },
    });
  });
}

describe("合同台账前端筛选与动作", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("按后端契约透传对方、日期、分类、生命周期和结算状态", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [],
          total: 3,
          summary: {
            totalAmount: 3000,
            allContractAmount: 3500,
            effectiveContractAmount: 3000,
            effectiveIncomeContractAmount: 2500,
            effectiveExpenseContractAmount: 500,
            pendingSignatureAmount: 500,
            effectiveContractCount: 2,
            effectiveIncomeContractCount: 1,
            effectiveExpenseContractCount: 1,
            pendingSignatureContractCount: 1,
          },
        },
      },
    });

    const result = await getContracts({
      page: 2,
      pageSize: 50,
      keyword: "示例项目",
      counterparty: "示例公司",
      category: ["main_business", "non_main"],
      declaredSubtype: ["non_main_income", "non_main_expense"],
      status: ["effective", "executing"],
      settlementStatus: "partial",
      projectId: "project-1",
      area: "全部",
      contractDateFrom: "2026-01-01",
      contractDateTo: "2026-08-05",
    });

    expect(api.get).toHaveBeenCalledWith("/api/contracts", {
      params: {
        page: 2,
        pageSize: 50,
        keyword: "示例项目",
        counterparty: "示例公司",
        category: "main_business,non_main",
        declaredSubtype: "non_main_income,non_main_expense",
        status: "effective,executing",
        settlementStatus: "partial",
        projectId: "project-1",
        area: "全部",
        contractDateFrom: "2026-01-01",
        contractDateTo: "2026-08-05",
      },
    });
    expect(result.summary).toMatchObject({
      totalAmount: 3000,
      allContractAmount: 3500,
      effectiveContractAmount: 3000,
      effectiveIncomeContractAmount: 2500,
      effectiveExpenseContractAmount: 500,
      pendingSignatureAmount: 500,
      effectiveContractCount: 2,
      effectiveIncomeContractCount: 1,
      effectiveExpenseContractCount: 1,
      pendingSignatureContractCount: 1,
    });
  });

  it("合同台账映射独立续签主合同的来源和去向", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [
            {
              id: "renewal-main-2",
              relationType: "main",
              renewed_from_contract_id: "renewal-main-1",
              renewal_contract_id: "renewal-main-3",
              renewal_contract_name: "第三期房屋租赁合同",
              renewal_contract_status: "draft",
            },
          ],
          total: 1,
          summary: {},
        },
      },
    });

    const result = await getContracts();

    expect(result.items[0]).toMatchObject({
      id: "renewal-main-2",
      relationType: "main",
      previousLeaseContractId: "renewal-main-1",
      renewalContractId: "renewal-main-3",
      renewalContractName: "第三期房屋租赁合同",
      renewalContractStatus: "draft",
    });
  });

  it("合同台账兼容映射合同族关联协议分类计数", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [
            {
              id: "main-with-agreements",
              relationType: "main",
              supplement_agreement_count: "2",
              termination_agreement_count: 1,
              related_agreement_count: "3",
              historical_imported: true,
            },
          ],
          total: 1,
          summary: {},
        },
      },
    });

    const result = await getContracts();

    expect(result.items[0]).toMatchObject({
      id: "main-with-agreements",
      supplementAgreementCount: 2,
      terminationAgreementCount: 1,
      relatedAgreementCount: 3,
      historicalImported: true,
    });
  });

  it("页面地址保存关键词、筛选和分页并支持刷新恢复", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    for (const queryKey of [
      "page",
      "pageSize",
      "keyword",
      "counterparty",
      "category",
      "declaredSubtype",
      "status",
      "settlementStatus",
      "projectId",
      "area",
      "contractDateFrom",
      "contractDateTo",
    ]) {
      expect(source).toContain(`route.query.${queryKey}`);
    }
    expect(source).toContain("replaceRouteQuery");
    expect(source).toContain("normalizedRouteQuery");
    expect(source).toContain("filters.statuses = [...query.statuses]");
    expect(source).toContain("handlePageChange(nextPage: number)");
    expect(source).toContain("applyFilters(false)");
    expect(source).toContain("{ immediate: true }");
    expect(source).toContain("multiple");
  });

  it("点击待审批与待盖章指标切换台账状态并保留其他筛选", async () => {
    mockMetricContractListApi();
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/contracts", component: ContractList }],
    });
    await router.push({
      path: "/contracts",
      query: {
        page: "3",
        pageSize: "10",
        keyword: "项目甲",
        area: "海淀区",
      },
    });
    await router.isReady();
    const wrapper = shallowMount(ContractList, {
      global: {
        plugins: [pinia, router],
        components: { ElTable, ElTableColumn },
        stubs: {
          ...elementStubs,
          ContractMetricCard: interactiveMetricCardStub,
        },
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();
    await nextTick();

    const metric = (label: string) =>
      wrapper
        .findAll(".interactive-metric-card")
        .find((item) => item.attributes("data-label") === label);
    expect(metric("待审批合同")?.attributes("data-value")).toBe("2");
    expect(metric("待盖章归档")?.attributes("data-value")).toBe("3");

    const component = wrapper.vm as unknown as {
      filters: {
        categories: string[];
        statuses: string[];
      };
      page: number;
    };
    component.filters.categories = ["main_business"];
    const replace = jest.spyOn(router, "replace").mockResolvedValue(undefined);
    const metricComponent = (label: string) =>
      wrapper
        .findAllComponents({ name: "InteractiveMetricCardStub" })
        .find((item) => item.props("label") === label);

    metricComponent("待审批合同")!.vm.$emit("activate");
    expect(component.filters.statuses).toEqual(["approving"]);
    expect(component.page).toBe(1);
    expect(replace).toHaveBeenNthCalledWith(1, {
      query: expect.objectContaining({
        page: "1",
        pageSize: "10",
        keyword: "项目甲",
        category: "main_business",
        area: "海淀区",
        status: "approving",
      }),
    });

    metricComponent("待盖章归档")!.vm.$emit("activate");
    expect(component.filters.statuses).toEqual(["pending_seal"]);
    expect(replace).toHaveBeenNthCalledWith(2, {
      query: expect.objectContaining({ status: "pending_seal" }),
    });

    metricComponent("待盖章归档")!.vm.$emit("activate");
    expect(component.filters.statuses).toEqual([]);
    expect(replace).toHaveBeenNthCalledWith(3, {
      query: expect.objectContaining({ status: undefined }),
    });
    wrapper.unmount();
  });

  it("服务端待办指标忽略状态筛选并按主合同链去重", () => {
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const listRouteSource = backendSource.slice(
      backendSource.indexOf(
        'router.get("/", requireContractLedgerRead, async (req, res)',
      ),
      backendSource.indexOf('router.get("/dashboard"'),
    );

    expect(listRouteSource).toContain('let statusFilterSql = ""');
    expect(listRouteSource).toContain(
      "where.filter((condition) => condition !== statusFilterSql)",
    );
    expect(listRouteSource).toContain(
      "params.filter((_, index) => index !== statusFilterParamIndex)",
    );
    expect(listRouteSource).toContain("pending_status_scope AS");
    expect(listRouteSource).toMatch(
      /COUNT\(DISTINCT COALESCE\(root_contract_id, id\)\)::int\s+FROM pending_status_scope WHERE status = 'approving'/,
    );
    expect(listRouteSource).toMatch(
      /COUNT\(DISTINCT COALESCE\(root_contract_id, id\)\)::int\s+FROM pending_status_scope WHERE status = 'pending_seal'/,
    );
    expect(listRouteSource).toContain("...pendingStatusParams");
    expect(listRouteSource).not.toContain(
      "COUNT(*)::int FROM filtered WHERE status = 'approving'",
    );
    expect(listRouteSource).not.toContain(
      "COUNT(*)::int FROM filtered WHERE status = 'pending_seal'",
    );
  });

  it("台账将不限区域与行政区全部区分并透传全部区域筛选", async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === "/api/contracts") {
        return Promise.resolve({
          data: {
            success: true,
            data: { items: [], total: 0, summary: {} },
          },
        });
      }
      if (url === "/api/contracts/meta") {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              projects: [],
              areas: ["全部", "朝阳区"],
              assetCategories: [],
            },
          },
        });
      }
      throw new Error(`测试未声明接口：${url}`);
    });

    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/contracts", component: ContractList }],
    });
    await router.push({
      path: "/contracts",
      query: { page: "1", pageSize: "20", area: "全部" },
    });
    await router.isReady();

    const wrapper = mount(ContractList, {
      global: {
        plugins: [pinia, router],
        components: { ElTable, ElTableColumn },
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();
    await nextTick();

    expect(api.get).toHaveBeenCalledWith("/api/contracts", {
      params: expect.objectContaining({ area: "全部" }),
    });
    expect(router.currentRoute.value.query.area).toBe("全部");
    wrapper.unmount();
  });

  it("非主营收入与支出保留为台账二级筛选字段", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const presentationSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/utils/contractPresentation.ts"),
      "utf8",
    );

    expect(source).toContain('v-model="filters.declaredSubtypes"');
    expect(source).toContain(
      "v-if=\"filters.categories.includes('non_main')\"",
    );
    expect(source).toContain('placeholder="非主营二级分类（多选）"');
    expect(presentationSource).toContain("非主营业务收入合同");
    expect(presentationSource).toContain("非主营业务支出合同");
    expect(source).not.toContain("contractLedgerSubtypeLabel");
    expect(source).not.toContain('class="declared-subtype-label"');
    expect(source).toContain("route.query.declaredSubtype");
    expect(source).toContain("function handleCategoryFilterChange()");
    expect(source).toContain("filters.declaredSubtypes = []");
    expect(source).toContain(
      'declaredSubtypes.length > 0 && !categories.includes("non_main")',
    );
    expect(source).toContain("returnTo: route.fullPath");
    expect(backendSource).toContain("req.query.declaredSubtype");
    expect(backendSource).toContain(
      'addFilter("c.declared_subtype = ANY(?::text[])", storedDeclaredSubtypes)',
    );
    expect(backendSource).toContain('["non_main_income", "other_service"]');
    expect(backendSource).toContain(
      "where.push(\"COALESCE(c.category, c.declared_category) = 'non_main'\")",
    );
  });

  it("非主营合同在三种台账布局仅显示父分类和收入支出方向", async () => {
    const nonMainContracts = [
      {
        id: "non-main-income",
        contractNo: "NM-INCOME",
        name: "非主营收入项目",
        partyA: "收入甲方",
        partyB: "本公司",
        projectName: "非主营收入项目",
        category: "non_main",
        declaredCategory: "non_main",
        declaredSubtype: "non_main_income",
        relationType: "main",
        status: "executing",
        version: 1,
        amount: 100,
        currentAmount: 100,
        receivedAmount: 20,
        completionRate: 20,
      },
      {
        id: "non-main-expense",
        contractNo: "NM-EXPENSE",
        name: "非主营支出项目",
        partyA: "支出甲方",
        partyB: "本公司",
        projectName: "非主营支出项目",
        category: "non_main",
        declaredCategory: "non_main",
        declaredSubtype: "non_main_expense",
        relationType: "main",
        status: "executing",
        version: 1,
        amount: 100,
        currentAmount: 100,
        paidAmount: 40,
        completionRate: 40,
      },
    ];
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === "/api/contracts") {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              items: nonMainContracts,
              total: nonMainContracts.length,
              summary: {},
            },
          },
        });
      }
      if (url === "/api/contracts/meta") {
        return Promise.resolve({
          data: {
            success: true,
            data: { projects: [], areas: [], assetCategories: [] },
          },
        });
      }
      throw new Error(`测试未声明接口：${url}`);
    });

    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/contracts", component: ContractList }],
    });
    await router.push("/contracts?page=1&pageSize=20");
    await router.isReady();

    const wrapper = mount(ContractList, {
      global: {
        plugins: [pinia, router],
        components: { ElTable, ElTableColumn },
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();
    await nextTick();

    for (const selector of [
      ".contract-table-full .category-direction-cell",
      ".contract-table-compact .category-direction-cell",
      ".mobile-category-line",
    ]) {
      const cells = wrapper.findAll(selector);
      expect(cells).toHaveLength(2);
      expect(cells[0].text()).toContain("非主营项目合同");
      expect(cells[0].text()).toContain("收入");
      expect(cells[1].text()).toContain("非主营项目合同");
      expect(cells[1].text()).toContain("支出");
      expect(cells.map((cell) => cell.text()).join(" ")).not.toContain(
        "非主营业务收入合同",
      );
      expect(cells.map((cell) => cell.text()).join(" ")).not.toContain(
        "非主营业务支出合同",
      );
    }
    wrapper.unmount();
  });

  it("从筛选后的合同台账进入详情并返回原筛选页面", () => {
    const listSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );

    expect(listSource).toContain("function contractDetailReturnQuery(");
    expect(listSource).toContain('from: "contract-ledger"');
    expect(listSource).toContain("returnTo: route.fullPath");
    expect(listSource).toContain(
      'query: contractDetailReturnQuery({ tab: "auxiliary" })',
    );
    expect(listSource).toContain(
      'query: contractDetailReturnQuery({ tab: "seal", action: "seal" })',
    );
    expect(listSource).toContain(
      'query: contractDetailReturnQuery({ tab: "finance", action: "record" })',
    );
    expect(detailSource).toContain('route.query.from === "contract-ledger"');
    expect(detailSource).toContain('returnTo.startsWith("/contracts?")');
    expect(detailSource).toContain(
      "historyBackPath === detailLedgerReturnPath.value",
    );
  });

  it("合同日期筛选可在年、月、日三个选择层级间切换并默认显示双月日历", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    expect(source.match(/<el-date-picker/g)).toHaveLength(1);
    expect(source).toContain(
      'const contractDateMode = ref<ContractDateMode>("day")',
    );
    expect(source).toContain('v-model="contractDatePickerValue"');
    expect(source).toContain(':type="contractDatePickerType"');
    expect(source).toContain('return "yearrange" as const');
    expect(source).toContain('return "monthrange" as const');
    expect(source).toContain('return "daterange" as const');
    expect(source).toContain('range-separator="至"');
    expect(source).toContain(':shortcuts="contractDatePanelShortcuts"');
    expect(source).toContain('{ label: "年", value: "year" }');
    expect(source).toContain('{ label: "月", value: "month" }');
    expect(source).toContain('{ label: "日", value: "day" }');
    expect(source).not.toContain('class="date-mode-switch"');
    expect(source).not.toContain('aria-label="合同日期起始值"');
    expect(source).not.toContain('aria-label="合同日期结束值"');
  });

  it("租赁到期提醒使用房屋与车辆共用文案", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );

    expect(source).toContain("租赁合同到期提醒");
    expect(source).toContain("将在 1 个月内到期");
    expect(source).not.toContain("将在 3 个月内到期");
    expect(source).toContain("续签、退租／还车或终止手续");
    expect(source).not.toContain("房屋租赁合同到期提醒");
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(backendSource).toContain(
      "status IN ('effective', 'executing', 'completed')",
    );
    expect(
      backendSource.match(/CURRENT_DATE \+ INTERVAL '1 month'/g),
    ).toHaveLength(4);
    expect(backendSource).not.toContain("INTERVAL '3 months'");
    expect(backendSource.match(/status <> 'completed'/g)).toHaveLength(4);
    expect(backendSource).toContain(
      "lease_source.lease_end_date >= TO_CHAR(\n                CURRENT_DATE, 'YYYY-MM-DD'",
    );
    expect(backendSource).toContain(
      "c.lease_end_date >= TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')",
    );
    expect(backendSource).not.toContain(
      "status NOT IN ('completed', 'rejected', 'terminated')",
    );
  });

  it("台账展示财务与责任字段，并通过顶部指标下钻待办状态", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    expect(source).toContain('label="已收"');
    expect(source).toContain('label="有效收入合同额"');
    expect(source).toContain('label="有效支出合同额"');
    expect(source).toContain('label="待签合同金额"');
    expect(source).toContain(
      "formatContractMoney(summary.effectiveIncomeContractAmount)",
    );
    expect(source).toContain(
      "formatContractMoney(summary.effectiveExpenseContractAmount)",
    );
    expect(source).toContain(
      "formatContractMoney(summary.pendingSignatureAmount)",
    );
    expect(source).toContain("不含待签合同");
    expect(source).toContain("含草稿、初始审批中和待盖章");
    expect(source).toContain('label="已付"');
    expect(source).toContain('item.declaredSubtype === "non_main_expense"');
    expect(source).toContain('item.financialDirection === "cost"');
    expect(source).toContain('label="责任人"');
    expect(source).toContain("contractOwnerLabel(row)");
    expect(source).toMatch(
      /v-if="[\s\S]*?canCreate &&[\s\S]*?\['draft', 'pending_seal'\]\.includes\(row\.status\)[\s\S]*?"[\s\S]*?class="action-slot action-status"/,
    );
    expect(source).toContain("v-if=\"row.status === 'draft'\"");
    expect(source).not.toContain("canApproveItem");
    expect(source).not.toContain("openPendingApproval");
    expect(source).not.toContain(">待审批</el-button");
    expect(source).not.toContain("router.push('/contract-approvals')");
    expect(source).toContain("@activate=\"toggleStatusMetric('approving')\"");
    expect(source).toContain(
      "@activate=\"toggleStatusMetric('pending_seal')\"",
    );
    expect(source).toContain(
      "filters.statuses = isStatusMetricActive(status) ? [] : [status]",
    );
    expect(source).toContain("v-else-if=\"row.status === 'pending_seal'\"");
    expect(source).toContain("openFinancialRegistration(row)");
    expect(source).toContain("row.relationType === 'main'");
    expect(source).toContain("item.relationType === 'main'");
    expect(source).toContain('item.relationType !== "main"');
    expect(source).toContain(
      '!["effective", "executing"].includes(item.status)',
    );
    expect(source).not.toContain(
      "['effective', 'executing', 'completed'].includes(row.status)",
    );
    expect(source).toContain(
      'query: contractDetailReturnQuery({ tab: "finance", action: "record" })',
    );
    expect(source).toContain(
      'query: contractDetailReturnQuery({ tab: "seal", action: "seal" })',
    );
    expect(source).toContain("撤销此合同");
    expect(source).toContain("canCancelContract(row)");
    expect(source).toContain("canCancelContract(item)");
    expect(source).toContain('["draft", "approving", "pending_seal"]');
    expect(source).toContain("ElMessageBox.prompt");
    expect(source).toContain("请输入撤销原因（必填，最多300字）");
    expect(source).toContain("cancellationReason");
    expect(source).toContain("已上传盖章版的合同不能撤销");
    expect(source).toContain("router.push('/contracts/cancelled')");
    expect(source).toContain("escapeContractCsvCell");
    expect(source).toContain(
      "clampPercent(normalizeProgress(row.completionRate))",
    );
  });

  it("台账隐藏合同截至日期，但接口保留核算日期供其他页面使用", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const typeSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/types/contract.ts"),
      "utf8",
    );
    const apiSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/utils/contractApi.ts"),
      "utf8",
    );
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const settlementAccountingSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/services/contractSettlementAccounting.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain('label="合同截至日期"');
    expect(source).not.toContain("displayedContractCutoffDate");
    expect(source).not.toContain('"合同截至日期",');
    expect(typeSource).toContain("contractCutoffDate?: string | null");
    expect(apiSource).toContain("source.contract_cutoff_date");
    expect(backendSource).toContain("END AS contract_cutoff_date");
    expect(backendSource).toContain(
      "roots.root_status NOT IN ('completed', 'terminated') THEN NULL",
    );
    expect(backendSource).toContain("SELECT MAX(receipt.receipt_date)");
    expect(backendSource).toContain("contractCostSettlementLastDateSql");
    expect(settlementAccountingSource).toContain(
      '"contract_external_payments"',
    );
    expect(settlementAccountingSource).toContain(
      "accounting_line.include_in_contract_accounting = TRUE",
    );
    expect(backendSource).toContain(
      "fm.contract_cutoff_date AS contract_cutoff_date",
    );
  });

  it("未上传盖章版的补充和解除协议挂入主合同子行，上传后退出台账", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const apiSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/utils/contractApi.ts"),
      "utf8",
    );
    const typeSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/types/contract.ts"),
      "utf8",
    );
    const ledgerSource = source.slice(
      source.indexOf("const ledgerItems = computed"),
      source.indexOf("const summary = ref"),
    );
    expect(ledgerSource).toContain("const rootsById");
    expect(ledgerSource).toContain("item.hasSealedContractFile === true");
    expect(ledgerSource).toContain(
      "const rootId = item.rootContractId || item.parentContractId",
    );
    expect(ledgerSource).toContain("root.children!.push");
    expect(ledgerSource).toContain("ledgerItems.value.flatMap");
    expect(ledgerSource).toContain("expandedMobileRootIds.value.has(root.id)");
    expect(source).toContain("const visibleExportItems = exportItems.filter");
    expect(source).toContain("item.hasSealedContractFile !== true");
    expect(source).toContain(
      '<ContractStatusTag :status="row.status" size="small" />',
    );
    expect(backendSource).toContain("currentSealedContractFileExists");
    expect(backendSource).toContain("AS has_sealed_contract_file");
    expect(backendSource).toContain("hasSealedContractFile: Boolean");
    expect(
      backendSource.match(
        /OR NOT \$\{currentSealedContractFileExists\("c"\)\}/g,
      ),
    ).toHaveLength(2);
    expect(apiSource).toContain("source.has_sealed_contract_file");
    expect(typeSource).toContain("hasSealedContractFile?: boolean");
  });

  it("完整表和自适应表各保留一个项目名称主列，导出仍保留项目字段", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const fullTableStart = source.indexOf("contract-table-full");
    const fullTable = source.slice(
      fullTableStart,
      source.indexOf("</el-table>", fullTableStart),
    );
    const adaptiveTableStart = source.indexOf("contract-table-compact");
    const adaptiveTable = source.slice(
      adaptiveTableStart,
      source.indexOf("</el-table>", adaptiveTableStart),
    );
    expect(fullTable.match(/label="项目名称"/g)).toHaveLength(1);
    expect(adaptiveTable.match(/label="项目名称"/g)).toHaveLength(1);
    expect(source).not.toContain(
      'row.category === "asset" ? "—" : row.projectName',
    );
    expect(source).not.toContain("item.category !== 'asset'");
    expect(source).toContain(
      'item.category === "asset" ? "" : item.projectName',
    );
  });

  it("草拟合同项目名称缺失时显示待识别，不用文件名代替", () => {
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(backendSource).toContain("function contractListDisplayName");
    expect(backendSource).toContain("draft_file.file_name AS source_file_name");
    expect(backendSource).toContain(
      'row.status === "draft" ? "项目名称待识别" : "—"',
    );
    expect(backendSource).not.toContain("? `草拟：${sourceFileName}`");
    expect(backendSource).toContain("name: contractListDisplayName(row)");
    expect(backendSource).not.toContain(
      'name: row.title || row.project_name || row.contract_no || "未命名合同"',
    );
  });

  it("项目名称列显示合同内项目名称和编号", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const columnStart = source.indexOf('label="项目名称"');
    const columnEnd = source.indexOf("</el-table-column>", columnStart);
    const columnSource = source.slice(columnStart, columnEnd);
    expect(columnSource).toContain("contractDisplayName(row)");
    expect(columnSource).toContain("contractNumberText(row)");
    expect(columnSource).toContain('min-width="640"');
    expect(source).toContain("function contractNumberText");
    expect(source).toContain(
      'const projectName = String(item.projectName || "").trim()',
    );
    expect(source).toContain('return item.status === "draft"');
    expect(source).toContain('"项目名称待识别"');
    expect(source).not.toContain(
      'String(item.name || item.projectName || "未命名合同").trim()',
    );
    expect(source).not.toContain(
      'return String(item.name || "未命名资产合同")',
    );
    expect(source).toContain("overflow-wrap: normal");
    expect(source).toContain("white-space: nowrap");
  });

  it("关联协议子行完整单行显示名称且不重复层级符号和协议标识", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const columnStart = source.indexOf('label="项目名称"');
    const columnEnd = source.indexOf("</el-table-column>", columnStart);
    const columnSource = source.slice(columnStart, columnEnd);
    expect(columnSource).toContain(':title="contractDisplayName(row)"');
    expect(columnSource).toContain("shouldShowRelationBadge(row)");
    expect(columnSource).not.toContain('class="relation-branch"');
    expect(columnSource).not.toContain("show-overflow-tooltip");
    expect(source).toContain("function shouldShowRelationBadge");
    expect(source).toContain("!normalizedName.includes(normalizedLabel)");
    expect(source).toContain("overflow-wrap: normal");
    expect(source).toContain("white-space: nowrap");
    expect(source).not.toContain(
      "<template v-if=\"item.relationType !== 'main'\">↳ </template>",
    );
    expect(source).toContain("挂接于上方主合同");
  });

  it("真实挂载台账时只展开未上传盖章版的关联协议", async () => {
    const supplementName =
      "新材料110千伏输变电工程工程规划许可证、施工许可证技术服务补充协议（2）";
    const unsealedTerminationName = "新材料项目解除协议书";
    const sealedSupplementName = "新材料项目补充协议（3）";
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === "/api/contracts") {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              items: [
                {
                  id: "main-contract",
                  contractNo: "SGBJHD00JJJS2500054",
                  name: "新材料110千伏输变电工程工程规划许可证、施工许可证技术服务",
                  partyA: "国网北京市电力公司",
                  partyB: "北京羽隶工程咨询有限公司",
                  projectName:
                    "新材料110千伏输变电工程工程规划许可证、施工许可证技术服务",
                  category: "main_business",
                  declaredCategory: "main_business",
                  relationType: "main",
                  status: "executing",
                  version: 1,
                  amount: 230000,
                  currentAmount: 230000,
                  supplementAgreementCount: 2,
                  terminationAgreementCount: 1,
                  relatedAgreementCount: 3,
                  receivedAmount: 0,
                  completionRate: 0,
                },
                {
                  id: "supplement-contract",
                  contractNo: "SGBJHD00JJJS2500054(B1)",
                  name: supplementName,
                  partyA: "国网北京市电力公司",
                  partyB: "北京羽隶工程咨询有限公司",
                  projectName: supplementName,
                  category: "main_business",
                  declaredCategory: "main_business",
                  relationType: "supplement",
                  parentContractId: "main-contract",
                  rootContractId: "main-contract",
                  status: "draft",
                  version: 1,
                  amount: 0,
                  supplementSequence: 2,
                  supplementChangeType: "payment_terms_only",
                  hasSealedContractFile: false,
                  originalContractAmount: 230000,
                  amountBeforeChange: 230000,
                  amountAfterChange: 230000,
                  currentEffectiveAmount: 230000,
                  receivedAmount: 0,
                  completionRate: 0,
                },
                {
                  id: "termination-contract",
                  contractNo: "SGBJHD00JJJS2500054(C)",
                  name: unsealedTerminationName,
                  partyA: "国网北京市电力公司",
                  partyB: "北京羽隶工程咨询有限公司",
                  projectName: unsealedTerminationName,
                  category: "main_business",
                  declaredCategory: "main_business",
                  relationType: "termination",
                  parentContractId: "main-contract",
                  rootContractId: "main-contract",
                  status: "pending_seal",
                  version: 2,
                  amount: -230000,
                  hasSealedContractFile: false,
                  receivedAmount: 0,
                  completionRate: 0,
                },
                {
                  id: "sealed-supplement-contract",
                  contractNo: "SGBJHD00JJJS2500054(B2)",
                  name: sealedSupplementName,
                  partyA: "国网北京市电力公司",
                  partyB: "北京羽隶工程咨询有限公司",
                  projectName: sealedSupplementName,
                  category: "main_business",
                  declaredCategory: "main_business",
                  relationType: "supplement",
                  parentContractId: "main-contract",
                  rootContractId: "main-contract",
                  status: "pending_seal",
                  version: 2,
                  amount: 10000,
                  supplementSequence: 3,
                  hasSealedContractFile: true,
                  receivedAmount: 0,
                  completionRate: 0,
                },
                {
                  id: "second-main-contract",
                  contractNo: "SGBJHD00JJJS2500055",
                  name: "第二份主合同",
                  partyA: "国网北京市电力公司",
                  partyB: "北京羽隶工程咨询有限公司",
                  projectName: "第二份主合同",
                  category: "main_business",
                  declaredCategory: "main_business",
                  relationType: "main",
                  status: "executing",
                  version: 1,
                  amount: 100000,
                  currentAmount: 100000,
                  receivedAmount: 0,
                  completionRate: 0,
                },
              ],
              total: 2,
              summary: {},
            },
          },
        });
      }
      if (url === "/api/contracts/meta") {
        return Promise.resolve({
          data: {
            success: true,
            data: { projects: [], areas: [], assetCategories: [] },
          },
        });
      }
      throw new Error(`测试未声明接口：${url}`);
    });

    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/contracts", component: ContractList }],
    });
    await router.push("/contracts?page=1&pageSize=20");
    await router.isReady();

    const wrapper = mount(ContractList, {
      global: {
        plugins: [pinia, router],
        components: { ElTable, ElTableColumn },
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();
    await nextTick();

    const mainRows = wrapper
      .find(".contract-table-full")
      .findAll("tr.el-table__row")
      .filter((row) => !row.classes().includes("related-contract-row"));
    expect(mainRows).toHaveLength(2);
    expect(mainRows.map((row) => row.find("td").text())).toEqual(["1", "2"]);
    const desktopAgreementBadges = wrapper
      .find(".contract-table-full")
      .findAll(".agreement-type-badge");
    expect(desktopAgreementBadges.map((badge) => badge.text())).toEqual([
      "补充协议 2 份",
      "解除协议 1 份",
    ]);
    expect(desktopAgreementBadges[0].classes()).toContain("is-supplement");
    expect(desktopAgreementBadges[1].classes()).toContain("is-termination");
    expect(
      wrapper
        .find(".contract-table-full .related-agreement-badges")
        .attributes("aria-label"),
    ).toBe("关联 3 份协议（补充 2 · 终止／解除 1）");

    const compactAgreementBadges = wrapper
      .find(".contract-table-compact")
      .findAll(".agreement-type-badge");
    expect(compactAgreementBadges.map((badge) => badge.text())).toEqual([
      "补充协议 2 份",
      "解除协议 1 份",
    ]);
    expect(
      wrapper
        .find(".mobile-agreement-summary")
        .findAll(".agreement-type-badge")
        .map((badge) => badge.text()),
    ).toEqual(["补充协议 2 份", "解除协议 1 份"]);

    expect(
      wrapper.findAll(".mobile-contract-card.is-related-contract"),
    ).toHaveLength(0);
    const mobileToggle = wrapper
      .findAll(".mobile-card-actions button")
      .find((button) => button.text().includes("展开 2 份待归档协议"));
    expect(mobileToggle).toBeDefined();
    await mobileToggle!.trigger("click");
    await nextTick();
    expect(
      wrapper.findAll(".mobile-contract-card.is-related-contract"),
    ).toHaveLength(2);

    const expandButton = wrapper.find(".el-table__expand-icon");
    expect(expandButton.exists()).toBe(true);
    await expandButton.trigger("click");
    await nextTick();

    const relatedRows = wrapper
      .find(".contract-table-full")
      .findAll("tr.related-contract-row");
    expect(relatedRows).toHaveLength(2);
    expect(relatedRows[0].text()).toContain(supplementName);
    expect(relatedRows[1].text()).toContain(unsealedTerminationName);
    expect(
      relatedRows[1].find("contract-status-tag-stub").attributes("status"),
    ).toBe("pending_seal");
    expect(wrapper.text()).not.toContain(sealedSupplementName);

    wrapper.unmount();
  });

  it("主合同台账按根合同挂载未盖章关联协议树", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    expect(source).toContain(':data="ledgerItems"');
    expect(source).toContain("visibleMobileItems");
    const ledgerSource = source.slice(
      source.indexOf("const ledgerItems = computed"),
      source.indexOf("const summary = ref"),
    );
    expect(ledgerSource).toContain("children: []");
    expect(ledgerSource).toContain("rootsById.get(rootId)");
    expect(ledgerSource).toContain("root.children!.push({ ...item })");
  });

  it("主合同台账一次性聚合全部有效补充及终止解除协议数量", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const typeSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/types/contract.ts"),
      "utf8",
    );

    expect(backendSource).toContain("AS supplement_agreement_count");
    expect(backendSource).toContain("AS termination_agreement_count");
    expect(backendSource).toContain("AS related_agreement_count");
    expect(backendSource).toContain("child.status <> 'rejected'");
    expect(backendSource).toContain(
      "child.relation_type IN ('supplement', 'termination')",
    );
    expect(source).toContain("relatedAgreementSummary(row)");
    expect(source).toContain("relatedAgreementSummary(item)");
    expect(source).toContain("relatedAgreementBadges(row)");
    expect(source).toContain("relatedAgreementBadges(item)");
    expect(source).toContain('label: "补充协议"');
    expect(source).toContain('label: "解除协议"');
    expect(source).toContain(".agreement-type-badge.is-supplement");
    expect(source).toContain(".agreement-type-badge.is-termination");
    expect(source).toContain("终止／解除");
    expect(source).toContain("份待归档协议");
    expect(typeSource).toContain("relatedAgreementCount?: number");
    expect(typeSource).toContain("supplementAgreementCount?: number");
    expect(typeSource).toContain("terminationAgreementCount?: number");
    expect(typeSource).toContain("historicalImported?: boolean");
    expect(source).toContain('item.historicalImported ? "待分配" : "—"');
    expect(backendSource).toContain("creator.name AS owner_name");
    expect(backendSource).not.toContain(
      "THEN NULL ELSE creator.name END AS owner_name",
    );
  });

  it("生效主合同提供快速补充协议入口并携带锁定的父合同参数", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    expect(source).toContain("上传补充协议");
    expect(source).toContain("function canUploadSupplement");
    expect(source).toContain('item.relationType === "main"');
    expect(source).toContain("!item.renewalContractId");
    expect(source).toContain('["effective", "executing", "completed"]');
    expect(source).toContain("parentContractId: item.id");
    expect(source).toContain('quickSupplement: "1"');
  });

  it("租赁原合同台账只提供续签入口，不显示退租或还车", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    expect(source).toContain("function canManageRentalLifecycle");
    expect(source).toContain(
      '["house_rental", "vehicle_rental", "parking_space"]',
    );
    expect(source).toContain(">续签</el-button");
    expect(source).toContain('rentalRenewal: "1"');
    const renewalSource = source.slice(
      source.indexOf("function openRentalRenewal"),
      source.indexOf("function openSupplementUpload"),
    );
    expect(renewalSource).toContain("sourceContractId: item.id");
    expect(renewalSource).not.toContain("quickSupplement");
    expect(renewalSource).not.toContain("parentContractId");
    expect(source).toContain("!item.renewalContractId");
    expect(source).not.toContain("openRentalExit");
    expect(source).not.toContain("rentalExitLabel");
    expect(source).not.toContain('quickTermination: "1"');
    expect(source).not.toContain("rentalAction:");
  });

  it("补充协议子项展示完整金额链且付款方式变更不显示伪协议金额", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    for (const label of ["原始", "生效前", "本次增减", "生效后", "当前有效"]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("仅变更付款方式");
    expect(source).toContain(
      'item.supplementChangeType === "payment_terms_only" ? 0 : item.amount',
    );
  });

  it("待生效补充协议在主合同金额列展示变更前和变更后金额", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(source).toContain("hasProjectedAmountChange(row)");
    expect(source).toContain("变更前");
    expect(source).toContain("变更后");
    expect(source).toContain("份补充协议待生效");
    expect(backendSource).toContain("projected_amount");
    expect(backendSource).toContain("pending_supplement_count");
    expect(backendSource).toContain(
      "child.status IN ('approving', 'pending_seal')",
    );
  });

  it("管理员可在独立只读页面查看已撤销合同及保留文件", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/router/index.ts"),
      "utf8",
    );
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/CancelledContracts.vue"),
      "utf8",
    );
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );

    expect(routeSource).toContain('path: "/contracts/cancelled"');
    expect(routeSource).toContain('title: "已撤销合同", requiresAdmin: true');
    expect(pageSource).toContain("仅供管理员追溯查看");
    expect(pageSource).toContain("保留的合同文件");
    expect(pageSource).toContain('label="撤销原因"');
    expect(pageSource).toContain("row.cancellationReason");
    expect(pageSource).toContain("历史记录未填写撤销原因");
    expect(pageSource).toContain("getContractFileUrl(fileId)");
    expect(pageSource).not.toContain("恢复合同");
    expect(backendSource).toContain('router.get("/cancelled", requireFinance');
    expect(backendSource).toContain("contract_cancelled_before_seal");
    expect(backendSource).toContain("cancellationReason");
    expect(backendSource).toContain("无权查看已撤销合同文件");
  });

  it("台账序号跨分页连续且桌面表格操作按钮连续居中展示", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const sequenceColumn = source.indexOf('label="序号"');
    const contractColumn = source.indexOf('label="项目名称"');

    expect(sequenceColumn).toBeGreaterThan(-1);
    expect(contractColumn).toBeGreaterThan(sequenceColumn);
    expect(source).toContain(
      "ledgerItems.value.findIndex((root) => root.id === item.id)",
    );
    expect(source).toContain(
      "(page.value - 1) * pageSize.value + rootIndex + 1",
    );
    expect(source).toContain('header-align="center"');
    expect(source).not.toContain('align="right"');
    expect(source).not.toContain('align="left"');
    expect(source).toContain(".contract-table :deep(.cell)");
    expect(source).toContain("white-space: nowrap");
    expect(source).toContain(".row-actions {");
    expect(source).toContain("display: flex");
    expect(source).toContain("justify-content: center");
    expect(source).toContain("gap: 8px");
    expect(source).not.toContain(".row-actions.is-creator-actions");
    expect(source).not.toContain(".row-actions.is-employee-actions");
    expect(source).not.toContain(".row-actions.is-readonly-actions");
    expect(source).not.toContain(
      "grid-template-columns: 52px 104px 76px 52px 76px 96px 84px",
    );
    expect(source).toContain("contractActionColumnWidth");
    expect(source).toContain('class="action-slot action-detail"');
    expect(source).toContain('class="action-slot action-supplement"');
    expect(source).toContain('class="action-slot action-finance"');
    expect(source).toContain('class="action-slot action-renewal"');
    expect(source).toContain('v-if="canCreate && canUploadSupplement(row)"');
    expect(source).toContain(
      'v-if="canCreate && canManageRentalLifecycle(row)"',
    );
    expect(source).toMatch(
      /v-if="[\s\S]*?canCreate &&[\s\S]*?row\.relationType === 'main' &&[\s\S]*?\['effective', 'executing'\]\.includes\(row\.status\)[\s\S]*?"[\s\S]*?class="action-slot action-finance"/,
    );
    expect(source.indexOf("action-detail")).toBeLessThan(
      source.indexOf("action-supplement"),
    );
    expect(source.indexOf("action-supplement")).toBeLessThan(
      source.indexOf("action-finance"),
    );
    expect(source.indexOf("action-finance")).toBeLessThan(
      source.indexOf("action-renewal"),
    );
    expect(source).toContain(".action-slot {");
    expect(source).toMatch(/\.action-detail\s*\{\s*width:\s*52px;/);
    expect(source).toMatch(/\.action-supplement\s*\{\s*width:\s*104px;/);
    expect(source).toMatch(
      /\.action-finance,\s*\.action-status\s*\{\s*width:\s*76px;/,
    );
    expect(source).toMatch(/\.action-renewal\s*\{\s*width:\s*52px;/);
  });

  it("台账在分类右侧展示行政区域，并仅为已启用合同提供辅助材料入口", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const categoryColumn = source.indexOf('label="分类"');
    const areaColumn = source.indexOf('label="行政区域"', categoryColumn);

    expect(categoryColumn).toBeGreaterThan(-1);
    expect(areaColumn).toBeGreaterThan(categoryColumn);
    expect(source).toContain('<el-option label="不限区域" value="" />');
    expect(source).toContain('v-for="area in meta.areas"');
    expect(source).not.toContain(
      "meta.areas.filter((item) => item !== '全部')",
    );
    expect(backendSource).toContain("if (!CONTRACT_AREA_SET.has(area))");
    expect(backendSource).toContain(
      "addFilter(CONTRACT_LEDGER_ROOT_AREA_FILTER_SQL, area)",
    );
    expect(source).toContain('row.area || "—"');
    expect(source).toContain(
      'v-if="canCreate && row.requiresAuxiliaryMaterials"',
    );
    expect(source).toContain('class="action-slot action-auxiliary"');
    expect(source).toContain("添加辅助材料");
    expect(source).toContain(
      'query: contractDetailReturnQuery({ tab: "auxiliary" })',
    );
    expect(source).not.toContain("<ContractAuxiliaryPackageManager");
    expect(source).not.toContain('title="添加辅助材料"');
  });

  it("台账按合同类型使用收入与支出颜色，并显示方向标签", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    expect(source).toContain('return "is-expense"');
    expect(source).toContain('return "is-income"');
    expect(source).toContain('return "收入"');
    expect(source).toContain('return "支出"');
    expect(source).not.toContain("income-contract-row");
    expect(source).not.toContain("expense-contract-row");
    expect(source).not.toContain("contractDirectionProgressColor");
    expect(source).toContain(".direction-badge.is-income");
    expect(source).toContain(".direction-badge.is-expense");
    expect(source).toContain(".money-cell.is-income");
    expect(source).toContain(".money-cell.is-expense");
  });

  it("合同页按屏幕宽度重排指标与筛选，并关闭自适应台账横向溢出", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const desktopStyles = source.slice(
      source.indexOf(".metric-grid {"),
      source.indexOf("@media (max-width:"),
    );
    const metricGridStyles = desktopStyles.slice(
      desktopStyles.indexOf(".metric-grid {"),
      desktopStyles.indexOf(".filter-panel {"),
    );
    const filterRowStyles = desktopStyles.slice(
      desktopStyles.indexOf(".filter-row {"),
      desktopStyles.indexOf(".date-filter {"),
    );
    expect(metricGridStyles).toMatch(
      /grid-template-columns:\s*repeat\((?:auto-fit|auto-fill),\s*minmax\(/,
    );
    expect(metricGridStyles).not.toContain("grid-template-columns: repeat(7");
    expect(metricGridStyles).not.toContain("overflow-x: auto");

    expect(filterRowStyles).not.toContain("min-width: 1540px");
    expect(filterRowStyles).toMatch(
      /(?:flex-wrap:\s*wrap|grid-template-columns:\s*repeat\((?:auto-fit|auto-fill),)/,
    );

    expect(desktopStyles).toMatch(
      /\.contract-table-compact-scroll\s*\{[\s\S]*?(?:width|max-width):\s*100%;[\s\S]*?overflow-x:\s*hidden;/,
    );

    expect(source).toMatch(/@media \(max-width:\s*(?:1024|1200|1366)px\)/);
    expect(source).toContain("@media (max-width: 768px)");
  });

  it("所有桌面宽度使用十四列表头自适应表且不产生横向滚动", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const wideTableStart = source.indexOf("contract-table-full");
    const wideTableEnd = source.indexOf("</el-table>", wideTableStart);
    const wideTableSource = source.slice(wideTableStart, wideTableEnd);
    const compactTableStart = source.indexOf("contract-table-compact");
    const compactTableEnd = source.indexOf("</el-table>", compactTableStart);
    const compactTableSource = source.slice(compactTableStart, compactTableEnd);
    const compactStyles = source.slice(
      source.indexOf(".contract-table-compact-scroll"),
      source.indexOf(".lease-expiry-alert"),
    );
    const desktopMedia = source.slice(
      source.indexOf("@media (min-width: 769px)"),
      source.indexOf("@media (max-width: 768px)"),
    );
    const wideVisibilityStyles = source.slice(
      source.indexOf(".contract-table-scroll"),
      source.indexOf(".contract-table-compact-scroll"),
    );
    const mobileMedia = source.slice(
      source.indexOf("@media (max-width: 768px)"),
    );

    expect(wideTableStart).toBeGreaterThan(-1);
    expect(wideTableSource).toContain("desktop-wide-only");
    const independentLabels = [
      "序号",
      "项目名称",
      "分类",
      "行政区域",
      "合同日期",
      "租赁期限",
      "合同金额",
      "已收",
      "已付",
      "执行进度",
      "状态",
      "责任人",
      "更新时间",
      "操作",
    ];
    for (const label of independentLabels) {
      expect(wideTableSource).toContain(`label="${label}"`);
    }
    expect(wideVisibilityStyles).toMatch(
      /\.contract-table-scroll\s*\{[\s\S]*?display:\s*none;/,
    );
    expect(wideVisibilityStyles).toMatch(
      /\.desktop-wide-only\s*\{[\s\S]*?display:\s*none;/,
    );

    expect(compactTableStart).toBeGreaterThan(-1);
    expect(compactTableSource).toContain("laptop-only");
    expect(compactTableSource.match(/<el-table-column/g)).toHaveLength(14);
    for (const label of independentLabels) {
      expect(compactTableSource).toContain(`label="${label}"`);
    }
    for (const mergedLabel of [
      "合同概览",
      "日期／租期",
      "金额／收付",
      "进度／状态",
    ]) {
      expect(source).not.toContain(`label="${mergedLabel}"`);
    }
    expect(compactTableSource).toContain('table-layout="fixed"');
    expect(compactTableSource).toContain("compact-row-actions");
    expect(compactStyles).toMatch(
      /\.contract-table-compact-scroll\s*\{[\s\S]*?overflow-x:\s*hidden;/,
    );
    expect(compactStyles).toMatch(
      /\.contract-table-compact :deep\(\.el-table__body-wrapper\),[\s\S]*?overflow-x:\s*hidden(?:\s*!important)?;/,
    );
    expect(compactStyles).toContain("table-layout: fixed");
    expect(compactStyles).toContain("overflow-wrap: anywhere");
    expect(compactStyles).toContain("white-space: normal");
    expect(compactStyles).toContain("flex-wrap: wrap");
    expect(compactStyles).toMatch(
      /\.contract-table-compact[^{]*:deep\(\.el-scrollbar__bar\.is-horizontal\)\s*\{[\s\S]*?display:\s*none(?:\s*!important)?;/,
    );
    expect(desktopMedia).toContain("min-width: 769px");
    expect(desktopMedia).not.toMatch(/max-width:\s*\d+px/);
    expect(desktopMedia).toContain(".contract-table-compact-scroll");
    expect(desktopMedia).toContain("display: block");
    expect(mobileMedia).toContain(".desktop-wide-only");
    expect(mobileMedia).toContain(".contract-table-compact");
    expect(mobileMedia).toContain("display: none");
    expect(mobileMedia).toMatch(/\.mobile-only[\s\S]*?display:\s*grid;/);
  });
});
