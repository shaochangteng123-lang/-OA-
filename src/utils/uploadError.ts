/**
 * 上传错误提示工具
 * 上传类错误永不自动消失，需要用户手动点击关闭或点击空白处
 */
import { ElMessage } from 'element-plus'

let currentMessage: ReturnType<typeof ElMessage> | null = null

/**
 * 显示上传错误消息
 * - 永不自动消失（duration: 0）
 * - 显示关闭按钮
 * - 同一时间只显示一条，新错误会替换旧错误
 * - 点击空白处关闭（通过全局点击监听实现）
 */
export function showUploadError(message: string): void {
  // 关闭上一条
  if (currentMessage) {
    currentMessage.close()
    currentMessage = null
  }

  currentMessage = ElMessage({
    type: 'error',
    message,
    duration: 0,
    showClose: true,
    onClose: () => {
      currentMessage = null
      document.removeEventListener('click', closeOnClickOutside, true)
    },
  })

  // 延迟注册点击监听，避免当前点击事件立即触发关闭
  setTimeout(() => {
    document.addEventListener('click', closeOnClickOutside, true)
  }, 100)
}

function closeOnClickOutside(e: MouseEvent): void {
  // 如果点击的是消息框内部，不关闭
  const messageEl = document.querySelector('.el-message')
  if (messageEl && messageEl.contains(e.target as Node)) {
    return
  }
  if (currentMessage) {
    currentMessage.close()
    currentMessage = null
  }
  document.removeEventListener('click', closeOnClickOutside, true)
}
