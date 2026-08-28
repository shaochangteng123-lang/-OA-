jest.mock("nanoid", () => ({ nanoid: () => "historical-repair-test-id" }));

import fs from "node:fs";
import path from "node:path";

import {
  HISTORICAL_ASSET_PROJECT_NAME_EVIDENCE,
  HISTORICAL_ASSET_FUNDING_EVIDENCE,
  HISTORICAL_LEASE_REPAIRS,
  HISTORICAL_TRUNCATED_TITLE_REPAIRS,
  cleanHistoricalContractDisplayName,
  loadHistoricalQrEvidence,
  loadHistoricalMainFieldEvidence,
  loadHistoricalAssetFinancialEvidence,
  loadHistoricalMainFinancialEvidence,
  parseHistoricalAmountFromFileName,
  parseHistoricalDateFromFileName,
  parseHistoricalInvoiceNumber,
  parseRepairArguments,
  selectExactHistoricalAmountSubset,
  shouldBuildHistoricalRegistration,
} from "../server/scripts/repair-confirmed-historical-contracts.js";
import {
  selectHistoricalAgreementFiles,
  type InventoryFile,
} from "../server/scripts/import-confirmed-historical-contracts.js";

function inventoryFile(
  name: string,
  category = "补充协议",
  hash = name.padEnd(64, "0").slice(0, 64),
): InventoryFile {
  return {
    relativePath: `测试/${name}`,
    directory: "测试",
    name,
    ext: ".pdf",
    bytes: 100,
    hash,
    category,
    dates: [],
    amounts: [],
    primaryAmount: null,
    invoiceMedium: null,
    isMonthly: false,
    isCompletedMarker: false,
    isTerminatedMarker: false,
  };
}

