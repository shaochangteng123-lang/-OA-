<template>
  <div class="color-label-panel">
    <!-- 标题和操作按钮 -->
    <div class="panel-header">
      <span class="panel-title">颜色标签</span>
      <div class="panel-actions">
        <el-button v-if="!isEditing" text size="small" @click="isEditing = true"> 编辑 </el-button>
        <template v-else>
          <el-button text size="small" @click="handleResetToDefaults"> 恢复默认 </el-button>
          <el-button text size="small" type="primary" @click="handleSaveEdit"> 完成 </el-button>
        </template>
      </div>
    </div>

    <!-- 标签列表（可拖拽） -->
    <draggable
      v-model="localLabels"
      class="label-list"
      item-key="id"
      handle=".drag-handle"
      :disabled="!isEditing"
      animation="200"
      @end="handleDragEnd"
    >
      <template #item="{ element: label }">
        <div class="label-item-wrapper">
          <div class="label-item">
            <!-- 拖拽手柄（仅编辑模式显示） -->
            <div v-if="isEditing" class="drag-handle">
              <el-icon><DCaret /></el-icon>
            </div>

            <!-- 颜色预览 -->
            <div
              class="color-box"
              :style="{ background: label.color }"
              :class="{ clickable: isEditing, active: editingLabelId === label.id }"
              @click="isEditing && handleColorClick(label)"
            />

            <!-- 标签名称 -->
            <el-input
              v-if="isEditing"
              v-model="label.name"
              size="small"
              class="label-input"
              maxlength="10"
            />
            <span v-else class="label-name">{{ label.name }}</span>

            <!-- 删除按钮（仅编辑模式显示） -->
            <el-button
              v-if="isEditing"
              :icon="Close"
              size="small"
              text
              class="delete-button"
              @click="handleDeleteLabel(label)"
            />
          </div>
        </div>
      </template>
    </draggable>

    <!-- 优化模块32：颜色选择器固定在标签列表最下方 -->
    <div v-if="isEditing && editingLabelId" class="color-picker-section">
      <div class="color-picker-title">选择颜色</div>
      <div class="preset-colors">
        <div
          v-for="color in presetColors"
          :key="color"
          class="preset-color-item"
          :style="{ background: color }"
          :class="{ active: editingLabel?.color === color }"
          @click="handleColorSelect(editingLabel!, color)"
        />
      </div>
      <el-input
        v-if="editingLabel"
        v-model="editingLabel.color"
        size="small"
        placeholder="#3b82f6"
        class="color-input"
      >
        <template #prepend>自定义</template>
      </el-input>
    </div>

    <!-- 添加按钮（仅编辑模式显示） -->
    <div v-if="isEditing" class="panel-footer">
      <el-button size="small" text :icon="Plus" style="width: 100%" @click="handleAddLabel">
        添加标签
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, inject, watch, computed, type Ref } from 'vue'
import { Plus, Close, DCaret } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import draggable from 'vuedraggable'
import { nanoid } from 'nanoid'
import { api } from '@/utils/api'
import type { ColorLabel } from '@/types/calendar'
import { DEFAULT_COLOR_LABELS } from '@/types/calendar'

// Inject 父组件状态
const colorLabels = inject<Ref<ColorLabel[]>>('colorLabels')!

// 本地标签列表（用于编辑）
const localLabels = ref<ColorLabel[]>([])
const isEditing = ref(false) // 编辑模式状态
const saving = ref(false)

// 优化模块32：当前正在编辑颜色的标签ID
const editingLabelId = ref<string | null>(null)

// 当前编辑的标签
const editingLabel = computed(() => {
  if (!editingLabelId.value) return null
  return localLabels.value.find(l => l.id === editingLabelId.value) || null
})

// 预设颜色
const presetColors = [
  '#3b82f6', // 蓝色
  '#f59e0b', // 橙色
  '#ef4444', // 红色
  '#10b981', // 绿色
  '#8b5cf6', // 紫色
  '#ec4899', // 粉色
  '#06b6d4', // 青色
  '#f97316', // 深橙
  '#84cc16', // 黄绿
  '#6366f1', // 靛蓝
  '#14b8a6', // 青绿
  '#a855f7', // 紫罗兰
]

// 监听 colorLabels 变化，同步到本地
watch(
  colorLabels,
  (newLabels) => {
    localLabels.value = JSON.parse(JSON.stringify(newLabels))
  },
  { immediate: true, deep: true }
)

// 拖拽结束
function handleDragEnd() {
  // 更新顺序
  localLabels.value.forEach((label, index) => {
    label.order = index
  })
}

// 添加标签
function handleAddLabel() {
  const newLabel: ColorLabel = {
    id: `label-${nanoid(8)}`,
    name: '新标签',
    color: presetColors[Math.floor(Math.random() * presetColors.length)],
    order: localLabels.value.length,
    showColorPicker: false,
  }
  localLabels.value.push(newLabel)
}

