/**
 * Cardul de profil, pe tot ecranul feedului.
 *
 * Echivalentul lui `mobile/src/features/feed/ProfileCard.tsx`, dar compus ca la
 * aplicațiile de dating mari: POZA e cardul, de la margine la margine, iar
 * restul plutește peste ea —
 *   - sus: indicatoarele de poze (ca la stories) și badge-ul de compatibilitate;
 *   - jos: numele, orașul, descrierea și interesele, DIRECT pe poză, fără panou.
 *     Lizibilitatea vine dintr-un gradient discret (transparent → negru 75%) și
 *     dintr-o umbră a textului, nu dintr-o cutie opacă.
 *
 * POZELE MICI (conturile de test au poze de 128px): sub poza principală stă o
 * copie a ei, încețoșată și mărită, iar poza principală, dacă e de rezoluție
 * mică, e ușor înmuiată. Mărirea arată astfel intenționată, nu pixelată.
 *
 * Comutarea pozelor la atingere NU se face aici: gestul aparține deck-ului
 * (`SwipeDeck.tsx`), singurul care știe să deosebească o atingere de un swipe.
 * Butoanele invizibile din stânga/dreapta sunt pentru TASTATURĂ (Enter/Space);
 * o atingere cu degetul e tratată de deck, deci aici ignorăm click-urile venite
 * de la pointer (`event.detail > 0`).
 *
 * Lipsesc butoanele de favorit / raportare / blocare — depind de feature-uri
 * (`social`, `moderation`) care nu sunt încă portate în Mini App.
 */
import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { FeedCard } from '@mobile/features/feed/types';

import { CompatBadge } from './CompatBadge';

/** Sub lățimea asta (px reali ai fișierului), poza e considerată mică. */
const LOW_RES_WIDTH = 480;

/** Câte interese încap pe card, ca pe nativ. */
const MAX_INTERESTS = 3;

interface Props {
  card: FeedCard;
  /** Poza afișată acum (indice în `card.photos`). */
  photoIndex?: number;
  /** Etichetele TRADUSE ale intereselor (vezi `useInterestLabels`). */
  interests?: readonly string[];
  onPrevPhoto?: () => void;
  onNextPhoto?: () => void;
  /** Id-ul elementului care descrie gesturile (pentru `aria-describedby`). */
  describedBy?: string;
}

/** Doar activarea de la tastatură; atingerea e a deck-ului. */
function keyboardOnly(action: (() => void) | undefined) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) action?.();
  };
}

export function ProfileCardView({
  card,
  photoIndex = 0,
  interests = [],
  onPrevPhoto,
  onNextPhoto,
  describedBy,
}: Props) {
  const { t } = useTranslation(['miniapp', 'screens']);
  const total = card.photos.length;
  const current = Math.max(0, Math.min(photoIndex, total - 1));
  const photo = card.photos[current];
  const initial = card.name.trim().charAt(0).toUpperCase() || '?';
  const chips = interests.slice(0, MAX_INTERESTS);
  const [lowRes, setLowRes] = useState<Record<string, boolean>>({});

  return (
    <article className="profile-card" data-testid="profile-card" aria-describedby={describedBy}>
      <div className="profile-card__media" aria-hidden="true">
        {photo ? (
          <>
            <img className="profile-card__backdrop" src={photo} alt="" draggable={false} />
            <img
              key={photo}
              className="profile-card__photo"
              data-testid="profile-card-photo"
              data-lowres={lowRes[photo] ? 'true' : undefined}
              src={photo}
              alt=""
              draggable={false}
              onLoad={(event) => {
                const width = event.currentTarget.naturalWidth;
                if (width > 0 && width < LOW_RES_WIDTH) {
                  setLowRes((prev) => (prev[photo] ? prev : { ...prev, [photo]: true }));
                }
              }}
            />
          </>
        ) : (
          <div className="profile-card__placeholder">{initial}</div>
        )}
        <div className="profile-card__scrim profile-card__scrim--top" />
        <div className="profile-card__scrim profile-card__scrim--bottom" />
      </div>

      {total > 1 ? (
        <>
          <div
            className="profile-card__pager"
            data-testid="photo-pager"
            role="img"
            aria-label={t('screens:feedCard.photoOf', { current: current + 1, total })}
          >
            {card.photos.map((url, i) => (
              <span
                key={`${url}-${i}`}
                className="profile-card__bar"
                data-active={i <= current ? 'true' : 'false'}
              />
            ))}
          </div>

          <div className="profile-card__taps" role="group" aria-label={t('screens:feedCard.photos')}>
            <button
              type="button"
              className="profile-card__tap profile-card__tap--prev"
              data-testid="photo-prev"
              aria-label={t('screens:feedCard.prevPhoto')}
              aria-disabled={current === 0}
              onClick={keyboardOnly(onPrevPhoto)}
            />
            <button
              type="button"
              className="profile-card__tap profile-card__tap--next"
              data-testid="photo-next"
              aria-label={t('screens:feedCard.nextPhoto')}
              aria-disabled={current === total - 1}
              onClick={keyboardOnly(onNextPhoto)}
            />
          </div>
        </>
      ) : null}

      <CompatBadge score={card.compatibility} />

      <div className="profile-card__info">
        <h2 className="profile-card__name">
          {card.name}, {card.age}
        </h2>
        <p className="profile-card__meta">
          {card.city}
          {card.distanceKm !== undefined
            ? ` · ${t('miniapp:feed.card.distance', { km: Math.round(card.distanceKm) })}`
            : ''}
        </p>

        {card.about ? <p className="profile-card__about">{card.about}</p> : null}

        {chips.length > 0 ? (
          <ul className="profile-card__chips" data-testid="profile-card-interests">
            {chips.map((label) => (
              <li className="profile-card__chip" key={label}>
                {label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
