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
        <!-- 步骤1: 选择报销类型 -->
        <div v-if="currentStep === 1" class="step-content">
          <h3 class="step-title">选择报销类型</h3>
          <TypeSelector v-model="selectedType" @select="handleTypeSelect" />
        </div>

        <!-- 步骤2: 填写报销信息 -->
        <div v-if="currentStep === 2" class="step-content">
          <h3 class="step-title">填写报销信息</h3>

          <!-- 加载状态提示 -->
          <div v-if="reimbursement.loading.value && !dataLoaded" style="text-align: center; padding: 40px 0; color: #909399;">
            <el-icon class="is-loading" :size="24"><Loading /></el-icon>
            <p>正在加载报销单数据...</p>
          </div>

          <!-- 加载错误提示 -->
          <div v-if="reimbursement.loadError.value" style="margin-bottom: 20px;">
            <el-alert
              :title="'数据加载失败: ' + reimbursement.loadError.value"
              type="error"
              :closable="false"
              show-icon
            >
              <template #default>
                <el-button type="primary" size="small" @click="retryLoad" style="margin-top: 8px;">重新加载</el-button>
              </template>
            </el-alert>
          </div>

          <!-- 驳回原因提示（已驳回状态显示） -->
          <div v-if="isRejected && rejectReason" class="reject-reason-section">
            <el-alert
              title="审批被驳回"
              type="error"
              :closable="false"
              show-icon
            >
              <template #default>
                <div class="reject-reason-content">
                  <p><strong>驳回原因：</strong>{{ rejectReason }}</p>
                  <p v-if="!isReadonly" class="reject-tip">您可以根据驳回原因修改后重新提交审批。</p>
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
              <el-input :model-value="displayMonth" disabled />
            </el-form-item>

            <div class="upload-layout">
              <div class="upload-left">
                <el-form-item label="发票上传" prop="files">
                  <InvoiceUploader
                    v-model="invoice.fileList.value"
                    :max-files="5"
                    :disabled="isReadonly"
                    theme-color="#667eea"
                    @file-change="handleFileChange"
                    @delete-file="handleDeleteFile"
                    @exceed="() => ElMessage.warning('超出最大上传数量限制')"
                  />
                </el-form-item>
              </div>

              <div class="upload-right">
                <el-form-item label="无票上传">
                  <ReceiptUploader
                    v-model="receiptFileList"
                    :disabled="isReadonly"
                    theme-color="#67c23a"
                    @file-change="handleReceiptChange"
                    @delete-file="handleDeleteReceipt"
                  />
                </el-form-item>
              </div>

              <div class="upload-deduction">
                <el-form-item label="核减上传">
                  <DeductionUploader
                    v-model="deductionItems"
                    :total-invoice-amount="invoice.totalAmount.value"
                    :yearly-deduction-used="0"
                    :existing-invoices="invoice.invoiceList.value"
                    :disabled="isReadonly"
                  />
                </el-form-item>
              </div>
            </div>

            <!-- 发票明细表格 -->
            <el-form-item label="发票明细">
              <InvoiceTable
                :invoice-list="invoice.invoiceList.value"
                :readonly="isReadonly"
                :show-deduction="true"
                :monthly-used-quota="invoice.monthlyUsedQuota.value"
                :deduction-invoices="deductionItems"
                :total-invoice-amount="invoice.totalAmount.value"
                :approval-deduction-amount="approvalDeductionAmount"
                :yearly-deduction-used="yearlyDeductionUsed"
                theme-color="#409eff"
                @delete="handleDeleteInvoice"
              />
            </el-form-item>

            <el-form-item label="详细说明" prop="description">
              <el-input
                v-model="formData.description"
                type="textarea"
                :rows="4"
                placeholder="请详细说明报销内容（选填）"
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

          <!-- 付款回单区域 -->
          <div v-if="isPaid && paymentProofPath" class="payment-proof-section">
            <h3 class="section-title">
              <el-icon color="#67C23A"><CircleCheckFilled /></el-icon>
              付款回单
            </h3>
            <!-- 批量付款批次信息 -->
            <div v-if="batchInfo" class="batch-info-card">
              <div class="batch-info-header">
                <el-tag type="warning" size="small">合并打款</el-tag>
                <span v-if="batchInfo.batchNo" class="batch-no">批次号：{{ batchInfo.batchNo }}</span>
              </div>
              <div class="batch-info-detail">
                本次付款合计 <strong>¥{{ batchInfo.totalAmount.toFixed(2) }}</strong>，包含 {{ batchInfo.reimbursementCount }} 笔报销：
              </div>
              <div class="batch-reimbursement-list">
                <div
                  v-for="r in batchInfo.reimbursements"
                  :key="r.id"
                  class="batch-reimbursement-item"
                  :class="{ 'is-current': r.id === reimbursement.reimbursementId.value, 'is-clickable': r.id !== reimbursement.reimbursementId.value }"
                  @click="handleBatchItemClick(r)"
                >
                  <span class="batch-r-id">{{ r.id }}</span>
                  <el-tag v-if="r.id === reimbursement.reimbursementId.value" type="primary" size="small">本笔</el-tag>
                  <span class="batch-r-title">{{ r.title }}</span>
                  <span class="batch-r-amount">¥{{ parseFloat(r.amount).toFixed(2) }}</span>
                </div>
              </div>
            </div>
            <div class="payment-proof-card">
              <div class="payment-status-badge">
                <el-icon><CircleCheckFilled /></el-icon>
                已付款
              </div>
              <div class="payment-proof-content">
                <div v-for="(proofUrl, idx) in paymentProofPaths" :key="idx" class="payment-proof-item" @click="handlePreviewPaymentProof(proofUrl)">
                  <template v-if="isImagePath(proofUrl)">
                    <img :src="proofUrl" class="payment-proof-image" alt="付款回单" @error="handleProofImageError" />
                  </template>
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
              </div>
              <div v-if="payTime" class="payment-time">
                付款时间：{{ payTime }}
              </div>
            </div>
          </div>

          <!-- 付款回单预览对话框 -->
          <el-dialog v-model="paymentProofDialogVisible" title="付款回单" width="80%" :close-on-click-modal="true">
            <div class="preview-dialog-content">
              <img v-if="isPaymentProofImage" :src="previewingProofUrl" class="preview-dialog-image" alt="付款回单" />
              <iframe v-else :src="previewingProofUrl" class="preview-dialog-pdf" />
            </div>
          </el-dialog>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Loading } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'

