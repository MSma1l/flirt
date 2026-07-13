/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Baza API-ului backend, ex. https://api.flirt.app (fără `/api/v1`). */
  readonly VITE_API_URL?: string;
  /** Alias istoric, păstrat pentru compatibilitate cu `.env` existente. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
