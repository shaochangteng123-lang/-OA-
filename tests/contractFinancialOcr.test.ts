import fs from "fs";
import os from "os";
import path from "path";

jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcr: jest.fn(),
  callPaddleOcrDetailed: jest.fn(),
}));

jest.mock("../server/services/tesseractOcrDaemon", () => ({
  callTesseractOcrDetailed: jest.fn(),
}));

jest.mock("../server/services/contractFinancialEvidence", () => ({
  extractContractFinancialPdfFirstPageTextLayer: jest.fn(),
  getContractFinancialPdfPageCount: jest.fn(),
  renderContractFinancialPdfFirstPage: jest.fn(),
}));

jest.mock("../server/services/localOcr", () => {
  const actual = jest.requireActual("../server/services/localOcr");
  return { ...actual, extractInvoiceFromXml: jest.fn() };
});

import {
  classifyInvoiceLineExpense,
  detectContractFinancialFileFormat,
  recognizeContractFinancialDocument,
  recognizeContractFinancialDocuments,
} from "../server/services/contractFinancialOcr";
import {
  extractContractFinancialPdfFirstPageTextLayer,
  getContractFinancialPdfPageCount,
  renderContractFinancialPdfFirstPage,
} from "../server/services/contractFinancialEvidence";
import { extractInvoiceFromXml } from "../server/services/localOcr";
import { extractInvoiceLineItemsFromPositionedText } from "../server/services/localOcr";
import { callPaddleOcrDetailed } from "../server/services/ocrDaemon";
import { callTesseractOcrDetailed } from "../server/services/tesseractOcrDaemon";

const COMPANY_NAME = "北京羽隶工程咨询有限公司";
const COMPANY_TAX_ID = "91110116MA01G3U20C";
const TECHNOLOGY_NAME = "北京羽隶科技有限公司";
const TECHNOLOGY_TAX_ID = "91110116MA01BN342Y";
const COMPANY_BANK_ACCOUNTS = [
  "0200066019025904086",
  "0200303519000018418",
] as const;
const COMPANY_CONTEXT = {
  companyNames: [COMPANY_NAME],
  companyTaxIds: [COMPANY_TAX_ID],
  companyBankAccounts: COMPANY_BANK_ACCOUNTS,
};
const GROUP_COMPANY_CONTEXT = {
  companySubjects: [
    { name: COMPANY_NAME, taxId: COMPANY_TAX_ID },
    { name: TECHNOLOGY_NAME, taxId: TECHNOLOGY_TAX_ID },
  ],
};

function ocrResult(text: string, confidence = 0.99) {
  return {
    fullText: text,
    confidence: confidence <= 1 ? confidence * 100 : confidence,
    modelVersion: "v6_medium",
    lines: text
      .split("\n")
      .filter(Boolean)
      .map((line) => ({
        text: line,
        confidence,
        box: [],
        modelVersion: "v6_medium",
      })),
  };
}

function positionedLine(
  text: string,
  left: number,
  top: number,
  width = 180,
  height = 30,
) {
  return {
    text,
    confidence: 0.99,
    box: [
      [left, top],
      [left + width, top],
      [left + width, top + height],
      [left, top + height],
    ],
  };
}

function normalInvoiceText(amount = "95,000.00"): string {
  return `
电子发票（增值税普通发票）
发票号码：25112000000219908437
开票日期：2025年10月15日
购买方信息
名称：国网北京市电力公司
统一社会信用代码/纳税人识别号：91110000101112000A
销售方信息
名称：北京羽隶工程咨询有限公司
统一社会信用代码/纳税人识别号：91110116MA01G3U20C
项目名称：技术服务
税额：5377.36
价税合计（小写）¥${amount}
`;
}

function normalReceiptText(): string {
  return `
中国工商银行 网上银行电子回单
状态：未作废
电子回单号码：0917-8226-7633-1100
付款人 户名 国网北京市电力公司
账号 0200049609201258271
收款人 户名 北京羽隶工程咨询有限公司
账号 0200066019025904086
金额（小写）：¥95,000.00
币种：人民币
交易时间：2025-12-10 10:28:05
交易流水号：92087313110
`;
}

