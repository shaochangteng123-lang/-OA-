<template>
  <section class="auxiliary-manager">
    <header class="auxiliary-header">
      <div>
        <span class="eyebrow">辅助材料档案</span>
        <h3>辅助合同与随附材料</h3>
        <p>辅助材料只作附件归档和留痕，不进行内容识别，也不参与合同核算。</p>
      </div>
      <el-button
        v-if="canManage"
        type="primary"
        :icon="Plus"
        @click="toggleCreatePanel"
      >
        {{ createPanelVisible ? "收起上传区域" : "添加辅助材料" }}
      </el-button>
    </header>

    <el-skeleton v-if="loading" :rows="3" animated />
    <div v-else-if="packages.length" class="package-list">
      <article v-for="item in packages" :key="item.id" class="package-card">
        <div class="package-card-head">
          <div>
            <el-tag type="success" effect="light">已归档</el-tag>
            <el-tag type="info" effect="plain">不参与核算</el-tag>
          </div>
          <el-dropdown v-if="canManage" trigger="click">
            <el-button link :icon="MoreFilled">操作</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="openNoteDialog(item)">
                  编辑备注
                </el-dropdown-item>
                <el-dropdown-item divided @click="removePackage(item)">
                  删除档案
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <p v-if="item.note" class="package-note">
          <el-icon><ChatLineSquare /></el-icon>{{ item.note }}
        </p>
        <div class="package-files">
          <div v-for="file in item.files" :key="file.id" class="package-file">
            <span>
              <el-icon><Document /></el-icon>
              <span
                >{{ fileKindLabel(file.fileKind) }}：{{ file.fileName }}</span
              >
            </span>
            <span class="file-actions">
              <el-button
                link
                type="primary"
                @click="previewArchivedFile(item, file)"
              >
                在线预览
              </el-button>
              <el-button
                tag="a"
                link
                type="success"
                :href="
                  getContractAuxiliaryFileUrl(
                    contractId,
                    item.id,
                    file.id,
                    true,
                  )
                "
              >
                下载
              </el-button>
            </span>
          </div>
        </div>
      </article>
    </div>
    <el-empty v-else description="暂未添加辅助材料" :image-size="76" />

    <section v-if="canManage && createPanelVisible" class="create-panel">
      <div class="create-panel-heading">
        <h4>添加辅助材料</h4>
        <span>
          三类材料均可多选；首次归档辅助合同至少1份，已有档案可直接追加发票或回单；本次已选择
          {{ selectedFileCount }}/20 份
        </span>
      </div>
      <el-alert
        type="info"
        show-icon
        :closable="false"
        title="辅助材料独立归档，不参与收入核算"
        description="首次归档时辅助合同必传；已有档案后可只选择发票或回单追加保存。文件通过格式和安全校验后直接归档，不识别甲乙方、金额或其他内容。"
      />
      <div class="upload-blocks">
        <article
          v-for="option in uploadOptions"
          :key="option.kind"
          class="upload-block"
        >
          <div>
            <strong>{{ option.label }}</strong>
            <small>{{ option.description }}</small>
          </div>
          <el-upload
            :auto-upload="false"
            :show-file-list="false"
            multiple
            :on-change="(file: UploadFile) => selectFile(option.kind, file)"
            :accept="option.accept"
          >
            <el-button :icon="Upload">选择文件</el-button>
          </el-upload>
          <div v-if="selectedFiles(option.kind).length" class="chosen-files">
            <p
              v-for="selected in selectedFiles(option.kind)"
              :key="selected.uid"
              class="chosen-file"
            >
              <el-icon><CircleCheckFilled /></el-icon>
              <span>{{ selected.file.name }}</span>
              <el-button
                link
                type="primary"
                @click="previewSelectedFile(selected.file)"
              >
                在线预览
              </el-button>
              <el-button
                link
                type="success"
                @click="downloadSelectedFile(selected.file)"
              >
                下载
              </el-button>
              <el-button
                link
                type="danger"
                :aria-label="`移除${selected.file.name}`"
                @click="clearFile(option.kind, selected.uid)"
              >
                移除
              </el-button>
            </p>
          </div>
        </article>
      </div>
      <button type="button" class="note-trigger" @click="openCreateNoteDialog">
        <el-icon><ChatLineSquare /></el-icon>
        <span>
          <strong>{{
            createNote ? "已添加特殊情况备注" : "添加特殊情况备注"
          }}</strong>
          <small>{{
            createNote || "说明辅助合同背景、例外事项或归档原因"
          }}</small>
        </span>
        <el-icon><ArrowRight /></el-icon>
      </button>
      <div class="create-actions">
        <el-button @click="resetCreateForm">清空</el-button>
        <el-button
          type="primary"
          :loading="creating"
          :disabled="!canArchiveSelection"
          @click="createPackage"
        >
          {{ isAppendingToExistingPackage ? "追加并归档" : "上传并归档" }}
        </el-button>
      </div>
    </section>

    <el-dialog
      v-model="noteDialogVisible"
      title="辅助材料特殊情况备注"
      width="min(520px, calc(100vw - 32px))"
      :close-on-click-modal="false"
    >
      <el-input
        v-model="noteDraft"
        type="textarea"
        :rows="5"
        maxlength="1000"
        show-word-limit
        placeholder="请说明辅助材料对应合同的特殊背景、适用范围或归档原因"
      />
      <template #footer>
        <el-button @click="noteDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="noteSaving" @click="saveNote">
          保存备注
        </el-button>
      </template>
    </el-dialog>
    <ContractReadOnlyPreview
      :visible="previewVisible"
      :url="previewUrl"
      :file-name="previewFileName"
      :mime-type="previewMimeType"
      :can-download="Boolean(previewDownloadUrl)"
      @close="closePreview"
      @download="downloadPreviewFile"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import {
  ArrowRight,
  ChatLineSquare,
  CircleCheckFilled,
  Document,
  MoreFilled,
  Plus,
  Upload,
} from "@element-plus/icons-vue";
import ContractReadOnlyPreview from "@/components/contracts/ContractReadOnlyPreview.vue";
import { useAuthStore } from "@/stores/auth";
import type {
  ContractAuxiliaryFileKind,
  ContractAuxiliaryPackage,
} from "@/types/contract";
import {
  appendContractAuxiliaryFiles,
  createContractAuxiliaryPackage,
  deleteContractAuxiliaryPackage,
  getContractAuxiliaryFileUrl,
  getContractAuxiliaryPackages,
  getContractErrorMessage,
  updateContractAuxiliaryNote,
} from "@/utils/contractApi";

