import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { agreements, notifications } from '../api/endpoints';
import { ListRow, ScreenScroll } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { scopedKey, useResource } from '../data/useResource';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';

/** The screens that are not in the tab bar. */
export function MoreScreen() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const unread = useResource(scopedKey(userId, 'notifications'), notifications).data?.unreadCount ?? 0;
  const pendingAgreements = (useResource(scopedKey(userId, 'agreements'), agreements).data?.agreements ?? []).filter((a) => a.status === 'pending').length;

  const chevron = <Ionicons name="chevron-forward" size={20} color={colors.slate400} />;
  const badge = (count: number) => (
    <View style={styles.right}>
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : String(count)}</Text>
        </View>
      ) : null}
      {chevron}
    </View>
  );

  return (
    <ScreenScroll onRefresh={() => undefined}>
      <ListRow title="Agreements" subtitle={pendingAgreements === 0 ? 'Nothing to answer' : `${pendingAgreements} need your answer`} right={badge(pendingAgreements)} onPress={() => navigation.navigate('Agreements')} />
      <ListRow title="Notice period" subtitle="Your current notice and history" right={chevron} onPress={() => navigation.navigate('Notice')} />
      <ListRow title="Notifications" subtitle={unread === 0 ? 'Nothing new' : `${unread} unread`} right={badge(unread)} onPress={() => navigation.navigate('Notifications')} />
      <ListRow title="Profile" subtitle="Your details and sign out" right={chevron} onPress={() => navigation.navigate('Profile')} />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  right: { flexDirection: 'row', alignItems: 'center' },
  badge: { backgroundColor: colors.indigo600, borderRadius: 10, minWidth: 20, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center', marginRight: 8 },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
});
