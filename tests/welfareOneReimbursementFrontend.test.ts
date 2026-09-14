import fs from "fs";
import path from "path";

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("福利1报销前端接入", () => {
  const configSource = read("src/utils/reimbursement/typeConfig.ts");
  const routerSource = read("src/router/index.ts");
  const layoutSource = read("src/layouts/MainLayout.vue");
  const listSource = read("src/views/LargeReimbursement.vue");
  const createSource = read("src/views/LargeReimbursementCreate.vue");
  const detailSource = read("src/views/LargeReimbursementDetail.vue");
  const approvalSource = read("src/views/ApprovalCenter.vue");
  const managementSource = read("src/views/ReimbursementManagement.vue");
  const settingsSource = read("src/views/Settings.vue");

  it("集中定义福利1类型、紫色主题、路由和独立分类接口", () => {
    expect(configSource).toContain('type: "welfare_one"');
    expect(configSource).toContain('label: "福利1报销"');
    expect(configSource).toContain('accentColor: "#8b5cf6"');
    expect(configSource).toContain('listRoute: "/welfare-one-reimbursement"');
    expect(configSource).toContain(
      'scopeListEndpoint: "/api/reimbursement-scope/welfare-one/list"',
    );
    expect(configSource).not.toMatch(
      /welfare_one:[\s\S]*?minimumAmount:\s*1000/,
    );
  });

  it("仅向董事长展示入口，并允许管理员从审批中心打开详情", () => {
    expect(layoutSource).toMatch(
      /v-if="isChairman"[\s\S]*?path="\/welfare-one-reimbursement"/,
    );
    expect(routerSource).toMatch(
      /path: "\/welfare-one-reimbursement"[\s\S]*?requiresRole: \["chairman"\]/,
    );
    expect(routerSource).toMatch(
      /path: "\/welfare-one-reimbursement\/:id"[\s\S]*?requiresAdmin: true/,
    );
    expect(routerSource).toMatch(
      /path: "\/approval\/payment\/:id"[\s\S]*?requiresExactRole: true/,
    );
  });

  it("通过配置复用大额列表、新建和详情布局", () => {
    expect(routerSource).toContain(
      'component: () => import("@/views/LargeReimbursement.vue")',
    );
    expect(routerSource).toContain(
      'component: () => import("@/views/LargeReimbursementCreate.vue")',
    );
    expect(routerSource).toContain(
      'component: () => import("@/views/LargeReimbursementDetail.vue")',
    );
    expect(listSource).toContain("typeConfig.value.type");
    expect(createSource).toContain("welfareCategoryId: selectedScope");
    expect(detailSource).toContain("!isWelfareReimbursement");
    expect(detailSource).toContain("welfareCategoryId");
  });

  it("审批中心展示福利1且董事长不显示付款动作", () => {
    expect(approvalSource).toContain("REIMBURSEMENT_FILTER_OPTIONS");
    expect(approvalSource).toContain("statistics.welfareOneStats");
    expect(approvalSource).toContain("getReimbursementTypeRoute");
    expect(approvalSource).toContain(
      "const canHandlePayment = computed(() => authStore.user?.role !== 'chairman')",
    );
    expect(approvalSource).toContain('v-if="canHandlePayment"');
    expect(approvalSource).toContain("auto_approved");
  });

  it("范围管理和董事长收款资料使用独立接口", () => {
    expect(managementSource).toContain('name="welfare_one"');
    expect(managementSource).toContain("scopeManagementBase");
    expect(managementSource).toContain('name="welfare_two"');
    expect(managementSource).toContain("已被报销记录引用，无法删除");
    expect(settingsSource).toContain('v-if="isChairman"');
    expect(settingsSource).toContain('api.get("/api/users/me/payment-profile")');
    expect(settingsSource).toContain('"/api/users/me/payment-profile"');
  });
});
