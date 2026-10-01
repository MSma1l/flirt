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
import { useLanguage, useMessages } from '../i18n/LanguageContext';
import { invitesMessages } from '../i18n/messages/invites';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import {
  EMPTY_INVITE_FORM,
  INVITE_NOTE_MAX,
  inviteStatusTone,
  inviteWarnings,
  selectInvites,
  toInvitePayload,
  validateInvite,
  type InviteFormErrors,
  type InviteFormState,
  type InviteStatusFilter,
} from '../lib/loyaltyForm';

// Etichetele vin din dicționar (`m.filter[value]`), în limba activă.
const STATUS_OPTIONS: readonly InviteStatusFilter[] = [
  'all',
  'active',
  'exhausted',
  'expired',
  'revoked',
] as const;

type InvitesMessages = (typeof invitesMessages)['ro'];

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
  const m = useMessages(invitesMessages);
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
    events.find((event) => event.id === id)?.title ?? m.selectedEvent;

  return (
    <>
      <Card
        actions={
          <Link className="btn btn--ghost btn--sm" to="/loyalty">
            {m.loyaltyTiers}
          </Link>
        }
      >
        <div className="toolbar">
          <div style={{ flex: '1 1 280px' }}>
            <Field label={m.eventLabel} htmlFor="invite-event-filter">
              <Select
                id="invite-event-filter"
                value={eventFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setSearchParams(value === 'all' ? {} : { event: value });
                  resetPaging();
                }}
              >
                <option value="all">{m.allEvents}</option>
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ width: 180 }}>
            <Field label={m.statusLabel} htmlFor="invite-status-filter">
              <Select
                id="invite-status-filter"
                value={status}
                onChange={(event) => setStatus(event.target.value as InviteStatusFilter)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {m.filter[option]}
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
            {m.newInvite}
          </Button>
        </div>
        {eventFilter !== 'all' ? (
          <p className="muted" data-testid="invite-event-context">
            {m.eventContext(eventTitle(eventFilter))}
            <Link to={`/events?q=${encodeURIComponent(eventTitle(eventFilter))}`}>
              {m.viewEvent}
            </Link>
          </p>
        ) : null}
      </Card>

      {issued ? (
        <Card title={m.issuedTitle}>
          <p className="field__hint">{m.issuedHint}</p>
          <div className="toolbar" data-testid="issued-invite">
            <span className="mono" style={{ fontSize: 24, letterSpacing: 2 }}>
              {issued.code}
            </span>
            <CopyButton
              value={issued.code}
              small={false}
              label={m.copyCode}
              title={m.copyCodeTitle}
            />
            <span className="muted">
              {m.issuedSummary(
                issued.event_title,
                issued.max_uses,
                formatDateTime(issued.expires_at),
              )}
            </span>
            <Button small onClick={() => setIssued(null)}>
              {m.codeSent}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card title={m.listTitle}>
        {query.isPending ? (
          <LoadingState label={m.loading} />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : invites.length === 0 ? (
          <EmptyState
            title={m.emptyTitle}
            hint={m.emptyHint}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={m.emptyFilteredTitle}
            hint={m.emptyFilteredHint}
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
                    <th>{m.columns.code}</th>
                    <th>{m.columns.event}</th>
                    <th>{m.columns.uses}</th>
                    <th>{m.columns.expires}</th>
                    <th>{m.columns.minTier}</th>
                    <th>{m.columns.discount}</th>
                    <th>{m.columns.note}</th>
                    <th>{m.columns.status}</th>
                    <th aria-label={m.columns.actions} />
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
                            title={m.copyCodeFor(invite.event_title)}
                          />
                        </div>
                      </td>
                      <td>
                        <Link to={`/events?q=${encodeURIComponent(invite.event_title)}`}>
                          {invite.event_title}
                        </Link>
                      </td>
                      <td className="mono" title={m.usage(invite.used_count, invite.max_uses)}>
                        {`${invite.used_count}/${invite.max_uses}`}
                      </td>
                      <td className="muted mono">{formatDateTime(invite.expires_at)}</td>
                      <td>
                        {invite.min_tier === null
                          ? '—'
                          : `${invite.min_tier}${
                              invite.min_stamps_required === null
                                ? ''
                                : ` (${m.stamps(invite.min_stamps_required)})`
                            }`}
                      </td>
                      <td className="mono">
                        {invite.discount_percent === null ? '—' : `−${invite.discount_percent}%`}
                      </td>
                      <td>{invite.note ?? '—'}</td>
                      <td>
                        <Badge tone={inviteStatusTone(invite.status)}>
                          {m.statusLabels[invite.status]}
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
                            {invite.revoked_at === null ? m.revoke : m.revoked}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <span className="muted">{m.pageSummary(pageIndex + 1, visible.length)}</span>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Button
                  small
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
                >
                  {m.previous}
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
                  {m.next}
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
          title={m.revokeTitle}
          // FĂRĂ COD în mesaj: invitația se identifică prin eveniment, notă și dată.
          message={revokeMessage(toRevoke, m)}
          confirmLabel={m.revokeConfirm}
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
export function revokeMessage(
  invite: LoyaltyInvite,
  m: InvitesMessages = invitesMessages.ro,
): string {
  const lines = [
    m.revokeIntro(invite.event_title, formatDateTime(invite.created_at), invite.note),
    m.revokeUsed(invite.used_count, invite.max_uses),
  ];
  if (invite.used_count > 0) {
    lines.push(m.revokeKept);
  }
  if (invite.uses_left > 0) {
    lines.push(m.revokeLost(invite.uses_left));
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
  const m = useMessages(invitesMessages).form;
  const { language } = useLanguage();
  const [form, setForm] = useState<InviteFormState>({
    ...EMPTY_INVITE_FORM,
    event_id: defaultEventId,
  });

  const set = <K extends keyof InviteFormState>(key: K, value: InviteFormState[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const errors: InviteFormErrors = validateInvite(form, Date.now(), language);
  const hints = inviteWarnings(form, Date.now(), language);
  const valid = Object.keys(errors).length === 0;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!valid || busy) return;
    onSubmit(form);
  };

  return (
    <Modal title={m.title} onClose={onCancel}>
      <form className="modal__body" onSubmit={submit}>
        <p className="field__hint">{m.codeHint}</p>

        <Field label={m.event} htmlFor="invite-event">
          <Select
            id="invite-event"
            value={form.event_id}
            aria-invalid={errors.event_id ? true : undefined}
            onChange={(event) => set('event_id', event.target.value)}
          >
            <option value="">{m.chooseEvent}</option>
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
            <Field label={m.maxUses} htmlFor="invite-max-uses">
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
            <Field label={m.expiresAt} htmlFor="invite-expires">
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
            <Field label={m.minTier} htmlFor="invite-min-tier">
              <Select
                id="invite-min-tier"
                value={form.min_tier}
                onChange={(event) => set('min_tier', event.target.value)}
              >
                <option value="">{m.noRequirement}</option>
                {tiers.map((tier) => (
                  <option key={tier.code} value={tier.code}>
                    {m.tierOption(tier.name, tier.min_stamps)}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="field__hint">{m.tierHint}</p>
          </div>
          <div>
            <Field label={m.discount} htmlFor="invite-discount">
              <TextInput
                id="invite-discount"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                placeholder={m.discountPlaceholder}
                value={form.discount_percent}
                aria-invalid={errors.discount_percent ? true : undefined}
                onChange={(event) => set('discount_percent', event.target.value)}
              />
            </Field>
            <FieldError message={errors.discount_percent} />
          </div>
        </div>

        <Field label={m.note} htmlFor="invite-note">
          <TextArea
            id="invite-note"
            value={form.note}
            maxLength={INVITE_NOTE_MAX}
            placeholder={m.notePlaceholder}
            aria-invalid={errors.note ? true : undefined}
            onChange={(event) => set('note', event.target.value)}
          />
        </Field>
        <FieldError message={errors.note} />

        {hints.length > 0 ? (
          <div className="alert alert--warning" data-testid="invite-warnings">
            <strong>{m.toCheck}</strong>
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
            {m.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || busy}>
            {busy ? m.issuing : m.issue}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
