/**
 * Tesseract（开源文字识别）离线常驻服务。
 *
 * 语言模型仅从服务器本地目录加载；所有识别请求共享一个常驻工作线程并严格串行执行，
 * 避免并发识别形成不可控的内存峰值。
 */

import fs from "fs";
import path from "path";
import Tesseract from "tesseract.js";
import {
  OcrInfrastructureError,
  type OcrInfrastructureFailureReason,
} from "./ocrDaemon.js";

const REQUIRED_LANGUAGE_MODEL_FILES = [
  "chi_sim.traineddata.gz",
  "eng.traineddata.gz",
] as const;
const DEFAULT_RECOGNITION_TIMEOUT_MS = 120_000;
const MINIMUM_RECOGNITION_TIMEOUT_MS = 1_000;

type TesseractWorker = Awaited<ReturnType<typeof Tesseract.createWorker>>;

export interface TesseractOcrLine {
  text: string;
  confidence: number;
  box: number[][];
}

export interface TesseractOcrResult {
  lines: TesseractOcrLine[];
  fullText: string;
  confidence: number;
}

export interface TesseractOcrRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TesseractOcrOptions {
  /** 页面分割模式，例如 `Tesseract.PSM.SINGLE_LINE`。 */
  pageSegmentationMode?: Tesseract.PSM;
  /** 限制可识别字符，适用于日期、金额等目标区域。 */
  characterWhitelist?: string;
  /** 是否保留词间空格。 */
  preserveInterwordSpaces?: boolean;
  /** 仅识别图片中的指定矩形区域。 */
  rectangle?: TesseractOcrRectangle;
}

let activeWorker: TesseractWorker | null = null;
let startingWorker: Promise<TesseractWorker> | null = null;
let serialDispatchTail: Promise<void> = Promise.resolve();
let shuttingDown = false;

function enqueueSerial<T>(task: () => Promise<T>): Promise<T> {
  const result = serialDispatchTail.then(task, task);
  serialDispatchTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function parseRecognitionTimeoutMs(): number {
  const configured = Number(process.env.TESSERACT_OCR_TIMEOUT_MS);
  if (
    !Number.isFinite(configured) ||
    configured < MINIMUM_RECOGNITION_TIMEOUT_MS
  ) {
    return DEFAULT_RECOGNITION_TIMEOUT_MS;
  }
  return Math.floor(configured);
}

function resolveLocalInputPath(filePath: string): string {
  const trimmedPath = filePath.trim();
  if (!trimmedPath || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedPath)) {
    throw new OcrInfrastructureError("Tesseract 仅允许识别服务器本地文件", {
      reason: "worker_error",
    });
  }

  const resolvedPath = path.resolve(trimmedPath);
  try {
    if (!fs.statSync(resolvedPath).isFile()) throw new Error("不是普通文件");
  } catch (error) {
    throw new OcrInfrastructureError(
      "Tesseract 待识别的服务器本地文件不存在或不可读",
      { reason: "worker_error", cause: error },
    );
  }
  return resolvedPath;
}

/**
 * 获取离线语言模型目录。显式配置优先，随后依次兼容编译产物和源码开发目录。
 */
export function getTesseractTessdataPath(): string {
  const configuredPath = process.env.TESSERACT_TESSDATA_PATH?.trim();
  const candidates = [
    configuredPath ? path.resolve(configuredPath) : null,
    path.resolve(process.cwd(), "dist/server/assets/tesseract"),
    path.resolve(process.cwd(), "server/assets/tesseract"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const hasAllModels = REQUIRED_LANGUAGE_MODEL_FILES.every((filename) =>
      fs.existsSync(path.join(candidate, filename)),
    );
    if (hasAllModels) return candidate;
  }

  throw new OcrInfrastructureError(
    `Tesseract 离线语言模型不完整，已检查目录：${candidates.join("、")}`,
    { reason: "daemon_start_failed" },
  );
}

async function terminateWorker(worker: TesseractWorker): Promise<void> {
  if (activeWorker === worker) activeWorker = null;
  try {
    await worker.terminate();
  } catch (error) {
    console.warn("⚠️ Tesseract 工作线程清理失败:", error);
  }
}

async function createOfflineWorker(): Promise<TesseractWorker> {
  if (shuttingDown) {
    throw new OcrInfrastructureError("Tesseract 常驻工作线程已关闭", {
      reason: "daemon_shutdown",
    });
  }

  const languageModelPath = getTesseractTessdataPath();
  console.log("🔤 启动 Tesseract 离线常驻工作线程...");

  try {
    const worker = await Tesseract.createWorker(
      "chi_sim+eng",
      Tesseract.OEM.LSTM_ONLY,
      {
        langPath: languageModelPath,
        gzip: true,
        // 不读写外部缓存，确保每次启动都只使用镜像内经过校验的语言模型。
        cacheMethod: "none",
        errorHandler: (error) => {
          console.error("🔤 Tesseract 工作线程异常:", error);
        },
      },
    );

    if (shuttingDown) {
      await terminateWorker(worker);
      throw new OcrInfrastructureError("Tesseract 常驻工作线程已关闭", {
        reason: "daemon_shutdown",
      });
    }

    activeWorker = worker;
    console.log("✅ Tesseract 离线常驻工作线程就绪");
    return worker;
  } catch (error) {
    if (error instanceof OcrInfrastructureError) throw error;
    throw new OcrInfrastructureError("Tesseract 常驻工作线程启动失败", {
      reason: "daemon_start_failed",
      cause: error,
    });
  }
}

async function getOrCreateWorker(): Promise<TesseractWorker> {
  if (shuttingDown) {
    throw new OcrInfrastructureError("Tesseract 常驻工作线程已关闭", {
      reason: "daemon_shutdown",
    });
  }
  if (activeWorker) return activeWorker;

  if (!startingWorker) {
    startingWorker = createOfflineWorker();
  }
  const currentStartingWorker = startingWorker;
  try {
    return await currentStartingWorker;
  } finally {
    if (startingWorker === currentStartingWorker) startingWorker = null;
  }
}

function mapRecognitionLines(data: Tesseract.Page): TesseractOcrLine[] {
  const lines =
    data.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines),
    ) ?? [];

  if (lines.length > 0) {
    return lines
      .map((line) => ({
        text: line.text.trim(),
        confidence: Number.isFinite(line.confidence) ? line.confidence : 0,
        box: [
          [line.bbox.x0, line.bbox.y0],
          [line.bbox.x1, line.bbox.y0],
          [line.bbox.x1, line.bbox.y1],
          [line.bbox.x0, line.bbox.y1],
        ],
      }))
      .filter((line) => line.text.length > 0);
  }

  const fallbackConfidence = Number.isFinite(data.confidence)
    ? data.confidence
    : 0;
  return (data.text ?? "")
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, confidence: fallbackConfidence, box: [] }));
}

