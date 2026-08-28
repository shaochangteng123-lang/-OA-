import crypto from "crypto";
import fs from "fs";
import path from "path";

import { nanoid } from "nanoid";
import type { PoolClient } from "pg";

import { toCents } from "./contractAccounting.js";
import { allocateContractFinancialAmounts } from "./contractFinancialWorkflow.js";
import {
  confirmContractFinancialRegistrationInTransaction,
  isContractDomainError,
  postContractFinancialSettlements,
  rebuildContractFinancialRegistrationMatches,
} from "./contractService.js";
import {
  lockInvoiceApplicationRoot,
  lockInvoiceApplicationRootByFinancialSource,
} from "./invoiceApplication.js";
import { MONTHLY_BANK_ACCOUNTS } from "./monthlyFinancialBankStatement.js";

const MONTHLY_BANK_ROOT = path.resolve(
  process.cwd(),
  "uploads",
  "monthly-financial-bank",
);
const CONTRACT_UPLOAD_ROOT = path.resolve(
  process.cwd(),
  "uploads",
  "contracts",
);
const BRIDGE_PARSER_VERSION = "monthly-bank-contract-bridge-v1";
const BRIDGE_ENGINE_VERSION = "monthly-bank-statement";
const PROJECT_MATCH_VERSION = "project-anchor-v1";
const REGION_FILTER_VERSION = "beijing-region-fallback-v1";

interface MonthlyBankTransaction {
  id: string;
  report_month: string;
  account_code: string;
  transaction_date: string | null;
  amount: string | null;
  currency: string;
  direction: string | null;
  payer_name: string | null;
  payer_account: string | null;
  payee_name: string | null;
  payee_account: string | null;
  electronic_receipt_no: string | null;
  normalized_electronic_receipt_no: string | null;
  transaction_serial_no: string | null;
  proof_no: string | null;
  summary: string | null;
  remark: string | null;
  page_number: number;
  crop_path: string | null;
  category: string;
  recognition_status: string;
  warnings_json: string[];
  anomalies_json: string[];
  raw_ocr_json: Record<string, unknown>;
  current_file_id: string;
  source_file_hash: string;
  source_file_active: boolean;
}

interface CandidateInvoiceRow {
  registration_id: string;
  direction_invoice_record_id: string;
  contract_id: string;
  contract_status: string;
  root_status: string;
  contract_category: string | null;
  root_financial_direction: string | null;
  contract_party_a: string | null;
  contract_party_b: string | null;
  contract_project_name: string | null;
  root_project_name: string | null;
  contract_title: string | null;
  root_title: string | null;
  contract_business_contract_no: string | null;
  root_business_contract_no: string | null;
  contract_worklog_project_name: string | null;
  root_worklog_project_name: string | null;
  contract_area: string | null;
  root_area: string | null;
  invoice_item_id: string;
  invoice_record_id: string;
  invoice_amount: string;
  invoice_date: string;
  invoice_buyer: string | null;
  invoice_seller: string | null;
  invoice_status: string;
  invoice_job_status: string;
  invoice_validation_status: string | null;
  invoice_document_status: string | null;
  invoice_direction: string | null;
  invoice_can_auto_post: boolean;
}

interface GroupedCandidate {
  registrationId: string;
  directionInvoiceRecordId: string;
  contractId: string;
  category: string;
  partyA: string;
  partyB: string;
  projectNames: string[];
  businessContractNos: string[];
  regions: string[];
  invoices: CandidateInvoiceRow[];
}

export interface MonthlyContractBridgeResult {
  status: "created" | "pending" | "already_exists";
  changed: boolean;
  transactionId: string;
  contractId?: string;
  registrationId?: string;
  receiptRecordId?: string;
  registrationConfirmed?: boolean;
  warnings: string[];
  createdEvidencePaths?: string[];
}

export interface MonthlyContractBridgeGroupReceipt {
  transactionId: string;
  receiptRecordId: string;
}

export interface MonthlyContractBridgeGroupResult {
  status: "created" | "pending";
  changed: boolean;
  transactionIds: string[];
  contractId?: string;
  registrationId?: string;
  receipts: MonthlyContractBridgeGroupReceipt[];
  registrationConfirmed?: boolean;
  warnings: string[];
  createdEvidencePaths?: string[];
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toUpperCase();
}

function normalizeIdentity(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "");
}

const PROJECT_ANCHOR_NOISE = [
  "有限责任公司",
  "股份有限公司",
  "有限公司",
  "公司",
  "进度款",
  "预付款",
  "首付款",
  "首款",
  "尾款",
  "回款",
  "付款",
  "收款",
  "服务费",
  "合同款",
  "项目款",
  "款项",
  "合同",
  "补充协议",
  "协议",
  "项目",
  "人民币",
  "摘要",
  "备注",
  "千伏",
  "变电站",
  "输变电",
  "送出",
  "线路",
  "前期手续",
  "工程",
  "技术",
  "咨询",
  "服务",
] as const;

function normalizeProjectText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{Script=Han}A-Z0-9]/gu, "");
}

function normalizeProjectAnchorText(value: unknown): string {
  let normalized = String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{Script=Han}A-Z0-9]/gu, "");
  for (const noise of PROJECT_ANCHOR_NOISE) {
    normalized = normalized.split(noise).join("");
  }
  return normalized.replace(/[A-Z0-9]+/gu, "");
}

/**
 * 项目名称仅用于严格业务门禁之后的二次消歧。
 *
 * 合同业务编号完整且唯一出现时可信度最高；名称匹配必须在回单中命中
 * 至少三个汉字的候选集唯一专名锚点。“前期手续”“咨询服务”、电压等
 * 共同业务表述不会形成锚点，避免同金额项目间强行挂载。
 */
const PROJECT_STRUCTURE_TERMS = [
  "变电站",
  "输变电",
  "送出",
  "线路",
  "电缆",
  "隧道",
  "外电源",
  "红线外",
  "一期",
  "二期",
  "三期",
  "四期",
  "标段",
] as const;

interface ProjectAnchorMatch {
  projectName: string;
  anchor: string;
}

function extractProjectNumbers(value: string): string[] {
  const normalized = normalizeProjectText(value);
  const numbers: string[] = [];
  for (const match of normalized.matchAll(/\d+/gu)) {
    const number = match[0];
    const start = match.index || 0;
    const before = normalized[start - 1] || "";
    const after = normalized[start + number.length] || "";
    if (/[A-Z]/u.test(before) || /[A-Z]/u.test(after)) continue;
    if (/^(?:19|20)\d{2}$/u.test(number)) continue;
    if (number.length > 4) continue;
    numbers.push(number);
  }
  return [...new Set(numbers)];
}

function extractProjectPhases(value: string): string[] {
  return [
    ...new Set(
      normalizeProjectText(value).match(/[一二三四五六七八九十]+期/gu) || [],
    ),
  ];
}

function hasIndependentProjectEvidence(
  projectName: string,
  evidenceText: string,
): boolean {
  const projectText = normalizeProjectText(projectName);
  const evidence = normalizeProjectText(evidenceText);
  const projectNumbers = extractProjectNumbers(projectName);
  const evidenceNumbers = extractProjectNumbers(evidenceText);
  const commonNumbers = projectNumbers.filter((number) =>
    evidenceNumbers.includes(number),
  );
  if (
    evidenceNumbers.length > 0 &&
    evidenceNumbers.some((number) => !projectNumbers.includes(number))
  )
    return false;
  const projectPhases = extractProjectPhases(projectName);
  const evidencePhases = extractProjectPhases(evidenceText);
  const commonPhases = projectPhases.filter((phase) =>
    evidencePhases.includes(phase),
  );
  if (
    evidencePhases.length > 0 &&
    evidencePhases.some((phase) => !projectPhases.includes(phase))
  )
    return false;
  if (commonNumbers.length > 0 || commonPhases.length > 0) return true;
  return PROJECT_STRUCTURE_TERMS.some(
    (term) => projectText.includes(term) && evidence.includes(term),
  );
}

function matchUniqueProjectAnchor(
  candidate: GroupedCandidate,
  otherCandidates: GroupedCandidate[],
  evidenceText: string,
): ProjectAnchorMatch | null {
  const normalizedEvidence = normalizeProjectText(evidenceText);
  const otherProjectTexts = otherCandidates.flatMap((other) =>
    other.projectNames.map(normalizeProjectAnchorText),
  );
  for (const projectName of candidate.projectNames) {
    if (!hasIndependentProjectEvidence(projectName, evidenceText)) continue;
    const anchorSource = normalizeProjectAnchorText(projectName);
    const maxLength = Math.min(anchorSource.length, 10);
    for (let length = maxLength; length >= 3; length -= 1) {
      for (let start = 0; start + length <= anchorSource.length; start += 1) {
        const anchor = anchorSource.slice(start, start + length);
        if (!/^\p{Script=Han}{3,}$/u.test(anchor)) continue;
        if (!normalizedEvidence.includes(anchor)) continue;
        if (otherProjectTexts.some((text) => text.includes(anchor))) continue;
        return { projectName, anchor };
      }
    }
  }
  return null;
}

