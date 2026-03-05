<template>
  <div class="yl-page">
    <!-- 页面头部 -->
    <div class="yl-page-header">
      <div class="yl-page-title">
        <el-icon :size="24" color="var(--yl-primary)">
          <Document />
        </el-icon>
        <h1>预设方案管理</h1>
      </div>
      <div class="yl-page-actions">
        <el-button type="primary" :icon="Plus" @click="createPreset"> 新建预设 </el-button>
      </div>
    </div>

    <!-- 预设方案网格 -->
    <div class="yl-page-body">
      <el-empty v-if="presets.length === 0" description="暂无预设方案" />

      <div v-else class="yl-presets-grid">
        <el-card
          v-for="preset in presets"
          :key="preset.id"
          class="yl-preset-card card-hover"
          :class="{ 'is-default': preset.isDefault }"
        >
          <template #header>
            <div class="yl-card-header">
              <h3 class="yl-preset-title">{{ preset.name }}</h3>
              <el-tag v-if="preset.isDefault" type="success" size="small"> 默认 </el-tag>
            </div>
          </template>

          <div class="yl-preset-info">
            <div class="yl-info-item">
              <el-icon color="var(--yl-text-secondary)">
                <Operation />
              </el-icon>
              <span class="yl-info-label">实施类型:</span>
              <el-tag :type="getImplementationTypeTag(preset.implementationType)" size="small">
                {{ preset.implementationType }}
              </el-tag>
            </div>
            <div class="yl-info-item">
              <el-icon color="var(--yl-text-secondary)">
                <Folder />
              </el-icon>
              <span class="yl-info-label">项目类型:</span>
              <el-tag :type="getProjectTypeTag(preset.projectType)" size="small">
                {{ preset.projectType }}
              </el-tag>
            </div>
            <div class="yl-info-item">
              <el-icon color="var(--yl-text-secondary)">
                <DataLine />
              </el-icon>
              <span class="yl-info-label">板块数:</span>
              <span class="yl-info-value">{{ getBlockCount(preset) }}</span>
            </div>
            <div class="yl-info-item">
              <el-icon color="var(--yl-text-secondary)">
                <List />
              </el-icon>
              <span class="yl-info-label">事件数:</span>
              <span class="yl-info-value">{{ getEventCount(preset) }}</span>
            </div>
          </div>

          <template #footer>
            <div class="yl-card-actions">
              <el-button size="small" :icon="Edit" @click="editPreset(preset)"> 编辑 </el-button>
              <el-button
                v-if="!preset.isDefault"
                size="small"
                type="danger"
                :icon="Delete"
                @click="deletePreset(preset.id)"
              >
                删除
              </el-button>
            </div>
          </template>
        </el-card>
      </div>
    </div>

    <!-- 新建/编辑预设对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="900px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form ref="presetFormRef" :model="presetForm" :rules="presetRules" label-width="100px">
        <el-row :gutter="20">
          <el-col :span="24">
            <el-form-item label="预设名称" prop="name">
              <el-input
                v-model="presetForm.name"
                placeholder="请输入预设名称"
                :disabled="isEditingDefault"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="实施类型" prop="implementationType">
              <el-select
                v-model="presetForm.implementationType"
                placeholder="请选择实施类型"
                style="width: 100%"
                :disabled="isEditingDefault"
              >
                <el-option label="新改扩建" value="新改扩建" />
                <el-option label="历史遗留" value="历史遗留" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="项目类型" prop="projectType">
              <el-select
                v-model="presetForm.projectType"
                placeholder="请选择项目类型"
                style="width: 100%"
                :disabled="isEditingDefault"
              >
                <el-option label="场站" value="场站" />
                <el-option label="线性" value="线性" />
                <el-option label="工民建" value="工民建" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider>板块配置</el-divider>

        <div class="blocks-config">
          <div class="blocks-header">
            <span class="blocks-title">已选板块 ({{ presetForm.blocks.length }})</span>
            <el-button type="primary" size="small" :icon="Plus" @click="showBlockSelector">
              添加板块
            </el-button>
          </div>

          <el-empty
            v-if="presetForm.blocks.length === 0"
            description="暂无板块，请点击添加板块"
            :image-size="80"
          />

          <div v-else class="blocks-list">
            <div v-for="(blockRef, index) in presetForm.blocks" :key="index" class="block-item">
              <div class="block-item-header">
                <el-icon class="drag-handle"><Rank /></el-icon>
                <span class="block-order">{{ Number(index) + 1 }}</span>
                <span class="block-name">{{ blockRef.customName || blockRef.blockId }}</span>
                <div class="block-item-actions">
                  <el-button
                    size="small"
                    text
                    :icon="ArrowUp"
                    :disabled="index === 0"
                    @click="moveBlockUp(index)"
                  >
                    上移
                  </el-button>
                  <el-button
                    size="small"
                    text
                    :icon="ArrowDown"
                    :disabled="index === presetForm.blocks.length - 1"
                    @click="moveBlockDown(index)"
                  >
                    下移
                  </el-button>
                  <el-button
                    size="small"
                    text
                    type="danger"
                    :icon="Delete"
                    @click="removeBlock(index)"
                  >
                    移除
                  </el-button>
                </div>
              </div>
              <div v-if="getBlockDetail(blockRef.blockId)" class="block-item-detail">
                <el-tag size="small" type="info">
                  {{ getBlockDetail(blockRef.blockId)?.events?.length || 0 }} 个事件
                </el-tag>
                <span v-if="getBlockDetail(blockRef.blockId)?.standardDuration" class="duration">
                  标准耗时: {{ getBlockDetail(blockRef.blockId)?.standardDuration }} 天
                </span>
              </div>
            </div>
          </div>
        </div>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave"> 保存 </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 板块选择器对话框 -->
    <el-dialog v-model="blockSelectorVisible" title="选择板块" width="800px" append-to-body>
      <el-tabs v-model="selectedCategory">
        <el-tab-pane
          v-for="category in blockCategories"
          :key="category.id"
          :label="category.name"
          :name="category.id"
        >
          <div class="block-selector-list">
            <el-empty
              v-if="getCategoryBlocks(category.id).length === 0"
              description="该分类下暂无板块"
            />
            <div
              v-for="block in getCategoryBlocks(category.id)"
              :key="block.id"
              class="block-selector-item"
              :class="{ selected: isBlockSelected(block.id) }"
              @click="toggleBlockSelection(block)"
            >
              <div class="block-selector-info">
                <div class="block-selector-name">{{ block.name }}</div>
                <div class="block-selector-meta">
                  <el-tag size="small">{{ block.events?.length || 0 }} 个事件</el-tag>
                  <span v-if="block.standardDuration" class="duration">
                    {{ block.standardDuration }} 天
                  </span>
                </div>
                <div v-if="block.description" class="block-selector-desc">
                  {{ block.description }}
                </div>
              </div>
              <el-icon v-if="isBlockSelected(block.id)" class="selected-icon" :size="24">
                <CircleCheck />
              </el-icon>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>

      <template #footer>
        <el-button @click="blockSelectorVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  Document,
  Plus,
  Edit,
  Delete,
  Operation,
  Folder,
  DataLine,
  List,
  Rank,
  ArrowUp,
  ArrowDown,
  CircleCheck,
} from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import type {
  EventPreset,
  PresetBlockRef,
  EventBlock,
  BlockCategoryEntity,
  ElementPlusTagType,
} from '@/types'

