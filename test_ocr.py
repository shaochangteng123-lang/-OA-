#!/usr/bin/env python3
import sys
import json

if len(sys.argv) < 2:
    print("用法: python3 test_ocr.py <图片路径>")
    sys.exit(1)

image_path = sys.argv[1]

try:
    from paddleocr import PaddleOCR
    ocr = PaddleOCR(
        use_textline_orientation=True,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        lang="ch",
        ocr_version="PP-OCRv4",
        text_det_box_thresh=0.25,
    )
    result = ocr.ocr(image_path, cls=True)
    lines = []
    for page in result:
        if page:
            for item in page:
                text = item[1][0] if isinstance(item[1], (list, tuple)) else item[1]
                conf = item[1][1] if isinstance(item[1], (list, tuple)) else 1.0
                lines.append(f"{text}  [置信度:{conf:.2f}]")

    print("=== OCR 识别结果（每行一个文本块）===")
    for i, line in enumerate(lines):
        print(f"{i:3d}: {line}")
    print("=== 结束 ===")

except Exception as e:
    print(f"错误: {e}")
