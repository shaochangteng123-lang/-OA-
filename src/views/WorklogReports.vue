<template>
  <div class="reports-center">
    <div class="page-header">
      <h2>日志中心</h2>
      <p class="subtitle">按周生成项目周报 / 单个项目生成结题报告，大模型辅助总结</p>
    </div>

    <el-alert v-if="!canDownloadWeekly" type="warning" :closable="false" show-icon style="margin-bottom: 16px">
      当前账号无周报下载权限，请联系超级管理员添加权限
    </el-alert>

    <el-card shadow="never" class="block">
      <template #header>项目周报（单项目）</template>
      <el-form inline>
        <el-form-item label="项目">
          <el-select
            v-model="singleProjectId"
            filterable
            placeholder="选择项目"
            remote
            :remote-method="searchProjects"
            :loading="searching"
            style="width: 280px"
          >
            <el-option
              v-for="p in projectOptions"
              :key="p.id"
              :label="`${p.name}（${p.clientName}）`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="周期">
          <el-date-picker
            v-model="singleRange"
            type="daterange"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :disabled="!canDownloadWeekly || !singleProjectId || !singleRange || !singleRange[0]"
            :loading="generating"
            @click="handleGenerateWeekly"
          >
            生成周报
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>批量周报（打包 ZIP）</template>
      <el-form inline>
        <el-form-item label="周期">
          <el-date-picker
            v-model="batchRange"
            type="daterange"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :disabled="!canDownloadWeekly || !batchRange || !batchRange[0]"
            :loading="batchGenerating"
            @click="handleGenerateBatch"
          >
            批量生成
          </el-button>
        </el-form-item>
      </el-form>
      <div class="hint">该时间段内有日志的所有项目，每个项目生成一份 .docx，打包成 ZIP 下载。</div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/utils/api'
import type { WorklogProject } from '@/types'

const singleProjectId = ref('')
const singleRange = ref<[string, string] | null>(null)
const batchRange = ref<[string, string] | null>(null)
const generating = ref(false)
const batchGenerating = ref(false)

const projectOptions = ref<WorklogProject[]>([])
const searching = ref(false)
const canDownloadWeekly = ref(false)

onMounted(async () => {
  try {
    const resp = await api.get('/api/worklog-permissions/me')
    if (resp.data.success) canDownloadWeekly.value = !!resp.data.data.downloadWeeklyReport
  } catch { /* ignore */ }
  searchProjects('')
})

async function searchProjects(keyword: string) {
  searching.value = true
  try {
    const resp = await api.get('/api/worklog-projects', { params: keyword ? { q: keyword } : {} })
    if (resp.data.success) projectOptions.value = resp.data.data
  } finally {
    searching.value = false
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

async function parseBlobError(blob: Blob | undefined): Promise<string | null> {
  if (!blob) return null
  try {
    const text = await blob.text()
    return JSON.parse(text)?.message || null
  } catch { return null }
}

async function handleGenerateWeekly() {
  if (!singleProjectId.value || !singleRange.value) return
  generating.value = true
  try {
    const resp = await api.post('/api/worklog-reports/weekly', {
      projectId: singleProjectId.value,
      startDate: singleRange.value[0],
      endDate: singleRange.value[1],
    }, { responseType: 'blob' })
    const project = projectOptions.value.find(p => p.id === singleProjectId.value)
    const blob = new Blob([resp.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    triggerDownload(blob, `${project?.name || '项目'}_周报_${singleRange.value[0]}_${singleRange.value[1]}.docx`)
    ElMessage.success('周报已生成')
  } catch (err: any) {
    const msg = await parseBlobError(err?.response?.data) || err?.response?.data?.message || '生成失败'
    ElMessage.error(msg)
  } finally {
    generating.value = false
  }
}

async function handleGenerateBatch() {
  if (!batchRange.value) return
  batchGenerating.value = true
  try {
    const resp = await api.post('/api/worklog-reports/weekly/batch', {
      startDate: batchRange.value[0],
      endDate: batchRange.value[1],
    }, { responseType: 'blob' })
    const blob = new Blob([resp.data], { type: 'application/zip' })
    triggerDownload(blob, `批量周报_${batchRange.value[0]}_${batchRange.value[1]}.zip`)
    ElMessage.success('批量周报已打包下载')
  } catch (err: any) {
    const msg = await parseBlobError(err?.response?.data) || err?.response?.data?.message || '批量生成失败'
    ElMessage.error(msg)
  } finally {
    batchGenerating.value = false
  }
}
</script>

<style scoped>
.reports-center {
  padding: 0 16px;
  margin-left: calc(-1 * var(--yl-main-padding-x, 45px));
  margin-right: calc(-1 * var(--yl-main-padding-x, 45px));
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.page-header h2 { margin: 0; }
.subtitle { color: #909399; margin: 4px 0 16px 0; font-size: 13px; }
.block { margin: 0; }
.hint { color: #909399; font-size: 12px; margin-top: -4px; }
</style>
