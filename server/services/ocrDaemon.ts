/**
 * PaddleOCR 常驻进程管理
 * 启动一个 Python 常驻进程，通过 stdin/stdout 通信
 * OCR 引擎只加载一次，后续请求直接复用，大幅提升识别速度
 */

import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

// 常驻进程单例
let daemonProcess: ChildProcess | null = null;
let daemonReady = false;

// 响应缓冲区
let stdoutBuffer = "";

export interface PaddleOcrLine {
  text: string;
  confidence: number;
  box: number[][];
  modelVersion?: PaddleOcrModelVersion;
}

export interface PaddleOcrResult {
  lines: PaddleOcrLine[];
  fullText: string;
  modelVersion: PaddleOcrModelVersion;
  qrCodes?: string[];
}

export const PADDLE_OCR_MODELS = [
  "v4_mobile",
  "v5_server",
  "v6_medium",
] as const;
export type PaddleOcrModel = (typeof PADDLE_OCR_MODELS)[number];
export type PaddleOcrRequestModel = PaddleOcrModel;
export type PaddleOcrModelVersion = PaddleOcrModel | "rapidocr";

/**
 * 将工作进程和滚动部署期间可能返回的旧标识统一为可持久化的规范模型版本。
 * 未知标识不得进入审计结果，使用本次实际请求模型作为安全回退。
 */
export function normalizePaddleOcrModelVersion(
  value: unknown,
  fallback: PaddleOcrModelVersion,
): PaddleOcrModelVersion {
  const model = String(value || "").trim();
  if (model === "rapidocr") return "rapidocr";
  if (model === "v6_test") return "v6_medium";
  if ((PADDLE_OCR_MODELS as readonly string[]).includes(model)) {
    return model as PaddleOcrModel;
  }
  return fallback;
}

export function resolvePaddleOcrModel(
  value = process.env.OCR_MODEL,
): PaddleOcrModel {
  const model = String(value || "v4_mobile").trim();
  if ((PADDLE_OCR_MODELS as readonly string[]).includes(model)) {
    return model as PaddleOcrModel;
  }
  throw new Error(
    `OCR_MODEL（识别模型配置）无效：${model}，可选值为 ${PADDLE_OCR_MODELS.join(", ")}`,
  );
}

interface PaddleOcrWorkerReady {
  ready: boolean;
  engine?: string;
  model_version?: string;
  error?: string;
}

export const OCR_INFRASTRUCTURE_ERROR_CODE =
  "OCR_INFRASTRUCTURE_ERROR" as const;

export type OcrInfrastructureFailureReason =
  | "daemon_start_failed"
  | "daemon_unexpected_exit"
  | "daemon_unavailable"
  | "daemon_write_failed"
  | "daemon_timeout"
  | "daemon_shutdown"
  | "worker_error";

/**
 * 表示识别基础设施不可用，而不是图片中没有识别到目标内容。
 */
