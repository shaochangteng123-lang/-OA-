import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { contractOcrFamilyKeys } from "../../services/contractOcrFamilyIsolation.js";
import type { ContractOcrInventoryRow } from "../../services/contractOcrHoldout.js";

export const CONTRACT_OCR_EXTERNAL_INTAKE_POLICY_VERSION =
  "external-blind-intake-v1";
export const CONTRACT_OCR_EXTERNAL_REGISTRY_HEADER = [
  "相对路径",
  "SHA256",
  "外部合同族编号",
  "法律文书编号",
  "文档角色",
  "签署状态",
  "父文书编号",
  "版本组编号",
  "版本顺序",
  "是否最终测试代表",
  "来源批次",
  "登记责任人",
].join("\t");

export const FROZEN_EXTERNAL_INTAKE_VERSIONS = Object.freeze({
  ocrModel: "v6_medium",
  rulesVersion: "contract-rules-sha256-2209a00b3e57e913",
  automaticPolicyVersion: "highest-qualified-candidate-v3",
});

const FROZEN_BASELINE_ID =
  "contract-ocr-stage10-baseline-5215e2d9f754368e997b";
const FROZEN_BASELINE_SHA256 =
  "1571d753b31834507be6f667b030720d0ddebc7f210f8da9e4d3c57137f9abec";
const FROZEN_IMPLEMENTATION_DIGEST =
  "a96905c1ffe114f0820e4b14da91a38feabcf456b0808f3e7f2e940a02962e7e";
const FROZEN_EVALUATION_DIGEST =
  "67ab6573f2e10a86c6141ca9c9a42ed4adb3f2f81ac79ac6c7ab7dd0ebefc29c";

const SUPPORTED_EXTENSIONS = new Set(["pdf", "doc", "docx"]);
const CONTRACT_ROLES = new Set<ContractExternalDocumentRole>([
  "main",
  "supplement",
  "change",
  "reduction",
  "termination",
]);
const DOCUMENT_ROLES = new Set<ContractExternalDocumentRole>([
  ...CONTRACT_ROLES,
  "attachment",
  "invoice",
  "payment_material",
  "template",
  "non_contract",
  "unknown",
]);
const EXECUTION_STATES = new Set<ContractExternalExecutionState>([
  "final_signed",
  "final_electronic",
  "draft",
  "unsigned",
  "template",
  "unknown",
]);
const FINAL_EXECUTION_STATES = new Set<ContractExternalExecutionState>([
  "final_signed",
  "final_electronic",
]);
const HISTORY_SOURCE_TYPES = new Set<ContractExternalHistorySourceType>([
  "inventory_tsv",
  "family_registry_tsv",
  "audit_jsonl",
  "json",
  "hash_list",
]);
const SHA_HEADER_KEYS = new Set([
  "sha256",
  "actualsha256",
  "sourcesha256",
  "filesha256",
  "档案代表sha256",
  "文件sha256",
]);
const HISTORY_FAMILY_HEADER_KEYS = new Set([
  "外部合同族编号",
  "合同族编号",
  "familyid",
  "externalfamilyid",
]);
const HISTORY_INSTRUMENT_HEADER_KEYS = new Set([
  "法律文书编号",
  "文书编号",
  "instrumentid",
  "contractnumber",
]);
const DEFAULT_MAX_FILES = 50_000;
const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;
const FINAL_PDF_MAX_BYTES = 30 * 1024 * 1024;
const FINAL_PDF_MAX_PAGES = 40;
const MAX_DOCX_ENTRIES = 5_000;
const MAX_DOCX_ASSIST_BYTES = 15 * 1024 * 1024;
const MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 8 * 1024 * 1024;

export type ContractExternalNativeTextMode = "off" | "assist";
export type ContractExternalDocumentRole =
  | "main"
  | "supplement"
  | "change"
  | "reduction"
  | "termination"
  | "attachment"
  | "invoice"
  | "payment_material"
  | "template"
  | "non_contract"
  | "unknown";
export type ContractExternalExecutionState =
  | "final_signed"
  | "final_electronic"
  | "draft"
  | "unsigned"
  | "template"
  | "unknown";
export type ContractExternalHistorySourceType =
  | "inventory_tsv"
  | "family_registry_tsv"
  | "audit_jsonl"
  | "json"
  | "hash_list";

export interface ContractOcrExternalIntakeOptions {
  inputRoot: string;
  outputRoot: string;
  sourceId: string;
  historyConfigPath: string;
  baselinePath: string;
  familyRegistryPath?: string;
  minimumFinalFamilies?: number;
  nativeTextMode?: ContractExternalNativeTextMode;
  workspaceRoot?: string;
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface ContractOcrExternalIntakeSummary {
  schemaVersion: 1;
  policyVersion: string;
  sourceId: string;
  frozenBaseline: {
    baselineId: string;
    ocrModel: string;
    rulesVersion: string;
    automaticPolicyVersion: string;
  };
  counts: {
    scannedFiles: number;
    supportedFiles: number;
    uniqueDocuments: number;
    exactDuplicateFiles: number;
    ignoredTemporaryFiles: number;
    rejectedSymbolicLinks: number;
    unsupportedFiles: number;
    invalidStructureFiles: number;
    nonContractFiles: number;
    registryMissingFiles: number;
    candidateFamiliesBeforeExposure: number;
    exposureExcludedFamilies: number;
    directlyExposedDocuments: number;
    unresolvedFamilies: number;
    finalBlindCandidateFamilies: number;
  };
  exclusions: Record<string, number>;
  target: {
    minimumFinalFamilies: number;
    met: boolean;
    shortfall: number;
  };
  privacy: {
    publicSummaryIncludesPaths: false;
    publicSummaryIncludesDigests: false;
    publicSummaryIncludesContractText: false;
    privateDirectoryMode: "0700";
    privateFileMode: "0600";
  };
  sideEffects: {
    ocrInvocations: 0;
    databaseWrites: 0;
    apiCalls: 0;
    sourceFileMutations: 0;
  };
}

export interface ContractOcrExternalIntakeResult {
  summary: ContractOcrExternalIntakeSummary;
  outputs: {
    fileInventoryPath: string;
    qualificationPath: string;
    draftFamilyRegistryPath: string;
    familySummaryPath: string;
    historyMatchesPath: string;
    unresolvedPath: string;
    eligibleRepresentativesPath: string;
    lineagePath: string;
    summaryPath: string;
  };
}

interface HistoryConfigSource {
  id: string;
  type: ContractExternalHistorySourceType;
  path: string;
}

interface HistoryConfig {
  schemaVersion: 1;
  familyIdentityNamespace: string;
  familyIdentityCoverage: "complete";
  sources: HistoryConfigSource[];
}

interface HistoryEvidence {
  digests: Set<string>;
  familyIds: Set<string>;
  instrumentIds: Set<string>;
  sourceIdsByDigest: Map<string, Set<string>>;
  sourceIdsByFamily: Map<string, Set<string>>;
  sourceIdsByInstrument: Map<string, Set<string>>;
  sourceFileDigests: Array<{ id: string; sha256: string }>;
  configSha256: string;
  familyIdentityNamespace: string;
}

interface FrozenBaselineEvidence {
  baselineId: string;
  baselineSha256: string;
  implementationDigest: string;
  evaluationDigest: string;
}

interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
  size: number;
  sha256: string | null;
  duplicateOf: string | null;
  structureStatus:
    | "valid"
    | "valid_limited"
    | "invalid"
    | "unsupported"
    | "too_large";
  structureReason: string | null;
  pageCount: number | null;
  nativeTextAvailable: boolean | null;
  automaticRole: ContractExternalDocumentRole;
  automaticExecutionState: ContractExternalExecutionState;
  classificationBasis: string[];
  suggestedFamilyId: string | null;
  registry: RegistryEntry | null;
  historyDigestMatch: boolean;
  wholeFamilyExposed: boolean;
  qualificationStatus: "candidate" | "excluded" | "pending";
  reasonCodes: string[];
}

interface RegistryEntry {
  relativePath: string;
  sha256: string;
  externalFamilyId: string;
  instrumentId: string;
  documentRole: ContractExternalDocumentRole;
  executionState: ContractExternalExecutionState;
  parentInstrumentId: string;
  versionGroupId: string;
  versionOrder: number;
  finalRepresentative: boolean;
  sourceBatch: string;
  reviewer: string;
}

