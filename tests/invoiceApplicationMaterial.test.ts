/** @jest-environment node */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import * as XLSX from "xlsx";
import {
  exportOtherExpensesPrintableFileFromPath,
  exportOtherExpensesWorksheet,
  extractMainTriplicatePaymentAmount,
  inspectInvoiceApplicationMaterial,
  MAIN_TRIPLICATE_SHEET_NAME,
} from "../server/services/invoiceApplicationMaterial";

function workbookBuffer(
  sheetNames: string[],
  bookType: "xlsx" | "xls" = "xlsx",
): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheetName of sheetNames) {
    if (sheetName === MAIN_TRIPLICATE_SHEET_NAME) {
      XLSX.utils.book_append_sheet(workbook, triplicateWorksheet(), sheetName);
      continue;
    }
    const worksheet = XLSX.utils.aoa_to_sheet([
      [`${sheetName}标题`, "金额"],
      ["交通费", 20],
      ["住宿费", 30],
      ["合计", 50],
    ]);
    worksheet.B4 = { t: "n", f: "SUM(B2:B3)", v: 50 };
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }
  return XLSX.write(workbook, {
    type: "buffer",
    bookType,
    cellStyles: true,
  }) as Buffer;
}

function triplicateWorksheet(paymentAmount = 50): XLSX.WorkSheet {
  const rows = Array.from({ length: 33 }, () => Array(9).fill(""));
  rows[0][0] = "其 他 费 用 结 算 审 定 表";
  rows[1][0] = "工程项目名称：测试项目";
  rows[1][5] = "单位：元";
  rows[2][0] = "其他费用项目";
  rows[2][1] = "概算金额";
  rows[2][2] = "合同金额";
  rows[2][3] = "实际金额";
  rows[2][5] = "备 注";
  rows[3][3] = "本次付款";
  rows[3][4] = "累计付款";
  rows[4][0] = "技术咨询服务";
  rows[4][2] = paymentAmount;
  rows[4][3] = paymentAmount;
  rows[4][4] = paymentAmount;
  rows[28][0] = "合计";
  rows[28][3] = paymentAmount;
  rows[28][4] = paymentAmount;
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet.D29 = {
    t: "n",
    f: "SUM(D5:D28)",
    v: paymentAmount,
    z: "0.00",
  };
  worksheet.E29 = {
    t: "n",
    f: "SUM(E5:E28)",
    v: paymentAmount,
    z: "0.00",
  };
  worksheet["!merges"] = [
    XLSX.utils.decode_range("A1:F1"),
    XLSX.utils.decode_range("D3:E3"),
  ];
  return worksheet;
}

async function validPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([595, 842]);
  return Buffer.from(await document.save());
}

