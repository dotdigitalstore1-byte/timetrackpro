import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createLeave } from '../api/endpoints';
import { toApiError } from '../api/errors';
import { Card, ErrorBox, Field, PrimaryButton } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius } from '../theme';
import { isDateKey, newIdempotencyKey } from '../util/forms';

type LeaveType = 'casual' | 'medical';

/** Leave request form. Dates are typed as YYYY-MM-DD. The server applies the rules: advance notice, weekly offs, overlaps. */
export function LeaveRequestScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // One key per form: a retry after a dropped connection sends the same key, so the leave is not created twice.
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [leaveType, setLeaveType] = useState<LeaveType>('casual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!isDateKey(startDate) || !isDateKey(endDate)) {
      setError('Enter both dates as YYYY-MM-DD, for example 2026-12-01.');
      return;
    }
    if (reason.trim().length === 0) {
      setError('Please give a reason for the leave.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createLeave({ startDate, endDate, leaveType, reason: reason.trim() }, idempotencyKey);
      navigation.goBack();
    } catch (e) {
      setError(toApiError(e).message);
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.label}>Leave type</Text>
        <View style={styles.typeRow}>
          {(['casual', 'medical'] as const).map((type) => (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityState={{ selected: leaveType === type }}
              onPress={() => setLeaveType(type)}
              style={[styles.typeChip, leaveType === type && styles.typeChipOn]}
            >
              <Text style={[styles.typeText, leaveType === type && styles.typeTextOn]}>{type === 'casual' ? 'Casual' : 'Medical'}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="From (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} autoCapitalize="none" editable={!busy} />
        <Field label="To (YYYY-MM-DD)" value={endDate} onChangeText={setEndDate} autoCapitalize="none" editable={!busy} />
        <Field label="Reason" value={reason} onChangeText={setReason} multiline editable={!busy} />
        {error ? <ErrorBox message={error} /> : null}
        <View style={styles.buttonSpace}>
          <PrimaryButton label={busy ? 'Sending…' : 'Send request'} onPress={submit} disabled={busy} />
        </View>
        <Text style={styles.help}>Leave must be requested in advance. Weekly offs and holidays are not counted.</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, backgroundColor: colors.slate100, flexGrow: 1 },
  label: { fontSize: 13, fontWeight: '600', color: colors.slate600, marginBottom: 8 },
  typeRow: { flexDirection: 'row', marginBottom: 14 },
  typeChip: { borderWidth: 1, borderColor: colors.slate300, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8, marginRight: 8, backgroundColor: colors.white },
  typeChipOn: { borderColor: colors.indigo600, backgroundColor: colors.indigo50 },
  typeText: { color: colors.slate600, fontWeight: '600' },
  typeTextOn: { color: colors.indigo700 },
  buttonSpace: { marginTop: 6 },
  help: { fontSize: 12, color: colors.slate500, textAlign: 'center', marginTop: 12 },
});
