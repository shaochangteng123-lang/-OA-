<template>
  <div class="worklog-attachments">
    <div
      class="drop-zone"
      :class="{ 'is-dragover': isDragover, 'is-empty': allItems.length === 0, 'is-disabled': disabled }"
      @click="handleZoneClick"
      @dragover.prevent="handleDragOver"
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
    >
      <div
        v-for="item in allItems"
        :key="item.key"
        class="attachment-item"
        @click.stop
      >
        <template v-if="item.kind === 'image'">
          <img
            :src="item.previewUrl"
            :alt="item.fileName"
            class="attachment-thumb"
            @click="handlePreview(item)"
          />
        </template>
        <template v-else>
          <div
            class="doc-icon"
            title="双击在线查看"
            @mousedown.prevent
            @click.stop
            @dblclick.stop.prevent="handleDocDblClick(item)"
          >
            <div class="doc-type-badge" :class="getDocType(item.fileName)">{{ getDocTypeLabel(item.fileName) }}</div>
            <el-icon :size="28"><Document /></el-icon>
            <div class="doc-name">{{ item.fileName }}</div>
          </div>
        </template>
        <el-button
          v-if="!disabled"
          type="danger"
          size="small"
          link
          class="remove-btn"
          :icon="Close"
          @click.stop="handleRemove(item)"
        />
      </div>

      <div v-if="!disabled" class="zone-tip">
        <el-icon class="tip-icon"><UploadFilled /></el-icon>
        <div class="tip-text">点击 / 拖拽上传</div>
        <div v-if="kind === 'screenshot' || kind === 'photo'" class="tip-sub">支持 Ctrl/Cmd+V 粘贴</div>
      </div>
    </div>

    <div class="upload-hint">{{ acceptHint }}</div>

    <input
      ref="fileInputRef"
      type="file"
      :accept="accept"
      multiple
      class="hidden-input"
      @change="handleInputChange"
    />

    <el-image-viewer
      v-if="viewerVisible && previewSrc"
      :url-list="[previewSrc]"
      @close="viewerVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Close, Document, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/utils/api'
import type { WorklogAttachment } from '@/types'

interface PendingFile {
  tempId: string
  file: File
  previewUrl: string
}

interface DisplayItem {
  key: string
  kind: 'image' | 'document'
  fileName: string
  previewUrl: string
  pending: boolean
  attachment?: WorklogAttachment
  pendingRef?: PendingFile
}

const props = defineProps<{
  modelValue: WorklogAttachment[]
  entryId: string | null
  kind: 'screenshot' | 'photo' | 'document'
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: WorklogAttachment[]): void
}>()

const IMAGE_MAX = 3 * 1024 * 1024
const DOC_MAX = 5 * 1024 * 1024
const IMAGE_MIME = ['image/jpeg', 'image/png']
const DOC_MIME = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
]

const isImageKind = computed(() => props.kind === 'screenshot' || props.kind === 'photo')

const accept = computed(() => isImageKind.value
  ? '.jpg,.jpeg,.png'
  : '.doc,.docx,.xls,.xlsx,.pdf')
const acceptHint = computed(() => isImageKind.value
  ? '支持 JPG/PNG，单文件 ≤ 3MB'
  : '支持 Word / Excel / PDF，单文件 ≤ 5MB')

const pendingFiles = ref<PendingFile[]>([])
const viewerVisible = ref(false)
const previewSrc = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const isDragover = ref(false)
let tmpSeq = 0

const allItems = computed<DisplayItem[]>(() => {
  const uploaded: DisplayItem[] = props.modelValue.map(a => ({
    key: `u-${a.id}`,
    kind: a.fileKind === 'document' ? 'document' : 'image',
    fileName: a.fileName,
    previewUrl: `/api/files/worklog/${a.id}`,
    pending: false,
    attachment: a,
  }))
  const pendings: DisplayItem[] = pendingFiles.value.map(p => ({
    key: `p-${p.tempId}`,
    kind: isImageKind.value ? 'image' : 'document',
    fileName: p.file.name,
    previewUrl: p.previewUrl,
    pending: true,
    pendingRef: p,
  }))
  return [...uploaded, ...pendings]
})

function validateFile(file: File): boolean {
  if (isImageKind.value) {
    if (!IMAGE_MIME.includes(file.type)) {
      ElMessage.error('图片仅支持 JPG/PNG')
      return false
    }
    if (file.size > IMAGE_MAX) {
      ElMessage.error('图片不能超过 3MB')
      return false
    }
  } else {
    if (!DOC_MIME.includes(file.type)) {
      ElMessage.error('文档仅支持 Word / Excel / PDF')
      return false
    }
    if (file.size > DOC_MAX) {
      ElMessage.error('文档不能超过 5MB')
      return false
    }
  }
  return true
}