const presets = ref<EventPreset[]>([])
const allBlocks = ref<EventBlock[]>([])
const blockCategories = ref<BlockCategoryEntity[]>([])

// 对话框状态
const dialogVisible = ref(false)
const dialogTitle = ref('新建预设')
const isEditingDefault = ref(false)
const saving = ref(false)
const presetFormRef = ref<FormInstance>()

// 板块选择器状态
const blockSelectorVisible = ref(false)
const selectedCategory = ref('')

// 预设表单
const presetForm = ref({
  id: '',
  name: '',
  implementationType: '' as string,
  projectType: '' as string,
  blocks: [] as PresetBlockRef[],
  isDefault: false,
})

// 表单验证规则
const presetRules: FormRules = {
  name: [{ required: true, message: '请输入预设名称', trigger: 'blur' }],
  implementationType: [{ required: true, message: '请选择实施类型', trigger: 'change' }],
  projectType: [{ required: true, message: '请选择项目类型', trigger: 'change' }],
}

// 标签颜色映射
function getImplementationTypeTag(implementationType: string | undefined): ElementPlusTagType {
  if (!implementationType) return 'info'
  const typeMap: Record<string, ElementPlusTagType> = {
    新改扩建: 'success',
    历史遗留: 'warning',
  }
  return typeMap[implementationType] || 'info'
}

