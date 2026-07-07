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

const styles = StyleSheet.create({
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
  name: { marginTop: 4, maxWidth: 72, textAlign: 'center' },
});
