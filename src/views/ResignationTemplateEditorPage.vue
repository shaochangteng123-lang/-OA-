<template>
  <div class="template-editor-page">
    <header class="editor-header">
      <div class="editor-heading">
        <h1>{{ pageTitle }}</h1>
        <p v-if="requestMeta">
          {{ requestMeta.employee_no || "-" }} · 离职日期
          {{ requestMeta.resign_date || "-" }}
        </p>
      </div>
      <div class="header-actions">
        <span
          v-if="template"
          class="save-status"
          :class="{ dirty: editorDirty, saving }"
        >
          {{ saving ? "正在保存" : editorDirty ? "有未保存修改" : "已保存" }}
        </span>
        <el-button :icon="Close" @click="closeEditor"> 关闭窗口 </el-button>
        <el-button
          :icon="Download"
          :loading="downloading"
          :disabled="!!message"
          @click="downloadCurrentTemplate"
        >
          下载当前文件
        </el-button>
        <el-button
          :icon="Printer"
          :loading="printing"
          :disabled="!!message"
          @click="printAllTemplates"
        >
          一并打印
        </el-button>
        <el-button
          type="primary"
          :icon="Check"
          :loading="saving"
          :disabled="!!message"
          @click="saveCurrentTemplate"
        >
          保存填写内容
        </el-button>
      </div>
    </header>

    <nav class="template-navigation" aria-label="离职模板">
      <el-tabs
        v-model="activeTemplateType"
        :before-leave="beforeTemplateLeave"
        @tab-change="handleTemplateChange"
      >
        <el-tab-pane
          v-for="templateType in TEMPLATE_ORDER"
          :key="templateType"
          :name="templateType"
          :label="TEMPLATE_LABELS[templateType]"
        />
      </el-tabs>
    </nav>

    <main v-loading="loading" class="editor-workspace">
      <el-alert
        v-if="message"
        type="warning"
        :closable="false"
        show-icon
        :title="message"
      />
      <template v-else-if="template">
        <el-alert
          v-if="warnings.length > 0"
          type="warning"
          :closable="false"
          show-icon
          :title="warnings.join('；')"
          class="editor-warning"
        />
        <ResignationTemplateEditor
          v-model:fields="fields"
          v-model:custom-items="customItems"
          :preview-url="previewUrl"
          :document-number="documentNumber"
          :document-number-boxes="documentNumberBoxes"
          :disabled="saving"
          @change="markEditorDirty"
          @save="saveCurrentTemplate"
        />
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isAxiosError } from "axios";
import { ElMessage } from "element-plus";
import { Check, Close, Download, Printer } from "@element-plus/icons-vue";
import ResignationTemplateEditor from "@/components/resignation/ResignationTemplateEditor.vue";
import { api } from "@/utils/api";

type TemplateType =
  | "termination_agreement"
  | "employee_handover_form"
  | "settlement_confirmation"
  | "compensation_agreement"
  | "resignation_certificate";

interface EditorField {
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
  value: string;
}

interface CustomItem {
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

interface DocumentNumberBox {
  page: number;
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
  color?: string;
}

interface RequestMeta {
  employee_name: string | null;
  employee_no: string | null;
  resign_date: string | null;
}

const TEMPLATE_LABELS: Record<TemplateType, string> = {
  termination_agreement: "终止 / 解除劳动关系协议书",
  employee_handover_form: "员工离职交接单",
  settlement_confirmation: "薪资及各类款项结算确认书",
  compensation_agreement: "离职经济补偿协议书",
  resignation_certificate: "离职证明",
};

const TEMPLATE_ORDER: TemplateType[] = [
  "termination_agreement",
  "employee_handover_form",
  "settlement_confirmation",
  "compensation_agreement",
  "resignation_certificate",
];

const route = useRoute();
const router = useRouter();
const requestId = computed(() => String(route.params.requestId || ""));
const activeTemplateType = ref<TemplateType>("termination_agreement");
const requestMeta = ref<RequestMeta | null>(null);
const template = ref<Record<string, unknown> | null>(null);
const documentNumber = ref("");
const documentNumberBoxes = ref<DocumentNumberBox[]>([]);
const fields = ref<EditorField[]>([]);
const customItems = ref<CustomItem[]>([]);
const warnings = ref<string[]>([]);
const message = ref("");
const loading = ref(false);
const saving = ref(false);
const downloading = ref(false);
const printing = ref(false);
const editorDirty = ref(false);

const pageTitle = computed(() => {
  const employeeName = requestMeta.value?.employee_name;
  return employeeName
    ? `${employeeName}的离职模板在线编辑`
    : "离职模板在线编辑";
});

const previewUrl = computed(() =>
  template.value && requestId.value
    ? `/api/resignation/management/${requestId.value}/templates/${activeTemplateType.value}/preview`
    : "",
);

function getErrorMessage(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) return fallback;
  const data = error.response?.data as { message?: string } | undefined;
  return data?.message || fallback;
}

async function loadEditor(): Promise<void> {
  if (!requestId.value) {
    message.value = "离职人员记录编号不正确";
    return;
  }
  loading.value = true;
  message.value = "";
  template.value = null;
  documentNumber.value = "";
  documentNumberBoxes.value = [];
  fields.value = [];
  customItems.value = [];
  warnings.value = [];
  editorDirty.value = false;
  try {
    const response = await api.get(
      `/api/resignation/management/${requestId.value}/templates/${activeTemplateType.value}/editor`,
    );
    if (!response.data.success) {
      message.value = response.data.message || "模板加载失败";
      return;
    }
    const data = response.data.data;
    requestMeta.value = data.request || null;
    template.value = data.template || null;
    documentNumber.value = data.documentNumber || "";
    documentNumberBoxes.value = data.documentNumberBoxes || [];
    fields.value = data.fields || [];
    customItems.value = data.customItems || [];
    warnings.value = data.warnings || [];
    editorDirty.value = false;
    document.title = pageTitle.value;
  } catch (error: unknown) {
    message.value = getErrorMessage(error, "模板加载失败");
  } finally {
    loading.value = false;
  }
}

