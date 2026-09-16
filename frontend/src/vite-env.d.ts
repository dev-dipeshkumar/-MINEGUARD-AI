/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute origin of the API (e.g. https://mineguard-ai.onrender.com).
   *  Unset => every request stays relative to the page origin. */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
