import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { nanoid } from "nanoid";
import type { PoolClient } from "pg";

import { centsToAmount, toCents } from "../services/contractAccounting.js";
import { contractCostSettlementAmountSql } from "../services/contractSettlementAccounting.js";
import { HISTORICAL_IMPORT_BATCH_KEY } from "./import-confirmed-historical-contracts.js";

export const HISTORICAL_REPAIR_BATCH_KEY =
  "historical-import-2026-08-26-system-boundary-repair-v1";
export const HISTORICAL_REPAIR_EXPECTED_ROOT_COUNT = 75;
export const HISTORICAL_REPAIR_MANIFEST_ROOT =
  "/app/uploads/contracts/historical/2026/08/26/repair-manifests";
export const HISTORICAL_QR_EVIDENCE_PATH = path.resolve(
  process.cwd(),
  "debug/historical-import-run-2026-08-26/recovered-contract-qrcodes.json",
);
export const HISTORICAL_MAIN_FIELD_EVIDENCE_PATH = path.resolve(
  process.cwd(),
  "debug/historical-import-run-2026-08-26/recovered-main-first-page-fields.json",
);
export const HISTORICAL_ASSET_FINANCIAL_EVIDENCE_PATH = path.resolve(
  process.cwd(),
  "debug/historical-import-run-2026-08-26/recovered-asset-financial-fields.json",
);
export const HISTORICAL_MAIN_FINANCIAL_EVIDENCE_PATH = path.resolve(
  process.cwd(),
  "debug/historical-import-run-2026-08-26/recovered-main-financial-fields.json",
);

type FundingMode = "engineering_direct" | "engineering_to_technology";
type StoredKind = "invoice" | "receipt" | "payment" | "external_payment";

export interface LeaseRepairEvidence {
  sequence: number;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  monthlyPropertyFee: number | null;
  termMonths: number;
  amountSource:
    | "monthly_rent_calculated"
    | "monthly_rent_property_fee_calculated";
  expectedAmount: number;
  evidenceFileName: string;
}

export interface AssetFundingEvidence {
  sequence: number;
  partyA: string;
  partyB: string;
  fundingMode: FundingMode;
  evidenceFileName: string;
  businessContractNo?: string;
}

export interface HistoricalTitleRepairEvidence {
  sequence: number;
  title: string;
  evidenceFileName: string;
}

export interface HistoricalAssetProjectNameEvidence {
  sequence: number;
  projectName: string | null;
  evidenceFileName: string;
}

export const HISTORICAL_ASSET_PROJECT_NAME_EVIDENCE: readonly HistoricalAssetProjectNameEvidence[] =
  [
    {
      sequence: 78,
      projectName: null,
      evidenceFileName: "1-楼门牌报价单-2022￥3500.jpg",
    },
    {
      sequence: 79,
      projectName: "楼门牌购置",
      evidenceFileName: "1-楼门牌购置合同-20251208￥7000.pdf",
    },
    {
      sequence: 80,
      projectName: "楼门牌购置",
      evidenceFileName: "1-楼门牌购置合同-20260722￥13680.pdf",
    },
    {
      sequence: 81,
      projectName: "楼门牌购置",
      evidenceFileName: "1-楼门牌购置合同-20260722￥7480.pdf",
    },
    {
      sequence: 86,
      projectName: "国航大厦停车场车位租赁",
      evidenceFileName: "1-合同-20250703￥16320.pdf",
    },
    {
      sequence: 87,
      projectName: "国航大厦停车场车位租赁",
      evidenceFileName: "1-合同-20260101￥16320.pdf",
    },
    {
      sequence: 88,
      projectName: "国航大厦停车场车位租赁",
      evidenceFileName: "1-合同-20260701-20261231￥9600.pdf",
    },
    {
      sequence: 89,
      projectName: "公司租个人小客车",
      evidenceFileName: "1-小客车租赁协议-20251031-20261031￥780（每月）.pdf",
    },
    {
      sequence: 90,
      projectName: "北京联通公有云标准产品协议",
      evidenceFileName: "1-联通合同-20250601-20260531￥12000.pdf",
    },
    {
      sequence: 91,
      projectName: "网络接入技术服务",
      evidenceFileName: "1-网络接入技术服务合同书-20260601-20270531￥11000.pdf",
    },
    {
      sequence: 92,
      projectName: "国航大厦臻选房间租赁",
      evidenceFileName: "1-租房合同-20250616-20270615.pdf",
    },
  ] as const;

export const HISTORICAL_TRUNCATED_TITLE_REPAIRS: readonly HistoricalTitleRepairEvidence[] =
  [
    {
      sequence: 10,
      title: "北甸110千伏输变电工程前期手续咨询服务",
      evidenceFileName:
        "1-技术服务合同-北甸110千伏输变电工程前期手续咨询-20230518￥180500.pdf",
    },
    {
      sequence: 17,
      title: "高辛庄110千伏输变电工程（变电部分）前期手续（工程手续）咨询服务",
      evidenceFileName:
        "1-技术服务合同-高辛庄110千伏输变电工程（变电部分）前期手续（工程手续）咨询服务-20230515￥171000.pdf",
    },
    {
      sequence: 24,
      title: "后街220千伏输变电工程前期手续技术咨询服务",
      evidenceFileName:
        "1-技术服务合同-后街220千伏输变电工程前期手续技术服务合同-20240402￥437000.pdf",
    },
    {
      sequence: 25,
      title:
        "工人体育场改造复建项目红线外10千伏配套外电源工程前期手续技术咨询服务",
      evidenceFileName:
        "1-技术服务合同-工人体育场改造复建项目红线外10千伏配套外电源工程前期手续-20240402￥199500.pdf",
    },
    {
      sequence: 32,
      title: "国网北京海淀供电公司创新园110千伏变电站不动产权（国有建设用地）",
      evidenceFileName:
        "1-技术服务合同-创新园110千伏变电站不动产权（国有建设用地）-20220110￥100000.pdf",
    },
    {
      sequence: 33,
      title: "国网北京海淀供电公司稻香湖110千伏变电站不动产权（国有建设用地）",
      evidenceFileName:
        "1-技术服务合同-稻香湖110千伏变电站不动产权（国有建设用地）-20220110￥100000.pdf",
    },
    {
      sequence: 38,
      title: "国网北京海淀供电公司理工大学110千伏送电工程规划许可和施工许可",
      evidenceFileName:
        "1-技术服务合同-理工大学110千伏送电工程规划许可和施工许可-20211227￥70000.pdf",
    },
    {
      sequence: 41,
      title: "国网北京海淀供电公司树村220千伏送电工程规划许可和施工许可",
      evidenceFileName:
        "1-技术服务合同-树村220千伏送电工程规划许可和施工许可-20220110￥70000（未盖章版本）.pdf",
    },
    {
      sequence: 42,
      title: "国网北京海淀供电公司西埠头110千伏变电站不动产权（国有建设用地）",
      evidenceFileName:
        "1-技术服务合同-西埠头110千伏变电站不动产权（国有建设用地）-20211227￥100000.pdf",
    },
    {
      sequence: 59,
      title:
        "国网北京海淀供电公司冷泉110千伏输变电工程工程规划许可证、施工许可证、规划核验意见技术服务合同",
      evidenceFileName:
        "1-技术服务合同-冷泉110千伏输变电工程工程规划许可证、施工许可证、规划核验意见-20250825￥280000.pdf",
    },
    {
      sequence: 66,
      title:
        "国网北京海淀供电公司温泉-东玉河220千伏线路工程建设工程规划许可证、施工许可证",
      evidenceFileName:
        "1-技术服务合同-温泉-东玉河220千伏线路工程建设工程规划许可证、施工许可证-20260812￥80000.pdf",
    },
    {
      sequence: 68,
      title:
        "国网北京海淀供电公司永腾220千伏输变电工程建设工程规划许可证、建筑工程施工许可证",
      evidenceFileName:
        "1-技术服务合同-永腾220千伏输变电工程建设工程规划许可证、建筑工程施工许可证-20260812￥170000.pdf",
    },
  ] as const;

export const HISTORICAL_LEASE_REPAIRS: readonly LeaseRepairEvidence[] = [
  {
    sequence: 86,
    startDate: "2025-07-01",
    endDate: "2025-12-31",
    monthlyRent: 2720,
    monthlyPropertyFee: null,
    termMonths: 6,
    amountSource: "monthly_rent_calculated",
    expectedAmount: 16320,
    evidenceFileName: "1-合同-20250703￥16320.pdf",
  },
  {
    sequence: 87,
    startDate: "2026-01-01",
    endDate: "2026-06-30",
    monthlyRent: 2720,
    monthlyPropertyFee: null,
    termMonths: 6,
    amountSource: "monthly_rent_calculated",
    expectedAmount: 16320,
    evidenceFileName: "1-合同-20260101￥16320.pdf",
  },
  {
    sequence: 88,
    startDate: "2026-07-01",
    endDate: "2026-12-31",
    monthlyRent: 1600,
    monthlyPropertyFee: null,
    termMonths: 6,
    amountSource: "monthly_rent_calculated",
    expectedAmount: 9600,
    evidenceFileName: "1-合同-20260701-20261231￥9600.pdf",
  },
  {
    sequence: 89,
    startDate: "2025-10-31",
    endDate: "2026-10-31",
    monthlyRent: 780,
    monthlyPropertyFee: null,
    termMonths: 12,
    amountSource: "monthly_rent_calculated",
    expectedAmount: 9360,
    evidenceFileName: "1-小客车租赁协议-20251031-20261031￥780（每月）.pdf",
  },
  {
    sequence: 92,
    startDate: "2025-06-16",
    endDate: "2027-06-15",
    monthlyRent: 20378,
    monthlyPropertyFee: 6120,
    termMonths: 24,
    amountSource: "monthly_rent_property_fee_calculated",
    expectedAmount: 635952,
    evidenceFileName: "1-租房合同-20250616-20270615.pdf",
  },
] as const;

export const HISTORICAL_ASSET_FUNDING_EVIDENCE: readonly AssetFundingEvidence[] =
  [
    {
      sequence: 78,
      partyA: "北京羽隶工程咨询有限公司",
      partyB: "霸州市标牌厂",
      fundingMode: "engineering_direct",
      evidenceFileName: "3-回单-20260722￥3500.png",
    },
    {
      sequence: 79,
      partyA: "北京羽隶工程咨询有限公司",
      partyB: "霸州市标牌厂",
      fundingMode: "engineering_direct",
      evidenceFileName: "1-楼门牌购置合同-20251208￥7000.pdf",
    },
    {
      sequence: 80,
      partyA: "北京羽隶工程咨询有限公司",
      partyB: "霸州市标牌厂",
      fundingMode: "engineering_direct",
      evidenceFileName: "1-楼门牌购置合同-20260722￥13680.pdf",
    },
    {
      sequence: 81,
      partyA: "北京羽隶工程咨询有限公司",
      partyB: "霸州市标牌厂",
      fundingMode: "engineering_direct",
      evidenceFileName: "1-楼门牌购置合同-20260722￥7480.pdf",
    },
    {
      sequence: 86,
      partyA: "国航物业酒店管理有限公司国航大厦分公司",
      partyB: "北京羽隶科技有限公司",
      fundingMode: "engineering_to_technology",
      evidenceFileName: "1-合同-20250703￥16320.pdf",
      businessContractNo: "国航物业-国航大厦车位合（2025）14",
    },
    {
      sequence: 87,
      partyA: "国航物业酒店管理有限公司国航大厦分公司",
      partyB: "北京羽隶科技有限公司",
      fundingMode: "engineering_to_technology",
      evidenceFileName: "1-合同-20260101￥16320.pdf",
      businessContractNo: "国航物业-国航大厦车位合（2025）27",
    },
    {
      sequence: 88,
      partyA: "国航物业酒店管理有限公司国航大厦分公司",
      partyB: "北京羽隶科技有限公司",
      fundingMode: "engineering_to_technology",
      evidenceFileName: "1-合同-20260701-20261231￥9600.pdf",
      businessContractNo: "国航物业-国航大厦车位合（2026）08",
    },
    {
      sequence: 89,
      partyA: "曾宇",
      partyB: "北京羽隶工程咨询有限公司",
      fundingMode: "engineering_direct",
      evidenceFileName: "1-小客车租赁协议-20251031-20261031￥780（每月）.pdf",
    },
    {
      sequence: 90,
      partyA: "北京羽隶科技有限公司",
      partyB: "中国联合网络通信有限公司北京市分公司",
      fundingMode: "engineering_to_technology",
      evidenceFileName: "1-联通合同-20250601-20260531￥12000.pdf",
      businessContractNo: "90-100005601-1-2505277130821650",
    },
    {
      sequence: 91,
      partyA: "北京羽隶科技有限公司",
      partyB: "北京网维讯通通信技术有限公司",
      fundingMode: "engineering_to_technology",
      evidenceFileName: "1-网络接入技术服务合同书-20260601-20270531￥11000.pdf",
      businessContractNo: "网维讯通26-05-09",
    },
    {
      sequence: 92,
      partyA: "国航物业酒店管理有限公司国航大厦分公司",
      partyB: "北京羽隶科技有限公司",
      fundingMode: "engineering_to_technology",
      evidenceFileName: "1-租房合同-20250616-20270615.pdf",
      businessContractNo: "2025-A8H",
    },
  ] as const;

