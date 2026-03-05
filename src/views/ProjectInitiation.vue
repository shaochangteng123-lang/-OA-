<template>
  <div class="project-initiation-container">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">项目立项</h1>
        <p class="page-subtitle">创建新项目并完成立项流程</p>
      </div>
    </div>

    <el-card class="form-card" shadow="never">
      <el-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        label-width="140px"
        label-position="right"
      >
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="项目名称" prop="name">
              <el-input v-model="formData.name" placeholder="请输入项目名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="区域" prop="district">
              <el-select v-model="formData.district" placeholder="请选择区域" style="width: 100%">
                <el-option label="龙岗区" value="龙岗区" />
                <el-option label="坪山区" value="坪山区" />
                <el-option label="盐田区" value="盐田区" />
                <el-option label="其他" value="其他" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="项目类型" prop="projectType">
              <el-select
                v-model="formData.projectType"
                placeholder="请选择项目类型"
                style="width: 100%"
              >
                <el-option label="工业" value="工业" />
                <el-option label="商业" value="商业" />
                <el-option label="住宅" value="住宅" />
                <el-option label="综合" value="综合" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="实施类型" prop="implementationType">
              <el-select
                v-model="formData.implementationType"
                placeholder="请选择实施类型"
                style="width: 100%"
              >
                <el-option label="新建" value="新建" />
                <el-option label="改扩建" value="改扩建" />
                <el-option label="技改" value="技改" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider />

        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="报批专员" prop="reportSpecialist">
              <el-input v-model="formData.reportSpecialist" placeholder="请输入报批专员姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="报批专员电话" prop="reportSpecialistPhone">
              <el-input
                v-model="formData.reportSpecialistPhone"
                placeholder="请输入联系电话"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="项目经理" prop="projectManager">
              <el-input v-model="formData.projectManager" placeholder="请输入项目经理姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="项目经理电话" prop="projectManagerPhone">
              <el-input
                v-model="formData.projectManagerPhone"
                placeholder="请输入联系电话"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider />

        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="开始日期" prop="startDate">
              <el-date-picker
                v-model="formData.startDate"
                type="date"
                placeholder="选择日期"
                style="width: 100%"
                value-format="YYYY-MM-DD"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="预计完成日期">
              <el-date-picker
                v-model="formData.expectedEndDate"
                type="date"
                placeholder="选择日期（选填）"
                style="width: 100%"
                value-format="YYYY-MM-DD"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="项目描述">
          <el-input
            v-model="formData.description"
            type="textarea"
            :rows="4"
            placeholder="请输入项目描述（选填）"
          />
        </el-form-item>

        <el-form-item label="立项说明">
          <el-input
            v-model="formData.initiationNote"
            type="textarea"
            :rows="3"
            placeholder="请输入立项说明（选填）"
          />
        </el-form-item>
      </el-form>

      <div class="form-actions">
        <el-button @click="handleReset">重置</el-button>
        <el-button type="primary" :loading="saving" @click="handleSubmit">
          提交立项
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, FormInstance, FormRules } from 'element-plus'
import { api } from '@/utils/api'

const router = useRouter()

// 表单引用
const formRef = ref<FormInstance>()
const saving = ref(false)

// 表单数据
const formData = ref({
  name: '',
  district: '',
  projectType: '',
  implementationType: '',
  status: 'active',
  startDate: '',
  expectedEndDate: '',
  reportSpecialist: '',
  reportSpecialistPhone: '',
  projectManager: '',
  projectManagerPhone: '',
  description: '',
  initiationNote: '',
})

// 表单验证规则
const formRules: FormRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  district: [{ required: true, message: '请选择区域', trigger: 'change' }],
  projectType: [{ required: true, message: '请选择项目类型', trigger: 'change' }],
  implementationType: [{ required: true, message: '请选择实施类型', trigger: 'change' }],
  reportSpecialist: [{ required: true, message: '请输入报批专员', trigger: 'blur' }],
  reportSpecialistPhone: [
    { required: true, message: '请输入报批专员电话', trigger: 'blur' },
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '请输入正确的手机号码',
      trigger: 'blur',
    },
  ],
  projectManager: [{ required: true, message: '请输入项目经理', trigger: 'blur' }],
  projectManagerPhone: [
    { required: true, message: '请输入项目经理电话', trigger: 'blur' },
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '请输入正确的手机号码',
      trigger: 'blur',
    },
  ],
}

// 重置表单
function handleReset() {
  formRef.value?.resetFields()
  formData.value = {
    name: '',
    district: '',
    projectType: '',
    implementationType: '',
    status: 'active',
    startDate: '',
    expectedEndDate: '',
    reportSpecialist: '',
    reportSpecialistPhone: '',
    projectManager: '',
    projectManagerPhone: '',
    description: '',
    initiationNote: '',
  }
}

// 提交立项
async function handleSubmit() {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) return

    try {
      saving.value = true
      const submitData = {
        name: formData.value.name,
        district: formData.value.district,
        projectType: formData.value.projectType,
        implementationType: formData.value.implementationType,
        status: formData.value.status,
        startDate: formData.value.startDate,
        reportSpecialist: formData.value.reportSpecialist,
        reportSpecialistPhone: formData.value.reportSpecialistPhone,
        projectManager: formData.value.projectManager,
        projectManagerPhone: formData.value.projectManagerPhone,
        description: formData.value.description || '',
      }

      const response = await api.post('/api/projects', submitData)
      if (response.data.success) {
        ElMessage.success('项目立项成功！')
        // 可以选择跳转到项目详情页或项目列表页
        if (response.data.data?.id) {
          router.push(`/projects/${response.data.data.id}`)
        } else {
          router.push('/projects')
        }
      }
    } catch (error) {
      console.error('项目立项失败:', error)
      ElMessage.error('项目立项失败，请检查输入信息')
    } finally {
      saving.value = false
    }
  })
}

// 初始化
onMounted(() => {
  // 可以在这里加载一些默认数据或配置
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.project-initiation-container {
  height: calc(100vh - 60px);
  margin: -24px;
  padding: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid #e4e7ed;
}

.header-left {
  flex: 1;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.page-subtitle {
  margin: 4px 0 0;
  font-size: 14px;
  color: #909399;
}

.form-card {
  background: #fff;
  flex: 1;
  border-radius: 0;
  border: none;
  overflow: auto;
}

.form-card :deep(.el-card__body) {
  padding: 24px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
}

:deep(.el-divider) {
  margin: 20px 0;
}
</style>
