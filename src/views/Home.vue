<template>
  <div class="worklog-home">
    <!-- 顶部：日期 + 筛选 + 新建 -->
    <div class="home-header">
      <div class="header-left">
        <el-date-picker
          v-model="selectedDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期（可补录历史）"
          :clearable="false"
          :disabled="hasFilter"
          style="width: 180px"
          @change="loadEntries"
        />
        <el-tag v-if="hasFilter" type="success" effect="plain">按筛选条件查看全部</el-tag>
        <el-tag v-else-if="selectedDate === todayStr" type="primary" effect="plain">今日</el-tag>
        <el-tag v-else type="warning" effect="plain">历史补录</el-tag>
      </div>
      <div class="header-right">
        <el-button :icon="Refresh" @click="loadEntries">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="handleNew">新建日志</el-button>
      </div>
    </div>

    <!-- 筛选栏 -->
    <el-card shadow="never" class="filters">
      <el-form :inline="true" class="filter-form">
        <el-form-item label="项目">
          <el-select
            v-model="filters.projectId"
            placeholder="全部项目"
            filterable
            clearable
            remote
            :remote-method="searchProjects"
            :loading="searchingProjects"
            style="width: 200px"
            @change="loadEntries"
          >
            <el-option
              v-for="p in projectOptions"
              :key="p.id"
              :label="`${p.name}`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="行政区">
          <el-select
            v-model="filters.district"
            placeholder="全部"
            clearable
            style="width: 140px"
            @change="loadEntries"
          >
            <el-option v-for="d in dicts.districts" :key="d.id" :label="d.name" :value="d.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="事项">
          <el-select
            v-model="filters.matter"
            placeholder="全部"
            clearable
            style="width: 180px"
            @change="loadEntries"
          >
            <el-option v-for="m in dicts.matters" :key="m.id" :label="m.name" :value="m.name" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="canFilterByUser" label="负责人">
          <el-select
            v-model="filters.ownerUserId"
            placeholder="全部"
            clearable
            filterable
            style="width: 160px"
            @change="loadEntries"
          >
            <el-option v-for="u in users" :key="u.id" :label="u.name" :value="u.id" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 主区：左侧项目列表（按行政区分组） + 右侧甘特图/预警 -->
    <div class="main-grid">
      <div class="left-col">
        <el-card shadow="never" class="list-card" v-loading="listLoading">
          <template #header>
            <div class="card-title">
              项目列表
              <el-tag size="small" type="info" effect="plain">{{ projectOptions.length }} 个项目</el-tag>
            </div>
          </template>
          <div v-if="projectOptions.length === 0" class="empty-hint">
            暂无项目，点击右上角「新建日志」开始记录
          </div>
          <div v-else class="district-groups">
            <div v-for="group in projectsByDistrict" :key="group.district" class="district-group">
              <div class="district-header">
                <div class="district-label">{{ group.district }}</div>
                <div class="district-stats">
                  <span class="stat-item">{{ group.projects.length }} 个项目</span>
                  <span class="stat-dot"></span>
                  <span class="stat-item stat-active">进行中 {{ group.activeCount }}</span>
                  <span class="stat-dot"></span>
                  <span class="stat-item stat-done">已办结 {{ group.completedCount }}</span>
                </div>
              </div>
              <div class="project-list-items">
                <div
                  v-for="p in group.projects"
                  :key="p.id"
                  class="project-item"
                  :class="{ 'is-active': activeProjectId === p.id, 'is-completed': p.isCompleted }"
                  @click="handleProjectClick(p)"
                >
                  <div class="project-item-left">
                    <span class="project-status-dot" :class="p.isCompleted ? 'done' : 'active'"></span>
                    <span class="project-item-name">{{ p.name }}</span>
                  </div>
                  <div class="project-item-right">
                    <span v-if="p.entryCount" class="project-entry-count">{{ p.entryCount }} 条</span>
                    <el-tag :type="p.isCompleted ? 'success' : 'primary'" size="small" effect="light">
                      {{ p.isCompleted ? '已办结' : '进行中' }}
                    </el-tag>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </el-card>

        <!-- 选中项目后展示该项目的日志 -->
        <el-card v-if="activeProjectId" shadow="never" class="list-card project-detail-card">
          <template #header>
            <div class="card-title">
              {{ activeProjectName }} 日志
              <el-tag size="small" type="info" effect="plain">{{ entries.length }} 条</el-tag>
              <el-button size="small" link style="margin-left: auto" @click="clearActiveProject">返回</el-button>
            </div>
          </template>
          <div v-if="entries.length === 0" class="empty-hint">该项目暂无日志记录</div>
          <div v-else class="entry-list">
            <WorklogEntryCard
              v-for="e in entries"
              :key="`${e.id}-${e.updatedAt}`"
              :entry="e"
              @edit="handleEdit"
              @delete="handleDelete"
              @view-contract="handleViewContract"
            />
          </div>
        </el-card>
      </div>

      <div class="right-col">
        <el-card shadow="never">
          <template #header>
            <div class="card-title">项目甘特图</div>
          </template>
          <el-select
            v-model="ganttProjectId"
            placeholder="选择项目查看进度"
            clearable
            filterable
            style="width: 100%; margin-bottom: 10px"
            remote
            :remote-method="searchProjects"
            :loading="searchingProjects"
          >
            <el-option
              v-for="p in projectOptions"
              :key="p.id"
              :label="`${p.name}`"
              :value="p.id"
            />
          </el-select>
          <WorklogGanttChart :project-id="ganttProjectId" />
        </el-card>

        <el-card shadow="never" class="alert-card" v-if="alerts.length > 0">
          <template #header>
            <div class="card-title">
              <el-icon color="#e6a23c"><Warning /></el-icon>
              进度预警 ({{ alerts.length }})
            </div>
          </template>
          <div class="alert-list">
            <div
              v-for="a in alerts"
              :key="`${a.projectId}-${a.matter}`"
              class="alert-item"
              :class="a.level"
            >
              <div class="alert-head">
                <el-tag :type="a.level === 'high' ? 'danger' : 'warning'" size="small">
                  {{ a.level === 'high' ? '超期' : '临近' }}
                </el-tag>
                <span>{{ a.projectName }}</span>
              </div>
              <div class="alert-msg">{{ a.message }}</div>
            </div>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 表单 Dialog -->
    <WorklogEntryForm
      v-model:visible="formVisible"
      :entry="editingEntry"
      :default-date="selectedDate"
      :dicts="dicts"
      :users="users"
      @saved="handleSaved"
    />

    <!-- 合同进度 -->
    <WorklogContractDialog
      v-model:visible="contractDialogVisible"
      :project-id="contractProjectId"
      :project-name="contractProjectName"
    />

    <!-- AI 助手 -->
    <WorklogAiDrawer />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, Refresh, Warning } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'