const props = defineProps<{ contractId: string }>();
const emit = defineEmits<{ contentState: [hasContent: boolean] }>();
const authStore = useAuthStore();
const nativePreviewRoles = new Set([
  "admin",
  "super_admin",
  "chairman",
  "general_manager",
]);
const manageRoles = new Set(["admin", "super_admin", "chairman"]);
const canManage = computed(() => manageRoles.has(authStore.user?.role || ""));
const useNativePreview = computed(() =>
  nativePreviewRoles.has(authStore.user?.role || ""),
);

const packages = ref<ContractAuxiliaryPackage[]>([]);
const loading = ref(false);
const creating = ref(false);
const createPanelVisible = ref(true);
const noteDialogVisible = ref(false);
const noteSaving = ref(false);
const noteDraft = ref("");
const noteTarget = ref<ContractAuxiliaryPackage | "create" | null>(null);
const createNote = ref("");
const previewVisible = ref(false);
const previewUrl = ref("");
const previewFileName = ref("");
const previewMimeType = ref("");
const previewDownloadUrl = ref("");
let localPreviewUrl = "";
interface SelectedAuxiliaryFile {
  uid: number;
  file: File;
}
interface AuxiliaryCreateFiles {
  contract: SelectedAuxiliaryFile[];
  invoice: SelectedAuxiliaryFile[];
  receipt: SelectedAuxiliaryFile[];
}
const MAX_AUXILIARY_FILES = 20;
const MAX_AUXILIARY_FILE_BYTES = 30 * 1024 * 1024;
const createFiles = ref<AuxiliaryCreateFiles>({
  contract: [],
  invoice: [],
  receipt: [],
});
const selectedFileCount = computed(
  () =>
    createFiles.value.contract.length +
    createFiles.value.invoice.length +
    createFiles.value.receipt.length,
);
const appendTargetPackage = computed(() => packages.value[0] || null);
const isAppendingToExistingPackage = computed(
  () =>
    createFiles.value.contract.length === 0 &&
    Boolean(appendTargetPackage.value),
);
const canArchiveSelection = computed(
  () =>
    selectedFileCount.value > 0 &&
    (createFiles.value.contract.length > 0 ||
      Boolean(appendTargetPackage.value)),
);

const uploadOptions = [
  {
    kind: "contract" as const,
    label: "辅助合同",
    description: "首次归档至少1份；已有档案后无需重复选择",
    accept: ".pdf,.doc,.docx",
  },
  {
    kind: "invoice" as const,
    label: "发票",
    description: "仅作辅助档案，不生成正式发票流水",
    accept: ".pdf,.jpg,.jpeg,.png",
  },
  {
    kind: "receipt" as const,
    label: "银行回单",
    description: "仅作辅助档案，不生成回款或付款流水",
    accept: ".pdf,.jpg,.jpeg,.png",
  },
];

