import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { nanoid } from "nanoid";
import type { PoolClient } from "pg";

import { centsToAmount, toCents } from "../services/contractAccounting.js";

export const HISTORICAL_IMPORT_BATCH_KEY =
  "historical-import-2026-08-26-confirmed-v1";
export const HISTORICAL_IMPORT_EXPECTED_FAMILY_COUNT = 75;
export const HISTORICAL_IMPORT_VIRTUAL_SEQUENCE = 78;
export const HISTORICAL_IMPORT_SOURCE_ROOT = "/tmp/historical-import-source";
export const HISTORICAL_IMPORT_UPLOAD_ROOT =
  "/app/uploads/contracts/historical/2026/08/26";
export const HISTORICAL_IMPORT_AUXILIARY_UPLOAD_ROOT =
  "/app/uploads/contract-auxiliary/historical/2026/08/26";

const DEFAULT_DATA_ROOT = path.resolve(
  process.cwd(),
  "debug/historical-import-run-2026-08-26",
);
const CONTRACT_FILE_CATEGORIES = new Set(["主合同候选", "合同候选"]);
const AGREEMENT_FILE_CATEGORIES = new Set(["补充协议", "解除协议"]);
const INVOICE_FILE_CATEGORIES = new Set(["发票", "作废发票", "红字发票"]);
const SUPPORTED_AUXILIARY_CONTRACT_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
]);
const SUPPORTED_AUXILIARY_EVIDENCE_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
]);

type ContractCategory = "main_business" | "non_main" | "asset";
type ContractDeclaredSubtype =
  | "engineering_consulting"
  | "non_main_income"
  | "procurement"
  | "software"
  | "house_rental"
  | "vehicle_rental"
  | "parking_space";
type ContractAssetCategory = Exclude<
  ContractDeclaredSubtype,
  "engineering_consulting" | "non_main_income"
>;
type FinancialFactKind = "invoice" | "receipt" | "payment";

interface DecisionValues {
  序号: number;
  合同大类: string;
  "线上分类/二级分类": string;
  行政区: string;
  "项目/合同名称": string;
  主合同签订日期: string;
  "补充/解除协议日期": string;
  日期来源文件: string;
  源文件夹: string;
  合同候选数: number;
  补充协议数: number;
  解除协议数: number;
  当前有效金额预估: number;
  发票净额: number;
  "回款/付款净额": number;
  结算口径: string;
  财务进度: number;
  拟导入状态: string;
  "风险/待确认": string;
  用户备注: string;
}

interface DecisionRow {
  workbookRow: number;
  sequence: number;
  isRed: boolean;
  isGreen: boolean;
  excludedRegion: boolean;
  exclusionReason: string | null;
  include: boolean;
  override: Record<string, unknown> | null;
  values: DecisionValues;
}

interface ConfirmedDecisions {
  sourceWorkbook: string;
  extractedAt: string;
  rules: {
    redSequences: number[];
    greenSequences: number[];
    excludedRegions: string[];
    virtualContractSequence: number;
  };
  summary: {
    totalRows: number;
    included: number;
    excluded: number;
    greenIncluded: number;
    redExcluded: number;
    regionExcluded: number;
  };
  rows: DecisionRow[];
}

export interface InventoryFile {
  relativePath: string;
  directory: string;
  name: string;
  ext: string;
  bytes: number;
  hash: string;
  category: string;
  dates: string[];
  amounts: number[];
  primaryAmount: number | null;
  invoiceMedium: string | null;
  isMonthly: boolean;
  isCompletedMarker: boolean;
  isTerminatedMarker: boolean;
}

interface CurrentInventory {
  summary: {
    root: string;
    fileCount: number;
    folderCount: number;
    totalBytes: number;
  };
  files: InventoryFile[];
}

interface ReportFamily {
  key: string;
  sourceFolder: string;
  category: string;
  subtype: string;
  area: string | null;
  projectName: string;
  expectedAmount: number;
  amountSource: string;
  invoiceAmount: number;
  settlementAmount: number;
  settlementLabel: string;
  status: string;
  progressRate: number;
  contractCount: number;
  supplementCount: number;
  terminationCount: number;
  invoiceCount: number;
  settlementCount: number;
  marker: string;
  contractDate: string;
  agreementDates: string;
  dateSource: string;
  onlineMatch: string;
  onlineContractNo: string;
  confirmation: string;
  userNotes: string;
  warnings: string;
}

interface ReportFile extends InventoryFile {
  duplicateGroup?: string | null;
  proposedLocation?: string;
}

interface ReportData {
  meta: Record<string, unknown>;
  familyRows: ReportFamily[];
  fileRows: ReportFile[];
}

interface AuxiliaryFilePlan {
  source: InventoryFile;
  kind: "contract" | "invoice" | "receipt";
}

interface AuxiliaryPackagePlan {
  label: string;
  files: AuxiliaryFilePlan[];
}

interface AgreementPlan {
  relationType: "supplement" | "termination";
  sequence: number | null;
  source: InventoryFile | null;
  contractDate: string | null;
  amountBefore: number;
  amountDelta: number;
  amountAfter: number;
  changeType:
    | "payment_terms_only"
    | "amount_adjustment"
    | "amount_and_payment"
    | null;
}

export interface FinancialFactPlan {
  kind: FinancialFactKind;
  amount: number;
  businessDate: string;
  source: InventoryFile | null;
  aggregateReason: string | null;
}

export interface FamilyImportPlan {
  sequence: number;
  workbookRow: number;
  sourceFolder: string;
  key: string;
  title: string;
  description: string;
  category: ContractCategory;
  declaredSubtype: ContractDeclaredSubtype;
  assetCategory: ContractAssetCategory | null;
  area: string;
  contractDate: string | null;
  originalAmount: number;
  currentAmountBeforeTermination: number;
  finalAmount: number;
  expectedStatus: string;
  virtualContract: boolean;
  requiresAuxiliaryMaterials: boolean;
  mainFile: InventoryFile | null;
  rootFiles: InventoryFile[];
  supplements: AgreementPlan[];
  terminations: AgreementPlan[];
  auxiliaryPackages: AuxiliaryPackagePlan[];
  financialFacts: FinancialFactPlan[];
  warnings: string[];
}

export interface HistoricalImportPlan {
  batchKey: string;
  sourceRoot: string;
  dataRoot: string;
  families: FamilyImportPlan[];
  excludedSequences: number[];
  referencedSourceFiles: InventoryFile[];
  warnings: string[];
  summary: {
    familyCount: number;
    virtualContractCount: number;
    greenAssetProcurementCount: number;
    supplementCount: number;
    terminationCount: number;
    auxiliaryPackageCount: number;
    financialFactCount: number;
    sourceFileCount: number;
  };
}

interface ScriptArguments {
  mode: "dry-run" | "commit";
  sourceRoot: string;
  dataRoot: string;
  actorId: string | null;
}

interface AppliedFamilyResult {
  sequence: number;
  contractId: string | null;
  contractNo: string | null;
  skipped: boolean;
  finalStatus: string | null;
  copiedFileCount: number;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function assertPlainRelativePath(relativePath: string): string {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\0") ||
    relativePath.split(/[\\/]+/u).some((segment) => segment === "..")
  ) {
    throw new Error(`库存包含不安全路径：${relativePath}`);
  }
  return relativePath.replace(/\\/gu, "/");
}

function uniqueByHash(files: readonly InventoryFile[]): InventoryFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.hash)) return false;
    seen.add(file.hash);
    return true;
  });
}

function uniqueByRelativePath(
  files: readonly InventoryFile[],
): InventoryFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.relativePath)) return false;
    seen.add(file.relativePath);
    return true;
  });
}

function normalizeDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const excelSerial = Math.trunc(value);
    if (excelSerial <= 0) return null;
    const excelEpochUtc = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpochUtc + excelSerial * 86_400_000);
    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString().slice(0, 10);
  }
  const text = String(value ?? "")
    .normalize("NFKC")
    .trim();
  if (!text || text === "—" || text.includes("未载明")) return null;
  const match = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/u);
  if (!match) return null;
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

function firstDate(file: InventoryFile | null): string | null {
  return file?.dates.map(normalizeDate).find(Boolean) || null;
}

function parseAgreementDates(value: string): string[] {
  return String(value || "")
    .split("/")
    .map(normalizeDate)
    .filter((date): date is string => Boolean(date));
}

function normalizeArea(value: string): string {
  const area = String(value || "").trim();
  if (!area || area === "—" || area === "全部") return "全部";
  return area.endsWith("区") ? area : `${area}区`;
}

