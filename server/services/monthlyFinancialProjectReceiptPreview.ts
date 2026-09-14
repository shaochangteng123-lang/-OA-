import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import type { PoolClient } from "pg";
import {
  addFinancialAmounts,
  isValidFinancialDate,
} from "./monthlyFinancialReport.js";
import { listMonthlyFinancialTrendMonths } from "./monthlyFinancialTrend.js";
import { canReadMonthlyFinancialReport } from "../utils/monthly-financial-permissions.js";
import type { FinancialAnalysisProjectReceipt } from "../types/monthly-financial-analysis.js";

export interface ProjectReceiptFileMetadata {
  fileName: string | null;
  mimeType: string | null;
  available: boolean;
  reason: string | null;
  evidenceVersion: string;
}
interface CanonicalReceipt {
  id: string;
  current: boolean;
  fileActive: boolean;
  recognitionStatus: string;
  account: string;
  direction: string;
  date: string;
  amount: string;
  currency: string;
  path: string | null;
  name: string | null;
  allocation: string | null;
  linkedReceiptCount: number;
}
export interface ProjectReceiptFileRow {
  receiptId: string;
  rootContractId: string;
  contractId: string;
  date: string;
  amount: string;
  currency: string | null;
  status: string;
  updatedAt: string | null;
  bankName: string | null;
  electronicReceiptNo: string | null;
  proofNo: string | null;
  transactionSerialNo: string | null;
  rootCategory: string | null;
  rootStatus: string;
  rootEffectiveAt: string | null;
  rootDeleted: boolean;
  contractDeleted: boolean;
  contractStatus: string;
  fileId: string | null;
  fileContractId: string | null;
  fileRootId: string | null;
  fileOwnerDeleted: boolean | null;
  fileType: string | null;
  fileName: string | null;
  mimeType: string | null;
  filePath: string | null;
  canonical: CanonicalReceipt[];
  hadCanonical: boolean;
  duplicateEvidence: boolean;
}

