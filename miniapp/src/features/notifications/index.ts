/** Fața publică a notificărilor din Telegram (vezi `features/ai/index.ts`). */
export { TelegramNotificationsSection } from './TelegramNotificationsSection';
export { WriteAccessCard } from './WriteAccessCard';
// Centrul de activitate. `recordProfileView` se cheamă la deschiderea unei
// ankete în detaliu (ex. profilul partenerului din chat).
export { ActivityScreen } from './ActivityScreen';
export { ACTIVITY_PATH } from './activityRoutes';
export { recordProfileView, useActivityUnread } from './activityApi';
