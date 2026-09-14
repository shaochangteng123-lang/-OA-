import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  SECOND_HISTORICAL_IMPORT_EXPECTED_FILE_COUNT,
  SECOND_HISTORICAL_IMPORT_EXPECTED_ASSIGNMENT_COUNTS,
  SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
  SECOND_HISTORICAL_IMPORT_EXPECTED_TOTAL_BYTES,
  SECOND_HISTORICAL_IMPORT_FAMILIES,
  type SecondHistoricalFamilySpec,
  type SecondHistoricalRootSpec,
  secondHistoricalDeclaredMainTarget,
  secondHistoricalDirection,
} from "./second-historical-import-config.js";

export type SecondHistoricalSourceKind =
  | "main"
  | "supplement"
  | "termination"
  | "invoice"
  | "void_invoice"
  | "settlement"
  | "other";

export interface SecondHistoricalSourceFile {
  absolutePath: string;
  relativePath: string;
  directory: string;
  name: string;
  extension: string;
  bytes: number;
  hash: string;
  auxiliary: boolean;
  kind: SecondHistoricalSourceKind;
  amount: number | null;
  businessDate: string | null;
  familyId: string;
}

export interface SecondHistoricalAgreementPlan {
  relationType: "supplement" | "termination";
  sequence: number | null;
  source: SecondHistoricalSourceFile;
  contractDate: string;
  amountBefore: number;
  amountDelta: number;
  amountAfter: number;
}

export interface SecondHistoricalFinancialPlan {
  kind: "invoice" | "receipt" | "payment";
  source: SecondHistoricalSourceFile;
  amount: number;
  businessDate: string;
  invoiceNo: string | null;
}

export interface SecondHistoricalRootPlan {
  key: string;
  family: SecondHistoricalFamilySpec;
  rootSpec: SecondHistoricalRootSpec;
  source: SecondHistoricalSourceFile;
  projectName: string;
  businessContractNo: string | null;
  contractDate: string;
  originalAmount: number | null;
  currentAmount: number;
  financialDirection: "income" | "cost";
  agreements: SecondHistoricalAgreementPlan[];
  financialFacts: SecondHistoricalFinancialPlan[];
  archiveFiles: SecondHistoricalSourceFile[];
  auxiliaryFiles: SecondHistoricalSourceFile[];
  restoreContractId: string | null;
}

export interface SecondHistoricalSourceAssignment {
  relativePath: string;
  hash: string;
  familyId: string;
  rootKey: string;
  target:
    | "sealed_contract"
    | "agreement"
    | "financial"
    | "archive"
    | "auxiliary";
  accountingIncluded: boolean;
}

export interface SecondHistoricalImportPlan {
  sourceRoot: string;
  manifestHash: string;
  totalBytes: number;
  sourceFiles: SecondHistoricalSourceFile[];
  roots: SecondHistoricalRootPlan[];
  assignments: SecondHistoricalSourceAssignment[];
  summary: {
    sourceFileCount: number;
    rootContractCount: number;
    restoredContractCount: number;
    supplementCount: number;
    terminationCount: number;
    invoiceCount: number;
    receiptCount: number;
    paymentCount: number;
    auxiliaryFileCount: number;
    archiveFileCount: number;
    incomeContractCount: number;
    costContractCount: number;
    invoiceAmount: number;
    incomeSettlementAmount: number;
    costSettlementAmount: number;
  };
}

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xlsx",
  ".jpg",
  ".jpeg",
  ".png",
  ".zip",
]);

function cents(value: number): number {
  return Math.round(value * 100);
}

