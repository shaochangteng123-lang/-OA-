/** @jest-environment node */

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { assertContractFileStructure } from "../server/services/contractFileValidation";

describe("合同上传文件结构校验", () => {
  it("接受可完整解析的 PDF 并拒绝伪造文件头", async () => {
    const document = await PDFDocument.create();
    document.addPage([595, 842]);
    const valid = Buffer.from(await document.save());

    await expect(assertContractFileStructure(valid, "pdf")).resolves.toBeUndefined();
    await expect(
      assertContractFileStructure(Buffer.from("%PDF-伪内容"), "pdf"),
    ).rejects.toThrow("PDF 文档损坏");
  });

  it("完整解码图片并拒绝只有魔术字节的截断文件", async () => {
    const validPng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer();

    await expect(
      assertContractFileStructure(validPng, "png"),
    ).resolves.toBeUndefined();
    await expect(
      assertContractFileStructure(
        Buffer.from("89504e470d0a1a0a", "hex"),
        "png",
      ),
    ).rejects.toThrow("图片损坏");
  });

  it("校验 DOCX 必要容器结构", async () => {
    const validArchive = new JSZip();
    validArchive.file("[Content_Types].xml", "<Types />");
    validArchive.file("word/document.xml", "<w:document />");
    const valid = await validArchive.generateAsync({ type: "nodebuffer" });
    const invalidArchive = new JSZip();
    invalidArchive.file("random.txt", "not a document");
    const invalid = await invalidArchive.generateAsync({ type: "nodebuffer" });

    await expect(assertContractFileStructure(valid, "docx")).resolves.toBeUndefined();
    await expect(assertContractFileStructure(invalid, "docx")).rejects.toThrow(
      "缺少必要结构",
    );
  });

  it("旧版 DOC 必须具备完整 OLE 复合文档头", async () => {
    const valid = Buffer.alloc(512);
    Buffer.from("d0cf11e0a1b11ae1", "hex").copy(valid, 0);
    valid.writeUInt16LE(0xfffe, 28);
    valid.writeUInt16LE(9, 30);

    await expect(assertContractFileStructure(valid, "doc")).resolves.toBeUndefined();
    await expect(
      assertContractFileStructure(Buffer.alloc(512), "doc"),
    ).rejects.toThrow("DOC 文档结构异常");
  });
});
