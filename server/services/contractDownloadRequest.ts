import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "canvas";
import { nanoid } from "nanoid";
import { PDFDocument } from "pdf-lib";
import type { PoolClient } from "pg";
import * as XLSX from "xlsx";
import { db, pool } from "../db/index.js";
import type {
  ContractDownloadDecision,
  ContractDownloadPendingCounts,
  ContractDownloadRequestApi,
  ContractDownloadRequestAuditEntry,
  ContractDownloadRequestChainEntry,
  ContractDownloadRequestCreateInput,
  ContractDownloadRequestFileSnapshot,
  ContractDownloadRequestListScope,
  ContractDownloadRequestStatus,
  ContractDownloadWorkflowNode,
} from "../types/contract-download-request.js";
import { normalizeSignaturePng } from "../utils/electronic-signature.js";
import { validateFilePath } from "../utils/file-validation.js";
import {
  ensureDatedUploadDirectory,
  toStoredUploadPath,
} from "../utils/upload-date.js";

export const CONTRACT_DOWNLOAD_ADMIN_ROLES = [
  "admin",
  "super_admin",
  "chairman",
] as const;

const MAX_ADMIN_HISTORY_EXPORT_ROWS = 5_000;
const CONTRACT_DOWNLOAD_EXPORT_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type ContractDownloadAdminRole = (typeof CONTRACT_DOWNLOAD_ADMIN_ROLES)[number];

export interface ContractDownloadActor {
  id: string;
  role: string;
}

interface ActorSnapshot {
  id: string;
  name: string;
  role: string;
  position: string;
}

interface ContractSnapshotRow {
  id: string;
  contract_no: string | null;
  business_contract_no: string | null;
  title: string | null;
  project_name: string | null;
  area: string;
  root_id: string | null;
  root_area: string | null;
  status: string;
}

interface ContractFileRow {
  id: string;
  contract_id: string;
  file_type: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  file_hash: string;
  created_at: string;
}

/** 子协议上传当前盖章版后，才作为主合同的可下载集中附件。 */
function downloadableContractOwnerPredicate(ownerAlias: string): string {
  return `(
    ${ownerAlias}.relation_type = 'main'
    OR EXISTS (
      SELECT 1 FROM contract_files sealed_file
      WHERE sealed_file.contract_id = ${ownerAlias}.id
        AND sealed_file.file_type = 'sealed_contract'
        AND sealed_file.is_current = TRUE
    )
  )`;
}

interface DownloadRequestRow {
  id: string;
  request_no: string;
  contract_id: string;
  applicant_id: string;
  applicant_name_snapshot: string;
  applicant_position_snapshot: string;
  contract_no_snapshot: string;
  contract_name_snapshot: string;
  contract_area_snapshot: string;
  contract_status_snapshot: string;
  purpose: string;
  status: ContractDownloadRequestStatus;
  chain_id: string;
  previous_request_id: string | null;
  attempt_no: number;
  target_approver_id: string;
  target_approver_name_snapshot: string;
  target_approver_position_snapshot: string;
  target_executor_id: string;
  target_executor_name_snapshot: string;
  target_executor_position_snapshot: string;
  application_file_path: string;
  application_file_name: string;
  application_file_hash: string;
  applicant_signature_snapshot_path: string;
  applicant_signature_snapshot_hash: string;
  approved_application_file_path: string | null;
  approved_application_file_hash: string | null;
  approver_id: string | null;
  approver_name_snapshot: string | null;
  approver_position_snapshot: string | null;
  approver_signature_snapshot_path: string | null;
  approver_signature_snapshot_hash: string | null;
  decision_comment: string | null;
  decided_at: string | null;
  executor_id: string | null;
  executor_name_snapshot: string | null;
  executor_position_snapshot: string | null;
  processing_note: string | null;
  processing_started_at: string | null;
  completed_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  created_at: string;
  updated_at: string;
  applicant_seen_at: string;
  version: number;
}

interface DownloadRequestFileRow {
  id: string;
  request_id: string;
  contract_file_id: string;
  file_type_snapshot: string;
  file_name_snapshot: string;
  file_path_snapshot: string;
  file_hash_snapshot: string;
  file_size_snapshot: number;
  mime_type_snapshot: string;
  downloaded_by: string | null;
  downloaded_at: string | null;
  created_at: string;
}

interface DownloadRequestAuditRow {
  id: string;
  action: ContractDownloadRequestAuditEntry["action"];
  actor_id: string;
  actor_name_snapshot: string;
  actor_position_snapshot: string;
  from_status: string | null;
  to_status: string;
  comment: string | null;
  metadata_json: unknown;
  created_at: string;
}

interface DownloadRequestChainAuditRow extends DownloadRequestAuditRow {
  request_id: string;
  request_no: string;
  attempt_no: number;
}

interface ApplicationArtifact {
  pdfPath: string;
  pdfStoredPath: string;
  pdfFileName: string;
  pdfHash: string;
  signaturePath: string;
  signatureStoredPath: string;
  signatureHash: string;
}

export class ContractDownloadRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = "CONTRACT_DOWNLOAD_REQUEST_INVALID",
  ) {
    super(message);
    this.name = "ContractDownloadRequestError";
  }
}

function uniqueViolationConstraint(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const databaseError = error as { code?: unknown; constraint?: unknown };
  if (databaseError.code !== "23505") return null;
  return typeof databaseError.constraint === "string"
    ? databaseError.constraint
    : "";
}

const PAGE_WIDTH = 595.3;
const PAGE_HEIGHT = 841.9;
const RENDER_SCALE = 2;
const FONT_FAMILY =
  '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';

const FILE_TYPE_LABELS: Record<string, string> = {
  draft_contract: "草拟合同",
  seal_application: "用印申请单",
  triplicate: "三联单",
  payment_request: "请款单",
  sealed_contract: "盖章合同",
  invoice: "发票",
  receipt: "回款回单",
  payment: "付款回单",
  termination: "终止协议",
  other: "其他附件",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草拟中",
  approving: "审批中",
  pending_seal: "待盖章",
  effective: "生效中",
  executing: "执行中",
  completed: "已完成",
  rejected: "已驳回",
  terminated: "已终止",
};

const BASE_APPLICATION_FILE_TYPES = new Set([
  "draft_contract",
  "seal_application",
]);
const PRE_SEAL_FILE_TYPES = new Set([
  ...BASE_APPLICATION_FILE_TYPES,
  "triplicate",
  "payment_request",
]);
const FULL_LIFECYCLE_FILE_TYPES = new Set([
  ...PRE_SEAL_FILE_TYPES,
  "sealed_contract",
  "invoice",
  "receipt",
  "payment",
  "termination",
  "other",
]);

/**
 * 按合同当前状态统一限定员工可以申请的附件类型。创建接口和可选附件接口
 * 必须共用此规则，避免员工伪造旧附件编号绕过页面选择范围。
 */
export function eligibleContractDownloadFileTypes(status: string): Set<string> {
  if (status === "draft" || status === "approving" || status === "rejected") {
    return BASE_APPLICATION_FILE_TYPES;
  }
  if (status === "pending_seal") return PRE_SEAL_FILE_TYPES;
  return FULL_LIFECYCLE_FILE_TYPES;
}

function requiredText(value: unknown, label: string, maximum: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new ContractDownloadRequestError(`${label}不能为空`);
  }
  if (normalized.length > maximum) {
    throw new ContractDownloadRequestError(
      `${label}不能超过 ${maximum} 个字符`,
    );
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maximum: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length > maximum) {
    throw new ContractDownloadRequestError(
      `${label}不能超过 ${maximum} 个字符`,
    );
  }
  return normalized;
}

export function isContractDownloadAdminRole(
  role: unknown,
): role is ContractDownloadAdminRole {
  return (
    typeof role === "string" &&
    (CONTRACT_DOWNLOAD_ADMIN_ROLES as readonly string[]).includes(role)
  );
}

function rolePosition(role: string, actualPosition: string | null): string {
  if (role === "general_manager") return "总经理";
  if (isContractDownloadAdminRole(role)) return "管理员";
  return actualPosition?.trim() || "员工";
}

function personLabel(position: string, name: string): string {
  return `${position} ${name}`;
}

async function actorSnapshot(
  client: Pick<PoolClient, "query">,
  actorId: string,
  lock = false,
): Promise<ActorSnapshot> {
  const result = await client.query<{
    id: string;
    name: string;
    role: string;
    position: string | null;
  }>(
    `SELECT u.id, u.name, u.role, COALESCE(ep.position, u.position) AS position
     FROM users u
     LEFT JOIN employee_profiles ep ON ep.user_id = u.id
     WHERE u.id = $1 AND u.status = 'active'
     LIMIT 1${lock ? " FOR SHARE OF u" : ""}`,
    [actorId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ContractDownloadRequestError(
      "当前账号不存在或已停用",
      401,
      "CONTRACT_DOWNLOAD_ACTOR_UNAVAILABLE",
    );
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    position: rolePosition(row.role, row.position),
  };
}

async function uniqueGeneralManager(
  client: Pick<PoolClient, "query">,
): Promise<ActorSnapshot> {
  const result = await client.query<{
    id: string;
    name: string;
    role: string;
  }>(
    `SELECT id, name, role
     FROM users
     WHERE role = 'general_manager' AND status = 'active'
     ORDER BY created_at, id
     FOR SHARE`,
  );
  if (result.rows.length !== 1) {
    throw new ContractDownloadRequestError(
      "系统必须且只能配置一个启用中的总经理账号，暂时无法提交下载申请",
      409,
      "UNIQUE_GENERAL_MANAGER_REQUIRED",
    );
  }
  const row = result.rows[0];
  return { id: row.id, name: row.name, role: row.role, position: "总经理" };
}

async function targetAdministrator(
  client: Pick<PoolClient, "query">,
): Promise<ActorSnapshot> {
  const result = await client.query<{
    id: string;
    name: string;
    role: string;
  }>(
    `SELECT id, name, role
     FROM users
     WHERE status = 'active' AND role = 'admin'
     ORDER BY created_at, id
     FOR SHARE`,
  );
  if (result.rows.length !== 1) {
    throw new ContractDownloadRequestError(
      "系统必须且只能配置一个启用中的管理员账号，暂时无法提交下载申请",
      409,
      "UNIQUE_CONTRACT_DOWNLOAD_ADMIN_REQUIRED",
    );
  }
  const row = result.rows[0];
  return { id: row.id, name: row.name, role: row.role, position: "管理员" };
}

function absoluteUploadPath(storedPath: string, label = "文件"): string {
  if (!validateFilePath(storedPath)) {
    throw new ContractDownloadRequestError(
      `${label}路径不正确`,
      409,
      "CONTRACT_DOWNLOAD_FILE_PATH_INVALID",
    );
  }
  const absolutePath = path.resolve(
    process.cwd(),
    storedPath.replace(/^[/\\]+/, ""),
  );
  try {
    if (!fs.statSync(absolutePath).isFile()) throw new Error("not-file");
  } catch {
    throw new ContractDownloadRequestError(
      `${label}不存在，请联系管理员处理`,
      409,
      "CONTRACT_DOWNLOAD_FILE_MISSING",
    );
  }
  return absolutePath;
}

function absoluteSnapshotFilePath(
  storedPath: string,
  expectedHash: string,
  label: string,
): string {
  const absolutePath = absoluteUploadPath(storedPath, label);
  const actualHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(absolutePath))
    .digest("hex");
  if (actualHash !== expectedHash) {
    throw new ContractDownloadRequestError(
      `${label}内容已发生变化，已阻止下载，请联系管理员核查`,
      409,
      "CONTRACT_DOWNLOAD_SNAPSHOT_HASH_MISMATCH",
    );
  }
  return absolutePath;
}

async function signatureForActor(
  client: Pick<PoolClient, "query">,
  actor: ActorSnapshot,
): Promise<Buffer> {
  const result = await client.query<{ signature_path: string }>(
    `SELECT signature_path
     FROM user_signatures
     WHERE user_id = $1
     FOR SHARE`,
    [actor.id],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ContractDownloadRequestError(
      "请先在个人设置上传并锁定本人电子签名",
      409,
      "PERSONAL_SIGNATURE_REQUIRED",
    );
  }
  const signaturePath = absoluteUploadPath(row.signature_path, "个人电子签名");
  return normalizeSignaturePng(fs.readFileSync(signaturePath));
}