function categoryMapping(
  decision: DecisionRow,
): Pick<FamilyImportPlan, "category" | "declaredSubtype" | "assetCategory"> {
  if (decision.isGreen) {
    return {
      category: "asset",
      declaredSubtype: "procurement",
      assetCategory: "procurement",
    };
  }
  const category = decision.values["合同大类"];
  const subtype = decision.values["线上分类/二级分类"];
  if (category.includes("资产")) {
    if (subtype.includes("车位")) {
      return {
        category: "asset",
        declaredSubtype: "parking_space",
        assetCategory: "parking_space",
      };
    }
    if (subtype.includes("租车")) {
      return {
        category: "asset",
        declaredSubtype: "vehicle_rental",
        assetCategory: "vehicle_rental",
      };
    }
    if (subtype.includes("房租")) {
      return {
        category: "asset",
        declaredSubtype: "house_rental",
        assetCategory: "house_rental",
      };
    }
    if (subtype.includes("网费")) {
      return {
        category: "asset",
        declaredSubtype: "software",
        assetCategory: "software",
      };
    }
    return {
      category: "asset",
      declaredSubtype: "procurement",
      assetCategory: "procurement",
    };
  }
  if (category.includes("非主营")) {
    return {
      category: "non_main",
      declaredSubtype: "non_main_income",
      assetCategory: null,
    };
  }
  return {
    category: "main_business",
    declaredSubtype: "engineering_consulting",
    assetCategory: null,
  };
}

function assetSharedFolderOwner(
  sequence: number,
  file: InventoryFile,
): boolean {
  const name = file.name;
  const date = file.dates.map(normalizeDate).find(Boolean) || "";
  if (sequence === 86) {
    return name.includes("20250703") || /^2025-06-/u.test(date);
  }
  if (sequence === 87) {
    return name.includes("20260101") || /^2025-12-/u.test(date);
  }
  if (sequence === 88) {
    return name.includes("20260701") || date >= "2026-06-20";
  }
  if (sequence === 90) {
    return name.includes("联通合同") || /^2025-/u.test(date);
  }
  if (sequence === 91) {
    return name.includes("网络接入") || /^2026-/u.test(date);
  }
  return true;
}

function filesForDecision(
  decision: DecisionRow,
  files: readonly InventoryFile[],
): InventoryFile[] {
  const sourceFolder = decision.values["源文件夹"];
  const prefixed = files.filter(
    (file) =>
      file.relativePath === sourceFolder ||
      file.relativePath.startsWith(`${sourceFolder}/`),
  );
  if ([86, 87, 88, 90, 91].includes(decision.sequence)) {
    return prefixed.filter((file) =>
      assetSharedFolderOwner(decision.sequence, file),
    );
  }
  return prefixed;
}

function isGloballyExcludedHistoricalFile(
  file: InventoryFile,
  excludedFolders: readonly string[],
): boolean {
  if (
    excludedFolders.some(
      (folder) =>
        file.relativePath === folder ||
        file.relativePath.startsWith(`${folder}/`),
    )
  ) {
    return true;
  }
  return (
    /\/2-工程→筑联天合(?:√)?\//u.test(file.relativePath) ||
    /\/北京阡陌绿洲科技有限公司(?:√)?\//u.test(file.relativePath) ||
    /\/3-工程→博霖翔皓(?:√)?\//u.test(file.relativePath) ||
    file.relativePath.startsWith(
      "小客车租赁协议(1)/太平洋保险-20260828-20270828/",
    ) ||
    file.relativePath ===
      "国网北京市电力公司/国网海淀/2-发票25960965-20240418￥10000（北京市国信公证处）.pdf" ||
    file.relativePath ===
      "国网北京市电力公司/国网海淀/服务框架协议-国网北京海淀供电公司110千伏变电站、220千伏变电站、附属大楼等3类工程房屋质量检测及安全鉴定服务.pdf"
  );
}

function relativeDirectoryWithinFamily(
  familyFolder: string,
  file: InventoryFile,
): string {
  if (file.directory === familyFolder) return "";
  return file.directory.startsWith(`${familyFolder}/`)
    ? file.directory.slice(familyFolder.length + 1)
    : file.directory;
}

function mainCandidateRank(familyFolder: string, file: InventoryFile): number {
  const relativeDirectory = relativeDirectoryWithinFamily(familyFolder, file);
  if (!relativeDirectory) return 0;
  const segments = relativeDirectory.split("/");
  if (
    segments.some(
      (segment) => segment.includes("→工程") && !segment.includes("工程→"),
    )
  ) {
    return 1;
  }
  if (segments.some((segment) => segment.includes("国网→工程"))) return 1;
  return 10 + segments.length;
}

function selectMainFile(
  decision: DecisionRow,
  files: readonly InventoryFile[],
): InventoryFile | null {
  const candidates = files.filter((file) =>
    CONTRACT_FILE_CATEGORIES.has(file.category),
  );
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => {
    const rankDifference =
      mainCandidateRank(decision.values["源文件夹"], left) -
      mainCandidateRank(decision.values["源文件夹"], right);
    if (rankDifference !== 0) return rankDifference;
    const leftFormal = /去章|草稿|模板/u.test(left.name) ? 1 : 0;
    const rightFormal = /去章|草稿|模板/u.test(right.name) ? 1 : 0;
    if (leftFormal !== rightFormal) return leftFormal - rightFormal;
    return left.relativePath.localeCompare(right.relativePath, "zh-CN");
  })[0]!;
}

function auxiliaryGroupDirectories(
  familyFolder: string,
  mainFile: InventoryFile | null,
  files: readonly InventoryFile[],
): string[] {
  const mainDirectory = mainFile?.directory || familyFolder;
  return [
    ...new Set(
      files
        .filter(
          (file) =>
            CONTRACT_FILE_CATEGORIES.has(file.category) &&
            file.hash !== mainFile?.hash &&
            file.directory !== familyFolder &&
            file.directory !== mainDirectory,
        )
        .map((file) => file.directory),
    ),
  ].sort((left, right) => left.length - right.length);
}

function closestAuxiliaryDirectory(
  file: InventoryFile,
  directories: readonly string[],
): string | null {
  return (
    [...directories]
      .filter(
        (directory) =>
          file.directory === directory ||
          file.directory.startsWith(`${directory}/`),
      )
      .sort((left, right) => right.length - left.length)[0] || null
  );
}

function auxiliaryKind(file: InventoryFile): AuxiliaryFilePlan["kind"] | null {
  const extension = file.ext.toLowerCase();
  if (
    (CONTRACT_FILE_CATEGORIES.has(file.category) ||
      AGREEMENT_FILE_CATEGORIES.has(file.category) ||
      file.category === "普通附件") &&
    SUPPORTED_AUXILIARY_CONTRACT_EXTENSIONS.has(extension)
  ) {
    return "contract";
  }
  if (
    INVOICE_FILE_CATEGORIES.has(file.category) &&
    SUPPORTED_AUXILIARY_EVIDENCE_EXTENSIONS.has(extension)
  ) {
    return "invoice";
  }
  if (
    file.category === "回单" &&
    SUPPORTED_AUXILIARY_EVIDENCE_EXTENSIONS.has(extension)
  ) {
    return "receipt";
  }
  if (SUPPORTED_AUXILIARY_CONTRACT_EXTENSIONS.has(extension)) return "contract";
  return null;
}

function buildAuxiliaryPackages(
  directories: readonly string[],
  files: readonly InventoryFile[],
  warnings: string[],
): { packages: AuxiliaryPackagePlan[]; assignedHashes: Set<string> } {
  const packages: AuxiliaryPackagePlan[] = [];
  const assignedHashes = new Set<string>();
  for (const directory of directories) {
    const groupFiles = uniqueByHash(
      files.filter(
        (file) => closestAuxiliaryDirectory(file, directories) === directory,
      ),
    );
    const normalized = groupFiles
      .map((source) => {
        const kind = auxiliaryKind(source);
        return kind ? ({ source, kind } satisfies AuxiliaryFilePlan) : null;
      })
      .filter((file): file is AuxiliaryFilePlan => Boolean(file));
    const contractFile = normalized.find((file) => file.kind === "contract");
    if (!contractFile) {
      warnings.push(
        `上游目录缺少可归档合同文件，已改为主合同普通附件：${directory}`,
      );
      continue;
    }
    const remaining = normalized.filter(
      (file) => file.source.hash !== contractFile.source.hash,
    );
    if (!remaining.length) {
      packages.push({ label: directory, files: [contractFile] });
      assignedHashes.add(contractFile.source.hash);
      continue;
    }
    for (let offset = 0; offset < remaining.length; offset += 19) {
      const chunk = [contractFile, ...remaining.slice(offset, offset + 19)];
      packages.push({ label: directory, files: chunk });
      for (const file of chunk) assignedHashes.add(file.source.hash);
    }
    for (const file of groupFiles) {
      if (
        !normalized.some((candidate) => candidate.source.hash === file.hash)
      ) {
        warnings.push(
          `上游资料格式不受辅助档案支持，已改为主合同普通附件：${file.relativePath}`,
        );
      }
    }
  }
  return { packages, assignedHashes };
}

function agreementFileSort(left: InventoryFile, right: InventoryFile): number {
  const leftDate = firstDate(left) || "9999-12-31";
  const rightDate = firstDate(right) || "9999-12-31";
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  const leftDraft = /去章|草稿|模板/u.test(left.name) ? 1 : 0;
  const rightDraft = /去章|草稿|模板/u.test(right.name) ? 1 : 0;
  if (leftDraft !== rightDraft) return leftDraft - rightDraft;
  const leftPdf = left.ext.toLowerCase() === ".pdf" ? 0 : 1;
  const rightPdf = right.ext.toLowerCase() === ".pdf" ? 0 : 1;
  if (leftPdf !== rightPdf) return leftPdf - rightPdf;
  return left.relativePath.localeCompare(right.relativePath, "zh-CN");
}

