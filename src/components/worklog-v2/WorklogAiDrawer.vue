<template>
  <div>
    <el-button
      class="ai-fab"
      type="primary"
      circle
      :icon="ChatDotRound"
      size="large"
      @click="drawerVisible = true"
    />
    <el-drawer
      v-model="drawerVisible"
      title="AI 助手"
      size="460px"
      direction="rtl"
    >
      <div class="ai-panel">
        <el-select
          v-model="selectedProjectId"
          placeholder="选择要问的项目（可选）"
          filterable
          clearable
          style="margin-bottom: 10px"
          remote
          :remote-method="searchProjects"
          :loading="searching"
        >
          <el-option
            v-for="p in projectOptions"
            :key="p.id"
            :label="`${p.name}（${p.clientName}）`"
            :value="p.id"
          />
        </el-select>

        <div class="messages" ref="messagesEl">
          <div v-if="messages.length === 0" class="empty-hint">
            示例：<br/>
            - 某某项目的进度如何？<br/>
            - 当前有哪些超期事项？<br/>
            - 分析下项目的主要风险点
          </div>
          <div
            v-for="(m, i) in messages"
            :key="i"
            class="msg"
            :class="m.role"
          >
            <div class="bubble">{{ m.content }}</div>
          </div>
          <div v-if="loading" class="msg assistant"><div class="bubble">思考中…</div></div>
        </div>

        <div class="input-area">
          <el-input
            v-model="input"
            type="textarea"
            :rows="3"
            placeholder="请输入问题… (Ctrl+Enter 发送)"
            @keydown.ctrl.enter.prevent="handleSend"
          />
          <div class="actions">
            <el-button
              v-if="selectedProjectId"
              size="small"
              @click="handleAnalyzeRisk"
              :loading="analyzing"
            >
              风险分析
            </el-button>
            <el-button
              type="primary"
              size="small"
              :disabled="!input.trim()"
              :loading="loading"
              @click="handleSend"
            >
              发送
            </el-button>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { ChatDotRound } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api } from '@/utils/api'
import type { WorklogProject } from '@/types'

interface Message { role: 'user' | 'assistant'; content: string }

const drawerVisible = ref(false)
const messages = ref<Message[]>([])
const input = ref('')
const loading = ref(false)
const analyzing = ref(false)
const messagesEl = ref<HTMLElement | null>(null)

const selectedProjectId = ref<string>('')
const projectOptions = ref<WorklogProject[]>([])
const searching = ref(false)

async function searchProjects(keyword: string) {
  searching.value = true
  try {
    const resp = await api.get('/api/worklog-projects', { params: keyword ? { q: keyword } : {} })
    if (resp.data.success) projectOptions.value = resp.data.data
  } finally {
    searching.value = false
  }
}

async function handleSend() {
  const text = input.value.trim()
  if (!text) return
  messages.value.push({ role: 'user', content: text })
  input.value = ''
  loading.value = true
  await scrollToBottom()
  try {
    const resp = await api.post('/api/worklog-ai/chat', {
      message: text,
      projectId: selectedProjectId.value || undefined,
    })
    if (resp.data.success) {
      messages.value.push({ role: 'assistant', content: resp.data.data.answer })
    } else {
      messages.value.push({ role: 'assistant', content: `出错：${resp.data.message}` })
    }
  } catch (err: any) {
    const msg = err?.response?.data?.message || 'AI 服务暂不可用，请稍后重试'
    messages.value.push({ role: 'assistant', content: msg })
  } finally {
    loading.value = false
    await scrollToBottom()
  }
}

async function handleAnalyzeRisk() {
  if (!selectedProjectId.value) return
  analyzing.value = true
  try {
    const resp = await api.post(`/api/worklog-ai/analyze-risk/${selectedProjectId.value}`)
    if (resp.data.success) {
      const items = resp.data.data as Array<{ matter: string; level: string; message: string }>
      if (items.length === 0) {
        messages.value.push({ role: 'assistant', content: '✓ 暂无明显风险点' })
      } else {
        const text = items.map(x => `【${x.level.toUpperCase()}】${x.matter}：${x.message}`).join('\n')
        messages.value.push({ role: 'assistant', content: text })
      }
    } else {
      ElMessage.error(resp.data.message || '风险分析失败')
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '风险分析失败')
  } finally {
    analyzing.value = false
    await scrollToBottom()
  }
}

async function scrollToBottom() {
  await nextTick()
  const el = messagesEl.value
  if (el) el.scrollTop = el.scrollHeight
}
</script>

<style scoped>
.ai-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 100;
  width: 56px;
  height: 56px;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.4);
}

.ai-panel { display: flex; flex-direction: column; height: 100%; padding: 0 4px; }
.messages { flex: 1; overflow-y: auto; padding: 10px 0; display: flex; flex-direction: column; gap: 8px; }
.empty-hint { color: #999; font-size: 13px; padding: 20px 12px; background: #fafafa; border-radius: 6px; line-height: 1.8; }

.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.msg.assistant { justify-content: flex-start; }

.bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
.msg.user .bubble { background: #409eff; color: #fff; }
.msg.assistant .bubble { background: #f4f4f5; color: #303133; }

.input-area { padding-top: 10px; border-top: 1px solid #ebeef5; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
