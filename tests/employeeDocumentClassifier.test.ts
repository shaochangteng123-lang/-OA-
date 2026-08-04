import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import sharp from "sharp";
import {
  buildEmployeeDocumentOcrLayoutText,
  calculateEmployeeDocumentFocusedHeadingGeometry,
  calculateEmployeeDocumentTitleRegionRenderGeometry,
  canSkipEmployeeDocumentTitleRegionReview,
  classifyEmployeeDocumentPageStartText,
  classifyEmployeeDocumentText,
  detectUnsupportedEmployeeDocumentPageStartText,
  filterEmployeeDocumentFocusedHeadingBoundary,
  hasReliableEmployeeDocumentTitleRecognition,
  inspectEmployeeDocumentPageBoundaryText,
  isEmployeeDocumentOcrMostlyVertical,
  mergeEmployeeDocumentPageBoundaryEvidence,
  mergeEmployeeDocumentRotationBoundaryEvidence,
  resolveEmployeeDocumentRotationReviewAngles,
  resolveEmployeeDocumentTitleRegionRenderGeometry,
  resolveEmployeeDocumentPageNoBoundary,
} from "../server/services/employeeDocumentClassifier";

const execFileAsync = promisify(execFile);

describe("人事档案标题区渲染优化", () => {
  it("聚焦标题区域覆盖页面中央主标题并限制识别图片宽度", () => {
    expect(
      calculateEmployeeDocumentFocusedHeadingGeometry(2480, 3505, 2480, 1929),
    ).toEqual({
      left: 297,
      top: 245,
      width: 1884,
      height: 876,
      targetWidth: 3769,
    });
    expect(
      calculateEmployeeDocumentFocusedHeadingGeometry(3505, 2480, 3505, 1366),
    ).toEqual({
      left: 420,
      top: 173,
      width: 2663,
      height: 620,
      targetWidth: 3800,
    });
  });

  it("保持旧标题区像素语义，并正确处理旋转页面", async () => {
    const workDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "employee-document-title-render-"),
    );
    const pdfPath = path.join(workDirectory, "source.pdf");
    const fullPrefix = path.join(workDirectory, "full");
    const directPrefix = path.join(workDirectory, "direct");
    const rotatedPrefix = path.join(workDirectory, "rotated");
    const fullPath = `${fullPrefix}.png`;
    const directPath = `${directPrefix}.png`;
    const rotatedPath = `${rotatedPrefix}.png`;
    const dpi = 480;

    try {
      const document = await PDFDocument.create();
      const page = document.addPage([72, 100]);
      page.drawRectangle({
        x: 4,
        y: 44.75,
        width: 64,
        height: 1.5,
        color: rgb(0.1, 0.25, 0.8),
      });
      page.drawRectangle({
        x: 10,
        y: 70,
        width: 52,
        height: 18,
        color: rgb(0.85, 0.2, 0.15),
      });
      const rotatedPage = document.addPage([72, 100]);
      rotatedPage.setRotation(degrees(90));
      fs.writeFileSync(pdfPath, await document.save());

      const geometry = await resolveEmployeeDocumentTitleRegionRenderGeometry(
        pdfPath,
        1,
        dpi,
      );
      expect(geometry).toEqual(
        calculateEmployeeDocumentTitleRegionRenderGeometry(72, 100, 0, dpi),
      );
      expect(geometry).toEqual({
        fullWidth: 480,
        fullHeight: 667,
        titleHeight: 366,
        renderHeight: 368,
      });

      await execFileAsync("pdftoppm", [
        "-png",
        "-singlefile",
        "-r",
        String(dpi),
        "-f",
        "1",
        "-l",
        "1",
        pdfPath,
        fullPrefix,
      ]);
      await execFileAsync("pdftoppm", [
        "-x",
        "0",
        "-y",
        "0",
        "-W",
        String(geometry.fullWidth),
        "-H",
        String(geometry.renderHeight),
        "-png",
        "-singlefile",
        "-r",
        String(dpi),
        "-f",
        "1",
        "-l",
        "1",
        pdfPath,
        directPrefix,
      ]);

      const legacyInput = await sharp(fullPath)
        .extract({
          left: 0,
          top: 0,
          width: geometry.fullWidth,
          height: geometry.titleHeight,
        })
        .grayscale()
        .normalize()
        .sharpen()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const optimizedInput = await sharp(directPath)
        .extract({
          left: 0,
          top: 0,
          width: geometry.fullWidth,
          height: geometry.titleHeight,
        })
        .grayscale()
        .normalize()
        .sharpen()
        .raw()
        .toBuffer({ resolveWithObject: true });

      expect(optimizedInput.info).toEqual(legacyInput.info);
      expect(optimizedInput.data.equals(legacyInput.data)).toBe(true);

      const rotatedGeometry =
        await resolveEmployeeDocumentTitleRegionRenderGeometry(pdfPath, 2, dpi);
      expect(rotatedGeometry).toEqual({
        fullWidth: 667,
        fullHeight: 480,
        titleHeight: 264,
        renderHeight: 266,
      });
      await execFileAsync("pdftoppm", [
        "-png",
        "-singlefile",
        "-r",
        String(dpi),
        "-f",
        "2",
        "-l",
        "2",
        pdfPath,
        rotatedPrefix,
      ]);
      const rotatedMetadata = await sharp(rotatedPath).metadata();
      expect({
        width: rotatedMetadata.width,
        height: rotatedMetadata.height,
      }).toEqual({
        width: rotatedGeometry.fullWidth,
        height: rotatedGeometry.fullHeight,
      });
    } finally {
      fs.rmSync(workDirectory, { recursive: true, force: true });
    }
  });
});