interface HistoricalRoot {
  id: string;
  sequence: number;
  title: string;
  category: string;
  status: string;
  current_effective_amount: string | number;
}

interface HistoricalQrEvidenceRow {
  sequence: number;
  relation_type: "main" | "supplement" | "termination";
  supplement_sequence: number | null;
  file_name: string;
  qrCodes: string[];
  error: string | null;
}

interface HistoricalQrEvidenceFile {
  batchKey: string;
  contracts: HistoricalQrEvidenceRow[];
}

interface HistoricalRecoveredField {
  value: string | null;
  originalValue?: string | null;
  fieldScore: number;
  ocrConfidence: number | null;
}

interface HistoricalMainFieldEvidenceRow {
  sequence: number;
  fileName: string;
  businessContractNumber: { value: string } | null;
  fields: {
    party_a: HistoricalRecoveredField;
    party_b: HistoricalRecoveredField;
    project_name: HistoricalRecoveredField;
  };
}

interface HistoricalMainFieldEvidenceFile {
  batchKey: string;
  contracts: HistoricalMainFieldEvidenceRow[];
}

interface HistoricalInvoiceLineEvidence {
  itemName: string;
  netAmount: number | null;
  taxAmount: number | null;
  grossAmount: number | null;
  expenseCategory: string;
  includeInContractAccounting: boolean;
  recognitionStatus: "verified" | "pending_review";
}

interface HistoricalAssetFinancialEvidenceRow {
  sequence: number;
  fileName: string;
  importedFileType: "invoice" | "receipt" | "payment";
  result: {
    kind: "invoice" | "bank_receipt";
    documentStatus: string;
    validationStatus: "verified" | "blocked" | "failed";
    direction: string;
    canAutoPost: boolean;
    failureKind?: "infrastructure" | "document" | "recognition";
    fields: {
      buyer?: string;
      seller?: string;
      itemName?: string;
      invoiceNumber?: string;
      invoiceDate?: string;
      amount: number;
      taxAmount?: number | null;
      lineItems?: HistoricalInvoiceLineEvidence[];
      paymentTime?: string;
      electronicReceiptNo?: string;
      payer?: string;
      payerAccount?: string;
      payee?: string;
      payeeAccount?: string;
    };
  };
}

interface HistoricalAssetFinancialEvidenceFile {
  batchKey: string;
  scope: string;
  documents: HistoricalAssetFinancialEvidenceRow[];
}

function normalizedQrBusinessNumber(value: unknown): string | null {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/（/gu, "(")
    .replace(/）/gu, ")")
    .trim();
  if (
    normalized.length < 6 ||
    normalized.length > 64 ||
    !/^[A-Z0-9/_().-]+$/iu.test(normalized) ||
    !/[A-Z]/iu.test(normalized) ||
    !/\d/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function loadHistoricalQrEvidence(
  evidencePath = HISTORICAL_QR_EVIDENCE_PATH,
): HistoricalQrEvidenceFile {
  const parsed = JSON.parse(
    fs.readFileSync(evidencePath, "utf8"),
  ) as HistoricalQrEvidenceFile;
  if (parsed.batchKey !== HISTORICAL_IMPORT_BATCH_KEY) {
    throw new Error("二维码证据批次与历史导入批次不一致");
  }
  if (!Array.isArray(parsed.contracts) || parsed.contracts.length !== 103) {
    throw new Error("二维码证据应完整覆盖当前103份正式/候选合同文件");
  }
  if (parsed.contracts.some((row) => row.error)) {
    throw new Error("二维码证据仍包含读取错误，禁止自动写入合同编号");
  }
  return parsed;
}

export function loadHistoricalMainFieldEvidence(
  evidencePath = HISTORICAL_MAIN_FIELD_EVIDENCE_PATH,
): HistoricalMainFieldEvidenceFile {
  const parsed = JSON.parse(
    fs.readFileSync(evidencePath, "utf8"),
  ) as HistoricalMainFieldEvidenceFile;
  if (parsed.batchKey !== HISTORICAL_IMPORT_BATCH_KEY) {
    throw new Error("主营合同首页证据批次与历史导入批次不一致");
  }
  if (!Array.isArray(parsed.contracts) || parsed.contracts.length !== 63) {
    throw new Error("主营合同首页证据应覆盖63份正式主合同");
  }
  for (const row of parsed.contracts) {
    for (const field of [row.fields.party_a, row.fields.party_b]) {
      if (
        !field.value ||
        field.fieldScore < 90 ||
        (field.ocrConfidence || 0) < 0.9
      ) {
        throw new Error(
          `历史序号${row.sequence}的签约主体证据未达到自动采用门禁`,
        );
      }
    }
    const project = row.fields.project_name;
    if (
      project.value &&
      (project.fieldScore < 90 || (project.ocrConfidence || 0) < 0.9)
    ) {
      throw new Error(
        `历史序号${row.sequence}的项目名称证据未达到自动采用门禁`,
      );
    }
  }
  return parsed;
}

export function loadHistoricalAssetFinancialEvidence(
  evidencePath = HISTORICAL_ASSET_FINANCIAL_EVIDENCE_PATH,
): HistoricalAssetFinancialEvidenceFile {
  const parsed = JSON.parse(
    fs.readFileSync(evidencePath, "utf8"),
  ) as HistoricalAssetFinancialEvidenceFile;
  if (
    parsed.batchKey !== HISTORICAL_IMPORT_BATCH_KEY ||
    parsed.scope !== "asset"
  ) {
    throw new Error("资产财务证据批次或范围不正确");
  }
  if (!Array.isArray(parsed.documents) || parsed.documents.length !== 70) {
    throw new Error("资产财务证据应完整覆盖70份发票和付款原件");
  }
  if (
    parsed.documents.some((row) => row.result.validationStatus === "failed")
  ) {
    throw new Error("资产财务证据仍有识别失败文件，禁止修复");
  }
  const houseEvidence = parsed.documents.filter((row) => row.sequence === 92);
  if (
    houseEvidence.length !== 28 ||
    houseEvidence.some(
      (row) =>
        row.result.validationStatus !== "verified" ||
        row.result.documentStatus !== "normal" ||
        !row.result.canAutoPost,
    )
  ) {
    throw new Error("国航房租28份财务原件未全部通过精准识别");
  }
  return parsed;
}

export function loadHistoricalMainFinancialEvidence(
  evidencePath = HISTORICAL_MAIN_FINANCIAL_EVIDENCE_PATH,
): HistoricalAssetFinancialEvidenceFile {
  const parsed = JSON.parse(
    fs.readFileSync(evidencePath, "utf8"),
  ) as HistoricalAssetFinancialEvidenceFile;
  if (
    parsed.batchKey !== HISTORICAL_IMPORT_BATCH_KEY ||
    parsed.scope !== "main_business"
  ) {
    throw new Error("主营财务证据批次或范围不正确");
  }
  if (!Array.isArray(parsed.documents) || parsed.documents.length !== 145) {
    throw new Error("主营财务证据应完整覆盖145份发票和回款原件");
  }
  if (
    parsed.documents.some((row) => row.result.failureKind === "infrastructure")
  ) {
    throw new Error("主营财务证据存在识别基础设施失败，禁止修复");
  }
  return parsed;
}

interface RepairPlan {
  rootCount: number;
  financialRootCount: number;
  feeDraftChildCount: number;
  leaseRootCount: number;
  assetRootCount: number;
  sealedContradictionCount: number;
  aggregateFactCount: number;
  registrationCount: number;
  alreadyApplied: boolean;
  blockers: string[];
}

interface FinancialRecord {
  id: string;
  contract_id: string;
  file_id: string | null;
  amount: string | number;
  business_date: string;
  status: string;
  kind: StoredKind;
}

interface RegistrationItemPlan extends FinancialRecord {
  fileId: string;
  fileHash: string;
  ocrJobId: string;
  itemId: string;
}

export function shouldBuildHistoricalRegistration(
  records: readonly unknown[],
): boolean {
  return records.length > 0;
}

function stableId(prefix: string, value: string, length = 22): string {
  return `${prefix}_${crypto.createHash("sha256").update(value).digest("hex").slice(0, length)}`;
}

export function parseHistoricalDateFromFileName(
  fileName: string,
): string | null {
  const compact = fileName.match(
    /(?:^|[-_])(20\d{2})(\d{2})(\d{2})(?=[^0-9]|$)/u,
  );
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dashed = fileName.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/u);
  return dashed ? `${dashed[1]}-${dashed[2]}-${dashed[3]}` : null;
}

