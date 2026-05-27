<template>
  <div />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElNotification } from 'element-plus'
import { api } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'

export interface FollowUpItem {
  id: string
  logDate: string
  projectName: string
  matter: string
  district: string
  nextFollowUpDate: string
  ownerName: string
}

const authStore = useAuthStore()
const reminderCount = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
let firstLoad = true

defineExpose({ reminderCount })

async function fetchReminders() {
  if (!authStore.user) return
  try {
    const resp = await api.get('/api/worklog-entries/reminders')
    if (resp.data.success) {
      const items: FollowUpItem[] = resp.data.data
      reminderCount.value = items.length

      if (firstLoad && items.length > 0) {
        firstLoad = false
        ElNotification({
          title: '项目跟进提醒',
          message: `您有 ${items.length} 个项目日志需要跟进沟通`,
          type: 'warning',
          duration: 8000,
        })
      }
    }
  } catch {
    // 静默失败
  }
}

onMounted(() => {
  fetchReminders()
  timer = setInterval(fetchReminders, 5 * 60 * 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>
