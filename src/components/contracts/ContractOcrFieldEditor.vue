<template>
  <div class="ocr-fields" aria-label="合同自动识别结果">
    <article
      v-for="field in fields"
      :key="field.key"
      class="ocr-field"
      :class="[
        `confidence-${confidenceTone(field)}`,
        { 'is-manually-confirmed': field.manuallyConfirmed },
        { 'is-declared-category': field.key === 'category' },
      ]"
    >
      <div class="field-heading">
        <div>
          <strong>{{ displayLabel(field) }}</strong>
          <span v-if="field.required" class="required-mark">必填</span>
          <span v-if="field.key === 'category'" class="declared-mark"
            >上传前已选择</span
          >
          <span v-if="field.manuallyConfirmed" class="manual-mark"
            >人工确认采用</span
          >
        </div>
        <div class="confidence-badge">
          <span class="confidence-dot"></span>
          {{ confidenceText(field) }}
        </div>
      </div>

      <div
        class="field-value"
        :class="{ empty: !String(field.value ?? '').trim() }"
      >
        {{ displayValue(field) }}
      </div>

      <div class="field-source">
        <span v-if="field.key === 'category'"
          >来源：上传合同前选择，不参与 OCR（光学字符识别）</span
        >
        <span v-if="field.key !== 'category' && field.pageNumber"
          >来源：第 {{ field.pageNumber }} 页</span
        >
        <span
          v-if="shouldShowEvidence(field)"
          class="evidence-text"
          :title="field.evidenceText || undefined"
          >{{ accepted ? "精准识别依据" : "未采用识别转写" }}：{{
            field.evidenceText
          }}</span
        >
        <span
          v-else-if="shouldShowRawText(field)"
          :title="field.rawText || undefined"
        >
          解析候选：{{ field.rawText }}
        </span>
        <span
          v-if="field.key !== 'category' && field.warning"
          class="field-warning"
          >{{ field.warning }}</span
        >
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import type {
  ContractOcrField,
  ContractCategory,
  ContractRelationType,
} from "@/types/contract";

const props = withDefaults(
  defineProps<{
    fields: ContractOcrField[];
    accepted?: boolean;
    declaredCategory?: ContractCategory | "";
    relationType?: ContractRelationType | "";
  }>(),
  {
    accepted: false,
    declaredCategory: "",
    relationType: "",
  },
);

function shouldHideVerboseRecognitionText(field: ContractOcrField): boolean {
  // 金额证据可能包含整页甚至整份合同的识别原文。页面只展示金额、页码、
  // 识别状态和必要告警，完整证据仍由服务端保存用于安全校验与审计。
  return field.key === "amount";
}

function shouldShowEvidence(field: ContractOcrField): boolean {
  if (field.key === "category" || !field.evidenceText) return false;
  return !shouldHideVerboseRecognitionText(field);
}

function shouldShowRawText(field: ContractOcrField): boolean {
  if (field.key === "category" || !field.rawText) return false;
  return !shouldHideVerboseRecognitionText(field);
}

const categoryLabels: Record<string, string> = {
  main_business: "主营项目合同",
  non_main: "非主营项目合同",
  asset: "资产类合同",
};

function confidenceTone(field: ContractOcrField): "high" | "medium" | "low" {
  if (field.key === "category") return "high";
  const confidence = field.confidence;
  if (props.accepted) return "high";
  if (isAutomaticallyAccepted(confidence)) return "high";
  if (confidence !== null && confidence > 0) return "medium";
  return "low";
}

function displayLabel(field: ContractOcrField): string {
  if (field.key === "project_name" && props.declaredCategory === "asset") {
    return "合同名称";
  }
  return field.label;
}

function isAutomaticallyAccepted(confidence: number | null): boolean {
  return confidence === 100;
}

function confidenceText(field: ContractOcrField): string {
  if (field.key === "category") return "上传前已选择";
  if (props.accepted) {
    if (!field.required && !String(field.value ?? "").trim()) {
      return "草拟阶段可留空";
    }
    if (field.manuallyConfirmed) return "人工确认采用";
    return "精准识别通过";
  }
  const confidence = field.confidence;
  if (isAutomaticallyAccepted(confidence)) return "自动独立验证通过";
  if (confidence === null) return "未形成诊断分（不是正确率）";
  return `诊断分 ${confidence}（不是正确率）`;
}

function displayValue(field: ContractOcrField): string {
  const value = String(
    field.key === "category" ? props.declaredCategory : (field.value ?? ""),
  ).trim();
  if (!value && field.key === "contract_date" && !field.required) {
    return "草拟阶段可留空，盖章归档时同步";
  }
  if (!value) return "系统未采用不可靠结果";
  if (field.key === "category") return categoryLabels[value] || value;
  if (field.key === "amount") return `¥ ${value}`;
  return value;
}
</script>

<style scoped>
.ocr-fields {
  display: grid;
  gap: 12px;
}
.ocr-field {
  position: relative;
  padding: 14px;
  border: 1px solid #e3e8ed;
  border-left-width: 4px;
  border-radius: 12px;
  background: #fff;
}
.confidence-high {
  border-left-color: #52a566;
}
.confidence-medium {
  border-left-color: #d9944e;
  background: #fffdf9;
}
.confidence-low {
  border-left-color: #c9524d;
  background: #fffafa;
}
.field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 9px;
}
.field-heading > div:first-child {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #253e55;
}
.required-mark {
  padding: 2px 5px;
  border-radius: 4px;
  background: #fceeed;
  color: #b5423e;
  font-size: 10px;
}
.manual-mark {
  padding: 2px 6px;
  border-radius: 4px;
  background: #e8f0ff;
  color: #315f9e;
  font-size: 10px;
}
.declared-mark {
  padding: 2px 6px;
  border-radius: 4px;
  background: #e8f7f3;
  color: #187d70;
  font-size: 10px;
}
.confidence-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #718090;
  font-size: 11px;
  white-space: nowrap;
}
.confidence-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #c9524d;
}
.confidence-high .confidence-dot {
  background: #52a566;
}
.confidence-medium .confidence-dot {
  background: #d9944e;
}
.is-manually-confirmed {
  border-left-color: #557eb6;
  background: #f9fbff;
}
.is-manually-confirmed .confidence-dot {
  background: #557eb6;
}
.field-value {
  min-height: 40px;
  padding: 9px 12px;
  border: 1px solid #dfe5eb;
  border-radius: 8px;
  background: #f7f9fb;
  color: #223f59;
  line-height: 20px;
}
.field-value.empty {
  color: #a5524d;
}
.field-source {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 7px;
  color: #8b97a4;
  font-size: 11px;
}
.field-source span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.field-source .evidence-text {
  overflow: visible;
  text-overflow: clip;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.field-warning {
  color: #b97731;
}

@media (max-width: 560px) {
  .field-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }
}
</style>
