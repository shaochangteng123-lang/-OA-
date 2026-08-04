/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { PDFDocument } from "pdf-lib";
import {
  classifyEmployeeDocument,
  detectEmployeeDocumentPageBoundary,
} from "../server/services/employeeDocumentClassifier";
import {
  analyzeEmployeeDocumentBundle,
  assertEmployeeDocumentBundlePageCoverage,
  groupEmployeeDocumentBundlePages,
  mapEmployeeDocumentSectionRecognizedTexts,
  splitEmployeeDocumentBundle,
  type EmployeeDocumentBundleBoundary,
} from "../server/services/employeeDocumentBundle";

jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
jest.mock("../server/services/employeeDocumentClassifier", () => {
  const actual = jest.requireActual(
    "../server/services/employeeDocumentClassifier",
  );
  return {
    ...actual,
    classifyEmployeeDocument: jest.fn(),
    detectEmployeeDocumentPageBoundary: jest.fn(),
  };
});

const classifyEmployeeDocumentMock = jest.mocked(classifyEmployeeDocument);
const detectEmployeeDocumentPageBoundaryMock = jest.mocked(
  detectEmployeeDocumentPageBoundary,
);

describe("合并人事档案页段处理", () => {
  beforeEach(() => {
    classifyEmployeeDocumentMock.mockReset();
    detectEmployeeDocumentPageBoundaryMock.mockReset();
  });

  it("把原文件页识别文字映射为拆分文件的本地页码", () => {
    const result = mapEmployeeDocumentSectionRecognizedTexts(
      [4, 7, 8],
      new Map([
        [4, ["第一页文字", "第一页布局文字"]],
        [6, ["不属于当前页段"]],
        [7, ["  第二页文字  ", ""]],
        [8, []],
      ]),
    );

    expect(Array.from(result.entries())).toEqual([
      [1, ["第一页文字", "第一页布局文字"]],
      [2, ["第二页文字"]],
    ]);
  });

  it("完全无法识别类型时将整份资料归入其他", () => {
    expect(groupEmployeeDocumentBundlePages(3, [])).toEqual({
      sections: [
        {
          documentType: "other",
          label: "其他",
          pageNumbers: [1, 2, 3],
        },
      ],
      unsupportedSegments: [{ label: "未识别材料", pageNumbers: [1, 2, 3] }],
    });
  });

  it("按实际标题顺序归组，并将额外资料归档至其他", () => {
    const boundaries: EmployeeDocumentBundleBoundary[] = [
      {
        pageNumber: 1,
        kind: "document",
        documentType: "invitation",
        label: "入职邀请函",
        source: "image",
      },
      {
        pageNumber: 3,
        kind: "document",
        documentType: "contract",
        label: "劳动合同书",
        source: "image",
      },
      {
        pageNumber: 6,
        kind: "unsupported",
        documentType: null,
        label: "员工离职证明",
        source: "image",
      },
      {
        pageNumber: 8,
        kind: "document",
        documentType: "diploma",
        label: "学历证书复印件",
        source: "image",
      },
      {
        pageNumber: 10,
        kind: "unsupported",
        documentType: null,
        label: "职业资格材料",
        source: "image",
      },
      {
        pageNumber: 11,
        kind: "document",
        documentType: "bank_card",
        label: "工资卡复印件（中国工商银行）",
        source: "image",
      },
    ];

    expect(groupEmployeeDocumentBundlePages(11, boundaries)).toEqual({
      sections: [
        {
          documentType: "invitation",
          label: "入职邀请函",
          pageNumbers: [1, 2],
        },
        {
          documentType: "contract",
          label: "劳动合同书",
          pageNumbers: [3, 4, 5],
        },
        {
          documentType: "other",
          label: "员工离职证明",
          pageNumbers: [6, 7],
        },
        {
          documentType: "diploma",
          label: "学历证书复印件",
          pageNumbers: [8, 9],
        },
        {
          documentType: "other",
          label: "职业资格材料",
          pageNumbers: [10],
        },
        {
          documentType: "bank_card",
          label: "工资卡复印件（中国工商银行）",
          pageNumbers: [11],
        },
      ],
      unsupportedSegments: [
        { label: "员工离职证明", pageNumbers: [6, 7] },
        { label: "职业资格材料", pageNumbers: [10] },
      ],
    });
  });

  it("将保密协议续页与后续独立个人声明分别归档", () => {
    const boundaries: EmployeeDocumentBundleBoundary[] = [
      {
        pageNumber: 1,
        kind: "document",
        documentType: "nda",
        label: "保密协议",
        source: "image",
      },
      {
        pageNumber: 4,
        kind: "document",
        documentType: "declaration",
        label: "个人声明",
        source: "image",
      },
    ];

    expect(groupEmployeeDocumentBundlePages(4, boundaries).sections).toEqual([
      {
        documentType: "nda",
        label: "保密协议",
        pageNumbers: [1, 2, 3],
      },
      {
        documentType: "declaration",
        label: "个人声明",
        pageNumbers: [4],
      },
    ]);
  });

  it("按真实21页档案边界将单页申请表与六页电脑管理办法分开", () => {
    const boundaries: EmployeeDocumentBundleBoundary[] = [
      {
        pageNumber: 1,
        kind: "document",
        documentType: "contract",
        label: "劳动合同书",
        source: "image",
      },
      {
        pageNumber: 10,
        kind: "document",
        documentType: "invitation",
        label: "入职邀请函",
        source: "image",
      },
      {
        pageNumber: 11,
        kind: "document",
        documentType: "nda",
        label: "保密协议",
        source: "image",
      },
      {
        pageNumber: 14,
        kind: "document",
        documentType: "declaration",
        label: "个人声明",
        source: "image",
      },
      {
        pageNumber: 15,
        kind: "document",
        documentType: "application",
        label: "新员工入职申请表",
        source: "image",
      },
      {
        pageNumber: 16,
        kind: "document",
        documentType: "asset_handover",
        label: "2025年度公司电脑管理办法",
        source: "image",
      },
    ];

    expect(groupEmployeeDocumentBundlePages(21, boundaries).sections).toEqual([
      {
        documentType: "contract",
        label: "劳动合同书",
        pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      },
      {
        documentType: "invitation",
        label: "入职邀请函",
        pageNumbers: [10],
      },
      {
        documentType: "nda",
        label: "保密协议",
        pageNumbers: [11, 12, 13],
      },
      {
        documentType: "declaration",
        label: "个人声明",
        pageNumbers: [14],
      },
      {
        documentType: "application",
        label: "新员工入职申请表",
        pageNumbers: [15],
      },
      {
        documentType: "asset_handover",
        label: "2025年度公司电脑管理办法",
        pageNumbers: [16, 17, 18, 19, 20, 21],
      },
    ]);
  });

  it("按赵双21页原件合并联次、附件标题并保留合同末页", () => {
    const boundaries: EmployeeDocumentBundleBoundary[] = [
      [1, "contract", "劳动合同书"],
      [10, "invitation", "入职邀请函"],
      [11, "invitation", "入职邀请函"],
      [12, "nda", "保密协议"],
      [15, "declaration", "个人声明"],
      [16, "asset_handover", "2025年度公司电脑管理办法"],
      [19, "asset_handover", "2025年度公司电脑管理办法"],
      [21, "asset_handover", "2025年度公司电脑管理办法"],
    ].map(([pageNumber, documentType, label]) => ({
      pageNumber: pageNumber as number,
      kind: "document" as const,
      documentType: documentType as Exclude<
        EmployeeDocumentBundleBoundary["documentType"],
        null
      >,
      label: label as string,
      source: "image" as const,
      pageStartEvidence: "heading" as const,
    }));

    expect(groupEmployeeDocumentBundlePages(21, boundaries).sections).toEqual([
      {
        documentType: "contract",
        label: "劳动合同书",
        pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      },
      {
        documentType: "invitation",
        label: "入职邀请函",
        pageNumbers: [10, 11],
      },
      {
        documentType: "nda",
        label: "保密协议",
        pageNumbers: [12, 13, 14],
      },
      {
        documentType: "declaration",
        label: "个人声明",
        pageNumbers: [15],
      },
      {
        documentType: "asset_handover",
        label: "2025年度公司电脑管理办法",
        pageNumbers: [16, 17, 18, 19, 20, 21],
      },
    ]);
  });

  it("按真实38页档案边界完整归档横置学历证与其他资料", () => {
    const boundaries: EmployeeDocumentBundleBoundary[] = [
      [1, "contract", "劳动合同书"],
      [10, "invitation", "入职邀请函"],
      [11, "nda", "保密协议"],
      [14, "declaration", "个人声明"],
      [15, "application", "新员工入职申请表"],
      [16, "asset_handover", "2025年度公司电脑管理办法"],
      [22, "id_card", "身份证复印件"],
      [23, "bank_card", "工资卡复印件（中国工商银行）"],
      [29, "diploma", "学历证书复印件"],
      [31, "health_report", "入职体检报告"],
    ].map(([pageNumber, documentType, label]) => ({
      pageNumber: pageNumber as number,
      kind: "document" as const,
      documentType: documentType as Exclude<
        EmployeeDocumentBundleBoundary["documentType"],
        null
      >,
      label: label as string,
      source: "image" as const,
      pageStartEvidence: "heading" as const,
    }));
    boundaries.splice(8, 0, {
      pageNumber: 24,
      kind: "unsupported",
      documentType: null,
      label: "员工离职证明",
      source: "image",
      unsupportedEvidence: "explicit",
    });
    boundaries.splice(9, 0, {
      pageNumber: 25,
      kind: "unsupported",
      documentType: null,
      label: "职业资格材料",
      source: "image",
      unsupportedEvidence: "explicit",
    });

    const result = groupEmployeeDocumentBundlePages(38, boundaries);

    expect(result.sections).toEqual([
      {
        documentType: "contract",
        label: "劳动合同书",
        pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      },
      { documentType: "invitation", label: "入职邀请函", pageNumbers: [10] },
      { documentType: "nda", label: "保密协议", pageNumbers: [11, 12, 13] },
      { documentType: "declaration", label: "个人声明", pageNumbers: [14] },
      {
        documentType: "application",
        label: "新员工入职申请表",
        pageNumbers: [15],
      },
      {
        documentType: "asset_handover",
        label: "2025年度公司电脑管理办法",
        pageNumbers: [16, 17, 18, 19, 20, 21],
      },
      { documentType: "id_card", label: "身份证复印件", pageNumbers: [22] },
      {
        documentType: "bank_card",
        label: "工资卡复印件（中国工商银行）",
        pageNumbers: [23],
      },
      { documentType: "other", label: "员工离职证明", pageNumbers: [24] },
      {
        documentType: "other",
        label: "职业资格材料",
        pageNumbers: [25, 26, 27, 28],
      },
      {
        documentType: "diploma",
        label: "学历证书复印件",
        pageNumbers: [29, 30],
      },
      {
        documentType: "health_report",
        label: "入职体检报告",
        pageNumbers: [31, 32, 33, 34, 35, 36, 37, 38],
      },
    ]);
    expect(result.unsupportedSegments).toEqual([
      { label: "员工离职证明", pageNumbers: [24] },
      { label: "职业资格材料", pageNumbers: [25, 26, 27, 28] },
    ]);
    expect(() =>
      assertEmployeeDocumentBundlePageCoverage(38, result.sections),
    ).not.toThrow();
  });

  it("拆分页码有遗漏或重复时停止归档", () => {
    expect(() =>
      assertEmployeeDocumentBundlePageCoverage(3, [
        {
          documentType: "nda",
          label: "保密协议",
          pageNumbers: [1, 2, 2],
        },
      ]),
    ).toThrow("页码存在遗漏、重复或越界");
  });

  it("同类型材料被其他档案分隔时保持为两份连续页段", () => {
    const boundaries: EmployeeDocumentBundleBoundary[] = [
      {
        pageNumber: 1,
        kind: "document",
        documentType: "nda",
        label: "保密协议",
        source: "image",
      },
      {
        pageNumber: 3,
        kind: "document",
        documentType: "declaration",
        label: "个人声明",
        source: "image",
      },
      {
        pageNumber: 4,
        kind: "document",
        documentType: "nda",
        label: "保密协议",
        source: "image",
      },
    ];

    expect(groupEmployeeDocumentBundlePages(4, boundaries).sections).toEqual([
      {
        documentType: "nda",
        label: "保密协议",
        pageNumbers: [1, 2],
      },
      {
        documentType: "declaration",
        label: "个人声明",
        pageNumbers: [3],
      },
      {
        documentType: "nda",
        label: "保密协议",
        pageNumbers: [4],
      },
    ]);
  });

  it("相邻同类型重复标题缺少独立实例证据时合并为一份", () => {
    const boundaries: EmployeeDocumentBundleBoundary[] = [
      {
        pageNumber: 1,
        kind: "document",
        documentType: "contract",
        label: "劳动合同书",
        source: "image",
        pageStartEvidence: "heading",
      },
      {
        pageNumber: 3,
        kind: "document",
        documentType: "contract",
        label: "劳动合同书",
        source: "image",
        pageStartEvidence: "heading",
      },
    ];

    expect(groupEmployeeDocumentBundlePages(4, boundaries).sections).toEqual([
      {
        documentType: "contract",
        label: "劳动合同书",
        pageNumbers: [1, 2, 3, 4],
      },
    ]);
  });

  it("分类冲突页面不得静默并入上一档案", () => {
    const boundaries: EmployeeDocumentBundleBoundary[] = [
      {
        pageNumber: 1,
        kind: "document",
        documentType: "nda",
        label: "保密协议",
        source: "image",
      },
      {
        pageNumber: 4,
        kind: "uncertain",
        documentType: null,
        label: "同时匹配保密协议、个人声明",
        source: "image",
        candidateTypes: ["nda", "declaration"],
      },
    ];

    expect(() => groupEmployeeDocumentBundlePages(4, boundaries)).toThrow(
      "存在分类不确定页面",
    );
  });

  it("分析发现冲突页时返回页码和候选类型并阻止生成页段", async () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "employee-document-analysis-"),
    );
    const sourcePath = path.join(tempDirectory, "员工整套档案.pdf");

    try {
      const sourceDocument = await PDFDocument.create();
      for (let index = 0; index < 4; index += 1) {
        sourceDocument.addPage([595, 842]);
      }
      fs.writeFileSync(sourcePath, await sourceDocument.save());

      detectEmployeeDocumentPageBoundaryMock
        .mockResolvedValueOnce({
          kind: "document",
          documentType: "nda",
          label: "保密协议",
          source: "image",
        })
        .mockResolvedValueOnce({
          kind: "none",
          documentType: null,
          label: null,
          source: "image",
        })
        .mockResolvedValueOnce({
          kind: "none",
          documentType: null,
          label: null,
          source: "image",
        })
        .mockResolvedValueOnce({
          kind: "uncertain",
          documentType: null,
          label: "同时匹配保密协议、个人声明",
          source: "image",
          candidateTypes: ["nda", "declaration"],
        });

      const result = await analyzeEmployeeDocumentBundle(
        sourcePath,
        "员工整套档案.pdf",
      );

      expect(result.status).toBe("uncertain");
      expect(result.sections).toEqual([]);
      expect(result.uncertainPages).toEqual([
        {
          pageNumber: 4,
          candidateTypes: ["nda", "declaration"],
          candidateLabels: ["保密协议", "个人声明"],
          message: "同时匹配保密协议、个人声明",
        },
      ]);
      expect(result.message).toContain("第4页同时匹配保密协议、个人声明");
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("没有识别证据的页面不得静默并入上一档案", async () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "employee-document-no-evidence-"),
    );
    const sourcePath = path.join(tempDirectory, "员工整套档案.pdf");

    try {
      const sourceDocument = await PDFDocument.create();
      sourceDocument.addPage([595, 842]);
      sourceDocument.addPage([595, 842]);
      fs.writeFileSync(sourcePath, await sourceDocument.save());

      detectEmployeeDocumentPageBoundaryMock
        .mockResolvedValueOnce({
          kind: "document",
          documentType: "nda",
          label: "保密协议",
          source: "image",
        })
        .mockResolvedValueOnce({
          kind: "none",
          documentType: null,
          label: null,
          source: null,
        });

      const result = await analyzeEmployeeDocumentBundle(
        sourcePath,
        "员工整套档案.pdf",
      );

      expect(result.status).toBe("uncertain");
      expect(result.sections).toEqual([]);
      expect(result.uncertainPages).toEqual([
        {
          pageNumber: 2,
          candidateTypes: [],
          candidateLabels: [],
          message: "本页没有足够的识别结果，无法确认档案边界",
        },
      ]);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("银行卡页未建立边界时不得静默并入上一页身份证", async () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "employee-document-bank-card-no-boundary-"),
    );
    const sourcePath = path.join(tempDirectory, "员工整套档案.pdf");

    try {
      const sourceDocument = await PDFDocument.create();
      sourceDocument.addPage([595, 842]);
      sourceDocument.addPage([595, 842]);
      fs.writeFileSync(sourcePath, await sourceDocument.save());

      detectEmployeeDocumentPageBoundaryMock
        .mockResolvedValueOnce({
          kind: "document",
          documentType: "id_card",
          label: "身份证复印件",
          source: "image",
        })
        .mockResolvedValueOnce({
          kind: "none",
          documentType: null,
          label: null,
          source: "image",
        });

      const result = await analyzeEmployeeDocumentBundle(
        sourcePath,
        "员工整套档案.pdf",
      );

      expect(result.status).toBe("uncertain");
      expect(result.sections).toEqual([]);
      expect(result.uncertainPages).toEqual([
        expect.objectContaining({
          pageNumber: 2,
          candidateTypes: [],
          candidateLabels: [],
        }),
      ]);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("生产CS023中个人声明后的可读无边界页不得继续并入个人声明", async () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "employee-document-cs023-no-boundary-"),
    );
    const sourcePath = path.join(tempDirectory, "CS023员工整套档案.pdf");

    try {
      const sourceDocument = await PDFDocument.create();
      sourceDocument.addPage([595, 842]);
      sourceDocument.addPage([595, 842]);
      fs.writeFileSync(sourcePath, await sourceDocument.save());

      detectEmployeeDocumentPageBoundaryMock
        .mockResolvedValueOnce({
          kind: "document",
          documentType: "declaration",
          label: "个人声明",
          source: "image",
        })
        .mockResolvedValueOnce({
          kind: "none",
          documentType: null,
          label: null,
          source: "image",
        });

      const result = await analyzeEmployeeDocumentBundle(
        sourcePath,
        "CS023员工整套档案.pdf",
      );

      expect(result.status).toBe("uncertain");
      expect(result.sections).toEqual([]);
      expect(result.uncertainPages).toEqual([
        expect.objectContaining({
          pageNumber: 2,
          candidateTypes: [],
          candidateLabels: [],
        }),
      ]);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("首个明确档案之前的可读未分类页段不得自动归入其他", async () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "employee-document-leading-unknown-"),
    );
    const sourcePath = path.join(tempDirectory, "员工整套档案.pdf");

    try {
      const sourceDocument = await PDFDocument.create();
      sourceDocument.addPage([595, 842]);
      sourceDocument.addPage([595, 842]);
      sourceDocument.addPage([595, 842]);
      fs.writeFileSync(sourcePath, await sourceDocument.save());

      detectEmployeeDocumentPageBoundaryMock
        .mockResolvedValueOnce({
          kind: "none",
          documentType: null,
          label: null,
          source: "image",
        })
        .mockResolvedValueOnce({
          kind: "document",
          documentType: "invitation",
          label: "入职邀请函",
          source: "image",
        })
        .mockResolvedValueOnce({
          kind: "none",
          documentType: null,
          label: null,
          source: "image",
        });

      const result = await analyzeEmployeeDocumentBundle(
        sourcePath,
        "员工整套档案.pdf",
      );

      expect(result.status).toBe("uncertain");
      expect(result.sections).toEqual([]);
      expect(result.uncertainPages).toEqual([
        expect.objectContaining({
          pageNumber: 1,
          candidateTypes: [],
          candidateLabels: [],
        }),
      ]);
      expect(result.message).toContain("第1页无法确定类型");
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("首个明确档案前没有识别证据的页面只生成一条不确定记录", async () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "employee-document-leading-no-evidence-"),
    );
    const sourcePath = path.join(tempDirectory, "员工整套档案.pdf");

    try {
      const sourceDocument = await PDFDocument.create();
      sourceDocument.addPage([595, 842]);
      sourceDocument.addPage([595, 842]);
      fs.writeFileSync(sourcePath, await sourceDocument.save());

      detectEmployeeDocumentPageBoundaryMock
        .mockResolvedValueOnce({
          kind: "none",
          documentType: null,
          label: null,
          source: null,
        })
        .mockResolvedValueOnce({
          kind: "document",
          documentType: "invitation",
          label: "入职邀请函",
          source: "image",
        });

      const result = await analyzeEmployeeDocumentBundle(
        sourcePath,
        "员工整套档案.pdf",
      );

      expect(result.status).toBe("uncertain");
      expect(result.uncertainPages).toEqual([
        {
          pageNumber: 1,
          candidateTypes: [],
          candidateLabels: [],
          message: "本页没有足够的识别结果，无法确认档案边界",
        },
      ]);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it.each(["filename", "text", "image"] as const)(
    "多页文件没有可靠页段边界时不得按整文件的%s结果自动归档",
    async (source) => {
      const tempDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "employee-document-no-boundary-"),
      );
      const sourcePath = path.join(tempDirectory, "保密协议.pdf");

      try {
        const sourceDocument = await PDFDocument.create();
        sourceDocument.addPage([595, 842]);
        sourceDocument.addPage([595, 842]);
        fs.writeFileSync(sourcePath, await sourceDocument.save());

        detectEmployeeDocumentPageBoundaryMock.mockResolvedValue({
          kind: "none",
          documentType: null,
          label: null,
          source: "image",
        });
        classifyEmployeeDocumentMock.mockResolvedValue({
          status: "success",
          documentType: "nda",
          label: "保密协议",
          source,
          message: "已识别为保密协议",
        });

        const result = await analyzeEmployeeDocumentBundle(
          sourcePath,
          "保密协议.pdf",
        );

        expect(result.status).toBe("uncertain");
        expect(result.sections).toEqual([]);
        expect(result.uncertainPages[0]).toMatchObject({
          pageNumber: 1,
          candidateTypes: ["nda"],
          candidateLabels: ["保密协议"],
        });
        expect(result.message).toContain("未识别出可靠页段边界");
      } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
      }
    },
  );

  it("单页文件仍可使用唯一文件名匹配结果", async () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "employee-document-single-filename-"),
    );
    const sourcePath = path.join(tempDirectory, "保密协议.pdf");

    try {
      const sourceDocument = await PDFDocument.create();
      sourceDocument.addPage([595, 842]);
      fs.writeFileSync(sourcePath, await sourceDocument.save());

      detectEmployeeDocumentPageBoundaryMock.mockResolvedValue({
        kind: "none",
        documentType: null,
        label: null,
        source: "image",
      });
      classifyEmployeeDocumentMock.mockResolvedValue({
        status: "success",
        documentType: "nda",
        label: "保密协议",
        source: "filename",
        message: "已识别为保密协议",
      });

      const result = await analyzeEmployeeDocumentBundle(
        sourcePath,
        "保密协议.pdf",
      );

      expect(result.status).toBe("success");
      expect(result.sections).toEqual([
        {
          documentType: "nda",
          label: "保密协议",
          pageNumbers: [1],
        },
      ]);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("拆分后只保留各类型对应页", async () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "employee-document-bundle-"),
    );
    const sourcePath = path.join(tempDirectory, "员工整套档案.pdf");

    try {
      const sourceDocument = await PDFDocument.create();
      for (let index = 0; index < 5; index += 1) {
        sourceDocument.addPage([595, 842]);
      }
      fs.writeFileSync(sourcePath, await sourceDocument.save());

      const files = await splitEmployeeDocumentBundle(
        sourcePath,
        "CS001测试员工-整套档案.pdf",
        [
          {
            documentType: "contract",
            label: "劳动合同书",
            pageNumbers: [1, 2],
          },
          {
            documentType: "other",
            label: "其他",
            pageNumbers: [3],
          },
          {
            documentType: "health_report",
            label: "入职体检报告",
            pageNumbers: [4, 5],
          },
        ],
      );

      expect(files.map((file) => file.originalFileName)).toEqual([
        "CS001测试员工-劳动合同书.pdf",
        "CS001测试员工-其他.pdf",
        "CS001测试员工-入职体检报告.pdf",
      ]);
      const pageCounts = await Promise.all(
        files.map(async (file) =>
          (
            await PDFDocument.load(fs.readFileSync(file.filePath))
          ).getPageCount(),
        ),
      );
      expect(pageCounts).toEqual([2, 1, 2]);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
