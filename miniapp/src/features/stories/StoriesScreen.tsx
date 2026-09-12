/**
 * Stories în Mini App (TZ secț. 11): bara de povești + vizualizatorul + crearea,
 * într-un SINGUR ecran.
 *
 * DE CE UN SINGUR COMPONENT, când pe mobil sunt trei fișiere
 * (`StoriesBar`, `stories/[userId]`, `stories/new`): ruta e `/stories`, fără
 * parametri, iar `routes.tsx` aparține altui agent. Modul (bară / vizualizator /
 * creare) e deci stare locală, nu URL. Efectul secundar e bun: intrarea în modul
 * de creare și revenirea la bară nu mai trec prin navigare, deci cache-ul de
 * povești nu se reîncarcă la fiecare pas.
 *
 * CE NU E PORTAT, deliberat:
 *  - încărcarea de VIDEO. `backend/app/api/v1/stories.py::_reject_video` ridică
 *    422 pentru orice `video/*` declarat ȘI pentru orice conținut ISO-BMFF
 *    (marcajul `ftyp`), indiferent de extensie — nu există moderare automată de
 *    video (Apple Guideline 1.2). Un buton de „încarcă video" ar fi deci un
 *    buton care garantat eșuează. O poveste `media_type: 'video'` primită de la
 *    server (istoric) e totuși AFIȘATĂ, cu `<video controls playsInline>`;
 *  - camera LIVE (`StoryCameraScreen`): `getUserMedia` în WebView-ul Telegram
 *    cere permisiuni pe care clientul nu le poate acorda din Mini App. Rămâne
 *    `<input type="file">`, care pe telefon deschide oricum camera din sistem;
 *  - avansul automat cu temporizator. În vizualizatorul nativ povestea curge
 *    singură și se pune pe pauză când userul scrie. Aici bara de răspuns e în
 *    pagină, nu peste un ecran plin, iar un temporizator ar schimba povestea sub
 *    degetele celui care tastează. Indicatoarele de progres arată POZIȚIA în
 *    grup; navigarea e explicită (butoane sau săgeți).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { Story, UserStories } from '@mobile/features/stories/types';

import { ConfirmModal } from '@/features/social/ConfirmModal';

import { prepareStoryImageInBrowser } from './imageResize';
import {
  createStory,
  deleteStory,
  fetchMyStories,
  fetchStories,
  replyToStory,
  uploadStoryMedia,
} from './storiesApi';

import './stories.css';

/** Reacțiile rapide: un clic = răspuns trimis, fără tastatură (ca pe mobil). */
export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😍', '👏', '🔥'] as const;

/** Plafon aliniat cu `CAPTION_MAX_LENGTH` din `backend/app/schemas/story.py`. */
export const CAPTION_MAX_LENGTH = 500;

/** Plafon aliniat cu `STORY_REPLY_MAX_LENGTH` din același fișier. */
export const REPLY_MAX_LENGTH = 500;

/**
 * Ce acceptă `<input type="file">` — exact allowlist-ul serverului
 * (`allowed_image_types` din `backend/app/core/config.py`). Filtrul e o
 * comoditate, nu o garanție: verificarea reală o face `imageResize.ts` înainte
 * de upload, iar poarta finală rămâne backendul (magic-bytes).
 */
export const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp';

/** Prima literă a numelui, majusculă (fallback „?"), ca în `StoriesBar`. */
function initial(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

/** `detail`-ul întors de FastAPI, dacă e text. Vine deja în română. */
function serverDetail(error: unknown): string {
  if (!axios.isAxiosError(error)) return '';
  const data = error.response?.data as { detail?: unknown } | undefined;
  return typeof data?.detail === 'string' ? data.detail.trim() : '';
}

/**
 * Eroare al cărei mesaj e DEJA scris pentru utilizator (validarea locală a
 * pozei). Marcarea se face cu o proprietate, nu cu `instanceof`: după
 * transpilare, lanțul de prototipuri al subclaselor de `Error` nu e garantat —
 * aceeași convenție ca în `features/profile/photosApi.ts`.
 */
class LocalImageError extends Error {
  readonly isLocalImageError = true;
}

function isLocalImageError(error: unknown): error is LocalImageError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isLocalImageError?: boolean }).isLocalImageError === true
  );
}

