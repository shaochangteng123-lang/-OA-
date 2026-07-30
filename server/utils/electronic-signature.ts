import sharp from "sharp";
import {
  extractSignaturePixels,
  shouldRotateSignatureToLandscape,
} from "./signature-pixel-processing.js";

const PNG_SIGNATURE_PREFIX = "data:image/png;base64,";
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePngSignatureDataUrl(value: unknown): Buffer {
  if (typeof value !== "string" || !value.startsWith(PNG_SIGNATURE_PREFIX)) {
    throw new Error("请上传并确认本人电子签名");
  }

  const encoded = value.slice(PNG_SIGNATURE_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("电子签名数据格式不正确");
  }

  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0 || buffer.length > MAX_SIGNATURE_BYTES) {
    throw new Error("电子签名大小不能超过 2MB");
  }
  if (
    buffer.length < PNG_MAGIC.length ||
    !buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)
  ) {
    throw new Error("电子签名必须为 PNG 图片");
  }
  return buffer;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export async function normalizeSignaturePng(buffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buffer, {
    failOn: "error",
    limitInputPixels: 20_000_000,
  })
    .resize({
      width: 1200,
      height: 600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 4) {
    throw new Error("电子签名图片通道不正确");
  }

  const processed = extractSignaturePixels(data, info.width, info.height);
  const { minX, minY, maxX, maxY } = processed.bounds;

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const padding = clamp(
    Math.round(Math.max(cropWidth, cropHeight) * 0.04),
    4,
    16,
  );
  const cropped = sharp(Buffer.from(processed.pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .extract({
      left: minX,
      top: minY,
      width: cropWidth,
      height: cropHeight,
    })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    });
  const oriented = shouldRotateSignatureToLandscape(processed.bounds)
    ? cropped.rotate(270)
    : cropped;

  return oriented.png({ compressionLevel: 9 }).toBuffer();
}
