/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "false" to hide the Dev button and the All screens page (do this before launch). */
  readonly VITE_DEV_TOOLS?: string;
  /**
   * The api's address, e.g. "https://api.dialer.app", or "/api" with the dev
   * server's proxy. Unset means demo mode: every screen shows fake data.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