export function selectHistoricalAgreementFiles(
  files: readonly InventoryFile[],
  category: "补充协议" | "解除协议",
  expectedCount: number,
): Array<InventoryFile | null> {
  const allCandidates = uniqueByHash(
    files.filter((file) => file.category === category),
  ).sort(agreementFileSort);
  const draftCount = allCandidates.filter((file) =>
    /去章|草稿|模板/u.test(file.name),
  ).length;
  const candidates = allCandidates.filter(
    (file) => !/去章|草稿|模板/u.test(file.name),
  );
  // 确认清单的旧计数可能把去章稿算作协议事件。去章稿只能留在根合同
  // 普通附件中，不能用空协议记录替代，更不能进入有效协议数量。
  const formalExpectedCount = Math.max(0, expectedCount - draftCount);
  return Array.from(
    { length: formalExpectedCount },
    (_, index) => candidates[index] || null,
  );
}

function inferReceiptAmount(
  file: InventoryFile,
  target: number,
): number | null {
  if (file.primaryAmount != null && Number(file.primaryAmount) > 0) {
    return Number(file.primaryAmount);
  }
  const stem = file.name.replace(/\.[^.]+$/u, "");
  const values = [
    ...stem.matchAll(/(?:^|[-_])([0-9]+(?:\.[0-9]{1,2})?)(?=$|[-_])/gu),
  ]
    .map((match) => Number(match[1]))
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value > 0 &&
        value <= target &&
        !(Number.isInteger(value) && value >= 20000101 && value <= 20991231),
    );
  return values.at(-1) || null;
}

function exactSubset(
  candidates: readonly { file: InventoryFile; amount: number }[],
  targetAmount: number,
): Array<{ file: InventoryFile; amount: number }> | null {
  const target = toCents(targetAmount);
  const states = new Map<number, number[]>([[0, []]]);
  candidates.forEach((candidate, index) => {
    const candidateCents = toCents(candidate.amount);
    for (const [sum, selected] of [...states.entries()].sort(
      ([left], [right]) => right - left,
    )) {
      const next = sum + candidateCents;
      if (next > target || states.has(next)) continue;
      states.set(next, [...selected, index]);
    }
  });
  const selected = states.get(target);
  return selected ? selected.map((index) => candidates[index]!) : null;
}

function fallbackBusinessDate(
  candidates: readonly InventoryFile[],
  contractDate: string | null,
): string {
  return (
    candidates
      .flatMap((file) => file.dates)
      .map(normalizeDate)
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1) ||
    contractDate ||
    "2026-08-26"
  );
}

function buildFinancialFacts(
  kind: FinancialFactKind,
  targetAmount: number,
  files: readonly InventoryFile[],
  contractDate: string | null,
  warnings: string[],
): FinancialFactPlan[] {
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) return [];
  const category = kind === "invoice" ? "发票" : "回单";
  const candidates = uniqueByHash(
    files.filter((file) => file.category === category),
  )
    .map((file) => ({
      file,
      amount:
        kind === "invoice"
          ? Number(file.primaryAmount || 0)
          : Number(inferReceiptAmount(file, targetAmount) || 0),
    }))
    .filter((candidate) => candidate.amount > 0);
  const selected = exactSubset(candidates, targetAmount);
  if (!selected) {
    warnings.push(
      `${kind === "invoice" ? "发票" : "银行结算"}原件金额不能精确组成确认净额 ${targetAmount.toFixed(2)} 元，改用无附件历史汇总事实`,
    );
    return [
      {
        kind,
        amount: targetAmount,
        businessDate: fallbackBusinessDate(
          candidates.map((candidate) => candidate.file),
          contractDate,
        ),
        source: null,
        aggregateReason: "原件金额组合与确认清单净额不完全一致",
      },
    ];
  }
  return selected.map(({ file, amount }) => ({
    kind,
    amount,
    businessDate: firstDate(file) || contractDate || "2026-08-26",
    source: file,
    aggregateReason: null,
  }));
}

function buildSupplementPlans(
  family: ReportFamily,
  files: ReadonlyArray<InventoryFile | null>,
  originalAmount: number,
  agreementDates: readonly string[],
  warnings: string[],
): AgreementPlan[] {
  if (!files.length) return [];
  let currentAmount = originalAmount;
  return files.map((source, index) => {
    const isLast = index === files.length - 1;
    const explicitAmount = source?.primaryAmount;
    const paymentOnly = Boolean(
      source && /支付方式|付款方式|支付时间|付款时间/u.test(source.name),
    );
    let delta = 0;
    if (paymentOnly) {
      delta = 0;
    } else if (isLast) {
      delta = Number(family.expectedAmount) - currentAmount;
    } else if (explicitAmount != null && currentAmount + explicitAmount >= 0) {
      delta = Number(explicitAmount);
    }
    const after = centsToAmount(toCents(currentAmount) + toCents(delta));
    if (!source) {
      warnings.push(
        `第 ${index + 1} 份补充协议缺少当前库存文件，仍按确认金额链建立无附件记录`,
      );
    }
    const plan: AgreementPlan = {
      relationType: "supplement",
      sequence: index + 1,
      source,
      contractDate: firstDate(source) || agreementDates[index] || null,
      amountBefore: currentAmount,
      amountDelta: delta,
      amountAfter: after,
      changeType: delta === 0 ? "payment_terms_only" : "amount_adjustment",
    };
    currentAmount = after;
    return plan;
  });
}

function buildTerminationPlans(
  family: ReportFamily,
  files: ReadonlyArray<InventoryFile | null>,
  currentAmount: number,
  agreementDates: readonly string[],
  warnings: string[],
): AgreementPlan[] {
  if (!files.length) return [];
  let before = currentAmount;
  return files.map((source, index) => {
    const after =
      index === files.length - 1
        ? Number(family.settlementAmount || 0)
        : before;
    if (!source) {
      warnings.push(
        `第 ${index + 1} 份解除协议缺少当前库存文件，仍按确认结算建立无附件记录`,
      );
    }
    const plan: AgreementPlan = {
      relationType: "termination",
      sequence: null,
      source,
      contractDate: firstDate(source) || agreementDates[index] || null,
      amountBefore: before,
      amountDelta: centsToAmount(toCents(after) - toCents(before)),
      amountAfter: after,
      changeType: null,
    };
    before = after;
    return plan;
  });
}

