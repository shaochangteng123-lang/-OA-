import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { db } from "../db/index.js";
import {
  requireAuth,
  requireAdmin,
  requireAdminOrGM,
} from "../middleware/auth.js";
import type {
  ProbationConfirmation,
  ProbationConfirmationWithEmployee,
  ProbationConversionType,
  ProbationDocument,
  ProbationHistoryRecord,
  ProbationReviewStage,
  ProbationSignatureRecord,
  ProbationTemplate,
} from "../types/database.js";
import { nanoid } from "nanoid";
import {
  ensureDatedUploadDirectory,
  toStoredUploadPath,
} from "../utils/upload-date.js";
import { parsePagination } from "../utils/pagination.js";
import { normalizeSignaturePng } from "../utils/electronic-signature.js";
import {
  generateProbationApplicationPdf,
  type ProbationPdfSignature,
} from "../services/probationApplicationPdf.js";
import { getMonthlyProbationReviewStage } from "../utils/probation-review.js";
import { requiresEmployeeProfile } from "../utils/boss-role.js";

const router = Router();

class ProbationOperationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ProbationOperationError";
  }
}

type ActiveReviewStage = Exclude<
  ProbationReviewStage,
  "employee" | "completed"
>;

interface SignerSnapshot {
  id: string;
  name: string;
  role: string;
  department: string | null;
  position: string | null;
}

interface ProbationApproverNames {
  employee: string | null;
  supervisor: string | null;
  hr: string | null;
  general_manager: string | null;
}

type SigningSignatureType = "personal";

interface SigningSignature {
  buffer: Buffer;
  type: SigningSignatureType;
  ownerName: string;
}

const REVIEW_STAGE_LABELS: Record<ProbationReviewStage, string> = {
  employee: "员工填写",
  supervisor: "主管领导意见",
  hr: "人事部意见",
  general_manager: "董事长审批",
  completed: "已完成",
};

const REVIEW_STAGE_STEPS: Record<ActiveReviewStage, number> = {
  supervisor: 1,
  hr: 2,
  general_manager: 3,
};

const CONVERSION_TYPES = new Set<ProbationConversionType>([
  "normal",
  "early",
  "extended",
  "other",
]);

function toAbsoluteStoredPath(storedPath: string): string {
  return path.resolve(process.cwd(), storedPath.replace(/^[/\\]+/, ""));
}

async function getSignerSnapshot(
  client: PoolClient,
  userId: string,
): Promise<SignerSnapshot> {
  const result = await client.query<SignerSnapshot>(
    `SELECT u.id, u.name, u.role, ep.department, ep.position
     FROM users u
     LEFT JOIN employee_profiles ep ON ep.user_id = u.id
     WHERE u.id = $1 AND u.status = 'active'
     LIMIT 1`,
    [userId],
  );
  const signer = result.rows[0];
  if (!signer) throw new ProbationOperationError("用户不存在或已停用", 401);
  return signer;
}

async function resolveSupervisor(
  client: PoolClient,
  employeeId: string,
): Promise<SignerSnapshot> {
  const generalManager = await client.query<SignerSnapshot>(
    `SELECT u.id, u.name, u.role, ep.department, ep.position
     FROM users u
     LEFT JOIN employee_profiles ep ON ep.user_id = u.id
     WHERE u.status = 'active'
       AND u.role = 'general_manager'
       AND COALESCE(ep.id, '') <> $1
     ORDER BY u.created_at ASC
     LIMIT 1`,
    [employeeId],
  );
  if (!generalManager.rows[0]) {
    throw new ProbationOperationError(
      "未找到可签署的主管领导，请先配置总经理账号",
      409,
    );
  }
  return generalManager.rows[0];
}

async function resolveHrApprover(client: PoolClient): Promise<SignerSnapshot> {
  const approver = await client.query<SignerSnapshot>(
    `SELECT u.id, u.name, u.role, ep.department, ep.position
     FROM users u
     LEFT JOIN employee_profiles ep ON ep.user_id = u.id
     WHERE u.status = 'active'
       AND u.role IN ('admin', 'super_admin')
     ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, u.created_at ASC
     LIMIT 1`,
  );
  if (!approver.rows[0]) {
    throw new ProbationOperationError(
      "未找到可签署人事部意见的管理员账号",
      409,
    );
  }
  return approver.rows[0];
}

async function resolveChairman(client: PoolClient): Promise<SignerSnapshot> {
  const chairman = await client.query<SignerSnapshot>(
    `SELECT u.id, u.name, u.role, ep.department, ep.position
     FROM users u
     LEFT JOIN employee_profiles ep ON ep.user_id = u.id
     WHERE u.status = 'active'
       AND u.role = 'chairman'
     ORDER BY u.created_at ASC
     LIMIT 1`,
  );
  if (!chairman.rows[0]) {
    throw new ProbationOperationError(
      "未找到可终审的董事长账号，请先创建并启用董事长账号",
      409,
    );
  }
  return chairman.rows[0];
}

function canSignStage(
  stage: ActiveReviewStage,
  signer: SignerSnapshot,
  confirmation: Pick<
    ProbationConfirmation,
    "supervisor_id" | "hr_approver_id" | "chairman_id"
  >,
): boolean {
  if (stage === "supervisor") {
    return signer.id === confirmation.supervisor_id;
  }
  if (stage === "hr") {
    return confirmation.hr_approver_id
      ? signer.id === confirmation.hr_approver_id
      : ["admin", "super_admin"].includes(signer.role);
  }
  return confirmation.chairman_id
    ? signer.id === confirmation.chairman_id
    : signer.role === "chairman";
}

function buildProbationApproverNames(
  confirmation: Partial<ProbationConfirmation>,
  employeeName: string | null | undefined,
  supervisorName?: string | null,
): ProbationApproverNames {
  return {
    employee:
      confirmation.applicant_name_snapshot?.trim() ||
      employeeName?.trim() ||
      null,
    supervisor:
      confirmation.supervisor_name_snapshot?.trim() ||
      supervisorName?.trim() ||
      null,
    hr: confirmation.hr_approver_name_snapshot?.trim() || null,
    general_manager:
      confirmation.chairman_name_snapshot?.trim() || null,
  };
}

function parseSigningSignatureType(value: unknown): SigningSignatureType {
  if (value === undefined || value === "" || value === "personal") {
    return "personal";
  }
  throw new ProbationOperationError("所选电子签名类型不正确");
}

async function loadSigningSignature(
  client: PoolClient,
  signer: SignerSnapshot,
  signatureType: SigningSignatureType,
): Promise<SigningSignature> {
  const result = await client.query<{
    signature_path: string;
  }>(
    `SELECT signature_path
     FROM user_signatures
     WHERE user_id = $1
     FOR SHARE`,
    [signer.id],
  );
  const signature = result.rows[0]
    ? {
        signature_path: result.rows[0].signature_path,
        signature_owner_name: signer.name,
      }
    : undefined;

  if (!signature) {
    throw new ProbationOperationError(
      "请先在个人设置上传本人电子签名",
      409,
    );
  }

  const signaturePath = toAbsoluteStoredPath(signature.signature_path);
  if (!fs.existsSync(signaturePath)) {
    throw new ProbationOperationError(
      "电子签名文件不存在，请联系系统管理员处理",
      409,
    );
  }
  return {
    buffer: await normalizeSignaturePng(fs.readFileSync(signaturePath)),
    type: signatureType,
    ownerName: signature.signature_owner_name,
  };
}

function publicSignatureRecord(record: ProbationSignatureRecord) {
  return {
    id: record.id,
    form_version: record.form_version,
    stage: record.stage,
    signer_id: record.signer_id,
    signer_name: record.signer_name,
    signer_role: record.signer_role,
    signer_department: record.signer_department,
    signer_position: record.signer_position,
    signature_type: record.signature_type,
    signature_owner_name: record.signature_owner_name,
    opinion: record.opinion,
    decision: record.decision,
    signed_at: record.signed_at,
    signature_image_url: `/api/probation/signatures/${encodeURIComponent(record.id)}/image`,
  };
}

function parseArchivedRecords<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function publicProbationHistoryRecord(record: ProbationHistoryRecord) {
  const approvalRecords = parseArchivedRecords(record.approval_records_json);
  const signatureHistory = parseArchivedRecords(record.signature_history_json);
  return {
    id: record.id,
    employee_id: record.employee_id,
    confirmation_id: record.confirmation_id,
    hire_date: record.hire_date,
    probation_end_date: record.probation_end_date,
    status: record.status,
    submit_time: record.submit_time,
    approve_time: record.approve_time,
    reset_reason: record.reset_reason,
    reset_at: record.reset_at,
    form_version: record.form_version,
    review_stage: record.review_stage,
    has_approval_history:
      approvalRecords.length > 0 ||
      signatureHistory.length > 0 ||
      !!record.submit_time ||
      !!record.approve_time,
  };
}

interface ArchivedApprovalRecord {
  id: string;
  instance_id: string | null;
  step: number;
  approver_id: string | null;
  action: string;
  comment: string | null;
  action_time: string;
  approver_name: string;
  approver_role: string | null;
}

function buildLegacyApprovalRecords(
  history: ProbationHistoryRecord & {
    employee_user_id: string | null;
    employee_name: string;
    approver_name: string | null;
  },
): ArchivedApprovalRecord[] {
  const records: ArchivedApprovalRecord[] = [];
  if (history.submit_time) {
    records.push({
      id: `history-submit-${history.id}`,
      instance_id: null,
      step: 0,
      approver_id: history.employee_user_id,
      action: "submit",
      comment: history.application_comment,
      action_time: history.submit_time,
      approver_name: history.employee_name,
      approver_role: "user",
    });
  }
  if (history.approve_time) {
    records.push({
      id: `history-result-${history.id}`,
      instance_id: null,
      step: 1,
      approver_id: history.approver_id,
      action: history.status === "rejected" ? "reject" : "approve",
      comment: history.approver_comment,
      action_time: history.approve_time,
      approver_name: history.approver_name || "系统历史归档",
      approver_role: null,
    });
  }
  return records;
}

function isInlinePreviewMimeType(mimeType: string | null | undefined): boolean {
  return (
    !!mimeType &&
    ["application/pdf", "image/jpeg", "image/jpg", "image/png"].includes(
      mimeType,
    )
  );
}

async function getFirstContractProbationInfo(employeeId: string): Promise<{
  hasRecognizedContract: boolean;
  probationEndDate: string | null;
}> {
  const firstContract = (await db
    .prepare(
      `
    SELECT probation_end_date
    FROM employee_documents
    WHERE employee_id = ?
      AND document_type = 'contract'
      AND contract_start_date IS NOT NULL
      AND contract_end_date IS NOT NULL
    ORDER BY contract_start_date ASC, created_at ASC
    LIMIT 1
  `,
    )
    .get(employeeId)) as { probation_end_date: string | null } | undefined;

  return {
    hasRecognizedContract: !!firstContract,
    probationEndDate: firstContract?.probation_end_date ?? null,
  };
}

function resolveProbationEndDate(
  storedProbationEndDate: string | null | undefined,
  contractInfo: {
    hasRecognizedContract: boolean;
    probationEndDate: string | null;
  },
): string | null {
  if (contractInfo.hasRecognizedContract) return contractInfo.probationEndDate;
  return storedProbationEndDate || null;
}

async function getOfficialProbationDocuments(
  confirmationId: string,
  formVersion: number,
): Promise<ProbationDocument[]> {
  return (await db
    .prepare(
      `
    SELECT *
    FROM probation_documents
    WHERE confirmation_id = ?
      AND source_type = 'official'
      AND form_version = ?
    ORDER BY created_at DESC
  `,
    )
    .all(confirmationId, formVersion)) as ProbationDocument[];
}

async function getGeneratedProbationDocuments(
  confirmationId: string,
  formVersion: number,
): Promise<ProbationDocument[]> {
  return (await db
    .prepare(
      `
    SELECT *
    FROM probation_documents
    WHERE confirmation_id = ?
      AND source_type = 'generated'
      AND form_version = ?
    ORDER BY created_at DESC
  `,
    )
    .all(confirmationId, formVersion)) as ProbationDocument[];
}

// 配置 multer 用于转正文件上传
const uploadProbationDoc = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const confirmationId = req.params.id || "temp";
      const destDir = ensureDatedUploadDirectory(
        "probation-documents",
        new Date(),
        confirmationId,
      );
      cb(null, destDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const filename = `application-${Date.now()}${ext}`;
      cb(null, filename);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ["application/pdf"];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("只支持 PDF 格式的文件"));
    }
  },
});

// 配置 multer 用于转正模板上传
const uploadTemplate = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, ensureDatedUploadDirectory("probation-templates"));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const filename = `template-${Date.now()}${ext}`;
      cb(null, filename);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ["application/pdf"];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("只支持 PDF 格式的文件"));
    }
  },
});

// ==================== 模板管理 API ====================

// 获取转正文件模板列表
router.get("/templates", requireAuth, async (req, res) => {
  try {
    const templates = (await db
      .prepare(
        `
      SELECT * FROM probation_templates ORDER BY created_at DESC
    `,
      )
      .all()) as ProbationTemplate[];

    res.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    console.error("获取转正模板列表失败:", error);
    res.status(500).json({ success: false, message: "获取转正模板列表失败" });
  }
});