import type { WorklogDictItem, WorklogEntry, WorklogProject, WorklogRiskAlert } from '@/types'
import WorklogEntryCard from '@/components/worklog-v2/WorklogEntryCard.vue'
import WorklogEntryForm from '@/components/worklog-v2/WorklogEntryForm.vue'
import WorklogGanttChart from '@/components/worklog-v2/WorklogGanttChart.vue'
import WorklogAiDrawer from '@/components/worklog-v2/WorklogAiDrawer.vue'
import WorklogContractDialog from '@/components/worklog-v2/WorklogContractDialog.vue'

interface UserLite { id: string; name: string; position?: string | null; role?: string }

const authStore = useAuthStore()
const todayStr = new Date().toISOString().slice(0, 10)

const selectedDate = ref(todayStr)
const entries = ref<WorklogEntry[]>([])
const listLoading = ref(false)

const filters = ref({
  projectId: '' as string | '',
  district: '' as string | '',
  matter: '' as string | '',
  ownerUserId: '' as string | '',
})

const hasFilter = computed(() => !!(filters.value.projectId || filters.value.matter || filters.value.ownerUserId))

const ganttProjectId = ref<string | null>(null)
const alerts = ref<WorklogRiskAlert[]>([])

const contractDialogVisible = ref(false)
const contractProjectId = ref('')
const contractProjectName = ref('')
const dicts = ref<{
  districts: WorklogDictItem[]
  projectTypes: WorklogDictItem[]
  matters: WorklogDictItem[]
  contractStatuses: WorklogDictItem[]
}>({ districts: [], projectTypes: [], matters: [], contractStatuses: [] })

