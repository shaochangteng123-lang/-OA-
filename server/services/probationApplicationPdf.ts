import fs from "fs";
import path from "path";
import { createCanvas } from "canvas";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";

const TEMPLATE_WIDTH = 595.3;
const TEMPLATE_HEIGHT = 841.9;
const RASTER_SCALE = 3;
const TEMPLATE_BODY_FONT_SIZE = 13;
const CONCLUSION_DATE_TOP = 737;
const FONT_FAMILY =
  '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';

export type ProbationConversionType = "normal" | "early" | "extended" | "other";
export type ProbationReviewStage =
  | "employee"
  | "supervisor"
  | "hr"
  | "general_manager";

export interface ProbationPdfSignature {
  stage: ProbationReviewStage;
  signerName: string;
  signedAt: string;
  signaturePath: string;
  opinion: string | null;
}

export interface ProbationApplicationPdfData {
  applicantName: string;
  department: string;
  position: string;
  hireDate: string;
  conversionType: ProbationConversionType;
  conversionTypeOther: string | null;
  selfStatement: string;
  signatures: ProbationPdfSignature[];
}

interface TextBox {
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle";
  lineHeight?: number;
  padding?: number;
  maxLines?: number;
  fontWeight?: "normal" | "bold";
  singleLineFit?: "shrink" | "compress";
}

interface DateParts {
  year: string;
  month: string;
  day: string;
}

function dateParts(value: string): DateParts {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return {
      year: dateOnly[1],
      month: String(Number(dateOnly[2])),
      day: String(Number(dateOnly[3])),
    };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("转正申请单日期格式不正确");
  }
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(parsed);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: values.get("year") || "",
    month: values.get("month") || "",
    day: values.get("day") || "",
  };
}

