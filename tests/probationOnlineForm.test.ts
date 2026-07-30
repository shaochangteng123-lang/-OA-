/** @jest-environment node */

import fs from "fs";
import os from "os";
import path from "path";
import { createCanvas } from "canvas";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { generateProbationApplicationPdf } from "../server/services/probationApplicationPdf";
import {
  decodePngSignatureDataUrl,
  normalizeSignaturePng,
} from "../server/utils/electronic-signature";

function createSignaturePng(): Buffer {
  const canvas = createCanvas(320, 120);
  const context = canvas.getContext("2d");
  context.strokeStyle = "#111";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(20, 75);
  context.bezierCurveTo(80, 15, 150, 110, 220, 40);
  context.bezierCurveTo(250, 20, 275, 85, 305, 45);
  context.stroke();
  return canvas.toBuffer("image/png");
}

function createGrayBackgroundSignaturePng(): Buffer {
  const canvas = createCanvas(640, 320);
  const context = canvas.getContext("2d");
  const background = context.createLinearGradient(0, 0, 640, 320);
  background.addColorStop(0, "#d8d5cf");
  background.addColorStop(1, "#bcb9b3");
  context.fillStyle = background;
  context.fillRect(0, 0, 640, 320);
  context.strokeStyle = "#292929";
  context.lineWidth = 9;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(145, 195);
  context.bezierCurveTo(205, 95, 285, 235, 355, 120);
  context.bezierCurveTo(405, 55, 450, 220, 510, 125);
  context.stroke();
  return canvas.toBuffer("image/png");
}

function createStrongShadowSignaturePng(): Buffer {
  const width = 720;
  const height = 360;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const leftDistance = Math.hypot((x - 65) / 210, (y - 335) / 145);
      const rightDistance = Math.hypot((x - 705) / 255, (y - 205) / 240);
      const leftShadow = Math.max(0, 1 - leftDistance);
      const rightShadow = Math.max(0, 1 - rightDistance);
      const shadow = Math.max(leftShadow, rightShadow);
      const noiseSeed = (x * 37 + y * 61 + ((x * y) % 97)) % 53;
      const grain = ((noiseSeed - 26) / 26) * 58 * shadow;
      const value = Math.max(
        18,
        Math.min(246, Math.round(242 - shadow * 205 + grain)),
      );
      const offset = (y * width + x) * 4;
      imageData.data[offset] = value;
      imageData.data[offset + 1] = value;
      imageData.data[offset + 2] = value;
      imageData.data[offset + 3] = 255;
    }
  }
  context.putImageData(imageData, 0, 0);

  context.strokeStyle = "#111";
  context.lineWidth = 7;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(275, 132);
  context.bezierCurveTo(305, 55, 335, 175, 365, 82);
  context.bezierCurveTo(390, 30, 415, 165, 450, 70);
  context.bezierCurveTo(475, 42, 500, 138, 530, 76);
  context.stroke();
  return canvas.toBuffer("image/png");
}

function createPortraitSignaturePng(): Buffer {
  const canvas = createCanvas(480, 900);
  const context = canvas.getContext("2d");
  context.fillStyle = "#d4d2ce";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(240, 275);
  context.rotate(Math.PI / 2);
  context.strokeStyle = "#151515";
  context.lineWidth = 8;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const startX of [10, 95, 180]) {
    context.beginPath();
    context.moveTo(startX, 18);
    context.bezierCurveTo(startX + 12, -26, startX + 35, 34, startX + 56, -12);
    context.lineTo(startX + 48, 22);
    context.stroke();
  }
  context.restore();
  return canvas.toBuffer("image/png");
}

