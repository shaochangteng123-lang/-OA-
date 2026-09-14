<template>
  <Teleport v-if="isOpen && mountTarget" :to="mountTarget">
    <div
      class="project-receipt-dialog-backdrop"
      :class="{ 'is-fallback': fallbackMode }"
      @click.self="handleBackdropClick"
    >
      <dialog
        ref="dialogElement"
        class="project-receipt-dialog"
        data-financial-receipt-dialog="true"
        :open="fallbackMode ? true : undefined"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        @cancel.prevent="requestClose"
        @close="handleNativeClose"
        @click="handleNativeBackdropClick"
      >
        <header class="project-receipt-dialog-header">
          <div>
            <h3 :id="titleId">银行回单预览</h3>
            <p>
              {{ projectName || "项目名称未提供" }} · {{ from }} 至 {{ to }}
            </p>
          </div>
          <button
            ref="closeButton"
            type="button"
            class="project-receipt-dialog-close"
            aria-label="关闭银行回单预览"
            @click="requestClose"
          >
            <span aria-hidden="true">×</span>关闭
          </button>
        </header>
        <div class="project-receipt-dialog-content">
          <MonthlyFinancialProjectReceiptPreview
            :key="previewKey"
            :receipts="receipts"
            :root-contract-id="rootContractId"
            :period-key="periodKey"
            :from="from"
            :to="to"
          />
        </div>
      </dialog>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import MonthlyFinancialProjectReceiptPreview from "@/components/monthly-financial/MonthlyFinancialProjectReceiptPreview.vue";
import type { FinancialAnalysisProjectReceipt } from "@/types/monthlyFinancialAnalysis";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    receipts?: FinancialAnalysisProjectReceipt[];
    rootContractId: string;
    periodKey: string;
    from: string;
    to: string;
    projectName?: string;
    appendTo?: HTMLElement | null;
    returnFocus?: HTMLElement | null;
  }>(),
  { receipts: () => [], projectName: "", appendTo: null, returnFocus: null },
);
const emit = defineEmits<{
  close: [];
  "visibility-change": [visible: boolean];
}>();
const titleId = "financial-receipt-dialog-title-" + getCurrentInstance()?.uid;
const dialogElement = ref<globalThis.HTMLDialogElement | null>(null);
const closeButton = ref<globalThis.HTMLButtonElement | null>(null);
const mountTarget = shallowRef<HTMLElement | null>(null);
const isOpen = ref(false);
const fallbackMode = ref(false);
const scopeKey = computed(() =>
  JSON.stringify([props.rootContractId, props.periodKey, props.from, props.to]),
);
const previewKey = computed(
  () => scopeKey.value + ":" + JSON.stringify(props.receipts),
);
let mounted = false;
let disposed = false;
let session = 0;
let previousFocus: HTMLElement | null = null;
let previousBodyOverflow: string | null = null;
let listenersAttached = false;

