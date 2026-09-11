/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresa API a backendului FLIRT. Obligatorie la build de producție. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
