/**
 * Abonamente (TZ secț. 9) pentru Mini App — VITRINĂ, nu casă de marcat.
 *
 * PORT DOM al lui `mobile/app/paywall.tsx`, din care lipsește INTENȚIONAT tot
 * fluxul de plată: niciun `POST /subscriptions/purchase`, nicio integrare cu
 * Telegram Payments / Stars, niciun `receipt`, niciun buton de restaurare.
 *
 * DE CE: pe mobil, achiziția trece obligatoriu prin App Store / Google Play
 * (Guideline 3.1.1), iar dovada de plată semnată de magazin e singurul lucru pe
 * care backend-ul îl acceptă. Un buton „Cumpără" în Telegram ar duce fie într-un
 * 402, fie la un al doilea canal de plată pe care nimeni nu l-a decis. Deci
 * ecranul arată onest catalogul și starea abonamentului, iar butonul e
 * DEZACTIVAT, cu un mesaj care spune unde se cumpără de fapt.
 *
 * Datele vin din `backend/app/api/v1/subscriptions.py`:
 *   GET /subscriptions/plans, /subscriptions/me (poate fi `null`),
 *   /subscriptions/entitlements.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchEntitlements, fetchMySubscription, fetchPlans } from './subscriptionApi';
import type { Entitlements, Plan, Subscription } from './subscriptionApi';

import './subscription.css';

/**
 * Mesajul onest despre plată. E scris ÎN COD, în română, nu luat din catalog:
 * cheia potrivită (`billing:paywall.telegramUnavailable`) nu există încă, iar
 * sarcina interzice modificarea cataloagelor. `paywall.storeUnavailable` ar fi
 * fost o minciună — nu magazinul e căzut, ci Mini App-ul nu vinde deloc.
 * Cheia lipsă e raportată separat.
 */
const PURCHASE_UNAVAILABLE_TEXT =
  'Plata nu este disponibilă în Telegram deocamdată. ' +
  'Abonamentul poate fi cumpărat din aplicația mobilă FLIRT, iar aici vezi planurile și starea lui.';

/** Eticheta butonului dezactivat. Tot text propriu, din același motiv. */
const PURCHASE_UNAVAILABLE_LABEL = 'Disponibil în aplicația mobilă';

/**
 * Planurile pe care catalogul clientului le cunoaște.
 *
 * Regula e copiată din mobil: `title` și `features` vin de la server DOAR în
 * română, dar codul planului e stabil, deci îl folosim drept cheie de traducere.
 * Un plan adăugat pe server între două versiuni de client își păstrează textele
 * serverului: mai bine în română decât deloc.
 */
const TRANSLATED_PLANS = [
  'premium',
  'no_ads',
  'ai_bot',
  'all_inclusive',
  'card_5',
  'card_10',
] as const;

type TranslatedPlan = (typeof TRANSLATED_PLANS)[number];

function isTranslatedPlan(code: string): code is TranslatedPlan {
  return (TRANSLATED_PLANS as readonly string[]).includes(code);
}

/**
 * Beneficiile din catalogul i18n, dacă sunt chiar o listă de texte.
 *
 * `t(..., { returnObjects: true })` nu garantează nimic la rulare (o cheie
 * lipsă întoarce cheia însăși, ca șir). Validăm forma și, la orice abatere,
 * întoarcem `null` ca apelantul să cadă pe lista serverului — un card fără
 * beneficii ar arăta ca un plan gol, nu ca o traducere lipsă.
 */
function asFeatureList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const items: unknown[] = raw;
  const features: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') return null;
    features.push(item);
  }
  return features.length > 0 ? features : null;
}

/**
 * Starea abonamentului, în română. Serverul trimite un cod (`active`,
 * `expired`, …) — un cod brut pe ecran n-ar spune nimic userului, dar unul
 * NECUNOSCUT îl arătăm ca atare: mai bine un cuvânt ciudat decât o stare
 * inventată de client. Cheile de traducere lipsesc, vezi raportul.
 */
function statusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Activ';
    case 'expired':
      return 'Expirat';
    case 'cancelled':
    case 'canceled':
      return 'Anulat';
    default:
      return status;
  }
}

/**
 * Data expirării, scrisă în limba INTERFEȚEI (nu fix `ro-RO`) — aceeași regulă
 * ca la evenimente. O dată nevalidă (sau lipsă: `expires_at` e opțional în
 * `backend/app/schemas/billing.py`) nu se afișează deloc, ca să nu ajungă
 * „Invalid Date" pe ecran.
 */
function formatExpiry(iso: string | null | undefined, language: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleDateString(language, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return date.toLocaleDateString();
  }
}

/** Drepturile deblocate, cu etichete proprii (cataloagele nu au chei pentru ele). */
const ENTITLEMENT_LABELS: ReadonlyArray<{ key: keyof Entitlements; label: string }> = [
  { key: 'premium', label: 'Premium' },
  { key: 'noAds', label: 'Fără reclamă' },
  { key: 'aiBot', label: 'AI-bot în chat' },
  { key: 'eventDiscount', label: 'Reduceri la evenimente' },
];

