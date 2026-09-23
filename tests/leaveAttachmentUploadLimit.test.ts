import fs from 'fs'
import path from 'path'

describe('请假附件上传限制错误处理', () => {
  it('四个请假上传入口统一使用中文错误包装中间件', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'server/routes/leave.ts'),
      'utf8'
    )
    expect(source).toContain("limits: {\n    files: MAX_LEAVE_ATTACHMENT_FILES")
    expect(source).toContain("error.code === 'LIMIT_FILE_SIZE'")
    expect(source).toContain("? '单个请假附件不能超过 5MB'")
    expect(source).toContain('res.status(isFileTooLarge ? 413 : 400)')
    expect(source.match(/handleLeaveAttachmentUpload,/g)).toHaveLength(4)
    expect(source).not.toContain("uploadLeaveAttachment.array('attachments', 5)")
  })

  it('全局错误处理不再把上传限制错误转换成英文服务器错误', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'server/index.ts'),
      'utf8'
    )
    expect(source).toContain('err instanceof multer.MulterError')
    expect(source).toContain('isFileTooLarge ? 413 : 400')
    expect(source).toContain('上传文件大小超过该功能限制')
  })

  it('三个请假表单都在选择文件时执行共享大小校验', () => {
    for (const file of [
      'src/components/leave/LeaveRequestForm.vue',
      'src/components/leave/LeaveRelatedRequestForm.vue',
      'src/components/leave/LeaveResubmitForm.vue',
    ]) {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
      expect(source).toContain(':on-change="handleAttachmentFileChange"')
      expect(source).toContain('getLeaveAttachmentSizeError')
      expect(source).toContain('每个不超过 5MB')
    }
  })
})
