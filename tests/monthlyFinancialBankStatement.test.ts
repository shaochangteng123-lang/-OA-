/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";

jest.mock("nanoid", () => ({ nanoid: () => "monthly-bank-test-id" }));
jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcr: jest.fn(),
}));

import {
  MONTHLY_BANK_ACCOUNTS,
  analyzeMonthlyFinancialBankFile,
  classifyMonthlyBankTransaction,
  detectMonthlyBankFileAccount,
  extractMonthlyBankTransactionDates,
  normalizeMonthlyBankAccount,
  normalizeMonthlyBankReceiptNo,
  type MonthlyBankFileAnalysis,
} from "../server/services/monthlyFinancialBankStatement";
import {
  findReceiptWhitespaceSplitPixel,
  recognizeBankReceiptImage,
  splitImage,
} from "../server/services/bankReceiptProcessor";
import { callPaddleOcr } from "../server/services/ocrDaemon";
import { parsePaymentProofText } from "../server/services/paymentProofOcr";

const callPaddleOcrMock = callPaddleOcr as jest.MockedFunction<
  typeof callPaddleOcr
>;

function scannedReceiptText(input: {
  receiptNo?: string;
  serialNo?: string;
  date: string;
  amount: string;
  payerAccount?: string;
  payeeAccount?: string;
}): string {
  return [
    "中国工商银行付款回单",
    input.receiptNo ? `电子回单号码：${input.receiptNo}` : "",
    input.serialNo ? `交易流水号：${input.serialNo}` : "",
    "付款人：北京羽隶工程咨询有限公司",
    `付款账号：${input.payerAccount || MONTHLY_BANK_ACCOUNTS.general.accountNumber}`,
    "收款人：测试收款人",
    `收款账号：${input.payeeAccount || "6212260200012345678"}`,
    `金额（小写）：￥${input.amount}`,
    `交易日期：${input.date}`,
    "备注：基础报销-测试人员-2026年6月",
  ]
    .filter(Boolean)
    .join("\n");
}

function receiptEvidence(overrides: Record<string, unknown> = {}) {
  return {
    pageNo: 1,
    position: "full",
    previewPath: "/tmp/receipt.jpg",
    payer: "北京羽隶工程咨询有限公司",
    payerAccount: "",
    payee: "测试收款人",
    payeeAccount: "",
    amount: 100,
    remark: "",
    proofNo: "HD-001",
    transactionDate: "2026-06-01",
    transactionDateCandidates: ["2026-06-01"],
    rawText: "银行电子回单",
    ...overrides,
  };
}