function evidenceMentionsCandidateProject(
  candidate: GroupedCandidate,
  evidenceText: string,
): boolean {
  const evidence = normalizeProjectText(evidenceText);
  return candidate.projectNames.some((projectName) => {
    const anchorSource = normalizeProjectAnchorText(projectName);
    for (
      let length = Math.min(anchorSource.length, 10);
      length >= 3;
      length -= 1
    ) {
      for (let start = 0; start + length <= anchorSource.length; start += 1) {
        const anchor = anchorSource.slice(start, start + length);
        if (/^\p{Script=Han}{3,}$/u.test(anchor) && evidence.includes(anchor)) {
          return true;
        }
      }
    }
    return false;
  });
}

interface CandidateSelection {
  candidate: GroupedCandidate;
  matchMethod:
    | "strict_unique"
    | "business_contract_no"
    | "project_name_anchor"
    | "administrative_region_fallback";
  matchedProjectName: string | null;
  matchedProjectAnchor: string | null;
  matchedRegion: string | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function evidenceHasBusinessContractNo(
  evidenceText: string,
  contractNo: string,
): boolean {
  const normalizedContractNo = normalizeIdentifier(contractNo);
  if (
    normalizedContractNo.length < 4 ||
    !/[A-Z]/u.test(normalizedContractNo) ||
    !/\d/u.test(normalizedContractNo)
  ) {
    return false;
  }
  if (normalizedContractNo.length >= 6) {
    return normalizeIdentifier(evidenceText).includes(normalizedContractNo);
  }
  const normalizedEvidence = String(evidenceText || "")
    .normalize("NFKC")
    .toUpperCase();
  return new RegExp(
    `(^|[^A-Z0-9])${escapeRegExp(normalizedContractNo)}([^A-Z0-9]|$)`,
    "u",
  ).test(normalizedEvidence);
}

const BEIJING_ADMINISTRATIVE_REGIONS = [
  "东城区",
  "西城区",
  "朝阳区",
  "海淀区",
  "丰台区",
  "石景山区",
  "门头沟区",
  "房山区",
  "通州区",
  "顺义区",
  "昌平区",
  "大兴区",
  "怀柔区",
  "平谷区",
  "密云区",
  "延庆区",
] as const;

type BeijingAdministrativeRegion =
  (typeof BEIJING_ADMINISTRATIVE_REGIONS)[number];

function normalizeAdministrativeRegion(
  value: unknown,
): BeijingAdministrativeRegion | null {
  const normalized = String(value || "")
    .normalize("NFKC")
    .trim();
  return (
    BEIJING_ADMINISTRATIVE_REGIONS.find((region) => normalized === region) ||
    null
  );
}

function extractTransactionRegions(
  transaction: MonthlyBankTransaction,
): BeijingAdministrativeRegion[] {
  const evidence = [transaction.summary, transaction.remark]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC");
  const matches = BEIJING_ADMINISTRATIVE_REGIONS.filter((region) => {
    const shortName = region.replace(/区$/u, "");
    const escaped = escapeRegExp(shortName);
    return (
      new RegExp(`${escaped}区`, "u").test(evidence) ||
      new RegExp(String.raw`行政区域\s*[:：]?\s*${escaped}(?:区)?`, "u").test(
        evidence,
      ) ||
      new RegExp(
        `${escaped}(?:(?:供电|电力)?公司).{0,4}(?:付|支付|转款)`,
        "u",
      ).test(evidence)
    );
  });
  return [...new Set(matches)];
}

function hasPotentialUnknownProjectReference(
  transaction: MonthlyBankTransaction,
  ignoredProjectNames: readonly string[] = [],
  ignoredContractNos: readonly string[] = [],
): boolean {
  let evidence = [transaction.summary, transaction.remark]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/(?:^|\s)[A-Z0-9]{2,8}\s*[_-]+/gu, " ");
  for (const region of BEIJING_ADMINISTRATIVE_REGIONS) {
    const shortName = region.replace(/区$/u, "");
    evidence = evidence.replace(
      new RegExp(
        `${escapeRegExp(shortName)}(?:区|供电公司|电力公司|公司)`,
        "gu",
      ),
      "",
    );
  }
  for (const party of [transaction.payer_name, transaction.payee_name]) {
    const normalizedParty = String(party || "")
      .normalize("NFKC")
      .toUpperCase();
    if (normalizedParty) evidence = evidence.split(normalizedParty).join("");
  }
  for (const noise of [
    "北京羽隶工程咨询有限公司",
    "羽隶",
    "国网北京市电力公司",
    "国网北京",
    "国网",
    "北京市",
    "北京",
    "千伏",
    "变电站",
    "输变电",
    "送出",
    "线路",
    "电缆",
    "隧道",
    "外电源",
    "红线外",
    "前期手续",
    "工程咨询服务",
    "技术咨询服务",
    "咨询服务",
    "技术服务",
    "进度款",
    "首付款",
    "预付款",
    "首款",
    "尾款",
    "一期",
    "二期",
    "三期",
    "四期",
    "标段",
    "合同款",
    "项目款",
    "服务费",
    "本期",
    "公司",
    "项目",
    "工程",
    "技术",
    "咨询",
    "服务",
    "付款",
    "回款",
    "收款",
    "款项",
    "金额",
    "万元",
    "元",
    "备注",
    "摘要",
    "付",
  ]) {
    evidence = evidence.split(noise).join("");
  }
  for (const projectName of ignoredProjectNames) {
    const anchor = normalizeProjectAnchorText(projectName);
    if (anchor) evidence = evidence.split(anchor).join("");
  }
  for (const contractNo of ignoredContractNos) {
    const normalizedContractNo = normalizeIdentifier(contractNo);
    if (normalizedContractNo) {
      evidence = evidence.split(normalizedContractNo).join("");
    }
  }
  let residue = evidence.replace(/[^\p{Script=Han}A-Z0-9]/gu, "");
  for (const contractNo of ignoredContractNos) {
    const normalizedContractNo = normalizeIdentifier(contractNo);
    if (normalizedContractNo) {
      residue = residue.split(normalizedContractNo).join("");
    }
  }
  const hanResidue = residue.replace(/[A-Z0-9]/gu, "");
  const codeResidue = residue.replace(/\p{Script=Han}/gu, "");
  return (
    /\p{Script=Han}{3,}/u.test(hanResidue) ||
    (/[A-Z]/u.test(codeResidue) && /\d/u.test(codeResidue))
  );
}

interface ExplicitCandidateResolution {
  status: "none" | "unique" | "conflict";
  selection: CandidateSelection | null;
}

function resolveExplicitCandidateEvidence(
  candidates: GroupedCandidate[],
  transaction: MonthlyBankTransaction,
): ExplicitCandidateResolution {
  const evidenceParts = [transaction.summary, transaction.remark]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (evidenceParts.length === 0) {
    return { status: "none", selection: null };
  }
  const combinedEvidence = evidenceParts.join(" ");
  const matches = new Map<string, CandidateSelection>();

  for (const evidenceText of [...evidenceParts, combinedEvidence]) {
    for (const candidate of candidates) {
      if (
        candidate.businessContractNos.some((contractNo) =>
          evidenceHasBusinessContractNo(evidenceText, contractNo),
        )
      ) {
        matches.set(candidate.registrationId, {
          candidate,
          matchMethod: "business_contract_no",
          matchedProjectName: null,
          matchedProjectAnchor: null,
          matchedRegion: null,
        });
      }
      const projectMatch = matchUniqueProjectAnchor(
        candidate,
        candidates.filter((other) => other !== candidate),
        evidenceText,
      );
      if (projectMatch) {
        matches.set(candidate.registrationId, {
          candidate,
          matchMethod: "project_name_anchor",
          matchedProjectName: projectMatch.projectName,
          matchedProjectAnchor: projectMatch.anchor,
          matchedRegion: null,
        });
      }
    }
  }
  if (matches.size === 0) {
    const mentionsProject = candidates.some((candidate) =>
      evidenceMentionsCandidateProject(candidate, combinedEvidence),
    );
    return {
      status:
        mentionsProject || hasPotentialUnknownProjectReference(transaction)
          ? "conflict"
          : "none",
      selection: null,
    };
  }
  if (matches.size > 1) return { status: "conflict", selection: null };
  const selection = [...matches.values()][0]!;
  if (
    hasPotentialUnknownProjectReference(
      transaction,
      selection.candidate.projectNames,
      selection.candidate.businessContractNos,
    )
  ) {
    return { status: "conflict", selection: null };
  }
  return { status: "unique", selection };
}

