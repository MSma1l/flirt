/**
 * Raportarea unui utilizator din conversație (TZ 5.5).
 *
 * PORT DOM al lui `mobile/src/features/moderation/ReportModal.tsx`. Cererea e
 * REUTILIZATĂ ca atare din aplicația Expo (`@mobile/features/moderation/reportApi`
 * → `POST /reports/`, confirmată în `backend/app/api/v1/reports.py`); se
 * rescrie doar interfața.
 *
 * Nu folosim `alert()` / `confirm()` — blochează WebView-ul Telegram. Dialogul e
 * un element propriu, cu `role="dialog"`, închis din buton sau cu Escape.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sendReport } from '@mobile/features/moderation/reportApi';
import type { ReportCategory } from '@mobile/features/moderation/types';
import { hasHtml, LIMITS } from '@mobile/utils/validation';

/** Ordinea afișării; eticheta vine din catalog (`moderation:report.categories.*`). */
const CATEGORIES: readonly ReportCategory[] = ['spam', 'fake', 'offensive', 'obscene'];

interface Props {
  reportedUserId: string;
  chatId: string;
  onClose: () => void;
}

export function ReportDialog({ reportedUserId, chatId, onClose }: Props) {
  // „Închide" / „Anulează" sunt acțiuni generice — stau în `common`.
  const { t } = useTranslation(['moderation', 'common', 'auth']);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: (chosen: ReportCategory) =>
      sendReport({ reportedUserId, category: chosen, chatId, note }),
  });

  // Nota e opțională: ≤500 caractere (plafonat de `maxLength`) + fără marcaje
  // HTML — simetric cu `optional_safe_str` din `backend/app/schemas/moderation.py`.
  const noteError = hasHtml(note) ? t('auth:validation.noHtml') : null;
  const canSubmit = category !== null && !noteError && !mutation.isPending;

  return (
    <div
      className="chat-dialog__backdrop"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="chat-dialog" role="dialog" aria-modal="true" aria-label={t('moderation:report.title')}>
        {mutation.isSuccess ? (
          <>
            <h2 className="title">{t('moderation:report.thanks')}</h2>
            <button type="button" className="button" onClick={onClose}>
              {t('common:actions.close')}
            </button>
          </>
        ) : (
          <>
            <h2 className="title">{t('moderation:report.title')}</h2>

            <div className="chat-dialog__options">
              {CATEGORIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    category === value
                      ? 'chat-dialog__option chat-dialog__option--selected'
                      : 'chat-dialog__option'
                  }
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                >
                  {t(`moderation:report.categories.${value}`)}
                </button>
              ))}
            </div>

            <label className="chat-dialog__label" htmlFor="report-note">
              {t('moderation:report.noteLabel')}
            </label>
            <textarea
              id="report-note"
              className="chat-dialog__note"
              value={note}
              maxLength={LIMITS.note}
              placeholder={t('moderation:report.notePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
            {noteError ? (
              <p className="error-text" data-testid="report-note-error">
                {noteError}
              </p>
            ) : null}

            {mutation.isError ? (
              <p className="error-text" data-testid="report-error">
                {t('moderation:report.sendError')}
              </p>
            ) : null}

            <button
              type="button"
              className="button"
              disabled={!canSubmit}
              onClick={() => category && mutation.mutate(category)}
            >
              {t('moderation:report.submit')}
            </button>
            <button type="button" className="button button--ghost" onClick={onClose}>
              {t('common:actions.cancel')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