// 上传转正文件模板（管理员）
router.post(
  "/templates",
  requireAdmin,
  uploadTemplate.single("file"),
  async (req, res) => {
    try {
      const { name, originalFileName } = req.body;
      const file = req.file;

      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "请选择要上传的文件" });
      }

      if (!name) {
        fs.unlinkSync(file.path);
        return res
          .status(400)
          .json({ success: false, message: "请输入模板名称" });
      }

      // 优先使用前端传递的原始文件名，否则尝试解码
      const decodedFileName =
        originalFileName ||
        Buffer.from(file.originalname, "latin1").toString("utf8");

      // 获取上传者信息
      const uploader = (await db
        .prepare(
          `
      SELECT name FROM users WHERE id = ?
    `,
        )
        .get(req.session.userId)) as { name: string } | undefined;

      const id = nanoid();
      const now = new Date().toISOString();
      const relativePath = toStoredUploadPath(file.path, true);

      await db
        .prepare(
          `
      INSERT INTO probation_templates (
        id, name, file_name, file_path, file_size, mime_type,
        uploaded_by, uploaded_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        )
        .run(
          id,
          name,
          decodedFileName,
          relativePath,
          file.size,
          file.mimetype,
          req.session.userId,
          uploader?.name || null,
          now,
        );

      const template = await db
        .prepare(
          `
      SELECT * FROM probation_templates WHERE id = ?
    `,
        )
        .get(id);

      res.json({
        success: true,
        message: "模板上传成功",
        data: template,
      });
    } catch (error) {
      console.error("上传转正模板失败:", error);
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          // 忽略删除失败
        }
      }
      res.status(500).json({ success: false, message: "上传转正模板失败" });
    }
  },
);

// 删除转正文件模板（管理员）
router.delete("/templates/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const template = (await db
      .prepare(
        `
      SELECT * FROM probation_templates WHERE id = ?
    `,
      )
      .get(id)) as ProbationTemplate | undefined;

    if (!template) {
      return res.status(404).json({ success: false, message: "模板不存在" });
    }

    // 删除物理文件
    const filePath = path.join(process.cwd(), template.file_path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 删除数据库记录
    await db.prepare(`DELETE FROM probation_templates WHERE id = ?`).run(id);

    res.json({
      success: true,
      message: "模板删除成功",
    });
  } catch (error) {
    console.error("删除转正模板失败:", error);
    res.status(500).json({ success: false, message: "删除转正模板失败" });
  }
});

// 模板仅供管理员维护；员工使用在线申请单，不再下载空白模板。
router.get("/templates/:id/download", requireAdminOrGM, async (req, res) => {
  try {
    const { id } = req.params;

    const template = (await db
      .prepare(
        `
      SELECT * FROM probation_templates WHERE id = ?
    `,
      )
      .get(id)) as ProbationTemplate | undefined;

    if (!template) {
      return res.status(404).json({ success: false, message: "模板不存在" });
    }

    const filePath = path.join(process.cwd(), template.file_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "文件不存在" });
    }

    res.setHeader(
      "Content-Type",
      template.mime_type || "application/octet-stream",
    );
    const disposition = isInlinePreviewMimeType(template.mime_type)
      ? "inline"
      : "attachment";
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${encodeURIComponent(template.file_name)}"`,
    );

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error("下载转正模板失败:", error);
    res.status(500).json({ success: false, message: "下载转正模板失败" });
  }
});

