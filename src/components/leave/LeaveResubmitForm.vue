<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
    <el-alert type="info" :closable="false" style="margin-bottom:16px">
      {{ formNotice }}
    </el-alert>

    <!-- 假期类型（只读） -->
    <el-form-item label="假期类型">
      <span>{{ originalRequest.leave_type_name }}</span>
    </el-form-item>

    <!-- 开始时间 -->
    <el-form-item label="开始时间" prop="startDate">
      <div class="date-half-row">
        <LeaveDatePicker
          v-model="form.startDate"
          placeholder="选择开始日期"
          :disabled="isCombinedExtension"
          :disabled-date="disableStartDate"
          @change="onDateChange"
        />
        <el-radio-group
          v-model="form.startHalf"
          class="half-radio"
          :disabled="isCombinedExtension"
          @change="onDateChange"
        >
          <el-radio-button value="morning">上午</el-radio-button>
          <el-radio-button value="afternoon">下午</el-radio-button>
        </el-radio-group>
      </div>
    </el-form-item>

    <!-- 结束时间 -->
    <el-form-item label="结束时间" prop="endDate">
      <div class="date-half-row">
        <LeaveDatePicker
          v-model="form.endDate"
          placeholder="选择结束日期"
          :disabled-date="disableEndDate"
          @change="onDateChange"
        />
        <el-radio-group v-model="form.endHalf" class="half-radio" @change="onDateChange">
          <el-radio-button value="morning">上午</el-radio-button>
          <el-radio-button value="afternoon">下午</el-radio-button>
        </el-radio-group>
      </div>
    </el-form-item>

    <!-- 时长 -->
    <el-form-item label="请假时长">
      <div class="duration-display">
        <el-icon v-if="calculating" class="is-loading"><Loading /></el-icon>
        <template v-else-if="calculatedDays !== null">
          <span class="duration-value">{{ calculatedDays }}</span>
          <span class="duration-unit">个工作日</span>
        </template>
        <span v-else class="duration-placeholder">选择日期后自动计算</span>
      </div>
    </el-form-item>

    <!-- 事由 -->
    <el-form-item label="请假事由" prop="reason">
      <el-input v-model="form.reason" type="textarea" :rows="3" maxlength="500" show-word-limit />
    </el-form-item>

    <!-- 附件 -->
    <el-form-item label="附件上传">
      <div class="attachment-row">
        <el-upload
          v-model:file-list="fileList"
          class="attachment-upload"
          :auto-upload="false"
          :show-file-list="false"
          :limit="5"
          multiple
          :accept="'.jpg,.jpeg,.png,.webp,.pdf'"
          :on-change="handleAttachmentFileChange"
          :on-exceed="handleExceed"
        >
          <el-button type="primary" plain size="small">选择文件</el-button>
        </el-upload>
        <span class="attachment-hint">
          {{ attachmentHint }}
        </span>
      </div>
      <LeaveFileCards :items="selectedFileCards" @remove="removeSelectedFile" />
      <div class="attachment-format-tip">支持 JPG / PNG / WEBP / PDF，每个不超过 5MB</div>

      <div v-if="existingAttachmentsLoading" class="attachment-loading">正在读取已上传附件...</div>
      <div v-else-if="existingAttachments.length > 0" class="existing-attachments">
        <div class="attachment-subtitle">已上传附件</div>
        <LeaveFileCards :items="existingAttachmentCards" @remove="removeExistingAttachment" />
        <div v-if="removedAttachmentIds.length > 0" class="attachment-removal-tip">
          已标记移除 {{ removedAttachmentIds.length }} 个当前草稿附件，提交成功后生效；取消编辑不会删除。
          <el-button link type="primary" @click="undoExistingAttachmentRemoval">撤销移除</el-button>
        </div>
      </div>
    </el-form-item>

    <el-form-item>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ submitButtonText }}</el-button>
      <el-button @click="emit('cancel')">取消</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import type { FormInstance, FormRules, UploadUserFile } from 'element-plus'
import LeaveDatePicker from './LeaveDatePicker.vue'
import LeaveFileCards from './LeaveFileCards.vue'
import { getLeaveAttachmentSizeError } from '@/utils/leaveAttachment'
import {
  calculateDays,
  getAttachmentUrl,
  getLeaveTypes,
  getRequestDetail,
  resubmitRequest as apiResubmit,
  type LeaveAttachment,
  type LeaveRequest,
} from '@/utils/leaveApi'
import {
  formatLocalDateValue,
  isFutureLeaveDateDisabled,
  isLeaveEndDateDisabled,
  isPastLeaveDateDisabled,
  isReturnSupplementEndDateDisabled,
} from '@/utils/leaveDate'

const props = defineProps<{
  originalRequest: LeaveRequest
}>()

