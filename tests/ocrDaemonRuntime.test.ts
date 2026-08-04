import fs from "fs";
import path from "path";

const daemonSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/services/ocrDaemon.ts"),
  "utf8",
);
const workerSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/scripts/paddle_ocr_worker.py"),
  "utf8",
);

describe("文字识别常驻进程稳定性约束", () => {
  it("限制推理缓存、线程和批量大小", () => {
    expect(workerSource).toContain("enable_mkldnn=True");
    expect(workerSource).toContain("mkldnn_cache_capacity=1");
    expect(workerSource).toContain("cpu_threads=2");
    expect(workerSource).toContain("textline_orientation_batch_size=1");
    expect(workerSource).toContain("text_recognition_batch_size=1");
  });

  it("通过共享串行链保证一次只发送一张图片", () => {
    expect(daemonSource).toContain("serialDispatchTail.then(task, task)");
    expect(daemonSource).toContain(
      "enqueueSerial(() => callPaddleOcrWithRetry(filePath))",
    );
    expect(daemonSource).not.toContain("requestQueue");
  });

  it("意外退出仅重试当前图片一次且不再启动单次进程", () => {
    expect(daemonSource).toContain("const maximumAttempts = 2");
    expect(daemonSource).toContain('reason: "daemon_unexpected_exit"');
    expect(daemonSource).not.toContain("callPaddleOcrOnceDetailed");
    expect(daemonSource).not.toContain("execFile");
  });

  it("基础设施失败具有稳定错误类型和错误码", () => {
    expect(daemonSource).toContain("export class OcrInfrastructureError");
    expect(daemonSource).toContain("export function isOcrInfrastructureError");
    expect(daemonSource).toContain('"OCR_INFRASTRUCTURE_ERROR" as const');
    expect(daemonSource).toContain('{ reason: "worker_error" }');
  });
});
