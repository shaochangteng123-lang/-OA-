<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="90px" class="leave-request-form">
    <!-- 假期类型 -->
    <el-form-item label="假期类型" prop="leaveTypeCode">
      <el-select
        v-model="form.leaveTypeCode"
        placeholder="请选择假期类型"
        style="width: 100%"
        @change="handleTypeChange"
      >
        <el-option
          v-for="t in leaveTypes"
          :key="t.code"
          :label="t.name"
          :value="t.code"
        >
          <span>{{ t.name }}</span>
          <span v-if="t.description" style="color:#909399;font-size:12px;margin-left:8px">
            <el-tooltip :content="t.description" placement="right">
              <el-icon><InfoFilled /></el-icon>
            </el-tooltip>
          </span>
        </el-option>
      </el-select>
    </el-form-item>

    <!-- 开始时间 -->
    <el-form-item label="开始时间" prop="startDate">
      <div class="date-half-row">
        <el-date-picker
          v-model="form.startDate"
          type="date"
          placeholder="选择开始日期"
          value-format="YYYY-MM-DD"
          :disabled-date="disableStartDate"
          style="width: 160px"
          @change="onDateChange"
        />
        <el-radio-group v-model="form.startHalf" class="half-radio" @change="onDateChange">
          <el-radio-button value="morning">上午</el-radio-button>
          <el-radio-button value="afternoon">下午</el-radio-button>
        </el-radio-group>
      </div>
    </el-form-item>

    <!-- 结束时间 -->
    <el-form-item label="结束时间" prop="endDate">
      <div class="date-half-row">
        <el-date-picker
          v-model="form.endDate"
          type="date"
          placeholder="选择结束日期"
          value-format="YYYY-MM-DD"
          :disabled-date="disableEndDate"
          style="width: 160px"
          @change="onDateChange"
        />
        <el-radio-group v-model="form.endHalf" class="half-radio" @change="onDateChange">
          <el-radio-button value="morning">上午</el-radio-button>
          <el-radio-button value="afternoon">下午</el-radio-button>
        </el-radio-group>
      </div>
    </el-form-item>

    <!-- 请假时长（自动计算） -->
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

    <!-- 请假事由（年假/婚假/丧假/产假不需要填写） -->
    <el-form-item label="请假事由" prop="reason">
      <el-input
        v-model="form.reason"
        type="textarea"
        :rows="3"
        :placeholder="reasonRequired ? '请填写请假事由...' : '选填'"
        maxlength="500"
        show-word-limit
      />
      <div v-if="!reasonRequired && form.leaveTypeCode" style="font-size:12px;color:#909399;margin-top:4px">
        该假期类型无需填写事由
      </div>
    </el-form-item>

    <!-- 附件上传（仅病假显示） -->
    <el-form-item v-if="selectedType?.requires_attachment" label="证明文件" prop="attachments">
      <div class="upload-area">
        <el-upload
          ref="uploadRef"
          v-model:file-list="fileList"
          :auto-upload="false"
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
        <div class="upload-warn">
          <el-icon><WarningFilled /></el-icon>
          需上传三甲医院病历或假条，否则无法提交
        </div>
        <div class="upload-tip">支持 JPG / PNG / PDF，每个不超过 5MB</div>
      </div>
    </el-form-item>

    <!-- 提交按钮 -->
    <el-form-item>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="calculatedDays === null || calculatedDays <= 0"
        @click="handleSubmit"
      >
        提交申请
      </el-button>
      <el-button @click="handleReset">重置</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { InfoFilled, Loading, Upload, WarningFilled } from '@element-plus/icons-vue'
import type { FormInstance, FormRules, UploadUserFile } from 'element-plus'
import { getLeaveTypes, calculateDays, submitLeaveRequest, type LeaveTypeConfig } from '@/utils/leaveApi'

const emit = defineEmits<{
  (e: 'submitted'): void
}>()

const formRef = ref<FormInstance>()
const uploadRef = ref()
const leaveTypes = ref<LeaveTypeConfig[]>([])
const submitting = ref(false)
const calculatedDays = ref<number | null>(null)
const calculating = ref(false)
const fileList = ref<UploadUserFile[]>([])

let calcTimer: ReturnType<typeof setTimeout> | null = null

