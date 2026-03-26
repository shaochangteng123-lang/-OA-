/**
 * PaddleOCR 常驻进程管理
 * 启动一个 Python 常驻进程，通过 stdin/stdout 通信
 * OCR 引擎只加载一次，后续请求直接复用，大幅提升识别速度
 */

import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 常驻进程单例
let daemonProcess: ChildProcess | null = null
let daemonReady = false

// 响应缓冲区和请求队列
let stdoutBuffer = ''
let requestQueue: Array<{
  resolve: (value: string) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}> = []

// 启动锁，防止并发启动多个进程
let startingPromise: Promise<void> | null = null

/**
 * 获取 PaddleOCR worker 脚本路径
 */
function getWorkerPath(): string {
  const candidates = [
    path.resolve(__dirname, '../scripts/paddle_ocr_worker.py'),
    path.resolve(process.cwd(), 'server/scripts/paddle_ocr_worker.py'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  throw new Error('PaddleOCR worker 脚本不存在')
}

/**
 * 获取 Python 可执行文件路径
 */
function getPythonCmd(): string {
  const venvPython = '/tmp/ocr-venv/bin/python3'
  return fs.existsSync(venvPython) ? venvPython : 'python3'
}

/**
 * 处理 stdout 数据，按换行符分割并匹配请求
 */
function handleStdoutData(chunk: string, onReady: (data: any) => void): void {
  stdoutBuffer += chunk

  // 按换行符分割，最后一段可能不完整，留在缓冲区
  const lines = stdoutBuffer.split('\n')
  stdoutBuffer = lines.pop() || ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const data = JSON.parse(trimmed)

      // ready 信号
      if ('ready' in data) {
        onReady(data)
        continue
      }

      // OCR 响应 - 按 FIFO 顺序匹配
      const req = requestQueue.shift()
      if (req) {
        clearTimeout(req.timer)
        if (data.error) {
          req.reject(new Error(`PaddleOCR 识别失败: ${data.error}`))
        } else {
          req.resolve(data.fullText || '')
        }
      } else {
        console.warn('🐍 收到未匹配的 OCR 响应:', trimmed.substring(0, 100))
      }
    } catch {
      console.error('🐍 OCR 响应解析失败:', trimmed.substring(0, 200))
    }
  }
}

/**
 * 启动常驻进程
 */
async function startDaemon(): Promise<void> {
  // 如果已经在启动中，等待启动完成
  if (startingPromise) {
    await startingPromise
    return
  }

  // 如果已经就绪，直接返回
  if (daemonProcess && daemonReady) return

  startingPromise = new Promise<void>((resolve, reject) => {
    const workerPath = getWorkerPath()
    const pythonCmd = getPythonCmd()

    console.log('🐍 启动 PaddleOCR 常驻进程...')

    // 清空状态
    stdoutBuffer = ''
    requestQueue = []

    // -u 参数禁用 Python 的 stdout/stderr 缓冲，确保管道通信不丢行
    const proc = spawn(pythonCmd, ['-u', workerPath, '--daemon'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    daemonProcess = proc

    // 读取 stderr 日志（不影响 stdout 通信）
    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg && !msg.includes('ppocr') && !msg.includes('download')) {
        console.error('🐍 OCR stderr:', msg)
      }
    })

    let gotReady = false
    const startTimeout = setTimeout(() => {
      if (!gotReady) {
        cleanup()
        reject(new Error('PaddleOCR 常驻进程启动超时（60秒）'))
      }
    }, 60000)

    // 直接监听 stdout 的 data 事件，比 readline 更可靠
    proc.stdout!.on('data', (chunk: Buffer) => {
      handleStdoutData(chunk.toString(), (data) => {
        if (gotReady) return // 忽略重复 ready
        gotReady = true
        clearTimeout(startTimeout)

        if (data.ready) {
          daemonReady = true
          console.log(`✅ PaddleOCR 常驻进程就绪（引擎: ${data.engine}）`)
          resolve()
        } else {
          cleanup()
          reject(new Error(`PaddleOCR 常驻进程启动失败: ${data.error}`))
        }
      })
    })

    proc.on('exit', (code: number | null) => {
      console.log(`🐍 PaddleOCR 常驻进程退出 (code: ${code})`)
      cleanup()
      // 拒绝所有 pending 的请求
      for (const req of requestQueue) {
        clearTimeout(req.timer)
        req.reject(new Error('PaddleOCR 常驻进程意外退出'))
      }
      requestQueue = []
    })

    proc.on('error', (err: Error) => {
      console.error('🐍 PaddleOCR 常驻进程错误:', err)
      cleanup()
      reject(err)
    })
  })

  try {
    await startingPromise
  } finally {
    startingPromise = null
  }
}

/**
 * 清理常驻进程
 */
function cleanup(): void {
  daemonReady = false
  stdoutBuffer = ''
  if (daemonProcess) {
    daemonProcess.kill()
    daemonProcess = null
  }
}

/**
 * 调用 OCR 识别（通过常驻进程）
 * 如果常驻进程不可用，自动回退到单次调用模式
 */
export async function callPaddleOcr(filePath: string): Promise<string> {
  try {
    // 确保常驻进程已启动
    await startDaemon()
  } catch (err) {
    console.warn('⚠️ 常驻进程启动失败，回退到单次调用模式:', err)
    return callPaddleOcrOnce(filePath)
  }

  if (!daemonProcess || !daemonReady) {
    return callPaddleOcrOnce(filePath)
  }

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 从队列中移除超时的请求
      const idx = requestQueue.findIndex(r => r.timer === timer)
      if (idx !== -1) requestQueue.splice(idx, 1)
      // 超时说明常驻进程可能卡住了，重启它
      console.warn('⚠️ PaddleOCR 识别超时（60秒），重启常驻进程')
      cleanup()
      reject(new Error('PaddleOCR 识别超时（60秒）'))
    }, 60000)

    requestQueue.push({ resolve, reject, timer })

    const request = JSON.stringify({ image_path: filePath }) + '\n'
    daemonProcess!.stdin!.write(request)
  })
}

/**
 * 单次调用模式（回退方案）
 */
async function callPaddleOcrOnce(filePath: string): Promise<string> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)

  const workerPath = getWorkerPath()
  const pythonCmd = getPythonCmd()

  const { stdout } = await execFileAsync(pythonCmd, [workerPath, filePath], {
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  })

  const result = JSON.parse(stdout.trim())
  if (result.error) {
    throw new Error(`PaddleOCR 识别失败: ${result.error}`)
  }

  return result.fullText || ''
}

/**
 * 关闭常驻进程（用于服务器关闭时清理）
 */
export function shutdownOcrDaemon(): void {
  console.log('🐍 关闭 PaddleOCR 常驻进程...')
  cleanup()
}

/**
 * 获取 PaddleOCR worker 脚本路径（导出给需要的模块）
 */
export function getPaddleOcrWorkerPath(): string {
  return getWorkerPath()
}
