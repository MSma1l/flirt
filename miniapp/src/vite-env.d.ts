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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Imaginile importate din `src/assets/` — Vite le întoarce ca adresă. */
declare module '*.png' {
  const src: string;
  export default src;
}
