<template>
  <div class="reimbursement-detail-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <div class="header-left">
            <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
            <h2>{{ pageTitle }}</h2>
          </div>
        </div>
      </template>

      <div class="content-wrapper">
        <div class="step-content">
          <h3 class="step-title">填写报销信息</h3>

          <!-- 拒绝原因提示（已拒绝状态显示） -->
          <div v-if="isRejected && rejectReason" class="reject-reason-section">
            <el-alert
              title="审批被拒绝"
              type="error"
              :closable="false"
              show-icon
            >
              <template #default>
                <div class="reject-reason-content">
                  <p><strong>拒绝原因：</strong>{{ rejectReason }}</p>
                  <p v-if="!isReadonly" class="reject-tip">您可以根据拒绝原因修改后重新提交审批。</p>
                </div>
              </template>
            </el-alert>
          </div>

          <el-form
            ref="formRef"
            :model="formData"
            :rules="formRules"
            label-width="120px"
            class="reimbursement-form"
          >
            <el-form-item label="报销月份">
              <el-input v-model="reimbursementMonth" disabled />
            </el-form-item>

            <el-form-item label="报销范围/区域">
              <el-input v-model="reimbursementScope" disabled />
            </el-form-item>

            <el-form-item label="客户/对象" prop="client">
              <el-input
                v-model="formData.client"
                placeholder="请输入客户名称或商务对象"
                :disabled="isReadonly"
              />
            </el-form-item>

            <el-form-item label="发票上传" prop="files">
              <InvoiceUploader
                v-model="invoice.fileList.value"
                :max-files="10"
                :disabled="isReadonly"
                theme-color="#67c23a"
                @file-change="handleFileChange"
                @delete-file="handleDeleteFile"
                @exceed="invoice.handleExceed"
              />
            </el-form-item>

            <!-- 发票明细表格 -->
            <el-form-item label="发票明细">
              <InvoiceTable
                :invoice-list="invoice.invoiceList.value"
                :readonly="isReadonly"
                theme-color="#67c23a"
                :approval-deduction-amount="approvalDeductionAmount"
                @delete="handleDeleteInvoice"
              />
            </el-form-item>

            <el-form-item label="详细说明" prop="description">
              <el-input
                v-model="formData.description"
                type="textarea"
                :rows="4"
                placeholder="请详细说明商务活动的目的、参与人员等信息"
                maxlength="500"
                show-word-limit
                :disabled="isReadonly"
              />
            </el-form-item>

            <!-- 操作按钮 -->
            <el-form-item v-if="!isReadonly" label=" " class="form-actions-item">
              <div class="form-actions">
                <el-button @click="handleSaveDraft" size="large" :loading="reimbursement.loading.value">
                  保存草稿
                </el-button>
                <el-button type="primary" @click="handleSubmit" size="large" :loading="reimbursement.loading.value">
                  提交审批
                </el-button>
              </div>
            </el-form-item>
          </el-form>

          <!-- 付款回单区域（已付款状态显示） -->
          <div v-if="isPaid && paymentProofPath" class="payment-proof-section">
            <h3 class="section-title">
              <el-icon color="#67C23A"><CircleCheckFilled /></el-icon>
              付款回单
            </h3>
            <div class="payment-proof-card">
              <div class="payment-status-badge">
                <el-icon><CircleCheckFilled /></el-icon>
                已付款
              </div>
              <div class="payment-proof-content" @click="handlePreviewPaymentProof">
                <!-- 图片类型 -->
                <template v-if="isPaymentProofImage">
                  <img :src="paymentProofPath" class="payment-proof-image" alt="付款回单" />
                </template>
                <!-- PDF类型 -->
                <template v-else>
                  <div class="payment-proof-pdf">
                    <el-icon :size="48" color="#409EFF"><Document /></el-icon>
                    <span class="pdf-label">付款回单.pdf</span>
                  </div>
                </template>
                <div class="preview-overlay">
                  <el-icon :size="24"><ZoomIn /></el-icon>
                  <span>点击查看大图</span>
                </div>
              </div>
              <div v-if="payTime" class="payment-time">
                付款时间：{{ formatPayTime(payTime) }}
              </div>
            </div>
          </div>

          <!-- 付款回单预览对话框 -->
          <el-dialog v-model="paymentProofDialogVisible" title="付款回单" width="80%" :close-on-click-modal="true">
            <div class="preview-dialog-content">
              <img v-if="isPaymentProofImage" :src="paymentProofPath" class="preview-dialog-image" alt="付款回单" />
              <iframe v-else :src="paymentProofPath" class="preview-dialog-pdf" />
            </div>
          </el-dialog>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, CircleCheckFilled, Document, ZoomIn } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'

