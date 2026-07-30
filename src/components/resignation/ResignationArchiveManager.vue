<template>
  <div v-loading="loading || mutationPending" class="resignation-archive-manager">
    <div class="archive-summary">
      <div class="archive-progress">
        <span class="archive-progress-label">档案完成度</span>
        <el-progress
          :percentage="completionPercentage"
          :status="completionPercentage === 100 ? 'success' : ''"
          :stroke-width="10"
        />
        <span class="archive-progress-count">{{ completedCount }} / {{ archiveRows.length }}</span>
      </div>
      <div class="archive-summary-actions">
        <el-button
          v-if="canConfirm"
          type="danger"
          :icon="CircleCheck"
          @click="confirmCompletion"
        >
          确认离职并停用账号
        </el-button>
        <el-upload
          v-if="canUpload"
          :show-file-list="false"
          accept=".pdf,application/pdf"
          :before-upload="handleAutoClassify"
        >
          <el-button type="primary" :icon="UploadFilled">一键识别上传</el-button>
        </el-upload>
      </div>
    </div>

    <el-alert
      v-if="canConfirm"
      type="warning"
      :closable="false"
      show-icon
      class="archive-tip"
      title="五类离职档案已全部识别。请逐项预览核对，确认后员工状态将改为已离职，原账号将立即停用。"
    />
    <el-alert
      v-else-if="canUpload && status === 'draft'"
      type="info"
      :closable="false"
      show-icon
      class="archive-tip"
      title="请上传五类离职档案；全部齐全后需由管理员核对并确认，系统才会停用该员工原账号。"
    />

    <el-table :data="archiveRows" border class="archive-table" table-layout="fixed">
      <el-table-column
        type="index"
        label="序号"
        width="72"
        align="center"
        header-class-name="sequence-column-header"
      />
      <el-table-column prop="label" label="文件类型" width="230" />
      <el-table-column label="已上传文件" min-width="280">
        <template #default="{ row }">
          <div v-if="row.document" class="archive-file">
            <Document class="archive-file-icon" />
            <div class="archive-file-info">
              <span class="archive-file-name" :title="row.document.file_name">
                {{ row.document.file_name }}
              </span>
              <span class="archive-file-meta">
                {{ formatFileSize(row.document.file_size) }}
                <template v-if="row.document.uploaded_by_name">
                  · {{ row.document.uploaded_by_name }}
                </template>
              </span>
            </div>
          </div>
          <span v-else class="archive-empty">暂未上传</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.document ? 'success' : 'info'">
            {{ row.document ? '已上传' : '待上传' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" align="center">
        <template #default="{ row }">
          <div class="archive-actions">
            <template v-if="row.document">
              <el-button
                link
                type="primary"
                :icon="View"
                @click="previewDocument(row.document)"
              >
                在线预览
              </el-button>
              <el-button link type="primary" @click="downloadDocument(row.document)">
                下载
              </el-button>
              <el-button
                v-if="canDelete"
                link
                type="danger"
                @click="deleteDocument(row.document)"
              >
                删除
              </el-button>
            </template>
            <el-upload
              v-if="canUpload"
              class="inline-upload"
              :show-file-list="false"
              accept=".pdf,application/pdf"
              :before-upload="file => handleSingleUpload(row.type, file)"
            >
              <el-button link type="primary">
                {{ row.document ? '替换' : '上传' }}
              </el-button>
            </el-upload>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { CircleCheck, Document, UploadFilled, View } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/utils/api'
import type {
  ResignationDetailData,
  ResignationDocument,
} from '@/stores/resignation'

export type ResignationArchiveType =
  | 'termination_agreement'
  | 'employee_handover_form'
  | 'settlement_confirmation'
  | 'compensation_agreement'
  | 'resignation_certificate'

const ARCHIVE_TYPES: Array<{ type: ResignationArchiveType; label: string }> = [
  { type: 'termination_agreement', label: '终止 / 解除劳动关系协议书' },
  { type: 'employee_handover_form', label: '员工离职交接单' },
  { type: 'settlement_confirmation', label: '薪资及各类款项结算确认书' },
  { type: 'compensation_agreement', label: '离职经济补偿协议书' },
  { type: 'resignation_certificate', label: '离职证明' },
]

const props = withDefaults(defineProps<{
  requestId?: string | null
  status?: string | null
  documents?: ResignationDocument[]
  loading?: boolean
  editable?: boolean
}>(), {
  requestId: null,
  status: null,
  documents: () => [],
  loading: false,
  editable: true,
})

const emit = defineEmits<{
  updated: [detail: ResignationDetailData]
  completed: []
}>()

const mutationPending = ref(false)
const canUpload = computed(() =>
  props.editable
  && Boolean(props.requestId)
  && ['draft', 'pending_confirmation', 'approved'].includes(props.status || '')
)
const canDelete = computed(() =>
  canUpload.value
  && ['draft', 'pending_confirmation'].includes(props.status || '')
)

const archiveRows = computed(() => ARCHIVE_TYPES.map(item => ({
  ...item,
  document: props.documents.find(document =>
    document.document_type === item.type
    && (document.is_current === undefined || Number(document.is_current) === 1)
  ) || null,
})))

const completedCount = computed(() => archiveRows.value.filter(row => row.document).length)
const completionPercentage = computed(() => Math.round(
  completedCount.value / archiveRows.value.length * 100,
))
const canConfirm = computed(() =>
  props.editable
  && Boolean(props.requestId)
  && ['draft', 'pending_confirmation'].includes(props.status || '')
  && completedCount.value === archiveRows.value.length
)

function validatePdf(file: File): boolean {
  const isPdf = file.name.toLowerCase().endsWith('.pdf')
    && (!file.type || file.type === 'application/pdf')
  if (!isPdf) {
    ElMessage.error('仅支持 PDF 文件')
    return false
  }
  if (file.size > 30 * 1024 * 1024) {
    ElMessage.error('文件大小不能超过 30MB')
    return false
  }
  return true
}

function buildFormData(file: File): FormData {
  const formData = new FormData()
  formData.append('originalFileName', file.name)
  formData.append('file', file)
  return formData
}

function getRequestErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null || !('response' in error)) return fallback
  const response = (error as {
    response?: { data?: { message?: unknown } }
  }).response
  return typeof response?.data?.message === 'string' ? response.data.message : fallback
}

