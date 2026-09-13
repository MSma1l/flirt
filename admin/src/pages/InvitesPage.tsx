/**
 * Invitații speciale: emitere, listă cu starea folosirii, revocare.
 *
 * O invitație e un COD emis de admin pentru un eveniment, cu un număr maxim de
 * folosiri, o expirare și (opțional) o treaptă minimă de fidelitate. Codul e
 * generat pe SERVER, din `secrets` — panoul nu îl propune și nu îl poate alege.
 *
 * Patru decizii care se văd în cod:
 *
 * 1. CODUL SE COPIAZĂ, NU SE TRANSCRIE. Douăsprezece caractere transcrise manual
 *    se greșesc; fiecare cod are lângă el un buton care confirmă vizual copierea
 *    (`components/CopyButton.tsx`), iar codul proaspăt emis apare o dată,
 *    evidențiat, ca adminul să-l trimită imediat.
 * 2. CODUL NU AJUNGE UNDE NU TREBUIE. Backendul îl ține în afara jurnalului de
 *    audit (`meta` din `loyalty.invite.create` nu îl conține), pentru că
 *    jurnalul e citibil de orice admin. Panoul respectă aceeași linie: codul
 *    apare în tabel și în panoul de emitere — NU în mesajul de confirmare a
 *    revocării, care identifică invitația prin eveniment, notă și dată.
 * 3. FILTRUL PE EVENIMENT ESTE PE SERVER (`?event_id=`), ca lista unui eveniment
 *    să nu depindă de câte pagini a apucat panoul să încarce. Filtrul pe STARE
 *    e pe client: backendul calculează starea (`active` / `exhausted` /
 *    `expired` / `revoked`), dar nu o acceptă ca parametru de interogare — deci
 *    filtrează pagina curentă, iar textul din ecran o spune.
 * 4. LEGĂTURA CU EVENIMENTELE merge în ambele sensuri: din tabelul de evenimente
 *    se ajunge aici filtrat pe evenimentul respectiv (`/invites?event=<id>`), iar
 *    din fiecare rând de aici înapoi la eveniment (`/events?q=<titlu>`). Un
 *    organizator gândește în „petrecerea de vineri", nu în „lista globală de coduri".
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { createInvite, fetchEvents, fetchInvites, fetchLoyaltyTiers, revokeInvite } from '../api/admin';
import type { LoyaltyInvite } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CopyButton } from '../components/CopyButton';
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
import { formatDateTime } from '../lib/format';
import {
  EMPTY_INVITE_FORM,
  INVITE_NOTE_MAX,
  INVITE_STATUS_LABELS,
  inviteStatusTone,
  inviteWarnings,
  selectInvites,
  toInvitePayload,
  usageLabel,
  validateInvite,
  type InviteFormErrors,
  type InviteFormState,
  type InviteStatusFilter,
} from '../lib/loyaltyForm';

const STATUS_OPTIONS: readonly { value: InviteStatusFilter; label: string }[] = [
  { value: 'all', label: 'Toate' },
  { value: 'active', label: 'Active' },
  { value: 'exhausted', label: 'Epuizate' },
  { value: 'expired', label: 'Expirate' },
  { value: 'revoked', label: 'Revocate' },
] as const;

/** Mesajul de eroare al unui câmp, sub input (tiparul din EventsPage). */
function FieldError({ message }: { message?: string }): JSX.Element | null {
  if (!message) return null;
  return (
    <p className="field__error" role="alert">
      {message}
    </p>
  );
}

