<template>
  <div class="leave-request-list">
    <!-- 状态 Tab -->
    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="全部" name="" />
      <el-tab-pane label="审批中" name="pending" />
      <el-tab-pane label="已批准" name="approved" />
      <el-tab-pane label="已驳回" name="rejected" />
      <el-tab-pane label="已撤销" name="cancelled" />
    </el-tabs>

    <!-- 表格 -->
    <el-table
      v-loading="loading"
      :data="list"
      border
      size="small"
      style="width: 100%"
      empty-text="暂无申请记录"
    >
      <el-table-column label="申请编号" prop="request_no" width="160" align="center" />
      <el-table-column label="假期类型" prop="leave_type_name" width="90" align="center" />
      <el-table-column label="时间段" min-width="200" align="center">
        <template #default="{ row }">
          {{ row.start_date }}
          {{ row.start_half === 'morning' ? '上午' : '下午' }}
          ~
          {{ row.end_date }}
          {{ row.end_half === 'morning' ? '上午' : '下午' }}
        </template>
      </el-table-column>
      <el-table-column label="天数" prop="total_days" width="70" align="center" />
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)" size="small">
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="110" align="center">
        <template #default="{ row }">{{ formatDate(row.submitted_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160" align="center" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="handleView(row)">
            查看
          </el-button>
          <el-button
            v-if="row.status === 'pending'"
            link type="warning" size="small"
            @click="handleCancel(row)"
          >
            撤销
          </el-button>
          <el-button
            v-if="row.status === 'rejected'"
            link type="primary" size="small"
            @click="handleResubmit(row)"
          >
            修改重提
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pagination-wrap">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="fetchList"
        @size-change="fetchList"
      />
    </div>

    <!-- 详情抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      :title="detailRequest ? `请假申请详情 - ${detailRequest.request_no}` : '请假申请详情'"
      size="480px"
      direction="rtl"
    >
      <LeaveApprovalTimeline
        v-if="detailRequest"
        :request="detailRequest"
        :is-owner="true"
        @resubmit="handleResubmitFromDetail"
      />
      <el-skeleton v-else :rows="6" animated style="padding: 16px" />
    </el-drawer>

    <!-- 修改重提对话框 -->
    <el-dialog
      v-model="resubmitVisible"
      title="修改并重新提交"
      width="600px"
      :close-on-click-modal="false"
    >
      <LeaveResubmitForm
        v-if="resubmitRequest"
        :original-request="resubmitRequest"
        @submitted="handleResubmitSuccess"
        @cancel="resubmitVisible = false"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import LeaveApprovalTimeline from './LeaveApprovalTimeline.vue'
import LeaveResubmitForm from './LeaveResubmitForm.vue'
import { getMyRequests, getRequestDetail, cancelRequest, type LeaveRequest, type LeaveRequestDetail } from '@/utils/leaveApi'

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

const activeTab = ref('')
const list = ref<LeaveRequest[]>([])
const loading = ref(false)
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const drawerVisible = ref(false)
const detailRequest = ref<LeaveRequestDetail | null>(null)
const resubmitVisible = ref(false)
const resubmitRequest = ref<LeaveRequest | null>(null)

function statusLabel(status: string): string {
  const map: Record<string, string> = { pending: '审批中', approved: '已批准', rejected: '已驳回', cancelled: '已撤销' }
  return map[status] || status
}

function statusTagType(status: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' | undefined {
  const map: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'info'
  }
  return map[status] || undefined
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return iso.substring(0, 10)
}

function handleTabChange() {
  currentPage.value = 1
  fetchList()
}

async function fetchList() {
  loading.value = true
  try {
    const result = await getMyRequests({
      status: activeTab.value || undefined,
      page: currentPage.value,
      pageSize: pageSize.value,
    })
    list.value = result.list
    total.value = result.total
  } catch {
    ElMessage.error('获取申请列表失败')
  } finally {
    loading.value = false
  }
}

async function handleView(row: LeaveRequest) {
  drawerVisible.value = true
  detailRequest.value = null
  try {
    detailRequest.value = await getRequestDetail(row.id)
  } catch {
    ElMessage.error('获取申请详情失败')
    drawerVisible.value = false
  }
}

async function handleCancel(row: LeaveRequest) {
  await ElMessageBox.confirm('确定要撤销这条请假申请吗？', '提示', {
    confirmButtonText: '确定撤销',
    cancelButtonText: '取消',
    type: 'warning',
  })
  try {
    await cancelRequest(row.id)
    ElMessage.success('已撤销')
    fetchList()
    emit('refresh')
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '撤销失败')
  }
}

function handleResubmit(row: LeaveRequest) {
  resubmitRequest.value = row
  resubmitVisible.value = true
}

function handleResubmitFromDetail(id: string) {
  drawerVisible.value = false
  const row = list.value.find(r => r.id === id)
  if (row) handleResubmit(row)
}

function handleResubmitSuccess() {
  resubmitVisible.value = false
  resubmitRequest.value = null
  fetchList()
  emit('refresh')
}

onMounted(fetchList)

defineExpose({ refresh: fetchList })
</script>

<style scoped>
.leave-request-list {
  margin-top: 8px;
}
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
