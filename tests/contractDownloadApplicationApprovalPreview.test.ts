import fs from "fs";
import path from "path";

function source(file: string) {
  return fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
}

describe("合同附件下载申请单纸面签字", () => {
  const previewSource = source(
    "src/components/contracts/ContractDownloadApplicationApprovalPreview.vue",
  );
  const centerSource = source("src/views/ContractDownloadRequestCenter.vue");

  it("只渲染申请单首页并将签名层覆盖在总经理审批框", () => {
    expect(previewSource).toContain("document.getPage(1)");
    expect(previewSource).not.toContain("document.numPages !== 1");
    expect(previewSource).toContain("top: 79.34%");
    expect(previewSource).toContain("left: 51.91%");
    expect(previewSource).toContain("width: 40.99%");
    expect(previewSource).toContain("height: 15.68%");
    expect(previewSource).toContain("manager-paper-signature-slot");
    expect(previewSource).toContain("@click=\"emit('sign')\"");
    expect(previewSource).toContain('v-if="signatureDataUrl"');
    expect(previewSource).toContain("本人签名已确认 · 待提交");
  });

  it("申请卡片使用纸面签字组件且异步签名不能写入另一条申请", () => {
    expect(centerSource).toContain(
      "<ContractDownloadApplicationApprovalPreview",
    );
    expect(centerSource).toContain(
      ':url="getContractDownloadApplicationPreviewUrl(item.id)"',
    );
    expect(centerSource).toContain('@sign="confirmManagerSignature"');
    expect(centerSource).not.toContain('class="manager-signature-slot"');
    expect(centerSource).toContain(
      "const requestId = inlineApprovalRequestId.value",
    );
    expect(centerSource).toContain(
      "const sequence = ++managerSignatureSequence",
    );
    expect(centerSource).toContain("sequence !== managerSignatureSequence");
    expect(centerSource).toContain(
      "inlineApprovalRequestId.value !== requestId",
    );
    expect(centerSource).toContain("currentRequest.value?.id !== requestId");
    expect(centerSource).toContain("managerSignatureSequence += 1");
  });
});
