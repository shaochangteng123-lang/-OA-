<template>
  <el-form
    :key="formResetKey"
    ref="formRef"
    :model="form"
    :rules="rules"
    :validate-on-rule-change="false"
    label-width="90px"
    class="leave-request-form"
  >
    <el-form-item label="申请方式">
      <el-radio-group v-model="requestMode" @change="handleModeChange">
        <el-radio-button value="single">单一请假</el-radio-button>
        <el-radio-button value="combined">组合请假</el-radio-button>
      </el-radio-group>
    </el-form-item>

    <el-form-item v-if="requestMode === 'single'" label="假期类型" prop="leaveTypeCode">
      <div class="type-action-row">
        <el-select
          v-model="form.leaveTypeCode"
          placeholder="请选择假期类型"
          @change="handleTypeChange"
        >
          <el-option
            v-for="type in leaveTypes"
            :key="type.code"
            :label="type.name"
            :value="type.code"
            :disabled="type.is_available === false"
          >
            <span>{{ type.name }}</span>
            <span v-if="type.requires_balance_check && getBalance(type.code)" class="option-balance">
              可用 {{ getBalance(type.code)?.available_days }} 天
            </span>
            <span
              v-if="type.is_available === false"
              class="option-unavailable"
              :title="type.unavailable_reason || '当前不可申请'"
            >
              已锁定
            </span>
            <el-tooltip
              v-if="type.description"
              :content="type.description"
              placement="right"
            >
              <el-icon class="option-info"><InfoFilled /></el-icon>
            </el-tooltip>
          </el-option>
        </el-select>
        <el-button
          type="primary"
          plain
          :icon="CircleCheck"
          :loading="fillingFullLeave"
          :disabled="!canFillFullLeave"
          @click="handleFillFullLeave"
        >
          一键请满
        </el-button>
      </div>
    </el-form-item>

    <el-form-item label="开始时间" prop="startDate">
      <div class="date-half-row">
        <LeaveDatePicker
          v-model="form.startDate"
          placeholder="选择开始日期"
          :disabled-date="isPastLeaveDateDisabled"
          @change="onDateChange"
        />
        <el-radio-group v-model="form.startHalf" class="half-radio" @change="onDateChange">
          <el-radio-button value="morning">上午</el-radio-button>
          <el-radio-button value="afternoon">下午</el-radio-button>
        </el-radio-group>
      </div>
    </el-form-item>

    <el-form-item label="结束时间" prop="endDate">
      <div class="date-half-row">
        <LeaveDatePicker
          v-model="form.endDate"
          :placeholder="requestMode === 'combined' ? '自动计算，可调整' : '选择结束日期'"
          :disabled-date="disableEndDate"
          @change="onEndDateChange"
        />
        <el-radio-group
          v-model="form.endHalf"
          class="half-radio"
          @change="onEndDateChange"
        >
          <el-radio-button value="morning">上午</el-radio-button>
          <el-radio-button value="afternoon">下午</el-radio-button>
        </el-radio-group>
      </div>
    </el-form-item>

    <el-form-item label="请假时长">
      <div class="duration-display">
        <el-icon v-if="calculating" class="is-loading"><Loading /></el-icon>
        <template v-else-if="calculatedDays !== null">
          <span class="duration-value">{{ calculatedDays }}</span>
          <span class="duration-unit">个工作日</span>
        </template>
        <span v-else class="duration-placeholder">
          {{ requestMode === 'combined' ? '选择假期分配后自动计算' : '选择日期后自动计算' }}
        </span>
      </div>
    </el-form-item>

    <el-form-item
      v-if="requestMode === 'single'"
      label="请假事由"
      prop="reason"
    >
      <el-input
        v-model="form.reason"
        type="textarea"
        :rows="3"
        :placeholder="reasonRequired(form.leaveTypeCode) ? '请填写请假事由...' : '选填'"
        maxlength="500"
        show-word-limit
      />
      <div
        v-if="!reasonRequired(form.leaveTypeCode) && form.leaveTypeCode"
        class="field-tip"
      >
        该假期类型无需填写事由
      </div>
    </el-form-item>

    <el-form-item v-else label="假期分配">
      <div class="combination-editor">
        <div class="allocation-summary">
          <div class="allocation-status">
            <span class="allocation-total">
              组合总计 <strong>{{ allocatedDays }}</strong> 天
            </span>
            <span
              class="allocation-auto-status"
              :class="{ 'is-warning': allocationNeedsAdjustment }"
            >
              {{ calculating ? '正在计算' : allocationStatusText }}
            </span>
          </div>
          <el-tooltip
            content="将固定额度假期恢复为当前全部可用天数"
            placement="top"
          >
            <el-button
              type="primary"
              plain
              size="small"
              :icon="CircleCheck"
              :disabled="!canFillCombinedLeave"
              @click="fillCombinedLeave"
            >
              按余额填满
            </el-button>
          </el-tooltip>
        </div>

        <div
          v-for="(segment, index) in segments"
          :key="segment.key"
          class="segment-row"
        >
          <div class="segment-main-row">
            <span class="segment-index">{{ index + 1 }}</span>
            <el-select
              v-model="segment.leaveTypeCode"
              placeholder="选择假期"
              class="segment-type"
              @change="handleSegmentTypeChange(segment)"
            >
              <el-option
                v-for="type in leaveTypes"
                :key="type.code"
                :label="type.name"
                :value="type.code"
                :disabled="isTypeOptionDisabled(type, segment.key)"
              >
                <span>{{ type.name }}</span>
                <span v-if="type.requires_balance_check && getBalance(type.code)" class="option-balance">
                  可用 {{ getBalance(type.code)?.available_days }} 天
                </span>
                <span
                  v-if="type.is_available === false"
                  class="option-unavailable"
                  :title="type.unavailable_reason || '当前不可申请'"
                >
                  已锁定
                </span>
              </el-option>
            </el-select>
            <el-tooltip
              v-if="getType(segment.leaveTypeCode)?.requires_attachment"
              :content="`${getTypeName(segment.leaveTypeCode)}需要上传证明文件`"
              placement="top"
            >
              <el-tag
                class="segment-proof-tag"
                type="warning"
                effect="plain"
                size="small"
              >
                需上传证明
              </el-tag>
            </el-tooltip>
            <el-input-number
              v-model="segment.days"
              :min="0.5"
              :max="getSegmentMaxDays(segment)"
              :step="0.5"
              :precision="1"
              placeholder="天数"
              controls-position="right"
              class="segment-days"
              @change="handleSegmentDaysChange"
            />
            <span class="days-label">天</span>
            <el-tooltip
              v-if="getType(segment.leaveTypeCode)?.requires_balance_check"
              content="恢复为当前全部可用余额"
              placement="top"
            >
              <el-button
                plain
                size="small"
                :icon="CircleCheck"
                :disabled="!segment.leaveTypeCode"
                @click="fillSegment(segment)"
              >
                填满
              </el-button>
            </el-tooltip>
            <el-tooltip content="删除此段" placement="top">
              <el-button
                circle
                text
                type="danger"
                :icon="Delete"
                :disabled="segments.length <= 2"
                @click="removeSegment(segment.key)"
              />
            </el-tooltip>
          </div>
          <el-input
            v-if="reasonRequired(segment.leaveTypeCode)"
            v-model="segment.reason"
            type="textarea"
            :rows="2"
            :placeholder="`填写${getTypeName(segment.leaveTypeCode)}事由`"
            maxlength="500"
            show-word-limit
            class="segment-reason"
          />
        </div>

        <el-button
          plain
          :icon="Plus"
          :disabled="segments.length >= 8"
          @click="addSegment"
        >
          添加假期类型
        </el-button>
      </div>
    </el-form-item>

    <el-form-item v-if="requiresAttachments" label="证明文件" prop="attachments">
      <div class="upload-area">
        <div class="upload-required-types">
          <span>需要证明的假期</span>
          <el-tag
            v-for="type in attachmentRequiredTypes"
            :key="type.code"
            type="warning"
            effect="plain"
            size="small"
          >
            {{ type.name }}
          </el-tag>
        </div>
        <el-upload
          ref="uploadRef"
          v-model:file-list="fileList"
          :auto-upload="false"
          :show-file-list="false"
          :limit="5"
          multiple
          :accept="'.jpg,.jpeg,.png,.pdf'"
          list-type="text"
          :on-exceed="handleExceed"
        >
          <el-button type="primary" plain size="small">
            <el-icon><Upload /></el-icon>
            选择文件
          </el-button>
        </el-upload>
        <LeaveFileCards :items="selectedFileCards" @remove="removeSelectedFile" />
        <div class="upload-warn">
          <el-icon><WarningFilled /></el-icon>
          {{ attachmentRequirementText }}
        </div>
        <div class="upload-tip">支持 JPG / PNG / PDF，每个不超过 5MB</div>
      </div>
    </el-form-item>

    <el-form-item>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="calculating || calculatedDays === null || calculatedDays <= 0"
        @click="handleSubmit"
      >
        {{ requestMode === 'combined' ? '提交组合请假' : '提交申请' }}
      </el-button>
      <el-button @click="handleReset">重置</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  CircleCheck,
  Delete,
  InfoFilled,
  Loading,
  Plus,
  Upload,
  WarningFilled,
} from '@element-plus/icons-vue'
import type { FormInstance, FormRules, UploadUserFile } from 'element-plus'
import LeaveDatePicker from './LeaveDatePicker.vue'
import LeaveFileCards from './LeaveFileCards.vue'
import {
  calculateDays,
  calculateFullLeavePeriod,
  calculatePeriodByDays,
  getLeaveTypes,
  getMyBalances,
  submitCombinedLeaveRequests,
  submitLeaveRequest,
  type LeaveBalance,
  type LeaveTypeConfig,
} from '@/utils/leaveApi'
import { getAutomaticCombinedLeaveDays } from '@/utils/leaveCombination'
import {
  formatAttachmentRequirementMessage,
  getAttachmentRequiredLeaveTypes,
} from '@/utils/leaveAttachment'
import { isLeaveEndDateDisabled, isPastLeaveDateDisabled } from '@/utils/leaveDate'

