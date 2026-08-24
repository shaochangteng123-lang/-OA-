<template>
  <article
    class="contract-metric-card"
    :class="[`tone-${tone}`, { clickable }]"
    :tabindex="clickable ? 0 : undefined"
    :role="clickable ? 'button' : undefined"
    @click="handleActivate"
    @keydown.enter.prevent="handleActivate"
    @keydown.space.prevent="handleActivate"
  >
    <div class="metric-topline">
      <span class="metric-icon"
        ><el-icon><component :is="icon" /></el-icon
      ></span>
      <span v-if="badge" class="metric-badge">{{ badge }}</span>
    </div>
    <span class="metric-label">{{ label }}</span>
    <div v-if="details.length" class="metric-details">
      <div v-for="item in details" :key="item.label">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </div>
    </div>
    <strong v-else class="metric-value">{{ value }}</strong>
    <small class="metric-note">{{ note }}</small>
  </article>
</template>

<script setup lang="ts">
import type { Component } from "vue";

const props = withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    note: string;
    icon: Component;
    tone?: "navy" | "cyan" | "green" | "amber" | "red" | "violet";
    badge?: string;
    clickable?: boolean;
    details?: Array<{ label: string; value: string | number }>;
  }>(),
  {
    tone: "navy",
    badge: "",
    clickable: false,
    details: () => [],
  },
);

const emit = defineEmits<{ activate: [] }>();

function handleActivate() {
  if (props.clickable) emit("activate");
}
</script>

<style scoped>
.contract-metric-card {
  --metric-color: #315f8d;
  --metric-soft: #e8eff6;
  position: relative;
  min-width: 0;
  min-height: 154px;
  overflow: hidden;
  padding: 18px;
  border: 1px solid rgb(222 229 236 / 92%);
  border-radius: 12px;
  background: linear-gradient(145deg, #fff, #f9fbfd);
  box-shadow: 0 10px 28px rgb(31 49 68 / 6%);
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.contract-metric-card::after {
  position: absolute;
  top: -50px;
  right: -45px;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--metric-soft), transparent 68%);
  content: "";
}

.contract-metric-card.clickable {
  cursor: pointer;
}

.contract-metric-card.clickable:hover,
.contract-metric-card.clickable:focus-visible {
  border-color: color-mix(in srgb, var(--metric-color) 35%, #dfe5eb);
  box-shadow: 0 16px 34px rgb(28 45 65 / 11%);
  outline: none;
  transform: translateY(-3px);
}

.metric-topline {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.metric-icon {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--metric-soft);
  color: var(--metric-color);
  font-size: 20px;
}

.metric-badge {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--metric-soft);
  color: var(--metric-color);
  font-size: 11px;
  font-weight: 600;
}

.metric-label,
.metric-value,
.metric-note {
  position: relative;
  z-index: 1;
  display: block;
}

.metric-details {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 9px;
}

.metric-details > div {
  min-width: 0;
}

.metric-details span,
.metric-details strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-details span {
  color: #8a98a5;
  font-size: 10px;
}

.metric-details strong {
  margin-top: 3px;
  color: #1c3349;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.metric-label {
  margin-top: 13px;
  color: #778493;
  font-size: 12px;
}

.metric-value {
  margin-top: 4px;
  overflow: hidden;
  color: #1c3349;
  font-size: clamp(20px, 2vw, 28px);
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-note {
  margin-top: 6px;
  color: #8e9aa6;
  font-size: 11px;
}

.tone-cyan {
  --metric-color: #168f92;
  --metric-soft: #e6f5f4;
}
.tone-green {
  --metric-color: #4f8d64;
  --metric-soft: #eaf5ed;
}
.tone-amber {
  --metric-color: #b97731;
  --metric-soft: #fcf2e7;
}
.tone-red {
  --metric-color: #bd4b4b;
  --metric-soft: #faecec;
}
.tone-violet {
  --metric-color: #7257b6;
  --metric-soft: #f0ecfa;
}

@media (prefers-reduced-motion: reduce) {
  .contract-metric-card {
    transition: none;
  }
}
</style>
