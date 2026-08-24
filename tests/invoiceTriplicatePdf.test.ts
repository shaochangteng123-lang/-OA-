/** @jest-environment node */

import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";
import {
  formatTriplicateAmount,
  renderMainBusinessTriplicatePdf,
} from "../server/services/invoiceTriplicate.js";

describe("主营业务在线三联单", () => {
  it("不显示底部累计说明且联次竖排文字不绘制外围方框", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/invoiceTriplicate.ts"),
      "utf8",
    );
    expect(source).not.toContain("上次累计：");
    expect(source).not.toContain("context.strokeRect(\n    copyLeft");
    expect(source).toContain("drawVerticalLabel(");
  });

  it("主表按参考版式居中收窄并靠近固定联次文字", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/invoiceTriplicate.ts"),
      "utf8",
    );
    expect(source).toContain("const tableLeft = 148");
    expect(source).toContain("const tableRight = 1046");
    expect(source).toContain("const copyLeft = 1048");
  });

  it("按参考版式增加顶部留白并压缩主表行高", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/invoiceTriplicate.ts"),
      "utf8",
    );
    expect(source).toContain("const titleCenterY = 298");
    expect(source).toContain("const projectTop = 338");
    expect(source).toContain("const rowHeight = 51");
    expect(source).not.toContain("context.strokeRect(tableLeft, footerTop");
    expect(source).not.toContain(
      "context.lineTo(tableLeft + footerColumnWidth * index",
    );
  });

  it("工程项目名称栏不绘制外框且内容紧跟冒号", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/invoiceTriplicate.ts"),
      "utf8",
    );
    expect(source).not.toContain(
      "context.strokeRect(\n    tableLeft,\n    projectTop",
    );
    expect(source).toContain("const nameStart =");
    expect(source).toContain(
      "projectLabelLeft + context.measureText(projectLabel).width + 2",
    );
    expect(source).toContain(
      "context.font = `bold ${projectFontSize(context, projectName",
    );
  });

  it("本次付款严格按两位小数输出且不增加千位分隔符", () => {
    expect(formatTriplicateAmount(47500)).toBe("47500.00");
    expect(formatTriplicateAmount(47500.1)).toBe("47500.10");
    expect(formatTriplicateAmount(47500.12)).toBe("47500.12");
  });

  it("生成第一联、第二联、第三联三张A4页面", async () => {
    const buffer = await renderMainBusinessTriplicatePdf({
      projectName: "柳芳110千伏输变电工程",
      contractAmount: 152000,
      currentPayment: 47500,
      previousPayment: 104500,
      cumulativePayment: 152000,
    });
    const document = await PDFDocument.load(buffer);
    expect(document.getPageCount()).toBe(3);
    expect(document.getPages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          getWidth: expect.any(Function),
          getHeight: expect.any(Function),
        }),
      ]),
    );
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 1);
      expect(page.getHeight()).toBeCloseTo(841.89, 1);
    }
  });
});
