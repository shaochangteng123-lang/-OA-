#!/usr/bin/env python3
"""
本地 OCR Worker - 使用 RapidOCR 识别图片文本
完全本地运行，数据不会发送到任何外部服务器

使用方法：
  python3 ocr_worker.py <图片路径>

输出格式（JSON）：
  {"lines": [{"text": "识别文本", "confidence": 0.95, "box": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]}], "fullText": "完整文本"}
"""

import sys
import json
import os


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "缺少图片路径参数"}), flush=True)
        sys.exit(1)

    image_path = sys.argv[1]

    if not os.path.exists(image_path):
        print(json.dumps({"error": f"文件不存在: {image_path}"}), flush=True)
        sys.exit(1)

    try:
        from rapidocr_onnxruntime import RapidOCR

        engine = RapidOCR()
        result, elapse = engine(image_path)

        lines = []
        full_text_parts = []

        if result:
            for line in result:
                text = line[1]
                confidence = float(line[2])
                box = [[float(p[0]), float(p[1])] for p in line[0]]
                lines.append({
                    "text": text,
                    "confidence": confidence,
                    "box": box,
                })
                full_text_parts.append(text)

        full_text = "\n".join(full_text_parts)

        output = {
            "lines": lines,
            "fullText": full_text,
            "elapse": elapse,
        }
        print(json.dumps(output, ensure_ascii=False), flush=True)

    except ImportError:
        print(json.dumps({"error": "rapidocr_onnxruntime 未安装，请运行: pip3 install rapidocr_onnxruntime"}), flush=True)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
