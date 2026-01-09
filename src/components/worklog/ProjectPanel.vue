<template>
  <aside :class="['project-panel', { collapsed }]">
    <div class="panel-header">
      <h3 v-if="!collapsed">项目面板</h3>
      <el-button text @click="$emit('toggle')">
        <el-icon><Fold /></el-icon>
      </el-button>
    </div>
    <div v-if="!collapsed" class="panel-content">
      <div v-for="project in projects" :key="project.id" class="project-item">
        <div
          :class="[
            'project-name',
            {
              active: project.id === activeProjectId,
              disabled: addedProjectIds.includes(project.id),
            },
          ]"
          @click="!addedProjectIds.includes(project.id) && $emit('add-project', project)"
        >
          {{ project.name }}
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Fold } from '@element-plus/icons-vue'
import type { Project } from '@/types'

defineProps<{
  collapsed: boolean
  projects: Project[]
  addedProjectIds: string[]
  activeProjectId?: string | null
}>()

defineEmits<{
  toggle: []
  'add-project': [project: Project]
}>()
</script>

<style scoped>
.project-panel {
  width: 280px;
  background: var(--yl-bg-secondary);
  border-right: 1px solid var(--yl-border-light);
  transition: width var(--yl-transition-base);
}

.project-panel.collapsed {
  width: 60px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--yl-padding-md);
  border-bottom: 1px solid var(--yl-border-light);
}

.panel-content {
  padding: var(--yl-padding-sm);
}

.project-item {
  margin-bottom: var(--yl-margin-xs);
}

.project-name {
  padding: var(--yl-padding-sm);
  border-radius: var(--yl-radius-base);
  cursor: pointer;
  transition: background var(--yl-transition-fast);
  overflow: hidden;
  max-width: 100%;
}

.project-name:hover {
  background: var(--yl-bg-hover);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.project-name.active {
  background: var(--yl-primary-light);
  color: var(--yl-primary);
}

.project-name.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.project-name.disabled:hover {
  background: transparent;
}
</style>