// 导入模块化组件
import TypeSelector from '@/components/reimbursement/TypeSelector.vue'
import InvoiceUploader from '@/components/reimbursement/InvoiceUploader.vue'
import ReceiptUploader from '@/components/reimbursement/ReceiptUploader.vue'
import InvoiceTable from '@/components/reimbursement/InvoiceTable.vue'
import DeductionUploader from '@/components/reimbursement/DeductionUploader.vue'
import type { DeductionItem } from '@/components/reimbursement/DeductionUploader.vue'

// 导入 composables
import { useRouter } from 'vue-router'
import { useInvoice } from '@/composables/reimbursement/useInvoice'
import { useReimbursement } from '@/composables/reimbursement/useReimbursement'
import { getTypeLabel } from '@/utils/reimbursement/constants'
import { api } from '@/utils/api'
import { toFileUrl } from '@/utils/file'

const router = useRouter()

// 报销类型到路由的映射
const typeRouteMap: Record<string, string> = {
  basic: '/basic-reimbursement',
  business: '/business-reimbursement',
  large: '/large-reimbursement',
}

// 点击批次中的报销单跳转
function handleBatchItemClick(item: any) {
  const currentId = reimbursement.reimbursementId.value
  if (item.id === currentId) return
  const basePath = typeRouteMap[item.type] || '/basic-reimbursement'
  router.push({
    path: `${basePath}/${item.id}`,
    query: { mode: 'view' }
  })
}

// 使用 composables
const invoice = useInvoice()
const reimbursement = useReimbursement('basic', '/basic-reimbursement')

// 当前步骤 - 如果是查看/编辑模式，直接跳到步骤2
const currentStep = ref(reimbursement.reimbursementId.value ? 2 : 1)

// 选中的报销类型
const selectedType = ref('')

// 表单数据
const formData = reactive({
  description: '',
})

// 无票上传文件列表
const receiptFileList = ref<any[]>([])

