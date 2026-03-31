<template>
  <div class="blocks-container">
    <div class="page-header">
      <h1 class="page-title">板块设置</h1>
      <el-button type="primary" :icon="Plus" @click="handleCreate">新建板块</el-button>
    </div>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="blocks" stripe>
        <el-table-column prop="name" label="板块名称" min-width="200" />
        <el-table-column prop="categoryName" label="分类" width="150" />
        <el-table-column label="包含事件" width="100">
          <template #default="{ row }">{{ row.events?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="操作" min-width="150">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleEdit(row)">编辑</el-button>
            <el-button type="danger" size="small" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑板块' : '新建板块'" width="600px">
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="板块名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入板块名称" />
        </el-form-item>
        <el-form-item label="分类" prop="categoryId">
          <el-select v-model="formData.categoryId" placeholder="请选择" style="width: 100%">
            <el-option label="前期手续" value="cat1" />
            <el-option label="中期审批" value="cat2" />
            <el-option label="后期验收" value="cat3" />
          </el-select>
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
import { ref, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, FormInstance, FormRules } from 'element-plus'
import { api } from '@/utils/api'

interface Block {
  id: string
  name: string
  categoryId: string
  categoryName?: string
  description?: string
  events?: any[]
}

const blocks = ref<Block[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()

const formData = ref({ id: '', name: '', categoryId: '', description: '' })
const formRules: FormRules = {
  name: [{ required: true, message: '请输入板块名称', trigger: 'blur' }],
  categoryId: [{ required: true, message: '请选择分类', trigger: 'change' }],
}

async function loadBlocks() {
  try {
    loading.value = true
    const response = await api.get('/api/blocks')
    if (response.data.success) blocks.value = response.data.data || []
  } catch (error) {
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

function handleCreate() {
  formData.value = { id: '', name: '', categoryId: '', description: '' }
  isEditing.value = false
  dialogVisible.value = true
}

function handleEdit(block: Block) {
  formData.value = { ...block, description: block.description || '' }
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
        await api.put(`/api/blocks/${formData.value.id}`, formData.value)
        ElMessage.success('更新成功')
      } else {
        await api.post('/api/blocks', formData.value)
        ElMessage.success('创建成功')
      }
      dialogVisible.value = false
      await loadBlocks()
    } catch (error) {
      ElMessage.error('保存失败')
    } finally {
      saving.value = false
    }
  })
}

async function handleDelete(block: Block) {
  try {
    await ElMessageBox.confirm(`确定删除"${block.name}"?`, '提示', { type: 'warning' })
    await api.delete(`/api/blocks/${block.id}`)
    ElMessage.success('删除成功')
    await loadBlocks()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error('删除失败')
  }
}

onMounted(() => loadBlocks())
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.blocks-container {
  height: calc(100vh - 60px);
  margin: calc(-1 * var(--yl-main-padding-y, 24px)) calc(-1 * var(--yl-main-padding-x, 45px));
  padding: 24px;
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
