/** Container de ecran cu SafeArea + fundal din temă. */
import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@theme/index';

export function ScreenContainer({
  children,
  style,
  center,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  center?: boolean;
}) {
  const { colors, spacing } = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View
        style={[
          { flex: 1, padding: spacing.xl },
          center && styles.center,
          style,
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { justifyContent: 'center' },
});
