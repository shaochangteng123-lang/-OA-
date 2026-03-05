<template>
  <div class="project-progress-container">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">项目进度</h1>
        <p class="page-subtitle">查看所有项目的进度情况</p>
      </div>
      <div class="header-right">
        <el-button :icon="Refresh" @click="handleRefresh" :loading="loading">
          刷新
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
            <el-option label="已归档" value="archived" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card" shadow="never">
      <el-table
        v-loading="loading"
        :data="filteredProjects"
        stripe
        style="width: 100%"
      >
        <el-table-column prop="name" label="项目名称" min-width="200" />
        <el-table-column prop="district" label="区域" width="100" />
        <el-table-column prop="projectType" label="项目类型" width="120" />
        <el-table-column prop="projectManager" label="项目经理" width="120" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag
              :type="getStatusType(row.status)"
              size="small"
            >
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="200">
          <template #default="{ row }">
            <div class="progress-cell">
              <el-progress
                :percentage="calculateProgress(row)"
                :color="getProgressColor(row)"
                :stroke-width="12"
              />
              <span class="progress-text">{{ calculateProgress(row) }}%</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="startDate" label="开始日期" width="120">
          <template #default="{ row }">
            {{ row.startDate ? formatDate(row.startDate) : '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="currentTask" label="当前任务" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.currentTask || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              type="primary"
              size="small"
              link
              @click="handleViewDetail(row)"
            >
              查看详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { api } from '@/utils/api'
import type { Project } from '@/types'

const router = useRouter()

// 数据
const projects = ref<Project[]>([])
const loading = ref(false)
const searchText = ref('')
const filterDistrict = ref('')
const filterStatus = ref('')

// 过滤后的项目列表
const filteredProjects = computed(() => {
  let result = projects.value

  // 搜索过滤
  if (searchText.value) {
    const keyword = searchText.value.toLowerCase()
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(keyword) ||
        p.projectManager.toLowerCase().includes(keyword) ||
        p.reportSpecialist.toLowerCase().includes(keyword)
    )
  }

  // 区域过滤
  if (filterDistrict.value) {
    result = result.filter((p) => p.district === filterDistrict.value)
  }

  // 状态过滤
  if (filterStatus.value) {
    result = result.filter((p) => p.status === filterStatus.value)
  }

  return result
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

// 刷新
function handleRefresh() {
  loadProjects()
}

// 搜索
function handleSearch() {
  // 搜索逻辑已在 computed 中实现
}

// 过滤
function handleFilter() {
  // 过滤逻辑已在 computed 中实现
}

// 计算项目进度
function calculateProgress(project: Project): number {
  // 如果已完成，返回100%
  if (project.status === 'completed') {
    return 100
  }

  // 如果已归档，返回0%
  if (project.status === 'archived') {
    return 0
  }

  // 基于开始日期和当前日期计算时间进度
  if (project.startDate) {
    const startDate = new Date(project.startDate)
    const now = new Date()
    const daysSinceStart = Math.max(
      0,
      Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    )

    // 假设项目平均周期为180天（约6个月）
    const estimatedDays = 180
    const progress = Math.min(95, Math.floor((daysSinceStart / estimatedDays) * 100))

    return progress
  }

  // 如果没有开始日期，返回0%
  return 0
}

// 获取进度条颜色
function getProgressColor(project: Project): string {
  const progress = calculateProgress(project)
  if (progress >= 80) return '#67c23a' // 绿色
  if (progress >= 50) return '#e6a23c' // 橙色
  if (progress >= 20) return '#409eff' // 蓝色
  return '#909399' // 灰色
}

// 获取状态类型
function getStatusType(status: string): 'success' | 'info' | 'warning' | 'danger' {
  switch (status) {
    case 'active':
      return 'success'
    case 'completed':
      return 'info'
    case 'archived':
      return 'danger'
    default:
      return 'info'
  }
}

// 获取状态文本
function getStatusText(status: string): string {
  switch (status) {
    case 'active':
      return '进行中'
    case 'completed':
      return '已完成'
    case 'archived':
      return '已归档'
    default:
      return '未知'
  }
}

// 格式化日期
function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), 'yyyy-MM-dd', { locale: zhCN })
  } catch {
    return dateString
  }
}

// 查看详情
function handleViewDetail(project: Project) {
  router.push(`/projects/${project.id}`)
}

onMounted(() => {
  loadProjects()
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.project-progress-container {
  height: calc(100vh - 60px);
  margin: -24px;
  padding: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid #e4e7ed;
}

.header-left {
  flex: 1;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 4px 0;
}

.page-subtitle {
  font-size: 14px;
  color: #909399;
  margin: 0;
}

.header-right {
  display: flex;
  gap: 12px;
}

.filter-card {
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
  border-radius: 0;
  border: none;
}

.table-card :deep(.el-card__body) {
  padding: 0 24px 24px;
}

.progress-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-text {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
  min-width: 40px;
  text-align: right;
}

:deep(.el-progress-bar__outer) {
  background-color: #f0f2f5;
  border-radius: 4px;
}

:deep(.el-progress-bar__inner) {
  border-radius: 4px;
}
</style>
