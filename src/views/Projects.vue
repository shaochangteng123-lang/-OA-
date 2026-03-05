<template>
  <div class="projects-container">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">我的项目</h1>
        <p class="page-subtitle">管理您的所有项目</p>
      </div>
      <div class="header-right">
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>
          新建项目
        </el-button>
      </div>
    </div>

    <el-card class="filter-card" shadow="never">
      <el-form :inline="true">
        <el-form-item label="搜索">
          <el-input
            v-model="searchText"
            placeholder="项目名称、负责人"
            clearable
            style="width: 240px"
            @input="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item label="区域">
          <el-select
            v-model="filterDistrict"
            placeholder="全部区域"
            clearable
            style="width: 150px"
            @change="handleFilter"
          >
            <el-option label="龙岗区" value="龙岗区" />
            <el-option label="坪山区" value="坪山区" />
            <el-option label="盐田区" value="盐田区" />
            <el-option label="其他" value="其他" />
          </el-select>
        </el-form-item>

        <el-form-item label="状态">
          <el-select
            v-model="filterStatus"
            placeholder="全部状态"
            clearable
            style="width: 150px"
            @change="handleFilter"
          >
            <el-option label="进行中" value="active" />
            <el-option label="已完成" value="completed" />
            <el-option label="已暂停" value="paused" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card" shadow="never">
      <el-table
        v-loading="loading"
        :data="filteredProjects"
        stripe
        style="cursor: pointer"
        @row-click="handleRowClick"
      >
        <el-table-column prop="name" label="项目名称" min-width="200" />
        <el-table-column prop="district" label="区域" width="100" />
        <el-table-column prop="projectType" label="项目类型" width="150" />
        <el-table-column prop="reportSpecialist" label="报批专员" width="120" />
        <el-table-column prop="projectManager" label="项目经理" width="120" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag
              :type="row.status === 'active' ? 'success' : row.status === 'completed' ? 'info' : 'info'"
              size="small"
            >
              {{
                row.status === 'active'
                  ? '进行中'
                  : row.status === 'completed'
                    ? '已完成'
                    : '已暂停'
              }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click.stop="handleEdit(row)">
              编辑
            </el-button>
            <el-button type="danger" size="small" link @click.stop="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? '编辑项目' : '新建项目'"
      width="600px"
      @close="handleDialogClose"
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="120px">
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入项目名称" />
        </el-form-item>

        <el-form-item label="区域" prop="district">
          <el-select v-model="formData.district" placeholder="请选择区域" style="width: 100%">
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
          <el-input v-model="formData.reportSpecialist" placeholder="请输入报批专员姓名" />
        </el-form-item>

        <el-form-item label="报批专员电话" prop="reportSpecialistPhone">
          <el-input v-model="formData.reportSpecialistPhone" placeholder="请输入联系电话" />
        </el-form-item>

        <el-form-item label="项目经理" prop="projectManager">
          <el-input v-model="formData.projectManager" placeholder="请输入项目经理姓名" />
        </el-form-item>

        <el-form-item label="项目经理电话" prop="projectManagerPhone">
          <el-input v-model="formData.projectManagerPhone" placeholder="请输入联系电话" />
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
          <el-select v-model="formData.status" placeholder="请选择状态" style="width: 100%">
            <el-option label="进行中" value="active" />
            <el-option label="已完成" value="completed" />
            <el-option label="已暂停" value="paused" />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave"> 确定 </el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Search } from '@element-plus/icons-vue'
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
  createdAt: string
  updatedAt: string
}

const router = useRouter()

// 数据
const projects = ref<Project[]>([])
const loading = ref(false)
const searchText = ref('')
const filterDistrict = ref('')
const filterStatus = ref('')

// 对话框
const dialogVisible = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()

// 表单数据
const formData = ref({
  id: '',
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
  status: [{ required: true, message: '请选择状态', trigger: 'change' }],
}

// 过滤后的项目列表
const filteredProjects = computed(() => {
  return projects.value.filter((project) => {
    const matchSearch =
      !searchText.value ||
      project.name.includes(searchText.value) ||
      project.reportSpecialist.includes(searchText.value) ||
      project.projectManager.includes(searchText.value)

    const matchDistrict = !filterDistrict.value || project.district === filterDistrict.value

    const matchStatus = !filterStatus.value || project.status === filterStatus.value

    return matchSearch && matchDistrict && matchStatus
  })
})

// 加载项目列表
async function loadProjects() {
  try {
    loading.value = true
    const response = await api.get('/api/projects')
    if (response.data.success) {
      projects.value = response.data.data || []
    }
  } catch (error) {
    console.error('加载项目列表失败:', error)
    ElMessage.error('加载项目列表失败')
  } finally {
    loading.value = false
  }
}

// 搜索
function handleSearch() {
  // 自动过滤
}

// 筛选
function handleFilter() {
  // 自动过滤
}

// 新建项目
function handleCreate() {
  isEditing.value = false
  formData.value = {
    id: '',
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
  }
  dialogVisible.value = true
}

// 编辑项目
function handleEdit(project: Project) {
  isEditing.value = true
  formData.value = {
    id: project.id,
    name: project.name,
    district: project.district,
    projectType: project.projectType,
    implementationType: project.implementationType,
    status: project.status,
    startDate: project.startDate || '',
    reportSpecialist: project.reportSpecialist,
    reportSpecialistPhone: project.reportSpecialistPhone,
    projectManager: project.projectManager,
    projectManagerPhone: project.projectManagerPhone,
    description: project.description || '',
  }
  dialogVisible.value = true
}

// 保存项目
async function handleSave() {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) return

    try {
      saving.value = true
      if (isEditing.value) {
        // 更新
        await api.put(`/api/projects/${formData.value.id}`, formData.value)
        ElMessage.success('更新成功')
      } else {
        // 创建
        await api.post('/api/projects', formData.value)
        ElMessage.success('创建成功')
      }
      dialogVisible.value = false
      await loadProjects()
    } catch (error) {
      console.error('保存失败:', error)
      ElMessage.error(isEditing.value ? '更新失败' : '创建失败')
    } finally {
      saving.value = false
    }
  })
}

// 删除项目
async function handleDelete(project: Project) {
  try {
    await ElMessageBox.confirm(`确定要删除项目"${project.name}"吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await api.delete(`/api/projects/${project.id}`)
    ElMessage.success('删除成功')
    await loadProjects()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除失败:', error)
      ElMessage.error('删除失败')
    }
  }
}

// 行点击 - 跳转到详情页
function handleRowClick(row: Project) {
  router.push(`/projects/${row.id}`)
}

// 对话框关闭
function handleDialogClose() {
  formRef.value?.resetFields()
}

// 初始化
onMounted(() => {
  loadProjects()
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.projects-container {
  height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: -24px;
  padding: 24px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  flex: 1;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: #333;
}

.page-subtitle {
  margin: 4px 0 0;
  font-size: 14px;
  color: #666;
}

.filter-card {
  background: #fff;
}

.table-card {
  flex: 1;
  background: #fff;
  overflow: hidden;
}

.table-card :deep(.el-card__body) {
  height: 100%;
  padding: 0;
}

.table-card :deep(.el-table) {
  height: 100%;
}
</style>
