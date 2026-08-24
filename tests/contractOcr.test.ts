import fs from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";
import sharp from "sharp";
import {
  calculateContractImageOcrSize,
  calculateContractPdfOcrRenderProfile,
  calculateContractPdfOcrTiles,
  calculateContractDateFocusCrop,
  calculateContractDateFocusEnhancementSize,
  extractContractBusinessNumber,
  extractContractLeaseTerms,
  extractReferencedParentContractBusinessNumber,
  calculateSafePdfRenderDpi,
  mergeContractOcrTileLines,
  getContractAmountAutomaticAdoptionContext,
  getContractAmountBreakdown,
  getContractOcrAutomaticAdoptionSafetyContext,
  isContractOcrVerifiedConfidence,
  parseChineseUppercaseAmount,
  parseContractText,
  recognizeContractPdfPageWithAutomaticRecovery,
  recognizeContractFile,
  runWithContractPdfRenderPermit,
  selectContractSealCopyCountReviewPages,
  selectContractOcrPriorityPages,
  type ContractOcrFieldName,
  type ContractTextSource,
} from "../server/services/contractOcr";

describe("主营合同原件编号识别", () => {
  const line = (page: number, text: string) => ({
    page,
    text,
    bbox: [],
    confidence: 0.99,
    modelVersion: "v6_medium" as const,
  });

  it("只采用明确“合同编号：”标签后的内容", () => {
    expect(
      extractContractBusinessNumber([
        line(1, "SGTYHT/24-JS-004 技术服务合同"),
        line(1, "合同编号：SGBJHD00JJJS2500875"),
        line(2, "合同编号：SGBJHD00JJJS2500875"),
        line(3, "SGTYHT/24-JS-004"),
      ]),
    ).toEqual({
      value: "SGBJHD00JJJS2500875",
      pageNumbers: [1, 2],
      source: "label",
    });
  });

  it("二维码编号优先作为补充协议自身编号并完整保留版本后缀", () => {
    const lines = [
      line(1, "合同编号：SGBJCY00JSJS2500693"),
      line(2, "二维码合同编号：SGBJCY00JSJS2500693(B1)"),
      line(3, "二维码合同编号：SGBJCY00JSJS2500693(B1)"),
    ];
    const ownNumber = extractContractBusinessNumber(lines);
    expect(ownNumber).toEqual({
      value: "SGBJCY00JSJS2500693(B1)",
      pageNumbers: [2, 3],
      source: "qr",
    });
    expect(
      extractReferencedParentContractBusinessNumber(lines, ownNumber),
    ).toBe("SGBJCY00JSJS2500693");
  });

  it("明确的原合同编号优先用于上级关系核对", () => {
    const lines = [
      line(1, "二维码合同编号：SUPPLEMENT2026(B1)"),
      line(2, "原合同编号：MAINCONTRACT2025"),
    ];
    expect(
      extractReferencedParentContractBusinessNumber(
        lines,
        extractContractBusinessNumber(lines),
      ),
    ).toBe("MAINCONTRACT2025");
  });

  it("不会把原合同编号误作补充协议自身编号", () => {
    const lines = [line(1, "原合同编号：MAINCONTRACT2025")];
    expect(extractContractBusinessNumber(lines)).toBeNull();
    expect(extractReferencedParentContractBusinessNumber(lines, null)).toBe(
      "MAINCONTRACT2025",
    );
  });

  it("模板编号重复出现但合同编号标签为空时不猜测", () => {
    expect(
      extractContractBusinessNumber([
        line(1, "SGTYHT/25-JS-004 技术服务合同"),
        line(1, "合同编号："),
        line(2, "SGTYHT/25-JS-004"),
        line(2, "合同编号（甲方）："),
      ]),
    ).toBeNull();
  });

  it("不会把系统内部流水号识别为原件合同编号", () => {
    expect(
      extractContractBusinessNumber([
        line(1, "合同编号：HT-20260813-000009"),
        line(2, "HT-20260813-000009"),
      ]),
    ).toBeNull();
  });

  it("候选证据完全并列时不猜测合同编号", () => {
    expect(
      extractContractBusinessNumber([
        line(1, "合同编号：AAA25JS001"),
        line(2, "合同编号：BBB25JS002"),
      ]),
    ).toBeNull();
  });
});

jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcrDetailed: jest.fn(async () => ({
    lines: [
      {
        text: "甲方：北京建设有限公司",
        confidence: 0.98,
        box: [
          [10, 20],
          [110, 20],
          [110, 40],
          [10, 40],
        ],
      },
      { text: "乙方：北京咨询有限公司", confidence: 0.98, box: [] },
      { text: "项目名称：盖章归档项目", confidence: 0.98, box: [] },
      { text: "合同金额：100000元", confidence: 0.98, box: [] },
      { text: "工程咨询服务合同", confidence: 0.98, box: [] },
      { text: "签订日期：2026年8月4日", confidence: 0.98, box: [] },
    ],
    fullText:
      "甲方：北京建设有限公司\n乙方：北京咨询有限公司\n项目名称：盖章归档项目\n合同金额：100000元\n工程咨询服务合同\n签订日期：2026年8月4日",
    modelVersion: "v4_mobile",
  })),
}));

jest.mock("../server/services/tesseractOcrDaemon", () => ({
  callTesseractOcrDetailed: jest.fn(async () => ({
    lines: [],
    fullText: "",
    confidence: 0,
  })),
}));

import { callPaddleOcrDetailed } from "../server/services/ocrDaemon";
import { callTesseractOcrDetailed } from "../server/services/tesseractOcrDaemon";

function field(
  result: ReturnType<typeof parseContractText>,
  name: ContractOcrFieldName,
) {
  const value = result.fields.find((item) => item.field === name);
  if (!value) throw new Error(`缺少识别字段：${name}`);
  return value;
}

function samePageIndependentSources(
  textLayer: string,
  visibleText = textLayer,
): ContractTextSource[] {
  return [
    {
      text: textLayer,
      source: "pdf_text",
      pageNumber: 1,
      confidence: 99,
      recognitionEngine: "pdf_text",
    },
    {
      text: visibleText,
      source: "ocr_300",
      pageNumber: 1,
      confidence: 99,
      recognitionEngine: "paddleocr",
    },
  ];
}

