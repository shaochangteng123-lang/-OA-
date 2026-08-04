<template>
  <div class="leave-admin-panel">
    <!-- 抄送记录工具栏 -->
    <div v-if="activeSubTab === 'requests'" class="toolbar">
      <el-input
        v-model="filters.keyword"
        placeholder="搜索员工姓名"
        clearable
        style="width: 160px"
        @keyup.enter="fetchRequests(1)"
        @clear="fetchRequests(1)"
      />
      <el-select v-model="filters.leaveTypeCode" placeholder="假期类型" clearable style="width: 120px" @change="fetchRequests(1)">
        <el-option v-for="t in leaveTypes" :key="t.code" :label="t.name" :value="t.code" />
      </el-select>
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 110px" @change="fetchRequests(1)">
        <el-option label="审批中" value="pending" />
        <el-option label="草稿" value="draft" />
        <el-option label="已批准" value="approved" />
        <el-option label="已驳回" value="rejected" />
        <el-option label="已撤销" value="cancelled" />
      </el-select>
      <el-date-picker
        v-model="filters.dateRange"
        type="daterange"
        range-separator="~"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        style="width: 240px"
        @change="fetchRequests(1)"
      />
      <el-button type="primary" plain @click="fetchRequests(1)">查询</el-button>
      <el-button @click="handleExport">
        <el-icon><Download /></el-icon>
        导出CSV
      </el-button>
    </div>

    <!-- 子 Tab -->
    <el-tabs v-model="activeSubTab" style="margin-top: 8px">
      <!-- 董事长处理总经理请假 -->
      <el-tab-pane v-if="isChairman" label="请假审批" name="approval">
        <LeavePendingList @approved="handleLeaveApprovalUpdated" />
      </el-tab-pane>

      <!-- 管理员抄送记录 -->
      <el-tab-pane v-if="!isChairman" label="抄送记录" name="requests">
        <el-table
          v-loading="requestsLoading"
          :data="requestList"
          border
          size="small"
          empty-text="暂无记录"
        >
          <el-table-column label="序号" type="index" width="60" align="center" :index="(i) => (requestPage - 1) * requestPageSize + i + 1" />
          <el-table-column label="申请编号" prop="request_no" width="160" align="center" />
          <el-table-column label="员工" width="90" align="center">
            <template #default="{ row }">{{ row.applicant_name || row.user_name }}</template>
          </el-table-column>
          <el-table-column label="部门" prop="applicant_department" width="90" align="center" />
          <el-table-column label="假期类型" width="100" align="center">
            <template #default="{ row }">
              <div>{{ row.leave_type_name }}</div>
              <el-tag
                v-if="row.application_kind && row.application_kind !== 'normal'"
                size="small"
                effect="plain"
                :type="applicationKindTagType(row.application_kind)"
              >
                {{ applicationKindLabel(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时间段" min-width="190" align="center">
            <template #default="{ row }">
              {{ row.start_date }}{{ row.start_half === 'morning' ? '上' : '下' }}午
              ~
              {{ row.end_date }}{{ row.end_half === 'morning' ? '上' : '下' }}午
            </template>
          </el-table-column>
          <el-table-column label="天数" prop="total_days" width="65" align="center" />
          <el-table-column label="剩余天数" width="130" align="center">
            <template #default="{ row }">
              <div v-if="row.status === 'approved'" class="return-info">
                <span :class="['remaining-days', `is-${row.leave_timing_status || 'upcoming'}`]">
                  {{ remainingDaysLabel(row) }}
                </span>
                <span v-if="row.return_to_work_date" class="return-time">
                  返岗：{{ row.return_to_work_date }}{{ row.return_to_work_half === 'morning' ? '上午' : '下午' }}
                </span>
              </div>
              <span v-else class="empty-value">-</span>
            </template>
          </el-table-column>
          <el-table-column label="审批人" width="130" align="center">
            <template #default="{ row }">
              {{ formatPerson(row.approver_position, row.approver_real_name || row.approver_name || '总经理') }}
            </template>
          </el-table-column>
          <el-table-column label="抄送" width="150" align="center">
            <template #default="{ row }">
              {{ formatCcRecipient(row) }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)" size="small">
                {{ statusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="110" align="center">
            <template #default="{ row }">{{ row.submitted_at?.substring(0, 10) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="handleViewRequest(row)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="requestPage"
            v-model:page-size="requestPageSize"
            :total="requestTotal"
            :page-sizes="[20, 50, 100]"
            layout="total, sizes, prev, pager, next"
            background
            @current-change="fetchRequests"
            @size-change="fetchRequests(1)"
          />
        </div>
      </el-tab-pane>

      <!-- 假期类型管理 -->
      <el-tab-pane label="假期类型" name="types">
        <div class="types-toolbar">
          <el-button type="primary" @click="openAddTypeDialog">
            <el-icon><Plus /></el-icon>
            添加假期类型
          </el-button>
        </div>
        <el-table v-loading="typesLoading" :data="allLeaveTypes" border size="small" style="margin-top:10px">
          <el-table-column label="序号" type="index" width="60" align="center" :index="(i) => i + 1" />
          <el-table-column label="假期名称" prop="name" width="110" align="center" />
          <el-table-column label="默认天数" prop="default_days" width="90" align="center" />
          <el-table-column label="需要余额" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.requires_balance_check ? 'success' : 'info'" size="small">
                {{ row.requires_balance_check ? '是' : '否' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="需要附件" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.requires_attachment ? 'warning' : 'info'" size="small">
                {{ row.requires_attachment ? '是' : '否' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="描述" prop="description" min-width="160" show-overflow-tooltip />
          <el-table-column label="操作" width="120" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openEditTypeDialog(row)">修改</el-button>
              <el-popconfirm
                title="确认删除该假期类型？删除后员工将无法选择此假期。"
                width="240"
                @confirm="deleteType(row.code)"
              >
                <template #reference>
                  <el-button link type="danger" size="small">删除</el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 员工余额（只读） -->
      <el-tab-pane label="员工余额" name="balances">
        <div class="balances-toolbar">
          <el-select v-model="balanceDepartment" placeholder="全部部门" clearable style="width: 140px" @change="fetchBalances">
            <el-option v-for="d in departments" :key="d" :label="d" :value="d" />
          </el-select>
          <span class="balances-label">年份</span>
          <el-input-number
            v-model="balanceYear"
            :min="2020"
            :max="2099"
            class="balance-year-input"
            @change="fetchBalances"
          />
        </div>

        <el-table v-loading="balancesLoading" :data="balanceUsers" border size="small" style="margin-top:8px">
          <el-table-column label="序号" type="index" width="60" align="center" :index="(i) => i + 1" fixed />
          <el-table-column label="员工编号" prop="employeeNo" width="120" fixed align="center">
            <template #default="{ row }">{{ row.employeeNo || '-' }}</template>
          </el-table-column>
          <el-table-column label="员工" prop="userName" width="100" fixed align="center" />
          <el-table-column label="部门" prop="department" width="90" fixed align="center" />
          <el-table-column
            v-for="type in balanceTypes"
            :key="type.code"
            :label="type.name"
            width="100"
            align="center"
          >
            <template #header>
              <div>{{ type.name }}</div>
              <div style="font-size:11px;color:#909399">余/总天数</div>
            </template>
            <template #default="{ row }">
              <span v-if="!type.requires_balance_check" class="unlimited-balance">
                不限额度
              </span>
              <template v-else-if="row[type.code]">
                <div class="balance-cell">
                  <span>
                    <span :class="{ 'text-warning': row[type.code].available < 1 && row[type.code].total > 0 }">
                      {{ row[type.code].available }}
                    </span>
                    <span style="color:#c0c4cc">/{{ row[type.code].total }}</span>
                  </span>
                  <el-tooltip content="调整总天数" placement="top">
                    <el-button
                      text
                      circle
                      size="small"
                      :icon="Edit"
                      @click="openBalanceDialog(row, type)"
                    />
                  </el-tooltip>
                </div>
              </template>
              <span v-else style="color:#c0c4cc">-</span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 请假详情抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      title="请假申请详情"
      size="480px"
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
          :is-owner="false"
          @view-request="handleViewRelatedRequest"
        />
      </div>
      <el-skeleton v-else :rows="6" animated style="padding:16px" />
    </el-drawer>

    <!-- 添加假期类型对话框 -->
    <el-dialog v-model="addTypeDialogVisible" title="添加假期类型" width="420px" :close-on-click-modal="false">
      <el-form ref="addTypeFormRef" :model="addTypeForm" :rules="addTypeRules" label-width="110px">
        <el-form-item label="假期名称" prop="name">
          <el-input v-model="addTypeForm.name" placeholder="如：年假" maxlength="20" />
        </el-form-item>
        <el-form-item label="默认天数" prop="default_days">
          <el-input-number v-model="addTypeForm.default_days" :min="0" :max="365" :step="0.5" :precision="1" />
          <span style="font-size:12px;color:#909399;margin-left:8px">天</span>
        </el-form-item>
        <el-form-item label="需要余额检查">
          <el-switch v-model="addTypeForm.requires_balance_check" />
          <span style="font-size:12px;color:#909399;margin-left:8px">开启后请假时检查剩余天数</span>
        </el-form-item>
        <el-form-item label="需要上传附件">
          <el-switch v-model="addTypeForm.requires_attachment" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="addTypeForm.description" type="textarea" :rows="2" placeholder="可选" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addTypeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="addTypeLoading" @click="confirmAddType">确认添加</el-button>
      </template>
    </el-dialog>
    <!-- 修改假期类型对话框 -->
    <el-dialog v-model="editTypeDialogVisible" title="修改假期类型" width="420px" :close-on-click-modal="false">
      <el-form ref="editTypeFormRef" :model="editTypeForm" :rules="addTypeRules" label-width="110px">
        <el-form-item label="假期名称" prop="name">
          <el-input v-model="editTypeForm.name" maxlength="20" />
        </el-form-item>
        <el-form-item label="默认天数" prop="default_days">
          <el-input-number v-model="editTypeForm.default_days" :min="0" :max="365" :step="0.5" :precision="1" />
          <span style="font-size:12px;color:#909399;margin-left:8px">天</span>
        </el-form-item>
        <el-form-item label="需要余额检查">
          <el-switch
            v-model="editTypeForm.requires_balance_check"
            :disabled="isFixedBalanceType(editTypeCode)"
          />
          <span style="font-size:12px;color:#909399;margin-left:8px">
            {{ isFixedBalanceType(editTypeCode) ? '固定额度假期仅可调整天数' : '开启后请假时检查剩余天数' }}
          </span>
        </el-form-item>
        <el-form-item label="需要上传附件">
          <el-switch v-model="editTypeForm.requires_attachment" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editTypeForm.description" type="textarea" :rows="2" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editTypeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="editTypeLoading" @click="confirmEditType">保存修改</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="balanceDialogVisible"
      title="调整员工假期额度"
      width="420px"
      :close-on-click-modal="false"
    >
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="员工">{{ balanceEditForm.userName }}</el-descriptions-item>
        <el-descriptions-item label="假期">{{ balanceEditForm.typeName }}</el-descriptions-item>
        <el-descriptions-item label="已使用">
          {{ balanceEditForm.used }} 天
        </el-descriptions-item>
        <el-descriptions-item label="审批中">
          {{ balanceEditForm.pending }} 天
        </el-descriptions-item>
      </el-descriptions>
      <el-form label-width="90px" class="balance-edit-form">
        <el-form-item label="总天数">
          <el-input-number
            v-model="balanceEditForm.total"
            :min="balanceEditForm.used + balanceEditForm.pending"
            :max="999.5"
            :step="0.5"
            :precision="1"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="balanceDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="balanceSaving" @click="saveBalance">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Download, Edit, Plus } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import LeaveApprovalTimeline from './LeaveApprovalTimeline.vue'
import LeavePendingList from './LeavePendingList.vue'
import { useAuthStore } from '@/stores/auth'
import { usePendingStore } from '@/stores/pending'
import {
  getLeaveTypes, adminGetTypes, adminCreateType, adminUpdateType, adminDeleteType,
  adminGetRequests, adminGetBalances, adminAdjustBalance, getRequestDetail, getExportUrl,
  type LeaveTypeConfig, type LeaveRequest, type LeaveRequestDetail
} from '@/utils/leaveApi'

const authStore = useAuthStore()
const pendingStore = usePendingStore()
const isChairman = computed(() => authStore.user?.role === 'chairman')
const activeSubTab = ref(isChairman.value ? 'approval' : 'requests')
const leaveTypes = ref<LeaveTypeConfig[]>([])

// ---- 全员请假记录 ----
const requestList = ref<LeaveRequest[]>([])
const requestsLoading = ref(false)
const requestTotal = ref(0)
const requestPage = ref(1)
const requestPageSize = ref(20)
const filters = ref({ keyword: '', leaveTypeCode: '', status: '', dateRange: null as [string, string] | null })
const drawerVisible = ref(false)
const detailRequest = ref<LeaveRequestDetail | null>(null)
const detailHistory = ref<LeaveRequestDetail[]>([])
const detailLoading = ref(false)

// ---- 假期类型管理 ----
const typesLoading = ref(false)
const allLeaveTypes = ref<LeaveTypeConfig[]>([])
const addTypeDialogVisible = ref(false)
const addTypeLoading = ref(false)
const addTypeFormRef = ref<FormInstance>()
const addTypeForm = ref({
  name: '',
  default_days: 0,
  requires_balance_check: true,
  requires_attachment: false,
  description: '',
})
const addTypeRules: FormRules = {
  name: [{ required: true, message: '请输入假期名称', trigger: 'blur' }],
  default_days: [{ required: true, message: '请输入默认天数', trigger: 'change' }],
}

// ---- 假期类型修改 ----
const editTypeDialogVisible = ref(false)
const editTypeLoading = ref(false)
const editTypeFormRef = ref<FormInstance>()
const editTypeCode = ref('')
const editTypeForm = ref({
  name: '',
  default_days: 0,
  requires_balance_check: true,
  requires_attachment: false,
  description: '',
})

// ---- 员工余额 ----
const balancesLoading = ref(false)
const balanceUsers = ref<any[]>([])
const balanceTypes = ref<Array<{
  code: string
  name: string
  requires_balance_check: boolean
}>>([])
const balanceDepartment = ref('')
const balanceYear = ref(new Date().getFullYear())
const departments = ref<string[]>([])
const balanceDialogVisible = ref(false)
const balanceSaving = ref(false)
const balanceEditForm = ref({
  userId: '',
  userName: '',
  typeCode: '',
  typeName: '',
  total: 0,
  used: 0,
  pending: 0,
})
const FIXED_BALANCE_TYPE_CODES = new Set([
  'annual',
  'personal',
  'sick',
  'bereavement',
  'compensatory',
  'marriage',
  'maternity',
  'paternity',
])

function statusLabel(status: string): string {
  const m: Record<string, string> = {
    draft: '草稿', pending: '审批中', approved: '已批准', rejected: '已驳回', cancelled: '已撤销'
  }
  return m[status] || status
}

function statusTagType(status: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' | undefined {
  const m: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    draft: 'info', pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'info'
  }
  return m[status] || undefined
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
    normal: '普通',
    combined: '组合',
    extension: '续假',
    supplement: '补假',
  }
  return labels[request.application_kind] || '普通'
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

function isFixedBalanceType(code: string): boolean {
  return FIXED_BALANCE_TYPE_CODES.has(code)
}

function formatPerson(position: string | null | undefined, name: string): string {
  return position ? `${position} ${name}` : name
}

function formatCcRecipient(request: LeaveRequest): string {
  const role = request.cc_recipient_role?.trim()
  const name = request.cc_recipient_name?.trim()
  if (role && name) return `${role} ${name}`
  return role || name || '-'
}

function remainingDaysLabel(request: LeaveRequest): string {
  if (request.leave_timing_status === 'returned') return '已返岗'
  const days = Number(request.remaining_days)
  return Number.isFinite(days) ? `${days}天` : '-'
}

async function fetchRequests(page?: number) {
  if (page) requestPage.value = page
  requestsLoading.value = true
  try {
    const result = await adminGetRequests({
      leaveTypeCode: filters.value.leaveTypeCode || undefined,
      status: filters.value.status || undefined,
      startDate: filters.value.dateRange?.[0] || undefined,
      endDate: filters.value.dateRange?.[1] || undefined,
      page: requestPage.value,
      pageSize: requestPageSize.value,
    })
    requestList.value = result.list
    requestTotal.value = result.total
  } catch {
    ElMessage.error('获取申请记录失败')
  } finally {
    requestsLoading.value = false
  }
}

async function fetchTypes() {
  typesLoading.value = true
  try {
    allLeaveTypes.value = await adminGetTypes()
  } catch {
    ElMessage.error('获取假期类型失败')
  } finally {
    typesLoading.value = false
  }
}

async function fetchBalances() {
  balancesLoading.value = true
  try {
    const result = await adminGetBalances({
      department: balanceDepartment.value || undefined,
      year: balanceYear.value,
    })
    balanceUsers.value = result.users
    balanceTypes.value = result.types
    const deptSet = new Set(result.users.map((u: any) => u.department).filter(Boolean))
    departments.value = Array.from(deptSet) as string[]
  } catch {
    ElMessage.error('获取余额总览失败')
  } finally {
    balancesLoading.value = false
  }
}

function openBalanceDialog(
  row: any,
  type: { code: string; name: string; requires_balance_check: boolean }
) {
  if (!type.requires_balance_check) return
  const balance = row[type.code]
  if (!balance) return
  balanceEditForm.value = {
    userId: row.userId,
    userName: row.userName,
    typeCode: type.code,
    typeName: type.name,
    total: Number(balance.total),
    used: Number(balance.used),
    pending: Number(balance.pending),
  }
  balanceDialogVisible.value = true
}

async function saveBalance() {
  balanceSaving.value = true
  try {
    await adminAdjustBalance(
      balanceEditForm.value.userId,
      balanceEditForm.value.typeCode,
      balanceYear.value,
      balanceEditForm.value.total
    )
    ElMessage.success('员工假期额度已调整')
    balanceDialogVisible.value = false
    await fetchBalances()
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '调整假期额度失败')
  } finally {
    balanceSaving.value = false
  }
}

async function handleViewRequest(row: LeaveRequest) {
  drawerVisible.value = true
  detailHistory.value = []
  detailRequest.value = null
  detailLoading.value = true
  try {
    detailRequest.value = await getRequestDetail(row.id)
  } catch {
    ElMessage.error('获取详情失败')
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

function openAddTypeDialog() {
  addTypeForm.value = { name: '', default_days: 0, requires_balance_check: true, requires_attachment: false, description: '' }
  addTypeDialogVisible.value = true
}

async function confirmAddType() {
  await addTypeFormRef.value?.validate(async (valid) => {
    if (!valid) return
    addTypeLoading.value = true
    try {
      await adminCreateType(addTypeForm.value)
      ElMessage.success('假期类型已添加')
      addTypeDialogVisible.value = false
      fetchTypes()
      leaveTypes.value = await getLeaveTypes().catch(() => [])
    } catch (err: any) {
      ElMessage.error(err?.response?.data?.message || '添加失败')
    } finally {
      addTypeLoading.value = false
    }
  })
}

async function deleteType(code: string) {
  try {
    await adminDeleteType(code)
    ElMessage.success('假期类型已删除')
    fetchTypes()
    leaveTypes.value = await getLeaveTypes().catch(() => [])
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '删除失败')
  }
}

function openEditTypeDialog(row: LeaveTypeConfig) {
  editTypeCode.value = row.code
  editTypeForm.value = {
    name: row.name,
    default_days: row.default_days ?? 0,
    requires_balance_check: isFixedBalanceType(row.code) ? true : row.requires_balance_check,
    requires_attachment: row.requires_attachment,
    description: row.description ?? '',
  }
  editTypeDialogVisible.value = true
}

async function confirmEditType() {
  await editTypeFormRef.value?.validate(async (valid) => {
    if (!valid) return
    editTypeLoading.value = true
    try {
      await adminUpdateType(editTypeCode.value, editTypeForm.value)
      ElMessage.success('假期类型已更新')
      editTypeDialogVisible.value = false
      fetchTypes()
      leaveTypes.value = await getLeaveTypes().catch(() => [])
    } catch (err: any) {
      ElMessage.error(err?.response?.data?.message || '修改失败')
    } finally {
      editTypeLoading.value = false
    }
  })
}

function handleExport() {
  const params: Record<string, string> = {}
  if (filters.value.leaveTypeCode) params.leaveTypeCode = filters.value.leaveTypeCode
  if (filters.value.status) params.status = filters.value.status
  if (filters.value.dateRange?.[0]) params.startDate = filters.value.dateRange[0]
  if (filters.value.dateRange?.[1]) params.endDate = filters.value.dateRange[1]
  params.year = String(balanceYear.value)
  window.open(getExportUrl(params), '_blank')
}

async function handleLeaveApprovalUpdated() {
  await pendingStore.refreshPendingCounts()
}

onMounted(async () => {
  leaveTypes.value = await getLeaveTypes().catch(() => [])
  const tasks = [fetchTypes(), fetchBalances()]
  if (!isChairman.value) tasks.push(fetchRequests(1))
  await Promise.all(tasks)
})
</script>

<style scoped>
.return-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  line-height: 1.35;
}
.remaining-days {
  color: #409eff;
  font-weight: 600;
}
.remaining-days.is-on_leave { color: #e6a23c; }
.remaining-days.is-returned { color: #67c23a; }
.return-time {
  color: #909399;
  font-size: 11px;
  white-space: nowrap;
}
.empty-value { color: #c0c4cc; }
.leave-admin-panel {}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.types-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
.balances-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.balances-label {
  font-size: 13px;
  color: #606266;
}
.balance-year-input {
  width: 136px;
}
.text-warning {
  color: #e6a23c;
  font-weight: 600;
}
.balance-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 24px;
}
.balance-edit-form {
  margin-top: 16px;
}
.unlimited-balance {
  color: #909399;
  font-size: 12px;
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
