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
import { Navigate, Outlet, Route, Routes } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { DeepScreen } from '@/components/DeepScreen';
import { StatusScreen } from '@/components/StatusScreen';
import { ChatListScreen } from '@/features/chat/ChatListScreen';
import { CHAT_ROUTE_PATTERN } from '@/features/chat/chatRoutes';
import { ChatScreen } from '@/features/chat/ChatScreen';
import { EventScreen } from '@/features/events/EventScreen';
import { EVENT_ROUTE_PATTERN, EVENTS_PATH } from '@/features/events/eventRoutes';
import { EventsScreen } from '@/features/events/EventsScreen';
import { SwipeDeck } from '@/features/feed/SwipeDeck';
import { HUMOR_PATH } from '@/features/humor/humorRoutes';
import { HumorScreen } from '@/features/humor/HumorScreen';
import { ConsentScreen } from '@/features/legal/ConsentScreen';
import { LegalDocumentRoute } from '@/features/legal/LegalDocumentRoute';
import {
  CONSENT_DOC_ROUTE_PATTERN,
  CONSENT_PATH,
  LEGAL_DOC_ROUTE_PATTERN,
  LEGAL_HUB_PATH,
} from '@/features/legal/legalRoutes';
import { PrivacyCenterScreen } from '@/features/legal/PrivacyCenterScreen';
import { PASSPORT_PATH } from '@/features/passport/passportRoutes';
import { PassportScreen } from '@/features/passport/PassportScreen';
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
import { BlocklistScreen } from '@/features/social/BlocklistScreen';
import { FavoritesScreen } from '@/features/social/FavoritesScreen';
import { BLOCKLIST_PATH, FAVORITES_PATH } from '@/features/social/socialRoutes';
import { STORIES_PATH } from '@/features/stories/storyRoutes';
import { StoriesScreen } from '@/features/stories/StoriesScreen';
import { SUBSCRIPTION_PATH } from '@/features/subscription/subscriptionRoutes';
import { SubscriptionScreen } from '@/features/subscription/SubscriptionScreen';
import { TICKETS_PATH } from '@/features/tickets/ticketRoutes';
import { TicketsScreen } from '@/features/tickets/TicketsScreen';
import { TicketRequestScreen } from '@/features/ticketRequests/TicketRequestScreen';
import { TICKET_REQUEST_ROUTE_PATTERN } from '@/features/ticketRequests/ticketRequestRoutes';
import { VerificationGate } from '@/features/verification/VerificationGate';
import { VERIFICATION_PATH } from '@/features/verification/verificationRoutes';
import { MORE_PATH, MoreScreen } from '@/components/MoreScreen';

/**
 * Rutele aplicației normale. TOATE stau în layout-ul `AppShell`, deci bara de
 * taburi e prezentă pe fiecare ecran, inclusiv pe cele „în adâncime"
 * (eveniment, conversație, pașaport, bilete, setări...). Înainte, ecranele
 * adânci erau rute-surori ale layout-ului și bara dispărea pe ele.
 */
