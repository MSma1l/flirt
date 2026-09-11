/**
 * Confirmarea blocării unui utilizator din conversație.
 *
 * PORT DOM al lui `mobile/src/features/social/useBlockUser.tsx`: aceeași cerere
 * (`blockUser` REUTILIZAT din `@mobile/features/settings/settingsApi` →
 * `POST /social/blocks`, confirmat în `backend/app/api/v1/social.py`) și
 * aceleași texte (`moderation:block.*`).
 *
 * Confirmarea e un dialog propriu, NU `confirm()`: dialogurile native blochează
 * WebView-ul Telegram.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { blockUser } from '@mobile/features/settings/settingsApi';

interface Props {
  targetUserId: string;
  targetName?: string;
  onClose: () => void;
  /** Apelat după blocarea reușită (ieșirea din conversație). */
  onBlocked: () => void;
}

export function BlockDialog({ targetUserId, targetName, onClose, onBlocked }: Props) {
  const { t } = useTranslation(['moderation', 'common']);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => blockUser(targetUserId),
    onSuccess: () => {
      // Feed, dialoguri și lista de blocări se resincronizează cu serverul.
      void queryClient.invalidateQueries({ queryKey: ['blocks'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      onBlocked();
    },
  });

  return (
    <div className="chat-dialog__backdrop" role="presentation">
      <div
        className="chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('moderation:block.title')}
      >
        <h2 className="title">{t('moderation:block.title')}</h2>
        <p className="body-text">
          {targetName
            ? t('moderation:block.bodyNamed', { name: targetName })
            : t('moderation:block.body')}
        </p>

        {mutation.isError ? (
          <p className="error-text" data-testid="block-error">
            {t('moderation:block.errorBody')}
          </p>
        ) : null}

        <button
          type="button"
          className="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {t('moderation:block.confirm')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('common:actions.cancel')}
        </button>
      </div>
    </div>
  );
}