interface FamilyResult {
  externalFamilyId: string;
  files: ScannedFile[];
  candidate: boolean;
  exposed: boolean;
  representative: ScannedFile | null;
  status: "candidate" | "excluded" | "pending";
  reasonCodes: string[];
}

interface ScanCounters {
  scannedFiles: number;
  ignoredTemporaryFiles: number;
  rejectedSymbolicLinks: number;
}

function digestBuffer(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function digestFile(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedHeader(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_—–·,，。:：;；/\\（）()【】\x5b\x5d{}-]+/gu, "");
}

function normalizeRelativePath(value: string): string {
  const normalized = value.normalize("NFC").replace(/\\/gu, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\u0000") ||
    normalized.includes("\t") ||
    normalized.includes("\n") ||
    normalized.includes("\r") ||
    normalized.split("/").some((segment) => segment === ".." || !segment)
  ) {
    throw new Error("外部盲测相对路径无效");
  }
  return normalized;
}

function assertRegularFile(filePath: string, label: string): string {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label}必须是普通文件且不能是符号链接`);
  }
  return resolved;
}

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInputAndOutputRoots(
  inputRootValue: string,
  outputRootValue: string,
): { inputRoot: string; outputRoot: string; outputParent: string } {
  const inputResolved = path.resolve(inputRootValue);
  const inputStat = fs.lstatSync(inputResolved);
  if (inputStat.isSymbolicLink() || !inputStat.isDirectory()) {
    throw new Error("外部合同输入根目录必须是真实普通目录");
  }
  const inputRoot = fs.realpathSync(inputResolved);

  const outputRoot = path.resolve(outputRootValue);
  if (fs.existsSync(outputRoot)) {
    throw new Error("外部盲测导入输出目录已存在，拒绝覆盖");
  }
  const outputParentValue = path.dirname(outputRoot);
  const outputParentStat = fs.lstatSync(outputParentValue);
  if (outputParentStat.isSymbolicLink() || !outputParentStat.isDirectory()) {
    throw new Error("外部盲测导入输出父目录必须是真实普通目录");
  }
  const outputParent = fs.realpathSync(outputParentValue);
  const canonicalOutputRoot = path.join(outputParent, path.basename(outputRoot));
  if (isPathInside(canonicalOutputRoot, inputRoot)) {
    throw new Error("外部盲测导入输出目录不能位于输入目录内");
  }
  return { inputRoot, outputRoot: canonicalOutputRoot, outputParent };
}

function isIgnoredTemporaryFile(fileName: string): boolean {
  return (
    fileName === ".DS_Store" ||
    fileName.startsWith("~$") ||
    /^\._/u.test(fileName) ||
    /(?:\.tmp|\.temp|\.part|\.swp|\.lock)$/iu.test(fileName)
  );
}

function collectSourceFiles(
  inputRoot: string,
  maxFiles: number,
): { paths: string[]; counters: ScanCounters } {
  const paths: string[] = [];
  const counters: ScanCounters = {
    scannedFiles: 0,
    ignoredTemporaryFiles: 0,
    rejectedSymbolicLinks: 0,
  };
  const directories = [inputRoot];
  while (directories.length > 0) {
    const currentValue = directories.pop()!;
    const current = fs.realpathSync(currentValue);
    const currentStat = fs.lstatSync(current);
    if (!isPathInside(current, inputRoot) || !currentStat.isDirectory()) {
      throw new Error("外部合同目录在扫描期间发生越界或类型变化");
    }
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        counters.rejectedSymbolicLinks += 1;
        continue;
      }
      const realEntryPath = fs.realpathSync(entryPath);
      if (!isPathInside(realEntryPath, inputRoot)) {
        throw new Error("外部合同目录项真实路径越过输入根目录");
      }
      if (stat.isDirectory()) {
        directories.push(realEntryPath);
        continue;
      }
      if (!stat.isFile()) continue;
      if (isIgnoredTemporaryFile(entry.name)) {
        counters.ignoredTemporaryFiles += 1;
        continue;
      }
      const relativePath = normalizeRelativePath(
        path.relative(inputRoot, realEntryPath).replace(/\\/gu, "/"),
      );
      paths.push(relativePath);
      counters.scannedFiles += 1;
      if (paths.length > maxFiles) {
        throw new Error(`外部合同目录文件数超过上限 ${maxFiles}`);
      }
    }
  }
  paths.sort(compareText);
  return { paths, counters };
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<w:tab\b[^>]*\/>/giu, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

function classifyDocument(
  relativePath: string,
  nativeText: string,
): {
  role: ContractExternalDocumentRole;
  executionState: ContractExternalExecutionState;
  basis: string[];
} {
  const fileName = path.posix.basename(relativePath).normalize("NFKC");
  const name = fileName.toLowerCase();
  const title = nativeText.slice(0, 1_200).normalize("NFKC").toLowerCase();
  const basis: string[] = [];
  const matches = (pattern: RegExp): boolean => pattern.test(name);
  const titleMatches = (pattern: RegExp): boolean => Boolean(title) && pattern.test(title);

  let role: ContractExternalDocumentRole = "unknown";
  if (matches(/发票|数电票|电子票|invoice|红字|冲红/u)) {
    role = "invoice";
    basis.push("filename_invoice");
  } else if (matches(/付款|请款|回单|收款|支付|转账|payment|receipt/u)) {
    role = "payment_material";
    basis.push("filename_payment_material");
  } else if (matches(/模板|范本|样本|草稿|空白|template|draft/u)) {
    role = "template";
    basis.push("filename_template");
  } else if (
    matches(
      /附件|申请表|确认单|介绍信|授权|委托书|许可证|证书|报告|验收单|结算单|清单/u,
    )
  ) {
    role = "attachment";
    basis.push("filename_attachment");
  } else if (matches(/补充协议|追加协议|补遗协议/u)) {
    role = "supplement";
    basis.push("filename_supplement");
  } else if (matches(/变更协议|调整协议/u)) {
    role = "change";
    basis.push("filename_change");
  } else if (matches(/核减协议|扣减协议|调减协议/u)) {
    role = "reduction";
    basis.push("filename_reduction");
  } else if (matches(/终止协议|解除协议/u)) {
    role = "termination";
    basis.push("filename_termination");
  } else if (matches(/合同|协议|contract|agreement/u)) {
    role = "main";
    basis.push("filename_contract");
  } else if (titleMatches(/^(?:.{0,30})?(?:补充|追加|补遗)协议/u)) {
    role = "supplement";
    basis.push("native_title_supplement");
  } else if (titleMatches(/^(?:.{0,30})?(?:变更|调整)协议/u)) {
    role = "change";
    basis.push("native_title_change");
  } else if (titleMatches(/^(?:.{0,30})?(?:合同|协议)/u)) {
    role = "main";
    basis.push("native_title_contract");
  }

  let executionState: ContractExternalExecutionState = "unknown";
  if (matches(/模板|范本|样本|template/u)) {
    executionState = "template";
  } else if (matches(/草稿|draft/u)) {
    executionState = "draft";
  } else if (matches(/未签|未盖章|空白/u)) {
    executionState = "unsigned";
  } else if (matches(/电子签|电子签署/u)) {
    executionState = "final_electronic";
  } else if (matches(/已签|签章|盖章|正本|最终版|终版/u)) {
    executionState = "final_signed";
  }
  return { role, executionState, basis };
}

function normalizeFamilyCore(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\.(?:pdf|docx?|jpe?g|png)$/giu, "")
    .replace(/(?:19|20)\d{2}(?:[-_.年]?\d{1,2}){0,2}/gu, "")
    .replace(/[￥¥]\s*[\d,.]+(?:元)?/gu, "")
    .replace(/补充|追加|补遗|变更|调整|核减|扣减|调减|终止|解除/gu, "")
    .replace(/合同书?|协议书?|正本|扫描件|电子版|盖章版|签章版|最终版|终版|草稿|未签/gu, "")
    .replace(
      /supplement(?:al)?|amendment|variation|reduction|termination|agreement|contract|signed|final|scan(?:ned)?|draft/giu,
      "",
    )
    .replace(/[\s_—–·,，。:：;；/\\（）()【】\x5b\x5d{}-]+/gu, "")
    .trim();
}

function suggestedFamilyId(relativePath: string): string | null {
  const fileCore = normalizeFamilyCore(path.posix.basename(relativePath));
  const genericCore = /^(?:main|master|document|file|scan|合同|协议|主合同|原件|正本|扫描件|归档|项目合同|非主营项目合同|资产类合同|租房合同|\d{4}(?:年|年度)?|第?\d+批)$/iu;
  const directoryCore = path.posix
    .dirname(relativePath)
    .split("/")
    .reverse()
    .map(normalizeFamilyCore)
    .find((value) => value.length >= 3 && !genericCore.test(value));
  const basis =
    fileCore.length >= 3 && !genericCore.test(fileCore)
      ? fileCore
      : directoryCore || "";
  if (basis.length < 3) return null;
  return `SUG-${digestBuffer(basis).slice(0, 16).toUpperCase()}`;
}

async function validatePdf(
  filePath: string,
  size: number,
  nativeTextMode: ContractExternalNativeTextMode,
): Promise<{
  status: ScannedFile["structureStatus"];
  reason: string | null;
  pageCount: number | null;
  nativeTextAvailable: boolean | null;
  nativeText: string;
}> {
  if (size > FINAL_PDF_MAX_BYTES) {
    return {
      status: "too_large",
      reason: "pdf_exceeds_30mb",
      pageCount: null,
      nativeTextAvailable: nativeTextMode === "assist" ? false : null,
      nativeText: "",
    };
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return {
      status: "invalid",
      reason: "pdf_magic_mismatch",
      pageCount: null,
      nativeTextAvailable: nativeTextMode === "assist" ? false : null,
      nativeText: "",
    };
  }
  try {
    const document = await PDFDocument.load(buffer, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    const pageCount = document.getPageCount();
    if (pageCount <= 0 || pageCount > FINAL_PDF_MAX_PAGES) {
      return {
        status: "invalid",
        reason: pageCount <= 0 ? "pdf_zero_pages" : "pdf_exceeds_40_pages",
        pageCount,
        nativeTextAvailable: nativeTextMode === "assist" ? false : null,
        nativeText: "",
      };
    }
    for (const page of document.getPages()) {
      const { width, height } = page.getSize();
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0 ||
        width > 20_000 ||
        height > 20_000
      ) {
        return {
          status: "invalid",
          reason: "pdf_page_size_invalid",
          pageCount,
          nativeTextAvailable: nativeTextMode === "assist" ? false : null,
          nativeText: "",
        };
      }
    }
    const catalog = document.catalog;
    if (
      catalog.has(PDFName.of("OpenAction")) ||
      catalog.has(PDFName.of("AA"))
    ) {
      return {
        status: "invalid",
        reason: "pdf_active_action",
        pageCount,
        nativeTextAvailable: nativeTextMode === "assist" ? false : null,
        nativeText: "",
      };
    }
    const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    if (
      names &&
      (names.has(PDFName.of("JavaScript")) ||
        names.has(PDFName.of("EmbeddedFiles")))
    ) {
      return {
        status: "invalid",
        reason: "pdf_embedded_active_content",
        pageCount,
        nativeTextAvailable: nativeTextMode === "assist" ? false : null,
        nativeText: "",
      };
    }

    if (nativeTextMode === "off") {
      return {
        status: "valid",
        reason: null,
        pageCount,
        nativeTextAvailable: null,
        nativeText: "",
      };
    }
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText({ first: Math.min(2, pageCount) });
      const nativeText = result.text.replace(/\s+/gu, " ").trim();
      return {
        status: "valid",
        reason: null,
        pageCount,
        nativeTextAvailable: nativeText.length > 0,
        nativeText,
      };
    } finally {
      await parser.destroy();
    }
  } catch {
    return {
      status: "invalid",
      reason: "pdf_parse_failed_or_encrypted",
      pageCount: null,
      nativeTextAvailable: nativeTextMode === "assist" ? false : null,
      nativeText: "",
    };
  }
}

async function validateDocx(
  filePath: string,
  nativeTextMode: ContractExternalNativeTextMode,
): Promise<{
  status: ScannedFile["structureStatus"];
  reason: string | null;
  nativeTextAvailable: boolean | null;
  nativeText: string;
}> {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 4 || buffer.subarray(0, 2).toString("ascii") !== "PK") {
    return {
      status: "invalid",
      reason: "docx_magic_mismatch",
      nativeTextAvailable: nativeTextMode === "assist" ? false : null,
      nativeText: "",
    };
  }
  if (nativeTextMode === "off") {
    return {
      status: "valid_limited",
      reason: "docx_not_final_pdf",
      nativeTextAvailable: null,
      nativeText: "",
    };
  }
  if (buffer.length > MAX_DOCX_ASSIST_BYTES) {
    return {
      status: "invalid",
      reason: "docx_assist_size_limit",
      nativeTextAvailable: false,
      nativeText: "",
    };
  }
  try {
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
    const entries = Object.values(zip.files);
    if (entries.length > MAX_DOCX_ENTRIES) {
      return {
        status: "invalid",
        reason: "docx_too_many_entries",
        nativeTextAvailable: nativeTextMode === "assist" ? false : null,
        nativeText: "",
      };
    }
    let totalUncompressedBytes = 0;
    for (const entry of entries) {
      if (entry.dir) continue;
      const data = (
        entry as unknown as { _data?: { uncompressedSize?: unknown } }
      )._data;
      if (
        !data ||
        typeof data.uncompressedSize !== "number" ||
        !Number.isSafeInteger(data.uncompressedSize) ||
        data.uncompressedSize < 0
      ) {
        return {
          status: "invalid",
          reason: "docx_entry_size_unknown",
          nativeTextAvailable: false,
          nativeText: "",
        };
      }
      totalUncompressedBytes += data.uncompressedSize;
      if (totalUncompressedBytes > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES) {
        return {
          status: "invalid",
          reason: "docx_uncompressed_size_limit",
          nativeTextAvailable: false,
          nativeText: "",
        };
      }
      if (
        (entry.name === "word/document.xml" ||
          entry.name === "word/_rels/document.xml.rels" ||
          entry.name === "[Content_Types].xml") &&
        data.uncompressedSize > MAX_DOCX_XML_BYTES
      ) {
        return {
          status: "invalid",
          reason: "docx_xml_size_limit",
          nativeTextAvailable: false,
          nativeText: "",
        };
      }
    }
    if (
      entries.some(
        (entry) =>
          entry.name.startsWith("/") ||
          entry.name.split("/").some((segment) => segment === ".."),
      )
    ) {
      return {
        status: "invalid",
        reason: "docx_path_traversal",
        nativeTextAvailable: nativeTextMode === "assist" ? false : null,
        nativeText: "",
      };
    }
    const documentEntry = zip.file("word/document.xml");
    const contentTypesEntry = zip.file("[Content_Types].xml");
    if (!documentEntry || !contentTypesEntry) {
      return {
        status: "invalid",
        reason: "docx_required_part_missing",
        nativeTextAvailable: nativeTextMode === "assist" ? false : null,
        nativeText: "",
      };
    }
    const contentTypes = await contentTypesEntry.async("string");
    const relationships = await zip
      .file("word/_rels/document.xml.rels")
      ?.async("string");
    if (
      /macroEnabled|vbaProject|activeX/iu.test(contentTypes) ||
      /TargetMode\s*=\s*["']External["']/iu.test(relationships || "")
    ) {
      return {
        status: "invalid",
        reason: "docx_active_or_external_content",
        nativeTextAvailable: nativeTextMode === "assist" ? false : null,
        nativeText: "",
      };
    }
    const documentXml = await documentEntry.async("string");
    const nativeText = decodeXmlText(documentXml).slice(0, 20_000);
    return {
      status: "valid_limited",
      reason: "docx_not_final_pdf",
      nativeTextAvailable: nativeText.length > 0,
      nativeText,
    };
  } catch {
    return {
      status: "invalid",
      reason: "docx_parse_failed",
      nativeTextAvailable: nativeTextMode === "assist" ? false : null,
      nativeText: "",
    };
  }
}

function validateDoc(filePath: string): {
  status: ScannedFile["structureStatus"];
  reason: string | null;
} {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const magic = Buffer.alloc(8);
    fs.readSync(descriptor, magic, 0, 8, 0);
    const expected = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (!magic.equals(expected)) {
      return { status: "invalid", reason: "doc_magic_mismatch" };
    }
    return { status: "valid_limited", reason: "doc_not_final_pdf" };
  } finally {
    fs.closeSync(descriptor);
  }
}

function extractJsonDigests(
  value: unknown,
  digests: Set<string>,
  familyIds: Set<string>,
  instrumentIds: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      extractJsonDigests(item, digests, familyIds, instrumentIds);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizedHeader(key);
    if (
      SHA_HEADER_KEYS.has(normalizedKey) &&
      typeof item === "string" &&
      /^[a-f0-9]{64}$/iu.test(item)
    ) {
      digests.add(item.toLowerCase());
    }
    if (
      HISTORY_FAMILY_HEADER_KEYS.has(normalizedKey) &&
      typeof item === "string" &&
      item.trim()
    ) {
      familyIds.add(item.trim());
    }
    if (
      HISTORY_INSTRUMENT_HEADER_KEYS.has(normalizedKey) &&
      typeof item === "string" &&
      item.trim()
    ) {
      instrumentIds.add(item.normalize("NFKC").trim());
    }
    extractJsonDigests(item, digests, familyIds, instrumentIds);
  }
}

function parseTsvHistory(
  content: string,
  includeFamilies: boolean,
): { digests: Set<string>; familyIds: Set<string>; instrumentIds: Set<string> } {
  const lines = content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter(Boolean);
  if (lines.length < 2) throw new Error("历史 TSV（制表符分隔值）文件为空");
  const headers = lines[0].split("\t");
  const shaIndex = headers.findIndex((header) =>
    SHA_HEADER_KEYS.has(normalizedHeader(header)),
  );
  const familyIndex = headers.findIndex((header) =>
    HISTORY_FAMILY_HEADER_KEYS.has(normalizedHeader(header)),
  );
  const instrumentIndex = headers.findIndex((header) =>
    HISTORY_INSTRUMENT_HEADER_KEYS.has(normalizedHeader(header)),
  );
  if (shaIndex < 0) throw new Error("历史 TSV（制表符分隔值）缺少 SHA256 列");
  const digests = new Set<string>();
  const familyIds = new Set<string>();
  const instrumentIds = new Set<string>();
  for (let index = 1; index < lines.length; index += 1) {
    const columns = lines[index].split("\t");
    const sha256 = columns[shaIndex]?.trim().toLowerCase();
    if (!sha256 || !/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error(`历史 TSV（制表符分隔值）第 ${index + 1} 行摘要无效`);
    }
    digests.add(sha256);
    if (includeFamilies && familyIndex >= 0 && columns[familyIndex]?.trim()) {
      familyIds.add(columns[familyIndex].trim());
    }
    if (includeFamilies && instrumentIndex >= 0 && columns[instrumentIndex]?.trim()) {
      instrumentIds.add(columns[instrumentIndex].normalize("NFKC").trim());
    }
  }
  return { digests, familyIds, instrumentIds };
}

function parseHistoryConfig(configPathValue: string): {
  config: HistoryConfig;
  configPath: string;
  content: string;
} {
  const configPath = assertRegularFile(configPathValue, "历史曝光配置");
  const content = fs.readFileSync(configPath, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("历史曝光配置不是合法 JSON（数据交换格式）");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("历史曝光配置必须是对象");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    record.familyIdentityCoverage !== "complete" ||
    typeof record.familyIdentityNamespace !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(
      record.familyIdentityNamespace,
    ) ||
    !Array.isArray(record.sources)
  ) {
    throw new Error("历史曝光配置结构版本无效");
  }
  const ids = new Set<string>();
  const sources = record.sources.map((sourceValue, index) => {
    if (!sourceValue || typeof sourceValue !== "object" || Array.isArray(sourceValue)) {
      throw new Error(`历史曝光配置第 ${index + 1} 个来源无效`);
    }
    const source = sourceValue as Record<string, unknown>;
    const sourceId = source.sourceId ?? source.id;
    const rawType = source.kind ?? source.type ?? source.format;
    const sourceType =
      rawType === "jsonl"
        ? "audit_jsonl"
        : rawType === "tsv"
          ? "inventory_tsv"
          : rawType;
    if (
      typeof sourceId !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{1,63}$/iu.test(sourceId) ||
      ids.has(sourceId)
    ) {
      throw new Error(`历史曝光配置第 ${index + 1} 个来源编号无效或重复`);
    }
    if (
      typeof sourceType !== "string" ||
      !HISTORY_SOURCE_TYPES.has(sourceType as ContractExternalHistorySourceType) ||
      typeof source.path !== "string" ||
      !source.path.trim()
    ) {
      throw new Error(`历史曝光配置第 ${index + 1} 个来源类型或路径无效`);
    }
    ids.add(sourceId);
    return {
      id: sourceId,
      type: sourceType as ContractExternalHistorySourceType,
      path: source.path,
    };
  });
  if (sources.length === 0) throw new Error("历史曝光配置至少需要一个来源");
  return {
    config: {
      schemaVersion: 1,
      familyIdentityNamespace: record.familyIdentityNamespace,
      familyIdentityCoverage: "complete",
      sources,
    },
    configPath,
    content,
  };
}

async function loadHistoryEvidence(configPathValue: string): Promise<HistoryEvidence> {
  const { config, configPath, content } = parseHistoryConfig(configPathValue);
  const digests = new Set<string>();
  const familyIds = new Set<string>();
  const instrumentIds = new Set<string>();
  const sourceIdsByDigest = new Map<string, Set<string>>();
  const sourceIdsByFamily = new Map<string, Set<string>>();
  const sourceIdsByInstrument = new Map<string, Set<string>>();
  const sourceFileDigests: Array<{ id: string; sha256: string }> = [];

  for (const source of config.sources) {
    const sourcePathValue = path.isAbsolute(source.path)
      ? source.path
      : path.resolve(path.dirname(configPath), source.path);
    const sourcePath = assertRegularFile(sourcePathValue, "历史曝光来源");
    const sourceContent = fs.readFileSync(sourcePath, "utf8");
    const sourceDigests = new Set<string>();
    const sourceFamilies = new Set<string>();
    const sourceInstruments = new Set<string>();
    if (source.type === "inventory_tsv" || source.type === "family_registry_tsv") {
      const parsed = parseTsvHistory(
        sourceContent,
        source.type === "family_registry_tsv",
      );
      for (const digest of parsed.digests) sourceDigests.add(digest);
      for (const familyId of parsed.familyIds) sourceFamilies.add(familyId);
      for (const instrumentId of parsed.instrumentIds) {
        sourceInstruments.add(instrumentId);
      }
    } else if (source.type === "audit_jsonl") {
      const lines = sourceContent
        .replace(/^\uFEFF/u, "")
        .split(/\r?\n/u)
        .filter(Boolean);
      for (let index = 0; index < lines.length; index += 1) {
        let item: unknown;
        try {
          item = JSON.parse(lines[index]);
        } catch {
          throw new Error(`历史 JSONL（逐行数据交换格式）第 ${index + 1} 行无效`);
        }
        extractJsonDigests(
          item,
          sourceDigests,
          sourceFamilies,
          sourceInstruments,
        );
      }
    } else if (source.type === "json") {
      let item: unknown;
      try {
        item = JSON.parse(sourceContent);
      } catch {
        throw new Error("历史 JSON（数据交换格式）来源无效");
      }
      extractJsonDigests(
        item,
        sourceDigests,
        sourceFamilies,
        sourceInstruments,
      );
    } else {
      const lines = sourceContent
        .replace(/^\uFEFF/u, "")
        .split(/\r?\n/u)
        .filter(Boolean);
      for (let index = 0; index < lines.length; index += 1) {
        const sha256 = lines[index].trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/u.test(sha256)) {
          throw new Error(`历史摘要列表第 ${index + 1} 行无效`);
        }
        sourceDigests.add(sha256);
      }
    }
    if (
      sourceDigests.size === 0 &&
      sourceFamilies.size === 0 &&
      sourceInstruments.size === 0
    ) {
      throw new Error(`历史曝光来源 ${source.id} 未包含有效证据`);
    }
    for (const sha256 of sourceDigests) {
      digests.add(sha256);
      const sourceIds = sourceIdsByDigest.get(sha256) || new Set<string>();
      sourceIds.add(source.id);
      sourceIdsByDigest.set(sha256, sourceIds);
    }
    for (const familyId of sourceFamilies) {
      familyIds.add(familyId);
      const sourceIds = sourceIdsByFamily.get(familyId) || new Set<string>();
      sourceIds.add(source.id);
      sourceIdsByFamily.set(familyId, sourceIds);
    }
    for (const instrumentId of sourceInstruments) {
      instrumentIds.add(instrumentId);
      const sourceIds =
        sourceIdsByInstrument.get(instrumentId) || new Set<string>();
      sourceIds.add(source.id);
      sourceIdsByInstrument.set(instrumentId, sourceIds);
    }
    sourceFileDigests.push({ id: source.id, sha256: digestBuffer(sourceContent) });
  }
  sourceFileDigests.sort((left, right) => compareText(left.id, right.id));
  if (familyIds.size === 0 && instrumentIds.size === 0) {
    throw new Error("完整历史族身份配置未提供合同族编号或法律文书编号");
  }
  return {
    digests,
    familyIds,
    instrumentIds,
    sourceIdsByDigest,
    sourceIdsByFamily,
    sourceIdsByInstrument,
    sourceFileDigests,
    configSha256: digestBuffer(content),
    familyIdentityNamespace: config.familyIdentityNamespace,
  };
}

async function assertFrozenBaseline(
  baselinePathValue: string,
  workspaceRootValue: string,
): Promise<FrozenBaselineEvidence> {
  const baselinePath = assertRegularFile(baselinePathValue, "冻结版本基线");
  const workspaceRootResolved = path.resolve(workspaceRootValue);
  const workspaceRootStat = fs.lstatSync(workspaceRootResolved);
  if (workspaceRootStat.isSymbolicLink() || !workspaceRootStat.isDirectory()) {
    throw new Error("工作区根目录无效");
  }
  const workspaceRoot = fs.realpathSync(workspaceRootResolved);
  const baselineContent = fs.readFileSync(baselinePath, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(baselineContent);
  } catch {
    throw new Error("冻结版本基线不是合法 JSON（数据交换格式）");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("冻结版本基线结构无效");
  }
  const record = value as Record<string, unknown>;
  const versions = record.versions as Record<string, unknown> | undefined;
  if (
    record.schemaVersion !== 1 ||
    record.immutable !== true ||
    !versions ||
    versions.ocrModel !== FROZEN_EXTERNAL_INTAKE_VERSIONS.ocrModel ||
    versions.rulesVersion !== FROZEN_EXTERNAL_INTAKE_VERSIONS.rulesVersion ||
    versions.automaticPolicyVersion !==
      FROZEN_EXTERNAL_INTAKE_VERSIONS.automaticPolicyVersion
  ) {
    throw new Error("冻结模型、规则或自动策略与外部盲测导入口径不一致");
  }
  const implementation = record.implementation as
    | { files?: Array<{ relativePath?: unknown; sha256?: unknown }> }
    | undefined;
  if (!implementation?.files || implementation.files.length === 0) {
    throw new Error("冻结版本基线缺少实现文件摘要");
  }
  for (const item of implementation.files) {
    if (
      typeof item.relativePath !== "string" ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.sha256)
    ) {
      throw new Error("冻结版本基线实现文件记录无效");
    }
    const controlledPath = path.resolve(workspaceRoot, item.relativePath);
    if (!isPathInside(controlledPath, workspaceRoot)) {
      throw new Error("冻结版本基线实现文件越界");
    }
    const actual = await digestFile(assertRegularFile(controlledPath, "冻结实现文件"));
    if (actual !== item.sha256) {
      throw new Error("冻结版本基线实现文件摘要已变化");
    }
  }
  if (
    typeof record.baselineId !== "string" ||
    typeof versions.implementationDigest !== "string" ||
    typeof versions.evaluationDigest !== "string"
  ) {
    throw new Error("冻结版本基线标识或聚合摘要无效");
  }
  return {
    baselineId: record.baselineId,
    baselineSha256: digestBuffer(baselineContent),
    implementationDigest: versions.implementationDigest,
    evaluationDigest: versions.evaluationDigest,
  };
}

function parseBoolean(value: string, lineNumber: number): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "是" || normalized === "yes" || normalized === "true") {
    return true;
  }
  if (normalized === "否" || normalized === "no" || normalized === "false") {
    return false;
  }
  throw new Error(`权威合同族注册表第 ${lineNumber} 行代表标志无效`);
}

function parseFamilyRegistry(
  registryPathValue: string | undefined,
  scannedByPath: Map<string, ScannedFile>,
): { byPath: Map<string, RegistryEntry>; contentSha256: string | null } {
  if (!registryPathValue) return { byPath: new Map(), contentSha256: null };
  const registryPath = assertRegularFile(registryPathValue, "权威合同族注册表");
  const content = fs.readFileSync(registryPath, "utf8");
  const lines = content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter(Boolean);
  if (lines.length === 0 || lines[0] !== CONTRACT_OCR_EXTERNAL_REGISTRY_HEADER) {
    throw new Error("权威合同族注册表表头不符合12列规范");
  }
  const byPath = new Map<string, RegistryEntry>();
  const familyByDigest = new Map<string, string>();
  for (let index = 1; index < lines.length; index += 1) {
    const columns = lines[index].split("\t");
    if (columns.length !== 12) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行不是12列`);
    }
    const relativePath = normalizeRelativePath(columns[0]);
    const scanned = scannedByPath.get(relativePath);
    if (!scanned || !scanned.sha256) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行文件不在有效扫描库存中`);
    }
    const sha256 = columns[1].toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(sha256) || sha256 !== scanned.sha256) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行摘要与原文件不一致`);
    }
    if (byPath.has(relativePath)) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行路径重复`);
    }
    const documentRole = columns[4] as ContractExternalDocumentRole;
    const executionState = columns[5] as ContractExternalExecutionState;
    if (!DOCUMENT_ROLES.has(documentRole) || !EXECUTION_STATES.has(executionState)) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行角色或签署状态无效`);
    }
    const externalFamilyId = columns[2].trim();
    if (
      externalFamilyId &&
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/u.test(externalFamilyId)
    ) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行合同族编号无效`);
    }
    if (CONTRACT_ROLES.has(documentRole) && !externalFamilyId) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行合同文档缺少合同族编号`);
    }
    const versionOrder = Number(columns[8]);
    if (!Number.isSafeInteger(versionOrder) || versionOrder < 0) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行版本顺序无效`);
    }
    if (!columns[10].trim() || !columns[11].trim()) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行来源批次或登记责任人为空`);
    }
    const previousFamily = familyByDigest.get(sha256);
    if (previousFamily && externalFamilyId && previousFamily !== externalFamilyId) {
      throw new Error("同一文件摘要不能登记到不同合同族");
    }
    if (externalFamilyId) familyByDigest.set(sha256, externalFamilyId);
    const entry: RegistryEntry = {
      relativePath,
      sha256,
      externalFamilyId,
      instrumentId: columns[3].trim(),
      documentRole,
      executionState,
      parentInstrumentId: columns[6].trim(),
      versionGroupId: columns[7].trim(),
      versionOrder,
      finalRepresentative: parseBoolean(columns[9], index + 1),
      sourceBatch: columns[10].trim(),
      reviewer: columns[11].trim(),
    };
    if (
      CONTRACT_ROLES.has(entry.documentRole) &&
      (!entry.instrumentId || !entry.versionGroupId)
    ) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行合同文书或版本组编号为空`);
    }
    if (
      entry.documentRole !== "main" &&
      CONTRACT_ROLES.has(entry.documentRole) &&
      !entry.parentInstrumentId
    ) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行后续协议缺少父文书编号`);
    }
    if (
      entry.finalRepresentative &&
      (!CONTRACT_ROLES.has(entry.documentRole) ||
        !FINAL_EXECUTION_STATES.has(entry.executionState))
    ) {
      throw new Error(`权威合同族注册表第 ${index + 1} 行代表文件资格无效`);
    }
    byPath.set(relativePath, entry);
  }
  return { byPath, contentSha256: digestBuffer(content) };
}