function buildFamilyPlan(
  decision: DecisionRow,
  family: ReportFamily,
  allFiles: readonly InventoryFile[],
): FamilyImportPlan {
  const warnings: string[] = [];
  const familyFiles = filesForDecision(decision, allFiles);
  if (!familyFiles.length) {
    throw new Error(
      `第 ${decision.sequence} 族没有匹配当前库存文件：${family.sourceFolder}`,
    );
  }
  const mapping = categoryMapping(decision);
  const mainFile = selectMainFile(decision, familyFiles);
  const auxiliaryDirectories = auxiliaryGroupDirectories(
    family.sourceFolder,
    mainFile,
    familyFiles,
  );
  const auxiliary = buildAuxiliaryPackages(
    auxiliaryDirectories,
    familyFiles,
    warnings,
  );
  const mainScopeFiles = familyFiles.filter(
    (file) => !auxiliary.assignedHashes.has(file.hash),
  );
  const agreementDates = parseAgreementDates(
    decision.values["补充/解除协议日期"] || family.agreementDates,
  );
  const confirmedSupplementEventCount =
    decision.sequence === 53
      ? 2
      : Number(decision.values["补充协议数"] || family.supplementCount || 0);
  if (decision.sequence === 53) {
    warnings.push(
      "同名 DOC/PDF 稿属于两次补充协议事件的重复格式，只建立两条协议记录，其余文件作为普通附件归档",
    );
  }
  const supplementFiles = selectHistoricalAgreementFiles(
    mainScopeFiles,
    "补充协议",
    confirmedSupplementEventCount,
  );
  const terminationFiles = selectHistoricalAgreementFiles(
    mainScopeFiles,
    "解除协议",
    Number(decision.values["解除协议数"] || family.terminationCount || 0),
  );
  const virtualContract =
    decision.sequence === HISTORICAL_IMPORT_VIRTUAL_SEQUENCE;
  const expectedAmount = Number(
    decision.values["当前有效金额预估"] ?? family.expectedAmount,
  );
  if (!Number.isFinite(expectedAmount) || expectedAmount < 0) {
    throw new Error(`第 ${decision.sequence} 族确认金额不正确`);
  }
  let originalAmount = Number(mainFile?.primaryAmount || expectedAmount);
  if (!Number.isFinite(originalAmount) || originalAmount < 0) {
    originalAmount = expectedAmount;
  }
  if (!supplementFiles.length && !terminationFiles.length) {
    originalAmount = expectedAmount;
  }
  const supplements = buildSupplementPlans(
    family,
    supplementFiles,
    originalAmount,
    agreementDates,
    warnings,
  );
  const currentAmountBeforeTermination =
    supplements.at(-1)?.amountAfter ?? originalAmount;
  if (
    !terminationFiles.length &&
    toCents(currentAmountBeforeTermination) !== toCents(expectedAmount)
  ) {
    warnings.push(
      `补充协议金额链末值 ${currentAmountBeforeTermination.toFixed(2)} 元与确认金额 ${expectedAmount.toFixed(2)} 元不一致，根合同以确认金额为准`,
    );
  }
  const terminations = buildTerminationPlans(
    family,
    terminationFiles,
    expectedAmount,
    agreementDates.slice(supplementFiles.length),
    warnings,
  );
  const contractDate = virtualContract
    ? null
    : normalizeDate(decision.values["主合同签订日期"] || family.contractDate);
  const financialBaseFiles = mainScopeFiles.filter(
    (file) =>
      file.hash !== mainFile?.hash &&
      !supplementFiles.some((candidate) => candidate?.hash === file.hash) &&
      !terminationFiles.some((candidate) => candidate?.hash === file.hash),
  );
  const financialFacts = [
    ...buildFinancialFacts(
      "invoice",
      Number(decision.values["发票净额"] ?? family.invoiceAmount ?? 0),
      financialBaseFiles,
      contractDate,
      warnings,
    ),
    ...buildFinancialFacts(
      mapping.category === "asset" ? "payment" : "receipt",
      Number(decision.values["回款/付款净额"] ?? family.settlementAmount ?? 0),
      financialBaseFiles,
      contractDate,
      warnings,
    ),
  ];
  const childHashes = new Set(
    [...supplementFiles, ...terminationFiles]
      .filter((file): file is InventoryFile => Boolean(file))
      .map((file) => file.hash),
  );
  const rootFiles = uniqueByHash(
    mainScopeFiles.filter((file) => !childHashes.has(file.hash)),
  );
  if (!mainFile) {
    warnings.push(
      "当前库存没有可作为主合同原件的文件，主合同将以无原件历史记录导入",
    );
  }
  if (decision.sequence === 41) {
    warnings.push(
      "当前仅有未盖章主合同版本，文件只作为普通证据归档，不标记为盖章合同",
    );
  }
  return {
    sequence: decision.sequence,
    workbookRow: decision.workbookRow,
    sourceFolder: family.sourceFolder,
    key: family.key,
    title: decision.values["项目/合同名称"] || family.projectName,
    description: [
      `历史合同确认清单第 ${decision.sequence} 族`,
      virtualContract ? "无合同原件，仅以报价单和财务证据建立虚拟合同" : "",
      decision.isGreen || decision.values["风险/待确认"] === "—"
        ? ""
        : decision.values["风险/待确认"],
    ]
      .filter(Boolean)
      .join("；"),
    ...mapping,
    area: normalizeArea(decision.values["行政区"] || family.area || "全部"),
    contractDate,
    originalAmount,
    currentAmountBeforeTermination: expectedAmount,
    finalAmount: terminations.at(-1)?.amountAfter ?? expectedAmount,
    expectedStatus: decision.values["拟导入状态"] || family.status,
    virtualContract,
    requiresAuxiliaryMaterials: auxiliary.packages.length > 0,
    mainFile,
    rootFiles,
    supplements,
    terminations,
    auxiliaryPackages: auxiliary.packages,
    financialFacts,
    warnings,
  };
}

function resolveGlobalFinancialFileDuplicates(
  families: FamilyImportPlan[],
): string[] {
  const warnings: string[] = [];
  const owners = new Map<string, number>();
  for (const family of families) {
    family.financialFacts = family.financialFacts.map((fact) => {
      if (!fact.source) return fact;
      const owner = owners.get(fact.source.hash);
      if (owner == null) {
        owners.set(fact.source.hash, family.sequence);
        return fact;
      }
      const warning = `第 ${family.sequence} 族财务原件与第 ${owner} 族摘要重复，改用无附件历史汇总事实：${fact.source.relativePath}`;
      warnings.push(warning);
      family.warnings.push(warning);
      return {
        ...fact,
        source: null,
        aggregateReason: `财务原件摘要已由第 ${owner} 族占用`,
      };
    });
  }
  return warnings;
}

export function buildHistoricalImportPlan(input: {
  decisions: ConfirmedDecisions;
  inventory: CurrentInventory;
  report: ReportData;
  sourceRoot?: string;
  dataRoot?: string;
}): HistoricalImportPlan {
  const { decisions, inventory, report } = input;
  if (decisions.summary.included !== HISTORICAL_IMPORT_EXPECTED_FAMILY_COUNT) {
    throw new Error(
      `确认范围不是 ${HISTORICAL_IMPORT_EXPECTED_FAMILY_COUNT} 族：${decisions.summary.included}`,
    );
  }
  if (
    decisions.rules.virtualContractSequence !==
    HISTORICAL_IMPORT_VIRTUAL_SEQUENCE
  ) {
    throw new Error("虚拟合同序号与冻结规则不一致");
  }
  if (inventory.files.length !== inventory.summary.fileCount) {
    throw new Error("当前库存文件数量与摘要不一致");
  }
  const normalizedFiles = inventory.files.map((file) => ({
    ...file,
    relativePath: assertPlainRelativePath(file.relativePath),
    directory: assertPlainRelativePath(file.directory),
    ext: file.ext.toLowerCase(),
    hash: file.hash.toLowerCase(),
  }));
  const duplicatePaths = normalizedFiles.filter(
    (file, index) =>
      normalizedFiles.findIndex(
        (candidate) => candidate.relativePath === file.relativePath,
      ) !== index,
  );
  if (duplicatePaths.length) throw new Error("当前库存包含重复相对路径");
  const excludedFolders = decisions.rows
    .filter((row) => !row.include)
    .map((row) => String(row.values["源文件夹"] || ""))
    .filter(Boolean);
  const scopedFiles = normalizedFiles.filter(
    (file) => !isGloballyExcludedHistoricalFile(file, excludedFolders),
  );
  const includedRows = decisions.rows.filter((row) => row.include);
  if (includedRows.some((row) => row.isRed || row.excludedRegion)) {
    throw new Error("确认范围错误地包含红色或丰台、门头沟合同族");
  }
  const families = includedRows.map((decision) => {
    const family = report.familyRows[decision.sequence - 1];
    if (!family || family.sourceFolder !== decision.values["源文件夹"]) {
      throw new Error(`第 ${decision.sequence} 族无法与报告数据一一对应`);
    }
    return buildFamilyPlan(decision, family, scopedFiles);
  });
  if (families.length !== HISTORICAL_IMPORT_EXPECTED_FAMILY_COUNT) {
    throw new Error("最终合同族数量与冻结确认范围不一致");
  }
  const greenFamilies = families.filter((family) =>
    decisions.rules.greenSequences.includes(family.sequence),
  );
  if (
    greenFamilies.length !== 4 ||
    greenFamilies.some(
      (family) =>
        family.category !== "asset" ||
        family.declaredSubtype !== "procurement" ||
        family.assetCategory !== "procurement",
    )
  ) {
    throw new Error("绿色合同族没有全部映射为资产采购支出");
  }
  const virtual = families.find(
    (family) => family.sequence === HISTORICAL_IMPORT_VIRTUAL_SEQUENCE,
  );
  if (!virtual?.virtualContract || virtual.contractDate !== null) {
    throw new Error("第 78 族虚拟合同规则未正确应用");
  }
  const sharedAuxiliaryMappings = [
    {
      sequences: [46, 51, 52],
      relativePath:
        "国网北京市电力公司/国网海淀/服务框架采购协议-国网北京市电力公司2023年变电站土地手续办理服务框架入围.pdf",
      label: "2023年土地手续框架协议",
    },
    {
      sequences: [50, 63],
      relativePath:
        "国网北京市电力公司/国网海淀/服务框架采购协议-国网北京市电力公司2024年变电站土地手续办理服务框架入围.pdf",
      label: "2024年土地手续框架协议",
    },
    {
      sequences: [61],
      relativePath:
        "国网北京市电力公司/国网海淀/国网北京海淀供电公司2025年新材料110千伏输变电工程工程规划许可证、施工许可证技术服务合同.docx",
      label: "新材料合同可编辑稿",
    },
  ];
  for (const mapping of sharedAuxiliaryMappings) {
    const source = normalizedFiles.find(
      (file) => file.relativePath === mapping.relativePath,
    );
    if (!source) {
      throw new Error(`共享辅助材料缺失：${mapping.relativePath}`);
    }
    for (const sequence of mapping.sequences) {
      const family = families.find(
        (candidate) => candidate.sequence === sequence,
      );
      if (!family) throw new Error(`共享辅助材料目标合同族缺失：${sequence}`);
      family.auxiliaryPackages.push({
        label: mapping.label,
        files: [{ source, kind: "contract" }],
      });
      family.requiresAuxiliaryMaterials = true;
    }
  }
  const globalWarnings = resolveGlobalFinancialFileDuplicates(families);
  const referenced = uniqueByRelativePath(
    families.flatMap((family) => [
      ...family.rootFiles,
      ...family.supplements
        .map((agreement) => agreement.source)
        .filter((file): file is InventoryFile => Boolean(file)),
      ...family.terminations
        .map((agreement) => agreement.source)
        .filter((file): file is InventoryFile => Boolean(file)),
      ...family.auxiliaryPackages.flatMap((packagePlan) =>
        packagePlan.files.map((file) => file.source),
      ),
    ]),
  );
  return {
    batchKey: HISTORICAL_IMPORT_BATCH_KEY,
    sourceRoot: path.resolve(input.sourceRoot || HISTORICAL_IMPORT_SOURCE_ROOT),
    dataRoot: path.resolve(input.dataRoot || DEFAULT_DATA_ROOT),
    families,
    excludedSequences: decisions.rows
      .filter((row) => !row.include)
      .map((row) => row.sequence),
    referencedSourceFiles: referenced,
    warnings: globalWarnings,
    summary: {
      familyCount: families.length,
      virtualContractCount: families.filter((family) => family.virtualContract)
        .length,
      greenAssetProcurementCount: greenFamilies.length,
      supplementCount: families.reduce(
        (sum, family) => sum + family.supplements.length,
        0,
      ),
      terminationCount: families.reduce(
        (sum, family) => sum + family.terminations.length,
        0,
      ),
      auxiliaryPackageCount: families.reduce(
        (sum, family) => sum + family.auxiliaryPackages.length,
        0,
      ),
      financialFactCount: families.reduce(
        (sum, family) => sum + family.financialFacts.length,
        0,
      ),
      sourceFileCount: referenced.length,
    },
  };
}

