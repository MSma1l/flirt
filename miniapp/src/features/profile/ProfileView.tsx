/**
 * Modul de VIZUALIZARE al profilului propriu: poza mare (hero) cu numele peste
 * ea, puterea profilului, datele de bază în carduri, „despre mine" și
 * etichetele (status + interese).
 *
 * Editarea rămâne în `ProfileScreen`; aici doar arătăm ce e pe server. Nicio
 * valoare nu e inventată: puterea profilului se calculează DOAR din câmpurile
 * pe care utilizatorul le poate completa efectiv din formular.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { VERIFICATION_PATH } from '@/features/verification/verificationRoutes';

import {
  CameraIcon,
  EditIcon,
  FlagIcon,
  GenderIcon,
  GlobeIcon,
  HeartIcon,
  HeightIcon,
  PinIcon,
  QuoteIcon,
  ShieldIcon,
  SparkIcon,
  VerifiedIcon,
} from './ProfileIcons';
import { PHOTO_LIMITS } from './photoResize';
import { interestLabel, labelOf, type MyProfileFull, type Reference } from './profileApi';

/** Deplasarea minimă (px) ca un gest să conteze drept swipe, nu atingere. */
const SWIPE_THRESHOLD = 40;

/** Inițialele din nume, pentru placeholderul fără poze. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase());
  return letters.join('') || '?';
}

interface ProfileViewProps {
  profile: MyProfileFull;
  reference: Reference;
  photos: string[];
  verificationEnabled: boolean;
  onEdit: () => void;
}

export function ProfileView({
  profile,
  reference,
  photos,
  verificationEnabled,
  onEdit,
}: ProfileViewProps) {
  const { t } = useTranslation(['profile', 'screens', 'settings', 'verification']);

  /* ------------------------------ Galeria ------------------------------ */

  const [index, setIndex] = useState(0);
  const active = photos.length > 0 ? Math.min(index, photos.length - 1) : 0;
  const swipeStart = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const go = (delta: number) => {
    if (photos.length < 2) return;
    setIndex(() => (active + delta + photos.length) % photos.length);
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
      // Swipe-ul se termină pe una din zonele de atingere; fără steagul ăsta,
      // click-ul care urmează ar muta încă o dată.
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

  /* -------------------------- Puterea profilului -------------------------- */

  // Doar ce se poate completa din formularul de alături. Verificarea intră în
  // calcul numai dacă e realmente disponibilă (sau deja obținută) — altfel am
  // cere ceva imposibil și bara n-ar ajunge niciodată la 100%.
  const checks: { key: string; label: string; done: boolean }[] = [
    {
      key: 'photos',
      label: t('screens:profileView.strength.photos', {
        min: PHOTO_LIMITS.min,
      }),
      done: photos.length >= PHOTO_LIMITS.min,
    },
    {
      key: 'about',
      label: t('screens:profileView.aboutTitle'),
      done: Boolean(profile.about?.trim()),
    },
    {
      key: 'interests',
      label: t('edit.interests'),
      done: profile.interests.length > 0,
    },
    {
      key: 'status',
      label: t('edit.datingStatus'),
      done: profile.datingStatuses.length > 0,
    },
    {
      key: 'nationality',
      label: t('screens:profileView.nationality'),
      done: Boolean(profile.nationality),
    },
    ...(profile.verified || verificationEnabled
      ? [
          {
            key: 'verified',
            label: t('screens:profileView.strength.verified'),
            done: profile.verified,
          },
        ]
      : []),
  ];
  const doneCount = checks.filter((c) => c.done).length;
  const percent = Math.round((doneCount / checks.length) * 100);
  const missing = checks.filter((c) => !c.done);

  /* ------------------------------ Datele ------------------------------ */

  const languages = profile.languages.map((v) => labelOf(reference.languages, v)).join(', ') || '—';
  const city = `${profile.city}${profile.street ? `, ${profile.street}` : ''}`;

  return (
    <>
      {/* ------------------------------- Hero ------------------------------- */}
      <section className="pf-hero">
        <div
          className="pf-hero__media"
          data-testid="profile-gallery"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            swipeStart.current = null;
          }}
        >
          {photos.length > 0 ? (
            photos.map((url, i) => (
              <img
                key={url}
                className={`pf-hero__img${i === active ? ' pf-hero__img--active' : ''}`}
                src={url}
                alt={
                  i === 0 ? t('photos.a11y.mainPhoto') : t('photos.a11y.photo', { number: i + 1 })
                }
                aria-hidden={i === active ? undefined : true}
                loading={i === 0 ? 'eager' : 'lazy'}
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
              <div
                className="pf-hero__bars"
                role="tablist"
                aria-label={t('screens:profileView.photos')}
              >
                {photos.map((url, i) => (
                  <button
                    key={url}
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
                aria-label={t('screens:profileView.prevPhoto')}
                onClick={() => onTap(-1)}
              />
              <button
                type="button"
                className="pf-hero__tap pf-hero__tap--next"
                aria-label={t('screens:profileView.nextPhoto')}
                onClick={() => onTap(1)}
              />
            </>
          ) : null}

          <div className="pf-hero__scrim" aria-hidden="true" />

          <div className="pf-hero__info">
            {/* BADGE-UL NU DEPINDE DE CAPABILITATE: un cont verificat cândva
                rămâne verificat chiar dacă funcția e oprită acum — statutul e
                al serverului, iar clientul n-are dreptul să-l ascundă. */}
            {profile.verified ? (
              <p className="pf-hero__verified" data-testid="verified-badge">
                <VerifiedIcon />
                {t('screens:profileView.verified')}
              </p>
            ) : null}
            <h1 className="pf-hero__name">{profile.name || t('edit.title')}</h1>
            <p className="pf-hero__meta">
              <PinIcon width={16} height={16} />
              {profile.age ? `${profile.age} · ` : ''}
              {profile.city}
            </p>
          </div>
        </div>

        {photos.length === 0 ? (
          <div className="pf-hero__empty">
            <p className="pf-hero__empty-title">{t('screens:profileView.noPhotosTitle')}</p>
            <p className="caption">
              {t('screens:profileView.noPhotosHint', { min: PHOTO_LIMITS.min })}
            </p>
            <button
              type="button"
              className="pf-cta pf-cta--small"
              onClick={onEdit}
              data-testid="add-photos-cta"
            >
              <CameraIcon />
              {t('screens:profileView.addPhotos')}
            </button>
          </div>
        ) : null}
      </section>

      {/* Indiciul de verificare: doar pentru contul NEverificat și doar cât
          timp serverul declară funcția disponibilă — altfel ar fi un buton
          spre o fundătură. */}
      {!profile.verified && verificationEnabled ? (
        <div className="pf-card pf-verify" data-testid="unverified-hint">
          <span className="pf-icon-badge" aria-hidden="true">
            <ShieldIcon />
          </span>
          <div className="pf-verify__body">
            <p className="caption">{t('verification:intro')}</p>
            <Link
              className="button button--ghost pf-verify__cta"
              to={VERIFICATION_PATH}
              data-testid="verify-cta"
            >
              {t('verification:start')}
            </Link>
          </div>
        </div>
      ) : null}

      {/* -------------------------- Puterea profilului ------------------------- */}
      {missing.length > 0 ? (
        <section className="pf-card pf-strength" data-testid="profile-strength">
          <div
            className="pf-strength__ring"
            role="img"
            aria-label={t('screens:profileView.strength.a11y', { percent })}
          >
            <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
              <defs>
                <linearGradient id="pf-ring-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="var(--color-link)" />
                  <stop offset="100%" stopColor="var(--color-accent)" />
                </linearGradient>
              </defs>
              <circle className="pf-strength__track" cx="32" cy="32" r="27" pathLength={100} />
              <circle
                className="pf-strength__value"
                cx="32"
                cy="32"
                r="27"
                pathLength={100}
                strokeDasharray={`${percent} 100`}
              />
            </svg>
            <span className="pf-strength__percent" aria-hidden="true">
              {percent}%
            </span>
          </div>
          <div className="pf-strength__body">
            <h2 className="pf-section-title">{t('screens:profileView.strength.title')}</h2>
            <p className="caption">{t('screens:profileView.strength.hint')}</p>
            <ul className="pf-strength__missing">
              {missing.map((c) => (
                <li key={c.key}>{c.label}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* ------------------------------ Datele de bază ------------------------------ */}
      <section className="pf-block">
        <h2 className="pf-section-title">{t('screens:profileView.infoTitle')}</h2>
        <dl className="pf-facts">
          <div className="pf-fact">
            <span className="pf-icon-badge" aria-hidden="true">
              <GenderIcon />
            </span>
            <dt className="pf-fact__label">{t('screens:profileView.gender')}</dt>
            <dd className="pf-fact__value">{labelOf(reference.genders, profile.gender)}</dd>
          </div>
          <div className="pf-fact">
            <span className="pf-icon-badge" aria-hidden="true">
              <HeightIcon />
            </span>
            <dt className="pf-fact__label">{t('screens:profileView.height')}</dt>
            <dd className="pf-fact__value">
              {profile.heightCm
                ? t('screens:profileView.heightValue', { cm: profile.heightCm })
                : '—'}
            </dd>
          </div>
          <div className="pf-fact pf-fact--wide">
            <span className="pf-icon-badge" aria-hidden="true">
              <PinIcon />
            </span>
            <dt className="pf-fact__label">{t('screens:profileView.city')}</dt>
            <dd className="pf-fact__value">{city}</dd>
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
          <div className={`pf-fact${profile.nationality ? '' : ' pf-fact--wide'}`}>
            <span className="pf-icon-badge" aria-hidden="true">
              <GlobeIcon />
            </span>
            <dt className="pf-fact__label">{t('screens:profileView.languages')}</dt>
            <dd className="pf-fact__value">{languages}</dd>
          </div>
        </dl>
      </section>

      {/* ------------------------------- Despre mine ------------------------------- */}
      {profile.about ? (
        <section className="pf-block">
          <h2 className="pf-section-title">{t('screens:profileView.aboutTitle')}</h2>
          <figure className="pf-card pf-quote">
            <QuoteIcon className="pf-quote__mark" />
            <blockquote className="pf-quote__text">{profile.about}</blockquote>
          </figure>
        </section>
      ) : null}

      {/* ---------------------------- Status + interese ---------------------------- */}
      {profile.datingStatuses.length > 0 ? (
        <section className="pf-block">
          <h2 className="pf-section-title">{t('edit.datingStatus')}</h2>
          <div className="pf-card">
            <div className="pf-chip-row">
              {profile.datingStatuses.map((v) => (
                <span className="pf-chip pf-chip--premium" key={v}>
                  <HeartIcon width={14} height={14} />
                  {labelOf(reference.datingStatuses, v)}
                </span>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {profile.interests.length > 0 ? (
        <section className="pf-block">
          <h2 className="pf-section-title">{t('edit.interests')}</h2>
          <div className="pf-card">
            <div className="pf-chip-row">
              {profile.interests.map((slug) => (
                <span className="pf-chip pf-chip--premium" key={slug}>
                  <SparkIcon width={14} height={14} />
                  {interestLabel(reference.interests, slug)}
                </span>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <button type="button" className="pf-cta" onClick={onEdit} data-testid="start-edit">
        <EditIcon />
        {t('settings:links.profileEdit')}
      </button>
    </>
  );
}
