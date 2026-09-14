#!/usr/bin/env tsx

/**
 * 第二批历史合同银行回单只读识别审计。
 *
 * 约束：
 * - 只读取源目录，不连接数据库；
 * - 仅识别导入计划中非“附件”目录的正式回款／付款回单；
 * - 每处理一份即原子写入检查点，进程中断后可继续；
 * - 文件名金额和日期只用于一致性核验，绝不作为识别字段兜底。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  callPaddleOcrDetailed,
  shutdownOcrDaemon,
} from "../services/ocrDaemon.js";
import {
  extractPaymentProofPartyAccounts,
  parsePaymentProofText,
} from "../services/paymentProofOcr.js";
import { recognizeContractFinancialDocument } from "../services/contractFinancialOcr.js";
import { buildSecondHistoricalImportPlan } from "./second-historical-import-plan.js";

const INTERNAL_COMPANY = "北京羽隶工程咨询有限公司";
const DEFAULT_SOURCE_ROOT = "/Users/yuli/Desktop/导入系统的合同（2）";
const DEFAULT_OUTPUT = path.resolve(
  process.cwd(),
  "debug/second-historical-import-20260910/receipt-ocr.json",
);

type ReceiptDirection = "receipt" | "payment";

interface AuditRecord {
  familyId: string;
  projectName: string;
  direction: ReceiptDirection;
  relativePath: string;
  absolutePath: string;
  fileName: string;
  sha256: string;
  expected: {
    amount: number;
    transactionDate: string;
    plannedTransactionDate?: string;
    payerCandidates: string[];
    payeeCandidates: string[];
    contractParties: string[];
  };
  recognition: {
    status: "recognized" | "failed";
    modelVersion: string | null;
    lineCount: number;
    averageConfidence: number | null;
    payer: string;
    payerAccount: string;
    payee: string;
    payeeAccount: string;
    electronicReceiptNo: string;
    transactionSerialNo: string;
    transactionDate: string;
    transactionDateCandidates: string[];
    amount: number;
    rawTextSha256: string | null;
    rawText: string | null;
    error: string | null;
    recoveryNotes?: string[];
  };
  consistency: {
    amountMatchesFileName: boolean | null;
    dateMatchesFileName: boolean | null;
    payerMatchesContract: boolean | null;
    payeeMatchesContract: boolean | null;
    directionMatchesContract: boolean | null;
    requiredFieldsComplete: boolean;
    conflicts: string[];
  };
  auditedAt: string;
}

interface AuditDocument {
  schemaVersion: 1;
  generatedAt: string;
  sourceRoot: string;
  sourceManifestHash: string;
  expectedReceiptCount: number;
  records: AuditRecord[];
  summary: {
    total: number;
    recognized: number;
    failed: number;
    requiredFieldsComplete: number;
    amountMatches: number;
    amountConflicts: number;
    dateMatches: number;
    dateConflicts: number;
    directionMatches: number;
    directionConflicts: number;
    recordsWithAnyConflict: number;
    fieldCoverage: Record<string, { count: number; percent: number }>;
  };
}

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ? path.resolve(value) : fallback;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function normalizeParty(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s·•,，。；;：:()（）【】《》<>“”'‘’]/gu, "")
    .split("[")
    .join("")
    .split("]")
    .join("")
    .replace(/有限责任公司$/u, "有限公司")
    .toLowerCase();
}

function partyMatches(actual: string, candidates: readonly string[]): boolean {
  const normalizedActual = normalizeParty(actual);
  if (!normalizedActual) return false;
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeParty(candidate);
    if (!normalizedCandidate) return false;
    if (normalizedActual === normalizedCandidate) return true;
    const shorter =
      normalizedActual.length <= normalizedCandidate.length
        ? normalizedActual
        : normalizedCandidate;
    return (
      shorter.length >= 6 &&
      (normalizedActual.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedActual))
    );
  });
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

function extractExplicitValue(
  text: string,
  labels: readonly string[],
  valuePattern: string,
): string {
  for (const label of labels) {
    const match = text
      .normalize("NFKC")
      .match(new RegExp(`${label}\\s*[：:]\\s*(${valuePattern})`, "u"));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

function extractExplicitPartyName(
  text: string,
  role: "付款" | "收款",
): string {
  return extractExplicitValue(
    text,
    [`${role}名称`, `${role}户名`, `${role}人`, `${role}方`],
    "[^\\n\\r|]{2,100}",
  );
}

function extractExplicitAccount(
  text: string,
  role: "付款" | "收款",
): string {
  return extractExplicitValue(
    text,
    [`${role}账号`, `${role}账户`],
    "[0-9][0-9 \\t-]{5,30}",
  ).replace(/\D/gu, "");
}

function extractExplicitReceiptNo(text: string): string {
  return extractExplicitValue(
    text,
    ["电子回单号码", "电子回单号", "回单号码", "回单编号"],
    "[A-Za-z0-9][A-Za-z0-9-]{3,39}",
  );
}

function extractExplicitTransactionSerial(text: string): string {
  return extractExplicitValue(
    text,
    ["网银交易流水号", "交易流水号", "业务流水号", "指令序号", "序号"],
    "[A-Za-z0-9][A-Za-z0-9-]{3,39}",
  );
}

function extractRoleBlockAccount(
  text: string,
  role: "付款" | "收款",
): string {
  const lines = text
    .split(/\r?\n/gu)
    .map((line) => line.normalize("NFKC").trim())
    .filter(Boolean);
  const roleIndex = lines.findIndex((line) =>
    new RegExp(`^${role}(?:人|方)?$`, "u").test(line),
  );
  if (roleIndex < 0) return "";
  const otherRole = role === "付款" ? "收款" : "付款";
  for (
    let index = roleIndex + 1;
    index < Math.min(lines.length, roleIndex + 8);
    index += 1
  ) {
    const line = lines[index]!;
    if (new RegExp(`^${otherRole}(?:人|方)?$`, "u").test(line)) break;
    const account = line.replace(/\D/gu, "");
    if (account.length >= 6 && account.length <= 25) return account;
  }
  return "";
}

function extractOperationalDate(text: string): string {
  const lines = text
    .split(/\r?\n/gu)
    .map((line) => line.normalize("NFKC").trim())
    .filter(Boolean);
  for (const label of ["交易日期", "交易时间", "时间戳", "录入时间"]) {
    const labelIndex = lines.findIndex((line) => line.includes(label));
    if (labelIndex < 0) continue;
    const nearby = lines
      .slice(labelIndex, Math.min(lines.length, labelIndex + 6))
      .join("\n");
    const match = nearby.match(
      /(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/u,
    );
    if (!match) continue;
    const candidate = `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
    const parsed = new Date(`${candidate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate) {
      return candidate;
    }
  }
  return "";
}

const MANUAL_VISUAL_CONFIRMATIONS: Readonly<
  Record<
    string,
    Partial<{
      payer: string;
      payerAccount: string;
      payee: string;
      payeeAccount: string;
      electronicReceiptNo: string;
      transactionSerialNo: string;
      transactionDate: string;
      amount: number;
      note: string;
    }>
  >
> = {
  "主营项目合同/海淀区/创新园110千伏变电站房屋质量检测及安全鉴定/北京市建设工程质量第一检测所有限责任公司/3-回单-20241208￥139150.png": {
    payer: "北京市建设工程质量第一检测所有限责任公司",
    note: "原件付款人名称分成“北京市建设工程质量第一检测所有限”和“责任公司”两行，按票面完整拼接",
  },
  "主营项目合同/海淀区/东小营110千伏变电站等5项结构检测及鉴定项目/3-回单-20241231￥250000.png": {
    payer: "北京市建设工程质量第一检测所有限责任公司",
    note: "原件付款人名称分成“北京市建设工程质量第一检测所有限”和“责任公司”两行，按票面完整拼接",
  },
  "资产类合同/宝湾全球高端贸易供应链示范基地项目施工图预审查-璞拾著境（北京）空间工程设计有限公司/3-电子回单-20230601￥180000.png": {
    payee: "璞拾著境（北京）空间工程设计有限公司",
    note: "原件收款人名称跨越表格标签换行，按票面完整拼接",
  },
  "资产类合同/北京筑联天合建筑设计咨询有限公司/3-回单-20221128￥101636.pdf": {
    payer: INTERNAL_COMPANY,
    payerAccount: "0200049609201258271",
    payee: "北京筑联天合建筑设计咨询有限公司",
    payeeAccount: "0200212509200032240",
    transactionDate: "2022-11-28",
    amount: 101_636,
    note: "第一页原件经600 DPI（每英寸点数）人工视觉复核；回单号码区域受页面卷曲和失焦影响仍不可辨认",
  },
  "资产类合同/创新园110千伏变电站房屋质量检测及安全鉴定/北京博霖翔皓消防科技有限公司/3-回单-20240123￥8000.png": {
    payer: INTERNAL_COMPANY,
    payerAccount: "0200303519000018418",
    payee: "北京博霖翔皓消防科技有限公司",
    payeeAccount: "0203020103000031913",
    electronicReceiptNo: "0068-0868-3192-1100",
    transactionSerialNo: "47903683",
    transactionDate: "2024-01-23",
    amount: 8_000,
    note: "清晰原图经人工视觉复核，修正网格线导致的账号漏识别和备注手机号误取",
  },
  "资产类合同/万方安和项目/1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）图纸资料整理事项-璞拾著境√/3-回单-20261013￥100000.png": {
    payee: "璞拾著境（北京）空间工程设计有限公司",
    note: "原件收款人名称跨行，按票面完整拼接；文件名年份与票面年份另行保留冲突",
  },
};

const FORCE_RECHECK_PATHS = new Set([
  "资产类合同/万方安和项目/1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）图纸资料整理事项-璞拾著境√/3-回单-20261013￥100000.png",
]);

function amountFromFileName(fileName: string): number {
  const matches = [
    ...fileName.normalize("NFKC").matchAll(/[￥¥](-?\d+(?:\.\d{1,2})?)/gu),
  ];
  const value = Number(matches.at(-1)?.[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`回单文件名未包含金额：${fileName}`);
  }
  return value;
}

function dateFromFileName(fileName: string): string {
  const match = fileName.normalize("NFKC").match(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/u);
  if (!match) throw new Error(`回单文件名未包含日期：${fileName}`);
  const value = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`回单文件名日期无效：${fileName}`);
  }
  return value;
}

function percent(count: number, total: number): number {
  return total ? Math.round((count / total) * 10_000) / 100 : 0;
}

function summarize(
  records: readonly AuditRecord[],
): AuditDocument["summary"] {
  const recognized = records.filter(
    (record) => record.recognition.status === "recognized",
  );
  const fields: Record<string, (record: AuditRecord) => boolean> = {
    payer: (record) => Boolean(record.recognition.payer),
    payerAccount: (record) => Boolean(record.recognition.payerAccount),
    payee: (record) => Boolean(record.recognition.payee),
    payeeAccount: (record) => Boolean(record.recognition.payeeAccount),
    electronicReceiptNo: (record) =>
      Boolean(record.recognition.electronicReceiptNo),
    transactionSerialNo: (record) =>
      Boolean(record.recognition.transactionSerialNo),
    transactionDate: (record) => Boolean(record.recognition.transactionDate),
    amount: (record) => record.recognition.amount > 0,
  };
  return {
    total: records.length,
    recognized: recognized.length,
    failed: records.length - recognized.length,
    requiredFieldsComplete: records.filter(
      (record) => record.consistency.requiredFieldsComplete,
    ).length,
    amountMatches: records.filter(
      (record) => record.consistency.amountMatchesFileName === true,
    ).length,
    amountConflicts: records.filter(
      (record) => record.consistency.amountMatchesFileName === false,
    ).length,
    dateMatches: records.filter(
      (record) => record.consistency.dateMatchesFileName === true,
    ).length,
    dateConflicts: records.filter(
      (record) => record.consistency.dateMatchesFileName === false,
    ).length,
    directionMatches: records.filter(
      (record) => record.consistency.directionMatchesContract === true,
    ).length,
    directionConflicts: records.filter(
      (record) => record.consistency.directionMatchesContract === false,
    ).length,
    recordsWithAnyConflict: records.filter(
      (record) => record.consistency.conflicts.length > 0,
    ).length,
    fieldCoverage: Object.fromEntries(
      Object.entries(fields).map(([field, present]) => {
        const count = records.filter(present).length;
        return [field, { count, percent: percent(count, records.length) }];
      }),
    ),
  };
}

async function writeOutput(
  outputPath: string,
  document: Omit<AuditDocument, "generatedAt" | "summary">,
): Promise<void> {
  const completed: AuditDocument = {
    ...document,
    generatedAt: new Date().toISOString(),
    summary: summarize(document.records),
  };
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await fs.promises.writeFile(
    temporaryPath,
    `${JSON.stringify(completed, null, 2)}\n`,
    "utf8",
  );
  await fs.promises.rename(temporaryPath, outputPath);
}

async function readPrevious(outputPath: string): Promise<AuditDocument | null> {
  try {
    return JSON.parse(
      await fs.promises.readFile(outputPath, "utf8"),
    ) as AuditDocument;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const sourceRoot = argument("--source", DEFAULT_SOURCE_ROOT);
  const outputPath = argument("--output", DEFAULT_OUTPUT);
  const plan = await buildSecondHistoricalImportPlan(sourceRoot);
  const jobs = plan.roots.flatMap((root) => {
    const contractParties = unique([
      root.family.partyA,
      root.family.partyB,
      root.family.partyC,
    ]);
    const internalParty = contractParties.filter(
      (party) => normalizeParty(party) === normalizeParty(INTERNAL_COMPANY),
    );
    const externalParties = contractParties.filter(
      (party) => normalizeParty(party) !== normalizeParty(INTERNAL_COMPANY),
    );
    return root.financialFacts
      .filter(
        (fact): fact is typeof fact & { kind: ReceiptDirection } =>
          fact.kind === "receipt" || fact.kind === "payment",
      )
      .map((fact) => ({
        root,
        fact,
        contractParties,
        payerCandidates:
          fact.kind === "receipt" ? externalParties : internalParty,
        payeeCandidates:
          fact.kind === "receipt" ? internalParty : externalParties,
        fileNameAmount: amountFromFileName(fact.source.name),
        fileNameTransactionDate: dateFromFileName(fact.source.name),
      }));
  });
  if (jobs.length !== 97) {
    throw new Error(`正式回单数量应为97份，实际为${jobs.length}份`);
  }

  const previous = await readPrevious(outputPath);
  const reusable = new Map(
    previous?.sourceManifestHash === plan.manifestHash
      ? previous.records
          .filter(
            (record) =>
              record.recognition.status === "recognized" &&
              !FORCE_RECHECK_PATHS.has(record.relativePath),
          )
          .map((record) => [`${record.relativePath}\0${record.sha256}`, record])
      : [],
  );
  const records: AuditRecord[] = [];
  const baseDocument = {
    schemaVersion: 1 as const,
    sourceRoot,
    sourceManifestHash: plan.manifestHash,
    expectedReceiptCount: jobs.length,
    records,
  };

  for (const [index, job] of jobs.entries()) {
    const source = job.fact.source;
    const reuseKey = `${source.relativePath}\0${source.hash}`;
    const prior = reusable.get(reuseKey);
    if (prior) {
      records.push(prior);
      console.log(`[${index + 1}/${jobs.length}] 复用：${source.relativePath}`);
      continue;
    }

    console.log(`[${index + 1}/${jobs.length}] 识别：${source.relativePath}`);
    let record: AuditRecord;
    try {
      const detailed = await callPaddleOcrDetailed(
        source.absolutePath,
        "v6_medium",
      );
      const rawText =
        detailed.fullText || detailed.lines.map((line) => line.text).join("\n");
      const parsed = parsePaymentProofText(rawText);
      const accounts = extractPaymentProofPartyAccounts(rawText);
      let payer = extractExplicitPartyName(rawText, "付款") || parsed.payer;
      let payerAccount =
        extractExplicitAccount(rawText, "付款") ||
        extractRoleBlockAccount(rawText, "付款") ||
        accounts.payerAccount;
      let payee = extractExplicitPartyName(rawText, "收款") || parsed.payee;
      let payeeAccount =
        extractExplicitAccount(rawText, "收款") ||
        extractRoleBlockAccount(rawText, "收款") ||
        accounts.payeeAccount ||
        parsed.payeeAccount;
      let electronicReceiptNo =
        extractExplicitReceiptNo(rawText) || parsed.electronicReceiptNo;
      let transactionSerialNo =
        extractExplicitTransactionSerial(rawText) ||
        parsed.transactionSerialNo;
      let transactionDate = parsed.transactionDate;
      let transactionDateCandidates = parsed.transactionDateCandidates;
      let amount = parsed.amount;
      const recoveryNotes: string[] = [];

      const shouldRunStructuredPass =
        !payer ||
        !payerAccount ||
        !payee ||
        !payeeAccount ||
        !electronicReceiptNo ||
        !transactionDate ||
        amount <= 0 ||
        !partyMatches(payer, job.payerCandidates) ||
        !partyMatches(payee, job.payeeCandidates) ||
        cents(amount) !== cents(job.fileNameAmount) ||
        transactionDate !== job.fileNameTransactionDate;
      if (shouldRunStructuredPass) {
        const structured = await recognizeContractFinancialDocument({
          filePath: source.absolutePath,
          kind: "bank_receipt",
          context: {
            companyNames: [INTERNAL_COMPANY],
            contractCompanySubject: { name: INTERNAL_COMPANY },
          },
        });
        if (structured.kind === "bank_receipt") {
          payer = structured.fields.payer || payer;
          payerAccount = structured.fields.payerAccount || payerAccount;
          payee = structured.fields.payee || payee;
          payeeAccount = structured.fields.payeeAccount || payeeAccount;
          electronicReceiptNo =
            structured.fields.electronicReceiptNo || electronicReceiptNo;
          transactionDate = structured.fields.paymentTime || transactionDate;
          if (
            transactionDate &&
            !transactionDateCandidates.includes(transactionDate)
          ) {
            transactionDateCandidates = [
              ...transactionDateCandidates,
              transactionDate,
            ].sort();
          }
          amount = structured.fields.amount || amount;
        }
      }

      // 第二通道不返回交易流水号；只从原件的明确标签恢复，不使用文件名。
      transactionSerialNo =
        extractExplicitTransactionSerial(rawText) || transactionSerialNo;
      electronicReceiptNo =
        extractExplicitReceiptNo(rawText) || electronicReceiptNo;

      if (!transactionDate) {
        const recoveredDate = extractOperationalDate(rawText);
        if (recoveredDate) {
          transactionDate = recoveredDate;
          if (!transactionDateCandidates.includes(recoveredDate)) {
            transactionDateCandidates = [
              ...transactionDateCandidates,
              recoveredDate,
            ].sort();
          }
          recoveryNotes.push("从原件明确交易／时间戳／录入时间标签附近恢复交易日期");
        }
      }

      const manual = MANUAL_VISUAL_CONFIRMATIONS[source.relativePath];
      if (manual) {
        payer = manual.payer || payer;
        payerAccount = manual.payerAccount || payerAccount;
        payee = manual.payee || payee;
        payeeAccount = manual.payeeAccount || payeeAccount;
        electronicReceiptNo =
          manual.electronicReceiptNo || electronicReceiptNo;
        transactionSerialNo =
          manual.transactionSerialNo || transactionSerialNo;
        transactionDate = manual.transactionDate || transactionDate;
        amount = manual.amount || amount;
        if (manual.note) recoveryNotes.push(manual.note);
      }

      const payerMatch = partyMatches(payer, job.payerCandidates);
      const payeeMatch = partyMatches(payee, job.payeeCandidates);
      const directionMatch = payerMatch && payeeMatch;
      const amountMatch = cents(amount) === cents(job.fileNameAmount);
      const dateMatch = transactionDate === job.fileNameTransactionDate;
      const conflicts: string[] = [];
      if (!amountMatch) {
        conflicts.push(
          `回单正文金额${amount.toFixed(2)}与文件名金额${job.fileNameAmount.toFixed(2)}不一致`,
        );
      }
      if (!dateMatch) {
        conflicts.push(
          `回单正文交易日期${transactionDate || "未识别"}与文件名日期${job.fileNameTransactionDate}不一致`,
        );
      }
      if (!payerMatch) {
        conflicts.push(
          `付款人${payer || "未识别"}未匹配合同方向候选${job.payerCandidates.join("、") || "无"}`,
        );
      }
      if (!payeeMatch) {
        conflicts.push(
          `收款人${payee || "未识别"}未匹配合同方向候选${job.payeeCandidates.join("、") || "无"}`,
        );
      }
      if (transactionDateCandidates.length > 1) {
        conflicts.push(
          `正文存在多个交易日期候选：${transactionDateCandidates.join("、")}`,
        );
      }
      const requiredFieldsComplete = Boolean(
        payer &&
          payerAccount &&
          payee &&
          payeeAccount &&
          electronicReceiptNo &&
          transactionDate &&
          amount > 0,
      );
      if (!requiredFieldsComplete) {
        conflicts.push("自动入账必需字段不完整");
      }
      const confidences = detailed.lines
        .map((line) => Number(line.confidence))
        .filter(Number.isFinite);
      record = {
        familyId: job.root.family.id,
        projectName: job.root.projectName,
        direction: job.fact.kind,
        relativePath: source.relativePath,
        absolutePath: source.absolutePath,
        fileName: source.name,
        sha256: source.hash,
        expected: {
          amount: job.fileNameAmount,
          transactionDate: job.fileNameTransactionDate,
          plannedTransactionDate: job.fact.businessDate,
          payerCandidates: job.payerCandidates,
          payeeCandidates: job.payeeCandidates,
          contractParties: job.contractParties,
        },
        recognition: {
          status: "recognized",
          modelVersion: detailed.modelVersion,
          lineCount: detailed.lines.length,
          averageConfidence: confidences.length
            ? Math.round(
                (confidences.reduce((sum, value) => sum + value, 0) /
                  confidences.length) *
                  100,
              ) / 100
            : null,
          payer,
          payerAccount,
          payee,
          payeeAccount,
          electronicReceiptNo,
          transactionSerialNo,
          transactionDate,
          transactionDateCandidates,
          amount,
          rawTextSha256: crypto.createHash("sha256").update(rawText).digest("hex"),
          rawText,
          error: null,
          recoveryNotes,
        },
        consistency: {
          amountMatchesFileName: amountMatch,
          dateMatchesFileName: dateMatch,
          payerMatchesContract: payerMatch,
          payeeMatchesContract: payeeMatch,
          directionMatchesContract: directionMatch,
          requiredFieldsComplete,
          conflicts,
        },
        auditedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record = {
        familyId: job.root.family.id,
        projectName: job.root.projectName,
        direction: job.fact.kind,
        relativePath: source.relativePath,
        absolutePath: source.absolutePath,
        fileName: source.name,
        sha256: source.hash,
        expected: {
          amount: job.fileNameAmount,
          transactionDate: job.fileNameTransactionDate,
          plannedTransactionDate: job.fact.businessDate,
          payerCandidates: job.payerCandidates,
          payeeCandidates: job.payeeCandidates,
          contractParties: job.contractParties,
        },
        recognition: {
          status: "failed",
          modelVersion: null,
          lineCount: 0,
          averageConfidence: null,
          payer: "",
          payerAccount: "",
          payee: "",
          payeeAccount: "",
          electronicReceiptNo: "",
          transactionSerialNo: "",
          transactionDate: "",
          transactionDateCandidates: [],
          amount: 0,
          rawTextSha256: null,
          rawText: null,
          error: message,
          recoveryNotes: [],
        },
        consistency: {
          amountMatchesFileName: null,
          dateMatchesFileName: null,
          payerMatchesContract: null,
          payeeMatchesContract: null,
          directionMatchesContract: null,
          requiredFieldsComplete: false,
          conflicts: [`OCR识别失败：${message}`],
        },
        auditedAt: new Date().toISOString(),
      };
    }
    records.push(record);
    await writeOutput(outputPath, baseDocument);
  }

  await writeOutput(outputPath, baseDocument);
  console.log(`完成：${outputPath}`);
  console.log(JSON.stringify(summarize(records), null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => shutdownOcrDaemon());
