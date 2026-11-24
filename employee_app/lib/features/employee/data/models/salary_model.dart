import '../../../../core/format/json_read.dart';

class CycleOption {
  const CycleOption({required this.key, required this.start, required this.end});

  /// "YYYY-MM"
  final String key;
  final String? start;
  final String? end;

  factory CycleOption.fromJson(Map<String, dynamic> json) => CycleOption(
        key: readStringOr(json['key'], ''),
        start: dateKeyOf(json['start']),
        end: dateKeyOf(json['end']),
      );
}

class SalaryHistoryItem {
  const SalaryHistoryItem({
    required this.month,
    required this.year,
    required this.periodStart,
    required this.periodEnd,
    required this.netPayable,
    required this.status,
    required this.disbursementDate,
  });

  final int month;
  final int year;
  final String? periodStart;
  final String? periodEnd;
  final double netPayable;

  /// draft | finalized | paid (employees never see drafts)
  final String status;
  final String? disbursementDate;

  factory SalaryHistoryItem.fromJson(Map<String, dynamic> json) => SalaryHistoryItem(
        month: readInt(json['month']),
        year: readInt(json['year']),
        periodStart: dateKeyOf(json['periodStart']),
        periodEnd: dateKeyOf(json['periodEnd']),
        netPayable: readNum(json['netPayable']),
        status: readStringOr(json['status'], 'finalized'),
        disbursementDate: dateKeyOf(json['disbursementDate']),
      );
}

/// Salary for one cycle, with the figures the server calculated. The app never recalculates them.
class SalaryBreakdown {
  const SalaryBreakdown({
    required this.basicSalary,
    required this.attendanceSalary,
    required this.additionsTotal,
    required this.totalAllDeductions,
    required this.unapprovedAbsenceDeduction,
    required this.netBeforeHold,
    required this.netPayable,
    required this.presentDays,
    required this.absentDays,
    required this.lateDays,
    required this.halfDays,
    required this.leaveDays,
    required this.unapprovedLeaveCount,
    required this.overtimePay,
  });

  final double basicSalary;
  final double attendanceSalary;
  final double additionsTotal;
  final double totalAllDeductions;
  final double unapprovedAbsenceDeduction;
  final double netBeforeHold;
  final double netPayable;
  final double presentDays;
  final double absentDays;
  final double lateDays;
  final double halfDays;
  final double leaveDays;
  final int unapprovedLeaveCount;
  final double overtimePay;

  factory SalaryBreakdown.fromJson(Map<String, dynamic> json) => SalaryBreakdown(
        basicSalary: readNum(json['basicSalary']),
        attendanceSalary: readNum(json['attendanceSalary']),
        additionsTotal: readNum(json['additionsTotal']),
        totalAllDeductions: readNum(json['totalAllDeductions']),
        unapprovedAbsenceDeduction: readNum(json['unapprovedAbsenceDeduction']),
        netBeforeHold: readNum(json['netBeforeHold']),
        netPayable: readNum(json['netPayable']),
        presentDays: readNum(json['presentDays']),
        absentDays: readNum(json['absentDays']),
        lateDays: readNum(json['lateDays']),
        halfDays: readNum(json['halfDays']),
        leaveDays: readNum(json['leaveDays']),
        unapprovedLeaveCount: readInt(json['unapprovedLeaveCount']),
        overtimePay: readNum(json['overtimePay']),
      );
}

class SalaryHold {
  const SalaryHold({required this.days, required this.unapprovedDays, required this.amount, required this.status});

  final int days;
  final int unapprovedDays;
  final double amount;
  final String status;

  factory SalaryHold.fromJson(Map<String, dynamic> json) => SalaryHold(
        days: readInt(json['days']),
        unapprovedDays: readInt(json['unapprovedDays']),
        amount: readNum(json['amount']),
        status: readStringOr(json['status'], ''),
      );
}

/// GET /api/salary for one cycle. [status] is preview (not saved yet) | draft | finalized | paid.
class SalaryData {
  const SalaryData({
    required this.designation,
    required this.year,
    required this.month,
    required this.periodStart,
    required this.periodEnd,
    required this.cycles,
    required this.salaryDate,
    required this.disbursementDate,
    required this.status,
    required this.frozen,
    required this.breakdown,
    required this.holds,
    required this.history,
  });

  final String? designation;
  final int year;
  final int month;
  final String? periodStart;
  final String? periodEnd;
  final List<CycleOption> cycles;
  final String? salaryDate;
  final String? disbursementDate;
  final String status;
  final bool frozen;
  final SalaryBreakdown? breakdown;
  final List<SalaryHold> holds;
  final List<SalaryHistoryItem> history;

  /// "YYYY-MM" of the newest cycle, which is the current one.
  String? get currentKey => cycles.isEmpty ? null : cycles.first.key;

  factory SalaryData.fromJson(Map<String, dynamic> json) {
    final employee = readMap(json['employee']);
    final period = readMap(json['period']);
    final breakdown = readMap(json['breakdown']);
    return SalaryData(
      designation: readString(employee['designation']),
      year: readInt(json['year']),
      month: readInt(json['month']),
      periodStart: dateKeyOf(period['start']),
      periodEnd: dateKeyOf(period['end']),
      cycles: readList(json['cycles']).map(CycleOption.fromJson).toList(),
      salaryDate: dateKeyOf(json['salaryDate']),
      disbursementDate: dateKeyOf(json['disbursementDate']),
      status: readStringOr(json['status'], 'preview'),
      frozen: readBool(json['frozen']),
      breakdown: breakdown.isEmpty ? null : SalaryBreakdown.fromJson(breakdown),
      holds: readList(json['holds']).map(SalaryHold.fromJson).toList(),
      history: readList(json['history']).map(SalaryHistoryItem.fromJson).toList(),
    );
  }
}
