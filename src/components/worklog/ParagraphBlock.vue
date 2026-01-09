<template>
  <div class="paragraph-block">
    <slot />
  </div>
</template>

<script setup lang="ts">
// 简单段落块组件，用于TipTap编辑器
</script>

<style scoped>
.paragraph-block {
  margin: 8px 0;
  line-height: 1.6;
  color: #333;
}
</style>
