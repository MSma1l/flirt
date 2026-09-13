/**
 * Cardul unui eveniment din listă.
 *
 * PORT DOM al lui `mobile/src/features/events/EventCard.tsx`: aceeași ierarhie
 * vizuală (copertă → badge de tip → indicator „Mergi" → titlu → dată → loc →
 * participanți), dar cu `<div>`/`<img>` în loc de `View`/`Image`.
 *
 * Cardul e DOAR conținut: linkul către detaliu îl pune lista în jurul lui, ca
 * să nu existe două componente care își dispută navigarea.
 *
 * Memoizat din același motiv ca pe mobil: lista se re-randează la fiecare
 * invalidare a cheii `['events']` (după „Merg"/„Nu mai merg"), iar rândurile
 * ale căror date nu s-au schimbat nu au de ce să reconstruiască DOM-ul.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatEventDate, kindColorVar, kindLabel } from './eventFormat';
import type { EventItem } from './eventsApi';

import './events.css';

export interface EventCardProps {
  event: EventItem;
}

function EventCardBase({ event }: EventCardProps) {
  // `events` e catalogul mobil reutilizat (participanți), `screens` cel local
  // (badge-ul „Mergi" și etichetele de tip, care nu există pe mobil).
  const { t } = useTranslation(['events', 'screens']);

  return (
    <article className="ev-card" data-testid="event-card">
      {/*
        Coperta: imaginea evenimentului dacă există, altfel un fond colorat după
        tip. Culoarea vine ca `var(--…)`, nu ca valoare fixă — paleta e scrisă de
        `applyTheme` din tema clientului Telegram.
      */}
      <div className="ev-card__cover" style={{ background: kindColorVar(event.kind) }}>
        {event.coverUrl ? (
          <img
            className="ev-card__cover-img"
            src={event.coverUrl}
            /* Coperta e decorativă: informația utilă (titlu, dată, loc) e scrisă
               dedesubt în text, deci un `alt` gol evită o repetiție la cititorul
               de ecran. */
            alt=""
            loading="lazy"
          />
        ) : null}

        <span className="ev-card__badge">{kindLabel(event.kind)}</span>

        {event.iAmGoing ? (
          <span className="ev-card__going">{t('screens:events.goingBadge')}</span>
        ) : null}
      </div>

      <div className="ev-card__body">
        <h2 className="ev-card__title">{event.title}</h2>
        <p className="caption ev-card__meta">{formatEventDate(event.startsAt)}</p>
        <p className="caption ev-card__meta">
          {event.venue} · {event.city}
        </p>
        <p className="caption ev-card__attendees">
          {t('events:detail.attendees', { n: event.attendeeCount })}
        </p>
      </div>
    </article>
  );
}

export const EventCard = memo(EventCardBase);

export default EventCard;
