import fs from "fs";
import path from "path";

describe("合同管理侧边栏归属", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/layouts/MainLayout.vue"),
    "utf8",
  );

  it("在人力资源区下方、项目区上方使用独立分组", () => {
    const hrPosition = source.indexOf("<!-- 人力资源区 -->");
    const contractPosition = source.indexOf("<!-- 合同管理：");
    const projectPosition = source.indexOf("<!-- 项目区 -->");

    expect(hrPosition).toBeGreaterThan(-1);
    expect(contractPosition).toBeGreaterThan(hrPosition);
    expect(projectPosition).toBeGreaterThan(contractPosition);

    const contractSection = source.slice(contractPosition, projectPosition);
    expect(contractSection).toContain(
      'v-if="!isBoss && (isAdmin || isGeneralManager || isProjectUser)"',
    );
    expect(contractSection).toContain('title="合同管理"');
    expect(contractSection).toContain(
      'v-if="isAdmin || isGeneralManager || isProjectUser"',
    );
    expect(contractSection).toContain('group-key="contract"');
    expect(contractSection).toContain('path="/contracts"');
    expect(contractSection).toContain('path="/contract-dashboard"');
    expect(contractSection).toContain('path="/contract-approvals"');
    expect(contractSection).toContain('v-if="isGeneralManager"');
    expect(contractSection).toContain('path="/contract-applications/mine"');
    expect(contractSection).toContain('label="我的申请"');
    expect(contractSection).not.toContain('label="我的下载申请"');
    expect(contractSection).not.toContain('label="我的开票申请"');
    expect(contractSection).toContain(
      'path="/contract-download-requests/approval"',
    );
    expect(contractSection).toContain('path="/contract-tasks"');
    expect(contractSection).toContain('label="合同待办"');
    expect(contractSection).not.toContain('label="合同下载待办"');
    expect(contractSection).not.toContain('label="开票与用印待办"');
    expect(contractSection).toContain("contractTaskPendingCount");
    expect(contractSection).toContain("contractPendingSealCount");
    expect(contractSection).toContain(
      "isAdmin && contractPendingSealCount > 0",
    );
    expect(source).toContain("getContractPendingSealCount");
    expect(source).toContain("contractPendingSealCount.value =");
  });

  it("财务区不再包含任何合同入口或合同待办", () => {
    const financePosition = source.indexOf("<!-- 财务区 -->");
    const hrPosition = source.indexOf("<!-- 人力资源区 -->");
    const financeSection = source.slice(financePosition, hrPosition);

    expect(financeSection).not.toContain('path="/contracts"');
    expect(financeSection).not.toContain('path="/contract-dashboard"');
    expect(financeSection).not.toContain('path="/contract-approvals"');

    const financeBadgeBlock = source.slice(
      source.indexOf("const financeGroupHasBadge"),
      source.indexOf("const contractGroupBadge"),
    );
    expect(financeBadgeBlock).not.toContain("contractPendingCount");
  });

  it("保留经营管理账号的合同只读入口", () => {
    const bossPosition = source.indexOf("<!-- BOSS经营区 -->");
    const officePosition = source.indexOf("<!-- 办公区 -->");
    const bossSection = source.slice(bossPosition, officePosition);

    expect(bossSection).toContain('path="/contracts"');
    expect(bossSection).toContain('path="/contract-dashboard"');
    expect(bossSection).not.toContain('path="/contract-approvals"');
    expect(bossSection).not.toContain('path="/contracts/create"');
  });

  it("合同审批路由仅允许总经理，员工和管理员均不能进入", () => {
    const routerSource = fs.readFileSync(
      path.resolve(__dirname, "../src/router/index.ts"),
      "utf8",
    );
    const approvalRouteStart = routerSource.indexOf(
      'path: "/contract-approvals"',
    );
    const approvalRouteEnd = routerSource.indexOf(
      'path: "/contract-applications/mine"',
      approvalRouteStart,
    );
    const approvalRoute = routerSource.slice(
      approvalRouteStart,
      approvalRouteEnd,
    );

    expect(approvalRoute).toContain('requiresRole: ["general_manager"]');
    expect(approvalRoute).not.toContain('"user"');
    expect(approvalRoute).not.toContain('"admin"');
    expect(approvalRoute).not.toContain('"super_admin"');
    expect(approvalRoute).not.toContain('"chairman"');
  });

  it("合同和开票待办操作完成后立即请求刷新侧边栏角标", () => {
    const approvalCenter = fs.readFileSync(
      path.resolve(__dirname, "../src/views/ContractApprovalCenter.vue"),
      "utf8",
    );
    expect(approvalCenter).toContain("requestContractDownloadBadgeRefresh");
    expect(approvalCenter).toMatch(
      /handleApprovalCompleted[\s\S]*requestContractDownloadBadgeRefresh\(\)/,
    );
    expect(source).toContain(
      'window.addEventListener("focus", refreshContractBadges)',
    );
    expect(source).toContain(
      'window.removeEventListener("focus", refreshContractBadges)',
    );
  });

  it("一级分组只显示红点，二级菜单继续显示具体数量", () => {
    const groupSource = fs.readFileSync(
      path.resolve(__dirname, "../src/layouts/components/SidebarGroup.vue"),
      "utf8",
    );
    expect(groupSource).toContain('class="group-badge-dot"');
    expect(groupSource).toContain('class="group-title-badge-dot"');
    expect(groupSource).not.toContain("group-badge-count");
    expect(groupSource).not.toContain('{{ badge || "" }}');
    expect(source).toContain('label="合同审批"');
    expect(source).toContain('badge-type="danger"');
  });

  it("合同、下载和开票审批使用一致的工作台页面结构", () => {
    const contractApproval = fs.readFileSync(
      path.resolve(__dirname, "../src/views/ContractApprovalCenter.vue"),
      "utf8",
    );
    const downloadApproval = fs.readFileSync(
      path.resolve(__dirname, "../src/views/ContractDownloadRequestCenter.vue"),
      "utf8",
    );
    const invoiceApproval = fs.readFileSync(
      path.resolve(__dirname, "../src/views/InvoiceApplicationCenter.vue"),
      "utf8",
    );
    for (const className of [
      "approval-hero",
      "hero-kicker",
      "hero-actions",
      "pending-total",
      "approval-card",
      "approval-tabs",
      "card-heading",
      "search-input",
      "pagination",
    ]) {
      expect(contractApproval).toContain(className);
      expect(downloadApproval).toContain(className);
      expect(invoiceApproval).toContain(className);
    }
    expect(downloadApproval).toContain('label="待我审批"');
    expect(downloadApproval).toContain('label="审批记录"');
    expect(invoiceApproval).toContain('label="待我审批"');
    expect(invoiceApproval).toContain('label="审批记录"');
    expect(contractApproval).toContain('v-for="(item, index) in pendingItems"');
    expect(contractApproval).toContain(
      'v-for="(item, index) in processedItems"',
    );
    expect(contractApproval).toContain("approvalListIndex(index)");
    expect(contractApproval).toContain(
      "return (page.value - 1) * pageSize + index + 1",
    );
  });
});