describe("转正在线申请单", () => {
  it("只接受前端确认并转换后的有效 PNG 电子签名", () => {
    const png = createSignaturePng();
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    expect(decodePngSignatureDataUrl(dataUrl)).toEqual(png);
    expect(() =>
      decodePngSignatureDataUrl("data:image/png;base64,ZmFrZQ=="),
    ).toThrow("电子签名必须为 PNG 图片");
    expect(() =>
      decodePngSignatureDataUrl("data:image/jpeg;base64,ZmFrZQ=="),
    ).toThrow("请上传并确认本人电子签名");
  });

  it("自动去除灰色纸张背景并裁切签名字迹", async () => {
    const normalized = await normalizeSignaturePng(
      createGrayBackgroundSignaturePng(),
    );
    const { data, info } = await sharp(normalized)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaValues = Array.from(
      { length: info.width * info.height },
      (_, index) => data[index * 4 + 3],
    );

    expect(info.width).toBeLessThan(500);
    expect(info.height).toBeLessThan(220);
    expect(alphaValues[0]).toBe(0);
    expect(alphaValues.at(-1)).toBe(0);
    expect(Math.max(...alphaValues)).toBeGreaterThan(220);
    expect(alphaValues.filter((alpha) => alpha === 0).length).toBeGreaterThan(
      alphaValues.length * 0.75,
    );
  });

  it("自动过滤强阴影、纸张颗粒和边缘暗块", async () => {
    const normalized = await normalizeSignaturePng(
      createStrongShadowSignaturePng(),
    );
    const { data, info } = await sharp(normalized)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaValues = Array.from(
      { length: info.width * info.height },
      (_, index) => data[index * 4 + 3],
    );

    expect(info.width).toBeLessThan(360);
    expect(info.height).toBeLessThan(180);
    expect(alphaValues[0]).toBe(0);
    expect(alphaValues.at(-1)).toBe(0);
    expect(Math.max(...alphaValues)).toBeGreaterThan(220);
    expect(alphaValues.filter((alpha) => alpha === 0).length).toBeGreaterThan(
      alphaValues.length * 0.7,
    );

    const secondPass = await normalizeSignaturePng(normalized);
    const secondPassInfo = await sharp(secondPass).metadata();
    expect(Math.abs((secondPassInfo.width ?? 0) - info.width)).toBeLessThan(8);
    expect(Math.abs((secondPassInfo.height ?? 0) - info.height)).toBeLessThan(
      8,
    );
  });

  it("竖拍签名自动完整识别并校正为横向", async () => {
    const normalized = await normalizeSignaturePng(
      createPortraitSignaturePng(),
    );
    const { data, info } = await sharp(normalized)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaValues = Array.from(
      { length: info.width * info.height },
      (_, index) => data[index * 4 + 3],
    );

    expect(info.width).toBeGreaterThan(info.height * 2);
    expect(info.width).toBeGreaterThan(120);
    expect(Math.max(...alphaValues)).toBeGreaterThan(220);
    expect(alphaValues.filter((alpha) => alpha > 40).length).toBeGreaterThan(
      250,
    );
  });

  it("在四级签名齐全后生成单页正式申请单", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "probation-form-"));
    try {
      const templatePath = path.join(directory, "template.pdf");
      const outputPath = path.join(directory, "formal.pdf");
      const signaturePath = path.join(directory, "signature.png");

      const template = await PDFDocument.create();
      template.addPage([595.3, 841.9]);
      fs.writeFileSync(templatePath, await template.save());
      fs.writeFileSync(signaturePath, createSignaturePng());

      await generateProbationApplicationPdf(templatePath, outputPath, {
        applicantName: "测试员工",
        department: "项目部",
        position: "项目经理",
        hireDate: "2026-01-04",
        conversionType: "normal",
        conversionTypeOther: null,
        selfStatement: "本人已完成试用期工作任务，现申请按期转正。",
        signatures: [
          {
            stage: "employee",
            signerName: "测试员工",
            signedAt: "2026-07-21T09:00:00+08:00",
            signaturePath,
            opinion: null,
          },
          {
            stage: "supervisor",
            signerName: "主管",
            signedAt: "2026-07-22T09:00:00+08:00",
            signaturePath,
            opinion: "同意转正。",
          },
          {
            stage: "hr",
            signerName: "人事",
            signedAt: "2026-07-23T09:00:00+08:00",
            signaturePath,
            opinion: "符合转正条件。",
          },
          {
            stage: "general_manager",
            signerName: "总经理",
            signedAt: "2026-07-24T09:00:00+08:00",
            signaturePath,
            opinion: "同意转正。",
          },
        ],
      });

      const output = await PDFDocument.load(fs.readFileSync(outputPath));
      expect(output.getPageCount()).toBe(1);
      expect(fs.statSync(outputPath).size).toBeGreaterThan(
        fs.statSync(templatePath).size,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("总经理审批签名缺失时不生成转正结论和正式文件", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "probation-form-"));
    try {
      const templatePath = path.join(directory, "template.pdf");
      const outputPath = path.join(directory, "formal.pdf");
      const signaturePath = path.join(directory, "signature.png");

      const template = await PDFDocument.create();
      template.addPage([595.3, 841.9]);
      fs.writeFileSync(templatePath, await template.save());
      fs.writeFileSync(signaturePath, createSignaturePng());

      await expect(
        generateProbationApplicationPdf(templatePath, outputPath, {
          applicantName: "测试员工",
          department: "项目部",
          position: "项目经理",
          hireDate: "2026-01-04",
          conversionType: "normal",
          conversionTypeOther: null,
          selfStatement: "本人申请转正。",
          signatures: [
            {
              stage: "employee",
              signerName: "测试员工",
              signedAt: "2026-07-21T09:00:00+08:00",
              signaturePath,
              opinion: null,
            },
            {
              stage: "supervisor",
              signerName: "主管",
              signedAt: "2026-07-22T09:00:00+08:00",
              signaturePath,
              opinion: "同意。",
            },
            {
              stage: "hr",
              signerName: "人事",
              signedAt: "2026-07-23T09:00:00+08:00",
              signaturePath,
              opinion: "同意。",
            },
          ],
        }),
      ).rejects.toThrow("转正申请单缺少general_manager签名");
      expect(fs.existsSync(outputPath)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
