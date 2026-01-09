<template>
  <div class="history-container">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">历史日志</h1>
        <p class="page-subtitle">查看和管理历史工作日志</p>
      </div>
    </div>

    <el-card class="filter-card" shadow="never">
      <el-form :inline="true">
        <el-form-item label="日期范围">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 360px"
            @change="handleDateRangeChange"
          />
        </el-form-item>

        <el-form-item label="搜索">
          <el-input
            v-model="searchText"
            placeholder="日志标题、内容"
            clearable
            style="width: 240px"
            @input="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :icon="Refresh" @click="loadWorklogs">
            刷新
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="list-card" shadow="never">
      <div v-loading="loading" class="worklog-list">
        <div v-if="filteredWorklogs.length === 0" class="empty-state">
          <el-empty description="暂无历史日志" />
        </div>

        <div
          v-for="worklog in filteredWorklogs"
          :key="worklog.id"
          class="worklog-item"
          @click="handleViewDetail(worklog)"
        >
          <div class="item-header">
            <div class="item-date">
              <el-icon class="calendar-icon"><Calendar /></el-icon>
              <span class="date-text">{{ formatDate(worklog.date) }}</span>
              <span class="weekday">{{ getWeekday(worklog.date) }}</span>
            </div>
            <div class="item-actions">
              <el-button
                type="primary"
                size="small"
                link
                @click.stop="handleEdit(worklog)"
              >
                编辑
              </el-button>
              <el-button
                type="danger"
                size="small"
                link
                @click.stop="handleDelete(worklog)"
              >
                删除
              </el-button>
            </div>
          </div>

          <div class="item-content">
            <h3 class="item-title">{{ worklog.title || '无标题' }}</h3>
            <div class="item-summary">
              {{ truncateText(worklog.overallContent, 200) }}
            </div>
            <div v-if="worklog.projects && worklog.projects.length > 0" class="item-projects">
              <el-tag
                v-for="project in worklog.projects.slice(0, 3)"
                :key="project.id"
                size="small"
                class="project-tag"
              >
                {{ project.name }}
              </el-tag>
              <span v-if="worklog.projects.length > 3" class="more-projects">
                +{{ worklog.projects.length - 3 }}
              </span>
            </div>
          </div>

          <div class="item-footer">
            <span class="create-time">
              创建于 {{ formatDateTime(worklog.createdAt) }}
            </span>
            <span v-if="worklog.updatedAt !== worklog.createdAt" class="update-time">
              更新于 {{ formatDateTime(worklog.updatedAt) }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="filteredWorklogs.length > 0" class="pagination">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="filteredWorklogs.length"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="detailVisible"
      :title="selectedWorklog?.title || '工作日志详情'"
      width="800px"
    >
      <div v-if="selectedWorklog" class="detail-content">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="日期">
            {{ formatDate(selectedWorklog.date) }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatDateTime(selectedWorklog.createdAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-divider>日志内容</el-divider>

        <div class="content-section">
          <h4>总体内容</h4>
          <div class="content-text">{{ selectedWorklog.overallContent }}</div>
        </div>

        <div
          v-if="selectedWorklog.projects && selectedWorklog.projects.length > 0"
          class="projects-section"
        >
          <h4>关联项目</h4>
          <el-tag
            v-for="project in selectedWorklog.projects"
            :key="project.id"
            class="project-tag"
          >
            {{ project.name }}
          </el-tag>
        </div>
      </div>

      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" @click="handleEditFromDetail">
          编辑
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Calendar, Search, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/utils/api'

interface Project {
  id: string
  name: string
}

interface Worklog {
  id: string
  date: string
  title: string
  overallContent: string
  projects?: Project[]
  createdAt: string
  updatedAt: string
}

const router = useRouter()

// 数据
const worklogs = ref<Worklog[]>([])
const loading = ref(false)
const searchText = ref('')
const dateRange = ref<[string, string] | null>(null)
const currentPage = ref(1)
const pageSize = ref(20)

// 详情对话框
const detailVisible = ref(false)
const selectedWorklog = ref<Worklog | null>(null)

// 过滤后的日志列表
const filteredWorklogs = computed(() => {
  let result = worklogs.value

  // 日期范围过滤
  if (dateRange.value && dateRange.value.length === 2) {
    const [start, end] = dateRange.value
    result = result.filter((log) => log.date >= start && log.date <= end)
  }

  // 搜索过滤
  if (searchText.value) {
    const search = searchText.value.toLowerCase()
    result = result.filter(
      (log) =>
        log.title.toLowerCase().includes(search) ||
        log.overallContent.toLowerCase().includes(search)
    )
  }

  // 按日期降序排序
  return result.sort((a, b) => b.date.localeCompare(a.date))
})

// 加载工作日志列表
async function loadWorklogs() {
  try {
    loading.value = true
    const response = await api.get('/api/worklogs')
    if (response.data.success) {
      worklogs.value = response.data.data || []
    }
  } catch (error) {
    console.error('加载历史日志失败:', error)
    ElMessage.error('加载历史日志失败')
  } finally {
    loading.value = false
  }
}

// 格式化日期
function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

// 格式化日期时间
function formatDateTime(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 获取星期
function getWeekday(dateString: string) {
  const date = new Date(dateString)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdays[date.getDay()]
}

// 截断文本
function truncateText(text: string, maxLength: number) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

// 搜索
function handleSearch() {
  currentPage.value = 1
}

// 日期范围变化
function handleDateRangeChange() {
  currentPage.value = 1
}

// 查看详情
function handleViewDetail(worklog: Worklog) {
  selectedWorklog.value = worklog
  detailVisible.value = true
}

// 编辑
function handleEdit(worklog: Worklog) {
  router.push(`/?date=${worklog.date}`)
}

// 从详情编辑
function handleEditFromDetail() {
  if (selectedWorklog.value) {
    router.push(`/?date=${selectedWorklog.value.date}`)
  }
}

// 删除
async function handleDelete(worklog: Worklog) {
  try {
    await ElMessageBox.confirm(
      `确定要删除 ${formatDate(worklog.date)} 的日志吗？`,
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    await api.delete(`/api/worklogs/${worklog.date}`)
    ElMessage.success('删除成功')
    await loadWorklogs()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除失败:', error)
      ElMessage.error('删除失败')
    }
  }
}

// 分页变化
function handlePageChange() {
  // 自动更新
}

function handleSizeChange() {
  currentPage.value = 1
}

// 初始化
onMounted(() => {
  loadWorklogs()
})
</script>

<style scoped>
.history-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.filter-card,
.list-card {
  background: #fff;
}

.list-card {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.list-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.worklog-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
}

.worklog-item {
  padding: 20px;
  margin-bottom: 12px;
  background: #fafafa;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.worklog-item:hover {
  border-color: #409eff;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
}

.item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.item-date {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #666;
}

.calendar-icon {
  color: #409eff;
}

.date-text {
  font-weight: 500;
  color: #333;
}

.weekday {
  color: #999;
}

.item-actions {
  display: flex;
  gap: 8px;
}

.item-content {
  margin-bottom: 12px;
}

.item-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.item-summary {
  margin-bottom: 12px;
  line-height: 1.6;
  color: #666;
}

.item-projects {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.project-tag {
  margin: 0;
}

.more-projects {
  font-size: 12px;
  color: #999;
}

.item-footer {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #999;
}

.pagination {
  padding: 16px;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid #e8e8e8;
}

.detail-content {
  padding: 8px 0;
}

.content-section,
.projects-section {
  margin-top: 20px;
}

.content-section h4,
.projects-section h4 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #666;
}

.content-text {
  padding: 12px;
  background: #f5f7fa;
  border-radius: 4px;
  line-height: 1.6;
  color: #333;
  white-space: pre-wrap;
}

.projects-section .project-tag {
  margin-right: 8px;
  margin-bottom: 8px;
}
</style>
