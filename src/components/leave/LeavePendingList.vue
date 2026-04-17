<template>
  <div class="leave-pending-list">
    <div class="section-header">
      <span class="section-title">待我审批</span>
      <el-badge :value="list.length" :max="99" :hidden="list.length === 0">
        <el-button size="small" text @click="fetchList">
          <el-icon><Refresh /></el-icon>
        </el-button>
      </el-badge>
    </div>

    <div v-if="loading" class="loading-state">
      <el-skeleton :rows="3" animated />
    </div>

    <div v-else-if="list.length === 0" class="empty-state">
      <el-icon class="empty-icon"><CircleCheck /></el-icon>
      <p>暂无待审批申请</p>
    </div>

    <div v-else class="pending-cards">
      <div
        v-for="item in list"
        :key="item.id"
        class="pending-card"
      >
        <div class="card-header">
          <span class="applicant-name">{{ item.applicant_name }}</span>
          <span class="leave-type">{{ item.leave_type_name }}</span>
        </div>
        <div class="card-dates">
          {{ item.start_date }} {{ item.start_half === 'morning' ? '上午' : '下午' }}
          ~
          {{ item.end_date }} {{ item.end_half === 'morning' ? '上午' : '下午' }}
          <span class="days-badge">{{ item.total_days }}天</span>
        </div>
        <div class="card-reason">{{ item.reason }}</div>
        <div class="card-actions">
          <el-button size="small" type="success" plain @click="handleApprove(item)">
            <el-icon><Check /></el-icon> 通过
          </el-button>
          <el-button size="small" type="danger" plain @click="handleReject(item)">
            <el-icon><Close /></el-icon> 驳回
          </el-button>
          <el-button size="small" text @click="handleView(item)">详情</el-button>
        </div>
        <div class="card-meta">
          提交时间：{{ formatDate(item.submitted_at) }}
        </div>
      </div>
    </div>

    <!-- 驳回理由对话框 -->
    <el-dialog v-model="rejectDialogVisible" title="填写驳回理由" width="400px" :close-on-click-modal="false">
      <el-input
        v-model="rejectReason"
        type="textarea"
        :rows="4"
        placeholder="请填写驳回理由（必填）..."
        maxlength="500"
        show-word-limit
        autofocus
      />
      <template #footer>
        <el-button @click="rejectDialogVisible = false">取消</el-button>
        <el-button type="danger" :loading="actionLoading" :disabled="!rejectReason.trim()" @click="confirmReject">
          确认驳回
        </el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      :title="detailRequest ? `${detailRequest.applicant_name} 的请假申请` : '请假申请详情'"
      size="480px"
    >
      <LeaveApprovalTimeline v-if="detailRequest" :request="detailRequest" :is-owner="false" />
      <el-skeleton v-else :rows="6" animated style="padding:16px" />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Check, Close, CircleCheck } from '@element-plus/icons-vue'
import LeaveApprovalTimeline from './LeaveApprovalTimeline.vue'
import { getPendingRequests, approveRequest, rejectRequest, getRequestDetail, type LeaveRequest, type LeaveRequestDetail } from '@/utils/leaveApi'

const emit = defineEmits<{
  (e: 'approved'): void
}>()

const list = ref<LeaveRequest[]>([])
const loading = ref(false)
const actionLoading = ref(false)
const rejectDialogVisible = ref(false)
const rejectReason = ref('')
const currentRejectItem = ref<LeaveRequest | null>(null)
const drawerVisible = ref(false)
const detailRequest = ref<LeaveRequestDetail | null>(null)

async function fetchList() {
  loading.value = true
  try {
    list.value = await getPendingRequests()
  } catch {
    // 静默处理
  } finally {
    loading.value = false
  }
}

async function handleApprove(item: LeaveRequest) {
  actionLoading.value = true
  try {
    await approveRequest(item.id)
    ElMessage.success(`已批准 ${item.applicant_name} 的请假申请`)
    fetchList()
    emit('approved')
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '操作失败')
  } finally {
    actionLoading.value = false
  }
}

function handleReject(item: LeaveRequest) {
  currentRejectItem.value = item
  rejectReason.value = ''
  rejectDialogVisible.value = true
}

async function confirmReject() {
  if (!currentRejectItem.value || !rejectReason.value.trim()) return
  actionLoading.value = true
  try {
    await rejectRequest(currentRejectItem.value.id, rejectReason.value.trim())
    ElMessage.success('已驳回申请')
    rejectDialogVisible.value = false
    fetchList()
    emit('approved')
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '操作失败')
  } finally {
    actionLoading.value = false
  }
}

async function handleView(item: LeaveRequest) {
  drawerVisible.value = true
  detailRequest.value = null
  try {
    detailRequest.value = await getRequestDetail(item.id)
  } catch {
    ElMessage.error('获取详情失败')
    drawerVisible.value = false
  }
}

function formatDate(iso: string): string {
  return iso ? iso.substring(0, 10) : ''
}

onMounted(fetchList)
defineExpose({ refresh: fetchList })
</script>

<style scoped>
.leave-pending-list {
  min-height: 100px;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.loading-state { padding: 8px 0; }
.empty-state {
  text-align: center;
  padding: 24px 0;
  color: #c0c4cc;
}
.empty-icon { font-size: 32px; margin-bottom: 6px; }
.empty-state p { margin: 0; font-size: 13px; }
.pending-cards { display: flex; flex-direction: column; gap: 10px; }
.pending-card {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.applicant-name {
  font-weight: 700;
  font-size: 14px;
  color: #303133;
}
.leave-type {
  background: #ecf5ff;
  color: #409eff;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}
.card-dates {
  font-size: 13px;
  color: #606266;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.days-badge {
  background: #f0f9eb;
  color: #67c23a;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}
.card-reason {
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.card-meta {
  font-size: 11px;
  color: #c0c4cc;
}
</style>
