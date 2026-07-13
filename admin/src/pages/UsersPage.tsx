/**
 * Utilizatori: căutare + filtre, paginare SERVER-SIDE (cursor în `X-Next-Cursor`),
 * detalii, ban / deban și ștergere GDPR.
 *
 * Ștergerea e IREVERSIBILĂ → confirmare DUBLĂ: dialog + tastarea emailului contului.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { banUser, deleteUser, fetchUser, fetchUsers, unbanUser } from '../api/admin';
import type { AdminUser, UserStatusFilter } from '../api/types';
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
  Select,
  TextInput,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

const PAGE_SIZE = 20;

type Dialog =
  | { kind: 'ban'; user: AdminUser }
  | { kind: 'unban'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser }
  | { kind: 'detail'; user: AdminUser };

const STATUS_OPTIONS: readonly { value: UserStatusFilter; label: string }[] = [
  { value: 'all', label: 'Toți' },
  { value: 'active', label: 'Activi' },
  { value: 'banned', label: 'Banați' },
  { value: 'reported', label: 'Raportați' },
] as const;

export function UsersPage(): JSX.Element {
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatusFilter>('all');
  // Stiva de cursoare = butonul „Înapoi" al paginării pe cursor (cursorul nu e reversibil).
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const cursor = cursors[pageIndex];

  const query = useQuery({
    queryKey: ['users', { search, status, cursor }],
    queryFn: () => fetchUsers({ q: search, status, cursor, limit: PAGE_SIZE }),
  });

  const resetPaging = (): void => {
    setCursors([undefined]);
    setPageIndex(0);
  };

  const onSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSearch(searchInput.trim());
    resetPaging();
  };

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['users'] });
    await queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const closeDialog = (): void => {
    setDialog(null);
    setActionError(null);
  };

  const ban = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      banUser(id, { reason }),
    onSuccess: async () => {
      closeDialog();
      await invalidate();
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const unban = useMutation({
    mutationFn: (id: string) => unbanUser(id),
    onSuccess: async () => {
      closeDialog();
      await invalidate();
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: async () => {
      closeDialog();
      await invalidate();
    },
    onError: (error: unknown) => setActionError(errorMessage(error)),
  });

  const nextCursor = query.data?.next_cursor ?? null;
  const users = query.data?.items ?? [];

  return (
    <>
      <Card>
        <form className="toolbar" onSubmit={onSearch}>
          <div style={{ flex: '1 1 260px' }}>
            <Field label="Caută (email sau nume)" htmlFor="user-search">
              <TextInput
                id="user-search"
                value={searchInput}
                placeholder="ana@exemplu.ro"
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </Field>
          </div>
          <div style={{ width: 180 }}>
            <Field label="Stare" htmlFor="user-status">
              <Select
                id="user-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as UserStatusFilter);
                  resetPaging();
                }}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" variant="primary">
            Caută
          </Button>
        </form>
      </Card>

      <Card>
        {query.isPending ? (
          <LoadingState label="Se încarcă utilizatorii…" />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : users.length === 0 ? (
          <EmptyState title="Niciun utilizator" hint="Schimbă căutarea sau filtrul de stare." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Nume</th>
                    <th>Oraș</th>
                    <th>Înscris</th>
                    <th>Ultima activitate</th>
                    <th>Rapoarte</th>
                    <th>Stare</th>
                    <th aria-label="Acțiuni" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.email}</td>
                      <td>{user.name ?? '—'}</td>
                      <td>{user.city ?? '—'}</td>
                      <td className="muted mono">{formatDateTime(user.created_at)}</td>
                      <td className="muted mono">{formatDateTime(user.last_active_at)}</td>
                      <td className="mono">{user.reports_count}</td>
                      <td>
                        {user.banned_at ? (
                          <Badge tone="danger">Banat</Badge>
                        ) : (
                          <Badge tone="success">Activ</Badge>
                        )}
                      </td>
                      <td>
                        <div className="table__actions">
                          <Button small onClick={() => setDialog({ kind: 'detail', user })}>
                            Detalii
                          </Button>
                          {user.banned_at ? (
                            <Button small onClick={() => setDialog({ kind: 'unban', user })}>
                              Deban
                            </Button>
                          ) : (
                            <Button
                              small
                              variant="danger"
                              onClick={() => setDialog({ kind: 'ban', user })}
                            >
                              Ban
                            </Button>
                          )}
                          <Button
                            small
                            variant="danger"
                            onClick={() => setDialog({ kind: 'delete', user })}
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

            <div className="pagination">
              <span className="muted">Pagina {pageIndex + 1}</span>
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

      {dialog?.kind === 'detail' ? (
        <UserDetailModal userId={dialog.user.id} onClose={closeDialog} />
      ) : null}

      {dialog?.kind === 'ban' ? (
        <ConfirmDialog
          title="Banează contul"
          message={`Contul ${dialog.user.email} nu se va mai putea autentifica, iar profilul dispare din feed. Poate fi debanat ulterior.`}
          confirmLabel="Banează contul"
          reasonLabel="Motivul banului"
          reasonRequired
          busy={ban.isPending}
          errorMessage={actionError}
          onCancel={closeDialog}
          onConfirm={(reason) => ban.mutate({ id: dialog.user.id, reason: reason ?? '' })}
        />
      ) : null}

      {dialog?.kind === 'unban' ? (
        <ConfirmDialog
          title="Ridică banul"
          message={`Contul ${dialog.user.email} va putea folosi din nou aplicația, iar profilul revine în feed.`}
          confirmLabel="Ridică banul"
          danger={false}
          busy={unban.isPending}
          errorMessage={actionError}
          onCancel={closeDialog}
          onConfirm={() => unban.mutate(dialog.user.id)}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title="Ștergere GDPR — ireversibilă"
          message={`Contul ${dialog.user.email}, profilul, fotografiile, match-urile și mesajele lui vor fi ȘTERSE definitiv. Nu există „undo" și datele NU pot fi recuperate.`}
          confirmLabel="Șterge definitiv"
          confirmPhrase={dialog.user.email}
          reasonLabel="Motivul ștergerii"
          reasonRequired
          busy={remove.isPending}
          errorMessage={actionError}
          onCancel={closeDialog}
          onConfirm={() => remove.mutate(dialog.user.id)}
        />
      ) : null}
    </>
  );
}

function UserDetailModal({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}): JSX.Element {
  const query = useQuery({ queryKey: ['users', userId], queryFn: () => fetchUser(userId) });

  return (
    <Modal title="Detalii utilizator" onClose={onClose} wide>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <dl className="detail-rows">
            <div className="detail-row">
              <dt>Email</dt>
              <dd>{query.data.email}</dd>
            </div>
            <div className="detail-row">
              <dt>Nume</dt>
              <dd>{query.data.name ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>Vârstă</dt>
              <dd>{query.data.age ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>Oraș</dt>
              <dd>{query.data.city ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>Descriere</dt>
              <dd>{query.data.about ?? '—'}</dd>
            </div>
            <div className="detail-row">
              <dt>Match-uri</dt>
              <dd className="mono">{query.data.matches_count}</dd>
            </div>
            <div className="detail-row">
              <dt>Rapoarte primite</dt>
              <dd className="mono">{query.data.reports_count}</dd>
            </div>
            <div className="detail-row">
              <dt>Abonament</dt>
              <dd>{query.data.subscription_plan ?? 'fără'}</dd>
            </div>
            <div className="detail-row">
              <dt>Stare</dt>
              <dd>
                {query.data.banned_at ? (
                  <Badge tone="danger">Banat — {query.data.ban_reason ?? 'fără motiv'}</Badge>
                ) : (
                  <Badge tone="success">Activ</Badge>
                )}
              </dd>
            </div>
          </dl>
          {query.data.photos.length > 0 ? (
            <div className="photos">
              {query.data.photos.slice(0, 6).map((url) => (
                <img key={url} src={url} alt="Fotografie de profil" loading="lazy" />
              ))}
            </div>
          ) : null}
        </>
      )}
      <div className="modal__actions">
        <Button variant="ghost" onClick={onClose}>
          Închide
        </Button>
      </div>
    </Modal>
  );
}
