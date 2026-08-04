/**
 * 认证路由
 * 账号密码登录系统
 */

import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/index.js";
import { nanoid } from "nanoid";
import type { User, UserSignature } from "../types/database.js";
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

type PersonalSignatureType = "personal";

interface SignatureAccessContext {
  user: Pick<User, "id" | "name" | "role">;
}

class SignatureOperationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "SignatureOperationError";
  }
}

function parsePersonalSignatureType(
  value: unknown,
): PersonalSignatureType | null {
  if (value === undefined || value === "" || value === "personal") {
    return "personal";
  }
  return null;
}

async function getSignatureAccessContext(
  userId: string,
  _signatureType: PersonalSignatureType,
): Promise<SignatureAccessContext | null> {
  const user = (await db
    .prepare(
      `SELECT id, name, role
       FROM users
       WHERE id = ? AND status = 'active'`,
    )
    .get(userId)) as Pick<User, "id" | "name" | "role"> | undefined;
  if (!user) return null;

  return { user };
}

function resolvePersonalSignaturePath(storedPath: string) {
  if (!validateFilePath(storedPath)) {
    throw new Error("个人电子签名文件路径不正确");
  }
  return path.resolve(process.cwd(), storedPath.replace(/^[/\\]+/, ""));
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
    const signature = (await db
      .prepare(
        `SELECT user_id, signature_path, created_at, updated_at
         FROM user_signatures
         WHERE user_id = ?`,
      )
      .get(userId)) as UserSignature | undefined;

    const hasSignature = personalSignatureFileExists(signature?.signature_path);
    res.json({
      success: true,
      data: {
        signatureType,
        ownerName: access.user.name,
        locked: Boolean(signature),
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
    const signature = (await db
      .prepare(
        `SELECT user_id, signature_path, created_at, updated_at
         FROM user_signatures
         WHERE user_id = ?`,
      )
      .get(userId)) as UserSignature | undefined;
    if (!signature) {
      return res.status(404).json({
        success: false,
        message: "尚未保存个人电子签名",
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

// 当前账号首次确认自己的个人电子签名
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
    await db.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `personal-signature-${userId}`,
      ]);
      const existing = await client.query<UserSignature>(
        `SELECT user_id, signature_path, created_at, updated_at
         FROM user_signatures
         WHERE user_id = $1`,
        [userId],
      );
      if (existing.rows[0]) {
        throw new SignatureOperationError(
          "个人电子签名已确认并锁定，不能重复上传",
          409,
        );
      }

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

      await client.query(
        `INSERT INTO user_signatures (
           user_id, signature_path, created_at, updated_at
         ) VALUES ($1, $2, $3, $4)`,
        [userId, storedPath, now, now],
      );
    });

    res.json({
      success: true,
      data: {
        signatureType,
        ownerName: access.user.name,
        locked: true,
        hasSignature: true,
        updatedAt: now,
      },
      message: "个人电子签名已确认并锁定",
    });
  } catch (error) {
    if (newFilePath && fs.existsSync(newFilePath)) {
      try {
        fs.unlinkSync(newFilePath);
      } catch (cleanupError) {
        console.error("清理未保存的个人电子签名失败:", cleanupError);
      }
    }
    if (error instanceof SignatureOperationError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error("保存个人电子签名失败:", error);
    return res.status(500).json({
      success: false,
      message: "保存个人电子签名失败",
    });
  }
});

// 个人电子签名确认后不可删除
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
    if (!(await getSignatureAccessContext(userId, signatureType))) {
      return res.status(401).json({
        success: false,
        message: "用户不存在或已停用",
      });
    }
    return res.status(409).json({
      success: false,
      message: "个人电子签名确认后已锁定，不能删除",
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
