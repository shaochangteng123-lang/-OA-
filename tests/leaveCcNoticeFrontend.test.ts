/* eslint-disable vue/one-component-per-file -- 测试文件需要分别模拟表格和列组件。 */
jest.mock('../src/utils/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}))

jest.mock('../src/utils/leaveApi', () => ({
  getLeaveTypes: jest.fn(),
  adminGetTypes: jest.fn(),
  adminCreateType: jest.fn(),
  adminUpdateType: jest.fn(),
  adminDeleteType: jest.fn(),
  adminGetRequests: jest.fn(),
  adminGetBalances: jest.fn(),
  adminAdjustBalance: jest.fn(),
  getRequestDetail: jest.fn(),
  getExportUrl: jest.fn(),
  markLeaveCcNoticeRead: jest.fn(),
}))

jest.mock('element-plus', () => ({
  ElMessage: { error: jest.fn(), warning: jest.fn(), success: jest.fn() },
}))

jest.mock('../src/components/leave/LeaveApprovalTimeline.vue', () => ({
  __esModule: true,
  default: { name: 'LeaveApprovalTimeline', template: '<div class="timeline-stub" />' },
}))

jest.mock('../src/components/leave/LeavePendingList.vue', () => ({
  __esModule: true,
  default: { name: 'LeavePendingList', template: '<div />' },
}))

import fs from 'node:fs'
import path from 'node:path'
import { computed, defineComponent, h, inject, provide, type ComputedRef, type PropType } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { ElMessage } from 'element-plus'
import LeaveAdminPanel from '../src/components/leave/LeaveAdminPanel.vue'
import { useAuthStore } from '../src/stores/auth'
import { usePendingStore } from '../src/stores/pending'
import { api } from '../src/utils/api'
import * as leaveApi from '../src/utils/leaveApi'
import type { LeaveRequest, LeaveRequestDetail } from '../src/utils/leaveApi'

const { shallowMount, flushPromises } =
  require('../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js') as typeof import('@vue/test-utils')

const tableStub = defineComponent({
  props: { data: { type: Array as PropType<LeaveRequest[]>, default: () => [] } },
  setup(props, { slots }) {
    provide('测试表格行', computed(() => props.data || []))
    return () => h('div', slots.default?.())
  },
})

const columnStub = defineComponent({
  setup(_, { slots }) {
    const rows = inject<ComputedRef<LeaveRequest[]>>('测试表格行')
    return () => h('div', rows?.value.map(row => slots.default?.({ row })))
  },
})

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<section><header><slot name="label" /></header><slot /></section>' },
  'el-alert': { props: ['title'], template: '<aside class="notice-alert">{{ title }}</aside>' },
  'el-badge': { props: ['value'], template: '<span class="notice-badge">{{ value }}</span>' },
  'el-tag': { template: '<span><slot /></span>' },
  'el-table': tableStub,
  'el-table-column': columnStub,
  'el-drawer': { template: '<div><slot /></div>' },
  'el-input': true,
  'el-option': true,
  'el-select': true,
  'el-date-picker': true,
  'el-button': true,
  'el-checkbox': true,
  'el-icon': true,
  'el-pagination': true,
  'el-popconfirm': true,
  'el-input-number': true,
  'el-tooltip': true,
  'el-skeleton': true,
  'el-form': true,
  'el-form-item': true,
  'el-switch': true,
  'el-dialog': true,
  'el-descriptions': true,
  'el-descriptions-item': true,
}

interface PanelState {
  activeSubTab: string
  onlyUnread: boolean
  drawerVisible: boolean
  detailRequest: LeaveRequestDetail | null
  detailHistory: LeaveRequestDetail[]
  requestList: LeaveRequest[]
  handleViewRequest: (row: LeaveRequest) => Promise<void>
  handleViewRelatedRequest: (id: string) => Promise<void>
  handleDetailBack: () => void
}

