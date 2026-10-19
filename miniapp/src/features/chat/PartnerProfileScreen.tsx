/**
 * Profilul partenerului de conversație, deschis din chat (tap pe avatar / nume
 * în antet) sau din lista de dialoguri (tap pe avatar).
 *
 * DATELE vin din `GET /chats/{id}/partner` (`chatApi.fetchPartnerProfile`):
 * serverul îl dă DOAR participanților la conversație și îl refuză dacă există un
 * block în oricare direcție — clientul nu decide nimic despre acces.
 *
 * ASPECTUL refolosește limba vizuală a profilului propriu (clasele `pf-*` din
 * `features/profile/profile.css`): galerie mare cu bare + atingere stânga/dreapta
 * + swipe, apoi „pe scurt", „despre mine", status și interese. NU refolosim
 * `ProfileView` ca atare: e legat de profilul PROPRIU (editare, puterea
 * profilului, verificare) și nu trebuie să-i schimbăm comportamentul.
 *
 * Fără poze proprii, serverul pune în `photos` poza preluată din Telegram;
 * fără nicio poză, galeria arată inițialele.
 */
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router';

import { compatColor } from '@mobile/features/feed/compat';
import { DEFAULT_LANGUAGE, normalizeLanguage } from '@mobile/i18n/config';

import { StatusScreen } from '@/components/StatusScreen';
import {
  FlagIcon,
  GenderIcon,
  GlobeIcon,
  HeartIcon,
  HeightIcon,
  PinIcon,
  QuoteIcon,
  SparkIcon,
  VerifiedIcon,
} from '@/features/profile/ProfileIcons';
import { recordProfileView } from '@/features/notifications/activityApi';
import { fetchReference, interestLabel, labelOf } from '@/features/profile/profileApi';
import { cssVarColors } from '@/theme/tokens';

import { fetchPartnerProfile, type PartnerProfile } from './chatApi';
import { ChatIcon } from './ChatIcons';
import { CHAT_ID_PARAM, chatPath } from './chatRoutes';

import '@/features/profile/profile.css';
import './chat.css';

/** Deplasarea minimă (px) ca un gest să conteze drept swipe, nu atingere. */
const SWIPE_THRESHOLD = 40;

/** Catalogul de referință se schimbă rar. */
const REFERENCE_STALE_MS = 60 * 60 * 1000;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?';
}

/** Codul HTTP al unei erori axios (sau `null`). */
function httpStatus(error: unknown): number | null {
  return isAxiosError(error) ? (error.response?.status ?? null) : null;
}