// 核减发票列表
const deductionItems = ref<DeductionItem[]>([])

// 表单引用
const formRef = ref<FormInstance>()

// 表单验证规则
const formRules: FormRules = {}

// 付款回单相关
const paymentProofPath = ref('')
// 支持多张回单（逗号分隔），并转换为可访问的 URL
const paymentProofPaths = computed(() => {
  if (!paymentProofPath.value) return []
  return paymentProofPath.value.split(',').filter(Boolean).map(path => toFileUrl(path))
})
const previewingProofUrl = ref('')
const payTime = ref('')
const paymentProofDialogVisible = ref(false)

// 批次信息
const paymentBatchId = ref('')
const batchInfo = ref<{ batchNo: string; totalAmount: number; reimbursementCount: number; reimbursements: any[] } | null>(null)

// 驳回原因
const rejectReason = ref('')

// 审批核减金额
const approvalDeductionAmount = ref(0)

// 年度累计核减金额
const yearlyDeductionUsed = ref(0)

// 数据是否已加载
const dataLoaded = ref(false)

// 报销月份（从详情接口获取真实值，新建时使用当前月份）
const reimbursementMonthDisplay = ref('')

// 显示用的报销月份（优先使用接口返回的真实月份）
const displayMonth = computed(() => reimbursementMonthDisplay.value || reimbursementMonth.value)

// 计算属性
const { pageMode, isReadonly, reimbursementMonth } = reimbursement

// 页面标题
const pageTitle = computed(() => {
  if (pageMode.value === 'view') return '查看报销单'
  if (pageMode.value === 'edit') return '编辑报销单'
  return '新建报销单'
})

// 选中类型的标签
const selectedTypeLabel = computed(() => getTypeLabel(selectedType.value))

// 是否已拒绝
const isRejected = computed(() => {
  return reimbursement.reimbursementStatus.value === 'rejected'
})

// 判断是否已付款（用于显示付款回单）
const isPaid = computed(() => {
  const status = reimbursement.reimbursementStatus.value
  return status === 'payment_uploaded' || status === 'completed'
})

// 判断路径是否为图片
function isImagePath(p: string): boolean {
  const lower = p.toLowerCase()
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')
}
const isPaymentProofImage = computed(() => paymentProofPaths.value.length > 0 && paymentProofPaths.value.every(isImagePath))

function isImageFilePath(filePath?: string): boolean {
  if (!filePath) return false
  const normalizedPath = filePath.toLowerCase()
  return normalizedPath.endsWith('.jpg')
    || normalizedPath.endsWith('.jpeg')
    || normalizedPath.endsWith('.png')
    || normalizedPath.endsWith('.gif')
    || normalizedPath.endsWith('.bmp')
    || normalizedPath.endsWith('.webp')
  }

// 付款回单图片加载失败处理
function handleProofImageError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
  api.get('/api/auth/user').catch(() => {
    window.location.href = '/login'
  })
}

// 预览付款回单
function handlePreviewPaymentProof(url?: string): void {
  previewingProofUrl.value = url || paymentProofPaths.value[0] || ''
  paymentProofDialogVisible.value = true
}

// 选择报销类型后进入下一步
function handleTypeSelect(type: string): void {
  selectedType.value = type
  currentStep.value = 2
}

// 处理文件变化
async function handleFileChange(file: any, fileList: any[]): Promise<void> {
  await invoice.handleFileChange(file, fileList)
  // 每次上传发票后,重新获取当月已使用额度（编辑模式下排除当前报销单）
  await invoice.fetchMonthlyUsedQuota(reimbursement.reimbursementId.value)
}

// 处理无票上传变化
async function handleReceiptChange(file: any, fileList: any[]): Promise<void> {
  await invoice.handleReceiptChange(file, fileList)
  receiptFileList.value = fileList
  await invoice.fetchMonthlyUsedQuota(reimbursement.reimbursementId.value)
}

// 处理删除文件
function handleDeleteFile(file: any): void {
  invoice.deleteInvoiceByFile(file.uid)
}

// 处理删除无票文件
function handleDeleteReceipt(file: any): void {
  const index = receiptFileList.value.findIndex(item => item.uid === file.uid)
  if (index > -1) {
    receiptFileList.value.splice(index, 1)
  }
  invoice.deleteInvoiceByFile(file.uid)
}

