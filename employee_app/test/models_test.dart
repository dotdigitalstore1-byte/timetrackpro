import 'package:flutter_test/flutter_test.dart';

import 'package:dotinout_employee/features/employee/data/models/attendance_model.dart';
import 'package:dotinout_employee/features/employee/data/models/leave_model.dart';
import 'package:dotinout_employee/features/employee/data/models/me_model.dart';
import 'package:dotinout_employee/features/employee/data/models/notice_model.dart';
import 'package:dotinout_employee/features/employee/data/models/salary_model.dart';

void main() {
  test('profile reads the user, employee and company fields', () {
    final me = MeData.fromJson({
      'user': {'id': 'u1', 'fullName': 'Anjali Krishnan', 'email': 'a@example.com', 'phone': null, 'role': 'employee'},
      'company': {'name': 'Example Co'},
      'settings': {'currency': 'INR'},
      'employee': {
        'employeeCode': 'E-101',
        'designation': 'Analyst',
        'department': 'Finance',
        'locations': [
          {'id': 'l1', 'name': 'Kochi'},
        ],
        'shiftStart': '09:30',
        'shiftEnd': '18:00',
        'basicSalary': '24000.00',
      },
    });

    expect(me.userId, 'u1');
    expect(me.firstName, 'Anjali');
    expect(me.initials, 'AK');
    expect(me.locations, ['Kochi']);
    expect(me.basicSalary, 24000);
    expect(me.currency, 'INR');
  });

  test('attendance finds today, and the calendar has its kind and record', () {
    final data = AttendanceData.fromJson({
      'today': '2026-11-23',
      'month': '2026-11',
      'period': {'start': '2026-10-26T00:00:00.000Z', 'end': '2026-11-25T00:00:00.000Z'},
      'summary': {'present': 3, 'late': 1, 'half': 0, 'leave': 0, 'absent': 1},
      'days': [
        {'date': '2026-11-23', 'weekday': 'Mon', 'kind': 'pending', 'label': 'Not punched in', 'note': 'Today'},
        {
          'date': '2026-11-22',
          'weekday': 'Sun',
          'kind': 'record',
          'label': '',
          'note': '',
          'record': {
            'workDate': '2026-11-22T00:00:00.000Z',
            'punchInTime': '2026-11-22T03:35:00.000Z',
            'punchOutTime': null,
            'status': 'half_day',
            'autoHalfDay': true,
            'earlyLeaveMinutes': 0,
            'overtimeMinutes': 0,
          },
        },
      ],
      'records': [],
      'restricted': false,
    });

    expect(data.summary.absent, 1);
    expect(data.dayOn('2026-11-23')?.kind, 'pending');
    final rec = data.dayOn('2026-11-22')?.record;
    expect(rec?.status, 'half_day');
    expect(rec?.autoHalfDay, isTrue);
    expect(rec?.punchIn?.toUtc(), DateTime.utc(2026, 11, 22, 3, 35));
    expect(rec?.punchOut, isNull);
  });

  test('salary reads decimal strings as numbers and keeps the cycle list', () {
    final data = SalaryData.fromJson({
      'employee': {'fullName': 'Anjali Krishnan', 'designation': 'Analyst'},
      'year': 2026,
      'month': 11,
      'period': {'start': '2026-10-26T00:00:00.000Z', 'end': '2026-11-25T00:00:00.000Z'},
      'cycles': [
        {'key': '2026-11', 'start': '2026-10-26T00:00:00.000Z', 'end': '2026-11-25T00:00:00.000Z'},
        {'key': '2026-10', 'start': '2026-09-26T00:00:00.000Z', 'end': '2026-10-25T00:00:00.000Z'},
      ],
      'salaryDate': '2026-11-26T00:00:00.000Z',
      'disbursementDate': '2026-11-26T00:00:00.000Z',
      'status': 'preview',
      'frozen': false,
      'breakdown': {'basicSalary': 24000, 'attendanceSalary': '23000.00', 'netPayable': '22650.50', 'presentDays': 20},
      'holds': [],
      'history': [
        {'month': 10, 'year': 2026, 'netPayable': '23100.00', 'status': 'paid', 'disbursementDate': '2026-10-26T00:00:00.000Z'},
      ],
    });

    expect(data.currentKey, '2026-11');
    expect(data.breakdown?.netPayable, 22650.5);
    expect(data.breakdown?.attendanceSalary, 23000);
    expect(data.history.single.netPayable, 23100);
    expect(data.disbursementDate, '2026-11-26');
  });

  test('leave balance and notice parse when empty or missing', () {
    final leaves = LeavesData.fromJson({
      'balance': {'year': 2026, 'quota': '12', 'used': 2, 'pending': 0, 'remaining': '10', 'mode': 'carry'},
      'leaves': [
        {'id': 'x', 'leaveType': 'casual', 'startDate': '2026-11-10T00:00:00.000Z', 'endDate': '2026-11-10T00:00:00.000Z', 'days': '1.0', 'status': 'approved'},
      ],
    });
    expect(leaves.balance?.remaining, 10);
    expect(leaves.leaves.single.startDate, '2026-11-10');

    final none = LeavesData.fromJson({'balance': null, 'leaves': []});
    expect(none.balance, isNull);

    final notice = NoticeData.fromJson({'role': 'employee', 'current': null, 'history': [], 'canRequest': true});
    expect(notice.current, isNull);
    expect(notice.canRequest, isTrue);
  });
}