describe("月度银行回单精确账号与分类规则", () => {
  it("双回单按中部最长留白动态分割并收紧四周白边", async () => {
    const rowInkCounts = new Array<number>(1000).fill(80);
    for (let row = 180; row <= 190; row += 1) rowInkCounts[row] = 0;
    for (let row = 405; row <= 474; row += 1) rowInkCounts[row] = 0;
    for (let row = 700; row <= 712; row += 1) rowInkCounts[row] = 0;
    expect(findReceiptWhitespaceSplitPixel(rowInkCounts, 600, 500)).toBe(440);

    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "monthly-bank-crop-test-"),
    );
    try {
      const sourcePath = path.join(tempDirectory, "page.jpg");
      await sharp(
        Buffer.from(`
          <svg width="600" height="1000" xmlns="http://www.w3.org/2000/svg">
            <rect width="600" height="1000" fill="white" />
            <rect x="30" y="40" width="540" height="340" fill="#111" />
            <rect x="30" y="480" width="540" height="420" fill="#777" />
          </svg>
        `),
      )
        .jpeg({ quality: 96 })
        .toFile(sourcePath);

      const split = await splitImage(
        sourcePath,
        500,
        1000,
        tempDirectory,
        "page1",
        { detectWhitespaceBoundary: true, trimWhitespace: true },
      );
      const topMetadata = await sharp(split.top).metadata();
      const bottomMetadata = await sharp(split.bottom).metadata();
      const topMean = (await sharp(split.top).stats()).channels[0]!.mean;
      const bottomMean = (await sharp(split.bottom).stats()).channels[0]!.mean;

      expect(topMetadata.width).toBeLessThan(600);
      expect(topMetadata.height).toBeLessThan(500);
      expect(bottomMetadata.width).toBeLessThan(600);
      expect(bottomMetadata.height).toBeLessThan(600);
      expect(topMean).toBeLessThan(bottomMean);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("归月只读取交易、付款、转账或时间戳，不采用记账和打印日期", () => {
    expect(
      extractMonthlyBankTransactionDates(
        "记账日期 2026年07月01日 打印日期 2026年07月02日",
      ),
    ).toEqual([]);
    expect(
      extractMonthlyBankTransactionDates(
        "时间戳 2026-06-30-12.20.15.104618 记账日期 2026年07月01日",
      ),
    ).toEqual(["2026-06-30"]);
    expect(
      extractMonthlyBankTransactionDates("打印交易日期：2026-07-02"),
    ).toEqual([]);
  });

  it("完整账号规范化保留前导零，尾号和近似账号均不能识别账户", () => {
    expect(normalizeMonthlyBankAccount(" 0200 3035-1900 0018 418 ")).toBe(
      "0200303519000018418",
    );

    expect(
      detectMonthlyBankFileAccount(
        [receiptEvidence({ payerAccount: "0018418" })] as never,
        "general",
      ),
    ).toBeNull();
    expect(
      detectMonthlyBankFileAccount(
        [
          receiptEvidence({
            payerAccount: "0200303519000018419",
          }),
        ] as never,
        "general",
      ),
    ).toBeNull();
  });

  it("文件名提示与完整账号冲突时，完整账号具有唯一判定权", () => {
    expect(
      detectMonthlyBankFileAccount(
        [
          receiptEvidence({
            payerAccount: MONTHLY_BANK_ACCOUNTS.business.accountNumber,
          }),
        ] as never,
        "general",
      ),
    ).toBe("business");
  });

  it("内部划转同时出现两个系统账号时按付款或收款回单方向判定文件账户", () => {
    const businessAccount = MONTHLY_BANK_ACCOUNTS.business.accountNumber;
    const basicAccount = MONTHLY_BANK_ACCOUNTS.basic.accountNumber;
    const paymentReceipts = [
      receiptEvidence({
        payerAccount: businessAccount,
        payeeAccount: basicAccount,
        rawText: "兴业银行 付款回单",
      }),
      receiptEvidence({
        payerAccount: businessAccount,
        payeeAccount: basicAccount,
        rawText: "兴业银行\n付 款 回 单",
      }),
    ];
    expect(detectMonthlyBankFileAccount(paymentReceipts as never, null)).toBe(
      "business",
    );
    expect(
      detectMonthlyBankFileAccount(
        [
          receiptEvidence({
            payerAccount: businessAccount,
            payeeAccount: basicAccount,
            rawText: "回单编号：202608170110562996",
            sourceSide: "payer",
          }),
        ] as never,
        null,
      ),
    ).toBe("business");
    expect(
      detectMonthlyBankFileAccount(
        [
          receiptEvidence({
            payerAccount: businessAccount,
            payeeAccount: basicAccount,
            rawText: "银行收款回单",
          }),
        ] as never,
        null,
      ),
    ).toBe("basic");
    expect(
      detectMonthlyBankFileAccount(
        [
          receiptEvidence({
            payerAccount: businessAccount,
            payeeAccount: basicAccount,
            rawText: "网上银行电子回单",
          }),
        ] as never,
        null,
      ),
    ).toBeNull();
  });

  it("内部划转优先于备注分类和跨行实时支付字样", () => {
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "outflow",
        true,
        "跨行实时支付；手续费；商务报销；活期存款利息",
      ),
    ).toBe("internal_transfer");
  });

  it("商务账户只统计明确的入账利息和出账手续费", () => {
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "inflow",
        false,
        "活期存款利息",
      ),
    ).toBe("interest");
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "outflow",
        false,
        "跨行手续费",
      ),
    ).toBe("bank_fee");
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "outflow",
        false,
        "跨行实时支付",
      ),
    ).toBe("ignored");
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "outflow",
        false,
        "普通咨询服务费",
      ),
    ).toBe("ignored");
    expect(
      classifyMonthlyBankTransaction("business", "outflow", false, "商务报销"),
    ).toBe("ignored");
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "outflow",
        false,
        "活期存款利息",
      ),
    ).toBe("ignored");
    expect(
      classifyMonthlyBankTransaction("business", "inflow", false, "手续费"),
    ).toBe("ignored");
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "outflow",
        false,
        "用途：普通货款；手续费：0.00",
      ),
    ).toBe("ignored");
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "outflow",
        false,
        "咨询服务手续费",
      ),
    ).toBe("ignored");
  });

  it("基础报销附带手续费文字时仍按基础报销归类", () => {
    expect(
      classifyMonthlyBankTransaction(
        "general",
        "outflow",
        false,
        "备注：基础报销-测试人员-2026年6月；手续费：0.00",
      ),
    ).toBe("basic_reimbursement");
  });

  it("只有明确的存款利息或结息才归入账户利息", () => {
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "inflow",
        false,
        "活期存款利息",
      ),
    ).toBe("interest");
    expect(
      classifyMonthlyBankTransaction("business", "inflow", false, "结息"),
    ).toBe("interest");
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "inflow",
        false,
        "客户偿还借款利息",
      ),
    ).toBe("ignored");
    expect(
      classifyMonthlyBankTransaction(
        "general",
        "inflow",
        false,
        "摘要：利息；利息入账；起息日：2026-03-21；止息日：2026-06-20；利率：0.05%；计息账户：0200303519000018418",
      ),
    ).toBe("interest");
    expect(
      classifyMonthlyBankTransaction(
        "general",
        "inflow",
        false,
        "客户支付逾期利息",
      ),
    ).toBe("unclassified");
    expect(
      classifyMonthlyBankTransaction(
        "general",
        "inflow",
        false,
        "客户借款利息入账",
      ),
    ).toBe("unclassified");
    expect(
      classifyMonthlyBankTransaction(
        "business",
        "inflow",
        false,
        "逾期利息入账",
      ),
    ).toBe("ignored");
  });

  it("基本账户不统计利息、手续费和账户服务费", () => {
    expect(
      classifyMonthlyBankTransaction(
        "basic",
        "inflow",
        false,
        "摘要：利息；利息入账；起息日：2026-03-21；止息日：2026-06-20；利率：0.05%；计息账户：0200049609201258271",
      ),
    ).toBe("ignored");
    expect(
      classifyMonthlyBankTransaction(
        "basic",
        "outflow",
        false,
        "摘要：跨行汇款手续费",
      ),
    ).toBe("ignored");
    expect(
      classifyMonthlyBankTransaction(
        "basic",
        "outflow",
        false,
        "产品名称：企业网上银行；费用名称：企业网银账户半年费；业务种类：对公收费；银行手续费",
      ),
    ).toBe("ignored");
    expect(
      classifyMonthlyBankTransaction(
        "basic",
        "outflow",
        false,
        "摘要：跨行收报；业务种类：对公收费；银行手续费",
      ),
    ).toBe("ignored");
  });

  it("真实六月识别文本基线：一般账户只纳入 103.69 元利息和 18 元手续费", () => {
    const rows = [
      {
        amount: 103.69,
        category: classifyMonthlyBankTransaction(
          "general",
          "inflow",
          false,
          "摘要：利息；利息入账；起息日：2026-03-21；止息日：2026-06-20；利率：0.05%；计息账户：0200303519000018418",
        ),
      },
      {
        amount: 18,
        category: classifyMonthlyBankTransaction(
          "general",
          "outflow",
          false,
          "摘要：跨行汇款手续费；业务种类：对公收费",
        ),
      },
    ];

    expect(rows).toEqual([
      { amount: 103.69, category: "interest" },
      { amount: 18, category: "bank_fee" },
    ]);
  });

  it("真实六月识别文本基线：基本账户排除 53.71 元利息、半年费和跨行收报", () => {
    const rows = [
      {
        amount: 53.71,
        category: classifyMonthlyBankTransaction(
          "basic",
          "inflow",
          false,
          "摘要：利息；利息入账；起息日：2026-03-21；止息日：2026-06-20；利率：0.05%；计息账户：0200049609201258271",
        ),
      },
      {
        amount: 10,
        category: classifyMonthlyBankTransaction(
          "basic",
          "outflow",
          false,
          "摘要：网银注册账户服务费；产品名称：企业网上银行；费用名称：企业网银账户半年费；业务种类：对公收费",
        ),
      },
      {
        amount: 18,
        category: classifyMonthlyBankTransaction(
          "basic",
          "outflow",
          false,
          "摘要：跨行汇款手续费；业务种类：对公收费",
        ),
      },
    ];

    expect(rows).toEqual([
      { amount: 53.71, category: "ignored" },
      { amount: 10, category: "ignored" },
      { amount: 18, category: "ignored" },
    ]);
    expect(rows.filter((row) => row.category === "interest")).toHaveLength(0);
    expect(rows.filter((row) => row.category === "bank_fee")).toHaveLength(0);
    expect(
      Array.from({ length: 9 }, () =>
        classifyMonthlyBankTransaction(
          "basic",
          "inflow",
          true,
          "摘要：跨行收报",
        ),
      ),
    ).toEqual(Array(9).fill("internal_transfer"));
  });

  it("一般账户普通往来不自动猜成主营或资产，明确业务证据才分类", () => {
    expect(
      classifyMonthlyBankTransaction("general", "inflow", false, "普通往来款"),
    ).toBe("unclassified");
    expect(
      classifyMonthlyBankTransaction("general", "outflow", false, "普通往来款"),
    ).toBe("unclassified");
    expect(
      classifyMonthlyBankTransaction(
        "general",
        "inflow",
        false,
        "朝阳公司付羽隶咨询服务首款",
      ),
    ).toBe("main_income");
    expect(
      classifyMonthlyBankTransaction(
        "general",
        "inflow",
        false,
        "跨行收报；银行手续费；朝阳公司项目款",
      ),
    ).toBe("main_income");
    expect(
      classifyMonthlyBankTransaction(
        "general",
        "outflow",
        false,
        "楼门牌采购款",
      ),
    ).toBe("asset_expense");
  });

  it("电子回单号统一全角、大小写、空格和连接符", () => {
    expect(normalizeMonthlyBankReceiptNo(" ａｂ-12 ３／cd_４ ")).toBe(
      "AB123CD4",
    );
  });

  it("缺少电子回单号时不得用交易流水号替代", async () => {
    const rawText = scannedReceiptText({
      serialNo: "TRANS-20260601-001",
      date: "2026-06-01",
      amount: "100.00",
    });
    expect(parsePaymentProofText(rawText).transactionSerialNo).toBe(
      "TRANS-20260601-001",
    );

    callPaddleOcrMock.mockReset();
    callPaddleOcrMock.mockResolvedValueOnce(rawText);
    const recognized = await recognizeBankReceiptImage("mock-receipt.jpg");

    expect(recognized.proofNo).toBe("");
  });

  it("扫描回单基础解析也不得把账户余额当票面金额", async () => {
    callPaddleOcrMock.mockReset();
    callPaddleOcrMock.mockResolvedValueOnce(`
中国工商银行 网上银行电子回单
电子回单号码：SCAN-AMOUNT-001
付款人：北京羽隶工程咨询有限公司
付款账号：0200303519000018418
收款人：测试收款人
收款账号：6212260200012345678
账户余额：123.45
人民币壹仟元整
交易日期：2026-06-01
`);

    const recognized = await recognizeBankReceiptImage("mock-receipt.jpg");

    expect(recognized.amount).toBe(1000);
  });

  it("真实工商银行双列表格识别为一般账户流出并保留六分尾数", async () => {
    const outputRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "monthly-bank-icbc-columns-test-"),
    );
    try {
      const pdfPath = path.join(outputRoot, "icbc-double-columns.pdf");
      const document = await PDFDocument.create();
      const page = document.addPage([595, 842]);
      const font = await document.embedFont(StandardFonts.Helvetica);
      page.drawText("synthetic scanned receipt", {
        x: 40,
        y: 780,
        size: 12,
        font,
      });
      fs.writeFileSync(pdfPath, await document.save());

      callPaddleOcrMock.mockReset();
      callPaddleOcrMock.mockResolvedValueOnce(`
中国工商银行
网上银行电子回单
电子回单号码：0914-4933-8877-1100
户名
北京羽隶工程咨询有限公司
户名
北京羽隶科技有限公司
付款
收款
账号
0200303519000018418
账号
110933697910902
人
人
开户银行
海淀万寿支行
开户银行
招商银行股份有限公司
金额
金额（大写）
人民币柒万玖仟捌佰壹拾捌元叁角陆
¥79,818.36元
分
摘要
其他款项
业务（产品）种类 网银互联
用途
其他款项
交易流水号
58939661
时间戳
2026-05-25-12.57.05.850570
备注：其他款项
`);

      const analysis = await analyzeMonthlyFinancialBankFile({
        filePath: pdfPath,
        originalName: "工程-工行-回单（一般户）202605.pdf",
        reportMonth: "2026-05",
        outputDir: path.join(outputRoot, "recognized"),
      });

      expect(analysis.accountCode).toBe("general");
      expect(analysis.transactions).toHaveLength(1);
      expect(analysis.transactions[0]).toMatchObject({
        electronicReceiptNo: "0914-4933-8877-1100",
        payerAccount: "0200303519000018418",
        payeeAccount: "110933697910902",
        amount: 79_818.36,
        direction: "outflow",
      });
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("月度分析仅用唯一的币种票面金额纠正残缺标签，不采用任意孤立小数", async () => {
    const outputRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "monthly-bank-ticket-amount-test-"),
    );
    try {
      const pdfPath = path.join(outputRoot, "ticket-amount-receipts.pdf");
      const document = await PDFDocument.create();
      const font = await document.embedFont(StandardFonts.Helvetica);
      for (const label of [
        "1111111111111111",
        "2222222222222222",
        "3333333333333333",
        "4444444444444444",
      ]) {
        const page = document.addPage([595, 842]);
        page.drawText(label.repeat(4), {
          x: 40,
          y: 780,
          size: 12,
          font,
        });
      }
      fs.writeFileSync(pdfPath, await document.save());

      const malformedAmountReceipt = (
        receiptNo: string,
        date: string,
        amountEvidence: string,
      ) =>
        [
          "中国工商银行网上银行电子回单",
          `电子回单号码：${receiptNo}`,
          "付款人：北京羽隶工程咨询有限公司",
          `付款账号：${MONTHLY_BANK_ACCOUNTS.general.accountNumber}`,
          "收款人：测试收款人",
          "收款账号：6212260200012345678",
          "额",
          amountEvidence,
          "金额（大写）：人民币贰仟佰零柒元整",
          `交易日期：${date}`,
          "摘要：其他款项",
        ].join("\n");

      callPaddleOcrMock.mockReset();
      callPaddleOcrMock
        .mockResolvedValueOnce(
          malformedAmountReceipt(
            "AMOUNT-TICKET-001",
            "2026-06-20",
            "￥2,207.00元",
          ),
        )
        .mockResolvedValueOnce(
          malformedAmountReceipt(
            "AMOUNT-TICKET-002",
            "2026-06-21",
            "账户余额：2,207.00元",
          ),
        )
        .mockResolvedValueOnce(
          malformedAmountReceipt(
            "AMOUNT-TICKET-003",
            "2026-06-22",
            "￥2,207.00元；手续费：￥18.00元",
          ),
        )
        .mockResolvedValueOnce(
          malformedAmountReceipt(
            "AMOUNT-TICKET-004",
            "2026-06-23",
            "金额（小写）：1999.00\n额\n￥2,207.00元",
          ),
        );

      const analysis = await analyzeMonthlyFinancialBankFile({
        filePath: pdfPath,
        originalName: "2026年6月一般账户.pdf",
        reportMonth: "2026-06",
        outputDir: path.join(outputRoot, "recognized"),
      });

      expect(
        analysis.transactions.map((transaction) => transaction.amount),
      ).toEqual([2207, 2107, 2107, 1999]);
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("同一文件相同电子回单号但完整账号、日期或金额不一致时生成上传阻断告警", async () => {
    const outputRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "monthly-bank-duplicate-test-"),
    );
    try {
      const pdfPath = path.join(outputRoot, "duplicate-receipts.pdf");
      const document = await PDFDocument.create();
      const font = await document.embedFont(StandardFonts.Helvetica);
      for (const label of [
        "synthetic receipt page one",
        "synthetic receipt page two",
      ]) {
        const page = document.addPage([595, 842]);
        page.drawText(label.repeat(3), {
          x: 40,
          y: 780,
          size: 12,
          font,
        });
      }
      fs.writeFileSync(pdfPath, await document.save());

      callPaddleOcrMock.mockReset();
      callPaddleOcrMock
        .mockResolvedValueOnce(
          scannedReceiptText({
            receiptNo: "SAME-RECEIPT-001",
            date: "2026-06-01",
            amount: "100.00",
            payeeAccount: "6212260200012345678",
          }),
        )
        .mockResolvedValueOnce(
          scannedReceiptText({
            receiptNo: "SAME-RECEIPT-001",
            date: "2026-06-02",
            amount: "200.00",
            payeeAccount: "6212260200098765432",
          }),
        );

      const analysis = await analyzeMonthlyFinancialBankFile({
        filePath: pdfPath,
        originalName: "2026年6月一般账户.pdf",
        reportMonth: "2026-06",
        outputDir: path.join(outputRoot, "recognized"),
      });

      expect(analysis.transactions).toHaveLength(1);
      expect(
        analysis.warnings.some((warning) =>
          /同一文件电子回单号.*完整账号、日期或金额不一致.*停止自动入账/u.test(
            warning,
          ),
        ),
      ).toBe(true);

      const routeSource = fs.readFileSync(
        path.resolve(
          process.cwd(),
          "server/routes/monthly-financial-reports.ts",
        ),
        "utf8",
      );
      expect(routeSource).toContain("同一文件电子回单号.*不一致");
      expect(routeSource).toContain("MONTHLY_BANK_REVIEW_REQUIRED");
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("在渲染前阻止单份超页和多文件累计超页输入", async () => {
    const outputRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "monthly-bank-page-limit-test-"),
    );
    try {
      const pdfPath = path.join(outputRoot, "too-many-pages.pdf");
      const document = await PDFDocument.create();
      for (let index = 0; index < 121; index += 1) {
        document.addPage([595, 842]);
      }
      fs.writeFileSync(pdfPath, await document.save());

      await expect(
        analyzeMonthlyFinancialBankFile({
          filePath: pdfPath,
          originalName: "一般账户.pdf",
          reportMonth: "2026-06",
          outputDir: path.join(outputRoot, "single"),
        }),
      ).rejects.toThrow("单份银行回单不能超过 120 页");
      await expect(
        analyzeMonthlyFinancialBankFile({
          filePath: pdfPath,
          originalName: "一般账户.pdf",
          reportMonth: "2026-06",
          outputDir: path.join(outputRoot, "batch"),
          maxPageCount: 80,
        }),
      ).rejects.toThrow("本次银行回单合计不能超过 200 页");
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});

const realFixtureRoot = "/Users/yuli/Desktop/月度财务报表回单与发票测试";
const juneGeneralPdf = path.join(
  realFixtureRoot,
  "６月份",
  "６月份一般账户.pdf",
);
const juneBasicPdf = path.join(realFixtureRoot, "６月份", "６月份基本账户.pdf");
const juneBusinessPdf = path.join(
  realFixtureRoot,
  "６月份",
  "６月份商务账户.pdf",
);
const julyBusinessPdf = path.join(
  realFixtureRoot,
  "７月份",
  "７月份商务账户.pdf",
);
const hasRealBusinessFixtures =
  fs.existsSync(juneBusinessPdf) && fs.existsSync(julyBusinessPdf);
const describeRealBusinessFixtures = hasRealBusinessFixtures
  ? describe
  : describe.skip;

const hasRealJuneAccountFixtures = [
  juneGeneralPdf,
  juneBasicPdf,
  juneBusinessPdf,
].every((filePath) => fs.existsSync(filePath));
const describeRealJuneAccountFixtures = hasRealJuneAccountFixtures
  ? describe
  : describe.skip;

describeRealJuneAccountFixtures("真实六月银行回单文件定位基线", () => {
  it("一般、基本和商务账户原件页数保持为 17、27 和 6 页", async () => {
    const pageCounts = await Promise.all(
      [juneGeneralPdf, juneBasicPdf, juneBusinessPdf].map(async (filePath) => {
        const document = await PDFDocument.load(fs.readFileSync(filePath));
        return document.getPageCount();
      }),
    );

    expect(pageCounts).toEqual([17, 27, 6]);
  });
});

describeRealBusinessFixtures("真实商务账户 PDF 快速基线", () => {
  jest.setTimeout(120_000);

  let outputRoot = "";
  let june: MonthlyBankFileAnalysis;
  let july: MonthlyBankFileAnalysis;

  beforeAll(async () => {
    outputRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "monthly-bank-business-test-"),
    );
    [june, july] = await Promise.all([
      analyzeMonthlyFinancialBankFile({
        filePath: juneBusinessPdf,
        // 故意给出冲突文件名，用真实文件验证“完整账号优先”。
        originalName: "６月份一般账户.pdf",
        reportMonth: "2026-06",
        outputDir: path.join(outputRoot, "june"),
      }),
      analyzeMonthlyFinancialBankFile({
        filePath: julyBusinessPdf,
        originalName: "７月份商务账户.pdf",
        // 故意选择错误报表月份，同时复用真实七月十张回单基线。
        reportMonth: "2026-06",
        outputDir: path.join(outputRoot, "july"),
      }),
    ]);
  });

  afterAll(() => {
    if (outputRoot) fs.rmSync(outputRoot, { recursive: true, force: true });
  });

  it("六月拆出十二张回单：十一张内部划转和利息 36.65 元", () => {
    expect(june.accountCode).toBe("business");
    expect(june.transactions).toHaveLength(12);
    expect(
      june.transactions.filter(
        (transaction) => transaction.category === "internal_transfer",
      ),
    ).toHaveLength(11);

    const interests = june.transactions.filter(
      (transaction) => transaction.category === "interest",
    );
    expect(interests).toHaveLength(1);
    expect(interests[0]?.amount).toBeCloseTo(36.65, 2);
    expect(interests[0]?.includeInReport).toBe(true);
    expect(
      june.transactions
        .filter((transaction) => transaction.category === "internal_transfer")
        .every((transaction) => !transaction.includeInReport),
    ).toBe(true);
  });

  it("真实文件名提示冲突时仍按商务完整账号识别并给出告警", () => {
    expect(june.filenameAccountHint).toBe("general");
    expect(june.accountCode).toBe("business");
    expect(
      june.warnings.some(
        (warning) =>
          warning.includes("文件名提示为一般账户") &&
          warning.includes("完整账号识别为商务账户"),
      ),
    ).toBe(true);
  });

  it("备注月份异常仅告警，并明确以银行交易日期为准", () => {
    expect(
      june.transactions.some((transaction) =>
        transaction.warnings.some(
          (warning) =>
            warning.includes("备注月份 2025-06") &&
            warning.includes("银行交易月份 2026-06") &&
            warning.includes("以银行交易日期为准"),
        ),
      ),
    ).toBe(true);
  });

  it("七月拆出十张内部划转，选择六月报表时要求月份确认", () => {
    expect(july.accountCode).toBe("business");
    expect(july.transactions).toHaveLength(10);
    expect(
      july.transactions.every(
        (transaction) => transaction.category === "internal_transfer",
      ),
    ).toBe(true);
    expect(july.transactionMonths).toEqual(["2026-07"]);
    expect(july.requiresMixedMonthConfirmation).toBe(true);
    expect(
      july.warnings.some(
        (warning) =>
          warning.includes("2026-07") && warning.includes("管理员确认"),
      ),
    ).toBe(true);
    expect(
      july.transactions.every((transaction) => !transaction.includeInReport),
    ).toBe(true);
  });
});

