<template>
  <div class="probation-container">
    <el-card class="page-card">

      <!-- 加载中 -->
      <div v-if="loading" class="loading-wrapper">
        <el-skeleton :rows="5" animated />
      </div>

      <!-- 无转正记录 -->
      <div v-else-if="!myStatus" class="empty-wrapper">
        <el-empty description="暂无转正记录" />
      </div>

      <div v-else class="my-probation">
        <!-- 已是正式职工横幅（直接设为在职，无需转正流程） -->
        <el-result
          v-if="isActiveEmployee"
          icon="success"
          title="您已是正式职工，不需要进行转正审批"
          class="approved-banner"
        />

        <!-- 已转正成功横幅 -->
        <el-result
          v-else-if="myStatus.confirmation?.status === 'approved'"
          icon="success"
          title="恭喜，您已正式转正！"
          :sub-title="`转正时间：${formatDateTime(myStatus.confirmation?.approve_time)}`"
          class="approved-banner"
        >
          <template #extra>
            <el-button type="primary" @click="handleViewApprovalFlow">查看审批流程</el-button>
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
          <template #title>请下载统一模板填写后，上传 PDF 版本提交</template>
        </el-alert>

        <div class="probation-layout">
          <el-card shadow="hover" class="summary-card">
            <div class="summary-header">
              <div>
                <div class="section-title">当前状态</div>
                <div class="summary-name">{{ myStatus.profile?.name || '-' }}</div>
                <div class="summary-subtitle">
                  {{ myStatus.profile?.department || '-' }} · {{ myStatus.profile?.position || '-' }}
                </div>
              </div>
              <el-tag :type="getStatusType(myStatus.confirmation?.status)" size="large" effect="light">
                {{ getStatusText(myStatus.confirmation?.status) }}
              </el-tag>
            </div>

            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">入职时间</span>
                <span class="info-value">{{ formatDate(myStatus.profile?.hire_date) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">试用期截止</span>
                <span class="info-value">{{ formatDate(myStatus.confirmation?.probation_end_date) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">剩余天数</span>
                <span class="info-value">{{ getRemainingDays(myStatus.profile?.hire_date, myStatus.confirmation?.probation_end_date) }}</span>
              </div>
            </div>

            <div class="summary-actions">
              <div class="section-title">当前操作</div>
              <div class="actions-row">
                <el-button type="primary" plain @click="handleViewDetail">查看详情</el-button>
                <el-button
                  v-if="canSubmit && !isActiveEmployee"
                  type="success"
                  :loading="submitting"
                  @click="handleSubmitApplication"
                >
                  提交申请
                </el-button>
                <el-button
                  v-if="!isActiveEmployee && ['submitted', 'approved', 'rejected'].includes(myStatus.confirmation?.status ?? '')"
                  type="info"
                  plain
                  @click="handleViewApprovalFlow"
                >
                  审批流程
                </el-button>
                <el-button
                  v-if="!isActiveEmployee && myStatus.confirmation?.status === 'submitted'"
                  type="warning"
                  plain
                  @click="handleWithdraw"
                >
                  撤回申请
                </el-button>
                <el-button
                  v-if="!isActiveEmployee && canDeleteRecord"
                  type="danger"
                  plain
                  @click="handleDeleteRecord"
                >
                  删除记录
                </el-button>
              </div>
            </div>
          </el-card>

          <div class="content-grid single-column">
            <el-card shadow="hover" class="materials-card">
              <div class="section-title">申请材料</div>
              <div class="materials-block">
                <div class="material-row material-panel">
                  <span class="material-label">转正申请模板</span>
                  <el-button v-if="templates.length > 0" type="primary" link @click="handleDownloadTemplate(templates[0])">
                    下载模板
                  </el-button>
                  <span v-else class="text-gray">暂无模板</span>
                </div>

                <div class="material-row material-column material-panel">
                  <span class="material-label">转正申请表</span>
                  <div class="probation-doc-cell">
                    <template v-if="myStatus.documents && myStatus.documents.length > 0">
                      <div
                        v-for="doc in myStatus.documents"
                        :key="doc.id"
                        class="probation-doc-item"
                      >
                        <el-button type="primary" link size="small" @click="handleDownload(doc)">
                          {{ doc.file_name }}
                        </el-button>
                        <el-button
                          v-if="myStatus.confirmation?.status === 'pending' || myStatus.confirmation?.status === 'rejected'"
                          type="danger"
                          link
                          size="small"
                          @click="handleDeleteDoc(doc)"
                        >
                          删除
                        </el-button>
                      </div>
                    </template>
                    <el-input
                      v-if="myStatus.confirmation?.status === 'pending' || myStatus.confirmation?.status === 'rejected'"
                      v-model="applicationComment"
                      type="textarea"
                      :rows="2"
                      placeholder="请输入转正申请说明"
                      class="probation-comment-input"
                    />
                    <el-upload
                      v-if="myStatus.confirmation?.status === 'pending' || myStatus.confirmation?.status === 'rejected'"
                      :action="uploadUrl"
                      :headers="uploadHeaders"
                      :data="{ application_comment: applicationComment }"
                      :before-upload="beforeUpload"
                      :on-success="handleUploadSuccess"
                      :on-error="handleUploadError"
                      :show-file-list="false"
                      :with-credentials="true"
                      accept=".pdf"
                    >
                      <el-button type="primary">上传 PDF</el-button>
                    </el-upload>
                    <span
                      v-if="myStatus.confirmation?.status === 'pending' || myStatus.confirmation?.status === 'rejected'"
                      class="upload-tip"
                    >
                      仅支持 PDF，大小不超过 10MB
                    </span>
                    <span v-else-if="!myStatus.documents || myStatus.documents.length === 0" class="text-gray">-</span>
                  </div>
                </div>
              </div>
            </el-card>
          </div>
        </div>

        <!-- 历史转正记录 -->
        <div v-if="myStatus.probationHistory && myStatus.probationHistory.length > 0" class="history-section">
          <el-card shadow="hover" class="history-card">
            <div class="section-title">历史转正记录</div>
            <el-table :data="myStatus.probationHistory" stripe size="small">
              <el-table-column label="入职时间" min-width="110" align="center">
                <template #default="{ row }">{{ formatDate(row.hire_date) }}</template>
              </el-table-column>
              <el-table-column label="试用期截止" min-width="110" align="center">
                <template #default="{ row }">{{ formatDate(row.probation_end_date) }}</template>
              </el-table-column>
              <el-table-column label="转正状态" min-width="90" align="center">
                <template #default="{ row }">
                  <el-tag :type="getStatusType(row.status)" size="small">
                    {{ getStatusText(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="审批时间" min-width="140" align="center">
                <template #default="{ row }">{{ row.approve_time ? formatDateTime(row.approve_time) : '-' }}</template>
              </el-table-column>
              <el-table-column label="重置原因" min-width="180" align="center">
                <template #default="{ row }">{{ row.reset_reason || '-' }}</template>
              </el-table-column>
              <el-table-column label="重置时间" min-width="140" align="center">
                <template #default="{ row }">{{ formatDateTime(row.reset_at) }}</template>
              </el-table-column>
            </el-table>
          </el-card>
        </div>
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
          <el-descriptions-item v-if="myStatus.confirmation?.application_comment" label="申请说明" :span="2">
            <div class="comment-content">{{ myStatus.confirmation.application_comment }}</div>
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

    <el-dialog v-model="approvalFlowDialogVisible" title="审批流程" width="560px" :close-on-click-modal="false">
      <div v-if="myStatus" class="flow-dialog">
        <!-- 基本信息 -->
        <el-descriptions :column="2" border size="small" style="margin-bottom: 20px;">
          <el-descriptions-item label="申请人">{{ myStatus.profile?.name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="部门">{{ myStatus.profile?.department || '-' }}</el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag :type="getStatusType(approvalFlowData?.confirmation?.status || myStatus.confirmation?.status)" size="small">
              {{ getStatusText(approvalFlowData?.confirmation?.status || myStatus.confirmation?.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{ approvalFlowData?.confirmation?.submit_time ? formatDateTime(approvalFlowData.confirmation.submit_time) : '-' }}
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
              <template v-else-if="record.action === 'resubmit'">
                {{ record.approver_name }} 重新提交了转正申请
                <div v-if="record.comment" class="tl-comment">{{ formatSubmitComment(record.comment) }}</div>
              </template>
              <template v-else>
                {{ record.approver_name }}
                {{ (approvalFlowData?.records || []).filter((r: any) => r.action === 'submit' || r.action === 'resubmit').indexOf(record) > 0 ? '重新提交了转正申请' : '提交了转正申请' }}
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
            v-if="(approvalFlowData?.confirmation?.status || myStatus.confirmation?.status) === 'submitted'"
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
            v-if="(approvalFlowData?.confirmation?.status || myStatus.confirmation?.status) === 'rejected'"
            timestamp="待处理"
            placement="top"
            type="warning"
          >
            <div class="tl-title tl-pending">重新提交</div>
            <div class="tl-desc">请重新上传申请表后再次提交...</div>
          </el-timeline-item>

          <!-- 已通过 -->
          <el-timeline-item
            v-if="(approvalFlowData?.confirmation?.status || myStatus.confirmation?.status) === 'approved'"
            :timestamp="approvalFlowData?.confirmation?.approve_time ? formatDateTime(approvalFlowData.confirmation.approve_time) : (myStatus.confirmation?.approve_time ? formatDateTime(myStatus.confirmation.approve_time) : '')"
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
  application_comment: string | null
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
  hasHistory: boolean
  hasRealConfirmation: boolean
  documents: ProbationDocument[]
  probationHistory: ProbationHistoryRecord[]
}

interface ProbationHistoryRecord {
  id: string
  employee_id: string
  hire_date: string | null
  probation_end_date: string | null
  status: string
  submit_time: string | null
  approve_time: string | null
  approver_comment: string | null
  application_comment: string | null
  reset_reason: string | null
  reset_at: string
  new_hire_date: string | null
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
const applicationComment = ref('')

// 判断是否为在职员工（直接设为在职，无需转正流程）
const isActiveEmployee = computed(() => {
  const profile = myStatus.value?.profile
  const confirmation = myStatus.value?.confirmation
  // employment_status 为 active 且没有转正记录（或转正记录不是通过审批流程获得的）
  return profile?.employment_status === 'active' && (!confirmation || confirmation.status !== 'approved')
})

const uploadUrl = computed(() => '/api/probation/upload-doc')
const uploadHeaders = computed(() => ({}))

const canSubmit = computed(() => {
  const status = myStatus.value?.confirmation?.status
  const hasDoc = (myStatus.value?.documents?.length ?? 0) > 0
  return hasDoc && (status === 'pending' || status === 'rejected')
})

const canDeleteRecord = computed(() => {
  const status = myStatus.value?.confirmation?.status
  const hasRealConfirmation = myStatus.value?.hasRealConfirmation ?? false
  const hasHistory = myStatus.value?.hasHistory ?? false

  if (!hasRealConfirmation) return false
  return status === 'rejected' || (status === 'pending' && hasHistory)
})

const fetchMyStatus = async () => {
  loading.value = true
  try {
    const response = await axios.get('/api/probation/my-status')
    if (response.data.success) {
      myStatus.value = response.data.data
      applicationComment.value = response.data.data?.confirmation?.application_comment || ''
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
    const response = await axios.post('/api/probation/apply', {
      comment: applicationComment.value,
    })
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
  const isValidType = ['application/pdf'].includes(file.type)
  const isLt10M = file.size / 1024 / 1024 < 10
  if (!isValidType) {
    ElMessage.error('只支持 PDF 格式的文件')
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
  flowLoading.value = true
  approvalFlowDialogVisible.value = true
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

const formatSubmitComment = (comment: string | null | undefined) => {
  if (!comment) return ''
  return comment.replace(/^员工(?:驳回后)?重新?提交转正申请；?/, '').replace(/^员工提交转正申请；?/, '').trim() || comment
}

const getRemainingDays = (_hireDate: string | null | undefined, endDate: string | null | undefined) => {
  if (!endDate) return '-'
  const diff = dayjs(endDate).startOf('day').diff(dayjs().startOf('day'), 'day')
  if (diff < 0) return '已到期'
  if (diff === 0) return '今天到期'
  return `${diff}天`
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

.probation-layout {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.summary-card,
.materials-card {
  border-radius: 16px;
  border: 1px solid #ebeef5;
}

.summary-card :deep(.el-card__body),
.materials-card :deep(.el-card__body) {
  padding: 24px;
}

.summary-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #909399;
  margin-bottom: 8px;
}

.summary-name {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  line-height: 1.2;
}

.summary-subtitle {
  margin-top: 6px;
  font-size: 14px;
  color: #606266;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 12px;
}

.info-label {
  font-size: 13px;
  color: #909399;
}

.info-value {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.summary-actions {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #eef2f7;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
  gap: 20px;
  align-items: start;
}

.content-grid.single-column {
  grid-template-columns: 1fr;
}

.materials-block {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.material-panel {
  padding: 18px;
  border: 1px solid #eef2f7;
  border-radius: 12px;
  background: #fafcff;
}

.material-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.material-column {
  flex-direction: column;
  align-items: stretch;
}

.material-label {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.probation-doc-cell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px dashed #dcdfe6;
  border-radius: 12px;
  background: #fafcff;
}

.probation-doc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid #f0f2f5;
}

.probation-doc-item:last-child {
  border-bottom: none;
}

.probation-comment-input :deep(.el-textarea__inner) {
  border-radius: 10px;
  min-height: 82px;
}

.actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.actions-row .el-button {
  min-width: 108px;
}

@media (max-width: 1024px) {
  .info-grid,
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .summary-header {
    flex-direction: column;
    align-items: stretch;
  }
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

.history-section {
  margin-top: 20px;
}

.history-card {
  border-radius: 16px;
  border: 1px solid #ebeef5;
}

.history-card :deep(.el-card__body) {
  padding: 24px;
}
</style>