function notice(id = 'leave-1', revision = '通知版本一'): LeaveRequestDetail {
  return {
    id,
    request_no: `QJ-${id}`,
    status: 'approved',
    total_days: 1,
    cc_notice_unread: true,
    cc_notice_revision: revision,
  } as LeaveRequestDetail
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const mounted: Array<{ unmount: () => void }> = []

async function mountPanel(role: 'admin' | 'super_admin' | 'chairman' = 'admin', props = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().user = {
    id: `${role}-id`, name: '测试账号', role, status: 'active', email: null, avatarUrl: null,
  }
  const pending = usePendingStore()
  pending.counts.leaveCcUnread = 2
  const wrapper = shallowMount(LeaveAdminPanel, {
    props,
    global: { plugins: [pinia], stubs: elementStubs, directives: { loading: () => undefined } },
  })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, pending, vm: wrapper.vm as unknown as PanelState }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(leaveApi.getLeaveTypes).mockResolvedValue([])
  jest.mocked(leaveApi.adminGetTypes).mockResolvedValue([])
  jest.mocked(leaveApi.adminGetBalances).mockResolvedValue({ users: [], types: [] })
  jest.mocked(leaveApi.adminGetRequests).mockResolvedValue({ list: [notice()], total: 1 })
  jest.mocked(leaveApi.markLeaveCcNoticeRead).mockResolvedValue(1)
})

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
})