const emit = defineEmits<{
  (event: 'submitted'): void
}>()

type RequestMode = 'single' | 'combined'

interface CombinationSegment {
  key: number
  leaveTypeCode: string
  days: number | null
  reason: string
}

interface LeaveRequestFormData {
  leaveTypeCode: string
  startDate: string
  startHalf: 'morning' | 'afternoon'
  endDate: string
  endHalf: 'morning' | 'afternoon'
  reason: string
}

const NO_REASON_TYPES = [
  'annual',
  'marriage',
  'bereavement',
  'compensatory',
  'maternity',
  'paternity',
]

const formRef = ref<FormInstance>()
const uploadRef = ref()
const formResetKey = ref(0)
const requestMode = ref<RequestMode>('single')
const leaveTypes = ref<LeaveTypeConfig[]>([])
const balances = ref<LeaveBalance[]>([])
const submitting = ref(false)
const fillingFullLeave = ref(false)
const calculatedDays = ref<number | null>(null)
const calculating = ref(false)
const fileList = ref<UploadUserFile[]>([])
const segmentSequence = ref(2)
const segments = ref<CombinationSegment[]>([
  createSegment(1),
  createSegment(2),
])

let calcTimer: ReturnType<typeof setTimeout> | null = null
let combinedPeriodSequence = 0