function fileKindLabel(kind: ContractAuxiliaryFileKind) {
  return { contract: "合同", invoice: "发票", receipt: "回单" }[kind];
}

function openPreview(input: {
  url: string;
  fileName: string;
  mimeType: string;
  downloadUrl?: string;
  local?: boolean;
}) {
  closePreview();
  previewUrl.value = input.url;
  previewFileName.value = input.fileName;
  previewMimeType.value = input.mimeType;
  previewDownloadUrl.value = input.downloadUrl || "";
  localPreviewUrl = input.local ? input.url : "";
  previewVisible.value = true;
}

function previewArchivedFile(
  item: ContractAuxiliaryPackage,
  file: ContractAuxiliaryPackage["files"][number],
) {
  const url = getContractAuxiliaryFileUrl(props.contractId, item.id, file.id);
  if (useNativePreview.value) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  openPreview({
    url,
    fileName: file.fileName,
    mimeType: file.mimeType,
    downloadUrl: getContractAuxiliaryFileUrl(
      props.contractId,
      item.id,
      file.id,
      true,
    ),
  });
}

function previewSelectedFile(file: File) {
  const url = URL.createObjectURL(file);
  if (useNativePreview.value) {
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  openPreview({
    url,
    fileName: file.name,
    mimeType: file.type,
    local: true,
  });
}

function downloadSelectedFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadPreviewFile() {
  if (!previewDownloadUrl.value) return;
  const anchor = document.createElement("a");
  anchor.href = previewDownloadUrl.value;
  anchor.click();
}

function closePreview() {
  previewVisible.value = false;
  if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
  localPreviewUrl = "";
  previewUrl.value = "";
  previewFileName.value = "";
  previewMimeType.value = "";
  previewDownloadUrl.value = "";
}

async function loadPackages(showLoading = true) {
  if (!props.contractId) return;
  if (showLoading) loading.value = true;
  try {
    packages.value = await getContractAuxiliaryPackages(props.contractId);
    emit("contentState", packages.value.length > 0);
  } catch (error) {
    // 读取失败时按“可能仍有内容”处理，避免前端误开放关闭开关；后台仍会复核。
    emit("contentState", true);
    if (showLoading) {
      ElMessage.error(getContractErrorMessage(error, "辅助合同加载失败"));
    }
  } finally {
    if (showLoading) loading.value = false;
  }
}

function toggleCreatePanel() {
  createPanelVisible.value = !createPanelVisible.value;
  if (!createPanelVisible.value) resetCreateForm();
}

function resetCreateForm() {
  createFiles.value = { contract: [], invoice: [], receipt: [] };
  createNote.value = "";
}

function selectFile(kind: ContractAuxiliaryFileKind, uploadFile: UploadFile) {
  const file = uploadFile.raw;
  if (!file) return;
  if (file.size > MAX_AUXILIARY_FILE_BYTES) {
    ElMessage.error(`${uploadFile.name} 超过 30MB`);
    return;
  }
  if (selectedFileCount.value >= MAX_AUXILIARY_FILES) {
    ElMessage.error(`每个辅助材料档案包最多上传 ${MAX_AUXILIARY_FILES} 份文件`);
    return;
  }
  const selected = { uid: uploadFile.uid, file };
  createFiles.value = {
    ...createFiles.value,
    [kind]: [...createFiles.value[kind], selected],
  };
}

function selectedFiles(
  kind: ContractAuxiliaryFileKind,
): SelectedAuxiliaryFile[] {
  return createFiles.value[kind];
}

function clearFile(kind: ContractAuxiliaryFileKind, uid: number) {
  createFiles.value = {
    ...createFiles.value,
    [kind]: createFiles.value[kind].filter((item) => item.uid !== uid),
  };
}

function openCreateNoteDialog() {
  noteTarget.value = "create";
  noteDraft.value = createNote.value;
  noteDialogVisible.value = true;
}

function openNoteDialog(item: ContractAuxiliaryPackage) {
  noteTarget.value = item;
  noteDraft.value = item.note || "";
  noteDialogVisible.value = true;
}

async function saveNote() {
  if (noteTarget.value === "create") {
    createNote.value = noteDraft.value.trim();
    noteDialogVisible.value = false;
    return;
  }
  const target = noteTarget.value;
  if (!target) return;
  noteSaving.value = true;
  try {
    await updateContractAuxiliaryNote(
      props.contractId,
      target.id,
      target.version,
      noteDraft.value,
    );
    noteDialogVisible.value = false;
    ElMessage.success("辅助合同备注已保存");
    await loadPackages(false);
  } catch (error) {
    ElMessage.error(getContractErrorMessage(error, "保存备注失败"));
  } finally {
    noteSaving.value = false;
  }
}

async function createPackage() {
  const contracts = createFiles.value.contract.map((item) => item.file);
  if (!canArchiveSelection.value || creating.value) return;
  creating.value = true;
  try {
    const invoices = createFiles.value.invoice.map((item) => item.file);
    const receipts = createFiles.value.receipt.map((item) => item.file);
    if (contracts.length === 0 && appendTargetPackage.value) {
      await appendContractAuxiliaryFiles(
        props.contractId,
        appendTargetPackage.value.id,
        appendTargetPackage.value.version,
        {
          invoice: invoices,
          receipt: receipts,
          note: createNote.value,
        },
      );
    } else {
      await createContractAuxiliaryPackage(props.contractId, {
        contract: contracts,
        invoice: invoices,
        receipt: receipts,
        note: createNote.value,
      });
    }
    resetCreateForm();
    createPanelVisible.value = false;
    ElMessage.success(
      contracts.length === 0
        ? "发票或回单已追加并归档"
        : "辅助材料已上传并归档",
    );
    await loadPackages(false);
  } catch (error) {
    ElMessage.error(getContractErrorMessage(error, "归档辅助材料失败"));
  } finally {
    creating.value = false;
  }
}

async function removePackage(item: ContractAuxiliaryPackage) {
  try {
    await ElMessageBox.confirm(
      "删除后辅助合同、发票、回单及归档记录都会移除，是否继续？",
      "删除辅助合同档案",
      { type: "warning", confirmButtonText: "确认删除" },
    );
    await deleteContractAuxiliaryPackage(
      props.contractId,
      item.id,
      item.version,
    );
    ElMessage.success("辅助合同档案已删除");
    await loadPackages(false);
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(getContractErrorMessage(error, "删除辅助合同失败"));
  }
}

watch(
  () => props.contractId,
  (id) => {
    if (id) void loadPackages();
  },
  { immediate: true },
);

onBeforeUnmount(closePreview);
</script>

<style scoped>
.auxiliary-manager {
  margin-top: 22px;
  padding: 20px;
  border: 1px solid #dce9e7;
  border-radius: 16px;
  background: linear-gradient(145deg, #f8fcfb, #fff);
}
.auxiliary-header,
.package-card-head,
.note-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.auxiliary-header h3 {
  margin: 3px 0 5px;
  color: #163c42;
}
.auxiliary-header p,
.optional-copy,
.upload-block small {
  margin: 0;
  color: #6b7f83;
}
.eyebrow {
  color: #17827a;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.package-list {
  display: grid;
  gap: 14px;
  margin-top: 18px;
}
.create-panel {
  margin-top: 18px;
  padding: 18px;
  border: 1px solid #dce9e7;
  border-radius: 14px;
  background: #fff;
}
.create-panel-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.create-panel-heading h4 {
  margin: 0;
  color: #163c42;
}
.create-panel-heading span {
  color: #6b7f83;
  font-size: 13px;
}
.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
.package-card {
  padding: 16px;
  border: 1px solid #e0ebe9;
  border-radius: 13px;
  background: #fff;
}
.package-card-head > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.package-card-head small {
  color: #7b8c90;
}
.package-note {
  display: flex;
  gap: 7px;
  margin: 12px 0;
  color: #526b70;
}
.package-files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.package-file {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  max-width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  background: #eef6f4;
  color: #236e67;
}
.package-file > span:first-child {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
}
.package-file > span:first-child > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}
.file-actions :deep(.el-button) {
  margin-left: 6px;
}
.upload-blocks {
  display: grid;
  gap: 12px;
  margin: 18px 0;
}
.upload-block {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px 16px;
  padding: 14px;
  border: 1px solid #e0e9e8;
  border-radius: 12px;
}
.upload-block > div:first-child {
  display: grid;
  gap: 4px;
}
.chosen-file {
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  color: #1e746c;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.chosen-files {
  grid-column: 1 / -1;
  display: grid;
  min-width: 0;
  gap: 6px;
}
.chosen-file > span {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}
.note-trigger {
  width: 100%;
  margin-top: 18px;
  padding: 14px;
  border: 1px dashed #9dc5c0;
  border-radius: 12px;
  background: #f4fbf9;
  color: #285f5a;
  text-align: left;
  cursor: pointer;
}
.note-trigger > span {
  display: grid;
  flex: 1;
  gap: 3px;
}
.note-trigger small {
  max-width: 440px;
  overflow: hidden;
  color: #6b8581;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 760px) {
  .auxiliary-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .create-panel-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .recognition-grid {
    grid-template-columns: 1fr;
  }
  .upload-block {
    grid-template-columns: minmax(0, 1fr);
    align-items: flex-start;
  }
}
</style>
