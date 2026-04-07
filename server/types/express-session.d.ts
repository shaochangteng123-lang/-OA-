import 'express-session'

declare module 'express-session' {
  interface SessionData {
    isLoggedIn: boolean
    userId: string
    user: {
      id: string
      name: string
      email: string | null
      role: string
      avatar_url: string | null
    }
    // 当前 session 上传的草稿发票文件路径列表，用于草稿预览权限校验
    uploadedInvoiceFiles: string[]
  }
}
