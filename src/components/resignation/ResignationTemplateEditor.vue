<template>
  <div
    ref="editorRootRef"
    class="resignation-template-editor"
    tabindex="0"
    @keydown="handleEditorKeydown"
  >
    <div class="editor-toolbar">
      <div class="toolbar-group">
        <el-tooltip content="撤销" placement="bottom">
          <el-button
            :icon="RefreshLeft"
            :disabled="disabled || loading || !canUndo"
            aria-label="撤销"
            @click="undo"
          />
        </el-tooltip>
        <el-tooltip content="重做" placement="bottom">
          <el-button
            :icon="RefreshRight"
            :disabled="disabled || loading || !canRedo"
            aria-label="重做"
            @click="redo"
          />
        </el-tooltip>
      </div>

      <template v-if="selectedFieldItem || selectedCustomItem">
        <span class="toolbar-divider" />
        <el-tooltip content="文字方向" placement="bottom">
          <el-radio-group
            :model-value="selectedTextAlign"
            size="small"
            :disabled="disabled"
            aria-label="文字方向"
            @change="(value) => updateSelectedAlign(String(value))"
          >
            <el-radio-button value="left">左</el-radio-button>
            <el-radio-button value="center">中</el-radio-button>
            <el-radio-button value="right">右</el-radio-button>
          </el-radio-group>
        </el-tooltip>
      </template>

      <template v-if="selectedCustomItem">
        <div class="color-swatches" aria-label="文字颜色">
          <el-tooltip content="黑色文字" placement="bottom">
            <button
              type="button"
              class="color-swatch black"
              :class="{ active: selectedCustomItem.color === '#000000' }"
              aria-label="黑色文字"
              @click="updateSelectedColor('#000000')"
            />
          </el-tooltip>
          <el-tooltip content="红色文字" placement="bottom">
            <button
              type="button"
              class="color-swatch red"
              :class="{ active: selectedCustomItem.color === '#C80000' }"
              aria-label="红色文字"
              @click="updateSelectedColor('#C80000')"
            />
          </el-tooltip>
        </div>
        <el-tooltip content="复制所选文字" placement="bottom">
          <el-button
            :icon="CopyDocument"
            :disabled="disabled"
            aria-label="复制所选文字"
            @click="duplicateSelectedCustomItem"
          />
        </el-tooltip>
        <el-tooltip content="删除所选文字" placement="top">
          <el-button
            type="danger"
            plain
            :icon="Delete"
            :disabled="disabled"
            aria-label="删除所选文字"
            @click="deleteSelectedCustomItem"
          />
        </el-tooltip>
      </template>

      <div class="toolbar-spacer" />

      <div class="toolbar-group zoom-controls">
        <el-tooltip content="缩小页面" placement="bottom">
          <el-button
            :icon="ZoomOut"
            :disabled="loading || sheetScale <= MIN_ZOOM"
            aria-label="缩小页面"
            @click="changeZoom(-ZOOM_STEP)"
          />
        </el-tooltip>
        <span class="zoom-value">{{ zoomLabel }}</span>
        <el-tooltip content="放大页面" placement="bottom">
          <el-button
            :icon="ZoomIn"
            :disabled="loading || sheetScale >= MAX_ZOOM"
            aria-label="放大页面"
            @click="changeZoom(ZOOM_STEP)"
          />
        </el-tooltip>
        <el-tooltip content="适合页面宽度" placement="bottom">
          <el-button
            :icon="FullScreen"
            :disabled="loading"
            aria-label="适合页面宽度"
            @click="fitToWidth"
          />
        </el-tooltip>
      </div>
    </div>

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
      <section
        v-for="pageNumber in pageNumbers"
        :key="pageNumber"
        class="template-page"
      >
        <div class="page-index">第 {{ pageNumber }} 页</div>
        <div class="template-viewport" :style="templateViewportStyle">
          <div
            class="template-sheet"
            :style="templateSheetStyle"
            @click="clearSelection"
          >
            <canvas
              :ref="(element) => setPageCanvasRef(pageNumber, element)"
              class="template-canvas"
            />

            <div
              v-for="box in documentNumberBoxesForPage(pageNumber)"
              :key="`number-${box.page}`"
              class="document-number"
              :style="documentNumberStyle(box)"
            >
              <span :style="documentNumberTextStyle(box)">
                {{ documentNumberCode }}
              </span>
            </div>

            <div
              v-for="item in fieldsForPage(pageNumber)"
              :key="item.key"
              class="template-field"
              :class="{
                selected: selectedFieldKey === item.key,
                'source-backed': item.replaceSourceText,
                'source-unchanged':
                  item.replaceSourceText && item.value === item.sourceText,
              }"
              :style="fieldBoxStyle(item)"
              @click.stop="selectField(item.key, false)"
            >
              <input
                class="template-field-input"
                :style="fieldInputStyle(item)"
                :value="item.value"
                :aria-label="item.label"
                :disabled="disabled"
                :title="item.label"
                @focus="selectField(item.key, false)"
                @input="(event) => updateField(item.key, event)"
              />
            </div>

            <div
              v-for="item in customItemsForPage(pageNumber)"
              :key="item.id"
              class="custom-text-box"
              :class="{ selected: selectedCustomId === item.id }"
              :style="customItemStyle(item)"
              @click.stop="selectCustomItem(item.id, false)"
            >
              <textarea
                :ref="(element) => setCustomTextRef(item.id, element)"
                :value="item.value"
                :disabled="disabled"
                aria-label="自定义填写文字"
                @focus="selectCustomItem(item.id, false)"
                @input="(event) => updateCustomText(item.id, event)"
              />
              <button
                v-if="!disabled"
                type="button"
                class="drag-handle"
                aria-label="移动文字"
                @pointerdown="(event) => startDragging(event, item)"
              >
                <el-icon><Rank /></el-icon>
              </button>
              <button
                v-if="!disabled && selectedCustomId === item.id"
                type="button"
                class="resize-handle"
                aria-label="调整文字区域大小"
                @pointerdown="(event) => startResizing(event, item)"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComponentPublicInstance,
} from "vue";
import * as pdfjsLib from "pdfjs-dist";
import {
  CopyDocument,
  Delete,
  FullScreen,
  Rank,
  RefreshLeft,
  RefreshRight,
  ZoomIn,
  ZoomOut,
} from "@element-plus/icons-vue";
import { api } from "@/utils/api";
import { calculateResignationFieldTextFit } from "@/utils/resignationTemplateText";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

