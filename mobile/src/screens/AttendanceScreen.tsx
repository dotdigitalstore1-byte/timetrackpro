import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { attendance } from '../api/endpoints';
import type { CalendarDay } from '../api/types';
import { Card, EmptyNote, ListRow, ScreenScroll, Skeleton, StatGrid, StatTile, StatusBanner, StatusChip } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { scopedKey, useResource } from '../data/useResource';
import { formatDateKey, formatDayMonth, formatTime, instantOf, shiftMonthKey } from '../format';
import { colors } from '../theme';
import { PunchPanel } from '../punch/PunchPanel';

/** Attendance for one salary cycle. The counts are the server's own, the same numbers payroll uses. */
export function AttendanceScreen() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [month, setMonth] = useState<string | null>(null);
  const current = useResource(scopedKey(userId, 'attendance:current'), () => attendance());
  const chosen = useResource(month ? scopedKey(userId, `attendance:${month}`) : null, () => attendance(month ?? undefined));
  const view = month ? chosen : current;
  const data = view.data;
  const currentKey = current.data?.month ?? null;

  const todayKey = current.data?.today ?? null;
  const todayRecord = todayKey ? (current.data?.days ?? []).find((d) => d.date === todayKey)?.record ?? null : null;

  const goBack = () => {
    const base = month ?? currentKey;
    if (base) setMonth(shiftMonthKey(base, -1));
  };
  const goForward = () => {
    if (!month) return;
    const next = shiftMonthKey(month, 1);
    setMonth(next === currentKey ? null : next);
  };

  return (
    <ScreenScroll
      onRefresh={() => {
        current.refresh();
        chosen.refresh();
      }}
    >
      <StatusBanner state={view} />
      <PunchPanel
        record={todayRecord}
        onDone={() => {
          current.refresh();
          chosen.refresh();
        }}
      />
      <View style={styles.nav}>
        <Pressable onPress={goBack} disabled={!(month ?? currentKey)} hitSlop={12} accessibilityLabel="Previous cycle">
          <Ionicons name="chevron-back" size={26} color={month ?? currentKey ? colors.indigo600 : colors.slate300} />
        </Pressable>
        <Text style={styles.navLabel}>{data ? `${formatDayMonth(data.period.start)} – ${formatDateKey(data.period.end)}` : '—'}</Text>
        <Pressable onPress={goForward} disabled={!month} hitSlop={12} accessibilityLabel="Next cycle">
          <Ionicons name="chevron-forward" size={26} color={month ? colors.indigo600 : colors.slate300} />
        </Pressable>
      </View>

      {data ? (
        <>
          <StatGrid>
            <StatTile label="On time" value={String(data.summary.present)} color={colors.green700} />
            <StatTile label="Late" value={String(data.summary.late)} color={colors.amber700} />
            <StatTile label="Half day" value={String(data.summary.half)} color={colors.amber700} />
            <StatTile label="Absent" value={String(data.summary.absent)} color={colors.red700} />
            <StatTile label="On leave" value={String(data.summary.leave)} color={colors.blue700} />
          </StatGrid>
          {data.restricted ? (
            <Card>
              <Text style={styles.note}>Older attendance is hidden by your company. Today is shown.</Text>
            </Card>
          ) : null}
          {!data.restricted && (data.days ?? []).length === 0 ? <EmptyNote text="No days in this cycle yet." /> : null}
          {(data.days ?? []).map((day) => (
            <DayRow key={day.date} day={day} />
          ))}
        </>
      ) : (
        <>
          <Skeleton height={70} />
          <Skeleton height={70} />
          <Skeleton height={70} />
        </>
      )}
    </ScreenScroll>
  );
}

function DayRow({ day }: { day: CalendarDay }) {
  const rec = day.record;
  const parts: string[] = [];
  const pin = instantOf(rec?.punchInTime);
  const pout = instantOf(rec?.punchOutTime);
  if (pin) parts.push(`In ${formatTime(pin)}`);
  if (pout) parts.push(`Out ${formatTime(pout)}`);
  if (!rec && day.note) parts.push(day.note);
  return (
    <ListRow
      title={`${day.weekday}, ${formatDayMonth(day.date)}`}
      subtitle={parts.length > 0 ? parts.join('  ·  ') : null}
      right={rec ? <StatusChip status={rec.status} /> : <Text style={styles.caption}>{day.label}</Text>}
    />
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navLabel: { fontSize: 15, fontWeight: '600', color: colors.slate900 },
  note: { fontSize: 14, color: colors.slate900 },
  caption: { fontSize: 12, color: colors.slate500 },
});
