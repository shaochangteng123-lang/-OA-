import {
  formatAttachmentRequirementMessage,
  getAttachmentRequiredLeaveTypes,
} from '../src/utils/leaveAttachment'

const leaveTypes = [
  { code: 'annual', name: '年假', requires_attachment: false },
  { code: 'sick', name: '病假', requires_attachment: true },
  { code: 'care', name: '护理假', requires_attachment: true },
]

describe('组合请假证明文件提示', () => {
  it('只列出已选且需要证明文件的假期类型', () => {
    expect(
      getAttachmentRequiredLeaveTypes(
        ['annual', 'sick', 'sick'],
        leaveTypes
      ).map(type => type.name)
    ).toEqual(['病假'])
  })

  it('病假提示明确证明文件类型', () => {
    const requiredTypes = getAttachmentRequiredLeaveTypes(['sick'], leaveTypes)

    expect(formatAttachmentRequirementMessage(requiredTypes)).toBe(
      '病假需要上传证明文件（三甲医院病历或假条），否则无法提交'
    )
  })

  it('多个需证明假期按组合选择顺序列出', () => {
    const requiredTypes = getAttachmentRequiredLeaveTypes(
      ['care', 'sick'],
      leaveTypes
    )

    expect(formatAttachmentRequirementMessage(requiredTypes)).toBe(
      '护理假、病假需要上传证明文件，其中病假请提供三甲医院病历或假条，否则无法提交'
    )
  })
})