/** 独立读取证据关系，不将文件或替换链接多行连接到金额来源，避免重复累计。 */
export const PROJECT_RECEIPT_FILES_SQL = `SELECT receipt.id AS "receiptId",
       root.id AS "rootContractId", receipt.contract_id AS "contractId",
       receipt.receipt_date AS date, receipt.amount::text AS amount, receipt.currency, receipt.status,
       receipt.updated_at AS "updatedAt", receipt.bank_name AS "bankName",
       receipt.electronic_receipt_no AS "electronicReceiptNo", receipt.proof_no AS "proofNo",
       receipt.transaction_serial_no AS "transactionSerialNo",
       COALESCE(root.category, root.declared_category) AS "rootCategory",
       root.status AS "rootStatus", root.effective_at AS "rootEffectiveAt",
       root.is_deleted AS "rootDeleted", contract.is_deleted AS "contractDeleted", contract.status AS "contractStatus",
       original.id AS "fileId", original.contract_id AS "fileContractId", COALESCE(file_owner.root_contract_id, file_owner.id) AS "fileRootId",
       file_owner.is_deleted AS "fileOwnerDeleted", original.file_type AS "fileType",
       original.file_name AS "fileName", original.mime_type AS "mimeType", original.file_path AS "filePath",
       COALESCE(canonical.items, '[]'::jsonb) AS canonical,
       EXISTS (SELECT 1 FROM monthly_financial_bank_transaction_links history_link
         WHERE history_link.business_object_type = 'contract_receipt' AND history_link.business_object_id = receipt.id
           AND history_link.link_kind = 'display_replacement') AS "hadCanonical",
       EXISTS (
         SELECT 1 FROM contract_receipts other
         JOIN contracts other_contract ON other_contract.id = other.contract_id
         JOIN contracts other_root ON other_root.id = COALESCE(other_contract.root_contract_id, other_contract.id)
         WHERE other.id <> receipt.id AND other.status = 'confirmed'
           AND other_contract.is_deleted = FALSE AND other_root.is_deleted = FALSE
           AND other_contract.status NOT IN ('draft', 'rejected') AND other_root.status NOT IN ('draft', 'rejected')
           AND COALESCE(other_root.category, other_root.declared_category) = 'main_business'
           AND NULLIF(BTRIM(receipt.bank_name), '') IS NOT NULL
           AND LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(other.bank_name), NFKC), '[[:space:]]+', '', 'g'))
             = LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(receipt.bank_name), NFKC), '[[:space:]]+', '', 'g'))
           AND ((NULLIF(BTRIM(receipt.electronic_receipt_no), '') IS NOT NULL
             AND UPPER(REGEXP_REPLACE(NORMALIZE(other.electronic_receipt_no, NFKC), '[^[:alnum:]]+', '', 'g'))
               = UPPER(REGEXP_REPLACE(NORMALIZE(receipt.electronic_receipt_no, NFKC), '[^[:alnum:]]+', '', 'g')))
             OR (NULLIF(BTRIM(receipt.transaction_serial_no), '') IS NOT NULL
             AND UPPER(REGEXP_REPLACE(NORMALIZE(other.transaction_serial_no, NFKC), '[^[:alnum:]]+', '', 'g'))
               = UPPER(REGEXP_REPLACE(NORMALIZE(receipt.transaction_serial_no, NFKC), '[^[:alnum:]]+', '', 'g')))
             OR (NULLIF(BTRIM(receipt.proof_no), '') IS NOT NULL
               AND UPPER(REGEXP_REPLACE(NORMALIZE(receipt.proof_no, NFKC), '[^[:alnum:]]+', '', 'g'))
                 <> COALESCE(UPPER(REGEXP_REPLACE(NORMALIZE(receipt.transaction_serial_no, NFKC), '[^[:alnum:]]+', '', 'g')), '')
               AND UPPER(REGEXP_REPLACE(NORMALIZE(other.proof_no, NFKC), '[^[:alnum:]]+', '', 'g'))
                 <> COALESCE(UPPER(REGEXP_REPLACE(NORMALIZE(other.transaction_serial_no, NFKC), '[^[:alnum:]]+', '', 'g')), '')
               AND UPPER(REGEXP_REPLACE(NORMALIZE(other.proof_no, NFKC), '[^[:alnum:]]+', '', 'g'))
                 = UPPER(REGEXP_REPLACE(NORMALIZE(receipt.proof_no, NFKC), '[^[:alnum:]]+', '', 'g'))))
       ) AS "duplicateEvidence"
  FROM contract_receipts receipt
  JOIN contracts contract ON contract.id = receipt.contract_id
  JOIN contracts root ON root.id = COALESCE(contract.root_contract_id, contract.id)
  LEFT JOIN contract_files original ON original.id = receipt.file_id
  LEFT JOIN contracts file_owner ON file_owner.id = original.contract_id
  LEFT JOIN LATERAL (
    SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'id', bank.id, 'current', bank.is_current, 'fileActive', bank_file.is_active, 'recognitionStatus', bank.recognition_status,
      'account', bank.account_code, 'direction', bank.direction, 'date', bank.transaction_date,
      'amount', bank.amount::text, 'currency', bank.currency, 'path', bank.crop_path,
      'name', bank_file.original_name, 'allocation', link.allocated_amount::text,
      'linkedReceiptCount', (SELECT COUNT(DISTINCT other_link.business_object_id)::int
        FROM monthly_financial_bank_transaction_links other_link
        WHERE other_link.transaction_id = bank.id AND other_link.business_object_type = 'contract_receipt'
          AND other_link.link_kind = 'display_replacement' AND other_link.match_status = 'active'
          AND other_link.is_active = TRUE)) ORDER BY link.id) AS items
    FROM monthly_financial_bank_transaction_links link
    LEFT JOIN monthly_financial_bank_transactions bank ON bank.id = link.transaction_id
    LEFT JOIN monthly_financial_bank_files bank_file ON bank_file.id = bank.current_file_id
    WHERE link.business_object_type = 'contract_receipt' AND link.business_object_id = receipt.id
      AND link.link_kind = 'display_replacement' AND link.match_status = 'active' AND link.is_active = TRUE
  ) canonical ON TRUE
 WHERE receipt.id = ANY($1::text[]) ORDER BY receipt.id`;

