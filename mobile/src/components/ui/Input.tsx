/** Câmp de intrare cu label + eroare, stilat din temă. */
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { useTheme } from '@theme/index';

interface Props extends TextInputProps {
  label?: string;
  error?: string | null;
}

/**
 * Tipurile evenimentelor de focus le derivăm din `TextInputProps`, nu le scriem manual:
 * React Native le-a redenumit (`NativeSyntheticEvent<TextInputFocusEventData>` → `FocusEvent`/`BlurEvent`)
 * și derivarea rămâne corectă indiferent de versiune.
 */
type FocusHandler = NonNullable<TextInputProps['onFocus']>;
type BlurHandler = NonNullable<TextInputProps['onBlur']>;

export function Input({ label, error, style, onFocus, onBlur, ...rest }: Props) {
  const { colors, typography, radius, spacing } = useTheme();
  const [focused, setFocused] = useState(false);

  const handleFocus: FocusHandler = (e) => {
    setFocused(true);
    onFocus?.(e);
  };
  const handleBlur: BlurHandler = (e) => {
    setFocused(false);
    onBlur?.(e);
  };

  // Eroarea are prioritate; apoi focusul (accent); altfel border neutru.
  const borderColor = error
    ? colors.danger
    : focused
      ? colors.accent
      : colors.border;

  return (
    <View style={{ gap: spacing.xs, width: '100%' }}>
      {label ? (
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textDisabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={[
          typography.body,
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor,
            borderWidth: focused && !error ? 1.5 : 1,
            borderRadius: radius.md,
            color: colors.textPrimary,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
});
