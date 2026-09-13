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
 * ADĂUGAT ODATĂ CU PROGRAMUL DE FIDELITATE: ecranul nu mai e o colecție, ci un
 * drum. Deasupra ștampilelor stă treapta curentă, reducerea ei și cât mai e
 * până la următoarea (`features/loyalty/LoyaltySection`), iar sub ele câmpul
 * pentru codurile de invitație primite de la organizatori
 * (`features/loyalty/InviteRedeemForm`). Amândouă sunt independente de cererea
 * de ștampile: dacă una cade, restul ecranului rămâne în picioare.
 *
 * Cardul de reduceri apare DOAR pentru planurile „card" (`card_5` / `card_10`):
 * backendul setează `entries_remaining` numai pentru ele
 * (`backend/app/models/billing.py`), deci lipsa contorului = plan fără intrări,
 * iar un card gol pe ecran ar fi o promisiune falsă.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatStampDate } from '@/features/events/eventFormat';
import {
  classifyLoadError,
  InviteRedeemForm,
  loadErrorKey,
  LoyaltySection,
} from '@/features/loyalty';

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
      <span className="pp-discount__badge">{t('profile:passport.discountCard.badge')}</span>
      <span className="pp-discount__entries">{t('profile:passport.discountCard.entriesLeft', entries)}</span>
      <span className="pp-discount__hint">{t('profile:passport.discountCard.hint')}</span>
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
      aria-label={t('profile:passport.stamp', { event: stamp.eventTitle })}
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
  // `profile` ține ștampilele și cardul de reduceri; numele produsului vine din
  // `settings:links.passport`, unde e deja scris (identic în toate limbile).
  const { t } = useTranslation(['profile', 'settings', 'screens', 'common']);

  const { data, error, isLoading, isError, isFetching, refetch } = useQuery<PassportStamp[]>({
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

  // Numele produsului NU se traduce — ca „FLIRT" sau „Flirt Party" —, dar trece
  // prin catalog ca să nu rămână un șir în cod (și ca să fie un singur loc de
  // schimbat dacă produsul se redenumește vreodată).
  const title = (
    <h1 className="title pp-screen__title">{t('settings:links.passport')}</h1>
  );

  // Ștampilele sunt DOAR una dintre secțiunile ecranului: eroarea lor nu mai
  // înlocuiește pagina, ci doar locul lor. Treapta de fidelitate și câmpul de
  // invitație rămân utile chiar dacă lista de ștampile nu se poate aduce — și
  // invers.
  let stampsBody: ReactNode;
  if (isLoading) {
    stampsBody = (
      <div className="pp-state">
        <div className="spinner" role="status" aria-label={t('settings:links.passport')} />
      </div>
    );
  } else if (isError) {
    stampsBody = (
      <div className="pp-state" data-testid="passport-error">
        {/* Două mesaje, nu unul: „fără rețea" și „serverul a picat" cer două
            acțiuni diferite de la om. */}
        <p className="error-text">{t('profile:passport.loadError')}</p>
        <p className="body-text" data-testid="passport-error-cause">
          {t(loadErrorKey(classifyLoadError(error)))}
        </p>
        <button
          type="button"
          className="button"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {t('profile:passport.retry')}
        </button>
      </div>
    );
  } else if ((data ?? []).length === 0) {
    stampsBody = (
      <div className="pp-state" data-testid="passport-empty">
        <p className="body-text">{t('profile:passport.empty')}</p>
      </div>
    );
  } else {
    stampsBody = (
      <ul className="pp-grid">
        {(data ?? []).map((stamp) => (
          <StampCard key={stamp.eventId} stamp={stamp} />
        ))}
      </ul>
    );
  }

  const discounts =
    subscription && subscription.entriesRemaining != null ? (
      <section className="pp-section">
        <h2 className="pp-section__title">{t('profile:passport.discountsTitle')}</h2>
        <DiscountCard subscription={subscription} />
      </section>
    ) : null;

  return (
    <div className="pp-screen">
      {title}
      <LoyaltySection />
      {discounts}
      {stampsBody}

      {/* Codurile de invitație nu depind de ștampile: câmpul rămâne pe ecran și
          pentru cineva care nu are încă nicio ștampilă — invitația poate fi
          chiar motivul pentru care ajunge la primul lui eveniment. */}
      <section className="pp-section">
        <h2 className="pp-section__title">{t('screens:loyalty.invite.label')}</h2>
        <InviteRedeemForm />
      </section>
    </div>
  );
}

export default PassportScreen;
