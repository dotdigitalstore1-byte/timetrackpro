import { StyleSheet, View } from 'react-native';
import { notifications } from '../api/endpoints';
import { EmptyNote, ListRow, ScreenScroll, Skeleton, StatusBanner } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { scopedKey, useResource } from '../data/useResource';
import { formatDateTime, instantOf } from '../format';
import { colors } from '../theme';

const TONE_COLORS: Record<string, string> = {
  red: colors.red700,
  amber: colors.amber700,
  indigo: colors.indigo600,
  green: colors.green700,
};

export function NotificationsScreen() {
  const { user } = useSession();
  const state = useResource(scopedKey(user?.id ?? null, 'notifications'), notifications);
  const data = state.data;

  return (
    <ScreenScroll onRefresh={state.refresh}>
      <StatusBanner state={state} />
      {data ? (
        data.items.length === 0 ? (
          <EmptyNote text="You're all caught up." />
        ) : (
          data.items.map((item) => {
            const at = instantOf(item.at);
            const dot = TONE_COLORS[item.tone] ?? colors.slate400;
            const subtitle = [item.body, at ? formatDateTime(at) : null].filter(Boolean).join('\n');
            return (
              <ListRow
                key={item.id}
                title={item.title}
                subtitle={subtitle || null}
                right={item.unread ? <View style={[styles.dot, { backgroundColor: dot }]} /> : undefined}
              />
            );
          })
        )
      ) : (
        <>
          <Skeleton height={80} />
          <Skeleton height={80} />
        </>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: 5 },
});
