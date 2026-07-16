import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const EMPLOYEE_DOCUMENT_TYPE_LABELS = {
  invitation: "入职邀请函",
  application: "新员工入职申请表",
  contract: "劳动合同书",
  nda: "保密协议",
  declaration: "个人声明",
  asset_handover: "2025年度公司电脑管理办法",
  id_card: "身份证复印件",
  health_report: "入职体检报告",
  diploma: "学历证书复印件",
  bank_card: "工资卡复印件（中国工商银行）",
  other: "其他",
} as const;

export type EmployeeDocumentType = keyof typeof EMPLOYEE_DOCUMENT_TYPE_LABELS;
export type EmployeeDocumentClassificationSource =
  | "filename"
  | "text"
  | "image";

export interface EmployeeDocumentClassification {
  status: "success" | "uncertain";
  documentType: EmployeeDocumentType | null;
  label: string | null;
  source: EmployeeDocumentClassificationSource | null;
  message: string;
}

export interface EmployeeDocumentPageBoundary {
  kind: "document" | "unsupported" | "none";
  documentType: EmployeeDocumentType | null;
  label: string | null;
  source: "text" | "image" | null;
}

interface ClassificationRule {
  type: EmployeeDocumentType;
  filenamePatterns: RegExp[];
  pageStartPatterns: RegExp[];
  contentPatterns: Array<{ pattern: RegExp; score: number }>;
}

interface ScoredRule {
  type: EmployeeDocumentType;
  filenameScore: number;
  contentScore: number;
  totalScore: number;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    type: "invitation",
    filenamePatterns: [/入职邀请函|邀请函/],
    pageStartPatterns: [/^入职邀请函$/],
    contentPatterns: [
      { pattern: /入职邀请函/, score: 60 },
      { pattern: /年保障薪酬/, score: 12 },
      { pattern: /月保障薪酬|月度税前工资/, score: 12 },
      { pattern: /原则每月发放/, score: 8 },
    ],
  },
  {
    type: "application",
    filenamePatterns: [/新员工入职申请表|入职申请表|员工入职申请/],
    pageStartPatterns: [/^(?:新员工)?入职申请表$/],
    contentPatterns: [
      { pattern: /新员工入职申请表|入职申请表/, score: 60 },
      { pattern: /入职部门|拟入职部门/, score: 8 },
      { pattern: /紧急联系人/, score: 8 },
      { pattern: /个人基本信息/, score: 8 },
    ],
  },
  {
    type: "contract",
    filenamePatterns: [/劳动合同书|劳动合同/],
    pageStartPatterns: [/^(?:中华人民共和国)?劳动合同书?$/],
    contentPatterns: [
      { pattern: /劳动合同书|劳动合同/, score: 60 },
      { pattern: /合同期限/, score: 8 },
      { pattern: /甲方.{0,30}乙方|乙方.{0,30}甲方/, score: 8 },
      { pattern: /劳动合同法/, score: 8 },
    ],
  },
  {
    type: "nda",
    filenamePatterns: [/保密协议|保密及竞业|竞业限制协议/],
    pageStartPatterns: [
      /^(?:员工)?保密协议$/,
      /^保密及竞业(?:限制)?协议$/,
      /^竞业限制协议$/,
    ],
    contentPatterns: [
      { pattern: /保密协议|保密及竞业|竞业限制协议/, score: 60 },
      { pattern: /保密义务/, score: 10 },
      { pattern: /商业秘密/, score: 10 },
      { pattern: /竞业限制/, score: 10 },
    ],
  },
  {
    type: "declaration",
    filenamePatterns: [/个人声明|员工声明书|个人承诺书/],
    pageStartPatterns: [/^(?:员工)?个人声明$/, /^员工声明书$/, /^个人承诺书$/],
    contentPatterns: [
      { pattern: /个人声明|员工声明书|个人承诺书/, score: 60 },
      { pattern: /本人郑重声明/, score: 18 },
      { pattern: /声明人/, score: 12 },
    ],
  },
  {
    type: "asset_handover",
    filenamePatterns: [
      /2025年度公司电脑管理办法|公司电脑管理办法|电脑管理办法|固定资产交接单/,
    ],
    pageStartPatterns: [
      /^2025年度公司电脑管理办法$/,
      /^公司电脑管理办法$/,
      /^固定资产交接单$/,
      /^笔记本电脑协议书$/,
      /^笔记本电脑交接单$/,
      /^笔记本电脑验收单$/,
    ],
    contentPatterns: [
      {
        pattern: /2025年度公司电脑管理办法|公司电脑管理办法|固定资产交接单/,
        score: 60,
      },
      { pattern: /电脑领用|办公电脑/, score: 12 },
      { pattern: /设备编号|资产编号/, score: 10 },
    ],
  },
  {
    type: "id_card",
    filenamePatterns: [/身份证复印件|身份证/],
    pageStartPatterns: [/^中华人民共和国居民身份证$/],
    contentPatterns: [
      { pattern: /中华人民共和国居民身份证/, score: 60 },
      { pattern: /公民身份号码/, score: 30 },
      { pattern: /签发机关/, score: 8 },
    ],
  },
  {
    type: "health_report",
    filenamePatterns: [/入职体检报告|健康体检报告|健康检查报告|体检报告/],
    pageStartPatterns: [/^(?:入职|健康)?体检报告$/, /^健康检查报告$/],
    contentPatterns: [
      { pattern: /入职体检报告|健康体检报告|健康检查报告|体检报告/, score: 60 },
      { pattern: /体检结论|检查结论/, score: 12 },
      { pattern: /主检医师/, score: 10 },
    ],
  },
  {
    type: "diploma",
    filenamePatterns: [/学历证书|毕业证书|毕业证|学位证书|学位证/],
    pageStartPatterns: [/^毕业证书$/, /^学位证书$/, /^普通高等学校毕业证书$/],
    contentPatterns: [
      { pattern: /学历证书|毕业证书|学位证书/, score: 60 },
      { pattern: /普通高等学校/, score: 18 },
      { pattern: /授予.{0,12}学位/, score: 18 },
      { pattern: /修完.{0,20}课程.{0,12}毕业/, score: 18 },
    ],
  },
  {
    type: "bank_card",
    filenamePatterns: [/工资卡|银行卡|工商银行|工行/],
    pageStartPatterns: [/^中国工商银行(?:股份有限公司)?$|^ICBC$/i],
    contentPatterns: [
      { pattern: /中国工商银行|ICBC/i, score: 18 },
      { pattern: /借记卡|银行卡/, score: 18 },
      { pattern: /卡号/, score: 8 },
    ],
  },
];

function toHalfWidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/g, " ");
}

function normalizeFilename(value: string): string {
  return toHalfWidth(value)
    .replace(/\.pdf$/i, "")
    .replace(/[\s._\-—（）()【】\[\]]+/g, "")
    .toLowerCase();
}

function normalizeContent(value: string): string {
  return toHalfWidth(value).replace(/\s+/g, "").toLowerCase();
}

function normalizePageHeadingLines(value: string): string[] {
  return toHalfWidth(value)
    .split(/\r?\n/)
    .map((line) => normalizeContent(line).replace(/[：:，,。；;（）()]/g, ""))
    .filter(Boolean)
    .slice(0, 16);
}

function uncertainClassification(): EmployeeDocumentClassification {
  return {
    status: "uncertain",
    documentType: null,
    label: null,
    source: null,
    message: "无法确定文件类型，请使用对应文档行的上传入口手动归档",
  };
}

export function classifyEmployeeDocumentText(
  originalFileName: string,
  firstPageText = "",
): EmployeeDocumentClassification {
  const normalizedFilename = normalizeFilename(originalFileName);
  const normalizedContent = normalizeContent(firstPageText);

  const scoredRules: ScoredRule[] = CLASSIFICATION_RULES.map((rule) => {
    const filenameScore = rule.filenamePatterns.some((pattern) =>
      pattern.test(normalizedFilename),
    )
      ? 40
      : 0;
    const contentScore = rule.contentPatterns.reduce(
      (score, item) =>
        score + (item.pattern.test(normalizedContent) ? item.score : 0),
      0,
    );
    return {
      type: rule.type,
      filenameScore,
      contentScore,
      totalScore: filenameScore + contentScore,
    };
  }).sort((left, right) => right.totalScore - left.totalScore);

  const best = scoredRules[0];
  const second = scoredRules[1];
  if (!best || best.totalScore === 0) return uncertainClassification();

  const hasUniqueFilenameMatch =
    best.filenameScore > 0 &&
    scoredRules.filter((item) => item.filenameScore > 0).length === 1;
  const hasStrongContentMatch = best.contentScore >= 30;
  const hasClearLead = best.totalScore - (second?.totalScore ?? 0) >= 10;

  if (
    (!hasUniqueFilenameMatch && !hasStrongContentMatch) ||
    (!hasClearLead && !hasUniqueFilenameMatch)
  ) {
    return uncertainClassification();
  }

  const source: EmployeeDocumentClassificationSource =
    best.contentScore >= 60 || best.filenameScore === 0 ? "text" : "filename";
  const label = EMPLOYEE_DOCUMENT_TYPE_LABELS[best.type];
  return {
    status: "success",
    documentType: best.type,
    label,
    source,
    message: `已识别为${label}`,
  };
}

