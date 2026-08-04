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
          {{ formatPerson(request.approver_position, request.approver_real_name || request.approver_name || '审批人') }}
        </el-descriptions-item>
        <el-descriptions-item label="抄送对象">
          {{ formatCcRecipient(request) }}
        </el-descriptions-item>
        <el-descriptions-item label="申请方式">
          <el-tag
            size="small"
            effect="plain"
            :type="applicationKindTagType(request.application_kind)"
          >
            {{ applicationKindLabel(request) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="请假事由" :span="2">{{ request.reason }}</el-descriptions-item>
      </el-descriptions>
    </div>

    <div v-if="request.parent_request" class="relation-section parent-request-section">
      <div class="section-title-row">
        <div class="section-title">原请假信息</div>
        <el-button
          link
          type="primary"
          size="small"
          :icon="View"
          @click="emit('view-request', request.parent_request.id)"
        >
          查看原申请
        </el-button>
      </div>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="申请编号">
          {{ request.parent_request.request_no }}
        </el-descriptions-item>
        <el-descriptions-item label="假期类型">
          {{ request.parent_request.leave_type_name }}
        </el-descriptions-item>
        <el-descriptions-item label="请假时间" :span="2">
          {{ formatRelatedPeriod(request.parent_request) }}
        </el-descriptions-item>
        <el-descriptions-item label="请假天数">
          {{ request.parent_request.total_days }} 个工作日
        </el-descriptions-item>
        <el-descriptions-item label="审批状态">
          <el-tag :type="statusTagType(request.parent_request.status)" size="small">
            {{ statusLabel(request.parent_request.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="请假事由" :span="2">
          {{ request.parent_request.reason || '未填写' }}
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <div
      v-if="(request.combination_requests?.length || 0) > 1"
      class="relation-section"
    >
      <div class="section-title">组合申请记录</div>
      <div
        v-for="item in request.combination_requests"
        :key="item.id"
        class="relation-row"
      >
        <div class="relation-main">
          <span>{{ item.request_no }} · {{ item.leave_type_name }} · {{ item.total_days }}天</span>
          <small>{{ formatRelatedPeriod(item) }}</small>
        </div>
        <div class="relation-actions">
          <el-tag :type="statusTagType(item.status)" size="small">
            {{ statusLabel(item.status) }}
          </el-tag>
          <el-button
            v-if="item.id !== request.id"
            link
            type="primary"
            size="small"
            :icon="View"
            @click="emit('view-request', item.id)"
          >
            查看
          </el-button>
          <span v-else class="current-record">当前</span>
        </div>
      </div>
    </div>

    <div
      v-if="otherRelatedRequests.length > 0"
      class="relation-section"
    >
      <div class="section-title">同一主申请下的其他记录</div>
      <div
        v-for="item in otherRelatedRequests"
        :key="item.id"
        class="relation-row"
      >
        <div class="relation-main">
          <span>
            {{ applicationKindLabel(item) }}
            · {{ item.request_no }} · {{ item.leave_type_name }} · {{ item.total_days }}天
          </span>
          <small>{{ formatRelatedPeriod(item) }}</small>
        </div>
        <div class="relation-actions">
          <el-tag :type="statusTagType(item.status)" size="small">
            {{ statusLabel(item.status) }}
          </el-tag>
          <el-button
            link
            type="primary"
            size="small"
            :icon="View"
            @click="emit('view-request', item.id)"
          >
            查看
          </el-button>
        </div>
      </div>
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
import { View } from '@element-plus/icons-vue'
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
  (e: 'view-request', id: string): void
}>()

const showResubmit = computed(() => {
  return props.isOwner && ['draft', 'rejected'].includes(props.request.status)
})

const otherRelatedRequests = computed(() => {
  return (props.request.related_requests || []).filter(item => item.id !== props.request.id)
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

function applicationKindLabel(
  request: {
    application_kind: LeaveRequestDetail['application_kind']
    combination_group_id?: string | null
  }
): string {
  if (request.combination_group_id && request.application_kind === 'extension') {
    return '组合续假'
  }
  if (request.combination_group_id && request.application_kind === 'supplement') {
    return '组合补假'
  }
  const map: Record<LeaveRequestDetail['application_kind'], string> = {
    normal: '普通请假',
    combined: '组合请假',
    extension: '续假',
    supplement: '补假',
  }
  return map[request.application_kind] || '普通请假'
}

function applicationKindTagType(
  kind: LeaveRequestDetail['application_kind']
): 'primary' | 'success' | 'warning' | 'info' {
  const map: Record<LeaveRequestDetail['application_kind'], 'primary' | 'success' | 'warning' | 'info'> = {
    normal: 'info',
    combined: 'primary',
    extension: 'success',
    supplement: 'warning',
  }
  return map[kind] || 'info'
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

function formatRelatedPeriod(request: {
  start_date: string
  start_half: 'morning' | 'afternoon'
  end_date: string
  end_half: 'morning' | 'afternoon'
}): string {
  const startHalf = request.start_half === 'morning' ? '上午' : '下午'
  const endHalf = request.end_half === 'morning' ? '上午' : '下午'
  return `${request.start_date}${startHalf} 至 ${request.end_date}${endHalf}`
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
.relation-section {
  margin: 14px 0;
}
.relation-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid #f0f0f0;
  color: #606266;
  font-size: 12px;
}
.relation-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.relation-main small {
  color: #909399;
  font-size: 11px;
}
.relation-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.current-record {
  color: #909399;
  font-size: 12px;
}
.parent-request-section {
  margin-top: 0;
}
.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #f0f0f0;
}
.section-title-row .section-title {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: 0;
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