interface ResignationTemplateEditorField {
  key: string;
  label: string;
  page: number;
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  align: "left" | "center" | "right";
  fontFamily?: string;
  color?: string;
  paddingX?: number;
  replaceSourceText?: boolean;
  sourceText?: string;
  value: string;
}

interface ResignationTemplateCustomItem {
  id: string;
  page: number;
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  align: "left" | "center" | "right";
  color: "#000000" | "#C80000";
  value: string;
}

interface ResignationDocumentNumberBox {
  page: number;
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
  color?: string;
}

const props = withDefaults(
  defineProps<{
    previewUrl: string;
    documentNumber: string;
    documentNumberBoxes: ResignationDocumentNumberBox[];
    fields: ResignationTemplateEditorField[];
    customItems: ResignationTemplateCustomItem[];
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:fields": [value: ResignationTemplateEditorField[]];
  "update:customItems": [value: ResignationTemplateCustomItem[]];
  change: [];
  save: [];
  ready: [value: boolean];
}>();

const TEMPLATE_WIDTH = 595.3;
const TEMPLATE_HEIGHT = 841.9;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 0.1;
const DEFAULT_TEMPLATE_FONT_SIZE = 16;
const AUTO_FILL_HORIZONTAL_MARGIN = 2.5;
const AUTO_FILL_FONT_FAMILY =
  '"FangSong_GB2312", "STFangsong", "FangSong SC", "Noto Serif CJK SC", serif';
const DOCUMENT_NUMBER_FONT_FAMILY =
  '"Noto Sans CJK SC", "PingFang SC", "Arial", sans-serif';
const editorRootRef = ref<HTMLDivElement>();
const editorViewportRef = ref<HTMLDivElement>();
const pageCanvases = new Map<number, HTMLCanvasElement>();
const customTextRefs = new Map<
  string,
  InstanceType<typeof globalThis.HTMLTextAreaElement>
>();
const pageCount = ref(0);
const sheetScale = ref(1);
const zoomMode = ref<"fit" | "manual">("fit");
const loading = ref(true);
const errorMessage = ref("");
const selectedFieldKey = ref("");
const selectedCustomId = ref("");
let mounted = false;
let renderGeneration = 0;
let resizeObserver: InstanceType<typeof globalThis.ResizeObserver> | null =
  null;
let activePdf: Awaited<
  ReturnType<typeof pdfjsLib.getDocument>["promise"]
> | null = null;
let textMeasureCanvas: HTMLCanvasElement | null = null;
interface EditorSnapshot {
  fields: ResignationTemplateEditorField[];
  customItems: ResignationTemplateCustomItem[];
}

let interactionState: {
  type: "move" | "resize";
  id: string;
  startX: number;
  startY: number;
  originalX: number;
  originalTop: number;
  originalWidth: number;
  originalHeight: number;
} | null = null;
let interactionLatestItems: ResignationTemplateCustomItem[] | null = null;
const history = ref<EditorSnapshot[]>([]);
const historyIndex = ref(-1);

const pageNumbers = computed(() =>
  Array.from({ length: pageCount.value }, (_, index) => index + 1),
);
const selectedCustomItem = computed(
  () =>
    props.customItems.find((item) => item.id === selectedCustomId.value) ||
    null,
);
const selectedFieldItem = computed(
  () =>
    props.fields.find((item) => item.key === selectedFieldKey.value) || null,
);
const selectedTextAlign = computed(
  () =>
    selectedFieldItem.value?.align ||
    selectedCustomItem.value?.align ||
    "center",
);
const canUndo = computed(() => historyIndex.value > 0);
const canRedo = computed(
  () =>
    historyIndex.value >= 0 && historyIndex.value < history.value.length - 1,
);
const zoomLabel = computed(() => `${Math.round(sheetScale.value * 100)}%`);
const documentNumberCode = computed(
  () =>
    props.documentNumber.replace(/^编号[:：]?\s*/i, "").trim() ||
    "YULI-CSXXX-LZ1",
);
const templateViewportStyle = computed(() => ({
  width: `${TEMPLATE_WIDTH * sheetScale.value}px`,
  height: `${TEMPLATE_HEIGHT * sheetScale.value}px`,
}));
const templateSheetStyle = computed(() => ({
  transform: `scale(${sheetScale.value})`,
}));

function documentNumberBoxesForPage(pageNumber: number) {
  return props.documentNumberBoxes.filter((item) => item.page === pageNumber);
}

function documentNumberStyle(box: ResignationDocumentNumberBox) {
  return {
    left: `${box.x}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    fontSize: `${box.fontSize}px`,
    lineHeight: `${box.height}px`,
    fontFamily: box.fontFamily || DOCUMENT_NUMBER_FONT_FAMILY,
    color: box.color,
  };
}

function documentNumberTextStyle(box: ResignationDocumentNumberBox) {
  textMeasureCanvas ||= document.createElement("canvas");
  const context = textMeasureCanvas.getContext("2d");
  if (!context) return {};
  context.font = `${box.fontSize}px ${box.fontFamily || DOCUMENT_NUMBER_FONT_FAMILY}`;
  const measuredWidth = Math.max(
    1,
    context.measureText(documentNumberCode.value).width,
  );
  return {
    transform: `scaleX(${Math.min(1, box.width / measuredWidth)})`,
  };
}

function setPageCanvasRef(
  pageNumber: number,
  element: Element | ComponentPublicInstance | null,
) {
  if (element instanceof HTMLCanvasElement) {
    pageCanvases.set(pageNumber, element);
  } else {
    pageCanvases.delete(pageNumber);
  }
}

function setCustomTextRef(
  id: string,
  element: Element | ComponentPublicInstance | null,
) {
  if (element instanceof globalThis.HTMLTextAreaElement) {
    customTextRefs.set(id, element);
  } else {
    customTextRefs.delete(id);
  }
}

function fieldsForPage(pageNumber: number) {
  return props.fields.filter((item) => item.page === pageNumber);
}

function customItemsForPage(pageNumber: number) {
  return props.customItems.filter((item) => item.page === pageNumber);
}

function fieldBoxStyle(item: ResignationTemplateEditorField) {
  return {
    left: `${item.x}px`,
    top: `${item.top}px`,
    width: `${item.width}px`,
    height: `${item.height}px`,
    color: item.color,
  };
}

function templateFontSize(value: number) {
  return Number.isFinite(value)
    ? Math.max(7, Math.min(36, value))
    : DEFAULT_TEMPLATE_FONT_SIZE;
}

function fieldInputStyle(item: ResignationTemplateEditorField) {
  const fontSize = templateFontSize(item.fontSize);
  const horizontalPadding =
    typeof item.paddingX === "number"
      ? Math.max(0, item.paddingX)
      : AUTO_FILL_HORIZONTAL_MARGIN;
  textMeasureCanvas ||= document.createElement("canvas");
  const context = textMeasureCanvas.getContext("2d");
  let measuredWidth = 0;
  if (context && item.value) {
    context.font = `${fontSize}px ${item.fontFamily || AUTO_FILL_FONT_FAMILY}`;
    const metrics = context.measureText(item.value);
    const inkLeft = Number.isFinite(metrics.actualBoundingBoxLeft)
      ? Math.max(0, metrics.actualBoundingBoxLeft)
      : 0;
    const inkRight = Number.isFinite(metrics.actualBoundingBoxRight)
      ? Math.max(metrics.width, metrics.actualBoundingBoxRight)
      : metrics.width;
    measuredWidth = Math.max(metrics.width, inkLeft + inkRight);
  }
  const { fontScale, horizontalScale, widthPercent, transformOrigin } =
    calculateResignationFieldTextFit(
      measuredWidth,
      item.width,
      horizontalPadding,
      fontSize,
    );
  return {
    width: `${widthPercent}%`,
    height: "100%",
    fontSize: `${fontSize * fontScale}px`,
    fontFamily: item.fontFamily || AUTO_FILL_FONT_FAMILY,
    color: item.color,
    "--field-text-color": item.color || "#000000",
    padding: `0 ${horizontalPadding}px`,
    textAlign: item.align,
    transform: `translateY(-2px) scaleX(${horizontalScale})`,
    transformOrigin,
  };
}

function customItemStyle(item: ResignationTemplateCustomItem) {
  return {
    left: `${item.x}px`,
    top: `${item.top}px`,
    width: `${item.width}px`,
    height: `${item.height}px`,
    fontSize: `${templateFontSize(item.fontSize)}px`,
    fontFamily: AUTO_FILL_FONT_FAMILY,
    color: item.color,
    textAlign: item.align,
  };
}

function cloneFields(items: ResignationTemplateEditorField[]) {
  return items.map((item) => ({ ...item }));
}

function cloneCustomItems(items: ResignationTemplateCustomItem[]) {
  return items.map((item) => ({ ...item }));
}

function snapshotKey(snapshot: EditorSnapshot) {
  return JSON.stringify(snapshot);
}

function resetHistory() {
  history.value = [
    {
      fields: cloneFields(props.fields),
      customItems: cloneCustomItems(props.customItems),
    },
  ];
  historyIndex.value = 0;
}

function recordSnapshot(
  fields: ResignationTemplateEditorField[],
  customItems: ResignationTemplateCustomItem[],
) {
  const snapshot: EditorSnapshot = {
    fields: cloneFields(fields),
    customItems: cloneCustomItems(customItems),
  };
  const current = history.value[historyIndex.value];
  if (current && snapshotKey(current) === snapshotKey(snapshot)) return;
  history.value = [
    ...history.value.slice(0, historyIndex.value + 1),
    snapshot,
  ].slice(-100);
  historyIndex.value = history.value.length - 1;
}

function applySnapshot(snapshot: EditorSnapshot) {
  emit("update:fields", cloneFields(snapshot.fields));
  emit("update:customItems", cloneCustomItems(snapshot.customItems));
  emit("change");
  selectedFieldKey.value = "";
  selectedCustomId.value = "";
}

function undo() {
  if (!canUndo.value || props.disabled) return;
  historyIndex.value -= 1;
  applySnapshot(history.value[historyIndex.value]);
}

function redo() {
  if (!canRedo.value || props.disabled) return;
  historyIndex.value += 1;
  applySnapshot(history.value[historyIndex.value]);
}

function updateField(key: string, event: Event) {
  updateFieldItem(key, {
    value: (event.target as HTMLInputElement).value,
  });
}

function updateFieldItem(
  key: string,
  patch: Partial<ResignationTemplateEditorField>,
) {
  const fields = props.fields.map((item) =>
    item.key === key ? { ...item, ...patch } : item,
  );
  emit("update:fields", fields);
  recordSnapshot(fields, props.customItems);
  emit("change");
}

function updateCustomItem(
  id: string,
  patch: Partial<ResignationTemplateCustomItem>,
  options: { record?: boolean; notify?: boolean } = {},
) {
  const items = props.customItems.map((item) =>
    item.id === id ? { ...item, ...patch } : item,
  );
  emit("update:customItems", items);
  if (options.record !== false) recordSnapshot(props.fields, items);
  if (options.notify !== false) emit("change");
  return items;
}

function updateCustomText(id: string, event: Event) {
  updateCustomItem(id, {
    value: (event.target as InstanceType<typeof globalThis.HTMLTextAreaElement>)
      .value,
  });
}

function updateSelectedAlign(value: string) {
  if (props.disabled || !["left", "center", "right"].includes(value)) return;
  if (selectedFieldItem.value) {
    updateFieldItem(selectedFieldItem.value.key, {
      align: value as ResignationTemplateEditorField["align"],
    });
    return;
  }
  if (!selectedCustomItem.value) return;
  updateCustomItem(selectedCustomItem.value.id, {
    align: value as ResignationTemplateCustomItem["align"],
  });
}

function updateSelectedColor(color: ResignationTemplateCustomItem["color"]) {
  if (!selectedCustomItem.value || props.disabled) return;
  updateCustomItem(selectedCustomItem.value.id, { color });
}

function deleteSelectedCustomItem() {
  if (!selectedCustomId.value || props.disabled) return;
  const items = props.customItems.filter(
    (item) => item.id !== selectedCustomId.value,
  );
  emit("update:customItems", items);
  recordSnapshot(props.fields, items);
  emit("change");
  selectedCustomId.value = "";
}

function duplicateSelectedCustomItem() {
  const source = selectedCustomItem.value;
  if (!source || props.disabled) return;
  const item: ResignationTemplateCustomItem = {
    ...source,
    id: createCustomId(),
    x: Math.min(TEMPLATE_WIDTH - source.width, source.x + 12),
    top: Math.min(TEMPLATE_HEIGHT - source.height, source.top + 12),
  };
  const items = [...props.customItems, item];
  emit("update:customItems", items);
  recordSnapshot(props.fields, items);
  emit("change");
  selectedFieldKey.value = "";
  selectedCustomId.value = item.id;
  void focusCustomText(item.id, false);
}

function createCustomId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function clearSelection() {
  selectedFieldKey.value = "";
  selectedCustomId.value = "";
}

function selectCustomItem(id: string, focusRoot = true) {
  selectedFieldKey.value = "";
  selectedCustomId.value = id;
  if (focusRoot) editorRootRef.value?.focus({ preventScroll: true });
}

function selectField(key: string, focusRoot = true) {
  selectedFieldKey.value = key;
  selectedCustomId.value = "";
  if (focusRoot) editorRootRef.value?.focus({ preventScroll: true });
}

async function focusCustomText(id: string, selectAll = true) {
  await nextTick();
  const textarea = customTextRefs.get(id);
  if (!textarea) return;
  textarea.focus({ preventScroll: true });
  if (selectAll) textarea.select();
}

function startDragging(
  event: InstanceType<typeof globalThis.PointerEvent>,
  item: ResignationTemplateCustomItem,
) {
  if (props.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  selectedFieldKey.value = "";
  selectedCustomId.value = item.id;
  interactionState = {
    type: "move",
    id: item.id,
    startX: event.clientX,
    startY: event.clientY,
    originalX: item.x,
    originalTop: item.top,
    originalWidth: item.width,
    originalHeight: item.height,
  };
  interactionLatestItems = null;
}

function startResizing(
  event: InstanceType<typeof globalThis.PointerEvent>,
  item: ResignationTemplateCustomItem,
) {
  if (props.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  selectedFieldKey.value = "";
  selectedCustomId.value = item.id;
  interactionState = {
    type: "resize",
    id: item.id,
    startX: event.clientX,
    startY: event.clientY,
    originalX: item.x,
    originalTop: item.top,
    originalWidth: item.width,
    originalHeight: item.height,
  };
  interactionLatestItems = null;
}

function handlePointerMove(
  event: InstanceType<typeof globalThis.PointerEvent>,
) {
  if (!interactionState) return;
  const item = props.customItems.find(
    (candidate) => candidate.id === interactionState?.id,
  );
  if (!item) return;
  const deltaX = (event.clientX - interactionState.startX) / sheetScale.value;
  const deltaY = (event.clientY - interactionState.startY) / sheetScale.value;
  if (interactionState.type === "move") {
    const x = interactionState.originalX + deltaX;
    const top = interactionState.originalTop + deltaY;
    interactionLatestItems = updateCustomItem(
      item.id,
      {
        x: Math.max(0, Math.min(TEMPLATE_WIDTH - item.width, x)),
        top: Math.max(0, Math.min(TEMPLATE_HEIGHT - item.height, top)),
      },
      { record: false, notify: false },
    );
    return;
  }

  interactionLatestItems = updateCustomItem(
    item.id,
    {
      width: Math.max(
        36,
        Math.min(
          TEMPLATE_WIDTH - interactionState.originalX,
          interactionState.originalWidth + deltaX,
        ),
      ),
      height: Math.max(
        20,
        Math.min(
          TEMPLATE_HEIGHT - interactionState.originalTop,
          interactionState.originalHeight + deltaY,
        ),
      ),
    },
    { record: false, notify: false },
  );
}

function stopInteraction() {
  if (interactionLatestItems) {
    recordSnapshot(props.fields, interactionLatestItems);
    emit("change");
  }
  interactionState = null;
  interactionLatestItems = null;
}

function updateScale() {
  if (zoomMode.value !== "fit") return;
  fitToWidth();
}

function fitToWidth() {
  const viewportWidth = editorViewportRef.value?.clientWidth || TEMPLATE_WIDTH;
  const availableWidth = Math.max(320, viewportWidth - 48);
  sheetScale.value = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, availableWidth / TEMPLATE_WIDTH),
  );
  zoomMode.value = "fit";
}

function changeZoom(delta: number) {
  zoomMode.value = "manual";
  sheetScale.value = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, Number((sheetScale.value + delta).toFixed(2))),
  );
}

function moveSelectedCustomItem(deltaX: number, deltaY: number) {
  const item = selectedCustomItem.value;
  if (!item || props.disabled) return;
  updateCustomItem(item.id, {
    x: Math.max(0, Math.min(TEMPLATE_WIDTH - item.width, item.x + deltaX)),
    top: Math.max(
      0,
      Math.min(TEMPLATE_HEIGHT - item.height, item.top + deltaY),
    ),
  });
}

function isTextInputTarget(
  target: InstanceType<typeof globalThis.EventTarget> | null,
) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof globalThis.HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (props.disabled) return;
  const commandKey = event.metaKey || event.ctrlKey;
  if (commandKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    emit("save");
    return;
  }
  if (commandKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (commandKey && event.key.toLowerCase() === "y" && !event.shiftKey) {
    event.preventDefault();
    redo();
    return;
  }
  if (
    commandKey &&
    event.key.toLowerCase() === "d" &&
    selectedCustomItem.value
  ) {
    event.preventDefault();
    duplicateSelectedCustomItem();
    return;
  }
  if (event.key === "Escape") {
    clearSelection();
    return;
  }
  if (!selectedCustomItem.value || isTextInputTarget(event.target)) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelectedCustomItem();
    return;
  }
  const step = event.shiftKey ? 5 : 1;
  const movement: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const delta = movement[event.key];
  if (!delta) return;
  event.preventDefault();
  moveSelectedCustomItem(delta[0], delta[1]);
}

async function loadTemplate() {
  const generation = ++renderGeneration;
  loading.value = true;
  errorMessage.value = "";
  emit("ready", false);

  try {
    const response = await api.get(props.previewUrl, {
      responseType: "arraybuffer",
    });
    if (generation !== renderGeneration) return;
    await activePdf?.destroy();
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(response.data),
      cMapUrl: "/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/standard_fonts/",
    });
    const pdf = await loadingTask.promise;
    activePdf = pdf;
    pageCount.value = pdf.numPages;
    await nextTick();

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const canvas = pageCanvases.get(pageNumber);
      if (!canvas) throw new Error(`第 ${pageNumber} 页画布初始化失败`);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${TEMPLATE_WIDTH}px`;
      canvas.style.height = `${TEMPLATE_HEIGHT}px`;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法显示离职模板");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      if (generation !== renderGeneration) return;
    }
    emit("ready", true);
    await nextTick();
    fitToWidth();
    resetHistory();
  } catch (error: unknown) {
    if (generation !== renderGeneration) return;
    console.error("加载离职模板原始版式失败:", error);
    const requestError = error as {
      response?: { status?: number };
      message?: string;
    };
    errorMessage.value =
      requestError.response?.status === 404
        ? "管理员尚未上传当前离职模板"
        : requestError.message || "离职模板加载失败";
  } finally {
    if (generation === renderGeneration) loading.value = false;
  }
}

