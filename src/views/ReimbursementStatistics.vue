<template>
  <div class="reimbursement-statistics-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <h2>报销统计</h2>
          <el-button :icon="Refresh" @click="handleRefresh">刷新</el-button>
        </div>
      </template>

      <div class="content-wrapper">
        <!-- 统计卡片区域 -->
        <div class="statistics-cards">
          <el-card class="stat-card" shadow="hover">
            <div class="stat-content">
              <div class="stat-icon pending">
                <el-icon><Clock /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-label">待审批</div>
                <div class="stat-value">{{ statistics.pending.count }}</div>
                <div class="stat-amount">¥{{ statistics.pending.amount.toFixed(2) }}</div>
              </div>
            </div>
          </el-card>

          <el-card class="stat-card" shadow="hover">
            <div class="stat-content">
              <div class="stat-icon unpaid">
                <el-icon><Warning /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-label">未付款</div>
                <div class="stat-value">{{ statistics.approved.count }}</div>
                <div class="stat-amount">¥{{ statistics.approved.amount.toFixed(2) }}</div>
              </div>
            </div>
          </el-card>

          <el-card class="stat-card" shadow="hover">
            <div class="stat-content">
              <div class="stat-icon completed">
                <el-icon><CircleCheck /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-label">已完成</div>
                <div class="stat-value">{{ statistics.completed.count }}</div>
                <div class="stat-amount">¥{{ statistics.completed.amount.toFixed(2) }}</div>
              </div>
            </div>
          </el-card>

          <el-card class="stat-card" shadow="hover">
            <div class="stat-content">
              <div class="stat-icon total">
                <el-icon><Wallet /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-label">总金额</div>
                <div class="stat-value">{{ statistics.total.count }}</div>
                <div class="stat-amount">¥{{ statistics.total.amount.toFixed(2) }}</div>
              </div>
            </div>
          </el-card>
        </div>

        <!-- 筛选区域 -->
        <div class="filter-section">
          <el-form :inline="true" :model="filterForm" class="filter-form">
            <el-form-item label="报销类型">
              <el-select v-model="filterForm.type" placeholder="全部" clearable style="width: 140px">
                <el-option label="全部" value="" />
                <el-option label="基础报销" value="basic" />
                <el-option label="大额报销" value="large" />
                <el-option label="商务报销" value="business" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="filterForm.status" placeholder="全部状态" clearable style="width: 140px">
                <el-option label="草稿" value="draft" />
                <el-option label="待审批" value="pending" />
                <el-option label="已审批未付款" value="approved" />
                <el-option label="已拒绝" value="rejected" />
                <el-option label="待确认" value="payment_uploaded" />
                <el-option label="已完成" value="completed" />
              </el-select>
            </el-form-item>
            <el-form-item label="日期范围">
              <el-date-picker
                v-model="filterForm.dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                style="width: 260px"
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

        <!-- 审批记录列表 -->
        <el-table
          v-loading="loading"
          :data="recordList"
          stripe
          style="width: 100%"
        >
          <el-table-column label="序号" width="80" align="center">
            <template #default="{ $index }">
              {{ (pagination.page - 1) * pagination.pageSize + $index + 1 }}
            </template>
          </el-table-column>
          <el-table-column prop="type" label="报销类型" width="120">
            <template #default="{ row }">
              {{ getTypeText(row.type) }}
            </template>
          </el-table-column>
          <el-table-column prop="title" label="报销事由" min-width="200" />
          <el-table-column prop="applicant" label="申请人" width="100" />
          <el-table-column prop="amount" label="报销金额" width="120">
            <template #default="{ row }">
              <span class="amount-text">¥{{ row.amount.toFixed(2) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
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
          <el-table-column prop="submitTime" label="提交时间" width="180" />
          <el-table-column prop="approveTime" label="审批时间" width="180">
            <template #default="{ row }">
              {{ row.approveTime || '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="approver" label="审批人" width="100">
            <template #default="{ row }">
              {{ row.approver || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="handleViewApproval(row)">
                查看详情
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 拒绝原因弹窗 -->
        <el-dialog
          v-model="rejectDialogVisible"
          title="拒绝原因"
          width="500px"
          :close-on-click-modal="false"
        >
          <el-form :model="rejectForm" label-width="80px">
            <el-form-item label="拒绝原因" required>
              <el-input
                v-model="rejectForm.reason"
                type="textarea"
                :rows="4"
                placeholder="请输入拒绝原因"
                maxlength="200"
                show-word-limit
              />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="rejectDialogVisible = false">取消</el-button>
            <el-button type="danger" :loading="approving" @click="confirmReject">确认拒绝</el-button>
          </template>
        </el-dialog>

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
                <el-descriptions-item label="报销类型">{{ getTypeText(currentApprovalRecord.type) }}</el-descriptions-item>
                <el-descriptions-item label="报销事由" :span="2">{{ currentApprovalRecord.title }}</el-descriptions-item>
                <el-descriptions-item label="申请人">{{ currentApprovalRecord.applicant }}</el-descriptions-item>
                <el-descriptions-item label="报销金额">
                  <span class="amount-highlight">¥{{ currentApprovalRecord.amount.toFixed(2) }}</span>
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
                  </div>
                </el-timeline-item>

                <!-- 2. 管理员审批 -->
                <el-timeline-item
                  v-if="['approved', 'paying', 'payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
                  :timestamp="currentApprovalRecord.approveTime"
                  placement="top"
                  type="success"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">管理员审批</div>
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
                    <div class="timeline-title">管理员审批</div>
                    <div class="timeline-desc">{{ currentApprovalRecord.approver || '管理员' }} 拒绝了申请</div>
                    <div v-if="currentApprovalRecord.rejectReason" class="timeline-desc reject-reason">
                      拒绝原因：{{ currentApprovalRecord.rejectReason }}
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
                    <div class="timeline-title">管理员审批</div>
                    <div class="timeline-desc">等待管理员审批...</div>
                  </div>
                </el-timeline-item>

                <!-- 3. 财务付款 -->
                <el-timeline-item
                  v-if="['paying', 'payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
                  :timestamp="currentApprovalRecord.payTime || ''"
                  placement="top"
                  :type="currentApprovalRecord.status === 'paying' ? 'warning' : 'success'"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">财务付款</div>
                    <div class="timeline-desc">{{ currentApprovalRecord.status === 'paying' ? '等待财务付款...' : '财务已付款' }}</div>
                  </div>
                </el-timeline-item>

                <!-- 4. 上传付款凭证 -->
                <el-timeline-item
                  v-if="['payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
                  :timestamp="currentApprovalRecord.paymentUploadTime || ''"
                  placement="top"
                  type="success"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">上传付款凭证</div>
                    <div class="timeline-desc">财务已上传付款凭证</div>
                    <!-- 付款回单展示 -->
                    <div v-if="currentApprovalRecord.paymentProofPath" class="payment-proof-preview">
                      <div class="proof-card" @click="handlePreviewPaymentProof">
                        <template v-if="isPaymentProofImage">
                          <img :src="currentApprovalRecord.paymentProofPath" class="proof-image" alt="付款回单" />
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

                <!-- 5. 付款完成 -->
                <el-timeline-item
                  v-if="currentApprovalRecord.status === 'completed'"
                  :timestamp="currentApprovalRecord.completedTime || ''"
                  placement="top"
                  type="success"
                >
                  <div class="timeline-content">
                    <div class="timeline-title">付款完成</div>
                    <div class="timeline-desc">报销流程已完成</div>
                    <div v-if="currentApprovalRecord.receiptConfirmedBy" class="timeline-desc" style="margin-top: 4px; color: #67c23a;">
                      {{ currentApprovalRecord.receiptConfirmedBy }}已确认收款
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
            <img v-if="isPaymentProofImage && currentApprovalRecord?.paymentProofPath" :src="currentApprovalRecord.paymentProofPath" class="preview-dialog-image" alt="付款回单" />
            <iframe v-else-if="currentApprovalRecord?.paymentProofPath" :src="currentApprovalRecord.paymentProofPath" class="preview-dialog-pdf" />
          </div>
        </el-dialog>

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
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Search, Clock, CircleCheck, Wallet, Warning, Document, ZoomIn } from '@element-plus/icons-vue'

const router = useRouter()

// 统计数据
const statistics = reactive({
  pending: {
    count: 0,
    amount: 0,
  },
  approved: {
    count: 0,
    amount: 0,
  },
  completed: {
    count: 0,
    amount: 0,
  },
  total: {
    count: 0,
    amount: 0,
  },
})

// 筛选表单
const filterForm = reactive({
  type: '',
  status: '',
  dateRange: null as any,
})

// 审批记录列表
const recordList = ref<any[]>([])
const loading = ref(false)

// 审批过程弹窗
const approvalDialogVisible = ref(false)
const currentApprovalRecord = ref<any>(null)

// 拒绝原因弹窗
const rejectDialogVisible = ref(false)
const rejectForm = reactive({
  reason: '',
})
const approving = ref(false)

// 确认收款状态
const confirmingReceipt = ref(false)

// 付款回单预览
const paymentProofDialogVisible = ref(false)

// 判断付款回单是否为图片
const isPaymentProofImage = computed(() => {
  if (!currentApprovalRecord.value?.paymentProofPath) return false
  const path = currentApprovalRecord.value.paymentProofPath.toLowerCase()
  return path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.png')
})

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
})

// 获取统计数据（支持筛选条件）
const fetchStatistics = async () => {
  try {
    const params = new URLSearchParams()

    if (filterForm.type) {
      params.append('type', filterForm.type)
    }
    if (filterForm.dateRange && filterForm.dateRange[0]) {
      params.append('startDate', filterForm.dateRange[0])
    }
    if (filterForm.dateRange && filterForm.dateRange[1]) {
      params.append('endDate', filterForm.dateRange[1])
    }

    const url = params.toString() ? `/api/reimbursement/statistics?${params}` : '/api/reimbursement/statistics'
    const response = await fetch(url, {
      credentials: 'include',
    })
    const result = await response.json()
    if (result.success) {
      Object.assign(statistics, result.data)
    } else {
      ElMessage.error(result.message || '获取统计数据失败')
    }
  } catch (error) {
    console.error('获取统计数据失败:', error)
    ElMessage.error('获取统计数据失败')
  }
}

// 获取审批记录列表
const fetchRecordList = async () => {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: pagination.page.toString(),
      pageSize: pagination.pageSize.toString(),
    })

    if (filterForm.type) {
      params.append('type', filterForm.type)
    }
    if (filterForm.status) {
      params.append('status', filterForm.status)
    }
    if (filterForm.dateRange && filterForm.dateRange[0]) {
      params.append('startDate', filterForm.dateRange[0])
    }
    if (filterForm.dateRange && filterForm.dateRange[1]) {
      params.append('endDate', filterForm.dateRange[1])
    }

    const response = await fetch(`/api/reimbursement/records?${params}`, {
      credentials: 'include',
    })
    const result = await response.json()
    if (result.success) {
      recordList.value = result.data.list
      pagination.total = result.data.total
    } else {
      ElMessage.error(result.message || '获取审批记录失败')
    }
  } catch (error) {
    console.error('获取审批记录失败:', error)
    ElMessage.error('获取审批记录失败')
  } finally {
    loading.value = false
  }
}