export function parseHistoricalAmountFromFileName(
  fileName: string,
): number | null {
  const matches = [...fileName.matchAll(/[¥￥]\s*(-?[\d,]+(?:\.\d{1,2})?)/gu)];
  const raw = matches.at(-1)?.[1];
  if (!raw) return null;
  const amount = Number(raw.replace(/,/gu, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function parseHistoricalInvoiceNumber(fileName: string): string | null {
  return fileName.match(/发票[^0-9]*([0-9]{8,20})/u)?.[1] || null;
}

export function cleanHistoricalContractDisplayName(value: unknown): string {
  let normalized = String(value || "")
    .normalize("NFKC")
    .trim();
  normalized = normalized
    .replace(/^(?:20\d{2}-)+/u, "")
    .replace(/^20\d{6}(?=[^0-9])/u, "")
    .replace(/^20\d{2}(?=[\p{Script=Han}A-Z])/u, "")
    .replace(/[¥￥].*$/u, "")
    .replace(/\s*√\s*$/u, "")
    .replace(/（已解除）$/u, "")
    .replace(/合同$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) throw new Error("历史合同清洗后名称为空");
  return normalized;
}

export function selectExactHistoricalAmountSubset<T extends { amount: number }>(
  candidates: readonly T[],
  targetAmount: number,
): T[] | null {
  const target = toCents(targetAmount);
  const states = new Map<number, number[]>([[0, []]]);
  candidates.forEach((candidate, index) => {
    const value = toCents(candidate.amount);
    for (const [sum, selected] of [...states.entries()].sort(
      ([left], [right]) => right - left,
    )) {
      const next = sum + value;
      if (next > target || states.has(next)) continue;
      states.set(next, [...selected, index]);
    }
  });
  const selected = states.get(target);
  return selected ? selected.map((index) => candidates[index]!) : null;
}

async function historicalRoots(client: PoolClient): Promise<HistoricalRoot[]> {
  const result = await client.query<{
    id: string;
    sequence: string;
    title: string;
    category: string;
    status: string;
    current_effective_amount: string | number;
  }>(
    `SELECT contract.id, audit.changes_json->>'sequence' AS sequence,
            contract.title, contract.category, contract.status,
            contract.current_effective_amount
       FROM contracts contract
       JOIN contract_audit_logs audit
         ON audit.contract_id=contract.id
        AND audit.action='historical_contract_imported'
        AND audit.changes_json->>'batchKey'=$1
      WHERE contract.relation_type='main' AND contract.is_deleted=FALSE
      ORDER BY (audit.changes_json->>'sequence')::integer`,
    [HISTORICAL_IMPORT_BATCH_KEY],
  );
  return result.rows.map((row) => ({
    ...row,
    sequence: Number(row.sequence),
  }));
}

async function resolveActor(
  client: PoolClient,
  requestedActorId: string | null,
): Promise<{ id: string; role: string }> {
  const result = await client.query<{ id: string; role: string }>(
    `SELECT id, role FROM users
      WHERE status='active'
        AND role IN ('admin','super_admin','chairman')
        AND ($1::text IS NULL OR id=$1)
      ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'super_admin' THEN 1 ELSE 2 END,
        id LIMIT 1`,
    [requestedActorId],
  );
  if (!result.rows[0])
    throw new Error("开发库没有可执行历史修复的活动管理员账号");
  return result.rows[0];
}

async function assertDevelopmentRuntime(client: PoolClient): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("历史修复提交只允许 NODE_ENV=development 的开发环境");
  }
  if (path.resolve(process.cwd()) !== "/app") {
    throw new Error("历史修复提交必须在开发容器 /app 中执行");
  }
  const database = await client.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  if (database.rows[0]?.name !== "yulilog_worklog") {
    throw new Error("当前连接不是冻结的开发数据库 yulilog_worklog");
  }
}

async function hasEvidenceFile(
  client: PoolClient,
  rootId: string,
  fileName: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM contract_files file
      JOIN contracts owner ON owner.id=file.contract_id
     WHERE COALESCE(owner.root_contract_id, owner.id)=$1
       AND file.file_name=$2 AND file.is_current=TRUE LIMIT 1`,
    [rootId, fileName],
  );
  return Boolean(result.rowCount);
}

export async function inspectHistoricalRepair(
  client: PoolClient,
): Promise<RepairPlan> {
  const roots = await historicalRoots(client);
  const blockers: string[] = [];
  if (roots.length !== HISTORICAL_REPAIR_EXPECTED_ROOT_COUNT) {
    blockers.push(
      `历史主合同应为 ${HISTORICAL_REPAIR_EXPECTED_ROOT_COUNT} 个，实际为 ${roots.length} 个`,
    );
  }
  try {
    loadHistoricalQrEvidence();
  } catch (error) {
    blockers.push(
      error instanceof Error ? error.message : "二维码合同编号证据读取失败",
    );
  }
  try {
    loadHistoricalMainFieldEvidence();
  } catch (error) {
    blockers.push(
      error instanceof Error ? error.message : "主营合同首页证据读取失败",
    );
  }
  try {
    loadHistoricalAssetFinancialEvidence();
  } catch (error) {
    blockers.push(
      error instanceof Error ? error.message : "资产财务证据读取失败",
    );
  }
  try {
    loadHistoricalMainFinancialEvidence();
  } catch (error) {
    blockers.push(
      error instanceof Error ? error.message : "主营财务证据读取失败",
    );
  }
  const bySequence = new Map(roots.map((root) => [root.sequence, root]));
  for (const evidence of HISTORICAL_LEASE_REPAIRS) {
    const root = bySequence.get(evidence.sequence);
    if (!root) {
      blockers.push(`缺少租赁合同序号 ${evidence.sequence}`);
      continue;
    }
    const calculated = centsToAmount(
      (toCents(evidence.monthlyRent) +
        toCents(evidence.monthlyPropertyFee || 0)) *
        evidence.termMonths,
    );
    if (
      toCents(calculated) !== toCents(evidence.expectedAmount) ||
      toCents(root.current_effective_amount) !==
        toCents(evidence.expectedAmount)
    ) {
      blockers.push(`租赁合同序号 ${evidence.sequence} 的金额证据不闭合`);
    }
    if (!(await hasEvidenceFile(client, root.id, evidence.evidenceFileName))) {
      blockers.push(
        `租赁合同序号 ${evidence.sequence} 缺少证据文件 ${evidence.evidenceFileName}`,
      );
    }
  }
  for (const evidence of HISTORICAL_ASSET_FUNDING_EVIDENCE) {
    const root = bySequence.get(evidence.sequence);
    if (!root || root.category !== "asset") {
      blockers.push(`缺少资产合同序号 ${evidence.sequence}`);
      continue;
    }
    if (!(await hasEvidenceFile(client, root.id, evidence.evidenceFileName))) {
      blockers.push(
        `资产合同序号 ${evidence.sequence} 缺少主体证据 ${evidence.evidenceFileName}`,
      );
    }
    const includesEngineering = [evidence.partyA, evidence.partyB].includes(
      "北京羽隶工程咨询有限公司",
    );
    if (
      (evidence.fundingMode === "engineering_direct") !==
      includesEngineering
    ) {
      blockers.push(`资产合同序号 ${evidence.sequence} 的主体与资金模式冲突`);
    }
  }
  for (const evidence of HISTORICAL_TRUNCATED_TITLE_REPAIRS) {
    const root = bySequence.get(evidence.sequence);
    if (!root) {
      blockers.push(`缺少名称修复合同序号 ${evidence.sequence}`);
      continue;
    }
    if (!(await hasEvidenceFile(client, root.id, evidence.evidenceFileName))) {
      blockers.push(
        `名称修复合同序号 ${evidence.sequence} 缺少证据文件 ${evidence.evidenceFileName}`,
      );
    }
  }
  for (const evidence of HISTORICAL_ASSET_PROJECT_NAME_EVIDENCE) {
    const root = bySequence.get(evidence.sequence);
    if (!root || root.category !== "asset") {
      blockers.push(`缺少资产项目名称证据合同序号 ${evidence.sequence}`);
      continue;
    }
    if (!(await hasEvidenceFile(client, root.id, evidence.evidenceFileName))) {
      blockers.push(
        `资产项目名称合同序号 ${evidence.sequence} 缺少证据文件 ${evidence.evidenceFileName}`,
      );
    }
  }
  const counts = await client.query<{
    fee_draft: number;
    sealed_conflicts: number;
    aggregate_facts: number;
    registrations: number;
    financial_roots: number;
    already_applied: boolean;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM contract_files file
         JOIN contracts child ON child.id=file.contract_id
        WHERE child.relation_type='supplement' AND child.is_deleted=FALSE
          AND file.file_name='费家村补充协议去章.pdf') AS fee_draft,
       (SELECT COUNT(*)::int FROM contracts contract
        WHERE contract.sealed_at IS NOT NULL AND contract.is_deleted=FALSE
          AND EXISTS (
            SELECT 1 FROM contract_audit_logs audit
             WHERE audit.contract_id=COALESCE(contract.root_contract_id, contract.id)
               AND audit.action='historical_contract_imported'
               AND audit.changes_json->>'batchKey'=$1
          )
          AND NOT EXISTS (
            SELECT 1 FROM contract_files file
             WHERE file.contract_id=contract.id AND file.is_current=TRUE
               AND file.file_type='sealed_contract'
          )) AS sealed_conflicts,
       ((SELECT COUNT(*) FROM contract_invoices invoice
          JOIN contract_audit_logs audit ON audit.contract_id=invoice.contract_id
           AND audit.action='historical_contract_imported'
           AND audit.changes_json->>'batchKey'=$1
         WHERE invoice.file_id IS NULL)
        +(SELECT COUNT(*) FROM contract_receipts receipt
          JOIN contract_audit_logs audit ON audit.contract_id=receipt.contract_id
           AND audit.action='historical_contract_imported'
           AND audit.changes_json->>'batchKey'=$1
         WHERE receipt.file_id IS NULL)
        +(SELECT COUNT(*) FROM contract_payments payment
          JOIN contract_audit_logs audit ON audit.contract_id=payment.contract_id
           AND audit.action='historical_contract_imported'
           AND audit.changes_json->>'batchKey'=$1
         WHERE payment.file_id IS NULL))::int AS aggregate_facts,
       (SELECT COUNT(*)::int FROM contract_financial_registrations registration
          JOIN contract_audit_logs audit ON audit.contract_id=registration.contract_id
           AND audit.action='historical_contract_imported'
           AND audit.changes_json->>'batchKey'=$1) AS registrations,
       (SELECT COUNT(*)::int FROM (
          SELECT invoice.contract_id FROM contract_invoices invoice
           WHERE invoice.contract_id=ANY($3::text[]) AND invoice.status='confirmed'
          UNION
          SELECT receipt.contract_id FROM contract_receipts receipt
           WHERE receipt.contract_id=ANY($3::text[]) AND receipt.status='confirmed'
          UNION
          SELECT payment.contract_id FROM contract_payments payment
           WHERE payment.contract_id=ANY($3::text[]) AND payment.status='confirmed'
          UNION
          SELECT external.contract_id FROM contract_external_payments external
           WHERE external.contract_id=ANY($3::text[]) AND external.status='confirmed'
        ) financial_root) AS financial_roots,
       EXISTS(SELECT 1 FROM contract_audit_logs
               WHERE action='historical_import_repair_applied'
                 AND changes_json->>'repairBatchKey'=$2) AS already_applied`,
    [
      HISTORICAL_IMPORT_BATCH_KEY,
      HISTORICAL_REPAIR_BATCH_KEY,
      roots.map((root) => root.id),
    ],
  );
  const count = counts.rows[0]!;
  return {
    rootCount: roots.length,
    financialRootCount: Number(count.financial_roots || 0),
    feeDraftChildCount: Number(count.fee_draft || 0),
    leaseRootCount: HISTORICAL_LEASE_REPAIRS.length,
    assetRootCount: HISTORICAL_ASSET_FUNDING_EVIDENCE.length,
    sealedContradictionCount: Number(count.sealed_conflicts || 0),
    aggregateFactCount: Number(count.aggregate_facts || 0),
    registrationCount: Number(count.registrations || 0),
    alreadyApplied: Boolean(count.already_applied),
    blockers,
  };
}