watch(
  () => props.previewUrl,
  () => {
    if (mounted) {
      history.value = [];
      historyIndex.value = -1;
      void loadTemplate();
    }
  },
);

watch(
  () => props.fields,
  (items) => {
    if (
      selectedFieldKey.value &&
      !items.some((item) => item.key === selectedFieldKey.value)
    ) {
      selectedFieldKey.value = "";
    }
  },
  { deep: true },
);

watch(
  () => props.customItems,
  (items) => {
    if (
      selectedCustomId.value &&
      !items.some((item) => item.id === selectedCustomId.value)
    ) {
      selectedCustomId.value = "";
    }
  },
  { deep: true },
);

onMounted(() => {
  mounted = true;
  resizeObserver = new globalThis.ResizeObserver(updateScale);
  if (editorViewportRef.value) resizeObserver.observe(editorViewportRef.value);
  updateScale();
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", stopInteraction);
  void loadTemplate();
});

onBeforeUnmount(() => {
  mounted = false;
  renderGeneration += 1;
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener("pointermove", handlePointerMove);
  window.removeEventListener("pointerup", stopInteraction);
  void activePdf?.destroy();
  activePdf = null;
});
</script>

<style scoped>
.resignation-template-editor {
  width: 100%;
  outline: none;
  border: 1px solid var(--el-border-color);
  background: #fff;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 8px 12px;
  gap: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: #f7f8fa;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: var(--el-border-color);
}

