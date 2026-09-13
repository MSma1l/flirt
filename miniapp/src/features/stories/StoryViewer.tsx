/**
 * Vizualizatorul unui grup de povești: media, navigarea în grup, răspunsul (la
 * povestea altcuiva) sau ștergerea (la povestea proprie).
 *
 * EXTRAS din `StoriesScreen`, fără schimbări de comportament, fiindcă acum are
 * DOI chemători: ecranul separat (`/stories`, în pagină) și bara din capul
 * feedului de ankete (`StoriesStrip`, peste tot ecranul). Un al doilea
 * vizualizator, copiat, ar fi însemnat două locuri în care se repară aceeași
 * greșeală.
 *
 * CE NU E PORTAT, deliberat (ca pe mobil nu e la fel): avansul automat cu
 * temporizator. Bara de răspuns e în pagină, nu peste ecran, iar un temporizator
 * ar schimba povestea sub degetele celui care tastează. Indicatoarele de progres
 * arată POZIȚIA în grup; navigarea e explicită (butoane sau săgeți).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Story, UserStories } from '@mobile/features/stories/types';

import { ConfirmModal } from '@/features/social/ConfirmModal';

import { deleteStory, replyToStory } from './storiesApi';
import { markStorySeen } from './storySeen';
import { MY_STORIES_QUERY_KEY, STORIES_QUERY_KEY, useMyStoryIds } from './useStories';

/** Reacțiile rapide: un clic = răspuns trimis, fără tastatură (ca pe mobil). */
export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😍', '👏', '🔥'] as const;

/** Plafon aliniat cu `STORY_REPLY_MAX_LENGTH` din `backend/app/schemas/story.py`. */
export const REPLY_MAX_LENGTH = 500;

interface Props {
  group: UserStories;
  onClose: () => void;
}