/** Etapa la care a murit publicarea — decide între „upload" și „create". */
type PublishStage = 'prepare' | 'upload' | 'create';

/** Eroare afișată în pagină: titlu opțional (ex. „Poză respinsă") + text. */
interface ShownError {
  title?: string;
  text: string;
}

export function StoriesScreen() {
  // `common` doar pentru acțiunile generice (Închide / Anulează); restul e
  // namespace-ul `stories`, cu prefix explicit, ca în `ChatListScreen`.
  const { t } = useTranslation(['stories', 'common']);
  const queryClient = useQueryClient();

  const [composing, setComposing] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const stories = useQuery<UserStories[]>({ queryKey: ['stories'], queryFn: fetchStories });

  /**
   * CUM ȘTIM CARE POVESTE E A NOASTRĂ: întrebăm serverul, cu `/stories/mine`, și
   * comparăm id-urile.
   *
   * Alternativa ar fi fost să comparăm `story.userId` cu id-ul utilizatorului
   * din store-ul de autentificare. Am ales interogarea fiindcă „a cui e
   * povestea" e exact întrebarea la care ruta asta răspunde, iar serverul e
   * singurul care decide ce se poate șterge (`DELETE /stories/{id}` întoarce 403
   * pentru povestea altcuiva). Așa butonul de ștergere apare fix acolo unde
   * acțiunea chiar va reuși, fără să depindem de starea de autentificare.
   */
  const myStories = useQuery<Story[]>({ queryKey: ['my-stories'], queryFn: fetchMyStories });

  const myIds = useMemo(
    () => new Set((myStories.data ?? []).map((s) => s.id)),
    [myStories.data],
  );

  const groups = stories.data ?? [];
  const group = groups.find((g) => g.userId === selectedUserId);
  const groupStories = group?.stories ?? [];
  // Povestea curentă poate dispărea sub noi (ștergere, expirare la 24h), deci
  // indexul se limitează la ce mai există, nu la ce era când am deschis grupul.
  const safeIndex = Math.min(index, Math.max(0, groupStories.length - 1));
  const current: Story | undefined = groupStories[safeIndex];

  const [replyText, setReplyText] = useState('');
  const [replySent, setReplySent] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [uploadError, setUploadError] = useState<ShownError | null>(null);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<PublishStage>('prepare');

  // Schimbarea poveștii curente resetează confirmarea „Trimis" și erorile: ele
  // se refereau la povestea de dinainte.
  useEffect(() => {
    setReplySent(false);
    setReplyError(null);
    setDeleteError(null);
  }, [selectedUserId, safeIndex]);

  /**
   * Previzualizarea trăiește cât timp e ales fișierul, apoi URL-ul se ELIBEREAZĂ.
   * Fără `revokeObjectURL`, fiecare poză aleasă ar rămâne în memoria WebView-ului
   * până la închiderea Mini App-ului — pe un telefon modest asta înseamnă zeci de
   * MB pierduți după câteva încercări.
   */
  useEffect(() => {
    if (!pickedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pickedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pickedFile]);

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
    if (composing || !group) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.key === 'ArrowLeft') goPrev();
      else if (event.key === 'ArrowRight') goNext();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [composing, group, goPrev, goNext]);

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
      void queryClient.invalidateQueries({ queryKey: ['stories'] });
      void queryClient.invalidateQueries({ queryKey: ['my-stories'] });
    },
    onError: () => {
      setConfirmingDelete(false);
      setDeleteError(t('stories:viewer.deleteError'));
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!pickedFile) throw new LocalImageError(t('stories:messages.uploadFailed'));

      stageRef.current = 'prepare';
      setProgress(0);
      // Micșorarea în browser: fără ea, o poză de telefon ar pleca de 12 MB și
      // s-ar întoarce cu 413 după ce userul a așteptat tot uploadul.
      const prepared = await prepareStoryImageInBrowser(pickedFile);
      if (!prepared.ok) throw new LocalImageError(prepared.message);

      stageRef.current = 'upload';
      const uploaded = await uploadStoryMedia(prepared.blob, prepared.fileName, setProgress);

      stageRef.current = 'create';
      return createStory(
        uploaded.mediaUrl,
        uploaded.mediaType,
        caption.trim() || undefined,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stories'] });
      void queryClient.invalidateQueries({ queryKey: ['my-stories'] });
      setPickedFile(null);
      setCaption('');
      setUploadError(null);
      setProgress(0);
      setComposing(false);
    },
    onError: (error: unknown) => setUploadError(publishError(error, stageRef.current)),
  });

  /** Reduce eșecul publicării la mesajul pe care îl merită utilizatorul. */
  function publishError(error: unknown, stage: PublishStage): ShownError {
    // Validarea locală a pozei (tip nepermis, prea mare după micșorare) vine cu
    // mesajul ei, deja scris pentru om.
    if (isLocalImageError(error)) return { text: error.message };

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const detail = serverDetail(error);

      // Fără răspuns = rețea căzută sau timeout, nu o problemă a pozei.
      if (status === undefined) {
        return {
          text:
            stage === 'create'
              ? t('stories:messages.createFailed')
              : t('stories:messages.uploadFailed'),
        };
      }
      // 413: serverul a măsurat fișierul și l-a refuzat. Mesajul lui conține
      // limita reală, deci îl preferăm celui scris de noi.
      if (status === 413) {
        return {
          text:
            detail ||
            'Poza e prea mare pentru server (limita este 8 MB). Alege altă poză.',
        };
      }
      // 422: moderarea NSFW sau validarea de conținut. `detail`-ul e scris de
      // backend ÎN ROMÂNĂ, exact pentru a fi arătat ca atare — vezi
      // `_MODERATION_MESSAGES` din `backend/app/api/v1/profiles.py`.
      if (status === 422 && detail) {
        return { title: t('stories:compose.rejectedTitle'), text: detail };
      }
      if (detail) return { text: detail };
    }

    return {
      text:
        stage === 'create'
          ? t('stories:messages.createFailed')
          : t('stories:messages.uploadFailed'),
    };
  }

  const openGroup = (userId: string) => {
    setSelectedUserId(userId);
    setIndex(0);
    setReplyText('');
  };

  const openCompose = () => {
    publishMutation.reset();
    setUploadError(null);
    setComposing(true);
  };

  const closeCompose = () => {
    setComposing(false);
    setPickedFile(null);
    setCaption('');
    setUploadError(null);
    setProgress(0);
    publishMutation.reset();
  };

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setUploadError(null);
    publishMutation.reset();
    setPickedFile(file);
  };

  const openFilePicker = () => {
    // Câmpul e ascuns vizual, dar rămâne în DOM: butonul doar îl declanșează.
    fileInputRef.current?.click();
  };

  // ——— Modul de creare ———

  if (composing) {
    const publishing = publishMutation.isPending;
    return (
      <div className="st-screen">
        <header className="st-head">
          <h1 className="title">{t('stories:compose.title')}</h1>
          <button
            type="button"
            className="st-icon-button"
            onClick={closeCompose}
            disabled={publishing}
            aria-label={t('common:actions.close')}
          >
            ✕
          </button>
        </header>
        <p className="caption">{t('stories:compose.hint')}</p>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="st-file-input"
          data-testid="story-file-input"
          onChange={onPickFile}
          disabled={publishing}
        />

        {previewUrl ? (
          <div className="st-compose__preview">
            <img className="st-compose__image" src={previewUrl} alt={caption || ''} />
          </div>
        ) : (
          <div className="st-compose__placeholder">
            <button type="button" className="button" onClick={openFilePicker}>
              Alege o poză
            </button>
          </div>
        )}

        {publishing ? (
          <div className="st-progress-bar" aria-label={t('stories:compose.publish')}>
            <div
              className="st-progress-bar__fill"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        ) : null}

        <label className="st-field">
          <span className="caption">{t('stories:compose.captionLabel')}</span>
          <textarea
            className="st-caption-input"
            value={caption}
            maxLength={CAPTION_MAX_LENGTH}
            placeholder={t('stories:compose.captionPlaceholder')}
            disabled={publishing}
            onChange={(event) => setCaption(event.target.value)}
          />
          <span className="caption st-counter">
            {caption.length}/{CAPTION_MAX_LENGTH}
          </span>
        </label>

        {uploadError ? (
          <div className="st-error" data-testid="story-upload-error">
            {uploadError.title ? (
              <p className="st-error__title">{uploadError.title}</p>
            ) : null}
            <p className="error-text">{uploadError.text}</p>
          </div>
        ) : null}

        <div className="st-compose__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={openFilePicker}
            disabled={publishing}
          >
            {t('stories:compose.retake')}
          </button>
          <button
            type="button"
            className="button"
            data-testid="story-publish"
            disabled={!pickedFile || publishing}
            onClick={() => publishMutation.mutate()}
          >
            {t('stories:compose.publish')}
          </button>
        </div>
      </div>
    );
  }

  // ——— Bara + vizualizatorul ———

  const isMine = current ? myIds.has(current.id) : false;

  return (
    <div className="st-screen">
      <h1 className="title">Povești</h1>

      <div className="st-bar">
        <button
          type="button"
          className="st-bar__item"
          data-testid="stories-add"
          aria-label={t('stories:bar.addLabel')}
          onClick={openCompose}
        >
          <span className="st-bar__ring st-bar__ring--add" aria-hidden="true">
            ＋
          </span>
          <span className="caption st-bar__name">{t('stories:bar.add')}</span>
        </button>

        {groups.map((g) => (
          <button
            key={g.userId}
            type="button"
            className={`st-bar__item${g.userId === selectedUserId ? ' st-bar__item--active' : ''}`}
            data-testid={`story-group-${g.userId}`}
            aria-label={t('stories:bar.open', { name: g.name })}
            onClick={() => openGroup(g.userId)}
          >
            <span className="st-bar__ring" aria-hidden="true">
              {initial(g.name)}
            </span>
            <span className="caption st-bar__name">{g.name}</span>
            <span className="caption st-bar__count">{g.storyCount}</span>
          </button>
        ))}
      </div>

      {/* Încărcarea și eroarea vin ÎNAINTEA ramurii de „gol": altfel, cât timp
          `fetchStories` e în zbor, lista e goală și userul ar citi „nu există
          povești" în loc să vadă spinnerul. */}
      {stories.isPending ? (
        <div className="st-state">
          <div className="spinner" role="status" aria-label={t('stories:viewer.retry')} />
        </div>
      ) : stories.isError ? (
        <div className="st-state" data-testid="stories-error">
          <p className="error-text">{t('stories:viewer.loadError')}</p>
          <button
            type="button"
            className="button"
            disabled={stories.isFetching}
            onClick={() => void stories.refetch()}
          >
            {t('stories:viewer.retry')}
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="st-state" data-testid="stories-empty">
          <p className="body-text">{t('stories:viewer.empty')}</p>
        </div>
      ) : !group || !current ? null : (
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
              onClick={() => setSelectedUserId(null)}
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

              {replySent ? <p className="caption">Trimis ✓</p> : null}
              {replyError ? <p className="error-text">{replyError}</p> : null}
            </div>
          )}
        </section>
      )}

      {/* Ștergerea e ireversibilă → confirmare proprie, în DOM. `confirm()` nu
          e o opțiune: dialogurile native blochează WebView-ul Telegram. */}
      <ConfirmModal
        open={confirmingDelete}
        title={t('stories:viewer.delete')}
        body="Povestea va fi ștearsă definitiv."
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        busy={deleteMutation.isPending}
        testId="story-delete-confirm"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          if (current) deleteMutation.mutate(current.id);
        }}
      />
    </div>
  );
}

export default StoriesScreen;
