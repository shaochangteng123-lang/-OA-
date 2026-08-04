import { Router, type Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { PoolClient } from "pg";
import { db } from "../db/index.js";
import { requireAdmin } from "../middleware/auth.js";
import type {
  ResignationDocument,
  ResignationRequest,
  ResignationRequestWithEmployee,
  ResignationTemplate,
  ResignationType,
} from "../types/database.js";
import {
  ensureDatedUploadDirectory,
  toStoredUploadPath,
} from "../utils/upload-date.js";
import {
  RESIGNATION_ARCHIVE_LABELS,
  RESIGNATION_ARCHIVE_TYPES,
  RESIGNATION_TEMPLATE_TYPES,
  finalizeResignationArchiveWithClient,
  getMissingResignationArchiveTypes,
  isResignationArchiveType,
  refreshResignationArchiveCompletionWithClient,
  type ResignationArchiveType,
} from "../services/resignationArchive.js";
import {
  analyzeResignationDocumentBundle,
  splitResignationDocumentBundle,
  type SplitResignationDocumentFile,
} from "../services/resignationDocumentBundle.js";
import {
  PDF_MIME_TYPE,
  getResignationTemplateFileKind,
  isResignationTemplatePdfUpload,
  isPdfFile,
} from "../services/resignationTemplateFile.js";
import {
  alignResignationTemplateEditorStateToPdf,
  buildResignationFieldAlignments,
  buildResignationFieldOverrides,
  buildResignationTemplateEditorState,
  loadResignationTemplatePdfBuffer,
  mergeResignationTemplatePdfs,
  normalizeResignationOverlayDraft,
  parseResignationOverlayDraft,
  renderResignationTemplatePdf,
  type ResignationTemplateContext,
  type ResignationTemplateOverlayDraft,
} from "../services/resignationTemplatePdf.js";

const router = Router();
const VALID_RESIGNATION_TYPES = new Set<ResignationType>([
  "voluntary",
  "contract_end",
  "dismissal",
]);

class ResignationManagementError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ResignationManagementError";
  }
}

interface ResignationManagementRequest extends ResignationRequestWithEmployee {
  employee_no: string | null;
  hire_date: string | null;
  id_number: string | null;
  employment_status: string | null;
  account_status: string | null;
  first_contract_start_date: string | null;
}

interface ResignationTemplateDraftRow {
  template_id: string | null;
  overlay_json: string | null;
  updated_at: string;
  updated_by_name: string | null;
}

function resolveStoredPath(storedPath: string): string {
  return path.resolve(process.cwd(), storedPath.replace(/^[/\\]+/, ""));
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function safeUploadSubdirectory(value: unknown): string {
  const candidate = String(value || "");
  return /^[A-Za-z0-9_-]+$/.test(candidate) ? candidate : "invalid-request";
}

function resolveOriginalFileName(
  file: Express.Multer.File,
  providedName?: string,
): string {
  const candidate = String(providedName || "").trim();
  return candidate || Buffer.from(file.originalname, "latin1").toString("utf8");
}

function removeFile(filePath: string | null | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // 忽略失败请求的临时文件清理错误
  }
}

function sendStoredFile(
  res: Response,
  filePath: string,
  fileName: string,
  mimeType: string | null,
  forceDownload: boolean,
): void {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ success: false, message: "文件不存在" });
    return;
  }
  const inlineTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
  const disposition =
    !forceDownload && mimeType && inlineTypes.has(mimeType)
      ? "inline"
      : "attachment";
  res.setHeader("Content-Type", mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  fs.createReadStream(filePath).pipe(res);
}

async function getOperatorName(userId: string): Promise<string | null> {
  const user = (await db
    .prepare(`SELECT name FROM users WHERE id = ?`)
    .get(userId)) as { name: string } | undefined;
  return user?.name || null;
}