export function SubscriptionScreen(): ReactElement {
  const { t, i18n } = useTranslation('billing');

  const plansQuery = useQuery<Plan[]>({ queryKey: ['plans'], queryFn: fetchPlans });
  const meQuery = useQuery<Subscription | null>({
    queryKey: ['subscription'],
    queryFn: fetchMySubscription,
  });
  const entitlementsQuery = useQuery<Entitlements>({
    queryKey: ['entitlements'],
    queryFn: fetchEntitlements,
  });

  const title = <h1 className="title sb-title">{t('paywall.title')}</h1>;

  if (plansQuery.isPending) {
    return (
      <div className="sb-state">
        <div className="spinner" role="status" aria-label={t('paywall.title')} />
      </div>
    );
  }

  // Doar catalogul oprește ecranul. Abonamentul și drepturile sunt informație
  // suplimentară: dacă ele cad, planurile tot trebuie să se vadă.
  if (plansQuery.isError || !plansQuery.data) {
    return (
      <div className="sb-state" data-testid="subscription-error">
        <p className="error-text">{t('paywall.loadError')}</p>
        <button
          type="button"
          className="button"
          disabled={plansQuery.isFetching}
          onClick={() => {
            void plansQuery.refetch();
            void meQuery.refetch();
            void entitlementsQuery.refetch();
          }}
        >
          {t('paywall.retry')}
        </button>
      </div>
    );
  }

  const plans = plansQuery.data;

  if (plans.length === 0) {
    return (
      <div className="sb-screen">
        {title}
        <div className="sb-state" data-testid="subscription-empty">
          <p className="body-text">Nu există planuri de abonament disponibile momentan.</p>
        </div>
      </div>
    );
  }

  const subscription = meQuery.data ?? null;
  const currentPlan = subscription?.plan ?? null;
  const entitlements = entitlementsQuery.data ?? null;
  const activeEntitlements = entitlements
    ? ENTITLEMENT_LABELS.filter((item) => entitlements[item.key])
    : [];
  const expiry = formatExpiry(subscription?.expiresAt, i18n.language);

  return (
    <div className="sb-screen">
      {title}

      {/* Mesajul stă SUS, înaintea prețurilor: userul află că nu poate cumpăra
          aici înainte să-și aleagă un plan, nu după. */}
      <p className="body-text sb-notice" data-testid="purchase-unavailable">
        {PURCHASE_UNAVAILABLE_TEXT}
      </p>

      {subscription ? (
        <section className="sb-current" data-testid="subscription-current">
          <h2 className="sb-current__title">
            {isTranslatedPlan(subscription.plan)
              ? t(`plans.${subscription.plan}.title`)
              : subscription.plan}
          </h2>
          <p className="caption sb-current__line">
            Stare: {statusLabel(subscription.status)}
          </p>
          {expiry ? <p className="caption sb-current__line">Valabil până la {expiry}</p> : null}
          {/* Cardurile de reduceri se consumă la fiecare check-in: câte intrări
              au mai rămas e singura cifră care contează pentru ele. */}
          {subscription.entriesRemaining !== null ? (
            <p className="caption sb-current__line" data-testid="subscription-entries">
              Intrări rămase: {subscription.entriesRemaining}
              {subscription.entriesTotal !== null ? ` din ${subscription.entriesTotal}` : ''}
            </p>
          ) : null}
          {activeEntitlements.length > 0 ? (
            <ul className="sb-current__entitlements">
              {activeEntitlements.map((item) => (
                <li key={item.key} className="caption">
                  ✓ {item.label}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <p className="caption sb-current__none" data-testid="subscription-none">
          Nu ai un abonament activ.
        </p>
      )}

      <ul className="sb-plans">
        {plans.map((plan) => {
          const code = plan.code;
          const isActive = code === currentPlan;
          const planTitle = isTranslatedPlan(code) ? t(`plans.${code}.title`) : plan.title;
          const features =
            (isTranslatedPlan(code)
              ? asFeatureList(t(`plans.${code}.features`, { returnObjects: true }))
              : null) ?? plan.features;

          return (
            <li
              key={code}
              className={isActive ? 'sb-plan sb-plan--active' : 'sb-plan'}
              data-testid={`plan-card-${code}`}
            >
              <div className="sb-plan__head">
                <h2 className="sb-plan__title">{planTitle}</h2>
                {isActive ? (
                  <span className="sb-plan__badge" data-testid={`plan-card-${code}-active`}>
                    {t('paywall.active')}
                  </span>
                ) : null}
              </div>

              <p className="sb-plan__price">
                {t('paywall.priceFallback', { price: plan.priceEur })}
              </p>

              {features.length > 0 ? (
                <ul className="sb-plan__features">
                  {features.map((feature) => (
                    <li key={feature} className="sb-plan__feature">
                      <span className="sb-plan__check" aria-hidden="true">
                        ✓
                      </span>
                      <span className="body-text">{feature}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* Butonul există, dar e mort: un card fără niciun buton ar părea
                  o listă de prețuri fără rost, iar unul activ ar minți. */}
              <button
                type="button"
                className="button button--ghost sb-plan__cta"
                data-testid={`plan-card-${code}-buy`}
                disabled
              >
                {isActive ? t('paywall.planActive') : PURCHASE_UNAVAILABLE_LABEL}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default SubscriptionScreen;
