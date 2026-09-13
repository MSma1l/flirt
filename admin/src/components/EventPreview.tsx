/**
 * Cum arată evenimentul ÎN APLICAȚIE, lângă formular, înainte de publicare.
 *
 * SURSA (citită, nu modificată): `miniapp/src/features/events/`
 *   * `EventCard.tsx`   → cardul din listă: copertă (imagine sau fond colorat pe
 *     tip) → badge de tip → titlu → dată → „loc · oraș" → participanți;
 *   * `EventScreen.tsx` → pagina evenimentului, în ORDINEA ei exactă:
 *     tip → titlu → dată → loc · oraș → descriere → promo → bilet online →
 *     hartă → participanți → „Merg" → check-in;
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

import { hasValidCoords, parseNumber, type FormState } from '../lib/eventForm';
import { fromDateTimeLocalValue } from '../lib/format';

/** `kindLabel` din `miniapp/src/features/events/eventFormat.ts`, în română. */
const KIND_LABELS: Record<string, string> = {
  flirt_party: 'Flirt Party',
  party: 'Petrecere',
  concert: 'Concert',
  bar: 'Bar',
  sport: 'Sport',
  culture: 'Cultură',
  other: 'Altele',
};

export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;

/** `kindColorVar` din miniapp: accent pentru Flirt Party, link pentru concert. */
function kindColor(kind: string): string {
  if (kind === 'flirt_party') return 'var(--color-accent)';
  if (kind === 'concert') return 'var(--color-link)';
  return 'var(--color-card-hover)';
}

/** `formatEventDate` din miniapp, cu locala panoului. */
export function previewDate(datetimeLocal: string): string {
  const iso = fromDateTimeLocalValue(datetimeLocal);
  if (iso === '') return 'Data nu e completată';
  return new Date(iso).toLocaleDateString('ro-RO', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const cover = form.cover_url.trim();
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

  const title = form.title.trim() === '' ? 'Titlul evenimentului' : form.title.trim();
  const city = form.city.trim() === '' ? 'Oraș' : form.city.trim();
  const place = form.venue.trim() === '' ? city : `${form.venue.trim()} · ${city}`;

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
    <div className="evp" aria-label="Previzualizare aplicație">
      <p className="evp__hint">
        Așa ajunge evenimentul la utilizatori. Ordinea câmpurilor e cea din aplicație.
      </p>

      <section className="evp__pane">
        <h4 className="evp__pane-title">În listă (cardul de eveniment)</h4>
        <article className="evp-card">
          <div className="evp-card__cover" style={{ background: kindColor(form.kind) }}>
            {coverState === 'ok' ? (
              <img className="evp-card__cover-img" src={cover} alt="" />
            ) : null}
            {coverState === 'broken' ? (
              <span className="evp-card__cover-note" data-testid="cover-broken">
                Adresa nu întoarce o imagine
              </span>
            ) : null}
            {coverState === 'empty' ? (
              <span className="evp-card__cover-note">Fără copertă</span>
            ) : null}
            <span className="evp-card__badge">{kindLabel(form.kind)}</span>
          </div>
          <div className="evp-card__body">
            <strong className="evp-card__title">{title}</strong>
            <span className="evp-card__meta">{previewDate(form.starts_at)}</span>
            <span className="evp-card__meta">{place}</span>
            <span className="evp-card__meta">{attendeeCount} participanți</span>
          </div>
        </article>
      </section>

      <section className="evp__pane">
        <h4 className="evp__pane-title">Pagina evenimentului</h4>
        <div className="evp-detail">
          <span className="evp-detail__pill" style={{ background: kindColor(form.kind) }}>
            {kindLabel(form.kind)}
          </span>
          <strong className="evp-detail__title">{title}</strong>
          <span className="evp-detail__date">{previewDate(form.starts_at)}</span>
          <span className="evp-detail__place">{place}</span>

          {form.description.trim() !== '' ? (
            <p className="evp-detail__desc">{form.description.trim()}</p>
          ) : (
            <p className="evp-detail__desc evp-detail__desc--empty">(fără descriere)</p>
          )}

          {hasPromo ? (
            <div className="evp-promo" data-testid="preview-promo">
              <span className="evp-promo__discount">{`−${percent}% la intrare`}</span>
              <span className="evp-promo__code">{code}</span>
              {form.promo_description.trim() !== '' ? (
                <span className="evp-promo__text">{form.promo_description.trim()}</span>
              ) : null}
            </div>
          ) : null}

          {hasTicket ? (
            <span className="evp-detail__cta" data-testid="preview-ticket">
              {`Cumpără bilet — ${price} ${currency}`}
            </span>
          ) : null}

          {onMap ? (
            <div className="evp-map" data-testid="preview-map">
              <span className="evp-map__pin">📍</span>
              <span className="mono">{`${lat}, ${lng}`}</span>
              <span className="evp-map__note">Apare pe harta din aplicație</span>
            </div>
          ) : (
            <div className="evp-map evp-map--fallback" data-testid="preview-map-fallback">
              <span className="evp-map__pin">📍 {city}</span>
              <span className="evp-map__note">
                Fără coordonate: în locul hărții rămâne doar numele orașului, iar
                evenimentul NU apare pe hartă.
              </span>
            </div>
          )}

          <span className="evp-detail__attendees">{attendeeCount} participanți</span>
          <span className="evp-detail__cta evp-detail__cta--ghost">Merg</span>
          <span className="evp-detail__cta evp-detail__cta--ghost">Check-in</span>
        </div>
      </section>
    </div>
  );
}