async function addAuditLog(
  client: PoolClient,
  requestId: string,
  action: string,
  operatorId: string,
  operatorName: string | null,
  comment: string | null,
  now: string,
): Promise<void> {
  await client.query(
    `INSERT INTO resignation_audit_logs (
       id, request_id, action, operator_id, operator_name, comment, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [nanoid(), requestId, action, operatorId, operatorName, comment, now],
  );
}

const uploadTemplate = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, ensureDatedUploadDirectory("resignation-templates"));
    },
    filename: (_req, file, callback) => {
      callback(
        null,
        `template-${Date.now()}-${nanoid(6)}${path.extname(file.originalname).toLowerCase()}`,
      );
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const uploadArchiveDocument = multer({
  storage: multer.diskStorage({
    destination: (req, _file, callback) => {
      callback(
        null,
        ensureDatedUploadDirectory(
          "resignation-documents",
          new Date(),
          safeUploadSubdirectory(req.params.id),
        ),
      );
    },
    filename: (req, file, callback) => {
      const type = String(req.params.documentType || "combined");
      callback(
        null,
        `${type}-${Date.now()}-${nanoid(6)}${path.extname(file.originalname).toLowerCase()}`,
      );
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
});

function templateTypePlaceholders(): string {
  return RESIGNATION_TEMPLATE_TYPES.map(() => "?").join(",");
}

async function getCurrentTemplates(): Promise<ResignationTemplate[]> {
  return (await db
    .prepare(
      `
    SELECT DISTINCT ON (template_type) *
    FROM resignation_templates
    WHERE template_type IN (${templateTypePlaceholders()})
    ORDER BY template_type, created_at DESC
  `,
    )
    .all(...RESIGNATION_TEMPLATE_TYPES)) as ResignationTemplate[];
}

async function getManagementRequest(
  requestId: string,
): Promise<ResignationManagementRequest | undefined> {
  return (await db
    .prepare(
      `
    SELECT rr.*, ep.name AS employee_name, ep.department AS employee_department,
           ep.position AS employee_position, ep.mobile AS employee_mobile,
           ep.employee_no, ep.hire_date, ep.id_number, ep.employment_status,
           u.status AS account_status,
           first_contract.contract_start_date AS first_contract_start_date
    FROM resignation_requests rr
    JOIN employee_profiles ep ON ep.id = rr.employee_id
    LEFT JOIN users u ON u.id = rr.employee_user_id
    LEFT JOIN LATERAL (
      SELECT ed.contract_start_date
      FROM employee_documents ed
      WHERE ed.employee_id = ep.id
        AND ed.document_type = 'contract'
        AND ed.contract_start_date IS NOT NULL
        AND ed.contract_end_date IS NOT NULL
      ORDER BY ed.contract_start_date ASC, ed.created_at ASC
      LIMIT 1
    ) first_contract ON TRUE
    WHERE rr.id = ?
  `,
    )
    .get(requestId)) as ResignationManagementRequest | undefined;
}

async function getCurrentDocuments(
  requestId: string,
): Promise<ResignationDocument[]> {
  return (await db
    .prepare(
      `
    SELECT *
    FROM resignation_documents
    WHERE request_id = ?
      AND is_current = 1
    ORDER BY created_at DESC
  `,
    )
    .all(requestId)) as ResignationDocument[];
}

async function getManagementDetail(requestId: string) {
  const request = await getManagementRequest(requestId);
  if (!request) return null;
  const documents = await getCurrentDocuments(requestId);
  const missingTypes = getMissingResignationArchiveTypes(documents);
  return {
    request,
    documents,
    templates: await getCurrentTemplates(),
    requiredDocumentTypes: RESIGNATION_ARCHIVE_TYPES,
    missingDocumentTypes: missingTypes,
    completedDocumentCount:
      RESIGNATION_ARCHIVE_TYPES.length - missingTypes.length,
    documentTypeLabels: RESIGNATION_ARCHIVE_LABELS,
  };
}

interface AdminArchiveFile {
  documentType: ResignationArchiveType;
  filePath: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
}

async function persistAdminArchiveFiles(
  requestId: string,
  files: AdminArchiveFile[],
  uploaderId: string,
) {
  if (files.length === 0)
    throw new ResignationManagementError("没有可归档的离职文件");
  const uploaderName = await getOperatorName(uploaderId);
  const now = new Date().toISOString();

  return await db.transaction(async (client) => {
    const requestResult = await client.query<ResignationRequest>(
      `SELECT * FROM resignation_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = requestResult.rows[0];
    if (!request)
      throw new ResignationManagementError("离职人员记录不存在", 404);
    if (
      !["draft", "pending_confirmation", "approved"].includes(request.status)
    ) {
      throw new ResignationManagementError("当前状态不能维护离职档案", 409);
    }

    for (const file of files) {
      await client.query(
        `UPDATE resignation_documents
         SET is_current = 0
         WHERE request_id = $1
           AND document_type = $2
           AND is_current = 1`,
        [requestId, file.documentType],
      );
      await client.query(
        `INSERT INTO resignation_documents (
           id, request_id, document_type, uploader_role, file_name, file_path,
           file_size, mime_type, uploaded_by, uploaded_by_name, created_at, is_current
         ) VALUES ($1,$2,$3,'admin',$4,$5,$6,$7,$8,$9,$10,1)`,
        [
          nanoid(),
          requestId,
          file.documentType,
          file.originalFileName,
          toStoredUploadPath(file.filePath, true),
          file.fileSize,
          file.mimeType,
          uploaderId,
          uploaderName,
          now,
        ],
      );
      await addAuditLog(
        client,
        requestId,
        `上传${RESIGNATION_ARCHIVE_LABELS[file.documentType]}`,
        uploaderId,
        uploaderName,
        file.originalFileName,
        now,
      );
    }

    await client.query(
      `UPDATE resignation_requests SET updated_at = $1 WHERE id = $2`,
      [now, requestId],
    );
    return await refreshResignationArchiveCompletionWithClient(
      client,
      requestId,
    );
  });
}

function buildTemplateContext(
  request: ResignationManagementRequest,
): ResignationTemplateContext {
  return {
    employeeName: request.employee_name || "",
    employeeNo: request.employee_no || "",
    idNumber: request.id_number || "",
    department: request.employee_department || "",
    position: request.employee_position || "",
    hireDate: request.hire_date || "",
    firstContractStartDate: request.first_contract_start_date || "",
    resignDate: request.resign_date || "",
  };
}

async function getLatestTemplate(
  templateType: ResignationArchiveType,
): Promise<ResignationTemplate | undefined> {
  return (await db
    .prepare(
      `
    SELECT *
    FROM resignation_templates
    WHERE template_type = ?
    ORDER BY created_at DESC
    LIMIT 1
  `,
    )
    .get(templateType)) as ResignationTemplate | undefined;
}