// 在线填写始终以管理员最新上传的原始模板为底稿，不向员工提供下载入口。
router.get("/template-preview", requireAuth, async (_req, res) => {
  try {
    const template = (await db
      .prepare(
        `
      SELECT * FROM probation_templates ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get()) as ProbationTemplate | undefined;

    if (!template) {
      return res
        .status(404)
        .json({ success: false, message: "管理员尚未上传转正申请单模板" });
    }
    if (template.mime_type !== "application/pdf") {
      return res.status(409).json({
        success: false,
        message: "当前转正申请单模板不是 PDF（便携式文档格式）",
      });
    }

    const filePath = toAbsoluteStoredPath(template.file_path);
    if (!fs.existsSync(filePath)) {
      return res
        .status(404)
        .json({ success: false, message: "转正申请单模板文件不存在" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Probation-Template-Id", template.id);
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error("获取在线转正申请单模板失败:", error);
    res
      .status(500)
      .json({ success: false, message: "获取在线转正申请单模板失败" });
  }
});

// ==================== 转正申请管理 API ====================

// 获取待转正员工列表（管理员或总经理）
router.get("/list", requireAdminOrGM, async (req, res) => {
  try {
    const { status, thisMonth, reviewedByMeThisMonth } = req.query;
    const pagination = parsePagination(req.query.page, req.query.pageSize);
    const isMyMonthlyReview = reviewedByMeThisMonth === "1";

    // 当没有 status 筛选（全部查询）或 status=pending 时，需要包含没有转正记录的实习期员工
    const includeNonApplied =
      !isMyMonthlyReview && (!status || status === "pending");

    let sql: string;
    let countSql: string;
    const params: any[] = [];
    const countParams: any[] = [];

    if (isMyMonthlyReview) {
      const userId = req.session.userId!;
      const currentUser = (await db
        .prepare("SELECT role FROM users WHERE id = ? AND status = 'active'")
        .get(userId)) as { role: string } | undefined;
      const reviewedStage = getMonthlyProbationReviewStage(currentUser?.role);
      if (!currentUser || !reviewedStage) {
        return res
          .status(403)
          .json({ success: false, message: "当前角色不能查询本人审批记录" });
      }

      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextMonthStart = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;

      sql = `
        SELECT pc.*, ep.name as employee_name, ep.department as employee_department,
               ep.position as employee_position, ep.mobile as employee_mobile,
               ep.hire_date as employee_hire_date,
               reviewed.reviewed_at
        FROM probation_confirmations pc
        INNER JOIN employee_profiles ep ON pc.employee_id = ep.id
        LEFT JOIN users employee_user ON employee_user.id = ep.user_id
        INNER JOIN (
          SELECT confirmation_id, MAX(signed_at) AS reviewed_at
          FROM probation_signature_records
          WHERE signer_id = ?
            AND stage = '${reviewedStage}'
            AND signed_at >= ?
            AND signed_at < ?
          GROUP BY confirmation_id
        ) reviewed ON reviewed.confirmation_id = pc.id
        WHERE COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
      `;
      params.push(userId, monthStart, nextMonthStart);

      countSql = `
        SELECT COUNT(*) as total
        FROM probation_confirmations pc
        INNER JOIN employee_profiles ep ON pc.employee_id = ep.id
        LEFT JOIN users employee_user ON employee_user.id = ep.user_id
        INNER JOIN (
          SELECT DISTINCT confirmation_id
          FROM probation_signature_records
          WHERE signer_id = ?
            AND stage = '${reviewedStage}'
            AND signed_at >= ?
            AND signed_at < ?
        ) reviewed ON reviewed.confirmation_id = pc.id
        WHERE COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
      `;
      countParams.push(userId, monthStart, nextMonthStart);
    } else if (includeNonApplied) {
      // UNION ALL：已有转正记录的员工 + 没有转正记录的实习期员工
      const part1StatusFilter =
        status === "pending" ? `AND pc.status = 'pending'` : "";

      sql = `
        SELECT pc.id, pc.employee_id, pc.hire_date, pc.probation_end_date, pc.status,
               pc.form_version, pc.review_stage, pc.conversion_type,
               pc.conversion_type_other, pc.self_statement,
               pc.applicant_name_snapshot, pc.department_snapshot, pc.position_snapshot,
               pc.supervisor_id,
               pc.submit_time, pc.approve_time, pc.approver_id, pc.approver_comment,
               pc.application_comment, pc.formal_document_generated_at,
               pc.created_at, pc.updated_at,
               ep.name as employee_name, ep.department as employee_department,
               ep.position as employee_position, ep.mobile as employee_mobile,
               ep.hire_date as employee_hire_date
        FROM probation_confirmations pc
        INNER JOIN employee_profiles ep ON pc.employee_id = ep.id
        LEFT JOIN users employee_user ON employee_user.id = ep.user_id
        WHERE COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
        ${part1StatusFilter}

        UNION ALL

        SELECT 'virtual_' || ep2.id as id, ep2.id as employee_id, ep2.hire_date,
               NULL as probation_end_date, 'pending' as status,
               0 as form_version, 'employee' as review_stage, 'normal' as conversion_type,
               NULL as conversion_type_other, NULL as self_statement,
               NULL as applicant_name_snapshot, NULL as department_snapshot,
               NULL as position_snapshot, NULL as supervisor_id,
               NULL as submit_time, NULL as approve_time, NULL as approver_id,
               NULL as approver_comment, NULL as application_comment,
               NULL as formal_document_generated_at,
               ep2.created_at, ep2.updated_at,
               ep2.name as employee_name, ep2.department as employee_department,
               ep2.position as employee_position, ep2.mobile as employee_mobile,
               ep2.hire_date as employee_hire_date
        FROM employee_profiles ep2
        LEFT JOIN users employee_user ON employee_user.id = ep2.user_id
        WHERE ep2.employment_status = 'probation'
          AND ep2.status = 'submitted'
          AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
          AND NOT EXISTS (SELECT 1 FROM probation_confirmations pc2 WHERE pc2.employee_id = ep2.id)
      `;

      countSql = `
        SELECT (
          (SELECT COUNT(*) FROM probation_confirmations pc
           INNER JOIN employee_profiles ep ON pc.employee_id = ep.id
           LEFT JOIN users employee_user ON employee_user.id = ep.user_id
           WHERE COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
           ${part1StatusFilter})
          +
          (SELECT COUNT(*) FROM employee_profiles ep2
           LEFT JOIN users employee_user ON employee_user.id = ep2.user_id
           WHERE ep2.employment_status = 'probation'
             AND ep2.status = 'submitted'
             AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
             AND NOT EXISTS (SELECT 1 FROM probation_confirmations pc2 WHERE pc2.employee_id = ep2.id))
        ) as total
      `;
    } else {
      // 有具体 status 筛选（submitted/approved/rejected），只查 probation_confirmations
      sql = `
        SELECT pc.*, ep.name as employee_name, ep.department as employee_department,
               ep.position as employee_position, ep.mobile as employee_mobile,
               ep.hire_date as employee_hire_date
        FROM probation_confirmations pc
        INNER JOIN employee_profiles ep ON pc.employee_id = ep.id
        LEFT JOIN users employee_user ON employee_user.id = ep.user_id
        WHERE pc.status = ?
          AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
      `;
      params.push(status);

      countSql = `
        SELECT COUNT(*) as total
        FROM probation_confirmations pc
        INNER JOIN employee_profiles ep ON pc.employee_id = ep.id
        LEFT JOIN users employee_user ON employee_user.id = ep.user_id
        WHERE pc.status = ?
          AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
      `;
      countParams.push(status);

      if (thisMonth === "1" && status === "approved") {
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const nextMonthStart = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;
        sql += ` AND pc.approve_time >= ? AND pc.approve_time < ?`;
        params.push(monthStart, nextMonthStart);
        countSql += ` AND pc.approve_time >= ? AND pc.approve_time < ?`;
        countParams.push(monthStart, nextMonthStart);
      }
    }

    const countResult = (await db.prepare(countSql).get(...countParams)) as {
      total: number;
    };

    // 分页（用子查询包裹 UNION 结果）
    const { page, pageSize, offset } = pagination;
    if (includeNonApplied) {
      sql = `SELECT * FROM (${sql}) AS combined ORDER BY combined.created_at DESC LIMIT ? OFFSET ?`;
    } else if (isMyMonthlyReview) {
      sql += ` ORDER BY reviewed.reviewed_at DESC LIMIT ? OFFSET ?`;
    } else {
      sql += ` ORDER BY pc.created_at DESC LIMIT ? OFFSET ?`;
    }
    params.push(pageSize, offset);

    const list = (await db
      .prepare(sql)
      .all(...params)) as (ProbationConfirmationWithEmployee & {
      employee_hire_date?: string;
    })[];

    // 为每个申请获取文档列表，并动态计算试用期截止日期（与用户端一致）
    const listWithDocs = await Promise.all(
      list.map(async (item) => {
        const [documents, generatedDocuments] =
          item.status === "approved"
            ? await Promise.all([
                getOfficialProbationDocuments(item.id, item.form_version),
                getGeneratedProbationDocuments(item.id, item.form_version),
              ])
            : [[], []];

        const signatureRecords = item.id.startsWith("virtual_")
          ? []
          : ((await db
              .prepare(
                `
            SELECT *
            FROM probation_signature_records
            WHERE confirmation_id = ? AND form_version = ?
            ORDER BY signed_at ASC
          `,
              )
              .all(item.id, item.form_version)) as ProbationSignatureRecord[]);

        const firstSubmitRecord = (await db
          .prepare(
            `
        SELECT ar.action_time
        FROM approval_records ar
        JOIN approval_instances ai ON ar.instance_id = ai.id
        WHERE ai.target_id = ? AND ai.target_type = 'probation'
          AND ar.action IN ('submit', 'resubmit')
        ORDER BY ar.action_time ASC
        LIMIT 1
      `,
          )
          .get(item.id)) as { action_time: string } | undefined;

        // 入职日期和试用期截止均使用第一份劳动合同，续签只影响当前合同到期日期。
        const hireDate = item.employee_hire_date || item.hire_date;
        const contractInfo = await getFirstContractProbationInfo(
          item.employee_id,
        );
        const probationEndDate = resolveProbationEndDate(
          item.probation_end_date,
          contractInfo,
        );

        // 获取历史转正记录
        const probationHistoryRecords = (await db
          .prepare(
            `
        SELECT * FROM probation_history WHERE employee_id = ? ORDER BY reset_at DESC
      `,
          )
          .all(item.employee_id)) as ProbationHistoryRecord[];

        return {
          ...item,
          documents,
          generated_documents: generatedDocuments,
          submit_time: firstSubmitRecord?.action_time || item.submit_time,
          // 使用员工表中的入职日期
          hire_date: hireDate,
          // 使用动态计算的试用期截止日期
          probation_end_date: probationEndDate,
          signatures: signatureRecords.map(publicSignatureRecord),
          review_stage_label: REVIEW_STAGE_LABELS[item.review_stage],
          probation_history: probationHistoryRecords.map(
            publicProbationHistoryRecord,
          ),
        };
      }),
    );

    res.json({
      success: true,
      data: {
        list: listWithDocs,
        total: Number(countResult.total),
        page,
        pageSize,
      },
    });
  } catch (error) {
    console.error("获取待转正员工列表失败:", error);
    res.status(500).json({ success: false, message: "获取待转正员工列表失败" });
  }
});

// 获取转正统计数据（管理员）
router.get("/statistics", requireAdminOrGM, async (req, res) => {
  try {
    // 计算没有转正记录的实习期员工数量
    const nonAppliedProbation = (await db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM employee_profiles ep
      LEFT JOIN users employee_user ON employee_user.id = ep.user_id
      WHERE ep.employment_status = 'probation'
        AND ep.status = 'submitted'
        AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
        AND NOT EXISTS (SELECT 1 FROM probation_confirmations pc WHERE pc.employee_id = ep.id)
    `,
      )
      .get()) as { count: number };
    const nonAppliedCount = Number(nonAppliedProbation.count);

    const total = (await db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM probation_confirmations pc
      INNER JOIN employee_profiles ep ON ep.id = pc.employee_id
      LEFT JOIN users employee_user ON employee_user.id = ep.user_id
      WHERE COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
    `,
      )
      .get()) as { count: number };

    const pending = (await db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM probation_confirmations pc
      INNER JOIN employee_profiles ep ON ep.id = pc.employee_id
      LEFT JOIN users employee_user ON employee_user.id = ep.user_id
      WHERE pc.status = 'pending'
        AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
    `,
      )
      .get()) as { count: number };

    const submitted = (await db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM probation_confirmations pc
      INNER JOIN employee_profiles ep ON ep.id = pc.employee_id
      LEFT JOIN users employee_user ON employee_user.id = ep.user_id
      WHERE pc.status = 'submitted'
        AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
    `,
      )
      .get()) as { count: number };

    const approved = (await db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM probation_confirmations pc
      INNER JOIN employee_profiles ep ON ep.id = pc.employee_id
      LEFT JOIN users employee_user ON employee_user.id = ep.user_id
      WHERE pc.status = 'approved'
        AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
    `,
      )
      .get()) as { count: number };

    const rejected = (await db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM probation_confirmations pc
      INNER JOIN employee_profiles ep ON ep.id = pc.employee_id
      LEFT JOIN users employee_user ON employee_user.id = ep.user_id
      WHERE pc.status = 'rejected'
        AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
    `,
      )
      .get()) as { count: number };

    res.json({
      success: true,
      data: {
        total: Number(total.count) + nonAppliedCount,
        pending: Number(pending.count) + nonAppliedCount,
        submitted: Number(submitted.count),
        approved: Number(approved.count),
        rejected: Number(rejected.count),
      },
    });
  } catch (error) {
    console.error("获取转正统计失败:", error);
    res.status(500).json({ success: false, message: "获取转正统计失败" });
  }
});

// 获取当前用户的转正状态
router.get("/my-status", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    // 获取当前用户的员工信息
    const profile = (await db
      .prepare(
        `
      SELECT ep.id, ep.name, ep.department, ep.position, ep.hire_date,
             ep.employment_status, u.role AS user_role
      FROM employee_profiles ep
      INNER JOIN users u ON u.id = ep.user_id
      WHERE ep.user_id = ?
    `,
      )
      .get(userId)) as
      | {
          id: string;
          name: string;
          department: string;
          position: string;
          hire_date: string | null;
          employment_status: string;
          user_role: string;
        }
      | undefined;

    if (!profile || !requiresEmployeeProfile(profile.user_role)) {
      return res.json({
        success: true,
        data: null,
      });
    }

    const contractInfo = await getFirstContractProbationInfo(profile.id);

    // 获取转正申请
    const confirmation = (await db
      .prepare(
        `
      SELECT * FROM probation_confirmations WHERE employee_id = ?
    `,
      )
      .get(profile.id)) as ProbationConfirmation | undefined;

    // 如果没有转正申请记录，构造一个虚拟的记录用于前端显示
    let confirmationData: Partial<ProbationConfirmation> | null = null;
    if (confirmation) {
      const probationEndDate = resolveProbationEndDate(
        confirmation.probation_end_date,
        contractInfo,
      );
      confirmationData = {
        ...confirmation,
        probation_end_date: probationEndDate || confirmation.probation_end_date,
      };
    } else if (profile.employment_status !== "active") {
      // 未转正员工但还没有转正申请记录，使用第一份劳动合同构造虚拟记录。
      const probationEndDate = resolveProbationEndDate(null, contractInfo);
      confirmationData = {
        id: "",
        employee_id: profile.id,
        hire_date: profile.hire_date,
        probation_end_date: probationEndDate ?? undefined,
        status: "pending",
        created_at: "",
        updated_at: "",
      };
    }

    // 员工只查看管理员在人事档案中上传的正式盖章文件。
    let documents: ProbationDocument[] = [];
    if (confirmation?.status === "approved") {
      documents = await getOfficialProbationDocuments(
        confirmation.id,
        confirmation.form_version,
      );
    }

    let signatures: ReturnType<typeof publicSignatureRecord>[] = [];
    let signatureHistory: ReturnType<typeof publicSignatureRecord>[] = [];
    let supervisorName: string | null = null;
    if (confirmation) {
      const signatureRecords = (await db
        .prepare(
          `
        SELECT *
        FROM probation_signature_records
        WHERE confirmation_id = ?
        ORDER BY form_version ASC, signed_at ASC
      `,
        )
        .all(confirmation.id)) as ProbationSignatureRecord[];
      signatureHistory = signatureRecords.map(publicSignatureRecord);
      signatures = signatureHistory.filter(
        (record) => record.form_version === confirmation.form_version,
      );

      if (confirmation.supervisor_id) {
        const supervisor = (await db
          .prepare(
            `
          SELECT name FROM users WHERE id = ?
        `,
          )
          .get(confirmation.supervisor_id)) as { name: string } | undefined;
        supervisorName = supervisor?.name || null;
      }
    }

    let firstSubmitTime: string | null = confirmation?.submit_time || null;
    if (confirmation) {
      const firstSubmitRecord = (await db
        .prepare(
          `
        SELECT ar.action_time
        FROM approval_records ar
        JOIN approval_instances ai ON ar.instance_id = ai.id
        WHERE ai.target_id = ? AND ai.target_type = 'probation'
          AND ar.action IN ('submit', 'resubmit')
        ORDER BY ar.action_time ASC
        LIMIT 1
      `,
        )
        .get(confirmation.id)) as { action_time: string } | undefined;
      firstSubmitTime =
        firstSubmitRecord?.action_time || confirmation.submit_time || null;
      confirmationData = {
        ...confirmationData,
        submit_time: firstSubmitTime,
      };
    }

    // 是否有过提交历史（用于判断撤回后是否可以删除）
    let hasHistory = false;
    if (confirmation) {
      const historyCount = (await db
        .prepare(
          `
        SELECT COUNT(*) as count FROM approval_records ar
        JOIN approval_instances ai ON ar.instance_id = ai.id
        WHERE ai.target_id = ? AND ai.target_type = 'probation'
        AND ar.action IN ('submit', 'resubmit')
      `,
        )
        .get(confirmation.id)) as { count: number } | undefined;
      hasHistory = (historyCount?.count ?? 0) > 0;
    }

    // 获取历史转正记录（管理员将员工改回实习期时归档的记录）
    const probationHistoryRecords = (await db
      .prepare(
        `
      SELECT * FROM probation_history WHERE employee_id = ? ORDER BY reset_at DESC
    `,
      )
      .all(profile.id)) as ProbationHistoryRecord[];

    res.json({
      success: true,
      data: {
        profile: {
          id: profile.id,
          name: profile.name,
          department: profile.department,
          position: profile.position,
          hire_date: profile.hire_date,
          employment_status: profile.employment_status,
        },
        confirmation: confirmationData,
        hasHistory,
        hasRealConfirmation: !!confirmation,
        documents,
        signatures,
        signatureHistory,
        reviewStageLabel: confirmation
          ? REVIEW_STAGE_LABELS[confirmation.review_stage]
          : REVIEW_STAGE_LABELS.employee,
        supervisorName,
        approverNames: buildProbationApproverNames(
          confirmation || confirmationData || {},
          profile.name,
          supervisorName,
        ),
        probationHistory: probationHistoryRecords.map(
          publicProbationHistoryRecord,
        ),
      },
    });
  } catch (error) {
    console.error("获取转正状态失败:", error);
    res.status(500).json({ success: false, message: "获取转正状态失败" });
  }
});

// 历史转正记录的审批明细从归档快照读取，避免重置后丢失原流程。
router.get(
  "/history/:historyId/approval-flow",
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.session.userId!;
      const history = (await db
        .prepare(
          `
        SELECT
          ph.*,
          ep.user_id AS employee_user_id,
          ep.name AS employee_name,
          approver.name AS approver_name
        FROM probation_history ph
        JOIN employee_profiles ep ON ep.id = ph.employee_id
        LEFT JOIN users approver ON approver.id = ph.approver_id
        WHERE ph.id = ?
        LIMIT 1
      `,
        )
        .get(req.params.historyId)) as
        | (ProbationHistoryRecord & {
            employee_user_id: string | null;
            employee_name: string;
            approver_name: string | null;
          })
        | undefined;

      if (!history) {
        return res
          .status(404)
          .json({ success: false, message: "历史转正记录不存在" });
      }

      let approvalRecords = parseArchivedRecords<ArchivedApprovalRecord>(
        history.approval_records_json,
      );
      if (!approvalRecords.length) {
        approvalRecords = buildLegacyApprovalRecords(history);
      }
      const signatureHistory = parseArchivedRecords<{
        signer_id?: string;
      }>(history.signature_history_json);
      const user = (await db
        .prepare("SELECT role FROM users WHERE id = ?")
        .get(userId)) as { role: string } | undefined;
      const canView =
        history.employee_user_id === userId ||
        ["admin", "super_admin", "general_manager", "chairman"].includes(
          user?.role || "",
        ) ||
        approvalRecords.some((record) => record.approver_id === userId) ||
        signatureHistory.some((record) => record.signer_id === userId);

      if (!canView) {
        return res
          .status(403)
          .json({ success: false, message: "无权查看该历史审批记录" });
      }

      res.json({
        success: true,
        data: {
          history: publicProbationHistoryRecord(history),
          records: approvalRecords,
          signatures: signatureHistory,
        },
      });
    } catch (error) {
      console.error("获取历史转正审批记录失败:", error);
      res
        .status(500)
        .json({ success: false, message: "获取历史转正审批记录失败" });
    }
  },
);

// 签名图片仅供申请人、签署人及本流程有权限的管理人员在原模板中回显。
router.get("/signatures/:signatureId/image", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const signature = (await db
      .prepare(
        `
      SELECT
        psr.id,
        psr.signer_id,
        psr.signature_path,
        pc.supervisor_id,
        ep.user_id AS employee_user_id
      FROM probation_signature_records psr
      JOIN probation_confirmations pc ON pc.id = psr.confirmation_id
      JOIN employee_profiles ep ON ep.id = pc.employee_id
      WHERE psr.id = ?
      LIMIT 1
    `,
      )
      .get(req.params.signatureId)) as
      | {
          id: string;
          signer_id: string;
          signature_path: string;
          supervisor_id: string | null;
          employee_user_id: string | null;
        }
      | undefined;

    if (!signature) {
      return res
        .status(404)
        .json({ success: false, message: "电子签名不存在" });
    }

    const viewer = (await db
      .prepare(
        `
      SELECT role FROM users WHERE id = ? AND status = 'active'
    `,
      )
      .get(userId)) as { role: string } | undefined;
    if (!viewer) {
      return res
        .status(401)
        .json({ success: false, message: "用户不存在或已停用" });
    }

    const canView =
      [
        signature.employee_user_id,
        signature.supervisor_id,
        signature.signer_id,
      ].includes(userId) ||
      ["admin", "super_admin", "general_manager", "chairman"].includes(
        viewer.role,
      );
    if (!canView) {
      return res
        .status(403)
        .json({ success: false, message: "无权查看该电子签名" });
    }

    const filePath = toAbsoluteStoredPath(signature.signature_path);
    if (!fs.existsSync(filePath)) {
      return res
        .status(404)
        .json({ success: false, message: "电子签名文件不存在" });
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, no-store");
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error("获取转正电子签名失败:", error);
    res.status(500).json({ success: false, message: "获取转正电子签名失败" });
  }
});

// 获取当前用户需要签署的转正申请。
router.get("/signature-tasks", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const user = (await db
      .prepare(
        `
      SELECT id, role FROM users WHERE id = ? AND status = 'active'
    `,
      )
      .get(userId)) as { id: string; role: string } | undefined;
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "用户不存在或已停用" });
    }

    const tasks = (await db
      .prepare(
        `
      SELECT
        pc.*,
        COALESCE(pc.applicant_name_snapshot, ep.name) AS employee_name,
        COALESCE(pc.department_snapshot, ep.department) AS employee_department,
        COALESCE(pc.position_snapshot, ep.position) AS employee_position,
        ep.mobile AS employee_mobile,
        ep.user_id AS employee_user_id,
        supervisor.name AS supervisor_name
      FROM probation_confirmations pc
      JOIN employee_profiles ep ON ep.id = pc.employee_id
      LEFT JOIN users employee_user ON employee_user.id = ep.user_id
      LEFT JOIN users supervisor ON supervisor.id = pc.supervisor_id
      WHERE pc.status = 'submitted'
        AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
        AND COALESCE(ep.user_id, '') <> ?
        AND (
          (pc.review_stage = 'supervisor' AND pc.supervisor_id = ?)
          OR (
            pc.review_stage = 'hr'
            AND (
              (pc.hr_approver_id IS NOT NULL AND pc.hr_approver_id = ?)
              OR (
                pc.hr_approver_id IS NULL
                AND ? IN ('admin', 'super_admin')
              )
            )
          )
          OR (
            pc.review_stage = 'general_manager'
            AND (
              (pc.chairman_id IS NOT NULL AND pc.chairman_id = ?)
              OR (pc.chairman_id IS NULL AND ? = 'chairman')
            )
          )
        )
      ORDER BY pc.submit_time ASC, pc.created_at ASC
    `,
      )
      .all(userId, userId, userId, user.role, userId, user.role)) as Array<
      ProbationConfirmationWithEmployee & {
        employee_user_id: string | null;
        supervisor_name: string | null;
      }
    >;

    const result = await Promise.all(
      tasks.map(async (task) => {
        const signatureRecords = (await db
          .prepare(
            `
        SELECT *
        FROM probation_signature_records
        WHERE confirmation_id = ?
        ORDER BY form_version ASC, signed_at ASC
      `,
          )
          .all(task.id)) as ProbationSignatureRecord[];
        const signatureHistory = signatureRecords.map(publicSignatureRecord);
        const currentSignatures = signatureHistory.filter(
          (record) => record.form_version === task.form_version,
        );

        return {
          ...task,
          signatures: currentSignatures,
          signatureHistory,
          review_stage_label: REVIEW_STAGE_LABELS[task.review_stage],
          approver_names: buildProbationApproverNames(
            task,
            task.employee_name,
            task.supervisor_name,
          ),
          is_legacy_application: task.form_version === 0,
        };
      }),
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error("获取转正签署待办失败:", error);
    res.status(500).json({ success: false, message: "获取转正签署待办失败" });
  }
});

// 员工在线填写转正申请单并现场签名。
router.post("/online-submit", requireAuth, async (req, res) => {
  let signatureFilePath = "";
  let committed = false;
  try {
    const userId = req.session.userId!;
    const selfStatement =
      typeof req.body?.selfStatement === "string"
        ? req.body.selfStatement.trim()
        : "";
    const conversionType = req.body?.conversionType as ProbationConversionType;
    const conversionTypeOther =
      typeof req.body?.conversionTypeOther === "string"
        ? req.body.conversionTypeOther.trim()
        : "";

    if (!selfStatement) {
      throw new ProbationOperationError("请填写本人述职");
    }
    if (selfStatement.length > 3000) {
      throw new ProbationOperationError("本人述职不能超过 3000 个字符");
    }
    if (!CONVERSION_TYPES.has(conversionType)) {
      throw new ProbationOperationError("请选择转正类型");
    }
    if (conversionType === "other" && !conversionTypeOther) {
      throw new ProbationOperationError("请填写其他转正类型");
    }
    if (conversionTypeOther.length > 30) {
      throw new ProbationOperationError("其他转正类型不能超过 30 个字符");
    }
    const requestedSignatureType = parseSigningSignatureType(
      req.body?.signatureType,
    );

    const nowDate = new Date();
    const now = nowDate.toISOString();
    let confirmationId = "";

    await db.transaction(async (client) => {
      const profileResult = await client.query<{
        id: string;
        user_id: string | null;
        employee_no: string | null;
        name: string;
        user_role: string;
        department: string | null;
        position: string | null;
        employment_status: string;
      }>(
        `SELECT
           ep.id,
           ep.user_id,
           ep.employee_no,
           ep.name,
           u.role AS user_role,
           ep.department,
           ep.position,
           ep.employment_status
         FROM employee_profiles ep
         JOIN users u ON u.id = ep.user_id
         WHERE ep.user_id = $1
         FOR UPDATE OF ep`,
        [userId],
      );
      const profile = profileResult.rows[0];
      if (!profile) throw new ProbationOperationError("请先完成入职信息填写");
      if (!requiresEmployeeProfile(profile.user_role)) {
        throw new ProbationOperationError("系统账号不参与员工转正", 403);
      }
      if (profile.employment_status !== "probation") {
        throw new ProbationOperationError(
          "当前状态不是实习期，无法申请转正",
          409,
        );
      }
      if (!profile.department || !profile.position) {
        throw new ProbationOperationError(
          "员工部门或职位未设置，请联系管理员完善后再提交",
          409,
        );
      }

      const contractResult = await client.query<{
        contract_start_date: string;
        probation_end_date: string | null;
      }>(
        `SELECT contract_start_date, probation_end_date
         FROM employee_documents
         WHERE employee_id = $1
           AND document_type = 'contract'
           AND contract_start_date IS NOT NULL
           AND contract_end_date IS NOT NULL
         ORDER BY contract_start_date ASC, created_at ASC
         LIMIT 1
         FOR SHARE`,
        [profile.id],
      );
      const firstContract = contractResult.rows[0];
      if (!firstContract) {
        throw new ProbationOperationError(
          "请先由管理员上传并成功识别第一份劳动合同",
          409,
        );
      }
      if (!firstContract.probation_end_date) {
        throw new ProbationOperationError(
          "第一份劳动合同未设置试用期，无需提交转正申请",
          409,
        );
      }

      const confirmationResult = await client.query<ProbationConfirmation>(
        `SELECT *
         FROM probation_confirmations
         WHERE employee_id = $1
         FOR UPDATE`,
        [profile.id],
      );
      let confirmation = confirmationResult.rows[0];
      if (!confirmation) {
        confirmationId = nanoid();
        await client.query(
          `INSERT INTO probation_confirmations (
             id, employee_id, hire_date, probation_end_date, status,
             form_version, review_stage, conversion_type,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,'pending',0,'employee','normal',$5,$6)`,
          [
            confirmationId,
            profile.id,
            firstContract.contract_start_date,
            firstContract.probation_end_date,
            now,
            now,
          ],
        );
        const created = await client.query<ProbationConfirmation>(
          `SELECT * FROM probation_confirmations WHERE id = $1 FOR UPDATE`,
          [confirmationId],
        );
        confirmation = created.rows[0];
      } else {
        confirmationId = confirmation.id;
      }

      if (!confirmation)
        throw new ProbationOperationError("转正记录创建失败", 500);
      if (!["pending", "rejected"].includes(confirmation.status)) {
        throw new ProbationOperationError(
          "当前申请正在签署或已处理，不能重复提交",
          409,
        );
      }

      const signingSignature = await loadSigningSignature(
        client,
        {
          id: userId,
          name: profile.name,
          role: profile.user_role,
          department: profile.department,
          position: profile.position,
        },
        requestedSignatureType,
      );
      const supervisor = await resolveSupervisor(client, profile.id);
      const hrApprover = await resolveHrApprover(client);
      const chairman = await resolveChairman(client);
      const nextVersion = Number(confirmation.form_version || 0) + 1;
      const signatureDirectory = ensureDatedUploadDirectory(
        "probation-signatures",
        nowDate,
        confirmation.id,
        String(nextVersion),
      );
      signatureFilePath = path.join(
        signatureDirectory,
        `employee-${Date.now()}.png`,
      );
      fs.writeFileSync(signatureFilePath, signingSignature.buffer);
      const storedSignaturePath = toStoredUploadPath(signatureFilePath, true);

      await client.query(
        `UPDATE probation_confirmations
         SET hire_date = $1,
             probation_end_date = $2,
             status = 'submitted',
             form_version = $3,
             review_stage = 'supervisor',
             conversion_type = $4,
             conversion_type_other = $5,
             self_statement = $6,
             applicant_name_snapshot = $7,
             department_snapshot = $8,
             position_snapshot = $9,
             supervisor_id = $10,
             supervisor_name_snapshot = $11,
             hr_approver_id = $12,
             hr_approver_name_snapshot = $13,
             chairman_id = $14,
             chairman_name_snapshot = $15,
             submit_time = $16,
             approve_time = NULL,
             approver_id = NULL,
             approver_comment = NULL,
             application_comment = $6,
             formal_document_generated_at = NULL,
             updated_at = $17
         WHERE id = $18`,
        [
          firstContract.contract_start_date,
          firstContract.probation_end_date,
          nextVersion,
          conversionType,
          conversionType === "other" ? conversionTypeOther : null,
          selfStatement,
          profile.name,
          profile.department,
          profile.position,
          supervisor.id,
          supervisor.name,
          hrApprover.id,
          hrApprover.name,
          chairman.id,
          chairman.name,
          now,
          now,
          confirmation.id,
        ],
      );

      await client.query(
        `UPDATE approval_instances
         SET status = 'cancelled', complete_time = $1, updated_at = $2
         WHERE target_id = $3
           AND target_type = 'probation'
           AND status = 'pending'`,
        [now, now, confirmation.id],
      );

      const instanceId = nanoid();
      await client.query(
        `INSERT INTO approval_instances (
           id, flow_id, type, target_id, target_type,
           applicant_id, current_step, status, submit_time, created_at, updated_at
         ) VALUES ($1,NULL,'probation',$2,'probation',$3,1,'pending',$4,$5,$6)`,
        [instanceId, confirmation.id, userId, now, now, now],
      );
      await client.query(
        `INSERT INTO probation_signature_records (
           id, confirmation_id, form_version, stage, signer_id,
           signer_name, signer_role, signer_department, signer_position,
           signature_path, signature_type, signature_owner_name,
           opinion, decision, signed_at, created_at
         ) VALUES ($1,$2,$3,'employee',$4,$5,$6,$7,$8,$9,$10,$11,NULL,'submit',$12,$13)`,
        [
          nanoid(),
          confirmation.id,
          nextVersion,
          userId,
          profile.name,
          profile.user_role,
          profile.department,
          profile.position,
          storedSignaturePath,
          signingSignature.type,
          signingSignature.ownerName,
          now,
          now,
        ],
      );
      await client.query(
        `INSERT INTO approval_records (
           id, instance_id, step, approver_id, action, comment, action_time
         ) VALUES ($1,$2,0,$3,$4,$5,$6)`,
        [
          nanoid(),
          instanceId,
          userId,
          nextVersion > 1 ? "resubmit" : "submit",
          selfStatement,
          now,
        ],
      );
    });
    committed = true;

    const updated = await db
      .prepare(
        `
      SELECT * FROM probation_confirmations WHERE id = ?
    `,
      )
      .get(confirmationId);
    res.json({
      success: true,
      message: "转正申请已签名提交，等待总经理签署主管领导意见",
      data: updated,
    });
  } catch (error) {
    if (!committed && signatureFilePath && fs.existsSync(signatureFilePath)) {
      try {
        fs.unlinkSync(signatureFilePath);
      } catch {
        // 忽略失败事务的临时签名清理异常。
      }
    }
    console.error("在线提交转正申请失败:", error);
    if (error instanceof ProbationOperationError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "在线提交转正申请失败" });
  }
});

// 总经理签主管意见，管理员签人事部意见，董事长完成最终审批。
router.post("/:id/sign-review", requireAuth, async (req, res) => {
  let signatureFilePath = "";
  let generatedFilePath = "";
  let committed = false;
  try {
    const { id } = req.params;
    const userId = req.session.userId!;
    const decision = req.body?.decision;
    const opinion =
      typeof req.body?.opinion === "string" ? req.body.opinion.trim() : "";
    if (!["approve", "reject"].includes(decision)) {
      throw new ProbationOperationError("请选择通过或驳回");
    }
    if (!opinion) {
      throw new ProbationOperationError(
        decision === "reject" ? "请填写驳回原因" : "请填写签署意见",
      );
    }
    if (opinion.length > 1000) {
      throw new ProbationOperationError("签署意见不能超过 1000 个字符");
    }
    const requestedSignatureType = parseSigningSignatureType(
      req.body?.signatureType,
    );

    const nowDate = new Date();
    const now = nowDate.toISOString();
    let responseMessage = "";

    await db.transaction(async (client) => {
      const signer = await getSignerSnapshot(client, userId);
      const confirmationResult = await client.query<
        ProbationConfirmation & {
          employee_user_id: string | null;
          employee_no: string | null;
          employee_name: string;
          employee_department: string | null;
          employee_position: string | null;
        }
      >(
        `SELECT
           pc.*,
           ep.user_id AS employee_user_id,
           ep.employee_no,
           ep.name AS employee_name,
           ep.department AS employee_department,
           ep.position AS employee_position
         FROM probation_confirmations pc
         JOIN employee_profiles ep ON ep.id = pc.employee_id
         WHERE pc.id = $1
         FOR UPDATE OF pc, ep`,
        [id],
      );
      const confirmation = confirmationResult.rows[0];
      if (!confirmation)
        throw new ProbationOperationError("转正申请不存在", 404);
      if (confirmation.status !== "submitted") {
        throw new ProbationOperationError("该申请已经处理或不在签署状态", 409);
      }
      if (confirmation.employee_user_id === userId) {
        throw new ProbationOperationError("申请人不能审批自己的转正申请", 403);
      }
      if (
        !["supervisor", "hr", "general_manager"].includes(
          confirmation.review_stage,
        )
      ) {
        throw new ProbationOperationError("当前环节不允许审批签名", 409);
      }
      const stage = confirmation.review_stage as ActiveReviewStage;
      if (!canSignStage(stage, signer, confirmation)) {
        throw new ProbationOperationError(
          `当前账号不是${REVIEW_STAGE_LABELS[stage]}的签署人`,
          403,
        );
      }
      const signingSignature = await loadSigningSignature(
        client,
        signer,
        requestedSignatureType,
      );
      if (confirmation.form_version === 0 && decision === "approve") {
        throw new ProbationOperationError(
          "历史上传式申请需先驳回，再由员工在线填写并签名",
          409,
        );
      }

      const instanceResult = await client.query<{ id: string }>(
        `SELECT id
         FROM approval_instances
         WHERE target_id = $1
           AND target_type = 'probation'
           AND status = 'pending'
         FOR UPDATE`,
        [id],
      );
      if (instanceResult.rows.length !== 1) {
        throw new ProbationOperationError(
          "审批实例不存在、已经处理或数据不一致",
          409,
        );
      }
      const instanceId = instanceResult.rows[0].id;

      const signatureDirectory = ensureDatedUploadDirectory(
        "probation-signatures",
        nowDate,
        confirmation.id,
        String(confirmation.form_version),
      );
      signatureFilePath = path.join(
        signatureDirectory,
        `${stage}-${Date.now()}.png`,
      );
      fs.writeFileSync(signatureFilePath, signingSignature.buffer);
      const storedSignaturePath = toStoredUploadPath(signatureFilePath, true);

      await client.query(
        `INSERT INTO probation_signature_records (
           id, confirmation_id, form_version, stage, signer_id,
           signer_name, signer_role, signer_department, signer_position,
           signature_path, signature_type, signature_owner_name,
           opinion, decision, signed_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          nanoid(),
          confirmation.id,
          confirmation.form_version,
          stage,
          signer.id,
          signer.name,
          signer.role,
          signer.department,
          signer.position,
          storedSignaturePath,
          signingSignature.type,
          signingSignature.ownerName,
          opinion,
          decision,
          now,
          now,
        ],
      );
      await client.query(
        `INSERT INTO approval_records (
           id, instance_id, step, approver_id, action, comment, action_time
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          nanoid(),
          instanceId,
          REVIEW_STAGE_STEPS[stage],
          signer.id,
          decision,
          opinion,
          now,
        ],
      );

      if (decision === "reject") {
        await client.query(
          `UPDATE probation_confirmations
           SET status = 'rejected',
               review_stage = 'employee',
               approve_time = $1,
               approver_id = $2,
               approver_comment = $3,
               updated_at = $4
           WHERE id = $5`,
          [now, signer.id, opinion, now, confirmation.id],
        );
        await client.query(
          `UPDATE approval_instances
           SET status = 'rejected', complete_time = $1, updated_at = $2
           WHERE id = $3`,
          [now, now, instanceId],
        );
        responseMessage = "转正申请已驳回，员工可修改后重新签名提交";
        return;
      }

      if (stage === "supervisor") {
        await client.query(
          `UPDATE probation_confirmations
           SET review_stage = 'hr', updated_at = $1
           WHERE id = $2`,
          [now, confirmation.id],
        );
        await client.query(
          `UPDATE approval_instances SET current_step = 2, updated_at = $1 WHERE id = $2`,
          [now, instanceId],
        );
        responseMessage = "总经理已签署主管领导意见，等待管理员签署人事部意见";
        return;
      }

      if (stage === "hr") {
        await client.query(
          `UPDATE probation_confirmations
           SET review_stage = 'general_manager', updated_at = $1
           WHERE id = $2`,
          [now, confirmation.id],
        );
        await client.query(
          `UPDATE approval_instances SET current_step = 3, updated_at = $1 WHERE id = $2`,
          [now, instanceId],
        );
        responseMessage = "管理员已签署人事部意见，等待董事长完成最终审批";
        return;
      }

      const templateResult = await client.query<ProbationTemplate>(
        `SELECT * FROM probation_templates ORDER BY created_at DESC LIMIT 1`,
      );
      const template = templateResult.rows[0];
      if (!template) {
        throw new ProbationOperationError(
          "未设置转正申请单模板，无法完成审批",
          409,
        );
      }

      const signatureResult = await client.query<ProbationSignatureRecord>(
        `SELECT *
         FROM probation_signature_records
         WHERE confirmation_id = $1 AND form_version = $2
         ORDER BY signed_at ASC`,
        [confirmation.id, confirmation.form_version],
      );
      const pdfSignatures: ProbationPdfSignature[] = signatureResult.rows.map(
        (record) => ({
          stage: record.stage,
          signerName: record.signature_owner_name,
          signedAt: record.signed_at,
          signaturePath: toAbsoluteStoredPath(record.signature_path),
          opinion: record.opinion,
        }),
      );

      const outputDirectory = ensureDatedUploadDirectory(
        "probation-documents",
        nowDate,
        confirmation.id,
      );
      generatedFilePath = path.join(
        outputDirectory,
        `generated-v${confirmation.form_version}-${Date.now()}.pdf`,
      );
      await generateProbationApplicationPdf(
        toAbsoluteStoredPath(template.file_path),
        generatedFilePath,
        {
          applicantName:
            confirmation.applicant_name_snapshot || confirmation.employee_name,
          department:
            confirmation.department_snapshot ||
            confirmation.employee_department ||
            "",
          position:
            confirmation.position_snapshot ||
            confirmation.employee_position ||
            "",
          hireDate: confirmation.hire_date || "",
          conversionType: confirmation.conversion_type,
          conversionTypeOther: confirmation.conversion_type_other,
          selfStatement: confirmation.self_statement || "",
          signatures: pdfSignatures,
        },
      );

      const generatedDate = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .format(nowDate)
        .replace(/\//g, "-");
      const documentName = `${confirmation.employee_no || confirmation.employee_name}-转正申请单-待盖章-${generatedDate}.pdf`;
      const documentId = nanoid();
      await client.query(
        `INSERT INTO probation_documents (
           id, confirmation_id, employee_id, document_type, file_name, file_path,
           file_size, mime_type, uploaded_by, uploaded_by_name,
           source_type, form_version, created_at
         ) VALUES ($1,$2,$3,'application',$4,$5,$6,'application/pdf',$7,$8,'generated',$9,$10)`,
        [
          documentId,
          confirmation.id,
          confirmation.employee_id,
          documentName,
          toStoredUploadPath(generatedFilePath, true),
          fs.statSync(generatedFilePath).size,
          signer.id,
          signer.name,
          confirmation.form_version,
          now,
        ],
      );
      await client.query(
        `UPDATE probation_confirmations
         SET status = 'approved',
             review_stage = 'completed',
             approve_time = $1,
             approver_id = $2,
             approver_comment = $3,
             formal_document_generated_at = $4,
             updated_at = $5
         WHERE id = $6`,
        [now, signer.id, opinion, now, now, confirmation.id],
      );
      await client.query(
        `UPDATE approval_instances
         SET current_step = 3,
             status = 'approved',
             complete_time = $1,
             updated_at = $2
         WHERE id = $3`,
        [now, now, instanceId],
      );
      const employeeUpdate = await client.query(
        `UPDATE employee_profiles
         SET employment_status = 'active', updated_at = $1
         WHERE id = $2`,
        [now, confirmation.employee_id],
      );
      if ((employeeUpdate.rowCount ?? 0) !== 1) {
        throw new ProbationOperationError("员工档案不存在，无法完成转正", 409);
      }

      const adminUsers = await client.query<{ id: string }>(
        `SELECT id
         FROM users
         WHERE role IN ('admin', 'super_admin')
           AND status = 'active'
           AND id <> $1`,
        [signer.id],
      );
      for (const admin of adminUsers.rows) {
        await client.query(
          `INSERT INTO approval_records (
             id, instance_id, step, approver_id, action, comment, action_time
           ) VALUES ($1,$2,4,$3,'cc','转正正式申请单已生成并归档',$4)`,
          [nanoid(), instanceId, admin.id, now],
        );
      }
      responseMessage = "董事长已完成最终审批，转正完成并生成待盖章申请单";
    });
    committed = true;

    const updated = await db
      .prepare(
        `
      SELECT * FROM probation_confirmations WHERE id = ?
    `,
      )
      .get(id);
    res.json({
      success: true,
      message: responseMessage,
      data: updated,
    });
  } catch (error) {
    if (!committed) {
      for (const filePath of [signatureFilePath, generatedFilePath]) {
        if (!filePath || !fs.existsSync(filePath)) continue;
        try {
          fs.unlinkSync(filePath);
        } catch {
          // 忽略失败事务的临时文件清理异常。
        }
      }
    }
    console.error("签署转正申请失败:", error);
    if (error instanceof ProbationOperationError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "签署转正申请失败" });
  }
});

// 旧上传式入口已停用，防止绕过在线签名和分级审批。
router.post("/apply", requireAuth, (_req, res) => {
  res.status(410).json({
    success: false,
    message: "请使用在线转正申请单填写述职并完成本人签名",
  });
});

// 提交转正申请（历史兼容实现，不再由路由触达）
router.post("/apply", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const applicationComment =
      typeof req.body?.comment === "string"
        ? req.body.comment.trim() || null
        : typeof req.body?.application_comment === "string"
          ? req.body.application_comment.trim() || null
          : null;
    const now = new Date().toISOString();
    let confirmationId = "";

    await db.transaction(async (client) => {
      const profileResult = await client.query<{
        id: string;
        employment_status: string;
      }>(
        `SELECT id, employment_status
         FROM employee_profiles
         WHERE user_id = $1
         FOR UPDATE`,
        [userId],
      );
      const profile = profileResult.rows[0];
      if (!profile) throw new ProbationOperationError("请先完成入职信息填写");
      if (profile.employment_status !== "probation") {
        throw new ProbationOperationError(
          "当前状态不是实习期，无法申请转正",
          409,
        );
      }

      const confirmationResult = await client.query<{
        id: string;
        status: string;
      }>(
        `SELECT id, status
         FROM probation_confirmations
         WHERE employee_id = $1
         FOR UPDATE`,
        [profile.id],
      );
      const confirmation = confirmationResult.rows[0];
      if (!confirmation)
        throw new ProbationOperationError("转正记录不存在，请联系管理员", 404);
      if (confirmation.status === "submitted") {
        throw new ProbationOperationError("您已提交转正申请，请等待审批", 409);
      }
      if (confirmation.status === "approved") {
        throw new ProbationOperationError("您的转正申请已通过", 409);
      }
      if (!["pending", "rejected"].includes(confirmation.status)) {
        throw new ProbationOperationError("当前转正记录状态不允许提交", 409);
      }

      const documentResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM probation_documents
         WHERE confirmation_id = $1`,
        [confirmation.id],
      );
      if (Number(documentResult.rows[0]?.count || 0) === 0) {
        throw new ProbationOperationError("请先上传转正申请表");
      }

      confirmationId = confirmation.id;
      const hadRejected = confirmation.status === "rejected";
      await client.query(
        `UPDATE probation_confirmations
         SET status = 'submitted', submit_time = $1, application_comment = $2, updated_at = $3
         WHERE id = $4`,
        [now, applicationComment, now, confirmation.id],
      );

      await client.query(
        `UPDATE approval_instances
         SET status = 'cancelled', updated_at = $1
         WHERE target_id = $2 AND target_type = 'probation' AND status = 'pending'`,
        [now, confirmation.id],
      );

      const instanceId = nanoid();
      await client.query(
        `INSERT INTO approval_instances (
           id, flow_id, type, target_id, target_type,
           applicant_id, current_step, status, submit_time, created_at, updated_at
         ) VALUES ($1, NULL, 'probation', $2, 'probation', $3, 1, 'pending', $4, $5, $6)`,
        [instanceId, confirmation.id, userId, now, now, now],
      );

      const submitAction = hadRejected ? "resubmit" : "submit";
      const baseSubmitComment = hadRejected
        ? "员工驳回后重新提交转正申请"
        : "员工提交转正申请";
      const submitComment = applicationComment
        ? `${baseSubmitComment}；说明：${applicationComment}`
        : baseSubmitComment;
      await client.query(
        `INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
         VALUES ($1,$2,0,$3,$4,$5,$6)`,
        [nanoid(), instanceId, userId, submitAction, submitComment, now],
      );
    });

    const updated = await db
      .prepare(
        `
      SELECT * FROM probation_confirmations WHERE id = ?
    `,
      )
      .get(confirmationId);

    res.json({
      success: true,
      message: "转正申请已提交",
      data: updated,
    });
  } catch (error) {
    console.error("提交转正申请失败:", error);
    if (error instanceof ProbationOperationError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "提交转正申请失败" });
  }
});

