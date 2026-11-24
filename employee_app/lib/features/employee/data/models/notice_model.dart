import '../../../../core/format/json_read.dart';

class NoticeItem {
  const NoticeItem({
    required this.status,
    required this.reason,
    required this.startDate,
    required this.noticeDays,
    required this.lastWorkingDay,
    required this.phase,
    required this.daysLeft,
    required this.requestedAt,
    required this.decisionNote,
    required this.signedName,
    required this.completedAt,
  });

  /// requested | active | completed | rejected | withdrawn
  final String status;
  final String? reason;
  final String? startDate;
  final int? noticeDays;
  final String? lastWorkingDay;

  /// Set while the notice is active: notice | last_day | ended, depending on today.
  final String? phase;
  final int? daysLeft;
  final DateTime? requestedAt;
  final String? decisionNote;
  final String? signedName;
  final DateTime? completedAt;

  factory NoticeItem.fromJson(Map<String, dynamic> json) => NoticeItem(
        status: readStringOr(json['status'], 'requested'),
        reason: readString(json['reason']),
        startDate: dateKeyOf(json['startDate']),
        noticeDays: readIntOrNull(json['noticeDays']),
        lastWorkingDay: dateKeyOf(json['lastWorkingDay']),
        phase: readString(json['phase']),
        daysLeft: readIntOrNull(json['daysLeft']),
        requestedAt: instantOf(json['requestedAt']),
        decisionNote: readString(json['decisionNote']),
        signedName: readString(json['signedName']),
        completedAt: instantOf(json['completedAt']),
      );
}

/// GET /api/notice for the employee: the open notice (if any) and recent history.
class NoticeData {
  const NoticeData({required this.current, required this.history, required this.canRequest});

  final NoticeItem? current;
  final List<NoticeItem> history;
  final bool canRequest;

  factory NoticeData.fromJson(Map<String, dynamic> json) {
    final current = readMap(json['current']);
    return NoticeData(
      current: current.isEmpty ? null : NoticeItem.fromJson(current),
      history: readList(json['history']).map(NoticeItem.fromJson).toList(),
      canRequest: readBool(json['canRequest']),
    );
  }
}
