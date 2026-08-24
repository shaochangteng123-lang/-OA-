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

const { flushPromises, mount } =
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
      category: ["main_business", "asset"],
      status: ["effective", "executing"],
      settlementStatus: "partial",
      projectId: "project-1",
      area: "城区",
      contractDateFrom: "2026-01-01",
      contractDateTo: "2026-08-05",
    });

    expect(api.get).toHaveBeenCalledWith("/api/contracts", {
      params: {
        page: 2,
        pageSize: 50,
        keyword: "示例项目",
        counterparty: "示例公司",
        category: "main_business,asset",
        status: "effective,executing",
        settlementStatus: "partial",
        projectId: "project-1",
        area: "城区",
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
    expect(source).toContain("{ immediate: true }");
    expect(source).toContain("multiple");
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
    expect(backendSource).not.toContain(
      "status NOT IN ('completed', 'rejected', 'terminated')",
    );
  });

  it("台账展示财务与责任字段，并将审批处理统一收口到审批中心", () => {
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
    expect(source).toContain('label="责任人"');
    expect(source).toContain('row.ownerName || "—"');
    expect(source).toContain("canCreate && row.status === 'draft'");
    expect(source).not.toContain("canApproveItem");
    expect(source).not.toContain("openPendingApproval");
    expect(source).not.toContain(">待审批</el-button");
    expect(source).toContain("router.push('/contract-approvals')");
    expect(source).toContain("canCreate && row.status === 'pending_seal'");
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
    expect(source).toContain('query: { tab: "finance", action: "record" }');
    expect(source).toContain('query: { tab: "seal", action: "seal" }');
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

  it("租赁期限右侧展示按根合同有效银行业务日期聚合的合同截至日期", () => {
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
    expect(source.indexOf('label="合同截至日期"')).toBeGreaterThan(
      source.indexOf('label="租赁期限"'),
    );
    expect(source).toContain("displayedContractCutoffDate(row)");
    expect(source).toContain("displayedContractCutoffDate(item)");
    expect(source).toContain('item.relationType !== "main"');
    expect(source).toContain(
      'item.status !== "completed" && item.status !== "terminated"',
    );
    expect(typeSource).toContain("contractCutoffDate?: string | null");
    expect(apiSource).toContain("source.contract_cutoff_date");
    expect(backendSource).toContain("END AS contract_cutoff_date");
    expect(backendSource).toContain(
      "roots.root_status NOT IN ('completed', 'terminated') THEN NULL",
    );
    expect(backendSource).toContain("SELECT MAX(receipt.receipt_date)");
    expect(backendSource).toContain("FROM contract_payments payment");
    expect(backendSource).toContain("FROM contract_external_payments payment");
    expect(backendSource).toContain(
      "asset_funding_mode = 'engineering_to_technology' THEN GREATEST(",
    );
    expect(backendSource).toContain(
      "roots.asset_funding_mode = 'engineering_to_technology'",
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

  it("资产类合同不占用项目名称列及导出字段", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    expect(source).toContain(
      'row.category === "asset" ? "—" : row.projectName',
    );
    expect(source).toContain("item.category !== 'asset'");
    expect(source).toContain(
      'item.category === "asset" ? "" : item.projectName',
    );
  });

  it("草拟合同名称缺失时显示上传文件名而不是系统编号", () => {
    const backendSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(backendSource).toContain("function contractListDisplayName");
    expect(backendSource).toContain("draft_file.file_name AS source_file_name");
    expect(backendSource).toContain("? `草拟：${sourceFileName}`");
    expect(backendSource).toContain("name: contractListDisplayName(row)");
    expect(backendSource).not.toContain(
      'name: row.title || row.project_name || row.contract_no || "未命名合同"',
    );
  });

  it("合同信息列显示合同名称和编号", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const columnStart = source.indexOf('label="合同信息"');
    const columnEnd = source.indexOf("</el-table-column>", columnStart);
    const columnSource = source.slice(columnStart, columnEnd);
    expect(columnSource).toContain("contractDisplayName(row)");
    expect(columnSource).toContain("contractNumberText(row)");
    expect(source).toContain("function contractNumberText");
  });

  it("关联协议子行完整换行显示名称且不重复层级符号和协议标识", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const columnStart = source.indexOf('label="合同信息"');
    const columnEnd = source.indexOf("</el-table-column>", columnStart);
    const columnSource = source.slice(columnStart, columnEnd);
    expect(columnSource).toContain(':title="contractDisplayName(row)"');
    expect(columnSource).toContain("shouldShowRelationBadge(row)");
    expect(columnSource).not.toContain('class="relation-branch"');
    expect(columnSource).not.toContain("show-overflow-tooltip");
    expect(source).toContain("function shouldShowRelationBadge");
    expect(source).toContain("!normalizedName.includes(normalizedLabel)");
    expect(source).toContain("overflow-wrap: anywhere");
    expect(source).toContain("white-space: normal");
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
      .findAll("tr.el-table__row")
      .filter((row) => !row.classes().includes("related-contract-row"));
    expect(mainRows).toHaveLength(2);
    expect(mainRows.map((row) => row.find("td").text())).toEqual(["1", "2"]);

    expect(
      wrapper.findAll(".mobile-contract-card.is-related-contract"),
    ).toHaveLength(0);
    const mobileToggle = wrapper
      .findAll(".mobile-card-actions button")
      .find((button) => button.text().includes("展开 2 份关联协议"));
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

    const relatedRows = wrapper.findAll("tr.related-contract-row");
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

  it("台账序号跨分页连续且桌面表格统一居中单行展示", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const sequenceColumn = source.indexOf('label="序号"');
    const contractColumn = source.indexOf('label="合同信息"');

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
    expect(source).toContain("justify-content: center");
  });

  it("台账在项目名称右侧展示行政区域，并仅为已启用合同提供辅助材料入口", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const projectColumn = source.indexOf('label="项目名称"');
    const areaColumn = source.indexOf('label="行政区域"', projectColumn);

    expect(projectColumn).toBeGreaterThan(-1);
    expect(areaColumn).toBeGreaterThan(projectColumn);
    expect(source).toContain('<el-option label="全部" value="" />');
    expect(source).toContain('row.area || "—"');
    expect(source).toContain(
      'v-if="canCreate && row.requiresAuxiliaryMaterials"',
    );
    expect(source).toContain("添加辅助材料");
    expect(source).toContain('query: { tab: "auxiliary" }');
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

  it("桌面筛选项保持同一行且仅移动端改为单列", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const desktopStyles = source.slice(
      source.indexOf(".metric-grid {"),
      source.indexOf("@media (max-width: 1366px)"),
    );
    const tabletStyles = source.slice(
      source.indexOf("@media (max-width: 1366px)"),
      source.indexOf("@media (max-width: 768px)"),
    );
    const mobileStyles = source.slice(
      source.indexOf("@media (max-width: 768px)"),
    );

    expect(desktopStyles).toContain("overflow-x: auto");
    expect(desktopStyles).toContain("min-width: 1540px");
    expect(desktopStyles).toContain("repeat(5, minmax(125px, 1fr))");
    expect(desktopStyles).toContain(
      "grid-template-columns: repeat(7, minmax(190px, 1fr))",
    );
    expect(desktopStyles).toMatch(
      /\.date-filter\s*\{[\s\S]*?grid-column: auto;/,
    );
    expect(desktopStyles).toMatch(
      /\.filter-actions\s*\{[\s\S]*?grid-column: auto;/,
    );
    expect(tabletStyles).not.toContain(".filter-row");
    expect(tabletStyles).not.toContain(".metric-grid");
    expect(mobileStyles).toMatch(
      /\.filter-row\s*\{[\s\S]*?min-width: 0;[\s\S]*?grid-template-columns: 1fr;/,
    );
    expect(mobileStyles).toMatch(
      /\.metric-grid\s*\{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?overflow-x: visible;/,
    );
  });
});
