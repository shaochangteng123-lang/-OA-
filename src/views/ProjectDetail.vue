<template>
  <div v-loading="loading" class="project-detail-container">
    <div v-if="project" class="detail-content">
      <!-- 页面头部 -->
      <div class="page-header">
        <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
        <div class="header-actions">
          <el-button type="primary" :icon="Edit" @click="handleEdit">
            编辑项目
          </el-button>
          <el-button type="danger" :icon="Delete" @click="handleDelete">
            删除项目
          </el-button>
        </div>
      </div>

      <!-- 项目基本信息 -->
      <el-card class="info-card" shadow="never">
        <template #header>
          <div class="card-header">
            <h2>{{ project.name }}</h2>
            <el-tag
              :type="
                project.status === 'active'
                  ? 'success'
                  : project.status === 'completed'
                    ? 'info'
                    : 'info'
              "
            >
              {{
                project.status === 'active'
                  ? '进行中'
                  : project.status === 'completed'
                    ? '已完成'
                    : '已暂停'
              }}
            </el-tag>
          </div>
        </template>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="区域">
            {{ project.district }}
          </el-descriptions-item>
          <el-descriptions-item label="项目类型">
            {{ project.projectType }}
          </el-descriptions-item>
          <el-descriptions-item label="实施类型">
            {{ project.implementationType }}
          </el-descriptions-item>
          <el-descriptions-item label="开始日期">
            {{ project.startDate || '未设置' }}
          </el-descriptions-item>
          <el-descriptions-item label="报批专员">
            {{ project.reportSpecialist }}
          </el-descriptions-item>
          <el-descriptions-item label="报批专员电话">
            {{ project.reportSpecialistPhone }}
          </el-descriptions-item>
          <el-descriptions-item label="项目经理">
            {{ project.projectManager }}
          </el-descriptions-item>
          <el-descriptions-item label="项目经理电话">
            {{ project.projectManagerPhone }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">
            {{ formatDate(project.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="project.description"
            label="项目描述"
            :span="2"
          >
            {{ project.description }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <!-- 当前任务 -->
      <el-card class="task-card" shadow="never">
        <template #header>
          <div class="card-header">
            <h3>当前任务</h3>
            <el-button size="small" @click="showTaskDialog = true">
              更新任务
            </el-button>
          </div>
        </template>
        <div v-if="project.currentTask" class="current-task">
          {{ project.currentTask }}
        </div>
        <el-empty v-else description="暂无当前任务" :image-size="80" />
      </el-card>

      <!-- 任务历史 -->
      <el-card class="history-card" shadow="never">
        <template #header>
          <h3>任务历史</h3>
        </template>
        <el-timeline v-if="taskHistory.length > 0">
          <el-timeline-item
            v-for="(task, index) in taskHistory"
            :key="index"
            :timestamp="task.date"
            placement="top"
          >
            {{ task.content }}
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无任务历史" :image-size="80" />
      </el-card>
    </div>

    <!-- 编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      title="编辑项目"
      width="600px"
      @close="handleDialogClose"
    >
      <el-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        label-width="120px"
      >
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入项目名称" />
        </el-form-item>

        <el-form-item label="区域" prop="district">
          <el-select
            v-model="formData.district"
            placeholder="请选择区域"
            style="width: 100%"
          >
            <el-option label="龙岗区" value="龙岗区" />
            <el-option label="坪山区" value="坪山区" />
            <el-option label="盐田区" value="盐田区" />
            <el-option label="其他" value="其他" />
          </el-select>
        </el-form-item>

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

        <el-form-item label="报批专员" prop="reportSpecialist">
          <el-input
            v-model="formData.reportSpecialist"
            placeholder="请输入报批专员姓名"
          />
        </el-form-item>

        <el-form-item label="报批专员电话" prop="reportSpecialistPhone">
          <el-input
            v-model="formData.reportSpecialistPhone"
            placeholder="请输入联系电话"
          />
        </el-form-item>

        <el-form-item label="项目经理" prop="projectManager">
          <el-input
            v-model="formData.projectManager"
            placeholder="请输入项目经理姓名"
          />
        </el-form-item>

        <el-form-item label="项目经理电话" prop="projectManagerPhone">
          <el-input
            v-model="formData.projectManagerPhone"
            placeholder="请输入联系电话"
          />
        </el-form-item>

        <el-form-item label="开始日期" prop="startDate">
          <el-date-picker
            v-model="formData.startDate"
            type="date"
            placeholder="选择日期"
            style="width: 100%"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>

        <el-form-item label="项目描述">
          <el-input
            v-model="formData.description"
            type="textarea"
            :rows="3"
            placeholder="请输入项目描述（选填）"
          />
        </el-form-item>

        <el-form-item label="状态" prop="status">
          <el-select
            v-model="formData.status"
            placeholder="请选择状态"
            style="width: 100%"
          >
            <el-option label="进行中" value="active" />
            <el-option label="已完成" value="completed" />
            <el-option label="已暂停" value="paused" />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">
          保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 更新任务对话框 -->
    <el-dialog v-model="showTaskDialog" title="更新当前任务" width="500px">
      <el-input
        v-model="newTask"
        type="textarea"
        :rows="4"
        placeholder="请输入当前任务内容"
      />
      <template #footer>
        <el-button @click="showTaskDialog = false">取消</el-button>
        <el-button type="primary" @click="handleUpdateTask">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ArrowLeft, Edit, Delete } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, FormInstance, FormRules } from 'element-plus'
import { api } from '@/utils/api'

interface Project {
  id: string
  name: string
  district: string
  projectType: string
  implementationType: string
  status: string
  startDate?: string
  reportSpecialist: string
  reportSpecialistPhone: string
  projectManager: string
  projectManagerPhone: string
  description?: string
  currentTask?: string
  taskHistory?: Array<{ date: string; content: string }>
  createdAt: string
  updatedAt: string
}

const router = useRouter()
const route = useRoute()

// 数据
const project = ref<Project | null>(null)
const loading = ref(false)
const dialogVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const showTaskDialog = ref(false)
const newTask = ref('')

// 表单数据
const formData = ref({
  name: '',
  district: '',
  projectType: '',
  implementationType: '',
  status: 'active',
  startDate: '',
  reportSpecialist: '',
  reportSpecialistPhone: '',
  projectManager: '',
  projectManagerPhone: '',
  description: '',
})

// 表单验证规则
const formRules: FormRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  district: [{ required: true, message: '请选择区域', trigger: 'change' }],
  projectType: [
    { required: true, message: '请选择项目类型', trigger: 'change' },
  ],
  implementationType: [
    { required: true, message: '请选择实施类型', trigger: 'change' },
  ],
  reportSpecialist: [
    { required: true, message: '请输入报批专员', trigger: 'blur' },
  ],
  reportSpecialistPhone: [
    { required: true, message: '请输入报批专员电话', trigger: 'blur' },
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '请输入正确的手机号码',
      trigger: 'blur',
    },
  ],
  projectManager: [
    { required: true, message: '请输入项目经理', trigger: 'blur' },
  ],
  projectManagerPhone: [
    { required: true, message: '请输入项目经理电话', trigger: 'blur' },
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '请输入正确的手机号码',
      trigger: 'blur',
    },
  ],
  status: [{ required: true, message: '请选择状态', trigger: 'change' }],
}

