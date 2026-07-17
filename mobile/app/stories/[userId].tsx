/** Vizualizator full-screen de Stories (TZ secț. 11): bare de progres, tap prev/next, ștergere proprie, răspuns. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StoryMedia } from '@/features/stories/StoryMedia';
import { StoryReplyBar } from '@/features/stories/StoryReplyBar';
import { deleteStory, fetchStories, replyToStory } from '@/features/stories/storiesApi';
import { Story, UserStories } from '@/features/stories/types';
import { useAuthStore } from '@/store/authStore';
import { alertMessage } from '@/utils/dialog';
import { useTheme } from '@theme/index';

/** Durata unei povești (ms) și pasul de progres. */
const STORY_MS = 4000;
const TICK_MS = 50;

/**
 * Cât ține degetul apăsat până povestea intră în pauză (ms).
 *
 * DE CE 250, nu cei 500 impliciți ai RN și nu 150: un tap de navigare durează
 * tipic 60–120 ms, deci 250 ms nu poate fi atins din greșeală de cineva care doar
 * dă mai departe (sub ~200 ms am fi pus pauză la fiecare tap). În sens invers,
 * pragul e „timpul scurs până se prinde pauza": cu 500 ms, dintr-o poveste de
 * 4000 ms se scurg 12,5% până îngheață bara — se vede. Cu 250 ms sunt 6%, sub
 * pragul la care ochiul sesizează saltul.
 */
const HOLD_TO_PAUSE_MS = 250;

/**
 * Motivele pentru care povestea poate sta pe pauză. Pauza NU se vede în UI
 * (cerință explicită): nu există iconiță „⏸", overlay sau text — doar timpul stă.
 */
type PauseReason = 'hold' | 'reply';