async function insertAudit(
  client: PoolClient,
  input: {
    contractId: string;
    actorId: string;
    actorRole: string;
    action: string;
    changes: Record<string, unknown>;
    comment: string;
    now: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO contract_audit_logs(
       id, contract_id, action, actor_id, actor_role, from_status,
       to_status, changes_json, comment, created_at
     ) SELECT $1,$2,$3,$4,$5,status,status,$6::jsonb,$7,$8
         FROM contracts WHERE id=$2`,
    [
      nanoid(),
      input.contractId,
      input.action,
      input.actorId,
      input.actorRole,
      JSON.stringify(input.changes),
      input.comment,
      input.now,
    ],
  );
}

async function downgradeFeijiaDraft(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  actor: { id: string; role: string },
  now: string,
): Promise<void> {
  const root = roots.get(27);
  if (!root) throw new Error("缺少费家村历史主合同");
  const draft = await client.query<{
    child_id: string;
    file_id: string;
    file_hash: string;
  }>(
    `SELECT child.id AS child_id, file.id AS file_id, file.file_hash
       FROM contracts child
       JOIN contract_files file ON file.contract_id=child.id
      WHERE child.root_contract_id=$1 AND child.relation_type='supplement'
        AND child.is_deleted=FALSE AND file.is_current=TRUE
        AND file.file_name='费家村补充协议去章.pdf'
      FOR UPDATE OF child, file`,
    [root.id],
  );
  if (!draft.rows.length) return;
  if (draft.rows.length !== 1)
    throw new Error("费家村去章稿对应多条有效补充协议");
  const target = draft.rows[0]!;
  const duplicate = await client.query(
    `SELECT 1 FROM contract_files WHERE contract_id=$1 AND file_hash=$2 LIMIT 1`,
    [root.id, target.file_hash],
  );
  if (duplicate.rowCount)
    throw new Error("费家村根合同已存在同摘要去章稿，拒绝覆盖");
  await client.query(
    `UPDATE contract_files SET contract_id=$2, file_type='other'
      WHERE id=$1`,
    [target.file_id, root.id],
  );
  await client.query(
    `UPDATE contracts SET status='rejected', is_deleted=TRUE,
       sealed_at=NULL, effective_at=NULL, updated_by=$2, updated_at=$3,
       version=version+1 WHERE id=$1`,
    [target.child_id, actor.id, now],
  );
  await insertAudit(client, {
    contractId: root.id,
    actorId: actor.id,
    actorRole: actor.role,
    action: "historical_draft_agreement_downgraded",
    changes: {
      repairBatchKey: HISTORICAL_REPAIR_BATCH_KEY,
      childContractId: target.child_id,
      fileId: target.file_id,
      fileName: "费家村补充协议去章.pdf",
      resultingFileType: "other",
    },
    comment: "去章稿降为根合同普通附件，不再计入有效补充协议",
    now,
  });
}

async function applyLeaseFields(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  actorId: string,
  now: string,
): Promise<void> {
  for (const evidence of HISTORICAL_LEASE_REPAIRS) {
    const root = roots.get(evidence.sequence)!;
    await client.query(
      `UPDATE contracts SET lease_start_date=$2, lease_end_date=$3,
         lease_monthly_rent=$4, lease_monthly_property_fee=$5,
         lease_term_months=$6, lease_amount_source=$7,
         updated_by=$8, updated_at=$9, version=version+1
       WHERE id=$1`,
      [
        root.id,
        evidence.startDate,
        evidence.endDate,
        evidence.monthlyRent,
        evidence.monthlyPropertyFee,
        evidence.termMonths,
        evidence.amountSource,
        actorId,
        now,
      ],
    );
  }
}

async function applyVirtualContractNumberBoundary(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  actorId: string,
  now: string,
): Promise<void> {
  const virtual = roots.get(78);
  if (!virtual) throw new Error("缺少无合同原件的虚拟历史合同");
  const current = await client.query<{
    contract_no: string;
    business_contract_no: string | null;
  }>(
    `SELECT contract_no,business_contract_no FROM contracts WHERE id=$1 FOR UPDATE`,
    [virtual.id],
  );
  if (!current.rows[0]) throw new Error("虚拟历史合同不存在");
  let systemContractNo = current.rows[0].contract_no;
  if (systemContractNo === "-") {
    systemContractNo = "HT-20260826-000105";
  }
  await client.query(
    `UPDATE contracts SET contract_no=$2,business_contract_no='-',
       updated_by=$3,updated_at=$4,version=version+1 WHERE id=$1`,
    [virtual.id, systemContractNo, actorId, now],
  );
}

async function applyFundingEvidence(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  actorId: string,
  now: string,
): Promise<void> {
  for (const evidence of HISTORICAL_ASSET_FUNDING_EVIDENCE) {
    const root = roots.get(evidence.sequence)!;
    await client.query(
      `UPDATE contracts SET party_a=$2, party_b=$3, asset_funding_mode=$4,
         business_contract_no=CASE WHEN id=$1
           THEN COALESCE($5,business_contract_no) ELSE business_contract_no END,
         updated_by=$6, updated_at=$7, version=version+1
       WHERE id=$1 OR root_contract_id=$1`,
      [
        root.id,
        evidence.partyA,
        evidence.partyB,
        evidence.fundingMode,
        evidence.businessContractNo || null,
        actorId,
        now,
      ],
    );
  }
}

async function applyQrBusinessNumbers(
  client: PoolClient,
  actorId: string,
  now: string,
): Promise<void> {
  const evidence = loadHistoricalQrEvidence();
  const activeContracts = await client.query<{
    id: string;
    sequence: number;
    relation_type: "main" | "supplement" | "termination";
    supplement_sequence: number | null;
    file_name: string | null;
  }>(
    `SELECT contract.id,
       (audit.changes_json->>'sequence')::integer AS sequence,
       contract.relation_type, contract.supplement_sequence,
       (SELECT file.file_name FROM contract_files file
         WHERE file.contract_id=contract.id AND file.is_current=TRUE
           AND file.file_type='sealed_contract'
         ORDER BY file.created_at DESC,file.id DESC LIMIT 1) AS file_name
     FROM contracts contract
     JOIN contracts root
       ON root.id=COALESCE(contract.root_contract_id,contract.id)
     JOIN contract_audit_logs audit
       ON audit.contract_id=root.id
      AND audit.action='historical_contract_imported'
      AND audit.changes_json->>'batchKey'=$1
     WHERE contract.is_deleted=FALSE`,
    [HISTORICAL_IMPORT_BATCH_KEY],
  );
  const contractByKey = new Map(
    activeContracts.rows.map((contract) => [
      `${contract.sequence}:${contract.relation_type}:${contract.supplement_sequence ?? ""}`,
      contract,
    ]),
  );
  const numbersByContract = new Map<string, string>();
  const qrRootsBySequence = new Map<number, string>();
  const childBaseNumbers = new Map<number, Set<string>>();

  for (const row of evidence.contracts) {
    const key = `${row.sequence}:${row.relation_type}:${row.supplement_sequence ?? ""}`;
    const contract = contractByKey.get(key);
    if (!contract) continue;
    const candidates = new Set(
      row.qrCodes
        .map(normalizedQrBusinessNumber)
        .filter((value): value is string => Boolean(value)),
    );
    if (candidates.size > 1) {
      throw new Error(
        `历史序号${row.sequence}的${row.file_name}存在多个不同二维码合同编号`,
      );
    }
    const businessNumber = [...candidates][0];
    if (!businessNumber) continue;
    if (contract.file_name !== row.file_name) {
      throw new Error(
        `历史序号${row.sequence}的二维码证据文件与当前盖章文件不一致`,
      );
    }
    numbersByContract.set(contract.id, businessNumber);
    if (row.relation_type === "main") {
      qrRootsBySequence.set(row.sequence, businessNumber);
    } else {
      const base = businessNumber.replace(/\((?:B\d+|C)\)$/iu, "");
      const values = childBaseNumbers.get(row.sequence) || new Set<string>();
      values.add(base);
      childBaseNumbers.set(row.sequence, values);
    }
  }

  for (const [sequence, bases] of childBaseNumbers.entries()) {
    if (qrRootsBySequence.has(sequence) || bases.size !== 1) continue;
    const root = contractByKey.get(`${sequence}:main:`);
    if (root) numbersByContract.set(root.id, [...bases][0]!);
  }

  const duplicateNumbers = [...numbersByContract.values()].filter(
    (number, index, values) => values.indexOf(number) !== index,
  );
  if (duplicateNumbers.length) {
    throw new Error(
      `二维码合同编号存在重复：${[...new Set(duplicateNumbers)].join("、")}`,
    );
  }
  for (const [contractId, businessNumber] of numbersByContract.entries()) {
    await client.query(
      `UPDATE contracts SET business_contract_no=$2, updated_by=$3,
         updated_at=$4, version=version+1 WHERE id=$1`,
      [contractId, businessNumber, actorId, now],
    );
  }
}

async function cleanHistoricalContractNames(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  actorId: string,
  now: string,
): Promise<void> {
  const recoveredBySequence = new Map(
    loadHistoricalMainFieldEvidence().contracts.map((row) => [
      row.sequence,
      row,
    ]),
  );
  for (const root of roots.values()) {
    const recovered = recoveredBySequence.get(root.sequence);
    if (
      recovered &&
      !(await hasEvidenceFile(client, root.id, recovered.fileName))
    ) {
      throw new Error(`历史序号${root.sequence}缺少主营首页识别证据文件`);
    }
    const exactTitle = HISTORICAL_TRUNCATED_TITLE_REPAIRS.find(
      (item) => item.sequence === root.sequence,
    )?.title;
    const recoveredTitle =
      recovered?.fields.project_name.originalValue ||
      recovered?.fields.project_name.value;
    if (root.category !== "asset" && !exactTitle && !recoveredTitle) {
      throw new Error(
        `主营历史合同序号${root.sequence}缺少合同内项目名称证据，禁止回退文件夹名称`,
      );
    }
    const evidencedName =
      exactTitle ||
      recoveredTitle ||
      cleanHistoricalContractDisplayName(root.title);
    const cleanName = cleanHistoricalContractDisplayName(evidencedName);
    const assetProjectEvidence = HISTORICAL_ASSET_PROJECT_NAME_EVIDENCE.find(
      (item) => item.sequence === root.sequence,
    );
    if (root.category === "asset" && !assetProjectEvidence) {
      throw new Error(`资产历史合同序号${root.sequence}缺少项目名称识别证据`);
    }
    const contractTitle =
      root.category === "asset"
        ? cleanHistoricalContractDisplayName(root.title)
        : cleanName;
    const projectName =
      root.category === "asset"
        ? assetProjectEvidence?.projectName || null
        : cleanName;
    const partyA = recovered?.fields.party_a.value || null;
    const partyB = recovered?.fields.party_b.value || null;
    const businessNumber =
      normalizedQrBusinessNumber(recovered?.businessContractNumber?.value) ||
      null;
    const updatedRoot = await client.query<{
      business_contract_no: string | null;
    }>(
      `UPDATE contracts SET title=$2, project_name=$3,
         party_a=COALESCE($4,party_a), party_b=COALESCE($5,party_b),
         business_contract_no=CASE
           WHEN $6::text IS NULL THEN business_contract_no
           WHEN business_contract_no IS NULL OR business_contract_no=$6 THEN $6
           ELSE business_contract_no END,
         updated_by=$7, updated_at=$8, version=version+1
       WHERE id=$1 RETURNING business_contract_no`,
      [
        root.id,
        contractTitle,
        projectName,
        partyA,
        partyB,
        businessNumber,
        actorId,
        now,
      ],
    );
    if (
      businessNumber &&
      updatedRoot.rows[0]?.business_contract_no !== businessNumber
    ) {
      throw new Error(`历史序号${root.sequence}的首页编号与二维码编号冲突`);
    }
    await client.query(
      `UPDATE contracts SET
         title=CASE
           WHEN relation_type='supplement'
             THEN $2 || '补充协议（' || supplement_sequence::text || '）'
           WHEN relation_type='termination' THEN $2 || '解除协议书'
           ELSE title END,
         project_name=CASE
           WHEN relation_type='supplement'
             THEN $2 || '补充协议（' || supplement_sequence::text || '）'
           WHEN relation_type='termination' THEN $2 || '解除协议书'
           ELSE project_name END,
         party_a=COALESCE($3,party_a), party_b=COALESCE($4,party_b),
         updated_by=$5, updated_at=$6, version=version+1
       WHERE root_contract_id=$1 AND is_deleted=FALSE
         AND relation_type IN ('supplement','termination')`,
      [root.id, projectName || contractTitle, partyA, partyB, actorId, now],
    );
  }
}

async function expandAggregateRecords(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  actorId: string,
  now: string,
): Promise<void> {
  for (const root of roots.values()) {
    const tables = [
      {
        kind: "invoice" as const,
        table: "contract_invoices",
        fileType: "invoice",
        dateColumn: "invoice_date",
      },
      {
        kind:
          root.category === "asset"
            ? ("payment" as const)
            : ("receipt" as const),
        table:
          root.category === "asset" ? "contract_payments" : "contract_receipts",
        fileType: root.category === "asset" ? "payment" : "receipt",
        dateColumn: root.category === "asset" ? "payment_date" : "receipt_date",
      },
    ];
    for (const spec of tables) {
      const aggregate = await client.query<{
        id: string;
        amount: string | number;
      }>(
        `SELECT id, amount FROM ${spec.table}
          WHERE contract_id=$1 AND file_id IS NULL AND status='confirmed'
          ORDER BY created_at, id FOR UPDATE`,
        [root.id],
      );
      for (const record of aggregate.rows) {
        const files = await client.query<{
          id: string;
          file_name: string;
        }>(
          `SELECT file.id, file.file_name FROM contract_files file
            WHERE file.contract_id=$1 AND file.file_type=$2
              AND file.is_current=TRUE
              AND NOT EXISTS(SELECT 1 FROM ${spec.table} used WHERE used.file_id=file.id)
            ORDER BY file.created_at, file.id`,
          [root.id, spec.fileType],
        );
        const candidates = files.rows
          .filter((file) => !/作废|红字/u.test(file.file_name))
          .map((file) => ({
            ...file,
            amount: parseHistoricalAmountFromFileName(file.file_name),
            businessDate: parseHistoricalDateFromFileName(file.file_name),
            invoiceNo: parseHistoricalInvoiceNumber(file.file_name),
          }))
          .filter(
            (
              file,
            ): file is typeof file & {
              amount: number;
              businessDate: string;
            } => Boolean(file.amount && file.businessDate),
          );
        if (spec.kind === "invoice") {
          const numbers = candidates
            .map((file) => file.invoiceNo)
            .filter(Boolean);
          if (numbers.length !== new Set(numbers).size) continue;
        }
        const selected = selectExactHistoricalAmountSubset(
          candidates,
          Number(record.amount),
        );
        if (!selected) continue;
        for (const candidate of selected) {
          const id = stableId(
            "histfact",
            `${root.id}:${spec.kind}:${candidate.id}`,
          );
          if (spec.kind === "invoice") {
            const funding = HISTORICAL_ASSET_FUNDING_EVIDENCE.find(
              (item) => item.sequence === root.sequence,
            );
            const seller =
              root.category === "asset" ? funding?.partyB || null : root.title;
            const buyer =
              root.category === "asset"
                ? funding?.fundingMode === "engineering_direct"
                  ? "北京羽隶工程咨询有限公司"
                  : "北京羽隶科技有限公司"
                : "国网北京市电力公司";
            await client.query(
              `INSERT INTO contract_invoices(
                 id,contract_id,file_id,invoice_no,item_name,invoice_date,amount,
                 tax_amount,seller,buyer,deduplication_exempt,status,created_by,
                 confirmed_by,confirmed_at,created_at,updated_at
               ) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,FALSE,'confirmed',
                 $10,$10,$11,$11,$11) ON CONFLICT(id) DO NOTHING`,
              [
                id,
                root.id,
                candidate.id,
                candidate.invoiceNo || `HIST-${root.sequence}-${candidate.id}`,
                root.title,
                candidate.businessDate,
                candidate.amount,
                seller,
                buyer,
                actorId,
                now,
              ],
            );
          } else if (spec.kind === "receipt") {
            await client.query(
              `INSERT INTO contract_receipts(
                 id,contract_id,file_id,receipt_date,payment_time,amount,payer,
                 payee,note,status,created_by,confirmed_by,confirmed_at,
                 created_at,updated_at
               ) VALUES($1,$2,$3,$4,$4,$5,'国网北京市电力公司',
                 '北京羽隶工程咨询有限公司',$6,'confirmed',$7,$7,$8,$8,$8)
                 ON CONFLICT(id) DO NOTHING`,
              [
                id,
                root.id,
                candidate.id,
                candidate.businessDate,
                candidate.amount,
                "历史导入汇总按原始凭证拆分",
                actorId,
                now,
              ],
            );
          } else {
            const funding = HISTORICAL_ASSET_FUNDING_EVIDENCE.find(
              (item) => item.sequence === root.sequence,
            )!;
            await client.query(
              `INSERT INTO contract_payments(
                 id,contract_id,file_id,payment_date,payment_time,amount,
                 expense_category,payer,payee,note,status,created_by,
                 confirmed_by,confirmed_at,created_at,updated_at
               ) VALUES($1,$2,$3,$4,$4,$5,'rent',$6,$7,$8,'confirmed',
                 $9,$9,$10,$10,$10) ON CONFLICT(id) DO NOTHING`,
              [
                id,
                root.id,
                candidate.id,
                candidate.businessDate,
                candidate.amount,
                funding.fundingMode === "engineering_direct"
                  ? "北京羽隶工程咨询有限公司"
                  : "北京羽隶科技有限公司",
                funding.partyA === "北京羽隶科技有限公司"
                  ? funding.partyB
                  : funding.partyA,
                "历史导入汇总按原始凭证拆分",
                actorId,
                now,
              ],
            );
          }
        }
        await client.query(`DELETE FROM ${spec.table} WHERE id=$1`, [
          record.id,
        ]);
      }
    }
  }
}

async function currentRootFileId(
  client: PoolClient,
  rootId: string,
  fileName: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM contract_files
      WHERE contract_id=$1 AND file_name=$2 AND is_current=TRUE`,
    [rootId, fileName],
  );
  if (result.rows.length !== 1) {
    throw new Error(`历史财务原件未唯一匹配：${fileName}`);
  }
  return result.rows[0]!.id;
}