// 处理删除发票
function handleDeleteInvoice(invoiceItem: any): void {
  if (invoiceItem.isDeduction) {
    // 删除核减发票
    const index = deductionItems.value.findIndex(item =>
      item.filePath === invoiceItem.filePath ||
      item.invoiceNumber === invoiceItem.invoiceNumber
    )
    if (index > -1) {
      deductionItems.value.splice(index, 1)
    }
  } else {
    // 删除普通发票
    const receiptIndex = receiptFileList.value.findIndex(file => file.uid === invoiceItem.fileUid)
    if (receiptIndex > -1) {
      receiptFileList.value.splice(receiptIndex, 1)
    }
    invoice.deleteInvoiceById(invoiceItem.id)
  }
}

// 清除表单数据
function clearFormData(): void {
  // 清除选中的类型
  selectedType.value = ''
  // 清除表单数据
  formData.description = ''
  // 清除发票列表
  invoice.clearInvoices()
  receiptFileList.value = []
  deductionItems.value = []
  // 重置表单验证
  formRef.value?.resetFields()
}

// 获取年度累计核减金额
async function fetchYearlyDeduction(excludeId?: string) {
  try {
    const url = excludeId
      ? `/api/reimbursement/deduction-quota?excludeId=${excludeId}`
      : '/api/reimbursement/deduction-quota'
    const response = await fetch(url, { credentials: 'include' })
    const result = await response.json()
    if (result.success) {
      yearlyDeductionUsed.value = result.data.yearlyDeductionTotal || 0
    }
  } catch (error) {
    console.error('获取年度核减金额失败:', error)
  }
}