async function saveTemplate(
  templateType: TemplateType,
  silent = false,
): Promise<boolean> {
  if (!requestId.value || !template.value) return false;
  saving.value = true;
  try {
    const response = await api.put(
      `/api/resignation/management/${requestId.value}/templates/${templateType}/editor`,
      {
        fieldValues: Object.fromEntries(
          fields.value.map((item) => [item.key, item.value]),
        ),
        fieldAlignments: Object.fromEntries(
          fields.value.map((item) => [item.key, item.align]),
        ),
        customItems: customItems.value,
      },
    );
    if (!response.data.success) {
      ElMessage.error(response.data.message || "保存失败");
      return false;
    }
    if (templateType === activeTemplateType.value) editorDirty.value = false;
    if (!silent)
      ElMessage.success(response.data.message || "模板填写内容已保存");
    return true;
  } catch (error: unknown) {
    ElMessage.error(getErrorMessage(error, "保存失败"));
    return false;
  } finally {
    saving.value = false;
  }
}

async function saveCurrentTemplate(): Promise<void> {
  await saveTemplate(activeTemplateType.value);
}

function markEditorDirty(): void {
  editorDirty.value = true;
}

async function beforeTemplateLeave(
  _newName: string | number,
  oldName: string | number,
): Promise<boolean> {
  if (message.value || !template.value) return true;
  return await saveTemplate(oldName as TemplateType, true);
}

async function handleTemplateChange(name: string | number): Promise<void> {
  activeTemplateType.value = name as TemplateType;
  await loadEditor();
}

async function downloadCurrentTemplate(): Promise<void> {
  downloading.value = true;
  try {
    if (!(await saveTemplate(activeTemplateType.value, true))) return;
    const response = await api.get(
      `/api/resignation/management/${requestId.value}/templates/${activeTemplateType.value}/download`,
      { responseType: "blob" },
    );
    const namePrefix =
      requestMeta.value?.employee_no ||
      requestMeta.value?.employee_name ||
      "员工";
    const fileName = `${namePrefix}-${TEMPLATE_LABELS[activeTemplateType.value]}.pdf`;
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = fileName;
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error: unknown) {
    ElMessage.error(getErrorMessage(error, "模板下载失败"));
  } finally {
    downloading.value = false;
  }
}

async function printAllTemplates(): Promise<void> {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    ElMessage.warning("浏览器阻止了打印窗口，请允许当前站点打开新窗口");
    return;
  }
  printing.value = true;
  try {
    if (!(await saveTemplate(activeTemplateType.value, true))) {
      printWindow.close();
      return;
    }
    printWindow.location.href = `/api/resignation/management/${requestId.value}/templates/print-all`;
  } catch (error: unknown) {
    printWindow.close();
    ElMessage.error(getErrorMessage(error, "合并打印失败"));
  } finally {
    printing.value = false;
  }
}

async function closeEditor(): Promise<void> {
  if (editorDirty.value && template.value) {
    const saved = await saveTemplate(activeTemplateType.value, true);
    if (!saved) return;
  }
  if (window.opener) {
    window.close();
    return;
  }
  void router.push({ path: "/employee-data", query: { tab: "resignation" } });
}

function handleBeforeUnload(
  event: InstanceType<typeof globalThis.BeforeUnloadEvent>,
): void {
  if (!editorDirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}

onMounted(() => {
  const requestedType = String(route.query.template || "");
  if (TEMPLATE_ORDER.includes(requestedType as TemplateType)) {
    activeTemplateType.value = requestedType as TemplateType;
  }
  window.addEventListener("beforeunload", handleBeforeUnload);
  void loadEditor();
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
});
</script>

<style scoped>
.template-editor-page {
  min-height: 100vh;
  background: #eef0f3;
}

.editor-header {
  position: sticky;
  z-index: 20;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 72px;
  padding: 12px 24px;
  gap: 24px;
  border-bottom: 1px solid var(--el-border-color);
  background: #fff;
}

.editor-heading {
  min-width: 0;
}

.editor-heading h1 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 20px;
  font-weight: 600;
}

.editor-heading p {
  margin: 5px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.header-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.save-status {
  display: inline-flex;
  align-items: center;
  color: var(--el-color-success);
  font-size: 13px;
  white-space: nowrap;
}

.save-status::before {
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: currentcolor;
  content: "";
}

.save-status.dirty {
  color: var(--el-color-warning);
}

.save-status.saving {
  color: var(--el-color-primary);
}

.template-navigation {
  padding: 0 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: #fff;
}

.template-navigation :deep(.el-tabs__header) {
  margin: 0;
}

.editor-workspace {
  min-height: calc(100vh - 118px);
  padding: 16px 24px 24px;
}

.editor-warning {
  margin-bottom: 12px;
}

.editor-workspace :deep(.template-scroll) {
  max-height: calc(100vh - 230px);
}

@media (max-width: 980px) {
  .editor-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .header-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .template-navigation,
  .editor-workspace {
    padding-right: 12px;
    padding-left: 12px;
  }
}
</style>