router.post("/upload-doc", requireAuth, (_req, res) => {
  res.status(410).json({
    success: false,
    message: "转正申请已改为在线填写和签名，不再上传申请表",
  });
});

// 上传转正申请书（历史兼容实现，不再由路由触达）
router.post(
  "/upload-doc",
  requireAuth,
  uploadProbationDoc.single("file"),
  async (req, res) => {
    let cleanupPath = req.file?.path || null;
    try {
      const userId = req.session.userId;
      const { originalFileName, application_comment } = req.body;
      const file = req.file;

      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "请选择要上传的文件" });
      }

      // 获取当前用户的员工信息
      const profile = (await db
        .prepare(
          `
      SELECT id, hire_date FROM employee_profiles WHERE user_id = ?
    `,
        )
        .get(userId)) as { id: string; hire_date: string | null } | undefined;

      if (!profile) {
        fs.unlinkSync(file.path);
        return res
          .status(400)
          .json({ success: false, message: "请先完成入职信息填写" });
      }

      const contractInfo = await getFirstContractProbationInfo(profile.id);
      if (!profile.hire_date || !contractInfo.hasRecognizedContract) {
        fs.unlinkSync(file.path);
        return res.status(400).json({
          success: false,
          message: "请先由管理员上传并成功识别劳动合同",
        });
      }
      if (!contractInfo.probationEndDate) {
        fs.unlinkSync(file.path);
        return res.status(400).json({
          success: false,
          message: "第一份劳动合同未设置试用期，无需提交转正申请",
        });
      }

      // 获取或创建转正申请记录
      let confirmation = (await db
        .prepare(
          `
      SELECT id, status, application_comment FROM probation_confirmations WHERE employee_id = ?
    `,
        )
        .get(profile.id)) as
        | { id: string; status: string; application_comment: string | null }
        | undefined;

      // 如果转正记录不存在，自动创建一个
      if (!confirmation) {
        const now = new Date().toISOString();
        await db
          .prepare(
            `
        INSERT INTO probation_confirmations (
          id, employee_id, hire_date, probation_end_date, status, application_comment, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
        ON CONFLICT (employee_id) DO NOTHING
      `,
          )
          .run(
            nanoid(),
            profile.id,
            profile.hire_date,
            contractInfo.probationEndDate,
            application_comment?.trim() || null,
            now,
            now,
          );

        confirmation = (await db
          .prepare(
            `
        SELECT id, status, application_comment
        FROM probation_confirmations
        WHERE employee_id = ?
      `,
          )
          .get(profile.id)) as
          | { id: string; status: string; application_comment: string | null }
          | undefined;
      }

      if (!confirmation) {
        fs.unlinkSync(file.path);
        return res
          .status(400)
          .json({ success: false, message: "转正记录不存在" });
      }

      if (!["pending", "rejected"].includes(confirmation.status)) {
        fs.unlinkSync(file.path);
        cleanupPath = null;
        return res.status(409).json({
          success: false,
          message: "当前申请正在审批或已处理，无法修改文件",
        });
      }

      // 移动文件到正确目录
      const uploadedAt = fs.statSync(file.path).mtime;
      const destDir = ensureDatedUploadDirectory(
        "probation-documents",
        uploadedAt,
        confirmation.id,
      );
      const newPath = path.join(destDir, file.filename);
      fs.renameSync(file.path, newPath);
      cleanupPath = newPath;

      // 获取上传者信息
      const uploader = (await db
        .prepare(
          `
      SELECT name FROM users WHERE id = ?
    `,
        )
        .get(userId)) as { name: string } | undefined;

      // 优先使用前端传递的原始文件名，否则尝试解码
      const decodedFileName =
        originalFileName ||
        Buffer.from(file.originalname, "latin1").toString("utf8");

      const docId = nanoid();
      const now = new Date().toISOString();
      const relativePath = toStoredUploadPath(newPath, true);

      await db.transaction(async (client) => {
        const lockedResult = await client.query<{ status: string }>(
          `SELECT status FROM probation_confirmations WHERE id = $1 FOR UPDATE`,
          [confirmation.id],
        );
        if (!lockedResult.rows[0])
          throw new ProbationOperationError("转正记录不存在", 404);
        if (!["pending", "rejected"].includes(lockedResult.rows[0].status)) {
          throw new ProbationOperationError(
            "当前申请正在审批或已处理，无法修改文件",
            409,
          );
        }

        await client.query(
          `UPDATE probation_confirmations SET application_comment = $1, updated_at = $2 WHERE id = $3`,
          [application_comment?.trim() || null, now, confirmation.id],
        );
        await client.query(
          `INSERT INTO probation_documents (
           id, confirmation_id, employee_id, document_type, file_name, file_path,
           file_size, mime_type, uploaded_by, uploaded_by_name, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            docId,
            confirmation.id,
            profile.id,
            "application",
            decodedFileName,
            relativePath,
            file.size,
            file.mimetype,
            userId,
            uploader?.name || null,
            now,
          ],
        );
      });
      cleanupPath = null;

      const document = await db
        .prepare(
          `
      SELECT * FROM probation_documents WHERE id = ?
    `,
        )
        .get(docId);

      res.json({
        success: true,
        message: "文件上传成功",
        data: document,
      });
    } catch (error) {
      console.error("上传转正文件失败:", error);
      if (cleanupPath) {
        try {
          if (fs.existsSync(cleanupPath)) fs.unlinkSync(cleanupPath);
        } catch (e) {
          // 忽略删除失败
        }
      }
      if (error instanceof ProbationOperationError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: "上传转正文件失败" });
    }
  },
);

// 删除转正申请书（员工）
router.delete("/my-doc/:docId", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const { docId } = req.params;
    let storedPath = "";

    await db.transaction(async (client) => {
      const confirmationResult = await client.query<{
        id: string;
        status: string;
      }>(
        `SELECT pc.id, pc.status
         FROM probation_confirmations pc
         JOIN employee_profiles ep ON ep.id = pc.employee_id
         WHERE ep.user_id = $1
         FOR UPDATE OF pc`,
        [userId],
      );
      const confirmation = confirmationResult.rows[0];
      if (!confirmation)
        throw new ProbationOperationError("转正记录不存在", 404);
      if (!["pending", "rejected"].includes(confirmation.status)) {
        throw new ProbationOperationError(
          "当前申请正在审批或已处理，无法删除文件",
          409,
        );
      }

      const documentResult = await client.query<ProbationDocument>(
        `SELECT * FROM probation_documents WHERE id = $1 AND confirmation_id = $2`,
        [docId, confirmation.id],
      );
      const document = documentResult.rows[0];
      if (!document) throw new ProbationOperationError("文件不存在", 404);

      storedPath = document.file_path;
      await client.query(`DELETE FROM probation_documents WHERE id = $1`, [
        docId,
      ]);
    });

    const filePath = path.join(process.cwd(), storedPath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: "文件删除成功",
    });
  } catch (error) {
    console.error("删除转正文件失败:", error);
    if (error instanceof ProbationOperationError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "删除转正文件失败" });
  }
});

// 下载/预览转正申请书（员工自己的文件）
router.get("/my-doc/:docId/download", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { docId } = req.params;

    // 获取当前用户的员工信息
    const profile = (await db
      .prepare(
        `
      SELECT id FROM employee_profiles WHERE user_id = ?
    `,
      )
      .get(userId)) as { id: string } | undefined;

    if (!profile) {
      return res
        .status(400)
        .json({ success: false, message: "员工信息不存在" });
    }

    // 获取转正申请
    const confirmation = (await db
      .prepare(
        `
      SELECT id, status, form_version FROM probation_confirmations WHERE employee_id = ?
    `,
      )
      .get(profile.id)) as
      | { id: string; status: string; form_version: number }
      | undefined;

    if (!confirmation) {
      return res
        .status(400)
        .json({ success: false, message: "转正记录不存在" });
    }
    if (confirmation.status !== "approved") {
      return res.status(409).json({
        success: false,
        message: "转正通过后才能查看正式转正申请单",
      });
    }

    // 员工只允许读取管理员在人事档案归档的当前正式盖章文件。
    const formalDocuments = await getOfficialProbationDocuments(
      confirmation.id,
      confirmation.form_version,
    );
    const document = formalDocuments.find((item) => item.id === docId);

    if (!document) {
      return res.status(404).json({ success: false, message: "文件不存在" });
    }

    const filePath = path.join(process.cwd(), document.file_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "文件不存在" });
    }

    res.setHeader(
      "Content-Type",
      document.mime_type || "application/octet-stream",
    );
    const forceDownload = req.query.download === "1";
    const disposition = forceDownload
      ? "attachment"
      : isInlinePreviewMimeType(document.mime_type)
        ? "inline"
        : "attachment";
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${encodeURIComponent(document.file_name)}"`,
    );

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error("下载转正文件失败:", error);
    res.status(500).json({ success: false, message: "下载转正文件失败" });
  }
});

