import fs from "fs";
import path from "path";

function source(file: string) {
  return fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
}

describe("开票申请前端流程", () => {
  const routerSource = source("src/router/index.ts");
  const layoutSource = source("src/layouts/MainLayout.vue");
  const listSource = source("src/views/ContractList.vue");
  const createSource = source("src/views/InvoiceApplicationCreate.vue");
  const centerSource = source("src/views/InvoiceApplicationCenter.vue");
  const myApplicationsSource = source("src/views/MyContractApplications.vue");
  const apiSource = source("src/utils/invoiceApplicationApi.ts");

  it("按员工、总经理和管理员隔离开票申请路由", () => {
    const createRoute = routerSource.slice(
      routerSource.indexOf('path: "/invoice-applications/new"'),
      routerSource.indexOf('path: "/invoice-applications/mine"'),
    );
    const managerRoute = routerSource.slice(
      routerSource.indexOf('path: "/invoice-applications/approval"'),
      routerSource.indexOf('path: "/invoice-applications/tasks"'),
    );
    const adminRoute = routerSource.slice(
      routerSource.indexOf('path: "/invoice-applications/tasks"'),
      routerSource.indexOf('path: "/contract-dashboard"'),
    );
    expect(createRoute).toContain('requiresRole: ["user"]');
    expect(managerRoute).toContain('requiresRole: ["general_manager"]');
    expect(adminRoute).toContain("requiresAdmin: true");
    expect(layoutSource).toContain('label="我的申请"');
    expect(layoutSource).not.toContain('label="我的开票申请"');
    expect(layoutSource).not.toContain('label="我的下载申请"');
    expect(layoutSource).toContain('label="开票申请审批"');
    expect(layoutSource).toContain(
      "invoiceApplicationApprovalPendingCount > 0",
    );
    expect(layoutSource).toContain("myContractApplicationPendingCount");
    expect(layoutSource).toContain("getInvoiceApplicationPendingCounts");
    expect(layoutSource).toContain(
      "invoiceApplicationApprovalPendingCount.value",
    );
    expect(layoutSource).toContain(
      "invoiceApplicationEmployeeActionPendingCount.value",
    );
    expect(layoutSource).toContain(
      "window.setInterval(refreshContractBadges, 5_000)",
    );
    expect(layoutSource).toContain(
      'window.addEventListener("focus", refreshContractBadges)',
    );
    expect(centerSource).toContain(
      "您有 ${managerPendingCount} 条开票申请待审批",
    );
    expect(centerSource).toContain("getInvoiceApplicationPendingCounts()");
    expect(layoutSource).toContain('label="合同待办"');
    expect(layoutSource).toContain('path="/contract-tasks"');
    expect(routerSource).toContain('name: "AdminContractTasks"');
  });

  it("员工下载和开票申请合并为按需挂载的我的申请页面", () => {
    expect(routerSource).toContain('path: "/contract-applications/mine"');
    expect(routerSource).toContain('name: "MyContractApplications"');
    expect(routerSource).toContain('requiresRole: ["user"]');
    expect(routerSource).toContain('tab: "download"');
    expect(routerSource).toContain('tab: "invoice"');
    expect(myApplicationsSource).toContain("合同下载申请");
    expect(myApplicationsSource).toContain("开票及用印申请");
    expect(myApplicationsSource).toContain("v-if=\"activeTab === 'download'\"");
    expect(myApplicationsSource).not.toContain("v-show");
    expect(myApplicationsSource).toContain("<InvoiceApplicationCenter v-else");
    expect(listSource).toContain("router.push('/contract-applications/mine')");
  });

  it("员工开票申请区分当前与历史并显示跨分页连续序号", () => {
    expect(centerSource).toContain('aria-label="我的开票申请视图"');
    expect(centerSource).toContain("当前申请");
    expect(centerSource).toContain("历史申请");
    expect(centerSource).toContain("setEmployeeView('current')");
    expect(centerSource).toContain("setEmployeeView('history')");
    expect(centerSource).toContain(
      'route.query.view === "history" ? "history" : "current"',
    );
    expect(centerSource).toContain("query: { ...route.query, view }");
    expect(centerSource).toContain(
      'view: mode.value === "mine" ? employeeView.value : undefined',
    );
    expect(centerSource).toContain(
      "v-if=\"mode !== 'mine' || employeeView === 'current'\"",
    );
    expect(centerSource).toContain('v-for="(item, index) in items"');
    expect(centerSource).toContain(
      "v-if=\"mode === 'mine' || mode === 'manager'\"",
    );
    expect(centerSource).toContain(
      "return (page.value - 1) * pageSize + index + 1",
    );
    const mineStatuses = centerSource.slice(
      centerSource.indexOf(
        'if (employeeView.value === "history") return ["completed"]',
      ),
      centerSource.indexOf("const items = ref"),
    );
    expect(mineStatuses).toContain('"pending_invoice"');
    expect(mineStatuses).not.toContain('"completed",');
  });

  it("总经理开票审批按合同审批布局区分待我审批和审批记录", () => {
    expect(centerSource).toContain("开票审批工作台");
    expect(centerSource).toContain('class="approval-hero"');
    expect(centerSource).toContain('class="approval-tabs"');
    expect(centerSource).toContain('label="待我审批"');
    expect(centerSource).toContain('label="审批记录"');
    expect(centerSource).toContain('class="card-heading"');
    expect(centerSource).toContain('class="search-input"');
    expect(centerSource).toContain("handleManagerTabChange");
    expect(centerSource).toContain(
      'route.query.view === "history" ? "history" : "pending"',
    );
    expect(centerSource).toContain('? "manager_processed"');
    expect(centerSource).toContain(': "manager_pending"');
    expect(centerSource).toContain("keyword.value.trim()");
    expect(centerSource).toContain('class="application-serial"');
    expect(centerSource).toContain("serialNumber(index)");
  });

  it("合同台账仅根据服务端批量资格字段为普通员工显示收入主合同入口", () => {
    expect(listSource).toContain("function canApplyInvoice");
    expect(listSource).toContain('item.relationType === "main"');
    expect(listSource).toContain('["main_business", "non_main"]');
    expect(listSource).toContain('["effective", "executing", "completed"]');
    expect(listSource).toContain(
      "item.invoiceApplicationEligibility?.eligible === true",
    );
    expect(listSource).toContain('v-if="canApplyInvoice(row)"');
    expect(listSource).toContain('v-if="canApplyInvoice(item)"');
    expect(listSource).not.toContain(
      "getInvoiceApplicationEligibility(row.id)",
    );
  });

  it("员工页面展示服务端额度并填写完整开票资料", () => {
    expect(createSource).toContain("当前有效合同金额");
    expect(createSource).toContain("已开票金额");
    expect(createSource).toContain("审批、盖章及待开票占用");
    expect(createSource).toContain("剩余可申请额度");
    expect(createSource).toContain("eligibility.value?.eligible === true");
    expect(createSource).toContain('v-model="form.amount"');
    expect(createSource).not.toContain('v-model="form.invoiceContent"');
    expect(createSource).not.toContain('label="开票内容"');
    expect(centerSource).not.toContain('label="开票内容"');
    expect(createSource).toContain('v-model="form.invoiceType"');
    expect(createSource).not.toContain('label="电子发票"');
    expect(createSource).toContain('v-model="form.description"');
    expect(createSource).toContain('v-model="form.billingInfo.name"');
    expect(createSource).toContain('v-model="form.billingInfo.taxNumber"');
    expect(createSource).toContain('v-model="form.billingInfo.bankAccount"');
    expect(createSource).toContain("confirmedBillingIdentity");
    expect(createSource).toContain("已带入该甲方历史信息");
    expect(createSource).toContain("已带入当前申请已保存信息");
    expect(createSource).toContain("系统将在保存时保留修改记录");
  });

  it("主营在线生成三联单，非主营可选材料采用逐文件盖章标记", () => {
    expect(createSource).toContain("在线生成三联单并确认用印");
    expect(createSource).toContain(
      'isSealApplication.value ? "开票及用印申请"',
    );
    expect(createSource).not.toContain("seal-flow-alert");
    expect(createSource).toContain(
      "在线填写本次付款，系统自动计算合同金额与累计付款",
    );
    expect(createSource).toContain('v-model="triplicateProjectName"');
    expect(createSource).toContain('v-model="form.amount"');
    expect(createSource).toContain("plainAmount(triplicateCurrentPayment)");
    expect(createSource).toContain("plainAmount(triplicateCumulativePayment)");
    expect(createSource).toContain("之前累计付款");
    expect(createSource).toContain("不增加千位分隔符");
    expect(createSource).toContain(
      "Number(application.amount || 0).toFixed(2)",
    );
    expect(createSource).toContain('@click="generateOnlineTriplicate"');
    expect(createSource).toContain("generateMainBusinessTriplicate");
    expect(createSource).toContain(
      'v-show="!isMainBusiness || triplicateAmountConfirmed"',
    );
    expect(createSource).toContain(':multiple="!isMainBusiness"');
    expect(createSource).toContain(
      "!isMainBusiness && form.materialMode !== 'no_material'",
    );
    expect(createSource).toContain("总经理批准后由管理员打印并盖章");
    expect(createSource).toContain('value="material_need_seal"');
    expect(createSource).toContain('value="material_no_seal"');
    expect(createSource).toContain('value="no_material"');
    expect(createSource).toContain("pendingFileRequiresSeal(file)");
    expect(createSource).toContain("togglePendingFileSeal(file)");
    expect(createSource).toContain("uploadPendingMaterials");
    expect(createSource).toContain("currentApplication.value = updated");
    expect(createSource).toContain("uploadedKeys");
    expect(createSource).toContain("部分材料文件读取失败，请重新选择");
    expect(apiSource).toContain(
      'formData.append("requiresSeal", String(requiresSeal))',
    );
    expect(apiSource).toContain(
      "/api/invoice-applications/triplicate-inspection",
    );
    expect(apiSource).toContain("`/api/invoice-applications/${id}/triplicate`");
    expect(centerSource).toContain("打印三联单");
    expect(centerSource).toContain("流程：开票＋用印");
    expect(centerSource).toContain("流程：仅开票");
  });

  it("申请人必须签名且修改内容后签名失效", () => {
    expect(createSource).toContain("loadPersonalSignature");
    expect(createSource).toContain("申请人电子签名");
    expect(createSource).toContain("markChangedAfterSignature");
    expect(createSource).toContain("申请内容已发生变化，请重新确认电子签名");
    expect(createSource).toContain("Boolean(signatureDataUrl.value)");
    expect(createSource).toContain("submitInvoiceApplication");
    expect(createSource).toContain("requestContractDownloadBadgeRefresh()");
    expect(createSource).toContain("保存草稿");
  });

  it("员工待审批开票申请可以撤回并恢复修改", () => {
    expect(centerSource).toContain("item.status === 'pending_approval'");
    expect(centerSource).toContain(">撤回申请</el-button");
    expect(centerSource).toContain(
      "withdrawInvoiceApplication(item.id, item.version)",
    );
    expect(centerSource).toContain("撤回后申请恢复为草稿");
    expect(apiSource).toContain("`/api/invoice-applications/${id}/withdraw`");
  });

  it("总经理审批签字，管理员仅执行盖章交付和记录发票已开具", () => {
    expect(centerSource).toContain("总经理审批并签字");
    expect(centerSource).toContain("查看签字申请单");
    expect(centerSource).toContain("getInvoiceApplicationPreviewUrl");
    expect(centerSource).toContain("<ContractReadOnlyPreview");
    expect(centerSource).toContain('if (mode.value !== "mine")');
    expect(centerSource).toContain(
      'window.open(url, "_blank", "noopener,noreferrer")',
    );
    expect(centerSource).toContain("提交时剩余可申请额度");
    expect(centerSource).toContain("已匹配正式发票金额");
    expect(centerSource).toContain("selected.allocatedInvoiceAmount");
    expect(centerSource).toContain("loadPersonalSignature");
    expect(centerSource).toContain("签字并批准");
    expect(centerSource).toContain("驳回时必须填写原因");
    expect(centerSource).toContain("开票申请已被总经理驳回");
    expect(centerSource).toContain("总经理驳回：");
    expect(centerSource).toContain("侧栏提醒将在重提后消除");
    expect(centerSource).toContain("managerDecisionLog(selected)?.comment");
    expect(centerSource).toContain(">查看详情</el-button>");
    expect(centerSource).toContain(
      'mode.value === "manager" &&\n      managerView.value === "pending"',
    );
    expect(centerSource).toContain("submitDecision('reject')");
    expect(centerSource).toContain("submitDecision('approve')");
    expect(centerSource).not.toContain(':disabled="!decisionComment.trim()"');
    expect(centerSource).toMatch(
      /\.action-workspace footer\s*\{[\s\S]*?margin-top:\s*24px;/,
    );
    expect(centerSource).not.toContain(">审批并签字</el-button>");
    expect(centerSource).toContain("管理员不是审批人");
    expect(centerSource).toContain("确认已盖章并交付申请人");
    expect(centerSource).not.toContain('class="material-card-heading"');
    expect(centerSource).toContain('class="material-card-actions"');
    expect(centerSource).toContain('class="material-seal-status"');
    const materialActions = centerSource.slice(
      centerSource.indexOf('class="material-card-actions"'),
      centerSource.indexOf(
        "</article>",
        centerSource.indexOf('class="material-card-actions"'),
      ),
    );
    expect(materialActions.indexOf("previewMaterial")).toBeLessThan(
      materialActions.indexOf("printMaterial"),
    );
    expect(materialActions).not.toContain("需要盖章");
    expect(centerSource).toContain("共 {{ selected.materials.length }} 份材料");
    expect(centerSource).not.toContain("有材料，需要盖章");
    expect(centerSource).toMatch(
      /\.material-card-actions\s*\{[\s\S]*?justify-content:\s*flex-end;/,
    );
    expect(centerSource).toMatch(
      /\.material-card-actions\s*\{[\s\S]*?width:\s*100%;/,
    );
    expect(centerSource).toMatch(
      /\.material-card-actions\s*\{[\s\S]*?justify-self:\s*stretch;/,
    );
    expect(centerSource).toMatch(
      /\.material-card-actions\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/,
    );
    expect(centerSource).toMatch(
      /\.material-card-actions\s*\{[\s\S]*?border-top:\s*1px solid #dfe9ec;/,
    );
    expect(centerSource).toMatch(
      /\.material-card-actions\s*\{[\s\S]*?padding-top:\s*8px;/,
    );
    expect(centerSource).toMatch(
      /\.material-seal-status\s*\{[\s\S]*?justify-self:\s*end;/,
    );
    expect(centerSource).not.toContain("border-top: 1px solid #e4edef");
    expect(centerSource).not.toContain(".material-card-actions :deep(.el-tag)");
    expect(centerSource).toContain("选择盖章后三联单");
    expect(centerSource).toContain('accept=".pdf,application/pdf"');
    expect(centerSource).toContain("盖章后三联单仅支持 PDF 格式");
    expect(centerSource).not.toContain("PDF、JPG、JPEG、PNG");
    expect(centerSource).toContain("sealedTriplicateFile");
    expect(centerSource).toContain("uploadContractFile(");
    expect(centerSource).toContain('"triplicate"');
    expect(centerSource).toContain("uploaded.fileId");
    expect(centerSource).toContain(':disabled="!sealedTriplicateFile"');
    expect(centerSource).toContain(
      "盖章后三联单已归档至合同附件，下一步由管理员开具发票",
    );
    expect(centerSource).toContain("确认已开具发票");
    expect(centerSource).toContain("已开具，待财务登记");
    expect(centerSource).toContain("!item.issuedAt");
    expect(centerSource).toContain("statusLabel(item)");
    expect(centerSource).toContain("查看开具记录");
    expect(centerSource).toContain(':disabled="Boolean(selected.issuedAt)"');
    expect(centerSource).toContain("正式发票继续在合同详情的财务登记中上传");
    expect(centerSource).toContain("前往合同财务登记上传正式发票");
    expect(centerSource).toContain(
      'query: { tab: "finance", action: "record" }',
    );
    expect(apiSource).toContain("/mark-issued");
    expect(apiSource).not.toContain("/complete");
    const sealWorkspace = centerSource.slice(
      centerSource.indexOf("workspace === 'admin_seal'"),
      centerSource.indexOf("workspace === 'admin_invoice'"),
    );
    const invoiceWorkspace = centerSource.slice(
      centerSource.indexOf("workspace === 'admin_invoice'"),
      centerSource.indexOf('class="detail-section audit-list"'),
    );
    expect(sealWorkspace).not.toContain("openContractFinance");
    expect(invoiceWorkspace).toContain("openContractFinance");
    expect(invoiceWorkspace).toContain("selected.invoiceNote");
    expect(centerSource).toContain(':active="workflowStep(selected)"');
    expect(centerSource).toContain("if (item.issuedAt)");
    expect(centerSource).toContain("审批流程");
    expect(centerSource).toContain("requestContractDownloadBadgeRefresh()");
    expect(centerSource).toContain("approvalActorLabel(log)");
    expect(centerSource).toContain("approvalFlowLogs");
    expect(centerSource).toContain("HIDDEN_APPROVAL_FLOW_ACTIONS");
    expect(centerSource).toContain('submit: "员工提交"');
    expect(centerSource).toContain('log.action === "submit"');
    expect(centerSource).toContain('previousLog.action === "reject"');
    expect(centerSource).toContain('"员工重新提交"');
    expect(centerSource).toContain('"draft_created"');
    expect(centerSource).toContain('"draft_updated"');
    expect(centerSource).toContain('"material_uploaded"');
    expect(centerSource).toContain('"material_deleted"');
    expect(centerSource).toContain(
      "!HIDDEN_APPROVAL_FLOW_ACTIONS.has(log.action)",
    );
    expect(centerSource).toContain('v-for="log in approvalFlowLogs"');
    expect(centerSource).not.toContain('v-for="log in selected.auditLogs"');
    expect(centerSource).toContain("workflowPartyLabel(selected.approver)");
    expect(centerSource).toContain("待总经理审批签字");
    expect(centerSource).toContain("selected.value?.applicant?.department");
    expect(centerSource).not.toContain("<h3>签字记录</h3>");
    expect(centerSource).not.toContain("<h3>操作留痕</h3>");
  });

  it("主营材料只通过派生预览和管理员打印接口处理其他费用工作表", () => {
    expect(apiSource).toContain("/materials/${materialId}/preview");
    expect(apiSource).toContain("/materials/${materialId}/print");
    expect(centerSource).toContain("仅预览和打印“其他费用”工作表");
    expect(centerSource).toContain("打印其他费用工作表");
    expect(centerSource).toContain("getInvoiceApplicationMaterialPrintUrl");
    expect(centerSource).toContain("getInvoiceApplicationMaterialDownloadUrl");
    expect(centerSource).toContain("下载查看");
  });
});
