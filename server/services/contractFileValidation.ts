import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

export type ContractDocumentKind = "pdf" | "doc" | "docx" | "jpeg" | "png";

const MAX_PDF_PAGES = 40;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_DOCX_ENTRIES = 5_000;

/**
 * 文件头只能判断“像什么文件”。归档前还必须实际解析容器或解码图片，
 * 避免截断文件、伪造文件头和异常像素文件进入永久档案。
 */
export async function assertContractFileStructure(
  buffer: Buffer,
  kind: ContractDocumentKind,
): Promise<void> {
  if (buffer.length === 0) throw new Error("文件内容为空");

  if (kind === "pdf") {
    let document: PDFDocument;
    try {
      document = await PDFDocument.load(buffer, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
    } catch {
      throw new Error("PDF 文档损坏、结构异常或已加密");
    }
    const pages = document.getPages();
    if (pages.length < 1 || pages.length > MAX_PDF_PAGES) {
      throw new Error(`PDF 页数必须在 1 至 ${MAX_PDF_PAGES} 页之间`);
    }
    for (const page of pages) {
      const { width, height } = page.getSize();
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        throw new Error("PDF 页面尺寸异常");
      }
    }
    return;
  }

  if (kind === "jpeg" || kind === "png") {
    let metadata: sharp.Metadata;
    try {
      const image = sharp(buffer, {
        failOn: "error",
        limitInputPixels: MAX_IMAGE_PIXELS,
      });
      metadata = await image.metadata();
      // metadata 只读取图片头；缩放到 1 像素会触发完整解码并发现截断数据。
      await image.clone().resize(1, 1, { fit: "fill" }).toBuffer();
    } catch {
      throw new Error("图片损坏、像素尺寸异常或超过安全限制");
    }
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const expectedFormat = kind === "png" ? "png" : "jpeg";
    if (
      metadata.format !== expectedFormat ||
      width < 1 ||
      height < 1 ||
      width * height > MAX_IMAGE_PIXELS
    ) {
      throw new Error("图片真实格式或像素尺寸不受支持");
    }
    return;
  }

  if (kind === "docx") {
    let archive: JSZip;
    try {
      archive = await JSZip.loadAsync(buffer);
    } catch {
      throw new Error("DOCX 文档容器已损坏");
    }
    if (Object.keys(archive.files).length > MAX_DOCX_ENTRIES) {
      throw new Error("DOCX 文档条目数量异常");
    }
    if (
      !archive.file("[Content_Types].xml") ||
      !archive.file("word/document.xml")
    ) {
      throw new Error("DOCX 文档缺少必要结构");
    }
    return;
  }

  // 旧版 DOC 为 OLE 复合文档；至少校验完整头部及固定字节序字段。
  if (
    buffer.length < 512 ||
    buffer.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1" ||
    buffer.readUInt16LE(28) !== 0xfffe ||
    ![9, 12].includes(buffer.readUInt16LE(30))
  ) {
    throw new Error("DOC 文档结构异常或已截断");
  }
}
