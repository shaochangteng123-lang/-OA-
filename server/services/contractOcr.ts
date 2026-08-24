import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import JSZip, { type JSZipObject } from "jszip";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type {
  PaddleOcrModelVersion,
  PaddleOcrRequestModel,
} from "./ocrDaemon.js";
import { extractContractSealCopyCount } from "./contractSealCopyCount.js";

/**
 * 合同字段结构解析版本。解析规则或安全候选结构发生变化时必须升级，
 * 使历史草稿可以自动复跑，避免继续沿用旧规则的部分结果。
 */
export const CONTRACT_OCR_PARSER_VERSION = "contract-structure-v17";

const execFileAsync = promisify(execFile);

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 40;
const MAX_DOCX_ENTRIES = 1_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_RELATIONSHIPS_BYTES = 2 * 1024 * 1024;
const MAX_HIGH_RESOLUTION_PAGES = 4;
const MAX_SOURCE_IMAGE_PIXELS = 40_000_000;
const MAX_PDF_RENDER_PIXELS = 40_000_000;
const MAX_PDF_RENDER_EDGE_PIXELS = 8_000;
// PaddleOCR（飞桨文字识别）单张输入保持在已验证可运行的 A4 300 DPI（每英寸点数）量级以内；高清页通过
// 带重叠裁片保留原始清晰度，避免整页检测张量造成数 GiB 的瞬时峰值。
// PaddleOCR（飞桨文字识别）即使处理 500 万像素裁片，连续扫描页仍可能产生过高
// 瞬时内存并被宿主 OOM（内存耗尽）直接终止。将所有单裁片压到 200 万像素以内，
// A4 300 DPI（每英寸点数）会稳定拆成六片，
// 同时仍保留完整行宽，避免甲乙方、项目名称和金额锚点被横向切断。
const MAX_OCR_TILE_PIXELS = 2_000_000;
const MAX_OCR_TILE_EDGE_PIXELS = 4_000;
const OCR_TILE_OVERLAP_PIXELS = 256;
// 最坏情况下页面宽 4000、高 8000 像素，按 200 万像素和 256 像素重叠
// 纵向切分需要 32 片；保持整行宽度，不以横切换取更少裁片。
const MAX_OCR_TILE_ROWS = 32;
// 合同扫描件统一使用 PaddleOCR（飞桨文字识别）。整数 100 仅保留为历史兼容
// 的“无需追加高分辨率诊断”标记；最终自动采用由风险复核和业务硬校验决定。
export const CONTRACT_OCR_AUTO_ACCEPTANCE_THRESHOLD = 100;
let legacyDocConversionChain: Promise<void> = Promise.resolve();
let contractPdfRenderChain: Promise<void> = Promise.resolve();

/**
 * 合同 PDF（便携式文档格式）渲染进程内单许可信号量。
 * 只串行化高内存的 pdftoppm（PDF 页面渲染命令）；渲染完成后立即释放，
 * PaddleOCR（飞桨文字识别）继续使用已有串行队列。
 */
export function runWithContractPdfRenderPermit<T>(
  task: () => Promise<T>,
): Promise<T> {
  const current = contractPdfRenderChain.then(task, task);
  contractPdfRenderChain = current.then(
    () => undefined,
    () => undefined,
  );
  return current;
}

export type ContractOcrFieldName =
  | "party_a"
  | "party_b"
  | "project_name"
  | "amount"
  | "category"
  | "contract_date";

export type ContractOcrSource =
  | "plain_text"
  | "docx_text"
  | "pdf_text"
  | "ocr_300"
  | "ocr_480"
  | "ocr_600"
  | "mixed"
  | "rule";

export interface ContractOcrEvidence {
  text: string;
  source: ContractOcrSource;
  pageNumber?: number;
  /** 兼容字段，值与 fieldScore（字段规则评分）保持一致。 */
  confidence: number;
  /** 原始 OCR（光学字符识别）置信度；非 OCR 来源为 null。 */
  ocrConfidence: number | null;
  /** 由锚点、候选一致性和独立证据计算的字段规则评分。 */
  fieldScore: number;
  recognitionEngine?: string;
}

export interface ContractOcrCandidate {
  originalValue: string;
  normalizedValue: string;
  /** 兼容字段，值与 fieldScore（字段规则评分）保持一致。 */
  confidence: number;
  /** 原始 OCR（光学字符识别）置信度；非 OCR 来源为 null。 */
  ocrConfidence: number | null;
  /** 候选规则评分。 */
  fieldScore: number;
  source: ContractOcrSource;
  pageNumber?: number;
  evidence?: string;
  recognitionEngine?: string;
}

export interface ContractOcrField {
  field: ContractOcrFieldName;
  originalValue: string;
  normalizedValue: string;
  /** 兼容字段，数据库和现有接口继续将其视为字段规则评分。 */
  confidence: number;
  /** 最终候选直接 OCR（光学字符识别）证据的最低原始置信度。 */
  ocrConfidence: number | null;
  /** 字段规则评分；用于风险判断，不再作为自动采用的唯一条件。 */
  fieldScore: number;
  source: ContractOcrSource;
  pageNumber?: number;
  evidence?: ContractOcrEvidence[];
  candidates?: ContractOcrCandidate[];
  warnings?: string[];
}

export interface ContractRecognitionResult {
  status: "succeeded" | "partial" | "failed";
  failureKind?: "infrastructure" | "document" | "recognition";
  fields: ContractOcrField[];
  rawText: string;
  method:
    | "plain_text"
    | "docx_text"
    | "pdf_text"
    | "pdf_ocr"
    | "pdf_text_and_ocr"
    | "image_ocr"
    | "none";
  warnings: string[];
  ocrLines: ContractRawOcrLine[];
  modelVersion?: PaddleOcrModelVersion;
  /** 同一任务自动补扫后仍未形成可用文字来源的 PDF（便携式文档格式）页码。 */
  unrecognizedPageNumbers?: number[];
}

/**
 * 合同金额的内部业务拆分结果。该对象通过服务层专用读取函数取得，不挂到
 * HTTP（超文本传输协议）响应对象上，因此不会改变现有 API（应用程序编程接口）结构。
 */
export interface ContractAmountBreakdown {
  originalAmount: number | null;
  changeAmount: number | null;
  finalAmount: number | null;
}

/**
 * 合同金额的内部可用状态。该状态只说明金额事实来自明确条款、业务计算、
 * 付款事实或完全缺失，不改变现有 amount（金额字段）及 amount_delta（本次增减额）语义。
 */
export type ContractAmountStatus =
  | "confirmed_amount"
  | "calculated_amount"
  | "payment_only"
  | "missing_amount";

/**
 * 合同金额自动采用所需的内部状态。missingAmountEligible（金额缺失可采用）
 * 只在正文没有未决强金额事实或金额冲突时为真；该对象不进入现有识别结果、
 * HTTP（超文本传输协议）响应或数据库。
 */
export interface ContractAmountAutomaticAdoptionContext {
  status: ContractAmountStatus;
  missingAmountEligible: boolean;
}

/** 项目名称第一、第二候选之间允许自动采用的最小实际排序分差。 */
export const CONTRACT_PROJECT_AUTOMATIC_ADOPTION_MINIMUM_SCORE_GAP = 10;

export type ContractOcrProjectCandidateOrigin =
  | "cover_title"
  | "labeled_field"
  | "body_description";

export type ContractOcrAmountCandidateRole =
  | "contract_total"
  | "contract_amount"
  | "generic_total"
  | "payment_amount"
  | "tax_amount"
  | "service_fee"
  | "unit_price"
  | "original_amount"
  | "final_amount"
  | "relation_adjustment";

export interface ContractLeaseTerms {
  isRentalLease: boolean;
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  monthlyRent: number | null;
  monthlyPropertyManagementFee: number | null;
  termMonths: number | null;
  totalAmount: number | null;
  amountSource:
    | "contract_total"
    | "monthly_rent_calculated"
    | "monthly_rent_property_fee_calculated"
    | null;
}

export type ContractOcrAmountCandidateScope =
  | "current_contract"
  | "relation_total"
  | "component"
  | "unscoped";

export interface ContractOcrProjectAutomaticAdoptionSafety {
  selectedValue: string | null;
  candidateExists: boolean;
  trustedSource: boolean;
  source: ContractOcrSource | null;
  pageNumber: number | null;
  origin: ContractOcrProjectCandidateOrigin | null;
  strongEvidence: boolean;
  distinctCandidateCount: number;
  leadingScore: number | null;
  runnerUpScore: number | null;
  scoreGap: number | null;
  uniqueOrSufficientGap: boolean;
  genericContractType: boolean;
  organizationName: boolean;
  paymentClause: boolean;
  pdfTextEvidencePresent: boolean;
  samePageVisibleOcrEvidence: boolean;
  riskCodes: string[];
}

export interface ContractOcrAmountAutomaticAdoptionSafety {
  selectedValue: string | null;
  candidateExists: boolean;
  role: ContractOcrAmountCandidateRole | null;
  scope: ContractOcrAmountCandidateScope;
  strongEvidence: boolean;
  explicitContractTotal: boolean;
  amountEventConflict: boolean;
  unresolvedContractAmountFact: boolean;
  pdfTextEvidencePresent: boolean;
  samePageVisibleOcrEvidence: boolean;
  calculatedRelationVisibleClosure: boolean;
  riskCodes: string[];
}

/**
 * 第十一阶段B自动采用安全上下文。只在当前进程内随识别结果对象传递，
 * 不挂到 OCR（光学字符识别）输出、HTTP（超文本传输协议）响应或数据库。
 */
export interface ContractOcrAutomaticAdoptionSafetyContext {
  project: ContractOcrProjectAutomaticAdoptionSafety;
  amount: ContractOcrAmountAutomaticAdoptionSafety;
}

export type ContractOcrCandidateGenerator =
  | "party"
  | "project"
  | "amount"
  | "lease_amount"
  | "relation_adjustment_amount"
  | "current_agreement_total"
  | "aggregated_adjustment"
  | "category"
  | "contract_date"
  | "verification";

export type ContractOcrCandidateFilterStage =
  | "framework_project"
  | "direct_party_label"
  | "mirrored_party"
  | "effective_amount"
  | "historical_contract_date"
  | "ranking_suppression";

/**
 * 第十一阶段A离线诊断候选。该结构只保存在进程内 WeakMap（弱映射）中，
 * 不挂到识别结果、HTTP（超文本传输协议）响应或数据库记录上。
 */
export interface ContractOcrCandidateFunnelCandidate {
  candidateId: string;
  generator: ContractOcrCandidateGenerator;
  field: ContractOcrFieldName;
  originalValue: string;
  normalizedValue: string;
  confidence: number;
  ocrConfidence: number | null;
  fieldScore: number;
  source: ContractOcrSource;
  pageNumber?: number;
  evidence: string;
  recognitionEngine: string;
  strongEvidence: boolean;
  confidenceCap: number;
  kind?: "arabic_amount" | "chinese_amount" | "category";
  amountRole?: string;
  verificationRole?: string;
  projectOrigin?: string;
  projectServiceRole?: string;
  precedence: number;
  explicitContractTotal: boolean;
}

export interface ContractOcrCandidateFilterDecision {
  candidateId: string;
  retained: boolean;
  rejectedAt?: ContractOcrCandidateFilterStage;
}

export interface ContractOcrCandidateRankTrace {
  rank: number;
  normalizedValue: string;
  /** 实际用于该字段排序的分数。 */
  score: number;
  /** 候选合并后的字段规则分，和实际排序附加权重分开记录。 */
  fieldScore: number;
  /** 分数之外触发确定性换位或安全融合的诊断原因。 */
  orderingReasonCodes: string[];
  selected: boolean;
  candidateIds: string[];
}

export interface ContractOcrFieldRankingTrace {
  field: ContractOcrFieldName;
  candidates: ContractOcrCandidateRankTrace[];
}

export interface ContractOcrCandidateFunnelTrace {
  schemaVersion: 1;
  effectiveRelationType: ParseContractTextOptions["relationType"] | null;
  generatedCandidates: ContractOcrCandidateFunnelCandidate[];
  filteringDecisions: ContractOcrCandidateFilterDecision[];
  ranking: ContractOcrFieldRankingTrace[];
}

const contractAmountBreakdowns = new WeakMap<
  ContractRecognitionResult,
  ContractAmountBreakdown
>();
const contractAmountAutomaticAdoptionContexts = new WeakMap<
  ContractRecognitionResult,
  ContractAmountAutomaticAdoptionContext
>();
const contractOcrAutomaticAdoptionSafetyContexts = new WeakMap<
  ContractRecognitionResult,
  ContractOcrAutomaticAdoptionSafetyContext
>();
const contractOcrCandidateFunnelTraces = new WeakMap<
  ContractRecognitionResult,
  ContractOcrCandidateFunnelTrace
>();
const contractOcrCandidateFunnelIsolationProofs = new WeakMap<
  ContractRecognitionResult,
  true
>();

/** 读取合同解析结果对应的内部金额业务拆分，不参与序列化或数据库持久化。 */
export function getContractAmountBreakdown(
  result: ContractRecognitionResult,
): ContractAmountBreakdown | null {
  return contractAmountBreakdowns.get(result) || null;
}

/** 读取内部金额状态；该状态不参与 HTTP（超文本传输协议）响应或数据库持久化。 */
export function getContractAmountStatus(
  result: ContractRecognitionResult,
): ContractAmountStatus | null {
  return contractAmountAutomaticAdoptionContexts.get(result)?.status || null;
}

/**
 * 读取金额自动采用上下文。返回副本，防止调用方修改 WeakMap（弱映射）内
 * 的冻结判断；该上下文只在当前进程内随识别结果对象传递。
 */
export function getContractAmountAutomaticAdoptionContext(
  result: ContractRecognitionResult,
): ContractAmountAutomaticAdoptionContext | null {
  const context = contractAmountAutomaticAdoptionContexts.get(result);
  return context ? { ...context } : null;
}

/**
 * 读取自动采用候选安全上下文的防御性副本。该证据始终由生产解析流程生成，
 * 与仅离线开启的完整候选漏斗相互独立。
 */
export function getContractOcrAutomaticAdoptionSafetyContext(
  result: ContractRecognitionResult,
): ContractOcrAutomaticAdoptionSafetyContext | null {
  const context = contractOcrAutomaticAdoptionSafetyContexts.get(result);
  if (!context) return null;
  return {
    project: {
      ...context.project,
      riskCodes: [...context.project.riskCodes],
    },
    amount: {
      ...context.amount,
      riskCodes: [...context.amount.riskCodes],
    },
  };
}

/**
 * 读取第十一阶段A候选漏斗的防御性副本。未显式启用离线诊断时返回 null；
 * 调用方修改返回对象不会影响识别结果或后续业务判断。
 */
export function getContractOcrCandidateFunnelTrace(
  result: ContractRecognitionResult,
): ContractOcrCandidateFunnelTrace | null {
  const trace = contractOcrCandidateFunnelTraces.get(result);
  if (!trace) return null;
  return {
    ...trace,
    generatedCandidates: trace.generatedCandidates.map((candidate) => ({
      ...candidate,
    })),
    filteringDecisions: trace.filteringDecisions.map((decision) => ({
      ...decision,
    })),
    ranking: trace.ranking.map((field) => ({
      field: field.field,
      candidates: field.candidates.map((candidate) => ({
        ...candidate,
        orderingReasonCodes: [...candidate.orderingReasonCodes],
        candidateIds: [...candidate.candidateIds],
      })),
    })),
  };
}

/**
 * 文件识别入口开启候选漏斗诊断时，会对同一批文字来源分别执行关闭和开启
 * 诊断的纯解析，并比较完整业务投影。只有逐字节等价时才返回 true。
 */
export function getContractOcrCandidateFunnelIsolationProof(
  result: ContractRecognitionResult,
): boolean {
  return contractOcrCandidateFunnelIsolationProofs.get(result) === true;
}

function inheritContractAmountBreakdown(
  source: ContractRecognitionResult,
  target: ContractRecognitionResult,
): ContractRecognitionResult {
  const breakdown = contractAmountBreakdowns.get(source);
  if (breakdown) contractAmountBreakdowns.set(target, breakdown);
  const amountContext = contractAmountAutomaticAdoptionContexts.get(source);
  if (amountContext) {
    contractAmountAutomaticAdoptionContexts.set(target, amountContext);
  }
  const safetyContext = contractOcrAutomaticAdoptionSafetyContexts.get(source);
  if (safetyContext) {
    contractOcrAutomaticAdoptionSafetyContexts.set(target, safetyContext);
  }
  const candidateFunnel = contractOcrCandidateFunnelTraces.get(source);
  if (candidateFunnel) {
    contractOcrCandidateFunnelTraces.set(target, candidateFunnel);
  }
  if (contractOcrCandidateFunnelIsolationProofs.get(source)) {
    contractOcrCandidateFunnelIsolationProofs.set(target, true);
  }
  return target;
}

export interface ContractRawOcrLine {
  page: number;
  text: string;
  bbox: number[][];
  confidence: number;
  modelVersion: PaddleOcrModelVersion;
}

export interface ContractBusinessNumberEvidence {
  value: string;
  pageNumbers: number[];
  source: "qr" | "label";
}

function normalizeContractBusinessNumberCandidate(
  value: string,
): string | null {
  const normalized = value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .toUpperCase();
  if (
    normalized.length < 6 ||
    normalized.length > 64 ||
    /^HT-\d{8}-\d+$/i.test(normalized) ||
    !/^[A-Z0-9/_().-]+$/.test(normalized) ||
    !/[A-Z]/.test(normalized) ||
    !/\d/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

/**
 * 从明确的“合同编号：”字段中提取原件合同编号。
 *
 * 页眉上可能同时存在合同模板编号，只有标签冒号后的内容才是业务合同
 * 编号。“合同编号（甲方）／（乙方）”等空白签约字段也不参与候选。
 */
export function extractContractBusinessNumber(
  lines: readonly ContractRawOcrLine[],
): ContractBusinessNumberEvidence | null {
  const candidates = new Map<
    string,
    { pages: Set<number>; occurrences: number; source: "qr" | "label" }
  >();
  const labelledNumberPattern =
    /合同\s*编号\s*[:：]\s*([A-Z0-9][A-Z0-9/_().-]{5,63})/gi;
  const qrNumberPattern =
    /二维码合同编号\s*[:：]\s*([A-Z0-9][A-Z0-9/_().-]{5,63})/gi;

  for (const rawLine of lines) {
    const page = Number(rawLine.page) || 1;
    const text = String(rawLine.text || "").normalize("NFKC");
    for (const pattern of [qrNumberPattern, labelledNumberPattern]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (
          pattern === labelledNumberPattern &&
          /[原主]\s*$/.test(
            text.slice(Math.max(0, (match.index || 0) - 3), match.index || 0),
          )
        ) {
          continue;
        }
        const value = normalizeContractBusinessNumberCandidate(match[1]);
        if (!value) continue;
        const source = pattern === qrNumberPattern ? "qr" : "label";
        const evidence = candidates.get(value) || {
          pages: new Set<number>(),
          occurrences: 0,
          source,
        };
        evidence.pages.add(page);
        evidence.occurrences += 1;
        if (source === "qr") evidence.source = "qr";
        candidates.set(value, evidence);
      }
    }
  }

  const ranked = [...candidates.entries()].sort((left, right) => {
    const [, a] = left;
    const [, b] = right;
    return (
      Number(b.source === "qr") - Number(a.source === "qr") ||
      b.pages.size - a.pages.size ||
      b.occurrences - a.occurrences ||
      left[0].localeCompare(right[0])
    );
  });
  const winner = ranked[0];
  if (!winner) return null;
  const runnerUp = ranked[1];
  if (
    runnerUp &&
    runnerUp[1].source === winner[1].source &&
    runnerUp[1].pages.size === winner[1].pages.size &&
    runnerUp[1].occurrences === winner[1].occurrences
  ) {
    return null;
  }
  return {
    value: winner[0],
    pageNumbers: [...winner[1].pages].sort((a, b) => a - b),
    source: winner[1].source,
  };
}

/**
 * 补充协议二维码通常以 `(B1)`、`(B2)` 等后缀标识本文件版本，解除协议
 * 使用 `(C)`；去掉后缀后的基础编号仅用于核对关联目标，不能覆盖本文件
 * 自身编号。
 */
export function extractReferencedParentContractBusinessNumber(
  lines: readonly ContractRawOcrLine[],
  evidence: ContractBusinessNumberEvidence | null,
): string | null {
  const explicitlyReferenced = new Set<string>();
  const referencePattern =
    /(?:原|主)合同\s*编号\s*[:：]\s*([A-Z0-9][A-Z0-9/_().-]{5,63})/gi;
  for (const line of lines) {
    const text = String(line.text || "").normalize("NFKC");
    for (const match of text.matchAll(referencePattern)) {
      const value = normalizeContractBusinessNumberCandidate(match[1]);
      if (value) explicitlyReferenced.add(value);
    }
  }
  if (explicitlyReferenced.size === 1) {
    return [...explicitlyReferenced][0];
  }
  if (!evidence || evidence.source !== "qr") return null;
  const match = evidence.value.match(/^(.+)\((?:B\d+|C)\)$/i);
  return match ? match[1] : null;
}

export interface ContractTextSource {
  text: string;
  source: Exclude<ContractOcrSource, "mixed" | "rule">;
  pageNumber?: number;
  confidence?: number;
  lineConfidences?: readonly number[];
  /**
   * 识别引擎标识。合同文件运行流程统一使用 PaddleOCR（飞桨文字识别）；
   * 不同 DPI（每英寸点数）用于补充同一引擎的页面证据。
   */
  recognitionEngine?: string;
  /**
   * 仅用于精确复核已有候选的独立识别通道。该来源不会主动提出字段值，
   * 只有原始识别文字完整包含候选规范值时才形成复核证据。
   */
  verificationOnly?: boolean;
  /**
   * 局部增强来源只允许为触发复核的字段提出候选；裁片中的其他文字仍完整
   * 保存在 ocrLines（逐行识别结果）中，但不得污染其他字段的候选排序。
   */
  fieldScope?: ContractOcrFieldName;
  /** 即使引擎仅返回整段文字而没有逐行框，也保留实际模型版本。 */
  modelVersion?: PaddleOcrModelVersion;
  /** 已在本来源内执行过局部增强的字段，用于避免相同 DPI（每英寸点数）重复识别。 */
  enhancedFieldScopes?: readonly ContractOcrFieldName[];
  /** 本来源对应的完整逐行 OCR（光学字符识别）结果；字段解析只读取 text（文本），不读取该审计数据。 */
  ocrLines?: readonly ContractRawOcrLine[];
}

export interface ParseContractTextOptions {
  sources?: readonly ContractTextSource[];
  defaultSource?: Exclude<ContractOcrSource, "mixed" | "rule">;
  defaultConfidence?: number;
  /** 上传前预选分类是合同类型的业务事实，不参与 OCR（光学字符识别）。 */
  expectedCategory?: "main_business" | "non_main" | "asset";
  /**
   * 合同层级决定金额字段语义：一级合同为合同总额，补充/终止协议为本次增减额。
   * 未明确给出本次增减额时不得用变更后总额替代。
   */
  relationType?: "main" | "supplement" | "termination";
  /** 旧版租赁续签补充协议兼容：新租期总额按本次正向增量识别。 */
  leaseOperationType?: "renewal";
  /** 独立续签主合同：允许“续签／续租协议”标题采用主合同总额语义。 */
  renewalMain?: boolean;
  /** 兼容旧调用签名；识别器必须忽略文件名，避免把命名信息当成合同正文证据。 */
  fileName?: string;
  /** 第十一阶段A离线旁路诊断；只收集候选轨迹，不改变任何业务判断。 */
  candidateFunnelDiagnostics?: boolean;
}

interface LineContext {
  original: string;
  normalized: string;
  confidence: number;
}

interface SourceContext {
  source: Exclude<ContractOcrSource, "mixed" | "rule">;
  pageNumber?: number;
  confidence: number;
  recognitionEngine: string;
  verificationOnly: boolean;
  fieldScope?: ContractOcrFieldName;
  lines: LineContext[];
  text: string;
}

interface InternalCandidate {
  field: ContractOcrFieldName;
  originalValue: string;
  normalizedValue: string;
  /** 兼容别名，始终与 fieldScore（字段规则评分）相同。 */
  confidence: number;
  /** 原始 OCR（光学字符识别）置信度；非 OCR 来源为 null。 */
  ocrConfidence: number | null;
  /** 不包含命名歧义的字段规则评分。 */
  fieldScore: number;
  source: ContractOcrSource;
  pageNumber?: number;
  evidence: string;
  strongEvidence?: boolean;
  recognitionEngine: string;
  kind?: "arabic_amount" | "chinese_amount" | "category";
  /** 合同正文明确声明条款优先级时使用；数值越大，法律效力越优先。 */
  precedence?: number;
  /** 金额候选的业务语义角色；仅用于内部排序，不进入现有接口。 */
  amountRole?: ContractOcrAmountCandidateRole;
  /** 明确指向整份合同的总额锚点；分项自身的“含税总价”不属于该范围。 */
  explicitContractTotal?: boolean;
  /** 独立证据必须与候选的字段语义角色一致，不能只按同页同值背书。 */
  verificationRole?:
    | "current_contract_total"
    | "generic_amount"
    | "historical_amount"
    | "relation_adjustment"
    | "current_contract_date"
    | "historical_contract_date";
  /** 甲方／乙方明确标签高于委托方、受托方等通用角色标签。 */
  partyAnchorPriority?: 1 | 2;
  /** 诊断候选的硬上限；存在语义歧义时不得被多来源加分抬到自动采用线。 */
  confidenceCap?: number;
  /** 与当前候选直接相关的风险复核提示。 */
  warnings?: string[];
  /** 项目名称候选来源，仅参与内部排序，不进入现有接口。 */
  projectOrigin?: ContractOcrProjectCandidateOrigin;
  /**
   * 明确项目字段的业务优先级。“项目：”是合同表单直接给出的完整项目名称，
   * 高于“项目名称／工程名称”等可能由版面重复产生的普通字段候选。
   */
  projectAnchorPriority?: 1 | 2 | 3;
  /**
   * 项目名称中“咨询服务／技术服务”的语义证据。未设置时，该词组继续按
   * 合同类型或正文服务范围处理，不进入项目名称。
   */
  projectServiceRole?:
    | "explicit_field"
    | "cover_structure"
    | "body_corroboration"
    | "damaged_suffix_fusion";
  /** 补充协议金额事件的稳定标识，用于合并同一事件的大写和数字写法。 */
  amountEventKey?: string;
  /** 同一增减动作的稳定分组标识，不含金额值，用于发现中英文金额冲突。 */
  amountEventGroupKey?: string;
  /** 同一动作中的中文大写与阿拉伯数字互相矛盾，禁止参与净变化汇总。 */
  amountEventConflict?: boolean;
  /** 补充协议金额事件角色；付款、税费等非变更事件不会进入该枚举。 */
  amountEventAction?: "increase" | "decrease" | "termination";
  /** 明确总变化额优先于其后的付款或分项说明。 */
  amountEventScope?: "total" | "component";
  /** 签章页日期在合同日期候选排序中优先于首页打印日期。 */
  dateOrigin?: "signature_page" | "labeled_date";
}

interface ContractOcrMergeDiagnostics {
  candidateIds: ReadonlyMap<InternalCandidate, string>;
  ranking: Map<ContractOcrFieldName, ContractOcrCandidateRankTrace[]>;
}

function serializeCandidateFunnelCandidate(
  candidate: InternalCandidate,
  candidateId: string,
  generator: ContractOcrCandidateGenerator,
): ContractOcrCandidateFunnelCandidate {
  return {
    candidateId,
    generator,
    field: candidate.field,
    originalValue: candidate.originalValue,
    normalizedValue: candidate.normalizedValue,
    confidence: candidate.confidence,
    ocrConfidence: candidate.ocrConfidence,
    fieldScore: candidate.fieldScore,
    source: candidate.source,
    pageNumber: candidate.pageNumber,
    evidence: candidate.evidence,
    recognitionEngine: candidate.recognitionEngine,
    strongEvidence: candidate.strongEvidence === true,
    confidenceCap: candidate.confidenceCap ?? 100,
    kind: candidate.kind,
    amountRole: candidate.amountRole,
    verificationRole: candidate.verificationRole,
    projectOrigin: candidate.projectOrigin,
    projectServiceRole: candidate.projectServiceRole,
    precedence: candidate.precedence || 0,
    explicitContractTotal: candidate.explicitContractTotal === true,
  };
}

function buildCandidateFilteringDecisions(
  generatedCandidates: readonly InternalCandidate[],
  candidateIds: ReadonlyMap<InternalCandidate, string>,
  stages: readonly {
    stage: ContractOcrCandidateFilterStage;
    candidates: readonly InternalCandidate[];
  }[],
  ranking: ReadonlyMap<
    ContractOcrFieldName,
    readonly ContractOcrCandidateRankTrace[]
  >,
): ContractOcrCandidateFilterDecision[] {
  return generatedCandidates.map((candidate) => {
    for (const stage of stages) {
      if (!stage.candidates.includes(candidate)) {
        return {
          candidateId: candidateIds.get(candidate)!,
          retained: false,
          rejectedAt: stage.stage,
        };
      }
    }
    const rankedCandidateIds = new Set(
      (ranking.get(candidate.field) || []).flatMap(
        (entry) => entry.candidateIds,
      ),
    );
    const candidateId = candidateIds.get(candidate)!;
    if (!rankedCandidateIds.has(candidateId)) {
      return {
        candidateId,
        retained: false,
        rejectedAt: "ranking_suppression" as const,
      };
    }
    return { candidateId, retained: true };
  });
}

interface ContractPaddleOcrLine {
  text: string;
  confidence: number;
  box: number[][];
  modelVersion?: PaddleOcrModelVersion;
}

export interface ContractRecognitionOptions extends Pick<
  ParseContractTextOptions,
  "expectedCategory" | "relationType" | "leaseOperationType" | "renewalMain"
> {
  /** 仅覆盖本次识别使用的模型，不修改全局 OCR_MODEL（识别模型配置）。 */
  ocrModel?: PaddleOcrRequestModel;
  /** 双模型诊断专用：忽略电子文字层并强制对全部 PDF（便携式文档格式）页面执行 OCR（光学字符识别）。 */
  diagnosticOcrOnly?: boolean;
  /** 第十一阶段A离线旁路诊断；不会改变页面、模型、解析或自动采用条件。 */
  candidateFunnelDiagnostics?: boolean;
}

async function callContractPaddleOcrDetailed(
  filePath: string,
  ocrModel?: PaddleOcrRequestModel,
) {
  const ocrDaemon = await import("./ocrDaemon.js");
  return ocrDaemon.callPaddleOcrDetailed(filePath, ocrModel);
}

export interface ContractDateFocusCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ContractDateFocusEnhancementSize {
  width: number;
  height: number;
}

function isContractOcrInfrastructureError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
  };
  const infrastructureCodes = new Set([
    "OCR_INFRASTRUCTURE_ERROR",
    "ENOENT",
    "EACCES",
    "EPERM",
    "ENOSPC",
    "EMFILE",
    "ENFILE",
    "ENOMEM",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ECONNRESET",
    "EPIPE",
  ]);
  return (
    infrastructureCodes.has(String(candidate.code || "")) ||
    candidate.killed === true ||
    Boolean(candidate.signal)
  );
}

export type ContractPdfPageRecognitionDpi = 300 | 480;

export interface ContractPdfPageAutomaticRecoveryResult<T> {
  source: T | null;
  recovered: boolean;
  attempts: number;
  dpi: ContractPdfPageRecognitionDpi | null;
}

/**
 * PDF（便携式文档格式）单页首次失败时在同一任务内自动补扫：先用相同参数
 * 排除瞬时渲染／识别错误，再提高分辨率。基础设施错误继续向上抛出，避免把
 * 服务不可用误报成普通单页失败；普通页面错误穷尽三次后才返回空结果。
 */
export async function recognizeContractPdfPageWithAutomaticRecovery<T>(
  recognize: (dpi: ContractPdfPageRecognitionDpi) => Promise<T | null>,
): Promise<ContractPdfPageAutomaticRecoveryResult<T>> {
  const attemptDpis: readonly ContractPdfPageRecognitionDpi[] = [300, 300, 480];
  let attempts = 0;
  for (const dpi of attemptDpis) {
    attempts += 1;
    try {
      const source = await recognize(dpi);
      if (source) {
        return {
          source,
          recovered: attempts > 1,
          attempts,
          dpi,
        };
      }
    } catch (error) {
      if (isContractOcrInfrastructureError(error)) throw error;
    }
  }
  return { source: null, recovered: false, attempts, dpi: null };
}

const FIELD_NAMES: readonly ContractOcrFieldName[] = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
  "category",
  "contract_date",
];

const CORE_FIELD_NAMES: readonly ContractOcrFieldName[] = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
  "category",
  "contract_date",
];

const FIELD_LABELS: Record<ContractOcrFieldName, string> = {
  party_a: "甲方单位",
  party_b: "乙方单位",
  project_name: "项目名称",
  amount: "合同金额",
  category: "合同类型",
  contract_date: "合同签订日期",
};

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // 启发式分数永远不能通过四舍五入变成 100；保留真实诊断分供页面审计。
  return Math.max(0, Math.min(99, Math.floor(value)));
}

export function isContractOcrVerifiedConfidence(value: unknown): boolean {
  if (
    typeof value !== "number" &&
    !(
      typeof value === "string" &&
      /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
    )
  ) {
    return false;
  }
  const confidence = Number(value);
  return confidence === CONTRACT_OCR_AUTO_ACCEPTANCE_THRESHOLD;
}

function toHalfWidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/g, " ");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, number: string) =>
      String.fromCodePoint(Number(number)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, number: string) =>
      String.fromCodePoint(Number.parseInt(number, 16)),
    )
    .replace(/&amp;/g, "&");
}

function normalizeLine(value: string): string {
  return toHalfWidth(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([:：])\s*/g, "$1")
    .trim();
}

function meaningfulLength(value: string): number {
  return (value.match(/[\p{Script=Han}A-Za-z0-9]/gu) || []).length;
}

function scoreWithSource(
  anchorScore: number,
  sourceConfidence: number,
): number {
  return clampConfidence(
    anchorScore * (0.3 + (0.7 * clampConfidence(sourceConfidence)) / 100),
  );
}

function normalizeRawOcrConfidence(value: number): number {
  const normalized = value > 1 ? value / 100 : value;
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * 内部同时保存原始 OCR（光学字符识别）置信度与字段规则评分。
 * confidence（兼容评分字段）暂时保留为 fieldScore（字段规则评分）的别名，
 * 避免改变现有数据库和接口结构。
 */
function buildCandidateScoring(
  fieldScore: number,
  sourceConfidence: number,
  source: ContractOcrSource,
): Pick<InternalCandidate, "confidence" | "ocrConfidence" | "fieldScore"> {
  const normalizedFieldScore = clampConfidence(fieldScore);
  return {
    confidence: normalizedFieldScore,
    fieldScore: normalizedFieldScore,
    ocrConfidence: source.startsWith("ocr_")
      ? normalizeRawOcrConfidence(sourceConfidence)
      : null,
  };
}

function minimumCandidateOcrConfidence(
  candidates: readonly Pick<InternalCandidate, "ocrConfidence">[],
): number | null {
  const values = candidates
    .map((candidate) => candidate.ocrConfidence)
    .filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
  return values.length > 0 ? Math.min(...values) : null;
}

function buildSourceContexts(
  text: string,
  options: ParseContractTextOptions,
): SourceContext[] {
  const sources: readonly ContractTextSource[] =
    options.sources && options.sources.length > 0
      ? options.sources
      : [
          {
            text,
            source: options.defaultSource || "plain_text",
            confidence: options.defaultConfidence ?? 98,
          },
        ];

  return sources
    .filter((source) => typeof source.text === "string" && source.text.trim())
    .map((source) => {
      const sourceConfidence =
        source.confidence == null
          ? source.source.startsWith("ocr_")
            ? 80
            : 98
          : source.confidence <= 1
            ? source.confidence * 100
            : source.confidence;
      const originalLines = toHalfWidth(source.text).split(/\r?\n/);
      const lines = originalLines.map((original, index) => {
        const lineConfidence = source.lineConfidences?.[index];
        const normalized = normalizeLine(original);
        return {
          original: original.trim(),
          normalized: source.verificationOnly
            ? normalized.replace(/\s+/g, "")
            : normalized,
          confidence:
            lineConfidence == null
              ? clampConfidence(sourceConfidence)
              : clampConfidence(
                  lineConfidence <= 1 ? lineConfidence * 100 : lineConfidence,
                ),
        };
      });
      return {
        source: source.source,
        pageNumber: source.pageNumber,
        confidence: clampConfidence(sourceConfidence),
        recognitionEngine:
          source.recognitionEngine ||
          (source.source.startsWith("ocr_") ? "paddleocr" : source.source),
        verificationOnly: source.verificationOnly === true,
        fieldScope: source.fieldScope,
        lines,
        text: lines.map((line) => line.normalized).join("\n"),
      };
    });
}

function stripPartyFieldBoundary(value: string): string {
  return (
    normalizeLine(value)
      // 部分 OCR 会在线条噪声前后夹入零宽字符、BOM 或不可见空白；先清除
      // 名称开头的不可见字符和字段分隔符，再判断紧邻实体的线条字符。
      .replace(/^[\p{Cc}\u00A0\u2000-\u200F\u202A-\u202E\u2060\uFEFF]+/u, "")
      .replace(/^[：:、，,；;）)\]】}〉》\s]+/, "")
      .replace(/^[\p{Cc}\u00A0\u2000-\u200F\u202A-\u202E\u2060\uFEFF]+/u, "")
      .trim()
  );
}

function cleanPartyValue(value: string): string | null {
  let cleaned = stripPartyFieldBoundary(value)
    // 扫描件表格线常被识别成单位名称前的下划线或竖线。只移除紧邻名称开头的
    // 线条字符，保留名称内部的下划线、字母、数字及汉字，避免吞掉合法名称字符。
    .replace(
      /^(?:[_＿﹍﹎﹏|¦丨｜─━]+[\s\u200B-\u200F\u2060\uFEFF]*)(?=[\p{Script=Han}A-Za-z0-9])/u,
      "",
    )
    .replace(/^(?:单位(?:名称)?|名称)\s*[:：]?\s*/, "")
    .replace(/[（(](?:盖章|签章|公章)[）)]/g, "")
    .split(
      /(?:以下简称|法定代表人|授权代表|委托代理人|统一社会信用代码|地址|电话|联系人|开户|账号)/,
    )[0]
    .replace(/[；;，,。\s]+$/, "")
    .trim();
  const obligationStart =
    /(?:应当|应按|应于|应在|应向|应负责|负责|须在|须按|需要|有权|无权|不得|同意)/;
  const organizationBeforeObligation = cleaned.match(
    new RegExp(
      `^(.+(?:有限责任公司|股份有限公司|集团有限公司|有限公司|研究院|设计院|事务所|委员会|管理局|集团|中心|政府|大学|学院|医院|协会|工厂|厂|研究所|事务部|商店|店))(?=${obligationStart.source})`,
    ),
  );
  if (organizationBeforeObligation) {
    cleaned = organizationBeforeObligation[1];
  } else {
    cleaned = cleaned.split(
      new RegExp(`[，,；;。\\s]+(?=${obligationStart.source})`),
    )[0];
  }
  cleaned = cleaned.replace(/^[“”"'《》]+|[“”"'《》]+$/g, "").trim();
  if (
    cleaned.length < 2 ||
    cleaned.length > 100 ||
    /^(?:(?:合同)?专用章|公章|盖章|签字|签章|单位|名称|公司|有限公司|有限责任公司|股份有限公司|集团有限公司|研究院|设计院|事务所|中心|年月日|法定代表人)$/.test(
      cleaned,
    ) ||
    /^(?:应|须|需|有权|负责|按照|根据|同意)/.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

function nearbyNonEmptyLine(
  context: SourceContext,
  startIndex: number,
  direction: -1 | 1,
  maximumDistance = 3,
): LineContext | null {
  for (let distance = 1; distance <= maximumDistance; distance += 1) {
    const line = context.lines[startIndex + distance * direction];
    if (!line) return null;
    if (line.normalized) return line;
  }
  return null;
}

function nearbyMatchingLine(
  context: SourceContext,
  startIndex: number,
  direction: -1 | 1,
  predicate: (value: string) => boolean,
  maximumDistance = 5,
): { line: LineContext; index: number } | null {
  for (let distance = 1; distance <= maximumDistance; distance += 1) {
    const index = startIndex + distance * direction;
    const line = context.lines[index];
    if (!line) return null;
    if (line.normalized && predicate(line.normalized)) return { line, index };
  }
  return null;
}

function hasUnclosedParenthesis(value: string): boolean {
  const opening = (value.match(/[（(]/g) || []).length;
  const closing = (value.match(/[）)]/g) || []).length;
  return opening > closing;
}

function collectPartyCandidates(
  contexts: readonly SourceContext[],
  expectedCategory?: ParseContractTextOptions["expectedCategory"],
): InternalCandidate[] {
  const candidates: InternalCandidate[] = [];
  const isAssetRentalDocument =
    expectedCategory === "asset" &&
    contexts.some((context) =>
      /(?:(?:小客车|车辆|汽车|房屋|场地).{0,24}(?:租赁|出租|承租)|(?:租赁|出租|承租|租).{0,24}(?:小客车|车辆|汽车|房屋|场地))/su.test(
        context.text,
      ),
    );
  const anchorPattern =
    /(?<![\p{Script=Han}A-Za-z0-9:：])(被许可方|许可方|甲\s*方|乙\s*方|委\s*托\s*人|受\s*托\s*人|委托方|受托方|发包方|承包方|采购方|供应商|买方|卖方|出租方|承租方|用户|接入商|[\p{Script=Han}A-Za-z0-9·]{1,12}(?=\s*[:：]?\s*[（(][^）)\n]{0,12}(?:甲方|乙方)[^）)\n]{0,12}[）)]))(?:\s*(?:单位(?:名称)?|名称))?\s*[:：]?(?:\s*[（(]([^）)\n]{0,12})[）)])?(?:\s*[（(](?:盖章|签章|公章)[）)])?\s*[:：]?/gu;

  for (const context of contexts) {
    for (let lineIndex = 0; lineIndex < context.lines.length; lineIndex += 1) {
      const line = context.lines[lineIndex];
      if (!line.normalized) continue;
      const matches = [...line.normalized.matchAll(anchorPattern)];
      for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
        const match = matches[matchIndex];
        const anchor = match[1].replace(/\s/g, "");
        const explicitSide = String(match[2] || "").replace(/\s/g, "");
        const field: ContractOcrFieldName =
          explicitSide.includes("甲方") ||
          (!explicitSide.includes("乙方") &&
            /^(?:甲方|委托人|委托方|发包方|采购方|买方|许可方|出租方|用户)$/.test(
              anchor,
            ))
            ? "party_a"
            : "party_b";
        const start = (match.index || 0) + match[0].length;
        const end = matches[matchIndex + 1]?.index ?? line.normalized.length;
        let originalValue = line.normalized.slice(start, end);
        let evidence = line.original || line.normalized;
        let candidateConfidence = line.confidence;
        if (
          !cleanPartyValue(originalValue) &&
          lineIndex + 1 < context.lines.length
        ) {
          const nextLine = context.lines[lineIndex + 1];
          if (!anchorPattern.test(nextLine.normalized)) {
            originalValue = nextLine.normalized;
            evidence = `${evidence}\n${nextLine.original || nextLine.normalized}`;
            candidateConfidence = Math.min(
              candidateConfidence,
              nextLine.confidence,
            );
          }
          anchorPattern.lastIndex = 0;
        }
        const normalizedValue = cleanPartyValue(originalValue);
        if (!normalizedValue) continue;

        const hasExplicitDelimiter = /[:：]/.test(match[0]);
        const hasSeal = /盖章|签章|公章/.test(match[0]);
        const hasAmbiguousLicenseRole =
          /^(?:许可方|被许可方)$/.test(anchor) &&
          !/甲方|乙方/.test(explicitSide);
        const looksLikeOrganization =
          /(?:公司|集团|中心|研究院|设计院|事务所|委员会|政府|大学|学院|学校|医院|协会|基金会|合作社|联合体|银行|支行|机关|事业单位|社区|局|厂|所|部|店)$/.test(
            normalizedValue,
          );
        const hasNearbyIdentityNumber = context.lines
          .slice(lineIndex, lineIndex + 3)
          .some((candidateLine) =>
            /身份证(?:号|号码)\s*[:：]?\s*\d{17}[\dXx]/u.test(
              candidateLine.normalized,
            ),
          );
        const looksLikeAssetRentalNaturalPerson =
          isAssetRentalDocument &&
          /^(?:甲方|乙方)$/u.test(anchor) &&
          /(?:出租方|承租方)/u.test(`${explicitSide}${match[0]}`) &&
          /^[\p{Script=Han}·]{2,6}$/u.test(normalizedValue) &&
          hasNearbyIdentityNumber;
        // 普通合同仍只采用机构全称；资产租赁允许“甲方（出租方）／乙方
        // （承租方）”明确标签后的自然人姓名，但必须由相邻身份证字段佐证。
        // 扫描残片、动作句或没有身份事实的短词继续丢弃，不能猜测主体。
        if (!looksLikeOrganization && !looksLikeAssetRentalNaturalPerson) {
          continue;
        }

        let anchorScore = /^(?:甲方|乙方)$/.test(anchor) ? 96 : 90;
        if (
          /^(?:用户|接入商)$/.test(anchor) ||
          /甲方|乙方/.test(explicitSide)
        ) {
          anchorScore = 94;
        }
        if (/甲方|乙方/.test(explicitSide)) anchorScore = 97;
        if (hasAmbiguousLicenseRole) anchorScore = 84;
        if (context.pageNumber === 1) anchorScore += 2;
        if (hasSeal) anchorScore += 2;
        if (looksLikeOrganization) anchorScore += 1;
        candidates.push({
          field,
          // 原始字段值应只保留角色锚点后的实体文字；完整未裁切原句保存在
          // evidence。不得把“):”等锚点残留冒充为乙方名称原文。
          originalValue: stripPartyFieldBoundary(originalValue),
          normalizedValue,
          ...buildCandidateScoring(
            scoreWithSource(anchorScore, candidateConfidence),
            candidateConfidence,
            context.source,
          ),
          source: context.source,
          pageNumber: context.pageNumber,
          evidence,
          strongEvidence:
            !hasAmbiguousLicenseRole && (hasExplicitDelimiter || hasSeal),
          recognitionEngine: context.recognitionEngine,
          partyAnchorPriority:
            /^(?:甲方|乙方)$/.test(anchor) || /甲方|乙方/.test(explicitSide)
              ? 2
              : 1,
        });
      }
      anchorPattern.lastIndex = 0;
    }
  }
  return candidates;
}

function collapseRepeatedProjectPrefix(value: string): string {
  const minimumPrefixLength = 8;
  for (
    let prefixLength = Math.floor(value.length / 2);
    prefixLength >= minimumPrefixLength;
    prefixLength -= 1
  ) {
    const prefix = value.slice(0, prefixLength);
    const repeatedAt = value.indexOf(prefix, prefixLength);
    if (repeatedAt < 0) continue;
    const bridge = value.slice(prefixLength, repeatedAt);
    if (!/^(?:技术咨(?:询(?:服务)?)?|技术服务|咨询服务)?$/u.test(bridge)) {
      continue;
    }
    return `${prefix}${value.slice(repeatedAt + prefixLength)}`;
  }
  return value;
}

/**
 * 裁片重叠时，同一“地名 + 电压等级”可能以轻微 OCR（光学字符识别）差异
 * 连续出现两次，例如“咸宁110千伏……咸宁110十伏……”。这不是合法的
 * 多电压等级项目名称；只拒绝地名和电压数字都重复的窄模式，保留正常的
 * “220千伏变电站110千伏送出工程”等名称。
 */
function hasRepeatedOcrProjectFragment(value: string): boolean {
  const compacted = normalizeLine(value).replace(/\s+/g, "");
  return /^([\p{Script=Han}A-Za-z]{2,12})(\d{2,4})(?:千|十)伏.{3,60}\1\2(?:千|十)伏/u.test(
    compacted,
  );
}

interface CleanProjectNameOptions {
  /**
   * 明确“项目名称”等字段或首页合同标题把完整“咨询服务／技术服务”作为
   * 项目全称一部分时保留该后缀。损坏尾词仍须走既有清洗和多来源复核。
   */
  preserveServiceSuffix?: boolean;
}

function cleanProjectName(
  value: string,
  options: CleanProjectNameOptions = {},
): string | null {
  const documentTypeSuffixPattern = options.preserveServiceSuffix
    ? /合同(?:及)?补充(?:协议书?)?$/u
    : /(?:技术服务)?合同(?:及)?补充(?:协议书?)?$/u;
  let cleaned = normalizeLine(value)
    .replace(/[（(]/g, "（")
    .replace(/[）)]/g, "）")
    .replace(/^[：:、，,；;\s]+/, "")
    .replace(/^[（(](?:全称|项目全称)[）)]\s*[:：]?\s*/, "")
    .split(
      /(?:信息咨询项目名称|工程项目名称|咨询项目名称|项目[（(]工程[）)]名称|项目名[称标]|工程名称|合同名称)\s*[:：]|合同(?:签订|签署|生效)?(?:日期|时间)|签订(?:日期|时间|地点)|签署(?:日期|地点)|生效(?:日期|时间)|有效期限|有效期|合同期限|履行期限|合同(?:总金额|金额|总价|价款|编号)|服务费用总额|含税金额|总金额|协议金额|甲\s*方|乙\s*方|委\s*托\s*人|受\s*托\s*人|委托方|受托方|发包方|承包方|采购方|供应商|买方|卖方|出租方|承租方|服务内容|项目地点|工程地点|服务地点|付款(?:金额|方式)|预付款|进度款|支付方式|税额|税费/,
    )[0]
    .split(
      /(?:[（(]\s*(?:以下简称|简称)|[，,；;\s]+(?:以下简称|简称|项目编号|合同编号|项目负责人|联系人)\s*[:：]?)/,
    )[0]
    .replace(/[；;。\s]+$/, "")
    .replace(/^[“”"'《》]+|[“”"'《》]+$/g, "")
    .replace(/项[日曰]/g, "项目")
    .trim();
  cleaned = cleaned
    .replace(/^[丨｜|]+\s*/u, "")
    .replace(/(?<=[\p{Script=Han}0-9])\s+(?=[\p{Script=Han}0-9])/gu, "")
    .replace(
      /(^|[/、])国网北京(?:市)?[\p{Script=Han}]{1,8}供电公司(?=.+(?:千伏|变电站|工程|手续|登记|不动产|国有建设用地|检测|鉴定|服务))/gu,
      "$1",
    )
    .replace(
      /^国网北京(?:市)?[\p{Script=Han}]{1,8}供电公司(?:20\d{2}年)?(?=.{2,})/u,
      "",
    )
    .replace(
      /^网?北京(?:市)?(?:东城|西城|朝阳|海淀|丰台|石景山|门头沟|房山|通州|顺义|昌平|大兴|怀柔|平谷|密云|延庆)(?:区)?(?:供)?电(?:力)?公司(?=[\p{Script=Han}]{2,12}\d{2,4}千伏)/u,
      "",
    )
    .replace(/^20\d{2}年(?=[\p{Script=Han}]{2,12}\d{2,4}千伏)/u, "")
    .replace(
      /^合同编号\s*[:：]?\s*[A-Za-z0-9—_-]{4,48}(?:国网北京(?:市)?[\p{Script=Han}]{1,8}供电公司)?/u,
      "",
    )
    // 资产类合同封面常把“编号：XXXX”和合同标题排成相邻两行。版面
    // 排序可能把两行拼成一个候选；编号只用于文件身份，不能进入项目名称。
    .replace(
      /^(?:合同)?编号\s*[:：]?\s*[A-Za-z0-9][A-Za-z0-9./（）()—_-]{1,63}\s*/u,
      "",
    )
    .replace(
      /(^|[/、])([\p{Script=Han}A-Za-z0-9（）()·—-]{4,40})国网北京(?:市)?[\p{Script=Han}]{1,8}供电公司\2[一丨｜|]?(?=.+(?:工程|手续|登记|服务))/gu,
      "$1$2",
    )
    .replace(
      /^([\p{Script=Han}]{2,12})国网北京(?:市)?(?:东城|西城|朝阳|海淀|丰台|石景山|门头沟|房山|通州|顺义|昌平|大兴|怀柔|平谷|密云|延庆)(?:区)?供电公司\1(?=\d{2,4}千伏)/u,
      "$1",
    )
    .replace(
      /([\p{Script=Han}]{1,20}\d{2,4}千伏)国网北京(?:市)?[\p{Script=Han}]{1,8}供电公司\1[一丨｜|]?/gu,
      "$1",
    )
    .replace(/^([\p{Script=Han}]{2,8})\1(?=\d{2,4}千伏)/u, "$1")
    .replace(/^([\p{Script=Han}]{2,8})[:：]\1[:：](?=\d{2,4}千伏)/u, "$1")
    .replace(
      /^([\p{Script=Han}]{2,8}(?:[-—][\p{Script=Han}]{1,8})?)\1(?=\d{2,4}千伏)/u,
      "$1",
    )
    // 首页项目名跨过表格线时，页眉“合同”可能被版面顺序插入固定词组
    // “规划许可证”中间。只修复这一具有唯一语义的窄模式，不删除项目名
    // 其他位置本来就存在的“合同”文字。
    .replace(/规(?:技术服务)?合同划(?=许可证)/gu, "规划")
    .replace(/工程规划许可施工许可证/gu, "工程规划许可证、施工许可证")
    .replace(/前期手续工程手续）/gu, "前期手续（工程手续）")
    // “技术服务合同”中只有“合同”是文档类型；当来源为明确项目名称字段时，
    // 后续逻辑会保留“技术服务”。不能在这里把业务名称尾词一并删除。
    .replace(documentTypeSuffixPattern, "")
    .replace(/合同$/u, "")
    // OCR（光学字符识别）可能把“咨询服务”尾字误成 E／I5／15，并把后续
    // 文档类型“技术服务合同”连在后面。先剥离后续类型，保留损坏标记交给
    // 多档可见证据融合，避免该损坏串压过可恢复的正确候选。
    .replace(
      /((?:前期手续(?:（[^（）]{1,40}）)?)?咨询(?:E|I5|15))技术服务$/iu,
      "$1",
    )
    .replace(/(?<=前期手续)技术$/u, "")
    .replace(/\s*([/、])\s*/g, "$1");
  const corruptedServiceSuffix = cleaned.match(
    /(?:技术)?咨[\p{Script=Han}A-Za-z0-9]{1,2}服[\p{Script=Han}A-Za-z0-9]$/u,
  );
  if (
    corruptedServiceSuffix?.index != null &&
    !/(?:技术)?咨询服务$/u.test(cleaned)
  ) {
    // “技术咨海服名”一类尾串与合法“技术咨询服务”结构相近，但包含多个
    // 未经证实的替代字。只能剥离损坏服务尾串并保留前面的项目主体，不能
    // 猜测改写成某个完整服务名称。
    cleaned = cleaned.slice(0, corruptedServiceSuffix.index).trim();
  }
  // E／I5／15 是“服务”在扫描件中的常见损坏形态，只能作为多档融合证据，
  // 不能以原样候选进入最终项目名称。
  if (/咨询(?:E|I5|15)$/iu.test(cleaned)) {
    return null;
  }
  // 裁片边缘可能把“焦化厂110千伏”重叠成“焦化厂1焦化厂1110千伏”。
  // 该候选同时含重复实体和非法电压片段，无法无歧义恢复，直接丢弃并让
  // 同页其他清晰档候选参与判定，禁止猜改成某个电压等级。
  if (
    /^([\p{Script=Han}]{2,8})[0-9一丨｜|]+\1[0-9一丨｜|]*\d{2,4}千伏/u.test(
      cleaned,
    )
  ) {
    return null;
  }
  cleaned = collapseRepeatedProjectPrefix(cleaned);
  if (hasRepeatedOcrProjectFragment(cleaned)) {
    return null;
  }
  // 扫描版项目行偶尔只留下“地名 + 重复地名 + 询服务”残片，例如
  // “工体工体询服务”。该文字既缺电压等级、工程对象等主体信息，也不是
  // 可安全采用的项目全称；保留它只会压过同页另一档清晰度的完整候选。
  if (
    /^([\p{Script=Han}]{2,8})\1(?:(?:前期|工程)手续|(?:技术)?(?:咨?询)?服务?)?$/u.test(
      cleaned,
    )
  ) {
    return null;
  }
  // 未闭合的尾括号来自印章遮挡或裁片边界，不属于项目名称正文；只移除
  // 单独悬空的开括号，完整的“（土地证）”等说明仍原样保留。
  cleaned = cleaned
    .replace(/[（(]+$/u, "")
    .replace(
      /(?:信息咨询项目名称|工程项目名称|咨询项目名称|项目[（(]工程[）)]名称|项目名称|工程名称)\s*[:：]?$/u,
      "",
    )
    .replace(/^_+|_+$/g, "")
    .trim();
  const serviceSuffix = cleaned.match(
    /(?:工程咨询服务|项目管理咨询服务|管理咨询服务|技术咨询服务|咨询服务|技术服务)([\p{Script=Han}A-Za-z0-9_]{0,8})$/u,
  );
  if (
    serviceSuffix?.index != null &&
    !/(?:项目|工程|平台|系统|建设|改造|办理|方案|编制|许可|登记|手续)/.test(
      serviceSuffix[1],
    )
  ) {
    if (options.preserveServiceSuffix) {
      const suffixNoiseLength = serviceSuffix[1].length;
      cleaned = cleaned
        .slice(
          0,
          serviceSuffix.index + serviceSuffix[0].length - suffixNoiseLength,
        )
        .trim();
    } else {
      cleaned = cleaned.slice(0, serviceSuffix.index).trim();
    }
  }
  if (
    !options.preserveServiceSuffix &&
    /(?:项目|工程|手续|登记|服务)/.test(cleaned)
  ) {
    cleaned = cleaned
      .replace(
        /(?:工程咨询服务|项目管理咨询服务|管理咨询服务|技术咨询服务|工程咨询|技术咨询|技术咨|咨询服务|咨询服|技术服务)$/,
        "",
      )
      .trim();
  }
  if (
    cleaned.length < 3 ||
    cleaned.length > 120 ||
    /(?:工程|项目)前$/u.test(cleaned) ||
    /千伏(?:输)?变$/u.test(cleaned) ||
    /^(?:项目|工程|服务项目|项目名称|工程名称|合同|协议|技术咨询服务合同|工程咨询服务合同)$/.test(
      cleaned,
    )
  ) {
    return null;
  }
  return cleaned;
}

function isProjectMetadataBoundary(value: string): boolean {
  return (
    /^(?:(?:(?:第?[一二三四五六七八九十百\d]+)[、.．)）:：]|[（(][一二三四五六七八九十百\d]+[）)])\s*)?(?:信息咨询项目名称|工程项目名称|咨询项目名称|项目[（(]工程[）)]名称|项目名[称标]|工程名称|合同名称|甲\s*方|乙\s*方|委\s*托\s*人|受\s*托\s*人|委\s*托\s*方|受\s*托\s*方|发\s*包\s*方|承\s*包\s*方|采购方|供应商|买方|卖方|出租方|承租方|合同(?:总金额|金额|总价|价款|编号|类型|日期|签订日期|签订时间|生效日期|生效时间|期限)|服务费用总额|含税金额|总金额|协议金额|签订时间|签订日期|签订地点|签署日期|签署地点|生效日期|生效时间|有效期限|有效期|履行期限|日期|项目地点|工程地点|服务地点|服务内容|付款(?:金额|方式)|预付款|进度款|支付方式|税额|税费|第[一二三四五六七八九十\d]+条)\s*(?:[（(:：]|\s|$)/u.test(
      value,
    ) || /^(?:项目编号|合同编号|编号)/u.test(value)
  );
}

function hasExplicitProjectContinuationMarker(value: string): boolean {
  const compacted = normalizeLine(value).replace(/\s+/g, "");
  return /(?:[、/／，,：:]|以及|并且|并|及|与|和|暨|或)$/u.test(compacted);
}

function looksLikeUnmarkedProjectContinuation(value: string): boolean {
  const compacted = normalizeLine(value);
  return (
    meaningfulLength(compacted) >= 2 &&
    compacted.length <= 100 &&
    /[\p{Script=Han}]/u.test(compacted) &&
    !isProjectMetadataBoundary(compacted) &&
    !/[：:。；;]$/.test(compacted) &&
    /^(?:办理|建设|改造|编制|咨询|技术|管理|施工|规划|房产|土地|不动产|许可|登记|检测|采购|开发|运维|输变电|变电|线路|划|工程|项目|服务|系统|平台)/u.test(
      compacted,
    )
  );
}

/**
 * 无续行标点时，只允许具有明确项目名称形态的相邻行继续拼接。该规则覆盖
 * “施\n工许可证”“创新园\n110千伏……”等扫描断行，同时拒绝公司抬头、
 * 金额、日期和正文句子进入项目名称。
 */
function isSafeUnmarkedProjectContinuation(
  currentValue: string,
  continuationValue: string,
): boolean {
  const current = normalizeLine(currentValue).replace(/\s+/g, "");
  const continuation = normalizeLine(continuationValue);
  const compacted = continuation.replace(/\s+/g, "");
  if (!compacted || meaningfulLength(compacted) < 2) return false;
  if (compacted.length > 100 || isProjectMetadataBoundary(compacted)) {
    return false;
  }
  // 多分辨率或表格阅读顺序可能先给出完整项目名称，又把它的末尾片段作为
  // 下一独立行重复返回。已完整包含的四字以上尾段不得再次拼接；这不影响
  // “施”后接“工许可证”等真实断行，也不依赖任何外部真值。
  if (meaningfulLength(compacted) >= 4 && current.endsWith(compacted)) {
    return false;
  }
  if (
    /(?:公司|集团|中心|研究院|设计院|事务所|委员会|政府|大学|学院|学校|医院|协会|基金会|合作社|联合体|银行|支行|事业单位|管理局|研究所)$/u.test(
      compacted,
    )
  ) {
    return false;
  }
  if (
    /(?:人民币|[￥¥]|\d+(?:\.\d+)?\s*(?:元|万元)|\d{4}[年./-]\d{1,2})/u.test(
      compacted,
    ) ||
    /^(?:本合同|本协议|双方|根据|依据|经甲乙双方|合同期限|服务期限)/u.test(
      compacted,
    ) ||
    /[。；;：:]$/u.test(compacted)
  ) {
    return false;
  }
  if (/^[（(][^（）()]{1,40}[）)]$/u.test(compacted)) return true;
  if (/^\d{2,4}(?:[kK][vV]|千伏)/u.test(compacted)) return true;
  if (
    /^证[、，,]施工许可证(?:技术服务合同)?$/u.test(compacted) &&
    /工程规划许可$/u.test(current)
  ) {
    return true;
  }
  if (compacted === "意见" && /建设工程规划核验$/u.test(current)) {
    return true;
  }
  // 项目名称可能恰好在“前期手续”中间断行，例如首页识别为
  // “……（变电部分）前\n期手续技术服务”。“期手续”不能独立构成
  // 普通正文句首，且仅在上一片段以“前”结尾时允许拼接，避免放宽为
  // 任意后续正文。字段边界仍由上方 isProjectMetadataBoundary 拦截。
  if (
    /前$/u.test(current) &&
    /^期手续(?:办理|咨询服务|技术咨询服务|技术服务)?(?:合同)?$/u.test(compacted)
  ) {
    return true;
  }
  if (
    /^(?:工许可证|施工许可证|规划许可证|建设工程|临时建设|不动产权|国有建设用地|输变电工程|变电站|电缆隧道|土地复垦|方案编制|房屋质量|结构检测|安全鉴定|咨询服务|技术服务|手续办理)/u.test(
      compacted,
    )
  ) {
    return true;
  }
  if (
    /(?:施|规|咨|技|检|鉴|不动产|建|编|办|输变|变电|线|土|复垦)$/u.test(
      current,
    ) &&
    /^[\p{Script=Han}（(]/u.test(compacted)
  ) {
    return true;
  }
  return looksLikeUnmarkedProjectContinuation(compacted);
}

/**
 * “咨询服务／技术服务”通常是合同类型，不应默认进入项目名称。只有首页标题
 * 明确呈现“项目全称 + 服务后缀 + 技术服务合同”两层结构时，服务后缀才是
 * 项目名称的一部分。该判断避免仅凭正文服务范围扩写项目名称。
 */
function shouldPreserveProjectServiceSuffix(
  value: string,
  contexts: readonly SourceContext[],
): boolean {
  const compactedValue = normalizeLine(value)
    .replace(/[（(]/g, "（")
    .replace(/[）)]/g, "）")
    .replace(/前期手续工程手续）/gu, "前期手续（工程手续）")
    .replace(/\s+/g, "");
  if (!/(?:咨询服务|技术服务)$/u.test(compactedValue)) return false;
  const structuralSuffix = compactedValue.match(
    /(?:输变电工程|线路工程|变电站|电缆隧道|不动产|工程规划|建设工程).{2,100}(?:咨询服务|技术服务)$/u,
  )?.[0];
  const structuralPattern = structuralSuffix
    ? new RegExp(
        `${structuralSuffix
          .slice(0, -2)
          .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          )}(?:服务|15|I5|E)[A-Za-z0-9]{0,8}技术服务合同`,
        "iu",
      )
    : null;
  return contexts.some((context) => {
    if (context.pageNumber !== 1) return false;
    const coverTitleText = context.lines
      .filter((line) => line.normalized)
      .slice(0, 8)
      .map((line) =>
        line.normalized
          .replace(/[（(]/g, "（")
          .replace(/[）)]/g, "）")
          .replace(/\s+/g, ""),
      )
      .join("");
    return (
      coverTitleText.includes(`${compactedValue}技术服务合同`) ||
      coverTitleText.includes(`${compactedValue}工程咨询服务合同`) ||
      Boolean(structuralPattern?.test(coverTitleText))
    );
  });
}

/**
 * 首页标题若形成“项目主体 + 闭合手续说明 + 咨询服务 + 技术服务合同”的
 * 双层结构，则“咨询服务”属于项目名称。括号内必须明确以“手续”结束，避免
 * 把普通正文中的“前期手续技术咨询服务”一并放宽。
 */
function hasClosedProcedureProjectServiceSuffix(value: string): boolean {
  const compacted = normalizeLine(value)
    .replace(/[（(]/g, "（")
    .replace(/[）)]/g, "）")
    .replace(/\s+/g, "");
  return /（[^（）]{1,40}手续）咨询服务$/u.test(compacted);
}

function matchProjectFieldAnchor(value: string): RegExpMatchArray | null {
  return (
    value.match(
      /(?:^|[，,；;])\s*(?:(?:(?:第?[一二三四五六七八九十百\d]+)[、.．)）:：]|[（(][一二三四五六七八九十百\d]+[）)])\s*)?(信息咨询项目名称|工程项目名称|咨询项目名称|项目[（(]工程[）)]名称|项目名称|工程名称|合同名称|服务项目|项目名|项目全称|项[日曰]名称|项[日曰]名)\s*(?:[（(](?:全称|项目全称)[）)])?\s*[:：]?\s*(.*)$/u,
    ) || value.match(/^(项目|项[日曰])\s*[:：]\s*(.*)$/u)
  );
}

function projectFieldAnchorPriority(anchor: string): 1 | 2 | 3 {
  const normalizedAnchor = normalizeLine(anchor).replace(/\s+/g, "");
  if (/^(?:项目|项[日曰])$/u.test(normalizedAnchor)) return 3;
  if (/^(?:项目名称|项[日曰]名称|项目全称)$/u.test(normalizedAnchor)) {
    return 2;
  }
  return 1;
}

function isExplicitProjectNameFieldAnchor(anchor: string): boolean {
  return !/合同名称/u.test(anchor);
}

function hasCompleteExplicitProjectServiceSuffix(value: string): boolean {
  const boundedValue = normalizeLine(value).split(
    /合同(?:签订|签署|生效)?(?:日期|时间)|签订(?:日期|时间|地点)|签署(?:日期|地点)|生效(?:日期|时间)|有效期限|有效期|合同期限|履行期限|合同(?:总金额|金额|总价|价款|编号)|服务费用总额|含税金额|总金额|协议金额|甲\s*方|乙\s*方|委\s*托\s*人|受\s*托\s*人|委托方|受托方|发包方|承包方|采购方|供应商|买方|卖方|出租方|承租方|服务内容|项目地点|工程地点|服务地点|付款(?:金额|方式)|预付款|进度款|支付方式|税额|税费/u,
  )[0];
  return /(?:工程咨询服务|项目管理咨询服务|管理咨询服务|技术咨询服务|咨询服务|技术服务)(?:合同)?$/u.test(
    boundedValue.replace(/[：:\s]+$/g, "").replace(/\s+/g, ""),
  );
}

/**
 * 明确项目字段中的完整服务尾词属于字段值本身，不应在规范化时被合同类型
 * 清洗误删。“技术咨询服务”仍按服务类型处理；若同一项目的其他识别档明确
 * 给出“技术咨询服务”，则单档缺失“技术”的“咨询服务”不作为完整尾词。
 */
function explicitProjectServiceRole(
  value: string,
  contexts: readonly SourceContext[],
): InternalCandidate["projectServiceRole"] | undefined {
  const compacted = normalizeLine(value).replace(/\s+/g, "");
  if (/技术咨询服务$/u.test(compacted)) return undefined;
  const hasConsultingService = /咨询服务$/u.test(compacted);
  const hasTechnicalService =
    !hasConsultingService && /技术服务$/u.test(compacted);
  if (!hasConsultingService && !hasTechnicalService) return undefined;

  const baseValue = cleanProjectName(value);
  if (!baseValue) return undefined;
  if (hasConsultingService) {
    const hasTechnicalConsultingConflict = contexts.some((context) =>
      context.lines.some((line) => {
        const anchor = matchProjectFieldAnchor(line.normalized);
        if (!anchor || !/技术咨询服务\s*$/u.test(anchor[2])) return false;
        return cleanProjectName(anchor[2]) === baseValue;
      }),
    );
    if (hasTechnicalConsultingConflict) return undefined;
  }
  return "explicit_field";
}

/**
 * 局部项目裁片可能只覆盖“……技术服务”，看不到完整页面紧随其后的独立
 * “合同”行。此时回看同页完整来源中的项目锚点及安全续行；若拼接后的字段值
 * 与当前候选相同，且下一行构成“技术服务合同”等合同类型，则服务尾词不属于
 * 项目名称。只使用当前文档的页面文字，不读取文件名或业务真值。
 */
function hasSplitProjectContractTypeBoundary(
  value: string,
  contexts: readonly SourceContext[],
  pageNumber: number | undefined,
): boolean {
  if (
    !/(?:工程咨询服务|项目管理咨询服务|管理咨询服务|技术咨询服务|咨询服务|技术服务)\s*$/u.test(
      value,
    )
  ) {
    return false;
  }
  const expectedValue = cleanProjectName(value, {
    preserveServiceSuffix: true,
  });
  if (!expectedValue) return false;

  return contexts.some((context) => {
    if (context.fieldScope != null || context.pageNumber !== pageNumber) {
      return false;
    }
    return context.lines.some((line, index) => {
      const anchor = matchProjectFieldAnchor(line.normalized);
      if (!anchor) return false;
      let assembledValue = anchor[2];
      for (let distance = 1; distance <= 6; distance += 1) {
        const followingLine = context.lines[index + distance];
        if (!followingLine) break;
        if (!followingLine.normalized) continue;
        if (
          /^合同(?:$|[（(]|及|补充|变更|追加|终止)/u.test(
            followingLine.normalized,
          )
        ) {
          return (
            cleanProjectName(assembledValue, {
              preserveServiceSuffix: true,
            }) === expectedValue
          );
        }
        if (isProjectMetadataBoundary(followingLine.normalized)) break;
        if (meaningfulLength(followingLine.normalized) === 1) continue;
        const canContinue =
          meaningfulLength(assembledValue) === 0 ||
          hasUnclosedParenthesis(assembledValue) ||
          hasExplicitProjectContinuationMarker(assembledValue) ||
          isSafeUnmarkedProjectContinuation(
            assembledValue,
            followingLine.normalized,
          );
        if (!canContinue) break;
        assembledValue = `${assembledValue}${followingLine.normalized}`;
      }
      return false;
    });
  });
}

/**
 * 项目名称的内容质量只参与候选排序，不代替 OCR（光学字符识别）置信度。
 * 分值由完整项目关键词、闭合结构和明确结尾组成；字段污染和截断尾词扣分。
 */
function projectValueQuality(value: string): number {
  const compacted = normalizeLine(value).replace(/\s+/g, "");
  let quality = 0;
  const keywords = [
    /项目/u,
    /工程/u,
    /千伏/u,
    /变电站/u,
    /输变电/u,
    /线路/u,
    /前期手续/u,
    /规划许可/u,
    /施工许可/u,
    /不动产/u,
    /国有建设用地/u,
    /检测|鉴定/u,
    /咨询|服务/u,
    /采购|购置/u,
    /车辆|小客车|汽车|租车/u,
  ];
  quality += Math.min(
    18,
    keywords.filter((pattern) => pattern.test(compacted)).length * 3,
  );
  if (meaningfulLength(compacted) >= 6) quality += 2;
  if (meaningfulLength(compacted) >= 16) quality += 3;
  if (meaningfulLength(compacted) >= 30) quality += 2;
  if (!hasUnclosedParenthesis(compacted) && !/^[^（(]*[）)]/u.test(compacted)) {
    quality += 2;
  }
  if (
    /(?:项目|工程|手续|许可证|许可|登记|意见|服务|咨询|检测|鉴定|办理|编制|采购|购置|平台|系统|[）)])$/u.test(
      compacted,
    )
  ) {
    quality += 5;
  }
  if (
    /(?:信息咨询项目名称|工程项目名称|咨询项目名称|项目[（(]工程[）)]名称|项目名[称标]|工程名称|合同名称|合同编号|甲方|乙方|委托方|受托方|付款|签订日期|签署日期|国网北京.{0,8}供电公司)/u.test(
      compacted,
    )
  ) {
    quality -= 28;
  }
  if (/(?:技术|咨询服|规划许可|施工许可|输变电|变电)$/u.test(compacted)) {
    quality -= 8;
  }
  return quality;
}

/**
 * 同一项目在不同清晰度识别结果中只出现地名首部单字差异时，优先采用被
 * 多档 OCR（光学字符识别）重复识别的候选。差异必须位于电压等级之前，
 * 不对文字做替换或猜测，只调整独立候选的排序。
 */
function differsBySingleProjectPrefixGlyph(
  left: string,
  right: string,
): boolean {
  const leftValue = normalizeLine(left).replace(/\s+/g, "");
  const rightValue = normalizeLine(right).replace(/\s+/g, "");
  if (leftValue.length !== rightValue.length) return false;

  let differenceIndex = -1;
  let differenceCount = 0;
  for (let index = 0; index < leftValue.length; index += 1) {
    if (leftValue[index] === rightValue[index]) continue;
    differenceCount += 1;
    differenceIndex = index;
    if (differenceCount > 1) return false;
  }
  if (differenceCount !== 1) return false;

  const voltageIndex = leftValue.search(/\d{2,4}(?:千伏|[kK][vV])/u);
  return (
    voltageIndex >= 2 && differenceIndex >= 0 && differenceIndex < voltageIndex
  );
}

function scoreProjectCandidate(
  value: string,
  origin: NonNullable<InternalCandidate["projectOrigin"]>,
  pageNumber: number | undefined,
  ocrConfidence: number,
  ambiguous = false,
): number {
  const originScore =
    origin === "labeled_field" ? 84 : origin === "cover_title" ? 80 : 64;
  const locationBoost =
    pageNumber === 1
      ? origin === "cover_title"
        ? 10
        : origin === "labeled_field"
          ? 5
          : 2
      : 0;
  const ambiguityPenalty = ambiguous ? 18 : 0;
  return scoreWithSource(
    Math.min(
      ambiguous ? 99 : 100,
      originScore +
        locationBoost +
        projectValueQuality(value) -
        ambiguityPenalty,
    ),
    ocrConfidence,
  );
}

function normalizeProjectEvidence(value: string): string {
  return normalizeLine(value)
    .replace(/[（(]/g, "（")
    .replace(/[）)]/g, "）")
    .replace(/\s+/g, "");
}

/**
 * 首页同一尾词在不同清晰度中分别损坏为“咨询E／咨询15”，而正文原合同
 * 标题保留“咨询 + 技术服务合同”边界时，可确认“服务”字符确实存在于项目
 * 尾词位置。该融合要求两个不同 OCR（光学字符识别）档和两个不同损坏形态，
 * 不根据项目名称、合同编号或文件名补字。
 */
function appendDamagedProjectServiceFusionCandidates(
  contexts: readonly SourceContext[],
  candidates: InternalCandidate[],
): void {
  const damagedEvidence: Array<{
    tail: string;
    projectPrefix: string;
    source: ContractOcrSource;
    marker: string;
    line: LineContext;
  }> = [];

  for (const context of contexts) {
    if (context.pageNumber !== 1 || !context.source.startsWith("ocr_")) {
      continue;
    }
    for (const line of context.lines) {
      const compacted = normalizeProjectEvidence(line.normalized);
      const damagedMatch = compacted.match(
        /(前期手续(?:（[^（）]{1,40}）)?咨询)(E|I5|15)(?=(?:[A-Za-z0-9]{0,8}技术服务合同)?(?:$|[，,。；;]))/iu,
      );
      if (!damagedMatch) continue;
      const projectPrefix = compacted.slice(
        0,
        (damagedMatch.index || 0) + damagedMatch[1].length,
      );
      if (!projectPrefix.endsWith(damagedMatch[1])) {
        continue;
      }
      damagedEvidence.push({
        tail: damagedMatch[1],
        projectPrefix,
        source: context.source,
        marker: damagedMatch[2].toUpperCase(),
        line,
      });
    }
  }
  // 项目字段的原始检测框可能把尾字拆成独立行，字段候选在安全续行后才能
  // 形成“咨询E／咨询15”。因此同时读取已经完成跨行拼接的首页项目候选；
  // 仍要求两个分辨率和两个不同损坏形态，不能由单一候选触发补字。
  for (const candidate of candidates) {
    if (
      candidate.pageNumber !== 1 ||
      !candidate.source.startsWith("ocr_") ||
      candidate.field !== "project_name"
    ) {
      continue;
    }
    const compacted = normalizeProjectEvidence(candidate.normalizedValue);
    const damagedMatch = compacted.match(
      /(前期手续(?:（[^（）]{1,40}）)?咨询)(E|I5|15)(?=$|[，,。；;])/iu,
    );
    if (!damagedMatch) continue;
    const projectPrefix = compacted.slice(
      0,
      (damagedMatch.index || 0) + damagedMatch[1].length,
    );
    const marker = damagedMatch[2].toUpperCase();
    if (
      damagedEvidence.some(
        (damaged) =>
          damaged.source === candidate.source &&
          damaged.marker === marker &&
          damaged.projectPrefix === projectPrefix,
      )
    ) {
      continue;
    }
    const rawConfidence =
      candidate.ocrConfidence == null
        ? candidate.confidence
        : candidate.ocrConfidence * 100;
    damagedEvidence.push({
      tail: damagedMatch[1],
      projectPrefix,
      source: candidate.source,
      marker,
      line: {
        original: candidate.originalValue,
        normalized: candidate.normalizedValue,
        confidence: clampConfidence(rawConfidence),
      },
    });
  }

  for (const baseCandidate of candidates
    .filter(
      (candidate) =>
        candidate.projectOrigin === "body_description" &&
        /\d{2,4}(?:千伏|[kK][vV])/u.test(candidate.normalizedValue),
    )
    .sort((left, right) => right.confidence - left.confidence)) {
    let matchingDamaged = damagedEvidence.filter((damaged) => {
      if (!baseCandidate.normalizedValue.endsWith(damaged.tail)) return false;
      const baseProject = normalizeProjectEvidence(
        baseCandidate.normalizedValue,
      );
      const damagedProject = damaged.projectPrefix.slice(-baseProject.length);
      return damagedProject === baseProject;
    });
    const hasTwoDamagedViews = (
      evidence: readonly (typeof damagedEvidence)[number][],
    ): boolean =>
      new Set(evidence.map((damaged) => damaged.source)).size >= 2 &&
      new Set(evidence.map((damaged) => damaged.marker)).size >= 2;
    if (!hasTwoDamagedViews(matchingDamaged)) {
      // 某些版面把完整项目主体与尾词拆成不同检测框，各档只留下
      // “（工程手续）咨询E／15”。只有尾词含闭合的具体手续说明，且正文
      // 原合同标题中只有一个项目使用该完整结构时，才允许以该结构关联；
      // 普通“前期手续咨询”不能跨项目主体融合。
      for (const tail of [
        ...new Set(
          damagedEvidence
            .map((damaged) => damaged.tail)
            .filter((candidateTail) =>
              baseCandidate.normalizedValue.endsWith(candidateTail),
            ),
        ),
      ]) {
        if (!/（[^（）]{2,40}手续）/u.test(tail)) continue;
        const bodyProjectsForTail = new Set(
          candidates
            .filter((candidate) => {
              if (
                candidate.projectOrigin !== "body_description" ||
                !candidate.normalizedValue.endsWith(tail)
              ) {
                return false;
              }
              const evidence = normalizeProjectEvidence(
                `${candidate.originalValue}\n${candidate.evidence}`,
              );
              return evidence.includes(
                `${normalizeProjectEvidence(candidate.normalizedValue)}技术服务合同`,
              );
            })
            .map((candidate) => candidate.normalizedValue),
        );
        if (
          bodyProjectsForTail.size !== 1 ||
          !bodyProjectsForTail.has(baseCandidate.normalizedValue)
        ) {
          continue;
        }
        const baseProject = normalizeProjectEvidence(
          baseCandidate.normalizedValue,
        );
        const basePrefix = baseProject.slice(0, -tail.length);
        const structuredTailEvidence = damagedEvidence.filter((damaged) => {
          if (damaged.tail !== tail) return false;
          const damagedPrefix = damaged.projectPrefix.slice(0, -tail.length);
          // 闭合手续尾词只解决检测框把项目首部裁掉的情况。残片中一旦仍
          // 带有项目主体，该主体必须是正文完整项目主体的连续后缀；否则
          // 相同业务尾词可能把两个不同项目错误融合。
          return damagedPrefix.length > 0 && basePrefix.endsWith(damagedPrefix);
        });
        if (hasTwoDamagedViews(structuredTailEvidence)) {
          matchingDamaged = structuredTailEvidence;
          break;
        }
      }
    }
    const damagedSources = new Set(
      matchingDamaged.map((damaged) => damaged.source),
    );
    const damagedMarkers = new Set(
      matchingDamaged.map((damaged) => damaged.marker),
    );
    if (damagedSources.size < 2 || damagedMarkers.size < 2) continue;
    const comparableEvidence = normalizeProjectEvidence(
      `${baseCandidate.originalValue}\n${baseCandidate.evidence}`,
    );
    if (
      !comparableEvidence.includes(
        `${normalizeProjectEvidence(baseCandidate.normalizedValue)}技术服务合同`,
      )
    ) {
      continue;
    }

    const fusedValue = `${baseCandidate.normalizedValue}服务`;
    if (
      candidates.some((candidate) => candidate.normalizedValue === fusedValue)
    ) {
      continue;
    }
    const sourceConfidence =
      baseCandidate.ocrConfidence == null
        ? Math.min(99, baseCandidate.confidence)
        : baseCandidate.ocrConfidence * 100;
    const damagedConfidence = Math.min(
      ...matchingDamaged.map((damaged) => damaged.line.confidence),
    );
    const fusedConfidence = Math.min(sourceConfidence, damagedConfidence);
    candidates.push({
      ...baseCandidate,
      originalValue: baseCandidate.originalValue,
      normalizedValue: fusedValue,
      ...buildCandidateScoring(
        Math.min(
          99,
          scoreProjectCandidate(
            fusedValue,
            "body_description",
            baseCandidate.pageNumber,
            fusedConfidence,
          ),
        ),
        fusedConfidence,
        baseCandidate.source,
      ),
      evidence: [
        baseCandidate.evidence,
        ...matchingDamaged.map(
          (damaged) => damaged.line.original || damaged.line.normalized,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
      strongEvidence: false,
      confidenceCap: 99,
      projectServiceRole: "damaged_suffix_fusion",
      warnings: [
        ...(baseCandidate.warnings || []),
        "项目名称尾词由首页多档损坏片段与正文原合同标题的同一结构融合恢复",
      ],
    });
  }
}

interface ProjectCandidateCollectionDiagnostics {
  /** 框架协议专用过滤执行前已经生成的全部项目候选。 */
  generatedCandidates: InternalCandidate[];
}

const LEGACY_PROJECT_SUBJECT_SHAPE_PATTERN =
  /(?:项目|工程|千伏|变电站|线路|不动产|许可证|检测|鉴定|手续|采购|购置)/u;

const PROJECT_SUBJECT_SHAPE_PATTERN =
  /(?:项目|工程|千伏|变电站|线路|不动产|许可证|检测|鉴定|手续|采购|购置|租赁|出租|房屋|场地|停车|车位|车辆|小客车|汽车|租车|网络|宽带|专线|接入|通信|物业|运维|维护|顾问|设计|施工|设备|软件|系统|平台)/u;

const NON_MAIN_PROJECT_SUBJECT_SHAPE_PATTERN =
  /(?:项目|工程|千伏|变电站|线路|不动产|许可证|检测|鉴定|手续|采购|购置|租赁|出租|房屋|场地|停车|车位|网络|宽带|专线|接入|通信|物业|运维|维护|顾问|设计|施工|设备|软件|系统|平台|评价|评估|审计|广告|制作|宣传|会展|会议|餐饮|运输|仓储|保洁|法律|代理|培训|活动|策划|勘察|测绘|调研|报告|认证|监理|造价)/u;

const PROJECT_DOCUMENT_TYPE_PATTERN =
  /(?:工程咨询服务|项目管理咨询服务|管理咨询服务|技术咨询服务|技术服务|工程咨询|技术咨询|项目管理咨询|管理咨询|咨询服务|网络服务|通信服务|服务|采购)?(?:合同(?:及)?(?:补充|变更|追加|终止)?协议(?:书)?|合同书?|补充协议(?:书)?|变更协议(?:书)?|追加协议(?:书)?|续签协议(?:书)?|续租协议(?:书)?|协议(?:书)?)(?:[（(][^（）()]{1,30}[）)])?$/u;

/**
 * 从首页合同标题或“合同名称”字段中只剥离末尾文档类型。这里不决定最终
 * 采用，只为候选漏斗补充一个可排序的项目主体；公司、付款条款及纯合同类型
 * 仍由第十一阶段B安全门禁失败关闭。
 */
function extractProjectSubjectFromDocumentTitle(value: string): string | null {
  const normalized = normalizeLine(value)
    .replace(/^[“”"'《》]+|[“”"'《》]+$/gu, "")
    .trim();
  const typeMatch = normalized.match(PROJECT_DOCUMENT_TYPE_PATTERN);
  if (!typeMatch?.index || typeMatch.index < 2) return null;
  return cleanProjectName(normalized.slice(0, typeMatch.index));
}

function extractProjectSubjectKeepingServiceFromDocumentTitle(
  value: string,
): string | null {
  const normalized = normalizeLine(value)
    .replace(/^[“”"'《》]+|[“”"'《》]+$/gu, "")
    .trim();
  const documentType = normalized.match(
    /(?:合同(?:及)?(?:补充|变更|追加|终止)?协议(?:书)?|合同书?|补充协议(?:书)?|变更协议(?:书)?|追加协议(?:书)?|续签协议(?:书)?|续租协议(?:书)?|协议(?:书)?)(?:[（(][^（）()]{1,30}[）)])?$/u,
  );
  if (!documentType?.index || documentType.index < 2) return null;
  return cleanProjectName(normalized.slice(0, documentType.index), {
    preserveServiceSuffix: true,
  });
}

function standaloneBookTitleValue(value: string): string | null {
  const normalized = normalizeLine(value);
  const match = normalized.match(/《([^》]{3,220})》/u);
  if (!match) return null;
  const surroundingText = normalized
    .replace(match[0], "")
    .replace(/[\s：:、，,；;。()（）\u005b\u005d【】_-]+/gu, "");
  return surroundingText ? null : match[1];
}

function extractProjectCoverTitleSubject(
  value: string,
  expectedCategory?: ParseContractTextOptions["expectedCategory"],
): string | null {
  const normalized = normalizeLine(value);
  const bookTitle = standaloneBookTitleValue(normalized);
  const titleValue = bookTitle || normalized;
  const subject = extractProjectSubjectFromDocumentTitle(titleValue);
  const shapePattern =
    expectedCategory === "non_main"
      ? NON_MAIN_PROJECT_SUBJECT_SHAPE_PATTERN
      : PROJECT_SUBJECT_SHAPE_PATTERN;
  if (!subject || !shapePattern.test(subject)) return null;
  return subject;
}

/**
 * 封面常另印一行纯数字流水号或“编号：……”元数据。该行与合同标题在
 * 版面排序后可能被拼成同一个跨行标题，但它只用于文件流转，不属于项目
 * 名称。只排除独占编号行；“110千伏……”或“2026年度……”等业务标题
 * 不受影响。
 */
function isStandaloneCoverDocumentIdentifier(value: string): boolean {
  const normalized = normalizeLine(value).replace(/\s+/g, "");
  return (
    /^\d{8,32}$/u.test(normalized) ||
    /^(?:合同)?编号[:：][^。；]{2,100}$/u.test(normalized) ||
    /^[（(].{1,60}[（(]20\d{2}[）)][A-Za-z0-9-]{1,20}号?[）)]$/u.test(
      normalized,
    )
  );
}

/**
 * 非主营分包合同的首页可能只有“技术咨询服务合同”等通用标题，实际业务
 * 对象写在“甲方已与第三方签署《具体项目合同》……现甲方委托乙方……”
 * 的连续事实中。只有引用合同与本次委托同时闭合、且引用标题具备明确项目
 * 形态时才形成候选；多个不同引用标题并存时返回空值，禁止猜选。
 */
function referencedNonMainServiceProjectValue(
  value: string,
  expectedCategory?: ParseContractTextOptions["expectedCategory"],
): string | null {
  if (expectedCategory !== "non_main") return null;
  const compacted = normalizeLine(value).replace(/\s+/g, "");
  const referencedTitles = [
    ...compacted.matchAll(
      /(?:甲方|委托方)(?:已)?与.{1,100}?(?:签署|签订)《([^》]{6,220}?(?:合同|协议(?:书)?))》.{0,420}?(?:现)?(?:甲方|委托方)(?:现)?(?:委托|聘请)(?:乙方|受托方).{0,200}?(?:提供|开展|承担|完成|协助).{0,36}?(?:服务|工作|支持)/gu,
    ),
  ]
    .map(
      (match) =>
        extractProjectSubjectKeepingServiceFromDocumentTitle(match[1]) ||
        extractProjectSubjectFromDocumentTitle(match[1]),
    )
    .filter((candidate): candidate is string => Boolean(candidate))
    .filter((candidate) =>
      NON_MAIN_PROJECT_SUBJECT_SHAPE_PATTERN.test(candidate),
    );
  const distinctTitles = [...new Set(referencedTitles)];
  return distinctTitles.length === 1 ? distinctTitles[0] : null;
}

function projectBodyDescriptionValue(
  value: string,
  expectedCategory?: ParseContractTextOptions["expectedCategory"],
): string | null {
  const explicitObject = value.match(
    /(?:本合同|本协议)?(?:的)?(?:服务|委托|咨询|工作)对象\s*(?:为|是)?\s*[:：]?\s*([^，。；;]{4,120})/u,
  )?.[1];
  const boundedObject = explicitObject
    ? null
    : value.match(
        /(?:委托|聘请).{0,48}?(?:就|针对|围绕|在)\s*([^，。；;]{4,160}?)\s*(?:中|方面)?(?:提供|开展|承担|完成|进行).{0,24}?(?:服务|工作|咨询|协调|支持)/u,
      )?.[1];
  const developmentObject =
    explicitObject || boundedObject
      ? null
      : value.match(
          /(?:主要)?负责\s*([^，。；;]{4,120}?)\s*(?:的)?(?:开发建设|建设开发|建设|开发)[，,].{0,60}?(?:委托|聘请).{0,80}?(?:提供|开展|承担|完成).{0,24}?(?:服务|工作)/u,
        )?.[1];
  const candidateValue = explicitObject || boundedObject || developmentObject;
  const shapePattern =
    expectedCategory === "non_main"
      ? NON_MAIN_PROJECT_SUBJECT_SHAPE_PATTERN
      : PROJECT_SUBJECT_SHAPE_PATTERN;
  if (!candidateValue || !shapePattern.test(candidateValue)) {
    return null;
  }
  if (/^(?:本|该|上述|前述)(?:项目|工程)(?:$|的|及|与)/u.test(candidateValue)) {
    return null;
  }
  const preservesSpecificConsultingObject =
    boundedObject &&
    /(?:项目|工程)的.{2,100}?(?:问题|评价|评估|抵押|登记|验收|审批).{0,30}?咨询(?:及(?:咨询及)?协调工作)?$/u.test(
      candidateValue,
    );
  const boundedRightEdge =
    boundedObject && !preservesSpecificConsultingObject
      ? candidateValue.replace(
          /((?:项目|工程))(?:的(?:建设|开展|实施|办理|服务|手续)|及(?:其)?相关(?:工作|服务|事项)).*$/u,
          "$1",
        )
      : candidateValue;
  const boundedServiceObject = boundedObject
    ? boundedRightEdge
        .replace(
          /(?:工程咨询服务|项目管理咨询服务|管理咨询服务|技术咨询服务|咨询服务|技术服务)项目$/u,
          "",
        )
        .replace(/及(?:咨询及)?协调工作$/u, "")
    : boundedRightEdge;
  return cleanProjectName(boundedServiceObject);
}

function collectProjectCandidates(
  contexts: readonly SourceContext[],
  relationType?: ParseContractTextOptions["relationType"],
  diagnostics?: ProjectCandidateCollectionDiagnostics,
  expectedCategory?: ParseContractTextOptions["expectedCategory"],
): InternalCandidate[] {
  const candidates: InternalCandidate[] = [];
  const projectSubjectShapePattern =
    expectedCategory === "non_main"
      ? NON_MAIN_PROJECT_SUBJECT_SHAPE_PATTERN
      : PROJECT_SUBJECT_SHAPE_PATTERN;
  for (const context of contexts) {
    const contextHasExplicitProjectField = context.lines.some((candidateLine) =>
      Boolean(matchProjectFieldAnchor(candidateLine.normalized)),
    );
    const referencedNonMainProjectValue = referencedNonMainServiceProjectValue(
      context.text,
      expectedCategory,
    );
    if (referencedNonMainProjectValue) {
      candidates.push({
        field: "project_name",
        originalValue: referencedNonMainProjectValue,
        normalizedValue: referencedNonMainProjectValue,
        ...buildCandidateScoring(
          scoreProjectCandidate(
            referencedNonMainProjectValue,
            "body_description",
            context.pageNumber,
            context.confidence,
          ),
          context.confidence,
          context.source,
        ),
        source: context.source,
        pageNumber: context.pageNumber,
        evidence: context.text,
        strongEvidence: true,
        recognitionEngine: context.recognitionEngine,
        projectOrigin: "body_description",
        projectServiceRole: "body_corroboration",
      });
    }
    for (let index = 0; index < context.lines.length; index += 1) {
      const line = context.lines[index];
      const anchorMatch = matchProjectFieldAnchor(line.normalized);
      if (anchorMatch) {
        const explicitProjectNameField = isExplicitProjectNameFieldAnchor(
          anchorMatch[1],
        );
        const anchorPriority = projectFieldAnchorPriority(anchorMatch[1]);
        let originalValue = anchorMatch[2];
        let evidence = line.original || line.normalized;
        let candidateConfidence = line.confidence;
        let hasAmbiguousContinuation = false;
        let lastProjectLineIndex = index;
        const previousParentheticalFragment = nearbyMatchingLine(
          context,
          index,
          -1,
          (value) => /^[（(][\p{Script=Han}A-Za-z0-9]{1,8}$/u.test(value),
        );
        const nextParentheticalFragment = nearbyMatchingLine(
          context,
          index,
          1,
          (value) => /^[\p{Script=Han}A-Za-z0-9]{1,12}[）)]$/u.test(value),
        );
        const splitParenthetical =
          Boolean(previousParentheticalFragment) &&
          Boolean(nextParentheticalFragment);
        if (splitParenthetical) {
          const openingFragment =
            previousParentheticalFragment?.line.normalized || "";
          const closingFragment =
            nextParentheticalFragment?.line.normalized || "";
          // 扫描件的括号说明可能被版面排序拆到项目锚点两侧，中间还会混入页眉、
          // 印章或孤立字符。括号已配对时只使用锚点值与两个括号片段恢复名称；
          // 中间所有行仅保留为证据，绝不拼入字段值。
          originalValue = `${originalValue}${openingFragment}${closingFragment}`;
          evidence = context.lines
            .slice(
              previousParentheticalFragment?.index,
              (nextParentheticalFragment?.index || index) + 1,
            )
            .map((candidate) => candidate.original || candidate.normalized)
            .filter(Boolean)
            .join("\n");
          candidateConfidence = Math.min(
            candidateConfidence,
            previousParentheticalFragment?.line.confidence ||
              candidateConfidence,
            nextParentheticalFragment?.line.confidence || candidateConfidence,
          );
          lastProjectLineIndex =
            nextParentheticalFragment?.index || lastProjectLineIndex;
        } else {
          const anchorValueWasEmpty = meaningfulLength(originalValue) === 0;
          for (let distance = 1; distance <= 4; distance += 1) {
            const continuation = context.lines[index + distance];
            if (!continuation) break;
            if (!continuation.normalized) continue;
            if (
              !hasUnclosedParenthesis(originalValue) &&
              /^[\p{Script=Han}A-Za-z0-9]{1,12}[）)]$/u.test(
                continuation.normalized,
              )
            ) {
              break;
            }
            if (isProjectMetadataBoundary(continuation.normalized)) {
              break;
            }
            if (!/[\p{Script=Han}]/u.test(continuation.normalized)) continue;
            if (continuation.normalized.length > 100) break;
            // 印章、页眉或版面排序经常在跨行项目名之间插入单个孤立汉字。
            // 单字不足以构成可靠项目名续行，跳过后继续寻找真正的下一片段。
            if (meaningfulLength(continuation.normalized) === 1) continue;
            // 括号被印章或裁片截断时不能因此无条件吞入后续法律正文。法律
            // 句式和完整条款标点始终是硬边界；真正的括号闭合片段仍由上方
            // 专门规则处理。
            if (
              /^(?:双方|本合同|本协议|根据|依据|经甲乙双方)/u.test(
                continuation.normalized,
              ) ||
              /[。；;：:]$/u.test(continuation.normalized)
            ) {
              break;
            }
            const hasExplicitContinuation =
              meaningfulLength(originalValue) === 0 ||
              hasUnclosedParenthesis(originalValue) ||
              hasExplicitProjectContinuationMarker(originalValue);
            const hasStructuredExplicitServiceContinuation =
              distance === 1 &&
              /[）)]\s*$/u.test(originalValue) &&
              /^前期手续(?:[（(][^（）()]{1,40}[）)])?咨询服务$/u.test(
                continuation.normalized.replace(/\s+/g, ""),
              );
            const hasSafeUnmarkedContinuation =
              hasStructuredExplicitServiceContinuation ||
              isSafeUnmarkedProjectContinuation(
                originalValue,
                continuation.normalized,
              );
            const hasLaterSafeContinuation =
              meaningfulLength(continuation.normalized) <= 3 &&
              context.lines
                .slice(index + distance + 1, index + 5)
                .some(
                  (laterLine) =>
                    Boolean(laterLine?.normalized) &&
                    !isProjectMetadataBoundary(laterLine.normalized) &&
                    isSafeUnmarkedProjectContinuation(
                      originalValue,
                      laterLine.normalized,
                    ),
                );
            if (!hasSafeUnmarkedContinuation && hasLaterSafeContinuation) {
              // 真实盖章首页中，项目名称的上下两行之间可能插入“合同”“国”
              // 等印章或页眉短词。短词本身不是合法续行，而后方仍存在与
              // 当前残缺尾词严格闭合的片段时，跳过短词继续寻找，不能让它
              // 截断第一页项目名称，也不能把短词写入字段值。
              continue;
            }
            if (!hasExplicitContinuation && !hasSafeUnmarkedContinuation) {
              if (
                distance === 1 &&
                looksLikeUnmarkedProjectContinuation(continuation.normalized)
              ) {
                hasAmbiguousContinuation = true;
              }
              break;
            }
            originalValue = `${originalValue}${continuation.normalized}`;
            evidence = `${evidence}\n${continuation.original || continuation.normalized}`;
            lastProjectLineIndex = index + distance;
            candidateConfidence = Math.min(
              candidateConfidence,
              continuation.confidence,
            );
          }
          const nextNonEmpty = nearbyNonEmptyLine(context, index, 1);
          const nextFragment = nextNonEmpty?.normalized || "";
          if (
            hasUnclosedParenthesis(originalValue) &&
            /^[\p{Script=Han}A-Za-z0-9]{1,20}[）)]$/u.test(nextFragment)
          ) {
            originalValue = `${originalValue}${nextFragment}`;
            evidence = `${evidence}\n${nextNonEmpty?.original || nextFragment}`;
            candidateConfidence = Math.min(
              candidateConfidence,
              nextNonEmpty?.confidence || candidateConfidence,
            );
          }
          if (
            !anchorValueWasEmpty &&
            !hasUnclosedParenthesis(anchorMatch[2]) &&
            !hasExplicitProjectContinuationMarker(anchorMatch[2]) &&
            nextNonEmpty &&
            looksLikeUnmarkedProjectContinuation(nextNonEmpty.normalized) &&
            !isSafeUnmarkedProjectContinuation(
              anchorMatch[2],
              nextNonEmpty.normalized,
            )
          ) {
            // 没有续行标志时，下一行也可能只是正文、表格或另一字段的残片。
            // 保留锚点原值参与风险复核，但绝不猜拼，并阻止多来源伪造满分。
            hasAmbiguousContinuation = true;
          }
        }
        const followingProjectLine = nearbyMatchingLine(
          context,
          lastProjectLineIndex,
          1,
          () => true,
          3,
        )?.line.normalized;
        const serviceSuffixFormsSplitContractTitle =
          Boolean(
            followingProjectLine &&
            /(?:工程咨询服务|项目管理咨询服务|管理咨询服务|技术咨询服务|咨询服务|技术服务)\s*$/u.test(
              originalValue,
            ) &&
            /^合同(?:$|[（(]|及|补充|变更|追加|终止)/u.test(
              followingProjectLine,
            ),
          ) ||
          hasSplitProjectContractTypeBoundary(
            originalValue,
            contexts,
            context.pageNumber,
          );
        // 项目字段跨行后若以“技术服务”等结束，且下一独立行就是“合同”，
        // 只剥离文档类型“合同”。明确项目名称字段中的“技术服务”属于名称，
        // 不因“合同”位于同一行或下一行而被一并删除。
        const completeExplicitProjectServiceSuffix =
          explicitProjectNameField &&
          hasCompleteExplicitProjectServiceSuffix(originalValue);
        const projectServiceRole = serviceSuffixFormsSplitContractTitle
          ? undefined
          : completeExplicitProjectServiceSuffix
            ? "explicit_field"
            : explicitProjectServiceRole(originalValue, contexts);
        const normalizedValue = cleanProjectName(originalValue, {
          preserveServiceSuffix:
            completeExplicitProjectServiceSuffix ||
            (!serviceSuffixFormsSplitContractTitle &&
              (Boolean(projectServiceRole) ||
                shouldPreserveProjectServiceSuffix(originalValue, contexts))),
        });
        if (normalizedValue) {
          candidates.push({
            field: "project_name",
            originalValue: normalizeLine(originalValue),
            normalizedValue,
            ...buildCandidateScoring(
              Math.min(
                hasAmbiguousContinuation ? 99 : 100,
                scoreProjectCandidate(
                  normalizedValue,
                  "labeled_field",
                  context.pageNumber,
                  candidateConfidence,
                  hasAmbiguousContinuation,
                ),
              ),
              candidateConfidence,
              context.source,
            ),
            source: context.source,
            pageNumber: context.pageNumber,
            evidence,
            strongEvidence: !hasAmbiguousContinuation,
            recognitionEngine: context.recognitionEngine,
            projectOrigin: "labeled_field",
            projectAnchorPriority: anchorPriority,
            projectServiceRole,
            confidenceCap: hasAmbiguousContinuation ? 99 : undefined,
            warnings: hasAmbiguousContinuation
              ? [
                  "项目名称锚点后的下一行可能是无标志续行，系统保留锚点原值并触发局部增强复核后重新排序",
                ]
              : undefined,
          });
        }
        if (/合同名称/u.test(anchorMatch[1])) {
          const documentTitleSubject =
            extractProjectSubjectFromDocumentTitle(originalValue);
          if (
            documentTitleSubject &&
            documentTitleSubject !== normalizedValue
          ) {
            candidates.push({
              field: "project_name",
              originalValue: normalizeLine(originalValue),
              normalizedValue: documentTitleSubject,
              ...buildCandidateScoring(
                Math.min(
                  hasAmbiguousContinuation ? 99 : 100,
                  scoreProjectCandidate(
                    documentTitleSubject,
                    "labeled_field",
                    context.pageNumber,
                    candidateConfidence,
                    hasAmbiguousContinuation,
                  ),
                ),
                candidateConfidence,
                context.source,
              ),
              source: context.source,
              pageNumber: context.pageNumber,
              evidence,
              strongEvidence: !hasAmbiguousContinuation,
              recognitionEngine: context.recognitionEngine,
              projectOrigin: "labeled_field",
              confidenceCap: hasAmbiguousContinuation ? 99 : undefined,
              warnings: [
                "项目候选来自合同名称字段，并仅剥离末尾合同或协议文档类型",
              ],
            });
          }
        }
      }

      const meaningfulLinePosition = context.lines
        .slice(0, index + 1)
        .filter((candidate) => candidate.normalized).length;
      if (meaningfulLinePosition <= 8) {
        const isMetadataLine =
          /^(?:(?:(?:第?[一二三四五六七八九十百\d]+)[、.．)）:：]|[（(][一二三四五六七八九十百\d]+[）)])\s*)?(?:信息咨询项目名称|工程项目名称|咨询项目名称|项目[（(]工程[）)]名称|项目名[称标]|工程名称|合同名称|合同(?:类型|类别|金额|总价)|服务内容|业务类型|签订日期|甲方|乙方)\s*[:：]/.test(
            line.normalized,
          );
        const titleMatch = isMetadataLine
          ? null
          : line.normalized.match(
              /^(.{2,140}?)(?:工程咨询服务|项目管理咨询服务|管理咨询服务|技术咨询服务|技术服务|工程咨询|技术咨询|项目管理咨询|管理咨询|咨询服务|服务)?(?:合同(?:及)?(?:补充|变更|追加|终止)?协议(?:书)?|合同书?|补充协议(?:书)?|变更协议(?:书)?|追加协议(?:书)?|续签协议(?:书)?|续租协议(?:书)?|协议(?:书)?)(?:[（(][^（）()]{1,30}[）)])?$/u,
            );
        const titleHasProjectShape = Boolean(
          titleMatch &&
          projectSubjectShapePattern.test(titleMatch[1]) &&
          (LEGACY_PROJECT_SUBJECT_SHAPE_PATTERN.test(titleMatch[1]) ||
            !contextHasExplicitProjectField),
        );
        const preserveCoverServiceSuffix = Boolean(
          titleMatch &&
          context.pageNumber === 1 &&
          hasClosedProcedureProjectServiceSuffix(titleMatch[1]),
        );
        const fallbackCoverTitleSubject =
          isMetadataLine ||
          relationType === "termination" ||
          contextHasExplicitProjectField
            ? null
            : extractProjectCoverTitleSubject(
                line.normalized,
                expectedCategory,
              );
        const normalizedValue = titleMatch
          ? titleHasProjectShape
            ? cleanProjectName(titleMatch[1], {
                preserveServiceSuffix: preserveCoverServiceSuffix,
              })
            : null
          : fallbackCoverTitleSubject;
        const titleWithServiceSubject =
          !isMetadataLine && !contextHasExplicitProjectField
            ? extractProjectSubjectKeepingServiceFromDocumentTitle(
                standaloneBookTitleValue(line.normalized) || line.normalized,
              )
            : null;
        if (normalizedValue) {
          candidates.push({
            field: "project_name",
            originalValue: titleMatch?.[1] || normalizedValue,
            normalizedValue,
            ...buildCandidateScoring(
              scoreProjectCandidate(
                normalizedValue,
                "cover_title",
                context.pageNumber,
                line.confidence,
              ),
              line.confidence,
              context.source,
            ),
            source: context.source,
            pageNumber: context.pageNumber,
            evidence: line.original || line.normalized,
            strongEvidence: false,
            recognitionEngine: context.recognitionEngine,
            projectOrigin: "cover_title",
            projectServiceRole: preserveCoverServiceSuffix
              ? "cover_structure"
              : undefined,
          });
        }
        if (
          titleWithServiceSubject &&
          titleWithServiceSubject !== normalizedValue &&
          relationType !== "termination" &&
          !LEGACY_PROJECT_SUBJECT_SHAPE_PATTERN.test(titleWithServiceSubject) &&
          projectSubjectShapePattern.test(titleWithServiceSubject)
        ) {
          candidates.push({
            field: "project_name",
            originalValue: titleWithServiceSubject,
            normalizedValue: titleWithServiceSubject,
            ...buildCandidateScoring(
              scoreProjectCandidate(
                titleWithServiceSubject,
                "cover_title",
                context.pageNumber,
                line.confidence,
              ),
              line.confidence,
              context.source,
            ),
            source: context.source,
            pageNumber: context.pageNumber,
            evidence: line.original || line.normalized,
            strongEvidence: false,
            recognitionEngine: context.recognitionEngine,
            projectOrigin: "cover_title",
            projectServiceRole: "cover_structure",
            warnings: [
              "首页标题同时保留服务尾词项目候选，由既有排序与安全门禁处理语义冲突",
            ],
          });
        }

        const titleLines: LineContext[] = [];
        for (let offset = 0; offset < 4; offset += 1) {
          const titleLine = context.lines[index + offset];
          if (!titleLine?.normalized) continue;
          if (isStandaloneCoverDocumentIdentifier(titleLine.normalized)) {
            // 条形码流水号可与下一行标题处于同一识别窗口，但不得参与标题
            // 拼接，也不能通过“多档一致”取得项目候选排序优势。
            continue;
          }
          if (offset > 0 && isProjectMetadataBoundary(titleLine.normalized)) {
            break;
          }
          const accumulatedTitle = titleLines
            .map((candidate) => candidate.normalized)
            .join("");
          if (
            accumulatedTitle &&
            (titleLine.normalized.startsWith(accumulatedTitle) ||
              (meaningfulLength(accumulatedTitle) >= 4 &&
                titleLine.normalized.includes(accumulatedTitle)))
          ) {
            // 局部增强裁片可能先返回两段残缺标题，随后又返回同一标题的
            // 完整行。完整行已包含前面全部文字，必须替换残片而不是再次
            // 拼接，否则会形成“璞湾项目咨询服务合璞湾项目”一类重叠值。
            titleLines.splice(0, titleLines.length, titleLine);
          } else {
            titleLines.push(titleLine);
          }
          const combinedTitle = titleLines
            .map((candidate) => candidate.normalized)
            .join("");
          const preservedSupplementalServiceTitleMatch = combinedTitle.match(
            /^(.{2,180}?技术服务)合同及补充协议(?:书)?(?:[（(][^（）()]{1,30}[）)])?$/u,
          );
          const splitTitleMatch =
            preservedSupplementalServiceTitleMatch ||
            combinedTitle.match(
              /^(.{2,180}?)(?:工程咨询服务|技术咨询服务|技术服务|项目管理咨询服务|咨询服务|服务|采购)?(?:合同(?:及)?(?:补充|变更|追加|终止)?协议(?:书)?|合同书?|补充协议(?:书)?|变更协议(?:书)?|追加协议(?:书)?|续签协议(?:书)?|续租协议(?:书)?|协议(?:书)?)(?:[（(][^（）()]{1,30}[）)])?$/u,
            );
          const fallbackSplitTitleValue = splitTitleMatch
            ? null
            : relationType === "termination" || contextHasExplicitProjectField
              ? null
              : extractProjectCoverTitleSubject(
                  combinedTitle,
                  expectedCategory,
                );
          if (!splitTitleMatch && !fallbackSplitTitleValue) continue;
          if (
            (splitTitleMatch &&
              (!projectSubjectShapePattern.test(splitTitleMatch[1]) ||
                (!LEGACY_PROJECT_SUBJECT_SHAPE_PATTERN.test(
                  splitTitleMatch[1],
                ) &&
                  contextHasExplicitProjectField))) ||
            /项目名[称标]|工程名称|合同名称/u.test(
              splitTitleMatch?.[1] || fallbackSplitTitleValue || "",
            )
          ) {
            break;
          }
          const preserveSplitTitleServiceSuffix =
            Boolean(preservedSupplementalServiceTitleMatch) ||
            (context.pageNumber === 1 &&
              Boolean(
                splitTitleMatch?.[1] &&
                hasClosedProcedureProjectServiceSuffix(splitTitleMatch[1]),
              ));
          const splitTitleValue = splitTitleMatch
            ? cleanProjectName(splitTitleMatch[1], {
                preserveServiceSuffix: preserveSplitTitleServiceSuffix,
              })
            : fallbackSplitTitleValue;
          const splitTitleWithServiceValue = !contextHasExplicitProjectField
            ? extractProjectSubjectKeepingServiceFromDocumentTitle(
                standaloneBookTitleValue(combinedTitle) || combinedTitle,
              )
            : null;
          if (splitTitleValue) {
            const titleConfidence = Math.min(
              ...titleLines.map((candidate) => candidate.confidence),
            );
            candidates.push({
              field: "project_name",
              originalValue: normalizeLine(
                splitTitleMatch?.[1] || fallbackSplitTitleValue || "",
              ),
              normalizedValue: splitTitleValue,
              ...buildCandidateScoring(
                scoreProjectCandidate(
                  splitTitleValue,
                  "cover_title",
                  context.pageNumber,
                  titleConfidence,
                ),
                titleConfidence,
                context.source,
              ),
              source: context.source,
              pageNumber: context.pageNumber,
              evidence: titleLines
                .map((candidate) => candidate.original || candidate.normalized)
                .join("\n"),
              strongEvidence: context.pageNumber === 1,
              recognitionEngine: context.recognitionEngine,
              projectOrigin: "cover_title",
              projectServiceRole: preserveSplitTitleServiceSuffix
                ? "cover_structure"
                : undefined,
            });
          }
          if (
            splitTitleWithServiceValue &&
            splitTitleWithServiceValue !== splitTitleValue &&
            relationType !== "termination" &&
            !LEGACY_PROJECT_SUBJECT_SHAPE_PATTERN.test(
              splitTitleWithServiceValue,
            ) &&
            projectSubjectShapePattern.test(splitTitleWithServiceValue)
          ) {
            const titleConfidence = Math.min(
              ...titleLines.map((candidate) => candidate.confidence),
            );
            candidates.push({
              field: "project_name",
              originalValue: splitTitleWithServiceValue,
              normalizedValue: splitTitleWithServiceValue,
              ...buildCandidateScoring(
                scoreProjectCandidate(
                  splitTitleWithServiceValue,
                  "cover_title",
                  context.pageNumber,
                  titleConfidence,
                ),
                titleConfidence,
                context.source,
              ),
              source: context.source,
              pageNumber: context.pageNumber,
              evidence: titleLines
                .map((candidate) => candidate.original || candidate.normalized)
                .join("\n"),
              strongEvidence: false,
              recognitionEngine: context.recognitionEngine,
              projectOrigin: "cover_title",
              projectServiceRole: "cover_structure",
              warnings: [
                "首页跨行标题同时保留服务尾词项目候选，由既有排序与安全门禁处理语义冲突",
              ],
            });
          }
          break;
        }
      }

      const entrustedProjectWindow = context.lines
        .slice(index, index + 4)
        .map((candidate) => candidate.normalized)
        .filter(Boolean)
        .join("");
      const entrustedProjectMatch = entrustedProjectWindow.match(
        /(?:甲方|委托方)?委托(?:乙方|受托方)(?:开展|进行|承担|完成)[“"]([^”"]{4,120}(?:项目|工程)[^”"]*)[”"](?:项目|工程)?/u,
      );
      const directEntrustedProjectMatch = entrustedProjectMatch
        ? null
        : entrustedProjectWindow.match(
            /(?:甲方|委托方)?委托(?:乙方|受托方)就([^，。]{4,160}?)(?:项目进行|进行的专项)/u,
          );
      const entrustedProjectValue =
        entrustedProjectMatch?.[1] || directEntrustedProjectMatch?.[1];
      if (entrustedProjectValue) {
        const entrustedProjectOrigin = entrustedProjectMatch
          ? "labeled_field"
          : "body_description";
        const preserveEntrustedServiceSuffix =
          shouldPreserveProjectServiceSuffix(entrustedProjectValue, contexts);
        const normalizedValue = cleanProjectName(entrustedProjectValue, {
          // 正文“委托乙方就……项目进行”能够提供项目候选，但“咨询服务／
          // 技术服务”也可能只是合同服务类型。只有首页标题呈现同一双层服务
          // 结构时才保留该后缀，避免正文服务范围扩写项目名称。
          preserveServiceSuffix: preserveEntrustedServiceSuffix,
        });
        if (normalizedValue) {
          candidates.push({
            field: "project_name",
            originalValue: normalizeLine(entrustedProjectValue),
            normalizedValue,
            ...buildCandidateScoring(
              scoreProjectCandidate(
                normalizedValue,
                entrustedProjectOrigin,
                context.pageNumber,
                line.confidence,
              ),
              line.confidence,
              context.source,
            ),
            source: context.source,
            pageNumber: context.pageNumber,
            evidence: entrustedProjectWindow,
            strongEvidence: true,
            recognitionEngine: context.recognitionEngine,
            projectOrigin: entrustedProjectOrigin,
            projectServiceRole: preserveEntrustedServiceSuffix
              ? "body_corroboration"
              : undefined,
            confidenceCap: directEntrustedProjectMatch ? 99 : undefined,
          });
        }
      }

      const explicitBodyProjectValue = referencedNonMainProjectValue
        ? null
        : projectBodyDescriptionValue(entrustedProjectWindow, expectedCategory);
      if (
        explicitBodyProjectValue &&
        explicitBodyProjectValue !== entrustedProjectValue
      ) {
        const bodyLines = context.lines.slice(index, index + 4);
        const bodyConfidence = Math.min(
          ...bodyLines.map((candidate) => candidate.confidence),
        );
        candidates.push({
          field: "project_name",
          originalValue: explicitBodyProjectValue,
          normalizedValue: explicitBodyProjectValue,
          ...buildCandidateScoring(
            scoreProjectCandidate(
              explicitBodyProjectValue,
              "body_description",
              context.pageNumber,
              bodyConfidence,
            ),
            bodyConfidence,
            context.source,
          ),
          source: context.source,
          pageNumber: context.pageNumber,
          evidence: entrustedProjectWindow,
          strongEvidence: false,
          recognitionEngine: context.recognitionEngine,
          projectOrigin: "body_description",
          confidenceCap: 99,
          warnings: [
            "项目候选来自正文中具有明确前后边界的服务对象描述，仅进入候选排序",
          ],
        });
      }

      const originalContractWindow = context.lines
        .slice(index, index + 10)
        .map((candidate) => candidate.normalized)
        .filter(Boolean)
        .join("");
      const originalContractTitleMatch = originalContractWindow.match(
        /(?:签署|签订).{0,100}?合同编号.{0,80}?《([^》]{6,220}?(?:合同|协议(?:书)?))\s*》.{0,40}?(?:以下简称|简称)[“”"']?原合同/u,
      );
      if (originalContractTitleMatch?.[1] && relationType !== "termination") {
        const normalizedValue = cleanProjectName(originalContractTitleMatch[1]);
        if (
          normalizedValue &&
          /(?:项目|工程|千伏|变电站|线路|不动产|许可证|检测|鉴定|手续|采购|购置)/u.test(
            normalizedValue,
          )
        ) {
          candidates.push({
            field: "project_name",
            originalValue: normalizeLine(originalContractTitleMatch[1]),
            normalizedValue,
            ...buildCandidateScoring(
              scoreProjectCandidate(
                normalizedValue,
                "body_description",
                context.pageNumber,
                line.confidence,
              ),
              line.confidence,
              context.source,
            ),
            source: context.source,
            pageNumber: context.pageNumber,
            evidence: originalContractWindow,
            strongEvidence: false,
            recognitionEngine: context.recognitionEngine,
            projectOrigin: "body_description",
            confidenceCap: 99,
            warnings: [
              "项目名称来自正文明确引用的原合同标题，已进入项目候选自动排序",
            ],
          });
        }
      }
    }
  }
  appendDamagedProjectServiceFusionCandidates(contexts, candidates);
  if (diagnostics) {
    diagnostics.generatedCandidates = [...candidates];
  }
  const isFrameworkAgreement = contexts.some((context) =>
    /(?:服务框架采购|框架采购协议|采购框架协议|咨询服务框架)/u.test(
      context.text.replace(/\s+/g, ""),
    ),
  );
  if (!isFrameworkAgreement) return candidates;
  return candidates.filter(
    (candidate) =>
      candidate.projectOrigin === "labeled_field" &&
      /(?:\d{2,4}(?:千伏|[kK][vV])|项目|工程|变电站|线路|不动产|许可证|检测|鉴定)/u.test(
        candidate.normalizedValue,
      ),
  );
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  二: 2,
  贰: 2,
  貳: 2,
  两: 2,
  兩: 2,
  三: 3,
  参: 3,
  叁: 3,
  參: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  陸: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};

function parseChineseInteger(value: string): number | null {
  const smallUnits: Record<string, number> = {
    十: 10,
    拾: 10,
    百: 100,
    佰: 100,
    千: 1_000,
    仟: 1_000,
  };
  const largeUnits: Record<string, number> = {
    万: 10_000,
    萬: 10_000,
    亿: 100_000_000,
    億: 100_000_000,
    兆: 1_000_000_000_000,
  };
  let total = 0;
  let section = 0;
  let digit: number | null = null;
  let recognized = false;

  for (const character of value) {
    if (character in CHINESE_DIGITS) {
      digit = CHINESE_DIGITS[character];
      recognized = true;
      continue;
    }
    if (character in smallUnits) {
      section += (digit == null ? 1 : digit) * smallUnits[character];
      digit = null;
      recognized = true;
      continue;
    }
    if (character in largeUnits) {
      section += digit || 0;
      total += section * largeUnits[character];
      section = 0;
      digit = null;
      recognized = true;
    }
  }
  if (!recognized) return null;
  return total + section + (digit || 0);
}

/** 将中文大写人民币金额转换为元。 */
export function parseChineseUppercaseAmount(value: string): number | null {
  const normalized = toHalfWidth(value)
    .replace(/人民币|大写|\s|[()（）:：]/g, "")
    .replace(/任/g, "仟")
    .replace(/圆|圓/g, "元")
    .replace(/[整正]$/g, "");
  const negative = normalized.startsWith("负");
  const unsigned = normalized.replace(/^负/, "");
  const yuanIndex = unsigned.indexOf("元");
  const integerText = yuanIndex >= 0 ? unsigned.slice(0, yuanIndex) : unsigned;
  if (
    // “38万元整”中的“万元整”会被中文金额扫描表达式单独命中，但它
    // 没有任何中文数字或十／百／千位，不能再被解析成 0 元候选。
    // “拾万元整”包含合法的“拾”位，仍然允许省略前导“壹”。
    !/[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟]/.test(
      integerText,
    )
  ) {
    return null;
  }
  const integer = parseChineseInteger(integerText);
  if (integer == null || !Number.isFinite(integer)) return null;
  const fractionText = yuanIndex >= 0 ? unsigned.slice(yuanIndex + 1) : "";
  const jiaoMatch = fractionText.match(
    /([零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖])角/,
  );
  const fenMatch = fractionText.match(
    /([零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖])分/,
  );
  const amount =
    integer +
    (jiaoMatch ? CHINESE_DIGITS[jiaoMatch[1]] / 10 : 0) +
    (fenMatch ? CHINESE_DIGITS[fenMatch[1]] / 100 : 0);
  return negative ? -amount : amount;
}

function normalizeAmount(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function compactMoneyText(value: string): string {
  return toHalfWidth(value)
    .replace(/_+/g, "")
    .replace(/(?<=\d)\s+(?=[\d.,，])/g, "")
    .replace(/(?<=[.,，])\s+(?=\d)/g, "")
    .replace(
      /(?<=[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟任万萬亿億元圆圓角分])\s+(?=[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟任万萬亿億元圆圓角分整正])/g,
      "",
    );
}

function extractMoneyValues(
  value: string,
  allowUnitless = false,
): Array<{
  originalValue: string;
  normalizedValue: string;
  kind: "arabic_amount" | "chinese_amount";
  /** 在金额空白规范化后的输入中的起始位置，用于区分重复金额文本。 */
  startIndex: number;
}> {
  const results: Array<{
    originalValue: string;
    normalizedValue: string;
    kind: "arabic_amount" | "chinese_amount";
    startIndex: number;
  }> = [];
  const compacted = compactMoneyText(value);
  const numericPattern =
    /((?:人民币\s*)?(?:[￥¥]\s*)?)([-－]?\s*(?:\d{1,3}(?:[,，]\d{3})+|\d+)(?:\.\d{1,2})?)\s*(万元|万|元)?/g;
  for (const match of compacted.matchAll(numericPattern)) {
    const currencyMarker = match[1].trim();
    const unit = match[3] || "";
    if (!unit && !currencyMarker && !allowUnitless) continue;
    const number = Number(match[2].replace(/[，,\s]/g, "").replace("－", "-"));
    if (!Number.isFinite(number)) continue;
    const multiplier = unit === "万元" || unit === "万" ? 10_000 : 1;
    const amount = number * multiplier;
    if (Math.abs(amount) > 1_000_000_000_000_000) continue;
    results.push({
      originalValue: match[0].trim(),
      normalizedValue: normalizeAmount(amount),
      kind: "arabic_amount",
      startIndex: match.index || 0,
    });
  }

  const chinesePattern =
    /(?:人民币\s*)?(?:负)?[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟任万萬亿億兆元圆圓角分整正]+/g;
  for (const match of compacted.matchAll(chinesePattern)) {
    // “一次性付清”“三天内”等普通数量词可能与合同金额处于同一子句。
    // 只有出现人民币、财务大写字符、金额单位或数量级时，才把中文数字串
    // 作为金额；孤立的“一、三”等不得形成 1 元、3 元的伪冲突候选。
    if (
      !/(?:人民币|[壹贰貳兩参叁參肆伍陆陸柒捌玖拾佰仟任]|[万萬亿億兆元圆圓角分整正])/.test(
        match[0],
      )
    ) {
      continue;
    }
    // 识别被截断时常只剩“贰拾玖万肆任伍”一类不完整大写串。缺少
    // 元、角、分或“整”等金额终止单位时，无法判断末尾位权，禁止把它
    // 解析成 294005 元并与同页完整的 294500 元形成伪冲突。
    if (!/[元圆圓角分整正]$/.test(match[0])) continue;
    const amount = parseChineseUppercaseAmount(match[0]);
    if (amount == null || Math.abs(amount) > 1_000_000_000_000_000) continue;
    results.push({
      originalValue: match[0].trim(),
      normalizedValue: normalizeAmount(amount),
      kind: "chinese_amount",
      startIndex: match.index || 0,
    });
  }
  return results;
}

/**
 * 特别约定只有在当前金额条款本身明确把冲突解决规则指向金额、价款等财务
 * 概念时才具有候选排序优先级。不得从前文其他主题的通用优先条款继承。
 */
function hasExplicitSpecialAmountPrecedence(value: string): boolean {
  const clause = normalizeLine(value).replace(/\s+/g, "");
  return (
    /特别约定/.test(clause) &&
    /(?:不一致|冲突)[^。；;]{0,40}(?:以)?(?:本)?(?:特别约定|本条|本款)(?:中|内|的)?[^。；;]{0,12}(?:金额|价款|总价|费用|报酬)[^。；;]{0,6}为准/.test(
      clause,
    )
  );
}

/** 判断字段锚点是否被“原合同／前次／历史／变更前”等限定为历史事实。 */
function hasHistoricalQualifierBeforeAnchor(
  value: string,
  anchorIndex: number,
  includeSettled = false,
): boolean {
  const prefix = normalizeLine(value)
    .slice(0, anchorIndex)
    .split(/[。；;]/)
    .at(-1)
    ?.replace(/\s+/g, "");
  if (!prefix) return false;
  const qualifier = includeSettled
    ? /(?:原|原合同|原协议|前次|上次|上一份|历史|变更前|调整前|已结算)$/
    : /(?:原|原合同|原协议|前次|上次|上一份|历史|变更前|调整前)$/;
  return qualifier.test(prefix);
}

function amountRolePriority(role: InternalCandidate["amountRole"]): number {
  switch (role) {
    case "contract_total":
      return 100;
    case "contract_amount":
      return 100;
    case "generic_total":
      return 75;
    case "service_fee":
      return 35;
    case "payment_amount":
      return 25;
    case "tax_amount":
      return 20;
    case "unit_price":
      return 15;
    case "original_amount":
    case "final_amount":
      return 10;
    case "relation_adjustment":
      return 110;
    default:
      return 0;
  }
}

function classifyAmountRole(
  line: string,
  anchorText: string,
  anchorIndex: number,
  isHistoricalAmount: boolean,
): InternalCandidate["amountRole"] {
  const normalizedLine = normalizeLine(line);
  const compacted = normalizedLine.replace(/\s+/g, "");
  const clausePrefix = normalizedLine
    .slice(0, anchorIndex)
    .split(/[。；;，,]/)
    .at(-1)
    ?.replace(/\s+/g, "");
  const roleContext = `${clausePrefix || ""}${anchorText}`.replace(/\s+/g, "");
  if (
    isHistoricalAmount ||
    /(?:原合同|原协议|变更前|调整前)/.test(clausePrefix || "")
  ) {
    return "original_amount";
  }
  if (
    /(?:变更后|调整后|最终|现合同|新的合同)(?:总)?(?:金额|总额|价款)|合同(?:总)?金额(?:相应)?(?:变更|调整)为/.test(
      compacted,
    )
  ) {
    return "final_amount";
  }
  if (
    /付款金额|付款总金额|预付款|进度款|已付款|回款金额|付款节点/.test(
      roleContext,
    ) ||
    // “支付合同金额的50%，即人民币……”描述的是付款节点，不是把后续
    // 金额重新声明为合同总额。局部增强裁片有时只保留“合同金额的50%”，
    // 因而比例结构本身也必须降为付款金额。
    /合同(?:总)?金额(?:的)?\d+(?:\.\d+)?%/u.test(compacted) ||
    /合同(?:总)?金额(?:的)?百分之[零〇一二三四五六七八九十百千万两]+/u.test(
      compacted,
    )
  ) {
    return "payment_amount";
  }
  if (/税额|税费|税款/.test(roleContext)) return "tax_amount";
  if (/单价|每(?:项|个|份|套|次).{0,8}(?:金额|费用|价格)/.test(roleContext)) {
    return "unit_price";
  }
  if (
    /收费金额|各项费用合计|费用共计/u.test(anchorText) &&
    /(?:每|[/／])(?:年|半年|季度|月|次|项|个|份|套)/u.test(compacted)
  ) {
    return "unit_price";
  }
  if (
    /各项费用合计|费用共计/u.test(anchorText) &&
    /(?:费用组成|大写)/u.test(compacted)
  ) {
    return "contract_total";
  }
  if (/收费金额|各项费用合计|费用共计/u.test(anchorText)) {
    return "service_fee";
  }
  if (
    /^(?:含税总价|含税金额|价税合计)$/u.test(anchorText) &&
    /(?:本合同|本协议|合同(?:价款|金额|总额)|协议(?:价款|金额|总额))(?:的|之)?$/u.test(
      clausePrefix || "",
    )
  ) {
    return "contract_total";
  }
  if (
    /合同总额|合同总金额|合同总价|合同价款|签约金额|项目金额|协议总金额|合同费用总额|(?:咨询服务费|技术服务费|咨询费|顾问费|服务费)?总价款|服务费(?:用)?(?:总额|合计)|报酬总额/.test(
      anchorText,
    )
  ) {
    return "contract_total";
  }
  if (
    /含税合同金额|合同含税金额|本(?:合同|协议)含税金额|合同金额|合同价格|协议金额/.test(
      anchorText,
    )
  ) {
    return "contract_amount";
  }
  if (
    /服务费/.test(anchorText) &&
    !/(?:本合同|本协议).{0,8}服务费(?:用)?(?:总额|合计)|服务费(?:用)?(?:总额|合计)/.test(
      compacted,
    )
  ) {
    return "service_fee";
  }
  return "generic_total";
}

function amountRoleBaseScore(role: InternalCandidate["amountRole"]): number {
  switch (role) {
    case "contract_total":
      return 98;
    case "contract_amount":
      return 96;
    case "generic_total":
      return 84;
    case "service_fee":
      return 58;
    case "payment_amount":
    case "tax_amount":
    case "unit_price":
      return 45;
    case "original_amount":
    case "final_amount":
      return 55;
    default:
      return 50;
  }
}

function collectAmountCandidates(
  contexts: readonly SourceContext[],
): InternalCandidate[] {
  const candidates: InternalCandidate[] = [];
  const strongAnchor =
    /含税合同金额|合同含税金额|本(?:合同|协议)含税金额|服务费用(?:总额|合计)|各项费用合计|费用共计|收费金额|合同总额|合同总价|合同总金额|合同金额|合同价格|含税总价|(?<!不)含税金额|合同价款|签约金额|项目金额|价税合计|协议总金额|本协议金额|协议金额|合同费用总额|本合同费用(?:为|是)?|合同费用(?:为|是)|本次(?:技术咨询|技术服务|咨询服务)?总费用|(?:技术咨询|技术服务|咨询服务)总费用|(?:咨询服务费|技术服务费|咨询费|顾问费|服务费)?总价款|技术服务报酬总额|服务报酬总额|报酬总额|付款金额|预付款|进度款|税额|税费|税款|服务费(?:总额|合计)?|单价|每(?:项|个|份|套|次).{0,8}(?:金额|费用|价格)/gu;
  const secondaryAnchor = /总价|总金额|总费用|价款|人民币\s*[（(]?大写/gu;

  for (const context of contexts) {
    for (let index = 0; index < context.lines.length; index += 1) {
      const line = context.lines[index];
      const strongMatches = [...line.normalized.matchAll(strongAnchor)];
      const anchorMatches =
        strongMatches.length > 0
          ? strongMatches.map((match) => ({ match, isStrong: true }))
          : [...line.normalized.matchAll(secondaryAnchor)].map((match) => ({
              match,
              isStrong: false,
            }));
      if (anchorMatches.length === 0) continue;
      for (
        let anchorPosition = 0;
        anchorPosition < anchorMatches.length;
        anchorPosition += 1
      ) {
        const currentAnchor = anchorMatches[anchorPosition];
        const strongMatch = currentAnchor.isStrong ? currentAnchor.match : null;
        const secondaryMatch = currentAnchor.isStrong
          ? null
          : currentAnchor.match;
        const isStrong = currentAnchor.isStrong;
        const strongAnchorText = strongMatch?.[0] || "";
        const strongAnchorIndex = strongMatch?.index || 0;
        const strongAnchorClausePrefix = line.normalized
          .slice(0, strongAnchorIndex)
          .split(/[。；;]/)
          .at(-1)
          ?.replace(/\s+/g, "");
        const isBareTaxTotalAnchor = /^(?:含税总价|含税金额|价税合计)$/u.test(
          strongAnchorText,
        );
        const hasWholeContractScopeBeforeBareTotal =
          isBareTaxTotalAnchor &&
          /(?:本合同|本协议|合同(?:价款|金额|总额)|协议(?:价款|金额|总额))(?:的|之)?$/u.test(
            strongAnchorClausePrefix || "",
          );
        const isExplicitContractTotal =
          isStrong &&
          (!isBareTaxTotalAnchor || hasWholeContractScopeBeforeBareTotal);
        const requiresManualTotalScopeConfirmation =
          isStrong && isBareTaxTotalAnchor && !isExplicitContractTotal;
        const isHistoricalAmount = hasHistoricalQualifierBeforeAnchor(
          line.normalized,
          strongMatch?.index ?? secondaryMatch?.index ?? 0,
          true,
        );
        let amountRole = classifyAmountRole(
          line.normalized,
          strongAnchorText || secondaryMatch?.[0] || "",
          strongMatch?.index ?? secondaryMatch?.index ?? 0,
          isHistoricalAmount,
        );

        const anchorMatch = strongMatch || secondaryMatch;
        const nextAnchorIndex =
          anchorMatches[anchorPosition + 1]?.match.index ??
          line.normalized.length;
        const afterAnchor = line.normalized.slice(
          (anchorMatch?.index || 0) + (anchorMatch?.[0].length || 0),
          nextAnchorIndex,
        );
        const immediateClause = afterAnchor
          .split(/[；;。]/)[0]
          .split(/(?:，|,)?\s*其\s*中/u)[0]
          .split(
            /(?:[（(，,]\s*)?(?:不含税金额|未税金额|不含税价|未税价)\s*[:：]?/u,
          )[0];
        const isSpecialOverrideAmount = hasExplicitSpecialAmountPrecedence(
          line.normalized,
        );
        if (
          !isSpecialOverrideAmount &&
          /按实际|据实结算|以.+为准|另行协商|金额待定|暂未确定|待双方|详见|结算单为准|审计结果为准/.test(
            immediateClause,
          )
        ) {
          continue;
        }
        if (
          /(?:百分之|千分之|万分之)[零〇一二三四五六七八九十百千万壹贰貳两兩参叁參肆伍陆陸柒捌玖拾佰仟\d.]+/u.test(
            immediateClause,
          ) &&
          !/(?:人民币|[￥¥]|\d[\d,，]*(?:\.\d{1,2})?\s*(?:万元|元)|[壹贰貳兩参叁參肆伍陆陸柒捌玖拾佰仟万萬亿億元圆圓]+(?:元|圆|圓))/u.test(
            immediateClause,
          )
        ) {
          continue;
        }
        const clauseParts = [immediateClause];
        const evidenceLines = [line.original || line.normalized];
        let candidateConfidence = line.confidence;
        let candidateText = immediateClause;
        let amounts = extractMoneyValues(candidateText);
        const needsContinuation = (value: string) => {
          const compacted = compactMoneyText(value).replace(/\s+/g, "");
          const endsWithSplitArabicAmount =
            hasUnclosedParenthesis(compacted) &&
            /[￥¥][-－]?(?:\d[\d,，]*(?:\.\d{0,2})?)?$/.test(compacted);
          const endsWithSplitChineseAmount =
            /(?:人民币)?(?:[（(]?大写[）)]?)?[：:]?[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟任万萬亿億兆]+$/.test(
              compacted,
            ) && !/[元圆圓整正]$/.test(compacted);
          return endsWithSplitArabicAmount || endsWithSplitChineseAmount;
        };
        // 只有总额锚点后的当前子句尚未出现任何金额时，才允许读取后续行。
        // 一旦已取得总额即停止，避免把“其中”的未税额、税额或分项金额重新
        // 拼成竞争总额候选。若当前行明显在金额中间断行，则继续拼到金额完整。
        if (amounts.length === 0 || needsContinuation(candidateText)) {
          for (let offset = 1; offset <= 2; offset += 1) {
            const continuation = context.lines[index + offset];
            if (!continuation) break;
            if (!continuation.normalized) continue;
            const awaitingAmountCompletion = needsContinuation(candidateText);
            const startsWithAmountFragment =
              /^(?:\d[\d,，.]|[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟任万萬亿億兆])/u.test(
                continuation.normalized,
              );
            if (
              (!awaitingAmountCompletion || !startsWithAmountFragment) &&
              /^(?:其\s*中|不\s*含税|税(?:额|率|费)|分项|明细|序号|[（(]?\d+[）).、]|(?:合同|协议|项目|甲方|乙方|第[一二三四五六七八九十]+条))/u.test(
                continuation.normalized,
              )
            ) {
              break;
            }
            const continuationClause = continuation.normalized
              .split(/[；;。]/)[0]
              .split(/(?:，|,)?\s*其\s*中/u)[0];
            if (!continuationClause) break;
            clauseParts.push(continuationClause);
            evidenceLines.push(
              continuation.original || continuation.normalized,
            );
            candidateConfidence = Math.min(
              candidateConfidence,
              continuation.confidence,
            );
            candidateText = clauseParts.join(" ");
            amounts = extractMoneyValues(candidateText);
            if (
              (amounts.length > 0 && !needsContinuation(candidateText)) ||
              /[。；;]/.test(continuation.normalized)
            ) {
              break;
            }
          }
        }
        if (
          amounts.length === 0 &&
          isStrong &&
          /^(?:含税合同金额|合同含税金额|本(?:合同|协议)含税金额|合同总额|合同总价|合同总金额|合同金额|合同价格|合同价款|协议总金额|本协议金额|协议金额)$/u.test(
            strongAnchorText,
          )
        ) {
          const unitlessText = compactMoneyText(candidateText)
            .replace(/^[\s:：=]+/u, "")
            .trim();
          if (
            /^[-－]?(?:\d{1,3}(?:[,，]\d{3})+|\d{3,})(?:\.\d{1,2})?$/u.test(
              unitlessText,
            )
          ) {
            amounts = extractMoneyValues(unitlessText, true);
          }
        }
        const nextLine = context.lines[index + 1];
        const hasChineseAmount = amounts.some(
          (amount) => amount.kind === "chinese_amount",
        );
        const hasArabicAmount = amounts.some(
          (amount) => amount.kind === "arabic_amount",
        );
        // 扫描合同常把“人民币（大写）……元整”留在总额锚点行，而把与其
        // 对应的“（￥394000.00）（含税）”排到下一行。中文金额完整时上方
        // 通用续行会停止，但合同金额又只能采用阿拉伯数字，因而会出现
        // “原文存在金额事实却没有候选”。这里只允许下一行从括号货币数字
        // 开始，并在“其中／不含税”前截断；未税额和税额绝不能冒充总额。
        if (
          hasChineseAmount &&
          !hasArabicAmount &&
          nextLine?.normalized &&
          /^\s*[（(]\s*[￥¥]\s*[-－]?\d[\d,，]*(?:\.\d{1,2})?\s*[）)]/u.test(
            nextLine.normalized,
          )
        ) {
          const leadingArabicTotal = nextLine.normalized
            .split(/(?:，|,)?\s*其\s*中/u)[0]
            .split(
              /(?:[（(，,]\s*)?(?:不含税金额|未税金额|不含税价|未税价)\s*[:：]?/u,
            )[0];
          const crossFormatText = `${candidateText} ${leadingArabicTotal}`;
          const crossFormatAmounts = extractMoneyValues(crossFormatText);
          const chineseValues = new Set(
            crossFormatAmounts
              .filter((amount) => amount.kind === "chinese_amount")
              .map((amount) => amount.normalizedValue),
          );
          const arabicValues = crossFormatAmounts
            .filter((amount) => amount.kind === "arabic_amount")
            .map((amount) => amount.normalizedValue);
          const beforeBreakdown =
            nextLine.normalized.split(/(?:，|,)?\s*其\s*中/u)[0];
          const hasDisallowedAmountRole =
            /(?:不含税|未税|预付款|进度款|付款|税额|税费|单价)/u.test(
              beforeBreakdown,
            );
          const explicitlyTaxInclusive =
            !hasDisallowedAmountRole &&
            /[）)]\s*[（(]\s*含税\s*[）)]/u.test(beforeBreakdown);
          const chineseAndArabicAgree = arabicValues.some((value) =>
            chineseValues.has(value),
          );
          if (
            arabicValues.length > 0 &&
            !hasDisallowedAmountRole &&
            (explicitlyTaxInclusive || chineseAndArabicAgree)
          ) {
            amounts = crossFormatAmounts;
            candidateText = crossFormatText;
            evidenceLines.push(nextLine.original || nextLine.normalized);
            candidateConfidence = Math.min(
              candidateConfidence,
              nextLine.confidence,
            );
          }
        }
        if (
          /收费金额|各项费用合计|费用共计/u.test(strongAnchorText) &&
          /(?:每|[/／])(?:年|半年|季度|月|次|项|个|份|套)/u.test(candidateText)
        ) {
          amountRole = "unit_price";
        }
        if (
          nextLine?.normalized &&
          !amounts.some((amount) => amount.kind === "chinese_amount") &&
          /^(?:人民币)?\s*(?:[（(]?大写[）)]?)?\s*[:：]?\s*(?:人民币)?[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟任万萬亿億兆]/u.test(
            nextLine.normalized,
          )
        ) {
          const crossFormatText = `${candidateText} ${nextLine.normalized}`;
          const crossFormatAmounts = extractMoneyValues(crossFormatText);
          if (
            crossFormatAmounts.some(
              (amount) => amount.kind === "chinese_amount",
            )
          ) {
            amounts = crossFormatAmounts;
            candidateText = crossFormatText;
            evidenceLines.push(nextLine.original || nextLine.normalized);
            candidateConfidence = Math.min(
              candidateConfidence,
              nextLine.confidence,
            );
          }
        }
        // 合同金额只采用阿拉伯数字。中文大写常因印章、字体或扫描噪声把
        // “仟”误成“任”等字符；即使位于金额标题附近，也不得独立形成
        // 候选并与正文明确的数字总额制造伪冲突。
        for (const amount of amounts.filter(
          (item) => item.kind === "arabic_amount",
        )) {
          candidates.push({
            field: "amount",
            originalValue: amount.originalValue,
            normalizedValue: amount.normalizedValue,
            ...buildCandidateScoring(
              scoreWithSource(
                amountRoleBaseScore(amountRole) +
                  (context.pageNumber === 1 &&
                  amountRolePriority(amountRole) >= 75
                    ? 1
                    : 0),
                candidateConfidence,
              ),
              candidateConfidence,
              context.source,
            ),
            source: context.source,
            pageNumber: context.pageNumber,
            evidence: evidenceLines.join("\n"),
            kind: amount.kind,
            strongEvidence:
              isStrong &&
              amountRolePriority(amountRole) >= 75 &&
              !requiresManualTotalScopeConfirmation,
            recognitionEngine: context.recognitionEngine,
            precedence: isSpecialOverrideAmount ? 10 : 0,
            amountRole,
            explicitContractTotal:
              isExplicitContractTotal && amountRolePriority(amountRole) >= 95,
            verificationRole: isHistoricalAmount
              ? "historical_amount"
              : isExplicitContractTotal && amountRolePriority(amountRole) >= 95
                ? "current_contract_total"
                : "generic_amount",
            confidenceCap: requiresManualTotalScopeConfirmation
              ? 99
              : undefined,
            warnings: requiresManualTotalScopeConfirmation
              ? [
                  "仅识别到未明确指向整份合同的含税总价、含税金额或价税合计，已降低金额角色权重并进入自动复核排序",
                ]
              : undefined,
          });
        }
      }
    }
  }
  return candidates;
}

export function calculateContractLeaseMonthCount(
  startDate: string,
  endDate: string,
): number | null {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  ) {
    return null;
  }
  const difference =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth();
  // 同日到下一周年是整12个月，不能把首尾月份重复计成13个月；结束日仅在
  // 严格晚于起始日时才补计当前自然月。既有“1月1日至12月31日”及
  // “6月16日至次年6月15日”等含首尾日租期仍保持12个月。
  const months = difference + (end.getUTCDate() > start.getUTCDate() ? 1 : 0);
  return months > 0 && months <= 1200 ? months : null;
}

/**
 * 固定月租资产租赁合同专用事实提取：支持房屋、场地、停车位和车辆租赁，
 * 只读取合同正文，排除收据、押金、保证金、保险保额、违约金和付款凭证；
 * 正文有租金总额时优先采用，否则按优惠后每月租赁费用或月租金乘实际租赁
 * 月数形成合同租金总额。无法取得期限时才按一年 12 个月兜底。
 */
export function extractContractLeaseTerms(
  text: string,
  expectedCategory?: ParseContractTextOptions["expectedCategory"],
): ContractLeaseTerms {
  const normalized = toHalfWidth(text || "").replace(/\r/g, "");
  const isRentalLease =
    expectedCategory === "asset" &&
    /房屋(?:及场地)?租赁(?:合同|协议)|租赁合同|(?:停车场)?车位租赁(?:合同|协议)?|(?:公司租个人小客车|小客车租赁|车辆租赁|汽车租赁)(?:合同|协议)?|出租方.{0,80}承租方/su.test(
      normalized,
    );
  const empty: ContractLeaseTerms = {
    isRentalLease,
    leaseStartDate: null,
    leaseEndDate: null,
    monthlyRent: null,
    monthlyPropertyManagementFee: null,
    termMonths: null,
    totalAmount: null,
    amountSource: null,
  };
  if (!isRentalLease) return empty;

  // 扫描合同经常会在年份、月份之间换行，例如“至2027\n年6月15日”。
  // 租赁期限属于同一语义句，日期和期限月数应在合并换行后的正文中提取。
  const continuousText = normalized.replace(/\n+/g, " ");
  let dates: ReturnType<typeof extractDates> = [];
  for (const anchor of continuousText.matchAll(/租赁期限|租期|租赁期/gu)) {
    const scope = continuousText.slice(anchor.index, anchor.index + 240);
    const scopedDates = extractDates(scope);
    if (scopedDates.length >= 2) {
      dates = scopedDates;
      break;
    }
  }
  const leaseStartDate = dates[0]?.normalizedValue || null;
  const leaseEndDate = dates[1]?.normalizedValue || null;
  const explicitMonths = continuousText.match(
    /(?:租赁期限|租期|租赁期)[^。；]{0,120}?(?:共计|共|为)\s*(\d{1,3})\s*个?月/u,
  );
  const explicitYears = continuousText.match(
    /(?:租赁期限|租期|租赁期)[^。；]{0,120}?(?:共计|共|为)\s*(\d{1,2})\s*年/u,
  );
  const termMonths = explicitMonths
    ? Number(explicitMonths[1])
    : explicitYears
      ? Number(explicitYears[1]) * 12
      : leaseStartDate && leaseEndDate
        ? calculateContractLeaseMonthCount(leaseStartDate, leaseEndDate)
        : null;

  const lines = normalized
    .split(/\n+/)
    .map((line) => normalizeLine(line))
    .filter(
      (line) =>
        line &&
        !/(?:收据|收款收据|银行回单|付款凭证|押金|保证金|定金|违约金)/u.test(
          line,
        ),
    );
  const findAmounts = (pattern: RegExp, excludedPattern?: RegExp): number[] => {
    for (const line of lines) {
      if (excludedPattern?.test(line)) continue;
      const match = line.match(pattern);
      if (!match) continue;
      return extractMoneyValues(
        line.slice((match.index || 0) + match[0].length),
      )
        .map((candidate) => Number(candidate.normalizedValue))
        .filter((amount) => Number.isFinite(amount) && amount > 0);
    }
    return [];
  };
  const findAmount = (
    pattern: RegExp,
    excludedPattern?: RegExp,
  ): number | null => findAmounts(pattern, excludedPattern)[0] ?? null;
  const installmentOrDepositPattern =
    /首期|首笔|首付款|预付款|本期|第[一二三四五六七八九十\d]+期|分期|收据|银行回单|付款凭证|押金|保证金|定金/u;
  const explicitCombinedTotal = findAmount(
    /(?:合同(?:总费用|费用总额|总金额)|租金(?:及|与)物业(?:管理)?费(?:总额|总计|合计)|租赁期内租金(?:及|与)物业(?:管理)?费(?:总额|总计|合计))(?:为|共计|合计)?/u,
    installmentOrDepositPattern,
  );
  const explicitRentTotal = findAmount(
    /(?:租赁期内)?租金(?:总额|总计|合计)|租赁费用(?:总额|总计|合计)|合同租金总额/u,
    installmentOrDepositPattern,
  );
  // 正式租赁合同常写作“租赁单元月含税租金为人民币……元”，没有“元/月”
  // 后缀。金额核算优先采用月含税租金；没有含税口径时才回退到普通月租金。
  const monthlyRent =
    findAmount(
      /(?:停车位|车位)?每月租赁费用(?:为|共计|合计|总计)/u,
      installmentOrDepositPattern,
    ) ||
    findAmount(/(?:租赁单元)?月含税租金(?:为|共计|合计|标准)?/u) ||
    findAmount(/(?:租赁单元)?(?:月租金|每月租金|租金标准)(?:为|共计|合计)?/u);
  const monthlyPropertyManagementFeeCandidates = findAmounts(
    /(?:租赁单元)?(?:月含税物业管理费|月物业管理费|每月物业管理费)(?:为|共计|合计|标准)?/u,
    installmentOrDepositPattern,
  );
  const recognizedMonthlyPropertyManagementFee =
    monthlyPropertyManagementFeeCandidates[0] ?? null;
  const monthlyPropertyManagementFeeNet = findAmount(
    /(?:租赁单元)?月不含税物业管理费(?:为|共计|合计|标准)?/u,
    installmentOrDepositPattern,
  );
  const propertyFeeScope =
    continuousText.match(/月含税物业管理费[^。；]{0,260}/u)?.[0];
  const propertyFeeTaxRate = Number(
    propertyFeeScope?.match(/增值税率\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/u)?.[1],
  );
  const derivedMonthlyPropertyManagementFeeRaw =
    monthlyPropertyManagementFeeNet != null &&
    Number.isFinite(propertyFeeTaxRate) &&
    propertyFeeTaxRate > 0
      ? monthlyPropertyManagementFeeNet * (1 + propertyFeeTaxRate / 100)
      : null;
  const reconciledMonthlyPropertyManagementFee =
    derivedMonthlyPropertyManagementFeeRaw == null
      ? null
      : monthlyPropertyManagementFeeCandidates.find(
          (candidate) =>
            Math.abs(candidate - derivedMonthlyPropertyManagementFeeRaw) <= 0.1,
        ) || null;
  const monthlyPropertyManagementFee =
    reconciledMonthlyPropertyManagementFee ??
    recognizedMonthlyPropertyManagementFee ??
    (derivedMonthlyPropertyManagementFeeRaw == null
      ? null
      : Math.round(derivedMonthlyPropertyManagementFeeRaw * 100) / 100);
  if (explicitCombinedTotal != null) {
    return {
      isRentalLease,
      leaseStartDate,
      leaseEndDate,
      monthlyRent,
      monthlyPropertyManagementFee,
      termMonths,
      totalAmount: explicitCombinedTotal,
      amountSource: "contract_total",
    };
  }
  if (monthlyRent != null && monthlyPropertyManagementFee != null) {
    const calculationMonths = termMonths || 12;
    const monthlyFixedFeeCents =
      Math.round(monthlyRent * 100) +
      Math.round(monthlyPropertyManagementFee * 100);
    return {
      isRentalLease,
      leaseStartDate,
      leaseEndDate,
      monthlyRent,
      monthlyPropertyManagementFee,
      termMonths,
      totalAmount: (monthlyFixedFeeCents * calculationMonths) / 100,
      amountSource: "monthly_rent_property_fee_calculated",
    };
  }
  if (explicitRentTotal != null) {
    return {
      isRentalLease,
      leaseStartDate,
      leaseEndDate,
      monthlyRent,
      monthlyPropertyManagementFee,
      termMonths,
      totalAmount: explicitRentTotal,
      amountSource: "contract_total",
    };
  }
  if (monthlyRent != null) {
    const calculationMonths = termMonths || 12;
    return {
      isRentalLease,
      leaseStartDate,
      leaseEndDate,
      monthlyRent,
      monthlyPropertyManagementFee,
      termMonths,
      totalAmount: Math.round(monthlyRent * calculationMonths * 100) / 100,
      amountSource: "monthly_rent_calculated",
    };
  }
  return { ...empty, leaseStartDate, leaseEndDate, termMonths };
}

function collectLeaseAmountCandidates(
  contexts: readonly SourceContext[],
  options: ParseContractTextOptions,
): InternalCandidate[] {
  const terms = extractContractLeaseTerms(
    contexts.map((context) => context.text).join("\n"),
    options.expectedCategory,
  );
  if (!terms.isRentalLease || terms.totalAmount == null) return [];
  const source =
    contexts.find((context) =>
      /房屋(?:及场地)?租赁|停车场|停车位|车位租赁|每月租赁费用|小客车|车辆租赁|汽车租赁|租赁期限|月租金|每月租金|租金总额/u.test(
        context.text,
      ),
    ) || contexts[0];
  if (!source) return [];
  const normalizedValue = normalizeAmount(terms.totalAmount);
  const isRentalRenewal = options.leaseOperationType === "renewal";
  const evidence =
    terms.amountSource === "monthly_rent_property_fee_calculated"
      ? `月租金 ${normalizeAmount(terms.monthlyRent || 0)} + 月物业管理费 ${normalizeAmount(terms.monthlyPropertyManagementFee || 0)}，合计每月 ${normalizeAmount((terms.monthlyRent || 0) + (terms.monthlyPropertyManagementFee || 0))} × ${terms.termMonths || 12} 个月 = 合同总金额 ${normalizedValue}`
      : terms.amountSource === "monthly_rent_calculated"
        ? `月租金 ${normalizeAmount(terms.monthlyRent || 0)} × ${terms.termMonths || 12} 个月 = 合同租金总额 ${normalizedValue}`
        : `租赁合同正文明确租金总额 ${normalizedValue}`;
  return [
    {
      field: "amount",
      originalValue: evidence,
      normalizedValue,
      ...buildCandidateScoring(99, source.confidence, source.source),
      source: source.source,
      pageNumber: source.pageNumber,
      evidence,
      kind: "arabic_amount",
      strongEvidence: true,
      recognitionEngine: source.recognitionEngine,
      precedence: isRentalRenewal ? 120 : 20,
      amountRole: isRentalRenewal ? "relation_adjustment" : "contract_total",
      amountEventScope: isRentalRenewal ? "total" : undefined,
      explicitContractTotal: !isRentalRenewal,
      verificationRole: isRentalRenewal
        ? "relation_adjustment"
        : "current_contract_total",
    },
  ];
}

function collectRelationAdjustmentAmountCandidates(
  contexts: readonly SourceContext[],
  relationType: ParseContractTextOptions["relationType"],
): InternalCandidate[] {
  if (relationType !== "supplement" && relationType !== "termination") {
    return [];
  }

  const candidates: InternalCandidate[] = [];
  const adjustmentActionPattern =
    /增加|新增|增补|追加|调增|核增|减少|核减|调减|扣减|减除|冲减/g;
  const adjustmentActionTrigger =
    /增加|新增|增补|追加|调增|核增|减少|核减|调减|扣减|减除|冲减/;
  const decreaseAction = /减少|核减|调减|扣减|减除|冲减/;
  const ambiguousDirectionPattern =
    /(?:增加|新增|增补|追加|调增|核增)\s*(?:或|\/|、)\s*(?:减少|核减|调减|扣减|减除|冲减)|(?:减少|核减|调减|扣减|减除|冲减)\s*(?:或|\/|、)\s*(?:增加|新增|增补|追加|调增|核增)/;
  const explicitCurrentAgreementMarker =
    /本次|本补充协议|本变更协议|本追加协议|本协议|现(?:对|将|予以)/;
  const datedSignedAgreementReference =
    /(?:19|20)\d{2}(?:年\d{1,2}月\d{1,2}日|[./-]\d{1,2}[./-]\d{1,2}).{0,20}(?:签订|签署|订立|达成)(?:了)?(?:第[一二三四五六七八九十]+次)?(?:补充|变更|追加)协议(?:书)?/;
  const historicalAgreementReference =
    /前次|上次|上一份|历次|历史|此前|曾经?.{0,20}(?:签订|签署|订立|达成)(?:了)?(?:第[一二三四五六七八九十]+次)?(?:补充|变更|追加)协议(?:书)?/;
  const followingTotalAnchor =
    /变更后|调整后|现合同(?:总)?金额|合同(?:总)?金额(?:相应)?变更为|变更为|调整为|新的合同(?:总)?金额|(?:合同)?共计(?:合同)?(?:技术服务|咨询服务|服务)?(?:报酬)?总额/;

  for (const context of contexts) {
    const hasExplicitCurrentAdjustment = context.lines.some((_, index) => {
      const currentEventWindow = context.lines
        .slice(index, index + 3)
        .map((line) => line.normalized)
        .filter(Boolean)
        .join("")
        .replace(/\s+/g, "");
      return (
        explicitCurrentAgreementMarker.test(currentEventWindow) &&
        adjustmentActionTrigger.test(currentEventWindow)
      );
    });
    for (let index = 0; index < context.lines.length; index += 1) {
      const currentLine = context.lines[index];
      if (
        /^(?:(?:第[一二三四五六七八九十]+次)|(?:[\p{Script=Han}A-Za-z0-9·—-]{1,24}合同))?(?:补充|变更|追加)协议(?:书)?(?:[（(].{1,12}[）)])?$/u.test(
          currentLine.normalized.replace(/\s+/g, ""),
        )
      ) {
        // “追加协议”等标题中的“追加”只描述协议类型，不能跨行绑定
        // 下一行的原合同金额为本次增加事件。
        continue;
      }
      if (
        historicalAgreementReference.test(currentLine.normalized) &&
        !/本次/.test(currentLine.normalized)
      ) {
        continue;
      }
      const hasAdjustmentAction = adjustmentActionTrigger.test(
        currentLine.normalized,
      );
      const windowLines = context.lines.slice(index, index + 4);
      const normalizedWindow = windowLines
        .map((line) => line.normalized)
        .filter(Boolean)
        .join(" ");
      const actionRoleWindow = windowLines
        .slice(0, 3)
        .map((line) => line.normalized)
        .filter(Boolean)
        .join(" ");
      const hasTerminationAction =
        relationType === "termination" &&
        /(?:终止|解除).{0,24}(?:金额|价款|费用)|(?:金额|价款|费用).{0,12}(?:终止|解除)/.test(
          currentLine.normalized,
        );
      if (
        !hasTerminationAction &&
        !(
          hasAdjustmentAction &&
          (/(?:金额|价款|费用|服务费|报酬)/.test(actionRoleWindow) ||
            /本次|本补充协议|本协议/.test(currentLine.normalized))
        )
      ) {
        continue;
      }

      const evidence = windowLines
        .map((line) => line.original || line.normalized)
        .filter(Boolean)
        .join("\n");
      const totalBoundary = normalizedWindow.search(followingTotalAnchor);
      const adjustmentClause =
        totalBoundary >= 0
          ? normalizedWindow.slice(0, totalBoundary)
          : normalizedWindow;
      const searchableAdjustmentClause = compactMoneyText(
        adjustmentClause,
      ).replace(/\s+/g, "");
      const amounts = extractMoneyValues(searchableAdjustmentClause);
      if (amounts.length === 0) continue;
      const compactedActionLine = compactMoneyText(
        currentLine.normalized,
      ).replace(/\s+/g, "");
      const amountsOnActionLine = extractMoneyValues(compactedActionLine);
      const actionLineAmountValues = new Map<number, Set<string>>();
      for (const amount of amountsOnActionLine) {
        const prefix = compactedActionLine.slice(0, amount.startIndex);
        const actions = [...prefix.matchAll(adjustmentActionPattern)];
        const closestAction = actions.at(-1);
        if (
          closestAction?.index == null ||
          prefix.length - (closestAction.index + closestAction[0].length) > 48
        ) {
          continue;
        }
        const values =
          actionLineAmountValues.get(closestAction.index) || new Set<string>();
        values.add(amount.normalizedValue);
        actionLineAmountValues.set(closestAction.index, values);
      }

      const sourceConfidence = Math.min(
        ...windowLines.map((line) => line.confidence),
      );
      for (const amount of amounts) {
        // 每个匹配保留自身位置，不能用 indexOf（首次位置）或 lastIndexOf
        // 绑定动作；同一子句重复出现相同金额时，两次方向必须分别判断。
        const amountIndex = amount.startIndex;
        const prefixBeforeAmount = searchableAdjustmentClause.slice(
          0,
          amountIndex,
        );
        const sentenceBoundary = Math.max(
          prefixBeforeAmount.lastIndexOf("。"),
          prefixBeforeAmount.lastIndexOf("；"),
          prefixBeforeAmount.lastIndexOf(";"),
        );
        const semanticPrefix = prefixBeforeAmount.slice(sentenceBoundary + 1);
        if (ambiguousDirectionPattern.test(semanticPrefix)) continue;
        const actionMatches = [
          ...semanticPrefix.matchAll(adjustmentActionPattern),
        ];
        const closestAction = actionMatches.at(-1);
        const terminationMatches =
          relationType === "termination"
            ? [...semanticPrefix.matchAll(/终止|解除/g)]
            : [];
        const closestTermination = terminationMatches.at(-1);
        const currentLineSearchLength = compactedActionLine.length;
        const closestActionAbsoluteIndex =
          closestAction?.index == null
            ? null
            : sentenceBoundary + 1 + closestAction.index;
        const closestTerminationAbsoluteIndex =
          closestTermination?.index == null
            ? null
            : sentenceBoundary + 1 + closestTermination.index;
        if (
          (closestActionAbsoluteIndex != null &&
            closestActionAbsoluteIndex >= currentLineSearchLength) ||
          (closestTerminationAbsoluteIndex != null &&
            closestTerminationAbsoluteIndex >= currentLineSearchLength)
        ) {
          // 窗口后续行若出现新的增减动作，应由该动作所在行独立生成事件；
          // 当前窗口不得先行重复收集，否则多笔调整会被累计两次。
          continue;
        }
        const actionDistance =
          closestAction?.index == null
            ? Number.POSITIVE_INFINITY
            : semanticPrefix.length -
              (closestAction.index + closestAction[0].length);
        const terminationDistance =
          closestTermination?.index == null
            ? Number.POSITIVE_INFINITY
            : semanticPrefix.length -
              (closestTermination.index + closestTermination[0].length);
        const hasExplicitCrossLineAmountRole =
          actionDistance <= 120 &&
          /(?:合同|协议|技术服务|咨询服务|服务)(?:总)?(?:金额|价款|费用|报酬)(?:为|是|：|:)?$/u.test(
            semanticPrefix,
          );
        const hasBoundAdjustmentAction =
          actionDistance <= 48 || hasExplicitCrossLineAmountRole;
        const hasBoundTerminationAmount =
          relationType === "termination" &&
          terminationDistance <= 48 &&
          /(?:金额|价款|费用)/.test(
            semanticPrefix.slice(closestTermination?.index || 0),
          );
        if (!hasBoundAdjustmentAction && !hasBoundTerminationAmount) continue;

        const actionIndex = hasBoundAdjustmentAction
          ? closestActionAbsoluteIndex || 0
          : closestTerminationAbsoluteIndex || 0;
        const valuesAlreadyBoundToAction = hasBoundAdjustmentAction
          ? actionLineAmountValues.get(actionIndex)
          : undefined;
        if (
          valuesAlreadyBoundToAction &&
          !valuesAlreadyBoundToAction.has(amount.normalizedValue)
        ) {
          // 当前动作在本行已经明确写出金额时，后续行的其他数值属于履行
          // 说明或下一字段；只允许同值的大写／数字写法继续绑定。若同一行
          // 末尾出现新的动作而它的金额落在下一行，则该动作没有行内金额，
          // 仍允许跨行读取。
          continue;
        }

        const recentHistoryContext = context.lines
          .slice(Math.max(0, index - 2), index + 1)
          .map((line) => line.normalized)
          .filter(Boolean)
          .join(" ");
        const actionPrefix = hasBoundAdjustmentAction
          ? semanticPrefix.slice(0, closestAction?.index || 0)
          : semanticPrefix.slice(0, closestTermination?.index || 0);
        if (
          historicalAgreementReference.test(actionPrefix) ||
          (hasExplicitCurrentAdjustment &&
            datedSignedAgreementReference.test(actionPrefix) &&
            !explicitCurrentAgreementMarker.test(actionPrefix)) ||
          (historicalAgreementReference.test(recentHistoryContext) &&
            !/本次|本补充协议|现(?:对|将|予以)/.test(semanticPrefix))
        ) {
          continue;
        }

        const boundActionEnd = hasBoundAdjustmentAction
          ? sentenceBoundary +
            1 +
            (closestAction?.index || 0) +
            (closestAction?.[0].length || 0)
          : sentenceBoundary +
            1 +
            (closestTermination?.index || 0) +
            (closestTermination?.[0].length || 0);
        const textAfterBoundAction = searchableAdjustmentClause.slice(
          boundActionEnd,
          amountIndex,
        );
        if (
          /(?:不含税(?:价|金额)?|未税(?:价|金额)?|税额|税费|税率|税款|增值税|预付款|进度款|结算款|付款|支付)/u.test(
            textAfterBoundAction,
          ) ||
          /^\s*(?:至|到)/.test(textAfterBoundAction) ||
          /(?:核减|调减|减少|调整|变更)?后.{0,24}(?:合同)?(?:总)?金额/.test(
            textAfterBoundAction,
          ) ||
          /(?:剩余金额|合同余额|调整后剩余)/.test(textAfterBoundAction)
        ) {
          continue;
        }
        const paymentOrFeeContext = `${textAfterBoundAction}${searchableAdjustmentClause.slice(
          Math.max(boundActionEnd, amountIndex - 24),
          amountIndex,
        )}`;
        if (
          /(?:应|需|分期|第一笔|第二笔|第[一二三四五六七八九十\d]+笔).{0,12}(?:支付|付款)|(?:支付|付款|预付款|进度款|结算款|税额|税费|单价).{0,12}$/u.test(
            paymentOrFeeContext,
          )
        ) {
          // 总变化额后面的付款拆分、税费和单价属于履行说明，不能再次作为
          // 增减事件累计。它们仍会由普通金额角色规则留作诊断事实。
          continue;
        }
        const isDecrease =
          relationType === "termination" ||
          (hasBoundAdjustmentAction &&
            decreaseAction.test(closestAction?.[0] || ""));
        const numericAmount = Number(amount.normalizedValue);
        if (!Number.isFinite(numericAmount) || numericAmount === 0) continue;
        const signedAmount = isDecrease
          ? -Math.abs(numericAmount)
          : Math.abs(numericAmount);
        const totalEventContext = searchableAdjustmentClause.slice(
          Math.max(sentenceBoundary + 1, actionIndex - 28),
          amountIndex,
        );
        const amountEventScope =
          /(?:合同|协议)(?:总金额|总价|总价款|总费用)|(?:技术服务|咨询服务|服务)?报酬总额|合计|共计|总计|总共/u.test(
            totalEventContext,
          ) ||
          /(?:本次|本)(?:补充|变更|追加)协议(?:书)?(?:增加|新增|增补|追加|调增|核增|减少|核减|调减|扣减|减除|冲减)(?:合同)?金额(?:为|是|：|:)?$/u.test(
            totalEventContext,
          )
            ? "total"
            : "component";
        const amountEventAction: NonNullable<
          InternalCandidate["amountEventAction"]
        > =
          relationType === "termination"
            ? "termination"
            : isDecrease
              ? "decrease"
              : "increase";
        const amountEventGroupKey = `${context.source}:${context.recognitionEngine}:${context.pageNumber || 0}:${index}:${actionIndex}`;
        candidates.push({
          field: "amount",
          originalValue: amount.originalValue,
          normalizedValue: normalizeAmount(signedAmount),
          ...buildCandidateScoring(
            scoreWithSource(99, sourceConfidence),
            sourceConfidence,
            context.source,
          ),
          source: context.source,
          pageNumber: context.pageNumber,
          evidence,
          kind: amount.kind,
          strongEvidence: true,
          recognitionEngine: context.recognitionEngine,
          precedence: 20,
          amountRole: "relation_adjustment",
          verificationRole: "relation_adjustment",
          amountEventKey: `${amountEventGroupKey}:${normalizeAmount(signedAmount)}`,
          amountEventGroupKey,
          amountEventAction,
          amountEventScope,
        });
      }
    }
  }
  const candidatesByAction = new Map<string, InternalCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.amountEventGroupKey) continue;
    const actionCandidates =
      candidatesByAction.get(candidate.amountEventGroupKey) || [];
    actionCandidates.push(candidate);
    candidatesByAction.set(candidate.amountEventGroupKey, actionCandidates);
  }
  for (const actionCandidates of candidatesByAction.values()) {
    const formats = new Set(
      actionCandidates.map((candidate) => candidate.kind),
    );
    const values = new Set(
      actionCandidates.map((candidate) => candidate.normalizedValue),
    );
    if (
      !formats.has("arabic_amount") ||
      !formats.has("chinese_amount") ||
      values.size <= 1
    ) {
      continue;
    }
    for (const candidate of actionCandidates) {
      candidate.amountEventConflict = true;
      candidate.warnings = [
        ...new Set([
          ...(candidate.warnings || []),
          `同一增减动作的中文大写金额与阿拉伯数字不一致（${[...values].join(
            " / ",
          )}），禁止直接汇总并触发局部增强复核后重新排序`,
        ]),
      ];
    }
  }
  return candidates;
}

interface AnchoredAgreementAmount {
  anchorIndex: number;
  amountIndex: number;
  originalValue: string;
  normalizedValue: string;
  numericValue: number;
  kind: "arabic_amount" | "chinese_amount";
}

interface CurrentAgreementTotalEvent {
  originalAmount: number;
  changeAmount: number;
  finalAmount: number;
  candidate: InternalCandidate;
}

const CURRENT_AGREEMENT_TOTAL_PATTERN =
  /(?:(?:本次|本)(?:补充|变更|追加)协议(?:书)?|本协议)(?:技术服务|咨询服务|服务)?(?:报酬)?总额\s*(?:为|是|：|:)?/gu;
const AGREEMENT_ORIGINAL_TOTAL_PATTERN =
  /(?:原合同|原协议|变更前|调整前)(?:的)?(?:(?:合同|技术服务|咨询服务|服务)?(?:总)?(?:金额|总额|总费用|价款|费用)|(?:技术服务|咨询服务|服务)?报酬总额)\s*(?!(?:调整|变更)为)(?:为|是|：|:)?/gu;
const AGREEMENT_REFERENCED_ORIGINAL_TOTAL_PATTERN =
  /(?:原合同|原协议)(?:[（(][^）)]{1,120}[）)])?[^。；]{0,120}?(?:其|该合同(?:的)?)(?:合同)?(?:总)?(?:金额|总额|总费用|价款|费用)\s*(?:为|是|：|:)/gu;
const AGREEMENT_CUMULATIVE_TOTAL_PATTERN =
  /(?:(?:变更后|调整后|最终|现合同|新的合同|本补充协议(?:签订|生效)后)(?:的)?(?:(?:合同|技术服务|咨询服务|服务)?(?:总)?(?:金额|总额|总费用|价款|费用)|(?:技术服务|咨询服务|服务)?报酬总额)\s*(?:为|是|：|:)?|合同(?:总)?(?:金额|价款|费用)(?:相应)?(?:变更|调整)为|(?:合同)?(?:共计|合计|累计)(?:合同)?(?:技术服务|咨询服务|服务)?(?:报酬)?总额\s*(?:为|是|：|:)?)/gu;

function collectAnchoredAgreementAmounts(
  value: string,
  pattern: RegExp,
  includeAllClauseVariants = false,
): AnchoredAgreementAmount[] {
  const matches: AnchoredAgreementAmount[] = [];
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  for (const anchor of value.matchAll(new RegExp(pattern.source, flags))) {
    if (anchor.index == null) continue;
    const afterAnchorStart = anchor.index + anchor[0].length;
    let afterAnchor = value.slice(afterAnchorStart, afterAnchorStart + 160);
    if (includeAllClauseVariants) {
      const nextEventBoundary = afterAnchor.search(
        /(?:本次|本补充协议|本变更协议|本追加协议|增加|新增|增补|追加|调增|核增|减少|核减|调减|扣减|减除|冲减|变更后|调整后|最终|现合同|新的合同|不含税|未税|税额|税费|预付款|进度款|结算款|付款|支付)/u,
      );
      if (nextEventBoundary >= 0) {
        afterAnchor = afterAnchor.slice(0, nextEventBoundary);
      }
    }
    const amounts = extractMoneyValues(afterAnchor);
    const preferred =
      amounts.find((amount) => amount.kind === "arabic_amount") || amounts[0];
    if (!preferred) continue;
    const selectedAmounts = includeAllClauseVariants ? amounts : [preferred];
    for (const amount of selectedAmounts) {
      const numericValue = Number(amount.normalizedValue);
      if (!Number.isFinite(numericValue)) continue;
      matches.push({
        anchorIndex: anchor.index,
        amountIndex: afterAnchorStart + amount.startIndex,
        originalValue: amount.originalValue,
        normalizedValue: amount.normalizedValue,
        numericValue,
        kind: amount.kind,
      });
    }
  }
  return matches;
}

function collectOriginalAgreementAmounts(
  value: string,
  includeAllClauseVariants = false,
): AnchoredAgreementAmount[] {
  const matches = [
    ...collectAnchoredAgreementAmounts(
      value,
      AGREEMENT_ORIGINAL_TOTAL_PATTERN,
      includeAllClauseVariants,
    ),
    ...collectAnchoredAgreementAmounts(
      value,
      AGREEMENT_REFERENCED_ORIGINAL_TOTAL_PATTERN,
      includeAllClauseVariants,
    ),
  ];
  const unique = new Map<string, AnchoredAgreementAmount>();
  for (const match of matches) {
    unique.set(
      `${match.anchorIndex}:${match.amountIndex}:${match.normalizedValue}`,
      match,
    );
  }
  return [...unique.values()].sort(
    (left, right) => left.anchorIndex - right.anchorIndex,
  );
}

function findLatestAgreementAmountClosure(
  value: string,
  changeAmount: number,
): { originalAmount: number; finalAmount: number } | null {
  const originalAmounts = collectOriginalAgreementAmounts(value, true);
  const cumulativeAmounts = collectAnchoredAgreementAmounts(
    value,
    AGREEMENT_CUMULATIVE_TOTAL_PATTERN,
    true,
  );
  const previousFacts = [...originalAmounts, ...cumulativeAmounts];
  const normalizedChangeAmount = Math.round(changeAmount * 100) / 100;

  for (const finalFact of [...cumulativeAmounts].sort(
    (left, right) => right.anchorIndex - left.anchorIndex,
  )) {
    const expectedPreviousAmount =
      Math.round((finalFact.numericValue - normalizedChangeAmount) * 100) / 100;
    const previousFact = previousFacts
      .filter(
        (fact) =>
          fact.amountIndex < finalFact.anchorIndex &&
          normalizeAmount(fact.numericValue) ===
            normalizeAmount(expectedPreviousAmount),
      )
      .sort((left, right) => right.amountIndex - left.amountIndex)[0];
    if (!previousFact) continue;
    return {
      originalAmount: previousFact.numericValue,
      finalAmount: finalFact.numericValue,
    };
  }
  return null;
}

function agreementAmountEvidenceLines(
  context: SourceContext,
  compactedAnchorIndex: number,
): LineContext[] {
  let compactedLength = 0;
  let anchorLineIndex = 0;
  for (let index = 0; index < context.lines.length; index += 1) {
    compactedLength += compactMoneyText(
      context.lines[index].normalized,
    ).replace(/\s+/g, "").length;
    if (compactedAnchorIndex < compactedLength) {
      anchorLineIndex = index;
      break;
    }
  }
  return context.lines.slice(
    Math.max(0, anchorLineIndex - 2),
    anchorLineIndex + 8,
  );
}

/**
 * 没有增减动词时，“本次／本补充协议报酬总额”只有在最近前序有效总额、
 * 当前协议金额和最近后序累计／最终总额形成精确闭环时，才可绑定为当前
 * 金额事件。具名历史补充协议、付款、税费和普通服务费均不能触发该规则。
 */
function collectCurrentAgreementTotalEvents(
  contexts: readonly SourceContext[],
  relationType: ParseContractTextOptions["relationType"],
): CurrentAgreementTotalEvent[] {
  if (relationType !== "supplement") return [];
  const events = new Map<string, CurrentAgreementTotalEvent>();

  for (const context of contexts) {
    const compactedEvidence = compactMoneyText(
      context.lines
        .map((line) => line.normalized)
        .filter(Boolean)
        .join("\n"),
    ).replace(/\s+/g, "");
    const currentAmounts = collectAnchoredAgreementAmounts(
      compactedEvidence,
      CURRENT_AGREEMENT_TOTAL_PATTERN,
    );
    const originalAmounts = collectOriginalAgreementAmounts(compactedEvidence);
    const cumulativeAmounts = collectAnchoredAgreementAmounts(
      compactedEvidence,
      AGREEMENT_CUMULATIVE_TOTAL_PATTERN,
    );

    for (const current of currentAmounts) {
      const previous = [...originalAmounts, ...cumulativeAmounts]
        .filter((amount) => amount.amountIndex < current.anchorIndex)
        .sort((left, right) => right.amountIndex - left.amountIndex)[0];
      const next = cumulativeAmounts
        .filter((amount) => amount.anchorIndex > current.amountIndex)
        .sort((left, right) => left.anchorIndex - right.anchorIndex)[0];
      if (!previous || !next) continue;

      const derivedChangeAmount =
        Math.round((next.numericValue - previous.numericValue) * 100) / 100;
      if (
        derivedChangeAmount === 0 ||
        normalizeAmount(Math.abs(derivedChangeAmount)) !==
          normalizeAmount(Math.abs(current.numericValue))
      ) {
        continue;
      }

      const evidenceLines = agreementAmountEvidenceLines(
        context,
        current.anchorIndex,
      );
      const sourceConfidence = Math.min(
        ...evidenceLines.map((line) => line.confidence),
      );
      const normalizedChangeAmount = normalizeAmount(derivedChangeAmount);
      const eventKey = [
        normalizeAmount(previous.numericValue),
        normalizedChangeAmount,
        normalizeAmount(next.numericValue),
      ].join(":");
      const sourceEventKey = `${context.source}:${context.recognitionEngine}:${context.pageNumber || 0}:${eventKey}`;
      events.set(sourceEventKey, {
        originalAmount: previous.numericValue,
        changeAmount: derivedChangeAmount,
        finalAmount: next.numericValue,
        candidate: {
          field: "amount",
          originalValue: current.originalValue,
          normalizedValue: normalizedChangeAmount,
          ...buildCandidateScoring(
            scoreWithSource(99, sourceConfidence),
            sourceConfidence,
            context.source,
          ),
          source: context.source,
          pageNumber: context.pageNumber,
          evidence: evidenceLines
            .map((line) => line.original || line.normalized)
            .filter(Boolean)
            .join("\n"),
          kind: current.kind,
          strongEvidence: true,
          recognitionEngine: context.recognitionEngine,
          precedence: 20,
          amountRole: "relation_adjustment",
          verificationRole: "relation_adjustment",
          amountEventKey: `${sourceEventKey}:current-agreement-total`,
          amountEventAction: derivedChangeAmount < 0 ? "decrease" : "increase",
          amountEventScope: "total",
          warnings: [
            `当前协议金额事件已由最近有效总额 ${normalizeAmount(previous.numericValue)}、本次金额 ${normalizeAmount(Math.abs(current.numericValue))} 和最终总额 ${normalizeAmount(next.numericValue)} 闭环验证，付款、税费和分项金额不参与变化量`,
          ],
        },
      });
    }
  }
  return [...events.values()];
}

function collectCurrentAgreementTotalCandidates(
  contexts: readonly SourceContext[],
  relationType: ParseContractTextOptions["relationType"],
): InternalCandidate[] {
  return collectCurrentAgreementTotalEvents(contexts, relationType).map(
    (event) => event.candidate,
  );
}

type ContractRelationType = NonNullable<
  ParseContractTextOptions["relationType"]
>;

interface AgreementAmountAnalysis {
  originalAmount: number | null;
  changeAmount: number | null;
  explicitFinalAmount: number | null;
  changeDerivedFromExplicitFinal: boolean;
  hasAmountEventConflict: boolean;
  adjustmentValues: number[];
  evidence: string;
  source: Exclude<ContractOcrSource, "mixed" | "rule">;
  pageNumber?: number;
  confidence: number;
  recognitionEngine: string;
}

function detectAgreementRelationType(
  contexts: readonly SourceContext[],
): "supplement" | "termination" | null {
  const titleLines = contexts.flatMap((context) =>
    context.lines
      .filter((line) => line.normalized)
      .slice(0, 8)
      .map((line) => line.normalized.replace(/\s+/g, "")),
  );
  if (
    titleLines.some((title) =>
      /^(?:[\p{Script=Han}A-Za-z0-9·—-]{0,24}合同)?(?:终止|解除)协议(?:书)?(?:[（(].{1,12}[）)])?$/u.test(
        title,
      ),
    )
  ) {
    return "termination";
  }
  if (
    titleLines.some((title) =>
      /^(?:[\p{Script=Han}A-Za-z0-9·—-]{0,48})?(?:补充|变更|追加|续签|续租)协议(?:书)?(?:[（(].{1,12}[）)])?$/u.test(
        title,
      ),
    )
  ) {
    return "supplement";
  }
  const fullText = contexts
    .flatMap((context) => context.lines.map((line) => line.normalized))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, "");
  // “协议书”本身不代表补充协议；只有同时存在原合同事实和明确变更动作时
  // 才进入补充协议金额规则。
  if (
    /协议书/.test(fullText) &&
    /原合同/.test(fullText) &&
    /增加|新增|增补|追加|减少|核减|变更|调整后/.test(fullText)
  ) {
    return "supplement";
  }
  return null;
}

function moneyAfterAnchor(value: string, pattern: RegExp): number | null {
  const match = value.match(pattern);
  if (match?.index == null) return null;
  const afterAnchor = value.slice(
    match.index + match[0].length,
    match.index + 160,
  );
  const amounts = extractMoneyValues(afterAnchor);
  if (amounts.length === 0) return null;
  const preferred =
    amounts.find((amount) => amount.kind === "arabic_amount") || amounts[0];
  const numericValue = Number(preferred.normalizedValue);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function groupAmountAnalysisContexts(
  contexts: readonly SourceContext[],
): SourceContext[] {
  const grouped = new Map<string, SourceContext[]>();
  for (const context of contexts) {
    if (context.verificationOnly) continue;
    const key = `${context.source}:${context.recognitionEngine}`;
    const values = grouped.get(key) || [];
    values.push(context);
    grouped.set(key, values);
  }
  const combined: SourceContext[] = [];
  for (const values of grouped.values()) {
    const ordered = [...values].sort(
      (left, right) => (left.pageNumber || 0) - (right.pageNumber || 0),
    );
    combined.push({
      source: ordered[0].source,
      pageNumber: ordered.length === 1 ? ordered[0].pageNumber : undefined,
      confidence: Math.min(...ordered.map((value) => value.confidence)),
      recognitionEngine: ordered[0].recognitionEngine,
      verificationOnly: false,
      lines: ordered.flatMap((value) => value.lines),
      text: ordered.map((value) => value.text).join("\n"),
    });
  }
  return combined;
}

function analyzeAgreementAmounts(
  contexts: readonly SourceContext[],
  relationType: ContractRelationType | undefined,
): AgreementAmountAnalysis | null {
  if (relationType !== "supplement" && relationType !== "termination") {
    return null;
  }
  const analyses: AgreementAmountAnalysis[] = [];
  for (const context of groupAmountAnalysisContexts(contexts)) {
    const evidence = context.lines
      .map((line) => line.normalized)
      .filter(Boolean)
      .join("\n");
    const compactedEvidence = compactMoneyText(evidence).replace(/\s+/g, "");
    const currentAgreementEvents = collectCurrentAgreementTotalEvents(
      [context],
      relationType,
    );
    const distinctCurrentAgreementEvents = new Map<
      string,
      CurrentAgreementTotalEvent
    >();
    for (const event of currentAgreementEvents) {
      distinctCurrentAgreementEvents.set(
        [
          normalizeAmount(event.originalAmount),
          normalizeAmount(event.changeAmount),
          normalizeAmount(event.finalAmount),
        ].join(":"),
        event,
      );
    }
    // 同一识别通道出现多个不同的“前额／本次／后额”闭环时不能猜选。
    // 保留各候选用于审计与自动重排，但内部金额拆分只采用唯一闭环。
    const currentAgreementEvent =
      distinctCurrentAgreementEvents.size === 1
        ? [...distinctCurrentAgreementEvents.values()][0]
        : null;
    const firstOriginalAgreementAmount =
      collectOriginalAgreementAmounts(compactedEvidence)[0]?.numericValue ??
      null;
    let originalAmount =
      currentAgreementEvent?.originalAmount ?? firstOriginalAgreementAmount;
    let explicitFinalAmount =
      currentAgreementEvent?.finalAmount ??
      moneyAfterAnchor(
        compactedEvidence,
        /(?:变更后|调整后|最终|现合同|新的合同|本补充协议(?:签订|生效)后)(?:的)?(?:(?:合同|技术服务|咨询服务|服务)?(?:总)?(?:金额|总额|总费用|价款|费用)|(?:技术服务|咨询服务|服务)?报酬总额)\s*(?:为|是|：|:)?|合同(?:总)?(?:金额|价款|费用)(?:相应)?(?:变更|调整)为|(?:合同)?共计(?:合同)?(?:技术服务|咨询服务|服务)?(?:报酬)?总额\s*(?:为|是|：|:)?/u,
      );
    const adjustmentCandidates = [
      ...collectRelationAdjustmentAmountCandidates([context], relationType),
      ...(currentAgreementEvent ? [currentAgreementEvent.candidate] : []),
    ];
    const hasAmountEventConflict = adjustmentCandidates.some(
      (candidate) => candidate.amountEventConflict,
    );
    const uniqueAdjustments = new Map<string, InternalCandidate>();
    for (const candidate of adjustmentCandidates) {
      const key =
        candidate.amountEventKey ||
        `${candidate.normalizedValue}:${normalizeLine(candidate.evidence)}`;
      const current = uniqueAdjustments.get(key);
      if (
        !current ||
        (candidate.kind === "arabic_amount" &&
          current.kind !== "arabic_amount") ||
        candidate.confidence > current.confidence
      ) {
        uniqueAdjustments.set(key, candidate);
      }
    }
    // amountEventKey（金额事件标识）把同一动作下的大写金额和阿拉伯数字
    // 合并为一笔，同时保留两笔数值相同但动作位置不同的真实增减事件。
    const adjustmentEvents = [...uniqueAdjustments.values()];
    const totalAdjustmentEvents = adjustmentEvents.filter(
      (candidate) => candidate.amountEventScope === "total",
    );
    // 协议先写“本次报酬总额增减”，随后再按许可证、阶段或付款节点列出
    // 构成明细时，只能采用总额事件；若正文没有总额事件，才汇总各分项
    // 动作。这样既不会把总额和明细重复相加，也保留多笔独立增减能力。
    const selectedAdjustmentEvents =
      totalAdjustmentEvents.length > 0
        ? totalAdjustmentEvents
        : adjustmentEvents;
    // 同一动作的中文大写与阿拉伯数字互相矛盾时，原候选继续用于页面冲突
    // 展示，但整份协议的净变化不得只取其中之一或把两者相加。
    let adjustmentValues = hasAmountEventConflict
      ? []
      : selectedAdjustmentEvents
          .map((candidate) => Number(candidate.normalizedValue))
          .filter((value) => Number.isFinite(value) && value !== 0);
    const actionChangeAmount =
      adjustmentValues.length > 0
        ? Math.round(
            adjustmentValues.reduce((total, value) => total + value, 0) * 100,
          ) / 100
        : null;
    // 一份正文可能同时回顾前次协议并写本次变更。先用“本次增减”动作定位
    // 最后一个闭环，才能取得真正的生效前金额和最终金额；不能先拿正文首个
    // “原合同金额／调整后金额”相减，否则会把历史节点误认成本次节点。
    if (actionChangeAmount != null && actionChangeAmount !== 0) {
      const latestClosure = findLatestAgreementAmountClosure(
        compactedEvidence,
        actionChangeAmount,
      );
      if (latestClosure) {
        originalAmount = latestClosure.originalAmount;
        explicitFinalAmount = latestClosure.finalAmount;
      }
    }
    const derivedChangeAmount =
      originalAmount != null && explicitFinalAmount != null
        ? Math.round((explicitFinalAmount - originalAmount) * 100) / 100
        : null;
    const changeDerivedFromExplicitFinal = derivedChangeAmount != null;
    if (derivedChangeAmount != null) {
      // 补充协议明确写明原金额与“调整后／最终总金额”时，最终总金额是合同
      // 链的权威事实。本次增减额由两者相减得到；动作金额和分项金额只做
      // 交叉核验，不能反向覆盖明确最终总额。
      adjustmentValues = [derivedChangeAmount];
    }
    const changeAmount = derivedChangeAmount ?? actionChangeAmount;
    if (
      originalAmount == null &&
      changeAmount == null &&
      explicitFinalAmount == null
    ) {
      continue;
    }
    analyses.push({
      originalAmount,
      changeAmount,
      explicitFinalAmount,
      changeDerivedFromExplicitFinal,
      hasAmountEventConflict,
      adjustmentValues,
      evidence,
      source: context.source,
      pageNumber: context.pageNumber,
      confidence: context.confidence,
      recognitionEngine: context.recognitionEngine,
    });
  }
  return (
    analyses.sort((left, right) => {
      const completeness = (value: AgreementAmountAnalysis) =>
        Number(value.originalAmount != null) +
        Number(value.changeAmount != null) * 2 +
        Number(value.explicitFinalAmount != null);
      const completenessDifference = completeness(right) - completeness(left);
      if (completenessDifference !== 0) return completenessDifference;
      const sourcePriority = (value: AgreementAmountAnalysis) =>
        value.source === "pdf_text" ? 3 : value.source === "ocr_300" ? 2 : 1;
      const sourceDifference = sourcePriority(right) - sourcePriority(left);
      if (sourceDifference !== 0) return sourceDifference;
      return right.confidence - left.confidence;
    })[0] || null
  );
}

function buildAggregatedAdjustmentCandidate(
  analysis: AgreementAmountAnalysis | null,
): InternalCandidate | null {
  if (
    !analysis ||
    analysis.changeAmount == null ||
    analysis.changeAmount === 0 ||
    (!analysis.changeDerivedFromExplicitFinal &&
      analysis.adjustmentValues.length <= 1)
  ) {
    return null;
  }
  return {
    field: "amount",
    originalValue: normalizeAmount(analysis.changeAmount),
    normalizedValue: normalizeAmount(analysis.changeAmount),
    ...buildCandidateScoring(
      scoreWithSource(99, analysis.confidence),
      analysis.confidence,
      analysis.source,
    ),
    source: analysis.source,
    pageNumber: analysis.pageNumber,
    evidence: analysis.evidence,
    kind: "arabic_amount",
    strongEvidence: true,
    recognitionEngine: analysis.recognitionEngine,
    precedence: 30,
    amountRole: "relation_adjustment",
    verificationRole: "relation_adjustment",
    amountEventScope: "total",
    warnings: [
      analysis.changeDerivedFromExplicitFinal
        ? "已按正文明确调整后总金额锁定当前协议金额事件，并反算本次合同金额变化"
        : "已按当前协议明确增减项汇总本次合同金额变化",
    ],
  };
}

function collectCategoryCandidates(
  contexts: readonly SourceContext[],
): InternalCandidate[] {
  const rules: Array<{
    normalizedValue: "asset" | "main_business" | "non_main";
    pattern: RegExp;
    score: number;
  }> = [
    {
      normalizedValue: "asset",
      pattern:
        /资产类合同|资产合同|软件合同|(?:软件|(?:计算机|办公)?设备|办公资产|固定资产|办公用品|货物|物资|材料)(?:采购|购置)(?:合同|协议)?|(?:设备|货物|物资)(?:供货|买卖)(?:合同|协议)?/,
      score: 97,
    },
    {
      normalizedValue: "main_business",
      pattern:
        /主营项目合同|主营业务合同|工程咨询服务合同|技术咨询服务合同|技术服务合同|工程咨询|项目前期手续|前期手续(?:办理|咨询)|手续办理服务|技术咨询|信息咨询|项目管理咨询/,
      score: 94,
    },
    {
      normalizedValue: "non_main",
      pattern:
        /非主营项目合同|非主营业务合同|非主营|其他服务合同|其他服务协议|培训服务合同/,
      score: 94,
    },
  ];
  const explicitCandidates: InternalCandidate[] = [];
  const semanticCandidates: InternalCandidate[] = [];
  const explicitCategoryValues: Record<
    string,
    "asset" | "main_business" | "non_main"
  > = {
    主营项目合同: "main_business",
    主营业务合同: "main_business",
    非主营项目合同: "non_main",
    非主营业务合同: "non_main",
    资产类合同: "asset",
    资产合同: "asset",
  };
  for (const context of contexts) {
    for (let lineIndex = 0; lineIndex < context.lines.length; lineIndex += 1) {
      const line = context.lines[lineIndex];
      const explicitCategory = line.normalized.match(
        /合同(?:分类|类型|类别)\s*[:：]\s*(主营项目合同|主营业务合同|非主营项目合同|非主营业务合同|资产类合同|资产合同)/,
      );
      if (explicitCategory) {
        explicitCandidates.push({
          field: "category",
          originalValue: explicitCategory[1],
          normalizedValue: explicitCategoryValues[explicitCategory[1]],
          ...buildCandidateScoring(
            scoreWithSource(100, line.confidence),
            line.confidence,
            context.source,
          ),
          source: context.source,
          pageNumber: context.pageNumber,
          evidence: line.original || line.normalized,
          kind: "category",
          strongEvidence: true,
          recognitionEngine: context.recognitionEngine,
        });
      }
      const meaningfulLinePosition = context.lines
        .slice(0, lineIndex + 1)
        .filter((candidate) => candidate.normalized).length;
      const looksLikeTitle =
        meaningfulLinePosition <= 8 &&
        /(?:合同|协议)(?:书)?[。.]?$/.test(line.normalized);
      const looksLikePartyOrOrganization =
        /(?:甲方|乙方|委\s*托\s*人|受\s*托\s*人|委托方|受托方|发包方|承包方|采购方|供应商|买方|卖方)\s*[（(:：]/.test(
          line.normalized,
        ) ||
        /(?:有限责任公司|股份有限公司|集团有限公司|有限公司)$/.test(
          line.normalized,
        );
      for (const rule of rules) {
        const match = line.normalized.match(rule.pattern);
        if (!match) continue;
        const beforeMatch = line.normalized.slice(
          Math.max(0, match.index! - 12),
          match.index,
        );
        if (
          /(?:并非|不是|不属于|不适用|不涉及|不包含|除外|另行签订|另签)\s*$/.test(
            beforeMatch,
          )
        ) {
          continue;
        }
        if (!looksLikeTitle && looksLikePartyOrOrganization) {
          continue;
        }
        const anchorScore = looksLikeTitle ? Math.max(rule.score, 97) : 58;
        semanticCandidates.push({
          field: "category",
          originalValue: match[0],
          normalizedValue: rule.normalizedValue,
          ...buildCandidateScoring(
            scoreWithSource(anchorScore, line.confidence),
            line.confidence,
            context.source,
          ),
          source: context.source,
          pageNumber: context.pageNumber,
          evidence: line.original || line.normalized,
          kind: "category",
          strongEvidence: looksLikeTitle,
          recognitionEngine: context.recognitionEngine,
        });
      }
    }
  }
  // 正文中的业务关键词可能同时出现多类，但明确填写的“合同分类/类型/类别”是
  // 文档自身的结构化声明。存在显式声明时只使用声明候选；若声明彼此矛盾，
  // 后续冲突门禁仍会降级，绝不因优先级而放宽自动采用条件。
  return explicitCandidates.length > 0
    ? explicitCandidates
    : semanticCandidates;
}

function buildDate(
  yearText: string,
  monthText: string,
  dayText: string,
): string | null {
  const year = Number(yearText.replace(/[Oo]/g, "0"));
  const month = Number(monthText.replace(/[Oo]/g, "0"));
  const day = Number(dayText.replace(/[Oo]/g, "0"));
  if (
    year < 2000 ||
    year > 2200 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const normalized = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === normalized
    ? normalized
    : null;
}

const CHINESE_DATE_DIGITS: Readonly<Record<string, number>> = {
  〇: 0,
  "○": 0,
  零: 0,
  O: 0,
  一: 1,
  壹: 1,
  二: 2,
  两: 2,
  贰: 2,
  三: 3,
  叁: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};

function parseChineseDateYear(value: string): number | null {
  const characters = [...value.replace(/\s+/g, "")];
  if (characters.length !== 4) return null;
  const digits = characters.map((character) => CHINESE_DATE_DIGITS[character]);
  if (digits.some((digit) => digit == null)) return null;
  return Number(digits.join(""));
}

function parseChineseCalendarNumber(value: string): number | null {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return null;
  const tenIndex = compact.search(/[十拾]/u);
  if (tenIndex >= 0) {
    if ((compact.match(/[十拾]/gu) || []).length !== 1) return null;
    const before = compact.slice(0, tenIndex);
    const after = compact.slice(tenIndex + 1);
    const tens = before ? CHINESE_DATE_DIGITS[before] : 1;
    const ones = after ? CHINESE_DATE_DIGITS[after] : 0;
    return tens == null || ones == null ? null : tens * 10 + ones;
  }
  const digits = [...compact].map(
    (character) => CHINESE_DATE_DIGITS[character],
  );
  if (digits.some((digit) => digit == null)) return null;
  return Number(digits.join(""));
}

function extractDates(
  value: string,
): Array<{ originalValue: string; normalizedValue: string }> {
  const results: Array<{ originalValue: string; normalizedValue: string }> = [];
  const numericPattern =
    /(?<![A-Za-z0-9Oo])((2[0-2Oo][0-9Oo]{2})\s*(?:年|[-‐‑‒–—―－/.])\s*([0-9Oo]{1,2})\s*(?:月|[-‐‑‒–—―－/.])\s*([0-9Oo]{1,2})\s*(?:日|曰)?)(?![A-Za-z0-9Oo./-])/gu;
  for (const match of value.matchAll(numericPattern)) {
    const normalizedValue = buildDate(match[2], match[3], match[4]);
    if (normalizedValue) {
      results.push({ originalValue: match[0].trim(), normalizedValue });
    }
  }
  const compactPattern =
    /(?<![A-Za-z0-9])((2[0-2][0-9]{2})([0-9]{2})([0-9]{2}))(?![A-Za-z0-9])/gu;
  for (const match of value.matchAll(compactPattern)) {
    const normalizedValue = buildDate(match[2], match[3], match[4]);
    if (normalizedValue) {
      results.push({ originalValue: match[0].trim(), normalizedValue });
    }
  }
  const chinesePattern =
    /([〇○零O一壹二两贰三叁四肆五伍六陆七柒八捌九玖]{4})\s*年\s*([〇○零一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾]{1,3})\s*月\s*([〇○零一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾]{1,3})\s*[日曰]/gu;
  for (const match of value.matchAll(chinesePattern)) {
    const year = parseChineseDateYear(match[1]);
    const month = parseChineseCalendarNumber(match[2]);
    const day = parseChineseCalendarNumber(match[3]);
    if (year == null || month == null || day == null) continue;
    const normalizedValue = buildDate(String(year), String(month), String(day));
    if (normalizedValue) {
      results.push({ originalValue: match[0].trim(), normalizedValue });
    }
  }
  const unique = new Map<
    string,
    { originalValue: string; normalizedValue: string }
  >();
  for (const result of results) {
    unique.set(
      `${result.originalValue}\u0000${result.normalizedValue}`,
      result,
    );
  }
  return [...unique.values()];
}

function isContractSignaturePageContext(context: SourceContext): boolean {
  const pageText = context.lines
    .map((line) => line.normalized)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, "");
  return (
    /签署页|签章页/u.test(pageText) ||
    (/(?:甲方|委托方).{0,80}(?:盖章|签字|法定代表人|授权代表)/u.test(
      pageText,
    ) &&
      /(?:乙方|受托方).{0,80}(?:盖章|签字|法定代表人|授权代表)/u.test(
        pageText,
      )) ||
    (/甲方(?:盖章)?|委托方(?:盖章)?/u.test(pageText) &&
      /乙方(?:盖章)?|受托方(?:盖章)?/u.test(pageText) &&
      /签订日期|签署日期|日期/u.test(pageText))
  );
}

const CONTRACT_DATE_FRAGMENT_PATTERN =
  /^[0-9Oo〇○零一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾年月日曰\s./‐‑‒–—―－-]+$/u;
const CONTRACT_DATE_FOLLOWING_FIELD_BOUNDARY =
  /^(?:签订地点|签署地点|合同地点|甲\s*方|乙\s*方|委托方|受托方|合同金额|合同总价|有效期|有效期限|服务期限|履行期限|付款|发票|开票|验收|合同编号|编号)\s*[:：]?/u;

function collectAdjacentContractDateFragments(
  context: SourceContext,
  anchorIndex: number,
  initialText: string,
): {
  text: string;
  lines: LineContext[];
  lastLineIndex: number;
} | null {
  const fragments: string[] = [];
  const evidenceLines: LineContext[] = [];
  const normalizedInitial = initialText.replace(/^[\s:：]+/u, "").trim();
  if (normalizedInitial) {
    if (!CONTRACT_DATE_FRAGMENT_PATTERN.test(normalizedInitial)) return null;
    fragments.push(normalizedInitial);
  }
  let lastLineIndex = anchorIndex;
  let meaningfulFragments = fragments.length;
  for (let offset = 1; offset <= 8 && meaningfulFragments < 6; offset += 1) {
    const lineIndex = anchorIndex + offset;
    const line = context.lines[lineIndex];
    if (!line) break;
    const normalized = line.normalized.trim();
    if (!normalized) continue;
    if (CONTRACT_DATE_FOLLOWING_FIELD_BOUNDARY.test(normalized)) break;
    if (!CONTRACT_DATE_FRAGMENT_PATTERN.test(normalized)) break;
    fragments.push(normalized);
    evidenceLines.push(line);
    meaningfulFragments += 1;
    lastLineIndex = lineIndex;
    const fused = fragments.join("").replace(/\s+/g, "");
    if (extractDates(fused).length > 0) break;
  }
  if (fragments.length === 0) return null;
  return {
    text: fragments.join("").replace(/\s+/g, ""),
    lines: evidenceLines,
    lastLineIndex,
  };
}

function collectFormalExecutionDateCandidates(
  context: SourceContext,
): InternalCandidate[] {
  const candidates: InternalCandidate[] = [];
  for (let index = 0; index < context.lines.length; index += 1) {
    const windowLines = context.lines.slice(index, index + 3);
    const windowText = windowLines
      .map((line) => line.normalized)
      .filter(Boolean)
      .join("");
    const formalExecution = windowText.match(
      /(?:^|[。；;])\s*(?:本合同|本协议|本《[^》]{1,120}(?:合同|协议(?:书)?)》|本[^，。；;]{1,100}(?:合同|协议(?:书)?))(?:[（(][^（）()]{1,30}[）)])?(?:系)?由(?:以下|甲乙)?双方于\s*([^，。；;]{4,40}?)(?=在|正式(?:签订|签署|订立)|签订|签署|订立|达成)/u,
    );
    if (!formalExecution?.[1]) continue;
    const prefix = windowText.slice(0, formalExecution.index || 0);
    if (/(?:原合同|原协议|前次|历史|变更前|调整前|曾于)\s*$/u.test(prefix)) {
      continue;
    }
    const dates = extractDates(formalExecution[1]);
    if (dates.length !== 1) continue;
    const sourceConfidence = Math.min(
      ...windowLines.map((line) => line.confidence),
    );
    candidates.push({
      field: "contract_date",
      originalValue: dates[0].originalValue,
      normalizedValue: dates[0].normalizedValue,
      ...buildCandidateScoring(
        scoreWithSource(97, sourceConfidence),
        sourceConfidence,
        context.source,
      ),
      source: context.source,
      pageNumber: context.pageNumber,
      evidence: windowLines
        .map((line) => line.original || line.normalized)
        .filter(Boolean)
        .join("\n"),
      strongEvidence: true,
      recognitionEngine: context.recognitionEngine,
      dateOrigin: "labeled_date",
      verificationRole: "current_contract_date",
    });
  }
  return candidates;
}

function collectSignaturePageFooterDateCandidates(
  context: SourceContext,
): InternalCandidate[] {
  if (!isContractSignaturePageContext(context)) return [];
  const pageText = context.lines
    .map((line) => line.normalized)
    .filter(Boolean)
    .join(" ");
  if (
    /营业执照|登记机关|市场监督管理|统一社会信用代码|企业信用信息公示/u.test(
      pageText,
    )
  ) {
    return [];
  }
  const occurrences: Array<{
    date: ReturnType<typeof extractDates>[number];
    lines: LineContext[];
  }> = [];
  const nonSignatureDateRole =
    /(?:验收|付款|支付|开票|发票|交付|完成|生效|服务|履行|出生|成立|申请|结算|到账|收款)日期|(?:有效期限|有效期|服务期限|履行期限)/u;

  for (let index = 0; index < context.lines.length; index += 1) {
    const line = context.lines[index];
    const normalized = line.normalized.trim();
    if (!normalized) continue;
    const localWindow = context.lines
      .slice(Math.max(0, index - 4), index + 5)
      .map((candidate) => candidate.normalized)
      .filter(Boolean)
      .join(" ");
    if (nonSignatureDateRole.test(localWindow)) continue;
    const dates = extractDates(normalized);
    if (
      dates.length === 1 &&
      /^(?:日期\s*[:：]?\s*)?[0-9Oo〇○零一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾年月日曰\s./‐‑‒–—―－-]+$/u.test(
        normalized,
      )
    ) {
      occurrences.push({ date: dates[0], lines: [line] });
    }

    const isDateLabel = /^日\s*期\s*[:：]?$/u.test(normalized);
    const isSplitDateLabel =
      /^日$/u.test(normalized) &&
      /^期\s*[:：]?$/u.test(context.lines[index + 1]?.normalized || "");
    if (!isDateLabel && !isSplitDateLabel) continue;
    const preceding: LineContext[] = [];
    for (let offset = 1; offset <= 8; offset += 1) {
      const candidate = context.lines[index - offset];
      if (!candidate?.normalized) continue;
      if (!CONTRACT_DATE_FRAGMENT_PATTERN.test(candidate.normalized.trim())) {
        break;
      }
      preceding.unshift(candidate);
      const fused = preceding
        .map((fragment) => fragment.normalized)
        .join("")
        .replace(/\s+/g, "");
      const fusedDates = extractDates(fused);
      if (fusedDates.length === 1) {
        occurrences.push({ date: fusedDates[0], lines: [...preceding, line] });
        break;
      }
    }
  }

  const distinctDates = new Map<string, Array<(typeof occurrences)[number]>>();
  for (const occurrence of occurrences) {
    const grouped = distinctDates.get(occurrence.date.normalizedValue) || [];
    grouped.push(occurrence);
    distinctDates.set(occurrence.date.normalizedValue, grouped);
  }
  // 签章区出现两个不同合法日期时，本轮不猜测哪一个属于合同落款。
  if (distinctDates.size !== 1) return [];
  const selectedOccurrences = [...distinctDates.values()][0];
  const representative = selectedOccurrences[0];
  const evidenceLines = selectedOccurrences.flatMap(
    (occurrence) => occurrence.lines,
  );
  const sourceConfidence = Math.min(
    ...evidenceLines.map((line) => line.confidence),
  );
  return [
    {
      field: "contract_date",
      originalValue: representative.date.originalValue,
      normalizedValue: representative.date.normalizedValue,
      ...buildCandidateScoring(
        scoreWithSource(98, sourceConfidence),
        sourceConfidence,
        context.source,
      ),
      source: context.source,
      pageNumber: context.pageNumber,
      evidence: evidenceLines
        .map((line) => line.original || line.normalized)
        .filter(Boolean)
        .join("\n"),
      strongEvidence: true,
      recognitionEngine: context.recognitionEngine,
      dateOrigin: "signature_page",
      verificationRole: "current_contract_date",
    },
  ];
}

function collectExplicitLeaseStartDates(
  contexts: readonly SourceContext[],
): string[] {
  const values = new Set<string>();
  for (const context of contexts) {
    for (let index = 0; index < context.lines.length; index += 1) {
      const windowText = context.lines
        .slice(index, index + 3)
        .map((line) => line.normalized)
        .filter(Boolean)
        .join("");
      if (!/租赁期限.{0,16}(?:自|从)/u.test(windowText)) continue;
      const dates = extractDates(windowText);
      if (dates.length >= 1) values.add(dates[0]!.normalizedValue);
    }
  }
  return [...values];
}

/**
 * 签署页年份被印章或手写连笔压缩成两、三位时，仅允许用同一合同明确租赁
 * 起始年份恢复。恢复日期必须不晚于租赁开始日，且两者最多相差 31 天；
 * 该规则不能用于付款、注册、开票等其他日期，也不能跨年或远距离猜测。
 */
function recoverMalformedLeaseSignatureDate(
  value: string,
  leaseStartDates: readonly string[],
): { originalValue: string; normalizedValue: string } | null {
  const normalized = value.normalize("NFKC");
  const match = normalized.match(
    /([0-9]{2,3})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*[日曰]/u,
  );
  if (!match || !match[1]?.startsWith("2")) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const recovered = leaseStartDates
    .map((leaseStart) => {
      const year = Number(leaseStart.slice(0, 4));
      const normalizedValue = buildDate(
        String(year),
        String(month),
        String(day),
      );
      if (!normalizedValue) return null;
      const leaseTime = Date.parse(`${leaseStart}T00:00:00Z`);
      const signatureTime = Date.parse(`${normalizedValue}T00:00:00Z`);
      const differenceDays = (leaseTime - signatureTime) / 86_400_000;
      return differenceDays >= 0 && differenceDays <= 31
        ? { originalValue: match[0], normalizedValue }
        : null;
    })
    .filter(
      (
        candidate,
      ): candidate is { originalValue: string; normalizedValue: string } =>
        candidate !== null,
    );
  const unique = new Map(
    recovered.map((candidate) => [candidate.normalizedValue, candidate]),
  );
  return unique.size === 1 ? [...unique.values()][0]! : null;
}

function collectContractDateCandidates(
  contexts: readonly SourceContext[],
): InternalCandidate[] {
  const candidates: InternalCandidate[] = [];
  const explicitLeaseStartDates = collectExplicitLeaseStartDates(contexts);
  const strongAnchor =
    /合同签订(?:日期|时间)|签订(?:日期|时间)|签定(?:日期|时间)|签署日期|合同日期|订立日期|签约日期|落款日期/;
  const secondaryAnchor =
    /签订于|签署于|签约于|(?:甲\s*方|乙\s*方|盖章|签章).{0,20}日期|^日期\s*[:：]/;
  for (const context of contexts) {
    candidates.push(...collectFormalExecutionDateCandidates(context));
    const isSignaturePage = isContractSignaturePageContext(context);
    for (let index = 0; index < context.lines.length; index += 1) {
      const line = context.lines[index];
      const strongMatch = line.normalized.match(strongAnchor);
      const secondaryMatch = line.normalized.match(secondaryAnchor);
      const isStrong = Boolean(strongMatch);
      const isSecondary = Boolean(secondaryMatch);
      const signatureDates = isSignaturePage
        ? extractDates(line.normalized)
        : [];
      const signatureWindow = isSignaturePage
        ? context.lines
            .slice(Math.max(0, index - 4), index + 5)
            .map((candidate) => candidate.normalized)
            .filter(Boolean)
            .join(" ")
        : "";
      const hasSignatureDateAnchor =
        /合同签订(?:日期|时间)|签订(?:日期|时间)|签署日期|签约日期|订立日期|(?:甲\s*方|乙\s*方|委托方|受托方|盖章|签字).{0,20}日期|日期.{0,20}(?:甲\s*方|乙\s*方|委托方|受托方|盖章|签字)/u.test(
          signatureWindow,
        );
      const hasNonSignatureDateRole =
        /(?:验收|付款|支付|开票|发票|交付|完成|生效|服务|履行|出生|结算|到账|收款)日期|(?:有效期限|有效期|服务期限|履行期限)/u.test(
          signatureWindow,
        );
      const isStandaloneSignatureDate =
        signatureDates.length > 0 &&
        hasSignatureDateAnchor &&
        !hasNonSignatureDateRole;
      if (!isStrong && !isSecondary && !isStandaloneSignatureDate) continue;
      const anchorMatch = strongMatch || secondaryMatch;
      const anchorEnd =
        (anchorMatch?.index || 0) + (anchorMatch?.[0].length || 0);
      const isHistoricalDate = hasHistoricalQualifierBeforeAnchor(
        line.normalized,
        anchorMatch?.index || 0,
      );
      // 同一行也只读取签订／签署标签之后的文字，标签前的服务期限、编号或
      // 其他日期不得反向借作合同签订日期。
      let dateText =
        isStrong || isSecondary
          ? line.normalized.slice(anchorEnd)
          : line.normalized;
      let evidence = line.original || line.normalized;
      let candidateConfidence = line.confidence;
      let dates = isStandaloneSignatureDate
        ? signatureDates
        : extractDates(dateText);
      if (
        dates.length === 0 &&
        context.fieldScope === "contract_date" &&
        (isStrong || isSecondary)
      ) {
        // 手写值可能位于标签上方，检测框的阅读顺序因此是“日期、签订时间”。
        // 该逆向关联只允许发生在由签订日期锚点裁出的字段专属复核区域；
        // 普通整页来源仍禁止借用标签之前的日期，避免付款或期限日期串入。
        const precedingFragments: LineContext[] = [];
        for (let offset = 1; offset <= 6; offset += 1) {
          const precedingLine = context.lines[index - offset];
          if (!precedingLine) break;
          const normalized = precedingLine.normalized.trim();
          if (!normalized) continue;
          if (!CONTRACT_DATE_FRAGMENT_PATTERN.test(normalized)) break;
          precedingFragments.unshift(precedingLine);
          const fused = precedingFragments
            .map((fragment) => fragment.normalized)
            .join("")
            .replace(/\s+/g, "");
          const precedingDates = extractDates(fused);
          if (precedingDates.length === 1) {
            dateText = fused;
            dates = precedingDates;
            evidence = [
              ...precedingFragments.map(
                (fragment) => fragment.original || fragment.normalized,
              ),
              evidence,
            ].join("\n");
            candidateConfidence = Math.min(
              candidateConfidence,
              ...precedingFragments.map((fragment) => fragment.confidence),
            );
            break;
          }
        }
      }
      if (dates.length === 0) {
        // 手写日期常被检测器拆成“2021 / - / 11 / - / 22”等相邻框。
        // 只拼接标签之后连续的日期字符白名单行，遇下一个字段立即停止；
        // 上方日期、跨字段日期以及有效期／服务期／履行期仍不得借用。
        const adjacent = collectAdjacentContractDateFragments(
          context,
          index,
          dateText,
        );
        if (adjacent) {
          const adjacentDates = extractDates(adjacent.text);
          const nearbyContext = context.lines
            .slice(
              Math.max(0, index - 1),
              Math.min(context.lines.length, adjacent.lastLineIndex + 2),
            )
            .map((candidate) => candidate.normalized)
            .filter(Boolean)
            .join(" ");
          const hasValidityContext =
            /(?:合同)?有效(?:期限|期)|合同期限|服务期限|履行期限/.test(
              nearbyContext,
            );
          if (adjacentDates.length === 1 && !hasValidityContext) {
            dateText = adjacent.text;
            evidence = [
              evidence,
              ...adjacent.lines.map(
                (candidate) => candidate.original || candidate.normalized,
              ),
            ].join("\n");
            candidateConfidence = Math.min(
              candidateConfidence,
              ...adjacent.lines.map((candidate) => candidate.confidence),
            );
            dates = adjacentDates;
          }
        }
      }
      if (dates.length === 0 && isSignaturePage && (isStrong || isSecondary)) {
        const recovered = recoverMalformedLeaseSignatureDate(
          dateText || evidence,
          explicitLeaseStartDates,
        );
        if (recovered) {
          dates = [recovered];
          candidateConfidence = Math.min(candidateConfidence, 0.92);
        }
      }
      for (const date of dates) {
        candidates.push({
          field: "contract_date",
          originalValue: date.originalValue,
          normalizedValue: date.normalizedValue,
          ...buildCandidateScoring(
            scoreWithSource(
              isSignaturePage ? (isStrong ? 100 : 98) : isStrong ? 97 : 84,
              candidateConfidence,
            ),
            candidateConfidence,
            context.source,
          ),
          source: context.source,
          pageNumber: context.pageNumber,
          evidence,
          strongEvidence: isStrong || isStandaloneSignatureDate,
          recognitionEngine: context.recognitionEngine,
          dateOrigin: isSignaturePage ? "signature_page" : "labeled_date",
          verificationRole: isHistoricalDate
            ? "historical_contract_date"
            : "current_contract_date",
        });
      }
    }
    candidates.push(...collectSignaturePageFooterDateCandidates(context));
  }
  return candidates;
}

interface ContractValidityYearRange {
  startYear: number;
  endYear: number;
}

function parseContextYear(value: string): number | null {
  const year = Number(value.replace(/[Oo]/g, "0"));
  return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : null;
}

/**
 * 只提取正文中带有明确期限锚点的年份区间。该上下文仅用于阻止自动采用，
 * 不能提出日期候选，更不能把签订日期推测成期限起始年份。
 */
function collectExplicitValidityYearRanges(
  contexts: readonly SourceContext[],
): ContractValidityYearRange[] {
  const ranges = new Map<string, ContractValidityYearRange>();
  const validityAnchor = /(?:合同)?有效(?:期限|期)|合同期限|服务期限|履行期限/;
  const yearRangePattern =
    /((?:2[0-2Oo][0-9Oo]{2}))(?:年)?[^。；;]{0,32}?(?:至|到|—|–|~|～|－|-)((?:2[0-2Oo][0-9Oo]{2}))(?:年)?/g;

  for (const context of contexts) {
    if (context.confidence < 60) continue;
    for (let index = 0; index < context.lines.length; index += 1) {
      const line = context.lines[index];
      if (line.confidence < 60 || !validityAnchor.test(line.normalized)) {
        continue;
      }
      const window = context.lines
        .slice(index, index + 4)
        .map((candidate) => candidate.normalized)
        .filter(Boolean)
        .join("")
        .replace(/\s+/g, "");
      for (const match of window.matchAll(yearRangePattern)) {
        const startYear = parseContextYear(match[1]);
        const endYear = parseContextYear(match[2]);
        if (startYear == null || endYear == null) continue;
        ranges.set(`${startYear}-${endYear}`, { startYear, endYear });
      }
    }
  }

  return [...ranges.values()];
}

function isContractDateYearClearlyContradicted(
  normalizedDate: string,
  ranges: readonly ContractValidityYearRange[],
): boolean {
  const contractYear = Number(normalizedDate.slice(0, 4));
  if (!Number.isInteger(contractYear)) return false;
  const validRanges = ranges.filter(
    ({ startYear, endYear }) => startYear <= endYear,
  );
  if (validRanges.length === 0) return false;
  // 签订发生在期限起始年的上一年很常见，因此只把落在全部有效区间之外的
  // 年份视为明显矛盾。该判断只用于安全拒绝或触发重看当前页面像素。
  return !validRanges.some(
    ({ startYear, endYear }) =>
      contractYear >= startYear - 1 && contractYear <= endYear,
  );
}

function collectValidityRangesFromPaddleLines(
  lines: readonly ContractPaddleOcrLine[],
): ContractValidityYearRange[] {
  const contextLines = lines.map((line) => {
    const original = String(line.text || "").trim();
    return {
      original,
      normalized: normalizeLine(original),
      confidence: clampConfidence(
        line.confidence <= 1 ? line.confidence * 100 : line.confidence,
      ),
    };
  });
  return collectExplicitValidityYearRanges([
    {
      source: "ocr_300",
      confidence: 100,
      recognitionEngine: "paddleocr",
      verificationOnly: false,
      lines: contextLines,
      text: contextLines.map((line) => line.normalized).join("\n"),
    },
  ]);
}

function exactEvidenceComparable(value: string): string {
  return toHalfWidth(value)
    .toLowerCase()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[^\p{Script=Han}a-z0-9]/gu, "");
}

function hasExactVerificationAnchor(
  field: ContractOcrFieldName,
  comparableEvidence: string,
): boolean {
  if (field === "party_a") {
    return /甲方|委\s*托\s*人|委托方|发包方|采购方|买方|许可方|出租方/.test(
      comparableEvidence,
    );
  }
  if (field === "party_b") {
    return /乙方|受\s*托\s*人|受托方|承包方|供应商|卖方|被许可方|承租方/.test(
      comparableEvidence,
    );
  }
  if (field === "project_name") {
    return /项目名称|工程名称|服务项目|甲方委托乙方就|项目进行/.test(
      comparableEvidence,
    );
  }
  if (field === "amount") {
    return /合同金额|合同总价|报酬总额|人民币|含税/.test(comparableEvidence);
  }
  if (field === "contract_date") {
    return /合同签订日期|合同签订时间|签订日期|签订时间|签定时间|签署日期/.test(
      comparableEvidence,
    );
  }
  return false;
}

function verificationEvidenceContainsCandidate(
  candidate: InternalCandidate,
  evidence: string,
): boolean {
  const compactEvidence = normalizeLine(evidence).replace(/\s+/g, "");
  const roleEvidence = evidence
    .split(/\r?\n/)
    .map((line) => normalizeLine(line).replace(/\s+/g, ""))
    .join("\n");
  if (candidate.field === "amount") {
    const targetAmount = Number(candidate.normalizedValue);
    const absoluteTarget = Number.isFinite(targetAmount)
      ? normalizeAmount(Math.abs(targetAmount))
      : candidate.normalizedValue;
    const amountMatches = extractMoneyValues(compactEvidence, true).some(
      (amount) => amount.normalizedValue === absoluteTarget,
    );
    if (!amountMatches) return false;
    if (candidate.amountRole !== "relation_adjustment") {
      const evidenceCandidates = collectAmountCandidates(
        buildSourceContexts(roleEvidence, {
          defaultSource: "plain_text",
          defaultConfidence: 100,
        }),
      );
      return evidenceCandidates.some(
        (evidenceCandidate) =>
          evidenceCandidate.normalizedValue === candidate.normalizedValue &&
          evidenceCandidate.verificationRole === candidate.verificationRole,
      );
    }
    return targetAmount < 0
      ? /减少|核减|调减|扣减|减除|冲减|终止|解除/.test(compactEvidence)
      : /增加|增补|追加|调增|核增/.test(compactEvidence);
  }
  if (candidate.field === "contract_date") {
    return collectContractDateCandidates(
      buildSourceContexts(roleEvidence, {
        defaultSource: "plain_text",
        defaultConfidence: 100,
      }),
    ).some(
      (dateCandidate) =>
        dateCandidate.normalizedValue === candidate.normalizedValue &&
        dateCandidate.verificationRole === candidate.verificationRole,
    );
  }
  return exactEvidenceComparable(evidence).includes(
    exactEvidenceComparable(candidate.normalizedValue),
  );
}

/**
 * 第二识别通道只承担精确复核：它不能提出、纠正或补全字段，只能在自己的
 * 原始文字中完整找到第一通道的规范值。这样既保留独立性，也不会把第二通道
 * 的单字误识别静默覆盖成看似正确的结果。
 */
function collectExactVerificationCandidates(
  verificationContexts: readonly SourceContext[],
  extractedCandidates: readonly InternalCandidate[],
): InternalCandidate[] {
  const verified: InternalCandidate[] = [];
  const uniqueExtracted = new Map<string, InternalCandidate>();
  for (const candidate of extractedCandidates) {
    if (!candidate.strongEvidence || candidate.confidence < 60) continue;
    const key = `${candidate.field}:${candidate.normalizedValue}:${candidate.verificationRole || "default"}`;
    const current = uniqueExtracted.get(key);
    const candidatePriority = candidate.partyAnchorPriority || 0;
    const currentPriority = current?.partyAnchorPriority || 0;
    if (
      !current ||
      candidatePriority > currentPriority ||
      (candidatePriority === currentPriority &&
        candidate.confidence > current.confidence)
    ) {
      uniqueExtracted.set(key, candidate);
    }
  }

  for (const context of verificationContexts) {
    for (const candidate of uniqueExtracted.values()) {
      if (
        candidate.field === "category" ||
        candidate.recognitionEngine === context.recognitionEngine
      ) {
        continue;
      }
      if (!exactEvidenceComparable(candidate.normalizedValue)) continue;

      for (let start = 0; start < context.lines.length; start += 1) {
        for (let count = 1; count <= 4; count += 1) {
          const selectedLines = context.lines
            .slice(start, start + count)
            .filter((line) => line.normalized);
          if (selectedLines.length === 0) continue;
          const evidence = selectedLines
            .map((line) => line.original || line.normalized)
            .join("\n");
          const comparableEvidence = exactEvidenceComparable(evidence);
          if (
            !verificationEvidenceContainsCandidate(candidate, evidence) ||
            !hasExactVerificationAnchor(candidate.field, comparableEvidence)
          ) {
            continue;
          }
          const evidenceConfidence = Math.min(
            ...selectedLines.map((line) => line.confidence),
          );
          verified.push({
            ...candidate,
            originalValue: candidate.normalizedValue,
            ...buildCandidateScoring(
              scoreWithSource(98, evidenceConfidence),
              evidenceConfidence,
              context.source,
            ),
            source: context.source,
            pageNumber: context.pageNumber,
            evidence,
            strongEvidence: true,
            recognitionEngine: context.recognitionEngine,
          });
          count = 5;
          start = context.lines.length;
        }
      }
    }
  }

  const extractedCategories = new Set(
    extractedCandidates
      .filter(
        (candidate) =>
          candidate.field === "category" &&
          candidate.strongEvidence &&
          candidate.confidence >= 60,
      )
      .map((candidate) => candidate.normalizedValue),
  );
  for (const category of collectCategoryCandidates(verificationContexts)) {
    if (
      category.strongEvidence &&
      extractedCategories.has(category.normalizedValue)
    ) {
      verified.push(category);
    }
  }

  return verified;
}

function hasAutomaticVerificationEvidence(
  field: ContractOcrFieldName,
  normalizedValue: string,
  candidates: readonly InternalCandidate[],
  verificationRole: InternalCandidate["verificationRole"],
): boolean {
  const relevant = candidates.filter(
    (candidate) =>
      candidate.field === field &&
      candidate.strongEvidence &&
      candidate.confidence >= 60,
  );
  const agreeing = relevant.filter(
    (candidate) =>
      candidate.normalizedValue === normalizedValue &&
      candidate.confidence >= 90 &&
      candidate.verificationRole === verificationRole,
  );
  if (
    field === "amount" &&
    agreeing.some((candidate) => candidate.amountRole === "relation_adjustment")
  ) {
    // 补充／终止协议的增减额具有方向、履行状态和最终性语义。即使两个识别
    // 通道文字完全一致，也不伪造独立验证满分；自动采用继续由金额角色、
    // 局部增强复核、候选排序和业务硬校验共同决定。
    return false;
  }
  const pdfTextEvidence = agreeing.filter(
    (candidate) => candidate.source === "pdf_text",
  );
  const visiblePdfOcrEvidence = agreeing.filter((candidate) =>
    candidate.source.startsWith("ocr_"),
  );
  const hasSamePageIndependentPdfEvidence = pdfTextEvidence.some(
    (textCandidate) =>
      textCandidate.pageNumber != null &&
      visiblePdfOcrEvidence.some(
        (ocrCandidate) =>
          ocrCandidate.pageNumber === textCandidate.pageNumber &&
          ocrCandidate.recognitionEngine !== textCandidate.recognitionEngine,
      ),
  );
  if (hasSamePageIndependentPdfEvidence) {
    // PDF（便携式文档格式）文字层可能隐藏、过期或与可见页面不一致，只有
    // 同一页文字层候选和页面渲染后的图像识别候选精确一致时才形成两类
    // 独立证据，不能用另一页偶然出现的相同文字替隐藏文字层背书。
    // 任一高分冲突候选仍由上方冲突门禁阻断，并保留在候选证据中。
    return true;
  }
  if (pdfTextEvidence.length > 0) {
    // 只要当前值来自 PDF（便携式文档格式）文字层，同页可见图像证据缺失就
    // 必须直接拒绝；不能再由其他页面或未来新增的两套图像引擎交叉背书。
    return false;
  }

  // plain_text（调用方已验证的纯文字）只供无文件的受控解析入口使用。
  // DOC／DOCX（文字处理文档）来源未执行可靠的可见页面渲染比对，单独只能
  // 保留 0 至 99 的诊断分，不得在这里形成自动验证 100。
  if (agreeing.some((candidate) => candidate.source === "plain_text")) {
    return true;
  }

  // 多个 DPI（每英寸点数）只是同一引擎的重复采样，不能把诊断分提升为
  // 100；扫描件必须由互相独立的识别引擎给出一致结果才形成自动验证证据。
  const independentOcrEngines = new Set(
    agreeing
      .filter((candidate) => candidate.source.startsWith("ocr_"))
      .map((candidate) => candidate.recognitionEngine),
  );
  return independentOcrEngines.size >= 2;
}

function mergeCandidates(
  field: ContractOcrFieldName,
  candidates: readonly InternalCandidate[],
  diagnostics?: ContractOcrMergeDiagnostics,
  expectedCategory?: ParseContractTextOptions["expectedCategory"],
): ContractOcrField {
  const matching = candidates.filter((candidate) => candidate.field === field);
  if (matching.length === 0) {
    diagnostics?.ranking.set(field, []);
    return {
      field,
      originalValue: "",
      normalizedValue: "",
      confidence: 0,
      ocrConfidence: null,
      fieldScore: 0,
      source: "rule",
      warnings: [`未识别到${FIELD_LABELS[field]}`],
    };
  }

  const grouped = new Map<string, InternalCandidate[]>();
  for (const candidate of matching) {
    const values = grouped.get(candidate.normalizedValue) || [];
    values.push(candidate);
    grouped.set(candidate.normalizedValue, values);
  }
  let ranked = [...grouped.entries()]
    .map(([normalizedValue, values]) => {
      const sortedValues = [...values].sort(
        (left, right) => right.confidence - left.confidence,
      );
      const evidenceCount = new Set(
        values.map((value) =>
          value.source.startsWith("ocr_")
            ? `ocr:${value.pageNumber || 0}`
            : `${value.source}:${value.pageNumber || 0}:${normalizeLine(value.evidence)}`,
        ),
      ).size;
      const ocrSourceCount = new Set(
        values
          .filter((value) => value.source.startsWith("ocr_"))
          .map((value) => value.source),
      ).size;
      const samePageProjectConsensusBoost =
        field === "project_name"
          ? Math.min(6, Math.max(0, ocrSourceCount - 1) * 2)
          : 0;
      const projectConsensusRankingBoost =
        field === "project_name" && ocrSourceCount > 1 ? 12 : 0;
      const explicitProjectBoundaryBoost =
        field === "project_name" &&
        values.some(
          (value) =>
            value.projectOrigin === "labeled_field" &&
            value.strongEvidence === true,
        ) &&
        matching.some(
          (candidate) =>
            candidate.projectOrigin === "body_description" &&
            candidate.normalizedValue === `${normalizedValue}项目`,
        )
          ? 24
          : 0;
      const amountKinds = new Set(
        values.map((value) => value.kind).filter(Boolean),
      );
      const hasAmountCrossFormatAgreement =
        field === "amount" &&
        amountKinds.has("arabic_amount") &&
        amountKinds.has("chinese_amount");
      const confidenceCap = Math.max(
        ...values.map((value) => value.confidenceCap ?? 100),
      );
      const projectRankingScore =
        field === "project_name"
          ? sortedValues[0].confidence +
            projectValueQuality(normalizedValue) +
            projectConsensusRankingBoost +
            explicitProjectBoundaryBoost +
            Math.max(
              ...values.map((value) =>
                value.projectAnchorPriority === 3
                  ? 36
                  : value.projectAnchorPriority === 2
                    ? 4
                    : value.projectAnchorPriority === 1
                      ? 4
                      : 0,
              ),
            ) +
            Math.max(
              ...values.map((value) =>
                value.projectServiceRole === "damaged_suffix_fusion"
                  ? 20
                  : value.projectServiceRole === "explicit_field"
                    ? 8
                    : value.projectServiceRole === "cover_structure"
                      ? 6
                      : value.projectServiceRole === "body_corroboration"
                        ? 4
                        : 0,
              ),
            ) +
            (values.some((value) => value.pageNumber === 1) &&
            /(?:项目|工程)$/u.test(normalizedValue)
              ? 8
              : 0) +
            Math.max(
              ...values.map((value) =>
                value.projectOrigin === "cover_title"
                  ? 3
                  : value.projectOrigin === "labeled_field"
                    ? 5
                    : 0,
              ),
            )
          : 0;
      const dateRankingScore =
        field === "contract_date"
          ? sortedValues[0].confidence +
            (values.some((value) => value.dateOrigin === "signature_page")
              ? 12
              : 0)
          : 0;
      return {
        normalizedValue,
        values: sortedValues,
        // 仅供旁路诊断追踪参与融合的候选，不参与任何业务计算。
        diagnosticValues: sortedValues,
        hasAmountCrossFormatAgreement,
        confidenceCap,
        projectRankingScore,
        projectOcrSourceCount: ocrSourceCount,
        dateRankingScore,
        confidence: Math.min(
          confidenceCap,
          clampConfidence(
            sortedValues[0].confidence +
              Math.min(
                field === "amount" ? 12 : 8,
                (evidenceCount - 1) * (field === "amount" ? 8 : 4),
              ) +
              samePageProjectConsensusBoost +
              (hasAmountCrossFormatAgreement ? 12 : 0),
          ),
        ),
      };
    })
    .sort((left, right) => {
      if (field === "project_name") {
        const projectDifference =
          right.projectRankingScore - left.projectRankingScore;
        if (projectDifference !== 0) return projectDifference;
        const lengthDifference =
          meaningfulLength(right.normalizedValue) -
          meaningfulLength(left.normalizedValue);
        if (lengthDifference !== 0) return lengthDifference;
      }
      if (field === "contract_date") {
        const dateDifference = right.dateRankingScore - left.dateRankingScore;
        if (dateDifference !== 0) return dateDifference;
      }
      return right.confidence - left.confidence;
    });
  const orderingReasonsByValue = new Map<string, Set<string>>();
  const addOrderingReason = (normalizedValue: string, reason: string) => {
    const reasons = orderingReasonsByValue.get(normalizedValue) || new Set();
    reasons.add(reason);
    orderingReasonsByValue.set(normalizedValue, reasons);
  };

  if (
    field === "project_name" &&
    expectedCategory === "main_business" &&
    ranked.length > 1
  ) {
    const firstPageLabeledEntries = ranked.filter((entry) =>
      entry.values.some(
        (candidate) =>
          candidate.pageNumber === 1 &&
          candidate.projectOrigin === "labeled_field" &&
          candidate.strongEvidence === true &&
          !hasUnclosedParenthesis(candidate.originalValue) &&
          !/(?:技术|咨询服|规划许可|施工许可|输变电|变电)$/u.test(
            normalizeLine(candidate.normalizedValue).replace(/\s+/g, ""),
          ),
      ),
    );
    if (firstPageLabeledEntries.length === 1) {
      const firstPageLabeledEntry = firstPageLabeledEntries[0];
      // 主营项目合同以首页明确“项目名称”字段为准。后页正文只可在首页
      // 缺失、明显截断或存在首页同级冲突时参与补强，不得覆盖首页完整值。
      ranked = [firstPageLabeledEntry];
      addOrderingReason(
        firstPageLabeledEntry.normalizedValue,
        "PROJECT_MAIN_BUSINESS_FIRST_PAGE_LABELED_PRIORITY",
      );
    }
  }

  if (field === "project_name" && ranked.length > 1) {
    const isAuthoritativeProjectCandidate = (
      candidate: InternalCandidate,
      entry: (typeof ranked)[number],
    ) =>
      candidate.projectOrigin === "labeled_field" &&
      candidate.strongEvidence === true &&
      !hasUnclosedParenthesis(candidate.originalValue) &&
      !/(?:技术|咨询服|规划许可|施工许可|输变电|变电)$/u.test(
        normalizeLine(candidate.normalizedValue).replace(/\s+/g, ""),
      ) &&
      (candidate.projectAnchorPriority === 3 ||
        (candidate.projectAnchorPriority === 2 &&
          (!candidate.source.startsWith("ocr_") ||
            (candidate.pageNumber === 1 && entry.projectOcrSourceCount > 1))));
    const highestProjectAnchorPriority = Math.max(
      0,
      ...ranked.flatMap((entry) =>
        entry.values
          .filter((candidate) =>
            isAuthoritativeProjectCandidate(candidate, entry),
          )
          .map((candidate) => candidate.projectAnchorPriority || 0),
      ),
    );
    const authoritativeProjectEntries = ranked.filter((entry) =>
      entry.values.some(
        (candidate) =>
          isAuthoritativeProjectCandidate(candidate, entry) &&
          candidate.projectAnchorPriority === highestProjectAnchorPriority &&
          highestProjectAnchorPriority >= 2,
      ),
    );
    if (authoritativeProjectEntries.length === 1) {
      const authoritativeProjectEntry = authoritativeProjectEntries[0];
      // 独立“项目：”是最高权威字段；DOC／DOCX（文字处理文档）等结构化
      // 文字中的“项目名称：”“项目全称：”也是直接声明。唯一且完整时，
      // 首页合同标题、正文委托句和服务范围只能作为旁路证据，不能把公司
      // 抬头、“前期手续”或语法词追加到字段值。扫描 OCR（光学字符识别）
      // 中的普通“项目名称：”仍参与多档复核，避免单档错字压过正文共识；
      // 若存在两个不同的同级权威字段值则继续保留冲突，绝不擅自选择。
      ranked = [authoritativeProjectEntry];
      addOrderingReason(
        authoritativeProjectEntry.normalizedValue,
        "PROJECT_AUTHORITATIVE_LABELED_FIELD_PRIORITY",
      );
    }
  }

  if (field === "project_name" && ranked.length > 1) {
    const grammaticalProjectSuffixEntries = new Set<(typeof ranked)[number]>();
    for (const baseEntry of ranked) {
      const suffixEntry = ranked.find(
        (entry) =>
          entry !== baseEntry &&
          entry.normalizedValue === `${baseEntry.normalizedValue}项目` &&
          entry.values.every(
            (candidate) => candidate.projectOrigin === "body_description",
          ) &&
          entry.values.some((candidate) =>
            /项目进行|进行的专项/u.test(
              String(candidate.evidence || "").replace(/\s+/g, ""),
            ),
          ),
      );
      const baseCorroboratedByVisibleBody =
        baseEntry.projectOcrSourceCount > 1 &&
        /(?:许可证|规划许可|施工许可|核验意见)$/u.test(
          normalizeLine(baseEntry.normalizedValue).replace(/\s+/g, ""),
        ) &&
        baseEntry.values.some(
          (candidate) =>
            candidate.projectOrigin === "body_description" &&
            /项目进行|进行的专项/u.test(
              String(candidate.evidence || "").replace(/\s+/g, ""),
            ),
        );
      if (suffixEntry && baseCorroboratedByVisibleBody) {
        grammaticalProjectSuffixEntries.add(suffixEntry);
        addOrderingReason(
          baseEntry.normalizedValue,
          "PROJECT_BODY_GRAMMATICAL_SUFFIX_REMOVED",
        );
      }
    }
    if (grammaticalProjectSuffixEntries.size > 0) {
      ranked = ranked.filter(
        (entry) => !grammaticalProjectSuffixEntries.has(entry),
      );
    }
  }

  if (field === "project_name" && ranked.length > 1) {
    const explicitBoundary = ranked.find((entry) =>
      entry.values.some(
        (candidate) =>
          candidate.projectOrigin === "labeled_field" &&
          candidate.strongEvidence === true &&
          !hasUnclosedParenthesis(candidate.originalValue),
      ),
    );
    if (explicitBoundary) {
      const grammaticalSuffixEntries = ranked.filter(
        (entry) =>
          entry !== explicitBoundary &&
          entry.normalizedValue === `${explicitBoundary.normalizedValue}项目` &&
          entry.values.every(
            (candidate) => candidate.projectOrigin === "body_description",
          ) &&
          entry.values.some((candidate) =>
            /项目进行|进行的专项/u.test(
              String(candidate.evidence || "").replace(/\s+/g, ""),
            ),
          ),
      );
      if (grammaticalSuffixEntries.length > 0) {
        const suppressedEntries = new Set(grammaticalSuffixEntries);
        ranked = ranked.filter((entry) => !suppressedEntries.has(entry));
        addOrderingReason(
          explicitBoundary.normalizedValue,
          "PROJECT_EXPLICIT_FIELD_BOUNDARY_PRIORITY",
        );
      }
    }
  }

  if (field === "project_name" && ranked.length > 1) {
    const leading = ranked[0];
    const repeatedOcrVariant = ranked
      .slice(1)
      .find(
        (entry) =>
          entry.projectOcrSourceCount > 1 &&
          differsBySingleProjectPrefixGlyph(
            leading.normalizedValue,
            entry.normalizedValue,
          ),
      );
    if (repeatedOcrVariant) {
      addOrderingReason(
        repeatedOcrVariant.normalizedValue,
        "PROJECT_REPEATED_OCR_VARIANT_PRIORITY",
      );
      ranked = [
        repeatedOcrVariant,
        ...ranked.filter((entry) => entry !== repeatedOcrVariant),
      ];
    }
  }

  const suppressedAmountTruncations: string[] = [];
  if (field === "amount" && ranked.length > 1) {
    const crossVerified = ranked.filter(
      (entry) => entry.hasAmountCrossFormatAgreement,
    );
    if (crossVerified.length === 1) {
      const verified = crossVerified[0];
      addOrderingReason(
        verified.normalizedValue,
        "AMOUNT_CROSS_FORMAT_AGREEMENT_PRIORITY",
      );
      const verifiedNumber = Number(verified.normalizedValue);
      const verifiedDigits = Number.isInteger(verifiedNumber)
        ? String(Math.abs(verifiedNumber))
        : "";
      const verifiedRoles = new Set(
        verified.values.map((candidate) => candidate.amountRole),
      );
      const verifiedPages = new Set(
        verified.values
          .map((candidate) => candidate.pageNumber)
          .filter((page): page is number => page != null),
      );
      ranked = ranked.filter((entry) => {
        if (entry === verified || entry.hasAmountCrossFormatAgreement) {
          return true;
        }
        const numericValue = Number(entry.normalizedValue);
        const digits = Number.isInteger(numericValue)
          ? String(Math.abs(numericValue))
          : "";
        const sharesRole = entry.values.some((candidate) =>
          verifiedRoles.has(candidate.amountRole),
        );
        const sharesPage =
          verifiedPages.size === 0 ||
          entry.values.some(
            (candidate) =>
              candidate.pageNumber != null &&
              verifiedPages.has(candidate.pageNumber),
          );
        const isTrailingDigitTruncation =
          Boolean(digits && verifiedDigits) &&
          verifiedDigits.endsWith(digits) &&
          verifiedDigits.length - digits.length >= 1 &&
          verifiedDigits.length - digits.length <= 3;
        if (sharesRole && sharesPage && isTrailingDigitTruncation) {
          suppressedAmountTruncations.push(entry.normalizedValue);
          return false;
        }
        return true;
      });
      ranked.sort((left, right) => {
        if (left === verified) return -1;
        if (right === verified) return 1;
        return right.confidence - left.confidence;
      });
    }
  }

  if (field === "project_name" && ranked.length > 1) {
    const leading = ranked[0];
    const isSafeProjectExpansion = (left: string, right: string) => {
      const shorter = left.length <= right.length ? left : right;
      const longer = left.length <= right.length ? right : left;
      const parentheticalSuffix = shorter.match(
        /^(.{2,80}?)(（[^（）]{1,40}）)$/u,
      );
      if (
        parentheticalSuffix &&
        longer.startsWith(parentheticalSuffix[1]) &&
        longer.endsWith(parentheticalSuffix[2]) &&
        longer.length > shorter.length
      ) {
        return true;
      }
      if (!longer.startsWith(shorter)) return false;
      const suffix = longer.slice(shorter.length);
      if (/^[）)]$/u.test(shorter.slice(-1)) && /^前期手续/u.test(suffix)) {
        return true;
      }
      return (
        /^（[^（）]{1,40}）$/u.test(suffix) ||
        isSafeUnmarkedProjectContinuation(shorter, suffix)
      );
    };
    const compatible = ranked.filter(
      (entry) =>
        entry === leading ||
        isSafeProjectExpansion(leading.normalizedValue, entry.normalizedValue),
    );
    if (compatible.length > 1) {
      const mostComplete = compatible.reduce((selected, entry) =>
        entry.normalizedValue.length > selected.normalizedValue.length
          ? entry
          : selected,
      );
      const strengthened = {
        ...mostComplete,
        diagnosticValues: [
          ...new Set(compatible.flatMap((entry) => entry.diagnosticValues)),
        ],
        projectRankingScore:
          Math.max(...compatible.map((entry) => entry.projectRankingScore)) + 1,
        confidence: clampConfidence(
          mostComplete.confidence + Math.min(8, (compatible.length - 1) * 4),
        ),
      };
      addOrderingReason(
        strengthened.normalizedValue,
        "PROJECT_SAFE_EXPANSION_FUSION",
      );
      const compatibleSet = new Set(compatible);
      ranked = [
        strengthened,
        ...ranked.filter((entry) => !compatibleSet.has(entry)),
      ].sort((left, right) => {
        const projectDifference =
          right.projectRankingScore - left.projectRankingScore;
        if (projectDifference !== 0) return projectDifference;
        return right.confidence - left.confidence;
      });
    }
  }

  if ((field === "party_a" || field === "party_b") && ranked.length > 1) {
    const leading = ranked[0];
    const isTruncatedOrganization = (left: string, right: string) => {
      const shorter = left.length <= right.length ? left : right;
      const longer = left.length <= right.length ? right : left;
      const missingSuffix = longer.slice(shorter.length);
      return (
        longer.startsWith(shorter) &&
        (longer.length - shorter.length <= 2 ||
          /^(?:有限责任公司|股份有限公司|集团有限公司|有限公司|公司|研究院|设计院|事务所|委员会|管理局|中心|研究所)$/u.test(
            missingSuffix,
          )) &&
        /(?:有限责任公司|股份有限公司|集团有限公司|有限公司|研究院|设计院|事务所|委员会|管理局|中心|政府|大学|学院|医院|协会|研究所)$/.test(
          longer,
        )
      );
    };
    const compatible = ranked.filter(
      (entry) =>
        entry === leading ||
        isTruncatedOrganization(leading.normalizedValue, entry.normalizedValue),
    );
    if (compatible.length > 1) {
      const mostComplete = compatible.reduce((selected, entry) =>
        entry.normalizedValue.length > selected.normalizedValue.length
          ? entry
          : selected,
      );
      const compatibleSet = new Set(compatible);
      ranked = [
        {
          ...mostComplete,
          diagnosticValues: [
            ...new Set(compatible.flatMap((entry) => entry.diagnosticValues)),
          ],
          confidence: clampConfidence(
            mostComplete.confidence + Math.min(8, (compatible.length - 1) * 4),
          ),
        },
        ...ranked.filter((entry) => !compatibleSet.has(entry)),
      ].sort((left, right) => right.confidence - left.confidence);
      addOrderingReason(
        mostComplete.normalizedValue,
        "PARTY_TRUNCATION_FUSION",
      );
    }
  }

  diagnostics?.ranking.set(
    field,
    ranked.map((entry, index) => ({
      rank: index + 1,
      normalizedValue: entry.normalizedValue,
      score:
        field === "project_name"
          ? entry.projectRankingScore
          : field === "contract_date"
            ? entry.dateRankingScore
            : entry.confidence,
      fieldScore: entry.confidence,
      orderingReasonCodes: [
        ...(orderingReasonsByValue.get(entry.normalizedValue) || []),
      ],
      selected: index === 0,
      candidateIds: entry.diagnosticValues
        .map((candidate) => diagnostics.candidateIds.get(candidate))
        .filter((candidateId): candidateId is string => Boolean(candidateId)),
    })),
  );

  const best = ranked[0];
  const bestCandidate = best.values[0];
  let confidence = best.confidence;
  const warnings: string[] = [];
  if (suppressedAmountTruncations.length > 0) {
    warnings.push(
      `中文大写金额与阿拉伯数字一致，已排除疑似 OCR（光学字符识别）截断候选 ${[
        ...new Set(suppressedAmountTruncations),
      ].join("、")}`,
    );
  }
  warnings.push(
    ...new Set(best.values.flatMap((candidate) => candidate.warnings || [])),
  );
  const competing = ranked[1];
  if (competing && competing.confidence >= 60) {
    if (competing.confidence >= 85) confidence = Math.min(confidence, 55);
    else if (competing.confidence >= 70) confidence = Math.min(confidence, 75);
    else confidence = Math.min(confidence, 85);
    warnings.push(
      `${FIELD_LABELS[field]}存在候选冲突：${best.normalizedValue} / ${competing.normalizedValue}`,
    );
  }

  const automaticallyVerified =
    best.confidenceCap === 100 &&
    !(competing && competing.confidence >= 60) &&
    hasAutomaticVerificationEvidence(
      field,
      best.normalizedValue,
      matching,
      bestCandidate.verificationRole,
    );

  const sources = new Set(best.values.map((candidate) => candidate.source));
  const source: ContractOcrSource =
    sources.size > 1 ? "mixed" : bestCandidate.source;
  const fieldScore = automaticallyVerified ? 100 : clampConfidence(confidence);
  const result: ContractOcrField = {
    field,
    originalValue: bestCandidate.originalValue,
    normalizedValue: best.normalizedValue,
    confidence: fieldScore,
    fieldScore,
    ocrConfidence: minimumCandidateOcrConfidence(best.values),
    source,
    pageNumber: bestCandidate.pageNumber,
    evidence: best.values.slice(0, 5).map((candidate) => ({
      text: candidate.evidence,
      source: candidate.source,
      pageNumber: candidate.pageNumber,
      confidence: candidate.confidence,
      fieldScore: candidate.fieldScore,
      ocrConfidence: candidate.ocrConfidence,
      recognitionEngine: candidate.recognitionEngine,
    })),
    candidates: ranked.slice(0, 5).map((entry) => ({
      originalValue: entry.values[0].originalValue,
      normalizedValue: entry.normalizedValue,
      confidence: entry.confidence,
      fieldScore: entry.confidence,
      ocrConfidence: minimumCandidateOcrConfidence(entry.values),
      source:
        new Set(entry.values.map((candidate) => candidate.source)).size > 1
          ? "mixed"
          : entry.values[0].source,
      pageNumber: entry.values[0].pageNumber,
      evidence: entry.values[0].evidence,
      recognitionEngine: entry.values[0].recognitionEngine,
    })),
  };
  if (!isContractOcrVerifiedConfidence(result.confidence)) {
    warnings.push(
      `${FIELD_LABELS[field]}诊断分为 ${result.confidence}，该分数仅用于风险判断；系统将结合局部增强复核、候选排序与业务硬校验自动决定最终值`,
    );
  }
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

/**
 * 既有校验器仍会修改 confidence（兼容评分字段）。在结果离开解析器前统一
 * 回写 fieldScore（字段规则评分），保证两者完全一致且不改变原有判断结果。
 */
function synchronizeFieldScoring(fields: ContractOcrField[]): void {
  for (const field of fields) {
    const fieldScore = isContractOcrVerifiedConfidence(field.confidence)
      ? CONTRACT_OCR_AUTO_ACCEPTANCE_THRESHOLD
      : clampConfidence(field.confidence);
    field.confidence = fieldScore;
    field.fieldScore = fieldScore;
  }
}

function applyCrossFieldValidation(
  fields: ContractOcrField[],
  candidates: readonly InternalCandidate[],
): void {
  const partyA = fields.find((field) => field.field === "party_a");
  const partyB = fields.find((field) => field.field === "party_b");
  if (
    partyA?.normalizedValue &&
    partyA.normalizedValue === partyB?.normalizedValue
  ) {
    partyA.confidence = Math.min(partyA.confidence, 40);
    partyB.confidence = Math.min(partyB.confidence, 40);
    const warning = "甲乙方识别为同一单位，系统未自动采用";
    partyA.warnings = [...(partyA.warnings || []), warning];
    partyB.warnings = [...(partyB.warnings || []), warning];
  }

  const amountField = fields.find((field) => field.field === "amount");
  const amountCandidates = candidates.filter(
    (candidate) => candidate.field === "amount" && candidate.confidence >= 60,
  );
  const arabicValues = new Set(
    amountCandidates
      .filter((candidate) => candidate.kind === "arabic_amount")
      .map((candidate) => candidate.normalizedValue),
  );
  const chineseValues = new Set(
    amountCandidates
      .filter((candidate) => candidate.kind === "chinese_amount")
      .map((candidate) => candidate.normalizedValue),
  );
  if (
    amountField?.normalizedValue &&
    arabicValues.size > 0 &&
    chineseValues.size > 0 &&
    ![...arabicValues].some((value) => chineseValues.has(value))
  ) {
    amountField.confidence = Math.min(amountField.confidence, 45);
    amountField.warnings = [
      ...(amountField.warnings || []),
      "合同金额阿拉伯数字与中文大写不一致，系统未自动采用",
    ];
  }

  const categoryField = fields.find((field) => field.field === "category");
  const categories = new Set(
    candidates
      .filter((candidate) => candidate.field === "category")
      .map((candidate) => candidate.normalizedValue),
  );
  if (categoryField?.normalizedValue && categories.size > 1) {
    categoryField.confidence = Math.min(categoryField.confidence, 50);
    categoryField.warnings = [
      ...(categoryField.warnings || []),
      "合同内容同时命中多个类型，系统未自动采用合同分类",
    ];
  }
}

function applyContractDateContextValidation(
  fields: ContractOcrField[],
  contexts: readonly SourceContext[],
): void {
  const contractDate = fields.find((field) => field.field === "contract_date");
  if (!contractDate?.normalizedValue) return;

  const contractYear = Number(contractDate.normalizedValue.slice(0, 4));
  if (!Number.isInteger(contractYear)) return;

  const ranges = collectExplicitValidityYearRanges(contexts);
  if (ranges.length === 0) return;

  const validRanges = ranges.filter(
    ({ startYear, endYear }) => startYear <= endYear,
  );
  const hasPlausibleRange = !isContractDateYearClearlyContradicted(
    contractDate.normalizedValue,
    validRanges,
  );
  const hasInvalidRange = validRanges.length !== ranges.length;
  if (hasPlausibleRange && !hasInvalidRange) return;

  contractDate.confidence = Math.min(contractDate.confidence, 45);
  const describedRanges = ranges
    .slice(0, 3)
    .map(({ startYear, endYear }) => `${startYear}—${endYear}年`)
    .join("、");
  const warning = hasInvalidRange
    ? `正文明确期限的年份区间异常（${describedRanges}），合同签订日期系统未自动采用`
    : `合同签订日期年份 ${contractYear} 与正文明确期限 ${describedRanges} 明显不一致，系统未自动采用且未推测改写日期`;
  const shouldClearContradictedValue =
    validRanges.length > 0 &&
    isContractDateYearClearlyContradicted(
      contractDate.normalizedValue,
      validRanges,
    );
  contractDate.warnings = [
    ...new Set([
      ...(contractDate.warnings || []),
      warning,
      ...(shouldClearContradictedValue
        ? [
            `明显矛盾的日期候选 ${contractDate.normalizedValue} 已从可采用值中清空，原始转写、页面证据和候选列表继续保留`,
          ]
        : []),
    ]),
  ];
  if (shouldClearContradictedValue) {
    // 期限只负责拒绝明显矛盾的主值；不从期限推算或改写正确年份。
    // originalValue、evidence 和 candidates 必须保留供财务查看审计证据。
    contractDate.normalizedValue = "";
  }
}

function applyExpectedCategoryValidation(
  fields: ContractOcrField[],
  expectedCategory: ParseContractTextOptions["expectedCategory"],
): void {
  if (!expectedCategory) return;
  const categoryField = fields.find((field) => field.field === "category");
  if (!categoryField) return;
  categoryField.originalValue = "";
  categoryField.normalizedValue = expectedCategory;
  categoryField.confidence = 100;
  categoryField.fieldScore = 100;
  categoryField.source = "rule";
  categoryField.pageNumber = undefined;
  categoryField.evidence = [
    {
      text: "上传合同前选择",
      source: "rule",
      confidence: 100,
      fieldScore: 100,
      ocrConfidence: null,
    },
  ];
  categoryField.warnings = [
    "合同类型采用上传合同前选择值，不参与OCR识别、评分或安全门禁",
  ];
}

function applyExpectedRelationValidation(
  fields: ContractOcrField[],
  contexts: readonly SourceContext[],
  expectedRelation: ParseContractTextOptions["relationType"],
  renewalMain = false,
): string | null {
  if (!expectedRelation) return null;
  const detectedRelation = detectAgreementRelationType(contexts);
  const explicitRelations = new Set<"supplement" | "termination">(
    detectedRelation ? [detectedRelation] : [],
  );
  const renewalMainTitle =
    renewalMain &&
    contexts
      .flatMap((context) => context.lines.slice(0, 8))
      .some((line) =>
        /(?:续签|续租)协议(?:书)?(?:[（(].{1,12}[）)])?$/u.test(
          line.normalized.replace(/\s+/g, ""),
        ),
      );
  const conflicts =
    expectedRelation === "main"
      ? [...explicitRelations].filter(
          (relation) => !(renewalMainTitle && relation === "supplement"),
        )
      : [...explicitRelations].filter(
          (relation) => relation !== expectedRelation,
        );
  if (conflicts.length === 0) return null;
  const labels = conflicts.map((relation) =>
    relation === "supplement" ? "补充协议" : "终止／解除协议",
  );
  const warning = `合同标题明确为${labels.join("、")}，与上传前锁定的合同层级不一致；本识别任务已失败，必须删除草稿并按正确层级重新上传`;
  for (const field of fields) {
    field.confidence = Math.min(
      field.confidence,
      CONTRACT_OCR_AUTO_ACCEPTANCE_THRESHOLD - 1,
    );
    field.warnings = [...new Set([...(field.warnings || []), warning])];
  }
  return warning;
}

function resultStatus(
  fields: readonly ContractOcrField[],
): ContractRecognitionResult["status"] {
  const recognized = fields.filter((field) => field.normalizedValue);
  if (recognized.length === 0) return "failed";
  return CORE_FIELD_NAMES.every((fieldName) => {
    const field = fields.find((candidate) => candidate.field === fieldName);
    return Boolean(
      field?.normalizedValue &&
      isContractOcrVerifiedConfidence(field.confidence),
    );
  })
    ? "succeeded"
    : "partial";
}

/**
 * 当甲乙方各自已有不同的高可信主候选时，只清理通用角色标签产生的低优先
 * 镜像噪声。任何明确“甲方／乙方”标签提出的不同主体都必须保留，由候选
 * 冲突门禁阻断自动采用，不能用版式错序推测删除真实强证据。
 */
function filterMirroredPartyCandidates(
  candidates: readonly InternalCandidate[],
): InternalCandidate[] {
  const strongestByValue = (field: "party_a" | "party_b") => {
    const scores = new Map<string, number>();
    for (const candidate of candidates) {
      if (candidate.field !== field) continue;
      scores.set(
        candidate.normalizedValue,
        Math.max(
          scores.get(candidate.normalizedValue) || 0,
          candidate.confidence,
        ),
      );
    }
    return [...scores.entries()].sort((left, right) => right[1] - left[1]);
  };

  const partyAValues = strongestByValue("party_a");
  const partyBValues = strongestByValue("party_b");
  const assignments = partyAValues
    .flatMap(([partyAValue, partyAScore]) =>
      partyBValues
        .filter(([partyBValue]) => partyBValue !== partyAValue)
        .map(([partyBValue, partyBScore]) => ({
          partyAValue,
          partyAScore,
          partyBValue,
          partyBScore,
          score: partyAScore + partyBScore,
        })),
    )
    .sort((left, right) => right.score - left.score);
  const assignment = assignments[0];
  if (
    !assignment ||
    assignment.partyAScore < 90 ||
    assignment.partyBScore < 90 ||
    (assignments[1] && assignments[1].score === assignment.score)
  ) {
    return [...candidates];
  }

  return candidates.filter(
    (candidate) =>
      candidate.partyAnchorPriority === 2 ||
      !(
        (candidate.field === "party_a" &&
          candidate.normalizedValue === assignment.partyBValue) ||
        (candidate.field === "party_b" &&
          candidate.normalizedValue === assignment.partyAValue)
      ),
  );
}

/**
 * 合同同时出现明确“甲方／乙方”标签和委托方、受托方等通用角色时，直接
 * 采用明确标签紧随其后的单位候选。多个明确标签彼此不一致时仍保留冲突。
 */
function selectDirectPartyLabelCandidates(
  candidates: readonly InternalCandidate[],
): InternalCandidate[] {
  const fieldsWithDirectLabels = new Set<ContractOcrFieldName>();
  for (const candidate of candidates) {
    if (
      (candidate.field === "party_a" || candidate.field === "party_b") &&
      candidate.partyAnchorPriority === 2
    ) {
      fieldsWithDirectLabels.add(candidate.field);
    }
  }
  if (fieldsWithDirectLabels.size === 0) return [...candidates];
  return candidates.filter(
    (candidate) =>
      !fieldsWithDirectLabels.has(candidate.field) ||
      candidate.partyAnchorPriority === 2,
  );
}

function selectEffectiveAmountCandidates(
  candidates: readonly InternalCandidate[],
  relationType: ParseContractTextOptions["relationType"],
): InternalCandidate[] {
  const amountCandidates = candidates.filter(
    (candidate) => candidate.field === "amount",
  );
  const usableAmountCandidates = amountCandidates.filter(
    (candidate) => candidate.verificationRole !== "historical_amount",
  );
  if (relationType === "supplement" || relationType === "termination") {
    const adjustmentCandidates = usableAmountCandidates.filter(
      (candidate) => candidate.amountRole === "relation_adjustment",
    );
    const highestAdjustmentPrecedence = Math.max(
      0,
      ...adjustmentCandidates.map((candidate) => candidate.precedence || 0),
    );
    return candidates.filter(
      (candidate) =>
        candidate.field !== "amount" ||
        (adjustmentCandidates.includes(candidate) &&
          (candidate.precedence || 0) === highestAdjustmentPrecedence),
    );
  }
  const highestRolePriority = Math.max(
    0,
    ...usableAmountCandidates.map((candidate) =>
      amountRolePriority(candidate.amountRole),
    ),
  );
  // 付款、税费、普通服务费和单价只能作为内部诊断事实，不能在缺少合同
  // 总额锚点时冒充整份合同金额。
  if (highestRolePriority < amountRolePriority("generic_total")) {
    return candidates.filter((candidate) => candidate.field !== "amount");
  }
  const roleCandidates = usableAmountCandidates.filter(
    (candidate) =>
      amountRolePriority(candidate.amountRole) === highestRolePriority,
  );
  const highestPrecedence = Math.max(
    0,
    ...roleCandidates.map((candidate) => candidate.precedence || 0),
  );
  const precedenceCandidates =
    highestPrecedence === 0
      ? roleCandidates
      : roleCandidates.filter(
          (candidate) => (candidate.precedence || 0) === highestPrecedence,
        );
  const explicitTotalValues = new Set(
    precedenceCandidates
      .filter(
        (candidate) =>
          (candidate.amountRole === "contract_total" ||
            candidate.amountRole === "contract_amount") &&
          candidate.explicitContractTotal &&
          candidate.strongEvidence &&
          candidate.confidence >= 60,
      )
      .map((candidate) => candidate.normalizedValue),
  );
  if (explicitTotalValues.size > 1) {
    // 多个明确总额不能再按数值大小静默取舍。仅保留强总额候选参与合并，
    // 使风险策略触发金额局部增强复核并重新排序候选。
    return candidates.filter(
      (candidate) =>
        candidate.field !== "amount" ||
        (precedenceCandidates.includes(candidate) && candidate.strongEvidence),
    );
  }
  if (explicitTotalValues.size === 1) {
    const [explicitTotalValue] = explicitTotalValues;
    // 唯一明确“合同总金额／合同总价”优先于设备清单、分项自身的更大
    // “含税总价”。只有没有明确合同总额时才允许走最大阿拉伯金额回退。
    return candidates.filter(
      (candidate) =>
        candidate.field !== "amount" ||
        (precedenceCandidates.includes(candidate) &&
          candidate.explicitContractTotal === true &&
          candidate.normalizedValue === explicitTotalValue),
    );
  }
  return candidates.filter(
    (candidate) =>
      candidate.field !== "amount" || precedenceCandidates.includes(candidate),
  );
}

function applyAmountPrecedenceNotice(
  fields: ContractOcrField[],
  allCandidates: readonly InternalCandidate[],
  effectiveCandidates: readonly InternalCandidate[],
  relationType: ParseContractTextOptions["relationType"],
): void {
  const amountField = fields.find((field) => field.field === "amount");
  if (!amountField) return;
  if (
    (relationType === "supplement" || relationType === "termination") &&
    !amountField.normalizedValue
  ) {
    amountField.warnings = [
      ...(amountField.warnings || []),
      "未识别到当前协议明确写明的本次增减额，禁止用原合同金额或变更后总额替代",
    ];
    return;
  }
  if (!amountField.normalizedValue) return;
  const isRelationAdjustment =
    relationType === "supplement" || relationType === "termination";
  const hasAdjustmentFormatConflict =
    isRelationAdjustment &&
    allCandidates.some(
      (candidate) =>
        candidate.field === "amount" && candidate.amountEventConflict,
    );
  const conflictingAdjustmentValues = [
    ...new Set(
      allCandidates
        .filter(
          (candidate) =>
            candidate.field === "amount" && candidate.amountEventConflict,
        )
        .map((candidate) => candidate.normalizedValue),
    ),
  ];
  if (isRelationAdjustment) {
    amountField.confidence = Math.min(
      amountField.confidence,
      hasAdjustmentFormatConflict
        ? 45
        : CONTRACT_OCR_AUTO_ACCEPTANCE_THRESHOLD - 1,
    );
    const relationEvidence = allCandidates
      .filter(
        (candidate) =>
          candidate.field === "amount" &&
          candidate.amountRole === "relation_adjustment",
      )
      .map((candidate) => candidate.evidence)
      .join(" ");
    const semanticWarnings = [
      "补充协议或终止协议金额按当前协议明确增减事件自动排序，amount_delta（本次增减额）不得写入原合同金额或变更后总额",
    ];
    if (
      /暂估|预计|暂定|最终.{0,20}(?:审计|结算)|以(?:审计|结算)(?:结果|金额|价款)?为准/.test(
        relationEvidence,
      )
    ) {
      semanticWarnings.push(
        "候选证据包含暂估、预计或以审计／结算为准等非最终金额语义，不得作为自动最终值",
      );
    }
    if (/已履行|已完成|已支付|已结算|已付款|已发生/.test(relationEvidence)) {
      semanticWarnings.push(
        "候选证据包含已履行或已结算金额语义，不能推定为当前协议增减额",
      );
    }
    amountField.warnings = [
      ...new Set([...(amountField.warnings || []), ...semanticWarnings]),
    ];
  }
  const effectiveSet = new Set(effectiveCandidates);
  const supersededValues = [
    ...new Set(
      allCandidates
        .filter(
          (candidate) =>
            candidate.field === "amount" &&
            !effectiveSet.has(candidate) &&
            candidate.normalizedValue !== amountField.normalizedValue,
        )
        .map((candidate) => candidate.normalizedValue),
    ),
  ];
  if (supersededValues.length === 0) return;
  if (isRelationAdjustment) {
    amountField.warnings = [
      ...(amountField.warnings || []),
      hasAdjustmentFormatConflict
        ? `同一增减动作存在金额格式冲突，候选 ${conflictingAdjustmentValues.join("、")} 不直接汇总，已触发局部增强复核并重新排序`
        : `已按当前协议采用本次增减额 ${amountField.normalizedValue}，原合同金额或变更后总额 ${supersededValues.join("、")} 仅作审计留痕`,
    ];
    return;
  }
  const highestPrecedence = Math.max(
    0,
    ...allCandidates
      .filter((candidate) => candidate.field === "amount")
      .map((candidate) => candidate.precedence || 0),
  );
  if (highestPrecedence === 0) {
    const usedExplicitContractTotal = effectiveCandidates.some(
      (candidate) =>
        candidate.field === "amount" &&
        candidate.explicitContractTotal === true &&
        candidate.normalizedValue === amountField.normalizedValue,
    );
    amountField.warnings = [
      ...(amountField.warnings || []),
      usedExplicitContractTotal
        ? `已采用正文明确合同总额 ${amountField.normalizedValue}，其他分项或清单金额 ${supersededValues.join("、")} 仅作核验上下文`
        : `已按金额角色、关键词位置和证据评分采用 ${amountField.normalizedValue}，其他金额 ${supersededValues.join("、")} 仅作核验上下文`,
    ];
    return;
  }
  amountField.warnings = [
    ...(amountField.warnings || []),
    `合同明确约定条款不一致时以特别约定为准，已采用优先条款金额 ${amountField.normalizedValue}，原条款金额 ${supersededValues.join("、")} 仅作审计留痕`,
  ];
}

function applyInternalAmountBreakdown(
  fields: ContractOcrField[],
  relationType: ContractRelationType | undefined,
  analysis: AgreementAmountAnalysis | null,
): ContractAmountBreakdown {
  const amountField = fields.find((field) => field.field === "amount");
  const selectedAmount = amountField?.normalizedValue
    ? Number(amountField.normalizedValue)
    : null;
  const hasSelectedAmount =
    selectedAmount != null && Number.isFinite(selectedAmount);
  if (relationType !== "supplement" && relationType !== "termination") {
    const contractAmount = hasSelectedAmount ? selectedAmount : null;
    return {
      originalAmount: contractAmount,
      changeAmount: contractAmount == null ? null : 0,
      finalAmount: contractAmount,
    };
  }

  const originalAmount = analysis?.originalAmount ?? null;
  const authoritativeFinalChange =
    analysis?.originalAmount != null && analysis.explicitFinalAmount != null
      ? Math.round(
          (analysis.explicitFinalAmount - analysis.originalAmount) * 100,
        ) / 100
      : null;
  const changeAmount =
    authoritativeFinalChange ??
    (analysis?.hasAmountEventConflict
      ? null
      : hasSelectedAmount
        ? selectedAmount
        : (analysis?.changeAmount ?? null));
  const calculatedFinalAmount =
    originalAmount != null && changeAmount != null
      ? Math.round((originalAmount + changeAmount) * 100) / 100
      : null;
  const finalAmount =
    analysis?.explicitFinalAmount ?? calculatedFinalAmount ?? null;
  if (amountField && calculatedFinalAmount != null) {
    amountField.warnings = [
      ...(amountField.warnings || []),
      `金额业务计算：originalAmount=${normalizeAmount(originalAmount!)}，changeAmount=${normalizeAmount(changeAmount!)}，finalAmount=${normalizeAmount(calculatedFinalAmount)}`,
    ];
  }
  if (
    amountField &&
    calculatedFinalAmount != null &&
    analysis?.explicitFinalAmount != null &&
    normalizeAmount(calculatedFinalAmount) !==
      normalizeAmount(analysis.explicitFinalAmount)
  ) {
    amountField.confidence = Math.min(amountField.confidence, 45);
    amountField.warnings = [
      ...(amountField.warnings || []),
      `补充协议金额计算结果 ${normalizeAmount(calculatedFinalAmount)} 与正文明确最终金额 ${normalizeAmount(analysis.explicitFinalAmount)} 不一致，已触发金额冲突自动复核与重新排序`,
    ];
  }
  return { originalAmount, changeAmount, finalAmount };
}

/**
 * “只有付款”必须有付款／报酬动作和同一条款内的金额事实。税额、单价或
 * 普通数字不属于付款状态；付款事实也只用于状态分类，绝不重新加入合同
 * 金额候选。
 */
function hasPaymentOnlyAmountFact(
  contexts: readonly SourceContext[],
  candidates: readonly InternalCandidate[],
): boolean {
  if (
    candidates.some(
      (candidate) =>
        candidate.field === "amount" &&
        candidate.amountRole === "payment_amount",
    )
  ) {
    return true;
  }

  const paymentAction =
    /付款(?:金额|总金额|款项|节点)?|预付款|进度款|已付款|回款金额|应付款|实付款|(?:支付|付款)(?=.{0,16}(?:人民币|[￥¥]|[-－+＋]?\d))|支付(?:金额|款项|价款|费用|服务费|报酬)|支付.{0,12}(?:信息咨询费|咨询服务费|技术服务费|服务费|报酬)|(?:应|须|需|向|由).{0,20}支付|报酬(?:支付|结算|款)?/u;
  for (const context of contexts) {
    for (let index = 0; index < context.lines.length; index += 1) {
      const line = context.lines[index];
      if (!paymentAction.test(line.normalized)) continue;
      if (extractMoneyValues(line.normalized).length > 0) return true;
      const nextLine = context.lines[index + 1]?.normalized || "";
      if (
        nextLine &&
        /^(?:人民币|[￥¥]|[-－+＋]?\d|[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟任万萬亿億兆])/u.test(
          nextLine,
        ) &&
        extractMoneyValues(nextLine).length > 0
      ) {
        return true;
      }
    }
  }
  return false;
}

function isPaymentScheduleOnlyAmountCandidate(
  candidate: InternalCandidate,
): boolean {
  if (candidate.amountRole === "payment_amount") return true;
  const evidence = compactMoneyText(candidate.evidence || "").replace(
    /\s+/g,
    "",
  );
  if (!/(?:分期)?(?:支付|付款)|预付款|进度款|回款/u.test(evidence)) {
    return false;
  }
  // 同一句若明确声明合同总额、调整后总额或本次增减，仍属于合同金额事实，
  // 不能仅因同时出现“支付／付款”就降级为付款计划。
  return !/(?:原合同|调整后|变更后|最终|现合同|新的合同|共计合同).{0,24}(?:总金额|金额|总额|价款|费用|报酬)|合同(?:总金额|总额|总价|价款)|(?:本次补充协议)?.{0,16}(?:增加|追加|核减|减少|扣减|调增|调减).{0,16}(?:金额|费用|价款|报酬)/u.test(
    evidence,
  );
}

function classifyContractAmountStatus(
  fields: readonly ContractOcrField[],
  relationType: ContractRelationType | undefined,
  breakdown: ContractAmountBreakdown,
  contexts: readonly SourceContext[],
  allCandidates: readonly InternalCandidate[],
  analysis: AgreementAmountAnalysis | null,
): ContractAmountStatus {
  const amountField = fields.find((field) => field.field === "amount");
  const amountValue = amountField?.normalizedValue || "";
  const hasAmountConflict = (amountField?.warnings || []).some((warning) =>
    /候选冲突|金额格式冲突|金额计算结果.+不一致|金额冲突/u.test(warning),
  );
  const isRelationAgreement =
    relationType === "supplement" || relationType === "termination";
  const calculatedFinalAmount =
    breakdown.originalAmount != null && breakdown.changeAmount != null
      ? Math.round((breakdown.originalAmount + breakdown.changeAmount) * 100) /
        100
      : null;
  const calculationCloses =
    calculatedFinalAmount != null &&
    breakdown.finalAmount != null &&
    normalizeAmount(calculatedFinalAmount) ===
      normalizeAmount(breakdown.finalAmount) &&
    (analysis?.explicitFinalAmount == null ||
      normalizeAmount(calculatedFinalAmount) ===
        normalizeAmount(analysis.explicitFinalAmount));
  if (
    isRelationAgreement &&
    amountValue &&
    breakdown.originalAmount != null &&
    breakdown.changeAmount != null &&
    normalizeAmount(Number(amountValue)) ===
      normalizeAmount(breakdown.changeAmount) &&
    calculationCloses
  ) {
    return "calculated_amount";
  }
  const hasConfirmedCandidate =
    amountValue !== "" &&
    !hasAmountConflict &&
    allCandidates.some(
      (candidate) =>
        candidate.field === "amount" &&
        candidate.normalizedValue === amountValue &&
        candidate.strongEvidence === true &&
        candidate.amountEventConflict !== true &&
        (candidate.amountRole === "contract_total" ||
          candidate.amountRole === "contract_amount" ||
          (isRelationAgreement &&
            candidate.amountRole === "relation_adjustment")),
    );
  if (hasConfirmedCandidate) return "confirmed_amount";
  const hasNonPaymentContractAmountFact = allCandidates.some(
    (candidate) =>
      candidate.field === "amount" &&
      candidate.amountRole !== "payment_amount" &&
      candidate.amountRole !== "tax_amount" &&
      candidate.amountRole !== "service_fee" &&
      candidate.amountRole !== "unit_price" &&
      !isPaymentScheduleOnlyAmountCandidate(candidate),
  );
  if (
    !hasNonPaymentContractAmountFact &&
    hasPaymentOnlyAmountFact(contexts, allCandidates)
  ) {
    return "payment_only";
  }
  return "missing_amount";
}

/**
 * missing_amount（金额缺失）只代表没有形成可用合同金额，不天然代表可以
 * 自动采用空值。多个明确总额冲突、原合同／变更后金额尚未绑定当前事件，
 * 或增减事件自身冲突时，都必须继续阻断，不能伪装成“合同没有金额”。
 */
function isMissingAmountEligibleForAutomaticAdoption(
  status: ContractAmountStatus,
  fields: readonly ContractOcrField[],
  allCandidates: readonly InternalCandidate[],
  analysis: AgreementAmountAnalysis | null,
): boolean {
  if (status !== "missing_amount") return false;
  const amountField = fields.find((field) => field.field === "amount");
  if (amountField?.normalizedValue) return false;
  const hasAmountConflict = (amountField?.warnings || []).some((warning) =>
    /候选冲突|金额格式冲突|金额角色冲突|同一增减动作|金额计算结果.+不一致|大写.*不一致|金额冲突/u.test(
      warning,
    ),
  );
  if (hasAmountConflict || analysis?.hasAmountEventConflict === true) {
    return false;
  }
  const hasUnresolvedStrongAmountFact = allCandidates.some(
    (candidate) =>
      candidate.field === "amount" &&
      (candidate.amountEventConflict === true ||
        (candidate.strongEvidence === true &&
          amountRolePriority(candidate.amountRole) >=
            amountRolePriority("generic_total")) ||
        candidate.amountRole === "original_amount" ||
        candidate.amountRole === "final_amount" ||
        candidate.amountRole === "relation_adjustment"),
  );
  return !hasUnresolvedStrongAmountFact;
}

function looksLikeGenericContractTypeProject(value: string): boolean {
  const compacted = normalizeLine(value).replace(/\s+/g, "");
  if (!compacted) return false;
  if (
    /^(?:技术服务|技术咨询服务|工程咨询服务|咨询服务|服务|采购|租赁|房屋租赁|停车服务|网络服务)?(?:合同|协议|协议书|补充协议|补充协议书|变更协议|变更协议书|追加协议|追加协议书|终止协议|终止协议书)$/u.test(
      compacted,
    )
  ) {
    return true;
  }
  return (
    /(?:合同|协议|协议书)$/u.test(compacted) &&
    !/(?:项目|工程|千伏|变电站|线路|不动产|许可证|检测|鉴定|手续|采购|购置|平台|系统|建设|改造|产品|云)/u.test(
      compacted,
    )
  );
}

function looksLikeOrganizationProjectValue(
  value: string,
  fields: readonly ContractOcrField[],
): boolean {
  const compacted = normalizeLine(value).replace(/\s+/g, "");
  if (!compacted) return false;
  const projectShape =
    /(?:项目|工程|千伏|变电站|线路|不动产|许可证|检测|鉴定|手续|采购|购置|平台|系统|建设|改造)/u.test(
      compacted,
    );
  const partyValues = fields
    .filter((field) => field.field === "party_a" || field.field === "party_b")
    .map((field) => normalizeLine(field.normalizedValue).replace(/\s+/g, ""))
    .filter(Boolean);
  if (
    partyValues.some((party) => {
      if (compacted === party) return true;
      if (!compacted.startsWith(party)) return false;
      return /^(?:技术服务|咨询服务|工程咨询服务|合同|协议|协议书)?$/u.test(
        compacted.slice(party.length),
      );
    })
  ) {
    return true;
  }
  return (
    !projectShape &&
    /(?:有限责任公司|股份有限公司|集团有限公司|有限公司|公司|研究院|设计院|事务所|委员会|管理局|中心|政府|大学|学院|医院|协会|研究所)$/u.test(
      compacted,
    )
  );
}

function looksLikePaymentClauseProject(value: string): boolean {
  const compacted = normalizeLine(value).replace(/\s+/g, "");
  return /(?:付款(?:方式|条款|安排|金额|节点)|支付(?:方式|条款|安排|金额|节点)|预付款|进度款|结算方式|收款账户|开户银行|税额|税费|单价)/u.test(
    compacted,
  );
}

/**
 * 该扫描只产生失败关闭信号，不新增金额候选或改变候选排序。用于发现原文已
 * 有明确合同级金额锚点及金额事实、但生成器没有形成任何可分类候选的情况。
 */
function hasUnresolvedContractAmountFact(
  contexts: readonly SourceContext[],
  allCandidates: readonly InternalCandidate[],
): boolean {
  const hasClassifiedContractAmount = allCandidates.some(
    (candidate) =>
      candidate.field === "amount" &&
      (candidate.amountRole === "contract_total" ||
        candidate.amountRole === "contract_amount" ||
        candidate.amountRole === "relation_adjustment"),
  );
  if (hasClassifiedContractAmount) return false;

  const contractAmountAnchor =
    /合同(?:总金额|金额|总额|总价|价款|价格|费用总额)|签约金额|项目金额|协议(?:总金额|金额|总额|价款)|(?:咨询服务费|技术服务费|咨询费|顾问费|服务费)?总价款|服务费(?:用)?(?:总额|合计)|报酬总额|本次(?:技术咨询|技术服务|咨询服务)?总费用/u;
  const indeterminateAmount =
    /按实际|据实结算|另行协商|金额待定|暂未确定|待双方|以(?:结算单|审计结果|实际发生|最终结算).{0,8}为准/u;
  const explicitMoney =
    /(?:人民币|[￥¥])\s*[-－+＋]?\d[\d,，]*(?:\.\d+)?(?:\s*(?:亿|万)?(?:元|圆))?|[-－+＋]?\d[\d,，]*(?:\.\d+)?\s*(?:亿|万)?(?:元|圆)|[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟万萬亿億兆]+(?:元|圆)(?:整|正)?/u;
  const sameLineBareMoney = /^[-－+＋]?\d[\d,，]*(?:\.\d{1,2})?$/u;
  const continuedBareMoney =
    /^[-－+＋]?(?:\d{1,3}(?:[,，]\d{3})+|\d{3,})(?:\.\d{1,2})?$/u;
  const nextFieldBoundary =
    /^(?:合同|服务|履行|租赁)?期限|^有效期|^(?:签订|签署|生效)?日期|^(?:合同|项目)?编号|^(?:项目|工程)名称|^(?:甲方|乙方|委托方|受托方)|^(?:付款|预付款|进度款|税额|税费|税率|单价|第[一二三四五六七八九十\d]+条)/u;
  return contexts.some((context) =>
    context.lines.some((line, index) => {
      const anchorMatch = line.normalized.match(contractAmountAnchor);
      if (!anchorMatch || anchorMatch.index == null) return false;
      const anchorTail = line.normalized
        .slice(anchorMatch.index + anchorMatch[0].length)
        .split(/[。；;]/, 1)[0]
        .replace(/^[\s:：为是]+/u, "")
        .trim();
      if (
        explicitMoney.test(anchorTail) ||
        sameLineBareMoney.test(anchorTail)
      ) {
        return true;
      }
      if (indeterminateAmount.test(anchorTail)) return false;
      for (let offset = 1; offset <= 2; offset += 1) {
        const continuedLine = context.lines[index + offset]?.normalized.trim();
        if (!continuedLine) continue;
        if (nextFieldBoundary.test(continuedLine)) break;
        if (
          explicitMoney.test(continuedLine) ||
          continuedBareMoney.test(continuedLine)
        ) {
          return true;
        }
      }
      return false;
    }),
  );
}

function hasSamePageVisibleOcrEvidenceForPdfCandidate(
  pdfCandidate: InternalCandidate,
  matchingCandidates: readonly InternalCandidate[],
): boolean {
  if (pdfCandidate.source !== "pdf_text" || pdfCandidate.pageNumber == null) {
    return false;
  }
  return matchingCandidates.some(
    (candidate) =>
      candidate.source.startsWith("ocr_") &&
      candidate.pageNumber === pdfCandidate.pageNumber &&
      candidate.recognitionEngine !== pdfCandidate.recognitionEngine &&
      candidate.strongEvidence === true &&
      candidate.normalizedValue === pdfCandidate.normalizedValue &&
      (pdfCandidate.field !== "amount" ||
        (candidate.amountRole === pdfCandidate.amountRole &&
          candidate.verificationRole === pdfCandidate.verificationRole)),
  );
}

/**
 * 非主营咨询合同常不在封面设置独立“项目名称”字段，而是在鉴于条款中以
 * “聘请／委托……就具体项目服务对象……提供服务”的闭合句式声明合同标的。
 * 只有候选值原样位于该闭合句式、同时具备明确项目形态时才视为强证据；
 * 普通“负责某项目建设”等背景介绍不满足该条件。
 */
function hasClosedNonMainProjectServiceEvidence(
  candidate: InternalCandidate,
): boolean {
  if (candidate.projectOrigin !== "body_description") return false;
  const projectValue = normalizeLine(candidate.normalizedValue).replace(
    /\s+/g,
    "",
  );
  if (
    !projectValue ||
    !NON_MAIN_PROJECT_SUBJECT_SHAPE_PATTERN.test(projectValue) ||
    !/(?:项目|工程|咨询|评价|评估|检测|鉴定|设计|规划|服务)/u.test(projectValue)
  ) {
    return false;
  }
  const evidence = normalizeLine(candidate.evidence).replace(/\s+/g, "");
  const projectIndex = evidence.indexOf(projectValue);
  if (projectIndex < 0) return false;
  const prefix = evidence.slice(Math.max(0, projectIndex - 100), projectIndex);
  const suffix = evidence.slice(projectIndex + projectValue.length);
  const closedEntrustment =
    /(?:委托|聘请).{0,80}?(?:就|针对|围绕)$/u.test(prefix) &&
    /^(?:(?:及|和|与)?(?:咨询|协调|配合|相关)?工作)?(?:提供|开展|承担|完成|进行).{0,24}?(?:服务|工作|咨询|协调)/u.test(
      suffix,
    );
  const explicitServiceObject =
    /(?:本合同|本协议)?(?:的)?(?:服务|委托|咨询|工作)对象(?:为|是|[:：])$/u.test(
      prefix,
    ) && /^(?:[，,。；;]|$)/u.test(suffix);
  const referencedServiceContract =
    /(?:甲方|委托方)(?:已)?与.{0,80}?(?:签署|签订)《$/u.test(prefix) &&
    /^(?:合同|协议(?:书)?)[》”"].{0,420}?(?:现)?(?:甲方|委托方)(?:现)?(?:委托|聘请)(?:乙方|受托方).{0,200}?(?:提供|开展|承担|完成|协助).{0,36}?(?:服务|工作|支持)/u.test(
      suffix,
    );
  return (
    closedEntrustment || explicitServiceObject || referencedServiceContract
  );
}

function buildContractOcrAutomaticAdoptionSafetyContext(
  fields: readonly ContractOcrField[],
  candidates: readonly InternalCandidate[],
  allCandidates: readonly InternalCandidate[],
  ranking: ReadonlyMap<
    ContractOcrFieldName,
    readonly ContractOcrCandidateRankTrace[]
  >,
  contexts: readonly SourceContext[],
  relationType: ParseContractTextOptions["relationType"] | undefined,
  expectedCategory: ParseContractTextOptions["expectedCategory"] | undefined,
  amountContext: ContractAmountAutomaticAdoptionContext,
  amountBreakdown: ContractAmountBreakdown,
): ContractOcrAutomaticAdoptionSafetyContext {
  const projectField = fields.find((field) => field.field === "project_name");
  const projectValue = projectField?.normalizedValue || null;
  const matchingProjectCandidates = projectValue
    ? candidates.filter(
        (candidate) =>
          candidate.field === "project_name" &&
          candidate.normalizedValue === projectValue,
      )
    : [];
  const projectPdfCandidates = matchingProjectCandidates.filter(
    (candidate) => candidate.source === "pdf_text",
  );
  const isClosedNonMainServiceCandidate = (candidate: InternalCandidate) =>
    expectedCategory === "non_main" &&
    hasClosedNonMainProjectServiceEvidence(candidate);
  const hasSamePageVisibleProjectOcrEvidence = (
    pdfCandidate: InternalCandidate,
  ) =>
    hasSamePageVisibleOcrEvidenceForPdfCandidate(
      pdfCandidate,
      matchingProjectCandidates,
    ) ||
    (expectedCategory === "non_main" &&
      pdfCandidate.projectOrigin === "cover_title" &&
      pdfCandidate.pageNumber === 1 &&
      matchingProjectCandidates.some(
        (candidate) =>
          candidate.source.startsWith("ocr_") &&
          candidate.pageNumber === 1 &&
          candidate.recognitionEngine !== pdfCandidate.recognitionEngine &&
          candidate.projectOrigin === "cover_title" &&
          candidate.normalizedValue === pdfCandidate.normalizedValue,
      )) ||
    (isClosedNonMainServiceCandidate(pdfCandidate) &&
      matchingProjectCandidates.some(
        (candidate) =>
          candidate.source.startsWith("ocr_") &&
          candidate.pageNumber === pdfCandidate.pageNumber &&
          candidate.recognitionEngine !== pdfCandidate.recognitionEngine &&
          candidate.normalizedValue === pdfCandidate.normalizedValue &&
          isClosedNonMainServiceCandidate(candidate),
      ));
  const projectSamePageVisibleOcrEvidence =
    projectPdfCandidates.length === 0 ||
    projectPdfCandidates.some(hasSamePageVisibleProjectOcrEvidence);
  const corroboratedNonMainServiceOcrSources = new Set(
    matchingProjectCandidates
      .filter(
        (candidate) =>
          isClosedNonMainServiceCandidate(candidate) &&
          candidate.source.startsWith("ocr_") &&
          candidate.pageNumber != null,
      )
      .map((candidate) => `${candidate.source}:${candidate.pageNumber}`),
  );
  const hasCorroboratedNonMainServiceEvidence =
    projectPdfCandidates.some(hasSamePageVisibleProjectOcrEvidence) ||
    corroboratedNonMainServiceOcrSources.size >= 2;
  const hasClosedEntrustedProjectEvidence = (candidate: InternalCandidate) =>
    candidate.projectOrigin === "body_description" &&
    /(?:甲方|委托方)?委托(?:乙方|受托方)就.{4,180}?(?:项目进行|进行的专项)/u.test(
      String(candidate.evidence || "").replace(/\s+/g, ""),
    );
  const corroboratedBodyProjectSources = new Set(
    matchingProjectCandidates
      .filter(
        (candidate) =>
          hasClosedEntrustedProjectEvidence(candidate) &&
          candidate.source.startsWith("ocr_") &&
          candidate.pageNumber != null,
      )
      .map((candidate) => `${candidate.source}:${candidate.pageNumber}`),
  );
  // 扫描合同的明确项目名称经常被首页表格分行或印章截断，但正文会在
  // “甲方委托乙方就……项目进行专项服务”的完整闭合句式中再次出现。
  // 同一完整值至少得到两档可见 OCR（光学字符识别）独立复核时，可将
  // 该正文闭合句作为首页截断字段的补强证据；单一正文命中仍不放行。
  const hasCorroboratedBodyProjectEvidence =
    corroboratedBodyProjectSources.size >= 2;
  const corroboratedLabeledProjectSources = new Set(
    matchingProjectCandidates
      .filter(
        (candidate) =>
          candidate.projectOrigin === "labeled_field" &&
          candidate.strongEvidence === true &&
          candidate.source.startsWith("ocr_") &&
          candidate.pageNumber != null,
      )
      .map((candidate) => `${candidate.source}:${candidate.pageNumber}`),
  );
  const hasCorroboratedLabeledProjectEvidence =
    corroboratedLabeledProjectSources.size >= 2;
  const trustedProjectCandidates = matchingProjectCandidates.filter(
    (candidate) => {
      if (
        candidate.source === "pdf_text" &&
        !hasSamePageVisibleProjectOcrEvidence(candidate)
      ) {
        return false;
      }
      if (
        isClosedNonMainServiceCandidate(candidate) &&
        hasCorroboratedNonMainServiceEvidence
      ) {
        return true;
      }
      if (
        hasClosedEntrustedProjectEvidence(candidate) &&
        hasCorroboratedBodyProjectEvidence
      ) {
        return true;
      }
      if (
        candidate.projectOrigin === "labeled_field" &&
        candidate.strongEvidence === true &&
        hasCorroboratedLabeledProjectEvidence
      ) {
        return true;
      }
      const pageOrStructuredTextIsTrusted =
        candidate.pageNumber === 1 ||
        (candidate.pageNumber == null &&
          (candidate.source === "plain_text" ||
            candidate.source === "docx_text"));
      if (!pageOrStructuredTextIsTrusted) return false;
      if (candidate.projectOrigin === "cover_title") return true;
      return (
        candidate.projectOrigin === "labeled_field" &&
        candidate.strongEvidence === true
      );
    },
  );
  const representativeProjectCandidate =
    trustedProjectCandidates[0] || matchingProjectCandidates[0] || null;
  const projectRanking = ranking.get("project_name") || [];
  const compactProjectValue = normalizeLine(projectValue || "").replace(
    /\s+/g,
    "",
  );
  // 补充协议经常同时出现“何各庄220千伏……手续”和省略地点前缀的
  // “220千伏……手续”。后者只是同一项目的截短重复，不应被当成第二个
  // 互相冲突的项目。仅在已选完整值拥有可信来源，且短值为其后缀并仍
  // 具备明确工程形态时折叠，避免把普通包含关系误当同一项目。
  const effectiveProjectRanking = projectRanking.filter((candidate) => {
    const compactCandidate = normalizeLine(candidate.normalizedValue).replace(
      /\s+/g,
      "",
    );
    if (
      !compactProjectValue ||
      compactCandidate === compactProjectValue ||
      trustedProjectCandidates.length === 0
    ) {
      return true;
    }
    const selectedWithoutDocumentSuffix = compactProjectValue.replace(
      /(?:补充协议书?|变更协议书?|追加协议书?|终止协议书?|协议书?|合同)$/u,
      "",
    );
    if (
      selectedWithoutDocumentSuffix === compactCandidate &&
      compactCandidate.length >= 8
    ) {
      return false;
    }
    return !(
      compactProjectValue.endsWith(compactCandidate) &&
      compactCandidate.length >= 8 &&
      /(?:千伏|工程|项目|不动产|手续)/u.test(compactCandidate)
    );
  });
  const leadingProject = effectiveProjectRanking[0] || null;
  const runnerUpProject = effectiveProjectRanking[1] || null;
  const projectScoreGap =
    leadingProject && runnerUpProject
      ? Math.round((leadingProject.score - runnerUpProject.score) * 100) / 100
      : null;
  const projectCandidateCount = effectiveProjectRanking.length;
  const projectUniqueOrSufficientGap =
    projectCandidateCount === 1 ||
    (projectScoreGap != null &&
      projectScoreGap >= CONTRACT_PROJECT_AUTOMATIC_ADOPTION_MINIMUM_SCORE_GAP);
  const genericContractType = Boolean(
    projectValue && looksLikeGenericContractTypeProject(projectValue),
  );
  const organizationName = Boolean(
    projectValue && looksLikeOrganizationProjectValue(projectValue, fields),
  );
  const paymentClause = Boolean(
    projectValue && looksLikePaymentClauseProject(projectValue),
  );
  const projectRiskCodes: string[] = [];
  if (projectValue && matchingProjectCandidates.length === 0) {
    projectRiskCodes.push("PROJECT_CANDIDATE_MISSING");
  }
  if (projectValue && trustedProjectCandidates.length === 0) {
    projectRiskCodes.push("PROJECT_SOURCE_UNTRUSTED");
  }
  if (genericContractType) projectRiskCodes.push("PROJECT_CONTRACT_TYPE");
  if (organizationName) projectRiskCodes.push("PROJECT_ORGANIZATION_NAME");
  if (paymentClause) projectRiskCodes.push("PROJECT_PAYMENT_CLAUSE");
  if (projectValue && !projectUniqueOrSufficientGap) {
    projectRiskCodes.push("PROJECT_CANDIDATE_CONFLICT");
  }
  if (projectPdfCandidates.length > 0 && !projectSamePageVisibleOcrEvidence) {
    projectRiskCodes.push("PROJECT_PDF_VISIBLE_EVIDENCE_MISSING");
  }

  const amountField = fields.find((field) => field.field === "amount");
  const amountValue = amountField?.normalizedValue || null;
  const matchingAmountCandidates = amountValue
    ? candidates.filter(
        (candidate) =>
          candidate.field === "amount" &&
          candidate.normalizedValue === amountValue,
      )
    : [];
  const amountPdfCandidates = matchingAmountCandidates.filter(
    (candidate) => candidate.source === "pdf_text",
  );
  const amountSamePageVisibleOcrEvidence =
    amountPdfCandidates.length === 0 ||
    amountPdfCandidates.some((candidate) =>
      hasSamePageVisibleOcrEvidenceForPdfCandidate(
        candidate,
        matchingAmountCandidates,
      ),
    );
  const representativeAmountCandidate = [...matchingAmountCandidates].sort(
    (left, right) => {
      const roleDifference =
        amountRolePriority(right.amountRole) -
        amountRolePriority(left.amountRole);
      if (roleDifference !== 0) return roleDifference;
      const scopeDifference =
        Number(right.amountEventScope === "total") -
        Number(left.amountEventScope === "total");
      if (scopeDifference !== 0) return scopeDifference;
      const explicitDifference =
        Number(right.explicitContractTotal === true) -
        Number(left.explicitContractTotal === true);
      if (explicitDifference !== 0) return explicitDifference;
      return right.confidence - left.confidence;
    },
  )[0];
  const isRelationAgreement =
    relationType === "supplement" || relationType === "termination";
  const calculatedRelationAmountCloses =
    isRelationAgreement &&
    amountContext.status === "calculated_amount" &&
    amountValue != null &&
    amountBreakdown.originalAmount != null &&
    amountBreakdown.changeAmount != null &&
    amountBreakdown.finalAmount != null &&
    normalizeAmount(amountBreakdown.changeAmount) === amountValue &&
    normalizeAmount(
      Math.round(
        (amountBreakdown.originalAmount + amountBreakdown.changeAmount) * 100,
      ) / 100,
    ) === normalizeAmount(amountBreakdown.finalAmount);
  const calculatedRelationVisibleClosure =
    calculatedRelationAmountCloses &&
    groupAmountAnalysisContexts(contexts)
      .filter((context) => context.source.startsWith("ocr_"))
      .some((context) => {
        const visibleAnalysis = analyzeAgreementAmounts(
          [context],
          relationType,
        );
        if (
          !visibleAnalysis ||
          visibleAnalysis.hasAmountEventConflict ||
          visibleAnalysis.originalAmount == null ||
          visibleAnalysis.changeAmount == null ||
          visibleAnalysis.explicitFinalAmount == null
        ) {
          return false;
        }
        const visibleFinalAmount =
          Math.round(
            (visibleAnalysis.originalAmount + visibleAnalysis.changeAmount) *
              100,
          ) / 100;
        return (
          normalizeAmount(visibleAnalysis.originalAmount) ===
            normalizeAmount(amountBreakdown.originalAmount!) &&
          normalizeAmount(visibleAnalysis.changeAmount) === amountValue &&
          normalizeAmount(visibleFinalAmount) ===
            normalizeAmount(amountBreakdown.finalAmount!) &&
          normalizeAmount(visibleAnalysis.explicitFinalAmount) ===
            normalizeAmount(amountBreakdown.finalAmount!)
        );
      });
  const amountScope: ContractOcrAmountCandidateScope = isRelationAgreement
    ? representativeAmountCandidate?.amountEventScope === "total" ||
      calculatedRelationAmountCloses
      ? "relation_total"
      : representativeAmountCandidate?.amountEventScope === "component"
        ? "component"
        : "unscoped"
    : representativeAmountCandidate?.explicitContractTotal === true
      ? "current_contract"
      : "unscoped";
  const unresolvedContractAmountFact = hasUnresolvedContractAmountFact(
    contexts,
    allCandidates,
  );
  const amountRiskCodes: string[] = [];
  if (amountValue && matchingAmountCandidates.length === 0) {
    amountRiskCodes.push("AMOUNT_CANDIDATE_MISSING");
  }
  if (amountValue && !representativeAmountCandidate?.amountRole) {
    amountRiskCodes.push("AMOUNT_ROLE_MISSING");
  }
  if (amountValue && amountScope === "unscoped") {
    amountRiskCodes.push("AMOUNT_SCOPE_MISSING");
  }
  if (
    representativeAmountCandidate?.amountRole === "payment_amount" ||
    representativeAmountCandidate?.amountRole === "tax_amount" ||
    representativeAmountCandidate?.amountRole === "service_fee" ||
    representativeAmountCandidate?.amountRole === "unit_price"
  ) {
    amountRiskCodes.push("AMOUNT_DISALLOWED_ROLE");
  }
  if (representativeAmountCandidate?.amountEventConflict === true) {
    amountRiskCodes.push("AMOUNT_EVENT_CONFLICT");
  }
  if (!amountValue && unresolvedContractAmountFact) {
    amountRiskCodes.push("AMOUNT_UNRESOLVED_RAW_FACT");
  }
  if (
    amountPdfCandidates.length > 0 &&
    !amountSamePageVisibleOcrEvidence &&
    !calculatedRelationVisibleClosure
  ) {
    amountRiskCodes.push("AMOUNT_PDF_VISIBLE_EVIDENCE_MISSING");
  }

  return {
    project: {
      selectedValue: projectValue,
      candidateExists: matchingProjectCandidates.length > 0,
      trustedSource: trustedProjectCandidates.length > 0,
      source: representativeProjectCandidate?.source || null,
      pageNumber: representativeProjectCandidate?.pageNumber || null,
      origin: representativeProjectCandidate?.projectOrigin || null,
      strongEvidence:
        representativeProjectCandidate?.strongEvidence === true ||
        representativeProjectCandidate?.projectOrigin === "cover_title" ||
        (Boolean(representativeProjectCandidate) &&
          hasClosedEntrustedProjectEvidence(
            representativeProjectCandidate as InternalCandidate,
          ) &&
          hasCorroboratedBodyProjectEvidence) ||
        (Boolean(representativeProjectCandidate) &&
          isClosedNonMainServiceCandidate(
            representativeProjectCandidate as InternalCandidate,
          ) &&
          hasCorroboratedNonMainServiceEvidence),
      distinctCandidateCount: projectCandidateCount,
      leadingScore: leadingProject?.score ?? null,
      runnerUpScore: runnerUpProject?.score ?? null,
      scoreGap: projectScoreGap,
      uniqueOrSufficientGap: projectUniqueOrSufficientGap,
      genericContractType,
      organizationName,
      paymentClause,
      pdfTextEvidencePresent: projectPdfCandidates.length > 0,
      samePageVisibleOcrEvidence: projectSamePageVisibleOcrEvidence,
      riskCodes: projectRiskCodes,
    },
    amount: {
      selectedValue: amountValue,
      candidateExists: matchingAmountCandidates.length > 0,
      role: representativeAmountCandidate?.amountRole || null,
      scope: amountScope,
      strongEvidence: representativeAmountCandidate?.strongEvidence === true,
      explicitContractTotal:
        representativeAmountCandidate?.explicitContractTotal === true,
      amountEventConflict:
        representativeAmountCandidate?.amountEventConflict === true,
      unresolvedContractAmountFact,
      pdfTextEvidencePresent: amountPdfCandidates.length > 0,
      samePageVisibleOcrEvidence: amountSamePageVisibleOcrEvidence,
      calculatedRelationVisibleClosure,
      riskCodes: amountRiskCodes,
    },
  };
}

/**
 * 从合同文本中提取结构化字段。该函数不访问文件系统或识别服务，便于稳定回归测试。
 */
export function parseContractText(
  text: string,
  options: ParseContractTextOptions = {},
): ContractRecognitionResult {
  const contexts = buildSourceContexts(text, options);
  const extractionContexts = contexts.filter(
    (context) => !context.verificationOnly,
  );
  const verificationContexts = contexts.filter(
    (context) => context.verificationOnly,
  );
  const unscopedExtractionContexts = extractionContexts.filter(
    (context) => !context.fieldScope,
  );
  const contextsForField = (field: ContractOcrFieldName): SourceContext[] =>
    extractionContexts.filter(
      (context) => !context.fieldScope || context.fieldScope === field,
    );
  const projectContexts = contextsForField("project_name");
  const amountContexts = contextsForField("amount");
  const dateContexts = contextsForField("contract_date");
  const detectedRelationType = detectAgreementRelationType(
    unscopedExtractionContexts,
  );
  const effectiveRelationType =
    options.relationType || detectedRelationType || undefined;
  const agreementAmountAnalysis = analyzeAgreementAmounts(
    amountContexts,
    effectiveRelationType,
  );
  const aggregatedAdjustmentCandidate = buildAggregatedAdjustmentCandidate(
    agreementAmountAnalysis,
  );
  const projectCollectionDiagnostics = options.candidateFunnelDiagnostics
    ? { generatedCandidates: [] as InternalCandidate[] }
    : undefined;
  const projectCandidates = collectProjectCandidates(
    projectContexts,
    effectiveRelationType,
    projectCollectionDiagnostics,
    options.expectedCategory,
  );
  const candidateBatches: Array<{
    generator: ContractOcrCandidateGenerator;
    candidates: InternalCandidate[];
  }> = [
    {
      generator: "party",
      candidates: collectPartyCandidates(
        unscopedExtractionContexts,
        options.expectedCategory,
      ),
    },
    {
      generator: "project",
      candidates: projectCandidates,
    },
    {
      generator: "amount",
      candidates: collectAmountCandidates(amountContexts),
    },
    {
      generator: "lease_amount",
      candidates: collectLeaseAmountCandidates(amountContexts, options),
    },
    {
      generator: "relation_adjustment_amount",
      candidates: collectRelationAdjustmentAmountCandidates(
        amountContexts,
        effectiveRelationType,
      ),
    },
    {
      generator: "current_agreement_total",
      candidates: collectCurrentAgreementTotalCandidates(
        amountContexts,
        effectiveRelationType,
      ),
    },
    {
      generator: "aggregated_adjustment",
      candidates: aggregatedAdjustmentCandidate
        ? [aggregatedAdjustmentCandidate]
        : [],
    },
    {
      generator: "category",
      candidates: collectCategoryCandidates(unscopedExtractionContexts),
    },
    {
      generator: "contract_date",
      candidates: collectContractDateCandidates(dateContexts),
    },
  ];
  const extractedCandidates = candidateBatches.flatMap(
    (batch) => batch.candidates,
  );
  const verificationCandidates = collectExactVerificationCandidates(
    verificationContexts,
    extractedCandidates,
  );
  candidateBatches.push({
    generator: "verification",
    candidates: verificationCandidates,
  });
  const generatedCandidates = [
    ...extractedCandidates,
    ...verificationCandidates,
  ];
  const diagnosticGeneratedCandidates = options.candidateFunnelDiagnostics
    ? [
        ...candidateBatches.flatMap((batch) =>
          batch.generator === "project"
            ? projectCollectionDiagnostics?.generatedCandidates || []
            : batch.candidates,
        ),
      ]
    : generatedCandidates;
  const directPartyCandidates =
    selectDirectPartyLabelCandidates(generatedCandidates);
  const allCandidates = filterMirroredPartyCandidates(directPartyCandidates);
  const amountSelectedCandidates = selectEffectiveAmountCandidates(
    allCandidates,
    effectiveRelationType,
  );
  const candidates = amountSelectedCandidates.filter(
    (candidate) => candidate.verificationRole !== "historical_contract_date",
  );
  const candidateGenerators = new Map<
    InternalCandidate,
    ContractOcrCandidateGenerator
  >();
  for (const batch of candidateBatches) {
    for (const candidate of batch.candidates) {
      candidateGenerators.set(candidate, batch.generator);
    }
  }
  for (const candidate of projectCollectionDiagnostics?.generatedCandidates ||
    []) {
    candidateGenerators.set(candidate, "project");
  }
  const candidateIds = new Map<InternalCandidate, string>();
  const generatedCandidateSnapshots = options.candidateFunnelDiagnostics
    ? diagnosticGeneratedCandidates.map((candidate, index) => {
        const candidateId = `candidate-${String(index + 1).padStart(4, "0")}`;
        candidateIds.set(candidate, candidateId);
        return serializeCandidateFunnelCandidate(
          candidate,
          candidateId,
          candidateGenerators.get(candidate)!,
        );
      })
    : [];
  const ranking = new Map<
    ContractOcrFieldName,
    ContractOcrCandidateRankTrace[]
  >();
  // 实际排序摘要同时供生产安全门禁和离线漏斗使用；只有候选编号及完整轨迹
  // 仍受诊断开关控制，因此不会扩展现有 OCR（光学字符识别）输出。
  const mergeDiagnostics = { candidateIds, ranking };
  const fields = FIELD_NAMES.map((field) =>
    mergeCandidates(
      field,
      candidates,
      mergeDiagnostics,
      options.expectedCategory,
    ),
  );
  applyCrossFieldValidation(fields, candidates);
  applyContractDateContextValidation(fields, dateContexts);
  applyExpectedCategoryValidation(fields, options.expectedCategory);
  const relationConflictWarning = applyExpectedRelationValidation(
    fields,
    unscopedExtractionContexts,
    options.relationType,
    options.renewalMain === true,
  );
  applyAmountPrecedenceNotice(
    fields,
    allCandidates,
    candidates,
    effectiveRelationType,
  );
  const amountBreakdown = applyInternalAmountBreakdown(
    fields,
    effectiveRelationType,
    agreementAmountAnalysis,
  );
  const amountStatus = classifyContractAmountStatus(
    fields,
    effectiveRelationType,
    amountBreakdown,
    amountContexts,
    allCandidates,
    agreementAmountAnalysis,
  );
  const amountAutomaticAdoptionContext: ContractAmountAutomaticAdoptionContext =
    {
      status: amountStatus,
      missingAmountEligible: isMissingAmountEligibleForAutomaticAdoption(
        amountStatus,
        fields,
        allCandidates,
        agreementAmountAnalysis,
      ),
    };
  const automaticAdoptionSafetyContext =
    buildContractOcrAutomaticAdoptionSafetyContext(
      fields,
      candidates,
      allCandidates,
      ranking,
      amountContexts,
      effectiveRelationType,
      options.expectedCategory,
      amountAutomaticAdoptionContext,
      amountBreakdown,
    );
  synchronizeFieldScoring(fields);
  const warnings = fields.flatMap((field) => field.warnings || []);
  const result: ContractRecognitionResult = {
    status: relationConflictWarning ? "failed" : resultStatus(fields),
    failureKind: relationConflictWarning ? "document" : undefined,
    fields,
    rawText: text,
    method: "plain_text",
    warnings: [...new Set(warnings)],
    ocrLines: [],
  };
  contractAmountBreakdowns.set(result, amountBreakdown);
  contractAmountAutomaticAdoptionContexts.set(
    result,
    amountAutomaticAdoptionContext,
  );
  contractOcrAutomaticAdoptionSafetyContexts.set(
    result,
    automaticAdoptionSafetyContext,
  );
  if (options.candidateFunnelDiagnostics) {
    const filterStages = [
      {
        stage: "framework_project" as const,
        candidates: generatedCandidates,
      },
      {
        stage: "direct_party_label" as const,
        candidates: directPartyCandidates,
      },
      { stage: "mirrored_party" as const, candidates: allCandidates },
      {
        stage: "effective_amount" as const,
        candidates: amountSelectedCandidates,
      },
      {
        stage: "historical_contract_date" as const,
        candidates,
      },
    ];
    contractOcrCandidateFunnelTraces.set(result, {
      schemaVersion: 1,
      effectiveRelationType: effectiveRelationType || null,
      generatedCandidates: generatedCandidateSnapshots,
      filteringDecisions: buildCandidateFilteringDecisions(
        diagnosticGeneratedCandidates,
        candidateIds,
        filterStages,
        ranking,
      ),
      ranking: FIELD_NAMES.map((field) => ({
        field,
        candidates: (ranking.get(field) || []).map((candidate) => ({
          ...candidate,
          orderingReasonCodes: [...candidate.orderingReasonCodes],
          candidateIds: [...candidate.candidateIds],
        })),
      })),
    });
  }
  return result;
}

interface ZipEntryWithSize extends JSZipObject {
  _data?: {
    compressedSize?: number;
    uncompressedSize?: number;
  };
}

function isDocxOnOffPropertyEnabled(attributes: string): boolean {
  const explicitValue = attributes.match(
    /(?:^|\s)(?:[A-Za-z_][\w.-]*:)?val\s*=\s*["']([^"']+)["']/i,
  )?.[1];
  return (
    !explicitValue ||
    !["0", "false", "off", "no"].includes(explicitValue.toLowerCase())
  );
}

function docxRunIsHidden(run: string): boolean {
  const hiddenProperties = run.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?(?:vanish|webHidden)\b([^>]*)\/?\s*>/gi,
  );
  return [...hiddenProperties].some((property) =>
    isDocxOnOffPropertyEnabled(property[1] || ""),
  );
}

function stripDocxNonVisibleContent(xml: string): string {
  return (
    xml
      // 删除修订和移动前内容属于历史版本，不是当前可见正文。
      .replace(
        /<((?:[A-Za-z_][\w.-]*:)?(?:del|moveFrom))\b(?![^>]*\/\s*>)[^>]*>[\s\S]*?<\/\1\s*>/gi,
        "",
      )
      // 运行属性中显式标记隐藏的文字不能进入合同候选。Word 运行不会嵌套，
      // 因此逐个检查完整运行，避免跨运行误删相邻的正常正文。
      .replace(
        /<((?:[A-Za-z_][\w.-]*:)?r)\b(?![^>]*\/\s*>)[^>]*>[\s\S]*?<\/\1\s*>/gi,
        (run) => (docxRunIsHidden(run) ? "" : run),
      )
      // 复杂域的指令文字、删除域指令和孤立删除文字都不是可见正文；域结果若
      // 以普通 w:t（文字节点）保存则继续保留。
      .replace(
        /<((?:[A-Za-z_][\w.-]*:)?(?:instrText|delInstrText|delText))\b(?![^>]*\/\s*>)[^>]*>[\s\S]*?<\/\1\s*>/gi,
        "",
      )
  );
}

function docxXmlToText(xml: string): string {
  return decodeXmlEntities(
    stripDocxNonVisibleContent(xml)
      .replace(/<(?:[A-Za-z_][\w.-]*:)?tab\b[^>]*\/?\s*>/gi, "\t")
      .replace(/<(?:[A-Za-z_][\w.-]*:)?(?:br|cr)\b[^>]*\/?\s*>/gi, "\n")
      .replace(/<\/(?:[A-Za-z_][\w.-]*:)?tc\s*>/gi, "\t")
      .replace(/<\/(?:[A-Za-z_][\w.-]*:)?tr\s*>/gi, "\n")
      .replace(/<\/(?:[A-Za-z_][\w.-]*:)?p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isUnsafeZipPath(entryName: string): boolean {
  return (
    entryName.includes("\0") ||
    entryName.startsWith("/") ||
    entryName.startsWith("\\") ||
    entryName.split(/[\\/]/).includes("..")
  );
}

async function extractSafeDocxText(filePath: string): Promise<string> {
  const bytes = await fs.promises.readFile(filePath);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("文件不是有效的 DOCX 文档");
  }
  const zip = await JSZip.loadAsync(bytes, {
    checkCRC32: true,
    createFolders: false,
  });
  const entries = Object.values(zip.files);
  if (entries.length === 0 || entries.length > MAX_DOCX_ENTRIES) {
    throw new Error("DOCX 文档条目数量异常");
  }

  let totalUncompressed = 0;
  let totalCompressed = 0;
  for (const entry of entries) {
    if (isUnsafeZipPath(entry.name)) throw new Error("DOCX 文档包含不安全路径");
    const sizedEntry = entry as ZipEntryWithSize;
    totalUncompressed += sizedEntry._data?.uncompressedSize || 0;
    totalCompressed += sizedEntry._data?.compressedSize || 0;
    if (
      /(?:^|\/)vbaProject\.bin$/i.test(entry.name) ||
      /^word\/activeX\//i.test(entry.name)
    ) {
      throw new Error("DOCX 文档包含宏或活动嵌入对象，已拒绝识别");
    }
  }
  if (
    totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES ||
    (totalUncompressed > 5 * 1024 * 1024 &&
      totalCompressed > 0 &&
      totalUncompressed / totalCompressed > 200)
  ) {
    throw new Error("DOCX 文档解压大小或压缩比异常");
  }

  const contentTypesEntry = zip.file("[Content_Types].xml");
  const documentEntry = zip.file(
    "word/document.xml",
  ) as ZipEntryWithSize | null;
  if (!contentTypesEntry || !documentEntry) {
    throw new Error("文件缺少 DOCX 必要结构");
  }
  const contentTypes = await contentTypesEntry.async("string");
  if (/macroEnabled|vbaProject/i.test(contentTypes)) {
    throw new Error("DOCX 文档包含宏内容，已拒绝识别");
  }

  const relationshipEntries = entries.filter(
    (entry) => !entry.dir && /\.rels$/i.test(entry.name),
  );
  let relationshipBytes = 0;
  let externalRelationshipCount = 0;
  for (const entry of relationshipEntries) {
    relationshipBytes +=
      (entry as ZipEntryWithSize)._data?.uncompressedSize || 0;
    if (relationshipBytes > MAX_DOCX_RELATIONSHIPS_BYTES) {
      throw new Error("DOCX 关系文件总量异常");
    }
    const xml = await entry.async("string");
    for (const relationship of xml.matchAll(/<Relationship\b[^>]*>/gi)) {
      const tag = relationship[0];
      if (!/TargetMode\s*=\s*["']External["']/i.test(tag)) continue;
      externalRelationshipCount += 1;
      const target = tag.match(/Target\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      const type = tag.match(/Type\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      if (
        externalRelationshipCount > 20 ||
        target.length > 2_048 ||
        !/^(?:https?:|mailto:)/i.test(target) ||
        /attachedTemplate|oleObject|package/i.test(type)
      ) {
        throw new Error("DOCX 文档包含异常外部关系，已拒绝识别");
      }
    }
  }

  const xml = await documentEntry.async("string");
  if (Buffer.byteLength(xml, "utf8") > MAX_DOCX_XML_BYTES) {
    throw new Error("DOCX 正文内容过大");
  }
  const stylesEntry = zip.file("word/styles.xml") as ZipEntryWithSize | null;
  if (stylesEntry) {
    const stylesXml = await stylesEntry.async("string");
    if (Buffer.byteLength(stylesXml, "utf8") > MAX_DOCX_XML_BYTES) {
      throw new Error("DOCX 样式内容过大");
    }
    if (docxRunIsHidden(stylesXml)) {
      // 样式可通过 w:rStyle／w:pStyle 及 basedOn（样式继承）间接隐藏文字。
      // 当前不尝试模拟完整 Word（文字处理软件）样式级联；发现启用的隐藏
      // 样式即安全失败，防止隐藏正文进入财务核对候选。
      throw new Error("DOCX 文档包含隐藏文字样式，已拒绝自动解析");
    }
  }
  const text = docxXmlToText(xml);
  if (!text.trim()) throw new Error("DOCX 文档未提取到正文文字");
  return text;
}

function runSerializedLegacyDocConversion<T>(
  task: () => Promise<T>,
): Promise<T> {
  const current = legacyDocConversionChain.then(task, task);
  legacyDocConversionChain = current.then(
    () => undefined,
    () => undefined,
  );
  return current;
}

async function extractSafeLegacyDocText(filePath: string): Promise<string> {
  const bytes = await fs.promises.readFile(filePath);
  if (
    bytes.length < 512 ||
    bytes.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1" ||
    bytes.readUInt16LE(28) !== 0xfffe ||
    ![9, 12].includes(bytes.readUInt16LE(30))
  ) {
    throw new Error("文件不是结构完整的旧版 DOC 文档");
  }

  return await runSerializedLegacyDocConversion(async () => {
    const workDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "contract-doc-convert-"),
    );
    const profileDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "contract-soffice-profile-"),
    );
    const copiedSource = path.join(workDirectory, "source.doc");
    const convertedPath = path.join(workDirectory, "source.docx");
    try {
      await fs.promises.copyFile(filePath, copiedSource);
      await execFileAsync(
        "soffice",
        [
          "--headless",
          "--nologo",
          "--nodefault",
          "--nolockcheck",
          "--nofirststartwizard",
          `-env:UserInstallation=file://${profileDirectory}`,
          "--convert-to",
          "docx:Office Open XML Text",
          "--outdir",
          workDirectory,
          copiedSource,
        ],
        { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 },
      );
      if (!fs.existsSync(convertedPath)) {
        throw new Error("旧版 DOC 文档未能安全转换为 DOCX");
      }
      return await extractSafeDocxText(convertedPath);
    } finally {
      await Promise.allSettled([
        fs.promises.rm(workDirectory, { recursive: true, force: true }),
        fs.promises.rm(profileDirectory, { recursive: true, force: true }),
      ]);
    }
  });
}

function buildFailedResult(
  message: string,
  failureKind: NonNullable<
    ContractRecognitionResult["failureKind"]
  > = "document",
): ContractRecognitionResult {
  return {
    status: "failed",
    failureKind,
    fields: FIELD_NAMES.map((field) => ({
      field,
      originalValue: "",
      normalizedValue: "",
      confidence: 0,
      ocrConfidence: null,
      fieldScore: 0,
      source: "rule",
      warnings: [`未识别到${FIELD_LABELS[field]}`],
    })),
    rawText: "",
    method: "none",
    warnings: [message],
    ocrLines: [],
  };
}

function isMimeAllowed(
  extension: ".pdf" | ".doc" | ".docx" | ".jpg" | ".jpeg" | ".png",
  mimeType: string,
): boolean {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (!normalized || normalized === "application/octet-stream") return true;
  if (extension === ".pdf") return normalized === "application/pdf";
  if (extension === ".doc") return normalized === "application/msword";
  if (extension === ".docx") {
    return (
      normalized ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  }
  if (extension === ".png") return normalized === "image/png";
  return normalized === "image/jpeg" || normalized === "image/jpg";
}

function averageOcrConfidence(lines: readonly ContractPaddleOcrLine[]): number {
  const meaningful = lines.filter((line) => meaningfulLength(line.text) > 0);
  if (meaningful.length === 0) return 0;
  return (
    meaningful.reduce((total, line) => total + line.confidence, 0) /
    meaningful.length
  );
}

function normalizeOcrBox(
  box: readonly number[][],
  transform: {
    offsetX?: number;
    offsetY?: number;
    scaleX?: number;
    scaleY?: number;
  } = {},
): number[][] {
  const offsetX = transform.offsetX || 0;
  const offsetY = transform.offsetY || 0;
  const scaleX = transform.scaleX || 1;
  const scaleY = transform.scaleY || 1;
  return box
    .filter(
      (point) =>
        Array.isArray(point) &&
        Number.isFinite(Number(point[0])) &&
        Number.isFinite(Number(point[1])),
    )
    .map((point) => [
      Number(point[0]) * scaleX + offsetX,
      Number(point[1]) * scaleY + offsetY,
    ]);
}

function translateContractOcrLines(
  lines: readonly ContractPaddleOcrLine[],
  transform: {
    offsetX?: number;
    offsetY?: number;
    scaleX?: number;
    scaleY?: number;
  },
): ContractPaddleOcrLine[] {
  return lines.map((line) => ({
    ...line,
    box: normalizeOcrBox(line.box || [], transform),
  }));
}

function buildContractRawOcrLines(
  page: number,
  lines: readonly ContractPaddleOcrLine[],
  fallbackModel?: PaddleOcrModelVersion,
): ContractRawOcrLine[] {
  return lines.map((line) => ({
    page,
    text: line.text,
    bbox: normalizeOcrBox(line.box || []),
    confidence: Number.isFinite(line.confidence) ? line.confidence : 0,
    modelVersion: line.modelVersion || fallbackModel || "v4_mobile",
  }));
}

function buildContractQrCodeLines(
  page: number,
  qrCodes: readonly string[],
  fallbackModel?: PaddleOcrModelVersion,
): ContractRawOcrLine[] {
  return [...new Set(qrCodes.map((value) => value.trim()).filter(Boolean))].map(
    (value) => ({
      page,
      text: `二维码合同编号：${value}`,
      bbox: [],
      confidence: 1,
      modelVersion: fallbackModel || "v4_mobile",
    }),
  );
}

function sourcesRawText(sources: readonly ContractTextSource[]): string {
  return sources
    .filter((source) => source.text.trim())
    .map((source) =>
      source.pageNumber
        ? `【第${source.pageNumber}页/${source.source}/${source.recognitionEngine || "unknown"}】\n${source.text}`
        : source.text,
    )
    .join("\n\n");
}

async function extractPdfTextPages(
  filePath: string,
  pageCount: number,
): Promise<ContractTextSource[]> {
  const result = (await execFileAsync("pdftotext", ["-layout", filePath, "-"], {
    timeout: 60_000,
    maxBuffer: 30 * 1024 * 1024,
    encoding: "utf8",
  })) as { stdout: string };
  const pages = (result.stdout || "").split("\f");
  return Array.from({ length: pageCount }, (_, index) => ({
    text: pages[index] || "",
    source: "pdf_text" as const,
    pageNumber: index + 1,
    confidence: 99,
  })).filter((source) => source.text.trim());
}

/**
 * 根据页面物理尺寸收缩渲染分辨率，保证单页位图不会超过安全边长和像素预算。
 */
export function calculateSafePdfRenderDpi(
  widthPoints: number,
  heightPoints: number,
  requestedDpi: number,
): number {
  if (
    !Number.isFinite(widthPoints) ||
    !Number.isFinite(heightPoints) ||
    !Number.isFinite(requestedDpi) ||
    widthPoints <= 0 ||
    heightPoints <= 0 ||
    requestedDpi <= 0
  ) {
    throw new Error("PDF 页面尺寸或渲染分辨率异常");
  }

  const widthInches = widthPoints / 72;
  const heightInches = heightPoints / 72;
  const dpiByPageEdge =
    MAX_PDF_RENDER_EDGE_PIXELS / Math.max(widthInches, heightInches);
  // 合同按横向阅读，完整保留页面宽度，只沿纵向切片，避免横版页面把同一行
  // 的锚点和值拆到两个裁片后破坏阅读顺序。
  const dpiByOcrLineWidth = MAX_OCR_TILE_EDGE_PIXELS / widthInches;
  const dpiByPixels = Math.sqrt(
    MAX_PDF_RENDER_PIXELS / (widthInches * heightInches),
  );
  let safeDpi = Math.floor(
    Math.min(requestedDpi, dpiByPageEdge, dpiByOcrLineWidth, dpiByPixels),
  );

  // 若资源上限只比既有档位高出很小幅度，则回落到该档位，避免 480 与
  // 600 请求最终只差几个 DPI（每英寸点数）却重复识别整页。
  const nearbyTier = [600, 480, 300].find(
    (tier) => tier <= safeDpi && safeDpi / tier <= 1.05,
  );
  if (nearbyTier) safeDpi = nearbyTier;

  while (safeDpi >= 1) {
    const renderedWidth = Math.ceil(widthInches * safeDpi);
    const renderedHeight = Math.ceil(heightInches * safeDpi);
    if (
      renderedWidth <= MAX_PDF_RENDER_EDGE_PIXELS &&
      renderedHeight <= MAX_PDF_RENDER_EDGE_PIXELS &&
      renderedWidth * renderedHeight <= MAX_PDF_RENDER_PIXELS
    ) {
      return safeDpi;
    }
    safeDpi -= 1;
  }

  throw new Error("PDF 页面尺寸异常，无法在安全像素范围内识别");
}

/** 以页码和最终渲染 DPI（每英寸点数）标识一次有效识别，避免按请求档位重复执行。 */
export function calculateContractPdfOcrRenderProfile(
  pageNumber: number,
  widthPoints: number,
  heightPoints: number,
  requestedDpi: number,
): { renderDpi: number; key: string } {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    throw new Error("PDF 页码异常");
  }
  const renderDpi = calculateSafePdfRenderDpi(
    widthPoints,
    heightPoints,
    requestedDpi,
  );
  return { renderDpi, key: `${pageNumber}:${renderDpi}` };
}

export interface ContractPdfOcrTile {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 直接上传的图片先按同一比例收缩到可保留完整行宽的安全画布，再复用纵向
 * 裁片规则。宽高只使用同一个缩放比例，不能为减少裁片数而横向截断文字行。
 */
export function calculateContractImageOcrSize(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  if (
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    sourceWidth * sourceHeight > MAX_SOURCE_IMAGE_PIXELS
  ) {
    throw new Error("合同图片尺寸超过安全限制");
  }

  const scale = Math.min(
    1,
    MAX_OCR_TILE_EDGE_PIXELS / sourceWidth,
    MAX_PDF_RENDER_EDGE_PIXELS / sourceHeight,
  );
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  };
}

/**
 * 将最终渲染页面切成按阅读顺序排列的重叠裁片。每个裁片同时满足 PaddleOCR（飞桨文字识别）
 * 的边长限制和实测内存预算，重叠区用于保护跨切缝文字行。
 */
export function calculateContractPdfOcrTiles(
  renderedWidth: number,
  renderedHeight: number,
): ContractPdfOcrTile[] {
  if (
    !Number.isSafeInteger(renderedWidth) ||
    !Number.isSafeInteger(renderedHeight) ||
    renderedWidth < 1 ||
    renderedHeight < 1 ||
    renderedWidth > MAX_PDF_RENDER_EDGE_PIXELS ||
    renderedHeight > MAX_PDF_RENDER_EDGE_PIXELS ||
    renderedWidth * renderedHeight > MAX_PDF_RENDER_PIXELS
  ) {
    throw new Error("PDF 页面渲染尺寸超过安全限制");
  }

  if (renderedWidth > MAX_OCR_TILE_EDGE_PIXELS) {
    throw new Error("PDF 页面宽度超过安全识别限制");
  }

  let selectedRows = 0;
  let selectedTileHeight = 0;
  for (let rows = 1; rows <= MAX_OCR_TILE_ROWS; rows += 1) {
    const tileHeight = Math.ceil(
      (renderedHeight + (rows - 1) * OCR_TILE_OVERLAP_PIXELS) / rows,
    );
    if (
      tileHeight <= MAX_OCR_TILE_EDGE_PIXELS &&
      renderedWidth * tileHeight <= MAX_OCR_TILE_PIXELS
    ) {
      selectedRows = rows;
      selectedTileHeight = tileHeight;
      break;
    }
  }

  if (selectedRows === 0) {
    throw new Error("PDF 页面无法切分到安全识别尺寸");
  }

  const starts = (total: number, size: number, count: number): number[] =>
    count === 1
      ? [0]
      : Array.from({ length: count }, (_, index) =>
          Math.round(((total - size) * index) / (count - 1)),
        );
  return starts(renderedHeight, selectedTileHeight, selectedRows).map((y) => ({
    x: 0,
    y,
    width: renderedWidth,
    height: selectedTileHeight,
  }));
}

/** 合并相邻裁片，并去掉重叠区域中连续重复的文字行。 */
export function mergeContractOcrTileLines<T extends { text: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const comparable = (value: string): string =>
    value.replace(/\s+/g, "").trim();
  const maximumOverlap = Math.min(existing.length, incoming.length, 20);
  let overlap = 0;
  for (let count = maximumOverlap; count >= 1; count -= 1) {
    const suffix = existing.slice(existing.length - count);
    const prefix = incoming.slice(0, count);
    if (
      suffix.every(
        (line, index) =>
          comparable(line.text) === comparable(prefix[index].text),
      )
    ) {
      overlap = count;
      break;
    }
  }
  return [...existing, ...incoming.slice(overlap)];
}

const CONTRACT_DATE_FOCUS_ANCHOR =
  /合同签订(?:日期|时间)|签订(?:日期|时间)|签定(?:日期|时间)|签署日期/;

/**
 * 当整页识别已找到签订日期标签，但标签附近没有完整合法日期，或已有日期
 * 年份与本页明确期限明显矛盾时，计算只包含原始标签行及其手写值的小区域。
 * 期限只触发重新查看当前页面像素，不能提出、改写或排序日期；裁片坐标和值
 * 不读取文件名、上传日期或其他外部真值。
 */
export function calculateContractDateFocusCrop(
  lines: readonly ContractPaddleOcrLine[],
  imageWidth: number,
  imageHeight: number,
  pageLines: readonly ContractPaddleOcrLine[] = lines,
): ContractDateFocusCrop | null {
  if (
    !Number.isSafeInteger(imageWidth) ||
    !Number.isSafeInteger(imageHeight) ||
    imageWidth < 1 ||
    imageHeight < 1
  ) {
    return null;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      line.confidence < 0.55 ||
      !CONTRACT_DATE_FOCUS_ANCHOR.test(normalizeLine(line.text))
    ) {
      continue;
    }
    const nearbyDateLines = lines.slice(Math.max(0, index - 4), index + 5);
    const nearbyDates = [
      ...nearbyDateLines.flatMap((candidate) =>
        extractDates(normalizeLine(candidate.text)),
      ),
      ...extractDates(
        nearbyDateLines
          .map((candidate) => normalizeLine(candidate.text))
          .join("")
          .replace(/\s+/g, ""),
      ),
    ];
    if (nearbyDates.length > 0) {
      const ranges = collectValidityRangesFromPaddleLines(pageLines);
      const everyDateClearlyContradicted = nearbyDates.every((date) =>
        isContractDateYearClearlyContradicted(date.normalizedValue, ranges),
      );
      const hasLowConfidenceDateEvidence = nearbyDateLines.some(
        (candidate) =>
          candidate.confidence < 0.85 &&
          extractDates(normalizeLine(candidate.text)).length > 0,
      );
      // 已有不矛盾且置信度稳定的完整日期时不重复识别；低置信度日期仍执行
      // 局部双视图复核。期限绝不能被当作正确日期来源。
      if (!everyDateClearlyContradicted && !hasLowConfidenceDateEvidence)
        continue;
    }

    const points = line.box
      .filter(
        (point) =>
          Array.isArray(point) &&
          Number.isFinite(point[0]) &&
          Number.isFinite(point[1]),
      )
      .map((point) => ({ x: Number(point[0]), y: Number(point[1]) }));
    if (points.length < 4) continue;

    const minimumX = Math.min(...points.map((point) => point.x));
    const maximumX = Math.max(...points.map((point) => point.x));
    const minimumY = Math.min(...points.map((point) => point.y));
    const maximumY = Math.max(...points.map((point) => point.y));
    const lineHeight = maximumY - minimumY;
    if (!Number.isFinite(lineHeight) || lineHeight < 12) continue;

    const left = Math.max(0, Math.floor(minimumX - lineHeight * 1.25));
    const top = Math.max(0, Math.floor(minimumY - lineHeight * 2));
    const right = Math.min(
      imageWidth,
      Math.ceil(
        Math.max(maximumX + lineHeight * 12, minimumX + imageWidth * 0.45),
      ),
    );
    const bottom = Math.min(imageHeight, Math.ceil(maximumY + lineHeight * 2));
    const width = right - left;
    const height = bottom - top;
    if (width < 80 || height < 40 || width * height > MAX_OCR_TILE_PIXELS)
      continue;
    return { left, top, width, height };
  }
  return null;
}

/**
 * 日期局部增强可以放大笔迹，但最终送入 PaddleOCR（飞桨文字识别）的位图
 * 必须继续服从与普通页面裁片相同的 200 万像素硬上限。宽高使用同一缩放
 * 比例，整数取整后再由 Sharp（图像处理库）按 `inside`（内接）方式保持原
 * 始宽高比；期限、文件名和其他外部真值不参与尺寸或候选计算。
 */
export function calculateContractDateFocusEnhancementSize(
  sourceWidth: number,
  sourceHeight: number,
): ContractDateFocusEnhancementSize {
  if (
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    sourceWidth * sourceHeight > MAX_OCR_TILE_PIXELS
  ) {
    throw new Error("合同日期增强裁片尺寸超过安全限制");
  }

  const scale = Math.max(
    1,
    Math.min(
      3,
      3_600 / sourceWidth,
      2_400 / sourceHeight,
      Math.sqrt(MAX_OCR_TILE_PIXELS / (sourceWidth * sourceHeight)),
    ),
  );
  return {
    width: Math.max(sourceWidth, Math.floor(sourceWidth * scale)),
    height: Math.max(sourceHeight, Math.floor(sourceHeight * scale)),
  };
}

/**
 * 只保留增强裁片内“签订日期标签 + 完整合法日期”的最小证据窗口。若增强
 * 后仍是缺位字符或存在候选冲突，后续风险策略继续局部复核并重新排序。
 */
function selectFocusedContractDateLines(
  lines: readonly ContractPaddleOcrLine[],
): ContractPaddleOcrLine[] {
  const anchorIndexes = lines
    .map((line, index) =>
      CONTRACT_DATE_FOCUS_ANCHOR.test(normalizeLine(line.text)) ? index : -1,
    )
    .filter((index) => index >= 0);
  for (const anchor of anchorIndexes) {
    const start = Math.max(0, anchor - 1);
    const end = Math.min(lines.length, anchor + 8);
    const window = lines
      .slice(start, end)
      .filter((line) => normalizeLine(line.text));
    const fusedText = window
      .map((line) => normalizeLine(line.text))
      .join("")
      .replace(/\s+/g, "");
    if (extractDates(fusedText).length > 0) return window;
  }
  const firstAnchor = anchorIndexes[0];
  if (firstAnchor == null) return [];
  // 局部视图仍可能只识别出日期碎片。保留强标签及其后的白名单碎片，供
  // 其他预处理视图共同参与候选融合，同时原始逐行结果继续完整留痕。
  const fallback = lines
    .slice(firstAnchor, Math.min(lines.length, firstAnchor + 8))
    .filter((line, index) => {
      const normalized = normalizeLine(line.text).trim();
      return (
        index === 0 ||
        (Boolean(normalized) && CONTRACT_DATE_FRAGMENT_PATTERN.test(normalized))
      );
    });
  if (
    fallback.length > 1 ||
    extractDates(normalizeLine(fallback[0]?.text || "")).length > 0
  ) {
    return fallback;
  }
  return [];
}

interface ContractDateFocusTileRequest {
  tileIndex: number;
  tile: ContractPdfOcrTile;
  lines: ContractPaddleOcrLine[];
}

async function recognizeFocusedContractDateFromTile(
  filePath: string,
  pageNumber: number,
  renderDpi: number,
  temporaryDirectory: string,
  tileCount: number,
  request: ContractDateFocusTileRequest,
  focusCrop: ContractDateFocusCrop,
  ocrModel?: PaddleOcrRequestModel,
): Promise<{
  lines: ContractPaddleOcrLine[];
  rawLines: ContractRawOcrLine[];
}> {
  const outputPrefix = path.join(
    temporaryDirectory,
    `page-${pageNumber}-300-${request.tileIndex}-date-focus-${Date.now()}`,
  );
  const imagePath = `${outputPrefix}.png`;
  const focusPaths = [
    `${outputPrefix}-enhanced.png`,
    `${outputPrefix}-threshold.png`,
  ];
  const cropArguments =
    tileCount === 1
      ? []
      : [
          "-x",
          String(request.tile.x),
          "-y",
          String(request.tile.y),
          "-W",
          String(request.tile.width),
          "-H",
          String(request.tile.height),
        ];

  try {
    await runWithContractPdfRenderPermit(() =>
      execFileAsync(
        "pdftoppm",
        [
          "-png",
          "-singlefile",
          "-r",
          String(renderDpi),
          ...cropArguments,
          "-f",
          String(pageNumber),
          "-l",
          String(pageNumber),
          filePath,
          outputPrefix,
        ],
        { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 },
      ),
    );
    if (!fs.existsSync(imagePath))
      throw new Error("合同日期增强页面转图片失败");

    const enhancementSize = calculateContractDateFocusEnhancementSize(
      focusCrop.width,
      focusCrop.height,
    );
    await sharp(imagePath)
      .extract(focusCrop)
      .grayscale()
      .normalize()
      .resize({
        width: enhancementSize.width,
        height: enhancementSize.height,
        fit: "inside",
        kernel: "lanczos3",
      })
      .sharpen({ sigma: 1.1, m1: 1.2, m2: 0.7 })
      .png()
      .toFile(focusPaths[0]);
    await sharp(imagePath)
      .extract(focusCrop)
      .grayscale()
      .normalize()
      .resize({
        width: enhancementSize.width,
        height: enhancementSize.height,
        fit: "inside",
        kernel: "lanczos3",
      })
      .sharpen({ sigma: 0.9, m1: 1, m2: 0.5 })
      .threshold(172)
      .png()
      .toFile(focusPaths[1]);
    const allFocusedLines: ContractPaddleOcrLine[] = [];
    const allRawLines: ContractRawOcrLine[] = [];
    for (const focusPath of focusPaths) {
      const focusedResult = await callContractPaddleOcrDetailed(
        focusPath,
        ocrModel,
      );
      const completeFocusedLines = (focusedResult.lines || []).map((line) => ({
        ...line,
        modelVersion: line.modelVersion || focusedResult.modelVersion,
      }));
      const focusedLines = selectFocusedContractDateLines(completeFocusedLines);
      const translateOptions = {
        offsetX: request.tile.x + focusCrop.left,
        offsetY: request.tile.y + focusCrop.top,
        scaleX: focusCrop.width / enhancementSize.width,
        scaleY: focusCrop.height / enhancementSize.height,
      };
      const pageLines = translateContractOcrLines(
        focusedLines,
        translateOptions,
      );
      const completePageLines = translateContractOcrLines(
        completeFocusedLines,
        translateOptions,
      );
      allFocusedLines.push(...pageLines);
      allRawLines.push(
        ...buildContractRawOcrLines(
          pageNumber,
          completePageLines,
          focusedResult.modelVersion,
        ),
      );
    }
    return {
      lines: allFocusedLines,
      rawLines: allRawLines,
    };
  } finally {
    for (const temporaryPath of [...focusPaths, imagePath]) {
      try {
        await fs.promises.unlink(temporaryPath);
      } catch {
        // 临时目录最终还会统一清理。
      }
    }
  }
}

async function recognizePdfPage(
  filePath: string,
  pageNumber: number,
  dpi: 300 | 480 | 600,
  temporaryDirectory: string,
  renderDpi: number,
  widthPoints: number,
  heightPoints: number,
  ocrModel?: PaddleOcrRequestModel,
  automaticReviewBudget?: { remaining: number },
): Promise<ContractTextSource> {
  const renderedWidth = Math.ceil((widthPoints / 72) * renderDpi);
  const renderedHeight = Math.ceil((heightPoints / 72) * renderDpi);
  const tiles = calculateContractPdfOcrTiles(renderedWidth, renderedHeight);
  let combinedLines: ContractPaddleOcrLine[] = [];
  const fallbackTexts: string[] = [];
  const dateFocusRequests: ContractDateFocusTileRequest[] = [];
  const rawOcrLines: ContractRawOcrLine[] = [];
  let modelVersion: PaddleOcrModelVersion | undefined;
  let dateFocusApplied = false;

  for (const [tileIndex, tile] of tiles.entries()) {
    const outputPrefix = path.join(
      temporaryDirectory,
      `page-${pageNumber}-${dpi}-${tileIndex}-${Date.now()}`,
    );
    const imagePath = `${outputPrefix}.png`;
    const cropArguments =
      tiles.length === 1
        ? []
        : [
            "-x",
            String(tile.x),
            "-y",
            String(tile.y),
            "-W",
            String(tile.width),
            "-H",
            String(tile.height),
          ];
    await runWithContractPdfRenderPermit(() =>
      execFileAsync(
        "pdftoppm",
        [
          "-png",
          "-singlefile",
          "-r",
          String(renderDpi),
          ...cropArguments,
          "-f",
          String(pageNumber),
          "-l",
          String(pageNumber),
          filePath,
          outputPrefix,
        ],
        {
          timeout: dpi === 300 ? 90_000 : 120_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      ),
    );
    if (!fs.existsSync(imagePath)) throw new Error("合同页面转图片失败");
    try {
      const result = await callContractPaddleOcrDetailed(imagePath, ocrModel);
      modelVersion ||= result.modelVersion;
      const lines = result.lines || [];
      if (
        dpi === 300 &&
        lines.some(
          (line) =>
            line.confidence >= 0.55 &&
            CONTRACT_DATE_FOCUS_ANCHOR.test(normalizeLine(line.text)),
        )
      ) {
        dateFocusRequests.push({ tileIndex, tile, lines });
      }
      const pageLines = translateContractOcrLines(lines, {
        offsetX: tile.x,
        offsetY: tile.y,
      });
      const previousLineCount = combinedLines.length;
      combinedLines = mergeContractOcrTileLines(combinedLines, pageLines);
      rawOcrLines.push(
        ...buildContractRawOcrLines(
          pageNumber,
          combinedLines.slice(previousLineCount),
          result.modelVersion,
        ),
        ...buildContractQrCodeLines(
          pageNumber,
          result.qrCodes || [],
          result.modelVersion,
        ),
      );
      if (lines.length === 0 && result.fullText.trim()) {
        fallbackTexts.push(result.fullText);
      }
    } finally {
      try {
        await fs.promises.unlink(imagePath);
      } catch {
        // 临时目录最终还会统一清理。
      }
    }
  }

  // 先汇总当前页全部裁片文字，再判断格式合法的日期是否与本页明确期限
  // 明显矛盾。期限只允许触发重看日期锚点所在像素，不能提出或改写日期。
  if (
    dpi === 300 &&
    dateFocusRequests.length > 0 &&
    (automaticReviewBudget?.remaining ?? 1) > 0
  ) {
    for (const request of dateFocusRequests.slice(0, 2)) {
      const focusCrop = calculateContractDateFocusCrop(
        request.lines,
        request.tile.width,
        request.tile.height,
        combinedLines,
      );
      if (!focusCrop) continue;
      if (automaticReviewBudget) automaticReviewBudget.remaining -= 1;
      const focused = await recognizeFocusedContractDateFromTile(
        filePath,
        pageNumber,
        renderDpi,
        temporaryDirectory,
        tiles.length,
        request,
        focusCrop,
        ocrModel,
      );
      if (focused.lines.length === 0) continue;
      // 这是同一页、同一 PaddleOCR（飞桨文字识别）通道的增强采样；增强值
      // 仍需参与候选冲突和日期上下文校验，不能覆盖不一致的整页结果。
      combinedLines = [...combinedLines, ...focused.lines];
      rawOcrLines.push(...focused.rawLines);
      dateFocusApplied = true;
      break;
    }
  }

  return {
    text:
      combinedLines.length > 0
        ? combinedLines.map((line) => line.text).join("\n")
        : fallbackTexts.join("\n"),
    source: `ocr_${dpi}`,
    pageNumber,
    confidence: averageOcrConfidence(combinedLines),
    lineConfidences: combinedLines.map((line) => line.confidence),
    recognitionEngine: "paddleocr",
    ocrLines: rawOcrLines,
    modelVersion,
    enhancedFieldScopes: dateFocusApplied ? ["contract_date"] : [],
  };
}

interface ContractAutomaticReviewAnchor {
  field: ContractOcrAutomaticReviewField;
  pageNumber: number;
  source: "ocr_300" | "ocr_480" | "ocr_600";
  line: ContractRawOcrLine;
}

export function calculateContractAutomaticReviewCrop(
  field: ContractOcrAutomaticReviewField,
  line: Pick<ContractRawOcrLine, "bbox">,
  imageWidth: number,
  imageHeight: number,
): ContractDateFocusCrop | null {
  if (
    !Number.isSafeInteger(imageWidth) ||
    !Number.isSafeInteger(imageHeight) ||
    imageWidth < 1 ||
    imageHeight < 1
  ) {
    return null;
  }
  const points = (line.bbox || [])
    .filter(
      (point) =>
        Array.isArray(point) &&
        Number.isFinite(Number(point[0])) &&
        Number.isFinite(Number(point[1])),
    )
    .map((point) => ({ x: Number(point[0]), y: Number(point[1]) }));
  if (points.length < 4) return null;
  const minimumX = Math.min(...points.map((point) => point.x));
  const maximumX = Math.max(...points.map((point) => point.x));
  const minimumY = Math.min(...points.map((point) => point.y));
  const maximumY = Math.max(...points.map((point) => point.y));
  const lineHeight = Math.max(12, maximumY - minimumY);
  let left =
    field === "contract_date"
      ? Math.max(0, Math.floor(minimumX - lineHeight * 1.5))
      : 0;
  let right =
    field === "contract_date"
      ? Math.min(
          imageWidth,
          Math.ceil(
            Math.max(maximumX + lineHeight * 12, minimumX + imageWidth * 0.45),
          ),
        )
      : imageWidth;
  let top = Math.max(0, Math.floor(minimumY - lineHeight * 2));
  let bottom = Math.min(
    imageHeight,
    Math.ceil(maximumY + lineHeight * (field === "project_name" ? 5 : 3.5)),
  );
  const width = right - left;
  if (width < 80) return null;
  const maximumHeight = Math.max(40, Math.floor(MAX_OCR_TILE_PIXELS / width));
  if (bottom - top > maximumHeight) {
    const center = (minimumY + maximumY) / 2;
    top = Math.max(0, Math.floor(center - maximumHeight / 2));
    bottom = Math.min(imageHeight, top + maximumHeight);
    if (bottom - top < maximumHeight) {
      top = Math.max(0, bottom - maximumHeight);
    }
  }
  left = Math.max(0, Math.min(left, imageWidth - 1));
  right = Math.max(left + 1, Math.min(right, imageWidth));
  const height = bottom - top;
  if (
    right - left < 80 ||
    height < 40 ||
    (right - left) * height > MAX_OCR_TILE_PIXELS
  ) {
    return null;
  }
  return { left, top, width: right - left, height };
}

function automaticReviewAnchorScore(
  field: ContractOcrAutomaticReviewField,
  text: string,
  pageNumber: number,
  preferredPage?: number,
): number {
  const normalized = normalizeLine(text).replace(/\s+/g, "");
  let score = preferredPage === pageNumber ? 40 : 0;
  if (field === "project_name") {
    if (
      /(?:信息咨询项目名称|工程项目名称|咨询项目名称|项目[（(]工程[）)]名称|项目名[称标]|工程名称|合同名称)[:：]?/u.test(
        normalized,
      )
    )
      score += 90;
    else if (
      /(?:千伏|项目|工程|许可证|不动产|前期手续|楼门牌)/u.test(normalized)
    )
      score += 55;
    if (pageNumber === 1) score += 20;
    score += Math.min(20, meaningfulLength(normalized) / 4);
  } else if (field === "amount") {
    if (
      /合同(?:总额|总价|金额|价款)|签约金额|项目金额|服务费用(?:总额|合计)|含税金额|总金额|协议金额/u.test(
        normalized,
      )
    )
      score += 100;
    else if (/增加|追加|调增|减少|核减|调减|变更后金额/u.test(normalized))
      score += 75;
    else if (/[￥¥元]/u.test(normalized)) score += 30;
  } else {
    if (CONTRACT_DATE_FOCUS_ANCHOR.test(normalized)) score += 100;
    else if (/签订于|签署于|签约于/u.test(normalized)) score += 70;
    if (extractDates(normalized).length > 0) score += 30;
    if (pageNumber === 1) score += 15;
  }
  return score;
}

function selectContractAutomaticReviewAnchor(
  field: ContractOcrAutomaticReviewField,
  result: ContractRecognitionResult,
  sources: readonly ContractTextSource[],
  excludedSources: ReadonlySet<
    ContractAutomaticReviewAnchor["source"]
  > = new Set(),
): ContractAutomaticReviewAnchor | null {
  const selectedField = result.fields.find(
    (candidate) => candidate.field === field,
  );
  const anchors: Array<ContractAutomaticReviewAnchor & { score: number }> = [];
  for (const source of sources) {
    if (
      !source.pageNumber ||
      !source.source.startsWith("ocr_") ||
      !source.ocrLines?.length
    ) {
      continue;
    }
    const typedSource =
      source.source as ContractAutomaticReviewAnchor["source"];
    if (excludedSources.has(typedSource)) continue;
    for (const line of source.ocrLines) {
      if (line.page !== source.pageNumber || !line.bbox?.length) continue;
      const score = automaticReviewAnchorScore(
        field,
        line.text,
        source.pageNumber,
        selectedField?.pageNumber,
      );
      if (score < 55) continue;
      anchors.push({
        field,
        pageNumber: source.pageNumber,
        source: typedSource,
        line,
        score: score + normalizeRawOcrConfidence(line.confidence) * 10,
      });
    }
  }
  const sourcePriority = (source: ContractAutomaticReviewAnchor["source"]) =>
    source === "ocr_600" ? 3 : source === "ocr_480" ? 2 : 1;
  const selected = anchors.sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (scoreDifference !== 0) return scoreDifference;
    return sourcePriority(right.source) - sourcePriority(left.source);
  })[0];
  if (!selected) return null;
  return {
    field: selected.field,
    pageNumber: selected.pageNumber,
    source: selected.source,
    line: selected.line,
  };
}

async function recognizeContractAutomaticReviewRegion(
  filePath: string,
  temporaryDirectory: string,
  anchor: ContractAutomaticReviewAnchor,
  pageSize: { width: number; height: number },
  ocrModel?: PaddleOcrRequestModel,
): Promise<ContractTextSource | null> {
  const requestedDpi = Number(anchor.source.slice(4)) as 300 | 480 | 600;
  const renderDpi = calculateSafePdfRenderDpi(
    pageSize.width,
    pageSize.height,
    requestedDpi,
  );
  const imageWidth = Math.ceil((pageSize.width / 72) * renderDpi);
  const imageHeight = Math.ceil((pageSize.height / 72) * renderDpi);
  const crop = calculateContractAutomaticReviewCrop(
    anchor.field,
    anchor.line,
    imageWidth,
    imageHeight,
  );
  if (!crop) return null;
  const prefix = path.join(
    temporaryDirectory,
    `page-${anchor.pageNumber}-${requestedDpi}-${anchor.field}-auto-review-${Date.now()}`,
  );
  const imagePath = `${prefix}.png`;
  const viewPaths = [
    `${prefix}-normalized.png`,
    ...(anchor.field === "contract_date" ? [`${prefix}-threshold.png`] : []),
  ];
  try {
    await runWithContractPdfRenderPermit(() =>
      execFileAsync(
        "pdftoppm",
        [
          "-png",
          "-singlefile",
          "-r",
          String(renderDpi),
          "-x",
          String(crop.left),
          "-y",
          String(crop.top),
          "-W",
          String(crop.width),
          "-H",
          String(crop.height),
          "-f",
          String(anchor.pageNumber),
          "-l",
          String(anchor.pageNumber),
          filePath,
          prefix,
        ],
        { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 },
      ),
    );
    if (!fs.existsSync(imagePath)) return null;
    const enhancementSize = calculateContractDateFocusEnhancementSize(
      crop.width,
      crop.height,
    );
    await sharp(imagePath)
      .grayscale()
      .normalize()
      .resize({
        width: enhancementSize.width,
        height: enhancementSize.height,
        fit: "inside",
        kernel: "lanczos3",
      })
      .sharpen({ sigma: 1.1, m1: 1.2, m2: 0.7 })
      .png()
      .toFile(viewPaths[0]);
    if (viewPaths[1]) {
      await sharp(imagePath)
        .grayscale()
        .normalize()
        .resize({
          width: enhancementSize.width,
          height: enhancementSize.height,
          fit: "inside",
          kernel: "lanczos3",
        })
        .threshold(172)
        .png()
        .toFile(viewPaths[1]);
    }
    const pageLines: ContractPaddleOcrLine[] = [];
    const rawLines: ContractRawOcrLine[] = [];
    for (const viewPath of viewPaths) {
      const recognized = await callContractPaddleOcrDetailed(
        viewPath,
        ocrModel,
      );
      const translated = translateContractOcrLines(
        (recognized.lines || []).map((line) => ({
          ...line,
          modelVersion: line.modelVersion || recognized.modelVersion,
        })),
        {
          offsetX: crop.left,
          offsetY: crop.top,
          scaleX: crop.width / enhancementSize.width,
          scaleY: crop.height / enhancementSize.height,
        },
      );
      pageLines.push(...translated);
      rawLines.push(
        ...buildContractRawOcrLines(
          anchor.pageNumber,
          translated,
          recognized.modelVersion,
        ),
      );
    }
    if (pageLines.length === 0) return null;
    return {
      text: pageLines.map((line) => line.text).join("\n"),
      source: anchor.source,
      pageNumber: anchor.pageNumber,
      fieldScope: anchor.field,
      confidence: averageOcrConfidence(pageLines),
      lineConfidences: pageLines.map((line) => line.confidence),
      recognitionEngine: "paddleocr",
      ocrLines: rawLines,
      modelVersion: rawLines[0]?.modelVersion,
    };
  } finally {
    for (const temporaryPath of [imagePath, ...viewPaths]) {
      try {
        await fs.promises.unlink(temporaryPath);
      } catch {
        // 临时目录最终还会统一清理。
      }
    }
  }
}

async function recognizeContractAutomaticReviewRegionFromImage(
  bytes: Buffer,
  temporaryDirectory: string,
  anchor: ContractAutomaticReviewAnchor,
  imageWidth: number,
  imageHeight: number,
  ocrModel?: PaddleOcrRequestModel,
): Promise<ContractTextSource | null> {
  const crop = calculateContractAutomaticReviewCrop(
    anchor.field,
    anchor.line,
    imageWidth,
    imageHeight,
  );
  if (!crop) return null;
  const prefix = path.join(
    temporaryDirectory,
    `image-${anchor.field}-auto-review-${Date.now()}`,
  );
  const viewPaths = [
    `${prefix}-normalized.png`,
    ...(anchor.field === "contract_date" ? [`${prefix}-threshold.png`] : []),
  ];
  const enhancementSize = calculateContractDateFocusEnhancementSize(
    crop.width,
    crop.height,
  );
  try {
    await sharp(bytes, { limitInputPixels: MAX_SOURCE_IMAGE_PIXELS })
      .extract(crop)
      .grayscale()
      .normalize()
      .resize({
        width: enhancementSize.width,
        height: enhancementSize.height,
        fit: "inside",
        kernel: "lanczos3",
      })
      .sharpen({ sigma: 1.1, m1: 1.2, m2: 0.7 })
      .png()
      .toFile(viewPaths[0]);
    if (viewPaths[1]) {
      await sharp(bytes, { limitInputPixels: MAX_SOURCE_IMAGE_PIXELS })
        .extract(crop)
        .grayscale()
        .normalize()
        .resize({
          width: enhancementSize.width,
          height: enhancementSize.height,
          fit: "inside",
          kernel: "lanczos3",
        })
        .threshold(172)
        .png()
        .toFile(viewPaths[1]);
    }

    const pageLines: ContractPaddleOcrLine[] = [];
    const rawLines: ContractRawOcrLine[] = [];
    for (const viewPath of viewPaths) {
      const recognized = await callContractPaddleOcrDetailed(
        viewPath,
        ocrModel,
      );
      const translated = translateContractOcrLines(
        (recognized.lines || []).map((line) => ({
          ...line,
          modelVersion: line.modelVersion || recognized.modelVersion,
        })),
        {
          offsetX: crop.left,
          offsetY: crop.top,
          scaleX: crop.width / enhancementSize.width,
          scaleY: crop.height / enhancementSize.height,
        },
      );
      pageLines.push(...translated);
      rawLines.push(
        ...buildContractRawOcrLines(1, translated, recognized.modelVersion),
      );
    }
    if (pageLines.length === 0) return null;
    return {
      text: pageLines.map((line) => line.text).join("\n"),
      source: "ocr_300",
      pageNumber: 1,
      fieldScope: anchor.field,
      confidence: averageOcrConfidence(pageLines),
      lineConfidences: pageLines.map((line) => line.confidence),
      recognitionEngine: "paddleocr",
      ocrLines: rawLines,
      modelVersion: rawLines[0]?.modelVersion,
    };
  } finally {
    for (const viewPath of viewPaths) {
      try {
        await fs.promises.unlink(viewPath);
      } catch {
        // 临时目录最终还会统一清理。
      }
    }
  }
}

function weakFields(
  result: ContractRecognitionResult,
  threshold: number,
): ContractOcrField[] {
  return result.fields.filter(
    (field) => !field.normalizedValue || field.confidence < threshold,
  );
}

export type ContractOcrAutomaticReviewField =
  | "project_name"
  | "amount"
  | "contract_date";

/**
 * 候选冲突或日期证据偏弱时，不直接转入人工流程，而是触发同模型局部区域
 * 增强识别。该函数只判断复核风险，不改变 ocrConfidence（原始置信度）或
 * fieldScore（字段规则评分）。
 */
export function contractOcrFieldsRequiringAutomaticReview(
  result: Pick<ContractRecognitionResult, "fields">,
): ContractOcrAutomaticReviewField[] {
  const reviewFields: ContractOcrAutomaticReviewField[] = [];
  const project = result.fields.find((field) => field.field === "project_name");
  if (
    project &&
    ((project.warnings || []).some((warning) =>
      /项目名称存在候选冲突|项目名称.*(?:截断|不完整|损坏)/u.test(warning),
    ) ||
      (project.candidates || []).some((candidate) =>
        /(?:咨询|技术)(?:E|15|I5|1S)$/iu.test(candidate.normalizedValue),
      ))
  ) {
    reviewFields.push("project_name");
  }
  const amount = result.fields.find((field) => field.field === "amount");
  if (
    amount &&
    (amount.warnings || []).some((warning) =>
      /合同金额存在候选冲突|金额格式冲突|金额角色冲突|同一增减动作|金额计算结果|大写.*不一致/u.test(
        warning,
      ),
    )
  ) {
    reviewFields.push("amount");
  }
  const contractDate = result.fields.find(
    (field) => field.field === "contract_date",
  );
  if (
    contractDate &&
    (!contractDate.normalizedValue ||
      (contractDate.ocrConfidence != null &&
        contractDate.ocrConfidence < 0.85) ||
      contractDate.fieldScore < 85 ||
      (contractDate.warnings || []).some((warning) =>
        /合同签订日期存在候选冲突|日期.*(?:低置信|不完整)/u.test(warning),
      ))
  ) {
    reviewFields.push("contract_date");
  }
  return reviewFields;
}

function weakCoreFields(
  result: ContractRecognitionResult,
  threshold: number,
): ContractOcrField[] {
  return weakFields(result, threshold).filter((field) =>
    CORE_FIELD_NAMES.includes(field.field),
  );
}

export function selectContractOcrPriorityPages(
  pageCount: number,
  textSources: readonly ContractTextSource[],
  result: ContractRecognitionResult,
  maximum: number,
): number[] {
  const requiredPages = [1, pageCount].filter(
    (page, index, values) =>
      page >= 1 && page <= pageCount && values.indexOf(page) === index,
  );
  const pages = new Set<number>(requiredPages);
  for (const field of weakCoreFields(
    result,
    CONTRACT_OCR_AUTO_ACCEPTANCE_THRESHOLD,
  )) {
    if (field.pageNumber) pages.add(field.pageNumber);
  }
  for (const source of textSources) {
    if (
      source.pageNumber &&
      /甲\s*方|乙\s*方|信息咨询项目名称|工程项目名称|咨询项目名称|项目[（(]工程[）)]名称|项目名称|工程名称|合同金额|合同总价|合同价款|服务费用(?:总额|合计)|含税金额|总金额|协议金额|签订(?:日期|时间)|签定(?:日期|时间)|签署日期|盖章|签章/.test(
        source.text,
      )
    ) {
      pages.add(source.pageNumber);
    }
  }
  return [...pages]
    .filter((page) => page >= 1 && page <= pageCount)
    .slice(0, Math.max(maximum, requiredPages.length));
}

/**
 * 用印份数采用独立可见页复核。优先复识包含“一式／各执／同等法律效力”
 * 锚点的页面；文字来源完全没有锚点时复识正文末四页，覆盖常见“其他”条款。
 */
export function selectContractSealCopyCountReviewPages(
  pageCount: number,
  sources: readonly ContractTextSource[],
  maximum = 4,
): number[] {
  const anchoredPages = new Set<number>();
  for (const source of sources) {
    if (
      source.pageNumber &&
      /一\s*式|(?:甲方|乙方|双方)\s*(?:各\s*)?执|同等法律效力/u.test(
        source.text,
      )
    ) {
      anchoredPages.add(source.pageNumber);
    }
  }
  if (anchoredPages.size > 0) {
    return [...anchoredPages]
      .filter((page) => page >= 1 && page <= pageCount)
      .slice(0, maximum);
  }
  const firstFallbackPage = Math.max(1, pageCount - maximum + 1);
  return Array.from(
    { length: Math.max(0, pageCount - firstFallbackPage + 1) },
    (_, index) => firstFallbackPage + index,
  );
}

function parseFromSources(
  sources: readonly ContractTextSource[],
  options: Pick<
    ParseContractTextOptions,
    "expectedCategory" | "relationType" | "candidateFunnelDiagnostics"
  > = {},
): ContractRecognitionResult {
  const rawText = sourcesRawText(sources);
  return parseContractTextForFileRecognition(rawText, {
    sources,
    ...options,
  });
}

function diagnosticBusinessProjection(
  result: ContractRecognitionResult,
): string {
  return JSON.stringify({
    result,
    amountBreakdown: getContractAmountBreakdown(result),
    amountContext: getContractAmountAutomaticAdoptionContext(result),
    safetyContext: getContractOcrAutomaticAdoptionSafetyContext(result),
  });
}

/**
 * 候选漏斗只在离线文件诊断入口启用。这里复用同一批已提取文字来源执行
 * 两次纯解析，不会重复 OCR（光学字符识别）；业务投影不一致时失败关闭。
 */
function parseContractTextForFileRecognition(
  text: string,
  options: ParseContractTextOptions,
): ContractRecognitionResult {
  if (!options.candidateFunnelDiagnostics) {
    return parseContractText(text, options);
  }
  const baseline = parseContractText(text, {
    ...options,
    candidateFunnelDiagnostics: false,
  });
  const diagnostic = parseContractText(text, options);
  if (
    diagnosticBusinessProjection(baseline) !==
    diagnosticBusinessProjection(diagnostic)
  ) {
    throw new Error("候选漏斗诊断改变了合同解析业务投影");
  }
  contractOcrCandidateFunnelIsolationProofs.set(diagnostic, true);
  return diagnostic;
}

async function recognizePdfFile(
  filePath: string,
  options: ContractRecognitionOptions = {},
): Promise<ContractRecognitionResult> {
  const bytes = await fs.promises.readFile(filePath);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return buildFailedResult("文件不是有效的 PDF 文档");
  }
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch {
    return buildFailedResult("PDF 文档损坏、结构异常或已加密");
  }
  const pageCount = document.getPageCount();
  if (pageCount < 1 || pageCount > MAX_PDF_PAGES) {
    return buildFailedResult(`PDF 页数必须在 1 至 ${MAX_PDF_PAGES} 页之间`);
  }
  const pageSizes = document.getPages().map((page) => page.getSize());

  const warnings: string[] = [];
  let textSources: ContractTextSource[] = [];
  if (!options.diagnosticOcrOnly) {
    try {
      textSources = await extractPdfTextPages(filePath, pageCount);
    } catch {
      warnings.push("PDF 文字层提取失败，已尝试扫描识别");
    }
  }
  const sources = [...textSources];
  let parsed = parseFromSources(sources, options);
  const automaticReviewBudget = { remaining: 6 };
  const textIsInsufficient =
    options.diagnosticOcrOnly === true ||
    meaningfulLength(textSources.map((source) => source.text).join("")) <
      Math.max(100, pageCount * 20);
  // PDF（便携式文档格式）电子文字层永远不能单独形成自动验证 100。即使
  // 六项候选齐全，也必须继续渲染包含字段证据的可见页面并执行图像识别；
  // 后续只有文字层和可见图像候选精确一致才能通过独立证据门禁。

  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "contract-ocr-"),
  );
  let infrastructureFailure: string | null = null;
  const unrecognizedPageNumbers = new Set<number>();
  const completedRenderProfiles = new Set<string>();
  const recognizeAtNewResolution = async (
    pageNumber: number,
    dpi: 300 | 480 | 600,
  ): Promise<ContractTextSource | null> => {
    const pageSize = pageSizes[pageNumber - 1];
    const { renderDpi, key: profile } = calculateContractPdfOcrRenderProfile(
      pageNumber,
      pageSize.width,
      pageSize.height,
      dpi,
    );
    if (completedRenderProfiles.has(profile)) return null;
    const source = await recognizePdfPage(
      filePath,
      pageNumber,
      dpi,
      temporaryDirectory,
      renderDpi,
      pageSize.width,
      pageSize.height,
      options.ocrModel,
      automaticReviewBudget,
    );
    completedRenderProfiles.add(profile);
    return source;
  };
  const automaticReviewSources = new Map<
    ContractOcrAutomaticReviewField,
    Set<ContractAutomaticReviewAnchor["source"]>
  >();
  const automaticReviewRegionKeys = new Set<string>();
  const runAutomaticLocalReviews = async (): Promise<boolean> => {
    let addedSource = false;
    const labels: Record<ContractOcrAutomaticReviewField, string> = {
      project_name: "项目名称",
      amount: "合同金额",
      contract_date: "签订日期",
    };
    for (const field of contractOcrFieldsRequiringAutomaticReview(parsed)) {
      if (automaticReviewBudget.remaining <= 0) break;
      const reviewedSources =
        automaticReviewSources.get(field) ||
        new Set<ContractAutomaticReviewAnchor["source"]>(
          sources
            .filter(
              (source) =>
                source.source.startsWith("ocr_") &&
                source.enhancedFieldScopes?.includes(field),
            )
            .map(
              (source) =>
                source.source as ContractAutomaticReviewAnchor["source"],
            ),
        );
      if (reviewedSources.size >= 2) continue;
      const anchor = selectContractAutomaticReviewAnchor(
        field,
        parsed,
        sources,
        reviewedSources,
      );
      if (!anchor) continue;
      const regionKey = `${field}:${anchor.pageNumber}:${anchor.source}:${anchor.line.bbox
        .flat()
        .map((coordinate) => Math.round(Number(coordinate)))
        .join(",")}`;
      if (automaticReviewRegionKeys.has(regionKey)) continue;
      automaticReviewRegionKeys.add(regionKey);
      reviewedSources.add(anchor.source);
      automaticReviewSources.set(field, reviewedSources);
      automaticReviewBudget.remaining -= 1;
      try {
        const source = await recognizeContractAutomaticReviewRegion(
          filePath,
          temporaryDirectory,
          anchor,
          pageSizes[anchor.pageNumber - 1],
          options.ocrModel,
        );
        if (!source) continue;
        sources.push(source);
        addedSource = true;
        warnings.push(
          `${labels[field]}存在识别风险，已自动执行局部区域增强 OCR（光学字符识别）并重新排序候选`,
        );
      } catch (error) {
        if (isContractOcrInfrastructureError(error)) {
          infrastructureFailure = "OCR 识别基础设施暂时不可用，可稍后重试";
          break;
        }
        warnings.push(
          `${labels[field]}局部区域增强识别失败，已继续使用整页候选`,
        );
      }
    }
    return addedSource;
  };
  try {
    const initialPages = textIsInsufficient
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : selectContractOcrPriorityPages(pageCount, textSources, parsed, 8);
    for (const pageNumber of initialPages) {
      try {
        const outcome = await recognizeContractPdfPageWithAutomaticRecovery(
          (dpi) => recognizeAtNewResolution(pageNumber, dpi),
        );
        if (outcome.source) {
          sources.push(outcome.source);
          if (outcome.recovered) {
            warnings.push(
              `第 ${pageNumber} 页首次扫描识别异常，已在同一任务自动补扫成功`,
            );
          }
        } else {
          unrecognizedPageNumbers.add(pageNumber);
        }
      } catch (error) {
        if (isContractOcrInfrastructureError(error)) {
          infrastructureFailure = "OCR 识别基础设施暂时不可用，可稍后重试";
          break;
        }
        unrecognizedPageNumbers.add(pageNumber);
      }
    }
    parsed = parseFromSources(sources, options);
    if (!infrastructureFailure && (await runAutomaticLocalReviews())) {
      parsed = parseFromSources(sources, options);
    }

    if (!infrastructureFailure) {
      const copyCountReviewPages = selectContractSealCopyCountReviewPages(
        pageCount,
        sources,
        MAX_HIGH_RESOLUTION_PAGES,
      );
      for (const pageNumber of copyCountReviewPages) {
        try {
          const source = await recognizeAtNewResolution(pageNumber, 480);
          if (source) {
            sources.push(source);
            unrecognizedPageNumbers.delete(pageNumber);
          }
        } catch (error) {
          if (isContractOcrInfrastructureError(error)) {
            infrastructureFailure = "OCR 识别基础设施暂时不可用，可稍后重试";
            break;
          }
          warnings.push(`第 ${pageNumber} 页用印份数增强识别失败`);
        }
      }
      parsed = parseFromSources(sources, options);
    }

    if (
      !infrastructureFailure &&
      weakCoreFields(parsed, CONTRACT_OCR_AUTO_ACCEPTANCE_THRESHOLD).length > 0
    ) {
      const pages480 = selectContractOcrPriorityPages(
        pageCount,
        sources,
        parsed,
        MAX_HIGH_RESOLUTION_PAGES,
      );
      for (const pageNumber of pages480) {
        try {
          const source = await recognizeAtNewResolution(pageNumber, 480);
          if (source) {
            sources.push(source);
            unrecognizedPageNumbers.delete(pageNumber);
          }
        } catch (error) {
          if (isContractOcrInfrastructureError(error)) {
            infrastructureFailure = "OCR 识别基础设施暂时不可用，可稍后重试";
            break;
          }
          warnings.push(`第 ${pageNumber} 页高清识别失败`);
        }
      }
      parsed = parseFromSources(sources, options);
      if (!infrastructureFailure && (await runAutomaticLocalReviews())) {
        parsed = parseFromSources(sources, options);
      }
    }

    if (
      !infrastructureFailure &&
      weakCoreFields(parsed, CONTRACT_OCR_AUTO_ACCEPTANCE_THRESHOLD).length > 0
    ) {
      const pages600 = selectContractOcrPriorityPages(
        pageCount,
        sources,
        parsed,
        2,
      );
      for (const pageNumber of pages600) {
        try {
          const source = await recognizeAtNewResolution(pageNumber, 600);
          if (source) {
            sources.push(source);
            unrecognizedPageNumbers.delete(pageNumber);
          }
        } catch (error) {
          if (isContractOcrInfrastructureError(error)) {
            infrastructureFailure = "OCR 识别基础设施暂时不可用，可稍后重试";
            break;
          }
          warnings.push(`第 ${pageNumber} 页超清识别失败`);
        }
      }
      parsed = parseFromSources(sources, options);
      if (!infrastructureFailure && (await runAutomaticLocalReviews())) {
        parsed = parseFromSources(sources, options);
      }
    }
  } finally {
    try {
      await fs.promises.rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    } catch {
      // 清理失败不影响识别结果。
    }
  }

  for (const pageNumber of [...unrecognizedPageNumbers].sort((a, b) => a - b)) {
    warnings.push(`第 ${pageNumber} 页经同任务自动补扫后仍未识别`);
  }
  if (!extractContractSealCopyCount(sourcesRawText(sources))) {
    warnings.push("合同正文未形成唯一可信的“一式几份”用印总份数");
  }
  if (infrastructureFailure) warnings.push(infrastructureFailure);
  const hasOcr = sources.some((source) => source.source.startsWith("ocr_"));
  const hasText = textSources.some((source) => source.text.trim());
  const ocrLines = sources.flatMap((source) => source.ocrLines || []);
  const status = infrastructureFailure
    ? "failed"
    : unrecognizedPageNumbers.size > 0 && parsed.status === "succeeded"
      ? "partial"
      : parsed.status;
  const finalResult: ContractRecognitionResult = {
    ...parsed,
    status,
    failureKind: infrastructureFailure ? "infrastructure" : undefined,
    rawText: sourcesRawText(sources),
    method: hasOcr ? (hasText ? "pdf_text_and_ocr" : "pdf_ocr") : "pdf_text",
    warnings: [...new Set([...warnings, ...parsed.warnings])],
    ocrLines,
    modelVersion:
      ocrLines[0]?.modelVersion ||
      sources.find((source) => source.modelVersion)?.modelVersion,
    unrecognizedPageNumbers: [...unrecognizedPageNumbers].sort((a, b) => a - b),
  };
  return inheritContractAmountBreakdown(parsed, finalResult);
}

async function recognizeImageFile(
  filePath: string,
  extension: ".jpg" | ".jpeg" | ".png",
  options: ContractRecognitionOptions = {},
): Promise<ContractRecognitionResult> {
  const bytes = await fs.promises.readFile(filePath);
  const isPng =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  if ((extension === ".png" && !isPng) || (extension !== ".png" && !isJpeg)) {
    return buildFailedResult("文件不是有效的 JPG 或 PNG 图片");
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes, {
      limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
    }).metadata();
  } catch {
    return buildFailedResult("图片损坏、像素尺寸异常或超过安全限制");
  }
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (
    width < 1 ||
    height < 1 ||
    width * height > MAX_SOURCE_IMAGE_PIXELS ||
    (extension === ".png" && metadata.format !== "png") ||
    (extension !== ".png" && metadata.format !== "jpeg")
  ) {
    return buildFailedResult("图片真实格式或像素尺寸不受支持");
  }

  const requestedSize = calculateContractImageOcrSize(width, height);
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "contract-image-ocr-"),
  );
  try {
    const normalizedPath = path.join(temporaryDirectory, "normalized.png");
    await sharp(bytes, { limitInputPixels: MAX_SOURCE_IMAGE_PIXELS })
      .resize({
        width: requestedSize.width,
        height: requestedSize.height,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toFile(normalizedPath);
    const normalizedMetadata = await sharp(normalizedPath, {
      limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
    }).metadata();
    const normalizedWidth = normalizedMetadata.width || 0;
    const normalizedHeight = normalizedMetadata.height || 0;
    const tiles = calculateContractPdfOcrTiles(
      normalizedWidth,
      normalizedHeight,
    );
    const scaleX = width / normalizedWidth;
    const scaleY = height / normalizedHeight;
    let combinedLines: ContractPaddleOcrLine[] = [];
    const fallbackTexts: string[] = [];
    const rawOcrLines: ContractRawOcrLine[] = [];
    let modelVersion: PaddleOcrModelVersion | undefined;

    for (const [tileIndex, tile] of tiles.entries()) {
      const tilePath = path.join(temporaryDirectory, `tile-${tileIndex}.png`);
      await sharp(normalizedPath, {
        limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
      })
        .extract({
          left: tile.x,
          top: tile.y,
          width: tile.width,
          height: tile.height,
        })
        .png()
        .toFile(tilePath);
      try {
        const result = await callContractPaddleOcrDetailed(
          tilePath,
          options.ocrModel,
        );
        modelVersion ||= result.modelVersion;
        const lines = result.lines || [];
        const pageLines = translateContractOcrLines(lines, {
          offsetX: tile.x * scaleX,
          offsetY: tile.y * scaleY,
          scaleX,
          scaleY,
        });
        const previousLineCount = combinedLines.length;
        combinedLines = mergeContractOcrTileLines(combinedLines, pageLines);
        rawOcrLines.push(
          ...buildContractRawOcrLines(
            1,
            combinedLines.slice(previousLineCount),
            result.modelVersion,
          ),
          ...buildContractQrCodeLines(
            1,
            result.qrCodes || [],
            result.modelVersion,
          ),
        );
        if (lines.length === 0 && result.fullText.trim()) {
          fallbackTexts.push(result.fullText);
        }
      } finally {
        try {
          await fs.promises.unlink(tilePath);
        } catch {
          // 临时目录最终还会统一清理。
        }
      }
    }

    const source: ContractTextSource = {
      text:
        combinedLines.length > 0
          ? combinedLines.map((line) => line.text).join("\n")
          : fallbackTexts.join("\n"),
      source: "ocr_300",
      pageNumber: 1,
      confidence: averageOcrConfidence(combinedLines),
      lineConfidences: combinedLines.map((line) => line.confidence),
      recognitionEngine: "paddleocr",
      ocrLines: [...rawOcrLines],
      modelVersion,
    };
    const sources: ContractTextSource[] = [source];
    let parsed = parseFromSources(sources, options);
    const automaticReviewWarnings: string[] = [];
    for (const field of contractOcrFieldsRequiringAutomaticReview(parsed)) {
      const anchor = selectContractAutomaticReviewAnchor(
        field,
        parsed,
        sources,
      );
      if (!anchor) continue;
      const reviewedSource =
        await recognizeContractAutomaticReviewRegionFromImage(
          bytes,
          temporaryDirectory,
          anchor,
          width,
          height,
          options.ocrModel,
        );
      if (!reviewedSource) continue;
      sources.push(reviewedSource);
      rawOcrLines.push(...(reviewedSource.ocrLines || []));
      modelVersion ||= reviewedSource.ocrLines?.[0]?.modelVersion;
      const fieldLabel =
        field === "project_name"
          ? options.expectedCategory === "asset"
            ? "合同名称"
            : "项目名称"
          : field === "amount"
            ? "合同金额"
            : "签订日期";
      automaticReviewWarnings.push(
        `${fieldLabel}存在识别风险，已自动执行图片局部区域增强 OCR（光学字符识别）并重新排序候选`,
      );
    }
    if (sources.length > 1) parsed = parseFromSources(sources, options);
    const finalResult: ContractRecognitionResult = {
      ...parsed,
      rawText: sourcesRawText(sources),
      method: "image_ocr",
      warnings: [...new Set([...automaticReviewWarnings, ...parsed.warnings])],
      ocrLines: rawOcrLines,
      modelVersion,
    };
    return inheritContractAmountBreakdown(parsed, finalResult);
  } finally {
    try {
      await fs.promises.rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    } catch {
      // 清理失败不影响识别结果。
    }
  }
}

/**
 * 识别真实 DOC、DOCX、PDF 或盖章合同图片。不会在日志中输出文件正文或完整识别结果。
 */
export async function recognizeContractFile(
  filePath: string,
  mimeType: string,
  options: ContractRecognitionOptions = {},
): Promise<ContractRecognitionResult> {
  try {
    const extension = path.extname(filePath).toLowerCase();
    if (
      ![".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"].includes(extension)
    ) {
      return buildFailedResult(
        "仅支持真实的 DOC、DOCX、PDF、JPG 或 PNG 合同文件",
      );
    }
    if (
      !isMimeAllowed(
        extension as ".pdf" | ".doc" | ".docx" | ".jpg" | ".jpeg" | ".png",
        mimeType,
      )
    ) {
      return buildFailedResult("文件扩展名与媒体类型不一致");
    }
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE_BYTES) {
      return buildFailedResult("合同文件为空或超过 50MB 限制");
    }
    if (extension === ".docx") {
      const text = await extractSafeDocxText(filePath);
      const result = parseContractTextForFileRecognition(text, {
        defaultSource: "docx_text",
        defaultConfidence: 99,
        expectedCategory: options.expectedCategory,
        relationType: options.relationType,
        candidateFunnelDiagnostics: options.candidateFunnelDiagnostics,
      });
      return inheritContractAmountBreakdown(result, {
        ...result,
        method: "docx_text",
      });
    }
    if (extension === ".doc") {
      const text = await extractSafeLegacyDocText(filePath);
      const result = parseContractTextForFileRecognition(text, {
        defaultSource: "docx_text",
        defaultConfidence: 99,
        expectedCategory: options.expectedCategory,
        relationType: options.relationType,
        candidateFunnelDiagnostics: options.candidateFunnelDiagnostics,
      });
      return inheritContractAmountBreakdown(result, {
        ...result,
        method: "docx_text",
      });
    }
    if (extension === ".pdf") return await recognizePdfFile(filePath, options);
    return await recognizeImageFile(
      filePath,
      extension as ".jpg" | ".jpeg" | ".png",
      options,
    );
  } catch (error) {
    if (isContractOcrInfrastructureError(error)) {
      return buildFailedResult(
        "OCR 识别基础设施暂时不可用，可稍后重试",
        "infrastructure",
      );
    }
    const message = error instanceof Error ? error.message : "合同识别失败";
    return buildFailedResult(message, "recognition");
  }
}
