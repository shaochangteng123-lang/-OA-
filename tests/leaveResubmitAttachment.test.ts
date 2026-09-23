jest.mock('../src/utils/leaveApi', () => ({
  calculateDays: jest.fn().mockResolvedValue({ days: 3 }),
  getAttachmentUrl: jest.fn((id: string) => `/api/leave/attachments/${id}/download`),
  getLeaveTypes: jest.fn().mockResolvedValue([
    {
      id: 'sick',
      code: 'sick',
      name: '病假',
      requires_attachment: true,
      requires_balance_check: true,
      default_days: 3,
      description: null,
      sort_order: 1,
      is_active: true,
    },
  ]),
  getRequestDetail: jest.fn(),
  resubmitRequest: jest.fn().mockResolvedValue({
    id: 'request-draft',
    requestNo: 'QJ-2026-00005',
  }),
}))

jest.mock('../src/components/leave/LeaveDatePicker.vue', () => ({
  __esModule: true,
  default: { name: 'LeaveDatePicker', template: '<div />' },
}))

jest.mock('../src/components/leave/LeaveFileCards.vue', () => ({
  __esModule: true,
  default: { name: 'LeaveFileCards', template: '<div />' },
}))

import LeaveResubmitForm from '../src/components/leave/LeaveResubmitForm.vue'
import {
  getRequestDetail,
  resubmitRequest,
  type LeaveAttachment,
  type LeaveRequest,
} from '../src/utils/leaveApi'

const { mount, flushPromises } =
  require('../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js') as typeof import('@vue/test-utils')

const FormStub = {
  methods: {
    validate(callback: (valid: boolean) => unknown) {
      return callback(true)
    },
  },
  template: '<form><slot /></form>',
}

const globalStubs = {
  'el-form': FormStub,
  'el-form-item': { template: '<section><slot /></section>' },
  'el-alert': { template: '<div><slot /></div>' },
  'el-radio-group': { template: '<div><slot /></div>' },
  'el-radio-button': { template: '<button><slot /></button>' },
  'el-input': { template: '<textarea />' },
  'el-button': { template: '<button><slot /></button>' },
  'el-upload': { template: '<div><slot /></div>' },
  'el-icon': { template: '<span><slot /></span>' },
  LeaveDatePicker: true,
  LeaveFileCards: true,
}

const draftRequest = {
  id: 'request-draft',
  request_no: 'QJ-2026-00005',
  leave_type_code: 'sick',
  leave_type_name: '病假',
  start_date: '2026-01-27',
  start_half: 'morning',
  end_date: '2026-01-29',
  end_half: 'afternoon',
  reason: '动手术',
  status: 'draft',
  application_kind: 'supplement',
  combination_group_id: null,
  parent_request_id: null,
} as LeaveRequest

function attachment(
  id: string,
  leaveRequestId: string,
): LeaveAttachment {
  return {
    id,
    leave_request_id: leaveRequestId,
    file_name: `${id}.png`,
    file_size: 1024,
    mime_type: 'image/png',
    created_at: '2026-01-29T00:00:00.000Z',
  }
}

function mockDetail(attachments: LeaveAttachment[]) {
  jest.mocked(getRequestDetail).mockResolvedValueOnce({
    ...draftRequest,
    root_request_no: draftRequest.request_no,
    version_count: 1,
    attachments,
    logs: [],
    parent_request: null,
    related_requests: [],
    combination_requests: [],
  })
}

describe('请假草稿重提附件移除', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('仅允许标记当前草稿附件，并在提交时发送删除编号', async () => {
    mockDetail([
      attachment('current-attachment', draftRequest.id),
      attachment('history-attachment', 'request-history'),
    ])
    const wrapper = mount(LeaveResubmitForm, {
      props: { originalRequest: draftRequest },
      global: { stubs: globalStubs },
    })
    await flushPromises()

    const vm = wrapper.vm as unknown as {
      existingAttachmentCards: Array<{ key: string; removable: boolean }>
      removedAttachmentIds: string[]
      calculatedDays: number | null
      removeExistingAttachment: (key: string) => void
      handleSubmit: () => Promise<void>
    }
    expect(vm.existingAttachmentCards).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'current-attachment', removable: true }),
      expect.objectContaining({ key: 'history-attachment', removable: false }),
    ]))

    vm.removeExistingAttachment('history-attachment')
    expect(vm.removedAttachmentIds).toEqual([])
    vm.removeExistingAttachment('current-attachment')
    expect(vm.removedAttachmentIds).toEqual(['current-attachment'])
    expect(vm.existingAttachmentCards.map(item => item.key)).toEqual(['history-attachment'])

    vm.calculatedDays = 3
    await vm.handleSubmit()

    expect(resubmitRequest).toHaveBeenCalledTimes(1)
    const formData = jest.mocked(resubmitRequest).mock.calls[0][1]
    expect(formData.get('removedAttachmentIds')).toBe('["current-attachment"]')
    wrapper.unmount()
  })

  it('删除最后一份必传附件时必须同时上传替代文件', async () => {
    mockDetail([attachment('current-attachment', draftRequest.id)])
    const wrapper = mount(LeaveResubmitForm, {
      props: { originalRequest: draftRequest },
      global: { stubs: globalStubs },
    })
    await flushPromises()

    const vm = wrapper.vm as unknown as {
      fileList: Array<{ name: string; raw: File }>
      calculatedDays: number | null
      removeExistingAttachment: (key: string) => void
      handleSubmit: () => Promise<void>
    }
    vm.removeExistingAttachment('current-attachment')
    vm.calculatedDays = 3
    await vm.handleSubmit()
    expect(resubmitRequest).not.toHaveBeenCalled()

    vm.fileList = [{
      name: 'replacement.pdf',
      raw: new File(['replacement'], 'replacement.pdf', { type: 'application/pdf' }),
    }]
    await vm.handleSubmit()
    expect(resubmitRequest).toHaveBeenCalledTimes(1)
    const formData = jest.mocked(resubmitRequest).mock.calls[0][1]
    expect(formData.get('removedAttachmentIds')).toBe('["current-attachment"]')
    expect(formData.getAll('attachments')).toHaveLength(1)
    wrapper.unmount()
  })

  it('选择超过 5MB 的替代附件时立即移除且保留合法文件', async () => {
    mockDetail([attachment('current-attachment', draftRequest.id)])
    const wrapper = mount(LeaveResubmitForm, {
      props: { originalRequest: draftRequest },
      global: { stubs: globalStubs },
    })
    await flushPromises()

    const smallFile = { uid: 1, name: 'small.png', size: 1024 }
    const exactLimitFile = { uid: 2, name: 'exact.pdf', size: 5 * 1024 * 1024 }
    const oversizedFile = {
      uid: 3,
      name: '图片1.png',
      size: Math.ceil(21.6 * 1024 * 1024),
    }
    const vm = wrapper.vm as unknown as {
      fileList: Array<{ uid: number; name: string; size: number }>
      handleAttachmentFileChange: (file: { uid: number; name: string; size: number }) => void
    }
    vm.fileList = [smallFile, exactLimitFile, oversizedFile]
    vm.handleAttachmentFileChange(oversizedFile)
    expect(vm.fileList).toEqual([smallFile, exactLimitFile])

    vm.handleAttachmentFileChange(exactLimitFile)
    expect(vm.fileList).toEqual([smallFile, exactLimitFile])
    wrapper.unmount()
  })
})