async function getTemplateOverlayDraft(
  requestId: string,
  templateType: ResignationArchiveType,
  templateId: string,
): Promise<ResignationTemplateDraftRow | undefined> {
  return (await db
    .prepare(
      `
    SELECT template_id, overlay_json, updated_at, updated_by_name
    FROM resignation_template_drafts
    WHERE request_id = ?
      AND template_type = ?
      AND template_id = ?
  `,
    )
    .get(requestId, templateType, templateId)) as
    | ResignationTemplateDraftRow
    | undefined;
}

async function buildTemplateEditorState(
  templateType: ResignationArchiveType,
  request: ResignationManagementRequest,
  draft?: ResignationTemplateOverlayDraft,
  sourcePdf?: Buffer,
) {
  const editorState = buildResignationTemplateEditorState(
    templateType,
    buildTemplateContext(request),
    draft?.fieldOverrides || {},
    draft?.fieldAlignments || {},
  );
  return sourcePdf
    ? await alignResignationTemplateEditorStateToPdf(
        sourcePdf,
        templateType,
        editorState,
        draft?.fieldOverrides || {},
        draft?.fieldAlignments || {},
      )
    : editorState;
}

router.get("/templates", requireAdmin, async (_req, res) => {
  try {
    res.json({
      success: true,
      data: await getCurrentTemplates(),
      templateTypes: RESIGNATION_TEMPLATE_TYPES,
      labels: RESIGNATION_ARCHIVE_LABELS,
    });
  } catch (error) {
    console.error("获取离职模板失败:", error);
    res.status(500).json({ success: false, message: "获取离职模板失败" });
  }
});

router.post(
  "/templates",
  requireAdmin,
  uploadTemplate.single("file"),
  async (req, res) => {
    let persisted = false;
    try {
      const file = req.file;
      const templateType = req.body.template_type;
      if (!file) throw new ResignationManagementError("请选择要上传的离职模板");
      if (!isResignationArchiveType(templateType)) {
        throw new ResignationManagementError("模板类型不正确");
      }
      const originalFileName = resolveOriginalFileName(
        file,
        req.body.originalFileName,
      );
      if (
        !isResignationTemplatePdfUpload(
          file.path,
          originalFileName,
          file.mimetype,
        )
      ) {
        throw new ResignationManagementError("离职模板只能上传真实的 PDF 文件");
      }

      const now = new Date().toISOString();
      const templateId = nanoid();
      const uploaderName = await getOperatorName(req.session.userId!);
      await db
        .prepare(
          `
      INSERT INTO resignation_templates (
        id, template_type, name, file_name, file_path, file_size, mime_type,
        uploaded_by, uploaded_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        )
        .run(
          templateId,
          templateType,
          RESIGNATION_ARCHIVE_LABELS[templateType],
          originalFileName,
          toStoredUploadPath(file.path, true),
          file.size,
          PDF_MIME_TYPE,
          req.session.userId,
          uploaderName,
          now,
        );
      persisted = true;

      res.json({
        success: true,
        message: `${RESIGNATION_ARCHIVE_LABELS[templateType]}模板上传成功`,
        data: await db
          .prepare(`SELECT * FROM resignation_templates WHERE id = ?`)
          .get(templateId),
      });
    } catch (error) {
      console.error("上传离职模板失败:", error);
      if (!persisted) removeFile(req.file?.path);
      if (error instanceof ResignationManagementError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: "上传离职模板失败" });
    }
  },
);

router.delete("/templates/:id", requireAdmin, async (req, res) => {
  try {
    const template = (await db
      .prepare(
        `
      SELECT * FROM resignation_templates WHERE id = ?
    `,
      )
      .get(req.params.id)) as ResignationTemplate | undefined;
    if (!template || !isResignationArchiveType(template.template_type)) {
      return res.status(404).json({ success: false, message: "模板不存在" });
    }
    await db
      .prepare(`DELETE FROM resignation_templates WHERE id = ?`)
      .run(template.id);
    removeFile(resolveStoredPath(template.file_path));
    res.json({ success: true, message: "模板已删除" });
  } catch (error) {
    console.error("删除离职模板失败:", error);
    res.status(500).json({ success: false, message: "删除离职模板失败" });
  }
});

router.get("/templates/:id/preview", requireAdmin, async (req, res) => {
  try {
    const template = (await db
      .prepare(
        `
      SELECT * FROM resignation_templates WHERE id = ?
    `,
      )
      .get(req.params.id)) as ResignationTemplate | undefined;
    if (!template || !isResignationArchiveType(template.template_type)) {
      return res.status(404).json({ success: false, message: "模板不存在" });
    }

    const sourcePath = resolveStoredPath(template.file_path);
    if (!fs.existsSync(sourcePath)) {
      return res
        .status(404)
        .json({ success: false, message: "模板文件不存在" });
    }
    const buffer = await loadResignationTemplatePdfBuffer(sourcePath);
    const previewFileName = `${path.parse(template.file_name).name || template.name}.pdf`;

    res.setHeader("Content-Type", PDF_MIME_TYPE);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(previewFileName)}`,
    );
    res.end(buffer);
  } catch (error) {
    console.error("在线预览离职模板失败:", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "离职模板预览失败",
    });
  }
});

