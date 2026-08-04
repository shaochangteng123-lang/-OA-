<template>
  <div class="probation-template-editor">
    <el-alert
      v-if="errorMessage"
      type="error"
      :closable="false"
      show-icon
      :title="errorMessage"
    />

    <div
      v-else
      ref="editorViewportRef"
      v-loading="loading"
      class="template-scroll"
    >
      <div class="template-viewport" :style="templateViewportStyle">
        <div class="template-sheet" :style="templateSheetStyle">
          <canvas ref="templateCanvasRef" class="template-canvas" />

          <div
            class="overlay-text centered auto-field"
            :style="boxStyle(150, 123, 81, 39)"
          >
            {{ applicantName || "-" }}
          </div>
          <div
            class="overlay-text centered auto-field compact"
            :style="boxStyle(294, 123, 81, 39)"
          >
            {{ department || "-" }}
          </div>
          <div
            class="overlay-text centered auto-field compact position-field"
            :style="[boxStyle(438, 123, 72, 39), positionFieldTextStyle]"
            :title="position || ''"
          >
            {{ position || "-" }}
          </div>
          <div
            class="overlay-text centered date-cell"
            :style="[
              boxStyle(150, 162, 81, 40),
              compressedSingleLineStyle(formatCellDate(hireDate), 81, 4),
            ]"
          >
            {{ formatCellDate(hireDate) }}
          </div>
          <div
            class="overlay-text centered date-cell"
            :style="[
              boxStyle(294, 162, 81, 40),
              compressedSingleLineStyle(formatCellDate(applicationDate), 81, 4),
            ]"
          >
            {{ formatCellDate(applicationDate) }}
          </div>
          <div
            class="overlay-text centered auto-field compact position-field"
            :style="[boxStyle(438, 162, 72, 40), positionFieldTextStyle]"
            :title="position || ''"
          >
            {{ position || "-" }}
          </div>

          <button
            v-for="item in conversionOptions"
            :key="item.value"
            type="button"
            class="conversion-hit"
            :class="{ editable: mode === 'employee' }"
            :style="boxStyle(item.x, 208, item.width, 25)"
            :disabled="mode !== 'employee'"
            :aria-label="item.label"
            :aria-pressed="conversionTypeModel === item.value"
            @click="conversionTypeModel = item.value"
          />
          <span
            v-if="selectedConversionOption"
            class="conversion-check"
            :style="boxStyle(selectedConversionOption.checkX, 214.5, 12, 14)"
            >✓</span
          >
          <input
            v-if="conversionTypeModel === 'other'"
            v-model="conversionTypeOtherModel"
            class="template-input other-type-input"
            :class="{ readonly: mode !== 'employee' }"
            :style="boxStyle(455, 213, 49, 18)"
            :readonly="mode !== 'employee'"
            maxlength="30"
            aria-label="其他转正类型"
          />

          <textarea
            v-if="mode === 'employee'"
            v-model="selfStatementModel"
            class="template-textarea statement-editor"
            :style="boxStyle(158, 250, 343, 125)"
            maxlength="3000"
            placeholder="请在此填写本人述职"
            aria-label="本人述职"
          />
          <div
            v-else
            class="overlay-text multiline"
            :style="boxStyle(158, 250, 343, 125)"
          >
            {{ selfStatement || "-" }}
          </div>

          <template v-for="stage in reviewStages" :key="stage.value">
            <textarea
              v-if="mode === stage.value"
              v-model="opinionModel"
              class="template-textarea opinion-editor"
              :style="boxStyle(158, stage.opinionTop, 343, 45)"
              maxlength="1000"
              :placeholder="`请填写${stage.label}；如需驳回，请写明理由`"
              :aria-label="stage.label"
            />
            <div
              v-else-if="signatureForStage(stage.value)?.opinion"
              class="overlay-text multiline opinion-text"
              :style="boxStyle(158, stage.opinionTop, 343, 45)"
            >
              {{ signatureForStage(stage.value)?.opinion }}
            </div>
          </template>

          <template v-for="row in signatureRows" :key="row.stage">
            <img
              v-if="signatureImageForStage(row.stage)"
              class="signature-image"
              :src="signatureImageForStage(row.stage)"
              :alt="`${row.label}电子签名`"
              :style="boxStyle(255, row.signatureTop, 78, 30)"
            />
            <button
              v-if="mode === row.stage && !signatureDataUrl"
              type="button"
              class="signature-trigger"
              :style="boxStyle(251, row.signatureTop - 2, 86, 34)"
              :disabled="personalSignatureLoading"
              aria-label="调用个人电子签名"
              @click="handleSignatureClick"
            >
              <span>{{ personalSignatureLoading ? "调用中" : "签名" }}</span>
            </button>

            <template v-if="signatureDateForStage(row.stage)">
              <span
                class="signature-date-part"
                :style="dateBoxStyle(386, row.dateTop, 33)"
              >
                {{ dateParts(signatureDateForStage(row.stage)).year }}
              </span>
              <span
                class="signature-date-part"
                :style="dateBoxStyle(433, row.dateTop, 20)"
              >
                {{ dateParts(signatureDateForStage(row.stage)).month }}
              </span>
              <span
                class="signature-date-part"
                :style="dateBoxStyle(468, row.dateTop, 20)"
              >
                {{ dateParts(signatureDateForStage(row.stage)).day }}
              </span>
            </template>
          </template>

          <template v-if="finalApprovalDate">
            <div
              class="overlay-text centered conclusion-text"
              :style="[
                boxStyle(342, 663, 62, 18),
                compressedSingleLineStyle(applicantName, 62),
              ]"
            >
              {{ applicantName }}
            </div>
            <div
              class="overlay-text centered conclusion-text"
              :style="[
                boxStyle(168, 686, 59, 18),
                compressedSingleLineStyle(position, 59),
              ]"
            >
              {{ position }}
            </div>
            <div
              class="overlay-text centered conclusion-text"
              :style="[
                boxStyle(265, 686, 72, 18),
                compressedSingleLineStyle(position, 72),
              ]"
            >
              {{ position }}
            </div>
            <span
              class="signature-date-part"
              :style="dateBoxStyle(386, CONCLUSION_DATE_TOP, 33)"
            >
              {{ dateParts(finalApprovalDate).year }}
            </span>
            <span
              class="signature-date-part"
              :style="dateBoxStyle(433, CONCLUSION_DATE_TOP, 20)"
            >
              {{ dateParts(finalApprovalDate).month }}
            </span>
            <span
              class="signature-date-part"
              :style="dateBoxStyle(468, CONCLUSION_DATE_TOP, 20)"
            >
              {{ dateParts(finalApprovalDate).day }}
            </span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import dayjs from "dayjs";
