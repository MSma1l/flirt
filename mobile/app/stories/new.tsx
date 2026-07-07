/** Publicare story nou (TZ secț. 11): URL media + caption opțional. Uploadul de fișiere vine curând. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Input, ScreenContainer } from '@/components/ui';
import { createStory } from '@/features/stories/storiesApi';
import { useTheme } from '@theme/index';

export default function NewStoryScreen() {
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [mediaUrl, setMediaUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => createStory(mediaUrl.trim(), caption.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      router.back();
    },
    onError: () => setError('Nu am putut publica povestea. Încearcă din nou.'),
  });

  const submit = () => {
    if (!mediaUrl.trim()) {
      setError('Adaugă un URL de media.');
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Story nou</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Închide"
          onPress={() => router.back()}
          hitSlop={spacing.sm}
        >
          <Text style={[typography.h2, { color: colors.textPrimary }]}>✕</Text>
        </Pressable>
      </View>

      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.lg }]}>
        Uploadul de fișiere vine curând — momentan prin URL.
      </Text>

      <View style={{ gap: spacing.lg }}>
        <Input
          label="URL media"
          placeholder="https://…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={mediaUrl}
          onChangeText={setMediaUrl}
          error={error}
          testID="story-media-url"
        />

        <Input
          label="Descriere (opțional)"
          placeholder="Adaugă un text…"
          value={caption}
          onChangeText={setCaption}
          testID="story-caption"
        />

        <Button
          label="Publică"
          loading={mutation.isPending}
          onPress={submit}
          testID="story-submit"
          style={{ marginTop: spacing.sm }}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
