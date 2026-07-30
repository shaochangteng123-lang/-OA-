<template>
  <div class="yl-page hr-approval-center">
    <section class="approval-summary">
      <div class="summary-item is-total">
        <span class="summary-icon">
          <el-icon><Stamp /></el-icon>
        </span>
        <span class="summary-content">
          <span class="summary-label">待处理合计</span>
          <strong>{{ totalPending }}</strong>
        </span>
      </div>

      <div class="summary-item">
        <span class="summary-icon probation">
          <el-icon><UserFilled /></el-icon>
        </span>
        <span class="summary-content">
          <span class="summary-label">转正待签</span>
          <strong>{{ pendingStore.counts.probationPending }}</strong>
        </span>
      </div>

      <div class="summary-item">
        <span class="summary-icon leave">
          <el-icon><Calendar /></el-icon>
        </span>
        <span class="summary-content">
          <span class="summary-label">请假待审</span>
          <strong>{{ pendingStore.counts.leaveApprovalPending }}</strong>
        </span>
      </div>
    </section>

    <section class="approval-workbench">
      <div class="workbench-toolbar">
        <div class="module-switch">
          <button
            v-for="item in moduleOptions"
            :key="item.name"
            class="module-tab"
            :class="{ active: activeModule === item.name }"
            type="button"
            @click="switchModule(item.name)"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
            <em v-if="item.count > 0">{{ item.count }}</em>
          </button>
        </div>

        <el-tooltip content="刷新当前列表" placement="top">
          <el-button
            class="refresh-button"
            :icon="Refresh"
            :loading="refreshing"
            circle
            @click="refreshCurrent"
          />
        </el-tooltip>
      </div>

      <div class="module-panel">
        <GMProbationApproval
          v-show="activeModule === 'probation'"
          ref="probationRef"
        />
        <LeavePendingList
          v-show="activeModule === 'leave'"
          ref="leaveRef"
          @approved="handleModuleUpdated"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Calendar, Refresh, Stamp, UserFilled } from "@element-plus/icons-vue";
import GMProbationApproval from "@/views/GMProbationApproval.vue";
import LeavePendingList from "@/components/leave/LeavePendingList.vue";
import { usePendingStore } from "@/stores/pending";

const activeModule = ref("probation");
const refreshing = ref(false);
const probationRef = ref<InstanceType<typeof GMProbationApproval>>();
const leaveRef = ref<InstanceType<typeof LeavePendingList>>();
const pendingStore = usePendingStore();

const totalPending = computed(
  () =>
    (pendingStore.counts.probationPending || 0) +
    (pendingStore.counts.leaveApprovalPending || 0),
);

const moduleOptions = computed(() => [
  {
    name: "probation",
    label: "转正审批",
    count: pendingStore.counts.probationPending || 0,
    icon: UserFilled,
  },
  {
    name: "leave",
    label: "请假审批",
    count: pendingStore.counts.leaveApprovalPending || 0,
    icon: Calendar,
  },
]);

function switchModule(moduleName: string) {
  activeModule.value = moduleName;
}

async function handleModuleUpdated() {
  await pendingStore.refreshPendingCounts();
}

async function refreshCurrent() {
  refreshing.value = true;
  try {
    await pendingStore.refreshPendingCounts();
    if (activeModule.value === "probation") {
      await probationRef.value?.refresh?.();
    } else {
      await leaveRef.value?.refresh?.();
    }
  } finally {
    refreshing.value = false;
  }
}

onMounted(async () => {
  await pendingStore.fetchPendingCounts();
  if (
    pendingStore.counts.probationPending === 0 &&
    pendingStore.counts.leaveApprovalPending > 0
  ) {
    activeModule.value = "leave";
  }
});
</script>

<style scoped>
.hr-approval-center {
  width: auto;
  max-width: none;
  height: calc(100vh - 60px);
  min-height: calc(100vh - 60px);
  margin: 0;
  padding: 12px 12px 0;
  gap: 12px;
  overflow-y: auto;
  background: linear-gradient(180deg, #f7f9fc 0%, #ffffff 180px), #ffffff;
}

.approval-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  flex: none;
  min-width: 0;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  min-height: 72px;
  padding: 12px 16px;
  border: 1px solid #e6ebf2;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 5px 14px rgba(36, 55, 86, 0.05);
  color: inherit;
  text-align: left;
}

.summary-item.is-total {
  background: #f9fbff;
}

.summary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background: #e8f3f8;
  color: #2c5aa0;
  font-size: 19px;
  flex: none;
}

.summary-icon.probation {
  background: #eff1f4;
  color: #56616d;
}

.summary-icon.leave {
  background: #e8f5eb;
  color: #52a566;
}

.summary-content {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.summary-label {
  color: #6b7785;
  font-size: 13px;
  font-weight: 600;
}

.summary-content strong {
  color: #1f2d3d;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
}

.approval-workbench {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  border: 1px solid #e8eaed;
  border-radius: 6px 6px 0 0;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(36, 55, 86, 0.05);
  overflow: hidden;
}

.workbench-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 0 12px;
  border-bottom: 1px solid #edf0f5;
  background: #fbfcfe;
  flex: none;
}

.module-switch {
  display: flex;
  align-items: center;
  align-self: stretch;
  gap: 22px;
  min-width: 0;
}

.module-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 51px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: #606f7f;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.18s ease;
}

.module-tab:hover {
  color: #2c5aa0;
}

.module-tab.active {
  color: #2c5aa0;
}

.module-tab.active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: #409eff;
  content: "";
}

.module-tab em {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #f56c6c;
  color: #ffffff;
  font-size: 12px;
  font-style: normal;
  line-height: 20px;
  text-align: center;
}

.refresh-button {
  flex: none;
}

.module-panel {
  flex: 1;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 360px;
  padding: 12px;
}

@media (max-width: 900px) {
  .approval-summary {
    gap: 6px;
  }

  .summary-item {
    gap: 8px;
    min-height: 64px;
    padding: 10px;
  }

  .summary-icon {
    width: 36px;
    height: 36px;
    font-size: 17px;
  }
}

@media (max-width: 640px) {
  .hr-approval-center {
    padding-top: 8px;
    gap: 8px;
  }

  .summary-label {
    font-size: 12px;
  }

  .summary-content strong {
    font-size: 20px;
  }

  .summary-icon {
    display: none;
  }

  .workbench-toolbar {
    min-height: 48px;
  }

  .module-tab {
    min-height: 47px;
  }
}
</style>
