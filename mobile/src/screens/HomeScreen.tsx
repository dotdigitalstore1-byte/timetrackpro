import { StyleSheet, Text, View } from 'react-native';
import { attendance, leaves, me, notice } from '../api/endpoints';
import { Card, EmptyNote, KeyValue, ScreenScroll, SectionTitle, Skeleton, StatGrid, StatTile, StatusBanner, StatusChip } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { scopedKey, useResource } from '../data/useResource';
import { dateKeyOf, firstName, formatDateKey, formatDayMonth, formatDays, formatLongDate, formatShiftClock, formatTime, greetingFor, instantOf, num } from '../format';
import { colors } from '../theme';

/** Home: today's punch, this cycle's counts, leave left, and any open notice period. */
export function HomeScreen() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const profile = useResource(scopedKey(userId, 'me'), me);
  const attendanceState = useResource(scopedKey(userId, 'attendance:current'), () => attendance());
  const leaveState = useResource(scopedKey(userId, 'leaves'), leaves);
  const noticeState = useResource(scopedKey(userId, 'notice'), notice);

  const today = new Date();
  const att = attendanceState.data;
  const todayKey = att?.today ?? null;
  const record = att && todayKey ? (att.records.find((r) => dateKeyOf(r.workDate) === todayKey) ?? null) : null;
  const day = att?.days?.find((d) => d.date === todayKey) ?? null;
  const punchIn = instantOf(record?.punchInTime);
  const punchOut = instantOf(record?.punchOutTime);
  const shiftStart = profile.data?.employee?.shiftStart ?? profile.data?.settings?.shiftStart;
  const shiftEnd = profile.data?.employee?.shiftEnd ?? profile.data?.settings?.shiftEnd;
  const currentNotice = noticeState.data?.current;
  const balance = leaveState.data?.balance;

  const refreshAll = () => {
    profile.refresh();
    attendanceState.refresh();
    leaveState.refresh();
    noticeState.refresh();
  };

  return (
    <ScreenScroll onRefresh={refreshAll}>
      <Text style={styles.greeting}>
        {greetingFor(today.getHours())}
        {profile.data ? `, ${firstName(profile.data.user.fullName)}` : ''}
      </Text>
      <Text style={styles.date}>{formatLongDate(today)}</Text>
      <StatusBanner state={attendanceState} />

      {att ? (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Today</Text>
            {record ? <StatusChip status={record.status} /> : null}
          </View>
          {punchIn ? (
            <KeyValue label="Punched in" value={formatTime(punchIn)} />
          ) : (
            <Text style={styles.body}>{day?.note || day?.label || 'Not punched in yet'}</Text>
          )}
          {punchOut ? <KeyValue label="Punched out" value={formatTime(punchOut)} /> : null}
          {shiftStart && shiftEnd ? (
            <KeyValue label="Shift" value={`${formatShiftClock(shiftStart)} – ${formatShiftClock(shiftEnd)}`} />
          ) : null}
        </Card>
      ) : (
        <Skeleton height={130} />
      )}

      {currentNotice?.status === 'active' ? (
        <Card>
          <Text style={styles.body}>
            Notice period: {currentNotice.daysLeft ?? '—'} days left. Last working day {formatDateKey(currentNotice.lastWorkingDay)}.
          </Text>
        </Card>
      ) : null}

      {att ? (
        <>
          <SectionTitle>This salary cycle</SectionTitle>
          <Text style={styles.caption}>{`${formatDayMonth(att.period.start)} – ${formatDateKey(att.period.end)}`}</Text>
          <StatGrid>
            <StatTile label="On time" value={String(att.summary.present)} color={colors.green700} />
            <StatTile label="Late" value={String(att.summary.late)} color={colors.amber700} />
            <StatTile label="Half day" value={String(att.summary.half)} color={colors.amber700} />
            <StatTile label="Absent" value={String(att.summary.absent)} color={colors.red700} />
            <StatTile label="On leave" value={String(att.summary.leave)} color={colors.blue700} />
          </StatGrid>
        </>
      ) : (
        <Skeleton height={200} />
      )}

      {balance ? (
        <Card>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.body}>Leave left</Text>
              <Text style={styles.bigValue}>{`${formatDays(num(balance.remaining))} days`}</Text>
            </View>
            <Text style={styles.caption}>
              {num(balance.pending) > 0 ? `${formatDays(num(balance.pending))} day(s) pending` : 'Nothing pending'}
            </Text>
          </View>
        </Card>
      ) : leaveState.loaded ? (
        <EmptyNote text="Leave balance is not available for your account." />
      ) : (
        <Skeleton height={100} />
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: 22, fontWeight: '700', color: colors.slate900 },
  date: { fontSize: 14, color: colors.slate500, marginBottom: 16 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.slate900 },
  body: { fontSize: 14, color: colors.slate900, lineHeight: 20 },
  caption: { fontSize: 12, color: colors.slate500, marginBottom: 10 },
  bigValue: { fontSize: 24, fontWeight: '700', color: colors.slate900, marginTop: 2 },
});