async function scanFiles(
  inputRoot: string,
  relativePaths: string[],
  nativeTextMode: ContractExternalNativeTextMode,
  maxFileBytes: number,
): Promise<ScannedFile[]> {
  const scanned: ScannedFile[] = [];
  const canonicalPathByDigest = new Map<string, string>();
  for (const relativePath of relativePaths) {
    const joinedPath = path.join(inputRoot, ...relativePath.split("/"));
    const absolutePath = fs.realpathSync(joinedPath);
    if (!isPathInside(absolutePath, inputRoot)) {
      throw new Error("外部合同文件真实路径越过输入根目录");
    }
    const before = fs.lstatSync(absolutePath);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new Error("外部合同文件在扫描期间发生类型变化");
    }
    const extension = path.extname(relativePath).slice(1).toLowerCase();
    const supported = SUPPORTED_EXTENSIONS.has(extension);
    let sha256: string | null = null;
    let structureStatus: ScannedFile["structureStatus"] = supported
      ? "invalid"
      : "unsupported";
    let structureReason: string | null = supported ? "not_validated" : "unsupported_format";
    let pageCount: number | null = null;
    let nativeTextAvailable: boolean | null =
      nativeTextMode === "assist" ? false : null;
    let nativeText = "";
    if (supported && before.size <= maxFileBytes) {
      sha256 = await digestFile(absolutePath);
      if (extension === "pdf") {
        const validation = await validatePdf(
          absolutePath,
          before.size,
          nativeTextMode,
        );
        structureStatus = validation.status;
        structureReason = validation.reason;
        pageCount = validation.pageCount;
        nativeTextAvailable = validation.nativeTextAvailable;
        nativeText = validation.nativeText;
      } else if (extension === "docx") {
        const validation = await validateDocx(absolutePath, nativeTextMode);
        structureStatus = validation.status;
        structureReason = validation.reason;
        nativeTextAvailable = validation.nativeTextAvailable;
        nativeText = validation.nativeText;
      } else {
        const validation = validateDoc(absolutePath);
        structureStatus = validation.status;
        structureReason = validation.reason;
      }
    } else if (supported) {
      structureStatus = "too_large";
      structureReason = "file_exceeds_scan_size_limit";
    }
    const afterDigest = sha256 ? await digestFile(absolutePath) : null;
    const after = fs.lstatSync(absolutePath);
    if (
      (sha256 && afterDigest !== sha256) ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ino !== before.ino
    ) {
      throw new Error("外部合同文件在摘要或结构检查期间发生变化");
    }
    const classification = classifyDocument(relativePath, nativeText);
    const duplicateOf = sha256 ? canonicalPathByDigest.get(sha256) || null : null;
    if (sha256 && !duplicateOf) canonicalPathByDigest.set(sha256, relativePath);
    scanned.push({
      absolutePath,
      relativePath,
      extension,
      size: before.size,
      sha256,
      duplicateOf,
      structureStatus,
      structureReason,
      pageCount,
      nativeTextAvailable,
      automaticRole: classification.role,
      automaticExecutionState: classification.executionState,
      classificationBasis: classification.basis,
      suggestedFamilyId: CONTRACT_ROLES.has(classification.role)
        ? suggestedFamilyId(relativePath)
        : null,
      registry: null,
      historyDigestMatch: false,
      wholeFamilyExposed: false,
      qualificationStatus: "pending",
      reasonCodes: [],
    });
  }
  return scanned;
}