describe("合同财务凭证独立识别服务", () => {
  let temporaryDirectory = "";
  let consoleSpy: jest.SpyInstance;
  let renderCleanup: jest.Mock;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "contract-financial-ocr-"),
    );
    jest.clearAllMocks();
    renderCleanup = jest.fn().mockResolvedValue(undefined);
    (renderContractFinancialPdfFirstPage as jest.Mock).mockResolvedValue({
      imagePath: "/tmp/mock-financial-page.png",
      pageCount: 1,
      cleanup: renderCleanup,
    });
    (getContractFinancialPdfPageCount as jest.Mock).mockResolvedValue(1);
    (extractInvoiceFromXml as jest.Mock).mockResolvedValue(null);
    (
      extractContractFinancialPdfFirstPageTextLayer as jest.Mock
    ).mockResolvedValue(normalInvoiceText());
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText()),
    );
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("按坐标逐条拆分跨行项目名称、不含税金额、税额和含税金额", () => {
    const lines = extractInvoiceLineItemsFromPositionedText([
      { top: 230, left: 70, width: 54, text: "项目名称" },
      { top: 230, left: 181, width: 54, text: "规格型号" },
      { top: 230, left: 503, width: 41, text: "单价" },
      { top: 230, left: 613, width: 41, text: "金额" },
      { top: 230, left: 671, width: 74, text: "税率/征收率" },
      { top: 230, left: 833, width: 41, text: "税额" },
      { top: 246, left: 24, width: 146, text: "*企业管理服务*物业管理" },
      { top: 266, left: 24, width: 14, text: "费" },
      { top: 246, left: 604, width: 47, text: "17320.75" },
      { top: 246, left: 833, width: 41, text: "1039.25" },
      { top: 285, left: 24, width: 65, text: "*供电*电费" },
      { top: 285, left: 617, width: 34, text: "188.88" },
      { top: 285, left: 846, width: 28, text: "24.56" },
      { top: 305, left: 24, width: 146, text: "*企业管理服务*系统维护" },
      { top: 324, left: 24, width: 14, text: "费" },
      { top: 305, left: 623, width: 28, text: "41.58" },
      { top: 305, left: 852, width: 22, text: "2.50" },
      { top: 402, left: 91, width: 14, text: "合" },
      { top: 402, left: 158, width: 14, text: "计" },
    ]);

    expect(lines).toEqual([
      {
        itemName: "*企业管理服务*物业管理费",
        netAmount: 17320.75,
        taxAmount: 1039.25,
        grossAmount: 18360,
      },
      {
        itemName: "*供电*电费",
        netAmount: 188.88,
        taxAmount: 24.56,
        grossAmount: 213.44,
      },
      {
        itemName: "*企业管理服务*系统维护费",
        netAmount: 41.58,
        taxAmount: 2.5,
        grossAmount: 44.08,
      },
    ]);
  });

  it.each([
    ["*经营租赁*租金", "rent", true],
    ["*生产生活服务*房屋租赁", "rent", true],
    ["*企业管理服务*物业管理费", "property_management", true],
    ["*供电*电费", "electricity", false],
    ["*企业管理服务*系统维护费", "system_maintenance", false],
    ["*其他服务*门禁卡工本费", "other_cost", false],
  ])("按实际业务名称分类%s", (itemName, category, included) => {
    expect(classifyInvoiceLineExpense(itemName)).toMatchObject({
      expenseCategory: category,
      includeInContractAccounting: included,
      recognitionStatus: "verified",
    });
  });

  it("项目名称缺失时保持待核对而不是静默归入其他成本", () => {
    expect(classifyInvoiceLineExpense("*企业管理服务*")).toEqual({
      expenseCategory: "pending_review",
      includeInContractAccounting: false,
      recognitionStatus: "pending_review",
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  function writeFile(name: string, bytes: Buffer): string {
    const filePath = path.join(temporaryDirectory, name);
    fs.writeFileSync(filePath, bytes);
    return filePath;
  }

  function writePdf(name = "凭证.pdf"): string {
    return writeFile(name, Buffer.from("%PDF-1.7\n%%EOF\n"));
  }

  function writeJpeg(name = "凭证.jpg"): string {
    return writeFile(name, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]));
  }

  function writePng(name = "凭证.png"): string {
    return writeFile(
      name,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }

  it("按真实文件头识别 PDF、JPEG 和 PNG，不相信扩展名", async () => {
    const pdf = writePdf("错误扩展名.bin");
    const jpeg = writeJpeg("回单.dat");
    const png = writePng("发票.unknown");
    const invalid = writeFile("伪造.pdf", Buffer.from("not-a-document"));

    await expect(detectContractFinancialFileFormat(pdf)).resolves.toBe("pdf");
    await expect(detectContractFinancialFileFormat(jpeg)).resolves.toBe("jpeg");
    await expect(detectContractFinancialFileFormat(png)).resolves.toBe("png");
    await expect(
      detectContractFinancialFileFormat(invalid),
    ).resolves.toBeNull();
  });

  it("完整识别 PNG 发票并按公司主体判定销项", async () => {
    const filePath = writePng("文件名金额￥1且标成作废.png");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText()),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(callTesseractOcrDetailed).toHaveBeenCalledWith(
      filePath,
      expect.objectContaining({ preserveInterwordSpaces: true }),
    );
    expect(result).toMatchObject({
      kind: "invoice",
      format: "png",
      documentStatus: "normal",
      direction: "output",
      validationStatus: "verified",
      canAutoPost: true,
      blockingReasons: [],
    });
    if (result.kind !== "invoice") throw new Error("凭证类型错误");
    expect(result.fields).toMatchObject({
      buyer: "国网北京市电力公司",
      seller: COMPANY_NAME,
      itemName: "技术服务",
      invoiceNumber: "25112000000219908437",
      invoiceDate: "2025-10-15",
      amount: 95000,
      taxAmount: 5377.36,
    });
    expect(result.recognition?.textSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("发票上传缺少可见页面顶部发票标题时按文件类型失败关闭", async () => {
    const filePath = writePng("实际不是发票.png");
    const text = normalInvoiceText().replace(
      "电子发票（增值税普通发票）",
      "费用结算明细",
    );
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result).toMatchObject({
      validationStatus: "failed",
      canAutoPost: false,
      failureKind: "document",
      blockingReasons: [
        expect.objectContaining({
          code: "INVOICE_DOCUMENT_TYPE_MISMATCH",
          message: "此不是有效发票",
        }),
      ],
    });
  });

  it("正文末尾提及发票不能替代可见页面顶部发票标题", async () => {
    const filePath = writePng("费用说明.png");
    const text = [
      "费用结算明细",
      "客户名称：国网北京市电力公司",
      "供应商：北京羽隶工程咨询有限公司",
      "项目一",
      "项目二",
      "项目三",
      "项目四",
      "项目五",
      "项目六",
      "项目七",
      "请另行提供电子发票",
    ].join("\n");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.blockingReasons).toEqual([
      expect.objectContaining({ code: "INVOICE_DOCUMENT_TYPE_MISMATCH" }),
    ]);
  });

  it("购销双方同行坐标纵向相差 2 像素时仍按左购右销排序", async () => {
    const filePath = writePng("购销双方微小错行.png");
    const text = normalInvoiceText();
    const lines = [
      positionedLine(`名称：${COMPANY_NAME}`, 620, 198, 260),
      positionedLine("名称：国网北京市电力公司", 80, 200, 250),
      positionedLine(`纳税人识别号：${COMPANY_TAX_ID}`, 620, 238, 300),
      positionedLine("纳税人识别号：91110000101112000A", 80, 240, 300),
    ];
    const recognition = {
      ...ocrResult(text),
      lines,
    };
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(recognition);
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(recognition);

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.direction).toBe("output");
    expect(result.canAutoPost).toBe(true);
    if (result.kind !== "invoice") throw new Error("凭证类型错误");
    expect(result.fields.buyer).toBe("国网北京市电力公司");
    expect(result.fields.seller).toBe(COMPANY_NAME);
  });

  it("按真实老式发票上下分区坐标恢复购销方、税号和税额", async () => {
    const filePath = writePng("老式增值税发票.png");
    const text = `
增值税专用发票
发票代码：1100203130
发票号码：20596979
开票日期：2021年11月11日
购
名称：国网北京市电力公司
买
纳税人识别号：911100008013656325
方
金额
税率
税额
项目名称：技术咨询费
80188.68
6%
4811.32
价税合计（小写）￥85000.00
销
名称：北京羽隶工程咨询有限公司
售
纳税人识别号：91110116MA01G3U20C
方
`;
    const oldInvoiceRecognition = {
      fullText: text,
      confidence: 99,
      modelVersion: "v6_medium",
      lines: [
        positionedLine("增值税专用发票", 800, 100),
        positionedLine("发票代码：1100203130", 1500, 90),
        positionedLine("发票号码：20596979", 1500, 130),
        positionedLine("开票日期：2021年11月11日", 1500, 175),
        positionedLine("名称：国网北京市电力公司", 130, 335, 300),
        positionedLine("纳税人识别号：911100008013656325", 130, 375, 360),
        positionedLine("金额", 1460, 535, 60),
        positionedLine("税率", 1660, 535, 60),
        positionedLine("税额", 1860, 535, 60),
        positionedLine("80188.68", 1515, 580, 110),
        positionedLine("6%", 1720, 580, 40),
        positionedLine("4811.32", 1925, 580, 100),
        positionedLine("￥80188.68", 1445, 985, 120),
        positionedLine("¥4811.32", 1880, 985, 110),
        positionedLine("价税合计（小写）￥85000.00", 160, 1040, 500),
        positionedLine("名称：北京羽隶工程咨询有限公司", 130, 1150, 350),
        positionedLine("纳税人识别号：91110116MA01G3U20C", 130, 1190, 370),
      ],
    };
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      oldInvoiceRecognition,
    );
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(
      oldInvoiceRecognition,
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.canAutoPost).toBe(true);
    if (result.kind !== "invoice") throw new Error("凭证类型错误");
    expect(result.fields).toMatchObject({
      invoiceNumber: "20596979",
      invoiceDate: "2021-11-11",
      amount: 85000,
      taxAmount: 4811.32,
      itemName: expect.any(String),
      buyer: "国网北京市电力公司",
      seller: COMPANY_NAME,
    });
  });

  it("真实数电发票完整保留票面开票名称且备注电话不触发红字", async () => {
    const filePath = writePdf("2-发票26112000002431081771-20260615_104500.pdf");
    const text = `
电子发票（增值税专用发票）                 发票号码：26112000002431081771
                                            开票日期：2026年06月15日
购 名称：国网北京市电力公司                 销 名称：北京羽隶工程咨询有限公司
买                                           售
方                                           方
信 统一社会信用代码/纳税人识别号：911100008013656325  信 统一社会信用代码/纳税人识别号：91110116MA01G3U20C
息                                           息
项目名称 规格型号 单 位 数 量 单价 金额 税率/征收率 税额
*生产生活服务*技术咨询             1 98584.9056603774 98584.91 6% 5915.09
费
合 计                              ¥98584.91               ¥5915.09
价税合计（大写）壹拾万零肆仟伍佰圆整 （小写）¥104500.00
工程地点：北京市朝阳区
工程名称：柳芳110千伏输变电工程
国网北京市电力公司朝阳供电公司010-63232956
开票人：吴静雯
`;
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));
    (
      extractContractFinancialPdfFirstPageTextLayer as jest.Mock
    ).mockResolvedValue(text);

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });
    expect(result).toMatchObject({
      documentStatus: "normal",
      direction: "output",
      validationStatus: "verified",
      canAutoPost: true,
      blockingReasons: [],
    });
    if (result.kind !== "invoice") throw new Error("凭证类型错误");
    expect(result.fields).toEqual({
      buyer: "国网北京市电力公司",
      seller: COMPANY_NAME,
      itemName: "*生产生活服务*技术咨询费",
      invoiceNumber: "26112000002431081771",
      invoiceDate: "2026-06-15",
      amount: 104500,
      taxAmount: 5915.09,
      lineItems: [],
    });
  });

  it("PDF 发票使用结构化结果与图像结果交叉校验，金额冲突时阻断", async () => {
    const filePath = writePdf();
    (
      extractContractFinancialPdfFirstPageTextLayer as jest.Mock
    ).mockResolvedValue(normalInvoiceText());
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText("90,000.00")),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.validationStatus).toBe("blocked");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "INDEPENDENT_EVIDENCE_CONFLICT" }),
    );
    if (result.kind !== "invoice") throw new Error("凭证类型错误");
    expect(result.fields.amount).toBe(90000);
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
    expect(callPaddleOcrDetailed).toHaveBeenCalledWith(
      "/tmp/mock-financial-page.png",
    );
    expect(renderCleanup).toHaveBeenCalledTimes(1);
  });

  it("PDF 发票只有电子文字层与页面识别全部核心字段一致时才自动通过", async () => {
    const filePath = writePdf("电子发票.pdf");
    const text = normalInvoiceText();
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));
    (
      extractContractFinancialPdfFirstPageTextLayer as jest.Mock
    ).mockResolvedValue(text);

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result).toMatchObject({
      validationStatus: "verified",
      canAutoPost: true,
      blockingReasons: [],
    });
    expect(renderContractFinancialPdfFirstPage).toHaveBeenCalledWith(filePath);
    expect(extractContractFinancialPdfFirstPageTextLayer).toHaveBeenCalledWith(
      filePath,
    );
    expect(renderCleanup).toHaveBeenCalledTimes(1);
  });

  it("字段完整的单页数电票使用坐标快速路径并跳过渲染和图像识别", async () => {
    const filePath = writePdf("单页数电票.pdf");
    (extractInvoiceFromXml as jest.Mock).mockResolvedValue({
      amount: 547.04,
      taxAmount: 57.1,
      date: "2026年08月05日",
      invoiceNumber: "26112000003254160166",
      itemName: "*供电*电费、*生产生活服务*系统维护费",
      seller: COMPANY_NAME,
      sellerTaxId: COMPANY_TAX_ID,
      buyer: "国网北京市电力公司",
      buyerTaxId: "91110000101112000A",
      rawText: `
电子发票（增值税普通发票）
发票号码：26112000003254160166
开票日期：2026年08月05日
购买方：国网北京市电力公司
统一社会信用代码：91110000101112000A
销售方：${COMPANY_NAME}
统一社会信用代码：${COMPANY_TAX_ID}
*供电*电费
*生产生活服务*系统维护
费
税额：57.10
价税合计（小写）¥547.04
`,
      positionedTextNodes: [
        {
          top: 20,
          left: 420,
          width: 180,
          height: 18,
          text: "电子发票（增值税普通发票）",
        },
        { top: 230, left: 70, width: 54, height: 14, text: "项目名称" },
        { top: 230, left: 181, width: 54, height: 14, text: "规格型号" },
        { top: 246, left: 24, width: 65, height: 14, text: "*供电*电费" },
        {
          top: 266,
          left: 24,
          width: 146,
          height: 14,
          text: "*生产生活服务*系统维护",
        },
        { top: 285, left: 24, width: 14, height: 14, text: "费" },
        { top: 402, left: 91, width: 14, height: 14, text: "合" },
        { top: 402, left: 158, width: 14, height: 14, text: "计" },
      ],
    });

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result).toMatchObject({
      validationStatus: "verified",
      canAutoPost: true,
      recognition: { method: "pdf_structured_fast" },
    });
    if (result.kind !== "invoice") throw new Error("凭证类型错误");
    expect(result.fields.itemName).toBe("*供电*电费、*生产生活服务*系统维护费");
    expect(renderContractFinancialPdfFirstPage).not.toHaveBeenCalled();
    expect(callPaddleOcrDetailed).not.toHaveBeenCalled();
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
  });

  it("结构化电子票标题坐标不在顶部时不得作为可信票面布局例外", async () => {
    const filePath = writePdf("结构化标题不在顶部.pdf");
    (extractInvoiceFromXml as jest.Mock).mockResolvedValue({
      amount: 547.04,
      taxAmount: 57.1,
      date: "2026年08月05日",
      invoiceNumber: "26112000003254160166",
      itemName: "*供电*电费、*生产生活服务*系统维护费",
      seller: COMPANY_NAME,
      sellerTaxId: COMPANY_TAX_ID,
      buyer: "国网北京市电力公司",
      buyerTaxId: "91110000101112000A",
      rawText: `电子发票（增值税普通发票）
发票号码：26112000003254160166
开票日期：2026年08月05日
购买方：国网北京市电力公司
统一社会信用代码：91110000101112000A
销售方：${COMPANY_NAME}
统一社会信用代码：${COMPANY_TAX_ID}
*供电*电费
*生产生活服务*系统维护
费
税额：57.10
价税合计（小写）¥547.04`,
      positionedTextNodes: [
        { top: 230, left: 70, width: 54, height: 14, text: "项目名称" },
        { top: 230, left: 181, width: 54, height: 14, text: "规格型号" },
        { top: 246, left: 24, width: 65, height: 14, text: "*供电*电费" },
        {
          top: 266,
          left: 24,
          width: 146,
          height: 14,
          text: "*生产生活服务*系统维护",
        },
        { top: 285, left: 24, width: 14, height: 14, text: "费" },
        { top: 400, left: 70, width: 120, height: 14, text: "价税合计" },
        { top: 1000, left: 420, width: 180, height: 18, text: "电子发票" },
      ],
    });
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult("费用结算明细\n客户：国网北京市电力公司"),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.validationStatus).toBe("failed");
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "INVOICE_DOCUMENT_TYPE_MISMATCH" }),
    );
    expect(renderContractFinancialPdfFirstPage).toHaveBeenCalledWith(filePath);
  });

  it("结构化电子票缺少完整主体字段时必须回到可见页OCR文件类型门禁", async () => {
    const filePath = writePdf("结构化字段缺失.pdf");
    (extractInvoiceFromXml as jest.Mock).mockResolvedValue({
      amount: 95000,
      taxAmount: 5377.36,
      date: "2025年10月15日",
      invoiceNumber: "25112000000219908437",
      itemName: "技术服务",
      seller: COMPANY_NAME,
      sellerTaxId: COMPANY_TAX_ID,
      buyer: "国网北京市电力公司",
      rawText: normalInvoiceText(),
      positionedTextNodes: [
        { top: 20, left: 420, width: 180, height: 18, text: "电子发票" },
      ],
    });
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult("费用结算明细\n客户：国网北京市电力公司"),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(renderContractFinancialPdfFirstPage).toHaveBeenCalledWith(filePath);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "INVOICE_DOCUMENT_TYPE_MISMATCH" }),
    );
  });

  it("可见页面顶部独立发票字样可通过文件类型门禁", async () => {
    const filePath = writePng("顶部独立发票字样.png");
    const text = normalInvoiceText().replace(
      "电子发票（增值税普通发票）",
      "发 票",
    );
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.blockingReasons).not.toContainEqual(
      expect.objectContaining({ code: "INVOICE_DOCUMENT_TYPE_MISMATCH" }),
    );
  });

  it("房屋租赁混合发票逐条分类并只让物业费计入合同核算", async () => {
    const filePath = writePdf("租赁混合发票.pdf");
    (extractInvoiceFromXml as jest.Mock).mockResolvedValue({
      amount: 18617.52,
      taxAmount: 1066.31,
      date: "2025年08月14日",
      invoiceNumber: "25112000000170658338",
      itemName:
        "*企业管理服务*物业管理费、*供电*电费、*企业管理服务*系统维护费",
      seller: "国航物业酒店管理有限公司国航大厦分公司",
      sellerTaxId: "91110105737692857Q",
      buyer: TECHNOLOGY_NAME,
      buyerTaxId: TECHNOLOGY_TAX_ID,
      lineItems: [
        {
          itemName: "*企业管理服务*物业管理费",
          netAmount: 17320.75,
          taxAmount: 1039.25,
          grossAmount: 18360,
        },
        {
          itemName: "*供电*电费",
          netAmount: 188.88,
          taxAmount: 24.56,
          grossAmount: 213.44,
        },
        {
          itemName: "*企业管理服务*系统维护费",
          netAmount: 41.58,
          taxAmount: 2.5,
          grossAmount: 44.08,
        },
      ],
      rawText: `电子发票（增值税专用发票）
发票号码：25112000000170658338
开票日期：2025年08月14日
购买方：${TECHNOLOGY_NAME}
统一社会信用代码：${TECHNOLOGY_TAX_ID}
销售方：国航物业酒店管理有限公司国航大厦分公司
统一社会信用代码：91110105737692857Q
*企业管理服务*物业管理费
*供电*电费
*企业管理服务*系统维护费
税额：1066.31
价税合计（小写）¥18617.52`,
      positionedTextNodes: [
        {
          top: 20,
          left: 420,
          width: 180,
          height: 18,
          text: "电子发票（增值税专用发票）",
        },
        { top: 230, left: 70, width: 54, text: "项目名称" },
        { top: 230, left: 181, width: 54, text: "规格型号" },
        { top: 246, left: 24, width: 146, text: "*企业管理服务*物业管理费" },
        { top: 285, left: 24, width: 65, text: "*供电*电费" },
        { top: 305, left: 24, width: 150, text: "*企业管理服务*系统维护费" },
        { top: 402, left: 91, width: 14, text: "合" },
        { top: 402, left: 158, width: 14, text: "计" },
      ],
    });

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: {
        ...GROUP_COMPANY_CONTEXT,
        contractCompanySubject: {
          name: TECHNOLOGY_NAME,
          taxId: TECHNOLOGY_TAX_ID,
        },
        requireInvoiceLineItems: true,
      },
    });

    expect(result.validationStatus).toBe("verified");
    if (result.kind !== "invoice") throw new Error("凭证类型错误");
    expect(result.fields.lineItems).toEqual([
      expect.objectContaining({
        expenseCategory: "property_management",
        grossAmount: 18360,
        includeInContractAccounting: true,
      }),
      expect.objectContaining({
        expenseCategory: "electricity",
        grossAmount: 213.44,
        includeInContractAccounting: false,
      }),
      expect.objectContaining({
        expenseCategory: "system_maintenance",
        grossAmount: 44.08,
        includeInContractAccounting: false,
      }),
    ]);
  });

  it("房屋租赁发票无法可靠拆分明细时禁止自动入账", async () => {
    const filePath = writePng("无法拆分租赁发票.png");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText()),
    );
    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: { ...COMPANY_CONTEXT, requireInvoiceLineItems: true },
    });
    expect(result.validationStatus).toBe("blocked");
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "INVOICE_LINE_ITEMS_MISSING" }),
    );
  });

  it("车辆租赁明确免税发票无需税额且不进入房屋租赁明细门禁", async () => {
    const filePath = writePdf("小客车租赁免税发票.pdf");
    const itemName = "*经营租赁*其他有形动产免税";
    (extractInvoiceFromXml as jest.Mock).mockResolvedValue({
      amount: 780,
      taxAmount: undefined,
      date: "2026年08月07日",
      invoiceNumber: "26112000003296063971",
      itemName,
      seller: "曾宇",
      sellerTaxId: "110101199001010000",
      buyer: COMPANY_NAME,
      buyerTaxId: COMPANY_TAX_ID,
      lineItems: [],
      rawText: `电子发票（普通发票）
发票号码：26112000003296063971
开票日期：2026年08月07日
购买方：${COMPANY_NAME}
统一社会信用代码：${COMPANY_TAX_ID}
销售方：曾宇
身份证号码：110101199001010000
项目名称：${itemName}
价税合计（小写）¥780.00`,
      positionedTextNodes: [
        {
          top: 20,
          left: 420,
          width: 180,
          height: 18,
          text: "电子发票（普通发票）",
        },
        { top: 230, left: 70, width: 54, text: "项目名称" },
        { top: 246, left: 24, width: 190, text: itemName },
      ],
    });

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: {
        ...COMPANY_CONTEXT,
        contractCompanySubject: {
          name: COMPANY_NAME,
          taxId: COMPANY_TAX_ID,
        },
        allowTaxExemptInvoice: true,
      },
    });

    expect(result.validationStatus).toBe("verified");
    expect(result.blockingReasons).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVOICE_TAX_AMOUNT_MISSING" }),
        expect.objectContaining({ code: "INVOICE_LINE_ITEMS_MISSING" }),
      ]),
    );
    if (result.kind !== "invoice") throw new Error("凭证类型错误");
    expect(result.fields.taxAmount).toBeNull();
    expect(result.fields.lineItems).toEqual([]);
  });

  it("车辆租赁免税票跨行名称与文字层拆字一致时通过双通道复核", async () => {
    const filePath = writePdf("车辆租赁免税票文字层拆字.pdf");
    const primaryText = `
电子发票（普通发票）
发票号码：26112000000297032551
开票日期：2026年01月23日
购买方信息
名称：${COMPANY_NAME}
统一社会信用代码/纳税人识别号：${COMPANY_TAX_ID}
销售方信息
名称：曾宇
统一社会信用代码/纳税人识别号：110108198211094915
项目名称
规格型号
单位
数量
单价
金额
税率/征收率
税额
*经营租赁*其他有形动产
780
780.00
免税
1
***
经营租赁服务*经营租赁
合计 ¥780.00 ***
价税合计（大写）柒佰捌拾圆整 （小写）¥780.00
开票人：曾宇
`;
    const textLayer = `
电子发票（普通发票） 发票号码：26112000000297032551
开票日期：2026年01月23日
购买方信息
名称：${COMPANY_NAME}
统一社会信用代码/纳税人识别号：${COMPANY_TAX_ID}
销售方信息
名称：曾宇
统一社会信用代码/纳税人识别号：110108198211094915
项目名称 规格型号 单 位 数 量 单价 金额 税率/征收率 税额
*经营租 赁 *其 他有形动产 1 780 780.00 免税 ***
经营租 赁 服务 *经营租 赁
合计 ¥780.00 ***
价税合计（大写）柒佰捌拾圆整 （小写）¥780.00
开票人：曾宇
`;
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(primaryText),
    );
    (
      extractContractFinancialPdfFirstPageTextLayer as jest.Mock
    ).mockResolvedValue(textLayer);

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: { ...COMPANY_CONTEXT, allowTaxExemptInvoice: true },
    });

    expect(result).toMatchObject({
      validationStatus: "verified",
      canAutoPost: true,
      blockingReasons: [],
    });
    if (result.kind !== "invoice") throw new Error("凭证类型错误");
    expect(result.fields).toMatchObject({
      itemName: "*经营租赁*其他有形动产经营租赁服务*经营租赁",
      taxAmount: null,
      amount: 780,
    });
  });

  it("坐标字段与电子文字层原文不一致时不得走快速路径", async () => {
    const filePath = writePdf("结构化证据冲突.pdf");
    (extractInvoiceFromXml as jest.Mock).mockResolvedValue({
      amount: 547.04,
      taxAmount: 57.1,
      date: "2026年08月05日",
      invoiceNumber: "26112000003254160166",
      itemName: "*供电*电费",
      seller: COMPANY_NAME,
      sellerTaxId: COMPANY_TAX_ID,
      buyer: "国网北京市电力公司",
      buyerTaxId: "91110000101112000A",
      rawText: normalInvoiceText(),
      positionedTextNodes: [
        { top: 1, left: 1, width: 100, height: 14, text: "电子发票" },
      ],
    });

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.recognition?.method).toBe("pdf_structured_and_paddle");
    expect(renderContractFinancialPdfFirstPage).toHaveBeenCalledWith(filePath);
    expect(callPaddleOcrDetailed).toHaveBeenCalledWith(
      "/tmp/mock-financial-page.png",
    );
  });

  it("PDF 发票没有可用电子文字层时不得用第二图像引擎替代", async () => {
    const filePath = writePdf("扫描发票.pdf");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText()),
    );
    (
      extractContractFinancialPdfFirstPageTextLayer as jest.Mock
    ).mockResolvedValue("");

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "INDEPENDENT_EVIDENCE_MISSING" }),
    );
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
    expect(renderCleanup).toHaveBeenCalledTimes(1);
  });

  it("图片发票缺少第二独立识别通道时保留字段但禁止自动入账", async () => {
    const filePath = writePng("第二通道不可用.png");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText()),
    );
    (callTesseractOcrDetailed as jest.Mock).mockRejectedValue(
      new Error("测试中的独立通道不可用"),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.validationStatus).toBe("blocked");
    expect(result.canAutoPost).toBe(false);
    expect(result.fields.amount).toBe(95000);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "INDEPENDENT_EVIDENCE_MISSING" }),
    );
  });

  it("图片发票两通道金额冲突时不采用第二通道纠错值", async () => {
    const filePath = writePng("两通道冲突.png");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText()),
    );
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText("90,000.00")),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.canAutoPost).toBe(false);
    expect(result.fields.amount).toBe(95000);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "INDEPENDENT_EVIDENCE_CONFLICT" }),
    );
  });

  it("第二通道识别到第一通道缺失税额时也不得反向补值", async () => {
    const filePath = writePng("第一通道缺税额.png");
    const primaryText = normalInvoiceText().replace("税额：5377.36\n", "");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(primaryText),
    );
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText()),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    if (result.kind !== "invoice") throw new Error("凭证类型错误");
    expect(result.fields.taxAmount).toBeNull();
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVOICE_TAX_AMOUNT_MISSING" }),
        expect.objectContaining({ code: "INDEPENDENT_EVIDENCE_MISSING" }),
      ]),
    );
  });

  it.each([
    ["作废", "void", "INVOICE_VOID"],
    ["红字发票\n价税合计（小写）¥-95,000.00", "red", "INVOICE_RED"],
  ])("正文标记%s的发票禁止自动入账", async (marker, status, code) => {
    const filePath = writePng(`${marker}.png`);
    const text = `${normalInvoiceText()}\n${marker}`;
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.documentStatus).toBe(status);
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code }),
    );
  });

  it("正文明确写明未作废、非红字时保持正常，不被关键词误伤", async () => {
    const filePath = writePng("状态说明.png");
    const text = `${normalInvoiceText()}\n发票状态：未作废\n红字标志：否`;
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.documentStatus).toBe("normal");
    expect(result.canAutoPost).toBe(true);
  });

  it("购销双方均不是公司主体时明确为第三方并阻断", async () => {
    const filePath = writePng();
    const text = normalInvoiceText()
      .replaceAll(COMPANY_NAME, "北京第三方技术有限公司")
      .replaceAll(COMPANY_TAX_ID, "91110108MA01OTHER1");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.direction).toBe("third_party");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "INVOICE_THIRD_PARTY" }),
    );
  });

  it("科技公司作为发票购买方时按结构化主体确定为进项", async () => {
    const filePath = writePng("科技公司租赁发票.png");
    const text = normalInvoiceText()
      .replace("国网北京市电力公司", TECHNOLOGY_NAME)
      .replace("91110000101112000A", TECHNOLOGY_TAX_ID)
      .replace(COMPANY_NAME, "国航物业酒店管理有限公司国航大厦分公司")
      .replace(COMPANY_TAX_ID, "91110105737692857Q");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: GROUP_COMPANY_CONTEXT,
    });

    expect(result).toMatchObject({
      direction: "input",
      validationStatus: "verified",
      canAutoPost: true,
    });
  });

  it("科技公司发票不得挂到工程咨询公司签署的合同", async () => {
    const filePath = writePng("跨主体误挂发票.png");
    const text = normalInvoiceText()
      .replace("国网北京市电力公司", TECHNOLOGY_NAME)
      .replace("91110000101112000A", TECHNOLOGY_TAX_ID)
      .replace(COMPANY_NAME, "国航物业酒店管理有限公司国航大厦分公司")
      .replace(COMPANY_TAX_ID, "91110105737692857Q");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: {
        ...GROUP_COMPANY_CONTEXT,
        contractCompanySubject: {
          name: COMPANY_NAME,
          taxId: COMPANY_TAX_ID,
        },
      },
    });

    expect(result.direction).toBe("unknown");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "INVOICE_DIRECTION_UNKNOWN" }),
    );
  });

  it("公司名称与另一主体税号交叉组合时继续阻断", async () => {
    const filePath = writePng("主体交叉发票.png");
    const text = normalInvoiceText()
      .replace("国网北京市电力公司", TECHNOLOGY_NAME)
      .replace("91110000101112000A", COMPANY_TAX_ID)
      .replace(COMPANY_NAME, "国航物业酒店管理有限公司国航大厦分公司")
      .replace(COMPANY_TAX_ID, "91110105737692857Q");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: GROUP_COMPANY_CONTEXT,
    });

    expect(result.direction).toBe("unknown");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "COMPANY_TAX_ID_MISMATCH" }),
        expect.objectContaining({ code: "INVOICE_DIRECTION_UNKNOWN" }),
      ]),
    );
  });

  it("公司名称命中但税号不一致时不得判断发票方向", async () => {
    const filePath = writePng();
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText()),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: {
        companyNames: [COMPANY_NAME],
        companyTaxIds: ["91110116MA01WRONG1"],
      },
    });

    expect(result.direction).toBe("unknown");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "COMPANY_TAX_ID_MISMATCH",
        field: "direction",
      }),
    );
  });

  it("未配置公司税号时即使名称命中也禁止判断发票方向", async () => {
    const filePath = writePng();
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText()),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: { companyNames: [COMPANY_NAME] },
    });

    expect(result.direction).toBe("unknown");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "COMPANY_TAX_ID_NOT_CONFIGURED" }),
    );
  });

  it("公司税号落在非公司名称一侧时按主体组合冲突阻断", async () => {
    const filePath = writePng();
    const text = normalInvoiceText()
      .replace(COMPANY_TAX_ID, "91110108MA01OTHER1")
      .replace("91110000101112000A", COMPANY_TAX_ID);
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result.direction).toBe("unknown");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "COMPANY_TAX_ID_MISMATCH" }),
      ]),
    );
  });

  it.each([
    ["银行回单.pdf", writePdf],
    ["银行回单.jpg", writeJpeg],
    ["银行回单.png", writePng],
  ])("支持%s并识别为回款", async (_name, writer) => {
    const filePath = writer.call(undefined);
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalReceiptText()),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    expect(result).toMatchObject({
      kind: "bank_receipt",
      documentStatus: "normal",
      direction: "receipt",
      validationStatus: "verified",
      canAutoPost: true,
      blockingReasons: [],
    });
    if (result.kind !== "bank_receipt") throw new Error("凭证类型错误");
    expect(callPaddleOcrDetailed).toHaveBeenCalledWith(
      _name.endsWith(".pdf") ? "/tmp/mock-financial-page.png" : filePath,
      "v6_medium",
    );
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
    expect(result.fields).toMatchObject({
      paymentTime: "2025-12-10",
      amount: 95000,
      electronicReceiptNo: "0917-8226-7633-1100",
      payer: "国网北京市电力公司",
      payerAccount: "0200049609201258271",
      payee: COMPANY_NAME,
      payeeAccount: "0200066019025904086",
    });
    expect(Object.keys(result.fields).sort()).toEqual(
      [
        "paymentTime",
        "amount",
        "electronicReceiptNo",
        "payer",
        "payerAccount",
        "payee",
        "payeeAccount",
      ].sort(),
    );
    if (_name.endsWith(".pdf")) {
      expect(callPaddleOcrDetailed).toHaveBeenCalledWith(
        "/tmp/mock-financial-page.png",
        "v6_medium",
      );
      expect(renderCleanup).toHaveBeenCalledTimes(1);
    }
  });

  it("银行回单上传缺少可见页面顶部银行及回单标题时按文件类型失败关闭", async () => {
    const filePath = writePng("实际不是银行回单.png");
    const text = normalReceiptText().replace(
      "中国工商银行 网上银行电子回单",
      "资金结算明细",
    );
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    expect(result).toMatchObject({
      validationStatus: "failed",
      canAutoPost: false,
      failureKind: "document",
      blockingReasons: [
        expect.objectContaining({
          code: "BANK_RECEIPT_DOCUMENT_TYPE_MISMATCH",
          message: "此不是有效回单",
        }),
      ],
    });
  });

  it("正文末尾同时提及银行和回单不能替代顶部银行回单标题", async () => {
    const filePath = writePng("普通付款说明.png");
    const text = [
      "普通付款说明",
      "付款事项一",
      "付款事项二",
      "付款事项三",
      "付款事项四",
      "付款事项五",
      "付款事项六",
      "付款事项七",
      "付款事项八",
      "付款事项九",
      "请联系银行补充正式回单",
    ].join("\n");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    expect(result.blockingReasons).toEqual([
      expect.objectContaining({
        code: "BANK_RECEIPT_DOCUMENT_TYPE_MISMATCH",
      }),
    ]);
  });

  it("收款人是本公司时按回款判断，不依赖公司账号配置", async () => {
    const filePath = writePng();
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalReceiptText()),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: {
        companyNames: [COMPANY_NAME],
        companyBankAccounts: ["9999999999999999999"],
      },
    });

    expect(result.direction).toBe("receipt");
    expect(result.canAutoPost).toBe(true);
    expect(result.blockingReasons).not.toContainEqual(
      expect.objectContaining({ code: "COMPANY_BANK_ACCOUNT_MISMATCH" }),
    );
  });

  it("未配置内部划拨模式时工程咨询向科技的转账仍阻断", async () => {
    const filePath = writePng("内部划拨.png");
    const text = normalReceiptText()
      .replace(COMPANY_NAME, TECHNOLOGY_NAME)
      .replace("国网北京市电力公司", COMPANY_NAME);
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: GROUP_COMPANY_CONTEXT,
    });

    expect(result.direction).toBe("unknown");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "BANK_DIRECTION_UNKNOWN" }),
    );
  });

  it("合同明确配置内部划拨时工程咨询向科技的回单识别为支出", async () => {
    const filePath = writePng("工程划拨科技.png");
    const text = normalReceiptText()
      .replace(COMPANY_NAME, TECHNOLOGY_NAME)
      .replace("国网北京市电力公司", COMPANY_NAME);
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: {
        ...GROUP_COMPANY_CONTEXT,
        contractCompanySubject: {
          name: TECHNOLOGY_NAME,
          taxId: TECHNOLOGY_TAX_ID,
        },
        internalFundingPair: {
          payerName: COMPANY_NAME,
          payeeName: TECHNOLOGY_NAME,
        },
      },
    });

    expect(result).toMatchObject({
      direction: "payment",
      validationStatus: "verified",
      canAutoPost: true,
    });
  });

  it("内部划拨回单收付款方向相反时必须阻断", async () => {
    const filePath = writePng("科技反向划拨工程.png");
    const text = normalReceiptText().replace(
      "国网北京市电力公司",
      TECHNOLOGY_NAME,
    );
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: {
        ...GROUP_COMPANY_CONTEXT,
        contractCompanySubject: {
          name: TECHNOLOGY_NAME,
          taxId: TECHNOLOGY_TAX_ID,
        },
        internalFundingPair: {
          payerName: COMPANY_NAME,
          payeeName: TECHNOLOGY_NAME,
        },
      },
    });

    expect(result.direction).toBe("unknown");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "BANK_DIRECTION_UNKNOWN" }),
    );
  });

  it("科技公司向合同对方付款时识别为资产付款", async () => {
    const filePath = writePng("科技对外付款.png");
    const text = normalReceiptText()
      .replace("国网北京市电力公司", TECHNOLOGY_NAME)
      .replace(COMPANY_NAME, "国航物业酒店管理有限公司国航大厦分公司");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: GROUP_COMPANY_CONTEXT,
    });

    expect(result).toMatchObject({
      direction: "payment",
      validationStatus: "verified",
      canAutoPost: true,
    });
  });

  it("科技公司付款回单不得挂到工程咨询公司签署的合同", async () => {
    const filePath = writePng("跨主体误挂付款.png");
    const text = normalReceiptText()
      .replace("国网北京市电力公司", TECHNOLOGY_NAME)
      .replace(COMPANY_NAME, "国航物业酒店管理有限公司国航大厦分公司");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: {
        ...GROUP_COMPANY_CONTEXT,
        contractCompanySubject: {
          name: COMPANY_NAME,
          taxId: COMPANY_TAX_ID,
        },
      },
    });

    expect(result.direction).toBe("unknown");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "BANK_DIRECTION_UNKNOWN" }),
    );
  });

  it("未配置公司账号时仍按收款人公司户名判断为回款", async () => {
    const filePath = writePng();
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalReceiptText()),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: {
        companyNames: [COMPANY_NAME],
        companyTaxIds: [COMPANY_TAX_ID],
      },
    });

    expect(result.direction).toBe("receipt");
    expect(result.canAutoPost).toBe(true);
    expect(result.blockingReasons).not.toContainEqual(
      expect.objectContaining({ code: "COMPANY_BANK_ACCOUNT_NOT_CONFIGURED" }),
    );
  });

  it("付款人是本公司时按付款判断", async () => {
    const filePath = writePng();
    const paymentText = normalReceiptText()
      .replace("付款人 户名 国网北京市电力公司", `付款人 户名 ${COMPANY_NAME}`)
      .replace(
        "收款人 户名 北京羽隶工程咨询有限公司",
        "收款人 户名 设备供应商有限公司",
      );
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(paymentText),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: { companyNames: [COMPANY_NAME] },
    });

    expect(result.direction).toBe("payment");
    expect(result.canAutoPost).toBe(true);
  });

  it("付款人与收款人同时命中或都未命中本公司时保持方向未知", async () => {
    const filePath = writePng();
    const bothCompanyText = normalReceiptText().replace(
      "付款人 户名 国网北京市电力公司",
      `付款人 户名 ${COMPANY_NAME}`,
    );
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(bothCompanyText),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: { companyNames: [COMPANY_NAME] },
    });

    expect(result.direction).toBe("unknown");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "BANK_DIRECTION_UNKNOWN" }),
    );
  });

  it("按真实工行双栏坐标恢复正文顺序之前的户名和账号", async () => {
    const filePath = writePng("工行双栏回单.png");
    const text = `
中国工商银行
网上银行电子回单
电子回单号码：0905-2670-2903-1100
国网北京市电力公司
北京羽隶工程咨询有限公司
户名
户名
付款
212300490
收款
0200303519000018418
账号
账号
金额
￥95,000.00元
交易流水号
19577446242
时间戳
2025-12-10-10.28.05
记账日期
2025年12月10日
`;
    const bankLayoutRecognition = {
      fullText: text,
      confidence: 99,
      modelVersion: "v6_medium",
      lines: [
        positionedLine("中国工商银行", 490, 44, 320),
        positionedLine("网上银行电子回单", 825, 60, 220),
        positionedLine("电子回单号码：0905-2670-2903-1100", 52, 128, 455),
        positionedLine("国网北京市电力公司", 327, 186, 240),
        positionedLine(COMPANY_NAME, 994, 186, 322),
        positionedLine("户名", 192, 200, 90, 40),
        positionedLine("户名", 863, 200, 90, 40),
        positionedLine("付款", 90, 262, 65),
        positionedLine("212300490", 327, 265, 220),
        positionedLine("收款", 762, 262, 65),
        positionedLine("0200303519000018418", 994, 265, 250),
        positionedLine("账号", 191, 281, 90, 40),
        positionedLine("账号", 862, 281, 90, 40),
        positionedLine("金额", 162, 424, 92, 40),
        positionedLine("￥95,000.00元", 325, 429, 175),
        positionedLine("交易流水号", 137, 563, 140),
        positionedLine("19577446242", 315, 563, 180),
        positionedLine("时间戳", 833, 562, 90),
        positionedLine("2025-12-10-10.28.05", 995, 562, 260),
        positionedLine("记账日期", 1020, 889, 115),
        positionedLine("2025年12月10日", 1160, 891, 200),
      ],
    };
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      bankLayoutRecognition,
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    expect(result.canAutoPost).toBe(true);
    expect(result.direction).toBe("receipt");
    if (result.kind !== "bank_receipt") throw new Error("凭证类型错误");
    expect(result.fields).toMatchObject({
      payer: "国网北京市电力公司",
      payerAccount: "212300490",
      payee: COMPANY_NAME,
      payeeAccount: "0200303519000018418",
      paymentTime: "2025-12-10",
      amount: 95000,
      electronicReceiptNo: "0905-2670-2903-1100",
    });
    expect(result.blockingReasons).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "FIELD_CONFLICT_PAYERACCOUNT" }),
        expect.objectContaining({ code: "FIELD_CONFLICT_PAYEE" }),
      ]),
    );
  });

  it("工行短横线和点号时间戳统一保留到付款日期", async () => {
    const filePath = writePng("工行点号时间戳回单.png");
    const text = normalReceiptText().replace(
      "交易时间：2025-12-10 10:28:05",
      "时间戳：2025-12-10-09.39.51.123587",
    );
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    if (result.kind !== "bank_receipt") throw new Error("凭证类型错误");
    expect(result.fields.paymentTime).toBe("2025-12-10");
    expect(result.canAutoPost).toBe(true);
  });

  it("交易流水号不能替代电子回单号码，付款时间不得使用记账日期兜底", async () => {
    const filePath = writePng("短流水跨日回单.png");
    const text = normalReceiptText()
      .replace("电子回单号码：0917-8226-7633-1100\n", "")
      .replace("状态：未作废\n", "状态：未作废\n记账日期：2025-12-11\n")
      .replace("交易流水号：92087313110", "交易流水号：4985273");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    if (result.kind !== "bank_receipt") throw new Error("凭证类型错误");
    expect(result.canAutoPost).toBe(false);
    expect(result.fields).toMatchObject({
      paymentTime: "2025-12-10",
      electronicReceiptNo: "",
    });
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "BANK_ELECTRONIC_RECEIPT_NO_MISSING",
        field: "electronicReceiptNo",
      }),
    );
  });

  it("付款时间缺失时不得使用上传日期或记账日期补值", async () => {
    const filePath = writePng("付款时间缺失.png");
    const text = normalReceiptText()
      .replace("交易时间：2025-12-10 10:28:05\n", "")
      .replace("状态：未作废\n", "状态：未作废\n记账日期：2025-12-11\n");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    if (result.kind !== "bank_receipt") throw new Error("凭证类型错误");
    expect(result.fields.paymentTime).toBe("");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "BANK_PAYMENT_TIME_MISSING",
        field: "paymentTime",
      }),
    );
  });

  it("回单缺电子回单号码或公司方向不明时不得自动入账", async () => {
    const filePath = writeJpeg();
    const text = normalReceiptText()
      .replace("电子回单号码：0917-8226-7633-1100\n", "")
      .replace("交易流水号：92087313110\n", "");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: { companyNames: ["另一家公司"] },
    });

    expect(result.validationStatus).toBe("blocked");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BANK_ELECTRONIC_RECEIPT_NO_MISSING",
        }),
        expect.objectContaining({ code: "BANK_DIRECTION_UNKNOWN" }),
      ]),
    );
  });

  it("银行回单不调用 Tesseract 且只采用 PP-OCRv6_medium 识别值", async () => {
    const filePath = writePng("账号冲突.png");
    const primaryText = normalReceiptText();
    const independentText = normalReceiptText().replace(
      "0200066019025904086",
      "0200066019025904999",
    );
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(primaryText),
    );
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(independentText),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    if (result.kind !== "bank_receipt") throw new Error("凭证类型错误");
    expect(result.fields.payeeAccount).toBe("0200066019025904086");
    expect(result.canAutoPost).toBe(true);
    expect(result.blockingReasons).toEqual([]);
    expect(result.recognition?.method).toBe("paddle_ocr");
    expect(callPaddleOcrDetailed).toHaveBeenCalledWith(filePath, "v6_medium");
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
  });

  it("银行回单不依赖 Tesseract 可用性", async () => {
    const filePath = writeJpeg("独立识别不可用.jpg");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalReceiptText()),
    );
    (callTesseractOcrDetailed as jest.Mock).mockRejectedValue(
      new Error("测试中的独立通道不可用"),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    expect(result.canAutoPost).toBe(true);
    expect(result.blockingReasons).toEqual([]);
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
  });

  it("银行回单工作进程返回非第六版模型时安全阻断", async () => {
    const filePath = writePng("错误模型版本.png");
    const resultFromWrongModel = ocrResult(normalReceiptText());
    resultFromWrongModel.modelVersion = "v4_mobile";
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      resultFromWrongModel,
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "BANK_OCR_MODEL_MISMATCH" }),
    );
    expect(callPaddleOcrDetailed).toHaveBeenCalledWith(filePath, "v6_medium");
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
  });

  it("银行回单存在非第六版逐行模型证据时安全阻断", async () => {
    const filePath = writePng("错误逐行模型版本.png");
    const resultWithWrongLineModel = ocrResult(normalReceiptText());
    resultWithWrongLineModel.lines[0].modelVersion = "v4_mobile";
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      resultWithWrongLineModel,
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "BANK_OCR_MODEL_MISMATCH" }),
    );
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
  });

  it("银行回单不会被未调用的 Tesseract 基础设施状态阻断", async () => {
    const filePath = writeJpeg("独立识别基础设施失败.jpg");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalReceiptText()),
    );
    (callTesseractOcrDetailed as jest.Mock).mockRejectedValue(
      Object.assign(new Error("识别进程暂时不可用"), {
        code: "OCR_INFRASTRUCTURE_ERROR",
      }),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    expect(result).toMatchObject({
      validationStatus: "verified",
      canAutoPost: true,
    });
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
  });

  it("其他识别来源不得补入第六版中型模型缺失的回单号码", async () => {
    const filePath = writePng("第一通道缺号码.png");
    const primaryText = normalReceiptText()
      .replace("电子回单号码：0917-8226-7633-1100\n", "")
      .replace("交易流水号：92087313110\n", "");
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(primaryText),
    );
    (callTesseractOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalReceiptText()),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    if (result.kind !== "bank_receipt") throw new Error("凭证类型错误");
    expect(result.fields.electronicReceiptNo).toBe("");
    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BANK_ELECTRONIC_RECEIPT_NO_MISSING",
        }),
      ]),
    );
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
  });

  it("多页 PDF 银行回单因当前仅识别第一页而不得自动入账", async () => {
    const filePath = writePdf("多页回单.pdf");
    (renderContractFinancialPdfFirstPage as jest.Mock).mockResolvedValue({
      imagePath: "/tmp/mock-financial-page.png",
      pageCount: 2,
      cleanup: renderCleanup,
    });
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalReceiptText()),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: COMPANY_CONTEXT,
    });

    expect(result.canAutoPost).toBe(false);
    expect(result.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "BANK_RECEIPT_PAGE_COUNT_UNSUPPORTED",
        field: "pageCount",
      }),
    );
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
    expect(renderCleanup).toHaveBeenCalledTimes(1);
  });

  it("批量识别按顺序隔离单文件失败且不从文件名读取金额", async () => {
    const valid = writePng("发票-文件名金额￥1.png");
    const invalid = writeFile("回单-20260101￥999999.pdf", Buffer.from("bad"));
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(
      ocrResult(normalInvoiceText()),
    );

    const results = await recognizeContractFinancialDocuments([
      {
        filePath: valid,
        kind: "invoice",
        context: COMPANY_CONTEXT,
      },
      {
        filePath: invalid,
        kind: "bank_receipt",
        context: COMPANY_CONTEXT,
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].result.canAutoPost).toBe(true);
    expect(results[0].result.fields.amount).toBe(95000);
    expect(results[1].result).toMatchObject({
      validationStatus: "failed",
      canAutoPost: false,
      blockingReasons: [
        expect.objectContaining({
          code: "UNSUPPORTED_FINANCIAL_FILE_FORMAT",
        }),
      ],
    });
  });

  it("按招商银行角色标签坐标恢复分离的收付款户名和账号", async () => {
    const filePath = writePng("招商银行出账回单.png");
    const text = `招商银行 出账回单
交易日期：2026年04月30日
付款人：
付款账号：
110933697910902
${TECHNOLOGY_NAME}
收款人：
收款账号：
11001053000056004126
国航物业酒店管理有限公司国航大厦分公司
交易金额（小写）：CNY195.30
回单编号：979B2U1132024`;
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue({
      fullText: text,
      confidence: 99,
      modelVersion: "v6_medium",
      lines: [
        positionedLine("招商银行", 1320, 90, 220),
        positionedLine("出账回单", 650, 110, 220),
        positionedLine("交易日期：2026年04月30日", 120, 220, 360),
        positionedLine("付款账号：", 120, 350, 150),
        positionedLine("110933697910902", 300, 350, 240),
        positionedLine("付款人：", 770, 350, 130),
        positionedLine(TECHNOLOGY_NAME, 930, 350, 330),
        positionedLine("收款账号：", 120, 430, 150),
        positionedLine("11001053000056004126", 300, 430, 300),
        positionedLine("收款人：", 770, 430, 130),
        positionedLine("国航物业酒店管理有限公司国航大厦分公司", 930, 430, 520),
        positionedLine("交易金额（小写）：CNY195.30", 120, 510, 430),
        positionedLine("回单编号：979B2U1132024", 520, 760, 360),
      ],
    });

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "bank_receipt",
      context: {
        ...GROUP_COMPANY_CONTEXT,
        contractCompanySubject: {
          name: TECHNOLOGY_NAME,
          taxId: TECHNOLOGY_TAX_ID,
        },
      },
    });

    expect(result.direction).toBe("payment");
    expect(result.canAutoPost).toBe(true);
    if (result.kind !== "bank_receipt") throw new Error("凭证类型错误");
    expect(result.fields).toMatchObject({
      payer: TECHNOLOGY_NAME,
      payerAccount: "110933697910902",
      payee: "国航物业酒店管理有限公司国航大厦分公司",
      payeeAccount: "11001053000056004126",
      electronicReceiptNo: "979B2U1132024",
      paymentTime: "2026-04-30",
      amount: 195.3,
    });
  });

  it("识别基础设施失败时返回可重试类型供批量检查点识别", async () => {
    const filePath = writePng();
    (callPaddleOcrDetailed as jest.Mock).mockRejectedValue(
      Object.assign(new Error("识别进程暂时不可用"), {
        code: "OCR_INFRASTRUCTURE_ERROR",
      }),
    );

    const result = await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    expect(result).toMatchObject({
      validationStatus: "failed",
      canAutoPost: false,
      failureKind: "infrastructure",
      blockingReasons: [
        expect.objectContaining({
          code: "FINANCIAL_OCR_INFRASTRUCTURE_FAILED",
        }),
      ],
    });
  });

  it("不会把完整凭证正文写入普通日志", async () => {
    const filePath = writePng();
    const text = normalInvoiceText();
    (callPaddleOcrDetailed as jest.Mock).mockResolvedValue(ocrResult(text));

    await recognizeContractFinancialDocument({
      filePath,
      kind: "invoice",
      context: COMPANY_CONTEXT,
    });

    const logged = consoleSpy.mock.calls
      .flat()
      .map((value) => String(value))
      .join("\n");
    expect(logged).not.toContain(text.trim());
  });
});