import * as pdfjsLib from "pdfjs-dist";
import { ElMessage } from "element-plus";
import { api } from "@/utils/api";
import {
  loadPersonalSignature,
  type PersonalSignatureType,
} from "@/utils/personalSignature";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

type ConversionType = "normal" | "early" | "extended" | "other";
type EditableStage = "employee" | "supervisor" | "hr" | "general_manager";
type EditorMode = EditableStage | "readonly";

interface ProbationTemplateSignature {
  id: string;
  stage: EditableStage;
  signer_name: string;
  signature_type?: "personal" | "general_manager";
  signature_owner_name?: string;
  opinion: string | null;
  decision: "submit" | "approve" | "reject";
  signed_at: string;
  signature_image_url?: string;
}

const props = withDefaults(
  defineProps<{
    mode: EditorMode;
    applicantName: string;
    department?: string | null;
    position?: string | null;
    hireDate?: string | null;
    conversionType?: ConversionType;
    conversionTypeOther?: string;
    selfStatement?: string;
    opinion?: string;
    signatureDataUrl?: string;
    signatureType?: PersonalSignatureType;
    signatures?: ProbationTemplateSignature[];
  }>(),
  {
    department: "",
    position: "",
    hireDate: "",
    conversionType: "normal",
    conversionTypeOther: "",
    selfStatement: "",
    opinion: "",
    signatureDataUrl: "",
    signatureType: "personal",
    signatures: () => [],
  },
);