describe('请假抄送未读提示', () => {
  it.each(['admin', 'super_admin'] as const)('%s 收到抄送显示横幅、页签数量和行内未读标志，但打开列表不自动已读', async role => {
    const { wrapper, pending } = await mountPanel(role)
    expect(wrapper.find('.notice-alert').text()).toContain('2 条未读请假抄送')
    expect(wrapper.find('.cc-tab-label .notice-badge').text()).toBe('2')
    expect(wrapper.find('.cc-unread-tag').text()).toBe('未读')
    expect(leaveApi.adminGetRequests).toHaveBeenCalled()
    expect(leaveApi.markLeaveCcNoticeRead).not.toHaveBeenCalled()
    expect(pending.counts.leaveCcUnread).toBe(2)
  })

  it('成功获取详情后只确认该详情版本，并更新待办数量和列表', async () => {
    const detail = notice()
    const request = deferred<LeaveRequestDetail>()
    jest.mocked(leaveApi.getRequestDetail).mockReturnValueOnce(request.promise)
    const { vm, pending } = await mountPanel()
    jest.mocked(leaveApi.adminGetRequests).mockClear()
    jest.mocked(leaveApi.adminGetRequests).mockResolvedValue({ list: [{ ...detail, cc_notice_unread: false }], total: 1 })

    const opening = vm.handleViewRequest(detail)
    expect(leaveApi.markLeaveCcNoticeRead).not.toHaveBeenCalled()
    request.resolve(detail)
    await opening

    expect(vm.drawerVisible).toBe(true)
    expect(vm.detailRequest?.id).toBe(detail.id)
    expect(leaveApi.markLeaveCcNoticeRead).toHaveBeenCalledWith(detail.id, detail.cc_notice_revision)
    expect(leaveApi.markLeaveCcNoticeRead).toHaveBeenCalledTimes(1)
    expect(pending.counts.leaveCcUnread).toBe(1)
    expect(leaveApi.adminGetRequests).toHaveBeenCalledTimes(1)
    expect(vm.requestList[0].cc_notice_unread).toBe(false)
  })

  it('详情获取失败时不确认已读且保留数量', async () => {
    jest.mocked(leaveApi.getRequestDetail).mockRejectedValueOnce(new Error('详情请求失败'))
    const { vm, pending } = await mountPanel()
    await vm.handleViewRequest(notice())
    expect(leaveApi.markLeaveCcNoticeRead).not.toHaveBeenCalled()
    expect(pending.counts.leaveCcUnread).toBe(2)
    expect(vm.drawerVisible).toBe(false)
    expect(ElMessage.error).toHaveBeenCalledWith('获取详情失败')
  })

  it('详情返回前关闭抽屉时不确认已读', async () => {
    const request = deferred<LeaveRequestDetail>()
    jest.mocked(leaveApi.getRequestDetail).mockReturnValueOnce(request.promise)
    const { vm, pending } = await mountPanel()
    const opening = vm.handleViewRequest(notice())
    vm.drawerVisible = false
    request.resolve(notice())
    await opening
    expect(leaveApi.markLeaveCcNoticeRead).not.toHaveBeenCalled()
    expect(vm.detailRequest).toBeNull()
    expect(pending.counts.leaveCcUnread).toBe(2)
  })

  it('已读确认失败时保留详情、未读标志和提示数量', async () => {
    jest.mocked(leaveApi.getRequestDetail).mockResolvedValueOnce(notice())
    jest.mocked(leaveApi.markLeaveCcNoticeRead).mockRejectedValueOnce(new Error('确认失败'))
    const { wrapper, vm, pending } = await mountPanel()
    await vm.handleViewRequest(notice())
    expect(vm.drawerVisible).toBe(true)
    expect(vm.detailRequest?.id).toBe('leave-1')
    expect(pending.counts.leaveCcUnread).toBe(2)
    expect(wrapper.find('.cc-unread-tag').exists()).toBe(true)
    expect(ElMessage.warning).toHaveBeenCalledWith('详情已打开，但未读状态更新失败，请稍后重新查看')
  })

  it.each([
    { ...notice(), cc_notice_unread: false },
    { ...notice(), cc_notice_revision: undefined },
  ])('已读详情或无版本详情不会发出确认请求', async detail => {
    jest.mocked(leaveApi.getRequestDetail).mockResolvedValueOnce(detail)
    const { vm } = await mountPanel()
    await vm.handleViewRequest(detail)
    expect(leaveApi.markLeaveCcNoticeRead).not.toHaveBeenCalled()
  })

  it('打开关联详情时逐条确认对应版本，返回上一申请不重复确认', async () => {
    const first = notice('leave-1', '版本一')
    const second = notice('leave-2', '版本二')
    jest.mocked(leaveApi.getRequestDetail).mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const { vm } = await mountPanel()
    await vm.handleViewRequest(first)
    await vm.handleViewRelatedRequest(second.id)
    expect(leaveApi.markLeaveCcNoticeRead).toHaveBeenNthCalledWith(1, first.id, first.cc_notice_revision)
    expect(leaveApi.markLeaveCcNoticeRead).toHaveBeenNthCalledWith(2, second.id, second.cc_notice_revision)
    expect(vm.detailRequest?.id).toBe(second.id)
    expect(vm.detailHistory.map(item => item.id)).toEqual([first.id])
    vm.handleDetailBack()
    expect(vm.detailRequest?.id).toBe(first.id)
    expect(leaveApi.markLeaveCcNoticeRead).toHaveBeenCalledTimes(2)
  })

  it('关联详情返回前关闭抽屉时，不确认关联记录', async () => {
    const request = deferred<LeaveRequestDetail>()
    jest.mocked(leaveApi.getRequestDetail).mockResolvedValueOnce(notice()).mockReturnValueOnce(request.promise)
    const { vm } = await mountPanel()
    await vm.handleViewRequest(notice())
    const opening = vm.handleViewRelatedRequest('leave-2')
    vm.drawerVisible = false
    request.resolve(notice('leave-2'))
    await opening
    expect(leaveApi.markLeaveCcNoticeRead).toHaveBeenCalledTimes(1)
    expect(vm.detailHistory).toHaveLength(0)
  })

  it('同页面点击新通知切回抄送页签并筛选未读，不批量确认', async () => {
    const { wrapper, vm } = await mountPanel()
    vm.activeSubTab = 'types'
    await wrapper.setProps({ ccNoticeKey: '通知一' })
    await flushPromises()
    expect(vm.activeSubTab).toBe('requests')
    expect(vm.onlyUnread).toBe(true)
    expect(leaveApi.adminGetRequests).toHaveBeenLastCalledWith(expect.objectContaining({ unreadOnly: true, page: 1 }))
    vm.activeSubTab = 'balances'
    await wrapper.setProps({ ccNoticeKey: '通知二' })
    await flushPromises()
    expect(vm.activeSubTab).toBe('requests')
    expect(leaveApi.markLeaveCcNoticeRead).not.toHaveBeenCalled()
  })

  it('携带通知参数首次进入时直接展示未读抄送', async () => {
    const { vm } = await mountPanel('admin', { ccNoticeKey: '通知入口' })
    expect(vm.activeSubTab).toBe('requests')
    expect(vm.onlyUnread).toBe(true)
    expect(leaveApi.adminGetRequests).toHaveBeenLastCalledWith(expect.objectContaining({ unreadOnly: true }))
    expect(leaveApi.markLeaveCcNoticeRead).not.toHaveBeenCalled()
  })

  it('董事长即使有残留未读数量或通知参数，也不展示抄送提示或跳转抄送记录', async () => {
    const { wrapper, vm } = await mountPanel('chairman', { ccNoticeKey: '旧通知' })
    expect(vm.activeSubTab).toBe('approval')
    expect(wrapper.find('.notice-alert').exists()).toBe(false)
    expect(wrapper.find('.cc-tab-label').exists()).toBe(false)
    expect(leaveApi.adminGetRequests).not.toHaveBeenCalled()
    expect(leaveApi.markLeaveCcNoticeRead).not.toHaveBeenCalled()
  })

  it('待办计数初始为零，并接受服务端返回的本人未读数量', async () => {
    setActivePinia(createPinia())
    const store = usePendingStore()
    expect(store.counts.leaveCcUnread).toBe(0)
    jest.mocked(api.get).mockResolvedValueOnce({ data: { success: true, data: { leaveCcUnread: 3 } } })
    await store.fetchPendingCounts()
    expect(store.counts.leaveCcUnread).toBe(3)
  })
})

