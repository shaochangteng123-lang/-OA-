<template>
  <el-tag :type="CONTRACT_STATUS_TYPES[status]" :effect="effect" :size="size">
    {{ CONTRACT_STATUS_LABELS[status] }}
  </el-tag>
</template>

<script setup lang="ts">
import type { ContractStatus } from "@/types/contract";
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TYPES,
} from "@/utils/contractPresentation";

withDefaults(
  defineProps<{
    status: ContractStatus;
    size?: "small" | "default" | "large";
    effect?: "dark" | "light" | "plain";
  }>(),
  {
    size: "default",
    effect: "light",
  },
);
</script>
