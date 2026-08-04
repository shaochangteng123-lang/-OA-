import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { requireAdmin } from "../middleware/auth.js";
import { recognizeHumanCostReceipt } from "../services/humanCostReceiptOcr.js";
import { recognizePayrollTaxDetail } from "../services/payrollTaxDetailOcr.js";
import {
  calculateAutomaticMonthlySalary,
  calculatePayrollBreakdown,
  calculatePayrollTotals,
  comparePayrollAmounts,
  formatPayrollAmount,
  getPayrollMonthRange,
  normalizePayrollAmount,
  type PayrollAmountField,
} from "../services/payrollCalculator.js";
import {
  ensureDatedUploadDirectory,
  toStoredUploadPath,
} from "../utils/upload-date.js";
import { normalizeUploadFileName } from "../utils/upload-file-name.js";
import { isEmployeeIncludedInPayrollPeriod } from "../utils/payroll-membership.js";
import {
  matchPayrollReceiptEmployee,
  type PayrollReceiptEmployeeIdentity,
} from "../utils/payroll-receipt-match.js";
import {
  getPreviousPayrollMonth,
  resolvePayrollMonthDefaults,
} from "../utils/payroll-month-defaults.js";

const router = Router();

interface EligibleEmployee {
  id: string;
  employee_no: string | null;
  name: string;
  department: string | null;
  position: string | null;
  hire_date: string | null;
  employment_status: string | null;
  approved_resign_date: string | null;
  salary_start_date: string | null;
  contract_end_date: string | null;
  initial_monthly_salary: string | null;
}

interface StoredPayrollRow {
  id: string;
  employee_id: string;
  employee_no: string | null;
  employee_name: string;
  department: string | null;
  position: string | null;
  contract_end_date: string | null;
  initial_monthly_salary: string | null;
  automatic_salary: string;
  monthly_salary: string;
  housing_fund_base: string;
  contribution_base: string;
  individual_income_tax: string;
  monthly_salary_is_manual: boolean;
  housing_fund_base_is_manual: boolean;
  contribution_base_is_manual: boolean;
  tax_is_manual: boolean;
  version: number;
  updated_at: string;
}

const HUMAN_COST_RECEIPT_CATEGORIES = [
  "social_security",
  "housing_fund",
  "income_tax",
  "net_salary",
] as const;

type HumanCostReceiptCategory = (typeof HUMAN_COST_RECEIPT_CATEGORIES)[number];
const HUMAN_COST_RECEIPT_RECOGNITION_VERSIONS: Record<
  HumanCostReceiptCategory,
  number
> = {
  social_security: 3,
  housing_fund: 3,
  income_tax: 3,
  net_salary: 4,
};

function getHumanCostReceiptRecognitionVersion(
  category: HumanCostReceiptCategory,
): number {
  return HUMAN_COST_RECEIPT_RECOGNITION_VERSIONS[category];
}
const HUMAN_COST_RECEIPT_CATEGORY_LABELS: Record<
  HumanCostReceiptCategory,
  string
> = {
  social_security: "社保",
  housing_fund: "公积金",
  income_tax: "个税",
  net_salary: "实发工资",
};

interface StoredHumanCostReceipt {
  id: string;
  payroll_month: string;
  category: HumanCostReceiptCategory;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  recognized_amount: string;
  recognition_status: "processing" | "recognized" | "partial" | "failed";
  recognized_item_count: number;
  total_item_count: number;
  ignored_item_count: number;
  recognition_version: number;
  matched_employee_count: number;
  unmatched_employee_count: number;
  recognition_error: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredSalaryReceiptLink {
  id: string;
  receipt_id: string;
  employee_id: string;
  payee_name: string;
  amount: string;
  page_no: number;
  position: "full" | "top" | "bottom";
  file_name: string;
}

interface StoredPayrollTaxDetailFile {
  id: string;
  payroll_month: string;
  file_name: string;
  file_size: number;
  mime_type: "application/pdf" | "image/jpeg" | "image/png";
  recognized_count: number;
  zero_count: number;
  missing_employee_names: string[];
  unreadable_employee_names: string[];
  page_count: number;
  created_at: string;
  updated_at: string;
}

const receiptTempDirectory = path.join(process.cwd(), "uploads", "temp");
fs.mkdirSync(receiptTempDirectory, { recursive: true });

const humanCostReceiptUpload = multer({
  dest: receiptTempDirectory,
  limits: {
    files: 20,
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (_, file, callback) => {
    const allowedMimeTypes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error("回单只支持 PDF、JPEG、PNG 格式"));
  },
});

const payrollTaxDetailUpload = multer({
  dest: receiptTempDirectory,
  limits: {
    files: 1,
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (_, file, callback) => {
    const allowedMimeTypes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error("个人个税明细只支持 PDF、JPEG、PNG 格式"));
  },
});

function uploadHumanCostReceiptFiles(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  humanCostReceiptUpload.array("files", 20)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const message =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "单个回单文件不能超过 50MB"
        : error instanceof Error
          ? error.message
          : "回单上传失败";
    res.status(400).json({ success: false, message });
  });
}

function uploadPayrollTaxDetailFile(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  payrollTaxDetailUpload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const message =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "个人个税明细文件不能超过 50MB"
        : error instanceof Error
          ? error.message
          : "个人个税明细上传失败";
    res.status(400).json({ success: false, message });
  });
}

function parseHumanCostReceiptCategory(
  value: unknown,
): HumanCostReceiptCategory | null {
  const category = String(value || "") as HumanCostReceiptCategory;
  return HUMAN_COST_RECEIPT_CATEGORIES.includes(category) ? category : null;
}

