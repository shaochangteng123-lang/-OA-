<template>
  <div class="invoice-uploader">
    <el-upload
      ref="uploadRef"
      v-model:file-list="fileList"
      action="#"
      :auto-upload="false"
      :limit="maxFiles"
      :before-upload="beforeUpload"
      :on-change="onFileChange"
      :on-exceed="handleExceed"
      :on-preview="handlePreview"
      :on-remove="handleFileRemove"
      accept=".pdf"
      list-type="picture-card"
      class="invoice-upload"
      :disabled="disabled"
    >
      <div class="upload-trigger">
        <el-icon class="upload-icon"><Plus /></el-icon>
        <span class="upload-text">上传发票</span>
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
    <div class="upload-tip">
      <el-icon style="margin-right: 4px"><InfoFilled /></el-icon>
      上传发票后，系统将自动识别并填充报销金额、开票日期和发票号码
    </div>
    <div class="upload-notice">
      <el-icon style="margin-right: 4px"><WarningFilled /></el-icon>
      仅支持PDF文件，单个文件不超过5M{{ maxFiles > 5 ? `，最多上传${maxFiles}张发票` : '' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Plus, Document, Delete, InfoFilled, WarningFilled } from '@element-plus/icons-vue'

// Props
const props = withDefaults(defineProps<{
  modelValue: any[]
  maxFiles?: number
  disabled?: boolean
  themeColor?: string
}>(), {
  maxFiles: 5,
  disabled: false,
  themeColor: '#667eea',
})

// Emits
const emit = defineEmits<{
  (e: 'update:modelValue', value: any[]): void
  (e: 'file-change', file: any, fileList: any[]): void
  (e: 'delete-file', file: any): void
  (e: 'exceed'): void
}>()

// 文件列表
const fileList = ref<any[]>([])
const uploadRef = ref()

// 同步外部值
watch(() => props.modelValue, (val) => {
  fileList.value = val || []
}, { immediate: true, deep: true })

// 同步内部值到外部
watch(fileList, (val) => {
  emit('update:modelValue', val)
}, { deep: true })

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

// 文件超出限制
function handleExceed(): void {
  emit('exceed')
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
}

.upload-tip {
  font-size: 13px;
  color: #409eff;
  margin-top: 8px;
  display: flex;
  align-items: center;
  line-height: 1.5;
}

.upload-notice {
  font-size: 12px;
  color: #e6a23c;
  margin-top: 4px;
  display: flex;
  align-items: center;
  line-height: 1.5;
}

.invoice-upload :deep(.el-upload-list__item) {
  background-color: #f5f7fa;
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
  font-size: 48px;
  color: #fff;
  margin-bottom: 8px;
}

.invoice-preview .file-name {
  font-size: 12px;
  color: #fff;
  text-align: center;
  word-break: break-all;
  line-height: 1.4;
  max-height: 40px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.invoice-preview .delete-icon {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  padding: 4px;
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
}

.upload-trigger .upload-icon {
  font-size: 28px;
  color: #8c939d;
  margin-bottom: 8px;
}

.upload-trigger .upload-text {
  font-size: 14px;
  color: #606266;
}

.invoice-upload :deep(.el-upload--picture-card:hover) .upload-icon {
  color: v-bind('props.themeColor');
}

.invoice-upload :deep(.el-upload--picture-card:hover) .upload-text {
  color: v-bind('props.themeColor');
}
</style>
