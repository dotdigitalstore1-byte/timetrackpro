import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../auth/SessionContext';
import { BrandMark } from '../components/Brand';
import { initialsOf } from '../format';
import { AgreementsScreen } from '../screens/AgreementsScreen';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LeaveRequestScreen } from '../screens/LeaveRequestScreen';
import { LeavesScreen } from '../screens/LeavesScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { NoticeScreen } from '../screens/NoticeScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SalarySlipScreen } from '../screens/SalarySlipScreen';
import { SalaryScreen } from '../screens/SalaryScreen';
import { SplashScreen } from '../screens/SplashScreen';
import { colors } from '../theme';
import type { RootStackParamList, TabParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();

/** Header title: the company name when known, otherwise the app name. */
function CompanyTitle() {
  const { user } = useSession();
  return (
    <Text style={styles.title} numberOfLines={1}>
      {user?.companyName ?? 'Dotinout'}
    </Text>
  );
}

/** Opens the profile, with the user's initials as the button. */
function AvatarButton() {
  const { user } = useSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Profile" onPress={() => navigation.navigate('Profile')} style={styles.avatar}>
      <Text style={styles.avatarText}>{user?.fullName ? initialsOf(user.fullName) : '?'}</Text>
    </Pressable>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerShadowVisible: false,
        headerTitle: () => <CompanyTitle />,
        headerLeft: () => (
          <View style={styles.headerLeft}>
            <BrandMark size={30} />
          </View>
        ),
        headerRight: () => <AvatarButton />,
        tabBarActiveTintColor: colors.indigo600,
        tabBarInactiveTintColor: colors.slate400,
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.slate200 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="Attendance" component={AttendanceScreen} options={{ tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="Leaves" component={LeavesScreen} options={{ tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="Salary" component={SalaryScreen} options={{ tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="More" component={MoreScreen} options={{ tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" size={size} color={color} /> }} />
    </Tabs.Navigator>
  );
}

/** Shows the splash while the session is checked, then the login screen or the app. */
export function RootNavigator() {
  const { status } = useSession();

  if (status === 'loading') return <SplashScreen />;

  if (status === 'signedOut') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false, headerTintColor: colors.slate900 }}>
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="Notice" component={NoticeScreen} options={{ title: 'Notice period' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Stack.Screen name="LeaveRequest" component={LeaveRequestScreen} options={{ title: 'Request leave' }} />
      <Stack.Screen name="Agreements" component={AgreementsScreen} options={{ title: 'Agreements' }} />
      <Stack.Screen name="SalarySlip" component={SalarySlipScreen} options={{ title: 'Salary slip' }} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '700', color: colors.slate900, maxWidth: 220 },
  headerLeft: { marginLeft: 16 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.indigo50, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  avatarText: { color: colors.indigo700, fontSize: 12, fontWeight: '700' },
});