export function loadHistoricalImportPlan(
  input: {
    dataRoot?: string;
    sourceRoot?: string;
  } = {},
): HistoricalImportPlan {
  const dataRoot = path.resolve(input.dataRoot || DEFAULT_DATA_ROOT);
  return buildHistoricalImportPlan({
    decisions: readJson<ConfirmedDecisions>(
      path.join(dataRoot, "confirmed-decisions.json"),
    ),
    inventory: readJson<CurrentInventory>(
      path.join(dataRoot, "current-inventory.json"),
    ),
    report: readJson<ReportData>(path.join(dataRoot, "report-data.json")),
    sourceRoot: input.sourceRoot,
    dataRoot,
  });
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function resolvedSourcePath(sourceRoot: string, file: InventoryFile): string {
  const root = path.resolve(sourceRoot);
  const candidate = path.resolve(root, file.relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`源文件路径越界：${file.relativePath}`);
  }
  return candidate;
}

export async function validateHistoricalImportSources(
  plan: HistoricalImportPlan,
): Promise<{ checkedFiles: number; checkedBytes: number }> {
  const rootStat = await fs.promises.stat(plan.sourceRoot).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error(`历史合同只读源目录不存在：${plan.sourceRoot}`);
  }
  let checkedBytes = 0;
  for (const file of plan.referencedSourceFiles) {
    const sourcePath = resolvedSourcePath(plan.sourceRoot, file);
    const stat = await fs.promises.lstat(sourcePath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        `源文件不存在、不是普通文件或属于符号链接：${file.relativePath}`,
      );
    }
    if (stat.size !== Number(file.bytes)) {
      throw new Error(`源文件大小与冻结库存不一致：${file.relativePath}`);
    }
    const digest = await sha256File(sourcePath);
    if (digest !== file.hash) {
      throw new Error(`源文件摘要与冻结库存不一致：${file.relativePath}`);
    }
    checkedBytes += stat.size;
  }
  return {
    checkedFiles: plan.referencedSourceFiles.length,
    checkedBytes,
  };
}

function mimeType(file: InventoryFile): string {
  return (
    {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".zip": "application/zip",
      ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }[file.ext.toLowerCase()] || "application/octet-stream"
  );
}

function safeFileName(file: InventoryFile): string {
  const extension = file.ext.toLowerCase();
  const base = path
    .basename(file.name, path.extname(file.name))
    .normalize("NFKC")
    .replace(/[^\w\u3400-\u9fff-]+/gu, "_")
    .slice(0, 72);
  return `${base || "历史合同文件"}-${file.hash.slice(0, 12)}${extension}`;
}

interface CopiedFile {
  storedPath: string;
  absolutePath: string;
  created: boolean;
}

async function copyHistoricalFile(input: {
  sourceRoot: string;
  uploadRoot: string;
  familySequence: number;
  bucket: string;
  file: InventoryFile;
}): Promise<CopiedFile> {
  const sourcePath = resolvedSourcePath(input.sourceRoot, input.file);
  const sourceStat = await fs.promises.lstat(sourcePath);
  if (
    !sourceStat.isFile() ||
    sourceStat.isSymbolicLink() ||
    sourceStat.size !== Number(input.file.bytes)
  ) {
    throw new Error(
      `复制前源文件状态与冻结库存不一致：${input.file.relativePath}`,
    );
  }
  const sourceHash = await sha256File(sourcePath);
  if (sourceHash !== input.file.hash) {
    throw new Error(
      `复制前源文件摘要与冻结库存不一致：${input.file.relativePath}`,
    );
  }
  const targetDirectory = path.join(
    input.uploadRoot,
    HISTORICAL_IMPORT_BATCH_KEY,
    String(input.familySequence).padStart(3, "0"),
    input.bucket,
  );
  await fs.promises.mkdir(targetDirectory, { recursive: true });
  const absolutePath = path.join(targetDirectory, safeFileName(input.file));
  let created = false;
  try {
    await fs.promises.copyFile(
      sourcePath,
      absolutePath,
      fs.constants.COPYFILE_EXCL,
    );
    created = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    const existingHash = await sha256File(absolutePath);
    if (existingHash !== input.file.hash) {
      throw new Error(`目标历史文件已存在但摘要不一致：${absolutePath}`);
    }
  }
  const storedPath = path.relative("/app", absolutePath).replace(/\\/gu, "/");
  if (!storedPath.startsWith("uploads/")) {
    throw new Error(`目标文件不在开发上传目录：${absolutePath}`);
  }
  return { storedPath, absolutePath, created };
}

async function cleanupCreatedFiles(
  copied: readonly CopiedFile[],
): Promise<void> {
  for (const file of [...copied].reverse()) {
    if (!file.created) continue;
    await fs.promises
      .rm(file.absolutePath, { force: true })
      .catch(() => undefined);
  }
}

async function generateContractNumber(client: PoolClient): Promise<string> {
  const result = await client.query<{ contract_no: string }>(
    `SELECT 'HT-' ||
       TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD') ||
       '-' || LPAD(nextval('contract_no_sequence')::text, 6, '0') AS contract_no`,
  );
  const contractNo = result.rows[0]?.contract_no;
  if (!contractNo) throw new Error("生成合同系统编号失败");
  return contractNo;
}