function safeFileSegment(value: string): string {
  return Array.from(value.replace(/[\\/:*?"<>|]/g, "-"))
    .map((character) =>
      (character.codePointAt(0) || 0) < 32 ? "-" : character,
    )
    .join("")
    .slice(0, 100);
}

function displayDateTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

type CanvasContext = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

function drawWrappedText(
  context: CanvasContext,
  text: string,
  x: number,
  y: number,
  width: number,
  options: {
    fontSize?: number;
    color?: string;
    weight?: "normal" | "bold";
    lineHeight?: number;
    maxLines?: number;
  } = {},
): void {
  const fontSize = options.fontSize || 10;
  const lineHeight = options.lineHeight || fontSize * 1.45;
  const maxLines = options.maxLines || 5;
  context.save();
  context.font = `${options.weight || "normal"} ${fontSize * RENDER_SCALE}px ${FONT_FAMILY}`;
  context.fillStyle = options.color || "#263238";
  context.textBaseline = "top";
  const characters = Array.from(text || "—");
  const lines: string[] = [];
  let line = "";
  for (const character of characters) {
    const next = `${line}${character}`;
    if (line && context.measureText(next).width > width * RENDER_SCALE) {
      lines.push(line);
      line = character;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
    let rendered = lines[index];
    if (index === maxLines - 1 && lines.length > maxLines) rendered += "…";
    context.fillText(
      rendered,
      x * RENDER_SCALE,
      (y + index * lineHeight) * RENDER_SCALE,
    );
  }
  context.restore();
}

function wrappedTextLines(
  context: CanvasContext,
  text: string,
  width: number,
  fontSize: number,
): string[] {
  context.save();
  context.font = `normal ${fontSize * RENDER_SCALE}px ${FONT_FAMILY}`;
  const result: string[] = [];
  for (const paragraph of (text || "—").split(/\r?\n/)) {
    let line = "";
    for (const character of Array.from(paragraph || " ")) {
      const next = `${line}${character}`;
      if (line && context.measureText(next).width > width * RENDER_SCALE) {
        result.push(line);
        line = character;
      } else {
        line = next;
      }
    }
    if (line) result.push(line);
  }
  context.restore();
  return result;
}

function renderApplicationDetailPages(input: {
  requestNo: string;
  purpose: string;
  files: ContractFileRow[];
  decisionComment?: string;
}): Array<ReturnType<typeof createCanvas>> {
  const pages: Array<ReturnType<typeof createCanvas>> = [];
  let canvas = createCanvas(1, 1);
  let context = canvas.getContext("2d");
  let y = 0;

  const beginPage = () => {
    canvas = createCanvas(
      Math.round(PAGE_WIDTH * RENDER_SCALE),
      Math.round(PAGE_HEIGHT * RENDER_SCALE),
    );
    context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#0f766e";
    context.fillRect(0, 0, canvas.width, 72 * RENDER_SCALE);
    drawWrappedText(context, "合同文件下载申请明细", 40, 20, 350, {
      fontSize: 18,
      color: "#ffffff",
      weight: "bold",
      maxLines: 1,
    });
    drawWrappedText(context, input.requestNo, 395, 28, 155, {
      fontSize: 8,
      color: "#d5f5f0",
      maxLines: 1,
    });
    pages.push(canvas);
    y = 98;
  };

  const ensureSpace = (height: number) => {
    if (y + height > 800) beginPage();
  };
  const heading = (value: string) => {
    ensureSpace(34);
    drawWrappedText(context, value, 42, y, 510, {
      fontSize: 12,
      color: "#134e4a",
      weight: "bold",
      maxLines: 1,
    });
    y += 31;
  };
  const lines = (values: string[], fontSize = 9, lineHeight = 14) => {
    for (const value of values) {
      ensureSpace(lineHeight + 2);
      drawWrappedText(context, value, 52, y, 495, {
        fontSize,
        lineHeight,
        maxLines: 1,
      });
      y += lineHeight;
    }
  };

  beginPage();
  heading("下载用途");
  lines(wrappedTextLines(context, input.purpose, 495, 9));
  y += 20;
  heading(`申请下载的具体附件（共 ${input.files.length} 份）`);
  input.files.forEach((file, index) => {
    const content = `${index + 1}. ${FILE_TYPE_LABELS[file.file_type] || file.file_type}：${file.file_name}`;
    lines(wrappedTextLines(context, content, 495, 9));
    y += 7;
  });
  if (input.decisionComment) {
    y += 20;
    heading("总经理审批意见");
    lines(wrappedTextLines(context, input.decisionComment, 495, 9));
  }
  return pages;
}

function drawLine(
  context: CanvasContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  context.save();
  context.strokeStyle = "#d7e4e2";
  context.lineWidth = RENDER_SCALE;
  context.beginPath();
  context.moveTo(x1 * RENDER_SCALE, y1 * RENDER_SCALE);
  context.lineTo(x2 * RENDER_SCALE, y2 * RENDER_SCALE);
  context.stroke();
  context.restore();
}

async function drawSignature(
  context: CanvasContext,
  signature: Buffer,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  const image = await loadImage(signature);
  const scale = Math.min(
    (width * RENDER_SCALE) / image.width,
    (height * RENDER_SCALE) / image.height,
    1,
  );
  context.drawImage(
    image,
    x * RENDER_SCALE,
    y * RENDER_SCALE,
    image.width * scale,
    image.height * scale,
  );
}

async function renderApplicationPdf(input: {
  outputPath: string;
  requestNo: string;
  attemptNo: number;
  previousRequestNo?: string;
  contract: ContractSnapshotRow;
  contractNo: string;
  contractName: string;
  purpose: string;
  files: ContractFileRow[];
  applicant: ActorSnapshot;
  applicantSignature: Buffer;
  submittedAt: Date;
  approver: ActorSnapshot;
  approverSignature?: Buffer;
  decision?: ContractDownloadDecision;
  decisionComment?: string;
  decidedAt?: Date;
}): Promise<void> {
  const canvas = createCanvas(
    Math.round(PAGE_WIDTH * RENDER_SCALE),
    Math.round(PAGE_HEIGHT * RENDER_SCALE),
  );
  const context = canvas.getContext("2d");
  context.fillStyle = "#f7faf9";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0f766e";
  context.fillRect(0, 0, canvas.width, 94 * RENDER_SCALE);
  drawWrappedText(context, "合同文件下载申请单", 38, 25, 510, {
    fontSize: 23,
    color: "#ffffff",
    weight: "bold",
    maxLines: 1,
  });
  drawWrappedText(context, input.requestNo, 40, 65, 500, {
    fontSize: 9,
    color: "#d5f5f0",
    maxLines: 1,
  });

  const rows: Array<[string, string]> = [
    ["申请人", personLabel(input.applicant.position, input.applicant.name)],
    ["申请时间", displayDateTime(input.submittedAt)],
    [
      "提交批次",
      input.attemptNo > 1 ? `第 ${input.attemptNo} 次提交` : "首次提交",
    ],
    ...(input.previousRequestNo
      ? ([["原申请编号", input.previousRequestNo]] as Array<[string, string]>)
      : []),
    ["合同编号", input.contractNo],
    ["合同名称", input.contractName],
    ["行政区域", input.contract.area],
    ["合同状态", STATUS_LABELS[input.contract.status] || input.contract.status],
  ];
  let y = 116;
  for (const [label, value] of rows) {
    drawWrappedText(context, label, 42, y, 72, {
      fontSize: 9,
      color: "#607d8b",
      weight: "bold",
      maxLines: 1,
    });
    drawWrappedText(context, value, 120, y, 430, {
      fontSize: 10,
      maxLines: 2,
    });
    y += label === "合同名称" ? 40 : 28;
    drawLine(context, 42, y - 7, 553, y - 7);
  }

  drawWrappedText(context, "申请内容", 42, y + 3, 200, {
    fontSize: 12,
    color: "#134e4a",
    weight: "bold",
    maxLines: 1,
  });
  drawWrappedText(
    context,
    `申请下载 ${input.files.length} 份具体附件；完整附件清单和下载用途见后续明细页。`,
    52,
    y + 36,
    495,
    {
      fontSize: 10,
      lineHeight: 16,
      maxLines: 3,
    },
  );
  drawWrappedText(context, `用途摘要：${input.purpose}`, 52, y + 93, 495, {
    fontSize: 9,
    lineHeight: 14,
    maxLines: 5,
  });

  const signatureTop = 668;
  context.fillStyle = "#e9f6f3";
  context.fillRect(
    42 * RENDER_SCALE,
    signatureTop * RENDER_SCALE,
    244 * RENDER_SCALE,
    132 * RENDER_SCALE,
  );
  context.fillStyle = "#ffffff";
  context.fillRect(
    309 * RENDER_SCALE,
    signatureTop * RENDER_SCALE,
    244 * RENDER_SCALE,
    132 * RENDER_SCALE,
  );
  drawWrappedText(context, "申请人电子签名", 54, 680, 150, {
    fontSize: 10,
    color: "#0f766e",
    weight: "bold",
    maxLines: 1,
  });
  drawWrappedText(
    context,
    personLabel(input.applicant.position, input.applicant.name),
    54,
    710,
    88,
    { fontSize: 9, maxLines: 2 },
  );
  await drawSignature(context, input.applicantSignature, 148, 704, 120, 45);
  drawWrappedText(context, displayDateTime(input.submittedAt), 54, 774, 215, {
    fontSize: 8,
    color: "#52716d",
    maxLines: 1,
  });

  drawWrappedText(context, "总经理审批", 321, 680, 120, {
    fontSize: 10,
    color: "#0f766e",
    weight: "bold",
    maxLines: 1,
  });
  if (input.approverSignature && input.decision && input.decidedAt) {
    drawWrappedText(
      context,
      `${input.decision === "approve" ? "批准" : "驳回"} · ${personLabel(input.approver.position, input.approver.name)}`,
      321,
      710,
      96,
      { fontSize: 9, maxLines: 2 },
    );
    await drawSignature(context, input.approverSignature, 421, 704, 115, 45);
    drawWrappedText(
      context,
      input.decisionComment || "无审批意见",
      321,
      757,
      215,
      { fontSize: 8, color: "#52716d", maxLines: 1 },
    );
    drawWrappedText(context, displayDateTime(input.decidedAt), 321, 774, 215, {
      fontSize: 8,
      color: "#52716d",
      maxLines: 1,
    });
  } else {
    drawWrappedText(
      context,
      `下一步：${personLabel(input.approver.position, input.approver.name)}审批`,
      321,
      724,
      215,
      { fontSize: 10, color: "#52716d", maxLines: 2 },
    );
  }

  const document = await PDFDocument.create();
  document.setTitle("合同文件下载申请单");
  document.setSubject("yulilog-contract-download-request-v1");
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const image = await document.embedPng(canvas.toBuffer("image/png"));
  page.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
  for (const detailCanvas of renderApplicationDetailPages({
    requestNo: input.requestNo,
    purpose: input.purpose,
    files: input.files,
    decisionComment: input.decisionComment,
  })) {
    const detailPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const detailImage = await document.embedPng(
      detailCanvas.toBuffer("image/png"),
    );
    detailPage.drawImage(detailImage, {
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
    });
  }
  fs.writeFileSync(input.outputPath, await document.save(), { flag: "wx" });
}

async function createApplicationArtifact(input: {
  client: Pick<PoolClient, "query">;
  requestId: string;
  requestNo: string;
  attemptNo: number;
  previousRequestNo?: string;
  contract: ContractSnapshotRow;
  contractNo: string;
  contractName: string;
  purpose: string;
  files: ContractFileRow[];
  applicant: ActorSnapshot;
  submittedAt: Date;
  approver: ActorSnapshot;
  approverDecision?: {
    decision: ContractDownloadDecision;
    comment: string;
    decidedAt: Date;
  };
  applicantSignatureOverride?: Buffer;
}): Promise<ApplicationArtifact> {
  const applicantSignature =
    input.applicantSignatureOverride ||
    (await signatureForActor(input.client, input.applicant));
  const approverSignature = input.approverDecision
    ? await signatureForActor(input.client, input.approver)
    : undefined;
  const directory = ensureDatedUploadDirectory(
    "contract-download-requests",
    input.submittedAt,
    input.requestId,
  );
  const suffix = crypto.randomBytes(8).toString("hex");
  const prefix = input.approverDecision ? "approved" : "submitted";
  const signaturePath = path.join(
    directory,
    `${prefix}-signature-${suffix}.png`,
  );
  const pdfPath = path.join(directory, `${prefix}-application-${suffix}.pdf`);
  try {
    fs.writeFileSync(signaturePath, approverSignature || applicantSignature, {
      flag: "wx",
    });
    await renderApplicationPdf({
      outputPath: pdfPath,
      requestNo: input.requestNo,
      attemptNo: input.attemptNo,
      previousRequestNo: input.previousRequestNo,
      contract: input.contract,
      contractNo: input.contractNo,
      contractName: input.contractName,
      purpose: input.purpose,
      files: input.files,
      applicant: input.applicant,
      applicantSignature,
      submittedAt: input.submittedAt,
      approver: input.approver,
      approverSignature,
      decision: input.approverDecision?.decision,
      decisionComment: input.approverDecision?.comment,
      decidedAt: input.approverDecision?.decidedAt,
    });
    const pdf = fs.readFileSync(pdfPath);
    return {
      pdfPath,
      pdfStoredPath: toStoredUploadPath(pdfPath),
      pdfFileName: `${safeFileSegment(input.requestNo)}-合同文件下载申请单.pdf`,
      pdfHash: crypto.createHash("sha256").update(pdf).digest("hex"),
      signaturePath,
      signatureStoredPath: toStoredUploadPath(signaturePath),
      signatureHash: crypto
        .createHash("sha256")
        .update(fs.readFileSync(signaturePath))
        .digest("hex"),
    };
  } catch (error) {
    cleanupArtifact({
      pdfPath,
      signaturePath,
      pdfStoredPath: "",
      pdfFileName: "",
      pdfHash: "",
      signatureStoredPath: "",
      signatureHash: "",
    });
    throw error;
  }
}

function cleanupArtifact(artifact: ApplicationArtifact | null): void {
  if (!artifact) return;
  for (const filePath of [artifact.pdfPath, artifact.signaturePath]) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // 文件清理失败不能覆盖原始业务异常。
    }
  }
}

async function loadContract(
  client: Pick<PoolClient, "query">,
  contractId: string,
  lock = false,
): Promise<ContractSnapshotRow> {
  const result = await client.query<ContractSnapshotRow>(
    `SELECT contract.id, contract.contract_no, contract.business_contract_no,
            contract.title, contract.project_name, contract.area,
            root.id AS root_id, root.area AS root_area, contract.status
     FROM contracts contract
     JOIN contracts root
       ON root.id = COALESCE(contract.root_contract_id, contract.id)
      AND root.is_deleted = FALSE
     WHERE contract.id = $1 AND contract.is_deleted = FALSE
     LIMIT 1${lock ? " FOR SHARE OF contract, root" : ""}`,
    [contractId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ContractDownloadRequestError(
      "合同不存在",
      404,
      "CONTRACT_NOT_FOUND",
    );
  }
  return row;
}

function assertEmployeeContractAccess(contract: ContractSnapshotRow): void {
  if (
    !contract.root_id ||
    contract.area === "全部" ||
    contract.root_area === "全部"
  ) {
    throw new ContractDownloadRequestError(
      "普通员工不能查看或申请下载行政区域为“全部”的合同",
      403,
      "EMPLOYEE_GLOBAL_CONTRACT_FORBIDDEN",
    );
  }
}

async function loadSelectedFiles(
  client: Pick<PoolClient, "query">,
  rootContractId: string,
  fileIds: string[],
  contractStatus: string,
  lock = false,
): Promise<ContractFileRow[]> {
  const result = await client.query<ContractFileRow>(
    `SELECT file.id, file.contract_id, file.file_type, file.file_name,
            file.file_path, file.file_size, file.mime_type, file.file_hash,
            file.created_at
     FROM contract_files file
     JOIN contracts owner ON owner.id = file.contract_id
      AND owner.is_deleted = FALSE
     WHERE COALESCE(owner.root_contract_id, owner.id) = $1
       AND owner.relation_type IN ('main', 'supplement', 'termination')
       AND ${downloadableContractOwnerPredicate("owner")}
       AND owner.area <> '全部'
       AND file.id = ANY($2::text[])
       AND file.is_current = TRUE
     ORDER BY CASE owner.relation_type
          WHEN 'main' THEN 0
          WHEN 'supplement' THEN 1
          WHEN 'termination' THEN 2
          ELSE 3
        END,
        owner.supplement_sequence ASC NULLS LAST,
        file.created_at, file.id${lock ? " FOR SHARE OF file, owner" : ""}`,
    [rootContractId, fileIds],
  );
  if (result.rows.length !== fileIds.length) {
    throw new ContractDownloadRequestError(
      "所选附件不存在、已失效或不属于当前合同",
      409,
      "CONTRACT_DOWNLOAD_FILE_SELECTION_INVALID",
    );
  }
  const eligibleTypes = eligibleContractDownloadFileTypes(contractStatus);
  for (const file of result.rows) {
    if (!eligibleTypes.has(file.file_type)) {
      throw new ContractDownloadRequestError(
        `合同当前状态不能申请下载附件“${file.file_name}”`,
        409,
        "CONTRACT_DOWNLOAD_FILE_NOT_ELIGIBLE",
      );
    }
    if (!/^[0-9a-f]{64}$/.test(file.file_hash)) {
      throw new ContractDownloadRequestError(
        `附件“${file.file_name}”缺少可靠文件摘要，暂时不能申请下载`,
        409,
        "CONTRACT_DOWNLOAD_FILE_HASH_INVALID",
      );
    }
    absoluteUploadPath(file.file_path, file.file_name);
  }
  return result.rows;
}

function normalizeCreateInput(
  input: ContractDownloadRequestCreateInput,
): ContractDownloadRequestCreateInput {
  const contractId = requiredText(input?.contractId, "合同编号", 100);
  const content = normalizeRequestContent(input?.purpose, input?.fileIds);
  return { contractId, ...content };
}

function normalizeRequestContent(
  rawPurpose: unknown,
  rawFileIds: unknown,
): { purpose: string; fileIds: string[] } {
  const purpose = requiredText(rawPurpose, "下载用途", 1000);
  if (!Array.isArray(rawFileIds)) {
    throw new ContractDownloadRequestError("请选择需要下载的合同附件");
  }
  const fileIds = Array.from(
    new Set(
      rawFileIds.map((value) => requiredText(value, "合同附件编号", 100)),
    ),
  );
  if (fileIds.length < 1 || fileIds.length > 20) {
    throw new ContractDownloadRequestError("一次申请须选择 1 至 20 个合同附件");
  }
  return { purpose, fileIds };
}

function contractDisplay(contract: ContractSnapshotRow): {
  contractNo: string;
  contractName: string;
} {
  return {
    contractNo:
      contract.business_contract_no || contract.contract_no || "待识别编号",
    contractName: contract.title || contract.project_name || "未命名合同",
  };
}

function requestNumber(sequence: number, now: Date): string {
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replace(/\//g, "");
  return `HTXZ-${date}-${String(sequence).padStart(6, "0")}`;
}

export async function getAvailableContractDownloadFiles(
  actor: ContractDownloadActor,
  contractId: string,
): Promise<{
  contract: {
    id: string;
    contractNo: string;
    contractName: string;
    area: string;
    status: string;
  };
  files: Array<{
    id: string;
    fileType: string;
    fileTypeLabel: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    createdAt: string;
  }>;
}> {
  if (actor.role !== "user") {
    throw new ContractDownloadRequestError(
      "仅普通员工通过此入口选择合同附件并申请下载",
      403,
      "CONTRACT_DOWNLOAD_EMPLOYEE_ONLY",
    );
  }
  const contract = await loadContract(pool, contractId);
  assertEmployeeContractAccess(contract);
  const result = await pool.query<ContractFileRow>(
    `SELECT file.id, file.contract_id, file.file_type, file.file_name,
            file.file_path, file.file_size, file.mime_type, file.file_hash,
            file.created_at
     FROM contract_files file
     JOIN contracts owner ON owner.id = file.contract_id
      AND owner.is_deleted = FALSE
     WHERE COALESCE(owner.root_contract_id, owner.id) = $1
       AND owner.relation_type IN ('main', 'supplement', 'termination')
       AND ${downloadableContractOwnerPredicate("owner")}
       AND owner.area <> '全部'
       AND file.is_current = TRUE
     ORDER BY CASE owner.relation_type
          WHEN 'main' THEN 0
          WHEN 'supplement' THEN 1
          WHEN 'termination' THEN 2
          ELSE 3
        END,
        owner.supplement_sequence ASC NULLS LAST,
        file.created_at, file.id`,
    [contract.root_id || contract.id],
  );
  const display = contractDisplay(contract);
  const eligibleTypes = eligibleContractDownloadFileTypes(contract.status);
  return {
    contract: {
      id: contract.id,
      contractNo: display.contractNo,
      contractName: display.contractName,
      area: contract.area,
      status: contract.status,
    },
    files: result.rows
      .filter(
        (file) =>
          eligibleTypes.has(file.file_type) &&
          /^[0-9a-f]{64}$/.test(file.file_hash),
      )
      .map((file) => ({
        id: file.id,
        fileType: file.file_type,
        fileTypeLabel: FILE_TYPE_LABELS[file.file_type] || file.file_type,
        fileName: file.file_name,
        fileSize: Number(file.file_size),
        mimeType: file.mime_type,
        createdAt: file.created_at,
      })),
  };
}

export async function createContractDownloadRequest(
  actor: ContractDownloadActor,
  rawInput: ContractDownloadRequestCreateInput,
): Promise<ContractDownloadRequestApi> {
  if (actor.role !== "user") {
    throw new ContractDownloadRequestError(
      "仅普通员工需要提交合同文件下载申请",
      403,
      "CONTRACT_DOWNLOAD_EMPLOYEE_ONLY",
    );
  }
  const input = normalizeCreateInput(rawInput);
  let artifact: ApplicationArtifact | null = null;
  let committed = false;
  try {
    const requestId = nanoid();
    await db.transaction(async (client) => {
      const applicant = await actorSnapshot(client, actor.id, true);
      if (applicant.role !== "user") {
        throw new ContractDownloadRequestError(
          "当前账号已不是普通员工，请刷新页面后重试",
          403,
        );
      }
      const contract = await loadContract(client, input.contractId, true);
      assertEmployeeContractAccess(contract);
      const files = await loadSelectedFiles(
        client,
        contract.root_id || contract.id,
        input.fileIds,
        contract.status,
        true,
      );
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM contract_download_requests
         WHERE applicant_id = $1 AND contract_id = $2
           AND status IN ('pending_approval', 'approved', 'processing')
         LIMIT 1 FOR UPDATE`,
        [applicant.id, contract.id],
      );
      if (existing.rows[0]) {
        throw new ContractDownloadRequestError(
          "该合同已有进行中的下载申请，请勿重复提交",
          409,
          "CONTRACT_DOWNLOAD_ACTIVE_REQUEST_EXISTS",
        );
      }
      const latestTerminal = await client.query<{
        id: string;
        status: ContractDownloadRequestStatus;
      }>(
        `SELECT request.id, request.status
         FROM contract_download_requests request
         WHERE request.applicant_id = $1 AND request.contract_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM contract_download_requests successor
             WHERE successor.previous_request_id = request.id
           )
         ORDER BY request.created_at DESC, request.id DESC
         LIMIT 1 FOR UPDATE OF request`,
        [applicant.id, contract.id],
      );
      if (
        latestTerminal.rows[0] &&
        ["rejected", "withdrawn"].includes(latestTerminal.rows[0].status)
      ) {
        throw new ContractDownloadRequestError(
          "该合同最近一次下载申请已驳回或撤回，请从原申请重新提交",
          409,
          "CONTRACT_DOWNLOAD_USE_RESUBMIT",
        );
      }
      const approver = await uniqueGeneralManager(client);
      const administrator = await targetAdministrator(client);
      const nowDate = new Date();
      const now = nowDate.toISOString();
      const sequenceResult = await client.query<{ value: number }>(
        `SELECT nextval('contract_download_request_no_sequence')::bigint AS value`,
      );
      const requestNo = requestNumber(
        Number(sequenceResult.rows[0].value),
        nowDate,
      );
      const display = contractDisplay(contract);
      artifact = await createApplicationArtifact({
        client,
        requestId,
        requestNo,
        attemptNo: 1,
        contract,
        contractNo: display.contractNo,
        contractName: display.contractName,
        purpose: input.purpose,
        files,
        applicant,
        submittedAt: nowDate,
        approver,
      });
      await client.query(
        `INSERT INTO contract_download_requests (
           id, request_no, contract_id, applicant_id,
           applicant_name_snapshot, applicant_position_snapshot,
           contract_no_snapshot, contract_name_snapshot,
           contract_area_snapshot, contract_status_snapshot, purpose, status,
           chain_id, previous_request_id, attempt_no,
           target_approver_id, target_approver_name_snapshot,
           target_approver_position_snapshot, target_executor_id,
           target_executor_name_snapshot, target_executor_position_snapshot,
           application_file_path, application_file_name, application_file_hash,
           applicant_signature_snapshot_path, applicant_signature_snapshot_hash,
           created_at, updated_at, applicant_seen_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending_approval',
           $1,NULL,1,
           $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23,$23
         )`,
        [
          requestId,
          requestNo,
          contract.id,
          applicant.id,
          applicant.name,
          applicant.position,
          display.contractNo,
          display.contractName,
          contract.area,
          contract.status,
          input.purpose,
          approver.id,
          approver.name,
          approver.position,
          administrator.id,
          administrator.name,
          administrator.position,
          artifact.pdfStoredPath,
          artifact.pdfFileName,
          artifact.pdfHash,
          artifact.signatureStoredPath,
          artifact.signatureHash,
          now,
        ],
      );
      for (const file of files) {
        await client.query(
          `INSERT INTO contract_download_request_files (
             id, request_id, contract_file_id, file_type_snapshot,
             file_name_snapshot, file_path_snapshot, file_hash_snapshot,
             file_size_snapshot, mime_type_snapshot, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            nanoid(),
            requestId,
            file.id,
            file.file_type,
            file.file_name,
            file.file_path,
            file.file_hash,
            file.file_size,
            file.mime_type,
            now,
          ],
        );
      }
      await insertAudit(client, {
        requestId,
        action: "submit",
        actor: applicant,
        fromStatus: null,
        toStatus: "pending_approval",
        comment: input.purpose,
        metadata: { fileIds: files.map((file) => file.id) },
        createdAt: now,
      });
    });
    committed = true;
    return await getContractDownloadRequest(actor, requestId);
  } catch (error) {
    if (!committed) cleanupArtifact(artifact);
    if (
      uniqueViolationConstraint(error) ===
      "idx_contract_download_requests_one_active"
    ) {
      throw new ContractDownloadRequestError(
        "该合同已有进行中的下载申请，请勿重复提交",
        409,
        "CONTRACT_DOWNLOAD_ACTIVE_REQUEST_EXISTS",
      );
    }
    throw error;
  }
}

export async function withdrawContractDownloadRequest(
  actor: ContractDownloadActor,
  requestId: string,
  rawReason: unknown,
  expectedVersion: number,
): Promise<ContractDownloadRequestApi> {
  if (actor.role !== "user") {
    throw new ContractDownloadRequestError(
      "仅申请人可以撤回合同文件下载申请",
      403,
      "CONTRACT_DOWNLOAD_EMPLOYEE_ONLY",
    );
  }
  const reason = optionalText(rawReason, "撤回原因", 1000);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ContractDownloadRequestError("申请版本不正确");
  }
  await db.transaction(async (client) => {
    const request = await loadRequest(client, requestId, true);
    if (request.applicant_id !== actor.id) {
      throw new ContractDownloadRequestError(
        "只能撤回本人提交的下载申请",
        403,
        "CONTRACT_DOWNLOAD_APPLICANT_MISMATCH",
      );
    }
    if (request.status !== "pending_approval") {
      throw new ContractDownloadRequestError(
        "只有等待总经理审批的申请可以撤回",
        409,
        "CONTRACT_DOWNLOAD_WITHDRAW_PENDING_ONLY",
      );
    }
    if (request.version !== expectedVersion) {
      throw new ContractDownloadRequestError(
        "申请已发生变化，请刷新后重试",
        409,
        "CONTRACT_DOWNLOAD_REQUEST_VERSION_CONFLICT",
      );
    }
    const applicant = await actorSnapshot(client, actor.id, true);
    if (applicant.role !== "user") {
      throw new ContractDownloadRequestError(
        "当前账号已不是普通员工，不能撤回申请",
        403,
      );
    }
    const now = new Date().toISOString();
    await client.query(
      `UPDATE contract_download_requests SET
         status = 'withdrawn', withdrawn_at = $2, withdrawal_reason = $3,
         updated_at = $2, applicant_seen_at = $2, version = version + 1
       WHERE id = $1`,
      [request.id, now, reason || null],
    );
    await insertAudit(client, {
      requestId: request.id,
      action: "withdraw",
      actor: applicant,
      fromStatus: "pending_approval",
      toStatus: "withdrawn",
      comment: reason || null,
      createdAt: now,
    });
  });
  return getContractDownloadRequest(actor, requestId);
}