async function replaceInvoiceLineItems(
  client: PoolClient,
  input: {
    contractId: string;
    invoiceId: string;
    lineItems: readonly HistoricalInvoiceLineEvidence[];
    now: string;
  },
): Promise<void> {
  await client.query(
    `DELETE FROM contract_invoice_line_items WHERE invoice_id=$1`,
    [input.invoiceId],
  );
  for (const [index, line] of input.lineItems.entries()) {
    if (
      !line.itemName ||
      line.grossAmount == null ||
      line.netAmount == null ||
      line.taxAmount == null ||
      line.recognitionStatus !== "verified"
    ) {
      throw new Error(`历史发票${input.invoiceId}存在未闭合行项目`);
    }
    await client.query(
      `INSERT INTO contract_invoice_line_items(
         id,invoice_id,contract_id,line_index,item_name,net_amount,
         tax_amount,gross_amount,expense_category,
         include_in_contract_accounting,recognition_status,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified',$11,$11)`,
      [
        stableId("histline", `${input.invoiceId}:${index}`),
        input.invoiceId,
        input.contractId,
        index,
        line.itemName,
        line.netAmount,
        line.taxAmount,
        line.grossAmount,
        line.expenseCategory,
        line.includeInContractAccounting,
        input.now,
      ],
    );
  }
}

async function rebuildHouseRentalDetailedRecords(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  actorId: string,
  now: string,
): Promise<void> {
  const root = roots.get(92);
  if (!root) throw new Error("缺少国航房租历史合同");
  const evidence = loadHistoricalAssetFinancialEvidence().documents.filter(
    (row) => row.sequence === 92,
  );
  const invoices = evidence.filter((row) => row.result.kind === "invoice");
  const payments = evidence.filter((row) => row.result.kind === "bank_receipt");
  if (invoices.length !== 19 || payments.length !== 9) {
    throw new Error("国航房租应恢复19张发票和9张付款回单");
  }
  const invoiceTotal = invoices.reduce(
    (sum, row) => sum + toCents(row.result.fields.amount),
    0,
  );
  const accountingInvoiceTotal = invoices
    .flatMap((row) => row.result.fields.lineItems || [])
    .filter((line) => line.includeInContractAccounting)
    .reduce((sum, line) => sum + toCents(line.grossAmount || 0), 0);
  const paymentTotal = payments.reduce(
    (sum, row) => sum + toCents(row.result.fields.amount),
    0,
  );
  if (
    invoiceTotal !== toCents(381162.52) ||
    accountingInvoiceTotal !== toCents(377092) ||
    paymentTotal !== toCents(459836.8)
  ) {
    throw new Error("国航房租逐张财务证据汇总不闭合");
  }
  const aggregateInvoices = await client.query<{ id: string }>(
    `SELECT id FROM contract_invoices
      WHERE contract_id=$1 AND file_id IS NULL AND status='confirmed' FOR UPDATE`,
    [root.id],
  );
  const aggregatePayments = await client.query<{ id: string }>(
    `SELECT id FROM contract_payments
      WHERE contract_id=$1 AND file_id IS NULL AND status='confirmed' FOR UPDATE`,
    [root.id],
  );
  if (
    aggregateInvoices.rows.length !== 1 ||
    aggregatePayments.rows.length !== 1
  ) {
    throw new Error("国航房租历史汇总事实数量异常");
  }
  await client.query(`DELETE FROM contract_invoices WHERE id=$1`, [
    aggregateInvoices.rows[0]!.id,
  ]);
  await client.query(`DELETE FROM contract_payments WHERE id=$1`, [
    aggregatePayments.rows[0]!.id,
  ]);

  for (const row of invoices) {
    const fields = row.result.fields;
    const fileId = await currentRootFileId(client, root.id, row.fileName);
    const invoiceId = stableId("histfact", `${root.id}:invoice:${fileId}`);
    await client.query(
      `INSERT INTO contract_invoices(
         id,contract_id,file_id,invoice_no,item_name,invoice_date,amount,
         tax_amount,seller,buyer,deduplication_exempt,status,created_by,
         confirmed_by,confirmed_at,note,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,'confirmed',
         $11,$11,$12,$13,$12,$12)`,
      [
        invoiceId,
        root.id,
        fileId,
        fields.invoiceNumber,
        fields.itemName,
        fields.invoiceDate,
        fields.amount,
        fields.taxAmount ?? null,
        fields.seller,
        fields.buyer,
        actorId,
        now,
        "PP-OCRv6_medium历史原件恢复；逐张凭证保留",
      ],
    );
    await replaceInvoiceLineItems(client, {
      contractId: root.id,
      invoiceId,
      lineItems: fields.lineItems || [],
      now,
    });
  }
  for (const row of payments) {
    const fields = row.result.fields;
    const fileId = await currentRootFileId(client, root.id, row.fileName);
    const paymentId = stableId("histfact", `${root.id}:payment:${fileId}`);
    await client.query(
      `INSERT INTO contract_payments(
         id,contract_id,file_id,payment_date,payment_time,amount,
         expense_category,payer,payer_account,payee,payee_account,
         electronic_receipt_no,proof_no,currency,note,status,created_by,
         confirmed_by,confirmed_at,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$4,$5,'rent',$6,$7,$8,$9,$10,$10,'CNY',$11,
         'confirmed',$12,$12,$13,$13,$13)`,
      [
        paymentId,
        root.id,
        fileId,
        fields.paymentTime,
        fields.amount,
        fields.payer,
        fields.payerAccount,
        fields.payee,
        fields.payeeAccount,
        fields.electronicReceiptNo,
        "PP-OCRv6_medium历史原件恢复；逐张凭证保留",
        actorId,
        now,
      ],
    );
  }
}

async function applyRecoveredAssetFinancialFields(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  now: string,
): Promise<void> {
  const evidence = loadHistoricalAssetFinancialEvidence();
  for (const row of evidence.documents) {
    if (
      row.result.validationStatus !== "verified" ||
      row.result.documentStatus !== "normal" ||
      !row.result.canAutoPost
    ) {
      continue;
    }
    const root = roots.get(row.sequence);
    if (!root) throw new Error(`资产财务证据引用未知历史序号${row.sequence}`);
    const fileId = await currentRootFileId(client, root.id, row.fileName);
    const fields = row.result.fields;
    if (row.result.kind === "invoice") {
      const invoice = await client.query<{
        id: string;
        amount: string | number;
      }>(
        `SELECT id,amount FROM contract_invoices
          WHERE contract_id=$1 AND file_id=$2 AND status='confirmed'`,
        [root.id, fileId],
      );
      if (invoice.rows.length === 0 && /作废|红字|冲红/u.test(row.fileName)) {
        continue;
      }
      if (invoice.rows.length !== 1) {
        throw new Error(`已验证发票未唯一关联财务事实：${row.fileName}`);
      }
      if (toCents(invoice.rows[0]!.amount) !== toCents(fields.amount)) {
        throw new Error(`已验证发票金额与历史事实不一致：${row.fileName}`);
      }
      await client.query(
        `UPDATE contract_invoices SET invoice_no=$2,item_name=$3,
           invoice_date=$4,tax_amount=$5,seller=$6,buyer=$7,updated_at=$8
         WHERE id=$1`,
        [
          invoice.rows[0]!.id,
          fields.invoiceNumber,
          fields.itemName,
          fields.invoiceDate,
          fields.taxAmount ?? null,
          fields.seller,
          fields.buyer,
          now,
        ],
      );
      if (row.sequence === 92) {
        await replaceInvoiceLineItems(client, {
          contractId: root.id,
          invoiceId: invoice.rows[0]!.id,
          lineItems: fields.lineItems || [],
          now,
        });
      }
      continue;
    }
    const payment = await client.query<{
      id: string;
      amount: string | number;
      table_name: "contract_payments" | "contract_external_payments";
    }>(
      `SELECT id,amount,'contract_payments'::text AS table_name
         FROM contract_payments WHERE contract_id=$1 AND file_id=$2
           AND status='confirmed'
       UNION ALL
       SELECT id,amount,'contract_external_payments'::text AS table_name
         FROM contract_external_payments WHERE contract_id=$1 AND file_id=$2
           AND status='confirmed'`,
      [root.id, fileId],
    );
    if (payment.rows.length !== 1) {
      throw new Error(`已验证付款回单未唯一关联财务事实：${row.fileName}`);
    }
    if (toCents(payment.rows[0]!.amount) !== toCents(fields.amount)) {
      throw new Error(`已验证付款金额与历史事实不一致：${row.fileName}`);
    }
    const updateParameters = [
      payment.rows[0]!.id,
      fields.paymentTime,
      fields.payer,
      fields.payerAccount,
      fields.payee,
      fields.payeeAccount,
      fields.electronicReceiptNo,
      now,
    ];
    if (payment.rows[0]!.table_name === "contract_payments") {
      await client.query(
        `UPDATE contract_payments SET payment_date=$2,payment_time=$2,
           payer=$3,payer_account=$4,payee=$5,payee_account=$6,
           electronic_receipt_no=$7,proof_no=$7,currency='CNY',updated_at=$8
         WHERE id=$1`,
        updateParameters,
      );
    } else {
      await client.query(
        `UPDATE contract_external_payments SET payment_date=$2,payment_time=$2,
           payer=$3,payer_account=$4,payee=$5,payee_account=$6,
           electronic_receipt_no=$7,updated_at=$8 WHERE id=$1`,
        updateParameters,
      );
    }
  }
}

