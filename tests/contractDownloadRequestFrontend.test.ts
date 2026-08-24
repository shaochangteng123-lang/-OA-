import fs from "fs";
import path from "path";

function source(file: string) {
  return fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
}

describe("合同下载申请前端权限与流程", () => {
  const routerSource = source("src/router/index.ts");
  const layoutSource = source("src/layouts/MainLayout.vue");
  const listSource = source("src/views/ContractList.vue");
  const detailSource = source("src/views/ContractDetail.vue");
  const createSource = source("src/views/ContractDownloadRequestCreate.vue");
  const centerSource = [
    source("src/views/ContractDownloadRequestCenter.vue"),
    source(
      "src/components/contracts/ContractDownloadRequestReadonlyDetails.vue",
    ),
  ].join("\n");
  const apiSource = source("src/utils/contractDownloadApi.ts");
  const groupSource = source("src/layouts/components/SidebarGroup.vue");

  it("员工可进入合同台账与本人下载申请，但不能进入合同业务审批", () => {
    const contractListRoute = routerSource.slice(
      routerSource.indexOf('path: "/contracts"'),
      routerSource.indexOf('path: "/contracts/create"'),
    );
    const approvalRoute = routerSource.slice(
      routerSource.indexOf('path: "/contract-approvals"'),
      routerSource.indexOf('path: "/contract-applications/mine"'),
    );
    expect(contractListRoute).toContain('"user"');
    expect(approvalRoute).toContain('requiresRole: ["general_manager"]');
    expect(approvalRoute).not.toContain('"user"');
    expect(layoutSource).toContain('v-if="isProjectUser"');
    expect(layoutSource).toContain('label="我的申请"');
    expect(layoutSource).not.toContain('label="我的下载申请"');
    expect(layoutSource).toContain('label="下载申请审批"');
    expect(layoutSource).toContain('label="合同待办"');
    expect(layoutSource).toContain('path="/contract-tasks"');
    expect(layoutSource).toContain("isContractDownloadExecutor");
    expect(routerSource).toContain('requiresRole: ["admin"]');
  });

  it("员工台账显示申请下载入口，详情隐藏直接下载并使用当前页纯预览", () => {
    expect(listSource).toContain('v-if="isEmployee"');
    expect(listSource).toContain(">申请下载</el-button");
    expect(listSource).toContain('path: "/contract-download-requests/new"');
    expect(detailSource).toContain('v-if="canDirectDownload"');
    expect(detailSource).toContain("const isEmployee = computed");
    expect(detailSource).toContain("<ContractReadOnlyPreview");
    expect(detailSource).toContain("readonlyPreviewVisible.value = true");
    expect(detailSource).toContain("if (canDirectDownload.value)");
    expect(detailSource).toContain("window.open(");
    expect(detailSource).not.toContain("employeePreviewVisible");
  });

  it("申请单自动带入合同信息、选择附件、填写用途并调用本人签名", () => {
    expect(createSource).toContain("合同附件下载申请单");
    expect(createSource).toContain("detail.contract.contractNo");
    expect(createSource).toContain("detail.contract.area");
    expect(createSource).toContain("detail.value.contract.status");
    expect(createSource).toContain('v-model="selectedFileIds"');
    expect(createSource).toContain('v-model="purpose"');
    expect(createSource).toContain("loadPersonalSignature");
    expect(createSource).toContain("getAvailableContractDownloadFiles");
    expect(createSource).toContain("file.fileTypeLabel");
    expect(createSource).not.toContain("signatureDataUrl:");
    expect(createSource).toContain("总经理 刘行");
    expect(createSource).toContain("管理员 吴静雯");
  });

  it("总经理审批、管理员执行及员工结果查询共用完整流程展示", () => {
    expect(centerSource).toContain("待我审批");
    expect(centerSource).toContain("审批记录");
    expect(centerSource).toContain('class="approval-hero"');
    expect(centerSource).toContain('class="approval-tabs"');
    expect(centerSource).toContain('class="card-heading"');
    expect(centerSource).toContain('class="search-input"');
    expect(centerSource).toContain("handleManagerTabChange");
    expect(centerSource).toContain("keyword.value.trim()");
    expect(centerSource).toContain("同意");
    expect(centerSource).not.toContain("在申请单中签字");
    expect(centerSource).toContain('class="manager-decision-footer"');
    expect(centerSource).toContain("总经理本人签名");
    expect(centerSource).toContain("下载指定文件");
    expect(centerSource).toContain("标记已处理");
    expect(centerSource).toContain("processingNote");
    expect(centerSource).toContain("item.approver.comment");
    expect(centerSource).toContain("查看签名申请单");
    expect(centerSource).toContain("file.downloadedAt");
    expect(centerSource).toContain("completed: node.status === 'completed'");
    expect(centerSource).toContain("current: node.status === 'current'");
    expect(centerSource).toContain("rejected: node.status === 'rejected'");
    expect(centerSource).toContain("withdrawn: node.status === 'withdrawn'");
    expect(centerSource).toContain(".flow-line span.completed");
    expect(centerSource).toContain(".flow-line span.current");
    expect(centerSource).toContain('draft_contract: "草拟合同"');
    expect(centerSource).toContain('payment_request: "请款单"');
    expect(centerSource).toContain('payment: "付款回单"');
    expect(apiSource).toContain("/api/contract-download-requests");
    expect(apiSource).toContain("/decision");
    expect(apiSource).toContain('decision: "approve"');
    expect(apiSource).toContain('decision: "reject"');
    expect(apiSource).toContain("/complete");
    expect(apiSource).toContain("/manager-processed/export");
    expect(apiSource).toContain("/admin-processed/export");
    expect(apiSource).toContain("/application-preview");
    expect(apiSource).toContain("/preview");
    expect(apiSource).not.toContain("allItems.slice");
    expect(centerSource).toContain("<ContractReadOnlyPreview");
    expect(centerSource).toContain("readonlyPreviewVisible.value = true");
    expect(centerSource).toContain('if (mode.value !== "mine")');
    expect(centerSource.match(/window\.open\(previewUrl/g)).toHaveLength(2);
    expect(centerSource).not.toContain("applicationPreviewVisible");
    expect(centerSource).toContain("v-if=\"mode === 'mine'\"");
  });

  it("总经理在申请卡片内填写意见并签字批准，驳回对话框不包含签名区", () => {
    expect(centerSource).toContain("同意");
    expect(centerSource).toContain("openDecision(item, 'approve')");
    expect(centerSource).toContain('class="manager-decision-footer"');
    expect(centerSource).toContain("申请单总经理审批签字区");
    expect(centerSource).toContain("inlineApprovalRequestId === item.id");
    expect(centerSource).toContain("总经理本人签名");
    expect(centerSource).toContain("签字并批准");
    expect(centerSource).toContain("cancelInlineApproval");
    expect(centerSource).toContain("scrollIntoView");
    const rejectDialogSource = centerSource.slice(
      centerSource.indexOf('title="驳回合同下载申请"'),
      centerSource.indexOf('title="标记下载申请已处理"'),
    );
    expect(rejectDialogSource).toContain("确认驳回");
    expect(rejectDialogSource).not.toContain("manager-signature-slot");
  });

  it("员工撤回后的最新叶子可删除且删除前二次确认", () => {
    expect(centerSource).toContain("item.canDelete");
    expect(centerSource).toContain("删除申请");
    expect(centerSource).toContain("deleteWithdrawnRequest");
    expect(centerSource).toContain("确认删除下载申请");
    expect(centerSource).toContain(
      "deleteWithdrawnContractDownloadRequest(item.id, item.version)",
    );
    expect(apiSource).toContain("deleteWithdrawnContractDownloadRequest");
    expect(apiSource).toContain("expectedVersion");
  });

  it("管理员处理记录支持服务端关键词搜索和Excel导出", () => {
    expect(centerSource).toContain("v-if=\"mode === 'admin'\"");
    expect(centerSource).toContain("admin-history-search");
    expect(centerSource).toContain("handleSearch");
    expect(centerSource).toContain("导出Excel");
    expect(centerSource).toContain("exportAdminHistory");
    expect(centerSource).toContain('mode.value === "admin"');
    expect(apiSource).toContain("getAdminContractDownloadHistoryExportUrl");
  });

  it("总经理可在待我审批和审批记录之间切换且历史页没有审批按钮", () => {
    expect(apiSource).toContain('"manager_processed"');
    expect(centerSource).toContain("待我审批");
    expect(centerSource).toContain("审批记录");
    expect(centerSource).toContain('route.query.view === "history"');
    expect(centerSource).toContain("setManagerView('pending')");
    expect(centerSource).toContain("setManagerView('history')");
    expect(centerSource).toContain('? "manager_processed"');
    expect(centerSource).toContain(
      "查看本人已经批准及后续处理中或已完成的下载申请。",
    );
    expect(centerSource).toContain("managerView === 'pending'");
    expect(centerSource).toContain("managerView === 'history'");
    expect(centerSource).toContain("exportManagerHistory");
    expect(centerSource).toContain(
      "getManagerContractDownloadHistoryExportUrl",
    );
    expect(centerSource).toContain('class="manager-history-tools"');
    expect(centerSource).toContain(
      ".card-heading > div:not(.manager-history-tools)",
    );
    expect(centerSource).toContain("flex-wrap: nowrap");
    expect(centerSource).toContain(".manager-history-tools .search-input");
    expect(centerSource).not.toContain(
      'v-if="managerView === \'history\'"\n              :icon="Download"',
    );
    expect(centerSource).toContain("item.approver.decidedAt");
    expect(centerSource).toContain("总经理签字时间");
    expect(centerSource).toContain("getContractDownloadApplicationPreviewUrl");
    expect(centerSource).toContain("approvalHistory");
    expect(centerSource).toContain("router.replace");
    expect(centerSource).toContain("query: { ...route.query, view }");
  });

  it("总经理审批记录使用紧凑表格且同一时间只展开一条详情", () => {
    expect(centerSource).toContain('class="history-table-shell"');
    expect(centerSource).toContain("<el-table");
    expect(centerSource).toContain('type="expand"');
    expect(centerSource).toContain('type="index"');
    expect(centerSource).toContain(':index="historyIndex"');
    expect(centerSource).toContain("审批结果");
    expect(centerSource).toContain("已批准");
    expect(centerSource).toContain("签字时间");
    expect(centerSource).toContain("row.attemptNo");
    expect(centerSource).toContain("row.requestNo");
    expect(centerSource).toContain(
      "return (page.value - 1) * pageSize + itemIndex + 1",
    );
    expect(centerSource).toContain("const expandedHistoryRequestId = ref");
    expect(centerSource).toContain(':expand-row-keys="');
    expect(centerSource).toContain('@expand-change="handleHistoryExpand"');
    expect(centerSource).toContain("expandedRows.some");
    expect(centerSource).toContain("expandedHistoryRequestId.value =");
    expect(centerSource).toContain("handlePageChange");
    expect(centerSource).toContain('@current-change="handlePageChange"');
    expect(centerSource).toContain("<ContractDownloadRequestReadonlyDetails");
    expect(centerSource).toContain(".history-table-shell {");
    expect(centerSource).toContain("overflow-x: auto");
    expect(centerSource).not.toContain(".history-summary {");
    expect(centerSource).not.toContain("history-toggle");
  });

  it("总经理下载待审批卡片与审批记录均显示跨分页连续序号", () => {
    expect(centerSource).toContain('v-for="(item, index) in items"');
    expect(centerSource).toContain('class="approval-serial"');
    expect(centerSource).toContain(
      "v-if=\"mode === 'manager' && managerView === 'pending'\"",
    );
    expect(centerSource).toContain("historyIndex(index)");
    expect(centerSource).toContain(':index="historyIndex"');
    expect(centerSource).toContain(
      "return (page.value - 1) * pageSize + itemIndex + 1",
    );
  });

  it("管理员可切换待我处理和处理记录且历史默认折叠只读", () => {
    expect(apiSource).toContain('"admin_processed"');
    expect(centerSource).toContain("待我处理");
    expect(centerSource).toContain("处理记录");
    expect(centerSource).toMatch(
      /\.manager-view-switch\s*\{[\s\S]*?flex:\s*0 0 auto;/,
    );
    expect(centerSource).toMatch(
      /\.manager-view-switch button\s*\{[\s\S]*?white-space:\s*nowrap;/,
    );
    expect(centerSource).toContain("setAdminView('pending')");
    expect(centerSource).toContain("setAdminView('history')");
    expect(centerSource).toContain("const isAdminHistory = computed");
    expect(centerSource).toContain('? "admin_processed"');
    expect(centerSource).toContain("const isAdminHistory = computed");
    expect(centerSource).toContain("处理结果");
    expect(centerSource).toContain("已处理");
    expect(centerSource).toContain("完成时间");
    expect(centerSource).toContain("item.executor.completedAt");
    expect(centerSource).toContain("item.executor.note");
    expect(centerSource).toContain("adminView === 'pending'");
    expect(centerSource.match(/if \(mode\.value !== "mine"\)/g)).toHaveLength(
      2,
    );
    expect(centerSource.match(/window\.open\(previewUrl/g)).toHaveLength(2);
    expect(centerSource).toContain("v-if=\"mode === 'mine'\"");
  });

  it("员工可切换当前申请和历史申请并复用紧凑历史表格", () => {
    expect(apiSource).toContain('"employee_history"');
    expect(centerSource).toContain("当前申请");
    expect(centerSource).toContain("历史申请");
    expect(centerSource).toContain("setEmployeeView('pending')");
    expect(centerSource).toContain("setEmployeeView('history')");
    expect(centerSource).toContain("const isEmployeeHistory = computed");
    expect(centerSource).toContain('? "employee_history"');
    expect(centerSource).toContain("isEmployeeHistory.value");
    expect(centerSource).toContain("申请状态");
    expect(centerSource).toContain("更新时间");
    expect(centerSource).toContain("下载用途");
    expect(centerSource).toContain(
      ".history-table :deep(.el-table__header-wrapper th .cell)",
    );
    expect(centerSource).toContain("history-table-center-all");
    expect(centerSource).toContain("'history-table-center-all': isHistoryView");
    expect(centerSource).toContain(
      ".history-table-center-all :deep(.el-table__body-wrapper td .cell)",
    );
    expect(centerSource).toContain("text-align: center");
  });

  it("员工可撤回待审批申请并修改被驳回或已撤回申请后重新提交", () => {
    expect(apiSource).toContain("withdrawContractDownloadRequest");
    expect(apiSource).toContain("/withdraw");
    expect(apiSource).toContain("resubmitContractDownloadRequest");
    expect(apiSource).toContain("/resubmit");
    expect(apiSource).toContain("expectedVersion");
    expect(centerSource).toContain("item.canWithdraw");
    expect(centerSource).toContain("item.canResubmit");
    expect(centerSource).toContain("撤回申请");
    expect(centerSource).toContain("修改并重新提交");
    expect(centerSource).toContain('class="employee-actions"');
    expect(centerSource).toContain(".employee-actions {");
    expect(centerSource).toContain("justify-content: flex-end");
    expect(centerSource).toContain("margin-left: auto");
    expect(centerSource).toContain("resubmitRequestId");
    expect(createSource).toContain("getContractDownloadRequest");
    expect(createSource).toContain("resubmitContractDownloadRequest");
    expect(createSource).toContain("sourceRequest.purpose");
    expect(createSource).toContain("file.contractFileId");
    expect(createSource).toContain("resubmitSource.value.version");
  });

  it("审批记录按同一申请链展示申请、驳回、撤回和重新提交且不混入逐文件下载", () => {
    expect(centerSource).toContain("item.chainHistory");
    expect(centerSource).toContain('entry.action !== "download_file"');
    expect(centerSource).toContain('submit: "员工申请"');
    expect(centerSource).toContain('reject: "总经理驳回"');
    expect(centerSource).toContain('withdraw: "员工撤回"');
    expect(centerSource).toContain('resubmit: "员工重新提交"');
    expect(centerSource).toContain(
      'entry.action === "resubmit" && entry.fromStatus === "withdrawn"',
    );
    expect(centerSource).toContain('return "员工申请"');
    expect(centerSource).toContain('approve: "总经理批准"');
    expect(centerSource).toContain('complete: "管理员处理完成"');
    expect(centerSource).toContain("完整审批记录");
    expect(centerSource).toContain("总经理已驳回，可修改后重新提交");
  });

  it("员工驳回结果醒目展示并仅在当前页渲染后确认可见结果已读", () => {
    expect(centerSource).toContain("下载申请已被总经理驳回");
    expect(centerSource).toContain("item.approver.comment");
    expect(centerSource).toContain(':closable="false"');
    expect(centerSource).toContain("visibleResultIds");
    expect(centerSource).toContain('item.status !== "pending_approval"');
    expect(centerSource).toContain("await nextTick()");
    expect(centerSource).toContain(
      "acknowledgeContractDownloadResults(visibleResultIds)",
    );
    expect(apiSource).toContain("requestIds: string[]");
    expect(apiSource).toContain("requestIds,");
  });

  it("按角色显示合同管理数字角标并在员工查看结果后确认已读", () => {
    expect(apiSource).toContain("/pending-counts");
    expect(apiSource).toContain("/notifications/acknowledge");
    expect(apiSource).toContain('"unreadResults"');
    expect(apiSource).toContain('"managerPending"');
    expect(apiSource).toContain('"executorPending"');
    expect(layoutSource).toContain(':badge="contractGroupBadge"');
    expect(layoutSource).toContain("contractPendingCount.value +");
    expect(layoutSource).toContain(
      "contractDownloadApprovalPendingCount.value +",
    );
    expect(layoutSource).toContain(
      "invoiceApplicationApprovalPendingCount.value",
    );
    expect(layoutSource).toContain("contractPendingSealCount.value +");
    expect(layoutSource).toContain(
      "contractDownloadExecutorPendingCount.value",
    );
    expect(layoutSource).toContain("myContractApplicationPendingCount.value");
    expect(layoutSource).toContain("getContractDownloadPendingCounts");
    expect(layoutSource).toContain("CONTRACT_DOWNLOAD_BADGE_REFRESH_EVENT");
    expect(groupSource).toContain('class="group-badge-dot"');
    expect(groupSource).toContain('class="group-title-badge-dot"');
    expect(groupSource).toContain('aria-label="存在待办事项"');
    expect(groupSource).not.toContain("group-badge-count");
    expect(groupSource).not.toContain('{{ badge || "" }}');
    expect(centerSource).toContain("acknowledgeContractDownloadResults");
    expect(centerSource).toContain("requestContractDownloadBadgeRefresh");
  });
});
