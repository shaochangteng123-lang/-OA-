<template>
  <div class="leave-balance-panel">
    <div v-if="loading" class="balance-loading">
      <el-skeleton :rows="1" animated />
    </div>
    <div v-else class="balance-cards">
      <div
        v-for="balance in balances"
        :key="balance.leave_type_code"
        class="balance-card"
        :class="{ 'balance-card--warning': isLow(balance) }"
      >
        <div class="balance-card__name">{{ balance.leave_type_name }}</div>
        <div class="balance-card__value">
          <template v-if="!balance.requires_balance_check">
            <span class="value-used">{{ balance.used_days }}</span>
            <span class="value-unit">天已用</span>
          </template>
          <template v-else>
            <span class="value-available">{{ balance.available_days }}</span>
            <span class="value-separator">/</span>
            <span class="value-total">{{ balance.total_days }}</span>
            <span class="value-unit">天</span>
          </template>
        </div>
        <div v-if="balance.pending_days > 0" class="balance-card__pending">
          审批中: {{ balance.pending_days }}天
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getMyBalances, type LeaveBalance } from '@/utils/leaveApi'

const balances = ref<LeaveBalance[]>([])
const loading = ref(true)

// 余额不足提示（低于总额的20%且可用少于1天）
function isLow(balance: LeaveBalance): boolean {
  if (!balance.requires_balance_check || balance.total_days === 0) return false
  return balance.available_days < 1
}

async function fetchBalances() {
  loading.value = true
  try {
    balances.value = await getMyBalances()
  } catch {
    // 静默处理
  } finally {
    loading.value = false
  }
}

onMounted(fetchBalances)

// 暴露刷新方法
defineExpose({ refresh: fetchBalances })
</script>

<style scoped>
.leave-balance-panel {
  padding: 12px 0;
}
.balance-loading {
  padding: 0 16px;
}
.balance-cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.balance-card {
  background: #f8f9fa;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px 16px;
  min-width: 110px;
  text-align: center;
  transition: box-shadow 0.2s;
}
.balance-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.balance-card--warning {
  background: #fff7e6;
  border-color: #faad14;
}
.balance-card__name {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}
.balance-card__value {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.value-available {
  font-size: 20px;
  color: #409eff;
}
.value-separator, .value-total {
  color: #909399;
  font-size: 14px;
}
.value-unit {
  font-size: 12px;
  color: #909399;
  margin-left: 2px;
}
.value-used {
  font-size: 20px;
  color: #909399;
}
.balance-card__pending {
  font-size: 11px;
  color: #e6a23c;
  margin-top: 4px;
}
</style>