export class OcrInfrastructureError extends Error {
  readonly code = OCR_INFRASTRUCTURE_ERROR_CODE;
  readonly reason: OcrInfrastructureFailureReason;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: {
      reason: OcrInfrastructureFailureReason;
      retryable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "OcrInfrastructureError";
    this.reason = options.reason;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
}

/**
 * 同时按类型和稳定错误码判断，兼容热更新后存在两个模块实例的情况。
 */
export function isOcrInfrastructureError(
  error: unknown,
): error is OcrInfrastructureError {
  if (error instanceof OcrInfrastructureError) return true;
  if (!error || typeof error !== "object") return false;
  return (
    "code" in error &&
    (error as { code?: unknown }).code === OCR_INFRASTRUCTURE_ERROR_CODE
  );
}

interface ActiveOcrRequest {
  resolve: (value: PaddleOcrResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  process: ChildProcess;
  model: PaddleOcrRequestModel;
}

// 常驻进程一次只处理一张图片，因此这里只允许存在一个活动请求。
let activeRequest: ActiveOcrRequest | null = null;

// 所有调用共享同一条串行链，排队时间不计入单张图片的识别超时。
let serialDispatchTail: Promise<void> = Promise.resolve();

// 启动锁，防止并发启动多个进程
let startingPromise: Promise<void> | null = null;

// 记录主动关闭的进程，避免把正常清理误判为意外退出。
const expectedExitProcesses = new WeakSet<ChildProcess>();
interface ProcessExitWaiter {
  completion: Promise<void>;
  settle: () => void;
}
const processExitWaiters = new WeakMap<ChildProcess, ProcessExitWaiter>();
let processExitBarrier: Promise<void> = Promise.resolve();
let shuttingDown = false;

function enqueueSerial<T>(task: () => Promise<T>): Promise<T> {
  const result = serialDispatchTail.then(task, task);
  serialDispatchTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function rejectActiveRequest(
  error: OcrInfrastructureError,
  processForRequest?: ChildProcess,
): void {
  const request = activeRequest;
  if (!request) return;
  if (processForRequest && request.process !== processForRequest) return;
  activeRequest = null;
  clearTimeout(request.timer);
  request.reject(error);
}

function hasProcessExited(processToCheck: ChildProcess): boolean {
  return processToCheck.exitCode !== null || processToCheck.signalCode !== null;
}

/**
 * 返回指定子进程首次 exit/close（退出/关闭）时完成的 Promise（异步结果）。
 * 监听器在检查退出状态前安装，并在安装后再次检查，避免退出事件竞态；同一进程
 * 被重复停止时复用同一个结果，不会重复注册无界监听器。
 */
function processExitPromise(processToWait: ChildProcess): Promise<void> {
  const existing = processExitWaiters.get(processToWait);
  if (existing) {
    if (hasProcessExited(processToWait)) existing.settle();
    return existing.completion;
  }
  if (hasProcessExited(processToWait)) return Promise.resolve();

  let settled = false;
  let settle!: () => void;
  const completion = new Promise<void>((resolve) => {
    settle = () => {
      if (settled) return;
      settled = true;
      processToWait.removeListener("exit", settle);
      processToWait.removeListener("close", settle);
      resolve();
    };
    processToWait.once("exit", settle);
    processToWait.once("close", settle);
  });
  processExitWaiters.set(processToWait, { completion, settle });

  // 子进程可能在监听器安装与 Promise（异步结果）登记之间已经退出。
  if (hasProcessExited(processToWait)) settle();
  return completion;
}

function extendProcessExitBarrier(completion: Promise<void>): void {
  const previousBarrier = processExitBarrier;
  processExitBarrier = Promise.all([previousBarrier, completion]).then(
    () => undefined,
  );
}

async function waitForProcessExitBarrier(): Promise<void> {
  // 等待期间若又有进程进入停止流程，继续等待最新屏障，确保 spawn（创建子进程）
  // 前所有旧进程均已确认退出。
  while (true) {
    const currentBarrier = processExitBarrier;
    await currentBarrier;
    if (processExitBarrier === currentBarrier) return;
  }
}

/**
 * 获取 PaddleOCR worker 脚本路径
 */
function getWorkerPath(): string {
  const runtimeEntryDirectory = process.argv[1]
    ? path.dirname(path.resolve(process.argv[1]))
    : process.cwd();
  const candidates = [
    path.resolve(process.cwd(), "server/scripts/paddle_ocr_worker.py"),
    path.resolve(process.cwd(), "dist/server/scripts/paddle_ocr_worker.py"),
    path.resolve(runtimeEntryDirectory, "scripts/paddle_ocr_worker.py"),
    path.resolve(
      runtimeEntryDirectory,
      "../../server/scripts/paddle_ocr_worker.py",
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("PaddleOCR worker 脚本不存在");
}

/**
 * 获取 Python 可执行文件路径
 */
function getPythonCmd(): string {
  const venvPython = "/tmp/ocr-venv/bin/python3";
  return fs.existsSync(venvPython) ? venvPython : "python3";
}

/**
 * 处理 stdout 数据，按换行符分割并匹配请求
 */
function handleStdoutData(
  chunk: string,
  onReady: (data: PaddleOcrWorkerReady) => void,
): void {
  stdoutBuffer += chunk;

  // 按换行符分割，最后一段可能不完整，留在缓冲区
  const lines = stdoutBuffer.split("\n");
  stdoutBuffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const data = JSON.parse(trimmed);

      // 就绪信号
      if ("ready" in data) {
        onReady(data as PaddleOcrWorkerReady);
        continue;
      }

      // 串行模式下，响应只会对应当前唯一的活动请求。
      const req = activeRequest;
      if (req) {
        activeRequest = null;
        clearTimeout(req.timer);
        if (data.error) {
          req.reject(
            new OcrInfrastructureError(
              `PaddleOCR 识别进程返回错误: ${data.error}`,
              { reason: "worker_error" },
            ),
          );
        } else {
          const modelVersion = normalizePaddleOcrModelVersion(
            data.model_version,
            req.model,
          );
          const responseLines = Array.isArray(data.lines) ? data.lines : [];
          req.resolve({
            lines: responseLines.map((line: Record<string, unknown>) => ({
              text: typeof line.text === "string" ? line.text : "",
              confidence: Number.isFinite(Number(line.confidence))
                ? Number(line.confidence)
                : 0,
              box: Array.isArray(line.box) ? (line.box as number[][]) : [],
              modelVersion: normalizePaddleOcrModelVersion(
                line.model_version,
                modelVersion,
              ),
            })),
            fullText: typeof data.fullText === "string" ? data.fullText : "",
            modelVersion,
            qrCodes: Array.isArray(data.qr_codes)
              ? Array.from(
                  new Set<string>(
                    (data.qr_codes as unknown[])
                      .filter((value: unknown): value is string =>
                        Boolean(typeof value === "string" && value.trim()),
                      )
                      .map((value: string) => value.trim()),
                  ),
                )
              : [],
          });
        }
      } else {
        console.warn("🐍 收到未匹配的 OCR 响应:", trimmed.substring(0, 100));
      }
    } catch {
      console.error("🐍 OCR 响应解析失败:", trimmed.substring(0, 200));
    }
  }
}

/**
 * 停止指定进程并同步清空当前状态。
 */
function stopProcess(
  processToStop: ChildProcess,
  signal: NodeJS.Signals,
): void {
  expectedExitProcesses.add(processToStop);
  if (daemonProcess === processToStop) {
    daemonProcess = null;
    daemonReady = false;
    stdoutBuffer = "";
  }
  const alreadyExited = hasProcessExited(processToStop);
  const exitCompletion = processExitPromise(processToStop);
  // 先登记屏障再发送信号；即使 kill（终止进程）同步触发退出事件，后续启动也只能
  // 在当前调用栈结束后观察到已经完成的屏障。重复停止会复用同一退出结果。
  extendProcessExitBarrier(exitCompletion);
  if (!alreadyExited && !processToStop.killed) {
    processToStop.kill(signal);
  }
}

/**
 * 启动常驻进程
 */
async function startDaemon(): Promise<void> {
  if (shuttingDown) {
    throw new OcrInfrastructureError("PaddleOCR 常驻进程已关闭", {
      reason: "daemon_shutdown",
    });
  }

  // 如果已经就绪，直接返回
  if (daemonProcess && daemonReady) return;

  // 超时或写入失败会强制终止旧进程。必须确认旧进程已经 exit/close（退出/关闭）
  // 后才能加载下一份模型，避免短时间内两个 PaddleOCR（飞桨文字识别）进程重叠占用内存。
  await waitForProcessExitBarrier();

  if (shuttingDown) {
    throw new OcrInfrastructureError("PaddleOCR 常驻进程已关闭", {
      reason: "daemon_shutdown",
    });
  }
  if (daemonProcess && daemonReady) return;

  if (!startingPromise) {
    startingPromise = new Promise<void>((resolve, reject) => {
      const workerPath = getWorkerPath();
      const pythonCmd = getPythonCmd();

      console.log("🐍 启动 PaddleOCR 常驻进程...");

      // 清空上一个进程残留的响应片段。
      stdoutBuffer = "";

      // 禁用输出缓冲，保证进程间通信按行及时送达。
      const proc = spawn(pythonCmd, ["-u", workerPath, "--daemon"], {
        stdio: ["pipe", "pipe", "pipe"],
        // 禁用联网检查，同时允许内存按需增长。
        env: {
          ...process.env,
          PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
          FLAGS_allocator_strategy: "auto_growth",
        },
      });

      daemonProcess = proc;

      // 过滤初始化阶段的常规日志，但保留错误和警告。
      proc.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (!msg) return;
        const isRoutineLog =
          /^(DEBUG|INFO)\b/.test(msg) ||
          (msg.includes("ppocr") &&
            !msg.includes("Error") &&
            !msg.includes("error") &&
            !msg.includes("fail"));
        if (!isRoutineLog) {
          console.error("🐍 OCR 错误输出:", msg);
        }
      });

      let startSettled = false;
      let gotReady = false;

      const settleStartFailure = (
        error: OcrInfrastructureError,
        shouldStop = true,
      ): void => {
        if (startSettled) return;
        startSettled = true;
        clearTimeout(startTimeout);
        if (shouldStop) stopProcess(proc, "SIGKILL");
        reject(error);
      };

      // 首次启动需要加载模型，启动超时单独计算。
      const startTimeout = setTimeout(() => {
        settleStartFailure(
          new OcrInfrastructureError("PaddleOCR 常驻进程启动超时（180秒）", {
            reason: "daemon_start_failed",
          }),
        );
      }, 180000);

      // 直接按数据块监听输出，再由缓冲区拆分完整行。
      proc.stdout!.on("data", (chunk: Buffer) => {
        if (daemonProcess !== proc) return;
        handleStdoutData(chunk.toString(), (data) => {
          if (gotReady || startSettled) return;
          gotReady = true;

          if (data.ready) {
            startSettled = true;
            clearTimeout(startTimeout);
            daemonReady = true;
            console.log(
              `✅ PaddleOCR 常驻进程就绪（引擎: ${data.engine}，模型: ${normalizePaddleOcrModelVersion(data.model_version, resolvePaddleOcrModel())}）`,
            );
            resolve();
          } else {
            settleStartFailure(
              new OcrInfrastructureError(
                `PaddleOCR 常驻进程启动失败: ${data.error}`,
                { reason: "daemon_start_failed" },
              ),
            );
          }
        });
      });

      proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        const expectedExit = expectedExitProcesses.has(proc);
        expectedExitProcesses.delete(proc);
        console.log(
          `🐍 PaddleOCR 常驻进程退出（退出码: ${code}，信号: ${signal ?? "无"}）`,
        );
        if (daemonProcess === proc) {
          daemonProcess = null;
          daemonReady = false;
          stdoutBuffer = "";
        }

        if (!startSettled) {
          settleStartFailure(
            new OcrInfrastructureError(
              expectedExit
                ? "PaddleOCR 常驻进程在启动期间被关闭"
                : "PaddleOCR 常驻进程在启动期间意外退出",
              {
                reason: expectedExit
                  ? "daemon_shutdown"
                  : "daemon_unexpected_exit",
                // 未预期的 SIGKILL（强制终止信号）通常来自宿主 OOM（内存耗尽）；立即以相同图片重试只会
                // 再次制造相同峰值。其他瞬时退出仍保留一次自动重试。
                retryable: !expectedExit && signal !== "SIGKILL",
              },
            ),
            false,
          );
          return;
        }

        if (!expectedExit) {
          rejectActiveRequest(
            new OcrInfrastructureError("PaddleOCR 常驻进程意外退出", {
              reason: "daemon_unexpected_exit",
              retryable: signal !== "SIGKILL",
            }),
            proc,
          );
        }
      });

      proc.on("error", (err: Error) => {
        console.error("🐍 PaddleOCR 常驻进程错误:", err);
        if (startSettled) {
          if (daemonProcess !== proc) return;
          rejectActiveRequest(
            new OcrInfrastructureError("PaddleOCR 常驻进程运行异常", {
              reason: "daemon_unavailable",
              cause: err,
            }),
            proc,
          );
          stopProcess(proc, "SIGKILL");
          return;
        }
        settleStartFailure(
          new OcrInfrastructureError("PaddleOCR 常驻进程启动失败", {
            reason: "daemon_start_failed",
            cause: err,
          }),
        );
      });

      proc.stdin?.on("error", (err: Error) => {
        if (daemonProcess !== proc || !gotReady) return;
        rejectActiveRequest(
          new OcrInfrastructureError("无法向 PaddleOCR 常驻进程发送请求", {
            reason: "daemon_write_failed",
            cause: err,
          }),
          proc,
        );
        stopProcess(proc, "SIGKILL");
      });
    });
  }

  const currentStartingPromise = startingPromise;
  try {
    await currentStartingPromise;
  } catch (error) {
    if (isOcrInfrastructureError(error)) throw error;
    throw new OcrInfrastructureError("PaddleOCR 常驻进程启动失败", {
      reason: "daemon_start_failed",
      cause: error,
    });
  } finally {
    if (startingPromise === currentStartingPromise) {
      startingPromise = null;
    }
  }
}