function createInitialForm(): LeaveRequestFormData {
  return {
    leaveTypeCode: '',
    startDate: '',
    startHalf: 'morning',
    endDate: '',
    endHalf: 'afternoon',
    reason: '',
  }
}

function createSegment(key: number): CombinationSegment {
  return {
    key,
    leaveTypeCode: '',
    days: null,
    reason: '',
  }
}

const form = ref(createInitialForm())
const endTimeManuallySelected = ref(false)

const isCombinedPeriodFixed = computed(() => (
  requestMode.value === 'combined' &&
  endTimeManuallySelected.value &&
  Boolean(form.value.startDate && form.value.endDate)
))

const selectedType = computed(() => {
  return leaveTypes.value.find(type => type.code === form.value.leaveTypeCode) || null
})

const selectedFileCards = computed(() => fileList.value.map((file, index) => ({
  key: getUploadFileKey(file, index),
  name: file.name,
  size: file.size ?? file.raw?.size ?? null,
  previewFile: file.raw,
  previewUrl: file.raw ? undefined : file.url,
  removable: true,
})))

const attachmentRequiredTypes = computed(() => {
  const selectedTypeCodes = requestMode.value === 'single'
    ? [form.value.leaveTypeCode]
    : segments.value.map(segment => segment.leaveTypeCode)
  return getAttachmentRequiredLeaveTypes(selectedTypeCodes, leaveTypes.value)
})

