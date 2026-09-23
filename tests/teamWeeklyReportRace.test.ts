jest.mock('@/utils/api', () => ({
  api: { get: jest.fn() },
}))

jest.mock('element-plus', () => ({
  ElMessage: { error: jest.fn() },
}))

import { nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import TeamWeeklyReport from '@/views/TeamWeeklyReport.vue'
import { api } from '@/utils/api'

const { flushPromises, shallowMount } =
  require('../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js') as typeof import('@vue/test-utils')

interface ReportState {
  dateRange: string[]
  loading: boolean
  reports: Array<{ id: string; userName: string }>
  handleTimeChange: (choice: 'thisWeek' | 'lastWeek' | 'custom') => void
}

interface RequestedWeek {
  weekStart: string
  weekEnd: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function reportResponse(range: RequestedWeek, id: string) {
  return {
    data: {
      success: true,
      data: {
        ...range,
        reports: [{
          id,
          userId: `${id}-用户`,
          userName: `${id}-姓名`,
          userPosition: null,
          content: `${id}-内容`,
          generatedAt: '2026-09-21T12:00:00.000Z',
          lockedAt: null,
          supplements: [],
          attachments: [],
        }],
      },
    },
  }
}

function requestedWeek(callIndex: number): RequestedWeek {
  return (jest.mocked(api.get).mock.calls[callIndex][1] as { params: RequestedWeek }).params
}

function mountReport() {
  return shallowMount(TeamWeeklyReport, {
    global: {
      mocks: { $router: { back: jest.fn() } },
      directives: { loading: () => undefined },
      stubs: {
        'el-button': { template: '<button><slot /></button>' },
        'el-radio-group': { template: '<div><slot /></div>' },
        'el-radio-button': { template: '<button><slot /></button>' },
        'el-date-picker': true,
        'el-dropdown': { template: '<div><slot /><slot name="dropdown" /></div>' },
        'el-dropdown-menu': { template: '<div><slot /></div>' },
        'el-dropdown-item': { template: '<div><slot /></div>' },
        'el-icon': { template: '<i><slot /></i>' },
        'el-empty': { template: '<div class="empty-stub" />' },
        'el-image': true,
      },
    },
  })
}

describe('团队周报切换请求竞态', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('较早请求后返回时不会覆盖最新周次的数据', async () => {
    const first = deferred<ReturnType<typeof reportResponse>>()
    const second = deferred<ReturnType<typeof reportResponse>>()
    jest.mocked(api.get)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const wrapper = mountReport()
    await nextTick()
    const state = wrapper.vm as unknown as ReportState
    state.handleTimeChange('lastWeek')

    expect(api.get).toHaveBeenCalledTimes(2)
    expect(state.reports).toEqual([])

    second.resolve(reportResponse(requestedWeek(1), '最新周报'))
    await flushPromises()
    expect(state.reports.map(report => report.id)).toEqual(['最新周报'])
    expect(state.loading).toBe(false)

    first.resolve(reportResponse(requestedWeek(0), '过期周报'))
    await flushPromises()
    expect(state.reports.map(report => report.id)).toEqual(['最新周报'])
    expect(ElMessage.error).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('过期请求失败时不清空新数据也不弹出错误提示', async () => {
    const first = deferred<ReturnType<typeof reportResponse>>()
    const second = deferred<ReturnType<typeof reportResponse>>()
    jest.mocked(api.get)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const wrapper = mountReport()
    await nextTick()
    const state = wrapper.vm as unknown as ReportState
    state.handleTimeChange('lastWeek')

    second.resolve(reportResponse(requestedWeek(1), '新周报'))
    await flushPromises()
    first.reject(new Error('旧请求失败'))
    await flushPromises()

    expect(state.reports.map(report => report.id)).toEqual(['新周报'])
    expect(state.loading).toBe(false)
    expect(ElMessage.error).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('最新响应周范围不匹配或请求失败时始终保持空列表', async () => {
    const mismatched = deferred<ReturnType<typeof reportResponse>>()
    const failed = deferred<ReturnType<typeof reportResponse>>()
    jest.mocked(api.get)
      .mockReturnValueOnce(mismatched.promise)
      .mockReturnValueOnce(failed.promise)

    const wrapper = mountReport()
    await nextTick()
    const state = wrapper.vm as unknown as ReportState
    const initialRange = requestedWeek(0)
    mismatched.resolve(reportResponse({
      weekStart: initialRange.weekStart,
      weekEnd: '2099-12-31',
    }, '错周周报'))
    await flushPromises()

    expect(state.reports).toEqual([])

    state.handleTimeChange('lastWeek')
    expect(state.reports).toEqual([])
    failed.reject(new Error('最新请求失败'))
    await flushPromises()

    expect(state.reports).toEqual([])
    expect(state.loading).toBe(false)
    expect(ElMessage.error).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})
