import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { notice, requestNotice, withdrawNotice } from '../api/endpoints';
import { toApiError } from '../api/errors';
import type { NoticeItem } from '../api/types';
import { Card, EmptyNote, ErrorBox, Field, KeyValue, ListRow, PrimaryButton, ScreenScroll, SectionTitle, Skeleton, StatusBanner, StatusChip } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { scopedKey, useResource } from '../data/useResource';
import { formatDateKey } from '../format';
import { colors } from '../theme';

/** Current notice period, history, a request form when the company allows it, and withdraw for a waiting request. */
export function NoticeScreen() {
  const { user } = useSession();
  const state = useResource(scopedKey(user?.id ?? null, 'notice'), notice);
  const [reason, setReason] = useState('');
  const [signature, setSignature] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = state.data;

  useFocusEffect(useCallback(() => state.refresh(), [state.refresh]));

  const submit = async () => {
    if (busy) return;
    if (!confirmed) {
      setError('Confirm that you have sent your formal resignation email.');
      return;
    }
    if (user && signature.trim() !== user.fullName.trim()) {
      setError(`Type your full name exactly as it is on your account: ${user.fullName}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestNotice({ signature: signature.trim(), reason: reason.trim() || undefined });
      setReason('');
      setSignature('');
      setConfirmed(false);
      state.refresh();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = (current: NoticeItem) => {
    if (!current.id) return;
    const id = current.id;
    Alert.alert('Withdraw your request?', 'Your notice request will be cancelled.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          setError(null);
          try {
            await withdrawNotice(id);
            state.refresh();
          } catch (e) {
            setError(toApiError(e).message);
          }
        },
      },
    ]);
  };

  return (
    <ScreenScroll onRefresh={state.refresh}>
      <StatusBanner state={state} />
      {data ? (
        <>
          {data.current ? (
            <Card>
              <View style={styles.row}>
                <Text style={styles.title}>Current notice</Text>
                <StatusChip status={data.current.status} />
              </View>
              {data.current.daysLeft != null && data.current.status === 'active' ? <KeyValue label="Days left" value={String(data.current.daysLeft)} /> : null}
              <KeyValue label="Notice period" value={data.current.noticeDays == null ? '—' : `${data.current.noticeDays} days`} />
              <KeyValue label="Start date" value={formatDateKey(data.current.startDate)} />
              <KeyValue label="Last working day" value={formatDateKey(data.current.lastWorkingDay)} />
              {data.current.decisionNote ? <KeyValue label="Note from manager" value={data.current.decisionNote} /> : null}
              {data.current.status === 'requested' ? (
                <Pressable onPress={() => withdraw(data.current as NoticeItem)} accessibilityRole="button" style={styles.withdraw}>
                  <Text style={styles.withdrawText}>Withdraw request</Text>
                </Pressable>
              ) : null}
            </Card>
          ) : data.canRequest ? (
            <Card>
              <Text style={styles.title}>Request a notice period</Text>
              <Text style={styles.body}>Send your formal resignation email first, then confirm below.</Text>
              <Field label="Reason (optional)" value={reason} onChangeText={setReason} multiline editable={!busy} />
              <Field label="Type your full name to sign" value={signature} onChangeText={setSignature} autoCapitalize="words" editable={!busy} />
              <Pressable onPress={() => setConfirmed((c) => !c)} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} style={styles.checkRow}>
                <View style={[styles.check, confirmed && styles.checkOn]} />
                <Text style={styles.checkText}>I have sent my formal resignation email.</Text>
              </Pressable>
              {error ? <ErrorBox message={error} /> : null}
              <View style={styles.buttonSpace}>
                <PrimaryButton label={busy ? 'Sending…' : 'Submit request'} onPress={submit} disabled={busy} />
              </View>
            </Card>
          ) : (
            <EmptyNote text="You have no open notice period." />
          )}
          {error && !data.canRequest ? <ErrorBox message={error} /> : null}
          <SectionTitle>History</SectionTitle>
          {data.history.length === 0 ? <EmptyNote text="No notice periods yet." /> : null}
          {data.history.map((h, index) => (
            <ListRow key={h.id ?? `history-${index}`} title={`Started ${formatDateKey(h.startDate)}`} subtitle={`Last working day ${formatDateKey(h.lastWorkingDay)}`} right={<StatusChip status={h.status} />} />
          ))}
        </>
      ) : (
        <Skeleton height={180} />
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 16, fontWeight: '700', color: colors.slate900, marginBottom: 6 },
  body: { fontSize: 14, color: colors.slate600, marginBottom: 12 },
  buttonSpace: { marginTop: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  check: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: colors.slate400, marginRight: 10 },
  checkOn: { backgroundColor: colors.indigo600, borderColor: colors.indigo600 },
  checkText: { flex: 1, fontSize: 14, color: colors.slate900 },
  withdraw: { alignSelf: 'flex-end', marginTop: 10, paddingVertical: 4 },
  withdrawText: { color: colors.rose700, fontWeight: '600' },
});
