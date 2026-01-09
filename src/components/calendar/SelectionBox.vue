<template>
  <div
    class="selection-box"
    :style="{
      top: `${selection.top}px`,
      height: `${selection.height}px`,
      left: selection.column !== undefined ? `${selection.column * columnWidth}%` : '0',
      width: selection.column !== undefined ? `${columnWidth}%` : '100%',
    }"
  />
</template>

<script setup lang="ts">
import type { SelectionBox } from '@/types/calendar'

interface Props {
  selection: SelectionBox
  columnWidth?: number
}

withDefaults(defineProps<Props>(), {
  columnWidth: 14.28, // 100 / 7 days for week view
})
</script>

<style scoped>
.selection-box {
  position: absolute;
  background-color: rgba(59, 130, 246, 0.2);
  border: none;
  border-radius: 0;
  pointer-events: none;
  z-index: 10;
  transition: none;
}
</style>