// 返回
function handleBack(): void {
  // 如果是编辑或查看模式，直接返回列表
  if (reimbursement.reimbursementId.value) {
    reimbursement.goBack()
    return
  }

  // 新建模式下的返回逻辑
  if (currentStep.value === 2) {
    // 步骤2：显示确认提示
    ElMessageBox.confirm('确定要离开吗？未保存的内容将丢失', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
      .then(() => {
        // 确认后清除数据并返回步骤1
        clearFormData()
        currentStep.value = 1
      })
      .catch(() => {})
  } else {
    // 步骤1：直接返回列表
    reimbursement.goBack()
  }
}

// 校验表单
async function validateForm(): Promise<boolean> {
  // 只在新建模式下检查是否选择了类型
  // 编辑模式下（草稿或拒绝状态），selectedType 可能为空但不影响提交
  if (!selectedType.value && !reimbursement.reimbursementId.value) {
    ElMessage.warning('请先选择报销类型')
    return false
  }

  if (invoice.invoiceList.value.length === 0 && deductionItems.value.length === 0) {
    ElMessage.warning('请至少上传一张发票或核减发票')
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
  // 如果是编辑模式且 selectedType 为空，使用默认值
  const category = selectedType.value || '基础报销'
  const categoryLabel = selectedType.value ? selectedTypeLabel.value : '基础报销'

  // 普通发票（不含 isDeduction）
  const normalInvoices = invoice.getInvoicesForSubmit()

  // 核减发票（合并进同一 invoices 数组，带 is_deduction 标记）
  const deductionInvoiceItems = deductionItems.value.map(item => ({
    amount: item.amount,
    invoiceDate: item.invoiceDate,
    invoiceNumber: item.invoiceNumber || '',
    filePath: item.filePath || '',
    fileHash: item.fileHash || '',
    deductedAmount: 0,
    actualAmount: 0,
    isDeduction: true as const,
  }))

  return {
    type: 'basic' as const,
    category,
    title: reimbursement.generateTitle(categoryLabel),
    description: formData.description,
    invoices: [...normalInvoices, ...deductionInvoiceItems],
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
  try {
    const data = await reimbursement.loadReimbursementDetail()
    if (!data) return

    console.log('📋 BasicReimbursementDetail - 加载详情数据:', {
      hasInvoices: !!data.invoices,
      invoicesCount: data.invoices?.length,
      status: (data as any).status,
    })

    // 设置报销类型
    selectedType.value = data.category || ''

    // 设置表单数据
    formData.description = data.description || ''

    // 设置报销月份（使用接口返回的真实月份）
    if ((data as any).reimbursementMonth) {
      reimbursementMonthDisplay.value = (data as any).reimbursementMonth
    }

    // 加载发票数据
    if (data.invoices && Array.isArray(data.invoices)) {
      // 分离普通发票和核减发票（isDeduction 可能是 0/1 或 false/true）
      const normalInvoices = data.invoices.filter((inv: any) => !inv.isDeduction)
      const deductionInvoices = data.invoices.filter((inv: any) => inv.isDeduction)

      // 加载普通发票到 invoiceList
      invoice.loadInvoices(normalInvoices)

      // 加载核减发票
      deductionItems.value = deductionInvoices.map((inv: any) => ({
        id: inv.id,
        filePath: inv.filePath,
        fileHash: inv.fileHash,
        invoiceNumber: inv.invoiceNumber,
        amount: inv.amount,
        invoiceDate: inv.invoiceDate,
        category: inv.category,
        isDeduction: true,
      }))

      // 分离 PDF 发票和收据（图片）的 fileList
      const allFiles = invoice.fileList.value
      const pdfFiles: any[] = []
      const receiptFiles: any[] = []

      allFiles.forEach((file, index) => {
        const invoiceItem = normalInvoices[index]
        if (invoiceItem && isImageFilePath(invoiceItem.filePath)) {
          receiptFiles.push(file)
        } else {
          pdfFiles.push(file)
        }
      })

      // 更新 fileList（只保留 PDF 发票）
      invoice.fileList.value = pdfFiles
      // 设置收据 fileList
      receiptFileList.value = receiptFiles
    }

    // 加载付款回单数据
    if ((data as any).paymentProofPath) {
      paymentProofPath.value = (data as any).paymentProofPath
    }
    if ((data as any).payTime) {
      payTime.value = (data as any).payTime
    }

    // 加载批次信息
    if ((data as any).paymentBatchId) {
      paymentBatchId.value = (data as any).paymentBatchId
      try {
        const batchRes = await api.get(`/api/reimbursement/payment-batch/${paymentBatchId.value}`)
        if (batchRes.data.success && batchRes.data.data.reimbursements.length > 1) {
          batchInfo.value = {
            batchNo: batchRes.data.data.batchNo,
            totalAmount: batchRes.data.data.totalAmount,
            reimbursementCount: batchRes.data.data.reimbursements.length,
            reimbursements: batchRes.data.data.reimbursements,
          }
        }
      } catch (e) {
        // 批次信息加载失败不影响主流程
      }
    }

    // 银行回单PDF合并打款：通过报销单ID反查关联的其他报销单（bankReceiptProcessor流程）
    if (!batchInfo.value && (data as any).paymentProofPath?.includes('bank-receipts')) {
      try {
        const brRes = await api.get(`/api/bank-receipts/by-reimbursement/${reimbursement.reimbursementId.value}`)
        if (brRes.data.success && brRes.data.data) {
          const brData = brRes.data.data
          batchInfo.value = {
            batchNo: '',  // 银行回单流程无批次号，留空
            totalAmount: brData.totalAmount,
            reimbursementCount: brData.reimbursements.length,
            reimbursements: brData.reimbursements.map((r: any) => ({
              id: r.id,
              title: r.title,
              amount: r.amount,
              applicant: r.applicantName,
            })),
          }
        }
      } catch (e) {
        // 银行回单关联查询失败不影响主流程
      }
    }

    // 加载驳回原因
    if ((data as any).rejectReason) {
      rejectReason.value = (data as any).rejectReason
    }

    // 加载审批核减金额
    if ((data as any).deductionAmount !== undefined) {
      approvalDeductionAmount.value = (data as any).deductionAmount || 0
    }

    // 查看或编辑已有报销单时，直接进入第二步
    currentStep.value = 2
    dataLoaded.value = true
  } catch (error) {
    console.error('❌ [基础] loadDetail 异常:', error)
    ElMessage.error('加载报销单数据失败')
  }
}

// 重新加载
async function retryLoad(): Promise<void> {
  if (reimbursement.reimbursementId.value) {
    await loadDetail()
  }
}

// 组件挂载
onMounted(async () => {
  // 清空之前的数据，防止组件复用时显示旧数据
  invoice.clearInvoices()

  try {
    // 如果是编辑/查看模式，先加载详情，然后获取额度时排除当前报销单
    if (reimbursement.reimbursementId.value) {
      await loadDetail()
      // 获取当月已使用额度（排除当前报销单）
      await invoice.fetchMonthlyUsedQuota(reimbursement.reimbursementId.value)
      // 获取年度累计核减金额（排除当前报销单）
      await fetchYearlyDeduction(reimbursement.reimbursementId.value)
    } else {
      // 新建模式，直接获取当月已使用额度
      await invoice.fetchMonthlyUsedQuota()
      // 获取年度累计核减金额
      await fetchYearlyDeduction()
    }
  } catch (error) {
    console.error('❌ [基础] onMounted 异常:', error)
  }
})

// 监听路由参数变化（Vue Router 复用组件时 onMounted 不会再次触发）
watch(
  () => reimbursement.reimbursementId.value,
  async (newId, oldId) => {
    if (newId && newId !== oldId) {
      invoice.clearInvoices()
      selectedType.value = ''
      formData.description = ''
      reimbursementMonthDisplay.value = ''
      rejectReason.value = ''
      approvalDeductionAmount.value = 0
      paymentProofPath.value = ''
      payTime.value = ''
      receiptFileList.value = []
      deductionItems.value = []
      await loadDetail()
      await invoice.fetchMonthlyUsedQuota(newId)
      await fetchYearlyDeduction(newId)
    }
  }
)
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.reimbursement-detail-container {
  height: calc(100vh - 60px);
  margin: -24px;
  padding: 0;
  position: relative;
}

.page-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: none;
  box-shadow: none;
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
  overflow-y: auto;
  padding: 0;
}

.step-content {
  max-width: 100%;
  margin: 0 auto;
  padding: 16px 24px;
}

.step-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 2px solid #409eff;
}

/* 驳回原因区域样式 */
.reject-reason-section {
  max-width: min(1100px, 100%);
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
  max-width: min(1100px, 100%);
  margin: 0 auto;
  padding: 24px 24px 24px 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.upload-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.upload-left,
.upload-right,
.upload-deduction {
  flex: 1;
  min-width: 0;
}

@media (max-width: 1366px) {
  .upload-layout {
    flex-direction: column;
  }
  .upload-left,
  .upload-right,
  .upload-deduction {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
  }
}

.upload-layout .el-form-item {
  margin-bottom: 0;
}

.upload-layout :deep(.el-form-item__label) {
  font-size: 14px;
  font-weight: 500;
  line-height: 32px;
}

.upload-layout :deep(.el-form-item__content) {
  line-height: 32px;
}

.upload-layout :deep(.upload-header) {
  min-height: 48px;
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
  max-width: min(1100px, 100%);
  margin: 32px auto 0;
  padding: 24px;
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border-radius: 12px;
  border: 2px solid #86efac;
}

/* 批次信息卡片 */
.batch-info-card {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
}

.batch-info-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.batch-no {
  font-size: 13px;
  color: #92400e;
}

.batch-info-detail {
  font-size: 13px;
  color: #78350f;
  margin-bottom: 8px;
}

.batch-reimbursement-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.batch-reimbursement-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #92400e;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 4px;
}

.batch-reimbursement-item.is-clickable {
  cursor: pointer;
  transition: background-color 0.2s;
}

.batch-reimbursement-item.is-clickable:hover {
  background: rgba(64, 158, 255, 0.12);
}

.batch-reimbursement-item.is-clickable .batch-r-id,
.batch-reimbursement-item.is-clickable .batch-r-title {
  color: #409eff;
}

.batch-reimbursement-item.is-current {
  background: rgba(64, 158, 255, 0.08);
  border: 1px solid rgba(64, 158, 255, 0.3);
}

.batch-r-id {
  font-family: monospace;
  font-size: 11px;
}

.batch-r-amount {
  margin-left: auto;
  font-weight: 600;
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
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  min-height: 200px;
  align-items: center;
  justify-content: center;
  background: #f8fafc;
}

.payment-proof-item {
  position: relative;
  cursor: pointer;
}

.payment-proof-item:hover .preview-overlay {
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