async function insertAudit(
  client: PoolClient,
  input: {
    contractId: string;
    action: string;
    actorId: string;
    actorRole: string;
    fromStatus: string | null;
    toStatus: string | null;
    changes: Record<string, unknown>;
    comment?: string | null;
    now: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO contract_audit_logs(
       id, contract_id, action, actor_id, actor_role, from_status,
       to_status, changes_json, comment, created_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
    [
      nanoid(),
      input.contractId,
      input.action,
      input.actorId,
      input.actorRole,
      input.fromStatus,
      input.toStatus,
      JSON.stringify(input.changes),
      input.comment || null,
      input.now,
    ],
  );
}

async function insertContractFile(
  client: PoolClient,
  input: {
    contractId: string;
    fileType: string;
    source: InventoryFile;
    copied: CopiedFile;
    actorId: string;
    now: string;
  },
): Promise<string> {
  const fileId = nanoid();
  await client.query(
    `INSERT INTO contract_files(
       id, contract_id, file_type, file_name, file_path, file_size,
       mime_type, file_hash, version, is_current, uploaded_by, created_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,TRUE,$9,$10)`,
    [
      fileId,
      input.contractId,
      input.fileType,
      input.source.name,
      input.copied.storedPath,
      input.source.bytes,
      mimeType(input.source),
      input.source.hash,
      input.actorId,
      input.now,
    ],
  );
  return fileId;
}

function financialFileType(kind: FinancialFactKind): string {
  return kind;
}

function expenseCategory(family: FamilyImportPlan): string {
  const categories: Partial<Record<ContractDeclaredSubtype, string>> = {
    parking_space: "parking",
    vehicle_rental: "car_rental",
    house_rental: "rent",
    software: "internet",
  };
  return categories[family.declaredSubtype] || "other";
}

function invoiceNumber(file: InventoryFile | null, sequence: number): string {
  const parsed = file?.name.match(/发票[^0-9]*([0-9]{8,20})/u)?.[1];
  return parsed || `HIST-${String(sequence).padStart(3, "0")}-${nanoid(6)}`;
}

async function insertFinancialFact(
  client: PoolClient,
  input: {
    family: FamilyImportPlan;
    contractId: string;
    fact: FinancialFactPlan;
    fileId: string | null;
    actorId: string;
    now: string;
  },
): Promise<void> {
  const factId = nanoid();
  if (input.fact.kind === "invoice") {
    await client.query(
      `INSERT INTO contract_invoices(
         id, contract_id, file_id, invoice_no, item_name, invoice_date,
         amount, tax_amount, seller, buyer, financial_ocr_job_id,
         deduplication_exempt, status, created_by, confirmed_by,
         confirmed_at, created_at, updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,NULL,NULL,NULL,FALSE,'confirmed',
         $8,$8,$9,$9,$9)`,
      [
        factId,
        input.contractId,
        input.fileId,
        invoiceNumber(input.fact.source, input.family.sequence),
        input.family.title,
        input.fact.businessDate,
        input.fact.amount,
        input.actorId,
        input.now,
      ],
    );
    return;
  }
  const note = input.fact.source
    ? `历史合同导入：${input.fact.source.relativePath}`
    : `历史合同导入汇总：${input.fact.aggregateReason || "确认清单净额"}`;
  const monthlyMatchResult = await client.query<{
    payer_name: string | null;
    payer_account: string | null;
    payee_name: string | null;
    payee_account: string | null;
    electronic_receipt_no: string | null;
    transaction_serial_no: string | null;
  }>(
    `SELECT payer_name, payer_account, payee_name, payee_account,
            electronic_receipt_no, transaction_serial_no
       FROM monthly_financial_bank_transactions
      WHERE is_current=TRUE AND transaction_date=$1 AND amount=$2
        AND direction=$3 AND category=$4
      ORDER BY created_at, id LIMIT 2`,
    [
      input.fact.businessDate,
      input.fact.amount,
      input.fact.kind === "receipt" ? "inflow" : "outflow",
      input.fact.kind === "receipt" ? "main_income" : "asset_expense",
    ],
  );
  const monthlyMatch =
    monthlyMatchResult.rows.length === 1 ? monthlyMatchResult.rows[0]! : null;
  if (input.fact.kind === "receipt") {
    await client.query(
      `INSERT INTO contract_receipts(
         id, contract_id, file_id, receipt_date, payment_time, amount,
         payer, payer_account, payee, payee_account, electronic_receipt_no,
         transaction_serial_no, note, financial_ocr_job_id,
         rate_snapshot_json, status, created_by,
         confirmed_by, confirmed_at, created_at, updated_at
       ) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13::jsonb,
         'confirmed',$14,$14,$15,$15,$15)`,
      [
        factId,
        input.contractId,
        input.fileId,
        input.fact.businessDate,
        input.fact.amount,
        monthlyMatch?.payer_name || null,
        monthlyMatch?.payer_account || null,
        monthlyMatch?.payee_name || null,
        monthlyMatch?.payee_account || null,
        monthlyMatch?.electronic_receipt_no || null,
        monthlyMatch?.transaction_serial_no || null,
        note,
        JSON.stringify({
          tax: 0.1172,
          marketing: 0.05,
          business: 0.1,
          financial: 0.0028,
        }),
        input.actorId,
        input.now,
      ],
    );
    return;
  }
  await client.query(
    `INSERT INTO contract_payments(
       id, contract_id, file_id, payment_date, payment_time, amount,
       expense_category, payer, payer_account, payee, payee_account,
       electronic_receipt_no, transaction_serial_no, note,
       financial_ocr_job_id, status, created_by,
       confirmed_by, confirmed_at, created_at, updated_at
     ) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,
       'confirmed',$14,$14,$15,$15,$15)`,
    [
      factId,
      input.contractId,
      input.fileId,
      input.fact.businessDate,
      input.fact.amount,
      expenseCategory(input.family),
      monthlyMatch?.payer_name || null,
      monthlyMatch?.payer_account || null,
      monthlyMatch?.payee_name || null,
      monthlyMatch?.payee_account || null,
      monthlyMatch?.electronic_receipt_no || null,
      monthlyMatch?.transaction_serial_no || null,
      note,
      input.actorId,
      input.now,
    ],
  );
}

async function insertRootContract(
  client: PoolClient,
  input: {
    family: FamilyImportPlan;
    contractId: string;
    contractNo: string;
    actorId: string;
    now: string;
  },
): Promise<void> {
  const { family } = input;
  const assetEvidence: Partial<
    Record<
      number,
      {
        partyA: string;
        partyB: string;
        fundingMode: "engineering_direct" | "engineering_to_technology";
      }
    >
  > = {
    78: {
      partyA: "北京羽隶工程咨询有限公司",
      partyB: "霸州市标牌厂",
      fundingMode: "engineering_direct",
    },
    79: {
      partyA: "北京羽隶工程咨询有限公司",
      partyB: "霸州市标牌厂",
      fundingMode: "engineering_direct",
    },
    80: {
      partyA: "北京羽隶工程咨询有限公司",
      partyB: "霸州市标牌厂",
      fundingMode: "engineering_direct",
    },
    81: {
      partyA: "北京羽隶工程咨询有限公司",
      partyB: "霸州市标牌厂",
      fundingMode: "engineering_direct",
    },
    86: {
      partyA: "国航物业酒店管理有限公司国航大厦分公司",
      partyB: "北京羽隶科技有限公司",
      fundingMode: "engineering_to_technology",
    },
    87: {
      partyA: "国航物业酒店管理有限公司国航大厦分公司",
      partyB: "北京羽隶科技有限公司",
      fundingMode: "engineering_to_technology",
    },
    88: {
      partyA: "国航物业酒店管理有限公司国航大厦分公司",
      partyB: "北京羽隶科技有限公司",
      fundingMode: "engineering_to_technology",
    },
    89: {
      partyA: "曾宇",
      partyB: "北京羽隶工程咨询有限公司",
      fundingMode: "engineering_direct",
    },
    90: {
      partyA: "北京羽隶科技有限公司",
      partyB: "中国联合网络通信有限公司北京市分公司",
      fundingMode: "engineering_to_technology",
    },
    91: {
      partyA: "北京羽隶科技有限公司",
      partyB: "北京网维讯通通信技术有限公司",
      fundingMode: "engineering_to_technology",
    },
    92: {
      partyA: "国航物业酒店管理有限公司国航大厦分公司",
      partyB: "北京羽隶科技有限公司",
      fundingMode: "engineering_to_technology",
    },
  };
  const evidence = assetEvidence[family.sequence];
  if (family.category === "asset" && !evidence) {
    throw new Error(`第 ${family.sequence} 族资产合同缺少主体与付款角色证据`);
  }
  const partyA = evidence?.partyA || "国网北京市电力公司";
  const partyB = evidence?.partyB || "北京羽隶工程咨询有限公司";
  const hasSealedMain = Boolean(
    family.mainFile &&
    !family.virtualContract &&
    family.sequence !== 41 &&
    !/去章|草稿|模板/u.test(family.mainFile.name),
  );
  await client.query(
    `INSERT INTO contracts(
       id, contract_no, business_contract_no, title, description,
       requires_auxiliary_materials, declared_category, declared_subtype,
       category, asset_category, relation_type, status, area, project_id,
       parent_contract_id, root_contract_id, party_a, party_b, project_name,
       amount_delta, original_contract_amount, current_effective_amount,
       contract_date, contract_date_source, financial_direction,
       financial_direction_source, financial_direction_version,
       asset_funding_mode, version, created_by, updated_by, sealed_at,
       effective_at, created_at, updated_at, is_deleted
     ) VALUES(
       $1,$2,CASE WHEN $21::boolean THEN '-' ELSE NULL END,$3,$4,$5,$6,$7,$6,$8,'main','effective',$9,NULL,
       NULL,$1,$10,$11,$3,$12,$12,$13,$14,$15,$16,'contract_category',1,
       $17,1,$18,$18,$19,$20,$20,$20,FALSE
     )`,
    [
      input.contractId,
      input.contractNo,
      family.title,
      family.description,
      family.requiresAuxiliaryMaterials,
      family.category,
      family.declaredSubtype,
      family.assetCategory,
      family.area,
      partyA,
      partyB,
      family.originalAmount,
      family.currentAmountBeforeTermination,
      family.contractDate,
      family.contractDate ? "manual" : null,
      family.category === "asset" ? "cost" : "income",
      evidence?.fundingMode || null,
      input.actorId,
      hasSealedMain ? input.now : null,
      input.now,
      family.virtualContract,
    ],
  );
}

async function insertAgreementContract(
  client: PoolClient,
  input: {
    rootId: string;
    family: FamilyImportPlan;
    agreement: AgreementPlan;
    contractId: string;
    contractNo: string;
    actorId: string;
    now: string;
  },
): Promise<void> {
  const supplement = input.agreement.relationType === "supplement";
  const title = supplement
    ? `${input.family.title}补充协议（${input.agreement.sequence}）`
    : `${input.family.title.replace(/(?:合同|协议书?)$/u, "")}解除协议书`;
  await client.query(
    `INSERT INTO contracts(
       id, contract_no, title, description, requires_auxiliary_materials,
       declared_category, declared_subtype, category, asset_category,
       relation_type, status, area, project_id, parent_contract_id,
       root_contract_id, termination_target_contract_id, party_a, party_b,
       project_name, amount_delta, amount_before_change, amount_after_change,
       supplement_change_type, supplement_sequence, contract_date,
       contract_date_source, financial_direction, financial_direction_source,
       financial_direction_version, asset_funding_mode, version, created_by,
       updated_by, sealed_at, effective_at, created_at, updated_at, is_deleted
     ) SELECT
       $1,$2,$3,$4,FALSE,root.declared_category,root.declared_subtype,
       root.category,root.asset_category,$5,'effective',root.area,NULL,
       root.id,root.id,$6,root.party_a,root.party_b,$3,$7,$8,$9,$10,$11,
       $12,$13,root.financial_direction,'contract_category',1,
       root.asset_funding_mode,1,$14,$14,$15,$16,$16,$16,FALSE
     FROM contracts root WHERE root.id=$17`,
    [
      input.contractId,
      input.contractNo,
      title,
      `历史合同确认清单第 ${input.family.sequence} 族${supplement ? "补充协议" : "解除协议"}`,
      input.agreement.relationType,
      supplement ? null : input.rootId,
      input.agreement.amountDelta,
      input.agreement.amountBefore,
      input.agreement.amountAfter,
      input.agreement.changeType,
      input.agreement.sequence,
      input.agreement.contractDate,
      input.agreement.contractDate ? "manual" : null,
      input.actorId,
      input.agreement.source ? input.now : null,
      input.now,
      input.rootId,
    ],
  );
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
  if (!result.rows[0]) {
    throw new Error("开发库没有可用于历史导入的活动财务管理员账号");
  }
  return result.rows[0];
}

async function assertDevelopmentDatabase(client: PoolClient): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("提交模式只允许在 NODE_ENV=development 的开发容器执行");
  }
  if (path.resolve(process.cwd()) !== "/app") {
    throw new Error("提交模式必须在开发容器 /app 工作目录执行");
  }
  const unexpected = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM contracts contract
     WHERE NOT EXISTS (
       SELECT 1 FROM contract_audit_logs audit
       WHERE audit.contract_id=contract.id
         AND audit.action IN (
           'historical_contract_imported',
           'historical_supplement_imported',
           'historical_termination_imported'
         )
         AND audit.changes_json->>'batchKey'=$1
     )`,
    [HISTORICAL_IMPORT_BATCH_KEY],
  );
  if (Number(unexpected.rows[0]?.count || 0) > 0) {
    throw new Error("开发库包含本批导入之外的合同，拒绝混入一次性历史导入");
  }
}

async function applyFamily(
  family: FamilyImportPlan,
  input: {
    sourceRoot: string;
    actorId: string | null;
    db: (typeof import("../db/index.js"))["db"];
    recalculateContractExecutionStatus: (typeof import("../services/contractService.js"))["recalculateContractExecutionStatus"];
  },
): Promise<AppliedFamilyResult> {
  const copiedFiles: CopiedFile[] = [];
  try {
    return await input.db.transaction(async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(
          hashtextextended('historical-contract-import:' || $1, 0)
        )`,
        [HISTORICAL_IMPORT_BATCH_KEY],
      );
      await assertDevelopmentDatabase(client);
      const existing = await client.query<{ contract_id: string }>(
        `SELECT contract_id FROM contract_audit_logs
         WHERE action='historical_contract_imported'
           AND changes_json->>'batchKey'=$1
           AND changes_json->>'sequence'=$2
         ORDER BY created_at, id LIMIT 1`,
        [HISTORICAL_IMPORT_BATCH_KEY, String(family.sequence)],
      );
      if (existing.rows[0]) {
        return {
          sequence: family.sequence,
          contractId: existing.rows[0].contract_id,
          contractNo: null,
          skipped: true,
          finalStatus: null,
          copiedFileCount: 0,
        };
      }
      const actor = await resolveActor(client, input.actorId);
      const now = new Date().toISOString();
      const rootId = nanoid();
      const rootContractNo = await generateContractNumber(client);
      await insertRootContract(client, {
        family,
        contractId: rootId,
        contractNo: rootContractNo,
        actorId: actor.id,
        now,
      });

      const financeFileTypes = new Map<string, FinancialFactKind>();
      for (const fact of family.financialFacts) {
        if (fact.source) financeFileTypes.set(fact.source.hash, fact.kind);
      }
      const rootFileIds = new Map<string, string>();
      for (const source of family.rootFiles) {
        const copied = await copyHistoricalFile({
          sourceRoot: input.sourceRoot,
          uploadRoot: HISTORICAL_IMPORT_UPLOAD_ROOT,
          familySequence: family.sequence,
          bucket: "root",
          file: source,
        });
        copiedFiles.push(copied);
        const factKind = financeFileTypes.get(source.hash);
        const isMain = source.hash === family.mainFile?.hash;
        const fileType = factKind
          ? financialFileType(factKind)
          : INVOICE_FILE_CATEGORIES.has(source.category)
            ? "invoice"
            : source.category === "回单"
              ? family.category === "asset"
                ? "payment"
                : "receipt"
              : isMain && !family.virtualContract && family.sequence !== 41
                ? "sealed_contract"
                : "other";
        const fileId = await insertContractFile(client, {
          contractId: rootId,
          fileType,
          source,
          copied,
          actorId: actor.id,
          now,
        });
        rootFileIds.set(source.hash, fileId);
        if (factKind) {
          const registry = await client.query(
            `INSERT INTO contract_financial_file_hashes(
               file_hash, file_id, contract_id, created_at
             ) VALUES($1,$2,$3,$4) ON CONFLICT(file_hash) DO NOTHING`,
            [source.hash, fileId, rootId, now],
          );
          if (registry.rowCount !== 1) {
            throw new Error(`财务原件摘要已被占用：${source.relativePath}`);
          }
        }
      }

      for (const agreement of family.supplements) {
        const childId = nanoid();
        const childContractNo = await generateContractNumber(client);
        await insertAgreementContract(client, {
          rootId,
          family,
          agreement,
          contractId: childId,
          contractNo: childContractNo,
          actorId: actor.id,
          now,
        });
        if (agreement.source) {
          const copied = await copyHistoricalFile({
            sourceRoot: input.sourceRoot,
            uploadRoot: HISTORICAL_IMPORT_UPLOAD_ROOT,
            familySequence: family.sequence,
            bucket: `supplement-${agreement.sequence}`,
            file: agreement.source,
          });
          copiedFiles.push(copied);
          await insertContractFile(client, {
            contractId: childId,
            fileType: "sealed_contract",
            source: agreement.source,
            copied,
            actorId: actor.id,
            now,
          });
        }
        await client.query(
          `UPDATE contracts SET current_effective_amount=$2,
             updated_by=$3, updated_at=$4, version=version+1
           WHERE id=$1`,
          [rootId, agreement.amountAfter, actor.id, now],
        );
        await insertAudit(client, {
          contractId: childId,
          action: "historical_supplement_imported",
          actorId: actor.id,
          actorRole: actor.role,
          fromStatus: null,
          toStatus: "effective",
          changes: {
            batchKey: HISTORICAL_IMPORT_BATCH_KEY,
            sequence: family.sequence,
            supplementSequence: agreement.sequence,
            amountBefore: agreement.amountBefore,
            amountDelta: agreement.amountDelta,
            amountAfter: agreement.amountAfter,
            sourcePath: agreement.source?.relativePath || null,
          },
          now,
        });
      }
      await client.query(
        `UPDATE contracts SET current_effective_amount=$2,
           updated_by=$3, updated_at=$4
         WHERE id=$1`,
        [rootId, family.currentAmountBeforeTermination, actor.id, now],
      );

      for (let index = 0; index < family.auxiliaryPackages.length; index += 1) {
        const packagePlan = family.auxiliaryPackages[index]!;
        const packageId = nanoid();
        await client.query(
          `INSERT INTO contract_auxiliary_packages(
             id, parent_contract_id, note, status, ocr_fields_json,
             ocr_lines_json, warnings_json, retry_count, version,
             accounting_included, created_by, updated_by, created_at, updated_at
           ) VALUES($1,$2,$3,'succeeded','[]'::jsonb,'[]'::jsonb,
             '[]'::jsonb,0,1,FALSE,$4,$4,$5,$5)`,
          [
            packageId,
            rootId,
            `历史合同上游辅助材料：${packagePlan.label}`,
            actor.id,
            now,
          ],
        );
        for (const auxiliaryFile of packagePlan.files) {
          const copied = await copyHistoricalFile({
            sourceRoot: input.sourceRoot,
            uploadRoot: HISTORICAL_IMPORT_AUXILIARY_UPLOAD_ROOT,
            familySequence: family.sequence,
            bucket: `package-${index + 1}`,
            file: auxiliaryFile.source,
          });
          copiedFiles.push(copied);
          await client.query(
            `INSERT INTO contract_auxiliary_files(
               id, package_id, file_kind, file_name, file_path, file_size,
               mime_type, file_hash, version, is_current, uploaded_by, created_at
             ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,TRUE,$9,$10)`,
            [
              nanoid(),
              packageId,
              auxiliaryFile.kind,
              auxiliaryFile.source.name,
              copied.storedPath,
              auxiliaryFile.source.bytes,
              mimeType(auxiliaryFile.source),
              auxiliaryFile.source.hash,
              actor.id,
              now,
            ],
          );
        }
        await insertAudit(client, {
          contractId: rootId,
          action: "auxiliary_package_created",
          actorId: actor.id,
          actorRole: actor.role,
          fromStatus: "effective",
          toStatus: "effective",
          changes: {
            batchKey: HISTORICAL_IMPORT_BATCH_KEY,
            sequence: family.sequence,
            packageId,
            accountingIncluded: false,
            label: packagePlan.label,
            fileCount: packagePlan.files.length,
          },
          now,
        });
      }

      for (const fact of family.financialFacts) {
        await insertFinancialFact(client, {
          family,
          contractId: rootId,
          fact,
          fileId: fact.source
            ? rootFileIds.get(fact.source.hash) || null
            : null,
          actorId: actor.id,
          now,
        });
      }
      let root = await input.recalculateContractExecutionStatus(
        client,
        rootId,
        actor.id,
        actor.role,
      );

      for (const agreement of family.terminations) {
        const childId = nanoid();
        const childContractNo = await generateContractNumber(client);
        await insertAgreementContract(client, {
          rootId,
          family,
          agreement,
          contractId: childId,
          contractNo: childContractNo,
          actorId: actor.id,
          now,
        });
        if (agreement.source) {
          const copied = await copyHistoricalFile({
            sourceRoot: input.sourceRoot,
            uploadRoot: HISTORICAL_IMPORT_UPLOAD_ROOT,
            familySequence: family.sequence,
            bucket: "termination",
            file: agreement.source,
          });
          copiedFiles.push(copied);
          await insertContractFile(client, {
            contractId: childId,
            fileType: "sealed_contract",
            source: agreement.source,
            copied,
            actorId: actor.id,
            now,
          });
        }
        await insertAudit(client, {
          contractId: childId,
          action: "historical_termination_imported",
          actorId: actor.id,
          actorRole: actor.role,
          fromStatus: null,
          toStatus: "effective",
          changes: {
            batchKey: HISTORICAL_IMPORT_BATCH_KEY,
            sequence: family.sequence,
            terminationTargetContractId: rootId,
            amountBefore: agreement.amountBefore,
            amountDelta: agreement.amountDelta,
            amountAfter: agreement.amountAfter,
            sourcePath: agreement.source?.relativePath || null,
          },
          now,
        });
        const terminated = await client.query<typeof root>(
          `UPDATE contracts SET status='terminated', terminated_at=$2,
             current_effective_amount=$3, updated_by=$4, updated_at=$2,
             version=version+1
           WHERE id=$1 RETURNING *`,
          [rootId, now, agreement.amountAfter, actor.id],
        );
        root = terminated.rows[0]!;
      }

      await insertAudit(client, {
        contractId: rootId,
        action: "historical_contract_imported",
        actorId: actor.id,
        actorRole: actor.role,
        fromStatus: null,
        toStatus: root.status,
        changes: {
          batchKey: HISTORICAL_IMPORT_BATCH_KEY,
          sequence: family.sequence,
          workbookRow: family.workbookRow,
          sourceFolder: family.sourceFolder,
          sourceHashes: uniqueByHash([
            ...family.rootFiles,
            ...family.supplements
              .map((agreement) => agreement.source)
              .filter((file): file is InventoryFile => Boolean(file)),
            ...family.terminations
              .map((agreement) => agreement.source)
              .filter((file): file is InventoryFile => Boolean(file)),
          ]).map((file) => file.hash),
          virtualContract: family.virtualContract,
          declaredCategory: family.category,
          declaredSubtype: family.declaredSubtype,
          financialDirection: family.category === "asset" ? "cost" : "income",
          originalAmount: family.originalAmount,
          confirmedCurrentAmount: family.currentAmountBeforeTermination,
          finalAmount: Number(root.current_effective_amount || 0),
          expectedStatus: family.expectedStatus,
          actualStatus: root.status,
          supplementCount: family.supplements.length,
          terminationCount: family.terminations.length,
          auxiliaryPackageCount: family.auxiliaryPackages.length,
          financialFacts: family.financialFacts.map((fact) => ({
            kind: fact.kind,
            amount: fact.amount,
            businessDate: fact.businessDate,
            sourcePath: fact.source?.relativePath || null,
            aggregateReason: fact.aggregateReason,
          })),
          warnings: family.warnings,
        },
        comment: family.description,
        now,
      });
      return {
        sequence: family.sequence,
        contractId: rootId,
        contractNo: rootContractNo,
        skipped: false,
        finalStatus: root.status,
        copiedFileCount: copiedFiles.length,
      };
    });
  } catch (error) {
    await cleanupCreatedFiles(copiedFiles);
    throw error;
  }
}

