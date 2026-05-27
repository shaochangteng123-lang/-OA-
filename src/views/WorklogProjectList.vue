<template>
  <div class="project-list" v-loading="loading">
    <div class="page-header">
      <h2>项目动态</h2>
      <div class="actions">
        <el-select v-model="filterDistrict" clearable placeholder="全部行政区" style="width: 140px" @change="load">
          <el-option v-for="d in districts" :key="d" :label="d" :value="d" />
        </el-select>
        <el-select v-model="filterMatter" clearable placeholder="全部事项" style="width: 160px" @change="load">
          <el-option v-for="m in matters" :key="m" :label="m" :value="m" />
        </el-select>
        <el-select v-model="filterCompleted" clearable placeholder="全部状态" style="width: 140px" @change="load">
          <el-option label="进行中" value="false" />
          <el-option label="已办结" value="true" />
        </el-select>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
      </div>
    </div>

    <el-table :data="entries" border stripe :header-cell-style="{ textAlign: 'center' }" :cell-style="{ textAlign: 'center' }">
      <el-table-column type="index" label="序号" width="60" align="center" />
      <el-table-column prop="projectName" label="项目名称" min-width="180" />
      <el-table-column prop="matter" label="办理事项" min-width="160" />
      <el-table-column prop="clientName" label="甲方单位" min-width="140" />
      <el-table-column prop="district" label="行政区" width="100" />
      <el-table-column prop="projectType" label="项目类型" width="120" />
      <el-table-column prop="ownerName" label="负责人" width="100" />
      <el-table-column label="合同状态" width="110">
        <template #default="{ row }">
          <el-tag
            v-if="row.contractStatus"
            :type="contractTagType(row.contractStatus)"
            size="small"
            class="contract-tag"
            @click="handleContract(row)"
            style="cursor: pointer"
          >
            {{ row.contractStatus }}
          </el-tag>
          <el-button v-else size="small" link type="info" @click="handleContract(row)">未记录</el-button>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.projectIsCompleted ? 'success' : 'primary'" size="small">
            {{ row.projectIsCompleted ? '已办结' : '进行中' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="320" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link @click="handleEditEntry(row)">编辑</el-button>
          <el-button size="small" link @click="handleContract(row)">合同</el-button>
          <el-button size="small" link @click="handleViewGantt(row)">甘特图</el-button>
          <el-button size="small" link type="primary" @click="handleSummary(row)" :loading="generatingId === row.projectId">
            结题报告
          </el-button>
          <el-button v-if="!row.projectIsCompleted" size="small" link type="success" @click="handleComplete(row)">
            办结
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="editVisible" title="编辑项目" width="700px" :close-on-click-modal="false">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="项目名称">
          <el-input :model-value="editForm.projectName" disabled />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="甲方单位">
              <el-input v-model="editForm.clientName" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="行政区">
              <el-input :model-value="editForm.district" disabled />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="甲方负责人">
              <el-input v-model="editForm.clientContactName" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="负责人电话">
              <el-input v-model="editForm.clientContactPhone" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="委办局">
              <el-input v-model="editForm.agencyBureau" placeholder="办理机构委办局" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="科室">
              <el-input v-model="editForm.agencyDepartment" placeholder="办理科室" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="经办人">
              <el-input v-model="editForm.agencyContactName" placeholder="经办人姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经办人电话">
              <el-input v-model="editForm.agencyContactPhone" placeholder="经办人电话" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="项目类型">
              <el-input v-model="editForm.projectType" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="项目负责人">
              <el-select v-model="editForm.ownerUserId" filterable style="width: 100%">
                <el-option v-for="u in users" :key="u.id" :label="u.name" :value="u.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="handleEditSave">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="ganttVisible" :title="`${ganttProject?.name} 进度甘特图`" width="900px">
      <WorklogGanttChart v-if="ganttVisible" :project-id="ganttProject?.id || null" />
    </el-dialog>

    <!-- 合同进度对话框 -->
    <WorklogContractDialog
      v-model:visible="contractVisible"
      :project-id="contractProject?.id || ''"
      :project-name="contractProject?.name || ''"
      @status-changed="handleContractStatusChanged"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/utils/api'
import type { WorklogEntry, WorklogProject } from '@/types'
import WorklogGanttChart from '@/components/worklog-v2/WorklogGanttChart.vue'
import WorklogContractDialog from '@/components/worklog-v2/WorklogContractDialog.vue'

const loading = ref(false)
const projects = ref<WorklogProject[]>([])
const entries = ref<WorklogEntry[]>([])
const filterDistrict = ref('')
const filterMatter = ref('')
const filterCompleted = ref('')
const matters = ref<string[]>([])
const generatingId = ref('')

const ganttVisible = ref(false)
const ganttProject = ref<WorklogProject | null>(null)

const editVisible = ref(false)
const editSaving = ref(false)
const editForm = reactive({
  entryId: '',
  projectName: '',
  matter: '',
  district: '',
  clientName: '',
  clientContactName: '',
  clientContactPhone: '',
  agencyBureau: '',
  agencyDepartment: '',
  agencyContactName: '',
  agencyContactPhone: '',
  projectType: '',
  ownerUserId: '',
})

// 合同进度
const contractVisible = ref(false)
const contractProject = ref<WorklogProject | null>(null)

const districts = computed(() => Array.from(new Set(projects.value.map(p => p.district))))

interface UserLite { id: string; name: string }
const users = ref<UserLite[]>([])

onMounted(async () => {
  await Promise.all([load(), loadUsers(), loadMatters()])
})

async function loadMatters() {
  try {
    const resp = await api.get('/api/worklog-dicts/matters')
    if (resp.data.success) matters.value = resp.data.data.map((m: any) => m.name)
  } catch { /* ignore */ }
}

async function loadUsers() {
  try {
    const resp = await api.get('/api/users')
    if (resp.data.success) users.value = resp.data.data.map((u: any) => ({ id: u.id, name: u.name }))
  } catch { /* ignore */ }
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, string> = {}
    if (filterDistrict.value) params.district = filterDistrict.value
    if (filterCompleted.value) params.isCompleted = filterCompleted.value
    const [projResp, entryResp] = await Promise.all([
      api.get('/api/worklog-projects', { params }),
      api.get('/api/worklog-entries', { params: {
        ...(filterDistrict.value ? { district: filterDistrict.value } : {}),
        ...(filterMatter.value ? { matter: filterMatter.value } : {}),
      } }),
    ])
    if (projResp.data.success) projects.value = projResp.data.data
    if (entryResp.data.success) entries.value = entryResp.data.data
  } finally {
    loading.value = false
  }
}

function handleViewGantt(row: WorklogEntry) {
  const proj = projects.value.find(p => p.id === row.projectId)
  ganttProject.value = proj || null
  ganttVisible.value = true
}

function handleEditEntry(entry: WorklogEntry) {
  editForm.entryId = entry.id
  editForm.projectName = entry.projectName || ''
  editForm.matter = entry.matter || ''
  editForm.district = entry.district || ''
  editForm.clientName = entry.clientName || ''
  editForm.clientContactName = entry.clientContactName || ''
  editForm.clientContactPhone = entry.clientContactPhone || ''
  editForm.agencyBureau = entry.agencyBureau || ''
  editForm.agencyDepartment = entry.agencyDepartment || ''
  editForm.agencyContactName = entry.agencyContactName || ''
  editForm.agencyContactPhone = entry.agencyContactPhone || ''
  editForm.projectType = entry.projectType || ''
  editForm.ownerUserId = entry.ownerUserId || ''
  editVisible.value = true
}

async function handleEditSave() {
  editSaving.value = true
  try {
    const resp = await api.put(`/api/worklog-entries/${editForm.entryId}`, {
      clientName: editForm.clientName,
      clientContactName: editForm.clientContactName,
      clientContactPhone: editForm.clientContactPhone,
      agencyBureau: editForm.agencyBureau,
      agencyDepartment: editForm.agencyDepartment,
      agencyContactName: editForm.agencyContactName,
      agencyContactPhone: editForm.agencyContactPhone,
      projectType: editForm.projectType,
      ownerUserId: editForm.ownerUserId,
    })
    if (resp.data.success) {
      ElMessage.success('保存成功')
      editVisible.value = false
      await load()
    } else {
      ElMessage.error(resp.data.message || '保存失败')
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '保存失败')
  } finally {
    editSaving.value = false
  }
}

async function handleSummary(row: WorklogEntry) {
  const proj = projects.value.find(p => p.id === row.projectId)
  if (!proj) return
  generatingId.value = row.projectId
  try {
    const resp = await api.post('/api/worklog-reports/summary', { projectId: row.projectId }, { responseType: 'blob' })
    const blob = new Blob([resp.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    triggerDownload(blob, `${proj.name}_结题报告.docx`)
    ElMessage.success('结题报告已生成')
  } catch (err: any) {
    const msg = await parseBlobError(err?.response?.data) || err?.response?.data?.message || '生成失败'
    ElMessage.error(msg)
  } finally {
    generatingId.value = ''
  }
}

async function handleComplete(row: WorklogEntry) {
  const proj = projects.value.find(p => p.id === row.projectId)
  if (!proj) return
  try {
    await ElMessageBox.confirm(`办结项目「${proj.name}」？办结后无法再添加日志`, '提示', { type: 'warning' })
  } catch { return }
  try {
    await api.post(`/api/worklog-projects/${row.projectId}/complete`)
    ElMessage.success('已办结')
    await load()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '办结失败')
  }
}

// ========== 合同进度 ==========

function contractTagType(status: string): 'success' | 'warning' | 'info' | 'primary' | 'danger' {
  if (status === '已结清') return 'success'
  if (status === '已开票未收款') return 'warning'
  if (status === '未签合同') return 'info'
  return 'primary'
}

function handleContract(row: WorklogEntry) {
  const proj = projects.value.find(p => p.id === row.projectId)
  contractProject.value = proj || null
  contractVisible.value = true
}

function handleContractStatusChanged(status: string | null) {
  if (!contractProject.value) return
  contractProject.value.contractStatus = status
  const p = projects.value.find(x => x.id === contractProject.value!.id)
  if (p) p.contractStatus = status
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

async function parseBlobError(blob: Blob | undefined): Promise<string | null> {
  if (!blob) return null
  try {
    const text = await blob.text()
    const json = JSON.parse(text)
    return json?.message || null
  } catch { return null }
}
</script>

<style scoped>
.project-list {
  padding: 0 16px;
  margin-left: calc(-1 * var(--yl-main-padding-x, 45px));
  margin-right: calc(-1 * var(--yl-main-padding-x, 45px));
}
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-header h2 { margin: 0; }
.actions { display: flex; gap: 8px; align-items: center; }
.contract-tag { cursor: pointer; }
</style>
