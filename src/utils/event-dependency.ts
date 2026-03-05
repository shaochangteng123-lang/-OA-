import { EventNode, PresetEvent } from '@/types'

/**
 * 深度优先搜索检测循环依赖
 * @param eventId 当前事件ID
 * @param newDependencies 新的依赖项
 * @param allEvents 所有事件
 * @returns true表示存在循环依赖
 */
export function detectCircularDependency(
  eventId: string,
  newDependencies: string[],
  allEvents: (EventNode | PresetEvent)[]
): boolean {
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function dfs(currentId: string): boolean {
    if (recursionStack.has(currentId)) {
      return true // 发现循环
    }

    if (visited.has(currentId)) {
      return false // 已访问过，无循环
    }

    visited.add(currentId)
    recursionStack.add(currentId)

    // 获取当前事件的依赖
    const currentEvent = allEvents.find((e) => e.id === currentId)
    let dependencies: string[] = []

    if (currentEvent) {
      dependencies = [...(currentEvent.dependencies || [])]
    }

    // 如果是正在检查的事件，使用新的依赖项
    if (currentId === eventId) {
      dependencies = newDependencies
    }

    // 递归检查所有依赖
    for (const depId of dependencies) {
      if (dfs(depId)) {
        return true
      }
    }

    recursionStack.delete(currentId)
    return false
  }

  return dfs(eventId)
}

/**
 * 查找循环依赖路径
 * @param eventId 事件ID
 * @param allEvents 所有事件
 * @returns 循环路径
 */
export function findCircularPath(
  eventId: string,
  allEvents: (EventNode | PresetEvent)[]
): string[] {
  const path: string[] = []
  const visited = new Set<string>()

  function dfs(currentId: string): boolean {
    if (path.includes(currentId)) {
      path.push(currentId) // 形成循环
      return true
    }

    if (visited.has(currentId)) {
      return false
    }

    visited.add(currentId)
    path.push(currentId)

    const currentEvent = allEvents.find((e) => e.id === currentId)
    if (!currentEvent) {
      path.pop()
      return false
    }

    for (const depId of currentEvent.dependencies || []) {
      if (dfs(depId)) {
        return true
      }
    }

    path.pop()
    return false
  }

  dfs(eventId)
  return path
}

/**
 * 验证事件依赖关系是否合法
 * @param events 事件列表
 * @returns 错误信息，如果没有错误返回null
 */
export function validateEventDependencies(events: (EventNode | PresetEvent)[]): string | null {
  for (const event of events) {
    if (!event.dependencies || event.dependencies.length === 0) {
      continue
    }

    if (detectCircularDependency(event.id, event.dependencies, events)) {
      const path = findCircularPath(event.id, events)
      const eventNames = path.map((id) => events.find((e) => e.id === id)?.name || id).join(' → ')
      return `检测到循环依赖: ${eventNames}`
    }

    // 检查依赖的事件是否存在
    for (const depId of event.dependencies) {
      if (!events.find((e) => e.id === depId)) {
        return `事件 "${event.name}" 依赖的事件不存在: ${depId}`
      }
    }
  }

  return null
}

/**
 * 获取事件的所有前置依赖（递归）
 * @param eventId 事件ID
 * @param allEvents 所有事件
 * @returns 所有前置依赖的ID数组
 */
export function getAllDependencies(
  eventId: string,
  allEvents: (EventNode | PresetEvent)[]
): string[] {
  const result = new Set<string>()
  const visited = new Set<string>()

  function collect(currentId: string) {
    if (visited.has(currentId)) return
    visited.add(currentId)

    const event = allEvents.find((e) => e.id === currentId)
    if (!event) return

    for (const depId of event.dependencies || []) {
      result.add(depId)
      collect(depId)
    }
  }

  collect(eventId)
  return Array.from(result)
}
