<template>
  <div class="leave-page">
    <el-alert
      v-if="myApprovedCount > 0"
      type="success"
      :closable="true"
      show-icon
      class="approved-alert"
      :title="`您有 ${myApprovedCount} 条请假申请已审批通过，请在“我的申请记录”中查看`"
      @close="handleApprovedNoticeClose"
    />

    <el-alert
      v-if="myRejectedCount > 0"
      type="error"
      :closable="false"
      show-icon
      class="rejected-alert"
      :title="`您有 ${myRejectedCount} 条请假申请已被驳回，请查看驳回原因并修改重提`"
    />

    <!-- 假期余额卡片 -->
    <el-card class="balance-card-wrapper" shadow="never">
      <template #header>
        <span class="card-title">我的假期余额（{{ currentYear }}年）</span>
      </template>
      <LeaveBalancePanel ref="balancePanelRef" />
    </el-card>

    <div class="my-leave-workspace">
      <!-- 申请表单 -->
      <el-card class="form-card" shadow="never">
        <template #header>
          <span class="card-title">发起请假申请</span>
        </template>
        <LeaveRequestForm @submitted="handleSubmitted" />
      </el-card>

      <!-- 我的申请记录 -->
      <el-card class="list-card" shadow="never">
        <template #header>
          <span class="card-title">我的申请记录</span>
        </template>
        <LeaveRequestList
          ref="requestListRef"
          @refresh="handleRefresh"
          @rejected-viewed="handleRejectedNoticeViewed"
        />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { usePendingStore } from '@/stores/pending'
import {
  markApprovedLeaveNoticesRead,
  markRejectedLeaveNoticeRead,
} from '@/utils/leaveApi'
import LeaveBalancePanel from '@/components/leave/LeaveBalancePanel.vue'
import LeaveRequestForm from '@/components/leave/LeaveRequestForm.vue'
import LeaveRequestList from '@/components/leave/LeaveRequestList.vue'

const pendingStore = usePendingStore()
const balancePanelRef = ref()
const requestListRef = ref()

const currentYear = new Date().getFullYear()
const myRejectedCount = computed(() => pendingStore.counts.myLeaveRejected || 0)
const myApprovedCount = computed(() => pendingStore.counts.myLeaveApproved || 0)

async function handleApprovedNoticeClose() {
  try {
    await markApprovedLeaveNoticesRead()
    await pendingStore.refreshPendingCounts()
  } catch {
    ElMessage.error('标记审批通过提醒已读失败')
  }
}

async function handleRejectedNoticeViewed(id: string) {
  try {
    pendingStore.counts.myLeaveRejected = await markRejectedLeaveNoticeRead(id)
  } catch {
    ElMessage.error('标记驳回提醒已读失败')
  }
}

async function handleSubmitted() {
  balancePanelRef.value?.refresh()
  requestListRef.value?.refresh()
  await pendingStore.refreshPendingCounts()
}

async function handleRefresh() {
  balancePanelRef.value?.refresh()
  await pendingStore.refreshPendingCounts()
}

watch([myApprovedCount, myRejectedCount], ([approved, rejected], [previousApproved, previousRejected]) => {
  if (approved > previousApproved || rejected > previousRejected) {
    balancePanelRef.value?.refresh()
    requestListRef.value?.refresh()
  }
})
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
.approved-alert,
.rejected-alert {
  margin-bottom: 16px;
}
.form-card {
  margin-bottom: 16px;
}
.form-card,
.list-card {
  height: fit-content;
}
</style>
