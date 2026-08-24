jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock("@/components/contracts/ContractApprovalWorkspace.vue", () => ({
  __esModule: true,
  default: { name: "ContractApprovalWorkspace" },
}));

import fs from "fs";
import path from "path";
import { api } from "@/utils/api";
import ContractDetail from "@/views/ContractDetail.vue";
import {
  archiveSealedContractVerification,
  getLatestSealedContractVerification,
  reapproveSealedContractDifference,
  retrySealedContractVerification,
  uploadSealedContract,
} from "@/utils/contractApi";

const envelope = (data: unknown) => ({
  data: { success: true, data },
});

describe("盖章合同核验前端闭环", () => {
  beforeEach(() => jest.clearAllMocks());

  it("合同详情以内嵌工作区完成自动核验、逐方比对和页内归档", () => {
    expect(ContractDetail).toBeTruthy();
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    expect(source).toContain("上传后由系统自动识别并核验，不会直接让合同生效");
    expect(source).toContain(
      ':href="getContractFileUrl(sealVerification.fileId)"',
    );
    expect(source).toContain('target="_blank"');
    expect(source).toContain("只能重新识别或重新上传");
    expect(source).toContain("合同签订日期缺失时采用上传日期兜底");
    expect(source).toContain('class="seal-lease-period"');
    expect(source).toContain("下表核验的是合同签订日期，不是租赁起始日期");
    expect(source).toContain('label="盖章核验"');
    expect(source).toContain('name="seal"');
    expect(source).toContain("seal-workspace-card");
    expect(source).not.toContain('v-model="sealedDialogVisible"');
    expect(source).not.toContain("openSealedDialog");
    expect(source).toContain("openSealedWorkspace");
    expect(source).toContain('activeTab.value = "seal"');
    expect(source).toContain(
      'requestedTab === "seal" && sealWorkspaceVisible.value',
    );
    expect(source).not.toContain("确认待复核字段");
    expect(source).not.toContain("confirmSealedContractVerification");
    expect(source).toContain("difference_explanation_required");
    expect(source).toContain("提交差异复审");
    expect(source).toContain("确认归档生效");
    expect(source).toContain("isSealDifferenceApproval");
    expect(source).toContain(':show-file-list="false"');
    expect(source).toContain("resetSealedUpload");
    expect(source).toContain("const hasSealedContractFile");
    expect(source).toContain('["sealed", "sealed_contract"]');
    expect(source).toMatch(
      /contract &&\s*hasSealedContractFile &&\s*\(contract\.status === "pending_seal"/,
    );

    const buttonBlock = (handler: string) => {
      const clickIndex = source.indexOf(`@click="${handler}"`);
      expect(clickIndex).toBeGreaterThan(-1);
      const start = source.lastIndexOf("<el-button", clickIndex);
      const end = source.indexOf("</el-button>", clickIndex);
      return source.slice(start, end);
    };

    expect(buttonBlock("retrySealedVerification")).toContain("!sealReplacing");
    expect(buttonBlock("retrySealedVerification")).toContain(
      "ready_to_archive",
    );
    expect(buttonBlock("submitSealDifferenceApproval")).toContain(
      "!sealReplacing",
    );
    expect(source).toContain("beginSealArchiveConfirmation");
    expect(source).toContain("cancelSealArchiveConfirmation");
    expect(source).toContain("sealArchiveConfirming");
    expect(source).toContain("确认归档盖章合同？");
    const archiveHandler = source.slice(
      source.indexOf("async function archiveSealedVerification()"),
      source.indexOf("async function handleFinancialRegistrationCreated()"),
    );
    expect(archiveHandler).not.toContain("ElMessageBox.confirm");
    expect(archiveHandler).toContain("!sealArchiveConfirming.value");
    expect(
      source.match(/preventExistingSealActionWhileReplacing\(\)/g),
    ).toHaveLength(5);
    expect(source).toContain(
      "正在重新上传盖章合同，请先点击“上传并开始核验”或返回核验结果",
    );

    const retryHandler = source.slice(
      source.indexOf("async function retrySealedVerification()"),
      source.indexOf("function sealFieldLabel"),
    );
    expect(
      retryHandler.indexOf("preventExistingSealActionWhileReplacing()"),
    ).toBeLessThan(retryHandler.indexOf("retrySealedContractVerification("));
  });

  it("用印份数按合同一式几份自动带入且禁止人工修改", () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractSealApplicationEditor.vue",
      ),
      "utf8",
    );
    expect(source).toContain("系统按合同正文“一式几份”精准识别");
    expect(source).toContain("不允许人工修改");
    expect(source).toContain('label="用印份数"');
    expect(source).toContain("'未识别'");
    expect(source).toContain("`${modelValue.copyCount} 份`");
    expect(source).toContain("copyCount: number | null");
    expect(source).toContain('typeof props.modelValue.copyCount === "number"');
    expect(source).not.toContain("updateCopyCount");
    expect(source).not.toContain("重新识别");

    const createSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractCreate.vue"),
      "utf8",
    );
    expect(createSource).toContain("copyCount: null");
    expect(createSource).not.toContain("copyCount: 2");
    expect(createSource).toContain(
      'application.copyCountRecognition.status === "unrecognized"',
    );
  });

  it("已签用印申请单直接渲染单页原图且不显示PDF工具栏", () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractSealApplicationEditor.vue",
      ),
      "utf8",
    );
    expect(source).toContain("<ContractSealApplicationApprovalPreview");
    expect(source).toContain(':url="signedFileUrl"');
    expect(source).not.toContain("<ContractFilePreview");
    expect(source).not.toContain('mime-type="application/pdf"');
  });

  it("逐字段区分内容一致、不一致和缺失无法判断", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    expect(source).toContain('(["party_a", "party_b"] as const)');
    expect(source).toContain(
      'type SealContentComparisonState = "match" | "mismatch" | "missing"',
    );
    expect(source).toContain('match: "内容一致"');
    expect(source).toContain('mismatch: "内容不一致"');
    expect(source).toContain('missing: "缺失，无法判断"');
    expect(source).toContain("sealContentComparisonState(");
    expect(source).toContain("内容一致，自动核验依据不足");
    expect(source).toContain("内容一致，精准核验通过");
    expect(source).not.toContain("isExactVerifiedConfidence");
    expect(source).toContain("草拟审批版");
    expect(source).toContain("盖章版识别");
    expect(source).toContain("任一方不一致都会明确提示并阻止直接归档");
  });

  it("逐字段核验表四列表头与内容居中且核验状态保持单行", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );

    expect(source).toMatch(
      /<div class="seal-field-header">\s*<span>字段<\/span><span>审批版本<\/span><span>盖章版识别值<\/span\s*><span>核验状态<\/span>/,
    );
    expect(source).toMatch(
      /\.seal-field-header > span,\s*\.seal-field-row > span\s*\{[^}]*text-align:\s*center;/s,
    );
    expect(source).toMatch(
      /\.seal-field-row > span:first-child\s*\{[^}]*align-items:\s*center;/s,
    );
    expect(source).toMatch(
      /\.seal-field-row > span:last-child\s*\{[^}]*white-space:\s*nowrap;/s,
    );
  });

  it("复核提示只展示实际阻断并按选填规则处理签订日期", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    expect(source).toContain("sealReviewBlockingReasons");
    expect(source).toContain('当前阻断：${blockers.join("；")}');
    expect(source).toContain("识别内容一致，自动核验依据不足");
    expect(source).toContain("合同签订日期为选填项");
    expect(source).toContain("已采用盖章合同上传日期");
    expect(source).not.toContain("自动验证未通过");
    expect(source).not.toContain("自动验证通过 100%");
    expect(source).not.toContain("关键字段自动识别未通过");
    expect(source).not.toContain(
      "sealVerification.recognitionWarnings.join('；')",
    );
  });

  it("文件选择、上传处理中和失败提示具有明确且可恢复的页面状态", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    const pageErrorIndex = source.indexOf('class="seal-page-error"');
    const detailContentIndex = source.indexOf(
      '<template v-else-if="detail && !errorMessage">',
    );
    expect(pageErrorIndex).toBeGreaterThan(-1);
    expect(pageErrorIndex).toBeLessThan(detailContentIndex);
    expect(source).toContain('title="盖章合同处理失败"');
    expect(source).toContain("closable");
    expect(source).toContain('@close="clearSealVerificationError"');
    expect(source).toContain('role="alert"');
    expect(source).toContain('aria-live="assertive"');
    expect(source).toContain('aria-label="已选择的盖章合同"');
    expect(source).toContain("文件已保留在当前页面，尚未提交到系统");
    expect(source).toContain("在线预览");
    expect(source).toContain('title="正在上传并识别，请勿关闭页面"');
    expect(source).toContain(':disabled="sealUploading"');

    const submitHandler = source.slice(
      source.indexOf("async function submitSealedContract()"),
      source.indexOf("async function retrySealedVerification()"),
    );
    expect(submitHandler).toContain("clearSealVerificationError()");
    expect(submitHandler).toContain("sealUploading.value = true");
    expect(submitHandler).toContain(
      'showSealVerificationError(error, "盖章合同上传或核验失败")',
    );
    expect(submitHandler).toContain("sealUploading.value = false");
    expect(submitHandler).not.toContain("sealedForm.file = null");
  });

  it("选中文件后在上传方框内显示文件卡并在新页面预览", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    const uploadBoxIndex = source.indexOf('class="seal-upload-box"');
    const selectedCardIndex = source.indexOf('class="seal-selected-file-card"');
    const uploadBoxEndIndex = source.indexOf("</div>", selectedCardIndex);

    expect(uploadBoxIndex).toBeGreaterThan(-1);
    expect(selectedCardIndex).toBeGreaterThan(uploadBoxIndex);
    expect(uploadBoxEndIndex).toBeGreaterThan(selectedCardIndex);
    expect(source).toContain("sealedFileExtension");
    expect(source).toContain("formatUploadFileSize(sealedForm.file.size)");
    expect(source).toContain('@click="openSealedLocalPreview"');
    expect(source).toContain(
      'window.open(sealedLocalPreviewUrl.value, "_blank")',
    );
    expect(source).toContain("previewWindow.opener = null");
    expect(source).toContain("已在新页面打开盖章合同");
    expect(source).not.toContain('class="seal-local-preview"');
    expect(source).toContain("<ContractReadOnlyPreview");
    expect(source).toContain("readonlyPreviewVisible.value = true");
    expect(source).not.toContain("employeePreviewVisible");
    expect(source).toContain("URL.createObjectURL(file)");
    expect(source).toContain(
      "URL.revokeObjectURL(sealedLocalPreviewUrl.value)",
    );
    expect(source).toContain("onBeforeUnmount(() =>");
  });

  it("上传盖章版必须携带乐观版本号", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce(
      envelope({ contract: {}, verification: {} }),
    );
    const file = new File(["sealed"], "sealed.pdf", {
      type: "application/pdf",
    });

    await uploadSealedContract("contract-1", file, 7);

    const formData = (api.post as jest.Mock).mock.calls[0][1] as FormData;
    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/contract-1/sealed",
      expect.any(FormData),
      { timeout: 1_200_000 },
    );
    expect(formData.get("expectedVersion")).toBe("7");
  });

  it("核验读取、重试、复审和归档使用独立接口", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce(envelope({ id: "seal-1" }));
    (api.post as jest.Mock)
      .mockResolvedValueOnce(envelope({ contract: {}, verification: {} }))
      .mockResolvedValueOnce(envelope({ contract: {}, verification: {} }))
      .mockResolvedValueOnce(envelope({ contract: {}, verification: {} }));

    await getLatestSealedContractVerification("contract-1");
    await retrySealedContractVerification("contract-1", "seal-1", 8);
    await reapproveSealedContractDifference(
      "contract-1",
      "seal-1",
      9,
      "双方确认后调整",
    );
    await archiveSealedContractVerification("contract-1", "seal-1", 10);

    expect(api.get).toHaveBeenCalledWith(
      "/api/contracts/contract-1/sealed-verifications/latest",
    );
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/api/contracts/contract-1/sealed-verifications/seal-1/retry",
      { expectedVersion: 8 },
      { timeout: 1_200_000 },
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/api/contracts/contract-1/sealed-verifications/seal-1/reapprove",
      { expectedVersion: 9, explanation: "双方确认后调整" },
    );
    expect(api.post).toHaveBeenNthCalledWith(
      3,
      "/api/contracts/contract-1/sealed-verifications/seal-1/archive",
      { expectedVersion: 10 },
    );
  });
});