async function applyRecoveredMainFinancialFields(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  now: string,
): Promise<void> {
  const evidence = loadHistoricalMainFinancialEvidence();
  for (const row of evidence.documents) {
    if (
      row.result.validationStatus !== "verified" ||
      row.result.documentStatus !== "normal" ||
      !row.result.canAutoPost
    ) {
      continue;
    }
    const root = roots.get(row.sequence);
    if (!root) throw new Error(`主营财务证据引用未知历史序号${row.sequence}`);
    const fileId = await currentRootFileId(client, root.id, row.fileName);
    const fields = row.result.fields;
    if (row.result.kind === "invoice") {
      const invoice = await client.query<{
        id: string;
        amount: string | number;
      }>(
        `SELECT id,amount FROM contract_invoices
          WHERE contract_id=$1 AND file_id=$2 AND status='confirmed'`,
        [root.id, fileId],
      );
      if (invoice.rows.length === 0) continue;
      if (invoice.rows.length !== 1) {
        throw new Error(`主营发票重复关联财务事实：${row.fileName}`);
      }
      if (toCents(invoice.rows[0]!.amount) !== toCents(fields.amount)) {
        throw new Error(`主营发票金额与历史事实不一致：${row.fileName}`);
      }
      await client.query(
        `UPDATE contract_invoices SET invoice_no=$2,item_name=$3,
           invoice_date=$4,tax_amount=$5,seller=$6,buyer=$7,updated_at=$8
         WHERE id=$1`,
        [
          invoice.rows[0]!.id,
          fields.invoiceNumber,
          fields.itemName,
          fields.invoiceDate,
          fields.taxAmount ?? null,
          fields.seller,
          fields.buyer,
          now,
        ],
      );
      continue;
    }
    const receipt = await client.query<{ id: string; amount: string | number }>(
      `SELECT id,amount FROM contract_receipts
        WHERE contract_id=$1 AND file_id=$2 AND status='confirmed'`,
      [root.id, fileId],
    );
    if (receipt.rows.length === 0) continue;
    if (receipt.rows.length !== 1) {
      throw new Error(`主营回款重复关联财务事实：${row.fileName}`);
    }
    if (toCents(receipt.rows[0]!.amount) !== toCents(fields.amount)) {
      throw new Error(`主营回款金额与历史事实不一致：${row.fileName}`);
    }
    await client.query(
      `UPDATE contract_receipts SET receipt_date=$2,payment_time=$2,
         payer=$3,payer_account=$4,payee=$5,payee_account=$6,
         electronic_receipt_no=$7,proof_no=$7,currency='CNY',updated_at=$8
       WHERE id=$1`,
      [
        receipt.rows[0]!.id,
        fields.paymentTime,
        fields.payer,
        fields.payerAccount,
        fields.payee,
        fields.payeeAccount,
        fields.electronicReceiptNo,
        now,
      ],
    );
  }
}

