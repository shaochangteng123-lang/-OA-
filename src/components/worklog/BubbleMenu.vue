<template>
  <div v-if="show" class="bubble-menu" :style="menuStyle">
    <button
      class="menu-button"
      :class="{ 'is-active': editor?.isActive('bold') }"
      title="粗体 (Ctrl+B)"
      @click="editor?.chain().focus().toggleBold().run()"
    >
      <span class="icon">𝐁</span>
    </button>
    <button
      class="menu-button"
      :class="{ 'is-active': editor?.isActive('italic') }"
      title="斜体 (Ctrl+I)"
      @click="editor?.chain().focus().toggleItalic().run()"
    >
      <span class="icon">𝐼</span>
    </button>
    <button
      class="menu-button"
      :class="{ 'is-active': editor?.isActive('underline') }"
      title="下划线 (Ctrl+U)"
      @click="editor?.chain().focus().toggleUnderline().run()"
    >
      <span class="icon">U̲</span>
    </button>
    <button
      class="menu-button"
      :class="{ 'is-active': editor?.isActive('strike') }"
      title="删除线"
      @click="editor?.chain().focus().toggleStrike().run()"
    >
      <span class="icon">S̶</span>
    </button>
    <div class="menu-divider"></div>
    <button
      class="menu-button"
      :class="{ 'is-active': editor?.isActive('code') }"
      title="行内代码"
      @click="editor?.chain().focus().toggleCode().run()"
    >
      <span class="icon">&lt;/&gt;</span>
    </button>
    <button
      class="menu-button"
      :class="{ 'is-active': editor?.isActive('highlight') }"
      title="高亮"
      @click="editor?.chain().focus().toggleHighlight().run()"
    >
      <span class="icon">🎨</span>
    </button>
    <button
      class="menu-button"
      :class="{ 'is-active': editor?.isActive('link') }"
      title="链接"
      @click="handleLink"
    >
      <span class="icon">🔗</span>
    </button>
    <div class="menu-divider"></div>
    <div class="color-picker-wrapper">
      <button class="menu-button color-button" title="文字颜色" @click="toggleColorPicker">
        <span class="icon">A</span>
        <span class="color-indicator" :style="{ background: currentColor }"></span>
      </button>
      <div v-if="showColorPicker" class="color-palette">
        <button
          v-for="color in predefineColors"
          :key="color.value"
          class="color-option"
          :class="{ 'is-active': currentColor === color.value }"
          :style="{ background: color.value }"
          :title="color.label"
          @click="handleColorSelect(color.value)"
        >
          <span v-if="currentColor === color.value" class="check-icon">✓</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'

const props = defineProps<{
  editor: Editor | null
  show: boolean
  position?: { top: number; left: number }
}>()

const menuStyle = computed(() => {
  if (!props.position) return {} as Record<string, string>
  return {
    position: 'fixed',
    top: `${props.position.top}px`,
    left: `${props.position.left}px`,
  } as Record<string, string>
})

// 链接处理
function handleLink() {
  if (!props.editor) return
  const href = window.prompt('输入链接地址:') || ''
  props.editor.chain().focus().toggleLink({ href }).run()
}

// 颜色选择器
const currentColor = ref('#000000')
const showColorPicker = ref(false)

const predefineColors = [
  { label: '深褐色', value: '#8B4513' },
  { label: '深蓝色', value: '#1E3A8A' },
  { label: '黑色', value: '#000000' },
  { label: '灰色', value: '#6B7280' },
  { label: '红色', value: '#EF4444' },
  { label: '橙色', value: '#F59E0B' },
  { label: '黄色', value: '#EAB308' },
  { label: '绿色', value: '#10B981' },
  { label: '蓝色', value: '#3B82F6' },
  { label: '紫色', value: '#8B5CF6' },
  { label: '粉色', value: '#EC4899' },
]

function toggleColorPicker() {
  showColorPicker.value = !showColorPicker.value
}

function handleColorSelect(color: string) {
  if (props.editor) {
    props.editor.chain().focus().setColor(color).run()
    currentColor.value = color
  }
  showColorPicker.value = false
}

// 监听编辑器选中文本的颜色，同步到颜色选择器
watch(
  () => props.editor?.getAttributes('textStyle')?.color,
  (color) => {
    if (color) {
      currentColor.value = color
    } else {
      currentColor.value = '#000000'
    }
  }
)
</script>

<style scoped>
.bubble-menu {
  display: flex;
  align-items: center;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px;
  gap: 2px;
  z-index: 1000;
}

.menu-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  color: #374151;
}

.menu-button:hover {
  background: #f3f4f6;
}

.menu-button.is-active {
  background: #3b82f6;
  color: white;
}

.icon {
  font-size: 14px;
  font-weight: 500;
}

.menu-divider {
  width: 1px;
  height: 20px;
  background: #e5e7eb;
  margin: 0 4px;
}

/* 颜色选择器 */
.color-picker-wrapper {
  position: relative;
}

.color-button {
  position: relative;
}

.color-indicator {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 3px;
  border-radius: 2px;
}

.color-palette {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  z-index: 1001;
  min-width: 160px;
}

.color-option {
  width: 32px;
  height: 32px;
  border: 2px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.color-option:hover {
  transform: scale(1.1);
  border-color: #3b82f6;
}

.color-option.is-active {
  border-color: #3b82f6;
}

.check-icon {
  color: white;
  font-size: 16px;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
</style>
