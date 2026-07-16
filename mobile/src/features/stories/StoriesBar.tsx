/** Bara de Stories (TZ secț. 11): cercuri-avatar orizontale cu inel accent; primul cerc „+" adaugă. */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fetchStories } from './storiesApi';
import { UserStories } from './types';
import { useTheme } from '@theme/index';

/** Prima literă a numelui, majusculă (fallback „?"). */
function initial(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

export function StoriesBar() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();

  const { data } = useQuery<UserStories[]>({
    queryKey: ['stories'],
    queryFn: fetchStories,
  });

  const groups: UserStories[] = data ?? [];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Înălțimea e OBLIGATORIE, nu cosmetică: un ScrollView orizontal fără ea se
      // strânge la conținut pe nativ, dar pe WEB se ÎNTINDE pe toată înălțimea
      // liberă a coloanei — bara mânca ecranul și împingea deck-ul de anchete
      // aproape de marginea de jos. Vezi `styles.bar`.
      style={styles.bar}
      contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.xs }}
    >
      {/* Primul cerc: „+" Adaugă story */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Adaugă story"
        onPress={() => router.push('/stories/new')}
        style={styles.item}
      >
        <View
          style={[
            styles.ring,
            styles.addRing,
            { borderColor: colors.accent, backgroundColor: colors.tagBg },
          ]}
        >
          <Text style={[typography.h1, { color: colors.accent }]}>+</Text>
        </View>
        <Text
          numberOfLines={1}
          style={[typography.caption, styles.name, { color: colors.textSecondary }]}
        >
          Adaugă
        </Text>
      </Pressable>

      {/* Câte un cerc pentru fiecare utilizator cu povești */}
      {groups.map((group) => (
        <Pressable
          key={group.userId}
          accessibilityRole="button"
          accessibilityLabel={`Vezi poveștile: ${group.name}`}
          onPress={() => router.push(`/stories/${group.userId}`)}
          style={styles.item}
        >
          <View style={[styles.ring, { borderColor: colors.accent, backgroundColor: colors.tagBg }]}>
            <Text style={[typography.h2, { color: colors.textPrimary }]}>
              {initial(group.name)}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={[typography.caption, styles.name, { color: colors.textSecondary }]}
          >
            {group.name}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const RING_SIZE = 64;
/** Distanța dintre inel și numele de sub el (vezi `styles.name`). */
const NAME_GAP = 4;
/** `typography.caption.lineHeight` — numele de sub inel e un singur rând. */
const NAME_LINE_HEIGHT = 18;
/** Înălțimea totală a barei: inel + spațiu + un rând de nume. */
const BAR_HEIGHT = RING_SIZE + NAME_GAP + NAME_LINE_HEIGHT;

const styles = StyleSheet.create({
  // `height` oprește întinderea pe web; `flexGrow: 0` o oprește și dacă un
  // părinte viitor ar încerca să distribuie spațiu peste rândul ăsta.
  bar: { height: BAR_HEIGHT, flexGrow: 0, flexShrink: 0 },
  item: { alignItems: 'center', width: 72 },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRing: { borderStyle: 'dashed' },
  name: { marginTop: NAME_GAP, maxWidth: 72, textAlign: 'center' },
});