async function convertExternalPayments(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  actorId: string,
  now: string,
): Promise<void> {
  for (const evidence of HISTORICAL_ASSET_FUNDING_EVIDENCE.filter(
    (item) => item.fundingMode === "engineering_to_technology",
  )) {
    const root = roots.get(evidence.sequence)!;
    const payments = await client.query<{
      id: string;
      file_id: string | null;
      payment_date: string;
      payment_time: string | null;
      amount: string | number;
      expense_category: string;
      note: string | null;
      created_by: string;
      confirmed_by: string | null;
      confirmed_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id,file_id,payment_date,payment_time,amount,expense_category,note,
              created_by,confirmed_by,confirmed_at,created_at,updated_at
         FROM contract_payments WHERE contract_id=$1 AND status='confirmed'
         ORDER BY payment_date, id FOR UPDATE`,
      [root.id],
    );
    for (const payment of payments.rows) {
      const externalId = stableId("histexternal", payment.id);
      const payee =
        evidence.partyA === "北京羽隶科技有限公司"
          ? evidence.partyB
          : evidence.partyA;
      await client.query(
        `INSERT INTO contract_external_payments(
           id,contract_id,file_id,payment_date,payment_time,amount,
           expense_category,payer,payer_account,payee,payee_account,
           electronic_receipt_no,note,status,created_by,confirmed_by,
           confirmed_at,created_at,updated_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,'北京羽隶科技有限公司',NULL,$8,NULL,
           NULL,$9,'confirmed',$10,$11,$12,$13,$14)
         ON CONFLICT(id) DO UPDATE SET file_id=EXCLUDED.file_id,
           amount=EXCLUDED.amount, payer=EXCLUDED.payer, payee=EXCLUDED.payee,
           updated_at=EXCLUDED.updated_at`,
        [
          externalId,
          root.id,
          payment.file_id,
          payment.payment_date,
          payment.payment_time,
          payment.amount,
          payment.expense_category,
          payee,
          payment.note,
          payment.created_by,
          payment.confirmed_by || actorId,
          payment.confirmed_at || now,
          payment.created_at,
          now,
        ],
      );
      await client.query(
        `UPDATE monthly_financial_bank_transaction_links
            SET business_object_type='contract_external_payment',
                business_object_id=$2,
                match_key_json=match_key_json || jsonb_build_object(
                  'historicalRoleMigration', jsonb_build_object(
                    'repairBatchKey', $3::text,
                    'previousBusinessObjectType', 'contract_payment',
                    'previousBusinessObjectId', $1::text
                  )
                ),
                warnings_json=warnings_json ||
                  '["历史导入付款原件已按真实付款角色改为科技对外付款，原月度链接已原子换绑"]'::jsonb,
                updated_at=$4
          WHERE business_object_type='contract_payment'
            AND business_object_id=$1 AND is_active=TRUE`,
        [payment.id, externalId, HISTORICAL_REPAIR_BATCH_KEY, now],
      );
      await client.query(`DELETE FROM contract_payments WHERE id=$1`, [
        payment.id,
      ]);
    }
  }
}

async function clearFalseSealedDates(
  client: PoolClient,
  actorId: string,
  now: string,
): Promise<void> {
  await client.query(
    `UPDATE contracts contract SET sealed_at=NULL, updated_by=$2,
       updated_at=$3, version=version+1
     WHERE contract.sealed_at IS NOT NULL AND contract.is_deleted=FALSE
       AND EXISTS (
         SELECT 1 FROM contract_audit_logs audit
          WHERE audit.contract_id=COALESCE(contract.root_contract_id, contract.id)
            AND audit.action='historical_contract_imported'
            AND audit.changes_json->>'batchKey'=$1
       )
       AND NOT EXISTS (
         SELECT 1 FROM contract_files file WHERE file.contract_id=contract.id
          AND file.file_type='sealed_contract' AND file.is_current=TRUE
       )`,
    [HISTORICAL_IMPORT_BATCH_KEY, actorId, now],
  );
}

async function applyHistoricalLifecycleDates(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  actorId: string,
  now: string,
): Promise<void> {
  const rootIds = [...roots.values()].map((root) => root.id);
  await client.query(
    `WITH activity AS (
       SELECT root.id,
         LEAST(
           (SELECT MIN(invoice.invoice_date) FROM contract_invoices invoice
             WHERE invoice.contract_id=root.id AND invoice.status='confirmed'),
           (SELECT MIN(receipt.receipt_date) FROM contract_receipts receipt
             WHERE receipt.contract_id=root.id AND receipt.status='confirmed'),
           (SELECT MIN(payment.payment_date) FROM contract_payments payment
             WHERE payment.contract_id=root.id AND payment.status='confirmed'),
           (SELECT MIN(payment.payment_date) FROM contract_external_payments payment
             WHERE payment.contract_id=root.id AND payment.status='confirmed')
         ) AS first_activity_date,
         CASE
           WHEN root.financial_direction='income' THEN
             (SELECT MAX(receipt.receipt_date) FROM contract_receipts receipt
               WHERE receipt.contract_id=root.id AND receipt.status='confirmed')
           WHEN root.asset_funding_mode='engineering_to_technology' THEN
             (SELECT MAX(payment.payment_date) FROM contract_external_payments payment
               WHERE payment.contract_id=root.id AND payment.status='confirmed')
           ELSE
             (SELECT MAX(payment.payment_date) FROM contract_payments payment
               WHERE payment.contract_id=root.id AND payment.status='confirmed')
         END AS final_settlement_date,
         (SELECT MAX(termination.contract_date) FROM contracts termination
           WHERE termination.root_contract_id=root.id
             AND termination.relation_type='termination'
             AND termination.is_deleted=FALSE) AS termination_date,
         EXISTS(SELECT 1 FROM contract_files file
           WHERE file.contract_id=root.id AND file.file_type='sealed_contract'
             AND file.is_current=TRUE) AS has_sealed_file
       FROM contracts root WHERE root.id=ANY($1::text[])
     )
     UPDATE contracts root SET
       sealed_at=CASE WHEN activity.has_sealed_file AND root.contract_date IS NOT NULL
         THEN root.contract_date || 'T00:00:00+08:00'
         WHEN activity.has_sealed_file THEN root.sealed_at ELSE NULL END,
       effective_at=CASE WHEN root.contract_date IS NOT NULL
         THEN root.contract_date || 'T00:00:00+08:00' ELSE root.effective_at END,
       executing_at=CASE WHEN root.status IN ('executing','completed')
         AND activity.first_activity_date IS NOT NULL
         THEN activity.first_activity_date || 'T00:00:00+08:00'
         ELSE root.executing_at END,
       completed_at=CASE WHEN root.status='completed'
         AND activity.final_settlement_date IS NOT NULL
         THEN activity.final_settlement_date || 'T00:00:00+08:00'
         WHEN root.status='completed' THEN root.completed_at ELSE NULL END,
       terminated_at=CASE WHEN root.status='terminated'
         AND activity.termination_date IS NOT NULL
         THEN activity.termination_date || 'T00:00:00+08:00'
         WHEN root.status='terminated' THEN root.terminated_at ELSE NULL END,
       updated_by=$2,updated_at=$3,version=root.version+1
     FROM activity WHERE root.id=activity.id`,
    [rootIds, actorId, now],
  );
  await client.query(
    `UPDATE contracts child SET
       sealed_at=CASE WHEN child.contract_date IS NOT NULL
         AND EXISTS(SELECT 1 FROM contract_files file
           WHERE file.contract_id=child.id AND file.file_type='sealed_contract'
             AND file.is_current=TRUE)
         THEN child.contract_date || 'T00:00:00+08:00' ELSE child.sealed_at END,
       effective_at=CASE WHEN child.contract_date IS NOT NULL
         THEN child.contract_date || 'T00:00:00+08:00' ELSE child.effective_at END,
       updated_by=$2,updated_at=$3,version=child.version+1
     WHERE child.root_contract_id=ANY($1::text[]) AND child.is_deleted=FALSE`,
    [rootIds, actorId, now],
  );
}

async function normalizeHistoricalFinancialParties(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  now: string,
): Promise<void> {
  const rootIds = [...roots.values()].map((root) => root.id);
  await client.query(
    `UPDATE contract_invoices invoice SET
       seller=CASE WHEN root.category='asset'
          THEN CASE WHEN root.party_a IN (
            '北京羽隶工程咨询有限公司','北京羽隶科技有限公司'
          ) THEN root.party_b ELSE root.party_a END
          ELSE '北京羽隶工程咨询有限公司' END,
       buyer=CASE WHEN root.category='asset'
          THEN CASE WHEN root.asset_funding_mode='engineering_direct'
            THEN '北京羽隶工程咨询有限公司'
            ELSE '北京羽隶科技有限公司' END
          ELSE root.party_a END,
       updated_at=$2
      FROM contracts root
     WHERE invoice.contract_id=root.id AND root.id=ANY($1::text[])
       AND invoice.status='confirmed'`,
    [rootIds, now],
  );
  await client.query(
    `UPDATE contract_receipts receipt SET payer=root.party_a,
       payee='北京羽隶工程咨询有限公司', updated_at=$2
      FROM contracts root
     WHERE receipt.contract_id=root.id AND root.id=ANY($1::text[])
       AND receipt.status='confirmed'`,
    [rootIds, now],
  );
  await client.query(
    `UPDATE contract_payments payment SET
       payer='北京羽隶工程咨询有限公司',
       payee=CASE WHEN root.party_a='北京羽隶工程咨询有限公司'
         THEN root.party_b ELSE root.party_a END,
       updated_at=$2
      FROM contracts root
     WHERE payment.contract_id=root.id AND root.id=ANY($1::text[])
       AND payment.status='confirmed'`,
    [rootIds, now],
  );
  await client.query(
    `UPDATE contract_external_payments payment SET
       payer='北京羽隶科技有限公司',
       payee=CASE WHEN root.party_a='北京羽隶科技有限公司'
         THEN root.party_b ELSE root.party_a END,
       updated_at=$2
      FROM contracts root
     WHERE payment.contract_id=root.id AND root.id=ANY($1::text[])
       AND payment.status='confirmed'`,
    [rootIds, now],
  );
}

function financialTable(kind: StoredKind): string {
  if (kind === "invoice") return "contract_invoices";
  if (kind === "receipt") return "contract_receipts";
  if (kind === "payment") return "contract_payments";
  return "contract_external_payments";
}

async function financialRecords(
  client: PoolClient,
  root: HistoricalRoot,
  fundingMode: FundingMode | null,
): Promise<FinancialRecord[]> {
  const result: FinancialRecord[] = [];
  for (const kind of [
    "invoice",
    root.category === "asset" && fundingMode === "engineering_to_technology"
      ? "external_payment"
      : root.category === "asset"
        ? "payment"
        : "receipt",
  ] satisfies StoredKind[]) {
    const dateColumn =
      kind === "invoice"
        ? "invoice_date"
        : kind === "receipt"
          ? "receipt_date"
          : "payment_date";
    const rows = await client.query<{
      id: string;
      contract_id: string;
      file_id: string | null;
      amount: string | number;
      business_date: string;
      status: string;
    }>(
      `SELECT id,contract_id,file_id,amount,${dateColumn} AS business_date,status
         FROM ${financialTable(kind)}
        WHERE contract_id=$1 AND status='confirmed' ORDER BY ${dateColumn},id`,
      [root.id],
    );
    result.push(...rows.rows.map((row) => ({ ...row, kind })));
  }
  return result;
}

async function ensureManifestFile(
  client: PoolClient,
  input: {
    root: HistoricalRoot;
    record: FinancialRecord;
    actorId: string;
    now: string;
    createdPaths: string[];
  },
): Promise<{ id: string; hash: string }> {
  const content = `${JSON.stringify(
    {
      type: "historical_confirmed_aggregate_fact",
      repairBatchKey: HISTORICAL_REPAIR_BATCH_KEY,
      contractId: input.root.id,
      sequence: input.root.sequence,
      recordKind: input.record.kind,
      recordId: input.record.id,
      businessDate: input.record.business_date,
      amount: Number(input.record.amount),
      note: "原件组合不能唯一还原确认净额；本文件是迁移审计清单，不冒充银行或发票原件。",
    },
    null,
    2,
  )}\n`;
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const fileId = stableId(
    "histmanifest",
    `${input.root.id}:${input.record.id}`,
  );
  await fs.promises.mkdir(HISTORICAL_REPAIR_MANIFEST_ROOT, { recursive: true });
  const absolutePath = path.join(
    HISTORICAL_REPAIR_MANIFEST_ROOT,
    `${fileId}.json`,
  );
  try {
    await fs.promises.writeFile(absolutePath, content, { flag: "wx" });
    input.createdPaths.push(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await fs.promises.readFile(absolutePath, "utf8");
    if (existing !== content)
      throw new Error(`迁移清单内容冲突：${absolutePath}`);
  }
  const storedPath = path.relative("/app", absolutePath).replace(/\\/gu, "/");
  await client.query(
    `INSERT INTO contract_files(
       id,contract_id,file_type,file_name,file_path,file_size,mime_type,
       file_hash,version,is_current,uploaded_by,created_at
     ) VALUES($1,$2,$3,$4,$5,$6,'application/json',$7,1,TRUE,$8,$9)
     ON CONFLICT(contract_id,file_hash) DO NOTHING`,
    [
      fileId,
      input.root.id,
      input.record.kind === "external_payment" ? "payment" : input.record.kind,
      `历史汇总财务事实-${input.root.sequence}-${input.record.kind}.json`,
      storedPath,
      Buffer.byteLength(content),
      hash,
      input.actorId,
      input.now,
    ],
  );
  await client.query(
    `UPDATE ${financialTable(input.record.kind)} SET file_id=$2 WHERE id=$1`,
    [input.record.id, fileId],
  );
  return { id: fileId, hash };
}

async function buildRegistrationItems(
  client: PoolClient,
  input: {
    root: HistoricalRoot;
    records: FinancialRecord[];
    actorId: string;
    now: string;
    createdPaths: string[];
  },
): Promise<RegistrationItemPlan[]> {
  const plans: RegistrationItemPlan[] = [];
  for (const record of input.records) {
    let fileId = record.file_id;
    let fileHash: string;
    if (!fileId) {
      const manifest = await ensureManifestFile(client, {
        root: input.root,
        record,
        actorId: input.actorId,
        now: input.now,
        createdPaths: input.createdPaths,
      });
      fileId = manifest.id;
      fileHash = manifest.hash;
    } else {
      const file = await client.query<{ file_hash: string }>(
        `SELECT file_hash FROM contract_files WHERE id=$1`,
        [fileId],
      );
      fileHash = file.rows[0]?.file_hash || "";
      if (!/^[0-9a-f]{64}$/u.test(fileHash)) {
        throw new Error(`财务记录 ${record.id} 的文件摘要无效`);
      }
    }
    const ocrJobId = stableId(
      "histocr",
      `${input.root.id}:${record.kind}:${record.id}`,
    );
    const itemId = stableId(
      "histitem",
      `${input.root.id}:${record.kind}:${record.id}`,
    );
    plans.push({ ...record, fileId, fileHash, ocrJobId, itemId });
  }
  return plans;
}

function allocateMatches(
  invoices: readonly RegistrationItemPlan[],
  settlements: readonly RegistrationItemPlan[],
): Array<{
  invoice: RegistrationItemPlan;
  settlement: RegistrationItemPlan;
  amount: number;
}> {
  const result: Array<{
    invoice: RegistrationItemPlan;
    settlement: RegistrationItemPlan;
    amount: number;
  }> = [];
  const remainingInvoices = invoices.map((item) => ({
    item,
    cents: toCents(item.amount),
  }));
  const remainingSettlements = settlements.map((item) => ({
    item,
    cents: toCents(item.amount),
  }));
  let invoiceIndex = 0;
  let settlementIndex = 0;
  while (
    invoiceIndex < remainingInvoices.length &&
    settlementIndex < remainingSettlements.length
  ) {
    const invoice = remainingInvoices[invoiceIndex]!;
    const settlement = remainingSettlements[settlementIndex]!;
    const allocated = Math.min(invoice.cents, settlement.cents);
    if (allocated > 0) {
      result.push({
        invoice: invoice.item,
        settlement: settlement.item,
        amount: centsToAmount(allocated),
      });
    }
    invoice.cents -= allocated;
    settlement.cents -= allocated;
    if (invoice.cents === 0) invoiceIndex += 1;
    if (settlement.cents === 0) settlementIndex += 1;
  }
  return result;
}

async function rebuildRegistrations(
  client: PoolClient,
  roots: Map<number, HistoricalRoot>,
  actorId: string,
  now: string,
  createdPaths: string[],
): Promise<void> {
  const existing = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM contract_financial_registrations registration
      WHERE registration.contract_id=ANY($1::text[])`,
    [[...roots.values()].map((root) => root.id)],
  );
  if (Number(existing.rows[0]?.count || 0) > 0) {
    throw new Error("历史合同已经存在财务登记，拒绝覆盖人工或其他流程数据");
  }
  for (const root of roots.values()) {
    const funding = HISTORICAL_ASSET_FUNDING_EVIDENCE.find(
      (item) => item.sequence === root.sequence,
    );
    const records = await financialRecords(
      client,
      root,
      funding?.fundingMode || null,
    );
    if (!shouldBuildHistoricalRegistration(records)) continue;
    const items = await buildRegistrationItems(client, {
      root,
      records,
      actorId,
      now,
      createdPaths,
    });
    const invoices = items.filter((item) => item.kind === "invoice");
    const accountingKind: StoredKind =
      root.category === "asset" &&
      funding?.fundingMode === "engineering_to_technology"
        ? "external_payment"
        : root.category === "asset"
          ? "payment"
          : "receipt";
    const settlements = items.filter((item) => item.kind === accountingKind);
    const matches = allocateMatches(invoices, settlements);
    const invoiceTotal = invoices.reduce(
      (sum, item) => sum + toCents(item.amount),
      0,
    );
    const settlementTotal = settlements.reduce(
      (sum, item) => sum + toCents(item.amount),
      0,
    );
    const confirmed =
      invoiceTotal > 0 &&
      invoiceTotal === settlementTotal &&
      matches.length > 0;
    const registrationId = stableId("histreg", root.id);
    await client.query(
      `INSERT INTO contract_financial_registrations(
         id,contract_id,settlement_kind,financial_direction,
         direction_invoice_record_id,status,created_by,confirmed_by,
         confirmed_at,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [
        registrationId,
        root.id,
        root.category === "asset" ? "payment" : "receipt",
        root.category === "asset" ? "cost" : "income",
        invoices[0]?.id || null,
        confirmed ? "confirmed" : "draft",
        actorId,
        confirmed ? actorId : null,
        confirmed ? now : null,
        now,
      ],
    );
    for (const item of items) {
      const recordKind =
        item.kind === "external_payment" ? "payment" : item.kind;
      const direction =
        item.kind === "invoice"
          ? root.category === "asset"
            ? "input"
            : "output"
          : item.kind === "receipt"
            ? "receipt"
            : "payment";
      await client.query(
        `INSERT INTO contract_financial_file_hashes(file_hash,file_id,contract_id,created_at)
         VALUES($1,$2,$3,$4) ON CONFLICT(file_hash) DO NOTHING`,
        [item.fileHash, item.fileId, root.id, now],
      );
      await client.query(
        `INSERT INTO contract_financial_ocr_jobs(
           id,contract_id,file_id,file_hash,record_kind,document_kind,status,
           validation_status,recognition_method,engine_version,parser_version,
           evidence_text_hash,direction,document_status,can_auto_post,
           snapshot_json,blocking_reasons_json,warnings_json,requested_by,
           record_id,started_at,finished_at,consumed_at,created_at,updated_at
         ) VALUES($1,$2,$3,$4,$5,$6,'consumed','verified',
           'historical_confirmed_import','historical-evidence-v1',
           'historical-repair-v1',$4,$7,'normal',TRUE,$8::jsonb,'[]'::jsonb,
           '[]'::jsonb,$9,$10,$11,$11,$11,$11,$11)`,
        [
          item.ocrJobId,
          root.id,
          item.fileId,
          item.fileHash,
          recordKind,
          item.kind === "invoice" ? "invoice" : "bank_receipt",
          direction,
          JSON.stringify({
            source: "confirmed_historical_import",
            repairBatchKey: HISTORICAL_REPAIR_BATCH_KEY,
            recordKind: item.kind,
            recordId: item.id,
            amount: Number(item.amount),
            businessDate: item.business_date,
          }),
          actorId,
          item.id,
          now,
        ],
      );
      await client.query(
        `UPDATE ${financialTable(item.kind)} SET financial_ocr_job_id=$2 WHERE id=$1`,
        [item.id, item.ocrJobId],
      );
      await client.query(
        `INSERT INTO contract_financial_registration_items(
           id,registration_id,contract_id,item_kind,ocr_job_id,record_id,
           business_key_hash,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          item.itemId,
          registrationId,
          root.id,
          item.kind,
          item.ocrJobId,
          item.id,
          crypto
            .createHash("sha256")
            .update(`${root.id}:${item.kind}:${item.id}`)
            .digest("hex"),
          now,
        ],
      );
    }
    for (const match of matches) {
      await client.query(
        `INSERT INTO contract_financial_registration_matches(
           id,registration_id,contract_id,invoice_item_id,
           settlement_item_id,allocated_amount,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          stableId(
            "histmatch",
            `${registrationId}:${match.invoice.id}:${match.settlement.id}`,
          ),
          registrationId,
          root.id,
          match.invoice.itemId,
          match.settlement.itemId,
          match.amount,
          now,
        ],
      );
    }
  }
}

async function assertHistoricalRepairResult(client: PoolClient): Promise<void> {
  const count = await client.query<{
    roots: number;
    supplements: number;
    terminations: number;
    registrations: number;
    items: number;
    matches: number;
    invoices: number;
    receipts: number;
    payments: number;
    external_payments: number;
    invoice_lines: number;
    lease_roots: number;
    business_numbers: number;
    virtual_number_boundary: number;
    sealed_conflicts: number;
    dirty_names: number;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM contracts WHERE relation_type='main'
         AND is_deleted=FALSE) AS roots,
       (SELECT COUNT(*)::int FROM contracts WHERE relation_type='supplement'
         AND is_deleted=FALSE) AS supplements,
       (SELECT COUNT(*)::int FROM contracts WHERE relation_type='termination'
         AND is_deleted=FALSE) AS terminations,
       (SELECT COUNT(*)::int FROM contract_financial_registrations) AS registrations,
       (SELECT COUNT(*)::int FROM contract_financial_registration_items) AS items,
       (SELECT COUNT(*)::int FROM contract_financial_registration_matches) AS matches,
       (SELECT COUNT(*)::int FROM contract_invoices WHERE status='confirmed') AS invoices,
       (SELECT COUNT(*)::int FROM contract_receipts WHERE status='confirmed') AS receipts,
       (SELECT COUNT(*)::int FROM contract_payments WHERE status='confirmed') AS payments,
       (SELECT COUNT(*)::int FROM contract_external_payments
         WHERE status='confirmed') AS external_payments,
       (SELECT COUNT(*)::int FROM contract_invoice_line_items) AS invoice_lines,
       (SELECT COUNT(*)::int FROM contracts WHERE relation_type='main'
         AND lease_end_date IS NOT NULL AND is_deleted=FALSE) AS lease_roots,
       (SELECT COUNT(*)::int FROM contracts WHERE business_contract_no IS NOT NULL
         AND is_deleted=FALSE) AS business_numbers,
       (SELECT COUNT(*)::int FROM contracts contract
         JOIN contract_audit_logs audit ON audit.contract_id=contract.id
          AND audit.action='historical_contract_imported'
          AND audit.changes_json->>'batchKey'=$1
          AND audit.changes_json->>'sequence'='78'
         WHERE contract.contract_no <> '-' AND contract.business_contract_no='-'
           AND contract.is_deleted=FALSE) AS virtual_number_boundary,
       (SELECT COUNT(*)::int FROM contracts contract
         WHERE contract.sealed_at IS NOT NULL AND contract.is_deleted=FALSE
           AND NOT EXISTS(SELECT 1 FROM contract_files file
             WHERE file.contract_id=contract.id AND file.file_type='sealed_contract'
               AND file.is_current=TRUE)) AS sealed_conflicts,
       (SELECT COUNT(*)::int FROM contracts WHERE relation_type='main'
         AND is_deleted=FALSE AND (title ~ '[￥¥√]' OR title ~ '^20[0-9]{2}'))
         AS dirty_names`,
    [HISTORICAL_IMPORT_BATCH_KEY],
  );
  const actual = count.rows[0]!;
  const expected = {
    roots: 75,
    supplements: 27,
    terminations: 2,
    registrations: 59,
    items: 191,
    matches: 111,
    invoices: 109,
    receipts: 54,
    payments: 14,
    external_payments: 14,
    invoice_lines: 36,
    lease_roots: 5,
    business_numbers: 96,
    virtual_number_boundary: 1,
    sealed_conflicts: 0,
    dirty_names: 0,
  } as const;
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = Number(actual[key as keyof typeof expected]);
    if (actualValue !== expectedValue) {
      throw new Error(
        `历史修复结果${key}应为${expectedValue}，实际为${actualValue}`,
      );
    }
  }

  const houseSettlement = contractCostSettlementAmountSql({
    rootAlias: "root",
    rootIdExpression: "root.id",
  });
  const house = await client.query<{
    settled_amount: string | number;
    invoice_amount: string | number;
    external_amount: string | number;
  }>(
    `SELECT ${houseSettlement} AS settled_amount,
       (SELECT SUM(invoice.amount) FROM contract_invoices invoice
         WHERE invoice.contract_id=root.id AND invoice.status='confirmed')
         AS invoice_amount,
       (SELECT SUM(payment.amount) FROM contract_external_payments payment
         WHERE payment.contract_id=root.id AND payment.status='confirmed')
         AS external_amount
     FROM contracts root
     JOIN contract_audit_logs audit ON audit.contract_id=root.id
      AND audit.action='historical_contract_imported'
      AND audit.changes_json->>'batchKey'=$1
      AND audit.changes_json->>'sequence'='92'`,
    [HISTORICAL_IMPORT_BATCH_KEY],
  );
  if (
    toCents(house.rows[0]?.settled_amount || 0) !== toCents(377092) ||
    toCents(house.rows[0]?.invoice_amount || 0) !== toCents(381162.52) ||
    toCents(house.rows[0]?.external_amount || 0) !== toCents(459836.8)
  ) {
    throw new Error("国航房租履约、发票或对外付款金额边界不正确");
  }
}

export async function applyHistoricalRepair(
  client: PoolClient,
  input: {
    actorId: string | null;
    recalculateContractExecutionStatus: (typeof import("../services/contractService.js"))["recalculateContractExecutionStatus"];
    createdPaths: string[];
  },
): Promise<{ skipped: boolean; rootCount: number }> {
  await assertDevelopmentRuntime(client);
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    HISTORICAL_REPAIR_BATCH_KEY,
  ]);
  const plan = await inspectHistoricalRepair(client);
  if (plan.blockers.length) {
    throw new Error(`历史修复存在阻断：${plan.blockers.join("；")}`);
  }
  if (plan.alreadyApplied) return { skipped: true, rootCount: plan.rootCount };
  if (plan.registrationCount > 0) {
    throw new Error("检测到既有财务登记，拒绝覆盖；请先核对来源");
  }
  const rootsArray = await historicalRoots(client);
  const roots = new Map(rootsArray.map((root) => [root.sequence, root]));
  const actor = await resolveActor(client, input.actorId);
  const now = new Date().toISOString();
  await downgradeFeijiaDraft(client, roots, actor, now);
  await applyLeaseFields(client, roots, actor.id, now);
  await applyVirtualContractNumberBoundary(client, roots, actor.id, now);
  await applyFundingEvidence(client, roots, actor.id, now);
  await applyQrBusinessNumbers(client, actor.id, now);
  await cleanHistoricalContractNames(client, roots, actor.id, now);
  await expandAggregateRecords(client, roots, actor.id, now);
  await rebuildHouseRentalDetailedRecords(client, roots, actor.id, now);
  await convertExternalPayments(client, roots, actor.id, now);
  await applyRecoveredAssetFinancialFields(client, roots, now);
  await applyRecoveredMainFinancialFields(client, roots, now);
  await normalizeHistoricalFinancialParties(client, roots, now);
  await clearFalseSealedDates(client, actor.id, now);
  await rebuildRegistrations(client, roots, actor.id, now, input.createdPaths);
  const registeredRoots = await client.query<{ contract_id: string }>(
    `SELECT contract_id FROM contract_financial_registrations
      WHERE contract_id=ANY($1::text[])`,
    [[...roots.values()].map((root) => root.id)],
  );
  const registeredRootIds = new Set(
    registeredRoots.rows.map((row) => row.contract_id),
  );
  for (const root of roots.values()) {
    await input.recalculateContractExecutionStatus(
      client,
      root.id,
      actor.id,
      actor.role,
    );
  }
  await applyHistoricalLifecycleDates(client, roots, actor.id, now);
  for (const root of roots.values()) {
    await insertAudit(client, {
      contractId: root.id,
      actorId: actor.id,
      actorRole: actor.role,
      action: "historical_import_repair_applied",
      changes: {
        importBatchKey: HISTORICAL_IMPORT_BATCH_KEY,
        repairBatchKey: HISTORICAL_REPAIR_BATCH_KEY,
        sequence: root.sequence,
        leaseRepaired: HISTORICAL_LEASE_REPAIRS.some(
          (item) => item.sequence === root.sequence,
        ),
        fundingRepaired: HISTORICAL_ASSET_FUNDING_EVIDENCE.some(
          (item) => item.sequence === root.sequence,
        ),
        titleRepaired: HISTORICAL_TRUNCATED_TITLE_REPAIRS.some(
          (item) => item.sequence === root.sequence,
        ),
        assetProjectNameRecovered: HISTORICAL_ASSET_PROJECT_NAME_EVIDENCE.some(
          (item) => item.sequence === root.sequence,
        ),
        financialRegistrationRebuilt: registeredRootIds.has(root.id),
      },
      comment: "历史导入系统逻辑与边界修复",
      now,
    });
  }
  await assertHistoricalRepairResult(client);
  return { skipped: false, rootCount: roots.size };
}

