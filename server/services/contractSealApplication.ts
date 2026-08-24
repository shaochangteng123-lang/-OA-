import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "canvas";
import { PDFDocument } from "pdf-lib";
import type { PoolClient } from "pg";
import { normalizeSignaturePng } from "../utils/electronic-signature.js";
import { validateFilePath } from "../utils/file-validation.js";
import {
  ensureDatedUploadDirectory,
  toStoredUploadPath,
} from "../utils/upload-date.js";
export { extractContractSealCopyCount } from "./contractSealCopyCount.js";

export const CONTRACT_SEAL_TYPES = ["company", "contract"] as const;

export type ContractSealType = (typeof CONTRACT_SEAL_TYPES)[number];

export interface ContractSealApplicationEditableFields {
  sealPurpose: string;
  sealType: ContractSealType;
  copyCount: number;
  crossPageSeal: boolean;
  note: string;
}

export interface ContractSealApplicationContractSnapshot {
  contractNo: string;
  contractTitle: string | null;
  partyA: string;
  partyB: string;
  projectName: string | null;
  amount: string | null;
  categoryLabel: string;
  relationLabel: string;
  area: string;
}

export interface ContractSealApplicationInput {
  contractId: string;
  contractVersion: number;
  formVersion: number;
  actorId: string;
  contract: ContractSealApplicationContractSnapshot;
  fields: ContractSealApplicationEditableFields;
  signedAt?: Date;
}

export interface ContractSealApplicationSignerSnapshot {
  id: string;
  name: string;
  role: string;
  department: string | null;
  position: string | null;
  signatureType: "personal";
  signaturePath: string;
  signatureAbsolutePath: string;
  signedAt: string;
}

export interface ContractSealApplicationFileMetadata {
  fileName: string;
  filePath: string;
  absolutePath: string;
  fileSize: number;
  mimeType: "application/pdf";
  fileHash: string;
}

export interface ContractSealApplicationArtifact {
  contractId: string;
  contractVersion: number;
  formVersion: number;
  fields: ContractSealApplicationEditableFields;
  contract: ContractSealApplicationContractSnapshot;
  signer: ContractSealApplicationSignerSnapshot;
  file: ContractSealApplicationFileMetadata;
}

export interface ContractSealApplicationApprovalInput {
  contractId: string;
  applicationId: string;
  formVersion: number;
  approvalRoundId: string;
  actorId: string;
  contractNo: string;
  originalFile: {
    filePath: string;
    fileHash: string;
    fileName: string;
  };
  applicant: {
    name: string;
    role: string;
    signaturePath: string;
    signedAt: string | Date;
  };
  approvedAt?: Date;
}

export interface ContractSealApplicationApprovalArtifact {
  contractId: string;
  applicationId: string;
  formVersion: number;
  approvalRoundId: string;
  originalFileHash: string;
  approver: {
    id: string;
    name: string;
    role: string;
    signaturePath: string;
    signatureAbsolutePath: string;
    signatureHash: string;
    signedAt: string;
  };
  file: ContractSealApplicationFileMetadata;
}

export class ContractSealApplicationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = "CONTRACT_SEAL_APPLICATION_INVALID",
  ) {
    super(message);
    this.name = "ContractSealApplicationError";
  }
}

interface ActorRow {
  id: string;
  name: string;
  role: string;
  department: string | null;
  position: string | null;
}

interface SignatureRow {
  signature_path: string;
}

const PAGE_WIDTH = 595.3;
const PAGE_HEIGHT = 841.9;
const PAGE_DIMENSION_TOLERANCE = 0.5;
const RENDER_SCALE = 2;
const SIGNATURE_SECTION_Y = 704;
const SIGNATURE_SECTION_HEIGHT = 105;
const SIGNATURE_COLUMN_WIDTH = 248;
const APPLICANT_SIGNATURE_X = 42;
const APPROVER_SIGNATURE_X = 305;
const SINGLE_PAGE_APPROVER_SLOT_MARKER =
  "yulilog-contract-seal-application-single-page-v1";