describe("合同文字字段识别", () => {
  it("网络接入合同映射甲乙方但不采用中文大写或年度单价作为总额", () => {
    const partyText = [
      "网络接入技术服务合同",
      "用户（以下简称甲方）：北京羽隶科技有限公司",
      "接入商：（以下简称乙方）：北京网维讯通通信技术有限公司",
    ].join("\n");
    const amountText = [
      "第五条 费用及支付方式",
      "1. 费用组成：各项费用合计元（大写：壹万壹仟元整）。",
      "网络服务费",
      "收费金额",
      "11000元/年",
    ].join("\n");
    const result = parseContractText("", {
      expectedCategory: "asset",
      sources: [
        {
          text: partyText,
          source: "ocr_300",
          pageNumber: 2,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: partyText,
          source: "ocr_480",
          pageNumber: 2,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: amountText,
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: amountText,
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(field(result, "party_a").normalizedValue).toBe(
      "北京羽隶科技有限公司",
    );
    expect(field(result, "party_b").normalizedValue).toBe(
      "北京网维讯通通信技术有限公司",
    );
    expect(field(result, "amount").normalizedValue).toBe("");
    expect(getContractAmountAutomaticAdoptionContext(result)).toMatchObject({
      status: "missing_amount",
    });
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.amount,
    ).toMatchObject({
      selectedValue: null,
      candidateExists: false,
      riskCodes: [],
    });
  });

  it("未预先枚举的业务角色可按以下简称甲乙方的结构确定合同双方", () => {
    const result = parseContractText(
      [
        "数字平台运维合同",
        "平台使用单位（以下简称甲方）：北京示例科技有限公司",
        "技术保障机构：（以下简称乙方）：上海示例信息技术有限公司",
      ].join("\n"),
    );

    expect(field(result, "party_a").normalizedValue).toBe(
      "北京示例科技有限公司",
    );
    expect(field(result, "party_b").normalizedValue).toBe(
      "上海示例信息技术有限公司",
    );
  });

  it("房屋租赁合同以正文月租金乘租赁月数计算总额并排除收据金额", () => {
    const result = parseContractText(
      `房屋租赁合同
出租方（甲方）：北京甲方有限公司
承租方（乙方）：北京乙方有限公司
项目：办公用房租赁
租赁期限：自2026年1月1日起至2026年12月31日止
月租金：人民币10,000.00元/月
附件：收款收据 金额 5,000.00元`,
      { expectedCategory: "asset" },
    );
    expect(field(result, "amount").normalizedValue).toBe("120000.00");
    expect(extractContractLeaseTerms(result.rawText, "asset")).toEqual(
      expect.objectContaining({
        leaseStartDate: "2026-01-01",
        leaseEndDate: "2026-12-31",
        monthlyRent: 10000,
        monthlyPropertyManagementFee: null,
        termMonths: 12,
        totalAmount: 120000,
        amountSource: "monthly_rent_calculated",
      }),
    );
  });

  it("资产小客车租赁识别个人出租方、合同名称及周年租金总额", () => {
    const text = `公司租个人小客车协议
甲方（出租方）：曾宇
身份证号：110108198211094915
联系电话：13810719838
乙方（承租方）：北京羽隶工程咨询有限公司
统一社会信用代码：91110116MA01G3U20C
一、租赁车辆基本信息
车辆品牌及型号：传祺牌宗师M8
车辆牌照号码：京LRF277
车辆识别代号（VIN）：LMGMB1S85R1066467
二、租赁期限
租赁期限自2025年10月31日12:00时起至2026年10月31日12:00时止。
三、租赁费用及支付方式
租赁费用标准：每月租金为人民币780元（大写：柒佰捌拾圆整）。
燃油费、过路费、停车费、洗车费、维修保养费和保险费另行承担。
第三者责任险保额不低于叁佰万元。
违约时按首月租金的100%支付违约金。`;
    const result = parseContractText("", {
      sources: samePageIndependentSources(text),
      expectedCategory: "asset",
      relationType: "main",
    });
    const terms = extractContractLeaseTerms(text, "asset");

    expect(field(result, "party_a").normalizedValue).toBe("曾宇");
    expect(field(result, "party_b").normalizedValue).toBe(
      "北京羽隶工程咨询有限公司",
    );
    expect(field(result, "project_name").normalizedValue).toBe(
      "公司租个人小客车",
    );
    expect(field(result, "amount").normalizedValue).toBe("9360.00");
    expect(terms).toEqual(
      expect.objectContaining({
        isRentalLease: true,
        leaseStartDate: "2025-10-31",
        leaseEndDate: "2026-10-31",
        monthlyRent: 780,
        termMonths: 12,
        totalAmount: 9360,
        amountSource: "monthly_rent_calculated",
      }),
    );
  });

  it("停车位租赁按优惠后每月总费用和实际租期识别合同总额", () => {
    const text = `编号：国航物业-国航大厦车位合（2025）14
国航大厦停车场车位租赁协议
出租方：国航物业酒店管理有限公司国航大厦分公司（以下简称甲方）
承租方：北京羽隶科技有限公司（以下简称乙方）
一、租赁标的
甲方向乙方提供3个固定车位。
二、租赁期
停车位租赁期自2025年07月01日起至2025年12月31日止。
三、停车位租金
地下3、4层固定车位：人民币1600元/个/月；
给予乙方车位每月租赁费用按7折1120元/月/辆和5折800元/月/辆。
根据本协议第一条款约定，乙方车位每月租赁费用共计2720元/月（含税，税率5%）。
停车位租金按半年进行支付，费用共计16320元/半年（不含税金额15542.86元、增值税777.14元）。
甲方：国航物业酒店管理有限公司国航大厦分公司
乙方：北京羽隶科技有限公司
合同签订日期：2025.7.3`;
    const result = parseContractText("", {
      sources: samePageIndependentSources(text),
      expectedCategory: "asset",
      relationType: "main",
    });
    const terms = extractContractLeaseTerms(text, "asset");

    expect(field(result, "party_a").normalizedValue).toBe(
      "国航物业酒店管理有限公司国航大厦分公司",
    );
    expect(field(result, "party_b").normalizedValue).toBe(
      "北京羽隶科技有限公司",
    );
    expect(field(result, "project_name").normalizedValue).toBe(
      "国航大厦停车场车位租赁",
    );
    expect(
      field(result, "project_name").warnings?.join(" ") || "",
    ).not.toContain("候选冲突");
    expect(field(result, "amount").normalizedValue).toBe("16320.00");
    expect(field(result, "contract_date").normalizedValue).toBe("2025-07-03");
    expect(terms).toEqual(
      expect.objectContaining({
        isRentalLease: true,
        leaseStartDate: "2025-07-01",
        leaseEndDate: "2025-12-31",
        monthlyRent: 2720,
        termMonths: 6,
        totalAmount: 16320,
        amountSource: "monthly_rent_calculated",
      }),
    );
  });

  it("租赁续签协议把新租期总额识别为正向补充金额", () => {
    const text = `房屋租赁续签协议
甲方：北京出租方有限公司
乙方：北京承租方有限公司
续租期自2027年01月01日起至2027年12月31日止。
续租期间每月租金为人民币10000元/月。
本续签协议一式肆份，甲乙双方各执贰份。
合同签订日期：2026年12月20日`;
    const result = parseContractText("", {
      sources: samePageIndependentSources(text),
      expectedCategory: "asset",
      relationType: "supplement",
      leaseOperationType: "renewal",
    });
    const amountSafety =
      getContractOcrAutomaticAdoptionSafetyContext(result)?.amount;

    expect(field(result, "amount").normalizedValue).toBe("120000.00");
    expect(getContractAmountBreakdown(result)).toMatchObject({
      changeAmount: 120000,
    });
    expect(amountSafety).toMatchObject({
      selectedValue: "120000.00",
      role: "relation_adjustment",
      scope: "relation_total",
      strongEvidence: true,
    });
    expect(
      result.warnings.join(" ") +
        result.fields.flatMap((item) => item.warnings || []).join(" "),
    ).not.toContain("合同层级不一致");
  });

  it("独立续签主合同采用自身总额且专用上下文只放行续签标题", () => {
    const text = `房屋租赁续签协议
甲方：北京出租方有限公司
乙方：北京承租方有限公司
续租期自2027年01月01日起至2027年12月31日止。
续租期间每月租金为人民币10000元/月。
本续签协议一式肆份，甲乙双方各执贰份。
合同签订日期：2026年12月20日`;
    const renewalMain = parseContractText("", {
      sources: samePageIndependentSources(text),
      expectedCategory: "asset",
      relationType: "main",
      renewalMain: true,
    });
    const ordinaryMain = parseContractText("", {
      sources: samePageIndependentSources(text),
      expectedCategory: "asset",
      relationType: "main",
    });

    expect(field(renewalMain, "amount").normalizedValue).toBe("120000.00");
    expect(getContractAmountBreakdown(renewalMain)).toEqual({
      originalAmount: 120000,
      changeAmount: 0,
      finalAmount: 120000,
    });
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(renewalMain)?.amount,
    ).toMatchObject({
      selectedValue: "120000.00",
      role: "contract_total",
      scope: "current_contract",
      strongEvidence: true,
    });
    expect(renewalMain.status).not.toBe("failed");
    expect(ordinaryMain.status).toBe("failed");
    expect(ordinaryMain.warnings.join(" ")).toContain("合同层级不一致");
  });

  it("资产租赁没有身份证字段佐证时不把普通短词猜成自然人主体", () => {
    const text = `小客车租赁协议
甲方（出租方）：曾宇
乙方（承租方）：北京羽隶工程咨询有限公司
租赁期限自2025年10月31日至2026年10月31日
每月租金人民币780元`;
    const result = parseContractText(text, { expectedCategory: "asset" });

    expect(field(result, "party_a").normalizedValue).toBe("");
    expect(field(result, "party_b").normalizedValue).toBe(
      "北京羽隶工程咨询有限公司",
    );
  });

  it("非租赁合同即使邻近身份证号也不放宽自然人主体门禁", () => {
    const result = parseContractText(
      `技术咨询服务合同
甲方：张三
身份证号：110108198211094915
乙方：北京羽隶工程咨询有限公司
项目名称：规划咨询项目
合同金额：100000元`,
      { expectedCategory: "non_main" },
    );

    expect(field(result, "party_a").normalizedValue).toBe("");
  });

  it("房屋租赁合同正文明确租金总额时优先采用总额", () => {
    const result = parseContractText(
      `房屋租赁合同
出租方（甲方）：北京甲方有限公司
承租方（乙方）：北京乙方有限公司
项目：库房租赁
租赁期限：2026年1月1日至2027年12月31日
月租金：人民币10,000.00元/月
租赁期内租金总额：人民币230,000.00元
押金收据：20,000.00元`,
      { expectedCategory: "asset" },
    );
    expect(field(result, "amount").normalizedValue).toBe("230000.00");
  });

  it("房屋租赁合同正文明确综合总金额时优先于月度固定费用计算", () => {
    const text = `房屋租赁合同
出租方（甲方）：北京甲方有限公司
承租方（乙方）：北京乙方有限公司
租赁期限：2026年1月1日至2026年12月31日，共12个月
月含税租金为人民币10,000.00元
月含税物业管理费为人民币2,000.00元
租金及物业管理费总额为人民币150,000.00元
首期租金及物业管理费合计人民币36,000.00元`;
    const result = parseContractText(text, { expectedCategory: "asset" });
    const terms = extractContractLeaseTerms(result.rawText, "asset");

    expect(terms).toEqual(
      expect.objectContaining({
        monthlyRent: 10000,
        monthlyPropertyManagementFee: 2000,
        termMonths: 12,
        totalAmount: 150000,
        amountSource: "contract_total",
      }),
    );
    expect(field(result, "amount").normalizedValue).toBe("150000.00");
  });

  it("房屋租赁合同不把水电费、维修费和一次性费用计入固定总额", () => {
    const text = `房屋租赁合同
出租方（甲方）：北京甲方有限公司
承租方（乙方）：北京乙方有限公司
租赁期限：2026年1月1日至2026年12月31日，共12个月
月含税租金为人民币10,000.00元
水费、电费、燃气费按实际发生结算，本月合计1,500.00元
公共区域维修、更新和改造费用20,000.00元
一次性装修服务费30,000.00元
租金保证金20,000.00元
首期付款金额50,000.00元`;
    const result = parseContractText(text, { expectedCategory: "asset" });
    const terms = extractContractLeaseTerms(result.rawText, "asset");

    expect(terms).toEqual(
      expect.objectContaining({
        monthlyRent: 10000,
        monthlyPropertyManagementFee: null,
        termMonths: 12,
        totalAmount: 120000,
        amountSource: "monthly_rent_calculated",
      }),
    );
    expect(field(result, "amount").normalizedValue).toBe("120000.00");
  });

  it("印章遮挡含税物业费首位时使用不含税金额和税率精确恢复", () => {
    const text = `房屋租赁合同
出租方（甲方）：北京甲方有限公司
承租方（乙方）：北京乙方有限公司
租赁期限：2025年6月16日至2027年6月15日，共24个月
月含税租金为人民币20378.00元
月含税物业管理费为人民币120.00元（大写：陆任壹佰贰拾元整）
（增值税率6%），月不含税物业管理费共计人民币5773.58元
首期物业管理费人民币18360.00元`;
    const result = parseContractText(text, { expectedCategory: "asset" });
    const terms = extractContractLeaseTerms(result.rawText, "asset");

    expect(terms).toEqual(
      expect.objectContaining({
        monthlyRent: 20378,
        monthlyPropertyManagementFee: 6120,
        termMonths: 24,
        totalAmount: 635952,
        amountSource: "monthly_rent_property_fee_calculated",
      }),
    );
    expect(field(result, "amount").normalizedValue).toBe("635952.00");
  });

  it("房屋租赁协议支持跨行期限和租赁单元月含税租金格式", () => {
    const text = `国航大厦臻选房间租赁协议
甲方（出租方）：国航物业酒店管理有限公司国航大厦分公司
乙方（承租方）：北京羽隶科技有限公司
第三条 租赁期限
本协议租赁期限自2025年6月16日起至2027
年6月15日止，共24个月（包括首尾两日）。
第四条 租金及物业管理费
租赁期限内，该租赁单元月含税租金为人民币20378.00元
月含税物业管理费为人民币6120.00元
租金保证金共计人民币61134.00元
首期款项合计人民币158988.00元`;
    const result = parseContractText(text, { expectedCategory: "asset" });
    const terms = extractContractLeaseTerms(result.rawText, "asset");

    expect(terms).toEqual(
      expect.objectContaining({
        isRentalLease: true,
        leaseStartDate: "2025-06-16",
        leaseEndDate: "2027-06-15",
        monthlyRent: 20378,
        monthlyPropertyManagementFee: 6120,
        termMonths: 24,
        totalAmount: 635952,
        amountSource: "monthly_rent_property_fee_calculated",
      }),
    );
    expect(field(result, "amount").normalizedValue).toBe("635952.00");
  });

  it("识别标准工程咨询合同的全部关键字段", () => {
    const result = parseContractText(`
      北京市轨道交通建设项目工程咨询服务合同
      项目名称：北京市轨道交通建设项目
      甲方：北京基础设施建设有限公司
      乙方：北京工程咨询有限公司
      合同金额：人民币1,000,000.00元（大写：人民币壹佰万元整）
      本合同为工程咨询服务合同。
      签订日期：2025年6月16日
    `);

    expect(result.status).toBe("succeeded");
    expect(field(result, "party_a").normalizedValue).toBe(
      "北京基础设施建设有限公司",
    );
    expect(field(result, "party_b").normalizedValue).toBe(
      "北京工程咨询有限公司",
    );
    expect(field(result, "project_name").normalizedValue).toBe(
      "北京市轨道交通建设项目",
    );
    expect(field(result, "amount").normalizedValue).toBe("1000000.00");
    expect(field(result, "amount").confidence).toBeGreaterThanOrEqual(90);
    expect(field(result, "category").normalizedValue).toBe("main_business");
    expect(field(result, "contract_date").normalizedValue).toBe("2025-06-16");
    expect(result.fields.every((item) => item.confidence === 100)).toBe(true);
    expect(isContractOcrVerifiedConfidence(100)).toBe(true);
    expect(isContractOcrVerifiedConfidence("100")).toBe(true);
    expect(isContractOcrVerifiedConfidence(99)).toBe(false);
    expect(isContractOcrVerifiedConfidence(95)).toBe(false);
    expect(isContractOcrVerifiedConfidence(94)).toBe(false);
    expect(isContractOcrVerifiedConfidence(101)).toBe(false);
    expect(isContractOcrVerifiedConfidence(99.99)).toBe(false);
    expect(isContractOcrVerifiedConfidence(99.999)).toBe(false);
    expect(isContractOcrVerifiedConfidence(true)).toBe(false);
    expect(isContractOcrVerifiedConfidence([100])).toBe(false);
    expect(result.ocrLines).toEqual([]);
  });

  it("完整项目名称不得跨越后续签订日期和合同总金额字段", () => {
    const text = [
      "软件合同",
      "合同类型：资产类合同",
      "甲方：北京客户管理有限公司",
      "乙方：北京羽隶工程咨询有限公司",
      "项目名称：办公软件采购项目",
      "合同签订日期：2025年8月25日",
      "合同总金额：人民币800000元",
    ].join("\n");
    const result = parseContractText("", {
      sources: samePageIndependentSources(text),
      expectedCategory: "asset",
      relationType: "main",
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "办公软件采购项目",
    );
    expect(field(result, "project_name").confidence).toBe(100);
    expect(result.status).toBe("succeeded");
  });

  it("资产类合同优先采用首页标题并剔除封面编号和文档类型", () => {
    const text = [
      "《国航大厦臻选房间租赁协议》",
      "（中航建京航销合（2025）046号）",
      "编号：2025-A8H",
      "国航大厦臻选房间租赁协议",
      "出租方：国航物业酒店管理有限公司国航大厦分公司",
      "承租方：北京羽隶科技有限公司",
      "合同金额：79458.00元",
    ].join("\n");
    const result = parseContractText("", {
      sources: samePageIndependentSources(text),
      expectedCategory: "asset",
      relationType: "main",
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "国航大厦臻选房间租赁",
    );
    expect(field(result, "project_name").normalizedValue).not.toMatch(
      /编号|2025-A8H|协议/u,
    );
    expect(field(result, "category")).toEqual(
      expect.objectContaining({
        normalizedValue: "asset",
        evidence: [
          expect.objectContaining({
            text: "上传合同前选择",
            source: "rule",
          }),
        ],
      }),
    );
  });

  it.each(["付款方式：银行转账", "合同生效时间：2025年8月26日"])(
    "完整项目名称不得吞入后续元数据行：%s",
    (followingMetadata) => {
      const text = [
        "软件合同",
        "合同类型：资产类合同",
        "甲方：北京客户管理有限公司",
        "乙方：北京羽隶工程咨询有限公司",
        "项目名称：办公软件采购项目",
        followingMetadata,
        "合同签订日期：2025年8月25日",
        "合同总金额：人民币800000元",
      ].join("\n");
      const result = parseContractText("", {
        sources: samePageIndependentSources(text),
        expectedCategory: "asset",
        relationType: "main",
      });
      const project = field(result, "project_name");

      expect(project.normalizedValue).toBe("办公软件采购项目");
      expect(project.candidates).toEqual([
        expect.objectContaining({ normalizedValue: "办公软件采购项目" }),
      ]);
      expect(
        project.evidence?.every((item) => !item.text.includes("银行转账")),
      ).toBe(true);
    },
  );

  it("无续行标点但具有明确项目语义时安全拼接完整名称", () => {
    const text = [
      "项目名称：温泉-稻香湖110千伏线路工程建设工程规",
      "划许可证、施工许可证",
    ].join("\n");
    const project = field(
      parseContractText("", { sources: samePageIndependentSources(text) }),
      "project_name",
    );

    expect(project.normalizedValue).toBe(
      "温泉-稻香湖110千伏线路工程建设工程规划许可证、施工许可证",
    );
    expect(project.warnings?.join(" ") || "").not.toContain("无标志续行");
  });

  it("东玉河项目名称跨行拼接并在甲方字段前停止", () => {
    const project = field(
      parseContractText(
        [
          "项目名称：东玉河220千伏输变电工程工程规划许可证、施",
          "工许可证",
          "甲方：国网北京市电力公司",
        ].join("\n"),
      ),
      "project_name",
    );

    expect(project.normalizedValue).toBe(
      "东玉河220千伏输变电工程工程规划许可证、施工许可证",
    );
    expect(project.normalizedValue).not.toContain("国网北京市电力公司");
  });

  it("项目名称在前期手续词中断行时拼接完整并在委托方前停止", () => {
    const expected = "CBD500千伏输变电工程（变电部分）前期手续技术服务";
    const result = parseContractText("", {
      expectedCategory: "main_business",
      relationType: "main",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: [
            "合同编号（甲方）：",
            "合同编号（乙方）：",
            "项目名称：CBD500千伏输变电工程（变电部分）前",
            "合同编号（乙方）：",
            "项目名称：",
            "CBD500千伏输变电工程（变电部分）前",
            "期手续技术服务",
            "委托方（甲方）：国网北京市电力公司",
          ].join("\n"),
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: [
            "项目名称：CBD500千伏输变电工程（变电部分）前",
            "期手续技术服务",
            "委托方（甲方）：国网北京市电力公司",
          ].join("\n"),
        },
      ],
    });
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe(expected);
    expect(project.normalizedValue).not.toContain("国网北京市电力公司");
    expect(
      project.evidence?.some((item) => item.text.includes("期手续技术服务")),
    ).toBe(true);
  });

  it("首页项目名称字段跨行包含合同尾词时优先于正文语法项目候选", () => {
    const expected =
      "新材料110千伏输变电工程工程规划许可证、施工许可证技术服务";
    const bodyText =
      "鉴于本合同为甲方委托乙方就国网北京海淀供电公司新材料110千伏输变电工程工程规划许可证、施工许可证项目进行的专项技术服务，并支付相应的技术服务报酬。";
    const result = parseContractText("", {
      expectedCategory: "main_business",
      relationType: "main",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: [
            "技术服务合同",
            "项目名称：新材料110千伏输变电工程工程规划许可",
            "证、施工许可证技术服务合同",
            "委托方（甲方）：国网北京市电力公司",
          ].join("\n"),
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: [
            "技术服务合同",
            "项目名称：新材料110千伏输变电工程工程规划许可",
            "证、施工许可证技术服务合同",
            "委托方（甲方）：国网北京市电力公司",
          ].join("\n"),
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: bodyText,
        },
        {
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: bodyText,
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(expected);
    expect(
      field(result, "project_name").warnings?.join(" ") || "",
    ).not.toContain("候选冲突");
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.project.riskCodes,
    ).not.toContain("PROJECT_CANDIDATE_CONFLICT");
  });

  it("主营项目合同首页唯一完整项目名称优先于后页正文多档候选", () => {
    const expected =
      "新材料110千伏输变电工程工程规划许可证、施工许可证技术服务";
    const bodyProject = "新材料110千伏输变电工程工程规划许可证、施工许可证";
    const bodyText = `甲方委托乙方就${bodyProject}项目进行专项技术服务。`;
    const result = parseContractText("", {
      expectedCategory: "main_business",
      relationType: "main",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: [
            "项目名称：新材料110千伏输变电工程工程规划许可",
            "HY",
            "合同",
            "证、施工许可证技术服务合同",
            "委托方（甲方）：国网北京市电力公司",
          ].join("\n"),
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: bodyText,
        },
        {
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: bodyText,
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(expected);
    expect(field(result, "project_name").pageNumber).toBe(1);
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.project.riskCodes,
    ).not.toContain("PROJECT_CANDIDATE_CONFLICT");
  });

  it("首页项目名称断行只识别到规划许可时由正文完整闭合句补齐", () => {
    const expected = "新材料110千伏输变电工程工程规划许可证、施工许可证";
    const bodyText =
      "鉴于本合同为甲方委托乙方就国网北京海淀供电公司新材料110千伏输变电工程工程规划许可证、施工许可证项目进行的专项技术服务，并支付相应的技术服务报酬。";
    const result = parseContractText("", {
      expectedCategory: "main_business",
      relationType: "main",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: "项目名称：新材料110千伏输变电工程工程规划许可",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: "项目名称：新材料110千伏输变电工程工程规划许可",
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: bodyText,
        },
        {
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: bodyText,
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(expected);
    expect(
      field(result, "project_name").warnings?.join(" ") || "",
    ).not.toContain("候选冲突");
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.project.riskCodes,
    ).not.toContain("PROJECT_CANDIDATE_CONFLICT");
  });

  it("创新园标题区域跨行保留完整括号说明并去除供电公司抬头", () => {
    const project = field(
      parseContractText(
        [
          "项目名称：国网北京海淀供电公司创新园",
          "110千伏变电站不动产权",
          "（国有建设用地）",
          "委托方：国网北京海淀供电公司",
        ].join("\n"),
      ),
      "project_name",
    );

    expect(project.normalizedValue).toBe(
      "创新园110千伏变电站不动产权（国有建设用地）",
    );
    expect(project.normalizedValue).not.toContain("供电公司");
  });

  it("首页无项目标签的跨行合同标题可提出完整项目名称", () => {
    const project = field(
      parseContractText(
        [
          "东玉河220千伏输变电工程工程规划许可证、施",
          "工许可证技术服务合同",
          "甲方：国网北京市电力公司",
        ].join("\n"),
      ),
      "project_name",
    );

    expect(project.normalizedValue).toBe(
      "东玉河220千伏输变电工程工程规划许可证、施工许可证",
    );
  });

  it("自动修复真实扫描合同的跨行项目名、乙方括号和跨行金额", () => {
    const result = parseContractText("", {
      fileName:
        "1-技术服务合同-跃进110千伏输变电工程不动产登记(土地证)-20250825￥95000.pdf",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          text: [
            "技术服务合同",
            "（土",
            "项目名称：跃进110千伏输变电工程不动产登记",
            "",
            "地证)",
            "委托方（甲方)：国网北京市电力公司",
            "(乙方):北京羽隶工程咨询有限公司",
            "签订时间：20n.6.2",
          ].join("\n"),
        },
        {
          source: "ocr_480",
          pageNumber: 6,
          confidence: 0.98,
          lineConfidences: [0.81, 0.8, 0.81, 0.8],
          text: [
            "5.技术服务报酬及支付方式",
            "5.1技术服务报酬总额为：人民币（大写）玖万伍任元整（￥95",
            "000.00）（含税），其中，不含税价人民币捌万玖仟陆佰贰拾贰元陆角肆分",
            "）（￥89622.64），增值税税率6%",
          ].join("\n"),
        },
        {
          source: "ocr_480",
          pageNumber: 11,
          confidence: 0.98,
          lineConfidences: [0.81],
          text: "技术服务报酬总额为95000元",
        },
        {
          source: "ocr_600",
          pageNumber: 1,
          confidence: 0.98,
          text: [
            "合同编号（乙方）：",
            "（土",
            "项目名称：跃进110千伏输变电工程不动产登记",
            "北京羽建",
            "H.",
            "地证）",
            "签订时间：2025.6.2r",
          ].join("\n"),
        },
      ],
    });

    expect(result.status).toBe("partial");
    expect(field(result, "party_a").normalizedValue).toBe("国网北京市电力公司");
    expect(field(result, "party_b").normalizedValue).toBe(
      "北京羽隶工程咨询有限公司",
    );
    expect(field(result, "party_b").originalValue).toBe(
      "北京羽隶工程咨询有限公司",
    );
    expect(field(result, "party_b").evidence?.[0]?.text).toBe(
      "(乙方):北京羽隶工程咨询有限公司",
    );
    expect(field(result, "project_name").normalizedValue).toBe(
      "跃进110千伏输变电工程不动产登记（土地证）",
    );
    expect(field(result, "project_name").normalizedValue).not.toContain(
      "北京羽建",
    );
    expect(field(result, "project_name").originalValue).not.toContain(
      "北京羽建",
    );
    expect(field(result, "amount").normalizedValue).toBe("95000.00");
    expect(field(result, "amount").confidence).toBeGreaterThanOrEqual(90);
    expect(field(result, "category").normalizedValue).toBe("main_business");
    expect(field(result, "contract_date").normalizedValue).toBe("");
    expect(field(result, "contract_date").candidates).toBeUndefined();
    expect(result.fields.every((item) => item.confidence < 100)).toBe(true);
  });

  it("同页三档清晰度一致时可增强完整项目名称的可信度", () => {
    const projectText = [
      "（土",
      "项目名称：跃进110千伏输变电工程不动产登记",
      "地证）",
    ].join("\n");
    const result = parseContractText("", {
      sources: (["ocr_300", "ocr_480", "ocr_600"] as const).map(
        (source, index) => ({
          source,
          pageNumber: 1,
          confidence: 0.9,
          lineConfidences: [0.82 + index * 0.01, 0.98, 0.82 + index * 0.01],
          text: projectText,
        }),
      ),
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "跃进110千伏输变电工程不动产登记（土地证）",
    );
    expect(field(result, "project_name").confidence).toBeGreaterThanOrEqual(90);
    expect(field(result, "project_name").confidence).toBeLessThan(100);
    expect(result.status).toBe("partial");
  });

  it("首页项目名称分行截断时由正文两档同值闭合句补强安全来源", () => {
    const completeProject = "跃进110千伏输变电工程不动产登记（土地证）项目";
    const bodyText = [
      "鉴于本合同为甲方委托乙方就国网北京海淀供电公司跃进110",
      "千伏输变电工程不动产登记（土地证）项目进行的专项技术服务，并",
      "支付相应的技术服务报酬。",
    ].join("\n");
    const result = parseContractText("", {
      expectedCategory: "main_business",
      relationType: "main",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          text: [
            "技术服务合同",
            "委托方（甲方）：国网北京市电力公司",
            "受托方（乙方）：北京羽隶工程咨询有限公司",
            "项目名称：跃进110千伏输变电工程不动产登记（土",
          ].join("\n"),
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.99,
          text: bodyText,
        },
        {
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.99,
          text: bodyText,
        },
        {
          source: "ocr_300",
          pageNumber: 6,
          confidence: 0.99,
          text: "技术服务报酬总额为95000元（含税）",
        },
        {
          source: "ocr_300",
          pageNumber: 12,
          confidence: 0.99,
          text: "签订日期：2025年8月25日",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(completeProject);
    const safety = getContractOcrAutomaticAdoptionSafetyContext(result);
    expect(safety?.project).toMatchObject({
      selectedValue: completeProject,
      candidateExists: true,
      trustedSource: true,
      strongEvidence: true,
      origin: "body_description",
    });
    expect(safety?.project.riskCodes).not.toContain("PROJECT_SOURCE_UNTRUSTED");
  });

  it("独立项目字段优先采用冒号后的完整项目名称", () => {
    const expected = "跃进110千伏输变电工程不动产登记（土地证）";
    const result = parseContractText("", {
      sources: [
        {
          text: [
            "项目：跃进110千伏输变电工程不动产登记（土地证）",
            "项目名称：跃进110千伏输变电工程不动产登记（土科隶工程地证）",
          ].join("\n"),
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: "项目名称：跃进110千伏输变电工程不动产登记（土科隶工程地证）",
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(expected);
    expect(
      field(result, "project_name")
        .originalValue.replace(/\(/g, "（")
        .replace(/\)/g, "）"),
    ).toBe(expected);
  });

  it("非首页合同名称经两档可见识别一致复核后自动采用完整产品协议名称", () => {
    const expected = "北京联通公有云标准产品协议";
    const sourceText = ["合同名称", expected].join("\n");
    const result = parseContractText("", {
      sources: [
        {
          text: sourceText,
          source: "ocr_300",
          pageNumber: 8,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: sourceText,
          source: "ocr_480",
          pageNumber: 8,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(expected);
    const safety = getContractOcrAutomaticAdoptionSafetyContext(result);
    expect(safety?.project).toMatchObject({
      selectedValue: expected,
      trustedSource: true,
      strongEvidence: true,
      distinctCandidateCount: 1,
      uniqueOrSufficientGap: true,
      genericContractType: false,
    });
    expect(safety?.project.riskCodes).toEqual([]);
  });

  it("独立项目名称字段优先于首页合同标题和正文派生候选", () => {
    const expected = "跃进110千伏输变电工程不动产登记（土地证）";
    const result = parseContractText("", {
      sources: [
        {
          text: [
            "国网北京海淀朝阳供电公司",
            "跃进110千伏输变电工程不动产登记（土地证）",
            "前期手续技术服务合同",
            "项目名称：跃进110千伏输变电工程不动产登记（土地证）",
            "委托方（甲方）：国网北京市电力公司",
            "受托方（乙方）：北京羽隶工程咨询有限公司",
            "鉴于本合同为甲方委托乙方就跃进110千伏输变电工程不动产登记（土地证）项目进行的专项技术服务。",
          ].join("\n"),
          source: "docx_text",
          confidence: 0.99,
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(expected);
    expect(field(result, "project_name").evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: `项目名称:${expected.replace(/（/g, "(").replace(/）/g, ")")}`,
        }),
      ]),
    );
  });

  it("完整项目字段不追加正文句式中的项目语法词", () => {
    const expected = "跃进110千伏输变电工程不动产登记（土地证）";
    const bodyText =
      "鉴于本合同为甲方委托乙方就跃进110千伏输变电工程不动产登记（土地证）项目进行的专项技术服务。";
    const result = parseContractText("", {
      sources: [
        {
          text: [
            "项目名称：跃进110千伏输变电工程不动产登记（土",
            "地证）",
          ].join("\n"),
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: bodyText,
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: bodyText,
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(expected);
    expect(field(result, "project_name").normalizedValue).not.toMatch(/项目$/u);
  });

  it("清理页眉合同文字插入规划许可证中间的版面噪声", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: "项目名称：温泉-稻香湖110千伏线路工程建设工程规合同划许可证、施工许可证",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "温泉-稻香湖110千伏线路工程建设工程规划许可证、施工许可证",
    );
  });

  it("朝阳样本明确项目字段保留完整技术咨询服务尾词并去除跨行重复尾串", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          text: "项目名称：柳芳110千伏输变电工程前期手续技术咨柳芳110千伏输变电工程前期手续",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.98,
          text: "项目名称：柳芳110千伏输变电工程前期手续技术咨\n询服务",
        },
        {
          source: "ocr_600",
          pageNumber: 1,
          confidence: 0.98,
          text: "项目名称：柳芳柳芳110千伏输变电工程前期手续技术咨询服务委托方",
        },
      ],
    });

    const project = field(result, "project_name");
    expect(project.normalizedValue).toBe(
      "柳芳110千伏输变电工程前期手续技术咨询服务",
    );
    expect(project.confidence).toBeGreaterThanOrEqual(90);
    expect(project.confidence).toBeLessThan(100);
    expect(
      new Set(
        project.candidates?.map((candidate) => candidate.normalizedValue),
      ),
    ).toEqual(new Set(["柳芳110千伏输变电工程前期手续技术咨询服务"]));
  });

  it.each(["签订地点：北京市", "有效期限：两年（2025年至2027年）"])(
    "明确项目名称在同一行遇到后续元数据时停止：%s",
    (metadata) => {
      const project = field(
        parseContractText(
          `项目名称：柳芳110千伏输变电工程前期手续技术咨询服务 ${metadata}`,
        ),
        "project_name",
      );

      expect(project.normalizedValue).toBe(
        "柳芳110千伏输变电工程前期手续技术咨询服务",
      );
      expect(project.originalValue).not.toContain(metadata);
    },
  );

  it("丰台样本项目名称去除供电公司抬头插入造成的重复前半段", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "pdf_text",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "pdf_text",
          text: "项目名称：国网北京丰台供电公司计量工区土地手续办理服务/国网北京丰台供电公司生产综合楼西楼房产手续办理服务",
        },
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.96,
          recognitionEngine: "paddleocr",
          text: "项目名称：国网北京丰台供电公司计量工区土地手续国网北京丰台供电公司计量工区土地手续办理服务/国网北京丰台供电公司生产综合楼西楼房产手续办理服务",
        },
      ],
    });

    const project = field(result, "project_name");
    expect(project.normalizedValue).toBe(
      "计量工区土地手续办理服务/生产综合楼西楼房产手续办理服务",
    );
    expect(
      new Set(
        project.candidates?.map((candidate) => candidate.normalizedValue),
      ),
    ).toEqual(
      new Set(["计量工区土地手续办理服务/生产综合楼西楼房产手续办理服务"]),
    );
  });

  it("门头沟样本项目名称去除供电公司抬头和重复工程前缀", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.97,
          text: "项目名称：岢罗坨110千伏国网北京门头沟供电公司岢罗坨110千伏一输变电工程变电站房产手续办理",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.97,
          text: "项目名称：丨国网北京门头沟供电公司岢罗坨110千伏\n输变电工程变电站房产手续办理",
        },
        {
          source: "ocr_600",
          pageNumber: 1,
          confidence: 0.97,
          text: "项目名称：岢罗坨国网北京门头沟供电公司岢罗坨 110千伏输变电工程变电站房产手续办理",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.97,
          text: "项目名称：国网北京门头沟供电公司岢罗坨国网北京门头沟供电公司岢罗坨110千伏输变电工程变电站房产手续办理",
        },
      ],
    });

    const project = field(result, "project_name");
    expect(project.normalizedValue).toBe(
      "岢罗坨110千伏输变电工程变电站房产手续办理",
    );
    expect(project.confidence).toBeGreaterThanOrEqual(90);
    expect(project.confidence).toBeLessThan(100);
    expect(
      new Set(
        project.candidates?.map((candidate) => candidate.normalizedValue),
      ),
    ).toEqual(new Set(["岢罗坨110千伏输变电工程变电站房产手续办理"]));
  });

  it("不会把乙方公司名称中的工程咨询误当作合同分类证据", () => {
    const result = parseContractText("乙方：北京羽隶工程咨询有限公司");

    expect(field(result, "party_b").normalizedValue).toBe(
      "北京羽隶工程咨询有限公司",
    );
    expect(field(result, "category").normalizedValue).toBe("");
  });

  it("自动归并跨行项目、截断公司名和跨行中文大写金额", () => {
    const result = parseContractText(`
      技术服务合同
      项目名称：国网北京丰台供电公司计量工区土地手续办理服务/
      国网北京丰台供电公司生产综合楼西楼房产手续办理服务
      委托方（甲方）：国网北京市电力公司
      受托方（乙方）：北京羽隶工程咨询有限公司
      甲方：国网北京市电力公司 乙方：北京羽隶工程咨询有限公
      技术服务报酬总额为：人民币（大写）拾肆万壹仟伍佰伍
      拾元整（¥141550）（含税）
      签订日期：2025年12月23日
    `);

    expect(result.status).toBe("succeeded");
    expect(field(result, "party_b").normalizedValue).toBe(
      "北京羽隶工程咨询有限公司",
    );
    expect(field(result, "party_b").confidence).toBeGreaterThanOrEqual(90);
    expect(field(result, "project_name").normalizedValue).toBe(
      "计量工区土地手续办理服务/生产综合楼西楼房产手续办理服务",
    );
    expect(field(result, "amount").normalizedValue).toBe("141550.00");
    expect(field(result, "amount").confidence).toBeGreaterThanOrEqual(90);
    expect(result.fields.every((item) => item.confidence === 100)).toBe(true);
  });

  it("带空格的委托人和受托人标签既识别主体也终止项目续行", () => {
    const result = parseContractText(
      [
        "项目名称：国网北京海淀供电公司后屯 110 千伏变电站房屋检测服务",
        "委 托 人 ： 北京市建设工程质量第三检测所有限责任公司",
        "（甲方）",
        "受 托 人 ： 北京羽隶工程咨询有限公司",
        "（乙方）",
      ].join("\n"),
    );

    expect(field(result, "project_name").normalizedValue).toBe(
      "后屯110千伏变电站房屋检测服务",
    );
    expect(field(result, "project_name").normalizedValue).not.toContain(
      "委托人",
    );
    expect(field(result, "party_a").normalizedValue).toBe(
      "北京市建设工程质量第三检测所有限责任公司",
    );
    expect(field(result, "party_b").normalizedValue).toBe(
      "北京羽隶工程咨询有限公司",
    );
  });

  it("明确甲乙方标签后的单位名称优先于通用委托受托角色", () => {
    const result = parseContractText(
      [
        "委托方：北京旧项目管理有限公司",
        "委托方（甲方）：国网北京市电力公司",
        "受托方：北京旧咨询有限公司",
        "受托方（乙方）：北京羽隶工程咨询有限公司",
      ].join("\n"),
    );

    expect(field(result, "party_a").normalizedValue).toBe("国网北京市电力公司");
    expect(field(result, "party_b").normalizedValue).toBe(
      "北京羽隶工程咨询有限公司",
    );
    expect(field(result, "party_a").candidates).toHaveLength(1);
    expect(field(result, "party_b").candidates).toHaveLength(1);
  });

  it("无甲乙方括注的许可角色只保留诊断候选且不得自动采用", () => {
    const text = [
      "软件许可合同",
      "合同类型：资产类合同",
      "许可方：北京软件技术有限公司",
      "被许可方：北京羽隶工程咨询有限公司",
      "合同金额：人民币100000元",
      "合同签订日期：2025年8月25日",
      "项目名称：企业办公软件采购项目",
    ].join("\n");
    const result = parseContractText("", {
      sources: samePageIndependentSources(text),
      expectedCategory: "asset",
      relationType: "main",
    });

    expect(
      new Set([
        field(result, "party_a").normalizedValue,
        field(result, "party_b").normalizedValue,
      ]),
    ).toEqual(new Set(["北京软件技术有限公司", "北京羽隶工程咨询有限公司"]));
    expect(field(result, "party_a").confidence).toBeLessThan(100);
    expect(field(result, "party_b").confidence).toBeLessThan(100);
    expect(result.status).toBe("partial");
  });

  it("许可角色有显式甲乙方括注时按括注映射并可独立验证", () => {
    const text = [
      "软件许可合同",
      "合同类型：资产类合同",
      "许可方（乙方）：北京软件技术有限公司",
      "被许可方（甲方）：北京羽隶工程咨询有限公司",
      "合同金额：人民币100000元",
      "合同签订日期：2025年8月25日",
      "项目名称：企业办公软件采购项目",
    ].join("\n");
    const result = parseContractText("", {
      sources: samePageIndependentSources(text),
      expectedCategory: "asset",
      relationType: "main",
    });

    expect(field(result, "party_a").normalizedValue).toBe(
      "北京羽隶工程咨询有限公司",
    );
    expect(field(result, "party_b").normalizedValue).toBe(
      "北京软件技术有限公司",
    );
    expect(field(result, "party_a").confidence).toBe(100);
    expect(field(result, "party_b").confidence).toBe(100);
    expect(result.status).toBe("succeeded");
  });

  it("首页与签章区甲方候选冲突时降为低可信并保留候选", () => {
    const result = parseContractText(`
      甲方：北京建设有限公司
      乙方：北京咨询有限公司
      项目名称：测试建设项目
      合同金额：100000元
      技术咨询服务合同
      签订日期：2025年5月20日

      甲方（盖章）：北京城市建设有限公司
      乙方（盖章）：北京咨询有限公司
    `);
    const partyA = field(result, "party_a");

    expect(partyA.confidence).toBeLessThan(60);
    expect(partyA.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ normalizedValue: "北京建设有限公司" }),
        expect.objectContaining({ normalizedValue: "北京城市建设有限公司" }),
      ]),
    );
    expect(partyA.warnings?.join(" ")).toContain("候选冲突");
  });

  it("签章区的合同专用章文字不得成为甲方单位候选", () => {
    const result = parseContractText(
      ["甲方：国网北京市电力公司", "甲方（盖章）：合同专用章"].join("\n"),
    );
    const partyA = field(result, "party_a");

    expect(partyA.normalizedValue).toBe("国网北京市电力公司");
    expect(partyA.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "国网北京市电力公司" }),
    ]);
    expect(partyA.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("正文履约长句即使被误读成乙方冒号也不得成为单位候选", () => {
    const result = parseContractText(
      [
        "乙方：北京羽隶工程咨询有限公司",
        "乙方：技术评审会上对专题报告（表）进行技术答疑，并按评审专家和政府要求完成修改",
      ].join("\n"),
    );
    const partyB = field(result, "party_b");

    expect(partyB.normalizedValue).toBe("北京羽隶工程咨询有限公司");
    expect(partyB.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "北京羽隶工程咨询有限公司" }),
    ]);
    expect(partyB.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("仅剩公司或机构类型后缀的截断文字不得成为主体候选", () => {
    const partyB = field(
      parseContractText(
        ["乙方：北京羽隶工程咨询有限公司", "乙方（盖章）：公司"].join("\n"),
      ),
      "party_b",
    );

    expect(partyB.normalizedValue).toBe("北京羽隶工程咨询有限公司");
    expect(partyB.candidates).toHaveLength(1);
    expect(partyB.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("没有机构后缀的扫描名称残片不得与单位全称形成冲突", () => {
    const result = parseContractText(
      [
        "甲方：国网北京市电力公司",
        "甲方（盖章）：国风北京",
        "乙方：北京华源厚土科技有限公司",
        "乙方（盖章）：北京华",
      ].join("\n"),
    );

    expect(field(result, "party_a").candidates).toEqual([
      expect.objectContaining({ normalizedValue: "国网北京市电力公司" }),
    ]);
    expect(field(result, "party_b").candidates).toEqual([
      expect.objectContaining({ normalizedValue: "北京华源厚土科技有限公司" }),
    ]);
  });

  it("单位候选只缺标准法律后缀时归并到完整全称", () => {
    const result = parseContractText(
      [
        "乙方：北京筑联天合建筑设计咨询有限公司",
        "乙方（盖章）：北京筑联天合建筑设计咨询",
      ].join("\n"),
    );
    const partyB = field(result, "party_b");

    expect(partyB.normalizedValue).toBe("北京筑联天合建筑设计咨询有限公司");
    expect(partyB.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("多个明确甲方标签出现不同主体时保留冲突并阻止自动采用", () => {
    const result = parseContractText(
      [
        "甲方（盖章）：国网北京市电力公司",
        "乙方：北京羽隶工程咨询有限公司",
        "甲方：北京羽隶工程咨询有限公司",
      ].join("\n"),
    );
    const partyA = field(result, "party_a");
    const partyB = field(result, "party_b");

    expect(partyA.normalizedValue).toBe("国网北京市电力公司");
    expect(partyB.normalizedValue).toBe("北京羽隶工程咨询有限公司");
    expect(partyA.confidence).toBeLessThan(100);
    expect(partyA.warnings?.join(" ")).toContain("候选冲突");
    expect(
      new Set(partyA.candidates?.map((candidate) => candidate.normalizedValue)),
    ).toEqual(new Set(["国网北京市电力公司", "北京羽隶工程咨询有限公司"]));
  });

  it("通用角色标签产生的低优先镜像主体仍可安全清理", () => {
    const result = parseContractText(
      [
        "委托方（盖章）：国网北京市电力公司",
        "乙方：北京羽隶工程咨询有限公司",
        "委托方：北京羽隶工程咨询有限公司",
      ].join("\n"),
    );
    const partyA = field(result, "party_a");

    expect(partyA.normalizedValue).toBe("国网北京市电力公司");
    expect(partyA.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "国网北京市电力公司" }),
    ]);
    expect(partyA.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("归并单位名称前的 OCR 线条噪声且保留名称内部合法字符", () => {
    const result = parseContractText(`
      甲方：国网北京市电力公司
      乙方：北京羽隶工程咨询有限公司
      甲方（盖章）：\u200B_国网北京市电力公司
      乙方（盖章）：\uFEFF|北京羽隶工程咨询有限公司
    `);
    const partyA = field(result, "party_a");
    const partyB = field(result, "party_b");

    expect(partyA.normalizedValue).toBe("国网北京市电力公司");
    expect(partyB.normalizedValue).toBe("北京羽隶工程咨询有限公司");
    expect(partyA.warnings?.join(" ") || "").not.toContain("候选冲突");
    expect(partyB.warnings?.join(" ") || "").not.toContain("候选冲突");

    const legalInternalSymbol = parseContractText("乙方：A_1科技有限公司");
    expect(field(legalInternalSymbol, "party_b").normalizedValue).toBe(
      "A_1科技有限公司",
    );
  });

  it("不会把合同类型字段误识别为项目标题候选", () => {
    const result = parseContractText(`
      工程咨询服务合同
      项目名称：城区道路改造前期咨询项目
      合同类型：工程咨询服务合同
    `);
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe("城区道路改造前期咨询项目");
    expect(project.confidence).toBeGreaterThanOrEqual(90);
    expect(project.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "城区道路改造前期咨询项目" }),
    ]);
    expect(project.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("优先合同总金额并排除税额、预付款和付款节点金额", () => {
    const result = parseContractText(`
      合同总金额：人民币1,200,000元
      其中税额：人民币120,000元
      付款节点：预付款人民币300,000元
      进度款人民币500,000元
    `);

    expect(field(result, "amount").normalizedValue).toBe("1200000.00");
    expect(field(result, "amount").candidates).toHaveLength(1);
  });

  it("两路阿拉伯合同金额不一致时不使用中文大写消除冲突", () => {
    const visibleText = [
      "项目名称：北安河110千伏输变电工程项目（电缆隧道）临时用地土地复垦方案编制",
      "付款金额：3000元",
      "合同金额：人民币133000元",
      "大写：人民币壹拾叁万叁仟元整",
    ].join("\n");
    const truncatedText = visibleText.replace("133000元", "3000元");
    const result = parseContractText("", {
      sources: [
        {
          text: truncatedText,
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.91,
          recognitionEngine: "paddleocr",
        },
        {
          text: visibleText,
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
        },
      ],
    });
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("133000.00");
    expect(amount.warnings?.join(" ") || "").toContain("候选冲突");
    expect(getContractAmountAutomaticAdoptionContext(result)?.status).toBe(
      "missing_amount",
    );
    expect(amount.fieldScore).toBe(amount.confidence);
    // 最终候选保留其所在可见识别通道的原始置信度。
    expect(amount.ocrConfidence).toBeCloseTo(0.98);
  });

  it.each([
    "付款金额：3000元",
    "预付款：3000元",
    "进度款：3000元",
    "税额：3000元",
    "税费：3000元",
    "服务费：3000元",
    "单价：3000元",
  ])("低优先金额角色不能覆盖明确合同金额：%s", (secondaryAmount) => {
    const amount = field(
      parseContractText([secondaryAmount, "合同金额：133000元"].join("\n")),
      "amount",
    );

    expect(amount.normalizedValue).toBe("133000.00");
    expect(amount.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "133000.00" }),
    ]);
  });

  it("只有付款、税费、普通服务费或单价时不得猜成合同总额", () => {
    for (const text of [
      "付款金额：3000元",
      "税额：3000元",
      "服务费：3000元",
      "单价：3000元",
    ]) {
      expect(field(parseContractText(text), "amount").normalizedValue).toBe("");
    }
  });

  it("主合同正文存在分项金额时按合同总金额角色采用总额", () => {
    const result = parseContractText(
      [
        "合同编号：SGBJHD00JJJS2501407",
        "项目名称：温泉-稻香湖110千伏线路工程",
        "签订日期：2025年12月10日",
        "建设工程规划许可证含税总价：60000.00元",
        "施工许可证含税总价：20000.00元",
        "合同总金额：80000.00元",
      ].join("\n"),
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("80000.00");
    expect(amount.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "80000.00" }),
    ]);
    expect(amount.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("唯一明确合同总金额优先于更大的设备清单分项总价", () => {
    const text = [
      "软件合同",
      "合同类型：资产类合同",
      "甲方：北京客户管理有限公司",
      "乙方：北京羽隶工程咨询有限公司",
      "合同签订日期：2025年8月25日",
      "合同总金额：人民币800000元",
      "设备清单含税总价：人民币1000000元",
      "项目名称：办公软件采购项目",
    ].join("\n");
    const result = parseContractText("", {
      sources: samePageIndependentSources(text),
      expectedCategory: "asset",
      relationType: "main",
    });
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("800000.00");
    expect(amount.confidence).toBe(100);
    expect(amount.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "800000.00" }),
    ]);
    expect(result.status).toBe("succeeded");
  });

  it.each(["含税总价：人民币1000000元", "价税合计：人民币1000000元"])(
    "只有裸总价锚点时保留通用金额候选但不得自动满分：%s",
    (bareTotal) => {
      const text = [
        "软件合同",
        "合同类型：资产类合同",
        "甲方：北京客户管理有限公司",
        "乙方：北京羽隶工程咨询有限公司",
        "合同签订日期：2025年8月25日",
        bareTotal,
        "项目名称：办公软件采购项目",
      ].join("\n");
      const result = parseContractText("", {
        sources: samePageIndependentSources(text),
        expectedCategory: "asset",
        relationType: "main",
      });
      const amount = field(result, "amount");

      expect(amount.normalizedValue).toBe("1000000.00");
      expect(amount.confidence).toBeLessThanOrEqual(99);
      expect(amount.warnings?.join(" ")).toContain("未明确指向整份合同");
      expect(result.status).toBe("partial");
    },
  );

  it("合同总额后出现分项金额时不把分项误判为竞争总额", () => {
    const result = parseContractText(
      [
        "技术服务报酬总额为80000.00元（含税）。其中：建设工程规划许可证1个，含税价60000.00元；",
        "建筑工程施工许可证1个，含税价20000.00元。",
      ].join("\n"),
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("80000.00");
    expect(amount.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "80000.00" }),
    ]);
    expect(amount.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("合同总额锚点和值跨行时仍能识别且在其中分项前停止", () => {
    const result = parseContractText(
      [
        "技术服务报酬总额为：",
        "人民币捌万元整（￥80000.00）（含税）",
        "其 中：建设工程规划许可证含税价60000.00元",
      ].join("\n"),
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("80000.00");
    expect(amount.candidates).toHaveLength(1);
  });

  it("中文总额与下一行括号数字断开时采用含税总额并排除未税额和税额", () => {
    const result = parseContractText("", {
      expectedCategory: "main_business",
      relationType: "main",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 7,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: [
            "5.1技术服务报酬总额为：人民币（大写）叁拾玖万肆仟元整",
            "（￥394000.00）（含税），其中，不含税价人民币叁拾柒万",
            "壹仟陆佰玖拾捌元壹角壹分（大写）（￥371698.11），增值税",
            "税率6%，增值税税额22301.89元。",
          ].join("\n"),
        },
      ],
    });
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("394000.00");
    expect(amount.candidates).toEqual([
      expect.objectContaining({
        normalizedValue: "394000.00",
      }),
    ]);
    expect(amount.candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ normalizedValue: "371698.11" }),
        expect.objectContaining({ normalizedValue: "22301.89" }),
      ]),
    );
  });

  it.each([
    "（￥371698.11）（不含税），增值税税额22301.89元。",
    "（￥100000.00）（预付款）",
  ])("中文总额后的下一行低优先金额不得冒充合同总额：%s", (nextLine) => {
    const result = parseContractText(
      ["技术服务报酬总额为：人民币（大写）叁拾玖万肆仟元整", nextLine].join(
        "\n",
      ),
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("");
    expect(amount.candidates).toBeUndefined();
  });

  it("中文大写金额被截断且没有金额终止单位时不形成伪候选", () => {
    const result = parseContractText(
      [
        "技术服务报酬总额为294500.00元（含税）",
        "技术服务报酬总额为人民币（大写）贰拾玖万肆任伍",
      ].join("\n"),
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("294500.00");
    expect(amount.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "294500.00" }),
    ]);
    expect(amount.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("合同含税总价与未税价同页时只把含税总价作为合同金额", () => {
    const result = parseContractText(
      [
        "合同价格为人民币（大写）拾伍万元整（￥150000.00）（含税），其中：",
        "不含税价格人民币（大写）拾肆万壹仟伍佰零玖元肆角叁分（￥141509.43），",
        "增值税税额8490.57元。",
      ].join("\n"),
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("150000.00");
    expect(amount.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "150000.00" }),
    ]);
    expect(amount.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("劳务协议可从委托语句和本合同费用中提取项目及总额", () => {
    const result = parseContractText(
      [
        "CBD500千伏输变电工程（电力隧道）临时用地项目调查劳务服务协议书",
        "甲方委托乙方开展“CBD500千伏输变电工程（电力隧道）项目临时用地”项目调查劳务服务工作，经双方协商一致，签订本合同。",
        "本合同费用为：（大写）肆万贰仟贰佰玖拾肆元（¥42294元），本项目调查资料提交甲方后3天内一次性付清。",
      ].join("\n"),
    );

    expect(field(result, "project_name").normalizedValue).toBe(
      "CBD500千伏输变电工程（电力隧道）项目临时用地",
    );
    expect(field(result, "amount").normalizedValue).toBe("42294.00");
    expect(field(result, "amount").warnings?.join(" ") || "").not.toContain(
      "候选冲突",
    );
  });

  it("两个明确阿拉伯总额不一致时保留冲突并阻止自动采用", () => {
    const result = parseContractText(
      ["合同总金额：80000元", "补充约定合同总金额：60000元"].join("\n"),
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("80000.00");
    expect(amount.confidence).toBeLessThan(100);
    expect(
      new Set(amount.candidates?.map((candidate) => candidate.normalizedValue)),
    ).toEqual(new Set(["80000.00", "60000.00"]));
    expect(amount.warnings?.join(" ")).toContain("候选冲突");
  });

  it("同一金额条款明确指向价款优先时才采用特别约定总额", () => {
    const result = parseContractText(
      [
        "5.1 技术服务报酬总额为人民币贰拾柒万元整（¥270000.00）（含税）。",
        "特别约定：技术服务报酬总额为180000.00元（含税），如与其他价款约定不一致，以本特别约定金额为准。",
      ].join("\n"),
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("180000.00");
    expect(amount.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "180000.00" }),
    ]);
    expect(amount.warnings?.join(" ")).toContain("特别约定");
    expect(amount.warnings?.join(" ")).toContain("270000.00");
  });

  it("与金额无关的特别约定优先语义不得覆盖其他明确总额", () => {
    const result = parseContractText(
      [
        "合同总金额：人民币1,000,000元。",
        "特别约定：工期约定与其他条款不一致时，以本特别约定为准。",
        "附件说明：供应商合同金额：人民币100,000元。",
      ].join("\n"),
    );
    const amount = field(result, "amount");

    expect(amount.confidence).toBeLessThan(100);
    expect(
      new Set(amount.candidates?.map((candidate) => candidate.normalizedValue)),
    ).toEqual(new Set(["1000000.00", "100000.00"]));
    expect(amount.warnings?.join(" ")).toContain("候选冲突");
  });

  it("补充协议只采用本次核减额而不采用历次或变更后总额", () => {
    const result = parseContractText(
      [
        "原合同金额为230000元。",
        "前次补充协议增加20000元，合同金额调整为250000元。",
        "本次补充协议核减建设工程施工许可证1个，费用人民币陆万元整（￥60000.00），合同金额变更为190000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("-60000.00");
    expect(amount.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "-60000.00" }),
    ]);
    expect(amount.warnings?.join(" ")).toContain("本次增减额");
    expect(amount.warnings?.join(" ")).toContain("190000.00");
  });

  it("补充协议明确增加费用时采用正向本次增减额", () => {
    const result = parseContractText(
      "本次补充协议增加技术服务费人民币贰万元整（￥20000元），变更后合同总金额为250000元。",
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("20000.00");
  });

  it("补充协议内部区分原金额、本次增减额和最终金额且不改写amount_delta语义", () => {
    const result = parseContractText(
      [
        "补充协议",
        "原合同金额为230000元。",
        "本次补充协议增加合同费用人民币陆万元整（￥60000元）。",
        "调整后合同总金额为290000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("60000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 230000,
      changeAmount: 60000,
      finalAmount: 290000,
    });
    expect(field(result, "amount").warnings?.join(" ")).toContain(
      "finalAmount=290000.00",
    );
    expect(Object.keys(result)).not.toEqual(
      expect.arrayContaining(["originalAmount", "changeAmount", "finalAmount"]),
    );
  });

  it.each(["补充协议", "变更协议", "追加协议"])(
    "%s进入补充协议本次增减额规则",
    (title) => {
      const result = parseContractText(
        [title, "原合同金额100000元", "增加合同金额20000元"].join("\n"),
      );

      expect(field(result, "amount").normalizedValue).toBe("20000.00");
      expect(getContractAmountBreakdown(result)).toEqual({
        originalAmount: 100000,
        changeAmount: 20000,
        finalAmount: 120000,
      });
    },
  );

  it("普通协议书不能直接进入补充协议金额规则", () => {
    const result = parseContractText(
      ["技术服务协议书", "合同金额：100000元"].join("\n"),
    );

    expect(field(result, "amount").normalizedValue).toBe("100000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 100000,
      changeAmount: 0,
      finalAmount: 100000,
    });
  });

  it("协议书同时包含原合同和明确变更动作时进入补充协议规则", () => {
    const result = parseContractText(
      [
        "协议书",
        "原合同金额为100000元。",
        "本协议增加合同费用20000元，调整后合同金额为120000元。",
      ].join("\n"),
    );

    expect(field(result, "amount").normalizedValue).toBe("20000.00");
    expect(getContractAmountBreakdown(result)?.finalAmount).toBe(120000);
  });

  it("补充协议减少金额以负数保存并计算最终合同金额", () => {
    const result = parseContractText(
      ["变更协议", "原合同金额为230000元。", "本协议减少合同费用5000元。"].join(
        "\n",
      ),
    );

    expect(field(result, "amount").normalizedValue).toBe("-5000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 230000,
      changeAmount: -5000,
      finalAmount: 225000,
    });
  });

  it("补充协议多笔不同增减项汇总为本次净变化", () => {
    const result = parseContractText(
      [
        "追加协议",
        "原合同金额为230000元。",
        "本次增加规划服务费40000元。",
        "本次追加施工服务费20000元。",
        "调整后合同总金额为290000元。",
      ].join("\n"),
    );

    expect(field(result, "amount").normalizedValue).toBe("60000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 230000,
      changeAmount: 60000,
      finalAmount: 290000,
    });
  });

  it("终止协议标题和独立终止金额行进入负向增减规则", () => {
    const result = parseContractText(
      ["终止协议", "原合同金额为100000元。", "终止金额：20000元"].join("\n"),
    );

    expect(field(result, "amount").normalizedValue).toBe("-20000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 100000,
      changeAmount: -20000,
      finalAmount: 80000,
    });
  });

  it("补充协议明确原金额和变更后总额时以最终总额反算本次增减额", () => {
    const result = parseContractText(
      "原合同金额为230000元，变更后合同总金额为190000元。",
      { relationType: "supplement" },
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("-40000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 230000,
      changeAmount: -40000,
      finalAmount: 190000,
    });
    expect(amount.warnings?.join(" ")).toContain("明确调整后总金额");
  });

  it.each([
    "本协议将原合同金额由230000元减少至190000元。",
    "本次核减后合同金额为190000元。",
    "本协议调整后剩余金额为190000元。",
  ])("补充协议不得把减少至或调整后金额当作本次核减额：%s", (text) => {
    const result = parseContractText(text, { relationType: "supplement" });

    expect(field(result, "amount").normalizedValue).toBe("");
    expect(field(result, "amount").warnings?.join(" ")).toContain(
      "禁止用原合同金额或变更后总额替代",
    );
  });

  it("终止协议的明确终止金额按负向本次增减额保存", () => {
    const result = parseContractText(
      "双方一致同意解除本合同，终止金额为人民币伍万元整（￥50000元）。",
      { relationType: "termination" },
    );

    expect(field(result, "amount").normalizedValue).toBe("-50000.00");
  });

  it("关系调整额即使经同页文字层和图像识别一致也不伪造满分", () => {
    const text = "本次补充协议核减费用人民币陆万元整（￥60000元）。";
    const result = parseContractText("", {
      relationType: "supplement",
      sources: [
        {
          text,
          source: "pdf_text",
          pageNumber: 1,
          confidence: 99,
          recognitionEngine: "pdf_text",
        },
        {
          text,
          source: "ocr_300",
          pageNumber: 1,
          confidence: 99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(field(result, "amount").normalizedValue).toBe("-60000.00");
    expect(field(result, "amount").confidence).toBeLessThanOrEqual(99);
    expect(field(result, "amount").warnings?.join(" ")).toContain(
      "按当前协议明确增减事件自动排序",
    );
    expect(result.status).toBe("partial");
  });

  it("同句多个动作按金额前最近动作确定本次调整方向", () => {
    const result = parseContractText(
      "双方同意增加服务范围，同时减少合同费用人民币50000元。",
      { relationType: "supplement" },
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("-50000.00");
    expect(amount.confidence).toBeLessThanOrEqual(99);
    expect(amount.warnings?.join(" ")).toContain(
      "按当前协议明确增减事件自动排序",
    );
    expect(result.status).toBe("partial");
  });

  it("同句相同金额一增一减时按各自位置绑定动作并保留冲突", () => {
    const result = parseContractText(
      "本次补充协议增加合同费用人民币100元，同时减少合同费用人民币100元。",
      { relationType: "supplement" },
    );
    const amount = field(result, "amount");

    expect(
      new Set(amount.candidates?.map((candidate) => candidate.normalizedValue)),
    ).toEqual(new Set(["100.00", "-100.00"]));
    expect(amount.confidence).toBeLessThan(100);
    expect(amount.warnings?.join(" ")).toContain("候选冲突");
    expect(result.status).toBe("partial");
  });

  it("增加或减少方向无法绑定时不提出关系调整额候选", () => {
    const result = parseContractText(
      "本次补充协议增加或减少合同费用人民币50000元。",
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("");
    expect(field(result, "amount").warnings?.join(" ")).toContain(
      "未识别到当前协议明确写明的本次增减额",
    );
  });

  it("预计且最终以审计结果为准的补充金额不得成为自动最终值", () => {
    const result = parseContractText(
      "双方同意增加服务范围，预计增加费用人民币50000元，最终以审计结果为准。",
      { relationType: "supplement" },
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("50000.00");
    expect(amount.confidence).toBeLessThanOrEqual(99);
    expect(amount.warnings?.join(" ")).toContain("非最终金额语义");
    expect(result.status).toBe("partial");
  });

  it("终止协议的已履行金额只保留诊断候选并明确提示人工核对", () => {
    const result = parseContractText(
      "双方一致同意解除本合同，已履行部分金额人民币80000元，剩余未履行部分另行结算。",
      { relationType: "termination" },
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("-80000.00");
    expect(amount.confidence).toBeLessThanOrEqual(99);
    expect(amount.warnings?.join(" ")).toContain("已履行");
    expect(result.status).toBe("partial");
  });

  it.each([
    { relationType: "main" as const, title: "补充协议" },
    { relationType: "main" as const, title: "补充协议书（1）" },
    { relationType: "main" as const, title: "终止协议" },
    { relationType: "supplement" as const, title: "终止协议" },
    { relationType: "termination" as const, title: "补充协议" },
  ])(
    "上传层级 $relationType 与正文明确标题 $title 冲突时识别硬失败",
    ({ relationType, title }) => {
      const text = [
        title,
        "合同类型：主营项目合同",
        "甲方：国网北京市电力公司",
        "乙方：北京羽隶工程咨询有限公司",
        relationType === "termination"
          ? "双方同意解除本合同，终止金额人民币100000元"
          : relationType === "supplement"
            ? "本次补充协议增加合同费用人民币100000元"
            : "合同金额：人民币100000元",
        "合同签订日期：2025年8月25日",
        "项目名称：温泉110千伏工程",
      ].join("\n");
      const result = parseContractText("", {
        sources: samePageIndependentSources(text),
        expectedCategory: "main_business",
        relationType,
      });

      expect(result.status).toBe("failed");
      expect(result.failureKind).toBe("document");
      expect(result.warnings.join(" ")).toContain("合同层级不一致");
      expect(result.fields.every((item) => item.confidence < 100)).toBe(true);
    },
  );

  it("本次技术咨询总费用属于明确合同总额锚点", () => {
    const amount = field(
      parseContractText(
        "本次技术咨询总费用为38万元整，人民币（大写）叁拾捌万元整（含税），其中不含税价358490.57元。",
      ),
      "amount",
    );

    expect(amount.normalizedValue).toBe("380000.00");
    expect(amount.candidates).toEqual([
      expect.objectContaining({ normalizedValue: "380000.00" }),
    ]);
  });

  it("补充协议总变化额不得与后续付款拆分重复累计", () => {
    const result = parseContractText(
      [
        "补充协议",
        "原合同技术服务总金额为人民币400000元。",
        "本补充协议签订后合同总金额为人民币305000元。",
        "合同金额减少人民币玖万伍仟元整（￥95000元）。",
        "第一笔应支付47500元。",
        "第二笔应支付47500元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("-95000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 400000,
      changeAmount: -95000,
      finalAmount: 305000,
    });
  });

  it.each(["分两笔支付", "分两期支付"])(
    "付款数量词%s不得被解析为2元并参与增减汇总",
    (paymentDescription) => {
      const result = parseContractText(
        `本次补充协议增加施工许可办理费20000元，随后${paymentDescription}10000元和10000元。`,
        { relationType: "supplement" },
      );

      expect(field(result, "amount").normalizedValue).toBe("20000.00");
      expect(field(result, "amount").candidates).toEqual([
        expect.objectContaining({ normalizedValue: "20000.00" }),
      ]);
      expect(getContractAmountBreakdown(result)?.changeAmount).toBe(20000);
    },
  );

  it("补充协议金额事件忽略前次变化并只采用本次变化", () => {
    const result = parseContractText(
      [
        "补充协议",
        "原合同金额为627000元。",
        "上次补充协议合同金额减少142500元。",
        "本次补充协议合同金额减少114000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("-114000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 627000,
      changeAmount: -114000,
      finalAmount: 513000,
    });
  });

  it("当前核减事件覆盖带签订日期的历史补充协议增加事件", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同技术服务报酬总额为人民币贰拾叁万元整（￥230000.00元）。",
        "2025年8月27日签订补充协议，增加办理一个施工许可证20000元，合同金额变更为250000元。",
        "本次补充协议核减变电站施工暂设建设工程规划许可证1个60000元，合同金额变更为190000元。",
        "本次补充协议技术服务报酬由甲方一次支付乙方。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("-60000.00");
    expect(field(result, "amount").candidates).toEqual([
      expect.objectContaining({ normalizedValue: "-60000.00" }),
    ]);
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 250000,
      changeAmount: -60000,
      finalAmount: 190000,
    });
  });

  it("曾签订的历史补充协议动作不得参与本次变化量", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同金额为230000元。",
        "双方曾签订补充协议，增加合同金额20000元，合同金额调整为250000元。",
        "本次补充协议核减合同金额60000元，调整后合同金额为190000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("-60000.00");
    expect(field(result, "amount").candidates).toEqual([
      expect.objectContaining({ normalizedValue: "-60000.00" }),
    ]);
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 250000,
      changeAmount: -60000,
      finalAmount: 190000,
    });
  });

  it("中文大写原金额与最终金额精确闭环时拒绝数量级识别误读", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同技术服务报酬总额为人民币（大写）陆拾贰万柒仟元整（￥62117000.00元）（含税）。",
        "本次补充协议核减技术服务报酬总额为人民币（大写）壹拾肆万贰仟伍佰元整（￥142500元）（含税）。",
        "共计合同技术服务报酬总额为人民币（大写）肆拾捌万肆仟伍佰元整（￥484500元）（含税）。",
        "本次补充协议核减隧道部分临时建设工程规划许可证1个，含税价47500元；核减临时用地批复1个，含税价95000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("-142500.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 627000,
      changeAmount: -142500,
      finalAmount: 484500,
    });
    expect(getContractAmountAutomaticAdoptionContext(result)).toEqual({
      status: "calculated_amount",
      missingAmountEligible: false,
    });
    expect(field(result, "amount").warnings?.join(" ") || "").not.toContain(
      "补充协议金额计算结果",
    );
  });

  it("补充协议完整项目名与省略地点前缀的后缀候选不互相冲突", () => {
    const result = parseContractText("", {
      relationType: "supplement",
      expectedCategory: "main_business",
      sources: [
        {
          text: "项目名称：何各庄220千伏输变电工程前期手续",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: "220千伏输变电工程前期手续",
          source: "ocr_450",
          pageNumber: 4,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "何各庄220千伏输变电工程前期手续",
    );
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.project,
    ).toMatchObject({
      uniqueOrSufficientGap: true,
      riskCodes: [],
    });
  });

  it("补充协议报酬总额事件优先于随后列出的构成明细", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同技术服务报酬总额为人民币陆拾贰万柒仟元整（￥627 000.00元）。",
        "本次补充协议核减技术服务报酬总额人民币壹拾肆万贰仟伍佰元整（￥142500元），增加技术服务报酬总额人民币贰万捌仟伍佰元整（￥28500元），共计合同技术服务报酬总额人民币伍拾壹万叁仟元整（￥513000元）。",
        "本次补充协议增加核减隧道部分临时建设工程规划许可证1个，含税价28500元；核减城建档案馆存档1个，含税价47500元；核减临时用地批复1个，含税价95000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("-114000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 627000,
      changeAmount: -114000,
      finalAmount: 513000,
    });
  });

  it("同一行第二个金额动作可以读取下一行的报酬总额", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同技术服务报酬总额为人民币陆拾贰万柒仟元整（￥627000元）。",
        "本次补充协议核减技术服务报酬总额人民币壹拾肆万贰仟伍佰元整（￥142500元），增加技术服务报酬",
        "总额人民币贰万捌仟伍佰元整（￥28500元），共计合同技术服务报酬总额人民币伍拾壹万叁仟元整（￥513000元）。",
        "本次补充协议增加核减隧道部分临时建设工程规划许可证1个，含税价28500元；核减城建档案馆存档1个，含税价47500元；核减临时用地批复1个，含税价95000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("-114000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 627000,
      changeAmount: -114000,
      finalAmount: 513000,
    });
  });

  it("补充协议核减总额不得与包含的核减分项重复累计", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同技术服务报酬总额为人民币叁拾壹万柒仟伍佰元整（￥317500元）。",
        "本次补充协议核减技术服务报酬总额人民币玖万柒仟伍佰元整（￥97500元），合同共计技术服务报酬总额人民币贰拾贰万元整（￥220000元）。",
        "本次补充协议包含：核减隧道部分临时建设工程规划许可证1个，含税价50000元；核减城建档案馆存档1个，含税价47500元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("-97500.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 317500,
      changeAmount: -97500,
      finalAmount: 220000,
    });
  });

  it("动作行前的原合同金额不阻断下一行本次变化金额", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同技术服务报酬总额为人民币（大写）壹拾贰万叁仟伍佰元整（¥1",
        "23500.00元）（含税），本次补充协议增加技术服务报酬总额为人民币（大",
        "写）肆万柒仟伍佰元整（¥47500元）（含税），共计合同技术服务报酬总",
        "额为人民币（大写）壹拾柒万壹仟元整（¥171000.00元）（含税）。",
        "本次补充协议包含：城建档案馆存档1个，含税价47500.00元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("47500.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 123500,
      changeAmount: 47500,
      finalAmount: 171000,
    });
  });

  it("同一金额事件的中文大写和阿拉伯数字只累计一次", () => {
    const result = parseContractText(
      [
        "变更协议",
        "原合同金额为230000元。",
        "本次合同金额增加人民币陆万元整（￥60000元）。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("60000.00");
    expect(getContractAmountBreakdown(result)?.changeAmount).toBe(60000);
  });

  it("同一动作的中文大写与阿拉伯数字不一致时保留冲突且禁止相加", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同金额为230000元。",
        "本次增加合同费用人民币壹万元整（￥100000元）。",
      ].join("\n"),
      { relationType: "supplement" },
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).not.toBe("110000.00");
    expect(
      new Set(amount.candidates?.map((candidate) => candidate.normalizedValue)),
    ).toEqual(new Set(["10000.00", "100000.00"]));
    expect(amount.warnings?.join(" ")).toContain(
      "中文大写金额与阿拉伯数字不一致",
    );
    expect(amount.warnings?.join(" ")).toContain("候选冲突");
    expect(amount.warnings?.join(" ")).toContain(
      "已触发局部增强复核并重新排序",
    );
    expect(amount.confidence).toBeLessThan(100);
    expect(result.status).toBe("partial");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 230000,
      changeAmount: null,
      finalAmount: null,
    });
  });

  it("补充协议没有增减动词时按本次协议报酬总额绑定变化量", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同技术服务报酬总额为人民币肆拾万元整（￥400000.00元）。",
        "《焦化厂110千伏输变电工程前期手续技术咨询服务合同补充协议》报酬总额为人民币玖万伍仟元整（￥95000.00元）。",
        "共计合同技术服务报酬总额为人民币肆拾玖万伍仟元整（￥495000.00元）。",
        "本次补充协议技术服务报酬总额为人民币玖万伍仟元整（￥95000元）。",
        "共计合同技术服务报酬总额为人民币伍拾玖万元整（￥590000.00元）。",
        "第一笔支付47500元，第二笔支付47500元，其中税额5380元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("95000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 495000,
      changeAmount: 95000,
      finalAmount: 590000,
    });
    expect(field(result, "amount").warnings?.join(" ")).toContain(
      "当前协议金额事件",
    );
  });

  it("具名历史补充协议金额不得覆盖当前协议闭环事件", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同技术服务报酬总额为400000元。",
        "《前次补充协议》报酬总额为30000元。",
        "共计合同技术服务报酬总额为430000元。",
        "本次补充协议技术服务报酬总额为20000元。",
        "共计合同技术服务报酬总额为450000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("20000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 430000,
      changeAmount: 20000,
      finalAmount: 450000,
    });
    expect(
      field(result, "amount").candidates.some(
        (candidate) => candidate.normalizedValue === "30000.00",
      ),
    ).toBe(false);
  });

  it("本次协议报酬总额没有前后金额闭环时不得推断变化量", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同金额为400000元。",
        "本次补充协议技术服务报酬总额为95000元。",
        "第一笔付款47500元，第二笔付款47500元，税额5380元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 400000,
      changeAmount: null,
      finalAmount: null,
    });
  });

  it("新增动作可跨三行绑定合同费用并排除不含税价和税额", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同合同价款为80000元。",
        "依据本补充协议，新增树村220千伏输变电工程",
        "前期手续技术服务费用为",
        "人民币伍万元整（￥50000元），不含税价47169.81元，税额2830.19元。",
        "调整后合同金额为130000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("50000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 80000,
      changeAmount: 50000,
      finalAmount: 130000,
    });
  });

  it("支付约定位于新增动作之前时仍绑定跨行金额并区分调整后金额", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同（合同编号：HT-2024-001），约定其合同价款为80000元。",
        "二、依据技术服务报酬支付约定：新增国网北京海淀供电公司树村220千",
        "",
        "伏输变电工程（施工暂设）规划许可证技术服务费用为50000.00元（含税）。",
        "不含税价47169.81元，税额2830.19元。",
        "原合同合同价款调整为130000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("50000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 80000,
      changeAmount: 50000,
      finalAmount: 130000,
    });
  });

  it("本次补充协议核减总金额优先于同值核减分项", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同金额为230000元。",
        "本次补充协议核减金额60000元。",
        "故原合同金额调整为170000元。",
        "本次补充协议核减变电站施工许可证办理费用，含税价60000元。",
        "最终付款金额170000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("-60000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 230000,
      changeAmount: -60000,
      finalAmount: 170000,
    });
  });

  it("两笔真实同值增加动作仍应分别累计", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同金额为100000元。",
        "本次增加规划许可证办理费用10000元。",
        "本次增加施工许可证办理费用10000元。",
        "调整后合同金额为120000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("20000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 100000,
      changeAmount: 20000,
      finalAmount: 120000,
    });
  });

  it("本次协议金额中大写误识别时以闭环一致的阿拉伯数字为准", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同金额为180000元。",
        "本次补充协议技术服务报酬总额为人民币壹万玖仟元整（￥190000元）。",
        "调整后合同金额为370000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("190000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 180000,
      changeAmount: 190000,
      finalAmount: 370000,
    });
  });

  it("原金额和最终金额闭环只消除同一明确动作的重复OCR事件", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同技术服务报酬总额为230000元。",
        "本次补充协议增加办理送电工程施工许可证1个，较原合同增加20000元。",
        "本次补充协议增加办理送电工程施工许可证1个，较原合同增加20000元。",
        "最终技术服务报酬总额调整为250000元。",
        "取得许可证后付款250000元，税额14150元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("20000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 230000,
      changeAmount: 20000,
      finalAmount: 250000,
    });
  });

  it("只有原金额和明确最终金额时以最终金额反推变化量", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "原合同金额为230000元。",
        "调整后合同金额为250000元。",
        "付款金额为20000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "amount").normalizedValue).toBe("20000.00");
    expect(getContractAmountBreakdown(result)).toEqual({
      originalAmount: 230000,
      changeAmount: 20000,
      finalAmount: 250000,
    });
  });

  it("完整项目候选以内容质量超过首页截断候选", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: "高辛庄110千伏变电站工程（电力隧道）技术服务合同",
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.96,
          recognitionEngine: "paddleocr",
          text: "项目名称：高辛庄110千伏变电站工程（电力隧道）前期手续",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "高辛庄110千伏变电站工程（电力隧道）前期手续",
    );
  });

  it.each([
    "工体110千伏输变电工程前期手续",
    "费家村110千伏输变电工程前期手续",
    "三岔河110千伏输变电工程前期手续",
    "柳芳110千伏输变电工程前期手续",
  ])("正文专项技术服务描述不扩写项目名称：%s", (projectName) => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: "技术服务合同",
        },
        {
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.96,
          recognitionEngine: "paddleocr",
          text: `鉴于本合同为甲方委托乙方就${projectName}技术咨询服务项目进行的专项技术服务。`,
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(projectName);
  });

  it("首页合同标题中的咨询结尾不被正文通用咨询服务扩写", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: "国网北京朝阳供电公司北甸110千伏输变电工程前期手续咨询技术服务合同",
        },
        {
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.96,
          recognitionEngine: "paddleocr",
          text: "甲方委托乙方就北甸110千伏输变电工程前期手续咨询服务项目进行的专项技术服务。",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "北甸110千伏输变电工程前期手续咨询",
    );
  });

  it("首页明确项目字段保留完整咨询服务尾词", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: "项目名称：驼房营110千伏输变电工程前期手续咨询服务",
        },
        {
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.96,
          recognitionEngine: "paddleocr",
          text: "甲方委托乙方就驼房营110千伏输变电工程前期手续咨询服务项目进行前期手续办理。",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "驼房营110千伏输变电工程前期手续咨询服务",
    );
  });

  it("首页明确项目字段支持括号项目与服务尾词跨行拼接", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: [
            "项目名称：国网北京朝阳供电公司高辛庄110千伏变电站工程（电力隧道）",
            "前期手续咨询服务",
            "甲方：国网北京市电力公司",
          ].join("\n"),
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "高辛庄110千伏变电站工程（电力隧道）前期手续咨询服务",
    );
  });

  it("项目字段后的独立合同续行只剥离合同并保留技术服务", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: [
            "项目名称：国网北京海淀供电公司冷泉110千伏输变电",
            "工程工程规划许可证、施工许可证、规划核验意见技术服务",
            "合同",
            "委托方（甲方）：国网北京市电力公司",
          ].join("\n"),
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "冷泉110千伏输变电工程工程规划许可证、施工许可证、规划核验意见技术服务",
    );
  });

  it("局部项目裁片缺少合同续行时仍保留明确字段中的技术服务", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.86,
          recognitionEngine: "paddleocr",
          text: [
            "项目名称：国网北京海淀供电公司冷泉110千伏输变电",
            "工程工程规划许可证、施工许可证、规划核验意见技术服务",
            "合同",
            "委托方（甲方）：国网北京市电力公司",
          ].join("\n"),
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          fieldScope: "project_name",
          text: "项目名称：国网北京海淀供电公司冷泉110千伏输变电工程工程规划许可证、施工许可证、规划核验意见技术服务",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "冷泉110千伏输变电工程工程规划许可证、施工许可证、规划核验意见技术服务",
    );
  });

  it.each([
    ["差庄湖", "姜庄湖"],
    ["何备庄", "何各庄"],
  ])("正文多档一致地名优先于首页单档错字：%s/%s", (wrongName, correctName) => {
    const expected = `${correctName}220千伏输变电工程前期手续`;
    const bodyText = `甲方委托乙方就${expected}技术咨询服务项目进行的专项技术服务。`;
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: `项目名称：${wrongName}220千伏输变电工程前期手续技术`,
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.96,
          recognitionEngine: "paddleocr",
          text: bodyText,
        },
        {
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.96,
          recognitionEngine: "paddleocr",
          text: bodyText,
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(expected);
  });

  it.each([
    [
      "北沙滩110千伏输变电工程工程规划许可施工许可证技术服务合同",
      "北沙滩110千伏输变电工程工程规划许可证、施工许可证",
    ],
    [
      "新材料110千伏输变电工程工程规划许可技术服务合同",
      "新材料110千伏输变电工程工程规划许可证、施工许可证",
    ],
    [
      "永丰110千伏输变电工程建设工程规划核验技术服务合同",
      "永丰110千伏输变电工程建设工程规划核验意见",
    ],
  ])("正文完整许可结构优先于首页残缺标题：%s", (coverTitle, expected) => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: coverTitle,
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.9,
          recognitionEngine: "paddleocr",
          text: `项目名称：国网北京海淀供电公司${expected}`,
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(expected);
  });

  it("框架采购协议没有明确项目字段时不把合同类型当项目名称", () => {
    const result = parseContractText(
      [
        "SGTYHT/24-QT-001 服务框架采购协议",
        "国网北京市电力公司朝阳供电公司前期手续咨询服务框架采购",
        "甲方：国网北京市电力公司",
      ].join("\n"),
    );

    expect(field(result, "project_name").normalizedValue).toBe("");
  });

  it("终止协议只引用原合同标题时不把历史项目写入当前项目字段", () => {
    const result = parseContractText(
      [
        "解除协议书",
        "甲乙双方于2023年5月18日签订了合同编号为SGBJHD001的《国网北京海淀供电公司北安河110kv输变电工程（电缆隧道四标）临时建设工程规划许可证技术服务合同》（以下简称“原合同”）。",
      ].join("\n"),
      { relationType: "termination" },
    );

    expect(field(result, "project_name").normalizedValue).toBe("");
  });

  it("首页标题确认双层服务语义时正文项目短语保留咨询服务后缀", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.6,
          recognitionEngine: "paddleocr",
          text: "网北京市千伏输变电工程前期手续咨询服务FOEN技术服务合同",
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: "甲方委托乙方就驼房营110千伏输变电工程前期手续咨询服务项目进行前期手续办理。",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "驼房营110千伏输变电工程前期手续咨询服务",
    );
  });

  it("正文明确委托项目保留括号说明后的咨询服务后缀", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.62,
          recognitionEngine: "paddleocr",
          text: "220千伏输变电工程（变电部分）前期手续（工程手续）咨询15技术服务合同",
        },
        {
          source: "ocr_480",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: "甲方委托乙方就高辛庄110千伏输变电工程（变电部分）前期手续工程手续）咨询服务项目进行的专项技术服务。",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "高辛庄110千伏输变电工程（变电部分）前期手续（工程手续）咨询服务",
    );
  });

  it("首页闭合手续说明与技术服务合同形成双层标题时保留咨询服务", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: [
            "国网北京朝阳供电公司高辛庄110千伏输变电工程(变电部分)前期手续(工程手续)咨询服务",
            "技术服务合同",
          ].join("\n"),
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "高辛庄110千伏输变电工程（变电部分）前期手续（工程手续）咨询服务",
    );
  });

  it("补充协议封面标题支持末尾括号说明且不把说明拼入项目名称", () => {
    const result = parseContractText(
      [
        "焦化厂110千伏输变电工程前",
        "期手续技术咨询服务合同补充",
        "协议书（消防验收备案）",
        "甲方：国网北京市电力公司",
      ].join("\n"),
    );

    expect(field(result, "project_name").normalizedValue).toBe(
      "焦化厂110千伏输变电工程前期手续",
    );
  });

  it("技术服务合同补充协议封面保留项目名称中的技术服务", () => {
    const result = parseContractText(
      [
        "国网北京朝阳供电公司后街220千伏输变电工程前期手续",
        "技术服务合同及补充协议书",
        "甲方：国网北京市电力公司",
      ].join("\n"),
    );

    expect(field(result, "project_name").normalizedValue).toBe(
      "后街220千伏输变电工程前期手续技术服务",
    );
  });

  it.each([
    ["后街220千伏输变电工程前期手续", "后街220千伏输变电工程前期手续"],
    [
      "CBD500千伏变电站110千伏送出工程前期手续",
      "CBD500千伏变电站110千伏送出工程前期手续",
    ],
    ["何各庄220千伏输变电工程前期手续", "何各庄220千伏输变电工程前期手续"],
    ["费家村110千伏输变电工程前期手续", "费家村110千伏输变电工程前期手续"],
  ])("普通合同补充协议标题不把技术服务写入项目名称：%s", (title, expected) => {
    const result = parseContractText(
      [
        `国网北京朝阳供电公司${title}`,
        "技术服务合同补充协议书",
        "甲方：国网北京市电力公司",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "project_name").normalizedValue).toBe(expected);
  });

  it("拒绝地名和电压等级重复的近似 OCR 裁片并采用完整标题", () => {
    const result = parseContractText("", {
      relationType: "supplement",
      sources: [
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
          text: [
            "咸宁110千伏线路工程前期手",
            "咸宁110十伏线路工程前期手续技术服务合同补充协议书",
          ].join("\n"),
        },
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: [
            "国网北京朝阳供电公司高碑店-咸宁110千伏线路工程前期手续",
            "技术服务合同补充协议书",
          ].join("\n"),
        },
      ],
    });
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe("高碑店-咸宁110千伏线路工程前期手续");
    expect(
      project.candidates?.some((candidate) =>
        /咸宁110千伏.*咸宁110十伏/u.test(candidate.normalizedValue),
      ),
    ).toBe(false);
    expect(project.normalizedValue).not.toContain("技术服务");
  });

  it("OCR 缺少地名且咨询服务尾字损坏时不按项目模板猜补", () => {
    const result = parseContractText(
      "220千伏输变电工程（变电部分）前期手续（工程手续）咨询15技术服务合同",
    );
    const project = field(result, "project_name");

    expect(project.normalizedValue).not.toContain("三营门");
    expect(project.confidence).toBeLessThan(100);
  });

  it("局部增强识别出多字损坏服务尾词时只保留项目主体而不猜字", () => {
    const result = parseContractText(
      "项目名称：工体110千伏输变电工程前期手续技术咨海服名",
    );

    expect(field(result, "project_name").normalizedValue).toBe(
      "工体110千伏输变电工程前期手续",
    );
    expect(field(result, "project_name").normalizedValue).not.toContain(
      "咨海服名",
    );
  });

  it("多档首页尾词损坏且正文原合同结构一致时恢复服务尾字", () => {
    const bodyText = [
      "补充协议书",
      "甲乙双方于2025年2月5日签订了合同编号为SGBJHD001的",
      "《国网北京朝阳供电公司三营门220千伏输变电工程（变电部分）前期手续（工程手续）咨询技术服务合同》（以下简称“原合同”）。",
    ].join("\n");
    const result = parseContractText("", {
      relationType: "supplement",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.93,
          recognitionEngine: "paddleocr",
          text: "项目名称：三营门220千伏输变电工程（变电部分）前期手续（工程手续）咨询E",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.91,
          recognitionEngine: "paddleocr",
          text: "项目名称：三营门220千伏输变电工程（变电部分）前期手续（工程手续）咨询15技术服务合同",
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
          text: bodyText,
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "三营门220千伏输变电工程（变电部分）前期手续（工程手续）咨询服务",
    );
  });

  it("不同项目主体不得借相同损坏尾词跨页面融合", () => {
    const result = parseContractText("", {
      relationType: "supplement",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.93,
          recognitionEngine: "paddleocr",
          text: "项目名称：甲地110千伏输变电工程前期手续咨询E",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.91,
          recognitionEngine: "paddleocr",
          text: "项目名称：甲地110千伏输变电工程前期手续咨询15技术服务合同",
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
          text: [
            "甲乙双方签订合同编号为HT001的",
            "《乙地110千伏输变电工程前期手续咨询技术服务合同》（以下简称“原合同”）。",
          ].join("\n"),
        },
      ],
    });

    expect(
      field(result, "project_name").candidates?.some(
        (candidate) =>
          candidate.normalizedValue === "乙地110千伏输变电工程前期手续咨询服务",
      ),
    ).toBe(false);
  });

  it("不同项目主体不得借闭合手续尾词跨页面融合", () => {
    const result = parseContractText("", {
      relationType: "supplement",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.93,
          recognitionEngine: "paddleocr",
          text: "项目名称：甲地220千伏输变电工程（变电部分）前期手续（工程手续）咨询E",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.91,
          recognitionEngine: "paddleocr",
          text: "项目名称：甲地220千伏输变电工程（变电部分）前期手续（工程手续）咨询15技术服务合同",
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
          text: [
            "甲乙双方签订合同编号为HT002的",
            "《乙地220千伏输变电工程（变电部分）前期手续（工程手续）咨询技术服务合同》（以下简称“原合同”）。",
          ].join("\n"),
        },
      ],
    });

    expect(
      field(result, "project_name").candidates?.some(
        (candidate) =>
          candidate.normalizedValue ===
          "乙地220千伏输变电工程（变电部分）前期手续（工程手续）咨询服务",
      ),
    ).toBe(false);
  });

  it("唯一正文项目可与多档闭合手续尾词残片安全融合", () => {
    const bodyText = [
      "补充协议书",
      "甲乙双方签订合同编号为HT001的",
      "《三营门220千伏输变电工程（变电部分）前期手续（工程手续）咨询技术服务合同》（以下简称“原合同”）。",
    ].join("\n");
    const result = parseContractText("", {
      relationType: "supplement",
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.93,
          recognitionEngine: "paddleocr",
          text: "分）前期手续（工程手续）咨询E",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.91,
          recognitionEngine: "paddleocr",
          text: "220千伏输变电工程（变电部分）前期手续（工程手续）咨询15技术服务合同",
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
          text: bodyText,
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "三营门220千伏输变电工程（变电部分）前期手续（工程手续）咨询服务",
    );
  });

  it("严格正文原合同引用可为短补充协议建立项目候选", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "甲乙双方于2025年2月5日签署了合同编号为SGBJHD00JJJS2500052的",
        "《国网北京海淀供电公司2025年跃进110千伏输变电工程工程规划许可证、",
        "施工许可证技术服务合同》（以下简称“原合同”），现签订本补充协议。",
        "付款金额：250000元",
      ].join("\n"),
      { relationType: "supplement" },
    );
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe(
      "跃进110千伏输变电工程工程规划许可证、施工许可证",
    );
    expect(project.confidence).toBeLessThan(100);
    expect(project.warnings?.join(" ")).toContain("原合同标题");
  });

  it("项目名称只删除紧邻工程主体的残缺供电公司页眉前缀", () => {
    const result = parseContractText(
      "项目名称：网北京朝阳电公司三岔河110千伏输变电工程前期手续技术",
    );

    expect(field(result, "project_name").normalizedValue).toBe(
      "三岔河110千伏输变电工程前期手续",
    );
  });

  it("首页标题以项目或工程自然结束时不被后页服务范围扩写", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: "工程名称：姜庄湖220千伏变电站110千伏送出工程",
        },
        {
          source: "ocr_300",
          pageNumber: 4,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          text: "项目名称：姜庄湖220千伏变电站110千伏送出工程前期手续",
        },
      ],
    });

    expect(field(result, "project_name").normalizedValue).toBe(
      "姜庄湖220千伏变电站110千伏送出工程",
    );
  });

  it("项目名称遇到重复标签和付款字段立即停止", () => {
    const result = parseContractText(
      [
        "项目名称：东玉河220千伏输变电工程工程规划许可证、施",
        "工许可证",
        "项目名称：国网北京海淀供电公司东玉河220千伏输变电工程",
        "付款金额：3000元",
      ].join("\n"),
    );

    expect(field(result, "project_name").normalizedValue).toBe(
      "东玉河220千伏输变电工程工程规划许可证、施工许可证",
    );
    expect(field(result, "project_name").normalizedValue).not.toContain(
      "供电公司",
    );
  });

  it("首页短合同标题可形成楼门牌购置项目候选", () => {
    const result = parseContractText("楼门牌购置合同");

    expect(field(result, "project_name").normalizedValue).toBe("楼门牌购置");
  });

  it("跨行项目名称忽略版面排序插入的孤立汉字噪声", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
          text: "项目名称：温泉-稻香湖110千伏线路工程建设工程规划许可证、\n施工许可证",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.93,
          recognitionEngine: "paddleocr",
          text: "项目名称：温泉-稻香湖110千伏线路工程建设工程规划许可证、\n厂\n施工许可证",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.92,
          recognitionEngine: "verification-engine",
          verificationOnly: true,
          text: "项目名称：温泉-稻香湖110千伏线路工程建设工程规划许可证、\n施工许可证",
        },
      ],
    });
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe(
      "温泉-稻香湖110千伏线路工程建设工程规划许可证、施工许可证",
    );
    expect(project.candidates).toHaveLength(1);
    expect(project.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("忽略重复地名加服务尾词的项目残片并采用完整项目名称", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
          text: "项目名称：工体工体询服务",
        },
        {
          source: "ocr_300",
          pageNumber: 2,
          confidence: 0.96,
          recognitionEngine: "paddleocr",
          text: "项目名称：三营门三营门前期手续",
        },
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.95,
          recognitionEngine: "paddleocr",
          text: "项目名称：工体110千伏输变电工程前期手续技术咨询服务（",
        },
      ],
    });
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe("工体110千伏输变电工程前期手续");
    expect(project.candidates).toHaveLength(1);
    expect(project.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("忽略裁片重叠形成的重复实体和非法电压项目残片", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: "项目名称：焦化厂1焦化厂1110千伏输变电工程（电力管线）",
        },
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.94,
          recognitionEngine: "paddleocr",
          text: "项目名称：焦化厂110千伏输变电工程（电力管线）项目临时用地土地复垦方案编制",
        },
      ],
    });
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe(
      "焦化厂110千伏输变电工程（电力管线）项目临时用地土地复垦方案编制",
    );
    expect(project.candidates).toHaveLength(1);
  });

  it("清理重复地名并保留明确项目字段中的真实服务尾词冲突", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
          text: "项目名称：驼房营110千伏输变电工程前期手续技术咨询服务",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.95,
          recognitionEngine: "paddleocr",
          text: "项目名称：驼房营:驼房营:110千伏输变电工程前期手续咨询服务",
        },
        {
          source: "ocr_300",
          pageNumber: 2,
          confidence: 0.94,
          recognitionEngine: "paddleocr",
          text: "项目名称：驼房营110千伏输变电工程前期手续项目名称:",
        },
      ],
    });
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe(
      "驼房营110千伏输变电工程前期手续技术咨询服务",
    );
    expect(
      new Set(
        project.candidates?.map((candidate) => candidate.normalizedValue),
      ),
    ).toEqual(
      new Set([
        "驼房营110千伏输变电工程前期手续技术咨询服务",
        "驼房营110千伏输变电工程前期手续咨询服务",
      ]),
    );
    expect(project.warnings?.join(" ") || "").toContain("候选冲突");
  });

  it("清理带连字符地名被裁片完整重复的项目名称", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
          text: "项目名称：高碑店-咸宁110千伏线路工程前期手续技术咨询服务",
        },
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
          text: "项目名称：高碑店-咸宁高碑店-咸宁110千伏线路工程前期手续技术咨询服务",
        },
      ],
    });
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe(
      "高碑店-咸宁110千伏线路工程前期手续技术咨询服务",
    );
    expect(project.candidates).toHaveLength(1);
  });

  it("排除不完整工程前残片并清理服务类型后的印章噪声", () => {
    const result = parseContractText("", {
      sources: [
        {
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
          text: "项目名称：CBD500千伏变电站CBD500千伏变电站古110千伏送出工程前",
        },
        {
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.93,
          recognitionEngine: "paddleocr",
          text: "项目名称：CBD500千伏变电站110千伏送出工程前期手续技术咨询服务羽隶7",
        },
      ],
    });
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe(
      "CBD500千伏变电站110千伏送出工程前期手续",
    );
    expect(project.candidates).toHaveLength(1);
  });

  it("阿拉伯金额与中文大写一致时提高可信度", () => {
    const result = parseContractText(
      "合同总价：人民币2,345,678.56元，大写：人民币贰佰叁拾肆万伍仟陆佰柒拾捌元伍角陆分",
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("2345678.56");
    expect(amount.confidence).toBeGreaterThanOrEqual(90);
    expect(amount.warnings?.join(" ") || "").not.toContain("不一致");
  });

  it("合同金额只采用阿拉伯数字且忽略不一致的中文大写", () => {
    const result = parseContractText(
      "合同总金额：人民币1000000元（大写：人民币玖拾万元整）",
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("1000000.00");
    expect(amount.warnings?.join(" ") || "").not.toContain("不一致");
    expect(amount.candidates).toHaveLength(1);
  });

  it("合同金额标题后的中文大写乱码不再与数字总计形成伪冲突", () => {
    const result = parseContractText(
      [
        "第二条 合同金额",
        "霸",
        "池任圆整",
        "合同金额总计（小写）：7000元，（大写）人民币：柒仟圆整。",
      ].join("\n"),
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("7000.00");
    expect(amount.candidates).toHaveLength(1);
    expect(amount.warnings?.join(" ") || "").not.toContain("候选冲突");
    expect(getContractAmountAutomaticAdoptionContext(result)?.status).toBe(
      "confirmed_amount",
    );
  });

  it.each([
    ["办公设备采购合同", "asset"],
    ["前期手续咨询服务框架采购协议", "main_business"],
    ["工程咨询服务框架采购协议", "main_business"],
    ["技术咨询服务采购合同", "main_business"],
    ["信息咨询服务采购协议", "main_business"],
    ["项目前期手续办理服务合同", "main_business"],
    ["非主营业务其他服务合同", "non_main"],
  ])("根据业务关键词将 %s 分类为 %s", (text, expected) => {
    const result = parseContractText(text);
    expect(field(result, "category").normalizedValue).toBe(expected);
  });

  it("合同类型同时命中多类时拒绝自动采用", () => {
    const result = parseContractText(
      "软件采购合同，服务内容还包括技术咨询和工程咨询。",
    );
    const category = field(result, "category");

    expect(category.confidence).toBeLessThan(60);
    expect(category.warnings?.join(" ")).toContain("系统未自动采用");
  });

  it("显式资产类声明优先于服务采购标题", () => {
    const result = parseContractText(
      ["前期手续咨询服务框架采购协议", "合同分类：资产类合同"].join("\n"),
    );
    const category = field(result, "category");

    expect(category.normalizedValue).toBe("asset");
    expect(category.confidence).toBe(100);
    expect(category.warnings?.join(" ") || "").not.toContain("多个类型");
  });

  it("相互矛盾的显式合同分类仍触发冲突门禁", () => {
    const result = parseContractText(
      ["合同分类：资产类合同", "合同类型：主营项目合同"].join("\n"),
    );
    const category = field(result, "category");

    expect(category.confidence).toBeLessThan(60);
    expect(category.warnings?.join(" ")).toContain("多个类型");
  });

  it("合同类型只采用上传前选择值且不读取正文分类", () => {
    const result = parseContractText(
      [
        "工程咨询服务合同",
        "项目名称：东城更新项目",
        "甲方：北京建设有限公司",
        "乙方：北京咨询有限公司",
        "合同金额：100000元",
        "合同签订日期：2026年8月5日",
      ].join("\n"),
      { expectedCategory: "asset" },
    );
    const category = field(result, "category");

    expect(category.normalizedValue).toBe("asset");
    expect(category.confidence).toBe(100);
    expect(category.evidence).toEqual([
      expect.objectContaining({ text: "上传合同前选择", source: "rule" }),
    ]);
    expect(category.warnings?.join(" ")).toContain("不参与OCR识别");
    expect(result.status).toBe("succeeded");
  });

  it("正文没有分类时仍使用上传前选择的合同类型", () => {
    const result = parseContractText(
      [
        "项目名称：东城更新项目",
        "甲方：北京建设有限公司",
        "乙方：北京咨询有限公司",
        "合同金额：100000元",
        "合同签订日期：2026年8月5日",
      ].join("\n"),
      { expectedCategory: "asset" },
    );

    expect(field(result, "category").normalizedValue).toBe("asset");
    expect(field(result, "category").confidence).toBe(100);
    expect(result.status).toBe("succeeded");
  });

  it("识别签订日期、签订时间和签定时间并校验真实日历日期", () => {
    const valid = parseContractText("合同签订日期：2026/02/28");
    const signedAt = parseContractText("签订时间：2025.8.25");
    const legacyTypo = parseContractText("签定时间：2025年8月25日");
    const invalid = parseContractText("合同签订日期：2026年2月30日");

    expect(field(valid, "contract_date").normalizedValue).toBe("2026-02-28");
    expect(field(signedAt, "contract_date").normalizedValue).toBe("2025-08-25");
    expect(field(legacyTypo, "contract_date").normalizedValue).toBe(
      "2025-08-25",
    );
    expect(field(invalid, "contract_date").normalizedValue).toBe("");
  });

  it("字段标签上一行的日期不得反向借作合同签订日期", () => {
    const result = parseContractText(
      [
        "受托方（乙方）：北京羽隶工程咨询有限公司",
        "2021-11-22",
        "签订时间：",
        "签订地点：北京",
      ].join("\n"),
    );

    expect(field(result, "contract_date").normalizedValue).toBe("");
  });

  it("空签订日期标签只读取紧邻下一非空纯日期行", () => {
    const result = parseContractText(
      ["签订时间：", "", "2021-11-22", "签订地点：北京"].join("\n"),
    );

    expect(field(result, "contract_date").normalizedValue).toBe("2021-11-22");
  });

  it("空签订日期标签不得借用服务期限起始日", () => {
    const previousLine = parseContractText(
      ["服务期限：自2025年1月1日起三年", "合同签订日期："].join("\n"),
    );
    const followingLine = parseContractText(
      ["合同签订日期：", "2025年1月1日", "服务期限：三年"].join("\n"),
    );

    expect(field(previousLine, "contract_date").normalizedValue).toBe("");
    expect(field(followingLine, "contract_date").normalizedValue).toBe("");
  });

  it("签章页附近的验收日期不得覆盖首页明确签订日期", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: "合同签订日期：2025-01-01",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.95,
          recognitionEngine: "paddleocr",
        },
        {
          text: [
            "签章页",
            "甲方（盖章）：北京建设有限公司",
            "乙方（盖章）：北京咨询有限公司",
            "验收日期：2024-05-01",
          ].join("\n"),
          source: "ocr_300",
          pageNumber: 8,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    const date = field(result, "contract_date");
    expect(date.normalizedValue).toBe("2025-01-01");
    expect(
      date.candidates?.some(
        (candidate) => candidate.normalizedValue === "2024-05-01",
      ),
    ).toBe(false);
  });

  it("签订日期标签前同一行的期限日期不得进入候选", () => {
    const result = parseContractText(
      "服务期限自2025-01-01起三年；合同签订日期：",
    );

    expect(field(result, "contract_date").normalizedValue).toBe("");
  });

  it("独立识别通道同时误读签订年份时清空可采用值并保留原始证据", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: [
            "项目名称：温泉技术服务项目",
            "签订时间：2015.12.10",
            "有效期限：贰年（2025 年至 2027 年）",
          ].join("\n"),
          source: "ocr_480",
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: "签订时间：2015.12.10",
          source: "ocr_480",
          confidence: 0.99,
          recognitionEngine: "verification-engine",
          verificationOnly: true,
        },
      ],
    });
    const contractDate = field(result, "contract_date");

    expect(contractDate.normalizedValue).toBe("");
    expect(contractDate.originalValue).toBe("2015-12-10");
    expect(contractDate.confidence).toBe(45);
    expect(contractDate.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ normalizedValue: "2015-12-10" }),
      ]),
    );
    expect(contractDate.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("2015.12.10"),
        }),
      ]),
    );
    expect(contractDate.warnings?.join(" ")).toContain(
      "与正文明确期限 2025—2027年 明显不一致",
    );
    expect(contractDate.warnings?.join(" ")).toContain("未推测改写日期");
    expect(contractDate.warnings?.join(" ")).toContain("已从可采用值中清空");
    expect(result.status).toBe("partial");
  });

  it("温泉手写日期增强候选与独立通道不一致时显示正确候选但仍阻断", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: ["签订时间：", "2025.12.10"].join("\n"),
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          lineConfidences: [0.99, 0.98],
          recognitionEngine: "paddleocr",
        },
        {
          text: "签订时间：2015.12.10",
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.88,
          recognitionEngine: "paddleocr",
        },
        {
          text: "签订时间：2015.11.10",
          source: "ocr_480",
          pageNumber: 1,
          confidence: 82,
          recognitionEngine: "verification-engine",
          verificationOnly: true,
        },
      ],
    });
    const contractDate = field(result, "contract_date");

    expect(contractDate.normalizedValue).toBe("2025-12-10");
    expect(contractDate.confidence).toBeLessThan(100);
    expect(contractDate.warnings?.join(" ")).toContain("候选冲突");
    expect(contractDate.warnings?.join(" ")).toContain("仅用于风险判断");
  });

  it("跃进手写月份存在 6/8 图像歧义时不得按文件名改成业务真值 8 月", () => {
    const result = parseContractText("", {
      fileName:
        "1-技术服务合同-跃进110千伏输变电工程不动产登记-20250825￥95000.pdf",
      sources: [
        {
          text: [
            "签订时间：2025.6.25",
            "有效期限：两年（2025 年至 2027 年）",
          ].join("\n"),
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.94,
          recognitionEngine: "paddleocr",
        },
        {
          text: "签订时间：Jor or",
          source: "ocr_480",
          pageNumber: 1,
          confidence: 74,
          recognitionEngine: "verification-engine",
          verificationOnly: true,
        },
      ],
    });
    const contractDate = field(result, "contract_date");

    expect(contractDate.normalizedValue).toBe("2025-06-25");
    expect(contractDate.normalizedValue).not.toBe("2025-08-25");
    expect(contractDate.confidence).toBeLessThan(100);
    expect(contractDate.warnings?.join(" ")).toContain("仅用于风险判断");
  });

  it("签章页日期候选优先于首页打印日期候选", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: "签订时间：2025.6.25",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.96,
          recognitionEngine: "paddleocr",
        },
        {
          text: [
            "签章页",
            "甲方（盖章）：国网北京市电力公司",
            "乙方（盖章）：北京咨询有限公司",
            "签订日期：",
            "2025.8.25",
          ].join("\n"),
          source: "ocr_300",
          pageNumber: 12,
          confidence: 0.94,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(field(result, "contract_date").normalizedValue).toBe("2025-08-25");
    expect(field(result, "contract_date").pageNumber).toBe(12);
    expect(field(result, "contract_date").confidence).toBeLessThan(100);
  });

  it("签订年份位于正文有效期限内时不触发年份矛盾告警", () => {
    const result = parseContractText(
      "签订日期：2025年12月10日\n合同有效期：2025年1月1日至2027年12月31日",
    );
    const contractDate = field(result, "contract_date");

    expect(contractDate.normalizedValue).toBe("2025-12-10");
    expect(contractDate.confidence).toBe(100);
    expect(contractDate.warnings).toBeUndefined();
  });

  it.each(["20n.6.2", "2025.6.2r", "2075..2)", "202）.8."])(
    "异常日期不得被截断为合法候选：%s",
    (rawDate) => {
      const result = parseContractText(`签订时间：${rawDate}`);

      expect(field(result, "contract_date").normalizedValue).toBe("");
      expect(field(result, "contract_date").candidates).toBeUndefined();
    },
  );

  it("文件名日期不得作为草拟合同签订日期候选", () => {
    const result = parseContractText(
      [
        "甲方：北京建设有限公司",
        "乙方：北京咨询有限公司",
        "项目名称：东城更新项目",
        "合同金额：100000元",
        "工程咨询服务合同",
      ].join("\n"),
      { fileName: "工程咨询服务合同-20250825.pdf" },
    );

    expect(field(result, "contract_date").normalizedValue).toBe("");
    expect(field(result, "contract_date").candidates).toBeUndefined();
    expect(result.status).toBe("partial");
  });

  it("低置信扫描文字即使命中强锚点也不会自动判为高可信", () => {
    const text = "甲方：北京建设有限公司";
    const result = parseContractText(text, {
      sources: [
        {
          text,
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.35,
          lineConfidences: [0.35],
        },
      ],
    });
    const partyA = field(result, "party_a");

    expect(partyA.normalizedValue).toBe("北京建设有限公司");
    expect(partyA.confidence).toBeLessThan(60);
    expect(partyA.warnings?.join(" ")).toContain("仅用于风险判断");
  });

  it("转换复杂中文大写金额", () => {
    expect(
      parseChineseUppercaseAmount(
        "人民币壹亿贰仟叁佰肆拾伍万陆仟柒佰捌拾玖元伍角陆分",
      ),
    ).toBe(123456789.56);
    expect(parseChineseUppercaseAmount("人民币拾万元整")).toBe(100000);
    expect(parseChineseUppercaseAmount("壹拾参万叁仟元整")).toBe(133000);
  });

  it.each([
    ["项目名称：东城更新项目（以下简称本项目）", "东城更新项目"],
    ["项目名称：东城更新项目；项目编号：XM-2026-01", "东城更新项目"],
    ["项目名称：东城更新项目，项目负责人：张三", "东城更新项目"],
    ["项目名称：东城更新项目 联系人：李四", "东城更新项目"],
  ])("项目名称在明确元数据前截断：%s", (text, expected) => {
    expect(field(parseContractText(text), "project_name").normalizedValue).toBe(
      expected,
    );
  });

  it("同页多分辨率识别不得把中等可信候选抬为高可信", () => {
    const baseSource: ContractTextSource = {
      text: "买方：北京信息中心",
      source: "ocr_300",
      pageNumber: 1,
      confidence: 0.9,
      lineConfidences: [0.9],
    };
    const single = field(
      parseContractText("", { sources: [baseSource] }),
      "party_a",
    );
    const repeated = field(
      parseContractText("", {
        sources: [
          baseSource,
          {
            text: "买方：北京信息中心 联系人张三",
            source: "ocr_480",
            pageNumber: 1,
            confidence: 0.9,
            lineConfidences: [0.9],
          },
        ],
      }),
      "party_a",
    );

    expect(single.confidence).toBeLessThan(90);
    expect(repeated.confidence).toBe(single.confidence);
    expect(repeated.confidence).toBeLessThan(90);
  });

  it("PaddleOCR（飞桨文字识别）单引擎多档即使达到 95 至 99 分仍不得自动采用", () => {
    const text = [
      "工程咨询服务合同",
      "项目名称：东城更新项目",
      "甲方：北京建设有限公司",
      "乙方：北京咨询有限公司",
      "合同金额：100000元",
      "合同签订日期：2026年8月5日",
    ].join("\n");
    const result = parseContractText("", {
      sources: (["ocr_300", "ocr_480", "ocr_600"] as const).map((source) => ({
        text,
        source,
        pageNumber: 1,
        confidence: 0.99999,
        recognitionEngine: "paddleocr",
      })),
    });

    expect(result.status).toBe("partial");
    expect(result.fields.every((item) => item.confidence < 100)).toBe(true);
    expect(result.fields.every((item) => item.confidence >= 95)).toBe(true);
    expect(Math.max(...result.fields.map((item) => item.confidence))).toBe(99);
    expect(
      result.fields.every((item) =>
        item.warnings?.some((warning) => warning.includes("仅用于风险判断")),
      ),
    ).toBe(true);
  });

  it.each([1, 100])(
    "单一图像识别引擎原始置信度恰为 %s 时仍不得自动采用",
    (confidence) => {
      const text = [
        "工程咨询服务合同",
        "项目名称：东城更新项目",
        "甲方：北京建设有限公司",
        "乙方：北京咨询有限公司",
        "合同金额：100000元",
        "合同签订日期：2026年8月5日",
      ].join("\n");
      const result = parseContractText("", {
        sources: [
          {
            text,
            source: "ocr_300",
            pageNumber: 1,
            confidence,
            recognitionEngine: "paddleocr",
          },
        ],
      });

      expect(result.status).toBe("partial");
      expect(result.fields.every((item) => item.confidence < 100)).toBe(true);
      expect(
        Math.max(...result.fields.map((item) => item.confidence)),
      ).toBeLessThanOrEqual(99);
    },
  );

  it("PDF 文字层单独只能保留诊断分并进入部分结果", () => {
    const text = [
      "工程咨询服务合同",
      "项目名称：东城更新项目",
      "甲方：北京建设有限公司",
      "乙方：北京咨询有限公司",
      "合同金额：100000元",
      "合同签订日期：2026年8月5日",
    ].join("\n");
    const result = parseContractText("", {
      sources: [
        {
          text,
          source: "pdf_text",
          pageNumber: 1,
          confidence: 99,
          recognitionEngine: "pdf_text",
        },
      ],
    });

    expect(result.status).toBe("partial");
    expect(result.fields.every((item) => item.confidence < 100)).toBe(true);
  });

  it("PDF 文字层与可见页面图像识别逐字段一致时才允许形成 100", () => {
    const text = [
      "工程咨询服务合同",
      "项目名称：东城更新项目",
      "甲方：北京建设有限公司",
      "乙方：北京咨询有限公司",
      "合同金额：100000元",
      "合同签订日期：2026年8月5日",
    ].join("\n");
    const result = parseContractText("", {
      sources: [
        {
          text,
          source: "pdf_text",
          pageNumber: 1,
          confidence: 99,
          recognitionEngine: "pdf_text",
        },
        {
          text,
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(result.status).toBe("succeeded");
    expect(result.fields.every((item) => item.confidence === 100)).toBe(true);
    expect(field(result, "party_b").evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "pdf_text" }),
        expect.objectContaining({ source: "ocr_300" }),
      ]),
    );
  });

  it("同页历史合同金额不得给文字层当前合同总额同值背书", () => {
    const shared = [
      "软件合同",
      "合同类型：资产类合同",
      "甲方：北京客户管理有限公司",
      "乙方：北京羽隶工程咨询有限公司",
      "合同签订日期：2025年8月25日",
    ];
    const textLayer = [
      ...shared,
      "合同总金额：人民币100000元",
      "项目名称：办公软件采购项目",
    ].join("\n");
    const visibleText = [
      ...shared,
      "原合同总金额：人民币100000元",
      "本合同总金额：印章遮挡",
      "项目名称：办公软件采购项目",
    ].join("\n");
    const result = parseContractText("", {
      sources: samePageIndependentSources(textLayer, visibleText),
      expectedCategory: "asset",
      relationType: "main",
    });
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("100000.00");
    expect(amount.confidence).toBeLessThan(100);
    expect(result.status).toBe("partial");
  });

  it("同页历史签订日期不得给文字层当前签订日期同值背书", () => {
    const shared = [
      "软件合同",
      "合同类型：资产类合同",
      "甲方：北京客户管理有限公司",
      "乙方：北京羽隶工程咨询有限公司",
      "合同总金额：人民币100000元",
    ];
    const textLayer = [
      ...shared,
      "合同签订日期：2025年8月25日",
      "项目名称：办公软件采购项目",
    ].join("\n");
    const visibleText = [
      ...shared,
      "原合同签订日期：2025年8月25日",
      "本合同签订日期：印章遮挡",
      "项目名称：办公软件采购项目",
    ].join("\n");
    const result = parseContractText("", {
      sources: samePageIndependentSources(textLayer, visibleText),
      expectedCategory: "asset",
      relationType: "main",
    });
    const contractDate = field(result, "contract_date");

    expect(contractDate.normalizedValue).toBe("2025-08-25");
    expect(contractDate.confidence).toBeLessThan(100);
    expect(result.status).toBe("partial");
  });

  it("PDF 文字层只能由同页可见图像候选验证，跨页同值不得背书", () => {
    const text = "乙方：北京咨询有限公司";
    const result = parseContractText("", {
      sources: [
        {
          text,
          source: "pdf_text",
          pageNumber: 1,
          confidence: 99,
          recognitionEngine: "pdf_text",
        },
        {
          text,
          source: "ocr_300",
          pageNumber: 2,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(field(result, "party_b").normalizedValue).toBe("北京咨询有限公司");
    expect(field(result, "party_b").confidence).toBeLessThan(100);
    expect(result.status).toBe("partial");
  });

  it("隐藏或陈旧 PDF 文字层与可见页面图像识别冲突时保持部分结果和冲突证据", () => {
    const shared = [
      "工程咨询服务合同",
      "项目名称：东城更新项目",
      "甲方：北京建设有限公司",
      "合同金额：100000元",
      "合同签订日期：2026年8月5日",
    ];
    const result = parseContractText("", {
      sources: [
        {
          text: [...shared, "乙方：陈旧文字层有限公司"].join("\n"),
          source: "pdf_text",
          pageNumber: 1,
          confidence: 99,
          recognitionEngine: "pdf_text",
        },
        {
          text: [...shared, "乙方：可见正文有限公司"].join("\n"),
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });
    const partyB = field(result, "party_b");

    expect(result.status).toBe("partial");
    expect(partyB.confidence).toBeLessThan(100);
    expect(partyB.warnings?.join(" ") || "").toContain("候选冲突");
    expect(
      new Set(partyB.candidates?.map((candidate) => candidate.normalizedValue)),
    ).toEqual(new Set(["陈旧文字层有限公司", "可见正文有限公司"]));
    expect(partyB.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "pdf_text" }),
        expect.objectContaining({ source: "ocr_300" }),
      ]),
    );
  });

  it("旧版 DOC 与 DOCX 共用的文档文字来源单独最高 99 并保持部分结果", () => {
    const text = [
      "工程咨询服务合同",
      "项目名称：东城更新项目",
      "甲方：北京建设有限公司",
      "乙方：北京咨询有限公司",
      "合同金额：100000元",
      "合同签订日期：2026年8月5日",
    ].join("\n");
    const result = parseContractText("", {
      sources: [
        {
          text,
          source: "docx_text",
          confidence: 99,
          recognitionEngine: "docx_text",
        },
      ],
    });

    expect(result.status).toBe("partial");
    expect(result.fields.every((item) => item.confidence < 100)).toBe(true);
    expect(
      Math.max(...result.fields.map((item) => item.confidence)),
    ).toBeLessThanOrEqual(99);
  });

  it("日期局部增强与整页结果一致但仍属同一引擎时不得自动采用", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: "签订时间：2025.12.10",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: "签订时间：\n2025.12.10",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });
    const contractDate = field(result, "contract_date");

    expect(contractDate.normalizedValue).toBe("2025-12-10");
    expect(contractDate.confidence).toBeGreaterThanOrEqual(95);
    expect(contractDate.confidence).toBeLessThan(100);
    expect(contractDate.warnings?.join(" ") || "").toContain("仅用于风险判断");
    expect(result.status).toBe("partial");
  });

  it("两个独立识别通道精确一致时六字段形成自动验证 100 分", () => {
    const text = [
      "工程咨询服务合同",
      "项目名称：东城更新项目",
      "甲方：北京建设有限公司",
      "乙方：北京咨询有限公司",
      "合同金额：100000元",
      "合同签订日期：2026年8月5日",
    ].join("\n");
    const result = parseContractText("", {
      sources: ["engine-a", "engine-b"].map((recognitionEngine) => ({
        text,
        source: "ocr_300" as const,
        pageNumber: 1,
        confidence: 0.99,
        recognitionEngine,
      })),
    });

    expect(result.status).toBe("succeeded");
    expect(result.fields.every((item) => item.confidence === 100)).toBe(true);
  });

  it("第二通道只在原始文字精确包含候选时形成独立复核证据", () => {
    const primaryText = [
      "技术服务合同",
      "项目名称：东城更新项目",
      "甲方：北京建设有限公司",
      "乙方：北京咨询有限公司",
      "合同金额：100000元",
      "合同签订日期：2026年8月5日",
    ].join("\n");
    const verificationText = [
      "技 术 服 务 合 同",
      "甲 方 ： 北 京 建 设 有 限 公 司",
      "乙 方 ： 北 京 咨 询 有 限 公 司",
      "甲 方 委 托 乙 方 就 东 城 更 新 项 目 进 行 技 术 服 务",
      "技 术 服 务 报 酬 总 额 为 100000 元",
      "签 订 日 期 ： 2026 年 8 月 5 日",
    ].join("\n");
    const result = parseContractText("", {
      sources: [
        {
          text: primaryText,
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: verificationText,
          source: "ocr_480",
          pageNumber: 4,
          confidence: 95,
          lineConfidences: [95, 95, 94, 95, 93, 92],
          recognitionEngine: "verification-engine",
          verificationOnly: true,
        },
      ],
    });

    expect(result.status).toBe("succeeded");
    expect(result.fields.every((item) => item.confidence === 100)).toBe(true);
    expect(field(result, "party_b").evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recognitionEngine: "verification-engine" }),
      ]),
    );
  });

  it("第二通道不一致时不得提出、纠正或补全字段", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: "乙方：北京羽隶工程咨询有限公司\n签订日期：2025年8月25日",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: "乙方：北京羽肃工程咨询有限公司\n签订日期：2025年6月25日",
          source: "ocr_480",
          pageNumber: 1,
          confidence: 95,
          recognitionEngine: "verification-engine",
          verificationOnly: true,
        },
      ],
    });

    expect(field(result, "party_b").normalizedValue).toBe(
      "北京羽隶工程咨询有限公司",
    );
    expect(field(result, "party_b").confidence).toBeLessThan(100);
    expect(field(result, "contract_date").normalizedValue).toBe("2025-08-25");
    expect(field(result, "contract_date").confidence).toBeGreaterThanOrEqual(
      95,
    );
    expect(field(result, "contract_date").warnings?.join(" ") || "").toContain(
      "仅用于风险判断",
    );
  });

  it("电子文字层存在高分冲突候选时不得形成 100 分", () => {
    const commonText = [
      "工程咨询服务合同",
      "项目名称：东城更新项目",
      "乙方：北京咨询有限公司",
      "合同金额：100000元",
      "合同签订日期：2026年8月5日",
    ].join("\n");
    const result = parseContractText("", {
      sources: [
        {
          text: `${commonText}\n甲方：北京建设有限公司`,
          source: "pdf_text",
          pageNumber: 1,
          confidence: 99.999,
        },
        {
          text: "甲方：北京城市建设有限公司",
          source: "pdf_text",
          pageNumber: 2,
          confidence: 99.999,
        },
      ],
    });

    expect(result.status).toBe("partial");
    expect(field(result, "party_a").confidence).toBeLessThan(100);
    expect(field(result, "party_a").warnings?.join(" ")).toContain("候选冲突");
  });

  it("扫描页优先级固定保留首页和末页", () => {
    const sources: ContractTextSource[] = Array.from(
      { length: 20 },
      (_, index) => ({
        text: index < 10 ? "甲方职责" : "普通正文",
        source: "pdf_text",
        pageNumber: index + 1,
        confidence: 99,
      }),
    );
    const pages = selectContractOcrPriorityPages(
      20,
      sources,
      parseContractText(""),
      8,
    );

    expect(pages).toHaveLength(8);
    expect(pages.slice(0, 2)).toEqual([1, 20]);
  });

  it("A4 高清档保留 480 DPI（每英寸点数）并按最终渲染档位去重", () => {
    const widthPoints = 595.28;
    const heightPoints = 841.89;
    const standardDpi = calculateSafePdfRenderDpi(
      widthPoints,
      heightPoints,
      300,
    );
    const highDpi = calculateSafePdfRenderDpi(widthPoints, heightPoints, 480);
    const ultraDpi = calculateSafePdfRenderDpi(widthPoints, heightPoints, 600);

    expect(standardDpi).toBe(300);
    expect(highDpi).toBe(480);
    expect(ultraDpi).toBe(highDpi);
    expect(new Set([highDpi, ultraDpi]).size).toBe(1);
    expect(
      calculateContractPdfOcrRenderProfile(1, widthPoints, heightPoints, 480)
        .key,
    ).toBe(
      calculateContractPdfOcrRenderProfile(1, widthPoints, heightPoints, 600)
        .key,
    );
  });

  it("3967×5607 高清页保持整行宽度并切为不超过 200 万像素的重叠裁片", () => {
    const renderedWidth = 3_967;
    const renderedHeight = 5_607;
    const tiles = calculateContractPdfOcrTiles(renderedWidth, renderedHeight);

    expect(tiles).toHaveLength(22);
    expect(tiles.every((tile) => tile.x === 0)).toBe(true);
    expect(tiles[0].y).toBe(0);
    expect(tiles.at(-1)!.y + tiles.at(-1)!.height).toBe(renderedHeight);
    expect(tiles[1].y).toBeLessThan(tiles[0].y + tiles[0].height);
    for (const tile of tiles) {
      expect(tile.width).toBeLessThanOrEqual(4_000);
      expect(tile.height).toBeLessThanOrEqual(4_000);
      expect(tile.width * tile.height).toBeLessThanOrEqual(2_000_000);
    }
  });

  it("A4 300 DPI（每英寸点数）页面预先拆成足够多的 200 万像素纵向裁片", () => {
    const tiles = calculateContractPdfOcrTiles(2_480, 3_504);

    expect(tiles).toHaveLength(6);
    expect(tiles[0]).toEqual({ x: 0, y: 0, width: 2_480, height: 798 });
    expect(tiles.at(-1)!.y + tiles.at(-1)!.height).toBe(3_504);
    expect(tiles.every((tile) => tile.width * tile.height <= 2_000_000)).toBe(
      true,
    );
  });

  it("单页首次异常时在同一任务自动按原参数补扫并返回准确正文", async () => {
    let callCount = 0;
    const recognize = jest.fn(async (dpi: 300 | 480) => {
      callCount += 1;
      if (callCount === 1) throw new Error("瞬时页面渲染失败");
      return {
        dpi,
        text: "14.2 本合同一式捌份，甲方执肆份，乙方执肆份",
      };
    });

    const result =
      await recognizeContractPdfPageWithAutomaticRecovery(recognize);

    expect(recognize.mock.calls.map(([dpi]) => dpi)).toEqual([300, 300]);
    expect(result).toEqual({
      source: {
        dpi: 300,
        text: "14.2 本合同一式捌份，甲方执肆份，乙方执肆份",
      },
      recovered: true,
      attempts: 2,
      dpi: 300,
    });
  });

  it("单页普通错误自动补扫有上限且最终提高分辨率", async () => {
    const recognize = jest.fn(async () => {
      throw new Error("页面处理失败");
    });

    const result =
      await recognizeContractPdfPageWithAutomaticRecovery(recognize);

    expect(recognize.mock.calls.map(([dpi]) => dpi)).toEqual([300, 300, 480]);
    expect(result).toEqual({
      source: null,
      recovered: false,
      attempts: 3,
      dpi: null,
    });
  });

  it("单页基础设施错误立即整单失败且不循环补扫", async () => {
    const infrastructureError = Object.assign(new Error("内存不足"), {
      code: "ENOMEM",
    });
    const recognize = jest.fn(async () => {
      throw infrastructureError;
    });

    await expect(
      recognizeContractPdfPageWithAutomaticRecovery(recognize),
    ).rejects.toBe(infrastructureError);
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it("用印份数优先复核锚点页，无锚点时覆盖正文末四页", () => {
    const source = (pageNumber: number, text: string): ContractTextSource => ({
      text,
      source: "ocr_300",
      pageNumber,
      confidence: 0.99,
      recognitionEngine: "paddleocr",
    });

    expect(
      selectContractSealCopyCountReviewPages(15, [
        source(1, "技术服务合同"),
        source(12, "本合同一式捌份，甲方执肆份，乙方执肆份"),
      ]),
    ).toEqual([12]);
    expect(
      selectContractSealCopyCountReviewPages(15, [source(1, "技术服务合同")]),
    ).toEqual([12, 13, 14, 15]);
  });

  it("4000×8000 最大安全页面可纵向切成 32 片且不会抛出异常", () => {
    const tiles = calculateContractPdfOcrTiles(4_000, 8_000);

    expect(tiles).toHaveLength(32);
    expect(tiles.every((tile) => tile.x === 0 && tile.width === 4_000)).toBe(
      true,
    );
    expect(tiles.at(-1)!.y + tiles.at(-1)!.height).toBe(8_000);
    expect(tiles.every((tile) => tile.width * tile.height <= 2_000_000)).toBe(
      true,
    );
  });

  it("超宽合同图片等比例收缩并保留完整行宽", () => {
    expect(calculateContractImageOcrSize(5_000, 1_000)).toEqual({
      width: 4_000,
      height: 800,
    });
    expect(calculateContractImageOcrSize(2_480, 3_504)).toEqual({
      width: 2_480,
      height: 3_504,
    });
  });

  it("横版页面先限制最终宽度并只做纵向切片", () => {
    const widthPoints = 841.89;
    const heightPoints = 595.28;
    const renderDpi = calculateSafePdfRenderDpi(widthPoints, heightPoints, 480);
    const renderedWidth = Math.ceil((widthPoints / 72) * renderDpi);
    const renderedHeight = Math.ceil((heightPoints / 72) * renderDpi);
    const tiles = calculateContractPdfOcrTiles(renderedWidth, renderedHeight);

    expect(renderDpi).toBe(342);
    expect(renderedWidth).toBeLessThanOrEqual(4_000);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.every((tile) => tile.x === 0)).toBe(true);
    expect(tiles.every((tile) => tile.width === renderedWidth)).toBe(true);
    expect(tiles.at(-1)!.y + tiles.at(-1)!.height).toBe(renderedHeight);
  });

  it("裁片合并保持阅读顺序并消除跨切缝重复文字行", () => {
    const merged = mergeContractOcrTileLines(
      [
        { text: "甲方：国网北京市电力公司" },
        { text: "项目名称：岢罗坨110千伏输变电工程" },
        { text: "合同金额：141550元" },
      ],
      [
        { text: "项目名称：岢罗坨 110 千伏输变电工程" },
        { text: "合同金额：141550元" },
        { text: "签订日期：2025年12月23日" },
      ],
    );

    expect(merged.map((line) => line.text)).toEqual([
      "甲方：国网北京市电力公司",
      "项目名称：岢罗坨110千伏输变电工程",
      "合同金额：141550元",
      "签订日期：2025年12月23日",
    ]);
  });

  it("整页只识别到残缺手写日期时按当前像素框生成局部增强裁片", () => {
    const crop = calculateContractDateFocusCrop(
      [
        {
          text: "受托方（乙方）：北京羽隶工程咨询有限公司",
          confidence: 0.99,
          box: [
            [534, 2518],
            [1787, 2526],
            [1786, 2601],
            [533, 2593],
          ],
        },
        {
          text: "签订时间：2025.12.0",
          confidence: 0.91,
          box: [
            [532, 2661],
            [1180, 2655],
            [1181, 2733],
            [533, 2738],
          ],
        },
      ],
      2_480,
      3_505,
    );

    expect(crop).not.toBeNull();
    expect(crop!.left).toBeLessThan(532);
    expect(crop!.top).toBeLessThan(2_655);
    expect(crop!.left + crop!.width).toBeGreaterThan(1_500);
    expect(crop!.top + crop!.height).toBeGreaterThan(2_800);
  });

  it("日期局部增强保持宽高比且任何送入 PaddleOCR 的结果不超过 200 万像素", () => {
    const square = calculateContractDateFocusEnhancementSize(1_400, 1_400);
    const wide = calculateContractDateFocusEnhancementSize(1_000, 200);

    expect(square.width * square.height).toBeLessThanOrEqual(2_000_000);
    expect(square.width / square.height).toBeCloseTo(1, 6);
    expect(wide).toEqual({ width: 3_000, height: 600 });
    expect(wide.width * wide.height).toBeLessThanOrEqual(2_000_000);
    expect(wide.width / wide.height).toBeCloseTo(5, 6);
    expect(() =>
      calculateContractDateFocusEnhancementSize(2_500, 2_500),
    ).toThrow("合同日期增强裁片尺寸超过安全限制");
  });

  it("完整日期与本页明确期限一致时不重复运行同引擎局部增强", () => {
    const lines = [
      {
        text: "签订时间：",
        confidence: 0.99,
        box: [
          [532, 2661],
          [880, 2661],
          [880, 2738],
          [532, 2738],
        ],
      },
      {
        text: "2025.12.10",
        confidence: 0.93,
        box: [
          [900, 2661],
          [1181, 2661],
          [1181, 2738],
          [900, 2738],
        ],
      },
    ];
    const crop = calculateContractDateFocusCrop(lines, 2_480, 3_505, [
      ...lines,
      {
        text: "有效期限：两年（2025年至2027年）",
        confidence: 0.98,
        box: [],
      },
    ]);

    expect(crop).toBeNull();
  });

  it("温泉模式的合法错误年份与本页明确期限矛盾时仍生成增强裁片", () => {
    const dateLines = [
      {
        text: "签订时间：2015.12.10",
        confidence: 0.91,
        box: [
          [532, 2661],
          [1180, 2655],
          [1181, 2733],
          [533, 2738],
        ],
      },
    ];
    const crop = calculateContractDateFocusCrop(dateLines, 2_480, 3_505, [
      ...dateLines,
      {
        text: "有效期限：两年（2025年至2027年）",
        confidence: 0.97,
        box: [],
      },
    ]);

    expect(crop).not.toBeNull();
    expect(crop!.left).toBeLessThan(532);
    expect(crop!.left + crop!.width).toBeGreaterThan(1_500);
  });

  it("完整日期没有明确期限时不得因外部真值或推测触发增强", () => {
    const crop = calculateContractDateFocusCrop(
      [
        {
          text: "签订时间：2015.12.10",
          confidence: 0.91,
          box: [
            [532, 2661],
            [1180, 2655],
            [1181, 2733],
            [533, 2738],
          ],
        },
      ],
      2_480,
      3_505,
    );

    expect(crop).toBeNull();
  });

  it("PDF（便携式文档格式）整页渲染仍受 8000 像素边长和 4000 万像素预算限制", () => {
    const widthPoints = 14_400;
    const heightPoints = 14_400;
    const safeDpi = calculateSafePdfRenderDpi(widthPoints, heightPoints, 600);
    const renderedWidth = Math.ceil((widthPoints / 72) * safeDpi);
    const renderedHeight = Math.ceil((heightPoints / 72) * safeDpi);
    expect(safeDpi).toBeLessThan(600);
    expect(renderedWidth).toBeLessThanOrEqual(8_000);
    expect(renderedHeight).toBeLessThanOrEqual(8_000);
    expect(renderedWidth * renderedHeight).toBeLessThanOrEqual(40_000_000);
    expect(() => calculateSafePdfRenderDpi(720_000, 720_000, 600)).toThrow(
      "PDF 页面尺寸异常",
    );
  });

  it("并发合同 PDF（便携式文档格式）渲染共用单许可信号量", async () => {
    let activeRenders = 0;
    let maximumActiveRenders = 0;
    let markFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runWithContractPdfRenderPermit(async () => {
      activeRenders += 1;
      maximumActiveRenders = Math.max(maximumActiveRenders, activeRenders);
      markFirstStarted();
      await firstGate;
      activeRenders -= 1;
    });
    await firstStarted;

    const second = runWithContractPdfRenderPermit(async () => {
      activeRenders += 1;
      maximumActiveRenders = Math.max(maximumActiveRenders, activeRenders);
      activeRenders -= 1;
    });
    await Promise.resolve();
    expect(activeRenders).toBe(1);
    expect(maximumActiveRenders).toBe(1);

    releaseFirst();
    await Promise.all([first, second]);
    expect(activeRenders).toBe(0);
    expect(maximumActiveRenders).toBe(1);
  });
});

