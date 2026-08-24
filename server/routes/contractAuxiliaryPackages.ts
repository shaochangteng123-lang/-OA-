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
import { requireRole } from "../middleware/auth.js";
import {
  appendContractAuxiliaryFiles,
  createContractAuxiliaryPackage,
  deleteContractAuxiliaryPackage,
  getContractAuxiliaryPackage,
  listContractAuxiliaryPackages,
  updateContractAuxiliaryPackageNote,
  type ContractAuxiliaryFileKind,
  type ContractAuxiliaryPackageView,
  type ContractAuxiliaryStoredFile,
} from "../services/contractAuxiliaryPackage.js";
import {
  assertContractFileStructure,
  type ContractDocumentKind,
} from "../services/contractFileValidation.js";
import { ContractDomainError } from "../services/contractService.js";
import { validateFilePath } from "../utils/file-validation.js";
import { normalizeUploadFileName } from "../utils/upload-file-name.js";
import {
  ensureDatedUploadDirectory,
  toStoredUploadPath,
} from "../utils/upload-date.js";

const router = Router();
const requireFinance = requireRole(["admin", "super_admin", "chairman"]);
const requireAuxiliaryRead = requireRole([
  "admin",
  "super_admin",
  "chairman",
  "general_manager",
]);
const MAX_AUXILIARY_FILES = 20;

const auxiliaryUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, ensureDatedUploadDirectory("contract-auxiliary"));
    },
    filename: (_req, file, callback) => {
      const originalName = normalizeUploadFileName(file.originalname);
      const extension = path.extname(originalName).toLowerCase();
      const baseName = path
        .basename(originalName, extension)
        .replace(/[^\w\u3400-\u9fff-]/gu, "_")
        .slice(0, 80);
      callback(
        null,
        `${baseName || "辅助合同资料"}-${Date.now()}-${nanoid(8)}${extension}`,
      );
    },
  }),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: MAX_AUXILIARY_FILES,
  },
});

function uploadAuxiliaryFiles(req: Request, res: Response, next: NextFunction) {
  auxiliaryUpload.fields([
    { name: "contract", maxCount: MAX_AUXILIARY_FILES },
    { name: "invoice", maxCount: MAX_AUXILIARY_FILES },
    { name: "receipt", maxCount: MAX_AUXILIARY_FILES },
  ])(req, res, (error: unknown) => {
    if (!error) return next();
    cleanupFiles(uploadedFiles(req));
    const message =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "单个辅助资料文件不能超过 30MB"
        : error instanceof multer.MulterError &&
            error.code === "LIMIT_FILE_COUNT"
          ? `同一辅助档案包最多上传 ${MAX_AUXILIARY_FILES} 份文件`
          : error instanceof multer.MulterError &&
              error.code === "LIMIT_UNEXPECTED_FILE"
            ? "仅支持上传辅助合同、发票和回单文件"
            : error instanceof Error
              ? error.message
              : "辅助合同资料上传失败";
    res.status(400).json({ success: false, message });
  });
}

function actor(req: Request) {
  const id = req.session.userId || req.session.user?.id;
  const role = req.session.user?.role;
  if (!id || !role) throw new ContractDomainError(401, "登录状态已失效");
  return { id, role };
}

function uploadedFiles(req: Request): Express.Multer.File[] {
  const fields = (req.files || {}) as Record<string, Express.Multer.File[]>;
  return Object.values(fields).flat();
}

function cleanupFiles(files: Express.Multer.File[]) {
  for (const file of files) {
    try {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch {
      // 尽力清理不能覆盖实际业务错误。
    }
  }
}

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof ContractDomainError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
}

function actualKind(file: Express.Multer.File): ContractDocumentKind | null {
  const header = fs.readFileSync(file.path).subarray(0, 8);
  const signature = header.toString("hex").toLowerCase();
  if (header.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (signature.startsWith("ffd8ff")) return "jpeg";
  if (signature === "89504e470d0a1a0a") return "png";
  if (signature === "d0cf11e0a1b11ae1") return "doc";
  if (signature.startsWith("504b0304")) return "docx";
  return null;
}

const MIME_BY_KIND: Record<ContractDocumentKind, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
};

