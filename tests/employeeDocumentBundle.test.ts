/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { PDFDocument } from "pdf-lib";
import {
  groupEmployeeDocumentBundlePages,
  splitEmployeeDocumentBundle,
  type EmployeeDocumentBundleBoundary,
} from "../server/services/employeeDocumentBundle";

jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));

describe("合并人事档案页段处理", () => {
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
