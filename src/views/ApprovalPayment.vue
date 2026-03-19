<template>
  <div class="yl-page approval-payment">
    <div class="yl-page-header">
      <div class="yl-page-title">
        <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
        <h1>{{ isBatchMode ? '批量付款' : '付款' }}</h1>
      </div>
    </div>

    <el-card v-loading="loading" shadow="never" class="no-border-card">
      <!-- 批量付款信息 -->
      <div v-if="isBatchMode && batchInfo" class="section">
        <h3 class="section-title">批量付款信息</h3>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="批次号">{{ batchInfo.batchNo }}</el-descriptions-item>
          <el-descriptions-item label="付款总额">
            <span class="amount">¥{{ batchInfo.totalAmount?.toFixed(2) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="报销单数量">{{ batchInfo.reimbursements?.length }} 笔</el-descriptions-item>
          <el-descriptions-item label="收款人">{{ payeeInfo?.bankAccountName || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-table :data="batchInfo.reimbursements" border stripe style="margin-top: 12px;" size="small">
          <el-table-column label="报销单号" prop="id" width="200" />
          <el-table-column label="标题" prop="title" min-width="150" />
          <el-table-column label="类型" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="getTypeTagType(row.type)" size="small">{{ getTypeLabel(row.type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="金额" width="120" align="right">
            <template #default="{ row }">
              ¥{{ parseFloat(row.amount).toFixed(2) }}
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 单笔报销单信息 -->
      <div v-if="!isBatchMode" class="section">
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
          <!-- 已选择的回单列表 -->
          <div v-if="fileItems.length > 0" class="proof-list">
            <div v-for="(item, index) in fileItems" :key="index" class="proof-card">
              <div class="proof-preview" @click="handlePreview(item)">
                <img :src="item.previewUrl" class="proof-image" alt="付款回单" />
              </div>
              <div class="proof-info">
                <div class="proof-name">{{ item.fileName }}</div>
              </div>
              <el-button type="danger" :icon="Delete" circle size="small" class="proof-delete" @click="handleRemoveFile(index)" :disabled="submitting" />
            </div>
          </div>

          <!-- 上传区域 -->
          <el-upload
            class="upload-area"
            drag
            multiple
            :auto-upload="false"
            :show-file-list="false"
            :on-change="handleFileChange"
            accept=".jpg,.jpeg,.png"
            :disabled="submitting"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">
              将文件拖到此处，或<em>点击上传</em>
            </div>
            <template #tip>
              <div class="el-upload__tip">
                支持 JPG、PNG 格式，文件大小不超过 10MB，可上传多张回单
              </div>
            </template>
          </el-upload>
        </div>
      </div>

      <!-- 图片预览对话框 -->
      <el-dialog v-model="previewDialogVisible" title="付款回单预览" width="80%" :close-on-click-modal="true">
        <div class="preview-dialog-content">
          <img :src="previewDialogUrl" class="preview-dialog-image" alt="预览" />
        </div>
      </el-dialog>

      <!-- 验证状态提示 -->
      <div v-if="submitting" class="verify-status">
        <el-icon class="is-loading" :size="20"><Loading /></el-icon>
        <span>{{ submitStatusText }}</span>
      </div>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <el-button @click="handleBack">取消</el-button>
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="fileItems.length === 0 || submitting"
          @click="handleSubmit"
        >
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
import { ArrowLeft, UploadFilled, Delete, Loading } from '@element-plus/icons-vue'
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

interface FileItem {
  fileName: string
  previewUrl: string
  rawFile: File
}

interface BatchInfo {
  batchId: string
  batchNo: string
  totalAmount: number
  reimbursements: { id: string; title: string; type: string; amount: number; applicant: string }[]
}

const loading = ref(false)
const submitting = ref(false)
const submitStatusText = ref('')
const reimbursement = ref<ReimbursementInfo | null>(null)
const payeeInfo = ref<PayeeInfo | null>(null)
const fileItems = ref<FileItem[]>([])
const previewDialogVisible = ref(false)
const previewDialogUrl = ref('')
const batchInfo = ref<BatchInfo | null>(null)

// 判断是否为批量付款模式
const isBatchMode = computed(() => !!route.params.batchId)

function getTypeTagType(type?: string): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  if (!type) return 'info'
  const typeMap: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
    basic: 'success', large: 'warning', business: 'danger',
  }
  return typeMap[type] || 'info'
}

function getTypeLabel(type?: string): string {
  if (!type) return '-'
  const typeMap: Record<string, string> = {
    basic: '基础报销', large: '大额报销', business: '商务报销',
  }
  return typeMap[type] || type
}

function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  try {
    const safeStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')
    return format(new Date(safeStr), 'yyyy-MM-dd HH:mm', { locale: zhCN })
  } catch {
    return dateStr
  }
}

async function loadData() {
  if (isBatchMode.value) {
    await loadBatchData()
  } else {
    await loadSingleData()
  }
}

async function loadBatchData() {
  const batchId = route.params.batchId as string
  if (!batchId) {
    ElMessage.error('缺少批次ID')
    router.push('/approval')
    return
  }
  loading.value = true
  try {
    const res = await api.get(`/api/reimbursement/payment-batch/${batchId}`)
    if (res.data.success) {
      batchInfo.value = res.data.data
      // 获取收款人信息（批次内所有报销单属于同一收款人）
      if (batchInfo.value && batchInfo.value.reimbursements.length > 0) {
        // 从第一笔报销单获取 userId
        const firstId = batchInfo.value.reimbursements[0].id
        const reimbursementRes = await api.get(`/api/reimbursement/${firstId}`)
        if (reimbursementRes.data.success) {
          const payeeRes = await api.get(`/api/approval/payee-info/${reimbursementRes.data.data.userId}`)
          if (payeeRes.data.success) {
            payeeInfo.value = payeeRes.data.data
          }
        }
      }
    } else {
      ElMessage.error(res.data.message || '获取批次信息失败')
      router.push('/approval')
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '加载数据失败')
    router.push('/approval')
  } finally {
    loading.value = false
  }
}

async function loadSingleData() {
  const id = route.params.id as string
  if (!id) {
    ElMessage.error('缺少报销单ID')
    router.push('/approval')
    return
  }
  loading.value = true
  try {
    const reimbursementRes = await api.get(`/api/reimbursement/${id}`)
    if (reimbursementRes.data.success) {
      reimbursement.value = reimbursementRes.data.data
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

// 选择文件 → 仅添加预览，不做验证
function handleFileChange(file: UploadFile) {
  if (file.status !== 'ready') return
  if (file.raw && file.raw.size > 10 * 1024 * 1024) {
    ElMessage.warning('文件大小不能超过10MB')
    return
  }
  if (!file.raw) return
  fileItems.value.push({
    fileName: file.name,
    previewUrl: URL.createObjectURL(file.raw),
    rawFile: file.raw,
  })
}

function handleRemoveFile(index: number) {
  const item = fileItems.value[index]
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  fileItems.value.splice(index, 1)
}

function handlePreview(item: FileItem) {
  previewDialogUrl.value = item.previewUrl
  previewDialogVisible.value = true
}

function handleBack() {
  router.back()
}

// 点击按钮 → 逐张验证 → 全部通过后提交
async function handleSubmit() {
  if (fileItems.value.length === 0) {
    ElMessage.warning('请上传付款回单')
    return
  }

  if (isBatchMode.value) {
    await handleBatchSubmit()
  } else {
    await handleSingleSubmit()
  }
}

async function handleBatchSubmit() {
  const batchId = route.params.batchId as string
  submitting.value = true

  try {
    // 第一步：逐张上传验证
    const verifiedFiles: { tempFileName: string; originalFileName: string; amount: number }[] = []
    const total = fileItems.value.length

    for (let i = 0; i < total; i++) {
      submitStatusText.value = `正在识别第 ${i + 1}/${total} 张回单...`
      const file = fileItems.value[i]
      const formData = new FormData()
      formData.append('paymentProof', file.rawFile)
      formData.append('originalFileName', file.fileName)

      const res = await api.post(`/api/reimbursement/payment-batch/${batchId}/verify-proof`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      if (res.data.success) {
        verifiedFiles.push({
          tempFileName: res.data.data.tempFileName,
          originalFileName: res.data.data.originalFileName,
          amount: res.data.data.ocrResult.amount,
        })
      } else {
        ElMessage.error(res.data.message || `第 ${i + 1} 张回单验证失败`)
        return
      }
    }

    // 第二步：提交
    submitStatusText.value = '正在提交...'
    const completeRes = await api.post(`/api/reimbursement/payment-batch/${batchId}/complete`, { verifiedFiles })

    if (completeRes.data.success) {
      ElMessage.success('已上传回单，等待确认收款')
      await pendingStore.refreshPendingCounts().catch(() => {})
      navigateBack()
    } else {
      ElMessage.error(completeRes.data.message || '提交失败')
    }
  } catch (err: any) {
    const warnings = err.response?.data?.warnings
    if (warnings && Array.isArray(warnings) && warnings.length > 0) {
      ElMessage.error({ message: warnings.join('；'), duration: 5000, showClose: true })
    } else {
      ElMessage.error(err.response?.data?.message || '操作失败')
    }
  } finally {
    submitting.value = false
    submitStatusText.value = ''
  }
}

async function handleSingleSubmit() {
  const id = route.params.id as string
  submitting.value = true

  try {
    // 第一步：逐张上传验证
    const verifiedFiles: { tempFileName: string; originalFileName: string; amount: number }[] = []
    const total = fileItems.value.length

    for (let i = 0; i < total; i++) {
      submitStatusText.value = `正在识别第 ${i + 1}/${total} 张回单...`
      const file = fileItems.value[i]
      const formData = new FormData()
      formData.append('paymentProof', file.rawFile)
      formData.append('originalFileName', file.fileName)

      const res = await api.post(`/api/reimbursement/${id}/verify-proof`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      if (res.data.success) {
        verifiedFiles.push({
          tempFileName: res.data.data.tempFileName,
          originalFileName: res.data.data.originalFileName,
          amount: res.data.data.ocrResult.amount,
        })
      } else {
        ElMessage.error(res.data.message || `第 ${i + 1} 张回单验证失败`)
        return
      }
    }

    // 第二步：提交
    submitStatusText.value = '正在提交...'
    const completeRes = await api.post(`/api/reimbursement/${id}/complete-with-proof`, { verifiedFiles })

    if (completeRes.data.success) {
      ElMessage.success('已上传回单，等待确认收款')
      await pendingStore.refreshPendingCounts().catch(() => {})
      navigateBack()
    } else {
      ElMessage.error(completeRes.data.message || '提交失败')
    }
  } catch (err: any) {
    const warnings = err.response?.data?.warnings
    if (warnings && Array.isArray(warnings) && warnings.length > 0) {
      ElMessage.error({ message: warnings.join('；'), duration: 5000, showClose: true })
    } else {
      ElMessage.error(err.response?.data?.message || '操作失败')
    }
  } finally {
    submitting.value = false
    submitStatusText.value = ''
  }
}

function navigateBack() {
  const from = route.query.from as string
  const tab = route.query.tab as string
  if (from) {
    router.push(tab ? `${from}?tab=${tab}` : from)
  } else {
    router.push('/approval?tab=pending')
  }
}

onMounted(() => { loadData() })

onUnmounted(() => {
  fileItems.value.forEach(item => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  })
})
</script>

<style scoped>
.approval-payment {
  height: calc(100vh - 60px);
  margin: -24px -45px;
  padding: 24px;
}
.no-border-card { border: none; }
.section { margin-bottom: 32px; }
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}
.amount { color: #409eff; font-weight: 600; font-size: 16px; }
.upload-container { display: flex; flex-direction: column; gap: 16px; }
.upload-area { width: 100%; }
.upload-area :deep(.el-upload-dragger) { width: 100%; }

.proof-list { display: flex; flex-wrap: wrap; gap: 16px; }
.proof-card {
  position: relative;
  width: 180px;
  border: 2px solid #dcdfe6;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  transition: all 0.3s;
}
.proof-card:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
.proof-preview {
  width: 100%;
  height: 140px;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
}
.proof-image { width: 100%; height: 100%; object-fit: cover; }
.proof-info { padding: 6px 10px; }
.proof-name {
  font-size: 12px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proof-delete { position: absolute; top: 6px; right: 6px; z-index: 10; }

.preview-dialog-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}
.preview-dialog-image { max-width: 100%; max-height: 70vh; object-fit: contain; }

.verify-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  margin-top: 16px;
  color: #409eff;
  font-size: 14px;
  background: #ecf5ff;
  border-radius: 6px;
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