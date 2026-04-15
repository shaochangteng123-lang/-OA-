<template>
  <div
    class="deduction-uploader"
    @drop.prevent="handleDrop"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @dragenter.prevent
    :class="{ 'is-dragging': isDragging }"
  >
    <el-upload
      ref="uploadRef"
      action="#"
      :auto-upload="false"
      :before-upload="beforeUpload"
      :on-change="onFileChange"
      :on-remove="handleFileRemove"
      accept=".pdf"
      list-type="picture-card"
      class="deduction-upload"
      :disabled="disabled || uploading"
      multiple
      :file-list="fileList"
    >
      <div class="upload-trigger">
        <el-icon class="upload-icon"><Plus /></el-icon>
        <div class="upload-text">上传核减发票</div>
      </div>
      <template #file="{ file }">
        <div class="invoice-preview" @dblclick="handlePreview(file)">
          <el-icon class="pdf-icon"><Document /></el-icon>
          <span class="file-name">{{ file.name }}</span>
          <el-icon v-if="!disabled" class="delete-icon" @click.stop="onDeleteFile(file)">
            <Delete />
          </el-icon>
        </div>
      </template>
    </el-upload>

    <div class="upload-header">
      <div class="upload-tip">
        <el-icon><InfoFilled /></el-icon>
        <span>自动识别并填充核减信息</span>
      </div>
      <div class="upload-notice">
        <el-icon><WarningFilled /></el-icon>
        <span>仅支持PDF文件，文件不超过5M</span>
      </div>
    </div>

    <!-- 拖拽遮罩层 -->
    <div v-if="isDragging" class="drag-overlay">
      <div class="drag-content">
        <el-icon class="drag-icon"><Upload /></el-icon>
        <div class="drag-text">松开鼠标上传文件</div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Plus, Document, Delete, InfoFilled, WarningFilled, Upload } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { showUploadError } from '@/utils/uploadError'

export interface DeductionItem {
  id?: string
  amount: number
  invoiceDate: string
  invoiceNumber?: string
  filePath?: string
  fileHash?: string
  status?: 'pending' | 'approved'
  tempFile?: any
}

const props = withDefaults(defineProps<{
  modelValue: DeductionItem[]
  disabled?: boolean
  reimbursementId?: string
  totalInvoiceAmount?: number
  yearlyDeductionUsed?: number  // 当年已使用的核减金额（每年1月1日清零）
  existingInvoices?: any[]  // 已上传的发票列表，用于交叉查重
}>(), {
  disabled: false,
  totalInvoiceAmount: 0,
  yearlyDeductionUsed: 0,
  existingInvoices: () => [],
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: DeductionItem[]): void
  (e: 'file-change', item: DeductionItem): void
  (e: 'delete-item', idx: number): void
}>()

const uploadRef = ref()
const uploading = ref(false)
const fileList = ref<any[]>([])
const isDragging = ref(false)
// 正在识别中的核减上传请求：fileUid → AbortController
const deductionAbortMap = new Map<string | number, AbortController>()

const deductionItems = computed(() => props.modelValue || [])

// 同步 deductionItems 到 fileList
watch(() => props.modelValue, (newVal) => {
  if (newVal && newVal.length > 0) {
    fileList.value = newVal.map((item, index) => ({
      uid: item.fileHash || `deduction-${index}`,
      name: item.invoiceNumber || `核减发票-${index + 1}.pdf`,
      url: item.filePath,
      status: 'success',
      deductionItem: item
    }))
  } else {
    fileList.value = []
  }
}, { immediate: true, deep: true })

// 拖拽进入
function handleDragOver(_e: DragEvent): void {
  if (props.disabled || uploading.value) return
  isDragging.value = true
}

// 拖拽离开
function handleDragLeave(_e: DragEvent): void {
  isDragging.value = false
}

// 拖拽放下
async function handleDrop(e: DragEvent): Promise<void> {
  isDragging.value = false
  if (props.disabled || uploading.value) return
  const files = Array.from(e.dataTransfer?.files || [])
  for (const file of files) {
    if (beforeUpload(file)) {
      const fakeFile = { raw: file, name: file.name, uid: Date.now() + Math.random() }
      await onFileChange(fakeFile)
    }
  }
}