export async function commitHistoricalImport(
  plan: HistoricalImportPlan,
  actorId: string | null,
): Promise<AppliedFamilyResult[]> {
  if (plan.batchKey !== HISTORICAL_IMPORT_BATCH_KEY) {
    throw new Error("导入批次编号不是冻结版本");
  }
  const [
    { db, pool },
    { recalculateContractExecutionStatus },
    { reconcileMonthlyContractBankTransactions },
  ] = await Promise.all([
    import("../db/index.js"),
    import("../services/contractService.js"),
    import("../services/monthlyFinancialBankLinker.js"),
  ]);
  const results: AppliedFamilyResult[] = [];
  const repairCreatedPaths: string[] = [];
  try {
    for (const family of plan.families) {
      results.push(
        await applyFamily(family, {
          sourceRoot: plan.sourceRoot,
          actorId,
          db,
          recalculateContractExecutionStatus,
        }),
      );
    }
    const { applyHistoricalRepair } =
      await import("./repair-confirmed-historical-contracts.js");
    try {
      await db.transaction((client) =>
        applyHistoricalRepair(client, {
          actorId,
          recalculateContractExecutionStatus,
          createdPaths: repairCreatedPaths,
        }),
      );
    } catch (error) {
      await Promise.all(
        repairCreatedPaths.map((filePath) =>
          fs.promises.rm(filePath, { force: true }).catch(() => undefined),
        ),
      );
      throw error;
    }
    const financialMonths = [
      ...new Set(
        plan.families
          .flatMap((family) => family.financialFacts)
          .map((fact) => fact.businessDate.slice(0, 7))
          .filter((month) => /^20\d{2}-\d{2}$/u.test(month)),
      ),
    ].sort();
    if (financialMonths.length) {
      await db.transaction(async (client) => {
        const actor = await resolveActor(client, actorId);
        const now = new Date().toISOString();
        for (const month of financialMonths) {
          await reconcileMonthlyContractBankTransactions(
            client,
            month,
            actor.id,
            now,
            actor.role,
          );
        }
      });
    }
    return results;
  } finally {
    await pool.end();
  }
}