function availableFocusTarget(element: HTMLElement | null): boolean {
  if (
    !element?.isConnected ||
    element.matches(":disabled, [aria-disabled='true']")
  )
    return false;
  for (
    let current: HTMLElement | null = element;
    current;
    current = current.parentElement
  ) {
    if (current.hidden || current.hasAttribute("inert")) return false;
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}
function focusCloseButton() {
  if (isOpen.value && closeButton.value)
    closeButton.value.focus({ preventScroll: true });
}
function attachListeners() {
  if (listenersAttached) return;
  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("focusin", handleFocusIn, true);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  listenersAttached = true;
}
function removeListeners() {
  if (!listenersAttached) return;
  document.removeEventListener("keydown", handleKeydown, true);
  document.removeEventListener("focusin", handleFocusIn, true);
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  listenersAttached = false;
}
function selectMountTarget(): HTMLElement {
  const fullscreen =
    document.fullscreenElement instanceof HTMLElement
      ? document.fullscreenElement
      : null;
  const requested = props.appendTo?.isConnected ? props.appendTo : null;
  // 原生全屏外的弹层不可见，显式目标也不得把回单挂到全屏根之外。
  if (fullscreen)
    return requested && fullscreen.contains(requested) ? requested : fullscreen;
  return requested || document.body;
}
async function openDialog() {
  if (!mounted || disposed || !props.visible || isOpen.value) return;
  const openingSession = ++session;
  previousFocus = availableFocusTarget(props.returnFocus)
    ? props.returnFocus
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  mountTarget.value = selectMountTarget();
  fallbackMode.value = false;
  isOpen.value = true;
  attachListeners();
  emit("visibility-change", true);
  await nextTick();
  if (disposed || !isOpen.value || openingSession !== session) return;
  const element = dialogElement.value;
  if (!element) return;
  try {
    if (typeof element.showModal !== "function")
      throw new Error("当前浏览器不支持原生弹窗");
    element.showModal();
    if (!element.open) throw new Error("浏览器未打开原生弹窗");
  } catch {
    fallbackMode.value = true;
    await nextTick();
  }
  if (!disposed && isOpen.value && openingSession === session)
    focusCloseButton();
}
function finishClose(notifyParent: boolean) {
  if (!isOpen.value) return;
  isOpen.value = false;
  session += 1;
  removeListeners();
  const element = dialogElement.value;
  if (element?.open && typeof element.close === "function") {
    try {
      element.close();
    } catch {
      /* 后备关闭由渲染卸载完成。 */
    }
  }
  if (previousBodyOverflow !== null) {
    if (document.body.style.overflow === "hidden")
      document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = null;
  }
  const returnTarget = previousFocus;
  if (notifyParent) {
    // 主动关闭先返回入口，兼容父级在close事件中立即卸载本组件。
    if (availableFocusTarget(returnTarget))
      returnTarget?.focus({ preventScroll: true });
  } else {
    // 强制失活的v-show可能尚未隐藏入口，原生close也可能先自动回焦；等DOM稳定再核对。
    const closingSession = session;
    void nextTick().then(() => {
      if (
        isOpen.value ||
        (!disposed && session !== closingSession) ||
        document.querySelector("[data-financial-receipt-dialog]")
      )
        return;
      const active = document.activeElement;
      if (!availableFocusTarget(returnTarget)) {
        if (active === returnTarget) returnTarget?.blur();
      } else if (
        active === returnTarget ||
        active === document.body ||
        !active ||
        element?.contains(active)
      ) {
        returnTarget?.focus({ preventScroll: true });
      }
    });
  }
  previousFocus = null;
  emit("visibility-change", false);
  if (notifyParent) emit("close");
}
function requestClose() {
  finishClose(true);
}
function handleNativeClose() {
  if (isOpen.value) finishClose(true);
}
function handleBackdropClick() {
  if (fallbackMode.value) requestClose();
}
function handleNativeBackdropClick(event: MouseEvent) {
  const element = dialogElement.value;
  if (fallbackMode.value || !element || event.target !== element) return;
  const box = element.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
    requestClose();
}
function handleFullscreenChange() {
  // 全屏目标变化时关闭并释放当前原件，不把旧预览迁移到其他页面层级。
  requestClose();
}
function focusableElements() {
  const element = dialogElement.value;
  if (!element) return [];
  return Array.from(
    element.querySelectorAll<HTMLElement>(
      "button, select, input, textarea, a[href], iframe, [tabindex]",
    ),
  ).filter((control) => control.tabIndex >= 0 && availableFocusTarget(control));
}
function handleKeydown(event: KeyboardEvent) {
  if (!isOpen.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    requestClose();
    return;
  }
  if (event.key !== "Tab") return;
  event.stopImmediatePropagation();
  const controls = focusableElements();
  const first = controls[0] || closeButton.value || dialogElement.value;
  const last = controls.at(-1) || first;
  if (!first || !last) return;
  const active = document.activeElement;
  if (
    !dialogElement.value?.contains(active) ||
    active === dialogElement.value ||
    (event.shiftKey && active === first) ||
    (!event.shiftKey && active === last)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  }
}
function handleFocusIn(event: globalThis.FocusEvent) {
  if (
    !isOpen.value ||
    !dialogElement.value ||
    !(event.target instanceof globalThis.Node)
  )
    return;
  if (!dialogElement.value.contains(event.target)) focusCloseButton();
}
watch(
  () => props.visible,
  (visible) => {
    if (visible) void openDialog();
    else finishClose(false);
  },
);
watch(scopeKey, () => {
  if (isOpen.value) requestClose();
});
watch(
  () => props.appendTo,
  () => {
    if (isOpen.value && selectMountTarget() !== mountTarget.value)
      requestClose();
  },
);
watch(previewKey, () => {
  const currentSession = session;
  if (isOpen.value)
    void nextTick().then(() => {
      if (
        !disposed &&
        currentSession === session &&
        isOpen.value &&
        !dialogElement.value?.contains(document.activeElement)
      )
        focusCloseButton();
    });
});
onMounted(() => {
  mounted = true;
  if (props.visible) void openDialog();
});
onBeforeUnmount(() => {
  disposed = true;
  mounted = false;
  finishClose(false);
  session += 1;
  removeListeners();
});
</script>

<style scoped>
.project-receipt-dialog-backdrop {
  display: contents;
}
.project-receipt-dialog-backdrop.is-fallback {
  position: fixed;
  inset: 0;
  z-index: 3200;
  display: grid;
  place-items: center;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 20px;
  box-sizing: border-box;
  background: rgb(20 39 50 / 55%);
}
.project-receipt-dialog {
  width: min(960px, calc(100vw - 40px));
  max-width: calc(100vw - 40px);
  max-height: calc(100dvh - 40px);
  box-sizing: border-box;
  padding: 0;
  margin: auto;
  border: 1px solid #d7e4ea;
  border-radius: 12px;
  background: #fff;
  color: #355565;
  box-shadow: 0 18px 70px rgb(18 47 63 / 25%);
  overflow: hidden;
}
.project-receipt-dialog:not([open]) {
  display: none;
}
.project-receipt-dialog[open] {
  display: flex;
  flex-direction: column;
}
.is-fallback > .project-receipt-dialog {
  position: relative;
  inset: auto;
  margin: 0;
}
.project-receipt-dialog::backdrop {
  background: rgb(20 39 50 / 55%);
}
.project-receipt-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  border-bottom: 1px solid #e3ecef;
  background: #f7fafb;
}
.project-receipt-dialog-header > div {
  min-width: 0;
}
.project-receipt-dialog-header h3 {
  margin: 0;
  color: #2f5667;
  font-size: 17px;
}
.project-receipt-dialog-header p {
  margin: 6px 0 0;
  color: #7b909b;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.project-receipt-dialog-close {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  padding: 7px 11px;
  border: 1px solid #bfd4de;
  border-radius: 6px;
  background: #fff;
  color: #466d80;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.project-receipt-dialog-close span {
  font-size: 20px;
  line-height: 1;
}
.project-receipt-dialog-close:focus-visible {
  outline: 2px solid #398e99;
  outline-offset: 2px;
}
.project-receipt-dialog-content {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px;
}
.project-receipt-dialog-content :deep(.receipt-preview-image),
.project-receipt-dialog-content :deep(.receipt-preview-pdf) {
  height: min(560px, 60dvh);
}
@media (max-width: 600px) {
  .project-receipt-dialog-backdrop.is-fallback {
    padding: 10px;
  }
  .project-receipt-dialog {
    width: calc(100vw - 20px);
    max-width: calc(100vw - 20px);
    max-height: calc(100dvh - 20px);
    border-radius: 9px;
  }
  .project-receipt-dialog-header {
    padding: 12px;
    gap: 8px;
  }
  .project-receipt-dialog-header h3 {
    font-size: 15px;
  }
  .project-receipt-dialog-content {
    padding: 10px;
  }
  .project-receipt-dialog-content :deep(.receipt-preview-image),
  .project-receipt-dialog-content :deep(.receipt-preview-pdf) {
    height: min(430px, 58dvh);
  }
}
</style>