function getProjectTypeTag(projectType: string | undefined): ElementPlusTagType {
  if (!projectType) return 'info'
  const typeMap: Record<string, ElementPlusTagType> = {
    场站: 'primary',
    线性: 'success',
    工民建: 'warning',
  }
  return typeMap[projectType] || 'info'
}

// 获取板块数量
function getBlockCount(preset: EventPreset) {
  return preset.blocks?.length || 0
}

// 获取事件总数
function getEventCount(preset: EventPreset) {
  let count = 0
  preset.blocks?.forEach((blockRef) => {
    const block = allBlocks.value.find((b: EventBlock) => b.id === blockRef.blockId)
    if (block) {
      count += block.events?.length || 0
    }
  })
  return count
}

// 获取板块详情
function getBlockDetail(blockId: string | null) {
  if (!blockId) return null
  return allBlocks.value.find((b: EventBlock) => b.id === blockId)
}

// 获取分类下的板块
function getCategoryBlocks(categoryId: string) {
  return allBlocks.value.filter((b: EventBlock) => b.categoryId === categoryId)
}

// 检查板块是否已选择
function isBlockSelected(blockId: string) {
  return presetForm.value.blocks.some((b: PresetBlockRef) => b.blockId === blockId)
}

// 切换板块选择
function toggleBlockSelection(block: EventBlock) {
  const index = presetForm.value.blocks.findIndex((b: PresetBlockRef) => b.blockId === block.id)
  if (index > -1) {
    presetForm.value.blocks.splice(index, 1)
  } else {
    presetForm.value.blocks.push({
      blockId: block.id,
      sortOrder: presetForm.value.blocks.length,
      customName: block.name,
    })
  }
}

// 移除板块
function removeBlock(index: number) {
  presetForm.value.blocks.splice(index, 1)
}

// 上移板块
function moveBlockUp(index: number) {
  if (index === 0) return
  const temp = presetForm.value.blocks[index]
  presetForm.value.blocks[index] = presetForm.value.blocks[index - 1]
  presetForm.value.blocks[index - 1] = temp
}

// 下移板块
function moveBlockDown(index: number) {
  if (index === presetForm.value.blocks.length - 1) return
  const temp = presetForm.value.blocks[index]
  presetForm.value.blocks[index] = presetForm.value.blocks[index + 1]
  presetForm.value.blocks[index + 1] = temp
}

// 显示板块选择器
function showBlockSelector() {
  if (blockCategories.value.length > 0) {
    selectedCategory.value = blockCategories.value[0].id
  }
  blockSelectorVisible.value = true
}

// 加载预设列表
async function loadPresets() {
  try {
    const res = await api.get('/api/event-presets')
    if (res.data.success) {
      presets.value = res.data.data
    }
  } catch {
    ElMessage.error('加载预设方案失败')
  }
}

// 加载板块列表
async function loadBlocks() {
  try {
    const res = await api.get('/api/blocks')
    if (res.data.success) {
      allBlocks.value = res.data.data
    }
  } catch (error) {
    console.error('加载板块失败:', error)
  }
}

// 加载板块分类
async function loadBlockCategories() {
  try {
    const res = await api.get('/api/blocks/categories')
    if (res.data.success) {
      blockCategories.value = res.data.data
    }
  } catch (error) {
    console.error('加载板块分类失败:', error)
  }
}

// 重置表单
function resetForm() {
  presetForm.value = {
    id: '',
    name: '',
    implementationType: '' as string,
    projectType: '' as string,
    blocks: [],
    isDefault: false,
  }
  isEditingDefault.value = false
  presetFormRef.value?.clearValidate()
}

// 新建预设
function createPreset() {
  resetForm()
  dialogTitle.value = '新建预设'
  dialogVisible.value = true
}

