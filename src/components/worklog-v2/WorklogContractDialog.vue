<template>
  <el-dialog
    :model-value="visible"
    :title="`${projectName} — 合同付款进度`"
    width="860px"
    top="1vh"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:visible', $event)"
    @open="loadData"
  >
    <div class="contract-panel">
      <div class="contract-amount-row">
        <span class="label">合同总金额：</span>
        <template v-if="editingAmount">
          <el-input-number
            v-model="amountInput"
            :min="0"
            :precision="2"
            :controls="false"
            placeholder="输入金额"
            style="width: 160px"
          />
          <span style="margin-left: 4px; color: #909399">元</span>
          <el-button size="small" type="primary" link @click="saveAmount" :loading="amountSaving">保存</el-button>
          <el-button size="small" link @click="editingAmount = false">取消</el-button>
        </template>
        <template v-else>
          <span v-if="totalAmount" class="amount-value">¥{{ Number(totalAmount).toLocaleString() }}</span>
          <span v-else class="amount-empty">未填写</span>
          <el-button size="small" link @click="startEditAmount">修改</el-button>
        </template>
      </div>

      <div class="contract-timeline" v-if="timeline.length > 0">
        <div v-for="item in timeline" :key="item.id" class="timeline-item">
          <div class="timeline-dot" />
          <div class="timeline-content">
            <div class="timeline-header">
              <el-tag size="small" :type="tagType(item.status)">{{ item.status }}</el-tag>
              <span v-if="item.amount" class="timeline-amount">¥{{ Number(item.amount).toLocaleString() }}</span>
              <span class="timeline-meta">{{ item.createdByName }} · {{ formatTime(item.createdAt) }}</span>
              <el-button size="small" link type="danger" @click="handleDelete(item)">删除</el-button>
            </div>
            <div v-if="item.note" class="timeline-note">{{ item.note }}</div>
            <div v-if="item.attachments && item.attachments.length > 0" class="timeline-attachments">
              <div v-if="getImages(item.attachments).length > 0" class="att-images">
                <img
                  v-for="att in getImages(item.attachments)"
                  :key="att.id"
                  :src="`/api/files/worklog-contract/${att.id}`"
                  class="att-thumb"
                  @click="handlePreviewImage(att.id)"
                />
              </div>
              <div v-if="getDocs(item.attachments).length > 0" class="att-docs">
                <span
                  v-for="att in getDocs(item.attachments)"
                  :key="att.id"
                  class="att-link"
                  @click="handlePreviewDoc(att.id)"
                >
                  {{ att.fileName }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <el-empty v-else description="暂无合同进度记录" :image-size="60" />

      <div class="contract-add-form">
        <div class="form-title">
          追加进度
          <el-tag v-if="isSettled" type="success" size="small" style="margin-left: 8px">已结清，无法追加</el-tag>
        </div>
        <el-form :model="form" label-width="90px" size="small" :disabled="isSettled">
          <el-form-item label="状态" required>
            <el-select v-model="form.status" placeholder="选择合同状态" style="width: 100%">
              <el-option v-for="s in statuses" :key="s.id" :label="s.name" :value="s.name" />
            </el-select>
          </el-form-item>
          <el-form-item label="金额">
            <el-input-number
              v-model="form.amount"
              :min="0"
              :precision="2"
              :controls="false"
              placeholder="涉及金额（选填）"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.note" type="textarea" :rows="2" placeholder="备注说明（选填）" />
          </el-form-item>
          <div class="upload-row">
            <div class="upload-section">
              <div class="upload-label">图片附件</div>
              <div class="upload-box" @click="triggerImageUpload" @dragover.prevent @drop.prevent="handleDropImages">
                <div v-if="uploadImages.length > 0" class="upload-file-list">
                  <div v-for="(file, idx) in uploadImages" :key="file.uid" class="upload-file-item image-item">
                    <img :src="getFileThumb(file)" class="file-thumb" @click.stop="handleUploadPreview(file)" />
                    <el-icon class="file-remove" @click.stop="uploadImages.splice(idx, 1)"><Close /></el-icon>
                  </div>
                </div>
                <div class="upload-placeholder">
                  <el-icon class="upload-icon"><UploadFilled /></el-icon>
                  <div>点击 / 拖拽上传</div>
                  <div class="upload-sub">支持 Ctrl/Cmd+V 粘贴</div>
                </div>
              </div>
              <input ref="imageInputRef" type="file" accept=".jpg,.jpeg,.png,.gif,.webp" multiple hidden @change="handleImageInputChange" />
              <div class="upload-tip">支持 JPG/PNG/GIF，单文件 ≤ 10MB</div>
            </div>
            <div class="upload-section">
              <div class="upload-label">文档附件</div>
              <div class="upload-box" @click="triggerDocUpload" @dragover.prevent @drop.prevent="handleDropDocs">
                <div v-if="uploadDocs.length > 0" class="upload-file-list">
                  <div v-for="(file, idx) in uploadDocs" :key="file.uid" class="upload-file-item doc-item" @click.stop="handleUploadPreview(file)">
                    <div class="doc-type-badge" :class="getDocType(file.name)">{{ getDocTypeLabel(file.name) }}</div>
                    <el-icon class="doc-icon"><Document /></el-icon>
                    <div class="doc-name">{{ file.name }}</div>
                    <el-icon class="file-remove" @click.stop="uploadDocs.splice(idx, 1)"><Close /></el-icon>
                  </div>
                </div>
                <div class="upload-placeholder">
                  <el-icon class="upload-icon"><UploadFilled /></el-icon>
                  <div>点击 / 拖拽上传</div>
                  <div class="upload-sub">支持 Ctrl/Cmd+V 粘贴</div>
                </div>
              </div>
              <input ref="docInputRef" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" multiple hidden @change="handleDocInputChange" />
              <div class="upload-tip">支持 Word / Excel / PDF，单文件 ≤ 10MB</div>
            </div>
          </div>
        </el-form>
        <div class="form-footer">
          <el-button @click="handleClose">取消</el-button>
          <el-button type="primary" :loading="adding" :disabled="isSettled" @click="handleAdd">提交</el-button>
        </div>
      </div>
    </div>
  </el-dialog>

  <el-image-viewer
    v-if="previewVisible && previewUrl"
    :url-list="[previewUrl]"
    :z-index="9999"
    :teleported="true"
    @close="previewVisible = false"
  />
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled, Close, Document } from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import type { WorklogContractProgress } from '@/types'
import type { UploadFile } from 'element-plus'

