#!/usr/bin/env python3
"""
OCR Worker - 多引擎图片文字识别
完全本地运行，数据不会发送到任何外部服务器

支持两种运行模式：
  1. 常驻模式（--daemon）：通过 stdin/stdout 持续接收请求，引擎只加载一次
  2. 单次模式：python3 paddle_ocr_worker.py <图片路径>

引擎优先级：
  1. PaddleOCR（本地开发环境，识别效果最佳）
  2. RapidOCR（基于相同模型，轻量部署）
  3. Tesseract（Docker 容器环境后备方案）

常驻模式协议：
  输入：每行一个 JSON {"image_path": "/path/to/image.png"}
  输出：每行一个 JSON {"lines": [...], "fullText": "..."} 或 {"error": "..."}
"""

import sys
import json
import os

# 抑制 PaddleOCR 的日志输出
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ["FLAGS_allocator_strategy"] = "auto_growth"

# 全局单例，避免重复初始化
_ocr_engine = None
_ocr_type = None  # 记录使用的引擎类型


def get_ocr_engine():
    """获取或初始化 OCR 引擎（单例）"""
    global _ocr_engine, _ocr_type
    if _ocr_engine is not None:
        return _ocr_engine, _ocr_type

    # 优先使用 PaddleOCR
    try:
        from paddleocr import PaddleOCR
        _ocr_engine = PaddleOCR(
            use_angle_cls=True,
            lang="ch",
            use_gpu=False,
            show_log=False,
            det_db_box_thresh=0.3,
            det_db_unclip_ratio=1.6,
        )
        _ocr_type = "paddleocr"
        return _ocr_engine, _ocr_type
    except ImportError:
        pass

    # 降级到 RapidOCR
    try:
        from rapidocr_onnxruntime import RapidOCR
        _ocr_engine = RapidOCR()
        _ocr_type = "rapidocr"
        return _ocr_engine, _ocr_type
    except ImportError:
        pass

    # 最后用 Tesseract（无需初始化引擎对象）
    _ocr_engine = "tesseract"
    _ocr_type = "tesseract"
    return _ocr_engine, _ocr_type


def do_ocr(image_path):
    """执行 OCR 识别"""
    engine, engine_type = get_ocr_engine()

    if engine_type == "paddleocr":
        return ocr_with_paddleocr(engine, image_path)
    elif engine_type == "rapidocr":
        return ocr_with_rapidocr(engine, image_path)
    else:
        return ocr_with_tesseract(image_path)


def ocr_with_paddleocr(engine, image_path):
    """使用 PaddleOCR 识别"""
    result = engine.ocr(image_path, cls=True)

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


def ocr_with_rapidocr(engine, image_path):
    """使用 RapidOCR 识别"""
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


def process_request(image_path):
    """处理单个 OCR 请求，返回 JSON 结果字典"""
    if not os.path.exists(image_path):
        return {"error": f"文件不存在: {image_path}"}

    try:
        lines, full_text = do_ocr(image_path)
        return {"lines": lines, "fullText": full_text}
    except Exception as e:
        return {"error": str(e)}


def run_daemon():
    """常驻模式：从 stdin 逐行读取请求，结果写到 stdout"""
    # 先初始化引擎，输出 ready 信号
    try:
        _, engine_type = get_ocr_engine()
        print(json.dumps({"ready": True, "engine": engine_type}, ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({"ready": False, "error": str(e)}, ensure_ascii=False), flush=True)
        sys.exit(1)

    # 逐行读取请求（必须用 readline()，不能用 for line in sys.stdin，
    # 后者在管道模式下有缓冲，会导致请求被阻塞）
    while True:
        line = sys.stdin.readline()
        if not line:  # EOF，stdin 关闭
            break
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            image_path = request.get("image_path", "")
            if not image_path:
                result = {"error": "缺少 image_path 参数"}
            else:
                result = process_request(image_path)
        except json.JSONDecodeError:
            result = {"error": "无效的 JSON 输入"}
        except Exception as e:
            result = {"error": str(e)}

        print(json.dumps(result, ensure_ascii=False), flush=True)


def main():
    # 常驻模式
    if len(sys.argv) >= 2 and sys.argv[1] == "--daemon":
        run_daemon()
        return

    # 单次模式（向后兼容）
    if len(sys.argv) < 2:
        print(json.dumps({"error": "缺少图片路径参数"}), flush=True)
        sys.exit(1)

    image_path = sys.argv[1]
    result = process_request(image_path)
    print(json.dumps(result, ensure_ascii=False), flush=True)

    if "error" in result:
        sys.exit(1)


if __name__ == "__main__":
    main()
