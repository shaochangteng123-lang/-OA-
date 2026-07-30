import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { execFileSync } from "child_process";
import multer from "multer";
import { nanoid } from "nanoid";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { validateFilePath } from "../utils/file-validation.js";
import { normalizeUploadFileName } from "../utils/upload-file-name.js";
import {
  analyzePageXml,
  splitImage,
} from "../services/bankReceiptProcessor.js";
import { db } from "../db/index.js";
import { isAdminLike } from "../utils/worklog-auth.js";
import { sendConvertedPdf, CONVERTIBLE_EXT } from "../utils/doc-preview.js";

const router = express.Router();

// 下载发票文件
router.get("/invoices/*", requireAuth, async (req, res) => {
  try {
    const filename = (req.params as any)[0];
    const userId = req.session.userId!;

    // 构造文件路径
    const filePath = `uploads/invoices/${filename}`;

    // 安全校验
    if (!validateFilePath(filePath)) {
      return res.status(403).json({ success: false, message: "非法文件路径" });
    }

    // 查询该文件是否属于当前用户的报销单
    console.log("🔍 查询文件权限 - 文件路径:", filePath);
    console.log("🔍 查询文件权限 - 用户ID:", userId);
    const invoice = await db.get(
      `SELECT r.user_id, r.id as reimbursement_id, r.type
       FROM reimbursement_invoices ri
       JOIN reimbursements r ON ri.reimbursement_id = r.id
       WHERE ri.file_path = ? OR ri.file_path = ?`,
      filePath,
      "/" + filePath,
    );

    console.log("🔍 查询结果:", invoice);

    // 如果数据库中找到记录，检查权限
    if (invoice) {
      const user = await db.get("SELECT role FROM users WHERE id = ?", userId);
      const isAdmin = user?.role === "admin" || user?.role === "super_admin";
      const isGMForBusiness =
        user?.role === "general_manager" && invoice.type === "business";

      if (invoice.user_id !== userId && !isAdmin && !isGMForBusiness) {
        console.log("❌ 无权访问 - 不是文件所有者");
        return res
          .status(403)
          .json({ success: false, message: "无权访问此文件" });
      }
    } else {
      // 数据库中没有正式记录，检查是否为当前用户上传的草稿文件（查数据库，不依赖 session）
      const uploadedRecord = await db.get(
        `SELECT id FROM user_uploaded_files WHERE user_id = ? AND file_path = ?`,
        userId,
        filePath,
      );
      if (!uploadedRecord) {
        console.log("❌ 数据库未找到记录且非当前用户上传文件，拒绝访问");
        return res
          .status(403)
          .json({ success: false, message: "无权访问此文件" });
      }
      console.log("✅ 匹配用户上传记录，允许草稿预览");
    }

    // 读取并返回文件
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.log("❌ 文件不存在 - 磁盘上没有文件");
      return res.status(404).json({ success: false, message: "文件不存在" });
    }

    console.log("✅ 文件访问成功，返回文件");
    res.sendFile(fullPath);
  } catch (error) {
    console.error("下载发票文件失败:", error);
    res.status(500).json({ success: false, message: "下载失败" });
  }
});

// 下载付款回单
router.get("/payment-proofs/*", requireAuth, async (req, res) => {
  try {
    const filename = (req.params as any)[0];
    const userId = req.session.userId!;

    const filePath = `uploads/invoices/${filename}`;

    if (!validateFilePath(filePath)) {
      return res.status(403).json({ success: false, message: "非法文件路径" });
    }

    // 查询该回单是否属于当前用户的报销单或批量付款
    let proof = await db.get(
      `SELECT r.user_id, r.type
       FROM reimbursements r
       WHERE r.payment_proof_path LIKE ?`,
      `%${filename}%`,
    );

    // 如果在 reimbursements 中没找到，查询 payment_batches 表
    if (!proof) {
      const batch = await db.get(
        `SELECT pb.payer_id as user_id
         FROM payment_batches pb
         WHERE pb.payment_proof_path LIKE ?`,
        `%${filename}%`,
      );
      if (batch) {
        proof = { user_id: batch.user_id, type: "batch" };
      }
    }

    if (!proof) {
      return res.status(404).json({ success: false, message: "文件不存在" });
    }

    // 检查权限：必须是文件所有者、管理员，或总经理（仅限商务报销）
    const user = await db.get("SELECT role FROM users WHERE id = ?", userId);
    const isAdmin = user?.role === "admin" || user?.role === "super_admin";
    const isGMForBusiness =
      user?.role === "general_manager" && proof.type === "business";

    if (proof.user_id !== userId && !isAdmin && !isGMForBusiness) {
      return res
        .status(403)
        .json({ success: false, message: "无权访问此文件" });
    }

    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: "文件不存在" });
    }

    res.sendFile(fullPath);
  } catch (error) {
    console.error("下载付款回单失败:", error);
    res.status(500).json({ success: false, message: "下载失败" });
  }
});