export function parseScriptArguments(argv: readonly string[]): ScriptArguments {
  const hasDryRun = argv.includes("--dry-run");
  const hasCommit = argv.includes("--commit");
  if (hasDryRun === hasCommit) {
    throw new Error("必须且只能指定 --dry-run 或 --commit");
  }
  const value = (name: string): string | null => {
    const directIndex = argv.indexOf(name);
    if (directIndex >= 0) return argv[directIndex + 1] || null;
    const prefix = `${name}=`;
    return (
      argv
        .find((argument) => argument.startsWith(prefix))
        ?.slice(prefix.length) || null
    );
  };
  return {
    mode: hasCommit ? "commit" : "dry-run",
    sourceRoot: path.resolve(
      value("--source-root") || HISTORICAL_IMPORT_SOURCE_ROOT,
    ),
    dataRoot: path.resolve(value("--data-root") || DEFAULT_DATA_ROOT),
    actorId: value("--actor-id"),
  };
}

function printHelp(): void {
  console.log(`确认版历史合同一次性开发导入

用法：
  npx tsx server/scripts/import-confirmed-historical-contracts.ts --dry-run
  npx tsx server/scripts/import-confirmed-historical-contracts.ts --commit

可选参数：
  --source-root <目录>  默认 /tmp/historical-import-source
  --data-root <目录>    默认 debug/historical-import-run-2026-08-26
  --actor-id <账号编号> 指定活动管理员作为审计操作人

安全规则：
  提交模式只允许在 NODE_ENV=development 的 /app 开发容器执行；
  红色合同族、丰台和门头沟合同族不会进入计划；
  每个合同族使用独立数据库事务，失败只清理本族新复制文件。`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  const args = parseScriptArguments(process.argv.slice(2));
  const plan = loadHistoricalImportPlan({
    dataRoot: args.dataRoot,
    sourceRoot: args.sourceRoot,
  });
  const sourceValidation = await validateHistoricalImportSources(plan);
  if (args.mode === "dry-run") {
    console.log(
      JSON.stringify(
        {
          模式: "预演",
          批次: plan.batchKey,
          摘要: plan.summary,
          排除序号: plan.excludedSequences,
          源文件校验: sourceValidation,
          族级警告数量: plan.families.reduce(
            (sum, family) => sum + family.warnings.length,
            0,
          ),
          族级警告: plan.families
            .filter((family) => family.warnings.length)
            .map((family) => ({
              序号: family.sequence,
              警告: family.warnings,
            })),
        },
        null,
        2,
      ),
    );
    return;
  }
  const results = await commitHistoricalImport(plan, args.actorId);
  console.log(
    JSON.stringify(
      {
        模式: "提交",
        批次: plan.batchKey,
        源文件校验: sourceValidation,
        结果: results,
        新增合同族: results.filter((result) => !result.skipped).length,
        幂等跳过合同族: results.filter((result) => result.skipped).length,
      },
      null,
      2,
    ),
  );
}

const directEntry = /import-confirmed-historical-contracts\.(?:ts|js)$/u.test(
  path.basename(process.argv[1] || ""),
);
if (directEntry) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