const emit = defineEmits<{
  (e: 'submitted'): void
  (e: 'cancel'): void
}>()

const formRef = ref<FormInstance>()
const submitting = ref(false)
const calculatedDays = ref<number | null>(null)
const calculating = ref(false)
const fileList = ref<UploadUserFile[]>([])
const existingAttachments = ref<LeaveAttachment[]>([])
const existingAttachmentsLoading = ref(false)
const removedAttachmentIds = ref<string[]>([])
const requiresAttachment = ref(props.originalRequest.leave_type_code === 'sick')
let calcTimer: ReturnType<typeof setTimeout> | null = null

const isDraft = computed(() => props.originalRequest.status === 'draft')
const isSupplement = computed(() => props.originalRequest.application_kind === 'supplement')
const isStandaloneReturnSupplement = computed(() => (
  isSupplement.value && props.originalRequest.parent_request_id === null
))
const isCombinedExtension = computed(() => (
  props.originalRequest.application_kind === 'extension' &&
  Boolean(props.originalRequest.combination_group_id)
))
const formNotice = computed(() => {
  if (isStandaloneReturnSupplement.value) {
    return `这是返岗补假申请，只能补录今天或过去的日期。申请编号：${props.originalRequest.request_no}`
  }
  return isDraft.value
    ? `该申请已撤回并保存为草稿，提交后将进入审批。申请编号：${props.originalRequest.request_no}`
    : `原申请已被驳回，请修改后重新提交。原申请编号：${props.originalRequest.request_no}`
})
const submitButtonText = computed(() => {
  if (isStandaloneReturnSupplement.value) {
    return isDraft.value ? '提交返岗补假申请' : '重新提交返岗补假'
  }
  return isDraft.value ? '提交申请' : '重新提交'
})
const selectedFileCards = computed(() => fileList.value.map((file, index) => ({
  key: getUploadFileKey(file, index),
  name: file.name,
  size: file.size ?? file.raw?.size ?? null,
  previewFile: file.raw,
  previewUrl: file.raw ? undefined : file.url,
  removable: true,
})))
const existingAttachmentCards = computed(() => existingAttachments.value
  .filter(attachment => !removedAttachmentIds.value.includes(attachment.id))
  .map(attachment => ({
    key: attachment.id,
    name: attachment.file_name,
    size: attachment.file_size,
    previewUrl: getAttachmentUrl(attachment.id),
    downloadUrl: getAttachmentUrl(attachment.id),
    removable: isDraft.value && attachment.leave_request_id === props.originalRequest.id,
  })))
const attachmentHint = computed(() => requiresAttachment.value
  ? '该假期类型需上传证明文件（必须）'
  : '可选上传证明材料'
)

const today = formatLocalDateValue()
const initialStartDate = isSupplement.value ||
  isCombinedExtension.value ||
  props.originalRequest.start_date >= today
  ? props.originalRequest.start_date
  : ''
const initialEndDate = initialStartDate && props.originalRequest.end_date >= initialStartDate
  ? props.originalRequest.end_date
  : ''

const form = ref({
  startDate: initialStartDate,
  startHalf: props.originalRequest.start_half as 'morning' | 'afternoon',
  endDate: initialEndDate,
  endHalf: props.originalRequest.end_half as 'morning' | 'afternoon',
  reason: props.originalRequest.reason,
})

const NO_REASON_TYPES = [
  'annual',
  'marriage',
  'bereavement',
  'compensatory',
  'maternity',
  'paternity',
]
const reasonRequired = !NO_REASON_TYPES.includes(props.originalRequest.leave_type_code)

const rules: FormRules = {
  startDate: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
  endDate: [{ required: true, message: '请选择结束日期', trigger: 'change' }],
  reason: reasonRequired
    ? [{ required: true, message: '请填写请假事由', trigger: 'blur' }]
    : [],
}

function disableStartDate(time: Date): boolean {
  if (isStandaloneReturnSupplement.value) return isFutureLeaveDateDisabled(time)
  return isSupplement.value ? false : isPastLeaveDateDisabled(time)
}

function disableEndDate(time: Date): boolean {
  if (isStandaloneReturnSupplement.value) {
    return isReturnSupplementEndDateDisabled(time, form.value.startDate)
  }
  if (isSupplement.value) {
    const date = formatLocalDateValue(time)
    return Boolean(form.value.startDate && date < form.value.startDate)
  }
  return isLeaveEndDateDisabled(time, form.value.startDate)
}

function getUploadFileKey(file: UploadUserFile, index: number): string {
  return String(file.uid ?? `${file.name}-${file.size ?? 0}-${index}`)
}

function removeSelectedFile(key: string | number) {
  fileList.value = fileList.value.filter((file, index) => getUploadFileKey(file, index) !== String(key))
}