function resolveFamilies(
  scanned: ScannedFile[],
  history: HistoryEvidence,
): { families: FamilyResult[]; unresolvedSuggestionFamilies: number } {
  const filesByFamily = new Map<string, ScannedFile[]>();
  const unregisteredSuggestions = new Set<string>();
  for (const file of scanned) {
    if (file.registry?.externalFamilyId) {
      const members = filesByFamily.get(file.registry.externalFamilyId) || [];
      members.push(file);
      filesByFamily.set(file.registry.externalFamilyId, members);
    } else if (
      !file.registry &&
      CONTRACT_ROLES.has(file.automaticRole) &&
      file.suggestedFamilyId
    ) {
      unregisteredSuggestions.add(file.suggestedFamilyId);
    }
  }
  const families: FamilyResult[] = [];
  for (const [externalFamilyId, filesValue] of [...filesByFamily.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const files = [...filesValue].sort((left, right) =>
      compareText(left.relativePath, right.relativePath),
    );
    const reasons = new Set<string>();
    const contractFiles = files.filter(
      (file) => file.registry && CONTRACT_ROLES.has(file.registry.documentRole),
    );
    if (contractFiles.length === 0) reasons.add("no_contract_document");
    const mainInstrumentIds = new Set(
      contractFiles.flatMap((file) =>
        file.registry?.documentRole === "main" && file.registry.instrumentId
          ? [file.registry.instrumentId]
          : [],
      ),
    );
    if (mainInstrumentIds.size === 0) reasons.add("missing_main_contract");
    if (mainInstrumentIds.size > 1) reasons.add("multiple_main_instruments");
    const roleByInstrumentId = new Map<string, ContractExternalDocumentRole>();
    const instrumentByVersionGroup = new Map<string, string>();
    for (const file of contractFiles) {
      const entry = file.registry!;
      const previousRole = roleByInstrumentId.get(entry.instrumentId);
      if (previousRole && previousRole !== entry.documentRole) {
        reasons.add("instrument_role_conflict");
      }
      roleByInstrumentId.set(entry.instrumentId, entry.documentRole);
      const previousInstrument = instrumentByVersionGroup.get(entry.versionGroupId);
      if (previousInstrument && previousInstrument !== entry.instrumentId) {
        reasons.add("version_group_instrument_conflict");
      }
      instrumentByVersionGroup.set(entry.versionGroupId, entry.instrumentId);
    }
    for (const file of contractFiles) {
      const entry = file.registry!;
      if (entry.documentRole === "main") continue;
      if (roleByInstrumentId.get(entry.parentInstrumentId) !== "main") {
        reasons.add("unresolved_parent_instrument");
      }
    }
    const explicitRepresentatives = contractFiles.filter(
      (file) => file.registry?.finalRepresentative,
    );
    let representative: ScannedFile | null = null;
    if (explicitRepresentatives.length > 1) {
      reasons.add("multiple_final_representatives");
    } else if (explicitRepresentatives.length === 1) {
      representative = explicitRepresentatives[0];
    } else {
      const eligible = contractFiles
        .filter(
          (file) =>
            file.registry &&
            FINAL_EXECUTION_STATES.has(file.registry.executionState) &&
            file.extension === "pdf" &&
            file.structureStatus === "valid",
        )
        .sort((left, right) => {
          const versionDifference =
            (right.registry?.versionOrder || 0) -
            (left.registry?.versionOrder || 0);
          return versionDifference || compareText(left.relativePath, right.relativePath);
        });
      if (eligible.length > 1) {
        const firstOrder = eligible[0].registry!.versionOrder;
        const sameHighest = eligible.filter(
          (file) => file.registry!.versionOrder === firstOrder,
        );
        if (sameHighest.length > 1) reasons.add("ambiguous_final_representative");
        else representative = eligible[0];
      } else if (eligible.length === 1) {
        representative = eligible[0];
      }
    }
    if (!representative) reasons.add("no_unique_final_pdf");
    if (
      representative &&
      (representative.extension !== "pdf" ||
        representative.structureStatus !== "valid" ||
        !representative.registry ||
        !FINAL_EXECUTION_STATES.has(representative.registry.executionState))
    ) {
      reasons.add("representative_not_eligible_pdf");
      representative = null;
    }
    for (const file of files) {
      if (
        file.registry &&
        (file.automaticRole === "invoice" ||
          file.automaticRole === "payment_material" ||
          file.automaticRole === "template" ||
          file.automaticRole === "non_contract") &&
        CONTRACT_ROLES.has(file.registry.documentRole)
      ) {
        reasons.add("registry_conflicts_with_non_contract_evidence");
      }
    }
    const exposed =
      history.familyIds.has(externalFamilyId) ||
      files.some((file) => file.sha256 && history.digests.has(file.sha256));
    const candidate = reasons.size === 0 && representative !== null;
    const status: FamilyResult["status"] = !candidate
      ? "pending"
      : exposed
        ? "excluded"
        : "candidate";
    if (exposed) reasons.add("historical_family_exposure");
    for (const file of files) {
      file.wholeFamilyExposed = exposed;
      if (file.registry && CONTRACT_ROLES.has(file.registry.documentRole)) {
        file.qualificationStatus = status;
      }
      for (const reason of reasons) file.reasonCodes.push(reason);
    }
    families.push({
      externalFamilyId,
      files,
      candidate,
      exposed,
      representative,
      status,
      reasonCodes: [...reasons].sort(compareText),
    });
  }
  return { families, unresolvedSuggestionFamilies: unregisteredSuggestions.size };
}

function tsvValue(value: string | number | boolean | null): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  const text = String(value);
  if (/\t|\r|\n/u.test(text)) throw new Error("私有清单字段包含非法换行或制表符");
  return text;
}

