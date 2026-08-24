jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

import fs from "fs";
import path from "path";
import { api } from "@/utils/api";
import {
  getContract,
  getContractFileUrl,
  getContractSealApplication,
  getPendingContractApprovals,
  getProcessedContractApprovals,
} from "@/utils/contractApi";

describe("合同审批流程与内部安全留痕", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("合同详情把审批流程记录规范化为处理前和处理后状态", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          contract: {
            id: "contract-1",
            category: "main_business",
            relationType: "main",
            status: "approving",
            approval_target_position: "项目经理",
          },
          approvals: [
            {
              id: "approval-1",
              action: "submit",
              approver_name: "吴静雯",
              approver_role: "admin",
              approver_position: "行政主管",
              from_status: "draft",
              to_status: "approving",
              created_at: "2026-08-11T08:50:00.000Z",
            },
          ],
          files: [
            {
              id: "seal-application-file",
              file_name: "用印申请单.pdf",
              file_type: "seal_application",
              mime_type: "application/pdf",
              is_current: true,
            },
          ],
          ocrFields: [],
          invoices: [],
          receipts: [],
          payments: [],
          relations: [],
        },
      },
    });

    const result = await getContract("contract-1");

    expect(result.approvals[0]).toMatchObject({
      approverName: "吴静雯",
      approverPosition: "行政主管",
      fromStatus: "draft",
      toStatus: "approving",
      createdAt: "2026-08-11T08:50:00.000Z",
    });
    expect(result.contract.approvalTargetPosition).toBe("项目经理");
    expect(result.files[0]).toMatchObject({
      fileType: "seal_application",
      isCurrent: true,
    });
  });

  it("按当前快照审批人和分页参数读取待办与已处理审批", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
      },
    });
    await getPendingContractApprovals({ page: 1, pageSize: 20 });
    expect(api.get).toHaveBeenCalledWith("/api/contracts/approvals/pending", {
      params: { page: 1, pageSize: 20 },
    });

    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [
            {
              id: "contract-1",
              approvalRecordId: "approval-1",
              approvalAction: "approve",
            },
          ],
          total: 1,
          page: 2,
          pageSize: 20,
          totalPages: 1,
        },
      },
    });

    const result = await getProcessedContractApprovals({
      page: 2,
      pageSize: 20,
      keyword: "示例合同",
    });

    expect(api.get).toHaveBeenCalledWith("/api/contracts/approvals/processed", {
      params: { page: 2, pageSize: 20, keyword: "示例合同" },
    });
    expect(result.items[0]).toMatchObject({
      approvalRecordId: "approval-1",
      approvalAction: "approve",
    });
  });

  it("区分合同文件预览与下载地址", () => {
    expect(getContractFileUrl("file/1")).toBe("/api/contracts/files/file%2F1");
    expect(getContractFileUrl("file/1", true)).toBe(
      "/api/contracts/files/file%2F1?download=1",
    );
  });

  it("读取最终单页双签用印申请单", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "seal-application-1",
          signedFileId: "applicant-signed-file",
          approvedFileId: "manager-approved-file",
          fullySigned: true,
        },
      },
    });

    const result = await getContractSealApplication("contract-1");

    expect(api.get).toHaveBeenCalledWith(
      "/api/contracts/contract-1/seal-application",
    );
    expect(result).toMatchObject({
      approvedFileId: "manager-approved-file",
      fullySigned: true,
    });
  });

  it("后端严格限制已处理记录权限并保留审计读取权限", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );

    expect(source).toContain(
      'router.get("/approvals/pending", requireContractApprover',
    );
    expect(source).toContain(
      '"/approvals/processed",\n  requireContractApprover',
    );
    expect(source).toContain(
      'router.post("/:id/approve", requireContractApprover',
    );
    expect(source).toContain(
      'router.get("/pending-seal-count", requireFinance',
    );
    expect(source).toContain(
      'const CONTRACT_APPROVER_ROLES = ["general_manager"] as const',
    );
    expect(source).toContain('router.get("/:id/audit-logs", requireAuth');
    expect(source).toContain("approval_round.target_approver_id = ?");
    expect(source).toContain("ar.action IN ('approve', 'reject')");
    expect(source).toContain(
      "THEN '总经理' ELSE u.position END AS approver_position",
    );
    expect(source).toContain(
      "approval_target_user.position AS approval_target_position",
    );
    expect(source).toContain(
      "approval_round.submitted_at ASC, approval_round.id ASC",
    );
    expect(source).toContain("THEN 'file_downloaded' ELSE 'file_previewed'");
  });

  it("用印申请只读允许总经理但不扩张编辑和签署权限", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contractSealApplications.ts"),
      "utf8",
    );

    expect(source).toContain(
      "const requireSealApplicationRead = requireRole([",
    );
    expect(source).toContain('"general_manager",');
    expect(source).toContain(
      '"/:id/seal-application",\n  requireSealApplicationRead,',
    );
    expect(source).toContain(
      'router.put("/:id/seal-application", requireFinance',
    );
    expect(source).toContain(
      'router.post("/:id/seal-application/sign", requireFinance',
    );
  });

  it("前端提供页内审批工作区且不再展示操作审计页签", () => {
    const listSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractList.vue"),
      "utf8",
    );
    const approvalSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractApprovalCenter.vue"),
      "utf8",
    );
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    const detailApprovalWorkspaceSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractApprovalWorkspace.vue",
      ),
      "utf8",
    );
    const sealApplicationApprovalPreviewSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractSealApplicationApprovalPreview.vue",
      ),
      "utf8",
    );
    const sealEditorSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractSealApplicationEditor.vue",
      ),
      "utf8",
    );
    const approvalTemplateSource = approvalSource.slice(
      approvalSource.indexOf("<template>"),
      approvalSource.indexOf("<script setup"),
    );
    const approvalScriptSource = approvalSource.slice(
      approvalSource.indexOf("<script setup"),
      approvalSource.indexOf("</script>"),
    );

    expect(approvalSource).toContain('label="待我审批"');
    expect(approvalSource).toContain('label="我已处理"');
    expect(approvalSource).toContain("最早提交优先");
    expect(approvalSource).toContain("当前页加载失败，已回退到上一页重试");
    expect(approvalSource).toContain("getProcessedContractApprovals");
    expect(approvalSource).toContain("盖章差异复审");
    expect(approvalSource).not.toContain("<el-dialog");
    expect(approvalTemplateSource).toContain('class="approval-workspace-host"');
    expect(approvalSource).toContain("approvalWorkspaceVisible");
    expect(approvalSource).toContain("closeApprovalWorkspace");
    expect(approvalTemplateSource).toContain("<ContractApprovalWorkspace");
    expect(approvalTemplateSource).toContain(
      'v-if="!managerSealApprovalActive" class="approval-hero"',
    );
    expect(approvalTemplateSource).toContain(':contract="selectedContract"');
    expect(approvalTemplateSource).toContain(
      ':initial-action="approvalAction"',
    );
    expect(approvalTemplateSource).toContain('close-label="返回审批列表"');
    expect(approvalTemplateSource).toContain('@close="closeApprovalWorkspace"');
    expect(approvalTemplateSource).toContain(
      '@completed="handleApprovalCompleted"',
    );
    expect(approvalScriptSource).toContain(
      'import ContractApprovalWorkspace from "@/components/contracts/ContractApprovalWorkspace.vue"',
    );
    expect(approvalScriptSource).toContain("managerSealApprovalActive");
    expect(approvalScriptSource).not.toContain("loadPersonalSignatureState");
    expect(approvalScriptSource).not.toContain("getContractSealApplication");
    expect(approvalScriptSource).not.toContain(
      "getLatestSealedContractVerification",
    );
    expect(approvalScriptSource).not.toContain("approveContract");
    expect(approvalScriptSource).not.toContain("ContractFilePreview");
    expect(approvalScriptSource).not.toContain("signManagerApprovalArea");
    expect(approvalScriptSource).not.toContain("submitApproval");
    expect(approvalTemplateSource).not.toContain("manager-signature-field");
    expect(approvalTemplateSource).not.toContain("ContractFilePreview");
    expect(sealEditorSource).toContain('class="applicant-signature-slot"');
    expect(sealEditorSource).toContain("'申请人签署栏，点击进行签名'");
    expect(sealEditorSource).toContain('@click="signApplicantArea"');
    expect(sealEditorSource).toContain("点击签署区域进行签名");
    expect(sealEditorSource).toContain(
      'personalSignatureDataUrl ? "待提交" : "待签署"',
    );
    expect(sealEditorSource).toContain('v-if="personalSignatureDataUrl"');
    expect(sealEditorSource).toContain("本人签名已确认，尚未生成申请单");
    expect(sealEditorSource).toContain(
      "Boolean(personalSignatureDataUrl.value)",
    );
    expect(sealEditorSource).not.toContain("调用本人电子签名");
    expect(approvalSource).toContain("需本人签名");
    expect(approvalSource).toContain("补充协议审批");
    expect(approvalSource).toContain("变更前");
    expect(approvalSource).toContain("变更后合同金额（回款口径）");
    expect(approvalSource).toContain("supplementChangeTypeLabel(item)");
    expect(approvalSource).toContain(
      'item.supplementChangeType === "payment_terms_only"',
    );
    expect(approvalSource).toContain("supplementAmountDelta(item)");
    expect(approvalSource).toContain("item.parentContractName");
    expect(detailApprovalWorkspaceSource).toContain("supplement-context");
    expect(detailApprovalWorkspaceSource).toContain("仅变更付款方式");
    expect(detailApprovalWorkspaceSource).toContain(
      "isPaymentTermsOnlySupplement",
    );
    expect(detailApprovalWorkspaceSource).toContain("supplementAmountDelta");
    expect(detailApprovalWorkspaceSource).toContain(
      "contract.amountBeforeChange",
    );
    expect(detailApprovalWorkspaceSource).toContain(
      "contract.amountAfterChange",
    );
    expect(detailApprovalWorkspaceSource).toContain("所属主合同");
    expect(approvalSource).toContain('return "审批并签名"');
    expect(approvalSource).toContain("item.approvalFromStatus");
    expect(approvalSource).toContain("item.approvalToStatus");
    expect(approvalSource).toContain("处理前状态");
    expect(approvalSource).toContain("处理后状态");
    expect(listSource).not.toContain("canApproveItem");
    expect(listSource).not.toContain("openPendingApproval");
    expect(listSource).toContain("router.push('/contract-approvals')");
    expect(detailSource).not.toContain('name="audit"');
    expect(detailSource).not.toContain("getContractAuditLogs");
    expect(detailSource).not.toContain("操作审计");
    expect(detailSource).not.toContain("approveContract");
    expect(detailSource).not.toContain("approvalDialogVisible");
    expect(detailSource).not.toContain("function openApproval(");
    expect(detailSource).not.toContain("async function submitApproval(");
    expect(detailSource).toContain(
      "contract.approvalTargetId === authStore.user?.id",
    );
    expect(detailSource).toContain("<ContractApprovalWorkspace");
    expect(detailSource).toContain("openDetailApproval('approve')");
    expect(detailSource).toContain("openDetailApproval('reject')");
    expect(detailSource).toContain("function openDetailApproval(");
    expect(detailSource).toContain("!canApprove.value");
    expect(detailSource).not.toContain("当前审批待您处理");
    expect(detailSource).not.toContain("可在合同详情内完成审批");
    expect(detailSource).not.toContain("focusDetailApproval");
    expect(detailSource).not.toContain("处理审批");
    expect(detailSource).toContain('return "审批并签名"');
    expect(detailSource).not.toContain("前往审批中心");
    expect(detailSource).toContain("detailBackLabel");
    expect(detailSource).toContain('route.query.from === "contract-approvals"');
    expect(detailSource).toContain("detailHasPreviousPage");
    expect(detailSource).toContain("route.query.backContractId");
    expect(detailSource).toContain('"返回上一个页面"');
    expect(detailSource).toContain("function handleDetailBack()");
    expect(detailSource).toContain("router.back()");
    expect(detailSource).toContain("function openRelatedContract(");
    expect(detailSource).toContain(
      "query: { backContractId: contractId.value }",
    );
    expect(approvalSource).toContain('from: "contract-approvals"');
    const openContractDetailSource = approvalScriptSource.slice(
      approvalScriptSource.indexOf("function openContractDetail("),
      approvalScriptSource.indexOf("function isSealDifferenceReview("),
    );
    expect(openContractDetailSource).toContain('from: "contract-approvals"');
    expect(openContractDetailSource).toContain("fromTab: activeTab.value");
    expect(openContractDetailSource).toContain('tab: "overview"');
    expect(openContractDetailSource).not.toContain('tab: "approval"');
    expect(detailSource).toContain("<h2>审批流程</h2>");
    expect(detailSource).not.toContain("<h2>审批记录</h2>");
    expect(detailSource).not.toContain("approval-flow-overview");
    expect(detailSource).not.toContain("<small>当前状态</small>");
    expect(detailSource).not.toContain("<small>下一步状态</small>");
    expect(detailSource).not.toContain("approvalFlowNextStateLabel");
    expect(detailSource).not.toContain("approvalFlowNextDescription");
    expect(detailSource).toContain("approvalFlowPendingTitle");
    expect(detailSource).toContain("formatContractDateTime(record.createdAt)");
    expect(detailSource).toContain('timestamp="待处理"');
    expect(detailSource).toContain('placement="top"');
    expect(detailSource).not.toContain("currentSealApplicationFile");
    expect(detailSource).not.toContain("用印申请单签字位置");
    expect(detailSource).not.toContain("approval-seal-application");
    expect(detailSource).toContain("approvalFlowNodeCount");
    expect(detailSource).toContain("record.approverPosition");
    expect(detailSource).toContain("contract.approvalTargetPosition");
    expect(detailSource).toContain("`等待${position} ${name}审批`");
    expect(detailSource).not.toContain("本轮目标：");
    expect(detailSource).not.toContain("record.fromStatus");
    expect(detailSource).not.toContain("record.toStatus");

    const detailTopbarSource = detailSource.slice(
      detailSource.indexOf('<div class="detail-topbar">'),
      detailSource.indexOf('<div\n      v-if="sealVerificationError"'),
    );
    expect(detailTopbarSource).toContain("openDetailApproval('reject')");
    expect(detailTopbarSource).toContain("openDetailApproval('approve')");
    expect(detailTopbarSource).toContain("detailApprovalRejectLabel");
    expect(detailTopbarSource).toContain("detailApprovalPrimaryLabel");

    const approvalTabSource = detailSource.slice(
      detailSource.indexOf(':label="`审批流程（${approvalFlowNodeCount}）`"'),
      detailSource.indexOf(
        ':label="`合同附件（${displayedContractFiles.length}）`"',
      ),
    );
    expect(approvalTabSource).not.toContain("approval-decision-entry");
    expect(approvalTabSource).not.toContain("openDetailApproval('reject')");
    expect(approvalTabSource).not.toContain("openDetailApproval('approve')");

    const displayedFilesSource = detailSource.slice(
      detailSource.indexOf("const displayedContractFiles = computed"),
      detailSource.indexOf("const detailManagerSealApprovalActive"),
    );
    expect(displayedFilesSource).toContain(
      'file.fileType === "seal_application"',
    );
    expect(displayedFilesSource).toContain("sourceContractId");
    expect(displayedFilesSource).toContain("sealApplicationsByOwner");
    expect(displayedFilesSource).toContain(
      "ordered.find((file) => file.isCurrent)",
    );
    expect(displayedFilesSource).not.toContain(
      "sealApplications.find((file) => file.isCurrent)",
    );
    expect(detailSource).toContain('v-for="group in contractFileGroups"');
    expect(detailSource).toContain('v-for="source in group.sources"');
    expect(detailSource).toContain('v-for="file in source.files"');
    expect(detailSource).toContain("v-if=\"group.key === 'invoice'\"");
    expect(detailSource).toContain('v-for="file in group.files"');
    expect(detailSource).not.toContain(
      'v-for="file in displayedContractFiles"',
    );

    const applicantSignatureAreaSource = sealEditorSource.slice(
      sealEditorSource.indexOf("async function signApplicantArea()"),
      sealEditorSource.indexOf("function requestSign()"),
    );
    expect(applicantSignatureAreaSource).toContain("loadPersonalSignature()");

    const closeApprovalSource = approvalScriptSource.slice(
      approvalScriptSource.indexOf("function closeApprovalWorkspace()"),
      approvalScriptSource.indexOf("function openApproval("),
    );
    expect(closeApprovalSource).toContain("resetAndHideApprovalWorkspace()");

    const openApprovalSource = approvalScriptSource.slice(
      approvalScriptSource.indexOf("function openApproval("),
      approvalScriptSource.indexOf("async function handleApprovalCompleted("),
    );
    expect(openApprovalSource).toContain("if (!canApproveItem(item)) return;");
    expect(openApprovalSource).toContain("selectedContract.value = item");
    expect(openApprovalSource).toContain("approvalAction.value = action");
    expect(openApprovalSource).toContain(
      "approvalWorkspaceVisible.value = true",
    );
    expect(openApprovalSource).not.toContain("getContractSealApplication");
    expect(openApprovalSource).not.toContain("loadPersonalSignatureState");

    const approvalCompletedSource = approvalScriptSource.slice(
      approvalScriptSource.indexOf("async function handleApprovalCompleted("),
      approvalScriptSource.indexOf("onMounted(loadActiveContracts)"),
    );
    expect(approvalCompletedSource).toContain(
      "if (!payload.keepOpen) {\n    resetAndHideApprovalWorkspace();\n  }",
    );
    expect(approvalCompletedSource).toContain("await loadActiveContracts()");

    expect(detailApprovalWorkspaceSource).not.toContain("<el-dialog");
    expect(detailApprovalWorkspaceSource).toContain("合同审批工作区");
    expect(detailApprovalWorkspaceSource).toContain(
      "<ContractSealApplicationApprovalPreview",
    );
    expect(detailApprovalWorkspaceSource).toContain(
      '@sign="signManagerApprovalArea"',
    );
    expect(detailApprovalWorkspaceSource).toContain("确认审批并签名");
    expect(detailApprovalWorkspaceSource).toContain(
      "!managerSignatureDataUrl.value",
    );
    expect(detailApprovalWorkspaceSource).toContain(
      "sealApplication.value?.approvedFileId",
    );
    const completedApplicationRecoverySource =
      detailApprovalWorkspaceSource.slice(
        detailApprovalWorkspaceSource.indexOf(
          "if (application.fullySigned && application.approvedFileId)",
        ),
        detailApprovalWorkspaceSource.indexOf("if (!application.signedFileId)"),
      );
    expect(completedApplicationRecoverySource).toContain(
      'emit("completed", { keepOpen: true })',
    );
    expect(detailApprovalWorkspaceSource).not.toContain(
      'class="manager-signature-alert"',
    );
    expect(detailApprovalWorkspaceSource).not.toContain(
      "点击签署栏后显示本人锁定签名，此时尚未写入申请单",
    );

    if (detailApprovalWorkspaceSource.includes("<header")) {
      const detailWorkspaceHeaderSource = detailApprovalWorkspaceSource.slice(
        detailApprovalWorkspaceSource.indexOf("<header"),
        detailApprovalWorkspaceSource.indexOf("</header>") + 9,
      );
      expect(detailWorkspaceHeaderSource).toContain(
        'v-if="!managerSealApplicationRequired"',
      );
    }

    const detailWorkspaceStandardBranchSource =
      detailApprovalWorkspaceSource.slice(
        detailApprovalWorkspaceSource.indexOf("<template v-else>"),
        detailApprovalWorkspaceSource.indexOf("</template>\n    </div>"),
      );
    expect(detailWorkspaceStandardBranchSource).toContain(
      'class="workspace-contract"',
    );

    const managerSealWorkspaceSource = detailApprovalWorkspaceSource.slice(
      detailApprovalWorkspaceSource.indexOf(
        'v-if="managerSealApplicationRequired"',
      ),
      detailApprovalWorkspaceSource.indexOf("<template v-else>"),
    );
    expect(managerSealWorkspaceSource).toContain(
      "<ContractSealApplicationApprovalPreview",
    );
    expect(managerSealWorkspaceSource).toContain(
      '@sign="signManagerApprovalArea"',
    );
    expect(managerSealWorkspaceSource).not.toContain(
      'class="workspace-contract"',
    );
    expect(managerSealWorkspaceSource).not.toContain("用印申请单审批签署");
    expect(managerSealWorkspaceSource).not.toContain("审批结果已经固化");
    expect(managerSealWorkspaceSource).not.toContain("申请人已在单页左侧签署");

    expect(sealApplicationApprovalPreviewSource).toContain(
      'aria-label="用印申请单"',
    );
    expect(sealApplicationApprovalPreviewSource).toContain(
      'class="approver-signature-slot"',
    );
    expect(sealApplicationApprovalPreviewSource).toContain(
      "总经理审批签署，点击进行签名",
    );
    expect(sealApplicationApprovalPreviewSource).toContain("点击此处签名");
    expect(sealApplicationApprovalPreviewSource).toContain(
      "@click=\"emit('sign')\"",
    );
    expect(sealApplicationApprovalPreviewSource).toContain(
      "if (document.numPages !== 1)",
    );

    const detailWorkspaceSuccessBranch = detailApprovalWorkspaceSource.slice(
      detailApprovalWorkspaceSource.indexOf("if (completesManagerSignature) {"),
      detailApprovalWorkspaceSource.indexOf(
        "ElMessage.success(successMessage(currentAction))",
      ),
    );
    expect(detailWorkspaceSuccessBranch).toContain(
      "managerApprovalCompleted.value = true",
    );
    expect(detailWorkspaceSuccessBranch).toContain(
      'emit("completed", { keepOpen: true })',
    );
    expect(detailWorkspaceSuccessBranch).toContain(
      "loadSealApplicationPreview(contractId, true, sequence)",
    );

    const detailCompletionSource = detailSource.slice(
      detailSource.indexOf("async function handleDetailApprovalCompleted("),
      detailSource.indexOf("async function handleSubmitDraft()"),
    );
    expect(detailCompletionSource).toContain("if (payload.keepOpen) return;");
    expect(detailCompletionSource).not.toContain(
      "detailApprovalWorkspaceVisible.value = false;\n  if (payload.keepOpen)",
    );
  });

  it("新增和审批中心统一显示总经理审批人", () => {
    const createSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractCreate.vue"),
      "utf8",
    );
    const approvalSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractApprovalCenter.vue"),
      "utf8",
    );
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    expect(createSource).toContain("提交总经理审批");
    expect(createSource).not.toContain("提交项目负责人审批");
    expect(approvalSource).toContain('return "总经理审批"');
    expect(approvalSource).toContain(
      "item.approvalTargetId === authStore.user.id",
    );
    expect(detailSource).toContain("approvalTargetLabel");
  });
});
