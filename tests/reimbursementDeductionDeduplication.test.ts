import fs from "fs";
import path from "path";

import { normalizeCrossModuleInvoiceNumber } from "../server/services/invoiceCrossModuleDeduplication";
import {
  buildCrossUploadInvoiceDuplicateMessage,
  buildReimbursementInvoiceDuplicateMessage,
  buildUploadingInvoiceDuplicateMessage,
} from "../src/utils/reimbursement/invoiceDuplicateMessage";
import { validateInvoiceDuplicate } from "../src/composables/reimbursement/useInvoiceValidation";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("报销核减发票双重查重", () => {
  const routeSource = source("server/routes/reimbursement.ts");
  const dedupSource = source(
    "server/services/invoiceCrossModuleDeduplication.ts",
  );
  const uploaderSource = source(
    "src/components/reimbursement/DeductionUploader.vue",
  );
  const detailSource = source("src/views/BasicReimbursementDetail.vue");
  const createSource = source("src/views/BasicReimbursementCreate.vue");
  const invoiceSource = source("src/composables/reimbursement/useInvoice.ts");

  it("全角、空格和分隔符差异不能绕过发票号码查重", () => {
    expect(normalizeCrossModuleInvoiceNumber("ＦＰ-００１")).toBe("FP001");
    expect(normalizeCrossModuleInvoiceNumber("fp 001")).toBe("FP001");
    expect(normalizeCrossModuleInvoiceNumber("FP001")).toBe("FP001");
    expect(validateInvoiceDuplicate("ＦＰ-００１", ["fp 001"])).toEqual({
      valid: false,
      message: "发票号码 ＦＰ-００１已在报销模块使用，请勿重复上传",
    });
  });

  it("普通发票和历史独立核减发票使用相同有效状态口径", () => {
    expect(dedupSource).toContain("reimbursement_invoices invoice");
    expect(dedupSource).toContain("reimbursement_deduction_invoices deduction");
    expect(
      dedupSource.match(/reimbursement\.status <> 'rejected'/g),
    ).toHaveLength(2);
    expect(
      dedupSource.match(
        /COALESCE\(reimbursement\.is_deleted, FALSE\) = FALSE/g,
      ),
    ).toHaveLength(2);
  });

  it("已有记录和当前上传队列的重复提示按场景统一", () => {
    expect(buildReimbursementInvoiceDuplicateMessage("刘行", "invoice")).toBe(
      "刘行 已在发票上传中上传此发票，请勿重复上传",
    );
    expect(
      buildReimbursementInvoiceDuplicateMessage("丁禹滨", "deduction"),
    ).toBe("丁禹滨 已在核减上传中上传此发票，请勿重复上传");
    expect(
      buildUploadingInvoiceDuplicateMessage("26112000003272296561"),
    ).toBe(
      "发票号码 26112000003272296561已在报销模块使用，请勿重复上传",
    );
    expect(
      buildCrossUploadInvoiceDuplicateMessage(
        "26117000000120380983",
        "invoice",
      ),
    ).toBe(
      "发票号码 26117000000120380983已在发票上传报销模块使用，请勿重复上传",
    );
    expect(
      buildCrossUploadInvoiceDuplicateMessage(
        "26117000000120380983",
        "deduction",
      ),
    ).toBe(
      "发票号码 26117000000120380983已在核减发票上传报销模块使用，请勿重复上传",
    );
    expect(routeSource).toContain("reimbursementInvoiceDuplicateMessage(");
    expect(routeSource).toContain("uploadingInvoiceDuplicateMessage(");
    expect(routeSource).toContain("usage.applicantName");
    expect(routeSource).toContain("usage.usageKind");
    expect(routeSource).not.toContain("已在核减发票上传中上传此发票");
    expect(routeSource).not.toContain(
      "发票号码 ${ocrResult.invoiceNumber} 已在报销模块使用，请勿重复上传",
    );
    expect(routeSource).not.toContain(
      "发票号码 ${displayNumber} 已在报销模块使用，请勿重复上传",
    );
    expect(routeSource).not.toContain("已上传此发票文件，请勿重复提交");
    expect(uploaderSource).not.toContain("正在处理或已上传，请勿重复上传");
    expect(uploaderSource).not.toContain("已在核减上传中存在，请勿重复上传");
    expect(uploaderSource).not.toContain("已在发票上传中存在，请勿重复上传");
    expect(uploaderSource).toContain(
      "buildUploadingInvoiceDuplicateMessage(ocrResult.invoiceNumber)",
    );
    expect(uploaderSource).toContain(
      "buildCrossUploadInvoiceDuplicateMessage(",
    );
    expect(createSource).toContain("showUploadError(");
    expect(detailSource).toContain("showUploadError(");
  });

  it("上传、创建、编辑、旧保存和恢复均执行规范化号码门禁", () => {
    expect(
      routeSource.match(/assertInvoicesNotUsedInReimbursement\(/g)?.length,
    ).toBeGreaterThanOrEqual(5);
    expect(routeSource).toContain("reimbursementInvoiceUsage(");
    expect(routeSource).toContain("REIMBURSEMENT_INVOICE_DUPLICATE_CODE");
    expect(routeSource).toContain("normalizeCrossModuleInvoiceNumber");
    expect(routeSource).toContain("excludeReimbursementId");
    expect(routeSource.match(/\?::text IS NULL/g)).toHaveLength(3);
    expect(routeSource).toContain("create|new|undefined|null");
  });

  it("事务按文件摘要加锁并同时查询普通与历史核减表", () => {
    expect(routeSource).toContain("reimbursement-invoice-file:");
    expect(
      routeSource.match(/lockReimbursementInvoiceFileHashes\(/g)?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(routeSource).toContain("reimbursement_deduction_invoices rdi");
  });

  it("最终写入使用服务端OCR缓存覆盖核减号码、摘要、金额和日期", () => {
    expect(routeSource).toContain("verifyDeductionInvoicePayloads");
    expect(routeSource).toContain("amount: cachedOcr.amount");
    expect(routeSource).toContain("invoiceDate: cachedOcr.date");
    expect(routeSource).toContain("invoiceNumber: cachedOcr.invoiceNumber");
    expect(routeSource).toContain("fileHash: cachedOcr.fileHash");
    expect(routeSource).toContain("核减发票文件不属于当前用户");
  });

  it("前端按规范化号码交叉查重并用占位集合关闭并发竞态", () => {
    expect(uploaderSource).toContain("normalizeInvoiceNumber");
    expect(uploaderSource).toContain("reservedInvoiceNumbers");
    expect(uploaderSource).toContain("duplicateNumberInDeduction");
    expect(uploaderSource).toContain("duplicateNumberInInvoice");
    expect(uploaderSource).toContain("formData.append('reimbursementId'");
    expect(invoiceSource).toContain("uploadFormData.append('reimbursementId'");
    expect(routeSource).toContain(
      "currentReimbursementId === existingReimbursementUsage.ownerId",
    );
    expect(detailSource).toContain(":reimbursement-id=");
  });

  it("旧独立核减接口不能修改已经进入审批或付款事实的报销单", () => {
    expect(routeSource).toContain("只有草稿或已驳回报销单可以新增核减发票");
    expect(routeSource).toContain("只有草稿或已驳回报销单可以删除核减发票");
  });
});
