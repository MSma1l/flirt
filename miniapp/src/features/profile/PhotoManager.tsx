/**
 * Grila de poze de profil pentru DOM: adăugare, ștergere cu confirmare, ordonare.
 *
 * Port al lui `mobile/src/features/photos/PhotoGrid.tsx`, cu aceleași decizii:
 *  - prima poză e cea PRINCIPALĂ (o vede lumea prima în feed) și e marcată;
 *  - reordonarea se face cu săgeți ‹ ›, nu prin drag & drop: e accesibilă la
 *    tastatură, funcționează cu cititoarele de ecran și nu cere nicio
 *    dependență în plus;
 *  - ștergerea CERE confirmare — o poză ștearsă nu se recuperează — iar cînd
 *    dispare poza principală utilizatorul e avertizat explicit.
 *
 * Diferența față de nativ: adăugarea trece printr-un `<input type="file">`
 * ascuns, iar dialogul de confirmare e cel propriu (`ConfirmDialog`), fiindcă
 * `window.confirm` blochează WebView-ul Telegram.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from './ConfirmDialog';
import { PHOTO_LIMITS } from './photoResize';

/** O celulă din grilă: poză de pe server sau previzualizarea uneia în urcare. */
export interface PhotoTile {
  key: string;
  url: string;
  uploading?: boolean;
  /** Progresul uploadului, între 0 și 1. */
  progress?: number;
}

interface Props {
  tiles: PhotoTile[];
  /** Numărul de poze DEJA salvate pe server (fără cea în curs de upload). */
  savedCount: number;
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  busy?: boolean;
  error?: string | null;
}

export function PhotoManager({
  tiles,
  savedCount,
  onAdd,
  onRemove,
  onMove,
  busy,
  error,
}: Props) {
  const { t } = useTranslation(['profile', 'common']);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);

  const canAdd = savedCount < PHOTO_LIMITS.max;

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Resetăm valoarea ca alegerea ACELUIAȘI fișier a doua oară să declanșeze
    // iar evenimentul (altfel `change` nu mai apare și butonul pare mort).
    event.target.value = '';
    if (file) onAdd(file);
  };

  const confirmBody =
    pendingRemoval === 0 && savedCount > 1
      ? t('photos.confirm.main')
      : t('photos.confirm.other');

  return (
    <section className="pf-photo-manager">
      <p className="caption pf-photo-manager__counter">
        {t('photos.counter', {
          current: savedCount,
          max: PHOTO_LIMITS.max,
          min: PHOTO_LIMITS.min,
        })}
      </p>

      <div className="pf-photo-grid">
        {tiles.map((tile, index) => (
          <div className="pf-photo-tile" key={tile.key} data-testid={`photo-tile-${index}`}>
            <img
              className="pf-photo-tile__img"
              src={tile.url}
              alt={
                index === 0
                  ? t('photos.a11y.mainPhoto')
                  : t('photos.a11y.photo', { number: index + 1 })
              }
              draggable={false}
            />

            {index === 0 && !tile.uploading ? (
              <span className="pf-photo-tile__badge">{t('photos.mainBadge')}</span>
            ) : null}

            {tile.uploading ? (
              <div className="pf-photo-tile__progress" role="status">
                {Math.round((tile.progress ?? 0) * 100)}%
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="pf-photo-tile__remove"
                  disabled={busy}
                  onClick={() => setPendingRemoval(index)}
                  aria-label={t('photos.a11y.remove', { number: index + 1 })}
                  data-testid={`photo-remove-${index}`}
                >
                  ✕
                </button>
                <div className="pf-photo-tile__move">
                  <button
                    type="button"
                    className="pf-photo-tile__arrow"
                    disabled={busy || index === 0}
                    onClick={() => onMove(index, index - 1)}
                    aria-label={t('photos.a11y.moveEarlier', { number: index + 1 })}
                    data-testid={`photo-earlier-${index}`}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="pf-photo-tile__arrow"
                    disabled={busy || index >= savedCount - 1}
                    onClick={() => onMove(index, index + 1)}
                    aria-label={t('photos.a11y.moveLater', { number: index + 1 })}
                    data-testid={`photo-later-${index}`}
                  >
                    ›
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        {canAdd ? (
          <button
            type="button"
            className="pf-photo-tile pf-photo-tile--add"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            aria-label={t('photos.a11y.add')}
            data-testid="photo-add"
          >
            <span aria-hidden="true">＋</span>
            <span className="caption">{t('photos.add')}</span>
          </button>
        ) : (
          <p className="caption pf-photo-manager__full">
            {t('photos.maxReached', { count: PHOTO_LIMITS.max })}
          </p>
        )}
      </div>

      {/* Ascuns, dar chemat prin `click()` din butonul de mai sus: un
          `<input type="file">` stilizat direct e inconsistent între browsere. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleFile}
        data-testid="photo-input"
      />

      {error ? (
        <p className="error-text" role="alert" data-testid="photos-error">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={t('photos.confirm.title')}
        body={confirmBody}
        confirmLabel={t('common:actions.delete')}
        destructive
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          const index = pendingRemoval;
          setPendingRemoval(null);
          if (index !== null) onRemove(index);
        }}
      />
    </section>
  );
}
