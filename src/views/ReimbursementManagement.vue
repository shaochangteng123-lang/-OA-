<template>
  <div class="reimbursement-management-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <el-button type="primary" :icon="Plus" @click="handleAdd">{{ addButtonLabel }}</el-button>
        </div>
      </template>

      <div class="content-wrapper">
        <el-tabs v-model="activeScopeType" @tab-change="handleScopeTabChange">
          <el-tab-pane label="报销范围" name="general" />
          <el-tab-pane label="福利1分类" name="welfare_one" />
          <el-tab-pane label="福利2分类" name="welfare_two" />
        </el-tabs>
        <el-alert
          v-if="isWelfareScope"
          :title="`${activeScopeLabel}独立维护，仅用于${activeScopeLabel.replace('分类', '报销')}`"
          type="info"
          :closable="false"
          show-icon
          class="scope-tip"
        />
        <el-table
          :data="tableData"
          row-key="id"
          :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
          style="width: 100%"
          v-loading="loading"
        >
          <el-table-column prop="sort_order" label="排序" width="100" align="center" header-align="center" />
          <el-table-column prop="name" label="名称" width="400" align="center" header-align="center" />
          <el-table-column label="状态" width="100" align="center" header-align="center">
            <template #default="{ row }">
              <el-tag :type="row.is_active ? 'success' : 'info'">
                {{ row.is_active ? '启用' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" min-width="300" align="center" header-align="center">
            <template #default="{ row }">
              <el-button v-if="!isWelfareScope" link type="primary" size="small" @click="handleAddChild(row)">
                添加子项
              </el-button>
              <el-button link type="primary" size="small" @click="handleEdit(row)">
                编辑
              </el-button>
              <el-button link type="primary" size="small" @click="handleMoveUp(row)">
                上移
              </el-button>
              <el-button link type="primary" size="small" @click="handleMoveDown(row)">
                下移
              </el-button>
              <el-button link type="danger" size="small" @click="handleDelete(row)">
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <!-- 添加/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="500px"
    >
      <el-form :model="formData" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="formData.name" :placeholder="`请输入${isWelfareScope ? '分类' : '范围'}名称`" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="formData.isActive" active-text="启用" inactive-text="禁用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import { REIMBURSEMENT_TYPE_CONFIG } from '@/utils/reimbursement/typeConfig'

interface ScopeItem {
  id: string
  parent_id: string | null
  name: string
  value: string
  code?: string
  sort_order: number
  is_active: number
  children?: ScopeItem[]
  sortOrder?: number
  isActive?: boolean
}

// 数据
const loading = ref(false)
const activeScopeType = ref<'general' | 'welfare_one' | 'welfare_two'>('general')
const tableData = ref<ScopeItem[]>([])
const dialogVisible = ref(false)
const dialogTitle = ref('')
const submitting = ref(false)
const currentParentId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const isWelfareScope = computed(() => activeScopeType.value !== 'general')
const activeScopeLabel = computed(() => {
  if (activeScopeType.value === 'welfare_one') return '福利1分类'
  if (activeScopeType.value === 'welfare_two') return '福利2分类'
  return '报销范围'
})
const addButtonLabel = computed(() => `添加${activeScopeLabel.value}`)
const managementBase = computed(() => {
  if (activeScopeType.value === 'welfare_one') {
    return REIMBURSEMENT_TYPE_CONFIG.welfare_one.scopeManagementBase!
  }
  if (activeScopeType.value === 'welfare_two') {
    return REIMBURSEMENT_TYPE_CONFIG.welfare_two.scopeManagementBase!
  }
  return '/api/reimbursement-scope'
})

const formData = ref({
  name: '',
  isActive: true
})

// 加载数据
const loadData = async () => {
  try {
    loading.value = true
    const response = await api.get(`${managementBase.value}/admin/list`)
    if (response.data.success) {
      const items = Array.isArray(response.data.data) ? response.data.data : []
      tableData.value = items.map((item: ScopeItem) => ({
        ...item,
        parent_id: item.parent_id ?? null,
        value: item.value || item.code || item.id,
        sort_order: Number(item.sort_order ?? item.sortOrder ?? 0),
        is_active: Number(item.is_active ?? item.isActive ?? 1),
      }))
    }
  } catch (error) {
    console.error('加载数据失败:', error)
    ElMessage.error('加载数据失败')
  } finally {
    loading.value = false
  }
}

// 添加顶级范围
const handleAdd = () => {
  dialogTitle.value = `添加${activeScopeLabel.value}`
  currentParentId.value = null
  editingId.value = null
  formData.value = {
    name: '',
    isActive: true
  }
  dialogVisible.value = true
}

// 添加子项
const handleAddChild = (row: ScopeItem) => {
  dialogTitle.value = '添加子项'
  currentParentId.value = row.id
  editingId.value = null
  formData.value = {
    name: '',
    isActive: true
  }
  dialogVisible.value = true
}

// 编辑
const handleEdit = (row: ScopeItem) => {
  dialogTitle.value = `编辑${activeScopeLabel.value}`
  currentParentId.value = row.parent_id
  editingId.value = row.id
  formData.value = {
    name: row.name,
    isActive: row.is_active === 1
  }
  dialogVisible.value = true
}

// 生成 value 值（基于名称和时间戳）
const generateValue = (name: string, parentId: string | null): string => {
  // 移除特殊字符，保留中文、英文、数字
  const cleanName = name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
  // 生成时间戳后缀
  const timestamp = Date.now().toString().slice(-6)
  // 如果有父级，添加前缀
  const prefix = parentId ? 'sub_' : ''
  return `${prefix}${cleanName}_${timestamp}`
}

// 递归查找项
const findItemById = (items: ScopeItem[], id: string): ScopeItem | null => {
  for (const item of items) {
    if (item.id === id) return item
    if (item.children) {
      const found = findItemById(item.children, id)
      if (found) return found
    }
  }
  return null
}

// 提交
const handleSubmit = async () => {
  if (!formData.value.name) {
    ElMessage.warning('请填写名称')
    return
  }

  try {
    submitting.value = true

    // 自动生成 value 值
    let value: string
    if (editingId.value) {
      // 编辑时保留原有的 value
      const existingItem = findItemById(tableData.value, editingId.value)
      value = existingItem?.value || generateValue(formData.value.name, currentParentId.value)
    } else {
      // 新增时生成新的 value
      value = generateValue(formData.value.name, currentParentId.value)
    }

    if (editingId.value) {
      // 编辑
      await api.put(`${managementBase.value}/${editingId.value}`, {
        name: formData.value.name,
        ...(isWelfareScope.value ? {} : { value }),
        isActive: formData.value.isActive
      })
      ElMessage.success('更新成功')
    } else {
      // 新增
      await api.post(`${managementBase.value}/create`, {
        name: formData.value.name,
        ...(isWelfareScope.value
          ? {}
          : { parentId: currentParentId.value, value }),
      })
      ElMessage.success('添加成功')
    }

    dialogVisible.value = false
    await loadData()
  } catch (error) {
    console.error('操作失败:', error)
    ElMessage.error('操作失败')
  } finally {
    submitting.value = false
  }
}

// 删除
const handleDelete = async (row: ScopeItem) => {
  try {
    await ElMessageBox.confirm(
      isWelfareScope.value
        ? `确定删除${activeScopeLabel.value}“${row.name}”吗？已被报销引用的分类无法删除。`
        : '确定要删除该项吗？',
      '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    const response = await api.delete(`${managementBase.value}/${row.id}`)
    ElMessage.success(response.data.message || '删除成功')
    await loadData()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('删除失败:', error)
      const conflictMessage = isWelfareScope.value && error.response?.status === 409
        ? '该分类已被报销记录引用，无法删除'
        : '删除失败'
      ElMessage.error(error.response?.data?.message || conflictMessage)
    }
  }
}

// 查找同级项
const findSiblings = (data: ScopeItem[], targetParentId: string | null): ScopeItem[] => {
  const result: ScopeItem[] = []

  const traverse = (items: ScopeItem[], parentId: string | null) => {
    for (const item of items) {
      if (item.parent_id === parentId) {
        result.push(item)
      }
      if (item.children && item.children.length > 0) {
        traverse(item.children, item.id)
      }
    }
  }

  if (targetParentId === null) {
    // 顶级项
    return data.filter(item => item.parent_id === null)
  } else {
    // 查找父项的所有子项
    traverse(data, targetParentId)
    return result
  }
}

// 上移
const handleMoveUp = async (row: ScopeItem) => {
  const siblings = findSiblings(tableData.value, row.parent_id)
  const currentIndex = siblings.findIndex(item => item.id === row.id)

  if (currentIndex <= 0) {
    ElMessage.warning('已经是第一项了')
    return
  }

  const prevItem = siblings[currentIndex - 1]
  const items = [
    { id: row.id, sortOrder: prevItem.sort_order },
    { id: prevItem.id, sortOrder: row.sort_order }
  ]

  try {
    await api.put(`${managementBase.value}/sort`, { items })
    ElMessage.success('移动成功')
    await loadData()
  } catch (error) {
    console.error('移动失败:', error)
    ElMessage.error('移动失败')
  }
}

// 下移
const handleMoveDown = async (row: ScopeItem) => {
  const siblings = findSiblings(tableData.value, row.parent_id)
  const currentIndex = siblings.findIndex(item => item.id === row.id)

  if (currentIndex >= siblings.length - 1) {
    ElMessage.warning('已经是最后一项了')
    return
  }

  const nextItem = siblings[currentIndex + 1]
  const items = [
    { id: row.id, sortOrder: nextItem.sort_order },
    { id: nextItem.id, sortOrder: row.sort_order }
  ]

  try {
    await api.put(`${managementBase.value}/sort`, { items })
    ElMessage.success('移动成功')
    await loadData()
  } catch (error) {
    console.error('移动失败:', error)
    ElMessage.error('移动失败')
  }
}

onMounted(() => {
  loadData()
})

function handleScopeTabChange() {
  tableData.value = []
  void loadData()
}
</script>

<style scoped>
.reimbursement-management-container {
  height: calc(100vh - 60px);
  margin: calc(-1 * var(--yl-main-padding-y, 24px)) calc(-1 * var(--yl-main-padding-x, 45px));
  padding: 0;
}

.page-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: none;
  box-shadow: none;
}

.page-card :deep(.el-card__header) {
  padding: 16px 24px;
  border-bottom: 1px solid #e4e7ed;
}

.page-card :deep(.el-card__body) {
  flex: 1;
  padding: 24px;
  overflow: auto;
}

.card-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.content-wrapper {
  height: 100%;
}
</style>