function isActualHumanCostReceiptFile(file: Express.Multer.File): boolean {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(file.path, "r");
    const header = Buffer.alloc(8);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead < 3) return false;

    if (file.mimetype === "application/pdf") {
      return header.subarray(0, 5).toString("ascii") === "%PDF-";
    }
    if (file.mimetype === "image/png") {
      return header.equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
    return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  } catch {
    return false;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function getReceiptFileExtension(mimeType: string): string {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  return ".jpg";
}

function getReceiptFileHash(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

async function loadHumanCostReceiptSummary(payrollMonth: string) {
  await db.run(
    `UPDATE human_cost_receipts
     SET recognition_status = 'failed',
         recognition_error = '识别任务中断，请删除后重新上传',
         updated_at = ?
     WHERE payroll_month = ?
       AND recognition_status = 'processing'
       AND created_at::timestamptz < NOW() - INTERVAL '30 minutes'`,
    new Date().toISOString(),
    payrollMonth,
  );
  const receiptCandidates = await db.all<{
    id: string;
    file_path: string;
    mime_type: string;
    category: HumanCostReceiptCategory;
    recognition_version: number;
  }>(
    `SELECT id, file_path, mime_type, category, recognition_version
     FROM human_cost_receipts
     WHERE payroll_month = ?
       AND recognition_status <> 'processing'
     ORDER BY CASE category
       WHEN 'social_security' THEN 1
       WHEN 'housing_fund' THEN 2
       WHEN 'income_tax' THEN 3
       ELSE 4
     END, created_at ASC`,
    payrollMonth,
  );
  const outdatedReceipts = receiptCandidates.filter(
    (receipt) =>
      receipt.recognition_version <
      getHumanCostReceiptRecognitionVersion(receipt.category),
  );
  const receiptsToReprocess: Array<{
    id: string;
    filePath: string;
    mimeType: string;
    category: HumanCostReceiptCategory;
    payrollMonth: string;
  }> = [];
  for (const receipt of outdatedReceipts) {
    const targetVersion = getHumanCostReceiptRecognitionVersion(
      receipt.category,
    );
    const claimed = await db.run(
      `UPDATE human_cost_receipts
       SET recognition_status = 'processing',
           recognition_error = NULL,
           updated_at = ?
       WHERE id = ?
         AND recognition_version < ?
         AND recognition_status <> 'processing'`,
      new Date().toISOString(),
      receipt.id,
      targetVersion,
    );
    if (claimed.changes !== 1) continue;
    receiptsToReprocess.push({
      id: receipt.id,
      filePath: path.resolve(process.cwd(), receipt.file_path),
      mimeType: receipt.mime_type,
      category: receipt.category,
      payrollMonth,
    });
  }
  if (receiptsToReprocess.length > 0) {
    startHumanCostReceiptProcessing(receiptsToReprocess);
  }

  const list = await db.all<StoredHumanCostReceipt>(
    `SELECT
       id, payroll_month, category, file_name, file_path, file_size, mime_type,
       recognized_amount::text AS recognized_amount, recognition_status,
       recognized_item_count, total_item_count, ignored_item_count,
       recognition_version,
       (
         SELECT COUNT(*)::int
         FROM human_cost_receipt_items hcri
         WHERE hcri.receipt_id = human_cost_receipts.id
           AND hcri.match_status = 'matched'
       ) AS matched_employee_count,
       (
         SELECT COUNT(*)::int
         FROM human_cost_receipt_items hcri
         WHERE hcri.receipt_id = human_cost_receipts.id
           AND hcri.match_status <> 'matched'
       ) AS unmatched_employee_count,
       recognition_error,
       created_at, updated_at
     FROM human_cost_receipts
     WHERE payroll_month = ?
     ORDER BY category ASC, created_at DESC`,
    payrollMonth,
  );
  const totalRows = await db.all<{
    category: HumanCostReceiptCategory;
    recognized_total: string;
  }>(
    `SELECT category, COALESCE(SUM(recognized_amount), 0)::text AS recognized_total
     FROM human_cost_receipts
     WHERE payroll_month = ?
       AND recognition_status IN ('recognized', 'partial')
     GROUP BY category`,
    payrollMonth,
  );
  const totals = Object.fromEntries(
    HUMAN_COST_RECEIPT_CATEGORIES.map((category) => [category, "0.00"]),
  ) as Record<HumanCostReceiptCategory, string>;
  for (const row of totalRows) totals[row.category] = row.recognized_total;
  const taxDetail = await db.get<StoredPayrollTaxDetailFile>(
    `SELECT
       id, payroll_month, file_name, file_size, mime_type,
       recognized_count, zero_count, missing_employee_names,
       unreadable_employee_names, page_count, created_at, updated_at
     FROM payroll_tax_detail_files
     WHERE payroll_month = ?`,
    payrollMonth,
  );

  return {
    month: payrollMonth,
    list: list.map((receipt) => ({
      ...receipt,
      file_name: normalizeUploadFileName(receipt.file_name),
    })),
    totals,
    processing_count: list.filter(
      (receipt) => receipt.recognition_status === "processing",
    ).length,
    tax_detail: taxDetail
      ? {
          ...taxDetail,
          file_name: normalizeUploadFileName(taxDetail.file_name),
        }
      : null,
  };
}

async function processHumanCostReceiptRecord(
  receiptId: string,
  filePath: string,
  mimeType: string,
  category: HumanCostReceiptCategory,
  payrollMonth: string,
): Promise<boolean> {
  const targetVersion = getHumanCostReceiptRecognitionVersion(category);
  try {
    const recognition = await recognizeHumanCostReceipt(
      filePath,
      mimeType,
      receiptId,
      category,
    );
    const now = new Date().toISOString();
    const { startDate, endDate } = getPayrollMonthRange(payrollMonth);
    const employeeRows =
      category === "net_salary"
        ? await db.all<
            PayrollReceiptEmployeeIdentity & {
              hire_date: string | null;
              employment_status: string | null;
              approved_resign_date: string | null;
            }
          >(
            `SELECT
               ep.id AS "employeeId",
               ep.name AS "employeeName",
               ep.bank_account_name AS "bankAccountName",
               ep.bank_account_number AS "bankAccountNumber",
               ep.hire_date,
               ep.employment_status,
               (
                 SELECT MAX(rr.resign_date)
                 FROM resignation_requests rr
                 WHERE rr.employee_id = ep.id
                   AND rr.status = 'approved'
               ) AS approved_resign_date
             FROM employee_profiles ep
             LEFT JOIN users u ON u.id = ep.user_id
             WHERE ep.status = 'submitted'
               AND COALESCE(u.role, 'user') NOT IN ('super_admin', 'chairman', 'boss')`,
          )
        : [];
    const eligibleEmployees = employeeRows.filter((employee) =>
      isEmployeeIncludedInPayrollPeriod(
        {
          hireDate: employee.hire_date,
          approvedResignDate: employee.approved_resign_date,
          employmentStatus: employee.employment_status,
        },
        startDate,
        endDate,
      ),
    );

    await db.transaction(async (client) => {
      await client.query(
        `DELETE FROM human_cost_receipt_items WHERE receipt_id = $1`,
        [receiptId],
      );
      await client.query(
        `UPDATE human_cost_receipts
         SET recognized_amount = $1::numeric,
             recognition_status = $2,
             recognized_item_count = $3,
             total_item_count = $4,
             ignored_item_count = $5,
             recognition_error = $6,
             recognition_version = $7,
             updated_at = $8
         WHERE id = $9 AND recognition_status = 'processing'`,
        [
          recognition.recognizedAmount,
          recognition.recognitionStatus,
          recognition.recognizedItemCount,
          recognition.totalItemCount,
          recognition.ignoredItemCount,
          recognition.recognitionError,
          targetVersion,
          now,
          receiptId,
        ],
      );

      if (category !== "net_salary") return;
      for (const item of recognition.items) {
        const match = matchPayrollReceiptEmployee(
          item.payeeName,
          item.payeeAccount,
          eligibleEmployees,
        );
        await client.query(
          `INSERT INTO human_cost_receipt_items (
             id, receipt_id, employee_id, payee_name, payee_account,
             amount, proof_no, page_no, position, match_status, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6::numeric,$7,$8,$9,$10,$11)`,
          [
            `hcri_${nanoid(12)}`,
            receiptId,
            match.employeeId,
            item.payeeName,
            item.payeeAccount,
            formatPayrollAmount(String(item.amount)),
            item.proofNo || null,
            item.pageNo,
            item.position,
            match.status,
            now,
          ],
        );
      }
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "回单金额识别失败";
    await db.run(
      `UPDATE human_cost_receipts
       SET recognition_status = 'failed',
           recognition_error = ?,
           recognition_version = ?,
           updated_at = ?
       WHERE id = ? AND recognition_status = 'processing'`,
      message.slice(0, 300),
      targetVersion,
      new Date().toISOString(),
      receiptId,
    );
    return false;
  }
}

interface QueuedHumanCostReceipt {
  id: string;
  filePath: string;
  mimeType: string;
  category: HumanCostReceiptCategory;
  payrollMonth: string;
}

let humanCostReceiptProcessingChain = Promise.resolve();
let humanCostReceiptOcrUnavailableUntil = 0;
const queuedHumanCostReceiptIds = new Set<string>();

async function markHumanCostReceiptQueuePaused(
  receipts: QueuedHumanCostReceipt[],
) {
  const now = new Date().toISOString();
  for (const receipt of receipts) {
    await db.run(
      `UPDATE human_cost_receipts
       SET recognition_status = 'failed',
           recognition_error = '识别引擎刚刚发生异常，为保证服务器稳定已暂停后续任务，请稍后删除并重新上传',
           recognition_version = ?,
           updated_at = ?
       WHERE id = ? AND recognition_status = 'processing'`,
      getHumanCostReceiptRecognitionVersion(receipt.category),
      now,
      receipt.id,
    );
  }
}

function startHumanCostReceiptProcessing(receipts: QueuedHumanCostReceipt[]) {
  const pendingReceipts = receipts.filter((receipt) => {
    if (queuedHumanCostReceiptIds.has(receipt.id)) return false;
    queuedHumanCostReceiptIds.add(receipt.id);
    return true;
  });
  if (pendingReceipts.length === 0) return;

  humanCostReceiptProcessingChain = humanCostReceiptProcessingChain
    .then(async () => {
      if (Date.now() < humanCostReceiptOcrUnavailableUntil) {
        await markHumanCostReceiptQueuePaused(pendingReceipts);
        return;
      }

      for (let index = 0; index < pendingReceipts.length; index += 1) {
        const receipt = pendingReceipts[index];
        const completed = await processHumanCostReceiptRecord(
          receipt.id,
          receipt.filePath,
          receipt.mimeType,
          receipt.category,
          receipt.payrollMonth,
        );
        if (completed) continue;

        // 基础设施级异常后不立即拉起下一份 OCR，避免旧模型尚未释放时
        // 新模型再次占用资源并影响登录等主业务接口。
        humanCostReceiptOcrUnavailableUntil = Date.now() + 60_000;
        await markHumanCostReceiptQueuePaused(pendingReceipts.slice(index + 1));
        break;
      }
    })
    .catch((error) => {
      console.error("人力成本回单识别队列异常:", error);
    })
    .finally(() => {
      for (const receipt of pendingReceipts) {
        queuedHumanCostReceiptIds.delete(receipt.id);
      }
    });
}

function getCurrentPayrollMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function validatePayrollMonthWindow(payrollMonth: string) {
  getPayrollMonthRange(payrollMonth);
  const now = new Date();
  const maxFuture = new Date(
    Date.UTC(now.getFullYear(), now.getMonth() + 12, 1),
  );
  const maxMonth = `${maxFuture.getUTCFullYear()}-${String(maxFuture.getUTCMonth() + 1).padStart(2, "0")}`;
  if (payrollMonth > maxMonth)
    throw new Error("工资月份最多只能生成到未来 12 个月");
}

function buildPayrollRow(row: StoredPayrollRow) {
  const monthlySalary = formatPayrollAmount(row.monthly_salary);
  const housingFundBase = formatPayrollAmount(row.housing_fund_base);
  const contributionBase = formatPayrollAmount(row.contribution_base);
  const individualIncomeTax = formatPayrollAmount(row.individual_income_tax);
  const breakdown = calculatePayrollBreakdown(
    monthlySalary,
    housingFundBase,
    contributionBase,
    individualIncomeTax,
  );

  return {
    id: row.id,
    employee_id: row.employee_id,
    employee_no: row.employee_no,
    employee_name: row.employee_name,
    department: row.department,
    position: row.position,
    contract_end_date: row.contract_end_date,
    initial_monthly_salary: row.initial_monthly_salary
      ? formatPayrollAmount(row.initial_monthly_salary)
      : null,
    automatic_salary: formatPayrollAmount(row.automatic_salary),
    monthly_salary: monthlySalary,
    housing_fund_base: housingFundBase,
    contribution_base: contributionBase,
    individual_income_tax: individualIncomeTax,
    monthly_salary_is_manual: row.monthly_salary_is_manual,
    housing_fund_base_is_manual: row.housing_fund_base_is_manual,
    contribution_base_is_manual: row.contribution_base_is_manual,
    tax_is_manual: row.tax_is_manual,
    version: row.version,
    salary_recognized: row.initial_monthly_salary !== null,
    updated_at: row.updated_at,
    ...breakdown,
  };
}

async function loadPayrollRows(payrollMonth: string): Promise<
  Array<
    ReturnType<typeof buildPayrollRow> & {
      salary_receipts: StoredSalaryReceiptLink[];
    }
  >
> {
  const storedRows = (await db
    .prepare(
      `
    SELECT
      pr.id,
      pr.employee_id,
      COALESCE(u.employee_no, ep.employee_no) AS employee_no,
      ep.name AS employee_name,
      ep.department,
      ep.position,
      ep.contract_end_date,
      esp.initial_monthly_salary::text AS initial_monthly_salary,
      pr.automatic_salary::text AS automatic_salary,
      pr.monthly_salary::text AS monthly_salary,
      pr.housing_fund_base::text AS housing_fund_base,
      pr.contribution_base::text AS contribution_base,
      pr.individual_income_tax::text AS individual_income_tax,
      pr.monthly_salary_is_manual,
      pr.housing_fund_base_is_manual,
      pr.contribution_base_is_manual,
      pr.tax_is_manual,
      pr.version,
      pr.updated_at
    FROM payroll_records pr
    JOIN employee_profiles ep ON ep.id = pr.employee_id
    LEFT JOIN users u ON u.id = ep.user_id
    LEFT JOIN employee_salary_profiles esp ON esp.employee_id = ep.id
    WHERE pr.payroll_month = ?
      AND COALESCE(u.role, 'user') NOT IN ('super_admin', 'chairman', 'boss')
    ORDER BY
      NULLIF(REGEXP_REPLACE(COALESCE(u.employee_no, ep.employee_no), '[^0-9]', '', 'g'), '')::int ASC NULLS LAST,
      ep.name ASC
  `,
    )
    .all(payrollMonth)) as StoredPayrollRow[];

  const salaryReceiptRows = await db.all<StoredSalaryReceiptLink>(
    `SELECT
       hcri.id,
       hcri.receipt_id,
       hcri.employee_id,
       hcri.payee_name,
       hcri.amount::text AS amount,
       hcri.page_no,
       hcri.position,
       hcr.file_name
     FROM human_cost_receipt_items hcri
     JOIN human_cost_receipts hcr ON hcr.id = hcri.receipt_id
     WHERE hcr.payroll_month = ?
       AND hcr.category = 'net_salary'
       AND hcri.match_status = 'matched'
       AND hcri.employee_id IS NOT NULL
     ORDER BY hcr.created_at ASC, hcri.page_no ASC,
       CASE hcri.position WHEN 'top' THEN 1 WHEN 'bottom' THEN 2 ELSE 0 END`,
    payrollMonth,
  );
  const receiptsByEmployee = new Map<string, StoredSalaryReceiptLink[]>();
  for (const receipt of salaryReceiptRows) {
    const employeeReceipts = receiptsByEmployee.get(receipt.employee_id) || [];
    employeeReceipts.push({
      ...receipt,
      file_name: normalizeUploadFileName(receipt.file_name),
    });
    receiptsByEmployee.set(receipt.employee_id, employeeReceipts);
  }

  return storedRows.map((row) => ({
    ...buildPayrollRow(row),
    salary_receipts: receiptsByEmployee.get(row.employee_id) || [],
  }));
}

router.get("/receipts", requireAdmin, async (req, res) => {
  try {
    const payrollMonth = String(req.query.month || getCurrentPayrollMonth());
    validatePayrollMonthWindow(payrollMonth);
    res.json({
      success: true,
      data: await loadHumanCostReceiptSummary(payrollMonth),
    });
  } catch (error) {
    console.error("读取人力成本回单失败:", error);
    const message =
      error instanceof Error ? error.message : "读取人力成本回单失败";
    const status = message.includes("月份") ? 400 : 500;
    res.status(status).json({ success: false, message });
  }
});

router.post(
  "/receipts",
  requireAdmin,
  uploadHumanCostReceiptFiles,
  async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    const accepted: Array<{
      id: string;
      filePath: string;
      mimeType: string;
      category: HumanCostReceiptCategory;
      payrollMonth: string;
    }> = [];
    const removeTemporaryFiles = () => {
      for (const file of files) {
        try {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch {
          // 临时文件清理失败不覆盖原业务错误。
        }
      }
    };

    try {
      const payrollMonth = String(req.body?.month || "");
      const category = parseHumanCostReceiptCategory(req.body?.category);
      validatePayrollMonthWindow(payrollMonth);
      if (!category) {
        removeTemporaryFiles();
        return res
          .status(400)
          .json({ success: false, message: "人力成本回单类别无效" });
      }
      if (files.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "请选择需要上传的回单文件" });
      }

      const existingCategoryReceipt = await db.get<{ id: string }>(
        `SELECT id
         FROM human_cost_receipts
         WHERE payroll_month = ? AND category = ?
         LIMIT 1`,
        payrollMonth,
        category,
      );
      if (existingCategoryReceipt) {
        removeTemporaryFiles();
        return res.status(409).json({
          success: false,
          message: `${payrollMonth} 的${HUMAN_COST_RECEIPT_CATEGORY_LABELS[category]}银行回单已上传，请先删除现有文件后再上传`,
        });
      }

      let providedFileNames: string[] = [];
      try {
        const parsedNames = JSON.parse(String(req.body?.originalNames || "[]"));
        if (Array.isArray(parsedNames)) {
          providedFileNames = parsedNames.filter(
            (name): name is string => typeof name === "string",
          );
        }
      } catch {
        providedFileNames = [];
      }
      const normalizedFileNames = files.map((file, index) =>
        normalizeUploadFileName(file.originalname, providedFileNames[index]),
      );

      const invalidFileIndex = files.findIndex(
        (file) => !isActualHumanCostReceiptFile(file),
      );
      if (invalidFileIndex >= 0) {
        removeTemporaryFiles();
        return res.status(400).json({
          success: false,
          message: `${normalizedFileNames[invalidFileIndex]} 的文件内容与格式不符`,
        });
      }

      const uploadedBy = req.session.userId!;
      const duplicates: string[] = [];

      for (const [fileIndex, file] of files.entries()) {
        const normalizedFileName = normalizedFileNames[fileIndex];
        const fileHash = getReceiptFileHash(file.path);
        const existing = await db.get<{ id: string }>(
          `SELECT id
           FROM human_cost_receipts
           WHERE payroll_month = ? AND category = ? AND file_hash = ?`,
          payrollMonth,
          category,
          fileHash,
        );
        if (existing) {
          duplicates.push(normalizedFileName);
          fs.unlinkSync(file.path);
          continue;
        }

        const receiptId = `hcr_${nanoid(12)}`;
        const now = new Date().toISOString();
        const destinationDirectory = ensureDatedUploadDirectory(
          "human-cost-receipts",
          new Date(),
          payrollMonth,
          category,
        );
        const destinationPath = path.join(
          destinationDirectory,
          `${receiptId}${getReceiptFileExtension(file.mimetype)}`,
        );
        fs.renameSync(file.path, destinationPath);

        try {
          await db.run(
            `INSERT INTO human_cost_receipts (
               id, payroll_month, category, file_name, file_path, file_size,
               mime_type, file_hash, recognized_amount, recognition_status,
               recognized_item_count, total_item_count, recognition_version,
               uploaded_by,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'processing', 0, 0, ?, ?, ?, ?)`,
            receiptId,
            payrollMonth,
            category,
            normalizedFileName,
            toStoredUploadPath(destinationPath),
            file.size,
            file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype,
            fileHash,
            getHumanCostReceiptRecognitionVersion(category),
            uploadedBy,
            now,
            now,
          );
        } catch (error: unknown) {
          try {
            fs.unlinkSync(destinationPath);
          } catch {
            // 数据库写入失败时尽力清理已移动文件。
          }
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23505"
          ) {
            duplicates.push(normalizedFileName);
            continue;
          }
          throw error;
        }

        accepted.push({
          id: receiptId,
          filePath: destinationPath,
          mimeType:
            file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype,
          category,
          payrollMonth,
        });
      }

      if (accepted.length === 0) {
        return res.status(409).json({
          success: false,
          message: "所选回单均已在该月份和类别中上传",
          data: {
            ...(await loadHumanCostReceiptSummary(payrollMonth)),
            duplicates,
          },
        });
      }

      const responseData = {
        ...(await loadHumanCostReceiptSummary(payrollMonth)),
        accepted_count: accepted.length,
        duplicates,
      };
      res.status(202).json({
        success: true,
        message: "回单已上传，正在自动识别金额",
        data: responseData,
      });

      startHumanCostReceiptProcessing(accepted);
    } catch (error) {
      removeTemporaryFiles();
      if (accepted.length > 0) startHumanCostReceiptProcessing(accepted);
      console.error("上传人力成本回单失败:", error);
      const message =
        error instanceof Error ? error.message : "上传人力成本回单失败";
      const status =
        message.includes("月份") || message.includes("金额") ? 400 : 500;
      if (!res.headersSent) {
        res.status(status).json({ success: false, message });
      }
    }
  },
);

router.post(
  "/tax-details",
  requireAdmin,
  uploadPayrollTaxDetailFile,
  async (req, res) => {
    const file = req.file;
    let persistedFilePath: string | null = null;
    let persistedFileCommitted = false;
    const removeTemporaryFile = () => {
      if (!file) return;
      try {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      } catch {
        // 临时文件清理失败不覆盖原业务错误。
      }
    };

    try {
      const payrollMonth = String(req.body?.month || "");
      validatePayrollMonthWindow(payrollMonth);
      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "请选择个人个税明细文件" });
      }
      const fileName = normalizeUploadFileName(
        file.originalname,
        String(req.body?.originalName || ""),
      );
      if (!isActualHumanCostReceiptFile(file)) {
        return res.status(400).json({
          success: false,
          message: `${fileName} 的文件内容与格式不符`,
        });
      }

      const payrollRows = await loadPayrollRows(payrollMonth);
      if (payrollRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "本月尚未生成工资表，请先刷新工资表后再上传个税明细",
        });
      }
      const recognition = await recognizePayrollTaxDetail(
        file.path,
        file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype,
        payrollRows.map((row) => ({
          employeeId: row.employee_id,
          employeeName: row.employee_name,
        })),
      );
      const now = new Date().toISOString();
      const mimeType =
        file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype;
      const taxDetailId = `ptd_${nanoid(12)}`;
      const recognizedCount = recognition.items.length;
      const zeroCount = recognition.items.filter(
        (item) => comparePayrollAmounts(item.amount, "0") === 0,
      ).length;
      const destinationDirectory = ensureDatedUploadDirectory(
        "payroll-tax-details",
        new Date(),
        payrollMonth,
      );
      const destinationPath = path.join(
        destinationDirectory,
        `${taxDetailId}${getReceiptFileExtension(mimeType)}`,
      );
      const storedFilePath = toStoredUploadPath(destinationPath);
      fs.renameSync(file.path, destinationPath);
      persistedFilePath = destinationPath;

      const previousStoredFilePath = await db.transaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `payroll-tax-detail:${payrollMonth}`,
        ]);
        const previousFileResult = await client.query<{ file_path: string }>(
          `SELECT file_path
           FROM payroll_tax_detail_files
           WHERE payroll_month = $1
           FOR UPDATE`,
          [payrollMonth],
        );
        const previousFilePath = previousFileResult.rows[0]?.file_path || null;

        for (const item of recognition.items) {
          const recordResult = await client.query<{
            id: string;
            individual_income_tax: string;
          }>(
            `SELECT id, individual_income_tax::text AS individual_income_tax
             FROM payroll_records
             WHERE employee_id = $1 AND payroll_month = $2
             FOR UPDATE`,
            [item.employeeId, payrollMonth],
          );
          const record = recordResult.rows[0];
          if (!record) continue;

          const amount = normalizePayrollAmount(item.amount);
          await client.query(
            `UPDATE payroll_records
             SET individual_income_tax = $1::numeric,
                 tax_is_manual = TRUE,
                 version = version + 1,
                 updated_by = $2,
                 updated_at = $3
             WHERE id = $4`,
            [amount, req.session.userId, now, record.id],
          );
          if (
            comparePayrollAmounts(record.individual_income_tax, amount) === 0
          ) {
            continue;
          }
          await client.query(
            `INSERT INTO payroll_change_logs (
               id, payroll_record_id, employee_id, payroll_month, field_name,
               old_value, new_value, changed_by, changed_at
             ) VALUES ($1,$2,$3,$4,'individual_income_tax',$5::numeric,$6::numeric,$7,$8)`,
            [
              nanoid(),
              record.id,
              item.employeeId,
              payrollMonth,
              record.individual_income_tax,
              amount,
              req.session.userId,
              now,
            ],
          );
        }

        await client.query(
          `INSERT INTO payroll_tax_detail_files (
             id, payroll_month, file_name, file_path, file_size, mime_type,
             recognized_count, zero_count, missing_employee_names,
             unreadable_employee_names, page_count, uploaded_by,
             created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14
           )
           ON CONFLICT (payroll_month) DO UPDATE SET
             id = EXCLUDED.id,
             file_name = EXCLUDED.file_name,
             file_path = EXCLUDED.file_path,
             file_size = EXCLUDED.file_size,
             mime_type = EXCLUDED.mime_type,
             recognized_count = EXCLUDED.recognized_count,
             zero_count = EXCLUDED.zero_count,
             missing_employee_names = EXCLUDED.missing_employee_names,
             unreadable_employee_names = EXCLUDED.unreadable_employee_names,
             page_count = EXCLUDED.page_count,
             uploaded_by = EXCLUDED.uploaded_by,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at`,
          [
            taxDetailId,
            payrollMonth,
            fileName,
            storedFilePath,
            file.size,
            mimeType,
            recognizedCount,
            zeroCount,
            JSON.stringify(recognition.missingEmployeeNames),
            JSON.stringify(recognition.unreadableEmployeeNames),
            recognition.pageCount,
            req.session.userId,
            now,
            now,
          ],
        );
        return previousFilePath;
      });
      persistedFileCommitted = true;

      if (
        previousStoredFilePath?.startsWith("uploads/payroll-tax-details/") &&
        previousStoredFilePath !== storedFilePath
      ) {
        try {
          const previousAbsolutePath = path.resolve(
            process.cwd(),
            previousStoredFilePath,
          );
          if (fs.existsSync(previousAbsolutePath)) {
            fs.unlinkSync(previousAbsolutePath);
          }
        } catch (fileError) {
          console.warn("旧个人个税明细文件清理失败:", fileError);
        }
      }

      const list = await loadPayrollRows(payrollMonth);
      const totals = calculatePayrollTotals(
        list as Array<Record<PayrollAmountField, string>>,
      );
      res.json({
        success: true,
        message: `已识别并填充 ${recognition.items.length} 人的应纳个税`,
        data: {
          id: taxDetailId,
          payroll_month: payrollMonth,
          file_name: fileName,
          file_size: file.size,
          mime_type: mimeType,
          recognized_count: recognizedCount,
          zero_count: zeroCount,
          missing_employee_names: recognition.missingEmployeeNames,
          unreadable_employee_names: recognition.unreadableEmployeeNames,
          page_count: recognition.pageCount,
          created_at: now,
          updated_at: now,
          payroll: {
            month: payrollMonth,
            list,
            totals,
          },
        },
      });
    } catch (error) {
      if (persistedFilePath && !persistedFileCommitted) {
        try {
          if (fs.existsSync(persistedFilePath))
            fs.unlinkSync(persistedFilePath);
        } catch {
          // 新文件尚未写入数据库时尽力清理，原错误优先返回。
        }
      }
      console.error("识别个人个税明细失败:", error);
      const message =
        error instanceof Error ? error.message : "个人个税明细识别失败";
      const status =
        message.includes("月份") ||
        message.includes("工资表") ||
        message.includes("个税明细") ||
        message.includes("应纳个税") ||
        message.includes("文件")
          ? 400
          : 500;
      res.status(status).json({ success: false, message });
    } finally {
      removeTemporaryFile();
    }
  },
);

