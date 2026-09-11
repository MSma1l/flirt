/**
 * Cardul de profil, rescris pentru DOM.
 *
 * Echivalentul lui `mobile/src/features/feed/ProfileCard.tsx`: aceleași date și
 * aceeași ierarhie vizuală, dar cu elemente HTML. Lipsesc butoanele de
 * favorit / raportare / blocare — depind de feature-uri (`social`,
 * `moderation`) care nu sunt încă portate în Mini App.
 */
import { useTranslation } from 'react-i18next';

import type { FeedCard } from '@mobile/features/feed/types';

import { CompatBadge } from './CompatBadge';

interface Props {
  card: FeedCard;
}

export function ProfileCardView({ card }: Props) {
  const { t } = useTranslation('miniapp');
  const photo = card.photos[0];
  const initial = card.name.trim().charAt(0).toUpperCase() || '?';
  const interests = card.topInterests.slice(0, 3);

  return (
    <article className="profile-card" data-testid="profile-card">
      {photo ? (
        <img className="profile-card__photo" src={photo} alt="" draggable={false} />
      ) : (
        <div className="profile-card__placeholder" aria-hidden="true">
          {initial}
        </div>
      )}

      <CompatBadge score={card.compatibility} />

      <div className="profile-card__overlay">
        <h2 className="profile-card__name">
          {card.name}, {card.age}
        </h2>
        <p className="caption" style={{ margin: 'var(--space-xs) 0 0' }}>
          {card.city}
          {card.distanceKm !== undefined
            ? ` · ${t('feed.card.distance', { km: Math.round(card.distanceKm) })}`
            : ''}
        </p>

        {card.about ? <p className="profile-card__about">{card.about}</p> : null}

        {interests.length > 0 ? (
          <div className="profile-card__chips">
            {interests.map((interest) => (
              <span className="chip" key={interest}>
                {interest}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
