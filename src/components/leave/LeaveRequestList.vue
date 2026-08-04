<template>
  <div class="leave-request-list">
    <!-- 状态 Tab -->
    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="全部" name="" />
      <el-tab-pane label="审批中" name="pending" />
      <el-tab-pane label="草稿" name="draft" />
      <el-tab-pane label="已批准" name="approved" />
      <el-tab-pane label="已驳回" name="rejected" />
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
      <el-table-column
        type="index"
        label="序号"
        width="60"
        align="center"
        :index="getRowIndex"
      />
      <el-table-column label="申请编号" width="170" align="center">
        <template #default="{ row }">
          <div>{{ row.request_no }}</div>
          <el-tag
            v-if="row.application_kind !== 'normal'"
            size="small"
            effect="plain"
            :type="applicationKindTagType(row.application_kind)"
          >
            {{ applicationKindLabel(row) }}
          </el-tag>
          <div v-if="row.parent_request_no" class="parent-request-no">
            主申请 {{ row.parent_request_no }}
          </div>
        </template>
      </el-table-column>
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
      <el-table-column label="操作" width="230" align="center" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="handleView(row)">
            查看
          </el-button>
          <el-button
            v-if="row.status === 'pending'"
            link type="warning" size="small"
            @click="handleCancel(row)"
          >
            撤回
          </el-button>
          <el-button
            v-if="row.status === 'rejected' || row.status === 'draft'"
            link type="primary" size="small"
            @click="handleResubmit(row)"
          >
            {{ row.status === 'draft' ? '重新提交' : '修改重提' }}
          </el-button>
          <el-button
            v-if="row.status === 'draft'"
            link type="danger" size="small"
            @click="handleDeleteDraft(row)"
          >
            删除
          </el-button>
          <el-button
            v-if="row.status === 'approved'"
            link
            type="primary"
            size="small"
            @click="openRelatedRequest(row, 'extension')"
          >
            续假
          </el-button>
          <el-button
            v-if="row.status === 'approved'"
            link
            type="warning"
            size="small"
            @click="openRelatedRequest(row, 'supplement')"
          >
            补假
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
      @closed="resetDetailNavigation"
    >
      <div
        v-if="detailRequest"
        v-loading="detailLoading"
        class="detail-drawer-content"
      >
        <div v-if="detailHistory.length > 0" class="detail-navigation">
          <el-button
            link
            type="primary"
            :icon="ArrowLeft"
            @click="handleDetailBack"
          >
            返回上一申请
          </el-button>
          <span>正在查看 {{ detailRequest.request_no }}</span>
        </div>
        <LeaveApprovalTimeline
          :request="detailRequest"
          :is-owner="true"
          @resubmit="handleResubmitFromDetail"
          @view-request="handleViewRelatedRequest"
        />
      </div>
      <el-skeleton v-else :rows="6" animated style="padding: 16px" />
    </el-drawer>

    <!-- 修改重提对话框 -->
    <el-dialog
      v-model="resubmitVisible"
      :title="resubmitRequest?.status === 'draft' ? '编辑草稿并重新提交' : '修改并重新提交'"
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

    <el-dialog
      v-model="relatedVisible"
      :title="relatedType === 'extension' ? '申请续假' : '申请补假'"
      width="min(780px, 94vw)"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <LeaveRelatedRequestForm
        v-if="relatedRequest"
        :source-request="relatedRequest"
        :relation-type="relatedType"
        @submitted="handleRelatedSuccess"
        @cancel="relatedVisible = false"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import LeaveApprovalTimeline from './LeaveApprovalTimeline.vue'
import LeaveRelatedRequestForm from './LeaveRelatedRequestForm.vue'
import LeaveResubmitForm from './LeaveResubmitForm.vue'
import {
  getMyRequests,
  getRequestDetail,
  cancelRequest,
  deleteDraftRequest,
  type LeaveRequest,
  type LeaveRequestDetail,
} from '@/utils/leaveApi'

const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'rejected-viewed', id: string): void
}>()

