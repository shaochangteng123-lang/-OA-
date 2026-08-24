/** @jest-environment node */

import fs from "node:fs";
import path from "node:path";
import {
  PADDLE_OCR_MODELS,
  normalizePaddleOcrModelVersion,
  resolvePaddleOcrModel,
} from "../server/services/ocrDaemon";

const configPath = path.resolve(
  process.cwd(),
  "server/config/ocr-v6-medium.json",
);
const workerSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/scripts/paddle_ocr_worker.py"),
  "utf8",
);
const comparisonSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/services/contractOcrComparison.ts"),
  "utf8",
);
const dockerfileSource = fs.readFileSync(
  path.resolve(process.cwd(), "Dockerfile"),
  "utf8",
);
const developmentComposeSource = fs.readFileSync(
  path.resolve(process.cwd(), "docker-compose.yml"),
  "utf8",
);
const productionComposeSource = fs.readFileSync(
  path.resolve(process.cwd(), "docker-compose.prod.yml"),
  "utf8",
);
const contractRouteSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/routes/contracts.ts"),
  "utf8",
);

describe("PP-OCRv6_medium（第六版中型模型）正式候选配置", () => {
  it("三个模型均可切换", () => {
    expect(PADDLE_OCR_MODELS).toEqual(["v4_mobile", "v5_server", "v6_medium"]);
    expect(resolvePaddleOcrModel("v4_mobile")).toBe("v4_mobile");
    expect(resolvePaddleOcrModel("v5_server")).toBe("v5_server");
    expect(resolvePaddleOcrModel("v6_medium")).toBe("v6_medium");
    expect(() => resolvePaddleOcrModel("v6_test")).toThrow(
      "OCR_MODEL（识别模型配置）无效",
    );
  });

  it("仅开发容器默认使用第六版模型，生产与镜像仍保留第四版回退", () => {
    expect(developmentComposeSource).toContain(
      "OCR_MODEL=${OCR_MODEL:-v6_medium}",
    );
    expect(productionComposeSource).toContain(
      "OCR_MODEL=${OCR_MODEL:-v4_mobile}",
    );
    expect(dockerfileSource).toContain("OCR_MODEL=v4_mobile");
  });

  it("现有双模型接口不因生产枚举扩展而改变", () => {
    expect(comparisonSource).toContain(
      'const CONTRACT_OCR_COMPARISON_MODELS = [\n  "v4_mobile",\n  "v5_server",',
    );
    expect(comparisonSource).toContain(
      "for (const modelVersion of CONTRACT_OCR_COMPARISON_MODELS)",
    );
  });

  it("配置固定 PaddleOCR（飞桨文字识别）3.5.0 和官方模型摘要", () => {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config).toMatchObject({
      id: "v6_medium",
      paddleocrVersion: "3.5.0",
      modelRootEnvironmentVariable: "OCR_V6_MODEL_ROOT",
      defaultModelRoot: "/opt/paddleocr-v6-medium",
      detection: {
        officialModelName: "PP-OCRv6_medium_det",
        runtimeModelName: "PP-OCRv5_server_det",
      },
      recognition: {
        officialModelName: "PP-OCRv6_medium_rec",
        runtimeModelName: "PP-OCRv5_server_rec",
      },
      runtime: {
        enableMkldnn: false,
        cpuThreads: 1,
        textRecognitionBatchSize: 1,
        textDetectionLimitSideLength: 640,
      },
    });
    expect(config.enableEnvironmentVariable).toBeUndefined();
    expect(config.detection.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(config.recognition.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("工作进程只从已校验目录加载第六版模型，镜像构建阶段负责准备", () => {
    expect(workerSource).toContain('"v6_medium"');
    expect(workerSource).toContain("load_v6_medium_config()");
    expect(workerSource).toContain("resolve_v6_medium_model_directories");
    expect(workerSource).toContain(
      "text_detection_model_dir=detection_directory",
    );
    expect(workerSource).toContain(
      "text_recognition_model_dir=recognition_directory",
    );
    expect(workerSource).not.toContain("OCR_ENABLE_V6_TEST");
    expect(dockerfileSource).toContain(
      "python3 server/scripts/prepare_ocr_v6_medium_models.py",
    );
    expect(dockerfileSource).toContain(
      "COPY --from=ocr-models /opt/paddleocr-v6-medium /opt/paddleocr-v6-medium",
    );
  });

  it("模型版本只保存规范值并兼容旧测试标识", () => {
    expect(normalizePaddleOcrModelVersion("v6_medium", "v4_mobile")).toBe(
      "v6_medium",
    );
    expect(normalizePaddleOcrModelVersion("v6_test", "v4_mobile")).toBe(
      "v6_medium",
    );
    expect(normalizePaddleOcrModelVersion("rapidocr", "v4_mobile")).toBe(
      "rapidocr",
    );
    expect(normalizePaddleOcrModelVersion("unknown", "v5_server")).toBe(
      "v5_server",
    );
    expect(contractRouteSource).toContain(
      "normalizePaddleOcrModelVersion(line.modelVersion, fallbackModelVersion)",
    );
    expect(contractRouteSource).toContain("engine_version = $8");
    expect(contractRouteSource).not.toContain(
      'String(line.modelVersion || "unknown")',
    );
  });
});