router.delete("/receipts/:receiptId", requireAdmin, async (req, res) => {
  try {
    const receipt = await db.get<{
      file_path: string;
      recognition_status: string;
    }>(
      `SELECT file_path, recognition_status
       FROM human_cost_receipts
       WHERE id = ?`,
      req.params.receiptId,
    );
    if (!receipt) {
      return res
        .status(404)
        .json({ success: false, message: "人力成本回单不存在" });
    }
    if (receipt.recognition_status === "processing") {
      return res
        .status(409)
        .json({ success: false, message: "回单正在识别，请稍后再删除" });
    }
    if (!receipt.file_path.startsWith("uploads/human-cost-receipts/")) {
      throw new Error("人力成本回单文件路径无效");
    }

    await db.run(
      `DELETE FROM human_cost_receipts WHERE id = ?`,
      req.params.receiptId,
    );
    const absolutePath = path.resolve(process.cwd(), receipt.file_path);
    try {
      if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    } catch (fileError) {
      console.warn("人力成本回单记录已删除，但磁盘文件清理失败:", fileError);
    }

    res.json({ success: true, message: "人力成本回单已删除" });
  } catch (error) {
    console.error("删除人力成本回单失败:", error);
    const message =
      error instanceof Error ? error.message : "删除人力成本回单失败";
    res.status(500).json({ success: false, message });
  }
});

