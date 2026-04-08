<template>
  <div class="probation-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <h2>转正申请</h2>
        </div>
      </template>

      <!-- 加载中 -->
      <div v-if="loading" class="loading-wrapper">
        <el-skeleton :rows="5" animated />
      </div>

      <!-- 无转正记录 -->
      <div v-else-if="!myStatus" class="empty-wrapper">
        <el-empty description="暂无转正记录" />
      </div>

      <div v-else class="my-probation">
        <!-- 已转正成功横幅 -->
        <el-result
          v-if="myStatus.confirmation?.status === 'approved'"
          icon="success"
          title="恭喜，您已正式转正！"
          :sub-title="`转正时间：${formatDateTime(myStatus.confirmation?.approve_time)}`"
          class="approved-banner"
        >
          <template #extra>
            <el-button type="primary" @click="approvalFlowDialogVisible = true">查看审批流程</el-button>
          </template>
        </el-result>

        <!-- 驳回提示 -->
        <el-alert
          v-if="myStatus.confirmation?.status === 'rejected'"
          type="error"
          :closable="false"
          show-icon
          style="margin-bottom: 16px;"
        >
          <template #title>
            您的转正申请已被驳回，请重新上传申请表后再次提交
          </template>
          <template #default>
            <span v-if="myStatus.confirmation?.approver_comment">
              驳回原因：{{ myStatus.confirmation.approver_comment }}
            </span>
          </template>
        </el-alert>

        <!-- 待审批提示 -->
        <el-alert
          v-if="myStatus.confirmation?.status === 'submitted'"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 16px;"
        >
          <template #title>转正申请已提交，等待总经理审批</template>
        </el-alert>

        <!-- 提示信息（实习期/未提交） -->
        <el-alert
          v-if="myStatus.confirmation?.status === 'pending'"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 16px;"
        >
          <template #title>请下载统一模板填写后上传提交</template>
        </el-alert>

        <!-- 转正信息表格 -->
        <el-table
          :data="[myStatus.confirmation]"
          stripe
          style="width: 100%"
          :header-cell-style="{ textAlign: 'center' }"
          :cell-style="{ textAlign: 'center' }"
        >
          <el-table-column type="index" label="序号" width="60" />
          <el-table-column label="申请人" min-width="80">
            <template #default>{{ myStatus.profile?.name || '-' }}</template>
          </el-table-column>
          <el-table-column label="部门" min-width="100">
            <template #default>{{ myStatus.profile?.department || '-' }}</template>
          </el-table-column>
          <el-table-column label="职位" min-width="100">
            <template #default>{{ myStatus.profile?.position || '-' }}</template>
          </el-table-column>
          <el-table-column label="入职时间" min-width="90">
            <template #default>{{ formatDate(myStatus.profile?.hire_date) }}</template>
          </el-table-column>
          <el-table-column label="试用期截止" min-width="90">
            <template #default>{{ formatDate(myStatus.confirmation?.probation_end_date) }}</template>
          </el-table-column>
          <el-table-column label="剩余天数" min-width="70">
            <template #default>
              <span :class="getRemainingDaysClass(myStatus.confirmation?.probation_end_date)">
                {{ getRemainingDays(myStatus.confirmation?.probation_end_date) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="转正申请模板" min-width="100">
            <template #default>
              <el-button v-if="templates.length > 0" type="primary" link size="small" @click="handleDownloadTemplate(templates[0])">
                下载模板
              </el-button>
              <span v-else class="text-gray">暂无模板</span>
            </template>
          </el-table-column>
          <el-table-column label="转正申请表" min-width="150">
            <template #default>
              <template v-if="myStatus.documents && myStatus.documents.length > 0">
                <el-button type="primary" link size="small" @click="handleViewDocs">
                  查看文件 ({{ myStatus.documents.length }})
                </el-button>
                <el-button
                  v-if="myStatus.confirmation?.status === 'pending' || myStatus.confirmation?.status === 'rejected'"
                  type="danger"
                  link
                  size="small"
                  @click="handleDeleteDoc(myStatus.documents[0])"
                >
                  删除
                </el-button>
              </template>
              <el-upload
                v-else-if="myStatus.confirmation?.status === 'pending' || myStatus.confirmation?.status === 'rejected'"
                :action="uploadUrl"
                :headers="uploadHeaders"
                :before-upload="beforeUpload"
                :on-success="handleUploadSuccess"
                :on-error="handleUploadError"
                :show-file-list="false"
                :with-credentials="true"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              >
                <el-button type="primary" size="small">上传文件</el-button>
              </el-upload>
              <span v-else class="text-gray">-</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" min-width="80">
            <template #default>
              <el-tag :type="getStatusType(myStatus.confirmation?.status)" size="small">
                {{ getStatusText(myStatus.confirmation?.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" min-width="200">
            <template #default>
              <el-button type="primary" link @click="handleViewDetail">查看详情</el-button>
              <el-button
                v-if="canSubmit"
                type="success"
                link
                :loading="submitting"
                @click="handleSubmitApplication"
              >
                提交申请
              </el-button>
              <!-- 只有已提交/已审批/已驳回才显示审批流程 -->
              <el-button
                v-if="['submitted', 'approved', 'rejected'].includes(myStatus.confirmation?.status ?? '')"
                type="info"
                link
                @click="handleViewApprovalFlow"
              >
                审批流程
              </el-button>
              <!-- 撤回：仅待审批状态 -->
              <el-button
                v-if="myStatus.confirmation?.status === 'submitted'"
                type="warning"
                link
                @click="handleWithdraw"
              >
                撤回申请
              </el-button>
              <!-- 硬删除：驳回或撤回后（pending 且有历史记录）状态 -->
              <el-button
                v-if="myStatus.confirmation?.status === 'rejected' || (myStatus.confirmation?.status === 'pending' && (approvalFlowData?.records?.length ?? 0) > 0)"
                type="danger"
                link
                @click="handleDeleteRecord"
              >
                删除记录
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog v-model="detailDialogVisible" title="转正详情" width="800px" :close-on-click-modal="false">
      <div v-if="myStatus" class="detail-content">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{ myStatus.profile?.name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="部门">{{ myStatus.profile?.department || '-' }}</el-descriptions-item>
          <el-descriptions-item label="职位">{{ myStatus.profile?.position || '-' }}</el-descriptions-item>
          <el-descriptions-item label="入职日期">{{ formatDate(myStatus.profile?.hire_date) }}</el-descriptions-item>
          <el-descriptions-item label="试用期截止">{{ formatDate(myStatus.confirmation?.probation_end_date) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="getStatusType(myStatus.confirmation?.status)">
              {{ getStatusText(myStatus.confirmation?.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item v-if="myStatus.confirmation?.submit_time" label="提交时间" :span="2">
            {{ formatDateTime(myStatus.confirmation?.submit_time) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="myStatus.confirmation?.status === 'approved' || myStatus.confirmation?.status === 'rejected'" label="审批时间">
            {{ formatDateTime(myStatus.confirmation?.approve_time) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="myStatus.confirmation?.approver_comment" label="审批意见" :span="2">
            <div class="comment-content">{{ myStatus.confirmation?.approver_comment }}</div>
          </el-descriptions-item>
        </el-descriptions>
        <div v-if="myStatus.documents && myStatus.documents.length > 0" class="documents-section">
          <h4>转正文件</h4>
          <el-table :data="myStatus.documents" stripe size="small">
            <el-table-column prop="file_name" label="文件名" />
            <el-table-column prop="uploaded_by_name" label="上传人" width="100" />
            <el-table-column label="上传时间" width="160">
              <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" min-width="100">
              <template #default="{ row }">
                <el-button type="primary" link @click="handleDownload(row)">下载</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 审批流程对话框（统一样式） -->
    <el-dialog v-model="approvalFlowDialogVisible" title="审批流程" width="560px" :close-on-click-modal="false">
      <div v-if="myStatus" class="flow-dialog">
        <!-- 基本信息 -->
        <el-descriptions :column="2" border size="small" style="margin-bottom: 20px;">
          <el-descriptions-item label="申请人">{{ myStatus.profile?.name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="部门">{{ myStatus.profile?.department || '-' }}</el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag :type="getStatusType(myStatus.confirmation?.status)" size="small">
              {{ getStatusText(myStatus.confirmation?.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{ myStatus.confirmation?.submit_time ? formatDateTime(myStatus.confirmation.submit_time) : '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 时间线 -->
        <div class="flow-section-title">审批流程</div>
        <el-timeline v-if="!flowLoading">
          <!-- 所有历史记录（过滤 cc 和 withdraw） -->
          <el-timeline-item
            v-for="record in (approvalFlowData?.records || []).filter((r: any) => r.action !== 'cc' && r.action !== 'withdraw')"
            :key="record.id"
            :timestamp="formatDateTime(record.action_time)"
            placement="top"
            :type="getActionType(record.action)"
          >
            <div class="tl-title">{{ getActionTitle(record) }}</div>
            <!-- submit/resubmit/withdraw 显示描述文字，其他显示 tag -->
            <div v-if="['submit', 'resubmit', 'withdraw'].includes(record.action)" class="tl-desc">
              <template v-if="record.action === 'withdraw'">{{ record.approver_name }} 撤回了转正申请</template>
              <template v-else-if="record.action === 'resubmit'">{{ record.approver_name }} 重新提交了转正申请</template>
              <template v-else>
                {{ record.approver_name }}
                {{ (approvalFlowData?.records || []).filter((r: any) => r.action === 'submit' || r.action === 'resubmit').indexOf(record) > 0 ? '重新提交了转正申请' : '提交了转正申请' }}
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
            v-if="myStatus.confirmation?.status === 'submitted'"
            timestamp="待审批"
            placement="top"
            type="warning"
          >
            <div class="tl-title tl-pending">总经理审批</div>
            <div class="tl-desc">
              等待总经理{{ approvalFlowData?.gmName ? `（${approvalFlowData.gmName}）` : '' }}审批...
            </div>
          </el-timeline-item>

          <!-- 下一步：驳回后重新提交 -->
          <el-timeline-item
            v-if="myStatus.confirmation?.status === 'rejected'"
            timestamp="待处理"
            placement="top"
            type="warning"
          >
            <div class="tl-title tl-pending">重新提交</div>
            <div class="tl-desc">请重新上传申请表后再次提交...</div>
          </el-timeline-item>

          <!-- 已通过 -->
          <el-timeline-item
            v-if="myStatus.confirmation?.status === 'approved'"
            :timestamp="myStatus.confirmation?.approve_time ? formatDateTime(myStatus.confirmation.approve_time) : ''"
            placement="top"
            type="success"
          >
            <div class="tl-title">转正完成</div>
            <div class="tl-desc" style="color: #67c23a;">{{ myStatus.profile?.name }} 已正式转正</div>
          </el-timeline-item>
        </el-timeline>
        <div v-else style="text-align: center; padding: 20px;">
          <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        </div>
      </div>
      <template #footer>
        <el-button @click="approvalFlowDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import axios from 'axios'
import dayjs from 'dayjs'

interface ProbationDocument {
  id: string
  confirmation_id: string
  document_type: string
  file_name: string
  file_path: string
  file_size: number
  mime_type: string
  uploaded_by: number
  uploaded_by_name: string
  created_at: string
}

interface ProbationConfirmation {
  id: string
  employee_id: string
  probation_end_date: string
  status: 'pending' | 'submitted' | 'approved' | 'rejected'
  submit_time: string | null
  approve_time: string | null
  approver_id: number | null
  approver_comment: string | null
  created_at: string
  updated_at: string
}

interface EmployeeProfile {
  id: string
  name: string
  department: string
  position: string
  hire_date: string
  employment_status: string
}

interface MyProbationStatus {
  profile: EmployeeProfile | null
  confirmation: ProbationConfirmation | null
  documents: ProbationDocument[]
}

interface ProbationTemplate {
  id: string
  name: string
  file_name: string
  file_path: string
  file_size: number
  mime_type: string
  created_at: string
}

const loading = ref(false)
const submitting = ref(false)
const myStatus = ref<MyProbationStatus | null>(null)
const templates = ref<ProbationTemplate[]>([])
const detailDialogVisible = ref(false)
const approvalFlowDialogVisible = ref(false)
const approvalFlowData = ref<any>(null)
const flowLoading = ref(false)

const uploadUrl = computed(() => '/api/probation/upload-doc')
const uploadHeaders = computed(() => ({}))

const canSubmit = computed(() => {
  const status = myStatus.value?.confirmation?.status
  const hasDoc = (myStatus.value?.documents?.length ?? 0) > 0
  return hasDoc && (status === 'pending' || status === 'rejected')
})

const fetchMyStatus = async () => {
  loading.value = true
  try {
    const response = await axios.get('/api/probation/my-status')
    if (response.data.success) {
      myStatus.value = response.data.data
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '获取转正状态失败')
  } finally {
    loading.value = false
  }
}

const fetchTemplates = async () => {
  try {
    const response = await axios.get('/api/probation/templates')
    if (response.data.success) {
      templates.value = response.data.data
    }
  } catch (error) {
    console.error('获取转正模板失败:', error)
  }
}

const handleDownloadTemplate = (template: ProbationTemplate) => {
  window.open(`/api/probation/templates/${template.id}/download`, '_blank')
}

const handleSubmitApplication = async () => {
  try {
    await ElMessageBox.confirm('确认提交转正申请？提交后将发送给总经理审批。', '确认提交', {
      confirmButtonText: '确认提交',
      cancelButtonText: '取消',
      type: 'info'
    })
    submitting.value = true
    const response = await axios.post('/api/probation/apply')
    if (response.data.success) {
      ElMessage.success('转正申请已提交，等待总经理审批')
      fetchMyStatus()
    } else {
      ElMessage.error(response.data.message || '提交失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '提交失败')
    }
  } finally {
    submitting.value = false
  }
}

const handleViewDetail = () => {
  detailDialogVisible.value = true
}

const handleViewDocs = () => {
  const docs = myStatus.value?.documents
  if (!docs || docs.length === 0) return
  if (docs.length === 1) {
    window.open(`/api/probation/my-doc/${docs[0].id}/download`, '_blank')
  } else {
    detailDialogVisible.value = true
  }
}

const handleDownload = (doc: ProbationDocument) => {
  window.open(`/api/probation/my-doc/${doc.id}/download`, '_blank')
}

const handleDeleteDoc = async (doc: ProbationDocument) => {
  try {
    await ElMessageBox.confirm('确定要删除该文件吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await axios.delete(`/api/probation/my-doc/${doc.id}`)
    ElMessage.success('文件删除成功')
    fetchMyStatus()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }
}

const beforeUpload = (file: { type: string; size: number }) => {
  const isValidType = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'].includes(file.type)
  const isLt10M = file.size / 1024 / 1024 < 10
  if (!isValidType) {
    ElMessage.error('只支持 PDF、DOC、DOCX、JPG、PNG 格式的文件')
    return false
  }
  if (!isLt10M) {
    ElMessage.error('文件大小不能超过 10MB')
    return false
  }
  return true
}

const handleUploadSuccess = (response: any) => {
  if (response.success) {
    ElMessage.success('文件上传成功')
    fetchMyStatus()
  } else {
    ElMessage.error(response.message || '文件上传失败')
  }
}

const handleUploadError = (error: any) => {
  const message = error?.response?.data?.message || error?.message || '文件上传失败'
  ElMessage.error(message)
}

const handleViewApprovalFlow = async () => {
  if (!myStatus.value?.confirmation?.id) {
    ElMessage.warning('暂无审批流程信息')
    return
  }
  approvalFlowData.value = null
  approvalFlowDialogVisible.value = true
  flowLoading.value = true
  try {
    const response = await axios.get(`/api/probation/${myStatus.value.confirmation.id}/approval-flow`)
    if (response.data.success) {
      approvalFlowData.value = response.data.data
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '获取审批流程失败')
  } finally {
    flowLoading.value = false
  }
}

const handleWithdraw = async () => {
  try {
    await ElMessageBox.confirm('确认撤回转正申请？撤回后可重新修改并提交。', '撤回申请', {
      confirmButtonText: '确认撤回',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await axios.post('/api/probation/my-record/withdraw')
    ElMessage.success('转正申请已撤回')
    fetchMyStatus()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '撤回失败')
    }
  }
}

const handleDeleteRecord = async () => {
  try {
    await ElMessageBox.confirm(
      '确认删除该转正记录？删除后将清除所有相关数据，需重新创建。',
      '删除转正记录',
      {
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        type: 'error'
      }
    )
    await axios.delete('/api/probation/my-record')
    ElMessage.success('转正记录已删除')
    approvalFlowData.value = null
    fetchMyStatus()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }
}

const getActionType = (action: string): 'success' | 'danger' | 'warning' | 'info' | 'primary' => {
  const map: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'primary'> = {
    submit: 'primary', resubmit: 'primary', approve: 'success',
    reject: 'danger', withdraw: 'warning',
  }
  return map[action] || 'info'
}

const getActionLabel = (action: string) => {
  const map: Record<string, string> = {
    submit: '员工提交', resubmit: '重新提交', approve: '审批通过',
    reject: '审批驳回', withdraw: '撤回申请',
  }
  return map[action] || action
}

const getActionTitle = (record: any) => {
  if (['submit', 'resubmit', 'withdraw'].includes(record.action)) {
    return record.approver_name || myStatus.value?.profile?.name || '员工'
  }
  return record.approver_name || '总经理'
}

const getRemainingDays = (endDate: string | null | undefined) => {
  if (!endDate) return '-'
  const diff = dayjs(endDate).startOf('day').diff(dayjs().startOf('day'), 'day')
  if (diff < 0) return '已到期'
  return `${diff}天`
}

const getRemainingDaysClass = (endDate: string | null | undefined) => {
  if (!endDate) return ''
  const diff = dayjs(endDate).startOf('day').diff(dayjs().startOf('day'), 'day')
  if (diff < 0) return 'text-danger'
  if (diff <= 7) return 'text-warning'
  return ''
}

const formatDate = (date: string | null | undefined) => {
  if (!date) return '-'
  return dayjs(date).format('YYYY-MM-DD')
}

const formatDateTime = (date: string | null | undefined) => {
  if (!date) return '-'
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

const getStatusType = (status: string | undefined): 'success' | 'warning' | 'danger' | 'info' | 'primary' => {
  if (!status) return 'info'
  const typeMap: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
    pending: 'info',
    submitted: 'warning',
    approved: 'success',
    rejected: 'danger'
  }
  return typeMap[status] || 'info'
}

const getStatusText = (status: string | undefined) => {
  if (!status) return '-'
  const textMap: Record<string, string> = {
    pending: '实习期',
    submitted: '待审批',
    approved: '已转正',
    rejected: '已驳回'
  }
  return textMap[status] || status
}

onMounted(() => {
  fetchMyStatus()
  fetchTemplates()
})
</script>

<style scoped>
.probation-container {
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
}

.page-card :deep(.el-card__header) {
  padding: 16px 24px;
  border-bottom: 1px solid #e4e7ed;
}

.page-card :deep(.el-card__body) {
  flex: 1;
  padding: 24px;
  overflow: auto;
  display: flex;
  flex-direction: column;
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

.loading-wrapper {
  padding: 20px;
}

.empty-wrapper {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

.my-probation {
  flex: 1;
}

.approved-banner {
  margin-bottom: 20px;
  padding: 20px;
  background: #f0f9eb;
  border-radius: 8px;
  border: 1px solid #b3e19d;
}

.approved-banner :deep(.el-result__title p) {
  color: #67c23a;
}

.detail-content {
  max-height: 600px;
  overflow-y: auto;
}

.comment-content {
  white-space: pre-wrap;
  line-height: 1.6;
  color: #606266;
}

.documents-section {
  margin-top: 20px;
}

.documents-section h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.text-gray { color: #909399; }
.text-danger { color: #f56c6c; font-weight: 500; }
.text-warning { color: #e6a23c; font-weight: 500; }

/* 审批流程弹窗样式（与总经理端统一） */
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
</style>