function writeAtomicDirectory(
  outputRoot: string,
  outputParent: string,
  files: Map<string, string>,
): void {
  const temporaryRoot = path.join(
    outputParent,
    `.${path.basename(outputRoot)}.${process.pid}.${digestBuffer(outputRoot).slice(0, 8)}.tmp`,
  );
  if (fs.existsSync(temporaryRoot)) {
    throw new Error("外部盲测导入临时输出目录已存在");
  }
  fs.mkdirSync(temporaryRoot, { mode: 0o700 });
  fs.chmodSync(temporaryRoot, 0o700);
  try {
    for (const [name, content] of files) {
      const filePath = path.join(temporaryRoot, name);
      fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.chmodSync(filePath, 0o600);
    }
    fs.renameSync(temporaryRoot, outputRoot);
    fs.chmodSync(outputRoot, 0o700);
  } catch (error) {
    if (fs.existsSync(temporaryRoot)) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

function countReasons(families: FamilyResult[], scanned: ScannedFile[]): Record<string, number> {
  const counts = new Map<string, number>();
  const add = (reason: string): void => {
    counts.set(reason, (counts.get(reason) || 0) + 1);
  };
  for (const family of families) {
    for (const reason of new Set(family.reasonCodes)) add(reason);
  }
  for (const file of scanned) {
    if (file.structureStatus === "invalid" || file.structureStatus === "too_large") {
      add(file.structureReason || "invalid_structure");
    } else if (file.structureStatus === "unsupported") {
      add("unsupported_format");
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => compareText(left, right)));
}

export async function prepareContractOcrExternalIntake(
  options: ContractOcrExternalIntakeOptions,
): Promise<ContractOcrExternalIntakeResult> {
  const sourceId = options.sourceId.trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,95}$/iu.test(sourceId)) {
    throw new Error("外部盲测来源编号格式无效");
  }
  const minimumFinalFamilies = options.minimumFinalFamilies ?? 150;
  if (!Number.isSafeInteger(minimumFinalFamilies) || minimumFinalFamilies <= 0) {
    throw new Error("外部盲测最小合同族数量必须是正整数");
  }
  const nativeTextMode = options.nativeTextMode ?? "off";
  if (nativeTextMode !== "off" && nativeTextMode !== "assist") {
    throw new Error("原生文字辅助模式无效");
  }
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (!Number.isSafeInteger(maxFiles) || maxFiles <= 0) {
    throw new Error("外部合同扫描文件数上限无效");
  }
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new Error("外部合同单文件字节上限无效");
  }
  const roots = assertInputAndOutputRoots(options.inputRoot, options.outputRoot);
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const baselineBefore = await assertFrozenBaseline(options.baselinePath, workspaceRoot);
  const history = await loadHistoryEvidence(options.historyConfigPath);
  const sourceCollection = collectSourceFiles(roots.inputRoot, maxFiles);
  const scanned = await scanFiles(
    roots.inputRoot,
    sourceCollection.paths,
    nativeTextMode,
    maxFileBytes,
  );
  const scannedByPath = new Map(scanned.map((file) => [file.relativePath, file]));
  const registry = parseFamilyRegistry(options.familyRegistryPath, scannedByPath);
  for (const [relativePath, entry] of registry.byPath) {
    scannedByPath.get(relativePath)!.registry = entry;
  }
  const registeredEntryByDigest = new Map<string, RegistryEntry>();
  for (const entry of registry.byPath.values()) {
    if (!registeredEntryByDigest.has(entry.sha256)) {
      registeredEntryByDigest.set(entry.sha256, entry);
    }
  }
  for (const file of scanned) {
    const registeredDuplicate = file.sha256
      ? registeredEntryByDigest.get(file.sha256)
      : undefined;
    if (!file.registry && registeredDuplicate) {
      file.registry = {
        ...registeredDuplicate,
        relativePath: file.relativePath,
        finalRepresentative: false,
      };
      file.reasonCodes.push("registry_inherited_from_exact_duplicate");
    }
  }
  for (const file of scanned) {
    if (file.sha256 && history.digests.has(file.sha256)) {
      file.historyDigestMatch = true;
      file.reasonCodes.push("historical_exact_digest");
    }
    if (file.structureStatus === "unsupported") {
      file.qualificationStatus = "excluded";
      file.reasonCodes.push("unsupported_format");
    } else if (file.structureStatus === "invalid" || file.structureStatus === "too_large") {
      file.qualificationStatus = "excluded";
      file.reasonCodes.push(file.structureReason || "invalid_structure");
    } else if (file.registry && !CONTRACT_ROLES.has(file.registry.documentRole)) {
      file.qualificationStatus = "excluded";
      file.reasonCodes.push(`registered_${file.registry.documentRole}`);
    } else if (!file.registry) {
      file.qualificationStatus = "pending";
      file.reasonCodes.push("family_registry_missing");
      if (
        file.automaticRole === "attachment" ||
        file.automaticRole === "invoice" ||
        file.automaticRole === "payment_material" ||
        file.automaticRole === "template" ||
        file.automaticRole === "non_contract"
      ) {
        file.qualificationStatus = "excluded";
        file.reasonCodes.push(`not_contract_${file.automaticRole}`);
      } else if (file.automaticRole === "unknown") {
        file.reasonCodes.push("qualification_unknown");
      }
    }
  }
  const resolved = resolveFamilies(scanned, history);
  const families = resolved.families;
  const candidateFamiliesBeforeExposure = families.filter(
    (family) => family.candidate,
  ).length;
  const exposureExcludedFamilies = families.filter(
    (family) => family.candidate && family.exposed,
  ).length;
  const finalBlindCandidateFamilies = families.filter(
    (family) => family.candidate && !family.exposed,
  ).length;
  const unresolvedRegisteredFamilies = families.filter(
    (family) => !family.candidate,
  ).length;
  const unresolvedFamilies =
    unresolvedRegisteredFamilies + resolved.unresolvedSuggestionFamilies;

  const supportedFiles = scanned.filter((file) => SUPPORTED_EXTENSIONS.has(file.extension));
  const uniqueDocuments = new Set(
    supportedFiles.flatMap((file) => (file.sha256 ? [file.sha256] : [])),
  ).size;
  const nonContractFiles = scanned.filter(
    (file) =>
      file.qualificationStatus === "excluded" &&
      file.structureStatus !== "unsupported" &&
      file.structureStatus !== "invalid" &&
      file.structureStatus !== "too_large",
  ).length;
  const registryMissingFiles = scanned.filter(
    (file) => file.reasonCodes.includes("family_registry_missing"),
  ).length;
  const invalidStructureFiles = scanned.filter(
    (file) => file.structureStatus === "invalid" || file.structureStatus === "too_large",
  ).length;
  const directlyExposedDocuments = new Set(
    scanned.flatMap((file) =>
      file.historyDigestMatch && file.sha256 ? [file.sha256] : [],
    ),
  ).size;
  const targetMet = finalBlindCandidateFamilies >= minimumFinalFamilies;
  const summary: ContractOcrExternalIntakeSummary = {
    schemaVersion: 1,
    policyVersion: CONTRACT_OCR_EXTERNAL_INTAKE_POLICY_VERSION,
    sourceId,
    frozenBaseline: {
      baselineId: baselineBefore.baselineId,
      ocrModel: FROZEN_EXTERNAL_INTAKE_VERSIONS.ocrModel,
      rulesVersion: FROZEN_EXTERNAL_INTAKE_VERSIONS.rulesVersion,
      automaticPolicyVersion:
        FROZEN_EXTERNAL_INTAKE_VERSIONS.automaticPolicyVersion,
    },
    counts: {
      scannedFiles: sourceCollection.counters.scannedFiles,
      supportedFiles: supportedFiles.length,
      uniqueDocuments,
      exactDuplicateFiles: supportedFiles.filter((file) => file.duplicateOf).length,
      ignoredTemporaryFiles: sourceCollection.counters.ignoredTemporaryFiles,
      rejectedSymbolicLinks: sourceCollection.counters.rejectedSymbolicLinks,
      unsupportedFiles: scanned.filter((file) => file.structureStatus === "unsupported").length,
      invalidStructureFiles,
      nonContractFiles,
      registryMissingFiles,
      candidateFamiliesBeforeExposure,
      exposureExcludedFamilies,
      directlyExposedDocuments,
      unresolvedFamilies,
      finalBlindCandidateFamilies,
    },
    exclusions: countReasons(families, scanned),
    target: {
      minimumFinalFamilies,
      met: targetMet,
      shortfall: Math.max(0, minimumFinalFamilies - finalBlindCandidateFamilies),
    },
    privacy: {
      publicSummaryIncludesPaths: false,
      publicSummaryIncludesDigests: false,
      publicSummaryIncludesContractText: false,
      privateDirectoryMode: "0700",
      privateFileMode: "0600",
    },
    sideEffects: {
      ocrInvocations: 0,
      databaseWrites: 0,
      apiCalls: 0,
      sourceFileMutations: 0,
    },
  };

  const inventoryHeader = [
    "相对路径",
    "扩展名",
    "字节数",
    "SHA256",
    "精确重复主文件",
    "结构状态",
    "结构原因",
    "页数",
    "原生文字可用",
    "自动文档角色",
    "自动签署状态建议",
    "建议合同族编号",
  ].join("\t");
  const inventoryContent = `${inventoryHeader}\n${scanned
    .map((file) =>
      [
        file.relativePath,
        file.extension,
        file.size,
        file.sha256,
        file.duplicateOf,
        file.structureStatus,
        file.structureReason,
        file.pageCount,
        file.nativeTextAvailable,
        file.automaticRole,
        file.automaticExecutionState,
        file.suggestedFamilyId,
      ]
        .map(tsvValue)
        .join("\t"),
    )
    .join("\n")}\n`;

  const qualificationHeader = [
    "相对路径",
    "SHA256",
    "注册合同族编号",
    "注册文档角色",
    "注册签署状态",
    "历史摘要命中",
    "整族曝光",
    "资格状态",
    "原因代码",
  ].join("\t");
  const qualificationContent = `${qualificationHeader}\n${scanned
    .map((file) =>
      [
        file.relativePath,
        file.sha256,
        file.registry?.externalFamilyId || "",
        file.registry?.documentRole || "",
        file.registry?.executionState || "",
        file.historyDigestMatch,
        file.wholeFamilyExposed,
        file.qualificationStatus,
        [...new Set(file.reasonCodes)].sort(compareText).join(","),
      ]
        .map(tsvValue)
        .join("\t"),
    )
    .join("\n")}\n`;

  const draftRegistryContent = `${CONTRACT_OCR_EXTERNAL_REGISTRY_HEADER}\n${scanned
    .filter((file) => file.sha256)
    .map((file) => {
      const entry = file.registry;
      return [
        file.relativePath,
        file.sha256,
        entry?.externalFamilyId || file.suggestedFamilyId || "",
        entry?.instrumentId || "",
        entry?.documentRole || file.automaticRole,
        entry?.executionState || file.automaticExecutionState,
        entry?.parentInstrumentId || "",
        entry?.versionGroupId || "",
        entry?.versionOrder ?? 0,
        entry?.finalRepresentative ?? false,
        entry?.sourceBatch || sourceId,
        entry?.reviewer || "待登记",
      ]
        .map(tsvValue)
        .join("\t");
    })
    .join("\n")}\n`;

  const familyHeader = [
    "外部合同族编号",
    "成员文件数",
    "候选资格完整",
    "历史曝光",
    "最终状态",
    "代表相对路径",
    "代表SHA256",
    "原因代码",
  ].join("\t");
  const familyContent = `${familyHeader}\n${families
    .map((family) =>
      [
        family.externalFamilyId,
        family.files.length,
        family.candidate,
        family.exposed,
        family.status,
        family.representative?.relativePath || "",
        family.representative?.sha256 || "",
        family.reasonCodes.join(","),
      ]
        .map(tsvValue)
        .join("\t"),
    )
    .join("\n")}\n`;

  const historyHeader = [
    "相对路径",
    "SHA256",
    "合同族编号",
    "摘要证据来源",
    "合同族证据来源",
  ].join("\t");
  const historyContent = `${historyHeader}\n${scanned
    .filter(
      (file) =>
        file.sha256 &&
        (file.historyDigestMatch ||
          (file.registry && history.familyIds.has(file.registry.externalFamilyId))),
    )
    .map((file) =>
      [
        file.relativePath,
        file.sha256,
        file.registry?.externalFamilyId || "",
        file.sha256
          ? [...(history.sourceIdsByDigest.get(file.sha256) || [])].sort(compareText).join(",")
          : "",
        file.registry
          ? [...(history.sourceIdsByFamily.get(file.registry.externalFamilyId) || [])]
              .sort(compareText)
              .join(",")
          : "",
      ]
        .map(tsvValue)
        .join("\t"),
    )
    .join("\n")}\n`;

  const unresolvedHeader = ["相对路径", "建议或注册合同族编号", "原因代码"].join("\t");
  const unresolvedContent = `${unresolvedHeader}\n${scanned
    .filter((file) => file.qualificationStatus === "pending")
    .map((file) =>
      [
        file.relativePath,
        file.registry?.externalFamilyId || file.suggestedFamilyId || "",
        [...new Set(file.reasonCodes)].sort(compareText).join(","),
      ]
        .map(tsvValue)
        .join("\t"),
    )
    .join("\n")}\n`;

  const eligibleHeader = [
    "外部合同族编号",
    "代表相对路径",
    "代表SHA256",
    "文档角色",
    "签署状态",
    "来源批次",
  ].join("\t");
  const eligibleContent = `${eligibleHeader}\n${families
    .filter((family) => family.candidate && !family.exposed && family.representative)
    .map((family) => {
      const representative = family.representative!;
      return [
        family.externalFamilyId,
        representative.relativePath,
        representative.sha256,
        representative.registry?.documentRole || "",
        representative.registry?.executionState || "",
        representative.registry?.sourceBatch || "",
      ]
        .map(tsvValue)
        .join("\t");
    })
    .join("\n")}\n`;

  const summaryContent = `${JSON.stringify(summary, null, 2)}\n`;
  const deterministicOutputs = new Map<string, string>([
    ["file-inventory.tsv", inventoryContent],
    ["qualification.tsv", qualificationContent],
    ["draft-family-registry.tsv", draftRegistryContent],
    ["family-summary.tsv", familyContent],
    ["history-matches.tsv", historyContent],
    ["unresolved.tsv", unresolvedContent],
    ["eligible-family-representatives.tsv", eligibleContent],
    ["summary.json", summaryContent],
  ]);
  const lineageContent = `${JSON.stringify(
    {
      schemaVersion: 1,
      policyVersion: CONTRACT_OCR_EXTERNAL_INTAKE_POLICY_VERSION,
      sourceId,
      frozenBaseline: {
        baselineId: baselineBefore.baselineId,
        baselineSha256: baselineBefore.baselineSha256,
        implementationDigest: baselineBefore.implementationDigest,
        evaluationDigest: baselineBefore.evaluationDigest,
      },
      inputs: {
        historyConfigSha256: history.configSha256,
        historySources: history.sourceFileDigests,
        familyRegistrySha256: registry.contentSha256,
        sourceInventorySha256: digestBuffer(inventoryContent),
      },
      outputs: Object.fromEntries(
        [...deterministicOutputs.entries()].map(([name, content]) => [
          name,
          digestBuffer(content),
        ]),
      ),
    },
    null,
    2,
  )}\n`;
  deterministicOutputs.set("run-lineage.json", lineageContent);

  const baselineAfter = await assertFrozenBaseline(options.baselinePath, workspaceRoot);
  if (baselineAfter.baselineSha256 !== baselineBefore.baselineSha256) {
    throw new Error("外部盲测导入期间冻结版本基线发生变化");
  }
  writeAtomicDirectory(roots.outputRoot, roots.outputParent, deterministicOutputs);

  return {
    summary,
    outputs: {
      fileInventoryPath: path.join(roots.outputRoot, "file-inventory.tsv"),
      qualificationPath: path.join(roots.outputRoot, "qualification.tsv"),
      draftFamilyRegistryPath: path.join(roots.outputRoot, "draft-family-registry.tsv"),
      familySummaryPath: path.join(roots.outputRoot, "family-summary.tsv"),
      historyMatchesPath: path.join(roots.outputRoot, "history-matches.tsv"),
      unresolvedPath: path.join(roots.outputRoot, "unresolved.tsv"),
      eligibleRepresentativesPath: path.join(
        roots.outputRoot,
        "eligible-family-representatives.tsv",
      ),
      lineagePath: path.join(roots.outputRoot, "run-lineage.json"),
      summaryPath: path.join(roots.outputRoot, "summary.json"),
    },
  };
}