describe("人事档案自动分类", () => {
  it.each([
    ["附件.pdf", "入职邀请函 年保障薪酬 月保障薪酬", "invitation"],
    ["附件.pdf", "新员工入职申请表 紧急联系人", "application"],
    ["附件.pdf", "劳动合同书 甲方 乙方 合同期限", "contract"],
    ["附件.pdf", "保密协议 保密义务 商业秘密", "nda"],
    ["附件.pdf", "个人声明 本人郑重声明 声明人", "declaration"],
    ["附件.pdf", "2025年度公司电脑管理办法 电脑领用", "asset_handover"],
    ["附件.pdf", "中华人民共和国居民身份证 公民身份号码", "id_card"],
    ["附件.pdf", "入职体检报告 体检结论", "health_report"],
    ["附件.pdf", "普通高等学校 毕业证书", "diploma"],
    ["附件.pdf", "中国工商银行 借记卡 卡号", "bank_card"],
  ])("按第一页标题识别 %s", (filename, text, expectedType) => {
    const result = classifyEmployeeDocumentText(filename, text);

    expect(result.status).toBe("success");
    expect(result.documentType).toBe(expectedType);
  });

  it("公司页眉之后的电脑管理办法主标题仍识别为新档案首页", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "编号:YULI-CS-25001-1",
        "Powered by technology, Strive for survival by quality.",
        "2025年度公司电脑管理办法",
        "总则",
        "目的：规范公司电脑的购置及管理，特制定本办法。",
        "适用范围：北京羽隶工程咨询有限公司。",
      ].join("\n"),
    );

    expect(result).toMatchObject({
      status: "success",
      documentType: "asset_handover",
      pageStartEvidence: "heading",
      headingIndex: 2,
    });
  });

  it("聚焦标题识别只接受固定档案精确标题，不接受正文组合或其他资料噪声", () => {
    const exactHeading = {
      kind: "document" as const,
      documentType: "asset_handover" as const,
      label: "2025年度公司电脑管理办法",
      source: "image" as const,
      pageStartEvidence: "heading" as const,
      headingIndex: 2,
    };

    expect(filterEmployeeDocumentFocusedHeadingBoundary(exactHeading)).toEqual(
      exactHeading,
    );
    expect(
      filterEmployeeDocumentFocusedHeadingBoundary({
        ...exactHeading,
        pageStartEvidence: "composite",
      }),
    ).toBeNull();
    expect(
      filterEmployeeDocumentFocusedHeadingBoundary({
        kind: "unsupported",
        documentType: null,
        label: "其他资料：印章噪声协议",
        source: "image",
        unsupportedEvidence: "generic",
      }),
    ).toBeNull();
  });

  it("兼容旧文件类型名称", () => {
    expect(
      classifyEmployeeDocumentText("固定资产交接单.pdf").documentType,
    ).toBe("asset_handover");
    expect(classifyEmployeeDocumentText("邀请函.pdf").documentType).toBe(
      "invitation",
    );
  });

  it("正文标题可纠正错误文件名", () => {
    const result = classifyEmployeeDocumentText(
      "邀请函.pdf",
      "劳动合同书 甲方 乙方 合同期限",
    );

    expect(result.documentType).toBe("contract");
    expect(result.source).toBe("text");
  });

  it("无法明确判断时不自动归档", () => {
    const result = classifyEmployeeDocumentText("员工资料.pdf", "姓名 张三");

    expect(result.status).toBe("uncertain");
    expect(result.documentType).toBeNull();
  });

  it("按文字坐标还原被乱序拆分的劳动合同书标题", () => {
    const layoutText = buildEmployeeDocumentOcrLayoutText([
      {
        text: "劳：",
        confidence: 0.78,
        box: [
          [611, 910],
          [902, 881],
          [924, 1104],
          [633, 1132],
        ],
      },
      {
        text: "动",
        confidence: 0.99,
        box: [
          [872, 912],
          [1166, 912],
          [1166, 1112],
          [872, 1112],
        ],
      },
      {
        text: "书",
        confidence: 0.99,
        box: [
          [1677, 913],
          [1864, 913],
          [1864, 1103],
          [1677, 1103],
        ],
      },
      {
        text: "合",
        confidence: 0.99,
        box: [
          [1139, 933],
          [1345, 938],
          [1341, 1097],
          [1135, 1092],
        ],
      },
      {
        text: "同",
        confidence: 0.99,
        box: [
          [1437, 936],
          [1626, 936],
          [1626, 1097],
          [1437, 1097],
        ],
      },
    ]);

    expect(layoutText).toBe("劳： 动 合 同 书");
    expect(
      classifyEmployeeDocumentPageStartText("员工整套档案.pdf", layoutText)
        .documentType,
    ).toBe("contract");
  });

  it("同一高度但距离较远的页码不得污染正式标题", () => {
    const layoutText = buildEmployeeDocumentOcrLayoutText([
      {
        text: "保密协议",
        confidence: 0.99,
        box: [
          [500, 200],
          [900, 200],
          [900, 300],
          [500, 300],
        ],
      },
      {
        text: "1/3",
        confidence: 0.99,
        box: [
          [1800, 205],
          [1950, 205],
          [1950, 295],
          [1800, 295],
        ],
      },
    ]);

    expect(layoutText).toBe("保密协议\n1/3");
    expect(
      classifyEmployeeDocumentPageStartText("员工整套档案.pdf", layoutText)
        .documentType,
    ).toBe("nda");
  });

  it("劳动合同封面标题失真时使用签订信息与合同正文确认", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "劳：",
        "动",
        "书",
        "合",
        "同",
        "甲方：北京羽隶工程咨询有限公司",
        "乙方：员工姓名",
        "签订日期：2022年11月8日",
        "根据中华人民共和国劳动合同法，甲乙双方协商一致签订本合同",
        "共同遵守本合同所列条款",
      ].join("\n"),
    );

    expect(result.status).toBe("success");
    expect(result.documentType).toBe("contract");
  });

  it("解除劳动合同协议不得仅凭签订信息误判为劳动合同", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "解除劳动合同协议",
        "甲方：北京羽隶工程咨询有限公司",
        "乙方：员工姓名",
        "签订日期：2026年7月31日",
        "依据中华人民共和国劳动合同法，双方签订本合同并解除劳动关系",
      ].join("\n"),
    );

    expect(result.status).toBe("uncertain");
    expect(result.documentType).toBeNull();
  });

  it("明确的解除劳动合同协议标题优先于劳动合同正文组合", () => {
    const result = inspectEmployeeDocumentPageBoundaryText(
      "员工整套档案.pdf",
      [
        "解除劳动合同协议",
        "甲方：北京羽隶工程咨询有限公司",
        "乙方：员工姓名",
        "依据中华人民共和国劳动合同法解除劳动关系",
        "劳动合同期限",
      ].join("\n"),
      "image",
    );

    expect(result).toMatchObject({
      kind: "unsupported",
      label: "劳动关系其他协议",
      unsupportedEvidence: "explicit",
    });
  });

  it("前置劳动合同书精确标题不受正文引用其他协议影响", () => {
    const result = inspectEmployeeDocumentPageBoundaryText(
      "员工整套档案.pdf",
      [
        "劳动合同书",
        "甲方：北京羽隶工程咨询有限公司",
        "乙方：员工姓名",
        "依据中华人民共和国劳动合同法建立劳动关系",
        "劳动合同期限",
        "解除劳动合同协议须另行签订",
      ].join("\n"),
      "image",
    );

    expect(result).toMatchObject({
      kind: "document",
      documentType: "contract",
      pageStartEvidence: "heading",
      headingIndex: 0,
    });
  });

  it("两种文字顺序均确认前置精确标题和正文结构时才跳过标题复核", () => {
    const layoutText = [
      "入职邀请函",
      "年保障薪酬为96000元",
      "月保障薪酬为8000元",
    ].join("\n");
    const fullText = [
      "入职邀请函",
      "月保障薪酬为8000元",
      "年保障薪酬为96000元",
    ].join("\n");

    expect(
      canSkipEmployeeDocumentTitleRegionReview([layoutText, fullText]),
    ).toBe(true);
  });

  it.each([
    [
      "劳动合同书\n甲方\n乙方\n劳动合同法\n劳动关系\n合同期限",
      "劳动合同书\n合同期限\n甲方\n乙方\n劳动关系\n劳动合同法",
    ],
    [
      "保密协议\n甲方\n乙方\n达成如下协议\n保密内容\n商业秘密\n保密范围",
      "保密协议\n保密内容\n商业秘密\n保密范围\n甲方\n乙方\n签订本协议",
    ],
    [
      "个人声明\n本人谨此声明\n个人资料信息真实有效\n特此声明\n声明人",
      "个人声明\n本人承诺\n公司规章制度\n特此声明\n姓名",
    ],
  ])(
    "合同、保密协议和个人声明即使快速结果一致也保留增强复核",
    (firstText, secondText) => {
      expect(
        canSkipEmployeeDocumentTitleRegionReview([firstText, secondText]),
      ).toBe(false);
    },
  );

  it("标题区文字充分且平均置信度达标时允许判定为可靠续页", () => {
    const lines = Array.from({ length: 8 }, (_, index) => ({
      text: `这是第${index + 1}行可读的连续正文内容`,
      confidence: 0.92,
      box: [
        [10, index * 30],
        [300, index * 30],
        [300, index * 30 + 20],
        [10, index * 30 + 20],
      ],
    }));

    expect(
      hasReliableEmployeeDocumentTitleRecognition(
        [
          "本页为上一份材料的连续正文内容并继续说明双方责任\n相关条款真实有效且双方均应继续遵照执行",
        ],
        lines,
      ),
    ).toBe(true);
  });

  it("标题区行数不足或平均置信度偏低时必须执行增强复核", () => {
    const readableText =
      "本页为上一份材料的连续正文内容并继续说明双方责任\n相关条款真实有效且双方均应继续遵照执行";
    const buildLines = (count: number, confidence: number) =>
      Array.from({ length: count }, (_, index) => ({
        text: `第${index + 1}行正文`,
        confidence,
        box: [
          [10, index * 30],
          [200, index * 30],
          [200, index * 30 + 20],
          [10, index * 30 + 20],
        ],
      }));

    expect(
      hasReliableEmployeeDocumentTitleRecognition(
        [readableText],
        buildLines(7, 0.95),
      ),
    ).toBe(false);
    expect(
      hasReliableEmployeeDocumentTitleRecognition(
        [readableText],
        buildLines(8, 0.87),
      ),
    ).toBe(false);
  });

  it("横置扫描页的纵向文字框不得被当成正常方向的可靠续页", () => {
    const verticalLines = [
      "普通高等学校",
      "毕业证书",
      "学生姓名",
      "工程造价专业",
      "修完教学计划规定的全部课程",
      "成绩合格准予毕业",
      "证书编号",
      "学历证书查询网址",
    ].map((text, index) => ({
      text,
      confidence: 0.96,
      box: [
        [100 + index * 60, 200],
        [140 + index * 60, 200],
        [140 + index * 60, 200 + text.length * 36],
        [100 + index * 60, 200 + text.length * 36],
      ],
    }));
    const readableText = verticalLines.map((line) => line.text).join("\n");

    expect(isEmployeeDocumentOcrMostlyVertical(verticalLines)).toBe(true);
    expect(
      hasReliableEmployeeDocumentTitleRecognition(
        [readableText],
        verticalLines,
      ),
    ).toBe(false);
    expect(
      resolveEmployeeDocumentRotationReviewAngles([verticalLines]),
    ).toEqual([90, 270]);
  });

  it("没有纵向文字框证据时不增加旋转识别次数", () => {
    expect(resolveEmployeeDocumentRotationReviewAngles([[]])).toEqual([]);
  });

  it("横置证件只有两个方向得到同一结构类型时才建立组合边界", () => {
    const diplomaComposite = {
      kind: "document" as const,
      documentType: "diploma" as const,
      label: "学历证书复印件",
      source: "image" as const,
      pageStartEvidence: "composite" as const,
    };

    expect(
      mergeEmployeeDocumentRotationBoundaryEvidence([
        diplomaComposite,
        { ...diplomaComposite },
      ]),
    ).toEqual(diplomaComposite);
    expect(
      mergeEmployeeDocumentRotationBoundaryEvidence([diplomaComposite]),
    ).toBeNull();
    expect(
      mergeEmployeeDocumentRotationBoundaryEvidence([
        { ...diplomaComposite, documentType: "nda", label: "保密协议" },
        { ...diplomaComposite, documentType: "nda", label: "保密协议" },
      ]),
    ).toBeNull();
  });

  it.each([
    {
      name: "只有一路识别文字",
      texts: ["劳动合同书\n甲方\n乙方\n劳动合同法\n劳动关系\n合同期限"],
    },
    {
      name: "只有正文组合命中",
      texts: [
        "甲方\n乙方\n劳动合同法\n劳动关系\n合同期限",
        "甲方\n乙方\n劳动合同法\n劳动关系\n合同期限",
      ],
    },
    {
      name: "保密协议与个人声明结构冲突",
      texts: [
        "保密协议\n甲方\n乙方\n达成如下协议\n保密内容\n商业秘密\n保密范围\n个人声明\n本人郑重声明\n特此声明\n声明人",
        "保密协议\n甲方\n乙方\n达成如下协议\n保密内容\n商业秘密\n保密范围\n个人声明\n本人郑重声明\n特此声明\n声明人",
      ],
    },
    {
      name: "解除劳动合同协议",
      texts: [
        "解除劳动合同协议\n甲方\n乙方\n劳动合同法\n劳动关系\n合同期限",
        "解除劳动合同协议\n甲方\n乙方\n劳动合同法\n劳动关系\n合同期限",
      ],
    },
  ])("$name必须保留480 DPI标题复核", ({ texts }) => {
    expect(canSkipEmployeeDocumentTitleRegionReview(texts)).toBe(false);
  });

  it("文字层已有不确定证据时不得跳过标题复核", () => {
    expect(
      canSkipEmployeeDocumentTitleRegionReview(
        [
          "个人声明\n本人郑重声明\n特此声明\n声明人",
          "个人声明\n本人郑重声明\n特此声明\n声明人",
        ],
        {
          kind: "unsupported",
          documentType: null,
          label: "劳动关系其他协议",
          source: "text",
          unsupportedEvidence: "explicit",
        },
      ),
    ).toBe(false);
  });

  it("文字层和图片识别结果都不足时阻止静默并入上一档案", () => {
    const result = resolveEmployeeDocumentPageNoBoundary(" \n。", [
      "",
      "第4页",
    ]);

    expect(result.kind).toBe("uncertain");
    expect(result.source).toBeNull();
    expect(result.label).toContain("无法确认");
  });

  it.each([
    "Powered by technology. Strive for survival by quality.",
    "以科技为动力\n以质量求生存",
    "A8X03R72Q91Z",
  ])("固定页眉页脚或乱码不能作为续页证据：%s", (recognizedText) => {
    const result = resolveEmployeeDocumentPageNoBoundary("", [recognizedText]);

    expect(result.kind).toBe("uncertain");
    expect(result.source).toBeNull();
  });

  it("图片识别到足够续页正文时允许沿用当前档案页段", () => {
    const result = resolveEmployeeDocumentPageNoBoundary("", [
      [
        "本协议未尽事宜由甲乙双方另行协商并签字确认",
        "双方应继续遵守前述约定并承担相应责任和义务",
      ].join("\n"),
    ]);

    expect(result).toEqual({
      kind: "none",
      documentType: null,
      label: null,
      source: "image",
    });
  });

  it("图片结果不足但文字层正文可读时允许沿用当前档案页段", () => {
    const result = resolveEmployeeDocumentPageNoBoundary(
      [
        "本页为劳动合同条款的连续正文内容并继续约定双方责任",
        "甲乙双方确认上述条款真实有效并自愿遵照执行",
      ].join("\n"),
      [""],
    );

    expect(result).toEqual({
      kind: "none",
      documentType: null,
      label: null,
      source: "text",
    });
  });

  it("按页面首页标题识别边界，不依赖文件内类型顺序", () => {
    expect(
      classifyEmployeeDocumentPageStartText(
        "员工整套档案.pdf",
        "北京羽隶工程咨询有限公司\n保密协议\n甲方与乙方",
      ).documentType,
    ).toBe("nda");
    expect(
      classifyEmployeeDocumentPageStartText(
        "员工整套档案.pdf",
        "中国工商银行\n牡丹灵通卡\n借记卡\n卡号",
      ).documentType,
    ).toBe("bank_card");
    expect(
      classifyEmployeeDocumentPageStartText(
        "员工整套档案.pdf",
        "中华人民共和国\n居民身份证\n公民身份号码",
      ).documentType,
    ).toBe("id_card");
  });

  it("人事档案材料目录列出的固定档案名称不得被当成真实首页", () => {
    const result = inspectEmployeeDocumentPageBoundaryText(
      "员工整套档案.pdf",
      [
        "人事档案材料目录",
        "1. 劳动合同书",
        "2. 保密协议",
        "3. 个人声明",
        "4. 身份证复印件",
      ].join("\n"),
      "image",
    );

    expect(result?.kind).not.toBe("document");
  });

  it("劳动合同续页中的保密条款不得被当成保密协议首页", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "第6页 共9页",
        "第三十条 保密义务",
        "本合同约定的保密内容包括公司的商业秘密和技术秘密",
        "乙方应遵守前述保密范围并继续履行本合同",
      ].join("\n"),
    );

    expect(result.documentType).not.toBe("nda");
  });

  it("解除劳动合同书应归入其他而非劳动合同", () => {
    const result = inspectEmployeeDocumentPageBoundaryText(
      "员工整套档案.pdf",
      [
        "解除劳动合同书",
        "甲方：北京羽隶工程咨询有限公司",
        "乙方：员工姓名",
        "依据中华人民共和国劳动合同法解除劳动关系",
        "原劳动合同期限至本协议签署之日终止",
      ].join("\n"),
      "image",
    );

    expect(result).toMatchObject({
      kind: "unsupported",
      documentType: null,
      label: "劳动关系其他协议",
    });
  });

  it("工行卡复印件未识别出借记卡字样时仍根据真实卡面特征确认边界", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "MONTHNEAR",
        "VALED",
        "本卡不得出租、转借、转让",
        "08/33",
        "如拾获本卡请还至中回工商银行",
        "中国工商",
      ].join("\n"),
    );

    expect(result).toMatchObject({
      status: "success",
      documentType: "bank_card",
      pageStartEvidence: "composite",
    });
  });

  it("真实低质量卡面只识别出残缺银行名和背面警示语时仍确认银行卡边界", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      ["本卡不得出租转借转让", "如拾获本卡请还至中回工商银行", "中国工商"].join(
        "\n",
      ),
    );

    expect(result).toMatchObject({
      status: "success",
      documentType: "bank_card",
      pageStartEvidence: "composite",
    });
  });

  it("真实身份证正面漏识别证件标题时仍根据专属字段确认边界", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "姓名曹鸿浩",
        "村男民版满",
        "生1995年2月18日",
        "北京市顺义区北小营镇马辛庄村朝阳中路四条5号",
        "公民身份号码-110228199502184916",
      ].join("\n"),
    );

    expect(result).toMatchObject({
      status: "success",
      documentType: "id_card",
      pageStartEvidence: "composite",
    });
  });

  it.each([
    [
      "电子银行回单",
      "中国工商银行电子银行回单\n银联交易\n付款账号：6222030200026339493",
    ],
    [
      "账户交易流水",
      "中国工商银行账户交易流水\n银联消费\n交易日期\n借方发生额",
    ],
    ["银联交易凭证", "中国工商银行\n银联交易凭证\n商户编号\n交易金额"],
  ])("工商银行%s不得识别为工资卡复印件", (_name, text) => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      text,
    );

    expect(result.documentType).not.toBe("bank_card");
  });

  it("仅有工行开户行和工资卡账号时不得误判为银行卡复印件", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "工资信息登记",
        "开户行：中国工商银行北京分行",
        "工资卡账号：6222030200026339493",
      ].join("\n"),
    );

    expect(result.status).toBe("uncertain");
    expect(result.documentType).toBeNull();
  });

  it("保密协议标题漏识别时根据正文组合确认边界", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "甲乙双方根据有关规定，就甲方商业秘密保密事项达成如下协议：",
        "一、保密内容",
        "甲方的交易秘密、经营秘密和技术秘密",
        "二、保密范围",
      ].join("\n"),
    );

    expect(result.status).toBe("success");
    expect(result.documentType).toBe("nda");
  });

  it("标题区未识别主标题且尚未出现保密范围时仍根据协议结构确认保密协议", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "附件二",
        "甲方：北京羽隶工程咨询有限公司",
        "乙方：员工姓名",
        "甲乙双方就甲方商业秘密保密事项达",
        "成如下协议：",
        "一、保密内容",
        "甲方的交易秘密、经营秘密和技术秘密",
      ].join("\n"),
    );

    expect(result.status).toBe("success");
    expect(result.documentType).toBe("nda");
  });

  it("保密协议主标题优先于正文中出现的个人声明", () => {
    const text = [
      "保密协议",
      "甲乙双方确认保密义务和商业秘密保护范围",
      "个人声明",
      "本人郑重声明并由声明人签字",
    ].join("\n");

    expect(
      classifyEmployeeDocumentPageStartText("员工整套档案.pdf", text)
        .documentType,
    ).toBe("nda");
    expect(
      classifyEmployeeDocumentText("员工整套档案.pdf", text).documentType,
    ).toBe("nda");
  });

  it("保密协议标题漏识别且正文出现个人声明时不得直接归为个人声明", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "甲乙双方根据有关规定达成如下约定",
        "一、保密内容包括商业秘密和技术秘密",
        "二、保密范围及保密义务",
        "个人声明",
        "本人郑重声明以上资料真实有效",
        "特此声明",
        "声明人：员工姓名",
      ].join("\n"),
    );

    expect(result.status).toBe("uncertain");
    expect(result.documentType).toBeNull();
    expect(result.candidateTypes).toEqual(
      expect.arrayContaining(["nda", "declaration"]),
    );
  });

  it("个人声明主标题优先于正文引用的保密协议", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "个人声明",
        "本人谨此声明",
        "本人已阅读保密协议及公司规章制度",
        "特此声明",
        "姓名",
      ].join("\n"),
    );

    expect(result.status).toBe("success");
    expect(result.documentType).toBe("declaration");
  });

  it("个人声明标题漏识别时根据真实扫描正文组合确认边界", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "本人提交的个人资料信息真实有效",
        "本人已阅读公司规章制度",
        "特此声明",
        "姓名",
      ].join("\n"),
    );

    expect(result.status).toBe("success");
    expect(result.documentType).toBe("declaration");
  });

  it("只有多个强正文组合且没有主标题时标记为分类冲突", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "依据保密协议约定，保密内容和保密范围包括商业秘密",
        "本人谨此声明个人资料信息真实有效",
        "特此声明",
        "姓名",
      ].join("\n"),
    );

    expect(result.status).toBe("uncertain");
    expect(result.uncertaintyReason).toBe("ambiguous");
    expect(result.candidateTypes).toEqual(
      expect.arrayContaining(["nda", "declaration"]),
    );
  });

  it("入职申请表正文中的承诺用语不会误归为个人声明", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "个人基本信息",
        "拟入职部门",
        "紧急联系人",
        "姓名",
        "本人承诺以上个人资料信息真实有效",
        "特此声明",
      ].join("\n"),
    );

    expect(result.status).toBe("uncertain");
    expect(result.uncertaintyReason).toBe("ambiguous");
    expect(result.candidateTypes).toEqual(
      expect.arrayContaining(["application", "declaration"]),
    );
  });

  it("支持被拆成相邻两行的个人声明标题", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      "附件三\n个人\n声明\n本人谨此声明\n特此声明\n姓名",
    );

    expect(result.documentType).toBe("declaration");
  });

  it("劳动合同末页列出附件三个人声明时不建立个人声明边界", () => {
    const pageText = [
      "合同编号：YULI-CS023",
      "附件三：个人声明",
      "附件四：公司内部各项规章制度",
      "第三十条 本合同未尽事宜按国家及甲方有关规定执行",
      "第三十一条 本合同一式两份，甲乙双方各执一份",
      "甲方（盖章）",
      "乙方（签字或盖章）",
      "9/9",
    ].join("\n");

    const classification = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      pageText,
    );
    expect(classification.status).toBe("uncertain");
    expect(classification.documentType).toBeNull();
    expect(
      inspectEmployeeDocumentPageBoundaryText(
        "员工整套档案.pdf",
        pageText,
        "image",
      ),
    ).toBeNull();
  });

  it("材料正文提到其他文件时不误判为新边界", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      "员工离职证明（员工联）\n根据劳动合同法第三十七条解除劳动合同",
    );

    expect(result.status).toBe("uncertain");
    expect(
      detectUnsupportedEmployeeDocumentPageStartText(
        "员工离职证明（员工联）\n根据劳动合同法第三十七条解除劳动合同",
      ),
    ).toBe("员工离职证明");
  });

  it("通用资料标题识别为其他材料边界，但合同附件标题不单独拆分", () => {
    expect(
      detectUnsupportedEmployeeDocumentPageStartText(
        "社会保险个人权益记录\n姓名 张三",
      ),
    ).toBe("其他资料：社会保险个人权益记录");
    expect(
      detectUnsupportedEmployeeDocumentPageStartText(
        "附件三：个人声明\n第三十条 本合同未尽事宜",
      ),
    ).toBeNull();
  });

  it("保密协议正文断句成“成如下协议”时不得识别为其他资料标题", () => {
    expect(
      detectUnsupportedEmployeeDocumentPageStartText(
        [
          "附件二",
          "甲乙双方就甲方商业秘密保密事项达",
          "成如下协议：",
          "一、保密内容",
        ].join("\n"),
      ),
    ).toBeNull();
  });

  it("整页固定档案结果优先于标题区通用其他资料结果", () => {
    const fullPageBoundary = {
      kind: "document" as const,
      documentType: "nda" as const,
      label: "保密协议",
      source: "image" as const,
    };
    const titleRegionBoundary = {
      kind: "unsupported" as const,
      documentType: null,
      label: "其他资料：成如下协议",
      source: "image" as const,
      unsupportedEvidence: "generic" as const,
    };

    expect(
      mergeEmployeeDocumentPageBoundaryEvidence([
        fullPageBoundary,
        titleRegionBoundary,
      ]),
    ).toEqual(fullPageBoundary);
  });

  it("整页与标题区识别为不同固定档案时必须返回不确定", () => {
    const result = mergeEmployeeDocumentPageBoundaryEvidence([
      {
        kind: "document",
        documentType: "nda",
        label: "保密协议",
        source: "image",
      },
      {
        kind: "document",
        documentType: "declaration",
        label: "个人声明",
        source: "image",
      },
    ]);

    expect(result?.kind).toBe("uncertain");
    expect(result?.candidateTypes).toEqual(
      expect.arrayContaining(["nda", "declaration"]),
    );
  });

  it("精确首页标题优先于其他识别路次的正文组合", () => {
    expect(
      mergeEmployeeDocumentPageBoundaryEvidence([
        {
          kind: "document",
          documentType: "asset_handover",
          label: "2025年度公司电脑管理办法",
          source: "image",
          pageStartEvidence: "heading",
          headingIndex: 2,
        },
        {
          kind: "document",
          documentType: "application",
          label: "新员工入职申请表",
          source: "image",
          pageStartEvidence: "composite",
        },
      ]),
    ).toMatchObject({
      kind: "document",
      documentType: "asset_handover",
      pageStartEvidence: "heading",
    });
  });

  it("固定档案与明确其他资料冲突时必须停止自动归档", () => {
    const result = mergeEmployeeDocumentPageBoundaryEvidence([
      {
        kind: "document",
        documentType: "contract",
        label: "劳动合同书",
        source: "image",
      },
      {
        kind: "unsupported",
        documentType: null,
        label: "劳动关系其他协议",
        source: "image",
        unsupportedEvidence: "explicit",
      },
    ]);

    expect(result?.kind).toBe("uncertain");
    expect(result?.candidateTypes).toEqual(["contract", "other"]);
  });

  it("通用其他资料标题只有两路结果一致时才允许自动归档", () => {
    const genericBoundary = {
      kind: "unsupported" as const,
      documentType: null,
      label: "其他资料：社会保险个人权益记录",
      source: "image" as const,
      unsupportedEvidence: "generic" as const,
    };

    expect(
      mergeEmployeeDocumentPageBoundaryEvidence([genericBoundary])?.kind,
    ).toBe("uncertain");
    expect(
      mergeEmployeeDocumentPageBoundaryEvidence([
        genericBoundary,
        { ...genericBoundary },
      ]),
    ).toEqual(genericBoundary);
  });

  it("明确的非固定档案仍可单路识别为其他资料", () => {
    const explicitBoundary = {
      kind: "unsupported" as const,
      documentType: null,
      label: "员工离职证明",
      source: "image" as const,
      unsupportedEvidence: "explicit" as const,
    };

    expect(
      mergeEmployeeDocumentPageBoundaryEvidence([explicitBoundary]),
    ).toEqual(explicitBoundary);
  });

  it("横向学历证书标题被拆散时仍按组合特征识别", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "格，准予毕业",
        "专业",
        "证书编号：140731201606000863",
        "学生姓名",
        "业",
        "普通高等学校",
        "科学习，修完教学计划规定的全部课程，成绩合格",
        "证书",
        "中华人民共和国教育部学历证书查询网址",
      ].join("\n"),
    );

    expect(result.documentType).toBe("diploma");
  });

  it("入职申请表中的材料清单不会被当成学历证书首页", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      "新员工入职申请表\n身份证复印件\n学历证书复印件\n工资卡复印件",
    );

    expect(result.documentType).toBe("application");
  });
});