const users = ref<UserLite[]>([])
const projectOptions = ref<WorklogProject[]>([])
const searchingProjects = ref(false)

const formVisible = ref(false)
const editingEntry = ref<WorklogEntry | null>(null)

const canFilterByUser = computed(() => ['super_admin', 'admin', 'general_manager'].includes(authStore.user?.role || ''))

// 按行政区分组项目
const projectsByDistrict = computed(() => {
  const groups: Record<string, WorklogProject[]> = {}
  for (const p of projectOptions.value) {
    const district = p.district || '未分区'
    if (!groups[district]) groups[district] = []
    groups[district].push(p)
  }
  return Object.entries(groups).map(([district, projects]) => ({
    district,
    projects,
    totalEntries: projects.reduce((sum, p) => sum + (p.entryCount || 0), 0),
    activeCount: projects.filter(p => !p.isCompleted).length,
    completedCount: projects.filter(p => p.isCompleted).length,
  }))
})

// 选中项目
const activeProjectId = ref<string | null>(null)
const activeProjectName = computed(() => {
  if (!activeProjectId.value) return ''
  const p = projectOptions.value.find(item => item.id === activeProjectId.value)
  return p?.name || ''
})

function handleProjectClick(project: WorklogProject) {
  activeProjectId.value = project.id
  loadProjectEntries(project.id)
}

function clearActiveProject() {
  activeProjectId.value = null
  entries.value = []
}

async function loadProjectEntries(projectId: string) {
  listLoading.value = true
  try {
    const resp = await api.get('/api/worklog-entries', { params: { projectId } })
    if (resp.data.success) entries.value = resp.data.data
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '加载日志失败')
  } finally {
    listLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadDicts(), loadUsers(), loadAlerts(), loadAllProjectsOnce()])
})

async function loadDicts() {
  try {
    const [d, t, m, c] = await Promise.all([
      api.get('/api/worklog-dicts/districts'),
      api.get('/api/worklog-dicts/project-types'),
      api.get('/api/worklog-dicts/matters'),
      api.get('/api/worklog-dicts/contract-statuses'),
    ])
    dicts.value = {
      districts: d.data.data || [],
      projectTypes: t.data.data || [],
      matters: m.data.data || [],
      contractStatuses: c.data.data || [],
    }
  } catch (err) {
    console.error('加载字典失败:', err)
  }
}

async function loadUsers() {
  try {
    const resp = await api.get('/api/users')
    if (resp.data.success) {
      users.value = (resp.data.data || []).map((u: any) => ({
        id: u.id, name: u.name, position: u.position, role: u.role,
      }))
    }
  } catch (err) {
    console.error('加载用户列表失败:', err)
  }
}

async function loadAllProjectsOnce() {
  try {
    const resp = await api.get('/api/worklog-projects')
    if (resp.data.success) projectOptions.value = resp.data.data
  } catch { /* ignore */ }
}

async function searchProjects(keyword: string) {
  searchingProjects.value = true
  try {
    const resp = await api.get('/api/worklog-projects', { params: keyword ? { q: keyword } : {} })
    if (resp.data.success) projectOptions.value = resp.data.data
  } finally {
    searchingProjects.value = false
  }
}

async function loadEntries() {
  if (filters.value.projectId) {
    activeProjectId.value = filters.value.projectId
    await loadProjectEntries(filters.value.projectId)
    return
  }
  if (activeProjectId.value) {
    await loadProjectEntries(activeProjectId.value)
    return
  }
  entries.value = []
}

async function loadAlerts() {
  try {
    const resp = await api.get('/api/worklog-ai/gantt-alerts')
    if (resp.data.success) alerts.value = resp.data.data || []
  } catch { /* 忽略 */ }
}

