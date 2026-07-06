/** Buton — variante primary / outline / ghost, pill 999, stări pressed/disabled. */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';

import { useTheme } from '@theme/index';

type Variant = 'primary' | 'outline' | 'ghost';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  testID,
}: Props) {
  const { colors, typography, radius } = useTheme();
  const isDisabled = disabled || loading;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => {
        const base: ViewStyle = {
          borderRadius: radius.pill,
          paddingVertical: 15,
          paddingHorizontal: 24,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: variant === 'outline' ? 1.5 : 0,
        };
        if (variant === 'primary') {
          base.backgroundColor = isDisabled
            ? colors.accentDisabled
            : pressed
              ? colors.accentPressed
              : colors.accent;
        } else if (variant === 'outline') {
          base.borderColor = colors.accent;
          base.backgroundColor = pressed ? colors.surfaceHover : 'transparent';
        } else {
          base.backgroundColor = pressed ? colors.surfaceHover : 'transparent';
        }
        return [base, style];
      }}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.accent} />
      ) : (
        <Text
          style={[
            typography.bodyStrong,
            styles.label,
            {
              color:
                variant === 'primary'
                  ? colors.onAccent
                  : isDisabled
                    ? colors.textDisabled
                    : colors.accent,
            },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({ label: { textAlign: 'center' } });
