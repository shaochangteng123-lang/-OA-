#!/usr/bin/env python3
"""
OCR Worker - 多引擎图片文字识别
完全本地运行，数据不会发送到任何外部服务器

引擎优先级：
  1. PaddleOCR（本地开发环境，识别效果最佳）
  2. RapidOCR（基于相同模型，轻量部署）
  3. Tesseract（Docker 容器环境后备方案）

使用方法：
  python3 paddle_ocr_worker.py <图片路径>

输出格式（JSON）：
  {"lines": [{"text": "识别文本", "confidence": 0.95, "box": [...]}], "fullText": "完整文本"}
"""

import sys
import json
import os

# 抑制 PaddleOCR 的日志输出
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"


def ocr_with_paddleocr(image_path):
    """使用 PaddleOCR 识别"""
    from paddleocr import PaddleOCR

    ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    result = ocr.ocr(image_path, cls=True)

    lines = []
    full_text_parts = []

    if result and result[0]:
        for line in result[0]:
            box = line[0]
            text = line[1][0]
            confidence = float(line[1][1])
            lines.append(
                {
                    "text": text,
                    "confidence": confidence,
                    "box": [[float(p[0]), float(p[1])] for p in box],
                }
            )
            full_text_parts.append(text)

    return lines, "\n".join(full_text_parts)


def ocr_with_rapidocr(image_path):
    """使用 RapidOCR 识别（PaddleOCR 不可用时的降级方案）"""
    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
    result, _ = engine(image_path)

    lines = []
    full_text_parts = []

    if result:
        for line in result:
            text = line[1]
            confidence = float(line[2])
            box = [[float(p[0]), float(p[1])] for p in line[0]]
            lines.append(
                {
                    "text": text,
                    "confidence": confidence,
                    "box": box,
                }
            )
            full_text_parts.append(text)

    return lines, "\n".join(full_text_parts)


def ocr_with_tesseract(image_path):
    """使用 Tesseract 识别（Docker 容器后备方案）"""
    import subprocess

    result = subprocess.run(
        ["tesseract", image_path, "stdout", "-l", "chi_sim+eng", "--psm", "6"],
        capture_output=True,
        text=True,
        timeout=30,
    )

    if result.returncode != 0:
        raise RuntimeError(f"Tesseract 执行失败: {result.stderr}")

    full_text = result.stdout.strip()
    lines = []
    for text in full_text.split("\n"):
        text = text.strip()
        if text:
            lines.append({"text": text, "confidence": 0.8, "box": []})

    return lines, full_text


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "缺少图片路径参数"}), flush=True)
        sys.exit(1)

    image_path = sys.argv[1]

    if not os.path.exists(image_path):
        print(json.dumps({"error": f"文件不存在: {image_path}"}), flush=True)
        sys.exit(1)

    try:
        # 优先使用 PaddleOCR，不可用时降级到 RapidOCR，最后用 Tesseract
        try:
            lines, full_text = ocr_with_paddleocr(image_path)
        except ImportError:
            try:
                lines, full_text = ocr_with_rapidocr(image_path)
            except ImportError:
                lines, full_text = ocr_with_tesseract(image_path)

        output = {
            "lines": lines,
            "fullText": full_text,
        }
        print(json.dumps(output, ensure_ascii=False), flush=True)

    except ImportError:
        print(
            json.dumps(
                {
                    "error": "OCR 引擎未安装，请安装 paddleocr、rapidocr_onnxruntime 或 tesseract"
                }
            ),
            flush=True,
        )
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
