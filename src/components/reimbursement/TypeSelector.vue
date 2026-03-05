<template>
  <div class="type-selector">
    <!-- 行政办公 -->
    <div class="category-section">
      <h4 class="category-title">行政办公</h4>
      <div class="type-grid">
        <div
          v-for="type in adminTypes"
          :key="type.value"
          class="type-card"
          :class="{ selected: modelValue === type.value }"
          @click="selectType(type.value)"
        >
          <span class="type-label">{{ type.label }}</span>
        </div>
      </div>
    </div>

    <!-- 三方服务 -->
    <div class="category-section">
      <h4 class="category-title">三方服务</h4>
      <div class="type-grid">
        <div
          v-for="type in serviceTypes"
          :key="type.value"
          class="type-card"
          :class="{ selected: modelValue === type.value }"
          @click="selectType(type.value)"
        >
          <span class="type-label">{{ type.label }}</span>
        </div>
      </div>
    </div>

    <!-- 业务提升 -->
    <div class="category-section">
      <h4 class="category-title">业务提升</h4>
      <div class="type-grid">
        <div
          v-for="type in businessTypes"
          :key="type.value"
          class="type-card"
          :class="{ selected: modelValue === type.value }"
          @click="selectType(type.value)"
        >
          <span class="type-label">{{ type.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ADMIN_TYPES,
  SERVICE_TYPES,
  BUSINESS_TYPES,
} from '@/utils/reimbursement/constants'

// Props
defineProps<{
  modelValue: string
}>()

// Emits
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'select', value: string): void
}>()

// 类型数据
const adminTypes = ADMIN_TYPES
const serviceTypes = SERVICE_TYPES
const businessTypes = BUSINESS_TYPES

// 选择类型
function selectType(value: string): void {
  emit('update:modelValue', value)
  emit('select', value)
}
</script>

<style scoped>
.type-selector {
  width: 100%;
}

.category-section {
  margin-bottom: 32px;
}

.category-title {
  font-size: 16px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 16px;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 16px;
}

.type-card {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 20px;
  border: 2px solid #dcdfe6;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  background: #fff;
  min-height: 56px;
}

.type-card:hover {
  border-color: #409eff;
  background: #ecf5ff;
  box-shadow: 0 2px 12px rgba(64, 158, 255, 0.2);
  transform: translateY(-2px);
}

.type-card.selected {
  border-color: #409eff;
  background: #ecf5ff;
  box-shadow: 0 2px 12px rgba(64, 158, 255, 0.3);
}

.type-label {
  font-size: 15px;
  color: #303133;
  font-weight: 500;
  text-align: center;
}
</style>
