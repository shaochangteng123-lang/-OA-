/**
 * 认证路由
 * 账号密码登录系统
 */

import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/index.js";
import { nanoid } from "nanoid";
import type {
  User,
  UserDelegatedSignature,
  UserSignature,
} from "../types/database.js";
import {
  verifyPassword,
  hashPassword,
  validatePasswordStrength,
} from "../utils/password.js";
import { requireAuth } from "../middleware/auth.js";
import {
  ensureDatedUploadDirectory,
  toStoredUploadPath,
} from "../utils/upload-date.js";
import {
  decodePngSignatureDataUrl,
  normalizeSignaturePng,
} from "../utils/electronic-signature.js";
import { validateFilePath } from "../utils/file-validation.js";

const router = Router();

type PersonalSignatureType = "personal" | "general_manager";

interface SignatureAccessContext {
  user: Pick<User, "id" | "name" | "role">;
  representedUser: { id: string; name: string } | null;
}

function parsePersonalSignatureType(
  value: unknown,
): PersonalSignatureType | null {
  if (value === undefined || value === "" || value === "personal") {
    return "personal";
  }
  return value === "general_manager" ? value : null;
}

async function getSignatureAccessContext(
  userId: string,
  signatureType: PersonalSignatureType,
): Promise<SignatureAccessContext | null> {
  const user = (await db
    .prepare(
      `SELECT id, name, role
       FROM users
       WHERE id = ? AND status = 'active'`,
    )
    .get(userId)) as Pick<User, "id" | "name" | "role"> | undefined;
  if (!user) return null;

  if (signatureType === "personal") {
    return { user, representedUser: { id: user.id, name: user.name } };
  }
  if (!["admin", "super_admin"].includes(user.role)) {
    return { user, representedUser: null };
  }

  const representedUser = (await db
    .prepare(
      `SELECT id, name
       FROM users
       WHERE role = 'general_manager' AND status = 'active'
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .get()) as { id: string; name: string } | undefined;
  return { user, representedUser: representedUser || null };
}

function resolvePersonalSignaturePath(storedPath: string) {
  if (!validateFilePath(storedPath)) {
    throw new Error("个人电子签名文件路径不正确");
  }
  return path.resolve(process.cwd(), storedPath.replace(/^[/\\]+/, ""));
}

function removePersonalSignatureFile(storedPath: string | null | undefined) {
  if (!storedPath) return;
  try {
    const filePath = resolvePersonalSignaturePath(storedPath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.error("清理个人电子签名文件失败:", error);
  }
}

function personalSignatureFileExists(
  storedPath: string | null | undefined,
): boolean {
  if (!storedPath) return false;
  try {
    return fs.existsSync(resolvePersonalSignaturePath(storedPath));
  } catch {
    return false;
  }
}

// 账号密码登录
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // 验证输入
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "请输入用户名和密码",
      });
    }

    // 查找用户
    const user = (await db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username)) as User | undefined;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "该用户未注册，请联系管理员进行注册",
        code: "USER_NOT_FOUND",
      });
    }

    // 检查用户状态
    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "账号已被禁用，请联系管理员",
      });
    }

    // 检查是否设置了密码
    if (!user.password_hash) {
      return res.status(401).json({
        success: false,
        message: "账号未设置密码，请联系管理员重置密码",
      });
    }

    // 验证密码
    const isPasswordValid = await verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "密码错误，请重新输入",
        code: "WRONG_PASSWORD",
      });
    }

    // 更新最后登录时间
    const now = new Date().toISOString();
    await db
      .prepare(
        "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, now, user.id);

    // 设置session
    if (req.session) {
      req.session.isLoggedIn = true;
      req.session.userId = user.id;
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
        forceChangePassword: user.force_change_password,
      };

      // 保存session
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error("❌ Session 保存失败:", err);
            reject(err);
          } else {
            console.log("✅ 登录成功:", {
              userId: user.id,
              userName: user.name,
              role: user.role,
            });
            resolve();
          }
        });
      });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatar_url: user.avatar_url,
          role: user.role,
          forceChangePassword: user.force_change_password,
        },
      },
      message: "登录成功",
    });
  } catch (error) {
    console.error("❌ 登录失败:", error);
    res.status(500).json({
      success: false,
      message: "服务器错误，请稍后重试",
      code: "SERVER_ERROR",
    });
  }
});

// 获取当前账号的个人电子签名状态
router.get("/signature", requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "未登录" });
    }
    const signatureType = parsePersonalSignatureType(req.query.type);
    if (!signatureType) {
      return res.status(400).json({
        success: false,
        message: "电子签名类型不正确",
      });
    }
    const access = await getSignatureAccessContext(userId, signatureType);
    if (!access) {
      return res.status(401).json({
        success: false,
        message: "用户不存在或已停用",
      });
    }
    if (
      signatureType === "general_manager" &&
      !["admin", "super_admin"].includes(access.user.role)
    ) {
      return res.status(403).json({
        success: false,
        message: "只有管理员可以维护总经理签名",
      });
    }

    const signature =
      signatureType === "personal"
        ? ((await db
            .prepare(
              `SELECT user_id, signature_path, created_at, updated_at
               FROM user_signatures
               WHERE user_id = ?`,
            )
            .get(userId)) as UserSignature | undefined)
        : ((await db
            .prepare(
              `SELECT user_id, represented_user_id, represented_user_name,
                      signature_path, created_at, updated_at
               FROM user_delegated_signatures
               WHERE user_id = ?`,
            )
            .get(userId)) as UserDelegatedSignature | undefined);

    const hasSignature = personalSignatureFileExists(signature?.signature_path);
    const ownerName =
      signatureType === "personal"
        ? access.user.name
        : (signature as UserDelegatedSignature | undefined)
            ?.represented_user_name ||
          access.representedUser?.name ||
          "总经理";
    res.json({
      success: true,
      data: {
        signatureType,
        ownerName,
        hasSignature,
        updatedAt: hasSignature ? signature?.updated_at || null : null,
      },
    });
  } catch (error) {
    console.error("获取个人电子签名状态失败:", error);
    res.status(500).json({
      success: false,
      message: "获取个人电子签名状态失败",
    });
  }
});

// 当前账号读取自己的个人电子签名图片
router.get("/signature/image", requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "未登录" });
    }
    const signatureType = parsePersonalSignatureType(req.query.type);
    if (!signatureType) {
      return res.status(400).json({
        success: false,
        message: "电子签名类型不正确",
      });
    }
    const access = await getSignatureAccessContext(userId, signatureType);
    if (!access) {
      return res.status(401).json({
        success: false,
        message: "用户不存在或已停用",
      });
    }
    if (
      signatureType === "general_manager" &&
      !["admin", "super_admin"].includes(access.user.role)
    ) {
      return res.status(403).json({
        success: false,
        message: "只有管理员可以读取总经理签名",
      });
    }

    const signature =
      signatureType === "personal"
        ? ((await db
            .prepare(
              `SELECT user_id, signature_path, created_at, updated_at
               FROM user_signatures
               WHERE user_id = ?`,
            )
            .get(userId)) as UserSignature | undefined)
        : ((await db
            .prepare(
              `SELECT user_id, represented_user_id, represented_user_name,
                      signature_path, created_at, updated_at
               FROM user_delegated_signatures
               WHERE user_id = ?`,
            )
            .get(userId)) as UserDelegatedSignature | undefined);
    if (!signature) {
      return res.status(404).json({
        success: false,
        message:
          signatureType === "personal"
            ? "尚未保存个人电子签名"
            : "尚未保存总经理电子签名",
      });
    }

    const filePath = resolvePersonalSignaturePath(signature.signature_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: "电子签名文件不存在，请重新上传",
      });
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.type("png");
    return res.sendFile(filePath);
  } catch (error) {
    console.error("读取个人电子签名失败:", error);
    res.status(500).json({
      success: false,
      message: "读取个人电子签名失败",
    });
  }
});

// 当前账号保存或更换自己的个人电子签名
router.post("/signature", requireAuth, async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: "未登录" });
  }
  const signatureType = parsePersonalSignatureType(req.body?.signatureType);
  if (!signatureType) {
    return res.status(400).json({
      success: false,
      message: "电子签名类型不正确",
    });
  }
  const access = await getSignatureAccessContext(userId, signatureType);
  if (!access) {
    return res.status(401).json({
      success: false,
      message: "用户不存在或已停用",
    });
  }
  if (
    signatureType === "general_manager" &&
    !["admin", "super_admin"].includes(access.user.role)
  ) {
    return res.status(403).json({
      success: false,
      message: "只有管理员可以维护总经理签名",
    });
  }
  if (signatureType === "general_manager" && !access.representedUser) {
    return res.status(409).json({
      success: false,
      message: "请先创建并启用总经理账号",
    });
  }

  let signatureBuffer: Buffer;
  try {
    signatureBuffer = await normalizeSignaturePng(
      decodePngSignatureDataUrl(req.body?.signatureDataUrl),
    );
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "电子签名不正确",
    });
  }

  const uploadedAt = new Date();
  const now = uploadedAt.toISOString();
  let newFilePath = "";
  try {
    const existing =
      signatureType === "personal"
        ? ((await db
            .prepare(
              `SELECT user_id, signature_path, created_at, updated_at
               FROM user_signatures
               WHERE user_id = ?`,
            )
            .get(userId)) as UserSignature | undefined)
        : ((await db
            .prepare(
              `SELECT user_id, represented_user_id, represented_user_name,
                      signature_path, created_at, updated_at
               FROM user_delegated_signatures
               WHERE user_id = ?`,
            )
            .get(userId)) as UserDelegatedSignature | undefined);
    const signatureDirectory = ensureDatedUploadDirectory(
      "personal-signatures",
      uploadedAt,
      userId,
      signatureType,
    );
    newFilePath = path.join(
      signatureDirectory,
      `${signatureType}-${nanoid(12)}.png`,
    );
    fs.writeFileSync(newFilePath, signatureBuffer);
    const storedPath = toStoredUploadPath(newFilePath);

    if (signatureType === "personal") {
      await db
        .prepare(
          `INSERT INTO user_signatures (
             user_id, signature_path, created_at, updated_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET
             signature_path = EXCLUDED.signature_path,
             updated_at = EXCLUDED.updated_at`,
        )
        .run(userId, storedPath, existing?.created_at || now, now);
    } else {
      await db
        .prepare(
          `INSERT INTO user_delegated_signatures (
             user_id, represented_user_id, represented_user_name,
             signature_path, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET
             represented_user_id = EXCLUDED.represented_user_id,
             represented_user_name = EXCLUDED.represented_user_name,
             signature_path = EXCLUDED.signature_path,
             updated_at = EXCLUDED.updated_at`,
        )
        .run(
          userId,
          access.representedUser!.id,
          access.representedUser!.name,
          storedPath,
          existing?.created_at || now,
          now,
        );
    }

    if (existing?.signature_path && existing.signature_path !== storedPath) {
      removePersonalSignatureFile(existing.signature_path);
    }

    res.json({
      success: true,
      data: {
        signatureType,
        ownerName:
          signatureType === "personal"
            ? access.user.name
            : access.representedUser!.name,
        hasSignature: true,
        updatedAt: now,
      },
      message:
        signatureType === "personal"
          ? existing
            ? "个人电子签名已更新"
            : "个人电子签名已保存"
          : existing
            ? "总经理电子签名已更新"
            : "总经理电子签名已保存",
    });
  } catch (error) {
    if (newFilePath && fs.existsSync(newFilePath)) {
      try {
        fs.unlinkSync(newFilePath);
      } catch (cleanupError) {
        console.error("清理未保存的个人电子签名失败:", cleanupError);
      }
    }
    console.error("保存个人电子签名失败:", error);
    res.status(500).json({
      success: false,
      message: "保存个人电子签名失败",
    });
  }
});

// 当前账号删除自己的个人电子签名
router.delete("/signature", requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "未登录" });
    }
    const signatureType = parsePersonalSignatureType(req.query.type);
    if (!signatureType) {
      return res.status(400).json({
        success: false,
        message: "电子签名类型不正确",
      });
    }
    const access = await getSignatureAccessContext(userId, signatureType);
    if (!access) {
      return res.status(401).json({
        success: false,
        message: "用户不存在或已停用",
      });
    }
    if (
      signatureType === "general_manager" &&
      !["admin", "super_admin"].includes(access.user.role)
    ) {
      return res.status(403).json({
        success: false,
        message: "只有管理员可以删除总经理签名",
      });
    }

    const existing =
      signatureType === "personal"
        ? ((await db
            .prepare(
              `SELECT user_id, signature_path, created_at, updated_at
               FROM user_signatures
               WHERE user_id = ?`,
            )
            .get(userId)) as UserSignature | undefined)
        : ((await db
            .prepare(
              `SELECT user_id, represented_user_id, represented_user_name,
                      signature_path, created_at, updated_at
               FROM user_delegated_signatures
               WHERE user_id = ?`,
            )
            .get(userId)) as UserDelegatedSignature | undefined);

    await db
      .prepare(
        signatureType === "personal"
          ? "DELETE FROM user_signatures WHERE user_id = ?"
          : "DELETE FROM user_delegated_signatures WHERE user_id = ?",
      )
      .run(userId);
    removePersonalSignatureFile(existing?.signature_path);
    res.json({
      success: true,
      message:
        signatureType === "personal"
          ? "个人电子签名已删除"
          : "总经理电子签名已删除",
    });
  } catch (error) {
    console.error("删除个人电子签名失败:", error);
    res.status(500).json({
      success: false,
      message: "删除个人电子签名失败",
    });
  }
});

// 修改密码
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "未登录",
      });
    }

    // 验证输入
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "请输入当前密码和新密码",
      });
    }

    // 验证新密码强度
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      });
    }

    // 获取用户
    const user = (await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId)) as User | undefined;
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "用户不存在",
      });
    }

    // 验证当前密码
    if (!user.password_hash) {
      return res.status(400).json({
        success: false,
        message: "账号未设置密码",
      });
    }

    const isCurrentPasswordValid = await verifyPassword(
      currentPassword,
      user.password_hash,
    );
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "当前密码错误",
      });
    }

    // 更新密码，同时清除强制修改密码标记
    const newPasswordHash = await hashPassword(newPassword);
    const now = new Date().toISOString();
    await db
      .prepare(
        "UPDATE users SET password_hash = ?, force_change_password = false, updated_at = ? WHERE id = ?",
      )
      .run(newPasswordHash, now, userId);

    console.log("✅ 密码修改成功:", { userId, userName: user.name });

    res.json({
      success: true,
      message: "密码修改成功",
    });
  } catch (error) {
    console.error("❌ 修改密码失败:", error);
    res.status(500).json({
      success: false,
      message: "修改密码失败，请稍后重试",
    });
  }
});

// 检查会话
router.get("/session", requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      isLoggedIn: true,
      user: req.session.user,
    },
  });
});

// 获取当前用户信息（用于前端 auth store）
router.get("/user", requireAuth, async (req, res) => {
  console.log("📋 检查用户会话:", {
    hasSession: !!req.session,
    userId: req.session?.userId,
    userName: req.session?.user?.name,
  });

  res.json({
    success: true,
    data: req.session.user,
  });
});

// 登出
router.post("/logout", (req, res) => {
  req.session?.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "登出失败",
      });
    }
    res.json({
      success: true,
      message: "登出成功",
    });
  });
});

export default router;