router.get("/templates/:id/download", requireAdmin, async (req, res) => {
  try {
    const template = (await db
      .prepare(
        `
      SELECT * FROM resignation_templates WHERE id = ?
    `,
      )
      .get(req.params.id)) as ResignationTemplate | undefined;
    if (!template || !isResignationArchiveType(template.template_type)) {
      return res.status(404).json({ success: false, message: "模板不存在" });
    }
    sendStoredFile(
      res,
      resolveStoredPath(template.file_path),
      template.file_name,
      template.mime_type,
      req.query.download === "1",
    );
  } catch (error) {
    console.error("下载离职模板失败:", error);
    res.status(500).json({ success: false, message: "下载离职模板失败" });
  }
});

router.get("/management/candidates", requireAdmin, async (_req, res) => {
  try {
    const candidates = await db
      .prepare(
        `
      SELECT ep.id, ep.user_id, ep.employee_no, ep.name, ep.department, ep.position,
             ep.employment_status, u.status AS account_status
      FROM employee_profiles ep
      LEFT JOIN users u ON u.id = ep.user_id
      LEFT JOIN resignation_requests rr ON rr.employee_id = ep.id
      WHERE rr.id IS NULL
        AND COALESCE(u.role, '') NOT IN ('super_admin', 'chairman')
      ORDER BY ep.name ASC
    `,
      )
      .all();
    res.json({ success: true, data: candidates });
  } catch (error) {
    console.error("获取可创建离职记录的员工失败:", error);
    res.status(500).json({ success: false, message: "获取员工列表失败" });
  }
});

router.post("/management", requireAdmin, async (req, res) => {
  try {
    const employeeId = String(req.body.employeeId || "").trim();
    const resignType = req.body.resignType as ResignationType;
    const resignDate = String(req.body.resignDate || "").trim();
    const reason = String(req.body.reason || "").trim();
    if (
      !employeeId ||
      !VALID_RESIGNATION_TYPES.has(resignType) ||
      !isValidDate(resignDate)
    ) {
      throw new ResignationManagementError("请选择员工、离职类型和离职日期");
    }

    const operatorId = req.session.userId!;
    const operatorName = await getOperatorName(operatorId);
    const requestId = nanoid();
    const now = new Date().toISOString();

    await db.transaction(async (client) => {
      const employeeResult = await client.query<{
        id: string;
        user_id: string | null;
        employment_status: string | null;
      }>(
        `SELECT id, user_id, employment_status
         FROM employee_profiles
         WHERE id = $1
         FOR UPDATE`,
        [employeeId],
      );
      const employee = employeeResult.rows[0];
      if (!employee) throw new ResignationManagementError("员工不存在", 404);
      const existingResult = await client.query(
        `SELECT id FROM resignation_requests WHERE employee_id = $1`,
        [employeeId],
      );
      if (existingResult.rows[0]) {
        throw new ResignationManagementError("该员工已有离职记录", 409);
      }

      await client.query(
        `INSERT INTO resignation_requests (
           id, employee_id, employee_user_id, handover_user_id, handover_name,
           resign_type, resign_date, reason, status, created_by, created_by_name,
           created_at, updated_at
         ) VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,'draft',$7,$8,$9,$9)`,
        [
          requestId,
          employeeId,
          employee.user_id,
          resignType,
          resignDate,
          reason || null,
          operatorId,
          operatorName,
          now,
        ],
      );
      await addAuditLog(
        client,
        requestId,
        "创建离职人员",
        operatorId,
        operatorName,
        reason || null,
        now,
      );
    });

    res.json({
      success: true,
      message: "离职人员创建成功，请继续上传离职档案",
      data: await getManagementDetail(requestId),
    });
  } catch (error) {
    console.error("创建离职人员失败:", error);
    if (error instanceof ResignationManagementError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "创建离职人员失败" });
  }
});

router.get("/management", requireAdmin, async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const params: unknown[] = [];
    let statusSql = "";
    if (status) {
      statusSql = "AND rr.status = ?";
      params.push(status);
    }
    const requests = (await db
      .prepare(
        `
      SELECT rr.*, ep.name AS employee_name, ep.department AS employee_department,
             ep.position AS employee_position, ep.mobile AS employee_mobile,
             ep.employee_no, ep.hire_date, ep.employment_status,
             u.status AS account_status
      FROM resignation_requests rr
      JOIN employee_profiles ep ON ep.id = rr.employee_id
      LEFT JOIN users u ON u.id = rr.employee_user_id
      WHERE 1 = 1
      ${statusSql}
      ORDER BY COALESCE(rr.approve_time, rr.updated_at, rr.created_at) DESC
    `,
      )
      .all(...params)) as Array<
      ResignationRequestWithEmployee & Record<string, unknown>
    >;

    const documents =
      requests.length > 0
        ? ((await db
            .prepare(
              `
          SELECT *
          FROM resignation_documents
          WHERE request_id IN (${requests.map(() => "?").join(",")})
            AND is_current = 1
          ORDER BY created_at DESC
        `,
            )
            .all(
              ...requests.map((request) => request.id),
            )) as ResignationDocument[])
        : [];
    const documentsByRequest = new Map<string, ResignationDocument[]>();
    for (const document of documents) {
      const items = documentsByRequest.get(document.request_id) || [];
      items.push(document);
      documentsByRequest.set(document.request_id, items);
    }

    res.json({
      success: true,
      data: requests.map((request) => {
        const requestDocuments = documentsByRequest.get(request.id) || [];
        const missingTypes =
          getMissingResignationArchiveTypes(requestDocuments);
        return {
          ...request,
          documents: requestDocuments,
          missingDocumentTypes: missingTypes,
          completedDocumentCount:
            RESIGNATION_ARCHIVE_TYPES.length - missingTypes.length,
          requiredDocumentCount: RESIGNATION_ARCHIVE_TYPES.length,
        };
      }),
    });
  } catch (error) {
    console.error("获取离职人员列表失败:", error);
    res.status(500).json({ success: false, message: "获取离职人员列表失败" });
  }
});

