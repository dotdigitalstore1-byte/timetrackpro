import '../../../../core/format/json_read.dart';

class CycleCounts {
  const CycleCounts({required this.present, required this.late, required this.half, required this.leave, required this.absent});

  final int present;
  final int late;
  final int half;
  final int leave;
  final int absent;

  static const empty = CycleCounts(present: 0, late: 0, half: 0, leave: 0, absent: 0);

  factory CycleCounts.fromJson(Map<String, dynamic> json) => CycleCounts(
        present: readInt(json['present']),
        late: readInt(json['late']),
        half: readInt(json['half']),
        leave: readInt(json['leave']),
        absent: readInt(json['absent']),
      );
}

class AttendanceRecord {
  const AttendanceRecord({
    required this.workDate,
    required this.punchIn,
    required this.punchOut,
    required this.status,
    required this.note,
    required this.earlyLeaveMinutes,
    required this.overtimeMinutes,
    required this.autoHalfDay,
  });

  /// "yyyy-mm-dd" in the company's calendar.
  final String workDate;
  final DateTime? punchIn;
  final DateTime? punchOut;

  /// present | late | half_day | absent | on_leave
  final String status;
  final String? note;
  final int earlyLeaveMinutes;
  final int overtimeMinutes;

  /// The server turned a missing punch-out into a half day.
  final bool autoHalfDay;

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) => AttendanceRecord(
        workDate: dateKeyOf(json['workDate']) ?? '',
        punchIn: instantOf(json['punchInTime']),
        punchOut: instantOf(json['punchOutTime']),
        status: readStringOr(json['status'], 'present'),
        note: readString(json['note']),
        earlyLeaveMinutes: readInt(json['earlyLeaveMinutes']),
        overtimeMinutes: readInt(json['overtimeMinutes']),
        autoHalfDay: readBool(json['autoHalfDay']),
      );
}

/// One calendar date in the cycle. [kind] is record | off | leave | pending | upcoming | absent.
class CalendarDay {
  const CalendarDay({
    required this.date,
    required this.weekday,
    required this.kind,
    required this.label,
    required this.note,
    required this.record,
  });

  final String date;
  final String weekday;
  final String kind;
  final String label;
  final String note;
  final AttendanceRecord? record;

  factory CalendarDay.fromJson(Map<String, dynamic> json) {
    final rec = readMap(json['record']);
    return CalendarDay(
      date: readStringOr(json['date'], ''),
      weekday: readStringOr(json['weekday'], ''),
      kind: readStringOr(json['kind'], 'record'),
      label: readStringOr(json['label'], ''),
      note: readStringOr(json['note'], ''),
      record: rec.isEmpty ? null : AttendanceRecord.fromJson(rec),
    );
  }
}

/// GET /api/attendance for one salary cycle.
class AttendanceData {
  const AttendanceData({
    required this.today,
    required this.month,
    required this.periodStart,
    required this.periodEnd,
    required this.summary,
    required this.days,
    required this.records,
    required this.restricted,
  });

  final String today;
  final String month;
  final String? periodStart;
  final String? periodEnd;
  final CycleCounts summary;
  final List<CalendarDay> days;
  final List<AttendanceRecord> records;

  /// The company has hidden older history. Only today's punch is included.
  final bool restricted;

  AttendanceRecord? recordOn(String dateKey) {
    for (final r in records) {
      if (r.workDate == dateKey) return r;
    }
    return null;
  }

  CalendarDay? dayOn(String dateKey) {
    for (final d in days) {
      if (d.date == dateKey) return d;
    }
    return null;
  }

  factory AttendanceData.fromJson(Map<String, dynamic> json) {
    final period = readMap(json['period']);
    return AttendanceData(
      today: readStringOr(json['today'], ''),
      month: readStringOr(json['month'], ''),
      periodStart: dateKeyOf(period['start']),
      periodEnd: dateKeyOf(period['end']),
      summary: CycleCounts.fromJson(readMap(json['summary'])),
      days: readList(json['days']).map(CalendarDay.fromJson).toList(),
      records: readList(json['records']).map(AttendanceRecord.fromJson).toList(),
      restricted: readBool(json['restricted']),
    );
  }
}