/**
 * 清理常驻进程
 */
function cleanup(signal: NodeJS.Signals = "SIGTERM"): void {
  daemonReady = false;
  stdoutBuffer = "";
  const processToStop = daemonProcess;
  daemonProcess = null;
  if (processToStop) stopProcess(processToStop, signal);
}

/**
 * 调用 OCR 识别（通过常驻进程）
 */
export async function callPaddleOcr(
  filePath: string,
  model: PaddleOcrModel = resolvePaddleOcrModel(),
): Promise<string> {
  return (await callPaddleOcrDetailed(filePath, model)).fullText;
}

/**
 * 调用 OCR 识别并保留文字坐标，供工资表等结构化表格按行列定位。
 */
export async function callPaddleOcrDetailed(
  filePath: string,
  model: PaddleOcrModel = resolvePaddleOcrModel(),
): Promise<PaddleOcrResult> {
  return enqueueSerial(() => callPaddleOcrWithRetry(filePath, model));
}

async function callPaddleOcrWithRetry(
  filePath: string,
  model: PaddleOcrRequestModel,
): Promise<PaddleOcrResult> {
  const maximumAttempts = 2;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await dispatchPaddleOcrRequest(filePath, model);
    } catch (error) {
      const canRetry =
        attempt < maximumAttempts &&
        isOcrInfrastructureError(error) &&
        error.retryable &&
        !shuttingDown;
      if (!canRetry) throw error;

      console.warn(
        `⚠️ PaddleOCR 常驻进程意外退出，正在重试当前图片（第 ${attempt + 1} 次）`,
      );
    }
  }

  throw new OcrInfrastructureError("PaddleOCR 重试后仍不可用", {
    reason: "daemon_unexpected_exit",
  });
}

