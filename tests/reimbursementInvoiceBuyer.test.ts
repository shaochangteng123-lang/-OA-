jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcr: jest.fn(),
}));

import {
  buildInvoiceXmlArgs,
  extractInvoiceItemNameFromPositionedText,
  extractInvoicePartyFieldsFromPositionedText,
  extractInvoiceTaxAmountFromPositionedText,
  parseInvoiceText,
} from "../server/services/localOcr";
import {
  assertReimbursementCompanyInvoice,
  isReimbursementCompanyInvoice,
  isReimbursementCompanyInvoiceError,
  REIMBURSEMENT_COMPANY_INVOICE_ERROR,
} from "../server/services/reimbursementInvoiceBuyer";

const COMPANY_NAME = "北京羽隶工程咨询有限公司";
const COMPANY_TAX_ID = "91110116MA01G3U20C";
const INVOICE_NUMBER = "26502000000717101161";
const COMPANY_ERROR_MESSAGE = `发票号码 ${INVOICE_NUMBER} ${REIMBURSEMENT_COMPANY_INVOICE_ERROR}`;

function invoiceText(
  buyer = COMPANY_NAME,
  buyerTaxId = COMPANY_TAX_ID,
): string {
  return `
电子发票（增值税普通发票）
发票号码：${INVOICE_NUMBER}
开票日期：2026年08月06日
购买方信息
名称：${buyer}
统一社会信用代码/纳税人识别号：${buyerTaxId}
销售方信息
名称：北京示例技术有限公司
统一社会信用代码/纳税人识别号：91110108MA01EXAMPLE
项目名称：技术服务
税额：5.66
价税合计（小写）¥100.00
`;
}

