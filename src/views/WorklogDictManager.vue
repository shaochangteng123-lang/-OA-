<template>
  <div class="dict-manager" v-loading="loading">
    <div class="page-header">
      <h2>日志管理</h2>
      <p class="subtitle">维护行政区、项目类型、办理事项、合同付款状态四类字典</p>
    </div>

    <el-tabs v-model="activeKind" @tab-change="loadList">
      <el-tab-pane label="行政区" name="districts" />
      <el-tab-pane label="项目类型" name="project-types" />
      <el-tab-pane label="办理事项" name="matters" />
      <el-tab-pane label="合同付款状态" name="contract-statuses" />
    </el-tabs>

    <div class="toolbar">
      <el-button type="primary" :icon="Plus" @click="handleAdd">新增</el-button>
    </div>

    <el-table :data="list" border stripe size="default">
      <el-table-column prop="sort_order" label="排序" width="100" align="center" header-align="center" />
      <el-table-column prop="name" label="名称" min-width="200" align="left" header-align="left" />
      <el-table-column v-if="activeKind === 'matters'" prop="standard_days" label="标准办理天数" width="140" align="center" header-align="center" />
      <el-table-column label="状态" width="100" align="center" header-align="center">
        <template #default="{ row }">
          <el-tag :type="row.is_active ? 'success' : 'info'" size="small">
            {{ row.is_active ? '启用' : '已停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right" align="center" header-align="center">
        <template #default="{ row }">
          <el-button size="small" link @click="handleEdit(row)">编辑</el-button>
          <el-button size="small" link type="danger" @click="handleDisable(row)">
            {{ row.is_active ? '停用' : '已停用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑' : '新增'" width="460px">
      <el-form :model="form" label-width="120px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item v-if="activeKind === 'matters'" label="标准办理天数">
          <el-input-number v-model="form.standard_days" :min="0" :max="365" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort_order" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/utils/api'

type DictKind = 'districts' | 'project-types' | 'matters' | 'contract-statuses'

const activeKind = ref<DictKind>('districts')
const list = ref<any[]>([])
const loading = ref(false)

const dialogVisible = ref(false)
const editing = ref<any>(null)
const saving = ref(false)
const form = ref<{ id?: string; name: string; sort_order: number; standard_days?: number }>({
  name: '', sort_order: 0,
})

onMounted(() => loadList())

async function loadList() {
  loading.value = true
  try {
    const resp = await api.get(`/api/worklog-dicts/${activeKind.value}`, { params: { includeInactive: true } })
    if (resp.data.success) list.value = resp.data.data
  } finally {
    loading.value = false
  }
}

function handleAdd() {
  editing.value = null
  form.value = { name: '', sort_order: (list.value.length + 1) * 10, standard_days: undefined }
  dialogVisible.value = true
}

function handleEdit(row: any) {
  editing.value = row
  form.value = { id: row.id, name: row.name, sort_order: row.sort_order, standard_days: row.standard_days }
  dialogVisible.value = true
}

async function handleSave() {
  if (!form.value.name.trim()) { ElMessage.warning('名称必填'); return }
  saving.value = true
  try {
    if (editing.value) {
      await api.put(`/api/worklog-dicts/${activeKind.value}/${editing.value.id}`, form.value)
      ElMessage.success('已更新')
    } else {
      await api.post(`/api/worklog-dicts/${activeKind.value}`, form.value)
      ElMessage.success('已新增')
    }
    dialogVisible.value = false
    await loadList()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function handleDisable(row: any) {
  if (!row.is_active) return
  try {
    await ElMessageBox.confirm(`停用「${row.name}」后，在下拉中将不再出现（不影响历史数据）`, '提示', { type: 'warning' })
  } catch { return }
  try {
    await api.delete(`/api/worklog-dicts/${activeKind.value}/${row.id}`)
    await loadList()
    ElMessage.success('已停用')
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '停用失败')
  }
}
</script>

<style scoped>
.dict-manager {
  padding: 0 16px;
  margin-left: calc(-1 * var(--yl-main-padding-x, 45px));
  margin-right: calc(-1 * var(--yl-main-padding-x, 45px));
}
.page-header h2 { margin: 0; }
.subtitle { color: #909399; margin: 4px 0 16px 0; font-size: 13px; }
.toolbar { margin: 12px 0; }
</style>
