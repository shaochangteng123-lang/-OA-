<template>
  <div class="probation-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <h2>转正申请</h2>
        </div>
      </template>

      <!-- 提示信息 -->
      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="tip-alert"
      >
        <template #title>
          请下载统一模板填写后上传提交
        </template>
      </el-alert>

      <!-- 加载中 -->
      <div v-if="loading" class="loading-wrapper">
        <el-skeleton :rows="5" animated />
      </div>

      <!-- 无转正记录 -->
      <div v-else-if="!myStatus" class="empty-wrapper">
        <el-empty description="暂无转正记录" />
      </div>

      <!-- 我的转正申请 -->
      <div v-else class="my-probation">
        <!-- 转正信息表格 -->
        <el-table :data="[myStatus.confirmation]" stripe style="width: 100%" :header-cell-style="{ textAlign: 'center' }" :cell-style="{ textAlign: 'center' }">
          <el-table-column type="index" label="序号" width="60" />
          <el-table-column label="申请人" min-width="80">
            <template #default>
              {{ myStatus.profile?.name || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="部门" min-width="100">
            <template #default>
              {{ myStatus.profile?.department || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="职位" min-width="100">
            <template #default>
              {{ myStatus.profile?.position || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="入职时间" min-width="90">
            <template #default>
              {{ formatDate(myStatus.profile?.hire_date) }}
            </template>
          </el-table-column>
          <el-table-column label="试用期截止" min-width="90">
            <template #default>
              {{ formatDate(myStatus.confirmation?.probation_end_date) }}
            </template>
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
              <template v-if="templates.length > 0">
                <el-button type="primary" link size="small" @click="handleDownloadTemplate(templates[0])">
                  下载模板
                </el-button>
              </template>
              <template v-else>
                <span class="text-gray">暂无模板</span>
              </template>
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
                v-else
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
              <el-button type="primary" link @click="handleViewDetail">
                查看详情
              </el-button>
              <el-button
                v-if="myStatus.confirmation?.status === 'submitted' || myStatus.confirmation?.status === 'approved' || myStatus.confirmation?.status === 'rejected'"
                type="info"
                link
                @click="handleViewApprovalFlow"
              >
                查看审批流程
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="转正详情"
      width="800px"
      :close-on-click-modal="false"
    >
      <div v-if="myStatus" class="detail-content">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">
            {{ myStatus.profile?.name || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="部门">
            {{ myStatus.profile?.department || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="职位">
            {{ myStatus.profile?.position || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="入职日期">
            {{ formatDate(myStatus.profile?.hire_date) }}
          </el-descriptions-item>
          <el-descriptions-item label="试用期截止">
            {{ formatDate(myStatus.confirmation?.probation_end_date) }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="getStatusType(myStatus.confirmation?.status)">
              {{ getStatusText(myStatus.confirmation?.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item v-if="myStatus.confirmation?.submit_time" label="提交时间" :span="2">
            {{ formatDateTime(myStatus.confirmation?.submit_time) }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="myStatus.confirmation?.status === 'approved' || myStatus.confirmation?.status === 'rejected'"
            label="审批时间"
          >
            {{ formatDateTime(myStatus.confirmation?.approve_time) }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="myStatus.confirmation?.approver_comment"
            label="审批意见"
            :span="2"
          >
            <div class="comment-content">{{ myStatus.confirmation?.approver_comment }}</div>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 转正文件列表 -->
        <div v-if="myStatus.documents && myStatus.documents.length > 0" class="documents-section">
          <h4>转正文件</h4>
          <el-table :data="myStatus.documents" stripe size="small">
            <el-table-column prop="file_name" label="文件名" />
            <el-table-column prop="uploaded_by_name" label="上传人" width="100" />
            <el-table-column label="上传时间" width="160">
              <template #default="{ row }">
                {{ formatDateTime(row.created_at) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="100">
              <template #default="{ row }">
                <el-button type="primary" link @click="handleDownload(row)">
                  下载
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 审批流程对话框 -->
    <el-dialog
      v-model="approvalFlowDialogVisible"
      title="审批流程"
      width="600px"
    >
      <div v-if="approvalFlowData">
        <el-timeline>
          <el-timeline-item
            v-for="(record, index) in approvalFlowData.records"
            :key="index"
            :timestamp="formatDateTime(record.created_at)"
            placement="top"
            :type="record.action === 'approved' ? 'success' : record.action === 'rejected' ? 'danger' : 'info'"
          >
            <el-card>
              <div style="margin-bottom: 8px;">
                <el-tag :type="record.action === 'approved' ? 'success' : record.action === 'rejected' ? 'danger' : 'info'">
                  {{ record.action === 'approved' ? '已通过' : record.action === 'rejected' ? '已驳回' : '待审批' }}
                </el-tag>
                <span style="margin-left: 8px; font-weight: 600;">
                  {{ record.approver_name || '未知' }}
                </span>
              </div>
              <div v-if="record.comment" style="color: #606266;">
                {{ record.comment }}
              </div>
            </el-card>
          </el-timeline-item>
        </el-timeline>
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
import axios from 'axios'
import dayjs from 'dayjs'

// 类型定义
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

// 响应式数据
const loading = ref(false)
const myStatus = ref<MyProbationStatus | null>(null)
const templates = ref<ProbationTemplate[]>([])
const detailDialogVisible = ref(false)

// 上传相关
const uploadUrl = computed(() => '/api/probation/upload-doc')
const uploadHeaders = computed(() => ({}))

// 获取我的转正状态
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

// 获取转正模板列表
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

// 下载模板
const handleDownloadTemplate = (template: ProbationTemplate) => {
  window.open(`/api/probation/templates/${template.id}/download`, '_blank')
}

// 查看详情
const handleViewDetail = () => {
  detailDialogVisible.value = true
}

// 查看文件
const handleViewDocs = () => {
  detailDialogVisible.value = true
}

// 下载文件
const handleDownload = (doc: ProbationDocument) => {
  window.open(`/api/probation/my-doc/${doc.id}/download`, '_blank')
}

// 删除文件
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

// 上传前检查
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

// 上传成功
const handleUploadSuccess = (response: any) => {
  if (response.success) {
    ElMessage.success('文件上传成功')
    fetchMyStatus()
  } else {
    ElMessage.error(response.message || '文件上传失败')
  }
}

// 上传失败
const handleUploadError = (error: any) => {
  console.error('上传失败:', error)
  const message = error?.response?.data?.message || error?.message || '文件上传失败'
  ElMessage.error(message)
}

// 查看审批流程
const approvalFlowDialogVisible = ref(false)
const approvalFlowData = ref<any>(null)

const handleViewApprovalFlow = async () => {
  if (!myStatus.value?.confirmation?.id) {
    ElMessage.warning('暂无审批流程信息')
    return
  }

  try {
    const response = await axios.get(`/api/probation/${myStatus.value.confirmation.id}/approval-flow`)
    if (response.data.success) {
      approvalFlowData.value = response.data.data
      approvalFlowDialogVisible.value = true
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '获取审批流程失败')
  }
}

// 计算剩余天数
const getRemainingDays = (endDate: string | null | undefined) => {
  if (!endDate) return '-'
  const end = dayjs(endDate)
  const today = dayjs().startOf('day')
  const diff = end.diff(today, 'day')
  if (diff < 0) return '已到期'
  return `${diff}天`
}

// 获取剩余天数样式
const getRemainingDaysClass = (endDate: string | null | undefined) => {
  if (!endDate) return ''
  const end = dayjs(endDate)
  const today = dayjs().startOf('day')
  const diff = end.diff(today, 'day')
  if (diff < 0) return 'text-danger'
  if (diff <= 7) return 'text-warning'
  return ''
}

// 格式化日期
const formatDate = (date: string | null | undefined) => {
  if (!date) return '-'
  return dayjs(date).format('YYYY-MM-DD')
}

// 格式化日期时间
const formatDateTime = (date: string | null | undefined) => {
  if (!date) return '-'
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

// 获取状态类型
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

// 获取状态文本
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

// 初始化
onMounted(() => {
  fetchMyStatus()
  fetchTemplates()
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
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

.tip-alert {
  margin-bottom: 16px;
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

.text-gray {
  color: #909399;
}

.text-danger {
  color: #f56c6c;
  font-weight: 500;
}

.text-warning {
  color: #e6a23c;
  font-weight: 500;
}
</style>
