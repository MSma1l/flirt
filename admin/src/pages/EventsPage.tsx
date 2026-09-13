/**
 * Evenimente: listă căutabilă + CREARE / EDITARE / ȘTERGERE, cu previzualizare.
 *
 * Ecranul ăsta e SINGURA sursă de evenimente pentru aplicație: `POST /events` nu
 * există în API-ul public, iar seed-ul demo e blocat în producție. Dacă aici nu
 * se creează nimic, ecranul „Flirt Party" din Mini App rămâne gol la nesfârșit.
 *
 * Trei decizii care se văd în cod:
 *
 * 1. VALIDAREA e oglinda schemelor backendului și stă în `lib/eventForm.ts`,
 *    lângă comentariile care spun din ce regulă Pydantic vine fiecare linie.
 *    Panoul nu mai trimite payload-uri care se întorc cu 422 fără explicații.
 * 2. PREVIZUALIZAREA (`components/EventPreview.tsx`) arată aceleași câmpuri, în
 *    aceeași ordine ca `miniapp/src/features/events/`, INCLUSIV căderile:
 *    fără coordonate nu există hartă, fără cod promo nu există bloc de promo.
 * 3. ȘTERGEREA spune ce se pierde (participanți, comenzi de bilet, bilete deja
 *    aprobate), iar când există bilete APROBATE cere tastarea titlului — o
 *    ștergere oarbă acolo înseamnă bani încasați pentru un eveniment care nu
 *    mai există.
 *
 * Filtrarea/sortarea/căutarea sunt pe CLIENT, intenționat: lista de admin vine
 * într-o pagină (cursor), numărul de evenimente e de ordinul zecilor, iar un
 * filtru instantaneu, fără dus-întors la server, e exact ce trebuie ca să
 * găsești un eveniment în câteva secunde.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { createEvent, deleteEvent, fetchEvents, updateEvent } from '../api/admin';
import { EVENT_KINDS, type AdminEvent, type EventInput } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EventPreview, kindLabel } from '../components/EventPreview';
import { Modal } from '../components/Modal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Select,
  TextArea,
  TextInput,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import {
  EMPTY_FORM,
  EVENT_LIMITS,
  hasValidCoords,
  isUpcoming,
  parseNumber,
  selectEvents,
  toForm,
  toPayload,
  validate,
  warnings,
  type EventSort,
  type EventTimeFilter,
  type FormErrors,
  type FormState,
} from '../lib/eventForm';
import { formatDateTime } from '../lib/format';

const FILTER_OPTIONS: readonly { value: EventTimeFilter; label: string }[] = [
  { value: 'all', label: 'Toate' },
  { value: 'upcoming', label: 'Viitoare' },
  { value: 'past', label: 'Trecute' },
] as const;

const SORT_OPTIONS: readonly { value: EventSort; label: string }[] = [
  { value: 'soonest', label: 'Cele mai apropiate întâi' },
  { value: 'latest', label: 'Cele mai îndepărtate întâi' },
] as const;

/** Prețul biletului pentru tabel: „50 lei" sau „—" când biletul online lipsește. */
function ticketPriceLabel(event: AdminEvent): string {
  if (event.ticket_price === null) return '—';
  return `${event.ticket_price} ${event.ticket_currency ?? 'lei'}`;
}

