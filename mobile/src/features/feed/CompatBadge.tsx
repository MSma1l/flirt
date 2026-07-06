/** Badge rotund cu procentul de compatibilitate, colorat după prag (TZ 4.2). */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@theme/index';

import { compatColor, compatLabel } from './compat';

interface Props {
  score: number;
}

export function CompatBadge({ score }: Props) {
  const { colors, typography } = useTheme();
  const color = compatColor(score, colors);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${compatLabel(score)}: ${score}%`}
      style={[styles.badge, { backgroundColor: color }]}
    >
      <Text style={[typography.badge, { color: colors.onAccent }]}>{score}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
