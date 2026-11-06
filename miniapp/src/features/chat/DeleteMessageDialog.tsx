/**
 * Confirmarea ștergerii unui mesaj propriu („pentru amândoi").
 *
 * Același tipar ca `BlockDialog`: dialog propriu, NU `confirm()` — dialogurile
 * native blochează WebView-ul Telegram. Cererea: `DELETE
 * /chats/{chat_id}/messages/{message_id}` → forma „ștearsă" a mesajului, pe care
 * ecranul o aplică imediat în fir (fără să aștepte următorul poll).
 */
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { deleteMessage, type ChatMessageEx } from './chatApi';

interface Props {
  chatId: string;
  messageId: string;
  onClose: () => void;
  /** Apelat cu mesajul în forma „ștearsă" întoarsă de server. */
  onDeleted: (message: ChatMessageEx) => void;
}

export function DeleteMessageDialog({ chatId, messageId, onClose, onDeleted }: Props) {
  const { t } = useTranslation(['screens']);

  const mutation = useMutation({
    mutationFn: () => deleteMessage(chatId, messageId),
    onSuccess: (deleted) => onDeleted(deleted),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="chat-dialog__backdrop" role="presentation">
      <div
        className="chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('screens:chat.deleteDialog.title')}
        data-testid="delete-message-dialog"
      >
        <h2 className="title">{t('screens:chat.deleteDialog.title')}</h2>
        <p className="body-text">{t('screens:chat.deleteDialog.body')}</p>

        {mutation.isError ? (
          <p className="error-text" role="alert" data-testid="delete-message-error">
            {t('screens:chat.deleteDialog.error')}
          </p>
        ) : null}

        <button
          type="button"
          className="button button--danger"
          data-testid="delete-message-confirm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {t('screens:chat.deleteDialog.confirm')}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          {t('screens:chat.deleteDialog.cancel')}
        </button>
      </div>
    </div>
  );
}