// 导入模块化组件
import InvoiceUploader from '@/components/reimbursement/InvoiceUploader.vue'
import InvoiceTable from '@/components/reimbursement/InvoiceTable.vue'

// 导入 composables
import { useInvoice } from '@/composables/reimbursement/useInvoice'
import { useReimbursement } from '@/composables/reimbursement/useReimbursement'
import { UPLOAD_CONFIG } from '@/utils/reimbursement/constants'
import { api } from '@/utils/api'

// 使用 composables
const invoice = useInvoice(UPLOAD_CONFIG.LARGE_MAX_FILES)
const reimbursement = useReimbursement('business', '/business-reimbursement')

// 表单数据
const formData = reactive({
  category: '',
  client: '',
  description: '',
})

// 表单引用
const formRef = ref<FormInstance>()

// 表单验证规则
const formRules: FormRules = {
  category: [
    { required: true, message: '请输入报销类型', trigger: 'blur' },
  ],
  client: [
    { required: true, message: '请输入客户名称或商务对象', trigger: 'blur' },
  ],
}

// 付款回单相关
const paymentProofPath = ref('')
const payTime = ref('')
const paymentProofDialogVisible = ref(false)

// 拒绝原因
const rejectReason = ref('')

// 审批核减金额
const approvalDeductionAmount = ref(0)

// 报销范围/区域
const reimbursementScope = ref('')

// 服务对象
const serviceTarget = ref('')

// 报销范围/区域映射（从 API 动态获取）
const scopeMap = ref<Record<string, string>>({})

// 从 API 获取报销范围配置
const fetchScopeOptions = async () => {
  try {
    const response = await api.get('/api/reimbursement-scope/list')
    if (response.data.success) {
      const buildMap = (items: any[], parentName = '') => {
        for (const item of items) {
          if (item.value) {
            const fullName = parentName ? `${parentName} / ${item.name}` : item.name
            scopeMap.value[item.value] = fullName
          }
          if (item.children?.length) {
            buildMap(item.children, item.name)
          }
        }
      }
      buildMap(response.data.data)
    }
  } catch (error) {
    console.error('获取报销范围配置失败:', error)
  }
}

// 计算属性
const { pageMode, isReadonly, reimbursementMonth } = reimbursement

// 页面标题
const pageTitle = computed(() => {
  if (pageMode.value === 'view') return '查看商务报销单'
  if (pageMode.value === 'edit') return '编辑商务报销单'
  return '新建商务报销单'
})

// 是否已付款
const isPaid = computed(() => {
  const status = reimbursement.reimbursementStatus.value
  return status === 'completed' || status === 'payment_uploaded' || status === 'paying'
})

// 是否已拒绝
const isRejected = computed(() => {
  return reimbursement.reimbursementStatus.value === 'rejected'
})

// 判断付款回单是否为图片
const isPaymentProofImage = computed(() => {
  if (!paymentProofPath.value) return false
  const path = paymentProofPath.value.toLowerCase()
  return path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.png')
})

// 格式化付款时间
function formatPayTime(dateStr: string): string {
  return format(new Date(dateStr), 'yyyy-MM-dd HH:mm', { locale: zhCN })
}

// 预览付款回单
function handlePreviewPaymentProof(): void {
  paymentProofDialogVisible.value = true
}

// 处理文件变化
function handleFileChange(file: any, fileList: any[]): void {
  invoice.handleFileChange(file, fileList)
}

// 处理删除文件
function handleDeleteFile(file: any): void {
  invoice.deleteInvoiceByFile(file.uid)
}

// 处理删除发票
function handleDeleteInvoice(invoiceItem: any): void {
  invoice.deleteInvoiceById(invoiceItem.id)
}

// 返回
function handleBack(): void {
  if (reimbursement.reimbursementId.value) {
    reimbursement.goBack()
    return
  }

  ElMessageBox.confirm('确定要离开吗？未保存的内容将丢失', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  })
    .then(() => {
      reimbursement.goBack()
    })
    .catch(() => {})
}

// 校验表单
async function validateForm(): Promise<boolean> {
  if (invoice.invoiceList.value.length === 0) {
    ElMessage.warning('请至少上传一张发票')
    return false
  }

  if (!formRef.value) return false

  try {
    await formRef.value.validate()
    return true
  } catch {
    return false
  }
}

// 构建提交数据
function buildSubmitData() {
  return {
    type: 'business' as const,
    category: formData.category,
    title: reimbursement.generateTitle(formData.category, '商务报销'),
    description: formData.description,
    client: formData.client,
    invoices: invoice.getInvoicesForSubmit(),
  }
}

