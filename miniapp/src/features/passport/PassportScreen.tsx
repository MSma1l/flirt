/**
 * Flirt Passport (TZ secț. 8) în Mini App: ștampilele primite la check-in-ul
 * evenimentelor + cardul de reduceri.
 *
 * PORT DOM al lui `mobile/app/passport.tsx`, cu aceeași structură: antet,
 * secțiunea „Reducerile mele" (când există un card activ) și grila de ștampile.
 *
 * DIFERENȚE deliberate față de ecranul nativ:
 *  - data ștampilei trece prin `formatStampDate` (zi + lună + an, fără oră).
 *    Mobilul folosește `formatEventDate`, care adaugă ora — dar ștampila nu e o
 *    programare, ci o amintire: ora la care ai intrat la petrecere nu spune
 *    nimic, iar pe un rând îngust fură spațiu de la titlul evenimentului;
 *  - abonamentul stă pe cheia `['subscription']` (în Mini App asta e cheia
 *    folosită de restul modulelor pentru `GET /subscriptions/me`).
 *
 * Cardul de reduceri apare DOAR pentru planurile „card" (`card_5` / `card_10`):
 * backendul setează `entries_remaining` numai pentru ele
 * (`backend/app/models/billing.py`), deci lipsa contorului = plan fără intrări,
 * iar un card gol pe ecran ar fi o promisiune falsă.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { formatStampDate } from '@/features/events/eventFormat';

import {
  fetchMySubscription,
  fetchPassport,
  type PassportStamp,
  type Subscription,
} from './passportApi';

import './passport.css';

/** Contorul „Card reduceri": câte intrări i-au rămas utilizatorului. */
function DiscountCard({ subscription }: { subscription: Subscription }) {
  const { t } = useTranslation('profile');
  const { entriesRemaining, entriesTotal } = subscription;
  if (entriesRemaining == null) return null;

  // Numărul de intrări trece prin plural: româna are trei forme (1 intrare /
  // 3 intrări / 21 DE intrări), rusa patru. `count` e cel RĂMAS — el e subiectul
  // frazei — iar totalul intră ca simplă interpolare.
  const entries = { count: entriesRemaining, total: entriesTotal ?? entriesRemaining };

  return (
    <div
      className="pp-discount"
      data-testid="passport-discount-card"
      aria-label={t('passport.discountCard.a11y', entries)}
    >
      <span className="pp-discount__badge">{t('passport.discountCard.badge')}</span>
      <span className="pp-discount__entries">{t('passport.discountCard.entriesLeft', entries)}</span>
      <span className="pp-discount__hint">{t('passport.discountCard.hint')}</span>
    </div>
  );
}

/** O ștampilă din grilă: titlu eveniment, oraș, dată. */
function StampCard({ stamp }: { stamp: PassportStamp }) {
  const { t } = useTranslation('profile');
  return (
    <li
      className="pp-stamp"
      data-testid="passport-stamp"
      aria-label={t('passport.stamp', { event: stamp.eventTitle })}
    >
      <span className="pp-stamp__icon" aria-hidden="true">
        🎫
      </span>
      <span className="pp-stamp__title">{stamp.eventTitle}</span>
      <span className="caption pp-stamp__city">{stamp.city}</span>
      <span className="pp-stamp__date">{formatStampDate(stamp.stampedAt)}</span>
    </li>
  );
}

export function PassportScreen() {
  const { t } = useTranslation('profile');

  const { data, isLoading, isError, isFetching, refetch } = useQuery<PassportStamp[]>({
    queryKey: ['passport'],
    queryFn: fetchPassport,
  });

  // Abonamentul e ACCESORIU: dacă cererea lui pică, passportul rămâne pe ecran
  // fără cardul de reduceri. De aceea eroarea lui nu e tratată — nu are ce
  // ecran de eroare să justifice.
  const { data: subscription } = useQuery<Subscription | null>({
    queryKey: ['subscription'],
    queryFn: fetchMySubscription,
  });

  // Numele produsului NU se traduce — ca „FLIRT" sau „Flirt Party".
  const title = <h1 className="title pp-screen__title">Flirt Passport</h1>;

  if (isLoading) {
    return (
      <div className="pp-screen">
        {title}
        <div className="pp-state">
          <div className="spinner" role="status" aria-label="Flirt Passport" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="pp-screen">
        {title}
        <div className="pp-state" data-testid="passport-error">
          <p className="error-text">{t('passport.loadError')}</p>
          <button
            type="button"
            className="button"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {t('passport.retry')}
          </button>
        </div>
      </div>
    );
  }

  const stamps = data ?? [];
  const discounts =
    subscription && subscription.entriesRemaining != null ? (
      <section className="pp-section">
        <h2 className="pp-section__title">{t('passport.discountsTitle')}</h2>
        <DiscountCard subscription={subscription} />
      </section>
    ) : null;

  return (
    <div className="pp-screen">
      {title}
      {discounts}
      {stamps.length === 0 ? (
        <div className="pp-state" data-testid="passport-empty">
          <p className="body-text">{t('passport.empty')}</p>
        </div>
      ) : (
        <ul className="pp-grid">
          {stamps.map((stamp) => (
            <StampCard key={stamp.eventId} stamp={stamp} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default PassportScreen;