const requiresAttachments = computed(() => attachmentRequiredTypes.value.length > 0)

const attachmentRequirementText = computed(() => {
  return formatAttachmentRequirementMessage(attachmentRequiredTypes.value)
})

const allocatedDays = computed(() => {
  return Number(
    segments.value
      .reduce(
        (sum, segment) => sum + (segment.leaveTypeCode ? Number(segment.days || 0) : 0),
        0
      )
      .toFixed(1)
  )
})

const allocationDifference = computed(() => {
  if (calculatedDays.value === null) return 0
  return Number((calculatedDays.value - allocatedDays.value).toFixed(1))
})

const allocationNeedsAdjustment = computed(() => {
  return calculatedDays.value !== null && Math.abs(allocationDifference.value) > 0.001
})

const allocationStatusText = computed(() => {
  if (allocatedDays.value <= 0 || calculatedDays.value === null || calculatedDays.value <= 0) {
    return '等待分配'
  }
  if (!allocationNeedsAdjustment.value) {
    return isCombinedPeriodFixed.value ? '分配已完成' : '结束时间已更新'
  }
  if (allocationDifference.value > 0) {
    return `还需分配 ${allocationDifference.value} 天`
  }
  return `已超出 ${Math.abs(allocationDifference.value)} 天`
})

const canFillFullLeave = computed(() => {
  return Boolean(
    selectedType.value?.requires_balance_check &&
    selectedType.value.is_available !== false &&
    form.value.startDate &&
    !fillingFullLeave.value
  )
})

const canFillCombinedLeave = computed(() => {
  return Boolean(
    form.value.startDate &&
    segments.value.some(segment => segment.leaveTypeCode) &&
    !calculating.value
  )
})

function reasonRequired(typeCode: string): boolean {
  return Boolean(typeCode) && !NO_REASON_TYPES.includes(typeCode)
}

const rules = computed<FormRules>(() => ({
  leaveTypeCode: requestMode.value === 'single'
    ? [{ required: true, message: '请选择假期类型', trigger: 'change' }]
    : [],
  startDate: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
  endDate: [{ required: true, message: '请选择结束日期', trigger: 'change' }],
  reason: requestMode.value === 'single' && reasonRequired(form.value.leaveTypeCode)
    ? [{ required: true, message: '请填写请假事由', trigger: 'blur' }]
    : [],
}))

function getType(code: string): LeaveTypeConfig | null {
  return leaveTypes.value.find(type => type.code === code) || null
}

function getTypeName(code: string): string {
  return getType(code)?.name || '请假'
}

function getBalance(code: string): LeaveBalance | null {
  return balances.value.find(balance => balance.leave_type_code === code) || null
}

function disableEndDate(time: Date): boolean {
  return isLeaveEndDateDisabled(time, form.value.startDate)
}