// 获取转正申请详情（管理员）
router.get("/:id", requireAdminOrGM, async (req, res) => {
  try {
    const { id } = req.params;

    const confirmation = (await db
      .prepare(
        `
      SELECT pc.*, ep.name as employee_name, ep.department as employee_department,
             ep.position as employee_position, ep.mobile as employee_mobile,
             ep.email as employee_email, ep.hire_date as employee_hire_date
      FROM probation_confirmations pc
      INNER JOIN employee_profiles ep ON pc.employee_id = ep.id
      LEFT JOIN users employee_user ON employee_user.id = ep.user_id
      WHERE pc.id = ?
        AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
    `,
      )
      .get(id)) as
      | (ProbationConfirmationWithEmployee & { employee_hire_date?: string })
      | undefined;

    if (!confirmation) {
      return res
        .status(404)
        .json({ success: false, message: "转正申请不存在" });
    }

    // 正式盖章件与系统生成的待盖章底稿分开返回。
    const [documents, generatedDocuments] =
      confirmation.status === "approved"
        ? await Promise.all([
            getOfficialProbationDocuments(id, confirmation.form_version),
            getGeneratedProbationDocuments(id, confirmation.form_version),
          ])
        : [[], []];
    const signatureRecords = (await db
      .prepare(
        `
      SELECT *
      FROM probation_signature_records
      WHERE confirmation_id = ?
      ORDER BY form_version ASC, signed_at ASC
    `,
      )
      .all(id)) as ProbationSignatureRecord[];
    const signatureHistory = signatureRecords.map(publicSignatureRecord);

    // 入职日期和试用期截止均使用第一份劳动合同，续签不覆盖。
    const hireDate = confirmation.employee_hire_date || confirmation.hire_date;
    const contractInfo = await getFirstContractProbationInfo(
      confirmation.employee_id,
    );
    const probationEndDate = resolveProbationEndDate(
      confirmation.probation_end_date,
      contractInfo,
    );

    res.json({
      success: true,
      data: {
        ...confirmation,
        hire_date: hireDate,
        probation_end_date: probationEndDate,
        documents,
        generated_documents: generatedDocuments,
        signatures: signatureHistory.filter(
          (record) => record.form_version === confirmation.form_version,
        ),
        signatureHistory,
        review_stage_label: REVIEW_STAGE_LABELS[confirmation.review_stage],
        approver_names: buildProbationApproverNames(
          confirmation,
          confirmation.employee_name,
        ),
      },
    });
  } catch (error) {
    console.error("获取转正申请详情失败:", error);
    res.status(500).json({ success: false, message: "获取转正申请详情失败" });
  }
});