function splitTextLines(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    let line = "";
    for (const character of Array.from(paragraph)) {
      const candidate = `${line}${character}`;
      if (line && context.measureText(candidate).width > maxWidth) {
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

function estimateSingleLineWidth(text: string, fontSize: number): number {
  const visualLength = Array.from(text).reduce(
    (total, character) =>
      total + ((character.codePointAt(0) || 0) <= 0x7f ? 0.55 : 1),
    0,
  );
  return visualLength * fontSize;
}

function renderTextPng(text: string, box: TextBox): Buffer {
  const canvas = createCanvas(
    Math.max(1, Math.ceil(box.width * RASTER_SCALE)),
    Math.max(1, Math.ceil(box.height * RASTER_SCALE)),
  );
  const context = canvas.getContext("2d");
  const padding = (box.padding ?? 2) * RASTER_SCALE;
  const contentWidth = canvas.width - padding * 2;
  const contentHeight = canvas.height - padding * 2;
  let fontSize = box.fontSize * RASTER_SCALE;
  const fontWeight = box.fontWeight || "normal";

  context.fillStyle = "#000";
  context.textBaseline = "top";

  const applyFont = () => {
    context.font = `${fontWeight} ${fontSize}px ${FONT_FAMILY}`;
  };
  applyFont();

  const isSingleLine = !text.includes("\n") && (box.maxLines ?? 1) === 1;
  let horizontalScale = 1;
  if (isSingleLine && box.singleLineFit === "compress") {
    const measuredWidth = Math.max(
      context.measureText(text).width,
      estimateSingleLineWidth(text, fontSize),
    );
    horizontalScale = Math.min(
      1,
      Math.max(1, contentWidth - 2 * RASTER_SCALE) / Math.max(1, measuredWidth),
    );
  } else if (isSingleLine) {
    while (
      fontSize > 7 * RASTER_SCALE &&
      context.measureText(text).width > contentWidth
    ) {
      fontSize -= 0.5 * RASTER_SCALE;
      applyFont();
    }
  }

  const lineHeight = (box.lineHeight || box.fontSize * 1.45) * RASTER_SCALE;
  const lines = (
    isSingleLine ? [text] : splitTextLines(context, text, contentWidth)
  ).slice(0, box.maxLines || 99);
  const totalHeight = lines.length * lineHeight;
  const startY =
    box.verticalAlign === "middle"
      ? padding + Math.max(0, (contentHeight - totalHeight) / 2)
      : padding;

  lines.forEach((line, index) => {
    const measured = context.measureText(line).width;
    const y = startY + index * lineHeight;
    if (horizontalScale < 1) {
      const sourceWidth = Math.ceil(
        Math.max(measured, estimateSingleLineWidth(line, fontSize)) +
          4 * RASTER_SCALE,
      );
      const sourceCanvas = createCanvas(
        Math.max(1, sourceWidth),
        Math.max(1, Math.ceil(lineHeight)),
      );
      const sourceContext = sourceCanvas.getContext("2d");
      sourceContext.fillStyle = "#000";
      sourceContext.textBaseline = "top";
      sourceContext.font = context.font;
      sourceContext.fillText(line, 2 * RASTER_SCALE, 0);

      const targetWidth = Math.max(1, contentWidth - 2 * RASTER_SCALE);
      const targetX =
        box.align === "center"
          ? padding + (contentWidth - targetWidth) / 2
          : box.align === "right"
            ? padding + contentWidth - targetWidth
            : padding;
      context.drawImage(
        sourceCanvas,
        0,
        0,
        sourceCanvas.width,
        sourceCanvas.height,
        targetX,
        y,
        targetWidth,
        sourceCanvas.height,
      );
      return;
    }

    let x = padding;
    if (box.align === "center")
      x = padding + Math.max(0, (contentWidth - measured) / 2);
    if (box.align === "right")
      x = padding + Math.max(0, contentWidth - measured);
    context.fillText(line, x, y);
  });

  return canvas.toBuffer("image/png");
}

async function drawText(
  document: PDFDocument,
  page: PDFPage,
  text: string | null | undefined,
  box: TextBox,
): Promise<void> {
  if (!text) return;
  const image = await document.embedPng(renderTextPng(text, box));
  const scaleX = page.getWidth() / TEMPLATE_WIDTH;
  const scaleY = page.getHeight() / TEMPLATE_HEIGHT;
  page.drawImage(image, {
    x: box.x * scaleX,
    y: page.getHeight() - (box.top + box.height) * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  });
}

async function drawSignature(
  document: PDFDocument,
  page: PDFPage,
  signaturePath: string,
  box: Pick<TextBox, "x" | "top" | "width" | "height">,
): Promise<void> {
  const signature = await document.embedPng(fs.readFileSync(signaturePath));
  const scaleX = page.getWidth() / TEMPLATE_WIDTH;
  const scaleY = page.getHeight() / TEMPLATE_HEIGHT;
  const fitted = signature.scaleToFit(box.width * scaleX, box.height * scaleY);
  page.drawImage(signature, {
    x: box.x * scaleX + (box.width * scaleX - fitted.width) / 2,
    y:
      page.getHeight() -
      (box.top + box.height) * scaleY +
      (box.height * scaleY - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height,
  });
}

async function drawDate(
  document: PDFDocument,
  page: PDFPage,
  value: string,
  top: number,
): Promise<void> {
  const parts = dateParts(value);
  await Promise.all([
    drawText(document, page, parts.year, {
      x: 386,
      top,
      width: 33,
      height: 17,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
      padding: 0,
    }),
    drawText(document, page, parts.month, {
      x: 433,
      top,
      width: 20,
      height: 17,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
      padding: 0,
    }),
    drawText(document, page, parts.day, {
      x: 468,
      top,
      width: 20,
      height: 17,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
      padding: 0,
    }),
  ]);
}

function signatureFor(
  signatures: ProbationPdfSignature[],
  stage: ProbationReviewStage,
): ProbationPdfSignature {
  const signature = signatures.find((item) => item.stage === stage);
  if (!signature) throw new Error(`转正申请单缺少${stage}签名`);
  return signature;
}

function drawCheckMark(page: PDFPage, x: number, top: number): void {
  const scaleX = page.getWidth() / TEMPLATE_WIDTH;
  const scaleY = page.getHeight() / TEMPLATE_HEIGHT;
  const point = (offsetX: number, offsetY: number) => ({
    x: (x + offsetX) * scaleX,
    y: page.getHeight() - (top + offsetY) * scaleY,
  });

  page.drawLine({
    start: point(1.8, 6.2),
    end: point(4.4, 9),
    thickness: 1.15 * Math.min(scaleX, scaleY),
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: point(4.4, 9),
    end: point(9, 1.8),
    thickness: 1.15 * Math.min(scaleX, scaleY),
    color: rgb(0, 0, 0),
  });
}

export async function generateProbationApplicationPdf(
  templatePath: string,
  outputPath: string,
  data: ProbationApplicationPdfData,
): Promise<void> {
  const document = await PDFDocument.load(fs.readFileSync(templatePath));
  if (document.getPageCount() !== 1) {
    throw new Error("转正申请单模板必须为单页 PDF");
  }
  const page = document.getPage(0);

  const employeeSignature = signatureFor(data.signatures, "employee");
  const supervisorSignature = signatureFor(data.signatures, "supervisor");
  const hrSignature = signatureFor(data.signatures, "hr");
  const gmSignature = signatureFor(data.signatures, "general_manager");

  await Promise.all([
    drawText(document, page, data.applicantName, {
      x: 150,
      top: 123,
      width: 81,
      height: 39,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
    }),
    drawText(document, page, data.department, {
      x: 294,
      top: 123,
      width: 81,
      height: 39,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
    }),
    drawText(document, page, data.position, {
      x: 438,
      top: 123,
      width: 72,
      height: 39,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
      padding: 7,
      singleLineFit: "compress",
    }),
    drawText(
      document,
      page,
      `${dateParts(data.hireDate).year}年${dateParts(data.hireDate).month}月${dateParts(data.hireDate).day}日`,
      {
        x: 150,
        top: 162,
        width: 81,
        height: 40,
        fontSize: TEMPLATE_BODY_FONT_SIZE,
        align: "center",
        verticalAlign: "middle",
        maxLines: 1,
        padding: 1,
        singleLineFit: "compress",
      },
    ),
    drawText(
      document,
      page,
      `${dateParts(employeeSignature.signedAt).year}年${dateParts(employeeSignature.signedAt).month}月${dateParts(employeeSignature.signedAt).day}日`,
      {
        x: 294,
        top: 162,
        width: 81,
        height: 40,
        fontSize: TEMPLATE_BODY_FONT_SIZE,
        align: "center",
        verticalAlign: "middle",
        maxLines: 1,
        padding: 1,
        singleLineFit: "compress",
      },
    ),
    drawText(document, page, data.position, {
      x: 438,
      top: 162,
      width: 72,
      height: 40,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
      padding: 7,
      singleLineFit: "compress",
    }),
    drawText(document, page, data.selfStatement, {
      x: 158,
      top: 250,
      width: 343,
      height: 125,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      lineHeight: 16,
      align: "left",
      verticalAlign: "top",
      maxLines: 7,
      padding: 2,
    }),
    drawText(document, page, supervisorSignature.opinion, {
      x: 158,
      top: 420,
      width: 343,
      height: 45,
      fontSize: 10,
      lineHeight: 14,
      align: "left",
      verticalAlign: "top",
      maxLines: 3,
      padding: 2,
    }),
    drawText(document, page, hrSignature.opinion, {
      x: 158,
      top: 502,
      width: 343,
      height: 45,
      fontSize: 10,
      lineHeight: 14,
      align: "left",
      verticalAlign: "top",
      maxLines: 3,
      padding: 2,
    }),
    drawText(document, page, gmSignature.opinion, {
      x: 158,
      top: 584,
      width: 343,
      height: 45,
      fontSize: 10,
      lineHeight: 14,
      align: "left",
      verticalAlign: "top",
      maxLines: 3,
      padding: 2,
    }),
    drawText(document, page, data.applicantName, {
      x: 342,
      top: 663,
      width: 62,
      height: 18,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
      padding: 0,
      singleLineFit: "compress",
    }),
    drawText(document, page, data.position, {
      x: 168,
      top: 686,
      width: 59,
      height: 18,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
      padding: 0,
      singleLineFit: "compress",
    }),
    drawText(document, page, data.position, {
      x: 265,
      top: 686,
      width: 72,
      height: 18,
      fontSize: TEMPLATE_BODY_FONT_SIZE,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
      padding: 0,
      singleLineFit: "compress",
    }),
  ]);

  const conversionTypeX: Record<ProbationConversionType, number> = {
    normal: 161,
    early: 246,
    extended: 331,
    other: 416,
  };
  drawCheckMark(page, conversionTypeX[data.conversionType], 217);
  if (data.conversionType === "other") {
    await drawText(document, page, data.conversionTypeOther, {
      x: 455,
      top: 214,
      width: 49,
      height: 17,
      fontSize: 9,
      align: "center",
      verticalAlign: "middle",
      maxLines: 1,
      padding: 0,
    });
  }

  const signatureRows = [
    { signature: employeeSignature, top: 379, dateTop: 392 },
    { signature: supervisorSignature, top: 461, dateTop: 470 },
    { signature: hrSignature, top: 543, dateTop: 552 },
    { signature: gmSignature, top: 625, dateTop: 634 },
  ];
  for (const row of signatureRows) {
    await drawSignature(document, page, row.signature.signaturePath, {
      x: 255,
      top: row.top,
      width: 78,
      height: 30,
    });
    await drawDate(document, page, row.signature.signedAt, row.dateTop);
  }

  await drawDate(document, page, gmSignature.signedAt, CONCLUSION_DATE_TOP);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, await document.save());
}
