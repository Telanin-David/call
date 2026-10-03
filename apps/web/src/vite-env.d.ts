/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "false" to hide the Dev button and the All screens page (do this before launch). */
  readonly VITE_DEV_TOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