function handleModeChange() {
  fileList.value = []
  uploadRef.value?.clearFiles()
  formRef.value?.clearValidate()
  if (requestMode.value === 'combined') {
    if (endTimeManuallySelected.value && form.value.startDate && form.value.endDate) {
      onEndDateChange()
      return
    }
    form.value.endDate = ''
    form.value.endHalf = 'afternoon'
    calculatedDays.value = null
    scheduleCombinedPeriodCalculation()
  } else {
    onDateChange()
  }
}

function handleTypeChange() {
  if (selectedType.value?.is_available === false) {
    const message = selectedType.value.unavailable_reason || '该假期类型当前不可申请'
    form.value.leaveTypeCode = ''
    ElMessage.warning(message)
  }
  fileList.value = []
  uploadRef.value?.clearFiles()
  formRef.value?.clearValidate('reason')
}

function handleSegmentTypeChange(segment: CombinationSegment) {
  segment.reason = ''
  fileList.value = []
  uploadRef.value?.clearFiles()
  const type = getType(segment.leaveTypeCode)
  if (type?.is_available === false) {
    segment.leaveTypeCode = ''
    segment.days = null
    ElMessage.warning(type.unavailable_reason || '该假期类型当前不可申请')
    return
  }
  const days = getAutomaticCombinedLeaveDays({
    requiresBalanceCheck: Boolean(type?.requires_balance_check),
    availableDays: getBalance(segment.leaveTypeCode)?.available_days ?? 0,
  })
  if (type?.requires_balance_check && days <= 0) {
    segment.leaveTypeCode = ''
    ElMessage.warning(`${type.name}已无可用余额`)
    return
  }
  segment.days = days > 0 ? days : null
  scheduleCombinedPeriodCalculation()
}

function onDateChange() {
  if (requestMode.value === 'combined') {
    if (isCombinedPeriodFixed.value) {
      onEndDateChange()
      return
    }
    scheduleCombinedPeriodCalculation()
    return
  }
  if (!form.value.startDate || !form.value.endDate) {
    calculatedDays.value = null
    return
  }
  if (calcTimer) clearTimeout(calcTimer)
  calcTimer = setTimeout(async () => {
    calculating.value = true
    try {
      const result = await calculateDays({
        startDate: form.value.startDate,
        startHalf: form.value.startHalf,
        endDate: form.value.endDate,
        endHalf: form.value.endHalf,
      })
      calculatedDays.value = result.days
    } catch {
      calculatedDays.value = null
    } finally {
      calculating.value = false
    }
  }, 400)
}

function onEndDateChange() {
  endTimeManuallySelected.value = Boolean(form.value.endDate)
  if (requestMode.value !== 'combined') {
    onDateChange()
    return
  }

  if (!form.value.endDate) {
    scheduleCombinedPeriodCalculation()
    return
  }

  combinedPeriodSequence += 1
  const sequence = combinedPeriodSequence
  if (calcTimer) clearTimeout(calcTimer)

  if (!form.value.startDate || !form.value.endDate) {
    calculatedDays.value = null
    calculating.value = false
    return
  }

  calculating.value = true
  calcTimer = setTimeout(async () => {
    try {
      const result = await calculateDays({
        startDate: form.value.startDate,
        startHalf: form.value.startHalf,
        endDate: form.value.endDate,
        endHalf: form.value.endHalf,
      })
      if (sequence !== combinedPeriodSequence || requestMode.value !== 'combined') return
      calculatedDays.value = result.days
    } catch {
      if (sequence !== combinedPeriodSequence || requestMode.value !== 'combined') return
      calculatedDays.value = null
    } finally {
      if (sequence === combinedPeriodSequence) calculating.value = false
    }
  }, 250)
}

function scheduleCombinedPeriodCalculation() {
  if (isCombinedPeriodFixed.value) {
    return
  }

  combinedPeriodSequence += 1
  if (calcTimer) clearTimeout(calcTimer)

  const sequence = combinedPeriodSequence
  if (
    requestMode.value !== 'combined' ||
    !form.value.startDate ||
    allocatedDays.value <= 0
  ) {
    form.value.endDate = ''
    calculatedDays.value = null
    calculating.value = false
    return
  }

  calculating.value = true
  calcTimer = setTimeout(() => {
    void updateCombinedPeriod(sequence)
  }, 250)
}