const form = ref({
  leaveTypeCode: '',
  startDate: '',
  startHalf: 'morning' as 'morning' | 'afternoon',
  endDate: '',
  endHalf: 'afternoon' as 'morning' | 'afternoon',
  reason: '',
})

const selectedType = computed(() => {
  return leaveTypes.value.find(t => t.code === form.value.leaveTypeCode) || null
})

// 不需要填写事由的假期类型
const NO_REASON_TYPES = ['annual', 'marriage', 'bereavement', 'maternity', 'paternity']

const reasonRequired = computed(() => {
  if (!form.value.leaveTypeCode) return true
  return !NO_REASON_TYPES.includes(form.value.leaveTypeCode)
})

const rules = computed<FormRules>(() => ({
  leaveTypeCode: [{ required: true, message: '请选择假期类型', trigger: 'change' }],
  startDate: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
  endDate: [{ required: true, message: '请选择结束日期', trigger: 'change' }],
  reason: reasonRequired.value
    ? [
        { required: true, message: '请填写请假事由', trigger: 'blur' },
        { min: 5, message: '请假事由至少5个字符', trigger: 'blur' },
      ]
    : [],
}))

function disableStartDate(time: Date): boolean {
  return time.getTime() < Date.now() - 90 * 24 * 3600 * 1000
}

function disableEndDate(time: Date): boolean {
  if (form.value.startDate) {
    return time.getTime() < new Date(form.value.startDate).getTime() - 86400000
  }
  return time.getTime() < Date.now() - 90 * 24 * 3600 * 1000
}

function handleTypeChange() {
  fileList.value = []
  // 切换类型时清除事由字段的校验状态
  formRef.value?.clearValidate('reason')
}

function onDateChange() {
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

function handleExceed() {
  ElMessage.warning('最多上传5个文件')
}

async function handleSubmit() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return

    if (selectedType.value?.requires_attachment && fileList.value.length === 0) {
      ElMessage.warning(`${selectedType.value.name}需要上传证明文件`)
      return
    }

    if (!calculatedDays.value || calculatedDays.value <= 0) {
      ElMessage.warning('请假时长不能为0，所选时间段全为休息日')
      return
    }

    submitting.value = true
    try {
      const formData = new FormData()
      formData.append('leaveTypeCode', form.value.leaveTypeCode)
      formData.append('startDate', form.value.startDate)
      formData.append('startHalf', form.value.startHalf)
      formData.append('endDate', form.value.endDate)
      formData.append('endHalf', form.value.endHalf)
      formData.append('reason', form.value.reason)

      for (const file of fileList.value) {
        if (file.raw) formData.append('attachments', file.raw)
      }

      await submitLeaveRequest(formData)
      ElMessage.success('请假申请已提交，等待审批')
      handleReset()
      emit('submitted')
    } catch (err: any) {
      ElMessage.error(err?.response?.data?.message || '提交失败，请重试')
    } finally {
      submitting.value = false
    }
  })
}

function handleReset() {
  formRef.value?.resetFields()
  form.value = { leaveTypeCode: '', startDate: '', startHalf: 'morning', endDate: '', endHalf: 'afternoon', reason: '' }
  fileList.value = []
  calculatedDays.value = null
}

// 初始化加载假期类型
async function loadTypes() {
  try {
    leaveTypes.value = await getLeaveTypes()
  } catch {
    ElMessage.error('加载假期类型失败')
  }
}

loadTypes()
</script>

<style scoped>
.leave-request-form {
  max-width: 520px;
}
.date-half-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.half-radio :deep(.el-radio-button__inner) {
  padding: 6px 12px;
}
.duration-display {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  min-height: 32px;
}
.duration-value {
  font-size: 22px;
  font-weight: 700;
  color: #409eff;
}
.duration-unit {
  font-size: 14px;
  color: #606266;
}
.duration-placeholder {
  color: #c0c4cc;
  font-size: 14px;
}
.upload-area {
  width: 100%;
}
.upload-warn {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding: 5px 10px;
  background: #fff7e6;
  border-radius: 4px;
  font-size: 12px;
  color: #b45309;
}
.upload-warn .el-icon {
  color: #e6a23c;
  flex-shrink: 0;
}
.upload-tip {
  font-size: 11px;
  color: #909399;
  margin-top: 4px;
}
</style>