function amountFromName(name: string): number | null {
  const matches = [
    ...name.normalize("NFKC").matchAll(/[￥¥](-?\d+(?:\.\d{1,2})?)/gu),
  ];
  if (!matches.length) return null;
  const parsed = Number(matches.at(-1)?.[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateParts(
  year: string,
  month: string,
  day: string,
): string | null {
  const value = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function dateFromName(name: string): string | null {
  const normalized = name.normalize("NFKC");
  for (const compact of normalized.matchAll(
    /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/gu,
  )) {
    const value = normalizeDateParts(compact[1]!, compact[2]!, compact[3]!);
    if (value) return value;
  }
  for (const separated of normalized.matchAll(
    /(?<!\d)(20\d{2})[-_.年](\d{1,2})[-_.月](\d{1,2})(?:日)?(?!\d)/gu,
  )) {
    const value = normalizeDateParts(
      separated[1]!,
      separated[2]!,
      separated[3]!,
    );
    if (value) return value;
  }
  return null;
}

function normalizeRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

async function sha256File(filePath: string): Promise<string> {
  const digest = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return digest.digest("hex");
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await fs.promises.readdir(directory, {
      withFileTypes: true,
    });
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `源目录不允许符号链接：${normalizeRelative(root, absolutePath)}`,
        );
      }
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) output.push(absolutePath);
      else
        throw new Error(
          `源目录包含不支持的条目：${normalizeRelative(root, absolutePath)}`,
        );
    }
  }
  await visit(root);
  return output;
}

function ownerFamily(relativePath: string): SecondHistoricalFamilySpec {
  const candidates = SECOND_HISTORICAL_IMPORT_FAMILIES.filter(
    (family) =>
      relativePath === family.directory ||
      relativePath.startsWith(`${family.directory}/`),
  ).sort((left, right) => right.directory.length - left.directory.length);
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length
        ? `源文件同时命中多个合同族：${relativePath}`
        : `源文件未匹配任何确认合同族：${relativePath}`,
    );
  }
  return candidates[0]!;
}

function configuredMainNames(family: SecondHistoricalFamilySpec): Set<string> {
  return new Set(
    family.roots?.map((root) => root.mainFileName) || [family.mainFileName],
  );
}

function classifySource(
  relativePath: string,
  name: string,
  family: SecondHistoricalFamilySpec,
  auxiliary: boolean,
): SecondHistoricalSourceKind {
  if (configuredMainNames(family).has(name)) return "main";
  if (auxiliary) {
    if (/补充协议/u.test(name)) return "supplement";
    if (/(?:解除|终止)协议/u.test(name)) return "termination";
    if (/发票/u.test(name) && /作废/u.test(name)) return "void_invoice";
    if (/发票/u.test(name)) return "invoice";
    if (/回单/u.test(name)) return "settlement";
    return "other";
  }
  if (/补充协议/u.test(name)) return "supplement";
  if (/(?:解除|终止)协议/u.test(name)) return "termination";
  if (/^2[-_].*发票/u.test(name) && /作废/u.test(name)) return "void_invoice";
  if (/^2[-_].*发票/u.test(name)) return "invoice";
  if (/^3[-_].*回单/u.test(name)) return "settlement";
  if (/^1[-_]/u.test(name)) return "main";
  if (
    family.id === "second-003" &&
    name === "顺义理疗研究中心用房技术咨询服务合同（验收分包）20251118.pdf"
  ) {
    return "main";
  }
  if (!relativePath) throw new Error("源文件相对路径为空");
  return "other";
}

function sourceDateOverride(
  family: SecondHistoricalFamilySpec,
  file: Pick<SecondHistoricalSourceFile, "kind" | "name">,
): string | null {
  if (family.id === "second-005" && file.kind === "invoice") {
    return "2024-04-19";
  }
  if (
    family.id === "second-005" &&
    file.name === "3-回单-20250723￥480000.png"
  ) {
    return "2024-07-23";
  }
  if (
    family.id === "second-021" &&
    file.name === "3-回单-20230703￥100000.png"
  ) {
    return "2023-07-06";
  }
  if (
    family.id === "second-023" &&
    file.name === "3-回单-20241208￥139150.png"
  ) {
    return "2023-12-08";
  }
  if (
    family.id === "second-015" &&
    file.name === "2-发票24112000000151857115￥103025.08.pdf"
  ) {
    return "2024-10-14";
  }
  if (
    family.id === "second-037" &&
    file.name === "3-回单-20261013￥100000.png"
  ) {
    return "2023-10-13";
  }
  return null;
}