async function validatedStoredFile(
  file: Express.Multer.File,
  fileKind: ContractAuxiliaryFileKind,
): Promise<ContractAuxiliaryStoredFile> {
  const kind = actualKind(file);
  const allowed =
    fileKind === "contract"
      ? new Set<ContractDocumentKind>(["pdf", "doc", "docx"])
      : new Set<ContractDocumentKind>(["pdf", "jpeg", "png"]);
  if (!kind || !allowed.has(kind)) {
    throw new ContractDomainError(
      400,
      fileKind === "contract"
        ? "辅助合同仅支持真实 PDF、DOC 或 DOCX 文件"
        : "辅助发票和回单仅支持真实 PDF、JPG 或 PNG 文件",
      "CONTRACT_AUXILIARY_FILE_TYPE_INVALID",
    );
  }
  const extension = path.extname(file.originalname).toLowerCase();
  const expectedExtensions: Record<ContractDocumentKind, string[]> = {
    pdf: [".pdf"],
    doc: [".doc"],
    docx: [".docx"],
    jpeg: [".jpg", ".jpeg"],
    png: [".png"],
  };
  if (!expectedExtensions[kind].includes(extension)) {
    throw new ContractDomainError(
      400,
      "辅助资料扩展名与真实文件格式不一致",
      "CONTRACT_AUXILIARY_FILE_EXTENSION_MISMATCH",
    );
  }
  const buffer = fs.readFileSync(file.path);
  try {
    if (kind === "pdf") {
      const tail = buffer.subarray(Math.max(0, buffer.length - 8_192));
      if (buffer.length < 64 || !tail.includes(Buffer.from("%%EOF"))) {
        throw new Error("PDF 文件不完整或缺少结束标记");
      }
    } else {
      await assertContractFileStructure(buffer, kind);
    }
  } catch (error) {
    throw new ContractDomainError(
      400,
      error instanceof Error ? error.message : "辅助资料文件结构异常",
      "CONTRACT_AUXILIARY_FILE_INVALID",
    );
  }
  const storedPath = toStoredUploadPath(file.path);
  if (!validateFilePath(storedPath)) {
    throw new ContractDomainError(400, "辅助资料文件保存路径不安全");
  }
  return {
    fileName: normalizeUploadFileName(file.originalname),
    filePath: storedPath,
    fileSize: buffer.length,
    mimeType: MIME_BY_KIND[kind],
    fileHash: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

async function validatedStoredFiles(
  files: readonly Express.Multer.File[],
  fileKind: ContractAuxiliaryFileKind,
): Promise<ContractAuxiliaryStoredFile[]> {
  const validated: ContractAuxiliaryStoredFile[] = [];
  for (const file of files) {
    validated.push(await validatedStoredFile(file, fileKind));
  }
  return validated;
}

/** 兼容旧数据：历史待识别档案直接结束为已归档，不再调用识别服务。 */
export async function resumePendingContractAuxiliaryRecognitionJobs(): Promise<void> {
  const updated = await db.run(
    `UPDATE contract_auxiliary_packages
        SET status = 'succeeded', party_a = NULL, party_b = NULL,
            recognized_amount = NULL, raw_text = NULL,
            ocr_fields_json = '[]'::jsonb, ocr_lines_json = '[]'::jsonb,
            warnings_json = '[]'::jsonb, error_message = NULL,
            model_version = NULL, parser_version = NULL,
            version = version + 1
      WHERE status = 'processing'`,
  );
  if (updated.changes > 0) {
    console.log(`历史辅助材料待识别状态已转为直接归档：${updated.changes} 项`);
  }
}

/**
 * 辅助合同完整原文、坐标、候选证据、文件保存路径和摘要仅供服务端审计与
 * 受控文件读取使用。普通列表和详情只返回页面实际需要的最小字段。
 */
function publicAuxiliaryPackageView(packageView: ContractAuxiliaryPackageView) {
  return {
    id: packageView.id,
    parentContractId: packageView.parentContractId,
    partyA: null,
    partyB: null,
    recognizedAmount: null,
    note: packageView.note,
    status: "succeeded" as const,
    ocrFields: [],
    warnings: [],
    errorMessage: null,
    modelVersion: null,
    parserVersion: null,
    retryCount: 0,
    version: packageView.version,
    accountingIncluded: false as const,
    createdAt: packageView.createdAt,
    updatedAt: packageView.updatedAt,
    files: packageView.files.map((file) => ({
      id: file.id,
      packageId: file.packageId,
      fileKind: file.fileKind,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      version: file.version,
      isCurrent: file.isCurrent,
      createdAt: file.createdAt,
    })),
  };
}

router.get(
  "/:id/auxiliary-packages",
  requireAuxiliaryRead,
  async (req, res) => {
    try {
      const packages = await listContractAuxiliaryPackages(req.params.id);
      res.json({
        success: true,
        data: packages.map(publicAuxiliaryPackageView),
      });
    } catch (error) {
      sendError(res, error, "读取辅助合同失败");
    }
  },
);

router.get(
  "/:id/auxiliary-packages/:packageId",
  requireAuxiliaryRead,
  async (req, res) => {
    try {
      const packageView = await getContractAuxiliaryPackage(
        req.params.id,
        req.params.packageId,
      );
      res.json({
        success: true,
        data: publicAuxiliaryPackageView(packageView),
      });
    } catch (error) {
      sendError(res, error, "读取辅助合同详情失败");
    }
  },
);

router.post(
  "/:id/auxiliary-packages",
  requireFinance,
  uploadAuxiliaryFiles,
  async (req, res) => {
    const files = uploadedFiles(req);
    try {
      const fields = (req.files || {}) as Record<string, Express.Multer.File[]>;
      const contractFiles = fields.contract || [];
      if (contractFiles.length === 0) {
        throw new ContractDomainError(400, "必须上传辅助合同文件");
      }
      const contract = await validatedStoredFiles(contractFiles, "contract");
      const invoice = await validatedStoredFiles(
        fields.invoice || [],
        "invoice",
      );
      const receipt = await validatedStoredFiles(
        fields.receipt || [],
        "receipt",
      );
      const currentActor = actor(req);
      const created = await createContractAuxiliaryPackage({
        parentContractId: req.params.id,
        files: { contract, invoice, receipt },
        note: req.body?.note,
        actor: currentActor,
      });
      res.status(201).json({
        success: true,
        data: {
          packageId: created.packageId,
          status: created.status,
          version: created.version,
        },
      });
    } catch (error) {
      cleanupFiles(files);
      sendError(res, error, "创建辅助合同失败");
    }
  },
);

router.post(
  "/:id/auxiliary-packages/:packageId/files",
  requireFinance,
  uploadAuxiliaryFiles,
  async (req, res) => {
    const files = uploadedFiles(req);
    try {
      const fields = (req.files || {}) as Record<string, Express.Multer.File[]>;
      if (files.length === 0) {
        throw new ContractDomainError(400, "请至少选择一份需要追加的辅助材料");
      }
      const contract = await validatedStoredFiles(
        fields.contract || [],
        "contract",
      );
      const invoice = await validatedStoredFiles(
        fields.invoice || [],
        "invoice",
      );
      const receipt = await validatedStoredFiles(
        fields.receipt || [],
        "receipt",
      );
      const appended = await appendContractAuxiliaryFiles({
        parentContractId: req.params.id,
        packageId: req.params.packageId,
        expectedVersion: Number(req.body?.expectedVersion),
        files: { contract, invoice, receipt },
        ...(req.body?.note ? { note: req.body.note } : {}),
        actor: actor(req),
      });
      res.status(201).json({
        success: true,
        data: {
          packageId: appended.packageId,
          version: appended.version,
          appendedFileCount: appended.files.length,
        },
      });
    } catch (error) {
      cleanupFiles(files);
      sendError(res, error, "追加辅助材料失败");
    }
  },
);

router.patch(
  "/:id/auxiliary-packages/:packageId/note",
  requireFinance,
  async (req, res) => {
    try {
      res.json({
        success: true,
        data: await updateContractAuxiliaryPackageNote({
          parentContractId: req.params.id,
          packageId: req.params.packageId,
          actor: actor(req),
          expectedVersion: Number(req.body?.expectedVersion),
          note: req.body?.note,
          ...(Object.prototype.hasOwnProperty.call(
            req.body || {},
            "accountingIncluded",
          )
            ? { accountingIncluded: req.body.accountingIncluded }
            : {}),
        } as Parameters<typeof updateContractAuxiliaryPackageNote>[0]),
      });
    } catch (error) {
      sendError(res, error, "保存辅助合同备注失败");
    }
  },
);

router.delete(
  "/:id/auxiliary-packages/:packageId",
  requireFinance,
  async (req, res) => {
    try {
      const removed = await deleteContractAuxiliaryPackage({
        parentContractId: req.params.id,
        packageId: req.params.packageId,
        actor: actor(req),
        expectedVersion: Number(req.query.expectedVersion),
      });
      for (const storedPath of removed.storedFilePaths) {
        try {
          if (!validateFilePath(storedPath)) continue;
          const absolutePath = path.resolve(process.cwd(), storedPath);
          if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
        } catch {
          // 数据已删除后仅尽力清理物理文件。
        }
      }
      res.json({ success: true, data: { deleted: true } });
    } catch (error) {
      sendError(res, error, "删除辅助合同失败");
    }
  },
);

router.get(
  "/:id/auxiliary-packages/:packageId/files/:fileId",
  requireAuxiliaryRead,
  async (req, res) => {
    try {
      const packageView = await getContractAuxiliaryPackage(
        req.params.id,
        req.params.packageId,
      );
      const file = packageView.files.find(
        (item) => item.id === req.params.fileId,
      );
      if (!file) throw new ContractDomainError(404, "辅助资料文件不存在");
      const forceDownload = req.query.download === "1";
      if (!validateFilePath(file.filePath)) {
        throw new ContractDomainError(400, "辅助资料文件路径不安全");
      }
      const absolutePath = path.resolve(process.cwd(), file.filePath);
      if (!fs.existsSync(absolutePath)) {
        throw new ContractDomainError(404, "辅助资料物理文件不存在");
      }
      res.type(file.mimeType);
      res.setHeader(
        "Content-Disposition",
        `${forceDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      );
      res.sendFile(absolutePath);
    } catch (error) {
      sendError(res, error, "读取辅助资料文件失败");
    }
  },
);

export default router;