// 获取转正申请的审批流程（员工、管理员、总经理、董事长）
router.get("/:id/approval-flow", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId;

    // 检查转正申请是否存在
    const confirmation = (await db
      .prepare(
        `
      SELECT pc.*
      FROM probation_confirmations pc
      INNER JOIN employee_profiles ep ON ep.id = pc.employee_id
      LEFT JOIN users employee_user ON employee_user.id = ep.user_id
      WHERE pc.id = ?
        AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
    `,
      )
      .get(id)) as ProbationConfirmation | undefined;

    if (!confirmation) {
      return res
        .status(404)
        .json({ success: false, message: "转正申请不存在" });
    }

    // 获取用户信息和权限
    const user = (await db
      .prepare("SELECT id, role FROM users WHERE id = ?")
      .get(userId)) as { id: string; role: string } | undefined;
    if (!user) {
      return res.status(401).json({ success: false, message: "用户不存在" });
    }

    // 获取员工信息
    const employee = (await db
      .prepare("SELECT user_id, name FROM employee_profiles WHERE id = ?")
      .get(confirmation.employee_id)) as
      | { user_id: string; name: string }
      | undefined;

    // 权限检查：只有本人、管理员、总经理、董事长可以查看审批流程
    const isOwner = employee && employee.user_id === userId;
    const isAdmin = user.role === "admin" || user.role === "super_admin";
    const isGM = user.role === "general_manager";
    const isChairman = user.role === "chairman";
    const isSupervisor = confirmation.supervisor_id === userId;
    const signatureParticipation = (await db
      .prepare(
        `
      SELECT id
      FROM probation_signature_records
      WHERE confirmation_id = ? AND signer_id = ?
      LIMIT 1
    `,
      )
      .get(id, userId)) as { id: string } | undefined;

    if (
      !isOwner &&
      !isAdmin &&
      !isGM &&
      !isChairman &&
      !isSupervisor &&
      !signatureParticipation
    ) {
      return res
        .status(403)
        .json({ success: false, message: "无权查看该审批流程" });
    }

    // 获取所有审批实例（支持多次提交的完整历史）
    const instances = (await db
      .prepare(
        `
      SELECT * FROM approval_instances
      WHERE target_id = ? AND target_type = 'probation'
      ORDER BY created_at ASC
    `,
      )
      .all(id)) as any[];

    // 获取所有实例的审批记录
    const records: any[] = [];
    for (const inst of instances) {
      const instRecords = (await db
        .prepare(
          `
        SELECT
          ar.id, ar.instance_id, ar.step, ar.approver_id,
          ar.action, ar.comment, ar.action_time,
          u.name as approver_name, u.role as approver_role
        FROM approval_records ar
        LEFT JOIN users u ON ar.approver_id = u.id
        WHERE ar.instance_id = ?
        ORDER BY ar.step ASC, ar.action_time ASC
      `,
        )
        .all(inst.id)) as any[];
      records.push(...instRecords);
    }

    // 按时间排序
    records.sort(
      (a, b) =>
        new Date(a.action_time).getTime() - new Date(b.action_time).getTime(),
    );

    const firstSubmitRecord = records.find(
      (record) => record.action === "submit" || record.action === "resubmit",
    );

    // 最新的审批实例（用于状态判断）
    const instance = instances[instances.length - 1] || null;

    const gmUser = confirmation.supervisor_id
      ? ((await db
          .prepare("SELECT name FROM users WHERE id = ? LIMIT 1")
          .get(confirmation.supervisor_id)) as { name: string } | undefined)
      : undefined;

    const signatureRecords = (await db
      .prepare(
        `
      SELECT *
      FROM probation_signature_records
      WHERE confirmation_id = ?
      ORDER BY form_version ASC, signed_at ASC
    `,
      )
      .all(id)) as ProbationSignatureRecord[];

    res.json({
      success: true,
      data: {
        instance,
        confirmation: {
          status: confirmation.status,
          review_stage: confirmation.review_stage,
          review_stage_label: REVIEW_STAGE_LABELS[confirmation.review_stage],
          form_version: confirmation.form_version,
          submit_time:
            firstSubmitRecord?.action_time || confirmation.submit_time,
          approve_time: confirmation.approve_time,
          approver_comment: confirmation.approver_comment,
          approver_names: buildProbationApproverNames(
            confirmation,
            employee?.name,
            gmUser?.name,
          ),
        },
        records,
        signatures: signatureRecords.map(publicSignatureRecord),
        gmName: gmUser?.name || null,
      },
    });
  } catch (error) {
    console.error("获取审批流程失败:", error);
    res.status(500).json({ success: false, message: "获取审批流程失败" });
  }
});

// 旧的无签名审批入口已停用，所有环节必须通过 sign-review 完成。
router.post("/:id/approve", requireAuth, (_req, res) => {
  res.status(410).json({
    success: false,
    message: "请填写审批意见并完成电子签名",
  });
});
router.post("/:id/reject", requireAuth, (_req, res) => {
  res.status(410).json({
    success: false,
    message: "请填写驳回原因并完成电子签名",
  });
});

// 审批通过转正申请（历史兼容实现，不再由路由触达）
router.post("/:id/approve", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const approverId = req.session.userId!;
    const commentText = typeof comment === "string" ? comment.trim() : "";
    const now = new Date().toISOString();
    await db.transaction(async (client) => {
      const approverResult = await client.query<{ role: string }>(
        `SELECT role FROM users WHERE id = $1 AND status = 'active' FOR SHARE`,
        [approverId],
      );
      const approver = approverResult.rows[0];
      if (!approver)
        throw new ProbationOperationError("用户不存在或已停用", 401);
      if (!["general_manager", "super_admin"].includes(approver.role)) {
        throw new ProbationOperationError(
          "只有总经理或超级管理员可以审批转正申请",
          403,
        );
      }

      const confirmationResult = await client.query<ProbationConfirmation>(
        `SELECT * FROM probation_confirmations WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const confirmation = confirmationResult.rows[0];
      if (!confirmation)
        throw new ProbationOperationError("转正申请不存在", 404);
      if (confirmation.status !== "submitted") {
        throw new ProbationOperationError(
          "该申请已经处理或不在待审批状态",
          409,
        );
      }

      const instanceResult = await client.query<{ id: string }>(
        `SELECT id FROM approval_instances
         WHERE target_id = $1 AND target_type = 'probation' AND status = 'pending'
         FOR UPDATE`,
        [id],
      );
      const instance = instanceResult.rows[0];
      if (!instance || instanceResult.rows.length !== 1) {
        throw new ProbationOperationError(
          "审批实例不存在、已经处理或数据不一致",
          409,
        );
      }

      const adminUsersResult = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('admin', 'super_admin') AND status = 'active'`,
      );

      await client.query(
        `UPDATE probation_confirmations
         SET status = 'approved', approve_time = $1, approver_id = $2,
             approver_comment = $3, updated_at = $4
         WHERE id = $5`,
        [now, approverId, commentText || null, now, id],
      );
      await client.query(
        `UPDATE approval_instances
         SET status = 'approved', complete_time = $1, updated_at = $2
         WHERE id = $3`,
        [now, now, instance.id],
      );
      await client.query(
        `INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
         VALUES ($1,$2,1,$3,'approve',$4,$5)`,
        [nanoid(), instance.id, approverId, commentText || "审批通过", now],
      );

      // 管理员收到转正结果抄送记录。
      const adminUsers = adminUsersResult.rows;
      for (const adminUser of adminUsers) {
        await client.query(
          `INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
           VALUES ($1,$2,2,$3,'cc','已抄送存档',$4)`,
          [nanoid(), instance.id, adminUser.id, now],
        );
      }

      const employeeResult = await client.query(
        `UPDATE employee_profiles
         SET employment_status = 'active', updated_at = $1
         WHERE id = $2`,
        [now, confirmation.employee_id],
      );
      if ((employeeResult.rowCount ?? 0) !== 1) {
        throw new ProbationOperationError(
          "员工档案不存在，无法完成转正审批",
          409,
        );
      }
    });

    const updated = await db
      .prepare(
        `
      SELECT * FROM probation_confirmations WHERE id = ?
    `,
      )
      .get(id);

    res.json({
      success: true,
      message: "转正审批通过",
      data: updated,
    });
  } catch (error) {
    console.error("审批转正申请失败:", error);
    if (error instanceof ProbationOperationError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "审批转正申请失败" });
  }
});

