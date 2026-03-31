<template>
  <div class="archive-container">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">项目封存</h1>
        <p class="page-subtitle">管理已完成项目的封存与归档</p>
      </div>
    </div>

    <el-card class="filter-card" shadow="never">
      <el-form :inline="true">
        <el-form-item label="搜索">
          <el-input
            v-model="searchText"
            placeholder="项目名称"
            clearable
            style="width: 240px"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item label="封存状态">
          <el-select
            v-model="filterStatus"
            placeholder="全部状态"
            clearable
            style="width: 150px"
          >
            <el-option label="未封存" value="active" />
            <el-option label="已封存" value="archived" />
          </el-select>
        </el-form-item>

        <el-form-item label="区域">
          <el-select
            v-model="filterDistrict"
            placeholder="全部区域"
            clearable
            style="width: 150px"
          >
            <el-option
              v-for="district in districts"
              :key="district"
              :label="district"
              :value="district"
            />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card" shadow="never">
      <el-table
        v-loading="loading"
        :data="filteredProjects"
        stripe
      >
        <el-table-column prop="name" label="项目名称" min-width="200" />
        <el-table-column prop="district" label="区域" width="100" />
        <el-table-column prop="projectType" label="项目类型" width="120" />
        <el-table-column label="项目状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getProjectStatusType(row.status)" size="small">
              {{ getProjectStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="封存状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.isArchived ? 'info' : 'success'" size="small">
              {{ row.isArchived ? '已封存' : '未封存' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="封存时间" width="180">
          <template #default="{ row }">
            <span v-if="row.archivedAt">{{ formatDate(row.archivedAt) }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="180">
          <template #default="{ row }">
            <template v-if="!row.isArchived">
              <el-button type="warning" size="small" link @click="handleArchive(row)">
                <el-icon><Box /></el-icon>
                封存
              </el-button>
            </template>
            <template v-else>
              <el-button type="primary" size="small" link @click="handleRestore(row)">
                <el-icon><RefreshRight /></el-icon>
                恢复
              </el-button>
            </template>
            <el-button type="info" size="small" link @click="handleViewDetail(row)">
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 封存确认对话框 -->
    <el-dialog
      v-model="archiveDialogVisible"
      title="确认封存项目"
      width="500px"
      @close="handleDialogClose"
    >
      <div class="archive-info" v-if="currentProject">
        <el-alert
          title="封存后项目将被归档，不再显示在常规项目列表中"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 16px"
        />
        <p><strong>项目名称：</strong>{{ currentProject.name }}</p>
        <p><strong>区域：</strong>{{ currentProject.district }}</p>
        <p><strong>项目类型：</strong>{{ currentProject.projectType }}</p>
      </div>
      <el-form ref="formRef" :model="formData" label-width="100px">
        <el-form-item label="封存原因">
          <el-input
            v-model="formData.reason"
            type="textarea"
            :rows="3"
            placeholder="请输入封存原因（选填）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="archiveDialogVisible = false">取消</el-button>
        <el-button type="warning" :loading="saving" @click="confirmArchive">
          确认封存
        </el-button>
      </template>
    </el-dialog>

    <!-- 恢复确认对话框 -->
    <el-dialog
      v-model="restoreDialogVisible"
      title="确认恢复项目"
      width="500px"
    >
      <div class="archive-info" v-if="currentProject">
        <el-alert
          title="恢复后项目将重新显示在常规项目列表中"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 16px"
        />
        <p><strong>项目名称：</strong>{{ currentProject.name }}</p>
        <p><strong>区域：</strong>{{ currentProject.district }}</p>
        <p><strong>封存时间：</strong>{{ formatDate(currentProject.archivedAt) }}</p>
      </div>
      <template #footer>
        <el-button @click="restoreDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmRestore">
          确认恢复
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Box, RefreshRight } from '@element-plus/icons-vue'
import { ElMessage, FormInstance } from 'element-plus'
import { api } from '@/utils/api'

interface Project {
  id: string
  name: string
  district: string
  projectType: string
  status: string
  isArchived: boolean
  archivedAt?: string
  archiveReason?: string
}

// 数据
const router = useRouter()
const projects = ref<Project[]>([])
const loading = ref(false)
const searchText = ref('')
const filterStatus = ref('')
const filterDistrict = ref('')
const districts = ref<string[]>([])

// 封存对话框
const archiveDialogVisible = ref(false)
const restoreDialogVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const currentProject = ref<Project | null>(null)
const formData = ref({
  reason: '',
})

// 过滤后的项目列表
const filteredProjects = computed(() => {
  return projects.value.filter((project) => {
    const matchSearch = !searchText.value || project.name.includes(searchText.value)
    const matchDistrict = !filterDistrict.value || project.district === filterDistrict.value

    if (!filterStatus.value) return matchSearch && matchDistrict

    if (filterStatus.value === 'active') {
      return matchSearch && matchDistrict && !project.isArchived
    } else if (filterStatus.value === 'archived') {
      return matchSearch && matchDistrict && project.isArchived
    }

    return matchSearch && matchDistrict
  })
})

// 加载项目列表
async function loadProjects() {
  try {
    loading.value = true
    const response = await api.get('/api/projects')
    if (response.data.success) {
      // 添加封存状态字段
      projects.value = (response.data.data || []).map((p: Project) => ({
        ...p,
        isArchived: p.isArchived || false,
        archivedAt: p.archivedAt || null,
      }))

      // 提取区域列表
      const districtSet = new Set<string>()
      projects.value.forEach((p) => {
        if (p.district) districtSet.add(p.district)
      })
      districts.value = Array.from(districtSet)
    }
  } catch (error) {
    console.error('加载项目列表失败:', error)
    ElMessage.error('加载项目列表失败')
  } finally {
    loading.value = false
  }
}

// 格式化日期
function formatDate(dateStr?: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 获取项目状态类型
function getProjectStatusType(status: string): 'info' | 'warning' | 'success' | 'danger' {
  const statusMap: Record<string, 'info' | 'warning' | 'success' | 'danger'> = {
    planning: 'info',
    in_progress: 'warning',
    completed: 'success',
    suspended: 'danger',
  }
  return statusMap[status] || 'info'
}

// 获取项目状态文本
function getProjectStatusText(status: string): string {
  const statusMap: Record<string, string> = {
    planning: '规划中',
    in_progress: '进行中',
    completed: '已完成',
    suspended: '已暂停',
  }
  return statusMap[status] || status
}

// 打开封存对话框
function handleArchive(project: Project) {
  currentProject.value = project
  formData.value = { reason: '' }
  archiveDialogVisible.value = true
}

// 确认封存
async function confirmArchive() {
  if (!currentProject.value) return

  try {
    saving.value = true
    // TODO: 调用后端API
    // await api.post(`/api/projects/${currentProject.value.id}/archive`, formData.value)

    // 临时本地更新
    const project = projects.value.find((p) => p.id === currentProject.value?.id)
    if (project) {
      project.isArchived = true
      project.archivedAt = new Date().toISOString()
      project.archiveReason = formData.value.reason
    }

    ElMessage.success('项目已封存')
    archiveDialogVisible.value = false
  } catch (error) {
    console.error('封存失败:', error)
    ElMessage.error('封存失败')
  } finally {
    saving.value = false
  }
}

// 打开恢复对话框
function handleRestore(project: Project) {
  currentProject.value = project
  restoreDialogVisible.value = true
}

// 确认恢复
async function confirmRestore() {
  if (!currentProject.value) return

  try {
    saving.value = true
    // TODO: 调用后端API
    // await api.post(`/api/projects/${currentProject.value.id}/restore`)

    // 临时本地更新
    const project = projects.value.find((p) => p.id === currentProject.value?.id)
    if (project) {
      project.isArchived = false
      project.archivedAt = undefined
      project.archiveReason = undefined
    }

    ElMessage.success('项目已恢复')
    restoreDialogVisible.value = false
  } catch (error) {
    console.error('恢复失败:', error)
    ElMessage.error('恢复失败')
  } finally {
    saving.value = false
  }
}

// 查看详情
function handleViewDetail(project: Project) {
  router.push(`/projects/${project.id}`)
}

// 对话框关闭
function handleDialogClose() {
  formRef.value?.resetFields()
  currentProject.value = null
}

// 初始化
onMounted(() => {
  loadProjects()
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.archive-container {
  height: calc(100vh - 60px);
  margin: calc(-1 * var(--yl-main-padding-y, 24px)) calc(-1 * var(--yl-main-padding-x, 45px));
  padding: 0;
  display: flex;
  flex-direction: column;
}

.page-header {
  padding: 16px 24px;
  background: #fff;
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

.filter-card {
  background: #fff;
  border-radius: 0;
  border-left: none;
  border-right: none;
}

.filter-card :deep(.el-card__body) {
  padding: 16px 24px;
}

.table-card {
  flex: 1;
  background: #fff;
  overflow: hidden;
  border-radius: 0;
  border: none;
}

.table-card :deep(.el-card__body) {
  height: 100%;
  padding: 0 24px 24px;
}

.table-card :deep(.el-card__body) {
  height: 100%;
  padding: 0;
}

.table-card :deep(.el-table) {
  height: 100%;
}

.text-muted {
  color: #999;
}

.archive-info {
  margin-bottom: 20px;
}

.archive-info p {
  margin: 8px 0;
  color: #606266;
}

.archive-info p:last-child {
  margin-bottom: 0;
}
</style>