interface DictItem { id: string; name: string }

const props = defineProps<{
  visible: boolean
  projectId: string
  projectName: string
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'statusChanged', status: string | null): void
}>()

const timeline = ref<WorklogContractProgress[]>([])
const statuses = ref<DictItem[]>([])
const totalAmount = ref<number | null>(null)
const adding = ref(false)
const editingAmount = ref(false)
const amountInput = ref<number | undefined>(undefined)
const amountSaving = ref(false)
const previewVisible = ref(false)
const previewUrl = ref('')

interface AttItem { id: string; fileName: string; mimeType?: string | null }

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function isImage(att: AttItem): boolean {
  if (att.mimeType && IMAGE_MIME.includes(att.mimeType)) return true
  const ext = att.fileName.split('.').pop()?.toLowerCase() || ''
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)
}

function getImages(atts: AttItem[]) { return atts.filter(isImage) }
function getDocs(atts: AttItem[]) { return atts.filter(a => !isImage(a)) }

function handlePreviewImage(attId: string) {
  previewUrl.value = `/api/files/worklog-contract/${attId}`
  previewVisible.value = true
}

function handlePreviewDoc(attId: string) {
  window.open(`/api/files/worklog-contract/${attId}/preview`, '_blank')
}

function handleUploadPreview(file: UploadFile) {
  if (!file.raw) return
  if (file.raw.type.startsWith('image/')) {
    previewUrl.value = URL.createObjectURL(file.raw)
    previewVisible.value = true
  } else {
    previewPendingDocument(file.raw)
  }
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
      try { const j = await resp.json(); if (j?.message) msg = j.message } catch { /* ignore */ }
      throw new Error(msg)
    }
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    win.location.replace(url)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err: any) {
    const msg = err?.message || '预览失败'
    win.document.body.innerHTML = `<div style="padding:24px;color:#f56c6c;font-family:-apple-system,sans-serif">${msg}</div>`
    ElMessage.error(msg)
  }
}

const form = reactive({
  status: '',
  amount: undefined as number | undefined,
  note: '',
})
const uploadImages = ref<UploadFile[]>([])
const uploadDocs = ref<UploadFile[]>([])
const imageInputRef = ref<HTMLInputElement | null>(null)
const docInputRef = ref<HTMLInputElement | null>(null)

function triggerImageUpload() { imageInputRef.value?.click() }
function triggerDocUpload() { docInputRef.value?.click() }

function fileToUploadFile(file: File): UploadFile {
  return { name: file.name, raw: file, size: file.size, uid: Date.now() + Math.random(), status: 'ready' } as unknown as UploadFile
}

function handleImageInputChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const f of Array.from(files)) uploadImages.value.push(fileToUploadFile(f))
  ;(e.target as HTMLInputElement).value = ''
}

function handleDocInputChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const f of Array.from(files)) uploadDocs.value.push(fileToUploadFile(f))
  ;(e.target as HTMLInputElement).value = ''
}

function handleDropImages(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (!files) return
  for (const f of Array.from(files)) {
    if (f.type.startsWith('image/')) uploadImages.value.push(fileToUploadFile(f))
  }
}

function handleDropDocs(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (!files) return
  for (const f of Array.from(files)) uploadDocs.value.push(fileToUploadFile(f))
}

function getFileThumb(file: UploadFile): string {
  if (file.url) return file.url
  if (file.raw) return URL.createObjectURL(file.raw)
  return ''
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

const isSettled = computed(() => {
  if (timeline.value.length === 0) return false
  const last = timeline.value[timeline.value.length - 1]
  return last.status === '已结清'
})

function handleClose() {
  emit('update:visible', false)
}

async function loadData() {
  form.status = ''
  form.amount = undefined
  form.note = ''
  uploadImages.value = []
  uploadDocs.value = []
  editingAmount.value = false
  await Promise.all([loadTimeline(), loadStatuses()])
}

async function loadTimeline() {
  try {
    const resp = await api.get(`/api/worklog-projects/${props.projectId}/contract`)
    if (resp.data.success) {
      const d = resp.data.data
      timeline.value = d.progress || []
      totalAmount.value = d.contractTotalAmount ?? null
    }
  } catch { timeline.value = [] }
}

async function loadStatuses() {
  if (statuses.value.length > 0) return
  try {
    const resp = await api.get('/api/worklog-dicts/contract-statuses')
    if (resp.data.success) statuses.value = resp.data.data
  } catch { /* ignore */ }
}

function startEditAmount() {
  amountInput.value = totalAmount.value ?? undefined
  editingAmount.value = true
}

async function saveAmount() {
  amountSaving.value = true
  try {
    const resp = await api.put(`/api/worklog-projects/${props.projectId}/contract-amount`, {
      amount: amountInput.value ?? null,
    })
    if (resp.data.success) {
      totalAmount.value = amountInput.value ?? null
      editingAmount.value = false
      ElMessage.success('已保存')
    } else {
      ElMessage.error(resp.data.message || '保存失败')
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '保存失败')
  } finally {
    amountSaving.value = false
  }
}

async function handleAdd() {
  if (!form.status) {
    ElMessage.warning('请选择合同状态')
    return
  }
  adding.value = true
  try {
    const resp = await api.post(`/api/worklog-projects/${props.projectId}/contract`, {
      status: form.status,
      amount: form.amount ?? null,
      note: form.note || null,
    })
    if (!resp.data.success) {
      ElMessage.error(resp.data.message || '提交失败')
      return
    }
    const progressId = resp.data.data?.id
    if (progressId && (uploadImages.value.length > 0 || uploadDocs.value.length > 0)) {
      const allFiles = [
        ...uploadImages.value.map(f => ({ file: f, kind: 'receipt' })),
        ...uploadDocs.value.map(f => ({ file: f, kind: 'contract' })),
      ]
      for (const { file, kind } of allFiles) {
        if (!file.raw) continue
        const fd = new FormData()
        fd.append('file', file.raw)
        fd.append('file_kind', kind)
        await api.post(
          `/api/worklog-projects/${props.projectId}/contract/${progressId}/attachments`,
          fd,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        )
      }
    }
    emit('statusChanged', form.status)
    form.status = ''
    form.amount = undefined
    form.note = ''
    uploadImages.value = []
    uploadDocs.value = []
    ElMessage.success('已追加')
    await loadTimeline()
    emit('update:visible', false)
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '提交失败')
  } finally {
    adding.value = false
  }
}

async function handleDelete(item: WorklogContractProgress) {
  try {
    await ElMessageBox.confirm('确定删除该进度记录？', '提示', { type: 'warning' })
  } catch { return }
  try {
    const resp = await api.delete(`/api/worklog-projects/${props.projectId}/contract/${item.id}`)
    if (resp.data.success) {
      ElMessage.success('已删除')
      await loadTimeline()
      const latest = timeline.value[0]
      emit('statusChanged', latest?.status || null)
    } else {
      ElMessage.error(resp.data.message || '删除失败')
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '删除失败')
  }
}

function tagType(status: string): 'success' | 'warning' | 'info' | 'primary' | 'danger' {
  if (status === '已结清') return 'success'
  if (status === '已开票未收款') return 'warning'
  if (status === '未签合同') return 'info'
  return 'primary'
}