// 保存草稿
async function handleSaveDraft(): Promise<void> {
  const valid = await validateForm()
  if (!valid) return

  await reimbursement.saveDraft(buildSubmitData())
}

// 提交审批
async function handleSubmit(): Promise<void> {
  const valid = await validateForm()
  if (!valid) return

  await reimbursement.submitForApproval(buildSubmitData())
}

// 加载报销单详情
async function loadDetail(): Promise<void> {
  console.log('🔍 loadDetail 开始, reimbursementId:', reimbursement.reimbursementId.value)
  const data = await reimbursement.loadReimbursementDetail()
  console.log('🔍 loadDetail 返回数据:', data)
  if (!data) return

  // 设置表单数据
  formData.category = data.category || ''
  formData.client = (data as any).client || (data as any).serviceTarget || ''
  formData.description = data.description || ''

  // 设置报销范围/区域
  if ((data as any).reimbursementScope) {
    const scopeValue = (data as any).reimbursementScope
    reimbursementScope.value = scopeMap.value[scopeValue] || scopeValue
  }

  // 设置服务对象
  if ((data as any).serviceTarget) {
    serviceTarget.value = (data as any).serviceTarget
  }

  // 加载发票数据
  if (data.invoices) {
    invoice.loadInvoices(data.invoices)
  }

  // 加载付款回单数据
  if ((data as any).paymentProofPath) {
    paymentProofPath.value = (data as any).paymentProofPath
  }
  if ((data as any).payTime) {
    payTime.value = (data as any).payTime
  }

  // 加载拒绝原因
  if ((data as any).rejectReason) {
    rejectReason.value = (data as any).rejectReason
  }

  // 加载审批核减金额
  if ((data as any).deductionAmount !== undefined) {
    approvalDeductionAmount.value = (data as any).deductionAmount || 0
  }

  console.log('📋 商务报销单详情加载完成:', {
    status: data.status,
    rejectReason: (data as any).rejectReason,
    isRejected: data.status === 'rejected',
    deductionAmount: approvalDeductionAmount.value
  })
}

// 组件挂载
onMounted(async () => {
  fetchScopeOptions()
  if (reimbursement.reimbursementId.value) {
    loadDetail()
  }
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.reimbursement-detail-container {
  min-height: calc(100vh - 60px);
  margin: -24px -45px;
  padding: 0;
  position: relative;
}

.page-card {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: none;
  box-shadow: none;
}

.page-card :deep(.el-card__body) {
  flex: 1;
  padding: 24px;
  overflow: visible !important;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-left h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.content-wrapper {
  flex: 1;
  padding: 0;
  overflow: visible !important;
}

.step-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 20px;
}

.step-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 2px solid #67c23a;
}

.business-alert {
  margin-bottom: 24px;
}

/* 拒绝原因区域样式 */
.reject-reason-section {
  max-width: 1200px;
  margin: 0 auto 24px;
}

.reject-reason-content {
  margin-top: 8px;
}

.reject-reason-content p {
  margin: 0 0 8px 0;
  line-height: 1.6;
}

.reject-reason-content .reject-tip {
  color: #909399;
  font-size: 13px;
  margin-top: 12px;
}

.reimbursement-form {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  background: #f5f7fa;
  border-radius: 8px;
}

.form-actions-item {
  margin-top: 24px;
}

.form-actions-item :deep(.el-form-item__label) {
  display: none;
}

.form-actions-item :deep(.el-form-item__content) {
  display: flex;
  justify-content: center !important;
  margin-left: 0 !important;
}

.form-actions {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  width: 100%;
}

/* 付款回单区域样式 */
.payment-proof-section {
  max-width: 1200px;
  margin: 32px auto 0;
  padding: 24px;
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border-radius: 12px;
  border: 2px solid #86efac;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  color: #166534;
  margin: 0 0 20px 0;
}

.payment-proof-card {
  position: relative;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.payment-status-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(34, 197, 94, 0.4);
}

.payment-proof-content {
  position: relative;
  min-height: 200px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8fafc;
}

.payment-proof-content:hover .preview-overlay {
  opacity: 1;
}

.payment-proof-image {
  width: 100%;
  max-height: 400px;
  object-fit: contain;
}

.payment-proof-pdf {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px;
}

.pdf-label {
  font-size: 16px;
  color: #64748b;
  font-weight: 500;
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

.payment-time {
  padding: 12px 16px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 14px;
  text-align: center;
  border-top: 1px solid #e2e8f0;
}

/* 预览对话框样式 */
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
</style>
