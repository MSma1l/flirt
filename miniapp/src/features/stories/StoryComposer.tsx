/**
 * Crearea unei povești: alegerea pozei, micșorarea ei în browser, publicarea.
 *
 * EXTRAS din `StoriesScreen`, fără schimbări de comportament: acum se deschide
 * din DOUĂ locuri (ecranul separat și cercul „+" din capul feedului de ankete).
 *
 * Diferențe față de aplicația mobilă:
 *  - încărcarea de VIDEO. `backend/app/api/v1/stories.py::_reject_video` ridică
 *    422 pentru orice `video/*` declarat ȘI pentru orice conținut ISO-BMFF
 *    (marcajul `ftyp`), indiferent de extensie — nu există moderare automată de
 *    video (Apple Guideline 1.2). Un buton de „încarcă video" ar fi deci un
 *    buton care garantat eșuează;
 *  - camera LIVE este încercată prin `getUserMedia`; dacă Telegram/WebView nu
 *    oferă permisiunea, declanșatorul deschide camera NATIVĂ a telefonului
 *    (un al doilea câmp de fișier, cu `capture`).
 *
 * GALERIA vs CAMERA NATIVĂ — DOUĂ câmpuri, nu unul. Atributul `capture` pe un
 * `<input type="file">` îi spune telefonului „deschide direct camera": pe
 * Android (inclusiv WebView-ul Telegram) și pe iOS, butonul de galerie ar fi
 * pornit tot camera, iar o poză deja făcută n-ar fi putut fi aleasă deloc.
 * Câmpul de galerie NU are deci `capture`; doar câmpul camerei native îl are.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMb, prepareStoryImageInBrowser, STORY_IMAGE_LIMITS } from './imageResize';
import { createStory, uploadStoryMedia } from './storiesApi';
import { StoryCamera } from './StoryCamera';
import { MY_STORIES_QUERY_KEY, STORIES_QUERY_KEY } from './useStories';

/** Plafon aliniat cu `CAPTION_MAX_LENGTH` din `backend/app/schemas/story.py`. */
export const CAPTION_MAX_LENGTH = 500;

/**
 * Ce acceptă `<input type="file">`: ORICE imagine, nu lista exactă a serverului.
 *
 * DE CE `image/*` și nu `image/jpeg,image/png,image/webp`: cu o listă de tipuri
 * MIME, unele WebView-uri Android (Telegram printre ele) deschid managerul de
 * fișiere în loc de galeria foto, iar pe unele telefoane nu se mai poate alege
 * nimic. `image/*` deschide galeria peste tot; iOS convertește singur HEIC în
 * JPEG la alegere. Filtrul a fost oricum doar o comoditate: `imageResize.ts`
 * re-encodează în JPEG orice tip care nu e în allowlist, iar poarta finală
 * rămâne backendul (magic-bytes).
 */
export const ACCEPTED_IMAGE_TYPES = 'image/*';

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

interface Props {
  onClose: () => void;
}

export function StoryComposer({ onClose }: Props) {
  const { t } = useTranslation(['stories', 'common', 'screens']);
  const queryClient = useQueryClient();

  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [cameraOpen, setCameraOpen] = useState(true);
  const [uploadError, setUploadError] = useState<ShownError | null>(null);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<PublishStage>('prepare');

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
            t('screens:stories.serverTooLarge', {
              limit: formatMb(STORY_IMAGE_LIMITS.maxUploadBytes),
            }),
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
      return createStory(uploaded.mediaUrl, uploaded.mediaType, caption.trim() || undefined);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORIES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_STORIES_QUERY_KEY });
      onClose();
    },
    onError: (error: unknown) => setUploadError(publishError(error, stageRef.current)),
  });

  const publishing = publishMutation.isPending;

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // Golim câmpul: altfel alegerea ACELEIAȘI poze a doua oară (după „Refă")
    // nu mai declanșează `change`, iar butonul pare stricat.
    event.target.value = '';
    if (!file) return;
    setUploadError(null);
    publishMutation.reset();
    setPickedFile(file);
    setCameraOpen(false);
  };

  const onCameraCapture = (file: File) => {
    setUploadError(null);
    publishMutation.reset();
    setPickedFile(file);
    setCameraOpen(false);
  };

  const openFilePicker = () => {
    // Câmpul e ascuns vizual, dar rămâne în DOM: butonul doar îl declanșează.
    fileInputRef.current?.click();
  };

  const openNativeCamera = () => {
    cameraInputRef.current?.click();
  };

  return (
    <div className="st-compose">
      <header className="st-head">
        <h1 className="title">{t('stories:compose.title')}</h1>
        <button
          type="button"
          className="st-icon-button"
          onClick={onClose}
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
      {/* Camera NATIVĂ: același flux, dar cu `capture` — vezi antetul fișierului. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        capture="user"
        className="st-file-input"
        data-testid="story-camera-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onPickFile}
        disabled={publishing}
      />

      {cameraOpen && !pickedFile ? (
        <StoryCamera
          onClose={onClose}
          onCapture={onCameraCapture}
          onPickGallery={openFilePicker}
          onNativeCamera={openNativeCamera}
        />
      ) : null}

      {previewUrl ? (
        <div className="st-compose__preview">
          <img className="st-compose__image" src={previewUrl} alt={caption || ''} />
          <label className="st-compose__caption-overlay">
            <span className="sr-only">{t('stories:compose.captionLabel')}</span>
            <textarea
              className="st-compose__caption-input"
              value={caption}
              maxLength={CAPTION_MAX_LENGTH}
              placeholder={t('stories:compose.captionPlaceholder')}
              disabled={publishing}
              onChange={(event) => setCaption(event.target.value)}
            />
          </label>
        </div>
      ) : (
        <div className="st-compose__placeholder">
          <button type="button" className="button" onClick={openFilePicker}>
            {t('stories:camera.gallery')}
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

      {pickedFile ? <span className="caption st-counter">{caption.length}/{CAPTION_MAX_LENGTH}</span> : null}

      {uploadError ? (
        <div className="st-error" data-testid="story-upload-error">
          {uploadError.title ? <p className="st-error__title">{uploadError.title}</p> : null}
          <p className="error-text">{uploadError.text}</p>
        </div>
      ) : null}

      <div className="st-compose__actions">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => {
            setUploadError(null);
            publishMutation.reset();
            setPickedFile(null);
            setCameraOpen(true);
          }}
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

export default StoryComposer;
