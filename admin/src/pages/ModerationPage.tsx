/**
 * Coada de moderare — ecranul operațional cel mai important.
 *
 * Apple (App Store Review 1.2 — User-Generated Content) cere ca un raport de
 * conținut abuziv să primească răspuns în ≤24h. De aceea: coada e sortată de
 * backend „cele mai vechi întâi", timpul scurs e vizibil pe fiecare intrare, iar
 * acțiunile sunt la un click distanță — dar NICIUNA nu se execută fără confirmare.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { fetchReports, resolveReport } from '../api/admin';
import type { AdminReport, ResolveAction } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { useMessages } from '../i18n/LanguageContext';
import { coreMessages } from '../i18n/messages/core';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatRelative } from '../lib/format';

interface PendingAction {
  report: AdminReport;
  action: ResolveAction;
}

/** Doar ban/ascundere sunt distructive; textele vin din dicționarul `core`. */
const ACTION_DANGER: Record<ResolveAction, boolean> = {
  ban: true,
  hide: true,
  dismiss: false,
};

export function ModerationPage(): JSX.Element {
  const m = useMessages(coreMessages).moderation;
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['reports', 'open'],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchReports({ status: 'open', cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const reports: AdminReport[] = query.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = reports.find((report) => report.id === selectedId) ?? reports[0] ?? null;

  const resolve = useMutation({
    mutationFn: ({ report, action, reason }: PendingAction & { reason?: string }) =>
      resolveReport(report.id, action, reason),
    onSuccess: async () => {
      setPending(null);
      setActionError(null);
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
      await queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  if (query.isPending) return <LoadingState label={m.loading} />;
  if (query.isError) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }

  if (reports.length === 0) {
    return (
      <Card>
        <EmptyState
          title={m.emptyTitle}
          hint={m.emptyHint}
        />
      </Card>
    );
  }

  const copy = pending ? m.actions[pending.action] : null;

  return (
    <div className="moderation">
      <Card title={m.openReports(reports.length)}>
        <div className="queue">
          {reports.map((report) => {
            const isActive = selected?.id === report.id;
            return (
              <button
                key={report.id}
                type="button"
                className={isActive ? 'queue__item queue__item--active' : 'queue__item'}
                onClick={() => setSelectedId(report.id)}
                aria-current={isActive}
              >
                <div className="queue__head">
                  <span className="queue__name">
                    {report.reported?.name ?? report.reported?.email ?? m.unknownProfile}
                  </span>
                  <Badge tone={report.reporters_count > 1 ? 'danger' : 'neutral'}>
                    {m.reportsCount(report.reporters_count)}
                  </Badge>
                </div>
                <div className="queue__head">
                  <Badge tone="warning">{report.category}</Badge>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {formatRelative(report.created_at)}
                  </span>
                </div>
                {report.note ? <span className="queue__note">{report.note}</span> : null}
              </button>
            );
          })}
        </div>

        {query.hasNextPage ? (
          <div className="pagination">
            <span />
            <Button
              small
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? m.loadingMore : m.loadMore}
            </Button>
          </div>
        ) : null}
      </Card>

      {selected ? (
        <Card title={m.reportedProfile}>
          <dl className="detail-rows">
            <div className="detail-row">
              <dt>{m.name}</dt>
              <dd>{selected.reported?.name ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>{m.email}</dt>
              <dd>{selected.reported?.email ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>{m.ageCity}</dt>
              <dd>
                {selected.reported?.age ?? '—'} · {selected.reported?.city ?? '—'}
              </dd>
            </div>
            <div className="detail-row">
              <dt>{m.about}</dt>
              <dd>{selected.reported?.about ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>{m.category}</dt>
              <dd>
                <Badge tone="warning">{selected.category}</Badge>
              </dd>
            </div>
            <div className="detail-row">
              <dt>{m.note}</dt>
              <dd>{selected.note ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>{m.reporters}</dt>
              <dd className="mono">{selected.reporters_count}</dd>
            </div>
            <div className="detail-row">
              <dt>{m.receivedAt}</dt>
              <dd>{formatDateTime(selected.created_at)}</dd>
            </div>
            <div className="detail-row">
              <dt>{m.accountState}</dt>
              <dd>
                {selected.reported?.banned_at ? (
                  <Badge tone="danger">{m.banned}</Badge>
                ) : (
                  <Badge tone="success">{m.active}</Badge>
                )}
              </dd>
            </div>
          </dl>

          {selected.reported && selected.reported.photos.length > 0 ? (
            <div className="photos" style={{ marginTop: 'var(--space-4)' }}>
              {selected.reported.photos.slice(0, 6).map((url) => (
                <img key={url} src={url} alt={m.photoAlt} loading="lazy" />
              ))}
            </div>
          ) : null}

          <div className="actions-row">
            <Button
              variant="danger"
              onClick={() => {
                setActionError(null);
                setPending({ report: selected, action: 'ban' });
              }}
            >
              {m.actions.ban.confirm}
            </Button>
            <Button
              onClick={() => {
                setActionError(null);
                setPending({ report: selected, action: 'hide' });
              }}
            >
              {m.actions.hide.confirm}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setActionError(null);
                setPending({ report: selected, action: 'dismiss' });
              }}
            >
              {m.actions.dismiss.confirm}
            </Button>
          </div>
        </Card>
      ) : null}

      {pending && copy ? (
        <ConfirmDialog
          title={copy.title}
          message={copy.message}
          confirmLabel={copy.confirm}
          danger={ACTION_DANGER[pending.action]}
          reasonLabel={m.reasonLabel}
          busy={resolve.isPending}
          errorMessage={actionError}
          onCancel={() => {
            setPending(null);
            setActionError(null);
          }}
          onConfirm={(reason) => {
            resolve.mutate({ ...pending, reason: reason || undefined });
          }}
        />
      ) : null}
    </div>
  );
}
