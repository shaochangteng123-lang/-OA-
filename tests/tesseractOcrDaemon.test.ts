/** @jest-environment node */

import path from "path";
import Tesseract from "tesseract.js";
import {
  callTesseractOcrDetailed,
  getTesseractTessdataPath,
  shutdownTesseractOcrDaemon,
} from "../server/services/tesseractOcrDaemon";

jest.mock("tesseract.js", () => ({
  __esModule: true,
  default: {
    createWorker: jest.fn(),
    OEM: { LSTM_ONLY: 1 },
    PSM: { SINGLE_LINE: "7" },
  },
}));

jest.mock("../server/services/ocrDaemon", () => ({
  OcrInfrastructureError: class OcrInfrastructureError extends Error {
    readonly code = "OCR_INFRASTRUCTURE_ERROR";
    readonly reason: string;
    readonly retryable: boolean;
    readonly cause?: unknown;

    constructor(
      message: string,
      options: { reason: string; retryable?: boolean; cause?: unknown },
    ) {
      super(message);
      this.reason = options.reason;
      this.retryable = options.retryable ?? false;
      this.cause = options.cause;
    }
  },
}));

interface MockWorker {
  recognize: jest.Mock;
  terminate: jest.Mock;
}

const createWorkerMock = jest.mocked(Tesseract.createWorker);
const workers: MockWorker[] = [];
const localInputPath = path.resolve(
  process.cwd(),
  "server/assets/tesseract/LICENSE-NOTICE.md",
);
const secondLocalInputPath = path.resolve(
  process.cwd(),
  "server/assets/tesseract/SHA256SUMS",
);

function makeRecognitionResult(
  text = "乙方：北京羽隶工程咨询有限公司\n签订时间：2025年6月25日\n",
) {
  return {
    data: {
      text,
      confidence: 91,
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  text: "乙方：北京羽隶工程咨询有限公司",
                  confidence: 93,
                  bbox: { x0: 10, y0: 20, x1: 300, y1: 45 },
                },
                {
                  text: "签订时间：2025年6月25日",
                  confidence: 89,
                  bbox: { x0: 10, y0: 50, x1: 260, y1: 75 },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function createMockWorker(): MockWorker {
  return {
    recognize: jest.fn(async () => makeRecognitionResult()),
    terminate: jest.fn(async () => undefined),
  };
}

describe("Tesseract 离线常驻工作线程", () => {
  const originalTessdataPath = process.env.TESSERACT_TESSDATA_PATH;
  const originalTimeout = process.env.TESSERACT_OCR_TIMEOUT_MS;

  beforeAll(() => {
    process.env.TESSERACT_TESSDATA_PATH = path.resolve(
      process.cwd(),
      "server/assets/tesseract",
    );
    process.env.TESSERACT_OCR_TIMEOUT_MS = "1000";
    createWorkerMock.mockImplementation(async () => {
      const worker = createMockWorker();
      workers.push(worker);
      return worker as never;
    });
  });

  afterAll(async () => {
    await shutdownTesseractOcrDaemon();
    if (originalTessdataPath === undefined) {
      delete process.env.TESSERACT_TESSDATA_PATH;
    } else {
      process.env.TESSERACT_TESSDATA_PATH = originalTessdataPath;
    }
    if (originalTimeout === undefined) {
      delete process.env.TESSERACT_OCR_TIMEOUT_MS;
    } else {
      process.env.TESSERACT_OCR_TIMEOUT_MS = originalTimeout;
    }
  });

  it("只从本地压缩模型启动并返回行级文字、置信度与坐标", async () => {
    const result = await callTesseractOcrDetailed(localInputPath, {
      pageSegmentationMode: Tesseract.PSM.SINGLE_LINE,
      characterWhitelist: "0123456789年月日：",
    });

    expect(getTesseractTessdataPath()).toBe(
      path.resolve(process.cwd(), "server/assets/tesseract"),
    );
    expect(createWorkerMock).toHaveBeenCalledTimes(1);
    expect(createWorkerMock).toHaveBeenCalledWith(
      "chi_sim+eng",
      Tesseract.OEM.LSTM_ONLY,
      expect.objectContaining({
        langPath: path.resolve(process.cwd(), "server/assets/tesseract"),
        gzip: true,
        cacheMethod: "none",
      }),
    );
    expect(result).toEqual({
      fullText: "乙方：北京羽隶工程咨询有限公司\n签订时间：2025年6月25日\n",
      confidence: 91,
      lines: [
        {
          text: "乙方：北京羽隶工程咨询有限公司",
          confidence: 93,
          box: [
            [10, 20],
            [300, 20],
            [300, 45],
            [10, 45],
          ],
        },
        {
          text: "签订时间：2025年6月25日",
          confidence: 89,
          box: [
            [10, 50],
            [260, 50],
            [260, 75],
            [10, 75],
          ],
        },
      ],
    });
    expect(workers[0].recognize).toHaveBeenCalledWith(
      localInputPath,
      expect.objectContaining({
        tessedit_pageseg_mode: "7",
        tessedit_char_whitelist: "0123456789年月日：",
      }),
      { text: true, blocks: true },
    );
  });

  it("共享一个工作线程并严格串行识别", async () => {
    const worker = workers[0];
    let finishFirst:
      | ((value: ReturnType<typeof makeRecognitionResult>) => void)
      | null = null;
    worker.recognize
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(makeRecognitionResult("第二张图片\n"));

    const first = callTesseractOcrDetailed(localInputPath);
    const second = callTesseractOcrDetailed(secondLocalInputPath);
    await new Promise((resolve) => setImmediate(resolve));

    expect(worker.recognize).toHaveBeenCalledTimes(2);
    expect(finishFirst).not.toBeNull();
    finishFirst?.(makeRecognitionResult("第一张图片\n"));
    await first;
    await second;

    expect(worker.recognize).toHaveBeenCalledTimes(3);
    expect(createWorkerMock).toHaveBeenCalledTimes(1);
  });

  it("识别超时后销毁旧线程并在下一请求重建", async () => {
    const timedOutWorker = workers[0];
    timedOutWorker.recognize.mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    const recognition = callTesseractOcrDetailed(localInputPath);
    await expect(recognition).rejects.toMatchObject({
      code: "OCR_INFRASTRUCTURE_ERROR",
      reason: "daemon_timeout",
      retryable: true,
    });
    expect(timedOutWorker.terminate).toHaveBeenCalledTimes(1);

    const recovered = await callTesseractOcrDetailed(secondLocalInputPath);
    expect(createWorkerMock).toHaveBeenCalledTimes(2);
    expect(workers[1].recognize).toHaveBeenCalledTimes(1);
    expect(recovered.fullText).toContain("北京羽隶工程咨询有限公司");
  });

  it("拒绝网络地址，防止合同被识别组件向外部读取或发送", async () => {
    const currentWorker = workers[1];
    await expect(
      callTesseractOcrDetailed("https://example.com/contract.png"),
    ).rejects.toMatchObject({
      code: "OCR_INFRASTRUCTURE_ERROR",
      reason: "worker_error",
      retryable: false,
    });
    expect(currentWorker.recognize).toHaveBeenCalledTimes(1);
  });

  it("退出时关闭常驻线程并拒绝后续请求", async () => {
    const currentWorker = workers[1];
    await shutdownTesseractOcrDaemon();
    expect(currentWorker.terminate).toHaveBeenCalledTimes(1);

    await expect(
      callTesseractOcrDetailed(localInputPath),
    ).rejects.toMatchObject({
      code: "OCR_INFRASTRUCTURE_ERROR",
      reason: "daemon_shutdown",
    });
  });
});
