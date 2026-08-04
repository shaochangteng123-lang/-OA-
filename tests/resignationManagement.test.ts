/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import type { PoolClient } from "pg";
import { PDFDocument } from "pdf-lib";
import {
  Document as WordDocument,
  Packer,
  Paragraph,
  Table as WordTable,
  TableCell,
  TableRow,
  TextRun,
} from "docx";

jest.mock("nanoid", () => ({
  nanoid: () => "test-id",
}));

import {
  classifyResignationDocumentTitle,
  classifyResignationDocumentText,
} from "../server/services/resignationDocumentClassifier";
import { groupResignationBundlePages } from "../server/services/resignationDocumentBundle";
import {
  RESIGNATION_ARCHIVE_TYPES,
  finalizeResignationArchiveWithClient,
  getMissingResignationArchiveTypes,
  refreshResignationArchiveCompletionWithClient,
} from "../server/services/resignationArchive";
import {
  fillResignationTemplatePlaceholders,
  loadResignationTemplateHtml,
  renderResignationTemplateDocx,
  sanitizeResignationTemplateHtml,
} from "../server/services/resignationTemplateEditor";
import {
  DOCX_MIME_TYPE,
  PDF_MIME_TYPE,
  detectResignationTemplateFileKind,
  getResignationTemplateFileKind,
  isResignationTemplatePdfUpload,
} from "../server/services/resignationTemplateFile";
import {
  alignResignationTemplateFieldsToTextWords,
  buildResignationBlankUnderlineFields,
  buildResignationDocumentNumber,
  buildDocumentNumberBoxes,
  buildResignationFieldAlignments,
  buildResignationTemplateEditorState,
  calculateResignationTextInkLayout,
  calculateResignationTenure,
  extractResignationEmployeeNumberDigits,
  loadResignationTemplatePdfBuffer,
  normalizeResignationOverlayDraft,
  removeTrailingEmptyDocxParagraphs,
} from "../server/services/resignationTemplatePdf";
import { calculateResignationFieldTextFit } from "../src/utils/resignationTemplateText";

const resignationTemplateContext = {
  employeeName: "曹鸿浩",
  employeeNo: "YULI-CS026",
  idNumber: "110101199001011234",
  department: "项目部",
  position: "投批报建专员",
  hireDate: "2025-06-16",
  firstContractStartDate: "2025-06-16",
  resignDate: "2026-07-24",
};

function pdfTextWord(
  text: string,
  xMin: number,
  xMax: number,
  yMin: number,
  page = 1,
) {
  return {
    page,
    xMin,
    yMin,
    xMax,
    yMax: yMin + 15.95,
    text,
    fontSize: 15.95,
    fontFamily: "monospace",
    color: "#000000",
  };
}

