import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import {
  addInvoiceApplicationMaterials,
  createInvoiceApplication,
  decideInvoiceApplication,
  deleteInvoiceApplicationMaterial,
  deliverInvoiceApplicationMaterials,
  getInvoiceApplication,
  getInvoiceApplicationEligibility,
  getInvoiceApplicationEligibilityBatch,
  getInvoiceApplicationPendingCounts,
  generateMainBusinessTriplicate,
  INVOICE_APPLICATION_ADMIN_ROLES,
  InvoiceApplicationError,
  listInvoiceApplications,
  markInvoiceApplicationIssued,
  prepareInvoiceApplicationGeneratedFile,
  prepareInvoiceApplicationMaterial,
  submitInvoiceApplication,
  updateInvoiceApplication,
  withdrawInvoiceApplication,
  type StoredInvoiceApplicationMaterial,
} from "../services/invoiceApplication.js";
import {
  exportOtherExpensesPrintableFileFromPath,
  inspectInvoiceApplicationMaterial,
  MAIN_TRIPLICATE_SHEET_NAME,
} from "../services/invoiceApplicationMaterial.js";
import type {
  InvoiceApplicationActor,
  InvoiceApplicationEmployeeListView,
  InvoiceApplicationListScope,
} from "../types/invoice-application.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 20 },
});

router.use(requireAuth);

function actor(req: Request): InvoiceApplicationActor {
  const id = req.session.userId || req.session.user?.id;
  const role = req.session.user?.role;
  if (!id || !role) throw new InvoiceApplicationError("登录状态已失效", 401);
  return { id, role };
}

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof InvoiceApplicationError)
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
}

function uploadMaterials(req: Request, res: Response, next: NextFunction) {
  upload.array("files", 20)(req, res, (error: unknown) => {
    if (!error) return next();
    const message =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "单个申请材料不能超过30MB"
        : "上传申请材料失败";
    res.status(400).json({
      success: false,
      message,
      code: "INVOICE_APPLICATION_MATERIAL_UPLOAD_INVALID",
    });
  });
}

function uploadTriplicate(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    const message =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "三联单不能超过30MB"
        : "上传三联单失败";
    res.status(400).json({
      success: false,
      message,
      code: "INVOICE_APPLICATION_TRIPLICATE_UPLOAD_INVALID",
    });
  });
}

function uploadedFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}

function inlineDisposition(fileName: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

router.get("/eligibility", async (req, res) => {
  try {
    const contractIds = String(req.query.contractIds || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (contractIds.length > 0) {
      const data = await getInvoiceApplicationEligibilityBatch(
        actor(req),
        contractIds,
      );
      res.json({ success: true, data });
      return;
    }
    const contractId = String(req.query.contractId || "").trim();
    if (!contractId) throw new InvoiceApplicationError("合同编号不能为空");
    const data = await getInvoiceApplicationEligibility(actor(req), contractId);
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "读取开票申请资格失败");
  }
});

router.get("/pending-counts", async (req, res) => {
  try {
    const data = await getInvoiceApplicationPendingCounts(actor(req));
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "读取合同开票待办数量失败");
  }
});

