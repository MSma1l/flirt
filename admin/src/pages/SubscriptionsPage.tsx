/**
 * Abonamente: listă + acordare manuală (suport, compensații, testeri).
 * Acordarea manuală intră în jurnalul de audit pe backend (`subscription.grant`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { fetchSubscriptions, grantSubscription } from '../api/admin';
import { SUBSCRIPTION_PLANS, type SubscriptionStatus } from '../api/types';
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
  TextInput,
  type BadgeTone,
} from '../components/ui';
import { useMessages } from '../i18n/LanguageContext';
import { subscriptionsMessages } from '../i18n/messages/subscriptions';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

const STATUS_TONE: Record<SubscriptionStatus, BadgeTone> = {
  active: 'success',
  expired: 'neutral',
  canceled: 'danger',
};

export function SubscriptionsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const m = useMessages(subscriptionsMessages);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => fetchSubscriptions({}),
  });

  const grant = useMutation({
    mutationFn: grantSubscription,
    onSuccess: async (subscription) => {
      setGranting(false);
      setError(null);
      setNotice(m.granted(subscription.plan, subscription.user_email));
      await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      await queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (mutationError: unknown) => setError(errorMessage(mutationError)),
  });

  const subscriptions = query.data?.items ?? [];

  return (
    <>
      {notice ? <div className="alert alert--success">{notice}</div> : null}

      <Card
        title={m.title}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setError(null);
              setNotice(null);
              setGranting(true);
            }}
          >
            {m.grantManually}
          </Button>
        }
      >
        {query.isPending ? (
          <LoadingState label={m.loading} />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : subscriptions.length === 0 ? (
          <EmptyState title={m.emptyTitle} hint={m.emptyHint} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{m.columns.user}</th>
                  <th>{m.columns.plan}</th>
                  <th>{m.columns.provider}</th>
                  <th>{m.columns.started}</th>
                  <th>{m.columns.expires}</th>
                  <th>{m.columns.status}</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((subscription) => (
                  <tr key={subscription.id}>
                    <td>{subscription.user_email}</td>
                    <td>{subscription.plan}</td>
                    <td className="muted">{subscription.provider}</td>
                    <td className="muted mono">{formatDateTime(subscription.created_at)}</td>
                    <td className="muted mono">{formatDateTime(subscription.expires_at)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[subscription.status] ?? 'neutral'}>
                        {subscription.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {granting ? (
        <GrantModal
          busy={grant.isPending}
          errorMessage={error}
          onCancel={() => {
            setGranting(false);
            setError(null);
          }}
          onSubmit={(email, plan, days) => grant.mutate({ email, plan, days })}
        />
      ) : null}
    </>
  );
}

function GrantModal({
  busy,
  errorMessage: error,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (email: string, plan: string, days: number) => void;
}): JSX.Element {
  const m = useMessages(subscriptionsMessages);
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<string>(SUBSCRIPTION_PLANS[0]);
  const [days, setDays] = useState('30');

  const parsedDays = Number(days);
  const valid =
    email.trim().length > 3 && Number.isInteger(parsedDays) && parsedDays > 0 && parsedDays <= 3650;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!valid || busy) return;
    onSubmit(email.trim(), plan, parsedDays);
  };

  return (
    <Modal title={m.modalTitle} onClose={onCancel}>
      <form className="modal__body" onSubmit={submit}>
        <Field label={m.emailLabel} htmlFor="grant-email">
          <TextInput
            id="grant-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label={m.planLabel} htmlFor="grant-plan">
          <Select id="grant-plan" value={plan} onChange={(event) => setPlan(event.target.value)}>
            {SUBSCRIPTION_PLANS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={m.daysLabel} htmlFor="grant-days">
          <TextInput
            id="grant-days"
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
        </Field>

        {error ? <div className="alert">{error}</div> : null}

        <div className="modal__actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {m.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || busy}>
            {busy ? m.granting : m.grant}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