function selectCandidateByAdministrativeRegion(
  candidates: GroupedCandidate[],
  transaction: MonthlyBankTransaction,
): CandidateSelection | null {
  const transactionRegions = extractTransactionRegions(transaction);
  if (transactionRegions.length !== 1) return null;
  if (candidates.some((candidate) => candidate.regions.length !== 1)) {
    return null;
  }
  const matchedRegion = transactionRegions[0]!;
  const filtered = candidates.filter(
    (candidate) => candidate.regions[0] === matchedRegion,
  );
  if (filtered.length !== 1) return null;
  return {
    candidate: filtered[0]!,
    matchMethod: "administrative_region_fallback",
    matchedProjectName: null,
    matchedProjectAnchor: null,
    matchedRegion,
  };
}

function disambiguateCandidateByProjectEvidence(
  candidates: GroupedCandidate[],
  transaction: MonthlyBankTransaction,
  requireExplicitProjectEvidence = false,
): CandidateSelection | null {
  if (candidates.length < 1) return null;
  const explicit = resolveExplicitCandidateEvidence(candidates, transaction);
  if (explicit.status === "unique") return explicit.selection;
  if (explicit.status === "conflict") return null;
  if (candidates.length === 1 && !requireExplicitProjectEvidence) {
    return {
      candidate: candidates[0]!,
      matchMethod: "strict_unique",
      matchedProjectName: null,
      matchedProjectAnchor: null,
      matchedRegion: null,
    };
  }
  return selectCandidateByAdministrativeRegion(candidates, transaction);
}

function validSha256(value: unknown): value is string {
  return /^[0-9a-f]{64}$/u.test(String(value || ""));
}

function isValidDate(value: unknown): value is string {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === text
  );
}

function bridgeTransactionGateWarning(
  transaction: MonthlyBankTransaction,
): string | null {
  const normalizedReceiptNo = normalizeIdentifier(
    transaction.electronic_receipt_no,
  );
  const rawSourceHash = String(transaction.raw_ocr_json?.sourceFileHash || "");
  const rawTextHash = String(transaction.raw_ocr_json?.rawTextHash || "");
  const expectedPayeeAccount = MONTHLY_BANK_ACCOUNTS.general.accountNumber;
  const onlyExpectedPendingWarnings = (transaction.warnings_json || []).every(
    (warning) => warning.startsWith("MONTHLY_BANK_CONTRACT_MATCH_REQUIRED:"),
  );
  if (
    !transaction.source_file_active ||
    transaction.account_code !== "general" ||
    transaction.direction !== "inflow" ||
    !["main_income", "unclassified"].includes(transaction.category) ||
    !["review_required", "pending_review"].includes(
      transaction.recognition_status,
    ) ||
    transaction.currency !== "CNY" ||
    !isValidDate(transaction.transaction_date) ||
    !transaction.amount ||
    toCents(transaction.amount) <= 0 ||
    !normalizedReceiptNo ||
    normalizeIdentifier(transaction.normalized_electronic_receipt_no) !==
      normalizedReceiptNo ||
    !normalizeIdentity(transaction.payer_name) ||
    !normalizeIdentifier(transaction.payer_account) ||
    !normalizeIdentity(transaction.payee_name) ||
    normalizeIdentifier(transaction.payee_account) !== expectedPayeeAccount ||
    transaction.report_month !== transaction.transaction_date.slice(0, 7) ||
    !validSha256(transaction.source_file_hash) ||
    rawSourceHash !== transaction.source_file_hash ||
    !validSha256(rawTextHash) ||
    !transaction.crop_path ||
    (transaction.anomalies_json || []).length > 0 ||
    !onlyExpectedPendingWarnings
  ) {
    return "月报回单证据、一般账户归属或主营回款字段不完整，未自动补入合同";
  }
  return null;
}

function pending(
  transactionId: string,
  warning: string,
): MonthlyContractBridgeResult {
  return {
    status: "pending",
    changed: false,
    transactionId,
    warnings: [warning],
  };
}

function groupCandidates(rows: CandidateInvoiceRow[]): GroupedCandidate[] {
  const grouped = new Map<string, GroupedCandidate>();
  for (const row of rows) {
    if (
      !row.contract_category ||
      !row.contract_party_a ||
      !row.contract_party_b
    )
      continue;
    const candidate = grouped.get(row.registration_id) || {
      registrationId: row.registration_id,
      directionInvoiceRecordId: row.direction_invoice_record_id,
      contractId: row.contract_id,
      category: row.contract_category,
      partyA: row.contract_party_a,
      partyB: row.contract_party_b,
      projectNames: [],
      businessContractNos: [],
      regions: [],
      invoices: [],
    };
    const rootProjectName = String(row.root_project_name || "").trim();
    const contractProjectName = String(row.contract_project_name || "").trim();
    const primaryProjectName = rootProjectName || contractProjectName;
    const projectNames: string[] = primaryProjectName
      ? [primaryProjectName]
      : [];
    if (
      rootProjectName &&
      contractProjectName &&
      normalizeProjectText(rootProjectName).includes(
        normalizeProjectText(contractProjectName),
      )
    ) {
      projectNames.push(contractProjectName);
    }
    for (const linkedProjectName of [
      row.root_worklog_project_name,
      row.contract_worklog_project_name,
    ]) {
      const linked = String(linkedProjectName || "").trim();
      if (
        linked &&
        (!primaryProjectName ||
          (normalizeProjectText(linked).length >= 3 &&
            normalizeProjectText(primaryProjectName).includes(
              normalizeProjectText(linked),
            )))
      ) {
        projectNames.push(linked);
      }
    }
    for (const projectName of projectNames) {
      const value = String(projectName || "").trim();
      if (value && !candidate.projectNames.includes(value)) {
        candidate.projectNames.push(value);
      }
    }
    for (const contractNo of [
      row.root_business_contract_no,
      row.contract_business_contract_no,
    ]) {
      const value = String(contractNo || "").trim();
      if (value && !candidate.businessContractNos.includes(value)) {
        candidate.businessContractNos.push(value);
      }
    }
    for (const area of [row.root_area, row.contract_area]) {
      const region = normalizeAdministrativeRegion(area);
      if (region && !candidate.regions.includes(region)) {
        candidate.regions.push(region);
      }
    }
    candidate.invoices.push(row);
    grouped.set(row.registration_id, candidate);
  }
  return [...grouped.values()];
}

function candidateMatchesTransactionBase(
  candidate: GroupedCandidate,
  transaction: MonthlyBankTransaction,
): boolean {
  if (
    candidate.category !== "main_business" ||
    normalizeIdentity(candidate.partyA) !==
      normalizeIdentity(transaction.payer_name) ||
    normalizeIdentity(candidate.partyB) !==
      normalizeIdentity(transaction.payee_name)
  ) {
    return false;
  }
  if (
    candidate.invoices.some(
      (invoice) =>
        normalizeIdentity(invoice.invoice_buyer) !==
          normalizeIdentity(transaction.payer_name) ||
        normalizeIdentity(invoice.invoice_seller) !==
          normalizeIdentity(transaction.payee_name) ||
        !isValidDate(invoice.invoice_date) ||
        invoice.invoice_date > transaction.transaction_date! ||
        !["draft", "confirmed"].includes(invoice.invoice_status) ||
        invoice.invoice_job_status !== "consumed" ||
        invoice.invoice_validation_status !== "verified" ||
        invoice.invoice_document_status !== "normal" ||
        invoice.invoice_direction !== "output" ||
        invoice.invoice_can_auto_post !== true,
    )
  ) {
    return false;
  }
  return true;
}

function candidateInvoiceTotalCents(candidate: GroupedCandidate): number {
  return candidate.invoices.reduce(
    (sum, invoice) => sum + toCents(invoice.invoice_amount),
    0,
  );
}

function candidateMatchesTransaction(
  candidate: GroupedCandidate,
  transaction: MonthlyBankTransaction,
): boolean {
  return (
    candidateMatchesTransactionBase(candidate, transaction) &&
    candidateInvoiceTotalCents(candidate) === toCents(transaction.amount || "0")
  );
}

