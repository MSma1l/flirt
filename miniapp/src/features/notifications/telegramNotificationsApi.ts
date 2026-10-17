/**
 * Preferințele notificărilor trimise de bot în Telegram.
 *
 *   GET /notifications/telegram  → { messages, likes, stories, matches }
 *   PUT /notifications/telegram  ← corp PARȚIAL → obiectul complet
 *
 * Sunt separate de `notifications` din `/settings/` (acelea sunt push-urile
 * aplicației native). Un server vechi nu cunoaște ruta și răspunde 404 —
 * atunci secțiunea din Setări pur și simplu nu apare (`isNotSupported`).
 */
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';

export const TELEGRAM_NOTIFICATIONS_KEY = ['notifications', 'telegram'] as const;

export const TELEGRAM_NOTIFICATION_KINDS = ['messages', 'likes', 'stories', 'matches'] as const;
export type TelegramNotificationKind = (typeof TELEGRAM_NOTIFICATION_KINDS)[number];

export type TelegramNotifications = Record<TelegramNotificationKind, boolean>;

/**
 * Normalizează răspunsul: orice câmp lipsă sau ne-boolean devine `true` —
 * implicitul de pe server pentru un cont nou e „toate pornite".
 */
function mapResponse(data: unknown): TelegramNotifications {
  const raw = (data ?? {}) as Partial<Record<TelegramNotificationKind, unknown>>;
  return {
    messages: raw.messages !== false,
    likes: raw.likes !== false,
    stories: raw.stories !== false,
    matches: raw.matches !== false,
  };
}

export async function fetchTelegramNotifications(): Promise<TelegramNotifications> {
  const { data } = await api.get<unknown>('/notifications/telegram');
  return mapResponse(data);
}

export async function updateTelegramNotifications(
  patch: Partial<TelegramNotifications>,
): Promise<TelegramNotifications> {
  const { data } = await api.put<unknown>('/notifications/telegram', patch);
  return mapResponse(data);
}

/** Serverul nu are ruta (versiune veche) → secțiunea se ascunde. */
export function isNotSupported(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

export function useTelegramNotifications() {
  return useQuery<TelegramNotifications>({
    queryKey: TELEGRAM_NOTIFICATIONS_KEY,
    queryFn: fetchTelegramNotifications,
    // 404 = ruta lipsește; o reîncercare n-o face să apară.
    retry: (count, error) => !isNotSupported(error) && count < 1,
  });
}

/**
 * Mutația OPTIMISTĂ: comutatorul se mută imediat, iar dacă serverul refuză,
 * revine la valoarea de dinainte. După succes scriem obiectul CONFIRMAT de
 * server (poate diferi de ce am cerut).
 */
export function useUpdateTelegramNotifications() {
  const queryClient = useQueryClient();
  return useMutation<
    TelegramNotifications,
    unknown,
    Partial<TelegramNotifications>,
    { previous: TelegramNotifications | undefined }
  >({
    mutationFn: updateTelegramNotifications,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: TELEGRAM_NOTIFICATIONS_KEY });
      const previous = queryClient.getQueryData<TelegramNotifications>(TELEGRAM_NOTIFICATIONS_KEY);
      if (previous) {
        queryClient.setQueryData<TelegramNotifications>(TELEGRAM_NOTIFICATIONS_KEY, {
          ...previous,
          ...patch,
        });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(TELEGRAM_NOTIFICATIONS_KEY, context.previous);
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData(TELEGRAM_NOTIFICATIONS_KEY, result);
    },
  });
}
