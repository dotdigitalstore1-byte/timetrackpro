import { useState, type ReactNode } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import type { ResourceState } from '../data/useResource';
import { formatDateTime, humanize } from '../format';
import { colors, radius, statusColor } from '../theme';

/** Pull down to refresh. The spinner shows only for the pull itself, never while the first data is loading. */
export function ScreenScroll({ onRefresh, children }: { onRefresh: () => void; children: ReactNode }) {
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = () => {
    setRefreshing(true);
    onRefresh();
    setTimeout(() => setRefreshing(false), 700);
  };
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.indigo600} />}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/** Shows that the saved data on screen is not the latest, with the time it was saved. */
export function StatusBanner({ state }: { state: Pick<ResourceState<unknown>, 'data' | 'savedAt' | 'error' | 'offline'> }) {
  if (!state.data || !state.error) return null;
  const saved = state.savedAt ? ` Showing data saved ${formatDateTime(new Date(state.savedAt))}.` : '';
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{state.offline ? `You're offline.${saved}` : `Couldn't refresh.${saved}`}</Text>
    </View>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <View style={styles.errorBox} accessibilityLiveRegion="polite">
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, disabled && styles.buttonDisabled, pressed && !disabled && { opacity: 0.85 }]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...input }: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={colors.slate400} style={styles.input} {...input} />
    </View>
  );
}

export function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <View style={styles.tileLabelRow}>
        {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
        <Text style={styles.tileLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Two stat tiles per row on a phone, as on the website. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const color = statusColor(status);
  return (
    <View style={[styles.chip, { backgroundColor: `${color}24` }]}>
      <Text style={[styles.chipText, { color }]}>{label ?? humanize(status)}</Text>
    </View>
  );
}

export function KeyValue({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, emphasize && styles.kvEmphasis]}>{value}</Text>
    </View>
  );
}

export function EmptyNote({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

/** A grey placeholder shape shown in place of a spinner while the first data arrives. */
export function Skeleton({ height = 84 }: { height?: number }) {
  return <View style={[styles.skeleton, { height }]} />;
}

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  return <Card style={styles.rowCard}>{onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body}</Card>;
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, backgroundColor: colors.slate100, flexGrow: 1 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.slate900, marginBottom: 8, marginTop: 4 },
  banner: {
    backgroundColor: colors.indigo50,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.indigo100,
  },
  bannerText: { color: colors.indigo700, fontSize: 13 },
  errorBox: { backgroundColor: colors.rose50, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 12 },
  errorText: { color: colors.rose700, fontSize: 14, fontWeight: '500' },
  button: {
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.indigo600,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonDisabled: { backgroundColor: '#A5B4FC' },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.slate600, marginBottom: 6 },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.slate300,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.slate900,
  },
  tile: {
    width: '48%',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: 14,
    marginBottom: 10,
  },
  tileValue: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  tileLabelRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  tileLabel: { fontSize: 12, fontWeight: '500', color: colors.slate500, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  chip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '600' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 6 },
  kvLabel: { fontSize: 14, color: colors.slate500, flex: 1, marginRight: 12 },
  kvValue: { fontSize: 14, color: colors.slate900, flex: 1.4, textAlign: 'right' },
  kvEmphasis: { fontSize: 16, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.slate500, fontSize: 14, paddingVertical: 16 },
  skeleton: { backgroundColor: colors.slate200, borderRadius: radius.lg, marginBottom: 12 },
  rowCard: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  rowText: { flex: 1, marginRight: 12 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.slate900 },
  rowSubtitle: { fontSize: 13, color: colors.slate500, marginTop: 3 },
});