function formatTime(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
.contract-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.contract-amount-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 6px;
}
.contract-amount-row .label { font-weight: 500; color: #303133; }
.contract-amount-row .amount-value { font-size: 16px; font-weight: 600; color: #409eff; }
.contract-amount-row .amount-empty { color: #909399; }

.contract-timeline {
  position: relative;
  padding-left: 20px;
  border-left: 2px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 360px;
  overflow-y: auto;
}

.timeline-item { position: relative; }

.timeline-dot {
  position: absolute;
  left: -27px;
  top: 6px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #409eff;
  border: 2px solid #fff;
  box-shadow: 0 0 0 2px #e4e7ed;
}

.timeline-content { display: flex; flex-direction: column; gap: 4px; }
.timeline-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.timeline-amount { font-weight: 600; color: #e6a23c; }
.timeline-meta { font-size: 12px; color: #909399; margin-left: auto; }
.timeline-note { font-size: 13px; color: #606266; padding: 4px 0; }

.timeline-attachments { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }

.att-images { display: flex; flex-wrap: wrap; gap: 8px; }
.att-thumb {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
  cursor: pointer;
  transition: transform 0.2s;
}
.att-thumb:hover { transform: scale(1.05); box-shadow: 0 2px 8px rgba(0,0,0,0.12); }

.att-docs { display: flex; flex-wrap: wrap; gap: 8px; }
.att-link { font-size: 12px; color: #409eff; cursor: pointer; text-decoration: underline; }
.att-link:hover { color: #66b1ff; }

.contract-add-form { border-top: 1px solid #ebeef5; padding-top: 16px; }
.contract-add-form .form-title { font-weight: 500; margin-bottom: 12px; color: #303133; display: flex; align-items: center; }

.contract-add-form :deep(.el-input-number) { width: 100%; }
.contract-add-form :deep(.el-input-number .el-input__wrapper input) { text-align: left !important; }
.contract-add-form :deep(.el-input__wrapper) { padding-left: 11px; }
.contract-add-form :deep(.el-select .el-select__wrapper) { padding-left: 11px; }
.contract-add-form :deep(.el-textarea__inner) { padding-left: 11px; }

.form-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; padding-top: 12px; border-top: 1px solid #ebeef5; }

.upload-row { display: flex; gap: 16px; margin-bottom: 16px; }
.upload-section { flex: 1; min-width: 0; max-width: 50%; }
.upload-section .upload-label { font-size: 14px; font-weight: 600; color: #303133; margin-bottom: 8px; }
.upload-section .upload-tip { font-size: 12px; color: #909399; margin-top: 6px; }

.upload-box {
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  background: #fafafa;
  padding: 12px;
  cursor: pointer;
  transition: border-color 0.2s;
  min-height: 80px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.upload-box:hover { border-color: #c0c4cc; }

.upload-placeholder { text-align: center; color: #909399; font-size: 12px; padding: 8px 12px; }
.upload-box:not(:has(.upload-file-list)) { justify-content: center; }
.upload-placeholder .upload-icon { font-size: 22px; color: #c0c4cc; margin-bottom: 2px; }
.upload-placeholder .upload-sub { font-size: 11px; color: #bbb; margin-top: 2px; }

.upload-file-list { display: contents; }
.upload-file-item { position: relative; }
.upload-file-item .file-remove {
  position: absolute; top: -6px; right: -6px;
  width: 16px; height: 16px; font-size: 10px;
  background: #f56c6c; color: #fff; border-radius: 50%;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  z-index: 1;
}
.image-item .file-thumb {
  width: 80px; height: 80px; object-fit: cover;
  border-radius: 4px; border: 1px solid #e4e7ed;
}
.doc-item {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 80px; height: 80px; position: relative;
  background: #fff; border: 1px solid #e4e7ed; border-radius: 4px;
  font-size: 12px; color: #606266; padding: 6px; text-align: center;
}
.doc-item .doc-icon { font-size: 28px; color: #909399; margin-bottom: 4px; }
.doc-item .doc-name {
  width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; color: #606266; cursor: pointer;
}
.doc-item .doc-name:hover { color: #409eff; }
.doc-type-badge {
  position: absolute; top: 4px; left: 4px;
  font-size: 9px; font-weight: 700; padding: 1px 4px;
  border-radius: 2px; color: #fff; line-height: 1.2;
}
.doc-type-badge.word { background: #2b579a; }
.doc-type-badge.excel { background: #217346; }
.doc-type-badge.pdf { background: #d63b3b; }
.doc-type-badge.other { background: #909399; }
</style>
