import { StyleSheet, Text, View } from 'react-native';
import { me } from '../api/endpoints';
import { Card, KeyValue, PrimaryButton, ScreenScroll, Skeleton, StatusBanner } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { scopedKey, useResource } from '../data/useResource';
import { formatMoney, formatShiftClock, initialsOf, num } from '../format';
import { colors } from '../theme';

export function ProfileScreen() {
  const { user, signOut } = useSession();
  const state = useResource(scopedKey(user?.id ?? null, 'me'), me);
  const data = state.data;
  const employee = data?.employee;
  const currency = data?.settings?.currency ?? 'INR';

  return (
    <ScreenScroll onRefresh={state.refresh}>
      <StatusBanner state={state} />
      {data ? (
        <>
          <View style={styles.header}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsOf(data.user.fullName)}</Text>
            </View>
            <Text style={styles.name}>{data.user.fullName}</Text>
            {employee?.designation ? <Text style={styles.sub}>{employee.designation}</Text> : null}
            {employee?.employeeCode ? <Text style={styles.sub}>ID {employee.employeeCode}</Text> : null}
          </View>

          <Card>
            {data.company ? <KeyValue label="Company" value={data.company.name} /> : null}
            {employee?.department ? <KeyValue label="Department" value={employee.department} /> : null}
            {employee?.locations && employee.locations.length > 0 ? (
              <KeyValue label="Location" value={employee.locations.map((l) => l.name).join(', ')} />
            ) : null}
            <KeyValue
              label="Shift"
              value={`${formatShiftClock(employee?.shiftStart ?? data.settings?.shiftStart)} – ${formatShiftClock(employee?.shiftEnd ?? data.settings?.shiftEnd)}`}
            />
            <KeyValue label="Email" value={data.user.email} />
            {data.user.phone ? <KeyValue label="Phone" value={data.user.phone} /> : null}
            {employee?.basicSalary != null ? (
              <KeyValue label="Basic salary" value={formatMoney(num(employee.basicSalary), currency)} />
            ) : null}
          </Card>

          <PrimaryButton label="Sign out" onPress={() => void signOut()} />
        </>
      ) : (
        <>
          <Skeleton height={140} />
          <Skeleton height={220} />
        </>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: 16 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.indigo50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarText: { color: colors.indigo700, fontSize: 22, fontWeight: '700' },
  name: { fontSize: 18, fontWeight: '700', color: colors.slate900 },
  sub: { fontSize: 14, color: colors.slate500, marginTop: 2 },
});