// 下载银行回单图片
router.get("/bank-receipts/*", requireAuth, async (req, res) => {
  try {
    const subPath = (req.params as any)[0];
    const filePath = `uploads/bank-receipts/${subPath}`;

    if (!validateFilePath(filePath)) {
      return res.status(403).json({ success: false, message: "非法文件路径" });
    }

    const userId = req.session.userId!;
    const user = await db.get("SELECT role FROM users WHERE id = ?", userId);
    const isAdmin =
      user?.role === "admin" ||
      user?.role === "super_admin" ||
      user?.role === "general_manager";

    // 非管理员/总经理：检查该回单是否属于自己的报销单
    if (!isAdmin) {
      const ownedReimbursement = await db.get(
        `SELECT id FROM reimbursements WHERE payment_proof_path LIKE ? AND user_id = ? AND is_deleted = false`,
        `%${subPath}%`,
        userId,
      );
      if (!ownedReimbursement) {
        return res.status(403).json({ success: false, message: "无权访问" });
      }
    }

    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: "文件不存在" });
    }

    res.sendFile(fullPath);
  } catch {
    res.status(500).json({ success: false, message: "下载失败" });
  }
});

// 预览人力成本银行回单：仅管理员可读取。
router.get(
  "/human-cost-receipts/:receiptId",
  requireAdmin,
  async (req, res) => {
    try {
      const receipt = await db.get<{
        file_path: string;
        mime_type: string;
        file_name: string;
      }>(
        `SELECT file_path, mime_type, file_name
       FROM human_cost_receipts
       WHERE id = ?`,
        req.params.receiptId,
      );
      if (!receipt) {
        return res
          .status(404)
          .json({ success: false, message: "人力成本回单不存在" });
      }
      if (
        !receipt.file_path.startsWith("uploads/human-cost-receipts/") ||
        !validateFilePath(receipt.file_path)
      ) {
        return res
          .status(403)
          .json({ success: false, message: "非法文件路径" });
      }

      const fullPath = path.resolve(process.cwd(), receipt.file_path);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ success: false, message: "文件不存在" });
      }

      res.setHeader("Content-Type", receipt.mime_type);
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(normalizeUploadFileName(receipt.file_name))}`,
      );
      res.sendFile(fullPath);
    } catch (error) {
      console.error("预览人力成本回单失败:", error);
      res.status(500).json({ success: false, message: "预览失败" });
    }
  },
);

// 在线预览工资表中的个人个税明细：仅管理员可读取。
router.get("/payroll-tax-details/:fileId", requireAdmin, async (req, res) => {
  try {
    const taxDetail = await db.get<{
      file_path: string;
      mime_type: string;
      file_name: string;
    }>(
      `SELECT file_path, mime_type, file_name
         FROM payroll_tax_detail_files
         WHERE id = ?`,
      req.params.fileId,
    );
    if (!taxDetail) {
      return res
        .status(404)
        .json({ success: false, message: "个人个税明细不存在" });
    }
    if (
      !taxDetail.file_path.startsWith("uploads/payroll-tax-details/") ||
      !validateFilePath(taxDetail.file_path)
    ) {
      return res.status(403).json({ success: false, message: "非法文件路径" });
    }

    const fullPath = path.resolve(process.cwd(), taxDetail.file_path);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: "文件不存在" });
    }

    res.setHeader("Content-Type", taxDetail.mime_type);
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(normalizeUploadFileName(taxDetail.file_name))}`,
    );
    res.sendFile(fullPath);
  } catch (error) {
    console.error("预览个人个税明细失败:", error);
    res.status(500).json({ success: false, message: "预览失败" });
  }
});

