/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresa API a backendului FLIRT. Obligatorie la build de producție. */
  readonly VITE_API_URL?: string;
  /**
   * Numele botului Telegram (fără `@`), injectat la build de
   * `backend/scripts/build_miniapp.sh`. Când lipsește, butonul
   * „Deschide în Telegram" nu se afișează deloc.
   */
  readonly VITE_TELEGRAM_BOT_USERNAME?: string;
  /**
   * Paginile legale. Opționale: când lipsesc, se derivă din `VITE_API_URL`,
   * fiindcă backendul le servește pe același host (`/legal/*`). Vezi
   * `resolveLegalUrls` din `config.ts`.
   */
  readonly VITE_TERMS_URL?: string;
  readonly VITE_PRIVACY_URL?: string;
  readonly VITE_SUPPORT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Imaginile importate din `src/assets/` — Vite le întoarce ca adresă. */
declare module '*.png' {
  const src: string;
  export default src;
}