function sourceAmountOverride(
  family: SecondHistoricalFamilySpec,
  file: Pick<SecondHistoricalSourceFile, "kind">,
): number | null {
  if (family.id === "second-005" && file.kind === "invoice") return 96_000;
  return null;
}

export async function scanSecondHistoricalSource(
  sourceRoot: string,
): Promise<SecondHistoricalSourceFile[]> {
  const root = path.resolve(sourceRoot);
  const rootStat = await fs.promises.stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error(`第二批源目录不存在：${root}`);
  const absolutePaths = await listFiles(root);
  const files: SecondHistoricalSourceFile[] = [];
  for (const absolutePath of absolutePaths) {
    const relativePath = normalizeRelative(root, absolutePath);
    const family = ownerFamily(relativePath);
    const extension = path.extname(absolutePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error(`源文件格式不受支持：${relativePath}`);
    }
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(`源文件为空或不是普通文件：${relativePath}`);
    }
    const name = path.basename(absolutePath);
    const auxiliary = relativePath.split("/").includes("附件");
    const kind = classifySource(relativePath, name, family, auxiliary);
    const provisional = { kind, name };
    files.push({
      absolutePath,
      relativePath,
      directory: path.posix.dirname(relativePath),
      name,
      extension,
      bytes: stat.size,
      hash: await sha256File(absolutePath),
      auxiliary,
      kind,
      amount: sourceAmountOverride(family, provisional) ?? amountFromName(name),
      businessDate:
        sourceDateOverride(family, provisional) ?? dateFromName(name),
      familyId: family.id,
    });
  }
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "zh-CN"),
  );
}

function manifestHash(files: readonly SecondHistoricalSourceFile[]): string {
  const records = files
    .map((file) => `${file.relativePath}\0${file.bytes}\0${file.hash}`)
    .sort();
  return crypto.createHash("sha256").update(records.join("\n")).digest("hex");
}

function rootSpecs(
  family: SecondHistoricalFamilySpec,
): SecondHistoricalRootSpec[] {
  return family.roots?.length
    ? [...family.roots]
    : [{ mainFileName: family.mainFileName }];
}

function requireFile(
  familyFiles: readonly SecondHistoricalSourceFile[],
  name: string,
): SecondHistoricalSourceFile {
  const matches = familyFiles.filter((file) => file.name === name);
  if (matches.length !== 1) {
    throw new Error(
      `主合同文件匹配数量不是1：${name}（实际${matches.length}）`,
    );
  }
  return matches[0]!;
}

function supplementOwner(
  roots: readonly SecondHistoricalRootSpec[],
): SecondHistoricalRootSpec {
  const explicit = roots.filter((root) => root.ownsSupplements);
  if (explicit.length > 1)
    throw new Error("同一合同族只能指定一个补充协议归属合同");
  if (explicit[0]) return explicit[0];
  return (
    roots.find(
      (root) => secondHistoricalDeclaredMainTarget(root) === "sealed_contract",
    ) || roots[0]!
  );
}

function ownsFinancialFile(
  root: SecondHistoricalRootSpec,
  roots: readonly SecondHistoricalRootSpec[],
  amount: number,
): boolean {
  if (
    roots.filter(
      (candidate) =>
        secondHistoricalDeclaredMainTarget(candidate) === "sealed_contract",
    ).length === 1
  )
    return true;
  if (root.financialAmounts === undefined) {
    return !roots.some(
      (candidate) =>
        candidate !== root &&
        candidate.financialAmounts?.some(
          (candidateAmount) => cents(candidateAmount) === cents(amount),
        ),
    );
  }
  return root.financialAmounts.some(
    (candidateAmount) => cents(candidateAmount) === cents(amount),
  );
}

function invoiceNo(file: SecondHistoricalSourceFile): string {
  const match = file.name.normalize("NFKC").match(/发票[-_]?([0-9]{8,20})/u);
  if (!match?.[1])
    throw new Error(`发票号码无法从已核验文件名取得：${file.relativePath}`);
  return match[1];
}

