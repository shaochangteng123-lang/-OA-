<template>
  <div class="leave-approval-timeline">
    <!-- 申请信息 -->
    <div class="request-info">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="申请编号">{{ request.request_no }}</el-descriptions-item>
        <el-descriptions-item label="假期类型">{{ request.leave_type_name }}</el-descriptions-item>
        <el-descriptions-item label="开始时间">
          {{ request.start_date }} {{ request.start_half === 'morning' ? '上午' : '下午' }}
        </el-descriptions-item>
        <el-descriptions-item label="结束时间">
          {{ request.end_date }} {{ request.end_half === 'morning' ? '上午' : '下午' }}
        </el-descriptions-item>
        <el-descriptions-item label="请假天数">
          <span class="days-value">{{ request.total_days }}</span> 个工作日
        </el-descriptions-item>
        <el-descriptions-item label="当前状态">
          <el-tag :type="statusTagType(request.status)">{{ statusLabel(request.status) }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="审批人">
          {{ formatPerson(request.approver_position, request.approver_real_name || request.approver_name || '总经理') }}
        </el-descriptions-item>
        <el-descriptions-item label="抄送对象">
          {{ formatCcRecipient(request) }}
        </el-descriptions-item>
        <el-descriptions-item label="请假事由" :span="2">{{ request.reason }}</el-descriptions-item>
      </el-descriptions>
    </div>

    <!-- 驳回原因 -->
    <el-alert
      v-if="request.status === 'rejected' && request.reject_reason"
      type="error"
      :closable="false"
      style="margin: 12px 0"
    >
      <template #title>驳回理由</template>
      {{ request.reject_reason }}
    </el-alert>

    <!-- 审批时间线 -->
    <div class="timeline-section">
      <div class="section-title">审批进度</div>
      <el-timeline>
        <el-timeline-item
          v-for="log in request.logs"
          :key="log.id"
          :timestamp="formatTime(log.created_at)"
          :type="logItemType(log.action)"
          placement="top"
        >
          <div class="timeline-content">
            <div class="timeline-person-row">
              <span class="operator">
                {{ formatLogPerson(log) }}
              </span>
              <el-tag size="small" :type="logTagType(log.action)">
                {{ actionLabel(log.action) }}
              </el-tag>
            </div>
            <div
              v-if="getLogComment(log)"
              class="log-comment"
              :class="{ 'reject-comment': log.action === 'reject' }"
            >
              <span class="comment-label">{{ log.action === 'reject' ? '驳回原因' : '备注' }}：</span>
              {{ getLogComment(log) }}
            </div>
            <div v-if="getLogAttachmentCards(log).length > 0" class="timeline-attachments">
              <div class="attachment-batch-title">
                本次上传附件（{{ getLogAttachmentCards(log).length }}个）
              </div>
              <LeaveFileCards :items="getLogAttachmentCards(log)" />
            </div>
          </div>
        </el-timeline-item>

        <!-- 待处理节点（pending状态时显示） -->
        <el-timeline-item
          v-if="request.status === 'pending'"
          timestamp="等待中..."
          type="warning"
          placement="top"
        >
          <div class="timeline-content">
            <div class="timeline-person-row">
              <span class="operator">
                {{ formatPerson(request.approver_position, request.approver_real_name || request.approver_name || '审批人') }}
              </span>
              <el-tag size="small" type="warning">待审批</el-tag>
            </div>
          </div>
        </el-timeline-item>
      </el-timeline>
    </div>

    <!-- 底部操作（草稿或驳回时显示重新提交按钮） -->
    <div v-if="showResubmit" class="bottom-actions">
      <el-button type="primary" @click="emit('resubmit', request.id)">
        {{ request.status === 'draft' ? '编辑草稿并重新提交' : '修改并重新提交' }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import LeaveFileCards from './LeaveFileCards.vue'
import { getAttachmentUrl } from '@/utils/leaveApi'
import { formatBeijingDateTime } from '@/utils/date'
import type { LeaveApprovalLog, LeaveRequestDetail } from '@/utils/leaveApi'

const props = defineProps<{
  request: LeaveRequestDetail
  isOwner?: boolean
}>()

const emit = defineEmits<{
  (e: 'resubmit', id: string): void
}>()

const showResubmit = computed(() => {
  return props.isOwner && ['draft', 'rejected'].includes(props.request.status)
})

const attachmentCardsByRequest = computed(() => {
  const groups = new Map<string, Array<{
    key: string
    name: string
    size: number | null
    previewUrl: string
    downloadUrl: string
  }>>()

  for (const attachment of props.request.attachments) {
    const cards = groups.get(attachment.leave_request_id) || []
    cards.push({
      key: attachment.id,
      name: attachment.file_name,
      size: attachment.file_size,
      previewUrl: getAttachmentUrl(attachment.id),
      downloadUrl: getAttachmentUrl(attachment.id),
    })
    groups.set(attachment.leave_request_id, cards)
  }

  return groups
})

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: '草稿',
    pending: '审批中',
    approved: '已批准',
    rejected: '已驳回',
    cancelled: '已撤销',
  }
  return map[status] || status
}

