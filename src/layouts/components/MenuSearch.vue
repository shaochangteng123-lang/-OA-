<template>
  <div class="menu-search">
    <el-input
      v-model="searchQuery"
      placeholder="搜索菜单..."
      :prefix-icon="Search"
      clearable
      @input="handleSearch"
      @clear="handleClear"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Search } from '@element-plus/icons-vue'

const searchQuery = ref('')

const handleSearch = (value: string) => {
  // 搜索逻辑可以在这里实现
  console.log('搜索:', value)
}

const handleClear = () => {
  searchQuery.value = ''
}
</script>

<style scoped>
.menu-search {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.menu-search :deep(.el-input) {
  --el-input-bg-color: var(--el-fill-color-light);
  --el-input-border-color: transparent;
}

.menu-search :deep(.el-input:hover) {
  --el-input-border-color: var(--el-border-color);
}

.menu-search :deep(.el-input__wrapper) {
  background-color: var(--el-fill-color-light);
  border-radius: 8px;
  transition: all 0.3s ease;
}

.menu-search :deep(.el-input__wrapper:hover) {
  background-color: var(--el-fill-color);
}

.menu-search :deep(.el-input__wrapper.is-focus) {
  background-color: var(--el-bg-color);
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}
</style>
