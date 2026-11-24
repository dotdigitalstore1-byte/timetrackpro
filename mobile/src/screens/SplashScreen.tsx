import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { BrandLockup } from '../components/Brand';
import { colors } from '../theme';

/** Shown only while the saved session is checked. There is no spinner: the brand is the whole screen. */
export function SplashScreen() {
  return (
    <LinearGradient colors={[colors.indigo700, colors.indigo600, colors.indigo800]} style={styles.fill}>
      <View style={styles.center}>
        <BrandLockup size={56} light />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
