/**
 * Câmp media reutilizabil: buton principal „Încarcă … de pe dispozitiv" (pe
 * telefon deschide galeria/camera), previzualizare + „Șterge" după încărcare și,
 * secundar, un câmp pliat pentru un URL lipit manual. Ambele scriu în aceeași
 * valoare (URL-ul public întors de server sau cel lipit).
 *
 * Folosit de reclame (imagine + video) și de coperta evenimentelor; ce diferă
 * (ruta de upload, tipurile acceptate, limita, textele) vine prin props.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { API_BASE, ApiError } from '../api/client';
import { errorMessage } from '../lib/errors';
import { Button, Spinner, TextInput } from './ui';

export type MediaKind = 'video' | 'image';

export const MB = 1024 * 1024;

/**
 * Tipurile și limita acceptate local (feedback imediat, fără să urce degeaba un
 * fișier mare). Limitele serverului rămân cele care decid (413/415 sunt traduse).
 * `extensions` acoperă telefoanele care trimit fișierul cu `type` gol.
 */
export interface MediaRules {
  types: string[];
  extensions: string[];
  maxBytes: number;
}

export const IMAGE_RULES: MediaRules = {
  types: ['image/jpeg', 'image/png', 'image/webp'],
  extensions: ['jpg', 'jpeg', 'png', 'webp'],
  maxBytes: 8 * MB,
};

export const VIDEO_RULES: MediaRules = {
  types: ['video/mp4', 'video/webm', 'video/quicktime'],
  extensions: ['mp4', 'webm', 'mov'],
  maxBytes: 50 * MB,
};

export interface MediaUploadTexts {
  /** Eticheta câmpului; lipsește când un `<legend>` din jur o spune deja. */
  label?: string;
  hint: ReactNode;
  upload: string;
  replace: string;
  uploading: string;
  /** Textul vizibil al butonului de ștergere („Șterge"). */
  remove: string;
  /** Numele accesibil al butonului de ștergere („Șterge imaginea"). */
  removeLabel: string;
  preview: string;
  badType: string;
  tooLarge: string;
  unreadable: string;
  pasteUrl: string;
  urlLabel: string;
}

function hasAllowedType(file: File, rules: MediaRules): boolean {
  if (file.type) return rules.types.includes(file.type);
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return rules.extensions.includes(extension);
}

/** URL-urile relative (`/media/...`) întoarse de backend se previzualizează de pe API. */
export function previewSrc(url: string): string {
  return url.startsWith('/') && !url.startsWith('//') ? `${API_BASE}${url}` : url;
}

const DEFAULT_PREVIEW_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  maxWidth: 320,
  maxHeight: 220,
  objectFit: 'contain',
  background: 'var(--color-surface)',
  borderRadius: 12,
  border: '1px solid var(--color-border)',
  marginBottom: 8,
};

export function MediaUploadField({
  kind,
  idPrefix,
  value,
  onChange,
  onUploadingChange,
  upload,
  rules,
  texts,
  previewTestId,
  previewStyle,
  urlMaxLength,
  urlPlaceholder = 'https://',
  urlInvalid = false,
}: {
  kind: MediaKind;
  /** `id`-ul câmpului URL; inputul de fișier primește `${idPrefix}-file`. */
  idPrefix: string;
  value: string;
  onChange: (url: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  upload: (file: File, signal?: AbortSignal) => Promise<{ url: string }>;
  rules: MediaRules;
  texts: MediaUploadTexts;
  previewTestId?: string;
  previewStyle?: CSSProperties;
  urlMaxLength?: number;
  urlPlaceholder?: string;
  /** URL-ul are o eroare de validare: câmpul se deschide și e marcat invalid. */
  urlInvalid?: boolean;
}): JSX.Element {
  const isVideo = kind === 'video';
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Modalul închis în timpul încărcării: anulăm cererea, nu mai scriem nimic.
  useEffect(() => () => abortRef.current?.abort(), []);

  // O eroare pe URL nu are voie să stea ascunsă într-un <details> închis.
  useEffect(() => {
    if (urlInvalid) setUrlOpen(true);
  }, [urlInvalid]);

  const serverError = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.code === 'file_too_large' || err.status === 413) return texts.tooLarge;
      if (err.code === 'unsupported_media_type' || err.status === 415) return texts.badType;
      if (err.status === 422) return texts.unreadable;
    }
    return errorMessage(err);
  };

  const setBusy = (active: boolean): void => {
    setUploading(active);
    onUploadingChange?.(active);
  };

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file || uploading) return;
    if (!hasAllowedType(file, rules)) {
      setError(texts.badType);
      return;
    }
    if (file.size > rules.maxBytes) {
      setError(texts.tooLarge);
      return;
    }
    if (file.size === 0) {
      setError(texts.unreadable);
      return;
    }
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const media = await upload(file, controller.signal);
      if (controller.signal.aborted) return;
      onChange(media.url);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setError(serverError(err));
    } finally {
      if (!controller.signal.aborted) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const fileId = `${idPrefix}-file`;
  const urlId = idPrefix;
  const hasValue = value.trim() !== '';
  const style = { ...DEFAULT_PREVIEW_STYLE, ...previewStyle };

  return (
    <div className="field">
      {texts.label ? <span className="field__label">{texts.label}</span> : null}
      <p className="field__hint">{texts.hint}</p>

      {hasValue ? (
        isVideo ? (
          <video
            src={previewSrc(value.trim())}
            controls
            playsInline
            muted
            preload="metadata"
            aria-label={texts.preview}
            data-testid={previewTestId}
            style={style}
          />
        ) : (
          <img
            src={previewSrc(value.trim())}
            alt={texts.preview}
            data-testid={previewTestId}
            style={style}
          />
        )
      ) : null}

      <div className="table__actions" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          className={`btn ${hasValue ? 'btn--ghost' : 'btn--primary'}`}
          htmlFor={fileId}
          aria-disabled={uploading || undefined}
          style={uploading ? { opacity: 0.6, cursor: 'progress' } : undefined}
        >
          {uploading ? texts.uploading : hasValue ? texts.replace : texts.upload}
        </label>
        <input
          id={fileId}
          type="file"
          accept={rules.types.join(',')}
          disabled={uploading}
          aria-label={hasValue ? texts.replace : texts.upload}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {uploading ? <Spinner /> : null}
        {hasValue && !uploading ? (
          <Button
            small
            variant="danger"
            aria-label={texts.removeLabel}
            onClick={() => {
              setError(null);
              onChange('');
            }}
          >
            {texts.remove}
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}

      <details open={urlOpen} onToggle={(e) => setUrlOpen(e.currentTarget.open)}>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
          {texts.pasteUrl}
        </summary>
        <div className="field" style={{ marginTop: 8 }}>
          <label className="field__label" htmlFor={urlId}>
            {texts.urlLabel}
          </label>
          <TextInput
            id={urlId}
            type="url"
            inputMode="url"
            placeholder={urlPlaceholder}
            value={value}
            maxLength={urlMaxLength}
            disabled={uploading}
            aria-invalid={urlInvalid || undefined}
            onChange={(e) => {
              setError(null);
              onChange(e.target.value);
            }}
          />
        </div>
      </details>
    </div>
  );
}
