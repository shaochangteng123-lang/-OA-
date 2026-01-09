<template>
  <div class="event-library-container">
    <div class="page-header">
      <h1 class="page-title">事件库管理</h1>
      <el-button type="primary" :icon="Plus" @click="handleCreate">
        新建事件
      </el-button>
    </div>

    <el-card shadow="never">
      <el-form :inline="true">
        <el-form-item label="搜索">
          <el-input
            v-model="searchText"
            placeholder="事件名称"
            clearable
            style="width: 240px"
            @input="handleSearch"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="filterType" clearable placeholder="全部" style="width: 150px" @change="handleFilter">
            <el-option label="审批事项" value="approval" />
            <el-option label="备案事项" value="filing" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="filteredEvents" stripe>
        <el-table-column prop="name" label="事件名称" min-width="200" />
        <el-table-column prop="eventType" label="事件类型" width="120" />
        <el-table-column prop="standardDuration" label="标准时长(天)" width="120" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleEdit(row)">编辑</el-button>
            <el-button type="danger" size="small" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑事件' : '新建事件'" width="600px">
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="120px">
        <el-form-item label="事件名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入事件名称" />
        </el-form-item>
        <el-form-item label="事件类型" prop="eventType">
          <el-select v-model="formData.eventType" placeholder="请选择" style="width: 100%">
            <el-option label="审批事项" value="approval" />
            <el-option label="备案事项" value="filing" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="标准时长(天)">
          <el-input-number v-model="formData.standardDuration" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="formData.description" type="textarea" :rows="3" />
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
import { ref, computed, onMounted } from 'vue'
import { Plus, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, FormInstance, FormRules } from 'element-plus'
import { api } from '@/utils/api'

interface Event {
  id: string
  name: string
  eventType: string
  standardDuration?: number
  description?: string
}

const events = ref<Event[]>([])
const loading = ref(false)
const searchText = ref('')
const filterType = ref('')
const dialogVisible = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()

const formData = ref({ id: '', name: '', eventType: '', standardDuration: 0, description: '' })
const formRules: FormRules = {
  name: [{ required: true, message: '请输入事件名称', trigger: 'blur' }],
  eventType: [{ required: true, message: '请选择事件类型', trigger: 'change' }],
}

const filteredEvents = computed(() => {
  return events.value.filter(
    (e) =>
      (!searchText.value || e.name.includes(searchText.value)) &&
      (!filterType.value || e.eventType === filterType.value)
  )
})

async function loadEvents() {
  try {
    loading.value = true
    const response = await api.get('/api/event-library')
    if (response.data.success) events.value = response.data.data || []
  } catch (error) {
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

function handleSearch() {}
function handleFilter() {}

function handleCreate() {
  formData.value = { id: '', name: '', eventType: '', standardDuration: 0, description: '' }
  isEditing.value = false
  dialogVisible.value = true
}

function handleEdit(event: Event) {
  formData.value = {
    ...event,
    standardDuration: event.standardDuration || 0,
    description: event.description || ''
  }
  isEditing.value = true
  dialogVisible.value = true
}

async function handleSave() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    try {
      saving.value = true
      if (isEditing.value) {
        await api.put(`/api/event-library/${formData.value.id}`, formData.value)
        ElMessage.success('更新成功')
      } else {
        await api.post('/api/event-library', formData.value)
        ElMessage.success('创建成功')
      }
      dialogVisible.value = false
      await loadEvents()
    } catch (error) {
      ElMessage.error('保存失败')
    } finally {
      saving.value = false
    }
  })
}

async function handleDelete(event: Event) {
  try {
    await ElMessageBox.confirm(`确定删除"${event.name}"?`, '提示', { type: 'warning' })
    await api.delete(`/api/event-library/${event.id}`)
    ElMessage.success('删除成功')
    await loadEvents()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error('删除失败')
  }
}

onMounted(() => loadEvents())
</script>

<style scoped>
.event-library-container {
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
.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}
</style>
