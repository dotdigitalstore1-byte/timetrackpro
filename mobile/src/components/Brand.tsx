import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors } from '../theme';

/** The Dotinout mark, drawn the same way as on the website: a gradient tile, a ring with a gap at the top, and dots. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Defs>
        <LinearGradient id="dotinoutMark" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colors.indigo600} />
          <Stop offset="1" stopColor={colors.violet600} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="48" height="48" rx="11" fill="url(#dotinoutMark)" />
      <G transform="translate(5.28 5.28) scale(0.78)">
        <Path d="M30 13.61 A12 12 0 1 1 18 13.61" fill="none" stroke="#FFFFFF" strokeWidth={3.4} />
        <Circle cx="24" cy="24" r={4.6} fill="#FFFFFF" />
        <Circle cx="24" cy="12" r={2.6} fill="#FFFFFF" />
      </G>
    </Svg>
  );
}

/** Mark plus the "Dotinout" wordmark, with "in" and "out" coloured as on the website. */
export function BrandLockup({ size = 36, light = false }: { size?: number; light?: boolean }) {
  return (
    <View style={styles.row}>
      <BrandMark size={size} />
      <Text style={[styles.word, { fontSize: size * 0.5, marginLeft: size * 0.3, color: light ? '#FFFFFF' : colors.slate900 }]}>
        Dot
        <Text style={{ color: light ? colors.indigo200 : colors.indigo600 }}>in</Text>
        <Text style={{ color: light ? colors.violet200 : colors.violet600 }}>out</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  word: { fontWeight: '800', letterSpacing: -0.5 },
});