async function updateCombinedPeriod(sequence: number) {
  try {
    const period = await calculatePeriodByDays({
      startDate: form.value.startDate,
      startHalf: form.value.startHalf,
      days: allocatedDays.value,
    })
    if (
      sequence !== combinedPeriodSequence ||
      requestMode.value !== 'combined' ||
      isCombinedPeriodFixed.value
    ) return

    endTimeManuallySelected.value = false
    form.value.startDate = period.startDate
    form.value.startHalf = period.startHalf
    form.value.endDate = period.endDate
    form.value.endHalf = period.endHalf
    calculatedDays.value = period.days
  } catch (error: any) {
    if (sequence !== combinedPeriodSequence || requestMode.value !== 'combined') return
    form.value.endDate = ''
    calculatedDays.value = null
    ElMessage.error(error?.response?.data?.message || '自动计算结束时间失败')
  } finally {
    if (sequence === combinedPeriodSequence) calculating.value = false
  }
}

async function handleFillFullLeave() {
  if (!form.value.leaveTypeCode || !form.value.startDate) {
    ElMessage.warning('请先选择假期类型和开始时间')
    return
  }

  fillingFullLeave.value = true
  try {
    const period = await calculateFullLeavePeriod({
      leaveTypeCode: form.value.leaveTypeCode,
      startDate: form.value.startDate,
      startHalf: form.value.startHalf,
    })
    endTimeManuallySelected.value = false
    form.value.startDate = period.startDate
    form.value.startHalf = period.startHalf
    form.value.endDate = period.endDate
    form.value.endHalf = period.endHalf
    calculatedDays.value = period.days
    ElMessage.success(`已按剩余 ${period.availableDays} 天填满请假时间`)
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '一键请满失败')
  } finally {
    fillingFullLeave.value = false
  }
}

function isTypeUsedByOtherSegment(typeCode: string, segmentKey: number): boolean {
  return segments.value.some(
    segment => segment.key !== segmentKey && segment.leaveTypeCode === typeCode
  )
}

function isTypeOptionDisabled(type: LeaveTypeConfig, segmentKey: number): boolean {
  if (type.is_available === false) return true
  if (isTypeUsedByOtherSegment(type.code, segmentKey)) return true
  if (!type.requires_balance_check) return false
  return (getBalance(type.code)?.available_days ?? 0) <= 0
}

function getSegmentMaxDays(segment: CombinationSegment): number {
  const type = getType(segment.leaveTypeCode)
  if (!type?.requires_balance_check) return 999.5
  return Math.max(0.5, getBalance(segment.leaveTypeCode)?.available_days ?? 0.5)
}

function fillSegment(segment: CombinationSegment) {
  if (!segment.leaveTypeCode) return
  const type = getType(segment.leaveTypeCode)
  const available = getBalance(segment.leaveTypeCode)?.available_days ?? 0
  if (!type?.requires_balance_check || available <= 0) {
    ElMessage.warning('该假期已无可用余额')
    return
  }
  segment.days = Number(available.toFixed(1))
  scheduleCombinedPeriodCalculation()
}

function fillCombinedLeave() {
  if (!form.value.startDate) {
    ElMessage.warning('请先选择开始时间')
    return
  }
  if (segments.value.some(segment => !segment.leaveTypeCode)) {
    ElMessage.warning('请先为每一段选择假期类型')
    return
  }
  if (new Set(segments.value.map(segment => segment.leaveTypeCode)).size !== segments.value.length) {
    ElMessage.warning('组合请假中的假期类型不能重复')
    return
  }

  for (const segment of segments.value) {
    const type = getType(segment.leaveTypeCode)
    const days = getAutomaticCombinedLeaveDays({
      requiresBalanceCheck: Boolean(type?.requires_balance_check),
      availableDays: getBalance(segment.leaveTypeCode)?.available_days ?? 0,
      currentDays: segment.days ?? undefined,
    })
    if (type?.requires_balance_check && days <= 0) {
      ElMessage.warning(`${type.name}已无可用余额`)
      return
    }
    segment.days = days > 0 ? days : null
  }

  scheduleCombinedPeriodCalculation()
  ElMessage.success('已按当前余额填入组合天数')
}

