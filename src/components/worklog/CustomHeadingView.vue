<template>
  <node-view-wrapper class="custom-heading">
    <component
      :is="`h${node.attrs.level}`"
      :data-heading-type="node.attrs.headingType"
      :data-project-id="node.attrs.projectId"
      class="heading-content"
    >
      <node-view-content />
    </component>
  </node-view-wrapper>
</template>

<script setup lang="ts">
import { NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'

interface Props {
  node: {
    attrs: {
      level: number
      headingType: string
      projectId?: string
    }
  }
}

defineProps<Props>()
</script>

<style scoped>
.custom-heading {
  position: relative;
}

.heading-content {
  outline: none;
}
</style>
