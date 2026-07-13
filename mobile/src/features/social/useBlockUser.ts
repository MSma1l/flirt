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
import { Alert } from 'react-native';

import { blockUser } from '@/features/settings/settingsApi';

interface Options {
  /** Apelat după blocarea reușită (ex. ieșirea din conversație). */
  onBlocked?: () => void;
}

interface BlockUserApi {
  /** Cere confirmarea și, la accept, blochează utilizatorul. */
  confirmBlock: (userId: string, name?: string) => void;
  /** Blocarea este în curs (pentru starea de loading a butonului). */
  isBlocking: boolean;
}

export function useBlockUser({ onBlocked }: Options = {}): BlockUserApi {
  const queryClient = useQueryClient();

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
      Alert.alert('Ceva n-a mers', 'Nu am putut bloca utilizatorul. Reîncearcă.');
    },
  });

  const { mutate } = mutation;

  const confirmBlock = useCallback(
    (userId: string, name?: string) => {
      if (!userId) return;
      Alert.alert(
        'Blochează utilizatorul',
        name
          ? `${name} nu te va mai putea contacta și nu va mai apărea în aplicație.`
          : 'Persoana nu te va mai putea contacta și nu va mai apărea în aplicație.',
        [
          { text: 'Anulează', style: 'cancel' },
          {
            text: 'Blochează',
            style: 'destructive',
            onPress: () => mutate(userId),
          },
        ],
      );
    },
    [mutate],
  );

  return { confirmBlock, isBlocking: mutation.isPending };
}