function contractBankBusinessHash(transaction: MonthlyBankTransaction): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        normalizeIdentifier(transaction.electronic_receipt_no),
        transaction.transaction_date,
        toCents(transaction.amount || "0"),
        normalizeIdentity(transaction.payer_name),
        normalizeIdentifier(transaction.payer_account),
        normalizeIdentity(transaction.payee_name),
        normalizeIdentifier(transaction.payee_account),
      ]),
    )
    .digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function copyMonthlyEvidenceToContract(input: {
  transaction: MonthlyBankTransaction;
  contractId: string;
  now: string;
}): Promise<{
  absolutePath: string;
  relativePath: string;
  fileHash: string;
  fileSize: number;
  fileName: string;
  created: boolean;
}> {
  const cropPath = input.transaction.crop_path;
  if (!cropPath) throw new Error("月报银行回单缺少可复制的单张预览证据");
  const sourcePath = path.resolve(process.cwd(), cropPath);
  if (
    sourcePath === MONTHLY_BANK_ROOT ||
    !sourcePath.startsWith(`${MONTHLY_BANK_ROOT}${path.sep}`)
  ) {
    throw new Error("月报银行回单预览路径不在安全目录中");
  }
  const sourceStat = await fs.promises.stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size <= 0) {
    throw new Error("月报银行回单预览文件不可用");
  }
  const header = Buffer.alloc(3);
  const handle = await fs.promises.open(sourcePath, "r");
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (
      bytesRead !== 3 ||
      header[0] !== 0xff ||
      header[1] !== 0xd8 ||
      header[2] !== 0xff
    ) {
      throw new Error("月报银行回单预览文件不是有效 JPEG 图片");
    }
  } finally {
    await handle.close();
  }
  const fileHash = await sha256File(sourcePath);
  const date = new Date(input.now);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const outputDir = path.join(CONTRACT_UPLOAD_ROOT, year, month, day);
  await fs.promises.mkdir(outputDir, { recursive: true });
  const safeReceiptNo = normalizeIdentifier(
    input.transaction.electronic_receipt_no,
  ).slice(0, 40);
  const fileName = `月报银行回单-${safeReceiptNo || input.transaction.id}.jpg`;
  const absolutePath = path.join(
    outputDir,
    `monthly-${input.transaction.id}-${fileHash.slice(0, 12)}.jpg`,
  );
  let created = false;
  try {
    await fs.promises.access(absolutePath, fs.constants.F_OK);
    if ((await sha256File(absolutePath)) !== fileHash) {
      throw new Error("合同回单目标文件已存在但摘要不一致");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.promises.copyFile(
      sourcePath,
      absolutePath,
      fs.constants.COPYFILE_EXCL,
    );
    created = true;
  }
  return {
    absolutePath,
    relativePath: path.relative(process.cwd(), absolutePath),
    fileHash,
    fileSize: sourceStat.size,
    fileName,
    created,
  };
}

async function loadTransaction(
  client: PoolClient,
  transactionId: string,
): Promise<MonthlyBankTransaction | null> {
  const result = await client.query<MonthlyBankTransaction>(
    `SELECT transaction.id, transaction.report_month,
            transaction.account_code, transaction.transaction_date,
            transaction.amount::text AS amount, transaction.currency,
            transaction.direction, transaction.payer_name,
            transaction.payer_account, transaction.payee_name,
            transaction.payee_account, transaction.electronic_receipt_no,
            transaction.normalized_electronic_receipt_no,
            transaction.transaction_serial_no, transaction.proof_no,
            transaction.summary, transaction.remark, transaction.page_number,
            transaction.crop_path, transaction.category,
            transaction.recognition_status, transaction.warnings_json,
            transaction.anomalies_json, transaction.raw_ocr_json,
            transaction.current_file_id, file.file_hash AS source_file_hash,
            file.is_active AS source_file_active
       FROM monthly_financial_bank_transactions transaction
       JOIN monthly_financial_bank_files file
         ON file.id = transaction.current_file_id
      WHERE transaction.id = $1 AND transaction.is_current = TRUE
      FOR UPDATE OF transaction, file`,
    [transactionId],
  );
  return result.rows[0] || null;
}

async function loadCandidateInvoiceRows(
  client: PoolClient,
  registrationId?: string,
  lockRows = false,
): Promise<CandidateInvoiceRow[]> {
  const result = await client.query<CandidateInvoiceRow>(
    `SELECT registration.id AS registration_id,
            registration.direction_invoice_record_id,
            registration.contract_id,
            contract.status AS contract_status,
            root.status AS root_status,
            COALESCE(root.declared_category, root.category,
                     contract.declared_category, contract.category)
              AS contract_category,
            COALESCE(root.financial_direction, contract.financial_direction)
              AS root_financial_direction,
            COALESCE(root.party_a, contract.party_a) AS contract_party_a,
            COALESCE(root.party_b, contract.party_b) AS contract_party_b,
            contract.project_name AS contract_project_name,
            root.project_name AS root_project_name,
            contract.title AS contract_title,
            root.title AS root_title,
            contract.business_contract_no AS contract_business_contract_no,
            root.business_contract_no AS root_business_contract_no,
            contract_project.name AS contract_worklog_project_name,
            root_project.name AS root_worklog_project_name,
            contract.area AS contract_area,
            root.area AS root_area,
            item.id AS invoice_item_id,
            invoice.id AS invoice_record_id,
            invoice.amount::text AS invoice_amount,
            invoice.invoice_date,
            invoice.buyer AS invoice_buyer,
            invoice.seller AS invoice_seller,
            invoice.status AS invoice_status,
            job.status AS invoice_job_status,
            job.validation_status AS invoice_validation_status,
            job.document_status AS invoice_document_status,
            job.direction AS invoice_direction,
            job.can_auto_post AS invoice_can_auto_post
       FROM contract_financial_registrations registration
       JOIN contracts contract
         ON contract.id = registration.contract_id
        AND contract.is_deleted = FALSE
       JOIN contracts root
         ON root.id = COALESCE(contract.root_contract_id, contract.id)
        AND root.is_deleted = FALSE
       LEFT JOIN worklog_projects contract_project
         ON contract_project.id = contract.project_id
       LEFT JOIN worklog_projects root_project
         ON root_project.id = root.project_id
       JOIN contract_financial_registration_items item
         ON item.registration_id = registration.id
        AND item.item_kind = 'invoice'
       JOIN contract_invoices invoice
         ON invoice.id = item.record_id
       JOIN contract_financial_ocr_jobs job
         ON job.id = item.ocr_job_id
      WHERE registration.status = 'draft'
        AND registration.settlement_kind = 'receipt'
        AND registration.financial_direction = 'income'
        AND registration.direction_invoice_record_id IS NOT NULL
        AND (
          contract.status IN ('effective', 'executing')
          OR (
            contract.status = 'completed'
            AND EXISTS (
              SELECT 1 FROM contract_financial_registrations open_registration
              WHERE open_registration.contract_id = contract.id
                AND open_registration.status = 'draft'
                AND open_registration.settlement_kind = 'receipt'
                AND open_registration.financial_direction = 'income'
            )
          )
        )
        AND root.status IN ('effective', 'executing')
        AND COALESCE(root.declared_category, root.category,
                     contract.declared_category, contract.category)
              = 'main_business'
        AND COALESCE(root.financial_direction, contract.financial_direction)
              = 'income'
        AND NOT EXISTS (
          SELECT 1 FROM contract_financial_registration_items settlement
          WHERE settlement.registration_id = registration.id
            AND settlement.item_kind IN ('receipt', 'payment', 'external_payment')
        )
        AND NOT EXISTS (
          SELECT 1 FROM contracts termination
          WHERE termination.root_contract_id = root.id
            AND termination.relation_type = 'termination'
            AND termination.is_deleted = FALSE
            AND termination.status IN ('approving', 'pending_seal')
        )
        AND ($1::text IS NULL OR registration.id = $1)
      ORDER BY registration.created_at, registration.id,
               item.created_at, item.id
      ${lockRows ? "FOR UPDATE OF registration, contract, root, item, invoice, job" : ""}`,
    [registrationId || null],
  );
  return result.rows;
}

/**
 * 跨月回款不能以“已经上传发票”为候选前提，因此这里直接从生效中的主营
 * 主合同建立候选。财务登记和发票只决定后续闭环状态，不参与银行事实归属。
 */
async function loadMainBusinessContractCandidates(
  client: PoolClient,
): Promise<GroupedCandidate[]> {
  const result = await client.query<{
    contract_id: string;
    contract_category: string | null;
    party_a: string | null;
    party_b: string | null;
    project_name: string | null;
    business_contract_no: string | null;
    worklog_project_name: string | null;
    area: string | null;
  }>(
    `SELECT contract.id AS contract_id,
            COALESCE(contract.declared_category, contract.category)
              AS contract_category,
            contract.party_a, contract.party_b, contract.project_name,
            contract.business_contract_no,
            project.name AS worklog_project_name, contract.area
       FROM contracts contract
       LEFT JOIN worklog_projects project ON project.id = contract.project_id
      WHERE contract.is_deleted = FALSE
        AND contract.relation_type = 'main'
        AND contract.status IN ('effective', 'executing')
        AND COALESCE(contract.declared_category, contract.category)
              = 'main_business'
        AND (contract.financial_direction IS NULL
             OR contract.financial_direction = 'income')
        AND contract.party_a IS NOT NULL
        AND contract.party_b IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM contracts termination
          WHERE termination.root_contract_id = contract.id
            AND termination.relation_type = 'termination'
            AND termination.is_deleted = FALSE
            AND termination.status IN ('approving', 'pending_seal')
        )
      ORDER BY contract.created_at, contract.id`,
  );
  return result.rows.map((row) => {
    const projectNames = [row.project_name, row.worklog_project_name]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);
    const businessContractNos = [row.business_contract_no]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const region = normalizeAdministrativeRegion(row.area);
    return {
      registrationId: `contract:${row.contract_id}`,
      directionInvoiceRecordId: "",
      contractId: row.contract_id,
      category: row.contract_category || "",
      partyA: row.party_a || "",
      partyB: row.party_b || "",
      projectNames,
      businessContractNos,
      regions: region ? [region] : [],
      invoices: [],
    };
  });
}

