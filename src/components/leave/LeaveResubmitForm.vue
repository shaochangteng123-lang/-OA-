<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
    <el-alert type="info" :closable="false" style="margin-bottom:16px">
      原申请已被驳回，请修改后重新提交。原申请编号：{{ originalRequest.request_no }}
    </el-alert>

    <!-- 假期类型（只读） -->
    <el-form-item label="假期类型">
      <span>{{ originalRequest.leave_type_name }}</span>
    </el-form-item>

    <!-- 开始时间 -->
    <el-form-item label="开始时间" prop="startDate">
      <div class="date-half-row">
        <el-date-picker
          v-model="form.startDate"
          type="date"
          placeholder="选择开始日期"
          value-format="YYYY-MM-DD"
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
          style="width: 160px"
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
      <el-upload
        v-model:file-list="fileList"
        :auto-upload="false"
        :limit="5"
        multiple
        :accept="'.jpg,.jpeg,.png,.pdf'"
      >
        <el-button type="primary" plain size="small">选择文件</el-button>
      </el-upload>
      <div style="font-size:12px;color:#909399;margin-top:4px">
        {{ originalRequest.leave_type_code === 'sick' ? '病假需上传证明文件（必须）' : '可选上传证明材料' }}
      </div>
    </el-form-item>

    <el-form-item>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">重新提交</el-button>
      <el-button @click="emit('cancel')">取消</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import type { FormInstance, FormRules, UploadUserFile } from 'element-plus'
import { calculateDays, resubmitRequest as apiResubmit, type LeaveRequest } from '@/utils/leaveApi'

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
let calcTimer: ReturnType<typeof setTimeout> | null = null

const form = ref({
  startDate: props.originalRequest.start_date,
  startHalf: props.originalRequest.start_half as 'morning' | 'afternoon',
  endDate: props.originalRequest.end_date,
  endHalf: props.originalRequest.end_half as 'morning' | 'afternoon',
  reason: props.originalRequest.reason,
})

const rules: FormRules = {
  startDate: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
  endDate: [{ required: true, message: '请选择结束日期', trigger: 'change' }],
  reason: [{ required: true, min: 5, message: '请假事由至少5个字符', trigger: 'blur' }],
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

async function handleSubmit() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return
    submitting.value = true
    try {
      const formData = new FormData()
      formData.append('startDate', form.value.startDate)
      formData.append('startHalf', form.value.startHalf)
      formData.append('endDate', form.value.endDate)
      formData.append('endHalf', form.value.endHalf)
      formData.append('reason', form.value.reason)
      for (const file of fileList.value) {
        if (file.raw) formData.append('attachments', file.raw)
      }
      await apiResubmit(props.originalRequest.id, formData)
      ElMessage.success('已重新提交，等待审批')
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
</style>
