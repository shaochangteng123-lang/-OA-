/** @jest-environment node */

import fs from 'fs'
import path from 'path'

describe('团队日志图片鉴权预览', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src/views/TeamDailyLogs.vue'),
    'utf8',
  )

  it('缩略图和大图预览均按附件编号访问鉴权接口', () => {
    expect(source).toContain(':src="getAttachmentPreviewUrl(att)"')
    expect(source).toContain(
      ':preview-src-list="getImages(sub.attachments).map(getAttachmentPreviewUrl)"',
    )
    expect(source).toContain(
      'return `/api/daily-logs/team/attachments/${att.id}/preview`',
    )
  })

  it('图片展示不再直接拼接上传目录路径', () => {
    expect(source).not.toContain(':src="`/${att.filePath}`"')
    expect(source).not.toContain('.map(a => `/${a.filePath}`)')
  })
})