describe("离职模板自动填写", () => {
  it("较长文字优先等比例缩小并完整落在原填写区域内", () => {
    const fit = calculateResignationFieldTextFit(120, 80, 2.5, 16);

    expect(fit.transformOrigin).toBe("left center");
    expect(fit.fontScale).toBeCloseTo(0.6, 6);
    expect(fit.horizontalScale).toBe(1);
    expect(fit.widthPercent).toBe(100);
    expect(120 * fit.fontScale).toBeCloseTo(72, 6);
  });

  it("达到最低字号后仅对超长文字做剩余横向适配", () => {
    const fit = calculateResignationFieldTextFit(300, 80, 2.5, 16);

    expect(fit.fontScale).toBeCloseTo(7 / 16, 6);
    expect(fit.horizontalScale).toBeCloseTo(72 / (300 * (7 / 16)), 6);
  });

  it("字段两侧保留笔画安全区，避免身份证号末位被括号或边界覆盖", () => {
    const fit = calculateResignationFieldTextFit(154, 150.25, 2.5, 16);
    const displayedWidth = 154 * fit.fontScale * fit.horizontalScale;

    expect(displayedWidth).toBeLessThanOrEqual(142.25);
  });

  it("文字真实边界超出理论宽度时保留右侧完整笔画", () => {
    expect(calculateResignationTextInkLayout(100, 1.2, 101.5)).toEqual({
      inkLeft: 1.2,
      width: 102.7,
    });
    expect(
      calculateResignationTextInkLayout(100, Number.NaN, Number.NaN),
    ).toEqual({
      inkLeft: 0,
      width: 100,
    });
  });

  it("从员工编号末段提取数字并生成对应模板编号", () => {
    expect(extractResignationEmployeeNumberDigits("YULI-CS026")).toBe("026");
    expect(extractResignationEmployeeNumberDigits("临时员工-7")).toBe("007");
    expect(
      [
        "termination_agreement",
        "employee_handover_form",
        "settlement_confirmation",
        "compensation_agreement",
        "resignation_certificate",
      ].map((templateType) =>
        buildResignationDocumentNumber(
          templateType as Parameters<typeof buildResignationDocumentNumber>[0],
          "YULI-CS026",
        ),
      ),
    ).toEqual([
      "编号： YULI-CS026-LZ1",
      "编号： YULI-CS026-LZ2",
      "编号： YULI-CS026-LZ3",
      "编号： YULI-CS026-LZ4",
      "编号： YULI-CS026-LZ5",
    ]);
  });

  it("转换前只清理文档末尾的空段落，不改动已有正文", () => {
    const xml = [
      "<w:document><w:body>",
      "<w:p><w:r><w:t>正文</w:t></w:r></w:p>",
      '<w:p><w:pPr><w:spacing w:line="480"/></w:pPr></w:p>',
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
      "</w:body></w:document>",
    ].join("");

    expect(removeTrailingEmptyDocxParagraphs(xml)).toBe(
      [
        "<w:document><w:body>",
        "<w:p><w:r><w:t>正文</w:t></w:r></w:p>",
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
        "</w:body></w:document>",
      ].join(""),
    );
  });

  it("按完整自然月计算任职年限，不把未满整月的尾数多算一个月", () => {
    expect(calculateResignationTenure("2025-06-16", "2026-07-24")).toEqual({
      years: 1,
      months: 1,
    });
    expect(calculateResignationTenure("2025-06-30", "2026-06-29")).toEqual({
      years: 0,
      months: 11,
    });
    expect(calculateResignationTenure("2026-07-25", "2026-07-24")).toBeNull();
  });

  it("终止协议自动填充姓名、身份证、首次合同月份及离职日期", () => {
    const state = buildResignationTemplateEditorState(
      "termination_agreement",
      resignationTemplateContext,
    );
    const values = Object.fromEntries(
      state.fields.map((item) => [item.key, item.value]),
    );

    expect(state.documentNumber).toBe("编号： YULI-CS026-LZ1");
    expect(values).toEqual(
      expect.objectContaining({
        employeeName: "曹鸿浩",
        idNumber: "110101199001011234",
        contractYear: "2025",
        contractMonth: "6",
        contractDay: "16",
        resignYear: "2026",
        resignMonth: "7",
        resignDay: "24",
      }),
    );
  });

  it("编号覆盖每页完整编号范围，并保留相邻的编号二字", () => {
    const boxes = buildDocumentNumberBoxes([
      {
        page: 1,
        xMin: 451.8,
        yMin: 68.57,
        xMax: 473.64,
        yMax: 77.57,
        text: "YULI-",
        fontSize: 9,
      },
      {
        page: 1,
        xMin: 473.76,
        yMin: 68.57,
        xMax: 484.76,
        yMax: 77.57,
        text: "CS",
        fontSize: 9,
      },
      {
        page: 1,
        xMin: 484.8,
        yMin: 68.57,
        xMax: 500.16,
        yMax: 77.57,
        text: "XXX",
        fontSize: 9,
      },
      {
        page: 1,
        xMin: 500.28,
        yMin: 68.57,
        xMax: 513.63,
        yMax: 77.57,
        text: "-LZ",
        fontSize: 9,
      },
      {
        page: 1,
        xMin: 513.72,
        yMin: 68.57,
        xMax: 518.72,
        yMax: 77.57,
        text: "2",
        fontSize: 9,
      },
    ]);

    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toEqual(
      expect.objectContaining({
        page: 1,
        x: 451.8,
        top: 68.57,
      }),
    );
    expect(boxes[0].width).toBeCloseTo(66.92, 2);
    expect(boxes[0].height).toBeCloseTo(9, 2);
  });

  it("离职证明按拆分后的整行文字锁定姓名、日期和岗位空白区", () => {
    const source = buildResignationTemplateEditorState(
      "resignation_certificate",
      resignationTemplateContext,
    );
    const words = [
      pdfTextWord("兹有", 108.6, 140.51, 161.21),
      pdfTextWord("我司", 140.52, 172.43, 161.21),
      pdfTextWord("员工", 172.56, 204.47, 161.21),
      pdfTextWord("（", 253.68, 269.63, 161.21),
      pdfTextWord("身份证号", 269.64, 333.59, 161.21),
      pdfTextWord("：", 333.6, 349.55, 161.21),
      pdfTextWord("），", 502.8, 526.75, 161.21),
      pdfTextWord("于", 76.56, 92.51, 185.21),
      pdfTextWord("年", 132.6, 148.55, 185.21),
      pdfTextWord("月", 172.56, 188.51, 185.21),
      pdfTextWord("日", 212.52, 228.47, 185.21),
      pdfTextWord("正式入职我司，任职", 228.6, 372.59, 185.21),
      pdfTextWord("岗位。", 460.56, 508.48, 185.21),
      pdfTextWord("双方劳动关系", 108.6, 204.59, 209.21),
      pdfTextWord("已", 204.6, 220.55, 209.21),
      pdfTextWord("于", 220.56, 236.51, 209.21),
      pdfTextWord("年", 276.6, 292.55, 209.21),
      pdfTextWord("月", 316.56, 332.51, 209.21),
      pdfTextWord("日", 356.52, 372.47, 209.21),
      pdfTextWord("正式解除。", 372.6, 436.52, 209.21),
    ];

    const fields = alignResignationTemplateFieldsToTextWords(
      words,
      "resignation_certificate",
      source.fields,
    );
    const byKey = new Map(fields.map((item) => [item.key, item]));

    expect(byKey.get("employeeName")?.x).toBeCloseTo(205.97, 2);
    expect(byKey.get("employeeName")?.width).toBeCloseTo(46.21, 2);
    expect(byKey.get("idNumber")?.x).toBeCloseTo(351.05, 2);
    expect(byKey.get("idNumber")?.width).toBeCloseTo(150.25, 2);
    expect(byKey.get("idNumber")?.align).toBe("center");
    expect(byKey.get("hireYear")?.x).toBeCloseTo(94.01, 2);
    expect(byKey.get("hireYear")?.width).toBeCloseTo(37.09, 2);
    expect(byKey.get("position")?.x).toBeCloseTo(374.09, 2);
    expect(byKey.get("position")?.width).toBeCloseTo(84.97, 2);
    expect(byKey.get("resignYear")?.x).toBeCloseTo(238.01, 2);
    expect(byKey.get("resignYear")?.width).toBeCloseTo(37.09, 2);
    expect(byKey.get("employeeName")?.fontSize).toBeCloseTo(15.95, 2);
    expect(byKey.get("position")?.fontSize).toBeCloseTo(15.95, 2);
  });

  it("补偿协议能识别拆分为多个文字块的任职日期行", () => {
    const source = buildResignationTemplateEditorState(
      "compensation_agreement",
      resignationTemplateContext,
    );
    const words = [
      pdfTextWord("该", 108.6, 124.55, 236.93),
      pdfTextWord("员工自", 124.56, 172.55, 236.93),
      pdfTextWord("年", 212.52, 228.47, 236.93),
      pdfTextWord("月", 252.6, 268.55, 236.93),
      pdfTextWord("日至", 292.56, 324.47, 236.93),
      pdfTextWord("年", 364.56, 380.51, 236.93),
      pdfTextWord("月", 404.52, 420.47, 236.93),
      pdfTextWord("日在本公司", 444.6, 524.51, 236.93),
    ];

    const fields = alignResignationTemplateFieldsToTextWords(
      words,
      "compensation_agreement",
      source.fields,
    );
    const byKey = new Map(fields.map((item) => [item.key, item]));

    expect(byKey.get("startYear")?.x).toBeCloseTo(174.05, 2);
    expect(byKey.get("startMonth")?.x).toBeCloseTo(229.97, 2);
    expect(byKey.get("startDay")?.x).toBeCloseTo(270.05, 2);
    expect(byKey.get("endYear")?.x).toBeCloseTo(325.97, 2);
    expect(byKey.get("endMonth")?.x).toBeCloseTo(382.01, 2);
    expect(byKey.get("endDay")?.x).toBeCloseTo(421.97, 2);
  });

  it("自动填充内容保留各模板字段字号并提供足够的点击高度", () => {
    const templateTypes = [
      "termination_agreement",
      "employee_handover_form",
      "settlement_confirmation",
      "compensation_agreement",
      "resignation_certificate",
    ] as const;

    for (const templateType of templateTypes) {
      const state = buildResignationTemplateEditorState(
        templateType,
        resignationTemplateContext,
      );
      expect(state.fields.length).toBeGreaterThan(0);
      expect(
        state.fields.every((item) => item.fontSize >= 7 && item.fontSize <= 36),
      ).toBe(true);
      expect(state.fields.every((item) => item.height >= 25)).toBe(true);
    }

    const handover = buildResignationTemplateEditorState(
      "employee_handover_form",
      resignationTemplateContext,
    );
    expect(
      handover.fields.find((item) => item.key === "department")?.fontSize,
    ).toBe(10.5);
    expect(
      handover.fields.find((item) => item.key === "terminationDate")?.fontSize,
    ).toBe(9.5);
  });

  it("为全部空白及原有文字下划线生成可保存的输入字段", () => {
    const words = [
      pdfTextWord("自动字段", 60, 95, 100),
      pdfTextWord("固定内容", 120, 200, 195),
      pdfTextWord("签字", 160, 190, 299),
    ];
    const sourceFields = [
      {
        key: "existingField",
        label: "已有自动字段",
        page: 1,
        x: 100,
        top: 98,
        width: 80,
        height: 25,
        fontSize: 15.95,
        align: "center" as const,
        value: "已填写",
      },
    ];
    const fields = buildResignationBlankUnderlineFields(
      [
        { page: 1, x: 100, top: 121, width: 80, strokeWidth: 0.72 },
        { page: 1, x: 120, top: 216, width: 120, strokeWidth: 0.72 },
        { page: 1, x: 200, top: 320, width: 100, strokeWidth: 0.72 },
      ],
      words,
      sourceFields,
      {
        underline_p1_x2000_y3200_w1000: "管理员填写",
      },
    );

    expect(fields).toHaveLength(2);
    expect(fields[0]).toEqual(
      expect.objectContaining({
        key: "underline_p1_x1200_y2160_w1200",
        page: 1,
        x: 120,
        top: 193,
        width: 120,
        height: 25,
        fontSize: 15.95,
        align: "left",
        paddingX: 0,
        replaceSourceText: true,
        sourceText: "固定内容",
        value: "固定内容",
      }),
    );
    expect(fields[1]).toEqual(
      expect.objectContaining({
        key: "underline_p1_x2000_y3200_w1000",
        page: 1,
        x: 200,
        top: 297,
        width: 100,
        height: 25,
        fontSize: 15.95,
        value: "管理员填写",
      }),
    );
  });

  it("相邻下一行的输入框不会误判为已覆盖上一行下划线", () => {
    const fields = buildResignationBlankUnderlineFields(
      [{ page: 1, x: 100, top: 200, width: 100, strokeWidth: 0.72 }],
      [],
      [
        {
          key: "nextLineField",
          label: "下一行字段",
          page: 1,
          x: 100,
          top: 201,
          width: 100,
          height: 25,
          fontSize: 15.95,
          align: "center",
          value: "",
        },
      ],
    );

    expect(fields).toHaveLength(1);
    expect(fields[0]?.key).toBe("underline_p1_x1000_y2000_w1000");
  });

  it("交接单在正文和三个附件页分别填充员工姓名", () => {
    const state = buildResignationTemplateEditorState(
      "employee_handover_form",
      resignationTemplateContext,
    );
    const employeeNameFields = state.fields.filter((item) =>
      item.key.toLowerCase().includes("employeename"),
    );

    expect(employeeNameFields.map((item) => item.page)).toEqual([1, 3, 4, 5]);
    expect(employeeNameFields.every((item) => item.value === "曹鸿浩")).toBe(
      true,
    );
    expect(
      state.fields.find((item) => item.key === "terminationDate")?.value,
    ).toBe("2026年7月24日");
  });

  it("经济补偿协议自动填充任职起止日期及年限", () => {
    const state = buildResignationTemplateEditorState(
      "compensation_agreement",
      resignationTemplateContext,
    );
    const values = Object.fromEntries(
      state.fields.map((item) => [item.key, item.value]),
    );

    expect(values).toEqual(
      expect.objectContaining({
        startYear: "2025",
        startMonth: "6",
        startDay: "16",
        endYear: "2026",
        endMonth: "7",
        endDay: "24",
        tenureYears: "1",
        tenureMonths: "1",
      }),
    );
  });

  it("薪资结算确认书自动填充员工姓名和身份证号", () => {
    const state = buildResignationTemplateEditorState(
      "settlement_confirmation",
      resignationTemplateContext,
    );
    const values = Object.fromEntries(
      state.fields.map((item) => [item.key, item.value]),
    );

    expect(state.documentNumber).toBe("编号： YULI-CS026-LZ3");
    expect(values).toEqual(
      expect.objectContaining({
        employeeName: "曹鸿浩",
        idNumber: "110101199001011234",
      }),
    );
  });

  it("离职证明自动填充入职日期、职位和解除日期", () => {
    const state = buildResignationTemplateEditorState(
      "resignation_certificate",
      resignationTemplateContext,
    );
    const values = Object.fromEntries(
      state.fields.map((item) => [item.key, item.value]),
    );

    expect(state.documentNumber).toBe("编号： YULI-CS026-LZ5");
    expect(values).toEqual(
      expect.objectContaining({
        employeeName: "曹鸿浩",
        idNumber: "110101199001011234",
        hireYear: "2025",
        hireMonth: "6",
        hireDay: "16",
        position: "投批报建专员",
        resignYear: "2026",
        resignMonth: "7",
        resignDay: "24",
      }),
    );
  });

  it("自定义填写项会限制在页面范围并保留合法字号", () => {
    const draft = normalizeResignationOverlayDraft({
      version: 1,
      fieldOverrides: { employeeName: "测试姓名" },
      customItems: [
        {
          id: "custom-1",
          page: 0,
          x: -20,
          top: 900,
          width: 0,
          height: 0,
          fontSize: 99,
          align: "center",
          color: "#000000",
          value: "补充文字",
        },
      ],
    });

    expect(draft.fieldOverrides.employeeName).toBe("测试姓名");
    expect(draft.fieldAlignments).toEqual({});
    expect(draft.customItems[0]).toEqual(
      expect.objectContaining({
        page: 1,
        x: 0,
        width: 18,
        height: 14,
        fontSize: 36,
      }),
    );
  });

  it("模板下划线字段可保存并恢复左中右文字方向", () => {
    const defaultState = buildResignationTemplateEditorState(
      "termination_agreement",
      resignationTemplateContext,
    );
    const fieldAlignments = buildResignationFieldAlignments(
      defaultState.fields,
      {
        employeeName: "left",
        idNumber: "right",
      },
    );
    const draft = normalizeResignationOverlayDraft({
      version: 1,
      fieldOverrides: {},
      fieldAlignments,
      customItems: [],
    });
    const restoredState = buildResignationTemplateEditorState(
      "termination_agreement",
      resignationTemplateContext,
      {},
      draft.fieldAlignments,
    );
    const alignments = Object.fromEntries(
      restoredState.fields.map((item) => [item.key, item.align]),
    );

    expect(draft.fieldAlignments).toEqual({
      employeeName: "left",
      idNumber: "right",
    });
    expect(alignments).toEqual(
      expect.objectContaining({
        employeeName: "left",
        idNumber: "right",
        contractYear: "center",
      }),
    );
    expect(() =>
      buildResignationFieldAlignments(defaultState.fields, {
        employeeName: "vertical",
      }),
    ).toThrow("模板字段文字方向不正确");
  });
});

