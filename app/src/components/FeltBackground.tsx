import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, Rect, RadialGradient, Stop } from 'react-native-svg';

import { colors } from '@/lib/theme';

// Full-screen felt: a centered green radial (lighter at the middle) with a dark
// vignette pressed into the edges — the web client's body gradient, ported.
// Renders behind everything as an absolute layer.
export function FeltBackground() {
  const { width, height } = useWindowDimensions();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="felt" cx="50%" cy="38%" rx="75%" ry="70%">
            <Stop offset="0%" stopColor={colors.felt600} />
            <Stop offset="48%" stopColor={colors.felt800} />
            <Stop offset="100%" stopColor={colors.felt950} />
          </RadialGradient>
          <RadialGradient id="vignette" cx="50%" cy="50%" rx="75%" ry="75%">
            <Stop offset="34%" stopColor="#000000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000000" stopOpacity={0.62} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#felt)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#vignette)" />
      </Svg>
    </View>
  );
}