function deletableGeneratedPaths(request: DownloadRequestRow): string[] {
  const paths = [
    request.application_file_path,
    request.applicant_signature_snapshot_path,
    request.approved_application_file_path,
    request.approver_signature_snapshot_path,
  ].filter((value): value is string => Boolean(value));
  const unique = [...new Set(paths)];
  for (const storedPath of unique) {
    const normalized = storedPath.replace(/\\/gu, "/");
    if (
      !validateFilePath(storedPath) ||
      !normalized.startsWith("uploads/contract-download-requests/")
    ) {
      throw new ContractDownloadRequestError(
        "下载申请生成文件路径异常，已阻止删除",
        409,
        "CONTRACT_DOWNLOAD_DELETE_FILE_PATH_INVALID",
      );
    }
  }
  return unique;
}

export async function deleteWithdrawnContractDownloadRequest(
  actor: ContractDownloadActor,
  requestId: string,
  expectedVersion: number,
): Promise<{ deleted: true; storedFilePaths: string[] }> {
  if (actor.role !== "user") {
    throw new ContractDownloadRequestError(
      "仅申请人可以删除已撤回的合同下载申请",
      403,
      "CONTRACT_DOWNLOAD_EMPLOYEE_ONLY",
    );
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ContractDownloadRequestError("申请版本不正确");
  }
  return db.transaction(async (client) => {
    const request = await loadRequest(client, requestId, true);
    if (request.applicant_id !== actor.id) {
      throw new ContractDownloadRequestError(
        "只能删除本人提交的下载申请",
        403,
        "CONTRACT_DOWNLOAD_APPLICANT_MISMATCH",
      );
    }
    if (request.status !== "withdrawn") {
      throw new ContractDownloadRequestError(
        "只有已撤回的下载申请可以删除",
        409,
        "CONTRACT_DOWNLOAD_DELETE_WITHDRAWN_ONLY",
      );
    }
    if (Number(request.version) !== expectedVersion) {
      throw new ContractDownloadRequestError(
        "申请已发生变化，请刷新后重试",
        409,
        "CONTRACT_DOWNLOAD_REQUEST_VERSION_CONFLICT",
      );
    }
    if (
      request.approver_id ||
      request.decided_at ||
      request.executor_id ||
      request.processing_started_at ||
      request.completed_at ||
      request.approved_application_file_path ||
      request.approver_signature_snapshot_path
    ) {
      throw new ContractDownloadRequestError(
        "申请已产生审批或管理员处理事实，不能删除",
        409,
        "CONTRACT_DOWNLOAD_DELETE_HAS_PROCESSING_FACT",
      );
    }
    const lineage = await client.query<{ has_successor: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM contract_download_requests successor
         WHERE successor.previous_request_id = $1
       ) AS has_successor`,
      [request.id],
    );
    if (lineage.rows[0]?.has_successor) {
      throw new ContractDownloadRequestError(
        "历史申请链中间节点不能删除",
        409,
        "CONTRACT_DOWNLOAD_DELETE_NOT_LATEST_LEAF",
      );
    }
    const processingFacts = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM contract_download_request_audit_logs
       WHERE request_id = $1
         AND action IN ('approve', 'reject', 'download_file', 'complete')`,
      [request.id],
    );
    if (Number(processingFacts.rows[0]?.count || 0) > 0) {
      throw new ContractDownloadRequestError(
        "申请已产生审批或管理员处理事实，不能删除",
        409,
        "CONTRACT_DOWNLOAD_DELETE_HAS_PROCESSING_FACT",
      );
    }
    const applicant = await actorSnapshot(client, actor.id, true);
    if (applicant.role !== "user") {
      throw new ContractDownloadRequestError(
        "当前账号已不是普通员工，不能删除申请",
        403,
      );
    }
    const storedFilePaths = deletableGeneratedPaths(request);
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO contract_audit_logs (
         id, contract_id, action, actor_id, actor_role, from_status,
         to_status, changes_json, created_at
       ) VALUES ($1,$2,'download_request_deleted',$3,$4,$5,$5,$6::jsonb,$7)`,
      [
        nanoid(),
        request.contract_id,
        applicant.id,
        applicant.role,
        request.contract_status_snapshot,
        JSON.stringify({
          requestId: request.id,
          requestNo: request.request_no,
          attemptNo: Number(request.attempt_no),
          previousRequestId: request.previous_request_id,
          deletedStatus: request.status,
          generatedFileCount: storedFilePaths.length,
        }),
        now,
      ],
    );
    await client.query(
      `DELETE FROM contract_download_request_audit_logs WHERE request_id = $1`,
      [request.id],
    );
    await client.query(
      `DELETE FROM contract_download_request_files WHERE request_id = $1`,
      [request.id],
    );
    const deleted = await client.query(
      `DELETE FROM contract_download_requests
       WHERE id = $1 AND version = $2 AND status = 'withdrawn'`,
      [request.id, expectedVersion],
    );
    if (deleted.rowCount !== 1) {
      throw new ContractDownloadRequestError(
        "申请已发生变化，请刷新后重试",
        409,
        "CONTRACT_DOWNLOAD_REQUEST_VERSION_CONFLICT",
      );
    }
    return { deleted: true as const, storedFilePaths };
  });
}

export async function resubmitContractDownloadRequest(
  actor: ContractDownloadActor,
  sourceRequestId: string,
  rawInput: { purpose: unknown; fileIds: unknown },
  expectedVersion: number,
): Promise<ContractDownloadRequestApi> {
  if (actor.role !== "user") {
    throw new ContractDownloadRequestError(
      "仅原申请人可以重新提交合同文件下载申请",
      403,
      "CONTRACT_DOWNLOAD_EMPLOYEE_ONLY",
    );
  }
  const input = normalizeRequestContent(rawInput?.purpose, rawInput?.fileIds);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ContractDownloadRequestError("申请版本不正确");
  }
  const requestId = nanoid();
  let artifact: ApplicationArtifact | null = null;
  let committed = false;
  try {
    await db.transaction(async (client) => {
      const source = await loadRequest(client, sourceRequestId, true);
      if (source.applicant_id !== actor.id) {
        throw new ContractDownloadRequestError(
          "只能重新提交本人原有的下载申请",
          403,
          "CONTRACT_DOWNLOAD_APPLICANT_MISMATCH",
        );
      }
      if (
        !(["rejected", "withdrawn"] as const).includes(
          source.status as "rejected" | "withdrawn",
        )
      ) {
        throw new ContractDownloadRequestError(
          "只有已驳回或已撤回的申请可以重新提交",
          409,
          "CONTRACT_DOWNLOAD_RESUBMIT_TERMINAL_ONLY",
        );
      }
      if (source.version !== expectedVersion) {
        throw new ContractDownloadRequestError(
          "申请已发生变化，请刷新后重试",
          409,
          "CONTRACT_DOWNLOAD_REQUEST_VERSION_CONFLICT",
        );
      }
      const successor = await client.query<{ id: string }>(
        `SELECT id FROM contract_download_requests
         WHERE previous_request_id = $1
         LIMIT 1 FOR UPDATE`,
        [source.id],
      );
      if (successor.rows[0]) {
        throw new ContractDownloadRequestError(
          "该申请已经重新提交，请勿重复操作",
          409,
          "CONTRACT_DOWNLOAD_ALREADY_RESUBMITTED",
        );
      }
      const latestLeaf = await client.query<{ id: string }>(
        `SELECT request.id
         FROM contract_download_requests request
         WHERE request.applicant_id = $1 AND request.contract_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM contract_download_requests successor
             WHERE successor.previous_request_id = request.id
           )
         ORDER BY request.created_at DESC, request.id DESC
         LIMIT 1 FOR UPDATE OF request`,
        [source.applicant_id, source.contract_id],
      );
      if (latestLeaf.rows[0]?.id !== source.id) {
        throw new ContractDownloadRequestError(
          "该申请不是此合同最新一次申请，不能从旧记录重新提交",
          409,
          "CONTRACT_DOWNLOAD_RESUBMIT_SOURCE_NOT_LATEST",
        );
      }
      const applicant = await actorSnapshot(client, actor.id, true);
      if (applicant.role !== "user") {
        throw new ContractDownloadRequestError(
          "当前账号已不是普通员工，不能重新提交申请",
          403,
        );
      }
      const contract = await loadContract(client, source.contract_id, true);
      assertEmployeeContractAccess(contract);
      const files = await loadSelectedFiles(
        client,
        contract.root_id || contract.id,
        input.fileIds,
        contract.status,
        true,
      );
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM contract_download_requests
         WHERE applicant_id = $1 AND contract_id = $2
           AND status IN ('pending_approval', 'approved', 'processing')
         LIMIT 1 FOR UPDATE`,
        [applicant.id, contract.id],
      );
      if (existing.rows[0]) {
        throw new ContractDownloadRequestError(
          "该合同已有进行中的下载申请，请勿重复提交",
          409,
          "CONTRACT_DOWNLOAD_ACTIVE_REQUEST_EXISTS",
        );
      }
      const approver = await uniqueGeneralManager(client);
      const administrator = await targetAdministrator(client);
      const nowDate = new Date();
      const now = nowDate.toISOString();
      const sequenceResult = await client.query<{ value: number }>(
        `SELECT nextval('contract_download_request_no_sequence')::bigint AS value`,
      );
      const requestNo = requestNumber(
        Number(sequenceResult.rows[0].value),
        nowDate,
      );
      const display = contractDisplay(contract);
      const attemptNo = Number(source.attempt_no) + 1;
      artifact = await createApplicationArtifact({
        client,
        requestId,
        requestNo,
        attemptNo,
        previousRequestNo: source.request_no,
        contract,
        contractNo: display.contractNo,
        contractName: display.contractName,
        purpose: input.purpose,
        files,
        applicant,
        submittedAt: nowDate,
        approver,
      });
      await client.query(
        `INSERT INTO contract_download_requests (
           id, request_no, contract_id, applicant_id,
           applicant_name_snapshot, applicant_position_snapshot,
           contract_no_snapshot, contract_name_snapshot,
           contract_area_snapshot, contract_status_snapshot, purpose, status,
           chain_id, previous_request_id, attempt_no,
           target_approver_id, target_approver_name_snapshot,
           target_approver_position_snapshot, target_executor_id,
           target_executor_name_snapshot, target_executor_position_snapshot,
           application_file_path, application_file_name, application_file_hash,
           applicant_signature_snapshot_path, applicant_signature_snapshot_hash,
           created_at, updated_at, applicant_seen_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending_approval',
           $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$26,$26
         )`,
        [
          requestId,
          requestNo,
          contract.id,
          applicant.id,
          applicant.name,
          applicant.position,
          display.contractNo,
          display.contractName,
          contract.area,
          contract.status,
          input.purpose,
          source.chain_id,
          source.id,
          attemptNo,
          approver.id,
          approver.name,
          approver.position,
          administrator.id,
          administrator.name,
          administrator.position,
          artifact.pdfStoredPath,
          artifact.pdfFileName,
          artifact.pdfHash,
          artifact.signatureStoredPath,
          artifact.signatureHash,
          now,
        ],
      );
      for (const file of files) {
        await client.query(
          `INSERT INTO contract_download_request_files (
             id, request_id, contract_file_id, file_type_snapshot,
             file_name_snapshot, file_path_snapshot, file_hash_snapshot,
             file_size_snapshot, mime_type_snapshot, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            nanoid(),
            requestId,
            file.id,
            file.file_type,
            file.file_name,
            file.file_path,
            file.file_hash,
            file.file_size,
            file.mime_type,
            now,
          ],
        );
      }
      await client.query(
        `UPDATE contract_download_requests
         SET applicant_seen_at = updated_at
         WHERE id = $1`,
        [source.id],
      );
      await insertAudit(client, {
        requestId,
        action: "resubmit",
        actor: applicant,
        fromStatus: source.status,
        toStatus: "pending_approval",
        comment: input.purpose,
        metadata: {
          previousRequestId: source.id,
          previousRequestNo: source.request_no,
          attemptNo,
          fileIds: files.map((file) => file.id),
        },
        createdAt: now,
      });
    });
    committed = true;
    return await getContractDownloadRequest(actor, requestId);
  } catch (error) {
    if (!committed) cleanupArtifact(artifact);
    const constraint = uniqueViolationConstraint(error);
    if (constraint === "idx_contract_download_requests_previous_unique") {
      throw new ContractDownloadRequestError(
        "该申请已经重新提交，请勿重复操作",
        409,
        "CONTRACT_DOWNLOAD_ALREADY_RESUBMITTED",
      );
    }
    if (constraint === "idx_contract_download_requests_one_active") {
      throw new ContractDownloadRequestError(
        "该合同已有进行中的下载申请，请勿重复提交",
        409,
        "CONTRACT_DOWNLOAD_ACTIVE_REQUEST_EXISTS",
      );
    }
    throw error;
  }
}

async function insertAudit(
  client: Pick<PoolClient, "query">,
  input: {
    requestId: string;
    action:
      | "submit"
      | "approve"
      | "reject"
      | "withdraw"
      | "resubmit"
      | "download_file"
      | "complete";
    actor: ActorSnapshot;
    fromStatus: ContractDownloadRequestStatus | null;
    toStatus: ContractDownloadRequestStatus;
    comment: string | null;
    metadata?: Record<string, unknown>;
    createdAt: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO contract_download_request_audit_logs (
       id, request_id, action, actor_id, actor_name_snapshot,
       actor_position_snapshot, from_status, to_status, comment,
       metadata_json, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [
      nanoid(),
      input.requestId,
      input.action,
      input.actor.id,
      input.actor.name,
      input.actor.position,
      input.fromStatus,
      input.toStatus,
      input.comment,
      JSON.stringify(input.metadata || {}),
      input.createdAt,
    ],
  );
}

function assertRequestReadAccess(
  actor: ContractDownloadActor,
  request: DownloadRequestRow,
): void {
  if (actor.role === "user" && request.applicant_id === actor.id) return;
  if (actor.role === "general_manager") {
    if (
      request.status === "pending_approval" &&
      request.target_approver_id === actor.id
    ) {
      return;
    }
    if (
      ["approved", "rejected", "processing", "completed"].includes(
        request.status,
      ) &&
      request.approver_id === actor.id
    ) {
      return;
    }
  }
  if (
    isContractDownloadAdminRole(actor.role) &&
    request.target_executor_id === actor.id &&
    ["approved", "processing"].includes(request.status)
  ) {
    return;
  }
  if (
    actor.role === "admin" &&
    request.status === "completed" &&
    request.executor_id === actor.id
  ) {
    return;
  }
  throw new ContractDownloadRequestError(
    "无权查看此下载申请",
    403,
    "CONTRACT_DOWNLOAD_REQUEST_FORBIDDEN",
  );
}

async function loadRequest(
  client: Pick<PoolClient, "query">,
  requestId: string,
  lock = false,
): Promise<DownloadRequestRow> {
  const result = await client.query<DownloadRequestRow>(
    `SELECT * FROM contract_download_requests
     WHERE id = $1
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [requestId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ContractDownloadRequestError(
      "下载申请不存在",
      404,
      "CONTRACT_DOWNLOAD_REQUEST_NOT_FOUND",
    );
  }
  return row;
}

async function requestFiles(
  client: Pick<PoolClient, "query">,
  requestId: string,
): Promise<DownloadRequestFileRow[]> {
  const result = await client.query<DownloadRequestFileRow>(
    `SELECT * FROM contract_download_request_files
     WHERE request_id = $1
     ORDER BY created_at, id`,
    [requestId],
  );
  return result.rows;
}

async function requestAuditLogs(
  client: Pick<PoolClient, "query">,
  requestId: string,
): Promise<DownloadRequestAuditRow[]> {
  const result = await client.query<DownloadRequestAuditRow>(
    `SELECT id, action, actor_id, actor_name_snapshot,
            actor_position_snapshot, from_status, to_status, comment,
            metadata_json, created_at
     FROM contract_download_request_audit_logs
     WHERE request_id = $1
     ORDER BY created_at, id`,
    [requestId],
  );
  return result.rows;
}

async function requestChainHistory(
  client: Pick<PoolClient, "query">,
  chainId: string,
  actor?: ContractDownloadActor,
): Promise<DownloadRequestChainAuditRow[]> {
  const params: unknown[] = [chainId];
  let chainVisibility = "";
  if (actor?.role === "general_manager") {
    params.push(actor.id);
    chainVisibility = `
       AND (
         (request.status = 'pending_approval'
          AND request.target_approver_id = $${params.length})
         OR
         (request.status IN ('approved', 'rejected', 'processing', 'completed')
          AND request.approver_id = $${params.length})
       )`;
  } else if (actor?.role === "admin") {
    params.push(actor.id);
    chainVisibility = `
       AND (
         (request.status IN ('approved', 'processing')
          AND request.target_executor_id = $${params.length})
         OR
         (request.status = 'completed'
          AND request.executor_id = $${params.length})
       )`;
  }
  const result = await client.query<DownloadRequestChainAuditRow>(
    `SELECT audit.id, audit.request_id, request.request_no, request.attempt_no,
            audit.action, audit.actor_id, audit.actor_name_snapshot,
            audit.actor_position_snapshot, audit.from_status, audit.to_status,
            audit.comment, audit.metadata_json, audit.created_at
     FROM contract_download_request_audit_logs audit
     INNER JOIN contract_download_requests request ON request.id = audit.request_id
     WHERE request.chain_id = $1${chainVisibility}
     ORDER BY request.attempt_no, audit.created_at, audit.id`,
    params,
  );
  return result.rows;
}

async function latestChainAttemptNo(
  client: Pick<PoolClient, "query">,
  chainId: string,
): Promise<number> {
  const result = await client.query<{ attempt_no: number }>(
    `SELECT attempt_no
     FROM contract_download_requests
     WHERE chain_id = $1
     ORDER BY attempt_no DESC
     LIMIT 1`,
    [chainId],
  );
  return Number(result.rows[0]?.attempt_no || 1);
}

async function latestApplicantContractLeafId(
  client: Pick<PoolClient, "query">,
  applicantId: string,
  contractId: string,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT request.id
     FROM contract_download_requests request
     WHERE request.applicant_id = $1 AND request.contract_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM contract_download_requests successor
         WHERE successor.previous_request_id = request.id
       )
     ORDER BY request.created_at DESC, request.id DESC
     LIMIT 1`,
    [applicantId, contractId],
  );
  return result.rows[0]?.id || null;
}

function auditToApi(
  row: DownloadRequestAuditRow,
): ContractDownloadRequestAuditEntry {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actor_id,
    actorName: row.actor_name_snapshot,
    actorPosition: row.actor_position_snapshot,
    actorLabel: personLabel(
      row.actor_position_snapshot,
      row.actor_name_snapshot,
    ),
    fromStatus: row.from_status,
    toStatus: row.to_status,
    comment: row.comment,
    metadata:
      row.metadata_json && typeof row.metadata_json === "object"
        ? (row.metadata_json as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
  };
}

function chainAuditToApi(
  row: DownloadRequestChainAuditRow,
): ContractDownloadRequestChainEntry {
  return {
    ...auditToApi(row),
    requestId: row.request_id,
    requestNo: row.request_no,
    attemptNo: Number(row.attempt_no),
  };
}

function fileToApi(
  file: DownloadRequestFileRow,
): ContractDownloadRequestFileSnapshot {
  return {
    id: file.id,
    contractFileId: file.contract_file_id,
    fileType: file.file_type_snapshot,
    fileName: file.file_name_snapshot,
    fileSize: Number(file.file_size_snapshot),
    mimeType: file.mime_type_snapshot,
    downloadedBy: file.downloaded_by,
    downloadedAt: file.downloaded_at,
  };
}

function workflowFor(
  request: DownloadRequestRow,
): ContractDownloadWorkflowNode[] {
  const gmLabel = personLabel(
    request.target_approver_position_snapshot,
    request.target_approver_name_snapshot,
  );
  const adminLabel = personLabel(
    request.executor_position_snapshot ||
      request.target_executor_position_snapshot,
    request.executor_name_snapshot || request.target_executor_name_snapshot,
  );
  return [
    {
      key: "applicant",
      label: personLabel(
        request.applicant_position_snapshot,
        request.applicant_name_snapshot,
      ),
      status: request.status === "withdrawn" ? "withdrawn" : "completed",
      time: request.withdrawn_at || request.created_at,
      comment: request.withdrawal_reason || request.purpose,
    },
    {
      key: "general_manager",
      label: gmLabel,
      status:
        request.status === "pending_approval"
          ? "current"
          : request.status === "rejected"
            ? "rejected"
            : request.status === "withdrawn"
              ? "waiting"
              : "completed",
      time: request.decided_at,
      comment: request.decision_comment,
    },
    {
      key: "administrator",
      label: adminLabel,
      status:
        request.status === "approved" || request.status === "processing"
          ? "current"
          : request.status === "completed"
            ? "completed"
            : "waiting",
      time: request.completed_at,
      comment: request.processing_note,
    },
  ];
}

function nextStepFor(request: DownloadRequestRow): string | null {
  if (request.status === "pending_approval") {
    return `${personLabel(request.target_approver_position_snapshot, request.target_approver_name_snapshot)}审批`;
  }
  if (request.status === "approved") {
    return `${personLabel(request.target_executor_position_snapshot, request.target_executor_name_snapshot)}执行下载`;
  }
  if (request.status === "processing") {
    return `${personLabel(request.executor_position_snapshot || request.target_executor_position_snapshot, request.executor_name_snapshot || request.target_executor_name_snapshot)}标记已处理`;
  }
  return null;
}

function toRequestApi(
  row: DownloadRequestRow,
  files: DownloadRequestFileRow[],
  auditLogs: DownloadRequestAuditRow[] = [],
  chainHistory: DownloadRequestChainAuditRow[] = [],
  latestAttemptNo = Number(row.attempt_no),
  actor?: ContractDownloadActor,
  latestContractLeafId: string | null = row.id,
): ContractDownloadRequestApi {
  const executorPosition =
    row.executor_position_snapshot || row.target_executor_position_snapshot;
  const executorName =
    row.executor_name_snapshot || row.target_executor_name_snapshot;
  return {
    id: row.id,
    requestNo: row.request_no,
    contractId: row.contract_id,
    contractNo: row.contract_no_snapshot,
    contractName: row.contract_name_snapshot,
    contractArea: row.contract_area_snapshot,
    contractStatus: row.contract_status_snapshot,
    purpose: row.purpose,
    status: row.status,
    chainId: row.chain_id,
    previousRequestId: row.previous_request_id,
    attemptNo: Number(row.attempt_no),
    applicant: {
      id: row.applicant_id,
      name: row.applicant_name_snapshot,
      position: row.applicant_position_snapshot,
      label: personLabel(
        row.applicant_position_snapshot,
        row.applicant_name_snapshot,
      ),
    },
    approver: {
      id: row.target_approver_id,
      name: row.target_approver_name_snapshot,
      position: row.target_approver_position_snapshot,
      label: personLabel(
        row.target_approver_position_snapshot,
        row.target_approver_name_snapshot,
      ),
      decidedAt: row.decided_at,
      comment: row.decision_comment,
    },
    executor: {
      id: row.executor_id || row.target_executor_id,
      name: executorName,
      position: executorPosition,
      label: personLabel(executorPosition, executorName),
      completedAt: row.completed_at,
      note: row.processing_note,
    },
    files: files.map(fileToApi),
    applicationFileName: row.application_file_name,
    nextStep: nextStepFor(row),
    workflow: workflowFor(row),
    auditLogs: auditLogs.map(auditToApi),
    chainHistory: chainHistory.map(chainAuditToApi),
    canWithdraw:
      actor?.role === "user" &&
      actor.id === row.applicant_id &&
      row.status === "pending_approval" &&
      Number(row.attempt_no) === latestAttemptNo &&
      row.id === latestContractLeafId,
    canResubmit:
      actor?.role === "user" &&
      actor.id === row.applicant_id &&
      ["rejected", "withdrawn"].includes(row.status) &&
      Number(row.attempt_no) === latestAttemptNo &&
      row.id === latestContractLeafId,
    canDelete:
      actor?.role === "user" &&
      actor.id === row.applicant_id &&
      row.status === "withdrawn" &&
      !row.approver_id &&
      !row.decided_at &&
      !row.executor_id &&
      !row.processing_started_at &&
      !row.completed_at &&
      Number(row.attempt_no) === latestAttemptNo &&
      row.id === latestContractLeafId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

export async function getContractDownloadRequest(
  actor: ContractDownloadActor,
  requestId: string,
): Promise<ContractDownloadRequestApi> {
  const row = await loadRequest(pool, requestId);
  assertRequestReadAccess(actor, row);
  const [
    files,
    auditLogs,
    chainHistory,
    latestAttemptNo,
    latestContractLeafId,
  ] = await Promise.all([
    requestFiles(pool, requestId),
    requestAuditLogs(pool, requestId),
    requestChainHistory(pool, row.chain_id, actor),
    latestChainAttemptNo(pool, row.chain_id),
    actor.role === "user"
      ? latestApplicantContractLeafId(pool, row.applicant_id, row.contract_id)
      : Promise.resolve(null),
  ]);
  return toRequestApi(
    row,
    files,
    auditLogs,
    chainHistory,
    latestAttemptNo,
    actor,
    latestContractLeafId,
  );
}

export async function listContractDownloadRequests(
  actor: ContractDownloadActor,
  scope: ContractDownloadRequestListScope,
  status?: string,
  page = 1,
  pageSize = 20,
  rawKeyword = "",
): Promise<{
  items: ContractDownloadRequestApi[];
  total: number;
  page: number;
  pageSize: number;
}> {
  if (!Number.isInteger(page) || page < 1) {
    throw new ContractDownloadRequestError("页码必须为正整数");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ContractDownloadRequestError("每页数量必须为 1 至 100 的整数");
  }
  const params: unknown[] = [];
  const predicates: string[] = [];
  if (scope === "mine") {
    if (actor.role !== "user") {
      throw new ContractDownloadRequestError(
        "仅普通员工可以查看我的下载申请",
        403,
      );
    }
    params.push(actor.id);
    predicates.push(`applicant_id = $${params.length}`);
    predicates.push(`NOT EXISTS (
      SELECT 1 FROM contract_download_requests successor
      WHERE successor.previous_request_id = contract_download_requests.id
    )`);
    predicates.push(`status <> 'completed'`);
  } else if (scope === "mine_history") {
    if (actor.role !== "user") {
      throw new ContractDownloadRequestError(
        "仅普通员工可以查看本人历史下载申请",
        403,
      );
    }
    params.push(actor.id);
    predicates.push(`applicant_id = $${params.length}`);
    predicates.push(`status = 'completed'`);
  } else if (scope === "approval") {
    if (actor.role !== "general_manager") {
      throw new ContractDownloadRequestError(
        "仅总经理可以处理下载申请审批",
        403,
      );
    }
    params.push(actor.id);
    predicates.push(`target_approver_id = $${params.length}`);
  } else if (scope === "approval_history") {
    if (actor.role !== "general_manager") {
      throw new ContractDownloadRequestError(
        "仅总经理可以查看本人下载申请审批历史",
        403,
      );
    }
    params.push(actor.id);
    predicates.push(`approver_id = $${params.length}`);
  } else if (scope === "admin_history") {
    if (actor.role !== "admin") {
      throw new ContractDownloadRequestError(
        "仅实际执行管理员可以查看本人合同下载处理历史",
        403,
      );
    }
    params.push(actor.id);
    predicates.push(`executor_id = $${params.length}`);
  } else {
    if (!isContractDownloadAdminRole(actor.role)) {
      throw new ContractDownloadRequestError(
        "仅管理员可以查看合同下载待办",
        403,
      );
    }
    params.push(actor.id);
    predicates.push(`target_executor_id = $${params.length}`);
  }
  if (status) {
    if (
      ![
        "pending_approval",
        "approved",
        "rejected",
        "withdrawn",
        "processing",
        "completed",
      ].includes(status)
    ) {
      throw new ContractDownloadRequestError("下载申请状态筛选值不正确");
    }
    if (scope === "admin" && !["approved", "processing"].includes(status)) {
      throw new ContractDownloadRequestError(
        "管理员待办只能查看已批准或执行中的下载任务",
        403,
      );
    }
    if (
      scope === "approval_history" &&
      !["approved", "processing", "completed"].includes(status)
    ) {
      throw new ContractDownloadRequestError(
        "总经理审批历史只能筛选已批准、执行中或已完成的申请",
        403,
      );
    }
    if (scope === "admin_history" && status !== "completed") {
      throw new ContractDownloadRequestError(
        "管理员处理历史只能筛选已完成的下载任务",
        403,
      );
    }
    if (scope === "mine_history" && status !== "completed") {
      throw new ContractDownloadRequestError(
        "员工历史申请只展示已完成记录",
        403,
      );
    }
    params.push(status);
    predicates.push(`status = $${params.length}`);
  } else if (scope === "approval") {
    predicates.push(`status = 'pending_approval'`);
  } else if (scope === "approval_history") {
    predicates.push(`status IN ('approved', 'processing', 'completed')`);
  } else if (scope === "admin_history") {
    predicates.push(`status = 'completed'`);
  } else if (scope === "admin") {
    predicates.push(`status IN ('approved', 'processing')`);
  }
  const keyword = rawKeyword.trim();
  if (keyword) {
    params.push(`%${keyword}%`);
    predicates.push(`(
      contract_name_snapshot ILIKE $${params.length}
      OR contract_no_snapshot ILIKE $${params.length}
      OR applicant_name_snapshot ILIKE $${params.length}
      OR purpose ILIKE $${params.length}
    )`);
  }
  const countResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM contract_download_requests
     WHERE ${predicates.join(" AND ")}`,
    params,
  );
  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const orderBy =
    scope === "approval_history"
      ? "decided_at DESC, updated_at DESC, id DESC"
      : scope === "admin_history"
        ? "completed_at DESC, updated_at DESC, id DESC"
        : scope === "mine_history"
          ? "updated_at DESC, created_at DESC, id DESC"
          : "created_at DESC, id DESC";
  const result = await pool.query<DownloadRequestRow>(
    `SELECT * FROM contract_download_requests
     WHERE ${predicates.join(" AND ")}
     ORDER BY ${orderBy}
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );
  const items: ContractDownloadRequestApi[] = [];
  for (const row of result.rows) {
    const [files, chainHistory, latestAttemptNo, latestContractLeafId] =
      await Promise.all([
        requestFiles(pool, row.id),
        requestChainHistory(pool, row.chain_id, actor),
        latestChainAttemptNo(pool, row.chain_id),
        actor.role === "user"
          ? latestApplicantContractLeafId(
              pool,
              row.applicant_id,
              row.contract_id,
            )
          : Promise.resolve(null),
      ]);
    items.push(
      toRequestApi(
        row,
        files,
        [],
        chainHistory,
        latestAttemptNo,
        actor,
        latestContractLeafId,
      ),
    );
  }
  return {
    items,
    total: Number(countResult.rows[0]?.count || 0),
    page,
    pageSize,
  };
}

function safeSpreadsheetText(value: unknown): string {
  const text = String(value ?? "");
  return /^[=+\-@]/u.test(text.trimStart()) ? `'${text}` : text;
}