router.post("/triplicate-inspection", uploadTriplicate, async (req, res) => {
  try {
    const currentActor = actor(req);
    if (currentActor.role !== "user")
      throw new InvoiceApplicationError("仅普通员工可以检查开票三联单", 403);
    const contractId = String(req.body?.contractId || "").trim();
    if (!contractId) throw new InvoiceApplicationError("合同编号不能为空");
    const eligibility = await getInvoiceApplicationEligibility(
      currentActor,
      contractId,
    );
    if (!eligibility.eligible)
      throw new InvoiceApplicationError(
        eligibility.reason || "当前合同不能申请开票",
        409,
        eligibility.reasonCode || "INVOICE_APPLICATION_NOT_ELIGIBLE",
      );
    if (eligibility.contract?.category !== "main_business")
      throw new InvoiceApplicationError(
        "只有主营项目合同使用固定三联单金额识别",
        409,
      );
    const file = req.file;
    if (!file) throw new InvoiceApplicationError("请选择一份主营项目三联单");
    const inspection = await inspectInvoiceApplicationMaterial({
      contractCategory: "main",
      materialMode: "material_need_seal",
      file: { buffer: file.buffer, originalName: file.originalname },
    });
    if (
      inspection.recognizedApplicationAmount == null ||
      !inspection.recognizedAmountLabelCell ||
      !inspection.recognizedAmountValueCell ||
      !inspection.recognizedAmountDetailRange
    )
      throw new InvoiceApplicationError("三联单本次付款金额识别结果不完整");
    res.json({
      success: true,
      data: {
        paymentAmountCents: Math.round(
          inspection.recognizedApplicationAmount * 100,
        ),
        sourceSheet: MAIN_TRIPLICATE_SHEET_NAME,
        headerCell: inspection.recognizedAmountLabelCell,
        totalCell: inspection.recognizedAmountValueCell,
        detailRange: inspection.recognizedAmountDetailRange,
        fileName: inspection.originalName,
      },
    });
  } catch (error) {
    if (error instanceof InvoiceApplicationError) {
      sendError(res, error, "检查开票三联单失败");
      return;
    }
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "三联单内容不正确",
      code: "INVOICE_APPLICATION_TRIPLICATE_INVALID",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const data = await createInvoiceApplication(actor(req), req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    sendError(res, error, "保存开票申请草稿失败");
  }
});

router.get("/", async (req, res) => {
  try {
    const rawScope = String(req.query.scope || "mine");
    const scope =
      rawScope === "mine"
        ? "mine"
        : rawScope === "approval" || rawScope === "manager_pending"
          ? "approval"
          : rawScope === "manager_processed"
            ? "approval_history"
            : rawScope === "admin"
              ? "admin"
              : null;
    if (!scope) throw new InvoiceApplicationError("开票申请列表范围不正确");
    const rawView = String(req.query.view || "current");
    if (
      scope === "mine" &&
      !("current,history".split(",") as string[]).includes(rawView)
    )
      throw new InvoiceApplicationError("员工开票申请列表视图不正确");
    const data = await listInvoiceApplications(
      actor(req),
      scope as InvoiceApplicationListScope,
      typeof req.query.status === "string" ? req.query.status : undefined,
      Number(req.query.page || 1),
      Number(req.query.pageSize || 20),
      (scope === "mine"
        ? rawView
        : "current") as InvoiceApplicationEmployeeListView,
      typeof req.query.keyword === "string" ? req.query.keyword : "",
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "读取开票申请列表失败");
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const data = await updateInvoiceApplication(
      actor(req),
      req.params.id,
      req.body,
      Number(req.body?.expectedVersion),
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "更新开票申请草稿失败");
  }
});

router.post("/:id/triplicate", async (req, res) => {
  try {
    const data = await generateMainBusinessTriplicate(
      actor(req),
      req.params.id,
      {
        projectName: req.body?.projectName,
        amount: req.body?.amount,
      },
      Number(req.body?.expectedVersion),
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    sendError(res, error, "在线生成主营项目三联单失败");
  }
});

router.post("/:id/materials", uploadMaterials, async (req, res) => {
  try {
    const currentActor = actor(req);
    const application = await getInvoiceApplication(
      currentActor,
      req.params.id,
    );
    const files = uploadedFiles(req);
    if (files.length === 0)
      throw new InvoiceApplicationError("请选择要上传的申请材料");
    const requestedSeal = String(req.body?.requiresSeal || "false") === "true";
    const storedFiles: StoredInvoiceApplicationMaterial[] = [];
    for (const file of files) {
      const inspection = await inspectInvoiceApplicationMaterial({
        contractCategory:
          application.category === "main_business" ? "main" : "non_main",
        materialMode: application.materialMode,
        file: { buffer: file.buffer, originalName: file.originalname },
      });
      if (
        !inspection.originalName ||
        !inspection.mimeType ||
        !inspection.sha256
      )
        throw new InvoiceApplicationError("申请材料识别结果不完整");
      storedFiles.push({
        buffer: file.buffer,
        fileName: inspection.originalName,
        mimeType: inspection.mimeType,
        fileHash: inspection.sha256,
        requiresSeal:
          application.category === "main_business" ? true : requestedSeal,
        hasOtherExpenseSheet:
          inspection.preview?.sheetName === MAIN_TRIPLICATE_SHEET_NAME,
        recognizedApplicationAmount: inspection.recognizedApplicationAmount,
        recognizedAmountLabelCell: inspection.recognizedAmountLabelCell,
        recognizedAmountValueCell: inspection.recognizedAmountValueCell,
        recognizedAmountDetailRange: inspection.recognizedAmountDetailRange,
      });
    }
    const data = await addInvoiceApplicationMaterials(
      currentActor,
      application.id,
      storedFiles,
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    if (error instanceof InvoiceApplicationError) {
      sendError(res, error, "上传开票申请材料失败");
      return;
    }
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "申请材料不正确",
      code: "INVOICE_APPLICATION_MATERIAL_INVALID",
    });
  }
});

router.delete("/:id/materials/:materialId", async (req, res) => {
  try {
    const data = await deleteInvoiceApplicationMaterial(
      actor(req),
      req.params.id,
      req.params.materialId,
      Number(req.query.expectedVersion || req.body?.expectedVersion),
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "删除开票申请材料失败");
  }
});

router.get("/:id/materials/:materialId/preview", async (req, res) => {
  try {
    const material = await prepareInvoiceApplicationMaterial(
      actor(req),
      req.params.id,
      req.params.materialId,
    );
    if (
      material.category === "main_business" &&
      material.mimeType !== "application/pdf"
    ) {
      const printable = await exportOtherExpensesPrintableFileFromPath(
        material.absolutePath,
        material.fileName,
      );
      res.setHeader("Content-Type", printable.mimeType);
      res.setHeader(
        "Content-Disposition",
        inlineDisposition(printable.fileName),
      );
      res.send(printable.buffer);
      return;
    }
    res.setHeader("Content-Type", material.mimeType);
    res.setHeader("Content-Disposition", inlineDisposition(material.fileName));
    res.sendFile(material.absolutePath);
  } catch (error) {
    sendError(res, error, "预览开票申请材料失败");
  }
});

router.get("/:id/materials/:materialId/download", async (req, res) => {
  try {
    const material = await prepareInvoiceApplicationMaterial(
      actor(req),
      req.params.id,
      req.params.materialId,
    );
    res.type(material.mimeType);
    res.download(material.absolutePath, material.fileName);
  } catch (error) {
    sendError(res, error, "下载开票申请原始材料失败");
  }
});

router.get("/:id/materials/:materialId/print", async (req, res) => {
  try {
    const currentActor = actor(req);
    if (
      !(INVOICE_APPLICATION_ADMIN_ROLES as readonly string[]).includes(
        currentActor.role,
      )
    )
      throw new InvoiceApplicationError("仅管理员可以下载盖章打印件", 403);
    const material = await prepareInvoiceApplicationMaterial(
      currentActor,
      req.params.id,
      req.params.materialId,
    );
    if (!material.requiresSeal)
      throw new InvoiceApplicationError(
        "该附件未选择盖章，不能生成打印件",
        409,
      );
    if (
      material.category === "main_business" &&
      material.mimeType !== "application/pdf"
    ) {
      const printable = await exportOtherExpensesPrintableFileFromPath(
        material.absolutePath,
        material.fileName,
      );
      res.setHeader("Content-Type", printable.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(printable.fileName)}`,
      );
      res.send(printable.buffer);
      return;
    }
    if (
      material.category === "main_business" &&
      material.mimeType === "application/pdf"
    ) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        inlineDisposition(material.fileName),
      );
      res.sendFile(material.absolutePath);
      return;
    }
    res.type(material.mimeType);
    res.download(material.absolutePath, material.fileName);
  } catch (error) {
    sendError(res, error, "生成盖章打印件失败");
  }
});

router.get("/:id/application-preview", async (req, res) => {
  try {
    const file = await prepareInvoiceApplicationGeneratedFile(
      actor(req),
      req.params.id,
    );
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", inlineDisposition(file.fileName));
    res.sendFile(file.absolutePath);
  } catch (error) {
    sendError(res, error, "预览开票申请单失败");
  }
});

router.get("/:id/generated-files/:fileId/preview", async (req, res) => {
  try {
    const file = await prepareInvoiceApplicationGeneratedFile(
      actor(req),
      req.params.id,
      req.params.fileId,
    );
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", inlineDisposition(file.fileName));
    res.sendFile(file.absolutePath);
  } catch (error) {
    sendError(res, error, "预览指定开票申请单失败");
  }
});

router.post("/:id/submit", async (req, res) => {
  try {
    const data = await submitInvoiceApplication(
      actor(req),
      req.params.id,
      Number(req.body?.expectedVersion),
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "提交开票申请失败");
  }
});

router.post("/:id/withdraw", async (req, res) => {
  try {
    const data = await withdrawInvoiceApplication(
      actor(req),
      req.params.id,
      Number(req.body?.expectedVersion),
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "撤回开票申请失败");
  }
});

router.post("/:id/decision", async (req, res) => {
  try {
    const decision = req.body?.decision;
    if (decision !== "approve" && decision !== "reject")
      throw new InvoiceApplicationError("请选择批准或驳回");
    const data = await decideInvoiceApplication(
      actor(req),
      req.params.id,
      decision,
      req.body?.comment,
      Number(req.body?.expectedVersion),
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "审批开票申请失败");
  }
});

router.post("/:id/deliver", async (req, res) => {
  try {
    const data = await deliverInvoiceApplicationMaterials(
      actor(req),
      req.params.id,
      req.body?.note,
      Number(req.body?.expectedVersion),
      req.body?.sealedTriplicateFileId,
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "登记盖章材料交付失败");
  }
});

router.post("/:id/mark-issued", async (req, res) => {
  try {
    const data = await markInvoiceApplicationIssued(
      actor(req),
      req.params.id,
      req.body?.note,
      Number(req.body?.expectedVersion),
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "登记正式发票已开具失败");
  }
});

router.get("/:id", async (req, res) => {
  try {
    const data = await getInvoiceApplication(actor(req), req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "读取开票申请详情失败");
  }
});

export default router;
