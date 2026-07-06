/** Indicator de progres (puncte) — pași anketă / poze profil. */
import React from 'react';
import { View } from 'react-native';

import { useTheme } from '@theme/index';

export function ProgressDots({ total, current }: { total: number; current: number }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.xs, justifyContent: 'center' }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i === current ? 22 : 8,
            height: 8,
            borderRadius: 999,
            backgroundColor: i <= current ? colors.accent : colors.border,
          }}
        />
      ))}
    </View>
  );
}
