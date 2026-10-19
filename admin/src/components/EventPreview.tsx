/**
 * Cum arată evenimentul ÎN APLICAȚIE, lângă formular, înainte de publicare.
 *
 * SURSA: `miniapp/src/features/events/`
 *   * `EventCard.tsx`   → cardul din listă: copertă 2:1 (imagine încadrată sau
 *     fond colorat pe tip) → badge de tip → titlu → dată → „loc · oraș" →
 *     participanți;
 *   * `EventScreen.tsx` → pagina evenimentului, în ORDINEA ei exactă:
 *     poster 4:3 cu badge → titlu → rânduri „Când / Unde / Participanți" →
 *     descriere → promo → bilet online → locație (hartă) → „Merg" → check-in;
 *   * `coverFraming.ts` → încadrarea copertei (punct focal + zoom), aplicată
 *     IDENTIC aici prin `lib/coverFraming.ts`;
 *   * `EventMap.tsx`    → fără coordonate valide, harta e înlocuită de caseta cu
 *     orașul (`📍 Oraș`) — de aceea previzualizarea arată EXACT căderea asta,
 *     nu o hartă imaginară;
 *   * `eventFormat.ts`  → data se scrie „zi lună, oră:minut".
 *
 * NU e identic la pixel (paleta Mini App-ului vine din tema clientului Telegram,
 * aici sunt token-urile panoului), dar arată ACELEAȘI câmpuri, în aceeași ordine,
 * cu aceleași reguli de afișare — inclusiv regula care surprinde pe toată lumea:
 * blocul de promo apare DOAR când există și procent, ȘI cod.
 *
 * Datele afișate sunt text; `dangerouslySetInnerHTML` rămâne interzis.
 */
import { useEffect, useState } from 'react';

import { INTL_LOCALE, useLanguage, type Language } from '../i18n/LanguageContext';
import { coreMessages } from '../i18n/messages/core';
import { coverImageStyle } from '../lib/coverFraming';
import { hasValidCoords, parseNumber, shownAttendees, type FormState } from '../lib/eventForm';
import { fromDateTimeLocalValue } from '../lib/format';
import { previewSrc } from './MediaUploadField';

/**
 * `kindLabel` din `miniapp/src/features/events/eventFormat.ts`. Limba se dă
 * explicit (funcția e folosită și în afara acestui component, ex. în tabele).
 */
export const kindLabel = (kind: string, language: Language = 'ro'): string =>
  coreMessages[language].eventPreview.kinds[kind] ?? kind;

/** `kindColorVar` din miniapp: accent pentru Flirt Party, link pentru concert. */
function kindColor(kind: string): string {
  if (kind === 'flirt_party') return 'var(--color-accent)';
  if (kind === 'concert') return 'var(--color-link)';
  return 'var(--color-card-hover)';
}