const activeTab = ref('')
const list = ref<LeaveRequest[]>([])
const loading = ref(false)
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const drawerVisible = ref(false)
const detailRequest = ref<LeaveRequestDetail | null>(null)
const detailHistory = ref<LeaveRequestDetail[]>([])
const detailLoading = ref(false)
const resubmitVisible = ref(false)
const resubmitRequest = ref<LeaveRequest | null>(null)
const relatedVisible = ref(false)
const relatedRequest = ref<LeaveRequest | null>(null)
const relatedType = ref<'extension' | 'supplement'>('extension')

function getRowIndex(index: number): number {
  return (currentPage.value - 1) * pageSize.value + index + 1
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: '草稿', pending: '审批中', approved: '已批准', rejected: '已驳回', cancelled: '已撤销'
  }
  return map[status] || status
}

function statusTagType(status: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' | undefined {
  const map: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    draft: 'info', pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'info'
  }
  return map[status] || undefined
}

function applicationKindLabel(
  request: Pick<LeaveRequest, 'application_kind' | 'combination_group_id'>
): string {
  if (request.combination_group_id && request.application_kind === 'extension') {
    return '组合续假'
  }
  if (request.combination_group_id && request.application_kind === 'supplement') {
    return '组合补假'
  }
  const labels: Record<LeaveRequest['application_kind'], string> = {
    normal: '普通请假',
    combined: '组合请假',
    extension: '续假',
    supplement: '补假',
  }
  return labels[request.application_kind] || '普通请假'
}

function applicationKindTagType(
  kind: LeaveRequest['application_kind']
): 'primary' | 'success' | 'warning' | 'info' {
  const types: Record<LeaveRequest['application_kind'], 'primary' | 'success' | 'warning' | 'info'> = {
    normal: 'info',
    combined: 'primary',
    extension: 'success',
    supplement: 'warning',
  }
  return types[kind] || 'info'
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
  detailHistory.value = []
  detailRequest.value = null
  detailLoading.value = true
  try {
    detailRequest.value = await getRequestDetail(row.id)
    if (row.status === 'rejected') {
      emit('rejected-viewed', row.id)
    }
  } catch {
    ElMessage.error('获取申请详情失败')
    drawerVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

async function handleViewRelatedRequest(id: string) {
  if (!detailRequest.value || detailRequest.value.id === id || detailLoading.value) return
  const currentRequest = detailRequest.value
  detailLoading.value = true
  try {
    const relatedRequest = await getRequestDetail(id)
    detailHistory.value.push(currentRequest)
    detailRequest.value = relatedRequest
  } catch {
    ElMessage.error('获取关联申请详情失败')
  } finally {
    detailLoading.value = false
  }
}

function handleDetailBack() {
  const previousRequest = detailHistory.value.pop()
  if (previousRequest) detailRequest.value = previousRequest
}

function resetDetailNavigation() {
  detailHistory.value = []
  detailRequest.value = null
}

async function handleCancel(row: LeaveRequest) {
  try {
    await ElMessageBox.confirm('撤回后申请将转为草稿，并释放本次占用的假期余额。', '确认撤回', {
      confirmButtonText: '撤回并保存草稿',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await cancelRequest(row.id)
    ElMessage.success('已撤回并保存为草稿')
    await fetchList()
    emit('refresh')
  } catch (err: any) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err?.response?.data?.message || '撤回失败')
  }
}

async function handleDeleteDraft(row: LeaveRequest) {
  try {
    await ElMessageBox.confirm(
      '删除后该申请的全部历史、审批记录和附件将永久清除，且无法恢复。',
      '永久删除草稿',
      {
        confirmButtonText: '永久删除',
        cancelButtonText: '取消',
        type: 'error',
      }
    )
    await deleteDraftRequest(row.id)
    ElMessage.success('草稿已永久删除')
    await fetchList()
    emit('refresh')
  } catch (err: any) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err?.response?.data?.message || '删除草稿失败')
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

function openRelatedRequest(row: LeaveRequest, type: 'extension' | 'supplement') {
  relatedRequest.value = row
  relatedType.value = type
  relatedVisible.value = true
}

async function handleRelatedSuccess() {
  relatedVisible.value = false
  relatedRequest.value = null
  await fetchList()
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
.parent-request-no {
  margin-top: 3px;
  color: #909399;
  font-size: 11px;
}
.detail-drawer-content {
  min-height: 120px;
}
.detail-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebeef5;
}
.detail-navigation span {
  overflow: hidden;
  color: #909399;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
