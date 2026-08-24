/** @jest-environment node */

import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

jest.mock("child_process", () => ({
  ...jest.requireActual<typeof import("child_process")>("child_process"),
  spawn: jest.fn(),
}));

const spawnMock = jest.mocked(spawn);

class FakeOcrStdin extends EventEmitter {
  destroyed = false;
  writable = true;
  readonly writes: string[] = [];

  write(
    payload: string | Uint8Array,
    callback?: (error?: Error | null) => void,
  ): boolean {
    this.writes.push(payload.toString());
    callback?.(null);
    return true;
  }
}

class FakeOcrProcess extends EventEmitter {
  readonly stdin = new FakeOcrStdin();
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = jest.fn((_signal: NodeJS.Signals = "SIGTERM") => {
    this.killed = true;
    return true;
  });

  sendJson(payload: unknown): void {
    this.stdout.emit("data", Buffer.from(`${JSON.stringify(payload)}\n`));
  }

  finish(signal: NodeJS.Signals): void {
    this.signalCode = signal;
    this.emit("exit", null, signal);
    this.emit("close", null, signal);
  }
}

async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

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
      "enqueueSerial(() => callPaddleOcrWithRetry(filePath, model))",
    );
    expect(daemonSource).not.toContain("requestQueue");
  });

  it("请求超时强杀后等待旧进程退出，再启动新进程处理排队请求", async () => {
    jest.useFakeTimers();
    const firstProcess = new FakeOcrProcess();
    const secondProcess = new FakeOcrProcess();
    spawnMock
      .mockReturnValueOnce(firstProcess as unknown as ChildProcess)
      .mockReturnValueOnce(secondProcess as unknown as ChildProcess);
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { callPaddleOcrDetailed, shutdownOcrDaemon } =
      await import("../server/services/ocrDaemon");
    const first = callPaddleOcrDetailed("/tmp/first-contract-page.png");
    const firstOutcome = first.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    const second = callPaddleOcrDetailed(
      "/tmp/second-contract-page.png",
      "v5_server",
    );

    await flushMicrotasks();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    firstProcess.sendJson({ ready: true, engine: "paddleocr" });
    await flushMicrotasks();
    expect(firstProcess.stdin.writes).toHaveLength(1);
    expect(secondProcess.stdin.writes).toHaveLength(0);

    jest.advanceTimersByTime(180_000);
    await flushMicrotasks();
    const timedOut = await firstOutcome;
    expect(timedOut).toMatchObject({
      error: {
        code: "OCR_INFRASTRUCTURE_ERROR",
        reason: "daemon_timeout",
      },
    });
    expect(firstProcess.kill).toHaveBeenCalledWith("SIGKILL");

    // 串行链已经放行第二个调用，但旧模型进程尚未确认退出，不能提前加载新模型。
    expect(spawnMock).toHaveBeenCalledTimes(1);

    firstProcess.finish("SIGKILL");
    await flushMicrotasks();
    expect(spawnMock).toHaveBeenCalledTimes(2);

    secondProcess.sendJson({ ready: true, engine: "paddleocr" });
    await flushMicrotasks();
    expect(secondProcess.stdin.writes).toHaveLength(1);
    expect(JSON.parse(secondProcess.stdin.writes[0])).toMatchObject({
      image_path: "/tmp/second-contract-page.png",
      model: "v5_server",
    });

    // 新请求已经活动后，旧进程迟到的标准输出和错误事件不能误拒绝新请求。
    firstProcess.sendJson({ lines: [], fullText: "旧进程迟到响应" });
    firstProcess.emit("error", new Error("旧进程迟到错误"));
    await flushMicrotasks();
    secondProcess.sendJson({
      lines: [
        {
          text: "第二张识别成功",
          confidence: 0.99,
          box: [],
        },
      ],
      fullText: "第二张识别成功",
      qr_codes: ["SGBJCY00JSJS2500693(B1)"],
    });
    await expect(second).resolves.toMatchObject({
      fullText: "第二张识别成功",
      modelVersion: "v5_server",
      lines: [{ modelVersion: "v5_server" }],
      qrCodes: ["SGBJCY00JSJS2500693(B1)"],
    });

    shutdownOcrDaemon();
    secondProcess.finish("SIGKILL");
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    jest.useRealTimers();
  });

  it("工作进程使用本地二维码解码并随识别结果返回完整内容", () => {
    expect(workerSource).toContain("def decode_qr_codes(image_path)");
    expect(workerSource).toContain("cv2.QRCodeDetector()");
    expect(workerSource).toContain('"qr_codes": decode_qr_codes(actual_path)');
  });

  it("普通意外退出仅重试一次，SIGKILL（强制终止信号）不重复制造内存峰值", () => {
    expect(daemonSource).toContain("const maximumAttempts = 2");
    expect(daemonSource).toContain('reason: "daemon_unexpected_exit"');
    expect(daemonSource).toContain('signal !== "SIGKILL"');
    expect(daemonSource).not.toContain("callPaddleOcrOnceDetailed");
    expect(daemonSource).not.toContain("execFile");
  });

  it("基础设施失败具有稳定错误类型和错误码", () => {
    expect(daemonSource).toContain("export class OcrInfrastructureError");
    expect(daemonSource).toContain("export function isOcrInfrastructureError");
    expect(daemonSource).toContain('"OCR_INFRASTRUCTURE_ERROR" as const');
    expect(daemonSource).toContain('{ reason: "worker_error" }');
  });

  it("支持第四版、第五版和第六版候选模型按请求切换", () => {
    expect(workerSource).toContain('"v4_mobile"');
    expect(workerSource).toContain('"v5_server"');
    expect(workerSource).toContain('"v6_medium"');
    expect(workerSource).toContain(
      'text_detection_model_name="PP-OCRv5_server_det"',
    );
    expect(workerSource).toContain(
      'text_recognition_model_name="PP-OCRv5_server_rec"',
    );
    expect(daemonSource).toContain('"v6_medium",');
    expect(daemonSource).toContain(
      "JSON.stringify({ image_path: filePath, model })",
    );
  });

  it("第五代服务器模型使用独立低内存推理参数", () => {
    expect(workerSource).toContain('"enable_mkldnn": False');
    expect(workerSource).toContain('"cpu_threads": 1');
    expect(workerSource).toContain('"text_det_limit_side_len": 640');
    expect(workerSource).toContain('"text_det_limit_type": "max"');
    expect(workerSource).toContain("**v5_options");
  });
});
