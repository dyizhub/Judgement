import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import type { Card as CardType } from '@/lib/protocol';
import { rankLabel, SUIT_IS_RED, SUIT_SYMBOL } from '@/lib/protocol';
import { colors } from '@/lib/theme';

interface Props {
  card: CardType;
  onPress?: () => void;
  disabled?: boolean; // dimmed + not pressable (illegal play)
  width?: number;
  isTrump?: boolean;
  style?: ViewStyle;
}

const DEFAULT_W = 62;
const RATIO = 7 / 5;

export function Card({ card, onPress, disabled, width = DEFAULT_W, isTrump, style }: Props) {
  const red = SUIT_IS_RED[card.suit];
  const h = width * RATIO;
  const inner = (
    <View
      style={[
        styles.card,
        { width, height: h },
        isTrump && styles.trump,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.rank, { color: red ? colors.suitRed : colors.ink }]}>{rankLabel(card.rank)}</Text>
      <Text style={[styles.suit, { color: red ? colors.suitRed : colors.ink, fontSize: width * 0.42 }]}>
        {SUIT_SYMBOL[card.suit]}
      </Text>
      {isTrump && <Text style={styles.trumpMark}>◆</Text>}
    </View>
  );

  if (onPress && !disabled) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(60,50,30,0.15)',
  },
  rank: {
    position: 'absolute',
    top: 4,
    left: 6,
    fontSize: 14,
    fontWeight: '700',
  },
  suit: { lineHeight: undefined },
  trump: {
    borderColor: colors.gold,
    borderWidth: 2,
  },
  trumpMark: {
    position: 'absolute',
    top: 20,
    left: 5,
    fontSize: 10,
    color: colors.gold,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8, transform: [{ translateY: -6 }] },
});