function beforeUpload(file: File): boolean {
  // 检查是否是图片文件（与发票上传逻辑一致）
  const fileName = file.name.toLowerCase()
  const isImageFile =
    fileName.endsWith('.jpg') ||
    fileName.endsWith('.jpeg') ||
    fileName.endsWith('.png') ||
    fileName.endsWith('.gif') ||
    fileName.endsWith('.bmp')

  if (isImageFile) {
    showUploadError('请上传正确格式的发票')
    return false
  }

  // 检查PDF格式
  if (file.type !== 'application/pdf') {
    showUploadError('仅支持PDF文件')
    return false
  }

  // 检查文件大小
  const maxSize = 5 * 1024 * 1024
  if (file.size > maxSize) {
    showUploadError('文件大小不能超过5MB')
    return false
  }

  return true
}

async function onFileChange(file: any): Promise<void> {
  if (!file.raw) return

  // 先进行前端验证，如果验证失败则立即删除文件
  if (!beforeUpload(file.raw)) {
    // 验证失败，立即删除文件
    if (uploadRef.value) {
      uploadRef.value.handleRemove(file)
    }
    return
  }

  // 创建 AbortController，用于支持识别过程中的中断
  const abortController = new AbortController()
  deductionAbortMap.set(file.uid, abortController)

  uploading.value = true
  // 显示持久化的识别提示（duration: 0 表示不自动关闭）
  const loadingMessage = ElMessage({
    message: '正在识别核减发票...',
    type: 'info',
    duration: 0, // 不自动关闭，需要手动关闭
  })

  try {
    const formData = new FormData()
    formData.append('invoice', file.raw)

    const res = await fetch('/api/reimbursement/upload-deduction-invoice', {
      method: 'POST',
      body: formData,
      credentials: 'include',
      signal: abortController.signal,
    })

    // 关闭识别提示
    loadingMessage.close()

    const data = await res.json()

    if (data.success) {
      const { filePath, fileHash, ocrResult } = data.data

      // 前端查重1：检查核减列表中是否已存在
      const duplicateInDeduction = deductionItems.value.find(item => item.fileHash === fileHash)
      if (duplicateInDeduction) {
        showUploadError('此核减发票已上传，请勿重复上传')
        fileList.value = fileList.value.filter((f: any) => f.uid !== file.uid)
        return
      }

      // 前端查重2：检查发票列表中是否已存在（交叉查重）
      const duplicateInInvoice = props.existingInvoices?.find((inv: any) => inv.fileHash === fileHash)
      if (duplicateInInvoice) {
        showUploadError('此发票已在发票上传中上传，请勿重复上传')
        fileList.value = fileList.value.filter((f: any) => f.uid !== file.uid)
        return
      }

      const newItem: DeductionItem = {
        amount: ocrResult.amount || 0,
        invoiceDate: ocrResult.date || new Date().toISOString().slice(0, 10),
        invoiceNumber: ocrResult.invoiceNumber || '',
        filePath,
        fileHash,
      }
      const updated = [...deductionItems.value, newItem]
      emit('update:modelValue', updated)
      emit('file-change', newItem)
      ElMessage.success(`核减发票识别成功，金额：¥${newItem.amount.toFixed(2)}`)
    } else {
      showUploadError(data.message || '上传失败')
      // 上传失败，从 fileList 中移除该文件
      fileList.value = fileList.value.filter((f: any) => f.uid !== file.uid)
    }
  } catch (err: any) {
    // 关闭识别提示
    loadingMessage.close()

    // 用户主动中断（点击删除按钮），静默处理，不弹错误提示
    if (err?.name === 'AbortError') {
      fileList.value = fileList.value.filter((f: any) => f.uid !== file.uid)
      return
    }

    // 优先显示后端返回的错误消息
    const errorMessage = err.response?.data?.message || err.message || '上传核减发票失败'
    showUploadError(errorMessage)
    // 上传失败，从 fileList 中移除该文件
    fileList.value = fileList.value.filter((f: any) => f.uid !== file.uid)
  } finally {
    uploading.value = false
    deductionAbortMap.delete(file.uid)
  }
}