.toolbar-spacer {
  flex: 1;
}

.editor-toolbar :deep(.el-button + .el-button) {
  margin-left: 0;
}

.color-swatches {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px;
}

.color-swatch {
  position: relative;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 50%;
  cursor: pointer;
}

.color-swatch.black {
  background: #000;
}

.color-swatch.red {
  background: #c80000;
}

.color-swatch.active::after {
  position: absolute;
  inset: -4px;
  border: 2px solid var(--el-color-primary);
  border-radius: 50%;
  content: "";
}

.zoom-controls {
  flex-shrink: 0;
}

.zoom-value {
  width: 48px;
  color: var(--el-text-color-regular);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.template-scroll {
  box-sizing: border-box;
  width: 100%;
  min-height: 540px;
  max-height: 72vh;
  padding: 18px 24px 28px;
  overflow: auto;
  background: #e7e9ed;
}

.template-page + .template-page {
  margin-top: 24px;
}

.page-index {
  width: fit-content;
  margin: 0 auto 7px;
  color: #606266;
  font-size: 12px;
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

.document-number,
.template-field,
.custom-text-box {
  position: absolute;
  box-sizing: border-box;
}

.document-number {
  z-index: 3;
  display: grid;
  overflow: hidden;
  color: #c80000;
  background: #fff;
  font-family: "Noto Sans CJK SC", "PingFang SC", "Arial", sans-serif;
  font-weight: 400;
  letter-spacing: 0;
  text-align: center;
  white-space: nowrap;
  place-items: center start;
}

.document-number > span {
  display: inline-block;
  transform-origin: left center;
}

.template-field {
  z-index: 4;
  display: flex;
  align-items: center;
  overflow: hidden;
  color: #000;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  cursor: text;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.template-field.source-backed {
  background: linear-gradient(
    to bottom,
    #fff 0,
    #fff calc(100% - 3px),
    transparent calc(100% - 3px)
  );
}

.template-field.source-unchanged,
.template-field.source-unchanged:hover,
.template-field.source-unchanged.selected {
  background: transparent;
}

.template-field.source-unchanged .template-field-input {
  color: transparent !important;
  -webkit-text-fill-color: transparent;
}

.template-field.source-unchanged:focus-within {
  background: linear-gradient(
    to bottom,
    rgb(255 255 255 / 96%) 0,
    rgb(255 255 255 / 96%) calc(100% - 3px),
    transparent calc(100% - 3px)
  );
}

.template-field.source-unchanged:focus-within .template-field-input {
  color: var(--field-text-color) !important;
  -webkit-text-fill-color: var(--field-text-color);
}

.template-field::after {
  position: absolute;
  right: 1px;
  bottom: 1px;
  left: 1px;
  height: 1px;
  background: transparent;
  content: "";
  pointer-events: none;
}

.template-field-input {
  position: relative;
  box-sizing: border-box;
  flex: none;
  min-width: 0;
  padding: 0 1px;
  overflow: visible;
  outline: none;
  border: 0;
  background: transparent;
  cursor: text;
  line-height: normal;
  text-overflow: clip;
}

.template-field-input:disabled {
  opacity: 1;
  -webkit-text-fill-color: currentcolor;
}

.template-field:hover,
.template-field.selected,
.template-field:focus-within {
  border-color: #409eff;
  background: rgb(255 255 255 / 72%);
  box-shadow: 0 0 0 2px rgb(64 158 255 / 12%);
}

.template-field.source-backed:hover,
.template-field.source-backed.selected,
.template-field.source-backed:focus-within {
  background: linear-gradient(
    to bottom,
    rgb(255 255 255 / 96%) 0,
    rgb(255 255 255 / 96%) calc(100% - 3px),
    transparent calc(100% - 3px)
  );
}

.template-field:hover::after,
.template-field.selected::after,
.template-field:focus-within::after {
  background: #409eff;
}

.custom-text-box {
  z-index: 5;
  border: 1px dashed transparent;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}

.custom-text-box:hover,
.custom-text-box.selected {
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgb(64 158 255 / 12%);
}

.custom-text-box textarea {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 2px;
  overflow: hidden;
  color: inherit;
  outline: none;
  border: 0;
  background: transparent;
  font: inherit;
  line-height: 1.18;
  text-align: inherit;
  resize: none;
}

.drag-handle {
  position: absolute;
  top: -21px;
  left: -1px;
  display: none;
  width: 22px;
  height: 20px;
  padding: 0;
  color: #409eff;
  border: 1px solid #409eff;
  border-radius: 3px 3px 0 0;
  background: #fff;
  cursor: move;
  place-items: center;
}

.resize-handle {
  position: absolute;
  z-index: 2;
  right: -6px;
  bottom: -6px;
  width: 12px;
  height: 12px;
  padding: 0;
  border: 2px solid #fff;
  border-radius: 2px;
  background: #409eff;
  box-shadow: 0 0 0 1px #409eff;
  cursor: nwse-resize;
}

.custom-text-box:hover .drag-handle,
.custom-text-box.selected .drag-handle {
  display: grid;
}

@media (max-width: 760px) {
  .editor-toolbar {
    flex-wrap: wrap;
  }

  .toolbar-spacer {
    display: none;
  }

  .template-scroll {
    min-height: 420px;
    max-height: 68vh;
    padding: 12px;
  }
}
</style>
