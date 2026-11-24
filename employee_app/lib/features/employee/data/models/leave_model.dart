import '../../../../core/format/json_read.dart';

class LeaveBalance {
  const LeaveBalance({
    required this.year,
    required this.quota,
    required this.used,
    required this.pending,
    required this.remaining,
    required this.mode,
  });

  final int year;
  final double quota;
  final double used;
  final double pending;
  final double remaining;

  /// carry: the whole accrued balance can be used. lapse: only this month's leave can be used.
  final String mode;

  factory LeaveBalance.fromJson(Map<String, dynamic> json) => LeaveBalance(
        year: readInt(json['year']),
        quota: readNum(json['quota']),
        used: readNum(json['used']),
        pending: readNum(json['pending']),
        remaining: readNum(json['remaining']),
        mode: readStringOr(json['mode'], 'carry'),
      );
}

class LeaveRequest {
  const LeaveRequest({
    required this.id,
    required this.leaveType,
    required this.startDate,
    required this.endDate,
    required this.days,
    required this.reason,
    required this.status,
    required this.currentLevel,
    required this.rejectionReason,
    required this.createdAt,
  });

  final String id;
  final String leaveType;
  final String? startDate;
  final String? endDate;
  final double days;
  final String? reason;

  /// pending | approved | rejected | cancelled
  final String status;
  final int? currentLevel;
  final String? rejectionReason;
  final DateTime? createdAt;

  factory LeaveRequest.fromJson(Map<String, dynamic> json) => LeaveRequest(
        id: readStringOr(json['id'], ''),
        leaveType: readStringOr(json['leaveType'], 'Leave'),
        startDate: dateKeyOf(json['startDate']),
        endDate: dateKeyOf(json['endDate']),
        days: readNum(json['days']),
        reason: readString(json['reason']),
        status: readStringOr(json['status'], 'pending'),
        currentLevel: readIntOrNull(json['currentLevel']),
        rejectionReason: readString(json['rejectionReason']),
        createdAt: instantOf(json['createdAt']),
      );
}

/// GET /api/leaves: the employee's own balance and requests, newest first.
class LeavesData {
  const LeavesData({required this.balance, required this.leaves});

  final LeaveBalance? balance;
  final List<LeaveRequest> leaves;

  factory LeavesData.fromJson(Map<String, dynamic> json) {
    final balance = readMap(json['balance']);
    return LeavesData(
      balance: balance.isEmpty ? null : LeaveBalance.fromJson(balance),
      leaves: readList(json['leaves']).map(LeaveRequest.fromJson).toList(),
    );
  }
}