export function EventsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ event: AdminEvent | null } | null>(null);
  const [toDelete, setToDelete] = useState<AdminEvent | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // `?q=` vine din ecranul de invitații („Vezi evenimentul"): legătura dintre un
  // cod și petrecerea lui trebuie să meargă în ambele sensuri.
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [filter, setFilter] = useState<EventTimeFilter>('all');
  const [sort, setSort] = useState<EventSort>('soonest');

  const query = useQuery({ queryKey: ['events'], queryFn: () => fetchEvents() });

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['events'] }).then(() => undefined);

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: EventInput }) =>
      id === null ? createEvent(input) : updateEvent(id, input),
    onSuccess: async () => {
      setEditing(null);
      setFormError(null);
      await invalidate();
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: async () => {
      setToDelete(null);
      setFormError(null);
      await invalidate();
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const events = useMemo(() => query.data?.items ?? [], [query.data]);

  const visible = useMemo(
    () => selectEvents(events, { search, filter, sort }),
    [events, search, filter, sort],
  );

  const upcoming = visible.filter((event) => isUpcoming(event));
  const past = visible.filter((event) => !isUpcoming(event));

  /** Secțiunile afișate: „Toate" le separă vizual, filtrele o arată pe cea cerută. */
  const sections: { key: string; title: string; rows: AdminEvent[] }[] =
    filter === 'past'
      ? [{ key: 'past', title: 'Trecute', rows: past }]
      : filter === 'upcoming'
        ? [{ key: 'upcoming', title: 'Viitoare', rows: upcoming }]
        : [
            { key: 'upcoming', title: 'Viitoare', rows: upcoming },
            { key: 'past', title: 'Trecute', rows: past },
          ];

  return (
    <>
      <Card>
        <div className="toolbar">
          <div style={{ flex: '1 1 260px' }}>
            <Field label="Caută (titlu, oraș, loc, cod promo)" htmlFor="event-search">
              <TextInput
                id="event-search"
                value={search}
                placeholder="flirt party, Chișinău, Club Nova…"
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
          </div>
          <div style={{ width: 160 }}>
            <Field label="Perioadă" htmlFor="event-filter">
              <Select
                id="event-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value as EventTimeFilter)}
              >
                {FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ width: 230 }}>
            <Field label="Ordine" htmlFor="event-sort">
              <Select
                id="event-sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as EventSort)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              setFormError(null);
              setEditing({ event: null });
            }}
          >
            Eveniment nou
          </Button>
        </div>
      </Card>

      <Card title="Evenimente">
        {query.isPending ? (
          <LoadingState label="Se încarcă evenimentele…" />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : events.length === 0 ? (
          <EmptyState
            title="Niciun eveniment"
            hint="Creează primul eveniment — apare imediat în aplicația mobilă."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Niciun eveniment găsit"
            hint="Schimbă căutarea sau perioada selectată."
          />
        ) : (
          <>
            <p className="muted" data-testid="events-summary">
              {`${upcoming.length} viitoare · ${past.length} trecute · ${events.length} în total`}
            </p>
            {sections.map((section) => (
              <section key={section.key} className="events-section">
                <h3 className="events-section__title">
                  {`${section.title} (${section.rows.length})`}
                </h3>
                {section.rows.length === 0 ? (
                  <p className="muted">Nimic aici.</p>
                ) : (
                  <EventTable
                    rows={section.rows}
                    onEdit={(event) => {
                      setFormError(null);
                      setEditing({ event });
                    }}
                    onDelete={(event) => {
                      setFormError(null);
                      setToDelete(event);
                    }}
                  />
                )}
              </section>
            ))}
          </>
        )}
      </Card>

      {editing ? (
        <EventFormModal
          event={editing.event}
          busy={save.isPending}
          errorMessage={formError}
          onCancel={() => {
            setEditing(null);
            setFormError(null);
          }}
          onSubmit={(input) => save.mutate({ id: editing.event?.id ?? null, input })}
        />
      ) : null}

      {toDelete ? (
        <ConfirmDialog
          title="Șterge evenimentul"
          message={deleteMessage(toDelete)}
          confirmLabel="Șterge evenimentul"
          // Bilete deja APROBATE = bani încasați. Acolo nu ajunge un clic:
          // adminul tastează titlul, exact ca la ștergerea GDPR a unui cont.
          confirmPhrase={toDelete.ticket_approved_count > 0 ? toDelete.title : undefined}
          busy={remove.isPending}
          errorMessage={formError}
          onCancel={() => {
            setToDelete(null);
            setFormError(null);
          }}
          onConfirm={() => remove.mutate(toDelete.id)}
        />
      ) : null}
    </>
  );
}

