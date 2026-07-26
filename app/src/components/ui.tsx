// Shared felt/gold primitives used across Home and Lobby, matching the web
// client's .panel / .btn / input styling.

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import { colors, fonts, radius } from '@/lib/theme';

export function Panel({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.panel, style]}>
      <View style={styles.panelInnerFrame} />
      {children}
    </View>
  );
}

export function GameTitle({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.titleWrap}>
      <Text style={styles.titleSuits}>♠ ♥ ♦ ♣</Text>
      <Text style={styles.title}>{children}</Text>
      <View style={styles.titleRule} />
    </View>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({ label, onPress, variant = 'primary', disabled, loading, style }: ButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        isPrimary ? styles.btnPrimary : styles.btnSecondary,
        (disabled || loading) && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#241a06' : colors.goldBright} />
      ) : (
        <Text style={[styles.btnLabel, isPrimary ? styles.btnLabelPrimary : styles.btnLabelSecondary]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor="rgba(241, 234, 217, 0.35)"
      style={styles.field}
      {...props}
    />
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  return <Text style={styles.errorText}>{children ?? ' '}</Text>;
}

const styles = StyleSheet.create({
  panel: {
    width: '100%',
    backgroundColor: colors.panelBot,
    borderWidth: 1,
    borderColor: colors.goldHairline,
    borderRadius: radius.lg,
    padding: 32,
  },
  panelInnerFrame: {
    position: 'absolute',
    top: 7,
    left: 7,
    right: 7,
    bottom: 7,
    borderWidth: 1,
    borderColor: colors.goldHairlineSoft,
    borderRadius: radius.lg - 6,
    pointerEvents: 'none',
  },
  titleWrap: {
    alignItems: 'center',
    marginBottom: 22,
  },
  titleSuits: {
    color: colors.gold,
    fontSize: 12,
    letterSpacing: 8,
    marginBottom: 10,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 44,
    fontWeight: '700',
    color: colors.goldBright,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  titleRule: {
    height: 1,
    width: '72%',
    backgroundColor: colors.gold,
    marginTop: 12,
    opacity: 0.7,
  },
  btn: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: colors.gold,
    borderColor: 'rgba(0,0,0,0.35)',
  },
  btnSecondary: {
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderColor: colors.goldHairline,
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnLabel: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  btnLabelPrimary: {
    color: '#241a06',
  },
  btnLabelSecondary: {
    color: colors.goldBright,
  },
  field: {
    width: '100%',
    paddingVertical: 13,
    paddingHorizontal: 15,
    fontSize: 16,
    color: colors.cream,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderWidth: 1,
    borderColor: colors.goldHairline,
    borderRadius: radius.md,
  },
  errorText: {
    minHeight: 18,
    marginTop: 12,
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
});