function buildRecognitionParameters(
  options: TesseractOcrOptions,
): Record<string, string> {
  const parameters: Record<string, string> = {};
  if (options.pageSegmentationMode) {
    parameters.tessedit_pageseg_mode = options.pageSegmentationMode;
  }
  if (options.characterWhitelist !== undefined) {
    parameters.tessedit_char_whitelist = options.characterWhitelist;
  }
  if (options.preserveInterwordSpaces !== undefined) {
    parameters.preserve_interword_spaces = options.preserveInterwordSpaces
      ? "1"
      : "0";
  }
  return parameters;
}

class TesseractRecognitionTimeoutError extends Error {}

async function recognizeWithWorker(
  worker: TesseractWorker,
  filePath: string,
  options: TesseractOcrOptions,
): Promise<TesseractOcrResult> {
  const timeoutMs = parseRecognitionTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    const recognitionPromise = worker.recognize(
      filePath,
      {
        ...(options.rectangle ? { rectangle: options.rectangle } : {}),
        ...buildRecognitionParameters(options),
      },
      { text: true, blocks: true },
    );
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new TesseractRecognitionTimeoutError());
      }, timeoutMs);
    });
    const result = await Promise.race([recognitionPromise, timeoutPromise]);
    const confidence = Number.isFinite(result.data.confidence)
      ? result.data.confidence
      : 0;
    return {
      lines: mapRecognitionLines(result.data),
      fullText: result.data.text ?? "",
      confidence,
    };
  } catch (error) {
    await terminateWorker(worker);
    const isTimeout = error instanceof TesseractRecognitionTimeoutError;
    const reason: OcrInfrastructureFailureReason = isTimeout
      ? "daemon_timeout"
      : "worker_error";
    throw new OcrInfrastructureError(
      isTimeout
        ? `Tesseract 识别超时（${timeoutMs}毫秒），工作线程将在下一请求重建`
        : "Tesseract 识别失败，工作线程将在下一请求重建",
      { reason, retryable: !shuttingDown, cause: error },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 调用离线 Tesseract（开源文字识别），返回全文和行级置信度、坐标。
 */
export async function callTesseractOcrDetailed(
  filePath: string,
  options: TesseractOcrOptions = {},
): Promise<TesseractOcrResult> {
  return enqueueSerial(async () => {
    const localFilePath = resolveLocalInputPath(filePath);
    const worker = await getOrCreateWorker();
    return recognizeWithWorker(worker, localFilePath, options);
  });
}

/**
 * 调用离线 Tesseract（开源文字识别），仅返回全文。
 */
export async function callTesseractOcr(
  filePath: string,
  options: TesseractOcrOptions = {},
): Promise<string> {
  return (await callTesseractOcrDetailed(filePath, options)).fullText;
}

/**
 * 关闭常驻工作线程。服务退出后禁止再接受新的识别请求。
 */
export async function shutdownTesseractOcrDaemon(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("🔤 关闭 Tesseract 离线常驻工作线程...");

  const worker = activeWorker;
  activeWorker = null;
  if (worker) await terminateWorker(worker);

  const pendingStart = startingWorker;
  startingWorker = null;
  if (pendingStart) {
    try {
      const pendingWorker = await pendingStart;
      if (pendingWorker !== worker) await terminateWorker(pendingWorker);
    } catch {
      // 启动失败或因关闭被拒绝时无需重复报告。
    }
  }
}