describe("合同文件安全读取", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "contract-ocr-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("从真实 DOCX 结构提取段落和表格文字", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?>
       <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
         <w:body>
           <w:p><w:r><w:t>项目名称：DOCX测试项目</w:t></w:r></w:p>
           <w:tbl><w:tr>
             <w:tc><w:p><w:r><w:t>甲方：甲方有限公司</w:t></w:r></w:p></w:tc>
             <w:tc><w:p><w:r><w:t>乙方：乙方有限公司</w:t></w:r></w:p></w:tc>
           </w:tr></w:tbl>
           <w:p><w:r><w:t>合同金额：100万元（大写：壹佰万元整）</w:t></w:r></w:p>
           <w:p><w:r><w:t>技术咨询服务合同</w:t></w:r></w:p>
           <w:p><w:r><w:t>签订日期：2025年8月1日</w:t></w:r></w:p>
         </w:body>
       </w:document>`,
    );
    const filePath = path.join(temporaryDirectory, "contract.docx");
    fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await recognizeContractFile(
      filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(result.status).toBe("partial");
    expect(result.method).toBe("docx_text");
    expect(field(result, "project_name").normalizedValue).toBe("DOCX测试项目");
    expect(field(result, "amount").normalizedValue).toBe("1000000.00");
    expect(result.fields.every((item) => item.confidence < 100)).toBe(true);
    expect(result.rawText).toContain("甲方：甲方有限公司");
  });

  it("DOCX 解析排除隐藏运行、删除修订和域代码，只保留当前可见正文", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?>
       <x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
         <x:body>
           <x:p><x:r><x:rPr><x:vanish/></x:rPr><x:t>乙方：隐藏文字层有限公司</x:t></x:r></x:p>
           <x:p><x:r><x:rPr><x:vanish x:val="0"/></x:rPr><x:t>甲方：可见甲方有限公司</x:t></x:r></x:p>
           <x:del x:id="修订属性标记"/>
           <x:p><x:r><x:instrText>项目名称：域代码伪项目</x:instrText></x:r></x:p>
           <x:p><x:r><x:t>项目名称：当前可见项目</x:t></x:r></x:p>
           <x:del><x:r><x:delText>合同金额：999999元</x:delText></x:r></x:del>
           <x:p><x:r><x:t>乙方：可见乙方有限公司</x:t></x:r></x:p>
           <x:p><x:r><x:t>合同金额：100000元</x:t></x:r></x:p>
           <x:p><x:r><x:t>工程咨询服务合同</x:t></x:r></x:p>
           <x:p><x:r><x:t>签订日期：2026年8月6日</x:t></x:r></x:p>
         </x:body>
       </x:document>`,
    );
    const filePath = path.join(temporaryDirectory, "non-visible-content.docx");
    fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await recognizeContractFile(
      filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(result.status).toBe("partial");
    expect(result.rawText).not.toContain("隐藏文字层有限公司");
    expect(result.rawText).not.toContain("999999");
    expect(result.rawText).not.toContain("域代码伪项目");
    expect(field(result, "party_a").normalizedValue).toBe("可见甲方有限公司");
    expect(field(result, "party_b").normalizedValue).toBe("可见乙方有限公司");
    expect(field(result, "project_name").normalizedValue).toBe("当前可见项目");
    expect(field(result, "amount").normalizedValue).toBe("100000.00");
    expect(result.fields.every((item) => item.confidence < 100)).toBe(true);
  });

  it("DOCX 样式表启用继承隐藏属性时安全失败，不让样式隐藏文字进入候选", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    );
    zip.file(
      "word/styles.xml",
      `<?xml version="1.0"?>
       <x:styles xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
         <x:style x:type="character" x:styleId="HiddenBase">
           <x:rPr><x:vanish/></x:rPr>
         </x:style>
         <x:style x:type="character" x:styleId="InheritedHidden">
           <x:basedOn x:val="HiddenBase"/>
         </x:style>
       </x:styles>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?>
       <x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
         <x:body>
           <x:p><x:r><x:rPr><x:rStyle x:val="InheritedHidden"/></x:rPr><x:t>乙方：样式隐藏有限公司</x:t></x:r></x:p>
           <x:p><x:r><x:t>乙方：可见乙方有限公司</x:t></x:r></x:p>
         </x:body>
       </x:document>`,
    );
    const filePath = path.join(temporaryDirectory, "hidden-style.docx");
    fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await recognizeContractFile(
      filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(result.status).toBe("failed");
    expect(result.rawText).toBe("");
    expect(result.warnings.join(" ")).toContain("隐藏文字样式");
    expect(field(result, "party_b").normalizedValue).toBe("");
  });

  it("忽略内部 OLE Package（OLE 通用包）静态对象并提取 DOCX（开放文档格式）正文", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?>
       <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
         xmlns:o="urn:schemas-microsoft-com:office:office"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
         <w:body>
           <w:p><w:r><w:object><o:OLEObject Type="Embed" ProgID="Package" r:id="rIdOle"/></w:object></w:r></w:p>
           <w:p><w:r><w:t>项目名称：匿名嵌入对象测试项目</w:t></w:r></w:p>
           <w:p><w:r><w:t>甲方：匿名甲方有限公司</w:t></w:r></w:p>
           <w:p><w:r><w:t>乙方：匿名乙方有限公司</w:t></w:r></w:p>
           <w:p><w:r><w:t>合同金额：100万元（大写：壹佰万元整）</w:t></w:r></w:p>
           <w:p><w:r><w:t>技术咨询服务合同</w:t></w:r></w:p>
           <w:p><w:r><w:t>签订日期：2025年8月1日</w:t></w:r></w:p>
         </w:body>
       </w:document>`,
    );
    zip.file(
      "word/_rels/document.xml.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/></Relationships>',
    );
    zip.file(
      "word/embeddings/oleObject1.bin",
      Buffer.from('{"fileid":"匿名静态元数据"}', "utf8"),
    );
    const filePath = path.join(temporaryDirectory, "internal-ole.docx");
    fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await recognizeContractFile(
      filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(result.status).toBe("partial");
    expect(result.method).toBe("docx_text");
    expect(field(result, "project_name").normalizedValue).toBe(
      "匿名嵌入对象测试项目",
    );
    expect(result.warnings.join(" ")).not.toContain("活动嵌入对象");
  });

  it("仅含 word/embeddings 目录项的 DOCX（开放文档格式）不误报活动对象", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>匿名目录结构正文</w:t></w:r></w:p></w:body></w:document>',
    );
    zip.folder("word/embeddings");
    const filePath = path.join(temporaryDirectory, "embedding-directory.docx");
    fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await recognizeContractFile(
      filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(result.method).toBe("docx_text");
    expect(result.rawText).toContain("匿名目录结构正文");
    expect(result.warnings.join(" ")).not.toContain("活动嵌入对象");
  });

  it("拒绝扩展名正确但魔术字节错误的伪 DOCX", async () => {
    const filePath = path.join(temporaryDirectory, "fake.docx");
    fs.writeFileSync(filePath, "这不是压缩文档");

    const result = await recognizeContractFile(
      filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("不是有效的 DOCX");
  });

  it("拒绝伪造旧版 DOC 扩展名但不具备 OLE 结构的文件", async () => {
    const filePath = path.join(temporaryDirectory, "fake.doc");
    fs.writeFileSync(filePath, Buffer.alloc(512, 1));

    const result = await recognizeContractFile(filePath, "application/msword");

    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("旧版 DOC");
  });

  it("拒绝包含宏项目的 DOCX", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types />");
    zip.file("word/document.xml", "<w:document><w:p>测试</w:p></w:document>");
    zip.file("word/vbaProject.bin", Buffer.from([1, 2, 3]));
    const filePath = path.join(temporaryDirectory, "macro.docx");
    fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await recognizeContractFile(
      filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("宏");
  });

  it("拒绝内容类型声明启用宏的 DOCX", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
    );
    zip.file("word/document.xml", "<w:document><w:p>测试</w:p></w:document>");
    const filePath = path.join(temporaryDirectory, "macro-enabled.docx");
    fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await recognizeContractFile(
      filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("宏内容");
  });

  it("拒绝包含 ActiveX（活动控件）的 DOCX（开放文档格式）", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types />");
    zip.file("word/document.xml", "<w:document><w:p>测试</w:p></w:document>");
    zip.file("word/activeX/activeX1.bin", Buffer.from([1, 2, 3]));
    const filePath = path.join(temporaryDirectory, "active-control.docx");
    fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await recognizeContractFile(
      filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("活动嵌入对象");
  });

  it.each([
    { label: "附加模板", relationshipType: "attachedTemplate" },
    { label: "对象链接与嵌入对象", relationshipType: "oleObject" },
    { label: "通用包对象", relationshipType: "package" },
  ])("拒绝指向外部的 $label 关系", async ({ relationshipType }) => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types />");
    zip.file("word/document.xml", "<w:document><w:p>测试</w:p></w:document>");
    zip.file(
      "word/_rels/document.xml.rels",
      `<Relationships><Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${relationshipType}" Target="https://example.invalid/object" TargetMode="External"/></Relationships>`,
    );
    const filePath = path.join(
      temporaryDirectory,
      `external-${relationshipType}.docx`,
    );
    fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await recognizeContractFile(
      filePath,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("异常外部关系");
  });

  it("拒绝扩展名正确但魔术字节错误的伪 PDF", async () => {
    const filePath = path.join(temporaryDirectory, "fake.pdf");
    fs.writeFileSync(filePath, "not-a-pdf");

    const result = await recognizeContractFile(filePath, "application/pdf");

    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("不是有效的 PDF");
  });

  it("合同图片只调用 PaddleOCR（飞桨文字识别）并识别六个核心字段", async () => {
    const filePath = path.join(temporaryDirectory, "sealed-contract.png");
    await sharp({
      create: {
        width: 120,
        height: 120,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toFile(filePath);

    const result = await recognizeContractFile(filePath, "image/png");

    expect(result.status).toBe("partial");
    expect(result.method).toBe("image_ocr");
    expect(field(result, "contract_date").normalizedValue).toBe("2026-08-04");
    expect(field(result, "contract_date").confidence).toBeGreaterThanOrEqual(
      95,
    );
    expect(field(result, "contract_date").confidence).toBeLessThan(100);
    expect(field(result, "contract_date").warnings?.join(" ") || "").toContain(
      "仅用于风险判断",
    );
    expect(result.modelVersion).toBe("v4_mobile");
    expect(result.ocrLines[0]).toEqual({
      page: 1,
      text: "甲方：北京建设有限公司",
      bbox: [
        [10, 20],
        [110, 20],
        [110, 40],
        [10, 40],
      ],
      confidence: 0.98,
      modelVersion: "v4_mobile",
    });
    expect(callTesseractOcrDetailed).not.toHaveBeenCalled();
  });

  it("A4 300 DPI（每英寸点数）合同图片分六片送入识别且单片不超过 200 万像素", async () => {
    const filePath = path.join(temporaryDirectory, "a4-contract.png");
    await sharp({
      create: {
        width: 2_480,
        height: 3_504,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toFile(filePath);

    const observedDimensions: Array<{ width: number; height: number }> = [];
    const observeTile = async (tilePath: string) => {
      const tileMetadata = await sharp(tilePath).metadata();
      observedDimensions.push({
        width: tileMetadata.width || 0,
        height: tileMetadata.height || 0,
      });
      return {
        lines: [],
        fullText: "",
        modelVersion: "v4_mobile" as const,
      };
    };
    for (let index = 0; index < 6; index += 1) {
      jest.mocked(callPaddleOcrDetailed).mockImplementationOnce(observeTile);
    }

    const result = await recognizeContractFile(filePath, "image/png");

    expect(result.method).toBe("image_ocr");
    expect(observedDimensions).toHaveLength(6);
    expect(observedDimensions.every((item) => item.width === 2_480)).toBe(true);
    expect(
      observedDimensions.every((item) => item.width * item.height <= 2_000_000),
    ).toBe(true);
  });

  it("拒绝扩展名正确但魔术字节错误的伪 PNG", async () => {
    const filePath = path.join(temporaryDirectory, "fake.png");
    fs.writeFileSync(filePath, "not-a-png");

    const result = await recognizeContractFile(filePath, "image/png");

    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("不是有效的 JPG 或 PNG");
    expect(result.ocrLines).toEqual([]);
  });

  it.each([
    "一、信息咨询项目名称",
    "2. 工程项目名称",
    "咨询项目名称",
    "项目（工程）名称",
  ])("受控项目字段标签 %s 进入既有候选评分", (label) => {
    const result = parseContractText(
      [
        `${label}：新城110千伏输变电工程前期手续`,
        "甲方：北京建设有限公司",
        "服务费用总额：人民币120000元",
      ].join("\n"),
    );
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe("新城110千伏输变电工程前期手续");
    expect(project.candidates).toHaveLength(1);
    expect(project.normalizedValue).not.toContain("甲方");
    expect(project.normalizedValue).not.toContain("服务费用总额");
  });

  it("信息咨询服务范围等正文描述不能冒充项目字段标签", () => {
    const result = parseContractText(
      "信息咨询服务范围：负责现场协调、资料整理和付款审核。",
    );

    expect(field(result, "project_name").normalizedValue).toBe("");
    expect(field(result, "project_name").candidates || []).toHaveLength(0);
  });

  it("补充协议原合同标题允许右书名号前存在排版空白", () => {
    const result = parseContractText(
      [
        "补充协议书",
        "双方于2025年2月5日签署了合同编号为HT-2025-001的",
        "《新城110千伏输变电工程前期手续技术服务合同 》（以下简称“原合同”），现达成本协议。",
        "本协议增加合同金额：人民币20000元。",
      ].join("\n"),
      { relationType: "supplement" },
    );

    expect(field(result, "project_name").normalizedValue).toBe(
      "新城110千伏输变电工程前期手续",
    );
  });

  it("完整项目名称后的重复尾段不再被跨行二次拼接", () => {
    const result = parseContractText(
      [
        "项目名称：创新园110千伏变电站不动产权（国有建设用地）",
        "不动产权（国有建设用地）",
        "甲方：北京建设有限公司",
      ].join("\n"),
    );
    const project = field(result, "project_name");

    expect(project.normalizedValue).toBe(
      "创新园110千伏变电站不动产权（国有建设用地）",
    );
    expect(project.candidates).toHaveLength(1);
    expect(project.warnings?.join(" ") || "").not.toContain("候选冲突");
  });

  it("未闭合括号不能让项目名称吞入后续法律正文", () => {
    const result = parseContractText(
      [
        "项目名称：新城110千伏输变电工程（一期",
        "双方经协商一致，现签订本合同。",
        "甲方：北京建设有限公司",
      ].join("\n"),
    );
    const project = field(result, "project_name");

    expect(project.normalizedValue).not.toContain("双方");
    expect(
      (project.candidates || []).every(
        (candidate) => !candidate.normalizedValue.includes("双方"),
      ),
    ).toBe(true);
  });

  it.each([
    ["合同价款", "110000.00"],
    ["服务费用总额", "120000.00"],
    ["本合同含税金额", "130000.00"],
    ["总金额", "140000.00"],
    ["协议金额", "150000.00"],
  ])("金额来源 %s 可提出合同金额候选", (anchor, expected) => {
    const amountValue = expected.replace(".00", "");
    const result = parseContractText(`${anchor}：人民币${amountValue}元`);

    expect(field(result, "amount").normalizedValue).toBe(expected);
    expect(field(result, "amount").candidates).toHaveLength(1);
  });

  it("服务费用总额的数字与中文大写一致时仍走交叉验证", () => {
    const result = parseContractText(
      "服务费用总额：人民币133000元，大写：人民币壹拾叁万叁仟元整",
    );
    const amount = field(result, "amount");

    expect(amount.normalizedValue).toBe("133000.00");
    expect(amount.confidence).toBeGreaterThanOrEqual(90);
    expect(amount.warnings?.join(" ") || "").not.toContain("不一致");
  });

  it.each([
    "付款总金额：人民币3000元",
    "税费总金额：人民币6000元",
    "服务费：人民币9000元",
    "设备单价：人民币12000元",
  ])("低优先金额角色不能因总金额扩展冒充合同金额：%s", (text) => {
    const result = parseContractText(text);

    expect(field(result, "amount").normalizedValue).toBe("");
    expect(field(result, "amount").candidates || []).toHaveLength(0);
  });

  it("补充协议的协议金额未绑定增减动作时不能写入本次变化量", () => {
    const result = parseContractText("补充协议\n协议金额：人民币60000元", {
      relationType: "supplement",
    });

    expect(field(result, "amount").normalizedValue).toBe("");
    expect(getContractAmountBreakdown(result)?.changeAmount).toBeNull();
  });

  it("新增项目和金额锚点可以把电子文字层所在页加入复识页", () => {
    const parsed = parseContractText("甲方：北京建设有限公司");
    const pages = selectContractOcrPriorityPages(
      6,
      [
        {
          text: "信息咨询项目名称：新城110千伏输变电工程",
          source: "pdf_text",
          pageNumber: 3,
        },
        {
          text: "服务费用总额：人民币120000元",
          source: "pdf_text",
          pageNumber: 4,
        },
      ],
      parsed,
      8,
    );

    expect(pages).toEqual(expect.arrayContaining([1, 3, 4, 6]));
  });

  it("内部拆分 OCR（光学字符识别）原始置信度与字段规则评分", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: "甲方：北京建设有限公司",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.87,
          lineConfidences: [0.87],
          recognitionEngine: "paddleocr",
        },
      ],
    });
    const partyA = result.fields.find((field) => field.field === "party_a");

    expect(partyA).toBeDefined();
    expect(partyA?.ocrConfidence).toBeCloseTo(0.87, 6);
    expect(partyA?.fieldScore).toBe(partyA?.confidence);
    expect(partyA?.candidates?.[0].ocrConfidence).toBeCloseTo(0.87, 6);
    expect(partyA?.candidates?.[0].fieldScore).toBe(
      partyA?.candidates?.[0].confidence,
    );
    expect(partyA?.evidence?.[0].ocrConfidence).toBeCloseTo(0.87, 6);
    expect(partyA?.evidence?.[0].fieldScore).toBe(
      partyA?.evidence?.[0].confidence,
    );
  });
});