function handleFileRemove(file: any): void {
  // 通过 uid 查找对应的 deductionItem（uid 通常是 fileHash）
  let index = deductionItems.value.findIndex(item => item.fileHash === file.uid)

  // 若 uid 匹配不到，尝试通过 url/filePath 查找
  if (index === -1 && file.url) {
    index = deductionItems.value.findIndex(item => item.filePath === file.url)
  }

  if (index > -1) {
    removeItem(index)
  } else {
    // 未在 deductionItems 中找到，说明是上传失败或识别中的文件，直接从 upload 组件删除
    if (uploadRef.value) {
      uploadRef.value.handleRemove(file)
    }
  }
}

function onDeleteFile(file: any): void {
  // 若正在识别中，中断请求
  const abortController = deductionAbortMap.get(file.uid)
  if (abortController) {
    abortController.abort()
    deductionAbortMap.delete(file.uid)
  }
  handleFileRemove(file)
}

function handlePreview(file: any): void {
  if (file.url || file.deductionItem?.filePath) {
    const filePath = file.url || file.deductionItem.filePath
    // 移除路径中的 uploads/ 前缀（如果存在）
    const cleanPath = filePath.replace(/^uploads\//, '')
    const fileUrl = `/api/files/${cleanPath}`
    window.open(fileUrl, '_blank')
  }
}

function removeItem(idx: number): void {
  const updated = deductionItems.value.filter((_, i) => i !== idx)
  emit('update:modelValue', updated)
  emit('delete-item', idx)
}
</script>

<style scoped>
.deduction-uploader {
  display: flex;
  flex-direction: column;
  position: relative;
}

.deduction-upload {
  min-height: 116px;
}

.deduction-upload :deep(.el-upload--picture-card) {
  width: 100px;
  height: 100px;
  background-color: #fbfdff;
  border: 1px dashed #c0ccda;
  border-radius: 6px;
  transition: all 0.3s;
}

.deduction-upload :deep(.el-upload-list__item) {
  width: 100px;
  height: 100px;
}

@media (max-width: 768px) {
  .deduction-upload :deep(.el-upload--picture-card) {
    width: 80px;
    height: 80px;
  }

  .deduction-upload :deep(.el-upload-list__item) {
    width: 80px;
    height: 80px;
  }
}

.deduction-upload :deep(.el-upload--picture-card):hover {
  border-color: #e6a23c;
}

.deduction-upload :deep(.el-upload--picture-card):hover .upload-trigger {
  color: #e6a23c;
}

.upload-trigger {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #606266;
  transition: color 0.3s;
}

.upload-trigger .upload-icon {
  font-size: 28px;
  color: #8c939d;
}

.upload-trigger .upload-text {
  font-size: 12px;
  color: #606266;
  font-weight: 500;
}

.deduction-upload :deep(.el-upload--picture-card:hover) .upload-icon {
  color: #e6a23c;
}

.deduction-upload :deep(.el-upload--picture-card:hover) .upload-text {
  color: #e6a23c;
}

.invoice-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 8px;
  gap: 4px;
  background: #fef0e6;
  cursor: pointer;
}

.pdf-icon {
  font-size: 28px;
  color: #e6a23c;
}

.file-name {
  font-size: 10px;
  color: #606266;
  text-align: center;
  word-break: break-all;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-icon {
  position: absolute;
  top: 4px;
  right: 4px;
  color: #f56c6c;
  cursor: pointer;
  font-size: 14px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  padding: 2px;
  transition: all 0.3s;
}

.delete-icon:hover {
  color: #f56c6c;
  background: rgba(255, 255, 255, 1);
  transform: scale(1.1);
}

.upload-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  align-items: flex-start;
}

.upload-tip {
  font-size: 14px;
  color: #606266;
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.5;
  white-space: nowrap;
}

.upload-tip .el-icon {
  color: #409eff;
  font-size: 16px;
  flex-shrink: 0;
}

.upload-notice {
  font-size: 13px;
  color: #909399;
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.5;
  white-space: nowrap;
}

.upload-notice .el-icon {
  color: #e6a23c;
  font-size: 16px;
  flex-shrink: 0;
}

/* 拖拽遮罩层 */
.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(64, 158, 255, 0.1);
  border: 2px dashed #409eff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  pointer-events: none;
}

.drag-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.drag-icon {
  font-size: 48px;
  color: #409eff;
}

.drag-text {
  font-size: 14px;
  color: #409eff;
  font-weight: 500;
}

</style>