export function parseRepairArguments(argv: readonly string[]): {
  mode: "dry-run" | "commit" | "verify-rollback";
  actorId: string | null;
} {
  const dryRun = argv.includes("--dry-run");
  const commit = argv.includes("--commit");
  const verifyRollback = argv.includes("--verify-rollback");
  if (Number(dryRun) + Number(commit) + Number(verifyRollback) !== 1) {
    throw new Error("必须且只能指定 --dry-run、--commit 或 --verify-rollback");
  }
  const actorIndex = argv.indexOf("--actor-id");
  const inline = argv.find((value) => value.startsWith("--actor-id="));
  return {
    mode: commit ? "commit" : verifyRollback ? "verify-rollback" : "dry-run",
    actorId:
      (actorIndex >= 0 ? argv[actorIndex + 1] : null) ||
      inline?.slice("--actor-id=".length) ||
      null,
  };
}

async function main(): Promise<void> {
  const args = parseRepairArguments(process.argv.slice(2));
  const [{ db, pool }, { recalculateContractExecutionStatus }] =
    await Promise.all([
      import("../db/index.js"),
      import("../services/contractService.js"),
    ]);
  const createdPaths: string[] = [];
  try {
    if (args.mode === "dry-run") {
      const plan = await db.transaction((client) =>
        inspectHistoricalRepair(client),
      );
      console.log(
        JSON.stringify(
          { 模式: "预演", 修复批次: HISTORICAL_REPAIR_BATCH_KEY, ...plan },
          null,
          2,
        ),
      );
      if (plan.blockers.length) process.exitCode = 2;
      return;
    }
    if (args.mode === "verify-rollback") {
      let verifiedResult: { skipped: boolean; rootCount: number } | null = null;
      try {
        await db.transaction(async (client) => {
          verifiedResult = await applyHistoricalRepair(client, {
            actorId: args.actorId,
            recalculateContractExecutionStatus,
            createdPaths,
          });
          throw new Error("__HISTORICAL_REPAIR_VERIFY_ROLLBACK__");
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "__HISTORICAL_REPAIR_VERIFY_ROLLBACK__"
        ) {
          throw error;
        }
      } finally {
        await Promise.all(
          createdPaths.map((filePath) =>
            fs.promises.rm(filePath, { force: true }).catch(() => undefined),
          ),
        );
      }
      const rollbackResult = verifiedResult as {
        skipped: boolean;
        rootCount: number;
      } | null;
      if (!rollbackResult) {
        throw new Error("历史修复回滚验证未返回执行结果");
      }
      console.log(
        JSON.stringify(
          {
            模式: "完整执行后强制回滚",
            修复批次: HISTORICAL_REPAIR_BATCH_KEY,
            ...rollbackResult,
          },
          null,
          2,
        ),
      );
      return;
    }
    try {
      const result = await db.transaction((client) =>
        applyHistoricalRepair(client, {
          actorId: args.actorId,
          recalculateContractExecutionStatus,
          createdPaths,
        }),
      );
      console.log(
        JSON.stringify(
          { 模式: "提交", 修复批次: HISTORICAL_REPAIR_BATCH_KEY, ...result },
          null,
          2,
        ),
      );
    } catch (error) {
      await Promise.all(
        createdPaths.map((filePath) =>
          fs.promises.rm(filePath, { force: true }).catch(() => undefined),
        ),
      );
      throw error;
    }
  } finally {
    await pool.end();
  }
}

const directEntry = /repair-confirmed-historical-contracts\.(?:ts|js)$/u.test(
  path.basename(process.argv[1] || ""),
);
if (directEntry) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
