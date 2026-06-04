/// <reference types="vite/client" />

declare const __ENABLE_WORKLOG__: boolean

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_ENABLE_WORKLOG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
