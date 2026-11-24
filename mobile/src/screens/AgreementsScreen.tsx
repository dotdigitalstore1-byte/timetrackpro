import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { agreements, respondToAgreement } from '../api/endpoints';
import { toApiError } from '../api/errors';
import type { AgreementItem } from '../api/types';
import { Card, EmptyNote, ErrorBox, PrimaryButton, ScreenScroll, Skeleton, StatusBanner, StatusChip } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { scopedKey, useResource } from '../data/useResource';
import { formatDateKey } from '../format';
import { colors } from '../theme';

/** Company agreements. An unanswered agreement blocks punching on the website, so those are listed first. */
export function AgreementsScreen() {
  const { user } = useSession();
  const state = useResource(scopedKey(user?.id ?? null, 'agreements'), agreements);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = state.data;

  useFocusEffect(useCallback(() => state.refresh(), [state.refresh]));

  const respond = async (item: AgreementItem, response: 'accepted' | 'declined') => {
    if (busyId) return;
    setBusyId(item.id);
    setError(null);
    try {
      await respondToAgreement(item.id, response, response === 'accepted' && dontShowAgain);
      state.refresh();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusyId(null);
    }
  };

  const ordered = data ? [...data.agreements].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending')) : [];

  return (
    <ScreenScroll onRefresh={state.refresh}>
      <StatusBanner state={state} />
      {data ? (
        <>
          <Pressable onPress={() => setDontShowAgain((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: dontShowAgain }} style={styles.checkRow}>
            <View style={[styles.check, dontShowAgain && styles.checkOn]} />
            <Text style={styles.checkText}>Don't show again when I accept</Text>
          </Pressable>
          {error ? <ErrorBox message={error} /> : null}
          {ordered.length === 0 ? <EmptyNote text="No agreements right now." /> : null}
          {ordered.map((item) => (
            <Card key={item.id}>
              <View style={styles.header}>
                <Text style={styles.title}>{item.title}</Text>
                <StatusChip status={chipFor(item.status)} label={labelFor(item.status)} />
              </View>
              {item.publishedAt ? <Text style={styles.meta}>Published {formatDateKey(item.publishedAt.slice(0, 10))}</Text> : null}
              <Text style={styles.body}>{item.body}</Text>
              {item.status === 'pending' ? (
                <View style={styles.actions}>
                  <View style={styles.half}>
                    <PrimaryButton label="Decline" onPress={() => respond(item, 'declined')} disabled={busyId !== null} />
                  </View>
                  <View style={styles.half}>
                    <PrimaryButton label="Accept" onPress={() => respond(item, 'accepted')} disabled={busyId !== null} />
                  </View>
                </View>
              ) : null}
            </Card>
          ))}
        </>
      ) : (
        <Skeleton height={200} />
      )}
    </ScreenScroll>
  );
}

function chipFor(status: string): string {
  if (status === 'pending') return 'pending';
  if (status === 'permanent' || status === 'accepted_today') return 'approved';
  return 'rejected';
}

function labelFor(status: string): string {
  switch (status) {
    case 'pending':
      return 'Needs your answer';
    case 'accepted_today':
      return 'Accepted today';
    case 'permanent':
      return 'Accepted';
    case 'declined_today':
      return 'Declined today';
    default:
      return status;
  }
}

const styles = StyleSheet.create({
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  check: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: colors.slate400, marginRight: 10 },
  checkOn: { backgroundColor: colors.indigo600, borderColor: colors.indigo600 },
  checkText: { fontSize: 14, color: colors.slate900 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.slate900, marginRight: 8 },
  meta: { fontSize: 12, color: colors.slate500, marginBottom: 8 },
  body: { fontSize: 14, color: colors.slate900, lineHeight: 21 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  half: { width: '48%' },
});