/** `formatEventDate` din miniapp, cu locala panoului. */
export function previewDate(datetimeLocal: string, language: Language = 'ro'): string {
  const iso = fromDateTimeLocalValue(datetimeLocal);
  if (iso === '') return coreMessages[language].eventPreview.noDate;
  return new Date(iso).toLocaleDateString(INTL_LOCALE[language], {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Coordonatele scrise omenește: „47.0245° N, 28.8322° E". */
export function formatCoords(lat: number, lng: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'V';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

/** Legătura Google Maps — aceeași ca butonul „Deschide în hărți" din aplicație. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Starea încărcării copertei — singura verificare onestă că adresa e o imagine. */
type CoverState = 'empty' | 'loading' | 'ok' | 'broken';

export function EventPreview({
  form,
  attendeeCount = 0,
}: {
  form: FormState;
  attendeeCount?: number;
}): JSX.Element {
  const { language } = useLanguage();
  const m = coreMessages[language].eventPreview;
  const cover = form.cover_url.trim() === '' ? '' : previewSrc(form.cover_url.trim());
  const [coverState, setCoverState] = useState<CoverState>(cover === '' ? 'empty' : 'loading');

  // Adresa se testează CERÂND imaginea: un `https://…/pagina.html` trece orice
  // validare de formă, dar în aplicație rămâne un card gol. `new Image()` (nu un
  // `<img>` în arbore) ca schimbarea adresei în timpul tastării să nu lase
  // elemente pe jumătate încărcate în DOM.
  useEffect(() => {
    if (cover === '') {
      setCoverState('empty');
      return;
    }
    setCoverState('loading');
    const image = new Image();
    let alive = true;
    image.onload = () => {
      if (alive) setCoverState('ok');
    };
    image.onerror = () => {
      if (alive) setCoverState('broken');
    };
    image.src = cover;
    return () => {
      alive = false;
    };
  }, [cover]);

  const title = form.title.trim() === '' ? m.titlePlaceholder : form.title.trim();
  const city = form.city.trim() === '' ? m.cityPlaceholder : form.city.trim();
  const place = form.venue.trim() === '' ? city : `${form.venue.trim()} · ${city}`;
  const coverStyle = coverImageStyle({
    x: form.cover_focus_x,
    y: form.cover_focus_y,
    zoom: form.cover_zoom,
  });
  // Numărul văzut de utilizatori: `max(real, setat)` — aceeași regulă ca pe server.
  const displayed = parseNumber(form.displayed_attendee_count);
  const shown = shownAttendees(
    attendeeCount,
    displayed !== null && Number.isInteger(displayed) && displayed >= 0 ? displayed : null,
  );

  const lat = parseNumber(form.lat);
  const lng = parseNumber(form.lng);
  const onMap = hasValidCoords(lat, lng);

  const percent = parseNumber(form.promo_discount_percent);
  const code = form.promo_code.trim();
  // Regula EXACTĂ din EventScreen: `promoDiscountPercent != null && promoCode != null`.
  const hasPromo = percent !== null && Number.isFinite(percent) && code !== '';

  const price = parseNumber(form.ticket_price);
  const hasTicket = price !== null && Number.isFinite(price);
  const currency = form.ticket_currency.trim() === '' ? 'lei' : form.ticket_currency.trim();

  return (
    <div className="evp" aria-label={m.ariaLabel}>
      <p className="evp__hint">{m.hint}</p>

      <section className="evp__pane">
        <h4 className="evp__pane-title">{m.listPane}</h4>
        <article className="evp-card">
          <div className="evp-card__cover" style={{ background: kindColor(form.kind) }}>
            {coverState === 'ok' ? (
              <img className="evp-card__cover-img" src={cover} alt="" style={coverStyle} />
            ) : null}
            {coverState === 'broken' ? (
              <span className="evp-card__cover-note" data-testid="cover-broken">
                {m.coverBroken}
              </span>
            ) : null}
            {coverState === 'empty' ? (
              <span className="evp-card__cover-note">{m.noCover}</span>
            ) : null}
            <span className="evp-card__badge">{kindLabel(form.kind, language)}</span>
          </div>
          <div className="evp-card__body">
            <strong className="evp-card__title">{title}</strong>
            <span className="evp-card__meta">{previewDate(form.starts_at, language)}</span>
            <span className="evp-card__meta">{place}</span>
            <span className="evp-card__meta" data-testid="preview-card-attendees">
              {m.attendees(shown)}
            </span>
          </div>
        </article>
      </section>

      <section className="evp__pane">
        <h4 className="evp__pane-title">{m.detailPane}</h4>
        <div className="evp-detail">
          <div
            className="evp-hero"
            style={{ background: kindColor(form.kind) }}
            data-testid="preview-hero"
          >
            {coverState === 'ok' ? (
              <img className="evp-hero__img" src={cover} alt="" style={coverStyle} />
            ) : (
              <span className="evp-card__cover-note">{coverState === 'broken' ? m.coverBroken : m.noCover}</span>
            )}
            <span className="evp-card__badge">{kindLabel(form.kind, language)}</span>
          </div>
          <strong className="evp-detail__title">{title}</strong>
          <ul className="evp-facts">
            <li className="evp-fact">
              <span className="evp-fact__label">{m.when}</span>
              <span className="evp-fact__value">{previewDate(form.starts_at, language)}</span>
            </li>
            <li className="evp-fact">
              <span className="evp-fact__label">{m.where}</span>
              <span className="evp-fact__value">{form.venue.trim() === '' ? city : form.venue.trim()}</span>
              {form.venue.trim() !== '' ? <span className="evp-fact__sub">{city}</span> : null}
            </li>
            <li className="evp-fact">
              <span className="evp-fact__label">{m.participants}</span>
              <span className="evp-fact__value" data-testid="preview-detail-attendees">
                {m.attendees(shown)}
              </span>
            </li>
          </ul>

          {form.description.trim() !== '' ? (
            <p className="evp-detail__desc">{form.description.trim()}</p>
          ) : (
            <p className="evp-detail__desc evp-detail__desc--empty">{m.noDescription}</p>
          )}

          {hasPromo ? (
            <div className="evp-promo" data-testid="preview-promo">
              <span className="evp-promo__discount">{m.promo(percent)}</span>
              <span className="evp-promo__code">{code}</span>
              {form.promo_description.trim() !== '' ? (
                <span className="evp-promo__text">{form.promo_description.trim()}</span>
              ) : null}
            </div>
          ) : null}

          {hasTicket ? (
            <span className="evp-detail__cta" data-testid="preview-ticket">
              {m.buyTicket(price, currency)}
            </span>
          ) : null}

          {onMap && lat !== null && lng !== null ? (
            <div className="evp-map" data-testid="preview-map">
              <div className="evp-map__canvas" aria-hidden="true">
                <span className="evp-map__marker" />
              </div>
              <span className="evp-map__coords">{formatCoords(lat, lng)}</span>
              <span className="evp-map__note">{m.onMap}</span>
              <a
                className="evp-map__link"
                href={mapsUrl(lat, lng)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {m.openInMaps}
              </a>
            </div>
          ) : (
            <div className="evp-map evp-map--fallback" data-testid="preview-map-fallback">
              <span className="evp-map__pin">📍 {city}</span>
              <span className="evp-map__note">{m.noCoords}</span>
            </div>
          )}

          <span className="evp-detail__cta evp-detail__cta--ghost">{m.going}</span>
          <span className="evp-detail__cta evp-detail__cta--ghost">{m.checkIn}</span>
        </div>
      </section>
    </div>
  );
}