router.get("/management/:id", requireAdmin, async (req, res) => {
  try {
    const detail = await getManagementDetail(req.params.id);
    if (!detail)
      return res
        .status(404)
        .json({ success: false, message: "离职人员记录不存在" });
    res.json({ success: true, data: detail });
  } catch (error) {
    console.error("获取离职人员详情失败:", error);
    res.status(500).json({ success: false, message: "获取离职人员详情失败" });
  }
});

router.patch("/management/:id", requireAdmin, async (req, res) => {
  try {
    const resignType = req.body.resignType as ResignationType;
    const resignDate = String(req.body.resignDate || "").trim();
    const reason = String(req.body.reason || "").trim();
    if (!VALID_RESIGNATION_TYPES.has(resignType) || !isValidDate(resignDate)) {
      throw new ResignationManagementError("离职类型或离职日期不正确");
    }
    const result = await db
      .prepare(
        `
      UPDATE resignation_requests
      SET resign_type = ?, resign_date = ?, reason = ?, updated_at = ?
      WHERE id = ?
        AND status IN ('draft', 'pending_confirmation')
    `,
      )
      .run(
        resignType,
        resignDate,
        reason || null,
        new Date().toISOString(),
        req.params.id,
      );
    if (result.changes === 0) {
      return res
        .status(409)
        .json({ success: false, message: "只有尚未确认离职的记录可以修改" });
    }
    res.json({
      success: true,
      message: "离职信息已更新",
      data: await getManagementDetail(req.params.id),
    });
  } catch (error) {
    console.error("更新离职人员失败:", error);
    if (error instanceof ResignationManagementError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "更新离职人员失败" });
  }
});

router.delete("/management/:id", requireAdmin, async (req, res) => {
  try {
    const documents = (await db
      .prepare(
        `
      SELECT * FROM resignation_documents WHERE request_id = ?
    `,
      )
      .all(req.params.id)) as ResignationDocument[];
    const result = await db
      .prepare(
        `
      DELETE FROM resignation_requests
      WHERE id = ?
        AND status IN ('draft', 'pending_confirmation')
    `,
      )
      .run(req.params.id);
    if (result.changes === 0) {
      return res
        .status(409)
        .json({ success: false, message: "只有尚未确认离职的记录可以删除" });
    }
    for (const document of documents)
      removeFile(resolveStoredPath(document.file_path));
    res.json({ success: true, message: "离职人员记录已删除" });
  } catch (error) {
    console.error("删除离职人员失败:", error);
    res.status(500).json({ success: false, message: "删除离职人员失败" });
  }
});

router.post(
  "/management/:id/documents/type/:documentType",
  requireAdmin,
  uploadArchiveDocument.single("file"),
  async (req, res) => {
    let persisted = false;
    try {
      const file = req.file;
      const documentType = req.params.documentType;
      if (!file) throw new ResignationManagementError("请选择要上传的离职档案");
      if (!isResignationArchiveType(documentType)) {
        throw new ResignationManagementError("离职档案类型不正确");
      }
      if (
        path.extname(file.originalname).toLowerCase() !== ".pdf" ||
        !isPdfFile(file.path)
      ) {
        throw new ResignationManagementError("离职档案只支持真实的 PDF 文件");
      }

      const completion = await persistAdminArchiveFiles(
        req.params.id,
        [
          {
            documentType,
            filePath: file.path,
            originalFileName: resolveOriginalFileName(
              file,
              req.body.originalFileName,
            ),
            fileSize: file.size,
            mimeType: "application/pdf",
          },
        ],
        req.session.userId!,
      );
      persisted = true;
      res.json({
        success: true,
        message:
          completion.status === "approved"
            ? `${RESIGNATION_ARCHIVE_LABELS[documentType]}替换成功，离职档案保持完整`
            : completion.completed
              ? `${RESIGNATION_ARCHIVE_LABELS[documentType]}上传成功；五类档案已齐全，请核对后确认离职`
              : `${RESIGNATION_ARCHIVE_LABELS[documentType]}上传成功`,
        completion,
        data: await getManagementDetail(req.params.id),
      });
    } catch (error) {
      console.error("上传离职档案失败:", error);
      if (!persisted) removeFile(req.file?.path);
      if (error instanceof ResignationManagementError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: "上传离职档案失败" });
    }
  },
);