describe("确认版历史合同修复脚本", () => {
  it("默认不允许提交，且预演与提交必须二选一", () => {
    expect(() => parseRepairArguments([])).toThrow("必须且只能指定");
    expect(() => parseRepairArguments(["--dry-run", "--commit"])).toThrow(
      "必须且只能指定",
    );
    expect(parseRepairArguments(["--dry-run"])).toEqual({
      mode: "dry-run",
      actorId: null,
    });
    expect(parseRepairArguments(["--verify-rollback"])).toEqual({
      mode: "verify-rollback",
      actorId: null,
    });
    expect(parseRepairArguments(["--commit", "--actor-id", "admin-1"])).toEqual(
      { mode: "commit", actorId: "admin-1" },
    );
  });

  it("去章稿不生成有效补充协议，也不生成占位协议", () => {
    const formal = inventoryFile(
      "1-正式补充协议-20260522.pdf",
      "补充协议",
      "a".repeat(64),
    );
    const draft = inventoryFile(
      "费家村补充协议去章.pdf",
      "补充协议",
      "b".repeat(64),
    );
    const selected = selectHistoricalAgreementFiles(
      [draft, formal],
      "补充协议",
      2,
    );
    expect(selected).toEqual([formal]);
  });

  it("五份租赁证据的月费乘租期与确认总额严格闭合", () => {
    expect(HISTORICAL_LEASE_REPAIRS.map((item) => item.sequence)).toEqual([
      86, 87, 88, 89, 92,
    ]);
    for (const item of HISTORICAL_LEASE_REPAIRS) {
      expect(
        (item.monthlyRent + (item.monthlyPropertyFee || 0)) * item.termMonths,
      ).toBe(item.expectedAmount);
    }
  });

  it("所有十一份资产合同均有明确主体证据，资金模式与签约主体一致", () => {
    expect(HISTORICAL_ASSET_FUNDING_EVIDENCE).toHaveLength(11);
    expect(
      HISTORICAL_ASSET_FUNDING_EVIDENCE.map((item) => item.sequence),
    ).toEqual([78, 79, 80, 81, 86, 87, 88, 89, 90, 91, 92]);
    for (const item of HISTORICAL_ASSET_FUNDING_EVIDENCE) {
      const includesEngineering = [item.partyA, item.partyB].includes(
        "北京羽隶工程咨询有限公司",
      );
      expect(item.fundingMode === "engineering_direct").toBe(
        includesEngineering,
      );
      expect(item.evidenceFileName).not.toBe("");
    }
  });

  it("十一份资产项目名称来自合同内容，报价单虚拟记录保持为空", () => {
    expect(HISTORICAL_ASSET_PROJECT_NAME_EVIDENCE).toHaveLength(11);
    expect(
      HISTORICAL_ASSET_PROJECT_NAME_EVIDENCE.map((item) => item.sequence),
    ).toEqual([78, 79, 80, 81, 86, 87, 88, 89, 90, 91, 92]);
    expect(
      HISTORICAL_ASSET_PROJECT_NAME_EVIDENCE.find(
        (item) => item.sequence === 78,
      )?.projectName,
    ).toBeNull();
    expect(
      HISTORICAL_ASSET_PROJECT_NAME_EVIDENCE.find(
        (item) => item.sequence === 90,
      )?.projectName,
    ).toBe("北京联通公有云标准产品协议");
  });

  it("十二份缺失、误拼或分行截断合同使用合同内项目名称确认完整名称", () => {
    expect(
      HISTORICAL_TRUNCATED_TITLE_REPAIRS.map((item) => item.sequence).sort(
        (left, right) => left - right,
      ),
    ).toEqual([10, 17, 24, 25, 32, 33, 38, 41, 42, 59, 66, 68]);
    expect(
      HISTORICAL_TRUNCATED_TITLE_REPAIRS.find((item) => item.sequence === 38)
        ?.title,
    ).toBe("国网北京海淀供电公司理工大学110千伏送电工程规划许可和施工许可");
    expect(
      HISTORICAL_TRUNCATED_TITLE_REPAIRS.every(
        (item) =>
          item.evidenceFileName.endsWith(".pdf") && item.title.length > 0,
      ),
    ).toBe(true);
    const repairSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/scripts/repair-confirmed-historical-contracts.ts",
      ),
      "utf8",
    );
    expect(repairSource).toContain(
      "缺少合同内项目名称证据，禁止回退文件夹名称",
    );
  });

  it("可以从历史凭证文件名稳定解析日期、金额和发票号码", () => {
    expect(
      parseHistoricalDateFromFileName(
        "2-发票25112000000117781981-20250609￥18,360.00.pdf",
      ),
    ).toBe("2025-06-09");
    expect(
      parseHistoricalAmountFromFileName(
        "2-发票25112000000117781981-20250609￥18,360.00.pdf",
      ),
    ).toBe(18360);
    expect(
      parseHistoricalInvoiceNumber(
        "2-发票25112000000117781981-20250609￥18,360.00.pdf",
      ),
    ).toBe("25112000000117781981");
  });

  it("台账名称清除文件夹年份、金额和完成标记但保留业务名称", () => {
    expect(
      cleanHistoricalContractDisplayName(
        "2021-2024-2024-焦化厂110千伏输变电工程前期手续技术咨询服务合同￥590000√",
      ),
    ).toBe("焦化厂110千伏输变电工程前期手续技术咨询服务");
    expect(
      cleanHistoricalContractDisplayName(
        "2025-跃进110千伏输变电工程不动产登记(土地证)技术服务合同￥95000√",
      ),
    ).toBe("跃进110千伏输变电工程不动产登记(土地证)技术服务");
    expect(
      cleanHistoricalContractDisplayName(
        "国网北京海淀供电公司冷泉110千伏输变电工程规划核验意见技术服务合同",
      ),
    ).toBe("国网北京海淀供电公司冷泉110千伏输变电工程规划核验意见技术服务");
    expect(
      cleanHistoricalContractDisplayName("龙潭湖-弘善110kv线路工程建设项目"),
    ).toBe("龙潭湖-弘善110kv线路工程建设项目");
    expect(
      cleanHistoricalContractDisplayName("20251208肖家河站&树村站￥7000"),
    ).toBe("肖家河站&树村站");
    expect(
      cleanHistoricalContractDisplayName(
        "国航大厦停车场车位租赁（2026上半年）",
      ),
    ).toBe("国航大厦停车场车位租赁(2026上半年)");
  });

  it("多张历史凭证只在金额能精确组成确认净额时才拆分", () => {
    const candidates = [
      { id: "租金", amount: 61134 },
      { id: "物业", amount: 18360 },
      { id: "电费", amount: 333.84 },
    ];
    expect(selectExactHistoricalAmountSubset(candidates, 79494)).toEqual([
      candidates[0],
      candidates[1],
    ]);
    expect(selectExactHistoricalAmountSubset(candidates, 80000)).toBeNull();
  });

  it("只为至少存在一条历史财务事实的根合同建立登记", () => {
    expect(shouldBuildHistoricalRegistration([])).toBe(false);
    expect(shouldBuildHistoricalRegistration([{ id: "invoice-1" }])).toBe(true);
  });

  it("对外付款明细符合数据库约束且合同详情查询完整支持", () => {
    const dbSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(dbSource).toContain(
      "item_kind IN ('invoice', 'receipt', 'payment', 'external_payment')",
    );
    expect(routeSource).toContain(
      "registration_item.item_kind = 'external_payment'",
    );
    expect(routeSource).toContain(
      "settlement_item.item_kind IN ('receipt', 'payment', 'external_payment')",
    );
    expect(routeSource).toContain(
      "contractNo: businessContractNo || row.contract_no",
    );
  });

  it("虚拟合同界面显示横线但内部编号保持唯一", () => {
    const dbSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    const importSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/scripts/import-confirmed-historical-contracts.ts",
      ),
      "utf8",
    );
    const repairSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/scripts/repair-confirmed-historical-contracts.ts",
      ),
      "utf8",
    );
    expect(dbSource).toContain("BTRIM(business_contract_no) <> '-'");
    expect(importSource).toContain(
      "CASE WHEN $21::boolean THEN '-' ELSE NULL END",
    );
    expect(importSource).toContain(
      "const rootContractNo = await generateContractNumber(client)",
    );
    expect(repairSource).toContain('systemContractNo = "HT-20260826-000105"');
  });

  it("历史确认导入使用独立识别来源，不伪装成PP-OCR自动识别", () => {
    const repairSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/scripts/repair-confirmed-historical-contracts.ts",
      ),
      "utf8",
    );
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    expect(repairSource).toContain("'historical_confirmed_import'");
    expect(repairSource).toContain("'historical-evidence-v1'");
    expect(repairSource).not.toContain("'PP-OCRv6_medium'");
    expect(detailSource).toContain("历史确认导入");
    expect(detailSource).toContain("不代表 PP-OCR 自动识别");
  });

  it("二维码证据完整覆盖冻结合同文件且没有读取错误", () => {
    const evidence = loadHistoricalQrEvidence();
    expect(evidence.contracts).toHaveLength(103);
    expect(evidence.contracts.some((item) => item.error)).toBe(false);
    expect(
      evidence.contracts.filter((item) => item.qrCodes.length),
    ).toHaveLength(88);
    expect(
      evidence.contracts.find(
        (item) => item.sequence === 53 && item.relation_type === "main",
      )?.qrCodes,
    ).toEqual(["SGBJHD00JJJS2500052"]);
  });

  it("主营合同首页证据覆盖全部有正式原件的主合同", () => {
    const evidence = loadHistoricalMainFieldEvidence();
    expect(evidence.contracts).toHaveLength(63);
    expect(
      evidence.contracts.filter(
        (item) =>
          item.fields.party_a.value &&
          item.fields.party_b.value &&
          item.fields.party_a.fieldScore >= 90 &&
          item.fields.party_b.fieldScore >= 90,
      ),
    ).toHaveLength(63);
    expect(
      evidence.contracts.filter((item) => item.fields.project_name.value),
    ).toHaveLength(60);
    expect(
      evidence.contracts.find((item) => item.sequence === 63)?.fields
        .project_name.originalValue,
    ).toBe("跃进110千伏输变电工程不动产登记(土地证)");
  });

  it("国航房租逐张财务证据区分合同内费用和合同外费用", () => {
    const evidence = loadHistoricalAssetFinancialEvidence();
    expect(evidence.documents).toHaveLength(70);
    expect(
      evidence.documents.filter(
        (item) => item.result.validationStatus === "verified",
      ),
    ).toHaveLength(66);
    const house = evidence.documents.filter((item) => item.sequence === 92);
    expect(house).toHaveLength(28);
    const invoices = house.filter((item) => item.result.kind === "invoice");
    const payments = house.filter(
      (item) => item.result.kind === "bank_receipt",
    );
    expect(
      invoices.reduce((sum, item) => sum + item.result.fields.amount, 0),
    ).toBeCloseTo(381162.52, 2);
    expect(
      invoices
        .flatMap((item) => item.result.fields.lineItems || [])
        .filter((line) => line.includeInContractAccounting)
        .reduce((sum, line) => sum + (line.grossAmount || 0), 0),
    ).toBe(377092);
    expect(
      payments.reduce((sum, item) => sum + item.result.fields.amount, 0),
    ).toBeCloseTo(459836.8, 2);
  });

  it("主营财务恢复保留老纸票识别边界且不伪造字段", () => {
    const evidence = loadHistoricalMainFinancialEvidence();
    expect(evidence.documents).toHaveLength(145);
    expect(
      evidence.documents.filter(
        (item) => item.result.validationStatus === "verified",
      ),
    ).toHaveLength(92);
    expect(
      evidence.documents.filter(
        (item) => item.result.failureKind === "document",
      ),
    ).toHaveLength(5);
    expect(
      evidence.documents.some(
        (item) => item.result.failureKind === "infrastructure",
      ),
    ).toBe(false);
  });
});
