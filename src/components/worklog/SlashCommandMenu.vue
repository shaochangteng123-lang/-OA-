<template>
  <div v-if="items.length > 0" class="slash-menu" :style="menuStyle">
    <div
      v-for="(item, index) in items"
      :key="index"
      class="slash-menu-item"
      :class="{ 'is-selected': index === selectedIndex }"
      @click="selectItem(index)"
      @mouseenter="selectedIndex = index"
    >
      <div class="item-icon">{{ item.icon }}</div>
      <div class="item-content">
        <div class="item-title">{{ item.title }}</div>
        <div class="item-description">{{ item.description }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

export interface SlashCommandItem {
  title: string
  description: string
  icon: string
  command: () => void
}

const props = defineProps<{
  items: SlashCommandItem[]
  position?: { top: number; left: number }
}>()

const emit = defineEmits<{
  select: [item: SlashCommandItem]
}>()

const selectedIndex = ref(0)

const menuStyle = computed(() => {
  if (!props.position) return {} as Record<string, string>
  return {
    position: 'fixed',
    top: `${props.position.top}px`,
    left: `${props.position.left}px`,
  } as Record<string, string>
})

function selectItem(index: number) {
  emit('select', props.items[index])
}

function onKeyDown(event: KeyboardEvent) {
  if (props.items.length === 0) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % props.items.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + props.items.length) % props.items.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    selectItem(selectedIndex.value)
  }
}

watch(
  () => props.items,
  () => {
    selectedIndex.value = 0
  }
)

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.slash-menu {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  padding: 4px;
  min-width: 280px;
  max-height: 400px;
  overflow-y: auto;
  z-index: 1000;
}

.slash-menu-item {
  display: flex;
  align-items: flex-start;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
  gap: 12px;
}

.slash-menu-item:hover,
.slash-menu-item.is-selected {
  background: #f3f4f6;
}

.item-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 2px;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  margin-bottom: 2px;
}

.item-description {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.4;
}

/* 滚动条样式 */
.slash-menu::-webkit-scrollbar {
  width: 6px;
}

.slash-menu::-webkit-scrollbar-track {
  background: transparent;
}

.slash-menu::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 3px;
}

.slash-menu::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}
</style>
