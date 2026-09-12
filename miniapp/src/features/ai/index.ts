/**
 * Fața publică a funcțiilor AI.
 *
 * Ecranele care le montează (`SettingsScreen`, `ChatScreen`) importă DOAR de
 * aici: tot ce e dedesubt — rutele, clasificarea erorilor, cheile de cache —
 * rămâne detaliu intern al folderului și se poate realinia la contractul real al
 * backendului fără să atingă niciun ecran.
 */
export { AiAssistBar } from './AiAssistBar';
export { AiSettingsSection } from './AiSettingsSection';
export { useAiEnabled } from './aiSettings';
