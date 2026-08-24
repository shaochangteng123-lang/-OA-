import fs from "fs";
import path from "path";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  acknowledgeContractDownloadResults,
  completeContractDownloadRequest,
  ContractDownloadRequestError,
  createContractDownloadRequest,
  deleteWithdrawnContractDownloadRequest,
  decideContractDownloadRequest,
  exportAdminContractDownloadHistory,
  exportManagerContractDownloadHistory,
  getAvailableContractDownloadFiles,
  getContractDownloadPendingCounts,
  getContractDownloadRequest,
  isContractDownloadAdminRole,
  listContractDownloadRequests,
  markApprovedContractFileDownloaded,
  prepareApprovedContractFileDownload,
  prepareContractDownloadApplicationPreview,
  prepareContractDownloadRequestFilePreview,
  resubmitContractDownloadRequest,
  type ContractDownloadActor,
  withdrawContractDownloadRequest,
} from "../services/contractDownloadRequest.js";
import type { ContractDownloadDecision } from "../types/contract-download-request.js";
import { validateFilePath } from "../utils/file-validation.js";

const router = Router();

router.use(requireAuth);

function currentActor(req: Request): ContractDownloadActor {
  const id = req.session.userId || req.session.user?.id;
  const role = req.session.user?.role;
  if (!id || !role) {
    throw new ContractDownloadRequestError("登录状态已失效", 401);
  }
  return { id, role };
}

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof ContractDownloadRequestError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
}