export function classifyEmployeeDocumentPageStartText(
  originalFileName: string,
  pageText: string,
): EmployeeDocumentClassification {
  const normalizedFilename = normalizeFilename(originalFileName);
  const normalizedContent = normalizeContent(pageText);
  const headingLines = normalizePageHeadingLines(pageText);

  const hasCompositePageStart = (type: EmployeeDocumentType): boolean => {
    if (type === "id_card") {
      return (
        /居民身份证/.test(normalizedContent) &&
        /公民身份号码|签发机关/.test(normalizedContent)
      );
    }
    if (type === "bank_card") {
      return (
        /中国工商银行|icbc/.test(normalizedContent) &&
        /借记卡/.test(normalizedContent)
      );
    }
    if (type === "diploma") {
      return (
        /普通高等学校/.test(normalizedContent) &&
        /证书编号|准予毕业|学历证书查询网址|修完.{0,30}课程/.test(
          normalizedContent,
        )
      );
    }
    return false;
  };

  const scoredRules = CLASSIFICATION_RULES.map((rule) => {
    const startMatched =
      rule.pageStartPatterns.some((pattern) =>
        headingLines.some((line) => pattern.test(line)),
      ) || hasCompositePageStart(rule.type);
    const filenameScore = rule.filenamePatterns.some((pattern) =>
      pattern.test(normalizedFilename),
    )
      ? 5
      : 0;
    const contentScore = Math.min(
      40,
      rule.contentPatterns.reduce(
        (score, item) =>
          score + (item.pattern.test(normalizedContent) ? item.score : 0),
        0,
      ),
    );
    return {
      type: rule.type,
      startMatched,
      totalScore: (startMatched ? 100 : 0) + filenameScore + contentScore,
    };
  })
    .filter((item) => item.startMatched)
    .sort((left, right) => right.totalScore - left.totalScore);

  const best = scoredRules[0];
  const second = scoredRules[1];
  if (!best || (second && best.totalScore - second.totalScore < 10)) {
    return uncertainClassification();
  }

  const label = EMPLOYEE_DOCUMENT_TYPE_LABELS[best.type];
  return {
    status: "success",
    documentType: best.type,
    label,
    source: "text",
    message: `已识别为${label}`,
  };
}

export function detectUnsupportedEmployeeDocumentPageStartText(
  pageText: string,
): string | null {
  const headingLines = normalizePageHeadingLines(pageText);
  const rules: Array<{ label: string; patterns: RegExp[] }> = [
    {
      label: "员工离职证明",
      patterns: [
        /^员工离职证明(?:员工联|单位联)?$/,
        /^离职证明$/,
        /^解除劳动关系证明$/,
      ],
    },
    {
      label: "职业资格材料",
      patterns: [
        /^(?:一级|二级)?建造师$/,
        /^(?:中华人民共和国)?(?:一级|二级)?建造师注册证书$/,
        /^(?:一级|二级)?建造师执业资格证书$/,
        /^执业资格证书$/,
        /^专业技术资格证书$/,
        /^岗位证书$/,
        /^职称证书$/,
      ],
    },
  ];

  for (const rule of rules) {
    if (
      rule.patterns.some((pattern) =>
        headingLines.some((line) => pattern.test(line)),
      )
    ) {
      return rule.label;
    }
  }

  const genericTitle = headingLines.find(
    (line, index) =>
      index < 10 &&
      line.length >= 2 &&
      line.length <= 40 &&
      !/^附件/.test(line) &&
      /(?:证明|证书|报告|登记表|申请表|协议书?|确认书|承诺书|通知书|情况说明|复印件|回执|凭证|记录)$/.test(
        line,
      ),
  );
  if (genericTitle) return `其他资料：${genericTitle}`;

  return null;
}