// 预览某位员工对应的单笔工资回单：PDF 会定位并裁切到识别出的单笔区域。
router.get(
  "/human-cost-receipt-items/:itemId",
  requireAdmin,
  async (req, res) => {
    let temporaryDirectory: string | null = null;
    const cleanup = () => {
      if (!temporaryDirectory) return;
      try {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      } catch {
        // 预览临时文件清理失败不覆盖文件响应。
      }
      temporaryDirectory = null;
    };

    try {
      const item = await db.get<{
        file_path: string;
        mime_type: string;
        payee_name: string;
        amount: string;
        page_no: number;
        position: "full" | "top" | "bottom";
      }>(
        `SELECT
           hcr.file_path,
           hcr.mime_type,
           hcri.payee_name,
           hcri.amount::text AS amount,
           hcri.page_no,
           hcri.position
         FROM human_cost_receipt_items hcri
         JOIN human_cost_receipts hcr ON hcr.id = hcri.receipt_id
         WHERE hcri.id = ?
           AND hcri.match_status = 'matched'
           AND hcri.employee_id IS NOT NULL`,
        req.params.itemId,
      );
      if (!item) {
        return res
          .status(404)
          .json({ success: false, message: "员工工资回单不存在" });
      }
      if (
        !item.file_path.startsWith("uploads/human-cost-receipts/") ||
        !validateFilePath(item.file_path)
      ) {
        return res
          .status(403)
          .json({ success: false, message: "非法文件路径" });
      }

      const fullPath = path.resolve(process.cwd(), item.file_path);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ success: false, message: "文件不存在" });
      }
      if (item.mime_type !== "application/pdf") {
        res.setHeader("Content-Type", item.mime_type);
        res.setHeader(
          "Content-Disposition",
          `inline; filename*=UTF-8''${encodeURIComponent(`${item.payee_name}-工资回单${path.extname(fullPath)}`)}`,
        );
        return res.sendFile(fullPath);
      }

      temporaryDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "human-cost-receipt-preview-"),
      );
      const pagePrefix = path.join(temporaryDirectory, "page");
      execFileSync(
        "pdftoppm",
        [
          "-f",
          String(item.page_no),
          "-l",
          String(item.page_no),
          "-singlefile",
          "-r",
          "160",
          "-jpeg",
          fullPath,
          pagePrefix,
        ],
        { timeout: 30_000 },
      );
      const pageImagePath = `${pagePrefix}.jpg`;
      let previewPath = pageImagePath;
      if (item.position !== "full") {
        const { splitY } = analyzePageXml(fullPath, item.page_no);
        if (splitY) {
          const split = await splitImage(
            pageImagePath,
            splitY,
            1262,
            temporaryDirectory,
            "receipt",
          );
          previewPath = item.position === "top" ? split.top : split.bottom;
        }
      }

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(`${item.payee_name}-${item.amount}-工资回单.jpg`)}`,
      );
      return res.sendFile(previewPath, (error) => {
        cleanup();
        if (error && !res.headersSent) {
          res.status(500).json({ success: false, message: "预览失败" });
        }
      });
    } catch (error) {
      cleanup();
      console.error("预览员工工资回单失败:", error);
      return res.status(500).json({ success: false, message: "预览失败" });
    }
  },
);

// 下载项目日志附件：按附件 id 查权限后返回文件
router.get("/worklog/:attachmentId", requireAuth, async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const userId = req.session.userId!;

    const att = await db.get<{
      file_path: string;
      mime_type: string | null;
      file_name: string;
      entry_user_id: string;
    }>(
      `SELECT a.file_path, a.mime_type, a.file_name, e.user_id AS entry_user_id
       FROM worklog_attachments a
       JOIN worklog_entries e ON e.id = a.entry_id
       WHERE a.id = ?`,
      attachmentId,
    );
    if (!att)
      return res.status(404).json({ success: false, message: "附件不存在" });

    if (!validateFilePath(att.file_path)) {
      return res.status(403).json({ success: false, message: "非法文件路径" });
    }

    if (att.entry_user_id !== userId && !(await isAdminLike(userId))) {
      return res
        .status(403)
        .json({ success: false, message: "无权访问此附件" });
    }

    const fullPath = path.resolve(process.cwd(), att.file_path);
    if (!fs.existsSync(fullPath))
      return res.status(404).json({ success: false, message: "文件不存在" });

    if (att.mime_type) res.setHeader("Content-Type", att.mime_type);
    res.sendFile(fullPath);
  } catch (err) {
    console.error("下载日志附件失败:", err);
    res.status(500).json({ success: false, message: "下载失败" });
  }
});

/**
 * 将 Office 文档转换为 PDF 并作为响应内联返回。失败时通过 res.status(500) 返回 JSON。
 */

/**
 * 项目日志附件在线预览：PDF 原样返回；Word/Excel/PPT 通过 libreoffice 转换为 PDF 后返回。
 * 其他类型回退为直接下载。
 */
router.get("/worklog/:attachmentId/preview", requireAuth, async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const userId = req.session.userId!;

    const att = await db.get<{
      file_path: string;
      mime_type: string | null;
      file_name: string;
      entry_user_id: string;
    }>(
      `SELECT a.file_path, a.mime_type, a.file_name, e.user_id AS entry_user_id
       FROM worklog_attachments a
       JOIN worklog_entries e ON e.id = a.entry_id
       WHERE a.id = ?`,
      attachmentId,
    );
    if (!att)
      return res.status(404).json({ success: false, message: "附件不存在" });
    if (!validateFilePath(att.file_path)) {
      return res.status(403).json({ success: false, message: "非法文件路径" });
    }
    if (att.entry_user_id !== userId && !(await isAdminLike(userId))) {
      return res
        .status(403)
        .json({ success: false, message: "无权访问此附件" });
    }
    const fullPath = path.resolve(process.cwd(), att.file_path);
    if (!fs.existsSync(fullPath))
      return res.status(404).json({ success: false, message: "文件不存在" });

    const ext = path.extname(att.file_name).toLowerCase().replace(".", "");

    if (ext === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(att.file_name)}"`,
      );
      return res.sendFile(fullPath);
    }

    if (!CONVERTIBLE_EXT.includes(ext)) {
      if (att.mime_type) res.setHeader("Content-Type", att.mime_type);
      return res.sendFile(fullPath);
    }

    await sendConvertedPdf(res, fullPath, att.file_name);
  } catch (err) {
    console.error("预览日志附件失败:", err);
    res.status(500).json({ success: false, message: "预览失败" });
  }
});