const emit = defineEmits<{
  (event: "update:conversionType", value: ConversionType): void;
  (event: "update:conversionTypeOther", value: string): void;
  (event: "update:selfStatement", value: string): void;
  (event: "update:opinion", value: string): void;
  (event: "update:signatureDataUrl", value: string): void;
  (event: "update:signatureType", value: PersonalSignatureType): void;
  (event: "ready", value: boolean): void;
}>();

const TEMPLATE_WIDTH = 595.3;
const TEMPLATE_HEIGHT = 841.9;
const CONCLUSION_DATE_TOP = 737;
const templateCanvasRef = ref<HTMLCanvasElement>();
const editorViewportRef = ref<HTMLDivElement>();
const loading = ref(true);
const errorMessage = ref("");
const sheetScale = ref(1);
const personalSignatureLoading = ref(false);
let resizeObserver: InstanceType<typeof globalThis.ResizeObserver> | null =
  null;
let renderGeneration = 0;
let activePdf: Awaited<
  ReturnType<typeof pdfjsLib.getDocument>["promise"]
> | null = null;

const conversionOptions = [
  {
    value: "normal" as const,
    label: "正常转正",
    x: 155,
    checkX: 160.5,
    width: 84,
  },
  {
    value: "early" as const,
    label: "提前转正",
    x: 240,
    checkX: 245.5,
    width: 84,
  },
  {
    value: "extended" as const,
    label: "延期考核",
    x: 325,
    checkX: 330.5,
    width: 84,
  },
  {
    value: "other" as const,
    label: "其他",
    x: 410,
    checkX: 415.5,
    width: 99,
  },
];

const reviewStages = [
  {
    value: "supervisor" as const,
    label: "主管领导意见",
    opinionTop: 420,
  },
  { value: "hr" as const, label: "人事部意见", opinionTop: 502 },
  {
    value: "general_manager" as const,
    label: "董事长审批意见",
    opinionTop: 584,
  },
];

const signatureRows = [
  {
    stage: "employee" as const,
    label: "员工本人",
    signatureTop: 379,
    dateTop: 392,
  },
  {
    stage: "supervisor" as const,
    label: "主管领导",
    signatureTop: 461,
    dateTop: 470,
  },
  {
    stage: "hr" as const,
    label: "人事部",
    signatureTop: 543,
    dateTop: 552,
  },
  {
    stage: "general_manager" as const,
    label: "董事长",
    signatureTop: 625,
    dateTop: 634,
  },
];

const conversionTypeModel = computed({
  get: () => props.conversionType,
  set: (value: ConversionType) => emit("update:conversionType", value),
});
const conversionTypeOtherModel = computed({
  get: () => props.conversionTypeOther,
  set: (value: string) => emit("update:conversionTypeOther", value),
});
const selfStatementModel = computed({
  get: () => props.selfStatement,
  set: (value: string) => emit("update:selfStatement", value),
});
const opinionModel = computed({
  get: () => props.opinion,
  set: (value: string) => emit("update:opinion", value),
});
const selectedConversionOption = computed(() =>
  conversionOptions.find((item) => item.value === conversionTypeModel.value),
);
const visibleSignatures = computed(() =>
  props.mode === "employee"
    ? []
    : props.signatures.filter((item) => item.decision !== "reject"),
);
const employeeSignature = computed(() => signatureForStage("employee"));
const finalApprovalDate = computed(() =>
  signatureDateForStage("general_manager"),
);
const applicationDate = computed(() => {
  if (employeeSignature.value) return employeeSignature.value.signed_at;
  return props.mode === "employee" && props.signatureDataUrl
    ? new Date().toISOString()
    : "";
});
const positionFieldTextStyle = computed(() => {
  return compressedSingleLineStyle(props.position || "", 72, 14);
});
const templateViewportStyle = computed(() => ({
  width: `${TEMPLATE_WIDTH * sheetScale.value}px`,
  height: `${TEMPLATE_HEIGHT * sheetScale.value}px`,
}));
const templateSheetStyle = computed(() => ({
  transform: `scale(${sheetScale.value})`,
}));

