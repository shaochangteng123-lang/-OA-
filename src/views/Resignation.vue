<template>
  <div class="resignation-container">
    <el-card class="page-card">
      <div class="tabs-wrapper">
<el-tabs v-model="activeTopTab" class="content-tabs">
        <el-tab-pane label="离职管理" name="management">
      <div v-loading="resignationStore.myDataLoading" class="content-wrapper">
        <el-alert
          v-if="myRequest?.status === 'rejected'"
          type="error"
          :closable="false"
          show-icon
          class="status-alert"
        >
          <template #title>离职申请已被驳回，请根据审批意见修改后重新提交</template>
          <template #default>
            <span v-if="myRequest?.approver_comment">驳回原因：{{ myRequest.approver_comment }}</span>
          </template>
        </el-alert>

        <el-alert
          v-else-if="myRequest?.status === 'mutual_confirmed'"
          type="warning"
          :closable="false"
          show-icon
          class="status-alert"
        >
          <template #title>双方已完成交接确认，等待管理员审批</template>
        </el-alert>

        <el-alert
          v-else-if="myRequest?.status === 'approved'"
          type="success"
          :closable="false"
          show-icon
          class="status-alert"
        >
          <template #title>离职申请已审批通过</template>
        </el-alert>

        <div class="summary-grid">
          <el-card shadow="hover">
            <template #header>当前状态</template>
            <div class="summary-main">
              <div class="summary-name">{{ myProfile?.name || '-' }}</div>
              <!-- handover_rejected 对离职人不可见，显示为「待交接人处理」 -->
              <el-tag :type="getStatusType(myRequest?.status === 'handover_rejected' ? 'submitted' : myRequest?.status)" size="large">
                {{ getStatusText(myRequest?.status === 'handover_rejected' ? 'submitted' : myRequest?.status) }}
              </el-tag>
            </div>
            <div class="summary-meta">{{ myProfile?.department || '-' }} · {{ myProfile?.position || '-' }}</div>
            <div class="summary-item"><span>交接人</span><span>{{ currentHandoverName }}</span></div>
            <div class="summary-item"><span>离职日期</span><span>{{ form.resign_date || '-' }}</span></div>
            <div class="summary-item"><span>下一步</span><span>{{ nextActionText }}</span></div>
            <div class="summary-actions">
              <el-button type="primary" plain @click="detailVisible = true" :disabled="!myRequest">查看流程</el-button>
              <el-button type="success" :disabled="!canSubmit" :loading="submitting" @click="handleSubmit">提交申请</el-button>
              <el-button type="danger" plain :disabled="!canWithdraw" :loading="withdrawing" @click="handleWithdraw">撤回申请</el-button>
              <el-button type="warning" plain :disabled="!canConfirm" :loading="confirming" @click="handleConfirm">确认交接完成</el-button>
              <el-button type="danger" :disabled="!canDelete" :loading="deleting" @click="handleDelete">删除申请</el-button>
            </div>
          </el-card>

          <el-card shadow="hover">
            <template #header>模板下载</template>
            <div class="template-list">
              <div v-for="template in visibleTemplates" :key="template.id" class="template-item">
                <div>
                  <div class="template-title">{{ getTemplateTypeText(template.template_type) }}</div>
                  <div class="template-name">{{ template.file_name }}</div>
                </div>
                <el-button type="primary" link @click="openTemplate(template.id)">下载模板</el-button>
              </div>
              <el-empty v-if="myTemplates.length === 0" description="管理员暂未上传模板" />
            </div>
          </el-card>
        </div>

        <el-card shadow="hover" class="form-card">
          <template #header>离职申请</template>
          <el-form :model="form" label-width="110px">
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="离职类型">
                  <el-select v-model="form.resign_type" placeholder="请选择离职类型" :disabled="isFormLocked">
                    <el-option label="主动离职" value="voluntary" />
                    <el-option label="合同到期" value="contract_end" />
                    <el-option label="辞退" value="dismissal" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="离职日期">
                  <el-date-picker
                    v-model="form.resign_date"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="请选择离职日期"
                    style="width: 100%"
                    :disabled-date="disabledResignDate"
                    :disabled="isFormLocked"
                  />
                  <div class="date-tip">离职日期需至少提前 1 个月申请，1 个月内日期不可选</div>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="交接人">
                  <el-select v-model="form.handover_user_id" filterable placeholder="请选择交接人" :disabled="isFormLocked">
                    <el-option
                      v-for="user in resignationStore.candidates"
                      :key="user.id"
                      :label="`${user.name}${user.department ? ` / ${user.department}` : ''}${user.position ? ` / ${user.position}` : ''}`"
                      :value="user.id"
                    />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="离职说明">
              <el-input v-model="form.reason" type="textarea" :rows="3" placeholder="请输入离职原因或说明" />
            </el-form-item>
          </el-form>
        </el-card>

        <div class="upload-grid">
          <el-card shadow="hover">
            <template #header>我的附件</template>
            <div class="upload-block">
              <div class="upload-row">
                <span>离职申请表</span>
                <div class="upload-actions">
                  <el-button v-if="employeeApplication" type="primary" link @click="openDocument(employeeApplication)">{{ employeeApplication.file_name }}</el-button>
                  <el-button v-if="employeeApplication && canEditDocs" type="danger" link @click="handleDeleteDocument(employeeApplication)">删除</el-button>
                  <el-upload :show-file-list="false" :before-upload="beforeUploadPdf('application_form')" accept=".pdf">
                    <el-button type="primary">上传文件</el-button>
                  </el-upload>
                </div>
              </div>
              <div class="upload-row">
                <span>离职人交接单</span>
                <div class="upload-actions">
                  <el-button v-if="employeeHandover" type="primary" link @click="openDocument(employeeHandover)">{{ employeeHandover.file_name }}</el-button>
                  <el-button v-if="employeeHandover && canEditDocs" type="danger" link @click="handleDeleteDocument(employeeHandover)">删除</el-button>
                  <el-upload :show-file-list="false" :before-upload="beforeUploadHandover('employee')" accept=".pdf,.jpg,.jpeg,.png">
                    <el-button type="primary">上传文件</el-button>
                  </el-upload>
                </div>
              </div>
            </div>
          </el-card>

          <el-card shadow="hover">
            <template #header>离职补充材料</template>
            <div class="upload-block">
              <div v-for="item in additionalDocumentItems" :key="item.type" class="upload-row">
                <div class="material-label-wrap">
                  <span>{{ item.label }}</span>
                  <el-tag size="small" type="danger" effect="plain">必传</el-tag>
                </div>
                <div class="upload-actions">
                  <el-button v-if="item.file" type="primary" link @click="openDocument(item.file)">{{ item.file.file_name }}</el-button>
                  <el-button v-if="item.file && canEditDocs" type="danger" link @click="handleDeleteDocument(item.file)">删除</el-button>
                  <el-upload :show-file-list="false" :before-upload="beforeUploadAttachment(item.type)" accept=".pdf,.jpg,.jpeg,.png">
                    <el-button type="primary">上传文件</el-button>
                  </el-upload>
                </div>
              </div>
            </div>
          </el-card>

          <el-card shadow="hover">
            <template #header>交接人附件</template>
            <div class="upload-block">
              <div class="upload-row">
                <span>交接人交接单</span>
                <div class="upload-actions">
                  <el-button v-if="handoverDocument" type="primary" link @click="openDocument(handoverDocument)">{{ handoverDocument.file_name }}</el-button>
                  <span v-else class="empty-text">对方暂未上传</span>
                </div>
              </div>
              <div class="upload-row">
                <span>交接人确认</span>
                <el-tag :type="myRequest?.handover_confirm_time ? 'success' : 'info'">
                  {{ myRequest?.handover_confirm_time ? '已确认' : '待确认' }}
                </el-tag>
              </div>
              <div class="upload-row">
                <span>我的确认</span>
                <el-tag :type="myRequest?.employee_confirm_time ? 'success' : 'info'">
                  {{ myRequest?.employee_confirm_time ? '已确认' : '待确认' }}
                </el-tag>
              </div>
            </div>
          </el-card>
        </div>
      </div>
        </el-tab-pane>

        <el-tab-pane name="pending">
          <template #label>
            <span>待我处理</span>
            <el-badge v-if="resignationStore.handoverTasks.length > 0" :value="resignationStore.handoverTasks.length" class="tab-badge" />
          </template>
          <div class="pending-tab-content">
          <el-card shadow="hover" class="handover-card">
            <template #header>待我处理的交接任务</template>
            <el-table :data="resignationStore.handoverTasks" size="small" border>
              <el-table-column prop="employee_name" label="离职人" min-width="80" align="center" />
              <el-table-column prop="employee_department" label="部门" min-width="100" align="center" />
              <el-table-column prop="resign_date" label="离职日期" width="110" align="center" />
              <el-table-column prop="status" label="状态" min-width="140" align="center">
                <template #default="{ row }">
                  <el-tag :type="getStatusType(row.status)">{{ getStatusText(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="离职人交接单" min-width="180" align="center">
                <template #default="{ row }">
                  <div v-if="getTaskEmployeeHandoverDoc(row)" class="upload-actions" style="justify-content: center;">
                    <el-button type="primary" link @click="openTaskDocument(row.id, getTaskEmployeeHandoverDoc(row)!.id)">
                      {{ getTaskEmployeeHandoverDoc(row)!.file_name }}
                    </el-button>
                    <el-button type="success" link @click="downloadTaskDocument(row.id, getTaskEmployeeHandoverDoc(row)!)">下载</el-button>
                  </div>
                  <span v-else class="empty-text">暂未上传</span>
                </template>
              </el-table-column>
              <el-table-column label="交接人交接单" min-width="220" align="center">
                <template #default="{ row }">
                  <div class="upload-actions" style="justify-content: center; flex-wrap: wrap;">
                    <el-button
                      v-if="getTaskHandoverDoc(row)"
                      type="primary"
                      link
                      @click="openTaskDocument(row.id, getTaskHandoverDoc(row)!.id)"
                    >
                      {{ getTaskHandoverDoc(row)!.file_name }}
                    </el-button>
                    <el-button
                      v-if="getTaskHandoverDoc(row) && (!row.handover_confirm_time || row.status === 'handover_rejected')"
                      type="danger"
                      link
                      @click="handleDeleteHandoverDoc(row.id, getTaskHandoverDoc(row)!)"
                    >删除</el-button>
                    <template v-if="!getTaskHandoverDoc(row) || row.status === 'handover_rejected'">
                      <el-button
                        v-if="getTaskEmployeeHandoverDoc(row)?.mime_type === 'application/pdf'"
                        type="success"
                        size="small"
                        @click="openSignDialog(row)"
                      >签名确认</el-button>
                      <el-upload :show-file-list="false" :before-upload="beforeUploadHandover('handover', row.id)" accept=".pdf,.jpg,.jpeg,.png">
                        <el-button type="primary" link>手动上传</el-button>
                      </el-upload>
                    </template>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100" align="center">
                <template #default="{ row }">
                  <el-button type="success" link :disabled="!getTaskHandoverDoc(row) || row.status === 'handover_rejected'" @click="handleConfirmTask(row.id)">确认完成</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <el-card v-if="resignationStore.completedHandoverTasks.length > 0" shadow="hover" class="handover-card" style="margin-top: 16px;">
            <template #header>已完成的交接记录</template>
            <el-table :data="resignationStore.completedHandoverTasks" size="small" border>
              <el-table-column prop="employee_name" label="离职人" min-width="80" align="center" />
              <el-table-column prop="employee_department" label="部门" min-width="100" align="center" />
              <el-table-column prop="resign_date" label="离职日期" width="110" align="center" />
              <el-table-column prop="status" label="状态" min-width="140" align="center">
                <template #default="{ row }">
                  <el-tag :type="getStatusType(row.status)">{{ getStatusText(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="离职人交接单" min-width="150" align="center">
                <template #default="{ row }">
                  <el-button v-if="getTaskEmployeeHandoverDoc(row)" type="primary" link @click="openTaskDocument(row.id, getTaskEmployeeHandoverDoc(row)!.id)">
                    {{ getTaskEmployeeHandoverDoc(row)!.file_name }}
                  </el-button>
                  <span v-else class="empty-text">-</span>
                </template>
              </el-table-column>
              <el-table-column label="交接人交接单" min-width="150" align="center">
                <template #default="{ row }">
                  <el-button v-if="getTaskHandoverDoc(row)" type="primary" link @click="openTaskDocument(row.id, getTaskHandoverDoc(row)!.id)">
                    {{ getTaskHandoverDoc(row)!.file_name }}
                  </el-button>
                  <span v-else class="empty-text">-</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100" align="center">
                <template #default="{ row }">
                  <el-button type="info" link @click="openFlowDialog(row)">审批流程</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
          </div>
        </el-tab-pane>
      </el-tabs>
      </div>
    </el-card>

    <el-dialog v-model="detailVisible" title="离职流程详情" width="820px" top="3vh" @open="handleOpenDetailDialog">
      <div v-if="myRequest" class="detail-content">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="申请人">{{ myProfile?.name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="交接人">{{ currentHandoverName }}</el-descriptions-item>
          <el-descriptions-item label="离职类型">{{ getResignTypeText(form.resign_type) }}</el-descriptions-item>
          <el-descriptions-item label="离职日期">{{ form.resign_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag :type="getStatusType(myRequest.status)">{{ getStatusText(myRequest.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="审批意见">{{ myRequest.approver_comment || '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="detail-doc-section">
          <h4>我的材料</h4>
          <el-table :data="myDocuments.filter(doc => doc.uploader_role === 'employee')" size="small" border>
            <el-table-column label="材料类型" min-width="180" align="center">
              <template #default="{ row }">
                {{ getDocumentLabel(row.document_type as ResignationDocumentType) }}
              </template>
            </el-table-column>
            <el-table-column prop="file_name" label="文件名" min-width="220" align="center" />
            <el-table-column label="上传时间" width="180" align="center">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100" align="center">
              <template #default="{ row }">
                <el-button type="primary" link @click="openDocument(row)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="detail-doc-section">
          <h4>交接人材料</h4>
          <el-table :data="myDocuments.filter(doc => doc.uploader_role === 'handover')" size="small" border>
            <el-table-column label="材料类型" min-width="180" align="center">
              <template #default="{ row }">
                {{ getDocumentLabel(row.document_type as ResignationDocumentType) }}
              </template>
            </el-table-column>
            <el-table-column prop="file_name" label="文件名" min-width="220" align="center" />
            <el-table-column label="上传时间" width="180" align="center">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100" align="center">
              <template #default="{ row }">
                <el-button type="primary" link @click="openDocument(row)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-loading="myAuditLogsLoading">
          <el-timeline class="timeline">
            <el-timeline-item
              v-for="(step, i) in timelineSteps"
              :key="i"
              :timestamp="step.time"
              placement="top"
              :type="step.type"
              :hollow="step.hollow"
            >
              <div class="timeline-title">{{ step.title }}</div>
              <div v-if="step.desc" class="timeline-desc">{{ step.desc }}</div>
              <div v-if="step.operator" style="color: #909399; font-size: 13px; margin-top: 2px;">操作人：{{ step.operator }}</div>
            </el-timeline-item>
          </el-timeline>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="signDialogVisible" title="在线签名确认" width="660px" :close-on-click-modal="false" destroy-on-close @opened="onSignDialogOpened">
      <div class="sign-dialog-content">
        <div class="sign-info">
          <span>离职人：{{ signTarget?.employee_name }}</span>
          <span>交接单：{{ getTaskEmployeeHandoverDoc(signTarget!)?.file_name }}</span>
        </div>
        <p class="sign-tip">请在田字格内沿字帖临摹签名，格外区域无法书写</p>
        <div class="sign-canvas-wrap" :style="{ height: signAreaHeight + 'px' }">
          <div class="sign-grid-row">
            <div v-for="(char, i) in currentSignerChars" :key="i" class="sign-grid-cell" :style="{ width: signCellSize + 'px', height: signCellSize + 'px' }">
              <div class="sign-grid-cross-h" />
              <div class="sign-grid-cross-v" />
              <span class="sign-grid-char">{{ char }}</span>
            </div>
          </div>
          <canvas ref="signCanvasRef" class="sign-canvas" />
        </div>
        <div class="signature-actions">
          <el-button @click="clearSignCanvas">清除</el-button>
          <el-button type="primary" :disabled="signIsEmpty" @click="confirmSign">确认签名</el-button>
        </div>
      </div>
    </el-dialog>

    <el-dialog v-model="historyDialogVisible" title="历史交接单" width="750px">
      <el-table :data="historyDocs" size="small" border v-loading="historyLoading" style="width: 100%">
        <el-table-column label="材料类型" align="center">
          <template #default="{ row }">{{ getDocumentLabel(row.document_type) }}</template>
        </el-table-column>
        <el-table-column label="上传人" width="80" align="center">
          <template #default="{ row }">{{ row.uploaded_by_name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="file_name" label="文件名" align="center" />
        <el-table-column label="上传时间" width="160" align="center">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="70" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_current ? 'success' : 'info'" size="small">{{ row.is_current ? '当前' : '历史' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="70" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="openTaskDocument(historyRequestId, row.id)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="historyDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="flowDialogVisible" title="审批流程" width="700px" destroy-on-close>
      <div v-loading="flowLoading" style="min-height: 120px;">
        <template v-if="!flowLoading && flowTarget">
          <el-descriptions :column="2" border size="small" style="margin-bottom: 20px;">
            <el-descriptions-item label="离职人">{{ flowTarget.employee_name || '-' }}</el-descriptions-item>
            <el-descriptions-item label="交接人">{{ flowTarget.handover_name || '-' }}</el-descriptions-item>
            <el-descriptions-item label="离职日期">{{ flowTarget.resign_date || '-' }}</el-descriptions-item>
            <el-descriptions-item label="当前状态">
              <el-tag :type="getStatusType(flowTarget.status)" size="small">{{ getStatusText(flowTarget.status) }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item v-if="flowTarget.reason" label="离职说明" :span="2">
              {{ flowTarget.reason }}
            </el-descriptions-item>
            <el-descriptions-item v-if="flowTarget.approver_comment" label="审批意见" :span="2">
              {{ flowTarget.approver_comment }}
            </el-descriptions-item>
          </el-descriptions>

          <el-timeline>
            <el-timeline-item
              v-for="step in flowTimelineSteps"
              :key="step.key"
              :timestamp="step.time"
              placement="top"
              :type="step.type as any"
              :hollow="step.hollow"
            >
              <div style="font-weight: 500;">{{ step.title }}</div>
              <div v-if="step.desc" style="color: #606266; font-size: 13px; margin-top: 4px;">{{ step.desc }}</div>
              <div v-if="step.operator" style="color: #909399; font-size: 13px; margin-top: 2px;">操作人：{{ step.operator }}</div>
            </el-timeline-item>
          </el-timeline>
        </template>
      </div>
      <template #footer>
        <el-button @click="flowDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  useResignationStore,
  type ResignationDocument,
  type ResignationDocumentType,
  type ResignationRequest,
  type ResignationTemplateType,
  type ResignationType,
} from '@/stores/resignation'
import { usePendingStore } from '@/stores/pending'
import { useAuthStore } from '@/stores/auth'

const RESIGN_TYPE_TEXT_MAP: Record<ResignationType, string> = {
  voluntary: '主动离职',
  contract_end: '合同到期',
  dismissal: '辞退',
}

const RESIGNATION_DOCUMENT_LABELS: Record<ResignationDocumentType, string> = {
  application_form: '离职申请表',
  handover_form_employee: '离职人交接单',
  handover_form_handover: '交接人交接单',
  termination_proof: '终止/解除劳动关系证明',
  asset_handover: '固定资产交接单',
  compensation_agreement: '离职经济补偿协议书',
  expense_settlement_agreement: '离职其他费用结算约定',
}

const REQUIRED_DOCUMENTS_BY_TYPE: Record<ResignationType, ResignationDocumentType[]> = {
  voluntary: [
    'application_form',
    'handover_form_employee',
    'termination_proof',
    'asset_handover',
    'expense_settlement_agreement',
  ],
  contract_end: [
    'application_form',
    'handover_form_employee',
    'termination_proof',
    'asset_handover',
    'expense_settlement_agreement',
  ],
  dismissal: [
    'application_form',
    'handover_form_employee',
    'termination_proof',
    'asset_handover',
    'compensation_agreement',
    'expense_settlement_agreement',
  ],
}

const resignationStore = useResignationStore()
const pendingStore = usePendingStore()
const authStore = useAuthStore()
const currentSignerName = computed(() => authStore.user?.name || '')

const saving = ref(false)
const submitting = ref(false)
const withdrawing = ref(false)
const confirming = ref(false)
const deleting = ref(false)
const detailVisible = ref(false)
const activeTopTab = ref<'management' | 'pending'>('management')
// 离职人自己的审批流程日志（用于「查看流程」弹窗）
const myAuditLogs = ref<Array<{ id: string; action: string; operator_name: string | null; comment: string | null; created_at: string }>>([])
const myAuditLogsLoading = ref(false)

const form = reactive({
  handover_user_id: '',
  resign_type: '',
  resign_date: '',
  reason: '',
})

const myProfile = computed(() => resignationStore.myData?.profile || null)
const myRequest = computed(() => resignationStore.myRequest)
const myTemplates = computed(() => resignationStore.myTemplates)
const visibleTemplates = computed(() => {
  const hiddenTemplateTypes = new Set<ResignationTemplateType>([
    'termination_proof',
    'asset_handover',
    'compensation_agreement',
    'expense_settlement_agreement',
    'partner_dividend_settlement',
  ])
  return myTemplates.value.filter(template => !hiddenTemplateTypes.has(template.template_type))
})
const myDocuments = computed(() => resignationStore.myDocuments)
const currentResignType = computed<ResignationType>(() => (form.resign_type || 'voluntary') as ResignationType)

const getEmployeeDocumentByType = (type: ResignationDocumentType) => {
  return myDocuments.value.find(doc => doc.document_type === type && doc.uploader_role === 'employee')
}

const employeeApplication = computed(() => getEmployeeDocumentByType('application_form'))
const employeeHandover = computed(() => getEmployeeDocumentByType('handover_form_employee'))
const handoverDocument = computed(() => myDocuments.value.find(doc => doc.document_type === 'handover_form_handover' && doc.uploader_role === 'handover'))
const additionalRequiredDocumentTypes = computed(() => REQUIRED_DOCUMENTS_BY_TYPE[currentResignType.value].filter(type => !['application_form', 'handover_form_employee'].includes(type)))
const additionalDocumentItems = computed(() => additionalRequiredDocumentTypes.value.map(type => ({
  type,
  label: RESIGNATION_DOCUMENT_LABELS[type],
  file: getEmployeeDocumentByType(type),
})))
const missingRequiredDocumentLabels = computed(() => {
  return REQUIRED_DOCUMENTS_BY_TYPE[currentResignType.value]
    .filter(type => !getEmployeeDocumentByType(type))
    .map(type => RESIGNATION_DOCUMENT_LABELS[type])
})
const currentHandoverName = computed(() => {
  if (myRequest.value?.handover_name) return myRequest.value.handover_name
  return resignationStore.candidates.find(item => item.id === form.handover_user_id)?.name || '-'
})

const canSubmit = computed(() => {
  return !!myRequest.value?.id
    && missingRequiredDocumentLabels.value.length === 0
    && ['draft', 'rejected'].includes(myRequest.value.status)
})

const canConfirm = computed(() => {
  return !!myRequest.value?.id
    && !!myRequest.value.submit_time
    && !myRequest.value.employee_confirm_time
    && !!handoverDocument.value
    && ['submitted', 'handover_confirmed'].includes(myRequest.value.status)
})

// 已提交且交接人尚未确认时，或已被驳回时，可撤回
const canWithdraw = computed(() => {
  if (!myRequest.value?.id) return false
  const status = myRequest.value.status
  if (status === 'submitted' && !myRequest.value.handover_confirm_time) return true
  if (status === 'rejected') return true
  return false
})

// 草稿或已驳回状态下可删除整个申请
const canDelete = computed(() => {
  return !!myRequest.value?.id
    && ['draft', 'rejected'].includes(myRequest.value.status)
})

// 草稿或已驳回状态下才能删除附件
const canEditDocs = computed(() => {
  return !myRequest.value || ['draft', 'rejected'].includes(myRequest.value.status)
})

// 提交后锁定离职类型、离职日期、交接人
const isFormLocked = computed(() => {
  return !!myRequest.value && !['draft', 'rejected'].includes(myRequest.value.status)
})

const nextActionText = computed(() => {
  if (!myRequest.value) return '请先填写离职申请并保存'
  const status = myRequest.value.status
  // handover_rejected 对离职人不可见，显示与 submitted 相同文案
  const effectiveStatus = status === 'handover_rejected' ? 'submitted' : status
  const statusMap: Record<string, string> = {
    draft: '补充材料后提交申请',
    submitted: '等待交接人上传并确认',
    handover_confirmed: myRequest.value.employee_confirm_time ? '等待管理员审批' : '请确认交接完成',
    mutual_confirmed: '等待管理员审批',
    approved: '流程已完成',
    rejected: '请修改后重新提交',
  }
  return statusMap[effectiveStatus] || '-'
})

// 审批流程时间线：基于 audit-logs + 字段兜底，与管理员端保持一致
const timelineSteps = computed(() => {
  const req = myRequest.value
  if (!req) return []
  const employeeName = myProfile.value?.name || '-'
  const handoverName = currentHandoverName.value

  interface Step { title: string; desc: string; operator: string; time: string; type: 'success' | 'danger' | 'warning' | 'primary' | 'info'; hollow: boolean }

  // 有 audit-logs 时直接使用（与管理员视图完全一致）
  if (myAuditLogs.value.length > 0) {
    const items: Step[] = myAuditLogs.value.map(log => {
      let type: Step['type'] = 'info'
      if (log.action.includes('通过')) type = 'success'
      else if (log.action.includes('驳回')) type = 'danger'
      else if (log.action.includes('撤回')) type = 'warning'
      else if (log.action.includes('提交')) type = 'primary'
      else if (log.action.includes('确认')) type = 'warning'
      return { title: log.action, desc: log.comment || '', operator: log.operator_name || '-', time: formatTime(log.created_at), type, hollow: false }
    })
    // 补充下一步待办
    if (req.status === 'submitted') {
      items.push({ title: '待交接人确认', desc: `等待交接人 ${handoverName} 上传交接单并确认`, operator: '', time: '', type: 'info', hollow: true })
    } else if (req.status === 'handover_rejected') {
      items.push({ title: '待交接人重新提交', desc: `交接单已被驳回，请交接人 ${handoverName} 重新上传`, operator: '', time: '', type: 'info', hollow: true })
    } else if (req.status === 'handover_confirmed') {
      items.push({ title: '待离职人确认', desc: `等待 ${employeeName} 确认交接完成`, operator: '', time: '', type: 'info', hollow: true })
    } else if (req.status === 'mutual_confirmed') {
      items.push({ title: '待管理员审批', desc: '等待管理员审批离职申请', operator: '', time: '', type: 'info', hollow: true })
    } else if (req.status === 'rejected') {
      items.push({ title: '待重新提交', desc: `申请已被驳回，请 ${employeeName} 修改后重新提交`, operator: '', time: '', type: 'info', hollow: true })
    }
    return items
  }

  // 无 audit-logs 时（老数据）从字段推导
  const steps: Step[] = []

  if (req.submit_time) {
    steps.push({ title: '已提交离职申请', desc: `${employeeName} 提交申请`, operator: employeeName, time: formatTime(req.submit_time), type: 'primary', hollow: false })
  } else {
    steps.push({ title: '待提交离职申请', desc: `${employeeName} 补充材料后提交申请`, operator: '', time: '', type: 'info', hollow: true })
    return steps
  }

  if (req.handover_confirm_time) {
    steps.push({ title: '交接人已确认', desc: `交接人 ${handoverName} 已确认交接完成`, operator: handoverName, time: formatTime(req.handover_confirm_time), type: 'warning', hollow: false })
  } else if (req.status === 'handover_rejected') {
    steps.push({ title: '管理员驳回交接单', desc: req.approver_comment || '', operator: '管理员', time: '', type: 'danger', hollow: false })
    steps.push({ title: '待交接人重新提交', desc: `请交接人 ${handoverName} 重新上传交接单`, operator: '', time: '', type: 'info', hollow: true })
    return steps
  } else {
    steps.push({ title: '待交接人确认', desc: `等待交接人 ${handoverName} 上传交接单并确认`, operator: '', time: '', type: 'info', hollow: true })
    return steps
  }

  if (req.employee_confirm_time) {
    steps.push({ title: '离职人已确认', desc: `${employeeName} 已确认交接完成`, operator: employeeName, time: formatTime(req.employee_confirm_time), type: 'warning', hollow: false })
  } else {
    steps.push({ title: '待离职人确认', desc: `等待 ${employeeName} 确认交接完成`, operator: '', time: '', type: 'info', hollow: true })
    return steps
  }

  if (req.approve_time) {
    if (req.status === 'approved') {
      steps.push({ title: '管理员审批通过', desc: req.approver_comment || '管理员已完成审批', operator: '管理员', time: formatTime(req.approve_time), type: 'success', hollow: false })
    } else {
      steps.push({ title: '管理员已驳回', desc: req.approver_comment || '管理员已驳回申请', operator: '管理员', time: formatTime(req.approve_time), type: 'danger', hollow: false })
      steps.push({ title: '待重新提交', desc: `申请已被驳回，请 ${employeeName} 修改后重新提交`, operator: '', time: '', type: 'info', hollow: true })
    }
  } else {
    steps.push({ title: '待管理员审批', desc: '等待管理员审批离职申请', operator: '', time: '', type: 'info', hollow: true })
  }

  return steps
})

const syncForm = () => {
  if (!myRequest.value) return
  form.handover_user_id = myRequest.value.handover_user_id
  form.resign_type = myRequest.value.resign_type
  form.resign_date = myRequest.value.resign_date
  form.reason = myRequest.value.reason || ''
}

const getDocumentLabel = (type: ResignationDocumentType) => {
  return RESIGNATION_DOCUMENT_LABELS[type] || type
}

const getResignTypeText = (type?: string) => {
  return RESIGN_TYPE_TEXT_MAP[(type as ResignationType) || 'voluntary'] || '-'
}

const getTemplateTypeText = (type: string) => {
  const templateTypeMap: Record<string, string> = {
    application_form: '离职申请表模板',
    handover_form: '交接单模板',
    termination_proof: '终止/解除劳动关系证明模板',
    asset_handover: '固定资产交接单模板',
    compensation_agreement: '离职经济补偿协议书模板',
    expense_settlement_agreement: '离职其他费用结算约定模板',
    partner_dividend_settlement: '合伙人离任分红结算模板',
  }
  return templateTypeMap[type] || '离职模板'
}

const getStatusType = (status?: string) => {
  const map: Record<string, any> = {
    draft: 'info',
    submitted: 'warning',
    handover_confirmed: 'warning',
    handover_rejected: 'danger',
    mutual_confirmed: 'warning',
    approved: 'success',
    rejected: 'danger',
  }
  return map[status || ''] || 'info'
}

const getStatusText = (status?: string) => {
  const map: Record<string, string> = {
    draft: '草稿',
    submitted: '待交接人处理',
    handover_confirmed: '待本人确认',
    handover_rejected: '交接人待重新提交',
    mutual_confirmed: '待管理员审批',
    approved: '已通过',
    rejected: '已驳回',
  }
  return map[status || ''] || '-'
}

const formatTime = (value?: string | null) => {
  if (!value) return '-'
  const normalized = value.replace(' ', 'T')
  const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(normalized)
    ? new Date(normalized.length === 16 ? `${normalized}:00` : normalized)
    : new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

const disabledResignDate = (date: Date) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const minDate = new Date(today)
  minDate.setMonth(minDate.getMonth() + 1)

  return date.getTime() < minDate.getTime()
}

const openTemplate = (id: string) => {
  window.open(`/api/resignation/templates/${id}/download`, '_blank')
}

const openDocument = (doc: ResignationDocument) => {
  if (!myRequest.value) return
  window.open(`/api/resignation/requests/${myRequest.value.id}/documents/${doc.id}/download`, '_blank')
}

const openTaskDocument = (requestId: string, docId: string) => {
  window.open(`/api/resignation/requests/${requestId}/documents/${docId}/download`, '_blank')
}

const downloadTaskDocument = (requestId: string, doc: ResignationDocument) => {
  const link = document.createElement('a')
  link.href = `/api/resignation/requests/${requestId}/documents/${doc.id}/download?download=1`
  link.download = doc.file_name
  link.click()
}

const validatePdf = (file: File) => {
  if (file.type !== 'application/pdf') {
    ElMessage.error('只支持 PDF 文件')
    return false
  }
  if (file.size / 1024 / 1024 > 10) {
    ElMessage.error('文件大小不能超过 10MB')
    return false
  }
  return true
}

const validateAttachment = (file: File) => {
  const allow = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
  if (!allow.includes(file.type)) {
    ElMessage.error('只支持 PDF、JPG、PNG 文件')
    return false
  }
  if (file.size / 1024 / 1024 > 10) {
    ElMessage.error('文件大小不能超过 10MB')
    return false
  }
  return true
}

const ensureRequest = async () => {
  if (myRequest.value?.id) return myRequest.value.id
  const res = await resignationStore.saveMyRequest({ ...form })
  if (!res.success) {
    ElMessage.error(res.message || '请先保存离职申请')
    return null
  }
  syncForm()
  return resignationStore.myRequest?.id || null
}

const handleSaveDraft = async () => {
  saving.value = true
  try {
    const res = await resignationStore.saveMyRequest({ ...form })
    if (res.success) {
      syncForm()
      await pendingStore.refreshPendingCounts()
      ElMessage.success('保存成功')
    } else {
      ElMessage.error(res.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

const handleSubmit = async () => {
  if (!myRequest.value?.id) {
    ElMessage.warning('请先保存离职申请')
    return
  }
  submitting.value = true
  try {
    const res = await resignationStore.submitMyRequest(myRequest.value.id)
    if (res.success) {
      await pendingStore.refreshPendingCounts()
      ElMessage.success('离职申请已提交')
    } else {
      ElMessage.error(res.message || '提交失败')
    }
  } finally {
    submitting.value = false
  }
}

const handleWithdraw = async () => {
  if (!myRequest.value?.id) return
  const isRejected = myRequest.value.status === 'rejected'
  const confirmMsg = isRejected
    ? '撤回后申请将回到草稿状态，可重新填写并提交，确定撤回吗？'
    : '撤回后申请将回到草稿状态，交接人确认记录也会清除，确定撤回吗？'
  try {
    await ElMessageBox.confirm(confirmMsg, '确认撤回', {
      confirmButtonText: '撤回',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  withdrawing.value = true
  try {
    const res = await resignationStore.withdrawMyRequest(myRequest.value.id)
    if (res.success) {
      await pendingStore.refreshPendingCounts()
      ElMessage.success('离职申请已撤回')
    } else {
      ElMessage.error(res.message || '撤回失败')
    }
  } finally {
    withdrawing.value = false
  }
}

const handleDelete = async () => {
  if (!myRequest.value?.id) return
  try {
    await ElMessageBox.confirm('删除后离职申请及所有已上传的材料将被永久清除，确定删除吗？', '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  deleting.value = true
  try {
    const res = await resignationStore.deleteMyRequest()
    if (res.success) {
      await pendingStore.refreshPendingCounts()
      // 重置表单
      form.handover_user_id = ''
      form.resign_type = ''
      form.resign_date = ''
      form.reason = ''
      ElMessage.success('离职申请已删除')
    } else {
      ElMessage.error(res.message || '删除失败')
    }
  } finally {
    deleting.value = false
  }
}

const handleConfirm = async () => {
  if (!myRequest.value?.id) return
  confirming.value = true
  try {
    const res = await resignationStore.confirmMyRequest(myRequest.value.id)
    if (res.success) {
      await pendingStore.refreshPendingCounts()
      ElMessage.success('已确认交接完成')
    } else {
      ElMessage.error(res.message || '确认失败')
    }
  } finally {
    confirming.value = false
  }
}

const handleConfirmTask = async (requestId: string) => {
  try {
    const res = await resignationStore.confirmHandoverTask(requestId)
    if (res.success) {
      await pendingStore.refreshPendingCounts()
      ElMessage.success('交接任务已确认完成')
    } else {
      ElMessage.error(res.message || '确认失败')
    }
  } catch (error: any) {
    const msg = error?.response?.data?.message || '确认失败'
    ElMessage.error(msg)
  }
}

const uploadEmployeeDocument = async (documentType: ResignationDocumentType, file: File) => {
  const requestId = await ensureRequest()
  if (!requestId) return false

  let res
  if (documentType === 'application_form') {
    res = await resignationStore.uploadMyApplication(requestId, file, documentType)
  } else if (documentType === 'handover_form_employee') {
    res = await resignationStore.uploadMyHandover(requestId, file, documentType)
  } else {
    // 补充材料使用通用文档上传接口
    res = await resignationStore.uploadMyDocument(requestId, file, documentType)
  }

  if (res.success) {
    await pendingStore.refreshPendingCounts()
    ElMessage.success(`${RESIGNATION_DOCUMENT_LABELS[documentType]}上传成功`)
  } else {
    ElMessage.error(res.message || '上传失败')
  }
  return false
}

const handleDeleteDocument = async (doc: ResignationDocument) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除「${RESIGNATION_DOCUMENT_LABELS[doc.document_type] || doc.file_name}」吗？`,
      '确认删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return // 用户取消
  }

  const res = await resignationStore.deleteMyDocument(doc.id)
  if (res.success) {
    await pendingStore.refreshPendingCounts()
    ElMessage.success(res.message || '删除成功')
  } else {
    ElMessage.error(res.message || '删除失败')
  }
}

const beforeUploadPdf = (documentType: ResignationDocumentType) => async (file: File) => {
  if (!validatePdf(file)) return false
  return await uploadEmployeeDocument(documentType, file)
}

const beforeUploadAttachment = (documentType: ResignationDocumentType) => async (file: File) => {
  if (!validateAttachment(file)) return false
  return await uploadEmployeeDocument(documentType, file)
}

const beforeUploadHandover = (role: 'employee' | 'handover', requestId?: string) => async (file: File) => {
  if (!validateAttachment(file)) return false
  if (role === 'employee') {
    return await uploadEmployeeDocument('handover_form_employee', file)
  } else if (requestId) {
    const res = await resignationStore.uploadHandoverTask(requestId, file)
    if (res.success) {
      await pendingStore.refreshPendingCounts()
      ElMessage.success('交接人交接单上传成功')
    } else {
      ElMessage.error(res.message || '上传失败')
    }
  }
  return false
}

const getTaskHandoverDoc = (row: { documents?: ResignationDocument[] }) => {
  return row.documents?.find(doc => doc.document_type === 'handover_form_handover' && doc.uploader_role === 'handover')
}

const getTaskEmployeeHandoverDoc = (row: { documents?: ResignationDocument[] }) => {
  return row.documents?.find(doc => doc.document_type === 'handover_form_employee' && doc.uploader_role === 'employee')
}

const handleDeleteHandoverDoc = async (requestId: string, doc: ResignationDocument) => {
  try {
    await ElMessageBox.confirm(`确定要删除「${doc.file_name}」吗？`, '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  const res = await resignationStore.deleteHandoverDocument(requestId, doc.id)
  if (res.success) {
    ElMessage.success('交接单已删除')
  } else {
    ElMessage.error(res.message || '删除失败')
  }
}

// 签名弹窗 —— 田字格字帖 + 贝塞尔平滑 + 毛笔压力 + 区域限制
const signDialogVisible = ref(false)
const signTarget = ref<ResignationRequest | null>(null)
const signing = ref(false)
const signCanvasRef = ref<HTMLCanvasElement>()
const signIsEmpty = ref(true)
let signCtx: CanvasRenderingContext2D | null = null

// 字格配置
const signCellSize = 150
const currentSignerChars = computed(() => (currentSignerName.value || '').split(''))
const signAreaHeight = computed(() => signCellSize + 2) // 格子 + 边框

// 字格区域（像素坐标），由 onSignDialogOpened 计算
let cellRects: { x1: number; y1: number; x2: number; y2: number }[] = []
// 离屏 canvas 的像素数据，用于检测笔画区域
let strokeMaskData: ImageData | null = null
let strokeMaskW = 0

// 笔迹点记录
interface BrushPoint { x: number; y: number; t: number }
let points: BrushPoint[] = []
let isDown = false

const openSignDialog = (row: ResignationRequest) => {
  signTarget.value = row
  signIsEmpty.value = true
  signDialogVisible.value = true
}

function calcLineWidth(p1: BrushPoint, p2: BrushPoint): number {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const dt = Math.max(p2.t - p1.t, 1)
  const speed = Math.sqrt(dx * dx + dy * dy) / dt
  const minW = 1.5, maxW = 6
  const w = maxW - (speed * 0.8)
  return Math.max(minW, Math.min(maxW, w))
}

function drawSmoothLine() {
  if (!signCtx || points.length < 2) return
  const ctx = signCtx
  if (points.length === 2) {
    const [p0, p1] = points
    ctx.lineWidth = calcLineWidth(p0, p1)
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.stroke()
    return
  }
  const len = points.length
  const p0 = points[len - 3]
  const p1 = points[len - 2]
  const p2 = points[len - 1]
  ctx.lineWidth = calcLineWidth(p1, p2)
  ctx.beginPath()
  ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2)
  ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
  ctx.stroke()
}

// 判断坐标是否在字帖笔画像素区域内
function isOnStroke(x: number, y: number): boolean {
  if (!strokeMaskData) return false
  const w = strokeMaskW
  const h = strokeMaskData.height
  const data = strokeMaskData.data
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || px >= w || py < 0 || py >= h) return false
  // 直接检测当前像素的 alpha 值
  return data[(py * w + px) * 4 + 3] > 30
}

function addPoint(x: number, y: number) {
  if (!isOnStroke(x, y)) {
    // 离开笔画区域立即中断当前笔划
    isDown = false
    points = []
    return
  }
  points.push({ x, y, t: Date.now() })
  drawSmoothLine()
  signIsEmpty.value = false
}

// el-dialog @opened 事件：弹窗动画完成后初始化 canvas + 计算字格区域
const onSignDialogOpened = () => {
  const canvas = signCanvasRef.value
  if (!canvas) return
  const parent = canvas.parentElement
  if (!parent) return

  const w = parent.clientWidth
  const h = parent.clientHeight
  canvas.width = w
  canvas.height = h

  signCtx = canvas.getContext('2d')
  if (!signCtx) return
  signCtx.strokeStyle = '#333'
  signCtx.lineCap = 'round'
  signCtx.lineJoin = 'round'

  // 用 canvas 像素尺寸直接计算字格区域（与 CSS flex 居中对齐）
  const chars = currentSignerChars.value
  const cellW = signCellSize
  const cellH = signCellSize
  const totalW = chars.length * cellW
  const startX = (w - totalW) / 2
  const startY = (h - cellH) / 2
  cellRects = chars.map((_, i) => ({
    x1: startX + i * cellW,
    y1: startY,
    x2: startX + (i + 1) * cellW,
    y2: startY + cellH,
  }))

  // 生成笔画蒙版：在离屏 canvas 上用楷体渲染文字，提取像素数据
  const offscreen = document.createElement('canvas')
  offscreen.width = w
  offscreen.height = h
  const offCtx = offscreen.getContext('2d')
  if (offCtx) {
    const fontFamily = '"STKaiti", "KaiTi", "KaiTi_GB2312", "楷体", "Noto Serif CJK SC", serif'
    offCtx.font = `100px ${fontFamily}`
    offCtx.textAlign = 'center'
    offCtx.textBaseline = 'middle'
    offCtx.fillStyle = '#000'
    chars.forEach((char, i) => {
      const cx = startX + i * cellW + cellW / 2
      const cy = startY + cellH / 2
      offCtx.fillText(char, cx, cy)
    })
    strokeMaskData = offCtx.getImageData(0, 0, w, h)
    strokeMaskW = w
  }

  // 鼠标事件
  canvas.onmousedown = (e: MouseEvent) => {
    if (!isOnStroke(e.offsetX, e.offsetY)) return
    isDown = true
    points = [{ x: e.offsetX, y: e.offsetY, t: Date.now() }]
  }
  canvas.onmousemove = (e: MouseEvent) => {
    // 动态更新光标：笔画上十字、笔画外禁止
    canvas.style.cursor = isOnStroke(e.offsetX, e.offsetY) ? 'crosshair' : 'not-allowed'
    if (!isDown) return
    addPoint(e.offsetX, e.offsetY)
  }
  canvas.onmouseup = () => { isDown = false; points = [] }
  canvas.onmouseleave = () => { isDown = false; points = [] }

  // 触屏事件 —— 将 clientX/Y 转为与 offsetX/Y 等价的 canvas 像素坐标
  function touchToCanvasXY(touch: Touch) {
    const rect = canvas.getBoundingClientRect()
    const cssX = touch.clientX - rect.left
    const cssY = touch.clientY - rect.top
    // CSS 尺寸 → canvas 像素尺寸
    return { x: cssX * (canvas.width / rect.width), y: cssY * (canvas.height / rect.height) }
  }

  canvas.ontouchstart = (e: TouchEvent) => {
    e.preventDefault()
    const { x, y } = touchToCanvasXY(e.touches[0])
    if (!isOnStroke(x, y)) return
    isDown = true
    points = [{ x, y, t: Date.now() }]
  }
  canvas.ontouchmove = (e: TouchEvent) => {
    e.preventDefault()
    if (!isDown) return
    const { x, y } = touchToCanvasXY(e.touches[0])
    addPoint(x, y)
  }
  canvas.ontouchend = () => { isDown = false; points = [] }
}

const clearSignCanvas = () => {
  const canvas = signCanvasRef.value
  if (!canvas || !signCtx) return
  signCtx.clearRect(0, 0, canvas.width, canvas.height)
  signIsEmpty.value = true
}

const confirmSign = async () => {
  const canvas = signCanvasRef.value
  if (!canvas || signIsEmpty.value || !signTarget.value?.id) return
  const dataUrl = canvas.toDataURL('image/png')

  signing.value = true
  try {
    const res = await resignationStore.signHandoverTask(signTarget.value.id, dataUrl)
    if (res.success) {
      await pendingStore.refreshPendingCounts()
      signDialogVisible.value = false
      ElMessage.success('签名确认成功，已生成已签名交接单')
    } else {
      ElMessage.error(res.message || '签名确认失败')
    }
  } finally {
    signing.value = false
  }
}

// 历史记录弹窗
const historyDialogVisible = ref(false)
const historyDocs = ref<(ResignationDocument & { is_current?: number })[]>([])
const historyLoading = ref(false)
const historyRequestId = ref('')

const openHistoryDialog = async (requestId: string) => {
  historyRequestId.value = requestId
  historyDialogVisible.value = true
  historyLoading.value = true
  try {
    const res = await resignationStore.fetchDocumentHistory(requestId)
    if (res.success) {
      historyDocs.value = res.data
    }
  } finally {
    historyLoading.value = false
  }
}

// 审批流程弹窗（交接人查看）
const flowDialogVisible = ref(false)
const flowLoading = ref(false)
const flowTarget = ref<ResignationRequest | null>(null)
const flowAuditLogs = ref<Array<{ id: string; action: string; operator_name: string; comment: string | null; created_at: string }>>([])

const openFlowDialog = async (row: ResignationRequest) => {
  flowTarget.value = row
  flowDialogVisible.value = true
  flowLoading.value = true
  flowAuditLogs.value = []
  try {
    const res = await resignationStore.fetchAuditLogs(row.id)
    if (res.success) {
      flowAuditLogs.value = res.data
    }
  } catch (error) {
    console.error('获取审批流程失败:', error)
  } finally {
    flowLoading.value = false
  }
}

const flowTimelineSteps = computed(() => {
  interface FlowStep { key: string; title: string; desc: string; time: string; type: string; hollow: boolean; operator: string; sortTime: string }
  const items: FlowStep[] = []
  const req = flowTarget.value
  if (!req) return items

  const employeeName = req.employee_name || '-'
  const handoverName = req.handover_name || '-'

  // 有 audit logs 时直接使用，与离职人视图完全一致
  if (flowAuditLogs.value.length > 0) {
    for (const log of flowAuditLogs.value) {
      let logType: string = 'info'
      if (log.action.includes('通过')) logType = 'success'
      else if (log.action.includes('驳回')) logType = 'danger'
      else if (log.action.includes('撤回')) logType = 'warning'
      else if (log.action.includes('提交')) logType = 'primary'
      else if (log.action.includes('确认')) logType = 'warning'
      items.push({
        key: log.id,
        title: log.action,
        desc: log.comment || '',
        time: formatTime(log.created_at),
        type: logType,
        hollow: false,
        operator: log.operator_name || '-',
        sortTime: log.created_at,
      })
    }
    // 补充下一步待处理
    if (req.status === 'submitted') {
      items.push({ key: 'next_handover', title: '待交接人确认', desc: `等待交接人 ${handoverName} 上传交接单并确认`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req.status === 'handover_rejected') {
      items.push({ key: 'next_handover_resubmit', title: '待交接人重新提交', desc: `请交接人 ${handoverName} 重新上传交接单`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req.status === 'handover_confirmed') {
      items.push({ key: 'next_employee', title: '待离职人确认', desc: `等待 ${employeeName} 确认交接完成`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req.status === 'mutual_confirmed') {
      items.push({ key: 'next_approve', title: '待管理员审批', desc: '等待管理员审批离职申请', time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req.status === 'rejected') {
      items.push({ key: 'next_resubmit', title: '待重新提交', desc: `申请已被驳回，请 ${employeeName} 修改后重新提交`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    }
    return items.sort((a, b) => {
      if (!a.sortTime && !b.sortTime) return 0
      if (!a.sortTime) return 1
      if (!b.sortTime) return -1
      return a.sortTime.localeCompare(b.sortTime)
    })
  }

  // 兼容老数据：无 audit logs 时从申请字段推导
  if (req.submit_time) {
    items.push({ key: 'submit', title: '提交离职申请', desc: '', time: formatTime(req.submit_time), type: 'primary', hollow: false, operator: employeeName, sortTime: req.submit_time })
  }
  if (req.handover_confirm_time) {
    items.push({ key: 'handover_confirm', title: '交接人确认交接完成', desc: '', time: formatTime(req.handover_confirm_time), type: 'warning', hollow: false, operator: handoverName, sortTime: req.handover_confirm_time })
  }
  if (req.employee_confirm_time) {
    items.push({ key: 'employee_confirm', title: '离职人确认交接完成', desc: '', time: formatTime(req.employee_confirm_time), type: 'warning', hollow: false, operator: employeeName, sortTime: req.employee_confirm_time })
  }
  if (req.approve_time) {
    const approved = req.status === 'approved'
    items.push({ key: 'approve', title: approved ? '管理员审批通过' : '管理员驳回申请', desc: req.approver_comment || '', time: formatTime(req.approve_time), type: approved ? 'success' : 'danger', hollow: false, operator: '管理员', sortTime: req.approve_time })
  }

  // 无步骤时提示待提交
  if (items.length === 0) {
    items.push({ key: 'pending', title: '待提交离职申请', desc: '员工尚未提交离职申请', time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
  } else {
    if (req.status === 'submitted') {
      items.push({ key: 'next_handover', title: '待交接人确认', desc: `等待交接人 ${handoverName} 上传交接单并确认`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req.status === 'handover_rejected') {
      items.push({ key: 'next_handover_resubmit', title: '待交接人重新提交', desc: `请交接人 ${handoverName} 重新上传交接单`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req.status === 'handover_confirmed') {
      items.push({ key: 'next_employee', title: '待离职人确认', desc: `等待 ${employeeName} 确认交接完成`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req.status === 'mutual_confirmed') {
      items.push({ key: 'next_approve', title: '待管理员审批', desc: '等待管理员审批离职申请', time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req.status === 'rejected') {
      items.push({ key: 'next_resubmit', title: '待重新提交', desc: `申请已被驳回，请 ${employeeName} 修改后重新提交`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    }
  }

  return items.sort((a, b) => {
    if (!a.sortTime && !b.sortTime) return 0
    if (!a.sortTime) return 1
    if (!b.sortTime) return -1
    return a.sortTime.localeCompare(b.sortTime)
  })
})

onMounted(async () => {
  await Promise.all([
    resignationStore.fetchCandidates(),
    resignationStore.fetchMyRequest(),
    resignationStore.fetchHandoverTasks(),
  ])
  syncForm()
})

// 打开「查看流程」弹窗时加载 audit logs
const handleOpenDetailDialog = async () => {
  if (!myRequest.value?.id) return
  myAuditLogsLoading.value = true
  myAuditLogs.value = []
  try {
    const res = await resignationStore.fetchAuditLogs(myRequest.value.id)
    if (res.success) {
      myAuditLogs.value = res.data
    }
  } catch (error) {
    console.error('获取审批流程失败:', error)
  } finally {
    myAuditLogsLoading.value = false
  }
}
</script>

<style scoped>
.resignation-container {
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

.page-card :deep(.el-card__body) {
  flex: 1;
  padding: 16px 24px 24px;
  overflow: auto;
}

.tabs-wrapper {
  position: relative;
  height: 100%;
}

.tab-badge {
  margin-left: 6px;
}

.tab-badge :deep(.el-badge__content) {
  top: -2px;
}

.content-tabs {
  height: 100%;
}

.content-tabs :deep(.el-tabs__header) {
  padding: 0;
  margin-bottom: 0;
}

.content-tabs :deep(.el-tabs__content) {
  height: calc(100% - 50px);
  overflow: auto;
  padding-top: 16px;
}

.content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-alert {
  margin-bottom: 0;
}

.summary-grid,
.upload-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.summary-main,
.summary-item,
.upload-row,
.template-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.summary-main {
  margin-bottom: 8px;
}

.summary-name {
  font-size: 20px;
  font-weight: 600;
}

.summary-meta {
  color: #606266;
  margin-bottom: 12px;
}

.summary-item {
  margin-bottom: 8px;
  color: #606266;
}

.summary-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.summary-warning {
  margin-top: 12px;
  color: #e6a23c;
  font-size: 13px;
  line-height: 1.6;
}

.template-list,
.upload-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.template-item,
.upload-row {
  padding: 12px 0;
  border-bottom: 1px solid #f0f2f5;
}

.template-title {
  font-weight: 500;
}

.template-name,
.empty-text {
  color: #909399;
  font-size: 13px;
}

.reason-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  color: #606266;
  cursor: default;
}

.upload-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  row-gap: 4px;
}

.material-label-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-tip {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
}

.handover-card,
.form-card {
  width: 100%;
}

.pending-tab-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0;
}

.detail-doc-section {
  margin-top: 20px;
}

.detail-doc-section h4 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.timeline {
  margin-top: 20px;
}

.timeline-title {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
  margin-bottom: 4px;
}

.timeline-desc {
  font-size: 13px;
  color: #909399;
  line-height: 1.5;
}

.sign-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sign-info {
  display: flex;
  gap: 24px;
  font-size: 14px;
  color: #606266;
}

.sign-tip {
  margin: 0;
  font-size: 13px;
  color: #909399;
}

.sign-canvas-wrap {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
  background: #f9f9f9;
  position: relative;
}

.sign-grid-row {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  pointer-events: none;
  z-index: 0;
}

.sign-grid-cell {
  position: relative;
  border: 1px solid #dcdfe6;
  background: #fff;
  overflow: hidden;
}

/* 田字格十字虚线 */
.sign-grid-cross-h,
.sign-grid-cross-v {
  position: absolute;
  background: transparent;
}
.sign-grid-cross-h {
  left: 0;
  right: 0;
  top: 50%;
  height: 0;
  border-top: 1px dashed #e8e8e8;
}
.sign-grid-cross-v {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 0;
  border-left: 1px dashed #e8e8e8;
}

.sign-grid-char {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "STKaiti", "KaiTi", "KaiTi_GB2312", "楷体", "楷体_GB2312", "Noto Serif CJK SC", serif;
  font-size: 100px;
  color: #ddd;
  user-select: none;
  line-height: 1;
}

.sign-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  touch-action: none;
  z-index: 1;
}

.signature-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

@media (max-width: 1100px) {
  .summary-grid,
  .upload-grid {
    grid-template-columns: 1fr;
  }
}
</style>