router.post(
  "/management/:id/documents/auto-classify",
  requireAdmin,
  uploadArchiveDocument.single("file"),
  async (req, res) => {
    let persisted = false;
    let splitFiles: SplitResignationDocumentFile[] = [];
    try {
      const file = req.file;
      if (!file)
        throw new ResignationManagementError("请选择要识别的合并 PDF 文件");
      if (
        path.extname(file.originalname).toLowerCase() !== ".pdf" ||
        !isPdfFile(file.path)
      ) {
        throw new ResignationManagementError("一键识别只支持真实的 PDF 文件");
      }

      const originalFileName = resolveOriginalFileName(
        file,
        req.body.originalFileName,
      );
      const analysis = await analyzeResignationDocumentBundle(file.path);
      if (analysis.status !== "success" || analysis.sections.length === 0) {
        throw new ResignationManagementError(analysis.message, 422);
      }
      splitFiles = await splitResignationDocumentBundle(
        file.path,
        originalFileName,
        analysis.sections,
      );
      const completion = await persistAdminArchiveFiles(
        req.params.id,
        splitFiles,
        req.session.userId!,
      );
      persisted = true;
      removeFile(file.path);

      res.json({
        success: true,
        message:
          completion.status === "approved"
            ? `已识别并替换${analysis.sections.length}类材料，离职档案保持完整`
            : completion.completed
              ? `已识别并归档${analysis.sections.length}类材料；五类档案已齐全，请核对后确认离职`
              : `已识别并归档${analysis.sections.length}类离职材料`,
        classifications: analysis.sections,
        missingTypes: completion.missingTypes,
        completion,
        data: await getManagementDetail(req.params.id),
      });
    } catch (error) {
      console.error("一键识别离职档案失败:", error);
      if (!persisted) {
        removeFile(req.file?.path);
        for (const splitFile of splitFiles) removeFile(splitFile.filePath);
      }
      if (error instanceof ResignationManagementError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: "一键识别离职档案失败" });
    }
  },
);

router.post(
  "/management/:id/confirm-completion",
  requireAdmin,
  async (req, res) => {
    try {
      const now = new Date().toISOString();
      const completion = await db.transaction(
        async (client) =>
          await finalizeResignationArchiveWithClient(
            client,
            req.params.id,
            req.session.userId!,
            now,
          ),
      );
      if (!completion.completed) {
        return res.status(409).json({
          success: false,
          message: "五类离职档案尚未全部上传，不能确认离职",
          missingTypes: completion.missingTypes,
        });
      }
      if (completion.status !== "approved") {
        return res.status(409).json({
          success: false,
          message: "当前离职记录状态不能确认完成",
        });
      }

      res.json({
        success: true,
        message: completion.newlyCompleted
          ? completion.accountDisabled
            ? "离职已确认，员工状态已改为已离职，原账号已停用"
            : "离职已确认，员工状态已改为已离职；原账号此前已停用或未关联账号"
          : "该员工离职档案已经确认完成",
        completion,
        data: await getManagementDetail(req.params.id),
      });
    } catch (error) {
      console.error("确认离职档案完成失败:", error);
      res.status(500).json({ success: false, message: "确认离职失败" });
    }
  },
);

router.delete(
  "/management/:id/documents/:documentId",
  requireAdmin,
  async (req, res) => {
    try {
      const document = (await db
        .prepare(
          `
      SELECT rd.*, rr.status
      FROM resignation_documents rd
      JOIN resignation_requests rr ON rr.id = rd.request_id
      WHERE rd.id = ?
        AND rd.request_id = ?
        AND rd.is_current = 1
    `,
        )
        .get(req.params.documentId, req.params.id)) as
        | (ResignationDocument & { status: ResignationRequest["status"] })
        | undefined;
      if (!document)
        return res
          .status(404)
          .json({ success: false, message: "离职档案不存在" });
      if (!["draft", "pending_confirmation"].includes(document.status)) {
        return res
          .status(409)
          .json({ success: false, message: "已完成的离职档案不能删除" });
      }

      const operatorId = req.session.userId!;
      const operatorName = await getOperatorName(operatorId);
      const now = new Date().toISOString();
      await db.transaction(async (client) => {
        await client.query(
          `DELETE FROM resignation_documents WHERE id = $1 AND request_id = $2`,
          [document.id, req.params.id],
        );
        await addAuditLog(
          client,
          req.params.id,
          `删除${
            isResignationArchiveType(document.document_type)
              ? RESIGNATION_ARCHIVE_LABELS[document.document_type]
              : "离职档案"
          }`,
          operatorId,
          operatorName,
          document.file_name,
          now,
        );
        await client.query(
          `UPDATE resignation_requests SET updated_at = $1 WHERE id = $2`,
          [now, req.params.id],
        );
        await refreshResignationArchiveCompletionWithClient(
          client,
          req.params.id,
        );
      });
      removeFile(resolveStoredPath(document.file_path));
      res.json({
        success: true,
        message: "离职档案已删除",
        data: await getManagementDetail(req.params.id),
      });
    } catch (error) {
      console.error("删除离职档案失败:", error);
      res.status(500).json({ success: false, message: "删除离职档案失败" });
    }
  },
);