function statusTagType(status: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' | undefined {
  const map: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    draft: 'info',
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    cancelled: 'info',
  }
  return map[status] || undefined
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    submit: '提交申请',
    approve: '审批通过',
    reject: '驳回',
    cancel: '撤回为草稿',
    resubmit: '重新提交',
  }
  return map[action] || action
}

function logTagType(action: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' | undefined {
  const map: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    submit: 'primary',
    approve: 'success',
    reject: 'danger',
    cancel: 'info',
    resubmit: 'warning',
  }
  return map[action] || undefined
}

function logItemType(action: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' | undefined {
  const map: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    submit: 'primary',
    approve: 'success',
    reject: 'danger',
    cancel: 'info',
    resubmit: 'warning',
  }
  return map[action]
}

function formatTime(iso: string): string {
  return formatBeijingDateTime(iso)
}

function formatPerson(position: string | null | undefined, name: string): string {
  return position ? `${position} ${name}` : name
}

function formatCcRecipient(request: LeaveRequestDetail): string {
  const role = request.cc_recipient_role?.trim()
  const name = request.cc_recipient_name?.trim()
  if (role && name) return `${role} ${name}`
  return role || name || '管理员'
}

function formatLogPerson(log: LeaveApprovalLog): string {
  const name = log.operator_real_name || log.operator_name
  if (log.operator_id === props.request.user_id) return name
  return formatPerson(log.operator_position, name)
}

function getLogComment(log: LeaveApprovalLog): string {
  const comment = log.comment?.trim() || ''
  if (log.action === 'resubmit' && comment === '重新提交') return ''
  return comment
}

function getLogAttachmentCards(log: LeaveApprovalLog) {
  if (log.action !== 'submit' && log.action !== 'resubmit') return []
  return attachmentCardsByRequest.value.get(log.leave_request_id) || []
}

</script>

<style scoped>
.leave-approval-timeline {
  padding: 4px 0;
}
.request-info {
  margin-bottom: 16px;
}
.days-value {
  font-size: 18px;
  font-weight: 700;
  color: #409eff;
}
.timeline-section {
  margin-top: 16px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #f0f0f0;
}
.timeline-content {
  font-size: 13px;
}
.timeline-person-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.operator {
  font-weight: 600;
  color: #303133;
}
.log-comment {
  margin-top: 6px;
  color: #606266;
  line-height: 20px;
  white-space: pre-wrap;
  word-break: break-word;
}
.comment-label {
  font-weight: 600;
}
.reject-comment {
  color: #f56c6c;
}
.timeline-attachments {
  margin-top: 10px;
}
.attachment-batch-title {
  color: #606266;
  font-size: 12px;
  line-height: 18px;
}
.bottom-actions {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}
</style>