// 拒绝转正申请（历史兼容实现，不再由路由触达）
router.post("/:id/reject", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const approverId = req.session.userId!;
    const commentText = typeof comment === "string" ? comment.trim() : "";

    if (!commentText) {
      return res
        .status(400)
        .json({ success: false, message: "请填写拒绝原因" });
    }
    const now = new Date().toISOString();
    await db.transaction(async (client) => {
      const approverResult = await client.query<{ role: string }>(
        `SELECT role FROM users WHERE id = $1 AND status = 'active' FOR SHARE`,
        [approverId],
      );
      const approver = approverResult.rows[0];
      if (!approver)
        throw new ProbationOperationError("用户不存在或已停用", 401);
      if (!["general_manager", "super_admin"].includes(approver.role)) {
        throw new ProbationOperationError(
          "只有总经理或超级管理员可以审批转正申请",
          403,
        );
      }

      const confirmationResult = await client.query<ProbationConfirmation>(
        `SELECT * FROM probation_confirmations WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const confirmation = confirmationResult.rows[0];
      if (!confirmation)
        throw new ProbationOperationError("转正申请不存在", 404);
      if (confirmation.status !== "submitted") {
        throw new ProbationOperationError(
          "该申请已经处理或不在待审批状态",
          409,
        );
      }

      const instanceResult = await client.query<{ id: string }>(
        `SELECT id FROM approval_instances
         WHERE target_id = $1 AND target_type = 'probation' AND status = 'pending'
         FOR UPDATE`,
        [id],
      );
      const instance = instanceResult.rows[0];
      if (!instance || instanceResult.rows.length !== 1) {
        throw new ProbationOperationError(
          "审批实例不存在、已经处理或数据不一致",
          409,
        );
      }

      await client.query(
        `UPDATE probation_confirmations
         SET status = 'rejected', approve_time = $1, approver_id = $2,
             approver_comment = $3, updated_at = $4
         WHERE id = $5`,
        [now, approverId, commentText, now, id],
      );
      await client.query(
        `UPDATE approval_instances
         SET status = 'rejected', complete_time = $1, updated_at = $2
         WHERE id = $3`,
        [now, now, instance.id],
      );
      await client.query(
        `INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
         VALUES ($1,$2,1,$3,'reject',$4,$5)`,
        [nanoid(), instance.id, approverId, commentText, now],
      );
    });

    const updated = await db
      .prepare(
        `
      SELECT * FROM probation_confirmations WHERE id = ?
    `,
      )
      .get(id);

    res.json({
      success: true,
      message: "转正申请已拒绝",
      data: updated,
    });
  } catch (error) {
    console.error("拒绝转正申请失败:", error);
    if (error instanceof ProbationOperationError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "拒绝转正申请失败" });
  }
});

// 员工硬删除转正记录（仅驳回状态可操作）
router.delete("/my-record", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const profile = (await db
      .prepare(`SELECT id FROM employee_profiles WHERE user_id = ?`)
      .get(userId)) as { id: string } | undefined;
    if (!profile)
      return res
        .status(400)
        .json({ success: false, message: "员工信息不存在" });

    const confirmation = (await db
      .prepare(
        `SELECT id, status FROM probation_confirmations WHERE employee_id = ?`,
      )
      .get(profile.id)) as { id: string; status: string } | undefined;
    if (!confirmation)
      return res
        .status(404)
        .json({ success: false, message: "转正记录不存在" });

    if (
      confirmation.status !== "rejected" &&
      confirmation.status !== "pending"
    ) {
      return res
        .status(400)
        .json({ success: false, message: "只有被驳回或撤回的申请才能删除" });
    }

    if (confirmation.status === "pending") {
      // 检查是否有提交历史（撤回后才能删除）
      const historyCount = (await db
        .prepare(
          `
        SELECT COUNT(*) as count FROM approval_records ar
        JOIN approval_instances ai ON ar.instance_id = ai.id
        WHERE ai.target_id = ? AND ai.target_type = 'probation'
        AND ar.action IN ('submit', 'resubmit')
      `,
        )
        .get(confirmation.id)) as { count: number } | undefined;
      if ((historyCount?.count ?? 0) === 0) {
        return res
          .status(400)
          .json({ success: false, message: "只有被驳回或撤回的申请才能删除" });
      }
    }

    // 删除物理文件
    const docs = (await db
      .prepare(
        `SELECT file_path FROM probation_documents WHERE confirmation_id = ?`,
      )
      .all(confirmation.id)) as { file_path: string }[];
    for (const doc of docs) {
      const fp = path.join(process.cwd(), doc.file_path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    const signatures = (await db
      .prepare(
        `
      SELECT signature_path
      FROM probation_signature_records
      WHERE confirmation_id = ?
    `,
      )
      .all(confirmation.id)) as { signature_path: string }[];
    for (const signature of signatures) {
      const fp = toAbsoluteStoredPath(signature.signature_path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }

    // 删除相关数据库记录
    await db
      .prepare(`DELETE FROM probation_documents WHERE confirmation_id = ?`)
      .run(confirmation.id);
    await db
      .prepare(
        `DELETE FROM approval_records WHERE instance_id IN (SELECT id FROM approval_instances WHERE target_id = ? AND target_type = 'probation')`,
      )
      .run(confirmation.id);
    await db
      .prepare(
        `DELETE FROM approval_instances WHERE target_id = ? AND target_type = 'probation'`,
      )
      .run(confirmation.id);
    await db
      .prepare(`DELETE FROM probation_confirmations WHERE id = ?`)
      .run(confirmation.id);

    res.json({ success: true, message: "转正记录已删除" });
  } catch (error) {
    console.error("删除转正记录失败:", error);
    res.status(500).json({ success: false, message: "删除转正记录失败" });
  }
});

// 员工撤回已提交的转正申请
router.post("/my-record/withdraw", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const now = new Date().toISOString();

    await db.transaction(async (client) => {
      const confirmationResult = await client.query<{
        id: string;
        status: string;
        review_stage: ProbationReviewStage;
      }>(
        `SELECT pc.id, pc.status, pc.review_stage
         FROM probation_confirmations pc
         JOIN employee_profiles ep ON ep.id = pc.employee_id
         WHERE ep.user_id = $1
         FOR UPDATE OF pc`,
        [userId],
      );
      const confirmation = confirmationResult.rows[0];
      if (!confirmation)
        throw new ProbationOperationError("转正记录不存在", 404);
      if (confirmation.status !== "submitted") {
        throw new ProbationOperationError("只有待审批的申请才能撤回", 409);
      }
      if (confirmation.review_stage !== "supervisor") {
        throw new ProbationOperationError(
          "主管领导已经签署，当前申请不能撤回",
          409,
        );
      }

      const instanceResult = await client.query<{ id: string }>(
        `SELECT id FROM approval_instances
         WHERE target_id = $1 AND target_type = 'probation' AND status = 'pending'
         FOR UPDATE`,
        [confirmation.id],
      );
      if (instanceResult.rows.length !== 1) {
        throw new ProbationOperationError(
          "审批实例不存在或数据不一致，无法撤回",
          409,
        );
      }
      const instance = instanceResult.rows[0];

      const confirmationUpdate = await client.query(
        `UPDATE probation_confirmations
         SET status = 'pending', review_stage = 'employee',
             submit_time = NULL, approve_time = NULL,
             approver_id = NULL, approver_comment = NULL, updated_at = $1
         WHERE id = $2 AND status = 'submitted'`,
        [now, confirmation.id],
      );
      const instanceUpdate = await client.query(
        `UPDATE approval_instances
         SET status = 'cancelled', updated_at = $1
         WHERE id = $2 AND status = 'pending'`,
        [now, instance.id],
      );
      if (
        (confirmationUpdate.rowCount ?? 0) !== 1 ||
        (instanceUpdate.rowCount ?? 0) !== 1
      ) {
        throw new ProbationOperationError("申请状态已变化，请刷新后重试", 409);
      }

      await client.query(
        `INSERT INTO approval_records (
           id, instance_id, step, approver_id, action, comment, action_time
         ) VALUES ($1,$2,0,$3,'withdraw','员工撤回转正申请',$4)`,
        [nanoid(), instance.id, userId, now],
      );
    });

    res.json({ success: true, message: "转正申请已撤回" });
  } catch (error) {
    console.error("撤回转正申请失败:", error);
    if (error instanceof ProbationOperationError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "撤回转正申请失败" });
  }
});

// 获取员工转正档案（含未经过审批流程的管理员补录材料）
router.get("/employee/:employeeId/archive", requireAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const employee = (await db
      .prepare(
        `
      SELECT ep.id, ep.name, ep.hire_date, ep.employment_status
      FROM employee_profiles ep
      LEFT JOIN users employee_user ON employee_user.id = ep.user_id
      WHERE ep.id = ?
        AND COALESCE(employee_user.role, 'user') NOT IN ('super_admin', 'boss', 'chairman')
    `,
      )
      .get(employeeId)) as
      | {
          id: string;
          name: string;
          hire_date: string | null;
          employment_status: string | null;
        }
      | undefined;

    if (!employee) {
      return res
        .status(404)
        .json({ success: false, message: "员工信息不存在" });
    }

    const confirmation = (await db
      .prepare(
        `
      SELECT pc.*, u.name AS approver_name
      FROM probation_confirmations pc
      LEFT JOIN users u ON u.id = pc.approver_id
      WHERE pc.employee_id = ?
      ORDER BY pc.created_at DESC
      LIMIT 1
    `,
      )
      .get(employeeId)) as
      | (ProbationConfirmation & { approver_name: string | null })
      | undefined;
    const contractInfo = await getFirstContractProbationInfo(employeeId);
    const resolvedConfirmation = confirmation
      ? {
          ...confirmation,
          hire_date: employee.hire_date || confirmation.hire_date,
          probation_end_date: resolveProbationEndDate(
            confirmation.probation_end_date,
            contractInfo,
          ),
        }
      : null;

    const formalDocuments = confirmation
      ? confirmation.status === "approved"
        ? await getOfficialProbationDocuments(
            confirmation.id,
            confirmation.form_version,
          )
        : []
      : ((await db
          .prepare(
            `
          SELECT *
          FROM probation_documents
          WHERE employee_id = ?
            AND confirmation_id IS NULL
            AND source_type = 'official'
          ORDER BY created_at DESC
        `,
          )
          .all(employeeId)) as ProbationDocument[]);
    const canUpload = confirmation
      ? confirmation.status === "approved" && formalDocuments.length === 0
      : employee.employment_status === "active";

    res.json({
      success: true,
      data: {
        employee,
        confirmation: resolvedConfirmation,
        documents: formalDocuments,
        archive_mode: confirmation
          ? "workflow"
          : formalDocuments.length > 0
            ? "direct"
            : "none",
        can_upload: canUpload,
      },
    });
  } catch (error) {
    console.error("获取员工转正档案失败:", error);
    res.status(500).json({ success: false, message: "获取员工转正档案失败" });
  }
});

// 管理员仅处理正式档案补录；未转正通过的流程材料由员工和审批流程维护。
router.post(
  "/employee/:employeeId/documents",
  requireAdmin,
  uploadProbationDoc.single("file"),
  async (req, res) => {
    let cleanupPath = req.file?.path || null;
    try {
      const { employeeId } = req.params;
      const { originalFileName } = req.body;
      const file = req.file;

      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "请选择要上传的文件" });
      }

      const uploadedAt = fs.statSync(file.path).mtime;
      const destDir = ensureDatedUploadDirectory(
        "probation-documents",
        uploadedAt,
        employeeId,
      );
      const newPath = path.join(destDir, file.filename);
      fs.renameSync(file.path, newPath);
      cleanupPath = newPath;

      const uploader = (await db
        .prepare(
          `
      SELECT name FROM users WHERE id = ?
    `,
        )
        .get(req.session.userId)) as { name: string } | undefined;

      const decodedFileName =
        originalFileName ||
        Buffer.from(file.originalname, "latin1").toString("utf8");
      const docId = nanoid();
      const now = new Date().toISOString();
      const relativePath = toStoredUploadPath(newPath, true);
      let confirmationId: string | null = null;
      let formVersion = 0;
      let isCompletedWorkflowSupplement = false;

      await db.transaction(async (client) => {
        const employeeResult = await client.query<{
          employment_status: string | null;
          user_role: string | null;
        }>(
          `SELECT ep.employment_status, employee_user.role AS user_role
         FROM employee_profiles ep
         LEFT JOIN users employee_user ON employee_user.id = ep.user_id
         WHERE ep.id = $1
         FOR UPDATE OF ep`,
          [employeeId],
        );
        const employee = employeeResult.rows[0];
        if (!employee) throw new ProbationOperationError("员工信息不存在", 404);
        if (!requiresEmployeeProfile(employee.user_role)) {
          throw new ProbationOperationError("系统账号不参与员工转正档案", 409);
        }

        const confirmationResult = await client.query<{
          id: string;
          status: string;
          form_version: number;
        }>(
          `SELECT id, status, form_version
         FROM probation_confirmations
         WHERE employee_id = $1
         FOR UPDATE`,
          [employeeId],
        );
        const confirmation = confirmationResult.rows[0];

        if (confirmation) {
          if (confirmation.status !== "approved") {
            throw new ProbationOperationError(
              "该员工尚未转正通过，申请表应由员工本人在正常转正流程中维护",
              409,
            );
          }

          const documentCountResult = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
           FROM probation_documents
           WHERE confirmation_id = $1
             AND document_type = 'application'
             AND source_type = 'official'`,
            [confirmation.id],
          );
          if (Number(documentCountResult.rows[0]?.count || 0) > 0) {
            throw new ProbationOperationError(
              "当前转正记录已有正式盖章文件，不能重复上传",
              409,
            );
          }
          isCompletedWorkflowSupplement = true;
          confirmationId = confirmation.id;
          formVersion = confirmation.form_version;
        } else if (employee.employment_status !== "active") {
          throw new ProbationOperationError(
            "该员工尚未建立转正记录，不能直接补录转正申请表",
            409,
          );
        }

        await client.query(
          `INSERT INTO probation_documents (
           id, confirmation_id, employee_id, document_type, file_name, file_path,
           file_size, mime_type, uploaded_by, uploaded_by_name,
           source_type, form_version, created_at
         ) VALUES ($1,$2,$3,'application',$4,$5,$6,$7,$8,$9,'official',$10,$11)`,
          [
            docId,
            confirmationId,
            employeeId,
            decodedFileName,
            relativePath,
            file.size,
            file.mimetype,
            req.session.userId,
            uploader?.name || null,
            formVersion,
            now,
          ],
        );
      });
      cleanupPath = null;

      const document = await db
        .prepare(
          `
      SELECT * FROM probation_documents WHERE id = ?
    `,
        )
        .get(docId);

      res.json({
        success: true,
        message: isCompletedWorkflowSupplement
          ? "正式盖章文件上传成功，已同步至转正申请列表"
          : "正式盖章文件已归档，未生成转正审批记录",
        data: document,
      });
    } catch (error) {
      console.error("管理员补录转正申请表失败:", error);
      if (cleanupPath) {
        try {
          if (fs.existsSync(cleanupPath)) fs.unlinkSync(cleanupPath);
        } catch {
          // 忽略临时文件清理失败
        }
      }
      if (error instanceof ProbationOperationError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: "转正申请表上传失败" });
    }
  },
);

