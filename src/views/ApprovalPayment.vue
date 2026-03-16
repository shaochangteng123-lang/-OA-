<template>
  <div class="yl-page approval-payment">
    <div class="yl-page-header">
      <div class="yl-page-title">
        <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
        <h1>付款</h1>
      </div>
    </div>

    <el-card v-loading="loading" shadow="never" class="no-border-card">
      <!-- 报销单信息 -->
      <div class="section">
        <h3 class="section-title">报销单信息</h3>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="报销单号">{{ reimbursement?.id }}</el-descriptions-item>
          <el-descriptions-item label="报销类型">
            <el-tag :type="getTypeTagType(reimbursement?.type)" size="small">
              {{ getTypeLabel(reimbursement?.type) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="报销标题">{{ reimbursement?.title }}</el-descriptions-item>
          <el-descriptions-item label="报销金额">
            <span class="amount">¥{{ reimbursement?.amount?.toFixed(2) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="申请人">{{ reimbursement?.applicant }}</el-descriptions-item>
          <el-descriptions-item label="审批时间">{{ reimbursement?.approveTime ? formatDate(reimbursement.approveTime) : '-' }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 收款人信息 -->
      <div class="section">
        <h3 class="section-title">收款人信息</h3>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="收款人姓名">{{ payeeInfo?.bankAccountName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="收款人手机">{{ payeeInfo?.bankAccountPhone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="开户行">{{ payeeInfo?.bankName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="银行卡号">{{ payeeInfo?.bankAccountNumber || '-' }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 上传付款回单 -->
      <div class="section">
        <h3 class="section-title">上传付款回单</h3>
        <div class="upload-container">
          <!-- 已上传文件显示区域 -->
          <div v-if="fileList.length > 0" class="file-display-area">
            <div class="file-display-card">
              <div class="file-content" @click="handlePreviewFile">
                <!-- 图片预览 -->
                <template v-if="isImageFile">
                  <img :src="previewUrl" class="display-image" alt="付款回单" />
                </template>
                <!-- PDF 文件显示 -->
                <template v-else>
                  <div class="pdf-display">
                    <el-icon :size="48" color="#409EFF"><Document /></el-icon>
                    <div class="file-info">
                      <span class="file-name">{{ fileList[0].name }}</span>
                      <span class="file-size">{{ formatFileSize(fileList[0].size || 0) }}</span>
                    </div>
                  </div>
                </template>
                <div class="preview-overlay">
                  <el-icon :size="24"><ZoomIn /></el-icon>
                  <span>点击预览</span>
                </div>
              </div>
              <!-- 删除按钮 -->
              <el-button
                type="danger"
                :icon="Delete"
                circle
                size="small"
                class="delete-button"
                @click="handleRemoveFile"
              />
            </div>
          </div>

          <!-- 上传区域（未上传时显示） -->
          <el-upload
            v-else
            class="upload-area"
            drag
            :auto-upload="false"
            :limit="1"
            :show-file-list="false"
            :on-change="handleFileChange"
            :on-exceed="handleExceed"
            accept=".pdf,.jpg,.jpeg,.png"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">
              将文件拖到此处，或<em>点击上传</em>
            </div>
            <template #tip>
              <div class="el-upload__tip">
                支持 PDF、JPG、PNG 格式，文件大小不超过 10MB
              </div>
            </template>
          </el-upload>
        </div>
      </div>

      <!-- 图片预览对话框 -->
      <el-dialog v-model="previewDialogVisible" title="付款回单预览" width="80%" :close-on-click-modal="true">
        <div class="preview-dialog-content">
          <img v-if="isImageFile" :src="previewUrl" class="preview-dialog-image" alt="预览" />
          <iframe v-else :src="previewUrl" class="preview-dialog-pdf" />
        </div>
      </el-dialog>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <el-button @click="handleBack">取消</el-button>
        <el-button type="primary" :loading="submitting" :disabled="!fileList.length" @click="handleSubmit">
          上传付款回单
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, UploadFilled, Document, ZoomIn, Delete } from '@element-plus/icons-vue'
import type { UploadFile } from 'element-plus'
import { api } from '@/utils/api'
import { usePendingStore } from '@/stores/pending'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const router = useRouter()
const route = useRoute()
const pendingStore = usePendingStore()

interface ReimbursementInfo {
  id: string
  type: string
  title: string
  amount: number
  status: string
  applicant: string
  approveTime?: string
  userId: string
}

interface PayeeInfo {
  bankAccountName: string
  bankAccountPhone: string
  bankName: string
  bankAccountNumber: string
}

const loading = ref(false)
const submitting = ref(false)
const reimbursement = ref<ReimbursementInfo | null>(null)
const payeeInfo = ref<PayeeInfo | null>(null)
const fileList = ref<UploadFile[]>([])
const previewUrl = ref('')
const previewDialogVisible = ref(false)

// 判断是否为图片文件
const isImageFile = computed(() => {
  if (!fileList.value.length) return false
  const file = fileList.value[0]
  const name = file.name.toLowerCase()
  return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png')
})

// 获取类型标签
function getTypeTagType(type?: string): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  if (!type) return 'info'
  const typeMap: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
    basic: 'success',
    large: 'warning',
    business: 'danger',
  }
  return typeMap[type] || 'info'
}

// 获取类型文字
function getTypeLabel(type?: string): string {
  if (!type) return '-'
  const typeMap: Record<string, string> = {
    basic: '基础报销',
    large: '大额报销',
    business: '商务报销',
  }
  return typeMap[type] || type
}

// 格式化日期
function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  // 兼容旧格式 "YYYY-MM-DD HH:mm:ss"，替换空格为T确保跨浏览器解析
  const safeStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')
  return format(new Date(safeStr), 'yyyy-MM-dd HH:mm', { locale: zhCN })
}

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

// 加载报销单和收款人信息
async function loadData() {
  const id = route.params.id as string
  if (!id) {
    ElMessage.error('缺少报销单ID')
    router.push('/approval')
    return
  }

  loading.value = true
  try {
    // 获取报销单信息
    const reimbursementRes = await api.get(`/api/reimbursement/${id}`)
    if (reimbursementRes.data.success) {
      reimbursement.value = reimbursementRes.data.data

      // 获取收款人信息（通过报销单的userId获取用户银行信息）
      const payeeRes = await api.get(`/api/approval/payee-info/${reimbursementRes.data.data.userId}`)
      if (payeeRes.data.success) {
        payeeInfo.value = payeeRes.data.data
      }
    } else {
      ElMessage.error(reimbursementRes.data.message || '获取报销单信息失败')
      router.push('/approval')
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '加载数据失败')
    router.push('/approval')
  } finally {
    loading.value = false
  }
}

// 处理文件变化
function handleFileChange(file: UploadFile) {
  // 验证文件大小（10MB）
  if (file.raw && file.raw.size > 10 * 1024 * 1024) {
    ElMessage.warning('文件大小不能超过10MB')
    fileList.value = []
    previewUrl.value = ''
    return
  }
  fileList.value = [file]
  // 生成预览URL
  if (file.raw) {
    previewUrl.value = URL.createObjectURL(file.raw)
  }
}

// 处理超出限制
function handleExceed() {
  ElMessage.warning('只能上传一个文件')
}

// 预览文件
function handlePreviewFile() {
  if (previewUrl.value) {
    previewDialogVisible.value = true
  }
}

// 删除文件
function handleRemoveFile() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  fileList.value = []
  previewUrl.value = ''
}

// 返回上一级页面
function handleBack() {
  router.back()
}

// 提交付款
async function handleSubmit() {
  if (!fileList.value.length) {
    ElMessage.warning('请上传付款回单')
    return
  }

  const id = route.params.id as string
  submitting.value = true

  try {
    // 创建 FormData 上传文件
    const formData = new FormData()
    const file = fileList.value[0].raw
    if (file) {
      formData.append('paymentProof', file)
      formData.append('originalFileName', file.name)
    }

    // 上传付款回单并标记已付款
    const res = await api.post(`/api/reimbursement/${id}/complete-with-proof`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })

    if (res.data.success) {
      ElMessage.success('付款回单上传成功，等待用户确认收款')
      // 刷新菜单栏角标
      await pendingStore.refreshPendingCounts()
      // 付款成功后返回来源页面
      const from = route.query.from as string
      const tab = route.query.tab as string
      if (from) {
        router.push(tab ? `${from}?tab=${tab}` : from)
      } else {
        router.push('/approval?tab=pending')
      }
    } else {
      ElMessage.error(res.data.message || '付款失败')
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '付款失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loadData()
})

// 组件卸载时清理预览URL
onUnmounted(() => {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
})
</script>

<style scoped>
/* 容器填满可用空间，去除边距 */
.approval-payment {
  height: calc(100vh - 60px);
  margin: -24px -45px;
  padding: 24px;
}

.no-border-card {
  border: none;
}

.section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}

.amount {
  color: #409eff;
  font-weight: 600;
  font-size: 16px;
}

.upload-area {
  width: 100%;
}

.upload-area :deep(.el-upload-dragger) {
  width: 100%;
}

.upload-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 文件显示区域 */
.file-display-area {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.file-display-card {
  position: relative;
  width: 100%;
  min-height: 200px;
  border: 2px solid #409eff;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-display-card:hover {
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
  transform: translateY(-2px);
}

.file-display-card:hover .preview-overlay {
  opacity: 1;
}

.file-content {
  position: relative;
  width: 100%;
  min-height: 200px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.display-image {
  max-width: 400px;
  max-height: 300px;
  width: auto;
  height: auto;
  object-fit: contain;
  background: #f5f7fa;
  margin: 0 auto;
  display: block;
}

.delete-button {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.pdf-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  gap: 16px;
  padding: 32px;
}

.file-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.file-name {
  font-size: 16px;
  font-weight: 500;
  color: #303133;
  text-align: center;
  word-break: break-all;
  max-width: 500px;
}

.file-size {
  font-size: 14px;
  color: #909399;
}

.file-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.preview-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  opacity: 0;
  transition: opacity 0.3s;
  gap: 8px;
}

.preview-overlay span {
  font-size: 14px;
  font-weight: 500;
}

/* 旧的预览样式（保留以防需要） */
.file-preview-box {
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  padding: 16px;
  background: #fafafa;
  display: flex;
  align-items: center;
  gap: 16px;
}

.file-preview-item {
  position: relative;
  width: 120px;
  height: 120px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #fff;
}

.file-preview-item:hover .preview-overlay {
  opacity: 1;
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.delete-btn {
  flex-shrink: 0;
}

.preview-dialog-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.preview-dialog-image {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}

.preview-dialog-pdf {
  width: 100%;
  height: 70vh;
  border: none;
}

.action-buttons {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #ebeef5;
}
</style>
