<template>
  <div class="basic-reimbursement-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <h2>基础报销</h2>
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
            <p>此页面仅显示最近一个月内的报销数据，超过一个月的历史数据请在"报销统计"中查看。</p>
          </template>
        </el-alert>

        <!-- 筛选区域 -->
        <div class="filter-section">
          <el-form :inline="true" :model="filterForm" class="filter-form">
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
                :shortcuts="dateShortcuts"
                :disabled-date="disabledDate"
                value-format="YYYY-MM-DD"
                style="width: 260px"
                @change="handleDateRangeChange"
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
          <el-table-column label="序号" width="80" align="center">
            <template #default="{ $index }">
              {{ (pagination.page - 1) * pagination.pageSize + $index + 1 }}
            </template>
          </el-table-column>
          <el-table-column prop="title" label="报销事由" min-width="200" />
          <el-table-column prop="amount" label="报销金额" width="120">
            <template #default="{ row }">
              <span class="amount-text">¥{{ row.amount.toFixed(2) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="category" label="报销类型" width="120" />
          <el-table-column prop="status" label="状态" width="120">
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
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="handleView(row)">
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
                <el-descriptions-item label="报销事由" :span="2">{{ currentApprovalRecord.title }}</el-descriptions-item>
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
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Refresh, Document, ZoomIn } from '@element-plus/icons-vue'

const router = useRouter()

// 计算默认日期范围（最近一个月）
const getDefaultDateRange = (): [Date, Date] => {
  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - 1)
  return [start, end]
}

// 筛选表单
const filterForm = reactive({
  status: '',
  dateRange: getDefaultDateRange() as [Date, Date] | null,
})

// 日期选择器快捷选项
const dateShortcuts = [
  {
    text: '最近一周',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - 7)
      return [start, end]
    },
  },
  {
    text: '最近两周',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - 14)
      return [start, end]
    },
  },
  {
    text: '最近一个月',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setMonth(start.getMonth() - 1)
      return [start, end]
    },
  },
]

// 禁用超过一个月范围的日期
const disabledDate = (time: Date) => {
  // 不能选择未来的日期
  if (time.getTime() > Date.now()) {
    return true
  }
  return false
}

// 日期范围变化时的校验
const handleDateRangeChange = (val: [Date, Date] | null) => {
  if (val && val[0] && val[1]) {
    const diffTime = Math.abs(val[1].getTime() - val[0].getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    if (diffDays > 31) {
      ElMessage.warning('日期范围不能超过一个月，已自动调整')
      const newStart = new Date(val[1])
      newStart.setMonth(newStart.getMonth() - 1)
      filterForm.dateRange = [newStart, val[1]]
    }
  }
}

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
})

// 加载状态
const loading = ref(false)

// 报销单列表
const reimbursementList = ref([])

// 审批过程弹窗
const approvalDialogVisible = ref(false)
const currentApprovalRecord = ref<any>(null)

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

    if (filterForm.dateRange && filterForm.dateRange[0] && filterForm.dateRange[1]) {
      params.append('startDate', filterForm.dateRange[0] as unknown as string)
      params.append('endDate', filterForm.dateRange[1] as unknown as string)
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

// 获取状态文本
const getStatusText = (status: string) => {
  const textMap: Record<string, string> = {
    draft: '草稿',
    pending: '待审批',
    approved: '已审批未付款',
    rejected: '已拒绝',
    paying: '付款中',
    payment_uploaded: '待确认',
    completed: '已完成',
  }
  return textMap[status] || status
}

// 判断是否可以编辑（只有草稿和已拒绝状态可以编辑）
const canEdit = (status: string) => {
  return status === 'draft' || status === 'rejected'
}

// 判断是否可以删除（只有草稿状态可以删除）
const canDelete = (status: string) => {
  return status === 'draft'
}

// 新建报销单
const handleCreate = () => {
  router.push('/basic-reimbursement/create')
}

// 查询
const handleSearch = () => {
  pagination.page = 1
  fetchReimbursementList()
}

// 重置
const handleReset = () => {
  filterForm.status = ''
  filterForm.dateRange = getDefaultDateRange()
  handleSearch()
}

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
  router.push(`/basic-reimbursement/${currentApprovalRecord.value.id}?mode=view`)
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
  router.push(`/basic-reimbursement/${row.id}?mode=edit`)
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