// 管理员删除未走审批流程的补录材料；流程内材料继续使用原有状态锁定规则。
router.delete(
  "/employee/:employeeId/documents/:docId",
  requireAdmin,
  async (req, res) => {
    try {
      const { employeeId, docId } = req.params;
      let storedPath = "";

      await db.transaction(async (client) => {
        const documentResult = await client.query<ProbationDocument>(
          `SELECT *
         FROM probation_documents
         WHERE id = $1 AND employee_id = $2
         FOR UPDATE`,
          [docId, employeeId],
        );
        const document = documentResult.rows[0];
        if (!document)
          throw new ProbationOperationError("转正申请表不存在", 404);
        if (document.confirmation_id) {
          throw new ProbationOperationError(
            "审批流程内的转正申请表不能在员工档案中删除",
            409,
          );
        }

        storedPath = document.file_path;
        await client.query(`DELETE FROM probation_documents WHERE id = $1`, [
          docId,
        ]);
      });

      const filePath = path.join(process.cwd(), storedPath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      res.json({ success: true, message: "补录的转正申请表已删除" });
    } catch (error) {
      console.error("删除补录转正申请表失败:", error);
      if (error instanceof ProbationOperationError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: "删除转正申请表失败" });
    }
  },
);

// 下载员工转正档案文件（管理员）
router.get(
  "/employee/:employeeId/documents/:docId/download",
  requireAdmin,
  async (req, res) => {
    try {
      const { employeeId, docId } = req.params;
      const document = (await db
        .prepare(
          `
      SELECT pd.*
      FROM probation_documents pd
      WHERE pd.id = ? AND pd.employee_id = ?
    `,
        )
        .get(docId, employeeId)) as ProbationDocument | undefined;

      if (!document) {
        return res
          .status(404)
          .json({ success: false, message: "转正申请表不存在" });
      }

      const confirmation = (await db
        .prepare(
          `
      SELECT id, status, form_version
      FROM probation_confirmations
      WHERE employee_id = ?
      LIMIT 1
    `,
        )
        .get(employeeId)) as
        | {
            id: string;
            status: ProbationConfirmation["status"];
            form_version: number;
          }
        | undefined;

      if (confirmation && confirmation.status !== "approved") {
        return res.status(409).json({
          success: false,
          message: "转正通过后才能查看正式转正档案",
        });
      }
      if (confirmation) {
        const formalDocuments = await getOfficialProbationDocuments(
          confirmation.id,
          confirmation.form_version,
        );
        if (!formalDocuments.some((item) => item.id === document.id)) {
          return res
            .status(404)
            .json({ success: false, message: "正式转正申请单不存在" });
        }
      } else if (
        document.confirmation_id ||
        document.source_type !== "official"
      ) {
        return res
          .status(404)
          .json({ success: false, message: "正式转正申请单不存在" });
      }

      const filePath = path.join(process.cwd(), document.file_path);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: "文件不存在" });
      }

      res.setHeader(
        "Content-Type",
        document.mime_type || "application/octet-stream",
      );
      const forceDownload = req.query.download === "1";
      const disposition = forceDownload
        ? "attachment"
        : isInlinePreviewMimeType(document.mime_type)
          ? "inline"
          : "attachment";
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${encodeURIComponent(document.file_name)}"`,
      );
      res.sendFile(filePath);
    } catch (error) {
      console.error("下载员工转正档案失败:", error);
      res.status(500).json({ success: false, message: "下载文件失败" });
    }
  },
);

// 正常转正流程不允许管理员代传、代交员工申请单。
router.post("/:id/documents", requireAdmin, (_req, res) => {
  res.status(410).json({
    success: false,
    message: "正常转正申请由员工在线填写并签名，管理员不能代传申请表",
  });
});
router.post("/:id/submit", requireAdmin, (_req, res) => {
  res.status(410).json({
    success: false,
    message: "正常转正申请必须由员工本人在线签名提交",
  });
});

// 管理员上传转正文件（历史兼容实现，不再由路由触达）
router.post(
  "/:id/documents",
  requireAdmin,
  uploadProbationDoc.single("file"),
  async (req, res) => {
    let cleanupPath = req.file?.path || null;
    try {
      const { id } = req.params;
      const { originalFileName } = req.body;
      const file = req.file;

      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "请选择要上传的文件" });
      }

      // 检查转正申请是否存在
      const confirmation = (await db
        .prepare(
          `
      SELECT id, employee_id, status FROM probation_confirmations WHERE id = ?
    `,
        )
        .get(id)) as
        | { id: string; employee_id: string; status: string }
        | undefined;

      if (!confirmation) {
        fs.unlinkSync(file.path);
        cleanupPath = null;
        return res
          .status(404)
          .json({ success: false, message: "转正申请不存在" });
      }
      if (!["pending", "rejected"].includes(confirmation.status)) {
        fs.unlinkSync(file.path);
        cleanupPath = null;
        return res.status(409).json({
          success: false,
          message: "当前申请正在审批或已处理，无法修改文件",
        });
      }

      // 移动文件到正确目录
      const uploadedAt = fs.statSync(file.path).mtime;
      const destDir = ensureDatedUploadDirectory(
        "probation-documents",
        uploadedAt,
        id,
      );
      const newPath = path.join(destDir, file.filename);
      fs.renameSync(file.path, newPath);
      cleanupPath = newPath;

      // 获取上传者信息
      const uploader = (await db
        .prepare(
          `
      SELECT name FROM users WHERE id = ?
    `,
        )
        .get(req.session.userId)) as { name: string } | undefined;

      // 优先使用前端传递的原始文件名，否则尝试解码
      const decodedFileName =
        originalFileName ||
        Buffer.from(file.originalname, "latin1").toString("utf8");

      const docId = nanoid();
      const now = new Date().toISOString();
      const relativePath = toStoredUploadPath(newPath, true);

      await db.transaction(async (client) => {
        const lockedResult = await client.query<{ status: string }>(
          `SELECT status FROM probation_confirmations WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!lockedResult.rows[0])
          throw new ProbationOperationError("转正申请不存在", 404);
        if (!["pending", "rejected"].includes(lockedResult.rows[0].status)) {
          throw new ProbationOperationError(
            "当前申请正在审批或已处理，无法修改文件",
            409,
          );
        }
        await client.query(
          `INSERT INTO probation_documents (
           id, confirmation_id, employee_id, document_type, file_name, file_path,
           file_size, mime_type, uploaded_by, uploaded_by_name, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            docId,
            id,
            confirmation.employee_id,
            "application",
            decodedFileName,
            relativePath,
            file.size,
            file.mimetype,
            req.session.userId,
            uploader?.name || null,
            now,
          ],
        );
      });
      cleanupPath = null;

      const document = await db
        .prepare(
          `
      SELECT * FROM probation_documents WHERE id = ?
    `,
        )
        .get(docId);

      res.json({
        success: true,
        message: "文件上传成功",
        data: document,
      });
    } catch (error) {
      console.error("管理员上传转正文件失败:", error);
      if (cleanupPath) {
        try {
          if (fs.existsSync(cleanupPath)) fs.unlinkSync(cleanupPath);
        } catch (e) {
          // 忽略删除失败
        }
      }
      if (error instanceof ProbationOperationError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: "上传转正文件失败" });
    }
  },
);

// 管理员删除转正文件
router.delete("/:id/documents/:docId", requireAdmin, async (req, res) => {
  try {
    const { id, docId } = req.params;
    let storedPath = "";

    await db.transaction(async (client) => {
      const confirmationResult = await client.query<{ status: string }>(
        `SELECT status FROM probation_confirmations WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const confirmation = confirmationResult.rows[0];
      if (!confirmation)
        throw new ProbationOperationError("转正申请不存在", 404);
      if (!["pending", "rejected"].includes(confirmation.status)) {
        throw new ProbationOperationError(
          "当前申请正在审批或已处理，无法删除文件",
          409,
        );
      }

      const documentResult = await client.query<ProbationDocument>(
        `SELECT * FROM probation_documents WHERE id = $1 AND confirmation_id = $2`,
        [docId, id],
      );
      const document = documentResult.rows[0];
      if (!document) throw new ProbationOperationError("文件不存在", 404);

      storedPath = document.file_path;
      await client.query(`DELETE FROM probation_documents WHERE id = $1`, [
        docId,
      ]);
    });

    const filePath = path.join(process.cwd(), storedPath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: "文件删除成功",
    });
  } catch (error) {
    console.error("管理员删除转正文件失败:", error);
    if (error instanceof ProbationOperationError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "删除转正文件失败" });
  }
});

// 管理员提交转正申请（历史兼容实现，不再由路由触达）
router.post("/:id/submit", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const operatorId = req.session.userId!;
    const now = new Date().toISOString();
    await db.transaction(async (client) => {
      const confirmationResult = await client.query<{
        status: string;
        employee_user_id: string | null;
      }>(
        `SELECT pc.status, ep.user_id AS employee_user_id
         FROM probation_confirmations pc
         JOIN employee_profiles ep ON ep.id = pc.employee_id
         WHERE pc.id = $1
         FOR UPDATE OF pc`,
        [id],
      );
      const confirmation = confirmationResult.rows[0];
      if (!confirmation)
        throw new ProbationOperationError("转正申请不存在", 404);
      if (!["pending", "rejected"].includes(confirmation.status)) {
        throw new ProbationOperationError("该申请已提交或已处理", 409);
      }
      if (!confirmation.employee_user_id) {
        throw new ProbationOperationError(
          "员工档案未关联用户，无法提交审批",
          409,
        );
      }

      const documentResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM probation_documents WHERE confirmation_id = $1`,
        [id],
      );
      if (Number(documentResult.rows[0]?.count || 0) === 0) {
        throw new ProbationOperationError("请先上传转正申请表");
      }

      await client.query(
        `UPDATE approval_instances
         SET status = 'cancelled', updated_at = $1
         WHERE target_id = $2 AND target_type = 'probation' AND status = 'pending'`,
        [now, id],
      );
      await client.query(
        `UPDATE probation_confirmations
         SET status = 'submitted', submit_time = $1, updated_at = $2
         WHERE id = $3`,
        [now, now, id],
      );

      const instanceId = nanoid();
      await client.query(
        `INSERT INTO approval_instances (
           id, flow_id, type, target_id, target_type,
           applicant_id, current_step, status, submit_time, created_at, updated_at
         ) VALUES ($1,NULL,'probation',$2,'probation',$3,1,'pending',$4,$5,$6)`,
        [instanceId, id, confirmation.employee_user_id, now, now, now],
      );
      await client.query(
        `INSERT INTO approval_records (
           id, instance_id, step, approver_id, action, comment, action_time
         ) VALUES ($1,$2,0,$3,'submit','管理员代员工提交转正申请',$4)`,
        [nanoid(), instanceId, operatorId, now],
      );
    });

    const updated = await db
      .prepare(
        `
      SELECT * FROM probation_confirmations WHERE id = ?
    `,
      )
      .get(id);

    res.json({
      success: true,
      message: "转正申请已提交",
      data: updated,
    });
  } catch (error) {
    console.error("管理员提交转正申请失败:", error);
    if (error instanceof ProbationOperationError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "提交转正申请失败" });
  }
});

// 下载转正文件（管理员）
router.get(
  "/:id/documents/:docId/download",
  requireAdminOrGM,
  async (req, res) => {
    try {
      const { id, docId } = req.params;

      const confirmation = (await db
        .prepare(
          `
      SELECT id, status, form_version
      FROM probation_confirmations
      WHERE id = ?
    `,
        )
        .get(id)) as
        | {
            id: string;
            status: ProbationConfirmation["status"];
            form_version: number;
          }
        | undefined;

      const readableDocuments =
        confirmation?.status === "approved"
          ? (
              await Promise.all([
                getOfficialProbationDocuments(
                  confirmation.id,
                  confirmation.form_version,
                ),
                getGeneratedProbationDocuments(
                  confirmation.id,
                  confirmation.form_version,
                ),
              ])
            ).flat()
          : [];
      const document = readableDocuments.find((item) => item.id === docId);

      if (!document) {
        return res
          .status(404)
          .json({ success: false, message: "转正申请单不存在或尚未归档" });
      }

      const filePath = path.join(process.cwd(), document.file_path);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: "文件不存在" });
      }

      res.setHeader(
        "Content-Type",
        document.mime_type || "application/octet-stream",
      );
      const forceDownload = req.query.download === "1";
      const disposition = forceDownload
        ? "attachment"
        : isInlinePreviewMimeType(document.mime_type)
          ? "inline"
          : "attachment";
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${encodeURIComponent(document.file_name)}"`,
      );

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      console.error("下载转正文件失败:", error);
      res.status(500).json({ success: false, message: "下载转正文件失败" });
    }
  },
);

export default router;
