<template>
  <div class="gm-probation-approval">
    <!-- 状态筛选标签 -->
    <div class="filter-bar">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <el-tab-pane label="待审批" name="submitted" />
        <el-tab-pane label="本月已审批" name="approved" />
        <el-tab-pane label="全部查询" name="" />
      </el-tabs>
    </div>

    <!-- 全部查询搜索栏 -->
    <div v-if="activeTab === ''" class="search-bar">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="姓名">
          <el-input v-model="searchForm.name" placeholder="全部" clearable style="width: 130px" />
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="searchForm.department" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="dept in departmentList" :key="dept" :label="dept" :value="dept" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" placeholder="全部" clearable style="width: 130px">
            <el-option label="实习期" value="pending" />
            <el-option label="待审批" value="submitted" />
            <el-option label="已转正" value="approved" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button @click="handleResetSearch">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-table :data="displayList" stripe empty-text="暂无转正记录">
      <el-table-column label="序号" width="60" align="center">
        <template #default="{ $index }">{{ $index + 1 }}</template>
      </el-table-column>
      <el-table-column label="申请人" min-width="100" align="center">
        <template #default="{ row }">
          <div class="applicant-cell">
            <el-avatar :size="28"><el-icon><User /></el-icon></el-avatar>
            <span>{{ row.employee_name }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="部门" min-width="100" align="center">
        <template #default="{ row }">{{ row.employee_department || '-' }}</template>
      </el-table-column>
      <el-table-column label="职位" min-width="100" align="center">
        <template #default="{ row }">{{ row.employee_position || '-' }}</template>
      </el-table-column>
      <el-table-column label="入职日期" min-width="100" align="center">
        <template #default="{ row }">{{ formatDateOnly(row.hire_date) }}</template>
      </el-table-column>
      <el-table-column label="试用期截止" min-width="100" align="center">
        <template #default="{ row }">{{ formatDateOnly(row.probation_end_date) }}</template>
      </el-table-column>
      <el-table-column label="剩余天数" min-width="90" align="center">
        <template #default="{ row }">
          <span :class="{ 'text-danger': getRemainingDaysNum(row.probation_end_date) < 0, 'text-warning': getRemainingDaysNum(row.probation_end_date) <= 30 && getRemainingDaysNum(row.probation_end_date) >= 0 }">
            {{ getRemainingDaysText(row.probation_end_date) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="状态" min-width="85" align="center">
        <template #default="{ row }">
          <el-tag :type="getProbationStatusType(row.status)" size="small">
            {{ getProbationStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" min-width="130" align="center">
        <template #default="{ row }">{{ row.submit_time ? formatDateTime(row.submit_time) : '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" min-width="240" align="center">
        <template #default="{ row }">
          <div class="action-buttons">
            <!-- 虚拟记录（未提交过转正申请的实习期员工）不显示操作按钮 -->
            <template v-if="isVirtualRecord(row)">
              <span class="no-action-text">未申请转正</span>
            </template>
            <template v-else>
              <el-button type="primary" size="small" :icon="View" @click="handleViewProbation(row)">
                详情
              </el-button>
              <!-- 已提交/已审批/已驳回都显示审批流程按钮 -->
              <el-button
                v-if="['submitted', 'approved', 'rejected'].includes(row.status)"
                type="info"
                size="small"
                :icon="List"
                @click="handleViewApprovalFlow(row)"
              >
                审批流程
              </el-button>
              <template v-if="row.status === 'submitted'">
                <el-button type="success" size="small" :icon="Check" @click="handleApproveProbation(row)">
                  通过
                </el-button>
                <el-button type="danger" size="small" :icon="Close" @click="handleRejectProbation(row)">
                  驳回
                </el-button>
              </template>
            </template>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- 详情弹窗 -->
    <el-dialog v-model="detailVisible" title="转正申请详情" width="700px" :close-on-click-modal="false">
      <div v-if="detailRow">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{ detailRow.employee_name }}</el-descriptions-item>
          <el-descriptions-item label="部门">{{ detailRow.employee_department || '-' }}</el-descriptions-item>
          <el-descriptions-item label="职位">{{ detailRow.employee_position || '-' }}</el-descriptions-item>
          <el-descriptions-item label="手机">{{ detailRow.employee_mobile || '-' }}</el-descriptions-item>
          <el-descriptions-item label="入职日期">{{ formatDateOnly(detailRow.hire_date) }}</el-descriptions-item>
          <el-descriptions-item label="试用期截止">{{ formatDateOnly(detailRow.probation_end_date) }}</el-descriptions-item>
          <el-descriptions-item label="剩余天数">
            <span :class="{ 'text-danger': getRemainingDaysNum(detailRow.probation_end_date) < 0, 'text-warning': getRemainingDaysNum(detailRow.probation_end_date) <= 30 && getRemainingDaysNum(detailRow.probation_end_date) >= 0 }">
              {{ getRemainingDaysText(detailRow.probation_end_date) }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="getProbationStatusType(detailRow.status)" size="small">
              {{ getProbationStatusText(detailRow.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{ detailRow.submit_time ? formatDateTime(detailRow.submit_time) : '-' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detailRow.application_comment" label="申请说明" :span="2">
            {{ detailRow.application_comment }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detailRow.approve_time" label="审批时间" :span="2">
            {{ formatDateTime(detailRow.approve_time) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detailRow.approver_comment" label="审批意见" :span="2">
            {{ detailRow.approver_comment }}
          </el-descriptions-item>
        </el-descriptions>
        <div style="margin-top: 20px;">
          <div style="font-weight: 600; margin-bottom: 10px; color: #303133;">转正申请文件</div>
          <el-table v-if="detailRow.documents && detailRow.documents.length > 0" :data="detailRow.documents" stripe size="small">
            <el-table-column prop="file_name" label="文件名" />
            <el-table-column prop="uploaded_by_name" label="上传人" width="90" align="center" />
            <el-table-column label="上传时间" width="150" align="center">
              <template #default="{ row: doc }">{{ formatDateTime(doc.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row: doc }">
                <el-button type="primary" link size="small" @click="previewDoc(detailRow.id, doc.id)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无上传文件" />
        </div>
        <!-- 历史转正记录 -->
        <div v-if="detailRow.probation_history && detailRow.probation_history.length > 0" style="margin-top: 20px;">
          <div style="font-weight: 600; margin-bottom: 10px; color: #303133;">历史转正记录</div>
          <el-table :data="detailRow.probation_history" stripe size="small">
            <el-table-column label="入职时间" min-width="100" align="center">
              <template #default="{ row: h }">{{ formatDateOnly(h.hire_date) }}</template>
            </el-table-column>
            <el-table-column label="试用期截止" min-width="100" align="center">
              <template #default="{ row: h }">{{ formatDateOnly(h.probation_end_date) }}</template>
            </el-table-column>
            <el-table-column label="转正状态" min-width="80" align="center">
              <template #default="{ row: h }">
                <el-tag :type="getProbationStatusType(h.status)" size="small">
                  {{ getProbationStatusText(h.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="审批时间" min-width="130" align="center">
              <template #default="{ row: h }">{{ h.approve_time ? formatDateTime(h.approve_time) : '-' }}</template>
            </el-table-column>
            <el-table-column label="重置原因" min-width="160">
              <template #default="{ row: h }">{{ h.reset_reason || '-' }}</template>
            </el-table-column>
            <el-table-column label="重置时间" min-width="130" align="center">
              <template #default="{ row: h }">{{ formatDateTime(h.reset_at) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 审批流程弹窗 -->
    <el-dialog v-model="flowVisible" title="审批流程" width="560px" :close-on-click-modal="false">
      <div v-if="flowRow" class="flow-dialog">
        <!-- 基本信息 -->
        <el-descriptions :column="2" border size="small" style="margin-bottom: 20px;">
          <el-descriptions-item label="申请人">{{ flowRow.employee_name }}</el-descriptions-item>
          <el-descriptions-item label="部门">{{ flowRow.employee_department || '-' }}</el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag :type="getProbationStatusType(flowRow.status)" size="small">
              {{ getProbationStatusText(flowRow.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{ flowRow.submit_time ? formatDateTime(flowRow.submit_time) : '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 时间线 -->
        <div class="flow-section-title">审批流程</div>
        <el-timeline v-if="!flowLoading">
          <!-- 所有历史记录（过滤 cc 和 withdraw） -->
          <el-timeline-item
            v-for="record in flowRecords.filter(r => r.action !== 'cc' && r.action !== 'withdraw')"
            :key="record.id"
            :timestamp="formatDateTime(record.action_time)"
            placement="top"
            :type="getActionType(record.action)"
          >
            <div class="tl-title">{{ getActionTitle(record) }}</div>
            <div v-if="['submit', 'resubmit', 'withdraw'].includes(record.action)" class="tl-desc">
              <template v-if="record.action === 'withdraw'">{{ record.approver_name }} 撤回了转正申请</template>
              <template v-else-if="record.action === 'resubmit'">
                {{ record.approver_name }} 重新提交了转正申请
                <div v-if="record.comment" class="tl-comment">{{ formatSubmitComment(record.comment) }}</div>
              </template>
              <template v-else>
                {{ record.approver_name }}
                {{ flowRecords.filter((r: any) => r.action === 'submit' || r.action === 'resubmit').indexOf(record) > 0 ? '重新提交了转正申请' : '提交了转正申请' }}
                <div v-if="record.comment" class="tl-comment">{{ formatSubmitComment(record.comment) }}</div>
              </template>
            </div>
            <template v-else>
              <div class="tl-desc">
                <el-tag :type="getActionType(record.action)" size="small" effect="dark">
                  {{ getActionLabel(record.action) }}
                </el-tag>
              </div>
              <div v-if="record.action === 'reject' && record.comment" class="tl-reject-reason">
                驳回原因：{{ record.comment }}
              </div>
              <div v-else-if="record.action === 'approve' && record.comment" class="tl-comment">
                审批意见：{{ record.comment }}
              </div>
            </template>
          </el-timeline-item>

          <!-- 下一步：待审批 -->
          <el-timeline-item
            v-if="flowRow.status === 'submitted'"
            timestamp="待审批"
            placement="top"
            type="warning"
          >
            <div class="tl-title tl-pending">总经理审批</div>
            <div class="tl-desc">
              等待总经理{{ gmApproverName ? `（${gmApproverName}）` : '' }}审批...
            </div>
          </el-timeline-item>

          <!-- 下一步：驳回后等待重新提交 -->
          <el-timeline-item
            v-if="flowRow.status === 'rejected'"
            timestamp="待处理"
            placement="top"
            type="warning"
          >
            <div class="tl-title tl-pending">重新提交</div>
            <div class="tl-desc">等待员工修改后重新提交...</div>
          </el-timeline-item>

          <!-- 已通过 -->
          <el-timeline-item
            v-if="flowRow.status === 'approved'"
            :timestamp="flowRow.approve_time ? formatDateTime(flowRow.approve_time) : ''"
            placement="top"
            type="success"
          >
            <div class="tl-title">转正完成</div>
            <div class="tl-desc" style="color: #67c23a;">{{ flowRow.employee_name }} 已正式转正</div>
          </el-timeline-item>
        </el-timeline>
        <div v-else style="text-align: center; padding: 20px;">
          <el-icon class="is-loading"><Loading /></el-icon>
        </div>
      </div>
      <template #footer>
        <el-button @click="flowVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { User, Check, Close, View, Search, List, Loading } from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import { usePendingStore } from '@/stores/pending'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const pendingStore = usePendingStore()

const probationList = ref<any[]>([])
const detailVisible = ref(false)
const detailRow = ref<any>(null)
const activeTab = ref('submitted')
const counts = ref({ submitted: 0, approved: 0, total: 0 })
const departmentList = ref<string[]>([])

// 全部查询搜索条件
const searchForm = reactive({ name: '', department: '', status: '' })
const appliedSearch = reactive({ name: '', department: '', status: '' })

// 审批流程弹窗
const flowVisible = ref(false)
const flowRow = ref<any>(null)
const flowRecords = ref<any[]>([])
const flowLoading = ref(false)
const gmApproverName = ref('')

const displayList = computed(() => {
  if (activeTab.value !== '') return probationList.value
  return probationList.value.filter(item => {
    const nameMatch = !appliedSearch.name || (item.employee_name || '').includes(appliedSearch.name)
    const deptMatch = !appliedSearch.department || item.employee_department === appliedSearch.department
    const statusMatch = !appliedSearch.status || item.status === appliedSearch.status
    return nameMatch && deptMatch && statusMatch
  })
})

// 判断是否为虚拟记录（没有提交过转正申请的实习期员工）
function isVirtualRecord(row: any): boolean {
  return typeof row.id === 'string' && row.id.startsWith('virtual_')
}

function handleSearch() {
  appliedSearch.name = searchForm.name
  appliedSearch.department = searchForm.department
  appliedSearch.status = searchForm.status
}

function handleResetSearch() {
  searchForm.name = ''
  searchForm.department = ''
  searchForm.status = ''
  appliedSearch.name = ''
  appliedSearch.department = ''
  appliedSearch.status = ''
}

async function fetchDepartmentList() {
  try {
    const response = await api.get('/api/departments/org-options')
    if (response.data.success) {
      departmentList.value = Object.keys(response.data.data)
    }
  } catch {
    // 静默失败
  }
}

async function handleViewApprovalFlow(row: any) {
  flowRow.value = row
  flowRecords.value = []
  gmApproverName.value = ''
  flowVisible.value = true
  flowLoading.value = true
  try {
    const res = await api.get(`/api/probation/${row.id}/approval-flow`)
    if (res.data.success) {
      flowRecords.value = res.data.data.records || []
      // 优先从审批记录中取已审批的总经理姓名
      const gmRecord = flowRecords.value.find(r => r.action === 'approve' || r.action === 'reject')
      if (gmRecord?.approver_name) {
        gmApproverName.value = gmRecord.approver_name
      } else if (res.data.data.gmName) {
        // 待审批时从后端返回的当前总经理姓名
        gmApproverName.value = res.data.data.gmName
      }
    }
  } catch {
    // 静默失败
  } finally {
    flowLoading.value = false
  }
}

function getActionType(action: string): 'success' | 'danger' | 'warning' | 'info' | 'primary' {
  const map: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'primary'> = {
    submit: 'primary', resubmit: 'primary', approve: 'success',
    reject: 'danger', withdraw: 'warning',
  }
  return map[action] || 'info'
}

function getActionLabel(action: string) {
  const map: Record<string, string> = {
    submit: '员工提交', resubmit: '重新提交', approve: '审批通过',
    reject: '审批驳回', withdraw: '撤回申请',
  }
  return map[action] || action
}

function getActionTitle(record: any) {
  if (['submit', 'resubmit', 'withdraw'].includes(record.action)) {
    return record.approver_name || flowRow.value?.employee_name || '员工'
  }
  return record.approver_name || '总经理'
}

function formatSubmitComment(comment: string | null | undefined) {
  if (!comment) return ''
  return comment.replace(/^员工(?:驳回后)?重新?提交转正申请；?/, '').replace(/^员工提交转正申请；?/, '').trim() || comment
}

function formatDateOnly(dateStr: string) {
  if (!dateStr) return '-'
  return dateStr.split('T')[0].split(' ')[0]
}

function getRemainingDaysNum(endDate: string | null | undefined): number {
  if (!endDate) return -1
  const end = new Date(endDate.split('T')[0])
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  return Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function getRemainingDaysText(endDate: string | null | undefined): string {
  if (!endDate) return '-'
  const days = getRemainingDaysNum(endDate)
  if (days < 0) return '已到期'
  if (days === 0) return '今天到期'
  return `${days}天`
}

function formatDateTime(dateStr: string) {
  if (!dateStr) return '-'
  const safeStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')
  return format(new Date(safeStr), 'yyyy-MM-dd HH:mm', { locale: zhCN })
}

function getProbationStatusType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  const typeMap: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    pending: 'info',
    submitted: 'warning',
    approved: 'success',
    rejected: 'danger'
  }
  return typeMap[status] || 'info'
}

function getProbationStatusText(status: string): string {
  const textMap: Record<string, string> = {
    pending: '实习期',
    submitted: '待审批',
    approved: '已转正',
    rejected: '已驳回'
  }
  return textMap[status] || status
}

async function fetchProbationList() {
  try {
    const params: Record<string, string> = {}
    if (activeTab.value === 'submitted') {
      params.status = 'submitted'
    } else if (activeTab.value === 'approved') {
      params.status = 'approved'
      params.thisMonth = '1'
    }
    const response = await api.get('/api/probation/list', { params })
    if (response.data.success) {
      probationList.value = response.data.data.list || []
    }
  } catch (error) {
    console.error('获取转正列表失败:', error)
    ElMessage.error('获取转正列表失败')
  }
}

async function fetchCounts() {
  try {
    const response = await api.get('/api/probation/statistics')
    if (response.data.success) {
      const d = response.data.data
      counts.value = { submitted: d.submitted, approved: d.approved, total: d.total }
    }
  } catch {
    // 静默失败
  }
}

function handleTabChange() {
  fetchProbationList()
}

function handleViewProbation(row: any) {
  detailRow.value = row
  detailVisible.value = true
}

function previewDoc(confirmationId: string, docId: string) {
  window.open(`/api/probation/${confirmationId}/documents/${docId}/download`, '_blank')
}

async function handleApproveProbation(row: any) {
  try {
    const { value: comment } = await ElMessageBox.prompt(
      `确认通过 ${row.employee_name} 的转正申请？可填写审批意见（选填）。`,
      '审批通过',
      {
        confirmButtonText: '确认通过',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '请填写审批意见（选填）',
        type: 'success'
      }
    )
    const response = await api.post(`/api/probation/${row.id}/approve`, {
      comment: comment || '同意转正'
    })
    if (response.data.success) {
      ElMessage.success('转正申请已通过')
      await pendingStore.refreshPendingCounts()
      fetchCounts()
      fetchProbationList()
    } else {
      ElMessage.error(response.data.message || '操作失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '操作失败')
    }
  }
}

async function handleRejectProbation(row: any) {
  try {
    const { value: comment } = await ElMessageBox.prompt('请填写驳回原因', '驳回转正申请', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '请填写驳回原因',
      inputValidator: (value) => {
        if (!value || value.trim() === '') return '请填写驳回原因'
        return true
      }
    })
    const response = await api.post(`/api/probation/${row.id}/reject`, { comment })
    if (response.data.success) {
      ElMessage.success('转正申请已驳回')
      await pendingStore.refreshPendingCounts()
      fetchCounts()
      fetchProbationList()
    } else {
      ElMessage.error(response.data.message || '操作失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '操作失败')
    }
  }
}

onMounted(() => {
  fetchCounts()
  fetchDepartmentList()
  fetchProbationList()
})
</script>

<style scoped>
.gm-probation-approval {
  padding: 0;
}

.filter-bar {
  margin-bottom: 4px;
}

.filter-bar :deep(.el-tabs__header) {
  margin: 0;
}

.search-bar {
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 16px;
}

.search-form {
  margin-bottom: 0;
}

.search-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 12px;
}

.applicant-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.applicant-cell span {
  font-weight: 500;
}

.action-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: nowrap;
  justify-content: center;
  align-items: center;
}

.no-action-text {
  color: #909399;
  font-size: 13px;
}

.flow-dialog {
  padding: 0 4px;
}

.flow-section-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}

.tl-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.tl-pending {
  color: #c0c4cc;
}

.tl-desc {
  font-size: 13px;
  color: #606266;
}

.tl-reject-reason {
  margin-top: 6px;
  padding: 8px 10px;
  background: #fef0f0;
  border: 1px solid #fbc4c4;
  border-radius: 4px;
  font-size: 13px;
  color: #f56c6c;
}

.tl-comment {
  margin-top: 6px;
  font-size: 13px;
  color: #909399;
}

.text-danger {
  color: #f56c6c;
  font-weight: 600;
}

.text-warning {
  color: #e6a23c;
  font-weight: 600;
}

.no-action-text {
  color: #909399;
  font-size: 13px;
}
</style>
