<template>
  <div class="leave-page">
    <!-- 假期余额卡片 -->
    <el-card class="balance-card-wrapper" shadow="never">
      <template #header>
        <span class="card-title">我的假期余额（{{ currentYear }}年）</span>
      </template>
      <LeaveBalancePanel ref="balancePanelRef" />
    </el-card>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 左侧：申请表单 -->
      <el-card class="form-card" shadow="never">
        <template #header>
          <span class="card-title">发起请假申请</span>
        </template>
        <LeaveRequestForm @submitted="handleSubmitted" />
      </el-card>

      <!-- 右侧：待我审批（仅管理员/经理可见） -->
      <el-card v-if="canApprove" class="pending-card" shadow="never">
        <template #header>
          <span class="card-title">待我审批</span>
        </template>
        <LeavePendingList ref="pendingListRef" @approved="handleApproved" />
      </el-card>
    </div>

    <!-- 我的申请记录 -->
    <el-card class="list-card" shadow="never">
      <template #header>
        <span class="card-title">我的申请记录</span>
      </template>
      <LeaveRequestList ref="requestListRef" @refresh="handleRefresh" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import LeaveBalancePanel from '@/components/leave/LeaveBalancePanel.vue'
import LeaveRequestForm from '@/components/leave/LeaveRequestForm.vue'
import LeaveRequestList from '@/components/leave/LeaveRequestList.vue'
import LeavePendingList from '@/components/leave/LeavePendingList.vue'

const authStore = useAuthStore()
const balancePanelRef = ref()
const requestListRef = ref()
const pendingListRef = ref()

const currentYear = new Date().getFullYear()

const canApprove = computed(() => {
  const role = authStore.user?.role
  return role === 'admin' || role === 'super_admin' || role === 'general_manager'
})

function handleSubmitted() {
  balancePanelRef.value?.refresh()
  requestListRef.value?.refresh()
}

function handleApproved() {
  balancePanelRef.value?.refresh()
  requestListRef.value?.refresh()
}

function handleRefresh() {
  balancePanelRef.value?.refresh()
  pendingListRef.value?.refresh()
}
</script>

<style scoped>
.leave-page {
  margin: -24px -45px;
  padding: 16px 16px 16px 16px;
  width: calc(100% + 90px);
  box-sizing: border-box;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.balance-card-wrapper {
  margin-bottom: 16px;
}
.main-content {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 16px;
  margin-bottom: 16px;
}
@media (max-width: 1100px) {
  .main-content {
    grid-template-columns: 1fr;
  }
}
.form-card, .pending-card, .list-card {
  height: fit-content;
}
</style>