async function handleSingleUpload(type: ResignationArchiveType, file: File) {
  if (!props.requestId || !validatePdf(file) || mutationPending.value) return false
  mutationPending.value = true
  try {
    const response = await api.post(
      `/api/resignation/management/${props.requestId}/documents/type/${type}`,
      buildFormData(file),
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000,
      },
    )
    if (response.data.success) {
      ElMessage.success(response.data.message || '离职档案上传成功')
      emit('updated', response.data.data)
    } else {
      ElMessage.error(response.data.message || '离职档案上传失败')
    }
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, '离职档案上传失败'))
  } finally {
    mutationPending.value = false
  }
  return false
}

async function handleAutoClassify(file: File) {
  if (!props.requestId || !validatePdf(file) || mutationPending.value) return false
  mutationPending.value = true
  try {
    const response = await api.post(
      `/api/resignation/management/${props.requestId}/documents/auto-classify`,
      buildFormData(file),
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000,
      },
    )
    if (response.data.success) {
      ElMessage.success(response.data.message || '离职档案识别完成')
      emit('updated', response.data.data)
    } else {
      ElMessage.error(response.data.message || '离职档案识别失败')
    }
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, '离职档案识别失败'))
  } finally {
    mutationPending.value = false
  }
  return false
}

async function confirmCompletion() {
  if (!props.requestId || !canConfirm.value || mutationPending.value) return
  try {
    await ElMessageBox.confirm(
      '请确认五份离职档案均已预览核对。确认后员工状态将立即改为“已离职”，该员工原账号将立即停用。',
      '确认离职并停用账号',
      {
        confirmButtonText: '确认离职并停用',
        cancelButtonText: '继续核对',
        type: 'warning',
      },
    )
  } catch {
    return
  }

  mutationPending.value = true
  try {
    const response = await api.post(
      `/api/resignation/management/${props.requestId}/confirm-completion`,
    )
    if (response.data.success) {
      ElMessage.success(response.data.message || '离职已确认')
      emit('updated', response.data.data)
      emit('completed')
    } else {
      ElMessage.error(response.data.message || '确认离职失败')
    }
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, '确认离职失败'))
  } finally {
    mutationPending.value = false
  }
}

function previewDocument(document: ResignationDocument) {
  if (!props.requestId) return
  window.open(
    `/api/resignation/requests/${props.requestId}/documents/${document.id}/download`,
    '_blank',
    'noopener,noreferrer',
  )
}

async function downloadDocument(document: ResignationDocument) {
  if (!props.requestId) return
  try {
    const response = await api.get(
      `/api/resignation/requests/${props.requestId}/documents/${document.id}/download`,
      {
        params: { download: 1 },
        responseType: 'blob',
      },
    )
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = window.document.createElement('a')
    link.href = url
    link.download = document.file_name
    window.document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch {
    ElMessage.error('文件下载失败')
  }
}

async function deleteDocument(document: ResignationDocument) {
  if (!props.requestId || mutationPending.value) return
  try {
    await ElMessageBox.confirm(
      `确定删除“${document.file_name}”吗？`,
      '删除离职档案',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return
  }

  mutationPending.value = true
  try {
    const response = await api.delete(
      `/api/resignation/management/${props.requestId}/documents/${document.id}`,
    )
    if (response.data.success) {
      ElMessage.success(response.data.message || '离职档案已删除')
      emit('updated', response.data.data)
    } else {
      ElMessage.error(response.data.message || '删除失败')
    }
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, '删除失败'))
  } finally {
    mutationPending.value = false
  }
}

function formatFileSize(size: number | null): string {
  if (!size) return '-'
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style scoped>
.archive-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 14px;
}

.archive-progress {
  display: grid;
  grid-template-columns: 90px minmax(180px, 360px) 48px;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.archive-progress-label {
  color: var(--el-text-color-regular);
}

.archive-progress-count {
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}

.archive-summary-actions,
.archive-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: nowrap;
}

.archive-tip {
  margin-bottom: 14px;
}

.archive-table {
  width: 100%;
}

.archive-table :deep(.el-table__cell) {
  padding-right: 6px;
  padding-left: 6px;
}

.archive-table :deep(.sequence-column-header .cell) {
  white-space: nowrap;
  word-break: keep-all;
}

.archive-file {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.archive-file-icon {
  width: 28px;
  height: 28px;
  padding: 5px;
  flex: 0 0 auto;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 4px;
}

.archive-file-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.archive-file-name {
  overflow: hidden;
  color: var(--el-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-file-meta,
.archive-empty {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.inline-upload {
  display: inline-block;
}

.archive-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

@media (max-width: 760px) {
  .archive-summary {
    align-items: stretch;
    flex-direction: column;
  }

  .archive-progress {
    grid-template-columns: 82px minmax(120px, 1fr) 44px;
  }
}
</style>