function contractCandidateMatchesTransaction(
  candidate: GroupedCandidate,
  transaction: MonthlyBankTransaction,
): boolean {
  return (
    candidate.category === "main_business" &&
    normalizeIdentity(candidate.partyA) ===
      normalizeIdentity(transaction.payer_name) &&
    normalizeIdentity(candidate.partyB) ===
      normalizeIdentity(transaction.payee_name)
  );
}

async function hasDuplicateBankEvidence(
  client: PoolClient,
  normalizedReceiptNo: string,
  businessHash: string,
  fileHash: string,
): Promise<boolean> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('contract-bank-receipt-no:' || $1, 0)
     )`,
    [normalizedReceiptNo],
  );
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('contract-bank-business:' || $1, 0)
     )`,
    [businessHash],
  );
  const duplicate = await client.query<{ duplicated: boolean }>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM (
           SELECT electronic_receipt_no FROM contract_receipts
           WHERE status <> 'reversed'
           UNION ALL
           SELECT electronic_receipt_no FROM contract_payments
           WHERE status <> 'reversed'
           UNION ALL
           SELECT electronic_receipt_no FROM contract_external_payments
           WHERE status <> 'reversed'
         ) record
         WHERE UPPER(REGEXP_REPLACE(
           NORMALIZE(BTRIM(record.electronic_receipt_no), NFKC),
           '[^[:alnum:]]+', '', 'g'
         )) = $1
       ) OR EXISTS (
         SELECT 1 FROM contract_financial_ocr_jobs job
         WHERE job.record_kind IN ('receipt', 'payment')
           AND job.status IN ('verified', 'consumed', 'blocked')
           AND UPPER(REGEXP_REPLACE(
             NORMALIZE(BTRIM(
               job.snapshot_json #>> '{fields,electronicReceiptNo}'
             ), NFKC), '[^[:alnum:]]+', '', 'g'
           )) = $1
       ) OR EXISTS (
         SELECT 1 FROM contract_financial_registration_items item
         WHERE item.business_key_hash = $2
       ) OR EXISTS (
         SELECT 1 FROM contract_financial_file_hashes registry
         WHERE registry.file_hash = $3
       )
     ) AS duplicated`,
    [normalizedReceiptNo, businessHash, fileHash],
  );
  return duplicate.rows[0]?.duplicated === true;
}

interface SelectedGroupTransaction {
  transaction: MonthlyBankTransaction;
  selection: CandidateSelection;
}

function pendingGroup(
  transactionIds: string[],
  warning: string,
): MonthlyContractBridgeGroupResult {
  return {
    status: "pending",
    changed: false,
    transactionIds,
    receipts: [],
    warnings: [warning],
  };
}

async function bridgeSelectedTransactionGroup(
  client: PoolClient,
  selectedTransactions: SelectedGroupTransaction[],
  actorId: string,
  actorRole: string,
  now: string,
): Promise<MonthlyContractBridgeGroupResult> {
  const transactionIds = selectedTransactions.map(
    ({ transaction }) => transaction.id,
  );
  let candidate = selectedTransactions[0]!.selection.candidate;
  await lockInvoiceApplicationRootByFinancialSource(
    client,
    "registration",
    candidate.registrationId,
  );
  const refreshedAll = groupCandidates(await loadCandidateInvoiceRows(client));
  const refreshedSelections: SelectedGroupTransaction[] = [];
  for (const selected of selectedTransactions) {
    const eligible = refreshedAll.filter((entry) =>
      candidateMatchesTransactionBase(entry, selected.transaction),
    );
    const selection = disambiguateCandidateByProjectEvidence(
      eligible,
      selected.transaction,
      true,
    );
    if (
      !selection ||
      selection.candidate.registrationId !== candidate.registrationId ||
      selection.candidate.contractId !== candidate.contractId
    ) {
      return pendingGroup(
        transactionIds,
        "合同财务草稿或项目候选在组同步期间发生变化，未自动补入多张回单",
      );
    }
    refreshedSelections.push({
      transaction: selected.transaction,
      selection,
    });
  }
  const lockedCandidates = groupCandidates(
    await loadCandidateInvoiceRows(client, candidate.registrationId, true),
  );
  if (
    lockedCandidates.length !== 1 ||
    lockedCandidates[0]!.registrationId !== candidate.registrationId ||
    lockedCandidates[0]!.contractId !== candidate.contractId ||
    refreshedSelections.some(
      ({ transaction }) =>
        !candidateMatchesTransactionBase(lockedCandidates[0]!, transaction),
    )
  ) {
    return pendingGroup(
      transactionIds,
      "合同财务草稿在组同步期间发生变化，未自动补入多张回单",
    );
  }
  candidate = lockedCandidates[0]!;
  const targetCents = candidateInvoiceTotalCents(candidate);
  const groupCents = refreshedSelections.reduce(
    (sum, { transaction }) => sum + toCents(transaction.amount || "0"),
    0,
  );
  if (groupCents !== targetCents) {
    return pendingGroup(
      transactionIds,
      groupCents < targetCents
        ? "同一项目的多张回单合计仍不足发票待回款金额，未自动补入"
        : "同一项目的多张回单合计超过发票待回款金额，未自动补入",
    );
  }

  const copiedEvidence: Array<
    Awaited<ReturnType<typeof copyMonthlyEvidenceToContract>>
  > = [];
  try {
    for (const { transaction } of refreshedSelections) {
      copiedEvidence.push(
        await copyMonthlyEvidenceToContract({
          transaction,
          contractId: candidate.contractId,
          now,
        }),
      );
    }
    const businessHashes = refreshedSelections.map(({ transaction }) =>
      contractBankBusinessHash(transaction),
    );
    const receiptNos = refreshedSelections.map(({ transaction }) =>
      normalizeIdentifier(transaction.electronic_receipt_no),
    );
    const cropHashes = copiedEvidence.map(({ fileHash }) => fileHash);
    if (
      new Set(receiptNos).size !== receiptNos.length ||
      new Set(businessHashes).size !== businessHashes.length ||
      new Set(cropHashes).size !== cropHashes.length
    ) {
      for (const evidence of copiedEvidence) {
        if (evidence.created) {
          await fs.promises
            .rm(evidence.absolutePath, { force: true })
            .catch(() => undefined);
        }
      }
      return pendingGroup(
        transactionIds,
        "多张回单组内存在重复回单号、业务身份或文件摘要，整组未自动补入",
      );
    }
    const verificationIndexes = refreshedSelections
      .map((_, index) => index)
      .sort((left, right) => {
        return [
          receiptNos[left],
          businessHashes[left],
          copiedEvidence[left]!.fileHash,
        ]
          .join(":")
          .localeCompare(
            [
              receiptNos[right],
              businessHashes[right],
              copiedEvidence[right]!.fileHash,
            ].join(":"),
          );
      });
    for (const index of verificationIndexes) {
      const transaction = refreshedSelections[index]!.transaction;
      const duplicated = await hasDuplicateBankEvidence(
        client,
        normalizeIdentifier(transaction.electronic_receipt_no),
        businessHashes[index]!,
        copiedEvidence[index]!.fileHash,
      );
      if (duplicated) {
        for (const evidence of copiedEvidence) {
          if (evidence.created) {
            await fs.promises
              .rm(evidence.absolutePath, { force: true })
              .catch(() => undefined);
          }
        }
        return pendingGroup(
          transactionIds,
          "多张回单中存在已登记的电子回单或文件摘要，整组未自动补入",
        );
      }
    }

    const written: Array<{
      transaction: MonthlyBankTransaction;
      selection: CandidateSelection;
      receiptRecordId: string;
      settlementItemId: string;
      ocrJobId: string;
      businessHash: string;
      evidence: Awaited<ReturnType<typeof copyMonthlyEvidenceToContract>>;
    }> = [];
    for (let index = 0; index < refreshedSelections.length; index += 1) {
      const selected = refreshedSelections[index]!;
      const transaction = selected.transaction;
      const evidence = copiedEvidence[index]!;
      const fileId = nanoid();
      const ocrJobId = nanoid();
      const receiptRecordId = nanoid();
      const settlementItemId = nanoid();
      await client.query(
        `INSERT INTO contract_files(
           id, contract_id, file_type, file_name, file_path, file_size,
           mime_type, file_hash, version, is_current, uploaded_by, created_at
         ) VALUES($1,$2,'receipt',$3,$4,$5,'image/jpeg',$6,1,TRUE,$7,$8)`,
        [
          fileId,
          candidate.contractId,
          evidence.fileName,
          evidence.relativePath,
          evidence.fileSize,
          evidence.fileHash,
          actorId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO contract_financial_file_hashes(
           file_hash, file_id, contract_id, created_at
         ) VALUES($1,$2,$3,$4)`,
        [evidence.fileHash, fileId, candidate.contractId, now],
      );
      const rawTextHash = String(transaction.raw_ocr_json?.rawTextHash || "");
      const snapshot = {
        format: "image",
        fields: {
          payer: transaction.payer_name,
          payerAccount: transaction.payer_account,
          payee: transaction.payee_name,
          payeeAccount: transaction.payee_account,
          electronicReceiptNo: transaction.electronic_receipt_no,
          transactionSerialNo: transaction.transaction_serial_no,
          paymentTime: transaction.transaction_date,
          amount: Number(transaction.amount),
          currency: transaction.currency,
        },
        source: {
          kind: "monthly_financial_bank_transaction",
          transactionId: transaction.id,
          bankFileId: transaction.current_file_id,
          bankFileHash: transaction.source_file_hash,
          pageNumber: transaction.page_number,
          cropFileHash: evidence.fileHash,
        },
      };
      await client.query(
        `INSERT INTO contract_financial_ocr_jobs(
           id, contract_id, file_id, file_hash, record_kind, document_kind,
           status, validation_status, recognition_method, engine_version,
           parser_version, evidence_text_hash, direction, document_status,
           can_auto_post, snapshot_json, blocking_reasons_json, warnings_json,
           requested_by, record_id, started_at, finished_at, consumed_at,
           created_at, updated_at
         ) VALUES(
           $1,$2,$3,$4,'receipt','bank_receipt','consumed','verified',
           'monthly_bank_transaction',$5,$6,$7,'receipt','normal',TRUE,
           $8::jsonb,'[]'::jsonb,'[]'::jsonb,$9,$10,$11,$11,$11,$11,$11
         )`,
        [
          ocrJobId,
          candidate.contractId,
          fileId,
          evidence.fileHash,
          BRIDGE_ENGINE_VERSION,
          BRIDGE_PARSER_VERSION,
          rawTextHash,
          JSON.stringify(snapshot),
          actorId,
          receiptRecordId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO contract_receipts(
           id, contract_id, file_id, receipt_date, payment_time, amount,
           payer, payer_account, payee, payee_account, currency,
           electronic_receipt_no, transaction_serial_no, proof_no, note,
           financial_ocr_job_id, status, created_by, created_at, updated_at
         ) VALUES(
           $1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
           'draft',$16,$17,$17
         )`,
        [
          receiptRecordId,
          candidate.contractId,
          fileId,
          transaction.transaction_date,
          transaction.amount,
          transaction.payer_name,
          transaction.payer_account,
          transaction.payee_name,
          transaction.payee_account,
          transaction.currency,
          transaction.electronic_receipt_no,
          transaction.transaction_serial_no,
          transaction.proof_no || transaction.electronic_receipt_no,
          transaction.remark || transaction.summary || "月报银行回单自动补全",
          ocrJobId,
          actorId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO contract_financial_registration_items(
           id, registration_id, contract_id, item_kind, ocr_job_id,
           record_id, business_key_hash, created_at
         ) VALUES($1,$2,$3,'receipt',$4,$5,$6,$7)`,
        [
          settlementItemId,
          candidate.registrationId,
          candidate.contractId,
          ocrJobId,
          receiptRecordId,
          businessHashes[index],
          now,
        ],
      );
      written.push({
        transaction,
        selection: selected.selection,
        receiptRecordId,
        settlementItemId,
        ocrJobId,
        businessHash: businessHashes[index]!,
        evidence,
      });
    }

    const allocations = allocateContractFinancialAmounts(
      candidate.invoices.map((invoice) => Number(invoice.invoice_amount)),
      written.map(({ transaction }) => Number(transaction.amount)),
    );
    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO contract_financial_registration_matches(
           id, registration_id, contract_id, invoice_item_id,
           settlement_item_id, allocated_amount, created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          nanoid(),
          candidate.registrationId,
          candidate.contractId,
          candidate.invoices[allocation.invoiceIndex]!.invoice_item_id,
          written[allocation.settlementIndex]!.settlementItemId,
          allocation.allocatedAmount,
          now,
        ],
      );
    }

    const primary = written[0]!;
    const updated = await client.query<{ id: string }>(
      `UPDATE contract_financial_registrations
          SET bank_ocr_job_id = $2, receipt_record_id = $3,
              bank_business_key_hash = $4, updated_at = $5
        WHERE id = $1 AND contract_id = $6 AND status = 'draft'
          AND settlement_kind = 'receipt' AND financial_direction = 'income'
          AND bank_ocr_job_id IS NULL AND receipt_record_id IS NULL
          AND payment_record_id IS NULL AND bank_business_key_hash IS NULL
        RETURNING id`,
      [
        candidate.registrationId,
        primary.ocrJobId,
        primary.receiptRecordId,
        primary.businessHash,
        now,
        candidate.contractId,
      ],
    );
    if (!updated.rows[0]) {
      throw new Error("合同财务草稿状态已变化，未自动补入多张回单");
    }
    for (const receipt of written) {
      await client.query(
        `INSERT INTO contract_audit_logs(
           id, contract_id, action, actor_id, actor_role, from_status,
           to_status, changes_json, created_at
         ) VALUES($1,$2,'monthly_bank_receipt_attached',$3,$4,$5,$5,$6::jsonb,$7)`,
        [
          nanoid(),
          candidate.contractId,
          actorId,
          actorRole,
          candidate.invoices[0]!.contract_status,
          JSON.stringify({
            registrationId: candidate.registrationId,
            receiptRecordId: receipt.receiptRecordId,
            transactionId: receipt.transaction.id,
            transactionIds,
            groupReceiptCount: written.length,
            bankFileId: receipt.transaction.current_file_id,
            bankFileHash: receipt.transaction.source_file_hash,
            cropFileHash: receipt.evidence.fileHash,
            electronicReceiptNo: receipt.transaction.electronic_receipt_no,
            amount: Number(receipt.transaction.amount),
            source: "monthly_bank_transaction_group",
            matchMethod: receipt.selection.matchMethod,
            projectMatchVersion: PROJECT_MATCH_VERSION,
            matchedProjectName: receipt.selection.matchedProjectName,
            matchedProjectAnchor: receipt.selection.matchedProjectAnchor,
            regionFilterVersion: REGION_FILTER_VERSION,
            matchedRegion: receipt.selection.matchedRegion,
          }),
          now,
        ],
      );
    }
    const receiptRecordIds = written.map(
      ({ receiptRecordId }) => receiptRecordId,
    );
    await postContractFinancialSettlements(client, {
      contractId: candidate.contractId,
      registrationId: candidate.registrationId,
      settlementKind: "receipt",
      settlementRecordIds: receiptRecordIds,
      financialDirection: "income",
      directionInvoiceRecordId: candidate.directionInvoiceRecordId,
      actorId,
      actorRole,
      now,
    });
    await confirmContractFinancialRegistrationInTransaction(
      client,
      candidate.registrationId,
      actorId,
      actorRole,
      candidate.contractId,
    );
    return {
      status: "created",
      changed: true,
      transactionIds,
      contractId: candidate.contractId,
      registrationId: candidate.registrationId,
      receipts: written.map(({ transaction, receiptRecordId }) => ({
        transactionId: transaction.id,
        receiptRecordId,
      })),
      registrationConfirmed: true,
      warnings: [],
      createdEvidencePaths: copiedEvidence
        .filter((evidence) => evidence.created)
        .map((evidence) => evidence.absolutePath),
    };
  } catch (error) {
    for (const evidence of copiedEvidence) {
      if (evidence.created) {
        await fs.promises
          .rm(evidence.absolutePath, { force: true })
          .catch(() => undefined);
      }
    }
    throw error;
  }
}