describe('请假抄送提醒导航和接口约束', () => {
  it('侧栏角标、人事分组和通知点击均连接本人抄送计数', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/layouts/MainLayout.vue'), 'utf8')
    expect(source).toContain('leaveCcUnreadCount.value > 0')
    expect(source).toMatch(/const employeeDataBadge[\s\S]*?leaveCcUnreadCount\.value/)
    expect(source).toContain('title: "请假抄送提醒"')
    expect(source).toContain('if (count <= 0 || count <= (previousCount || 0)) return;')
    expect(source).toContain('path: "/employee-data"')
    expect(source).toContain('query: { tab: "leave", ccNotice: String(Date.now()) }')
    expect(source).toMatch(/const leaveCcUnreadCount = computed\([\s\S]*?role === "admin"[\s\S]*?role === "super_admin"[\s\S]*?: 0/)
  })

  it('员工数据页保留请假角标，并监听同页面通知参数以切换页签', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/views/EmployeeData.vue'), 'utf8')
    expect(source).toContain('v-if="leaveCcUnreadCount > 0" :value="leaveCcUnreadCount"')
    expect(source).toContain(':cc-notice-key="leaveCcNoticeKey"')
    expect(source).toContain('typeof route.query.ccNotice === "string" ? route.query.ccNotice : undefined')
    expect(source).toContain('watch([() => route.query.tab, leaveCcNoticeKey]')
    expect(source).toContain('employeeDataTabs.has(tab)) activeTab.value = tab')
    expect(source).toMatch(/const leaveCcUnreadCount = computed\([\s\S]*?role === "admin"[\s\S]*?role === "super_admin"[\s\S]*?: 0/)
  })

  it('已读接口只提交请求编号和实际阅读的版本，不允许客户端指定接收人', async () => {
    const actual = jest.requireActual<typeof import('../src/utils/leaveApi')>('../src/utils/leaveApi')
    jest.mocked(api.post).mockResolvedValueOnce({ data: { data: { unreadCount: '4' } } })
    await expect(actual.markLeaveCcNoticeRead('申请一', '版本一')).resolves.toBe(4)
    expect(api.post).toHaveBeenCalledWith('/api/leave/admin/requests/申请一/cc/mark-read', { revision: '版本一' })
  })
})