// 刷新数据
const handleRefresh = () => {
  fetchStatistics()
  fetchRecordList()
  ElMessage.success('数据已刷新')
}

// 查询
const handleSearch = () => {
  pagination.page = 1
  fetchStatistics()
  fetchRecordList()
}

// 重置
const handleReset = () => {
  filterForm.type = ''
  filterForm.status = ''
  filterForm.dateRange = null
  pagination.page = 1
  fetchStatistics()
  fetchRecordList()
}

// 分页变化
const handleSizeChange = () => {
  fetchRecordList()
}

const handlePageChange = () => {
  fetchRecordList()
}

// 查看审批过程
const handleViewApproval = (row: any) => {
  currentApprovalRecord.value = row
  approvalDialogVisible.value = true
}

// 跳转到报销单详情
const handleGoToDetail = () => {
  if (!currentApprovalRecord.value) return

  const row = currentApprovalRecord.value
  const routeMap: Record<string, string> = {
    basic: '/basic-reimbursement',
    business: '/business-reimbursement',
    large: '/large-reimbursement',
  }
  const routePath = routeMap[row.type]
  if (routePath) {
    approvalDialogVisible.value = false
    // 添加 from 参数，使详情页返回时能回到报销统计页面
    router.push(`${routePath}/${row.id}?mode=view&from=/reimbursement-statistics`)
  }
}

