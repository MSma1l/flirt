/**
 * Comenzi bilete: verificarea manuală a plăților prin transfer bancar.
 *
 * Fluxul: userul comandă un bilet, face transferul în contul global (setat SUS, în
 * cardul „Date bancare") folosind `reference` ca detaliu de plată, apoi marchează
 * „am plătit" (status `payment_declared`). Adminul caută transferul în extrasul
 * bancar DUPĂ `reference`, apoi APROBĂ (se generează biletul) sau RESPINGE.
 *
 * Comenzile `payment_declared` sunt cele care cer acțiune — backend-ul le trimite
 * primele, iar aici ies în evidență (badge de accent + acțiuni pe rând).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import {
  approveTicketOrder,
  fetchPaymentSettings,
  fetchTicketOrders,
  rejectTicketOrder,
  updatePaymentSettings,
} from '../api/admin';
import type { PaymentSettings, TicketOrder, TicketOrderStatus } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  TextArea,
  TextInput,
  type BadgeTone,
} from '../components/ui';
import { INTL_LOCALE, useLanguage, useMessages } from '../i18n/LanguageContext';
import { ticketsMessages } from '../i18n/messages/tickets';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

/* ------------------------------ Ajutoare ---------------------------- */

/** Suma + moneda, formatate. Cade elegant pe „12 EUR" dacă moneda e necunoscută. */
function formatPrice(price: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

// Eticheta statusului vine din dicționar (`ticketsMessages.orders.status`).
const STATUS_TONE: Record<TicketOrderStatus, BadgeTone> = {
  awaiting_payment: 'neutral',
  payment_declared: 'accent',
  approved: 'success',
  rejected: 'danger',
};

/* -------------------------------- Pagina ---------------------------- */

export function TicketOrdersPage(): JSX.Element {
  const m = useMessages(ticketsMessages);
  const locale = INTL_LOCALE[useLanguage().language];
  const queryClient = useQueryClient();
  const [toApprove, setToApprove] = useState<TicketOrder | null>(null);
  const [toReject, setToReject] = useState<TicketOrder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['ticket-orders'], queryFn: fetchTicketOrders });

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['ticket-orders'] }).then(() => undefined);

  const approve = useMutation({
    mutationFn: (id: string) => approveTicketOrder(id),
    onSuccess: async () => {
      setToApprove(null);
      setActionError(null);
      await invalidate();
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      rejectTicketOrder(id, reason),
    onSuccess: async () => {
      setToReject(null);
      setActionError(null);
      await invalidate();
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const orders = query.data ?? [];

  return (
    <>
      <PaymentSettingsCard />

      <Card title={m.orders.title}>
        {query.isPending ? (
          <LoadingState label={m.orders.loading} />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : orders.length === 0 ? (
          <EmptyState
            title={m.orders.emptyTitle}
            hint={m.orders.emptyHint}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{m.orders.colUser}</th>
                  <th>{m.common.event}</th>
                  <th>{m.orders.colAmount}</th>
                  <th>{m.orders.colReference}</th>
                  <th>{m.orders.colNote}</th>
                  <th>{m.common.status}</th>
                  <th>{m.common.created}</th>
                  <th aria-label={m.common.actions} />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const needsReview = order.status === 'payment_declared';
                  return (
                    <tr key={order.id}>
                      <td>
                        <div>{order.user.email}</div>
                        {order.user.payment_ref ? (
                          <div className="muted mono">{order.user.payment_ref}</div>
                        ) : null}
                      </td>
                      <td>
                        <div>{order.event.title}</div>
                        <div className="muted mono">{formatDateTime(order.event.starts_at)}</div>
                      </td>
                      <td className="mono">{formatPrice(order.price, order.currency, locale)}</td>
                      <td>
                        <span className="badge badge--count mono">{order.reference}</span>
                      </td>
                      <td>{order.user_note ? order.user_note : <span className="muted">—</span>}</td>
                      <td>
                        <Badge tone={STATUS_TONE[order.status]}>{m.orders.status[order.status]}</Badge>
                      </td>
                      <td className="muted mono">{formatDateTime(order.created_at)}</td>
                      <td>
                        {needsReview ? (
                          <div className="table__actions">
                            <Button
                              small
                              variant="primary"
                              onClick={() => {
                                setActionError(null);
                                setToApprove(order);
                              }}
                            >
                              {m.orders.approve}
                            </Button>
                            <Button
                              small
                              variant="danger"
                              onClick={() => {
                                setActionError(null);
                                setToReject(order);
                              }}
                            >
                              {m.orders.reject}
                            </Button>
                          </div>
                        ) : order.ticket_code ? (
                          <span className="mono muted">{order.ticket_code}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {toApprove ? (
        <ConfirmDialog
          title={m.orders.approveTitle}
          message={m.orders.approveMessage(
            toApprove.reference,
            formatPrice(toApprove.price, toApprove.currency, locale),
            toApprove.user.email,
          )}
          confirmLabel={m.orders.approveConfirm}
          danger={false}
          busy={approve.isPending}
          errorMessage={actionError}
          onCancel={() => {
            setToApprove(null);
            setActionError(null);
          }}
          onConfirm={() => approve.mutate(toApprove.id)}
        />
      ) : null}

      {toReject ? (
        <RejectModal
          order={toReject}
          busy={reject.isPending}
          errorMessage={actionError}
          onCancel={() => {
            setToReject(null);
            setActionError(null);
          }}
          onSubmit={(reason) => reject.mutate({ id: toReject.id, reason })}
        />
      ) : null}
    </>
  );
}

function RejectModal({
  order,
  busy,
  errorMessage: error,
  onCancel,
  onSubmit,
}: {
  order: TicketOrder;
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (reason?: string) => void;
}): JSX.Element {
  const m = useMessages(ticketsMessages);
  const [reason, setReason] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    onSubmit(reason.trim() === '' ? undefined : reason.trim());
  };

  return (
    <Modal title={m.orders.rejectTitle} onClose={onCancel}>
      <form className="modal__body" onSubmit={submit}>
        <p style={{ margin: 0 }}>
          {m.orders.rejectIntro(order.reference, order.user.email)}
        </p>

        <Field label={m.orders.rejectReason} htmlFor="reject-reason">
          <TextArea
            id="reject-reason"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder={m.orders.rejectPlaceholder}
          />
        </Field>

        {error ? <div className="alert">{error}</div> : null}

        <div className="modal__actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {m.common.cancel}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy ? m.orders.rejecting : m.orders.rejectTitle}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ----------------------------- Date bancare ------------------------- */

interface BankForm {
  bank_beneficiary: string;
  bank_iban: string;
  bank_name: string;
  instructions: string;
}

function toBankForm(settings: PaymentSettings): BankForm {
  return {
    bank_beneficiary: settings.bank_beneficiary,
    bank_iban: settings.bank_iban,
    bank_name: settings.bank_name,
    instructions: settings.instructions,
  };
}

function PaymentSettingsCard(): JSX.Element {
  const m = useMessages(ticketsMessages);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BankForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Doar faptul că s-a salvat; textul vine din dicționar, deci urmează limba activă.
  const [saved, setSaved] = useState(false);

  const query = useQuery({ queryKey: ['payment-settings'], queryFn: fetchPaymentSettings });

  // Sincronizează formularul cu datele de la backend o singură dată, la sosire.
  useEffect(() => {
    if (query.data && form === null) setForm(toBankForm(query.data));
  }, [query.data, form]);

  const save = useMutation({
    mutationFn: (body: PaymentSettings) => updatePaymentSettings(body),
    onSuccess: async (settings) => {
      setError(null);
      setSaved(true);
      setForm(toBankForm(settings));
      await queryClient.invalidateQueries({ queryKey: ['payment-settings'] });
    },
    onError: (mutationError: unknown) => setError(errorMessage(mutationError)),
  });

  const set = <K extends keyof BankForm>(key: K, value: BankForm[K]): void =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  // Validare minimă: beneficiar și IBAN ne-goale.
  const valid =
    form !== null &&
    form.bank_beneficiary.trim().length > 0 &&
    form.bank_iban.trim().length > 0;

  const submit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault();
    if (!form || !valid || save.isPending) return;
    setSaved(false);
    save.mutate({
      bank_beneficiary: form.bank_beneficiary.trim(),
      bank_iban: form.bank_iban.trim(),
      bank_name: form.bank_name.trim(),
      instructions: form.instructions.trim(),
    });
  };

  return (
    <Card title={m.bank.title}>
      {query.isPending || form === null ? (
        <LoadingState label={m.bank.loading} />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <form className="modal__body" onSubmit={submit}>
          <p className="muted" style={{ margin: 0 }}>
            {m.bank.intro}
          </p>

          {saved ? <div className="alert alert--success">{m.bank.saved}</div> : null}

          <div className="form-grid">
            <Field label={m.bank.beneficiary} htmlFor="bank-beneficiary">
              <TextInput
                id="bank-beneficiary"
                value={form.bank_beneficiary}
                maxLength={200}
                required
                onChange={(e) => set('bank_beneficiary', e.target.value)}
              />
            </Field>
            <Field label={m.bank.bankName} htmlFor="bank-name">
              <TextInput
                id="bank-name"
                value={form.bank_name}
                maxLength={200}
                onChange={(e) => set('bank_name', e.target.value)}
              />
            </Field>
          </div>

          <Field label={m.bank.iban} htmlFor="bank-iban">
            <TextInput
              id="bank-iban"
              value={form.bank_iban}
              maxLength={64}
              required
              onChange={(e) => set('bank_iban', e.target.value)}
            />
          </Field>

          <Field label={m.bank.instructions} htmlFor="bank-instructions">
            <TextArea
              id="bank-instructions"
              value={form.instructions}
              maxLength={1000}
              onChange={(e) => set('instructions', e.target.value)}
              placeholder={m.bank.instructionsPlaceholder}
            />
          </Field>

          {error ? <div className="alert">{error}</div> : null}

          <div className="modal__actions">
            <Button type="submit" variant="primary" disabled={!valid || save.isPending}>
              {save.isPending ? m.common.saving : m.bank.save}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
