import { useEffect } from 'react';
import { StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors, fonts, radius } from '@/lib/theme';

// Steady breathing glow on the seat whose turn it is — the RN analog of the web
// client's @keyframes seat-pulse.
export function PulseGlow({
  active,
  children,
  style,
}: {
  active: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const glow = useSharedValue(0);

  useEffect(() => {
    if (active) {
      glow.value = withRepeat(
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      glow.value = withTiming(0, { duration: 200 });
    }
  }, [active, glow]);

  const animStyle = useAnimatedStyle(() => ({
    shadowOpacity: 0.25 + glow.value * 0.6,
    shadowRadius: 6 + glow.value * 16,
    borderColor: glow.value > 0.5 ? colors.goldBright : colors.goldHairline,
    transform: [{ scale: 1 + glow.value * 0.02 }],
  }));

  return (
    <Animated.View
      style={[
        style,
        active && {
          shadowColor: colors.goldBright,
          shadowOffset: { width: 0, height: 0 },
        },
        active && animStyle,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// A card arriving in the trick: drops in from below with a slight settle.
export function TrickCardEntrance({ children }: { children: React.ReactNode }) {
  const y = useSharedValue(40);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1.15);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 160 });
    y.value = withSpring(0, { damping: 14, stiffness: 140 });
    scale.value = withSpring(1, { damping: 14, stiffness: 140 });
  }, [opacity, y, scale]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }, { scale: scale.value }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

// Gold ring + lift on the card that took the trick.
export function WinnerHighlight({
  isWinner,
  children,
}: {
  isWinner: boolean;
  children: React.ReactNode;
}) {
  const lift = useSharedValue(0);

  useEffect(() => {
    lift.value = withTiming(isWinner ? 1 : 0, { duration: 220 });
  }, [isWinner, lift]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -6 * lift.value }, { scale: 1 + 0.05 * lift.value }],
    shadowOpacity: 0.7 * lift.value,
    shadowRadius: 18 * lift.value,
  }));

  return (
    <Animated.View
      style={[
        isWinner && { shadowColor: colors.gold, shadowOffset: { width: 0, height: 0 } },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// "X wins the trick" pill, dropping in over the table.
export function TrickBanner({ name }: { name: string }) {
  const y = useSharedValue(-14);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 180 });
    y.value = withSpring(0, { damping: 13, stiffness: 160 });
  }, [opacity, y]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));

  return (
    <Animated.View style={[styles.banner, style]}>
      <Text style={styles.bannerText}>{name} wins the trick</Text>
    </Animated.View>
  );
}

// Pulsing "your turn" marker.
export function TurnPulse({ children }: { children: React.ReactNode }) {
  const o = useSharedValue(0.55);

  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [o]);

  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

// Modal-style entrance for the bid bar / scoreboard.
export function PanelEntrance({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} style={style}>
      {children}
    </Animated.View>
  );
}

// Dealt card fanning into your hand.
export function DealtCard({ index, children }: { index: number; children: React.ReactNode }) {
  const y = useSharedValue(30);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const delay = Math.min(index * 45, 400);
    opacity.value = withSequence(withTiming(0, { duration: delay }), withTiming(1, { duration: 180 }));
    y.value = withSequence(
      withTiming(30, { duration: delay }),
      withSpring(0, { damping: 15, stiffness: 150 }),
    );
  }, [index, opacity, y]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: colors.gold,
    paddingVertical: 9,
    paddingHorizontal: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.3)',
    zIndex: 10,
  },
  bannerText: {
    color: '#241a06',
    fontFamily: fonts.serif,
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.6,
  },
});
