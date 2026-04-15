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
        # 使用 PP-OCRv4 mobile 轻量模型，内存占用小，适合容器环境
        # 启用文档方向分类和变形矫正，提高扫描件/副本发票的识别率
        _ocr_engine = PaddleOCR(
            use_textline_orientation=True,
            use_doc_orientation_classify=True,
            use_doc_unwarping=True,
            lang="ch",
            ocr_version="PP-OCRv4",
            text_det_box_thresh=0.25,
            text_det_unclip_ratio=1.8,
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
        raise RuntimeError("未找到可用的 OCR 引擎，请安装 PaddleOCR 或 RapidOCR")


def do_ocr(image_path):
    """执行 OCR 识别"""
    engine, engine_type = get_ocr_engine()

    if engine_type == "paddleocr":
        return ocr_with_paddleocr(engine, image_path)
    elif engine_type == "rapidocr":
        return ocr_with_rapidocr(engine, image_path)
    else:
        raise RuntimeError("未找到可用的 OCR 引擎")


def ocr_with_paddleocr(engine, image_path):
    """使用 PaddleOCR 识别（兼容 3.x 新 API）"""
    result = engine.predict(image_path)

    lines = []
    full_text_parts = []

    # PaddleOCR 3.x: predict() 返回列表，每个元素是 OCRResult（支持 [] 访问）
    # 字段：rec_texts, rec_scores, rec_polys
    for item in result:
        try:
            texts = item["rec_texts"]
            scores = item["rec_scores"]
            polys = item["rec_polys"]
        except (KeyError, TypeError):
            continue

        for i, text in enumerate(texts):
            confidence = float(scores[i]) if i < len(scores) else 1.0
            poly = polys[i] if i < len(polys) else []
            try:
                box = poly.tolist()
            except AttributeError:
                box = poly
            lines.append({"text": text, "confidence": confidence, "box": box})
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


def ensure_extension(image_path):
    """
    PaddleOCR 3.x 要求文件有扩展名。
    如果文件没有扩展名，通过魔术字节判断类型，创建带扩展名的符号链接返回。
    返回 (实际路径, 是否为临时文件)
    """
    _, ext = os.path.splitext(image_path)
    if ext:
        return image_path, False

    # 读取文件头判断类型
    with open(image_path, "rb") as f:
        header = f.read(8)

    if header[:4] == b'\x89PNG':
        ext = '.png'
    elif header[:2] == b'\xff\xd8':
        ext = '.jpg'
    elif header[:4] in (b'GIF8', b'GIF9'):
        ext = '.gif'
    elif header[:4] == b'BM':
        ext = '.bmp'
    elif header[:4] == b'RIFF' and header[8:12] == b'WEBP':
        ext = '.webp'
    elif header[:4] == b'%PDF':
        ext = '.pdf'
    else:
        ext = '.jpg'  # 默认按 jpg 处理

    tmp_path = image_path + ext
    if not os.path.exists(tmp_path):
        os.symlink(image_path, tmp_path)
    return tmp_path, True


def process_request(image_path):
    """处理单个 OCR 请求，返回 JSON 结果字典"""
    if not os.path.exists(image_path):
        return {"error": f"文件不存在: {image_path}"}

    actual_path, is_tmp = ensure_extension(image_path)
    try:
        lines, full_text = do_ocr(actual_path)
        return {"lines": lines, "fullText": full_text}
    except Exception as e:
        return {"error": str(e)}
    finally:
        if is_tmp and os.path.islink(actual_path):
            try:
                os.unlink(actual_path)
            except Exception:
                pass


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
