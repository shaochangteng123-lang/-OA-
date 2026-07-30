import path from "path";

function decodeLatin1Utf8(value: string): string {
  if ([...value].some((character) => character.charCodeAt(0) > 255)) {
    return value;
  }

  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? value : decoded;
}

export function normalizeUploadFileName(
  multerFileName: string,
  providedFileName?: string | null,
): string {
  const source = String(providedFileName || multerFileName || "未命名文件");
  const decoded = providedFileName ? source : decodeLatin1Utf8(source);
  const safeName = Array.from(path.basename(decoded).normalize("NFC"))
    .filter((character) => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join("")
    .trim();

  return Array.from(safeName || "未命名文件")
    .slice(0, 255)
    .join("");
}
