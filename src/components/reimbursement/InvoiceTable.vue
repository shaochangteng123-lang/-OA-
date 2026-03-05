<template>
  <div class="invoice-table-wrapper">
    <el-table :data="invoiceList" border style="width: 100%" class="invoice-table">
      <el-table-column prop="id" label="序号" width="80" align="center">
        <template #default="{ $index }">
          {{ $index + 1 }}
        </template>
      </el-table-column>
      <el-table-column prop="amount" label="报销金额" width="120" align="center">
        <template #default="{ row }">
          {{ row.amount }}
        </template>
      </el-table-column>
      <el-table-column prop="invoiceDate" label="开票日期" align="center">
        <template #default="{ row }">
          {{ formatDateToChinese(row.invoiceDate) }}
        </template>
      </el-table-column>
      <el-table-column prop="invoiceNumber" label="发票号码" align="center">
        <template #default="{ row }">
          {{ row.invoiceNumber || '' }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80" align="center">
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
      <span v-if="warningText" class="amount-tip">
        {{ warningText }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Delete } from '@element-plus/icons-vue'
import type { InvoiceItem } from '@/composables/reimbursement/useInvoice'

// Props
const props = withDefaults(defineProps<{
  invoiceList: InvoiceItem[]
  readonly?: boolean
  themeColor?: string
  amountThreshold?: number
  showThresholdWarning?: boolean
}>(), {
  readonly: false,
  themeColor: '#409eff',
  amountThreshold: 0,
  showThresholdWarning: false,
})

// Emits
const emit = defineEmits<{
  (e: 'delete', invoice: InvoiceItem): void
}>()

// 计算总金额
const totalAmount = computed(() => {
  return props.invoiceList.reduce((sum, item) => sum + (item.amount || 0), 0)
})

// 是否显示金额警告
const showAmountWarning = computed(() => {
  if (!props.showThresholdWarning || !props.amountThreshold) return false
  return totalAmount.value > 0 && totalAmount.value <= props.amountThreshold
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

// 删除发票
function onDelete(invoice: InvoiceItem): void {
  emit('delete', invoice)
}
</script>

<style scoped>
.invoice-table-wrapper {
  width: 100%;
}

.invoice-table {
  margin-top: 8px;
}

.invoice-table :deep(.el-table__header-wrapper th) {
  background: #f5f7fa;
  color: #303133;
  font-weight: 600;
}

.invoice-total {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  padding: 12px 16px;
  background: #f5f7fa;
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
</style>