// 删除标签
async function handleDeleteLabel(label: ColorLabel) {
  try {
    await ElMessageBox.confirm(`确定要删除标签"${label.name}"吗？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })

    localLabels.value = localLabels.value.filter((l) => l.id !== label.id)
    // 重新排序
    localLabels.value.forEach((l, index) => {
      l.order = index
    })
  } catch {
    // 用户取消
  }
}

// 恢复默认标签
async function handleResetToDefaults() {
  try {
    await ElMessageBox.confirm('确定要恢复到默认标签吗？所有自定义标签将被删除。', '恢复默认', {
      confirmButtonText: '恢复',
      cancelButtonText: '取消',
      type: 'warning',
    })

    localLabels.value = JSON.parse(JSON.stringify(DEFAULT_COLOR_LABELS))
  } catch {
    // 用户取消
  }
}

// 优化模块32：点击颜色预览，切换编辑的标签
function handleColorClick(label: ColorLabel) {
  if (editingLabelId.value === label.id) {
    editingLabelId.value = null // 再次点击关闭
  } else {
    editingLabelId.value = label.id // 打开此标签的颜色选择
  }
}

// 选择预设颜色
function handleColorSelect(label: ColorLabel, color: string) {
  label.color = color
  // 选择后不关闭，方便用户继续调整
}

// 检查是否有修改
function hasChanges(): boolean {
  if (localLabels.value.length !== colorLabels.value.length) return true

  for (let i = 0; i < localLabels.value.length; i++) {
    const local = localLabels.value[i]
    const original = colorLabels.value.find((l) => l.id === local.id)
    if (!original) return true
    if (local.name !== original.name) return true
    if (local.color !== original.color) return true
    if (local.order !== original.order) return true
  }
  return false
}

// 保存并退出编辑模式（优化模块30：无修改时不提示）
async function handleSaveEdit() {
  // 如果没有修改，直接退出编辑模式，不提示
  if (!hasChanges()) {
    isEditing.value = false
    return
  }

  try {
    saving.value = true

    // 移除临时属性
    const labelsToSave = localLabels.value.map((label) => ({
      id: label.id,
      name: label.name.trim() || '未命名',
      color: label.color,
      order: label.order,
    }))

    const response = await api.put('/api/user-preferences', {
      colorLabels: labelsToSave,
    })

    if (response.data.success) {
      // 更新父组件状态
      colorLabels.value = JSON.parse(JSON.stringify(labelsToSave))
      ElMessage.success('颜色标签已保存')
      isEditing.value = false // 退出编辑模式
    } else {
      ElMessage.error(response.data.message || '保存失败')
    }
  } catch (error) {
    console.error('保存颜色标签失败:', error)
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.color-label-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 面板标题 */
.panel-header {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  flex: 1;
}

.panel-actions {
  display: flex;
  gap: 4px;
  align-items: center;
  justify-content: flex-end;
}

.panel-actions :deep(.el-button) {
  font-size: 12px;
}

/* 标签列表 */
.label-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

/* 优化模块26：标签项包装器 */
.label-item-wrapper {
  display: flex;
  flex-direction: column;
  margin-bottom: 4px;
}

/* 标签项 */
.label-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.label-item:hover {
  background: #f5f6f8;
}

/* 优化模块32：颜色选择器固定在标签列表下方 */
.color-picker-section {
  padding: 12px 16px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  box-sizing: border-box;
}

.color-picker-title {
  font-size: 12px;
  color: #606266;
  margin-bottom: 8px;
}

/* 拖拽手柄 */
.drag-handle {
  cursor: move;
  color: #c0c4cc;
  display: flex;
  align-items: center;
  width: 16px; /* 固定宽度避免布局跳动 */
}

.drag-handle:hover {
  color: #909399;
}

/* 颜色盒子（优化模块13第6点：缩小至原尺寸的2/3） */
.color-box {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #e1e4e8;
  flex-shrink: 0;
  transition: transform 0.2s;
}

.color-box.clickable {
  cursor: pointer;
}

.color-box.clickable:hover {
  transform: scale(1.1);
}

/* 优化模块32：当前正在编辑颜色的标签高亮 */
.color-box.active {
  box-shadow: 0 0 0 2px #3b82f6;
}

/* 标签名称 */
.label-name {
  flex: 1;
  font-size: 13px;
  color: #303133;
  user-select: none;
}

.label-input {
  flex: 1;
}

.label-input :deep(.el-input__inner) {
  font-size: 13px;
  padding: 4px 8px;
  border-radius: 4px;
}

/* 删除按钮 */
.delete-button {
  opacity: 0;
  transition: opacity 0.2s;
}

.label-item:hover .delete-button {
  opacity: 1;
}

/* 优化模块27：预设颜色网格（修复溢出，每行4个） */
.preset-colors {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 8px;
}

.preset-color-item {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
}

.preset-color-item:hover {
  transform: scale(1.1);
  border-color: #2c5aa0;
}

.preset-color-item.active {
  border-color: #2c5aa0;
  box-shadow: 0 0 0 2px rgba(44, 90, 160, 0.2);
}

.color-input {
  width: 100%;
}

/* 面板底部 */
.panel-footer {
  padding: 12px 16px;
  border-top: 1px solid #e1e4e8;
}

.panel-footer .el-button {
  width: 100%;
}
</style>