function sameAmount(left: string | null, right: string) {
  try {
    return (
      left !== null && addFinancialAmounts(left) === addFinancialAmounts(right)
    );
  } catch {
    return false;
  }
}
function safeFileName(value: string | null | undefined, fallback: string) {
  const name = path.posix.basename((value || fallback).replace(/\\/gu, "/"));
  return (
    [...name]
      .filter((character) => {
        const code = character.codePointAt(0)!;
        return code >= 32 && code !== 127;
      })
      .join("")
      .trim() || fallback
  );
}
function chooseFile(row: ProjectReceiptFileRow) {
  const unknown = (reason: string) =>
    ({
      kind: null,
      storagePath: null,
      fileName: null,
      mimeType: null,
      reason,
    }) as const;
  if (row.duplicateEvidence)
    return unknown("同银行回款凭证证据重复，请先核对后预览");
  const candidates = row.canonical || [];
  if (candidates.length) {
    const ids = new Set(candidates.map((item) => item.id));
    if (ids.size !== 1 || !candidates[0].id)
      return unknown("银行回单替换关系不唯一，未猜测对应文件");
    const valid = candidates.every(
      (item) =>
        item.current === true &&
        item.fileActive === true &&
        item.recognitionStatus === "recognized" &&
        item.account === "general" &&
        item.direction === "inflow" &&
        item.currency?.trim().toUpperCase() === "CNY" &&
        item.date === row.date &&
        sameAmount(item.amount, row.amount) &&
        (item.allocation === null || sameAmount(item.allocation, row.amount)) &&
        item.linkedReceiptCount === 1 &&
        Boolean(item.path),
    );
    if (!valid)
      return unknown("银行回单替换关系与当前回款金额、日期或归属不一致");
    return {
      kind: "canonical",
      storagePath: candidates[0].path,
      fileName:
        safeFileName(candidates[0].name, "银行回单").replace(/\.[^.]+$/u, "") +
        "-回单裁片.jpg",
      mimeType: "image/jpeg",
      reason: null,
    } as const;
  }
  if (row.hadCanonical)
    return unknown("既有银行回单替换关系已失效或冲突，未回退另一张原件");
  if (!row.fileId || !row.filePath)
    return unknown("未提供可用的回款银行回单文件");
  if (
    row.fileContractId !== row.contractId ||
    row.fileRootId !== row.rootContractId ||
    row.fileOwnerDeleted !== false ||
    row.fileType !== "receipt"
  )
    return unknown(
      "原回款文件不属于该回款明确关联的合同及根链，未猜测关联文件",
    );
  if (
    !["application/pdf", "image/jpeg", "image/png"].includes(row.mimeType || "")
  )
    return unknown("回款文件不是可安全内联预览的银行回单格式");
  return {
    kind: "contract",
    storagePath: row.filePath,
    fileName: safeFileName(row.fileName, "回款银行回单"),
    mimeType: row.mimeType,
    reason: null,
  } as const;
}
function evidenceVersion(row: ProjectReceiptFileRow) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.receiptId,
        row.rootContractId,
        row.date,
        row.amount,
        row.currency,
        row.status,
        row.updatedAt,
        row.fileId,
        row.fileContractId,
        row.filePath,
        row.fileRootId,
        row.fileOwnerDeleted,
        row.fileType,
        row.fileName,
        row.mimeType,
        row.canonical,
        row.hadCanonical,
        row.duplicateEvidence,
      ]),
    )
    .digest("hex");
}
export async function loadProjectReceiptFileMetadata(
  client: Pick<PoolClient, "query">,
  ids: string[],
): Promise<Map<string, ProjectReceiptFileMetadata>> {
  if (!ids.length) return new Map();
  const result = await client.query<ProjectReceiptFileRow>(
    PROJECT_RECEIPT_FILES_SQL,
    [[...new Set(ids)]],
  );
  const rows = new Map<string, ProjectReceiptFileMetadata>();
  for (const row of result.rows) {
    if (!row.receiptId) continue;
    const file = chooseFile(row);
    rows.set(row.receiptId, {
      fileName: file.fileName,
      mimeType: file.mimeType,
      available: !file.reason,
      reason: file.reason,
      evidenceVersion: evidenceVersion(row),
    });
  }
  return rows;
}
export function originalProjectNumber(
  value: string | null | undefined,
): string | null {
  const number = value?.trim();
  return number && !["-", "—", "待识别", "未识别"].includes(number)
    ? number
    : null;
}
function reference(value: string | null | undefined) {
  return originalProjectNumber(value);
}
function comparable(value: string | null | undefined) {
  return (
    value
      ?.normalize("NFKC")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .toUpperCase() || ""
  );
}
export function realReceiptNumber(input: {
  electronicReceiptNo?: string | null;
  proofNo?: string | null;
  transactionSerialNo?: string | null;
}): Pick<
  FinancialAnalysisProjectReceipt,
  "receiptNumber" | "receiptNumberSource" | "transactionSerialNo"
