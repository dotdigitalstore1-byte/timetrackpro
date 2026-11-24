import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/cache/key_value_cache.dart';
import '../../../core/cache/stale_while_revalidate.dart';
import '../../auth/application/session_controller.dart';
import '../data/employee_api.dart';
import '../data/models/attendance_model.dart';
import '../data/models/leave_model.dart';
import '../data/models/me_model.dart';
import '../data/models/notice_model.dart';
import '../data/models/notification_model.dart';
import '../data/models/salary_model.dart';

final employeeApiProvider = Provider<EmployeeApi>((ref) => EmployeeApi(ref.watch(apiClientProvider)));

/// The signed-in user's id. Cache keys include it, so one user's saved data never shows for another on this device.
final _cacheScopeProvider = Provider<String?>((ref) => ref.watch(sessionProvider.select((s) => s.userId)));

/// Stale-while-revalidate for one screen: the cached copy first, then the server. Without a user id nothing is cached.
Stream<Snapshot<T>> _resource<T>({
  required KeyValueCache cache,
  required String? scope,
  required String name,
  required Future<Map<String, dynamic>> Function() fetch,
  required T Function(Map<String, dynamic> json) parse,
}) {
  return staleWhileRevalidate<T>(
    cache: scope == null ? const NoCache() : cache,
    key: scope == null ? name : 'user:$scope/$name',
    fetch: fetch,
    parse: parse,
  );
}

final meProvider = StreamProvider.autoDispose<Snapshot<MeData>>((ref) {
  final api = ref.watch(employeeApiProvider);
  return _resource<MeData>(
    cache: ref.watch(cacheProvider),
    scope: ref.watch(_cacheScopeProvider),
    name: 'me',
    fetch: api.me,
    parse: MeData.fromJson,
  );
});

/// [month] is a salary-cycle key ("YYYY-MM"), or null for the current cycle.
final attendanceProvider = StreamProvider.autoDispose.family<Snapshot<AttendanceData>, String?>((ref, month) {
  final api = ref.watch(employeeApiProvider);
  return _resource<AttendanceData>(
    cache: ref.watch(cacheProvider),
    scope: ref.watch(_cacheScopeProvider),
    name: 'attendance:${month ?? 'current'}',
    fetch: () => api.attendance(month: month),
    parse: AttendanceData.fromJson,
  );
});

final leavesProvider = StreamProvider.autoDispose<Snapshot<LeavesData>>((ref) {
  final api = ref.watch(employeeApiProvider);
  return _resource<LeavesData>(
    cache: ref.watch(cacheProvider),
    scope: ref.watch(_cacheScopeProvider),
    name: 'leaves',
    fetch: api.leaves,
    parse: LeavesData.fromJson,
  );
});

final salaryProvider = StreamProvider.autoDispose.family<Snapshot<SalaryData>, String?>((ref, month) {
  final api = ref.watch(employeeApiProvider);
  return _resource<SalaryData>(
    cache: ref.watch(cacheProvider),
    scope: ref.watch(_cacheScopeProvider),
    name: 'salary:${month ?? 'current'}',
    fetch: () => api.salary(month: month),
    parse: SalaryData.fromJson,
  );
});

final noticeProvider = StreamProvider.autoDispose<Snapshot<NoticeData>>((ref) {
  final api = ref.watch(employeeApiProvider);
  return _resource<NoticeData>(
    cache: ref.watch(cacheProvider),
    scope: ref.watch(_cacheScopeProvider),
    name: 'notice',
    fetch: api.notice,
    parse: NoticeData.fromJson,
  );
});

final notificationsProvider = StreamProvider.autoDispose<Snapshot<NotificationsData>>((ref) {
  final api = ref.watch(employeeApiProvider);
  return _resource<NotificationsData>(
    cache: ref.watch(cacheProvider),
    scope: ref.watch(_cacheScopeProvider),
    name: 'notifications',
    fetch: api.notifications,
    parse: NotificationsData.fromJson,
  );
});