router.post("/generate", requireAdmin, async (req, res) => {
  try {
    const payrollMonth = String(
      req.body?.month || req.query.month || getCurrentPayrollMonth(),
    );
    validatePayrollMonthWindow(payrollMonth);
    const { startDate, endDate } = getPayrollMonthRange(payrollMonth);
    const currentPayrollMonth = getCurrentPayrollMonth();
    const previousPayrollMonth = getPreviousPayrollMonth(payrollMonth);
    const now = new Date().toISOString();

    await db.transaction(async (client) => {
      const employeeResult = await client.query<EligibleEmployee>(
        `SELECT
           ep.id,
           COALESCE(u.employee_no, ep.employee_no) AS employee_no,
           ep.name,
           ep.department,
           ep.position,
           ep.hire_date,
           ep.employment_status,
           (
             SELECT MAX(rr.resign_date)
             FROM resignation_requests rr
             WHERE rr.employee_id = ep.id
               AND rr.status = 'approved'
           ) AS approved_resign_date,
           COALESCE(
             (
               SELECT MIN(ed.contract_start_date)
               FROM employee_documents ed
               WHERE ed.employee_id = ep.id
                 AND ed.document_type = 'contract'
                 AND ed.contract_start_date IS NOT NULL
             ),
             ep.hire_date
           ) AS salary_start_date,
           ep.contract_end_date,
           esp.initial_monthly_salary::text AS initial_monthly_salary
         FROM employee_profiles ep
         LEFT JOIN users u ON u.id = ep.user_id
         LEFT JOIN employee_salary_profiles esp ON esp.employee_id = ep.id
         WHERE ep.status = 'submitted'
           AND COALESCE(u.role, 'user') NOT IN ('super_admin', 'chairman', 'boss')
         ORDER BY ep.created_at ASC`,
      );

      const eligibleEmployees = employeeResult.rows.filter((employee) =>
        isEmployeeIncludedInPayrollPeriod(
          {
            hireDate: employee.hire_date,
            approvedResignDate: employee.approved_resign_date,
            employmentStatus: employee.employment_status,
          },
          startDate,
          endDate,
        ),
      );
      const eligibleEmployeeIds = eligibleEmployees.map(
        (employee) => employee.id,
      );

      // 月份成员随入职和离职生效时间同步：入职当月加入，离职次月移除。
      await client.query(
        `DELETE FROM payroll_records
         WHERE payroll_month = $1
           AND NOT (employee_id = ANY($2::text[]))`,
        [payrollMonth, eligibleEmployeeIds],
      );

      for (const employee of eligibleEmployees) {
        const automaticSalary = calculateAutomaticMonthlySalary(
          employee.initial_monthly_salary,
          employee.salary_start_date,
          payrollMonth,
        );

        const previousMonthResult = await client.query<{
          monthly_salary: string;
          housing_fund_base: string;
          contribution_base: string;
        }>(
          `SELECT
             monthly_salary::text AS monthly_salary,
             housing_fund_base::text AS housing_fund_base,
             contribution_base::text AS contribution_base
           FROM payroll_records
           WHERE employee_id = $1 AND payroll_month = $2`,
          [employee.id, previousPayrollMonth],
        );
        const monthDefaults = resolvePayrollMonthDefaults(
          automaticSalary,
          previousMonthResult.rows[0],
        );

        await client.query(
          `INSERT INTO payroll_records (
             id, employee_id, payroll_month, automatic_salary, monthly_salary,
             housing_fund_base, contribution_base, individual_income_tax,
             created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9,$9
           )
           ON CONFLICT (employee_id, payroll_month) DO NOTHING`,
          [
            nanoid(),
            employee.id,
            payrollMonth,
            automaticSalary,
            monthDefaults.monthlySalary,
            monthDefaults.housingFundBase,
            monthDefaults.contributionBase,
            monthDefaults.individualIncomeTax,
            now,
          ],
        );

        // 历史月份保持工资快照；本月及未来月份仅刷新尚未在该月手工修改的默认值。
        if (payrollMonth >= currentPayrollMonth) {
          await client.query(
            `UPDATE payroll_records
             SET version = version + CASE
                   WHEN automatic_salary IS DISTINCT FROM $1::numeric
                     OR (
                       NOT monthly_salary_is_manual
                       AND monthly_salary IS DISTINCT FROM $2::numeric
                     )
                     OR (
                       NOT housing_fund_base_is_manual
                       AND housing_fund_base IS DISTINCT FROM $3::numeric
                     )
                     OR (
                       NOT contribution_base_is_manual
                       AND contribution_base IS DISTINCT FROM $4::numeric
                     )
                     OR (
                       NOT tax_is_manual
                       AND individual_income_tax IS DISTINCT FROM $5::numeric
                     )
                   THEN 1 ELSE 0
                 END,
                 automatic_salary = $1::numeric,
                 monthly_salary = CASE
                   WHEN monthly_salary_is_manual THEN monthly_salary ELSE $2::numeric
                 END,
                 housing_fund_base = CASE
                   WHEN housing_fund_base_is_manual
                     THEN housing_fund_base
                     ELSE $3::numeric
                 END,
                 contribution_base = CASE
                   WHEN contribution_base_is_manual
                     THEN contribution_base
                     ELSE $4::numeric
                 END,
                 individual_income_tax = CASE
                   WHEN tax_is_manual
                     THEN individual_income_tax
                     ELSE $5::numeric
                 END,
                 updated_at = $6
             WHERE employee_id = $7 AND payroll_month = $8`,
            [
              automaticSalary,
              monthDefaults.monthlySalary,
              monthDefaults.housingFundBase,
              monthDefaults.contributionBase,
              monthDefaults.individualIncomeTax,
              now,
              employee.id,
              payrollMonth,
            ],
          );
        }
      }
    });

    const list = await loadPayrollRows(payrollMonth);
    const totals = calculatePayrollTotals(
      list as Array<Record<PayrollAmountField, string>>,
    );

    res.json({
      success: true,
      data: {
        month: payrollMonth,
        list,
        totals,
      },
    });
  } catch (error) {
    console.error("获取人力成本工资表失败:", error);
    const message =
      error instanceof Error ? error.message : "获取人力成本工资表失败";
    const status = message.includes("月份") ? 400 : 500;
    res.status(status).json({ success: false, message });
  }
});