function inlineDisposition(fileName: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

router.get("/available/:contractId", async (req, res) => {
  try {
    const data = await getAvailableContractDownloadFiles(
      currentActor(req),
      req.params.contractId,
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "读取可申请下载的合同附件失败");
  }
});

router.post("/", async (req, res) => {
  try {
    const data = await createContractDownloadRequest(currentActor(req), {
      contractId: req.body?.contractId,
      purpose: req.body?.purpose,
      fileIds: req.body?.fileIds,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    sendError(res, error, "提交合同文件下载申请失败");
  }
});

router.get("/", async (req, res) => {
  try {
    const rawScope = String(req.query.scope || "mine");
    const scope =
      rawScope === "mine"
        ? "mine"
        : rawScope === "employee_history"
          ? "mine_history"
          : rawScope === "manager_pending"
            ? "approval"
            : rawScope === "manager_processed"
              ? "approval_history"
              : rawScope === "admin_pending"
                ? "admin"
                : rawScope === "admin_processed"
                  ? "admin_history"
                  : null;
    if (!scope) {
      throw new ContractDownloadRequestError(
        "scope 必须为 mine、employee_history、manager_pending、manager_processed、admin_pending 或 admin_processed",
      );
    }
    const data = await listContractDownloadRequests(
      currentActor(req),
      scope,
      typeof req.query.status === "string" ? req.query.status : undefined,
      Number(req.query.page || 1),
      Number(req.query.pageSize || 20),
      typeof req.query.keyword === "string" ? req.query.keyword : "",
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "读取合同文件下载申请失败");
  }
});

router.get("/pending-counts", async (req, res) => {
  try {
    const data = await getContractDownloadPendingCounts(currentActor(req));
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "读取合同下载申请提醒失败");
  }
});

router.get("/manager-processed/export", async (req, res) => {
  try {
    const exported = await exportManagerContractDownloadHistory(
      currentActor(req),
      typeof req.query.keyword === "string" ? req.query.keyword : "",
    );
    res.setHeader("Content-Type", exported.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`,
    );
    res.send(exported.buffer);
  } catch (error) {
    sendError(res, error, "导出合同下载审批记录失败");
  }
});

router.get("/admin-processed/export", async (req, res) => {
  try {
    const exported = await exportAdminContractDownloadHistory(
      currentActor(req),
      typeof req.query.keyword === "string" ? req.query.keyword : "",
    );
    res.setHeader("Content-Type", exported.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`,
    );
    res.send(exported.buffer);
  } catch (error) {
    sendError(res, error, "导出合同下载处理记录失败");
  }
});

router.post("/notifications/acknowledge", async (req, res) => {
  try {
    const data = await acknowledgeContractDownloadResults(
      currentActor(req),
      req.body?.requestIds,
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "确认合同下载申请结果已读失败");
  }
});

router.get("/:id/application-preview", async (req, res) => {
  try {
    const actor = currentActor(req);
    const forceDownload = req.query.download === "1";
    if (
      forceDownload &&
      actor.role !== "general_manager" &&
      !isContractDownloadAdminRole(actor.role)
    ) {
      throw new ContractDownloadRequestError(
        "普通员工不能直接下载合同附件下载申请单",
        403,
        "CONTRACT_DOWNLOAD_APPLICATION_DIRECT_DOWNLOAD_FORBIDDEN",
      );
    }
    const file = await prepareContractDownloadApplicationPreview(
      actor,
      req.params.id,
    );
    if (forceDownload) {
      res.download(file.absolutePath, file.fileName);
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", inlineDisposition(file.fileName));
    res.sendFile(file.absolutePath);
  } catch (error) {
    sendError(res, error, "预览合同文件下载申请单失败");
  }
});

router.get("/:id", async (req, res) => {
  try {
    const data = await getContractDownloadRequest(
      currentActor(req),
      req.params.id,
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "读取合同文件下载申请详情失败");
  }
});

router.post("/:id/decision", async (req, res) => {
  try {
    const data = await decideContractDownloadRequest(
      currentActor(req),
      req.params.id,
      req.body?.decision as ContractDownloadDecision,
      req.body?.comment,
      Number(req.body?.expectedVersion),
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "审批合同文件下载申请失败");
  }
});

router.post("/:id/withdraw", async (req, res) => {
  try {
    const data = await withdrawContractDownloadRequest(
      currentActor(req),
      req.params.id,
      req.body?.reason,
      Number(req.body?.expectedVersion),
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "撤回合同文件下载申请失败");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const removed = await deleteWithdrawnContractDownloadRequest(
      currentActor(req),
      req.params.id,
      Number(req.query.expectedVersion),
    );
    for (const storedPath of removed.storedFilePaths) {
      try {
        if (!validateFilePath(storedPath)) continue;
        const absolutePath = path.resolve(process.cwd(), storedPath);
        await fs.promises.unlink(absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error("清理已删除下载申请生成文件失败:", {
            storedPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    sendError(res, error, "删除已撤回的合同下载申请失败");
  }
});

router.post("/:id/resubmit", async (req, res) => {
  try {
    const data = await resubmitContractDownloadRequest(
      currentActor(req),
      req.params.id,
      {
        purpose: req.body?.purpose,
        fileIds: req.body?.fileIds,
      },
      Number(req.body?.expectedVersion),
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    sendError(res, error, "重新提交合同文件下载申请失败");
  }
});

router.get("/:id/files/:requestFileId/preview", async (req, res) => {
  try {
    const file = await prepareContractDownloadRequestFilePreview(
      currentActor(req),
      req.params.id,
      req.params.requestFileId,
    );
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", inlineDisposition(file.fileName));
    res.sendFile(file.absolutePath);
  } catch (error) {
    sendError(res, error, "预览申请中的合同文件失败");
  }
});

router.get("/:id/files/:requestFileId/download", async (req, res) => {
  try {
    const actor = currentActor(req);
    const file = await prepareApprovedContractFileDownload(
      actor,
      req.params.id,
      req.params.requestFileId,
    );
    res.type(file.mimeType);
    res.download(file.absolutePath, file.fileName, async (error) => {
      if (error) {
        console.error("合同文件传输失败，未记录下载完成:", error);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: "合同文件传输失败" });
        }
        return;
      }
      try {
        await markApprovedContractFileDownloaded(
          actor,
          req.params.id,
          req.params.requestFileId,
        );
      } catch (markError) {
        console.error("合同文件已传输，但记录下载结果失败:", markError);
      }
    });
  } catch (error) {
    sendError(res, error, "执行合同文件下载失败");
  }
});

router.post("/:id/complete", async (req, res) => {
  try {
    const data = await completeContractDownloadRequest(
      currentActor(req),
      req.params.id,
      req.body?.processingNote,
      Number(req.body?.expectedVersion),
    );
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, "标记合同文件下载申请已处理失败");
  }
});

export default router;
