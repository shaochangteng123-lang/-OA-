/** @jest-environment node */

import fs from "fs";
import path from "path";

import { createCanvas } from "canvas";
import { PDFDocument } from "pdf-lib";
import {
  renderInvoiceApplicationPdf,
  type InvoiceApplicationPdfData,
} from "../server/services/invoiceApplication.js";

jest.mock("nanoid", () => ({ nanoid: () => "test-generated-id" }));
jest.mock("../server/db/index", () => ({ db: {}, pool: {} }));

const signatureCanvas = createCanvas(240, 100);
const signatureContext = signatureCanvas.getContext("2d");
signatureContext.strokeStyle = "#123456";
signatureContext.lineWidth = 5;
signatureContext.beginPath();
signatureContext.moveTo(15, 70);
signatureContext.bezierCurveTo(60, 15, 150, 95, 225, 25);
signatureContext.stroke();
const signature = signatureCanvas.toBuffer("image/png");

function applicationData(): InvoiceApplicationPdfData {
  return {
    applicationNo: "KP-20260819-000001",
    contractNo: "HT-2026-001",
    contractTitle: "测试技术咨询服务合同",
    contractCategory: "main_business",
    contractArea: "海淀区",
    partyA: "测试甲方有限公司",
    contractAmount: 500_000,
    submittedAmounts: {
      currentEffectiveAmount: 500_000,
      invoicedAmount: 100_000,
      pendingAmount: 50_000,
      remainingAmount: 350_000,
    },
    amount: 80_000,
    invoiceContent: "技术咨询服务费",
    invoiceType: "增值税专用发票",
    description: "按合同约定申请开票。",
    materialMode: "material_need_seal",
    materialNames: ["开票三联单.xlsx"],
    sealedMaterialNames: ["开票三联单.xlsx"],
    billingInfo: {
      name: "测试甲方有限公司",
      taxNumber: "91110000123456789X",
      address: "北京市海淀区测试路1号",
      phone: "010-12345678",
      bankName: "中国工商银行北京测试支行",
      bankAccount: "0200000000000000000",
      remark: "无",
    },
    applicant: {
      id: "user-1",
      name: "申请员工",
      role: "user",
      department: "项目部",
      position: "项目专员",
    },
    applicantSignedAt: "2026-08-19T02:00:00.000Z",
    applicantSignature: signature,
    approver: {
      id: "gm-1",
      name: "审批总经理",
      role: "general_manager",
      department: "",
      position: "总经理",
    },
  };
}

describe("开票申请单 PDF", () => {
  test("员工提交生成固定 A4 单签申请单", async () => {
    const buffer = await renderInvoiceApplicationPdf(applicationData());
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBe(1);
    const size = pdf.getPage(0).getSize();
    expect(size.width).toBeCloseTo(595.28, 1);
    expect(size.height).toBeCloseTo(841.89, 1);
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/invoiceApplication.ts"),
      "utf8",
    );
    expect(source).toContain("不代表我公司对外付款");
  });

  test("总经理批准后生成同页双签申请单", async () => {
    const buffer = await renderInvoiceApplicationPdf({
      ...applicationData(),
      approverSignedAt: "2026-08-19T03:00:00.000Z",
      approverSignature: signature,
      decisionComment: "同意开票",
    });
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBe(1);
    expect(buffer.length).toBeGreaterThan(10_000);
  });

  test("最长说明、多材料和长审批意见仍保留在单页安全范围", async () => {
    const buffer = await renderInvoiceApplicationPdf({
      ...applicationData(),
      contractTitle: "超长项目名称".repeat(80),
      invoiceContent: "技术咨询及全过程服务".repeat(120),
      description: "本次申请包含需要特别说明的开票事项。".repeat(120),
      materialNames: Array.from(
        { length: 20 },
        (_, index) =>
          `第${index + 1}份甲方开票申请材料-${"附件名称".repeat(20)}.pdf`,
      ),
      sealedMaterialNames: Array.from(
        { length: 20 },
        (_, index) => `第${index + 1}份需盖章材料-${"附件名称".repeat(20)}.pdf`,
      ),
      billingInfo: {
        ...applicationData().billingInfo,
        address: "北京市海淀区超长地址".repeat(80),
        remark: "开票备注".repeat(200),
      },
      approverSignedAt: "2026-08-19T03:00:00.000Z",
      approverSignature: signature,
      decisionComment: "同意开票，请按合同及申请材料执行。".repeat(80),
    });
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBe(1);
    expect(buffer.length).toBeGreaterThan(10_000);
  });

  test("生成文件表保留历史版本且只允许一个当前版本", () => {
    const schema = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    expect(schema).toContain("version INTEGER NOT NULL DEFAULT 1");
    expect(schema).toContain("is_current BOOLEAN NOT NULL DEFAULT TRUE");
    expect(schema).toContain("idx_invoice_application_generated_current");
    expect(schema).toContain("WHERE is_current = TRUE");
  });
});
