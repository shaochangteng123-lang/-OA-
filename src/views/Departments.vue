<template>
  <div class="yl-page">
    <!-- 页面头部 -->
    <div class="yl-page-header">
      <div class="yl-page-title">
        <el-icon :size="24" color="var(--yl-primary)">
          <OfficeBuilding />
        </el-icon>
        <h1>部门管理</h1>
      </div>
      <div class="yl-page-actions">
        <el-button :icon="Refresh" @click="refreshDepartments">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="showAddDialog">新增部门</el-button>
      </div>
    </div>

    <!-- 搜索栏 -->
    <el-card class="yl-search-card">
      <el-input
        v-model="searchText"
        placeholder="搜索部门名称..."
        :prefix-icon="Search"
        clearable
        @clear="loadDepartments"
        @keyup.enter="loadDepartments"
      />
    </el-card>

    <!-- 部门表格 -->
    <el-card class="yl-table-card">
      <el-table :data="departments" border stripe v-loading="loading">
        <el-table-column label="部门全称" min-width="250" prop="fullName" />
        <el-table-column label="简称" min-width="200">
          <template #default="{ row }">
            <div class="yl-tags">
              <el-tag v-for="name in row.shortNames" :key="name" size="small" type="info">
                {{ name }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="网站" min-width="150">
          <template #default="{ row }">
            <a
              v-if="row.websiteUrl"
              :href="row.websiteUrl"
              target="_blank"
              class="yl-link"
            >
              <el-icon><Link /></el-icon>
              访问
            </a>
            <span v-else class="yl-text-placeholder">无</span>
          </template>
        </el-table-column>
        <el-table-column label="排序" width="80" prop="sortOrder" align="center" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'danger'" size="small">
              {{ row.isActive ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" @click="editDepartment(row)">编辑</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="deleteDepartment(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? '编辑部门' : '新增部门'"
      width="500px"
    >
      <el-form :model="form" label-width="80px" :rules="rules" ref="formRef">
        <el-form-item label="全称" prop="fullName">
          <el-input v-model="form.fullName" placeholder="请输入部门全称" />
        </el-form-item>
        <el-form-item label="简称" prop="shortNames">
          <el-select
            v-model="form.shortNames"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="请输入简称，按回车添加"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="网站">
          <el-input v-model="form.websiteUrl" placeholder="请输入网站地址（可选）" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item v-if="isEditing" label="状态">
          <el-switch v-model="form.isActive" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitForm" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { OfficeBuilding, Refresh, Plus, Edit, Delete, Search, Link } from '@element-plus/icons-vue'
import { api } from '@/utils/api'

interface Department {
  id: string
  fullName: string
  shortNames: string[]
  websiteUrl?: string
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

const departments = ref<Department[]>([])
const loading = ref(false)
const searchText = ref('')
const dialogVisible = ref(false)
const isEditing = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const editingId = ref<string | null>(null)

const form = reactive({
  fullName: '',
  shortNames: [] as string[],
  websiteUrl: '',
  sortOrder: 0,
  isActive: true,
})

const rules: FormRules = {
  fullName: [{ required: true, message: '请输入部门全称', trigger: 'blur' }],
  shortNames: [{ required: true, message: '请至少添加一个简称', trigger: 'change' }],
}

async function loadDepartments() {
  loading.value = true
  try {
    const params = searchText.value ? { search: searchText.value } : {}
    const res = await api.get('/api/departments', { params })
    if (res.data.success) {
      departments.value = res.data.data
    }
  } catch {
    ElMessage.error('加载部门列表失败')
  } finally {
    loading.value = false
  }
}

function refreshDepartments() {
  loadDepartments()
  ElMessage.success('已刷新')
}

function showAddDialog() {
  isEditing.value = false
  editingId.value = null
  form.fullName = ''
  form.shortNames = []
  form.websiteUrl = ''
  form.sortOrder = 0
  form.isActive = true
  dialogVisible.value = true
}

function editDepartment(dept: Department) {
  isEditing.value = true
  editingId.value = dept.id
  form.fullName = dept.fullName
  form.shortNames = [...dept.shortNames]
  form.websiteUrl = dept.websiteUrl || ''
  form.sortOrder = dept.sortOrder
  form.isActive = dept.isActive
  dialogVisible.value = true
}

async function deleteDepartment(dept: Department) {
  try {
    await ElMessageBox.confirm(`确定要删除部门"${dept.fullName}"吗？`, '确认删除', {
      type: 'warning',
    })
    const res = await api.delete(`/api/departments/${dept.id}`)
    if (res.data.success) {
      ElMessage.success('删除成功')
      loadDepartments()
    } else {
      ElMessage.error(res.data.message || '删除失败')
    }
  } catch (error: unknown) {
    if ((error as { message?: string })?.message !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

async function submitForm() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const data = {
      fullName: form.fullName,
      shortNames: form.shortNames,
      websiteUrl: form.websiteUrl || undefined,
      sortOrder: form.sortOrder,
      isActive: form.isActive,
    }

    let res
    if (isEditing.value && editingId.value) {
      res = await api.put(`/api/departments/${editingId.value}`, data)
    } else {
      res = await api.post('/api/departments', data)
    }

    if (res.data.success) {
      ElMessage.success(isEditing.value ? '更新成功' : '创建成功')
      dialogVisible.value = false
      loadDepartments()
    } else {
      ElMessage.error(res.data.message || '操作失败')
    }
  } catch {
    ElMessage.error('操作失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loadDepartments()
})
</script>

<style scoped>
.yl-search-card {
  margin-bottom: var(--yl-margin-md);
}

.yl-search-card :deep(.el-input) {
  max-width: 400px;
}

.yl-table-card {
  overflow: hidden;
}

.yl-table-card :deep(.el-table) {
  font-size: var(--yl-font-size-base);
}

.yl-table-card :deep(.el-table th) {
  background-color: var(--yl-bg-hover);
  font-weight: var(--yl-font-weight-semibold);
}

.yl-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.yl-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--yl-primary);
  text-decoration: none;
}

.yl-link:hover {
  text-decoration: underline;
}
</style>
