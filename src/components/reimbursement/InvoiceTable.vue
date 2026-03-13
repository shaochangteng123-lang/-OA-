<template>
  <div class="invoice-table-wrapper">
    <el-table :data="invoiceList" border class="invoice-table">
      <el-table-column prop="id" label="序号" width="50" align="center">
        <template #default="{ $index }">
          {{ $index + 1 }}
        </template>
      </el-table-column>
      <el-table-column prop="category" label="报销类型" min-width="160" align="center">
        <template #default="{ row }">
          <span style="white-space: nowrap;">{{ row.category || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="amount" label="金额" width="100" align="center">
        <template #default="{ row }">
          ¥{{ row.amount }}
        </template>
      </el-table-column>
      <el-table-column prop="invoiceDate" label="开票日期" width="130" align="center">
        <template #default="{ row }">
          {{ formatDateToChinese(row.invoiceDate) }}
        </template>
      </el-table-column>
      <el-table-column prop="invoiceNumber" label="发票号码" min-width="300" align="center">
        <template #default="{ row }">
          <span style="white-space: nowrap;">{{ row.invoiceNumber || '' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="缩略图" width="110" align="center">
        <template #default="{ row }">
          <div v-if="row.filePath" class="thumbnail-wrapper" @click="handlePreview(row.filePath)">
            <!-- 判断是否为图片文件 -->
            <div v-if="isImageFile(row.filePath)" class="image-thumbnail">
              <img :src="getImageUrl(row.filePath)" alt="收据" class="thumbnail-image" />
            </div>
            <!-- PDF文件显示图标 -->
            <div v-else class="pdf-icon">
              <el-icon :size="30"><Document /></el-icon>
              <div style="font-size: 10px; margin-top: 2px;">PDF</div>
            </div>
          </div>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="60" align="center">
        <template #default="{ row }">
          <el-button v-if="!readonly" type="danger" link @click="onDelete(row)">
            <el-icon><Delete /></el-icon>
          </el-button>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 总计行 -->
    <div class="invoice-total" :class="{ 'amount-warning': showAmountWarning }">
      <span class="total-label">总计</span>
      <span class="total-amount" :style="{ color: themeColor }">¥{{ totalAmount }}</span>
      <span v-if="showDeduction && hasTransportFuelInvoices && !approvalDeductionAmount" class="deducted-info">
        （核减：-¥{{ totalDeductedAmount }}）
      </span>
      <span v-if="approvalDeductionAmount > 0" class="deducted-info">
        （核减：-¥{{ approvalDeductionAmount.toFixed(2) }}）
      </span>
      <span v-if="warningText" class="amount-tip">
        {{ warningText }}
      </span>
    </div>

    <!-- 核减提示信息 -->
    <div v-if="showDeduction && hasTransportFuelInvoices && !approvalDeductionAmount" class="deduction-notice">
      <div class="notice-detail-list">
        <div class="notice-detail-row">
          <span class="detail-text">本次运输/交通/汽油/柴油类发票小计：¥{{ transportFuelSubtotal.toFixed(2) }}</span>
        </div>
        <div class="notice-detail-row">
          <span class="detail-text">本月累计运输/交通/汽油/柴油类金额：¥{{ (monthlyUsedQuota + transportFuelSubtotal).toFixed(2) }}<span class="detail-limit">（月度上限 ¥1500.00）</span></span>
        </div>
        <div class="notice-detail-row deduction-row">
          <span class="detail-text">核减金额（超出部分不作为报销）：<span class="deducted-highlight">-¥{{ totalDeductedAmount }}</span></span>
        </div>
        <div class="notice-detail-row actual-row">
          <span class="detail-text">实际报销金额：<span class="actual-highlight">¥{{ transportFuelActual.toFixed(2) }}</span></span>
        </div>
      </div>
    </div>

    <!-- 审批核减提示信息 -->
    <div v-if="approvalDeductionAmount > 0" class="deduction-notice">
      <div class="notice-detail-list">
        <div class="notice-detail-row">
          <span class="detail-text">发票总金额：¥{{ totalAmount }}</span>
        </div>
        <div class="notice-detail-row deduction-row">
          <span class="detail-text">审批核减金额：<span class="deducted-highlight">-¥{{ approvalDeductionAmount.toFixed(2) }}</span></span>
        </div>
        <div class="notice-detail-row actual-row">
          <span class="detail-text">实际报销金额：<span class="actual-highlight">¥{{ transportFuelActual.toFixed(2) }}</span></span>
        </div>
      </div>
    </div>

    <!-- 图片/PDF预览对话框 -->
    <el-dialog
      v-model="previewVisible"
      :show-close="true"
      width="100%"
      top="0"
      :append-to-body="true"
      :close-on-click-modal="true"
      :fullscreen="true"
      class="preview-dialog"
    >
      <div class="preview-container">
        <!-- 图片预览 -->
        <img
          v-if="previewImageUrl && !previewPdfUrl"
          :src="previewImageUrl"
          class="preview-image"
          alt="预览图片"
        />
        <!-- PDF预览 -->
        <iframe
          v-if="previewPdfUrl"
          :src="previewPdfUrl"
          class="preview-pdf"
          frameborder="0"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Delete, Document } from '@element-plus/icons-vue'
import type { InvoiceItem } from '@/composables/reimbursement/useInvoice'

// 预览相关
const previewVisible = ref(false)
const previewImageUrl = ref('')
const previewPdfUrl = ref('')

// Props
const props = withDefaults(defineProps<{
  invoiceList: InvoiceItem[]
  readonly?: boolean
  themeColor?: string
  amountThreshold?: number
  showThresholdWarning?: boolean
  showDeduction?: boolean  // 是否显示核减金额列（仅基础报销显示）
  monthlyUsedQuota?: number  // 当月已使用的运输/交通/汽油/柴油类发票额度
  approvalDeductionAmount?: number  // 审批核减金额（已审批状态下使用）
}>(), {
  readonly: false,
  themeColor: '#409eff',
  amountThreshold: 0,
  showThresholdWarning: false,
  showDeduction: false,
  monthlyUsedQuota: 0,
  approvalDeductionAmount: 0,
})

// Emits
const emit = defineEmits<{
  (e: 'delete', invoice: InvoiceItem): void
}>()

// 计算总金额数值（用于比较）- 使用精确的金额计算方法
const totalAmountNumber = computed(() => {
  // 将所有金额转换为分（整数），避免浮点数精度问题
  const totalCents = props.invoiceList.reduce((acc, item) => {
    const amount = item.amount || 0  // 使用原始金额，不使用actualAmount
    const amountInCents = Math.round(amount * 100)
    return acc + amountInCents
  }, 0)
  // 转换回元
  return totalCents / 100
})

// 计算总金额 - 保留原始精度，不进行四舍五入
const totalAmount = computed(() => {
  // 保留两位小数显示
  return totalAmountNumber.value.toFixed(2)
})

// 计算总核减金额（数值）
const totalDeductedAmountNumber = computed(() => {
  const totalCents = props.invoiceList.reduce((acc, item) => {
    const deducted = item.deductedAmount || 0
    const deductedInCents = Math.round(deducted * 100)
    return acc + deductedInCents
  }, 0)
  return totalCents / 100
})

// 计算总核减金额（格式化字符串）
const totalDeductedAmount = computed(() => {
  return totalDeductedAmountNumber.value.toFixed(2)
})

// 是否有运输/交通/汽油/柴油类发票
const hasTransportFuelInvoices = computed(() => {
  return props.invoiceList.some(item => {
    const category = item.category?.toLowerCase() || ''
    return category.includes('运输') ||
      category.includes('交通') ||
      category.includes('汽油') ||
      category.includes('柴油')
  })
})

// 运输服务/汽油类发票小计（原始金额）
const transportFuelSubtotal = computed(() => {
  const totalCents = props.invoiceList.reduce((acc, item) => {
    const category = item.category?.toLowerCase() || ''
    const isTransportOrFuel =
      category.includes('运输') ||
      category.includes('交通') ||
      category.includes('汽油') ||
      category.includes('柴油')
    if (isTransportOrFuel) {
      return acc + Math.round(item.amount * 100)
    }
    return acc
  }, 0)
  return totalCents / 100
})

// 实际报销金额（所有发票）
const transportFuelActual = computed(() => {
  // 如果有审批核减金额（已审批状态），使用：总金额 - 审批核减金额
  if (props.approvalDeductionAmount > 0) {
    const totalCents = Math.round(totalAmountNumber.value * 100)
    const deductionCents = Math.round(props.approvalDeductionAmount * 100)
    return (totalCents - deductionCents) / 100
  }

  // 否则使用：总金额 - 核减金额（提交前的预估）
  const totalCents = Math.round(totalAmountNumber.value * 100)
  const deductedCents = Math.round(totalDeductedAmountNumber.value * 100)
  return (totalCents - deductedCents) / 100
})

// 是否显示金额警告
const showAmountWarning = computed(() => {
  if (!props.showThresholdWarning || !props.amountThreshold) return false
  return totalAmountNumber.value > 0 && totalAmountNumber.value <= props.amountThreshold
})

// 警告文本
const warningText = computed(() => {
  if (!showAmountWarning.value) return ''
  return `(金额不足${props.amountThreshold}元，不属于大额报销)`
})

// 格式化日期为中文格式
function formatDateToChinese(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${year}年${month}月${day}日`
}

// 获取图片URL
function getImageUrl(filePath: string): string {
  if (!filePath) return ''
  // 如果已经是完整URL，直接返回
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath
  }
  // 如果是相对路径，添加API前缀
  if (filePath.startsWith('/')) {
    return filePath
  }
  // 否则添加 /api/ 前缀
  return `/api/${filePath}`
}

// 判断是否为图片文件
function isImageFile(filePath: string): boolean {
  if (!filePath) return false
  const lowerPath = filePath.toLowerCase()
  return (
    lowerPath.endsWith('.jpg') ||
    lowerPath.endsWith('.jpeg') ||
    lowerPath.endsWith('.png') ||
    lowerPath.endsWith('.gif') ||
    lowerPath.endsWith('.bmp') ||
    lowerPath.endsWith('.webp') ||
    lowerPath.includes('receipt-') // 收据文件名包含 receipt-
  )
}

// 处理预览
function handlePreview(filePath: string): void {
  const fileUrl = getImageUrl(filePath)

  // 如果是PDF文件，使用弹窗预览
  if (!isImageFile(filePath)) {
    console.log('原始路径:', filePath)
    console.log('处理后路径:', fileUrl)
    previewPdfUrl.value = fileUrl
    previewImageUrl.value = ''
    previewVisible.value = true
    return
  }

  // 如果是图片文件，使用对话框预览
  console.log('原始路径:', filePath)
  console.log('处理后路径:', fileUrl)
  previewImageUrl.value = fileUrl
  previewPdfUrl.value = ''
  previewVisible.value = true
}

// 删除发票
function onDelete(invoice: InvoiceItem): void {
  emit('delete', invoice)
}
</script>

<style scoped>
.invoice-table-wrapper {
  width: 100%;
  overflow: visible;
}

.invoice-table {
  margin-top: 8px;
  width: 100%;
}

/* 强制表格完整展示，不使用滚动 */
.invoice-table :deep(.el-table__body-wrapper) {
  overflow: visible !important;
  max-height: none !important;
  height: auto !important;
}

.invoice-table :deep(.el-table__inner-wrapper) {
  overflow: visible !important;
  max-height: none !important;
  height: auto !important;
}

.invoice-table :deep(.el-scrollbar__wrap) {
  overflow: visible !important;
  max-height: none !important;
}

.invoice-table :deep(.el-scrollbar__view) {
  overflow: visible !important;
}

.invoice-table :deep(.el-table__header-wrapper th) {
  background: #ffffff;
  color: #303133;
  font-weight: 600;
}

.invoice-table :deep(.el-table__body tr:hover > td) {
  background-color: #ffffff !important;
}

.invoice-table :deep(.el-table__header-wrapper th .cell) {
  white-space: nowrap;
  overflow: visible;
  text-overflow: clip;
}

.invoice-table :deep(.el-table__body) {
  width: 100% !important;
}

.invoice-table :deep(.el-table__cell) {
  vertical-align: middle;
  padding: 8px 0;
}

.thumbnail-wrapper {
  display: inline-block;
  cursor: pointer;
}

.thumbnail-wrapper:hover .pdf-icon {
  opacity: 0.8;
  transform: scale(1.05);
  transition: all 0.2s;
}

.pdf-icon {
  width: 50px;
  height: 50px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  border-radius: 4px;
  color: #f56c6c;
  transition: all 0.2s;
  padding: 4px;
}

.image-thumbnail {
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  overflow: hidden;
  background: #f5f7fa;
}

.thumbnail-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}

.preview-container {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100vw;
  height: 100vh;
  background: #000;
  margin: 0;
  padding: 0;
}

.preview-image {
  max-width: 90vw;
  max-height: 90vh;
  width: auto;
  height: auto;
  object-fit: contain;
}

.preview-pdf {
  width: 90vw;
  height: 90vh;
  border: none;
}

/* 移除对话框所有内边距和边距 */
.preview-dialog :deep(.el-dialog) {
  margin: 0 !important;
  padding: 0 !important;
  border-radius: 0 !important;
}

.preview-dialog :deep(.el-dialog__header) {
  display: none !important;
}

.preview-dialog :deep(.el-dialog__body) {
  padding: 0 !important;
  margin: 0 !important;
  height: 100vh !important;
  overflow: hidden !important;
}

.preview-dialog :deep(.el-dialog__close) {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 50%;
  width: 44px;
  height: 44px;
  color: #fff;
  font-size: 20px;
}

.preview-dialog :deep(.el-dialog__close:hover) {
  background: rgba(0, 0, 0, 0.8);
}

.invoice-total {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  padding: 12px 16px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-top: none;
  border-radius: 0 0 4px 4px;
}

.invoice-total.amount-warning {
  background: #fef0f0;
  border-color: #fbc4c4;
}

.invoice-total .total-label {
  font-weight: 600;
  color: #303133;
  margin-right: 60px;
}

.invoice-total .total-amount {
  font-weight: 600;
  font-size: 16px;
}

.invoice-total .amount-tip {
  margin-left: 16px;
  font-size: 13px;
  color: #f56c6c;
}

.deducted-text {
  color: #f56c6c;
  font-weight: 500;
}

.actual-amount {
  color: #67c23a;
  font-weight: 500;
}

.deducted-info {
  margin-left: 12px;
  font-size: 14px;
  color: #f56c6c;
}

/* 核减提示信息样式 */
.deduction-notice {
  margin-top: 16px;
  padding: 16px;
  background: #fef0f0;
  border: 1px solid #fde2e2;
  border-radius: 4px;
}

.deduction-notice .notice-detail-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.deduction-notice .notice-detail-row {
  font-size: 13px;
  line-height: 1.6;
}

.deduction-notice .detail-text {
  color: #606266;
}

.deduction-notice .detail-limit {
  color: #909399;
  font-size: 12px;
  margin-left: 4px;
}

.deduction-notice .deduction-row {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed #fde2e2;
}

.deduction-notice .actual-row {
  font-weight: 600;
}

.deduction-notice .deducted-highlight {
  color: #f56c6c;
  font-weight: 600;
}

.deduction-notice .actual-highlight {
  color: #67c23a;
  font-weight: 600;
  font-size: 14px;
}
</style>
