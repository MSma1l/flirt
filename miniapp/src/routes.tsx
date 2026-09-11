/**
 * Harta rutelor + POARTA care decide ce vede utilizatorul.
 *
 * Poarta e o singură întrebare, pusă serverului: `GET /auth/me` întoarce
 * `profile_completed` (`backend/app/schemas/auth.py`, `UserOut`).
 *   fals      → ecranul de înregistrare. NU feed-ul.
 *   adevărat  → aplicația normală, cu bara de taburi.
 *
 * De ce contează atât: exact aici era problema din producție. Autentificarea
 * mergea, contul se crea, dar aplicația arăta direct feed-ul — iar feed-ul unui
 * profil necompletat e gol. Utilizatorul vedea un ecran gol și credea că
 * aplicația e stricată, fără niciun ecran prin care să-și completeze profilul.
 *
 * Rutele necompletate și cele complete sunt MUTUAL EXCLUSIVE: cât timp profilul
 * nu e gata, `/feed` pur și simplu nu există, deci nu există nici drum ocolit
 * spre el (dintr-un link, dintr-un `navigate` uitat într-un ecran).
 */
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { DeepScreen } from '@/components/DeepScreen';
import { StatusScreen } from '@/components/StatusScreen';
import { ChatListScreen } from '@/features/chat/ChatListScreen';
import { CHAT_ROUTE_PATTERN } from '@/features/chat/chatRoutes';
import { ChatScreen } from '@/features/chat/ChatScreen';
import { SwipeDeck } from '@/features/feed/SwipeDeck';
import {
  CHATS_PATH,
  FEED_PATH,
  ONBOARDING_PHOTOS_PATH,
  ONBOARDING_PROFILE_PATH,
  PROFILE_PATH,
  SETTINGS_PATH,
  WELCOME_PATH,
} from '@/features/onboarding/paths';
import { PhotosScreen } from '@/features/onboarding/PhotosScreen';
import { ProfileFormScreen } from '@/features/onboarding/ProfileFormScreen';
import { useCurrentUser } from '@/features/onboarding/useCurrentUser';
import { WelcomeScreen } from '@/features/onboarding/WelcomeScreen';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';

/** Rutele aplicației normale, sub bara de taburi. */
function CompletedRoutes() {
  const { t } = useTranslation('miniapp');
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path={FEED_PATH} element={<SwipeDeck />} />
        <Route path={CHATS_PATH} element={<ChatListScreen />} />
        <Route path={PROFILE_PATH} element={<ProfileScreen />} />
        <Route path={SETTINGS_PATH} element={<SettingsScreen />} />
      </Route>
      {/* O conversație e un ecran „în adâncime": fără taburi, cu butonul
          ÎNAPOI nativ al Telegramului legat de `DeepScreen`. */}
      <Route
        path={CHAT_ROUTE_PATTERN}
        element={
          <DeepScreen title={t('nav.chat')}>
            <ChatScreen />
          </DeepScreen>
        }
      />
      <Route path="*" element={<Navigate to={FEED_PATH} replace />} />
    </Routes>
  );
}

/** Rutele înregistrării. Cât timp profilul nu e complet, doar ele există. */
function OnboardingRoutes() {
  const { t } = useTranslation('miniapp');
  return (
    <Routes>
      <Route
        path={WELCOME_PATH}
        element={
          <div className="app-shell">
            <WelcomeScreen />
          </div>
        }
      />
      <Route
        path={ONBOARDING_PROFILE_PATH}
        element={
          <DeepScreen title={t('onboarding.title')}>
            <ProfileFormScreen />
          </DeepScreen>
        }
      />
      <Route
        path={ONBOARDING_PHOTOS_PATH}
        element={
          <DeepScreen title={t('photos.title')}>
            <PhotosScreen />
          </DeepScreen>
        }
      />
      <Route path="*" element={<Navigate to={WELCOME_PATH} replace />} />
    </Routes>
  );
}

export function AppRoutes() {
  const { t } = useTranslation('miniapp');
  const { data, isLoading, isError, refetch } = useCurrentUser();

  if (isLoading && !data) {
    return (
      <div className="app-shell">
        <div className="screen-center">
          <div className="spinner" role="status" aria-label={t('app.connecting')} />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="app-shell">
        <StatusScreen
          title={t('errors.server.title')}
          body={t('errors.server.body')}
          actions={[
            {
              label: t('actions.retry', { ns: 'common' }),
              onClick: () => void refetch(),
              testId: 'gate-retry',
            },
          ]}
        />
      </div>
    );
  }

  return data.profile_completed ? <CompletedRoutes /> : <OnboardingRoutes />;
}

export default AppRoutes;
