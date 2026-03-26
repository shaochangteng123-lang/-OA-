<template>
  <div class="basic-reimbursement-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <el-button type="primary" :icon="Plus" @click="handleCreate">
            新建报销单
          </el-button>
        </div>
      </template>

      <div class="content-wrapper">
        <!-- 提示信息 -->
        <el-alert
          title="数据显示说明"
          type="info"
          :closable="false"
          show-icon
          class="alert-info"
        >
          <template #default>
            <p>默认显示当月报销数据，可通过日期范围查询历史记录。</p>
          </template>
        </el-alert>

        <!-- 筛选区域 -->
        <div class="filter-section">
          <el-form :inline="true" :model="filterForm" class="filter-form">
            <el-form-item label="状态">
              <el-select v-model="filterForm.status" placeholder="全部状态" clearable style="width: 140px">
                <el-option label="草稿" value="draft" />
                <el-option label="待审批" value="pending" />
                <el-option label="待付款" value="approved" />
                <el-option label="已驳回" value="rejected" />
                <el-option label="待确认" value="payment_uploaded" />
                <el-option label="已完成" value="completed" />
              </el-select>
            </el-form-item>
            <el-form-item label="日期范围">
              <el-date-picker
                v-model="dateRangeModel"
                :type="currentDatePickerType"
                range-separator="至"
                :start-placeholder="currentStartPlaceholder"
                :end-placeholder="currentEndPlaceholder"
                :shortcuts="dateTypeShortcuts"
                :value-format="currentDateValueFormat"
                style="width: 280px"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :icon="Search" @click="handleSearch">
                查询
              </el-button>
              <el-button :icon="Refresh" @click="handleReset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <!-- 报销单列表 -->
        <el-table
          v-loading="loading"
          :data="reimbursementList"
          stripe
          style="width: 100%"
        >
          <el-table-column label="序号" align="center" header-align="center">
            <template #default="{ $index }">
              {{ (pagination.page - 1) * pagination.pageSize + $index + 1 }}
            </template>
          </el-table-column>
          <el-table-column prop="title" label="报销事由" align="center" header-align="center">
            <template #default="{ row }">
              {{ normalizeReimbursementTitle(row.title) }}
            </template>
          </el-table-column>
          <el-table-column prop="category" label="报销类型" align="center" header-align="center">
            <template #default="{ row }">
              {{ row.invoiceCategory || '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="amount" label="报销金额" align="center" header-align="center">
            <template #default="{ row }">
              <span class="amount-text">¥{{ row.amount.toFixed(2) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" align="center" header-align="center">
            <template #default="{ row }">
              <el-tag
                :type="getStatusType(row.status)"
                :color="getStatusColor(row.status)"
                :style="getStatusColor(row.status) ? { color: '#fff', borderColor: getStatusColor(row.status) } : {}"
              >
                {{ getStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="submitTime" label="提交时间" align="center" header-align="center">
            <template #default="{ row }">
              {{ row.submitTime || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" align="center" header-align="center">
            <template #default="{ row }">
              <el-button
                v-if="row.status !== 'draft'"
                link
                type="primary"
                size="small"
                @click="handleView(row)"
              >
                查看
              </el-button>
              <el-button
                v-if="canEdit(row.status)"
                link
                type="primary"
                size="small"
                @click="handleEdit(row)"
              >
                {{ row.status === 'rejected' ? '修改并重新提交' : '修改' }}
              </el-button>
              <el-button
                v-if="row.status === 'pending'"
                link
                type="warning"
                size="small"
                @click="handleWithdraw(row)"
              >
                撤回
              </el-button>
              <el-button
                v-if="canDelete(row.status)"
                link
                type="danger"
                size="small"
                @click="handleDelete(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 分页 -->
        <div class="pagination-wrapper">
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            :total="pagination.total"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="handleSizeChange"
            @current-change="handlePageChange"
          />
        </div>

        <!-- 审批过程弹窗 -->
        <el-dialog
          v-model="approvalDialogVisible"
          title="审批过程"
          width="600px"
          :close-on-click-modal="false"
        >
          <div v-if="currentApprovalRecord" class="approval-detail">
            <!-- 基本信息 -->
            <div class="info-section">
              <h4 class="section-title">报销单信息</h4>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="报销单号">{{ currentApprovalRecord.id }}</el-descriptions-item>
                <el-descriptions-item label="报销类型">{{ currentApprovalRecord.category || '基础报销' }}</el-descriptions-item>
                <el-descriptions-item label="报销事由" :span="2">{{ normalizeReimbursementTitle(currentApprovalRecord.title) }}</el-descriptions-item>
                <el-descriptions-item label="申请人">{{ currentApprovalRecord.applicant }}</el-descriptions-item>
                <el-descriptions-item label="报销金额">
                  <span class="amount-highlight">¥{{ currentApprovalRecord.amount?.toFixed(2) }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="当前状态">
                  <el-tag
                    :type="getStatusType(currentApprovalRecord.status)"
                    :color="getStatusColor(currentApprovalRecord.status)"
                    :style="getStatusColor(currentApprovalRecord.status) ? { color: '#fff', borderColor: getStatusColor(currentApprovalRecord.status) } : {}"
                  >
                    {{ getStatusText(currentApprovalRecord.status) }}
                  </el-tag>
                </el-descriptions-item>
              </el-descriptions>
            </div>

            <!-- 审批流程 -->
            <div class="timeline-section">
              <h4 class="section-title">审批流程</h4>
              <el-timeline>
                <!-- 1. 员工提交 -->
                <el-timeline-item
                  :timestamp="currentApprovalRecord.submitTime"
                  placement="top"
                  type="primary"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">员工提交</div>
                    <div class="timeline-desc">{{ currentApprovalRecord.applicant }} 提交了报销申请</div>
                    <div v-if="currentApprovalRecord.description" class="timeline-description">{{ currentApprovalRecord.description }}</div>
                  </div>
                </el-timeline-item>

                <!-- 2. 审批历史记录 -->
                <template v-if="currentApprovalRecord.approvalHistory && currentApprovalRecord.approvalHistory.length > 0">
                  <el-timeline-item
                    v-for="record in currentApprovalRecord.approvalHistory.filter((r: any) => r.action !== 'payment_uploaded')"
                    :key="record.id"
                    :timestamp="record.actionTime"
                    placement="top"
                    :type="record.action === 'approve' ? 'success' : record.action === 'reject' ? 'danger' : 'info'"
                  >
                    <div class="timeline-content">
                      <div class="timeline-title">
                        {{ record.approverName || record.approverUsername || '管理员' }}
                      </div>
                      <div class="timeline-desc">
                        <el-tag :type="record.action === 'approve' ? 'success' : record.action === 'reject' ? 'danger' : 'info'" size="small" effect="dark">
                          {{ record.action === 'approve' ? '审批通过' : record.action === 'reject' ? '审批驳回' : record.action === 'resubmit' ? '再次提交' : record.action }}
                        </el-tag>
                      </div>
                      <div v-if="record.action === 'reject' && record.comment" class="timeline-desc reject-reason">
                        驳回原因：{{ record.comment }}
                      </div>
                    </div>
                  </el-timeline-item>
                </template>

                <!-- 如果没有审批历史，显示当前状态 -->
                <template v-else>
                  <el-timeline-item
                    v-if="['approved', 'payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
                    :timestamp="currentApprovalRecord.approveTime"
                    placement="top"
                    type="success"
                  >
                    <div class="timeline-content">
                      <div class="timeline-title">管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批</div>
                      <div class="timeline-desc">{{ currentApprovalRecord.approver || '管理员' }} 审批通过</div>
                    </div>
                  </el-timeline-item>
                  <el-timeline-item
                    v-else-if="currentApprovalRecord.status === 'rejected'"
                    :timestamp="currentApprovalRecord.approveTime"
                    placement="top"
                    type="danger"
                  >
                    <div class="timeline-content">
                      <div class="timeline-title">管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批</div>
                      <div class="timeline-desc">{{ currentApprovalRecord.approver || '管理员' }} 驳回了申请</div>
                      <div v-if="currentApprovalRecord.rejectReason" class="timeline-desc reject-reason">
                        驳回原因：{{ currentApprovalRecord.rejectReason }}
                      </div>
                    </div>
                  </el-timeline-item>
                  <el-timeline-item
                    v-else-if="currentApprovalRecord.status === 'pending'"
                    timestamp="待审批"
                    placement="top"
                    type="warning"
                  >
                    <div class="timeline-content">
                      <div class="timeline-title">管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批</div>
                      <div class="timeline-desc">等待管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批...</div>
                    </div>
                  </el-timeline-item>
                </template>

                <!-- 驳回重新提交后，等待审批的下一步 -->
                <el-timeline-item
                  v-if="currentApprovalRecord.status === 'pending' && currentApprovalRecord.approvalHistory && currentApprovalRecord.approvalHistory.length > 0"
                  timestamp="待审批"
                  placement="top"
                  type="warning"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批</div>
                    <div class="timeline-desc">等待管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批...</div>
                  </div>
                </el-timeline-item>

                <!-- 驳回后的下一步 -->
                <el-timeline-item
                  v-if="currentApprovalRecord.status === 'rejected'"
                  timestamp="待重新提交"
                  placement="top"
                  type="warning"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">重新提交</div>
                    <div class="timeline-desc">等待员工修改后重新提交...</div>
                  </div>
                </el-timeline-item>

                <!-- 3. 财务付款 -->
                <el-timeline-item
                  v-if="!isDeductionOnly && ['approved', 'payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
                  :timestamp="currentApprovalRecord.status === 'approved' ? '待付款' : (currentApprovalRecord.payTime || '')"
                  placement="top"
                  :type="currentApprovalRecord.status === 'approved' ? 'warning' : 'success'"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">财务付款</div>
                    <div class="timeline-desc">{{ currentApprovalRecord.status === 'approved' ? '等待财务付款...' : '财务已付款' }}</div>
                  </div>
                </el-timeline-item>

                <!-- 4. 上传付款凭证 -->
                <el-timeline-item
                  v-if="!isDeductionOnly && ['payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
                  :timestamp="currentApprovalRecord.paymentUploadTime || ''"
                  placement="top"
                  type="success"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">上传付款凭证</div>
                    <div class="timeline-desc">财务已上传付款凭证</div>
                    <!-- 批量付款金额对照 -->
                    <div v-if="batchInfoForDialog" class="batch-amount-compare">
                      <div class="batch-compare-header">
                        <el-tag type="warning" size="small">批量付款</el-tag>
                        <span class="batch-compare-no">批次号：{{ batchInfoForDialog.batchNo }}</span>
                      </div>
                      <div class="batch-compare-list">
                        <div
                          v-for="r in batchInfoForDialog.reimbursements"
                          :key="r.id"
                          class="batch-compare-item"
                          :class="{ 'is-current': r.id === currentApprovalRecord.id }"
                        >
                          <span class="batch-compare-id">{{ r.id }}</span>
                          <el-tag v-if="r.id === currentApprovalRecord.id" type="primary" size="small">本笔</el-tag>
                          <span class="batch-compare-title">{{ r.title }}</span>
                          <span class="batch-compare-amount">¥{{ parseFloat(r.amount).toFixed(2) }}</span>
                        </div>
                      </div>
                      <div class="batch-compare-total">
                        <span>回单付款总额</span>
                        <span class="batch-compare-total-amount">¥{{ batchInfoForDialog.totalAmount.toFixed(2) }}</span>
                      </div>
                    </div>
                    <!-- 付款回单展示 -->
                    <div v-if="currentApprovalRecord.paymentProofPath" class="payment-proof-preview">
                      <div v-for="(proofUrl, idx) in currentApprovalRecord.paymentProofPath.split(',')" :key="idx" class="proof-card" @click="handlePreviewPaymentProof(proofUrl)">
                        <template v-if="isImagePath(proofUrl)">
                          <img :src="proofUrl" class="proof-image" alt="付款回单" />
                        </template>
                        <template v-else>
                          <div class="proof-pdf">
                            <el-icon :size="32" color="#409EFF"><Document /></el-icon>
                            <span>付款回单.pdf</span>
                          </div>
                        </template>
                        <div class="proof-overlay">
                          <el-icon :size="20"><ZoomIn /></el-icon>
                          <span>点击查看</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </el-timeline-item>

                <!-- 5. 员工确认收款 -->
                <el-timeline-item
                  v-if="!isDeductionOnly && currentApprovalRecord.status === 'completed' && currentApprovalRecord.receiptConfirmedBy"
                  :timestamp="currentApprovalRecord.completedTime || ''"
                  placement="top"
                  type="success"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">确认收款</div>
                    <div class="timeline-desc">{{ currentApprovalRecord.receiptConfirmedBy }}已确认收款</div>
                  </div>
                </el-timeline-item>
                <el-timeline-item
                  v-else-if="!isDeductionOnly && currentApprovalRecord.status === 'payment_uploaded'"
                  timestamp="待确认收款"
                  placement="top"
                  type="warning"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">确认收款</div>
                    <div class="timeline-desc">等待员工确认收款...</div>
                  </div>
                </el-timeline-item>

                <!-- 6. 流程完成 -->
                <el-timeline-item
                  v-if="currentApprovalRecord.status === 'completed'"
                  :timestamp="currentApprovalRecord.completedTime || ''"
                  placement="top"
                  type="success"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">{{ isDeductionOnly ? '已计算到核减金额' : '流程完成' }}</div>
                    <div class="timeline-desc">
                      {{ isDeductionOnly ? '核减金额已记录，报销流程已完成' : '报销流程已完成' }}
                    </div>
                  </div>
                </el-timeline-item>
              </el-timeline>
            </div>
          </div>
          <template #footer>
            <el-button @click="approvalDialogVisible = false">关闭</el-button>
            <!-- 已上传付款凭证但未确认收款时显示确认收款按钮 -->
            <el-button
              v-if="currentApprovalRecord && currentApprovalRecord.status === 'payment_uploaded'"
              type="success"
              :loading="confirmingReceipt"
              @click="handleConfirmReceipt"
            >
              已确认收款
            </el-button>
            <!-- 查看报销单按钮 -->
            <el-button
              type="primary"
              @click="handleGoToDetail"
            >
              查看报销单
            </el-button>
          </template>
        </el-dialog>

        <!-- 付款回单预览对话框 -->
        <el-dialog v-model="paymentProofDialogVisible" title="付款回单" width="80%" :close-on-click-modal="true">
          <div class="preview-dialog-content">
            <img v-if="isImagePath(previewingProofUrl)" :src="previewingProofUrl" class="preview-dialog-image" alt="付款回单" />
            <iframe v-else-if="previewingProofUrl" :src="previewingProofUrl" class="preview-dialog-pdf" />
          </div>
        </el-dialog>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Refresh, Document, ZoomIn } from '@element-plus/icons-vue'
import { usePendingStore } from '@/stores/pending'
import { normalizeReimbursementTitle } from '@/utils/reimbursement/date'

const router = useRouter()
const pendingStore = usePendingStore()

// 筛选表单
const filterForm = reactive({
  status: '',
  // 日期查询类型：年 / 月 / 日
  dateQueryType: 'day' as 'year' | 'month' | 'day',
  // 按日的日期范围
  dateRange: null as [string, string] | null,
  // 按年的年份范围
  yearRange: null as [string, string] | null,
  // 按月的月份范围
  monthRange: null as [string, string] | null,
})

// 当前日期选择器类型（yearrange / monthrange / daterange）
const currentDatePickerType = computed(() => {
  if (filterForm.dateQueryType === 'year') return 'yearrange'
  if (filterForm.dateQueryType === 'month') return 'monthrange'
  return 'daterange'
})

// 不同查询类型下的 value-format
const currentDateValueFormat = computed(() => {
  if (filterForm.dateQueryType === 'year') return 'YYYY'
  if (filterForm.dateQueryType === 'month') return 'YYYY-MM'
  return 'YYYY-MM-DD'
})

// 占位文案
const currentStartPlaceholder = computed(() => {
  if (filterForm.dateQueryType === 'year') return '开始年份'
  if (filterForm.dateQueryType === 'month') return '开始月份'
  return '开始日期'
})

const currentEndPlaceholder = computed(() => {
  if (filterForm.dateQueryType === 'year') return '结束年份'
  if (filterForm.dateQueryType === 'month') return '结束月份'
  return '结束日期'
})

// 统一提供给 el-date-picker 使用的 v-model
const dateRangeModel = computed<[string, string] | null>({
  get() {
    if (filterForm.dateQueryType === 'year') return filterForm.yearRange
    if (filterForm.dateQueryType === 'month') return filterForm.monthRange
    return filterForm.dateRange
  },
  set(val) {
    filterForm.yearRange = null
    filterForm.monthRange = null
    filterForm.dateRange = null
    if (!val) return
    if (filterForm.dateQueryType === 'year') {
      filterForm.yearRange = val
    } else if (filterForm.dateQueryType === 'month') {
      filterForm.monthRange = val
    } else {
      filterForm.dateRange = val
    }
  },
})

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
})

// 加载状态
const loading = ref(false)

// 报销单列表
const reimbursementList = ref<any[]>([])

// 审批过程弹窗
const approvalDialogVisible = ref(false)
const currentApprovalRecord = ref<any>(null)

// 确认收款状态
const confirmingReceipt = ref(false)

// 批次信息（审批弹窗用）
const batchInfoForDialog = ref<any>(null)

// 付款回单预览
const paymentProofDialogVisible = ref(false)
const previewingProofUrl = ref('')

// 判断路径是否为图片
function isImagePath(p: string): boolean {
  const lower = p.toLowerCase()
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')
}

// 判断是否为核减金额（报销金额为0，无需付款流程）
const isDeductionOnly = computed(() => {
  if (!currentApprovalRecord.value) return false
  const deductionAmount = currentApprovalRecord.value.deductionAmount || 0
  const totalAmount = currentApprovalRecord.value.totalAmount || currentApprovalRecord.value.amount || 0
  // 实际报销金额 = 总金额 - 核减金额
  const actualAmount = totalAmount - deductionAmount
  return actualAmount <= 0
})

// 获取报销单列表
const fetchReimbursementList = async () => {
  loading.value = true
  try {
    const params = new URLSearchParams({
      type: 'basic',
      page: pagination.page.toString(),
      pageSize: pagination.pageSize.toString(),
    })

    if (filterForm.status) {
      params.append('status', filterForm.status)
    }

    // 根据日期查询类型构建起止日期参数
    if (filterForm.dateQueryType === 'day' && filterForm.dateRange && filterForm.dateRange[0] && filterForm.dateRange[1]) {
      params.append('startDate', filterForm.dateRange[0])
      params.append('endDate', filterForm.dateRange[1])
    } else if (filterForm.dateQueryType === 'month' && filterForm.monthRange && filterForm.monthRange[0] && filterForm.monthRange[1]) {
      const [startYear, startMonth] = filterForm.monthRange[0].split('-')
      const [endYear, endMonth] = filterForm.monthRange[1].split('-')
      params.append('startDate', `${startYear}-${startMonth}-01`)
      const lastDay = new Date(parseInt(endYear), parseInt(endMonth), 0).getDate()
      params.append('endDate', `${endYear}-${endMonth}-${String(lastDay).padStart(2, '0')}`)
    } else if (filterForm.dateQueryType === 'year' && filterForm.yearRange && filterForm.yearRange[0] && filterForm.yearRange[1]) {
      params.append('startDate', `${filterForm.yearRange[0]}-01-01`)
      params.append('endDate', `${filterForm.yearRange[1]}-12-31`)
    }

    const response = await fetch(`/api/reimbursement/list?${params}`, {
      credentials: 'include',
    })

    const result = await response.json()

    if (result.success) {
      reimbursementList.value = result.data.list
      pagination.total = result.data.total
    } else {
      ElMessage.error(result.message || '获取列表失败')
    }
  } catch (error) {
    console.error('获取列表失败:', error)
    ElMessage.error('获取列表失败')
  } finally {
    loading.value = false
  }
}

// 获取状态类型（使用不同颜色区分各状态）
const getStatusType = (status: string) => {
  const typeMap: Record<string, any> = {
    draft: 'info',              // 草稿 - 灰色
    pending: 'warning',         // 待审批 - 黄色
    approved: '',               // 待付款 - 使用自定义颜色
    rejected: 'danger',         // 已驳回 - 红色
    payment_uploaded: '',       // 待确认 - 使用自定义颜色
    completed: 'success',       // 已完成 - 绿色
  }
  return typeMap[status] || 'info'
}

// 获取状态自定义颜色（用于区分相似状态）
const getStatusColor = (status: string) => {
  const colorMap: Record<string, string> = {
    approved: '#409eff',        // 待付款 - 蓝色
    payment_uploaded: '#17a2b8', // 待确认 - 青色
  }
  return colorMap[status] || ''
}

// 获取状态文本
const getStatusText = (status: string) => {
  const textMap: Record<string, string> = {
    draft: '草稿',
    pending: '待审批',
    approved: '待付款',
    rejected: '已驳回',
    payment_uploaded: '待确认',
    completed: '已完成',
  }
  return textMap[status] || status
}

// 判断是否可以编辑（只有草稿和已驳回状态可以编辑）
const canEdit = (status: string) => {
  return status === 'draft' || status === 'rejected'
}

// 判断是否可以删除（只有草稿状态可以删除）
const canDelete = (status: string) => {
  return status === 'draft'
}

// 新建报销单
const handleCreate = () => {
  router.push({
    path: '/basic-reimbursement/create',
    query: { from: '/basic-reimbursement' }
  })
}

// 查询
const handleSearch = () => {
  pagination.page = 1
  fetchReimbursementList()
}

// 重置
const handleReset = () => {
  filterForm.status = ''
  filterForm.dateQueryType = 'day'
  filterForm.dateRange = null
  filterForm.yearRange = null
  filterForm.monthRange = null
  handleSearch()
}

// 修改日期查询类型（年 / 月 / 日）
const handleDateQueryTypeChange = (type: 'year' | 'month' | 'day') => {
  filterForm.dateQueryType = type
  filterForm.dateRange = null
  filterForm.yearRange = null
  filterForm.monthRange = null
}

// 日期面板左侧快捷项：切换到按年 / 月 / 日查询（不直接关闭面板）
const dateTypeShortcuts = [
  {
    text: '年',
    onClick: () => {
      handleDateQueryTypeChange('year')
    },
  },
  {
    text: '月',
    onClick: () => {
      handleDateQueryTypeChange('month')
    },
  },
  {
    text: '日',
    onClick: () => {
      handleDateQueryTypeChange('day')
    },
  },
]

// 查看详情 - 打开审批流程弹窗
const handleView = async (row: any) => {
  try {
    // 获取报销单详情
    const response = await fetch(`/api/reimbursement/${row.id}`, {
      credentials: 'include',
    })
    const result = await response.json()
    if (result.success) {
      currentApprovalRecord.value = {
        ...result.data,
        applicant: result.data.applicantName || result.data.applicant || '申请人',
      }
      // 如果有批量付款批次，获取批次详情
      batchInfoForDialog.value = null
      if (result.data.paymentBatchId) {
        try {
          const batchRes = await fetch(`/api/reimbursement/payment-batch/${result.data.paymentBatchId}`, {
            credentials: 'include',
          })
          const batchResult = await batchRes.json()
          if (batchResult.success && batchResult.data.reimbursements.length > 1) {
            batchInfoForDialog.value = batchResult.data
          }
        } catch (e) {
          // 批次信息加载失败不影响主流程
        }
      }
      approvalDialogVisible.value = true
    } else {
      ElMessage.error(result.message || '获取详情失败')
    }
  } catch (error) {
    console.error('获取详情失败:', error)
    ElMessage.error('获取详情失败')
  }
}

// 跳转到报销单详情页
const handleGoToDetail = () => {
  if (!currentApprovalRecord.value) return
  approvalDialogVisible.value = false
  router.push({
    path: `/basic-reimbursement/${currentApprovalRecord.value.id}`,
    query: { mode: 'view', from: '/basic-reimbursement' }
  })
}

// 预览付款回单
const handlePreviewPaymentProof = (url?: string) => {
  previewingProofUrl.value = url || currentApprovalRecord.value?.paymentProofPath?.split(',')[0] || ''
  paymentProofDialogVisible.value = true
}

// 确认收款
const handleConfirmReceipt = async () => {
  if (!currentApprovalRecord.value) return

  try {
    const record = currentApprovalRecord.value
    let confirmMsg: string
    if (record.paymentBatchId && batchInfoForDialog.value) {
      const batch = batchInfoForDialog.value
      const items = batch.reimbursements.map((r: any) => {
        const isCurrent = r.id === record.id
        return `<div style="display:flex;justify-content:space-between;padding:4px 8px;background:${isCurrent ? 'rgba(64,158,255,0.08)' : '#f5f7fa'};border-radius:4px;margin-bottom:4px;${isCurrent ? 'border:1px solid rgba(64,158,255,0.3);' : ''}">
          <span>${r.id}${isCurrent ? ' <span style="color:#409eff;font-weight:600;">(本笔)</span>' : ''}</span>
          <span style="font-weight:600;">¥${parseFloat(r.amount).toFixed(2)}</span>
        </div>`
      }).join('')
      confirmMsg = `<div style="text-align:left;">
        <p style="margin-bottom:8px;">本次为<strong>批量付款</strong>，回单金额包含多笔报销：</p>
        <div style="margin-bottom:8px;">${items}</div>
        <div style="display:flex;justify-content:space-between;padding:8px;background:#f0f9eb;border-radius:4px;font-weight:600;">
          <span>回单付款总额</span>
          <span style="color:#67c23a;">¥${batch.totalAmount.toFixed(2)}</span>
        </div>
        <p style="margin-top:12px;color:#909399;font-size:13px;">确认后该批次下所有报销单将一并完成。</p>
      </div>`
    } else {
      confirmMsg = '确认已收到付款？确认后报销流程将完成。'
    }
    await ElMessageBox.confirm(confirmMsg, '确认收款', {
      confirmButtonText: '确认收款',
      cancelButtonText: '取消',
      type: 'success',
      dangerouslyUseHTMLString: !!batchInfoForDialog.value,
    })

    confirmingReceipt.value = true

    const url = record.paymentBatchId
      ? `/api/reimbursement/payment-batch/${record.paymentBatchId}/confirm-receipt`
      : `/api/reimbursement/${record.id}/confirm-receipt`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    })

    const result = await response.json()

    if (result.success) {
      ElMessage.success('已确认收款，报销流程完成')
      // 立即更新本地列表状态，避免等待网络请求的延迟
      if (record.paymentBatchId && batchInfoForDialog.value) {
        const batchIds = new Set(batchInfoForDialog.value.reimbursements.map((r: any) => r.id))
        reimbursementList.value.forEach((item: any) => {
          if (batchIds.has(item.id)) {
            item.status = 'completed'
          }
        })
      } else {
        const target = reimbursementList.value.find((item: any) => item.id === record.id)
        if (target) target.status = 'completed'
      }
      approvalDialogVisible.value = false
      // 立即刷新待办计数
      await pendingStore.refreshPendingCounts()
      // 刷新列表
      fetchReimbursementList()
    } else {
      ElMessage.error(result.message || '确认收款失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('确认收款失败:', error)
      ElMessage.error('确认收款失败')
    }
  } finally {
    confirmingReceipt.value = false
  }
}

// 编辑
const handleEdit = (row: any) => {
  router.push({
    path: `/basic-reimbursement/${row.id}`,
    query: { mode: 'edit', from: '/basic-reimbursement' }
  })
}

// 撤回
const handleWithdraw = (row: any) => {
  ElMessageBox.confirm('确定要撤回该报销单吗？撤回后将回到草稿状态。', '确认撤回', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  })
    .then(async () => {
      try {
        const response = await fetch(`/api/reimbursement/${row.id}/withdraw`, {
          method: 'POST',
          credentials: 'include',
        })
        const result = await response.json()
        if (result.success) {
          ElMessage.success('撤回成功')
          fetchReimbursementList()
        } else {
          ElMessage.error(result.message || '撤回失败')
        }
      } catch {
        ElMessage.error('撤回失败')
      }
    })
    .catch(() => {})
}

// 删除
const handleDelete = (row: any) => {
  ElMessageBox.confirm('确定要删除这条报销单吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  })
    .then(async () => {
      try {
        const response = await fetch(`/api/reimbursement/${row.id}`, {
          method: 'DELETE',
          credentials: 'include',
        })

        const result = await response.json()

        if (result.success) {
          ElMessage.success('删除成功')
          // 重新加载列表
          fetchReimbursementList()
        } else {
          ElMessage.error(result.message || '删除失败')
        }
      } catch (error) {
        console.error('删除失败:', error)
        ElMessage.error('删除失败')
      }
    })
    .catch(() => {
      // 用户取消删除
    })
}

// 分页变化
const handleSizeChange = (size: number) => {
  pagination.pageSize = size
  fetchReimbursementList()
}

const handlePageChange = (page: number) => {
  pagination.page = page
  fetchReimbursementList()
}

// 组件挂载
onMounted(() => {
  fetchReimbursementList()
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.basic-reimbursement-container {
  height: calc(100vh - 60px);
  margin: calc(-1 * var(--yl-main-padding-y, 24px)) calc(-1 * var(--yl-main-padding-x, 45px));
  padding: 0;
}

.page-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: none;
  box-shadow: none;
}

.page-card :deep(.el-card__header) {
  padding: 16px 24px;
  border-bottom: 1px solid #e4e7ed;
}

.page-card :deep(.el-card__body) {
  flex: 1;
  padding: 24px;
  overflow: auto;
}

.card-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.card-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.filter-section {
  margin-bottom: 20px;
  padding: 16px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.alert-info {
  margin-bottom: 20px;
}

.alert-info p {
  margin: 4px 0;
  font-size: 13px;
}

.filter-form {
  margin: 0;
}

.amount-text {
  color: #f56c6c;
  font-weight: 600;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

/* 审批详情弹窗 */
.approval-detail {
  padding: 0 10px;
}

.info-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}

.amount-highlight {
  color: #409eff;
  font-weight: 600;
  font-size: 16px;
}

.timeline-section {
  margin-top: 24px;
}

.timeline-content {
  padding: 4px 0;
}

.timeline-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.timeline-desc {
  font-size: 14px;
  color: #606266;
}

.timeline-description {
  margin-top: 6px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 13px;
  color: #606266;
  line-height: 1.5;
  white-space: pre-wrap;
}

.timeline-desc.reject-reason {
  color: #f56c6c;
  margin-top: 4px;
}

/* 付款回单预览 */
.payment-proof-preview {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.proof-card {
  position: relative;
  width: min(200px, 45%);
  height: 140px;
  border: 2px solid #67c23a;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: #f8fafc;
}

.proof-card:hover .proof-overlay {
  opacity: 1;
}

.proof-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.proof-pdf {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: #64748b;
  font-size: 12px;
}

.proof-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  opacity: 0;
  transition: opacity 0.3s;
  gap: 4px;
  font-size: 12px;
}

/* 预览对话框样式 */
.preview-dialog-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.preview-dialog-image {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}

.preview-dialog-pdf {
  width: 100%;
  height: 70vh;
  border: none;
}

/* 批量付款金额对照 */
.batch-amount-compare {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 12px;
  margin-top: 12px;
  margin-bottom: 12px;
}

.batch-compare-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.batch-compare-no {
  font-size: 12px;
  color: #92400e;
}

.batch-compare-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.batch-compare-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #92400e;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 4px;
}

.batch-compare-item.is-current {
  background: rgba(64, 158, 255, 0.08);
  border: 1px solid rgba(64, 158, 255, 0.3);
}

.batch-compare-id {
  font-family: monospace;
  font-size: 11px;
}

.batch-compare-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-compare-amount {
  margin-left: auto;
  font-weight: 600;
}

.batch-compare-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  background: #f0f9eb;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
}

.batch-compare-total-amount {
  color: #67c23a;
}
</style>