router.get("/", requireAdmin, async (req, res) => {
  try {
    const payrollMonth = String(req.query.month || getCurrentPayrollMonth());
    validatePayrollMonthWindow(payrollMonth);
    const list = await loadPayrollRows(payrollMonth);
    const totals = calculatePayrollTotals(
      list as Array<Record<PayrollAmountField, string>>,
    );
    res.json({
      success: true,
      data: { month: payrollMonth, list, totals },
    });
  } catch (error) {
    console.error("读取人力成本工资表失败:", error);
    const message =
      error instanceof Error ? error.message : "读取人力成本工资表失败";
    const status = message.includes("月份") ? 400 : 500;
    res.status(status).json({ success: false, message });
  }
});

router.patch("/:month/:employeeId", requireAdmin, async (req, res) => {
  try {
    const { month, employeeId } = req.params;
    validatePayrollMonthWindow(month);

    const hasMonthlySalary = Object.prototype.hasOwnProperty.call(
      req.body,
      "monthly_salary",
    );
    const hasHousingFundBase = Object.prototype.hasOwnProperty.call(
      req.body,
      "housing_fund_base",
    );
    const hasContributionBase = Object.prototype.hasOwnProperty.call(
      req.body,
      "contribution_base",
    );
    const hasIncomeTax = Object.prototype.hasOwnProperty.call(
      req.body,
      "individual_income_tax",
    );
    if (
      !hasMonthlySalary &&
      !hasHousingFundBase &&
      !hasContributionBase &&
      !hasIncomeTax
    ) {
      return res
        .status(400)
        .json({ success: false, message: "没有需要修改的工资字段" });
    }
    const expectedVersion = Number(req.body.version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return res
        .status(400)
        .json({ success: false, message: "工资记录版本无效，请刷新后重试" });
    }

    const monthlySalary = hasMonthlySalary
      ? normalizePayrollAmount(req.body.monthly_salary)
      : "0";
    const housingFundBase = hasHousingFundBase
      ? normalizePayrollAmount(req.body.housing_fund_base)
      : "0";
    const contributionBase = hasContributionBase
      ? normalizePayrollAmount(req.body.contribution_base)
      : "0";
    const incomeTax = hasIncomeTax
      ? normalizePayrollAmount(req.body.individual_income_tax)
      : "0";
    const now = new Date().toISOString();

    await db.transaction(async (client) => {
      const recordResult = await client.query<{
        id: string;
        monthly_salary: string;
        housing_fund_base: string;
        contribution_base: string;
        individual_income_tax: string;
        version: number;
      }>(
        `SELECT pr.id, pr.monthly_salary::text AS monthly_salary,
                pr.housing_fund_base::text AS housing_fund_base,
                pr.contribution_base::text AS contribution_base,
                pr.individual_income_tax::text AS individual_income_tax, pr.version
         FROM payroll_records pr
         JOIN employee_profiles ep ON ep.id = pr.employee_id
         LEFT JOIN users u ON u.id = ep.user_id
         WHERE pr.employee_id = $1
           AND pr.payroll_month = $2
           AND COALESCE(u.role, 'user') NOT IN ('super_admin', 'chairman', 'boss')
         FOR UPDATE OF pr`,
        [employeeId, month],
      );
      const record = recordResult.rows[0];
      if (!record) throw new Error("工资记录不存在，请先刷新工资表");
      if (record.version !== expectedVersion) {
        throw new Error("工资记录已被其他管理员修改，请刷新后重试");
      }

      const updateResult = await client.query(
        `UPDATE payroll_records
         SET monthly_salary = CASE WHEN $1::boolean THEN $2::numeric ELSE monthly_salary END,
             housing_fund_base = CASE WHEN $3::boolean THEN $4::numeric ELSE housing_fund_base END,
             contribution_base = CASE WHEN $5::boolean THEN $6::numeric ELSE contribution_base END,
             individual_income_tax = CASE WHEN $7::boolean THEN $8::numeric ELSE individual_income_tax END,
             monthly_salary_is_manual = monthly_salary_is_manual OR $1::boolean,
             housing_fund_base_is_manual = housing_fund_base_is_manual OR $3::boolean,
             contribution_base_is_manual = contribution_base_is_manual OR $5::boolean,
             tax_is_manual = tax_is_manual OR $7::boolean,
             version = version + 1,
             updated_by = $9,
             updated_at = $10
         WHERE id = $11 AND version = $12`,
        [
          hasMonthlySalary,
          monthlySalary,
          hasHousingFundBase,
          housingFundBase,
          hasContributionBase,
          contributionBase,
          hasIncomeTax,
          incomeTax,
          req.session.userId,
          now,
          record.id,
          expectedVersion,
        ],
      );
      if ((updateResult.rowCount ?? 0) !== 1) {
        throw new Error("工资记录已被其他管理员修改，请刷新后重试");
      }

      const changes = [
        hasMonthlySalary
          ? ["monthly_salary", record.monthly_salary, monthlySalary]
          : null,
        hasHousingFundBase
          ? ["housing_fund_base", record.housing_fund_base, housingFundBase]
          : null,
        hasContributionBase
          ? ["contribution_base", record.contribution_base, contributionBase]
          : null,
        hasIncomeTax
          ? ["individual_income_tax", record.individual_income_tax, incomeTax]
          : null,
      ].filter((item): item is string[] => item !== null);
      for (const [fieldName, oldValue, newValue] of changes) {
        await client.query(
          `INSERT INTO payroll_change_logs (
             id, payroll_record_id, employee_id, payroll_month, field_name,
             old_value, new_value, changed_by, changed_at
           ) VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9)`,
          [
            nanoid(),
            record.id,
            employeeId,
            month,
            fieldName,
            oldValue,
            newValue,
            req.session.userId,
            now,
          ],
        );
      }
    });

    const list = await loadPayrollRows(month);
    const row = list.find((item) => item.employee_id === employeeId);
    res.json({ success: true, message: "工资数据已更新", data: row });
  } catch (error) {
    console.error("更新工资数据失败:", error);
    const message = error instanceof Error ? error.message : "更新工资数据失败";
    const status = message.includes("不存在")
      ? 404
      : message.includes("其他管理员修改")
        ? 409
        : message.includes("金额") ||
            message.includes("月份") ||
            message.includes("版本")
          ? 400
          : 500;
    res.status(status).json({ success: false, message });
  }
});

export default router;