describe("开票申请三联单与甲方材料", () => {
  it("主营合同必须上传真实 Excel 且必须存在“其他费用”工作表", async () => {
    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "main",
        materialMode: "material_need_seal",
      }),
    ).rejects.toThrow("必须上传三联单 Excel 原件");

    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "main",
        materialMode: "material_need_seal",
        file: {
          originalName: "三联单.xlsx",
          buffer: workbookBuffer(["请款单", "报销单"]),
        },
      }),
    ).rejects.toThrow("缺少固定工作表“其他费用”");

    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "main",
        materialMode: "material_need_seal",
        file: { originalName: "三联单.pdf", buffer: await validPdf() },
      }),
    ).rejects.toThrow("主营三联单仅支持真实 XLS 或 XLSX");
  });

  it("主营预览只输出“其他费用”，不泄漏其他工作表内容", async () => {
    const source = workbookBuffer(["客户秘密", MAIN_TRIPLICATE_SHEET_NAME]);
    const result = await inspectInvoiceApplicationMaterial({
      contractCategory: "main",
      materialMode: "material_need_seal",
      file: { originalName: "三联单.xlsx", buffer: source },
    });

    expect(result.requiresAdminSealTask).toBe(true);
    expect(result.kind).toBe("xlsx");
    expect(result.worksheetNames).toEqual([
      "客户秘密",
      MAIN_TRIPLICATE_SHEET_NAME,
    ]);
    expect(result.preview?.sheetName).toBe(MAIN_TRIPLICATE_SHEET_NAME);
    expect(JSON.stringify(result.preview?.rows)).toContain(
      "其 他 费 用 结 算 审 定 表",
    );
    expect(JSON.stringify(result.preview?.rows)).not.toContain("客户秘密标题");
    expect(result.recognizedApplicationAmount).toBe(50);
    expect(result.recognizedAmountLabelCell).toBe("D4");
    expect(result.recognizedAmountValueCell).toBe("D29");
    expect(result.recognizedAmountDetailRange).toBe("D5:D28");
    expect(result.sha256).toBe(
      crypto.createHash("sha256").update(source).digest("hex"),
    );
  });

  it("兼容旧版 XLS 三联单并按固定工作表校验", async () => {
    const result = await inspectInvoiceApplicationMaterial({
      contractCategory: "main",
      materialMode: "material_need_seal",
      file: {
        originalName: "三联单.xls",
        buffer: workbookBuffer([MAIN_TRIPLICATE_SHEET_NAME], "xls"),
      },
    });
    expect(result.kind).toBe("xls");
    expect(result.preview?.rows[0][0]).toBe("其 他 费 用 结 算 审 定 表");
    expect(result.recognizedApplicationAmount).toBe(50);
  });

  it("按真实表格交叉位置提取本次付款并按分复核明细合计", () => {
    const worksheet = triplicateWorksheet(76_000);
    expect(extractMainTriplicatePaymentAmount(worksheet)).toEqual({
      amount: 76_000,
      labelCell: "D4",
      valueCell: "D29",
      detailRange: "D5:D28",
    });
  });

  it("合计公式必须有可核对缓存且缓存值必须与明细一致", () => {
    const withoutCache = triplicateWorksheet(100_000);
    withoutCache.D29 = { t: "n", f: "SUM(D5:D28)" };
    expect(() => extractMainTriplicatePaymentAmount(withoutCache)).toThrow(
      "D29的合计金额无效",
    );

    const mismatch = triplicateWorksheet(100_000);
    mismatch.D29 = { t: "n", f: "SUM(D5:D28)", v: 99_999 };
    expect(() => extractMainTriplicatePaymentAmount(mismatch)).toThrow(
      "明细与合计金额不一致",
    );
  });

  it("缺少元单位或明细精度超过两位时禁止自动填充", () => {
    const wrongUnit = triplicateWorksheet(50);
    wrongUnit.F2 = { t: "s", v: "单位：万元" };
    expect(() => extractMainTriplicatePaymentAmount(wrongUnit)).toThrow(
      "必须唯一明确使用“元”",
    );

    const conflictingUnit = triplicateWorksheet(50);
    conflictingUnit.F2 = { t: "s", v: "单位：万元" };
    conflictingUnit.G33 = { t: "s", v: "单位：元" };
    expect(() => extractMainTriplicatePaymentAmount(conflictingUnit)).toThrow(
      "必须唯一明确使用“元”",
    );

    const alternateUnitLabel = triplicateWorksheet(50);
    alternateUnitLabel.F2 = { t: "s", v: "金额单位：万元" };
    alternateUnitLabel.B1 = { t: "s", v: "单位：元" };
    expect(() =>
      extractMainTriplicatePaymentAmount(alternateUnitLabel),
    ).toThrow("必须唯一明确使用“元”");

    const zeroWidthUnit = triplicateWorksheet(50);
    zeroWidthUnit.F2 = { t: "s", v: "金​额单位：万元" };
    zeroWidthUnit.B1 = { t: "s", v: "单位：元" };
    expect(() => extractMainTriplicatePaymentAmount(zeroWidthUnit)).toThrow(
      "必须唯一明确使用“元”",
    );

    const invalidPrecision = triplicateWorksheet(50);
    invalidPrecision.D5 = { t: "n", v: 50.001 };
    expect(() => extractMainTriplicatePaymentAmount(invalidPrecision)).toThrow(
      "D5的本次付款明细不是有效金额",
    );
  });

  it("拒绝公式缓存伪造明细、合计或结构标签", () => {
    const formulaDetail = triplicateWorksheet(1);
    formulaDetail.D5 = { t: "n", f: "100000", v: 1 };
    expect(() => extractMainTriplicatePaymentAmount(formulaDetail)).toThrow(
      "本次付款明细不能使用公式",
    );

    const sharedFormulaDetail = triplicateWorksheet(1);
    sharedFormulaDetail.D5 = { t: "n", v: 1, F: "C5:D5" };
    expect(() =>
      extractMainTriplicatePaymentAmount(sharedFormulaDetail),
    ).toThrow("本次付款明细不能使用公式");

    const formulaTotal = triplicateWorksheet(1);
    formulaTotal.D29 = {
      t: "n",
      f: "SUM(D5:D28)*100000",
      v: 1,
    };
    expect(() => extractMainTriplicatePaymentAmount(formulaTotal)).toThrow(
      "合计公式不符合固定模板",
    );

    const formulaLabel = triplicateWorksheet(1);
    formulaLabel.D4 = { t: "s", f: '"其他字段"', v: "本次付款" };
    expect(() => extractMainTriplicatePaymentAmount(formulaLabel)).toThrow(
      "结构标签不能使用公式",
    );

    const formulaUnit = triplicateWorksheet(1);
    formulaUnit.F2 = {
      t: "s",
      f: '"金额单位：万元"',
      v: "金额单位：万元",
    };
    formulaUnit.B1 = { t: "s", v: "单位：元" };
    expect(() => extractMainTriplicatePaymentAmount(formulaUnit)).toThrow(
      "结构标签不能使用公式",
    );
  });

  it("错误单元格不能借错误码数值冒充付款金额", () => {
    const worksheet = triplicateWorksheet(7);
    worksheet.D5 = { t: "e", v: 7, w: "#DIV/0!" };
    worksheet.D29 = { t: "e", v: 7, w: "#DIV/0!" };
    expect(() => extractMainTriplicatePaymentAmount(worksheet)).toThrow(
      "D5的本次付款明细不是有效金额",
    );
  });

  it("显示格式不得把底层金额改写为另一打印金额", () => {
    const worksheet = triplicateWorksheet(1);
    worksheet.D5 = { t: "n", v: 1, z: '"100000"', w: "100000" };
    worksheet.D29 = {
      t: "n",
      f: "SUM(D5:D28)",
      v: 1,
      z: '"100000"',
      w: "100000",
    };
    expect(() => extractMainTriplicatePaymentAmount(worksheet)).toThrow(
      "D5的本次付款明细不是有效金额",
    );

    const hiddenDisplay = triplicateWorksheet(100_000);
    hiddenDisplay.D5 = { t: "n", v: 100_000, z: ";;;", w: "" };
    hiddenDisplay.D29 = {
      t: "n",
      f: "SUM(D5:D28)",
      v: 100_000,
      z: ";;;",
      w: "",
    };
    expect(() => extractMainTriplicatePaymentAmount(hiddenDisplay)).toThrow(
      "D5的本次付款明细不是有效金额",
    );
  });

  it("付款列明细或合计不得使用合并单元格隐藏另一数值", () => {
    const worksheet = triplicateWorksheet(1);
    worksheet.C5 = { t: "n", v: 100_000 };
    worksheet.C29 = { t: "n", v: 100_000 };
    worksheet["!merges"] = [
      ...(worksheet["!merges"] || []),
      XLSX.utils.decode_range("C5:D5"),
      XLSX.utils.decode_range("C29:D29"),
    ];
    expect(() => extractMainTriplicatePaymentAmount(worksheet)).toThrow(
      "本次付款明细不能位于合并单元格",
    );
  });

  it("付款列、表头、合计和金额单位必须在打印工作表中可见", () => {
    const hiddenColumn = triplicateWorksheet(50);
    hiddenColumn["!cols"] = Array.from({ length: 4 }, () => ({}));
    hiddenColumn["!cols"][3] = { hidden: true };
    expect(() => extractMainTriplicatePaymentAmount(hiddenColumn)).toThrow(
      "必须可见",
    );

    const hiddenTotal = triplicateWorksheet(50);
    hiddenTotal["!rows"] = Array.from({ length: 29 }, () => ({}));
    hiddenTotal["!rows"][28] = { hidden: true };
    expect(() => extractMainTriplicatePaymentAmount(hiddenTotal)).toThrow(
      "必须可见",
    );
  });

  it("导出单工作表 XLSX 时不修改原件，且目标值与公式保留", async () => {
    const source = workbookBuffer(["说明", MAIN_TRIPLICATE_SHEET_NAME]);
    const before = Buffer.from(source);
    const beforeHash = crypto.createHash("sha256").update(source).digest("hex");
    const exported = await exportOtherExpensesWorksheet(
      source,
      "开票三联单.xlsx",
    );
    const outputWorkbook = XLSX.read(exported.buffer, {
      type: "buffer",
      cellFormula: true,
    });

    expect(source.equals(before)).toBe(true);
    expect(crypto.createHash("sha256").update(source).digest("hex")).toBe(
      beforeHash,
    );
    expect(exported.sourceSha256).toBe(beforeHash);
    expect(outputWorkbook.SheetNames).toEqual([MAIN_TRIPLICATE_SHEET_NAME]);
    expect(outputWorkbook.Sheets[MAIN_TRIPLICATE_SHEET_NAME].A1.v).toBe(
      "其 他 费 用 结 算 审 定 表",
    );
    expect(outputWorkbook.Sheets[MAIN_TRIPLICATE_SHEET_NAME].D29.f).toBe(
      "SUM(D5:D28)",
    );
  });

  it("管理员下载优先返回只打印目标工作表的 PDF 且原路径文件不变", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "invoice-material-test-"),
    );
    const sourcePath = path.join(directory, "三联单.xlsx");
    const source = workbookBuffer([
      "第一联",
      MAIN_TRIPLICATE_SHEET_NAME,
      "第三联",
    ]);
    fs.writeFileSync(sourcePath, source);
    const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
    let receivedWorkbook: XLSX.WorkBook | null = null;
    try {
      const result = await exportOtherExpensesPrintableFileFromPath(
        sourcePath,
        "三联单.xlsx",
        {
          pdfConverter: async (derivedWorkbook) => {
            receivedWorkbook = XLSX.read(derivedWorkbook, { type: "buffer" });
            return validPdf();
          },
        },
      );
      expect(result.format).toBe("pdf");
      expect(result.mimeType).toBe("application/pdf");
      expect(result.usedCompatibilityFallback).toBe(false);
      expect(result.sourceSha256).toBe(sourceHash);
      expect(fs.readFileSync(sourcePath).equals(source)).toBe(true);

      const workbook = receivedWorkbook as unknown as XLSX.WorkBook;
      expect(workbook.SheetNames).toEqual([MAIN_TRIPLICATE_SHEET_NAME]);
      expect(workbook.Sheets[MAIN_TRIPLICATE_SHEET_NAME].D29.f).toBe(
        "SUM(D5:D28)",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("PDF 转换不可用时安全回退为仅含“其他费用”的 XLSX", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "invoice-material-test-"),
    );
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    const sourcePath = path.join(directory, "三联单.xlsx");
    fs.writeFileSync(
      sourcePath,
      workbookBuffer(["其他工作表", MAIN_TRIPLICATE_SHEET_NAME]),
    );
    try {
      const result = await exportOtherExpensesPrintableFileFromPath(
        sourcePath,
        "三联单.xlsx",
        {
          pdfConverter: async () => {
            throw new Error("模拟无 LibreOffice");
          },
        },
      );
      const workbook = XLSX.read(result.buffer, { type: "buffer" });
      expect(result.format).toBe("xlsx");
      expect(result.usedCompatibilityFallback).toBe(true);
      expect(workbook.SheetNames).toEqual([MAIN_TRIPLICATE_SHEET_NAME]);
    } finally {
      warning.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("非主营支持有材料盖章、有材料不盖章和无材料三种流程", async () => {
    const noMaterial = await inspectInvoiceApplicationMaterial({
      contractCategory: "non_main",
      materialMode: "no_material",
    });
    expect(noMaterial.hasMaterial).toBe(false);
    expect(noMaterial.requiresAdminSealTask).toBe(false);

    const pdf = await validPdf();
    const needsSeal = await inspectInvoiceApplicationMaterial({
      contractCategory: "non_main",
      materialMode: "material_need_seal",
      file: { originalName: "甲方材料.pdf", buffer: pdf },
    });
    expect(needsSeal.requiresAdminSealTask).toBe(true);
    expect(needsSeal.kind).toBe("pdf");

    const image = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer();
    const noSeal = await inspectInvoiceApplicationMaterial({
      contractCategory: "non_main",
      materialMode: "material_no_seal",
      file: { originalName: "甲方材料.png", buffer: image },
    });
    expect(noSeal.requiresAdminSealTask).toBe(false);
    expect(noSeal.kind).toBe("png");

    const arbitraryExcel = await inspectInvoiceApplicationMaterial({
      contractCategory: "non_main",
      materialMode: "material_no_seal",
      file: {
        originalName: "甲方自定义表格.xlsx",
        buffer: workbookBuffer(["甲方自定义工作表"]),
      },
    });
    expect(arbitraryExcel.kind).toBe("xlsx");
    expect(arbitraryExcel.worksheetNames).toEqual(["甲方自定义工作表"]);
    expect(arbitraryExcel.preview).toBeNull();
  });

  it("非主营材料选项与文件必须一致，仅需盖章才产生管理员待办", async () => {
    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "non_main",
        materialMode: "material_need_seal",
      }),
    ).rejects.toThrow("请先上传材料");
    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "non_main",
        materialMode: "no_material",
        file: { originalName: "材料.pdf", buffer: await validPdf() },
      }),
    ).rejects.toThrow("不应同时上传文件");
  });

  it("按真实文件头和容器结构校验，拒绝伪造扩展名与截断文件", async () => {
    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "non_main",
        materialMode: "material_no_seal",
        file: { originalName: "材料.jpg", buffer: await validPdf() },
      }),
    ).rejects.toThrow("扩展名与真实文件格式不一致");

    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "main",
        materialMode: "material_need_seal",
        file: {
          originalName: "三联单.xlsx",
          buffer: Buffer.from("504b0304", "hex"),
        },
      }),
    ).rejects.toThrow("XLSX 文档容器已损坏");

    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "non_main",
        materialMode: "material_no_seal",
        file: {
          originalName: "材料.png",
          buffer: Buffer.from("89504e470d0a1a0a", "hex"),
        },
      }),
    ).rejects.toThrow("图片材料损坏");
  });

  it("拒绝会在打印转换时引入主动内容的 Excel 容器", async () => {
    const archive = await JSZip.loadAsync(
      workbookBuffer([MAIN_TRIPLICATE_SHEET_NAME]),
    );
    archive.file("xl/externalLinks/externalLink1.xml", "<externalLink />");
    const unsafe = await archive.generateAsync({ type: "nodebuffer" });

    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "main",
        materialMode: "material_need_seal",
        file: { originalName: "三联单.xlsx", buffer: unsafe },
      }),
    ).rejects.toThrow("不得包含宏、外部链接");

    const formulaWorkbook = XLSX.utils.book_new();
    const formulaSheet = XLSX.utils.aoa_to_sheet([["待校验"]]);
    formulaSheet.A2 = {
      t: "s",
      f: 'WEBSERVICE("https://example.invalid")',
      v: "",
    };
    formulaSheet["!ref"] = "A1:A2";
    XLSX.utils.book_append_sheet(
      formulaWorkbook,
      formulaSheet,
      MAIN_TRIPLICATE_SHEET_NAME,
    );
    const activeFormula = XLSX.write(formulaWorkbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;
    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "main",
        materialMode: "material_need_seal",
        file: { originalName: "三联单.xlsx", buffer: activeFormula },
      }),
    ).rejects.toThrow("不得包含外部调用公式");
  });

  it("历史模板内嵌对象只保留原件，不进入其他费用安全派生文件", async () => {
    const archive = await JSZip.loadAsync(
      workbookBuffer([MAIN_TRIPLICATE_SHEET_NAME]),
    );
    archive.file("xl/embeddings/oleObject1.bin", Buffer.from("legacy-object"));
    const source = await archive.generateAsync({ type: "nodebuffer" });

    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "main",
        materialMode: "material_need_seal",
        file: { originalName: "三联单.xlsx", buffer: source },
      }),
    ).resolves.toMatchObject({ recognizedApplicationAmount: 50 });

    const derived = await exportOtherExpensesWorksheet(source, "三联单.xlsx");
    const derivedArchive = await JSZip.loadAsync(derived.buffer);
    expect(derivedArchive.file("xl/embeddings/oleObject1.bin")).toBeNull();
  });

  it("资产合同在材料服务层同样禁止发起开票申请", async () => {
    await expect(
      inspectInvoiceApplicationMaterial({
        contractCategory: "asset",
        materialMode: "no_material",
      }),
    ).rejects.toThrow("资产类合同不允许发起开票申请");
  });
});