// 预览付款回单
const handlePreviewPaymentProof = () => {
  paymentProofDialogVisible.value = true
}

// 确认收款
const handleConfirmReceipt = async () => {
  if (!currentApprovalRecord.value) return

  try {
    await ElMessageBox.confirm('确认已收到付款？确认后报销流程将完成。', '确认收款', {
      confirmButtonText: '确认收款',
      cancelButtonText: '取消',
      type: 'success',
    })

    confirmingReceipt.value = true

    const response = await fetch(`/api/reimbursement/${currentApprovalRecord.value.id}/confirm-receipt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    })

    const result = await response.json()

    if (result.success) {
      ElMessage.success('已确认收款，报销流程完成')
      approvalDialogVisible.value = false
      // 刷新数据
      await fetchStatistics()
      await fetchRecordList()
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

// 审批通过
const handleApprove = async () => {
  if (!currentApprovalRecord.value) return

  try {
    await ElMessageBox.confirm('确认通过该报销申请？', '审批确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'success',
    })

    approving.value = true

    const response = await fetch(`/api/reimbursement/${currentApprovalRecord.value.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        action: 'approve',
      }),
    })

    const result = await response.json()

    if (result.success) {
      ElMessage.success('审批通过')
      approvalDialogVisible.value = false
      // 刷新数据
      await fetchStatistics()
      await fetchRecordList()
    } else {
      ElMessage.error(result.message || '审批失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('审批失败:', error)
      ElMessage.error('审批失败')
    }
  } finally {
    approving.value = false
  }
}