function handleSegmentDaysChange() {
  scheduleCombinedPeriodCalculation()
}

function addSegment() {
  if (segments.value.length >= 8) return
  segmentSequence.value += 1
  segments.value.push(createSegment(segmentSequence.value))
}

function removeSegment(key: number) {
  if (segments.value.length <= 2) return
  segments.value = segments.value.filter(segment => segment.key !== key)
  scheduleCombinedPeriodCalculation()
}

function handleExceed() {
  ElMessage.warning('最多上传5个文件')
}

function getUploadFileKey(file: UploadUserFile, index: number): string {
  return String(file.uid ?? `${file.name}-${file.size ?? 0}-${index}`)
}

function removeSelectedFile(key: string | number) {
  fileList.value = fileList.value.filter(
    (file, index) => getUploadFileKey(file, index) !== String(key)
  )
}

function appendFiles(formData: FormData) {
  for (const file of fileList.value) {
    if (file.raw) formData.append('attachments', file.raw)
  }
}

function validateCombination(): boolean {
  if (segments.value.length < 2) {
    ElMessage.warning('组合请假至少需要两种假期')
    return false
  }
  if (segments.value.some(segment => !segment.leaveTypeCode)) {
    ElMessage.warning('请为每一段选择假期类型')
    return false
  }
  if (new Set(segments.value.map(segment => segment.leaveTypeCode)).size !== segments.value.length) {
    ElMessage.warning('组合请假中的假期类型不能重复')
    return false
  }
  if (segments.value.some(segment => !segment.days || segment.days <= 0)) {
    ElMessage.warning('请填写每一段的请假天数')
    return false
  }
  if (Math.abs(allocatedDays.value - Number(calculatedDays.value || 0)) > 0.001) {
    ElMessage.warning(`已分配 ${allocatedDays.value} 天，应与请假时长 ${calculatedDays.value} 天一致`)
    return false
  }
  const missingReason = segments.value.find(
    segment => reasonRequired(segment.leaveTypeCode) && !segment.reason.trim()
  )
  if (missingReason) {
    ElMessage.warning(`请填写${getTypeName(missingReason.leaveTypeCode)}的请假事由`)
    return false
  }
  return true
}

async function handleSubmit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  if (!calculatedDays.value || calculatedDays.value <= 0) {
    ElMessage.warning('请假时长不能为0，所选时间段全为休息日')
    return
  }
  if (requestMode.value === 'combined' && !validateCombination()) return
  if (requiresAttachments.value && fileList.value.length === 0) {
    ElMessage.warning(attachmentRequirementText.value)
    return
  }

  submitting.value = true
  try {
    const formData = new FormData()
    formData.append('startDate', form.value.startDate)
    formData.append('startHalf', form.value.startHalf)
    formData.append('endDate', form.value.endDate)
    formData.append('endHalf', form.value.endHalf)

    if (requestMode.value === 'single') {
      formData.append('leaveTypeCode', form.value.leaveTypeCode)
      formData.append('reason', form.value.reason)
      appendFiles(formData)
      await submitLeaveRequest(formData)
      ElMessage.success('请假申请已提交，等待审批')
    } else {
      formData.append('segments', JSON.stringify(segments.value.map(segment => ({
        leaveTypeCode: segment.leaveTypeCode,
        days: segment.days,
        reason: segment.reason,
      }))))
      appendFiles(formData)
      const result = await submitCombinedLeaveRequests(formData)
      ElMessage.success(`组合请假已拆分为 ${result.requests.length} 条申请`)
    }

    await handleReset()
    emit('submitted')
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '提交失败，请重试')
  } finally {
    submitting.value = false
  }
}

