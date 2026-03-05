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
  }
}
