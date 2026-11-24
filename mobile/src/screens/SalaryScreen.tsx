import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { me, requestSalarySlip, salary, salarySlips } from '../api/endpoints';
import { toApiError } from '../api/errors';
import { Card, EmptyNote, ErrorBox, KeyValue, ListRow, PrimaryButton, ScreenScroll, SectionTitle, Skeleton, StatusBanner, StatusChip } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { scopedKey, useResource } from '../data/useResource';
import { formatCycleKey, formatDateKey, formatDays, formatMoney, formatMonthYear, humanize, num, shiftMonthKey } from '../format';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';

/** Salary for one cycle, the salary slips, and requesting a slip for a finalized cycle. */
export function SalaryScreen() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [month, setMonth] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = useResource(scopedKey(userId, 'salary:current'), () => salary());
  const chosen = useResource(month ? scopedKey(userId, `salary:${month}`) : null, () => salary(month ?? undefined));
  const profile = useResource(scopedKey(userId, 'me'), me);
  const slipList = useResource(scopedKey(userId, 'slips'), salarySlips);
  const view = month ? chosen : current;
  const data = view.data;
  const currentKey = current.data?.cycles?.[0]?.key ?? null;
  const selectedKey = month ?? currentKey;
  const currency = profile.data?.settings?.currency ?? 'INR';
  const b = data?.breakdown ?? null;
  const isEstimate = data?.status === 'preview';

  useFocusEffect(useCallback(() => slipList.refresh(), [slipList.refresh]));

  const goBack = () => {
    const base = month ?? currentKey;
    if (base) setMonth(shiftMonthKey(base, -1));
  };
  const goForward = () => {
    if (!month) return;
    const next = shiftMonthKey(month, 1);
    setMonth(next === currentKey ? null : next);
  };

  const existing = selectedKey ? slipList.data?.requests.find((r) => `${r.year}-${String(r.month).padStart(2, '0')}` === selectedKey) : undefined;

  const requestSlip = async () => {
    if (!selectedKey || requesting) return;
    setRequesting(true);
    setError(null);
    try {
      await requestSalarySlip(selectedKey);
      slipList.refresh();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <ScreenScroll
      onRefresh={() => {
        current.refresh();
        chosen.refresh();
        slipList.refresh();
      }}
    >
      <StatusBanner state={view} />
      <View style={styles.nav}>
        <Pressable onPress={goBack} disabled={!selectedKey} hitSlop={12} accessibilityLabel="Previous cycle">
          <Ionicons name="chevron-back" size={26} color={selectedKey ? colors.indigo600 : colors.slate300} />
        </Pressable>
        <Text style={styles.navLabel}>{selectedKey ? formatCycleKey(selectedKey) : '—'}</Text>
        <Pressable onPress={goForward} disabled={!month} hitSlop={12} accessibilityLabel="Next cycle">
          <Ionicons name="chevron-forward" size={26} color={month ? colors.indigo600 : colors.slate300} />
        </Pressable>
      </View>

      {data ? (
        <>
          <Card>
            <Text style={styles.label}>{isEstimate ? 'Estimated net pay' : 'Net pay'}</Text>
            <Text style={styles.netValue}>{formatMoney(num(b?.netPayable), currency)}</Text>
            <View style={styles.chipRow}>
              <StatusChip status={data.status} label={isEstimate ? 'Estimate' : humanize(data.status)} />
            </View>
            <KeyValue label={isEstimate ? 'Expected on' : 'Paid on'} value={formatDateKey(data.disbursementDate)} />
            {isEstimate ? <Text style={styles.note}>The final amount is set when payroll is saved for this cycle.</Text> : null}
          </Card>

          {b ? (
            <Card>
              <KeyValue label="Basic salary" value={formatMoney(num(b.basicSalary), currency)} />
              <KeyValue label="Attendance-based pay" value={formatMoney(num(b.attendanceSalary), currency)} />
              {num(b.additionsTotal) !== 0 ? <KeyValue label="Additions" value={formatMoney(num(b.additionsTotal), currency)} /> : null}
              {num(b.overtimePay) !== 0 ? <KeyValue label="Overtime" value={formatMoney(num(b.overtimePay), currency)} /> : null}
              <KeyValue label="Deductions" value={formatMoney(num(b.totalAllDeductions), currency)} />
              <View style={styles.divider} />
              <KeyValue label="Present days" value={formatDays(num(b.presentDays))} />
              <KeyValue label="Late days" value={formatDays(num(b.lateDays))} />
              <KeyValue label="Half days" value={formatDays(num(b.halfDays))} />
              <KeyValue label="Absent days" value={formatDays(num(b.absentDays))} />
              <KeyValue label="Leave days" value={formatDays(num(b.leaveDays))} />
            </Card>
          ) : null}

          {data.holds.map((hold, index) => (
            <Card key={`hold-${index}`}>
              <KeyValue label="On hold" value={formatMoney(num(hold.amount), currency)} emphasize />
              <KeyValue label="Reason" value={`Unapproved leave (${hold.unapprovedDays} day(s))`} />
            </Card>
          ))}

          <SectionTitle>Salary slip</SectionTitle>
          {existing ? (
            <ListRow
              title={`Slip for ${formatMonthYear(existing.year, existing.month)}`}
              subtitle={existing.status === 'rejected' && existing.rejectionReason ? `Reason: ${existing.rejectionReason}` : existing.status === 'approved' ? 'Tap to view and save as PDF' : null}
              right={<StatusChip status={existing.status} />}
              onPress={existing.status === 'approved' ? () => navigation.navigate('SalarySlip', { requestId: existing.id }) : undefined}
            />
          ) : data.status === 'preview' ? (
            <EmptyNote text="A slip is available once payroll is finalized for this cycle." />
          ) : (
            <>
              {error ? <ErrorBox message={error} /> : null}
              <PrimaryButton label={requesting ? 'Requesting…' : `Request slip for ${formatCycleKey(selectedKey ?? '')}`} onPress={requestSlip} disabled={requesting} />
            </>
          )}

          <SectionTitle>Previous salaries</SectionTitle>
          {data.history.length === 0 ? <EmptyNote text="No saved salaries yet." /> : null}
          {data.history.map((h) => (
            <ListRow
              key={`${h.year}-${h.month}`}
              title={formatMonthYear(h.year, h.month)}
              subtitle={`${h.status === 'paid' ? 'Paid on' : 'Pay date'} ${formatDateKey(h.disbursementDate)}`}
              right={<Text style={styles.historyAmount}>{formatMoney(num(h.netPayable), currency)}</Text>}
            />
          ))}
        </>
      ) : (
        <>
          <Skeleton height={190} />
          <Skeleton height={200} />
        </>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navLabel: { fontSize: 15, fontWeight: '600', color: colors.slate900 },
  label: { fontSize: 14, color: colors.slate500 },
  netValue: { fontSize: 30, fontWeight: '700', color: colors.slate900, marginTop: 4 },
  chipRow: { flexDirection: 'row', marginVertical: 10 },
  note: { fontSize: 12, color: colors.slate500, marginTop: 6 },
  divider: { height: 1, backgroundColor: colors.slate200, marginVertical: 10 },
  historyAmount: { fontSize: 14, fontWeight: '700', color: colors.slate900 },
});
