/**
 * Evenimente: listă + CREARE / EDITARE / ȘTERGERE.
 *
 * Până acum producția nu avea NICIO cale de a introduce un eveniment real —
 * ecranul ăsta e singura sursă de evenimente pentru aplicația mobilă.
 * Ștergerea (afectează participanții și ștampilele Flirt Passport) cere confirmare.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { createEvent, deleteEvent, fetchEvents, updateEvent } from '../api/admin';
import { EVENT_KINDS, type AdminEvent, type EventInput } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import {
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
import { fromDateTimeLocalValue, formatDateTime, toDateTimeLocalValue } from '../lib/format';

interface FormState {
  title: string;
  description: string;
  starts_at: string; // valoare `datetime-local`
  city: string;
  venue: string;
  kind: string;
  cover_url: string;
  lat: string;
  lng: string;
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  starts_at: '',
  city: '',
  venue: '',
  kind: 'party',
  cover_url: '',
  lat: '',
  lng: '',
};

function toForm(event: AdminEvent): FormState {
  return {
    title: event.title,
    description: event.description ?? '',
    starts_at: toDateTimeLocalValue(event.starts_at),
    city: event.city,
    venue: event.venue ?? '',
    kind: event.kind,
    cover_url: event.cover_url ?? '',
    lat: event.lat === null ? '' : String(event.lat),
    lng: event.lng === null ? '' : String(event.lng),
  };
}

function toPayload(form: FormState): EventInput {
  const lat = form.lat.trim() === '' ? null : Number(form.lat);
  const lng = form.lng.trim() === '' ? null : Number(form.lng);
  return {
    title: form.title.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    starts_at: fromDateTimeLocalValue(form.starts_at),
    city: form.city.trim(),
    venue: form.venue.trim() === '' ? null : form.venue.trim(),
    kind: form.kind,
    cover_url: form.cover_url.trim() === '' ? null : form.cover_url.trim(),
    lat: lat === null || Number.isNaN(lat) ? null : lat,
    lng: lng === null || Number.isNaN(lng) ? null : lng,
  };
}

export function EventsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ event: AdminEvent | null } | null>(null);
  const [toDelete, setToDelete] = useState<AdminEvent | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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

  const events = query.data?.items ?? [];

  return (
    <>
      <Card
        title="Evenimente"
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setFormError(null);
              setEditing({ event: null });
            }}
          >
            Eveniment nou
          </Button>
        }
      >
        {query.isPending ? (
          <LoadingState label="Se încarcă evenimentele…" />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : events.length === 0 ? (
          <EmptyState
            title="Niciun eveniment"
            hint="Creează primul eveniment — apare imediat în aplicația mobilă."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Titlu</th>
                  <th>Când</th>
                  <th>Oraș</th>
                  <th>Locație</th>
                  <th>Tip</th>
                  <th>Participanți</th>
                  <th aria-label="Acțiuni" />
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.title}</td>
                    <td className="muted mono">{formatDateTime(event.starts_at)}</td>
                    <td>{event.city}</td>
                    <td>{event.venue ?? '—'}</td>
                    <td>{event.kind}</td>
                    <td className="mono">{event.attendee_count}</td>
                    <td>
                      <div className="table__actions">
                        <Button
                          small
                          onClick={() => {
                            setFormError(null);
                            setEditing({ event });
                          }}
                        >
                          Editează
                        </Button>
                        <Button
                          small
                          variant="danger"
                          onClick={() => {
                            setFormError(null);
                            setToDelete(event);
                          }}
                        >
                          Șterge
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          onSubmit={(input) =>
            save.mutate({ id: editing.event?.id ?? null, input })
          }
        />
      ) : null}

      {toDelete ? (
        <ConfirmDialog
          title="Șterge evenimentul"
          message={`„${toDelete.title}" va dispărea din aplicație. Participanții înscriși (${toDelete.attendee_count}) pierd evenimentul din listă.`}
          confirmLabel="Șterge evenimentul"
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

  const valid =
    form.title.trim().length > 0 &&
    form.city.trim().length > 0 &&
    form.starts_at.trim().length > 0;

  const submit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault();
    if (!valid || busy) return;
    onSubmit(toPayload(form));
  };

  return (
    <Modal title={event ? 'Editează evenimentul' : 'Eveniment nou'} onClose={onCancel} wide>
      <form className="modal__body" onSubmit={submit}>
        <Field label="Titlu *" htmlFor="event-title">
          <TextInput
            id="event-title"
            value={form.title}
            maxLength={200}
            required
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>

        <Field label="Descriere" htmlFor="event-description">
          <TextArea
            id="event-description"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>

        <div className="form-grid">
          <Field label="Data și ora *" htmlFor="event-starts">
            <TextInput
              id="event-starts"
              type="datetime-local"
              value={form.starts_at}
              required
              onChange={(e) => set('starts_at', e.target.value)}
            />
          </Field>
          <Field label="Tip" htmlFor="event-kind">
            <Select
              id="event-kind"
              value={form.kind}
              onChange={(e) => set('kind', e.target.value)}
            >
              {EVENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Oraș *" htmlFor="event-city">
            <TextInput
              id="event-city"
              value={form.city}
              maxLength={120}
              required
              onChange={(e) => set('city', e.target.value)}
            />
          </Field>
          <Field label="Locație" htmlFor="event-venue">
            <TextInput
              id="event-venue"
              value={form.venue}
              maxLength={200}
              onChange={(e) => set('venue', e.target.value)}
            />
          </Field>
          <Field label="Latitudine" htmlFor="event-lat">
            <TextInput
              id="event-lat"
              inputMode="decimal"
              value={form.lat}
              onChange={(e) => set('lat', e.target.value)}
            />
          </Field>
          <Field label="Longitudine" htmlFor="event-lng">
            <TextInput
              id="event-lng"
              inputMode="decimal"
              value={form.lng}
              onChange={(e) => set('lng', e.target.value)}
            />
          </Field>
        </div>

        <Field label="URL copertă" htmlFor="event-cover">
          <TextInput
            id="event-cover"
            type="url"
            value={form.cover_url}
            onChange={(e) => set('cover_url', e.target.value)}
          />
        </Field>

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
    </Modal>
  );
}
