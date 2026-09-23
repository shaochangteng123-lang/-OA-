export interface AttachmentRequiredLeaveType {
  code: string
  name: string
  requires_attachment: boolean
}

export const MAX_LEAVE_ATTACHMENT_BYTES = 5 * 1024 * 1024

export function getLeaveAttachmentSizeError(
  fileName: string,
  fileSize: number | null | undefined
): string | null {
  if (typeof fileSize !== 'number' || fileSize <= MAX_LEAVE_ATTACHMENT_BYTES) return null
  return `${fileName} 超过 5MB，单个请假附件不能超过 5MB`
}

export function getAttachmentRequiredLeaveTypes(
  selectedTypeCodes: string[],
  leaveTypes: AttachmentRequiredLeaveType[]
): AttachmentRequiredLeaveType[] {
  const typeMap = new Map(leaveTypes.map(type => [type.code, type]))
  const requiredTypes: AttachmentRequiredLeaveType[] = []
  const addedCodes = new Set<string>()

  for (const code of selectedTypeCodes) {
    if (!code || addedCodes.has(code)) continue
    const type = typeMap.get(code)
    if (!type?.requires_attachment) continue
    requiredTypes.push(type)
    addedCodes.add(code)
  }

  return requiredTypes
}

export function formatAttachmentRequirementMessage(
  requiredTypes: AttachmentRequiredLeaveType[]
): string {
  if (requiredTypes.length === 0) return ''

  const typeNames = requiredTypes.map(type => type.name).join('、')
  if (requiredTypes.length === 1 && requiredTypes[0].code === 'sick') {
    return '病假需要上传证明文件（三甲医院病历或假条），否则无法提交'
  }

  const sickHint = requiredTypes.some(type => type.code === 'sick')
    ? '，其中病假请提供三甲医院病历或假条'
    : ''
  return `${typeNames}需要上传证明文件${sickHint}，否则无法提交`
}