function compressedSingleLineStyle(
  value: string | null | undefined,
  width: number,
  horizontalPadding = 0,
) {
  const visualLength = Array.from((value || "").trim()).reduce(
    (total, character) =>
      total + ((character.codePointAt(0) || 0) <= 0x7f ? 0.55 : 1),
    0,
  );
  const estimatedWidth = visualLength * 13;
  const availableWidth = Math.max(1, width - horizontalPadding - 2);
  const scaleX =
    estimatedWidth > availableWidth ? availableWidth / estimatedWidth : 1;
  return {
    fontSize: "13px",
    overflow: "visible",
    transform: `scaleX(${scaleX})`,
    transformOrigin: "center center",
  };
}

function boxStyle(left: number, top: number, width: number, height: number) {
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
}

function dateBoxStyle(left: number, top: number, width: number) {
  return boxStyle(left, top, width, 17);
}

function formatCellDate(value: string | null | undefined) {
  if (!value || !dayjs(value).isValid()) return "";
  return dayjs(value).format("YYYY年M月D日");
}

function dateParts(value: string | null | undefined) {
  const date = dayjs(value || "");
  return {
    year: date.isValid() ? date.format("YYYY") : "",
    month: date.isValid() ? date.format("M") : "",
    day: date.isValid() ? date.format("D") : "",
  };
}

function signatureForStage(stage: EditableStage) {
  return visibleSignatures.value.find((item) => item.stage === stage) || null;
}

function signatureImageForStage(stage: EditableStage) {
  if (props.mode === stage && props.signatureDataUrl) {
    return props.signatureDataUrl;
  }
  return signatureForStage(stage)?.signature_image_url || "";
}

function signatureDateForStage(stage: EditableStage) {
  if (props.mode === stage && props.signatureDataUrl) {
    return new Date().toISOString();
  }
  return signatureForStage(stage)?.signed_at || "";
}

async function handleSignatureClick() {
  if (props.signatureDataUrl) return;

  personalSignatureLoading.value = true;
  try {
    const signature = await loadPersonalSignature();
    if (!signature) {
      ElMessage.warning("请先前往个人设置上传个人电子签名");
    } else {
      emit("update:signatureType", "personal");
      emit("update:signatureDataUrl", signature.dataUrl);
    }
  } catch (error) {
    console.error("加载个人电子签名失败:", error);
    ElMessage.error("个人电子签名加载失败，请稍后重试");
  } finally {
    personalSignatureLoading.value = false;
  }
}

function updateScale() {
  const viewportWidth = editorViewportRef.value?.clientWidth || TEMPLATE_WIDTH;
  const availableWidth = Math.max(300, viewportWidth - 32);
  sheetScale.value = Math.min(1.2, availableWidth / TEMPLATE_WIDTH);
}