function formatShanghaiDateTime(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

async function exportContractDownloadHistory(
  actor: ContractDownloadActor,
  rawKeyword: string,
  scope: "manager" | "admin",
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  if (scope === "manager" && actor.role !== "general_manager") {
    throw new ContractDownloadRequestError(
      "仅实际审批总经理可以导出本人合同下载审批记录",
      403,
      "CONTRACT_DOWNLOAD_MANAGER_EXPORT_FORBIDDEN",
    );
  }
  if (scope === "admin" && actor.role !== "admin") {
    throw new ContractDownloadRequestError(
      "仅实际执行管理员可以导出本人合同下载处理记录",
      403,
      "CONTRACT_DOWNLOAD_ADMIN_EXPORT_FORBIDDEN",
    );
  }
  const params: unknown[] = [actor.id];
  const predicates =
    scope === "manager"
      ? [
          "request.status IN ('approved', 'processing', 'completed')",
          "request.approver_id = $1",
        ]
      : ["request.status = 'completed'", "request.executor_id = $1"];
  const keyword = rawKeyword.trim();
  if (keyword) {
    params.push(`%${keyword}%`);
    predicates.push(`(
      request.contract_name_snapshot ILIKE $${params.length}
      OR request.contract_no_snapshot ILIKE $${params.length}
      OR request.applicant_name_snapshot ILIKE $${params.length}
      OR request.purpose ILIKE $${params.length}
    )`);
  }
  const countResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM contract_download_requests request
     WHERE ${predicates.join(" AND ")}`,
    params,
  );
  const count = Number(countResult.rows[0]?.count || 0);
  if (count > MAX_ADMIN_HISTORY_EXPORT_ROWS) {
    throw new ContractDownloadRequestError(
      `${scope === "manager" ? "审批记录" : "处理记录"}超过 ${MAX_ADMIN_HISTORY_EXPORT_ROWS} 条，请缩小关键词范围后导出`,
      400,
      "CONTRACT_DOWNLOAD_EXPORT_TOO_LARGE",
    );
  }
  const result = await pool.query<DownloadRequestRow & { file_count: number }>(
    `SELECT request.*,
       (SELECT COUNT(*)::int FROM contract_download_request_files file
         WHERE file.request_id = request.id) AS file_count
     FROM contract_download_requests request
     WHERE ${predicates.join(" AND ")}
     ORDER BY ${
       scope === "manager"
         ? "request.decided_at DESC, request.updated_at DESC, request.id DESC"
         : "request.completed_at DESC, request.updated_at DESC, request.id DESC"
     }`,
    params,
  );
  const rows: Array<Array<string | number>> = [
    [
      "序号",
      "申请编号",
      "合同编号",
      "合同名称",
      "申请人",
      "下载用途",
      "申请时间",
      "审批人",
      "审批时间",
      "执行管理员",
      "处理开始时间",
      "完成时间",
      "处理说明",
      "附件数量",
    ],
  ];
  result.rows.forEach((row, index) => {
    rows.push([
      index + 1,
      safeSpreadsheetText(row.request_no),
      safeSpreadsheetText(row.contract_no_snapshot),
      safeSpreadsheetText(row.contract_name_snapshot),
      safeSpreadsheetText(row.applicant_name_snapshot),
      safeSpreadsheetText(row.purpose),
      formatShanghaiDateTime(row.created_at),
      safeSpreadsheetText(row.approver_name_snapshot),
      formatShanghaiDateTime(row.decided_at),
      safeSpreadsheetText(row.executor_name_snapshot),
      formatShanghaiDateTime(row.processing_started_at),
      formatShanghaiDateTime(row.completed_at),
      safeSpreadsheetText(row.processing_note),
      Number(row.file_count || 0),
    ]);
  });
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 8 },
    { wch: 24 },
    { wch: 20 },
    { wch: 32 },
    { wch: 16 },
    { wch: 36 },
    { wch: 24 },
    { wch: 16 },
    { wch: 24 },
    { wch: 16 },
    { wch: 24 },
    { wch: 24 },
    { wch: 36 },
    { wch: 10 },
  ];
  const sheetName =
    scope === "manager" ? "合同下载审批记录" : "合同下载处理记录";
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const buffer = Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/\//gu, "");
  return {
    buffer,
    fileName: `${sheetName}-${date}.xlsx`,
    mimeType: CONTRACT_DOWNLOAD_EXPORT_MIME,
  };
}

export async function exportManagerContractDownloadHistory(
  actor: ContractDownloadActor,
  rawKeyword = "",
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  return exportContractDownloadHistory(actor, rawKeyword, "manager");
}

export async function exportAdminContractDownloadHistory(
  actor: ContractDownloadActor,
  rawKeyword = "",
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  return exportContractDownloadHistory(actor, rawKeyword, "admin");
}

/**
 * 返回当前账号在合同下载申请流程中的菜单提醒数量。
 *
 * 计数始终按当前账号编号过滤，不能通过客户端传入申请人、审批人或
 * 执行人编号。这样即使伪造查询参数，也无法探测其他账号的待办数量。
 */
export async function getContractDownloadPendingCounts(
  actor: ContractDownloadActor,
): Promise<ContractDownloadPendingCounts> {
  const empty: ContractDownloadPendingCounts = {
    unreadResults: 0,
    managerPending: 0,
    executorPending: 0,
    total: 0,
  };

  if (actor.role === "user") {
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM contract_download_requests
       WHERE applicant_id = $1
         AND status <> 'pending_approval'
         AND updated_at > applicant_seen_at`,
      [actor.id],
    );
    const unreadResults = Number(result.rows[0]?.count || 0);
    return { ...empty, unreadResults, total: unreadResults };
  }

  if (actor.role === "general_manager") {
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM contract_download_requests
       WHERE target_approver_id = $1
         AND status = 'pending_approval'`,
      [actor.id],
    );
    const managerPending = Number(result.rows[0]?.count || 0);
    return { ...empty, managerPending, total: managerPending };
  }

  if (isContractDownloadAdminRole(actor.role)) {
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM contract_download_requests
       WHERE target_executor_id = $1
         AND status IN ('approved', 'processing')`,
      [actor.id],
    );
    const executorPending = Number(result.rows[0]?.count || 0);
    return { ...empty, executorPending, total: executorPending };
  }

  return empty;
}

