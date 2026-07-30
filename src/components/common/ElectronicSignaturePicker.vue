<template>
  <div class="signature-picker">
    <input
      ref="fileInputRef"
      class="file-input"
      type="file"
      accept="image/png,image/jpeg"
      @change="handleFileChange"
    />
    <div class="upload-actions">
      <el-button :icon="Upload" @click="chooseFile"> 选择签名图片 </el-button>
      <span>
        支持白纸签名照片或透明底图片，PNG（便携式网络图形）、JPG（联合图像专家组），原图不超过
        5MB
      </span>
    </div>

    <div class="signature-preview">
      <img
        v-if="uploadSignature"
        :src="uploadSignature"
        alt="待确认的电子签名"
      />
      <el-empty v-else description="请选择签名图片" :image-size="64" />
    </div>
    <div v-if="uploadSignature" class="orientation-actions">
      <el-tooltip content="向左旋转" placement="top">
        <el-button
          circle
          :icon="RefreshLeft"
          aria-label="向左旋转签名"
          @click="rotateUploadedSignature(-90)"
        />
      </el-tooltip>
      <el-tooltip content="向右旋转" placement="top">
        <el-button
          circle
          :icon="RefreshRight"
          aria-label="向右旋转签名"
          @click="rotateUploadedSignature(90)"
        />
      </el-tooltip>
    </div>

    <div class="confirm-actions">
      <el-button
        type="primary"
        :disabled="!uploadSignature"
        @click="confirmUploadedSignature"
      >
        使用此签名
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { RefreshLeft, RefreshRight, Upload } from "@element-plus/icons-vue";
import {
  extractSignaturePixels,
  shouldRotateSignatureToLandscape,
} from "@server/utils/signature-pixel-processing";

const emit = defineEmits<{
  (event: "confirm", dataUrl: string): void;
}>();

const fileInputRef = ref<HTMLInputElement>();
const uploadSignature = ref("");

function chooseFile() {
  fileInputRef.value?.click();
}

function confirmUploadedSignature() {
  if (uploadSignature.value) emit("confirm", uploadSignature.value);
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  if (!["image/png", "image/jpeg"].includes(file.type)) {
    ElMessage.error(
      "签名图片只支持 PNG（便携式网络图形）或 JPG（联合图像专家组）格式",
    );
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error("签名图片原图不能超过 5MB");
    return;
  }

  try {
    uploadSignature.value = await normalizeSignatureImage(file);
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : "签名图片处理失败",
    );
  }
}

function loadImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const image = document.createElement("img");
  return new Promise<typeof image>((resolve, reject) => {
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取签名图片"));
    };
    image.src = objectUrl;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rotateCanvas(
  source: HTMLCanvasElement,
  degrees: -90 | 90,
): HTMLCanvasElement {
  const output = document.createElement("canvas");
  output.width = source.height;
  output.height = source.width;
  const context = output.getContext("2d");
  if (!context) throw new Error("浏览器无法调整签名方向");

  if (degrees === 90) {
    context.translate(source.height, 0);
    context.rotate(Math.PI / 2);
  } else {
    context.translate(0, source.width);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(source, 0, 0);
  return output;
}

function loadDataUrlImage(dataUrl: string) {
  const image = document.createElement("img");
  return new Promise<typeof image>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取处理后的签名图片"));
    image.src = dataUrl;
  });
}

async function rotateUploadedSignature(degrees: -90 | 90) {
  if (!uploadSignature.value) return;

  try {
    const image = await loadDataUrlImage(uploadSignature.value);
    const source = document.createElement("canvas");
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    const context = source.getContext("2d");
    if (!context) throw new Error("浏览器无法调整签名方向");
    context.drawImage(image, 0, 0);
    uploadSignature.value = rotateCanvas(source, degrees).toDataURL(
      "image/png",
    );
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : "签名方向调整失败",
    );
  }
}

async function normalizeSignatureImage(file: File): Promise<string> {
  const image = await loadImage(file);
  const scale = Math.min(1, 1200 / image.width, 600 / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器无法处理签名图片");

  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const processed = extractSignaturePixels(imageData.data, width, height);
  imageData.data.set(processed.pixels);
  context.putImageData(imageData, 0, 0);

  const { minX, minY, maxX, maxY } = processed.bounds;
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const padding = clamp(
    Math.round(Math.max(cropWidth, cropHeight) * 0.04),
    4,
    16,
  );
  const output = document.createElement("canvas");
  output.width = cropWidth + padding * 2;
  output.height = cropHeight + padding * 2;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("浏览器无法生成签名图片");
  outputContext.drawImage(
    source,
    minX,
    minY,
    cropWidth,
    cropHeight,
    padding,
    padding,
    cropWidth,
    cropHeight,
  );

  const orientedOutput = shouldRotateSignatureToLandscape(processed.bounds)
    ? rotateCanvas(output, -90)
    : output;
  const result = orientedOutput.toDataURL("image/png");
  if (result.length > 2.7 * 1024 * 1024) {
    throw new Error("处理后的签名图片过大，请换一张更清晰、留白更少的图片");
  }
  return result;
}
</script>

<style scoped>
.signature-picker {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.file-input {
  display: none;
}

.upload-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.upload-actions span {
  color: #909399;
  font-size: 12px;
}

.signature-preview {
  display: grid;
  min-height: 180px;
  place-items: center;
  overflow: hidden;
  border: 1px dashed #c0c4cc;
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #eef0f3 25%, transparent 25%),
    linear-gradient(-45deg, #eef0f3 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eef0f3 75%),
    linear-gradient(-45deg, transparent 75%, #eef0f3 75%);
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  background-size: 16px 16px;
}

.signature-preview img {
  display: block;
  max-width: 90%;
  max-height: 150px;
  object-fit: contain;
}

.orientation-actions {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 560px) {
  .upload-actions {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
