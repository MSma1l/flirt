/** Vizualizator full-screen de Stories (TZ secț. 11): bare de progres, tap prev/next, ștergere proprie. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StoryMedia } from '@/features/stories/StoryMedia';
import { deleteStory, fetchStories } from '@/features/stories/storiesApi';
import { Story, UserStories } from '@/features/stories/types';
import { useAuthStore } from '@/store/authStore';
import { alertMessage } from '@/utils/dialog';
import { useTheme } from '@theme/index';

/** Durata unei povești (ms) și pasul de progres. */
const STORY_MS = 4000;
const TICK_MS = 50;

export default function StoryViewerScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const { userId } = useLocalSearchParams<{ userId: string }>();
  const groupUserId = Array.isArray(userId) ? userId[0] : userId;

  // Preferăm cache-ul din bara de stories; dacă lipsește, refetch.
  const cached = queryClient.getQueryData<UserStories[]>(['stories']);
  const { data, isLoading, isError, refetch } = useQuery<UserStories[]>({
    queryKey: ['stories'],
    queryFn: fetchStories,
    initialData: cached,
  });

  const groups: UserStories[] = data ?? [];
  const group = groups.find((g) => g.userId === groupUserId);
  const stories = group?.stories ?? [];

  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  const isMine = !!currentUserId && groupUserId === currentUserId;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      router.back();
    },
    onError: () => alertMessage('Ceva n-a mers', 'Nu am putut șterge povestea. Reîncearcă.'),
  });

  // Avans automat cu progres pe povestea curentă.
  useEffect(() => {
    if (stories.length === 0) return;
    setProgress(0);
    const step = TICK_MS / STORY_MS;
    const timer = setInterval(() => {
      setProgress((p) => {
        const next = p + step;
        if (next >= 1) {
          clearInterval(timer);
          setIndex((i) => {
            if (i + 1 < stories.length) return i + 1;
            router.back();
            return i;
          });
          return 1;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [index, stories.length, router]);

  const goPrev = () => {
    setIndex((i) => Math.max(0, i - 1));
  };

  const goNext = () => {
    setIndex((i) => {
      if (i + 1 < stories.length) return i + 1;
      router.back();
      return i;
    });
  };

  const close = () => router.back();

  const current = stories[index];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Încărcare și eroare ÎNAINTEA ramurii de gol: altfel, cât timp
          `fetchStories` e în zbor (sau dacă pică), `data` e `undefined` și
          userul vedea „Nu există povești" în loc de spinner/eroare. */}
      {isLoading ? (
        <View style={styles.center} testID="stories-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text style={[typography.body, styles.centerText, { color: colors.danger }]}>
            Nu am putut încărca poveștile.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reîncearcă"
            onPress={() => refetch()}
            hitSlop={spacing.sm}
            style={{ marginTop: spacing.lg }}
          >
            <Text style={[typography.bodyStrong, { color: colors.accent }]}>Reîncearcă</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Închide"
            onPress={close}
            hitSlop={spacing.sm}
            style={{ marginTop: spacing.md }}
          >
            <Text style={[typography.body, { color: colors.textSecondary }]}>Închide</Text>
          </Pressable>
        </View>
      ) : !current ? (
        <View style={styles.center}>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Nu există povești de afișat.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Închide"
            onPress={close}
            hitSlop={spacing.sm}
            style={{ marginTop: spacing.lg }}
          >
            <Text style={[typography.bodyStrong, { color: colors.accent }]}>Închide</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Media pe fundal întunecat (imagine sau video, după media_type) */}
          <StoryMedia
            uri={current.mediaUrl}
            mediaType={current.mediaType ?? 'image'}
            style={styles.media}
            hintColor={colors.textSecondary}
          />

          {/* Zone de tap: stânga = anterior, dreapta = următor */}
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View style={styles.tapRow} pointerEvents="box-none">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Povestea anterioară"
                style={styles.tapLeft}
                onPress={goPrev}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Povestea următoare"
                style={styles.tapRight}
                onPress={goNext}
              />
            </View>
          </View>

          {/* Bare de progres sus */}
          <View style={[styles.progressRow, { paddingHorizontal: spacing.md, gap: spacing.xs }]}>
            {stories.map((s: Story, i: number) => {
              const fill = i < index ? 1 : i === index ? progress : 0;
              return (
                <View
                  key={s.id}
                  style={[styles.progressTrack, { backgroundColor: colors.border, borderRadius: radius.pill }]}
                >
                  <View
                    style={{
                      width: `${Math.round(fill * 100)}%`,
                      height: '100%',
                      backgroundColor: colors.accent,
                      borderRadius: radius.pill,
                    }}
                  />
                </View>
              );
            })}
          </View>

          {/* Antet: nume + închide */}
          <View style={[styles.topBar, { paddingHorizontal: spacing.lg, marginTop: spacing.sm }]}>
            <Text style={[typography.bodyStrong, { color: colors.textPrimary }]}>
              {group?.name ?? ''}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Închide"
              onPress={close}
              hitSlop={spacing.sm}
            >
              <Text style={[typography.h2, { color: colors.textPrimary }]}>✕</Text>
            </Pressable>
          </View>

          {/* Caption jos + ștergere pentru poveștile proprii */}
          <View style={[styles.bottom, { padding: spacing.lg, gap: spacing.sm }]} pointerEvents="box-none">
            {current.caption ? (
              <Text style={[typography.body, { color: colors.textPrimary }]}>{current.caption}</Text>
            ) : null}

            {isMine ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Șterge povestea"
                onPress={() => deleteMutation.mutate(current.id)}
                disabled={deleteMutation.isPending}
                style={[
                  styles.delete,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.danger,
                    borderRadius: radius.pill,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.sm,
                  },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: colors.danger }]}>Șterge</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  media: { ...StyleSheet.absoluteFillObject },
  tapRow: { flex: 1, flexDirection: 'row' },
  tapLeft: { flex: 1 },
  tapRight: { flex: 2 },
  progressRow: { flexDirection: 'row', paddingTop: 8 },
  progressTrack: { flex: 1, height: 3, overflow: 'hidden' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bottom: { marginTop: 'auto', alignItems: 'flex-start' },
  delete: { borderWidth: 1.5, alignSelf: 'flex-start' },
});