/** 普通员工查看“我的下载申请”后，批量确认当前可见结果已读。 */
export async function acknowledgeContractDownloadResults(
  actor: ContractDownloadActor,
  rawRequestIds: unknown,
): Promise<{ acknowledgedCount: number; unreadResults: number }> {
  if (actor.role !== "user") {
    throw new ContractDownloadRequestError(
      "仅普通员工可以确认本人下载申请结果已读",
      403,
      "CONTRACT_DOWNLOAD_EMPLOYEE_ONLY",
    );
  }
  if (!Array.isArray(rawRequestIds) || rawRequestIds.length < 1) {
    throw new ContractDownloadRequestError(
      "请选择要确认已读的下载申请",
      400,
      "CONTRACT_DOWNLOAD_ACK_REQUEST_IDS_REQUIRED",
    );
  }
  if (rawRequestIds.length > 100) {
    throw new ContractDownloadRequestError(
      "每次最多确认 100 条下载申请",
      400,
      "CONTRACT_DOWNLOAD_ACK_REQUEST_IDS_LIMIT",
    );
  }
  const requestIds = Array.from(
    new Set(
      rawRequestIds.map((requestId) =>
        requiredText(requestId, "下载申请编号", 128),
      ),
    ),
  );
  const result = await pool.query<{
    acknowledged_count: number;
    unread_results: number;
  }>(
    `WITH acknowledged AS (
       UPDATE contract_download_requests
       SET applicant_seen_at = updated_at
       WHERE applicant_id = $1
         AND id = ANY($2::text[])
         AND status <> 'pending_approval'
         AND updated_at > applicant_seen_at
       RETURNING id
     )
     SELECT
       (SELECT COUNT(*)::int FROM acknowledged) AS acknowledged_count,
       (
         SELECT COUNT(*)::int
         FROM contract_download_requests request
         WHERE request.applicant_id = $1
           AND request.status <> 'pending_approval'
           AND request.updated_at > request.applicant_seen_at
           AND NOT EXISTS (
             SELECT 1 FROM acknowledged
             WHERE acknowledged.id = request.id
           )
       ) AS unread_results`,
    [actor.id, requestIds],
  );
  return {
    acknowledgedCount: Number(result.rows[0]?.acknowledged_count || 0),
    unreadResults: Number(result.rows[0]?.unread_results || 0),
  };
}