async function loadTemplate() {
  const generation = ++renderGeneration;
  loading.value = true;
  errorMessage.value = "";
  emit("ready", false);

  try {
    const response = await api.get("/api/probation/template-preview", {
      responseType: "arraybuffer",
    });
    if (generation !== renderGeneration) return;

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(response.data),
      cMapUrl: "/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/standard_fonts/",
    });
    const pdf = await loadingTask.promise;
    activePdf = pdf;
    if (pdf.numPages !== 1) {
      throw new Error(
        "管理员上传的转正申请单模板必须为单页 PDF（便携式文档格式）",
      );
    }

    await nextTick();
    const canvas = templateCanvasRef.value;
    if (!canvas) throw new Error("转正申请单模板画布初始化失败");
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${TEMPLATE_WIDTH}px`;
    canvas.style.height = `${TEMPLATE_HEIGHT}px`;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法显示转正申请单模板");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    if (generation !== renderGeneration) return;

    emit("ready", true);
  } catch (error: unknown) {
    if (generation !== renderGeneration) return;
    console.error("加载转正申请单原始模板失败:", error);
    const requestError = error as {
      response?: { status?: number };
      message?: string;
    };
    errorMessage.value =
      requestError.response?.status === 404
        ? "管理员尚未上传转正申请单模板"
        : requestError.message || "转正申请单模板加载失败";
  } finally {
    if (generation === renderGeneration) loading.value = false;
  }
}

onMounted(() => {
  resizeObserver = new globalThis.ResizeObserver(updateScale);
  if (editorViewportRef.value) {
    resizeObserver.observe(editorViewportRef.value);
  }
  updateScale();
  void loadTemplate();
});

onBeforeUnmount(() => {
  renderGeneration += 1;
  resizeObserver?.disconnect();
  resizeObserver = null;
  void activePdf?.destroy();
  activePdf = null;
});
</script>

<style scoped>
.probation-template-editor {
  width: 100%;
}

.template-scroll {
  box-sizing: border-box;
  width: 100%;
  min-height: 420px;
  max-height: 68vh;
  padding: 16px;
  overflow: auto;
  background: #e7e9ed;
}

.template-viewport {
  position: relative;
  margin: 0 auto;
}

.template-sheet {
  position: absolute;
  top: 0;
  left: 0;
  width: 595.3px;
  height: 841.9px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 2px 10px rgb(0 0 0 / 15%);
  transform-origin: top left;
}

.template-canvas {
  position: absolute;
  inset: 0;
  display: block;
}

.overlay-text,
.template-input,
.template-textarea,
.signature-image,
.signature-trigger,
.signature-date-part,
.conversion-hit,
.conversion-check {
  position: absolute;
  box-sizing: border-box;
}

.overlay-text {
  z-index: 2;
  padding: 2px;
  overflow: hidden;
  color: #000;
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  font-size: 10.5px;
  line-height: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.overlay-text.centered {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  white-space: nowrap;
}

.auto-field {
  font-size: 13px;
}

.auto-field.compact {
  font-size: 13px;
}

.position-field {
  padding-right: 7px;
  padding-left: 7px;
}

.date-cell {
  font-size: 13px;
}

.multiline {
  padding: 2px;
  line-height: 16px;
}

.opinion-text {
  font-size: 10px;
  line-height: 14px;
}

.conclusion-text {
  padding: 0;
  font-size: 13px;
  line-height: 18px;
}

.template-input,
.template-textarea {
  z-index: 4;
  color: #000;
  outline: none;
  border: 1px solid transparent;
  border-radius: 2px;
  background: rgb(255 255 255 / 88%);
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  resize: none;
  transition: border-color 0.15s ease;
}

.template-input:hover,
.template-input:focus,
.template-textarea:hover,
.template-textarea:focus {
  border-color: #409eff;
}

.template-input.readonly {
  pointer-events: none;
  border-color: transparent;
  background: transparent;
}

.other-type-input {
  padding: 0 2px;
  background: transparent;
  font-size: 9px;
  text-align: center;
}

.statement-editor {
  padding: 3px;
  font-size: 10.5px;
  line-height: 16px;
}

.opinion-editor {
  padding: 3px;
  font-size: 10px;
  line-height: 14px;
}

.conversion-hit {
  z-index: 5;
  padding: 0;
  border: 0;
  background: transparent;
}

.conversion-hit.editable {
  cursor: pointer;
}

.conversion-hit.editable:hover {
  outline: 1px solid #409eff;
  outline-offset: -1px;
}

.conversion-check {
  z-index: 6;
  display: grid;
  padding: 0;
  color: #000;
  font-family: Arial, sans-serif;
  font-size: 13px;
  font-weight: 700;
  line-height: 14px;
  place-items: center;
  pointer-events: none;
}

.signature-image {
  z-index: 3;
  object-fit: contain;
}

.signature-trigger {
  z-index: 6;
  display: grid;
  padding: 0;
  color: #409eff;
  border: 1px dashed #409eff;
  border-radius: 2px;
  background: rgb(236 245 255 / 72%);
  cursor: pointer;
  font-size: 9px;
  line-height: 1;
  place-items: center;
}

.signature-trigger:hover {
  border-color: #409eff;
  background: rgb(236 245 255 / 34%);
}

.signature-date-part {
  z-index: 3;
  display: grid;
  color: #000;
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  font-size: 13px;
  line-height: 17px;
  place-items: center;
}

@media (max-width: 640px) {
  .template-scroll {
    min-height: 360px;
    max-height: 64vh;
    padding: 10px;
  }
}
</style>