> {
  const electronic = reference(input.electronicReceiptNo);
  const proof = reference(input.proofNo);
  const transaction = reference(input.transactionSerialNo);
  if (electronic)
    return {
      receiptNumber: electronic,
      receiptNumberSource: "electronic_receipt_no",
      transactionSerialNo: transaction,
    };
  // 旧写入流程可能把交易流水号复制到通用凭证号，不能换名冒充银行回单号。
  if (proof && (!transaction || comparable(proof) !== comparable(transaction)))
    return {
      receiptNumber: proof,
      receiptNumberSource: "proof_no",
      transactionSerialNo: transaction,
    };
  return {
    receiptNumber: null,
    receiptNumberSource: null,
    transactionSerialNo: transaction,
  };
}
export function projectReceiptPreviewUrl(
  root: string,
  receipt: string,
  from: string,
  to: string,
  file?: ProjectReceiptFileMetadata,
): string | null {
  return file?.available
    ? `/api/monthly-financial-reports/analysis/projects/${encodeURIComponent(root)}/receipts/${encodeURIComponent(receipt)}/preview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&evidenceVersion=${file.evidenceVersion}`
    : null;
}

export function projectReceiptPreviewUnavailableReason(input: {
  fileMetadata?: ProjectReceiptFileMetadata;
  currency?: string | null;
  historicalConfirmedAmount?: boolean;
  verifiedLegacyCnyAmount?: boolean;
}): string | null {
  if (input.fileMetadata?.reason) return input.fileMetadata.reason;
  if (input.fileMetadata?.available) return null;
  if (!input.currency?.trim() && input.verifiedLegacyCnyAmount === true)
    return "银行回单已上传并完成核验，但旧记录未保存人民币币种；为避免误判币种，暂不提供原件预览";
  if (input.historicalConfirmedAmount === true)
    return "历史确认台账记录；尚无可独立核验的银行回单预览";
  return "未提供可用的回款银行回单文件";
}

