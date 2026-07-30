import { normalizeUploadFileName } from "../server/utils/upload-file-name";

describe("上传文件名编码", () => {
  it("修复被按单字节字符集解释的中文文件名", () => {
    const garbled = Buffer.from("工资回单明细.pdf", "utf8").toString("latin1");
    expect(normalizeUploadFileName(garbled)).toBe("工资回单明细.pdf");
  });

  it("优先使用前端提交的原始文件名并移除路径", () => {
    expect(
      normalizeUploadFileName("garbled.pdf", "../2026年6月工资回单.pdf"),
    ).toBe("2026年6月工资回单.pdf");
  });
});