// 编辑预设
function editPreset(preset: EventPreset) {
  resetForm()
  dialogTitle.value = `编辑预设: ${preset.name}`
  isEditingDefault.value = preset.isDefault || false

  presetForm.value = {
    id: preset.id,
    name: preset.name,
    implementationType: preset.implementationType ?? '',
    projectType: preset.projectType ?? '',
    blocks: JSON.parse(JSON.stringify(preset.blocks)), // 深拷贝
    isDefault: preset.isDefault || false,
  }

  dialogVisible.value = true
}

// 保存预设
async function handleSave() {
  if (!presetFormRef.value) return

  try {
    await presetFormRef.value.validate()

    if (presetForm.value.blocks.length === 0) {
      ElMessage.warning('请至少添加一个板块')
      return
    }

    saving.value = true

    const data = {
      id: presetForm.value.id || undefined,
      name: presetForm.value.name,
      implementationType: presetForm.value.implementationType,
      projectType: presetForm.value.projectType,
      blocks: presetForm.value.blocks,
    }

    await api.post('/api/event-presets', data)
    ElMessage.success(presetForm.value.id ? '更新成功' : '创建成功')
    dialogVisible.value = false
    await loadPresets()
  } catch (error) {
    const axiosError = error as { response?: { data?: { message?: string } } }
    if (axiosError.response?.data?.message) {
      ElMessage.error(axiosError.response.data.message)
    } else {
      ElMessage.error('保存失败')
    }
  } finally {
    saving.value = false
  }
}

// 删除预设
async function deletePreset(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除这个预设方案吗？', '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await api.delete('/api/event-presets', { params: { id } })
    ElMessage.success('删除成功')
    await loadPresets()
  } catch (error) {
    if (error !== 'cancel') {
      const axiosError = error as { response?: { data?: { message?: string } } }
      if (axiosError.response?.data?.message) {
        ElMessage.error(axiosError.response.data.message)
      } else {
        ElMessage.error('删除失败')
      }
    }
  }
}

onMounted(() => {
  loadPresets()
  loadBlocks()
  loadBlockCategories()
})
</script>

<style scoped>
/* ========== 预设方案管理页面 - YULI Design System ========== */

/* 预设方案网格 */
.yl-presets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--yl-gap-lg);
}

@media (max-width: 768px) {
  .yl-presets-grid {
    grid-template-columns: 1fr;
  }
}

/* 预设卡片 */
.yl-preset-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.yl-preset-card.is-default {
  border: 2px solid var(--yl-success);
}

.yl-preset-title {
  font-size: var(--yl-font-size-h4);
  font-weight: var(--yl-font-weight-semibold);
  color: var(--yl-text-primary);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 预设信息 */
.yl-preset-info {
  display: flex;
  flex-direction: column;
  gap: var(--yl-gap-md);
  flex: 1;
}

.yl-info-item {
  display: flex;
  align-items: center;
  gap: var(--yl-gap-xs);
  font-size: var(--yl-font-size-base);
}

.yl-info-label {
  color: var(--yl-text-secondary);
  margin-right: var(--yl-margin-xs);
}

.yl-info-value {
  font-weight: var(--yl-font-weight-semibold);
  color: var(--yl-primary);
}

/* 板块配置 */
.blocks-config {
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  padding: 16px;
  background-color: var(--el-fill-color-light);
}

.blocks-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.blocks-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.blocks-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.block-item {
  background: white;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 12px;
  transition: all 0.2s;
}

.block-item:hover {
  border-color: var(--el-color-primary);
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
}

.block-item-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.drag-handle {
  color: var(--el-text-color-secondary);
  cursor: move;
}

.block-order {
  font-weight: 600;
  color: var(--el-color-primary);
  min-width: 24px;
}

.block-name {
  flex: 1;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.block-item-actions {
  display: flex;
  gap: 4px;
}

.block-item-detail {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

/* 板块选择器 */
.block-selector-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 500px;
  overflow-y: auto;
}

.block-selector-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border: 2px solid var(--el-border-color-light);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background: white;
}

.block-selector-item:hover {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.block-selector-item.selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.block-selector-info {
  flex: 1;
}

.block-selector-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.block-selector-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.block-selector-desc {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin-top: 8px;
}

.selected-icon {
  color: var(--el-color-primary);
}

.duration {
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
</style>