/**
 * 尚未保存的日志附件临时预览：接收单个文件，转换为 PDF 流返回。
 * 仅在内存/临时目录中处理，不写入数据库。
 */
const tempPreviewUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worklog-preview-in-"));
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || "";
      cb(null, `${nanoid(8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post(
  "/worklog-preview-temp",
  requireAuth,
  tempPreviewUpload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file)
      return res.status(400).json({ success: false, message: "未上传文件" });
    const originalName = Buffer.from(file.originalname, "latin1").toString(
      "utf8",
    );
    const ext = path.extname(originalName).toLowerCase().replace(".", "");

    const cleanup = () => {
      try {
        fs.rmSync(path.dirname(file.path), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    };

    try {
      if (ext === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(originalName)}"`,
        );
        const stream = fs.createReadStream(file.path);
        stream.on("close", cleanup);
        return stream.pipe(res);
      }

      if (!CONVERTIBLE_EXT.includes(ext)) {
        cleanup();
        return res
          .status(400)
          .json({ success: false, message: "不支持在线预览的文件格式" });
      }

      res.on("close", cleanup);
      await sendConvertedPdf(res, file.path, originalName);
    } catch (err) {
      cleanup();
      console.error("临时预览失败:", err);
      res.status(500).json({ success: false, message: "预览失败" });
    }
  },
);

router.get("/worklog-contract/:attachmentId", requireAuth, async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const att = await db.get<{
      file_path: string;
      mime_type: string | null;
      file_name: string;
    }>(
      `SELECT file_path, mime_type, file_name FROM worklog_contract_attachments WHERE id = ?`,
      attachmentId,
    );
    if (!att)
      return res.status(404).json({ success: false, message: "附件不存在" });

    if (!validateFilePath(att.file_path)) {
      return res.status(403).json({ success: false, message: "非法文件路径" });
    }

    const fullPath = path.resolve(process.cwd(), att.file_path);
    if (!fs.existsSync(fullPath))
      return res.status(404).json({ success: false, message: "文件不存在" });

    if (att.mime_type) res.setHeader("Content-Type", att.mime_type);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(att.file_name)}"`,
    );
    res.sendFile(fullPath);
  } catch (err) {
    console.error("下载合同附件失败:", err);
    res.status(500).json({ success: false, message: "下载失败" });
  }
});

router.get(
  "/worklog-contract/:attachmentId/preview",
  requireAuth,
  async (req, res) => {
    try {
      const { attachmentId } = req.params;
      const att = await db.get<{
        file_path: string;
        mime_type: string | null;
        file_name: string;
      }>(
        `SELECT file_path, mime_type, file_name FROM worklog_contract_attachments WHERE id = ?`,
        attachmentId,
      );
      if (!att)
        return res.status(404).json({ success: false, message: "附件不存在" });
      if (!validateFilePath(att.file_path)) {
        return res
          .status(403)
          .json({ success: false, message: "非法文件路径" });
      }
      const fullPath = path.resolve(process.cwd(), att.file_path);
      if (!fs.existsSync(fullPath))
        return res.status(404).json({ success: false, message: "文件不存在" });

      const ext = path.extname(att.file_name).toLowerCase().replace(".", "");

      if (ext === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(att.file_name)}"`,
        );
        return res.sendFile(fullPath);
      }

      if (!CONVERTIBLE_EXT.includes(ext)) {
        if (att.mime_type) res.setHeader("Content-Type", att.mime_type);
        return res.sendFile(fullPath);
      }

      await sendConvertedPdf(res, fullPath, att.file_name);
    } catch (err) {
      console.error("预览合同附件失败:", err);
      res.status(500).json({ success: false, message: "预览失败" });
    }
  },
);

export default router;