// 拒绝
const handleReject = () => {
  rejectForm.reason = ''
  rejectDialogVisible.value = true
}

// 确认拒绝
const confirmReject = async () => {
  if (!currentApprovalRecord.value) return

  if (!rejectForm.reason.trim()) {
    ElMessage.warning('请输入拒绝原因')
    return
  }

  try {
    approving.value = true

    const response = await fetch(`/api/reimbursement/${currentApprovalRecord.value.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        action: 'reject',
        reason: rejectForm.reason,
      }),
    })

    const result = await response.json()

    if (result.success) {
      ElMessage.success('已拒绝')
      rejectDialogVisible.value = false
      approvalDialogVisible.value = false
      // 刷新数据
      await fetchStatistics()
      await fetchRecordList()
    } else {
      ElMessage.error(result.message || '操作失败')
    }
  } catch (error) {
    console.error('拒绝失败:', error)
    ElMessage.error('操作失败')
  } finally {
    approving.value = false
  }
}

// 获取类型文本
const getTypeText = (type: string) => {
  const typeMap: Record<string, string> = {
    basic: '基础报销',
    business: '商务报销',
    large: '大额报销',
  }
  return typeMap[type] || type
}

// 获取状态文本
const getStatusText = (status: string) => {
  const statusMap: Record<string, string> = {
    draft: '草稿',
    pending: '待审批',
    approved: '已审批未付款',
    rejected: '已拒绝',
    paying: '付款中',
    payment_uploaded: '待确认',
    completed: '已完成',
  }
  return statusMap[status] || status
}

// 获取状态类型（使用不同颜色区分各状态）
const getStatusType = (status: string) => {
  const typeMap: Record<string, any> = {
    draft: 'info',              // 草稿 - 灰色
    pending: 'warning',         // 待审批 - 黄色
    approved: '',               // 已审批未付款 - 使用自定义颜色
    rejected: 'danger',         // 已拒绝 - 红色
    paying: '',                 // 付款中 - 使用自定义颜色
    payment_uploaded: '',       // 待确认 - 使用自定义颜色
    completed: 'success',       // 已完成 - 绿色
  }
  return typeMap[status] || 'info'
}

// 获取状态自定义颜色（用于区分相似状态）
const getStatusColor = (status: string) => {
  const colorMap: Record<string, string> = {
    approved: '#409eff',        // 已审批未付款 - 蓝色
    paying: '#9b59b6',          // 付款中 - 紫色
    payment_uploaded: '#17a2b8', // 待确认 - 青色
  }
  return colorMap[status] || ''
}

onMounted(() => {
  fetchStatistics()
  fetchRecordList()
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.reimbursement-statistics-container {
  height: calc(100vh - 60px);
  margin: -24px;
  padding: 0;
}

.page-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: none;
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
  justify-content: space-between;
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
  overflow-y: auto;
  padding: 20px 0;
}

/* 统计卡片 */
.statistics-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.stat-card {
  cursor: pointer;
  transition: all 0.3s;
}

.stat-card:hover {
  transform: translateY(-4px);
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: #fff;
}

.stat-icon.pending {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.stat-icon.unpaid {
  background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
}

.stat-icon.completed {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
}

.stat-icon.total {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.stat-info {
  flex: 1;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
  line-height: 1;
  margin-bottom: 4px;
}

.stat-amount {
  font-size: 14px;
  color: #606266;
  font-weight: 500;
}

/* 筛选区域 */
.filter-section {
  margin-bottom: 20px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.filter-form {
  margin: 0;
}

.filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 16px;
}

.filter-form :deep(.el-select) {
  width: 140px !important;
  min-width: 140px !important;
}

.filter-form :deep(.el-select .el-input) {
  width: 140px !important;
}

.filter-form :deep(.el-select .el-input__wrapper) {
  width: 140px !important;
}

/* 金额文本 */
.amount-text {
  color: #409eff;
  font-weight: 600;
}

/* 分页 */
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

.timeline-desc.reject-reason {
  color: #f56c6c;
  margin-top: 4px;
}

/* 付款回单预览 */
.payment-proof-preview {
  margin-top: 12px;
}

.proof-card {
  position: relative;
  width: 200px;
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
</style>