export function StoryViewer({ group, onClose }: Props) {
  const { t } = useTranslation(['stories', 'common', 'screens']);
  const queryClient = useQueryClient();
  const myIds = useMyStoryIds();

  const [index, setIndex] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [replySent, setReplySent] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const groupStories = group.stories;
  // Povestea curentă poate dispărea sub noi (ștergere, expirare la 24h), deci
  // indexul se limitează la ce mai există, nu la ce era când am deschis grupul.
  const safeIndex = Math.min(index, Math.max(0, groupStories.length - 1));
  const current: Story | undefined = groupStories[safeIndex];

  // Schimbarea poveștii curente resetează confirmarea „Trimis" și erorile: ele
  // se refereau la povestea de dinainte.
  useEffect(() => {
    setReplySent(false);
    setReplyError(null);
    setDeleteError(null);
  }, [group.userId, safeIndex]);

  // Povestea afișată e, prin definiție, o poveste văzută: de aici se stinge
  // inelul din bară (`storySeen.ts`).
  useEffect(() => {
    if (current) markStorySeen(current);
  }, [current]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(groupStories.length - 1, i + 1));
  }, [groupStories.length]);

  /**
   * Săgețile stânga/dreapta navighează între poveștile grupului.
   *
   * Excepția e obligatorie: cât timp focusul e într-un câmp de text, săgețile
   * mută cursorul. Dacă am naviga și atunci, cine scrie un răspuns ar trimite
   * mesajul la altă poveste decât cea pe care o vede.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.key === 'ArrowLeft') goPrev();
      else if (event.key === 'ArrowRight') goNext();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [goPrev, goNext]);

  const replyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => replyToStory(id, body),
    onSuccess: () => {
      setReplySent(true);
      setReplyError(null);
      setReplyText('');
      // Răspunsul a plecat ca mesaj de chat → lista de dialoguri e învechită.
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    // Eroarea rămâne ÎN PAGINĂ, sub bara de răspuns: vizualizatorul nu se
    // închide, iar textul scris nu se pierde degeaba.
    onError: () => setReplyError(t('stories:viewer.replyError')),
  });

  const sendReply = (body: string) => {
    const trimmed = body.trim();
    if (!trimmed || !current || replyMutation.isPending) return;
    setReplySent(false);
    setReplyError(null);
    replyMutation.mutate({ id: current.id, body: trimmed.slice(0, REPLY_MAX_LENGTH) });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStory(id),
    onSuccess: () => {
      setConfirmingDelete(false);
      setDeleteError(null);
      void queryClient.invalidateQueries({ queryKey: STORIES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_STORIES_QUERY_KEY });
    },
    onError: () => {
      setConfirmingDelete(false);
      setDeleteError(t('stories:viewer.deleteError'));
    },
  });

  if (!current) return null;

  const isMine = myIds.has(current.id);

  return (
    <section className="st-viewer">
      <div className="st-progress" aria-hidden="true">
        {groupStories.map((s, i) => (
          <span
            key={s.id}
            className={`st-progress__seg${i <= safeIndex ? ' st-progress__seg--done' : ''}`}
          />
        ))}
      </div>

      <header className="st-viewer__head">
        <span className="st-viewer__name">{group.name}</span>
        <button
          type="button"
          className="st-icon-button"
          data-testid="story-close"
          onClick={onClose}
          aria-label={t('common:actions.close')}
        >
          ✕
        </button>
      </header>

      <div className="st-media">
        {current.mediaType === 'video' ? (
          // Poveștile video nu se mai pot CREA (backendul le refuză cu 422),
          // dar cele istorice trebuie să se vadă, nu să apară ca o casetă goală.
          <video
            className="st-media__el"
            data-testid="story-media"
            src={current.mediaUrl}
            controls
            playsInline
          />
        ) : (
          <img
            className="st-media__el"
            data-testid="story-media"
            src={current.mediaUrl}
            alt={current.caption ?? group.name}
          />
        )}
      </div>

      {current.caption ? <p className="body-text">{current.caption}</p> : null}

      <div className="st-nav">
        <button
          type="button"
          className="button button--ghost"
          data-testid="story-prev"
          aria-label={t('stories:viewer.previous')}
          disabled={safeIndex === 0}
          onClick={goPrev}
        >
          ‹
        </button>
        <span className="caption">
          {safeIndex + 1}/{groupStories.length}
        </span>
        <button
          type="button"
          className="button button--ghost"
          data-testid="story-next"
          aria-label={t('stories:viewer.next')}
          disabled={safeIndex >= groupStories.length - 1}
          onClick={goNext}
        >
          ›
        </button>
      </div>

      {isMine ? (
        <div className="st-own">
          <button
            type="button"
            className="button button--ghost st-delete"
            data-testid="story-delete"
            aria-label={t('stories:viewer.delete')}
            disabled={deleteMutation.isPending}
            onClick={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
          >
            {t('stories:viewer.delete')}
          </button>
          {deleteError ? <p className="error-text">{deleteError}</p> : null}
        </div>
      ) : (
        <div className="st-reply">
          <div className="st-reply__reactions">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="st-reply__reaction"
                aria-label={t('stories:reply.react', { emoji })}
                disabled={replyMutation.isPending}
                onClick={() => sendReply(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>

          <form
            className="st-reply__row"
            onSubmit={(event) => {
              event.preventDefault();
              sendReply(replyText);
            }}
          >
            <input
              className="st-reply__input"
              data-testid="story-reply-input"
              aria-label={t('stories:reply.input')}
              placeholder={t('stories:reply.placeholder', { name: group.name })}
              maxLength={REPLY_MAX_LENGTH}
              value={replyText}
              disabled={replyMutation.isPending}
              onChange={(event) => setReplyText(event.target.value)}
            />
            <button
              type="submit"
              className="button st-reply__send"
              data-testid="story-reply-send"
              aria-label={t('stories:reply.send')}
              disabled={replyMutation.isPending || replyText.trim().length === 0}
            >
              {t('stories:reply.sendLabel')}
            </button>
          </form>

          {replySent ? <p className="caption">{t('screens:stories.replySent')}</p> : null}
          {replyError ? <p className="error-text">{replyError}</p> : null}
        </div>
      )}

      {/* Ștergerea e ireversibilă → confirmare proprie, în DOM. `confirm()` nu
          e o opțiune: dialogurile native blochează WebView-ul Telegram. */}
      <ConfirmModal
        open={confirmingDelete}
        title={t('stories:viewer.delete')}
        body={t('screens:stories.deleteBody')}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        busy={deleteMutation.isPending}
        testId="story-delete-confirm"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => deleteMutation.mutate(current.id)}
      />
    </section>
  );
}

export default StoryViewer;