// 任务历史
const taskHistory = computed(() => {
  return project.value?.taskHistory || []
})

// 格式化日期
function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 加载项目详情
async function loadProject() {
  const projectId = route.params.id as string
  if (!projectId) {
    ElMessage.error('项目ID不存在')
    router.push('/projects')
    return
  }

  try {
    loading.value = true
    const response = await api.get(`/api/projects/${projectId}`)
    if (response.data.success) {
      project.value = response.data.data
    } else {
      ElMessage.error('加载项目失败')
      router.push('/projects')
    }
  } catch (error) {
    console.error('加载项目详情失败:', error)
    ElMessage.error('加载项目详情失败')
    router.push('/projects')
  } finally {
    loading.value = false
  }
}

// 返回
function handleBack() {
  router.push('/projects')
}

// 编辑
function handleEdit() {
  if (!project.value) return

  formData.value = {
    name: project.value.name,
    district: project.value.district,
    projectType: project.value.projectType,
    implementationType: project.value.implementationType,
    status: project.value.status,
    startDate: project.value.startDate || '',
    reportSpecialist: project.value.reportSpecialist,
    reportSpecialistPhone: project.value.reportSpecialistPhone,
    projectManager: project.value.projectManager,
    projectManagerPhone: project.value.projectManagerPhone,
    description: project.value.description || '',
  }
  dialogVisible.value = true
}

// 保存
async function handleSave() {
  if (!formRef.value || !project.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) return

    try {
      saving.value = true
      await api.put(`/api/projects/${project.value!.id}`, formData.value)
      ElMessage.success('更新成功')
      dialogVisible.value = false
      await loadProject()
    } catch (error) {
      console.error('更新失败:', error)
      ElMessage.error('更新失败')
    } finally {
      saving.value = false
    }
  })
}

// 删除
async function handleDelete() {
  if (!project.value) return

  try {
    await ElMessageBox.confirm(
      `确定要删除项目"${project.value.name}"吗？`,
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    await api.delete(`/api/projects/${project.value.id}`)
    ElMessage.success('删除成功')
    router.push('/projects')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除失败:', error)
      ElMessage.error('删除失败')
    }
  }
}

// 更新任务
async function handleUpdateTask() {
  if (!project.value || !newTask.value.trim()) {
    ElMessage.warning('请输入任务内容')
    return
  }

  try {
    await api.put(`/api/projects/${project.value.id}`, {
      currentTask: newTask.value,
    })
    ElMessage.success('任务更新成功')
    showTaskDialog.value = false
    newTask.value = ''
    await loadProject()
  } catch (error) {
    console.error('更新任务失败:', error)
    ElMessage.error('更新任务失败')
  }
}

// 对话框关闭
function handleDialogClose() {
  formRef.value?.resetFields()
}

// 初始化
onMounted(() => {
  loadProject()
})
</script>

<style scoped>
.project-detail-container {
  min-height: 100%;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.info-card,
.task-card,
.history-card {
  background: #fff;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #333;
}

.card-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.current-task {
  padding: 16px;
  background: #f5f7fa;
  border-radius: 4px;
  line-height: 1.6;
  color: #333;
}
</style>