async function uploadToServer(file: File, entryId: string): Promise<boolean> {
  const fd = new FormData()
  fd.append('file_kind', props.kind)
  fd.append('file', file)
  try {
    const resp = await api.post(`/api/worklog-entries/${entryId}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    if (resp.data?.success && resp.data?.data) {
      const d = resp.data.data
      const att: WorklogAttachment = {
        id: d.id,
        fileKind: d.fileKind,
        fileName: d.fileName,
        filePath: d.filePath,
        fileSize: d.fileSize,
        mimeType: null,
        uploadedBy: '',
        createdAt: new Date().toISOString(),
      }
      emit('update:modelValue', [...props.modelValue, att])
      return true
    }
    ElMessage.error(resp.data?.message || '上传失败')
    return false
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '上传失败')
    return false
  }
}

async function handleSingleFile(file: File) {
  if (!validateFile(file)) return
  if (!props.entryId) {
    const previewUrl = URL.createObjectURL(file)
    pendingFiles.value.push({ tempId: `p_${++tmpSeq}`, file, previewUrl })
    return
  }
  await uploadToServer(file, props.entryId)
}

function handleZoneClick() {
  if (props.disabled) return
  fileInputRef.value?.click()
}

function handleDragOver() {
  if (props.disabled) return
  isDragover.value = true
}

function handleDragLeave() {
  isDragover.value = false
}

async function handleDrop(e: DragEvent) {
  isDragover.value = false
  if (props.disabled) return
  const files = Array.from(e.dataTransfer?.files || [])
  for (const f of files) {
    await handleSingleFile(f)
  }
}

async function handleInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  for (const f of files) {
    await handleSingleFile(f)
  }
  input.value = ''
}

async function handleRemove(item: DisplayItem) {
  if (item.pending && item.pendingRef) {
    const p = item.pendingRef
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
    pendingFiles.value = pendingFiles.value.filter(x => x.tempId !== p.tempId)
    return
  }
  if (!item.attachment) return
  const att = item.attachment
  try {
    await ElMessageBox.confirm(`确定删除 ${att.fileName}?`, '提示', { type: 'warning' })
  } catch { return }
  if (!props.entryId) {
    emit('update:modelValue', props.modelValue.filter(x => x.id !== att.id))
    return
  }
  try {
    const resp = await api.delete(`/api/worklog-entries/${props.entryId}/attachments/${att.id}`)
    if (resp.data.success) {
      emit('update:modelValue', props.modelValue.filter(x => x.id !== att.id))
      ElMessage.success('已删除')
    } else {
      ElMessage.error(resp.data.message || '删除失败')
    }
  } catch {
    ElMessage.error('删除失败')
  }
}

function handlePreview(item: DisplayItem) {
  if (item.kind === 'image') {
    previewSrc.value = item.previewUrl
    viewerVisible.value = true
    return
  }
  if (item.pending && item.pendingRef) {
    previewPendingDocument(item.pendingRef.file)
    return
  }
  if (!item.attachment) return
  const previewUrl = `/api/files/worklog/${item.attachment.id}/preview`
  window.open(previewUrl, '_blank')
}

function handleDocDblClick(item: DisplayItem) {
  try { window.getSelection()?.removeAllRanges() } catch { /* ignore */ }
  handlePreview(item)
}

function getDocType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['doc', 'docx'].includes(ext)) return 'word'
  if (['xls', 'xlsx'].includes(ext)) return 'excel'
  if (ext === 'pdf') return 'pdf'
  return 'other'
}

function getDocTypeLabel(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['doc', 'docx'].includes(ext)) return 'Word'
  if (['xls', 'xlsx'].includes(ext)) return 'Excel'
  if (ext === 'pdf') return 'PDF'
  return ''
}

async function previewPendingDocument(file: File) {
  const win = window.open('', '_blank')
  if (!win) {
    ElMessage.warning('浏览器已拦截弹窗，请允许后重试')
    return
  }
  win.document.write('<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,sans-serif;color:#909399">正在准备预览…</body></html>')
  try {
    const fd = new FormData()
    fd.append('file', file)
    const resp = await fetch('/api/files/worklog-preview-temp', {
      method: 'POST',
      credentials: 'include',
      body: fd,
    })
    if (!resp.ok) {
      let msg = `预览失败（${resp.status}）`
      try {
        const j = await resp.json()
        if (j?.message) msg = j.message
      } catch { /* ignore */ }
      throw new Error(msg)
    }
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    win.location.replace(url)
    // 由浏览器加载后再回收 URL
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err: any) {
    const msg = err?.message || '预览失败'
    win.document.body.innerHTML = `<div style="padding:24px;color:#f56c6c;font-family:-apple-system,sans-serif">${msg}</div>`
    ElMessage.error(msg)
  }
}

function onGlobalPaste(e: ClipboardEvent) {
  if (!isImageKind.value || props.disabled) return
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length === 0) return
  e.preventDefault()
  files.forEach(f => handleSingleFile(f))
}

onMounted(() => {
  if (isImageKind.value) {
    document.addEventListener('paste', onGlobalPaste)
  }
})
onUnmounted(() => {
  if (isImageKind.value) {
    document.removeEventListener('paste', onGlobalPaste)
  }
  pendingFiles.value.forEach(p => {
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
  })
})

async function uploadPending(entryId: string): Promise<boolean> {
  if (pendingFiles.value.length === 0) return true
  let allOk = true
  const toUpload = [...pendingFiles.value]
  for (const p of toUpload) {
    const ok = await uploadToServer(p.file, entryId)
    if (ok) {
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
      pendingFiles.value = pendingFiles.value.filter(x => x.tempId !== p.tempId)
    } else {
      allOk = false
    }
  }
  return allOk
}

async function uploadToNote(entryId: string, noteId: string): Promise<boolean> {
  if (pendingFiles.value.length === 0) return true
  let allOk = true
  const toUpload = [...pendingFiles.value]
  for (const p of toUpload) {
    const fd = new FormData()
    fd.append('file_kind', props.kind)
    fd.append('file', p.file)
    try {
      const resp = await api.post(
        `/api/worklog-entries/${entryId}/progress/${noteId}/attachments`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      if (resp.data?.success) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
        pendingFiles.value = pendingFiles.value.filter(x => x.tempId !== p.tempId)
      } else {
        allOk = false
      }
    } catch (err) {
      console.error('上传进展附件失败:', err)
      allOk = false
    }
  }
  return allOk
}

function hasPending(): boolean {
  return pendingFiles.value.length > 0
}

function clearPending() {
  pendingFiles.value.forEach(p => {
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
  })
  pendingFiles.value = []
}

defineExpose({ uploadPending, uploadToNote, hasPending, clearPending, pendingFiles, kind: computed(() => props.kind) })
</script>

<style scoped>
.worklog-attachments {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  line-height: 1.5;
}

.hidden-input {
  display: none;
}

.drop-zone {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px;
  min-height: 120px;
  padding: 14px;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  background: #fafafa;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s;
  box-sizing: border-box;
}

.drop-zone:hover,
.drop-zone.is-dragover {
  border-color: var(--el-color-primary);
  background: #fff;
}

.drop-zone.is-empty {
  justify-content: center;
  align-items: center;
}

.drop-zone.is-disabled {
  cursor: not-allowed;
  background: #f5f7fa;
}

.attachment-item {
  position: relative;
  flex: 0 0 auto;
  width: 96px;
  height: 96px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
  box-sizing: border-box;
}

.attachment-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  cursor: pointer;
}

.doc-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 6px;
  color: #606266;
  box-sizing: border-box;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  position: relative;
}

.doc-type-badge {
  position: absolute; top: 4px; left: 4px;
  font-size: 9px; font-weight: 700; padding: 1px 4px;
  border-radius: 2px; color: #fff; line-height: 1.2;
}
.doc-type-badge.word { background: #2b579a; }
.doc-type-badge.excel { background: #217346; }
.doc-type-badge.pdf { background: #d63b3b; }
.doc-type-badge.other { background: #909399; }

.doc-name {
  font-size: 11px;
  margin-top: 4px;
  text-align: center;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
  line-height: 1.3;
}

.pending-tag {
  position: absolute;
  left: 2px;
  bottom: 2px;
  transform: scale(0.75);
  transform-origin: left bottom;
}

.remove-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  z-index: 2;
}

.zone-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #909399;
  pointer-events: none;
}

.drop-zone.is-empty .zone-tip {
  width: 100%;
}

.drop-zone:not(.is-empty) .zone-tip {
  width: 96px;
  height: 96px;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
}

.tip-icon {
  font-size: 26px;
  color: #c0c4cc;
}

.drop-zone:not(.is-empty) .tip-icon {
  font-size: 22px;
}

.tip-text {
  font-size: 13px;
  color: #606266;
}

.drop-zone:not(.is-empty) .tip-text {
  font-size: 12px;
}

.tip-sub {
  font-size: 12px;
  color: #909399;
}

.drop-zone:not(.is-empty) .tip-sub {
  display: none;
}

.upload-hint {
  font-size: 12px;
  color: #909399;
}
</style>
