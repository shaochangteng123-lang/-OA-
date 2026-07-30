import fs from "fs";
import path from "path";
import { db } from "../db/index.js";
import { getCurrentMonthStartIso } from "../utils/leaveDraft.js";

export class LeaveDraftDeleteError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "LeaveDraftDeleteError";
  }
}

interface LeaveRequestChainRow {
  id: string;
  original_id: string | null;
  user_id: string;
  status: string;
  version: number;
  created_at: string;
}

export interface LeaveDraftDeleteResult {
  deletedRequestCount: number;
  deletedAttachmentCount: number;
  failedFilePaths: string[];
}

function resolveStoredFilePath(storedPath: string): string | null {
  const workspaceRoot = path.resolve(process.cwd());
  const normalizedPath = storedPath.replace(/^[/\\]+/, "");
  const fullPath = path.resolve(workspaceRoot, normalizedPath);

  if (
    fullPath !== workspaceRoot &&
    !fullPath.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    return null;
  }
  return fullPath;
}

async function removeStoredFiles(storedPaths: string[]): Promise<string[]> {
  const failedFilePaths: string[] = [];

  for (const storedPath of storedPaths) {
    const fullPath = resolveStoredFilePath(storedPath);
    if (!fullPath) {
      failedFilePaths.push(storedPath);
      continue;
    }

    try {
      await fs.promises.unlink(fullPath);
    } catch (error: any) {
      if (error?.code !== "ENOENT") failedFilePaths.push(storedPath);
    }
  }

  return failedFilePaths;
}

/**
 * 硬删除草稿及其完整版本链。数据库事务提交后再删除磁盘文件，避免数据库回滚时附件已丢失。
 */
export async function hardDeleteLeaveDraftChain(
  requestId: string,
  ownerUserId?: string,
): Promise<LeaveDraftDeleteResult> {
  const result = await db.transaction(async (client) => {
    const targetResult = await client.query<LeaveRequestChainRow>(
      `SELECT id, original_id, user_id, status, version, created_at
       FROM leave_requests
       WHERE id = $1
       FOR UPDATE`,
      [requestId],
    );
    const target = targetResult.rows[0];

    if (!target || (ownerUserId && target.user_id !== ownerUserId)) {
      throw new LeaveDraftDeleteError("草稿不存在", 404);
    }
    if (target.status !== "draft") {
      throw new LeaveDraftDeleteError("只能删除草稿状态的请假申请", 409);
    }

    const rootResult = await client.query<{ id: string }>(
      `WITH RECURSIVE ancestors AS (
         SELECT id, original_id FROM leave_requests WHERE id = $1
         UNION ALL
         SELECT parent.id, parent.original_id
         FROM leave_requests parent
         INNER JOIN ancestors child ON child.original_id = parent.id
       )
       SELECT id FROM ancestors WHERE original_id IS NULL LIMIT 1`,
      [requestId],
    );
    const rootId = rootResult.rows[0]?.id;
    if (!rootId)
      throw new LeaveDraftDeleteError("请假申请版本链不完整，无法删除", 409);

    const chainResult = await client.query<LeaveRequestChainRow>(
      `WITH RECURSIVE request_chain AS (
         SELECT id, original_id, user_id, status, version, created_at
         FROM leave_requests WHERE id = $1
         UNION ALL
         SELECT child.id, child.original_id, child.user_id, child.status, child.version, child.created_at
         FROM leave_requests child
         INNER JOIN request_chain parent ON child.original_id = parent.id
       )
       SELECT * FROM request_chain
       ORDER BY version DESC, created_at DESC`,
      [rootId],
    );
    const chain = chainResult.rows;
    const parentIds = new Set(
      chain.map((item) => item.original_id).filter(Boolean),
    );
    const leafRequests = chain.filter((item) => !parentIds.has(item.id));

    if (leafRequests.length !== 1 || leafRequests[0]?.id !== requestId) {
      throw new LeaveDraftDeleteError(
        "请假申请存在异常版本分支，请联系管理员处理",
        409,
      );
    }

    const chainIds = chain.map((item) => item.id);
    await client.query(
      `SELECT id FROM leave_requests
       WHERE id = ANY($1::text[])
       ORDER BY version DESC, created_at DESC
       FOR UPDATE`,
      [chainIds],
    );

    const attachmentsResult = await client.query<{ file_path: string }>(
      `SELECT file_path FROM leave_attachments WHERE leave_request_id = ANY($1::text[])`,
      [chainIds],
    );

    await client.query(
      `DELETE FROM leave_approval_logs WHERE leave_request_id = ANY($1::text[])`,
      [chainIds],
    );
    const deletedAttachments = await client.query(
      `DELETE FROM leave_attachments WHERE leave_request_id = ANY($1::text[])`,
      [chainIds],
    );

    for (const request of chain) {
      await client.query(`DELETE FROM leave_requests WHERE id = $1`, [
        request.id,
      ]);
    }

    return {
      deletedRequestCount: chain.length,
      deletedAttachmentCount: deletedAttachments.rowCount ?? 0,
      storedPaths: attachmentsResult.rows.map((item) => item.file_path),
    };
  });

  const failedFilePaths = await removeStoredFiles(result.storedPaths);
  if (failedFilePaths.length > 0) {
    console.error("请假草稿附件物理删除失败:", failedFilePaths);
  }

  return {
    deletedRequestCount: result.deletedRequestCount,
    deletedAttachmentCount: result.deletedAttachmentCount,
    failedFilePaths,
  };
}

export async function cleanupExpiredLeaveDrafts(now = new Date()): Promise<{
  deletedDraftCount: number;
  failedDraftCount: number;
}> {
  const monthStart = getCurrentMonthStartIso(now);
  const drafts = await db
    .prepare(
      `SELECT lr.id
     FROM leave_requests lr
     WHERE lr.status = 'draft'
       AND COALESCE(lr.cancelled_at, lr.updated_at, lr.created_at) < ?
       AND NOT EXISTS (
         SELECT 1 FROM leave_requests child WHERE child.original_id = lr.id
       )
     ORDER BY COALESCE(lr.cancelled_at, lr.updated_at, lr.created_at) ASC`,
    )
    .all<{ id: string }>(monthStart);

  let deletedDraftCount = 0;
  let failedDraftCount = 0;

  for (const draft of drafts) {
    try {
      await hardDeleteLeaveDraftChain(draft.id);
      deletedDraftCount += 1;
    } catch (error) {
      failedDraftCount += 1;
      console.error(`自动删除请假草稿失败（${draft.id}）:`, error);
    }
  }

  return { deletedDraftCount, failedDraftCount };
}

export function setupLeaveDraftCleanup() {
  const runCleanup = async () => {
    try {
      const result = await cleanupExpiredLeaveDrafts();
      if (result.deletedDraftCount > 0 || result.failedDraftCount > 0) {
        console.log(
          `请假草稿月底清理完成：删除 ${result.deletedDraftCount} 条，失败 ${result.failedDraftCount} 条`,
        );
      }
    } catch (error) {
      console.error("请假草稿月底清理失败:", error);
    }
  };

  void runCleanup();

  const now = new Date();
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    5,
    0,
  );
  let delay = target.getTime() - now.getTime();
  if (delay < 0) delay += 24 * 60 * 60 * 1000;

  setTimeout(() => {
    void runCleanup();
    setInterval(
      () => {
        void runCleanup();
      },
      24 * 60 * 60 * 1000,
    );
  }, delay);

  console.log("请假草稿月底自动清理任务已启动（每月 1 日 00:05 清理上月草稿）");
}
