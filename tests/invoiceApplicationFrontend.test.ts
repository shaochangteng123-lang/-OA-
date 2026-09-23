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
  const receiptCenterSource = source("src/views/InvoiceReceiptTaskCenter.vue");
  const detailSource = source("src/views/ContractDetail.vue");
  const financialPanelSource = source(
    "src/components/contracts/ContractFinancialRegistrationPanel.vue",
  );
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
    expect(createRoute).toContain(
      'requiresRole: ["user", "admin", "super_admin", "chairman"]',
    );
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
    expect(myApplicationsSource).toContain(
      "v-if=\"canRequestDownload && activeTab === 'download'\"",
    );
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
      "v-if=\"mode === 'mine' || mode === 'manager' || mode === 'admin'\"",
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

  it("管理员开票与用印待办区分待我处理和本人处理记录", () => {
    expect(centerSource).toContain('aria-label="开票与用印任务处理视图"');
    expect(centerSource).toContain("待我处理");
    expect(centerSource).toContain("处理记录");
    expect(centerSource).toContain("setAdminView('pending')");
    expect(centerSource).toContain("setAdminView('history')");
    expect(centerSource).toContain('? "admin_processed"');
    expect(centerSource).toContain(': "admin_pending"');
    expect(centerSource).toContain("adminView.value");
    expect(centerSource).toContain(
      "本人处理：{{ adminProcessingLabel(item) }}",
    );
    expect(centerSource).toContain("item.adminProcessing?.processedAt");
    expect(centerSource).toContain("selected.deliveryHandler.name");
    expect(centerSource).toContain("selected.invoiceHandler.name");
    expect(centerSource).toContain("adminView === 'pending'");
    expect(centerSource).toMatch(
      /\.employee-view-switch button\s*\{[\s\S]*?white-space:\s*nowrap;/,
    );
    expect(centerSource).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.list-toolbar,[\s\S]*?flex-direction:\s*column;/,
    );
    expect(apiSource).toContain('"admin_pending"');
    expect(apiSource).toContain('"admin_processed"');
  });

  it("合同台账根据服务端批量资格字段为员工和管理员显示收入主合同入口", () => {
    expect(listSource).toContain("function canApplyInvoice");
    expect(listSource).toContain("canInitiateInvoice.value");
    expect(listSource).not.toContain("isEmployee && canApplyInvoice(row)");
    expect(myApplicationsSource).toContain('v-if="canRequestDownload"');
    expect(myApplicationsSource).toContain("!canRequestDownload.value");
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
      "填写本次实际付款，系统自动计算合同金额与累计付款",
    );
    expect(createSource).toContain('v-model="triplicateProjectName"');
    expect(createSource).toContain('v-model="form.amount"');
    expect(
      createSource.match(/v-model="form\.amount"[\s\S]{0,160}@input=/g),
    ).toHaveLength(2);
    expect(createSource).not.toContain(
      "form.amount = plainAmount(eligibility.value.amounts.remainingAmount)",
    );
    expect(createSource).toContain("本次付款由申请人根据本次实际付款填写");
    expect(createSource).not.toContain("例如47500.00");
    expect(createSource).toContain("plainAmount(triplicateCurrentPayment)");
    expect(createSource).toContain("plainAmount(triplicateCumulativePayment)");
    expect(createSource).toContain("之前累计付款");
    expect(createSource).toContain("剩余可申请额度");
    expect(createSource).toContain(
      "plainAmount(eligibility.amounts.remainingAmount)",
    );
    expect(createSource).toContain("不增加千位分隔符");
    expect(createSource).toContain(
      "Number(application.amount || 0).toFixed(2)",
    );
    expect(createSource).toContain('@click="generateOnlineTriplicate"');
    expect(createSource).toContain("generateMainBusinessTriplicate");
    expect(createSource).toContain(
      'v-show="!requiresTriplicate || triplicateAmountConfirmed"',
    );
    expect(createSource).toContain(':multiple="!requiresTriplicate"');
    expect(createSource).toContain(
      "!requiresTriplicate && form.materialMode !== 'no_material'",
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

  it("员工本人未提交的开票草稿可以二次确认后删除", () => {
    expect(centerSource).toContain(
      "mode === 'mine' && item.status === 'draft'",
    );
    expect(centerSource).toContain(">删除草稿</el-button");
    expect(centerSource).toContain("deleteDraftApplication(item)");
    expect(centerSource).toContain("删除后将同时清理该草稿的三联单和申请材料");
    expect(centerSource).toContain(
      "deleteInvoiceApplicationDraft(item.id, item.version)",
    );
    expect(createSource).toContain("currentApplication?.status === 'draft'");
    expect(createSource).toContain("deleteCurrentDraft");
    expect(createSource).toContain(
      "deleteInvoiceApplicationDraft(application.id, application.version)",
    );
    expect(apiSource).toContain(
      "export async function deleteInvoiceApplicationDraft",
    );
    expect(apiSource).toContain("`/api/invoice-applications/${id}`");
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
    expect(centerSource).toContain("选择盖章后材料");
    expect(centerSource).toContain('accept=".pdf,application/pdf"');
    expect(centerSource).toContain("盖章后材料仅支持 PDF（便携式文档）格式");
    expect(centerSource).not.toContain("PDF、JPG、JPEG、PNG");
    expect(centerSource).toContain("sealedTriplicateFile");
    expect(centerSource).toContain("uploadContractFile(");
    expect(centerSource).toContain('"triplicate"');
    expect(centerSource).toContain("selected.value.id");
    expect(centerSource).toContain("uploaded.fileId");
    expect(centerSource).toContain(':disabled="!sealedTriplicateFile"');
    expect(centerSource).toContain("上传后将归档至合同详情的“开票申请材料”");
    expect(centerSource).toContain(
      "盖章后材料已归档至合同详情的开票申请材料，下一步由管理员开具发票",
    );
    expect(centerSource).not.toContain(
      "盖章后材料已归档至合同附件，下一步由管理员开具发票",
    );
    expect(centerSource).toContain("确认已开具并上传正式发票");
    expect(centerSource).toContain("已开具，待财务登记");
    expect(centerSource).toContain("!item.issuedAt");
    expect(centerSource).toContain("statusLabel(item)");
    expect(centerSource).toContain(">上传正式发票</el-button");
    expect(centerSource).not.toContain(
      ':disabled="Boolean(selected.issuedAt)"',
    );
    expect(centerSource).toContain("正式发票继续在合同详情的财务登记中上传");
    expect(centerSource).toContain("前往本合同财务登记上传正式发票");
    expect(centerSource).toContain('recordType: "invoice"');
    expect(centerSource).toContain("invoiceApplicationId: item.id");
    expect(centerSource).toContain('from: "contract-tasks"');
    expect(centerSource).toContain('updated.status === "completed"');
    expect(centerSource).toContain("routeCompletedInvoiceApplication(updated)");
    expect(centerSource).toContain('result: "invoice-completed"');
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
    expect(centerSource).toContain('submit: "申请人提交"');
    expect(centerSource).toContain('log.action === "submit"');
    expect(centerSource).toContain('previousLog.action === "reject"');
    expect(centerSource).toContain('"申请人重新提交"');
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

  it("待上传回单按未闭合登记展示并精确跳转", () => {
    expect(receiptCenterSource).toContain("待上传回单");
    expect(receiptCenterSource).toContain("开票流程已完成");
    expect(receiptCenterSource).toContain("当前登记开票金额");
    expect(receiptCenterSource).toContain("当前登记已匹配回款");
    expect(receiptCenterSource).toContain("待上传回单金额");
    expect(receiptCenterSource).toContain('recordType: "receipt"');
    expect(receiptCenterSource).toContain(
      "registrationId: item.registrationId",
    );
    expect(receiptCenterSource).toContain('fromTab: "receipt"');
    expect(detailSource).toContain("requestedRegistrationId");
    expect(detailSource).toContain(
      "financialRegistrationTargetId.value = requestedRegistrationId",
    );
    expect(detailSource).toContain("contractTaskFinanceTargetError");
    expect(detailSource).toContain("contractTaskFinanceTargetValidated");
    expect(detailSource).toContain("contractTaskFinanceTargetChecking");
    expect(detailSource).toContain(
      "const receiptTask = await getInvoiceReceiptTask(",
    );
    expect(detailSource).toContain("requestedRegistrationId");
    expect(detailSource).toContain("contractTaskFinanceValidationSequence");
    expect(detailSource).toContain(":lock-registration-target=");
    expect(detailSource).toContain(
      '["main_business", "non_main"].includes(contract.category || "")',
    );
    expect(detailSource).toContain("getInvoiceApplicationFinancialProgress");
    expect(detailSource).toContain("开票流程已完成，已转入待上传回单");
    expect(financialPanelSource).toContain('target?: "invoice" | "receipt"');
    expect(financialPanelSource).toContain("bankCardRef.value");
    expect(financialPanelSource).toContain("!props.lockRegistrationTarget");
    expect(detailSource).toContain("!receiptTaskRegistrationLocked");
    expect(detailSource).toContain("canOperateFinancialCard(card)");
  });

  it("待回单路由刷新前立即阻断旧校验并统一锁定财务操作", () => {
    const loadDetailSource = detailSource.slice(
      detailSource.indexOf("async function loadDetail()"),
      detailSource.indexOf(
        "async function updateAuxiliaryMaterialRequirement",
        detailSource.indexOf("async function loadDetail()"),
      ),
    );
    const contractRequestIndex = loadDetailSource.indexOf(
      "await getContract(requestedContractId)",
    );
    expect(contractRequestIndex).toBeGreaterThan(0);
    for (const guard of [
      "contractTaskFinanceValidationSequence += 1",
      'contractTaskFinanceTargetError.value = ""',
      "contractTaskFinanceTargetValidated.value = false",
      "contractTaskFinanceTargetChecking.value = true",
    ]) {
      const guardIndex = loadDetailSource.indexOf(guard);
      expect(guardIndex).toBeGreaterThan(0);
      expect(guardIndex).toBeLessThan(contractRequestIndex);
    }

    const routeIntentSource = detailSource.slice(
      detailSource.indexOf("async function applyRouteIntent()"),
      detailSource.indexOf(
        "let detailLoadSequence",
        detailSource.indexOf("async function applyRouteIntent()"),
      ),
    );
    expect(
      routeIntentSource.match(
        /contractTaskFinanceValidationSequence !== validationSequence/g,
      ),
    ).toHaveLength(6);
    expect(
      routeIntentSource.match(/route\.fullPath !== intentRouteFullPath/g),
    ).toHaveLength(6);
    expect(routeIntentSource).toMatch(
      /await financialRegistrationPanelRef\.value\?\.reloadPendingUploads\(\);[\s\S]{0,260}contractTaskFinanceValidationSequence !== validationSequence[\s\S]{0,160}route\.fullPath !== intentRouteFullPath/,
    );
    expect(routeIntentSource).toContain(
      "待回单入口缺少财务登记操作参数，请返回合同待办刷新后重新进入。",
    );
    expect(detailSource).toContain(
      'v-if="canManageFinancials && canOperateFinancialCard(card)"',
    );
    expect(detailSource).toContain("function canOperateFinancialCard(");
    expect(detailSource).toContain(
      "card.registrationId === routeQueryText(route.query.registrationId)",
    );
    expect(
      detailSource.match(
        /if \(!ensureFinancialCardTaskTarget\(card\)\) return;/g,
      ),
    ).toHaveLength(4);
  });

  it("财务保存完成后的异步结果不能越过合同、路由和卸载边界", () => {
    const completionSource = detailSource.slice(
      detailSource.indexOf(
        "async function handleFinancialRegistrationCreated()",
      ),
      detailSource.indexOf(
        "async function confirmFinancialCard",
        detailSource.indexOf(
          "async function handleFinancialRegistrationCreated()",
        ),
      ),
    );
    expect(completionSource).toContain(
      "const completionSequence = ++financialRegistrationCompletionSequence",
    );
    expect(completionSource).toContain(
      "const sourceContractId = contractId.value",
    );
    expect(completionSource).toContain(
      "const sourceRouteFullPath = route.fullPath",
    );
    expect(completionSource).toContain(
      "completionSequence === financialRegistrationCompletionSequence",
    );
    expect(completionSource).toContain("contractId.value === sourceContractId");
    expect(completionSource).toContain(
      "route.fullPath === sourceRouteFullPath",
    );
    expect(
      completionSource.match(/if \(!isCurrentCompletionContext\(\)\) return;/g),
    ).toHaveLength(6);

    const routeWatchSource = detailSource.slice(
      detailSource.indexOf("watch(\n  () => [\n    route.query.tab"),
      detailSource.indexOf(
        "onBeforeUnmount",
        detailSource.indexOf("watch(\n  () => [\n    route.query.tab"),
      ),
    );
    expect(routeWatchSource).toContain(
      "financialRegistrationCompletionSequence += 1",
    );
    const unmountSource = detailSource.slice(
      detailSource.lastIndexOf("onBeforeUnmount"),
      detailSource.indexOf("</script>"),
    );
    expect(unmountSource).toContain(
      "financialRegistrationCompletionSequence += 1",
    );
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
