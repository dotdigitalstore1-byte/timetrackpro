import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandLockup } from '../components/Brand';
import { ErrorBox, Field, PrimaryButton } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { API_ORIGIN } from '../config';
import { colors } from '../theme';

const REGISTRATION_URL = 'https://dotinout.com';

/** Employee sign-in: gradient background, brand, a white card, and the same links as the website's mobile sign-in. */
export function LoginScreen() {
  const { signIn } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !busy && identifier.trim().length > 0 && password.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const message = await signIn(identifier, password);
    // On success the navigator switches to the app and this screen unmounts, so the busy state is only reset on failure.
    if (message) {
      setError(message);
      setBusy(false);
    }
  };

  const open = (url: string) => {
    Linking.openURL(url).catch(() => undefined);
  };

  return (
    <LinearGradient colors={[colors.indigo700, colors.indigo600, colors.indigo800]} style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
            <BrandLockup size={56} light />
            <Text style={styles.subtitle}>Employee sign in</Text>

            <View style={styles.card}>
              <Field
                label="Username"
                value={identifier}
                onChangeText={setIdentifier}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="username"
                returnKeyType="next"
                editable={!busy}
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={submit}
                editable={!busy}
              />
              {error ? <ErrorBox message={error} /> : null}
              <View style={styles.buttonSpace}>
                <PrimaryButton label={busy ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={!canSubmit} />
              </View>
              <Text style={styles.help}>Forgot your password? Contact your company admin to reset it.</Text>
            </View>

            <Pressable onPress={() => open(REGISTRATION_URL)} accessibilityRole="link">
              <Text style={styles.link}>New company? Register your business</Text>
            </Pressable>
            <Pressable onPress={() => open(`${API_ORIGIN}/privacy`)} accessibilityRole="link">
              <Text style={styles.smallLink}>Privacy Policy</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  subtitle: { color: colors.indigo100, fontSize: 14, textAlign: 'center', marginTop: 12, marginBottom: 28 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.slate200,
  },
  buttonSpace: { marginTop: 6 },
  help: { textAlign: 'center', color: colors.slate600, fontSize: 13, marginTop: 16 },
  link: { color: colors.indigo100, textAlign: 'center', marginTop: 28, textDecorationLine: 'underline', fontSize: 14 },
  smallLink: { color: colors.indigo200, textAlign: 'center', marginTop: 14, textDecorationLine: 'underline', fontSize: 12 },
});
