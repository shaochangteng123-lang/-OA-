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

    <!-- 附件列表 -->
    <div v-if="request.attachments && request.attachments.length > 0" class="attachments-section">
      <div class="section-title">附件（{{ request.attachments.length }}个）</div>
      <div class="attachment-list">
        <div
          v-for="att in request.attachments"
          :key="att.id"
          class="attachment-item"
        >
          <el-icon><Document /></el-icon>
          <span class="att-name">{{ att.file_name }}</span>
          <span class="att-size" v-if="att.file_size">{{ formatFileSize(att.file_size) }}</span>
          <a
            :href="`/api/leave/attachments/${att.id}/download`"
            target="_blank"
            class="att-download"
          >
            下载
          </a>
        </div>
      </div>
    </div>

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
            <span class="operator">{{ log.operator_name }}</span>
            <el-tag size="small" :type="logTagType(log.action)" style="margin: 0 6px">
              {{ actionLabel(log.action) }}
            </el-tag>
            <span v-if="log.comment" class="log-comment">{{ log.comment }}</span>
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
            <span class="operator">{{ request.approver_name || '审批人' }}</span>
            <el-tag size="small" type="warning" style="margin: 0 6px">待审批</el-tag>
          </div>
        </el-timeline-item>
      </el-timeline>
    </div>

    <!-- 底部操作（驳回时显示重新提交按钮） -->
    <div v-if="showResubmit" class="bottom-actions">
      <el-button type="primary" @click="emit('resubmit', request.id)">
        修改并重新提交
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Document } from '@element-plus/icons-vue'
import type { LeaveRequestDetail } from '@/utils/leaveApi'

const props = defineProps<{
  request: LeaveRequestDetail
  isOwner?: boolean
}>()

const emit = defineEmits<{
  (e: 'resubmit', id: string): void
}>()

const showResubmit = computed(() => {
  return props.isOwner && props.request.status === 'rejected'
})

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '审批中',
    approved: '已批准',
    rejected: '已驳回',
    cancelled: '已撤销',
  }
  return map[status] || status
}

function statusTagType(status: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' | undefined {
  const map: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
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
    cancel: '撤销',
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
  if (!iso) return ''
  return iso.replace('T', ' ').substring(0, 16)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
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
.attachments-section, .timeline-section {
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
.attachment-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #f8f9fa;
  border-radius: 4px;
  font-size: 13px;
}
.att-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.att-size {
  color: #909399;
  font-size: 12px;
}
.att-download {
  color: #409eff;
  text-decoration: none;
  white-space: nowrap;
}
.att-download:hover {
  text-decoration: underline;
}
.timeline-content {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 13px;
}
.operator {
  font-weight: 600;
  color: #303133;
}
.log-comment {
  color: #606266;
  font-style: italic;
}
.bottom-actions {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}
</style>