export async function decideContractDownloadRequest(
  actor: ContractDownloadActor,
  requestId: string,
  rawDecision: ContractDownloadDecision,
  rawComment: unknown,
  expectedVersion: number,
): Promise<ContractDownloadRequestApi> {
  if (actor.role !== "general_manager") {
    throw new ContractDownloadRequestError(
      "仅总经理可以审批合同下载申请",
      403,
      "CONTRACT_DOWNLOAD_APPROVER_ONLY",
    );
  }
  if (!(["approve", "reject"] as const).includes(rawDecision)) {
    throw new ContractDownloadRequestError("请选择批准或驳回");
  }
  const comment = optionalText(rawComment, "审批意见", 1000);
  if (rawDecision === "reject" && !comment) {
    throw new ContractDownloadRequestError("驳回时必须填写审批意见");
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ContractDownloadRequestError("申请版本不正确");
  }
  let artifact: ApplicationArtifact | null = null;
  let committed = false;
  try {
    await db.transaction(async (client) => {
      const request = await loadRequest(client, requestId, true);
      if (request.status !== "pending_approval") {
        throw new ContractDownloadRequestError(
          "此下载申请已处理，不能重复审批",
          409,
          "CONTRACT_DOWNLOAD_REQUEST_ALREADY_DECIDED",
        );
      }
      if (request.version !== expectedVersion) {
        throw new ContractDownloadRequestError(
          "申请已发生变化，请刷新后重试",
          409,
          "CONTRACT_DOWNLOAD_REQUEST_VERSION_CONFLICT",
        );
      }
      if (request.target_approver_id !== actor.id) {
        throw new ContractDownloadRequestError(
          "此申请未分配给当前总经理账号",
          403,
          "CONTRACT_DOWNLOAD_APPROVER_MISMATCH",
        );
      }
      const approver = await actorSnapshot(client, actor.id, true);
      const nowDate = new Date();
      const now = nowDate.toISOString();
      if (rawDecision === "approve") {
        const contract = await loadContract(client, request.contract_id, true);
        const fileRows = await requestFiles(client, request.id);
        const selectedFiles = fileRows.map<ContractFileRow>((file) => ({
          id: file.contract_file_id,
          contract_id: request.contract_id,
          file_type: file.file_type_snapshot,
          file_name: file.file_name_snapshot,
          file_path: file.file_path_snapshot,
          file_size: file.file_size_snapshot,
          mime_type: file.mime_type_snapshot,
          file_hash: file.file_hash_snapshot,
          created_at: file.created_at,
        }));
        const applicant: ActorSnapshot = {
          id: request.applicant_id,
          name: request.applicant_name_snapshot,
          role: "user",
          position: request.applicant_position_snapshot,
        };
        const previousRequest = request.previous_request_id
          ? await loadRequest(client, request.previous_request_id)
          : null;
        const applicantSignature = await normalizeSignaturePng(
          fs.readFileSync(
            absoluteSnapshotFilePath(
              request.applicant_signature_snapshot_path,
              request.applicant_signature_snapshot_hash,
              "申请人电子签名快照",
            ),
          ),
        );
        artifact = await createApplicationArtifact({
          client,
          requestId: request.id,
          requestNo: request.request_no,
          attemptNo: Number(request.attempt_no),
          previousRequestNo: previousRequest?.request_no,
          contract: {
            ...contract,
            contract_no: request.contract_no_snapshot,
            business_contract_no: request.contract_no_snapshot,
            title: request.contract_name_snapshot,
            project_name: request.contract_name_snapshot,
            area: request.contract_area_snapshot,
            status: request.contract_status_snapshot,
          },
          contractNo: request.contract_no_snapshot,
          contractName: request.contract_name_snapshot,
          purpose: request.purpose,
          files: selectedFiles,
          applicant,
          submittedAt: new Date(request.created_at),
          approver,
          approverDecision: {
            decision: rawDecision,
            comment,
            decidedAt: nowDate,
          },
          applicantSignatureOverride: applicantSignature,
        });
      }
      await client.query(
        `UPDATE contract_download_requests SET
           status = $2, approver_id = $3, approver_name_snapshot = $4,
           approver_position_snapshot = $5, decision_comment = $6,
           decided_at = $7,
           approved_application_file_path = $8,
           approved_application_file_hash = $9,
           approver_signature_snapshot_path = $10,
           approver_signature_snapshot_hash = $11,
           updated_at = $7, version = version + 1
         WHERE id = $1`,
        [
          request.id,
          rawDecision === "approve" ? "approved" : "rejected",
          approver.id,
          approver.name,
          approver.position,
          comment || null,
          now,
          artifact?.pdfStoredPath || null,
          artifact?.pdfHash || null,
          artifact?.signatureStoredPath || null,
          artifact?.signatureHash || null,
        ],
      );
      await insertAudit(client, {
        requestId: request.id,
        action: rawDecision === "approve" ? "approve" : "reject",
        actor: approver,
        fromStatus: "pending_approval",
        toStatus: rawDecision === "approve" ? "approved" : "rejected",
        comment: comment || null,
        createdAt: now,
      });
    });
    committed = true;
    return await getContractDownloadRequest(actor, requestId);
  } catch (error) {
    if (!committed) cleanupArtifact(artifact);
    throw error;
  }
}

