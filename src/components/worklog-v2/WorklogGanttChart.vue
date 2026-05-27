<template>
  <div class="gantt-chart" v-loading="loading">
    <div v-if="!projectId" class="empty-hint">选择一个项目查看进度甘特图</div>
    <div v-else-if="matters.length === 0 && !loading" class="empty-hint">
      该项目暂无日志数据
    </div>
    <div v-else class="gantt-body">
      <div class="gantt-summary">
        <strong>{{ project?.name }}</strong>
        <span>甲方：{{ project?.clientName }}</span>
        <span>{{ project?.district }}</span>
        <span>负责人：{{ project?.ownerName }}</span>
      </div>
      <div class="gantt-rows">
        <div v-for="m in matters" :key="m.matter" class="gantt-row">
          <div class="row-label">
            <el-icon v-if="m.isFinalized" color="#67c23a"><CircleCheckFilled /></el-icon>
            <el-icon v-else-if="m.isOverdue" color="#f56c6c"><Warning /></el-icon>
            <el-icon v-else color="#909399"><Clock /></el-icon>
            {{ m.matter }}
          </div>
          <div class="row-bar-wrap">
            <div
              class="row-bar"
              :class="{ overdue: m.isOverdue, finalized: m.isFinalized }"
              :style="{ width: barWidth(m) }"
            >
              <span class="bar-text">{{ m.daysElapsed }} 天</span>
            </div>
            <div
              v-if="m.standardDays"
              class="std-marker"
              :style="{ left: stdMarkerPos(m) }"
              :title="`标准: ${m.standardDays} 天`"
            ></div>
          </div>
          <div class="row-meta">
            <span v-if="m.standardDays">标准 {{ m.standardDays }} 天</span>
            <span v-else>—</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Clock, CircleCheckFilled, Warning } from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import type { WorklogGanttMatter, WorklogProject } from '@/types'

const props = defineProps<{ projectId: string | null }>()

const loading = ref(false)
const project = ref<WorklogProject | null>(null)
const matters = ref<WorklogGanttMatter[]>([])

const maxDays = computed(() => {
  const vals = matters.value.map(m => Math.max(m.daysElapsed, m.standardDays || 0))
  return Math.max(30, ...vals)
})

function barWidth(m: WorklogGanttMatter): string {
  const pct = (m.daysElapsed / maxDays.value) * 100
  return `${Math.min(100, pct)}%`
}
function stdMarkerPos(m: WorklogGanttMatter): string {
  if (!m.standardDays) return '0'
  const pct = (m.standardDays / maxDays.value) * 100
  return `${Math.min(100, pct)}%`
}

watch(() => props.projectId, async (id) => {
  if (!id) { matters.value = []; project.value = null; return }
  loading.value = true
  try {
    const resp = await api.get(`/api/worklog-projects/${id}/gantt`)
    if (resp.data.success) {
      project.value = resp.data.data.project
      matters.value = resp.data.data.matters
    }
  } finally {
    loading.value = false
  }
}, { immediate: true })
</script>

<style scoped>
.gantt-chart { padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #ebeef5; min-height: 120px; }
.empty-hint { text-align: center; color: #999; padding: 30px 0; font-size: 13px; }

.gantt-summary { display: flex; gap: 14px; font-size: 13px; color: #606266; padding-bottom: 10px; border-bottom: 1px dashed #ebeef5; margin-bottom: 10px; align-items: center; flex-wrap: wrap; }
.gantt-summary strong { font-size: 15px; color: #303133; }

.gantt-rows { display: flex; flex-direction: column; gap: 8px; }
.gantt-row { display: grid; grid-template-columns: 200px 1fr 90px; align-items: center; gap: 12px; }
.row-label { font-size: 13px; color: #303133; display: flex; align-items: center; gap: 6px; }

.row-bar-wrap { position: relative; background: #f0f2f5; height: 22px; border-radius: 4px; overflow: visible; }
.row-bar {
  height: 100%;
  background: linear-gradient(90deg, #409eff, #66b1ff);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 8px;
  color: #fff;
  font-size: 12px;
  min-width: 36px;
  transition: width 0.3s;
}
.row-bar.overdue { background: linear-gradient(90deg, #f56c6c, #f78989); }
.row-bar.finalized { background: linear-gradient(90deg, #67c23a, #85ce61); }
.bar-text { text-shadow: 0 0 2px rgba(0, 0, 0, 0.3); }

.std-marker {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  background: #e6a23c;
  cursor: help;
}
.std-marker::after {
  content: '标';
  position: absolute;
  top: -14px;
  left: -7px;
  font-size: 10px;
  color: #e6a23c;
}

.row-meta { font-size: 12px; color: #909399; text-align: right; }
</style>