function buildAgreements(
  root: SecondHistoricalRootSpec,
  roots: readonly SecondHistoricalRootSpec[],
  familyFiles: readonly SecondHistoricalSourceFile[],
  initialAmount: number,
): SecondHistoricalAgreementPlan[] {
  if (root !== supplementOwner(roots)) return [];
  const supplements = familyFiles
    .filter((file) => !file.auxiliary && file.kind === "supplement")
    .sort((left, right) =>
      (left.businessDate || "9999-12-31").localeCompare(
        right.businessDate || "9999-12-31",
      ),
    );
  const terminations = familyFiles
    .filter((file) => !file.auxiliary && file.kind === "termination")
    .sort((left, right) =>
      (left.businessDate || "9999-12-31").localeCompare(
        right.businessDate || "9999-12-31",
      ),
    );
  let running = initialAmount;
  const output: SecondHistoricalAgreementPlan[] = [];
  supplements.forEach((source, index) => {
    if (!source.businessDate || source.amount == null || source.amount <= 0) {
      throw new Error(`补充协议日期或增额不完整：${source.relativePath}`);
    }
    const next = (cents(running) + cents(source.amount)) / 100;
    output.push({
      relationType: "supplement",
      sequence: index + 1,
      source,
      contractDate: source.businessDate,
      amountBefore: running,
      amountDelta: source.amount,
      amountAfter: next,
    });
    running = next;
  });
  terminations.forEach((source) => {
    if (!source.businessDate) {
      throw new Error(`解除协议日期不完整：${source.relativePath}`);
    }
    output.push({
      relationType: "termination",
      sequence: null,
      source,
      contractDate: source.businessDate,
      amountBefore: running,
      amountDelta: -running,
      amountAfter: 0,
    });
    running = 0;
  });
  return output;
}

function buildFinancialFacts(
  family: SecondHistoricalFamilySpec,
  root: SecondHistoricalRootSpec,
  roots: readonly SecondHistoricalRootSpec[],
  familyFiles: readonly SecondHistoricalSourceFile[],
): SecondHistoricalFinancialPlan[] {
  const direction = secondHistoricalDirection(family);
  return familyFiles
    .filter(
      (file) =>
        !file.auxiliary &&
        (file.kind === "invoice" || file.kind === "settlement"),
    )
    .filter((file) => {
      if (file.amount == null || file.amount <= 0) {
        throw new Error(`财务原件金额不完整：${file.relativePath}`);
      }
      return ownsFinancialFile(root, roots, file.amount);
    })
    .map((source) => {
      if (!source.businessDate) {
        throw new Error(`财务原件业务日期不完整：${source.relativePath}`);
      }
      return {
        kind:
          source.kind === "invoice"
            ? "invoice"
            : direction === "income"
              ? "receipt"
              : "payment",
        source,
        amount: source.amount!,
        businessDate: source.businessDate,
        invoiceNo: source.kind === "invoice" ? invoiceNo(source) : null,
      } satisfies SecondHistoricalFinancialPlan;
    });
}

function sourceAssignment(
  file: SecondHistoricalSourceFile,
  rootKey: string,
  target: SecondHistoricalSourceAssignment["target"],
  accountingIncluded: boolean,
): SecondHistoricalSourceAssignment {
  return {
    relativePath: file.relativePath,
    hash: file.hash,
    familyId: file.familyId,
    rootKey,
    target,
    accountingIncluded,
  };
}