router.get(
  "/management/:id/templates/:templateType/editor",
  requireAdmin,
  async (req, res) => {
    try {
      if (!isResignationArchiveType(req.params.templateType)) {
        return res
          .status(400)
          .json({ success: false, message: "离职模板类型不正确" });
      }
      const templateType = req.params.templateType;
      const request = await getManagementRequest(req.params.id);
      if (!request)
        return res
          .status(404)
          .json({ success: false, message: "离职人员记录不存在" });

      const template = await getLatestTemplate(templateType);
      if (!template) {
        return res.status(404).json({
          success: false,
          message: `请先上传${RESIGNATION_ARCHIVE_LABELS[templateType]}模板`,
        });
      }

      const sourcePdf = await loadResignationTemplatePdfBuffer(
        resolveStoredPath(template.file_path),
      );
      const draftRow = await getTemplateOverlayDraft(
        req.params.id,
        templateType,
        template.id,
      );
      const draft = parseResignationOverlayDraft(draftRow?.overlay_json);
      const editorState = await buildTemplateEditorState(
        templateType,
        request,
        draft,
        sourcePdf,
      );
      res.json({
        success: true,
        data: {
          request,
          template,
          templateType,
          templateLabel: RESIGNATION_ARCHIVE_LABELS[templateType],
          sourceKind: getResignationTemplateFileKind(template),
          documentNumber: editorState.documentNumber,
          documentNumberBoxes: editorState.documentNumberBoxes,
          fields: editorState.fields,
          customItems: draft.customItems,
          warnings: editorState.warnings,
          editable: true,
          saved: !!draftRow,
          updatedAt: draftRow?.updated_at || null,
          updatedByName: draftRow?.updated_by_name || null,
        },
      });
    } catch (error) {
      console.error("加载离职模板编辑内容失败:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "加载离职模板失败",
      });
    }
  },
);

router.get(
  "/management/:id/templates/:templateType/preview",
  requireAdmin,
  async (req, res) => {
    try {
      if (!isResignationArchiveType(req.params.templateType)) {
        return res
          .status(400)
          .json({ success: false, message: "离职模板类型不正确" });
      }
      const request = await getManagementRequest(req.params.id);
      if (!request)
        return res
          .status(404)
          .json({ success: false, message: "离职人员记录不存在" });
      const template = await getLatestTemplate(req.params.templateType);
      if (!template)
        return res
          .status(404)
          .json({ success: false, message: "请先上传对应的离职模板" });

      const buffer = await loadResignationTemplatePdfBuffer(
        resolveStoredPath(template.file_path),
      );
      res.setHeader("Content-Type", PDF_MIME_TYPE);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(
          `${RESIGNATION_ARCHIVE_LABELS[req.params.templateType]}.pdf`,
        )}`,
      );
      res.end(buffer);
    } catch (error) {
      console.error("预览离职模板失败:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "离职模板预览失败",
      });
    }
  },
);

router.put(
  "/management/:id/templates/:templateType/editor",
  requireAdmin,
  async (req, res) => {
    try {
      if (!isResignationArchiveType(req.params.templateType)) {
        return res
          .status(400)
          .json({ success: false, message: "离职模板类型不正确" });
      }
      const templateType = req.params.templateType;
      const request = await getManagementRequest(req.params.id);
      if (!request)
        return res
          .status(404)
          .json({ success: false, message: "离职人员记录不存在" });
      const template = await getLatestTemplate(templateType);
      if (!template) {
        return res
          .status(404)
          .json({ success: false, message: "请先上传对应的离职模板" });
      }

      const sourcePdf = await loadResignationTemplatePdfBuffer(
        resolveStoredPath(template.file_path),
      );
      const defaultState = await buildTemplateEditorState(
        templateType,
        request,
        undefined,
        sourcePdf,
      );
      const submittedValues = req.body?.fieldValues;
      if (
        !submittedValues ||
        typeof submittedValues !== "object" ||
        Array.isArray(submittedValues)
      ) {
        throw new ResignationManagementError("模板字段数据格式不正确");
      }
      const fieldOverrides = buildResignationFieldOverrides(
        defaultState.fields,
        submittedValues as Record<string, unknown>,
      );
      const submittedAlignments = req.body?.fieldAlignments;
      if (
        submittedAlignments !== undefined &&
        (typeof submittedAlignments !== "object" ||
          Array.isArray(submittedAlignments))
      ) {
        throw new ResignationManagementError("模板字段文字方向格式不正确");
      }
      const fieldAlignments = buildResignationFieldAlignments(
        defaultState.fields,
        (submittedAlignments || {}) as Record<string, unknown>,
      );
      const overlayDraft = normalizeResignationOverlayDraft({
        version: 1,
        fieldOverrides,
        fieldAlignments,
        customItems: Array.isArray(req.body?.customItems)
          ? req.body.customItems
          : [],
      });
      const overlayJson = JSON.stringify(overlayDraft);
      if (Buffer.byteLength(overlayJson, "utf8") > 2 * 1024 * 1024) {
        return res
          .status(413)
          .json({ success: false, message: "模板填写内容过大" });
      }

      const now = new Date().toISOString();
      const operatorName = await getOperatorName(req.session.userId!);
      await db
        .prepare(
          `
      INSERT INTO resignation_template_drafts (
        id, request_id, template_type, template_id, content_html, overlay_json, updated_by,
        updated_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)
      ON CONFLICT (request_id, template_type) DO UPDATE SET
        template_id = EXCLUDED.template_id,
        content_html = '',
        overlay_json = EXCLUDED.overlay_json,
        updated_by = EXCLUDED.updated_by,
        updated_by_name = EXCLUDED.updated_by_name,
        updated_at = EXCLUDED.updated_at
    `,
        )
        .run(
          nanoid(),
          req.params.id,
          templateType,
          template.id,
          overlayJson,
          req.session.userId,
          operatorName,
          now,
          now,
        );
      res.json({
        success: true,
        message: "在线填写内容已保存",
        updatedAt: now,
      });
    } catch (error) {
      console.error("保存离职模板编辑内容失败:", error);
      if (error instanceof ResignationManagementError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      if (error instanceof Error && /字段|填写|自定义/.test(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: "保存离职模板失败" });
    }
  },
);

router.get(
  "/management/:id/templates/print-all",
  requireAdmin,
  async (req, res) => {
    try {
      const request = await getManagementRequest(req.params.id);
      if (!request)
        return res
          .status(404)
          .json({ success: false, message: "离职人员记录不存在" });
      const templates = await getCurrentTemplates();
      const templateByType = new Map(
        templates.map((template) => [template.template_type, template]),
      );
      const missingTypes = RESIGNATION_TEMPLATE_TYPES.filter(
        (type) => !templateByType.has(type),
      );
      if (missingTypes.length > 0) {
        return res.status(409).json({
          success: false,
          message: `请先上传${missingTypes.map((type) => RESIGNATION_ARCHIVE_LABELS[type]).join("、")}模板`,
        });
      }

      const draftRows = (await db
        .prepare(
          `
      SELECT template_type, template_id, overlay_json, updated_at, updated_by_name
      FROM resignation_template_drafts
      WHERE request_id = ?
    `,
        )
        .all(req.params.id)) as Array<
        ResignationTemplateDraftRow & { template_type: string }
      >;
      const generatedPdfs: Buffer[] = [];

      for (const templateType of RESIGNATION_TEMPLATE_TYPES) {
        const template = templateByType.get(templateType)!;
        const draftRow = draftRows.find(
          (row) =>
            row.template_type === templateType &&
            row.template_id === template.id,
        );
        const draft = parseResignationOverlayDraft(draftRow?.overlay_json);
        const sourcePdf = await loadResignationTemplatePdfBuffer(
          resolveStoredPath(template.file_path),
        );
        const editorState = await buildTemplateEditorState(
          templateType,
          request,
          draft,
          sourcePdf,
        );
        generatedPdfs.push(
          await renderResignationTemplatePdf(
            sourcePdf,
            editorState,
            draft.customItems,
          ),
        );
      }

      const buffer = await mergeResignationTemplatePdfs(generatedPdfs);
      const employeePrefix = String(
        request.employee_no || request.employee_name || "员工",
      ).replace(/[\\/:*?"<>|]/g, "-");
      const fileName = `${employeePrefix}-离职文件.pdf`;
      res.setHeader("Content-Type", PDF_MIME_TYPE);
      res.setHeader(
        "Content-Disposition",
        `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      res.end(buffer);
    } catch (error) {
      console.error("合并打印离职模板失败:", error);
      res.status(500).json({
        success: false,
        message:
          error instanceof Error ? error.message : "合并打印离职模板失败",
      });
    }
  },
);

