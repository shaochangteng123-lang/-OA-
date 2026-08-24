import fs from "fs";
import path from "path";

describe("合同详情页面展示", () => {
  const detailSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
    "utf8",
  );
  const backendSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const serviceSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/contractService.ts"),
    "utf8",
  );
  const databaseSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/db/index.ts"),
    "utf8",
  );
  const contractApiSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/utils/contractApi.ts"),
    "utf8",
  );
  const applicationSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "src/components/contracts/ContractSealApplicationEditor.vue",
    ),
    "utf8",
  );
  const filePreviewSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "src/components/contracts/ContractFilePreview.vue",
    ),
    "utf8",
  );

  it("合同总览不展示识别质量面板且基础信息使用整行布局", () => {
    expect(detailSource).not.toContain("识别质量");
    expect(detailSource).not.toContain("ocr-quality-list");
    expect(detailSource).not.toContain("verifiedConfidencePercentage");
    expect(detailSource).toMatch(
      /\.overview-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
  });

  it("合同附件卡片类名独立且按角色选择原生或受控预览", () => {
    expect(detailSource).toContain('class="file-card-preview"');
    expect(detailSource).not.toContain('class="file-preview"');
    expect(detailSource).toContain("<ContractReadOnlyPreview");
    expect(detailSource).toContain("readonlyPreviewVisible.value = true");
    expect(detailSource).toContain("if (canDirectDownload.value)");
    expect(detailSource).toContain("window.open(");
    expect(detailSource).toContain(".file-actions :deep(.el-button)");
    expect(detailSource).toContain("margin-left: 0");
    expect(detailSource).not.toContain("employeePreviewVisible");
    expect(filePreviewSource).toContain('class="contract-file-preview"');
    expect(filePreviewSource).not.toContain('class="file-preview"');
  });

  it("子协议上传盖章版后才进入主合同附件且不提供补充附件入口", () => {
    const attachmentTabSource = detailSource.slice(
      detailSource.indexOf(
        ':label="`合同附件（${displayedContractFiles.length}）`"',
      ),
      detailSource.indexOf('label="财务闭环"'),
    );
    expect(attachmentTabSource).toContain(
      ':label="`合同附件（${displayedContractFiles.length}）`"',
    );
    expect(attachmentTabSource).toContain(
      "v-if=\"detail.contract.relationType === 'main'\"",
    );
    expect(backendSource).toContain("source.relation_type = 'main'");
    expect(backendSource).toContain(
      'currentSealedContractFileExists("source")',
    );
    expect(attachmentTabSource).not.toContain("补充附件");
    expect(detailSource).not.toContain("补充合同附件");
    expect(detailSource).not.toContain("fileDialogVisible");
    expect(detailSource).not.toContain("handleExtraFile");
    expect(detailSource).not.toContain("submitExtraFile");
    expect(attachmentTabSource).toContain(
      'v-for="group in contractFileGroups"',
    );
    expect(attachmentTabSource).toContain(
      "{{ group.label }}（{{ group.files.length }}）",
    );
    expect(attachmentTabSource).toContain('v-for="source in group.sources"');
    expect(attachmentTabSource).toContain(
      "{{ source.label }}（{{ source.files.length }}）",
    );
    expect(attachmentTabSource).toContain('v-for="file in source.files"');
    expect(attachmentTabSource).toContain("v-if=\"group.key === 'invoice'\"");
    expect(attachmentTabSource).not.toContain(
      'v-for="file in displayedContractFiles"',
    );
    expect(detailSource).toContain("contract?.hasSealedContractFile");
    const groupSource = detailSource.slice(
      detailSource.indexOf("const contractFileGroups = computed"),
      detailSource.indexOf(
        "const loading = ref",
        detailSource.indexOf("const contractFileGroups = computed"),
      ),
    );
    for (const label of ["合同", "发票", "回单", "用印申请单"]) {
      expect(groupSource).toContain(`label: "${label}"`);
    }
    expect(groupSource).toContain("displayedContractFiles.value");
    expect(groupSource).toContain('file.fileType === "invoice"');
    expect(groupSource).toContain(
      '["receipt", "payment"].includes(file.fileType)',
    );
    expect(groupSource).toContain('file.fileType === "seal_application"');
    expect(groupSource).toContain('return "contract"');
    expect(groupSource).toContain("group.files.length > 0");
    expect(groupSource).toContain("sourceContractId");
    expect(groupSource).toContain("sourceRelationType");
    expect(groupSource).toContain("sourceSupplementSequence");
    expect(groupSource).toContain('"主合同"');
    expect(groupSource).toContain("补充协议（${");
    expect(groupSource).toContain('"解除协议"');
    expect(groupSource).toContain("sources");
    expect(groupSource).not.toContain("detail.value?.invoices");
    expect(groupSource).not.toContain("detail.value?.receipts");
    expect(groupSource).not.toContain("detail.value?.payments");
    expect(groupSource).not.toContain("auxiliary");
    expect(groupSource).not.toContain("return null");

    for (const field of [
      "sourceContractId",
      "sourceRelationType",
      "sourceSupplementSequence",
      "sourceContractName",
    ]) {
      expect(contractApiSource).toContain(field);
    }
  });

  it("聚合附件按归属合同分别保留一个当前用印申请单", () => {
    const displayedFilesSource = detailSource.slice(
      detailSource.indexOf("const displayedContractFiles = computed"),
      detailSource.indexOf("const contractFileGroups = computed"),
    );
    expect(displayedFilesSource).toContain("sourceContractId");
    expect(displayedFilesSource).toContain(
      'file.fileType === "seal_application"',
    );
    expect(displayedFilesSource).toContain("file.isCurrent");
    expect(displayedFilesSource).not.toContain(
      "sealApplications.find((file) => file.isCurrent)",
    );
  });

  it("附件发票组直接展示全部发票而合同和用印仍按来源分层", () => {
    const attachmentTabSource = detailSource.slice(
      detailSource.indexOf(
        ':label="`合同附件（${displayedContractFiles.length}）`"',
      ),
      detailSource.indexOf('label="财务闭环"'),
    );
    expect(attachmentTabSource).toContain("v-if=\"group.key === 'invoice'\"");
    expect(attachmentTabSource).toContain('v-for="file in group.files"');
    expect(attachmentTabSource).toContain('v-for="source in group.sources"');
    expect(attachmentTabSource).toContain('v-for="file in source.files"');
    expect(attachmentTabSource).not.toContain("detail.invoices");
    const groupSource = detailSource.slice(
      detailSource.indexOf("const contractFileGroups = computed"),
      detailSource.indexOf(
        "const loading = ref",
        detailSource.indexOf("const contractFileGroups = computed"),
      ),
    );
    expect(groupSource).toContain('definition.key === "invoice"');
    expect(groupSource).toContain("sources: []");
  });

  it("用印申请状态标签使用独立高对比样式", () => {
    expect(applicationSource.match(/class="application-status"/g)).toHaveLength(
      2,
    );
    expect(applicationSource).toContain('class="heading-description"');
    expect(applicationSource).not.toContain(".application-heading span {");
    expect(applicationSource).toContain(".application-status.el-tag--warning");
    expect(applicationSource).toContain("color: #92400e");
    expect(applicationSource).toContain(".application-status.el-tag--success");
    expect(applicationSource).toContain("color: #065f46");
    expect(applicationSource).toContain(
      "grid-template-columns: auto minmax(0, 1fr)",
    );
  });

  it("主合同终止使用终止状态且解除协议关系卡不展示自身状态", () => {
    expect(detailSource).toContain(
      "relation.status && relation.relationType !== 'termination'",
    );
    expect(detailSource).toContain(
      '<ContractStatusTag :status="detail.contract.status" />',
    );
    const presentationSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/utils/contractPresentation.ts"),
      "utf8",
    );
    expect(presentationSource).toContain('terminated: "终止"');
  });

  it("资产类详情和用印申请不使用项目名称标签", () => {
    expect(detailSource).toContain("detail.contract.category === 'asset'");
    expect(detailSource).toContain("? '合同名称'");
    expect(applicationSource).toContain('v-if="!contract.isAssetContract"');
  });

  it("房屋租赁详情展示月租金与月物业管理费的完整计算口径", () => {
    expect(detailSource).toContain('label="租赁金额口径"');
    expect(detailSource).toContain("'monthly_rent_property_fee_calculated'");
    expect(detailSource).toContain("leaseMonthlyPropertyManagementFee");
    expect(detailSource).toContain("leaseMonthlyFixedFeeTotal");
    expect(detailSource).toContain("leaseCalculatedContractTotal");
    expect(detailSource).toContain("+ 月物业管理费");
    expect(detailSource).toContain("合计每月");
    expect(detailSource).toContain("合同总金额");
    expect(backendSource).toContain("leaseMonthlyPropertyManagementFee");
    expect(contractApiSource).toContain("source.lease_monthly_property_fee");
    expect(serviceSource).toContain("lease_monthly_property_fee = $13");
    expect(databaseSource).toContain(
      "lease_monthly_property_fee NUMERIC(18,2)",
    );
    expect(databaseSource).toContain("'monthly_rent_property_fee_calculated'");
    expect(detailSource).toContain('class="seal-lease-period"');
    expect(detailSource).toContain("合同签订日期");
    expect(detailSource).toContain("不是租赁起始日期");
  });

  it("合同详情可按版本开启或关闭辅助材料入口", () => {
    expect(detailSource).toContain('label="是否需要辅助材料"');
    expect(detailSource).toContain("updateAuxiliaryMaterialRequirement");
    expect(detailSource).toContain("updateContractAuxiliaryMaterialSetting(");
    expect(detailSource).toContain("detail.value.contract.version");
    expect(backendSource).toContain('"/:id/auxiliary-material-setting"');
    expect(backendSource).toContain("auxiliary_material_requirement_updated");
    expect(detailSource).toContain('label="辅助材料"');
    expect(detailSource).toContain('name="auxiliary"');
    expect(detailSource).toContain("<ContractAuxiliaryPackageManager");
    expect(detailSource).not.toContain('label="合同二级分类"');
    const descriptionItem = detailSource.indexOf(
      '<el-descriptions-item label="合同说明">',
    );
    const auxiliaryItem = detailSource.indexOf(
      '<el-descriptions-item label="是否需要辅助材料">',
    );
    expect(descriptionItem).toBeGreaterThan(-1);
    expect(auxiliaryItem).toBeGreaterThan(descriptionItem);
    expect(
      detailSource
        .slice(descriptionItem, auxiliaryItem)
        .match(/<el-descriptions-item/g),
    ).toHaveLength(1);
  });

  it("主合同详情明确展示待生效补充协议的变更前后金额", () => {
    expect(detailSource).toContain("补充协议变更后合同金额");
    expect(detailSource).toContain("hasPendingSupplementAmountChange");
    expect(detailSource).toContain("变更前");
    expect(detailSource).toContain("本次增减");
    expect(detailSource).toContain("份补充协议待生效");
    expect(detailSource).toContain("回款暂按变更后金额展示");
    expect(detailSource).toContain("驳回后恢复原金额");
    expect(detailSource).toContain("有效回单 / ${");
    expect(detailSource).toContain("'变更后合同金额'");
    expect(detailSource).toContain('contract?.relationType === "supplement"');
    expect(detailSource).toContain("contract.amountAfterChange");
    expect(backendSource).toContain("AS projected_amount");
    expect(backendSource).toContain("AS pending_supplement_count");
    expect(backendSource).toContain("const accountingBasisAmount =");
    expect(backendSource).toContain("const isPendingSupplement =");
    expect(backendSource).toContain("supplementAmountBeforeChange");
    expect(backendSource).toContain("supplementAmountAfterChange");
    expect(backendSource).toContain(
      "buildContractAccounting(\n            contract.category as ContractCategory,\n            contract.financial_direction,\n            accountingBasisAmount,",
    );
    expect(backendSource).toContain(
      "excessContractAmount(accountingBasisAmount, settledAmount)",
    );
  });

  it("主合同详情提供快速补充协议入口并锁定父合同", () => {
    expect(detailSource).toContain("上传补充协议");
    expect(detailSource).toContain("const canUploadSupplement = computed");
    expect(detailSource).toContain(
      'detail.value?.contract.relationType === "main"',
    );
    expect(detailSource).toContain("!detail.value.contract.renewalContractId");
    expect(detailSource).toContain('["effective", "executing", "completed"]');
    expect(detailSource).toContain(
      "parentContractId: detail.value.contract.id",
    );
    expect(detailSource).toContain('quickSupplement: "1"');
  });

  it("租赁原合同详情提供续签和按履行进度分流的退租或还车入口", () => {
    expect(detailSource).toContain("canManageRentalLifecycle");
    expect(detailSource).toContain(">续签</el-button");
    expect(detailSource).toContain("{{ rentalExitLabel }}");
    expect(detailSource).toContain('"parking_space"');
    expect(detailSource).toContain('rentalRenewal: "1"');
    const renewalSource = detailSource.slice(
      detailSource.indexOf("function openRentalRenewal"),
      detailSource.indexOf("async function openRentalExit"),
    );
    expect(renewalSource).toContain(
      "sourceContractId: detail.value.contract.id",
    );
    expect(renewalSource).not.toContain("quickSupplement");
    expect(renewalSource).not.toContain("parentContractId");
    expect(detailSource).toContain('quickTermination: "1"');
    expect(detailSource).toContain(
      'contract.declaredSubtype === "vehicle_rental"',
    );
    expect(detailSource).toContain("normalizedProgress.value < 100");
    expect(detailSource).toContain("confirmCompletedRentalExit(");
    expect(detailSource).toContain("detail.value.contract.version");
    expect(detailSource).toContain("不需要上传解除协议");
    expect(detailSource).toContain(':loading="rentalExitConfirming"');
    expect(contractApiSource).toContain(
      "export async function confirmCompletedRentalExit",
    );
    expect(contractApiSource).toContain(
      "`/api/contracts/${contractId}/rental-exit/confirm`",
    );
    expect(detailSource).toContain("CONTRACT_RENTAL_EXIT_AGREEMENT_REQUIRED");
    expect(detailSource).toContain("getContractErrorCode(error)");
    expect(detailSource).toContain(
      "openRentalExitAgreementUpload(currentContract)",
    );
  });

  it("原租赁合同与独立续签主合同在详情中双向跳转", () => {
    expect(detailSource).toContain("detail.contract.previousLeaseContractId");
    expect(detailSource).toContain('label="续签来源"');
    expect(detailSource).toContain("查看原租赁主合同");
    expect(detailSource).toContain("detail.contract.renewalContractId");
    expect(detailSource).toContain("detail.contract.renewalContractName");
    expect(detailSource).toContain('label="续签去向"');
    expect(detailSource).toContain("查看续签后的新主合同");
    expect(detailSource).toContain("detail.contract.renewalContractStatus");
    expect(contractApiSource).toContain("source.previous_lease_contract_id");
    expect(contractApiSource).toContain("source.renewal_contract_id");
    expect(contractApiSource).toContain("source.renewal_contract_name");
    expect(contractApiSource).toContain("source.renewal_contract_status");
  });

  it("车位纳入租赁生命周期但仍使用普通资产财务展示", () => {
    const lifecycleStart = detailSource.indexOf(
      "const isRentalLifecycleContract = computed",
    );
    const financeStart = detailSource.indexOf(
      "const isRentalLease = computed",
      lifecycleStart,
    );
    const financeEnd = detailSource.indexOf(
      "const canManageRentalLifecycle = computed",
      financeStart,
    );
    expect(detailSource.slice(lifecycleStart, financeStart)).toContain(
      '"parking_space"',
    );
    expect(detailSource.slice(financeStart, financeEnd)).toContain(
      '["house_rental", "vehicle_rental"]',
    );
    expect(detailSource.slice(financeStart, financeEnd)).not.toContain(
      '"parking_space"',
    );
    expect(detailSource).toContain(
      "canUploadTermination && !isRentalLifecycleContract",
    );
    expect(detailSource).toContain("isAssetContract && !isRentalLease");
  });

  it("补充协议详情展示五项金额链并正确标记仅付款方式变更", () => {
    expect(detailSource).toContain("isSupplementContract");
    expect(detailSource).toContain("主合同原始");
    expect(detailSource).toContain("生效前");
    expect(detailSource).toContain("本次增减");
    expect(detailSource).toContain("生效后");
    expect(detailSource).toContain("当前有效");
    expect(detailSource).toContain("仅变更付款方式");
    expect(detailSource).toContain(
      'detail.value?.contract.supplementChangeType === "payment_terms_only"',
    );
    expect(detailSource).toContain("currentEffectiveAmount");
  });

  it("关联合同按正式生效时间优先、补充协议序号兜底排序", () => {
    expect(detailSource).toContain("orderedRelations");
    expect(detailSource).toContain("compareContractRelations");
    expect(detailSource).toContain("left.effectiveAt");
    expect(detailSource).toContain("left.supplementSequence");
  });

  it("详情页顶部固定展示本轮审批操作且只向目标审批人开放", () => {
    const detailTopbarSource = detailSource.slice(
      detailSource.indexOf('<div class="detail-topbar">'),
      detailSource.indexOf('<div\n      v-if="sealVerificationError"'),
    );
    expect(detailTopbarSource).toContain("canApprove &&");
    expect(detailTopbarSource).toContain("openDetailApproval('reject')");
    expect(detailTopbarSource).toContain("openDetailApproval('approve')");
    expect(detailTopbarSource).toContain("detailApprovalRejectLabel");
    expect(detailTopbarSource).toContain("detailApprovalPrimaryLabel");
    expect(detailTopbarSource).not.toContain("focusDetailApproval");
    expect(detailTopbarSource).not.toContain("处理审批");
    expect(detailSource.indexOf('<div class="detail-topbar">')).toBeLessThan(
      detailSource.indexOf("<el-tabs"),
    );
    const tabsStart = detailSource.indexOf("<el-tabs");
    const tabsEnd = detailSource.indexOf("</el-tabs>", tabsStart);
    const detailApprovalWorkspaceHost = detailSource.indexOf(
      'class="detail-approval-workspace-host"',
    );
    expect(
      detailApprovalWorkspaceHost < tabsStart ||
        detailApprovalWorkspaceHost > tabsEnd,
    ).toBe(true);

    const approvalTabSource = detailSource.slice(
      detailSource.indexOf(':label="`审批流程（${approvalFlowNodeCount}）`"'),
      detailSource.indexOf(
        ':label="`合同附件（${displayedContractFiles.length}）`"',
      ),
    );
    expect(approvalTabSource).not.toContain("approval-decision-entry");
    expect(approvalTabSource).not.toContain("openDetailApproval('approve')");
    expect(approvalTabSource).not.toContain("openDetailApproval('reject')");

    const approvalTargetGateSource = detailSource.slice(
      detailSource.indexOf("const canApprove = computed("),
      detailSource.indexOf("const approvalUsesProjectOwner = computed("),
    );
    expect(approvalTargetGateSource).toContain(
      "detail.value?.contract.approvalTargetId === authStore.user?.id",
    );
    expect(detailSource.match(/canApprove &&/g)).toHaveLength(1);
    expect(detailSource).toContain("detailManagerSealApprovalActive");
    expect(detailTopbarSource).toContain("!detailManagerSealApprovalActive");
    expect(detailSource).toContain(
      'v-if="!detailManagerSealApprovalActive" class="detail-hero"',
    );
    expect(detailSource).toContain(
      'v-if="!detailManagerSealApprovalActive"\n        v-model="activeTab"',
    );

    const openDetailApprovalSource = detailSource.slice(
      detailSource.indexOf("function openDetailApproval("),
      detailSource.indexOf("async function closeDetailApprovalWorkspace()"),
    );
    expect(openDetailApprovalSource).toContain("!canApprove.value");
    expect(openDetailApprovalSource).toContain(
      'detail.value?.contract.status !== "approving"',
    );
  });
});
