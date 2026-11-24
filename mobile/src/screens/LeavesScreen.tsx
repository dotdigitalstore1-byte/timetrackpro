import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { cancelLeave, leaves } from '../api/endpoints';
import { toApiError } from '../api/errors';
import type { LeaveRequest } from '../api/types';
import { Card, EmptyNote, ErrorBox, KeyValue, ListRow, PrimaryButton, ScreenScroll, SectionTitle, Skeleton, StatGrid, StatTile, StatusBanner, StatusChip } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { scopedKey, useResource } from '../data/useResource';
import { formatDateKey, formatDays, humanize, num } from '../format';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';

/** Leave balance, the employee's requests, a form to request leave, and cancel for requests still waiting. */
export function LeavesScreen() {
  const { user } = useSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const state = useResource(scopedKey(user?.id ?? null, 'leaves'), leaves);
  const [error, setError] = useState<string | null>(null);
  const data = state.data;
  const balance = data?.balance;

  // Coming back from the request form shows the new request straight away.
  useFocusEffect(useCallback(() => state.refresh(), [state.refresh]));

  const cancel = (leave: LeaveRequest) => {
    Alert.alert('Cancel this request?', `${formatDateKey(leave.startDate)} – ${formatDateKey(leave.endDate)}`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: async () => {
          setError(null);
          try {
            await cancelLeave(leave.id);
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
          <PrimaryButton label="Request leave" onPress={() => navigation.navigate('LeaveRequest')} />
          <View style={styles.spacer} />
          {error ? <ErrorBox message={error} /> : null}
          {balance ? (
            <Card>
              <StatGrid>
                <StatTile label="Left to use" value={formatDays(num(balance.remaining))} color={colors.green700} />
                <StatTile label="Pending" value={formatDays(num(balance.pending))} />
              </StatGrid>
              <KeyValue label="Accrued" value={`${formatDays(num(balance.quota))} days`} />
              <KeyValue label="Used" value={`${formatDays(num(balance.used))} days`} />
              <Text style={styles.rule}>{balance.mode === 'lapse' ? 'Unused leave lapses at the end of each month.' : 'Unused leave carries over through the year.'}</Text>
            </Card>
          ) : (
            <EmptyNote text="Leave balance is not available for your account." />
          )}
          <SectionTitle>Your requests</SectionTitle>
          {data.leaves.length === 0 ? <EmptyNote text="You have not requested any leave yet." /> : null}
          {data.leaves.map((leave) => (
            <View key={leave.id}>
              <LeaveRowItem leave={leave} />
              {leave.status === 'pending' ? (
                <Pressable onPress={() => cancel(leave)} accessibilityRole="button" style={styles.cancel}>
                  <Text style={styles.cancelText}>Cancel request</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </>
      ) : (
        <>
          <Skeleton height={140} />
          <Skeleton height={70} />
        </>
      )}
    </ScreenScroll>
  );
}

function LeaveRowItem({ leave }: { leave: LeaveRequest }) {
  const dates = leave.startDate === leave.endDate ? formatDateKey(leave.startDate) : `${formatDateKey(leave.startDate)} – ${formatDateKey(leave.endDate)}`;
  const lines = [`${dates} · ${formatDays(num(leave.days))} day(s)`];
  if (leave.reason) lines.push(leave.reason);
  if (leave.status === 'rejected' && leave.rejectionReason) lines.push(`Reason: ${leave.rejectionReason}`);
  return <ListRow title={humanize(leave.leaveType)} subtitle={lines.join('\n')} right={<StatusChip status={leave.status} />} />;
}

const styles = StyleSheet.create({
  rule: { fontSize: 12, color: colors.slate500, marginTop: 8 },
  spacer: { height: 12 },
  cancel: { alignSelf: 'flex-end', marginTop: -6, marginBottom: 12, paddingHorizontal: 6, paddingVertical: 4 },
  cancelText: { color: colors.rose700, fontWeight: '600', fontSize: 13 },
});