describe("月度银行回单后端持久化与汇总契约", () => {
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/monthly-financial-reports.ts"),
    "utf8",
  );
  const databaseSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/db/index.ts"),
    "utf8",
  );
  const bankStatementSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "server/services/monthlyFinancialBankStatement.ts",
    ),
    "utf8",
  );
  const reimbursementMatcherSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "server/services/monthlyFinancialReimbursementMatcher.ts",
    ),
    "utf8",
  );
  const panelSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "src/components/monthly-financial/MonthlyBankReceiptPanel.vue",
    ),
    "utf8",
  );

  it("提供账户回单查询、上传和单笔在线预览端点", () => {
    expect(routeSource).toContain(
      '"/bank-transactions/:transactionId/preview"',
    );
    expect(routeSource).toContain('"/:month/bank-receipts"');
    expect(routeSource).toContain('monthlyBankUpload.array("files", 3)');
    expect(routeSource).toContain(
      "file.originalname = normalizeUploadFileName(file.originalname)",
    );
    expect(routeSource).toContain(
      "bankStatements: await loadMonthlyBankState(month)",
    );
  });

  it("文件摘要按报表月查重，规范化电子回单号全局查重", () => {
    const bankFileTableStart = databaseSource.indexOf(
      "CREATE TABLE IF NOT EXISTS monthly_financial_bank_files",
    );
    const bankTransactionTableStart = databaseSource.indexOf(
      "CREATE TABLE IF NOT EXISTS monthly_financial_bank_transactions",
      bankFileTableStart,
    );
    const bankFileTableSource = databaseSource.slice(
      bankFileTableStart,
      bankTransactionTableStart,
    );

    expect(bankFileTableStart).toBeGreaterThan(-1);
    expect(bankTransactionTableStart).toBeGreaterThan(bankFileTableStart);
    expect(databaseSource).toContain(
      "DROP CONSTRAINT IF EXISTS monthly_financial_bank_files_file_hash_key",
    );
    expect(databaseSource).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_financial_bank_files_month_hash",
    );
    expect(databaseSource).toContain(
      "ON monthly_financial_bank_files(report_month, file_hash)",
    );
    expect(databaseSource).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_financial_bank_receipt_no",
    );
    expect(databaseSource).toContain(
      "ON monthly_financial_bank_transactions(normalized_electronic_receipt_no)",
    );
    expect(routeSource).toMatch(
      /SELECT id FROM monthly_financial_bank_files\s+WHERE report_month = \? AND file_hash = \?/u,
    );
    expect(routeSource).toContain("MONTHLY_BANK_FILE_ALREADY_UPLOADED");
    expect(routeSource).toContain(
      "WHERE normalized_electronic_receipt_no = $1 FOR UPDATE",
    );
    expect(bankFileTableSource).not.toContain("file_hash TEXT NOT NULL UNIQUE");
  });

  it("上传同月同账户新完整文件时关闭旧活动版本并替换旧事实显示来源", () => {
    expect(databaseSource).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_financial_bank_files_active",
    );
    expect(databaseSource).toContain(
      "ON monthly_financial_bank_files(report_month, account_code)",
    );
    expect(routeSource).toContain(
      "SET is_active = FALSE, recognition_status = 'replaced'",
    );
    expect(routeSource).toContain(
      "SET is_current = FALSE, include_in_report = FALSE",
    );
    expect(routeSource).toContain("replaces_file_id");
    expect(routeSource).toContain(
      "SET current_file_id = $2, current_file_version = $3",
    );
  });

  it("业务统计保留系统事实，银行只提供利息手续费与凭证", () => {
    expect(routeSource).toContain("transaction.is_current = TRUE");
    expect(routeSource).toContain("file.is_active = TRUE");
    expect(routeSource).toContain(
      "const includedBankRows = accountingBankRows.filter(",
    );
    expect(routeSource).toContain('row.category === "interest"');
    expect(routeSource).toContain('row.category === "bank_fee"');
    expect(routeSource).toContain(
      '.filter((row) => row.category === "internal_transfer")',
    );
    expect(routeSource).toContain('sumBankCategory("general", "interest")');
    expect(routeSource).toContain('sumBankCategory("business", "bank_fee")');
    expect(routeSource).toContain(
      "统计金额以系统内已确认主营回款为准，银行回单仅作匹配凭证",
    );
    expect(routeSource).toContain(
      "统计金额沿用系统薪资核算，银行回单仅作逐人付款凭证",
    );
    expect(routeSource).not.toContain("removeDetails(");
    expect(routeSource).not.toContain('humanCost = "0"');
    expect(routeSource).not.toContain('reimbursementTotals.business = "0"');
    expect(bankStatementSource).toContain(
      'const autoIncluded = ["interest", "bank_fee"].includes(category)',
    );
    expect(reimbursementMatcherSource).not.toContain(
      "bank_transaction.include_in_report = TRUE",
    );
    expect(
      routeSource.match(/await normalizeMonthlyBankAccountingFlags\(/gu),
    ).toHaveLength(2);
  });

  it("单一错误月份直接拒绝，混合月份须管理员明确确认", () => {
    expect(routeSource).toContain("MONTHLY_BANK_REPORT_MONTH_MISMATCH");
    expect(routeSource).toContain(
      "MONTHLY_BANK_MIXED_MONTH_CONFIRMATION_REQUIRED",
    );
    expect(routeSource).toContain("mixedMonthConfirmed");
    expect(routeSource).toContain("transaction.transactionMonth === month");
    expect(routeSource).toContain("请切换到对应月份重新上传并确认");
    expect(routeSource).toMatch(
      /SELECT id FROM monthly_financial_bank_files\s+WHERE report_month = \? AND file_hash = \?/u,
    );
  });

  it("部分识别和待复核在持久化前失败，不替换旧活动文件并阻止月结", () => {
    const reviewGuardIndex = routeSource.indexOf(
      "const blockingWarnings = analysis.warnings.filter",
    );
    const reviewErrorIndex = routeSource.indexOf(
      '"MONTHLY_BANK_REVIEW_REQUIRED"',
      reviewGuardIndex,
    );
    const candidatePushIndex = routeSource.indexOf(
      "candidates.push({",
      reviewGuardIndex,
    );
    const persistIndex = routeSource.indexOf(
      "await persistMonthlyBankAnalyses({",
      reviewGuardIndex,
    );

    expect(reviewGuardIndex).toBeGreaterThan(-1);
    expect(reviewErrorIndex).toBeGreaterThan(reviewGuardIndex);
    expect(candidatePushIndex).toBeGreaterThan(reviewErrorIndex);
    expect(persistIndex).toBeGreaterThan(candidatePushIndex);
    expect(routeSource).toContain("file.recognition_status = 'recognized'");
    expect(routeSource).toContain(
      'item.file_recognition_status === "recognized"',
    );
    expect(routeSource).toContain("MONTHLY_BANK_REVIEW_REQUIRED");
    expect(routeSource).toContain("本次文件未替换当前月报数据");
    expect(panelSource).toContain("待复核，尚未接管");
  });

  it("主营收入和资产支出未匹配合同时单笔待关联且不回滚其他回单", () => {
    expect(routeSource).toContain(
      '["main_income", "asset_expense", "unclassified"].includes(',
    );
    expect(routeSource).toContain("MONTHLY_BANK_CONTRACT_MATCH_REQUIRED:");
    expect(routeSource).toContain(
      "未找到对应的已确认合同收付款记录，已保存银行回单并转为待关联",
    );
    expect(routeSource).toContain("recognition_status = 'review_required'");
    expect(routeSource).toContain("include_in_report = FALSE");
    expect(routeSource).not.toContain(
      '"MONTHLY_BANK_CONTRACT_MATCH_REQUIRED",',
    );
    expect(routeSource).toContain("linkResult.categoryOverride");
    expect(routeSource).toContain("chargeAccounts");
    expect(routeSource).toContain(
      "file.recognition_status IN ('recognized', 'partial')",
    );
    expect(routeSource).toContain(
      'transaction_recognition_status === "recognized"',
    );
    expect(routeSource).toContain("summary.safe_charge_count");
    expect(panelSource).toContain("已安全计入月报");
  });

  it("工资与三类报销均要求姓名和完整账号唯一匹配员工", () => {
    const employeeMatchStart = routeSource.indexOf(
      "const employeeMatches = await client.query",
    );
    const employeeMatchEnd = routeSource.indexOf(
      "const linkResult = await linkMonthlyFinancialBankTransaction",
      employeeMatchStart,
    );
    const employeeMatchSection = routeSource.slice(
      employeeMatchStart,
      employeeMatchEnd,
    );
    for (const category of [
      "salary",
      "basic_reimbursement",
      "large_reimbursement",
      "business_reimbursement",
    ]) {
      expect(employeeMatchSection).toContain(category);
    }
    expect(employeeMatchSection).toContain(
      'transaction.category !== "ignored"',
    );
    expect(employeeMatchSection).toContain("MONTHLY_BANK_EMPLOYEE_NOT_MATCHED");
    expect(employeeMatchSection).toContain("收款人姓名与完整账号未匹配员工");
  });

  it("文件总页数受限且状态查询返回全部历史摘要用于结果确认", () => {
    expect(routeSource).toContain("let remainingPageBudget = 200");
    expect(routeSource).toContain("maxPageCount: remainingPageBudget");
    expect(routeSource).toContain("remainingPageBudget -= analysis.pageCount");
    expect(routeSource).toContain("knownFileHashes");
    expect(routeSource).toContain("SELECT file_hash");
  });

  it("历史快照预览绑定文件版本并提供待复核排除路径", () => {
    expect(routeSource).toContain("?fileId=${encodeURIComponent(");
    expect(routeSource).toContain("historical_crop_path");
    expect(routeSource).toContain(
      '"/:month/bank-transactions/:transactionId/review"',
    );
    expect(routeSource).toContain("复核排除月度银行交易");
    expect(routeSource).toContain("管理员复核排除");
    expect(panelSource).toContain("reviewAndExcludeTransaction(row.id)");
    expect(panelSource).toContain("复核排除");
    expect(panelSource).toContain('emit("busy-change", true)');
    expect(panelSource).toContain('emit("busy-change", false)');
    expect(panelSource).toContain(
      "const targetVersion = props.expectedVersion",
    );
  });

  it("合同收付款冲正会原子停用链接并把银行事实转为待复核", () => {
    expect(databaseSource).toContain(
      "CREATE OR REPLACE FUNCTION deactivate_monthly_bank_contract_links()",
    );
    expect(databaseSource).toContain("recognition_status = 'review_required'");
    expect(databaseSource).toContain("include_in_report = FALSE");
    expect(databaseSource).toContain("recognition_status = 'partial'");
    expect(databaseSource).toContain(
      "included_receipt_count = (\n              SELECT COUNT(*)::INTEGER",
    );
    expect(databaseSource).toContain(
      "SET match_status = 'replaced', is_active = FALSE",
    );
    expect(databaseSource).toContain("commitOutcomeUncertain = true");
    expect(routeSource).toContain("commitOutcomeUncertain");
    expect(routeSource).toContain("已保留原件");
  });
});
