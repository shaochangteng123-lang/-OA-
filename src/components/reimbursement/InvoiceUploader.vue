<template>
  <div
    class="invoice-uploader"
    @drop.prevent="handleDrop"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @dragenter.prevent
    :class="{ 'is-dragging': isDragging }"
  >
    <el-upload
      ref="uploadRef"
      v-model:file-list="fileList"
      action="#"
      :auto-upload="false"
      :before-upload="beforeUpload"
      :on-change="onFileChange"
      :on-preview="handlePreview"
      :on-remove="handleFileRemove"
      accept=".pdf"
      list-type="picture-card"
      class="invoice-upload"
      :disabled="disabled"
      multiple
    >
      <div class="upload-trigger">
        <el-icon class="upload-icon"><Plus /></el-icon>
        <div class="upload-text">上传发票</div>
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
        <span>上传发票后，系统将自动识别并填充报销信息</span>
      </div>
      <div class="upload-notice">
        <el-icon><WarningFilled /></el-icon>
        <span>仅支持PDF文件，单个文件不超过5M</span>
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
import { computed, ref } from 'vue'
import { Plus, Upload, Document, Delete, InfoFilled, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

// Props
const props = withDefaults(defineProps<{
  modelValue: any[]
  disabled?: boolean
  themeColor?: string
  maxFiles?: number
}>(), {
  disabled: false,
  themeColor: '#667eea',
  maxFiles: 50,
})

// Emits
const emit = defineEmits<{
  (e: 'update:modelValue', value: any[]): void
  (e: 'file-change', file: any, fileList: any[]): void
  (e: 'delete-file', file: any): void
}>()

// 文件列表 - 使用 computed 直接桥接父组件和 el-upload，避免双 watch 同步问题
const fileList = computed({
  get: () => props.modelValue || [],
  set: (val) => emit('update:modelValue', val),
})
const uploadRef = ref()
const isDragging = ref(false)

// 拖拽进入
function handleDragOver(_e: DragEvent): void {
  if (props.disabled) return
  isDragging.value = true
}

// 拖拽离开
function handleDragLeave(e: DragEvent): void {
  // 检查是否真的离开了组件区域
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX
  const y = e.clientY

  if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
    isDragging.value = false
  }
}

// 处理文件拖拽放下
function handleDrop(e: DragEvent): void {
  isDragging.value = false

  if (props.disabled) return

  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  // 检查文件数量限制
  const currentCount = fileList.value.length
  const newCount = files.length

  if (currentCount + newCount > props.maxFiles) {
    ElMessage.warning(`最多只能上传${props.maxFiles}个文件，当前已有${currentCount}个`)
    return
  }

  // 过滤并处理文件
  const validFiles: File[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]

    // 检查文件类型
    if (file.type !== 'application/pdf') {
      ElMessage.error(`${file.name} 不是PDF文件，已跳过`)
      continue
    }

    // 检查文件大小
    const maxSize = 5 * 1024 * 1024
    if (file.size > maxSize) {
      ElMessage.error(`${file.name} 超过5MB，已跳过`)
      continue
    }

    validFiles.push(file)
  }

  // 手动触发上传
  if (validFiles.length > 0) {
    validFiles.forEach(file => {
      // 创建文件对象
      const fileObj = {
        name: file.name,
        size: file.size,
        type: file.type,
        uid: Date.now() + Math.random(),
        status: 'ready',
        raw: file,
      }

      // 添加到文件列表
      const newFileList = [...fileList.value, fileObj]
      fileList.value = newFileList

      // 触发文件变化事件
      emit('file-change', fileObj, newFileList)
    })
  }
}

// 上传前校验
function beforeUpload(file: File): boolean {
  const fileName = file.name.toLowerCase()
  const isImageFile =
    fileName.endsWith('.jpg') ||
    fileName.endsWith('.jpeg') ||
    fileName.endsWith('.png') ||
    fileName.endsWith('.gif') ||
    fileName.endsWith('.bmp')

  if (isImageFile) {
    return false
  }

  const isPDF = file.type === 'application/pdf'
  if (!isPDF) {
    return false
  }

  const maxSize = 5 * 1024 * 1024
  if (file.size > maxSize) {
    return false
  }

  return true
}

// 文件变化
function onFileChange(file: any, fileListParam: any[]): void {
  emit('file-change', file, fileListParam)
}

// 删除文件
function onDeleteFile(file: any): void {
  emit('delete-file', file)
}

// 文件移除
function handleFileRemove(file: any): void {
  emit('delete-file', file)
}

// 预览文件
function handlePreview(file: any): void {
  if (file.serverPath) {
    window.open(file.serverPath, '_blank')
  } else if (file.url) {
    window.open(file.url, '_blank')
  }
}
</script>

<style scoped>
.invoice-uploader {
  width: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
}

.invoice-uploader.is-dragging {
  position: relative;
}

.invoice-upload {
  min-height: 116px;
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

.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(102, 126, 234, 0.1);
  border: 2px dashed v-bind('props.themeColor');
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  pointer-events: none;
}

.drag-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.drag-icon {
  font-size: 64px;
  color: v-bind('props.themeColor');
  margin-bottom: 16px;
  animation: bounce 1s infinite;
}

.drag-text {
  font-size: 18px;
  color: v-bind('props.themeColor');
  font-weight: 500;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

/* 缩小上传框尺寸 */
.invoice-upload :deep(.el-upload--picture-card) {
  width: 100px;
  height: 100px;
}

.invoice-upload :deep(.el-upload-list__item) {
  width: 100px;
  height: 100px;
  background-color: #f5f7fa;
}

/* 自适应布局 */
.invoice-upload :deep(.el-upload-list--picture-card) {
  display: grid;
  grid-template-columns: repeat(auto-fill, 100px);
  gap: 8px;
}

/* 响应式断点 */
@media (max-width: 768px) {
  .invoice-upload :deep(.el-upload--picture-card) {
    width: 80px;
    height: 80px;
  }

  .invoice-upload :deep(.el-upload-list__item) {
    width: 80px;
    height: 80px;
  }

  .invoice-upload :deep(.el-upload-list--picture-card) {
    grid-template-columns: repeat(auto-fill, 80px);
  }

  .invoice-preview .pdf-icon {
    font-size: 32px !important;
  }

  .invoice-preview .file-name {
    font-size: 10px !important;
  }

  .upload-trigger .upload-icon {
    font-size: 24px !important;
  }

  .upload-trigger .upload-text {
    font-size: 10px !important;
  }

  .upload-header {
    padding: 10px;
  }

  .upload-tip {
    font-size: 12px;
  }

  .upload-notice {
    font-size: 11px;
  }
}

.invoice-preview {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px;
  background: linear-gradient(135deg, v-bind('props.themeColor') 0%, #764ba2 100%);
  position: relative;
  cursor: pointer;
  user-select: none;
}

.invoice-preview .pdf-icon {
  font-size: 36px;
  color: #fff;
  margin-bottom: 6px;
}

.invoice-preview .file-name {
  font-size: 11px;
  color: #fff;
  text-align: center;
  word-break: break-all;
  line-height: 1.3;
  max-height: 32px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.invoice-preview .delete-icon {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  padding: 3px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.3);
  transition: all 0.3s;
}

.invoice-preview .delete-icon:hover {
  color: #fff;
  background: #f56c6c;
}

.upload-trigger {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  gap: 4px;
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

.invoice-upload :deep(.el-upload--picture-card:hover) .upload-icon {
  color: v-bind('props.themeColor');
}

.invoice-upload :deep(.el-upload--picture-card:hover) .upload-text {
  color: v-bind('props.themeColor');
}
</style>
