import '../../../core/network/api_client.dart';

/// The read-only calls the employee screens make. Each returns the server's JSON unchanged; the models parse it.
class EmployeeApi {
  EmployeeApi(this._api);

  final ApiClient _api;

  Future<Map<String, dynamic>> me() => _api.getJson('/api/auth/me');

  /// [month] is a salary-cycle key such as "2026-11". Null means the current cycle.
  Future<Map<String, dynamic>> attendance({String? month}) =>
      _api.getJson('/api/attendance', query: month == null ? null : {'month': month});

  Future<Map<String, dynamic>> leaves() => _api.getJson('/api/leaves');

  Future<Map<String, dynamic>> salary({String? month}) =>
      _api.getJson('/api/salary', query: month == null ? null : {'month': month});

  Future<Map<String, dynamic>> notice() => _api.getJson('/api/notice');

  Future<Map<String, dynamic>> notifications() => _api.getJson('/api/notifications');
}
