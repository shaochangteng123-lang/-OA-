#!/usr/bin/env python3
"""
将 Excel 文件的所有工作表设置为"适合页面宽度"（横向 A4），
输出修改后的副本供 LibreOffice 转 PDF。

用法: python3 fit-spreadsheet.py <input.xlsx> <output.xlsx>
"""
import sys
import shutil
from pathlib import Path

def main():
    if len(sys.argv) < 3:
        print("Usage: fit-spreadsheet.py <input> <output>", file=sys.stderr)
        sys.exit(1)

    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])

    ext = src.suffix.lower()

    if ext in ('.xlsx',):
        try:
            from openpyxl import load_workbook
            from openpyxl.worksheet.page import PageMargins

            wb = load_workbook(str(src))
            for ws in wb.worksheets:
                ws.sheet_properties.pageSetUpPr.fitToPage = True
                ws.page_setup.fitToWidth = 1
                ws.page_setup.fitToHeight = 0
                ws.page_setup.orientation = 'landscape'
                ws.page_setup.paperSize = ws.PAPERSIZE_A4
                ws.page_margins = PageMargins(
                    left=0.4, right=0.4, top=0.5, bottom=0.5,
                    header=0.3, footer=0.3
                )
            wb.save(str(dst))
            return
        except Exception as e:
            print(f"openpyxl processing failed: {e}", file=sys.stderr)

    # .xls 或处理失败时直接复制原文件
    shutil.copy2(str(src), str(dst))


if __name__ == '__main__':
    main()