export interface PreparedContractDownloadFile {
  absolutePath: string;
  fileName: string;
  mimeType: string;
}

export async function prepareContractDownloadRequestFilePreview(
  actor: ContractDownloadActor,
  requestId: string,
  requestFileId: string,
): Promise<PreparedContractDownloadFile> {
  const request = await loadRequest(pool, requestId);
  assertRequestReadAccess(actor, request);
  if (actor.role === "user") {
    assertEmployeeContractAccess(await loadContract(pool, request.contract_id));
  }
  const fileResult = await pool.query<DownloadRequestFileRow>(
    `SELECT * FROM contract_download_request_files
     WHERE id = $1 AND request_id = $2
     LIMIT 1`,
    [requestFileId, request.id],
  );
  const file = fileResult.rows[0];
  if (!file) {
    throw new ContractDownloadRequestError(
      "所选文件不在此下载申请中",
      404,
      "CONTRACT_DOWNLOAD_REQUEST_FILE_NOT_FOUND",
    );
  }
  return {
    absolutePath: absoluteSnapshotFilePath(
      file.file_path_snapshot,
      file.file_hash_snapshot,
      file.file_name_snapshot,
    ),
    fileName: file.file_name_snapshot,
    mimeType: file.mime_type_snapshot,
  };
}

