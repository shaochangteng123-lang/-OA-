<template>
  <div class="line-number-gutter">
    <!-- 行号 -->
    <div
      v-for="(para, index) in paragraphs"
      :key="index"
      class="line-number"
      :class="{
        'is-heading': para.type === 'heading',
        'is-overall-heading': para.type === 'heading' && !para.projectId,
        'is-project-heading': para.type === 'heading' && para.projectId,
        'in-bracket': isInBracketRange(index),
      }"
      :style="{
        top: para.top + 'px',
        height: para.height + 'px',
      }"
    >
      {{ index + 1 }}
    </div>

    <!-- 中括号连线 SVG -->
    <svg
      v-if="bracketRange && paragraphs.length > 0"
      class="bracket-connector"
      :style="{
        top: '0px',
        left: '0px',
        width: '48px',
        height: containerHeight + 'px',
      }"
    >
      <path :d="bracketPath" :style="{ stroke: bracketColor }" />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface ParagraphInfo {
  index: number
  type: 'overall' | 'project' | 'heading'
  projectId?: string | null
  top: number
  height: number
  element: HTMLElement
}

interface BracketRange {
  start: number
  end: number
}

interface Props {
  paragraphs: ParagraphInfo[]
  activeParagraphIndex: number | null
  bracketRange: BracketRange | null
}

const props = defineProps<Props>()

// 判断行号是否在括号范围内
function isInBracketRange(index: number): boolean {
  if (!props.bracketRange) return false
  return index >= props.bracketRange.start && index <= props.bracketRange.end
}

// 计算中括号颜色
const bracketColor = computed(() => {
  if (!props.bracketRange || props.paragraphs.length === 0) return 'var(--yl-primary)'

  const { start } = props.bracketRange
  const startPara = props.paragraphs[start]

  if (!startPara) return 'var(--yl-primary)'

  // 如果是总体工作标题或总体工作段落，使用深褐色
  if (startPara.type === 'overall' || (startPara.type === 'heading' && !startPara.projectId)) {
    return '#8b4513'
  }

  // 否则使用深蓝色
  return 'var(--yl-primary)'
})

// 计算容器高度
const containerHeight = computed(() => {
  if (props.paragraphs.length === 0) return 400

  const lastPara = props.paragraphs[props.paragraphs.length - 1]
  return lastPara.top + lastPara.height + 20
})

// 生成中括号路径
const bracketPath = computed(() => {
  if (!props.bracketRange || props.paragraphs.length === 0) return ''

  const { start, end } = props.bracketRange
  const startPara = props.paragraphs[start]
  const endPara = props.paragraphs[end]

  if (!startPara || !endPara) return ''

  const startTop = startPara.top + 4 // 顶部稍微下移一点
  const endBottom = endPara.top + endPara.height - 4 // 底部稍微上移一点

  return generateBracketPath(startTop, endBottom)
})

// 生成左中括号路径
function generateBracketPath(startTop: number, endBottom: number): string {
  const leftX = 12 // 左侧起始点
  const curveRadius = 6 // 圆角半径
  const bracketWidth = 8 // 中括号宽度

  const height = endBottom - startTop

  // 如果高度太小，不绘制
  if (height < curveRadius * 2) {
    return ''
  }

  // 绘制左中括号形状 [
  return `
    M ${leftX + bracketWidth} ${startTop}
    L ${leftX + curveRadius} ${startTop}
    Q ${leftX} ${startTop} ${leftX} ${startTop + curveRadius}
    L ${leftX} ${endBottom - curveRadius}
    Q ${leftX} ${endBottom} ${leftX + curveRadius} ${endBottom}
    L ${leftX + bracketWidth} ${endBottom}
  `
}
</script>

<style scoped>
.line-number-gutter {
  width: 48px;
  flex-shrink: 0;
  background: #f9fafb;
  border-right: 1px solid var(--yl-border-light);
  position: relative;
  user-select: none;
  overflow: hidden;
}

.line-number {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #9ca3af;
  font-family: var(--yl-font-family-mono);
  transition: all 0.2s ease;
}

/* 总体工作标题行号 - 正方形圆角深褐色背景 */
.line-number.is-overall-heading {
  background: #8b4513;
  color: white;
  font-weight: 600;
  border-radius: 4px;
  margin: 0 6px;
}

/* 项目标题行号 - 正方形圆角深蓝色背景 */
.line-number.is-project-heading {
  background: var(--yl-primary);
  color: white;
  font-weight: 600;
  border-radius: 4px;
  margin: 0 6px;
}

/* 括号范围内的行号加粗 */
.line-number.in-bracket {
  font-weight: 600;
}

.bracket-connector {
  position: absolute;
  pointer-events: none;
  overflow: visible;
  z-index: 10;
}

.bracket-connector path {
  stroke: var(--yl-primary);
  stroke-width: 2;
  fill: none;
  transition: all 0.3s ease;
}
</style>
