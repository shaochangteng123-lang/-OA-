import fs from "fs";
import path from "path";

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("福利2报销前端接入", () => {
  const configSource = read("src/utils/reimbursement/typeConfig.ts");
  const routerSource = read("src/router/index.ts");
  const layoutSource = read("src/layouts/MainLayout.vue");
  const createSource = read("src/views/LargeReimbursementCreate.vue");
  const detailSource = read("src/views/LargeReimbursementDetail.vue");
  const approvalSource = read("src/views/ApprovalCenter.vue");
  const managementSource = read("src/views/ReimbursementManagement.vue");

  it("集中定义福利2的柔和配色、路由和分类接口", () => {
    expect(configSource).toContain('type: "welfare_two"');
    expect(configSource).toContain('label: "福利2报销"');
    expect(configSource).toContain('accentColor: "#c77d9a"');
    expect(configSource).toContain('listRoute: "/welfare-two-reimbursement"');
    expect(configSource).toContain(
      'scopeListEndpoint: "/api/reimbursement-scope/welfare-two/list"',
    );
    expect(configSource).toContain(
      'scopeManagementBase: "/api/reimbursement-scope/welfare-two"',
    );
  });

  it("福利2入口位于福利1下方并仅向董事长显示", () => {
    const welfareOnePosition = layoutSource.indexOf(
      'path="/welfare-one-reimbursement"',
    );
    const welfareTwoPosition = layoutSource.indexOf(
      'path="/welfare-two-reimbursement"',
    );
    expect(welfareTwoPosition).toBeGreaterThan(welfareOnePosition);
    expect(layoutSource.slice(welfareOnePosition, welfareTwoPosition + 300)).toContain(
      'v-if="isChairman"',
    );
    expect(routerSource).toMatch(
      /path: "\/welfare-two-reimbursement"[\s\S]*?requiresRole: \["chairman"\]/,
    );
    expect(routerSource).toMatch(
      /path: "\/welfare-two-reimbursement\/:id"[\s\S]*?requiresAdmin: true/,
    );
  });

  it("复用福利页面并提交、回填独立分类", () => {
    expect(routerSource).toContain(
      'props: { reimbursementType: "welfare_two" }',
    );
    expect(createSource).toContain("['welfare_one', 'welfare_two']");
    expect(createSource).toContain("welfareCategoryId: selectedScope");
    expect(detailSource).toContain("welfareCategoryName");
    expect(detailSource).not.toContain("show-threshold-warning");
  });

  it("审批中心、统计、范围筛选与紫色之外的标签色支持福利2", () => {
    expect(approvalSource).toContain("statistics.welfareTwoStats");
    expect(approvalSource).toContain(
      "api.get('/api/reimbursement-scope/welfare-two/list')",
    );
    expect(approvalSource).toContain("welfareTwoScopeList");
    expect(approvalSource).toContain("startsWith('welfare_')");
  });

  it("福利1和福利2分类均使用删除接口并展示引用冲突", () => {
    expect(managementSource).toContain('name="welfare_one"');
    expect(managementSource).toContain('name="welfare_two"');
    expect(managementSource).toContain("api.delete(`${managementBase.value}/${row.id}`)");
    expect(managementSource).toContain("已被报销记录引用，无法删除");
    expect(managementSource).not.toContain("停用成功");
  });
});