function isValidPdf(pdfPath: string): boolean {
  if (!fs.existsSync(pdfPath)) return false;
  const header = Buffer.alloc(5);
  const fileDescriptor = fs.openSync(pdfPath, "r");
  try {
    fs.readSync(fileDescriptor, header, 0, 5, 0);
  } finally {
    fs.closeSync(fileDescriptor);
  }
  return header.toString("ascii") === "%PDF-";
}

async function extractPdfPageText(
  pdfPath: string,
  pageNumber: number,
): Promise<string> {
  const result = (await execFileAsync(
    "pdftotext",
    [
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      "-layout",
      pdfPath,
      "-",
    ],
    { timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
  )) as { stdout: string };
  return result.stdout || "";
}

async function recognizePdfPageImage(
  pdfPath: string,
  pageNumber: number,
  dpi: number,
): Promise<string> {
  const outputPrefix = `${pdfPath}-document-classify-${process.pid}-${Date.now()}-${pageNumber}-${dpi}`;
  const imagePath = `${outputPrefix}.png`;

  try {
    await execFileAsync(
      "pdftoppm",
      [
        "-png",
        "-singlefile",
        "-r",
        String(dpi),
        "-f",
        String(pageNumber),
        "-l",
        String(pageNumber),
        pdfPath,
        outputPrefix,
      ],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
    );
    if (!fs.existsSync(imagePath)) throw new Error("档案第一页转图片失败");
    const { callPaddleOcr } = await import("./ocrDaemon.js");
    return await callPaddleOcr(imagePath);
  } finally {
    try {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    } catch {
      /* 忽略临时文件清理失败 */
    }
  }
}

export async function detectEmployeeDocumentPageBoundary(
  pdfPath: string,
  originalFileName: string,
  pageNumber: number,
): Promise<EmployeeDocumentPageBoundary> {
  const inspectText = (
    text: string,
    source: "text" | "image",
  ): EmployeeDocumentPageBoundary | null => {
    const classification = classifyEmployeeDocumentPageStartText(
      originalFileName,
      text,
    );
    if (classification.status === "success" && classification.documentType) {
      return {
        kind: "document",
        documentType: classification.documentType,
        label: classification.label,
        source,
      };
    }

    const unsupportedLabel =
      detectUnsupportedEmployeeDocumentPageStartText(text);
    if (unsupportedLabel) {
      return {
        kind: "unsupported",
        documentType: null,
        label: unsupportedLabel,
        source,
      };
    }
    return null;
  };

  try {
    const text = await extractPdfPageText(pdfPath, pageNumber);
    if (text.trim()) {
      const boundary = inspectText(text, "text");
      if (boundary) return boundary;
    }
  } catch {
    console.warn(`人事档案第${pageNumber}页文字层提取失败，改用图片识别`);
  }

  const dpi = 220;
  try {
    const recognizedText = await recognizePdfPageImage(
      pdfPath,
      pageNumber,
      dpi,
    );
    const boundary = inspectText(recognizedText, "image");
    if (boundary) return boundary;
  } catch {
    console.warn(`人事档案第${pageNumber}页图片识别失败，分辨率：${dpi}`);
  }

  return { kind: "none", documentType: null, label: null, source: null };
}

export async function classifyEmployeeDocument(
  pdfPath: string,
  originalFileName: string,
): Promise<EmployeeDocumentClassification> {
  if (!isValidPdf(pdfPath)) {
    return {
      ...uncertainClassification(),
      message: "上传文件不是有效的PDF文件",
    };
  }

  let extractedText = "";
  try {
    extractedText = await extractPdfPageText(pdfPath, 1);
    if (extractedText.trim()) {
      const classification = classifyEmployeeDocumentText(
        originalFileName,
        extractedText,
      );
      if (classification.status === "success") return classification;
    }
  } catch {
    console.warn("人事档案文字层提取失败，改用图片识别");
  }

  for (const dpi of [300, 600]) {
    try {
      const recognizedText = await recognizePdfPageImage(pdfPath, 1, dpi);
      const classification = classifyEmployeeDocumentText(
        originalFileName,
        `${extractedText}\n${recognizedText}`,
      );
      if (classification.status === "success") {
        return classification.source === "text"
          ? { ...classification, source: "image" }
          : classification;
      }
    } catch {
      console.warn(`人事档案图片识别失败，分辨率：${dpi}`);
    }
  }

  return classifyEmployeeDocumentText(originalFileName, extractedText);
}