async function handleReset() {
  if (calcTimer) {
    clearTimeout(calcTimer)
    calcTimer = null
  }
  combinedPeriodSequence += 1
  Object.assign(form.value, createInitialForm())
  endTimeManuallySelected.value = false
  requestMode.value = 'single'
  segmentSequence.value = 2
  segments.value = [createSegment(1), createSegment(2)]
  fileList.value = []
  uploadRef.value?.clearFiles()
  calculatedDays.value = null
  calculating.value = false
  formResetKey.value += 1
  await nextTick()
  formRef.value?.clearValidate()
  balances.value = await getMyBalances().catch(() => balances.value)
}

async function loadData() {
  try {
    const [typeList, balanceList] = await Promise.all([
      getLeaveTypes(),
      getMyBalances(),
    ])
    leaveTypes.value = typeList
    balances.value = balanceList
  } catch {
    ElMessage.error('加载假期信息失败')
  }
}

void loadData()
</script>

<style scoped>
.leave-request-form {
  max-width: 720px;
}
.type-action-row,
.date-half-row,
.segment-main-row,
.allocation-summary {
  display: flex;
  align-items: center;
}
.type-action-row {
  width: 100%;
  gap: 10px;
}
.type-action-row .el-select {
  flex: 1;
  min-width: 0;
}
.date-half-row {
  gap: 12px;
}
.half-radio :deep(.el-radio-button__inner) {
  padding: 6px 12px;
}
.option-balance {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
.option-unavailable {
  margin-left: 8px;
  color: #f56c6c;
  font-size: 12px;
}
.option-info {
  margin-left: 6px;
  color: #909399;
}
.duration-display {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  font-size: 16px;
}
.duration-value {
  color: #409eff;
  font-size: 22px;
  font-weight: 700;
}
.duration-unit {
  color: #606266;
  font-size: 14px;
}
.duration-placeholder {
  color: #c0c4cc;
  font-size: 14px;
}
.field-tip {
  margin-top: 4px;
  color: #909399;
  font-size: 12px;
}
.combination-editor {
  width: 100%;
}
.allocation-summary {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: #606266;
  font-size: 13px;
}
.allocation-status {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}
.allocation-total strong {
  color: #409eff;
  font-size: 17px;
}
.allocation-auto-status {
  color: #67c23a;
  font-weight: 600;
}
.allocation-auto-status.is-warning {
  color: #e6a23c;
}
.segment-row {
  padding: 10px 0;
  border-top: 1px solid #ebeef5;
}
.segment-main-row {
  gap: 8px;
  min-width: 0;
}
.segment-index {
  width: 22px;
  color: #909399;
  text-align: center;
}
.segment-type {
  flex: 1;
  min-width: 150px;
}
.segment-proof-tag {
  flex: none;
}
.segment-days {
  width: 112px;
}
.days-label {
  color: #606266;
  font-size: 13px;
}
.segment-reason {
  margin-top: 8px;
  padding-left: 30px;
}
.upload-area {
  width: 100%;
}
.upload-required-types {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  color: #606266;
  font-size: 12px;
  font-weight: 600;
}
.upload-warn {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding: 5px 10px;
  border-radius: 4px;
  background: #fff7e6;
  color: #b45309;
  font-size: 12px;
}
.upload-warn .el-icon {
  flex-shrink: 0;
  color: #e6a23c;
}
.upload-tip {
  margin-top: 4px;
  color: #909399;
  font-size: 11px;
}
@media (max-width: 720px) {
  .type-action-row,
  .date-half-row,
  .allocation-summary {
    align-items: stretch;
    flex-direction: column;
  }
  .date-half-row :deep(.el-date-editor),
  .date-half-row .el-radio-group {
    width: 100%;
    min-width: 0;
  }
  .segment-main-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .segment-type {
    flex-basis: calc(100% - 30px);
  }
  .segment-reason {
    padding-left: 0;
  }
}
</style>
