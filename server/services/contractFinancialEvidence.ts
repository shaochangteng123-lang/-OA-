import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { PDFDocument } from "pdf-lib";

import { assertContractFileStructure } from "./contractFileValidation.js";

const execFileAsync = promisify(execFile);
const MAX_FINANCIAL_PDF_BYTES = 50 * 1024 * 1024;
const MAX_FINANCIAL_RENDER_PIXELS = 9_000_000;
const MAX_FINANCIAL_RENDER_EDGE = 4_000;

export interface RenderedContractFinancialPdfPage {
  imagePath: string;
  pageCount: number;
  cleanup: () => Promise<void>;
}

async function readValidatedPdf(filePath: string): Promise<{
  buffer: Buffer;
  pageCount: number;
  firstPageWidthPoints: number;
  firstPageHeightPoints: number;
}> {
  const resolvedPath = path.resolve(filePath);
  const stats = await fs.promises.stat(resolvedPath);
  if (!stats.isFile() || stats.size < 1) {
    throw new Error("财务凭证 PDF 文件不存在或为空");
  }
  if (stats.size > MAX_FINANCIAL_PDF_BYTES) {
    throw new Error("财务凭证 PDF 文件超过安全大小限制");
  }
  const buffer = await fs.promises.readFile(resolvedPath);
  await assertContractFileStructure(buffer, "pdf");
  const document = await PDFDocument.load(buffer, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const firstPage = document.getPage(0);
  const { width, height } = firstPage.getSize();
  return {
    buffer,
    pageCount: document.getPageCount(),
    firstPageWidthPoints: width,
    firstPageHeightPoints: height,
  };
}

export async function getContractFinancialPdfPageCount(
  filePath: string,
): Promise<number> {
  return (await readValidatedPdf(filePath)).pageCount;
}

export function calculateContractFinancialPdfRenderDpi(
  widthPoints: number,
  heightPoints: number,
): number {
  if (
    !Number.isFinite(widthPoints) ||
    !Number.isFinite(heightPoints) ||
    widthPoints <= 0 ||
    heightPoints <= 0
  ) {
    throw new Error("PDF 页面尺寸异常，无法在安全像素范围内渲染");
  }
  const widthInches = widthPoints / 72;
  const heightInches = heightPoints / 72;
  const dpi = Math.floor(
    Math.min(
      300,
      MAX_FINANCIAL_RENDER_EDGE / Math.max(widthInches, heightInches),
      Math.sqrt(MAX_FINANCIAL_RENDER_PIXELS / (widthInches * heightInches)),
    ),
  );
  if (!Number.isFinite(dpi) || dpi < 1) {
    throw new Error("PDF 页面尺寸异常，无法在安全像素范围内渲染");
  }
  const renderedWidth = Math.ceil(widthInches * dpi);
  const renderedHeight = Math.ceil(heightInches * dpi);
  if (
    renderedWidth < 1 ||
    renderedHeight < 1 ||
    renderedWidth > MAX_FINANCIAL_RENDER_EDGE ||
    renderedHeight > MAX_FINANCIAL_RENDER_EDGE ||
    renderedWidth * renderedHeight > MAX_FINANCIAL_RENDER_PIXELS
  ) {
    throw new Error("PDF 页面渲染尺寸超过安全限制");
  }
  return dpi;
}

/**
 * 读取第一页电子文字层。该通道不执行图像识别，只能作为 PDF（便携式文档格式）
 * 发票渲染识别结果的独立复核证据。
 */
export async function extractContractFinancialPdfFirstPageTextLayer(
  filePath: string,
): Promise<string> {
  const { buffer } = await readValidatedPdf(filePath);
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "contract-financial-text-"),
  );
  const validatedPdfPath = path.join(temporaryDirectory, "source.pdf");
  try {
    await fs.promises.writeFile(validatedPdfPath, buffer, { mode: 0o600 });
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-f", "1", "-l", "1", "-layout", "-enc", "UTF-8", validatedPdfPath, "-"],
      {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
      },
    );
    return String(stdout || "").trim();
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * 将 PDF（便携式文档格式）第一页安全渲染为临时 PNG（便携式网络图形）。
 * 渲染前校验 PDF 容器、页数和尺寸，渲染后完整解码图片并校验像素上限；
 * 调用方必须在 finally 中执行 cleanup。
 */
export async function renderContractFinancialPdfFirstPage(
  filePath: string,
): Promise<RenderedContractFinancialPdfPage> {
  const { buffer, pageCount, firstPageWidthPoints, firstPageHeightPoints } =
    await readValidatedPdf(filePath);
  const renderDpi = calculateContractFinancialPdfRenderDpi(
    firstPageWidthPoints,
    firstPageHeightPoints,
  );
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "contract-financial-pdf-"),
  );
  const outputPrefix = path.join(temporaryDirectory, "page-1");
  const imagePath = `${outputPrefix}.png`;
  const validatedPdfPath = path.join(temporaryDirectory, "source.pdf");
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  };

  try {
    await fs.promises.writeFile(validatedPdfPath, buffer, { mode: 0o600 });
    await execFileAsync(
      "pdftoppm",
      [
        "-png",
        "-singlefile",
        "-r",
        String(renderDpi),
        "-f",
        "1",
        "-l",
        "1",
        validatedPdfPath,
        outputPrefix,
      ],
      {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const image = await fs.promises.readFile(imagePath);
    await assertContractFileStructure(image, "png");
    return { imagePath, pageCount, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