async function dispatchPaddleOcrRequest(
  filePath: string,
  model: PaddleOcrRequestModel,
): Promise<PaddleOcrResult> {
  await startDaemon();

  const processForRequest = daemonProcess;
  if (
    !processForRequest ||
    !daemonReady ||
    !processForRequest.stdin ||
    processForRequest.stdin.destroyed ||
    !processForRequest.stdin.writable
  ) {
    throw new OcrInfrastructureError("PaddleOCR 常驻进程当前不可用", {
      reason: "daemon_unavailable",
      // 只可能发生在进程就绪后、请求写入前的极短退出窗口，此时旧进程已经结束。
      retryable: true,
    });
  }

  if (activeRequest) {
    throw new OcrInfrastructureError("PaddleOCR 存在未完成的识别请求", {
      reason: "daemon_unavailable",
    });
  }

  return new Promise<PaddleOcrResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (activeRequest !== requestState) return;
      activeRequest = null;
      console.warn("⚠️ PaddleOCR 识别超时（180秒），重启常驻进程");
      stopProcess(processForRequest, "SIGKILL");
      reject(
        new OcrInfrastructureError("PaddleOCR 识别超时（180秒）", {
          reason: "daemon_timeout",
        }),
      );
    }, 180000);

    const requestState: ActiveOcrRequest = {
      resolve,
      reject,
      timer,
      process: processForRequest,
      model,
    };
    activeRequest = requestState;

    const requestPayload =
      JSON.stringify({ image_path: filePath, model }) + "\n";
    try {
      processForRequest.stdin!.write(requestPayload, (error) => {
        if (!error || activeRequest !== requestState) return;
        activeRequest = null;
        clearTimeout(timer);
        stopProcess(processForRequest, "SIGKILL");
        reject(
          new OcrInfrastructureError("无法向 PaddleOCR 常驻进程发送请求", {
            reason: "daemon_write_failed",
            cause: error,
          }),
        );
      });
    } catch (error) {
      activeRequest = null;
      clearTimeout(timer);
      stopProcess(processForRequest, "SIGKILL");
      reject(
        new OcrInfrastructureError("无法向 PaddleOCR 常驻进程发送请求", {
          reason: "daemon_write_failed",
          cause: error,
        }),
      );
    }
  });
}

/**
 * 关闭常驻进程（用于服务器关闭时清理）
 */
export function shutdownOcrDaemon(): void {
  console.log("🐍 关闭 PaddleOCR 常驻进程...");
  shuttingDown = true;
  rejectActiveRequest(
    new OcrInfrastructureError("PaddleOCR 常驻进程已关闭", {
      reason: "daemon_shutdown",
    }),
  );
  cleanup("SIGKILL");
}

/**
 * 获取 PaddleOCR worker 脚本路径（导出给需要的模块）
 */
export function getPaddleOcrWorkerPath(): string {
  return getWorkerPath();
}