export default function StoryViewerScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);
  // Comenzile stau peste o poză care ajunge SUB notch și sub bara gestuală:
  // fără insets, „✕" ar cădea în notch, iar bara de răspuns sub bara de gesturi.
  const insets = useSafeAreaInsets();

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
  const [sent, setSent] = useState(false);

  // O SINGURĂ sursă de adevăr pentru pauză: MULȚIMEA de motive active.
  //
  // Sunt două motive independente („hold" = degetul apăsat, „reply" = userul
  // scrie în bara de răspuns) și ele se suprapun în viața reală: userul tastează,
  // apoi atinge ecranul și ridică degetul. Cu două flag-uri paralele, ridicarea
  // degetului ar reporni povestea PESTE tastatura deschisă. Cu o mulțime de
  // motive, povestea repornește abia când dispare ULTIMUL motiv.
  const [pauseReasons, setPauseReasons] = useState<readonly PauseReason[]>([]);
  const paused = pauseReasons.length > 0;

  const setPauseReason = useCallback((reason: PauseReason, active: boolean) => {
    setPauseReasons((prev) => {
      const has = prev.includes(reason);
      if (has === active) return prev; // nicio schimbare → fără randare inutilă
      return active ? [...prev, reason] : prev.filter((r) => r !== reason);
    });
  }, []);

  const isMine = !!currentUserId && groupUserId === currentUserId;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      router.back();
    },
    onError: () => alertMessage('Ceva n-a mers', 'Nu am putut șterge povestea. Reîncearcă.'),
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => replyToStory(id, body),
    onSuccess: () => {
      // Confirmare discretă în bară — nu întrerupem povestea cu un dialog.
      setSent(true);
      // Răspunsul a plecat ca mesaj în chat → lista de dialoguri e învechită.
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: () =>
      alertMessage('Ceva n-a mers', 'Nu am putut trimite răspunsul. Reîncearcă.'),
  });

  // Progresul e ținut ÎNTR-UN REF, nu doar în state: la reluarea după pauză
  // trebuie să continuăm de unde am rămas, iar efectul care pornește intervalul
  // se re-execută (dependința `paused`) fără să vadă valoarea proaspătă din state.
  const progressRef = useRef(0);

  // Povestea curentă s-a schimbat → progresul o ia de la zero.
  useEffect(() => {
    progressRef.current = 0;
    setProgress(0);
    setSent(false);
  }, [index]);

  // Avans automat cu progres pe povestea curentă.
  //
  // DE CE ținem progresul și într-o variabilă în afara state-ului:
  // înainte, avansul se făcea în interiorul unui updater `setProgress((p) => ...)`,
  // iar acolo se chemau `setIndex(...)` și `router.back()`. Updater-ele de state
  // NU sunt handler-e: React le execută în timpul randării și trebuie să fie pure.
  // Așa, `router.back()` ajungea să actualizeze NavigationContainer în timpul
  // randării ecranului („Cannot update a component while rendering a different
  // component") — de unde randări duble și navigare pierdută. Acum efectele
  // secundare se produc în callback-ul de interval, în afara randării.
  //
  // `paused` (= are cel puțin un motiv activ) oprește intervalul: cât ține degetul
  // apăsat sau cât timp scrie un răspuns. Fără asta, povestea ar avansa (sau
  // ecranul s-ar închide) sub degetele userului, iar mesajul ar pleca la altă
  // poveste. Progresul NU se resetează la pauză — la reluare continuă din
  // `progressRef`, de unde a rămas.
  useEffect(() => {
    if (stories.length === 0 || paused) return;
    const step = TICK_MS / STORY_MS;
    const timer = setInterval(() => {
      const p = progressRef.current + step;
      progressRef.current = p;
      if (p >= 1) {
        clearInterval(timer);
        setProgress(1);
        if (index + 1 < stories.length) setIndex(index + 1);
        else router.back();
        return;
      }
      setProgress(p);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [index, stories.length, router, paused]);

  // Degetul ținut apăsat → pauză; ridicat SAU gest anulat → eliberare.
  const holdOn = useCallback(() => setPauseReason('hold', true), [setPauseReason]);
  const holdOff = useCallback(() => setPauseReason('hold', false), [setPauseReason]);

  const goPrev = () => {
    setIndex(Math.max(0, index - 1));
  };

  // La fel ca mai sus: decidem din `index`-ul curent și chemăm `router.back()`
  // direct din handler, nu dintr-un updater de state.
  const goNext = () => {
    if (index + 1 < stories.length) setIndex(index + 1);
    else router.back();
  };

  const close = () => router.back();

  const current = stories[index];

  return (
    // Rădăcina NU e `SafeAreaView`: aceea adăuga padding sus/jos, iar poza (care
    // umple containerul) rămânea într-un dreptunghi între notch și bara gestuală.
    // Acum poza umple TOT ecranul, iar insets-urile se aplică DOAR comenzilor.
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
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
          {/* Media pe TOT ecranul, pe fundal negru (imagine sau video). */}
          <StoryMedia
            uri={current.mediaUrl}
            mediaType={current.mediaType ?? 'image'}
            style={styles.media}
            hintColor={colors.textSecondary}
          />

          {/* Voaluri sus/jos: peste o poză deschisă, textul alb devine ilizibil.
              Nu sunt culori de temă (nu se schimbă cu light/dark) — sunt umbre
              peste conținutul userului, ca la Instagram. */}
          <View style={[styles.scrimTop, styles.none]} />
          <View style={[styles.scrimBottom, styles.none]} />

          {/* Zone de tap: stânga = anterior, dreapta = următor.
              `pointerEvents` ca prop e depreciat — se dă prin style.

              Apăsarea LUNGĂ pe oricare zonă pune povestea pe pauză (ca la
              Instagram), fără niciun indicator vizual — cerință explicită.
              `onLongPress` + `delayLongPress` ne dau pragul, iar `onPressOut`
              eliberează pauza. Când `onLongPress` s-a declanșat, RN NU mai cheamă
              `onPress` → o apăsare lungă pune pauză și NU navighează, în timp ce
              tap-ul scurt navighează exact ca înainte.

              `onPressOut` e chemat de RN și când gestul e ANULAT (degetul iese din
              zonă / responder-ul e luat de altcineva), nu doar la ridicarea
              degetului — altfel povestea ar rămâne înghețată pentru totdeauna și
              userul ar crede că s-a stricat aplicația. */}
          <View style={[StyleSheet.absoluteFill, styles.boxNone]}>
            <View style={[styles.tapRow, styles.boxNone]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Povestea anterioară"
                testID="story-tap-prev"
                style={styles.tapLeft}
                onPress={goPrev}
                delayLongPress={HOLD_TO_PAUSE_MS}
                onLongPress={holdOn}
                onPressOut={holdOff}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Povestea următoare"
                testID="story-tap-next"
                style={styles.tapRight}
                onPress={goNext}
                delayLongPress={HOLD_TO_PAUSE_MS}
                onLongPress={holdOn}
                onPressOut={holdOff}
              />
            </View>
          </View>

          {/* Comenzile de sus, PESTE zonele de tap (randate după ele) și în
              afara lor: pe web un `<button>` în alt `<button>` e HTML invalid. */}
          <View
            testID="story-top-overlay"
            style={[styles.topOverlay, styles.boxNone, { paddingTop: insets.top }]}
          >
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
              <Text style={[typography.bodyStrong, styles.overlayText]}>{group?.name ?? ''}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Închide"
                onPress={close}
                hitSlop={spacing.md}
              >
                <Text style={[typography.h2, styles.overlayText]}>✕</Text>
              </Pressable>
            </View>
          </View>

          {/* Jos: caption + (povestea mea → ștergere | povestea altcuiva → răspuns).
              `KeyboardAvoidingView` ridică bara peste tastatură. Pe iOS „padding";
              pe Android `adjustResize` face deja treaba, iar „padding" ar dubla
              deplasarea → fără behavior. */}
          <KeyboardAvoidingView
            style={[StyleSheet.absoluteFill, styles.boxNone]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View
              testID="story-bottom-overlay"
              style={[
                styles.bottom,
                styles.boxNone,
                {
                  padding: spacing.lg,
                  paddingBottom: insets.bottom + spacing.lg,
                  gap: spacing.sm,
                },
              ]}
            >
              {current.caption ? (
                <Text style={[typography.body, styles.overlayText]}>{current.caption}</Text>
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
              ) : (
                <StoryReplyBar
                  authorName={group?.name}
                  sending={replyMutation.isPending}
                  sent={sent}
                  onActiveChange={(active) => setPauseReason('reply', active)}
                  onSend={(body) => replyMutation.mutate({ id: current.id, body })}
                />
              )}
            </View>
          </KeyboardAvoidingView>
        </>
      )}
    </View>
  );
}

/** Voaluri peste poză — negru translucid, independent de temă (vezi comentariul). */
const SCRIM = 'rgba(0,0,0,0.45)';

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  media: { ...StyleSheet.absoluteFillObject },
  boxNone: { pointerEvents: 'box-none' },
  none: { pointerEvents: 'none' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 140, backgroundColor: SCRIM },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 220, backgroundColor: SCRIM },
  tapRow: { flex: 1, flexDirection: 'row' },
  tapLeft: { flex: 1 },
  tapRight: { flex: 2 },
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  progressRow: { flexDirection: 'row', paddingTop: 8 },
  progressTrack: { flex: 1, height: 3, overflow: 'hidden' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Text peste poză: mereu alb, peste voal — nu urmează tema (pe fundal alb de
  // temă deschisă ar fi invizibil peste o poză întunecată).
  overlayText: { color: '#FFFFFF' },
  bottom: { marginTop: 'auto', alignItems: 'flex-start' },
  delete: { borderWidth: 1.5, alignSelf: 'flex-start' },
});
