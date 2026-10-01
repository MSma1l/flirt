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

import { QrCode } from '@/features/tickets/QrCode';

import {
  fetchMySubscription,
  fetchPassport,
  fetchPassportQr,
  type PassportQr,
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

/**
 * Permisul de intrare: QR-ul personal pe care staff-ul îl scanează la ușă.
 * Biletul online se găsește automat după el; cine plătește cash la intrare e
 * înregistrat tot prin el (și primește ștampila). Ca și restul secțiunilor,
 * eroarea lui rămâne în cardul lui.
 */
function EntryPassCard() {
  const { t } = useTranslation('screens');
  const { data, isLoading, isError, isFetching, refetch } = useQuery<PassportQr>({
    queryKey: ['passport-qr'],
    queryFn: fetchPassportQr,
  });

  let body: ReactNode;
  if (isLoading) {
    body = <div className="spinner" role="status" aria-label={t('passport.qr.title')} />;
  } else if (isError || !data) {
    body = (
      <div className="pp-pass__error" data-testid="passport-qr-error">
        <p className="error-text">{t('passport.qr.error')}</p>
        <button type="button" className="button" disabled={isFetching} onClick={() => void refetch()}>
          {t('passport.qr.retry')}
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <QrCode value={data.qrPayload} size={200} label={t('passport.qr.alt')} testId="passport-qr" showCode={false} />
        <p className="pp-pass__show">{t('passport.qr.show')}</p>
        <ul className="pp-pass__notes">
          <li>{t('passport.qr.online')}</li>
          <li>{t('passport.qr.cash')}</li>
        </ul>
        {data.paymentCode ? (
          <p className="caption pp-pass__code" data-testid="passport-payment-code">
            {t('passport.qr.paymentCode', { code: data.paymentCode })}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section className="pp-section pp-pass" data-testid="passport-pass">
      <h2 className="pp-section__title">{t('passport.qr.title')}</h2>
      {body}
    </section>
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
      {/* Sigiliul rotit din colț: ștampila arată ca una pusă cu mâna. */}
      <span className="pp-stamp__seal" aria-hidden="true">
        FLIRT
      </span>
      <span className="pp-stamp__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M14 5v12" stroke="currentColor" strokeWidth="1.7" strokeDasharray="2 2" />
        </svg>
      </span>
      <span className="pp-stamp__title">{stamp.eventTitle}</span>
      <span className="caption pp-stamp__city">{stamp.city}</span>
      <span className="pp-stamp__divider" aria-hidden="true" />
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
      <section className="pp-section">
        <h2 className="pp-section__title">
          {t('screens:passport.stampsTitle')}
          <span className="pp-section__count">{(data ?? []).length}</span>
        </h2>
        <ul className="pp-grid">
          {(data ?? []).map((stamp) => (
            <StampCard key={stamp.eventId} stamp={stamp} />
          ))}
        </ul>
      </section>
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
      <EntryPassCard />
      <LoyaltySection />
      {discounts}
      {stampsBody}

      {/* Codurile de invitație nu depind de ștampile: câmpul rămâne pe ecran și
          pentru cineva care nu are încă nicio ștampilă — invitația poate fi
          chiar motivul pentru care ajunge la primul lui eveniment. */}
      {/* Eticheta formularului e deja titlul cardului; un al doilea antet cu
          același text ar repeta-o. */}
      <section className="pp-section">
        <InviteRedeemForm />
      </section>
    </div>
  );
}

export default PassportScreen;