const FONT_FAMILY =
  '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';

function requiredText(value: unknown, label: string, maximum: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new ContractSealApplicationError(`${label}不能为空`);
  }
  if (normalized.length > maximum) {
    throw new ContractSealApplicationError(
      `${label}不能超过 ${maximum} 个字符`,
    );
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maximum: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length > maximum) {
    throw new ContractSealApplicationError(
      `${label}不能超过 ${maximum} 个字符`,
    );
  }
  return normalized;
}

export function normalizeContractSealApplicationFields(
  fields: ContractSealApplicationEditableFields,
): ContractSealApplicationEditableFields {
  const sealType = fields?.sealType;
  if (!(CONTRACT_SEAL_TYPES as readonly string[]).includes(sealType)) {
    throw new ContractSealApplicationError("请选择正确的印章类型");
  }
  const copyCount = Number(fields?.copyCount);
  if (!Number.isInteger(copyCount) || copyCount < 1 || copyCount > 20) {
    throw new ContractSealApplicationError("用印份数必须是 1 至 20 的整数");
  }
  return {
    sealPurpose: requiredText(fields?.sealPurpose, "用印事由", 500),
    sealType,
    copyCount,
    crossPageSeal: fields?.crossPageSeal === true,
    note: optionalText(fields?.note, "特殊说明", 1000),
  };
}

function normalizeContractSnapshot(
  contract: ContractSealApplicationContractSnapshot,
): ContractSealApplicationContractSnapshot {
  return {
    contractNo: requiredText(contract?.contractNo, "合同编号", 100),
    contractTitle:
      optionalText(contract?.contractTitle, "合同名称", 300) || null,
    partyA: requiredText(contract?.partyA, "甲方单位", 300),
    partyB: requiredText(contract?.partyB, "乙方单位", 300),
    projectName: optionalText(contract?.projectName, "项目名称", 500) || null,
    amount: optionalText(contract?.amount, "合同金额", 100) || null,
    categoryLabel: requiredText(contract?.categoryLabel, "合同分类", 100),
    relationLabel: requiredText(contract?.relationLabel, "合同关系", 100),
    area: requiredText(contract?.area, "所属区域", 100),
  };
}

function absoluteStoredPath(storedPath: string): string {
  if (!validateFilePath(storedPath)) {
    throw new ContractSealApplicationError(
      "个人电子签名文件路径不正确，请联系系统管理员处理",
      409,
      "PERSONAL_SIGNATURE_FILE_INVALID",
    );
  }
  return path.resolve(process.cwd(), storedPath.replace(/^[/\\]+/, ""));
}

function resolveControlledUploadFile(
  storedPath: string,
  label: string,
  invalidCode: string,
  missingCode: string,
): string {
  if (!validateFilePath(storedPath)) {
    throw new ContractSealApplicationError(
      `${label}路径不正确，请联系系统管理员处理`,
      409,
      invalidCode,
    );
  }
  const absolutePath = path.resolve(
    process.cwd(),
    storedPath.replace(/^[/\\]+/, ""),
  );
  let isFile = false;
  try {
    isFile = fs.statSync(absolutePath).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new ContractSealApplicationError(
      `${label}不存在，请联系系统管理员处理`,
      409,
      missingCode,
    );
  }
  return absolutePath;
}