export function InvitesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  // Evenimentul din adresă: așa ajunge adminul aici din tabelul de evenimente.
  const eventFilter = searchParams.get('event') ?? 'all';

  const [status, setStatus] = useState<InviteStatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<LoyaltyInvite | null>(null);
  const [toRevoke, setToRevoke] = useState<LoyaltyInvite | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Stiva de cursoare = butonul „Înapoi" al paginării pe cursor (ca la utilizatori).
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex];

  const eventsQuery = useQuery({ queryKey: ['events'], queryFn: () => fetchEvents() });
  const tiersQuery = useQuery({ queryKey: ['loyalty-tiers'], queryFn: fetchLoyaltyTiers });
  const query = useQuery({
    queryKey: ['invites', { eventFilter, cursor }],
    queryFn: () =>
      fetchInvites({
        ...(eventFilter === 'all' ? {} : { eventId: eventFilter }),
        ...(cursor === undefined ? {} : { cursor }),
      }),
  });

  const events = useMemo(() => eventsQuery.data?.items ?? [], [eventsQuery.data]);
  const tiers = useMemo(() => tiersQuery.data?.tiers ?? [], [tiersQuery.data]);
  const invites = useMemo(() => query.data?.items ?? [], [query.data]);
  const visible = useMemo(() => selectInvites(invites, { status }), [invites, status]);
  const nextCursor = query.data?.next_cursor ?? null;

  const resetPaging = (): void => {
    setCursors([undefined]);
    setPageIndex(0);
  };

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['invites'] }).then(() => undefined);

  const issue = useMutation({
    mutationFn: (form: InviteFormState) => createInvite(toInvitePayload(form)),
    onSuccess: async (invite: LoyaltyInvite) => {
      setActionError(null);
      setCreating(false);
      setIssued(invite);
      await invalidate();
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvite(id),
    onSuccess: async () => {
      setActionError(null);
      setToRevoke(null);
      await invalidate();
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const eventTitle = (id: string): string =>
    events.find((event) => event.id === id)?.title ?? 'evenimentul selectat';

  return (
    <>
      <Card
        actions={
          <Link className="btn btn--ghost btn--sm" to="/loyalty">
            Trepte de fidelitate
          </Link>
        }
      >
        <div className="toolbar">
          <div style={{ flex: '1 1 280px' }}>
            <Field label="Eveniment" htmlFor="invite-event-filter">
              <Select
                id="invite-event-filter"
                value={eventFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setSearchParams(value === 'all' ? {} : { event: value });
                  resetPaging();
                }}
              >
                <option value="all">Toate evenimentele</option>
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ width: 180 }}>
            <Field label="Stare" htmlFor="invite-status-filter">
              <Select
                id="invite-status-filter"
                value={status}
                onChange={(event) => setStatus(event.target.value as InviteStatusFilter)}
              >
                {STATUS_OPTIONS.map((option) => (
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
              setActionError(null);
              setCreating(true);
            }}
          >
            Invitație nouă
          </Button>
        </div>
        {eventFilter !== 'all' ? (
          <p className="muted" data-testid="invite-event-context">
            {`Invitațiile evenimentului „${eventTitle(eventFilter)}". `}
            <Link to={`/events?q=${encodeURIComponent(eventTitle(eventFilter))}`}>
              Vezi evenimentul
            </Link>
          </p>
        ) : null}
      </Card>

      {issued ? (
        <Card title="Invitație emisă">
          <p className="field__hint">
            Trimite codul persoanei invitate. Îl poți reciti oricând din tabelul de mai jos —
            dar NU apare în jurnalul de audit, deci nu-l căuta acolo.
          </p>
          <div className="toolbar" data-testid="issued-invite">
            <span className="mono" style={{ fontSize: 24, letterSpacing: 2 }}>
              {issued.code}
            </span>
            <CopyButton
              value={issued.code}
              small={false}
              label="Copiază codul"
              title="Copiază codul invitației"
            />
            <span className="muted">
              {`${issued.event_title} · ${issued.max_uses} folosiri · expiră ${formatDateTime(
                issued.expires_at,
              )}`}
            </span>
            <Button small onClick={() => setIssued(null)}>
              Am trimis codul
            </Button>
          </div>
        </Card>
      ) : null}

      <Card title="Invitații">
        {query.isPending ? (
          <LoadingState label="Se încarcă invitațiile…" />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : invites.length === 0 ? (
          <EmptyState
            title="Nicio invitație"
            hint="Emite prima invitație — codul se generează pe server și apare aici."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Nicio invitație în starea aleasă"
            hint="Filtrul de stare se aplică paginii încărcate. Schimbă starea sau treci la pagina următoare."
          />
        ) : (
          <>
            {/* Erorile acțiunilor se arată ÎN dialogul care le-a provocat (emitere /
                revocare), o singură dată: același mesaj în două locuri îl face pe
                admin să caute două probleme. */}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Cod</th>
                    <th>Eveniment</th>
                    <th>Folosiri</th>
                    <th>Expiră</th>
                    <th>Treaptă minimă</th>
                    <th>Reducere</th>
                    <th>Notă</th>
                    <th>Stare</th>
                    <th aria-label="Acțiuni" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((invite) => (
                    <tr key={invite.id}>
                      <td>
                        <div className="events-cell">
                          <span className="mono">{invite.code}</span>
                          <CopyButton
                            value={invite.code}
                            title={`Copiază codul invitației pentru ${invite.event_title}`}
                          />
                        </div>
                      </td>
                      <td>
                        <Link to={`/events?q=${encodeURIComponent(invite.event_title)}`}>
                          {invite.event_title}
                        </Link>
                      </td>
                      <td className="mono" title={usageLabel(invite)}>
                        {`${invite.used_count}/${invite.max_uses}`}
                      </td>
                      <td className="muted mono">{formatDateTime(invite.expires_at)}</td>
                      <td>
                        {invite.min_tier === null
                          ? '—'
                          : `${invite.min_tier}${
                              invite.min_stamps_required === null
                                ? ''
                                : ` (${invite.min_stamps_required} ștampile)`
                            }`}
                      </td>
                      <td className="mono">
                        {invite.discount_percent === null ? '—' : `−${invite.discount_percent}%`}
                      </td>
                      <td>{invite.note ?? '—'}</td>
                      <td>
                        <Badge tone={inviteStatusTone(invite.status)}>
                          {INVITE_STATUS_LABELS[invite.status]}
                        </Badge>
                      </td>
                      <td>
                        <div className="table__actions">
                          <Button
                            small
                            variant="danger"
                            disabled={invite.revoked_at !== null}
                            onClick={() => {
                              setActionError(null);
                              setToRevoke(invite);
                            }}
                          >
                            {invite.revoked_at === null ? 'Revocă' : 'Revocată'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <span className="muted">{`Pagina ${pageIndex + 1} · ${visible.length} afișate`}</span>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Button
                  small
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
                >
                  Înapoi
                </Button>
                <Button
                  small
                  disabled={nextCursor === null}
                  onClick={() => {
                    if (nextCursor === null) return;
                    setCursors((stack) => {
                      const next = stack.slice(0, pageIndex + 1);
                      next.push(nextCursor);
                      return next;
                    });
                    setPageIndex((index) => index + 1);
                  }}
                >
                  Înainte
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {creating ? (
        <InviteFormModal
          events={events.map((event) => ({ id: event.id, title: event.title }))}
          tiers={tiers}
          defaultEventId={eventFilter === 'all' ? '' : eventFilter}
          busy={issue.isPending}
          errorMessage={actionError}
          onCancel={() => {
            setCreating(false);
            setActionError(null);
          }}
          onSubmit={(form) => issue.mutate(form)}
        />
      ) : null}

      {toRevoke ? (
        <ConfirmDialog
          title="Revocă invitația"
          // FĂRĂ COD în mesaj: invitația se identifică prin eveniment, notă și dată.
          message={revokeMessage(toRevoke)}
          confirmLabel="Revocă invitația"
          busy={revoke.isPending}
          errorMessage={actionError}
          onCancel={() => {
            setToRevoke(null);
            setActionError(null);
          }}
          onConfirm={() => revoke.mutate(toRevoke.id)}
        />
      ) : null}
    </>
  );
}

/** Ce se pierde prin revocare, în cuvinte — și ce NU se pierde. */
export function revokeMessage(invite: LoyaltyInvite): string {
  const lines = [
    `Invitația pentru „${invite.event_title}" (emisă ${formatDateTime(invite.created_at)})` +
      `${invite.note ? `, notă: „${invite.note}"` : ''} nu va mai putea fi folosită de nimeni.`,
    `Folosiri consumate: ${invite.used_count} din ${invite.max_uses}.`,
  ];
  if (invite.used_count > 0) {
    lines.push(
      'Cele consumate RĂMÂN valabile: cine a intrat deja pe ea își păstrează reducerea.',
    );
  }
  if (invite.uses_left > 0) {
    lines.push(`Se pierd ${invite.uses_left} folosiri rămase. Revocarea nu se poate anula.`);
  }
  return lines.join(' ');
}

function InviteFormModal({
  events,
  tiers,
  defaultEventId,
  busy,
  errorMessage: error,
  onCancel,
  onSubmit,
}: {
  events: { id: string; title: string }[];
  tiers: { code: string; name: string; min_stamps: number }[];
  defaultEventId: string;
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (form: InviteFormState) => void;
}): JSX.Element {
  const [form, setForm] = useState<InviteFormState>({
    ...EMPTY_INVITE_FORM,
    event_id: defaultEventId,
  });

  const set = <K extends keyof InviteFormState>(key: K, value: InviteFormState[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const errors: InviteFormErrors = validateInvite(form);
  const hints = inviteWarnings(form);
  const valid = Object.keys(errors).length === 0;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!valid || busy) return;
    onSubmit(form);
  };

  return (
    <Modal title="Invitație nouă" onClose={onCancel}>
      <form className="modal__body" onSubmit={submit}>
        <p className="field__hint">
          Codul se generează pe server, din caractere fără ambiguități (fără 0/O, 1/I/L), și
          apare o singură dată evidențiat după emitere — de acolo se copiază.
        </p>

        <Field label="Eveniment *" htmlFor="invite-event">
          <Select
            id="invite-event"
            value={form.event_id}
            aria-invalid={errors.event_id ? true : undefined}
            onChange={(event) => set('event_id', event.target.value)}
          >
            <option value="">— alege evenimentul —</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </Select>
        </Field>
        <FieldError message={errors.event_id} />

        <div className="form-grid">
          <div>
            <Field label="Număr maxim de folosiri *" htmlFor="invite-max-uses">
              <TextInput
                id="invite-max-uses"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={form.max_uses}
                aria-invalid={errors.max_uses ? true : undefined}
                onChange={(event) => set('max_uses', event.target.value)}
              />
            </Field>
            <FieldError message={errors.max_uses} />
          </div>
          <div>
            <Field label="Expiră la *" htmlFor="invite-expires">
              <TextInput
                id="invite-expires"
                type="datetime-local"
                value={form.expires_at}
                aria-invalid={errors.expires_at ? true : undefined}
                onChange={(event) => set('expires_at', event.target.value)}
              />
            </Field>
            <FieldError message={errors.expires_at} />
          </div>
          <div>
            <Field label="Treaptă minimă cerută" htmlFor="invite-min-tier">
              <Select
                id="invite-min-tier"
                value={form.min_tier}
                onChange={(event) => set('min_tier', event.target.value)}
              >
                <option value="">Fără cerință</option>
                {tiers.map((tier) => (
                  <option key={tier.code} value={tier.code}>
                    {`${tier.name} (de la ${tier.min_stamps} ștampile)`}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="field__hint">
              Pragul se îngheață la emitere: dacă treapta se mută mai târziu, invitația
              păstrează cerința de azi.
            </p>
          </div>
          <div>
            <Field label="Reducere (%)" htmlFor="invite-discount">
              <TextInput
                id="invite-discount"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                placeholder="gol = doar acces"
                value={form.discount_percent}
                aria-invalid={errors.discount_percent ? true : undefined}
                onChange={(event) => set('discount_percent', event.target.value)}
              />
            </Field>
            <FieldError message={errors.discount_percent} />
          </div>
        </div>

        <Field label="Notă internă" htmlFor="invite-note">
          <TextArea
            id="invite-note"
            value={form.note}
            maxLength={INVITE_NOTE_MAX}
            placeholder="Pentru cine e, ce campanie — se vede doar în panou."
            aria-invalid={errors.note ? true : undefined}
            onChange={(event) => set('note', event.target.value)}
          />
        </Field>
        <FieldError message={errors.note} />

        {hints.length > 0 ? (
          <div className="alert alert--warning" data-testid="invite-warnings">
            <strong>De verificat:</strong>
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
            {busy ? 'Se emite…' : 'Emite invitația'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