/** Ce se pierde, în cuvinte: participanți, comenzi de bilet, bilete emise. */
export function deleteMessage(event: AdminEvent): string {
  const lines = [
    `„${event.title}" va dispărea din aplicație.`,
    `Participanți înscriși: ${event.attendee_count}.`,
  ];
  if (event.ticket_approved_count > 0) {
    lines.push(
      `Comenzi de bilet: ${event.ticket_order_count}, dintre care ` +
        `${event.ticket_approved_count} BILETE APROBATE (plătite). Oamenii aceia au ` +
        'plătit: ștergerea le anulează biletul, fără rambursare automată.',
    );
  } else if (event.ticket_order_count > 0) {
    lines.push(
      `Comenzi de bilet în așteptare: ${event.ticket_order_count}. Dispar odată cu evenimentul.`,
    );
  } else {
    lines.push('Comenzi de bilet: niciuna.');
  }
  return lines.join(' ');
}

function EventTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: AdminEvent[];
  onEdit: (event: AdminEvent) => void;
  onDelete: (event: AdminEvent) => void;
}): JSX.Element {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Titlu</th>
            <th>Când</th>
            <th>Oraș</th>
            <th>Locație</th>
            <th>Tip</th>
            <th>Preț bilet</th>
            <th>Participanți</th>
            <th>Bilete</th>
            <th aria-label="Acțiuni" />
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => {
            const onMap = hasValidCoords(event.lat, event.lng);
            return (
              <tr key={event.id}>
                <td>
                  <div className="events-cell">
                    <span>{event.title}</span>
                    <div className="events-cell__badges">
                      {event.promo_discount_percent !== null &&
                      event.promo_discount_percent > 0 ? (
                        <span
                          className="badge badge--promo"
                          title={event.promo_code ?? 'Reducere la intrare'}
                        >
                          {`−${event.promo_discount_percent}%`}
                        </span>
                      ) : null}
                      {onMap ? null : (
                        <Badge tone="warning">Fără hartă</Badge>
                      )}
                      {event.cover_url === null ? <Badge tone="neutral">Fără copertă</Badge> : null}
                    </div>
                  </div>
                </td>
                <td className="muted mono">
                  <div className="events-cell">
                    <span>{formatDateTime(event.starts_at)}</span>
                    {isUpcoming(event) ? (
                      <Badge tone="success">Viitor</Badge>
                    ) : (
                      <Badge tone="neutral">Trecut</Badge>
                    )}
                  </div>
                </td>
                <td>{event.city}</td>
                <td>{event.venue ?? '—'}</td>
                <td>{kindLabel(event.kind)}</td>
                <td className="mono">{ticketPriceLabel(event)}</td>
                <td className="mono">{event.attendee_count}</td>
                <td className="mono" title="Comenzi nerespinse (din care aprobate)">
                  {event.ticket_order_count === 0
                    ? '—'
                    : `${event.ticket_order_count} (${event.ticket_approved_count})`}
                </td>
                <td>
                  <div className="table__actions">
                    <Button small onClick={() => onEdit(event)}>
                      Editează
                    </Button>
                    {/* Invitațiile se gândesc pe eveniment, nu ca listă globală. */}
                    <Link className="btn btn--ghost btn--sm" to={`/invites?event=${event.id}`}>
                      Invitații
                    </Link>
                    <Button small variant="danger" onClick={() => onDelete(event)}>
                      Șterge
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Mesajul de eroare al unui câmp, sub input (sau nimic). */
function FieldError({ message }: { message?: string }): JSX.Element | null {
  if (!message) return null;
  return (
    <p className="field__error" role="alert">
      {message}
    </p>
  );
}

function EventFormModal({
  event,
  busy,
  errorMessage: error,
  onCancel,
  onSubmit,
}: {
  event: AdminEvent | null;
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (input: EventInput) => void;
}): JSX.Element {
  const [form, setForm] = useState<FormState>(event ? toForm(event) : EMPTY_FORM);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const errors: FormErrors = validate(form);
  const hints = warnings(form);
  const valid = Object.keys(errors).length === 0;

  const lat = parseNumber(form.lat);
  const lng = parseNumber(form.lng);
  const onMap = hasValidCoords(lat, lng);

  const submit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault();
    if (!valid || busy) return;
    onSubmit(toPayload(form));
  };

  return (
    <Modal title={event ? 'Editează evenimentul' : 'Eveniment nou'} onClose={onCancel} wide>
      <div className="event-editor">
        <form className="modal__body event-editor__form" onSubmit={submit}>
          <Field label="Titlu *" htmlFor="event-title">
            <TextInput
              id="event-title"
              value={form.title}
              maxLength={EVENT_LIMITS.title}
              aria-invalid={errors.title ? true : undefined}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <FieldError message={errors.title} />

          <Field label="Descriere" htmlFor="event-description">
            <TextArea
              id="event-description"
              value={form.description}
              maxLength={EVENT_LIMITS.description}
              aria-invalid={errors.description ? true : undefined}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <FieldError message={errors.description} />

          <div className="form-grid">
            <div>
              <Field label="Data și ora *" htmlFor="event-starts">
                <TextInput
                  id="event-starts"
                  type="datetime-local"
                  value={form.starts_at}
                  aria-invalid={errors.starts_at ? true : undefined}
                  onChange={(e) => set('starts_at', e.target.value)}
                />
              </Field>
              <FieldError message={errors.starts_at} />
            </div>
            <div>
              <Field label="Tip" htmlFor="event-kind">
                <Select id="event-kind" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                  {EVENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kindLabel(kind)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div>
              <Field label="Oraș *" htmlFor="event-city">
                <TextInput
                  id="event-city"
                  value={form.city}
                  maxLength={EVENT_LIMITS.city}
                  aria-invalid={errors.city ? true : undefined}
                  onChange={(e) => set('city', e.target.value)}
                />
              </Field>
              <FieldError message={errors.city} />
            </div>
            <div>
              <Field label="Locație" htmlFor="event-venue">
                <TextInput
                  id="event-venue"
                  value={form.venue}
                  maxLength={EVENT_LIMITS.venue}
                  placeholder="Club Nova"
                  aria-invalid={errors.venue ? true : undefined}
                  onChange={(e) => set('venue', e.target.value)}
                />
              </Field>
              <FieldError message={errors.venue} />
            </div>
          </div>

          <fieldset className="form-section">
            <legend>Poziția pe hartă</legend>
            <p className="field__hint">
              Evenimentul apare pe harta din aplicație DOAR cu ambele coordonate. În Google
              Maps: clic dreapta pe loc → primul rând copiază „47.0245, 28.8322".
            </p>
            <div className="form-grid">
              <div>
                <Field label="Latitudine" htmlFor="event-lat">
                  <TextInput
                    id="event-lat"
                    inputMode="decimal"
                    placeholder="47.0245"
                    value={form.lat}
                    aria-invalid={errors.lat ? true : undefined}
                    onChange={(e) => set('lat', e.target.value)}
                  />
                </Field>
                <FieldError message={errors.lat} />
              </div>
              <div>
                <Field label="Longitudine" htmlFor="event-lng">
                  <TextInput
                    id="event-lng"
                    inputMode="decimal"
                    placeholder="28.8322"
                    value={form.lng}
                    aria-invalid={errors.lng ? true : undefined}
                    onChange={(e) => set('lng', e.target.value)}
                  />
                </Field>
                <FieldError message={errors.lng} />
              </div>
            </div>
            <Field
              label={'Lipește „lat, lng" dintr-o dată'}
              htmlFor="event-coords-paste"
            >
              <TextInput
                id="event-coords-paste"
                placeholder="47.0245, 28.8322"
                onChange={(e) => {
                  const [rawLat, rawLng] = e.target.value.split(',');
                  if (rawLat !== undefined && rawLng !== undefined) {
                    setForm((current) => ({
                      ...current,
                      lat: rawLat.trim(),
                      lng: rawLng.trim(),
                    }));
                  }
                }}
              />
            </Field>
            {onMap ? (
              <p className="field__ok" data-testid="coords-ok">
                Coordonate valide — evenimentul apare pe hartă.
              </p>
            ) : (
              <div className="alert" data-testid="coords-missing">
                Fără coordonate valide evenimentul NU apare pe harta din aplicație.
              </div>
            )}
          </fieldset>

          <fieldset className="form-section">
            <legend>Imagine de copertă</legend>
            <p className="field__hint">
              Backendul stochează doar ADRESA imaginii (nu se încarcă fișiere din panou):
              pune un link public https către o fotografie.
            </p>
            <Field label="URL copertă" htmlFor="event-cover">
              <TextInput
                id="event-cover"
                type="url"
                value={form.cover_url}
                maxLength={EVENT_LIMITS.coverUrl}
                placeholder="https://…/poster.jpg"
                aria-invalid={errors.cover_url ? true : undefined}
                onChange={(e) => set('cover_url', e.target.value)}
              />
            </Field>
            <FieldError message={errors.cover_url} />
          </fieldset>

          <fieldset className="form-section">
            <legend>Bilet online</legend>
            <div className="form-grid">
              <div>
                <Field label="Preț bilet" htmlFor="event-ticket-price">
                  <TextInput
                    id="event-ticket-price"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="gol = bilet online indisponibil"
                    value={form.ticket_price}
                    aria-invalid={errors.ticket_price ? true : undefined}
                    onChange={(e) => set('ticket_price', e.target.value)}
                  />
                </Field>
                <FieldError message={errors.ticket_price} />
              </div>
              <div>
                <Field label="Monedă" htmlFor="event-ticket-currency">
                  <TextInput
                    id="event-ticket-currency"
                    value={form.ticket_currency}
                    maxLength={EVENT_LIMITS.ticketCurrency}
                    placeholder="lei"
                    aria-invalid={errors.ticket_currency ? true : undefined}
                    onChange={(e) => set('ticket_currency', e.target.value)}
                  />
                </Field>
                <FieldError message={errors.ticket_currency} />
              </div>
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend>Promo / Reducere la intrare</legend>
            <p className="field__hint">
              Aplicația arată blocul de promo doar când sunt completate AMBELE: procentul
              și codul.
            </p>
            <div className="form-grid">
              <div>
                <Field label="Reducere (%)" htmlFor="event-promo-percent">
                  <TextInput
                    id="event-promo-percent"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    placeholder="ex. 10 — gol = fără reducere"
                    value={form.promo_discount_percent}
                    aria-invalid={errors.promo_discount_percent ? true : undefined}
                    onChange={(e) => set('promo_discount_percent', e.target.value)}
                  />
                </Field>
                <FieldError message={errors.promo_discount_percent} />
              </div>
              <div>
                <Field label="Cod promo" htmlFor="event-promo-code">
                  <TextInput
                    id="event-promo-code"
                    value={form.promo_code}
                    maxLength={EVENT_LIMITS.promoCode}
                    placeholder="ex. FLIRT10"
                    aria-invalid={errors.promo_code ? true : undefined}
                    onChange={(e) => set('promo_code', e.target.value)}
                  />
                </Field>
                <FieldError message={errors.promo_code} />
              </div>
            </div>
            <Field label="Descriere promo" htmlFor="event-promo-description">
              <TextArea
                id="event-promo-description"
                value={form.promo_description}
                maxLength={EVENT_LIMITS.promoDescription}
                placeholder="Arată acest cod la intrare pentru 10% reducere la bilet."
                aria-invalid={errors.promo_description ? true : undefined}
                onChange={(e) => set('promo_description', e.target.value)}
              />
            </Field>
            <FieldError message={errors.promo_description} />
          </fieldset>

          {hints.length > 0 ? (
            <div className="alert alert--warning" data-testid="event-warnings">
              <strong>Se poate publica, dar:</strong>
              <ul className="alert__list">
                {hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <div className="alert">{error}</div> : null}

          <div className="modal__actions">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Anulează
            </Button>
            <Button type="submit" variant="primary" disabled={!valid || busy}>
              {busy ? 'Se salvează…' : event ? 'Salvează' : 'Creează evenimentul'}
            </Button>
          </div>
        </form>

        <aside className="event-editor__preview">
          <EventPreview form={form} attendeeCount={event?.attendee_count ?? 0} />
        </aside>
      </div>
    </Modal>
  );
}