async function loadActorAndSignature(
  client: Pick<PoolClient, "query">,
  actorId: string,
): Promise<{ actor: ActorRow; signatureBuffer: Buffer }> {
  const actorResult = await client.query<ActorRow>(
    `SELECT u.id, u.name, u.role, ep.department, ep.position
     FROM users u
     LEFT JOIN employee_profiles ep ON ep.user_id = u.id
     WHERE u.id = $1 AND u.status = 'active'
     LIMIT 1
     FOR SHARE OF u`,
    [actorId],
  );
  const actor = actorResult.rows[0];
  if (!actor) {
    throw new ContractSealApplicationError(
      "当前签署账号不存在或已停用",
      401,
      "CONTRACT_SEAL_SIGNER_UNAVAILABLE",
    );
  }

  const signatureResult = await client.query<SignatureRow>(
    `SELECT signature_path
     FROM user_signatures
     WHERE user_id = $1
     FOR SHARE`,
    [actorId],
  );
  const signature = signatureResult.rows[0];
  if (!signature) {
    throw new ContractSealApplicationError(
      "请先在个人设置上传并锁定本人电子签名",
      409,
      "PERSONAL_SIGNATURE_REQUIRED",
    );
  }
  const signaturePath = absoluteStoredPath(signature.signature_path);
  if (!fs.existsSync(signaturePath)) {
    throw new ContractSealApplicationError(
      "个人电子签名文件不存在，请联系系统管理员处理",
      409,
      "PERSONAL_SIGNATURE_FILE_MISSING",
    );
  }
  return {
    actor,
    signatureBuffer: await normalizeSignaturePng(
      fs.readFileSync(signaturePath),
    ),
  };
}

function shanghaiDateParts(value: Date): {
  year: string;
  month: string;
  day: string;
} {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: values.get("year") || "",
    month: values.get("month") || "",
    day: values.get("day") || "",
  };
}