function handleNew() {
  editingEntry.value = null
  formVisible.value = true
}
function handleEdit(entry: WorklogEntry) {
  editingEntry.value = entry
  formVisible.value = true
}
async function handleDelete(entry: WorklogEntry) {
  try {
    await ElMessageBox.confirm(`确认删除 ${entry.logDate} 的日志「${entry.matter}」?`, '提示', { type: 'warning' })
  } catch { return }
  try {
    const resp = await api.delete(`/api/worklog-entries/${entry.id}`)
    if (resp.data.success) {
      entries.value = entries.value.filter(e => e.id !== entry.id)
      ElMessage.success('已删除')
    } else {
      ElMessage.error(resp.data.message || '删除失败')
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '删除失败')
  }
}

function handleSaved(saved: WorklogEntry) {
  if (activeProjectId.value === saved.projectId) {
    const idx = entries.value.findIndex(e => e.id === saved.id)
    if (idx >= 0) {
      entries.value.splice(idx, 1, saved)
    } else {
      entries.value.unshift(saved)
    }
  }
  if (ganttProjectId.value === saved.projectId) {
    const id = ganttProjectId.value
    ganttProjectId.value = null
    setTimeout(() => { ganttProjectId.value = id }, 50)
  }
  loadAlerts()
  loadAllProjectsOnce()
}

function handleViewContract(projectId: string) {
  const entry = entries.value.find(e => e.projectId === projectId)
  contractProjectId.value = projectId
  contractProjectName.value = entry?.projectName || '项目'
  contractDialogVisible.value = true
}
</script>

<style scoped>
.worklog-home {
  padding: 0 16px;
  margin-left: calc(-1 * var(--yl-main-padding-x, 45px));
  margin-right: calc(-1 * var(--yl-main-padding-x, 45px));
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: calc(100vh - 60px);
}

.home-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.header-left { display: flex; align-items: center; gap: 10px; }
.header-right { display: flex; align-items: center; gap: 8px; }

.filters { padding: 0; }
.filters :deep(.el-card__body) { padding: 12px 16px; }
.filter-form { margin: 0; }
.filter-form :deep(.el-form-item) { margin-bottom: 0; }

.main-grid { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 12px; flex: 1; }
@media (max-width: 1280px) {
  .main-grid { grid-template-columns: 1fr; }
}

.card-title { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.empty-hint { color: #999; text-align: center; padding: 40px 0; font-size: 13px; }
.entry-list { display: flex; flex-direction: column; gap: 10px; }

.district-groups { display: flex; flex-direction: column; gap: 20px; }
.district-group { }
.district-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; margin-bottom: 8px;
  background: linear-gradient(135deg, #f0f5ff 0%, #e8f4f8 100%);
  border-radius: 8px; border-left: 3px solid #409eff;
}
.district-label { font-size: 15px; font-weight: 600; color: #303133; }
.district-stats { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #909399; }
.stat-dot { width: 3px; height: 3px; border-radius: 50%; background: #c0c4cc; }
.stat-active { color: #409eff; }
.stat-done { color: #67c23a; }
.project-list-items { display: flex; flex-direction: column; gap: 4px; padding-left: 4px; }
.project-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-radius: 8px; cursor: pointer;
  transition: all 0.2s ease;
  font-size: 15px; border: 1px solid transparent;
}
.project-item:hover { background: #f5f7fa; border-color: #e4e7ed; }
.project-item.is-active { background: #ecf5ff; border-color: #b3d8ff; }
.project-item.is-completed .project-item-name { color: #909399; }
.project-item-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.project-status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.project-status-dot.active { background: #409eff; box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.15); }
.project-status-dot.done { background: #67c23a; box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.15); }
.project-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-item-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.project-entry-count { font-size: 12px; color: #909399; }
.project-detail-card { margin-top: 12px; }

.alert-card { margin-top: 12px; }
.alert-list { display: flex; flex-direction: column; gap: 8px; }
.alert-item { padding: 8px 10px; border-radius: 6px; border-left: 3px solid; background: #fdf6ec; font-size: 13px; }
.alert-item.high { border-left-color: #f56c6c; background: #fef0f0; }
.alert-item.medium { border-left-color: #e6a23c; background: #fdf6ec; }
.alert-head { display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 4px; }
.alert-msg { color: #606266; line-height: 1.5; }
</style>