export async function buildSecondHistoricalImportPlan(
  sourceRoot: string,
): Promise<SecondHistoricalImportPlan> {
  const sourceFiles = await scanSecondHistoricalSource(sourceRoot);
  const totalBytes = sourceFiles.reduce((sum, file) => sum + file.bytes, 0);
  const currentManifestHash = manifestHash(sourceFiles);
  if (sourceFiles.length !== SECOND_HISTORICAL_IMPORT_EXPECTED_FILE_COUNT) {
    throw new Error(
      `源文件数量发生变化：应为${SECOND_HISTORICAL_IMPORT_EXPECTED_FILE_COUNT}，实际${sourceFiles.length}`,
    );
  }
  if (totalBytes !== SECOND_HISTORICAL_IMPORT_EXPECTED_TOTAL_BYTES) {
    throw new Error(
      `源文件总字节数发生变化：应为${SECOND_HISTORICAL_IMPORT_EXPECTED_TOTAL_BYTES}，实际${totalBytes}`,
    );
  }
  if (currentManifestHash !== SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH) {
    throw new Error(
      `源文件清单摘要发生变化：${currentManifestHash}，拒绝使用未复核内容导入`,
    );
  }

  const roots: SecondHistoricalRootPlan[] = [];
  for (const family of SECOND_HISTORICAL_IMPORT_FAMILIES) {
    const familyFiles = sourceFiles.filter(
      (file) => file.familyId === family.id,
    );
    if (!familyFiles.length) throw new Error(`合同族没有文件：${family.id}`);
    const specs = rootSpecs(family);
    for (const spec of specs.filter(
      (root) => secondHistoricalDeclaredMainTarget(root) === "sealed_contract",
    )) {
      const source = requireFile(familyFiles, spec.mainFileName);
      const contractDate =
        spec.contractDateOverride ||
        family.contractDateOverride ||
        source.businessDate;
      if (!contractDate)
        throw new Error(`主合同签订日期不完整：${source.relativePath}`);
      const initialAmount = family.target?.amount ?? source.amount;
      if (initialAmount == null || initialAmount <= 0) {
        throw new Error(`主合同金额或目标金额不完整：${source.relativePath}`);
      }
      const agreements = buildAgreements(
        spec,
        specs,
        familyFiles,
        initialAmount,
      );
      const currentAmount = agreements.at(-1)?.amountAfter ?? initialAmount;
      roots.push({
        key: `${family.id}:${spec.mainFileName}`,
        family,
        rootSpec: spec,
        source,
        projectName: spec.projectName || family.projectName,
        businessContractNo:
          spec.businessContractNo || family.businessContractNo || null,
        contractDate,
        originalAmount: family.target ? null : initialAmount,
        currentAmount,
        financialDirection: secondHistoricalDirection(family),
        agreements,
        financialFacts: buildFinancialFacts(family, spec, specs, familyFiles),
        archiveFiles: [],
        auxiliaryFiles: [],
        restoreContractId: family.restoreContractId || null,
      });
    }
    const familyRoots = roots.filter((root) => root.family.id === family.id);
    const canonicalRoot =
      familyRoots.find((root) => root.source.name === family.mainFileName) ||
      familyRoots[0];
    if (!canonicalRoot) throw new Error(`合同族未生成主合同：${family.id}`);
    canonicalRoot.archiveFiles.push(
      ...familyFiles.filter(
        (file) =>
          !file.auxiliary &&
          (file.kind === "void_invoice" || file.kind === "other"),
      ),
      ...specs
        .filter(
          (spec) => secondHistoricalDeclaredMainTarget(spec) === "archive",
        )
        .map((spec) => requireFile(familyFiles, spec.mainFileName)),
    );
    canonicalRoot.auxiliaryFiles.push(
      ...familyFiles.filter((file) => file.auxiliary),
      ...specs
        .filter(
          (spec) => secondHistoricalDeclaredMainTarget(spec) === "auxiliary",
        )
        .map((spec) => requireFile(familyFiles, spec.mainFileName)),
    );

    const invoiceAmount = familyRoots.reduce(
      (sum, root) =>
        sum +
        root.financialFacts
          .filter((fact) => fact.kind === "invoice")
          .reduce((itemSum, fact) => itemSum + cents(fact.amount), 0),
      0,
    );
    const settlementAmount = familyRoots.reduce(
      (sum, root) =>
        sum +
        root.financialFacts
          .filter((fact) => fact.kind !== "invoice")
          .reduce((itemSum, fact) => itemSum + cents(fact.amount), 0),
      0,
    );
    if (invoiceAmount !== cents(family.expectedInvoiceAmount)) {
      throw new Error(
        `${family.id}发票合计不一致：应为${family.expectedInvoiceAmount.toFixed(2)}，实际${(invoiceAmount / 100).toFixed(2)}`,
      );
    }
    if (settlementAmount !== cents(family.expectedSettlementAmount)) {
      throw new Error(
        `${family.id}回款或付款合计不一致：应为${family.expectedSettlementAmount.toFixed(2)}，实际${(settlementAmount / 100).toFixed(2)}`,
      );
    }
  }

  const assignments: SecondHistoricalSourceAssignment[] = [];
  for (const root of roots) {
    assignments.push(
      sourceAssignment(root.source, root.key, "sealed_contract", false),
    );
    assignments.push(
      ...root.agreements.map((agreement) =>
        sourceAssignment(agreement.source, root.key, "agreement", false),
      ),
      ...root.financialFacts.map((fact) =>
        sourceAssignment(fact.source, root.key, "financial", true),
      ),
      ...root.archiveFiles.map((file) =>
        sourceAssignment(file, root.key, "archive", false),
      ),
      ...root.auxiliaryFiles.map((file) =>
        sourceAssignment(file, root.key, "auxiliary", false),
      ),
    );
  }
  const assignedByPath = new Map<string, SecondHistoricalSourceAssignment[]>();
  for (const assignment of assignments) {
    const current = assignedByPath.get(assignment.relativePath) || [];
    current.push(assignment);
    assignedByPath.set(assignment.relativePath, current);
  }
  const missing = sourceFiles.filter(
    (file) => !assignedByPath.has(file.relativePath),
  );
  const duplicated = [...assignedByPath.entries()].filter(
    ([, items]) => items.length !== 1,
  );
  if (missing.length || duplicated.length) {
    throw new Error(
      `源文件归属不完整：遗漏${missing.length}份，重复${duplicated.length}份`,
    );
  }
  for (const [target, expectedCount] of Object.entries(
    SECOND_HISTORICAL_IMPORT_EXPECTED_ASSIGNMENT_COUNTS,
  )) {
    const actualCount = assignments.filter(
      (assignment) => assignment.target === target,
    ).length;
    if (actualCount !== expectedCount) {
      throw new Error(
        `${target}文件归属数量发生变化：应为${expectedCount}份，实际${actualCount}份`,
      );
    }
  }

  const financialFacts = roots.flatMap((root) => root.financialFacts);
  return {
    sourceRoot: path.resolve(sourceRoot),
    manifestHash: currentManifestHash,
    totalBytes,
    sourceFiles,
    roots,
    assignments,
    summary: {
      sourceFileCount: sourceFiles.length,
      rootContractCount: roots.length,
      restoredContractCount: roots.filter((root) => root.restoreContractId)
        .length,
      supplementCount: roots.reduce(
        (sum, root) =>
          sum +
          root.agreements.filter((item) => item.relationType === "supplement")
            .length,
        0,
      ),
      terminationCount: roots.reduce(
        (sum, root) =>
          sum +
          root.agreements.filter((item) => item.relationType === "termination")
            .length,
        0,
      ),
      invoiceCount: financialFacts.filter((fact) => fact.kind === "invoice")
        .length,
      receiptCount: financialFacts.filter((fact) => fact.kind === "receipt")
        .length,
      paymentCount: financialFacts.filter((fact) => fact.kind === "payment")
        .length,
      auxiliaryFileCount: roots.reduce(
        (sum, root) => sum + root.auxiliaryFiles.length,
        0,
      ),
      archiveFileCount: roots.reduce(
        (sum, root) => sum + root.archiveFiles.length,
        0,
      ),
      incomeContractCount: roots.filter(
        (root) => root.financialDirection === "income",
      ).length,
      costContractCount: roots.filter(
        (root) => root.financialDirection === "cost",
      ).length,
      invoiceAmount:
        financialFacts
          .filter((fact) => fact.kind === "invoice")
          .reduce((sum, fact) => sum + cents(fact.amount), 0) / 100,
      incomeSettlementAmount:
        financialFacts
          .filter((fact) => fact.kind === "receipt")
          .reduce((sum, fact) => sum + cents(fact.amount), 0) / 100,
      costSettlementAmount:
        financialFacts
          .filter((fact) => fact.kind === "payment")
          .reduce((sum, fact) => sum + cents(fact.amount), 0) / 100,
    },
  };
}