function removeExistingAttachment(key: string | number) {
  const attachmentId = String(key)
  const attachment = existingAttachments.value.find(item => item.id === attachmentId)
  if (
    !isDraft.value ||
    !attachment ||
    attachment.leave_request_id !== props.originalRequest.id
  ) return
  if (!removedAttachmentIds.value.includes(attachmentId)) {
    removedAttachmentIds.value = [...removedAttachmentIds.value, attachmentId]
  }
}

function undoExistingAttachmentRemoval() {
  removedAttachmentIds.value = []
}

function handleExceed() {
  ElMessage.warning('最多上传5个文件')
}

function handleAttachmentFileChange(file: UploadUserFile) {
  const error = getLeaveAttachmentSizeError(file.name, file.size ?? file.raw?.size)
  if (!error) return
  fileList.value = fileList.value.filter(item => item.uid !== file.uid)
  ElMessage.error(error)
}

async function loadExistingAttachments() {
  existingAttachmentsLoading.value = true
  try {
    const detail = await getRequestDetail(props.originalRequest.id)
    existingAttachments.value = detail.attachments || []
    removedAttachmentIds.value = []
  } catch {
    existingAttachments.value = []
  } finally {
    existingAttachmentsLoading.value = false
  }
}

async function loadAttachmentRequirement() {
  try {
    const types = await getLeaveTypes()
    const type = types.find(item => item.code === props.originalRequest.leave_type_code)
    if (type) requiresAttachment.value = type.requires_attachment
  } catch {
    // 类型配置读取失败时保留病假的兼容必传规则。
  }
}

function onDateChange() {
  if (!form.value.startDate || !form.value.endDate) { calculatedDays.value = null; return }
  if (calcTimer) clearTimeout(calcTimer)
  calcTimer = setTimeout(async () => {
    calculating.value = true
    try {
      const result = await calculateDays({
        startDate: form.value.startDate,
        startHalf: form.value.startHalf,
        endDate: form.value.endDate,
        endHalf: form.value.endHalf,
        allowPast: isSupplement.value,
      })
      calculatedDays.value = result.days
    } catch {
      calculatedDays.value = null
    } finally {
      calculating.value = false
    }
  }, 400)
}

// 初始计算
onDateChange()
onMounted(() => {
  void loadExistingAttachments()
  void loadAttachmentRequirement()
})

async function handleSubmit() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return
    if (
      requiresAttachment.value &&
      fileList.value.length === 0 &&
      existingAttachmentCards.value.length === 0
    ) {
      ElMessage.warning('该假期类型需要至少保留或重新上传一个证明文件')
      return
    }
    submitting.value = true
    try {
      const formData = new FormData()
      formData.append('startDate', form.value.startDate)
      formData.append('startHalf', form.value.startHalf)
      formData.append('endDate', form.value.endDate)
      formData.append('endHalf', form.value.endHalf)
      formData.append('reason', form.value.reason)
      if (removedAttachmentIds.value.length > 0) {
        formData.append('removedAttachmentIds', JSON.stringify(removedAttachmentIds.value))
      }
      for (const file of fileList.value) {
        if (file.raw) formData.append('attachments', file.raw)
      }
      await apiResubmit(props.originalRequest.id, formData)
      ElMessage.success(isDraft.value ? '请假申请已提交，等待审批' : '已重新提交，等待审批')
      emit('submitted')
    } catch (err: any) {
      ElMessage.error(err?.response?.data?.message || '提交失败')
    } finally {
      submitting.value = false
    }
  })
}
</script>

<style scoped>
.date-half-row { display: flex; align-items: center; gap: 12px; }
.half-radio :deep(.el-radio-button__inner) { padding: 6px 12px; }
.duration-display { display: flex; align-items: center; gap: 6px; min-height: 32px; }
.duration-value { font-size: 22px; font-weight: 700; color: #409eff; }
.duration-unit { font-size: 14px; color: #606266; }
.duration-placeholder { color: #c0c4cc; font-size: 14px; }
.attachment-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
}
.attachment-upload {
  flex-shrink: 0;
}
.attachment-hint {
  display: flex;
  align-items: center;
  min-height: 32px;
  color: #909399;
  font-size: 12px;
  line-height: 18px;
}
.attachment-format-tip {
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
}
.attachment-loading {
  margin-top: 10px;
  color: #909399;
  font-size: 12px;
}
.existing-attachments {
  width: 100%;
  margin-top: 12px;
}
.attachment-subtitle {
  color: #606266;
  font-size: 12px;
  line-height: 18px;
}
.attachment-removal-tip {
  margin-top: 8px;
  color: #e6a23c;
  font-size: 12px;
  line-height: 24px;
}
</style>