export async function cleanupMonthlyContractBridgeGroupFiles(result: {
  createdEvidencePaths?: string[];
}): Promise<void> {
  for (const filePath of result.createdEvidencePaths || []) {
    const absolutePath = path.resolve(filePath);
    if (
      absolutePath !== CONTRACT_UPLOAD_ROOT &&
      absolutePath.startsWith(`${CONTRACT_UPLOAD_ROOT}${path.sep}`)
    ) {
      await fs.promises
        .rm(absolutePath, { force: true })
        .catch(() => undefined);
    }
  }
}

/**
 * 在同一月报事务内，将同一主营项目的多张银行回单按唯一组合补入合同。
 * 单张闭合不在此处处理，继续交由既有单张桥接保持兼容。
 */
export async function bridgeMonthlyBankTransactionGroupsToContractRegistrations(
  client: PoolClient,
  transactionIds: readonly string[],
  actorId: string,
  actorRole: string,
  now: string,
): Promise<MonthlyContractBridgeGroupResult[]> {
  const uniqueTransactionIds = [...new Set(transactionIds.filter(Boolean))];
  if (uniqueTransactionIds.length < 2) return [];
  const transactions: MonthlyBankTransaction[] = [];
  for (const transactionId of uniqueTransactionIds) {
    const transaction = await loadTransaction(client, transactionId);
    if (transaction && !bridgeTransactionGateWarning(transaction)) {
      transactions.push(transaction);
    }
  }
  if (transactions.length < 2) return [];
  if (
    new Set(transactions.map(({ report_month }) => report_month)).size !== 1
  ) {
    return [
      pendingGroup(
        transactions.map(({ id }) => id),
        "多张回单不属于同一报表月份，未自动合并补入合同",
      ),
    ];
  }
  transactions.sort((left, right) =>
    `${left.transaction_date || ""}:${left.id}`.localeCompare(
      `${right.transaction_date || ""}:${right.id}`,
    ),
  );
  const allCandidates = groupCandidates(await loadCandidateInvoiceRows(client));
  const grouped = new Map<string, SelectedGroupTransaction[]>();
  for (const transaction of transactions) {
    const candidates = allCandidates.filter((candidate) =>
      candidateMatchesTransactionBase(candidate, transaction),
    );
    const selection = disambiguateCandidateByProjectEvidence(
      candidates,
      transaction,
      true,
    );
    if (!selection) continue;
    const current = grouped.get(selection.candidate.registrationId) || [];
    current.push({ transaction, selection });
    grouped.set(selection.candidate.registrationId, current);
  }

  const results: MonthlyContractBridgeGroupResult[] = [];
  try {
    for (const selected of grouped.values()) {
      if (selected.length < 2) continue;
      const targetCents = candidateInvoiceTotalCents(
        selected[0]!.selection.candidate,
      );
      const totalCents = selected.reduce(
        (sum, { transaction }) => sum + toCents(transaction.amount || "0"),
        0,
      );
      if (totalCents !== targetCents) {
        results.push(
          pendingGroup(
            selected.map(({ transaction }) => transaction.id),
            totalCents < targetCents
              ? "同一项目的回单合计不足发票待回款金额，等待后续回单"
              : "同一项目的回单合计超过发票待回款金额且无法唯一闭合",
          ),
        );
        continue;
      }
      results.push(
        await bridgeSelectedTransactionGroup(
          client,
          selected,
          actorId,
          actorRole,
          now,
        ),
      );
    }
    return results;
  } catch (error) {
    for (const result of results) {
      if (result.status === "created") {
        await cleanupMonthlyContractBridgeGroupFiles(result);
      }
    }
    throw error;
  }
}

