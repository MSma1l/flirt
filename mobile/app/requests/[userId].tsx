/**
 * Detaliul unei cereri de comunicare — „Ți-au dat like" (din ecranul Mesaje).
 *
 * Cineva ți-a dat like (cu sau fără mesaj). Aici îi vezi ancheta completă (poze,
 * nume, vârstă, despre, interese, oraș), citești mesajul lui (dacă există) și
 * răspunzi:
 *   - „Trimite" → `swipe(userId, 'like', message)` → backendul creează match +
 *     livrează ambele mesaje în chat → navigăm în conversație (`/chat/{id}`).
 *   - „Trece"   → `swipe(userId, 'dislike')` → cererea dispare din listă.
 *
 * Datele profilului nu se transmit prin parametri de navigare (serializare
 * fragilă): ecranul reia lista `['social','received']` din cache-ul React Query
 * (populat de secțiune) și găsește persoana după `userId`; dacă lipsește
 * (deep-link direct), query-ul o aduce singur.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, Button, Input } from '@/components/ui';
import { swipe } from '@/features/feed/feedApi';
import { fetchReceivedLikesPage, ReceivedLikeItem } from '@/features/social/receivedApi';
import type { Page } from '@/features/social/socialApi';
import { firstError, LIMITS, maxLen, noHtml, required } from '@/utils/validation';
import { useTheme } from '@theme/index';

export default function RequestDetailScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation('chat');

  const { userId } = useLocalSearchParams<{ userId: string }>();
  const targetUserId = Array.isArray(userId) ? userId[0] : userId;

  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Aceeași cheie ca secțiunea: împărțim cache-ul, deci de regulă datele sunt
  // deja aici. Dacă nu (deep-link), query-ul le aduce.
  const { data, isLoading, isError, refetch } = useInfiniteQuery({
    queryKey: ['social', 'received'],
    queryFn: ({ pageParam }) => fetchReceivedLikesPage({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Page<ReceivedLikeItem>) => last.nextCursor,
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const item = items.find((i) => i.userId === targetUserId);

  // Răspuns = like cu mesaj. Ei ți-au dat deja like, deci swipe-ul creează match
  // și livrează ambele mesaje în chat.
  const replyMutation = useMutation({
    mutationFn: (message: string) => swipe(targetUserId, 'like', message),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['social', 'received'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      if (result.matched && result.chatId) {
        router.replace(`/chat/${result.chatId}`);
      } else {
        // Fără chat_id (caz-limită): măcar ieșim din ecran, lista e deja invalidată.
        router.back();
      }
    },
    onError: () => setSendError(t('received.sendError')),
  });

  // „Trece" = dislike. Cererea dispare din listă la invalidare.
  const passMutation = useMutation({
    mutationFn: () => swipe(targetUserId, 'dislike'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social', 'received'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      router.back();
    },
    onError: () => setSendError(t('received.passError')),
  });

  const busy = replyMutation.isPending || passMutation.isPending;
  const trimmed = draft.trim();
  // Validare simetrică cu chat-ul: non-gol, fără HTML (anti-XSS), lungime plafonată.
  const validationError = firstError(
    required(draft),
    noHtml(draft),
    maxLen(draft, LIMITS.message),
  );
  const canSend = !busy && trimmed.length > 0 && validationError === null;

  const onSend = () => {
    setTouched(true);
    setSendError(null);
    if (!canSend) return;
    replyMutation.mutate(trimmed);
  };

  const header = (
    <View style={styles.header}>
      <BackButton testID="request-back" />
      <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('received.detailTitle')}</Text>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.pad, { padding: spacing.xl }]}>{header}</View>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} testID="request-loading" />
        </View>
      </SafeAreaView>
    );
  }

  // Eroare de încărcare cu lista goală SAU cererea nu mai există (a fost tratată
  // din alt loc). În ambele cazuri nu avem ce afișa — explicăm și oferim retry/înapoi.
  if ((isError && data === undefined) || !item) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.pad, { padding: spacing.xl }]}>{header}</View>
        <View style={[styles.center, { padding: spacing.xl, gap: spacing.md }]}>
          <Text
            testID="request-missing"
            style={[typography.body, styles.centerText, { color: colors.textSecondary }]}
          >
            {isError && data === undefined ? t('received.loadError') : t('received.notFound')}
          </Text>
          {isError && data === undefined ? (
            <Button label={t('retry')} variant="outline" onPress={() => refetch()} />
          ) : (
            <Button label={t('received.back')} variant="outline" onPress={() => router.back()} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const { profile } = item;
  const photo = profile.photos[0];
  const initial = profile.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.pad, { padding: spacing.xl, paddingBottom: 0 }]}>{header}</View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.md, gap: spacing.md }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Poză mare sau placeholder cu inițiala. */}
          <View style={[styles.photoWrap, { borderRadius: radius.card, backgroundColor: colors.tagBg }]}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={[typography.display, { color: colors.accent }]}>{initial}</Text>
              </View>
            )}
            {item.isSuper ? (
              <View
                testID="request-super"
                style={[styles.superBadge, { backgroundColor: colors.surface, borderRadius: radius.pill }]}
              >
                <Text style={[typography.badge, { color: colors.accent }]}>
                  {t('received.super')}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={[typography.h1, { color: colors.textPrimary }]}>
            {profile.name}, {profile.age}
          </Text>
          {profile.city ? (
            <Text style={[typography.caption, { color: colors.textSecondary }]}>{profile.city}</Text>
          ) : null}

          {/* Mesajul lor — vizibil pentru tine încă înainte de match. */}
          {item.message ? (
            <View
              testID="request-their-message"
              style={[
                styles.messageCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.card,
                  padding: spacing.lg,
                  gap: spacing.xs,
                },
              ]}
            >
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {t('received.theirMessage')}
              </Text>
              <Text style={[typography.body, { color: colors.textPrimary }]}>{item.message}</Text>
            </View>
          ) : (
            <Text
              testID="request-no-message"
              style={[typography.caption, { color: colors.textSecondary }]}
            >
              {t('received.noMessage')}
            </Text>
          )}

          {profile.about ? (
            <Text style={[typography.body, { color: colors.textPrimary }]}>{profile.about}</Text>
          ) : null}

          {profile.topInterests.length > 0 ? (
            <View style={styles.chips}>
              {profile.topInterests.map((interest) => (
                <View
                  key={interest}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: colors.tagBg,
                      borderRadius: radius.pill,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs,
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.link }]}>{interest}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>

        {/* Zona de acțiune, lipită jos: câmp de răspuns + „Trimite" + „Trece". */}
        <View
          style={[
            styles.actions,
            { borderTopColor: colors.border, padding: spacing.xl, gap: spacing.sm },
          ]}
        >
          <Input
            testID="request-reply-input"
            placeholder={t('received.replyPlaceholder')}
            value={draft}
            onChangeText={(v) => {
              setDraft(v);
              if (sendError) setSendError(null);
            }}
            error={touched ? validationError : null}
            multiline
            editable={!busy}
          />
          {sendError ? (
            <Text testID="request-send-error" style={[typography.caption, { color: colors.danger }]}>
              {sendError}
            </Text>
          ) : null}
          <Button
            label={t('received.reply')}
            testID="request-reply-send"
            disabled={!canSend}
            loading={replyMutation.isPending}
            onPress={onSend}
          />
          <Button
            label={t('received.pass')}
            variant="ghost"
            testID="request-pass"
            disabled={busy}
            loading={passMutation.isPending}
            onPress={() => {
              setSendError(null);
              passMutation.mutate();
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  pad: {},
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  photoWrap: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photo: { ...StyleSheet.absoluteFillObject },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  superBadge: { position: 'absolute', top: 12, right: 12, paddingHorizontal: 10, paddingVertical: 4 },
  messageCard: { borderWidth: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { alignSelf: 'flex-start' },
  actions: { borderTopWidth: 1 },
});