export class ProjectReceiptPreviewError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProjectReceiptPreviewError";
  }
}
export function projectReceiptBusinessDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)!.value)
    .join("-");
}
export async function prepareProjectReceiptPreview(input: {
  client: Pick<PoolClient, "query">;
  actorId: string;
  rootContractId: string;
  receiptId: string;
  from: unknown;
  to: unknown;
  evidenceVersion: unknown;
  now?: Date;
  workspaceRoot?: string;
}): Promise<{ absolutePath: string; fileName: string; mimeType: string }> {
  if (
    typeof input.from !== "string" ||
    typeof input.to !== "string" ||
    typeof input.evidenceVersion !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.evidenceVersion)
  )
    throw new ProjectReceiptPreviewError(400, "回款预览期间或证据版本无效");
  try {
    listMonthlyFinancialTrendMonths(input.from, input.to);
  } catch {
    throw new ProjectReceiptPreviewError(400, "回款预览期间无效");
  }
  const actor = await input.client.query<{ role: string; status: string }>(
    "SELECT role, status FROM users WHERE id = $1",
    [input.actorId],
  );
  if (
    actor.rows[0]?.status !== "active" ||
    !canReadMonthlyFinancialReport(actor.rows[0]?.role)
  )
    throw new ProjectReceiptPreviewError(403, "当前账号无权查看财务回款凭证");
  const result = await input.client.query<ProjectReceiptFileRow>(
    PROJECT_RECEIPT_FILES_SQL,
    [[input.receiptId]],
  );
  const row = result.rows[0];
  const today = projectReceiptBusinessDate(input.now || new Date());
  if (
    result.rows.length !== 1 ||
    !row ||
    row.receiptId !== input.receiptId ||
    row.rootContractId !== input.rootContractId ||
    row.status !== "confirmed" ||
    row.rootDeleted !== false ||
    row.contractDeleted !== false ||
    row.rootCategory !== "main_business" ||
    ["draft", "rejected"].includes(row.rootStatus) ||
    ["draft", "rejected"].includes(row.contractStatus) ||
    (!row.rootEffectiveAt &&
      !["effective", "executing", "completed", "terminated"].includes(
        row.rootStatus,
      )) ||
    row.currency?.trim().toUpperCase() !== "CNY" ||
    !isValidFinancialDate(row.date) ||
    row.date > today ||
    row.date.slice(0, 7) < input.from ||
    row.date.slice(0, 7) > input.to ||
    input.to > today.slice(0, 7)
  )
    throw new ProjectReceiptPreviewError(
      404,
      "该项目期间没有可预览的当前有效回款凭证",
    );
  if (evidenceVersion(row) !== input.evidenceVersion)
    throw new ProjectReceiptPreviewError(
      409,
      "回款凭证已变化，请刷新分析后重新预览",
    );
  const file = chooseFile(row);
  if (file.reason || !file.storagePath || !file.mimeType)
    throw new ProjectReceiptPreviewError(409, file.reason || "回款凭证不可用");
  const cwd = input.workspaceRoot || process.cwd();
  const allowedRoot = path.resolve(
    cwd,
    "uploads",
    file.kind === "canonical" ? "monthly-financial-bank" : "contracts",
  );
  const selected = path.resolve(cwd, file.storagePath);
  if (!selected.startsWith(allowedRoot + path.sep))
    throw new ProjectReceiptPreviewError(403, "回款文件路径不在对应受控目录内");
  try {
    const [realRoot, realFile] = await Promise.all([
      fs.realpath(allowedRoot),
      fs.realpath(selected),
    ]);
    if (!realFile.startsWith(realRoot + path.sep))
      throw new ProjectReceiptPreviewError(403, "回款文件真实路径不安全");
    const stat = await fs.stat(realFile);
    if (!stat.isFile() || stat.size <= 0)
      throw new ProjectReceiptPreviewError(404, "回款文件不存在或为空");
    const handle = await fs.open(realFile, "r");
    const header = Buffer.alloc(8);
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    const actual =
      header.subarray(0, 5).toString("ascii") === "%PDF-"
        ? "application/pdf"
        : header.subarray(0, 3).toString("hex") === "ffd8ff"
          ? "image/jpeg"
          : header.toString("hex") === "89504e470d0a1a0a"
            ? "image/png"
            : null;
    if (actual !== file.mimeType)
      throw new ProjectReceiptPreviewError(
        403,
        "回款文件真实格式与证据类型不一致",
      );
    return {
      absolutePath: realFile,
      fileName: file.fileName || "回款银行回单",
      mimeType: file.mimeType,
    };
  } catch (error) {
    if (error instanceof ProjectReceiptPreviewError) throw error;
    throw new ProjectReceiptPreviewError(
      404,
      "回款文件不可用，请联系管理员核对凭证",
    );
  }
}
