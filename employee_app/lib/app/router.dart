import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/application/session_controller.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/auth/presentation/splash_screen.dart';
import '../features/employee/presentation/attendance_screen.dart';
import '../features/employee/presentation/home_screen.dart';
import '../features/employee/presentation/leaves_screen.dart';
import '../features/employee/presentation/more_screen.dart';
import '../features/employee/presentation/notice_screen.dart';
import '../features/employee/presentation/notifications_screen.dart';
import '../features/employee/presentation/profile_screen.dart';
import '../features/employee/presentation/salary_screen.dart';
import 'shell.dart';

final routerProvider = Provider<GoRouter>((ref) {
  // Bridges Riverpod state into go_router: a change in the session re-runs the redirect below.
  final refresh = ValueNotifier<SessionState>(ref.read(sessionProvider));
  ref.listen<SessionState>(sessionProvider, (_, next) => refresh.value = next);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final status = refresh.value.status;
      final here = state.matchedLocation;
      if (status == SessionStatus.unknown) return here == '/splash' ? null : '/splash';
      if (status == SessionStatus.signedOut) return here == '/login' ? null : '/login';
      // Signed in: never stay on splash or login.
      if (here == '/splash' || here == '/login') return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (context, state) => const SplashScreen()),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      // Full-screen pages opened from More or the Home bell. They sit above the tabs, with a back button.
      GoRoute(path: '/notice', builder: (context, state) => const NoticeScreen()),
      GoRoute(path: '/notifications', builder: (context, state) => const NotificationsScreen()),
      GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen()),
      // The tabs. Each branch keeps its own state, so switching tabs does not reload or reset scroll position.
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => ShellScaffold(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/home', builder: (c, s) => const HomeScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/attendance', builder: (c, s) => const AttendanceScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/leaves', builder: (c, s) => const LeavesScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/salary', builder: (c, s) => const SalaryScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/more', builder: (c, s) => const MoreScreen()),
          ]),
        ],
      ),
    ],
  );
});