describe("报销发票购买方公司主体校验", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("提取购买方名称和纳税人识别号并通过精确匹配", () => {
    const result = parseInvoiceText(invoiceText());

    expect(result.buyer).toBe(COMPANY_NAME);
    expect(result.buyerTaxId).toBe(COMPANY_TAX_ID);
    expect(isReimbursementCompanyInvoice(result)).toBe(true);
    expect(() => assertReimbursementCompanyInvoice(result)).not.toThrow();
  });

  it("报销多页发票可读取全部页面，合同等调用默认仍只读取第一页", () => {
    expect(buildInvoiceXmlArgs("invoice.pdf")).toEqual([
      "-xml",
      "-stdout",
      "-nodrm",
      "-i",
      "-f",
      "1",
      "-l",
      "1",
      "invoice.pdf",
    ]);
    expect(buildInvoiceXmlArgs("invoice.pdf", { pageScope: "all" })).toEqual([
      "-xml",
      "-stdout",
      "-nodrm",
      "-i",
      "invoice.pdf",
    ]);
  });

  it("左右并排字段按坐标分别提取，不会把购买方和销售方税号串接或互换", () => {
    const fields = extractInvoicePartyFieldsFromPositionedText([
      { top: 152, left: 48, width: 34, text: "名称:" },
      { top: 152, left: 81, width: 162, text: COMPANY_NAME },
      { top: 152, left: 475, width: 34, text: "名称:" },
      { top: 152, left: 509, width: 149, text: "北京示例技术有限公司" },
      {
        top: 194,
        left: 52,
        width: 189,
        text: "统一社会信用代码/纳税人识别号：",
      },
      { top: 193, left: 235, width: 194, text: COMPANY_TAX_ID },
      {
        top: 194,
        left: 482,
        width: 189,
        text: "统一社会信用代码/纳税人识别号：",
      },
      { top: 193, left: 665, width: 194, text: "91110000710936284R" },
    ]);

    expect(fields).toEqual({
      buyer: COMPANY_NAME,
      buyerTaxId: COMPANY_TAX_ID,
      seller: "北京示例技术有限公司",
      sellerTaxId: "91110000710936284R",
    });
    expect(isReimbursementCompanyInvoice(fields)).toBe(true);
  });

  it("开票名称只读取项目名称列，不拼接规格型号并保留项目续行", () => {
    const itemName = extractInvoiceItemNameFromPositionedText([
      { top: 230, left: 70, width: 54, text: "项目名称" },
      { top: 230, left: 181, width: 54, text: "规格型号" },
      { top: 230, left: 287, width: 41, text: "单位" },
      { top: 246, left: 24, width: 65, text: "*供电*电费" },
      { top: 246, left: 190, width: 40, text: "A8H" },
      { top: 266, left: 24, width: 146, text: "*生产生活服务*系统维护" },
      { top: 285, left: 24, width: 14, text: "费" },
      { top: 402, left: 91, width: 14, text: "合" },
      { top: 402, left: 158, width: 14, text: "计" },
      { top: 429, left: 91, width: 120, text: "价税合计（大写）" },
    ]);

    expect(itemName).toBe("*供电*电费、*生产生活服务*系统维护费");
    expect(itemName).not.toContain("A8H");
  });

  it("不动产租赁票按项目名称右侧最近列截断产权证号", () => {
    const itemName = extractInvoiceItemNameFromPositionedText([
      { top: 230, left: 60, width: 54, text: "项目名称" },
      {
        top: 230,
        left: 159,
        width: 142,
        text: "产权证书/不动产权证号",
      },
      { top: 230, left: 319, width: 54, text: "面积单位" },
      { top: 246, left: 24, width: 119, text: "*生产生活服务*租金" },
      {
        top: 246,
        left: 159,
        width: 141,
        text: "X京房权证朝字第881747",
      },
      { top: 266, left: 223, width: 14, text: "号" },
      { top: 402, left: 91, width: 14, text: "合" },
      { top: 402, left: 158, width: 14, text: "计" },
    ]);

    expect(itemName).toBe("*生产生活服务*租金");
    expect(itemName).not.toContain("产权证");
    expect(itemName).not.toContain("面积单位");
  });

  it("项目名称右侧没有同行列表头时返回空值并交由慢速通道复核", () => {
    expect(
      extractInvoiceItemNameFromPositionedText([
        { top: 100, left: 60, width: 54, text: "项目名称" },
        { top: 120, left: 24, width: 100, text: "合同之外文字" },
        { top: 500, left: 159, width: 54, text: "规格型号" },
      ]),
    ).toBe("");
  });

  it("税额按合计行最右金额列读取，不依赖 XML 节点顺序", () => {
    expect(
      extractInvoiceTaxAmountFromPositionedText([
        { top: 402, left: 91, width: 14, text: "合" },
        { top: 399, left: 820, width: 54, text: "¥2911.14" },
        { top: 402, left: 158, width: 14, text: "计" },
        { top: 399, left: 633, width: 60, text: "¥58222.86" },
      ]),
    ).toBe(2911.14);
  });

  it("购买方名称不一致时返回指定提示", () => {
    const result = parseInvoiceText(invoiceText("北京其他公司"));

    expect(() => assertReimbursementCompanyInvoice(result)).toThrow(
      COMPANY_ERROR_MESSAGE,
    );
  });

  it("购买方纳税人识别号不一致时返回指定提示", () => {
    const result = parseInvoiceText(
      invoiceText(COMPANY_NAME, "91110108MA01OTHER1"),
    );

    expect(() => assertReimbursementCompanyInvoice(result)).toThrow(
      COMPANY_ERROR_MESSAGE,
    );
  });

  it("公司主体出现在销售方而非购买方时不能通过", () => {
    const result = parseInvoiceText(
      invoiceText("北京其他公司", "91110108MA01OTHER1"),
    );
    result.seller = COMPANY_NAME;
    result.sellerTaxId = COMPANY_TAX_ID;

    expect(isReimbursementCompanyInvoice(result)).toBe(false);
  });

  it("识别不到购买方名称或税号时返回指定提示", () => {
    const action = () =>
      assertReimbursementCompanyInvoice({
        buyer: "",
        buyerTaxId: "",
        invoiceNumber: INVOICE_NUMBER,
      });

    expect(action).toThrow(COMPANY_ERROR_MESSAGE);

    try {
      action();
    } catch (error) {
      expect(isReimbursementCompanyInvoiceError(error)).toBe(true);
    }
  });
});