describe("离职模板文件格式", () => {
  it("新上传只接受扩展名、媒体类型和文件头均正确的 PDF", () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "resignation-template-format-test-"),
    );
    const docxPath = path.join(temporaryDirectory, "template.docx");
    const pdfPath = path.join(temporaryDirectory, "template.pdf");
    const disguisedPdfPath = path.join(temporaryDirectory, "disguised.pdf");

    try {
      fs.writeFileSync(docxPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      fs.writeFileSync(pdfPath, Buffer.from("%PDF-1.7\n", "ascii"));
      fs.writeFileSync(disguisedPdfPath, Buffer.from("not-a-pdf", "ascii"));

      expect(
        isResignationTemplatePdfUpload(pdfPath, "模板.pdf", PDF_MIME_TYPE),
      ).toBe(true);
      expect(
        isResignationTemplatePdfUpload(docxPath, "模板.docx", DOCX_MIME_TYPE),
      ).toBe(false);
      expect(
        isResignationTemplatePdfUpload(pdfPath, "模板.docx", PDF_MIME_TYPE),
      ).toBe(false);
      expect(
        isResignationTemplatePdfUpload(
          disguisedPdfPath,
          "模板.pdf",
          PDF_MIME_TYPE,
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("历史模板仍能识别 DOCX 和 PDF，并拒绝伪装扩展名", () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "resignation-template-legacy-format-test-"),
    );
    const docxPath = path.join(temporaryDirectory, "template.docx");
    const pdfPath = path.join(temporaryDirectory, "template.pdf");
    const disguisedPdfPath = path.join(temporaryDirectory, "disguised.pdf");

    try {
      fs.writeFileSync(docxPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      fs.writeFileSync(pdfPath, Buffer.from("%PDF-1.7\n", "ascii"));
      fs.writeFileSync(disguisedPdfPath, Buffer.from("not-a-pdf", "ascii"));

      expect(detectResignationTemplateFileKind(docxPath, "模板.docx")).toBe(
        "docx",
      );
      expect(detectResignationTemplateFileKind(pdfPath, "模板.pdf")).toBe(
        "pdf",
      );
      expect(
        detectResignationTemplateFileKind(disguisedPdfPath, "模板.pdf"),
      ).toBeNull();
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("根据文件名或媒体类型识别已存储的 PDF 模板", () => {
    expect(
      getResignationTemplateFileKind({
        file_name: "离职证明.pdf",
        mime_type: null,
      }),
    ).toBe("pdf");
    expect(
      getResignationTemplateFileKind({
        file_name: "离职证明",
        mime_type: PDF_MIME_TYPE,
      }),
    ).toBe("pdf");
    expect(
      getResignationTemplateFileKind({
        file_name: "离职证明.docx",
        mime_type: null,
      }),
    ).toBe("docx");
  });

  it("PDF 和 DOCX 原模板都能转换为在线预览文件", async () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "resignation-template-preview-test-"),
    );
    const pdfPath = path.join(temporaryDirectory, "template.pdf");
    const docxPath = path.join(temporaryDirectory, "template.docx");

    try {
      const pdfDocument = await PDFDocument.create();
      pdfDocument.addPage();
      fs.writeFileSync(pdfPath, await pdfDocument.save());

      const wordDocument = new WordDocument({
        sections: [
          {
            children: [
              new Paragraph({ children: [new TextRun("离职模板预览")] }),
            ],
          },
        ],
      });
      fs.writeFileSync(docxPath, await Packer.toBuffer(wordDocument));

      const pdfPreview = await loadResignationTemplatePdfBuffer(pdfPath);
      const docxPreview = await loadResignationTemplatePdfBuffer(docxPath);

      expect((await PDFDocument.load(pdfPreview)).getPageCount()).toBe(1);
      expect(
        (await PDFDocument.load(docxPreview)).getPageCount(),
      ).toBeGreaterThan(0);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe("离职档案自动识别", () => {
  it.each([
    ["终止 / 解除劳动关系协议书\n甲方与乙方协商一致", "termination_agreement"],
    ["员工离职交接单\n工作交接\n财务交接", "employee_handover_form"],
    ["薪资及各类款项结算确认书\n实发工资", "settlement_confirmation"],
    ["离职经济补偿协议书\n经济补偿金", "compensation_agreement"],
    ["离职证明\n曾在我公司工作\n特此证明", "resignation_certificate"],
  ])("识别五类离职材料", (text, expectedType) => {
    expect(classifyResignationDocumentText(text)?.documentType).toBe(
      expectedType,
    );
  });

  it("兼容首页标题中的全角分隔符、前置填充文字和少量识别误差", () => {
    const filledValues = Array.from(
      { length: 30 },
      (_, index) => `自动填充值${index + 1}`,
    ).join("\n");

    expect(
      classifyResignationDocumentTitle(
        `${filledValues}\n终止 ／ 解除劳动关系协议书\n甲方与乙方协商一致`,
      )?.documentType,
    ).toBe("termination_agreement");
    expect(
      classifyResignationDocumentTitle("薪资及各类款项结算确以书")
        ?.documentType,
    ).toBe("settlement_confirmation");
    expect(
      classifyResignationDocumentTitle("请到人事部门领取离职证明"),
    ).toBeNull();
  });

  it.each([
    [
      "标题区域模糊\n甲乙双方于某年签订劳动合同，双方就解除/终止劳动关系达成协议",
      "termination_agreement",
    ],
    [
      "标题区域模糊\n交接总体声明\n岗位日常工作交接\n办公资产和系统权限全部移交",
      "employee_handover_form",
    ],
    [
      "标题区域模糊\n工资结算截止日期\n社会保险缴纳截止日期\n费用结清日期",
      "settlement_confirmation",
    ],
    [
      "标题区域模糊\n依据中华人民共和国劳动合同法第四十七条支付经济补偿\n工作年限共计一年",
      "compensation_agreement",
    ],
    [
      "标题区域模糊\n兹有我司员工张三\n双方劳动关系已于本月解除\n特此证明",
      "resignation_certificate",
    ],
  ])("标题未读出时可通过首页正文特征识别材料", (text, expectedType) => {
    expect(classifyResignationDocumentText(text)?.documentType).toBe(
      expectedType,
    );
  });

  it("按首页标题出现的实际顺序分组，不限制五类材料先后顺序", () => {
    const result = groupResignationBundlePages(8, [
      {
        pageNumber: 1,
        kind: "document",
        documentType: "resignation_certificate",
        label: "离职证明",
        source: "text",
      },
      {
        pageNumber: 3,
        kind: "document",
        documentType: "termination_agreement",
        label: "终止 / 解除劳动关系协议书",
        source: "image",
      },
      {
        pageNumber: 6,
        kind: "document",
        documentType: "employee_handover_form",
        label: "员工离职交接单",
        source: "text",
      },
    ]);

    expect(result.unsupportedPageNumbers).toEqual([]);
    expect(result.sections).toEqual([
      expect.objectContaining({
        documentType: "resignation_certificate",
        pageNumbers: [1, 2],
      }),
      expect.objectContaining({
        documentType: "termination_agreement",
        pageNumbers: [3, 4, 5],
      }),
      expect.objectContaining({
        documentType: "employee_handover_form",
        pageNumbers: [6, 7, 8],
      }),
    ]);
  });

  it("五类材料完全乱序时仍按各自首页正确切分", () => {
    const result = groupResignationBundlePages(12, [
      {
        pageNumber: 1,
        kind: "document",
        documentType: "compensation_agreement",
        label: "离职经济补偿协议书",
        source: "text",
      },
      {
        pageNumber: 3,
        kind: "document",
        documentType: "resignation_certificate",
        label: "离职证明",
        source: "text",
      },
      {
        pageNumber: 4,
        kind: "document",
        documentType: "employee_handover_form",
        label: "员工离职交接单",
        source: "image",
      },
      {
        pageNumber: 9,
        kind: "document",
        documentType: "termination_agreement",
        label: "终止 / 解除劳动关系协议书",
        source: "image",
      },
      {
        pageNumber: 11,
        kind: "document",
        documentType: "settlement_confirmation",
        label: "薪资及各类款项结算确认书",
        source: "text",
      },
    ]);

    expect(result.unsupportedPageNumbers).toEqual([]);
    expect(
      result.sections.map((section) => ({
        documentType: section.documentType,
        pageNumbers: section.pageNumbers,
      })),
    ).toEqual([
      { documentType: "compensation_agreement", pageNumbers: [1, 2] },
      { documentType: "resignation_certificate", pageNumbers: [3] },
      { documentType: "employee_handover_form", pageNumbers: [4, 5, 6, 7, 8] },
      { documentType: "termination_agreement", pageNumbers: [9, 10] },
      { documentType: "settlement_confirmation", pageNumbers: [11, 12] },
    ]);
  });

  it("未识别标题的起始页不会被擅自归档", () => {
    const result = groupResignationBundlePages(4, [
      {
        pageNumber: 2,
        kind: "document",
        documentType: "settlement_confirmation",
        label: "薪资及各类款项结算确认书",
        source: "text",
      },
    ]);

    expect(result.unsupportedPageNumbers).toEqual([1]);
    expect(result.sections[0].pageNumbers).toEqual([2, 3, 4]);
  });
});

describe("离职档案完成联动", () => {
  it("只统计当前版本，准确返回缺少的文件类型", () => {
    const missing = getMissingResignationArchiveTypes([
      { document_type: "termination_agreement", is_current: 1 },
      { document_type: "employee_handover_form", is_current: 1 },
      { document_type: "settlement_confirmation", is_current: 0 },
    ]);

    expect(missing).toEqual([
      "settlement_confirmation",
      "compensation_agreement",
      "resignation_certificate",
    ]);
  });

  it("五类文件齐全后只进入待确认，不自动改变员工和账号状态", async () => {
    const statements: string[] = [];
    const mockClient = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("FROM resignation_requests")) {
          return {
            rows: [
              {
                id: "request-1",
                employee_id: "employee-1",
                employee_user_id: "user-1",
                status: "draft",
              },
            ],
          };
        }
        if (sql.includes("FROM resignation_documents")) {
          return {
            rows: RESIGNATION_ARCHIVE_TYPES.map((documentType) => ({
              document_type: documentType,
              is_current: 1,
            })),
          };
        }
        return { rows: [] };
      }),
    } as unknown as PoolClient;

    const result = await refreshResignationArchiveCompletionWithClient(
      mockClient,
      "request-1",
    );

    expect(result).toEqual({
      completed: true,
      newlyCompleted: false,
      missingTypes: [],
      status: "pending_confirmation",
      accountDisabled: false,
    });
    expect(
      statements.some(
        (sql) =>
          sql.includes("UPDATE resignation_requests") &&
          sql.includes("pending_confirmation"),
      ),
    ).toBe(true);
    expect(
      statements.some((sql) => sql.includes("UPDATE employee_profiles")),
    ).toBe(false);
    expect(statements.some((sql) => sql.includes("UPDATE users"))).toBe(false);
  });

  it("待确认状态删除任一档案后退回档案待完善", async () => {
    const statements: string[] = [];
    const mockClient = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("FROM resignation_requests")) {
          return {
            rows: [
              {
                id: "request-ready",
                employee_id: "employee-ready",
                employee_user_id: "user-ready",
                status: "pending_confirmation",
              },
            ],
          };
        }
        return {
          rows: [
            {
              document_type: "termination_agreement",
              is_current: 1,
            },
          ],
        };
      }),
    } as unknown as PoolClient;

    const result = await refreshResignationArchiveCompletionWithClient(
      mockClient,
      "request-ready",
    );

    expect(result.status).toBe("draft");
    expect(result.completed).toBe(false);
    expect(
      statements.some(
        (sql) =>
          sql.includes("UPDATE resignation_requests") &&
          sql.includes("status = 'draft'"),
      ),
    ).toBe(true);
  });

  it("管理员确认后才将员工改为已离职并停用原账号", async () => {
    const statements: string[] = [];
    const mockClient = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("FROM resignation_requests")) {
          return {
            rows: [
              {
                id: "request-1",
                employee_id: "employee-1",
                employee_user_id: "user-1",
                status: "pending_confirmation",
              },
            ],
          };
        }
        if (sql.includes("FROM resignation_documents")) {
          return {
            rows: RESIGNATION_ARCHIVE_TYPES.map((documentType) => ({
              document_type: documentType,
              is_current: 1,
            })),
          };
        }
        if (sql.includes("SELECT name FROM users")) {
          return { rows: [{ name: "管理员" }] };
        }
        return { rows: [], rowCount: sql.includes("UPDATE users") ? 1 : 0 };
      }),
    } as unknown as PoolClient;

    const result = await finalizeResignationArchiveWithClient(
      mockClient,
      "request-1",
      "admin-1",
      "2026-07-24T10:00:00.000Z",
    );

    expect(result).toEqual({
      completed: true,
      newlyCompleted: true,
      missingTypes: [],
      status: "approved",
      accountDisabled: true,
    });
    expect(
      statements.some((sql) => sql.includes("UPDATE employee_profiles")),
    ).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE users"))).toBe(true);
    expect(statements.some((sql) => sql.includes("离职档案归档完成"))).toBe(
      true,
    );
  });

  it("材料不完整时不改变员工和账号状态", async () => {
    const statements: string[] = [];
    const mockClient = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("FROM resignation_requests")) {
          return {
            rows: [
              {
                id: "request-2",
                employee_id: "employee-2",
                employee_user_id: "user-2",
                status: "draft",
              },
            ],
          };
        }
        return {
          rows: [{ document_type: "termination_agreement", is_current: 1 }],
        };
      }),
    } as unknown as PoolClient;

    const result = await finalizeResignationArchiveWithClient(
      mockClient,
      "request-2",
      "admin-1",
      "2026-07-24T10:00:00.000Z",
    );

    expect(result.completed).toBe(false);
    expect(result.missingTypes).toHaveLength(4);
    expect(
      statements.some((sql) => sql.includes("UPDATE employee_profiles")),
    ).toBe(false);
    expect(statements.some((sql) => sql.includes("UPDATE users"))).toBe(false);
  });

  it("已完成归档后替换文件不会再次停用人工激活的账号", async () => {
    const statements: string[] = [];
    const mockClient = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("FROM resignation_requests")) {
          return {
            rows: [
              {
                id: "request-3",
                employee_id: "employee-3",
                employee_user_id: "user-3",
                status: "approved",
              },
            ],
          };
        }
        return {
          rows: RESIGNATION_ARCHIVE_TYPES.map((documentType) => ({
            document_type: documentType,
            is_current: 1,
          })),
        };
      }),
    } as unknown as PoolClient;

    const result = await refreshResignationArchiveCompletionWithClient(
      mockClient,
      "request-3",
    );

    expect(result).toEqual({
      completed: true,
      newlyCompleted: false,
      missingTypes: [],
      status: "approved",
      accountDisabled: false,
    });
    expect(
      statements.some((sql) => sql.includes("UPDATE employee_profiles")),
    ).toBe(false);
    expect(statements.some((sql) => sql.includes("UPDATE users"))).toBe(false);
  });
});