export async function prepareApprovedContractFileDownload(
  actor: ContractDownloadActor,
  requestId: string,
  requestFileId: string,
): Promise<PreparedContractDownloadFile> {
  if (!isContractDownloadAdminRole(actor.role)) {
    throw new ContractDownloadRequestError(
      "仅管理员可以执行已批准的合同文件下载任务",
      403,
      "CONTRACT_DOWNLOAD_ADMIN_ONLY",
    );
  }
  let prepared: PreparedContractDownloadFile | null = null;
  await db.transaction(async (client) => {
    const request = await loadRequest(client, requestId, true);
    if (
      !(["approved", "processing"] as const).includes(
        request.status as "approved" | "processing",
      )
    ) {
      throw new ContractDownloadRequestError(
        "仅已批准或执行中的申请可以下载指定文件",
        409,
        "CONTRACT_DOWNLOAD_REQUEST_NOT_APPROVED",
      );
    }
    if (request.target_executor_id !== actor.id) {
      throw new ContractDownloadRequestError(
        `此任务已指定由管理员 ${request.target_executor_name_snapshot} 执行`,
        403,
        "CONTRACT_DOWNLOAD_EXECUTOR_MISMATCH",
      );
    }
    const actorInfo = await actorSnapshot(client, actor.id, true);
    if (!isContractDownloadAdminRole(actorInfo.role)) {
      throw new ContractDownloadRequestError("当前账号已无管理员权限", 403);
    }
    const fileResult = await client.query<DownloadRequestFileRow>(
      `SELECT * FROM contract_download_request_files
       WHERE id = $1 AND request_id = $2
       LIMIT 1 FOR UPDATE`,
      [requestFileId, request.id],
    );
    const file = fileResult.rows[0];
    if (!file) {
      throw new ContractDownloadRequestError(
        "所选文件不在此下载申请中",
        403,
        "UNSELECTED_CONTRACT_FILE_FORBIDDEN",
      );
    }
    const absolutePath = absoluteSnapshotFilePath(
      file.file_path_snapshot,
      file.file_hash_snapshot,
      file.file_name_snapshot,
    );
    const now = new Date().toISOString();
    if (request.status === "approved") {
      await client.query(
        `UPDATE contract_download_requests SET
           status = 'processing', executor_id = $2,
           executor_name_snapshot = $3, executor_position_snapshot = $4,
           processing_started_at = $5, updated_at = $5, version = version + 1
         WHERE id = $1`,
        [request.id, actorInfo.id, actorInfo.name, "管理员", now],
      );
    } else if (request.executor_id && request.executor_id !== actorInfo.id) {
      throw new ContractDownloadRequestError(
        `此任务已由管理员 ${request.executor_name_snapshot || "其他管理员"} 开始执行`,
        409,
        "CONTRACT_DOWNLOAD_TASK_CLAIMED",
      );
    }
    prepared = {
      absolutePath,
      fileName: file.file_name_snapshot,
      mimeType: file.mime_type_snapshot,
    };
  });
  if (!prepared) {
    throw new ContractDownloadRequestError("准备下载文件失败", 500);
  }
  return prepared;
}

/**
 * 仅在响应文件成功传输后记录下载事实。这样网络中断不会把文件错误标记为
 * 已下载，也不会提前放开“标记已处理”的门禁。
 */
export async function markApprovedContractFileDownloaded(
  actor: ContractDownloadActor,
  requestId: string,
  requestFileId: string,
): Promise<void> {
  if (!isContractDownloadAdminRole(actor.role)) {
    throw new ContractDownloadRequestError("仅管理员可以记录下载执行结果", 403);
  }
  await db.transaction(async (client) => {
    const request = await loadRequest(client, requestId, true);
    if (request.status !== "processing" || request.executor_id !== actor.id) {
      throw new ContractDownloadRequestError(
        "当前管理员未认领此下载任务或任务状态已变化",
        409,
        "CONTRACT_DOWNLOAD_TASK_NOT_CLAIMED",
      );
    }
    const actorInfo = await actorSnapshot(client, actor.id, true);
    const fileResult = await client.query<DownloadRequestFileRow>(
      `SELECT * FROM contract_download_request_files
       WHERE id = $1 AND request_id = $2
       LIMIT 1 FOR UPDATE`,
      [requestFileId, request.id],
    );
    const file = fileResult.rows[0];
    if (!file) {
      throw new ContractDownloadRequestError(
        "所选文件不在此下载申请中",
        403,
        "UNSELECTED_CONTRACT_FILE_FORBIDDEN",
      );
    }
    const now = new Date().toISOString();
    await client.query(
      `UPDATE contract_download_request_files SET
         downloaded_by = $2, downloaded_at = $3
       WHERE id = $1`,
      [file.id, actorInfo.id, now],
    );
    await insertAudit(client, {
      requestId: request.id,
      action: "download_file",
      actor: { ...actorInfo, position: "管理员" },
      fromStatus: "processing",
      toStatus: "processing",
      comment: null,
      metadata: {
        requestFileId: file.id,
        contractFileId: file.contract_file_id,
        fileName: file.file_name_snapshot,
      },
      createdAt: now,
    });
  });
}

export async function completeContractDownloadRequest(
  actor: ContractDownloadActor,
  requestId: string,
  rawNote: unknown,
  expectedVersion: number,
): Promise<ContractDownloadRequestApi> {
  if (!isContractDownloadAdminRole(actor.role)) {
    throw new ContractDownloadRequestError(
      "仅管理员可以标记合同下载申请已处理",
      403,
      "CONTRACT_DOWNLOAD_ADMIN_ONLY",
    );
  }
  const note = optionalText(rawNote, "处理说明", 1000);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ContractDownloadRequestError("申请版本不正确");
  }
  await db.transaction(async (client) => {
    const request = await loadRequest(client, requestId, true);
    if (request.status !== "processing") {
      throw new ContractDownloadRequestError(
        "必须先下载申请中指定的文件，才能标记已处理",
        409,
        "CONTRACT_DOWNLOAD_FILES_NOT_DOWNLOADED",
      );
    }
    if (request.target_executor_id !== actor.id) {
      throw new ContractDownloadRequestError(
        `此任务已指定由管理员 ${request.target_executor_name_snapshot} 执行`,
        403,
        "CONTRACT_DOWNLOAD_EXECUTOR_MISMATCH",
      );
    }
    if (request.version !== expectedVersion) {
      throw new ContractDownloadRequestError(
        "申请已发生变化，请刷新后重试",
        409,
        "CONTRACT_DOWNLOAD_REQUEST_VERSION_CONFLICT",
      );
    }
    if (request.executor_id && request.executor_id !== actor.id) {
      throw new ContractDownloadRequestError(
        `此任务已由管理员 ${request.executor_name_snapshot || "其他管理员"} 执行`,
        409,
        "CONTRACT_DOWNLOAD_TASK_CLAIMED",
      );
    }
    const pending = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM contract_download_request_files
       WHERE request_id = $1 AND downloaded_at IS NULL`,
      [request.id],
    );
    if (Number(pending.rows[0]?.count || 0) > 0) {
      throw new ContractDownloadRequestError(
        "申请中仍有指定文件尚未下载，不能标记已处理",
        409,
        "CONTRACT_DOWNLOAD_FILES_NOT_DOWNLOADED",
      );
    }
    const actorInfo = await actorSnapshot(client, actor.id, true);
    const now = new Date().toISOString();
    await client.query(
      `UPDATE contract_download_requests SET
         status = 'completed', executor_id = $2,
         executor_name_snapshot = $3, executor_position_snapshot = '管理员',
         processing_note = $4, completed_at = $5,
         updated_at = $5, version = version + 1
       WHERE id = $1`,
      [request.id, actorInfo.id, actorInfo.name, note || null, now],
    );
    await insertAudit(client, {
      requestId: request.id,
      action: "complete",
      actor: { ...actorInfo, position: "管理员" },
      fromStatus: "processing",
      toStatus: "completed",
      comment: note || null,
      createdAt: now,
    });
  });
  return getContractDownloadRequest(actor, requestId);
}

export async function prepareContractDownloadApplicationPreview(
  actor: ContractDownloadActor,
  requestId: string,
): Promise<PreparedContractDownloadFile> {
  const request = await loadRequest(pool, requestId);
  assertRequestReadAccess(actor, request);
  const storedPath =
    request.status !== "pending_approval" &&
    request.approved_application_file_path
      ? request.approved_application_file_path
      : request.application_file_path;
  const expectedHash =
    request.status !== "pending_approval" &&
    request.approved_application_file_hash
      ? request.approved_application_file_hash
      : request.application_file_hash;
  return {
    absolutePath: absoluteSnapshotFilePath(
      storedPath,
      expectedHash,
      "合同文件下载申请单",
    ),
    fileName: request.application_file_name,
    mimeType: "application/pdf",
  };
}