function CompletedRoutes() {
  const { t } = useTranslation('miniapp');
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path={FEED_PATH} element={<SwipeDeck />} />
        <Route path={EVENTS_PATH} element={<EventsScreen />} />
        <Route path={CHATS_PATH} element={<ChatListScreen />} />
        <Route path={PROFILE_PATH} element={<ProfileScreen />} />
        <Route path={MORE_PATH} element={<MoreScreen />} />
        {/* O conversație e un ecran „în adâncime": antet cu ÎNAPOI (butonul nativ
            al Telegramului legat de `DeepScreen`), dar tot SUB bara de taburi —
            compozitorul de mesaje stă deasupra barei, nu sub ea. */}
        <Route
          path={CHAT_ROUTE_PATTERN}
          element={
            <DeepScreen title={t('nav.chat')}>
              <ChatScreen />
            </DeepScreen>
          }
        />
        {/* Ecrane „în adâncime": deschise dintr-un tab sau din meniu, cu butonul
            ÎNAPOI nativ al Telegramului legat de `DeepScreen`. Stau ÎN `AppShell`,
            deci bara de taburi rămâne vizibilă și pe ele (cerința produsului:
            bara nu dispare pe niciun ecran din aplicație). */}
        {(
          [
            [EVENT_ROUTE_PATTERN, 'nav.event', <EventScreen key="ev" />],
            [STORIES_PATH, 'nav.stories', <StoriesScreen key="st" />],
            [HUMOR_PATH, 'nav.humor', <HumorScreen key="hu" />],
            [FAVORITES_PATH, 'nav.favorites', <FavoritesScreen key="fa" />],
            [BLOCKLIST_PATH, 'nav.blocklist', <BlocklistScreen key="bl" />],
            [PASSPORT_PATH, 'nav.passport', <PassportScreen key="pa" />],
            [TICKETS_PATH, 'nav.tickets', <TicketsScreen key="ti" />],
            [TICKET_REQUEST_ROUTE_PATTERN, 'nav.event', <TicketRequestScreen key="tr" />],
            [SUBSCRIPTION_PATH, 'nav.subscription', <SubscriptionScreen key="su" />],
            [SETTINGS_PATH, 'nav.settings', <SettingsScreen key="se" />],
            [LEGAL_HUB_PATH, 'nav.privacy', <PrivacyCenterScreen key="pc" />],
          ] as const
        ).map(([path, titleKey, element]) => (
          <Route
            key={path}
            path={path}
            element={<DeepScreen title={t(titleKey)}>{element}</DeepScreen>}
          />
        ))}
        {/* Verificarea prin selfie: ecran „în adâncime", deschis din profil.
            Titlul vine din namespace-ul `verification` al cataloagelor mobile
            (deja tradus), nu din `miniapp`, de aceea nu intră în lista de mai sus.

            Ruta rămâne ÎNREGISTRATĂ chiar și când funcția e oprită pe server, iar
            `VerificationGate` decide ce se montează: fluxul, sau un mesaj scurt
            cu drum înapoi spre profil. Dacă am fi scos ruta, un link vechi ar fi
            căzut pe `*` și ar fi aruncat utilizatorul în feed, fără explicație. */}
        {/* Documentele legale (Politica, Termenii, Consimțământul), citite în
            aplicație, sub bara de taburi. Titlul vine din documentul cerut. */}
        <Route path={LEGAL_DOC_ROUTE_PATTERN} element={<LegalDocumentRoute />} />
        <Route
          path={VERIFICATION_PATH}
          element={
            <DeepScreen title={t('verification:title')}>
              <VerificationGate />
            </DeepScreen>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to={FEED_PATH} replace />} />
    </Routes>
  );
}

/** Cadrul înregistrării: același `.app-shell`, fără bara de taburi. */
function OnboardingShell() {
  return (
    <div className="app-shell">
      <Outlet />
    </div>
  );
}

/**
 * Poarta de consimțământ (Legea nr. 195/2024): cât timp serverul cere acordul
 * pentru Termeni + Politica de confidențialitate (prima intrare sau o versiune
 * nouă), DOAR ea există — fără bara de taburi, înaintea înregistrării.
 */
function ConsentRoutes() {
  return (
    <Routes>
      <Route element={<OnboardingShell />}>
        <Route path={CONSENT_PATH} element={<ConsentScreen />} />
        <Route
          path={CONSENT_DOC_ROUTE_PATTERN}
          element={<LegalDocumentRoute fallbackPath={CONSENT_PATH} />}
        />
      </Route>
      <Route path="*" element={<Navigate to={CONSENT_PATH} replace />} />
    </Routes>
  );
}

/** Rutele înregistrării. Cât timp profilul nu e complet, doar ele există. */
function OnboardingRoutes() {
  const { t } = useTranslation('miniapp');
  return (
    <Routes>
      {/* Înregistrarea e ÎNAINTEA aplicației: fără bara de taburi, intenționat —
          niciun tab nu are ce arăta unui profil necompletat. */}
      <Route element={<OnboardingShell />}>
        <Route path={WELCOME_PATH} element={<WelcomeScreen />} />
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
      </Route>
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
        <StatusScreen
          loading
          testId="status-gate-loading"
          title={t('app.connecting')}
          body={t('app.connectingBody')}
        />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="app-shell">
        <StatusScreen
          testId="status-gate-error"
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

  // `consent_required` e ADITIV: un server vechi nu-l trimite → nu blocăm.
  if (data.consent_required === true) return <ConsentRoutes />;

  return data.profile_completed ? <CompletedRoutes /> : <OnboardingRoutes />;
}

export default AppRoutes;