describe("离职模板在线填写", () => {
  it("替换预设字段并过滤可执行内容", () => {
    const filled = fillResignationTemplatePlaceholders(
      "<p>{{员工姓名}}于【离职日期】离职</p>",
      { 员工姓名: "张三", 离职日期: "2026-07-31" },
    );
    expect(filled).toContain("张三于2026-07-31离职");

    const sanitized = sanitizeResignationTemplateHtml(
      '<body><p onclick="alert(1)">正文</p><script>alert(1)</script></body>',
    );
    expect(sanitized).toBe("<p>正文</p>");
  });

  it("带表格的 Word 模板可转为在线内容并重新生成 Word", async () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "resignation-template-test-"),
    );
    const sourcePath = path.join(temporaryDirectory, "template.docx");

    try {
      const document = new WordDocument({
        sections: [
          {
            children: [
              new WordTable({
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [new TextRun("员工姓名：{{员工姓名}}")],
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          },
        ],
      });
      fs.writeFileSync(sourcePath, await Packer.toBuffer(document));

      const editableHtml = await loadResignationTemplateHtml(sourcePath, {
        员工姓名: "张三",
      });
      expect(editableHtml).toContain("<table");
      expect(editableHtml).toContain("张三");

      const rendered = await renderResignationTemplateDocx(editableHtml);
      expect(rendered.subarray(0, 2).toString("ascii")).toBe("PK");
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }, 120_000);
});