/** Galeria: bare de progres, atingere stânga/dreapta, swipe orizontal. */
function Gallery({ profile }: { profile: PartnerProfile }) {
  const { t } = useTranslation(['profile', 'screens']);
  const photos = profile.photos;
  const [index, setIndex] = useState(0);
  const active = photos.length > 0 ? Math.min(index, photos.length - 1) : 0;
  const swipeStart = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const go = (delta: number) => {
    if (photos.length < 2) return;
    setIndex((active + delta + photos.length) % photos.length);
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    swipeStart.current = e.clientX;
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start == null) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      // Swipe-ul se termină pe o zonă de atingere: click-ul care urmează nu
      // trebuie să mute încă o dată.
      suppressClick.current = true;
      go(dx < 0 ? 1 : -1);
    }
  };
  const onTap = (delta: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    go(delta);
  };

  return (
    <section className="pf-hero">
      <div
        className="pf-hero__media"
        data-testid="partner-gallery"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
      >
        {photos.length > 0 ? (
          photos.map((url, i) => (
            <img
              key={`${url}-${i}`}
              className={`pf-hero__img${i === active ? ' pf-hero__img--active' : ''}`}
              data-testid="partner-photo"
              src={url}
              alt={i === 0 ? t('photos.a11y.mainPhoto') : t('photos.a11y.photo', { number: i + 1 })}
              aria-hidden={i === active ? undefined : true}
              loading={i === 0 ? 'eager' : 'lazy'}
              referrerPolicy="no-referrer"
              draggable={false}
            />
          ))
        ) : (
          <div className="pf-hero__placeholder">
            <span className="pf-hero__initials" aria-hidden="true">
              {initialsOf(profile.name)}
            </span>
          </div>
        )}

        {photos.length > 1 ? (
          <>
            <div className="pf-hero__bars" role="tablist" aria-label={t('screens:profileView.photos')}>
              {photos.map((url, i) => (
                <button
                  key={`${url}-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-label={t('photos.a11y.photo', { number: i + 1 })}
                  className={`pf-hero__bar${i === active ? ' pf-hero__bar--on' : ''}`}
                  onClick={() => setIndex(i)}
                />
              ))}
            </div>
            <button
              type="button"
              className="pf-hero__tap pf-hero__tap--prev"
              data-testid="partner-photo-prev"
              aria-label={t('screens:profileView.prevPhoto')}
              onClick={() => onTap(-1)}
            />
            <button
              type="button"
              className="pf-hero__tap pf-hero__tap--next"
              data-testid="partner-photo-next"
              aria-label={t('screens:profileView.nextPhoto')}
              onClick={() => onTap(1)}
            />
          </>
        ) : null}

        <div className="pf-hero__scrim" aria-hidden="true" />

        <div className="pf-hero__info">
          {profile.verified ? (
            <p className="pf-hero__verified" data-testid="partner-verified">
              <VerifiedIcon />
              {t('screens:profileView.verified')}
            </p>
          ) : null}
          <h1 className="pf-hero__name">
            {profile.name}
            {profile.age ? `, ${profile.age}` : ''}
          </h1>
          <p className="pf-hero__meta">
            <PinIcon width={16} height={16} />
            {profile.city}
          </p>
        </div>
      </div>
    </section>
  );
}

export function PartnerProfileScreen() {
  const { t, i18n } = useTranslation(['profile', 'screens', 'feed', 'common']);
  const language = normalizeLanguage(i18n.language) ?? DEFAULT_LANGUAGE;
  const navigate = useNavigate();
  const location = useLocation();
  const chatId = useParams()[CHAT_ID_PARAM] ?? '';
  // Deschis DIN conversație → „Scrie" / „Înapoi la chat" fac un pas înapoi în
  // istoric (altfel am stivui a doua oară aceeași conversație). Deschis din
  // listă → înlocuim profilul cu conversația.
  const fromChat = (location.state as { fromChat?: boolean } | null)?.fromChat === true;
  const openChat = () => {
    if (fromChat) void navigate(-1);
    else void navigate(chatPath(chatId), { replace: true });
  };

  const profileQuery = useQuery({
    queryKey: ['chat-partner', chatId],
    queryFn: () => fetchPartnerProfile(chatId),
    enabled: !!chatId,
    // 403 / 404 sunt răspunsuri definitive (block, chat străin): fără reîncercări.
    retry: (count, error) => {
      const code = httpStatus(error);
      return code !== 403 && code !== 404 && count < 2;
    },
  });
  const referenceQuery = useQuery({
    queryKey: ['profile-reference', language],
    queryFn: () => fetchReference(language),
    staleTime: REFERENCE_STALE_MS,
  });

  // Deschiderea profilului din chat contează ca vizualizare (centrul de activitate).
  const viewedUserId = profileQuery.data?.userId;
  useEffect(() => {
    if (viewedUserId) recordProfileView(viewedUserId);
  }, [viewedUserId]);

  if (profileQuery.isPending) {
    return (
      <StatusScreen
        loading
        testId="partner-loading"
        title={t('screens:chat.partner.loading')}
      />
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    const code = httpStatus(profileQuery.error);
    const unavailable = code === 403 || code === 404;
    return (
      <StatusScreen
        testId="partner-error"
        title={t(unavailable ? 'screens:chat.partner.unavailableTitle' : 'screens:chat.partner.errorTitle')}
        body={t(unavailable ? 'screens:chat.partner.unavailableBody' : 'screens:chat.partner.errorBody')}
        actions={[
          ...(unavailable
            ? []
            : [
                {
                  label: t('common:actions.retry'),
                  onClick: () => void profileQuery.refetch(),
                  testId: 'partner-retry',
                },
              ]),
          {
            label: t('screens:chat.partner.backToChat'),
            onClick: openChat,
            testId: 'partner-back',
          },
        ]}
      />
    );
  }

  const profile = profileQuery.data;
  const reference = referenceQuery.data;
  const genderLabel = reference ? labelOf(reference.genders, profile.gender) : '';
  const languages = reference
    ? profile.languages.map((v) => labelOf(reference.languages, v)).join(', ')
    : '';
  const interests = reference
    ? profile.interests.map((slug) => interestLabel(reference.interests, slug))
    : [];
  const statuses = reference
    ? profile.datingStatuses.map((v) => labelOf(reference.datingStatuses, v))
    : [];

  return (
    <div className="profile-screen profile-screen--view partner-profile" data-testid="partner-profile">
      <Gallery profile={profile} />

      <div className="partner-profile__actions">
        <span
          className="chat-header__compat partner-profile__compat"
          style={{ '--compat-color': compatColor(profile.compatibility, cssVarColors) } as React.CSSProperties}
          data-testid="partner-compat"
        >
          <ChatIcon name="heart" size={12} />
          {t('screens:chat.partner.compatibility', { score: profile.compatibility })}
        </span>
        <button
          type="button"
          className="button partner-profile__write"
          data-testid="partner-write"
          onClick={openChat}
        >
          {t('screens:chat.partner.write')}
        </button>
      </div>

      <section className="pf-block">
        <h2 className="pf-section-title">{t('screens:profileView.infoTitle')}</h2>
        <dl className="pf-facts">
          {genderLabel ? (
            <div className="pf-fact">
              <span className="pf-icon-badge" aria-hidden="true">
                <GenderIcon />
              </span>
              <dt className="pf-fact__label">{t('screens:profileView.gender')}</dt>
              <dd className="pf-fact__value">{genderLabel}</dd>
            </div>
          ) : null}
          {profile.heightCm ? (
            <div className="pf-fact">
              <span className="pf-icon-badge" aria-hidden="true">
                <HeightIcon />
              </span>
              <dt className="pf-fact__label">{t('screens:profileView.height')}</dt>
              <dd className="pf-fact__value">
                {t('screens:profileView.heightValue', { cm: profile.heightCm })}
              </dd>
            </div>
          ) : null}
          <div className="pf-fact pf-fact--wide">
            <span className="pf-icon-badge" aria-hidden="true">
              <PinIcon />
            </span>
            <dt className="pf-fact__label">{t('screens:profileView.city')}</dt>
            <dd className="pf-fact__value">{profile.city}</dd>
          </div>
          {profile.nationality ? (
            <div className="pf-fact">
              <span className="pf-icon-badge" aria-hidden="true">
                <FlagIcon />
              </span>
              <dt className="pf-fact__label">{t('screens:profileView.nationality')}</dt>
              <dd className="pf-fact__value">{profile.nationality}</dd>
            </div>
          ) : null}
          {languages ? (
            <div className={`pf-fact${profile.nationality ? '' : ' pf-fact--wide'}`}>
              <span className="pf-icon-badge" aria-hidden="true">
                <GlobeIcon />
              </span>
              <dt className="pf-fact__label">{t('screens:profileView.languages')}</dt>
              <dd className="pf-fact__value">{languages}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {profile.about ? (
        <section className="pf-block">
          <h2 className="pf-section-title">{t('screens:chat.partner.aboutTitle')}</h2>
          <figure className="pf-card pf-quote">
            <QuoteIcon className="pf-quote__mark" />
            <blockquote className="pf-quote__text" data-testid="partner-about">
              {profile.about}
            </blockquote>
          </figure>
        </section>
      ) : null}

      {statuses.length > 0 ? (
        <section className="pf-block">
          <h2 className="pf-section-title">{t('edit.datingStatus')}</h2>
          <div className="pf-card">
            <div className="pf-chip-row">
              {statuses.map((label) => (
                <span className="pf-chip pf-chip--premium" key={label}>
                  <HeartIcon width={14} height={14} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {interests.length > 0 ? (
        <section className="pf-block">
          <h2 className="pf-section-title">{t('edit.interests')}</h2>
          <div className="pf-card">
            <div className="pf-chip-row" data-testid="partner-interests">
              {interests.map((label) => (
                <span className="pf-chip pf-chip--premium" key={label}>
                  <SparkIcon width={14} height={14} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default PartnerProfileScreen;