function displayDate(value: Date): string {
  const parts = shanghaiDateParts(value);
  return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日`;
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

function validDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ContractSealApplicationError(`${label}不正确`);
  }
  return date;
}

function wrappedLines(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  value: string,
  maximumWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r\n/g, "\n").split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of Array.from(paragraph)) {
      const candidate = `${line}${character}`;
      if (line && context.measureText(candidate).width > maximumWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawText(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  value: string | null | undefined,
  x: number,
  y: number,
  width: number,
  options: {
    fontSize?: number;
    weight?: "normal" | "bold";
    color?: string;
    lineHeight?: number;
    maximumLines?: number;
    align?: "left" | "center" | "right";
  } = {},
): void {
  const text = value?.trim() || "—";
  const fontSize = (options.fontSize || 12) * RENDER_SCALE;
  const lineHeight =
    (options.lineHeight || (options.fontSize || 12) * 1.55) * RENDER_SCALE;
  context.save();
  context.fillStyle = options.color || "#263238";
  context.font = `${options.weight || "normal"} ${fontSize}px ${FONT_FAMILY}`;
  context.textBaseline = "top";
  const lines = wrappedLines(context, text, width * RENDER_SCALE).slice(
    0,
    options.maximumLines || 99,
  );
  lines.forEach((line, index) => {
    const measured = context.measureText(line).width;
    let drawX = x * RENDER_SCALE;
    if (options.align === "center") {
      drawX += Math.max(0, (width * RENDER_SCALE - measured) / 2);
    } else if (options.align === "right") {
      drawX += Math.max(0, width * RENDER_SCALE - measured);
    }
    context.fillText(line, drawX, y * RENDER_SCALE + index * lineHeight);
  });
  context.restore();
}

function drawRoundedBox(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke = "#dce7e5",
): void {
  context.save();
  context.beginPath();
  context.roundRect(
    x * RENDER_SCALE,
    y * RENDER_SCALE,
    width * RENDER_SCALE,
    height * RENDER_SCALE,
    8 * RENDER_SCALE,
  );
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = RENDER_SCALE;
  context.stroke();
  context.restore();
}

function drawField(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  label: string,
  value: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  drawRoundedBox(context, x, y, width, height, "#ffffff");
  drawText(context, label, x + 12, y + 9, width - 24, {
    fontSize: 9,
    color: "#78909c",
    maximumLines: 1,
  });
  drawText(context, value, x + 12, y + 28, width - 24, {
    fontSize: 11,
    lineHeight: 15,
    maximumLines: Math.max(1, Math.floor((height - 32) / 15)),
  });
}

function signerDisplayName(actor: ActorRow): string {
  return `${actor.name}${actor.position ? ` · ${actor.position}` : ""}`;
}

async function renderApplicationPdf(
  outputPath: string,
  formVersion: number,
  contract: ContractSealApplicationContractSnapshot,
  fields: ContractSealApplicationEditableFields,
  actor: ActorRow,
  signatureBuffer: Buffer,
  signedAt: Date,
): Promise<void> {
  const canvas = createCanvas(
    Math.round(PAGE_WIDTH * RENDER_SCALE),
    Math.round(PAGE_HEIGHT * RENDER_SCALE),
  );
  const context = canvas.getContext("2d");
  context.fillStyle = "#f5faf9";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#0f766e";
  context.fillRect(0, 0, canvas.width, 116 * RENDER_SCALE);
  drawText(context, "合同用印申请单", 42, 36, 510, {
    fontSize: 25,
    weight: "bold",
    color: "#ffffff",
    maximumLines: 1,
  });
  drawText(
    context,
    `${contract.contractNo}  ·  表单版本 V${formVersion}  ·  用印 ${fields.copyCount} 份`,
    44,
    78,
    500,
    { fontSize: 10, color: "#d5f5f0", maximumLines: 1 },
  );

  drawText(context, "合同信息", 42, 140, 200, {
    fontSize: 15,
    weight: "bold",
    color: "#134e4a",
    maximumLines: 1,
  });
  drawField(context, "甲方单位", contract.partyA, 42, 169, 248, 67);
  drawField(context, "乙方单位", contract.partyB, 305, 169, 248, 67);
  drawField(
    context,
    "项目 / 合同名称",
    contract.projectName || contract.contractTitle,
    42,
    248,
    511,
    72,
  );
  drawField(context, "合同金额", contract.amount, 42, 332, 160, 62);
  drawField(context, "合同分类", contract.categoryLabel, 217, 332, 160, 62);
  drawField(
    context,
    "合同关系 / 区域",
    `${contract.relationLabel} · ${contract.area}`,
    392,
    332,
    161,
    62,
  );

  drawText(context, "用印信息", 42, 422, 200, {
    fontSize: 15,
    weight: "bold",
    color: "#134e4a",
    maximumLines: 1,
  });
  drawField(
    context,
    "印章与份数",
    `${fields.sealType === "company" ? "公司公章" : "合同专用章"} · ${fields.copyCount} 份${fields.crossPageSeal ? " · 加盖骑缝章" : ""}`,
    42,
    451,
    511,
    58,
  );
  drawField(context, "用印事由", fields.sealPurpose, 42, 521, 511, 92);
  drawField(context, "特殊说明", fields.note || "无", 42, 625, 511, 68);

  drawRoundedBox(
    context,
    APPLICANT_SIGNATURE_X,
    SIGNATURE_SECTION_Y,
    SIGNATURE_COLUMN_WIDTH,
    SIGNATURE_SECTION_HEIGHT,
    "#e9f6f3",
    "#b6d8d2",
  );
  drawText(context, "申请人签署", 55, 716, 100, {
    fontSize: 10,
    weight: "bold",
    color: "#0f766e",
    maximumLines: 1,
  });
  drawText(context, signerDisplayName(actor), 55, 739, 92, {
    fontSize: 9,
    lineHeight: 13,
    maximumLines: 2,
  });
  await drawSignature(context, signatureBuffer, 158, 735, 116, 39);
  drawText(context, `申请时间：${displayDate(signedAt)}`, 55, 785, 220, {
    fontSize: 8,
    color: "#52716d",
    maximumLines: 1,
    align: "center",
  });

  drawRoundedBox(
    context,
    APPROVER_SIGNATURE_X,
    SIGNATURE_SECTION_Y,
    SIGNATURE_COLUMN_WIDTH,
    SIGNATURE_SECTION_HEIGHT,
    "#ffffff",
    "#b6d8d2",
  );
  drawText(context, "总经理审批签署", 318, 716, 130, {
    fontSize: 10,
    weight: "bold",
    color: "#0f766e",
    maximumLines: 1,
  });
  drawText(context, "待审批", 469, 716, 70, {
    fontSize: 9,
    color: "#8a9a97",
    maximumLines: 1,
    align: "right",
  });
  drawText(context, "预留审批人本人电子签名区域", 318, 746, 222, {
    fontSize: 10,
    color: "#52716d",
    maximumLines: 1,
    align: "center",
  });
  drawText(context, "审批通过后自动写入签名和时间", 318, 780, 222, {
    fontSize: 8,
    color: "#8a9a97",
    maximumLines: 1,
    align: "center",
  });

  const document = await PDFDocument.create();
  document.setSubject(SINGLE_PAGE_APPROVER_SLOT_MARKER);
  document.setKeywords([SINGLE_PAGE_APPROVER_SLOT_MARKER]);
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const image = await document.embedPng(canvas.toBuffer("image/png"));
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  });
  fs.writeFileSync(outputPath, await document.save());
}

async function drawSignature(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  signatureBuffer: Buffer,
  x: number,
  y: number,
  maximumWidth: number,
  maximumHeight: number,
): Promise<void> {
  const signatureImage = await loadImage(signatureBuffer);
  const scale = Math.min(
    (maximumWidth * RENDER_SCALE) / signatureImage.width,
    (maximumHeight * RENDER_SCALE) / signatureImage.height,
    1,
  );
  context.drawImage(
    signatureImage,
    x * RENDER_SCALE,
    y * RENDER_SCALE,
    signatureImage.width * scale,
    signatureImage.height * scale,
  );
}

async function renderApprovalSignature(
  originalPdfBuffer: Buffer,
  outputPath: string,
  input: {
    approver: ActorRow;
    approverSignatureBuffer: Buffer;
    approvedAt: Date;
  },
): Promise<void> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(originalPdfBuffer);
  } catch {
    throw new ContractSealApplicationError(
      "原用印申请单不是有效的 PDF 文件，无法完成审批签署",
      409,
      "CONTRACT_SEAL_ORIGINAL_PDF_INVALID",
    );
  }
  if (document.getPageCount() !== 1) {
    throw new ContractSealApplicationError(
      "原用印申请单必须为系统生成的单页文件，无法完成审批签署",
      409,
      "CONTRACT_SEAL_ORIGINAL_PDF_INVALID",
    );
  }
  if (document.getSubject() !== SINGLE_PAGE_APPROVER_SLOT_MARKER) {
    throw new ContractSealApplicationError(
      "原用印申请单未预留总经理签署区域，请重新生成用印申请单后提交审批",
      409,
      "CONTRACT_SEAL_APPROVER_SLOT_MISSING",
    );
  }
  const page = document.getPage(0);
  const pageSize = page.getSize();
  if (
    Math.abs(pageSize.width - PAGE_WIDTH) > PAGE_DIMENSION_TOLERANCE ||
    Math.abs(pageSize.height - PAGE_HEIGHT) > PAGE_DIMENSION_TOLERANCE ||
    page.getRotation().angle !== 0
  ) {
    throw new ContractSealApplicationError(
      "原用印申请单页面尺寸或方向不符合单页审批栏模板，请重新生成后提交审批",
      409,
      "CONTRACT_SEAL_ORIGINAL_PAGE_LAYOUT_INVALID",
    );
  }

  const canvas = createCanvas(
    Math.round(PAGE_WIDTH * RENDER_SCALE),
    Math.round(PAGE_HEIGHT * RENDER_SCALE),
  );
  const context = canvas.getContext("2d");
  drawRoundedBox(
    context,
    APPROVER_SIGNATURE_X,
    SIGNATURE_SECTION_Y,
    SIGNATURE_COLUMN_WIDTH,
    SIGNATURE_SECTION_HEIGHT,
    "#e9f6f3",
    "#b6d8d2",
  );
  drawText(context, "总经理审批签署", 318, 716, 130, {
    fontSize: 10,
    weight: "bold",
    color: "#0f766e",
    maximumLines: 1,
  });
  drawText(context, "已审批", 469, 716, 70, {
    fontSize: 9,
    color: "#0f766e",
    maximumLines: 1,
    align: "right",
  });
  drawText(context, signerDisplayName(input.approver), 318, 740, 82, {
    fontSize: 10,
    lineHeight: 14,
    maximumLines: 2,
  });
  await drawSignature(
    context,
    input.approverSignatureBuffer,
    409,
    735,
    130,
    40,
  );
  drawText(
    context,
    `审批时间：${displayDateTime(input.approvedAt)}`,
    318,
    785,
    222,
    { fontSize: 8, color: "#52716d", maximumLines: 1, align: "center" },
  );

  const approvalImage = await document.embedPng(canvas.toBuffer("image/png"));
  page.drawImage(approvalImage, {
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  });
  fs.writeFileSync(outputPath, await document.save(), { flag: "wx" });
}

function safeFileSegment(value: string): string {
  return Array.from(value.replace(/[\\/:*?"<>|]/g, "-"))
    .map((character) =>
      (character.codePointAt(0) || 0) < 32 ? "-" : character,
    )
    .join("")
    .slice(0, 120);
}

/**
 * 生成签署后的合同用印申请单。
 *
 * 调用方只提交表单字段，不提交签名图片。本服务始终从当前账号已经锁定的
 * `user_signatures` 记录读取签名，复制为合同表单版本快照后再生成 PDF。
 * 数据库写入失败时，调用方应使用 cleanupContractSealApplicationArtifact
 * 清理返回的两个物理文件。
 */
export async function generateSignedContractSealApplication(
  client: Pick<PoolClient, "query">,
  input: ContractSealApplicationInput,
): Promise<ContractSealApplicationArtifact> {
  const contractId = requiredText(input?.contractId, "合同编号", 100);
  const actorId = requiredText(input?.actorId, "签署人编号", 100);
  const contractVersion = Number(input?.contractVersion);
  const formVersion = Number(input?.formVersion);
  if (!Number.isInteger(contractVersion) || contractVersion < 1) {
    throw new ContractSealApplicationError("合同版本不正确");
  }
  if (!Number.isInteger(formVersion) || formVersion < 1) {
    throw new ContractSealApplicationError("用印申请单版本不正确");
  }
  const fields = normalizeContractSealApplicationFields(input.fields);
  const contract = normalizeContractSnapshot(input.contract);
  const signedAtDate = input.signedAt || new Date();
  if (Number.isNaN(signedAtDate.getTime())) {
    throw new ContractSealApplicationError("签署时间不正确");
  }
  const { actor, signatureBuffer } = await loadActorAndSignature(
    client,
    actorId,
  );

  const outputDirectory = ensureDatedUploadDirectory(
    "contract-seal-applications",
    signedAtDate,
    contractId,
    `v${formVersion}`,
  );
  const artifactId = crypto.randomBytes(9).toString("hex");
  const signatureAbsolutePath = path.join(
    outputDirectory,
    `signature-${artifactId}.png`,
  );
  const pdfAbsolutePath = path.join(
    outputDirectory,
    `application-${artifactId}.pdf`,
  );

  try {
    fs.writeFileSync(signatureAbsolutePath, signatureBuffer, { flag: "wx" });
    await renderApplicationPdf(
      pdfAbsolutePath,
      formVersion,
      contract,
      fields,
      actor,
      signatureBuffer,
      signedAtDate,
    );
    const pdfBuffer = fs.readFileSync(pdfAbsolutePath);
    return {
      contractId,
      contractVersion,
      formVersion,
      fields,
      contract,
      signer: {
        id: actor.id,
        name: actor.name,
        role: actor.role,
        department: actor.department,
        position: actor.position,
        signatureType: "personal",
        signaturePath: toStoredUploadPath(signatureAbsolutePath),
        signatureAbsolutePath,
        signedAt: signedAtDate.toISOString(),
      },
      file: {
        fileName: `${safeFileSegment(contract.contractNo)}-用印申请单.pdf`,
        filePath: toStoredUploadPath(pdfAbsolutePath),
        absolutePath: pdfAbsolutePath,
        fileSize: pdfBuffer.length,
        mimeType: "application/pdf",
        fileHash: crypto.createHash("sha256").update(pdfBuffer).digest("hex"),
      },
    };
  } catch (error) {
    for (const filePath of [pdfAbsolutePath, signatureAbsolutePath]) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // 清理错误不能覆盖实际生成错误。
      }
    }
    throw error;
  }
}

/**
 * 在申请人已经签署的单页用印申请单预留区写入总经理审批签名。
 *
 * 原 PDF 与申请人签名快照只读，且生成前必须通过受控路径、文件存在性和
 * SHA-256 摘要核验。审批人签名只从当前总经理的锁定签名档案读取，并复制
 * 为本轮审批专属快照；生成新的单页双签文件，绝不覆盖原申请单。
 */
export async function generateApprovedContractSealApplication(
  client: Pick<PoolClient, "query">,
  input: ContractSealApplicationApprovalInput,
): Promise<ContractSealApplicationApprovalArtifact> {
  const contractId = requiredText(input?.contractId, "合同编号", 100);
  const applicationId = requiredText(
    input?.applicationId,
    "用印申请单编号",
    100,
  );
  const approvalRoundId = requiredText(
    input?.approvalRoundId,
    "审批轮次编号",
    100,
  );
  const actorId = requiredText(input?.actorId, "审批人编号", 100);
  const contractNo = requiredText(input?.contractNo, "合同编号", 100);
  const formVersion = Number(input?.formVersion);
  if (!Number.isInteger(formVersion) || formVersion < 1) {
    throw new ContractSealApplicationError("用印申请单版本不正确");
  }
  requiredText(input?.originalFile?.fileName, "原用印申请单文件名", 300);
  const expectedOriginalHash = requiredText(
    input?.originalFile?.fileHash,
    "原用印申请单摘要",
    64,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedOriginalHash)) {
    throw new ContractSealApplicationError(
      "原用印申请单摘要格式不正确",
      409,
      "CONTRACT_SEAL_ORIGINAL_HASH_INVALID",
    );
  }
  requiredText(input?.applicant?.name, "申请人姓名", 100);
  requiredText(input?.applicant?.role, "申请人角色", 100);
  validDate(input?.applicant?.signedAt, "申请人签署时间");
  const approvedAtDate = validDate(
    input?.approvedAt || new Date(),
    "审批通过时间",
  );

  const originalAbsolutePath = resolveControlledUploadFile(
    input?.originalFile?.filePath,
    "原用印申请单文件",
    "CONTRACT_SEAL_ORIGINAL_FILE_INVALID",
    "CONTRACT_SEAL_ORIGINAL_FILE_MISSING",
  );
  const originalPdfBuffer = fs.readFileSync(originalAbsolutePath);
  const actualOriginalHash = crypto
    .createHash("sha256")
    .update(originalPdfBuffer)
    .digest("hex");
  if (
    !crypto.timingSafeEqual(
      Buffer.from(actualOriginalHash, "hex"),
      Buffer.from(expectedOriginalHash, "hex"),
    )
  ) {
    throw new ContractSealApplicationError(
      "原用印申请单内容已发生变化，无法完成审批签署",
      409,
      "CONTRACT_SEAL_ORIGINAL_HASH_MISMATCH",
    );
  }

  const applicantSignatureAbsolutePath = resolveControlledUploadFile(
    input?.applicant?.signaturePath,
    "申请人签名快照",
    "CONTRACT_SEAL_APPLICANT_SIGNATURE_INVALID",
    "CONTRACT_SEAL_APPLICANT_SIGNATURE_MISSING",
  );
  try {
    await normalizeSignaturePng(
      fs.readFileSync(applicantSignatureAbsolutePath),
    );
  } catch {
    throw new ContractSealApplicationError(
      "申请人签名快照无法读取，请联系系统管理员处理",
      409,
      "CONTRACT_SEAL_APPLICANT_SIGNATURE_INVALID",
    );
  }

  const { actor, signatureBuffer: approverSignatureBuffer } =
    await loadActorAndSignature(client, actorId);
  if (actor.role !== "general_manager") {
    throw new ContractSealApplicationError(
      "只有当前锁定的总经理可以签署用印申请单审批栏",
      403,
      "CONTRACT_SEAL_GENERAL_MANAGER_SIGNATURE_REQUIRED",
    );
  }

  const outputDirectory = ensureDatedUploadDirectory(
    "contract-seal-applications",
    approvedAtDate,
    contractId,
    `v${formVersion}`,
    "approval",
  );
  const artifactId = crypto.randomBytes(9).toString("hex");
  const approverSignatureAbsolutePath = path.join(
    outputDirectory,
    `approver-signature-${artifactId}.png`,
  );
  const approvedPdfAbsolutePath = path.join(
    outputDirectory,
    `approved-application-${artifactId}.pdf`,
  );

  try {
    fs.writeFileSync(approverSignatureAbsolutePath, approverSignatureBuffer, {
      flag: "wx",
    });
    await renderApprovalSignature(originalPdfBuffer, approvedPdfAbsolutePath, {
      approver: {
        ...actor,
        role: "总经理",
      },
      approverSignatureBuffer,
      approvedAt: approvedAtDate,
    });
    const approvedPdfBuffer = fs.readFileSync(approvedPdfAbsolutePath);
    return {
      contractId,
      applicationId,
      formVersion,
      approvalRoundId,
      originalFileHash: actualOriginalHash,
      approver: {
        id: actor.id,
        name: actor.name,
        role: actor.role,
        signaturePath: toStoredUploadPath(approverSignatureAbsolutePath),
        signatureAbsolutePath: approverSignatureAbsolutePath,
        signatureHash: crypto
          .createHash("sha256")
          .update(approverSignatureBuffer)
          .digest("hex"),
        signedAt: approvedAtDate.toISOString(),
      },
      file: {
        fileName: `${safeFileSegment(contractNo)}-用印申请单-审批签署.pdf`,
        filePath: toStoredUploadPath(approvedPdfAbsolutePath),
        absolutePath: approvedPdfAbsolutePath,
        fileSize: approvedPdfBuffer.length,
        mimeType: "application/pdf",
        fileHash: crypto
          .createHash("sha256")
          .update(approvedPdfBuffer)
          .digest("hex"),
      },
    };
  } catch (error) {
    for (const filePath of [
      approvedPdfAbsolutePath,
      approverSignatureAbsolutePath,
    ]) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // 清理错误不能覆盖实际审批签署错误。
      }
    }
    throw error;
  }
}

export function cleanupContractSealApplicationArtifact(
  artifact: ContractSealApplicationArtifact | null | undefined,
): void {
  if (!artifact) return;
  for (const filePath of [
    artifact.file.absolutePath,
    artifact.signer.signatureAbsolutePath,
  ]) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // 事务失败后的尽力清理不应覆盖原始业务错误。
    }
  }
}

export function cleanupApprovedContractSealApplicationArtifact(
  artifact: ContractSealApplicationApprovalArtifact | null | undefined,
): void {
  if (!artifact) return;
  for (const filePath of [
    artifact.file.absolutePath,
    artifact.approver.signatureAbsolutePath,
  ]) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // 事务失败后的尽力清理不应覆盖原始业务错误。
    }
  }
}
