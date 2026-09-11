/**
 * Blocarea unui utilizator din orice ecran (card de profil, conversație).
 *
 * Cerință App Store Guideline 1.2 (User-Generated Content): utilizatorul
 * trebuie să poată bloca pe oricine, direct din aplicație. Hook-ul centralizează
 * confirmarea, apelul la backend și invalidarea cache-ului React Query, ca
 * persoana blocată să dispară imediat din feed și din lista de dialoguri.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { blockUser } from '@/features/settings/settingsApi';
import { alertMessage, confirmAsync } from '@/utils/dialog';

interface Options {
  /** Apelat după blocarea reușită (ex. ieșirea din conversație). */
  onBlocked?: () => void;
}

interface BlockUserApi {
  /** Cere confirmarea și, la accept, blochează utilizatorul. */
  confirmBlock: (userId: string, name?: string) => Promise<void>;
  /** Blocarea este în curs (pentru starea de loading a butonului). */
  isBlocking: boolean;
}

export function useBlockUser({ onBlocked }: Options = {}): BlockUserApi {
  const queryClient = useQueryClient();
  const { t } = useTranslation('moderation');

  const mutation = useMutation({
    mutationFn: (userId: string) => blockUser(userId),
    onSuccess: () => {
      // Feed, dialoguri și lista de blocări se resincronizează cu serverul.
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      onBlocked?.();
    },
    onError: () => {
      alertMessage(t('block.errorTitle'), t('block.errorBody'));
    },
  });

  const { mutate } = mutation;

  const confirmBlock = useCallback(
    async (userId: string, name?: string) => {
      if (!userId) return;
      const ok = await confirmAsync(
        t('block.title'),
        name ? t('block.bodyNamed', { name }) : t('block.body'),
        { confirmText: t('block.confirm'), destructive: true },
      );
      if (ok) {
        mutate(userId);
      }
    },
    [mutate, t],
  );

  return { confirmBlock, isBlocking: mutation.isPending };
}