/**
 * 将月报银行回单挂载到唯一主营合同，并持续补入同一笔开放财务登记。
 *
 * 合同归属只使用双方、项目名称／业务编号及安全行政区兜底，不再把发票
 * 或金额相等作为银行事实落账前提。回款会立即确认并按银行日期进入月报；
 * 发票与回款未完全覆盖时登记保持草稿，后续月份继续向原登记补入。
 */
export async function bridgeMonthlyBankTransactionToContractRegistration(
  client: PoolClient,
  transactionId: string,
  actorId: string,
  actorRole: string,
  now: string,
): Promise<MonthlyContractBridgeResult> {
  const transaction = await loadTransaction(client, transactionId);
  if (!transaction) return pending(transactionId, "月报银行回单已失效或被替换");
  const normalizedReceiptNo = normalizeIdentifier(
    transaction.electronic_receipt_no,
  );
  const rawTextHash = String(transaction.raw_ocr_json?.rawTextHash || "");
  const gateWarning = bridgeTransactionGateWarning(transaction);
  if (gateWarning) return pending(transactionId, gateWarning);

  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('monthly-contract-bridge:' || $1, 0)
     )`,
    [normalizedReceiptNo],
  );
  const candidates = (await loadMainBusinessContractCandidates(client)).filter(
    (candidate) => contractCandidateMatchesTransaction(candidate, transaction),
  );
  let selection = disambiguateCandidateByProjectEvidence(
    candidates,
    transaction,
  );
  if (!selection) {
    return pending(
      transactionId,
      candidates.length > 1
        ? "月报回单命中多笔主营合同，回单摘要与项目名称或业务编号未形成唯一强匹配，未自动挂载"
        : "月报回单未能根据合同双方、项目名称或业务编号唯一确定主营合同",
    );
  }
  let candidate = selection.candidate;
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('monthly-contract-registration:' || $1, 0)
     )`,
    [candidate.contractId],
  );
  await lockInvoiceApplicationRoot(client, candidate.contractId);
  const lockedContract = await client.query<{
    id: string;
    status: string;
  }>(
    `SELECT id, status FROM contracts
      WHERE id = $1 AND is_deleted = FALSE
      FOR UPDATE`,
    [candidate.contractId],
  );
  if (!lockedContract.rows[0]) {
    return pending(transactionId, "主营合同已失效，未自动挂载回单");
  }
  const refreshedCandidates = (
    await loadMainBusinessContractCandidates(client)
  ).filter((entry) => contractCandidateMatchesTransaction(entry, transaction));
  const refreshedSelection = disambiguateCandidateByProjectEvidence(
    refreshedCandidates,
    transaction,
  );
  if (
    !refreshedSelection ||
    refreshedSelection.candidate.contractId !== candidate.contractId
  ) {
    return pending(
      transactionId,
      "主营合同候选在同步期间发生变化，未自动挂载回单",
    );
  }
  selection = refreshedSelection;
  candidate = refreshedSelection.candidate;
  const openRegistrations = await client.query<{
    id: string;
    settlement_kind: string;
    financial_direction: string | null;
    direction_invoice_record_id: string | null;
  }>(
    `SELECT id, settlement_kind, financial_direction,
            direction_invoice_record_id
       FROM contract_financial_registrations
      WHERE contract_id = $1 AND status = 'draft'
      ORDER BY created_at, id
      FOR UPDATE`,
    [candidate.contractId],
  );
  if (openRegistrations.rows.length > 1) {
    return pending(
      transactionId,
      "该合同存在多笔未闭环财务登记，无法安全确定本次回款归属",
    );
  }
  const openRegistration = openRegistrations.rows[0] || null;
  if (
    openRegistration &&
    (openRegistration.settlement_kind !== "receipt" ||
      (openRegistration.financial_direction !== null &&
        openRegistration.financial_direction !== "income"))
  ) {
    return pending(
      transactionId,
      "该合同已有其他方向的未闭环财务登记，本次主营回款未自动挂载",
    );
  }
  let evidence: Awaited<ReturnType<typeof copyMonthlyEvidenceToContract>>;
  try {
    evidence = await copyMonthlyEvidenceToContract({
      transaction,
      contractId: candidate.contractId,
      now,
    });
  } catch (error) {
    return pending(
      transactionId,
      error instanceof Error ? error.message : "月报回单证据复制失败",
    );
  }
  const businessHash = contractBankBusinessHash(transaction);
  try {
    if (
      await hasDuplicateBankEvidence(
        client,
        normalizedReceiptNo,
        businessHash,
        evidence.fileHash,
      )
    ) {
      if (evidence.created) {
        await fs.promises
          .rm(evidence.absolutePath, { force: true })
          .catch(() => undefined);
      }
      return {
        status: "already_exists",
        changed: false,
        transactionId,
        warnings: ["该电子回单已存在合同财务记录，未重复补入"],
      };
    }

    const registrationId = openRegistration?.id || nanoid();
    if (!openRegistration) {
      await client.query(
        `INSERT INTO contract_financial_registrations(
           id, contract_id, settlement_kind, financial_direction,
           direction_invoice_record_id, invoice_ocr_job_id,
           bank_ocr_job_id, invoice_record_id, receipt_record_id,
           payment_record_id, bank_business_key_hash, status, created_by,
           created_at, updated_at
         ) VALUES(
           $1,$2,'receipt','income',NULL,NULL,NULL,NULL,NULL,NULL,NULL,
           'draft',$3,$4,$4
         )`,
        [registrationId, candidate.contractId, actorId, now],
      );
    }
    const fileId = nanoid();
    const ocrJobId = nanoid();
    const receiptRecordId = nanoid();
    const settlementItemId = nanoid();
    await client.query(
      `INSERT INTO contract_files(
         id, contract_id, file_type, file_name, file_path, file_size,
         mime_type, file_hash, version, is_current, uploaded_by, created_at
       ) VALUES($1,$2,'receipt',$3,$4,$5,'image/jpeg',$6,1,TRUE,$7,$8)`,
      [
        fileId,
        candidate.contractId,
        evidence.fileName,
        evidence.relativePath,
        evidence.fileSize,
        evidence.fileHash,
        actorId,
        now,
      ],
    );
    await client.query(
      `INSERT INTO contract_financial_file_hashes(
         file_hash, file_id, contract_id, created_at
       ) VALUES($1,$2,$3,$4)`,
      [evidence.fileHash, fileId, candidate.contractId, now],
    );
    const snapshot = {
      format: "image",
      fields: {
        payer: transaction.payer_name,
        payerAccount: transaction.payer_account,
        payee: transaction.payee_name,
        payeeAccount: transaction.payee_account,
        electronicReceiptNo: transaction.electronic_receipt_no,
        transactionSerialNo: transaction.transaction_serial_no,
        paymentTime: transaction.transaction_date,
        amount: Number(transaction.amount),
        currency: transaction.currency,
      },
      source: {
        kind: "monthly_financial_bank_transaction",
        transactionId: transaction.id,
        bankFileId: transaction.current_file_id,
        bankFileHash: transaction.source_file_hash,
        pageNumber: transaction.page_number,
        cropFileHash: evidence.fileHash,
      },
    };
    await client.query(
      `INSERT INTO contract_financial_ocr_jobs(
         id, contract_id, file_id, file_hash, record_kind, document_kind,
         status, validation_status, recognition_method, engine_version,
         parser_version, evidence_text_hash, direction, document_status,
         can_auto_post, snapshot_json, blocking_reasons_json, warnings_json,
         requested_by, record_id, started_at, finished_at, consumed_at,
         created_at, updated_at
       ) VALUES(
         $1,$2,$3,$4,'receipt','bank_receipt','consumed','verified',
         'monthly_bank_transaction',$5,$6,$7,'receipt','normal',TRUE,
         $8::jsonb,'[]'::jsonb,'[]'::jsonb,$9,$10,$11,$11,$11,$11,$11
       )`,
      [
        ocrJobId,
        candidate.contractId,
        fileId,
        evidence.fileHash,
        BRIDGE_ENGINE_VERSION,
        BRIDGE_PARSER_VERSION,
        rawTextHash,
        JSON.stringify(snapshot),
        actorId,
        receiptRecordId,
        now,
      ],
    );
    await client.query(
      `INSERT INTO contract_receipts(
         id, contract_id, file_id, receipt_date, payment_time, amount,
         payer, payer_account, payee, payee_account, currency,
         electronic_receipt_no, transaction_serial_no, proof_no, note,
         financial_ocr_job_id, status, created_by, created_at, updated_at
       ) VALUES(
         $1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
         'draft',$16,$17,$17
       )`,
      [
        receiptRecordId,
        candidate.contractId,
        fileId,
        transaction.transaction_date,
        transaction.amount,
        transaction.payer_name,
        transaction.payer_account,
        transaction.payee_name,
        transaction.payee_account,
        transaction.currency,
        transaction.electronic_receipt_no,
        transaction.transaction_serial_no,
        transaction.proof_no || transaction.electronic_receipt_no,
        transaction.remark || transaction.summary || "月报银行回单自动补全",
        ocrJobId,
        actorId,
        now,
      ],
    );
    await client.query(
      `INSERT INTO contract_financial_registration_items(
         id, registration_id, contract_id, item_kind, ocr_job_id,
         record_id, business_key_hash, created_at
       ) VALUES($1,$2,$3,'receipt',$4,$5,$6,$7)`,
      [
        settlementItemId,
        registrationId,
        candidate.contractId,
        ocrJobId,
        receiptRecordId,
        businessHash,
        now,
      ],
    );
    const rebuilt = await rebuildContractFinancialRegistrationMatches(client, {
      registrationId,
      contractId: candidate.contractId,
      settlementKind: "receipt",
      now,
    });
    const updated = await client.query<{ id: string }>(
      `UPDATE contract_financial_registrations
          SET financial_direction = 'income',
              direction_invoice_record_id = COALESCE(
                direction_invoice_record_id, $2
              ),
              bank_ocr_job_id = COALESCE(bank_ocr_job_id, $3),
              receipt_record_id = COALESCE(receipt_record_id, $4),
              bank_business_key_hash = COALESCE(bank_business_key_hash, $5),
              updated_at = $6
        WHERE id = $1 AND contract_id = $7 AND status = 'draft'
          AND settlement_kind = 'receipt' AND financial_direction = 'income'
        RETURNING id`,
      [
        registrationId,
        rebuilt.directionInvoiceRecordId,
        ocrJobId,
        receiptRecordId,
        businessHash,
        now,
        candidate.contractId,
      ],
    );
    if (!updated.rows[0]) {
      throw new Error("合同财务草稿状态已变化，未自动补入回单");
    }
    await client.query(
      `INSERT INTO contract_audit_logs(
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) VALUES($1,$2,'monthly_bank_receipt_attached',$3,$4,$5,$5,$6::jsonb,$7)`,
      [
        nanoid(),
        candidate.contractId,
        actorId,
        actorRole,
        lockedContract.rows[0]!.status,
        JSON.stringify({
          registrationId,
          receiptRecordId,
          transactionId: transaction.id,
          bankFileId: transaction.current_file_id,
          bankFileHash: transaction.source_file_hash,
          cropFileHash: evidence.fileHash,
          electronicReceiptNo: transaction.electronic_receipt_no,
          amount: Number(transaction.amount),
          source: "monthly_bank_transaction",
          matchMethod: selection.matchMethod,
          projectMatchVersion: PROJECT_MATCH_VERSION,
          matchedProjectName: selection.matchedProjectName,
          matchedProjectAnchor: selection.matchedProjectAnchor,
          regionFilterVersion: REGION_FILTER_VERSION,
          matchedRegion: selection.matchedRegion,
          currentInvoiceAmount: rebuilt.invoiceTotalCents / 100,
          cumulativeReceiptAmount: rebuilt.settlementTotalCents / 100,
          allocatedAmount: rebuilt.allocatedTotalCents / 100,
          pendingInvoiceAmount:
            Math.max(
              0,
              rebuilt.settlementTotalCents - rebuilt.invoiceTotalCents,
            ) / 100,
          pendingReceiptAmount:
            Math.max(
              0,
              rebuilt.invoiceTotalCents - rebuilt.settlementTotalCents,
            ) / 100,
        }),
        now,
      ],
    );
    await postContractFinancialSettlements(client, {
      contractId: candidate.contractId,
      registrationId,
      settlementKind: "receipt",
      settlementRecordIds: [receiptRecordId],
      financialDirection: "income",
      directionInvoiceRecordId: rebuilt.directionInvoiceRecordId,
      allowUnallocatedSettlement: true,
      actorId,
      actorRole,
      now,
    });
    const registrationCanClose =
      rebuilt.invoiceTotalCents > 0 &&
      rebuilt.invoiceTotalCents === rebuilt.settlementTotalCents &&
      rebuilt.allocatedTotalCents === rebuilt.invoiceTotalCents;
    let registrationConfirmed = false;
    let closeWarning: string | null = null;
    if (registrationCanClose) {
      try {
        await confirmContractFinancialRegistrationInTransaction(
          client,
          registrationId,
          actorId,
          actorRole,
          candidate.contractId,
        );
        registrationConfirmed = true;
      } catch (error) {
        if (!isContractDomainError(error)) throw error;
        closeWarning = `实际回款已确认，但发票验证链尚未满足整组关闭条件：${error.message}`;
      }
    }
    return {
      status: "created",
      changed: true,
      transactionId,
      contractId: candidate.contractId,
      registrationId,
      receiptRecordId,
      registrationConfirmed,
      warnings: closeWarning ? [closeWarning] : [],
      createdEvidencePaths: evidence.created ? [evidence.absolutePath] : [],
    };
  } catch (error) {
    if (evidence.created) {
      await fs.promises
        .rm(evidence.absolutePath, { force: true })
        .catch(() => undefined);
    }
    throw error;
  }
}

export const monthlyFinancialContractBridgeInternals = {
  normalizeIdentifier,
  normalizeIdentity,
  candidateMatchesTransaction,
  contractBankBusinessHash,
};