router.get(
  "/management/:id/templates/:templateType/download",
  requireAdmin,
  async (req, res) => {
    try {
      if (!isResignationArchiveType(req.params.templateType)) {
        return res
          .status(400)
          .json({ success: false, message: "离职模板类型不正确" });
      }
      const templateType = req.params.templateType;
      const request = await getManagementRequest(req.params.id);
      if (!request)
        return res
          .status(404)
          .json({ success: false, message: "离职人员记录不存在" });

      const template = await getLatestTemplate(templateType);
      if (!template)
        return res
          .status(404)
          .json({ success: false, message: "请先上传对应的离职模板" });

      const draftRow = await getTemplateOverlayDraft(
        req.params.id,
        templateType,
        template.id,
      );
      const draft = parseResignationOverlayDraft(draftRow?.overlay_json);
      const sourcePdf = await loadResignationTemplatePdfBuffer(
        resolveStoredPath(template.file_path),
      );
      const editorState = await buildTemplateEditorState(
        templateType,
        request,
        draft,
        sourcePdf,
      );
      const buffer = await renderResignationTemplatePdf(
        sourcePdf,
        editorState,
        draft.customItems,
      );
      const employeePrefix = String(
        request.employee_no || request.employee_name || "员工",
      ).replace(/[\\/:*?"<>|]/g, "-");
      const fileName = `${employeePrefix}-${RESIGNATION_ARCHIVE_LABELS[templateType]}.pdf`;
      res.setHeader("Content-Type", PDF_MIME_TYPE);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      res.end(buffer);
    } catch (error) {
      console.error("下载已填写离职模板失败:", error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "生成离职模板失败",
      });
    }
  },
);

router.get(
  "/requests/:id/documents/:docId/download",
  requireAdmin,
  async (req, res) => {
    try {
      const document = (await db
        .prepare(
          `
      SELECT *
      FROM resignation_documents
      WHERE id = ?
        AND request_id = ?
    `,
        )
        .get(req.params.docId, req.params.id)) as
        | ResignationDocument
        | undefined;
      if (!document)
        return res
          .status(404)
          .json({ success: false, message: "离职档案不存在" });
      sendStoredFile(
        res,
        resolveStoredPath(document.file_path),
        document.file_name,
        document.mime_type,
        req.query.download === "1",
      );
    } catch (error) {
      console.error("查看离职档案失败:", error);
      res.status(500).json({ success: false, message: "查看离职档案失败" });
    }
  },
);

export default router;
